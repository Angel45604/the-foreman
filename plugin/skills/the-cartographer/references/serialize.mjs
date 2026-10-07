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
 * The closed set of ORDERED arrays this writer serializes, keyed on LOCATION rather than on key name
 * (`*` stands for any array index). Everything else is semantically unordered. Keying on a bare key
 * name would also exempt an arbitrary `nodes[].attrs.columns`, so two maps differing only in that
 * array's order would serialize to different bytes — exactly the false structural drift this module
 * exists to prevent.
 *
 *   • `views.*.columns` — `map.json`. The one array the IR contract itself specifies as ordered: a
 *     table's columns are drawn left to right in the order written.
 *   • `findings.*.citations` — `drift.json`. ADDED 2026-08-14. A finding's citations are a SENTENCE,
 *     not a set: under ADR C-019 citation one is the claim the evidence REFUTES — the text a
 *     maintainer must change — and citation two is what was observed. `diff.mjs` emits them in that
 *     order on purpose (`[sides.claim, sides.evidence]`) and its own `sortKeysDeep` leaves arrays
 *     alone for exactly this reason; this writer then re-sorted them by path, so a STALE claim in
 *     `z-doc.md` refuted by code in `a-code.sh` was PERSISTED evidence-first and every later reader
 *     of `drift.json` saw the roles reversed. Determinism is not weakened by the exemption: the
 *     order is DERIVED by `computeDrift` from the map's own records, never carried in from extractor
 *     emission order, so two equivalent extractions still serialize identically.
 */
const PRESENTATION_ORDER_PATHS = new Set(['views.*.columns']);
// `findings.*.citations` is NOT here: it is order-bearing only for STALE, which a path-keyed set
// cannot express. `normalizeValue` decides it from the finding's own `class` (round-9 gate).

// ─── the ADR C-003 wall-clock guard ──────────────────────────────────────────────────────────────
//
// THE RULE, stated once. Inside a JSON STRING token of the serialized text — a value or a key — a
// wall-clock timestamp is a DATE-TIME: an ISO-8601 date immediately followed by a time of day, in
// either spelling and at any precision from the HOUR down — `2026-08-11T13Z`, `2026-08-11 13:45`,
// `20260811T13`, `20260811T134500Z`. Refused wherever it appears, a path included: a stamped
// directory (`logs/20260811T1345/run.json`) is still a stamp.
//
// A BARE DATE IS NOT ONE, and is carried through wherever it appears — as the whole value, as a key,
// embedded in prose, and inside a path (amended 2026-08-13, owner-authorized; ADR C-003). The churn
// this rule exists to prevent comes from a GENERATION STAMP, and a generation stamp is always a
// date-time: `new Date().toISOString()` produces one. A bare date is ordinary source text — a
// changelog line, a version note, a dated directory, a quoted release line — which the extractor is
// required to record verbatim. Refusing it prevented no churn and blocked real maps: the first REAL
// subject the pipeline was pointed at could not be rendered at all, because its map quotes a README
// line reading "…(245 as of 2026-08-01)".
//
// The one narrowing left carries its weight: STRING TOKENS ONLY, so a JSON number is never read as a
// date (`"lines": 20260811` is a count and carries no quotes), and the offending text a refusal
// reports is text the file would actually carry.
//
// Deliberately NOT matched, as before: a precision coarser than a day (`2026-08`, `2026`) and a bare
// time of day (`13:45`). Those are indistinguishable from a version, an id, or a duration, and the
// false positives would cost more than a stamp too coarse to churn a same-day regeneration.

/** One JSON string token — the only place in JSON text where a date-time can be written. */
const JSON_STRING_RE = /"(?:[^"\\]|\\.)*"/g;
/** hh, hhmm, hh:mm, hh:mm:ss(.sss), with an optional Z or ±hh:mm — precision from the hour down. */
const TIME_OF_DAY = String.raw`(?:[01]\d|2[0-3])(?::?[0-5]\d)*(?:[.,]\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):?[0-5]\d)?`;
/** An ISO date in either spelling; the basic form must not be a slice of a longer alphanumeric run. */
const DATE_EITHER_SPELLING = String.raw`(?:\d{4}-\d{2}-\d{2}|(?<![0-9A-Za-z])\d{8})`;
const ISO_DATETIME_RE = new RegExp(`${DATE_EITHER_SPELLING}[T ]${TIME_OF_DAY}(?![0-9A-Za-z])`);

/** The offending text, or null. Reads only the string tokens of the serialized JSON. */
function findWallClockStamp(text) {
  for (const [token] of text.matchAll(JSON_STRING_RE)) {
    const hit = ISO_DATETIME_RE.exec(token.slice(1, -1));
    if (hit) return hit[0];
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

/**
 * `path` is the value's location in the IR, with `*` for an array index (`views.*.columns`).
 *
 * `parent` is the record the value hangs on, and it exists for exactly one rule: `findings.*.citations`
 * is order-BEARING only for STALE. C-019 makes a STALE finding's citations a sentence — claim first,
 * evidence second — but for PHANTOM, UNDOCUMENTED and UNVERIFIED a citation list is a SET, and a
 * path-keyed exemption cannot tell them apart. So equivalent documents differing only in emission order
 * serialized to different bytes, against this module's own total-order promise. Not reachable through
 * this pipeline, because `computeDrift` sorts those classes before emitting — but the promise is made
 * to any caller, and a hand-built or third-party `drift.json` could carry either order (round-9 gate).
 */
function normalizeValue(value, path, parent) {
  if (Array.isArray(value)) {
    const items = value.map((item) => normalizeValue(item, `${path}.*`, value));
    if (path === 'findings.*.citations') {
      // Ordered ONLY where the order carries meaning; sorted everywhere else, as the contract says.
      return isRecord(parent) && parent.class === 'STALE' ? items : items.sort(compareEntries);
    }
    if (PRESENTATION_ORDER_PATHS.has(path)) return items;
    return items.sort(compareEntries);
  }
  if (isRecord(value)) {
    const out = {};
    for (const k of Object.keys(value).sort()) {
      setOwn(out, k, normalizeValue(value[k], path === '' ? k : `${path}.${k}`, value));
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
