---
name: codex-gate
description: Automated, repo-agnostic Codex gate (the hands-free "third pair of eyes") for REVIEW and INVESTIGATION. Use to review a plan / PDR-ADR bundle / implementation phase / pre-PR branch and auto-loop fixes until it converges; to ground an architecture or feature decision before asking the user; OR to INVESTIGATE — root-cause a bug, narrow a flaky / orphaned / regression / "works-on-my-machine" symptom, or decide between competing hypotheses — under an explicit safety contract (read-only, fails closed on forbidden probes, proposes a fix but never applies one). Modes — plan <file> | bundle <dir> | phase-start <id> | phase-review <id> | question <file> | investigate <brief> | prepr [base] | prepr-delta [base]. Replaces manual copy-paste between Claude and the Codex app.
allowed-tools: Bash, Read, Edit, Write, Grep, Glob
---

# codex-gate — drive Codex as an automated review gate

> **`<skill-dir>` in the commands below** = the directory containing THIS SKILL.md. Installed as a
> plugin that is the plugin's `skills/codex-gate/` dir; installed as a personal skill it is
> `~/.claude/skills/codex-gate`.

A user-global, local-only gate. The wrapper `<skill-dir>/codex-gate.sh` runs ONE
Codex review (config-isolated, `--sandbox read-only`) and prints a one-line JSON **status**:
`{outcome, threadId, round, verdictPath, runDir, blockers, agentFixableBlockers, decisionBlockers, summary}`
(plus an additive `coverage` object for `prepr`/`prepr-delta`) where
`outcome ∈ APPROVE | BLOCK | INFRA_ERROR | OVERFLOW`. YOU are the loop driver: read the status + the
per-round verdict file, fix `agent_fixable` blockers, re-review via resume, and converge.

The **`investigate`** mode is a **sibling** workflow that reuses this exact machinery for a different
job — root-causing a bug, not judging a change — and emits its own status. It does NOT review or
auto-fix; see **Investigation mode** below.

Contract + Phase-0 pins: `<skill-dir>/README.md`. The contract source of truth is README.md (sibling of this file).

## When the user invokes `/codex-gate <mode> [args]`
Run the matching mode and drive the loop below. Modes:
- `plan <file>` — review a plan doc before `ExitPlanMode`. Code tier when run inside a git repo (so
  Codex can cross-check the plan against repo canon via read-only shell); doc tier when not in a repo.
- `bundle <dir>` — review a PDR/ADR/execution-plan bundle (code tier; Codex reads repo canon).
- `phase-start <id>` — snapshot the working tree BEFORE an implementation phase. Run this in the
  binding (before dispatching the implementer); it prints `RUNDIR=` / `PHASE_HEAD=` and writes nothing reviewable.
- `phase-review <id>` — review just that phase's changes after the full Claude review bundle.
- `question <file>` — **ground a DECISION** (architecture/feature) through Codex BEFORE you put it to
  the user via AskUserQuestion. Not a review gate — it emits an advisory `GROUNDED` status, not APPROVE/BLOCK.
  Code tier when run inside a git repo (Codex grounds in real code/canon); doc tier when not in a repo.
- `investigate <brief>` — **root-cause a bug** through Codex (a SIBLING of the review gate, NOT a review).
  Drives Codex as an independent read-only investigator bound by a **safety contract** in the brief; emits a
  root-cause status, never APPROVE/BLOCK, never auto-fixes. See **Investigation mode** below.
- `prepr [base] [--multi]` — whole-branch review before `/commit-push-pr`. `--multi` opts into
  **multi-LENS** review (see below) — the same diff judged through several specialized reviewer lenses.
- `prepr-delta [base] [--multi]` — **since-reviewed delta** of `prepr`: review ONLY files that are unreviewed
  OR changed-since-reviewed (their current `git hash-object` is not an approved-reviewed sha in the
  review ledger). Files whose hash still matches a prior approval are listed (path + sha + verdict
  ref) in an explicit `ALREADY REVIEWED & UNCHANGED` section (proof, not silent omission). If every
  branch file is already reviewed+unchanged, it APPROVEs without calling Codex. Use it when a `prepr`
  OVERFLOWed (huge diff) but most of the surface was already approved in earlier phases, or to re-PR
  after a small follow-up without re-reviewing the whole branch. Shares the budget guard + lean packet
  + OVERFLOW path with `prepr`; same `[base]` default (merge-base chain).

## The loop (review modes: plan / bundle / phase-review / prepr / prepr-delta)
1. **Round 1**: `bash <skill-dir>/codex-gate.sh <mode> <arg> 1` → capture the status JSON.
   (Run from the repo root for code-tier modes so Codex can inspect the repo read-only.)
2. Branch on `outcome`:
   - **APPROVE** → report Codex approved (quote `summary`); proceed (e.g. next phase / ExitPlanMode / `/commit-push-pr`).
   - **INFRA_ERROR** → **STOP and surface to the user.** Read `runDir/round-<N>.stderr` for the reason
     (auth/quota/schema). Do one bounded retry only if it's clearly transient. Never treat as approve; never advance the phase.
     If auth-related, tell the user: `CODEX_HOME=~/.claude/codex-gate/home <codex> login`.
   - **OVERFLOW** → **STOP and surface to the user** with the `summary` message + the `runDir`. The diff is
     too large for one review (predicted pre-flight by the packet budget, or observed at runtime via Codex's
     context-window `turn.failed`), OR a **coverage gap** (`prepr`/`prepr-delta` left a branch-diff file
     neither reviewed-now, prior-hash-matched, nor scratch-excluded — approval is impossible until it's
     reviewed; the `coverage.unreviewed` count is on the status), OR (sharded `prepr`/`prepr-delta`) a
     **shard that stayed inconclusive** — one shard's own packet was still over budget or it errored/overflowed,
     so full coverage can't be certified (the `shards[]` summary on the status names it). Do NOT approve, do NOT
     advance the phase. For a too-large diff, `prepr`/`prepr-delta` **auto-shard by path** (Tier 3 — default
     `CODEX_GATE_SHARD=auto`); if the sharded run still OVERFLOWs because a single shard is itself too big,
     `prepr-delta` (Tier 2 — a delta over only unreviewed/changed-since-reviewed files) narrows the surface —
     note that to the user. (You can also bump `CODEX_GATE_PACKET_BUDGET` if the budget is the only constraint
     and the diff genuinely fits the model, or set `CODEX_GATE_SHARD=off` to force the plain Tier-1 OVERFLOW
     with no sharding.)
   - **BLOCK** → read the verdict file (`jq . <verdictPath>`). Then:
     - If **any** blocker has `class == "decision"` → **STOP and surface those decision blockers to the user.**
       Do NOT auto-rewrite a plan/design to satisfy Codex. Let the user decide; resume only on their say-so.
     - If **all** blockers are `class == "agent_fixable"` → fix each one (use `/superpowers:systematic-debugging` for
       anything non-trivial; **never stage/commit** — just edit the working tree), then go to step 3.
3. **Re-review (resume)**: `bash <skill-dir>/codex-gate.sh <mode> <arg> <round+1> <threadId>` (pass the `threadId`
   from the previous status so Codex keeps context). Capture the new status; go back to step 2.
   - **Multi-lens (`--multi`) re-review is a FRESH re-run, not a resume.** A fan-out run has no single
     thread to resume — its status carries `threadId:""` (each lens ran its own thread; per-lens resume
     is deferred). So after fixing the `agent_fixable` blockers, re-review by re-running the SAME command
     **fresh** with the flag — `bash <skill-dir>/codex-gate.sh prepr <base> --multi` (or `prepr-delta … --multi`) —
     do NOT pass a `<threadId>`. It re-fans-out all applicable lenses over the fixed diff. On a multi-lens
     **BLOCK**, the aggregate `verdictPath` holds the **de-duped union** of blockers; the per-lens detail
     is in `runDir/lens-<lens>-verdict.json` (one per lens — read these to see which dimension raised what).
     The convergence guard (step 4) still applies across fresh rounds (compare the aggregate blocker sets).
4. **Convergence guard (the real limiter — not turn count):**
   - Before each re-review, compare the new blocker set to the previous round's
     (`jq -S '.blockers' <runDir>/round-<N-1>-verdict.json` vs round-N). If the **same** blocker
     (same file+issue) reappears with no meaningful progress → **STOP and surface** ("not converging — needs you").
   - `CODEX_GATE_MAX_ROUNDS` (default **8**) is a high safety backstop; on hitting it, STOP and surface.
   - Plan/PDR discussion loops are not low-capped — they stop on convergence / decision / infra / your explicit budget.
5. On any STOP-and-surface, present: the outcome, the blocking findings (file:line + issue + suggestion),
   and the `runDir` (per-round verdicts/logs are kept there for audit). Then wait for the user.

## Grounding a decision before AskUserQuestion (`question <file>`)
A SEPARATE, non-review flow: when you're about to ask the **user** an architecture/feature-level decision,
first ground it through Codex so the question you present is sharper and better-informed. This is NOT a gate
(no APPROVE/BLOCK, no fix-loop) — it returns a single advisory **GROUNDED** status:
`{outcome, threadId, round, verdictPath, runDir, settledByCanon, recommendation, summary}` (`outcome ∈ GROUNDED | INFRA_ERROR`).

**Scope — ONLY use it for decisions that actually warrant it:** data-model, API contract, major approach,
scope, or anything irreversible/hard-to-undo. Do NOT use it for trivial/cosmetic choices or simple clarifying
questions — just ask those directly.

Flow:
1. **Write a decision file** (any `.md`/text path you author) with: a `DECISION:` line (the question),
   a `CONTEXT:` section, and an `OPTIONS:` list where each option has a label + a short description.
2. `bash <skill-dir>/codex-gate.sh question <file>` (run from the repo root so Codex grounds
   in real code/canon at code tier). Capture the status JSON.
3. Branch on `outcome`:
   - **INFRA_ERROR** → STOP and surface (read `runDir/round-1.stderr`); ask the user directly without the grounding.
   - **GROUNDED** → read the grounding file (`jq . <verdictPath>`). It has `optionAssessments[]`
     (`option`/`pros`/`cons`/`risk`), `missingOptions[]` (`option`/`why`), `recommendation` + `rationale`,
     `considerations[]`, and `settledByCanon`/`canonAnswer`.
4. **If `settledByCanon == true`:** the repo's canon/ADR/PDR already decides this. You MAY skip the user
   question and proceed per `canonAnswer` — but **surface it** ("Codex notes this is already settled by
   `<canonAnswer source>`, proceeding accordingly"). The user can still override.
5. **Otherwise present an AskUserQuestion that folds the grounding in VISIBLY + ATTRIBUTED** (the USER still decides):
   - Enrich **each option's description** with Codex's pros/cons/risk for that option.
   - Add any `missingOptions[]` as **new options** (label them so the user sees Codex surfaced them).
   - Put `recommendation` + `rationale` in the question text as **"Codex's take: …"** (clearly attributed —
     it's a second opinion, not a mandate). Surface `considerations[]` too.
   - Never present Codex's lean as your own or as decided; the user makes the call.

Example:
```
cat > /tmp/decision.md <<'DEC'
DECISION: How should we persist workflow-run events?
CONTEXT: High write volume; reads are mostly recent-first.
OPTIONS:
- Option A: a dedicated append-only events table
- Option B: reuse the existing jobs table with a type column
DEC
bash <skill-dir>/codex-gate.sh question /tmp/decision.md   # → GROUNDED status
# read verdictPath, fold pros/cons/risk + recommendation into AskUserQuestion, then ask the user.
```

## Investigation mode (`investigate <brief-file>`) — a SIBLING workflow, not a review
A SEPARATE, non-review flow: drive Codex as an independent **root-cause investigator** on a bug/failure.
It answers **"what is the proven root cause, what evidence proves it, and what is the smallest safe
fix?"** — NOT "is this change acceptable?". Use it to narrow a bug, root-cause a failure, diagnose a
flaky / orphaned / regression / "works-on-my-machine" symptom, or decide between competing hypotheses —
especially when the diagnosis needs to read the **running stack** (Docker, logs, reports) and you want a
rigorous second investigator that **fails closed instead of guessing**.

It reuses ALL the review machinery (config-isolated `CODEX_HOME`, `--sandbox read-only`, code tier with
read-only shell, `exec resume` thread loop, fast mode, run dirs, packet budget/OVERFLOW, schema-validated
output) but is mentally a **sibling, not "the review gate for bugs"**. It emits its own status:
`{outcome, threadId, round, verdictPath, runDir, confidence, nextSafeProbe, summary}` where
`outcome ∈ ROOT_CAUSE_FOUND | NEEDS_MORE_EVIDENCE | UNSAFE_OR_BLOCKED | INFRA_ERROR | OVERFLOW` (the first
three come from Codex's report; the wrapper adds INFRA_ERROR/OVERFLOW). The full report —
`rootCause`, `evidence[]`, `hypothesesTested[]`, `commandsRun[]`, `forbiddenActionsAvoided[]`, `minimalFix`,
`confidence` — is in the `verdictPath` file. **It proposes a fix; it never applies one** — any code change
then goes through the normal `plan` / `phase-review` / `prepr` gates.

### Write the brief (`<brief-file>`)
A text/markdown file you author. Cover:
- **TASK** — the one bug/failure to root-cause (be specific about the symptom).
- **ENVIRONMENT** — where it runs (stack, containers, branch/worktree, key files/paths).
- **SYMPTOM** — exactly what's observed (errors, timing, the failure signature on disk/in logs).
- **ALREADY ESTABLISHED** — facts you've verified, so Codex doesn't redo them — but invite it to *challenge* any it disagrees with.
- **HYPOTHESES** — the live theories to decide between, plus a clean discriminator if you have one.
- **⚠️ SAFETY (do not omit)** — the probe contract. List **ALLOWED PROBES** (e.g. read-only repo/log
  inspection; free, side-effect-free code tests; read-only `docker inspect`/`logs`) and **FORBIDDEN PROBES**
  (e.g. never trigger a live/paid run, never write prod, nothing destructive or state-mutating). **If you
  omit this, the investigator fails SAFE — it treats every side-effectful probe as forbidden.**

> **Why SAFETY is the crux:** `--sandbox read-only` only protects the repo **filesystem**. `docker exec`,
> HTTP/`curl`, running tests/evals, or triggering jobs can have real, irreversible side effects (spend
> money, write a datastore) even under a read-only FS sandbox. The contract — enforced by the investigator
> persona AND by **you, the driver** — is what actually gates those. Both must honor it.

### The loop (start → probe → report)
1. **Start (round 1):** `bash <skill-dir>/codex-gate.sh investigate <brief> 1` → capture the status.
2. Branch on `outcome`:
   - **ROOT_CAUSE_FOUND** → STOP. Read the report (`jq . <verdictPath>`): `rootCause`, the proving
     `evidence`, `hypothesesTested`, `minimalFix`, `confidence`. Surface it to the user. **Do NOT implement
     the fix here** — route `minimalFix` through `plan`/`phase-review`/`prepr`.
   - **NEEDS_MORE_EVIDENCE** → read `nextSafeProbe`. **Before running it, check it against the brief's
     ALLOWED/FORBIDDEN lists yourself — you are bound by the same contract.** If it's safe, run it (your own
     Bash), append its output to `<runDir>/evidence.md`, then **resume**:
     `bash <skill-dir>/codex-gate.sh investigate <brief> <round+1> <threadId>`. If the probe is NOT safe, do not run it
     — surface to the user.
   - **UNSAFE_OR_BLOCKED** → STOP and surface: the only way forward needs a forbidden/risky probe or a human
     decision. **Never relax the contract to "make progress".**
   - **INFRA_ERROR / OVERFLOW** → STOP and surface (read `runDir/round-<N>.stderr`), same as the review loop.
3. **Convergence guard:** if `needs_more_evidence` recurs with no new SAFE evidence obtainable, or the same
   `nextSafeProbe` repeats with no progress → STOP and surface ("not converging — needs you").
   `CODEX_GATE_MAX_ROUNDS` (default 8) is the backstop.

The investigator is read-only and contract-bound; **you (the driver) run the safe probes** and feed results
back via `<runDir>/evidence.md`. Never run a forbidden probe on Codex's behalf.

Example (a worktree dev-stack bug; paid live runs forbidden):
```
cat > /tmp/inv-orphaned-runs.md <<'BRIEF'
TASK: every Cloudy-Evals suite run is killed ~8–19s after it starts ("the runner is gone").
ENVIRONMENT: gravity worktree .../cloudy-eval-suite (branch cloudy/eval-suite); dev stack in Docker —
  api-platform (:9800) runs the API under `nodemon -L`, watching ./projects/api + ./projects/shared.
SYMPTOM: the report freezes at status:"running"; nodemon logs "restarting due to changes" ~8–19s after each run.
ALREADY ESTABLISHED: container not restarting/OOM; nodemon restarts the inner node; writes under tmp/ do NOT
  trigger it; no persistent watched file changed in the window. (Challenge any you disagree with.)
HYPOTHESES: (a) a transient watched js/json/md file created+deleted mid-run; (b) `-L` legacy-poll phantom
  restarts under load. Discriminator: reproduce a Layer A run while busy-polling `find <watched dirs> -newer <marker>`.
⚠️ SAFETY:
  ALLOWED PROBES: read-only repo inspection; Layer A code tests (free, no AI, no DB); read-only
    `docker inspect`/`docker logs`/`ps`; reading existing report files.
  FORBIDDEN PROBES: NEVER trigger a Layer B (live AI) run — it spends real money and writes the prod DB.
BRIEF
bash <skill-dir>/codex-gate.sh investigate /tmp/inv-orphaned-runs.md 1
# read status → if NEEDS_MORE_EVIDENCE, run the SAFE nextSafeProbe, append to <runDir>/evidence.md, resume.
```

## Binding into a feature workflow (full auto-loop)
```
draft plan ─▶ /codex-gate plan <planfile> ─▶ (loop) APPROVE ─▶ ExitPlanMode (user approves)
write PDR/ADR ─▶ /codex-gate bundle <bundledir> ─▶ (loop) APPROVE ─▶ start implementation
per phase:
   /codex-gate phase-start <id>          # BEFORE the implementer subagent (prints RUNDIR=)
   implement ─▶ Claude spec ✅ ─▶ Claude code-quality ✅
   write <RUNDIR>/context.md             # phase intent / acceptance / review context (see below)
   /codex-gate phase-review <id>         # (loop) APPROVE ─▶ next phase
before PR: /codex-gate prepr ─▶ APPROVE ─▶ /commit-push-pr
            └─ (if prepr OVERFLOWs / most surface already approved) ─▶ /codex-gate prepr-delta
```
For `/superpowers:subagent-driven-development`: call `phase-start <id>` before dispatching the implementer, and
`phase-review <id>` after the implementer + spec-reviewer ✅ + code-quality-reviewer ✅ pass.

**High-stakes work → add `--multi` at the `prepr` step.** For a **high-impact** change (security/auth/billing,
data migrations, a large or risk-bearing diff), run the pre-PR **`prepr` / `prepr-delta`** step with
**`--multi`** (multi-LENS review — architecture · security · tests · UX, aggregated fail-closed; see the
subsection below) instead of the single-lens review. **`--multi` is supported on `prepr`/`prepr-delta`
ONLY** — NOT on `bundle`/`plan` (those stay single-lens; a `bundle --multi` would misparse its second
positional as the round). So the multi-lens pass on a high-impact feature happens at `prepr`, not at the
plan-bundle gate. It is opt-in and costs N lens reviews, so reserve it for changes where one reviewer lens
could miss a defect — not every phase. Its BLOCK fix-loop re-runs fresh (step 3 above); everything else in
this flow is unchanged.

### Since-reviewed delta + the review ledger (Tier 2)
Every APPROVE'd `phase-review` / `prepr` / `prepr-delta` appends ONE line to a per-branch **review
ledger** — `~/.claude/codex-gate/runs/<repoSlug>-<rootHash>/<worktreeKey>/ledger.jsonl` (under runs/,
NEVER the repo; shared across all phases/sessions of that branch). Each line records the reviewed paths
with their `git hash-object` sha at approval time:
`{mode, ref, reviewedPaths:[{path, sha}], verdictPath, threadId, summary}`. (BLOCK / INFRA_ERROR /
OVERFLOW never write — only an *approved* surface is "reviewed". plan / bundle / question never ledger.)

`prepr-delta` consults the ledger: a branch-diff file is **skipped** iff its CURRENT hash matches an
approved-reviewed sha for that path (reviewed & unchanged → listed with proof in the `ALREADY REVIEWED &
UNCHANGED` packet section); otherwise it is reviewed (unreviewed OR changed-since-reviewed). A changed
doc/file re-enters the candidate set automatically — no special-casing. If the delta is empty (whole
branch reviewed+unchanged), it APPROVEs without calling Codex.

**Coverage accounting + fail-closed.** `prepr` / `prepr-delta` add a `coverage` object to the status:
`{reviewedNow, priorHashMatch, excludedPolicy, unreviewed}` (additive — existing consumers unaffected).
Every branch-diff file is exactly one of those four. `unreviewed` should be 0 by construction; if it is
`> 0` the run **cannot APPROVE** — it downgrades to `OVERFLOW` with a `coverage gap: N file(s)
unaccounted` summary (approval is impossible while required surface is unreviewed).

### Sharding an over-budget `prepr`/`prepr-delta` (Tier 3)
When an assembled `prepr` / `prepr-delta` packet exceeds `CODEX_GATE_PACKET_BUDGET` **and**
`CODEX_GATE_SHARD=auto` (the default), the gate **shards by path** instead of emitting OVERFLOW —
applies to `prepr`/`prepr-delta` ONLY (`phase-review`/`plan`/`bundle`/`question` keep the Tier-1 OVERFLOW):
- **Complete, disjoint partition.** Every reviewed-now file is assigned to exactly ONE shard — the FIRST
  matching group, in order: **`docs`** (`docs/**`, `**/*.md`) → **`tests`** (`**/test*`, `**/*test*`,
  `**/*.test.*`, `**/*_test.*`, `**/__tests__/**`) → **`config`** (`.docker/**`, `Dockerfile*`, `*.yml/.yaml`,
  `*.toml/.ini/.cfg`, lockfiles) → **`other`** (catch-all). The group globs are a small constant
  (override via `CODEX_GATE_SHARD_GROUPS`). Union of shards == the full reviewed-now set; shards are disjoint.
- **Per-shard review in its OWN fresh thread.** Each non-empty shard gets a lean packet with the scoped diff
  for ONLY its files (hunks never dropped), reviewed in a brand-new thread (no resume). Verdicts persist at
  `<runDir>/shard-<group>-verdict.json` (+ a `shard-coverage-map.tsv` of path→group). If a single shard's own
  packet is STILL over budget, that shard is recorded **inconclusive** (`OVERFLOW`) — never silently dropped
  (recursive sub-splitting is out of scope; an inconclusive shard ⇒ the aggregate fails closed).
- **Deterministic aggregate (NOT an LLM pass — fail-closed).** The gate reads every shard verdict and:
  **BLOCK** if any shard blocked (it **unions all shards' `blockers[]` + `nonBlocking[]`** into
  `<runDir>/round-1-verdict.json` and emits BLOCK with the combined counts); else **OVERFLOW** if any shard is
  inconclusive/errored (`shard <g> inconclusive — cannot certify full coverage` — it NEVER approves over an
  unreviewed shard); else **APPROVE** (`sharded review: N shards all approved (M files, full coverage)`). A
  deterministic union is used precisely so a gate can never drop a blocker nor approve over an unreviewed shard.
- **Status.** The sharded run emits ONE status line (`APPROVE`/`BLOCK`/`OVERFLOW`) with the usual fields plus
  the additive `coverage` object **and** a `shards` summary array `[{group, files, outcome, verdictPath}]`.
  Existing consumers (which read `outcome`/`blockers`) are unaffected; `shards` is additive and only present on
  a sharded run. Set `CODEX_GATE_SHARD=off` to disable sharding and keep the plain Tier-1 OVERFLOW.

### Opt-in multi-LENS review (`prepr`/`prepr-delta` — `--multi` / `CODEX_GATE_FANOUT=1`)
Opt-in (**off by default**). Instead of one reviewer, review the SAME reviewed-now diff through N specialized
reviewer **lenses**, each in its OWN fresh Codex thread with a lens-specific persona
(`reviewer-instructions.{arch,security,tests,frontend}.md`), then aggregate DETERMINISTICALLY (the same
fail-closed union sharding uses). Use it for the **high-stakes DIFF** of a change where one reviewer lens can
miss a defect — the code implementing a security/auth/billing or data-migration feature, a large or
risk-bearing pre-PR diff. (It reviews a `prepr`/`prepr-delta` diff — NOT a `bundle`/`plan` doc; for a
high-impact feature the multi-lens pass is the pre-PR `prepr --multi`.) NOT default-on (cost = N lens reviews).
- **Trigger:** `prepr --multi` / `prepr-delta --multi`, OR env `CODEX_GATE_FANOUT=1`. Fresh-thread only
  (per-lens RESUME is deferred to a future decision — there is no multi-lens fix-loop resume today).
- **Lens set:** always **architecture/contracts + security/data-integrity + tests/verification**;
  **frontend/UX** is added ONLY when the reviewed-now diff touches an FE path (`CODEX_GATE_FE_GLOBS`).
- **Deterministic aggregate (NOT an LLM pass — fail-closed):** any lens **BLOCK** ⇒ BLOCK (the unioned blockers
  are **de-duped across lenses by file+line+issue**, so a finding two lenses raise collapses to one); any lens
  inconclusive/errored ⇒ **OVERFLOW** (never APPROVE over an un-clean lens); else all lenses approve ⇒ APPROVE.
- **Status:** ONE status line with the usual review fields **plus** an additive `lenses:[{lens,outcome,verdictPath}]`
  array (mirrors `shards[]`). A multi-lens run carries **no** `shards[]`; existing single-thread + sharded
  consumers are unaffected (purely additive). `lenses[]` (and `coverage`) are present on the **aggregate**
  BLOCK / OVERFLOW / APPROVE statuses **and** the over-budget OVERFLOW; an **early fail-closed `INFRA_ERROR`**
  (malformed knob, `MAX_LENSES` exceeded, or a missing persona — raised *before* lens jobs run, via
  `die_infra`) uses the base status shape and does **not** include `lenses[]`.
- **Non-composable with Tier-3 sharding:** when multi-lens is active the sharding branch is **bypassed** — every
  lens reviews the FULL diff (multi-lens is NOT a context-overflow mitigation). If any lens packet exceeds
  `CODEX_GATE_PACKET_BUDGET` the run fails closed with **OVERFLOW** ("narrow via `prepr-delta --multi`, or drop
  `--multi` to use sharding") — it never shards.
- **Fail-closed everywhere (no codex calls until every gate passes):** the applicable lens set exceeding
  `CODEX_GATE_FANOUT_MAX_LENSES` (default **4**, a HARD ceiling) ⇒ INFRA_ERROR with ZERO codex calls (never
  truncates a lens); a malformed `CODEX_GATE_PACKET_BUDGET` / `CODEX_GATE_FANOUT_MAX_LENSES` ⇒ INFRA_ERROR; a
  missing lens persona ⇒ fail closed; a coverage gap (`coverage.unreviewed > 0`) ⇒ OVERFLOW **even if all lenses
  approved**. A lens APPROVE is a dimensional (whole-diff) certification, NOT a per-file-surface approval, so a
  `--multi` APPROVE does **not** write per-file ledger rows — a later `prepr-delta` will still review those files.

### Write `<RUNDIR>/context.md` before `phase-review` (gives Codex the phase intent)
`phase-review` packets only the diff + touched-file contents, so on its own Codex cannot judge whether
the phase did the *intended* work. Before calling `phase-review`, write a short `<RUNDIR>/context.md`
(the `RUNDIR=` line is printed by `phase-start`) and the wrapper folds it into the packet under a
`PHASE INTENT / ACCEPTANCE / REVIEW CONTEXT` section. Include:
- the phase **goal** (what this phase was supposed to accomplish),
- its **acceptance criteria**,
- a 1–3 line **implementer report summary** (what the implementer changed),
- explicit **confirmation that Claude's spec-review and code-quality-review passed**,
- relevant **repo continuity** — if the repo keeps `.claude/context/handoff.md`, `decisions.md`,
  `blockers.md` (or similar), read them and fold the bits that bear on this phase into context.md.
  `.claude/context/` is excluded from the diff (scratch), so context.md is how that continuity reaches the reviewer.

Example:
```
RUNDIR=$(bash <skill-dir>/codex-gate.sh phase-start P2 | sed -n 's/^RUNDIR=//p')
cat > "$RUNDIR/context.md" <<'CTX'
GOAL: <what phase P2 implements>
ACCEPTANCE: <criteria the change must satisfy>
IMPLEMENTER REPORT: <1–3 line summary of the change>
CLAUDE REVIEWS: spec-review PASSED; code-quality-review PASSED.
CTX
bash <skill-dir>/codex-gate.sh phase-review P2
```
(Omitting `context.md` is harmless — the wrapper simply skips the section.)

## Env knobs (optional)
`CODEX_GATE_MODEL`, `CODEX_GATE_EFFORT` (defaults: `gpt-5.6-sol`/`ultra`; both remain env-overridable),
`CODEX_GATE_FAST` (**default 1 = ON**; Codex "fast mode" — same model, ~1.5× faster at **~2.5× credit cost**;
set `0` to conserve credits — it does NOT change model/effort, fast≠dumb), `CODEX_GATE_MAX_ROUNDS` (default 8),
`CODEX_GATE_EXCLUDES` (extra scratch globs; `.docker/` is NOT excluded by default), `CODEX_GATE_SESSION`
(namespacing).
**Context-overflow (Tier 1):** `CODEX_GATE_PACKET_BUDGET` (default **300000** chars — the max assembled-packet
size before Codex is invoked; over budget ⇒ `OVERFLOW` fail-closed, Codex is never run — UNLESS Tier-3 sharding
kicks in for `prepr`/`prepr-delta`) and `CODEX_GATE_INLINE_MAX_LINES` (default **120** — at code tier, a touched
file's full body is inlined only when it has ≤ this many lines; larger files are listed by path + line count and
the reviewer fetches them via read-only shell). Diff **hunks are never dropped** regardless. Defaults need no setup.
**Context-overflow (Tier 3 — sharding, `prepr`/`prepr-delta` only):** `CODEX_GATE_SHARD` (default **auto** —
shard an over-budget packet by path, review each shard in its own fresh thread, aggregate deterministically
fail-closed; set **off** to keep the plain Tier-1 OVERFLOW with no sharding) and `CODEX_GATE_SHARD_GROUPS`
(override the ordered group→globs partition; default `docs`→`tests`→`config`→`other`).
**Multi-LENS fan-out (`prepr`/`prepr-delta` only; opt-in):** `CODEX_GATE_FANOUT` (**default 0 = off**; `1` turns on
multi-lens, same as `--multi`), `CODEX_GATE_FANOUT_MAX_LENSES` (**default 4** — a HARD ceiling; an applicable lens
set that exceeds it FAILS CLOSED with `INFRA_ERROR` and ZERO codex calls, never truncating a lens),
`CODEX_GATE_MAX_PARALLEL_CODEX` (**default 1 = sequential**; `>1` is reserved / not-yet-wired and is treated as 1
today — the deterministic aggregate is order-independent so correctness never depends on it), and
`CODEX_GATE_FE_GLOBS` (FE-path globs that make the frontend lens applicable; default
`*.tsx *.jsx *.ts *.js *.mjs *.cjs *.css *.scss *.sass *.less *.vue *.svelte *.html` — deliberately broad, note
that `*.ts`/`*.js` will match TS/JS **backend** files too; narrow/widen it per repo).

## Invariants (do not violate)
- Never stage, commit, push, or otherwise mutate the repo to satisfy the gate — fixes are working-tree edits; shipping is `/commit-push-pr` when the user asks.
- `decision`/design blockers and infra/quota errors **surface to the user** — never silently auto-resolved.
- The verdict is read from the per-round `-o` file by the wrapper; trust the status JSON's `outcome`.
- **Fail closed on inconsistent verdicts.** The wrapper only emits `APPROVE` when `verdict=="approve"`
  AND `blockers[]` is empty. Any blocker present ⇒ `BLOCK` regardless of the `.verdict` field
  (approve-with-blockers is inconsistent — never approve over an outstanding blocker). A
  `request_changes` with zero blockers is degenerate and surfaces as `INFRA_ERROR`.
- **Memory/continuity split.** The driver (you) may READ the repo's continuity/context files to build
  `<RUNDIR>/context.md`, and writes only under the run dir — the gate never writes the repo's memory
  files (updating `handoff.md` etc. is your general practice, not the gate's job). The Codex reviewer is
  read-only (sandbox-enforced): it may read continuity for context but never mutates handoffs/memory.
  `.claude/context/` stays excluded from the diff but is reachable as review context (via context.md + read-only shell).
- **Investigation never auto-fixes.** `investigate` proposes `minimalFix` but never applies it (no
  fix-loop) — surface the root cause + proposed fix, then route any code change through `plan`/`phase-review`/`prepr`.
- **Investigation honors the safety contract and fails closed.** It returns `unsafe_or_blocked` rather than
  run a forbidden/risky probe; absent a contract in the brief it fails SAFE (treats every side-effectful probe
  as forbidden). **You, the driver, are bound by the same contract — never run a forbidden probe on Codex's
  behalf, and never relax the contract to make progress.** Read-only sandbox ≠ side-effect-free.
- **Investigation never writes the review ledger** (it produces no approved surface — like plan/bundle/question).
