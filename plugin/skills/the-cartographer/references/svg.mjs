// the-cartographer — the inline SVG hero (PDR §6.1, ADR C-002) with drift drawn ON the map (§6.2).
//
// This is the one view that must never fail to draw. Mermaid executes in the Artifact host, so a
// local `file://` page shows raw text; the Overview is generated SVG precisely so the most important
// picture renders everywhere — published, local, and inside a the-foreman deck.
//
// It follows `artifact-diagramming`: native shapes and `<text>` only, sized by `viewBox`, themed
// through `currentColor`, arrowheads via `<defs><marker>`. Nothing here emits `<script>`, `<style>`,
// `<foreignObject>`, `<image>`, `xlink:href`, or an absolute URL — an `xmlns` is deliberately omitted
// too, since an inline SVG inherits the namespace from HTML and the attribute would carry the one URL
// a CSP-safe page cannot contain.
//
// Zero dependencies: node built-ins only.

import { LAYOUT, LANE_ORDER, DRIFT_SEVERITY, layoutHero, resolveView } from './layout.mjs';

/**
 * Neutralise source-derived text so it cannot form markup. Ampersand FIRST — escaping it last would
 * re-escape the `&` of the entities produced just before it.
 *
 * Throws rather than coercing: `String(undefined)` is how a literal `undefined` reaches a human, and
 * a map that cannot say what a thing is called must fail loudly instead of labelling a box with a
 * placeholder.
 */
export function escapeXml(text) {
  if (typeof text !== 'string') {
    throw new Error(
      `escapeXml: expected a string, got ${text === null ? 'null' : typeof text}. Rendering it `
      + 'anyway would print a placeholder where the map has no value.',
    );
  }
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Theme-safe accents: a CSS variable with a fallback that is neither black nor white. */
const WARN = 'var(--carto-warn, #b45309)';
const INFO = 'var(--carto-info, #2563eb)';

/**
 * One treatment per drift class (PDR §6.2), plus UNVERIFIED — which §8.1 guardrail 3 requires to be
 * "visually distinct from a confirmed defect" and which the drafted test intent had left with no
 * treatment at all.
 *
 * `box` is the node rectangle's presentation attributes. Every bundle differs from every other and
 * from the undrifted default, so class is legible from the shape alone.
 */
const CLEAN_BOX = { 'fill-opacity': '0.04', stroke: 'currentColor', 'stroke-width': '1.5' };

const TREATMENT = {
  // Both exist and disagree — the warning accent, thick and solid.
  STALE: {
    badge: 'STALE',
    accent: WARN,
    box: { 'fill-opacity': '0.06', stroke: WARN, 'stroke-width': '2.5' },
  },
  // Documented but not implemented — a ghost: dashed outline, muted fill.
  PHANTOM: {
    badge: 'PHANTOM',
    accent: 'currentColor',
    box: {
      'fill-opacity': '0.12',
      stroke: 'currentColor',
      'stroke-opacity': '0.55',
      'stroke-width': '1.5',
      'stroke-dasharray': '7 5',
    },
  },
  // Implemented but not documented — solid outline, badged.
  UNDOCUMENTED: {
    badge: 'UNDOC',
    accent: INFO,
    box: { 'fill-opacity': '0.04', stroke: 'currentColor', 'stroke-width': '2.5' },
  },
  // Not a defect: an absence of information. Dotted, so it reads as provisional rather than wrong.
  UNVERIFIED: {
    badge: 'UNVERIFIED',
    accent: 'currentColor',
    box: {
      'fill-opacity': '0.04',
      stroke: 'currentColor',
      'stroke-opacity': '0.55',
      'stroke-width': '1.5',
      'stroke-dasharray': '1 5',
      'stroke-linecap': 'round',
    },
  },
};

const BADGE = { height: 16, padding: 6, fontSize: 9, inset: 8 };

/** Type sizes, in user units. Shared with the fit below, so the two can never disagree. */
const FONT = Object.freeze({ label: 14, kind: 10, edge: 10, lane: 10 });

/**
 * ─── the width model ────────────────────────────────────────────────────────────────────────────
 *
 * There is no font engine here and there will not be one — a zero-dependency skill cannot measure
 * text — so the model is a STATED UPPER BOUND on how much ink a string can put on the page. The
 * bound must never under-estimate: a caption is placed from it, and an under-estimate draws text
 * onto a neighbouring box or off the canvas, which is a picture asserting something the map does
 * not record.
 *
 * The model this replaces was `characters × font-size` — one em per glyph, flat. It is a true bound
 * for most of a `system-ui` stack, and it is a very LOOSE one: `i` advances about a third of an em
 * and `t` about a half, so a real label was routinely charged two to three times the ink it puts
 * down. That looseness was not free. It is why the caption budget had to be widened from a node's
 * 200-unit box to the 272-unit LANE PITCH: under a flat em the fixture's own 14-character
 * `dispatch table` did not "fit" its box, so the bound was loosened until a real label survived —
 * and a label was then free to overhang 36 units into the 72-unit gutter where a direct edge and
 * its caption live. Loosening the bound to fit a bad model is what put text where boxes are not.
 *
 * So the MODEL is tightened and the BOUND is the box (`renderNode`). Per-glyph advances, in coarse
 * buckets, each rounded UP past the widest advance the glyph takes in the faces a `system-ui,
 * sans-serif` stack actually resolves to — SF Pro, Segoe UI, Roboto, Cantarell, Helvetica/Arial,
 * Liberation Sans and DejaVu Sans — in their BOLD weights, since the node label is drawn at
 * `font-weight: 600`. Buckets rather than a metrics table on purpose: a per-glyph number copied from
 * one font is a measurement of a font this SVG may never be drawn in, while a bucket ceiling is a
 * claim that holds across all of them, and it is the claim the model actually needs.
 *
 * Deliberately NOT claimed: ultra-wide grotesques such as Verdana, whose bold `W` passes 1.1em.
 * That is the same envelope the flat one-em model already assumed, so nothing regressed with it.
 *
 * `UNKNOWN` covers every code point outside the table — CJK, which is one em by construction, and
 * emoji, which reach about 1.3 — so the fallback is the WIDEST bucket, not the average one. The
 * flat model charged those 1em and under-bounded them; this one does not.
 */
const GLYPH_EM = (() => {
  const table = new Map();
  const put = (chars, em) => { for (const ch of chars) table.set(ch, em); };
  put(" !',.:;ijlI`-", 0.45);
  put('()[]{}/\\frtcszJ*"|', 0.65);
  put('mwMW@%…', 1.25);
  // Everything else printable — the rest of the alphabet, the digits, the remaining symbols. The
  // widest of them in the reference faces is a bold `O`/`Q` at ≈0.85em.
  put('abdeghknopquvxyABCDEFGHKLNOPQRSTUVXYZ0123456789#$&+<=>?^_~', 0.9);
  return table;
})();

/** The fallback: wider than any bucket, because an unmapped glyph may be an emoji (≈1.3em). */
const UNKNOWN_EM = 1.35;

const glyphEm = (ch) => GLYPH_EM.get(ch) ?? UNKNOWN_EM;

/**
 * textWidth(body, fontSize) -> the worst-case ink `body` puts on the page, in user units.
 *
 * Exported because the geometry claims this renderer makes — "no caption escapes its box", "no
 * caption lands on a box" — are only meaningful against a stated model, and a test that restates the
 * model has forked it. One model, read by the code that places text and by the tests that check
 * where it landed (ADR C-006's reasoning, applied to render geometry).
 *
 * Iterated by CODE POINT, so an astral character is one glyph and not two half-glyphs.
 */
export function textWidth(body, fontSize) {
  let em = 0;
  for (const ch of body) em += glyphEm(ch);
  return em * fontSize;
}

/** How much room a caption anchored at `x` has before it runs off a canvas `width` units wide. */
function roomAt(x, anchor, width) {
  if (anchor === 'middle') return 2 * Math.min(x, width - x);
  if (anchor === 'end') return x;
  return width - x;
}

const LANE_PITCH = LAYOUT.nodeWidth + LAYOUT.laneGap;

const ELLIPSIS = '…';

/**
 * A caption cut to fit, with an ellipsis marking the cut.
 *
 * TRUNCATION, chosen over the two alternatives. Wrapping would need vertical room a 64-unit box does
 * not have — the label baseline and the kind line already use it — so it would mean changing the
 * shared box geometry, and an unbroken 80-character token still would not wrap. Growing the canvas
 * to fit the text keeps the boxes the same size while making them a smaller fraction of a wider
 * picture, which is the opposite of readable at a glance. Truncating keeps every caption at full
 * size, inside its own box, and the picture the same shape.
 *
 * Nothing is lost by it: both callers write the FULL text into the enclosing `<title>`, which is
 * where a reader — and a screen reader — gets it back. `<title>` is never cut.
 *
 * The cut is measured with the SAME model as the fit, glyph by glyph, and the ellipsis is paid for
 * out of the budget rather than added after it — charging the marker afterwards is how a "fitted"
 * caption ends up one glyph wider than the space it was fitted to. Accumulated by CODE POINT, since
 * cutting a surrogate pair in half emits a lone surrogate, which is not well-formed XML.
 *
 * When not even the ellipsis fits, the ellipsis alone is returned: one glyph of ink that says the
 * text was cut is the floor, and an empty caption would silently drop the label from the picture.
 */
function fit(body, fontSize, available) {
  if (textWidth(body, fontSize) <= available) return body;
  const budget = available - textWidth(ELLIPSIS, fontSize);
  let used = 0;
  let kept = '';
  for (const ch of body) {
    const advance = glyphEm(ch) * fontSize;
    if (used + advance > budget) break;
    used += advance;
    kept += ch;
  }
  return kept + ELLIPSIS;
}

const attrs = (pairs) => Object.entries(pairs)
  .filter(([, v]) => v !== null && v !== undefined)
  .map(([k, v]) => ` ${k}="${escapeXml(String(v))}"`)
  .join('');

const el = (name, pairs) => `<${name}${attrs(pairs)}/>`;
const text = (body, pairs) => `<text${attrs(pairs)}>${escapeXml(body)}</text>`;

/**
 * ─── how an edge is routed ──────────────────────────────────────────────────────────────────────
 *
 * A straight line between two box centres is only honest when nothing sits between them. Drawn on a
 * lane layout it stops being honest twice over, and both failures are VISIBLE in the fixture:
 *
 *   • two edges between the SAME pair — the fixture records a `control` and a `data` edge from
 *     `mode.check` to `component.tiny_core` — produce the identical path and the identical caption
 *     anchor. Two recorded relationships land as one stroke and one smear of overprinted text.
 *   • an edge skipping a lane runs THROUGH the boxes in between: `mode.check → outcome.pass` crossed
 *     `component.tiny_core` and dropped the word "emits" inside it. A caption sitting in a box reads
 *     as belonging to that box, so the picture asserts a relationship the map never recorded.
 *
 * ADR C-002 buys the hero's simplicity with a 15-node bound and a deterministic lane layout, and the
 * fix spends that determinism rather than reaching for a routing engine. THE RULE, in full:
 *
 *   1. A SELF edge loops over its own box's top edge — WHEN the strip above that box is free. The
 *      top margin is not free: `renderHero` heads every lane column there. So a self-edge on a
 *      TOP-ROW node has no loop to take and falls to rule 3, which is where it belongs: its caption
 *      would otherwise be drawn on the very baseline the lane heading standing above its own box
 *      uses. No box occupies that strip, which is why every caption-vs-box rule here held while the
 *      two ran together into one smear.
 *   2. An edge between ADJACENT lane columns goes straight across the gutter between them — an
 *      unbroken 72-unit corridor that, by construction, no box can occupy. It cannot cross anything.
 *   3. Everything else — a lane-skipping edge, a same-lane edge, and every edge whose direct caption
 *      slot is already claimed — detours through a CAPTION BAND below the diagram: out of the box's
 *      side into a 12-unit channel beside its column, down to the band, across, and back up the
 *      destination's channel. Every one of those five segments lies in space no box occupies.
 *   4. Each banded edge gets its OWN band row. One row per edge is what makes overprint impossible
 *      rather than merely unlikely; packing edges onto shared rows would buy a shorter picture with
 *      a case analysis, which is the trade ADR C-002 exists to refuse.
 *
 * Rule 3's "caption slot already claimed" is what separates PARALLEL edges: two edges between one
 * pair want the same slot by definition, so the first takes the gutter and the rest take band rows —
 * different routes AND different captions, from one rule rather than a special case. It also catches
 * a pair of crossing edges that would collide on one slot without being parallel at all — and, by
 * rule 1, a slot claimed by a LANE HEADING rather than by another edge.
 */

/** How far outside a column an edge turns. Smaller than the margin, so it is on-canvas everywhere. */
const CHANNEL = 12;

/** The self-loop over a box's top edge: how far the arc rises, and how far above the box it captions. */
const SELF = Object.freeze({ rise: 16, lift: 8 });

/** The lane headings' baseline. `renderHero` draws them here; nothing else may. */
const LANE_LABEL_Y = LAYOUT.margin - 8;

/**
 * The strip the lane headings OWN — their baseline plus a full em of descender, which is generous
 * on purpose. Derived from the heading's own placement rather than restated as a number, so moving
 * the headings moves what is reserved for them.
 */
const LANE_STRIP_BOTTOM = LANE_LABEL_Y + FONT.lane;

/** How much room above a box a self-loop needs: the arc's rise, and its caption's ink. */
const SELF_HEADROOM = Math.max(SELF.rise, SELF.lift + FONT.edge);

/**
 * Is the loop over this box's top edge AVAILABLE?
 *
 * The loop and its caption live in the strip immediately above the box, and for a box in the TOP ROW
 * that strip is not empty: `renderHero` heads every lane column there, at the column's own x and at
 * `LANE_LABEL_Y`. A self-edge on a top-row node therefore captioned itself onto the lane heading
 * standing directly above its own box — same baseline, overlapping ink, both unreadable. NO BOX
 * occupies that strip, which is why every caption-vs-box rule in this file held while the picture
 * said two things in one place.
 *
 * The strip belongs to the headings, so the loop slot is simply unavailable when the loop would
 * reach into it and the edge takes a band row instead — rule 3's "the caption slot is already
 * claimed", with the heading as the claimant rather than another edge. Judged on GEOMETRY and not on
 * how wide this particular caption happens to be: a rule that fires only for long labels leaves the
 * next slightly-shorter one to be discovered by a reader.
 */
const selfLoopFits = (box) => box.y - SELF_HEADROOM >= LANE_STRIP_BOTTOM;

/** The caption band: how far below the lowest box it starts, the pitch between rows, caption lift. */
const BAND = Object.freeze({ gap: 26, pitch: 24, lift: 5 });

/** Clearance kept between an edge caption and whatever bounds it — a gutter wall or a box edge. */
const CAPTION_PAD = 4;

const centreY = (box) => box.y + box.h / 2;
const columnOf = (box) => Math.round((box.x - LAYOUT.margin) / LANE_PITCH);

/**
 * planRoutes(edges, boxes) -> { routes: Map<edgeId, route>, height }
 *
 * `height` is the canvas the BAND needs, or 0 when nothing was banded. Deterministic: band rows are
 * handed out in the caller's edge order, which `resolveView` has already sorted by id.
 */
function planRoutes(edges, boxes) {
  const bottom = [...boxes.values()].reduce((low, box) => Math.max(low, box.y + box.h), 0);
  const claimed = new Set();
  const routes = new Map();
  let banded = 0;

  for (const edge of edges) {
    const from = boxes.get(edge.from);
    const to = boxes.get(edge.to);

    // Which side each box is left by. A SAME-COLUMN edge is not rightward, so it leaves on the left
    // and arrives on the right — the one arrangement in which its two channels cannot coincide and
    // fold the detour back onto itself. A SELF edge is the extreme same-column case (one box, both
    // ends), and the same arrangement is what gives its detour two distinct channels.
    const rightward = to.x > from.x;
    const exit = { x: rightward ? from.x + from.w : from.x, y: centreY(from) };
    const entry = { x: rightward ? to.x : to.x + to.w, y: centreY(to) };

    // A self edge's loop over its own box is a ROUTE SLOT like any other, so it is CLAIMED like any
    // other. Special-casing `from === to` ahead of the allocation gave every self-edge on a box the
    // identical arc and the identical caption anchor — the overprint defect rule 3 exists to
    // prevent, surviving in the one shape that skipped rule 3 entirely. There is exactly one loop
    // per box, so the first self-edge takes it and the rest fall through to their own band rows.
    if (edge.from === edge.to) {
      const loop = `self:${edge.from}`;
      if (!claimed.has(loop) && selfLoopFits(from)) {
        claimed.add(loop);
        routes.set(edge.id, { kind: 'self', from });
        continue;
      }
    } else {
      const slot = `${exit.x + entry.x}:${exit.y + entry.y}`;
      if (Math.abs(columnOf(to) - columnOf(from)) === 1 && !claimed.has(slot)) {
        claimed.add(slot);
        routes.set(edge.id, { kind: 'gutter', exit, entry });
        continue;
      }
    }

    routes.set(edge.id, {
      kind: 'band',
      exit,
      entry,
      outOf: rightward ? exit.x + CHANNEL : exit.x - CHANNEL,
      into: rightward ? entry.x - CHANNEL : entry.x + CHANNEL,
      band: bottom + BAND.gap + banded * BAND.pitch,
    });
    banded += 1;
  }

  const height = banded === 0
    ? 0
    : bottom + BAND.gap + (banded - 1) * BAND.pitch + LAYOUT.margin;
  return { routes, height };
}

/**
 * One edge: a path with an arrowhead and its label, drawn along its planned route. A self-edge is
 * drawn rather than dropped — an edge silently missing from the picture is a relationship the map
 * recorded and the reader never sees.
 *
 * Every caption is centred and cut to the room its own route guarantees, which is what keeps it OFF
 * the boxes rather than merely on the canvas:
 *   • a gutter caption is capped to the gutter, so it cannot reach past either wall onto a box;
 *   • a self-edge caption is capped to its own box's width and sits above it, inside its column;
 *   • a band caption has no box anywhere near its row, so only the canvas edge bounds it.
 * Nothing is lost to the cut: the full label is in the `<title>` this group already carries.
 */
function renderEdge(edge, route, markerId, width) {
  const line = { fill: 'none', stroke: 'currentColor', 'stroke-width': '1.25', 'marker-end': `url(#${markerId})` };

  let path;
  let x;
  let y;
  let available;
  if (route.kind === 'self') {
    const { from } = route;
    const rise = SELF.rise;
    const left = from.x + from.w * 0.35;
    const right = from.x + from.w * 0.65;
    path = el('path', { ...line, d: `M ${left} ${from.y} C ${left} ${from.y - rise} ${right} ${from.y - rise} ${right} ${from.y}` });
    x = from.x + from.w / 2;
    y = from.y - SELF.lift;
    available = LAYOUT.nodeWidth - CAPTION_PAD * 2;
  } else if (route.kind === 'gutter') {
    const { exit, entry } = route;
    path = el('path', { ...line, d: `M ${exit.x} ${exit.y} L ${entry.x} ${entry.y}` });
    x = Math.round((exit.x + entry.x) / 2);
    y = Math.round((exit.y + entry.y) / 2) - 5;
    available = LAYOUT.laneGap - CAPTION_PAD * 2;
  } else {
    const { exit, entry, outOf, into, band } = route;
    path = el('path', {
      ...line,
      d: `M ${exit.x} ${exit.y} L ${outOf} ${exit.y} L ${outOf} ${band} L ${into} ${band} `
        + `L ${into} ${entry.y} L ${entry.x} ${entry.y}`,
    });
    x = Math.round((outOf + into) / 2);
    y = band - BAND.lift;
    available = roomAt(x, 'middle', width);
  }

  const label = text(fit(edge.label, FONT.edge, available), {
    'font-size': FONT.edge,
    fill: 'currentColor',
    'fill-opacity': '0.75',
    stroke: 'none',
    x,
    y,
    'text-anchor': 'middle',
  });

  return `<g class="carto-edge" data-edge="${escapeXml(edge.id)}"><title>${escapeXml(`${edge.from} → ${edge.to}: ${edge.label}`)}</title>${path}${label}</g>`;
}

/** One node box: the shape carries the worst class, the text carries every class. */
function renderNode(node, box, drift) {
  const treatment = drift ? TREATMENT[drift.primary] : null;
  const boxAttrs = treatment ? treatment.box : CLEAN_BOX;
  // Both captions are centred on the box, and both are budgeted against THE BOX — not the lane
  // pitch, and not the room left to the canvas edge. The box is the only bound that means anything
  // here: a caption inside its own box cannot reach the gutter where a direct edge and its caption
  // live, cannot land on a neighbouring lane's box, and — since `layoutHero` places every box
  // inside the canvas it reports — cannot be clipped by the canvas either, so the box bound implies
  // the canvas bound rather than competing with it. The whole label survives in the <title>.
  const cx = box.x + box.w / 2;
  const room = box.w - CAPTION_PAD * 2;

  const parts = [el('rect', {
    class: 'carto-node__box',
    x: box.x,
    y: box.y,
    width: box.w,
    height: box.h,
    rx: 8,
    fill: 'currentColor',
    ...boxAttrs,
  })];

  parts.push(text(fit(node.label, FONT.label, room), {
    class: 'carto-node__label',
    x: cx,
    y: box.y + 38,
    'text-anchor': 'middle',
    'font-size': FONT.label,
    'font-weight': '600',
    fill: 'currentColor',
  }));
  parts.push(text(fit(node.kind, FONT.kind, room), {
    class: 'carto-node__kind',
    x: cx,
    y: box.y + 54,
    'text-anchor': 'middle',
    'font-size': FONT.kind,
    fill: 'currentColor',
    'fill-opacity': '0.6',
  }));

  if (treatment) {
    // ONE box wears ONE badge — but a node carrying more than one class says so, so the extra class
    // is discoverable from the picture and not only from the tooltip.
    const caption = drift.classes.length > 1
      ? `${treatment.badge} +${drift.classes.length - 1}`
      : treatment.badge;
    // Sized by the SAME width model as every other caption. A private per-character constant here
    // was a second width model, and it disagreed with the one the text was drawn under: the pill was
    // sized at 6 units a character while its own `<text>` was 9 units of type, so `UNVERIFIED` — the
    // longest badge — was drawn one unit past the right edge of the box it badges.
    const width = BADGE.padding * 2 + textWidth(caption, BADGE.fontSize);
    const x = box.x + box.w - width - BADGE.inset;
    const y = box.y + BADGE.inset;
    parts.push(el('rect', {
      class: 'carto-badge',
      x,
      y,
      width,
      height: BADGE.height,
      rx: 8,
      fill: treatment.accent,
      'fill-opacity': '0.18',
      stroke: treatment.accent,
      'stroke-width': '1',
    }));
    parts.push(text(caption, {
      class: 'carto-badge__text',
      x: x + width / 2,
      y: y + 12,
      'text-anchor': 'middle',
      'font-size': String(BADGE.fontSize),
      'font-weight': '600',
      fill: treatment.accent,
    }));
  }

  const summary = node.summary ? ` ${node.summary}` : '';
  const classes = drift ? ` — drift: ${drift.classes.join(', ')}.` : '';
  const title = `${node.label} (${node.kind}, ${node.lane} lane)${classes}${summary}`;

  const cssClass = `carto-node${drift ? ` carto-node--${drift.primary.toLowerCase()}` : ''}`;
  const data = drift ? ` data-drift="${escapeXml(drift.classes.join(' '))}"` : '';
  return `<g class="${cssClass}" data-node="${escapeXml(node.id)}"${data}><title>${escapeXml(title)}</title>${parts.join('')}</g>`;
}

/** "3 of 6 nodes carry drift: 1 STALE, 1 PHANTOM, 1 UNDOCUMENTED." — every class, not just winners. */
function driftSentence(drift, nodeCount) {
  if (drift.size === 0) return 'No drift was found on this view.';
  const counts = new Map();
  for (const { classes } of drift.values()) {
    for (const cls of classes) counts.set(cls, (counts.get(cls) ?? 0) + 1);
  }
  const parts = DRIFT_SEVERITY.filter((cls) => counts.has(cls)).map((cls) => `${counts.get(cls)} ${cls}`);
  return `${drift.size} of ${nodeCount} nodes carry drift: ${parts.join(', ')}.`;
}

/**
 * renderHero(view, map, findings) -> string — a `<figure>`-wrapped `<svg>`.
 *
 * Pure. Reads the IR through `resolveView`, so it neither mutates nor aliases `map` or `findings`,
 * and fails closed on anything it cannot draw truthfully rather than emitting a hole.
 *
 * `findings` is REQUIRED — `resolveView` refuses an omitted one. A default would draw a drifting map
 * as clean for any caller who simply forgot it.
 */
export function renderHero(view, map, findings) {
  const resolved = resolveView(view, map, findings);
  if (resolved.form !== 'svg-hero') {
    throw new Error(
      `renderHero: view ${JSON.stringify(resolved.id)} has form ${JSON.stringify(resolved.form)}; `
      + 'the hero renders form "svg-hero" only. Render a mermaid view with renderMermaid.',
    );
  }

  const { width, height, placed } = layoutHero(resolved.nodes);
  const boxes = new Map(placed.map((box) => [box.id, box]));
  // The routes are planned before anything is drawn, because the caption band they may need is what
  // decides how tall the canvas is. Sizing the viewBox from the boxes alone would draw the detours
  // off the bottom of the picture — the boxes would still fit, and the arrows would be gone.
  const plan = planRoutes(resolved.edges, boxes);
  const canvasHeight = Math.max(height, plan.height);

  const markerId = `carto-arrow-${resolved.id.replace(/[^A-Za-z0-9_-]+/g, '-')}`;
  const marker = `<defs><marker id="${escapeXml(markerId)}" viewBox="0 0 10 10" refX="9" refY="5" `
    + 'markerWidth="6" markerHeight="6" orient="auto-start-reverse">'
    + '<path d="M 0 0 L 10 5 L 0 10 Z" fill="currentColor"/></marker></defs>';

  // Lane captions, so the left-to-right reading order is stated on the picture itself.
  const lanes = LANE_ORDER
    .filter((lane) => resolved.nodes.some((n) => n.lane === lane))
    .map((lane, i) => text(lane, {
      class: 'carto-lane',
      x: LAYOUT.margin + i * LANE_PITCH,
      y: LANE_LABEL_Y,
      'font-size': FONT.lane,
      'font-weight': '600',
      fill: 'currentColor',
      'fill-opacity': '0.55',
    }))
    .join('');

  const edges = resolved.edges
    .map((edge) => renderEdge(edge, plan.routes.get(edge.id), markerId, width))
    .join('');
  const nodes = resolved.nodes
    .map((node) => renderNode(node, boxes.get(node.id), resolved.drift.get(node.id)))
    .join('');

  const sentence = driftSentence(resolved.drift, resolved.nodes.length);
  const lanesRead = LANE_ORDER.join(' → ');
  const ariaLabel = `${resolved.title} — a lane diagram of ${resolved.nodes.length} nodes and `
    + `${resolved.edges.length} edges, in lanes ${lanesRead}. ${sentence}`;
  const caption = `${resolved.title}. Lanes run ${lanesRead}. ${sentence} Drift is drawn on the map: `
    + 'dashed and muted is phantom, a badge is undocumented, the warning accent is stale, dotted is '
    + 'unverified.';

  return '<figure class="carto-figure carto-hero">'
    + `<svg class="carto-hero__svg" viewBox="0 0 ${width} ${canvasHeight}" preserveAspectRatio="xMidYMid meet"`
    + ' role="img" font-family="system-ui, sans-serif"'
    + ` aria-label="${escapeXml(ariaLabel)}">`
    + marker
    + `<g class="carto-lanes">${lanes}</g>`
    + `<g class="carto-edges">${edges}</g>`
    + `<g class="carto-nodes">${nodes}</g>`
    + '</svg>'
    + `<figcaption>${escapeXml(caption)}</figcaption>`
    + '</figure>';
}
