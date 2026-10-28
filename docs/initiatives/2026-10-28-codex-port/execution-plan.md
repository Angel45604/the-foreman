# Foreman Codex Port Implementation Plan

> For agentic workers: use subagent-driven-development with independent review. User approved implementation; proceed through these tasks without another approval request.

**Goal:** Install five Codex skills from shared sources; support bidirectional handoff, bounded delegation and authorized cross-session orchestration.
**Architecture:** Existing Claude runtime remains canonical. Codex overlays adapt host controls. Shared handoff checkpoints preserve repo state and evidence.
**Tech stack:** Node built-ins, Bash, Markdown, YAML metadata; no new dependencies.
**Spec:** `design.md` beside this plan.

## Global constraints

- Read existing files before edits; preserve Claude permission/review controls except documented resume interoperability.
- Local edits only. No commits/push/PR/global install/authentication changes or paid external reviewers.
- Real temporary Git/file tests; RED before helper/installer implementation. Skill baseline failures are recorded in validation.md.
- Workers own disjoint files. Parent integrates and verifies; no duplicated task dispatch.

## Task 1: shared continuity helper and contract

Own `plugin/skills/handoff/references/continuity.mjs`, `continuity.test.mjs`, `continuity.md`.

Interface: `node continuity.mjs capture <repo> <state.json> <handoff.md>` embeds a version-1 JSON checkpoint inside `<!-- foreman-resume:start -->` / `<!-- foreman-resume:end -->`; `node continuity.mjs check <handoff.md> [repo]` emits read-only JSON checks. `capture` reads a handoff already authored by the agent; never overwrites unrelated prose. A checkpoint proves filesystem identity, not user authorization or review approval.

State input: `initiativeId`, `sourceHost` (claude/codex), `stage`, `phase`, `nextAction`, `scope`, `verification`, `authorizations`, `pendingGate`, `workers`, optional `review` bindings; `evidence` is an array of existing file paths whose hashes are captured. Each authorizer/reviewer claim includes provenance and must be adjudicated by the receiving agent. Exact helper schema/example is owned by Task 1 and documented in continuity.md; Task 3 links it instead of duplicating it.

- [x] Test dirty/index/untracked/deleted state, evidence drift/missing files, phase snapshot preservation, legacy/malformed/unsupported blocks, expected RED, secret scan/no output on failure, round trip and read-only checks.
- [x] Implement capture/check with existing secret scanner and is-main helper; bounded JSON validation, actual git and file fingerprints, no credential/config reads, no generated approval. Preserve original snapshot contents; validate completeness for recorded snapshots.
- [x] Run focused Node tests; return contract and raw evidence paths.

## Task 2: Codex adapters and installer

Own `codex/skills/the-foreman/`, `codex/skills/codex-gate/`, `codex/skills/*/agents/openai.yaml`, `scripts/install-codex.mjs`, `scripts/install-codex.test.mjs`.

Interface: `node scripts/install-codex.mjs --dest <skills-dir>` assembles all five directories by copying `plugin/skills/<name>/` and overlaying `codex/skills/<name>/`. Default destination `~/.agents/skills`; no implicit execution on import. Validate every target before writes; refuse any existing target (including symlinks), no force mode. Include resource dependencies and license; all installed skills work without source checkout.

- [x] Test complete isolated install, installed CLI execution, paths with spaces, collision/no partial clobber, missing inputs, no config/credential writes, and standalone resources.
- [x] Implement installer, Codex Foreman lifecycle/runtime/orchestration references and reviewer adapter (existing script + owner dials; no invented approvals/auth).
- [x] Add metadata for all five skills; validate actual installed packages.

## Task 3: handoff entrypoints, Claude resume, documentation

Own `plugin/skills/handoff/SKILL.md`, handoff `assets/`, `plugin/skills/the-foreman/SKILL.md` and `references/lifecycle.md`, `codex/skills/handoff/SKILL.md`, root README.md.

- [x] Adopt shared continuity helper/reference and host-neutral templates; receiving host maps tools and preserves verified in-scope decisions/pending gates.
- [x] Update Claude resume only: accept shared checkpoint, expected RED, matching prior evidence and original review snapshot. Ordinary new gates and preflight retain existing controls.
- [x] Document install/update without clobber, runtime prerequisites, invocation, cross-host resume and cross-session limits. No promise of automatic Claude/Codex live messaging.
- [x] Check links and existing contract tests; coordinate exact helper schema with Task 1.

## Task 4: independent validation and integration

- [x] Spec/quality review each component; repair concrete findings with the original worker.
- [x] Run all Node suites and stubbed codex-gate Bash suite; execute packaged helper smoke tests.
- [x] Run independent behavior evaluations with installed skills: cross-host resume/pending approvals/RED, reviewer infra failure, bounded orchestration and authorization boundaries. Claims must distinguish simulated host decisions from live delivery.
- [x] Record results and remaining limits in validation.md; update handoff and show final diff/files.

## Review focus

1. Snapshot loss on mid-phase switch: Task 1 fingerprints original baselines; Task 3 prohibits phase-start replay.
2. False approvals from stale or malformed data: Task 1 never grants authority; adapters verify receipts/evidence and pending decisions.
3. Installer writes into an existing skill: Task 2 checks all collisions before copy and tests symlink cases.
4. Relative resources break outside checkout: Task 2 tests packaged commands in a copied install.
5. Unsolicited independent-chat messages or unbounded children: Task 2 instructions plus Task 4 behavior evaluation enforce native tool scope and capacity.

Unresolved questions: none; routine implementation choices follow the approved design.
