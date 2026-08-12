#!/usr/bin/env bash
# codex-gate.sh — the primitive: run ONE Codex review and emit a tagged outcome.
#
# Local-only, repo-agnostic. NOTHING is written into the target repo; the repo is
# touched with READ-ONLY git queries + file reads only. All output lives under the
# run dir beneath $CODEX_GATE_RUNS. Codex runs config-isolated, --sandbox read-only.
#
# Usage:
#   codex-gate.sh phase-start  <phaseId>
#   codex-gate.sh phase-review <phaseId> [round] [threadId]
#   codex-gate.sh plan         <file>    [round] [threadId]
#   codex-gate.sh bundle       <dir>     [round] [threadId]
#   codex-gate.sh question     <file>    [round] [threadId]
#   codex-gate.sh investigate  <file>    [round] [threadId]   # root-cause a bug (sibling)
#   codex-gate.sh prepr        [base]    [round] [threadId]
#   codex-gate.sh prepr-delta  [base]    [round] [threadId]   # since-reviewed delta
#   codex-gate.sh config                                      # read-only dials + parity report
#
# Contract source of truth is README.md (sibling of this file), including Phase-0 pins.
#
# Outcome (one JSON status line on stdout for REVIEW modes):
#   {outcome, threadId, round, verdictPath, runDir, blockers, agentFixableBlockers,
#    decisionBlockers, summary}
#   outcome ∈ APPROVE | BLOCK | INFRA_ERROR.  Fail closed: any uncertainty => INFRA_ERROR.
#
# Outcome (one JSON status line on stdout for the QUESTION grounding mode):
#   {outcome, threadId, round, verdictPath, runDir, settledByCanon, recommendation, summary}
#   outcome ∈ GROUNDED | INFRA_ERROR.  Fail closed: any uncertainty => INFRA_ERROR.
#
# Outcome (one JSON status line on stdout for the INVESTIGATE root-cause mode):
#   {outcome, threadId, round, verdictPath, runDir, confidence, nextSafeProbe, summary}
#   outcome ∈ ROOT_CAUSE_FOUND | NEEDS_MORE_EVIDENCE | UNSAFE_OR_BLOCKED | INFRA_ERROR | OVERFLOW.
#   (First three come from Codex's report; the wrapper adds INFRA_ERROR/OVERFLOW. Never auto-fixes.)
#
# Outcome (one JSON status line on stdout for the CONFIG read-only report):
#   {outcome, defaults, effective, origin, running, runtimePath, runtimeDigest, runtimeKind,
#    runtimeExecutable, runtimeDefaults, sourcePath, sourceDigest, sourceKind, sourceDiscovery,
#    sourceDefaults, syncInventory, inventoryDrift, inventoryMissing, completeness,
#    digestParity, effectiveParity, parity, summary, remediation}
#   outcome ∈ CONFIG | INFRA_ERROR.  Makes source↔runtime DRIFT observable; calls Codex zero
#   times, creates no run dir, writes no ledger.  parity NEVER reports MATCH on a guess.
#   digestParity is a DIRECTORY-level claim over CODEX_GATE_SYNC_INVENTORY, so MATCH means
#   the installed skill matches the source INCLUDING its schemas and operational docs;
#   inventoryDrift names each member that differs or is present on only one side.
#   parity ∈ MATCH | MISMATCH | INCOMPLETE | UNAVAILABLE.  INCOMPLETE = the two copies agree
#   as far as they go but this is not a complete install — an inventory member is absent
#   (completeness + inventoryMissing say which member and from which endpoint).
#   runtimeExecutable is a DIAGNOSTIC only: `bash codex-gate.sh` needs no +x, so the bit
#   never moves parity.  The gate NEVER writes either endpoint — syncing is manual, see README.md.
#   remediation is a machine-readable action list, a small closed set — sync-files |
#   clear-env-override | rerun-from-source — built from the SAME conditions that grow
#   `summary`, so the two cannot disagree; which variable(s) are implicated is already in
#   `origin`. Empty exactly when parity is MATCH.

set -u

# ----------------------------------------------------------------------------
# Config / env knobs (all overridable; defaults per plan + README)
# ----------------------------------------------------------------------------
SKILL_DIR="$(cd "$(dirname "$0")" && pwd)"
CODEX_BIN="${CODEX_BIN:-/Applications/ChatGPT.app/Contents/Resources/codex}"
CODEX_HOME_DIR="${CODEX_HOME_DIR:-$HOME/.claude/codex-gate/home}"
CODEX_GATE_RUNS="${CODEX_GATE_RUNS:-$HOME/.claude/codex-gate/runs}"
SCHEMA_FILE="$SKILL_DIR/verdict.schema.json"
INSTRUCTIONS_FILE="$SKILL_DIR/reviewer-instructions.md"

# Dial ORIGIN capture — read ONLY by `config`, and it MUST stay directly above the three
# assignments below: once they run, an overridden var is indistinguishable from a defaulted
# one. Each test mirrors its dial's expansion form exactly — `+` (SET, even if empty) for the
# model's `${VAR-default}`, `:+` (set AND non-empty) for the `${VAR:-default}` pair. `config`
# re-reads the forms out of this file and fails closed if they ever stop matching.
CODEX_GATE_MODEL_FROM_ENV="${CODEX_GATE_MODEL+1}"
CODEX_GATE_EFFORT_FROM_ENV="${CODEX_GATE_EFFORT:+1}"
CODEX_GATE_FAST_FROM_ENV="${CODEX_GATE_FAST:+1}"

# Model / reasoning-effort. Default tier is gpt-5.6-sol / xhigh — NOT ultra: ultra performs
# automatic task delegation (observed spawning ~3 sub-reviewers per round, wrapper-invisible
# and unbounded by --multi/CODEX_GATE_FANOUT); it remains available via explicit env override.
# (Model added to argv only when non-empty; set CODEX_GATE_MODEL="" to use Codex's own default.)
CODEX_GATE_MODEL="${CODEX_GATE_MODEL-gpt-5.6-sol}"
CODEX_GATE_EFFORT="${CODEX_GATE_EFFORT:-xhigh}"

# Fast mode (Codex "Speed"): keeps the SAME model (gpt-5.6-sol) but runs ~1.5x faster at ~2.5x credit
# cost (per developers.openai.com/codex/speed). Default OFF (opt-in); set CODEX_GATE_FAST=1 to
# spend the extra credits for speed. The gate inherits none of the app's config (--ignore-user-config),
# so this is the only way fast mode reaches the gate's Codex calls. NOT a quality knob — reasoning effort is separate.
CODEX_GATE_FAST="${CODEX_GATE_FAST:-0}"

# Extra scratch excludes (space-separated globs), opt-in per repo.
CODEX_GATE_EXCLUDES="${CODEX_GATE_EXCLUDES:-}"

# Packet size guards.
MAX_FILE_LINES="${CODEX_GATE_MAX_FILE_LINES:-2000}"

# Context-overflow (Tier 1) guards.
#  - PACKET_BUDGET: max assembled-packet chars before Codex is invoked. Over budget =>
#    the diff is too large for one review => emit OVERFLOW (fail closed) instead of running
#    Codex into a context-window failure. Conservative + tunable.
#  - INLINE_MAX_LINES: at CODE tier, a touched file's FULL body is inlined ONLY when it has
#    <= this many lines; larger files are listed by path + line count (Codex shell-fetches them).
CODEX_GATE_PACKET_BUDGET="${CODEX_GATE_PACKET_BUDGET:-300000}"
CODEX_GATE_INLINE_MAX_LINES="${CODEX_GATE_INLINE_MAX_LINES:-120}"

# Context-overflow (Tier 3) sharding knob (prepr / prepr-delta ONLY).
#  - auto (default): when an assembled prepr/prepr-delta packet exceeds PACKET_BUDGET, SHARD
#    the candidate set by path into disjoint groups, review each non-empty shard in its OWN
#    fresh thread, then aggregate DETERMINISTICALLY (fail-closed). phase-review/plan/bundle/
#    question are NOT sharded — they keep the Tier-1 OVERFLOW.
#  - off: keep emitting OVERFLOW on over-budget (Tier-1 behavior; no sharding).
CODEX_GATE_SHARD="${CODEX_GATE_SHARD:-auto}"

# Tier-3 shard groups: an ORDERED, COMPLETE partition of any candidate set. A file is
# assigned to the FIRST group whose globs match (precedence is the list order); the final
# `other` group is the catch-all, so the union of all groups is ALWAYS the full set and the
# groups are pairwise disjoint (each file matches exactly one group — the first). The globs
# are a small configurable constant: one line per group as "<group>:<space-separated globs>".
# Override via CODEX_GATE_SHARD_GROUPS (same format) if a repo wants different ownership lanes.
CODEX_GATE_SHARD_GROUPS="${CODEX_GATE_SHARD_GROUPS:-$(cat <<'GROUPS'
docs:docs/* */docs/* *.md */*.md
tests:*test* */test* *test*/* *.test.* *_test.* */__tests__/* */__tests__
config:.docker/* */.docker/* Dockerfile* */Dockerfile* *.yml *.yaml *.toml *.ini *.cfg *lock *.lock package-lock.json yarn.lock pnpm-lock.yaml Gemfile.lock poetry.lock
other:*
GROUPS
)}"

# ----------------------------------------------------------------------------
# Multi-LENS fan-out (prepr / prepr-delta ONLY; opt-in; ADR-004/005/006).
# Reviews the SAME full diff through several INDEPENDENT reviewer personas
# ("lenses") — each in its OWN fresh thread — then applies the same deterministic
# fail-closed aggregate as sharding (via fan_out_and_aggregate). Mutually exclusive
# with sharding: when multi-lens is active, the CODEX_GATE_SHARD=auto branch is
# bypassed entirely (every lens gets the WHOLE diff; if a lens packet is over
# budget the run OVERFLOWs — it never silently shards).
#  - CODEX_GATE_FANOUT: 1 => turn multi-lens on (a `--multi` flag on prepr/prepr-delta
#    does the same). Default 0 (off) — existing single-thread behavior is unchanged.
#  - CODEX_GATE_FANOUT_MAX_LENSES: hard cap on the APPLICABLE lens count (default 4).
#    If the applicable set EXCEEDS the cap we FAIL CLOSED with INFRA_ERROR and make
#    ZERO codex calls — we NEVER truncate/drop a lens (a partial review that approved
#    would be a false multi-lens verdict).
CODEX_GATE_FANOUT="${CODEX_GATE_FANOUT:-0}"
CODEX_GATE_FANOUT_MAX_LENSES="${CODEX_GATE_FANOUT_MAX_LENSES:-4}"

# Bounded concurrency for the fan-out (G1/G2/ADR-003). Default 1 == sequential (the
# existing fan_out_and_aggregate loop). >1 is RESERVED: safe backgrounding is not yet
# wired on this path, so any value >1 is treated as 1 (sequential) — the deterministic
# aggregate is identical regardless of ordering, so correctness never depends on this.
CODEX_GATE_MAX_PARALLEL_CODEX="${CODEX_GATE_MAX_PARALLEL_CODEX:-1}"

# FE-path glob set for the frontend lens (the frontend lens is applicable ONLY when the
# reviewed-now diff touches at least one of these). A small, configurable constant, one
# space-separated list; `case` globs match across '/', so `*.tsx` matches at any depth.
# Deliberately broad on the common web-FE extensions (ts/js are included because most FE
# lives there); a repo can narrow/widen via CODEX_GATE_FE_GLOBS.
CODEX_GATE_FE_GLOBS="${CODEX_GATE_FE_GLOBS:-*.tsx *.jsx *.ts *.js *.mjs *.cjs *.css *.scss *.sass *.less *.vue *.svelte *.html}"

# ----------------------------------------------------------------------------
# Small helpers
# ----------------------------------------------------------------------------
die_infra() { # <summary> — emit an INFRA_ERROR status line and exit 0 (fail closed, not a crash)
  local summary="$1"
  jq -nc \
    --arg outcome "INFRA_ERROR" \
    --arg threadId "${THREAD_ID:-}" \
    --argjson round "${ROUND:-1}" \
    --arg verdictPath "${VERDICT_FILE:-}" \
    --arg runDir "${RUN_DIR:-}" \
    --arg summary "$summary" \
    '{outcome:$outcome, threadId:$threadId, round:$round, verdictPath:$verdictPath,
      runDir:$runDir, blockers:0, agentFixableBlockers:0, decisionBlockers:0, summary:$summary}'
  exit 0
}

emit_overflow() { # <summary> — emit an OVERFLOW status line and exit 0 (fail closed, distinct
  # from INFRA_ERROR). The diff is too large for one review (predicted pre-flight by the budget
  # OR observed at runtime via the context-window turn.failed signature), OR a coverage gap left
  # files unaccounted (Tier 2 fail-closed). Same status fields as die_infra incl. zeroed counts;
  # only the outcome differs. When a coverage manifest was computed ($COVERAGE_JSON set, prepr/
  # prepr-delta), it is carried along (additive) so the gap count is visible. The loop STOPs + surfaces.
  local summary="$1"
  if [ -n "${COVERAGE_JSON:-}" ]; then
    jq -nc \
      --arg outcome "OVERFLOW" \
      --arg threadId "${THREAD_ID:-}" \
      --argjson round "${ROUND:-1}" \
      --arg verdictPath "${VERDICT_FILE:-}" \
      --arg runDir "${RUN_DIR:-}" \
      --argjson coverage "$COVERAGE_JSON" \
      --arg summary "$summary" \
      '{outcome:$outcome, threadId:$threadId, round:$round, verdictPath:$verdictPath,
        runDir:$runDir, blockers:0, agentFixableBlockers:0, decisionBlockers:0,
        coverage:$coverage, summary:$summary}'
  else
    jq -nc \
      --arg outcome "OVERFLOW" \
      --arg threadId "${THREAD_ID:-}" \
      --argjson round "${ROUND:-1}" \
      --arg verdictPath "${VERDICT_FILE:-}" \
      --arg runDir "${RUN_DIR:-}" \
      --arg summary "$summary" \
      '{outcome:$outcome, threadId:$threadId, round:$round, verdictPath:$verdictPath,
        runDir:$runDir, blockers:0, agentFixableBlockers:0, decisionBlockers:0, summary:$summary}'
  fi
  exit 0
}

sha1_short() { # <string> -> 12-hex
  printf '%s' "$1" | shasum 2>/dev/null | cut -c1-12
}

# Sanitize a string for safe use as a single path segment.
sanitize_seg() { # <string>
  printf '%s' "$1" | tr '/ :@~' '_____' | tr -cd 'A-Za-z0-9._-'
}

# ----------------------------------------------------------------------------
# Scratch excludes: return 0 if the path should be EXCLUDED, 1 to KEEP it.
# Defaults ONLY: image extensions + anything under .claude/context/.
# Plus any globs in $CODEX_GATE_EXCLUDES. Never excludes .docker/ or .claude/skills/.
# ----------------------------------------------------------------------------
is_excluded() { # <path>
  local p="$1"
  case "$p" in
    *.png|*.jpg|*.jpeg|*.gif|*.webp) return 0 ;;
    .claude/context/*|*/.claude/context/*) return 0 ;;
  esac
  if [ -n "$CODEX_GATE_EXCLUDES" ]; then
    local g
    for g in $CODEX_GATE_EXCLUDES; do
      # shellcheck disable=SC2254
      case "$p" in
        $g) return 0 ;;
      esac
    done
  fi
  return 1
}

# Filter untracked files to "source-like" and non-excluded. Reads NUL? No — git
# ls-files newline output; paths with newlines are not supported (acceptable).
# Echoes kept paths, one per line.
filtered_untracked() {
  git ls-files --others --exclude-standard 2>/dev/null | while IFS= read -r p; do
    [ -n "$p" ] || continue
    if is_excluded "$p"; then continue; fi
    printf '%s\n' "$p"
  done
}

# ----------------------------------------------------------------------------
# Tier-3 shard assignment. Echo the shard GROUP for a path: the FIRST group (in the
# CODEX_GATE_SHARD_GROUPS order) whose space-separated globs match the path via `case`
# (shell case globs match across '/', so `*.md` matches any-depth markdown and `*test*`
# matches a test file at any depth). The last group `other:*` is a catch-all, so EVERY
# path resolves to exactly one group => the partition is complete AND disjoint by
# construction (first-match wins; nothing falls through). Pure, side-effect-free.
# ----------------------------------------------------------------------------
shard_group_for_path() { # <path> -> group name (docs|tests|config|other or custom)
  local p="$1" line group globs g result=""
  # CRITICAL: disable pathname expansion (`set -f`) while iterating, so the space-separated
  # globs are treated as PATTERNS for `case`, not expanded against the current directory
  # (e.g. unquoted `*.md` would otherwise expand to real files in cwd before the loop).
  set -f
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    group="${line%%:*}"          # text before the first ':'
    globs="${line#*:}"           # text after the first ':'
    for g in $globs; do          # word-split only (globbing is off)
      # shellcheck disable=SC2254
      case "$p" in
        $g) result="$group"; break ;;
      esac
    done
    [ -n "$result" ] && break
  done <<EOF
$CODEX_GATE_SHARD_GROUPS
EOF
  set +f
  # Defensive catch-all (only reached if the constant lacks an `other:*` line).
  [ -n "$result" ] || result="other"
  printf '%s' "$result"
}

# ----------------------------------------------------------------------------
# Multi-lens: does a path look like a FRONTEND surface? Returns 0 (match) if the path
# matches any glob in $CODEX_GATE_FE_GLOBS, else 1. `set -f` while iterating so the
# space-separated globs are `case` PATTERNS, not expanded against cwd (same discipline
# as shard_group_for_path). Pure, side-effect free.
# ----------------------------------------------------------------------------
is_frontend_path() { # <path> -> 0 if FE, 1 otherwise
  local p="$1" g rc=1
  set -f
  for g in $CODEX_GATE_FE_GLOBS; do
    # shellcheck disable=SC2254
    case "$p" in
      $g) rc=0; break ;;
    esac
  done
  set +f
  return "$rc"
}

# ----------------------------------------------------------------------------
# Multi-lens: resolve the APPLICABLE lens set for a reviewed-now file list. The core
# lenses {arch, security, tests} ALWAYS apply; the `frontend` lens is added ONLY when
# at least one reviewed-now file is a FE surface (is_frontend_path). Echoes the lens
# names, one per line, in a STABLE order (arch, security, tests, [frontend]). Reads the
# changed-file list at $1. NO codex calls, no side effects — the caller enforces the cap.
# ----------------------------------------------------------------------------
resolve_lens_set() { # <changed-file>
  local changed="$1"
  printf '%s\n' arch security tests
  # frontend is conditional on the diff actually touching a FE surface.
  if [ -f "$changed" ]; then
    local p
    while IFS= read -r p; do
      [ -n "$p" ] || continue
      if is_frontend_path "$p"; then printf '%s\n' frontend; return 0; fi
    done < "$changed"
  fi
}

# ----------------------------------------------------------------------------
# Repo / run-dir resolution
# ----------------------------------------------------------------------------
resolve_repo() {
  REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || REPO_ROOT=""
}

resolve_run_dir() { # <phaseKey>
  local phaseKey="$1"
  local slug rootHash wtkey sessionId branch
  if [ -z "${REPO_ROOT:-}" ]; then
    # not in a repo: namespace by cwd
    slug="$(basename "$(pwd)")"
    rootHash="$(sha1_short "$(pwd)")"
    wtkey="norepo"
  else
    slug="$(basename "$REPO_ROOT")"
    rootHash="$(sha1_short "$REPO_ROOT")"
    branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo HEAD)"
    if [ -z "$branch" ] || [ "$branch" = "HEAD" ]; then
      wtkey="wt-$(sha1_short "$REPO_ROOT")"
    else
      wtkey="$(sanitize_seg "$branch")"
    fi
  fi
  slug="$(sanitize_seg "$slug")"
  # The WORKTREE dir is the namespace shared across ALL phases/sessions of this branch
  # (`<repoSlug>-<rootHash>/<worktreeKey>`). resolve_ledger_path anchors the ledger here
  # so a since-reviewed delta sees prior approvals from any earlier session/phase.
  WORKTREE_DIR="$CODEX_GATE_RUNS/${slug}-${rootHash}/${wtkey}"
  sessionId="${CODEX_GATE_SESSION:-}"
  if [ -z "$sessionId" ]; then
    # stable fallback for a login session (no per-call randomness)
    sessionId="s-$(sha1_short "${TERM_SESSION_ID:-}${USER:-}${REPO_ROOT:-$(pwd)}")"
  fi
  sessionId="$(sanitize_seg "$sessionId")"
  phaseKey="$(sanitize_seg "$phaseKey")"
  RUN_DIR="$WORKTREE_DIR/${sessionId}/${phaseKey}"
}

# ----------------------------------------------------------------------------
# Review ledger path: the SAME namespacing as resolve_run_dir but stopped at the
# WORKTREE level, so the ledger is shared across every phase/session of that branch.
#   $CODEX_GATE_RUNS/<repoSlug>-<rootHash>/<worktreeKey>/ledger.jsonl
# Must be called AFTER resolve_run_dir (which sets WORKTREE_DIR). NEVER inside the repo.
# ----------------------------------------------------------------------------
resolve_ledger_path() {
  LEDGER_PATH="${WORKTREE_DIR:-}/ledger.jsonl"
}

# ----------------------------------------------------------------------------
# Look up the most-recent APPROVED-reviewed sha for a path in the ledger. Echoes the
# sha if the ledger records that path as reviewed at THAT exact sha at least once
# (any approved entry), else echoes nothing. We scan all entries and collect every
# (path -> sha) the ledger has ever approved; a current-hash membership test by the
# caller decides "reviewed & unchanged". Reads $LEDGER_PATH.
#  - prints, one per line, every approved sha recorded for <path> (newest entries first
#    is irrelevant — membership is set-based).
# ----------------------------------------------------------------------------
ledger_shas_for_path() { # <path>
  local p="$1"
  [ -n "${LEDGER_PATH:-}" ] || return 0
  [ -f "$LEDGER_PATH" ] || return 0
  # Each line is a JSON object; emit the shas this path was approved at.
  jq -rR --arg p "$p" \
    'fromjson? | (.reviewedPaths // [])[] | select(.path==$p) | .sha' \
    "$LEDGER_PATH" 2>/dev/null
}

# ----------------------------------------------------------------------------
# Find a verdict reference (verdictPath or threadId) for a path approved at a sha,
# for the "ALREADY REVIEWED & UNCHANGED" proof listing. Echoes the first match.
# ----------------------------------------------------------------------------
ledger_verdict_for_path_sha() { # <path> <sha>
  local p="$1" sha="$2"
  [ -n "${LEDGER_PATH:-}" ] || return 0
  [ -f "$LEDGER_PATH" ] || return 0
  jq -rR --arg p "$p" --arg s "$sha" \
    'fromjson? | select((.reviewedPaths // []) | any(.path==$p and .sha==$s)) | (.verdictPath // .threadId // "")' \
    "$LEDGER_PATH" 2>/dev/null | grep -v '^$' | head -1
}

# ----------------------------------------------------------------------------
# Guidance manifest: paths (only) to root AGENTS.md/CLAUDE.md + any
# AGENTS.md/CLAUDE.md in the directories of changed files. Reviewer reads them
# itself via read-only shell (code tier). Echoes a text block.
# ----------------------------------------------------------------------------
build_manifest() { # <changed-paths-file>
  local changed="$1"
  printf '\n===== REPO GUIDANCE MANIFEST (read these via read-only shell) =====\n'
  if [ -n "${REPO_ROOT:-}" ]; then
    # Dedup ALL printed paths across the whole run on the full path (not just dir),
    # so the same AGENTS.md/CLAUDE.md shared by many changed files prints once.
    local seen=""
    local f
    for f in AGENTS.md CLAUDE.md; do
      if [ -f "$REPO_ROOT/$f" ]; then
        case "$seen" in
          *"|$REPO_ROOT/$f|"*) : ;;
          *) seen="$seen|$REPO_ROOT/$f|"; printf '%s\n' "$REPO_ROOT/$f" ;;
        esac
      fi
    done
    # For each changed file, walk from its directory UP to (and excluding) the
    # repo root, collecting AGENTS.md/CLAUDE.md at every ancestor level. The root
    # is handled above; stop before re-emitting it.
    if [ -f "$changed" ]; then
      local d g cand
      while IFS= read -r p; do
        [ -n "$p" ] || continue
        d="$(dirname "$p")"
        # Walk ancestors: "." (file at repo root) yields nothing new; otherwise
        # ascend a/b/c -> a/b -> a, stopping at "." (the repo root sentinel).
        while [ "$d" != "." ] && [ "$d" != "/" ] && [ -n "$d" ]; do
          for g in AGENTS.md CLAUDE.md; do
            cand="$REPO_ROOT/$d/$g"
            if [ -f "$cand" ]; then
              case "$seen" in
                *"|$cand|"*) : ;;  # already printed for this run
                *) seen="$seen|$cand|"; printf '%s\n' "$cand" ;;
              esac
            fi
          done
          d="$(dirname "$d")"
        done
      done < "$changed"
    fi
  else
    printf '(not in a git repo — no manifest)\n'
  fi
  printf '===== END MANIFEST =====\n'
}

# ----------------------------------------------------------------------------
# Append a diffstat + (tier-dependent) bodies of touched non-scratch files.
#
# ALWAYS emits a TOUCHED FILES (diffstat) section: one line per touched file with
# its current line count (or "(deleted)"), so the reviewer sees the full file
# surface regardless of which bodies are inlined.
#
# Then bodies:
#  - CODE tier: inline a file's FULL body ONLY if it exists and has
#    <= CODEX_GATE_INLINE_MAX_LINES lines. Larger files are listed by path + line
#    count with a note to fetch them via read-only shell (git show/cat/sed) — NO body.
#  - DOC tier: no shell available, so keep inlining bodies up to MAX_FILE_LINES
#    (Codex can't fetch them); the pre-flight budget guard still caps total size.
#
# Diff HUNKS are emitted separately by the caller and are NEVER dropped here.
# ----------------------------------------------------------------------------
append_file_contents() { # <tier> <changed-paths-file> <dest-packet-file>
  local tier="$1" changed="$2" dest="$3"
  [ -f "$changed" ] || return 0

  # ---- ALWAYS: diffstat (path + current line count) for every touched file ----
  printf '\n===== TOUCHED FILES (diffstat) =====\n' >> "$dest"
  local p lines
  while IFS= read -r p; do
    [ -n "$p" ] || continue
    if is_excluded "$p"; then continue; fi
    if [ ! -f "$REPO_ROOT/$p" ]; then
      printf -- '%s  (deleted)\n' "$p" >> "$dest"
      continue
    fi
    lines="$(wc -l < "$REPO_ROOT/$p" 2>/dev/null | tr -d ' ')"
    printf -- '%s  (%s lines)\n' "$p" "${lines:-0}" >> "$dest"
  done < "$changed"
  printf -- '===== END DIFFSTAT =====\n' >> "$dest"

  # ---- bodies (tier-dependent) ----
  printf '\n===== FULL CURRENT CONTENTS OF TOUCHED FILES =====\n' >> "$dest"
  while IFS= read -r p; do
    [ -n "$p" ] || continue
    if is_excluded "$p"; then continue; fi
    if [ ! -f "$REPO_ROOT/$p" ]; then
      printf -- '--- %s (deleted in working tree) ---\n' "$p" >> "$dest"
      continue
    fi
    lines="$(wc -l < "$REPO_ROOT/$p" 2>/dev/null | tr -d ' ')"
    if [ "$tier" = "code" ]; then
      # CODE tier: inline only small files; list larger ones with a fetch note (no body).
      if [ -n "$lines" ] && [ "$lines" -gt "$CODEX_GATE_INLINE_MAX_LINES" ]; then
        printf -- '--- %s (%s lines — body NOT inlined; inspect via read-only shell: `git show <ref>:%s` / `cat` / `sed`) ---\n' "$p" "$lines" "$p" >> "$dest"
        continue
      fi
      printf -- '--- %s ---\n' "$p" >> "$dest"
      cat "$REPO_ROOT/$p" >> "$dest"
      printf '\n' >> "$dest"
    else
      # DOC tier: no shell — keep inlining (size-capped by MAX_FILE_LINES).
      printf -- '--- %s ---\n' "$p" >> "$dest"
      if [ -n "$lines" ] && [ "$lines" -gt "$MAX_FILE_LINES" ]; then
        head -n "$MAX_FILE_LINES" "$REPO_ROOT/$p" >> "$dest"
        printf '\n[...TRUNCATED: %s lines total, showing first %s...]\n' "$lines" "$MAX_FILE_LINES" >> "$dest"
      else
        cat "$REPO_ROOT/$p" >> "$dest"
      fi
      printf '\n' >> "$dest"
    fi
  done < "$changed"
  printf '===== END FILE CONTENTS =====\n' >> "$dest"
}

# ----------------------------------------------------------------------------
# Append the phase intent / acceptance / review context (if the loop driver
# wrote one) to the packet. Placed right AFTER reviewer-instructions and BEFORE
# the manifest/diff so Codex can judge "did this phase do the intended work?".
# Harmless no-op when the file is absent.
# ----------------------------------------------------------------------------
append_context_if_present() { # <dest-packet-file>
  local dest="$1"
  [ -f "$RUN_DIR/context.md" ] || return 0
  {
    printf '\n===== PHASE INTENT / ACCEPTANCE / REVIEW CONTEXT =====\n'
    cat "$RUN_DIR/context.md"
    printf '\n===== END CONTEXT =====\n'
  } >> "$dest"
}

# ----------------------------------------------------------------------------
# Pre-flight budget guard. Call AFTER the packet is fully assembled and BEFORE
# run_codex: measure the packet in chars; if it exceeds CODEX_GATE_PACKET_BUDGET,
# emit OVERFLOW and DO NOT invoke Codex (fail closed — the diff is too large for one
# review). Returns 0 (within budget, proceed) or never returns (emit_overflow exits).
# ----------------------------------------------------------------------------
enforce_packet_budget() { # <packet-file>
  local packet="$1" nchars
  nchars="$(wc -c < "$packet" 2>/dev/null | tr -d ' ')"
  [ -n "$nchars" ] || nchars=0
  if [ "$nchars" -gt "$CODEX_GATE_PACKET_BUDGET" ]; then
    emit_overflow "packet $nchars chars exceeds budget $CODEX_GATE_PACKET_BUDGET; diff too large for one review — use 'prepr --since-reviewed' (Tier 2) or sharding (Tier 3)"
  fi
  return 0
}

# ----------------------------------------------------------------------------
# Codex invocation. Tier governs cwd + flag set. Reads packet from $1, writes
# verdict to $VERDICT_FILE, jsonl to $JSONL_FILE, stderr to $STDERR_FILE.
# Sets CODEX_EXIT. tier ∈ doc | code. If $THREAD_ID_IN is set + round>1 -> resume.
# ----------------------------------------------------------------------------
run_codex() { # <tier> <packet-file> <cwd>
  local tier="$1" packet="$2" cwd="$3"
  mkdir -p "$RUN_DIR"

  # Common, ALWAYS-absolute, ALWAYS-quoted path args. The output schema defaults
  # to $SCHEMA_FILE (the verdict schema), but a mode may pin a different schema for
  # THIS call via $SCHEMA_OVERRIDE (e.g. mode_question uses question.schema.json).
  local schema_abs="${SCHEMA_OVERRIDE:-$SCHEMA_FILE}" out_abs="$VERDICT_FILE"

  # Build argv per tier.
  local -a argv=()
  if [ -n "${THREAD_ID_IN:-}" ] && [ "${ROUND:-1}" -gt 1 ]; then
    # RESUME (round>1): no --sandbox (use -c sandbox_mode), no -C; cwd set by us.
    # Resume MIRRORS the initial invocation's safety flags per tier so a fix-loop
    # round keeps the exact sandbox posture of round 1:
    #  - CODE tier (cwd=repo root, untrusted): keep -c approval_policy="never";
    #    NO --skip-git-repo-check (cwd IS a git repo), shell stays ON.
    #  - DOC tier (cwd=run dir, neutral): keep --skip-git-repo-check + --disable
    #    shell_tool (shell OFF). Both tiers pin -c sandbox_mode="read-only".
    if [ "$tier" = "doc" ]; then
      argv=( exec resume "$THREAD_ID_IN"
             --ignore-user-config --skip-git-repo-check --disable shell_tool
             -c sandbox_mode="read-only"
             --output-schema "$schema_abs" -o "$out_abs" --json )
    else
      argv=( exec resume "$THREAD_ID_IN"
             --ignore-user-config
             -c approval_policy="never"
             -c sandbox_mode="read-only"
             --output-schema "$schema_abs" -o "$out_abs" --json )
    fi
  elif [ "$tier" = "doc" ]; then
    # DOC tier: neutral cwd (run dir), shell OFF.
    argv=( exec
           --ignore-user-config --skip-git-repo-check --sandbox read-only
           --disable shell_tool
           --output-schema "$schema_abs" -o "$out_abs" --json )
  else
    # CODE tier: cwd = repo root (untrusted), read-only shell ON.
    argv=( exec
           --ignore-user-config --sandbox read-only
           -c approval_policy="never"
           --output-schema "$schema_abs" -o "$out_abs" --json )
  fi

  # Optional model / reasoning-effort — appended only when set (bash 3.2: no
  # empty-array expansion under `set -u`).
  [ -n "$CODEX_GATE_MODEL" ] && argv+=( -m "$CODEX_GATE_MODEL" )
  [ -n "$CODEX_GATE_EFFORT" ] && argv+=( -c "model_reasoning_effort=\"$CODEX_GATE_EFFORT\"" )
  # Fast mode — appended in this SHARED tail, so it applies to exec AND resume. Verified accepted
  # + schema-safe live (model stays; effort untouched). service_tier as a TOML string "fast".
  [ "$CODEX_GATE_FAST" = "1" ] && argv+=( --enable fast_mode -c "service_tier=\"fast\"" )

  # packet on stdin via the '-' positional last.
  argv+=( - )

  # Ensure the -o file does not pre-exist (so "missing" really means codex failed to write).
  rm -f "$out_abs"

  # Invoke. Set cwd via a subshell; pipe packet on stdin; redirect streams.
  (
    cd "$cwd" 2>/dev/null || exit 91
    # Phase 0 proved auth works with CODEX_API_KEY UNSET (uses the ChatGPT seat via
    # auth.json). An empty value can be read as a (bad) key instead of "fall back",
    # so unset it rather than blanking it. Subshell-scoped.
    unset CODEX_API_KEY
    export CODEX_HOME="$CODEX_HOME_DIR"
    "$CODEX_BIN" "${argv[@]}" < "$packet" \
        > "$JSONL_FILE" 2> "$STDERR_FILE"
  )
  CODEX_EXIT=$?
}

# ----------------------------------------------------------------------------
# Parse thread_id from the JSONL stream (tolerant of non-JSON prelude lines).
# ----------------------------------------------------------------------------
parse_thread_id() {
  THREAD_ID="$(jq -rR 'fromjson? | select(type=="object" and .type=="thread.started") | .thread_id' "$JSONL_FILE" 2>/dev/null | head -1)"
  [ "$THREAD_ID" = "null" ] && THREAD_ID=""
  # carry an inbound resume id forward if codex didn't re-announce one
  if [ -z "$THREAD_ID" ] && [ -n "${THREAD_ID_IN:-}" ]; then
    THREAD_ID="$THREAD_ID_IN"
  fi
}

# ----------------------------------------------------------------------------
# Map codex result -> outcome and emit the status line.
# ----------------------------------------------------------------------------
# ----------------------------------------------------------------------------
# Classify a nonzero codex round: OVERFLOW if the round JSONL carries the
# context-window signature (ran out of room / context window / turn.failed),
# else generic INFRA_ERROR. Never returns (both branches exit). Call only when
# CODEX_EXIT != 0.
# ----------------------------------------------------------------------------
classify_nonzero_exit() {
  if [ -f "${JSONL_FILE:-}" ] && grep -iE 'ran out of room|context window|"turn\.failed"' "$JSONL_FILE" >/dev/null 2>&1; then
    emit_overflow "codex hit the context window (turn.failed); diff too large — use delta/shard"
  fi
  die_infra "codex exited nonzero ($CODEX_EXIT); see $STDERR_FILE"
}

# ----------------------------------------------------------------------------
# Append ONE JSONL line to the review ledger for an APPROVED reviewed surface.
# Called ONLY from emit_outcome's APPROVE branch, and ONLY when the mode opted in
# by setting $LEDGER_REF (ref) and writing the reviewed paths to $RUN_DIR/.reviewed-paths.
# Modes that must NOT ledger (plan/bundle/question) simply never set LEDGER_REF.
#
# Entry shape:
#   { mode, ref, reviewedPaths:[{path, sha}], verdictPath, threadId, summary }
# where sha = `git -C $REPO_ROOT hash-object -- <path>` of the CURRENT working-tree
# content (a deleted file => "deleted"). NEVER written on BLOCK/INFRA_ERROR/OVERFLOW.
# ----------------------------------------------------------------------------
ledger_append() { # <mode> <summary>
  local mode="$1" summary="$2"
  [ -n "${LEDGER_REF:-}" ] || return 0           # mode didn't opt in
  [ -n "${REPO_ROOT:-}" ] || return 0            # ledger is repo-scoped
  resolve_ledger_path
  [ -n "${LEDGER_PATH:-}" ] || return 0
  mkdir -p "$(dirname "$LEDGER_PATH")" 2>/dev/null || return 0

  # Build reviewedPaths[] from $RUN_DIR/.reviewed-paths (one path per line). Each path's
  # sha is its current hash-object (working-tree content); a path absent from disk -> "deleted".
  local rp="$RUN_DIR/.reviewed-paths"
  local entries="$RUN_DIR/.ledger-entries.jsonl"
  : > "$entries"
  if [ -f "$rp" ]; then
    local p sha
    while IFS= read -r p; do
      [ -n "$p" ] || continue
      if [ -f "$REPO_ROOT/$p" ]; then
        sha="$(git -C "$REPO_ROOT" hash-object -- "$p" 2>/dev/null)"
        [ -n "$sha" ] || sha="deleted"
      else
        sha="deleted"
      fi
      jq -nc --arg path "$p" --arg sha "$sha" '{path:$path, sha:$sha}' >> "$entries"
    done < "$rp"
  fi

  # Assemble the single ledger line and append atomically-ish (append is a single write).
  jq -nc \
    --arg mode "$mode" \
    --arg ref "${LEDGER_REF:-}" \
    --slurpfile reviewedPaths "$entries" \
    --arg verdictPath "${VERDICT_FILE:-}" \
    --arg threadId "${THREAD_ID:-}" \
    --arg summary "$summary" \
    '{mode:$mode, ref:$ref, reviewedPaths:$reviewedPaths, verdictPath:$verdictPath,
      threadId:$threadId, summary:$summary}' >> "$LEDGER_PATH"
  rm -f "$entries"
}

emit_outcome() { # [ledgerMode]
  local ledger_mode="${1:-}"
  parse_thread_id

  # Fail closed on nonzero exit. A context-window overflow is a DISTINCT outcome.
  if [ "${CODEX_EXIT:-1}" -ne 0 ]; then
    classify_nonzero_exit
  fi
  # Verdict file must exist, be non-empty, and be valid JSON.
  if [ ! -s "$VERDICT_FILE" ]; then
    die_infra "verdict file missing or empty ($VERDICT_FILE)"
  fi
  if ! jq -e . "$VERDICT_FILE" >/dev/null 2>&1; then
    die_infra "verdict file is not valid JSON ($VERDICT_FILE)"
  fi

  local verdict summary nblockers nfix ndecision outcome
  verdict="$(jq -r '.verdict // empty' "$VERDICT_FILE" 2>/dev/null)"
  summary="$(jq -r '.summary // ""' "$VERDICT_FILE" 2>/dev/null)"
  nblockers="$(jq -r '(.blockers // []) | length' "$VERDICT_FILE" 2>/dev/null)"
  nfix="$(jq -r '[(.blockers // [])[] | select(.class=="agent_fixable")] | length' "$VERDICT_FILE" 2>/dev/null)"
  ndecision="$(jq -r '[(.blockers // [])[] | select(.class=="decision")] | length' "$VERDICT_FILE" 2>/dev/null)"

  # Pass iff verdict=="approve" AND there are zero blockers. Fail closed on any
  # inconsistency between the .verdict field and the blockers[] list:
  #  - blockers>0 => BLOCK, regardless of .verdict (approve-with-blockers is
  #    inconsistent; we do NOT silently approve over an outstanding blocker).
  #  - approve + 0 blockers => APPROVE.
  #  - request_changes + 0 blockers => degenerate (no actionable findings); surface as infra.
  #  - any other .verdict value => surface as infra.
  if [ "${nblockers:-0}" -gt 0 ]; then
    outcome="BLOCK"
  elif [ "$verdict" = "approve" ]; then
    outcome="APPROVE"
  elif [ "$verdict" = "request_changes" ]; then
    die_infra "inconsistent verdict: request_changes with zero blockers"
  else
    die_infra "verdict field not approve/request_changes (got '$verdict')"
  fi

  # COVERAGE FAIL-CLOSED (Tier 2, prepr/prepr-delta only): if the coverage accounting
  # left ANY branch-diff file unreviewed (neither reviewed-now, nor prior-hash-matched,
  # nor scratch-excluded), approval is IMPOSSIBLE. Downgrade away from APPROVE to a
  # fail-closed OVERFLOW-style surface (distinct, actionable) BEFORE we emit APPROVE.
  if [ "$outcome" = "APPROVE" ] && [ "${UNREVIEWED_COUNT:-0}" -gt 0 ]; then
    emit_overflow "coverage gap: ${UNREVIEWED_COUNT} file(s) unaccounted (neither reviewed-now nor prior-hash-matched nor scratch-excluded); refusing to approve — re-run after the gap is reviewed${COVERAGE_JSON:+ (coverage $COVERAGE_JSON)}"
  fi

  # On a clean APPROVE, record the reviewed surface in the ledger (opt-in modes only).
  if [ "$outcome" = "APPROVE" ] && [ -n "$ledger_mode" ]; then
    ledger_append "$ledger_mode" "$summary"
  fi

  # Emit the status line. The optional `coverage` object is ADDITIVE (only present for
  # prepr/prepr-delta, which set $COVERAGE_JSON); existing consumers see the same fields.
  if [ -n "${COVERAGE_JSON:-}" ]; then
    jq -nc \
      --arg outcome "$outcome" \
      --arg threadId "${THREAD_ID:-}" \
      --argjson round "${ROUND:-1}" \
      --arg verdictPath "$VERDICT_FILE" \
      --arg runDir "$RUN_DIR" \
      --argjson blockers "${nblockers:-0}" \
      --argjson agentFixableBlockers "${nfix:-0}" \
      --argjson decisionBlockers "${ndecision:-0}" \
      --argjson coverage "$COVERAGE_JSON" \
      --arg summary "$summary" \
      '{outcome:$outcome, threadId:$threadId, round:$round, verdictPath:$verdictPath,
        runDir:$runDir, blockers:$blockers, agentFixableBlockers:$agentFixableBlockers,
        decisionBlockers:$decisionBlockers, coverage:$coverage, summary:$summary}'
  else
    jq -nc \
      --arg outcome "$outcome" \
      --arg threadId "${THREAD_ID:-}" \
      --argjson round "${ROUND:-1}" \
      --arg verdictPath "$VERDICT_FILE" \
      --arg runDir "$RUN_DIR" \
      --argjson blockers "${nblockers:-0}" \
      --argjson agentFixableBlockers "${nfix:-0}" \
      --argjson decisionBlockers "${ndecision:-0}" \
      --arg summary "$summary" \
      '{outcome:$outcome, threadId:$threadId, round:$round, verdictPath:$verdictPath,
        runDir:$runDir, blockers:$blockers, agentFixableBlockers:$agentFixableBlockers,
        decisionBlockers:$decisionBlockers, summary:$summary}'
  fi
}

# ----------------------------------------------------------------------------
# Map a QUESTION-mode codex result -> a GROUNDED status line. Different shape from
# emit_outcome (no verdict/blockers): the grounding either succeeds (GROUNDED) or
# the run failed (INFRA_ERROR). Fails closed EXACTLY like emit_outcome: nonzero
# codex exit / missing-empty / invalid-JSON -o file => die_infra. On success emits:
#   {outcome:"GROUNDED", threadId, round, verdictPath, runDir, settledByCanon,
#    recommendation, summary}
# where settledByCanon/recommendation come from the grounding file and summary is
# its .rationale. (No verdict/approve mapping — a grounding is advisory, not a gate.)
# ----------------------------------------------------------------------------
emit_question_outcome() {
  parse_thread_id

  # Fail closed on nonzero exit. A context-window overflow is a DISTINCT outcome.
  if [ "${CODEX_EXIT:-1}" -ne 0 ]; then
    classify_nonzero_exit
  fi
  # Grounding file must exist, be non-empty, and be valid JSON.
  if [ ! -s "$VERDICT_FILE" ]; then
    die_infra "grounding file missing or empty ($VERDICT_FILE)"
  fi
  if ! jq -e . "$VERDICT_FILE" >/dev/null 2>&1; then
    die_infra "grounding file is not valid JSON ($VERDICT_FILE)"
  fi

  local settled recommendation summary
  # settledByCanon is a boolean in the schema; default to false if absent/null.
  settled="$(jq -r 'if .settledByCanon == true then "true" else "false" end' "$VERDICT_FILE" 2>/dev/null)"
  [ "$settled" = "true" ] || settled="false"
  recommendation="$(jq -r '.recommendation // ""' "$VERDICT_FILE" 2>/dev/null)"
  summary="$(jq -r '.rationale // ""' "$VERDICT_FILE" 2>/dev/null)"

  jq -nc \
    --arg outcome "GROUNDED" \
    --arg threadId "${THREAD_ID:-}" \
    --argjson round "${ROUND:-1}" \
    --arg verdictPath "$VERDICT_FILE" \
    --arg runDir "$RUN_DIR" \
    --argjson settledByCanon "$settled" \
    --arg recommendation "$recommendation" \
    --arg summary "$summary" \
    '{outcome:$outcome, threadId:$threadId, round:$round, verdictPath:$verdictPath,
      runDir:$runDir, settledByCanon:$settledByCanon, recommendation:$recommendation,
      summary:$summary}'
}

# ----------------------------------------------------------------------------
# Map an INVESTIGATE-mode codex result -> a status line. Different shape again: the
# model reports one of root_cause_found | needs_more_evidence | unsafe_or_blocked; the
# WRAPPER adds INFRA_ERROR / OVERFLOW on top (nonzero exit / context-window / bad JSON),
# exactly like the review + question modes (the model can't reliably self-report that it
# overflowed). Fails closed identically. Emits:
#   {outcome, threadId, round, verdictPath, runDir, confidence, nextSafeProbe, summary}
# where outcome is the UPPERCASED status (ROOT_CAUSE_FOUND | NEEDS_MORE_EVIDENCE |
# UNSAFE_OR_BLOCKED | INFRA_ERROR | OVERFLOW) and summary is the rootCause (when found)
# else the nextSafeProbe / blocking reason. The full report (evidence, hypothesesTested,
# commandsRun, forbiddenActionsAvoided, minimalFix) stays in the verdict file (verdictPath),
# like blockers[] for review. Investigation NEVER writes the ledger (no approved surface).
# ----------------------------------------------------------------------------
emit_investigate_outcome() {
  parse_thread_id

  # Fail closed on nonzero exit. A context-window overflow is a DISTINCT outcome.
  if [ "${CODEX_EXIT:-1}" -ne 0 ]; then
    classify_nonzero_exit
  fi
  # Report file must exist, be non-empty, and be valid JSON.
  if [ ! -s "$VERDICT_FILE" ]; then
    die_infra "investigation report missing or empty ($VERDICT_FILE)"
  fi
  if ! jq -e . "$VERDICT_FILE" >/dev/null 2>&1; then
    die_infra "investigation report is not valid JSON ($VERDICT_FILE)"
  fi

  local model_outcome outcome rootCause confidence nextSafeProbe summary
  model_outcome="$(jq -r '.outcome // empty' "$VERDICT_FILE" 2>/dev/null)"
  rootCause="$(jq -r '.rootCause // ""' "$VERDICT_FILE" 2>/dev/null)"
  confidence="$(jq -r '.confidence // ""' "$VERDICT_FILE" 2>/dev/null)"
  nextSafeProbe="$(jq -r '.nextSafeProbe // ""' "$VERDICT_FILE" 2>/dev/null)"

  # Map the model-reported outcome to the UPPERCASE status convention. Any other value
  # is a schema/contract violation -> fail closed to INFRA_ERROR (never invent a
  # conclusion). INFRA_ERROR / OVERFLOW were already handled above (wrapper-owned).
  case "$model_outcome" in
    root_cause_found)    outcome="ROOT_CAUSE_FOUND";    summary="$rootCause" ;;
    needs_more_evidence) outcome="NEEDS_MORE_EVIDENCE"; summary="$nextSafeProbe" ;;
    unsafe_or_blocked)   outcome="UNSAFE_OR_BLOCKED";   summary="${rootCause:-$nextSafeProbe}" ;;
    *) die_infra "investigation outcome not root_cause_found/needs_more_evidence/unsafe_or_blocked (got '$model_outcome')" ;;
  esac
  # summary fallback so the status line is never blank.
  [ -n "$summary" ] || summary="$model_outcome"

  jq -nc \
    --arg outcome "$outcome" \
    --arg threadId "${THREAD_ID:-}" \
    --argjson round "${ROUND:-1}" \
    --arg verdictPath "$VERDICT_FILE" \
    --arg runDir "$RUN_DIR" \
    --arg confidence "$confidence" \
    --arg nextSafeProbe "$nextSafeProbe" \
    --arg summary "$summary" \
    '{outcome:$outcome, threadId:$threadId, round:$round, verdictPath:$verdictPath,
      runDir:$runDir, confidence:$confidence, nextSafeProbe:$nextSafeProbe, summary:$summary}'
}

# ----------------------------------------------------------------------------
# Set per-round output file paths (absolute, under run dir).
# ----------------------------------------------------------------------------
set_round_paths() {
  VERDICT_FILE="$RUN_DIR/round-${ROUND}-verdict.json"
  JSONL_FILE="$RUN_DIR/round-${ROUND}.jsonl"
  STDERR_FILE="$RUN_DIR/round-${ROUND}.stderr"
}

# ============================================================================
# MODE: phase-start
# ============================================================================
mode_phase_start() {
  local phaseId="${1:-}"
  [ -n "$phaseId" ] || { echo "phase-start requires <phaseId>" >&2; exit 2; }
  resolve_repo
  [ -n "${REPO_ROOT:-}" ] || { echo "phase-start must run inside a git repo" >&2; exit 2; }
  resolve_run_dir "$phaseId"
  mkdir -p "$RUN_DIR/snapshot"

  PHASE_HEAD="$(git rev-parse HEAD 2>/dev/null)"
  [ -n "$PHASE_HEAD" ] || { echo "could not resolve HEAD" >&2; exit 2; }

  # Build candidate phase-start set = tracked-dirty ∪ filtered untracked-source.
  local cand="$RUN_DIR/.phase-start-candidates"
  {
    git diff --name-only HEAD 2>/dev/null
    filtered_untracked
  } | LC_ALL=C sort -u > "$cand"

  # Build snapshot.json entries. Use a temp jq array assembled incrementally.
  local entries="$RUN_DIR/.entries.jsonl"
  : > "$entries"
  local p kind
  while IFS= read -r p; do
    [ -n "$p" ] || continue
    if is_excluded "$p"; then continue; fi
    if [ -f "$REPO_ROOT/$p" ]; then
      # copy contents preserving subdirs
      mkdir -p "$RUN_DIR/snapshot/$(dirname "$p")"
      cp "$REPO_ROOT/$p" "$RUN_DIR/snapshot/$p"
      kind="snapshot"
    else
      # tracked path already deleted in working tree at phase-start
      kind="deleted"
    fi
    jq -nc --arg path "$p" --arg baselineKind "$kind" '{path:$path, baselineKind:$baselineKind}' >> "$entries"
  done < "$cand"

  # Assemble snapshot.json
  jq -nc \
    --arg phaseHead "$PHASE_HEAD" \
    --arg repoRoot "$REPO_ROOT" \
    --slurpfile entries "$entries" \
    '{phaseHead:$phaseHead, repoRoot:$repoRoot, entries:$entries}' > "$RUN_DIR/snapshot.json"

  rm -f "$cand" "$entries"

  printf 'RUNDIR=%s\n' "$RUN_DIR"
  printf 'PHASE_HEAD=%s\n' "$PHASE_HEAD"
}

# ============================================================================
# MODE: phase-review
# ============================================================================
mode_phase_review() {
  local phaseId="${1:-}"
  ROUND="${2:-1}"
  THREAD_ID_IN="${3:-}"
  [ -n "$phaseId" ] || { echo "phase-review requires <phaseId>" >&2; exit 2; }
  resolve_repo
  [ -n "${REPO_ROOT:-}" ] || { echo "phase-review must run inside a git repo" >&2; exit 2; }
  resolve_run_dir "$phaseId"
  [ -f "$RUN_DIR/snapshot.json" ] || { echo "no snapshot.json at $RUN_DIR — run phase-start first" >&2; exit 2; }
  set_round_paths

  PHASE_HEAD="$(jq -r '.phaseHead' "$RUN_DIR/snapshot.json")"
  [ -n "$PHASE_HEAD" ] && [ "$PHASE_HEAD" != "null" ] || { echo "snapshot.json missing phaseHead" >&2; exit 2; }

  # Candidate set = diff vs PHASE_HEAD ∪ current filtered untracked ∪ snapshot paths.
  local cand="$RUN_DIR/.review-candidates.$ROUND"
  {
    git diff --name-only "$PHASE_HEAD" 2>/dev/null
    filtered_untracked
    jq -r '.entries[].path' "$RUN_DIR/snapshot.json"
  } | LC_ALL=C sort -u > "$cand"

  # Build the assembled --no-index diff + a parallel "changed paths" list.
  local diff_out="$RUN_DIR/.diff.$ROUND"
  local changed="$RUN_DIR/.changed.$ROUND"
  : > "$diff_out"
  : > "$changed"

  local p baselineKind snap_entry baseline current tmp_base
  local snapdir="$RUN_DIR/snapshot"
  while IFS= read -r p; do
    [ -n "$p" ] || continue
    if is_excluded "$p"; then continue; fi

    # Determine the snapshot baselineKind for this path (if any).
    baselineKind="$(jq -r --arg p "$p" '.entries[] | select(.path==$p) | .baselineKind' "$RUN_DIR/snapshot.json" 2>/dev/null | head -1)"

    # ---- choose baseline ----
    tmp_base=""  # if we materialize a baseline via git show, track for cleanup
    if [ "$baselineKind" = "snapshot" ]; then
      baseline="$snapdir/$p"
      [ -f "$baseline" ] || baseline="/dev/null"
    elif [ "$baselineKind" = "deleted" ]; then
      baseline="/dev/null"
    else
      # not in snapshot => clean at phase-start (or brand-new). Use git show
      # PHASE_HEAD:path if it existed there, else /dev/null (new file).
      if git cat-file -e "${PHASE_HEAD}:${p}" 2>/dev/null; then
        tmp_base="$RUN_DIR/.base.$ROUND.$(sha1_short "$p")"
        git show "${PHASE_HEAD}:${p}" > "$tmp_base" 2>/dev/null
        baseline="$tmp_base"
      else
        baseline="/dev/null"
      fi
    fi

    # ---- choose current ----
    if [ -f "$REPO_ROOT/$p" ]; then
      current="$REPO_ROOT/$p"
    else
      current="/dev/null"
    fi

    # Skip pairs where both sides are /dev/null (e.g. a snapshot 'deleted' that
    # is still absent now => a pre-existing deletion; must NOT be re-reported).
    if [ "$baseline" = "/dev/null" ] && [ "$current" = "/dev/null" ]; then
      [ -n "$tmp_base" ] && rm -f "$tmp_base"
      continue
    fi

    # Emit the per-file diff. --no-index exits 1 when files differ (expected).
    # Use stable a/b labels so the path is always legible regardless of /dev/null side.
    local diff_chunk
    diff_chunk="$(git diff --no-index --src-prefix="phasestart/$p/" --dst-prefix="current/$p/" "$baseline" "$current" 2>/dev/null)"
    if [ -n "$diff_chunk" ]; then
      printf '%s\n' "$diff_chunk" >> "$diff_out"
      printf '%s\n' "$p" >> "$changed"
    fi
    [ -n "$tmp_base" ] && rm -f "$tmp_base"
  done < "$cand"

  # Assemble the packet. Reviewer-instructions FIRST, then the phase intent /
  # acceptance / review context (so Codex can judge whether this phase did the
  # intended work), then the manifest + scoped diff, then full file contents.
  local packet="$RUN_DIR/.packet.$ROUND"
  cat "$INSTRUCTIONS_FILE" > "$packet"
  append_context_if_present "$packet"
  {
    build_manifest "$changed"
    printf '\n===== ARTIFACT UNDER REVIEW (scoped diff vs phase-start %s) =====\n' "$PHASE_HEAD"
    if [ -s "$diff_out" ]; then
      cat "$diff_out"
    else
      printf '(no changes detected in this phase)\n'
    fi
    printf '===== END DIFF =====\n'
  } >> "$packet"
  append_file_contents code "$changed" "$packet"

  # Pre-flight budget guard: if the assembled packet is too large for one review,
  # emit OVERFLOW and never invoke Codex (hunks are never dropped; fail closed).
  enforce_packet_budget "$packet"

  run_codex code "$packet" "$REPO_ROOT"

  # Ledger participation (Tier 2): an APPROVE'd phase-review records the reviewed
  # surface (the $changed list) at the phase-start ref. emit_outcome appends ONLY on
  # APPROVE; the reviewed paths + ref are handed via globals.
  LEDGER_REF="$PHASE_HEAD"
  cp "$changed" "$RUN_DIR/.reviewed-paths" 2>/dev/null || : > "$RUN_DIR/.reviewed-paths"

  rm -f "$cand" "$diff_out" "$changed" "$packet"
  emit_outcome phase-review
}

# ============================================================================
# MODE: plan  (DOC tier)
# ============================================================================
mode_plan() {
  local file="${1:-}"
  ROUND="${2:-1}"
  THREAD_ID_IN="${3:-}"
  [ -n "$file" ] || { echo "plan requires <file>" >&2; exit 2; }
  [ -f "$file" ] || { echo "plan file not found: $file" >&2; exit 2; }
  resolve_repo   # in a repo -> CODE tier (read repo canon); else DOC tier
  resolve_run_dir "plan-$(basename "$file")"
  set_round_paths
  mkdir -p "$RUN_DIR"

  local packet="$RUN_DIR/.packet.$ROUND"
  {
    cat "$INSTRUCTIONS_FILE"
    # When in a repo, emit the repo-root guidance manifest so Codex can read repo
    # canon during pre-plan review. There is no changed-file set for a plan, so
    # pass a throwaway empty list (build_manifest still emits the repo-root docs).
    if [ -n "${REPO_ROOT:-}" ]; then
      local changed_empty="$RUN_DIR/.plan-changed.$ROUND"
      : > "$changed_empty"
      build_manifest "$changed_empty"
      rm -f "$changed_empty"
    fi
    printf '\n===== ARTIFACT UNDER REVIEW (plan document) =====\n'
    cat "$file"
    printf '\n===== END PLAN =====\n'
  } > "$packet"
  append_context_if_present "$packet"

  # Pre-flight budget guard: over budget => OVERFLOW, never invoke Codex.
  enforce_packet_budget "$packet"

  # CODE tier when in a repo (so the reviewer can cross-check canon via shell);
  # if not in a repo, fall back to DOC tier (neutral run-dir cwd, shell OFF).
  if [ -n "${REPO_ROOT:-}" ]; then
    run_codex code "$packet" "$REPO_ROOT"
  else
    run_codex doc "$packet" "$RUN_DIR"
  fi
  rm -f "$packet"
  emit_outcome
}

# ============================================================================
# MODE: bundle  (CODE tier — reviewer needs repo canon)
# ============================================================================
mode_bundle() {
  local dir="${1:-}"
  ROUND="${2:-1}"
  THREAD_ID_IN="${3:-}"
  [ -n "$dir" ] || { echo "bundle requires <dir>" >&2; exit 2; }
  [ -d "$dir" ] || { echo "bundle dir not found: $dir" >&2; exit 2; }
  resolve_repo
  resolve_run_dir "bundle-$(basename "$dir")"
  set_round_paths
  mkdir -p "$RUN_DIR"

  local packet="$RUN_DIR/.packet.$ROUND"
  cat "$INSTRUCTIONS_FILE" > "$packet"
  append_context_if_present "$packet"
  {
    # bundle is doc content but reviewed at CODE tier so Codex can read canon.
    if [ -n "${REPO_ROOT:-}" ]; then
      local changed_dummy="$RUN_DIR/.bundle-changed.$ROUND"
      # List the bundle docs as "changed", as paths RELATIVE TO $REPO_ROOT, so
      # build_manifest's ancestor walk ($REPO_ROOT/$d/...) resolves correctly and picks up
      # AGENTS.md/CLAUDE.md in the bundle dir + its ancestors (not just the repo root).
      : > "$changed_dummy"
      find "$dir" -type f -name '*.md' 2>/dev/null | while IFS= read -r f; do
        [ -n "$f" ] || continue
        abs="$(cd "$(dirname "$f")" 2>/dev/null && pwd -P)/$(basename "$f")"
        case "$abs" in
          "$REPO_ROOT"/*) printf '%s\n' "${abs#"$REPO_ROOT"/}" >> "$changed_dummy" ;;
        esac
      done
      build_manifest "$changed_dummy"
      rm -f "$changed_dummy"
    fi
    printf '\n===== ARTIFACT UNDER REVIEW (PDR/ADR/plan bundle docs under %s) =====\n' "$dir"
    local f
    find "$dir" -type f -name '*.md' | LC_ALL=C sort | while IFS= read -r f; do
      printf -- '--- %s ---\n' "$f"
      cat "$f"
      printf '\n'
    done
    printf '===== END BUNDLE =====\n'
  } >> "$packet"

  # Pre-flight budget guard: over budget => OVERFLOW, never invoke Codex.
  enforce_packet_budget "$packet"

  # CODE tier when in a repo (so the reviewer can read ADRs/canon via shell);
  # if not in a repo, fall back to doc tier.
  if [ -n "${REPO_ROOT:-}" ]; then
    run_codex code "$packet" "$REPO_ROOT"
  else
    run_codex doc "$packet" "$RUN_DIR"
  fi
  rm -f "$packet"
  emit_outcome
}

# ============================================================================
# MODE: question  (CODE tier in a repo; DOC tier fallback) — GROUND a decision
# ----------------------------------------------------------------------------
# Grounds an architecture/feature DECISION through Codex BEFORE Claude puts it to
# the human (AskUserQuestion). <file> is a text/markdown file the caller wrote
# containing the decision (DECISION / CONTEXT / OPTIONS). Mirrors mode_bundle's
# packet shape: question-instructions persona, then context.md (if any), then the
# repo-root guidance manifest (so Codex reads AGENTS.md/CLAUDE.md), then the
# decision file. Uses question.schema.json (NOT verdict.schema.json) via the
# SCHEMA_OVERRIDE knob. Emits a GROUNDED status (advisory), never APPROVE/BLOCK.
# ============================================================================
mode_question() {
  local file="${1:-}"
  ROUND="${2:-1}"
  THREAD_ID_IN="${3:-}"
  [ -n "$file" ] || { echo "question requires <file>" >&2; exit 2; }
  [ -f "$file" ] || { echo "question file not found: $file" >&2; exit 2; }
  resolve_repo   # in a repo -> CODE tier (read repo canon); else DOC tier
  resolve_run_dir "question-$(basename "$file")"
  set_round_paths
  mkdir -p "$RUN_DIR"

  local packet="$RUN_DIR/.packet.$ROUND"
  cat "$SKILL_DIR/question-instructions.md" > "$packet"
  append_context_if_present "$packet"
  {
    # When in a repo, emit the repo-root guidance manifest so Codex can read repo
    # canon while grounding. There is no changed-file set for a decision, so pass a
    # throwaway empty list (build_manifest still emits the repo-root docs) — same as
    # mode_bundle / mode_plan do.
    if [ -n "${REPO_ROOT:-}" ]; then
      local changed_empty="$RUN_DIR/.question-changed.$ROUND"
      : > "$changed_empty"
      build_manifest "$changed_empty"
      rm -f "$changed_empty"
    fi
    printf '\n===== DECISION TO GROUND =====\n'
    cat "$file"
    printf '\n===== END DECISION =====\n'
  } >> "$packet"

  # Pre-flight budget guard: over budget => OVERFLOW, never invoke Codex.
  enforce_packet_budget "$packet"

  # Pin THIS mode's output schema to question.schema.json (not verdict.schema.json).
  # Scope it to this run_codex call so other modes are unaffected.
  SCHEMA_OVERRIDE="$SKILL_DIR/question.schema.json"

  # CODE tier when in a repo (so Codex can ground in the real code via shell);
  # DOC tier fallback when not in a repo (neutral run-dir cwd, shell OFF).
  if [ -n "${REPO_ROOT:-}" ]; then
    run_codex code "$packet" "$REPO_ROOT"
  else
    run_codex doc "$packet" "$RUN_DIR"
  fi
  unset SCHEMA_OVERRIDE
  rm -f "$packet"
  emit_question_outcome
}

# ============================================================================
# MODE: investigate  (CODE tier in a repo; DOC tier fallback) — ROOT-CAUSE a bug
# ----------------------------------------------------------------------------
# A SIBLING of the review gate, NOT a review: it answers "what is the proven root cause
# + the smallest safe fix?" — never APPROVE/BLOCK, and never auto-fixes. <file> is a
# text/markdown BRIEF the caller wrote (the bug, the environment, the symptom, the facts
# already established, the live hypotheses, AND a SAFETY section listing ALLOWED /
# FORBIDDEN probes). The DRIVER loops: round 1 (start) -> read the report -> if
# needs_more_evidence, run the SAFE nextSafeProbe + append its output to
# <RUNDIR>/evidence.md -> resume (probe) -> ... -> root_cause_found / unsafe_or_blocked
# (report). Mirrors mode_question's packet shape (persona, then context.md, then the
# repo-root guidance manifest, then the brief) PLUS the driver-supplied evidence, and
# pins investigate.schema.json via SCHEMA_OVERRIDE. CODE tier so Codex can inspect the
# repo + supplied logs via the read-only shell — but the SAFETY contract (persona +
# brief), NOT the sandbox alone, is what gates side-effectful probes. NEVER ledgers.
# ============================================================================
mode_investigate() {
  local file="${1:-}"
  ROUND="${2:-1}"
  THREAD_ID_IN="${3:-}"
  [ -n "$file" ] || { echo "investigate requires <brief-file>" >&2; exit 2; }
  [ -f "$file" ] || { echo "investigate brief not found: $file" >&2; exit 2; }
  local persona="$SKILL_DIR/investigate-instructions.md"
  local invschema="$SKILL_DIR/investigate.schema.json"
  [ -f "$persona" ]   || { echo "missing investigate persona: $persona" >&2; exit 2; }
  [ -f "$invschema" ] || { echo "missing investigate schema: $invschema" >&2; exit 2; }
  resolve_repo   # in a repo -> CODE tier (read-only shell); else DOC tier
  resolve_run_dir "investigate-$(basename "$file")"
  set_round_paths
  mkdir -p "$RUN_DIR"

  local packet="$RUN_DIR/.packet.$ROUND"
  cat "$persona" > "$packet"
  append_context_if_present "$packet"
  {
    # When in a repo, emit the repo-root guidance manifest so Codex can read repo canon
    # during the investigation (same throwaway-empty-changed trick as bundle/plan/question).
    if [ -n "${REPO_ROOT:-}" ]; then
      local changed_empty="$RUN_DIR/.investigate-changed.$ROUND"
      : > "$changed_empty"
      build_manifest "$changed_empty"
      rm -f "$changed_empty"
    fi
    printf '\n===== INVESTIGATION BRIEF =====\n'
    cat "$file"
    printf '\n===== END BRIEF =====\n'
    # Evidence the DRIVER gathered between rounds (SAFE probe outputs only). Folded in
    # every round when present; on a resume round this is how NEW evidence reaches Codex.
    if [ -f "$RUN_DIR/evidence.md" ]; then
      printf '\n===== EVIDENCE GATHERED SO FAR (driver-supplied; safe probes only) =====\n'
      cat "$RUN_DIR/evidence.md"
      printf '\n===== END EVIDENCE =====\n'
    fi
  } >> "$packet"

  # Pre-flight budget guard: over budget => OVERFLOW, never invoke Codex.
  enforce_packet_budget "$packet"

  # Pin THIS mode's output schema to investigate.schema.json (not verdict.schema.json).
  SCHEMA_OVERRIDE="$invschema"

  # CODE tier when in a repo (read-only shell so Codex can inspect the repo + logs);
  # DOC tier fallback when not in a repo (neutral run-dir cwd, shell OFF).
  if [ -n "${REPO_ROOT:-}" ]; then
    run_codex code "$packet" "$REPO_ROOT"
  else
    run_codex doc "$packet" "$RUN_DIR"
  fi
  unset SCHEMA_OVERRIDE
  rm -f "$packet"
  emit_investigate_outcome
}

# ============================================================================
# MODE: prepr / prepr-delta  (CODE tier) — whole-branch review (delta=since-reviewed)
# ----------------------------------------------------------------------------
# _prepr_common <delta:0|1> [base] [round] [threadId]
#   delta=0 (prepr): review the WHOLE branch diff (tracked diff vs base ∪ untracked source).
#   delta=1 (prepr-delta): SCOPE the reviewed set to only files whose CURRENT git
#     hash-object is NOT recorded as an approved-reviewed sha for that path in the ledger
#     (unreviewed OR changed-since-reviewed). Files whose hash still matches an approved
#     review are SKIPPED and listed (path + sha + verdict ref) in an explicit
#     "ALREADY REVIEWED & UNCHANGED" section — proof, not silent omission. If the delta
#     candidate set is EMPTY, APPROVE without calling Codex (+ a coverage manifest).
# Both set a `coverage` object {reviewedNow, priorHashMatch, excludedPolicy, unreviewed}
# and fail closed if unreviewed>0 (coverage gap => no approve).
# ============================================================================
# ----------------------------------------------------------------------------
# Compute the untracked subset of a reviewed-now set (paths in <changed> that are
# also currently-untracked source). Writes one path per line to <dest-untracked>.
# Shared by the whole-branch packet and each per-shard packet (Tier 3).
# ----------------------------------------------------------------------------
prepr_untracked_subset() { # <changed-file> <dest-untracked-file>
  local changed="$1" dest="$2"
  {
    filtered_untracked | while IFS= read -r u; do
      [ -n "$u" ] || continue
      if grep -Fxq "$u" "$changed" 2>/dev/null; then printf '%s\n' "$u"; fi
    done
  } | LC_ALL=C sort -u > "$dest"
}

# ----------------------------------------------------------------------------
# Assemble a prepr/prepr-delta packet for a GIVEN reviewed-now set. Identical packet
# shape as the whole-branch review (reviewer-instructions + context + manifest + scoped
# diff hunks + lean bodies + the delta proof) — only the file SET differs. The per-shard
# loop reuses this with a shard-filtered <changed> so each shard's packet is lean and
# self-contained (diff hunks for ONLY that shard's files; NEVER drops hunks for them).
#   <dest-packet> <changed-file> <untracked-list> <base> <delta:0|1> <skipped-file> [instr-file]
# The OPTIONAL trailing [instr-file] lets a future multi-lens caller pick a per-job persona
# without mutating $INSTRUCTIONS_FILE; absent/empty => $INSTRUCTIONS_FILE (existing callers unchanged).
# Reads $INSTRUCTIONS_FILE, $RUN_DIR, $ROUND, $REPO_ROOT.
# ----------------------------------------------------------------------------
build_prepr_packet() { # <dest-packet> <changed> <untracked> <base> <delta> <skipped> [instr-file]
  local packet="$1" changed="$2" untracked_list="$3" base="$4" delta="$5" skipped="$6"
  # OPTIONAL trailing arg: the persona/instruction file to use for THIS packet. A future
  # multi-lens caller supplies a different persona per job WITHOUT mutating the global;
  # absent/empty => default to $INSTRUCTIONS_FILE, so existing callers are byte-unchanged.
  local instr_file="${7:-}"; [ -n "$instr_file" ] || instr_file="$INSTRUCTIONS_FILE"
  # FAIL CLOSED: the reviewer persona (HARD INVARIANTS: one-JSON-object, read-only, verdict rules)
  # MUST be present. Without `set -e`, a missing/unreadable instr file would make `cat` fail, leave
  # the packet persona-LESS, then still append the diff and invoke Codex — a fail-OPEN review with no
  # invariants. Guard before the write (matters most for the per-lens seam, where a mis-named lens
  # persona would otherwise slip through). die_infra emits INFRA_ERROR + exits (no Codex call).
  [ -r "$instr_file" ] || die_infra "reviewer instruction file not readable: $instr_file — refusing to build a persona-less review packet (fail-closed)"
  cat "$instr_file" > "$packet" || die_infra "failed writing reviewer instructions into the packet from $instr_file (fail-closed)"
  append_context_if_present "$packet"
  {
    build_manifest "$changed"
    if [ "$delta" = "1" ]; then
      printf '\n===== ARTIFACT UNDER REVIEW (SINCE-REVIEWED delta vs %s — only unreviewed/changed-since-reviewed files) =====\n' "$base"
    else
      printf '\n===== ARTIFACT UNDER REVIEW (git diff vs %s) =====\n' "$base"
    fi
    # The tracked diff, RESTRICTED to the reviewed-now paths so a delta does not re-send
    # already-reviewed hunks. (prepr's reviewed-now set is the whole diff, so this is the
    # full diff there.) Pathspec-scoped to the reviewed-now tracked files.
    local tracked_now="$RUN_DIR/.tracked-now.$ROUND.$$"
    : > "$tracked_now"
    local p
    while IFS= read -r p; do
      [ -n "$p" ] || continue
      # a path is "tracked" for diff purposes if it is NOT in the untracked list
      if ! grep -Fxq "$p" "$untracked_list" 2>/dev/null; then printf '%s\n' "$p" >> "$tracked_now"; fi
    done < "$changed"
    if [ -s "$tracked_now" ]; then
      # feed the reviewed-now tracked paths as pathspecs to a single git diff
      local -a paths=()
      while IFS= read -r p; do [ -n "$p" ] && paths+=( "$p" ); done < "$tracked_now"
      if [ "${#paths[@]}" -gt 0 ]; then
        git -C "$REPO_ROOT" diff "$base" -- "${paths[@]}" 2>/dev/null
      fi
    fi
    rm -f "$tracked_now"
    # Append each reviewed-now untracked source file as a /dev/null-baseline diff.
    if [ -s "$untracked_list" ]; then
      local u
      while IFS= read -r u; do
        [ -n "$u" ] || continue
        [ -f "$REPO_ROOT/$u" ] || continue
        git -C "$REPO_ROOT" diff --no-index -- /dev/null "$u" 2>/dev/null
      done < "$untracked_list"
    fi
    printf '\n===== END DIFF =====\n'

    # DELTA proof: the already-reviewed-&-unchanged surface, listed explicitly (NOT silent).
    if [ "$delta" = "1" ]; then
      printf '\n===== ALREADY REVIEWED & UNCHANGED (out of scope this pass) =====\n'
      if [ -n "$skipped" ] && [ -s "$skipped" ]; then
        # each line: path<TAB>sha<TAB>verdictRef -> "path  sha  (verdict: <ref>)"
        while IFS="$(printf '\t')" read -r sp ssha sref; do
          [ -n "$sp" ] || continue
          printf -- '%s  %s  (verdict: %s)\n' "$sp" "$ssha" "$sref"
        done < "$skipped"
      else
        printf '(none — no prior approved review matched the current hashes)\n'
      fi
      printf -- '===== END ALREADY REVIEWED =====\n'
    fi
  } >> "$packet"
  append_file_contents code "$changed" "$packet"
}

_prepr_common() {
  local delta="$1"; shift
  # --multi (anywhere in the remaining args) turns on the opt-in multi-LENS fan-out for
  # THIS run, same as CODEX_GATE_FANOUT=1 (env). Strip it out so the positional base/round/
  # threadId args are unaffected by its position. Any other flag-shaped token is left in
  # place (there are none today) so a future flag can be parsed here too.
  local multi_flag=0
  local -a _pos=()
  local _a
  for _a in "$@"; do
    case "$_a" in
      --multi) multi_flag=1 ;;
      *) _pos+=( "$_a" ) ;;
    esac
  done
  # Reassign the positionals from the flag-stripped list (bash 3.2-safe under set -u:
  # only expand the array when non-empty).
  set --
  [ "${#_pos[@]}" -gt 0 ] && set -- "${_pos[@]}"
  local base="${1:-}"
  ROUND="${2:-1}"
  THREAD_ID_IN="${3:-}"
  # Multi-lens is active iff the flag was passed OR the env knob is set. Fresh-thread only.
  local multilens=0
  { [ "$multi_flag" = "1" ] || [ "${CODEX_GATE_FANOUT:-0}" = "1" ]; } && multilens=1
  local label; [ "$delta" = "1" ] && label="prepr-delta" || label="prepr"
  resolve_repo
  [ -n "${REPO_ROOT:-}" ] || { echo "$label must run inside a git repo" >&2; exit 2; }
  resolve_run_dir "prepr"   # share the prepr run-dir namespace across both modes
  resolve_ledger_path
  set_round_paths
  mkdir -p "$RUN_DIR"

  # ultra + multi-lens fan-out refusal (fail-closed; RUN_DIR is set, so die_infra's status
  # carries proper paths). `ultra` performs its OWN automatic, model-driven task delegation
  # (observed ~3 wrapper-invisible sub-reviewers per round across a controlled sweep — 0
  # spawn_agent calls off-ultra vs ~1,060 under ultra — and descendants attempting FURTHER
  # nested delegation, stopped only by a global thread limit: 3 is a capped floor, not a
  # ceiling). Multi-lens ALSO fans out (arch/security/tests[/frontend]). Stacking them
  # multiplies reviewers — lenses × ultra's own native children — wrapper-invisible and
  # unbounded by CODEX_GATE_FANOUT_MAX_LENSES (that cap only counts OUR lenses). Refuse
  # before any codex call rather than run an unbounded review.
  # Reads the RESOLVED `$multilens` (both --multi and CODEX_GATE_FANOUT=1 already folded in
  # above — checking `$multi_flag` alone would leave the env-only path wide open) and the
  # RESOLVED `$CODEX_GATE_EFFORT` (a plain global var assigned once at the top of this file;
  # by the time this function runs it already reflects any env override, so
  # CODEX_GATE_EFFORT=ultra is caught the same as a hypothetical file default would be).
  # NO bypass env var is offered — two legitimate escape hatches already exist without one:
  # (1) drop --multi / unset CODEX_GATE_FANOUT and run single-lens ultra, or (2) keep
  # --multi and pick a non-delegating CODEX_GATE_EFFORT. A silent override would defeat the
  # whole point of failing closed here.
  if [ "$multilens" = "1" ] && [ "$CODEX_GATE_EFFORT" = "ultra" ]; then
    local ultra_trig=""
    [ "$multi_flag" != "1" ] || ultra_trig="--multi"
    if [ "${CODEX_GATE_FANOUT:-0}" = "1" ]; then
      if [ -n "$ultra_trig" ]; then ultra_trig="$ultra_trig and CODEX_GATE_FANOUT=1"
      else ultra_trig="CODEX_GATE_FANOUT=1"; fi
    fi
    die_infra "refusing: multi-lens fan-out ($ultra_trig) combined with CODEX_GATE_EFFORT=ultra would multiply reviewers — ultra runs its OWN automatic, wrapper-invisible sub-reviewer delegation on top of every lens this run would fan out to (unbounded by CODEX_GATE_FANOUT_MAX_LENSES). Fail-closed, ZERO codex calls. To proceed: lower CODEX_GATE_EFFORT below ultra and keep $ultra_trig, or drop $ultra_trig and run a normal single-lens ultra review."
  fi

  # Validate the packet-budget knob ONCE, before ANY size comparison downstream (the normal
  # enforce_packet_budget, the shard per-job check, AND the multi-lens over-budget preflight all
  # compare against it). A malformed value makes `[ N -gt "$CODEX_GATE_PACKET_BUDGET" ]` error and
  # fall through (fail OPEN — invoke codex). Fail closed instead. (RUN_DIR is set, so die_infra's
  # status carries proper paths.)
  case "$CODEX_GATE_PACKET_BUDGET" in
    ''|*[!0-9]*) die_infra "CODEX_GATE_PACKET_BUDGET must be a non-negative integer (got '$CODEX_GATE_PACKET_BUDGET') — fail-closed, no codex invoked" ;;
  esac

  if [ -z "$base" ]; then
    # --verify on the HEAD~1 fallback so a single-commit repo yields EMPTY stdout (and
    # falls through to HEAD) instead of leaking the unresolved literal "HEAD~1" — the
    # bare `git rev-parse HEAD~1` prints its arg + exits nonzero, but $() still captures
    # that stdout, defeating the `[ -n "$base" ]` guard.
    base="$(git merge-base HEAD '@{upstream}' 2>/dev/null \
        || git merge-base HEAD origin/HEAD 2>/dev/null \
        || git rev-parse --verify HEAD~1 2>/dev/null)"
  fi
  [ -n "$base" ] || base="$(git rev-parse HEAD 2>/dev/null)"

  # ---- the FULL branch candidate set (shared machinery): tracked diff vs base ∪
  #      filtered untracked source. is_excluded already strips scratch from both. ----
  local allcand="$RUN_DIR/.allcand.$ROUND"
  {
    git diff --name-only "$base" 2>/dev/null | while IFS= read -r p; do
      [ -n "$p" ] || continue
      if is_excluded "$p"; then continue; fi
      printf '%s\n' "$p"
    done
    filtered_untracked
  } | LC_ALL=C sort -u > "$allcand"

  # ---- excludedPolicy count: branch-diff files dropped by the scratch policy ----
  local n_excluded=0 p
  while IFS= read -r p; do
    [ -n "$p" ] || continue
    if is_excluded "$p"; then n_excluded=$((n_excluded + 1)); fi
  done < <(git diff --name-only "$base" 2>/dev/null)

  # ---- partition the candidate set into reviewed-now vs prior-hash-matched ----
  # For delta=1: a file is SKIPPED (prior-hash-match) iff its current hash-object is in
  # the ledger's approved shas for that path. Otherwise it is reviewed-now. For delta=0:
  # every candidate is reviewed-now (priorHashMatch=0). A test seam,
  # CODEX_GATE_FORCE_UNREVIEWED, simulates a coverage gap (a candidate that is neither
  # reviewed-now nor prior-hash-matched nor excluded) so fail-closed can be exercised.
  local changed="$RUN_DIR/.changed.$ROUND"        # the reviewed-now set (what we send Codex)
  local skipped="$RUN_DIR/.skipped.$ROUND"        # prior-hash-match set (path<TAB>sha<TAB>verdict)
  : > "$changed"; : > "$skipped"
  local n_now=0 n_prior=0 n_unreviewed=0
  local cur_sha matched s

  while IFS= read -r p; do
    [ -n "$p" ] || continue
    # current working-tree hash (deleted file -> "deleted")
    if [ -f "$REPO_ROOT/$p" ]; then
      cur_sha="$(git -C "$REPO_ROOT" hash-object -- "$p" 2>/dev/null)"
      [ -n "$cur_sha" ] || cur_sha="deleted"
    else
      cur_sha="deleted"
    fi

    if [ "$delta" = "1" ]; then
      matched=0
      # is cur_sha among the ledger-approved shas for this path?
      while IFS= read -r s; do
        [ -n "$s" ] || continue
        if [ "$s" = "$cur_sha" ]; then matched=1; break; fi
      done < <(ledger_shas_for_path "$p")
      if [ "$matched" = "1" ]; then
        local vref
        vref="$(ledger_verdict_for_path_sha "$p" "$cur_sha")"
        printf '%s\t%s\t%s\n' "$p" "$cur_sha" "${vref:-<approved>}" >> "$skipped"
        n_prior=$((n_prior + 1))
        continue
      fi
    fi
    # reviewed-now
    printf '%s\n' "$p" >> "$changed"
    n_now=$((n_now + 1))
  done < "$allcand"

  # Test-only coverage-gap seam: pretend one candidate was neither reviewed nor matched.
  if [ "${CODEX_GATE_FORCE_UNREVIEWED:-0}" -gt 0 ]; then
    n_unreviewed="$CODEX_GATE_FORCE_UNREVIEWED"
  fi

  # Coverage manifest (additive status field for prepr/prepr-delta).
  COVERAGE_JSON="$(jq -nc \
    --argjson reviewedNow "$n_now" \
    --argjson priorHashMatch "$n_prior" \
    --argjson excludedPolicy "$n_excluded" \
    --argjson unreviewed "$n_unreviewed" \
    '{reviewedNow:$reviewedNow, priorHashMatch:$priorHashMatch, excludedPolicy:$excludedPolicy, unreviewed:$unreviewed}')"
  UNREVIEWED_COUNT="$n_unreviewed"

  # ---- EMPTY delta short-circuit: everything reviewed+unchanged => APPROVE, no Codex ----
  if [ "$delta" = "1" ] && [ "$n_now" -eq 0 ] && [ "${n_unreviewed:-0}" -eq 0 ]; then
    parse_thread_id_noop
    emit_synthetic_approve \
      "all branch surface already reviewed & unchanged (${n_prior} files, hash-verified)"
    rm -f "$allcand" "$changed" "$skipped"
    return
  fi

  # ---- the untracked files among the REVIEWED-NOW set (for /dev/null-baseline diffs) ----
  local untracked_list="$RUN_DIR/.untracked.$ROUND"
  prepr_untracked_subset "$changed" "$untracked_list"

  # ---- MULTI-LENS dispatch (opt-in; MUTUALLY EXCLUSIVE with sharding) ----
  # When --multi / CODEX_GATE_FANOUT=1 is active, review the SAME reviewed-now diff through
  # several INDEPENDENT reviewer personas (arch/security/tests[/frontend]) in fresh threads
  # and aggregate deterministically. This dispatches HERE — BEFORE the whole-packet build +
  # the CODEX_GATE_SHARD=auto branch below — so multi-lens NEVER shards (every lens gets the
  # FULL diff; an over-budget lens OVERFLOWs). multi_lens_review emits the status + returns.
  if [ "$multilens" = "1" ]; then
    multi_lens_review "$changed" "$untracked_list" "$base" "$delta" "$skipped" "$label"
    rm -f "$untracked_list" "$allcand" "$changed" "$skipped"
    return
  fi

  # ---- assemble the packet (shared builder; same shape for whole-branch + per-shard) ----
  local packet="$RUN_DIR/.packet.$ROUND"
  build_prepr_packet "$packet" "$changed" "$untracked_list" "$base" "$delta" "$skipped"

  # Pre-flight budget guard. Over budget:
  #  - CODEX_GATE_SHARD=auto => SHARD by path + review each shard in its own fresh thread +
  #    aggregate DETERMINISTICALLY (fail-closed). shard_and_review emits the status + exits.
  #  - CODEX_GATE_SHARD=off  => keep the Tier-1 OVERFLOW (enforce_packet_budget emits + exits).
  # Within budget: fall through to the single whole-packet review below.
  local nchars
  nchars="$(wc -c < "$packet" 2>/dev/null | tr -d ' ')"
  [ -n "$nchars" ] || nchars=0
  if [ "$nchars" -gt "$CODEX_GATE_PACKET_BUDGET" ]; then
    if [ "$CODEX_GATE_SHARD" = "auto" ]; then
      LEDGER_REF="$base"
      shard_and_review "$changed" "$untracked_list" "$base" "$delta" "$skipped" "$label" "$nchars"
      # shard_and_review emits the aggregate status and returns; clean up + stop here.
      rm -f "$untracked_list" "$allcand" "$changed" "$skipped" "$packet"
      return
    fi
    # SHARD=off (or any non-auto value): Tier-1 fail-closed OVERFLOW (never invoke Codex).
    enforce_packet_budget "$packet"
  fi

  run_codex code "$packet" "$REPO_ROOT"

  # Ledger participation: an APPROVE'd prepr/prepr-delta records the reviewed-now surface
  # at the base ref. emit_outcome appends ONLY on APPROVE (and refuses to approve if the
  # coverage manifest reports unreviewed>0).
  LEDGER_REF="$base"
  cp "$changed" "$RUN_DIR/.reviewed-paths" 2>/dev/null || : > "$RUN_DIR/.reviewed-paths"

  rm -f "$untracked_list" "$allcand" "$changed" "$skipped" "$packet"
  emit_outcome "$label"
}

mode_prepr()       { _prepr_common 0 "$@"; }
mode_prepr_delta() { _prepr_common 1 "$@"; }

# ============================================================================
# TIER 3 — shard an over-budget prepr/prepr-delta + DETERMINISTIC aggregate
# ----------------------------------------------------------------------------
# Classify ONE shard's Codex result WITHOUT emitting a status line (the non-emitting
# sibling of emit_outcome's mapping). Reads $CODEX_EXIT + a verdict file; echoes the
# shard outcome (APPROVE|BLOCK|OVERFLOW|INFRA_ERROR). Same fail-closed rules as
# emit_outcome: nonzero-with-context-window-signature => OVERFLOW; nonzero otherwise,
# or missing/empty/invalid-JSON, or request_changes-with-zero-blockers => INFRA_ERROR;
# any blocker => BLOCK; approve + zero blockers => APPROVE. Never approves on ambiguity.
#   <verdict-file> <jsonl-file> <codex-exit>
# ----------------------------------------------------------------------------
classify_verdict_file() { # <verdict-file> <jsonl-file> <codex-exit>
  local vf="$1" jf="$2" ex="$3" verdict nb
  if [ "${ex:-1}" -ne 0 ]; then
    if [ -f "$jf" ] && grep -iE 'ran out of room|context window|"turn\.failed"' "$jf" >/dev/null 2>&1; then
      printf 'OVERFLOW'; return 0
    fi
    printf 'INFRA_ERROR'; return 0
  fi
  if [ ! -s "$vf" ] || ! jq -e . "$vf" >/dev/null 2>&1; then
    printf 'INFRA_ERROR'; return 0
  fi
  verdict="$(jq -r '.verdict // empty' "$vf" 2>/dev/null)"
  nb="$(jq -r '(.blockers // []) | length' "$vf" 2>/dev/null)"
  if [ "${nb:-0}" -gt 0 ]; then printf 'BLOCK'; return 0; fi
  if [ "$verdict" = "approve" ]; then printf 'APPROVE'; return 0; fi
  # request_changes-with-zero-blockers (degenerate) or any other value => inconclusive.
  printf 'INFRA_ERROR'; return 0
}

# ----------------------------------------------------------------------------
# GENERIC fan-out + DETERMINISTIC fail-closed aggregate (the reusable trust-critical
# core extracted from shard_and_review). Given a LIST OF JOBS, review EACH job's packet
# in its OWN FRESH thread, classify each, then aggregate with the SAME fail-closed rule
# the sharding path has always used — with NO model judgment in the trust path.
#
# A "job" is the unit that VARIES. It is one TAB-separated line in the jobs file:
#     <label>\t<files>\t<packet-path>
#   - label:  identifies the job; used for the per-job verdict filename
#             $RUN_DIR/<prefix><label>-verdict.json (prefix defaults to "shard-") and as
#             the `group` field of the per-job summary entry.
#   - files:  the file count attributed to this job (echoed as the summary `files`).
#   - packet: the ALREADY-ASSEMBLED packet to review. For the shard caller this is a
#             PATH-scoped packet; a future lens caller can hand the SAME full packet with
#             a different review instruction baked in — the helper does not care what
#             makes two jobs differ, only that each has its own packet.
#
# For each job: if the job's OWN packet exceeds $CODEX_GATE_PACKET_BUDGET it is
# inconclusive (OVERFLOW) — we do NOT invoke Codex and do NOT recurse (sub-splitting is
# out of scope); fail closed. Otherwise review it in a fresh thread (THREAD_ID_IN empty,
# ROUND=1) via run_codex, classify_verdict_file the result.
#
# Aggregate rule (fail-closed, identical to the historical shard aggregate):
#   - ANY job BLOCK              => BLOCK; union ALL jobs' blockers[]+nonBlocking[] into
#                                   $VERDICT_FILE (never drop a job's blocker).
#   - else ANY OVERFLOW/INFRA    => OVERFLOW (never APPROVE over an inconclusive job).
#   - else (ALL APPROVE)         => APPROVE.
#
# Returns via output variables (the caller composes + emits the vocabulary-specific
# status line, so the shard caller's output stays byte-identical):
#   FAN_OUTCOME            APPROVE|BLOCK|OVERFLOW
#   FAN_N_JOBS             number of jobs processed
#   FAN_TOTAL_FILES        sum of per-job `files`
#   FAN_FIRST_INCONCLUSIVE label of the first OVERFLOW/INFRA_ERROR job (else "")
#   FAN_BLOCKERS           unioned blocker count (BLOCK only; else 0)
#   FAN_AGENT_FIXABLE      unioned agent_fixable blocker count (BLOCK only; else 0)
#   FAN_DECISION_BLOCKERS  unioned decision blocker count (BLOCK only; else 0)
#   FAN_JOBS_JSON          per-job summary array (compact JSON), one object per job:
#                          {group,files,outcome,verdictPath} — field-name neutral so a
#                          lens caller can rename the container field (shards/lenses/…)
#                          when it builds its status line.
# On BLOCK the aggregate union is written to $VERDICT_FILE; on OVERFLOW/APPROVE a tiny
# audit verdict is written there too (the caller may overwrite with its own summary text).
#   <jobs-file> [verdict-file-prefix]
# ----------------------------------------------------------------------------
fan_out_and_aggregate() { # <jobs-file> [prefix]
  local jobs_file="$1" prefix="${2:-shard-}"

  # Vocabulary seam: the aggregate VERDICT-FILE .summary text is worded with these nouns.
  # Default "shard"/"shards" keeps shard_and_review's summary byte-identical; a lens caller
  # sets FAN_NOUN=lens / FAN_NOUN_PLURAL=lenses (env) to word it as "lensed review … lenses".
  local fan_noun="${FAN_NOUN:-shard}" fan_plural="${FAN_NOUN_PLURAL:-shards}"

  local jobs_jsonl="$RUN_DIR/.fan-jobs.jsonl"
  : > "$jobs_jsonl"
  local agg_blockers="$RUN_DIR/.fan-blockers.jsonl"     # unioned blockers[] across BLOCK jobs
  local agg_nonblock="$RUN_DIR/.fan-nonblocking.jsonl"  # unioned nonBlocking[]
  : > "$agg_blockers"; : > "$agg_nonblock"
  local any_block=0 any_inconclusive=0 n_jobs=0 total_files=0
  FAN_FIRST_INCONCLUSIVE=""

  local jline label files packet
  while IFS="	" read -r label files packet; do
    [ -n "$label" ] || continue
    n_jobs=$((n_jobs + 1))
    [ -n "$files" ] || files=0
    total_files=$((total_files + files))

    # per-job output files (audit) — verdict at the contract path the caller/tests assert.
    local job_verdict="$RUN_DIR/${prefix}${label}-verdict.json"
    local job_jsonl="$RUN_DIR/${prefix}${label}.jsonl"
    local job_stderr="$RUN_DIR/${prefix}${label}.stderr"

    local job_outcome job_chars
    # If THIS job's OWN packet STILL exceeds budget, it is inconclusive (OVERFLOW) — do
    # NOT silently drop it and do NOT recurse (sub-splitting is out of scope). Fail closed.
    job_chars="$(wc -c < "$packet" 2>/dev/null | tr -d ' ')"
    [ -n "$job_chars" ] || job_chars=0
    if [ "$job_chars" -gt "$CODEX_GATE_PACKET_BUDGET" ]; then
      job_outcome="OVERFLOW"
      printf '%s\n' "{\"verdict\":\"request_changes\",\"summary\":\"job $label packet $job_chars chars still exceeds budget $CODEX_GATE_PACKET_BUDGET\",\"blockers\":[],\"nonBlocking\":[]}" > "$job_verdict" 2>/dev/null || :
    else
      # FRESH thread per job: no resume (THREAD_ID_IN empty), round 1. run_codex writes to
      # $VERDICT_FILE/$JSONL_FILE/$STDERR_FILE — point them at this job's files for the call,
      # then restore the aggregate-round paths.
      local SAVE_VF="$VERDICT_FILE" SAVE_JF="$JSONL_FILE" SAVE_SF="$STDERR_FILE" SAVE_TID="${THREAD_ID_IN:-}" SAVE_RD="$ROUND"
      VERDICT_FILE="$job_verdict"; JSONL_FILE="$job_jsonl"; STDERR_FILE="$job_stderr"
      THREAD_ID_IN=""; ROUND=1
      run_codex code "$packet" "$REPO_ROOT"
      job_outcome="$(classify_verdict_file "$job_verdict" "$job_jsonl" "$CODEX_EXIT")"
      VERDICT_FILE="$SAVE_VF"; JSONL_FILE="$SAVE_JF"; STDERR_FILE="$SAVE_SF"; THREAD_ID_IN="$SAVE_TID"; ROUND="$SAVE_RD"
    fi

    # accumulate per-job summary + (on BLOCK) union the blockers/nonBlocking
    jq -nc --arg group "$label" --argjson files "$files" --arg outcome "$job_outcome" \
           --arg verdictPath "$job_verdict" \
      '{group:$group, files:$files, outcome:$outcome, verdictPath:$verdictPath}' >> "$jobs_jsonl"

    case "$job_outcome" in
      BLOCK)
        any_block=1
        jq -c '(.blockers // [])[]' "$job_verdict" 2>/dev/null >> "$agg_blockers"
        jq -c '(.nonBlocking // [])[]' "$job_verdict" 2>/dev/null >> "$agg_nonblock"
        ;;
      APPROVE) : ;;
      *) # OVERFLOW / INFRA_ERROR — inconclusive
        any_inconclusive=1
        [ -n "$FAN_FIRST_INCONCLUSIVE" ] || FAN_FIRST_INCONCLUSIVE="$label"
        ;;
    esac
  done < "$jobs_file"

  FAN_N_JOBS="$n_jobs"
  FAN_TOTAL_FILES="$total_files"
  FAN_JOBS_JSON="$(jq -sc '.' "$jobs_jsonl" 2>/dev/null)"; [ -n "$FAN_JOBS_JSON" ] || FAN_JOBS_JSON='[]'
  FAN_BLOCKERS=0; FAN_AGENT_FIXABLE=0; FAN_DECISION_BLOCKERS=0

  # ---- DETERMINISTIC aggregate ----
  if [ "$any_block" = "1" ]; then
    # Union ALL jobs' blockers[]+nonBlocking[] into the aggregate verdict file (audit).
    # We NEVER drop a job's blocker.
    jq -s '.' "$agg_blockers" > "$RUN_DIR/.fan-blockers.arr" 2>/dev/null
    jq -s '.' "$agg_nonblock" > "$RUN_DIR/.fan-nonblocking.arr" 2>/dev/null
    jq -n --slurpfile b "$RUN_DIR/.fan-blockers.arr" --slurpfile nb "$RUN_DIR/.fan-nonblocking.arr" \
      --arg noun "$fan_noun" --arg plural "$fan_plural" \
      '{verdict:"request_changes", summary:($noun+"ed review: one or more "+$plural+" reported blockers (union)"), blockers:($b[0] // []), nonBlocking:($nb[0] // [])}' \
      > "$VERDICT_FILE" 2>/dev/null || :
    FAN_BLOCKERS="$(jq -r '(.blockers // []) | length' "$VERDICT_FILE" 2>/dev/null)"; [ -n "$FAN_BLOCKERS" ] || FAN_BLOCKERS=0
    FAN_AGENT_FIXABLE="$(jq -r '[(.blockers // [])[] | select(.class=="agent_fixable")] | length' "$VERDICT_FILE" 2>/dev/null)"; [ -n "$FAN_AGENT_FIXABLE" ] || FAN_AGENT_FIXABLE=0
    FAN_DECISION_BLOCKERS="$(jq -r '[(.blockers // [])[] | select(.class=="decision")] | length' "$VERDICT_FILE" 2>/dev/null)"; [ -n "$FAN_DECISION_BLOCKERS" ] || FAN_DECISION_BLOCKERS=0
    rm -f "$RUN_DIR/.fan-blockers.arr" "$RUN_DIR/.fan-nonblocking.arr" "$agg_blockers" "$agg_nonblock" "$jobs_jsonl"
    FAN_OUTCOME="BLOCK"
    return 0
  fi

  rm -f "$agg_blockers" "$agg_nonblock"

  if [ "$any_inconclusive" = "1" ]; then
    # Fail closed: a job did not return a clean verdict (overflow/error). NEVER APPROVE.
    printf '%s\n' "{\"verdict\":\"request_changes\",\"summary\":\"$fan_noun $FAN_FIRST_INCONCLUSIVE inconclusive\",\"blockers\":[],\"nonBlocking\":[]}" > "$VERDICT_FILE" 2>/dev/null || :
    rm -f "$jobs_jsonl"
    FAN_OUTCOME="OVERFLOW"
    return 0
  fi

  # ---- ALL jobs APPROVE => APPROVE. ----
  printf '%s\n' "{\"verdict\":\"approve\",\"summary\":\"${fan_noun}ed review: $n_jobs $fan_plural all approved ($total_files files, full coverage)\",\"blockers\":[],\"nonBlocking\":[]}" > "$VERDICT_FILE" 2>/dev/null || :
  rm -f "$jobs_jsonl"
  FAN_OUTCOME="APPROVE"
  return 0
}

# ----------------------------------------------------------------------------
# Shard the reviewed-now set by path, review EACH non-empty shard in its OWN FRESH
# thread, then aggregate DETERMINISTICALLY (NOT an LLM pass) and emit ONE status line.
#
# WHY a deterministic aggregate (not a final LLM review over the shard verdicts):
# a gate must NEVER drop a shard's blocker, nor APPROVE over a shard that didn't get a
# clean verdict. A deterministic union of blockers + a fail-closed "any non-APPROVE shard
# => no APPROVE" rule guarantees both, with no model judgment in the trust path.
#
# Aggregate rule (fail-closed):
#   - ANY shard BLOCK            => BLOCK; union ALL shards' blockers[]+nonBlocking[] into
#                                   $RUN_DIR/round-1-verdict.json; emit BLOCK w/ combined counts.
#   - else ANY shard OVERFLOW/INFRA_ERROR (incl. a shard whose OWN packet is still over
#                                   budget) => OVERFLOW ("shard <g> inconclusive — cannot
#                                   certify full coverage"). NEVER APPROVE over it.
#   - else (ALL shards APPROVE)  => APPROVE, "sharded review: N shards all approved (M files,
#                                   full coverage)".
# The status carries the additive Tier-2 `coverage` object AND a `shards` summary
# [{group, files, outcome, verdictPath}] + a shard coverage map under the run dir.
#   <changed> <untracked-list> <base> <delta> <skipped> <label> <fullPacketChars>
# ----------------------------------------------------------------------------
shard_and_review() { # <changed> <untracked> <base> <delta> <skipped> <label> <fullchars>
  local changed="$1" untracked_all="$2" base="$3" delta="$4" skipped="$5" label="$6" fullchars="$7"

  # The aggregate verdict + status live on round 1 (one sharded run == one round).
  ROUND=1
  set_round_paths   # sets VERDICT_FILE/JSONL_FILE/STDERR_FILE to round-1-*

  # ---- 1. partition the reviewed-now set into shard buckets (complete + disjoint) ----
  # One file per shard bucket: $RUN_DIR/.shard.<group>.changed (only created if non-empty).
  # A shard coverage map (path<TAB>group) is persisted for audit + the status' provenance.
  local shard_map="$RUN_DIR/shard-coverage-map.tsv"
  : > "$shard_map"
  # Clean any stale shard buckets from a PRIOR run in this same run dir (we append below,
  # so leftovers would duplicate paths). Buckets are scratch — safe to remove.
  rm -f "$RUN_DIR"/.shard.*.changed 2>/dev/null
  local groups_seen=""   # space-delimited, in first-encounter order
  local p g bucket
  while IFS= read -r p; do
    [ -n "$p" ] || continue
    g="$(shard_group_for_path "$p")"
    printf '%s\t%s\n' "$p" "$g" >> "$shard_map"
    bucket="$RUN_DIR/.shard.$g.changed"
    printf '%s\n' "$p" >> "$bucket"
    case " $groups_seen " in *" $g "*) : ;; *) groups_seen="$groups_seen $g" ;; esac
  done < "$changed"

  # ---- 2. build the JOB LIST (shard-specific): one job per non-empty bucket ----
  # A shard "job" = {label=group, files=count, packet=path-scoped prepr packet}. This is
  # the ONLY shard-specific step: fan_out_and_aggregate owns the loop+classify+aggregate.
  local jobs_file="$RUN_DIR/.shard-jobs.tsv"
  : > "$jobs_file"
  for g in $groups_seen; do
    bucket="$RUN_DIR/.shard.$g.changed"
    [ -s "$bucket" ] || continue

    # shard-scoped untracked subset + packet (reuse the SAME builder => identical shape)
    local shard_untracked="$RUN_DIR/.shard.$g.untracked"
    prepr_untracked_subset "$bucket" "$shard_untracked"
    local shard_packet="$RUN_DIR/.shard.$g.packet"
    build_prepr_packet "$shard_packet" "$bucket" "$shard_untracked" "$base" "$delta" "$skipped"

    local shard_files
    shard_files="$(grep -c '' "$bucket" 2>/dev/null | tr -d ' ')"
    [ -n "$shard_files" ] || shard_files=0

    printf '%s\t%s\t%s\n' "$g" "$shard_files" "$shard_packet" >> "$jobs_file"
  done

  # ---- 3. DELEGATE the fan-out + DETERMINISTIC fail-closed aggregate ----
  # fan_out_and_aggregate reviews EACH job's packet in its own fresh thread, classifies,
  # unions blockers on BLOCK, fails closed on any inconclusive job, and writes the aggregate
  # verdict file + the per-job summary array. It returns via FAN_* output vars; THIS caller
  # owns the shard vocabulary (summaries + the `shards` status field) so the observable
  # sharded-run output stays byte-for-byte identical to the pre-extraction behavior.
  # (prefix "shard-" keeps the per-shard verdict path shard-<g>-verdict.json unchanged.)
  # Pin the aggregate verdict-file vocabulary to shard/shards regardless of any ambient FAN_NOUN
  # (byte-identity of the shard path must never depend on the caller's environment). Dynamic scope:
  # these locals shadow any exported FAN_NOUN inside fan_out_and_aggregate.
  local FAN_NOUN=shard FAN_NOUN_PLURAL=shards
  fan_out_and_aggregate "$jobs_file" "shard-"

  # per-shard packets/untracked were scratch inputs; the audit trail is the persisted
  # shard-<g>-verdict.json + shard-coverage-map.tsv, so the scratch inputs can go.
  local g_cleanup
  for g_cleanup in $groups_seen; do
    rm -f "$RUN_DIR/.shard.$g_cleanup.packet" "$RUN_DIR/.shard.$g_cleanup.untracked"
  done
  rm -f "$RUN_DIR"/.shard.*.changed "$jobs_file" 2>/dev/null

  # ---- 4. EMIT the shard-vocabulary status line from the aggregate result ----
  local shards_arr coverage_arg n_shards
  shards_arr="$FAN_JOBS_JSON"; [ -n "$shards_arr" ] || shards_arr='[]'
  coverage_arg="${COVERAGE_JSON:-null}"
  n_shards="$FAN_N_JOBS"; [ -n "$n_shards" ] || n_shards=0

  if [ "$FAN_OUTCOME" = "BLOCK" ]; then
    # Union already written into $VERDICT_FILE by the helper; emit BLOCK w/ combined counts.
    jq -nc \
      --arg outcome "BLOCK" --arg threadId "" --argjson round 1 \
      --arg verdictPath "$VERDICT_FILE" --arg runDir "$RUN_DIR" \
      --argjson blockers "$FAN_BLOCKERS" --argjson agentFixableBlockers "$FAN_AGENT_FIXABLE" \
      --argjson decisionBlockers "$FAN_DECISION_BLOCKERS" --argjson coverage "$coverage_arg" \
      --argjson shards "$shards_arr" \
      --arg summary "sharded review ($n_shards shards): blockers found; union surfaced (over-budget diff $fullchars chars)" \
      '{outcome:$outcome, threadId:$threadId, round:$round, verdictPath:$verdictPath, runDir:$runDir,
        blockers:$blockers, agentFixableBlockers:$agentFixableBlockers, decisionBlockers:$decisionBlockers,
        coverage:$coverage, shards:$shards, summary:$summary}'
    return 0
  fi

  if [ "$FAN_OUTCOME" = "OVERFLOW" ]; then
    # Fail closed: a shard did not return a clean verdict (overflow/error). NEVER APPROVE.
    jq -nc \
      --arg outcome "OVERFLOW" --arg threadId "" --argjson round 1 \
      --arg verdictPath "$VERDICT_FILE" --arg runDir "$RUN_DIR" \
      --argjson coverage "$coverage_arg" --argjson shards "$shards_arr" \
      --arg summary "shard $FAN_FIRST_INCONCLUSIVE inconclusive — cannot certify full coverage (over-budget diff $fullchars chars sharded into $n_shards; fail closed)" \
      '{outcome:$outcome, threadId:$threadId, round:$round, verdictPath:$verdictPath, runDir:$runDir,
        blockers:0, agentFixableBlockers:0, decisionBlockers:0, coverage:$coverage, shards:$shards, summary:$summary}'
    return 0
  fi

  # ---- ALL shards APPROVE => APPROVE (full coverage). Record the ledger (opt-in). ----
  # total_files from $changed (not FAN_TOTAL_FILES) to preserve the historical count exactly.
  local total_files
  total_files="$(grep -c '' "$changed" 2>/dev/null | tr -d ' ')"; [ -n "$total_files" ] || total_files=0

  # Ledger: the WHOLE reviewed-now surface was approved across the shards (coverage complete).
  if [ -n "${LEDGER_REF:-}" ]; then
    cp "$changed" "$RUN_DIR/.reviewed-paths" 2>/dev/null || : > "$RUN_DIR/.reviewed-paths"
    ledger_append "$label" "sharded review: $n_shards shards all approved ($total_files files)"
  fi

  jq -nc \
    --arg outcome "APPROVE" --arg threadId "" --argjson round 1 \
    --arg verdictPath "$VERDICT_FILE" --arg runDir "$RUN_DIR" \
    --argjson coverage "$coverage_arg" --argjson shards "$shards_arr" \
    --arg summary "sharded review: $n_shards shards all approved ($total_files files, full coverage)" \
    '{outcome:$outcome, threadId:$threadId, round:$round, verdictPath:$verdictPath, runDir:$runDir,
      blockers:0, agentFixableBlockers:0, decisionBlockers:0, coverage:$coverage, shards:$shards, summary:$summary}'
  return 0
}

# ============================================================================
# MULTI-LENS — review the SAME full diff through several INDEPENDENT reviewer
# personas ("lenses"), each in its OWN fresh thread, then aggregate DETERMINISTICALLY
# (fail-closed) and emit ONE status line with an additive `lenses[]` summary.
# ----------------------------------------------------------------------------
# Mutually exclusive with sharding: the caller (_prepr_common) dispatches HERE BEFORE
# the CODEX_GATE_SHARD=auto branch, so multi-lens never shards. Every lens gets the
# WHOLE diff (build_prepr_packet over the same reviewed-now set, with a per-lens
# persona); if ANY lens packet exceeds $CODEX_GATE_PACKET_BUDGET the whole run OVERFLOWs
# (fail closed) — it must NEVER silently shard a lens.
#
# Fail-closed order (NO codex call happens until every fail-closed gate has passed):
#   1. MAX_LENSES: applicable lens count > $CODEX_GATE_FANOUT_MAX_LENSES => INFRA_ERROR,
#      ZERO codex calls (die_infra). We NEVER truncate/drop a lens.
#   2. per-lens packet build: a missing lens persona => die_infra (build_prepr_packet).
#   3. per-lens over budget => OVERFLOW, ZERO codex calls (fail closed).
# Only after all three does fan_out_and_aggregate invoke Codex (one fresh thread/lens).
#
# Aggregate = fan_out_and_aggregate (same trust-critical core the shard path uses),
# with FAN_NOUN=lens FAN_NOUN_PLURAL=lenses for the verdict-file .summary wording.
# On BLOCK, the unioned blockers are DE-DUPed by (file+line+issue) so the same finding
# surfaced by >=2 lenses collapses to ONE blocker (G3). The status carries an additive
# `lenses:[{lens,outcome,verdictPath}]` array (G4) derived from FAN_JOBS_JSON.
#
# Ledger (G5, no over-claim): a multi-lens APPROVE does NOT append per-file ledger rows.
# A lens APPROVE certifies the diff through that lens; it is NOT a per-file-surface
# approval, so we must never let a later prepr-delta SKIP those files as "reviewed".
#   <changed> <untracked-list> <base> <delta> <skipped> <label>
# ============================================================================
multi_lens_review() { # <changed> <untracked> <base> <delta> <skipped> <label>
  local changed="$1" untracked_all="$2" base="$3" delta="$4" skipped="$5" label="$6"

  # The aggregate verdict + status live on round 1 (one multi-lens run == one round).
  ROUND=1
  set_round_paths

  # ---- 1. resolve the APPLICABLE lens set (core 3 + FE-only-if-FE-paths) ----
  local lenses_list="$RUN_DIR/.lenses.list"
  resolve_lens_set "$changed" > "$lenses_list"
  local n_lenses
  n_lenses="$(grep -c '' "$lenses_list" 2>/dev/null | tr -d ' ')"; [ -n "$n_lenses" ] || n_lenses=0

  # ---- 1a. MAX_LENSES fail-closed: EXCEED the cap => INFRA_ERROR, ZERO codex calls ----
  # (die_infra emits INFRA_ERROR + exits; we NEVER truncate a lens to fit the cap.)
  # Validate the knob is a non-negative integer FIRST — a malformed value would make the `-gt`
  # test error under `set -u`-ish shells and fail OPEN (fall through to invoke codex); fail closed.
  case "$CODEX_GATE_FANOUT_MAX_LENSES" in
    ''|*[!0-9]*) rm -f "$lenses_list"; die_infra "CODEX_GATE_FANOUT_MAX_LENSES must be a non-negative integer (got '$CODEX_GATE_FANOUT_MAX_LENSES') — fail-closed, no codex invoked" ;;
  esac
  if [ "$n_lenses" -gt "$CODEX_GATE_FANOUT_MAX_LENSES" ]; then
    rm -f "$lenses_list"
    die_infra "fan-out lens count $n_lenses exceeds CODEX_GATE_FANOUT_MAX_LENSES=$CODEX_GATE_FANOUT_MAX_LENSES — refusing to truncate/drop a lens (fail-closed; no codex invoked)"
  fi

  # ---- 2. build ONE full-diff packet PER lens (with that lens persona) + jobs file ----
  # Each lens reviews the SAME reviewed-now set + untracked subset — only the persona differs.
  local jobs_file="$RUN_DIR/.lens-jobs.tsv"
  : > "$jobs_file"
  rm -f "$RUN_DIR"/.lens.*.packet 2>/dev/null
  local lens persona lens_packet lens_files
  lens_files="$(grep -c '' "$changed" 2>/dev/null | tr -d ' ')"; [ -n "$lens_files" ] || lens_files=0
  while IFS= read -r lens; do
    [ -n "$lens" ] || continue
    persona="$SKILL_DIR/reviewer-instructions.$lens.md"
    lens_packet="$RUN_DIR/.lens.$lens.packet"
    # build_prepr_packet fails CLOSED (die_infra) if the persona is unreadable — a missing
    # lens persona can NEVER slip through as a persona-less (fail-open) review.
    build_prepr_packet "$lens_packet" "$changed" "$untracked_all" "$base" "$delta" "$skipped" "$persona"
    printf '%s\t%s\t%s\n' "$lens" "$lens_files" "$lens_packet" >> "$jobs_file"
  done < "$lenses_list"

  # ---- 2a. OVER-BUDGET fail-closed: every lens has the FULL diff. If ANY lens packet
  # exceeds the budget, the run OVERFLOWs (fail closed) — multi-lens is non-composable
  # with sharding, so we do NOT shard; we tell the user to narrow the surface. This is a
  # PRE-FLIGHT check so NO codex call happens for an over-budget lens set. ----
  local lp lp_chars over_lens="" over_chars=0
  while IFS="	" read -r lens lens_files lp; do
    [ -n "$lp" ] || continue
    lp_chars="$(wc -c < "$lp" 2>/dev/null | tr -d ' ')"; [ -n "$lp_chars" ] || lp_chars=0
    if [ "$lp_chars" -gt "$CODEX_GATE_PACKET_BUDGET" ]; then over_lens="$lens"; over_chars="$lp_chars"; break; fi
  done < "$jobs_file"
  if [ -n "$over_lens" ]; then
    local coverage_arg_of="${COVERAGE_JSON:-null}"
    # Additive lenses[] (3e) even on this fail-closed path — consumers keep per-lens provenance:
    # the over-budget lens is OVERFLOW, the rest not_run (NO codex was invoked). Build BEFORE cleanup.
    local over_lenses_arr
    over_lenses_arr="$(jq -Rn --arg over "$over_lens" '[inputs | {lens:., outcome:(if .==$over then "OVERFLOW" else "not_run" end), verdictPath:""}]' < "$lenses_list" 2>/dev/null)"
    [ -n "$over_lenses_arr" ] || over_lenses_arr='[]'
    # clean scratch packets (audit trail not needed — nothing was reviewed)
    rm -f "$RUN_DIR"/.lens.*.packet "$jobs_file" "$lenses_list" 2>/dev/null
    jq -nc \
      --arg outcome "OVERFLOW" --arg threadId "" --argjson round 1 \
      --arg verdictPath "$VERDICT_FILE" --arg runDir "$RUN_DIR" \
      --argjson coverage "$coverage_arg_of" --argjson lenses "$over_lenses_arr" \
      --arg summary "multi-lens over budget: the '$over_lens' lens packet is $over_chars chars (> budget $CODEX_GATE_PACKET_BUDGET) and every lens reviews the FULL diff; refusing to shard under --multi (fail closed). Narrow the surface with 'prepr-delta --multi', or drop --multi to use sharding." \
      '{outcome:$outcome, threadId:$threadId, round:$round, verdictPath:$verdictPath, runDir:$runDir,
        blockers:0, agentFixableBlockers:0, decisionBlockers:0, coverage:$coverage, lenses:$lenses, summary:$summary}'
    return 0
  fi

  # ---- 3. DELEGATE the fan-out + DETERMINISTIC fail-closed aggregate (per-LENS jobs) ----
  # prefix "lens-" => per-lens verdict files land at $RUN_DIR/lens-<lens>-verdict.json.
  # FAN_NOUN/PLURAL word the aggregate verdict-file .summary as "lensed review … lenses".
  # Concurrency note (G1/G2/ADR-003): CODEX_GATE_MAX_PARALLEL_CODEX defaults to 1
  # (sequential — the existing helper loop). >1 is not yet wired for safe backgrounding,
  # so it is treated as sequential; the deterministic aggregate is order-independent, so
  # correctness never depends on this knob.
  local FAN_NOUN=lens FAN_NOUN_PLURAL=lenses
  fan_out_and_aggregate "$jobs_file" "lens-"

  # per-lens packets were scratch inputs; the audit trail is the persisted
  # lens-<lens>-verdict.json + the aggregate verdict, so the scratch packets can go.
  rm -f "$RUN_DIR"/.lens.*.packet "$jobs_file" "$lenses_list" 2>/dev/null

  # ---- 4. build the additive lenses[] summary from FAN_JOBS_JSON ----
  # FAN_JOBS_JSON entries use the neutral key `group`; rename it to `lens` for this path.
  local lenses_arr coverage_arg
  lenses_arr="$(printf '%s' "${FAN_JOBS_JSON:-[]}" | jq -c '[.[] | {lens:.group, outcome:.outcome, verdictPath:.verdictPath}]' 2>/dev/null)"
  [ -n "$lenses_arr" ] || lenses_arr='[]'
  coverage_arg="${COVERAGE_JSON:-null}"

  if [ "$FAN_OUTCOME" = "BLOCK" ]; then
    # ---- G3 DEDUP: collapse cross-lens duplicate blockers (same file+line+issue) to ONE.
    # The unioned blockers were written into $VERDICT_FILE by fan_out_and_aggregate; rewrite
    # it with a stable-order de-dup so counts are not inflated + the convergence guard is
    # stable. (SHARD path is untouched — shards are disjoint by path, so no cross-shard dup;
    # and this rewrite only runs on the multi-lens BLOCK path.)
    dedup_verdict_blockers "$VERDICT_FILE"
    local n_b n_fix n_dec
    n_b="$(jq -r '(.blockers // []) | length' "$VERDICT_FILE" 2>/dev/null)"; [ -n "$n_b" ] || n_b=0
    n_fix="$(jq -r '[(.blockers // [])[] | select(.class=="agent_fixable")] | length' "$VERDICT_FILE" 2>/dev/null)"; [ -n "$n_fix" ] || n_fix=0
    n_dec="$(jq -r '[(.blockers // [])[] | select(.class=="decision")] | length' "$VERDICT_FILE" 2>/dev/null)"; [ -n "$n_dec" ] || n_dec=0
    jq -nc \
      --arg outcome "BLOCK" --arg threadId "" --argjson round 1 \
      --arg verdictPath "$VERDICT_FILE" --arg runDir "$RUN_DIR" \
      --argjson blockers "$n_b" --argjson agentFixableBlockers "$n_fix" \
      --argjson decisionBlockers "$n_dec" --argjson coverage "$coverage_arg" \
      --argjson lenses "$lenses_arr" \
      --arg summary "multi-lens review ($n_lenses lenses): blockers found; union surfaced (de-duped across lenses)" \
      '{outcome:$outcome, threadId:$threadId, round:$round, verdictPath:$verdictPath, runDir:$runDir,
        blockers:$blockers, agentFixableBlockers:$agentFixableBlockers, decisionBlockers:$decisionBlockers,
        coverage:$coverage, lenses:$lenses, summary:$summary}'
    return 0
  fi

  if [ "$FAN_OUTCOME" = "OVERFLOW" ]; then
    # Fail closed: a lens did not return a clean verdict (overflow/error). NEVER APPROVE.
    jq -nc \
      --arg outcome "OVERFLOW" --arg threadId "" --argjson round 1 \
      --arg verdictPath "$VERDICT_FILE" --arg runDir "$RUN_DIR" \
      --argjson coverage "$coverage_arg" --argjson lenses "$lenses_arr" \
      --arg summary "lens $FAN_FIRST_INCONCLUSIVE inconclusive — cannot certify a clean multi-lens review ($n_lenses lenses; fail closed). Narrow with 'prepr-delta --multi' or drop --multi." \
      '{outcome:$outcome, threadId:$threadId, round:$round, verdictPath:$verdictPath, runDir:$runDir,
        blockers:0, agentFixableBlockers:0, decisionBlockers:0, coverage:$coverage, lenses:$lenses, summary:$summary}'
    return 0
  fi

  # ---- COVERAGE fail-closed (Tier-2 contract; mirrors emit_outcome's guard): even if EVERY
  # lens approved the reviewed-now diff, a branch-diff file left UNREVIEWED (neither reviewed-now
  # nor prior-hash-matched nor scratch-excluded) makes approval impossible — downgrade to OVERFLOW.
  # The multi-lens APPROVE branch must not bypass this guard. ----
  if [ "${UNREVIEWED_COUNT:-0}" -gt 0 ]; then
    jq -nc \
      --arg outcome "OVERFLOW" --arg threadId "" --argjson round 1 \
      --arg verdictPath "$VERDICT_FILE" --arg runDir "$RUN_DIR" \
      --argjson coverage "$coverage_arg" --argjson lenses "$lenses_arr" \
      --arg summary "coverage gap: ${UNREVIEWED_COUNT} file(s) unaccounted (neither reviewed-now nor prior-hash-matched nor scratch-excluded); refusing to approve a multi-lens review — re-run after the gap is reviewed." \
      '{outcome:$outcome, threadId:$threadId, round:$round, verdictPath:$verdictPath, runDir:$runDir,
        blockers:0, agentFixableBlockers:0, decisionBlockers:0, coverage:$coverage, lenses:$lenses, summary:$summary}'
    return 0
  fi

  # ---- ALL lenses APPROVE => APPROVE. NO ledger append (G5, no over-claim): a lens
  # APPROVE is a dimensional (whole-diff) certification, NOT a per-file-surface approval,
  # so we must never let a later prepr-delta treat these files as since-reviewed. ----
  jq -nc \
    --arg outcome "APPROVE" --arg threadId "" --argjson round 1 \
    --arg verdictPath "$VERDICT_FILE" --arg runDir "$RUN_DIR" \
    --argjson coverage "$coverage_arg" --argjson lenses "$lenses_arr" \
    --arg summary "multi-lens review: $n_lenses lenses all approved ($lens_files files, full diff per lens)" \
    '{outcome:$outcome, threadId:$threadId, round:$round, verdictPath:$verdictPath, runDir:$runDir,
      blockers:0, agentFixableBlockers:0, decisionBlockers:0, coverage:$coverage, lenses:$lenses, summary:$summary}'
  return 0
}

# ----------------------------------------------------------------------------
# G3 blocker de-dup: rewrite a verdict file so its blockers[] contains at most ONE
# entry per (file+line+issue) key — the same finding reported by multiple lenses
# collapses to one, so counts are not inflated. jq unique_by keeps exactly ONE entry
# per key (sorted by the key); every DISTINCT finding survives. nonBlocking[] is left
# untouched. A no-op on an already-unique set. Only ever called on the multi-lens BLOCK
# path, so the shard path stays byte-identical.
# ----------------------------------------------------------------------------
dedup_verdict_blockers() { # <verdict-file>
  local vf="$1"
  [ -f "$vf" ] || return 0
  local tmp="$vf.dedup.$$"
  # Key on file|line|issue (nulls tolerated); unique_by keeps one entry per key.
  local dedup_filter='.blockers = ((.blockers // []) | unique_by(((.file // "")|tostring)+" "+((.line // "")|tostring)+" "+((.issue // "")|tostring)))'
  jq "$dedup_filter" "$vf" > "$tmp" 2>/dev/null && mv "$tmp" "$vf" || rm -f "$tmp"
}

# ----------------------------------------------------------------------------
# Emit a synthetic APPROVE (no Codex call) — used by the empty prepr-delta path.
# Honors the coverage fail-closed guard: if UNREVIEWED_COUNT>0 we never get here
# (the caller only invokes this when n_now==0 AND unreviewed==0). Still records the
# ledger (no new reviewed surface, but a coverage-complete pass) and prints the
# coverage object. THREAD_ID stays empty; VERDICT_FILE is written for audit parity.
# ----------------------------------------------------------------------------
emit_synthetic_approve() { # <summary>
  local summary="$1"
  # Write a tiny audit verdict so a runDir always has a round verdict file.
  printf '%s\n' "{\"verdict\":\"approve\",\"summary\":$(jq -Rn --arg s "$summary" '$s'),\"blockers\":[],\"nonBlocking\":[]}" \
    > "$VERDICT_FILE" 2>/dev/null || :
  jq -nc \
    --arg outcome "APPROVE" \
    --arg threadId "" \
    --argjson round "${ROUND:-1}" \
    --arg verdictPath "${VERDICT_FILE:-}" \
    --arg runDir "${RUN_DIR:-}" \
    --argjson blockers 0 \
    --argjson agentFixableBlockers 0 \
    --argjson decisionBlockers 0 \
    --argjson coverage "${COVERAGE_JSON:-null}" \
    --arg summary "$summary" \
    '{outcome:$outcome, threadId:$threadId, round:$round, verdictPath:$verdictPath,
      runDir:$runDir, blockers:$blockers, agentFixableBlockers:$agentFixableBlockers,
      decisionBlockers:$decisionBlockers, coverage:$coverage, summary:$summary}'
}

# No-op placeholder so the empty-delta path reads symmetrically with the Codex path
# (THREAD_ID is irrelevant when Codex never ran). Kept tiny + side-effect free.
parse_thread_id_noop() { THREAD_ID=""; }

# ============================================================================
# MODE: config  (READ-ONLY report — ZERO Codex calls, no run dir, no ledger)
# ----------------------------------------------------------------------------
# Reports the gate's EFFECTIVE configuration and source/runtime PARITY, so the drift
# this file has already suffered once — the versioned copy and the installed runtime
# quietly diverging (different model, different fast default, different sha256), with
# nobody noticing that a fix committed to the repo never reached the running gate — is
# OBSERVABLE instead of invisible. Reads three files and one `git rev-parse`; writes
# nothing anywhere. Safe to run while another gate is mid-review.
#
#   defaults    the LITERAL fallback values baked into the running script
#   effective   the values actually in force (env overrides applied). `fast` is
#               normalized to its REAL trigger — run_codex enables fast mode only on an
#               exact "1", so CODEX_GATE_FAST=2 reports fast:false. `fastRaw` keeps the
#               raw value visible so a 2 is not silently rounded to either state.
#   origin      per dial: "default", or the name of the env var that overrode it
#   parity      MATCH / MISMATCH / INCOMPLETE / UNAVAILABLE, rolled up from three
#               checks reported separately, because byte-identical files can still
#               behave differently under env overrides — and can still be half a skill:
#                 digestParity     — sha256 byte identity across the whole inventory
#                 effectiveParity  — the dials actually in force vs the dials the
#                                    versioned SOURCE declares
#                 completeness     — every inventory member present on BOTH endpoints
#                                    (inventoryMissing names any that are not, and
#                                    which endpoint lacks each)
#               MATCH requires all three; a known difference is MISMATCH; agreement
#               over an incomplete pair is INCOMPLETE; anything unlocatable/unparseable
#               is UNAVAILABLE. Nothing undetermined ever reports MATCH.
#               `runtimeExecutable` is reported alongside but is NOT one of the checks —
#               see the note at the field: `bash codex-gate.sh` does not need the bit.
#
# Endpoints (both overridable so tests can point at fixtures instead of a machine's
# real ~/.claude/skills state):
#   CODEX_GATE_RUNTIME  the gate that actually runs — default the owner-decided
#                       authoritative install $HOME/.claude/skills/codex-gate/codex-gate.sh
#                       (a real directory, NOT a symlink; symlink/missing is detected and
#                       reported via runtimeKind rather than assumed).
#   CODEX_GATE_SOURCE   the versioned copy — default auto-discovered (see below).
# `running` always names the script that produced the report, so "the digest of the
# running script" is unambiguous even when it is neither endpoint.
# ============================================================================

sha256_of() { # <file> -> 64-hex sha256, or EMPTY when unreadable (follows symlinks: the
  # target is what would actually run). Caller treats empty as "no digest available".
  [ -f "$1" ] || return 0
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" 2>/dev/null | awk '{print $1}'
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" 2>/dev/null | awk '{print $1}'
  fi
}

path_kind() { # <path> -> symlink | file | other | missing  (-L FIRST: -f follows links,
  # so testing -f first would report a symlinked install as a plain file)
  if   [ -L "$1" ]; then printf 'symlink'
  elif [ -f "$1" ]; then printf 'file'
  elif [ -e "$1" ]; then printf 'other'
  else                   printf 'missing'
  fi
}

path_has_symlink_component() { # <path> -> echoes the FIRST symlinked component, returns 0; else 1
  # Leaf-only `-L` is not enough for an honest report. The repo-root README's documented
  # personal-skill setup symlinks the skill DIRECTORY
  # (`ln -s .../plugin/skills/codex-gate ~/.claude/skills/codex-gate`), so `<link>/codex-gate.sh`
  # is a perfectly ordinary file by `-L` and `config` would call a symlinked install a plain
  # physical one — the single fact an operator most needs when the two copies disagree. Walk
  # the components textually — deliberately NOT resolving as we go, since resolving is what
  # hides the link.
  local p="$1" acc="" comp rest
  case "$p" in /*) ;; *) p="$PWD/$p" ;; esac
  rest="${p#/}"
  while [ -n "$rest" ]; do
    case "$rest" in
      */*) comp="${rest%%/*}"; rest="${rest#*/}" ;;
      *)   comp="$rest";       rest="" ;;
    esac
    [ -n "$comp" ] || continue
    acc="$acc/$comp"
    if [ -L "$acc" ]; then printf '%s' "$acc"; return 0; fi
  done
  return 1
}

runtime_path_kind() { # <path> -> symlink | file | other | missing (symlink wins on ANY component)
  if path_has_symlink_component "$1" >/dev/null 2>&1; then printf 'symlink'; return 0; fi
  path_kind "$1"
}

# ============================================================================
# The SYNC INVENTORY — the unit a manual sync copies and `config` claims parity over.
# ----------------------------------------------------------------------------
# Everything the skill needs to RUN, plus the two operational docs that describe how
# it behaves. A script-only claim was wrong in two separate ways: a copy carrying only
# codex-gate.sh cannot run at all (`main` requires the sibling verdict.schema.json +
# reviewer-instructions.md before dispatching any mode), and a copy whose SKILL.md /
# README.md still document superseded dials was reported as a full MATCH.
#
# This list is the CONTRACT (documented in README.md's "Manual sync" section and
# reported by `config` as `syncInventory`). Nothing outside it is claimed over, so an
# owner's own notes in the installed skill directory are simply not this report's
# business. `codex-gate.test.sh` is deliberately absent: the suite is developed
# against the checkout, not shipped into the runtime.
#
# The FIRST entry is "the script": its two endpoints are the explicitly-named
# CODEX_GATE_SOURCE / CODEX_GATE_RUNTIME paths whatever they happen to be called, so
# both knobs keep pointing at a script. Every other entry is resolved as a sibling of
# the corresponding endpoint.
# ============================================================================
CODEX_GATE_SYNC_INVENTORY='codex-gate.sh
verdict.schema.json
question.schema.json
investigate.schema.json
reviewer-instructions.md
reviewer-instructions.arch.md
reviewer-instructions.frontend.md
reviewer-instructions.security.md
reviewer-instructions.tests.md
question-instructions.md
investigate-instructions.md
SKILL.md
README.md'

inventory_pairs() { # <sourceScript> <destScript> -> "<src>\t<dest>\t<name>" per member
  local srcDir destDir name first=1
  srcDir="$(dirname "$1")"; destDir="$(dirname "$2")"
  while IFS= read -r name; do
    [ -n "$name" ] || continue
    if [ "$first" = "1" ]; then
      first=0
      printf '%s\t%s\t%s\n' "$1" "$2" "$name"
    else
      printf '%s\t%s\t%s\n' "$srcDir/$name" "$destDir/$name" "$name"
    fi
  done <<INVEOF
$CODEX_GATE_SYNC_INVENTORY
INVEOF
}

parse_dial() { # <file> <VAR> -> "<op>|<literal>", or EMPTY when absent/malformed
  # Reads a dial's declared fallback out of ANY codex-gate.sh: the assignment line
  # `VAR="${VAR<op>literal}"` where <op> is `-` (unset only) or `:-` (unset or empty).
  # Anchored at column 1 via awk index() — a fixed-string compare, so nothing in the
  # value can be read as a regex metacharacter, and a comment mentioning the var is
  # never matched. Pure; fails by echoing nothing (callers fail closed on empty).
  local f="$1" v="$2" prefix line rest op
  [ -f "$f" ] || return 0
  prefix="$v=\"\${$v"
  line="$(awk -v p="$prefix" 'index($0,p)==1 {print; exit}' "$f" 2>/dev/null)"
  [ -n "$line" ] || return 0
  rest="${line#"$prefix"}"                       # e.g.  -gpt-5.6-sol}"   or   :-xhigh}"
  case "$rest" in
    :-*) op=":-"; rest="${rest#:-}" ;;
    -*)  op="-";  rest="${rest#-}"  ;;
    *)   return 0 ;;
  esac
  case "$rest" in
    *'}"') rest="${rest%\}\"}" ;;
    *)     return 0 ;;
  esac
  printf '%s|%s' "$op" "$rest"
}

# The repo-relative path a checkout of this project carries the gate at. Auto-discovery
# claims a file is "the versioned copy" only when git tracks it AT THIS PATH.
CODEX_GATE_CANONICAL_RELPATH='plugin/skills/codex-gate/codex-gate.sh'

# ----------------------------------------------------------------------------
# Is <path> the TRACKED CANONICAL copy — the file a checkout of this project is supposed
# to carry, as git itself sees it?
#
# Sitting inside SOME git work tree proves nothing. An installed runtime dropped under a
# dotfiles repo, an unrelated checkout, or a scratch repo answers `rev-parse` perfectly
# well, and taking that as "this file IS the versioned copy" made `config` compare a copy
# with ITSELF and certify digestParity MATCH / completeness COMPLETE / parity MATCH — the
# exact drift the subcommand exists to expose, masked by the check meant to expose it.
#
# Two facts are required, and both come from git rather than from the filesystem:
#   * TRACKED — `git ls-files --error-unmatch` fails (nonzero) for anything git does not
#     have in its index, which is precisely the untracked-copy case.
#   * CANONICAL PATH — `--full-name` prints the path relative to the work-tree root, so a
#     tracked-but-relocated copy (vendored under tools/, say) is rejected too.
# Read-only: one `git ls-files`, no writes. Returns 0 only when both hold.
# ----------------------------------------------------------------------------
gate_is_tracked_canonical() { # <path>
  local p="$1" dir base rel
  [ -f "$p" ] || return 1
  dir="$(cd "$(dirname "$p")" 2>/dev/null && pwd)" || return 1
  base="$(basename "$p")"
  rel="$(git -C "$dir" ls-files --full-name --error-unmatch -- "$base" 2>/dev/null)" || return 1
  [ "$rel" = "$CODEX_GATE_CANONICAL_RELPATH" ] || return 1
  return 0
}

# ----------------------------------------------------------------------------
# Resolve the versioned SOURCE copy for `config`. Kept as its own function so the
# discovery rule is stated once and can be quoted verbatim in the docs an operator
# follows when syncing by hand — `config` must claim parity against exactly the copy
# the operator would copy FROM. Auto-discovery order (first match wins):
#   1. CODEX_GATE_SOURCE override (an explicit instruction; honoured as given)
#   2. the running script itself, ONLY when git tracks it at $CODEX_GATE_CANONICAL_RELPATH
#   3. <cwd git work tree top>/$CODEX_GATE_CANONICAL_RELPATH, same proof required
#   4. none PROVEN -> RESOLVED_SOURCE_DISCOVERY states why, path/kind/digest stay empty/missing
# There is deliberately NO fall-back to self: an unprovable source reports UNAVAILABLE,
# because "I could not find the versioned copy" and "the versioned copy is whatever I am"
# are opposite answers and only one of them is honest.
# Sets globals (caller reads them immediately; not meant to outlive the call):
#   RESOLVED_SOURCE_PATH RESOLVED_SOURCE_KIND RESOLVED_SOURCE_DIGEST RESOLVED_SOURCE_DISCOVERY
# Side-effect-free besides read-only `git` queries + file reads.
# ----------------------------------------------------------------------------
resolve_gate_source() { # <selfDir> <selfPath>
  local selfDir="$1" selfPath="$2" top="" cand=""
  RESOLVED_SOURCE_PATH="" RESOLVED_SOURCE_KIND="missing" RESOLVED_SOURCE_DIGEST="" RESOLVED_SOURCE_DISCOVERY=""
  if [ -n "${CODEX_GATE_SOURCE:-}" ]; then
    RESOLVED_SOURCE_PATH="$CODEX_GATE_SOURCE"
    RESOLVED_SOURCE_DISCOVERY="CODEX_GATE_SOURCE"
  elif gate_is_tracked_canonical "$selfPath"; then
    # the running script is the checkout's OWN tracked canonical copy => it IS the source
    top="$(git -C "$selfDir" rev-parse --show-toplevel 2>/dev/null)"
    RESOLVED_SOURCE_PATH="$selfPath"
    RESOLVED_SOURCE_DISCOVERY="running script (git-tracked at $CODEX_GATE_CANONICAL_RELPATH in work tree $top)"
  elif top="$(git rev-parse --show-toplevel 2>/dev/null)" && [ -n "$top" ] \
       && cand="$top/$CODEX_GATE_CANONICAL_RELPATH" && gate_is_tracked_canonical "$cand"; then
    RESOLVED_SOURCE_PATH="$cand"
    RESOLVED_SOURCE_DISCOVERY="cwd git work tree ($top), git-tracked at $CODEX_GATE_CANONICAL_RELPATH"
  else
    RESOLVED_SOURCE_DISCOVERY="none: the running script is not git-tracked at $CODEX_GATE_CANONICAL_RELPATH, and the cwd is not a checkout that tracks it there — set CODEX_GATE_SOURCE, or run from the repo that carries it. (Being inside SOME git work tree is not proof: an untracked runtime would otherwise certify itself as its own source.)"
  fi
  if [ -n "$RESOLVED_SOURCE_PATH" ]; then
    RESOLVED_SOURCE_KIND="$(path_kind "$RESOLVED_SOURCE_PATH")"
    RESOLVED_SOURCE_DIGEST="$(sha256_of "$RESOLVED_SOURCE_PATH")"
    [ -n "$RESOLVED_SOURCE_DIGEST" ] || RESOLVED_SOURCE_DISCOVERY="$RESOLVED_SOURCE_DISCOVERY (unreadable: $RESOLVED_SOURCE_PATH)"
  fi
}

mode_config() {
  [ $# -eq 0 ] || { echo "config takes no arguments" >&2; exit 2; }

  # ---- the RUNNING script: the report's anchor, and the source of `defaults` ----
  local selfDir selfPath selfDigest
  selfDir="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd)" || selfDir=""
  [ -n "$selfDir" ] || die_infra "config: cannot resolve the running script's directory"
  selfPath="$selfDir/$(basename "${BASH_SOURCE[0]}")"
  [ -f "$selfPath" ] || die_infra "config: the running script is not readable at $selfPath"
  selfDigest="$(sha256_of "$selfPath")"

  # ---- defaults: the literal fallbacks, read back out of the running script ----
  # Each dial's expansion form is checked against the ORIGIN capture at the top of this
  # file. If someone changes `-` to `:-` (or back) without moving the capture with it,
  # `origin` would start lying about which dials the environment set => fail closed.
  local pair op defModel defEffort defFast
  pair="$(parse_dial "$selfPath" CODEX_GATE_MODEL)"
  [ -n "$pair" ] || die_infra "config: cannot read the CODEX_GATE_MODEL default from $selfPath"
  op="${pair%%|*}"; defModel="${pair#*|}"
  [ "$op" = "-" ] || die_infra "config: CODEX_GATE_MODEL now expands with '$op' — update CODEX_GATE_MODEL_FROM_ENV to match"
  pair="$(parse_dial "$selfPath" CODEX_GATE_EFFORT)"
  [ -n "$pair" ] || die_infra "config: cannot read the CODEX_GATE_EFFORT default from $selfPath"
  op="${pair%%|*}"; defEffort="${pair#*|}"
  [ "$op" = ":-" ] || die_infra "config: CODEX_GATE_EFFORT now expands with '$op' — update CODEX_GATE_EFFORT_FROM_ENV to match"
  pair="$(parse_dial "$selfPath" CODEX_GATE_FAST)"
  [ -n "$pair" ] || die_infra "config: cannot read the CODEX_GATE_FAST default from $selfPath"
  op="${pair%%|*}"; defFast="${pair#*|}"
  [ "$op" = ":-" ] || die_infra "config: CODEX_GATE_FAST now expands with '$op' — update CODEX_GATE_FAST_FROM_ENV to match"

  # ---- origin + effective ----
  # By construction the LIVE variables already ARE the effective values (default when the
  # env was silent, the inbound value when it was not), so `effective` needs no arithmetic.
  local oModel="default" oEffort="default" oFast="default"
  [ -z "${CODEX_GATE_MODEL_FROM_ENV:-}" ]  || oModel="CODEX_GATE_MODEL"
  [ -z "${CODEX_GATE_EFFORT_FROM_ENV:-}" ] || oEffort="CODEX_GATE_EFFORT"
  [ -z "${CODEX_GATE_FAST_FROM_ENV:-}" ]   || oFast="CODEX_GATE_FAST"

  # Parser trust gate: with NO override in play the live dial MUST equal the literal just
  # parsed. A disagreement means the PARSER is wrong, and every parity claim below would
  # silently inherit that error — so refuse to report rather than report a guess.
  [ "$oModel"  != "default" ] || [ "$CODEX_GATE_MODEL"  = "$defModel" ]  || die_infra "config: parsed CODEX_GATE_MODEL default '$defModel' disagrees with the live '$CODEX_GATE_MODEL'"
  [ "$oEffort" != "default" ] || [ "$CODEX_GATE_EFFORT" = "$defEffort" ] || die_infra "config: parsed CODEX_GATE_EFFORT default '$defEffort' disagrees with the live '$CODEX_GATE_EFFORT'"
  [ "$oFast"   != "default" ] || [ "$CODEX_GATE_FAST"   = "$defFast" ]   || die_infra "config: parsed CODEX_GATE_FAST default '$defFast' disagrees with the live '$CODEX_GATE_FAST'"

  # fast is a TRIGGER, not a truthy value: run_codex arms it on an exact "1" and on
  # nothing else, so 2/true/yes/on are all DISABLED. Report the trigger, not the intent.
  local effFast="false"
  [ "$CODEX_GATE_FAST" != "1" ] || effFast="true"

  # ---- runtime endpoint: the authoritative installed gate ----
  local runtimePath runtimeKind runtimeDigest runtimeExecutable
  runtimePath="${CODEX_GATE_RUNTIME:-$HOME/.claude/skills/codex-gate/codex-gate.sh}"
  runtimeKind="$(runtime_path_kind "$runtimePath")"
  runtimeDigest="$(sha256_of "$runtimePath")"
  # The runtime's MODE, reported as a DIAGNOSTIC and nothing more. A copy tool that drops the
  # mode, a stray chmod or an archive round-trip is worth noticing, so the bit is reported —
  # but it MUST NOT move parity or completeness.
  # RETRACTION: an earlier revision made a missing +x force parity INCOMPLETE, on the theory
  # that "a skill is loaded by EXECUTING codex-gate.sh". That is false for every documented
  # command here: they all invoke the wrapper as `bash codex-gate.sh …`, and `bash <file>`
  # needs READ permission only. A mode-0644 runtime runs fine — codex-gate.test.sh proves it
  # by running `config` FROM one and getting exit 0. So no summary may claim a non-executable
  # runtime cannot run, and no roll-up may score it.
  # `null` when there is no runtime file to test: absent is reported by runtimeKind, and
  # guessing a boolean there would be inventing an answer.
  runtimeExecutable="null"
  if [ -n "$runtimeDigest" ]; then
    if [ -x "$runtimePath" ]; then runtimeExecutable="true"; else runtimeExecutable="false"; fi
  fi

  # ---- source endpoint: the versioned copy (shared discovery — see resolve_gate_source) ----
  local sourcePath sourceKind sourceDigest sourceDiscovery
  resolve_gate_source "$selfDir" "$selfPath"
  sourcePath="$RESOLVED_SOURCE_PATH"; sourceKind="$RESOLVED_SOURCE_KIND"
  sourceDigest="$RESOLVED_SOURCE_DIGEST"; sourceDiscovery="$RESOLVED_SOURCE_DISCOVERY"

  # ---- each endpoint's DECLARED dials (so a mismatch is legible, not just flagged) ----
  local rtDefaults="null" srcDefaults="null" sdModel="" sdEffort="" sdFast="" sdParsed=0
  local pm pe pf
  if [ -n "$runtimeDigest" ]; then
    pm="$(parse_dial "$runtimePath" CODEX_GATE_MODEL)"
    pe="$(parse_dial "$runtimePath" CODEX_GATE_EFFORT)"
    pf="$(parse_dial "$runtimePath" CODEX_GATE_FAST)"
    if [ -n "$pm" ] && [ -n "$pe" ] && [ -n "$pf" ]; then
      rtDefaults="$(jq -nc --arg m "${pm#*|}" --arg e "${pe#*|}" --arg f "${pf#*|}" '{model:$m, effort:$e, fast:$f}')"
    fi
  fi
  if [ -n "$sourceDigest" ]; then
    pm="$(parse_dial "$sourcePath" CODEX_GATE_MODEL)"
    pe="$(parse_dial "$sourcePath" CODEX_GATE_EFFORT)"
    pf="$(parse_dial "$sourcePath" CODEX_GATE_FAST)"
    if [ -n "$pm" ] && [ -n "$pe" ] && [ -n "$pf" ]; then
      sdModel="${pm#*|}"; sdEffort="${pe#*|}"; sdFast="${pf#*|}"; sdParsed=1
      srcDefaults="$(jq -nc --arg m "$sdModel" --arg e "$sdEffort" --arg f "$sdFast" '{model:$m, effort:$e, fast:$f}')"
    fi
  fi

  # ---- the parity checks + completeness, then the roll-up ----
  # digestParity is a DIRECTORY-level claim over the documented sync inventory, not a
  # single-file one: a script-only comparison reported MATCH while the installed
  # SKILL.md/README.md still documented dials the source had already changed, so MATCH
  # was overstating what had actually been synced.
  #
  # DRIFT and COMPLETENESS are two different questions and are answered separately.
  # Drift is "do these two copies differ"; completeness is "is each of them a whole
  # skill". A member absent from BOTH sides has no drift BETWEEN them — that reasoning
  # was right, and it silently certified two skill directories that both lacked
  # question.schema.json as `parity: MATCH` with an EMPTY inventoryDrift. Absence from
  # either endpoint is now recorded in its own right (inventoryMissing names the member
  # and WHICH endpoint lacks it), and MATCH requires COMPLETE.
  # Either endpoint being unlocatable stays UNAVAILABLE, never MATCH and never MISMATCH.
  local digestParity="UNAVAILABLE" effectiveParity="UNAVAILABLE" parity
  local inventoryDrift="[]" inventoryMissing="[]" completeness="UNAVAILABLE"
  if [ -n "$runtimeDigest" ] && [ -n "$sourceDigest" ]; then
    local isp idp inm isd idd drift="" missing=""
    while IFS="$(printf '\t')" read -r isp idp inm; do
      [ -n "$inm" ] || continue
      isd="$(sha256_of "$isp")"; idd="$(sha256_of "$idp")"
      if   [ -z "$isd" ] && [ -z "$idd" ]; then missing="$missing$inm|both
"
      elif [ -z "$isd" ]; then missing="$missing$inm|source
"
        drift="$drift$inm|absent-from-source
"
      elif [ -z "$idd" ]; then missing="$missing$inm|runtime
"
        drift="$drift$inm|absent-from-runtime
"
      elif [ "$isd" != "$idd" ]; then drift="$drift$inm|differs
"
      fi
    done <<PAIREOF
$(inventory_pairs "$sourcePath" "$runtimePath")
PAIREOF
    if [ -z "$drift" ]; then
      digestParity="MATCH"
    else
      digestParity="MISMATCH"
      inventoryDrift="$(printf '%s' "$drift" | jq -Rsc 'split("\n")|map(select(length>0))|map(split("|"))|map({file:.[0], state:.[1]})')" \
        || inventoryDrift="[]"
    fi
    if [ -z "$missing" ]; then
      completeness="COMPLETE"
    else
      completeness="INCOMPLETE"
      inventoryMissing="$(printf '%s' "$missing" | jq -Rsc 'split("\n")|map(select(length>0))|map(split("|"))|map({file:.[0], endpoint:.[1]})')" \
        || inventoryMissing="[]"
    fi
  fi
  local syncInventory
  syncInventory="$(printf '%s' "$CODEX_GATE_SYNC_INVENTORY" | jq -Rsc 'split("\n")|map(select(length>0))')" \
    || die_infra "config: failed to render the sync inventory"
  # effectiveParity, computed DIAL BY DIAL rather than as one boolean, because the remedy
  # below has to name what actually moved and who moved it. For each dial that differs
  # from the source's declared value: if the environment set that dial, the env var is the
  # thing to clear (driftDialsEnv); if not, the running script's own default differs from
  # the source's (driftDialsSelf). Both lists can be non-empty at once.
  local driftDialsEnv="" driftDialsSelf=""
  if [ "$sdParsed" = "1" ]; then
    local sdFastBool="false"
    [ "$sdFast" != "1" ] || sdFastBool="true"
    if [ "$CODEX_GATE_MODEL" != "$sdModel" ]; then
      if [ "$oModel" = "default" ]; then driftDialsSelf="$driftDialsSelf, model"; else driftDialsEnv="$driftDialsEnv, CODEX_GATE_MODEL"; fi
    fi
    if [ "$CODEX_GATE_EFFORT" != "$sdEffort" ]; then
      if [ "$oEffort" = "default" ]; then driftDialsSelf="$driftDialsSelf, effort"; else driftDialsEnv="$driftDialsEnv, CODEX_GATE_EFFORT"; fi
    fi
    if [ "$effFast" != "$sdFastBool" ]; then
      if [ "$oFast" = "default" ]; then driftDialsSelf="$driftDialsSelf, fast"; else driftDialsEnv="$driftDialsEnv, CODEX_GATE_FAST"; fi
    fi
    driftDialsEnv="${driftDialsEnv#, }"; driftDialsSelf="${driftDialsSelf#, }"
    if [ -z "$driftDialsEnv" ] && [ -z "$driftDialsSelf" ]; then
      effectiveParity="MATCH"
    else
      effectiveParity="MISMATCH"
    fi
  fi
  # Fail closed: MATCH only when BOTH checks affirmatively matched AND the thing they
  # matched on is a COMPLETE skill. A known difference is MISMATCH (it wins: a real
  # divergence is the more actionable answer); agreement over a pair that is missing
  # inventory members is INCOMPLETE, which is NOT a match; anything undetermined stays
  # UNAVAILABLE. There is no path from "we could not tell" to MATCH. The runtime's
  # executable bit is deliberately NOT a term here — see the runtimeExecutable note.
  if [ "$digestParity" = "MISMATCH" ] || [ "$effectiveParity" = "MISMATCH" ]; then
    parity="MISMATCH"
  elif [ "$digestParity" = "MATCH" ] && [ "$effectiveParity" = "MATCH" ]; then
    if [ "$completeness" = "COMPLETE" ]; then
      parity="MATCH"
    else
      parity="INCOMPLETE"
    fi
  else
    parity="UNAVAILABLE"
  fi

  local summary driftNames="" missingNames="" incompleteWhy=""
  [ "$inventoryDrift" = "[]" ] || driftNames=" (inventory drift: $(printf '%s' "$inventoryDrift" | jq -r 'map(.file+"="+.state)|join(", ")'))"
  if [ "$inventoryMissing" != "[]" ]; then
    missingNames="$(printf '%s' "$inventoryMissing" | jq -r 'map(.file+" (absent from "+.endpoint+")")|join(", ")')"
    incompleteWhy="missing inventory member(s): $missingNames"
  fi
  # The REMEDY has to match the CAUSE, and the two causes want opposite actions. Files
  # differing on disk is fixed by copying the source over the runtime. The dials in force
  # differing from the ones the source declares is NOT: when an env var moved them, no
  # amount of copying clears it, and the previous one-size sentence ("a fix in the source
  # may not be reaching the running gate") sent an operator whose only "drift" was a
  # supported CODEX_GATE_MODEL='' override to copy files that were already identical, see
  # the same MISMATCH, and copy again. driftDialsEnv / driftDialsSelf (computed with
  # effectiveParity above) say which dials moved and whether the environment did it.
  local envRemedy=""
  if [ -n "$driftDialsEnv" ] && [ -n "$driftDialsSelf" ]; then
    envRemedy="the dials in force are not the ones the source declares: $driftDialsEnv override(s) it from the environment — copying files cannot clear that, clear or change $driftDialsEnv — and $driftDialsSelf also differ(s) with no override in play, so the script that produced this report is not running the source's code"
  elif [ -n "$driftDialsEnv" ]; then
    envRemedy="the dials in force are not the ones the source declares because the environment overrides them ($driftDialsEnv) — copying files cannot clear that; clear or change $driftDialsEnv"
  elif [ -n "$driftDialsSelf" ]; then
    envRemedy="the dials in force ($driftDialsSelf) are not the ones the source declares, with NO environment override in play, so the script that produced this report is not running the source's code — re-run config from the source checkout"
  fi
  # syncFileRemedy: the ONE canonical sentence for "copy the source over the runtime",
  # single-sourced so the two call sites below (a digest MISMATCH, and the standalone
  # INCOMPLETE parity case) can never say two different things for the same fix.
  local syncFileRemedy='sync by hand (see README.md, "Manual sync") and re-run config'
  # remediation: a machine-readable action list, built from the closed set {sync-files,
  # clear-env-override, rerun-from-source}. Each action is appended at the exact spot
  # where its matching prose clause is appended below, from the exact same condition —
  # never re-derived from the finished `summary` string — so the two cannot drift apart
  # the way a free-text phrase blocklist could be defeated by rewording alone. Which
  # variable(s) are implicated is already unambiguous from `origin`; no need to repeat it.
  #
  # `remedy` starts EMPTY and stays that way unless a real cause below sets it — never
  # give it a placeholder default, since a placeholder here is exactly the shape of bug
  # this file exists to prevent: prose that fires regardless of the guard that is
  # supposed to gate it. The ". ALSO: " join only happens when `remedy` is ALREADY
  # non-empty when a second cause is found, i.e. only when two independent causes are
  # both real — so its presence/absence in `summary` is itself a structural signal a
  # test can check without guessing at wording (see TEST 58).
  local remActionsRaw=""
  case "$parity" in
    MATCH)    summary="parity MATCH — the installed skill matches the versioned source across the whole sync inventory (script, schemas, reviewer instructions and docs), every member is present on both sides, and the dials in force are the ones it declares" ;;
    MISMATCH) summary="parity MISMATCH (digest $digestParity, effective $effectiveParity) — runtime $runtimePath vs source $sourcePath$driftNames"
              local remedy=""
              if [ "$digestParity" = "MISMATCH" ]; then
                remedy="the two copies differ on disk, so a fix in the source is not reaching the running gate: $syncFileRemedy"
                remActionsRaw="$remActionsRaw
sync-files"
              fi
              if [ -n "$envRemedy" ]; then
                [ -z "$remedy" ] || remedy="$remedy. ALSO: "
                remedy="$remedy$envRemedy"
              fi
              [ -z "$driftDialsEnv" ]  || remActionsRaw="$remActionsRaw
clear-env-override"
              [ -z "$driftDialsSelf" ] || remActionsRaw="$remActionsRaw
rerun-from-source"
              [ -z "$remedy" ] || summary="$summary; $remedy"
              [ "$completeness" != "INCOMPLETE" ] || summary="$summary. Also INCOMPLETE — $incompleteWhy" ;;
    INCOMPLETE) summary="parity INCOMPLETE — runtime $runtimePath and source $sourcePath agree byte-for-byte on everything present and the dials in force are the ones the source declares, but this is NOT a complete install: $incompleteWhy. NOT a match; $syncFileRemedy"
                remActionsRaw="sync-files" ;;
    *)        summary="parity UNAVAILABLE (digest $digestParity, effective $effectiveParity) — $sourceDiscovery; NOT a match, just undetermined" ;;
  esac
  local remediation
  remediation="$(printf '%s' "$remActionsRaw" | jq -Rsc 'split("\n")|map(select(length>0))')" \
    || die_infra "config: failed to render the remediation action list"

  jq -nc \
    --arg outcome "CONFIG" \
    --arg defModel "$defModel" --arg defEffort "$defEffort" --arg defFast "$defFast" \
    --arg effModel "$CODEX_GATE_MODEL" --arg effEffort "$CODEX_GATE_EFFORT" \
    --argjson effFast "$effFast" --arg effFastRaw "$CODEX_GATE_FAST" \
    --arg oModel "$oModel" --arg oEffort "$oEffort" --arg oFast "$oFast" \
    --arg selfPath "$selfPath" --arg selfDigest "$selfDigest" \
    --arg runtimePath "$runtimePath" --arg runtimeDigest "$runtimeDigest" --arg runtimeKind "$runtimeKind" \
    --argjson runtimeExecutable "$runtimeExecutable" --argjson runtimeDefaults "$rtDefaults" \
    --arg sourcePath "$sourcePath" --arg sourceDigest "$sourceDigest" --arg sourceKind "$sourceKind" \
    --arg sourceDiscovery "$sourceDiscovery" --argjson sourceDefaults "$srcDefaults" \
    --arg digestParity "$digestParity" --arg effectiveParity "$effectiveParity" --arg parity "$parity" \
    --arg completeness "$completeness" \
    --argjson syncInventory "$syncInventory" --argjson inventoryDrift "$inventoryDrift" \
    --argjson inventoryMissing "$inventoryMissing" \
    --arg summary "$summary" --argjson remediation "$remediation" \
    '{outcome:$outcome,
      defaults:{model:$defModel, effort:$defEffort, fast:$defFast},
      effective:{model:$effModel, effort:$effEffort, fast:$effFast, fastRaw:$effFastRaw},
      origin:{model:$oModel, effort:$oEffort, fast:$oFast},
      running:{path:$selfPath, digest:$selfDigest},
      runtimePath:$runtimePath, runtimeDigest:$runtimeDigest, runtimeKind:$runtimeKind,
      runtimeExecutable:$runtimeExecutable, runtimeDefaults:$runtimeDefaults,
      sourcePath:$sourcePath, sourceDigest:$sourceDigest, sourceKind:$sourceKind,
      sourceDiscovery:$sourceDiscovery, sourceDefaults:$sourceDefaults,
      syncInventory:$syncInventory, inventoryDrift:$inventoryDrift,
      inventoryMissing:$inventoryMissing, completeness:$completeness,
      digestParity:$digestParity, effectiveParity:$effectiveParity, parity:$parity,
      summary:$summary, remediation:$remediation}' || die_infra "config: failed to render the status line"
  exit 0
}

# ============================================================================
# Dispatch
# ============================================================================
main() {
  local mode="${1:-}"
  [ -n "$mode" ] || { echo "usage: codex-gate.sh <phase-start|phase-review|plan|bundle|question|investigate|prepr|prepr-delta|config> [args]" >&2; exit 2; }
  shift

  # Sanity: required helper files exist.
  [ -f "$SCHEMA_FILE" ] || { echo "missing schema: $SCHEMA_FILE" >&2; exit 2; }
  [ -f "$INSTRUCTIONS_FILE" ] || { echo "missing instructions: $INSTRUCTIONS_FILE" >&2; exit 2; }
  command -v jq >/dev/null 2>&1 || { echo "jq is required" >&2; exit 2; }

  case "$mode" in
    phase-start)  mode_phase_start  "$@" ;;
    phase-review) mode_phase_review "$@" ;;
    plan)         mode_plan         "$@" ;;
    bundle)       mode_bundle       "$@" ;;
    question)     mode_question     "$@" ;;
    investigate)  mode_investigate  "$@" ;;
    prepr)        mode_prepr        "$@" ;;
    prepr-delta)  mode_prepr_delta  "$@" ;;
    config)       mode_config       "$@" ;;
    *) echo "unknown mode: $mode" >&2; exit 2 ;;
  esac
}

# Run main ONLY when executed directly (not when sourced). Sourcing is used by the test
# harness to unit-test pure helpers like shard_group_for_path without dispatching a mode.
# (bash 3.2-safe: BASH_SOURCE[0] is this file's path; $0 is the invoked program.)
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  main "$@"
fi
