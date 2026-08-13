# Phase 2 — known limitations (recorded, not fixed)

**State:** 101 tests passing. `codex-gate phase-review P2` ran 4 rounds: **3 → 2 → 2 → 3** blockers.
Verdict is still **BLOCK**. Nothing here claims the gate approved. Companion to
[phase-1-known-limitations.md](./phase-1-known-limitations.md).

## What the gate caught and we DID fix

Each closed with a red test written first:

- **`__proto__` collapsing the deterministic tie-break** — two citations differing only in an own
  `__proto__` key produced identical content keys, so reversing extractor order reversed output order.
  (Same class as the Phase 1 serializer bug — it recurred independently one module later.)
- **Citations aliasing the input map** — a renderer annotating `finding.citations[0].meta` mutated the
  snapshot. That is drift being written back into `map.json`: precisely the ADR C-004 side door.
- **Hollow citations emitting unauditable findings** — STALE shipped `citations: [{}, {}]`, and
  family (A) rendered a literal `undefined:undefined` into human-visible detail text.
- **A hollow evidence record silently DELETING a finding** — it counted as "evidenced", so the PHANTOM
  that was due never fired. A false negative in an audit tool is the worst possible failure.
- **STALE without a quote** — a contradiction could omit `claim.text` or `evidence.note`, leaving the one
  judgement-based class with nothing to audit.
- **Time-of-check ≠ time-of-use** — validation read one value and derivation re-read another, so a
  stateful accessor could pass the guard and then ship `{}`. Fixed architecturally: `computeDrift` now
  canonicalizes the input once at a boundary and reads nothing else afterwards.

## The shared root cause of what remains

`validate.mjs` and `diff.mjs` **disagree about what a legal map is.** `validate()` reads properties with
plain gets; `diff.mjs` canonicalizes from own descriptors. Every round finds a new input shape where the
two diverge — a validator-accepted map that the engine refuses or treats differently.

That is why the count is flat rather than falling: the defect is the *asymmetry*, and it lives across
both modules. Hardening either one alone cannot close it.

**The decisive fix is one shared canonicalization used by the whole pipeline** — `validate`, `diff`, and
`serialize` deriving from a single definition of "a legal map", applied once at ingest. That is a Phase
1 + Phase 2 unification, not a fix round, and it is a scope decision for the owner.

## What remains open

| # | Finding | Reachability |
|---|---|---|
| 1 | `diff.mjs:118` — the tag-based ordinary-object check accepts prototype-backed nodes, but `canonicalNode` copies only own fields, so a validator-accepted node with an **inherited `inferred: true`** is snapshotted without the flag and would be accused | Requires `Object.create({inferred: true})` |
| 2 | `diff.mjs:245` — `map?.nodes` is read before the boundary, so a map with a **non-enumerable `nodes`** passes `validate()` and yields findings while `serialize()` drops `nodes` entirely | Requires `defineProperty(map, 'nodes', {enumerable: false})` |
| 3 | `diff.mjs:166` — the boundary accepts `-0`, which `contentKey` stringifies as `0`, so citations differing only by metadata `-0` vs `0` tie and input order leaks | Requires `-0` inside citation metadata |

**All three CLOSED 2026-08-13**, by the shared canonicalization this document names as the decisive
fix rather than by three more patches. `references/canonical.mjs` is the one definition of a legal
map's SHAPE, ingested once by `validate`, `computeDrift`, `resolveView` / `layoutHero`, `normalize` /
`serialize` and `checkFreshness`: an inherited `inferred` is absent to all of them (1), a
non-enumerable `nodes` is refused by all of them (2), and `-0` is carried through as the `0` the file
holds, so two citations differing only by its sign are genuinely identical rather than tied (3). See
PDR §7.1 rule 12, `canonical.test.mjs`, and `layout.test.mjs` test 23.

**Why these were recorded rather than fixed at the time:** none is reachable through any real pipeline
path.
`map.json` has exactly one producer (our extractor) and one reader — `JSON.parse(readFileSync(...))` in
`render.mjs`'s CLI. **`JSON.parse` cannot produce a prototype-backed object, a non-enumerable property,
or `-0`.** Every remaining finding requires a hand-crafted in-memory map that no code path constructs.

They become live the moment `computeDrift` is handed a map from something other than `JSON.parse` — a
programmatic caller, a plugin, a future in-process extractor. **At that point this table is the
checklist, and the shared-canonicalization fix above is the answer rather than three more patches.**

## Honest note on the process

Phase 1 and Phase 2 each ran four review rounds and each plateaued on the same signature: the gate kept
finding real defects, and the count stopped falling. In both cases the last rounds were adversarial
inputs that the system's only producer cannot emit.

The gate was right every time — these are genuine asymmetries. The judgement being recorded here is that
closing them one at a time is the wrong move, and that the correct fix is architectural and worth doing
deliberately rather than under review pressure. See also
[the-foreman#31](https://github.com/Angel45604/the-foreman/issues/31).
