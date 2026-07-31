#!/usr/bin/env bash
# codex-gate.test.sh — TDD harness for codex-gate.sh
#
# Self-contained. Creates its own temp git repos and a STUB `codex` (NO real
# codex calls). Drives stub behavior via $STUB_MODE. Each test prints PASS/FAIL;
# the script exits nonzero if ANY test fails.
#
# Run: bash <skill-dir>/codex-gate.test.sh
#
# Invariants enforced here (contract source of truth is README.md, sibling of this file):
#  1. Outcome mapping (approve/block_fixable/block_decision/nonzero/empty/invalidjson).
#  2. thread_id parsed from JSONL despite a non-JSON prelude line.
#  3. phase-start/phase-review scoped diff: new untracked, modified pre-existing
#     untracked, deletion, $PHASE_HEAD anchoring across a mid-phase commit,
#     pre-existing-deletion-not-re-reported.
#  4. Scratch excludes: .png + .claude/context/ EXCLUDED; .docker/ + .claude/skills/ INCLUDED.
#  5. Read-only: git status --porcelain byte-identical before/after; output files
#     land UNDER the run dir; NO new files appear in the target repo.
#  6. Stub invoked with ABSOLUTE -o and --output-schema paths.

set -u

# --- locate the wrapper under test (sibling of this file) -------------------
TEST_DIR="$(cd "$(dirname "$0")" && pwd)"
WRAPPER="$TEST_DIR/codex-gate.sh"

# --- scratch root; everything we create lives here and is removed on exit ----
SANDBOX="$(mktemp -d "${TMPDIR:-/tmp}/cgx-test.XXXXXX")"
STUB_DIR="$SANDBOX/stub"
mkdir -p "$STUB_DIR"
STUB_ARGV_LOG="$SANDBOX/stub-argv.log"
STUB_STDIN_DUMP="$SANDBOX/stub-stdin.dump"
STUB_CWD_LOG="$SANDBOX/stub-cwd.log"

cleanup() { rm -rf "$SANDBOX"; }
trap cleanup EXIT

# --- pass/fail bookkeeping ---------------------------------------------------
PASS_COUNT=0
FAIL_COUNT=0
pass() { PASS_COUNT=$((PASS_COUNT + 1)); printf 'PASS: %s\n' "$1"; }
fail() { FAIL_COUNT=$((FAIL_COUNT + 1)); printf 'FAIL: %s\n' "$1"; }
check() { # check <desc> <condition-already-evaluated:0/1>
  if [ "$2" -eq 0 ]; then pass "$1"; else fail "$1"; fi
}

# --- build the STUB codex ----------------------------------------------------
# Behavior driven by $STUB_MODE:
#   approve        -> verdict approve, exit 0
#   block_fixable  -> request_changes w/ a class=agent_fixable blocker, exit 0
#   block_decision -> request_changes w/ a class=decision blocker, exit 0
#   nonzero        -> writes a valid verdict BUT exits 7 (infra: exit!=0 wins)
#   empty          -> writes an EMPTY -o file, exit 0
#   invalidjson    -> writes non-JSON to -o, exit 0
#   approve_with_blockers -> verdict approve BUT a non-empty blockers[] (inconsistent), exit 0
#   reqchanges_no_blockers -> request_changes with ZERO blockers (degenerate), exit 0
#   grounded        -> GROUNDING object (question.schema.json), settledByCanon=false, exit 0
#   grounded_settled-> GROUNDING object, settledByCanon=true + canonAnswer set, exit 0
#   inv_root_cause  -> INVESTIGATION report (investigate.schema.json), outcome
#                      root_cause_found (the default when --output-schema is investigate.schema.json)
#   inv_needs_evidence-> INVESTIGATION report, outcome needs_more_evidence + a nextSafeProbe
#   inv_unsafe      -> INVESTIGATION report, outcome unsafe_or_blocked (forbidden probe declined)
#   overflow        -> prints the context-window turn.failed JSONL to stdout AND
#                      exits 1 with NO valid -o file (mirrors a real Codex context overflow)
#   block_from_stdin-> request_changes w/ ONE agent_fixable blocker whose issue text is a
#                      SHARDBLOCKER-<tag> marker grepped from THIS call's stdin packet (Tier-3
#                      shard-union seam — selected via STUB_BLOCK_IF_STDIN, see below)
# Per-shard seams (Tier 3 sharding — the wrapper invokes the stub once per shard with a
# DIFFERENT scoped packet on stdin): STUB_OVERFLOW_IF_STDIN / STUB_BLOCK_IF_STDIN hold a
# sentinel string; if THIS invocation's stdin contains it, the effective mode is overridden
# to overflow / block_from_stdin for THIS call only (others keep $STUB_MODE, default approve).
# Also: when --output-schema points at question.schema.json AND STUB_MODE is the
# default 'approve', the stub auto-remaps to 'grounded' (explicit infra/grounded modes win).
# The stub logs its full argv to $STUB_ARGV_LOG and dumps stdin to
# $STUB_STDIN_DUMP, then prints fixture JSONL (with a non-JSON prelude line) to
# stdout so the wrapper's redirect captures it. It also records its process cwd
# to $STUB_CWD_LOG (one line per invocation) so tier-cwd can be asserted.
write_stub() {
  cat > "$STUB_DIR/codex" <<STUBEOF
#!/usr/bin/env bash
set -u
: "\${STUB_MODE:=approve}"
: "\${STUB_ARGV_LOG:=/dev/null}"
: "\${STUB_STDIN_DUMP:=/dev/null}"
: "\${STUB_CWD_LOG:=/dev/null}"

# record argv (one arg per line, NUL-safe-ish for our paths)
printf '%s\n' "\$@" >> "\$STUB_ARGV_LOG"
printf -- '---END-ARGV---\n' >> "\$STUB_ARGV_LOG"

# record the process cwd (the wrapper sets it per tier via a subshell cd)
printf '%s\n' "\$(pwd)" >> "\$STUB_CWD_LOG"

# consume stdin so the wrapper's pipe never blocks; keep last invocation's copy
cat > "\$STUB_STDIN_DUMP"

# Per-shard behavior seam (Tier 3): when sharding, the wrapper calls this stub once
# per shard, each with a DIFFERENT scoped packet on stdin. To make one shard BLOCK or
# OVERFLOW while the others APPROVE, the test sets STUB_BLOCK_IF_STDIN / STUB_OVERFLOW_IF_STDIN
# to a sentinel string that appears ONLY in that shard's diff; if THIS invocation's stdin
# contains it, override the effective mode for THIS call only. (Drives variation by the
# packet contents the stub actually sees, exactly as the plan suggests.)
if [ -n "\${STUB_OVERFLOW_IF_STDIN:-}" ] && grep -q -- "\$STUB_OVERFLOW_IF_STDIN" "\$STUB_STDIN_DUMP" 2>/dev/null; then
  STUB_MODE="overflow"
elif [ -n "\${STUB_BLOCK_IF_STDIN:-}" ] && grep -q -- "\$STUB_BLOCK_IF_STDIN" "\$STUB_STDIN_DUMP" 2>/dev/null; then
  STUB_MODE="block_from_stdin"
fi

# find the -o <path> value AND the --output-schema <path> value in argv
OUT=""
SCHEMA=""
prev=""
for a in "\$@"; do
  if [ "\$prev" = "-o" ]; then OUT="\$a"; fi
  if [ "\$prev" = "--output-schema" ]; then SCHEMA="\$a"; fi
  prev="\$a"
done

# Grounding (question mode) auto-detect: when the schema is question.schema.json
# AND no explicit verdict/infra STUB_MODE was requested (i.e. the default 'approve'),
# remap to the grounded fixture. Explicit infra modes (nonzero/invalidjson/empty) and
# explicit grounded/grounded_settled are left untouched so their behavior wins.
case "\$SCHEMA" in
  */question.schema.json)
    if [ "\$STUB_MODE" = "approve" ]; then STUB_MODE="grounded"; fi
    ;;
  */investigate.schema.json)
    if [ "\$STUB_MODE" = "approve" ]; then STUB_MODE="inv_root_cause"; fi
    ;;
esac

# always emit JSONL to stdout, including a NON-JSON prelude line first
printf 'Reading additional input from stdin...\n'
printf '%s\n' '{"type":"thread.started","thread_id":"stub-tid-123"}'
printf '%s\n' '{"type":"turn.completed","usage":{"input_tokens":10,"output_tokens":5}}'

case "\$STUB_MODE" in
  approve)
    [ -n "\$OUT" ] && printf '%s\n' '{"verdict":"approve","summary":"looks good","blockers":[],"nonBlocking":[]}' > "\$OUT"
    exit 0 ;;
  block_fixable)
    [ -n "\$OUT" ] && printf '%s\n' '{"verdict":"request_changes","summary":"fix this","blockers":[{"class":"agent_fixable","severity":"P1","file":"a.js","line":3,"issue":"bug","suggestion":"fix it"}],"nonBlocking":[]}' > "\$OUT"
    exit 0 ;;
  block_decision)
    [ -n "\$OUT" ] && printf '%s\n' '{"verdict":"request_changes","summary":"need a call","blockers":[{"class":"decision","severity":"P1","file":"b.js","line":0,"issue":"design choice","suggestion":"pick one"}],"nonBlocking":[]}' > "\$OUT"
    exit 0 ;;
  block_from_stdin)
    # SHARD union seam: emit ONE agent_fixable blocker whose issue text is a unique
    # marker grepped from THIS shard's packet (SHARDBLOCKER-<tag>). Lets two different
    # shards block with DISTINCT blockers so the aggregate union can be proven.
    SB_TAG="\$(grep -o 'SHARDBLOCKER-[A-Za-z0-9_]*' "\$STUB_STDIN_DUMP" 2>/dev/null | head -1)"
    [ -n "\$SB_TAG" ] || SB_TAG="SHARDBLOCKER-unknown"
    [ -n "\$OUT" ] && printf '%s\n' "{\"verdict\":\"request_changes\",\"summary\":\"shard blocked\",\"blockers\":[{\"class\":\"agent_fixable\",\"severity\":\"P1\",\"file\":\"shard.js\",\"line\":1,\"issue\":\"\$SB_TAG\",\"suggestion\":\"fix \$SB_TAG\"}],\"nonBlocking\":[]}" > "\$OUT"
    exit 0 ;;
  nonzero)
    # write a perfectly valid verdict, but exit nonzero: exit code must win
    [ -n "\$OUT" ] && printf '%s\n' '{"verdict":"approve","summary":"ignored","blockers":[],"nonBlocking":[]}' > "\$OUT"
    exit 7 ;;
  empty)
    [ -n "\$OUT" ] && : > "\$OUT"
    exit 0 ;;
  invalidjson)
    [ -n "\$OUT" ] && printf '%s\n' 'this is not json {' > "\$OUT"
    exit 0 ;;
  approve_with_blockers)
    # INCONSISTENT: says approve but carries a blocker -> wrapper must fail closed to BLOCK
    [ -n "\$OUT" ] && printf '%s\n' '{"verdict":"approve","summary":"approve but blocked","blockers":[{"class":"agent_fixable","severity":"P1","file":"c.js","line":1,"issue":"leftover","suggestion":"fix"}],"nonBlocking":[]}' > "\$OUT"
    exit 0 ;;
  reqchanges_no_blockers)
    # DEGENERATE: request_changes with an empty blockers[] -> wrapper must surface INFRA_ERROR
    [ -n "\$OUT" ] && printf '%s\n' '{"verdict":"request_changes","summary":"changes but no blockers","blockers":[],"nonBlocking":[]}' > "\$OUT"
    exit 0 ;;
  grounded)
    # QUESTION mode: a GROUNDING-shaped object (valid vs question.schema.json), unsettled.
    [ -n "\$OUT" ] && printf '%s\n' '{"settledByCanon":false,"canonAnswer":"","recommendation":"Option A: a dedicated table","rationale":"Option A keeps writes append-only and matches the existing event-store pattern.","optionAssessments":[{"option":"Option A","pros":"append-only; matches event store","cons":"one more table","risk":"migration ordering"},{"option":"Option B","pros":"fewer tables","cons":"mixes concerns","risk":"lock contention"}],"missingOptions":[{"option":"Option C: a materialized view","why":"avoids a write path entirely if reads dominate"}],"considerations":["read/write ratio","migration cost"]}' > "\$OUT"
    exit 0 ;;
  grounded_settled)
    # QUESTION mode: canon ALREADY decides it -> settledByCanon=true + canonAnswer set.
    [ -n "\$OUT" ] && printf '%s\n' '{"settledByCanon":true,"canonAnswer":"ADR-0007 (docs/adr/0007.md:12) mandates a dedicated append-only table.","recommendation":"none","rationale":"The repo canon already settles this in ADR-0007.","optionAssessments":[{"option":"Option A","pros":"conforms to ADR-0007","cons":"none","risk":"none"}],"missingOptions":[],"considerations":["follow ADR-0007"]}' > "\$OUT"
    exit 0 ;;
  inv_root_cause)
    # INVESTIGATE mode: a PROVEN root cause (valid vs investigate.schema.json).
    [ -n "\$OUT" ] && printf '%s\n' '{"outcome":"root_cause_found","rootCause":"nodemon CLI -w re-includes the eval write+exec tree","confidence":"high","evidence":[{"observation":"writes under the watched tree trip a restart","source":"package.json:12"}],"hypothesesTested":[{"hypothesis":"transient watched file","verdict":"confirmed","evidence":"observed restart after write"}],"commandsRun":["git show HEAD:package.json"],"forbiddenActionsAvoided":["did not trigger a Layer B (live AI) run"],"minimalFix":"narrow the nodemon watch / ignore the eval run tree","nextSafeProbe":""}' > "\$OUT"
    exit 0 ;;
  inv_needs_evidence)
    # INVESTIGATE mode: a leading hypothesis needing one more SAFE probe.
    [ -n "\$OUT" ] && printf '%s\n' '{"outcome":"needs_more_evidence","rootCause":"leading hypothesis: a transient watched file (UNCONFIRMED)","confidence":"low","evidence":[{"observation":"restart fires ~8-19s after each run start","source":"docker logs api-platform"}],"hypothesesTested":[{"hypothesis":"legacy-poll phantom restart","verdict":"inconclusive","evidence":"need an fs-event trace under load"}],"commandsRun":["docker logs -t api-platform"],"forbiddenActionsAvoided":[],"minimalFix":"","nextSafeProbe":"run a Layer A suite while busy-polling: find <watched dirs> -newer <marker>"}' > "\$OUT"
    exit 0 ;;
  inv_unsafe)
    # INVESTIGATE mode: forward progress requires a FORBIDDEN probe -> fail closed.
    [ -n "\$OUT" ] && printf '%s\n' '{"outcome":"unsafe_or_blocked","rootCause":"confirming would require triggering a Layer B run, which the brief forbids","confidence":"low","evidence":[],"hypothesesTested":[],"commandsRun":[],"forbiddenActionsAvoided":["declined to start a Layer B (live AI) run that spends money + writes prod"],"minimalFix":"","nextSafeProbe":"a human can reproduce with Layer A only, then re-run investigate"}' > "\$OUT"
    exit 0 ;;
  lens_dedup)
    # MULTI-LENS de-dup seam (Phase 3d): each lens reviews the SAME diff but with its OWN
    # persona at the TOP of the packet. Read which lens THIS call is by the persona banner
    # in stdin (arch/security/tests/frontend). arch + security emit the IDENTICAL blocker
    # (file=shared.js,line=7,issue=DUPE-FINDING) so the union carries a cross-lens duplicate;
    # tests emits a DISTINCT one (issue=TESTS-ONLY-FINDING). The aggregate dedup must collapse
    # the shared one to a single blocker.
    LENS="other"
    if grep -qi 'You are the ARCHITECTURE' "\$STUB_STDIN_DUMP" 2>/dev/null; then LENS="arch"
    elif grep -qi 'You are the SECURITY' "\$STUB_STDIN_DUMP" 2>/dev/null; then LENS="security"
    elif grep -qi 'You are the TESTS' "\$STUB_STDIN_DUMP" 2>/dev/null; then LENS="tests"
    elif grep -qi 'You are the FRONTEND' "\$STUB_STDIN_DUMP" 2>/dev/null; then LENS="frontend"
    fi
    case "\$LENS" in
      arch|security)
        [ -n "\$OUT" ] && printf '%s\n' '{"verdict":"request_changes","summary":"shared finding","blockers":[{"class":"agent_fixable","severity":"P1","file":"shared.js","line":7,"issue":"DUPE-FINDING","suggestion":"fix the shared issue"}],"nonBlocking":[]}' > "\$OUT" ;;
      tests)
        [ -n "\$OUT" ] && printf '%s\n' '{"verdict":"request_changes","summary":"tests finding","blockers":[{"class":"agent_fixable","severity":"P1","file":"tests.js","line":1,"issue":"TESTS-ONLY-FINDING","suggestion":"add a test"}],"nonBlocking":[]}' > "\$OUT" ;;
      *)
        [ -n "\$OUT" ] && printf '%s\n' '{"verdict":"approve","summary":"clean","blockers":[],"nonBlocking":[]}' > "\$OUT" ;;
    esac
    exit 0 ;;
  overflow)
    # CONTEXT OVERFLOW: codex blew the context window. Emit the turn.failed signature
    # JSONL to stdout and exit nonzero WITHOUT writing a valid -o verdict file. The
    # wrapper must classify this as OVERFLOW (distinct from generic INFRA_ERROR).
    printf '%s\n' '{"type":"turn.failed","error":{"message":"Codex ran out of room in the model'"'"'s context window while reading the diff."}}'
    exit 1 ;;
  *)
    printf 'unknown STUB_MODE: %s\n' "\$STUB_MODE" >&2
    exit 99 ;;
esac
STUBEOF
  chmod +x "$STUB_DIR/codex"
}
write_stub

# --- common env for every wrapper invocation ---------------------------------
export CODEX_BIN="$STUB_DIR/codex"
export CODEX_GATE_RUNS="$SANDBOX/runs"
export CODEX_HOME_DIR="$SANDBOX/codex-home"
export CODEX_GATE_SESSION="testsession"
export STUB_ARGV_LOG STUB_STDIN_DUMP STUB_CWD_LOG
mkdir -p "$CODEX_GATE_RUNS" "$CODEX_HOME_DIR"

# Helper: make a fresh temp git repo, echo its path
make_repo() {
  local r
  r="$(mktemp -d "$SANDBOX/repo.XXXXXX")"
  git -C "$r" init -q
  git -C "$r" config user.email t@t.co
  git -C "$r" config user.name "t"
  git -C "$r" config commit.gpgsign false
  printf '%s' "$r"
}

# Helper: read the JSON status line the wrapper prints to stdout.
# The wrapper may print the runDir/phaseHead lines (phase-start) or a single
# status JSON object (review modes). We grab the LAST line that parses as JSON.
last_json_line() { # <file>
  local line out=""
  while IFS= read -r line; do
    if printf '%s' "$line" | jq -e . >/dev/null 2>&1; then out="$line"; fi
  done < "$1"
  printf '%s' "$out"
}

# Helper: reset the argv log between assertions
reset_argv_log() { : > "$STUB_ARGV_LOG"; }
# Helper: reset the cwd log between assertions
reset_cwd_log() { : > "$STUB_CWD_LOG"; }

#############################################################################
# TEST 1 — outcome mapping
#############################################################################
test_outcome() { # <stub_mode> <expected_outcome> <extra_jq_filter_or_empty>
  local mode="$1" expect="$2" extra="${3:-}"
  local repo out status outcome
  repo="$(make_repo)"
  ( cd "$repo" && STUB_MODE="$mode" bash "$WRAPPER" prepr ) > "$SANDBOX/out.txt" 2>"$SANDBOX/err.txt"
  status="$(last_json_line "$SANDBOX/out.txt")"
  outcome="$(printf '%s' "$status" | jq -r '.outcome // empty' 2>/dev/null)"
  if [ "$outcome" = "$expect" ]; then
    if [ -n "$extra" ]; then
      if printf '%s' "$status" | jq -e "$extra" >/dev/null 2>&1; then
        pass "outcome[$mode] = $expect ($extra)"
      else
        fail "outcome[$mode] = $expect but extra filter failed: $extra :: $status"
      fi
    else
      pass "outcome[$mode] = $expect"
    fi
  else
    fail "outcome[$mode]: expected $expect got '$outcome' :: $status :: $(cat "$SANDBOX/err.txt")"
  fi
}

run_test_1() {
  test_outcome approve        APPROVE     '.outcome=="APPROVE"'
  test_outcome block_fixable  BLOCK       '.agentFixableBlockers>=1'
  test_outcome block_decision BLOCK       '.decisionBlockers>=1'
  test_outcome nonzero        INFRA_ERROR ''
  test_outcome empty          INFRA_ERROR ''
  test_outcome invalidjson    INFRA_ERROR ''
}

#############################################################################
# TEST 2 — thread_id parsed despite non-JSON prelude line
#############################################################################
run_test_2() {
  local repo status tid
  repo="$(make_repo)"
  ( cd "$repo" && STUB_MODE=approve bash "$WRAPPER" prepr ) > "$SANDBOX/out.txt" 2>"$SANDBOX/err.txt"
  status="$(last_json_line "$SANDBOX/out.txt")"
  tid="$(printf '%s' "$status" | jq -r '.threadId // empty' 2>/dev/null)"
  if [ "$tid" = "stub-tid-123" ]; then
    pass "thread_id parsed as stub-tid-123 despite non-JSON prelude"
  else
    fail "thread_id: expected stub-tid-123 got '$tid' :: $status"
  fi
}

#############################################################################
# TEST 3 — phase-start + phase-review scoped diff semantics
#############################################################################
run_test_3() {
  local repo runDir phaseHead status packet
  repo="$(make_repo)"

  # Pre-existing committed files: keepme (untouched), modifyme, deleteme,
  # and predeleted (will be deleted BEFORE phase-start -> must NOT be re-reported).
  printf 'keep\n'    > "$repo/keepme.txt"
  printf 'orig-mod\n' > "$repo/modifyme.txt"
  printf 'to-delete\n' > "$repo/deleteme.txt"
  printf 'predeleted-content\n' > "$repo/predeleted.txt"
  # A pre-existing UNTRACKED file that will be modified after phase-start.
  git -C "$repo" add keepme.txt modifyme.txt deleteme.txt predeleted.txt
  git -C "$repo" commit -qm init

  # Pre-existing untracked source file (exists at phase-start, modified after).
  printf 'untracked-v1\n' > "$repo/preexist_untracked.js"
  # predeleted.txt is removed BEFORE phase-start (deleted at start).
  rm -f "$repo/predeleted.txt"

  # phase-start
  ( cd "$repo" && bash "$WRAPPER" phase-start P1 ) > "$SANDBOX/ps.txt" 2>"$SANDBOX/ps.err"
  runDir="$(grep -E '^RUNDIR=' "$SANDBOX/ps.txt" | head -1 | sed 's/^RUNDIR=//')"
  phaseHead="$(grep -E '^PHASE_HEAD=' "$SANDBOX/ps.txt" | head -1 | sed 's/^PHASE_HEAD=//')"
  if [ -z "$runDir" ] || [ -z "$phaseHead" ]; then
    fail "phase-start did not print RUNDIR=/PHASE_HEAD= :: $(cat "$SANDBOX/ps.txt") :: $(cat "$SANDBOX/ps.err")"
    return
  fi
  [ -f "$runDir/snapshot.json" ] && pass "phase-start wrote snapshot.json" || fail "phase-start missing snapshot.json at $runDir"

  # snapshot must record predeleted.txt as baselineKind=deleted (tracked, deleted at start)
  if jq -e '.entries[] | select(.path=="predeleted.txt" and .baselineKind=="deleted")' "$runDir/snapshot.json" >/dev/null 2>&1; then
    pass "phase-start snapshot marks pre-existing deletion baselineKind=deleted"
  else
    fail "phase-start snapshot did not mark predeleted.txt deleted :: $(cat "$runDir/snapshot.json")"
  fi
  # snapshot must copy contents of the pre-existing untracked source file
  if [ -f "$runDir/snapshot/preexist_untracked.js" ] && grep -q 'untracked-v1' "$runDir/snapshot/preexist_untracked.js"; then
    pass "phase-start snapshotted pre-existing untracked source contents"
  else
    fail "phase-start did not snapshot preexist_untracked.js contents"
  fi

  # ---- mid-phase commit (must NOT move the baseline) ----
  printf 'orig-mod\nmid-phase-change\n' > "$repo/modifyme.txt"
  git -C "$repo" add modifyme.txt
  git -C "$repo" commit -qm "mid-phase commit"

  # ---- the phase's actual changes ----
  printf 'brand-new-tracked-source\n' > "$repo/newfile.js"          # (a) NEW untracked source
  printf 'untracked-v2\n' > "$repo/preexist_untracked.js"           # (b) MODIFY pre-existing untracked
  rm -f "$repo/deleteme.txt"                                         # (c) DELETION (tracked)

  # phase-review
  ( cd "$repo" && STUB_MODE=approve bash "$WRAPPER" phase-review P1 ) > "$SANDBOX/pr.txt" 2>"$SANDBOX/pr.err"
  status="$(last_json_line "$SANDBOX/pr.txt")"
  if [ -z "$status" ]; then
    fail "phase-review printed no status JSON :: $(cat "$SANDBOX/pr.txt") :: $(cat "$SANDBOX/pr.err")"
    return
  fi
  # the packet is what the wrapper piped to codex (captured by the stub)
  packet="$STUB_STDIN_DUMP"

  # (a) new untracked source present in packet
  grep -q 'brand-new-tracked-source' "$packet" && pass "phase-review packet includes NEW untracked file" \
    || fail "phase-review packet missing new untracked file content"
  grep -q 'newfile.js' "$packet" && pass "phase-review packet names newfile.js" \
    || fail "phase-review packet does not name newfile.js"

  # (b) modification to pre-existing untracked: BOTH old (v1, from snapshot baseline) and new (v2)
  grep -q 'untracked-v2' "$packet" && pass "phase-review packet includes modified untracked NEW content (v2)" \
    || fail "phase-review packet missing modified untracked v2"
  grep -q 'untracked-v1' "$packet" && pass "phase-review packet diffs untracked vs phase-start baseline (v1 in diff)" \
    || fail "phase-review packet did not anchor untracked to snapshot baseline (no v1)"

  # (c) deletion present
  grep -q 'deleteme.txt' "$packet" && pass "phase-review packet includes the deletion (deleteme.txt)" \
    || fail "phase-review packet missing deleted file deleteme.txt"

  # (d) $PHASE_HEAD anchoring: the mid-phase-committed change to modifyme.txt
  #     MUST appear (anchored to phase-start, not HEAD).
  grep -q 'mid-phase-change' "$packet" && pass "phase-review anchored to PHASE_HEAD (mid-phase commit captured)" \
    || fail "phase-review NOT anchored to PHASE_HEAD: mid-phase commit change missing"

  # (e) pre-existing deletion (predeleted.txt) must NOT be re-reported
  if grep -q 'predeleted' "$packet"; then
    fail "phase-review RE-REPORTED a pre-existing deletion (predeleted) — should be silent"
  else
    pass "phase-review does NOT re-report pre-existing deletion"
  fi
}

#############################################################################
# TEST 4 — scratch excludes
#############################################################################
run_test_4() {
  local repo runDir packet
  repo="$(make_repo)"
  printf 'seed\n' > "$repo/seed.txt"
  git -C "$repo" add seed.txt
  git -C "$repo" commit -qm init

  ( cd "$repo" && bash "$WRAPPER" phase-start P1 ) > "$SANDBOX/ps.txt" 2>"$SANDBOX/ps.err"
  runDir="$(grep -E '^RUNDIR=' "$SANDBOX/ps.txt" | head -1 | sed 's/^RUNDIR=//')"

  # Create EXCLUDED scratch changes ...
  printf 'PNGDATA-should-be-excluded\n' > "$repo/diagram.png"
  mkdir -p "$repo/.claude/context"
  printf 'CONTEXTNOTE-should-be-excluded\n' > "$repo/.claude/context/foo.md"
  # ... and INCLUDED real-surface changes
  mkdir -p "$repo/.docker"
  printf 'DOCKERCOMPOSE-should-be-included\n' > "$repo/.docker/docker-compose.yml"
  mkdir -p "$repo/.claude/skills"
  printf 'SKILLSCRIPT-should-be-included\n' > "$repo/.claude/skills/x.sh"

  ( cd "$repo" && STUB_MODE=approve bash "$WRAPPER" phase-review P1 ) > "$SANDBOX/pr.txt" 2>"$SANDBOX/pr.err"
  packet="$STUB_STDIN_DUMP"

  # GUARD: the packet must actually exist and be non-empty, otherwise the
  # "EXCLUDED" assertions below would false-green on a missing file.
  if [ ! -s "$packet" ]; then
    fail "scratch: packet was never produced (stub stdin dump empty/missing) :: $(cat "$SANDBOX/pr.err")"
    return
  fi

  if grep -q 'PNGDATA-should-be-excluded' "$packet"; then
    fail "scratch: .png content leaked into packet"
  else
    pass "scratch: .png EXCLUDED from packet"
  fi
  if grep -q 'CONTEXTNOTE-should-be-excluded' "$packet"; then
    fail "scratch: .claude/context/ content leaked into packet"
  else
    pass "scratch: .claude/context/ EXCLUDED from packet"
  fi
  if grep -q 'DOCKERCOMPOSE-should-be-included' "$packet"; then
    pass "scratch: .docker/ INCLUDED in packet"
  else
    fail "scratch: .docker/ wrongly excluded from packet"
  fi
  if grep -q 'SKILLSCRIPT-should-be-included' "$packet"; then
    pass "scratch: .claude/skills/ INCLUDED in packet"
  else
    fail "scratch: .claude/skills/ wrongly excluded from packet"
  fi
}

#############################################################################
# TEST 5 — read-only: git status unchanged; outputs under run dir; no new
#          files in the repo.
#############################################################################
run_test_5() {
  local repo before after runDir new_in_repo
  repo="$(make_repo)"
  printf 'seed\n' > "$repo/seed.txt"
  git -C "$repo" add seed.txt
  git -C "$repo" commit -qm init
  # make it dirty (tracked-dirty + untracked source)
  printf 'seed\nchange\n' > "$repo/seed.txt"
  printf 'console.log(1)\n' > "$repo/extra.js"

  # snapshot the FULL repo file listing before
  local before_files after_files
  before_files="$(cd "$repo" && find . -type f | LC_ALL=C sort)"
  before="$(git -C "$repo" status --porcelain)"

  ( cd "$repo" && bash "$WRAPPER" phase-start P1 ) > "$SANDBOX/ps.txt" 2>"$SANDBOX/ps.err"
  runDir="$(grep -E '^RUNDIR=' "$SANDBOX/ps.txt" | head -1 | sed 's/^RUNDIR=//')"
  ( cd "$repo" && STUB_MODE=approve bash "$WRAPPER" phase-review P1 ) > "$SANDBOX/pr.txt" 2>"$SANDBOX/pr.err"

  # GUARD: a status line must have been produced, otherwise the read-only
  # assertions below would false-green on a wrapper that never executed.
  if [ -z "$(last_json_line "$SANDBOX/pr.txt")" ]; then
    fail "read-only: phase-review produced no status (wrapper did not run) :: $(cat "$SANDBOX/pr.err")"
    return
  fi

  after="$(git -C "$repo" status --porcelain)"
  after_files="$(cd "$repo" && find . -type f | LC_ALL=C sort)"

  if [ "$before" = "$after" ]; then
    pass "read-only: git status --porcelain byte-identical before/after"
  else
    fail "read-only: git status changed!\n--- before ---\n$before\n--- after ---\n$after"
  fi
  if [ "$before_files" = "$after_files" ]; then
    pass "read-only: NO new files appeared in the target repo"
  else
    fail "read-only: file listing changed in repo:\n$(diff <(printf '%s' "$before_files") <(printf '%s' "$after_files"))"
  fi

  # output files exist UNDER the run dir
  local ok=0
  [ -f "$runDir/round-1-verdict.json" ] || ok=1
  [ -f "$runDir/round-1.jsonl" ] || ok=1
  [ -f "$runDir/round-1.stderr" ] || ok=1
  check "read-only: round-1 verdict/jsonl/stderr exist under run dir" "$ok"

  # run dir must be OUTSIDE the repo
  case "$runDir" in
    "$repo"/*) fail "run dir is INSIDE the repo: $runDir" ;;
    *)         pass "run dir is outside the repo ($CODEX_GATE_RUNS/...)" ;;
  esac
}

#############################################################################
# TEST 6 — stub invoked with ABSOLUTE -o and --output-schema paths
#############################################################################
run_test_6() {
  local repo o_val schema_val
  repo="$(make_repo)"
  printf 'seed\n' > "$repo/seed.txt"
  git -C "$repo" add seed.txt && git -C "$repo" commit -qm init
  printf 'x\n' > "$repo/d.js"

  reset_argv_log
  ( cd "$repo" && STUB_MODE=approve bash "$WRAPPER" phase-start P1 ) >/dev/null 2>&1
  ( cd "$repo" && STUB_MODE=approve bash "$WRAPPER" phase-review P1 ) >/dev/null 2>&1

  # extract the value following -o and following --output-schema from argv log
  o_val="$(awk 'prev=="-o"{print; exit} {prev=$0}' "$STUB_ARGV_LOG")"
  schema_val="$(awk 'prev=="--output-schema"{print; exit} {prev=$0}' "$STUB_ARGV_LOG")"

  case "$o_val" in
    /*) pass "codex received ABSOLUTE -o path ($o_val)" ;;
    *)  fail "codex -o path not absolute: '$o_val'" ;;
  esac
  case "$schema_val" in
    /*) pass "codex received ABSOLUTE --output-schema path ($schema_val)" ;;
    *)  fail "codex --output-schema path not absolute: '$schema_val'" ;;
  esac
  # -o must live under the run dir (i.e. under CODEX_GATE_RUNS)
  case "$o_val" in
    "$CODEX_GATE_RUNS"/*) pass "codex -o path is under the run dir" ;;
    *) fail "codex -o path not under run dir: '$o_val'" ;;
  esac
}

#############################################################################
# TEST 7 — fail-closed on inconsistent verdicts [FIX 4]
#   (a) verdict=approve WITH a non-empty blockers[]  -> outcome BLOCK
#   (b) verdict=request_changes with ZERO blockers    -> outcome INFRA_ERROR
#############################################################################
run_test_7() {
  # (a) approve + blockers -> BLOCK (fail closed; .verdict field is ignored when blockers>0)
  test_outcome approve_with_blockers  BLOCK       '.blockers>=1'
  # (b) request_changes + 0 blockers -> INFRA_ERROR (degenerate, surfaced)
  test_outcome reqchanges_no_blockers INFRA_ERROR ''
}

#############################################################################
# TEST 8 — plan in a git repo runs at CODE tier [FIX 1]
#   Assert the stub was invoked WITHOUT --disable shell_tool and WITHOUT
#   --skip-git-repo-check (i.e. code tier, not doc tier), with cwd = repo root.
#############################################################################
run_test_8() {
  local repo repo_phys planfile argv cwd
  repo="$(make_repo)"
  repo_phys="$(cd "$repo" && pwd -P)"   # wrapper cd's to the physical repo root
  printf 'seed\n' > "$repo/seed.txt"
  git -C "$repo" add seed.txt && git -C "$repo" commit -qm init
  # also create a repo-root AGENTS.md so the in-repo manifest has something to emit
  printf 'repo-root-agents\n' > "$repo/AGENTS.md"
  git -C "$repo" add AGENTS.md && git -C "$repo" commit -qm agents

  planfile="$SANDBOX/myplan.md"
  printf '# A plan\n\nDo the thing.\n' > "$planfile"

  reset_argv_log
  reset_cwd_log
  ( cd "$repo" && STUB_MODE=approve bash "$WRAPPER" plan "$planfile" ) > "$SANDBOX/out.txt" 2>"$SANDBOX/err.txt"

  argv="$(cat "$STUB_ARGV_LOG")"
  cwd="$(head -1 "$STUB_CWD_LOG")"

  if printf '%s' "$argv" | grep -q -- '--disable'; then
    fail "plan-in-repo: code tier expected but '--disable shell_tool' present (doc tier) :: $argv"
  else
    pass "plan-in-repo: NO '--disable shell_tool' (code tier)"
  fi
  if printf '%s' "$argv" | grep -q -- '--skip-git-repo-check'; then
    fail "plan-in-repo: code tier expected but '--skip-git-repo-check' present (doc tier)"
  else
    pass "plan-in-repo: NO '--skip-git-repo-check' (code tier)"
  fi
  # code tier always passes `-c approval_policy="never"`; bash stores the value
  # element as the bare word approval_policy=never (the literal quotes are shell
  # syntax, stripped before exec), so match that exact stored arg.
  if printf '%s' "$argv" | grep -q 'approval_policy=never'; then
    pass "plan-in-repo: code tier passes approval_policy=never"
  else
    fail "plan-in-repo: missing approval_policy=never (not code tier) :: $argv"
  fi
  # cwd must be the repo root (physical path)
  if [ "$cwd" = "$repo_phys" ]; then
    pass "plan-in-repo: codex cwd = repo root"
  else
    fail "plan-in-repo: codex cwd '$cwd' != repo root '$repo_phys'"
  fi
  # the plan text must still reach the packet (stdin)
  if grep -q 'Do the thing.' "$STUB_STDIN_DUMP"; then
    pass "plan-in-repo: plan text present in packet"
  else
    fail "plan-in-repo: plan text missing from packet"
  fi
}

#############################################################################
# TEST 9 — manifest walks ANCESTOR dirs [FIX 5]
#   projects/api/AGENTS.md must be listed for a change to
#   projects/api/services/foo.js (not just the file's exact dirname).
#############################################################################
run_test_9() {
  local repo repo_phys runDir packet
  repo="$(make_repo)"
  # The wrapper resolves REPO_ROOT via `git rev-parse --show-toplevel`, which
  # returns the PHYSICAL path (macOS $TMPDIR is /var/folders -> /private/var/...).
  # Compare against that physical path, not the symlinked temp path.
  repo_phys="$(cd "$repo" && pwd -P)"
  mkdir -p "$repo/projects/api/services"
  printf 'seed\n' > "$repo/seed.txt"
  printf 'api-agents\n' > "$repo/projects/api/AGENTS.md"
  printf 'orig\n' > "$repo/projects/api/services/foo.js"
  git -C "$repo" add . && git -C "$repo" commit -qm init

  ( cd "$repo" && bash "$WRAPPER" phase-start P1 ) > "$SANDBOX/ps.txt" 2>"$SANDBOX/ps.err"
  runDir="$(grep -E '^RUNDIR=' "$SANDBOX/ps.txt" | head -1 | sed 's/^RUNDIR=//')"

  # change the deeply-nested file
  printf 'orig\nchange\n' > "$repo/projects/api/services/foo.js"

  ( cd "$repo" && STUB_MODE=approve bash "$WRAPPER" phase-review P1 ) > "$SANDBOX/pr.txt" 2>"$SANDBOX/pr.err"
  packet="$STUB_STDIN_DUMP"

  if [ ! -s "$packet" ]; then
    fail "manifest-ancestor: packet never produced :: $(cat "$SANDBOX/pr.err")"
    return
  fi
  # the ancestor AGENTS.md (one level above the file's dir) must be in the manifest
  if grep -q "$repo_phys/projects/api/AGENTS.md" "$packet"; then
    pass "manifest-ancestor: lists projects/api/AGENTS.md for projects/api/services/foo.js"
  else
    fail "manifest-ancestor: ancestor AGENTS.md NOT listed :: manifest=$(grep -n 'AGENTS.md' "$packet" || echo none)"
  fi
}

#############################################################################
# TEST 10 — prepr unions filtered UNTRACKED source files [FIX 6]
#############################################################################
run_test_10() {
  local repo status packet
  repo="$(make_repo)"
  printf 'seed\n' > "$repo/seed.txt"
  git -C "$repo" add seed.txt && git -C "$repo" commit -qm init
  # tracked change
  printf 'seed\ntracked-change\n' > "$repo/seed.txt"
  # an UNTRACKED source file (must be unioned into the prepr diff)
  printf 'UNTRACKED-PREPR-SOURCE\n' > "$repo/brand_new.js"
  # an EXCLUDED untracked scratch file (must NOT leak)
  printf 'PREPR-PNG-EXCLUDED\n' > "$repo/pic.png"

  ( cd "$repo" && STUB_MODE=approve bash "$WRAPPER" prepr ) > "$SANDBOX/out.txt" 2>"$SANDBOX/err.txt"
  status="$(last_json_line "$SANDBOX/out.txt")"
  packet="$STUB_STDIN_DUMP"

  if [ -z "$status" ]; then
    fail "prepr-untracked: no status JSON :: $(cat "$SANDBOX/err.txt")"
    return
  fi
  if grep -q 'UNTRACKED-PREPR-SOURCE' "$packet"; then
    pass "prepr-untracked: untracked source file content present in packet"
  else
    fail "prepr-untracked: untracked source file NOT in packet"
  fi
  if grep -q 'brand_new.js' "$packet"; then
    pass "prepr-untracked: untracked source file named in packet diff"
  else
    fail "prepr-untracked: untracked source file name NOT in packet"
  fi
  if grep -q 'PREPR-PNG-EXCLUDED' "$packet"; then
    fail "prepr-untracked: excluded .png untracked leaked into packet"
  else
    pass "prepr-untracked: excluded .png untracked stays out of packet"
  fi
}

#############################################################################
# TEST 11 — phase-review includes <RUN_DIR>/context.md when present [FIX 3]
#############################################################################
run_test_11() {
  local repo runDir packet
  repo="$(make_repo)"
  printf 'seed\n' > "$repo/seed.txt"
  git -C "$repo" add seed.txt && git -C "$repo" commit -qm init

  ( cd "$repo" && bash "$WRAPPER" phase-start P1 ) > "$SANDBOX/ps.txt" 2>"$SANDBOX/ps.err"
  runDir="$(grep -E '^RUNDIR=' "$SANDBOX/ps.txt" | head -1 | sed 's/^RUNDIR=//')"
  if [ -z "$runDir" ]; then
    fail "context.md: phase-start did not print RUNDIR= :: $(cat "$SANDBOX/ps.err")"
    return
  fi

  # write the phase intent/acceptance/review context the loop driver would author
  printf 'PHASE-GOAL: wire the widget\nACCEPTANCE: widget renders\nIMPLEMENTER-REPORT: done\nCLAUDE-SPEC-REVIEW: passed\nCLAUDE-QUALITY-REVIEW: passed\nCONTEXT-SENTINEL-XYZZY\n' > "$runDir/context.md"

  # make a change so there's something to review
  printf 'seed\nchange\n' > "$repo/seed.txt"

  ( cd "$repo" && STUB_MODE=approve bash "$WRAPPER" phase-review P1 ) > "$SANDBOX/pr.txt" 2>"$SANDBOX/pr.err"
  packet="$STUB_STDIN_DUMP"

  if [ ! -s "$packet" ]; then
    fail "context.md: packet never produced :: $(cat "$SANDBOX/pr.err")"
    return
  fi
  if grep -q 'CONTEXT-SENTINEL-XYZZY' "$packet"; then
    pass "context.md: phase-review packet includes context.md contents"
  else
    fail "context.md: context.md contents NOT in packet"
  fi
  if grep -q 'PHASE INTENT / ACCEPTANCE / REVIEW CONTEXT' "$packet"; then
    pass "context.md: packet has the PHASE INTENT/ACCEPTANCE/REVIEW CONTEXT section header"
  else
    fail "context.md: section header missing from packet"
  fi
}

#############################################################################
# TEST 12 — phase-review WITHOUT context.md still works (no regression) [FIX 3]
#############################################################################
run_test_12() {
  local repo status
  repo="$(make_repo)"
  printf 'seed\n' > "$repo/seed.txt"
  git -C "$repo" add seed.txt && git -C "$repo" commit -qm init
  ( cd "$repo" && bash "$WRAPPER" phase-start P1 ) > "$SANDBOX/ps.txt" 2>"$SANDBOX/ps.err"
  printf 'seed\nchange\n' > "$repo/seed.txt"
  ( cd "$repo" && STUB_MODE=approve bash "$WRAPPER" phase-review P1 ) > "$SANDBOX/pr.txt" 2>"$SANDBOX/pr.err"
  status="$(last_json_line "$SANDBOX/pr.txt")"
  if [ "$(printf '%s' "$status" | jq -r '.outcome // empty' 2>/dev/null)" = "APPROVE" ]; then
    pass "context.md-absent: phase-review still APPROVEs with no context.md"
  else
    fail "context.md-absent: phase-review broke without context.md :: $status :: $(cat "$SANDBOX/pr.err")"
  fi
}

# test_13 (hook-arming integration, [FIX 7]) removed from the portable suite — it depends on
# owner-installed ~/.claude/hooks infrastructure and lives with that hook, not the plugin.

#############################################################################
# TEST 14 — bundle manifest uses REPO-ROOT-relative paths (ancestor walk) [FIX 5b]
#   bundle <dir> must list AGENTS.md in the bundle dir (+ ancestors), not miss them
#   by feeding build_manifest paths relative to the bundle dir instead of $REPO_ROOT.
#############################################################################
run_test_14() {
  local repo repo_phys packet
  repo="$(make_repo)"
  repo_phys="$(cd "$repo" && pwd -P)"
  mkdir -p "$repo/docs/pdr"
  printf 'pdr-agents\n' > "$repo/docs/pdr/AGENTS.md"
  printf '# plan\n' > "$repo/docs/pdr/plan.md"
  git -C "$repo" add . && git -C "$repo" commit -qm init

  ( cd "$repo" && STUB_MODE=approve bash "$WRAPPER" bundle docs/pdr ) > "$SANDBOX/b.txt" 2>"$SANDBOX/b.err"
  packet="$STUB_STDIN_DUMP"
  if [ ! -s "$packet" ]; then
    fail "bundle-manifest: packet never produced :: $(cat "$SANDBOX/b.err")"
    return
  fi
  if grep -q "$repo_phys/docs/pdr/AGENTS.md" "$packet"; then
    pass "bundle-manifest: lists docs/pdr/AGENTS.md for bundle docs/pdr"
  else
    fail "bundle-manifest: bundle-dir AGENTS.md NOT listed :: manifest=$(grep -n 'AGENTS.md' "$packet" || echo none)"
  fi
}

#############################################################################
# TEST 15 — question <file> grounds a decision (GROUNDED outcome) [QUESTION MODE]
#   In a temp git repo with STUB_MODE=grounded:
#     - status outcome == "GROUNDED", settledByCanon == false, recommendation non-empty
#     - the packet (stdin) contains BOTH the decision file's text AND the
#       question-instructions persona ("senior architecture advisor grounding a DECISION")
#     - the packet has the DECISION TO GROUND section header
#############################################################################
run_test_15() {
  local repo qfile status outcome packet
  repo="$(make_repo)"
  printf 'seed\n' > "$repo/seed.txt"
  git -C "$repo" add seed.txt && git -C "$repo" commit -qm init

  qfile="$SANDBOX/decision.md"
  printf 'DECISION: how do we persist run events?\n\nCONTEXT: high write volume.\n\nOPTIONS:\n- Option A: a dedicated append-only table\n- Option B: reuse the existing jobs table\n\nQUESTION-SENTINEL-PERSIST-EVENTS\n' > "$qfile"

  ( cd "$repo" && STUB_MODE=grounded bash "$WRAPPER" question "$qfile" ) > "$SANDBOX/q.txt" 2>"$SANDBOX/q.err"
  status="$(last_json_line "$SANDBOX/q.txt")"
  packet="$STUB_STDIN_DUMP"

  if [ -z "$status" ]; then
    fail "question-grounded: no status JSON :: $(cat "$SANDBOX/q.txt") :: $(cat "$SANDBOX/q.err")"
    return
  fi
  outcome="$(printf '%s' "$status" | jq -r '.outcome // empty' 2>/dev/null)"
  if [ "$outcome" = "GROUNDED" ]; then
    pass "question-grounded: outcome == GROUNDED"
  else
    fail "question-grounded: expected GROUNDED got '$outcome' :: $status :: $(cat "$SANDBOX/q.err")"
  fi
  if printf '%s' "$status" | jq -e '.settledByCanon == false' >/dev/null 2>&1; then
    pass "question-grounded: settledByCanon == false"
  else
    fail "question-grounded: settledByCanon not false :: $status"
  fi
  if [ -n "$(printf '%s' "$status" | jq -r '.recommendation // ""' 2>/dev/null)" ]; then
    pass "question-grounded: recommendation is non-empty"
  else
    fail "question-grounded: recommendation empty :: $status"
  fi
  # status.summary must be the grounding rationale
  if [ -n "$(printf '%s' "$status" | jq -r '.summary // ""' 2>/dev/null)" ]; then
    pass "question-grounded: summary (rationale) is non-empty"
  else
    fail "question-grounded: summary empty :: $status"
  fi
  # packet must carry the decision file text
  if grep -q 'QUESTION-SENTINEL-PERSIST-EVENTS' "$packet"; then
    pass "question-grounded: packet includes the decision file text"
  else
    fail "question-grounded: decision file text NOT in packet"
  fi
  # packet must carry the question-grounding persona (NOT the reviewer persona)
  if grep -q 'senior architecture advisor grounding a DECISION' "$packet"; then
    pass "question-grounded: packet includes the question-instructions persona"
  else
    fail "question-grounded: question-instructions persona NOT in packet"
  fi
  # packet must have the DECISION TO GROUND section header
  if grep -q 'DECISION TO GROUND' "$packet"; then
    pass "question-grounded: packet has the DECISION TO GROUND section header"
  else
    fail "question-grounded: DECISION TO GROUND header missing from packet"
  fi
}

#############################################################################
# TEST 16 — question settled-by-canon path [QUESTION MODE]
#   STUB_MODE=grounded_settled -> status settledByCanon == true and canonAnswer non-empty.
#############################################################################
run_test_16() {
  local repo qfile status
  repo="$(make_repo)"
  printf 'seed\n' > "$repo/seed.txt"
  git -C "$repo" add seed.txt && git -C "$repo" commit -qm init

  qfile="$SANDBOX/decision2.md"
  printf 'DECISION: where do run events go?\n\nOPTIONS:\n- Option A: dedicated table\n' > "$qfile"

  ( cd "$repo" && STUB_MODE=grounded_settled bash "$WRAPPER" question "$qfile" ) > "$SANDBOX/q.txt" 2>"$SANDBOX/q.err"
  status="$(last_json_line "$SANDBOX/q.txt")"
  if [ -z "$status" ]; then
    fail "question-settled: no status JSON :: $(cat "$SANDBOX/q.err")"
    return
  fi
  # still GROUNDED outcome (the wrapper grounds regardless; canon-settled is a field)
  if [ "$(printf '%s' "$status" | jq -r '.outcome // empty' 2>/dev/null)" = "GROUNDED" ]; then
    pass "question-settled: outcome == GROUNDED"
  else
    fail "question-settled: outcome != GROUNDED :: $status"
  fi
  if printf '%s' "$status" | jq -e '.settledByCanon == true' >/dev/null 2>&1; then
    pass "question-settled: settledByCanon == true"
  else
    fail "question-settled: settledByCanon not true :: $status"
  fi
  # canonAnswer must be non-empty in the verdict file
  local verdictPath canonAnswer
  verdictPath="$(printf '%s' "$status" | jq -r '.verdictPath // empty' 2>/dev/null)"
  if [ -n "$verdictPath" ] && [ -f "$verdictPath" ]; then
    canonAnswer="$(jq -r '.canonAnswer // ""' "$verdictPath" 2>/dev/null)"
    if [ -n "$canonAnswer" ]; then
      pass "question-settled: canonAnswer is non-empty"
    else
      fail "question-settled: canonAnswer empty :: $(cat "$verdictPath")"
    fi
  else
    fail "question-settled: verdictPath missing or not a file :: $status"
  fi
}

#############################################################################
# TEST 17 — question mode fails closed on infra errors [QUESTION MODE]
#   nonzero codex exit and invalid-JSON -o must both -> outcome INFRA_ERROR.
#############################################################################
run_test_17() {
  local repo qfile status
  repo="$(make_repo)"
  printf 'seed\n' > "$repo/seed.txt"
  git -C "$repo" add seed.txt && git -C "$repo" commit -qm init
  qfile="$SANDBOX/decision3.md"
  printf 'DECISION: x?\n\nOPTIONS:\n- Option A\n- Option B\n' > "$qfile"

  # (a) nonzero exit
  ( cd "$repo" && STUB_MODE=nonzero bash "$WRAPPER" question "$qfile" ) > "$SANDBOX/q.txt" 2>"$SANDBOX/q.err"
  status="$(last_json_line "$SANDBOX/q.txt")"
  if [ "$(printf '%s' "$status" | jq -r '.outcome // empty' 2>/dev/null)" = "INFRA_ERROR" ]; then
    pass "question-infra: nonzero codex exit -> INFRA_ERROR"
  else
    fail "question-infra: nonzero did not yield INFRA_ERROR :: $status"
  fi

  # (b) invalid JSON in the -o file
  ( cd "$repo" && STUB_MODE=invalidjson bash "$WRAPPER" question "$qfile" ) > "$SANDBOX/q.txt" 2>"$SANDBOX/q.err"
  status="$(last_json_line "$SANDBOX/q.txt")"
  if [ "$(printf '%s' "$status" | jq -r '.outcome // empty' 2>/dev/null)" = "INFRA_ERROR" ]; then
    pass "question-infra: invalid-JSON -o -> INFRA_ERROR"
  else
    fail "question-infra: invalid-JSON did not yield INFRA_ERROR :: $status"
  fi

  # (c) missing/empty file argument errors out (not a grounding)
  ( cd "$repo" && STUB_MODE=grounded bash "$WRAPPER" question "$SANDBOX/does-not-exist.md" ) > "$SANDBOX/q.txt" 2>"$SANDBOX/q.err"
  status="$(last_json_line "$SANDBOX/q.txt")"
  # the wrapper exits nonzero with an error message (no JSON status) for a missing file
  if [ -z "$status" ] && grep -qi 'not' "$SANDBOX/q.err"; then
    pass "question-infra: missing decision file errors out (no grounding)"
  else
    fail "question-infra: missing file did not error cleanly :: status=$status :: err=$(cat "$SANDBOX/q.err")"
  fi
}

#############################################################################
# TEST 18 — question runs at CODE tier in a repo + uses question.schema.json [QUESTION MODE]
#   Stub invoked WITHOUT --disable shell_tool / --skip-git-repo-check (code tier),
#   with --output-schema pointing at question.schema.json (NOT verdict.schema.json),
#   cwd = repo root.
#############################################################################
run_test_18() {
  local repo repo_phys qfile argv cwd schema_val
  repo="$(make_repo)"
  repo_phys="$(cd "$repo" && pwd -P)"
  printf 'seed\n' > "$repo/seed.txt"
  git -C "$repo" add seed.txt && git -C "$repo" commit -qm init
  printf 'repo-root-agents\n' > "$repo/AGENTS.md"
  git -C "$repo" add AGENTS.md && git -C "$repo" commit -qm agents

  qfile="$SANDBOX/decision4.md"
  printf 'DECISION: y?\n\nOPTIONS:\n- Option A\n- Option B\n' > "$qfile"

  reset_argv_log
  reset_cwd_log
  ( cd "$repo" && STUB_MODE=grounded bash "$WRAPPER" question "$qfile" ) > "$SANDBOX/q.txt" 2>"$SANDBOX/q.err"
  argv="$(cat "$STUB_ARGV_LOG")"
  cwd="$(head -1 "$STUB_CWD_LOG")"

  if printf '%s' "$argv" | grep -q -- '--disable'; then
    fail "question-codetier: code tier expected but '--disable shell_tool' present (doc tier) :: $argv"
  else
    pass "question-codetier: NO '--disable shell_tool' (code tier)"
  fi
  if printf '%s' "$argv" | grep -q -- '--skip-git-repo-check'; then
    fail "question-codetier: code tier expected but '--skip-git-repo-check' present (doc tier)"
  else
    pass "question-codetier: NO '--skip-git-repo-check' (code tier)"
  fi
  if printf '%s' "$argv" | grep -q 'approval_policy=never'; then
    pass "question-codetier: code tier passes approval_policy=never"
  else
    fail "question-codetier: missing approval_policy=never (not code tier) :: $argv"
  fi
  # the --output-schema must point at question.schema.json (NOT verdict.schema.json)
  schema_val="$(awk 'prev=="--output-schema"{print; exit} {prev=$0}' "$STUB_ARGV_LOG")"
  case "$schema_val" in
    */question.schema.json) pass "question-codetier: --output-schema is question.schema.json ($schema_val)" ;;
    *) fail "question-codetier: --output-schema not question.schema.json: '$schema_val'" ;;
  esac
  case "$schema_val" in
    /*) pass "question-codetier: --output-schema path is absolute" ;;
    *)  fail "question-codetier: --output-schema path not absolute: '$schema_val'" ;;
  esac
  # cwd must be the repo root (physical path) — code tier
  if [ "$cwd" = "$repo_phys" ]; then
    pass "question-codetier: codex cwd = repo root"
  else
    fail "question-codetier: codex cwd '$cwd' != repo root '$repo_phys'"
  fi
}

#############################################################################
# TEST 19 — question is read-only: git status --porcelain unchanged [QUESTION MODE]
#############################################################################
run_test_19() {
  local repo before after qfile status
  repo="$(make_repo)"
  printf 'seed\n' > "$repo/seed.txt"
  git -C "$repo" add seed.txt && git -C "$repo" commit -qm init
  # make it dirty so there is a non-empty porcelain to preserve
  printf 'seed\nchange\n' > "$repo/seed.txt"
  printf 'console.log(1)\n' > "$repo/extra.js"

  qfile="$SANDBOX/decision5.md"
  printf 'DECISION: z?\n\nOPTIONS:\n- Option A\n- Option B\n' > "$qfile"

  before="$(git -C "$repo" status --porcelain)"
  ( cd "$repo" && STUB_MODE=grounded bash "$WRAPPER" question "$qfile" ) > "$SANDBOX/q.txt" 2>"$SANDBOX/q.err"
  status="$(last_json_line "$SANDBOX/q.txt")"
  if [ -z "$status" ]; then
    fail "question-readonly: produced no status (wrapper did not run) :: $(cat "$SANDBOX/q.err")"
    return
  fi
  after="$(git -C "$repo" status --porcelain)"
  if [ "$before" = "$after" ]; then
    pass "question-readonly: git status --porcelain byte-identical before/after"
  else
    fail "question-readonly: git status changed!\n--- before ---\n$before\n--- after ---\n$after"
  fi
}

#############################################################################
# TEST 20 — fast mode: CODEX_GATE_FAST default-ON adds fast flags (both via the
#   shared tail), CODEX_GATE_FAST=0 omits them, and gpt-5.6-sol/ultra stay intact. [FAST]
#############################################################################
run_test_20() {
  local repo qfile argv_on argv_off
  repo="$(make_repo)"
  printf 'seed\n' > "$repo/seed.txt"
  git -C "$repo" add seed.txt && git -C "$repo" commit -qm init
  qfile="$SANDBOX/decision_fast.md"
  printf 'DECISION: x?\n\nOPTIONS:\n- Option A\n- Option B\n' > "$qfile"

  # default (CODEX_GATE_FAST unset -> 1): fast flags present
  reset_argv_log
  ( cd "$repo" && STUB_MODE=grounded bash "$WRAPPER" question "$qfile" ) > "$SANDBOX/f1.txt" 2>"$SANDBOX/f1.err"
  argv_on="$(cat "$STUB_ARGV_LOG")"
  if printf '%s' "$argv_on" | grep -q 'fast_mode' && printf '%s' "$argv_on" | grep -q 'service_tier="fast"'; then
    pass 'fast-mode: default ON passes --enable fast_mode + service_tier="fast"'
  else
    fail "fast-mode: default did NOT pass fast flags :: $argv_on"
  fi
  # fast != dumb: model + reasoning effort must remain
  if printf '%s' "$argv_on" | grep -q 'gpt-5.6-sol' && printf '%s' "$argv_on" | grep -q 'model_reasoning_effort="ultra"'; then
    pass "fast-mode: gpt-5.6-sol model + ultra reasoning effort preserved under fast mode"
  else
    fail "fast-mode: model/reasoning defaults NOT preserved under fast mode :: $argv_on"
  fi

  # CODEX_GATE_FAST=0: fast flags absent
  reset_argv_log
  ( cd "$repo" && CODEX_GATE_FAST=0 STUB_MODE=grounded bash "$WRAPPER" question "$qfile" ) > "$SANDBOX/f0.txt" 2>"$SANDBOX/f0.err"
  argv_off="$(cat "$STUB_ARGV_LOG")"
  if printf '%s' "$argv_off" | grep -q 'fast_mode'; then
    fail "fast-mode: CODEX_GATE_FAST=0 still passed fast_mode :: $argv_off"
  else
    pass "fast-mode: CODEX_GATE_FAST=0 omits fast flags"
  fi
}

#############################################################################
# TEST 21 — runtime OVERFLOW classification [TIER 1]
#   STUB_MODE=overflow -> codex exits nonzero AND the round JSONL carries the
#   context-window turn.failed signature -> outcome OVERFLOW (distinct from
#   INFRA_ERROR).
#############################################################################
run_test_21() {
  test_outcome overflow OVERFLOW '.outcome=="OVERFLOW"'
}

#############################################################################
# TEST 22 — lean code-tier packet [TIER 1]
#   In a phase, touch a BIG file (>CODEX_GATE_INLINE_MAX_LINES) and a SMALL file
#   (<= the cap). The phase-review packet must:
#     (a) list BOTH files in the TOUCHED FILES (diffstat) section with line counts,
#     (b) NOT inline the big file's body (a sentinel line deep in the big file is
#         ABSENT) but emit the "inspect via read-only shell" note for it,
#     (c) DOES inline the small file's body (its sentinel IS present),
#     (d) still contains the diff hunks for the change.
#############################################################################
run_test_22() {
  local repo runDir packet i
  repo="$(make_repo)"
  printf 'seed\n' > "$repo/seed.txt"
  # BIG file: > 120 lines (default CODEX_GATE_INLINE_MAX_LINES). COMMIT it first
  # with a unique sentinel DEEP inside (line ~150) so the phase produces a small
  # hunk (not a whole-file +dump): then "sentinel absent from packet" cleanly
  # means "body not inlined" without colliding with hunks-never-dropped.
  {
    for i in $(seq 1 149); do printf 'bigline-%s\n' "$i"; done
    printf 'BIGFILE-DEEP-SENTINEL-OMITME\n'
    for i in $(seq 151 200); do printf 'bigline-%s\n' "$i"; done
  } > "$repo/bigfile.js"
  git -C "$repo" add seed.txt bigfile.js && git -C "$repo" commit -qm init

  ( cd "$repo" && bash "$WRAPPER" phase-start P1 ) > "$SANDBOX/ps.txt" 2>"$SANDBOX/ps.err"
  runDir="$(grep -E '^RUNDIR=' "$SANDBOX/ps.txt" | head -1 | sed 's/^RUNDIR=//')"
  if [ -z "$runDir" ]; then
    fail "lean-packet: phase-start did not print RUNDIR= :: $(cat "$SANDBOX/ps.err")"
    return
  fi

  # Change ONE line at the TOP of the big file (far from the deep sentinel) so the
  # hunk does NOT carry the deep sentinel as context. The file stays > 120 lines.
  perl -0pi -e 's/^bigline-1$/BIGFILE-TOP-CHANGE/m' "$repo/bigfile.js" 2>/dev/null \
    || sed -i '' 's/^bigline-1$/BIGFILE-TOP-CHANGE/' "$repo/bigfile.js"

  # SMALL file (new, <= 120 lines), with a unique sentinel that MUST be inlined.
  printf 'small-1\nSMALLFILE-SENTINEL-KEEPME\nsmall-3\n' > "$repo/smallfile.js"

  ( cd "$repo" && STUB_MODE=approve bash "$WRAPPER" phase-review P1 ) > "$SANDBOX/pr.txt" 2>"$SANDBOX/pr.err"
  packet="$STUB_STDIN_DUMP"
  if [ ! -s "$packet" ]; then
    fail "lean-packet: packet never produced :: $(cat "$SANDBOX/pr.err")"
    return
  fi

  # (a) diffstat section lists BOTH files with line counts
  if grep -q 'TOUCHED FILES (diffstat)' "$packet"; then
    pass "lean-packet: packet has the TOUCHED FILES (diffstat) section header"
  else
    fail "lean-packet: TOUCHED FILES (diffstat) section header missing"
  fi
  if grep -Eq 'bigfile\.js[[:space:]]+\(20[0-9] lines\)' "$packet"; then
    pass "lean-packet: diffstat lists bigfile.js with its line count"
  else
    fail "lean-packet: diffstat missing bigfile.js line count :: $(grep -n 'bigfile.js' "$packet" || echo none)"
  fi
  if grep -Eq 'smallfile\.js[[:space:]]+\(3 lines\)' "$packet"; then
    pass "lean-packet: diffstat lists smallfile.js with its line count"
  else
    fail "lean-packet: diffstat missing smallfile.js line count :: $(grep -n 'smallfile.js' "$packet" || echo none)"
  fi

  # (b) big file body NOT inlined: its deep sentinel must be ABSENT (it is far from
  #     the changed hunk, so it does not appear as diff context either).
  if grep -q 'BIGFILE-DEEP-SENTINEL-OMITME' "$packet"; then
    fail "lean-packet: BIG file body was inlined (deep sentinel present) — should be omitted"
  else
    pass "lean-packet: BIG file body NOT inlined (deep sentinel absent)"
  fi
  # ... and the inspect-via-shell note must be present for it
  if grep -q 'body NOT inlined' "$packet" && grep -q 'inspect via read-only shell' "$packet"; then
    pass "lean-packet: BIG file carries the 'inspect via read-only shell' note"
  else
    fail "lean-packet: missing the 'body NOT inlined / inspect via read-only shell' note"
  fi

  # (c) small file body IS inlined: its sentinel must be PRESENT
  if grep -q 'SMALLFILE-SENTINEL-KEEPME' "$packet"; then
    pass "lean-packet: SMALL file body IS inlined (sentinel present)"
  else
    fail "lean-packet: SMALL file body was NOT inlined (sentinel absent)"
  fi

  # (d) diff hunks for the change are still present (bodies omitted != hunks dropped):
  #     the big file's TOP change appears in the diff section.
  if grep -q 'END DIFF' "$packet" && grep -q 'BIGFILE-TOP-CHANGE' "$packet"; then
    pass "lean-packet: scoped DIFF section still present (hunks not dropped)"
  else
    fail "lean-packet: DIFF section missing — hunks were dropped"
  fi
}

#############################################################################
# TEST 23 — pre-flight budget guard [TIER 1]
#   With CODEX_GATE_PACKET_BUDGET=50, the assembled packet exceeds the budget,
#   so phase-review returns outcome=OVERFLOW and the stub is NEVER invoked
#   (empty argv log; no verdict file written by the stub).
#############################################################################
run_test_23() {
  local repo runDir status outcome
  repo="$(make_repo)"
  printf 'seed\n' > "$repo/seed.txt"
  git -C "$repo" add seed.txt && git -C "$repo" commit -qm init

  ( cd "$repo" && bash "$WRAPPER" phase-start P1 ) > "$SANDBOX/ps.txt" 2>"$SANDBOX/ps.err"
  runDir="$(grep -E '^RUNDIR=' "$SANDBOX/ps.txt" | head -1 | sed 's/^RUNDIR=//')"
  if [ -z "$runDir" ]; then
    fail "budget-guard: phase-start did not print RUNDIR= :: $(cat "$SANDBOX/ps.err")"
    return
  fi

  printf 'seed\nchange\n' > "$repo/seed.txt"

  reset_argv_log
  ( cd "$repo" && CODEX_GATE_PACKET_BUDGET=50 STUB_MODE=approve bash "$WRAPPER" phase-review P1 ) > "$SANDBOX/pr.txt" 2>"$SANDBOX/pr.err"
  status="$(last_json_line "$SANDBOX/pr.txt")"
  outcome="$(printf '%s' "$status" | jq -r '.outcome // empty' 2>/dev/null)"

  if [ "$outcome" = "OVERFLOW" ]; then
    pass "budget-guard: over-budget packet -> outcome OVERFLOW"
  else
    fail "budget-guard: expected OVERFLOW got '$outcome' :: $status :: $(cat "$SANDBOX/pr.err")"
  fi
  # the stub must NOT have been invoked (no argv recorded)
  if [ -s "$STUB_ARGV_LOG" ]; then
    fail "budget-guard: stub WAS invoked over budget (argv log non-empty) :: $(cat "$STUB_ARGV_LOG")"
  else
    pass "budget-guard: stub was NEVER invoked over budget (argv log empty)"
  fi
  # and no verdict file written for this round
  if [ -f "$runDir/round-1-verdict.json" ]; then
    fail "budget-guard: a verdict file was written despite over-budget short-circuit"
  else
    pass "budget-guard: no verdict file written (codex never ran)"
  fi
}

#############################################################################
# TEST 24 — hunks never dropped even when bodies omitted [TIER 1 INVARIANT]
#   A BIG file's body is omitted, but the DIFF section header AND a changed line
#   from that big file MUST still appear in the packet.
#############################################################################
run_test_24() {
  local repo runDir packet i
  repo="$(make_repo)"
  printf 'seed\n' > "$repo/seed.txt"
  git -C "$repo" add seed.txt && git -C "$repo" commit -qm init

  # commit a BIG file first so the phase produces a real hunk (not a whole-new-file)
  {
    for i in $(seq 1 200); do printf 'origline-%s\n' "$i"; done
  } > "$repo/huge.js"
  git -C "$repo" add huge.js && git -C "$repo" commit -qm huge

  ( cd "$repo" && bash "$WRAPPER" phase-start P1 ) > "$SANDBOX/ps.txt" 2>"$SANDBOX/ps.err"
  runDir="$(grep -E '^RUNDIR=' "$SANDBOX/ps.txt" | head -1 | sed 's/^RUNDIR=//')"
  if [ -z "$runDir" ]; then
    fail "hunks-kept: phase-start did not print RUNDIR= :: $(cat "$SANDBOX/ps.err")"
    return
  fi

  # change ONE line deep in the big file -> a single hunk with a unique changed line
  perl -0pi -e 's/origline-100/CHANGED-HUNK-LINE-MARKER/' "$repo/huge.js" 2>/dev/null \
    || sed -i '' 's/origline-100/CHANGED-HUNK-LINE-MARKER/' "$repo/huge.js"

  ( cd "$repo" && STUB_MODE=approve bash "$WRAPPER" phase-review P1 ) > "$SANDBOX/pr.txt" 2>"$SANDBOX/pr.err"
  packet="$STUB_STDIN_DUMP"
  if [ ! -s "$packet" ]; then
    fail "hunks-kept: packet never produced :: $(cat "$SANDBOX/pr.err")"
    return
  fi

  # the big file body must be omitted (a non-changed deep line must NOT be inlined)
  if grep -q 'origline-150' "$packet"; then
    fail "hunks-kept: big file body was inlined (origline-150 present) — should be omitted"
  else
    pass "hunks-kept: big file body omitted (a non-changed deep line absent)"
  fi
  # but the DIFF section header is present
  if grep -q 'END DIFF' "$packet"; then
    pass "hunks-kept: DIFF section header present"
  else
    fail "hunks-kept: DIFF section header missing"
  fi
  # and the changed line from the hunk IS present (hunks never dropped)
  if grep -q 'CHANGED-HUNK-LINE-MARKER' "$packet"; then
    pass "hunks-kept: the changed hunk line is present in the packet"
  else
    fail "hunks-kept: changed hunk line MISSING — hunks were dropped!"
  fi
}

#############################################################################
# TEST 25 — review LEDGER written on APPROVE; NOT written on a block [TIER 2]
#   (a) An APPROVE'd phase-review appends ONE JSONL line to ledger.jsonl at the
#       WORKTREE level (one level above the session dir), and the entry records the
#       changed file with its current git hash-object sha + the mode + a verdictPath.
#   (b) A block_fixable phase-review must NOT append to the ledger (only an approved
#       surface is "reviewed").
#############################################################################
run_test_25() {
  local repo runDir ledger entry sha_expect
  repo="$(make_repo)"
  printf 'seed\n' > "$repo/seed.txt"
  git -C "$repo" add seed.txt && git -C "$repo" commit -qm init

  # --- (a) APPROVE writes the ledger ---
  ( cd "$repo" && bash "$WRAPPER" phase-start P1 ) > "$SANDBOX/ps.txt" 2>"$SANDBOX/ps.err"
  runDir="$(grep -E '^RUNDIR=' "$SANDBOX/ps.txt" | head -1 | sed 's/^RUNDIR=//')"
  if [ -z "$runDir" ]; then
    fail "ledger: phase-start did not print RUNDIR= :: $(cat "$SANDBOX/ps.err")"
    return
  fi
  # change a file so there's a reviewed surface
  printf 'seed\nLEDGER-CHANGE\n' > "$repo/seed.txt"
  ( cd "$repo" && STUB_MODE=approve bash "$WRAPPER" phase-review P1 ) > "$SANDBOX/pr.txt" 2>"$SANDBOX/pr.err"

  # The ledger lives at the WORKTREE level: one dir ABOVE the session dir. The runDir is
  # .../<repoSlug>-<hash>/<wtkey>/<session>/<phaseKey>; ledger = .../<wtkey>/ledger.jsonl.
  ledger="$(dirname "$(dirname "$runDir")")/ledger.jsonl"
  if [ -f "$ledger" ]; then
    pass "ledger: ledger.jsonl exists at the worktree level after APPROVE"
  else
    fail "ledger: ledger.jsonl NOT found at worktree level ($ledger) :: $(cat "$SANDBOX/pr.err")"
    return
  fi
  # ledger must NOT be inside the repo
  case "$ledger" in
    "$repo"/*) fail "ledger: ledger.jsonl is INSIDE the repo: $ledger" ;;
    *)         pass "ledger: ledger.jsonl is outside the repo (under runs/)" ;;
  esac
  # exactly one entry; entry has mode=phase-review and reviewedPaths with seed.txt + its sha
  entry="$(tail -1 "$ledger")"
  if printf '%s' "$entry" | jq -e '.mode=="phase-review"' >/dev/null 2>&1; then
    pass "ledger: entry records mode=phase-review"
  else
    fail "ledger: entry missing mode=phase-review :: $entry"
  fi
  sha_expect="$(git -C "$repo" hash-object -- seed.txt 2>/dev/null)"
  if printf '%s' "$entry" | jq -e --arg p seed.txt --arg s "$sha_expect" \
       '.reviewedPaths[] | select(.path==$p and .sha==$s)' >/dev/null 2>&1; then
    pass "ledger: entry records the changed file with its git hash-object sha"
  else
    fail "ledger: entry missing seed.txt @ $sha_expect :: $entry"
  fi
  if [ -n "$(printf '%s' "$entry" | jq -r '.verdictPath // ""' 2>/dev/null)" ]; then
    pass "ledger: entry records a verdictPath"
  else
    fail "ledger: entry missing verdictPath :: $entry"
  fi

  # --- (b) a block_fixable review does NOT append ---
  local before_lines after_lines
  before_lines="$(wc -l < "$ledger" | tr -d ' ')"
  printf 'seed\nLEDGER-CHANGE\nMORE\n' > "$repo/seed.txt"
  ( cd "$repo" && STUB_MODE=block_fixable bash "$WRAPPER" phase-review P1 2 ) > "$SANDBOX/pr2.txt" 2>"$SANDBOX/pr2.err"
  after_lines="$(wc -l < "$ledger" | tr -d ' ')"
  if [ "$before_lines" = "$after_lines" ]; then
    pass "ledger: a block_fixable review does NOT append to the ledger"
  else
    fail "ledger: block_fixable WRONGLY appended ($before_lines -> $after_lines)"
  fi
}

#############################################################################
# TEST 26 — prepr-delta scopes to changed-since-reviewed + new; skips unchanged [TIER 2]
#   Seed the ledger by APPROVING a prepr over files A and C at their current shas.
#   Then: change A (sha mismatch), add NEW file B, leave C unchanged (sha match).
#   prepr-delta must:
#     - REVIEW the changed A and the new B (their content reaches the packet),
#     - put C in the "ALREADY REVIEWED & UNCHANGED" section with its sha shown,
#     - and NOT carry C's body into the reviewed surface.
#############################################################################
run_test_26() {
  local repo status packet sha_c root
  repo="$(make_repo)"
  # ROOT commit holds A and C at their ORIGINAL content. The branch then modifies BOTH
  # A and C so both appear in `git diff <root>` and both get recorded in the seed ledger.
  printf 'AAA-root\n' > "$repo/A.js"
  printf 'CCC-root\n' > "$repo/C.js"
  git -C "$repo" add A.js C.js && git -C "$repo" commit -qm init
  root="$(git -C "$repo" rev-list --max-parents=0 HEAD | head -1)"
  # branch commit: change A and C so both are in the diff vs root
  printf 'AAA-reviewed\n' > "$repo/A.js"
  printf 'CCC-stable-reviewed\n' > "$repo/C.js"
  git -C "$repo" add A.js C.js && git -C "$repo" commit -qm branch

  # --- seed the ledger: approve a prepr vs root so A AND C are recorded at current shas ---
  ( cd "$repo" && STUB_MODE=approve bash "$WRAPPER" prepr "$root" ) > "$SANDBOX/seed.txt" 2>"$SANDBOX/seed.err"
  status="$(last_json_line "$SANDBOX/seed.txt")"
  if [ "$(printf '%s' "$status" | jq -r '.outcome // empty')" != "APPROVE" ]; then
    fail "prepr-delta: seed prepr did not APPROVE :: $status :: $(cat "$SANDBOX/seed.err")"
    return
  fi
  # C's reviewed sha (it stays unchanged after the seed -> must be SKIPPED by the delta)
  sha_c="$(git -C "$repo" hash-object -- C.js)"

  # --- now: change A (sha mismatch), add B (new untracked), leave C at its reviewed sha ---
  printf 'AAA-CHANGED-SINCE-REVIEW\n' > "$repo/A.js"
  printf 'BBB-BRAND-NEW\n' > "$repo/B.js"

  # run prepr-delta against the root (same base) so the candidate universe = {A, B, C};
  # the ledger should knock C out (unchanged) but keep A (changed) and B (new/unreviewed).
  ( cd "$repo" && STUB_MODE=approve bash "$WRAPPER" prepr-delta "$root" ) > "$SANDBOX/d.txt" 2>"$SANDBOX/d.err"
  status="$(last_json_line "$SANDBOX/d.txt")"
  packet="$STUB_STDIN_DUMP"
  if [ -z "$status" ]; then
    fail "prepr-delta: no status JSON :: $(cat "$SANDBOX/d.txt") :: $(cat "$SANDBOX/d.err")"
    return
  fi
  if [ ! -s "$packet" ]; then
    fail "prepr-delta: packet never produced (stub stdin empty) :: $(cat "$SANDBOX/d.err")"
    return
  fi

  # changed A reviewed
  if grep -q 'AAA-CHANGED-SINCE-REVIEW' "$packet"; then
    pass "prepr-delta: CHANGED-since-reviewed file A is reviewed (new content in packet)"
  else
    fail "prepr-delta: changed A NOT in the reviewed packet"
  fi
  # new B reviewed
  if grep -q 'BBB-BRAND-NEW' "$packet"; then
    pass "prepr-delta: NEW unreviewed file B is reviewed (content in packet)"
  else
    fail "prepr-delta: new B NOT in the reviewed packet"
  fi
  # the ALREADY REVIEWED & UNCHANGED section exists and lists C with its sha
  if grep -q 'ALREADY REVIEWED & UNCHANGED' "$packet"; then
    pass "prepr-delta: packet has the ALREADY REVIEWED & UNCHANGED section"
  else
    fail "prepr-delta: missing the ALREADY REVIEWED & UNCHANGED section"
  fi
  if grep -Eq "C\.js[[:space:]]+$sha_c" "$packet"; then
    pass "prepr-delta: unchanged file C is listed with its sha (proof, not silent)"
  else
    fail "prepr-delta: C.js + sha not shown in the already-reviewed section :: $(grep -n 'C.js' "$packet" || echo none)"
  fi
  # C's body must NOT be in the reviewed surface (the FULL CONTENTS section).
  # C.js content 'CCC-stable' may appear ONLY in the already-reviewed listing; assert it is
  # not present in the diff hunks (no '+CCC-stable' / no FULL CONTENTS dump of C).
  if grep -Eq '^\+?CCC-stable$' "$packet"; then
    fail "prepr-delta: unchanged C body leaked into the reviewed surface"
  else
    pass "prepr-delta: unchanged C body NOT carried into the reviewed surface"
  fi
  # coverage: reviewedNow counts A + B (>=2), priorHashMatch counts C (>=1)
  if printf '%s' "$status" | jq -e '.coverage.reviewedNow >= 2 and .coverage.priorHashMatch >= 1' >/dev/null 2>&1; then
    pass "prepr-delta: coverage reviewedNow>=2 (A,B) and priorHashMatch>=1 (C)"
  else
    fail "prepr-delta: coverage counts wrong :: $(printf '%s' "$status" | jq -c '.coverage')"
  fi
}

#############################################################################
# TEST 27 — prepr-delta with EVERYTHING reviewed+unchanged -> APPROVE, no codex [TIER 2]
#   Seed the ledger approving the whole branch surface at current shas, then run
#   prepr-delta with NO further changes: it must APPROVE WITHOUT invoking the stub
#   (empty argv log) and the summary must mention "already reviewed".
#############################################################################
run_test_27() {
  local repo status outcome root
  repo="$(make_repo)"
  printf 'one\n' > "$repo/one.js"
  printf 'two\n' > "$repo/two.js"
  git -C "$repo" add one.js two.js && git -C "$repo" commit -qm init
  printf 'one\n// branch\n' > "$repo/one.js"
  git -C "$repo" add one.js && git -C "$repo" commit -qm branch
  root="$(git -C "$repo" rev-list --max-parents=0 HEAD | head -1)"

  # seed: approve a prepr over the whole branch (base=root) so one.js + two.js are recorded
  ( cd "$repo" && STUB_MODE=approve bash "$WRAPPER" prepr "$root" ) > "$SANDBOX/seed.txt" 2>"$SANDBOX/seed.err"
  if [ "$(last_json_line "$SANDBOX/seed.txt" | jq -r '.outcome // empty')" != "APPROVE" ]; then
    fail "prepr-delta-empty: seed prepr did not APPROVE :: $(cat "$SANDBOX/seed.err")"
    return
  fi

  # NO further changes -> the delta candidate set is empty (all branch files reviewed+unchanged).
  reset_argv_log
  ( cd "$repo" && STUB_MODE=approve bash "$WRAPPER" prepr-delta "$root" ) > "$SANDBOX/d.txt" 2>"$SANDBOX/d.err"
  status="$(last_json_line "$SANDBOX/d.txt")"
  outcome="$(printf '%s' "$status" | jq -r '.outcome // empty')"

  if [ "$outcome" = "APPROVE" ]; then
    pass "prepr-delta-empty: all-reviewed delta -> APPROVE"
  else
    fail "prepr-delta-empty: expected APPROVE got '$outcome' :: $status :: $(cat "$SANDBOX/d.err")"
  fi
  # the stub must NOT have been invoked
  if [ -s "$STUB_ARGV_LOG" ]; then
    fail "prepr-delta-empty: stub WAS invoked for an empty delta (argv non-empty) :: $(cat "$STUB_ARGV_LOG")"
  else
    pass "prepr-delta-empty: stub was NEVER invoked (empty delta short-circuit)"
  fi
  # the summary mentions "already reviewed"
  if printf '%s' "$status" | jq -r '.summary // ""' | grep -qi 'already reviewed'; then
    pass "prepr-delta-empty: summary mentions 'already reviewed'"
  else
    fail "prepr-delta-empty: summary missing 'already reviewed' :: $(printf '%s' "$status" | jq -r '.summary')"
  fi
  # coverage present: reviewedNow=0, priorHashMatch>=1, unreviewed=0
  if printf '%s' "$status" | jq -e '.coverage.reviewedNow==0 and .coverage.priorHashMatch>=1 and .coverage.unreviewed==0' >/dev/null 2>&1; then
    pass "prepr-delta-empty: coverage reviewedNow=0, priorHashMatch>=1, unreviewed=0"
  else
    fail "prepr-delta-empty: coverage wrong :: $(printf '%s' "$status" | jq -c '.coverage')"
  fi
}

#############################################################################
# TEST 28 — coverage manifest present in prepr AND prepr-delta status [TIER 2]
#   A plain prepr (no ledger) over a changed file must carry a coverage object with
#   reviewedNow>=1 and unreviewed==0 (everything got reviewed now). prepr-delta's
#   coverage is exercised by 26/27; here we pin the prepr-side additive field.
#############################################################################
run_test_28() {
  local repo status
  repo="$(make_repo)"
  printf 'seed\n' > "$repo/seed.txt"
  git -C "$repo" add seed.txt && git -C "$repo" commit -qm init
  printf 'seed\ncov-change\n' > "$repo/seed.txt"

  ( cd "$repo" && STUB_MODE=approve bash "$WRAPPER" prepr ) > "$SANDBOX/out.txt" 2>"$SANDBOX/err.txt"
  status="$(last_json_line "$SANDBOX/out.txt")"
  if [ -z "$status" ]; then
    fail "coverage-prepr: no status :: $(cat "$SANDBOX/err.txt")"
    return
  fi
  if printf '%s' "$status" | jq -e 'has("coverage")' >/dev/null 2>&1; then
    pass "coverage-prepr: prepr status carries a coverage object"
  else
    fail "coverage-prepr: prepr status has NO coverage object :: $status"
  fi
  if printf '%s' "$status" | jq -e '.coverage.reviewedNow>=1 and .coverage.unreviewed==0' >/dev/null 2>&1; then
    pass "coverage-prepr: reviewedNow>=1 and unreviewed==0 for a plain prepr"
  else
    fail "coverage-prepr: coverage counts wrong :: $(printf '%s' "$status" | jq -c '.coverage')"
  fi
  # additive: the canonical review fields are still present (no existing consumer broke)
  if printf '%s' "$status" | jq -e 'has("outcome") and has("blockers") and has("agentFixableBlockers") and has("decisionBlockers")' >/dev/null 2>&1; then
    pass "coverage-prepr: existing status fields still present (coverage is additive)"
  else
    fail "coverage-prepr: existing status fields missing :: $status"
  fi
}

#############################################################################
# TEST 29 — coverage gap fails closed: an unreviewed file blocks APPROVE [TIER 2]
#   Force a synthetic coverage gap via CODEX_GATE_FORCE_UNREVIEWED (a test-only seam
#   the wrapper honors): even on a stub APPROVE verdict, unreviewed>0 must downgrade
#   the outcome away from APPROVE (to OVERFLOW/INFRA_ERROR-style) with a
#   "coverage gap" summary. (Approval is impossible when required surface is unreviewed.)
#############################################################################
run_test_29() {
  local repo status outcome
  repo="$(make_repo)"
  printf 'seed\n' > "$repo/seed.txt"
  git -C "$repo" add seed.txt && git -C "$repo" commit -qm init
  printf 'seed\ngap-change\n' > "$repo/seed.txt"

  ( cd "$repo" && CODEX_GATE_FORCE_UNREVIEWED=1 STUB_MODE=approve bash "$WRAPPER" prepr ) > "$SANDBOX/out.txt" 2>"$SANDBOX/err.txt"
  status="$(last_json_line "$SANDBOX/out.txt")"
  outcome="$(printf '%s' "$status" | jq -r '.outcome // empty')"

  if [ "$outcome" = "APPROVE" ]; then
    fail "coverage-gap: APPROVED despite an unreviewed coverage gap :: $status"
  else
    pass "coverage-gap: a coverage gap does NOT APPROVE (got $outcome, fail-closed)"
  fi
  if printf '%s' "$status" | jq -r '.summary // ""' | grep -qi 'coverage gap'; then
    pass "coverage-gap: summary names the coverage gap"
  else
    fail "coverage-gap: summary missing 'coverage gap' :: $(printf '%s' "$status" | jq -r '.summary')"
  fi
  # the coverage object still reports the unreviewed count
  if printf '%s' "$status" | jq -e '.coverage.unreviewed>=1' >/dev/null 2>&1; then
    pass "coverage-gap: coverage.unreviewed>=1 surfaced"
  else
    fail "coverage-gap: coverage.unreviewed not surfaced :: $(printf '%s' "$status" | jq -c '.coverage // empty')"
  fi
}

#############################################################################
# TEST 30 — shard assignment is a COMPLETE, DISJOINT partition [TIER 3]
#   Source the wrapper (sourcing guard => main not run) and drive shard_group_for_path
#   over a candidate set spanning docs/tests/config/other. Assert:
#     - every candidate maps to exactly ONE of the four known groups,
#     - the union of the four group-buckets == the full candidate set,
#     - the buckets are pairwise disjoint (no path in two groups),
#     - specific first-match precedence: a *.md UNDER docs/ -> docs (docs before tests),
#       a *test*.yml -> tests (tests before config), a Dockerfile -> config, a .js -> other.
#############################################################################
run_test_30() {
  # source for direct function access (guarded main => no dispatch)
  ( # subshell so sourcing side-effects don't leak into the harness
    set +u
    # shellcheck disable=SC1090
    . "$WRAPPER" >/dev/null 2>&1 || { printf 'SOURCEFAIL\n'; exit 0; }
    if ! type shard_group_for_path >/dev/null 2>&1; then printf 'NOFUNC\n'; exit 0; fi

    # candidate set spanning all four groups (+ precedence edge cases)
    cands="docs/readme.md
projects/api/notes.md
src/foo.test.js
src/__tests__/bar.js
test/helper.js
ci/deploy.test.yml
.docker/docker-compose.yml
Dockerfile
package-lock.json
config/app.toml
src/app.js
projects/react/index.jsx"

    union=""
    bad_multi=0
    all_known=1
    printf '%s\n' "$cands" | while IFS= read -r p; do
      [ -n "$p" ] || continue
      g="$(shard_group_for_path "$p")"
      printf 'MAP\t%s\t%s\n' "$g" "$p"
    done
  ) > "$SANDBOX/shardmap.txt" 2>/dev/null

  if grep -q 'SOURCEFAIL' "$SANDBOX/shardmap.txt"; then
    fail "shard-partition: could not source wrapper (sourcing guard missing?)"
    return
  fi
  if grep -q 'NOFUNC' "$SANDBOX/shardmap.txt"; then
    fail "shard-partition: shard_group_for_path not defined in wrapper"
    return
  fi

  # every line is MAP<TAB>group<TAB>path ; collect groups + paths
  local total mapped known_groups dup_paths
  total=12   # number of candidate lines above
  mapped="$(grep -c '^MAP	' "$SANDBOX/shardmap.txt")"
  if [ "$mapped" -eq "$total" ]; then
    pass "shard-partition: every candidate ($total) assigned to exactly one group (union complete)"
  else
    fail "shard-partition: expected $total assignments got $mapped :: $(cat "$SANDBOX/shardmap.txt")"
  fi
  # all groups are one of the four known names
  known_groups="$(awk -F'\t' '$1=="MAP"{print $2}' "$SANDBOX/shardmap.txt" | LC_ALL=C sort -u)"
  if printf '%s\n' "$known_groups" | grep -qvE '^(docs|tests|config|other)$'; then
    fail "shard-partition: an unknown group appeared :: $known_groups"
  else
    pass "shard-partition: all groups are in {docs,tests,config,other}"
  fi
  # disjoint: no path appears under two groups (each path mapped once -> unique path count == total)
  dup_paths="$(awk -F'\t' '$1=="MAP"{print $3}' "$SANDBOX/shardmap.txt" | LC_ALL=C sort | uniq -d)"
  if [ -z "$dup_paths" ]; then
    pass "shard-partition: buckets are pairwise disjoint (no path in two groups)"
  else
    fail "shard-partition: a path landed in two groups :: $dup_paths"
  fi

  # precedence: docs before tests for a *.md under docs/
  if awk -F'\t' '$3=="docs/readme.md"{print $2}' "$SANDBOX/shardmap.txt" | grep -qx 'docs'; then
    pass "shard-partition: docs/readme.md -> docs (docs precedes tests)"
  else
    fail "shard-partition: docs/readme.md not classified docs"
  fi
  # a *.md NOT under docs/ still -> docs (the **/*.md rule)
  if awk -F'\t' '$3=="projects/api/notes.md"{print $2}' "$SANDBOX/shardmap.txt" | grep -qx 'docs'; then
    pass "shard-partition: a non-docs/ *.md still -> docs (**/*.md rule)"
  else
    fail "shard-partition: projects/api/notes.md not classified docs"
  fi
  # tests before config for a *test*.yml
  if awk -F'\t' '$3=="ci/deploy.test.yml"{print $2}' "$SANDBOX/shardmap.txt" | grep -qx 'tests'; then
    pass "shard-partition: ci/deploy.test.yml -> tests (tests precedes config)"
  else
    fail "shard-partition: deploy.test.yml not classified tests"
  fi
  # config: Dockerfile, lockfile, .toml, .docker/
  if awk -F'\t' '$3=="Dockerfile"{print $2}' "$SANDBOX/shardmap.txt" | grep -qx 'config' \
     && awk -F'\t' '$3=="package-lock.json"{print $2}' "$SANDBOX/shardmap.txt" | grep -qx 'config' \
     && awk -F'\t' '$3=="config/app.toml"{print $2}' "$SANDBOX/shardmap.txt" | grep -qx 'config' \
     && awk -F'\t' '$3==".docker/docker-compose.yml"{print $2}' "$SANDBOX/shardmap.txt" | grep -qx 'config'; then
    pass "shard-partition: Dockerfile/lockfile/.toml/.docker -> config"
  else
    fail "shard-partition: a config-class file misclassified :: $(cat "$SANDBOX/shardmap.txt")"
  fi
  # other: plain source files
  if awk -F'\t' '$3=="src/app.js"{print $2}' "$SANDBOX/shardmap.txt" | grep -qx 'other' \
     && awk -F'\t' '$3=="projects/react/index.jsx"{print $2}' "$SANDBOX/shardmap.txt" | grep -qx 'other'; then
    pass "shard-partition: plain source (.js/.jsx) -> other"
  else
    fail "shard-partition: a plain source file not classified other"
  fi
}

#############################################################################
# TEST 31 — auto-shard trigger: over-budget prepr shards + aggregates [TIER 3]
#   With a tiny CODEX_GATE_PACKET_BUDGET so the FULL packet is over budget and
#   CODEX_GATE_SHARD=auto, prepr must:
#     - shard the candidate set by path, review EACH non-empty shard in its own
#       fresh thread (stub invoked once per non-empty shard),
#     - persist per-shard verdict files $RUN_DIR/shard-<group>-verdict.json,
#     - aggregate to APPROVE (all shards approve) with a `shards` summary in the status,
#     - keep the coverage object.
#   Candidate set spans 3 groups (docs, tests, other) so we expect 3 shard reviews.
#############################################################################
run_test_31() {
  local repo status outcome runDir nshards i
  repo="$(make_repo)"
  printf 'seed\n' > "$repo/seed.txt"
  git -C "$repo" add seed.txt && git -C "$repo" commit -qm init
  # Changes spanning 3 shard groups. Each file is ~60 lines (< the 120-line inline cap, so
  # bodies inline + add bulk) so the FULL 3-file packet (~14 KB) exceeds the budget but each
  # SINGLE-file shard packet (~6.6 KB) fits under it. Budget 9000 separates the two cleanly.
  mkdir -p "$repo/docs"
  { for i in $(seq 1 60); do printf 'docs-line-%s SHARD-DOCS-MARK\n' "$i"; done; } > "$repo/docs/guide.md"      # docs
  { for i in $(seq 1 60); do printf 'test-line-%s SHARD-TESTS-MARK\n' "$i"; done; } > "$repo/thing.test.js"     # tests
  { for i in $(seq 1 60); do printf 'src-line-%s SHARD-OTHER-MARK\n' "$i"; done; } > "$repo/app.js"             # other

  reset_argv_log
  ( cd "$repo" && CODEX_GATE_PACKET_BUDGET=9000 CODEX_GATE_SHARD=auto STUB_MODE=approve \
       bash "$WRAPPER" prepr ) > "$SANDBOX/out.txt" 2>"$SANDBOX/err.txt"
  status="$(last_json_line "$SANDBOX/out.txt")"
  outcome="$(printf '%s' "$status" | jq -r '.outcome // empty')"
  runDir="$(printf '%s' "$status" | jq -r '.runDir // empty')"

  if [ -z "$status" ]; then
    fail "auto-shard: no status JSON :: $(cat "$SANDBOX/err.txt")"
    return
  fi
  if [ "$outcome" = "APPROVE" ]; then
    pass "auto-shard: over-budget prepr with SHARD=auto aggregates to APPROVE"
  else
    fail "auto-shard: expected APPROVE got '$outcome' :: $status :: $(cat "$SANDBOX/err.txt")"
  fi
  # per-shard verdict files exist for the 3 non-empty groups
  local ok=0
  [ -f "$runDir/shard-docs-verdict.json" ]  || ok=1
  [ -f "$runDir/shard-tests-verdict.json" ] || ok=1
  [ -f "$runDir/shard-other-verdict.json" ] || ok=1
  check "auto-shard: per-shard verdict files (docs/tests/other) persisted under run dir" "$ok"
  # an EMPTY group (config) must NOT get a shard verdict file
  if [ -f "$runDir/shard-config-verdict.json" ]; then
    fail "auto-shard: an empty (config) shard wrongly produced a verdict file"
  else
    pass "auto-shard: empty (config) shard produced NO verdict file"
  fi
  # the stub was invoked exactly ONCE per non-empty shard (3 invocations)
  nshards="$(grep -c -- '---END-ARGV---' "$STUB_ARGV_LOG")"
  if [ "$nshards" -eq 3 ]; then
    pass "auto-shard: stub invoked once PER non-empty shard (3 invocations)"
  else
    fail "auto-shard: expected 3 stub invocations got $nshards :: $(cat "$STUB_ARGV_LOG")"
  fi
  # the status carries a `shards` summary array with group/files/outcome/verdictPath
  if printf '%s' "$status" | jq -e '(.shards | type=="array") and (.shards | length==3)' >/dev/null 2>&1; then
    pass "auto-shard: status has a shards[] summary of length 3"
  else
    fail "auto-shard: status missing shards[] summary :: $status"
  fi
  if printf '%s' "$status" | jq -e '.shards | all(.[]; has("group") and has("files") and has("outcome") and has("verdictPath"))' >/dev/null 2>&1; then
    pass "auto-shard: each shards[] entry has group/files/outcome/verdictPath"
  else
    fail "auto-shard: shards[] entries missing required keys :: $(printf '%s' "$status" | jq -c '.shards')"
  fi
  # coverage object still present (additive Tier-2 field preserved)
  if printf '%s' "$status" | jq -e 'has("coverage") and (.coverage.reviewedNow>=3)' >/dev/null 2>&1; then
    pass "auto-shard: coverage object preserved (reviewedNow>=3)"
  else
    fail "auto-shard: coverage object missing/wrong :: $(printf '%s' "$status" | jq -c '.coverage // empty')"
  fi
  # the aggregate verdict file the status points to must exist (round-1-verdict.json)
  local vpath
  vpath="$(printf '%s' "$status" | jq -r '.verdictPath // empty')"
  if [ -n "$vpath" ] && [ -f "$vpath" ]; then
    pass "auto-shard: aggregate verdict file exists ($vpath)"
  else
    fail "auto-shard: aggregate verdict file missing :: $status"
  fi
}

#############################################################################
# TEST 32 — aggregate UNIONS blockers across shards [TIER 3]
#   Two different shards (docs + other) each carry a distinct SHARDBLOCKER-<tag>
#   marker; STUB_BLOCK_IF_STDIN=SHARDBLOCKER makes any shard whose diff contains a
#   marker BLOCK (with that tag as its blocker issue). A third shard (tests) has no
#   marker and approves. The aggregate must be BLOCK and the combined verdict file
#   must contain BOTH tags (real union, not passthrough).
#############################################################################
run_test_32() {
  local repo status outcome vpath i
  repo="$(make_repo)"
  printf 'seed\n' > "$repo/seed.txt"
  git -C "$repo" add seed.txt && git -C "$repo" commit -qm init
  mkdir -p "$repo/docs"
  # ~60-line files (see TEST 31 sizing); each blocking shard carries a DISTINCT marker.
  { for i in $(seq 1 60); do printf 'doc-line-%s SHARDBLOCKER-DOCS\n' "$i"; done; } > "$repo/docs/guide.md"   # docs shard blocks (tag DOCS)
  { for i in $(seq 1 60); do printf 'src-line-%s SHARDBLOCKER-OTHER\n' "$i"; done; } > "$repo/app.js"         # other shard blocks (tag OTHER)
  { for i in $(seq 1 60); do printf 'test-line-%s clean-approve\n' "$i"; done; } > "$repo/thing.test.js"      # tests shard approves

  ( cd "$repo" && CODEX_GATE_PACKET_BUDGET=9000 CODEX_GATE_SHARD=auto STUB_MODE=approve \
       STUB_BLOCK_IF_STDIN=SHARDBLOCKER bash "$WRAPPER" prepr ) > "$SANDBOX/out.txt" 2>"$SANDBOX/err.txt"
  status="$(last_json_line "$SANDBOX/out.txt")"
  outcome="$(printf '%s' "$status" | jq -r '.outcome // empty')"

  if [ "$outcome" = "BLOCK" ]; then
    pass "shard-union: any blocking shard -> aggregate BLOCK"
  else
    fail "shard-union: expected BLOCK got '$outcome' :: $status :: $(cat "$SANDBOX/err.txt")"
  fi
  # aggregate blocker count is the UNION of the two blocking shards (>=2)
  if printf '%s' "$status" | jq -e '.blockers>=2' >/dev/null 2>&1; then
    pass "shard-union: aggregate blockers>=2 (union of two blocking shards)"
  else
    fail "shard-union: aggregate blockers not unioned :: $status"
  fi
  # the combined verdict file must contain BOTH distinct shard tags
  vpath="$(printf '%s' "$status" | jq -r '.verdictPath // empty')"
  if [ -n "$vpath" ] && [ -f "$vpath" ] \
     && grep -q 'SHARDBLOCKER-DOCS' "$vpath" && grep -q 'SHARDBLOCKER-OTHER' "$vpath"; then
    pass "shard-union: combined verdict file contains BOTH shard blockers (real union)"
  else
    fail "shard-union: combined verdict missing one/both tags :: $([ -f "$vpath" ] && jq -c '.blockers' "$vpath" || echo no-file)"
  fi
  # the status shards[] summary must mark >=2 shards BLOCK
  if printf '%s' "$status" | jq -e '[.shards[]? | select(.outcome=="BLOCK")] | length >= 2' >/dev/null 2>&1; then
    pass "shard-union: shards[] summary records >=2 BLOCK shards"
  else
    fail "shard-union: shards[] summary BLOCK count wrong :: $(printf '%s' "$status" | jq -c '.shards')"
  fi
}

#############################################################################
# TEST 33 — fail-closed when a shard is inconclusive (overflow/error) [TIER 3]
#   One shard's OWN packet overflows (STUB_OVERFLOW_IF_STDIN matches a marker in the
#   `other` shard) while the rest approve. The aggregate must NOT APPROVE — it fails
#   closed to OVERFLOW (cannot certify full coverage), even though other shards passed.
#############################################################################
run_test_33() {
  local repo status outcome i
  repo="$(make_repo)"
  printf 'seed\n' > "$repo/seed.txt"
  git -C "$repo" add seed.txt && git -C "$repo" commit -qm init
  mkdir -p "$repo/docs"
  # ~60-line files (see TEST 31 sizing). The `other` shard's diff carries the overflow marker
  # so its Codex call (under budget, so it IS invoked) returns the context-window signature.
  { for i in $(seq 1 60); do printf 'doc-line-%s clean\n' "$i"; done; } > "$repo/docs/guide.md"               # docs shard approves
  { for i in $(seq 1 60); do printf 'test-line-%s clean\n' "$i"; done; } > "$repo/thing.test.js"              # tests shard approves
  { for i in $(seq 1 60); do printf 'src-line-%s SHARD-OVERFLOW-HERE\n' "$i"; done; } > "$repo/app.js"        # other shard overflows

  ( cd "$repo" && CODEX_GATE_PACKET_BUDGET=9000 CODEX_GATE_SHARD=auto STUB_MODE=approve \
       STUB_OVERFLOW_IF_STDIN=SHARD-OVERFLOW-HERE bash "$WRAPPER" prepr ) > "$SANDBOX/out.txt" 2>"$SANDBOX/err.txt"
  status="$(last_json_line "$SANDBOX/out.txt")"
  outcome="$(printf '%s' "$status" | jq -r '.outcome // empty')"

  if [ "$outcome" = "APPROVE" ]; then
    fail "shard-failclosed: APPROVED despite an inconclusive (overflow) shard :: $status"
  else
    pass "shard-failclosed: an inconclusive shard does NOT APPROVE (got $outcome, fail-closed)"
  fi
  # the surfaced outcome is OVERFLOW (cannot certify full coverage) and names the shard
  if [ "$outcome" = "OVERFLOW" ]; then
    pass "shard-failclosed: surfaced outcome is OVERFLOW"
  else
    fail "shard-failclosed: expected OVERFLOW got '$outcome' :: $status"
  fi
  if printf '%s' "$status" | jq -r '.summary // ""' | grep -qi 'inconclusive'; then
    pass "shard-failclosed: summary explains a shard was inconclusive"
  else
    fail "shard-failclosed: summary missing 'inconclusive' :: $(printf '%s' "$status" | jq -r '.summary')"
  fi
  # the shards[] summary records the inconclusive shard (outcome OVERFLOW for `other`)
  if printf '%s' "$status" | jq -e '[.shards[]? | select(.outcome=="OVERFLOW" or .outcome=="INFRA_ERROR")] | length >= 1' >/dev/null 2>&1; then
    pass "shard-failclosed: shards[] summary records the inconclusive shard"
  else
    fail "shard-failclosed: shards[] summary missing the inconclusive shard :: $(printf '%s' "$status" | jq -c '.shards')"
  fi
}

#############################################################################
# TEST 34 — CODEX_GATE_SHARD=off keeps Tier-1 OVERFLOW (no sharding) [TIER 3]
#   Over-budget prepr with SHARD=off must emit OVERFLOW and NOT shard: no per-shard
#   verdict files, and the stub is never invoked (the budget guard short-circuits).
#############################################################################
run_test_34() {
  local repo status outcome runDir
  repo="$(make_repo)"
  printf 'seed\n' > "$repo/seed.txt"
  git -C "$repo" add seed.txt && git -C "$repo" commit -qm init
  mkdir -p "$repo/docs"
  printf 'doc change\n' > "$repo/docs/guide.md"
  printf 'src change\n' > "$repo/app.js"

  reset_argv_log
  ( cd "$repo" && CODEX_GATE_PACKET_BUDGET=50 CODEX_GATE_SHARD=off STUB_MODE=approve \
       bash "$WRAPPER" prepr ) > "$SANDBOX/out.txt" 2>"$SANDBOX/err.txt"
  status="$(last_json_line "$SANDBOX/out.txt")"
  outcome="$(printf '%s' "$status" | jq -r '.outcome // empty')"
  runDir="$(printf '%s' "$status" | jq -r '.runDir // empty')"

  if [ "$outcome" = "OVERFLOW" ]; then
    pass "shard-off: over-budget prepr with SHARD=off -> OVERFLOW (Tier-1 behavior)"
  else
    fail "shard-off: expected OVERFLOW got '$outcome' :: $status :: $(cat "$SANDBOX/err.txt")"
  fi
  # NO sharding happened: no shard verdict files
  if ls "$runDir"/shard-*-verdict.json >/dev/null 2>&1; then
    fail "shard-off: shard verdict files were produced despite SHARD=off :: $(ls "$runDir"/shard-*-verdict.json)"
  else
    pass "shard-off: NO per-shard verdict files (no sharding)"
  fi
  # the stub was NEVER invoked (budget guard short-circuited, no shard reviews)
  if [ -s "$STUB_ARGV_LOG" ]; then
    fail "shard-off: stub WAS invoked despite SHARD=off over budget :: $(cat "$STUB_ARGV_LOG")"
  else
    pass "shard-off: stub was NEVER invoked (Tier-1 OVERFLOW short-circuit)"
  fi
  # the status must NOT carry a shards[] summary (no sharding)
  if printf '%s' "$status" | jq -e 'has("shards")' >/dev/null 2>&1; then
    fail "shard-off: status wrongly carries a shards[] summary :: $status"
  else
    pass "shard-off: status has no shards[] summary (no sharding)"
  fi
}

#############################################################################
# TEST 35 — investigate <brief> root-cause mode [INVESTIGATE MODE]
#   In a temp git repo:
#     - default STUB_MODE auto-remaps to inv_root_cause -> outcome ROOT_CAUSE_FOUND,
#       confidence + summary(=rootCause) non-empty
#     - the packet carries the brief text, the investigator persona, and the
#       INVESTIGATION BRIEF header
#     - schema pinned to investigate.schema.json; code tier (cwd=repo root, approval_policy=never)
#     - investigate NEVER writes the review ledger (no approved surface)
#     - read-only: git status --porcelain byte-identical before/after
#     - needs_more_evidence + unsafe_or_blocked + infra/overflow mappings
#     - resume round 2 sends `exec resume <tid>` and folds in <runDir>/evidence.md
#############################################################################
run_test_35() {
  local repo repo_phys brief status outcome runDir before after schema_val argv cwd ledger packet

  # ---- (A) root_cause_found happy path + packet shape ----
  repo="$(make_repo)"
  repo_phys="$(cd "$repo" && pwd -P)"
  printf 'seed\n' > "$repo/seed.txt"
  git -C "$repo" add seed.txt && git -C "$repo" commit -qm init
  brief="$SANDBOX/brief.md"
  printf 'TASK: why do eval runs get orphaned ~8-19s after start?\n\nINVESTIGATE-SENTINEL-ORPHAN\n\nSAFETY:\nALLOWED PROBES: Layer A code tests; read-only docker inspect/logs; read-only file inspection.\nFORBIDDEN PROBES: never trigger a Layer B (live AI) run.\n' > "$brief"

  before="$(git -C "$repo" status --porcelain)"
  reset_argv_log; reset_cwd_log
  ( cd "$repo" && STUB_MODE=approve bash "$WRAPPER" investigate "$brief" ) > "$SANDBOX/inv.txt" 2>"$SANDBOX/inv.err"
  status="$(last_json_line "$SANDBOX/inv.txt")"
  if [ -z "$status" ]; then
    fail "investigate: produced no status JSON :: $(cat "$SANDBOX/inv.txt") :: $(cat "$SANDBOX/inv.err")"
    return
  fi
  outcome="$(printf '%s' "$status" | jq -r '.outcome // empty' 2>/dev/null)"
  runDir="$(printf '%s' "$status" | jq -r '.runDir // empty' 2>/dev/null)"
  packet="$STUB_STDIN_DUMP"

  if [ "$outcome" = "ROOT_CAUSE_FOUND" ]; then
    pass "investigate: outcome == ROOT_CAUSE_FOUND"
  else
    fail "investigate: expected ROOT_CAUSE_FOUND got '$outcome' :: $status :: $(cat "$SANDBOX/inv.err")"
  fi
  if [ -n "$(printf '%s' "$status" | jq -r '.confidence // ""' 2>/dev/null)" ]; then
    pass "investigate: status carries confidence"
  else
    fail "investigate: confidence missing :: $status"
  fi
  if [ -n "$(printf '%s' "$status" | jq -r '.summary // ""' 2>/dev/null)" ]; then
    pass "investigate: status summary (rootCause) non-empty"
  else
    fail "investigate: summary empty :: $status"
  fi
  # packet carries the brief text, the investigator persona, and the BRIEF header
  if grep -q 'INVESTIGATE-SENTINEL-ORPHAN' "$packet"; then
    pass "investigate: packet includes the brief text"
  else
    fail "investigate: brief text NOT in packet"
  fi
  if grep -q 'independent ROOT-CAUSE INVESTIGATOR' "$packet"; then
    pass "investigate: packet includes the investigator persona"
  else
    fail "investigate: investigator persona NOT in packet"
  fi
  if grep -q 'INVESTIGATION BRIEF' "$packet"; then
    pass "investigate: packet has the INVESTIGATION BRIEF section header"
  else
    fail "investigate: INVESTIGATION BRIEF header missing from packet"
  fi
  # schema pinned to investigate.schema.json
  schema_val="$(awk 'prev=="--output-schema"{print; exit} {prev=$0}' "$STUB_ARGV_LOG")"
  case "$schema_val" in
    */investigate.schema.json) pass "investigate: --output-schema pinned to investigate.schema.json" ;;
    *) fail "investigate: --output-schema not investigate.schema.json: '$schema_val'" ;;
  esac
  # code tier: cwd = repo root + approval_policy=never (read-only shell posture)
  argv="$(cat "$STUB_ARGV_LOG")"
  cwd="$(head -1 "$STUB_CWD_LOG")"
  if [ "$cwd" = "$repo_phys" ]; then
    pass "investigate: code tier — codex cwd = repo root"
  else
    fail "investigate: codex cwd '$cwd' != repo root '$repo_phys'"
  fi
  if printf '%s' "$argv" | grep -q 'approval_policy=never'; then
    pass "investigate: code tier passes approval_policy=never (read-only shell)"
  else
    fail "investigate: missing approval_policy=never :: $argv"
  fi
  # investigate must NEVER write the review ledger (no approved surface)
  ledger="$(dirname "$(dirname "$runDir")")/ledger.jsonl"
  if [ -f "$ledger" ]; then
    fail "investigate: WRONGLY wrote a review ledger at $ledger"
  else
    pass "investigate: no review ledger written (investigation is not an approval)"
  fi
  # read-only invariant
  after="$(git -C "$repo" status --porcelain)"
  if [ "$before" = "$after" ]; then
    pass "investigate: git status --porcelain byte-identical before/after"
  else
    fail "investigate: git status changed!\n--- before ---\n$before\n--- after ---\n$after"
  fi

  # ---- (B) needs_more_evidence -> NEEDS_MORE_EVIDENCE + nextSafeProbe ----
  ( cd "$repo" && STUB_MODE=inv_needs_evidence bash "$WRAPPER" investigate "$brief" ) > "$SANDBOX/inv2.txt" 2>"$SANDBOX/inv2.err"
  status="$(last_json_line "$SANDBOX/inv2.txt")"
  outcome="$(printf '%s' "$status" | jq -r '.outcome // empty' 2>/dev/null)"
  if [ "$outcome" = "NEEDS_MORE_EVIDENCE" ]; then
    pass "investigate: needs_more_evidence -> NEEDS_MORE_EVIDENCE"
  else
    fail "investigate: expected NEEDS_MORE_EVIDENCE got '$outcome' :: $status"
  fi
  if [ -n "$(printf '%s' "$status" | jq -r '.nextSafeProbe // ""' 2>/dev/null)" ]; then
    pass "investigate: NEEDS_MORE_EVIDENCE carries a nextSafeProbe"
  else
    fail "investigate: nextSafeProbe empty on NEEDS_MORE_EVIDENCE :: $status"
  fi

  # ---- (C) unsafe_or_blocked -> UNSAFE_OR_BLOCKED (fail closed on a forbidden probe) ----
  ( cd "$repo" && STUB_MODE=inv_unsafe bash "$WRAPPER" investigate "$brief" ) > "$SANDBOX/inv3.txt" 2>"$SANDBOX/inv3.err"
  status="$(last_json_line "$SANDBOX/inv3.txt")"
  outcome="$(printf '%s' "$status" | jq -r '.outcome // empty' 2>/dev/null)"
  if [ "$outcome" = "UNSAFE_OR_BLOCKED" ]; then
    pass "investigate: unsafe_or_blocked -> UNSAFE_OR_BLOCKED"
  else
    fail "investigate: expected UNSAFE_OR_BLOCKED got '$outcome' :: $status"
  fi

  # ---- (D) infra + overflow fail-closed mappings (shared with review modes) ----
  ( cd "$repo" && STUB_MODE=nonzero bash "$WRAPPER" investigate "$brief" ) > "$SANDBOX/inv4.txt" 2>"$SANDBOX/inv4.err"
  outcome="$(last_json_line "$SANDBOX/inv4.txt" | jq -r '.outcome // empty' 2>/dev/null)"
  if [ "$outcome" = "INFRA_ERROR" ]; then
    pass "investigate: nonzero codex exit -> INFRA_ERROR"
  else
    fail "investigate: expected INFRA_ERROR got '$outcome'"
  fi
  ( cd "$repo" && STUB_MODE=overflow bash "$WRAPPER" investigate "$brief" ) > "$SANDBOX/inv5.txt" 2>"$SANDBOX/inv5.err"
  outcome="$(last_json_line "$SANDBOX/inv5.txt" | jq -r '.outcome // empty' 2>/dev/null)"
  if [ "$outcome" = "OVERFLOW" ]; then
    pass "investigate: context-window failure -> OVERFLOW"
  else
    fail "investigate: expected OVERFLOW got '$outcome'"
  fi

  # ---- (E) resume round 2 sends `exec resume <tid>` and folds in <runDir>/evidence.md ----
  printf 'ROUND2-EVIDENCE-SENTINEL: find <watched dirs> -newer marker showed NO new watched file\n' > "$runDir/evidence.md"
  reset_argv_log
  ( cd "$repo" && STUB_MODE=approve bash "$WRAPPER" investigate "$brief" 2 stub-tid-123 ) > "$SANDBOX/inv6.txt" 2>"$SANDBOX/inv6.err"
  argv="$(cat "$STUB_ARGV_LOG")"
  packet="$STUB_STDIN_DUMP"
  if printf '%s' "$argv" | grep -q 'resume' && printf '%s' "$argv" | grep -q 'stub-tid-123'; then
    pass "investigate: round 2 resumes the same thread (exec resume <tid>)"
  else
    fail "investigate: round 2 did not resume :: $argv"
  fi
  if grep -q 'ROUND2-EVIDENCE-SENTINEL' "$packet"; then
    pass "investigate: round 2 packet folds in <runDir>/evidence.md"
  else
    fail "investigate: evidence.md NOT folded into the resume packet"
  fi
}

#############################################################################
# TEST 36 — fan_out_and_aggregate: the extracted generic fan-out+aggregate helper
#   [TIER 3 core — the reusable trust-critical unit under shard_and_review]
#
#   Drive fan_out_and_aggregate DIRECTLY (source the wrapper, guarded main => no
#   dispatch) over a synthetic LIST OF JOBS, each job = a pre-staged packet file, and
#   assert the deterministic fail-closed aggregate rule holds regardless of the
#   partition that produced the jobs (proves generality beyond path-sharding):
#     (A) all jobs APPROVE            -> FAN_OUTCOME=APPROVE
#     (B) one BLOCK among approves     -> FAN_OUTCOME=BLOCK, blockers UNIONED (both tags)
#     (C) one inconclusive among appr. -> FAN_OUTCOME=OVERFLOW (never APPROVE over it)
#   plus a job whose OWN packet exceeds budget -> that job is OVERFLOW (inconclusive)
#   without ever invoking codex (fail closed, no recursion).
#
#   The helper takes a jobs file (TAB: label<TAB>files<TAB>packetPath), writes per-job
#   verdict files to $RUN_DIR/<prefix><label>-verdict.json, and returns via output
#   vars: FAN_OUTCOME / FAN_N_JOBS / FAN_TOTAL_FILES / FAN_FIRST_INCONCLUSIVE /
#   FAN_BLOCKERS / FAN_JOBS_JSON. On BLOCK it unions blockers[]+nonBlocking[] into
#   $VERDICT_FILE. It is field-name / vocabulary neutral (each job summary entry uses
#   group/files/outcome/verdictPath) so a future lens caller can reuse it verbatim.
#
#   MUTATION-CHECK (scenario D): re-run scenario C but INVERT the aggregate rule via a
#   drop-in stub of classify_verdict_file that reports an inconclusive job as APPROVE.
#   The all-approve branch would then wrongly APPROVE — the test asserts that if the
#   helper's decision is APPROVE here, it is a FAILURE. This proves the assertions bite
#   on the fail-closed rule (a broken aggregate does not silently pass).
#############################################################################
run_test_36() {
  local out job_dir
  job_dir="$SANDBOX/fan-jobs"
  rm -rf "$job_dir"; mkdir -p "$job_dir"

  # ---- pre-stage per-job packets (each a small, under-budget "packet") ----
  # Jobs vary by PACKET CONTENT (not path) to prove the helper is partition-agnostic.
  printf 'lens-alpha packet: clean review, nothing to flag\n' > "$job_dir/alpha.packet"
  printf 'lens-beta packet: clean review, nothing to flag\n'  > "$job_dir/beta.packet"
  printf 'lens-gamma packet: FAN-BLOCK-GAMMA problem here\n'   > "$job_dir/gamma.packet"
  printf 'lens-delta packet: SHARDBLOCKER-DELTA distinct issue\n' > "$job_dir/delta.packet"
  printf 'lens-epsilon packet: FAN-OVERFLOW-EPSILON marker\n'  > "$job_dir/epsilon.packet"

  # Helper: source the wrapper in a subshell, set up run-dir + round paths, invoke
  # fan_out_and_aggregate over a jobs file, and print the output vars + a probe of the
  # aggregate verdict file. Extra pre-source shell (arg 3) allows a mutation override.
  run_fan() { # <jobs-file> <stub-env-string> <presource-override>
    local jobs="$1" stubenv="$2" override="${3:-}"
    (
      set +u
      # shellcheck disable=SC1090
      . "$WRAPPER" >/dev/null 2>&1 || { printf 'SOURCEFAIL\n'; exit 0; }
      if ! type fan_out_and_aggregate >/dev/null 2>&1; then printf 'NOFUNC\n'; exit 0; fi
      RUN_DIR="$job_dir/run"; rm -rf "$RUN_DIR"; mkdir -p "$RUN_DIR"
      REPO_ROOT="$job_dir"
      ROUND=1; set_round_paths   # VERDICT_FILE=$RUN_DIR/round-1-verdict.json
      # optional mutation override (evaluated AFTER sourcing so it shadows the real fn)
      [ -n "$override" ] && eval "$override"
      # export the stub seams for this invocation
      eval "$stubenv"
      export STUB_MODE="${STUB_MODE:-approve}"
      export STUB_BLOCK_IF_STDIN="${STUB_BLOCK_IF_STDIN:-}"
      export STUB_OVERFLOW_IF_STDIN="${STUB_OVERFLOW_IF_STDIN:-}"
      fan_out_and_aggregate "$jobs" >/dev/null 2>&1
      printf 'OUTCOME=%s\n' "${FAN_OUTCOME:-}"
      printf 'NJOBS=%s\n' "${FAN_N_JOBS:-}"
      printf 'TOTAL=%s\n' "${FAN_TOTAL_FILES:-}"
      printf 'BLOCKERS=%s\n' "${FAN_BLOCKERS:-}"
      printf 'FIRSTINC=%s\n' "${FAN_FIRST_INCONCLUSIVE:-}"
      printf 'JOBSJSON=%s\n' "${FAN_JOBS_JSON:-}"
      printf 'VERDICTFILE=%s\n' "${VERDICT_FILE:-}"
    ) 2>/dev/null
  }

  # jobs file field layout: label<TAB>files<TAB>packetPath
  mkjobs() { : > "$1"; shift; while [ "$#" -ge 3 ]; do printf '%s\t%s\t%s\n' "$1" "$2" "$3" >> "$job_dir/jobs.tmp"; shift 3; done; mv "$job_dir/jobs.tmp" "$job_dir/jobs.$RANDOM" 2>/dev/null; }

  # ---- (A) all-APPROVE ----
  {
    printf 'alpha\t2\t%s\n' "$job_dir/alpha.packet"
    printf 'beta\t3\t%s\n'  "$job_dir/beta.packet"
  } > "$job_dir/jobs-A.tsv"
  out="$(run_fan "$job_dir/jobs-A.tsv" 'STUB_MODE=approve')"
  if printf '%s' "$out" | grep -q 'SOURCEFAIL'; then
    fail "fan-agg: could not source wrapper (sourcing guard missing?)"; return
  fi
  if printf '%s' "$out" | grep -q 'NOFUNC'; then
    fail "fan-agg: fan_out_and_aggregate not defined in wrapper"; return
  fi
  if printf '%s\n' "$out" | grep -qx 'OUTCOME=APPROVE'; then
    pass "fan-agg (A): all jobs APPROVE -> aggregate APPROVE"
  else
    fail "fan-agg (A): expected APPROVE :: $out"
  fi
  # total files summed across jobs (2+3)
  if printf '%s\n' "$out" | grep -qx 'TOTAL=5'; then
    pass "fan-agg (A): FAN_TOTAL_FILES sums job file counts (5)"
  else
    fail "fan-agg (A): expected TOTAL=5 :: $out"
  fi
  # per-job summary array has 2 entries with the neutral keys
  if printf '%s\n' "$out" | sed -n 's/^JOBSJSON=//p' | jq -e '(type=="array") and (length==2) and all(.[]; has("group") and has("files") and has("outcome") and has("verdictPath"))' >/dev/null 2>&1; then
    pass "fan-agg (A): FAN_JOBS_JSON has 2 entries w/ group/files/outcome/verdictPath"
  else
    fail "fan-agg (A): FAN_JOBS_JSON malformed :: $(printf '%s\n' "$out" | sed -n 's/^JOBSJSON=//p')"
  fi

  # ---- (B) one BLOCK among approves -> BLOCK, blockers UNIONED across the two blockers ----
  # gamma blocks (FAN-BLOCK-GAMMA), delta blocks (SHARDBLOCKER-DELTA), alpha approves.
  # STUB_BLOCK_IF_STDIN matches the SHARED prefix so BOTH blocking packets block, each
  # emitting its own distinct SHARDBLOCKER-* tag (the stub greps a SHARDBLOCKER- marker).
  printf 'lens-gamma packet: SHARDBLOCKER-GAMMA problem here\n' > "$job_dir/gamma.packet"
  {
    printf 'alpha\t1\t%s\n' "$job_dir/alpha.packet"
    printf 'gamma\t1\t%s\n' "$job_dir/gamma.packet"
    printf 'delta\t1\t%s\n' "$job_dir/delta.packet"
  } > "$job_dir/jobs-B.tsv"
  out="$(run_fan "$job_dir/jobs-B.tsv" 'STUB_MODE=approve; STUB_BLOCK_IF_STDIN=SHARDBLOCKER')"
  if printf '%s\n' "$out" | grep -qx 'OUTCOME=BLOCK'; then
    pass "fan-agg (B): one blocking job -> aggregate BLOCK"
  else
    fail "fan-agg (B): expected BLOCK :: $out"
  fi
  if printf '%s\n' "$out" | grep -Eqx 'BLOCKERS=[2-9][0-9]*'; then
    pass "fan-agg (B): aggregate blockers UNIONED (>=2)"
  else
    fail "fan-agg (B): blockers not unioned :: $out"
  fi
  # the aggregate verdict file contains BOTH distinct blocker tags (real union)
  local vf_b
  vf_b="$(printf '%s\n' "$out" | sed -n 's/^VERDICTFILE=//p')"
  if [ -n "$vf_b" ] && [ -f "$vf_b" ] \
     && grep -q 'SHARDBLOCKER-GAMMA' "$vf_b" && grep -q 'SHARDBLOCKER-DELTA' "$vf_b"; then
    pass "fan-agg (B): aggregate verdict file unions BOTH job blockers"
  else
    fail "fan-agg (B): aggregate verdict missing a tag :: $([ -f "$vf_b" ] && jq -c '.blockers' "$vf_b" || echo no-file)"
  fi

  # ---- (C) one inconclusive (overflow) among approves -> OVERFLOW, never APPROVE ----
  {
    printf 'alpha\t1\t%s\n'   "$job_dir/alpha.packet"
    printf 'beta\t1\t%s\n'    "$job_dir/beta.packet"
    printf 'epsilon\t1\t%s\n' "$job_dir/epsilon.packet"
  } > "$job_dir/jobs-C.tsv"
  out="$(run_fan "$job_dir/jobs-C.tsv" 'STUB_MODE=approve; STUB_OVERFLOW_IF_STDIN=FAN-OVERFLOW-EPSILON')"
  if printf '%s\n' "$out" | grep -qx 'OUTCOME=APPROVE'; then
    fail "fan-agg (C): APPROVED over an inconclusive job (fail-closed VIOLATED) :: $out"
  else
    pass "fan-agg (C): inconclusive job does NOT APPROVE (fail-closed)"
  fi
  if printf '%s\n' "$out" | grep -qx 'OUTCOME=OVERFLOW'; then
    pass "fan-agg (C): surfaced outcome is OVERFLOW"
  else
    fail "fan-agg (C): expected OVERFLOW :: $out"
  fi
  if printf '%s\n' "$out" | grep -qx 'FIRSTINC=epsilon'; then
    pass "fan-agg (C): names the first inconclusive job (epsilon)"
  else
    fail "fan-agg (C): FAN_FIRST_INCONCLUSIVE wrong :: $out"
  fi

  # ---- (C2) a job whose OWN packet is over budget is inconclusive without invoking codex ----
  { for i in $(seq 1 50); do printf 'huge-line-%s padding padding padding\n' "$i"; done; } > "$job_dir/huge.packet"
  {
    printf 'alpha\t1\t%s\n' "$job_dir/alpha.packet"
    printf 'huge\t1\t%s\n'  "$job_dir/huge.packet"
  } > "$job_dir/jobs-C2.tsv"
  reset_argv_log
  out="$(CODEX_GATE_PACKET_BUDGET=200 run_fan "$job_dir/jobs-C2.tsv" 'STUB_MODE=approve')"
  if printf '%s\n' "$out" | grep -qx 'OUTCOME=OVERFLOW'; then
    pass "fan-agg (C2): a job whose own packet exceeds budget -> OVERFLOW (fail closed)"
  else
    fail "fan-agg (C2): expected OVERFLOW for over-budget job :: $out"
  fi

  # ---- (D) MUTATION-CHECK: invert the rule (treat inconclusive as APPROVE) => must APPROVE ----
  # Shadow classify_verdict_file so it ALWAYS reports APPROVE. If the helper's aggregate is
  # correctly fail-closed on its OWN over-budget pre-check, this scenario uses the codex path
  # (under budget) where the mutated classifier lies -> the all-approve branch WRONGLY fires.
  # We assert the mutant DOES flip the outcome to APPROVE (proving scenario C's OVERFLOW came
  # from the real classifier, i.e. the assertion bites: a broken aggregate would pass C).
  out="$(run_fan "$job_dir/jobs-C.tsv" 'STUB_MODE=approve; STUB_OVERFLOW_IF_STDIN=FAN-OVERFLOW-EPSILON' 'classify_verdict_file() { printf APPROVE; }')"
  if printf '%s\n' "$out" | grep -qx 'OUTCOME=APPROVE'; then
    pass "fan-agg (D mutation): inverting classify_verdict_file flips C to APPROVE (assertion bites)"
  else
    fail "fan-agg (D mutation): mutant did NOT change the outcome — scenario C may not be exercising the rule :: $out"
  fi
}

#############################################################################
# TEST 37 — build_prepr_packet: the OPTIONAL trailing per-job instruction seam [PHASE 2a]
#
#   The multi-lens path (Phase 3) will call build_prepr_packet once per persona with a
#   DIFFERENT instruction file per job, WITHOUT mutating the $INSTRUCTIONS_FILE global.
#   Drive build_prepr_packet DIRECTLY (source the wrapper, guarded main => no dispatch) over
#   a tiny real repo and assert:
#     (A) with the new 7th arg = a temp instruction file, the built packet contains THAT
#         file's unique marker (and NOT the default reviewer-instructions text).
#     (B) with NO 7th arg, the packet still uses $INSTRUCTIONS_FILE (default, unchanged).
#     (C) MUTATION-CHECK: if the seam were a no-op (build_prepr_packet ignored $7 and always
#         used $INSTRUCTIONS_FILE), scenario A's marker would be ABSENT — assert it's present,
#         then re-run with a shadow that ignores $7 and confirm the marker DISAPPEARS.
#############################################################################
run_test_37() {
  local repo pkgdir
  repo="$(make_repo)"
  printf 'seed\n' > "$repo/seed.txt"
  git -C "$repo" add seed.txt && git -C "$repo" commit -qm init
  printf 'changed line\n' >> "$repo/seed.txt"   # a tracked modification to diff

  # a per-job persona file with a marker that CANNOT appear in the default instructions
  local custom="$SANDBOX/custom-lens-instr.md"
  printf 'CUSTOM-LENS-MARKER-9F3A: review only through the widget lens.\n' > "$custom"

  # driver: source the wrapper, set the deps build_prepr_packet reads, call it, print packet
  run_bpp() { # <instr-arg-or-empty> <presource-override>
    local instr_arg="$1" override="${2:-}"
    (
      set +u
      # shellcheck disable=SC1090
      . "$WRAPPER" >/dev/null 2>&1 || { printf 'SOURCEFAIL\n'; exit 0; }
      if ! type build_prepr_packet >/dev/null 2>&1; then printf 'NOFUNC\n'; exit 0; fi
      REPO_ROOT="$repo"; RUN_DIR="$SANDBOX/bpp-run"; ROUND=1
      rm -rf "$RUN_DIR"; mkdir -p "$RUN_DIR"
      [ -n "$override" ] && eval "$override"
      local changed="$RUN_DIR/changed" untracked="$RUN_DIR/untracked" packet="$RUN_DIR/packet"
      printf 'seed.txt\n' > "$changed"; : > "$untracked"
      local base; base="$(git -C "$repo" rev-parse HEAD)"
      if [ -n "$instr_arg" ]; then
        build_prepr_packet "$packet" "$changed" "$untracked" "$base" 0 "" "$instr_arg" >/dev/null 2>&1
      else
        build_prepr_packet "$packet" "$changed" "$untracked" "$base" 0 "" >/dev/null 2>&1
      fi
      cat "$packet" 2>/dev/null
    ) 2>/dev/null
  }

  local out_custom out_default
  out_custom="$(run_bpp "$custom")"
  if printf '%s' "$out_custom" | grep -q 'SOURCEFAIL'; then
    fail "bpp: could not source wrapper"; return
  fi
  if printf '%s' "$out_custom" | grep -q 'NOFUNC'; then
    fail "bpp: build_prepr_packet not defined in wrapper"; return
  fi
  # (A) the custom instruction marker appears when the 7th arg is supplied
  if printf '%s' "$out_custom" | grep -q 'CUSTOM-LENS-MARKER-9F3A'; then
    pass "bpp (A): 7th-arg instruction file is used (custom marker present in packet)"
  else
    fail "bpp (A): custom instruction marker missing from packet"
  fi
  # (A') and the DEFAULT reviewer text is NOT what led the packet (seam replaced it)
  if printf '%s' "$out_custom" | grep -q 'THIRD independent reviewer'; then
    fail "bpp (A'): default reviewer text leaked despite a custom 7th arg"
  else
    pass "bpp (A'): default reviewer text NOT used when a 7th arg is supplied"
  fi

  # (B) no 7th arg -> default $INSTRUCTIONS_FILE (its signature phrase) is used, custom absent
  out_default="$(run_bpp "")"
  if printf '%s' "$out_default" | grep -q 'THIRD independent reviewer' \
     && ! printf '%s' "$out_default" | grep -q 'CUSTOM-LENS-MARKER-9F3A'; then
    pass "bpp (B): no 7th arg -> default \$INSTRUCTIONS_FILE used (unchanged)"
  else
    fail "bpp (B): default packet wrong (expected default reviewer text, no custom marker)"
  fi

  # (C) MUTATION-CHECK: shadow build_prepr_packet with a version that IGNORES $7 (no-op seam).
  # The custom marker must then DISAPPEAR — proving assertion (A) actually bites on the seam.
  local mut
  mut='build_prepr_packet() { local packet="$1"; cat "$INSTRUCTIONS_FILE" > "$packet"; }'
  out_custom="$(run_bpp "$custom" "$mut")"
  if printf '%s' "$out_custom" | grep -q 'CUSTOM-LENS-MARKER-9F3A'; then
    fail "bpp (C mutation): no-op seam STILL produced the custom marker (assertion A does not bite)"
  else
    pass "bpp (C mutation): a seam that ignores \$7 drops the custom marker (assertion A bites)"
  fi

  # (D) FAIL-CLOSED: a missing/unreadable custom instruction file MUST fail closed (INFRA_ERROR),
  # never silently build a persona-LESS packet and go on to invoke Codex (a fail-open review with no
  # HARD INVARIANTS). Capture build_prepr_packet's OWN stdout (die_infra prints INFRA_ERROR there).
  local out_missing
  out_missing="$(
    set +u
    . "$WRAPPER" >/dev/null 2>&1 || { printf 'SOURCEFAIL'; exit 0; }
    REPO_ROOT="$repo"; RUN_DIR="$SANDBOX/bpp-run-d"; ROUND=1; VERDICT_FILE="$SANDBOX/bpp-run-d/verdict.json"
    rm -rf "$RUN_DIR"; mkdir -p "$RUN_DIR"
    ch="$RUN_DIR/changed"; ut="$RUN_DIR/untracked"; pk="$RUN_DIR/packet"
    printf 'seed.txt\n' > "$ch"; : > "$ut"
    b="$(git -C "$repo" rev-parse HEAD)"
    build_prepr_packet "$pk" "$ch" "$ut" "$b" 0 "" "$SANDBOX/nonexistent-lens-9Z7.md" 2>/dev/null
  )"
  if printf '%s' "$out_missing" | grep -q 'INFRA_ERROR' && printf '%s' "$out_missing" | grep -qi 'not readable'; then
    pass "bpp (D): missing custom instruction file fails CLOSED (INFRA_ERROR, no persona-less packet)"
  else
    fail "bpp (D): missing custom instruction file did NOT fail closed :: [$out_missing]"
  fi
}

#############################################################################
# TEST 38 — fan_out_and_aggregate: the vocabulary seam on the aggregate .summary [PHASE 2b]
#
#   fan_out_and_aggregate words its aggregate VERDICT-FILE .summary with FAN_NOUN/FAN_NOUN_PLURAL
#   (default shard/shards). A lens caller sets FAN_NOUN=lens / FAN_NOUN_PLURAL=lenses. Assert:
#     (A) DEFAULT summary is byte-identical to the historical shard wording (all 3 branches:
#         all-approve, block-union, inconclusive) — so shard_and_review's output is unchanged.
#     (B) OVERRIDE summary says "lens"/"lenses" (never "shard"/"shards") in each branch.
#     (C) MUTATION-CHECK: an override that is a no-op (helper ignores FAN_NOUN) would leave
#         "shards" in the override run — assert the override run has NO "shard" token.
#############################################################################
run_test_38() {
  local job_dir
  job_dir="$SANDBOX/fan-vocab"
  rm -rf "$job_dir"; mkdir -p "$job_dir"
  printf 'lens-alpha packet: clean review\n' > "$job_dir/alpha.packet"
  printf 'lens-beta packet: clean review\n'  > "$job_dir/beta.packet"
  printf 'lens-gamma packet: SHARDBLOCKER-GAMMA problem\n' > "$job_dir/gamma.packet"
  printf 'lens-epsilon packet: FAN-OVERFLOW-EPSILON marker\n' > "$job_dir/epsilon.packet"

  # driver: source wrapper, run fan_out_and_aggregate, print the aggregate .summary ONLY.
  run_fan_sum() { # <jobs-file> <stub-env> <fan-env>
    local jobs="$1" stubenv="$2" fanenv="${3:-}"
    (
      set +u
      # shellcheck disable=SC1090
      . "$WRAPPER" >/dev/null 2>&1 || { printf 'SOURCEFAIL\n'; exit 0; }
      if ! type fan_out_and_aggregate >/dev/null 2>&1; then printf 'NOFUNC\n'; exit 0; fi
      RUN_DIR="$job_dir/run"; rm -rf "$RUN_DIR"; mkdir -p "$RUN_DIR"
      REPO_ROOT="$job_dir"; ROUND=1; set_round_paths
      eval "$stubenv"; [ -n "$fanenv" ] && eval "$fanenv"
      export STUB_MODE="${STUB_MODE:-approve}"
      export STUB_BLOCK_IF_STDIN="${STUB_BLOCK_IF_STDIN:-}"
      export STUB_OVERFLOW_IF_STDIN="${STUB_OVERFLOW_IF_STDIN:-}"
      fan_out_and_aggregate "$jobs" >/dev/null 2>&1
      jq -r '.summary // ""' "$VERDICT_FILE" 2>/dev/null
    ) 2>/dev/null
  }

  # jobs files for each branch
  { printf 'alpha\t2\t%s\n' "$job_dir/alpha.packet"; printf 'beta\t3\t%s\n' "$job_dir/beta.packet"; } > "$job_dir/jobs-approve.tsv"
  { printf 'alpha\t1\t%s\n' "$job_dir/alpha.packet"; printf 'gamma\t1\t%s\n' "$job_dir/gamma.packet"; } > "$job_dir/jobs-block.tsv"
  { printf 'alpha\t1\t%s\n' "$job_dir/alpha.packet"; printf 'epsilon\t1\t%s\n' "$job_dir/epsilon.packet"; } > "$job_dir/jobs-inc.tsv"

  # ---- (A) DEFAULT wording is the historical shard wording, byte-for-byte ----
  local sA sB sI
  sA="$(run_fan_sum "$job_dir/jobs-approve.tsv" 'STUB_MODE=approve')"
  if printf '%s' "$sA" | grep -q 'SOURCEFAIL\|NOFUNC'; then fail "fan-vocab: source/func setup failed :: $sA"; return; fi
  if [ "$sA" = "sharded review: 2 shards all approved (5 files, full coverage)" ]; then
    pass "fan-vocab (A): default all-approve summary is byte-identical shard wording"
  else
    fail "fan-vocab (A): default all-approve summary drifted :: $sA"
  fi
  sB="$(run_fan_sum "$job_dir/jobs-block.tsv" 'STUB_MODE=approve; STUB_BLOCK_IF_STDIN=SHARDBLOCKER')"
  if [ "$sB" = "sharded review: one or more shards reported blockers (union)" ]; then
    pass "fan-vocab (A): default block-union summary is byte-identical shard wording"
  else
    fail "fan-vocab (A): default block-union summary drifted :: $sB"
  fi
  sI="$(run_fan_sum "$job_dir/jobs-inc.tsv" 'STUB_MODE=approve; STUB_OVERFLOW_IF_STDIN=FAN-OVERFLOW-EPSILON')"
  if [ "$sI" = "shard epsilon inconclusive" ]; then
    pass "fan-vocab (A): default inconclusive summary is byte-identical shard wording"
  else
    fail "fan-vocab (A): default inconclusive summary drifted :: $sI"
  fi

  # ---- (B) OVERRIDE wording says lens/lenses, never shard/shards ----
  local lA lB lI
  lA="$(run_fan_sum "$job_dir/jobs-approve.tsv" 'STUB_MODE=approve' 'FAN_NOUN=lens; FAN_NOUN_PLURAL=lenses')"
  if printf '%s' "$lA" | grep -q 'lenses' && ! printf '%s' "$lA" | grep -q 'shard'; then
    pass "fan-vocab (B): override all-approve summary uses 'lenses' (no 'shard')"
  else
    fail "fan-vocab (B): override all-approve summary wrong :: $lA"
  fi
  lB="$(run_fan_sum "$job_dir/jobs-block.tsv" 'STUB_MODE=approve; STUB_BLOCK_IF_STDIN=SHARDBLOCKER' 'FAN_NOUN=lens; FAN_NOUN_PLURAL=lenses')"
  if printf '%s' "$lB" | grep -q 'lenses' && ! printf '%s' "$lB" | grep -q 'shard'; then
    pass "fan-vocab (B): override block-union summary uses 'lenses' (no 'shard')"
  else
    fail "fan-vocab (B): override block-union summary wrong :: $lB"
  fi
  lI="$(run_fan_sum "$job_dir/jobs-inc.tsv" 'STUB_MODE=approve; STUB_OVERFLOW_IF_STDIN=FAN-OVERFLOW-EPSILON' 'FAN_NOUN=lens; FAN_NOUN_PLURAL=lenses')"
  if printf '%s' "$lI" | grep -q 'lens ' && ! printf '%s' "$lI" | grep -q 'shard'; then
    pass "fan-vocab (B): override inconclusive summary uses 'lens' (no 'shard')"
  else
    fail "fan-vocab (B): override inconclusive summary wrong :: $lI"
  fi

  # ---- (C) MUTATION-CHECK: the override MUST actually change the wording ----
  # sA (default) and lA (override) must DIFFER; if the seam were a no-op they'd be identical.
  if [ "$sA" != "$lA" ] && printf '%s' "$lA" | grep -q 'lenses'; then
    pass "fan-vocab (C mutation): override wording differs from default (seam is not a no-op)"
  else
    fail "fan-vocab (C mutation): override wording == default -> vocabulary seam is a no-op :: def='$sA' ovr='$lA'"
  fi
}

#############################################################################
# TEST 39 — the 4 lens persona files exist AND each carries the shared contract [PHASE 2c]
#
#   The lens dispatch (Phase 3) will feed one of these persona files per reviewer thread.
#   EACH persona must preserve the base HARD INVARIANTS + the G6 must-fix->blockers[] rule,
#   or a lens whose must-fix items skip blockers[] would classify as inconclusive downstream.
#   Assert (grep-level contract check) that every lens file exists and contains:
#     - single-JSON invariant ("EXACTLY ONE JSON object")
#     - read-only invariant ("read-only")
#     - the G6 must-fix -> blockers[] contract (a MUST-FIX ... belongs in / goes in blockers[])
#     - the LENS SCOPE directive
#   The frontend lens additionally carries its "no frontend surface" no-fabrication rule.
#############################################################################
run_test_39() {
  local skill_dir lens f
  skill_dir="$TEST_DIR"   # persona files live next to reviewer-instructions.md (== wrapper dir)
  for lens in arch security tests frontend; do
    f="$skill_dir/reviewer-instructions.$lens.md"
    if [ ! -f "$f" ]; then
      fail "lens-persona ($lens): file missing at $f"; continue
    fi
    pass "lens-persona ($lens): file exists"
    # single-JSON-object invariant
    if grep -q 'EXACTLY ONE JSON object' "$f"; then
      pass "lens-persona ($lens): carries single-JSON-object invariant"
    else
      fail "lens-persona ($lens): missing single-JSON-object invariant"
    fi
    # read-only invariant
    if grep -q 'read-only' "$f"; then
      pass "lens-persona ($lens): carries read-only invariant"
    else
      fail "lens-persona ($lens): missing read-only invariant"
    fi
    # G6: must-fix -> blockers[] (case-insensitive on MUST-FIX, requires the words blockers[])
    if grep -qi 'must-fix' "$f" && grep -qi 'belongs in blockers\[\]' "$f"; then
      pass "lens-persona ($lens): carries G6 must-fix->blockers[] contract"
    else
      fail "lens-persona ($lens): missing G6 must-fix->blockers[] contract"
    fi
    # LENS SCOPE directive present
    if grep -q 'LENS SCOPE' "$f"; then
      pass "lens-persona ($lens): carries the LENS SCOPE directive"
    else
      fail "lens-persona ($lens): missing the LENS SCOPE directive"
    fi
    # scope-DISTINCTNESS: each lens must carry its OWN unique focus keyword. Guards against a
    # future edit collapsing one lens's scope onto another's (a swap the presence-greps above
    # would miss — the "union = 4x the same finding" risk). Uniqueness verified: arch has no
    # 'injection'/'accessibility', etc.
    case "$lens" in
      arch)     kw='layering' ;;
      security) kw='injection' ;;
      tests)    kw='false-green' ;;
      frontend) kw='accessibility' ;;
      *)        kw='' ;;
    esac
    if [ -n "$kw" ] && grep -qi "$kw" "$f"; then
      pass "lens-persona ($lens): carries its distinctive scope keyword '$kw'"
    else
      fail "lens-persona ($lens): missing distinctive scope keyword '$kw' (scope drift/collapse?)"
    fi
  done
  # frontend-specific no-fabrication rule (note: wording may wrap across lines, so match the
  # note phrase and the never-fabricate directive independently rather than as one line).
  f="$skill_dir/reviewer-instructions.frontend.md"
  if [ -f "$f" ] && grep -qi 'no frontend surface in this' "$f" && grep -qi 'NEVER fabricate' "$f"; then
    pass "lens-persona (frontend): carries the 'no FE surface -> approve, never fabricate' rule"
  else
    fail "lens-persona (frontend): missing the no-fabrication / no-FE-surface rule"
  fi
}


#############################################################################
# TEST 40 — multi-lens DISPATCH fires on --multi AND CODEX_GATE_FANOUT=1 [PHASE 3a]
#   A non-FE diff resolves to the 3 core lenses (arch/security/tests). Both triggers
#   (the --multi flag and the env knob) must reach the multi-lens path: aggregate
#   APPROVE, an additive lenses[] of length 3, per-lens verdict files, the stub invoked
#   ONCE per lens (3), the shards[] key ABSENT (bypassed sharding), coverage preserved.
#   MUTATION sense: without dispatch this would be a single-thread review (1 stub call,
#   no lenses[]); we assert 3 calls + lenses[] present.
#############################################################################
run_test_40() {
  local repo status outcome runDir ncalls trigger
  for trigger in flag env; do
    repo="$(make_repo)"
    printf 'seed\n' > "$repo/seed.txt"
    git -C "$repo" add seed.txt && git -C "$repo" commit -qm init
    printf 'a non-fe change\n' >> "$repo/seed.txt"   # .txt => NOT a FE path => 3 core lenses
    reset_argv_log
    if [ "$trigger" = "flag" ]; then
      ( cd "$repo" && STUB_MODE=approve bash "$WRAPPER" prepr --multi ) > "$SANDBOX/out.txt" 2>"$SANDBOX/err.txt"
    else
      ( cd "$repo" && STUB_MODE=approve CODEX_GATE_FANOUT=1 bash "$WRAPPER" prepr ) > "$SANDBOX/out.txt" 2>"$SANDBOX/err.txt"
    fi
    status="$(last_json_line "$SANDBOX/out.txt")"
    outcome="$(printf '%s' "$status" | jq -r '.outcome // empty')"
    runDir="$(printf '%s' "$status" | jq -r '.runDir // empty')"

    if [ "$outcome" = "APPROVE" ]; then
      pass "multi-dispatch[$trigger]: over a non-FE diff aggregates to APPROVE"
    else
      fail "multi-dispatch[$trigger]: expected APPROVE got '$outcome' :: $status :: $(cat "$SANDBOX/err.txt")"
    fi
    # additive lenses[] present with exactly the 3 core lenses
    if printf '%s' "$status" | jq -e '(.lenses|type=="array") and (.lenses|length==3)' >/dev/null 2>&1; then
      pass "multi-dispatch[$trigger]: status carries lenses[] of length 3"
    else
      fail "multi-dispatch[$trigger]: lenses[] missing/wrong :: $status"
    fi
    if printf '%s' "$status" | jq -e '([.lenses[].lens]|sort)==["arch","security","tests"]' >/dev/null 2>&1; then
      pass "multi-dispatch[$trigger]: applicable lens set is arch/security/tests (no frontend for non-FE diff)"
    else
      fail "multi-dispatch[$trigger]: lens set wrong :: $(printf '%s' "$status" | jq -c '[.lenses[].lens]')"
    fi
    # each lenses[] entry has lens/outcome/verdictPath
    if printf '%s' "$status" | jq -e '.lenses|all(.[]; has("lens") and has("outcome") and has("verdictPath"))' >/dev/null 2>&1; then
      pass "multi-dispatch[$trigger]: each lenses[] entry has lens/outcome/verdictPath"
    else
      fail "multi-dispatch[$trigger]: lenses[] entries missing keys :: $(printf '%s' "$status" | jq -c '.lenses')"
    fi
    # per-lens verdict files persisted under the run dir
    local ok=0
    [ -f "$runDir/lens-arch-verdict.json" ]     || ok=1
    [ -f "$runDir/lens-security-verdict.json" ] || ok=1
    [ -f "$runDir/lens-tests-verdict.json" ]    || ok=1
    check "multi-dispatch[$trigger]: per-lens verdict files (arch/security/tests) persisted" "$ok"
    # stub invoked once PER lens (3)
    ncalls="$(grep -c -- '---END-ARGV---' "$STUB_ARGV_LOG")"
    if [ "$ncalls" -eq 3 ]; then
      pass "multi-dispatch[$trigger]: stub invoked once per lens (3 fresh-thread reviews)"
    else
      fail "multi-dispatch[$trigger]: expected 3 stub calls got $ncalls"
    fi
    # sharding was BYPASSED: no shards[] key on a multi-lens status
    if printf '%s' "$status" | jq -e 'has("shards")' >/dev/null 2>&1; then
      fail "multi-dispatch[$trigger]: status wrongly carries shards[] (sharding not bypassed) :: $status"
    else
      pass "multi-dispatch[$trigger]: no shards[] key (sharding bypassed, non-composable)"
    fi
    # coverage object preserved (additive Tier-2 field)
    if printf '%s' "$status" | jq -e 'has("coverage") and (.coverage.reviewedNow>=1)' >/dev/null 2>&1; then
      pass "multi-dispatch[$trigger]: coverage object preserved"
    else
      fail "multi-dispatch[$trigger]: coverage object missing :: $(printf '%s' "$status" | jq -c '.coverage // empty')"
    fi
  done
}

#############################################################################
# TEST 41 — frontend lens applies ONLY when the diff touches a FE path [PHASE 3a]
#   A diff that touches a .tsx file resolves to 4 lenses (adds frontend); a diff that
#   touches only non-FE files resolves to 3. Proves the FE-path gate.
#############################################################################
run_test_41() {
  local repo status
  # (A) FE diff -> frontend lens present (4 lenses)
  repo="$(make_repo)"
  printf 'seed\n' > "$repo/seed.txt"
  git -C "$repo" add seed.txt && git -C "$repo" commit -qm init
  printf 'export const X = 1;\n' > "$repo/Widget.tsx"    # untracked FE source
  reset_argv_log
  ( cd "$repo" && STUB_MODE=approve bash "$WRAPPER" prepr --multi ) > "$SANDBOX/out.txt" 2>"$SANDBOX/err.txt"
  status="$(last_json_line "$SANDBOX/out.txt")"
  if printf '%s' "$status" | jq -e '([.lenses[].lens]|sort)==["arch","frontend","security","tests"]' >/dev/null 2>&1; then
    pass "fe-lens: a .tsx in the diff adds the frontend lens (4 lenses)"
  else
    fail "fe-lens: expected 4 lenses incl frontend :: $(printf '%s' "$status" | jq -c '[.lenses[].lens]')"
  fi
  # stub called 4x (one per lens)
  local ncalls; ncalls="$(grep -c -- '---END-ARGV---' "$STUB_ARGV_LOG")"
  check "fe-lens: stub invoked once per lens (4)" "$([ "$ncalls" -eq 4 ] && echo 0 || echo 1)"

  # (B) non-FE diff -> NO frontend lens (3 lenses) [complements TEST 40; a direct pairing]
  repo="$(make_repo)"
  printf 'seed\n' > "$repo/seed.txt"
  git -C "$repo" add seed.txt && git -C "$repo" commit -qm init
  printf 'plain text change\n' > "$repo/notes.md"        # docs, not FE
  ( cd "$repo" && STUB_MODE=approve bash "$WRAPPER" prepr --multi ) > "$SANDBOX/out.txt" 2>"$SANDBOX/err.txt"
  status="$(last_json_line "$SANDBOX/out.txt")"
  if printf '%s' "$status" | jq -e '[.lenses[].lens]|index("frontend")|not' >/dev/null 2>&1 \
     && printf '%s' "$status" | jq -e '(.lenses|length)==3' >/dev/null 2>&1; then
    pass "fe-lens: a non-FE diff (.md only) does NOT add the frontend lens (3 lenses)"
  else
    fail "fe-lens: non-FE diff wrongly resolved a frontend lens :: $(printf '%s' "$status" | jq -c '[.lenses[].lens]')"
  fi
}

#############################################################################
# TEST 42 — MAX_LENSES exceeded => INFRA_ERROR with ZERO codex calls [PHASE 3a]
#   Lower CODEX_GATE_FANOUT_MAX_LENSES below the applicable set size and assert the run
#   FAILS CLOSED: outcome INFRA_ERROR, ZERO stub invocations, NO per-lens verdict files.
#   MUTATION-CHECK: a TRUNCATING impl (review only the first MAX lenses) would still make
#   codex calls; we assert the stub argv log has 0 invocations. Then, as a positive control,
#   raise the cap and confirm the SAME diff DOES review (proving the cap was the gate).
#############################################################################
run_test_42() {
  local repo status outcome runDir ncalls
  repo="$(make_repo)"
  printf 'seed\n' > "$repo/seed.txt"
  git -C "$repo" add seed.txt && git -C "$repo" commit -qm init
  printf 'export const X=1;\n' > "$repo/Widget.tsx"      # FE diff => 4 applicable lenses
  reset_argv_log
  # cap = 3, applicable = 4 => must fail closed with ZERO calls
  ( cd "$repo" && STUB_MODE=approve CODEX_GATE_FANOUT_MAX_LENSES=3 bash "$WRAPPER" prepr --multi ) > "$SANDBOX/out.txt" 2>"$SANDBOX/err.txt"
  status="$(last_json_line "$SANDBOX/out.txt")"
  outcome="$(printf '%s' "$status" | jq -r '.outcome // empty')"
  runDir="$(printf '%s' "$status" | jq -r '.runDir // empty')"

  if [ "$outcome" = "INFRA_ERROR" ]; then
    pass "max-lenses: applicable set > cap fails CLOSED (INFRA_ERROR)"
  else
    fail "max-lenses: expected INFRA_ERROR got '$outcome' :: $status :: $(cat "$SANDBOX/err.txt")"
  fi
  if printf '%s' "$status" | jq -r '.summary // ""' | grep -qi 'exceeds CODEX_GATE_FANOUT_MAX_LENSES'; then
    pass "max-lenses: summary names the cap (exceeds CODEX_GATE_FANOUT_MAX_LENSES)"
  else
    fail "max-lenses: summary missing the cap message :: $(printf '%s' "$status" | jq -r '.summary')"
  fi
  # THE key fail-closed assertion (mutation-bite): ZERO codex invocations.
  ncalls="$(grep -c -- '---END-ARGV---' "$STUB_ARGV_LOG" 2>/dev/null)"; [ -n "$ncalls" ] || ncalls=0
  if [ "$ncalls" -eq 0 ]; then
    pass "max-lenses: ZERO codex calls when the cap is exceeded (a truncating impl would call)"
  else
    fail "max-lenses: expected 0 codex calls got $ncalls (fail-closed VIOLATED — likely truncating) :: $(cat "$STUB_ARGV_LOG")"
  fi
  # NO per-lens verdict files were written (nothing was reviewed)
  if ls "$runDir"/lens-*-verdict.json >/dev/null 2>&1; then
    fail "max-lenses: per-lens verdict files exist despite fail-closed :: $(ls "$runDir"/lens-*-verdict.json)"
  else
    pass "max-lenses: NO per-lens verdict files (nothing reviewed)"
  fi
  # positive control: raise the cap to 4 => the SAME diff DOES review (4 lenses, APPROVE).
  reset_argv_log
  ( cd "$repo" && STUB_MODE=approve CODEX_GATE_FANOUT_MAX_LENSES=4 bash "$WRAPPER" prepr --multi ) > "$SANDBOX/out2.txt" 2>"$SANDBOX/err2.txt"
  status="$(last_json_line "$SANDBOX/out2.txt")"
  ncalls="$(grep -c -- '---END-ARGV---' "$STUB_ARGV_LOG" 2>/dev/null)"; [ -n "$ncalls" ] || ncalls=0
  if [ "$(printf '%s' "$status" | jq -r '.outcome')" = "APPROVE" ] && [ "$ncalls" -eq 4 ]; then
    pass "max-lenses: raising the cap to 4 reviews the SAME diff (4 calls, APPROVE) — the cap was the gate"
  else
    fail "max-lenses: positive control failed (outcome=$(printf '%s' "$status" | jq -r '.outcome') calls=$ncalls)"
  fi
  # malformed knob must fail CLOSED (a bad value would otherwise make the -gt test error and fall
  # through / fail OPEN). Expect INFRA_ERROR with ZERO codex calls.
  reset_argv_log
  ( cd "$repo" && STUB_MODE=approve CODEX_GATE_FANOUT_MAX_LENSES=abc bash "$WRAPPER" prepr --multi ) > "$SANDBOX/out3.txt" 2>"$SANDBOX/err3.txt"
  status="$(last_json_line "$SANDBOX/out3.txt")"
  ncalls="$(grep -c -- '---END-ARGV---' "$STUB_ARGV_LOG" 2>/dev/null)"; [ -n "$ncalls" ] || ncalls=0
  if [ "$(printf '%s' "$status" | jq -r '.outcome // empty')" = "INFRA_ERROR" ] && [ "$ncalls" -eq 0 ]; then
    pass "max-lenses: a malformed CODEX_GATE_FANOUT_MAX_LENSES fails CLOSED (INFRA_ERROR, 0 calls)"
  else
    fail "max-lenses: malformed cap did not fail closed (outcome=$(printf '%s' "$status" | jq -r '.outcome') calls=$ncalls) :: $status"
  fi
}

#############################################################################
# TEST 43 — --multi is non-composable with sharding: over-budget => OVERFLOW, never shard [PHASE 3b]
#   With a tiny budget so each lens FULL-diff packet is over budget, a multi-lens run must
#   fail closed to OVERFLOW (NOT shard). Assert: outcome OVERFLOW, ZERO codex calls (the
#   over-budget check is pre-flight), NO shard verdict files, NO lens verdict files, and the
#   summary tells the user to narrow (prepr-delta --multi) or drop --multi.
#############################################################################
run_test_43() {
  local repo status outcome runDir ncalls i
  repo="$(make_repo)"
  printf 'seed\n' > "$repo/seed.txt"
  git -C "$repo" add seed.txt && git -C "$repo" commit -qm init
  { for i in $(seq 1 60); do printf 'src-line-%s padding padding\n' "$i"; done; } > "$repo/app.js"  # ~1.6KB body
  reset_argv_log
  # Tiny budget so even a single-lens FULL packet blows it; SHARD=auto to prove multi-lens
  # does NOT hand off to sharding.
  ( cd "$repo" && CODEX_GATE_PACKET_BUDGET=200 CODEX_GATE_SHARD=auto STUB_MODE=approve \
       bash "$WRAPPER" prepr --multi ) > "$SANDBOX/out.txt" 2>"$SANDBOX/err.txt"
  status="$(last_json_line "$SANDBOX/out.txt")"
  outcome="$(printf '%s' "$status" | jq -r '.outcome // empty')"
  runDir="$(printf '%s' "$status" | jq -r '.runDir // empty')"

  if [ "$outcome" = "OVERFLOW" ]; then
    pass "multi-nobudget: over-budget multi-lens fails closed to OVERFLOW (never shards)"
  else
    fail "multi-nobudget: expected OVERFLOW got '$outcome' :: $status :: $(cat "$SANDBOX/err.txt")"
  fi
  ncalls="$(grep -c -- '---END-ARGV---' "$STUB_ARGV_LOG" 2>/dev/null)"; [ -n "$ncalls" ] || ncalls=0
  if [ "$ncalls" -eq 0 ]; then
    pass "multi-nobudget: ZERO codex calls (over-budget is a pre-flight fail-closed gate)"
  else
    fail "multi-nobudget: expected 0 codex calls got $ncalls"
  fi
  if ls "$runDir"/shard-*-verdict.json >/dev/null 2>&1; then
    fail "multi-nobudget: shard verdict files produced — multi-lens WRONGLY sharded :: $(ls "$runDir"/shard-*-verdict.json)"
  else
    pass "multi-nobudget: NO shard verdict files (mutually exclusive with sharding)"
  fi
  if printf '%s' "$status" | jq -e 'has("shards")' >/dev/null 2>&1; then
    fail "multi-nobudget: status carries shards[] — sharding was not bypassed :: $status"
  else
    pass "multi-nobudget: status has no shards[] key"
  fi
  if printf '%s' "$status" | jq -r '.summary // ""' | grep -qi 'prepr-delta --multi'; then
    pass "multi-nobudget: summary tells the user to narrow via 'prepr-delta --multi'"
  else
    fail "multi-nobudget: summary missing the narrow guidance :: $(printf '%s' "$status" | jq -r '.summary')"
  fi
  # 3e (fail-closed provenance): even the over-budget OVERFLOW status carries additive lenses[],
  # with the over-budget lens marked OVERFLOW (and no shards[]).
  if printf '%s' "$status" | jq -e '(.lenses | type=="array") and (.lenses | length >= 1) and (any(.lenses[]; .outcome=="OVERFLOW"))' >/dev/null 2>&1; then
    pass "multi-nobudget: OVERFLOW status carries lenses[] provenance (over-budget lens = OVERFLOW)"
  else
    fail "multi-nobudget: OVERFLOW status missing lenses[] provenance :: $status"
  fi

  # MALFORMED budget knob must fail CLOSED (a non-numeric value would otherwise make the `-gt`
  # comparison error and fall through / fail OPEN, invoking codex). Cover BOTH the --multi path
  # and the normal (non-multi) path — the guard is central in _prepr_common. Expect INFRA_ERROR, 0 calls.
  local mstatus mcalls
  reset_argv_log
  ( cd "$repo" && CODEX_GATE_PACKET_BUDGET=abc STUB_MODE=approve bash "$WRAPPER" prepr --multi ) > "$SANDBOX/outm.txt" 2>"$SANDBOX/errm.txt"
  mstatus="$(last_json_line "$SANDBOX/outm.txt")"
  mcalls="$(grep -c -- '---END-ARGV---' "$STUB_ARGV_LOG" 2>/dev/null)"; [ -n "$mcalls" ] || mcalls=0
  if [ "$(printf '%s' "$mstatus" | jq -r '.outcome // empty')" = "INFRA_ERROR" ] && [ "$mcalls" -eq 0 ]; then
    pass "budget-validate: malformed CODEX_GATE_PACKET_BUDGET fails CLOSED under --multi (INFRA_ERROR, 0 calls)"
  else
    fail "budget-validate: malformed budget did not fail closed under --multi (outcome=$(printf '%s' "$mstatus" | jq -r '.outcome') calls=$mcalls) :: $mstatus"
  fi
  reset_argv_log
  ( cd "$repo" && CODEX_GATE_PACKET_BUDGET=abc STUB_MODE=approve bash "$WRAPPER" prepr ) > "$SANDBOX/outn.txt" 2>"$SANDBOX/errn.txt"
  mstatus="$(last_json_line "$SANDBOX/outn.txt")"
  mcalls="$(grep -c -- '---END-ARGV---' "$STUB_ARGV_LOG" 2>/dev/null)"; [ -n "$mcalls" ] || mcalls=0
  if [ "$(printf '%s' "$mstatus" | jq -r '.outcome // empty')" = "INFRA_ERROR" ] && [ "$mcalls" -eq 0 ]; then
    pass "budget-validate: malformed CODEX_GATE_PACKET_BUDGET fails CLOSED on the NORMAL path too (INFRA_ERROR, 0 calls)"
  else
    fail "budget-validate: malformed budget did not fail closed on the normal path (outcome=$(printf '%s' "$mstatus" | jq -r '.outcome') calls=$mcalls) :: $mstatus"
  fi
}

#############################################################################
# TEST 44 — any lens inconclusive => whole run OVERFLOWs (fail closed) [PHASE 3 fail-closed]
#   All lenses review the SAME diff; STUB_OVERFLOW_IF_STDIN matches a marker that appears in
#   EVERY lens packet (same full diff), so at least one lens call returns the context-window
#   signature. The aggregate must NOT APPROVE — it fails closed to OVERFLOW.
#############################################################################
run_test_44() {
  local repo status outcome
  repo="$(make_repo)"
  printf 'seed\n' > "$repo/seed.txt"
  git -C "$repo" add seed.txt && git -C "$repo" commit -qm init
  printf 'src line MULTI-LENS-OVERFLOW-MARK\n' >> "$repo/seed.txt"
  ( cd "$repo" && STUB_MODE=approve STUB_OVERFLOW_IF_STDIN=MULTI-LENS-OVERFLOW-MARK \
       bash "$WRAPPER" prepr --multi ) > "$SANDBOX/out.txt" 2>"$SANDBOX/err.txt"
  status="$(last_json_line "$SANDBOX/out.txt")"
  outcome="$(printf '%s' "$status" | jq -r '.outcome // empty')"
  if [ "$outcome" = "APPROVE" ]; then
    fail "multi-failclosed: APPROVED despite an inconclusive lens :: $status"
  else
    pass "multi-failclosed: an inconclusive lens does NOT APPROVE (got $outcome)"
  fi
  if [ "$outcome" = "OVERFLOW" ]; then
    pass "multi-failclosed: surfaced outcome is OVERFLOW"
  else
    fail "multi-failclosed: expected OVERFLOW got '$outcome' :: $status"
  fi
  if printf '%s' "$status" | jq -e '[.lenses[]? | select(.outcome=="OVERFLOW" or .outcome=="INFRA_ERROR")]|length>=1' >/dev/null 2>&1; then
    pass "multi-failclosed: lenses[] records the inconclusive lens"
  else
    fail "multi-failclosed: lenses[] missing the inconclusive lens :: $(printf '%s' "$status" | jq -c '.lenses')"
  fi
}

#############################################################################
# TEST 45 — cross-lens blocker DE-DUP (G3) [PHASE 3d]
#   Two lenses report the SAME finding (same file+line+issue); a third reports a DISTINCT
#   one. The aggregate BLOCK must collapse the duplicate to ONE blocker (dedup), so the count
#   reflects DISTINCT findings, not lens count. Driven by the DEDUP-shaped stub mode below.
#   MUTATION sense: without dedup the union would carry 3 blockers (2 identical); we assert 2.
#############################################################################
run_test_45() {
  local repo status outcome vpath nb
  repo="$(make_repo)"
  printf 'seed\n' > "$repo/seed.txt"
  git -C "$repo" add seed.txt && git -C "$repo" commit -qm init
  printf 'a change to force a non-empty diff\n' >> "$repo/seed.txt"
  # STUB_MODE=lens_dedup: each lens emits blockers keyed to its OWN persona-marker in the
  # packet. arch+security emit the SAME shared blocker (file=shared.js,line=7,issue=DUPE);
  # tests emits a DISTINCT one. The stub greps the lens persona marker from stdin.
  ( cd "$repo" && STUB_MODE=lens_dedup bash "$WRAPPER" prepr --multi ) > "$SANDBOX/out.txt" 2>"$SANDBOX/err.txt"
  status="$(last_json_line "$SANDBOX/out.txt")"
  outcome="$(printf '%s' "$status" | jq -r '.outcome // empty')"
  vpath="$(printf '%s' "$status" | jq -r '.verdictPath // empty')"

  if [ "$outcome" = "BLOCK" ]; then
    pass "multi-dedup: a blocking lens set aggregates to BLOCK"
  else
    fail "multi-dedup: expected BLOCK got '$outcome' :: $status :: $(cat "$SANDBOX/err.txt")"
  fi
  # DISTINCT blockers after dedup == 2 (the shared DUPE collapses to one; tests contributes one).
  nb="$(printf '%s' "$status" | jq -r '.blockers // 0')"
  if [ "$nb" = "2" ]; then
    pass "multi-dedup: cross-lens duplicate collapses -> 2 DISTINCT blockers (not 3)"
  else
    fail "multi-dedup: expected 2 distinct blockers got $nb :: $([ -f "$vpath" ] && jq -c '.blockers' "$vpath" || echo no-file)"
  fi
  # the verdict file has EXACTLY one entry for the shared DUPE issue (dedup applied to the file too)
  if [ -f "$vpath" ] && [ "$(jq -r '[.blockers[]|select(.issue=="DUPE-FINDING")]|length' "$vpath" 2>/dev/null)" = "1" ]; then
    pass "multi-dedup: the shared finding appears exactly ONCE in the union verdict file"
  else
    fail "multi-dedup: shared finding not de-duped in verdict file :: $([ -f "$vpath" ] && jq -c '[.blockers[].issue]' "$vpath" || echo no-file)"
  fi
  # and the DISTINCT finding survived
  if [ -f "$vpath" ] && jq -e '[.blockers[]|select(.issue=="TESTS-ONLY-FINDING")]|length==1' "$vpath" >/dev/null 2>&1; then
    pass "multi-dedup: the distinct (tests-only) finding survives dedup"
  else
    fail "multi-dedup: distinct finding lost :: $([ -f "$vpath" ] && jq -c '[.blockers[].issue]' "$vpath" || echo no-file)"
  fi
}

#############################################################################
# TEST 45b — dedup_verdict_blockers is a NO-OP on an already-unique set (SHARD-path safety)
#   Drive dedup_verdict_blockers DIRECTLY (source the wrapper) over a verdict file whose
#   blockers are already distinct; assert the count is unchanged. Proves the dedup helper
#   never alters a unique set (so the shard path, which only ever produces disjoint-by-path
#   blockers, is unaffected even though it never calls dedup).
#############################################################################
run_test_45b() {
  local out
  out="$(
    set +u
    . "$WRAPPER" >/dev/null 2>&1 || { printf 'SOURCEFAIL'; exit 0; }
    type dedup_verdict_blockers >/dev/null 2>&1 || { printf 'NOFUNC'; exit 0; }
    vf="$SANDBOX/dedup-unique.json"
    printf '%s\n' '{"verdict":"request_changes","summary":"x","blockers":[{"class":"agent_fixable","file":"a.js","line":1,"issue":"one"},{"class":"agent_fixable","file":"b.js","line":2,"issue":"two"}],"nonBlocking":[]}' > "$vf"
    dedup_verdict_blockers "$vf"
    jq -r '(.blockers//[])|length' "$vf"
  )"
  if [ "$out" = "2" ]; then
    pass "dedup-noop: dedup leaves an already-unique 2-blocker set unchanged (shard path safe)"
  else
    fail "dedup-noop: expected 2 got '$out' (dedup altered a unique set)"
  fi
}

#############################################################################
# TEST 46 — additive lenses[] present; existing required status fields intact [PHASE 3e]
#   A multi-lens APPROVE status must carry ALL the usual required fields (outcome/threadId/
#   round/verdictPath/runDir/blockers/agentFixableBlockers/decisionBlockers/summary) PLUS
#   the additive lenses[] — and must NOT carry shards[]. Guards field-shape stability for
#   existing single-thread + shards[] consumers.
#############################################################################
run_test_46() {
  local repo status
  repo="$(make_repo)"
  printf 'seed\n' > "$repo/seed.txt"
  git -C "$repo" add seed.txt && git -C "$repo" commit -qm init
  printf 'a change\n' >> "$repo/seed.txt"
  ( cd "$repo" && STUB_MODE=approve bash "$WRAPPER" prepr --multi ) > "$SANDBOX/out.txt" 2>"$SANDBOX/err.txt"
  status="$(last_json_line "$SANDBOX/out.txt")"
  if printf '%s' "$status" | jq -e 'has("outcome") and has("threadId") and has("round") and has("verdictPath") and has("runDir") and has("blockers") and has("agentFixableBlockers") and has("decisionBlockers") and has("summary")' >/dev/null 2>&1; then
    pass "lenses-status: all existing required status fields are present"
  else
    fail "lenses-status: a required status field is missing :: $status"
  fi
  if printf '%s' "$status" | jq -e '(.lenses|type)=="array"' >/dev/null 2>&1; then
    pass "lenses-status: additive lenses[] array present"
  else
    fail "lenses-status: additive lenses[] missing :: $status"
  fi
  if printf '%s' "$status" | jq -e 'has("shards")|not' >/dev/null 2>&1; then
    pass "lenses-status: no shards[] on the multi-lens path (existing shard consumers unaffected)"
  else
    fail "lenses-status: shards[] wrongly present :: $status"
  fi
}

#############################################################################
# TEST 47 — ledger NO over-claim (G5) [PHASE 3f]
#   A multi-lens APPROVE must NOT write per-file approved-sha ledger rows. Proof: after a
#   `prepr --multi` APPROVE, a subsequent single-thread `prepr-delta` (NO --multi) must STILL
#   review the file (its reviewedNow must include it) — i.e. the lens APPROVE did not mark the
#   file as since-reviewed. Contrast control: a NORMAL single-thread `prepr` APPROVE on the
#   same setup DOES let the next prepr-delta skip the file (reviewedNow drops to 0), proving
#   the ledger-append path exists and that the multi-lens path deliberately abstains.
#############################################################################
run_test_47() {
  local repo status rn

  # ---- (A) multi-lens APPROVE must NOT create a since-reviewed skip ----
  repo="$(make_repo)"
  printf 'seed\n' > "$repo/seed.txt"
  git -C "$repo" add seed.txt && git -C "$repo" commit -qm init
  printf 'a change\n' >> "$repo/seed.txt"
  ( cd "$repo" && STUB_MODE=approve bash "$WRAPPER" prepr --multi ) >/dev/null 2>"$SANDBOX/err.txt"
  # now a delta with NO --multi: the file must STILL be reviewed-now (not skipped)
  ( cd "$repo" && STUB_MODE=approve bash "$WRAPPER" prepr-delta ) > "$SANDBOX/out.txt" 2>>"$SANDBOX/err.txt"
  status="$(last_json_line "$SANDBOX/out.txt")"
  rn="$(printf '%s' "$status" | jq -r '.coverage.reviewedNow // -1')"
  if [ "$rn" -ge 1 ]; then
    pass "ledger-noclaim (A): after a --multi APPROVE, prepr-delta STILL reviews the file (reviewedNow>=1)"
  else
    fail "ledger-noclaim (A): a --multi APPROVE wrongly marked the file since-reviewed (reviewedNow=$rn) :: $status"
  fi

  # ---- (B) contrast control: a NORMAL prepr APPROVE DOES let the next delta skip ----
  repo="$(make_repo)"
  printf 'seed\n' > "$repo/seed.txt"
  git -C "$repo" add seed.txt && git -C "$repo" commit -qm init
  printf 'a change\n' >> "$repo/seed.txt"
  ( cd "$repo" && STUB_MODE=approve bash "$WRAPPER" prepr ) >/dev/null 2>>"$SANDBOX/err.txt"
  ( cd "$repo" && STUB_MODE=approve bash "$WRAPPER" prepr-delta ) > "$SANDBOX/out2.txt" 2>>"$SANDBOX/err.txt"
  status="$(last_json_line "$SANDBOX/out2.txt")"
  rn="$(printf '%s' "$status" | jq -r '.coverage.reviewedNow // -1')"
  local pr="$(printf '%s' "$status" | jq -r '.coverage.priorHashMatch // -1')"
  if [ "$rn" = "0" ] && [ "$pr" -ge 1 ]; then
    pass "ledger-noclaim (B control): a NORMAL prepr APPROVE lets the next prepr-delta skip (reviewedNow=0, priorHashMatch>=1)"
  else
    fail "ledger-noclaim (B control): normal prepr ledger-append did not take effect (reviewedNow=$rn priorHashMatch=$pr) :: $status"
  fi
}

#############################################################################
# TEST 48 — multi-lens APPROVE must NOT bypass the coverage fail-closed guard [PHASE 3f / Tier-2]
#   Even when every lens APPROVES the reviewed-now diff, an unreviewed branch-diff file
#   (coverage.unreviewed>0, forced via CODEX_GATE_FORCE_UNREVIEWED) makes approval impossible —
#   the run must downgrade to OVERFLOW (mirrors emit_outcome's guard), carrying coverage + lenses[].
#############################################################################
run_test_48() {
  local repo status outcome
  repo="$(make_repo)"
  printf 'seed\n' > "$repo/seed.txt"
  git -C "$repo" add seed.txt && git -C "$repo" commit -qm init
  printf 'changed line\n' >> "$repo/seed.txt"   # backend-only change => 3 lenses, all approve
  reset_argv_log
  ( cd "$repo" && STUB_MODE=approve CODEX_GATE_FORCE_UNREVIEWED=1 bash "$WRAPPER" prepr --multi ) > "$SANDBOX/out.txt" 2>"$SANDBOX/err.txt"
  status="$(last_json_line "$SANDBOX/out.txt")"
  outcome="$(printf '%s' "$status" | jq -r '.outcome // empty')"
  if [ "$outcome" = "OVERFLOW" ]; then
    pass "multi-coverage: unreviewed>0 downgrades a multi-lens all-approve to OVERFLOW (fail-closed)"
  else
    fail "multi-coverage: expected OVERFLOW got '$outcome' (coverage guard BYPASSED) :: $status :: $(cat "$SANDBOX/err.txt")"
  fi
  if printf '%s' "$status" | jq -e '(.coverage.unreviewed // 0) > 0' >/dev/null 2>&1; then
    pass "multi-coverage: status carries coverage.unreviewed>0"
  else
    fail "multi-coverage: coverage.unreviewed not >0 :: $status"
  fi
  if printf '%s' "$status" | jq -e '(.lenses | type=="array") and (.lenses | length >= 1)' >/dev/null 2>&1; then
    pass "multi-coverage: the coverage-gap OVERFLOW still carries lenses[] provenance"
  else
    fail "multi-coverage: missing lenses[] :: $status"
  fi
}

#############################################################################
# run everything
#############################################################################
printf '======== codex-gate.test.sh ========\n'
if [ ! -f "$WRAPPER" ]; then
  printf 'NOTE: wrapper not found at %s (expected during RED phase)\n' "$WRAPPER"
fi

run_test_1
run_test_2
run_test_3
run_test_4
run_test_5
run_test_6
run_test_7
run_test_8
run_test_9
run_test_10
run_test_11
run_test_12
# test_13 (hook-arming integration) removed from the portable suite — it depends on owner-installed ~/.claude/hooks infrastructure and lives with that hook, not the plugin.
run_test_14
run_test_15
run_test_16
run_test_17
run_test_18
run_test_19
run_test_20
run_test_21
run_test_22
run_test_23
run_test_24
run_test_25
run_test_26
run_test_27
run_test_28
run_test_29
run_test_30
run_test_31
run_test_32
run_test_33
run_test_34
run_test_35
run_test_36
run_test_37
run_test_38
run_test_39
run_test_40
run_test_41
run_test_42
run_test_43
run_test_44
run_test_45
run_test_45b
run_test_46
run_test_47
run_test_48

printf '====================================\n'
printf 'PASS=%d FAIL=%d\n' "$PASS_COUNT" "$FAIL_COUNT"
if [ "$FAIL_COUNT" -ne 0 ]; then
  exit 1
fi
exit 0
