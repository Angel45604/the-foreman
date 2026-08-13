## P1 — docs/initiatives/2026-08-11-the-cartographer/execution-plan.md:119
`validate(map)` has no `repoRoot`, yet rule 5b requires realpath/symlink containment beneath `repoRoot`. Falling back to cwd would violate Task 8's root-resolution contract. `coverage.read` is also not required to correspond to hashed sources, so a changed fully read input can still be reported fresh.

## P1 — docs/initiatives/2026-08-11-the-cartographer/execution-plan.md:154
ADR C-014 remains bypassable: `claimKind` is only described as rejecting unknown values, not as required, and reconstruction silently defaults a missing value to `doc` at line 739. Evidence is also not required to cite a `role: "code"` source, so documentation can be used as behavioral evidence.

## P1 — docs/initiatives/2026-08-11-the-cartographer/execution-plan.md:193
The prescribed edge ID uses only `from` and `to`, while the IR supports distinct control, data, and doc edges. Parallel typed edges between the same nodes collide and are rejected, silently making valid graph relationships unrepresentable.

## P1 — docs/initiatives/2026-08-11-the-cartographer/execution-plan.md:490
The hold-out extractor receives only `SKILL.md`, but Task 9 does not require it to describe the new validator contract: repo-relative paths, role binding, contradiction matching, exact ID derivation, and graph completeness. PDR §7 likewise lacks these rules despite ADR C-006 naming it the human-readable contract.

## P2 — docs/initiatives/2026-08-11-the-cartographer/execution-plan.md:131
Task 2 says to plant exactly three drift cases but enumerates four findings, while Task 3 and Task 8 require four. The fixture contract is contradictory.

## P1 — docs/initiatives/2026-08-11-the-cartographer/execution-plan.md:602
Task 11's pinned-subject instructions conflict: lines 590-593 require the absolute `/tmp/carto-subject/...` path, but the actual extraction dispatch gives the worker relative `plugin/skills/codex-gate/`. It can therefore map the mutable checkout while scoring against the pinned worktree.

## P1 — docs/initiatives/2026-08-11-the-cartographer/execution-plan.md:609
The claimed held-out run is still not auditable or isolated. The plan acknowledges inherited answer-key knowledge but incorrectly says it affects recall only—an agent can emit exactly the six known findings and pass precision too. It also relies on a tool-call record that the documented Foreman dispatch log does not retain.

## P1 — docs/initiatives/2026-08-11-the-cartographer/execution-plan.md:677
The C-015 dispatch-edge coverage floor is not actually checked. The plan says to derive every emitting mode and require its edge, but the only assertion accepts any one control edge; missing outcome nodes merely print `MISSING` and do not fail.

## P1 — docs/initiatives/2026-08-11-the-cartographer/execution-plan.md:696
Reconstruction still omits material self-sufficiency data: evidence notes, claim text and `checked`, edge evidence, contradiction records/statements, and node summary/attrs/inferred status are absent from the schema or comparisons. A Markdown report containing bare citations can pass despite Task 7 requiring the omitted content.

## P2 — docs/initiatives/2026-08-11-the-cartographer/PDR.md:327
The approved PDR still requires appending a Foreman ADR, while Task 10 correctly forbids it because the Foreman index is scoped to Foreman ADR-NNN decisions. PDR §12 also omits the owner-approved C-015 depiction floor while the handoff claims it was applied.

## P2 — docs/initiatives/2026-08-11-the-cartographer/execution-plan.md:301
UNVERIFIED is required to be visually distinct by PDR §8.1, but SVG test intent specifies styles only for PHANTOM, UNDOCUMENTED, and STALE. No Mermaid/SVG treatment or test covers UNVERIFIED.

