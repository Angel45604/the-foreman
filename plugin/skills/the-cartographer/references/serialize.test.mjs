import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalize, serialize } from './serialize.mjs';

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

test('8 · serialize FAILS CLOSED on an ISO-8601-shaped string anywhere (ADR C-003)', () => {
  const clean = scrambledMap();
  assert.doesNotThrow(() => serialize(clean));

  const nested = scrambledMap();
  nested.nodes[0].summary = 'observed at 2026-08-11T13:45:00.000Z';
  assert.throws(() => serialize(nested), /timestamp/i);

  const top = scrambledMap();
  top.generatedAt = '2026-08-11T13:45:00Z';
  assert.throws(() => serialize(top), /timestamp/i);

  const dateOnly = scrambledMap();
  dateOnly.subject.summary = '2026-08-11';
  assert.throws(() => serialize(dateOnly), /timestamp/i);

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

test('13 · the C-003 guard closes the BASIC calendar-date VALUE (20260811) it used to let through', () => {
  // FAIL-OPEN: `"2026-08-11"` was rejected as a whole value while its BASIC-form spelling — exactly
  // what `date +%Y%m%d` produces — serialized straight into map.json. ADR C-003 prohibits an
  // ISO-8601-shaped timestamp generally, not one spelling of it.
  const asValue = scrambledMap();
  asValue.nodes[0].attrs = { generated: '20260811' };
  assert.throws(() => serialize(asValue), /timestamp/i);

  const asKey = scrambledMap();
  asKey.nodes[0].attrs = { 20260811: 'run' };
  assert.throws(() => serialize(asKey), /timestamp/i);

  const boundaries = ['19000101', '21991231', '20260229', '20261131'];
  for (const d of boundaries) {
    const m = scrambledMap();
    m.nodes[1].attrs = { generated: d };
    assert.throws(() => serialize(m), /timestamp/i, `${d} is date-shaped`);
  }
});

test('13 · …without firing on an 8-digit value that is genuinely NOT a date', () => {
  // The whole point of the narrowed rule: a bare run of 8 digits is only a timestamp when it can
  // actually BE one. A count, an id, or a hex prefix that fails the calendar shape must pass.
  const notDates = [
    '20261301',   // month 13
    '20260832',   // day 32
    '20260800',   // day 00
    '20261000',   // day 00
    '12345678',   // year 1234 (outside the wall-clock band) and month 34
    '99999999',
    '00000000',
    '20260811abcdef01',   // a hash prefix that merely STARTS with a date-shaped run
    'a20260811',
  ];
  for (const v of notDates) {
    const m = scrambledMap();
    m.nodes[0].attrs = { id: v };
    assert.doesNotThrow(() => serialize(m), `${v} is not a wall-clock timestamp`);
  }

  // a NUMBER is never a timestamp field — `"lines": 20260811` is a count, not a date
  const numeric = scrambledMap();
  numeric.nodes[0].attrs = { lines: 20260811, count: 20260811 };
  assert.doesNotThrow(() => serialize(numeric));

  // and the dated-PATH carve-out holds in BASIC form too, exactly as it does in extended form
  const basicPath = scrambledMap();
  basicPath.nodes[1].summary = 'see docs/initiatives/20260811-the-cartographer/PDR.md';
  assert.doesNotThrow(() => serialize(basicPath));
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

test('14 · …and a generated date EMBEDDED IN PROSE, which the whole-value carve-out let through', () => {
  // FAIL-OPEN: narrowing the bare-date rule to a whole string value (quote to quote) — the carve-out
  // that keeps a dated PATH passing — also exempted every date written into a sentence, which is
  // how a generation stamp actually reaches a summary.
  const prose = [
    'generated on 2026-08-11',
    'snapshot taken 2026-08-11 by the extractor',
    'as of 20260811, before the rename',
    'extracted 2026-08-11.',
    'run 20260811 of the audit',
  ];
  for (const text of prose) {
    const m = scrambledMap();
    m.nodes[1].summary = text;
    assert.throws(() => serialize(m), /timestamp/i, `a date inside ${JSON.stringify(text)}`);
  }

  // the dated-PATH carve-out is exactly that — a PATH. One string may carry both, and the path must
  // not launder the stamp beside it.
  const both = scrambledMap();
  both.nodes[1].summary = 'see docs/initiatives/2026-08-11-the-cartographer/PDR.md — generated 2026-08-12';
  assert.throws(() => serialize(both), /timestamp/i);
});

test('14 · …while a dated PATH, a coarser date, and a non-date digit run all still pass', () => {
  const allowed = [
    // the required carve-out, in both spellings, bare and inside a sentence
    'docs/initiatives/2026-08-11-the-cartographer/PDR.md',
    'see docs/initiatives/2026-08-11-the-cartographer/PDR.md',
    'docs/initiatives/20260811-the-cartographer/PDR.md',
    'logs/2026-08-11/run.json',
    // coarser than a day: indistinguishable from a version or an id, so deliberately NOT matched
    '2026-08', 'v2026', 'schema 2026',
    // eight digits that cannot BE a date, and date-shaped runs glued to more alphanumerics
    '20261301', '20260832', '12345678', '99999999', '20260811abcdef01', 'a20260811',
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

  // …but a full date-TIME is refused even inside a path token: a stamped directory IS a stamp
  const stampedDir = scrambledMap();
  stampedDir.nodes[1].summary = 'logs/20260811T1345/run.json';
  assert.throws(() => serialize(stampedDir), /timestamp/i);
});

test('9 · the committed fixture is ALREADY canonical — re-serializing it is byte-identical', () => {
  const text = fs.readFileSync(FIXTURE, 'utf8');
  assert.equal(serialize(JSON.parse(text)), text);
  // and serializing is idempotent, which is what Phase 6's structural diff rests on
  assert.equal(serialize(JSON.parse(serialize(JSON.parse(text)))), text);
});
