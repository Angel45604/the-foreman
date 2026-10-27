import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeDrift } from './diff.mjs';
import { DRIFT_SEVERITY } from './layout.mjs';
import { renderHero, escapeXml, textWidth } from './svg.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, 'fixtures', 'tiny.map.json');
const loadMap = () => JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
const viewOf = (map, id) => map.views.find((v) => v.id === id);

/** The fixture, rendered exactly as the pipeline renders it — no test-only mutation. */
function renderFixture() {
  const map = loadMap();
  const { findings } = computeDrift(map);
  return renderHero(viewOf(map, 'overview'), map, findings);
}

/** One node's `<g>` block. The groups do not nest, so a non-greedy match is exact. */
function groupOf(svg, nodeId) {
  const re = new RegExp(`<g[^>]*data-node="${nodeId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>([\\s\\S]*?)</g>`);
  const m = re.exec(svg);
  assert.ok(m, `no rendered group for node ${nodeId}`);
  return m[0];
}

/** The node box's presentation attributes, with geometry stripped so styles compare across nodes. */
function boxStyle(svg, nodeId) {
  const m = /<rect[^>]*class="carto-node__box"[^>]*\/>/.exec(groupOf(svg, nodeId));
  assert.ok(m, `node ${nodeId} has no box`);
  return m[0].replace(/\s(?:x|y|width|height)="[^"]*"/g, '');
}

const attr = (tag, name) => (new RegExp(`\\s${name}="([^"]*)"`).exec(tag) ?? [])[1];

/**
 * ADR C-018 — what a synthetic must carry before UNDOCUMENTED can fire on it, in two halves.
 *
 * Completeness is DERIVED, by comparing a node's `searched` against the map's own declared
 * `role: "doc"` sources. A map declaring none puts every node in state 3 — nowhere to look is not the
 * same as nothing to find — and a node with no record is state 3 on its own. A THIRD statement is
 * needed too: `coverage.read` is where the map says it opened the surface IN FULL, and a harvest of a
 * file the map does not classify as read is state 3 as well. No one of the three alone reaches state
 * 2, which is why all three appear together everywhere below.
 */
const DOC_SOURCES = [{ path: 'a/SKILL.md', role: 'doc' }, { path: 'a/run.sh', role: 'code' }];
const HARVESTED = { searched: ['a/SKILL.md'], candidates: [] };
const READ_IN_FULL = { read: ['a/SKILL.md', 'a/run.sh'], partial: [], skipped: [] };

/** A map with one node per drift class, so all four treatments can be compared side by side. */
function fourClassMap() {
  const cite = (line, note) => ({ path: 'a/run.sh', line, note });
  return {
    sources: DOC_SOURCES,
    coverage: READ_IN_FULL,
    nodes: [
      { id: 'mode.ghost', kind: 'mode', label: 'ghost', lane: 'entry', inferred: false, evidence: [],
        claims: [{ path: 'a/SKILL.md', line: 4, text: '`ghost` runs the thing.', claimKind: 'doc', checked: true }] },
      { id: 'flag.maybe', kind: 'flag', label: '--maybe', lane: 'core', inferred: false, evidence: [],
        claims: [{ path: 'a/SKILL.md', line: 5, text: '`--maybe` may do something.', claimKind: 'doc', checked: false }] },
      { id: 'outcome.wrong', kind: 'outcome', label: 'WRONG', lane: 'output', inferred: false,
        evidence: [cite(9, "printf 'WRONG\\n' >&2")],
        claims: [{ path: 'a/SKILL.md', line: 6, text: 'WRONG goes to stdout.', claimKind: 'doc', checked: true }],
        contradictions: [{
          claim: { path: 'a/SKILL.md', line: 6, text: 'WRONG goes to stdout.' },
          evidence: cite(9, "printf 'WRONG\\n' >&2"),
          statement: 'The doc says WRONG goes to stdout; the code writes it to stderr.',
        }] },
      { id: 'env.hidden', kind: 'env', label: 'HIDDEN', lane: 'external', inferred: false,
        docHarvest: HARVESTED,
        evidence: [cite(3, 'HIDDEN=1')],
        claims: [{ path: 'a/run.sh', line: 2, text: '# HIDDEN toggles it', claimKind: 'code-comment', checked: true }] },
    ],
    edges: [],
    views: [{
      id: 'overview', form: 'svg-hero', title: 'four classes', edges: [],
      nodes: ['env.hidden', 'flag.maybe', 'mode.ghost', 'outcome.wrong'],
    }],
  };
}

const renderFour = () => {
  const map = fourClassMap();
  return renderHero(map.views[0], map, computeDrift(map).findings);
};

// ─── structure ───────────────────────────────────────────────────────────────────────────────────

test('1 · a <figure>-wrapped <svg>, sized by viewBox, with role="img", aria-label and a <figcaption>', () => {
  const svg = renderFixture();
  assert.match(svg, /^<figure\b/);
  assert.match(svg, /<\/figure>$/);
  const open = /<svg\b[^>]*>/.exec(svg)[0];
  assert.match(attr(open, 'viewBox'), /^0 0 \d+ \d+$/, 'the hero is sized by its viewBox');
  assert.equal(attr(open, 'role'), 'img');
  assert.ok(attr(open, 'aria-label').length > 0, 'an aria-label is required, not optional');
  assert.match(svg, /<figcaption>[\s\S]*<\/figcaption>/);
  assert.match(svg, /<defs><marker\b|<defs>\s*<marker\b/);

  // The viewBox must be the layout's own bounds, or boxes are drawn outside the canvas.
  const [, , w, h] = attr(open, 'viewBox').split(' ').map(Number);
  for (const rect of svg.matchAll(/<rect[^>]*class="carto-node__box"[^>]*\/>/g)) {
    assert.ok(Number(attr(rect[0], 'x')) + Number(attr(rect[0], 'width')) <= w);
    assert.ok(Number(attr(rect[0], 'y')) + Number(attr(rect[0], 'height')) <= h);
  }
});

test('2 · every node in the view is labelled, and every edge is drawn WITH its label', () => {
  const map = loadMap();
  const view = viewOf(map, 'overview');
  const svg = renderFixture();

  for (const id of view.nodes) {
    const group = groupOf(svg, id);
    const label = map.nodes.find((n) => n.id === id).label;
    assert.ok(group.includes(`>${escapeXml(label)}<`), `node ${id} is not labelled with "${label}"`);
  }

  const markerId = /<marker[^>]*id="([^"]+)"/.exec(svg)[1];
  for (const id of view.edges) {
    const edge = map.edges.find((e) => e.id === id);
    // Edge ids contain `>`, which MUST already be escaped in the attribute — so the id is escaped
    // first and regex-quoted second. Matching the raw id would mean the renderer had emitted a bare
    // `>` inside an attribute, which is the injection this escaping exists to prevent.
    const block = new RegExp(`<g[^>]*data-edge="${escapeXml(id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>([\\s\\S]*?)</g>`)
      .exec(svg);
    assert.ok(!svg.includes(`data-edge="${id}"`), `edge id ${id} must be escaped in the attribute`);
    assert.ok(block, `edge ${id} is not drawn`);
    assert.match(block[0], new RegExp(`marker-end="url\\(#${markerId}\\)"`), `edge ${id} has no arrowhead`);
    assert.ok(block[0].includes(`>${escapeXml(edge.label)}<`),
      `edge ${id} is drawn without its label "${edge.label}" — an unlabelled arrow says only "related somehow"`);
  }
  assert.equal([...svg.matchAll(/data-edge="/g)].length, view.edges.length);
});

// ─── drift renders ON the map (PDR §6.2) ─────────────────────────────────────────────────────────

test('3 · PHANTOM is dashed and muted, UNDOCUMENTED is badged, STALE takes the warning accent', () => {
  const svg = renderFixture();

  const phantom = boxStyle(svg, 'mode.build');
  assert.ok(attr(phantom, 'stroke-dasharray'), 'PHANTOM must be dashed');
  const clean = boxStyle(svg, 'component.tiny_core');
  assert.equal(attr(clean, 'stroke-dasharray'), undefined, 'a clean node is not dashed');
  assert.notEqual(attr(phantom, 'fill-opacity'), attr(clean, 'fill-opacity'), 'PHANTOM must be muted');

  const undocumented = groupOf(svg, 'env.tiny_debug');
  assert.match(undocumented, /class="carto-badge"/, 'UNDOCUMENTED must carry a badge');
  assert.equal(attr(boxStyle(svg, 'env.tiny_debug'), 'stroke-dasharray'), undefined,
    'UNDOCUMENTED is a SOLID outline with a badge');

  const stale = boxStyle(svg, 'mode.check');
  assert.notEqual(attr(stale, 'stroke'), attr(clean, 'stroke'), 'STALE must take the warning accent');
  assert.match(attr(stale, 'stroke'), /var\(--/, 'the accent is themeable, not a bare literal');

  // The classes are named in text as well as drawn, so the picture is readable without the legend.
  assert.match(groupOf(svg, 'mode.build'), /<title>[^<]*PHANTOM/);
  assert.match(groupOf(svg, 'mode.check'), /<title>[^<]*STALE/);
});

test('4 · UNVERIFIED is visually distinct too — all four treatments differ pairwise', () => {
  const svg = renderFour();
  const styles = {
    STALE: boxStyle(svg, 'outcome.wrong'),
    PHANTOM: boxStyle(svg, 'mode.ghost'),
    UNDOCUMENTED: boxStyle(svg, 'env.hidden'),
    UNVERIFIED: boxStyle(svg, 'flag.maybe'),
  };
  for (const a of DRIFT_SEVERITY) {
    for (const b of DRIFT_SEVERITY) {
      if (a < b) assert.notEqual(styles[a], styles[b], `${a} and ${b} draw identically`);
    }
  }
  // …and distinct from a node with no drift at all.
  const cleanMap = loadMap();
  const cleanSvg = renderHero(viewOf(cleanMap, 'overview'), cleanMap, computeDrift(cleanMap).findings);
  for (const cls of DRIFT_SEVERITY) {
    assert.notEqual(styles[cls], boxStyle(cleanSvg, 'component.tiny_core'), `${cls} draws as clean`);
  }
  assert.match(groupOf(svg, 'flag.maybe'), /UNVERIFIED/, 'UNVERIFIED must be named, not only drawn');
});

test('5 · a node carrying TWO classes takes the worst style and still names BOTH', () => {
  // Family (A) UNDOCUMENTED and family (B) STALE fire independently on the same node.
  const map = {
    sources: DOC_SOURCES, // ADR C-018 — declared, classified read, and searched below.
    coverage: READ_IN_FULL,
    nodes: [{
      id: 'env.both', kind: 'env', label: 'BOTH', lane: 'core', inferred: false,
      docHarvest: HARVESTED,
      evidence: [{ path: 'a/run.sh', line: 3, note: 'BOTH=1' }],
      claims: [{ path: 'a/run.sh', line: 2, text: '# BOTH defaults to 0', claimKind: 'code-comment', checked: true }],
      contradictions: [{
        claim: { path: 'a/run.sh', line: 2, text: '# BOTH defaults to 0' },
        evidence: { path: 'a/run.sh', line: 3, note: 'BOTH=1' },
        statement: 'The comment says BOTH defaults to 0; the code sets it to 1.',
      }],
    }],
    edges: [],
    views: [{ id: 'overview', form: 'svg-hero', title: 'two classes', nodes: ['env.both'], edges: [] }],
  };
  const { findings } = computeDrift(map);
  assert.deepEqual(findings.map((f) => f.class).sort(), ['STALE', 'UNDOCUMENTED']);

  const svg = renderHero(map.views[0], map, findings);
  const group = groupOf(svg, 'env.both');
  const title = /<title>([^<]*)<\/title>/.exec(group)[1];
  assert.match(title, /STALE/, 'the worst class must be named');
  assert.match(title, /UNDOCUMENTED/, 'the second class must NOT be silently dropped');

  // One box, one style — and it is the worst one.
  const four = renderFour();
  assert.equal(boxStyle(svg, 'env.both'), boxStyle(four, 'outcome.wrong'), 'STALE outranks UNDOCUMENTED');
  assert.notEqual(boxStyle(svg, 'env.both'), boxStyle(four, 'env.hidden'));
  assert.equal([...group.matchAll(/class="carto-badge"/g)].length, 1, 'one box wears one badge');
  // The accessible label carries both classes too, so the picture is not the only place they appear.
  assert.match(/aria-label="([^"]*)"/.exec(svg)[1], /STALE/);
  assert.match(/aria-label="([^"]*)"/.exec(svg)[1], /UNDOCUMENTED/);
});

// ─── host independence: theme-safe, CSP-safe, injection-safe ─────────────────────────────────────

test('6 · theme-safe — currentColor and CSS variables, never a hardcoded black or white', () => {
  const svg = renderFixture();
  assert.match(svg, /currentColor/);
  assert.match(svg, /var\(--carto-[a-z-]+, #[0-9a-f]{6}\)/, 'accents are variables with a non-mono fallback');
  assert.doesNotMatch(svg, /#(?:000|fff|000000|ffffff)\b/i);
  assert.doesNotMatch(svg, /\b(?:black|white)\b/i);
});

test('7 · CSP-safe — no script, style, foreignObject, image, xlink or absolute URL anywhere', () => {
  for (const svg of [renderFixture(), renderFour()]) {
    for (const banned of ['<script', '<style', '<foreignObject', '<image', 'xlink:', 'http://', 'https://']) {
      assert.ok(!svg.includes(banned), `the hero must not contain ${banned}`);
    }
    // An inline SVG inherits the SVG namespace from HTML; a literal xmlns would smuggle in a URL.
    assert.ok(!svg.includes('xmlns'), 'no xmlns — it is the one attribute that carries a URL');
  }
});

test('8 · source-derived text cannot form markup — in text content OR in an attribute', () => {
  const map = loadMap();
  map.nodes = map.nodes.map((n) => (n.id === 'mode.build'
    ? { ...n, label: '<img src=x onerror="alert(1)"> & "quoted"' } : n));
  const view = { ...viewOf(map, 'overview'), title: 'tiny — <b>"overview"</b> & more' };

  const svg = renderHero(view, map, computeDrift(map).findings);
  assert.ok(!svg.includes('<img'), 'an escape that leaves `<img` intact is not an escape');
  assert.ok(!svg.includes('<b>'));
  assert.match(svg, /&lt;img/);
  assert.match(svg, /&amp;/);
  assert.match(svg, /&quot;/);

  // The attribute the title lands in must still parse: no bare quote inside aria-label.
  const ariaLabel = /aria-label="([^"]*)"/.exec(svg)[1];
  assert.match(ariaLabel, /&lt;b&gt;/);
  assert.ok(!ariaLabel.includes('"'));
  assert.equal(escapeXml('<&>"'), '&lt;&amp;&gt;&quot;');
  assert.equal(escapeXml('&amp;'), '&amp;amp;', 'ampersands escape first, or the escape double-decodes');
});

// ─── fail closed ─────────────────────────────────────────────────────────────────────────────────

test('9 · never renders a placeholder for missing data', () => {
  const svg = renderFixture();
  assert.ok(!/undefined|NaN|\[object Object\]|null:/.test(svg), 'no stand-in for a value it never had');

  const map = loadMap();
  // Wrong renderer for the view: a mermaid view is not a hero.
  assert.throws(() => renderHero(viewOf(map, 'control-flow'), map, []), /svg-hero|form/);
  assert.throws(() => renderHero(viewOf(map, 'capabilities'), map, []), /svg-hero|form/);
  // The hero bound is enforced through the hero, not only through layoutHero.
  const big = { ...map, nodes: [], views: [] };
  big.nodes = Array.from({ length: 16 }, (_, i) => ({
    id: `mode.m${i}`, kind: 'mode', label: `m${i}`, lane: 'entry', inferred: true, evidence: [], claims: [],
  }));
  const bigView = { id: 'overview', form: 'svg-hero', title: 'too big', nodes: big.nodes.map((n) => n.id), edges: [] };
  assert.throws(() => renderHero(bigView, big, []), /C-002|collapse/i);
});

test('10 · a self-edge is drawn and labelled rather than dropped or drawn as NaN', () => {
  const map = {
    nodes: [{ id: 'component.loop', kind: 'component', label: 'loop', lane: 'core', inferred: false,
      evidence: [{ path: 'a/run.sh', line: 1, note: 'loop()' }],
      claims: [{ path: 'a/SKILL.md', line: 1, text: 'loop recurses.', claimKind: 'doc', checked: true }] }],
    edges: [{ id: 'e.control.component.loop>component.loop', from: 'component.loop', to: 'component.loop',
      kind: 'control', label: 'recurses', evidence: [{ path: 'a/run.sh', line: 2, note: 'loop' }] }],
    views: [{ id: 'overview', form: 'svg-hero', title: 'self', nodes: ['component.loop'],
      edges: ['e.control.component.loop>component.loop'] }],
  };
  const svg = renderHero(map.views[0], map, computeDrift(map).findings);
  assert.match(svg, /data-edge="e\.control\.component\.loop&gt;component\.loop"/);
  assert.ok(svg.includes('>recurses<'), 'a self-edge is labelled like any other');
  assert.ok(!/NaN|undefined/.test(svg));

  // …and it stays on the canvas.
  const [, , w, h] = /viewBox="([^"]*)"/.exec(svg)[1].split(' ').map(Number);
  for (const n of [...svg.matchAll(/[ML] (-?[\d.]+) (-?[\d.]+)/g)]) {
    assert.ok(Number(n[1]) >= 0 && Number(n[1]) <= w, `path x ${n[1]} is off-canvas`);
    assert.ok(Number(n[2]) >= 0 && Number(n[2]) <= h, `path y ${n[2]} is off-canvas`);
  }
});

test('11 · deterministic, and it never mutates or aliases the map or the findings', () => {
  const map = loadMap();
  const { findings } = computeDrift(map);
  const mapBefore = JSON.stringify(map);
  const findingsBefore = JSON.stringify(findings);

  const once = renderHero(viewOf(map, 'overview'), map, findings);
  const twice = renderHero(viewOf(map, 'overview'), map, findings);
  assert.equal(twice, once);

  const shuffled = {
    ...map,
    nodes: [...map.nodes].reverse(),
    edges: [...map.edges].reverse(),
  };
  assert.equal(renderHero(viewOf(map, 'overview'), shuffled, [...findings].reverse()), once,
    'extractor order must not leak into the picture');

  assert.equal(JSON.stringify(map), mapBefore);
  assert.equal(JSON.stringify(findings), findingsBefore);
});

test('12 · findings is REQUIRED — a drifting map may not render as clean because nobody said', () => {
  const map = loadMap();
  const view = viewOf(map, 'overview');
  const { findings } = computeDrift(map);
  assert.ok(findings.length > 0, 'the fixture must drift, or this test proves nothing');

  // Omitting the argument used to render the reassuring lie: a hero that SAYS there is no drift and
  // draws none, on a map that has three drifting nodes.
  assert.throws(() => renderHero(view, map), /findings/,
    'a two-argument hero must fail closed rather than default to "no drift"');
  assert.throws(() => renderHero(view, map, undefined), /findings/);

  const truthful = renderHero(view, map, findings);
  assert.ok(!truthful.includes('No drift was found'), 'the drifting fixture must not claim to be clean');
  assert.match(truthful, /carto-node--/, 'and it must carry drift styling');

  // An explicit [] is a caller ASSERTING the view is clean — still legal, and visibly different.
  const asserted = renderHero(view, map, []);
  assert.ok(asserted.includes('No drift was found'));
  assert.doesNotMatch(asserted, /carto-node--/);
});

// ─── every caption stays on the canvas ───────────────────────────────────────────────────────────

const decodeXml = (s) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&amp;/g, '&');                 // last, or an escaped entity double-decodes

/**
 * Every `<text>` the hero emits, with its WORST-CASE horizontal extent.
 *
 * There is no font engine in a test, so the extent is computed from a STATED upper bound on glyph
 * advances — and from `svg.mjs`'s own exported `textWidth`, not from a restatement of it. A test
 * that carries its own copy of the model is a second source of truth for the same physical claim,
 * and the two can then disagree about whether a caption fits: the renderer would place text by one
 * model while the test blessed it by another, which is the artifact-vs-artifact drift this skill
 * exists to detect (ADR C-006), aimed at render geometry instead of the IR.
 *
 * What the model itself promises — that it never UNDER-states real ink — is not assumed here; it is
 * pinned separately by test 19, which is what keeps this shared reading from being circular.
 */
function captions(svg) {
  const [, , width, height] = /viewBox="([^"]*)"/.exec(svg)[1].split(' ').map(Number);
  const texts = [...svg.matchAll(/<text([^>]*)>([^<]*)<\/text>/g)].map((m) => {
    const tag = `<text${m[1]}>`;
    const body = decodeXml(m[2]);
    const fontSize = Number(attr(tag, 'font-size'));
    const x = Number(attr(tag, 'x'));
    const ink = textWidth(body, fontSize);
    const anchor = attr(tag, 'text-anchor') ?? 'start';
    const left = anchor === 'middle' ? x - ink / 2 : anchor === 'end' ? x - ink : x;
    return { body, left, right: left + ink, y: Number(attr(tag, 'y')), fontSize };
  });
  return { width, height, texts };
}

/** A map whose node and edge labels are far wider than the boxes the layout reserves for them. */
const LONG = 'orchestrate the entire dispatch table end to end, twice, with feeling';
function longLabelMap() {
  const cite = (line, note) => ({ path: 'a/run.sh', line, note });
  const n = (id, label, lane) => ({
    id, kind: id.split('.')[0], label, lane, inferred: false, evidence: [cite(1, id)],
    claims: [{ path: 'a/SKILL.md', line: 1, text: `${id} exists.`, claimKind: 'doc', checked: true }],
  });
  const e = (from, to, line) => ({ id: `e.control.${from}>${to}`, from, to, kind: 'control',
    label: LONG, evidence: [cite(line, 'edge')] });
  return {
    nodes: [n('mode.long', LONG, 'entry'), n('component.long', `${LONG} and then some`, 'core')],
    edges: [e('mode.long', 'component.long', 2), e('component.long', 'component.long', 3)],
    views: [{ id: 'overview', form: 'svg-hero', title: 'long labels',
      nodes: ['component.long', 'mode.long'],
      edges: ['e.control.component.long>component.long', 'e.control.mode.long>component.long'] }],
  };
}

test('13 · a label far wider than its box stays ON the canvas, and its full text is not lost', () => {
  const map = longLabelMap();
  const svg = renderHero(map.views[0], map, computeDrift(map).findings);
  const { width, height, texts } = captions(svg);
  assert.ok(texts.length >= 6, 'labels, kinds and edge captions must all be present');

  for (const t of texts) {
    assert.ok(t.left >= 0 && t.right <= width,
      `"${t.body}" spans ${t.left}…${t.right}, outside the 0…${width} canvas — it would be clipped`);
    assert.ok(t.y >= t.fontSize && t.y <= height, `"${t.body}" sits at y ${t.y}, off a ${height}-unit canvas`);
  }
  assert.ok(texts.some((t) => t.body.endsWith('…')),
    'something must actually have been cut, or this test proves nothing');

  // Nothing is LOST: the full text stays recoverable from the <title> both renderers already write.
  assert.ok(groupOf(svg, 'component.long').includes(escapeXml(`${LONG} and then some`)),
    'the node <title> must still carry the whole label');
  assert.ok(svg.includes(escapeXml(`${LONG}`)), 'the edge <title> must still carry the whole label');
  assert.ok(!/undefined|NaN/.test(svg));

  // The captions of the ordinary maps stay on the canvas too — including badges and lane captions.
  for (const other of [renderFixture(), renderFour()]) {
    const shown = captions(other);
    for (const t of shown.texts) {
      assert.ok(t.left >= 0 && t.right <= shown.width, `"${t.body}" spans ${t.left}…${t.right} of ${shown.width}`);
      assert.ok(t.y >= t.fontSize && t.y <= shown.height, `"${t.body}" sits at y ${t.y}`);
    }
  }
});

// ─── edges are legible: parallel edges separate, nothing runs through an unrelated box ───────────

/** Every node box actually drawn, keyed by node id, with the geometry it was drawn at. */
function nodeBoxes(svg) {
  const boxes = new Map();
  for (const g of svg.matchAll(/<g[^>]*data-node="([^"]*)"[^>]*>([\s\S]*?)<\/g>/g)) {
    const rect = /<rect[^>]*class="carto-node__box"[^>]*\/>/.exec(g[2]);
    assert.ok(rect, `node ${g[1]} has no box`);
    boxes.set(decodeXml(g[1]), {
      id: decodeXml(g[1]),
      x: Number(attr(rect[0], 'x')),
      y: Number(attr(rect[0], 'y')),
      w: Number(attr(rect[0], 'width')),
      h: Number(attr(rect[0], 'height')),
    });
  }
  return boxes;
}

/**
 * A caption's worst-case bounding box. The horizontal model is `captions()`'s — `svg.mjs`'s own
 * exported `textWidth`, so the placement and the check read one model. Vertically, a `<text>` at
 * baseline `y` puts its ascenders about one em above it and its descenders a quarter em below.
 */
function captionBox(tag, body) {
  const fontSize = Number(attr(tag, 'font-size'));
  const x = Number(attr(tag, 'x'));
  const ink = textWidth(body, fontSize);
  const anchor = attr(tag, 'text-anchor') ?? 'start';
  const left = anchor === 'middle' ? x - ink / 2 : anchor === 'end' ? x - ink : x;
  const y = Number(attr(tag, 'y'));
  return { body, x: left, y: y - fontSize, w: ink, h: fontSize * 1.25 };
}

/**
 * Every `<text>` the hero draws, as a worst-case box, tagged with the class it carries.
 *
 * The lane headings are captions like any other and occupy real ink at real coordinates, so they
 * belong in the same sweep as the boxes: "no caption lands on a box" checked only half of what a
 * reader can collide with, and the half it left out is the one strip of the canvas a box never
 * occupies — which is exactly where a self-edge's caption is placed.
 */
function captionBoxes(svg) {
  return [...svg.matchAll(/<text([^>]*)>([^<]*)<\/text>/g)].map((m) => {
    const tag = `<text${m[1]}>`;
    return { ...captionBox(tag, decodeXml(m[2])), cls: attr(tag, 'class') ?? '' };
  });
}

const laneHeadings = (svg) => captionBoxes(svg).filter((c) => c.cls === 'carto-lane');

/** Every edge group: its id, its path `d`, and the bounding boxes of its captions. */
function edgeParts(svg) {
  return [...svg.matchAll(/<g[^>]*data-edge="([^"]*)"[^>]*>([\s\S]*?)<\/g>/g)].map((g) => {
    const path = /<path[^>]*\/>/.exec(g[2]);
    assert.ok(path, `edge ${g[1]} has no path`);
    return {
      id: decodeXml(g[1]),
      d: attr(path[0], 'd'),
      captions: [...g[2].matchAll(/<text([^>]*)>([^<]*)<\/text>/g)]
        .map((t) => captionBox(`<text${t[1]}>`, decodeXml(t[2]))),
    };
  });
}

const point = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/** A path `d` as a polyline. A cubic is sampled, so a curve is checked like any other run of ink. */
function polyline(d) {
  const tok = d.trim().split(/\s+/);
  const num = () => { const v = Number(tok[i]); i += 1; assert.ok(Number.isFinite(v), `bad number in ${d}`); return v; };
  const pts = [];
  let i = 0;
  let cur = null;
  while (i < tok.length) {
    const op = tok[i];
    i += 1;
    if (op === 'M' || op === 'L') {
      cur = { x: num(), y: num() };
      pts.push(cur);
    } else if (op === 'C') {
      const c1 = { x: num(), y: num() };
      const c2 = { x: num(), y: num() };
      const end = { x: num(), y: num() };
      for (let s = 1; s <= 24; s += 1) {
        const t = s / 24;
        const [a, b, c] = [point(cur, c1, t), point(c1, c2, t), point(c2, end, t)];
        pts.push(point(point(a, b, t), point(b, c, t), t));
      }
      cur = end;
    } else {
      assert.fail(`unhandled path command ${op} in ${d} — the overlap check would silently skip it`);
    }
  }
  return pts;
}

/**
 * Liang–Barsky: does the segment p→q pass through the box's INTERIOR?
 *
 * Interior, deliberately: an edge that STARTS on the box it connects touches that box's boundary at
 * exactly one point, and a run of ink along a boundary is a different (and here, absent) concern.
 */
function crossesBox(p, q, box) {
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  let t0 = 0;
  let t1 = 1;
  for (const [pi, qi] of [
    [-dx, p.x - box.x], [dx, box.x + box.w - p.x],
    [-dy, p.y - box.y], [dy, box.y + box.h - p.y],
  ]) {
    if (pi === 0) {
      if (qi < 0) return false;
    } else if (pi < 0) {
      t0 = Math.max(t0, qi / pi);
    } else {
      t1 = Math.min(t1, qi / pi);
    }
  }
  return t1 - t0 > 1e-9;
}

const rectsOverlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** A lane map with parallel edges, a same-lane skip, and a long leftward run, all in one picture. */
function stressMap() {
  const cite = (line, note) => ({ path: 'a/run.sh', line, note });
  const n = (id, lane) => ({
    id, kind: id.split('.')[0], label: id.split('.')[1], lane, inferred: false,
    evidence: [cite(1, id)],
    claims: [{ path: 'a/SKILL.md', line: 1, text: `${id} exists.`, claimKind: 'doc', checked: true }],
  });
  const e = (kind, from, to, label) => ({
    id: `e.${kind}.${from}>${to}`, from, to, kind, label, evidence: [cite(2, 'edge')],
  });
  const nodes = [n('mode.a', 'entry'), n('mode.b', 'entry'), n('mode.c', 'entry'),
    n('component.x', 'core'), n('component.y', 'core'),
    n('outcome.o', 'output'), n('env.e', 'external')];
  const edges = [
    // three PARALLEL edges between one pair — the fixture's defect, tripled
    e('control', 'mode.a', 'component.x', 'calls'),
    e('data', 'mode.a', 'component.x', 'passes the mode name'),
    e('doc', 'mode.a', 'component.x', 'is documented as calling'),
    // a same-lane skip: the straight line runs clean through mode.b
    e('control', 'mode.a', 'mode.c', 'falls through to'),
    // two lane-skipping runs, one of them right to left across the whole picture
    e('control', 'mode.a', 'outcome.o', 'emits'),
    e('data', 'component.x', 'env.e', 'reads'),
    e('control', 'env.e', 'mode.b', 'switches on'),
    // a SELF edge on a box that is not in the top row: its caption sits in the band of empty space
    // above the box, which a SHORTER neighbouring lane's centred box reaches straight into
    e('control', 'mode.b', 'mode.b', 'loops back into itself'),
  ];
  return {
    nodes,
    edges,
    views: [{ id: 'overview', form: 'svg-hero', title: 'stress', nodes: nodes.map((x) => x.id).sort(),
      edges: edges.map((x) => x.id).sort() }],
  };
}

/**
 * One node carrying TWO self-edges of different kinds — the parallel-edge defect, in the one shape
 * the route planner used to special-case out of the allocation entirely.
 *
 * The entry lane carries TWO nodes so that the single `core` node is CENTRED below the top row, and
 * the loop over its top edge is therefore available. That is deliberate rather than incidental: the
 * route this test exists to check is "the first self-edge takes the loop and the rest fall through
 * to their own band rows", and a top-row node has no loop to take — the lane heading owns the strip
 * above it — so with one entry node both self-edges would band and the fall-through would go
 * unexercised while every assertion below still passed.
 */
function twoSelfEdgeMap() {
  const cite = (line, note) => ({ path: 'a/run.sh', line, note });
  const e = (kind, label, line) => ({
    id: `e.${kind}.component.loop>component.loop`,
    from: 'component.loop', to: 'component.loop', kind, label, evidence: [cite(line, 'edge')],
  });
  const nodes = [
    { id: 'mode.run', kind: 'mode', label: 'run', lane: 'entry', inferred: false,
      evidence: [cite(1, 'mode_run() {')],
      claims: [{ path: 'a/SKILL.md', line: 1, text: '`run` exists.', claimKind: 'doc', checked: true }] },
    { id: 'mode.warm', kind: 'mode', label: 'warm', lane: 'entry', inferred: false,
      evidence: [cite(6, 'mode_warm() {')],
      claims: [{ path: 'a/SKILL.md', line: 6, text: '`warm` exists.', claimKind: 'doc', checked: true }] },
    { id: 'component.loop', kind: 'component', label: 'loop', lane: 'core', inferred: false,
      evidence: [cite(2, 'loop() {')],
      claims: [{ path: 'a/SKILL.md', line: 2, text: '`loop` recurses.', claimKind: 'doc', checked: true }] },
  ];
  const edges = [
    { id: 'e.control.mode.run>component.loop', from: 'mode.run', to: 'component.loop',
      kind: 'control', label: 'calls', evidence: [cite(3, 'loop')] },
    e('control', 'recurses into itself', 4),
    e('data', 'feeds its own output back', 5),
  ];
  return {
    nodes,
    edges,
    views: [{ id: 'overview', form: 'svg-hero', title: 'two self-edges',
      nodes: nodes.map((n) => n.id).sort(), edges: edges.map((x) => x.id).sort() }],
  };
}

/**
 * Labels built to break the WIDTH MODEL rather than the layout: a run of the narrowest glyph in the
 * table, a run of the widest, and a run of code points the table does not map at all. A tight model
 * earns its keep on the first and must not be fooled by the last.
 */
function awkwardLabelMap() {
  const cite = (line, note) => ({ path: 'a/run.sh', line, note });
  const n = (id, label, lane) => ({
    id, kind: id.split('.')[0], label, lane, inferred: false, evidence: [cite(1, id)],
    claims: [{ path: 'a/SKILL.md', line: 1, text: `${id} exists.`, claimKind: 'doc', checked: true }],
  });
  const nodes = [
    n('mode.narrow', 'i'.repeat(60), 'entry'),
    n('component.widest', 'W'.repeat(40), 'core'),
    n('outcome.unmapped', '\u6f22\u5b57'.repeat(20), 'output'),
    n('env.emoji', '\u{1F600}'.repeat(20), 'external'),
  ];
  const edges = [{
    id: 'e.control.mode.narrow>component.widest',
    from: 'mode.narrow', to: 'component.widest', kind: 'control',
    label: 'illllliiiitttt \u{1F600} \u6f22\u5b57 WWWWWW', evidence: [cite(2, 'edge')],
  }];
  return {
    nodes,
    edges,
    views: [{ id: 'overview', form: 'svg-hero', title: 'awkward labels',
      nodes: nodes.map((x) => x.id).sort(), edges: edges.map((x) => x.id) }],
  };
}

/**
 * A self-edge on a node in the TOP ROW — the one place a self-loop reaches into the strip the lane
 * headings occupy. Two lanes of one node each, so both boxes sit against the top of the canvas and
 * the `core` heading is drawn directly above the self-edge's own box.
 */
function topRowSelfEdgeMap() {
  const cite = (line, note) => ({ path: 'a/run.sh', line, note });
  const n = (id, label, lane) => ({
    id, kind: id.split('.')[0], label, lane, inferred: false, evidence: [cite(1, id)],
    claims: [{ path: 'a/SKILL.md', line: 1, text: `${id} exists.`, claimKind: 'doc', checked: true }],
  });
  const nodes = [n('mode.start', 'start', 'entry'), n('component.hub', 'hub', 'core')];
  const edges = [
    { id: 'e.control.mode.start>component.hub', from: 'mode.start', to: 'component.hub',
      kind: 'control', label: 'hands off to', evidence: [cite(2, 'edge')] },
    { id: 'e.control.component.hub>component.hub', from: 'component.hub', to: 'component.hub',
      kind: 'control', label: 'reschedules itself until the queue drains', evidence: [cite(3, 'edge')] },
  ];
  return {
    nodes,
    edges,
    views: [{ id: 'overview', form: 'svg-hero', title: 'a top-row self edge',
      nodes: nodes.map((x) => x.id).sort(), edges: edges.map((x) => x.id).sort() }],
  };
}

/** Every hero this suite can draw, each with the map and the view it came from. */
function heroes() {
  const fixture = loadMap();
  return [
    ['the fixture', fixture, viewOf(fixture, 'overview')],
    ['four drift classes', fourClassMap(), null],
    ['long labels', longLabelMap(), null],
    ['parallel, same-lane and lane-skipping edges', stressMap(), null],
    ['two self-edges on one node', twoSelfEdgeMap(), null],
    ['a self-edge on a TOP-ROW node', topRowSelfEdgeMap(), null],
    ['labels that stress the width model', awkwardLabelMap(), null],
  ].map(([what, map, view]) => {
    const hero = view ?? map.views[0];
    return [what, map, hero, renderHero(hero, map, computeDrift(map).findings)];
  });
}

test('14 · PARALLEL edges between one pair are drawn — and captioned — separately', () => {
  const map = loadMap();
  const pair = map.edges.filter((e) => e.from === 'mode.check' && e.to === 'component.tiny_core');
  assert.equal(pair.length, 2, 'the fixture must record a control AND a data edge for this pair');
  assert.notEqual(pair[0].label, pair[1].label, '…saying different things about it');

  const drawn = edgeParts(renderFixture()).filter((e) => pair.some((p) => p.id === e.id));
  assert.equal(drawn.length, 2);
  // Identical paths put two strokes on one line: two recorded relationships, one visible arrow.
  assert.notEqual(drawn[0].d, drawn[1].d, 'parallel edges may not share a path');
  // …and identical caption anchors overprint two labels into unreadable ink, which is worse than
  // either label alone: the reader cannot even tell that two things were said.
  for (const a of drawn[0].captions) {
    for (const b of drawn[1].captions) {
      assert.ok(!rectsOverlap(a, b), `the captions "${a.body}" and "${b.body}" overprint`);
    }
  }

  // The same holds when there are THREE, so the rule is a rule and not a two-case special case.
  const stress = stressMap();
  const many = edgeParts(renderHero(stress.views[0], stress, computeDrift(stress).findings))
    .filter((e) => e.id.endsWith('mode.a>component.x'));
  assert.equal(many.length, 3);
  for (let i = 0; i < many.length; i += 1) {
    for (let j = i + 1; j < many.length; j += 1) {
      assert.notEqual(many[i].d, many[j].d, `${many[i].id} and ${many[j].id} share a path`);
      for (const a of many[i].captions) {
        for (const b of many[j].captions) {
          assert.ok(!rectsOverlap(a, b), `"${a.body}" and "${b.body}" overprint`);
        }
      }
    }
  }
});

test('15 · no edge runs through a box it does not connect, and no caption lands on a box or a lane heading', () => {
  for (const [what, map, view, svg] of heroes()) {
    const boxes = nodeBoxes(svg);
    const byId = new Map(map.edges.map((e) => [e.id, e]));
    const parts = edgeParts(svg);
    assert.equal(parts.length, view.edges.length, `${what}: every edge must still be drawn`);

    // A lane heading is ink a reader reads, sitting in the one strip of canvas no box occupies —
    // so "does this caption land on a box?" cannot see it, and a caption placed in that strip
    // overprints the heading while passing every box check. Swept over EVERY caption the picture
    // draws, not only the edge captions, so the whole class is checked rather than the one shape
    // that reached the strip first.
    const headings = laneHeadings(svg);
    assert.ok(headings.length > 0, `${what}: the lanes must be headed, or this check sweeps nothing`);
    for (const caption of captionBoxes(svg).filter((c) => c.cls !== 'carto-lane')) {
      for (const heading of headings) {
        assert.ok(!rectsOverlap(caption, heading),
          `${what}: the caption "${caption.body}" (${caption.x}…${caption.x + caption.w} at y `
          + `${caption.y}) lands on the "${heading.body}" lane heading `
          + `(${heading.x}…${heading.x + heading.w} at y ${heading.y})`);
      }
    }

    for (const drawn of parts) {
      const edge = byId.get(drawn.id);
      assert.ok(edge, `${what}: ${drawn.id} is not an edge of the map`);
      const pts = polyline(drawn.d);
      assert.ok(pts.length >= 2, `${what}: ${drawn.id} has no path to check`);

      for (const box of boxes.values()) {
        // A caption is READ, so it must sit on the page's background, never on a box's fill — a
        // label inside a box reads as belonging to that box, which is a relationship the map never
        // recorded. This one holds for every box, the endpoints included.
        for (const caption of drawn.captions) {
          assert.ok(!rectsOverlap(caption, box),
            `${what}: the caption "${caption.body}" of ${drawn.id} lands on the box for ${box.id}`);
        }
        // A stroke crossing an uninvolved box makes it ambiguous which pair the arrow joins.
        if (box.id === edge.from || box.id === edge.to) continue;
        for (let i = 1; i < pts.length; i += 1) {
          assert.ok(!crossesBox(pts[i - 1], pts[i], box),
            `${what}: ${drawn.id} (${edge.from} → ${edge.to}) runs through the box for ${box.id}`);
        }
      }
    }
  }
});

test('16 · every hero still fits its own canvas, captions and detours included', () => {
  for (const [what, , , svg] of heroes()) {
    const { width, height, texts } = captions(svg);
    for (const t of texts) {
      assert.ok(t.left >= 0 && t.right <= width, `${what}: "${t.body}" spans ${t.left}…${t.right} of ${width}`);
      assert.ok(t.y >= t.fontSize && t.y <= height, `${what}: "${t.body}" sits at y ${t.y} on a ${height}-unit canvas`);
    }
    for (const edge of edgeParts(svg)) {
      for (const p of polyline(edge.d)) {
        assert.ok(p.x >= 0 && p.x <= width, `${what}: ${edge.id} reaches x ${p.x} on a ${width}-unit canvas`);
        assert.ok(p.y >= 0 && p.y <= height, `${what}: ${edge.id} reaches y ${p.y} on a ${height}-unit canvas`);
      }
    }
    for (const box of nodeBoxes(svg).values()) {
      assert.ok(box.x + box.w <= width && box.y + box.h <= height, `${what}: the box for ${box.id} overflows`);
    }
  }
});

test('17 · two SELF-edges on one node are routed and captioned separately, like any other parallel pair', () => {
  // The route planner special-cased `from === to` BEFORE the slot allocation, so every self-edge on
  // a box got the identical loop over the identical arc and its caption the identical anchor. That
  // is the overprint defect fixed for ordinary parallel edges, surviving in the one shape the fix
  // stepped over: a node with a `control` and a `data` self-edge draws one visible arrow and one
  // smear of ink, and the reader cannot even tell that two things were said.
  const map = twoSelfEdgeMap();
  const svg = renderHero(map.views[0], map, computeDrift(map).findings);

  const selves = edgeParts(svg).filter((e) => e.id.endsWith('component.loop>component.loop'));
  assert.equal(selves.length, 2, 'both self-edges must be drawn');
  assert.notEqual(selves[0].d, selves[1].d, 'two self-edges on one box may not share a path');

  // …and it really is the ROUTE ALLOCATION being exercised rather than two band rows side by side:
  // exactly one takes the loop over the box's top edge — the only route drawn as a cubic — and the
  // other falls through. Asserted, because a fixture that quietly stopped offering a loop at all
  // (a node in the TOP ROW has none: the lane heading owns the strip above it) would leave every
  // assertion here passing while the fall-through it was written for went unexercised.
  assert.equal(selves.filter((s) => s.d.includes(' C ')).length, 1,
    'one self-edge takes the loop and the other falls through to its own band row');
  for (const a of selves[0].captions) {
    for (const b of selves[1].captions) {
      assert.ok(!rectsOverlap(a, b), `the captions "${a.body}" and "${b.body}" overprint`);
    }
  }

  // Both labels survive as their own readable ink, not merely inside the <title>.
  const bodies = selves.flatMap((e) => e.captions.map((c) => c.body));
  assert.equal(new Set(bodies).size, bodies.length, 'two self-edges must not caption identically');
  assert.ok(!/NaN|undefined/.test(svg));
});

test('18 · a node caption is fitted to its OWN box — and the fixture\'s real labels survive intact', () => {
  // The caption budget used to be the LANE PITCH (or the room left to the canvas edge), not the
  // box. A box is 200 units and the pitch is 272, so a wide label was allowed to reach 36 units past
  // each side of its own box — straight into the 72-unit gutter, which is exactly where a direct
  // edge and its caption live. A label that overhangs its box also reads as belonging to whatever
  // it lands on, which is a relationship the map never recorded.
  for (const [what, , , svg] of heroes()) {
    const boxes = nodeBoxes(svg);
    for (const g of svg.matchAll(/<g[^>]*data-node="([^"]*)"[^>]*>([\s\S]*?)<\/g>/g)) {
      const box = boxes.get(decodeXml(g[1]));
      assert.ok(box, `${what}: ${g[1]} has no box`);
      for (const t of g[2].matchAll(/<text([^>]*)>([^<]*)<\/text>/g)) {
        const cap = captionBox(`<text${t[1]}>`, decodeXml(t[2]));
        assert.ok(cap.x >= box.x && cap.x + cap.w <= box.x + box.w,
          `${what}: the caption "${cap.body}" spans ${cap.x}…${cap.x + cap.w}, outside the `
          + `${box.x}…${box.x + box.w} box for ${box.id}`);
      }
    }
  }
});

test('18b · fitting to the box does NOT truncate the real labels of the real fixture', () => {
  // The box bound is only worth having if it is affordable. A strict box bound under a flat
  // one-em-per-character width model cuts the fixture's own 14-character `dispatch table` label —
  // truncating a real, in-budget label to satisfy a model that was never measuring anything. So the
  // MODEL was tightened rather than the bound loosened, and this is what says so.
  const map = loadMap();
  const svg = renderFixture();
  for (const id of viewOf(map, 'overview').nodes) {
    const node = map.nodes.find((n) => n.id === id);
    const group = groupOf(svg, id);
    assert.ok(group.includes(`>${escapeXml(node.label)}<`),
      `the fixture label "${node.label}" must render in full, not cut to fit`);
    assert.ok(group.includes(`>${escapeXml(node.kind)}<`),
      `the fixture kind "${node.kind}" must render in full`);
  }
  assert.ok(!/>[^<]*…</.test(svg.replace(/<title>[\s\S]*?<\/title>/g, '')),
    'nothing in the real fixture hero should need cutting at all');
});

test('19 · the width model is a stated UPPER bound — widest-by-default, monotone, linear, per code point', () => {
  // Tests 13, 15, 16 and 18 all read `textWidth` to decide where ink landed, so the model is the
  // one thing they cannot themselves check. This pins it directly. The claim the model makes is not
  // "these are the metrics of a font" — no font is available to measure — but "no glyph in the faces
  // a `system-ui, sans-serif` stack resolves to advances more than this". The properties below are
  // the ones that make such a claim safe to place text by.
  const em = (ch) => textWidth(ch, 1);
  const ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .,:;!?/()[]{}-_@#%&*+=<>~^|\'"`\\$';
  const widest = Math.max(...[...ALPHABET].map(em));

  // Linear in font size and additive over characters: an advance table, not a heuristic that can
  // behave differently at the size it is checked at than at the size it is drawn at.
  assert.equal(textWidth('', 14), 0);
  assert.equal(textWidth('dispatch table', 28), 2 * textWidth('dispatch table', 14));
  const sample = 'the quick brown fox JUMPS 0123 @%';
  const summed = [...sample].reduce((total, ch) => total + textWidth(ch, 10), 0);
  assert.ok(Math.abs(textWidth(sample, 10) - summed) < 1e-9, 'the model must be additive');

  // Every glyph costs ink, so a longer string is never charged less than a shorter one. A zero-cost
  // glyph is how a "fitted" caption ends up wider than the box it was fitted to.
  for (const ch of ALPHABET) assert.ok(em(ch) > 0, `"${ch}" must cost ink`);
  assert.ok(em('iiii') > em('iii'), 'monotone in length');

  // The glyphs that really are widest in a bold sans face must be charged the MOST. Filing `W` or
  // `m` under a narrow bucket is the single edit that would turn this model from an upper bound into
  // an under-statement, and it would do so silently.
  for (const ch of 'mwMW@%') assert.equal(em(ch), widest, `"${ch}" must take the widest bucket`);
  for (const ch of 'il.,:;') assert.ok(em(ch) < em('W'), `"${ch}" is narrow and should be charged as such`);

  // …and nothing is charged near-zero: the narrowest bucket is a floor, not an approximation of the
  // hairline glyphs' true advance.
  for (const ch of ALPHABET) assert.ok(em(ch) >= 0.45, `"${ch}" must not be charged below 0.45em`);

  // An UNMAPPED code point is charged AT LEAST the widest mapped bucket, never the average one. The
  // table covers printable ASCII; a CJK ideograph is one em by construction and an emoji reaches
  // about 1.3, so the fallback has to sit above the table rather than inside it.
  for (const ch of ['漢', 'Ж', '█', '😀', '→']) {
    assert.ok(em(ch) >= widest, `an unmapped glyph "${ch}" must be charged at least the widest bucket`);
  }

  // Measured per CODE POINT, not per UTF-16 unit. The same iteration is what stops `fit` cutting a
  // surrogate pair in half, which would emit a lone surrogate and make the SVG ill-formed.
  assert.equal([...'😀'].length, 1, 'the premise: one astral glyph, two UTF-16 units');
  assert.equal(textWidth('😀', 10), em('😀') * 10);
});

test('20 · a self-edge on a TOP-ROW node cannot land its caption on the lane heading above it', () => {
  // A self-loop was routed over its own box's TOP edge and captioned at `from.y - 8`, which for a
  // top-row box is `margin - 8` — the very baseline the lane headings are drawn on. The `core`
  // heading and the caption of a self-edge on the top `core` node were therefore drawn at the same
  // y, overlapping horizontally, and both became unreadable. No box occupies that strip, so every
  // existing caption-vs-box check passed while the picture said two things in one place.
  const map = topRowSelfEdgeMap();
  const svg = renderHero(map.views[0], map, computeDrift(map).findings);

  const headings = laneHeadings(svg);
  assert.deepEqual(headings.map((h) => h.body), ['entry', 'core'], 'both lanes must be headed');
  const core = headings.find((h) => h.body === 'core');

  const self = edgeParts(svg).find((e) => e.id.endsWith('component.hub>component.hub'));
  assert.ok(self, 'the self-edge must still be drawn — a dropped edge is a relationship never seen');
  assert.ok(self.captions.length > 0, '…and still captioned');
  for (const cap of self.captions) {
    assert.ok(!rectsOverlap(cap, core),
      `the self-edge caption "${cap.body}" (${cap.x}…${cap.x + cap.w} at y ${cap.y}) lands on the `
      + `"core" lane heading (${core.x}…${core.x + core.w} at y ${core.y})`);
  }

  // The label is not quietly dropped to dodge the collision, and the edge keeps its arrowhead.
  assert.ok(svg.includes('<title>component.hub → component.hub:'), 'the full label stays in the <title>');
  assert.match(self.d, /^M /, 'the self-edge still has a path');
  assert.ok(!/NaN|undefined/.test(svg));
});

test('19b · the ellipsis is paid for OUT of the budget, so a cut caption still fits', () => {
  // A cut caption is the one that is placed right at its bound, so it is the one that escapes if the
  // marker is added after the budget is spent rather than reserved from it.
  const cut = [];
  for (const [what, , , svg] of heroes()) {
    const boxes = nodeBoxes(svg);
    for (const g of svg.matchAll(/<g[^>]*data-node="([^"]*)"[^>]*>([\s\S]*?)<\/g>/g)) {
      const box = boxes.get(decodeXml(g[1]));
      for (const t of g[2].matchAll(/<text([^>]*)>([^<]*)<\/text>/g)) {
        const body = decodeXml(t[2]);
        if (!body.endsWith('…')) continue;
        cut.push(`${what}: ${body}`);
        const cap = captionBox(`<text${t[1]}>`, body);
        assert.ok(cap.x >= box.x && cap.x + cap.w <= box.x + box.w,
          `${what}: the CUT caption "${body}" still spans ${cap.x}…${cap.x + cap.w} of the `
          + `${box.x}…${box.x + box.w} box for ${box.id} — the ellipsis was not budgeted for`);
      }
    }
  }
  assert.ok(cut.length >= 3, `something must actually have been cut, or this proves nothing (${cut.length})`);
});
