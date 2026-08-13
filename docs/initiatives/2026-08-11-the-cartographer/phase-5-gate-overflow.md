# Phase 5 — `phase-review` could not run: OVERFLOW

**Status: Phase 5 is UNGATED.** Three attempts, all `OVERFLOW`, never a verdict. This is an
infrastructure limit, not a code finding, and resolving it is an owner decision.

## What happened

| Attempt | Excluded | Packet | Budget |
|---|---|---|---|
| 1 | sibling initiatives, phase records, handoffs | 558,678 | 300,000 |
| 2 | + the generated `fixtures/**` | 342,752 | 300,000 |
| 3 | + all docs and `SKILL.md` (intended: code only) | **429,346** | 300,000 |

Attempt 3 went **up**, which diagnosed the cause: `CODEX_GATE_EXCLUDES` patterns are globs that do not
cross `/`. `docs/*` matches only direct children of `docs/`, which are directories, so it excluded
*nothing* — while attempt 2's explicit deep paths (`docs/initiatives/2026-08-11-the-cartographer/phase-*.md`)
did match. Attempt 3 therefore reviewed strictly more than attempt 2.

## Why the packet is large

Phase 5 is genuinely big: `SKILL.md` (371 lines), `attention.mjs` + its 17 tests,
`real-subject.test.mjs` (10 tests), changes to `render.mjs` / `markdown.mjs` / `style.css` /
`docs-contract.test.mjs`, ADR C-017, a rewritten PDR §6.2 — plus a 209 KB generated fixture.

Even with the fixture excluded the remainder exceeds the budget, so sharding by "code vs docs" does not
help; it would need finer shards than `CODEX_GATE_EXCLUDES` can express conveniently.

## What was NOT done, deliberately

`CODEX_GATE_PACKET_BUDGET` was **not raised**. The budget is a fail-closed guard — an over-large packet
degrades review quality, which is why it refuses rather than truncates. the-foreman's Red Flags table
puts the gate's strength dials with the owner, not the agent. Raising it to force a pass would be
weakening a governance gate to get a green light.

## Two codex-gate findings this produced

1. **`phase-review` has no sharding escape hatch.** Tier-3 sharding is implemented for `prepr` /
   `prepr-delta` only, so an over-budget `phase-review` has nowhere to go — the operator must hand-shard
   via `CODEX_GATE_EXCLUDES` or give up. The OVERFLOW message even points at `prepr`.
2. **The OVERFLOW message names a flag that does not exist.** It says *"use `prepr --since-reviewed`
   (Tier 2)"*; the real mode is the positional `prepr-delta`. This is `codex-gate.sh:519` — the same
   STALE finding the-cartographer's acceptance oracle was built around, encountered live, three times,
   while trying to gate the-cartographer. Recorded in `oracle-run-1.md` as oracle finding #5.

## Options for the owner

- **Raise `CODEX_GATE_PACKET_BUDGET` for this phase** — quickest, but it is a strength dial and the
  quality trade is real.
- **Hand-shard finer** — e.g. gate `attention.mjs` + its tests separately from the render/markdown
  changes, using explicit deep paths (remembering globs do not cross `/`).
- **Re-slice future phases smaller** so a phase's diff stays reviewable. Phase 5 bundled a protocol
  document, plugin registration, a contract change and a presentation feature; each would have gated
  cleanly alone.
- **Accept Phase 5 ungated** and rely on the 285 tests plus the next `prepr` before any PR, which *can*
  shard.

## What is true regardless

All three suites pass: the-cartographer **285**, the-foreman **398**, codex-gate **245 / 0 fail**.
The work is committed (`ebdda28`, `18493a3`, `9d784dc`). No claim is being made that a gate approved it.
