import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalize, serialize } from './serialize.mjs';
import { computeDrift } from './diff.mjs';

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'tiny.map.json');

// A representative map exercising every ordered/unordered array in the IR (PDR §7).
// Deliberately emitted in "extractor order" — i.e. wrong order everywhere.
function scrambledMap() {
  return {
    schemaVersion: '1',
    extractorVersion: '1.0.0',
    subject: { slug: 'tiny', kind: 'skill', root: 'fx/tiny', title: 'tiny', summary: 'a subject' },
    sources: [
      { path: 'fx/tiny/run.sh', sha256: 'b'.repeat(64), lines: 24, role: 'code' },
      { path: 'fx/tiny/SKILL.md', sha256: 'a'.repeat(64), lines: 18, role: 'doc' },
    ],
    coverage: {
      read: ['fx/tiny/run.sh', 'fx/tiny/SKILL.md'],
      partial: [{ path: 'fx/tiny/z.sh', why: 'budget' }, { path: 'fx/tiny/a.sh', why: 'budget' }],
      skipped: [{ path: 'fx/tiny/y.sh', why: 'binary' }, { path: 'fx/tiny/b.sh', why: 'binary' }],
    },
    nodes: [
      {
        id: 'mode.check', kind: 'mode', label: 'check', lane: 'entry', summary: 'z', inferred: false,
        evidence: [
          { path: 'fx/tiny/run.sh', line: 10, note: 'ten' },
          { path: 'fx/tiny/run.sh', line: 9, note: 'zulu' },
          { path: 'fx/tiny/run.sh', line: 9, note: 'alpha' },
        ],
        claims: [
          { path: 'fx/tiny/SKILL.md', line: 8, text: 'second', claimKind: 'doc' },
          { path: 'fx/tiny/SKILL.md', line: 7, text: 'first', claimKind: 'doc' },
        ],
        contradictions: [
          { claim: { path: 'fx/tiny/SKILL.md', line: 8, text: 'second' },
            evidence: { path: 'fx/tiny/run.sh', line: 9, note: 'zulu' }, statement: 'z-conflict' },
          { claim: { path: 'fx/tiny/SKILL.md', line: 7, text: 'first' },
            evidence: { path: 'fx/tiny/run.sh', line: 9, note: 'alpha' }, statement: 'a-conflict' },
        ],
      },
      {
        id: 'component.core', kind: 'component', label: 'core', lane: 'core', summary: 'a', inferred: false,
        evidence: [{ path: 'fx/tiny/run.sh', line: 6, note: 'core' }], claims: [],
      },
    ],
    edges: [
      { id: 'e.data.mode.check>component.core', from: 'mode.check', to: 'component.core',
        label: 'passes', kind: 'data',
        evidence: [{ path: 'fx/tiny/run.sh', line: 12 }, { path: 'fx/tiny/run.sh', line: 11 }] },
      { id: 'e.control.mode.check>component.core', from: 'mode.check', to: 'component.core',
        label: 'calls', kind: 'control', evidence: [{ path: 'fx/tiny/run.sh', line: 12 }] },
    ],
    views: [
      { id: 'overview', form: 'svg-hero', title: 'Overview',
        nodes: ['mode.check', 'component.core'],
        edges: ['e.data.mode.check>component.core', 'e.control.mode.check>component.core'] },
      { id: 'capabilities', form: 'table', title: 'Capabilities',
        columns: ['Capability', 'Kind', 'Evidence', 'Documented'], nodes: ['mode.check'] },
    ],
  };
}

const parsed = () => JSON.parse(serialize(scrambledMap()));

test('1 · object keys serialize in sorted order and the text ends with a newline', () => {
  const text = serialize(scrambledMap());
  assert.ok(text.endsWith('\n'), 'must end with a newline');
  const topKeys = [...text.matchAll(/^ {2}"([^"]+)":/gm)].map((m) => m[1]);
  assert.deepEqual(topKeys, [...topKeys].sort(), 'top-level keys must be sorted');
  const nodeKeys = [...text.matchAll(/^ {6}"([^"]+)":/gm)].map((m) => m[1]);
  assert.ok(nodeKeys.length > 0);
  // every nested object's key run is sorted too
  const obj = JSON.parse(text);
  const check = (v, where) => {
    if (Array.isArray(v)) return v.forEach((x, i) => check(x, `${where}[${i}]`));
    if (v && typeof v === 'object') {
      assert.deepEqual(Object.keys(v), [...Object.keys(v)].sort(), `${where} keys sorted`);
      for (const [k, val] of Object.entries(v)) check(val, `${where}.${k}`);
    }
  };
  check(obj, 'map');
});

test('2 · nodes/edges/views sort by id and sources by path', () => {
  const m = parsed();
  assert.deepEqual(m.nodes.map((n) => n.id), ['component.core', 'mode.check']);
  assert.deepEqual(m.edges.map((e) => e.id),
    ['e.control.mode.check>component.core', 'e.data.mode.check>component.core']);
  assert.deepEqual(m.views.map((v) => v.id), ['capabilities', 'overview']);
  assert.deepEqual(m.sources.map((s) => s.path), ['fx/tiny/SKILL.md', 'fx/tiny/run.sh']);
});

test('3 · every semantically unordered nested array sorts', () => {
  const m = parsed();
  const overview = m.views.find((v) => v.id === 'overview');
  assert.deepEqual(overview.nodes, ['component.core', 'mode.check']);
  assert.deepEqual(overview.edges,
    ['e.control.mode.check>component.core', 'e.data.mode.check>component.core']);
  const check = m.nodes.find((n) => n.id === 'mode.check');
  assert.deepEqual(check.claims.map((c) => c.line), [7, 8]);
  assert.deepEqual(check.contradictions.map((c) => c.statement), ['a-conflict', 'z-conflict']);
  const dataEdge = m.edges.find((e) => e.kind === 'data');
  assert.deepEqual(dataEdge.evidence.map((e) => e.line), [11, 12]);
  assert.deepEqual(m.coverage.read, ['fx/tiny/SKILL.md', 'fx/tiny/run.sh']);
  assert.deepEqual(m.coverage.partial.map((p) => p.path), ['fx/tiny/a.sh', 'fx/tiny/z.sh']);
  assert.deepEqual(m.coverage.skipped.map((p) => p.path), ['fx/tiny/b.sh', 'fx/tiny/y.sh']);
});

test('4 · view.columns is presentation order and is NOT sorted', () => {
  const caps = parsed().views.find((v) => v.id === 'capabilities');
  assert.deepEqual(caps.columns, ['Capability', 'Kind', 'Evidence', 'Documented']);
});

test('5 · citations sort by path, then NUMERICALLY by line, then by a total content order', () => {
  const check = parsed().nodes.find((n) => n.id === 'mode.check');
  // 9 before 10 — a string sort would put "10" first.
  assert.deepEqual(check.evidence.map((e) => e.line), [9, 9, 10]);
  // same path + same line: broken by full record content, never by extractor order.
  assert.deepEqual(check.evidence.slice(0, 2).map((e) => e.note), ['alpha', 'zulu']);
  // and the tie-break is stable when the input order is reversed
  const flipped = scrambledMap();
  const ev = flipped.nodes[0].evidence;
  flipped.nodes[0].evidence = [ev[1], ev[2], ev[0]];
  const again = JSON.parse(serialize(flipped)).nodes.find((n) => n.id === 'mode.check');
  assert.deepEqual(again.evidence.map((e) => e.note), ['alpha', 'zulu', 'ten']);
});

test('6 · re-ordering any input array does not change serialize() output', () => {
  const a = scrambledMap();
  const b = scrambledMap();
  const check = b.nodes.find((n) => n.id === 'mode.check');
  const overview = b.views.find((v) => v.id === 'overview');
  check.claims.reverse();
  check.contradictions.reverse();
  check.evidence.reverse();
  overview.nodes.reverse();
  overview.edges.reverse();
  b.nodes.reverse();
  b.edges.reverse();
  b.views.reverse();
  b.sources.reverse();
  b.coverage.read.reverse();
  b.coverage.partial.reverse();
  b.coverage.skipped.reverse();
  assert.equal(serialize(b), serialize(a));
});

test('7 · normalize does not mutate its argument and returns a fresh object', () => {
  const input = scrambledMap();
  const before = JSON.parse(JSON.stringify(input));
  const out = normalize(input);
  assert.deepEqual(input, before, 'input must be untouched');
  assert.notEqual(out, input);
  assert.notEqual(out.nodes, input.nodes);
  // and it really did normalize
  assert.deepEqual(out.nodes.map((n) => n.id), ['component.core', 'mode.check']);
});

test('8 · serialize FAILS CLOSED on an ISO-8601 date-TIME anywhere (ADR C-003)', () => {
  const clean = scrambledMap();
  assert.doesNotThrow(() => serialize(clean));

  const nested = scrambledMap();
  nested.nodes[0].summary = 'observed at 2026-08-11T13:45:00.000Z';
  assert.throws(() => serialize(nested), /timestamp/i);

  const top = scrambledMap();
  top.generatedAt = '2026-08-11T13:45:00Z';
  assert.throws(() => serialize(top), /timestamp/i);

  // A BARE date is not a wall-clock timestamp (C-003 as amended 2026-08-13) — see test 13.
  const dateOnly = scrambledMap();
  dateOnly.subject.summary = '2026-08-11';
  assert.doesNotThrow(() => serialize(dateOnly));

  const spaced = scrambledMap();
  spaced.nodes[1].summary = 'run 2026-08-11 13:45';
  assert.throws(() => serialize(spaced), /timestamp/i);

  // A `Date` is refused one stage EARLIER than it used to be, and this asserts the new reason rather
  // than the old one. It used to reach `JSON.stringify`, which rendered it as an ISO string that the
  // guard below then caught — a backstop a `Map` or a `Set` never had, since those render as `{}`.
  // The ingest boundary now refuses all three before a byte is written, in the words `validate()`
  // reports for the same value, so the map that validates is the map that is written. Still fail
  // closed, still naming the timestamp risk; earlier, and for the reason that covers every exotic.
  const dateObject = scrambledMap();
  dateObject.nodes[0].attrs = { seen: new Date(0) };
  assert.throws(() => serialize(dateObject), (e) => {
    assert.match(e.message, /nodes\[0\]\.attrs\.seen/, 'the refusal must name the slot');
    assert.match(e.message, /Date/);
    assert.match(e.message, /timestamp/i, 'and still say what a Date in the snapshot would cost');
    return true;
  });
  // …and the C-003 guard itself is untouched: the same instant WRITTEN AS A STRING — which is what
  // `JSON.stringify` used to make of that Date — is still refused as a wall-clock timestamp.
  const dateString = scrambledMap();
  dateString.nodes[0].attrs = { seen: new Date(0).toISOString() };
  assert.throws(() => serialize(dateString), /timestamp/i);

  // a date-shaped substring inside a longer path is NOT a wall-clock field and must pass
  const datedPath = scrambledMap();
  datedPath.nodes[1].summary = 'see docs/initiatives/2026-08-11-the-cartographer/PDR.md';
  assert.doesNotThrow(() => serialize(datedPath));
});

test('10 · an own "__proto__" key is DATA: it survives normalization and reaches the C-003 guard', () => {
  // Rebuilding with `out[key] = value` treats an own `__proto__` key as a PROTOTYPE MUTATION: the
  // subtree is silently dropped from the output, so a timestamp hiding inside it never reaches the
  // ADR C-003 guard. JSON.parse is how a map.json actually arrives, and it makes an OWN property.
  const hidden = scrambledMap();
  hidden.nodes[0].attrs = JSON.parse('{"__proto__": {"seen": "2026-08-11T13:45:00Z"}}');
  assert.throws(() => serialize(hidden), /timestamp/i);

  // …and timestamp-free `__proto__` data must be CARRIED, not silently dropped.
  const carried = scrambledMap();
  carried.nodes[0].attrs = JSON.parse('{"__proto__": {"default": "none"}, "k": 1}');
  const normalized = normalize(carried).nodes.find((n) => n.id === 'mode.check');
  assert.ok(Object.hasOwn(normalized.attrs, '__proto__'), 'normalize must keep it as an own key');
  assert.equal(Object.getPrototypeOf(normalized.attrs), Object.prototype, 'and NOT mutate the prototype');
  const round = JSON.parse(serialize(carried)).nodes.find((n) => n.id === 'mode.check');
  assert.ok(Object.hasOwn(round.attrs, '__proto__'), 'and it must survive serialization');
  assert.deepEqual(Object.getOwnPropertyDescriptor(round.attrs, '__proto__').value, { default: 'none' });
});

test('11 · the C-003 guard also catches ISO-8601 BASIC form (20260811T134500Z)', () => {
  const basic = scrambledMap();
  basic.nodes[0].summary = 'observed at 20260811T134500Z';
  assert.throws(() => serialize(basic), /timestamp/i);

  const basicNoSeconds = scrambledMap();
  basicNoSeconds.nodes[1].summary = 'observed at 20260811T1345';
  assert.throws(() => serialize(basicNoSeconds), /timestamp/i);

  const mixed = scrambledMap();
  mixed.nodes[0].summary = 'observed at 2026-08-11T134500';
  assert.throws(() => serialize(mixed), /timestamp/i);

  // the dated-PATH carve-out is unchanged — a date inside a longer path is not a wall-clock field
  const datedPath = scrambledMap();
  datedPath.nodes[1].summary = 'see docs/initiatives/2026-08-11-the-cartographer/PDR.md';
  assert.doesNotThrow(() => serialize(datedPath));
});

test('12 · presentation order is keyed on the IR LOCATION (views[].columns), not on the key NAME', () => {
  // `nodes[].attrs` is arbitrary extractor data, so an `attrs.columns` array is NOT the specified
  // ordered array — two maps differing only in its order must serialize identically.
  const a = scrambledMap();
  const b = scrambledMap();
  a.nodes[0].attrs = { columns: ['zulu', 'alpha'] };
  b.nodes[0].attrs = { columns: ['alpha', 'zulu'] };
  assert.equal(serialize(a), serialize(b));
  const attrs = JSON.parse(serialize(a)).nodes.find((n) => n.id === 'mode.check').attrs;
  assert.deepEqual(attrs.columns, ['alpha', 'zulu']);

  // …while the one specified ordered array still keeps presentation order.
  assert.deepEqual(JSON.parse(serialize(a)).views.find((v) => v.id === 'capabilities').columns,
    ['Capability', 'Kind', 'Evidence', 'Documented']);
});

test('13 · a BARE DATE is source text, not a stamp — carried in EVERY position (C-003, amended)', () => {
  // FAIL-CLOSED TOO HARD: the guard refused bare dates as well as date-times, and that refused the
  // first REAL subject the pipeline was pointed at — its map quotes a README line carrying a release
  // date, verbatim source text the extractor is required to record, and no page could be rendered at
  // all. A generation stamp is always a date-TIME (`new Date().toISOString()` makes one); a bare date
  // is ordinary source text — a changelog line, a version note, a dated directory — so refusing it
  // blocked legitimate maps while preventing no churn. Owner-authorized 2026-08-13.

  // the exact line that failed on the first real subject
  const realSubject = scrambledMap();
  realSubject.nodes[0].claims = [{
    path: 'fx/tiny/SKILL.md', line: 7, claimKind: 'doc',
    text: 'The printed PASS= count is the authoritative assert total (245 as of 2026-08-01)',
  }];
  assert.doesNotThrow(() => serialize(realSubject));

  // as the WHOLE VALUE, in both spellings
  for (const d of ['2026-08-01', '20260801', '2026-08-11', '20260811', '19000101', '21991231']) {
    const m = scrambledMap();
    m.nodes[0].attrs = { released: d };
    assert.doesNotThrow(() => serialize(m), `${d} is a bare date, not a wall-clock stamp`);
  }

  // as a KEY, in both spellings
  const asKey = scrambledMap();
  asKey.nodes[0].attrs = { '2026-08-01': 'release', 20260811: 'run' };
  assert.doesNotThrow(() => serialize(asKey));

  // embedded in PROSE — a quoted release line is the commonest shape of all
  const prose = [
    'released 2026-08-01',
    'generated on 2026-08-11',
    'snapshot taken 2026-08-11 by the extractor',
    'as of 20260811, before the rename',
    'extracted 2026-08-11.',
    'run 20260811 of the audit',
  ];
  for (const text of prose) {
    const m = scrambledMap();
    m.nodes[1].summary = text;
    assert.doesNotThrow(() => serialize(m), `a bare date inside ${JSON.stringify(text)}`);
  }

  // and in a PATH, which needs no carve-out of its own once a bare date is allowed outright
  for (const text of [
    'docs/initiatives/2026-08-11-the-cartographer/PDR.md',
    'see docs/initiatives/2026-08-11-the-cartographer/PDR.md',
    'docs/initiatives/20260811-the-cartographer/PDR.md',
    'logs/2026-08-11/run.json',
    'see docs/initiatives/2026-08-11-the-cartographer/PDR.md — released 2026-08-12',
  ]) {
    const m = scrambledMap();
    m.nodes[1].summary = text;
    assert.doesNotThrow(() => serialize(m), `${JSON.stringify(text)} carries only bare dates`);
  }
});

test('14 · the C-003 guard closes REDUCED-PRECISION date-times — an hour is a wall clock too', () => {
  // FAIL-OPEN: the date-time shape demanded MINUTE precision (`\d{2}:?\d{2}`), so every ISO
  // reduced-precision spelling that stops at the hour serialized straight into map.json — and an
  // hourly stamp churns the structural diff exactly as a minute-precise one does.
  const reduced = [
    '2026-08-11T13Z', '2026-08-11T13', '2026-08-11 13', '2026-08-11T13+02:00',
    '20260811T13', '20260811T13Z', '20260811T1345', '20260811T134500Z',
    '2026-08-11T13:45', '2026-08-11T13:45:00.000Z',
  ];
  for (const stamp of reduced) {
    const m = scrambledMap();
    m.nodes[0].attrs = { generated: stamp };
    assert.throws(() => serialize(m), /timestamp/i, `${stamp} is a wall-clock stamp`);
  }
});

test('14 · …and a date-TIME is refused WHEREVER it sits — value, key, prose or path', () => {
  // The narrowing is to the SHAPE, never to the position: a stamp reaches the snapshot as a summary
  // sentence or a stamped directory name just as readily as it reaches a dedicated field.
  const asKey = scrambledMap();
  asKey.nodes[0].attrs = { '2026-08-11T13:45': 'run' };
  assert.throws(() => serialize(asKey), /timestamp/i);

  const prose = ['generated on 2026-08-11T13:45Z', 'snapshot taken 20260811T1345 by the extractor'];
  for (const text of prose) {
    const m = scrambledMap();
    m.nodes[1].summary = text;
    assert.throws(() => serialize(m), /timestamp/i, `a date-time inside ${JSON.stringify(text)}`);
  }

  // a stamped DIRECTORY is still a stamp — being part of a path exempts nothing
  const stampedDir = scrambledMap();
  stampedDir.nodes[1].summary = 'logs/20260811T1345/run.json';
  assert.throws(() => serialize(stampedDir), /timestamp/i);

  // …and a legitimate dated path beside it does not launder it
  const both = scrambledMap();
  both.nodes[1].summary =
    'see docs/initiatives/2026-08-11-the-cartographer/PDR.md — generated 2026-08-12T09:00Z';
  assert.throws(() => serialize(both), /timestamp/i);
});

test('14 · …while a coarser date, a bare time and a non-date digit run all still pass', () => {
  const allowed = [
    // coarser than a day: indistinguishable from a version or an id, so deliberately NOT matched
    '2026-08', 'v2026', 'schema 2026',
    // eight digits that are plainly data, and date-shaped runs glued to more alphanumerics
    '20261301', '20260832', '20260800', '20261000', '12345678', '99999999', '00000000',
    '20260811abcdef01', 'a20260811',
    // a time with no date is not a wall-clock STAMP — it is a duration or a clock face
    '13:45', 'runs at 13:45:00',
  ];
  for (const text of allowed) {
    const m = scrambledMap();
    m.nodes[0].attrs = { note: text };
    assert.doesNotThrow(() => serialize(m), `${JSON.stringify(text)} is not a wall-clock timestamp`);
  }

  // a JSON NUMBER is never a date field — the guard reads string tokens only
  const numeric = scrambledMap();
  numeric.nodes[0].attrs = { lines: 20260811, count: 20261231 };
  assert.doesNotThrow(() => serialize(numeric));
});

test('9 · the committed fixture is ALREADY canonical — re-serializing it is byte-identical', () => {
  const text = fs.readFileSync(FIXTURE, 'utf8');
  assert.equal(serialize(JSON.parse(text)), text);
  // and serializing is idempotent, which is what Phase 6's structural diff rests on
  assert.equal(serialize(JSON.parse(serialize(JSON.parse(text)))), text);
});

test('15 · a finding\'s citations are ORDERED — the refuted claim stays first, whatever it sorts as', () => {
  // C-019 makes a STALE finding's citation list a SENTENCE: citation one is the claim the evidence
  // refutes — the text a maintainer must change — and citation two is what was observed. `diff.mjs`
  // emits them in that order deliberately (`[sides.claim, sides.evidence]`).
  //
  // `drift.json` is written through this module, and every array here was unordered by default, so
  // the two citations were re-sorted by path. Whenever the claim's path sorts AFTER the evidence's —
  // a STALE claim in `z-doc.md` refuted by code in `a-code.sh` — the persisted artifact swapped the
  // roles, and every later reader of `drift.json` (a re-render included) read the evidence as the
  // thing to fix. Ordering is not presentation here; it is which line a maintainer edits.
  const drift = {
    schemaVersion: '1',
    subject: { slug: 'tiny', kind: 'skill' },
    findings: [{
      class: 'STALE',
      nodeId: 'component.tiny_core',
      label: 'tiny_core',
      detail: 'the doc says every mode calls it; only two do',
      refutedQuote: 'every mode calls',
      citations: [
        { path: 'fx/tiny/z-doc.md', line: 16, text: '`tiny_core` is the shared routine every mode calls.' },
        { path: 'fx/tiny/a-code.sh', line: 4, note: 'called from mode_a and mode_b only' },
      ],
    }],
  };

  const out = JSON.parse(serialize(drift));
  assert.deepEqual(out.findings[0].citations.map((c) => c.path),
    ['fx/tiny/z-doc.md', 'fx/tiny/a-code.sh'],
    'the refuted claim is citation one even when its path sorts last');

  // …and the exemption is keyed on the IR LOCATION, exactly as `views.*.columns` is: an array merely
  // NAMED `citations` somewhere else in the document is still unordered, or the exemption would be a
  // hole rather than a rule.
  const elsewhere = {
    schemaVersion: '1',
    subject: { slug: 'tiny', kind: 'skill' },
    findings: [],
    notes: { citations: ['z', 'a'] },
  };
  assert.deepEqual(JSON.parse(serialize(elsewhere)).notes.citations, ['a', 'z']);

  // Idempotent, which is what Phase 6's structural diff rests on: a preserved order must survive a
  // second pass unchanged rather than settle into sorted order one regeneration later.
  assert.equal(serialize(JSON.parse(serialize(drift))), serialize(drift));

  // THE EXEMPTION IS PATH-WIDE, AND THE SENTENCE ARGUMENT IS NOT (round-7 gate). C-019 makes the
  // order semantic for STALE — claim first, evidence second. For PHANTOM, UNDOCUMENTED and UNVERIFIED
  // a citation list is an unordered SET, yet `findings.*.citations` exempts them too, so emission
  // order leaks into the canonical artifact: the two serializations below differ only in the order
  // they were handed, and they differ in bytes.
  const phantom = (cits) => ({
    schemaVersion: '1',
    subject: { slug: 'tiny', kind: 'skill' },
    findings: [{ class: 'PHANTOM', nodeId: 'component.x', label: 'x', detail: 'd', citations: cits }],
  });
  const first = { path: 'fx/z-doc.md', line: 16, text: 'second' };
  const second = { path: 'fx/a-code.sh', line: 4, text: 'first' };
  // CLOSED, not documented (round-9 gate). Two earlier revisions handled this wrong in opposite
  // directions: one asserted `notEqual`, which PINNED order-preserving output as a requirement; the
  // next removed the assertion and called the gap unclosable because the exemption is keyed on the IR
  // location `findings.*.citations`, which cannot see the sibling `class`. It can — `normalizeValue`
  // now takes the containing record, and the exemption applies only where C-019 makes the order a
  // SENTENCE. So the module's total-order promise is true as written for every other class.
  assert.equal(serialize(phantom([first, second])), serialize(phantom([second, first])),
    'a PHANTOM finding\'s citations are a SET — two documents differing only in emission order must '
    + 'serialize to identical bytes, which is what this module promises');

  // WHY THAT IS NOT A LIVE DEFECT, and the property that actually holds end to end: `diff.mjs` sorts
  // every set-valued class through `compareCitations` before emitting, so a `drift.json` this pipeline
  // writes is deterministic whatever order the records were built in. The limit is that the SERIALIZER
  // alone does not guarantee it — a hand-built or third-party drift document could carry either order
  // and both would serialize clean. Closing it means keying the exemption on the finding's class,
  // which the IR-location rule cannot express today.
});

test('15b · the classes whose citations are a SET arrive sorted from diff.mjs, whatever order they are built in', () => {
  const build = (claims) => ({
    id: 'component.x', kind: 'component', label: 'x', summary: 's',
    claims, evidence: [],
  });
  const a = { path: 'fx/a-code.sh', line: 4, text: 'first', claimKind: 'doc', checked: true };
  const z = { path: 'fx/z-doc.md', line: 16, text: 'second', claimKind: 'doc', checked: true };
  const cite = (node) => {
    const m = { schemaVersion: '1', subject: { slug: 'tiny', kind: 'skill' }, nodes: [node], edges: [], views: [], sources: [], coverage: { read: [], skipped: [], partial: [] } };
    const f = computeDrift(m).findings.find((x) => x.nodeId === 'component.x');
    return f ? f.citations.map((c) => c.path) : null;
  };
  const forward = cite(build([a, z]));
  const backward = cite(build([z, a]));
  assert.deepEqual(forward, backward,
    'a PHANTOM built in either order must cite in ONE order — this is what makes the artifact '
    + 'deterministic despite the serializer exemption above');

});
