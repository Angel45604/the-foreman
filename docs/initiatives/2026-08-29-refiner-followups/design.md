# PDR: refiner follow-ups

## Problem

Two follow-ups were left open when the-refiner shipped and merged to main at a422612.

Follow-up A: `plugin/skills/the-refiner/references/before-after.md` demonstrates the tail rule in its pairs but never states the rule in its header. The file has no numeral demonstration anywhere; no pair's Before or After prose contains a digit outside the heading numbers. The file has no structured example either; no pair contains a markdown heading, a list, or a fenced code block, only inline single-backtick code spans.

Follow-up B: the eval harness cannot close eval 12 on executed behavior, because it grades narration. `buildProbePrompt` builds its prompt from `evalDef.prompt` alone and tells the executor to describe what it would do; it never reads `evalDef.files`. The judge then grades that description against `expected_output`, split into clauses it chooses fresh each run. Nothing in that path executes an action or checks its result.

## What we verified before planning

- Four green baselines in the worktree: `node --test plugin/skills/the-foreman/references/*.test.mjs plugin/skills/the-foreman/evals/*.test.mjs` reports 593 pass, 0 fail; `bash plugin/skills/codex-gate/codex-gate.test.sh` reports PASS=441 FAIL=0; `node --test plugin/skills/the-refiner/references/*.test.mjs` reports 6 pass, 0 fail; `claude plugin validate ./plugin --strict` reports Validation passed.
- No live test asserts the pair count in `before-after.md`. The only count assertion in the repo is a comment inside the prior initiative's frozen record, `docs/initiatives/2026-08-28-the-refiner/execution-plan.md:176`: `grep -c '\*\*Before:\*\*' ... # 8`. It is not wired to any test runner or CI.
- `evals.json` eval 12 declares `"files": []`, and that field is inert. `run-evals.test.mjs`'s catalog test requires only `name`, `prompt`, and `expected_output`; it never asserts `files`.
- `references/render.mjs` writes its three outputs with plain overwrites (`writeFile(outPath)`, `writeFile(localPath)`, `writeFile(mdPath)`) and keeps no invocation history. "Rendered exactly once" cannot be proven from the final artifacts.
- `references/dispatch-log.mjs` is already append-only (`appendFileSync`). `validateEntry` requires a non-empty session, shape, and why, a tier from `TIERS`, a non-empty model, an effort from `EFFORTS`, and an outcome from `OUTCOMES = ok|redo|escalated|failed`. Per-dispatch tier, model, effort, and ordering are provable deterministically today, through this log.

## Scope

### Follow-up A

Three additions to `before-after.md`: state the tail rule in the header, add a demonstration that includes a numeral, and add one structured example containing a markdown heading, a list, and a fenced code block, the three structural forms the file currently has none of.

The blast radius is the pairs file itself plus the test file that pins it. The one count assertion in the repo, the `# 8` comment at `docs/initiatives/2026-08-28-the-refiner/execution-plan.md:176`, is left untouched: it is a frozen record of what was verified on 2026-08-29, it was true then, and rewriting it would falsify history rather than fix anything. It is wired to no test runner, so it breaks nothing. Nothing else in the repo references these pairs by number or content; every other occurrence of "eight" in the repo names the-foreman's eight Gate Board artifact types, unrelated to this file.

### Follow-up B

Phase 1 is three prerequisites, none of which runs a paid eval: stable criterion IDs (Codex's option E, an oracle-first fixed rubric where every criterion names one of four evidence sources: `dispatch-log`, `ledger-diff`, `rendered-twin`, `transcript`), the eval 12 split (Codex's option F, linked pre-approval and post-approval cases), and live fixtures for those cases. A fourth task sweeps the verification claims so none of them rests on an assertion nobody ran.

Phase 2 is a narrow execution canary for eval 12 alone, sitting behind the evidence gate at phase 1's boundary. It is not a general execution framework. Per amendment 3 of ADR-001, a clean phase 1 does not by itself cancel phase 2: if the lettered close remains the goal, phase 2 is still owed. What the evidence gate decides is the canary's scope, which is the residue of criteria no artifact or log can settle.

## Out of scope

- No paid eval run in this plan. Every phase here is code and unit tests, plus `--dry-run`.
- No push, no PR, no version bump.
- No change to the prior initiative's frozen record at `docs/initiatives/2026-08-28-the-refiner/`. Its stale `# 8` comment stays as written.
- No general-purpose execution framework.
- No edit to the Aug 28 snapshot at `$TMPDIR/the-refiner-verify`. This initiative uses its own namespace, `$TMPDIR/refiner-followups-verify`.

## Design decisions and why

The pair-count assertion becomes a live test, not a doc edit. A test enforces itself on every run; a comment in a frozen historical record does not. The current comment at `execution-plan.md:176` already sits disconnected from any test runner or CI, which is exactly how it went stale. Writing the count into a test that runs with the rest of the suite closes that gap for good, instead of asking a future editor to remember to update a comment.

The oracle and the eval 12 split come before any execution work. At the decision gate, Codex's amendment turned its own options E and F from alternatives into prerequisites: fix what "pass" means with stable criterion IDs before an executor runs against it, and split eval 12 into linked pre-approval and post-approval cases before grading either half. Building an execution canary on top of a rubric that still lets the judge choose its own criteria each run would test the canary against a moving target.

Final artifacts cannot prove "rendered exactly once," which is why the execution canary stays narrow. `render.mjs` overwrites its three outputs on every call and keeps no invocation history, so nothing left on disk after a run can distinguish one render from three. `dispatch-log.mjs`, by contrast, is already append-only and validates tier, model, effort, and outcome on every entry, so it can prove per-dispatch ordering today.

The canary is scoped by exclusion, and this is the point that is easy to get backwards. A criterion the dispatch log or a ledger diff already settles falls OUT of canary scope, because execution evidence would add nothing to it. The canary targets only the residue, the criteria nothing available can settle, and its job is to introduce the evidence that settles them. Render count is the clearest expected member of that residue, not an exclusion from it. The residue is measured at the evidence gate after the work is done, never declared in advance, because an evidence source that looks deterministic on paper often cannot decide the criterion it was assigned.

## Success criteria

- `before-after.md`'s header states the tail rule, checkable by a test that asserts the specific text is present.
- `before-after.md` contains a numeral that survives the rewrite unchanged, checkable by a test that asserts pair 1's Before and After carry the identical numerals.
- `before-after.md` contains one structured example with a heading, a list, and a fenced code block, checkable by a test that asserts all three are present.
- A live test asserts the pair count in `before-after.md` and their numbering order, replacing reliance on the frozen doc's comment.
- The three em-dash rules hold, proved by Task 5: the five drift-scanned files stay clean, every file this plan creates is clean, and `git diff a422612 -- plugin/ | grep '^+' | grep -c $'\xe2\x80\x94'` reports 0 added em dashes. Pre-existing em dashes in `run-evals.mjs` (12) and `evals.json` (7) are out of scope and are not counted.
- `node --test plugin/skills/the-refiner/references/*.test.mjs` passes with 11 tests and 0 failures.
- Eval 12 is split into linked pre-approval and post-approval cases with stable criterion IDs, mutual `resumes`/`resumedBy` linkage, and a named evidence source per criterion, all checkable by the eval catalog tests.
- The fixed rubric is wired into the runtime, not just the unit tests, checkable by a runner-level test that drives `executeEval` with an injected fake and proves an undeclared criterion ID yields a null verdict.
- Declared eval fixtures exist on disk and are materialized containment-safely, and any run whose originals show final byte drift, a deletion, or a file-type change fails and discards its verdict, checkable by the fixtures and runner tests. The guarantee stops there on purpose: a post-run hash comparison cannot see a modify-then-restore, and closing that needs read-only isolation of the fixture source, which is execution-harness work and belongs to the canary. A test asserts the limit explicitly so it stays written down.
- `node --test plugin/skills/the-foreman/references/*.test.mjs plugin/skills/the-foreman/evals/*.test.mjs` passes with 0 failures.
- `claude plugin validate ./plugin --strict` reports Validation passed.
- No paid eval run occurred during this plan, checkable by the absence of a live-run log entry and by every eval invocation in the plan using `--dry-run`.
- `$TMPDIR/the-refiner-verify` is unchanged, checkable by replaying one deterministic fingerprint script before and after the work and diffing the two outputs. The fingerprint covers the root directory's own `st_mtime_ns` plus every descendant's relative path, entry kind, size, exact `st_mtime_ns`, and sha256, sorted by path. It deliberately excludes the shared `TMPDIR` parent, whose mtime the plan's own temp-directory tests change.
- The prior initiative's record is byte-identical to a422612, checkable by `git diff a422612 -- docs/initiatives/2026-08-28-the-refiner/` producing no output.

## Risks

Judge variance is a property of the current rubric, not the wiring. `buildJudgePrompt` hands the judge the whole `expected_output` string and tells it to split that string into clauses and grade each one, so criterion identity and count are chosen fresh every run. `parseVerdict` recomputes `passed`/`failed`/`pass_rate` after that split, but it recomputes arithmetic on a segmentation the judge already picked; it does not fix the rubric. Mitigation: phase 1's stable criterion IDs, option E, fix the rubric before any grading happens, so the recompute has a fixed segmentation to work from.

A staged plan can drift into two permanent harnesses without firm exit criteria. Keeping the narration harness for every other eval while adding an execution canary for eval 12 risks both surviving indefinitely if nothing forces a decision between them. Mitigation: the evidence gate at phase 1's boundary forces the decision rather than deferring it. It names the residue of criteria that no artifact or log can settle. An empty residue closes phase 2 as unnecessary; a non-empty residue scopes phase 2 to exactly that residue and nothing wider.

An execution canary can end up validating its own stub and sandbox rather than production behavior. Task 6's history recorded six individually authorized paid runs scoring 0.80, 0.82, 0.93, 0.43, 1.0, 1.0, where the seams never failed a criterion; the 0.43 run's recorded cause was executor variance in a fixture-less probe, and Codex's preserved objection is that the latest spec still has no stored passing run. Mitigation: this plan requires phase 1's live fixtures to exist before phase 2 runs at all, and scopes phase 2 to eval 12 alone rather than a general execution framework, so a canary result can be checked against a fixture instead of a stub the canary also wrote.
