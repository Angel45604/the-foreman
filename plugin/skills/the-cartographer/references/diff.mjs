// the-cartographer — the drift engine (PDR §8, ADR C-004 / C-005 / C-014).
//
// computeDrift(map) -> { findings, coverage }, where a finding is { class, nodeId, label, detail,
// citations } — plus `refutedQuote` on a STALE finding whose record named one — and `coverage` is the
// documentation-harvest statement (ADR C-018): which nodes this map established as undocumented, and
// which ones it withheld the verdict on, and why.
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
//     `contradictions[]` record, and always carries both of that record's citations — the REFUTED
//     claim first, then the observation that refutes it. Which claim that is is the record's own
//     assertion and is checked against the text it names, never inferred (see `staleFindings`).
//
// The families are independent. A node sitting in family (A)'s "documented AND evidenced" cell —
// silent there — is STALE as soon as it carries a contradiction record. Reading the table above as
// "both ⇒ no finding, full stop" is the one error that would hide the real STALE findings on
// `codex-gate`: the oracle's one retained STALE (the `user-message` overflow message at
// `codex-gate.sh:519`) and the verified `code-comment` at `:2124` — the latter found BY the extractor,
// a recorded defect rather than a held-out oracle member. Both claimKinds must stay representable.
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
// The ONE statement of "is this quote inside that claim's text" (ADR C-006). Imported rather than
// restated for the reason the boundary above exists: a second, subtly different copy of a rule is how
// a validator and its consumer come to disagree about the same record.
import {
  DOC_HARVEST_DISPOSITIONS, DOC_HARVEST_FORBIDDEN_KEYS, pathSyntaxError, quotesFragment,
} from './validate.mjs';

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

// ─── the documentation-harvest ATTESTATION (ADR decision F, amended C-018) ───────────────────────
//
// UNDOCUMENTED is the ONE class derived from an ABSENCE — no `doc` claim — and an absence is evidence
// only if the search that failed to find it was complete. Computed from absence alone, every doc line
// the extractor failed to harvest became an automatic FALSE ACCUSATION: measured on the real subject,
// at least 7 of 37 UNDOCUMENTED findings were false (~19%, a floor). So eligibility is three-state,
// and only the middle state may accuse:
//
//   1 documented         a `doc` claim exists                                   → no finding
//   2 harvest-complete   a harvest covered EVERY declared doc surface, no claim → UNDOCUMENTED
//   3 harvest-incomplete no harvest, one that missed a surface, a record the    → COVERAGE, not a
//                        contract cannot read, or a map that declares NO doc      finding
//                        surface at all
//
// FAIL CLOSED: absence of a record is state 3. That is why a legacy map raises zero UNDOCUMENTED —
// not a regression, but the map declining to accuse where it holds no attestation of a search.
//
// FAIL CLOSED AGAIN, on the other end: a map that declares NO `role: "doc"` source puts EVERY node in
// state 3, whatever its harvest records say. Completeness is a comparison — `searched` against the
// declared surfaces — and a comparison against the empty set succeeds VACUOUSLY, so the one gate that
// exists to require a search was passed by maps whose own record named no surface as searched. It is
// also the only move the
// contract left an extractor there: `validate.mjs` refuses a `searched` entry whose source is not
// declared `role: "doc"`, so on such a map `searched: []` is the ONLY legal record, and the legal
// record was buying findings. Absence of a documentation surface is not evidence that the
// documentation is silent; it is evidence that the map does not know where to look (ADR C-018).
//
// Completeness is DERIVED here, never read off the record: `validate.mjs` refuses a `complete` key
// outright, so an extractor cannot grade its own homework. What the record CAN say is where it looked.
//
// Note what this gate does NOT consult: `candidates`. A candidate's disposition never suppresses a
// finding — only a real `doc` claim does. `asserts` obliges the extractor to promote the candidate
// into `claims[]` (enforced by the validator), so documentation status keeps flowing through exactly
// one channel and a synonym or fuzzy match can never quietly silence an accusation.

/** Every `role: "doc"` source the map declares — the set a harvest must cover to be complete. */
function declaredDocSurfaces(snapshot) {
  const paths = new Set();
  for (const source of asArray(isRecord(snapshot) ? snapshot.sources : null)) {
    if (isRecord(source) && source.role === 'doc' && nonEmptyString(source.path)) paths.add(source.path);
  }
  return [...paths].sort(cmpString);
}

/**
 * Is that DECLARATION one the contract can read at all? Returns the DEFECT, or `''`.
 *
 * `declaredDocSurfaces()` above answers "what does `sources[]` say?". It cannot answer "is what
 * `sources[]` says a legible declaration?", because a `Set` of non-empty strings accepts a `..`
 * traversal, a leading `/`, a backslash separator and a `.maps/` self-reference alike, and silently
 * COLLAPSES a path declared twice into one member. Both are shapes `validate.mjs` REFUSES, and until
 * 2026-08-14 neither reached this gate.
 *
 * WHY THIS IS A FAIL-OPEN and not a duplicate diagnostic (probed before it was closed). State 2 is
 * nothing more than AGREEMENT between three statements — `sources[]`, `coverage.read` and the node's
 * `docHarvest.searched` — and a bogus path threaded through all three agrees with itself perfectly. So
 * the node reached "harvest-complete" and was ACCUSED on a declaration the validator had already
 * refused: on `tiny.map.json`, six distinct shapes each produced validator errors and an UNDOCUMENTED
 * finding anyway. That is the state-3 rule ("a record the contract cannot read") failing open one door
 * further out than `harvestRecordDefect` closed it — the door is the DECLARATION, not the record.
 *
 * SCOPED to what this gate actually depends on, so it withholds no verdict it has no business
 * withholding:
 *   • PATH SYNTAX on `role: "doc"` sources only. Purely syntactic, so it needs no filesystem — which is
 *     the line this module draws elsewhere, leaving the validator what needs the filesystem or the whole
 *     document. IMPORTED from `validate.mjs`, never restated, for the reason the import block gives.
 *   • A DUPLICATE path where at least ONE declaration is `role: "doc"`. Then "is this path a
 *     documentation surface?" has two answers in one map, and `declaredLengths()` keeps whichever
 *     `lines` it read last — so the candidate bounds check would be measuring an arbitrary one of two
 *     declarations. A duplicate between two `code` entries is left to the validator: it can change
 *     neither the doc surface set nor any doc surface's declared length, and a candidate may only sit
 *     on a surface the record says it searched.
 *
 * PATH-FREE, like every other reason built here — it is rendered as prose in a table cell.
 */
function docDeclarationDefect(snapshot) {
  const seen = new Set();
  const duplicated = new Set();
  // A REASON, NOT A BOOLEAN (round-8 gate). Three different causes shared one flag and therefore one
  // message — "a path the path rules refuse" — so a map whose path was fine and whose ROLE was
  // illegible sent the reader to repair the path. The cause is carried from where it is detected.
  let illegal = '';
  const refuse = (why) => { if (illegal === '') illegal = why; };
  for (const source of asArray(isRecord(snapshot) ? snapshot.sources : null)) {
    // AN ENTRY THAT IS NOT A RECORD AT ALL is the same argument one step further out: `null`, a
    // scalar or an array declares nothing this contract can read, so whether it is a documentation
    // surface is unknown, and what a complete harvest must cover is unknown with it. This used to
    // `continue`, which answered "not documentation" for the shapes that answer nothing (round-8).
    if (!isRecord(source)) {
      refuse('entry');
      continue;
    }
    // THE ROLE QUESTION IS ASKED FIRST, and until 2026-08-15 it was asked last — which made this loop's
    // own guard unreachable for the shapes most obviously in need of it.
    //
    // The line here used to be `if (!isRecord(source) || !nonEmptyString(source.path)) continue;`, so a
    // declaration whose path was empty, whitespace-only, `null`, a number, an array — or simply absent —
    // was SKIPPED before anything asked whether it claimed to be `role: "doc"`. A map could therefore
    // declare a documentation surface nothing can resolve, and this predicate returned `''`: the check
    // added to refuse illegible declarations could not see the most illegible ones. Probed on
    // `tiny.map.json` in seven shapes, each with one validator error (`sources[i].path: must be a
    // non-empty string`) and `computeDrift()` establishing `env.tiny_debug` as UNDOCUMENTED anyway.
    //
    // A `doc` entry with no readable path is a HOLE IN THE SURFACE SET, which is why it belongs to this
    // predicate and not to the validator alone: `declaredDocSurfaces()` filters on the same
    // `nonEmptyString`, so the illegible entry silently leaves the set the harvest must cover, and the
    // trio then agrees over a smaller set than the map declares. What a complete harvest must cover is
    // unknown, and an absence is evidence only if the search that failed to find it was complete.
    //
    // NOT extended to a non-`doc` entry, deliberately, and the scope is the same one the duplicate rule
    // above draws: an illegible `role: "code"` entry cannot enter the doc surface set, cannot change any
    // doc surface's declared length (`declaredLengths()` filters identically), and cannot be searched, so
    // no accusation rests on it. `validate.mjs` refuses it, and that is the right place: this gate
    // withholds on the statements a verdict DEPENDS on, never on every defect anywhere in the map.
    // THE ROLE ITSELF MAY BE ILLEGIBLE, and then membership of the surface set is unknown (round-7
    // gate). `role === 'doc'` answers "no" for `role: "documentation"`, `role: 42` and a missing role
    // alike, so such an entry was skipped as non-documentation while `validate()` refused the map —
    // the same validate-refuses / drift-accuses shape as the three fail-opens already closed. An
    // unreadable role is the PATH argument applied to the other field that decides membership: what a
    // complete harvest must cover is unknown, and an absence is evidence only if the search that
    // failed to find it was complete.
    const legibleRole = source.role === 'doc' || source.role === 'code';
    if (!legibleRole) {
      refuse('role');
      continue;
    }
    const readablePath = nonEmptyString(source.path);
    if (!readablePath) {
      if (source.role === 'doc') refuse('path');
      continue;
    }
    if (seen.has(source.path)) duplicated.add(source.path);
    else seen.add(source.path);
    if (source.role === 'doc' && pathSyntaxError(source.path) !== null) refuse('path');
  }
  // Reported ahead of the duplicate case: an illegal path is wrong on its own terms, where a duplicate
  // is only wrong against another entry, and the more local defect names the more actionable fix.
  if (illegal !== '') {
    const because = {
      path: 'with a path the path rules refuse',
      role: 'under a role that is neither `code` nor `doc`',
      entry: 'in an entry that is not a record at all',
    }[illegal];
    return `the map declares its documentation surfaces ${because}, so the set a harvest must cover `
      + 'is not a set this contract can read';
  }
  for (const p of duplicated) {
    const roles = asArray(snapshot.sources).filter((s) => isRecord(s) && s.path === p);
    if (roles.some((s) => s.role === 'doc')) {
      return 'the map declares its documentation surfaces more than once for the same path, so '
        + 'whether that path is a documentation surface — and how many lines the map says it holds — '
        + 'has two answers in one map';
    }
  }
  return '';
}

/** The three coverage buckets, in the order `validate.mjs` classifies them. */
const COVERAGE_BUCKETS = Object.freeze(['read', 'partial', 'skipped']);

/**
 * The map's own statement of which files it READ IN FULL — as a PARTITION, not as one bucket.
 *
 * Needed here because completeness is a claim about an ABSENCE, and an absence found in a file the map
 * itself says it never opened (`coverage.skipped`) or only skimmed (`coverage.partial`) is not
 * evidence. `validate.mjs` refuses that combination by path; this is the same rule, read off the same
 * statements, so the drift engine cannot accuse on a record the validator rejects.
 *
 * WHY THE WHOLE PARTITION, and not `coverage.read` alone (2026-08-14). This used to collect
 * `coverage.read` into a Set and ask nothing else, so it answered "does the map list this path as
 * read?" while the rule it stands for is "does the map classify this path as read, and ONLY as read?".
 * Those differ on exactly the shape `validate.mjs` exists to refuse: a path in `coverage.read` AND in
 * `coverage.skipped` is two contradictory statements about one file, the validator reports it as
 * `classified exactly once`, and the membership test passed it anyway — so `computeDrift()` accused on
 * a map that says in one breath it never opened the surface the accusation rests on. Reproduced on
 * `tiny.map.json`: one validator error, and an UNDOCUMENTED finding regardless. Reading one bucket is
 * not reading the partition.
 *
 * FAIL CLOSED, twice over:
 *   • a path classified more than once — in two buckets, or twice in one — is usable from NEITHER, so
 *     the contradiction can never be resolved in the accusing direction;
 *   • a bucket that is not an array at all makes the partition unreadable, and then NO path is soundly
 *     classified. `validate.mjs` reports that malformation itself; here it simply means the map has
 *     not said what it read, and a map that cannot say what it read has established nothing about what
 *     it did not find.
 */
function readOnceSurfaces(snapshot) {
  const coverage = isRecord(snapshot) ? snapshot.coverage : null;
  const counts = new Map();
  const bucketOf = new Map();
  let wellFormed = isRecord(coverage);
  for (const key of COVERAGE_BUCKETS) {
    const entries = isRecord(coverage) ? coverage[key] : null;
    if (!Array.isArray(entries)) { wellFormed = false; continue; }
    for (const entry of entries) {
      // `read` carries bare paths; `partial` / `skipped` carry `{ path, why }`.
      //
      // AN ENTRY THIS CANNOT READ MAKES THE PARTITION UNREADABLE — it is a DEFECT, not a dropped element,
      // and until 2026-08-15 it was the latter. The line here said "anything else is not a classification
      // of a path and is `validate.mjs`'s to report", then `continue`d — so a malformed entry was not
      // ignored harmlessly, it was ignored FAVOURABLY. Probed in ten shapes on `tiny.map.json`, each with
      // one validator error and `computeDrift()` establishing `env.tiny_debug` regardless.
      //
      // WHY DROPPING IS UNSOUND HERE and not merely untidy. The worst shape is `TINY_DOC` pushed into
      // `coverage.partial` as a BARE STRING. That is a SECOND, CONTRADICTORY classification of the exact
      // surface the accusation rests on — the map saying in one bucket that it read the file in full and
      // in another that it only skimmed it, which is what `validate.mjs` reports as `classified exactly
      // once`. Counted, it takes the path to two classifications and out of `readOnce`; dropped, the
      // count stays at one and the surface reads as cleanly read. A smaller input makes agreement easier,
      // and agreement is the whole of state 2 — so every drop in this gate leans fail-open by
      // construction. This is the same lesson `declaredLengths()` records one function down, where
      // breaking the ruler was cheaper than passing the measurement.
      //
      // `why` IS NOT CHECKED HERE, and that is scope rather than oversight: an entry missing its `why` has
      // still CLASSIFIED the path, so the partition is stated and this gate's question is answered. That
      // one is the validator's, exactly as a `role: "code"` duplicate is.
      const malformed = key === 'read'
        ? !nonEmptyString(entry)
        : !isRecord(entry) || !nonEmptyString(entry.path);
      if (malformed) { wellFormed = false; continue; }
      const p = key === 'read' ? entry : entry.path;
      counts.set(p, (counts.get(p) ?? 0) + 1);
      bucketOf.set(p, key);
    }
  }
  const readOnce = new Set();
  if (!wellFormed) return readOnce;
  for (const [p, n] of counts) if (n === 1 && bucketOf.get(p) === 'read') readOnce.add(p);
  return readOnce;
}

/**
 * The declared LENGTH of every source the map hashes — `sources[].lines`, by path.
 *
 * The harvest gate needs it for the same reason `validate.mjs` does: a candidate is a quote from a
 * place, and a place past the end of the file is not a place. Held as a map rather than re-derived per
 * candidate so the whole boundary is still read exactly once.
 *
 * DELIBERATELY PARTIAL, and the ABSENCE IS A SIGNAL — read the use site before changing this. A source
 * whose `lines` the contract cannot read is left OUT, so "no entry here" means "declared, and its
 * length is unusable" for every path that can reach the check (a candidate may only sit on a surface
 * the record says it searched, and a searched surface is always one of the map's declared `role:"doc"`
 * sources). The caller must therefore treat a missing entry as a defect and NOT as "no bound to
 * apply": until 2026-08-14 it did the latter, and `lines: "18"` — a string, which `validate.mjs`
 * refuses outright — turned the strictest rule in this gate off for that surface entirely.
 */
function declaredLengths(snapshot) {
  const lengths = new Map();
  for (const source of asArray(isRecord(snapshot) ? snapshot.sources : null)) {
    if (isRecord(source) && nonEmptyString(source.path) && Number.isInteger(source.lines)) {
      lengths.set(source.path, source.lines);
    }
  }
  return lengths;
}

/**
 * Everything the harvest gate needs about the MAP, gathered once at the boundary: the surfaces a
 * complete harvest must cover, whether that declaration is legible at all, the ones the map classifies
 * as fully read AND as nothing else, and how long the map says each declared file is.
 *
 * One object rather than four positional arguments because these statements are read TOGETHER by every
 * rule below — a surface is only usable evidence when it is DECLARED ONCE and legibly, classified READ
 * exactly once, and long enough to hold the line a candidate cites.
 */
function docContextOf(snapshot) {
  return {
    surfaces: declaredDocSurfaces(snapshot),
    declarationDefect: docDeclarationDefect(snapshot),
    readOnce: readOnceSurfaces(snapshot),
    lengths: declaredLengths(snapshot),
  };
}

/**
 * Is this `docHarvest` record one the contract can read at all? Returns the DEFECT, or `''`.
 *
 * The gate used to consult exactly one slot of the record — `searched`, filtered down to its
 * non-empty strings — and nothing else. Everything the record says about ITSELF was therefore
 * unexamined: a record could carry `complete: true` (the self-graded field `validate.mjs` refuses
 * outright), a `searched` array whose other entries were objects or nulls, a `searched` entry naming a
 * surface this map never declared, or no `candidates` array at all — and still reach state 2, because
 * the strings that survived the filter happened to cover the declared surfaces. A record too
 * malformed for the validator to accept was buying accusations from the drift engine.
 *
 * FAIL CLOSED, and by the VALIDATOR's rules rather than by a second set written here: the forbidden
 * keys and the disposition vocabulary are IMPORTED, so a record this predicate calls defective is a
 * record `validate.mjs` refuses for the same stated reason.
 *
 * WHAT IS CHECKED, and why the line moved (2026-08-14). It used to be "the record's OWN shape plus the
 * declared doc surfaces", with everything needing more of the map left to the validator on the ground
 * that this module did not hold it. THREE of those rules needed no more of the map than this module
 * can reach, and leaving them out was a hole rather than a division of labour: `computeDrift()`
 * reported UNDOCUMENTED — and `coverage.established` — for maps `validate()` REFUSES, which is exactly
 * the state-3 case C-018 says must be withheld ("a record the contract cannot read"). Each was
 * reproduced on `tiny.map.json`, each with one validator error and an accusation anyway:
 *
 *   • a candidate citing a path the harvest never searched — a hit found where nobody looked;
 *   • an `asserts` candidate never PROMOTED into `claims[]` — the node's own harvest records real
 *     documentation at a real line, and the node is accused of having none. This is the worst of the
 *     three: the record contains the evidence that refutes the finding it buys;
 *   • a searched surface the map's own `coverage` calls `skipped` or `partial` — a search of a file
 *     the map says it never read in full.
 *
 * What genuinely stays the validator's is what needs the FILESYSTEM or the whole document: a citation's
 * line against its file's declared length, path containment, the source digests. Those are not
 * restated here.
 *
 * PATH-FREE, like every other reason built here: it is rendered as prose in a table cell (see
 * `harvestStateOf`), and a source-derived string in that cell would have to be a backticked span.
 */
function harvestRecordDefect(record, docContext, node) {
  const docSurfaces = docContext.surfaces;
  for (const key of DOC_HARVEST_FORBIDDEN_KEYS) {
    if (Object.hasOwn(record, key)) {
      return 'the docHarvest record declares its own completeness, which the contract forbids — '
        + 'completeness is derived from what was searched, never asserted by the extractor';
    }
  }
  if (!Array.isArray(record.searched)) {
    return 'the docHarvest record does not say what it searched — `searched` must be an array of the '
      + 'documentation surfaces this node was harvested against';
  }
  const declared = new Set(docSurfaces);
  const seen = new Set();
  for (const entry of record.searched) {
    if (!nonEmptyString(entry)) {
      return 'the docHarvest record lists something other than a documentation surface path among the '
        + 'surfaces it searched, so what it actually read cannot be established';
    }
    if (!declared.has(entry)) {
      return 'the docHarvest record claims to have searched a surface this map does not declare as a '
        + 'role:"doc" source, so the search cannot be checked against the map';
    }
    if (seen.has(entry)) {
      return 'the docHarvest record names the same documentation surface twice, so what it searched '
        + 'is not a well-formed statement';
    }
    // …and the map's OWN coverage has to agree that the file was read IN FULL, and say it ONCE.
    // `sources[]` says the surface exists and is hashed; `coverage` is where the map says whether this
    // run opened it — and a path carrying two classifications has said both things at once, which is
    // no statement at all (see `readOnceSurfaces`).
    if (!docContext.readOnce.has(entry)) {
      return 'the docHarvest record reports having searched a documentation surface this map does not '
        + 'classify, exactly once and as fully read, so the map says in one place that it never read '
        + 'the file in full and in another that it harvested this node against it';
    }
    seen.add(entry);
  }
  if (!Array.isArray(record.candidates)) {
    return 'the docHarvest record does not say what it found — `candidates` must be an array, empty '
      + 'when the search returned nothing, and never absent';
  }
  // The node's own promoted documentation, read raw: this predicate must never throw, and a claim too
  // malformed to be a citation is reported by `validate.mjs` as its own error rather than swallowed
  // here. Matched on `path` + `line`, which is the promotion rule `validate.mjs` enforces verbatim.
  const docClaims = asArray(isRecord(node) ? node.claims : null)
    .filter((c) => isRecord(c) && c.claimKind === 'doc');
  for (const candidate of record.candidates) {
    if (!isRecord(candidate) || !nonEmptyString(candidate.path)
      || !Number.isInteger(candidate.line) || candidate.line < 1
      || !nonEmptyString(candidate.quote)) {
      return 'the docHarvest record carries a hit a reader cannot open or read — every candidate must '
        + 'name a path and a line and quote the text found there';
    }
    if (!DOC_HARVEST_DISPOSITIONS.includes(candidate.disposition)) {
      return 'the docHarvest record carries a hit it never dispositioned as asserting the node\'s '
        + 'behaviour or merely mentioning it, which is the judgement the attestation exists to force';
    }
    if (!seen.has(candidate.path)) {
      return 'the docHarvest record carries a hit on a file it never says it searched, and a hit found '
        + 'where nobody looked leaves what the search actually covered unestablished';
    }
    // …and the hit must sit INSIDE the file, by the map's own declared length. `validate.mjs` refuses
    // the citation for the same reason (`checkCitation`); the gate never consulted `sources[].lines`,
    // so a quote attributed to line 999 of an 18-line surface established an accusation. A citation a
    // reader cannot open is the one thing PDR §8 says a finding may never rest on.
    //
    // A LENGTH THE CONTRACT CANNOT READ FAILS CLOSED, and this is the half that was open until
    // 2026-08-14 (pre-PR review). The bound used to be applied only `if (Number.isInteger(...))`, so a
    // source declaring its length as the STRING `"18"` dropped out of `declaredLengths()`, the guard
    // read `undefined`, and the check was SKIPPED — a candidate at line 999 of that same surface then
    // established the accusation. Breaking the ruler was cheaper than passing the measurement, which
    // is the shape of every fail-open: the map that should be refused hardest was accepted.
    //
    // AND "NO LENGTH DECLARED" IS NOT A LEGITIMATE CASE TO CARVE OUT. Every source MUST state one —
    // `validate.mjs` requires `lines` to be a non-negative integer on every `sources[]` entry, and
    // reports this very map's `"18"` as its own error — so a surface with no readable length is not a
    // file that "happens to have no length", it is a map the contract already refuses. Nothing here
    // may soften that into an exemption: what a harvest establishes rests on citations a reader can
    // open, and where the map itself cannot say how long the file is, no citation into it is
    // checkable and the node is state 3.
    const declaredLength = docContext.lengths.get(candidate.path);
    if (!Number.isInteger(declaredLength)) {
      return 'the docHarvest record carries a hit on a documentation surface this map does not state '
        + 'a readable length for, so whether the quoted line exists in it cannot be checked at all — '
        + 'and a bound that cannot be checked is not a bound this record may be accepted under';
    }
    if (candidate.line > declaredLength) {
      return 'the docHarvest record carries a hit past the end of the file it says it searched, by '
        + 'this map\'s own line count, so the text it quotes cannot be read where it says to look';
    }
    // The one that would otherwise accuse a node its OWN record documents: `asserts` obliges the
    // extractor to promote the candidate into `claims[]` at the same path and line, and an unpromoted
    // one is a map holding real documentation for this node while reporting it undocumented.
    if (candidate.disposition === 'asserts'
      && !docClaims.some((c) => c.path === candidate.path && c.line === candidate.line)) {
      return 'the docHarvest record dispositions a hit as ASSERTING this node\'s behaviour and never '
        + 'promotes it into a documentation claim, so the record itself carries documentation the map '
        + 'would be accusing this node of not having';
    }
  }
  return '';
}

/**
 * One node's harvest state against those surfaces. Never throws: a malformed record is INCOMPLETE,
 * which is the safe direction — `validate.mjs` is what reports the malformation, in full and by path.
 */
function harvestStateOf(node, docContext) {
  const docSurfaces = docContext.surfaces;
  // FIRST, and before the record is even looked at, because the defect is the MAP's and not the
  // node's: with nothing declared to search, `missing` below would be empty vacuously and every node
  // would read as harvest-complete against a record naming no surface as searched. Reported ahead of
  // the missing-record case so the reason names the real cause — an extractor cannot fix this one by
  // writing a record.
  // ATTESTED, NOT OBSERVED (ADR C-018 amendment). This comment said such a map read as complete "after
  // no search at all", which is a claim about the world; no harvest check opens a file, so what the gate
  // sees is a record that names no surface, and that is what it now says.
  if (docContext.declarationDefect !== '') {
    return {
      complete: false,
      searched: [],
      missing: [...docSurfaces],
      reason: `${docContext.declarationDefect}, so the map has not established that the documentation `
        + 'is silent about it',
    };
  }
  // SECOND: a genuinely empty declaration, reached only once the declaration itself is legible.
  if (docSurfaces.length === 0) {
    return {
      complete: false,
      searched: [],
      missing: [],
      // States the DECLARATION, never the world. C-018 keeps undeclared surfaces possible, so "there
      // was no documentation surface to search" asserted an absence this pipeline cannot observe —
      // the same overclaim the C-018 amendment retired from `markdown.mjs` and `SKILL.md`. Pinned by
      // `doc-harvest.test.mjs`'s 4c1 sweep.
      reason: 'the map declares no role:"doc" source, so it declares no documentation surface for an '
        + 'attestation to cover — nowhere to look is not the same as nothing to find, and the map has '
        + 'not established that the documentation is silent about it',
    };
  }
  // SECOND, and for the same reason: a surface set that is not legible is not a set to compare against.
  // Mutually exclusive with the branch above — the duplicate half requires a `doc` declaration and the
  // syntax half requires a `doc` path, so neither can fire on a map that declares no doc surface.
  const record = node.docHarvest;
  if (!isRecord(record)) {
    return {
      complete: false,
      searched: [],
      missing: [...docSurfaces],
      // PATH-FREE by construction. The surfaces have their own column in both renderers, and a reason
      // that embedded them would be a source-derived string — which a Markdown table cell can only
      // carry as an inert code span, turning a sentence into a backticked wall. This one is built
      // from a fixed template and integers alone, so it is safe to render as prose.
      // ATTESTED, NOT OBSERVED (ADR C-018 amendment). This said the harvest "was run", which is a
      // claim about the world — and the gate above compares two extractor-written lists and opens no
      // file, so an extractor who read every surface and one who read none reach this line
      // identically. What is actually missing is the RECORD, and that is what the reason now names.
      reason: 'no docHarvest record — this node carries no documentation-harvest attestation, so the '
        + 'map has not established that the documentation is silent about it',
    };
  }
  // MALFORMED IS INCOMPLETE. Judged before `searched` is read for coverage, because a record the
  // contract cannot read is not a search this map can stand behind — whatever its strings happen to
  // cover. `missing` names every declared surface: nothing has been established about any of them.
  const defect = harvestRecordDefect(record, docContext, node);
  if (defect !== '') {
    return {
      complete: false,
      searched: [],
      missing: [...docSurfaces],
      reason: `${defect}, so the map has not established that the documentation is silent about it`,
    };
  }
  const searched = asArray(record.searched).filter(nonEmptyString);
  const seen = new Set(searched);
  const missing = docSurfaces.filter((p) => !seen.has(p));
  if (missing.length === 0) return { complete: true, searched, missing, reason: '' };
  return {
    complete: false,
    searched,
    missing,
    // "searched … unread" reported two acts; the comparison above reads two lists. Restated as what
    // the record accounts for, which is all this line ever measured (ADR C-018 amendment).
    reason: `the harvest attestation records ${searched.length} of ${docSurfaces.length} declared `
      + `documentation surfaces as searched, leaving ${missing.length} unaccounted for`,
  };
}

/** Is this node even in play for the UNDOCUMENTED question? Evidenced, and not already documented. */
function awaitsDocVerdict(node) {
  if (node.inferred === true) return false;
  if (citableRecords(node, 'evidence').length === 0) return false;
  return !citableRecords(node, 'claims').some((c) => c.claimKind === 'doc');
}

/** The coverage statement — the state-3 population, stated rather than accused. */
function coverageOf(snapshot) {
  const docContext = docContextOf(snapshot);
  const docSurfaces = docContext.surfaces;
  const established = [];
  const withheld = [];
  for (const node of asArray(isRecord(snapshot) ? snapshot.nodes : null)) {
    if (!isRecord(node) || !awaitsDocVerdict(node)) continue;
    const harvest = harvestStateOf(node, docContext);
    if (harvest.complete) {
      established.push(node.id);
    } else {
      withheld.push({
        nodeId: node.id,
        label: node.label,
        searched: harvest.searched,
        missing: harvest.missing,
        reason: harvest.reason,
      });
    }
  }
  return {
    docSurfaces,
    established: established.sort(cmpString),
    withheld: withheld.sort((a, b) => cmpString(a.nodeId, b.nodeId)),
  };
}

/**
 * The set-membership families (A). Returns at most ONE finding: the three classes partition the
 * "documented?" × "evidenced?" grid, so a node can never be two of them at once.
 */
function membershipFinding(node, docContext) {
  const claims = citableRecords(node, 'claims');
  const evidence = citableRecords(node, 'evidence');
  const docClaims = claims.filter((c) => c.claimKind === 'doc');   // ADR C-014

  // RULE 5 — a claim the extractor could not check is reported as UNCHECKABLE, never as a defect
  // (PDR §8.1 guardrail 3). The test is `checked === false`, i.e. the extractor SAID it could not
  // check. An ABSENT `checked` key is silence, not a disclaimer: reading silence as "unchecked"
  // would dissolve the PHANTOM class entirely for any extractor that omits the flag, and PHANTOM
  // is the class the acceptance oracle leans on hardest.
  //
  // JUDGED BEFORE, AND INDEPENDENTLY OF, THE DOC-CLAIM QUESTION (round-7 gate). This test used to sit
  // INSIDE the `docClaims.length > 0` branch below, while the only other branch requires
  // `evidence.length > 0`. A non-inferred node with no evidence whose claims were all unchecked and
  // none of them `doc` therefore matched neither branch and returned `null` — a SILENT MISS on a map
  // the validator accepts, not a considered silence. C-005 conditions UNVERIFIED on what the extractor
  // said about CHECKING; `claimKind` is C-014's question and answers a different one.
  if (evidence.length === 0 && claims.length > 0 && claims.every((c) => c.checked === false)) {
    const cited = [...claims].sort(compareCitations);
    return finding('UNVERIFIED', node,
      `Claimed at ${where(cited)} with no code evidence, and every claim is marked unchecked — `
      + 'reported as uncheckable rather than as a defect.', cited);
  }

  if (docClaims.length > 0 && evidence.length === 0) {
    const cited = [...docClaims].sort(compareCitations);
    return finding('PHANTOM', node,
      `Documented at ${where(cited)}, but the map carries no code evidence that it exists.`, cited);
  }

  if (evidence.length > 0 && docClaims.length === 0) {
    // ADR decision F — state 2 ONLY. Without a complete harvest this node is state 3: the map has not
    // established that the docs are silent about it, merely that it did not look. That is a COVERAGE
    // statement (see `coverageOf`), never a finding, because `drift.json`'s findings are accusations.
    if (!harvestStateOf(node, docContext).complete) return null;
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
    // WHICH claim is wrong — the run-4 defect (2026-08-14).
    //
    // Run 4 shipped a STALE finding that was substantively CORRECT and cited the wrong side: the
    // record named an ACCURATE doc line while the genuinely stale `user-message` sat on the same node,
    // present in `claims[]` and never wired as the contradicted claim. `drift.json` then sent a
    // maintainer to change text that needed no changing. Right finding, wrong pointer — a failure the
    // two-citations rule cannot see, because the citation it checked did resolve and did belong to the
    // node.
    //
    // `refutedQuote` is what makes the pointer checkable: the exact fragment of `claim.text` the
    // evidence refutes. Where it does not occur in the claim the record cites, the record contradicts
    // ITSELF, and emitting the finding anyway would publish an accusation the engine can already see
    // is misdirected — the same reason every other guard here fails closed.
    //
    // ASYMMETRY, deliberate and load-bearing: an ABSENT `refutedQuote` is NOT refused here.
    // `validate.mjs` REQUIRES the field — it is the contract, and `render.mjs` validates before it
    // computes anything, so no map ships without it. But maps written before the rule exist and are
    // frozen records (`run-3-candidate/map.json` among them); throwing on them would silently DELETE
    // real STALE findings from every one, which is the one thing a drift engine may never do. The
    // contract tightens; the derivation does not weaken.
    const refutedQuote = record.refutedQuote;
    if (refutedQuote !== undefined && !quotesFragment(sides.claim.text, refutedQuote)) {
      throw new Error(
        `computeDrift: ${at}.refutedQuote ${show(refutedQuote)} does not appear in ${at}.claim.text `
        + `${show(sides.claim.text)} — a contradiction names the claim whose text the evidence `
        + 'refutes, and this record points somewhere else. Emitting it would send a reader to change '
        + 'a line the evidence says nothing about (PDR §8).',
      );
    }
    // ORDERED, not sorted: the REFUTED side first, then what was observed. That is the sentence a
    // reader is meant to follow, and citation one is now contractually the text that must change.
    const stale = finding('STALE', node, statement, [sides.claim, sides.evidence]);
    // Carried onto the finding so `drift.json` records WHICH words are wrong and not merely which
    // line — the artifact says what the map asserted, rather than the reader having to trust that the
    // gate ran. Omitted when the record never named one, because a finding may not claim more than
    // its record does.
    if (refutedQuote !== undefined) stale.refutedQuote = refutedQuote;
    return stale;
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
 * docHarvestCoverage(map) -> { docSurfaces, established, withheld } — pure, and the ONE statement of
 * the three-state rule (ADR C-018).
 *
 * Exported because both renderers must SHOW it, and a renderer that re-derived completeness privately
 * would be the second copy of a rule — the exact drift class this whole skill exists to detect. The
 * page and the Markdown twin therefore read this function's answer rather than computing their own.
 *
 * It reports only the nodes where the harvest state actually DECIDES something: non-inferred, carrying
 * code evidence, carrying no `doc` claim. A documented node is not in play (state 1 needs no harvest),
 * and an unevidenced one is a PHANTOM/UNVERIFIED question, not this one.
 */
export function docHarvestCoverage(map) {
  return coverageOf(canonicalMap(map));
}

/**
 * reconcileCoverage(caller, coverage, findings) — the guard the two EXPORTED renderers need and
 * `computeDrift` does not (ADR C-018).
 *
 * `renderPage(map, findings)` and `toMarkdown(map, findings)` take the accusations from the CALLER
 * and derive the coverage statement from the MAP. Nothing forces those two to have come from the same
 * run, and a stored PRE-C-018 `drift.json` re-rendered against its own `map.json` is exactly the pair
 * that disagrees: the finding list accuses a node the map now withholds the verdict on, so one page
 * says "UNDOCUMENTED" in the drift lane and "not established as undocumented" in the coverage table
 * about the same node. `enforceOnMapDrift` already fails closed on a different caller/map mismatch —
 * a finding drawn nowhere — for the same reason: a report that contradicts itself is worse than one
 * that refuses to render.
 *
 * The test is EQUALITY of two sets, and it has to be, because the disagreement is symmetric.
 *
 *   • a finding the map does not establish — the caller ACCUSES a node the coverage section reports
 *     the verdict as withheld on. One page, two answers.
 *   • an established node no finding names — the coverage section states this map searched every
 *     declared documentation surface for that node and found no `doc` claim, i.e. it says the node IS
 *     established as undocumented, while the drift lane accuses nobody. That reads as a clean bill of
 *     health the map never issued, and it is the direction a caller reaches by accident: passing `[]`
 *     ("this map has no drift"), or a finding list filtered down to one class, or a stale `drift.json`
 *     written before the harvest was added. Rejecting only the first direction made this guard itself
 *     a misdirection — it refused the loud mismatch and blessed the silent one, which is the worse of
 *     the two for an audit tool, since a missing accusation is worse than a wrong one (see
 *     `toMarkdown`'s refusal to default `findings`).
 *
 * Equality is exactly right and not merely conservative: `computeDrift` raises UNDOCUMENTED on
 * precisely the nodes `coverageOf` puts in `established` — both read `awaitsDocVerdict` and
 * `harvestStateOf` over one snapshot — so the two sets are equal by construction on its own output,
 * and can differ only when the findings did not come from this map.
 */
export function reconcileCoverage(caller, coverage, findings) {
  const established = new Set(asArray(isRecord(coverage) ? coverage.established : null));
  const accused = new Set(asArray(findings)
    .filter((f) => isRecord(f) && f.class === 'UNDOCUMENTED')
    .map((f) => String(f.nodeId)));

  const unsupported = [...accused].filter((id) => !established.has(id)).sort(cmpString);
  if (unsupported.length > 0) {
    const one = unsupported.length === 1;
    throw new Error(
      `${caller}: ${unsupported.join(', ')} ${one ? 'is' : 'are'} accused of being UNDOCUMENTED by the `
      + `findings passed in, but THIS map does not establish ${one ? 'it' : 'them'} — the documentation `
      + 'harvest behind the accusation is not in the map being rendered, so the coverage section would '
      + 'report the verdict as withheld while the drift lane states it (ADR C-018). The findings and '
      + 'the map are from different runs; recompute the findings from this map with computeDrift().',
    );
  }

  const unaccused = [...established].filter((id) => !accused.has(id)).sort(cmpString);
  if (unaccused.length === 0) return;
  const one = unaccused.length === 1;
  throw new Error(
    `${caller}: THIS map establishes ${unaccused.join(', ')} as UNDOCUMENTED — ${one ? 'it carries' : 'each carries'} `
    + `code evidence, no claimKind:"doc" claim, and a harvest that covered every declared documentation `
    + `surface — but the findings passed in accuse ${one ? 'it' : 'them'} of nothing. The coverage `
    + 'section would state the verdict while the drift lane stayed silent about it, which reads as a '
    + 'clean bill of health this map does not issue (ADR C-018). The findings and the map are from '
    + 'different runs; recompute the findings from this map with computeDrift().',
  );
}

/**
 * computeDrift(map) -> { findings, coverage } — pure. Never mutates `map`; never writes findings into
 * it; never hands back one of its objects.
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
  const docContext = docContextOf(snapshot);
  const findings = [];
  for (const node of asArray(isRecord(snapshot) ? snapshot.nodes : null)) {
    if (!isRecord(node)) continue;
    // RULE 6 / ADR C-005 — inference never accuses. Excluded from EVERY class, family (B) included:
    // a contradiction recorded against a node the extractor only inferred is still a guess.
    if (node.inferred === true) continue;

    const membership = membershipFinding(node, docContext);
    if (membership) findings.push(membership);
    findings.push(...staleFindings(node));
  }
  // ONE snapshot, both answers: the coverage statement is derived from the SAME inert data the
  // findings are, through the same predicates, so THESE two can never disagree about a node. That is
  // a property of this return value alone — a renderer handed findings from somewhere else has no
  // such guarantee, which is what `reconcileCoverage` above is for.
  return { findings: findings.sort(compareFindings), coverage: coverageOf(snapshot) };
}
