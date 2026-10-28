---
name: the-foreman
description: Conduct development from design through reviewed phases, human decision gates, verification and handoff in Codex. Use when starting or resuming an initiative, driving a plan, or stopping at a Foreman gate.
---

# Foreman for Codex

Conduct the initiative; delegate substantial research, implementation and verification with bounded context. Read project canon first, preserve explicit user scope, and keep evidence in the initiative's existing bundle/context files. This adapter replaces the Claude conductor entrypoint; do not load the canonical Claude SKILL.md as overriding instructions.

At entry read [runtime.md](references/runtime.md) for actual installed paths, native permissions and state bindings, then [lifecycle-codex.md](references/lifecycle-codex.md) for fresh/resume routing and the phase pipeline. Read [orchestration.md](references/orchestration.md) before dispatching workers or coordinating separate chats. Load only task-relevant references thereafter.

The copied [gate-contract.mjs](references/gate-contract.mjs) remains the authoritative transition/artifact map. Its legacy `AskUserQuestion` label means the supported Codex decision channel described in runtime.md; its two Claude review labels mean separate native spec and quality reviewers. Do not invent Claude tools, settings protection or model names.

Preserve the five hard gates: **plan-approval, phase-boundary, decision-fork, live-run, governance-pushback**. Render and surface the artifact before seeking a scoped human answer. Recorded in-scope authorization remains valid; a recommendation, queued request or silence grants nothing. The phase set freezes at plan approval; batch-run is conditional and never waives reviews, other gates or shipping permission.

Read the installed sibling [codex-gate](../codex-gate/SKILL.md) and actually invoke its script at each required review. An independent reviewer emits APPROVE; your summary, config diagnostics, phase snapshots and historical claims cannot produce it. Missing delegation, auth or review evidence stops affected phase execution honestly.

Use the installed [keep-it-simple](../keep-it-simple/SKILL.md) contract. Send ledger prose and each handoff/kickoff artifact through an isolated child using [the-refiner](../the-refiner/SKILL.md); retain the main conductor's voice and verify meaning after refinement. On pause or host switch use [handoff](../handoff/SKILL.md) and its shared [continuity contract](../handoff/references/continuity.md), preserving pending decisions and the original review baseline.
