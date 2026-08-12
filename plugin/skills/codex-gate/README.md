# codex-gate — Codex as an automated, repo-agnostic review gate

User-global skill that turns OpenAI Codex into a hands-free "third pair of eyes" reviewer Claude
drives itself (review → fix agent_fixable defects → re-review → surface decisions/infra to you).
Local-only: nothing is committed to any repo; all state lives under `~/.claude/codex-gate/`.

The contract source of truth is this README.

**Tests:** run `bash codex-gate.test.sh` and expect `FAIL=0`. The printed `PASS=` count is the
authoritative assert total (276 as of 2026-08-11); the per-tier Status lines below list what each
tier added, not running totals. No npm packages — the suite is bash + Node stdlib only.

---

## Phase 0 — contract smoke results (PINNED against the real CLI)

Verified live against `codex-cli 0.144.0-alpha.4` at
`/Applications/ChatGPT.app/Contents/Resources/codex` (call by absolute path; `CODEX_BIN` can override it).

**Dedicated, config-isolated home** — `CODEX_HOME=~/.claude/codex-gate/home`
- `auth.json` symlinked → `~/.codex/auth.json`. Headless auth **works** (no login prompt).
- Holds our reviewer `AGENTS.md` (invariants). `--ignore-user-config` skips a home `config.toml`
  but **not** `AGENTS.md` — the dedicated home is what excludes the user's personal `~/.codex/AGENTS.md`.
- OPEN RISK: a token refresh may *replace* `auth.json` (breaking the symlink). Not force-testable on
  demand. Mitigation: auth failure → `INFRA_ERROR` (halt+surface) → run `CODEX_HOME=~/.claude/codex-gate/home codex login`.

**Verdict capture** — read the verdict from the `-o` file, never the JSONL.
- `--output-schema <ABS> -o <ABS> --json` → `-o` file holds the single schema-conforming object.
- `--json` streams JSONL to **stdout**; wrapper redirects it (+ stderr) to per-round files.
- `thread_id` comes from the JSONL event `{"type":"thread.started","thread_id":"…"}`.
- Token usage is in the `{"type":"turn.completed","usage":{…}}` event.
- Exit code ≠ verdict (a `request_changes` still exits 0); branch on parsed JSON, nonzero ⇒ infra.

**Tier is chosen by repo presence, NOT by mode.** Every review mode (plan, bundle, phase-review, prepr,
prepr-delta) runs **code tier when inside a git repo**; doc tier is the fallback **only when cwd is not a git repo**.
(Do not "simplify" plan/bundle back to doc-tier — they must be code-tier in-repo so Codex can read repo canon.)

**Doc tier — NOT-in-a-repo fallback only** (packet-only, shell OFF), cwd = a neutral run-dir:
```
CODEX_HOME=<home> codex exec --ignore-user-config --skip-git-repo-check --sandbox read-only \
  --disable shell_tool --output-schema <ABS schema> -o <ABS out> --json -   # packet on stdin
```

**Code tier — default for ALL review modes inside a git repo** (plan, bundle, phase-review, prepr, prepr-delta), read-only shell ON — cwd = **repo root** (untrusted):
```
CODEX_HOME=<home> codex exec --ignore-user-config --sandbox read-only \
  -c approval_policy="never" --output-schema <ABS schema> -o <ABS out> --json -   # packet on stdin
```
- CONFIRMED: schema **still engages with the shell tool active** (Issue #15451 does NOT bite the
  built-in shell) — the smoke ran `/bin/zsh -lc 'cat ./foo.js'` and returned valid schema JSON
  containing the file's token. So **no packet-only fallback needed** for code tier.
- CONFIRMED: an **untrusted** git repo runs read-only with **no trust prompt** (we never trust the target).
- Do NOT pass `--skip-git-repo-check` when cwd IS a git repo; DO pass it when cwd is not (doc tier).

**Re-review (resume)** — for fix-loop rounds. Resume MIRRORS the initial invocation's safety flags
**per tier** (round-1 posture must carry into every fix-loop round):
```
# CODE-tier resume (cwd = repo root; NO --skip-git-repo-check; shell ON):
cd <repo root>                      # resume has NO -C/--cd
CODEX_HOME=<home> codex exec resume <thread_id> --ignore-user-config \
  -c approval_policy="never" -c sandbox_mode="read-only" \
  --output-schema <ABS> -o <ABS> --json -

# DOC-tier resume (cwd = run dir; shell OFF):
cd <run dir>
CODEX_HOME=<home> codex exec resume <thread_id> --ignore-user-config \
  --skip-git-repo-check --disable shell_tool -c sandbox_mode="read-only" \
  --output-schema <ABS> -o <ABS> --json -
```
- CONFIRMED: context carries across resume + schema engages.
- `codex exec resume` rejects `--sandbox` (use `-c sandbox_mode="read-only"`) and has no `-C`
  (wrapper sets process cwd); needs `--skip-git-repo-check` when cwd isn't a git repo (doc tier).
- Resume keeps the tier's safety flags: code-tier keeps `-c approval_policy="never"`; doc-tier keeps
  `--skip-git-repo-check --disable shell_tool`. Dropping them would relax the round-1 sandbox posture.

**Feature flags** (`codex features list`): `shell_tool` is stable (→ `--disable shell_tool` valid);
`search_tool` is **removed** (no web-search tool to disable in this version).

**Pinned config keys**: `approval_policy="never"` (exec), `sandbox_mode="read-only"` (resume via `-c`).
Leave `CODEX_API_KEY` unset (uses the ChatGPT seat via the symlinked auth).

Status: **all critical Phase-0 contracts GREEN.** Snapshot-scoping git logic + no-write/injection
assertions are exercised by `codex-gate.test.sh` (Phase 1).

---

## Tier 2 — review ledger + `prepr-delta` + coverage (PINNED contract)

- **Review ledger** (under runs/, NEVER the repo): `~/.claude/codex-gate/runs/<repoSlug>-<rootHash>/<worktreeKey>/ledger.jsonl`
  — same namespacing as the run dir but stopped at the **worktree** level (shared across phases/sessions
  of that branch). `resolve_ledger_path` derives it from `resolve_run_dir`'s `WORKTREE_DIR` (no drift).
- **Written ONLY on APPROVE** of `phase-review` / `prepr` / `prepr-delta` (one JSONL line:
  `{mode, ref, reviewedPaths:[{path, sha}], verdictPath, threadId, summary}`; `sha` = `git -C <repo>
  hash-object -- <path>` of working-tree content, deleted → `"deleted"`). NEVER on BLOCK / INFRA_ERROR /
  OVERFLOW, and never for plan / bundle / question (only an approved surface is "reviewed"). The mode hands
  the reviewed-paths list + ref to `emit_outcome` via `$LEDGER_REF` + `$RUN_DIR/.reviewed-paths`.
- **`prepr-delta [base] [round] [threadId]`** — like `prepr` (CODE tier, same base default), but scopes the
  reviewed diff to only files whose current `git hash-object` is NOT an approved-reviewed sha in the ledger
  (unreviewed OR changed-since-reviewed). Skipped files appear in an `===== ALREADY REVIEWED & UNCHANGED =====`
  packet section (`path  sha  (verdict: <ref>)`). Empty delta ⇒ APPROVE **without invoking Codex**
  (summary "all branch surface already reviewed & unchanged (N files, hash-verified)"). Shares the budget
  guard + lean packet + OVERFLOW path with `prepr`.
- **Coverage manifest + fail-closed** — `prepr` / `prepr-delta` add an additive `coverage` object to the
  status: `{reviewedNow, priorHashMatch, excludedPolicy, unreviewed}`. `unreviewed > 0` ⇒ the run is
  downgraded away from APPROVE to a fail-closed `OVERFLOW` (`coverage gap: N file(s) unaccounted`) — approval
  is impossible while required surface is unreviewed. (`coverage` is additive; existing status consumers are
  unaffected. `CODEX_GATE_FORCE_UNREVIEWED` is a test-only seam to exercise the gap path.)
- Doc-proof falls out of the delta: a doc is skipped ONLY when its hash matches an approved review; a changed
  doc re-enters the candidate set. No special-casing of docs.

Status: **Tier 2 contracts GREEN** — exercised by `codex-gate.test.sh` (ledger-write, prepr-delta
scope/skip-proof, empty-delta no-Codex APPROVE, coverage manifest, coverage-gap fail-closed).

---

## Tier 3 — shard an over-budget `prepr`/`prepr-delta` + deterministic aggregate (PINNED contract)

Applies to **`prepr` / `prepr-delta` ONLY** (`phase-review`/`plan`/`bundle`/`question` keep the Tier-1 OVERFLOW).

- **Knob** — `CODEX_GATE_SHARD` (default **`auto`**): when an assembled `prepr`/`prepr-delta` packet exceeds
  `CODEX_GATE_PACKET_BUDGET`, **shard by path** instead of emitting OVERFLOW. `off` ⇒ keep the Tier-1 OVERFLOW
  (no sharding). The trigger lives in `_prepr_common` right where `enforce_packet_budget` would fire.
- **Shard assignment is a COMPLETE, DISJOINT partition** — each reviewed-now file is assigned to the FIRST
  matching group (list order = precedence): `docs` (`docs/**`, `**/*.md`) → `tests` (`**/test*`, `**/*test*`,
  `**/*.test.*`, `**/*_test.*`, `**/__tests__/**`) → `config` (`.docker/**`, `Dockerfile*`, `*.yml/.yaml/.toml/.ini/.cfg`,
  lockfiles) → `other` (catch-all `*`). The group→globs map is a small constant `CODEX_GATE_SHARD_GROUPS`
  (overridable). `shard_group_for_path` runs under `set -f` so the globs are `case` PATTERNS, never expanded
  against cwd. Union of shards == the full reviewed-now set; shards are pairwise disjoint (first-match + catch-all).
- **Per-shard review in its OWN fresh thread** — each non-empty shard gets a lean packet (the SHARED
  `build_prepr_packet`, scoped to that shard's files; diff hunks never dropped), reviewed with `run_codex code`
  in a brand-new thread (no resume, round 1). Verdicts persist at `<runDir>/shard-<group>-verdict.json`
  (+ `shard-<group>.jsonl`/`.stderr`) and a `<runDir>/shard-coverage-map.tsv` (path→group). If a single shard's
  own packet is STILL over budget, that shard is recorded **inconclusive** (`OVERFLOW`) — never silently dropped;
  recursive sub-splitting is out of scope ⇒ the aggregate fails closed.
- **DETERMINISTIC aggregate (NOT an LLM pass — fail-closed, never drops a blocker)** — read every shard verdict:
  - **BLOCK** if ANY shard is BLOCK ⇒ union ALL shards' `blockers[]` + `nonBlocking[]` into
    `<runDir>/round-1-verdict.json`; emit BLOCK with the combined counts.
  - else **OVERFLOW** if ANY shard is OVERFLOW/INFRA_ERROR/inconclusive ⇒ `shard <g> inconclusive — cannot
    certify full coverage` (NEVER APPROVE when a shard didn't get a clean verdict).
  - else (ALL shards APPROVE) ⇒ **APPROVE**, `sharded review: N shards all approved (M files, full coverage)`
    (and the whole reviewed-now surface is recorded in the ledger, like a normal APPROVE).
  Rationale (in-code comment): a deterministic union guarantees a gate never drops a shard's blocker nor approves
  over an unreviewed shard — an LLM aggregate could do either.
- **Status** — the sharded run emits ONE status line (`APPROVE`/`BLOCK`/`OVERFLOW`) with the usual review fields
  **plus** the additive Tier-2 `coverage` object **and** a `shards` summary `[{group, files, outcome, verdictPath}]`.
  Additive only — existing consumers read `outcome`/`blockers` unchanged; `shards` is present only on a sharded run.

Status: **Tier 3 contracts GREEN** — exercised by `codex-gate.test.sh` (adds
shard-partition complete/disjoint, auto-shard trigger + per-shard verdicts + once-per-shard invocation + shards[]
summary, aggregate blocker/nonBlocking union, fail-closed on an inconclusive shard, and `CODEX_GATE_SHARD=off`
keeping the Tier-1 OVERFLOW).

---

## Tier 4 — opt-in multi-LENS fan-out (`prepr`/`prepr-delta` only, PINNED contract)

Applies to **`prepr` / `prepr-delta` ONLY**. Opt-in (**off by default**); reviews the SAME reviewed-now diff
through several INDEPENDENT reviewer personas ("lenses") in fresh threads, then aggregates DETERMINISTICALLY with
the SAME fail-closed core as sharding (`fan_out_and_aggregate`, `FAN_NOUN=lens`). Reuses the whole Phase-0 /
Tier-2 machinery (config-isolated `CODEX_HOME`, `--sandbox read-only`, code tier, packet budget, coverage) — only
the packet's persona and the status's provenance array differ.

- **Trigger** — a `--multi` flag on `prepr`/`prepr-delta` (parsed + stripped in `_prepr_common`, so it can sit
  anywhere among the positional args), OR env `CODEX_GATE_FANOUT` (default **`0`**; `1` == same as `--multi`).
  **Fresh-thread only** — one multi-lens run is round 1; per-lens `exec resume` is deferred to a future decision.
- **Lens set** (`resolve_lens_set` / `is_frontend_path`) — the core lenses `arch`, `security`, `tests` ALWAYS
  apply; the `frontend` lens is added ONLY when the reviewed-now diff touches an FE path per `CODEX_GATE_FE_GLOBS`.
  Each lens loads its persona `reviewer-instructions.<lens>.md`; `build_prepr_packet` fails CLOSED if a persona is
  unreadable (a missing persona can never slip through as a persona-less review).
- **Non-composable with Tier-3 sharding** — the multi-lens dispatch is BEFORE the `CODEX_GATE_SHARD=auto` branch,
  so a multi-lens run NEVER shards. Every lens reviews the FULL diff (multi-lens is NOT an overflow mitigation);
  if ANY lens packet exceeds `CODEX_GATE_PACKET_BUDGET` the run fails closed with **OVERFLOW** (pre-flight, ZERO
  codex calls) telling the user to narrow via `prepr-delta --multi` or drop `--multi` to use sharding.
- **Fail-closed order (NO codex call until every gate passes)** — (1) applicable lens count >
  `CODEX_GATE_FANOUT_MAX_LENSES` (default **4**, a HARD ceiling) ⇒ `INFRA_ERROR`, ZERO codex calls, NEVER
  truncate/drop a lens; a malformed `CODEX_GATE_FANOUT_MAX_LENSES` / `CODEX_GATE_PACKET_BUDGET` ⇒ `INFRA_ERROR`;
  (2) a missing lens persona ⇒ fail closed; (3) any lens over budget ⇒ `OVERFLOW`.
- **Deterministic aggregate (NOT an LLM pass — fail-closed)** — any lens **BLOCK** ⇒ BLOCK (unioned blockers
  **de-duped by file+line+issue** so a cross-lens duplicate collapses to one, via `dedup_verdict_blockers`); else
  any lens inconclusive/errored ⇒ **OVERFLOW** (never APPROVE over an un-clean lens); else all approve ⇒ APPROVE.
  A coverage gap (`coverage.unreviewed > 0`) downgrades even an all-approve run to **OVERFLOW**.
- **Concurrency** — `CODEX_GATE_MAX_PARALLEL_CODEX` (default **1** = sequential). `>1` is RESERVED / not-yet-wired
  and is treated as 1 today; the deterministic aggregate is order-independent, so correctness never depends on it.
- **Status** — ONE status line (`APPROVE`/`BLOCK`/`OVERFLOW`/`INFRA_ERROR`) with the usual review fields **plus**
  the additive Tier-2 `coverage` object **and** an additive `lenses` summary `[{lens, outcome, verdictPath}]`
  (mirrors `shards[]`). A multi-lens run carries **no** `shards[]`; existing consumers read `outcome`/`blockers`
  unchanged. `coverage`/`lenses[]` ride on the **aggregate** BLOCK/OVERFLOW/APPROVE statuses **and** the
  over-budget OVERFLOW; an **early fail-closed `INFRA_ERROR`** (malformed knob / `MAX_LENSES` exceeded / missing
  persona — raised *before* lens jobs run, via `die_infra`) uses the base status shape **without** `lenses[]`.
  **No ledger append on a multi-lens APPROVE** (a lens APPROVE is a dimensional whole-diff certification,
  NOT a per-file-surface approval — a later `prepr-delta` must still review those files).

Status: **Tier 4 contracts GREEN** — exercised by `codex-gate.test.sh` (multi-lens dispatch on `--multi` AND
`CODEX_GATE_FANOUT=1`, the frontend lens applying ONLY on an FE-path diff, `MAX_LENSES` exceeded ⇒ INFRA_ERROR
with zero codex calls / no truncation, per-lens fresh-thread invocation + additive `lenses[]`, sharding bypassed
(no `shards[]`), cross-lens blocker de-dup, over-budget-lens OVERFLOW, coverage-gap fail-closed, and the lens
persona files each carrying the shared contract + a distinct scope directive).

---

## Investigation mode — `investigate <brief>` (PINNED contract)

A **sibling** of the review gate, not a review: it root-causes a bug instead of judging a change. It reuses the
SAME Phase-0 invocation contract (config-isolated `CODEX_HOME`, `--sandbox read-only`, **code tier with read-only
shell when in a repo / doc-tier fallback when not**, `exec resume` thread loop mirroring the tier's safety flags,
fast mode, run dirs, packet budget + OVERFLOW, `--output-schema -o --json` verdict capture) — only the packet,
schema, and outcome mapping differ.

- **Packet** (`mode_investigate`, mirrors `mode_question`'s shape): `investigate-instructions.md` persona →
  `<RUNDIR>/context.md` if present → repo-root guidance manifest → the **INVESTIGATION BRIEF** (the file verbatim)
  → **EVIDENCE GATHERED SO FAR** = `<RUNDIR>/evidence.md` if present. Schema pinned to `investigate.schema.json`
  via the `SCHEMA_OVERRIDE` knob (scoped to the call, unset after) — `verdict.schema.json` is untouched.
- **Driver-supplied evidence** — the loop driver appends safe-probe output to `<RUNDIR>/evidence.md` between
  rounds; every round folds the current `evidence.md` into the packet, so a `exec resume` round is how NEW
  evidence reaches Codex (the same run-dir-drop idiom as `context.md`). Round 1 fresh thread; round N resumes.
- **Schema** (`investigate.schema.json`, all fields required like `question.schema.json`): `outcome ∈
  root_cause_found | needs_more_evidence | unsafe_or_blocked`, `rootCause`, `confidence ∈ low|medium|high`,
  `evidence[]` ({observation, source}), `hypothesesTested[]` ({hypothesis, verdict ∈ confirmed|refuted|inconclusive,
  evidence}), `commandsRun[]`, `forbiddenActionsAvoided[]`, `minimalFix`, `nextSafeProbe`.
- **Outcome mapping** (`emit_investigate_outcome`, fails closed exactly like `emit_outcome`/`emit_question_outcome`):
  the three model outcomes map to the UPPERCASE status `ROOT_CAUSE_FOUND | NEEDS_MORE_EVIDENCE | UNSAFE_OR_BLOCKED`;
  the **wrapper** adds `INFRA_ERROR` (nonzero exit / missing-empty / invalid-JSON / unknown outcome value) and
  `OVERFLOW` (context-window `turn.failed` / pre-flight budget). Status line:
  `{outcome, threadId, round, verdictPath, runDir, confidence, nextSafeProbe, summary}` (summary = `rootCause`
  when found, else `nextSafeProbe` / blocking reason). The full report stays in the `verdictPath` file.
- **Safety model** (the whole point): `--sandbox read-only` protects the repo **filesystem** but NOT external
  side effects (`docker exec`, HTTP, test/eval runs, triggering jobs). So the probe contract is enforced at the
  **prompt layer** — the persona binds Codex to the brief's ALLOWED/FORBIDDEN probe lists, **fails SAFE when the
  brief omits them** (every side-effectful probe treated as forbidden), returns `unsafe_or_blocked` rather than run
  a forbidden probe, and logs `commandsRun` + `forbiddenActionsAvoided`. `approval_policy="never"` means Codex can't
  escalate to run something risky — it routes risky probes back to the driver as a `nextSafeProbe`. The driver is
  bound by the same contract.
- **No fix-loop, no ledger** — investigation proposes `minimalFix` but never applies it (code changes go through
  `plan`/`phase-review`/`prepr`), and it NEVER writes the review ledger (no approved surface; like plan/bundle/question).

Status: **Investigation contracts GREEN** — exercised by `codex-gate.test.sh` (adds
the `investigate` outcome mappings (root_cause_found/needs_more_evidence/unsafe_or_blocked + infra/overflow),
schema pinning to `investigate.schema.json`, code-tier read-only posture, brief+persona in packet, no-ledger,
read-only invariant, and the `exec resume` round folding in `<RUNDIR>/evidence.md`).

---

## Config report — `config` (PINNED contract)

A **report, not a gate**. `codex-gate.sh config` prints ONE JSON line describing the gate's **effective
configuration** and whether the gate that actually runs still matches its **versioned source**.

It exists because those two copies drifted apart once already — the versioned script and the installed
runtime at `~/.claude/skills/codex-gate/codex-gate.sh` ended up with a different model, a different fast
default, and a different sha256. Nobody noticed, so a fix committed to the repo would never have reached
the running gate. This subcommand makes that condition observable.

- **Read-only, always.** ZERO Codex calls, **no run dir**, no ledger, no repo mutation — it reads three
  files and runs `git rev-parse`. Exit **0** on success. Safe to run while another gate is mid-review.
- **Fails closed** like the rest of the script: an unexpected argument ⇒ `exit 2` (the arg-validation
  convention); anything that would make the report a guess ⇒ `die_infra` ⇒ an `INFRA_ERROR` status line.

**Status line** (`outcome ∈ CONFIG | INFRA_ERROR`):

| field | meaning |
| --- | --- |
| `defaults` | the **literal** fallback values baked into the running script (`model`, `effort`, `fast`) |
| `effective` | the values actually in force after env overrides. `fast` is normalized to its **real trigger** — `run_codex` arms fast mode on an exact `"1"` and nothing else, so `CODEX_GATE_FAST=2` reports `fast:false`; `fastRaw` keeps the raw value visible |
| `origin` | per dial: `"default"`, or the **name of the env var** that overrode it |
| `running` | `{path, digest}` of the script that produced the report — so "the digest of the running script" is unambiguous even when it is neither endpoint |
| `runtimePath` / `runtimeDigest` / `runtimeKind` / `runtimeDefaults` | the gate that actually runs: path, sha256, `file`\|`symlink`\|`other`\|`missing`, and the dials that copy **declares** |
| `sourcePath` / `sourceDigest` / `sourceKind` / `sourceDefaults` | the same four for the versioned copy |
| `sourceDiscovery` | how the source was resolved — or, when it wasn't, why not |
| `digestParity` | sha256 **byte identity** of the two endpoints |
| `effectiveParity` | the dials **in force** vs the dials the versioned source **declares** — reported separately because byte-identical files still behave differently under env overrides |
| `parity` | the roll-up: `MATCH` only when **both** checks affirmatively matched; a known difference ⇒ `MISMATCH`; anything undetermined ⇒ `UNAVAILABLE` |

- **`parity` never guesses.** A source copy that cannot be located or read reports **`UNAVAILABLE`**, never
  a silent `MATCH`. A `missing` or `symlink` endpoint is reported as such via `*Kind` rather than assumed —
  the owner-decided authoritative runtime `~/.claude/skills/codex-gate/codex-gate.sh` is a real directory
  and a real file today, but the report **detects** that rather than trusting it.
- **Endpoint knobs** (both exist so tests use temp fixtures instead of a machine's real `~/.claude/skills`,
  and so an operator can compare any two copies):
  - `CODEX_GATE_RUNTIME` — the gate that actually runs. Default: `$HOME/.claude/skills/codex-gate/codex-gate.sh`.
  - `CODEX_GATE_SOURCE` — the versioned copy. Default: auto-discovered, first match wins — (1) the running
    script when it is itself checked out in a git work tree, (2) `<cwd repo top>/plugin/skills/codex-gate/codex-gate.sh`,
    (3) otherwise none ⇒ `UNAVAILABLE` with the reason stated in `sourceDiscovery`.
- **`defaults` are parsed back out of the file, not hardcoded** (`parse_dial`, a column-1 fixed-string match
  on `VAR="${VAR<op>literal}"`, so no value can be read as a regex metacharacter). Two guards keep that
  honest: the parsed expansion form must still match the `CODEX_GATE_*_FROM_ENV` origin capture pinned
  directly above the dial block, and — where no override is in play — the parsed literal must equal the live
  value. Either disagreement ⇒ `INFRA_ERROR`, because every parity claim would inherit the parser's error.

Status: **Config contracts GREEN** — exercised by `codex-gate.test.sh` (all three dials + both digests +
a parity state; an env override moving `effective` off `defaults` with `origin` naming the variable;
`CODEX_GATE_FAST=2` reporting DISABLED with `=1` as the contrast control; a divergent fixture pair reporting
MISMATCH and naming both distinct digests plus each side's declared dials; an unlocatable source reporting
UNAVAILABLE rather than MATCH; missing and symlinked endpoints reported honestly; and the read-only
invariants — zero Codex calls, no run dir, an unchanged repo, exit 0, and exit 2 on a bogus argument).
