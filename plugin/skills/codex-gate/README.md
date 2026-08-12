# codex-gate — Codex as an automated, repo-agnostic review gate

User-global skill that turns OpenAI Codex into a hands-free "third pair of eyes" reviewer Claude
drives itself (review → fix agent_fixable defects → re-review → surface decisions/infra to you).
Local-only: nothing is committed to any repo; all state lives under `~/.claude/codex-gate/`.

The contract source of truth is this README.

**Tests:** run `bash codex-gate.test.sh` and expect `FAIL=0`. **`FAIL=0` is the contract.** No assertion
total is quoted here: a hand-maintained count is stale the moment an assertion lands, nothing verifies it, and
this one went stale three separate times during one initiative — each time costing a review cycle to flag. Run
the suite if you want the number. The per-tier Status lines below list what each tier added, not running totals. No npm packages — the suite is bash + Node stdlib only.

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
| `defaults` | the **literal** fallback values baked into the **reporting** script (`model`, `effort`, `fast`). The other two copies' literals are `runtimeDefaults` / `sourceDefaults` |
| `effective` | the dials in force **at the runtime endpoint**: `runtimeDefaults` with this environment's overrides applied. **Invariant to which copy runs `config`** — see the note below. `null` when the runtime's dials cannot be read at all. `fast` is normalized to its **real trigger** — `run_codex` arms fast mode on an exact `"1"` and nothing else, so `CODEX_GATE_FAST=2` reports `fast:false`; `fastRaw` keeps the raw value visible |
| `origin` | per dial: `"default"`, or the **name of the env var** that overrode it. A fact about the *environment*, so it describes `effective` and `reporter.dials` alike; `"default"` means "no override — that endpoint's own declared literal is what is in force" |
| `reporter` | the process that produced the report: `{path, digest, dials}`, so "the digest of the running script" is unambiguous even when it is neither endpoint. `dials` is `defaults` with the same env overrides applied — **this is what `effective` used to be** |
| `runtimePath` / `runtimeDigest` / `runtimeKind` / `runtimeDefaults` | the gate that actually runs: path, sha256, `file`\|`symlink`\|`other`\|`missing`, and the dials that copy **declares**. `symlink` is reported when **any component** of the path is a symlink, not merely the leaf — the documented personal-skill setup symlinks the *directory*, and a leaf-only `-L` would call that install a plain physical one |
| `runtimeExecutable` | whether the runtime script carries the executable bit — `true`\|`false`, or `null` when there is no runtime file to test. **A diagnostic only: it does not affect `parity` or `completeness`.** Every documented invocation runs the wrapper as `bash codex-gate.sh …`, and `bash <file>` needs only read permission, so a mode-0644 runtime runs fine. Worth noticing (a copy tool that drops the mode is a real thing), not worth failing on |
| `sourcePath` / `sourceDigest` / `sourceKind` / `sourceDefaults` | the same four for the versioned copy. `sourceKind` is a **leaf** classification: the source is only ever read, and a checkout legitimately living behind a symlinked parent is not a hazard — the any-component rule exists because the *runtime* is the copy whose topology an operator is about to act on |
| `sourceDiscovery` | how the source was resolved — or, when it wasn't, why not |
| `syncInventory` | the documented 13-member file inventory (see Manual sync below) — the exact set parity is claimed over |
| `inventoryDrift` | the members that actually **differ between** the two copies: `{file, state}` where state is `differs` \| `absent-from-source` \| `absent-from-runtime` |
| `inventoryMissing` | the members **absent from an endpoint**: `{file, endpoint}` where endpoint is `source` \| `runtime` \| `both`. Distinct from drift: a member missing from *both* copies is not a difference between them, but it is still a hole in each |
| `completeness` | `COMPLETE` when every inventory member is present on both endpoints, `INCOMPLETE` when any is not, `UNAVAILABLE` when an endpoint could not be located |
| `digestParity` | sha256 byte identity across the **whole inventory**, not just the script |
| `effectiveParity` | the **runtime-effective** dials (`effective`) vs the dials the versioned source **declares** — reported separately because byte-identical files still behave differently under env overrides |
| `parity` | the roll-up: `MATCH` only when digest **and** effective matched **and** the pair is complete; a known difference ⇒ `MISMATCH` (it wins — a real divergence is the more actionable answer); agreement over an incomplete pair ⇒ `INCOMPLETE`; anything undetermined ⇒ `UNAVAILABLE` |
| `remediation` | the machine-readable action list — a closed set: `sync-files` \| `clear-env-override` \| `rerun-from-source` \| `resolve-source` \| `resolve-runtime`. Empty **exactly when there is nothing to act on** (see below) |

- **Three copies are in play, and the report keeps them apart.** The **runtime** (the gate that will actually
  run), the **source** (the versioned copy) and the **reporter** (whichever copy you happened to invoke).
  `effective` describes the **runtime**: its declared defaults with this environment's overrides applied. It
  used to describe the *reporter*, which meant the answer to "what will this gate use?" changed with the copy
  you asked — a runtime declaring `gpt-5.6-terra`/`ultra` was reported as `runtimeDefaults: {terra, ultra}`
  alongside `effective: {sol, xhigh}` whenever `config` ran from the source checkout. Useless for reasoning
  about the configured runtime, and most misleading in precisely the drift scenario this mode exists for.
  **Same configured runtime + same environment now yields the same `effective` from either copy**; the
  reporter is reported separately (`reporter.path`, `reporter.digest`, `reporter.dials`) so nothing is lost.
  When the reporter's own dials are not the source's, the report says so as a `CAVEAT` and asks for
  `rerun-from-source` — the one case where a `parity: MATCH` legitimately carries an action, because the
  endpoints can agree perfectly while the report *about* them came from a third copy.
- **The inventory enumeration is validated before any comparison is trusted.** The digest/completeness loop is
  fed by enumerating `syncInventory`; when that enumeration yielded **no rows** the loop body never executed,
  so `drift` and `missing` stayed empty and the roll-up fell straight through to `digestParity: MATCH`,
  `completeness: COMPLETE`, `parity: MATCH` — a drift detector certifying agreement having compared *nothing*.
  The enumeration is now materialized and checked against the exact expected member set (right **count**,
  right **names**, in the declared **order**) before any verdict may depend on it; a mismatch is `INFRA_ERROR`.
  The count is pinned independently of the list (`CODEX_GATE_SYNC_INVENTORY_COUNT`), because checking a
  truncated enumeration against a truncated constant is a tautology — they agree, on nothing. Changing the
  inventory is therefore a deliberate two-place edit in this script, and the suite pins the members as a third.
- **`parity` never guesses.** A source copy that cannot be located or read reports **`UNAVAILABLE`**, never
  a silent `MATCH`. A `missing` or `symlink` endpoint is reported as such via `*Kind` rather than assumed —
  the owner-decided authoritative runtime `~/.claude/skills/codex-gate/codex-gate.sh` is a real directory
  and a real file today, but the report **detects** that rather than trusting it.
- **`MATCH` means "the same, and whole" — not merely "the same bytes".** Drift and completeness are
  different questions, and folding them together answered the wrong one. Two skill directories that both
  lacked `question.schema.json` reported `digestParity: MATCH`, `parity: MATCH` and an **empty**
  `inventoryDrift` — literally true (they do not differ) and useless, because one of them is the gate about
  to be trusted and it is not a whole skill. Absence is recorded in its own right: `completeness` is the
  state, `inventoryMissing` names the member and which endpoint lacks it, and `MATCH` requires `COMPLETE`.
  Such a pair reports **`parity: INCOMPLETE`** — not `MATCH` (it is not usable) and not `MISMATCH` (the two
  copies genuinely do not differ). The `summary` names the reason.
- **The executable bit is *not* a parity term.** An earlier revision made `runtimeExecutable: false` force
  `INCOMPLETE`, on the theory that a skill is loaded by *executing* `codex-gate.sh`. That was **retracted**:
  every documented command here invokes the wrapper as `bash codex-gate.sh …`, `bash <file>` needs read
  permission only, and a mode-0644 copy demonstrably runs `config` to completion. Reporting the bit is
  useful; failing parity on it sent operators to `chmod` a file that was never the problem.
- **The MISMATCH remedy follows the CAUSE.** Files differing on disk and dials differing in the environment
  want *opposite* actions, so the `summary` branches: digest/inventory drift ⇒ sync the files (see
  [Manual sync](#manual-sync--keeping-the-runtime-equal-to-the-source-pinned-contract)); effective-only
  drift ⇒ the summary **names the overriding variable** from `origin` and says to clear or change it, because
  copying files cannot clear an env override; both ⇒ both. (The supported `CODEX_GATE_MODEL=''` hatch used to
  produce "a fix in the source may not be reaching the running gate" over two byte-identical copies.) A runtime
  whose *declared* dials differ from the source's is a **file** difference by construction — different literals
  mean different bytes — so it is folded into the sync clause and named there rather than prescribed as a
  second, independent action for one fault.
- **`remediation` is empty exactly when there is nothing to act on** — `parity: MATCH` **and** the reporter's own
  dials are the ones the source declares. It is **never** empty for `MISMATCH`, `INCOMPLETE` or `UNAVAILABLE`,
  and `config` fails closed (`INFRA_ERROR`) rather than emit an empty list for one of those. `UNAVAILABLE` used
  to emit `[]` — byte for byte the same signal as a clean `MATCH`, so a consumer branching on "empty means all
  good" read *"we could not tell"* as *"everything agrees"*. Undetermined always has a cause worth naming: the
  endpoint that could not be located, read, or parsed as a codex-gate script gets `resolve-source` or
  `resolve-runtime`, and the `summary` says which knob to point where.
- **Endpoint knobs** (both exist so tests use temp fixtures instead of a machine's real `~/.claude/skills`,
  and so an operator can compare any two copies):
  - `CODEX_GATE_RUNTIME` — the gate that actually runs. Default: `$HOME/.claude/skills/codex-gate/codex-gate.sh`.
  - `CODEX_GATE_SOURCE` — the versioned copy. Default: auto-discovered, first match wins — (1) the running
    script **when git tracks it at `plugin/skills/codex-gate/codex-gate.sh`**, (2) `<cwd repo top>/plugin/skills/codex-gate/codex-gate.sh`,
    again only when git tracks it there, (3) otherwise none ⇒ `UNAVAILABLE` with the reason in `sourceDiscovery`.
- **Auto-discovery must *prove* the source; it never falls back to self.** Being inside *some* git work tree
  is not evidence of being the versioned copy. Discovery used to accept a successful `git rev-parse` from the
  running script's directory, so a runtime installed under a dotfiles repo, an unrelated checkout or a scratch
  repo compared itself **with itself** and reported `MATCH`/`COMPLETE` while the real repo had moved on —
  masking exactly the drift this subcommand exists to expose. Both auto-discovery rules now require the file
  to be **git-tracked** (`git ls-files --error-unmatch`) **and** at that canonical repo-relative path. If
  neither can be proven, the source is `UNAVAILABLE`; an explicit `CODEX_GATE_SOURCE` is still honoured as
  given, tracked or not.
- **`defaults` are parsed back out of the file, not hardcoded** (`parse_dial`, a column-1 fixed-string match
  on `VAR="${VAR<op>literal}"`, so no value can be read as a regex metacharacter). Two guards keep that
  honest: the parsed expansion form must still match the `CODEX_GATE_*_FROM_ENV` origin capture pinned
  directly above the dial block, and — where no override is in play — the parsed literal must equal the live
  value. Either disagreement ⇒ `INFRA_ERROR`, because every parity claim would inherit the parser's error.

Status: **Config contracts GREEN** — exercised by `codex-gate.test.sh` (all three dials by their EXACT
effective values plus both digests and a parity state; an env override moving `effective` off `defaults`
with `origin` naming the variable; `CODEX_GATE_FAST=2` reporting DISABLED with `=1` as the contrast control;
a divergent fixture pair reporting MISMATCH and naming both distinct digests plus each side's declared dials;
an unlocatable source reporting UNAVAILABLE rather than MATCH; missing, leaf-symlinked and
directory-symlinked endpoints all reported honestly against a physical-path control; the inventory reported
and pinned at exactly the documented 13 members, with a docs-only divergence reporting MISMATCH and naming
the drifted members while the identical script is *not* named; a member absent from BOTH endpoints reporting
`completeness: INCOMPLETE` and never MATCH, with the member and its endpoint named in both the machine field
and the summary; a one-sided absence staying MISMATCH *and* INCOMPLETE; a byte-identical but non-executable
runtime reporting `runtimeExecutable: false` while parity stays MATCH — with a mode-0644 copy of this very
skill *running* `config` to exit 0 as the proof, and `+x` restored as the control; an untracked runtime under
a git work tree refusing to self-certify (`sourcePath` empty, `UNAVAILABLE`), a tracked-but-off-path copy
likewise, against a real checkout that still auto-discovers to a full MATCH, an explicit `CODEX_GATE_SOURCE`
still honoured, and the cwd-checkout rule intact; the MISMATCH remedy branching by cause across all four
combinations of file drift × env override; four independent ways of reaching a short inventory enumeration —
two that break the enumeration with the constant intact, two that corrupt the constant with the enumeration
intact — each failing closed to `INFRA_ERROR` against a control pair that genuinely IS a MATCH; `effective`
proven **identical** whether `config` is invoked from the source copy or from the runtime copy, with and
without an env override, while `reporter` shows the two really are different processes; and every non-MATCH
parity carrying a non-empty, cause-specific action list; and the read-only invariants — zero Codex calls, no run dir, an
unchanged repo, the runtime path's own mtime and inode untouched under both a review and `config` itself,
exit 0, and exit 2 on a bogus argument. `install` is pinned as an **unknown, non-mutating** mode).

---

## Manual sync — keeping the runtime equal to the source (PINNED contract)

`config` (above) makes source↔runtime drift **observable**. Resolving it is a **manual step**: copy the
documented inventory from the versioned checkout onto the installed skill, then re-run `config` to confirm.

> **Automated sync was removed.** An `install` subcommand used to do this. It accumulated five P1 defects
> across two review rounds — a plugin-root containment bypass, a directory-symlink overwrite, an unusable
> partial install, a non-transactional update that left a partial install behind after a *reported* failure,
> and a `..` dot-segment containment bypass — all of them in the mutating path, none in the detector. The
> detector shipped; the mutator was quarantined into its own initiative. Until that lands, sync by hand.
> `codex-gate.sh` therefore **never writes either endpoint**: `config` is a report, and every other mode is
> a review.

### The sync unit is the whole skill directory

Sync operates on an **explicit, documented file inventory** — not on `codex-gate.sh` alone. A script-only
copy is wrong in two separate ways: it cannot run at all (`main` requires the sibling `verdict.schema.json`
and `reviewer-instructions.md` before dispatching any mode), and it leaves the installed `SKILL.md` /
`README.md` documenting superseded dials while a script-only parity check cheerfully says `MATCH`.

| # | inventory member | why it is in the sync unit |
| --- | --- | --- |
| 1 | `codex-gate.sh` | the gate itself. Its two endpoints are the explicitly-named `CODEX_GATE_SOURCE` / `CODEX_GATE_RUNTIME` paths, whatever they are called, so both knobs keep pointing at a script; every other member is resolved as a sibling |
| 2 | `verdict.schema.json` | required by `main` before ANY mode dispatches |
| 3 | `question.schema.json` | the `question` grounding mode's output schema |
| 4 | `investigate.schema.json` | the `investigate` mode's output schema |
| 5 | `reviewer-instructions.md` | required by `main` before ANY mode dispatches |
| 6–9 | `reviewer-instructions.{arch,frontend,security,tests}.md` | the four multi-lens personas |
| 10 | `question-instructions.md` | the `question` mode's reviewer brief |
| 11 | `investigate-instructions.md` | the `investigate` mode's reviewer brief |
| 12 | `SKILL.md` | the operational contract an agent reads to drive the gate |
| 13 | `README.md` | this contract |

`config` reports the same list as `syncInventory`, so it is machine-readable and cannot silently drift from
what you are told to copy. **Nothing outside the inventory is claimed over** — `codex-gate.test.sh` is
deliberately excluded (the suite is developed against the checkout, not shipped into the runtime), and the
per-file copy below leaves an owner's own notes in the installed directory untouched.

### The sync

Run from the checkout carrying the fix. `$GATE` is that checkout's `plugin/skills/codex-gate`; the
destination is the owner-decided authoritative install:

```bash
GATE=/path/to/the-foreman/plugin/skills/codex-gate
DEST=~/.claude/skills/codex-gate

mkdir -p "$DEST"
for f in codex-gate.sh verdict.schema.json question.schema.json investigate.schema.json \
         reviewer-instructions.md reviewer-instructions.arch.md reviewer-instructions.frontend.md \
         reviewer-instructions.security.md reviewer-instructions.tests.md \
         question-instructions.md investigate-instructions.md SKILL.md README.md; do
  cp "$GATE/$f" "$DEST/$f"
done
chmod +x "$DEST/codex-gate.sh"
```

Why it is written this way:

- **Per-file, not `cp -r`.** The loop names exactly the 13 inventory members, so anything else in the
  installed directory — your own notes, an old scratch file — is neither overwritten nor removed. `cp -r`
  would sweep in `codex-gate.test.sh` and any other checkout-only file.
- **The explicit `chmod +x` is tidiness, not a requirement.** `cp` onto an *existing* destination file keeps
  the destination's mode, so a runtime that lost its executable bit keeps that mode through any number of
  syncs; this line restores it. It does **not** gate anything — the gate is invoked as `bash codex-gate.sh`
  throughout, which needs no `+x`. `config` reports the bit (`runtimeExecutable`) without failing on it.
- **Not atomic, and not pretending to be.** This is a plain sequence of copies: do not run it while a gate
  is mid-review elsewhere. The verification step below is what tells you it landed.

### Verify — this is the step that closes the loop

```bash
bash "$GATE/codex-gate.sh" config | jq '{parity, digestParity, effectiveParity, completeness, runtimeExecutable}'
```

Expect **`parity: MATCH`**, with `digestParity` and `effectiveParity` both `MATCH` and
`completeness: COMPLETE`. (`runtimeExecutable` is informational — `true` is tidy, `false` does not block
anything.) Anything else is the report telling you the sync did not land:

| what you see | what it means |
| --- | --- |
| `MISMATCH` | a member still differs, **or** an env var is overriding a dial — the `summary` says which, and gives the matching remedy (sync the files / clear the named variable / both) |
| `INCOMPLETE` | the copies agree but one of them is not a whole skill — read `inventoryMissing` (which member, which endpoint) |
| `UNAVAILABLE` | an endpoint could not be located, read, or **proven to be the tracked canonical source** — read `sourceDiscovery` and `runtimeKind`; this is *not* a match |

Run both commands **from the checkout carrying the fix**: `CODEX_GATE_SOURCE` auto-discovery resolves to the
running script when git tracks it at `plugin/skills/codex-gate/codex-gate.sh`, so no env var is needed for
the common case, and `CODEX_GATE_RUNTIME` defaults to the real installed gate. Note the consequence of that
rule: running `config` from the **installed** copy instead of the checkout reports
`sourceDiscovery: none…` and `parity: UNAVAILABLE` unless the cwd is a checkout — deliberately, since an
installed copy cannot vouch for itself.

**If your install is the symlink mode**, there is nothing to sync — the two "copies" are one file, and
`config` reports `runtimeKind: symlink`. Do not run the copy loop against a symlinked destination: it would
write **through** the link into the checkout and silently convert a linked install into a copied one. See
the repo-root README's "Pick one install mode".
