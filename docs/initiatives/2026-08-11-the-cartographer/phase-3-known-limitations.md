# Phase 3 — known limitations (recorded, not fixed)

**State:** 164 tests passing. `codex-gate phase-review P3` ran 5 rounds: **6 → 5 → 4 → 2 → 2**.
Verdict is still **BLOCK**. Nothing here claims the gate approved. Companions:
[phase-1](./phase-1-known-limitations.md) · [phase-2](./phase-2-known-limitations.md).

Best convergence of the initiative — the plan gate never fell below 11, Phase 1 plateaued at ~5,
Phase 2 at ~2–3, and Phase 3 went 6 → 2 in four fix rounds.

## What the gate caught and we DID fix

Each closed with a red test written first. Several were **visible defects in the picture itself** —
exactly what a plan review cannot see:

- **`findings` defaulted to `[]`** — calling `renderHero` without it rendered a *drifting* map as clean:
  "No drift was found", no drift styling. A silent false negative in an audit tool's headline output.
  Now required.
- **Parallel typed edges overprinted** — the fixture's `control` and `data` edges between the same two
  nodes drew the identical path with captions at the identical point. Two recorded relationships were
  illegible. (This was visible in the first published preview.)
- **Straight-line routing crossed unrelated boxes** — `mode.check → outcome.pass` ran *through*
  `component.tiny_core` and placed the `emits` caption inside it. Now routed through a caption band,
  proven by Liang–Barsky clipping of every segment against every non-incident box.
- **Self-edges bypassed route allocation**, so parallel self-edges overprinted; and a **top-row
  self-edge caption collided with the lane heading**. The extended sweep found a second, pre-existing
  instance of the latter that the reported case alone would have missed.
- **Mermaid pipe labels could break the parser** — the sanitiser was converting brackets into
  parentheses, which are themselves tokens. Substitution table is now closed (fullwidth forms).
- **Semicolons terminated stateDiagram transitions**, blanking the whole detail view.
- **Labels overflowed the canvas** — unbounded `<text>` in a viewBox sized only for boxes. Now fitted,
  with a per-glyph width model, and the full text preserved in `<title>`.
- **An unknown finding `nodeId` was silently discarded**, so the hero claimed "No drift was found".
- **The 15-node C-002 cap was bypassable** via `maxNodes`, and unenforced by the validator.

## The through-line: one asymmetry, three phases

Every phase's residual reduces to the same thing: **`validate.mjs` and its consumers disagree about
what a legal map is.** The validator reads properties plainly; the renderers read own descriptors and
canonicalize. Each round finds a new shape where they part company — first exotic objects, then
accessors, now inherited and non-enumerable *view* fields.

Round 5's remaining P1 is precisely this: a view whose `form` / `title` / `nodes` is an accessor or
inherited property validates clean, is dropped by `JSON.stringify`, and makes `resolveView` throw.

**The fix is architectural, not another patch:** one canonicalization at ingest, shared by `validate`,
`diff` and the renderers, so there is exactly one definition of "a legal map" and it is applied once.
Three phases of evidence now support it. It is the natural first task of any Phase 4 work, and it
should be done deliberately rather than under review pressure.

## What remains open

| # | Finding | Reachability |
|---|---|---|
| 1 | `validate.mjs` accepts hidden/inherited view fields that `JSON.stringify` drops and `resolveView` rejects | Requires an accessor or non-enumerable property on a view — **`JSON.parse` cannot produce either** |
| 2 | Band-route strokes can overprint an edge caption (strokes are separated from *boxes* and captions from *boxes*, but a stroke may cross another edge's caption) | Reachable with a dense enough edge set; cosmetic, and the `<title>` carries the text regardless |

Finding 2 is the only one reachable from a real `map.json`. It degrades legibility in edge-dense
diagrams; it does not lose or falsify information.

**Finding 1 — CLOSED 2026-08-13.** The architectural fix this document asks for was done:
`references/canonical.mjs` is now the one definition of a legal map's SHAPE, ingested once by
`validate`, `computeDrift`, `resolveView` / `layoutHero`, `normalize` / `serialize` and
`checkFreshness`. A view whose `form` / `title` / `nodes` is an accessor, inherited or non-enumerable
is refused by all of them, in the same words. Pinned by `layout.test.mjs` test 23 (six ingest shapes,
each RED before the change), `canonical.test.mjs` and PDR §7.1 rule 12. **Finding 2 stays open** — it
is geometry, not ingest.

## Honest note

The gate was right every round. What is being recorded is a judgement about *sequencing*: the
remaining defects are a tail whose root cause is a known architectural asymmetry, and closing them one
at a time in the renderer is the wrong move. See
[the-foreman#31](https://github.com/Angel45604/the-foreman/issues/31) for the methodology finding this
initiative produced.
