# ADR-001: the-refiner: name, packaging, and the worktree exception

Date: 2026-08-28 · Status: ACCEPTED (structured gate answers)

## Name

**the-refiner.** Field considered: the-editor, the-scribe, the-subeditor, the-translator,
the-distiller, the-refiner, the-shaper, the-tuner, the-mason, the-arranger, the-redactor.
Codex grounding (question mode, thread 01a04967-bfbc-7b02-8e86-fede61d6be92) leaned
the-editor on contract accuracy; Angel chose the-refiner at the structured gate: a refiner
removes impurities and conserves the substance, which matches the skill's invariants
(slop out; every fact and hedge intact; nothing added). Names rejected for naming a
transformation the contract forbids: the-distiller (compression), the-shaper (reforming),
the-arranger (reordering). the-redactor rejected for the English censorship reading.

## Packaging (the portability defect and its fix)

The personal skill reads its rule source from `~/.claude/output-styles/plain-voice.md`,
which does not exist for other plugin users. Fix: the plugin skill ALWAYS reads its own
packaged `references/core-contract.md` (deterministic, no environment assumptions). The
plugin also ships the Plain Voice output style as an optional, non-forced file; a
node:test drift guard asserts the style contains the core-contract body verbatim, so the
two shipped copies stay identical. Angel's personal copies are aligned in the final phase;
the personal output style remains the activation vehicle on this machine.

## Branch posture: the linked-worktree exception

The standing rule prefers plain branch-first; a worktree needs an explicit ask or a
documented canon exception. Exception taken and documented here: the repo's main checkout
holds the in-flight feat/the-cartographer branch (banked but checked out), and the repo
already uses sibling linked worktrees for parallel features (`the-foreman-steward`,
`the-foreman-wt-wave1`). A linked worktree at `/Users/angel/personal/the-foreman-refiner`
on feat/the-refiner off main follows that convention and leaves Angel's live checkout
undisturbed.

## Cycle wiring

Two seams, delegate-only, no new gates (canon fixes the hard-gate set at five):
- §4 authoring contract: deep rewrites of ledger SOURCE prose delegate to the-refiner
  before rendering. The ledger is canonical; the generated Markdown twin is never edited.
- §5 handoff wrap: handoff and kickoff text gets a the-refiner Review pass before banking.
The Stage-6 ship seam (PR bodies) was considered and deferred: commit-push-pr is an
external prerequisite and the repo cannot prove a draft-before-push seam exists.
