# Codex lifecycle

The shared gate-contract.mjs supplies transition kinds, artifact types and authorization scope. This host narrative replaces references/lifecycle.md when that copied document names Claude-specific controls. It does not replace the shared transition map.

## Entry or resume

Read project canon, relevant context and the initiative bundle; detect fresh work versus an in-flight feature/handoff before creating artifacts. Establish the active Codex policies/capabilities and explicit runtime bindings in runtime.md. A fresh initiative has no prior artifacts to load. A resume uses the sibling handoff skill and [shared checkpoint contract](../../handoff/references/continuity.md).

Check repository identity, branch/HEAD, staged/unstaged/untracked fingerprints, scope, authorizations and actual verification/review evidence. Rerun relevant recorded verification and classify it accurately: last green baseline is separate from current expected TDD RED. A reproduced expected RED can authorize the already-approved next implementation action, never phase completion. Historical results stay historical. Matching valid completed reviews need no rerun solely because the conductor host changed; changed/missing/unverifiable review evidence leaves that gate unverified.

Preserve accessible phase-start snapshot bindings and every listed baseline file; a missing file is not an empty file. Never reset work or invoke phase-start to hide resume drift. After relocation remap repository-relative references and stop only the affected review until the original baseline is restored or the user approves full in-flight review scope. Pending decisions remain pending; unknown/conflicting grants require narrow clarification. Transfer worker evidence, not live handles; create fresh destination-host children.

## Design, branch and plan

Refine the design before code; use the project's available brainstorming/planning skills or the established equivalent workflow. Design approval remains a separate stop. Ground genuine architecture/data/API/scope/irreversible forks through `codex-gate question`; its recommendation informs the decision-fork artifact and is visibly attributed. A question-mode infrastructure failure may be surfaced before asking directly; review-mode infrastructure failure never passes a gate.

Establish branch posture off the integration base before plan/code writes; preserve an already-authorized current branch. Use a new worktree only when explicitly requested or supported by applicable project canon. Write the approved-design PDR/ADR/execution-plan bundle to disk, invoke `codex-gate bundle` (or `plan` for a single plan) to APPROVE, then render/surface the plan-approval artifact and obtain the scoped answer. Record plan approval and local-commit permission separately (default no commits). Freeze ordered phase IDs/scope. Splitting, merging, reordering or adding approved phases is a decision-fork before re-slicing.

## Each approved phase

1. Before fresh implementation, invoke `codex-gate phase-start <id>` once; persist RUNDIR and PHASE_HEAD. On mid-phase resume reuse the original snapshot instead.
2. Dispatch a fresh native implementer with bounded context, file ownership, acceptance and TDD RED-first constraints; do not silently implement a phase inline when delegation is unavailable. Read orchestration.md.
3. Inspect actual implementer evidence, then run separate spec-compliance and code-quality review workers. Give reviewers the intended scope, files and raw evidence; verify their findings and repair within approved scope, re-reviewing affected changes. Both review roles remain mandatory even when the conductor and external reviewer use Codex.
4. Write `<RUNDIR>/context.md` with intent, acceptance, implementer summary, separate spec/quality review results and evidence links, plus relevant project continuity. Invoke `codex-gate phase-review <id>` and drive its actual loop to APPROVE. Missing/malformed evidence, INFRA_ERROR, OVERFLOW and non-convergence stop the phase; a ledger claim is not a reviewer verdict.
5. Run the relevant verification and inspect output. Commit only if scoped local commits were authorized, staging explicit paths. Refine ledger prose through an isolated child, update evidence and render/surface the phase-boundary artifact before the human decision. Verification is a precondition to this sole exit from the phase loop.

An explicit batch-run grant waives only boundary questions for the remaining approved phases. Each full pipeline still runs; every other gate remains armed. The grant becomes void at the first RED, failed review, missing evidence, infra failure, fork, scope drift or non-convergence. Stop and surface then; never ride a batch through a failure. Final verification follows the approved final boundary.

## Live work, shipping and handoff

Before a live/paid/prod/irreversible run, render/surface live-run with cost, blast radius and cleanup evidence and obtain the precise scoped authorization under host policy. A governance weakening triggers governance-pushback; never bypass native policy. Read-only investigation proposes fixes but grants no implementation/live permission.

Shipping requires a fresh explicit human instruction after the final approved boundary naming push/PR, then actual `codex-gate prepr` approval and the project's shipping workflow. Plan text, batch-run and kickoff intent do not grant shipping. Overflow mitigation may use shared prepr-delta/sharding; never invent coverage. High-impact multi-lens use follows the sibling gate contract and does not silently change owner dials.

At pause follow the sibling handoff skill's finalization order. Author the handoff Markdown and short host-neutral kickoff prompt, send each through a separate isolated the-refiner Review child, apply findings and log outcomes. Finalize every kickoff, ledger, companion board/Markdown twin, context, receipt, verification log, evidence and state-input write before final capture; then stop/join all writers. Only then capture the shared checkpoint and run its read-only check. Deliver the existing artifact paths and final check status in chat without further inventoried writes, refinement or rendering. A needed correction returns to finalization, quiescence and capture/check while preserving the original review baseline. Handoff is a checkpoint, not an approval gate or an automatic chat send.
