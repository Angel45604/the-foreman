// the-cartographer — attention buckets (ADR C-017, PDR §6.2).
//
// The property under test is a NEGATIVE one, and it is the whole reason this module is allowed to
// exist: bucketing may reorder and collapse, and it may never DELETE. Detection is untouched — a
// suppressed UNDOCUMENTED would disappear entirely, because PHANTOM is the opposite membership cell
// and STALE needs a contradiction record, so neither can recover it.
//
// Zero dependencies: node built-ins only.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ATTENTION_BUCKETS, ATTENTION_TABLE, BUCKET_META, COLLAPSIBLE_BUCKET, DEFAULT_BUCKET,
  NEVER_COLLAPSED_CLASSES, bucketForFinding, bucketForKindLane, groupByAttention,
} from './attention.mjs';
import { NODE_KINDS, LANES } from './validate.mjs';
import { DRIFT_CLASSES, computeDrift } from './diff.mjs';

const node = (kind, lane, id = `${kind}.x`) => ({ id, kind, lane, label: 'x' });
const finding = (cls, nodeId = 'component.x') => ({
  class: cls, nodeId, label: 'x', detail: 'd', citations: [{ path: 'a.sh', line: 1 }],
});

test('1 · the table is TOTAL over NODE_KINDS × LANES, and every cell is a known bucket', () => {
  for (const kind of NODE_KINDS) {
    assert.ok(Object.hasOwn(ATTENTION_TABLE, kind), `ATTENTION_TABLE is missing kind ${kind}`);
    for (const lane of LANES) {
      const cell = ATTENTION_TABLE[kind][lane];
      assert.ok(ATTENTION_BUCKETS.includes(cell), `${kind}×${lane} is ${cell}, not a bucket`);
    }
  }
  // …and carries NOTHING ELSE. A cell for a kind the validator does not accept is a rule with no
  // subject, and the first place a second, divergent taxonomy would grow.
  assert.deepEqual(Object.keys(ATTENTION_TABLE).sort(), [...NODE_KINDS].sort());
  for (const kind of NODE_KINDS) {
    assert.deepEqual(Object.keys(ATTENTION_TABLE[kind]).sort(), [...LANES].sort());
  }
});

test('2 · the table is FROZEN at both levels — one exported rule that cannot be edited at runtime', () => {
  assert.ok(Object.isFrozen(ATTENTION_TABLE));
  for (const kind of NODE_KINDS) assert.ok(Object.isFrozen(ATTENTION_TABLE[kind]), `${kind} row is not frozen`);
  assert.ok(Object.isFrozen(ATTENTION_BUCKETS));
  assert.ok(Object.isFrozen(NEVER_COLLAPSED_CLASSES));
});

test('3 · the four VOCABULARY kinds are likely-contract in every lane — lane may never demote them', () => {
  // Lane is a LAYOUT axis (PDR §6.1). A mode, flag, env var or outcome drawn in the `core` lane for
  // layout reasons is still something a caller types, sets or reads back, and letting the layout
  // lower its attention would be a false negative produced by a diagram decision.
  for (const kind of ['mode', 'flag', 'env', 'outcome']) {
    for (const lane of LANES) {
      assert.equal(bucketForKindLane(kind, lane), 'likely-contract', `${kind}×${lane}`);
    }
  }
});

test('4 · external / artifact / component / state are NEVER informational on KIND alone', () => {
  // Codex's warning: node kind is not a sound public-contract proxy, and the taxonomy has no
  // public-entry-point kind, so public functions commonly land under `component`. The DEFAULT for
  // each of these kinds — the cell reached when the lane says nothing — must therefore be visible.
  for (const kind of ['external', 'artifact', 'component', 'state']) {
    assert.notEqual(bucketForKindLane(kind, undefined), COLLAPSIBLE_BUCKET, `${kind} default`);
    assert.equal(bucketForKindLane(kind, undefined), DEFAULT_BUCKET, `${kind} default`);
  }
});

test('5 · the `external` KIND is never collapsible in ANY lane — jq is the canonical case', () => {
  // An undocumented hard prerequisite is a real install-time defect (`codex-gate` exits 2 when `jq`
  // is absent), not a housekeeping note. There is no lane in which "we depend on something we did
  // not document" is safely collapsible.
  for (const lane of LANES) {
    assert.notEqual(bucketForKindLane('external', lane), COLLAPSIBLE_BUCKET, `external×${lane}`);
  }
});

test('6 · the ONLY collapsible cells are the three implementation nouns in the `core` lane', () => {
  const collapsible = [];
  for (const kind of NODE_KINDS) {
    for (const lane of LANES) {
      if (ATTENTION_TABLE[kind][lane] === COLLAPSIBLE_BUCKET) collapsible.push(`${kind}×${lane}`);
    }
  }
  assert.deepEqual(collapsible.sort(), ['artifact×core', 'component×core', 'state×core']);
});

test('7 · a component in the ENTRY lane is likely-contract — the lane supplies the kind the taxonomy lacks', () => {
  assert.equal(bucketForKindLane('component', 'entry'), 'likely-contract');
  assert.equal(bucketForKindLane('component', 'core'), COLLAPSIBLE_BUCKET);
  assert.equal(bucketForKindLane('component', 'output'), DEFAULT_BUCKET);
  assert.equal(bucketForKindLane('component', 'external'), DEFAULT_BUCKET);
});

test('8 · an unknown kind, lane, or node falls to ambiguous-review, never to a collapsed group', () => {
  for (const [kind, lane] of [['nope', 'core'], ['component', 'nope'], [null, null], [{}, []]]) {
    assert.equal(bucketForKindLane(kind, lane), DEFAULT_BUCKET, `${String(kind)}×${String(lane)}`);
  }
  // A finding whose node is not in the map is the same case: unknown, therefore visible.
  assert.equal(bucketForFinding(finding('UNDOCUMENTED'), undefined), DEFAULT_BUCKET);
  assert.equal(bucketForFinding(finding('UNDOCUMENTED'), null), DEFAULT_BUCKET);
});

test('9 · ONLY an UNDOCUMENTED finding can ever reach the collapsed bucket', () => {
  // PHANTOM, STALE and UNVERIFIED all require somebody to have WRITTEN a claim, so the subject
  // itself has already declared the node part of its documented surface. UNDOCUMENTED is the only
  // class derived from the ABSENCE of documentation, which is why it is the only one that fires
  // mechanically on every internal — and the only one bucketing needs to act on.
  const internal = node('component', 'core');
  assert.equal(bucketForFinding(finding('UNDOCUMENTED'), internal), COLLAPSIBLE_BUCKET);
  for (const cls of NEVER_COLLAPSED_CLASSES) {
    assert.equal(bucketForFinding(finding(cls), internal), DEFAULT_BUCKET, `${cls} was collapsed`);
  }
  assert.deepEqual([...NEVER_COLLAPSED_CLASSES].sort(),
    DRIFT_CLASSES.filter((c) => c !== 'UNDOCUMENTED').sort());
});

test('10 · the class floor RAISES a collapsed cell and never LOWERS a visible one', () => {
  // The floor is one-directional. A STALE on a `mode` stays likely-contract; a STALE on an internal
  // component is lifted to ambiguous-review rather than pushed down to it.
  assert.equal(bucketForFinding(finding('STALE'), node('mode', 'entry')), 'likely-contract');
  assert.equal(bucketForFinding(finding('STALE'), node('component', 'core')), DEFAULT_BUCKET);
  assert.equal(bucketForFinding(finding('PHANTOM'), node('env', 'core')), 'likely-contract');
});

test('11 · an unknown CLASS is treated as never-collapsible — the floor fails safe', () => {
  assert.equal(bucketForFinding(finding('SOMETHING-NEW'), node('component', 'core')), DEFAULT_BUCKET);
  assert.equal(bucketForFinding({ nodeId: 'component.x' }, node('component', 'core')), DEFAULT_BUCKET);
});

test('12 · groupByAttention PARTITIONS: every finding lands in exactly one group, none is dropped', () => {
  const nodes = new Map([
    ['component.helper', node('component', 'core', 'component.helper')],
    ['env.knob', node('env', 'core', 'env.knob')],
    ['external.jq', node('external', 'external', 'external.jq')],
  ]);
  const findings = [
    finding('UNDOCUMENTED', 'env.knob'),
    finding('UNDOCUMENTED', 'external.jq'),
    finding('UNDOCUMENTED', 'component.helper'),
    finding('STALE', 'component.helper'),
  ];
  const groups = groupByAttention(findings, nodes);

  assert.deepEqual(groups.map((g) => g.bucket), [...ATTENTION_BUCKETS]);
  assert.equal(groups.flatMap((g) => g.findings).length, findings.length);
  assert.deepEqual(
    groups.flatMap((g) => g.findings).map((f) => `${f.class}:${f.nodeId}`).sort(),
    findings.map((f) => `${f.class}:${f.nodeId}`).sort(),
  );
  assert.deepEqual(groups.map((g) => g.findings.length), [1, 2, 1]);
});

test('13 · grouping preserves the drift engine\'s reporting order WITHIN a group', () => {
  const nodes = new Map([['env.a', node('env', 'core', 'env.a')], ['env.b', node('env', 'core', 'env.b')]]);
  const findings = [finding('PHANTOM', 'env.a'), finding('UNDOCUMENTED', 'env.b'), finding('STALE', 'env.a')];
  const [contract] = groupByAttention(findings, nodes);
  assert.deepEqual(contract.findings.map((f) => f.class), ['PHANTOM', 'UNDOCUMENTED', 'STALE']);
});

test('14 · grouping is PRESENTATION ONLY — it never mutates a finding nor adds a key to one', () => {
  const nodes = new Map([['component.helper', node('component', 'core', 'component.helper')]]);
  const one = finding('UNDOCUMENTED', 'component.helper');
  const before = JSON.stringify(one);
  const groups = groupByAttention([one], nodes);
  assert.equal(JSON.stringify(one), before);
  assert.equal(JSON.stringify(groups[2].findings[0]), before);
  assert.deepEqual(Object.keys(groups[2].findings[0]).sort(),
    ['citations', 'class', 'detail', 'label', 'nodeId']);
});

test('15 · computeDrift knows nothing about buckets — the raw layer is untouched', () => {
  // The drift engine must not import this module, or "presentation only" stops being true and
  // `drift.json` starts carrying a judgement it did not compute (ADR C-004).
  const map = {
    schemaVersion: '1',
    // ADR C-018 — UNDOCUMENTED needs a COMPLETE documentation harvest behind it, and completeness is
    // derived by comparing `searched` against the map's declared `role: "doc"` sources. A map that
    // declares none puts every node in state 3 (nowhere to look is not "nothing to find"), so the
    // surface is declared here and the node records having read it. Both halves are load-bearing.
    sources: [{ path: 'a/SKILL.md', role: 'doc' }, { path: 'a.sh', role: 'code' }],
    coverage: { read: ['a/SKILL.md', 'a.sh'], partial: [], skipped: [] },
    nodes: [{
      id: 'component.helper', kind: 'component', lane: 'core', label: 'helper', inferred: false,
      evidence: [{ path: 'a.sh', line: 3, note: 'helper() {' }], claims: [],
      docHarvest: { searched: ['a/SKILL.md'], candidates: [] },
    }],
  };
  const { findings } = computeDrift(map);
  assert.equal(findings.length, 1);
  assert.deepEqual(Object.keys(findings[0]).sort(), ['citations', 'class', 'detail', 'label', 'nodeId']);
  assert.equal(bucketForFinding(findings[0], map.nodes[0]), COLLAPSIBLE_BUCKET);
});

test('16 · BUCKET_META covers every bucket, and exactly one bucket is collapsible', () => {
  assert.deepEqual(Object.keys(BUCKET_META).sort(), [...ATTENTION_BUCKETS].sort());
  const collapsible = ATTENTION_BUCKETS.filter((b) => BUCKET_META[b].collapsible === true);
  assert.deepEqual(collapsible, [COLLAPSIBLE_BUCKET]);
  for (const bucket of ATTENTION_BUCKETS) {
    assert.equal(typeof BUCKET_META[bucket].title, 'string');
    assert.ok(BUCKET_META[bucket].title.trim() !== '');
    assert.ok(BUCKET_META[bucket].blurb.trim() !== '');
  }
});

test('17 · groupByAttention fails closed on a findings list it cannot partition', () => {
  assert.throws(() => groupByAttention(undefined, new Map()), /findings/);
  assert.throws(() => groupByAttention([finding('STALE')], undefined), /nodeById/);
});
