# Execution plan — Wave 1: bound the reviewer, close the repo/runtime drift

Contract altitude. Each phase states **files · interface · invariants · test intent · done-condition**.
Literal implementation is produced inside the phase by a fresh implementer under TDD (RED first),
not pre-written here.

Phase set is FROZEN at plan-approval. Merging, splitting or reordering it afterwards is a
`decision-fork`, not a silent adjustment.

---

## Phase 1 — RED: pin the target dials in both test suites

**Files** · `plugin/skills/codex-gate/codex-gate.test.sh` (repo copy is the one under version control).

**Interface** · No production interface changes. **Correction (gate round 1):** in the *versioned*
copy TEST 20 asserts the model+effort pair only on the fast-**ON** path (`codex-gate.test.sh:1055`);
the fast-OFF branch asserts only that the fast flags are absent. (The drifted live copy checks both.)
The fast-OFF assertion therefore has to be *added*, not updated.

**Invariants**
- The default effort must be asserted explicitly, by name.
- A separate assertion must state the *negative* invariant: the default effort is **not** a
  natively-delegating tier. This is the invariant that actually protects convergence, and it must
  fail independently of which non-delegating tier is chosen.

**Test intent**
- TEST 20 updated to the ADR-1 pair on both fast paths.
- **New** fast-OFF assertion: the selected model+effort appear on the fast-OFF argv path too.
- New negative assertion: default argv does not contain `model_reasoning_effort="ultra"`.
- New: `CODEX_GATE_MODEL=""` and `CODEX_GATE_MODEL` *unset* produce distinguishable argv (see Phase 2).
- Existing fast-mode semantics (fast is not a quality knob) remain asserted unchanged.

**Done-condition** · Suite runs and the new/updated assertions **FAIL** against the current
defaults, for the stated reason. A RED that fails for the wrong reason does not count.

---

## Phase 2 — GREEN: change the dials in the versioned copy

**Files** · `plugin/skills/codex-gate/codex-gate.sh` lines `48` (model), `49` (effort), `55` (fast).

**Interface** · Env overrides still win over the defaults. **Correction (gate round 1): the
documented `CODEX_GATE_MODEL=""` escape hatch does not work today and never has.** `:48` uses
`${CODEX_GATE_MODEL:-…}`, whose `:-` treats empty exactly like unset, so `""` resolves to the literal
default; the `[ -n "$CODEX_GATE_MODEL" ]` guard at `:576` is consequently dead code. Phase 2 must
either (a) switch to `${CODEX_GATE_MODEL-…}` so unset and empty are distinguishable and the
documented fall-through works, or (b) delete the false claim from the comment and README. **(a) is
preferred** — the escape hatch is the owner's documented way to bypass a pinned model. Whichever is
chosen, Phase 1 pins both argv behaviours.

**Invariants**
- The owner can still opt back into `ultra` deliberately by env.
- The header comment must record *why* the tier is bounded (auto-delegation), not merely what it is —
  the previous comment's "load-bearing, do not drop" note is exactly what made the tier look
  intentional and protected.

**Test intent** · Phase 1's assertions go GREEN. Full suite otherwise unchanged — any other test that
moves is a regression to investigate, not to update.

**Done-condition** · Phase 1 assertions GREEN; whole suite green; `git diff` touches only the
default lines named by the approved ADR-1/ADR-3 values, their comments, and (if option (a)) the
expansion operator plus its guard.

---

## Phase 3 — Make the effective configuration observable (R4)

**Files** · `plugin/skills/codex-gate/codex-gate.sh`, `README.md`, `SKILL.md`, `codex-gate.test.sh`.

**Interface** · A named read-only subcommand emitting a **machine-readable** report with explicit
fields: `defaults` (file literals), `effective` (post-override, with `fast` normalized to its real
trigger — enabled only when the value is exactly `1`), `origin` (which env var overrode what),
`runtimePath` + `runtimeDigest`, and `sourcePath` + `sourceDigest` when a versioned copy is
discoverable. Parity is reported as **MATCH / MISMATCH / UNAVAILABLE** (UNAVAILABLE when no source
copy can be located — never silently MATCH). Digest parity and *effective* parity are reported
separately, since overrides can make identical files behave differently. No review, no Codex call.

**Invariants**
- Read-only: no Codex invocation, no run directory created, no ledger write, exit 0 on success.
- Reports the *resolved* values after env overrides, not the file's literals — the literals are what
  misled here.
- Must be safe to run while a gate is mid-review.

**Test intent** (fixtures, in `codex-gate.test.sh`)
- Prints all three dials, both digests, and a parity state.
- With an env override set, `effective` differs from `defaults` and `origin` names the variable.
- `CODEX_GATE_FAST=2` reports fast as *disabled* (only `1` enables).
- Divergent fixture pair → MISMATCH naming both digests; no locatable source → UNAVAILABLE.
- **Zero Codex calls and no run directory created** (assert via the existing stub argv log).

**Done-condition** · Subcommand exists; documented in the gate `README.md`, `SKILL.md`, and the root
install README; tests green.

---

## Phase 4 — Refuse silent multiplicative fan-out (R5)

**Files** · `plugin/skills/codex-gate/codex-gate.sh` (resolved multi-lens admission path), `SKILL.md`, `codex-gate.test.sh`.

**Interface** · When multi-lens fan-out is active *and* the resolved effort is a natively-delegating
tier, the run does not proceed silently. **Correction (gate round 1): the check must read the
RESOLVED multi-lens state, after both triggers are evaluated** — `codex-gate.sh:1425` sets
`multilens=1` from either the `--multi` flag **or** `CODEX_GATE_FANOUT=1`. Guarding only the flag
leaves the env path open to lenses x native children.

**Invariants**
- Fails closed, consistent with the wrapper's existing posture: an unbounded review is worse than a
  refused one. Either define one precisely-named owner override or ship none — an unnamed "maybe
  there's an override" is worse than either.
- The check reads the *resolved* effort (Phase 3's resolution), so an env override is caught too.
- Applies only where `--multi` is actually accepted (`prepr` / `prepr-delta`); `bundle`/`plan` are
  single-lens by contract and must be unaffected.

**Test intent**
- `--multi` + delegating effort → refused, naming both the trigger and the tier, **zero Codex calls**.
- `CODEX_GATE_FANOUT=1` + delegating effort → refused identically.
- Either trigger + the new default effort → proceeds exactly as today.
- Neither trigger, any effort → unaffected.

**Done-condition** · Tests green; `SKILL.md` documents the combination and the override.

---

## Phase 5 — Close the repo → runtime drift (R3)

**Files** · `README.md` / the plugin install path, `codex-gate.test.sh`, `docs/initiatives/2026-08-11-gate-effort-dial/`.

**Blocked on** · the owner's ADR-5 answer on installation topology (physical copy vs symlink vs
plugin-managed vs duplicate installs). The plan must not assume `~/.claude/skills/codex-gate` is the
only runtime.

**Interface** · A deliberate, documented synchronization path from the versioned plugin copy to the
installed runtime at `~/.claude/skills/codex-gate/`, plus the parity report from Phase 3 as its
verification step.

**Invariants**
- **Never auto-overwrites the owner's installed skill as a side effect** of anything else. Installing
  is an explicit act; the runtime belongs to the owner.
- The parity report must be able to say MATCH / MISMATCH between installed digest and source digest.
- Wave 1 does not change the owner's runtime without the owner running the sync themselves.

**Test intent** · Given a deliberately divergent fixture pair, parity reports MISMATCH and names both
digests; after sync, MATCH.

**Done-condition** · Path documented and verifiable, **and** the owner has run the sync with a
recorded MATCH from Phase 3's parity report. **Correction (gate round 1):** "recorded as outstanding"
is not an acceptable exit — it would contradict R3 and leave the owner on the old gate while Wave 1
claimed relief. If the owner declines to sync, R3 is formally dropped from this wave's acceptance
and the PDR is amended to say so; it is not quietly carried as a caveat.

---

## Verification (every phase)

- `bash plugin/skills/codex-gate/codex-gate.test.sh` green before any phase is called done.
- Evidence is raw command output read directly — a subagent's success summary is a claim, not proof.
- `codex-gate phase-start` / `phase-review` per phase, driven to convergence.
- No commit unless plan-approval explicitly authorized scoped per-phase LOCAL commits (default: no).
- No push and no PR without a fresh explicit instruction naming the act.

## Rollback

Every phase is a small, self-contained edit on a worktree branch off `origin/main`. Rollback is
`git restore` of the touched paths, or discarding the branch; the installed runtime is untouched
until Phase 5 is run deliberately by the owner.
