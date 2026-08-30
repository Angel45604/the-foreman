# ADR-001: Follow-up B staging

## Status

Accepted, 2026-08-29, by Angel at a structured decision-fork gate.

## Context

ADR-009, recorded at plugin/skills/the-foreman/references/decisions.md:53, lists the eval
harness's described-behavior grading as an accepted trade-off and points at run-evals.mjs for
the upgrade path. run-evals.mjs's own header makes that upgrade conditional: "if
described-vs-actual ever diverges."

Task 6's history, recorded at docs/initiatives/2026-08-28-the-refiner/execution-plan.md:700-757,
is the test of that condition. Task 6 ran six individually authorized paid evaluations, scoring
0.80, 0.82, 0.93, 0.43, 1.0, and 1.0. The seams never failed a criterion in any of the six runs.
The 0.43 run's recorded cause was executor variance, specifically execution roleplay in a
fixture-less probe. Whether that counts as a described-versus-actual divergence is the open
reading, and it is not settled by the record. Angel closed Task 6 by owner override. Codex's preserved
objection is that the latest spec has no stored passing run.

The fork this ADR settles: does the 0.43 run's instability meet the bar run-evals.mjs sets for
triggering the full upgrade path, or does it belong instead to probe design and stay short of
that bar? Follow-up B decides how far to go toward full execution without yet declaring the
condition met.

## Options considered

**A, fixtures-first.** Build fixtures for eval 12, then run. This is undercut by how the harness
reads eval definitions today: evals.json's eval 12 already declares "files": [], and that field
is inert. run-evals.test.mjs's catalog test checks only name, prompt, and expected_output; it
never asserts files. buildProbePrompt builds its prompt from evalDef.prompt alone and never reads
evalDef.files. Fixtures written under this option would sit unread by the current harness.

**B, full execution with deterministic grading.** Let the executor run for real, past the
description-only probe, and grade the outcome deterministically instead of by judge. This is
undercut by render.mjs: writeFile(outPath), writeFile(localPath), and writeFile(mdPath) are plain
overwrites, and render.mjs keeps no invocation history. A deterministic check for "rendered
exactly once" cannot be built from final artifacts alone, because a second render leaves behind
the same three files a first render would.

**C, full execution with a prose judge.** Run the executor for real but keep buildJudgePrompt's
prose judge. This needs the same execution plumbing option B needs, so once that plumbing exists,
option B's deterministic grading dominates it: option C spends the same execution cost for a
weaker grading signal.

**D, staged hybrid.** Stabilize what can be stabilized without a paid run first, then decide
separately whether to spend a paid run at all. As first written, its cancellation rule was
ambiguous: it did not say whether a passing fixture-less probe check in phase one would cancel
phase two outright, or only remove the pressure to run it soon.

**E, oracle-first fixed rubric.** Codex surfaced this option; the initiative had missed it. It
replaces the judge's freehand criterion choice with a fixed rubric of stable criterion IDs and
named evidence sources per criterion. It answers a gap in buildJudgePrompt, which hands the judge
the whole expected_output string and tells it to split that string into clauses fresh on every
run, so criterion identity and count are not stable between runs. parseVerdict is fail closed and
recomputes pass_rate arithmetic after the judge segments, but it does not fix the rubric itself.

**F, split eval 12.** Codex also surfaced this option. It splits eval 12 into two linked cases,
one before approval and one after. It answers the boundary problem already recorded at
execution-plan.md:532-541: a single-turn probe cannot both block at the approval boundary and
perform the approval-triggered work in that same turn.

## Decision

The decision is option D, amended. Codex attached three amendments, and Angel accepted them:

1. Stabilize the oracle and split eval 12 at the hard gate before any paid run.
2. Treat phase two as a narrow eval-12 execution canary, not a general execution framework.
3. Do not cancel phase two merely because the fixture-less probe passes, if the lettered close
   remains the goal.

Options E and F are prerequisites for phase one, not alternatives to option D. Phase one is not
done until both are in place.

## Consequences

**What this buys**

- Phase one fixes the judge's rubric (option E) and removes the single-turn boundary conflict
  (option F) before any spending decision gets made.
- Phase two stays scoped to eval 12 specifically, so a canary result cannot get read as a verdict
  on execution grading in general.
- No phase of this plan authorizes a paid run. That stays behind its own gate, per the hard
  constraint that any paid run needs a separate live-run gate naming the exact call count.

**What this costs**

- Two phases means two gates, not one. Phase one closing does not close the initiative.
- Splitting eval 12 into linked pre-approval and post-approval cases means the six recorded Task
  6 scores (0.80, 0.82, 0.93, 0.43, 1.0, 1.0) stop being a like-for-like comparison against
  whatever eval 12 becomes. The split is a new instrument, not a repeat of the old one.
- Phase one alone cannot demonstrate that described behavior diverges from executed behavior. It
  can only show whether the fixture-less probe instability behind the 0.43 run persists once the
  boundary conflict is fixed.

## What would reverse this

- The split eval 12 cases cannot be built without reintroducing the same single-turn boundary
  conflict option F was meant to remove.
- The fixed rubric in option E cannot produce stable criterion IDs across runs, so option E fails
  on its own terms.
- Once fixture-less probe instability is removed, a later run still shows a described-versus-
  executed divergence, which meets run-evals.mjs's own condition and calls for the full upgrade
  path instead of a canary.
- Codex's preserved objection, that the latest spec has no stored passing run, is still open
  after phase one and blocks the lettered close outright.

## Grounding

The codex-gate question run recorded its verdict at
~/.claude/codex-gate/runs/the-foreman-followups-6cb9f523f685/feat_refiner-followups/s-cee847557b0e/question-decision-followup-b.md/round-1-verdict.json.
The outcome was GROUNDED, and settledByCanon was false. Codex advised. Angel decided.
