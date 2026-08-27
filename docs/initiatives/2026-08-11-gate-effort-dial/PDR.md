# PDR — Wave 1: bound reviewer topology and reduce gate latency

Initiative: `2026-08-11-gate-effort-dial`
Branch: `fix/gate-core` (worktree, off `origin/main` @ `ac0daf0`)
Superseded branch: `fix/gate-effort-dial`; quarantined mutator: `quarantine/gate-install-mutator` @ `fcac17e`
Relates to: [#30](https://github.com/Angel45604/the-foreman/issues/30), [#31](https://github.com/Angel45604/the-foreman/issues/31)
Wave: **1 of 2** — fast relief.

> **Wave 1 is NOT a convergence fix and does not close #30 or #31.** It removes hidden reviewer
> delegation and buys a **1.7x** latency win for the selected configuration.
>
> **Language discipline (audit correction):** `ultra` is the demonstrated cause of the *hidden
> delegation*, and model x effort of the *per-round latency*. It is **not** established as the cause
> of non-convergence — Wave 1 neither tested nor fixed convergence. The 1.71x is a **combined
> model-and-effort** result (`sol@xhigh` vs incumbent `terra@ultra`), not an effort-only win, and
> latency claims must not draw on Group A, which was declared invalid for that purpose.
>
> *(Correction: an earlier draft claimed "1.7–3.3x". The 3.3x endpoint is `terra` `ultra`→`xhigh`,
> which is NOT the selected config. Selected `sol@xhigh` 555s vs incumbent `terra@ultra` 949s = 1.71x.
> Caught by the Wave-1 implementation audit.)* Blocker volume was 11–15 in every arm of the sweep
> regardless of model or effort, so the loop's non-termination is untouched by this wave. The
> convergence work — packet manifests, plan/code separation, materiality rules, enforced round caps,
> blocker reconciliation — is Wave 2.

## Altitude notice

This bundle is written at **contract altitude**: files, defaults, invariants, and test intent.
It deliberately does **not** contain literal implementation. That is a direct application of
issue #31's Finding A — a code-complete plan is an unreviewable artifact whose every fix is
itself new unreviewed code, which is one of the reasons the gate stopped converging. Literal
edits belong to the TDD phases below, not to this document.

## Problem

`codex-gate` stopped converging. It is not finding *wrong* things — it is finding an unbounded
supply of *real but ever-remoter* things, at 5× the latency, so the fold-and-re-gate loop no
longer terminates. In the owner's words it is "slowing things quite a lot rather than helping."

## Evidence (measured, not asserted)

Two independent investigations — this one (1,002 gate verdicts + 1,873 Codex session rollouts)
and a separate Codex investigation — agree. Cross-check: both independently found 102 pre-switch
bundle verdicts with 28 APPROVE, and 47 post-switch bundle verdicts with 0 APPROVE.

**Root cause of the hidden delegation — the `ultra` effort tier, not the model family** (non-convergence is a separate, untested question):

| reviewer pair | threads | `spawn_agent` calls | approve rate |
|---|---:|---:|---:|
| `gpt-5.5` @ `xhigh` | 639 | **0** | 35.6% |
| `gpt-5.6-sol` @ `high` | 3 | **0** | — |
| `gpt-5.6-sol` @ `ultra` | 1,147 | **988** | 4.7% |
| `gpt-5.6-terra` @ `ultra` | 68 | **72** | 0% |

`sol`@`high` is the decisive natural control: same model family, non-ultra effort, zero delegation.
Codex's own model catalog defines `ultra` as *"Maximum reasoning with automatic task delegation."*
In practice that spawns ~3 sub-reviewers per nominal round (`impl_audit`, `contract_audit`,
`test_audit`), each inheriting `fork_turns=all` — so every round re-copies a growing history into
three more agents. A "single-lens" gate has silently been an ensemble. **Three is a capped floor,
not a ceiling:** the traces show descendants attempting further nested delegation and being stopped
by the global thread limit (`thread limit` x9, `max_concurrent_thread` x2, `spawn fail` x9).

Consequences measured across the same corpus: blockers/round 1 → 13, decision-class blockers/round
0.04 → 1.64, median round wall-clock 154s → 815s, per-chain convergence 77% → 19% → 0%.

**Secondary — repo/runtime drift.** The shipped plugin and the installed runtime disagree:

| | model | effort | fast | sha256 |
|---|---|---|---|---|
| repo `plugin/skills/codex-gate/codex-gate.sh:48,49,55` | `gpt-5.6-sol` | `ultra` | `1` | `d2fbee8c…` |
| live `~/.claude/skills/codex-gate/codex-gate.sh:50,51,57` | `gpt-5.6-terra` | `ultra` | `0` | `7ba68432…` |

This is load-bearing for *relief specifically*: **a correct fix committed to the repo does not reach
the owner's gate at all.** The two test suites have drifted with them — the repo suite asserts
`gpt-5.6-sol` (`codex-gate.test.sh:1055`), the live suite asserts `gpt-5.6-terra` (`:1129`).

## Requirements

- **R1 — Bound the reviewer.** The default reviewer pair must not use an effort tier that performs
  automatic, wrapper-invisible sub-agent delegation. The chosen pair is decided by ADR-1 on frozen-packet
  sweep evidence, not by preference.
- **R2 — Do not trade away material findings unknowingly.** Success is explicitly **not** "fewest
  findings". The selected pair's recall must be *measured and adjudicated against* the incumbent, and
  any material finding it misses must be recorded rather than discovered later.
  **Status: NOT satisfied as preservation.** The selected pair misses two still-valid defects
  (`docs-contract.test.mjs:23`, `diff.mjs:201`) — see ADR-1. The owner accepted the loss knowingly at
  the plan-approval gate, so the requirement is met only in its *disclosure* sense. ADR-1 states the
  same thing; if the two ever read differently, this line and ADR-1's "Recall — R2 is NOT satisfied"
  section are the canon.
- **R3 — One source of truth for the dials.** Repo and installed runtime must not silently disagree
  on model / effort / fast.
- **R4 — Drift must be observable.** An operator (or agent) must be able to ask what the *effective*
  gate configuration is and see whether it matches source.
- **R5 — No silent multiplicative fan-out.** Explicit `--multi` combined with a natively-delegating
  effort tier must not quietly produce lenses × children reviewers.
- **R6 — Regression net.** The dials are exactly the kind of value that rotted here once already;
  they must be pinned by tests that fail loudly when changed.

## Non-goals (Wave 2, tracked in #30/#31)

Trend-based non-convergence guard · enforcing `CODEX_GATE_MAX_ROUNDS` in the wrapper (today it
appears 3× in `SKILL.md` and **0×** in the wrapper) · round-artifact overwrite protection ·
initiative-keyed run directories · scoped `phase-review` · blocker identity/`introducedBy` fields ·
plan-altitude doctrine in the-foreman · legal-exit option set · subtraction pressure.

These are real (Wave 1 does not close #30 or #31). They are amplifiers of a trigger Wave 1 removes,
and bundling them here would produce exactly the large, additive artifact that has been failing to
converge.

## Constraints

- The gate's strength dials are **owner territory**. This plan proposes values from evidence; it does
  not silently lower a governance gate. The change lands only on an explicit owner decision.
- A parallel session is active in the primary clone (`feat/the-cartographer`). All work happens in a
  separate worktree outside that clone; nothing in the primary working tree is touched.
- `.claude/context/*` is excluded from the gate's review surface (`codex-gate.sh:194`, verified).

## Acceptance

- The frozen-packet sweep is recorded on disk with per-arm spawn count, wall-clock, and blocker
  counts by severity and class.
- The selected pair produces **zero** `spawn_agent` calls on the sweep packet. **(met)**
- Every material finding from the `ultra` arms that the selected arm misses is explicitly adjudicated
  and recorded in ADR-1. **(met as disclosure — two misses recorded; not met as preservation)**
- **R3 — amended.** Repo/runtime agreement is delivered by *detection plus a documented manual
  sync*, not by an automated mutator (ADR-7). `config` proves it: `parity: MATCH` +
  `completeness: COMPLETE` after the owner runs the documented command. **`runtimeExecutable` is
  reported for tidiness but is NOT part of acceptance** — the documented invocation is
  `bash codex-gate.sh`, which does not require `+x` (round-4 retraction).
  R3 remains **unmet until the owner runs it** — the branch cannot satisfy it by itself.
- Test suite pins the new defaults and fails on unreviewed change.

## Branch ancestry (stated plainly)

`fix/gate-core` **retains the rejected mutator commits in its ancestry** — the mutator was built in
Phases 5–6 and removed in Phase 7, rather than never existing. The accurate description is:
**removed from the shipping tree; recovery branch pinned at `quarantine/gate-install-mutator` @
`fcac17e`.** The net diff against `origin/main` contains no mutator. No clean-history rebase or squash
has been done; say so if one is wanted before merge.
