# Opus 5.5 conducts, Sonnet 5.5 builds — design

**Date:** 2026-10-06 · **Branch:** `feat/opus-sonnet-split` (worktree off `origin/main` e40ac35) ·
**Owner:** Angel Marcos

## Ask

Owner, verbatim: "Opus 5.5 and sonnet 5.5 are online. I want you to upgrade the skill / plugin to take
advantage of those models. Sonnet 5.5 will implement and Opus 5.5 will coordinate / orchestrate."

## Gate waiver (read first)

- **codex-gate is skipped for this initiative only**, by owner instruction ("skip the codex-gate
  altogether for now" — OpenAI models offline).
- **No codex rule in the skill changes.** Non-negotiables #1/#2, the codex Red Flags, the
  gate-contract triggers, the lifecycle codex lines, and the codex evals stay byte-for-byte.
- Because Non-negotiable #1 cannot be satisfied while OpenAI is offline, this initiative is driven by
  hand with the same phase discipline (test-first, fresh builders, two deep-tier reviews), not through
  the-foreman's lifecycle.
- The owner's four decisions were asked directly via AskUserQuestion **without Codex grounding**, at
  the owner's instruction.
- Exit: when OpenAI is back, the owner decides whether to run a catch-up `codex-gate prepr` on this
  branch before any push.

## Decisions (owner, 2026-10-06)

| # | Decision | Chosen |
|---|---|---|
| D1 | How strongly to encode the split | Text + drift tests + a Stage-0 conductor-tier NOTE (never a blocker). No agent files, no frontmatter `model:`. |
| D2 | "Sonnet implements" vs the deep-tier floor for judgment-heavy work | Split: a deep read-only investigator returns root cause + failing test + crisp spec; a standard builder implements it; deep builder only when the fix can't be specified apart from doing it. |
| D3 | codex-gate while OpenAI is offline | Skip for this upgrade only; codex rules untouched. |
| D4 | Finish line | Local commit on the feature branch + cmp-guarded sync to the installed personal copy. No push, no PR. |

Sequencing vs `feat/true-loop-conductor` (uncommitted plan touching the same hunks): this branch lands
first and takes ADR-011; true-loop rebases and renumbers.

## Facts this rests on

- Claude API reference (cached 2026-09-25): Opus 5.5 — 1M context, effort `low`…`max`, API default
  `medium`. Sonnet 5.5 — 1M context, effort recalibrated vs Sonnet 5 (start at `medium` for agentic
  coding). Haiku 4.5 — no effort parameter.
- Claude Code docs (fetched 2026-10-06): Opus 5.5 and Sonnet 5.5 default to `medium` effort; a
  subagent with no frontmatter effort inherits the session effort; skill frontmatter `model:` lasts
  only the current turn.
- Observed this session: a Workflow agent dispatched with `model: 'sonnet'` reports `claude-sonnet-5-5`;
  the Agent tool's `model` enum is `sonnet|opus|haiku|fable` with no effort parameter.
- Dispatch log (305 entries, pre-5.5, confounded by shape): standard tier non-green mostly on
  investigative shapes (scoped-trace 2/5, scoped-audit 2/5), clean on crisp specs
  (focused-fix-crisp-spec 0/10). Directional support for D2 only.

## Shape of the change

The skill already had the bones: an "opus-class" conductor that never implements, a deep-tier floor,
reviewer ≥ implementer, and model names confined to one §8 mapping column. Gaps closed here:

1. The §8 mapping was stale ("Sonnet 5 ≈ deep-tier", "or the strongest tier available", fast → haiku).
2. No explicit role line, so spec-compliance review sat at standard tier (Sonnet reviewing Sonnet).
3. "When unsure, omit the model (inherit)" — under an Opus conductor that silently makes Opus the builder.
4. The handoff skill hardcoded an Opus implementer in three places.
5. No runtime signal when the conductor session runs on a non-deep model.

## Out of scope

codex-gate and its knobs; `dispatch-log.mjs` (model is free-form; tier/effort enums unchanged);
`gate-contract.mjs`; README / plugin.json / marketplace.json (also edited by other in-flight branches;
no version bump per repo practice); plugin agent definitions (rejected in D1).

## Verification

- RED→GREEN drift tests (contract-drift T1–T5, a run-evals parseArgs default test), full suite green.
- Behavior pressure scenarios (writing-skills TDD): baseline against the old text, then the new text,
  graded by a deep-tier judge.
- Two deep-tier reviews (spec-compliance, code-quality) on the diff.

## Outcome (2026-10-06)

- **Tests:** 670 → 676, all green. The six new tests were RED at e40ac35 for their planned reasons.
  A deep-tier mutation run showed T1, T2 and T4 fail on each targeted regression (spec-compliance
  review back at standard, the low-effort code-change ban deleted, "omit the model" restored, a model
  name in handoff or in §8 prose, a missing handoff file).
- **Behavior probes** (5 scenarios, probe executors on opus except S4 on sonnet, deep-tier judge):
  baseline on the old text 12/23 criteria; new text 23/23 after Phase 2, 21/23 after Phase 3b. The
  codex-offline control stayed 5/5 on both texts, so the codex rules did not weaken.
- **S3 note:** on the final text, 3 of 3 S3 runs answer an owner's explicit "send reviews to the cheap
  model" by holding the reviews behind a `governance-pushback` question: deep is the recommended
  path, a cheaper override is offered, and nothing is dispatched until the structured answer. None
  downgraded a review silently. The strict probe criterion wanted an outright deep dispatch.
- **Reviews:** deep-tier spec-compliance (approve-with-nits), code-quality (changes-required → fixed
  in 3b), scoped re-review (approve-with-nits → fixed in 3c), final re-check (approve).
- **Builders:** every edit was made by standard-tier (Sonnet 5.5 @ medium) builders against the
  execution plan; the conductor (Opus 5.5) wrote only the plan bundle.
