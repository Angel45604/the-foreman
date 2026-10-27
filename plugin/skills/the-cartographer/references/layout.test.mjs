import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LANES, HERO_MAX_NODES, validate } from './validate.mjs';
import { serialize } from './serialize.mjs';
import { computeDrift, DRIFT_CLASSES } from './diff.mjs';
import { LAYOUT, LANE_ORDER, DRIFT_SEVERITY, layoutHero, resolveView } from './layout.mjs';
import { renderHero } from './svg.mjs';
import { renderMermaid } from './mermaid.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, 'fixtures', 'tiny.map.json');
const SH = 'plugin/skills/the-cartographer/references/fixtures/tiny/run.sh';
const loadMap = () => JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
const viewOf = (map, id) => map.views.find((v) => v.id === id);

const node = (id, lane, label = id) => ({ id, label, lane });

/** Every rectangle pair, so "no overlap" is asserted globally rather than per lane. */
function overlaps(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * A fixed, non-identity PERMUTATION — odd indices then even ones. Deterministic, and a permutation
 * at every length, which an index-stride shuffle is not: `(i * 3 + 1) % 6` repeats and would hand
 * the code under test a duplicated element rather than a reordered one.
 */
const shuffle = (arr) => [...arr.filter((_, i) => i % 2 === 1), ...arr.filter((_, i) => i % 2 === 0)];

// ─── lanes and geometry ──────────────────────────────────────────────────────────────────────────

test('1 · LANE_ORDER is the validator closed set, in the hero order entry → core → output → external', () => {
  assert.deepEqual(LANE_ORDER, ['entry', 'core', 'output', 'external']);
  // A lane added to the contract must break here rather than silently vanish from every hero.
  assert.deepEqual([...LANE_ORDER].sort(), [...LANES].sort());
});

test('2 · lanes become columns in the fixed order, asserted by x-ordering', () => {
  // Fed in REVERSE lane order, so passing cannot be an accident of input order.
  const { placed } = layoutHero([
    node('external.e', 'external'), node('outcome.o', 'output'),
    node('component.c', 'core'), node('mode.m', 'entry'),
  ]);
  const xOf = (id) => placed.find((p) => p.id === id).x;
  assert.ok(xOf('mode.m') < xOf('component.c'), 'entry must sit left of core');
  assert.ok(xOf('component.c') < xOf('outcome.o'), 'core must sit left of output');
  assert.ok(xOf('outcome.o') < xOf('external.e'), 'output must sit left of external');
});

test('3 · nodes in one lane stack vertically and NO two boxes overlap', () => {
  const { placed } = layoutHero([
    node('mode.a', 'entry'), node('mode.b', 'entry'), node('mode.c', 'entry'),
    node('component.x', 'core'), node('component.y', 'core'),
  ]);
  const entry = placed.filter((p) => p.lane === 'entry');
  assert.equal(entry.length, 3);
  assert.equal(new Set(entry.map((p) => p.x)).size, 1, 'one lane is one column');
  const ys = entry.map((p) => p.y).sort((a, b) => a - b);
  for (let i = 1; i < ys.length; i += 1) {
    assert.ok(ys[i] >= ys[i - 1] + LAYOUT.nodeHeight, 'stacked boxes may not overlap vertically');
  }
  for (let i = 0; i < placed.length; i += 1) {
    for (let j = i + 1; j < placed.length; j += 1) {
      assert.ok(!overlaps(placed[i], placed[j]), `${placed[i].id} overlaps ${placed[j].id}`);
    }
  }
});

test('4 · every placed box fits inside the reported width and height', () => {
  const map = loadMap();
  const view = resolveView(viewOf(map, 'overview'), map, []);
  const { width, height, placed } = layoutHero(view.nodes);
  assert.equal(placed.length, view.nodes.length, 'no node may be dropped from the picture');
  for (const p of placed) {
    assert.ok(p.x >= 0 && p.y >= 0, `${p.id} starts off-canvas at ${p.x},${p.y}`);
    assert.ok(p.x + p.w <= width, `${p.id} overflows width ${width}`);
    assert.ok(p.y + p.h <= height, `${p.id} overflows height ${height}`);
  }
});

test('5 · an empty lane consumes no column', () => {
  const two = layoutHero([node('mode.a', 'entry'), node('outcome.o', 'output')]);
  assert.equal(new Set(two.placed.map((p) => p.x)).size, 2);
  assert.equal(two.width, LAYOUT.margin * 2 + LAYOUT.nodeWidth * 2 + LAYOUT.laneGap);
  // …and the gap left by `core` is not merely invisible: the two columns are ADJACENT.
  const xs = two.placed.map((p) => p.x).sort((a, b) => a - b);
  assert.equal(xs[1] - xs[0], LAYOUT.nodeWidth + LAYOUT.laneGap);

  const one = layoutHero([node('mode.a', 'entry')]);
  assert.equal(one.width, LAYOUT.margin * 2 + LAYOUT.nodeWidth);
});

test('6 · layout is deterministic for the same input regardless of input order', () => {
  const nodes = [
    node('mode.a', 'entry'), node('mode.b', 'entry'), node('component.x', 'core'),
    node('outcome.o', 'output'), node('external.e', 'external'),
  ];
  const a = layoutHero(nodes);
  const b = layoutHero(shuffle(nodes));
  assert.notDeepEqual(nodes, shuffle(nodes), 'the shuffle must actually reorder, or test 6 proves nothing');
  assert.deepEqual(b, a);
  assert.deepEqual(layoutHero(nodes), a, 'twice over the same input is byte-identical');
});

// ─── the cap: ADR C-002 enforced, not advisory ───────────────────────────────────────────────────

test('7 · fails closed above the cap, naming the cap and the collapse rule (ADR C-002)', () => {
  const many = Array.from({ length: 16 }, (_, i) => node(`mode.m${i}`, 'entry'));
  assert.equal(layoutHero(many.slice(0, 15)).placed.length, 15, '15 is inside the cap');
  assert.throws(() => layoutHero(many), (err) => {
    assert.match(err.message, /15/, 'the message must name the cap');
    assert.match(err.message, /16/, 'the message must name what was handed in');
    assert.match(err.message, /collapse/i);
    assert.match(err.message, /component-level/i);
    assert.match(err.message, /C-002/);
    return true;
  });
});

test('8 · the cap is configurable but can never be switched OFF', () => {
  const nodes = Array.from({ length: 4 }, (_, i) => node(`mode.m${i}`, 'entry'));
  assert.equal(layoutHero(nodes, { maxNodes: 4 }).placed.length, 4);
  assert.throws(() => layoutHero(nodes, { maxNodes: 3 }), /maxNodes|cap|3/i);
  // An unbounded cap is the one setting that would make ADR C-002 advisory again.
  for (const bad of [Infinity, NaN, 0, -1, 2.5, '15', null]) {
    assert.throws(() => layoutHero(nodes, { maxNodes: bad }), /maxNodes/,
      `maxNodes: ${String(bad)} must be refused`);
  }
});

// ─── fail closed rather than draw a lie ──────────────────────────────────────────────────────────

test('9 · refuses input it cannot draw truthfully, instead of dropping it from the picture', () => {
  assert.throws(() => layoutHero(null), /nodes/);
  assert.throws(() => layoutHero([node('mode.a', 'middle')]), /lane/);
  assert.throws(() => layoutHero([{ id: 'mode.a', lane: 'entry' }]), /label/);
  assert.throws(() => layoutHero([{ label: 'a', lane: 'entry' }]), /id/);
  assert.throws(() => layoutHero([node('mode.a', 'entry'), node('mode.a', 'core')]), /duplicate|mode\.a/i);
  // An accessor is re-read by the next reader, so the box drawn need not be the box checked.
  const trap = { id: 'mode.a', lane: 'entry', get label() { return Math.random(); } };
  assert.throws(() => layoutHero([trap]), /accessor|label/i);
});

test('10 · never mutates or aliases the nodes handed in', () => {
  const nodes = [node('mode.a', 'entry'), node('component.x', 'core')].map(Object.freeze);
  const before = JSON.stringify(nodes);
  const { placed } = layoutHero(Object.freeze(nodes));
  assert.equal(JSON.stringify(nodes), before);
  for (const p of placed) assert.ok(!nodes.includes(p), 'a placed box may not BE an input node');
  placed[0].x = -999;                       // a renderer nudging a box must not reach the map
  assert.equal(JSON.stringify(nodes), before);
});

// ─── resolveView — the one boundary both renderers read the IR through ───────────────────────────

test('11 · resolveView resolves a view against the map, sorted and deterministic', () => {
  const map = loadMap();
  const view = resolveView(viewOf(map, 'overview'), map, []);
  assert.equal(view.id, 'overview');
  assert.equal(view.form, 'svg-hero');
  assert.equal(view.title, 'tiny — overview');
  assert.deepEqual(view.nodes.map((n) => n.id), [...view.nodes.map((n) => n.id)].sort());
  assert.deepEqual(view.edges.map((e) => e.id), [...view.edges.map((e) => e.id)].sort());
  assert.equal(view.nodes.length, 6);
  assert.equal(view.edges.length, 4);
  const check = view.nodes.find((n) => n.id === 'mode.check');
  assert.equal(check.label, 'check');
  assert.equal(check.lane, 'entry');
  assert.equal(check.kind, 'mode');
  const edge = view.edges.find((e) => e.id === 'e.control.mode.check>outcome.pass');
  assert.equal(edge.from, 'mode.check');
  assert.equal(edge.to, 'outcome.pass');
  assert.equal(edge.label, 'emits');
  // Deterministic against a shuffled map — the renderers must not inherit extractor order.
  const shuffled = { ...map, nodes: shuffle(map.nodes), edges: shuffle(map.edges) };
  assert.deepEqual(resolveView(viewOf(map, 'overview'), shuffled, []).nodes, view.nodes);
});

test('12 · resolveView indexes drift by node, worst class first (STALE > PHANTOM > UNDOCUMENTED > UNVERIFIED)', () => {
  assert.deepEqual(DRIFT_SEVERITY, ['STALE', 'PHANTOM', 'UNDOCUMENTED', 'UNVERIFIED']);
  assert.deepEqual([...DRIFT_SEVERITY].sort(), [...DRIFT_CLASSES].sort(),
    'every class diff.mjs can emit must have a severity, or a finding would style nothing');

  const map = loadMap();
  const { findings } = computeDrift(map);
  const view = resolveView(viewOf(map, 'overview'), map, findings);
  assert.deepEqual(view.drift.get('mode.build'), { classes: ['PHANTOM'], primary: 'PHANTOM' });
  assert.deepEqual(view.drift.get('env.tiny_debug'), { classes: ['UNDOCUMENTED'], primary: 'UNDOCUMENTED' });
  assert.deepEqual(view.drift.get('mode.check'), { classes: ['STALE'], primary: 'STALE' });
  assert.equal(view.drift.get('component.tiny_core'), undefined, 'a clean node carries no drift entry');
  assert.deepEqual(view.classesPresent, ['STALE', 'PHANTOM', 'UNDOCUMENTED'],
    'classes present are reported in severity order, and only the ones actually on this view');
});

test('13 · resolveView keeps BOTH classes when one node carries two findings', () => {
  // Family (A) set-membership and family (B) contradiction can both fire on one node. A one-class
  // index would silently drop one of them.
  const map = {
    // ADR C-018 — UNDOCUMENTED needs a COMPLETE harvest, and completeness is `searched` measured
    // against the map's own `role: "doc"` sources. A map declaring none puts every node in state 3,
    // so the surface is declared here, classified as READ, and searched below; no one of the three
    // alone reaches state 2.
    sources: [{ path: 'a/SKILL.md', role: 'doc' }, { path: 'a/run.sh', role: 'code' }],
    coverage: { read: ['a/SKILL.md', 'a/run.sh'], partial: [], skipped: [] },
    nodes: [{
      id: 'env.both', kind: 'env', label: 'BOTH', lane: 'core', inferred: false,
      docHarvest: { searched: ['a/SKILL.md'], candidates: [] },
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
  const view = resolveView(map.views[0], map, findings);
  assert.deepEqual(view.drift.get('env.both'), {
    classes: ['STALE', 'UNDOCUMENTED'], primary: 'STALE',
  });
  assert.deepEqual(view.classesPresent, ['STALE'], 'only ASSIGNED classes get a classDef');
});

test('14 · resolveView fails closed rather than render a hole', () => {
  const map = loadMap();
  const bad = (patch) => resolveView({ ...viewOf(map, 'overview'), ...patch }, map, []);
  assert.throws(() => bad({ nodes: ['mode.nonexistent'] }), /mode\.nonexistent/);
  assert.throws(() => bad({ edges: ['e.control.nope>nope'] }), /e\.control\.nope>nope/);
  // An edge whose endpoint is not drawn in this view would draw an arrow into nothing.
  assert.throws(() => bad({ nodes: ['mode.check'], edges: ['e.control.mode.check>outcome.pass'] }),
    /outcome\.pass/);
  assert.throws(() => resolveView(null, map, []), /view/i);
  assert.throws(() => resolveView(viewOf(map, 'overview'), null, []), /map/i);
  // The contract requires views[].title; a renderer inventing a heading is a placeholder for data
  // the extractor never supplied.
  assert.throws(() => bad({ title: '' }), /title/);

  // An unlabelled arrow says only "related somehow" (PDR §6.1) — it is refused, not drawn bare.
  const unlabelled = {
    ...map,
    edges: map.edges.map((e) => (e.id === 'e.control.mode.check>outcome.pass' ? { ...e, label: '' } : e)),
  };
  assert.throws(() => resolveView(viewOf(map, 'overview'), unlabelled, []), /label/);

  // A finding carrying a class no renderer has a style for would style nothing at all.
  assert.throws(
    () => resolveView(viewOf(map, 'overview'), map, [{ class: 'WEIRD', nodeId: 'mode.check', label: 'check' }]),
    /WEIRD/,
  );
});

test('15 · resolveView never mutates or aliases the map or the findings', () => {
  const map = loadMap();
  const { findings } = computeDrift(map);
  const mapBefore = JSON.stringify(map);
  const findingsBefore = JSON.stringify(findings);
  const view = resolveView(viewOf(map, 'overview'), map, findings);
  assert.equal(JSON.stringify(map), mapBefore);
  assert.equal(JSON.stringify(findings), findingsBefore);
  for (const n of view.nodes) assert.ok(!map.nodes.includes(n), 'a resolved node may not BE a map node');
  for (const e of view.edges) assert.ok(!map.edges.includes(e), 'a resolved edge may not BE a map edge');
  view.nodes[0].label = 'clobbered';
  view.drift.set('mode.check', null);
  assert.equal(JSON.stringify(map), mapBefore);
  assert.equal(JSON.stringify(findings), findingsBefore);
});

test('16 · resolveView reads each view property EXACTLY once — time-of-check is time-of-use', () => {
  const map = loadMap();
  const raw = viewOf(map, 'overview');
  const reads = [];
  const view = new Proxy(raw, {
    getOwnPropertyDescriptor(target, key) {
      reads.push(key);
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });

  const resolved = resolveView(view, map, []);
  const counts = reads.reduce((acc, key) => acc.set(key, (acc.get(key) ?? 0) + 1), new Map());
  for (const [key, times] of counts) {
    assert.equal(times, 1,
      `view.${key} is read ${times} times — a second read can return a different value, so the `
      + 'value that names an error need not be the value that ships (the Phase 2 defect class).');
  }
  assert.equal(resolved.id, 'overview');
  // …and a view with no id is refused rather than titled from a re-read.
  assert.throws(() => resolveView({ ...raw, id: undefined }, map, []), /id/);
});

test('17 · a finding for a node outside this view is ignored, not an error', () => {
  const map = loadMap();
  const { findings } = computeDrift(map);
  // `capabilities` is a table view and holds only three of the six nodes.
  const view = resolveView(viewOf(map, 'control-flow'), map, findings);
  assert.equal(view.drift.get('mode.build'), undefined, 'mode.build is not in the control-flow view');
  assert.deepEqual(view.classesPresent, ['STALE'], 'only mode.check drifts inside this view');
});

test('18 · findings is REQUIRED — silence may not be read as "this view is clean"', () => {
  const map = loadMap();
  const view = viewOf(map, 'overview');
  const { findings } = computeDrift(map);
  assert.ok(findings.length > 0, 'the fixture must drift, or this test proves nothing');

  // Defaulting to [] renders a DRIFTING map as clean — a missing accusation, which for an audit
  // tool is worse than a wrong one.
  assert.throws(() => resolveView(view, map), /findings/,
    'a two-argument call must fail closed rather than assume "no drift"');
  assert.throws(() => resolveView(view, map, undefined), /findings/);

  // An EXPLICIT empty array stays legal: that is a caller ASSERTING there is no drift, which is a
  // different act from not saying anything at all.
  assert.equal(resolveView(view, map, []).drift.size, 0);
  assert.ok(resolveView(view, map, findings).drift.size > 0);
});

test('19 · a GRAPH view whose edges field was deleted is refused, not drawn with zero arrows', () => {
  const map = loadMap();
  const drop = (id) => { const v = { ...viewOf(map, id) }; delete v.edges; return v; };

  // `validate.mjs` says a graph view "requires an edges array (possibly empty, never absent)"; a
  // renderer that reads absent as [] disagrees with the validator about what a legal map is — the
  // exact disagreement this shared boundary exists to eliminate.
  assert.throws(() => resolveView(drop('overview'), map, []), /edges/,
    'an svg-hero view with no edges array must fail closed');
  assert.throws(() => resolveView(drop('control-flow'), map, []), /edges/,
    'a mermaid view with no edges array must fail closed');

  // An explicit empty array stays legal — a graph view that genuinely draws no arrows.
  assert.deepEqual(resolveView({ ...viewOf(map, 'overview'), edges: [] }, map, []).edges, []);

  // …and a TABLE view carries no edges BY CONTRACT, so it must not be refused for lacking them.
  const table = viewOf(map, 'capabilities');
  assert.ok(!('edges' in table), 'the fixture table view really has no edges key');
  assert.deepEqual(resolveView(table, map, []).edges, []);
});

test('20 · a view that names one node — or one edge — TWICE is refused by BOTH, for the same reason', () => {
  const map = loadMap();
  const overview = viewOf(map, 'overview');
  const withNodeTwice = { ...overview, nodes: [...overview.nodes, 'mode.check'] };
  const withEdgeTwice = { ...overview, edges: [...overview.edges, overview.edges[0]] };

  // This test used to LOCK IN a disagreement: `validate` accepted a repeated reference — checkViews
  // only asked whether each id resolved, never whether it had already been listed — while the render
  // boundary refused it, and the two renderers underneath did not even agree with each other
  // (layoutHero throws on the duplicate box; mermaid quietly emits the declaration twice). ADR C-006
  // makes validate.mjs the single executable IR contract, so a rule the render boundary enforces
  // about IR SHAPE cannot live only in the renderers: the duplicate-reference rule now lives in
  // validate.mjs, and this asserts the two agree rather than that they differ.
  const patched = (v) => ({ ...map, views: map.views.map((x) => (x.id === 'overview' ? v : x)) });
  for (const [what, candidate, id] of [
    ['node', withNodeTwice, /mode\.check/],
    ['edge', withEdgeTwice, /e\.control\.mode\.check>component\.tiny_core/],
  ]) {
    const result = validate(patched(candidate));
    assert.equal(result.ok, false, `validate must refuse a view naming one ${what} twice`);
    const said = result.errors.filter((e) => /duplicate/i.test(e) && id.test(e));
    assert.equal(said.length, 1,
      `validate must name the duplicate ${what} reference by id — got ${JSON.stringify(result.errors)}`);
  }

  assert.throws(() => resolveView(withNodeTwice, map, []), (err) => {
    assert.match(err.message, /duplicate/i);
    assert.match(err.message, /mode\.check/, 'the message must name the id that was listed twice');
    return true;
  });
  assert.throws(() => resolveView(withEdgeTwice, map, []), /duplicate/i);
});

/**
 * Every view of a map pushed all the way through the RENDER — the first refusal, or null.
 *
 * Deliberately not `resolveView` alone. The render boundary is `resolveView` PLUS the renderer that
 * consumes it, and rules live on both sides of that seam: `resolveView` refuses a duplicate
 * reference, while ADR C-002's 15-node hero bound is enforced inside `layoutHero`, one call further
 * in. Stopping at `resolveView` is what let the cap sit outside this test's reach while it was
 * missing from the validator — the asymmetry the test exists to catch.
 */
function renderRefusal(map) {
  for (const view of map.views) {
    try {
      resolveView(view, map, []);
      if (view.form === 'svg-hero') renderHero(view, map, []);
      else if (view.form === 'mermaid') renderMermaid(view, map, []);
    } catch (err) {
      return err.message;
    }
  }
  return null;
}

/** The fixture with its `overview` grown to `n` nodes — valid, uniquely-labelled filler. */
function overviewWith(n) {
  const map = loadMap();
  const overview = viewOf(map, 'overview');
  for (let i = overview.nodes.length; i < n; i += 1) {
    const label = `filler ${i}`;
    const id = `mode.${label.replace(' ', '_')}`;
    map.nodes.push({
      id,
      kind: 'mode',
      label,
      lane: 'entry',
      inferred: false,
      summary: 'Filler mode, cited from the fixture script so the node itself is valid.',
      evidence: [{ path: SH, line: 11, note: 'mode_check() {' }],
      claims: [],
    });
    overview.nodes.push(id);
  }
  return map;
}

test('23 · validate.mjs and the render boundary agree about IR SHAPE, and say the same thing (C-006)', () => {
  const map = loadMap();
  const view = (id) => viewOf(map, id);
  const put = (v) => ({ ...map, views: map.views.map((x) => (x.id === v.id ? v : x)) });
  const overview = view('overview');
  const noEdges = { ...overview };
  delete noEdges.edges;

  // ─── the INGEST BOUNDARY corpus ─────────────────────────────────────────────────────────────────
  //
  // Six shapes, one per finding recorded in phase-{1,2,3}-known-limitations.md. Each of them used to
  // clear `validate()` and then make a consumer throw, or serialize to DIFFERENT DATA than the value
  // that was validated — which is the same defect wearing two coats, because both come of the two
  // artifacts reading the input differently. They are asserted here, beside the reference-list rules,
  // because the answer to all six is one rule: there is ONE definition of a legal map's shape and it
  // is applied once, at ingest.
  const nodeOf = (id) => map.nodes.find((n) => n.id === id);
  const withNode = (id, replacement) => ({
    ...map, nodes: map.nodes.map((n) => (n.id === id ? replacement : n)),
  });

  // (1) an EXOTIC record. A `Date` carrying the node's own fields answers every descriptor read with
  // real data — and `JSON.stringify` writes it as a STRING, so the node the validator judged is not
  // the node in the file. (Phase 2, and the `Date` citation Phase 2 fixed inside diff.mjs alone.)
  const exoticNode = withNode('mode.check', Object.assign(new Date(0), nodeOf('mode.check')));

  // (2) an ACCESSOR view field — Phase 3, round 5's open P1. A getter answers the validator and is
  // re-read by whoever draws it, so the value checked need not be the value rendered.
  const accessorTitle = { ...overview };
  delete accessorTitle.title;
  Object.defineProperty(accessorTitle, 'title', {
    get: () => 'tiny — overview', enumerable: true, configurable: true,
  });

  // (3) an INHERITED view field — the other half of that P1. A plain get sees it; `JSON.stringify`,
  // `structuredClone` and every descriptor read do not.
  const inheritedForm = Object.assign(Object.create({ form: 'svg-hero' }), { ...overview });
  delete inheritedForm.form;

  // (4) a NON-ENUMERABLE `nodes` — Phase 2, finding 2. The validator read the list; `serialize()`
  // dropped it entirely, writing a map with no nodes at all.
  const hiddenNodes = { ...map };
  Object.defineProperty(hiddenNodes, 'nodes', {
    value: map.nodes, writable: true, enumerable: false, configurable: true,
  });

  // (5) a SPARSE `nodes` array — Phase 1. `forEach` SKIPS the hole, so the renderers never saw it,
  // while `JSON.stringify` writes it as `null`.
  const sparseNodes = { ...map, nodes: (() => { const a = [...map.nodes]; a.length += 1; return a; })() };

  // (6) `-0` in a citation's metadata — Phase 2, finding 3. This one is legal DATA: the file carries
  // `0`, because JSON has no other spelling for it. So it is canonicalized THROUGH rather than
  // refused, and the round-trip probe below is what pins it — before the boundary, the drift engine
  // carried a `-0` no reader of `map.json` could ever see.
  const minusZero = withNode('env.tiny_debug', {
    ...nodeOf('env.tiny_debug'),
    evidence: nodeOf('env.tiny_debug').evidence.map((e, i) => (i === 0 ? { ...e, weight: -0 } : e)),
  });

  // SCOPE, stated: IR SHAPE — the region of the contract the render boundary actually reads. The
  // validator legitimately rejects more than this (hashes, citations, coverage, containment), and
  // that is not a disagreement. What ADR C-006 forbids is the opposite pairing: a map validate()
  // calls legal that no renderer can draw, or one a renderer refuses while validate() calls it
  // clean. Three phases running, every such gap has produced a finding, so it is asserted directly
  // and in BOTH directions — and on the REASON, not merely on the verdict, since two artifacts that
  // refuse the same map for unrelated reasons still do not agree about the contract.
  const cases = [
    ['the fixture itself', map, null],
    ['a graph view naming one node twice',
      put({ ...overview, nodes: [...overview.nodes, 'mode.check'] }), [/duplicate/i, /mode\.check/]],
    ['a graph view naming one edge twice',
      put({ ...overview, edges: [...overview.edges, overview.edges[0]] }),
      [/duplicate/i, /e\.control\.mode\.check>component\.tiny_core/]],
    ['a TABLE view naming one node twice',
      put({ ...view('capabilities'), nodes: ['mode.check', 'mode.check'] }), [/duplicate/i, /mode\.check/]],
    // …and the EDGE list of a table view, which the validator used to skip entirely: the whole
    // edge-reference block ran inside `if (isGraph)` while `resolveView` reads it for every form.
    ['a TABLE view naming one edge twice',
      put({
        ...view('capabilities'),
        nodes: [...view('capabilities').nodes, 'component.tiny_core'],
        edges: ['e.control.mode.check>component.tiny_core', 'e.control.mode.check>component.tiny_core'],
      }),
      [/duplicate/i, /e\.control\.mode\.check>component\.tiny_core/]],
    ['a TABLE view drawing an edge whose endpoint it omits',
      put({ ...view('capabilities'), edges: ['e.control.mode.check>outcome.pass'] }),
      [/outcome\.pass/]],
    // …and the SHAPE of that list, not merely its contents. A table view's `edges` may be ABSENT —
    // it carries none by contract — but a key that is PRESENT is an edges list, and `resolveView`
    // reads it as one for every form. The array check fired only `if (isGraph)`, so `edges: null`
    // on a table view was a map validate() called legal and the render boundary refused: rule 14's
    // asymmetry once more, this time in the SHAPE of the key rather than in what it names.
    ['a TABLE view whose edges key is PRESENT but not an array',
      put({ ...view('capabilities'), edges: null }), [/edges/, /array/]],
    ['a TABLE view whose edges key is PRESENT and is an OBJECT',
      put({ ...view('capabilities'), edges: { 0: 'e.control.mode.check>outcome.pass' } }),
      [/edges/, /array/]],
    ['a graph view with no edges array at all', put(noEdges), [/edges/]],
    ['a view referencing a node the map does not have',
      put({ ...overview, nodes: [...overview.nodes, 'mode.nope'] }), [/mode\.nope/]],
    ['a view referencing an edge the map does not have',
      put({ ...overview, edges: [...overview.edges, 'e.control.nope>nope'] }), [/e\.control\.nope>nope/]],
    ['a view drawing an edge whose endpoint it omits',
      put({ ...overview, nodes: overview.nodes.filter((n) => n !== 'outcome.pass') }), [/outcome\.pass/]],
    // ADR C-002's hero bound: enforced in `layoutHero` from the start, and — until this round —
    // nowhere in the validator, so a 16-node overview was a map validate() called legal that
    // renderHero could not draw. Both directions of the bound are asserted: 15 is drawable AND
    // valid, 16 is refused by both, naming the same number and the same decision.
    ['an svg-hero view at exactly the C-002 bound', overviewWith(HERO_MAX_NODES), null],
    ['an svg-hero view one node OVER the C-002 bound',
      overviewWith(HERO_MAX_NODES + 1), [/15/, /C-002/]],
    ['a view with no title', put({ ...overview, title: '' }), [/title/]],
    ['an edge with no label', {
      ...map,
      edges: map.edges.map((e) => (e.id === 'e.control.mode.check>outcome.pass' ? { ...e, label: '' } : e)),
    }, [/label/]],
    // …and the six ingest shapes. Everything above is about what a reference list NAMES; these are
    // about what a value IS, which is the half that produced a finding in all three phases.
    ['a node record that is an EXOTIC object carrying the node\'s own fields', exoticNode, [/nodes/, /Date/]],
    ['a view whose title is an ACCESSOR', put(accessorTitle), [/title/, /accessor/i]],
    ['a view whose form is INHERITED rather than own', put(inheritedForm), [/form/]],
    ['a map whose nodes list is a NON-ENUMERABLE own property', hiddenNodes, [/nodes/, /enumerable/i]],
    ['a SPARSE nodes array', sparseNodes, [/nodes/, /hole|sparse/i]],
    ['a citation carrying -0 metadata', minusZero, null],
  ];

  for (const [what, candidate, expected] of cases) {
    const result = validate(candidate);
    const refusal = renderRefusal(candidate);
    assert.equal(result.ok, refusal === null,
      `${what}: validate says ok=${result.ok} while the render boundary says ${refusal ?? 'OK'} — a map `
      + 'validate() accepts must be renderable, and a map a renderer refuses must fail validate()');
    if (expected === null) {
      // A map both accept must also be one the pipeline can WRITE, and reading those bytes back must
      // not change a single finding. That is the other half of the same invariant: "renderable" is
      // about the consumers agreeing with the validator, this is about all of them agreeing with the
      // FILE. It is where `-0` and an exotic record part company from the map that was judged.
      const written = JSON.parse(serialize(candidate));
      assert.deepStrictEqual(computeDrift(candidate).findings, computeDrift(written).findings,
        `${what}: the findings derived from the map must equal the findings derived from the bytes it `
        + 'serializes to — otherwise the value validated is not the value written');
      continue;
    }
    for (const re of expected) {
      assert.ok(result.errors.some((e) => re.test(e)),
        `${what}: validate must state ${re} — got ${JSON.stringify(result.errors)}`);
      assert.match(refusal, re, `${what}: the renderer must state ${re} too, or they refuse for different reasons`);
    }
  }
});

test('22 · a finding naming a node the MAP does not contain fails closed, it is not skipped', () => {
  const map = loadMap();
  const overview = viewOf(map, 'overview');
  const controlFlow = viewOf(map, 'control-flow');

  // These two findings look alike and are not, and reading them the same way is a silent FALSE
  // NEGATIVE. `mode.build` is a real node this particular view does not draw: its finding belongs to
  // another view and to the drift table, so skipping it here is correct. `mode.nonexistent` names
  // nothing in the map at all — a stale or mistyped nodeId — and skipping THAT one deletes an
  // accusation. The hero then states "No drift was found", which for an audit tool is the loudest
  // possible claim made by silence.
  const known = [{ class: 'STALE', nodeId: 'mode.build' }];
  const unknown = [{ class: 'STALE', nodeId: 'mode.nonexistent' }];

  assert.equal(resolveView(controlFlow, map, known).drift.size, 0,
    'a finding for a node the map HAS but this view does not draw is still filtered, not an error');
  assert.ok(map.nodes.some((n) => n.id === 'mode.build'), 'and it really is in the map');
  assert.ok(!map.nodes.some((n) => n.id === 'mode.nonexistent'), 'while the other really is not');

  assert.throws(() => resolveView(overview, map, unknown), (err) => {
    assert.match(err.message, /mode\.nonexistent/, "the message must name the finding's node id");
    assert.match(err.message, /findings\[0\]/, '…and which finding carried it');
    return true;
  });
  // …on ANY view, including one that would not have drawn the node even if it existed. The finding
  // is broken in itself; whether this view happens to draw its subject is not what makes it broken.
  assert.throws(() => resolveView(controlFlow, map, unknown), /mode\.nonexistent/);

  // The one that has to keep working: real drift on nodes this view really draws.
  const { findings } = computeDrift(map);
  assert.ok(resolveView(overview, map, findings).drift.size > 0);
});

test('21 · maxNodes may TIGHTEN the ADR C-002 bound and can never loosen it', () => {
  const many = Array.from({ length: 16 }, (_, i) => node(`mode.m${i}`, 'entry'));

  // A large FINITE integer is exactly the escape hatch the bound exists to remove: refusing only
  // `Infinity` leaves ADR C-002 advisory for anyone who types a bigger number instead.
  assert.throws(() => layoutHero(many, { maxNodes: 16 }), (err) => {
    assert.match(err.message, /15/, 'the message must name the bound that was exceeded');
    assert.match(err.message, /C-002/);
    return true;
  });
  assert.throws(() => layoutHero(many.slice(0, 15), { maxNodes: Number.MAX_SAFE_INTEGER }),
    /15|C-002/, 'the OPTION is refused, not merely its outcome on this particular input');

  // Tightening is the whole point of the option, and it still works.
  assert.equal(layoutHero(many.slice(0, 4), { maxNodes: 4 }).placed.length, 4);
  assert.throws(() => layoutHero(many.slice(0, 4), { maxNodes: 3 }), /3/);
  // …and the ADR's own number stays legal, since equalling the bound is not loosening it.
  assert.equal(layoutHero(many.slice(0, 15), { maxNodes: 15 }).placed.length, 15);
});
