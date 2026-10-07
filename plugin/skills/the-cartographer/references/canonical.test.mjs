// the-cartographer — the ingest boundary's own tests.
//
// Everything else in this directory now reads its input through `canonical.mjs`, so what is asserted
// here is the property the rest of the pipeline is entitled to assume: what comes out of the boundary
// is EXACTLY what `map.json` would carry, and the two policies — report (for `validate()`) and fail
// closed (for every consumer) — refuse the same shapes for the same stated reason.
//
// Zero dependencies: node built-ins only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ABSENT, ingest, ingestStrict } from './canonical.mjs';

const strict = (v) => ingestStrict(v, { at: '', frame: (at, reason) => `${at} ${reason}` });

/**
 * Every shape the boundary refuses, and the word each refusal must contain. One table, walked by both
 * policies below: a rule that fired in only one of them is the asymmetry this module exists to end.
 */
const refused = [
  ['an ACCESSOR own property', () => {
    const o = { k: 1 };
    Object.defineProperty(o, 'seen', { get: () => 'x', enumerable: true, configurable: true });
    return o;
  }, /accessor/i],
  ['a NON-ENUMERABLE own property', () => {
    const o = { k: 1 };
    Object.defineProperty(o, 'seen', { value: 'x', enumerable: false, configurable: true });
    return o;
  }, /enumerable/i],
  ['a SYMBOL-keyed own property', () => ({ k: 1, [Symbol('seen')]: 'x' }), /symbol/i],
  ['a HOLE in a sparse array', () => { const a = [1, 2, 3]; delete a[1]; return { a }; }, /hole|sparse/i],
  ['an own NON-INDEX property on an array', () => { const a = [1]; a.seen = 'x'; return { a }; }, /own property on an ARRAY/],
  ['an EXOTIC object — a Date', () => ({ seen: new Date(0) }), /Date/],
  ['an EXOTIC object — a Map', () => ({ seen: new Map([['k', 1]]) }), /Map/],
  ['an EXOTIC object — a Set', () => ({ seen: new Set([1]) }), /Set/],
  // Two the SLOT-based brand table reaches and the tag-based one did not. `util.types` has no
  // predicate for a `WeakRef`, so it is brand-checked with a built-in that requires the slot; and a
  // PROXY answers for its target rather than from slots of its own, so it is judged by what it
  // presents — which is what keeps a proxied `Map` refused instead of quietly rebuilt as `{}`.
  ['an EXOTIC object — a WeakRef', () => ({ seen: new WeakRef({}) }), /WeakRef/],
  ['an EXOTIC hidden behind a PROXY', () => ({ seen: new Proxy(new Map([['k', 1]]), {}) }), /Map/],
  ['an own property whose value is undefined', () => ({ k: undefined }), /undefined/i],
  ['an undefined ARRAY element', () => ({ a: [1, undefined] }), /undefined/i],
  ['a function', () => ({ k: () => 1 }), /function/],
  ['a BigInt', () => ({ k: 1n }), /bigint/i],
  ['NaN', () => ({ k: NaN }), /NaN/],
  ['Infinity', () => ({ k: Infinity }), /Infinity/],
  ['a cycle', () => { const o = { k: 1 }; o.self = o; return o; }, /circular|cycle/i],
];

test('1 · both policies refuse the SAME shapes, for the same stated reason', () => {
  // This is the whole architecture in one assertion. `validate()` reports and never throws; the
  // consumers throw and never report; and neither of them owns a rule, so a value one refuses is a
  // value the other refuses, saying the same thing about it. Three phases of review each closed a
  // round on a shape where those two answers came apart.
  for (const [what, make, reason] of refused) {
    const reported = ingest(make());
    assert.ok(reported.errors.length > 0, `${what}: the reporting policy must report it`);
    assert.ok(reported.errors.some((e) => reason.test(e)),
      `${what}: the report must state ${reason} — got ${JSON.stringify(reported.errors)}`);

    let thrown = null;
    assert.throws(() => strict(make()), (e) => { thrown = e.message; return true; },
      `${what}: the fail-closed policy must refuse it`);
    assert.match(thrown, reason, `${what}: the refusal must state ${reason} too`);
  }
});

test('2 · what the boundary produces is what the FILE would carry, byte for byte', () => {
  // The invariant every consumer leans on: after ingest there is nothing left to canonicalize, so a
  // plain `obj.key` read below the boundary is a read of the value `serialize()` will write. Asserted
  // as an identity against JSON itself rather than against a hand-written expectation.
  const carried = [
    { k: 1, s: 'x', b: true, n: null, list: [1, 'a', { deep: [] }] },
    { nested: { a: { b: { c: [1, 2, 3] } } } },
    JSON.parse('{"__proto__": {"default": "none"}, "k": 1}'),   // an own __proto__ is DATA
    Object.assign(Object.create({ inherited: 'dropped' }), { own: 'kept' }),
    Object.assign(Object.create(null), { k: 1 }),
    { zero: -0, alsoZero: 0, arr: [-0] },
    [],
    {},
    'a string',
    42,
    null,
    true,
  ];
  for (const value of carried) {
    const { value: canonical, errors } = ingest(value);
    assert.deepEqual(errors, [], `${JSON.stringify(value)} must be carried, not refused`);
    assert.equal(JSON.stringify(canonical), JSON.stringify(JSON.parse(JSON.stringify(value))),
      'the snapshot must be byte-identical to the value written and read back');
  }
});

test('3 · an INHERITED field is not carried — it is absent, exactly as every copy leaves it', () => {
  // Not a refusal: `JSON.stringify` drops it too, so the file simply does not have the key. Whoever
  // needed the field then reports it missing BY NAME, which is a better message than "prototype".
  const { value, errors } = ingest(Object.assign(Object.create({ form: 'svg-hero' }), { id: 'overview' }));
  assert.deepEqual(errors, []);
  assert.deepEqual(value, { id: 'overview' });
  assert.equal(Object.hasOwn(value, 'form'), false, 'the inherited key is not in the snapshot');
});

test('4 · -0 is canonicalized THROUGH to 0 — JSON has no other spelling for it', () => {
  // Refusing it would reject a map whose serialization is perfectly legal; carrying it would leave
  // every consumer holding a value no reader of map.json could ever see, which is how two citations
  // differing only by `-0` came to tie in the drift engine's content tie-break (Phase 2, finding 3).
  const { value, errors } = ingest({ weight: -0 });
  assert.deepEqual(errors, []);
  assert.ok(Object.is(value.weight, 0), 'the snapshot carries 0');
  assert.ok(!Object.is(value.weight, -0), 'and not the -0 the file cannot hold');
  assert.equal(JSON.stringify(-0), '0', 'which is what JSON.stringify writes for it');
});

test('5 · the reporting policy NEVER throws, and names the path it refused', () => {
  const hostile = [
    ['a Proxy that refuses to be walked', new Proxy({}, { ownKeys() { throw new Error('nope'); } })],
    ['a getter that throws where a reader would read it', (() => {
      const o = {};
      Object.defineProperty(o, 'k', { get() { throw new Error('boom'); }, enumerable: true, configurable: true });
      return o;
    })()],
    ['a frozen cyclic object', (() => { const o = { k: 1 }; o.self = o; Object.freeze(o); return o; })()],
    ['a deeply nested refusal', { a: { b: { c: [{ d: new Map() }] } } }],
  ];
  for (const [what, input] of hostile) {
    let result;
    assert.doesNotThrow(() => { result = ingest(input); }, what);
    assert.ok(result.errors.length > 0, `${what}: a refusal must say why`);
  }
  // …and the path is named, so a reader can find the offending record rather than the offending type.
  const { errors } = ingest({ nodes: [{ attrs: { audit: { seen: new Date(0) } } }] });
  assert.match(errors.join('\n'), /nodes\[0\]\.attrs\.audit\.seen/);
});

test('6 · a value the boundary cannot carry AT ALL comes back ABSENT rather than half-built', () => {
  const { value, errors } = ingest(new Map([['k', 1]]));
  assert.equal(value, ABSENT);
  assert.match(errors.join('\n'), /^map: /m, 'and the report names the input itself');
});

test('7b · an own key that only LOOKS like an index is refused, not silently dropped', () => {
  // ECMAScript defines an array INDEX as a canonical numeric string below 2³²−1. Everything else —
  // `"4294967295"` (the excluded maximum), `"1e+21"` (canonical, but not an index), `"4294967296"` —
  // is an ordinary own property that `JSON.stringify` writes NOWHERE, because an array serializes its
  // elements only. Treating one as an element skips it past the own-property guard and the value then
  // vanishes between the map that validated and the map that was written, saying nothing.
  for (const key of ['4294967295', '4294967296', '1e+21']) {
    const a = [1];
    a[key] = 'lost';
    assert.equal(a.length, 1, `${key} must not be a real index, or the fixture proves nothing`);

    const { value, errors } = ingest({ a });
    assert.ok(errors.some((e) => /own property on an ARRAY/.test(e)),
      `${key}: the boundary must refuse it — got ${JSON.stringify(errors)}`);
    assert.match(errors.join('\n'), new RegExp(`a\\.${key.replace(/[+.]/g, '\\$&')}`), `${key}: name the path`);
    assert.equal(JSON.stringify(value), '{"a":[1]}', 'and the snapshot is what the file will carry');

    let thrown = null;
    assert.throws(() => strict({ a }), (e) => { thrown = e.message; return true; },
      `${key}: the fail-closed policy must refuse it too`);
    assert.match(thrown, /own property on an ARRAY/);
  }
  // …and a REAL index is still an element, including the largest legal one.
  const real = [];
  real[4294967294] = 'x';                                   // the maximum array index
  assert.equal(real.length, 4294967295, 'a real index moves length — that is what makes it one');
  assert.deepEqual(ingest({ ok: [1, 2] }).errors, [], 'ordinary indices raise nothing');
});

test('7c · the EXOTIC check reads internal slots, not a spoofable @@toStringTag', () => {
  // `Object.prototype.toString` answers from `Symbol.toStringTag` when one is in scope, so it decides
  // this question from a PROPERTY the input controls — and gets it wrong in both directions.

  // (a) an ordinary object whose prototype merely CLAIMS to be a Date has no slots and is carried.
  const claimsToBeADate = Object.assign(Object.create({ [Symbol.toStringTag]: 'Date' }), { seen: 'data' });
  const carried = ingest({ claimsToBeADate });
  assert.deepEqual(carried.errors, [], 'a tag is not an internal slot');
  assert.deepEqual(carried.value, { claimsToBeADate: { seen: 'data' } });

  // (b) a Map that CLAIMS to be an ordinary object is still a Map: its payload lives in slots, so
  //     accepting it emits `{}` where the author wrote data, after it has passed every check.
  const disguisedMap = new Map([['k', 1]]);
  Object.setPrototypeOf(disguisedMap, Object.prototype);    // no own symbol key: the ONLY tell is gone
  assert.equal(Object.prototype.toString.call(disguisedMap), '[object Object]', 'the disguise works');
  const refusedMap = ingest({ disguisedMap });
  assert.ok(refusedMap.errors.some((e) => /Map/.test(e)),
    `a disguised Map must still be refused as a Map — got ${JSON.stringify(refusedMap.errors)}`);
  assert.match(refusedMap.errors.join('\n'), /disguisedMap/, 'and the refusal names the path');

  // (c) …and the check runs NO extractor code. `Object.prototype.toString` performs a GET of
  //     @@toStringTag, so an inherited getter is user code executing inside the boundary that promises
  //     none runs.
  let getterRuns = 0;
  const lyingProto = {};
  Object.defineProperty(lyingProto, Symbol.toStringTag, {
    get() { getterRuns += 1; return 'Object'; }, configurable: true,
  });
  const inherits = Object.assign(Object.create(lyingProto), { k: 1 });
  assert.deepEqual(ingest({ inherits }).errors, []);
  assert.deepEqual(ingest({ inherits }).value, { inherits: { k: 1 } });
  assert.equal(getterRuns, 0, 'the boundary must never invoke a @@toStringTag getter');
});

test('7 · a SHARED sub-object is copied, and nothing in the snapshot aliases the input', () => {
  const shared = { deep: [1, 2] };
  const input = { a: shared, b: shared };
  const { value, errors } = ingest(input);
  assert.deepEqual(errors, [], 'sharing is legal JSON — only a CYCLE is not');
  assert.deepEqual(value, { a: { deep: [1, 2] }, b: { deep: [1, 2] } });
  assert.notEqual(value.a, shared);
  assert.notEqual(value.a, value.b);
  value.a.deep.push(3);
  assert.deepEqual(shared.deep, [1, 2], 'a consumer editing its snapshot cannot reach the input');
});
