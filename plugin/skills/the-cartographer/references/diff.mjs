// the-cartographer — the drift engine (PDR §8, ADR C-004 / C-005 / C-014).
//
// computeDrift(map) -> { findings }, where a finding is { class, nodeId, label, detail, citations }.
//
// Drift is DERIVED (ADR C-004). This module READS the map and returns findings; it never writes a
// verdict back into the IR, and it never hands a caller one of the map's own objects — a caller
// editing a finding, at any depth, must not be able to edit the snapshot it came from.
//
// ─── the model: two ORTHOGONAL families ──────────────────────────────────────────────────────────
//
// (A) SET MEMBERSHIP over `doc` claims vs evidence — mechanical, no judgement (ADR C-005):
//
//       doc claim, no evidence   → PHANTOM      (…or UNVERIFIED, see rule 5)
//       evidence, no doc claim   → UNDOCUMENTED
//       both                     → no set-membership finding
//       neither                  → no set-membership finding
//
// (B) STALE, which is NOT a set-membership class. It is raised ONLY where the extractor asserted a
//     `contradictions[]` record, and always carries both of that record's citations.
//
// The families are independent. A node sitting in family (A)'s "documented AND evidenced" cell —
// silent there — is STALE as soon as it carries a contradiction record. Reading the table above as
// "both ⇒ no finding, full stop" is the one error that would hide both real oracle STALE findings.
//
// ADR C-014 narrows family (A) ONLY: a `code-comment` or `user-message` claim is recorded and
// rendered, and can raise STALE, but it does not make a capability documented.
//
// ─── the shape of the module: read once, then derive ─────────────────────────────────────────────
//
// Everything below the BOUNDARY works on a snapshot this module built for itself; the caller's map is
// never read again. See the boundary's own note for why that is a correctness property and not a
// style choice.
//
// Zero dependencies: node built-ins only.

import {
  ABSENT, REASON, canonicalValue, isArrayIndex, isOrdinaryObject, readOwn, refuser, setOwn,
} from './canonical.mjs';

/** Ranked in reporting order — a defect before an uncheckable claim. Also the tie-break's first key. */
export const DRIFT_CLASSES = ['PHANTOM', 'UNDOCUMENTED', 'STALE', 'UNVERIFIED'];

const CLASS_RANK = new Map(DRIFT_CLASSES.map((cls, i) => [cls, i]));

const asArray = (v) => (Array.isArray(v) ? v : []);
const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const nonEmptyString = (v) => typeof v === 'string' && v.trim() !== '';

function show(v) {
  try { return JSON.stringify(v); } catch { return String(v); }
}

function cmpString(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

// ─── THE BOUNDARY ────────────────────────────────────────────────────────────────────────────────
//
// Every read of the caller's map happens HERE, exactly once per value, and everything below reads the
// inert snapshot that comes out — never the input again.
//
// That is a correctness property. Round after round of review found the same defect wearing a
// different object, because the engine VALIDATED one value and then DERIVED its output from a
// DIFFERENT READ of that value:
//
//   • a `Date` (or `Map`, or `Set`) carrying own `path`/`line` answered the citation guard with a
//     real file:line, and then handed the copy nothing at all — an exotic is copied by its INTERNAL
//     SLOTS, not by its own properties — so the finding rendered `undefined:undefined` beside a
//     citation the copy had already emptied;
//   • a stateful accessor answered the guard with a complete citation and the copy with `{}`, and a
//     STALE finding shipped carrying an empty citation;
//   • an exotic nested in a citation's metadata collapsed to `{}` inside the full-content tie-break,
//     so two citations at the same path:line hashed identically and the extractor's emission order
//     leaked through the stable sort.
//
// Each round hardened the PREDICATE. A predicate cannot converge here, however strict, because it is
// not judging the value that ships: time-of-check is not time-of-use. The fix is to have exactly one
// time-of-read — and, since the same asymmetry ran between MODULES and not only inside this one, one
// definition of what may be read at all. That definition is `canonical.mjs`, which this module now
// takes its snapshot through: the rules, the refusals and the words they are refused in are shared
// with `validate.mjs` and with the renderers, so a value the drift engine refuses is a value the
// validator refuses for the same stated reason.
//
// What is LOCAL here, and belongs here, is the ORDER of the walk: a refusal must name the node the
// author wrote rather than an array index, so nodes are canonicalized `id` first.
//
// FAIL CLOSED, not fail quiet. `computeDrift` is a public entry point, so it takes its own snapshot
// rather than trusting a promise made upstream, and a refusal names the node and the slot exactly as
// the citation and contradiction guards below do.

/** The shared tail, so every refusal reads as ONE rule rather than as a dozen special cases. */
const report = refuser((at, reason) => (
  `computeDrift: ${at} ${reason}. The drift engine reads its input ONCE, into an inert snapshot, and `
  + 'derives every finding from that snapshot alone — so a value the snapshot cannot carry is a '
  + 'value a finding would only APPEAR to be built from (PDR §8).'
));

/** One value, rebuilt as inert JSON data — or refused. `ancestors` is path-local, as the shared walk has it. */
const snapshotOf = (at, value, ancestors = new Set()) => canonicalValue(value, at, report, ancestors);

/**
 * ONE node, canonicalized with `id` FIRST.
 *
 * The ORDER is the point. A refusal must name the node the author wrote rather than an array index,
 * so the label has to be in hand before the other slots are walked — and peeking at the input twice,
 * once for the label and once for the data, would reintroduce in miniature the very two-reads
 * asymmetry this boundary exists to remove (a Proxy could label a message with one id and hand the
 * finding another). Reading `id` ONCE, up front, and using it as both is what keeps "every property
 * is read exactly once" literally true.
 */
function canonicalNode(where, element, ancestors) {
  // Anything that is not an ordinary object has no `id` slot to lead with — a primitive, an array, an
  // exotic — and the shared rule already refuses or passes it through exactly as it stands.
  if (!isOrdinaryObject(element)) return snapshotOf(where, element, ancestors);

  const id = readOwn(element, 'id', `${where}.id`, report);
  const at = nonEmptyString(id) ? id : where;

  for (const sym of Object.getOwnPropertySymbols(element)) report(at, REASON.symbol(sym));
  ancestors.add(element);
  const out = {};
  if (id !== ABSENT) setOwn(out, 'id', snapshotOf(`${at}.id`, id, ancestors));
  for (const key of Object.getOwnPropertyNames(element)) {
    if (key === 'id') continue;
    const slot = `${at}.${key}`;
    const member = readOwn(element, key, slot, report);
    if (member === ABSENT) continue;
    if (member === undefined) { report(slot, REASON.undefinedMember); continue; }
    setOwn(out, key, snapshotOf(slot, member, ancestors));
  }
  ancestors.delete(element);
  return out;
}

/** The `nodes` array itself — the one slot whose walk is ordered by this module rather than shared. */
function canonicalNodeList(raw, ancestors) {
  // Not an array: there are no elements to name by id, so the shared rule decides what it is and
  // `computeDrift` then finds no nodes on it.
  if (!Array.isArray(raw)) return snapshotOf('nodes', raw, ancestors);

  for (const sym of Object.getOwnPropertySymbols(raw)) report('nodes', REASON.symbol(sym));
  ancestors.add(raw);
  const snapshot = [];
  for (let i = 0; i < raw.length; i += 1) {
    const where = `nodes[${i}]`;
    // BY INDEX over `length`, so a HOLE is refused rather than skipped the way `forEach` skips it.
    if (!Object.hasOwn(raw, i)) { report(where, REASON.hole); continue; }
    const element = readOwn(raw, String(i), where, report);
    if (element === ABSENT) continue;
    if (element === undefined) { report(where, REASON.undefinedElement); continue; }
    snapshot.push(canonicalNode(where, element, ancestors));
  }
  // An own property that is not an ELEMENT is dropped by JSON.stringify along with its contents — the
  // shared rule again, and `isArrayIndex` is imported rather than restated for the reason this whole
  // module exists: a second, subtly different copy of a rule is the defect, not the safeguard.
  for (const key of Object.getOwnPropertyNames(raw)) {
    if (key === 'length' || isArrayIndex(key)) continue;
    report(`nodes.${key}`, REASON.arrayOwnProperty);
  }
  ancestors.delete(raw);
  return snapshot;
}

/**
 * The snapshot `computeDrift` works from — the caller's WHOLE map, rebuilt as inert data.
 *
 * The whole map, and not `map.nodes` alone. PDR §7.1 rule 13 states it outright: every rule in rule 12
 * applies ANYWHERE in the IR, "at the top level, on a node, on a source, on a view, or inside any
 * array". Ingesting one slot left every other slot fail-open — a `Date` hanging off the map, an exotic
 * on a `sources[]` entry, a hole in `views[]` — and the drift engine then ACCEPTED maps `validate()`
 * refuses. That is precisely the validator/consumer disagreement `canonical.mjs` was hoisted out to
 * end, reappearing one level up: not inside a predicate this time, but in how much of the document the
 * boundary was pointed at.
 */
function canonicalMap(map) {
  // Not an ordinary object — a primitive, an array, an exotic: the shared rule refuses it or passes it
  // through as it stands, and `computeDrift` then finds no nodes on it.
  if (!isOrdinaryObject(map)) return snapshotOf('', map);

  for (const sym of Object.getOwnPropertySymbols(map)) report('', REASON.symbol(sym));
  const ancestors = new Set([map]);
  const out = {};
  for (const key of Object.getOwnPropertyNames(map)) {
    const member = readOwn(map, key, key, report);
    if (member === ABSENT) continue;
    if (member === undefined) { report(key, REASON.undefinedMember); continue; }
    setOwn(out, key, key === 'nodes'
      ? canonicalNodeList(member, ancestors)
      : snapshotOf(key, member, ancestors));
  }
  return out;
}

// ─── below the boundary: the snapshot only ───────────────────────────────────────────────────────
//
// Every `record` and every `node` from here down is a snapshot object: inert JSON data, owned by this
// module. So a plain `v.path` IS the value the finding will carry — the descriptor gymnastics that
// used to guard these reads belong at the boundary, and only at the boundary.

/**
 * A record that actually NAMES a location — `path` + a 1-based `line`, the same two fields
 * validate.mjs requires of every citation. Deliberately narrower than `isRecord`: a finding's whole
 * claim to be auditable is that a reader can open what it cites, and `{}` is a record.
 */
const isCitationRecord = (v) => isRecord(v) && nonEmptyString(v.path)
  && Number.isInteger(v.line) && v.line >= 1;

/** Deep key-sorted rebuild — arrays keep their order, because a finding's citations are ORDERED. */
function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (isRecord(value)) {
    const out = {};
    for (const key of Object.keys(value).sort()) setOwn(out, key, sortKeysDeep(value[key]));
    return out;
  }
  return value;
}

/**
 * A total order over a finding's FULL content — the last tie-break, so extractor order never leaks.
 * Total because the boundary already refused everything `JSON.stringify` cannot spell: there is no
 * longer any value that two distinct citations could both collapse to.
 */
const contentKey = (value) => JSON.stringify(sortKeysDeep(value));

/** path, then NUMERICALLY by line (a.sh:9 before a.sh:10), then full content — as serialize.mjs orders. */
function compareCitations(a, b) {
  if (a.path !== b.path) return cmpString(String(a.path), String(b.path));
  if (a.line !== b.line) return Number(a.line) - Number(b.line);
  return cmpString(contentKey(a), contentKey(b));
}

/**
 * Renders citations for a detail string. PRECONDITION: every element is an `isCitationRecord` —
 * both callers enforce it (`membershipFinding` up front, `staleFindings` per record) and both fail
 * CLOSED when it does not hold. Deliberately not re-checked here: a second, weaker rule inside the
 * formatter is how the two families drift apart, and any fallback it could render — "unknown", a
 * blank — would turn a loud, correct throw into a quiet finding that merely LOOKS auditable.
 */
const where = (citations) => citations.map((c) => `${c.path}:${c.line}`).join(', ');

const finding = (cls, node, detail, citations) => ({
  class: cls, nodeId: node.id, label: node.label, detail, citations,
});

/**
 * The records family (A) reads from one of a node's citation arrays — FAILING CLOSED on a hollow one,
 * exactly as `staleFindings` does for family (B), because the harm is exactly the same.
 *
 * `isRecord` alone was the whole test, and `{}` IS a record, so a hollow record did BOTH kinds of
 * damage at once. It was RENDERED — `where()` printed it into a human-visible detail as
 * `Evidenced at undefined:undefined` beside `citations: [{}]`, an accusation naming nothing a reader
 * can open, which is the one thing PDR §8 says a finding may never be. And it was COUNTED — a node
 * whose only evidence is `{}` reads as "evidenced", so it silently DELETES the PHANTOM it should have
 * raised. Validating here rather than at each emission point closes both: the membership grid and the
 * citations are derived from the same records, so a record too hollow to cite is also too hollow to
 * classify by.
 *
 * A non-record is still DROPPED rather than thrown on — that is the pre-existing tolerance, and a
 * hollow RECORD is the hole this closes. The index reported is the one in the node's own array, so
 * the message points at the record the author actually wrote.
 */
function citableRecords(node, key) {
  const kept = [];
  asArray(node[key]).forEach((record, i) => {
    if (!isRecord(record)) return;
    if (!isCitationRecord(record)) {
      const at = `${node.id}.${key}[${i}]`;
      throw new Error(
        `computeDrift: ${at} is not a citation — a finding must name WHERE it looked: a non-empty `
        + `${at}.path and an integer ${at}.line >= 1 (PDR §8). `
        + `Got path ${show(record.path)}, line ${show(record.line)}.`,
      );
    }
    kept.push(record);
  });
  return kept;
}

/**
 * The set-membership families (A). Returns at most ONE finding: the three classes partition the
 * "documented?" × "evidenced?" grid, so a node can never be two of them at once.
 */
function membershipFinding(node) {
  const claims = citableRecords(node, 'claims');
  const evidence = citableRecords(node, 'evidence');
  const docClaims = claims.filter((c) => c.claimKind === 'doc');   // ADR C-014

  if (docClaims.length > 0 && evidence.length === 0) {
    // RULE 5 — a claim the extractor could not check is reported as UNCHECKABLE, never as a defect
    // (PDR §8.1 guardrail 3). The test is `checked === false`, i.e. the extractor SAID it could not
    // check. An ABSENT `checked` key is silence, not a disclaimer: reading silence as "unchecked"
    // would dissolve the PHANTOM class entirely for any extractor that omits the flag, and PHANTOM
    // is the class the acceptance oracle leans on hardest.
    const uncheckable = claims.every((c) => c.checked === false);
    const cited = [...(uncheckable ? claims : docClaims)].sort(compareCitations);
    if (uncheckable) {
      return finding('UNVERIFIED', node,
        `Claimed at ${where(cited)} with no code evidence, and every claim is marked unchecked — `
        + 'reported as uncheckable rather than as a defect.', cited);
    }
    return finding('PHANTOM', node,
      `Documented at ${where(cited)}, but the map carries no code evidence that it exists.`, cited);
  }

  if (evidence.length > 0 && docClaims.length === 0) {
    const cited = [...evidence].sort(compareCitations);
    // Name the claims that did NOT count, or the finding reads as a false positive to anyone looking
    // at a node that visibly carries a claim.
    const kinds = [...new Set(claims.map((c) => String(c.claimKind)))].sort();
    const why = kinds.length > 0
      ? ` — a ${kinds.join(' / ')} claim is not documentation (ADR C-014)`
      : '';
    return finding('UNDOCUMENTED', node,
      `Evidenced at ${where(cited)}, but no claimKind:"doc" claim documents it${why}.`, cited);
  }

  return null;
}

/** What each side of a contradiction must QUOTE — the two fields PDR §8 writes the record with. */
const QUOTE_KEY = { claim: 'text', evidence: 'note' };

/**
 * Family (B). STALE is extractor-asserted, so this reads records rather than deriving anything — and
 * FAILS CLOSED on a record it cannot render in full. A STALE finding whose statement is missing, or
 * whose citation is missing, NAMES NO LOCATION, or QUOTES NOTHING at the location it names, is
 * unauditable (PDR §7.1 rule 5, §8), and emitting it anyway would be worse than not running at all:
 * the drift lane would show an accusation nobody can check.
 * "Present", "usable" and "quoted" are separate tests here because `{}` passes the first one and a
 * bare `{ path, line }` passes the second.
 *
 * Each slot is bound to a LOCAL the moment it is first read, and every check AND the emitted finding
 * use that binding. The value checked is then the value shipped by construction — belt to the
 * boundary's braces, and the property this function used to lack: it validated `record.claim` and
 * then re-read `record.claim` to copy it out.
 */
function staleFindings(node) {
  return asArray(node.contradictions).map((record, i) => {
    const at = `${node.id}.contradictions[${i}]`;
    if (!isRecord(record)) {
      throw new Error(`computeDrift: ${at} must be an object { claim, evidence, statement } (ADR C-005)`);
    }
    const sides = {};
    for (const side of ['claim', 'evidence']) {
      const cited = record[side];
      sides[side] = cited;
      if (!isRecord(cited)) {
        throw new Error(
          `computeDrift: ${at}.${side} is missing — a STALE finding must carry BOTH citations, the `
          + 'asserted side and the observed side (ADR C-005); one alone is unauditable.',
        );
      }
      // PRESENT is not the same as USABLE. `{}` is an object, so a shape test alone let a hollow
      // record through and emitted `citations: [{}, {}]` — a finding that accuses a node while
      // naming no location a reader can open. That is the same unauditable accusation the two
      // checks around it refuse, so it fails closed the same way.
      if (!isCitationRecord(cited)) {
        throw new Error(
          `computeDrift: ${at}.${side} is not a citation — a STALE finding must name WHERE each side `
          + `sits: a non-empty ${at}.${side}.path and an integer ${at}.${side}.line >= 1 (PDR §8). `
          + `Got path ${show(cited.path)}, line ${show(cited.line)}.`,
        );
      }
      // …and WHERE is only half of it. A location without a QUOTE says a conflict sits at line N
      // without ever saying what was asserted there or what was seen there, and STALE is the one
      // class with nothing derivable behind it: the record IS the audit trail (PDR §7.1 rule 5,
      // §8), which is why validate.mjs requires both quotes of every contradiction.
      const quoted = cited[QUOTE_KEY[side]];
      if (!nonEmptyString(quoted)) {
        throw new Error(
          `computeDrift: ${at}.${side}.${QUOTE_KEY[side]} is missing — a STALE finding must QUOTE `
          + `both sides, what was claimed and what was observed (PDR §7.1 rule 5, §8); two locations `
          + `with nothing quoted at either is unauditable. Got ${show(quoted)}.`,
        );
      }
    }
    const statement = record.statement;
    if (typeof statement !== 'string' || statement.trim() === '') {
      throw new Error(
        `computeDrift: ${at}.statement is missing — a STALE finding must state the conflict it found `
        + '(PDR §8); two citations with nothing said about them are unauditable.',
      );
    }
    // ORDERED, not sorted: the asserted side first, then what was observed. That is the sentence a
    // reader is meant to follow, and it is the pair the contradiction record itself names.
    return finding('STALE', node, statement, [sides.claim, sides.evidence]);
  });
}

/** class (reporting order), then node id, then full content — total, so only identical findings tie. */
function compareFindings(a, b) {
  const byClass = CLASS_RANK.get(a.class) - CLASS_RANK.get(b.class);
  if (byClass !== 0) return byClass;
  if (a.nodeId !== b.nodeId) return cmpString(a.nodeId, b.nodeId);
  return cmpString(contentKey(a), contentKey(b));
}

/**
 * computeDrift(map) -> { findings } — pure. Never mutates `map`; never writes findings into it; never
 * hands back one of its objects.
 *
 * Reads the map exactly once, at the BOUNDARY, and derives everything from the snapshot that comes
 * out. Throws on any input the snapshot cannot carry faithfully (see `canonical`), and on any record
 * it cannot cite in full — a contradiction record (see `staleFindings`) or a claim / evidence record
 * (see `citableRecords`). ALL of it fails closed, since an unauditable finding is worse than no
 * finding. The first is not a new failure mode for the pipeline: `serialize()` refuses the same
 * non-JSON input, so such a map could never have been written to disk either.
 */
export function computeDrift(map) {
  const snapshot = canonicalMap(map);
  const findings = [];
  for (const node of asArray(isRecord(snapshot) ? snapshot.nodes : null)) {
    if (!isRecord(node)) continue;
    // RULE 6 / ADR C-005 — inference never accuses. Excluded from EVERY class, family (B) included:
    // a contradiction recorded against a node the extractor only inferred is still a guess.
    if (node.inferred === true) continue;

    const membership = membershipFinding(node);
    if (membership) findings.push(membership);
    findings.push(...staleFindings(node));
  }
  return { findings: findings.sort(compareFindings) };
}
