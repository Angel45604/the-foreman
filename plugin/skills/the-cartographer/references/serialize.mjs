// the-cartographer — deterministic map serializer (PDR §7, ADR C-003).
//
// Two equivalent extractions that differ only in emission order MUST serialize to identical bytes,
// or Phase 6's structural diff reports false drift on every regeneration. So this module imposes a
// TOTAL order over every semantically unordered array, sorts object keys, and refuses to write a
// wall-clock timestamp into the snapshot.
//
// Zero dependencies: node built-ins only.

import { ingestStrict, setOwn } from './canonical.mjs';

/**
 * The IR's closed set of ORDERED arrays, keyed on LOCATION rather than on key name (`*` stands for
 * any array index). `views[].columns` is the ONE array the contract specifies as ordered; every
 * other array is semantically unordered. Keying on the name `columns` alone would also exempt an
 * arbitrary `nodes[].attrs.columns`, so two maps differing only in that array's order would
 * serialize to different bytes — exactly the false structural drift this module exists to prevent.
 */
const PRESENTATION_ORDER_PATHS = new Set(['views.*.columns']);

// ─── the ADR C-003 wall-clock guard ──────────────────────────────────────────────────────────────
//
// THE RULE, stated once. Inside a JSON STRING token of the serialized text — a value or a key — a
// wall-clock timestamp is either of:
//
//   (a) a DATE-TIME: an ISO-8601 date immediately followed by a time of day, in either spelling and
//       at any precision from the HOUR down — `2026-08-11T13Z`, `2026-08-11 13:45`, `20260811T13`,
//       `20260811T134500Z`. Refused wherever it appears, a path included.
//   (b) a bare DATE: extended `2026-08-11`, or basic `20260811` restricted to the wall-clock band
//       (year 1900-2199, month 01-12, day 01-31) and delimited by non-alphanumerics. Refused
//       everywhere a string can carry it — as the whole value, as a key, and embedded in PROSE —
//       with ONE carve-out: a PATH TOKEN, meaning the date's own whitespace-delimited run contains
//       a `/`.
//
// Each narrowing carries its weight:
//   • STRING TOKENS ONLY, so a JSON number is never a date: `"lines": 20260811` is a count and
//     carries no quotes. (A date-time cannot occur outside a string in JSON at all.)
//   • THE CARVE-OUT IS A PATH, not "any longer string". `docs/initiatives/2026-08-11-the-cartographer/PDR.md`
//     is a source path; `"generated on 2026-08-11"` is a stamp with words around it — and the
//     whole-VALUE carve-out this replaces could not tell them apart, so it let the second through.
//     The test is applied per MATCH, so a path cannot launder a second date sitting beside it, and
//     it does not apply to (a): a stamped directory IS a stamp.
//   • THE BASIC DATE MUST BE CALENDAR-SHAPED, because eight bare digits are also an id, a count or a
//     hash prefix: `20261301` (month 13), `12345678` (year 1234) and `20260811abcdef01` are data.
//     Shape, not calendar — `20260229` in a non-leap year is still refused, because the guard exists
//     to fail closed, and no legitimate IR value is an eight-digit string in the wall-clock band.
//
// Deliberately NOT matched: a precision coarser than a day (`2026-08`, `2026`) and a bare time of
// day (`13:45`). Those are indistinguishable from a version, an id, or a duration, and the false
// positives would cost more than a stamp too coarse to churn a same-day regeneration.

/** One JSON string token — the only place in JSON text where a date can be written. */
const JSON_STRING_RE = /"(?:[^"\\]|\\.)*"/g;
/** hh, hhmm, hh:mm, hh:mm:ss(.sss), with an optional Z or ±hh:mm — precision from the hour down. */
const TIME_OF_DAY = String.raw`(?:[01]\d|2[0-3])(?::?[0-5]\d)*(?:[.,]\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):?[0-5]\d)?`;
/** An ISO date in either spelling; the basic form must not be a slice of a longer alphanumeric run. */
const DATE_EITHER_SPELLING = String.raw`(?:\d{4}-\d{2}-\d{2}|(?<![0-9A-Za-z])\d{8})`;
const ISO_DATETIME_RE = new RegExp(`${DATE_EITHER_SPELLING}[T ]${TIME_OF_DAY}(?![0-9A-Za-z])`);
const ISO_DATE_RE = new RegExp(
  String.raw`(?<![0-9A-Za-z])(?:\d{4}-\d{2}-\d{2}`
  + String.raw`|(?:19|20|21)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01]))(?![0-9A-Za-z])`,
  'g',
);

/** Is the match part of a PATH — the one token shape a bare date is allowed to be part of? */
function isInsidePathToken(body, from, to) {
  let start = from;
  while (start > 0 && !/\s/.test(body[start - 1])) start -= 1;
  let stop = to;
  while (stop < body.length && !/\s/.test(body[stop])) stop += 1;
  return body.slice(start, stop).includes('/');
}

/** The offending text, or null. Reads only the string tokens of the serialized JSON. */
function findWallClockStamp(text) {
  for (const [token] of text.matchAll(JSON_STRING_RE)) {
    const body = token.slice(1, -1);
    const dateTime = ISO_DATETIME_RE.exec(body);
    if (dateTime) return dateTime[0];
    for (const date of body.matchAll(ISO_DATE_RE)) {
      if (!isInsidePathToken(body, date.index, date.index + date[0].length)) return date[0];
    }
  }
  return null;
}

/**
 * A RECORD — an object that is not an array. After ingest that is the same thing as a plain object:
 * the boundary rebuilds every object it accepts and refuses every exotic, so a `Date` can no longer
 * reach this file at all. It used to be passed through here on purpose, so that `JSON.stringify`
 * would render it and the C-003 guard below could catch the timestamp it holds — a `Map` or a `Set`
 * had no such backstop and simply became `{}`. Refusing all three at ingest, in the words the
 * validator also reports, is the same fail-closed outcome without the special case.
 */
const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** One framing for the writer's boundary: it refuses exactly what the file cannot carry. */
const refusal = (at, reason) => (
  `serialize: ${at} ${reason}. map.json carries plain JSON data only, so the value written is the `
  + 'value that was checked — by this module and by validate.mjs alike (PDR §7.1 rules 11-13).'
);

function cmpString(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Deep key-sorted rebuild — the canonical shape of a value. */
function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (isRecord(value)) {
    const out = {};
    for (const key of Object.keys(value).sort()) setOwn(out, key, sortKeysDeep(value[key]));
    return out;
  }
  return value;
}

/** A total order over a record's FULL content — the last tie-break, so extractor order never leaks. */
function contentKey(value) {
  return JSON.stringify(sortKeysDeep(value));
}

/** A citation is any record carrying a string `path` and a numeric `line` (PDR §7). */
function isCitation(v) {
  return isRecord(v) && typeof v.path === 'string' && typeof v.line === 'number';
}

/**
 * The single comparator for every unordered array in the IR:
 *   citations  → path, then NUMERICALLY by line (a.sh:9 before a.sh:10), then full content;
 *   nodes/edges/views → `id`;
 *   sources / coverage entries → `path`;
 *   anything else (e.g. contradictions) → full content.
 * Every branch falls through to `contentKey`, so the order is total: only byte-identical records tie.
 */
function compareEntries(a, b) {
  if (typeof a === 'string' && typeof b === 'string') return cmpString(a, b);
  if (isRecord(a) && isRecord(b)) {
    if (isCitation(a) && isCitation(b)) {
      if (a.path !== b.path) return cmpString(a.path, b.path);
      if (a.line !== b.line) return a.line - b.line;
    } else {
      if (typeof a.id === 'string' && typeof b.id === 'string' && a.id !== b.id) return cmpString(a.id, b.id);
      if (typeof a.path === 'string' && typeof b.path === 'string' && a.path !== b.path) {
        return cmpString(a.path, b.path);
      }
    }
  }
  return cmpString(contentKey(a), contentKey(b));
}

/** `path` is the value's location in the IR, with `*` for an array index (`views.*.columns`). */
function normalizeValue(value, path) {
  if (Array.isArray(value)) {
    const items = value.map((item) => normalizeValue(item, `${path}.*`));
    if (PRESENTATION_ORDER_PATHS.has(path)) return items;
    return items.sort(compareEntries);
  }
  if (isRecord(value)) {
    const out = {};
    for (const k of Object.keys(value).sort()) {
      setOwn(out, k, normalizeValue(value[k], path === '' ? k : `${path}.${k}`));
    }
    return out;
  }
  return value;
}

/**
 * normalize(map) -> map — pure. Ingests the map through the shared boundary, then sorts every
 * unordered array and every object key.
 *
 * The ingest is the deep copy (nothing in the result is an object the caller also holds) AND the
 * fail-closed guard: `structuredClone` used to do the copying, and it is precisely the wrong tool for
 * it — it copies an exotic by its INTERNAL SLOTS, so a `Date` carrying own data properties arrived
 * here whole and left empty. Now anything that would not survive the write is refused before a single
 * key is sorted, in the same words `validate()` reports, so the map that validates is the map that is
 * written.
 *
 * Callers that RENDER must normalize too (rendering from extractor order would draw a stable map in
 * an unstable order even though its serialization is canonical).
 */
export function normalize(map) {
  return normalizeValue(ingestStrict(map, { frame: refusal }), '');
}

/**
 * serialize(map) -> canonical JSON text ending in `\n`.
 * FAILS CLOSED on any ISO-8601-shaped timestamp (ADR C-003): a wall-clock stamp inside the snapshot
 * would make every regeneration report spurious structural drift.
 */
export function serialize(map) {
  const text = `${JSON.stringify(normalize(map), null, 2)}\n`;
  const hit = findWallClockStamp(text);
  if (hit) {
    throw new Error(
      `serialize: refusing to write a wall-clock timestamp into map.json (ADR C-003): ${hit}. ` +
      'Generation time belongs in map.html / map.md only.',
    );
  }
  return text;
}
