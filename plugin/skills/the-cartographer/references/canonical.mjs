// the-cartographer — THE INGEST BOUNDARY: one definition of what a legal map is SHAPED like, applied
// once, before anything reads the input.
//
// ─── why this module exists ──────────────────────────────────────────────────────────────────────
//
// Phases 1, 2 and 3 each closed a review round on the same defect wearing a different object:
// `validate.mjs` and its consumers DISAGREED ABOUT WHAT A LEGAL MAP IS. The validator read properties
// with plain gets; `diff.mjs` canonicalized from own descriptors; `layout.mjs` had a third reader of
// its own. So a map could be `validate().ok === true` and then make a consumer throw, or serialize to
// data other than the data that was validated:
//
//   • an exotic object (`Date`, `Map`, `Set`) carrying own `path` / `line` answered every check with a
//     real file:line, and then copied as nothing at all — its payload lives in internal slots;
//   • an ACCESSOR answered the validator once and the writer again, so the value checked need not be
//     the value written;
//   • an INHERITED or NON-ENUMERABLE field was read by the validator and dropped by `JSON.stringify`;
//   • a HOLE in a sparse array was skipped by a `forEach` walk and written as `null`;
//   • `-0` validated as `-0` and was written as `0`.
//
// Each round hardened a PREDICATE, one module at a time, and the count never fell: a predicate cannot
// converge, because the asymmetry is not any one predicate's strictness. The two artifacts were
// reading DIFFERENT VALUES. So the fix is not a stricter check anywhere — it is having exactly one
// time-of-read, shared.
//
// ─── the contract ────────────────────────────────────────────────────────────────────────────────
//
// Everything the pipeline reads passes through here first, and what comes out is INERT, JSON-SHAPED
// DATA: null, booleans, finite numbers, strings, arrays and plain objects, recursively — the value
// `map.json` itself carries. Every property is read EXACTLY ONCE and only from its own DESCRIPTOR, so
// no extractor code runs, and nothing can answer a second read differently.
//
// Two policies read the same rules:
//   • `collector()` REPORTS — `validate()` never throws, so it canonicalizes with this one and
//     validates the canonical form. What it reports is what the file would carry.
//   • `refuser(frame)` FAILS CLOSED — `computeDrift`, `resolveView`, `layoutHero` and `normalize` are
//     public entry points, so each takes its own snapshot and refuses what it cannot carry.
//
// Because both policies walk the same code, the two-way agreement PDR §7.1 rule 14 states is
// STRUCTURAL: anything `validate()` accepts is renderable and serializable, and anything a consumer
// refuses fails `validate()` FOR THE SAME STATED REASON — the reason text below is the only copy.
//
// Zero dependencies: node built-ins only. `node:util` is the sole import — nothing in this directory,
// so this module stays the root of the import graph and no cycle is possible.

import { types } from 'node:util';

/** A value that is not carried: an inherited property, or one this boundary refused. */
export const ABSENT = Symbol('absent');

/**
 * Define an OWN data property. `target[key] = value` would treat an own `__proto__` key — which
 * `JSON.parse` produces verbatim, and which the IR contract bans nowhere — as a PROTOTYPE MUTATION:
 * the key never becomes an own property, so the whole subtree is silently dropped from the rebuilt
 * value and anything inside it (a timestamp included, ADR C-003) escapes every later guard.
 * defineProperty carries it as ordinary data and leaves the prototype alone.
 *
 * One copy, shared: `serialize.mjs` rebuilds every record with it and `diff.mjs` hashes every record
 * through it, and the two rebuilding it differently is how an own `__proto__` came to collapse the
 * drift engine's deterministic tie-break one module after the serializer had already been fixed.
 */
export function setOwn(target, key, value) {
  Object.defineProperty(target, key, { value, writable: true, enumerable: true, configurable: true });
}

/**
 * THE BRAND TABLE — what an EXOTIC is, decided from INTERNAL SLOTS.
 *
 * `Object.prototype.toString` cannot answer this question. Its result is a PROPERTY read: the spec has
 * it consult `Symbol.toStringTag`, inherited included, and prefer that string over everything it knows
 * from slots. So it was wrong in both directions and unsafe in a third:
 *
 *   • an ordinary object whose prototype carries `[Symbol.toStringTag] = 'Date'` has no slots at all
 *     and was REFUSED — a map the file could carry perfectly, rejected on a label;
 *   • `Map`, `Set`, `WeakMap`, `Promise`, every TypedArray and every generator get their tag ONLY from
 *     `Symbol.toStringTag`, so deleting or overwriting it — or simply re-prototyping the instance —
 *     made one read `[object Object]`. It was then ACCEPTED and rebuilt as `{}`: the payload silently
 *     gone AFTER passing every check, which is the one failure this whole module exists to prevent;
 *   • the lookup is a `[[Get]]`, so an inherited `Symbol.toStringTag` GETTER runs extractor code inside
 *     the boundary that promises none runs — the same time-of-check/time-of-use hole as an accessor.
 *
 * `node:util`'s `types` predicates are the fix. Each is implemented in the engine against the object's
 * actual internal slot, reads no property, calls no user code, and therefore cannot be spoofed by any
 * property — own or inherited, data or accessor. The equivalence worth stating: every case
 * `Object.prototype.toString` decided from a SLOT ([[DateValue]], [[RegExpMatcher]], [[ErrorData]],
 * the boxed primitives, [[ParameterMap]]) is decided here from the same slot; every case it decided
 * from a PROPERTY is decided here from the slot instead.
 *
 * The name in each pair is what a refusal calls the thing, so the message names what it IS rather than
 * what it claimed to be.
 */
const BRANDS = [
  ['Date', types.isDate],
  ['Map', types.isMap],
  ['Set', types.isSet],
  ['WeakMap', types.isWeakMap],
  ['WeakSet', types.isWeakSet],
  ['RegExp', types.isRegExp],
  ['Promise', types.isPromise],
  ['Error', types.isNativeError],
  ['boxed primitive', types.isBoxedPrimitive],
  ['ArrayBuffer', types.isAnyArrayBuffer],
  ['DataView', types.isDataView],
  ['TypedArray', types.isTypedArray],
  ['Arguments object', types.isArgumentsObject],
  ['generator', types.isGeneratorObject],
  ['module namespace object', types.isModuleNamespaceObject],
  ['Map Iterator', types.isMapIterator],
  ['Set Iterator', types.isSetIterator],
  // `util.types` has no predicate for these two, and `Object.prototype.toString` only ever knew them
  // by their (spoofable) tag. A built-in method BRAND-CHECKS the slot for us: it throws a TypeError on
  // anything without it, and — being a built-in — running it is not running extractor code.
  ['WeakRef', brandCheck(WeakRef.prototype.deref)],
  ['FinalizationRegistry', brandCheck(FinalizationRegistry.prototype.unregister, {})],
];

/** A built-in that requires an internal slot, turned into a predicate. Calls nothing the input owns. */
function brandCheck(method, ...args) {
  return (v) => { try { method.call(v, ...args); return true; } catch { return false; } };
}

/**
 * The brand a value carries, or `null` when it carries none.
 *
 * A PROXY is judged by what it presents, deliberately. A proxy has no slots of its own — `isMap` on a
 * proxy of a `Map` is false — so a slot sweep cannot see through one, and every read the walk below
 * makes goes through its traps anyway. `Object.prototype.toString` is exactly the right question to
 * ask a thing whose whole nature is "whatever it answers", and asking it keeps a proxied `Map`
 * refused rather than quietly rebuilt as `{}`.
 */
export function brandOf(v) {
  if (v === null || typeof v !== 'object') return null;
  if (types.isProxy(v)) {
    const tag = Object.prototype.toString.call(v).slice(8, -1);
    return tag === 'Object' ? null : tag;
  }
  for (const [name, is] of BRANDS) if (is(v)) return name;
  return null;
}

/**
 * An ORDINARY object — one with no internal slots.
 *
 * Deliberately NOT `Object.getPrototypeOf(v) === Object.prototype`. An object whose PROTOTYPE merely
 * carries data is rebuilt faithfully from its own properties: the inherited keys are exactly the ones
 * `JSON.stringify` drops too, so dropping them here loses nothing, and the field then reads as absent
 * to every consumer alike — which is the agreement. And a prototype cannot be trusted to identify an
 * exotic in any case: `Object.setPrototypeOf(new Map(), Object.prototype)` keeps every slot it had.
 * An EXOTIC is a different animal: its payload lives in internal slots the rebuild cannot see, so
 * accepting one means emitting `{}` (or a bare string, for a `Date`) where the author wrote data,
 * after it has passed every check.
 *
 * KNOWN RESIDUAL, stated rather than implied: a class instance with PRIVATE FIELDS (`#x`) also keeps
 * payload outside its own properties, and no reflection in the language can see one. It is carried as
 * the ordinary object it otherwise is — exactly as `Object.prototype.toString` carried it before —
 * and `JSON.stringify` drops the private state identically, so the snapshot still equals the file.
 */
export const isOrdinaryObject = (v) => v !== null && typeof v === 'object'
  && !Array.isArray(v) && brandOf(v) === null;

/**
 * `key` names an array ELEMENT — the ECMAScript definition of an array index, which is narrower than
 * "a canonical non-negative integer string" in two ways that both cost data:
 *
 *   • the index space stops BELOW 2³²−1, so an own `"4294967295"` is an ordinary property;
 *   • `"1e+21"` is canonical (`String(1e21) === '1e+21'`) and an integer, and is not an index either.
 *
 * Both are written NOWHERE by `JSON.stringify`, which serializes an array's elements only. Calling one
 * an element skips it past the own-property guard below, so it vanished between the map that validated
 * and the map that was written, saying nothing at all.
 */
const MAX_ARRAY_INDEX = 2 ** 32 - 2;
export const isArrayIndex = (key) => {
  const n = Number(key);
  return Number.isInteger(n) && n >= 0 && n <= MAX_ARRAY_INDEX && String(n) === key;
};

/**
 * THE REASONS — stated once, for every reader.
 *
 * Each one says the same thing in a different shape: the value would not survive into `map.json`
 * intact, so a check made on it is a check made on a value nothing downstream will ever hold. They are
 * phrased as sentence fragments that follow a PATH ("nodes[0].attrs.seen ..."), so the validator can
 * write `${path}: ${reason}` and a consumer can wrap the same pair in its own framing.
 */
export const REASON = {
  accessor:
    'is an ACCESSOR property — it is re-read by whoever uses it, so the value checked need not be the '
    + 'value written, drawn or carried; map.json holds plain data only',
  nonEnumerable:
    'is a NON-ENUMERABLE own property — JSON.stringify drops it, so whatever it holds (a timestamp '
    + 'included, ADR C-003) would be silently lost instead of recorded',
  symbol: (sym) =>
    `carries a symbol-keyed own property (${String(sym)}) — JSON.stringify drops it, so whatever it `
    + 'holds would be silently lost instead of recorded',
  hole:
    'is a HOLE in a sparse array — JSON.stringify writes it as null, so the value validated is not the '
    + 'value serialized',
  arrayOwnProperty:
    'is an own property on an ARRAY — JSON.stringify writes an array\'s elements only, so this would be '
    + 'silently lost instead of recorded',
  exotic: (v) =>
    `is a ${brandOf(v)}, whose payload lives in internal slots JSON cannot carry — it would be rewritten `
    + 'or emptied to {} after passing every check, hiding whatever it holds (a timestamp included, ADR '
    + 'C-003) from every later guard',
  undefinedMember:
    'is present but undefined — JSON.stringify DROPS the key, so the map validated is not the map '
    + 'serialized; omit the key, or write null, to say "nothing here"',
  undefinedElement:
    'is an undefined array element — JSON.stringify writes it as null, so the value validated is not '
    + 'the value serialized',
  type: (t) =>
    `is of type ${t}, which is not JSON data — JSON.stringify drops it (or throws) instead of `
    + 'recording it',
  nonFinite: (v) =>
    `is ${String(v)}, which has no JSON spelling — JSON.stringify rewrites NaN and Infinity as null`,
  cycle:
    'is a circular reference — a cyclic value cannot be serialized into map.json, and the failure '
    + 'belongs here rather than deep inside normalization',
};

/**
 * ONE read of one own property, taken from its DESCRIPTOR rather than through `obj[key]`.
 *
 * Reading the descriptor runs no extractor code, so the value returned IS the value used; there is no
 * second read for anything to differ on. An INHERITED property has no own descriptor and is simply
 * ABSENT — the snapshot omits it and whoever needed the field then reports it missing by name.
 */
export function readOwn(obj, key, at, report) {
  const d = Object.getOwnPropertyDescriptor(obj, key);
  if (d === undefined) return ABSENT;
  if (typeof d.get === 'function' || typeof d.set === 'function') {
    report(at, REASON.accessor);
    return ABSENT;
  }
  if (!d.enumerable) {
    report(at, REASON.nonEnumerable);
    return ABSENT;
  }
  return d.value;
}

/**
 * Rebuild `value` as inert JSON data, reporting everything that would not survive the write.
 *
 * `ancestors` is PATH-LOCAL, so a shared sub-object — legal JSON, and legal IR — is copied twice
 * rather than mistaken for a cycle.
 *
 * A refused value is OMITTED from the result rather than replaced by a placeholder: that is what
 * `JSON.stringify` does with the properties it drops, and it keeps a single fault from cascading into
 * a second, invented one. Under `refuser` the first refusal throws, so nothing is omitted silently.
 *
 * The one value that is REWRITTEN rather than refused is `-0`, which JSON has no spelling for: the
 * file carries `0`, so the snapshot carries `0`. Refusing it would reject a map whose serialization is
 * perfectly legal; carrying it would leave every consumer holding a value no reader of `map.json`
 * could ever see — which is how two citations differing only by `-0` came to tie in the drift engine's
 * content tie-break and leak extractor order into the output.
 */
export function canonicalValue(value, at, report, ancestors = new Set()) {
  if (value === null) return null;
  const t = typeof value;
  if (t === 'string' || t === 'boolean') return value;
  if (t === 'number') {
    if (!Number.isFinite(value)) {
      report(at, REASON.nonFinite(value));
      return ABSENT;
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (t !== 'object') {
    report(at, REASON.type(t));
    return ABSENT;
  }
  if (ancestors.has(value)) {
    report(at, REASON.cycle);
    return ABSENT;
  }
  // Reported, not fatal to the walk: the symbol-keyed properties are dropped by every copy anyway, so
  // the rest of the value is still worth reporting on in one pass.
  for (const sym of Object.getOwnPropertySymbols(value)) report(at, REASON.symbol(sym));

  ancestors.add(value);
  let out;
  if (Array.isArray(value)) {
    out = [];
    // BY INDEX over `length`, so a HOLE is reported rather than skipped the way `forEach` skips it.
    for (let i = 0; i < value.length; i += 1) {
      const where = `${at}[${i}]`;
      if (!Object.hasOwn(value, i)) {
        // hasOwn, not `i in value`: `in` also answers for the PROTOTYPE, so a polluted Array.prototype
        // would hide a hole that JSON.stringify still writes as null.
        report(where, REASON.hole);
        continue;
      }
      const item = readOwn(value, String(i), where, report);
      if (item === ABSENT) continue;
      if (item === undefined) {
        report(where, REASON.undefinedElement);
        continue;
      }
      const member = canonicalValue(item, where, report, ancestors);
      if (member !== ABSENT) out.push(member);
    }
    // An own property that is not an element is dropped by JSON.stringify along with its contents.
    for (const key of Object.getOwnPropertyNames(value)) {
      if (key === 'length' || isArrayIndex(key)) continue;
      report(`${at}.${key}`, REASON.arrayOwnProperty);
    }
  } else if (!isOrdinaryObject(value)) {
    report(at, REASON.exotic(value));
    ancestors.delete(value);
    return ABSENT;
  } else {
    out = {};
    for (const key of Object.getOwnPropertyNames(value)) {
      const where = at === '' ? key : `${at}.${key}`;
      const item = readOwn(value, key, where, report);
      if (item === ABSENT) continue;
      if (item === undefined) {
        report(where, REASON.undefinedMember);
        continue;
      }
      const member = canonicalValue(item, where, report, ancestors);
      if (member !== ABSENT) setOwn(out, key, member);
    }
  }
  ancestors.delete(value);
  return out;
}

/** The path a message names when the refused value IS the whole input. */
const named = (at) => (at === '' ? 'map' : at);

/** REPORTING policy: collect `${path}: ${reason}` and keep walking. Used by `validate()`. */
export function collector() {
  const errors = [];
  return { errors, report: (at, reason) => errors.push(`${named(at)}: ${reason}`) };
}

/**
 * FAIL-CLOSED policy: the first refusal throws, framed by the consumer that owns the boundary.
 * `frame(path, reason)` builds the message, so each entry point can say what its own refusal means
 * while the REASON stays the shared one.
 */
export function refuser(frame) {
  return (at, reason) => { throw new Error(frame(named(at), reason)); };
}

/**
 * ingest(value) -> { value, errors } — NEVER throws, including on cyclic, exotic, sparse, proxied or
 * accessor-bearing input. `value` is `ABSENT` when the input itself could not be carried at all.
 *
 * The try/catch is for a value that fights being READ rather than one that cannot be written — a Proxy
 * whose `ownKeys` trap throws is the honest example. `validate()` promises a readable report on any
 * input whatsoever, so that becomes a finding here too.
 */
export function ingest(value, at = '') {
  const { errors, report } = collector();
  try {
    return { value: canonicalValue(value, at, report), errors };
  } catch (e) {
    errors.push(`${named(at)}: could not be read as JSON data (${e?.message ?? String(e)})`);
    return { value: ABSENT, errors };
  }
}

/**
 * ingestStrict(value, { at, frame }) -> the canonical value, or THROWS on the first thing the snapshot
 * cannot carry. The entry point every consumer takes: `computeDrift`, `resolveView`, `layoutHero` and
 * `normalize` each read their input exactly once, here, and read the snapshot alone afterwards.
 */
export function ingestStrict(value, { at = '', frame }) {
  return canonicalValue(value, at, refuser(frame));
}
