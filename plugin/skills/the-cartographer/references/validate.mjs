// the-cartographer — the IR contract, enforced. This module IS the schema (ADR C-006): no
// map.schema.json ships, because a schema file plus a validator is two artifacts that can drift
// from each other — precisely the defect class this skill exists to detect.
//
// validate() NEVER throws. It returns { ok, errors, warnings, containmentChecked } so a malformed
// agent-produced map produces a readable report instead of a stack trace.
//
// It validates the CANONICAL form of its input (see `canonical.mjs`): the map is ingested once,
// through the boundary every consumer reads through, and every check below then runs on inert JSON
// data. That is what makes "validated" and "written" the same value — the three phases before this one
// each closed a round on the gap between them — and it is why the checks here read plain properties:
// after the boundary there is nothing left for a descriptor read to see that a plain get would not.
//
// Zero dependencies: node built-ins only.

import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { ABSENT, ingest } from './canonical.mjs';

// ─── the closed sets (exported once; layout.mjs / mermaid.mjs import them) ────────────────────────

export const SUBJECT_KINDS = ['skill', 'feature', 'codebase'];
export const NODE_KINDS = ['mode', 'flag', 'env', 'outcome', 'artifact', 'component', 'external', 'state'];
export const LANES = ['entry', 'core', 'output', 'external'];
export const VIEW_FORMS = ['svg-hero', 'mermaid', 'table'];
export const CLAIM_KINDS = ['doc', 'code-comment', 'user-message'];
export const EDGE_KINDS = ['control', 'data', 'doc'];
export const SOURCE_ROLES = ['code', 'doc'];
export const MERMAID_TYPES = ['flowchart', 'stateDiagram-v2'];

/**
 * ADR decision F — what a harvest candidate WAS, once the extractor read it.
 *
 * A harvest hit is a CANDIDATE, not a claim. `SKILL.md` §3 requires searching each item's name AND
 * its synonyms, so the search is deliberately loose — and a loose search that automatically counted
 * as documentation would replace one silent failure with a louder one. The disposition is where the
 * extractor says which it found:
 *
 *   `asserts`  — the text says what the node DOES, defaults to, or IS. Real documentation, and the
 *                validator therefore requires it to be PROMOTED into `claims[]` as a `doc` claim.
 *   `mentions` — the text merely NAMES the node: a positional landmark ("right where X would fire"),
 *                a "see also". NOT a comparison — C-018's addendum and `doc-harvest.test.mjs`'s test
 *                3d both settle that a comparison can ASSERT of what it compares, and this list gave
 *                it as a canonical `mentions` example *(corrected 2026-08-28)*. Recorded so the
 *                reader can see the harvest found it and
 *                judged it — and it documents nothing.
 *
 * CLOSED, and only two members, because the distinction is binary at the point of use: either the
 * node is documented or it is not. A "maybe" tier would be a third state nothing could act on, and
 * the extractor would drain into it every time the call was hard — which is exactly the judgement
 * decision F exists to force.
 */
export const DOC_HARVEST_DISPOSITIONS = ['asserts', 'mentions'];

/**
 * Keys a `docHarvest` record may NOT carry, because each is the extractor grading its own homework.
 * Completeness is DERIVED — `searched` against the map's own `role: "doc"` sources — and a record
 * that could declare itself complete would restore, in one field, precisely the self-grading
 * decision F removed. It does NOT stop an extractor certifying itself — a false `searched` entry or
 * an undeclared doc surface does that just as well, and nothing here can see either (ADR C-018
 * amendment) — it stops the one field a reader would mistake for a DERIVED fact. Refused loudly
 * rather than ignored: a key the contract silently drops is a key an extractor keeps writing and
 * keeps believing.
 *
 * EXPORTED so `diff.mjs` can FAIL CLOSED on the same list rather than restating it. The drift engine
 * is a public entry point and runs on maps that never passed this validator, so it has to recognise a
 * self-grading record on its own — and a second, privately-maintained copy of this list is the
 * two-artifacts-that-must-agree drift this whole skill exists to detect.
 */
export const DOC_HARVEST_FORBIDDEN_KEYS = Object.freeze(['complete', 'incomplete', 'covered', 'exhaustive']);

/**
 * ADR C-002's hero bound, exported so `layout.mjs` can BIND to it rather than restate it.
 *
 * The bound is what buys the hero a ~100-line lane layout instead of a DAG engine, and C-006 makes
 * this file the single executable IR contract — so the number lives here, once. A second copy in the
 * renderer is the drift class this skill exists to detect, and it is not hypothetical: the rule was
 * enforced ONLY in `layoutHero`, so a 16-node overview validated `ok: true` and then threw at render.
 */
export const HERO_MAX_NODES = 15;

/**
 * SPEC DEFECT 7 — the claimKind ↔ source-role binding that makes ADR C-014 real rather than
 * advisory. Without it an extractor can label a code comment `doc`, and the UNDOCUMENTED finding
 * it should have raised silently disappears.
 */
export const CLAIM_KIND_ROLE = { doc: 'doc', 'code-comment': 'code', 'user-message': 'code' };

/**
 * The FOLD a table column's name is matched by. Letters only, lowercased — so "Doc Status",
 * "doc-status" and "docstatus" are one column, and a table header stays readable prose.
 *
 * Folded from the RAW author-written name, never from a rendered cell: both renderers escape before
 * they display, and `markdown.mjs` writes a tab as the two characters `\t`, so folding the RENDERING
 * would read a letter `t` nobody wrote and "Doc\tStatus" would stop being `docstatus`.
 */
export const foldColumnName = (name) => String(name).toLowerCase().replace(/[^a-z]/g, '');

/**
 * The CLOSED table-column vocabulary — every column name a renderer can actually derive a value for,
 * folded by `foldColumnName`. Frozen, and the ONE statement of the set: both renderers import the
 * fold above, and `table-columns.test.mjs` pins each renderer's `DERIVABLE_COLUMN_KEYS` to this list
 * EXACTLY, in both directions, so the three cannot drift apart in silence.
 *
 * Why closed, and why here. A column is not a caption: a renderer has no derivation for a name it
 * does not know, so a column outside this set fills EVERY row with `(no value for this column)` —
 * a table that looks complete and conveys nothing, which is PDR §14's top risk realized. Run 3
 * shipped exactly that: `"What it does"` folds to `whatitdoes`, which no renderer derives, and 125
 * of 125 rows were placeholders because the only rule on a column was "a non-empty string".
 *
 * ADR C-006 puts the rule HERE rather than in a renderer: which columns are derivable is part of
 * what a legal map IS, and a rule a renderer holds privately is the second-copy drift this whole
 * skill exists to detect. An ALIAS would not fix it — the next natural name (`Purpose`, `Role`,
 * `What it is`) fails identically and just as silently, and a list of aliases never catches up with
 * prose. The set stays closed and the refusal TEACHES it, which prose cannot be made to do.
 *
 * `drift` is in the set and in neither renderer's `COLUMN_VALUE` map: both derive it before the
 * lookup, from the findings passed alongside the map rather than from the node.
 */
export const TABLE_COLUMN_KEYS = Object.freeze([
  'capability', 'name', 'node', 'label', 'id', 'kind', 'lane',
  'summary', 'description', 'inferred', 'evidence', 'claims',
  'documented', 'docs', 'documentation', 'docstatus',
  'drift',
]);

const SHA256_RE = /^[0-9a-f]{64}$/;

// ─── canonical id derivation ─────────────────────────────────────────────────────────────────────

/** The ONE transformation: lowercase, every run outside [a-z0-9] → a single `_`, trimmed. */
export function slugify(label) {
  return String(label).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

export function deriveNodeId(kind, label) {
  return `${kind}.${slugify(label)}`;
}

/**
 * SPEC DEFECT 3 — the untyped `e.<from>><to>` shape COLLIDES whenever two edges of different kind
 * (control / data / doc) connect the same pair, silently making a valid graph unrepresentable.
 * The kind is therefore part of the id:
 *
 *     e.<kind>.<from>><to>        e.g. e.control.mode.prepr>component.prepr_common
 *
 * Unambiguous in both directions: `kind` is a closed-set token containing no `.`, node ids are
 * `<kind>.<slug>` where the slug is `[a-z0-9_]*`, and `>` cannot occur in either — so the first
 * `.` after the `e.` prefix ends the kind and the single `>` separates the endpoints.
 */
export function deriveEdgeId(from, to, kind) {
  return `e.${kind}.${from}>${to}`;
}

// ─── control characters (owner, 2026-08-15 · ADR C-023) ──────────────────────────────────────────

/**
 * The three C0 code points that stay LEGAL, and the property that draws the line.
 *
 * A control character that is not whitespace is INVISIBLE: it changes the bytes of a record without
 * changing anything a reader can see. Two records nothing can tell apart must not be two different
 * records — and one of them was, provably. A `kind: "outcome"` label could carry a NUL and this file
 * accepted it with ZERO errors, unable even to DISTINGUISH it from the clean label, because `slugify`
 * collapses every run outside `[a-z0-9]` to a single `_` — the NUL included — so `PASS<U+0000>`
 * derives the required id `outcome.pass` byte-identically. The C-015 coverage-floor scorer then lost
 * the byte at its own `tok=$(…)`, since command substitution cannot carry a NUL, and `grep -qxF`
 * accepted the label as a legitimate source token with no `INVENTED OUTCOME LABEL`. That is the
 * laundering ADR C-020 refuses for a trailing parenthesis, reached through a byte instead, and it was
 * SHELL-DEPENDENT on top: `bash` and `sh` drop it at the capture, `zsh` carries it, so the check's
 * verdict depended on its interpreter.
 *
 * TAB, LINE FEED and CARRIAGE RETURN are a different animal. They are visible AS SEPARATION, every
 * normalizer here already collapses them — `slugify`, `flatten` above, `safeLabel` in mermaid.mjs —
 * and real text carries them: a quote copied out of a claim legitimately picks up a re-wrap on the way
 * into the record, which is exactly what `quotesFragment` exists to tolerate. Refusing them would turn
 * an honest multi-line `claim.text`, `evidence.note`, `statement`, `summary` or `why` into a contract
 * violation, catching nothing, so they are DELIBERATELY not refused.
 *
 * The same line is drawn independently by the map's own output format, which is worth recording because
 * it means this is not merely a taste: the XML 1.0 `Char` production admits exactly these three from
 * the C0 range and defines NO escape for the rest. So the raw U+0000 that `svg.mjs` was observed
 * emitting into a hero `<title>` makes `map.html` a document no conformant parser may accept — the byte
 * is unrepresentable in the artifact, not merely ugly in it.
 *
 * WHAT THIS DOES NOT DO. It removes the INPUT, not the weakness: the C-015 scorer is still not
 * binary-safe, and closing that needs the rewrite ADR C-022 priced. See ADR C-023.
 */
const CONTROL_ALLOWED = new Set([0x09, 0x0a, 0x0d]);

const isRefusedControl = (code) => (code <= 0x1f || code === 0x7f) && !CONTROL_ALLOWED.has(code);

/**
 * The FIRST refused code point in `s`, with its code-point offset — or null.
 *
 * First, not all of them: a string carrying three is ONE thing to fix, and this file reports one fault
 * once (see validate()'s dedup note). Iterated by code point so an offset counts characters a reader
 * would count, and so a surrogate pair is never mistaken for two.
 */
function firstRefusedControl(s) {
  let offset = 0;
  for (const c of s) {
    const code = c.codePointAt(0);
    if (isRefusedControl(code)) return { code, offset };
    offset += 1;
  }
  return null;
}

const uPlus = (code) => `U+${code.toString(16).toUpperCase().padStart(4, '0')}`;

/**
 * ONE statement of the refusal's wording, so a value and a key cannot explain the rule differently.
 * Returns the clause that FOLLOWS "…carries the control character U+xxxx at offset N —".
 */
const CONTROL_WHY = 'it is not tab (U+0009), newline (U+000A) or carriage return (U+000D), and every '
  + 'other control character is INVISIBLE: it changes the bytes of this record without changing '
  + 'anything a reader sees, so two records nothing can tell apart would be two different records. It '
  + 'is unrepresentable in the SVG hero\'s XML as well. Remove it (ADR C-023).';

/** "carries the control character U+0000 at offset 4" — the subject both call sites share. */
const carriesControl = ({ code, offset }) => `carries the control character ${uPlus(code)} at offset ${offset}`;

// ─── path rules (SPEC DEFECT 6) ──────────────────────────────────────────────────────────────────

/**
 * Purely SYNTACTIC path rules — no filesystem, so they always run, with or without a repoRoot.
 * Returns an error fragment, or null when the path is acceptable.
 */
export function pathSyntaxError(p) {
  if (typeof p !== 'string' || p.length === 0) return 'must be a non-empty string';
  // STRICTER THAN PROSE, and deliberately so (ADR C-023). A path refuses EVERY control character,
  // including the tab, newline and carriage return that stay legal in a `claim.text` or a `statement`.
  // Two reasons, and neither is about invisibility:
  //
  //   • a repo-relative path is consumed by LINE-ORIENTED tools — the C-015 scorer reads one path per
  //     line, so do `grep`, the coverage section and the drift report — so a newline inside one is not
  //     a re-wrap, it is a second path, and a tab is a second field;
  //   • a NUL is worse than invisible here. `fs.realpathSync` throws on one, and
  //     `realpathOfExistingPrefix` catches that throw and walks UP to an ancestor that does resolve —
  //     so containment would be verified against a path the map never named, and report success.
  //
  // Checked before every other rule below, because a control character makes the rest of them read a
  // string that is not the string the file carries.
  for (const ch of p) {
    const code = ch.codePointAt(0);
    if (code <= 0x1f || code === 0x7f) {
      return `must not contain a control character (found ${uPlus(code)}) — a path is consumed by `
        + 'line-oriented tools, so tab, newline and carriage return are refused here even though prose '
        + 'may carry them (ADR C-023)';
    }
  }
  if (p.includes('\\')) return 'must use "/" separators (found a backslash)';
  if (/^[A-Za-z]:/.test(p)) return 'must be repo-relative (found a drive prefix)';
  if (p.startsWith('/')) return 'must be repo-relative (found a leading "/")';
  const segments = p.split('/');
  if (segments.some((s) => s === '')) return 'must not contain an empty segment or a trailing slash';
  if (segments.some((s) => s === '.' || s === '..')) return 'must not contain "." or ".." segments';
  if (path.posix.normalize(p) !== p) return 'must be normalized';
  // A subject's own output is not evidence about the subject (and pointing freshness at it would
  // make the map cite itself). Enforced HERE, not merely stated in prose.
  if (segments.includes('.maps')) return 'must not point under ".maps/" — a subject\'s own output is not evidence about the subject';
  return null;
}

/** realpath of the deepest EXISTING ancestor, with the missing tail re-appended textually. */
function realpathOfExistingPrefix(target) {
  const tail = [];
  let current = target;
  for (;;) {
    try {
      const real = fs.realpathSync(current);
      return tail.length ? path.join(real, ...tail) : real;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return target;
      tail.unshift(path.basename(current));
      current = parent;
    }
  }
}

/**
 * Filesystem containment: after symlink resolution the path must sit under repoRoot. Requires an
 * explicit repoRoot — there is deliberately no process.cwd() fallback (SPEC DEFECT 1).
 * A path that does not exist yet is NOT a containment failure; freshness reports it as missing.
 */
export function containmentError(repoRoot, p) {
  let realRoot;
  try {
    realRoot = fs.realpathSync(repoRoot);
  } catch {
    return `repoRoot "${repoRoot}" does not resolve on disk, so containment cannot be verified`;
  }
  const resolved = realpathOfExistingPrefix(path.resolve(realRoot, p));
  if (resolved !== realRoot && !resolved.startsWith(realRoot + path.sep)) {
    return `resolves OUTSIDE the repo root after symlink resolution (${resolved})`;
  }
  return null;
}

// ─── small predicates ────────────────────────────────────────────────────────────────────────────

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const nonEmptyString = (v) => typeof v === 'string' && v.trim() !== '';
const oneOf = (set) => set.join(' | ');
function show(v) {
  try { return JSON.stringify(v); } catch { return String(v); }
}

/**
 * PLAIN object. After ingest every object in the map IS one — the boundary rebuilds them and refuses
 * anything exotic — so this is not a defence against a `Map` any more (that rejection now happens
 * once, at the boundary, in words every consumer shares). It is the `attrs` ROOT rule's predicate:
 * "a bag of named attributes" is an object and not an array.
 */
const isPlainObj = (v) => isObj(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);

const typeName = (v) => (isObj(v) ? (v.constructor?.name ?? 'non-plain object') : typeof v);

/**
 * SPEC DEFECT 8 — "deep-match" as a deep SUBSET: every key the contradiction's citation carries
 * must be present and deeply equal in the node's own record. PDR §8 writes the contradiction's
 * claim as `{path,line,text}` while a `claims[]` entry additionally carries `claimKind`/`checked`,
 * so strict deep-equality would reject the shape the PDR itself prescribes. Subset matching keeps
 * the finding auditable (path + line + text must all agree) without contradicting the spec.
 */
function isSubsetOf(sub, full) {
  if (!isObj(sub) || !isObj(full)) return false;
  return Object.keys(sub).every((k) => k in full && isDeepStrictEqual(sub[k], full[k]));
}

/**
 * Does `text` contain `quote`? The ONE statement of the rule that binds a contradiction's
 * `refutedQuote` to the claim it names — exported because `diff.mjs` must refuse exactly what this
 * refuses, and a second, subtly different copy of a rule is the defect rather than the safeguard
 * (ADR C-006: `validate.mjs` is the single source of truth for the contract).
 *
 * Runs of whitespace collapse on BOTH sides and nothing else is touched. A quote copied out of a
 * claim can pick up a re-wrap or a double space on the way into the record, and refusing that would
 * make this a rule about typography instead of about which claim is wrong. Case, punctuation, word
 * order and every character that carries meaning still have to match exactly — they are what makes a
 * quote identify a fragment at all.
 */
const flatten = (s) => s.replace(/\s+/g, ' ').trim();
export function quotesFragment(text, quote) {
  if (typeof text !== 'string' || typeof quote !== 'string') return false;
  const needle = flatten(quote);
  return needle !== '' && flatten(text).includes(needle);
}


// ─── the validator ───────────────────────────────────────────────────────────────────────────────

/**
 * validate(map, opts?) -> { ok, errors, warnings, containmentChecked }
 *
 * `opts.repoRoot` (SPEC DEFECT 1): the plan's `validate(map)` had no root, yet rule 5b requires
 * realpath containment beneath one. Falling back to process.cwd() would silently check the wrong
 * tree, so the root is an EXPLICIT option. When it is absent the filesystem containment check is
 * SKIPPED — never faked — and the skip is surfaced to the caller in `warnings` and in
 * `containmentChecked: false`. Syntactic path rules need no filesystem and always run.
 * Callers that write artifacts (render.mjs) must pass a repoRoot and treat a skip as fatal.
 */
export function validate(map, opts = {}) {
  const errors = [];
  const warnings = [];
  const repoRoot = nonEmptyString(opts?.repoRoot) ? opts.repoRoot : null;
  const containmentChecked = repoRoot !== null;
  if (!containmentChecked) {
    warnings.push(
      'containment: SKIPPED — no opts.repoRoot was supplied, so path containment (realpath '
      + 'resolution beneath the repo root) was NOT verified. Syntactic path rules still applied. '
      + 'Pass opts.repoRoot before writing any artifact.',
    );
  }
  // ONE ingest, first: every representability rule — accessors, hidden and inherited fields, exotics,
  // holes, cycles, non-JSON values — is the boundary's, stated once there and reported here in the
  // boundary's own words. What follows validates the SNAPSHOT, so every rule below is about what the
  // file will say rather than about what this particular object happens to answer.
  const ingested = ingest(map);
  errors.push(...ingested.errors);
  if (ingested.value !== ABSENT) {
    try {
      runChecks(ingested.value, {
        errors, repoRoot, sources: new Map(), pathsJudged: new Set(),
      });
    } catch (e) {
      // validate() never throws: an unexpected shape becomes a finding, not a stack trace.
      errors.push(`internal: validation aborted on malformed input (${e?.message ?? String(e)})`);
    }
  }
  // One fault, one message. The document-wide drift walk and a schema check can reach one property,
  // and every message names its own path — so a byte-identical message is the SAME defect reported
  // twice, and keeping both would make a reader (or a count) see two faults where there is one.
  const unique = [...new Set(errors)];
  return { ok: unique.length === 0, errors: unique, warnings, containmentChecked };
}

function runChecks(map, ctx) {
  const err = (m) => ctx.errors.push(m);
  if (!isObj(map)) {
    err(`map: must be an object (got ${show(map)})`);
    return;
  }

  checkTopLevel(map, ctx, err);
  checkNoEmbeddedDrift(map, err);
  checkSources(map, ctx, err);
  checkCoverage(map, ctx, err);
  const nodeIds = checkNodes(map, ctx, err);
  const edges = checkEdges(map, ctx, err, nodeIds);
  checkViews(map, ctx, err, nodeIds, edges);
  // LAST, deliberately: it skips the locations the path rules have already spoken about, so it can
  // only run once those have run. See `checkNoControlCharacters`.
  checkNoControlCharacters(map, ctx, err);
}

function checkPath(where, p, ctx, err) {
  // Every path this validator judges, by LOCATION — so the document-wide control-character walk can
  // stay silent here and one fault keeps one message (ADR C-023).
  ctx.pathsJudged.add(where);
  const syntax = pathSyntaxError(p);
  if (syntax) {
    err(`${where}: ${syntax} (got ${show(p)})`);
    return false;
  }
  if (ctx.repoRoot) {
    const containment = containmentError(ctx.repoRoot, p);
    if (containment) {
      err(`${where}: ${containment}`);
      return false;
    }
  }
  return true;
}

function checkTopLevel(map, ctx, err) {
  if (map.schemaVersion !== '1') err(`schemaVersion: must be the string "1" (got ${show(map.schemaVersion)})`);
  if (!nonEmptyString(map.extractorVersion)) err('extractorVersion: must be a non-empty string');

  if (!isObj(map.subject)) {
    err('subject: must be an object with slug, kind, root, title, summary');
    return;
  }
  for (const field of ['slug', 'root', 'title', 'summary']) {
    if (!nonEmptyString(map.subject[field])) err(`subject.${field}: must be a non-empty string`);
  }
  if (!SUBJECT_KINDS.includes(map.subject.kind)) {
    err(`subject.kind: must be one of ${oneOf(SUBJECT_KINDS)} (got ${show(map.subject.kind)})`);
  }
  // `.` is the legitimate root of a whole-repo subject; every other root follows the path rules.
  if (nonEmptyString(map.subject.root) && map.subject.root !== '.') {
    checkPath('subject.root', map.subject.root, ctx, err);
  }
}

function checkSources(map, ctx, err) {
  if (!Array.isArray(map.sources)) {
    err('sources: must be an array — an absent collection is a violation, not an empty default');
    return;
  }
  if (map.sources.length === 0) err('sources: must declare at least one source file');
  map.sources.forEach((s, i) => {
    const at = `sources[${i}]`;
    if (!isObj(s)) { err(`${at}: must be an object`); return; }
    if (!nonEmptyString(s.path)) err(`${at}.path: must be a non-empty string`);
    else checkPath(`${at}.path`, s.path, ctx, err);
    if (!SHA256_RE.test(String(s.sha256))) {
      err(`${at}.sha256: must be a full 64-character lowercase hex digest — a truncated prefix is not a proof (ADR C-003)`);
    }
    if (!Number.isInteger(s.lines) || s.lines < 0) err(`${at}.lines: must be a non-negative integer`);
    if (!SOURCE_ROLES.includes(s.role)) err(`${at}.role: must be one of ${oneOf(SOURCE_ROLES)} (got ${show(s.role)})`);
    if (nonEmptyString(s.path)) {
      if (ctx.sources.has(s.path)) err(`${at}.path: duplicate source path ${show(s.path)}`);
      else ctx.sources.set(s.path, s);
    }
  });
}

function checkCoverage(map, ctx, err) {
  if (!isObj(map.coverage)) {
    err('coverage: must be an object carrying read / partial / skipped arrays');
    return;
  }
  // Coverage is a PARTITION: every declared path is classified exactly once. A path in two buckets
  // (or twice in one) is two contradictory coverage claims about the same file, and any consumer
  // that counts or renders coverage double-counts it. Checking only partial/skipped against read
  // would let `partial` + `skipped`, or a bucket-internal duplicate, through.
  const classifiedIn = new Map(); // path -> the bucket that already claimed it
  const classify = (at, p, bucket) => {
    if (classifiedIn.has(p)) {
      err(`${at}: ${show(p)} is already declared in coverage.${classifiedIn.get(p)} — every path is classified exactly once`);
      return;
    }
    classifiedIn.set(p, bucket);
  };

  if (!Array.isArray(map.coverage.read)) {
    err('coverage.read: must be an array — an absent collection is a violation, not an empty default');
  } else {
    map.coverage.read.forEach((p, i) => {
      const at = `coverage.read[${i}]`;
      if (!nonEmptyString(p)) { err(`${at}: must be a non-empty string`); return; }
      checkPath(at, p, ctx, err);
      classify(at, p, 'read');
      // A fully read input that is not hashed cannot be freshness-checked, so a changed input
      // would still report fresh.
      if (!ctx.sources.has(p)) {
        err(`${at}: ${show(p)} is declared fully read but has no sources[] entry — a read input must be hashed`);
      }
    });
  }
  for (const key of ['partial', 'skipped']) {
    const arr = map.coverage[key];
    if (!Array.isArray(arr)) {
      err(`coverage.${key}: must be an array — an absent collection is a violation, not an empty default`);
      continue;
    }
    arr.forEach((entry, i) => {
      const at = `coverage.${key}[${i}]`;
      if (!isObj(entry)) { err(`${at}: must be an object { path, why }`); return; }
      if (!nonEmptyString(entry.path)) err(`${at}.path: must be a non-empty string`);
      else {
        checkPath(`${at}.path`, entry.path, ctx, err);
        classify(`${at}.path`, entry.path, key);
      }
      // Coverage is declared, never silently truncated (PDR §8.1 guardrail 4).
      if (!nonEmptyString(entry.why)) err(`${at}.why: must state why this file was only ${key}`);
    });
  }

  // The partition runs in BOTH directions. `coverage.read ⊆ sources[]` alone is only half of it:
  // the other half — every declared source is classified — is what makes coverage a partition OF
  // the sources rather than an arbitrary list beside them. Without it a map can hash two files,
  // cite them throughout, and classify neither: the rendered coverage section is empty while the
  // map claims full provenance, which is precisely the silent truncation PDR §8.1 guardrail 4
  // forbids. Skipped when a bucket is not an array — that is already reported above, and every
  // source would then read as unclassified, burying the real fault under one error per source.
  const bucketsWellFormed = ['read', 'partial', 'skipped'].every((k) => Array.isArray(map.coverage[k]));
  // Published to the rest of the pass, because coverage is not only a section of the report: it is the
  // map's own statement of WHICH files it actually read, and `checkDocHarvest` has to hold a harvest to
  // it. Held as the classification itself rather than as a set of read paths, so the harvest rule can
  // name the bucket that contradicts it. `wellFormed` travels with it so a downstream rule can stay
  // silent when the partition is already broken — one fault, one message.
  ctx.coverageBucketOf = classifiedIn;
  ctx.coverageWellFormed = bucketsWellFormed;
  if (bucketsWellFormed) {
    for (const declared of ctx.sources.keys()) {
      if (!classifiedIn.has(declared)) {
        err(`coverage: ${show(declared)} is declared in sources[] but appears in NO coverage bucket — every declared source is classified exactly once across read / partial / skipped`);
      }
    }
  }
}

/**
 * ONE LOCATION FOR ONE STRING — the notation both whole-document walks compose their child locations
 * in, and the reason it is a fold rather than a concatenation.
 *
 * `.`, `[` and `]` are this notation's own metacharacters, and an object key may legally carry all
 * three. Concatenating a raw key therefore lets one key SPELL a location that belongs to something
 * else: a `coverage` key named `read[0]` composes `coverage.read[0]`, which is where the FIRST ENTRY of
 * `coverage.read` lives. That is not cosmetic. `checkNoControlCharacters` stays silent on the locations
 * `checkPath` has already judged, and it is keyed by location — so a forged location borrowed the
 * silence a real path was judged with and an invisible byte rode into the file unreported. Reproduced
 * three ways on `tiny.map.json` (`coverage.read[0]`, a node's `docHarvest.searched[0]`, and a top-level
 * `sources[0]`), each validating with ZERO errors while carrying a NUL.
 *
 * A key carrying a metacharacter is therefore written in BRACKETED, JSON-QUOTED form, which nothing
 * else here can spell: every location `checkPath` records is hand-built from plain field names and
 * integer indices, so none of them contains a `["`. A key without a metacharacter is composed exactly
 * as before, so no message a legitimate map can produce changes.
 */
const atProperty = (at, key) => (/[.[\]]/.test(key)
  ? `${at === '' ? 'map' : at}[${JSON.stringify(key)}]`
  : (at === '' ? key : `${at}.${key}`));

/**
 * The one WHOLE-DOCUMENT schema invariant — ADR C-004.
 *
 * `drift.json` is the ONE drift representation; `map.json` holds extraction only. The ban is checked
 * on the KEY NAME at every depth rather than at a single location: a top-level `map.drift`, a
 * `subject.drift`, an `edges[].drift`, a `views[].drift` or a verdict nested deeper inside
 * `nodes[].attrs` all serialize into map.json just as readily as `nodes[].attrs.drift`, and each
 * recreates the second, disagreeing drift record C-004 exists to prevent — while perturbing the
 * structural diff every time a doc edit changes the finding. The IR defines no legitimate `drift` key
 * at any location, so the whole-document rule costs nothing and closes every path.
 *
 * SERIALIZABILITY used to be the other half of this traversal — cycles, holes, hidden keys, exotics.
 * It is not here any more because it is not a schema rule at all: it is the question of whether the
 * value can be WRITTEN, which `canonical.mjs` answers once, for the validator and every consumer
 * together. This walk therefore runs on the snapshot, where a plain `Object.keys` read is exactly the
 * set of keys the file will carry, and where no cycle can survive to be walked into.
 */
function checkNoEmbeddedDrift(map, err) {
  const walk = (value, at) => {
    if (value === null || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach((item, i) => walk(item, `${at}[${i}]`));
      return;
    }
    for (const key of Object.keys(value)) {
      const where = atProperty(at, key);
      if (key === 'drift') {
        err(`${where}: a drift verdict is DERIVED into drift.json and must not be embedded in map.json (ADR C-004)`);
        continue;
      }
      walk(value[key], where);
    }
  };
  walk(map, '');
}

/**
 * The second WHOLE-DOCUMENT invariant — no invisible control character, anywhere (ADR C-023).
 *
 * WHOLE-DOCUMENT for the same reason `checkNoEmbeddedDrift` is: a rule enforced at a list of known
 * fields is a rule that misses the next field somebody adds. The proven defect was in a node LABEL, but
 * a label is only where it was FOUND — the identical laundering is available in `claim.text`, in an
 * `evidence.note`, in a `statement`, in a view title, in an `attrs` value nested four deep, and in an
 * `attrs` KEY. Refusing one byte in one field is a rule that gets re-found; this closes the class.
 *
 * KEYS as well as values, because a key is as much a string in the file as a value is, and `attrs` is
 * the IR's one free-form region — the place an invisible byte has the most room to hide.
 *
 * PATHS ARE JUDGED ELSEWHERE AND SKIPPED HERE, so one fault gets one message. `pathSyntaxError` refuses
 * every control character in a path INCLUDING the three this rule allows — a repo-relative path is
 * consumed by line-oriented tools, so a tab or newline in one is not a re-wrap but a second path — and
 * `ctx.pathsJudged` carries the exact locations it already spoke about. Keyed by LOCATION rather than by
 * value, so a path string that also appears as prose is still judged in the prose position.
 *
 * Runs LAST in `runChecks` for that reason: it can only skip what has already been judged.
 */
function checkNoControlCharacters(map, ctx, err) {
  const judged = ctx.pathsJudged ?? new Set();
  const walk = (value, at) => {
    if (typeof value === 'string') {
      if (judged.has(at)) return;
      const found = firstRefusedControl(value);
      if (found) err(`${at}: ${carriesControl(found)} — ${CONTROL_WHY}`);
      return;
    }
    if (value === null || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach((item, i) => walk(item, `${at}[${i}]`));
      return;
    }
    for (const key of Object.keys(value)) {
      const where = atProperty(at, key);
      const inKey = firstRefusedControl(key);
      if (inKey) {
        err(
          `${at === '' ? 'map' : at}: the object KEY ${show(key)} ${carriesControl(inKey)} `
          + `— ${CONTROL_WHY}`,
        );
      }
      walk(value[key], where);
    }
  };
  walk(map, '');
}

/**
 * One citation checker for all four sites (node evidence, node claims, contradiction citations,
 * edge evidence), so they cannot drift apart.
 * `role: 'code'` is required for EVIDENCE — documentation is not behavioural evidence.
 */
function checkCitation(at, cit, ctx, err, { requireCodeRole = false } = {}) {
  if (!isObj(cit)) { err(`${at}: must be an object { path, line }`); return; }
  if (!Number.isInteger(cit.line) || cit.line < 1) {
    err(`${at}.line: must be an integer >= 1 (got ${show(cit.line)})`);
  }
  if (!nonEmptyString(cit.path)) { err(`${at}.path: must be a non-empty string`); return; }
  if (!checkPath(`${at}.path`, cit.path, ctx, err)) return;
  const source = ctx.sources.get(cit.path);
  if (!source) {
    err(`${at}.path: ${show(cit.path)} is not declared in sources[] — every citation must resolve to a hashed source`);
    return;
  }
  if (Number.isInteger(cit.line) && cit.line >= 1 && Number.isInteger(source.lines) && cit.line > source.lines) {
    err(`${at}.line: ${cit.line} exceeds ${cit.path}'s ${source.lines} lines`);
  }
  if (requireCodeRole && source.role !== 'code') {
    err(`${at}: evidence must cite a source with role "code" (${show(cit.path)} has role ${show(source.role)}) — documentation is not behavioural evidence`);
  }
  if ('note' in cit && cit.note !== undefined && typeof cit.note !== 'string') {
    err(`${at}.note: if present must be a string`);
  }
}

function checkClaim(at, claim, ctx, err) {
  checkCitation(at, claim, ctx, err);
  if (!isObj(claim)) return;
  if (!nonEmptyString(claim.text)) err(`${at}.text: must be a non-empty string`);
  if ('checked' in claim && typeof claim.checked !== 'boolean') err(`${at}.checked: if present must be a boolean`);

  // SPEC DEFECT 2 — claimKind is REQUIRED, not merely validated-if-present. A missing value must
  // never default to "doc": that would let any claim pose as documentation and bypass ADR C-014.
  if (claim.claimKind === undefined || claim.claimKind === null) {
    err(`${at}.claimKind: is REQUIRED on every claim — there is no default (a missing value defaulting to "doc" would bypass ADR C-014)`);
    return;
  }
  if (!CLAIM_KINDS.includes(claim.claimKind)) {
    err(`${at}.claimKind: must be one of ${oneOf(CLAIM_KINDS)} (got ${show(claim.claimKind)})`);
    return;
  }
  const source = ctx.sources.get(claim.path);
  const wanted = CLAIM_KIND_ROLE[claim.claimKind];
  if (source && source.role !== wanted) {
    err(`${at}: a ${show(claim.claimKind)} claim must cite a source with role ${show(wanted)} (${show(claim.path)} has role ${show(source.role)}) — ADR C-014`);
  }
}

function checkNodes(map, ctx, err) {
  const nodeIds = new Map(); // id -> label, for duplicate vs collision reporting
  if (!Array.isArray(map.nodes)) {
    err('nodes: must be an array — an absent collection is a violation, not an empty default');
    return nodeIds;
  }
  if (map.nodes.length === 0) err('nodes: must declare at least one node');

  map.nodes.forEach((n, i) => {
    const at = `nodes[${i}]`;
    if (!isObj(n)) { err(`${at}: must be an object`); return; }

    const label = nonEmptyString(n.label) ? n.label : null;
    if (!label) err(`${at}.label: must be a non-empty string`);
    if (!NODE_KINDS.includes(n.kind)) err(`${at}.kind: must be one of ${oneOf(NODE_KINDS)} (got ${show(n.kind)})`);
    if (!LANES.includes(n.lane)) err(`${at}.lane: must be one of ${oneOf(LANES)} (got ${show(n.lane)})`);
    if (!nonEmptyString(n.summary)) err(`${at}.summary: must be a non-empty string`);
    if (typeof n.inferred !== 'boolean') err(`${at}.inferred: must be a boolean`);

    if (!nonEmptyString(n.id)) {
      err(`${at}.id: must be a non-empty string`);
    } else {
      if (label && NODE_KINDS.includes(n.kind)) {
        const want = deriveNodeId(n.kind, label);
        if (n.id !== want) {
          err(`${at}.id: must be "<kind>.<slugify(label)>" = ${show(want)} (got ${show(n.id)})`);
        }
      }
      if (nodeIds.has(n.id)) {
        const previous = nodeIds.get(n.id);
        if (previous !== label) {
          err(`${at}.id: COLLISION — labels ${show(previous)} and ${show(label)} both derive node id ${show(n.id)}; one capability would vanish from the map`);
        } else {
          err(`${at}.id: duplicate node id ${show(n.id)}`);
        }
      } else {
        nodeIds.set(n.id, label);
      }
    }

    if (!Array.isArray(n.evidence)) err(`${at}.evidence: must be an array`);
    else n.evidence.forEach((e, j) => checkCitation(`${at}.evidence[${j}]`, e, ctx, err, { requireCodeRole: true }));

    if (!Array.isArray(n.claims)) err(`${at}.claims: must be an array`);
    else n.claims.forEach((c, j) => checkClaim(`${at}.claims[${j}]`, c, ctx, err));

    if (n.contradictions !== undefined) checkContradictions(at, n, ctx, err);
    if (n.docHarvest !== undefined) checkDocHarvest(at, n, ctx, err);

    // An uncited node asserting it is NOT inferred is the "confident wrong map" risk (PDR §14).
    if (n.inferred === false) {
      const cited = (Array.isArray(n.evidence) ? n.evidence.length : 0) + (Array.isArray(n.claims) ? n.claims.length : 0);
      if (cited === 0) err(`${at}: an inferred:false node is UNCITED — it must carry at least one evidence or claims citation`);
    }
    // `attrs` is the IR's one free-form region. What may sit INSIDE it is settled before this file
    // runs: the ingest boundary accepts only JSON data — null, booleans, finite numbers, strings,
    // arrays and plain objects, recursively — and reports a `Map`, a `Date`, a cycle, a hole, a
    // hidden key or an accessor in its own words, at every depth and everywhere in the document, not
    // only here. An embedded drift verdict is rejected document-wide by `checkNoEmbeddedDrift`
    // (ADR C-004).
    //
    // What remains is the ROOT SHAPE, which is narrower than the contents (PDR §7.1) and is a schema
    // rule rather than a representability one: absent, `null`, or a plain object. `attrs` is a bag of
    // NAMED attributes — the PDR §7 example is `{ "default": null }` — so a scalar or array root
    // carries no attribute name for any consumer to render, diff or cite. `null` stays legal because
    // it says "no attributes" IN THE FILE: the serializer writes it unchanged.
    if ('attrs' in n) {
      const got = Array.isArray(n.attrs) ? 'array' : typeName(n.attrs);
      if (n.attrs !== null && !isPlainObj(n.attrs)) {
        err(`${at}.attrs: if present must be null or a plain object (got ${got}) — attrs is a bag of NAMED attributes, and a ${got} root carries no name for any consumer to render or diff`);
      }
    }
  });
  return nodeIds;
}

/**
 * ADR decision F — the documentation-harvest ATTESTATION.
 *
 * ATTESTATION, not certificate (ADR C-018 amendment, owner, 2026-08-14). Every rule below compares
 * one thing the extractor wrote against another thing the extractor wrote. NOTHING HERE OPENS A
 * FILE, so what a passing record buys is that it is INTERNALLY CONSISTENT — and the claim that the
 * declared surfaces were actually searched, or that the declaration was complete, remains the
 * extractor's alone.
 *
 * `docHarvest` is OPTIONAL in the schema and load-bearing in the drift engine: a node that carries one
 * can be accused of being UNDOCUMENTED, and a node that does not, cannot. That asymmetry is why the
 * shape is checked here rather than trusted. What the record must make auditable is exactly two
 * things — WHERE the harvest looked, and WHAT it found there — because UNDOCUMENTED is the one class
 * derived from an ABSENCE, and an absence is only evidence if the search that failed to find it was
 * complete.
 *
 * There is deliberately NO completeness field: see `DOC_HARVEST_FORBIDDEN_KEYS`. `diff.mjs` derives
 * completeness by comparing `searched` against this map's own `role: "doc"` sources, so the extractor
 * states what it did and the pipeline decides what that earns.
 */
function checkDocHarvest(at, node, ctx, err) {
  const rat = `${at}.docHarvest`;
  const record = node.docHarvest;
  if (!isObj(record)) {
    err(`${rat}: if present must be an object { searched, candidates } (got ${Array.isArray(record) ? 'array' : show(record)})`);
    return;
  }
  for (const key of DOC_HARVEST_FORBIDDEN_KEYS) {
    if (key in record) {
      err(
        `${rat}.${key}: a harvest may not declare its own completeness — that is DERIVED by comparing `
        + `${rat}.searched against the map's declared role:"doc" sources (ADR decision F). Remove the `
        + 'key and record what was actually searched.',
      );
    }
  }

  // WHERE it looked. Every entry must be a documentation surface THIS map declares, hashes, AND says
  // it read in full, so "complete" is checkable against the map rather than against the extractor's
  // memory — against all three of the map's own statements about that file, not one of them.
  const searched = new Set();
  if (!Array.isArray(record.searched)) {
    err(`${rat}.searched: must be an array of declared role:"doc" source paths (possibly empty, never absent)`);
  } else {
    record.searched.forEach((p, i) => {
      const sat = `${rat}.searched[${i}]`;
      if (!nonEmptyString(p)) { err(`${sat}: must be a non-empty string`); return; }
      if (!checkPath(sat, p, ctx, err)) return;
      const source = ctx.sources.get(p);
      if (!source) {
        err(`${sat}: ${show(p)} is not declared in sources[] — a harvest may only name a documentation surface this map declares and hashes, or "complete" would mean nothing`);
        return;
      }
      if (source.role !== 'doc') {
        err(`${sat}: ${show(p)} has role ${show(source.role)}, not "doc" — searching code proves nothing about the documentation (ADR C-014)`);
        return;
      }
      // …and the map's OWN coverage statement has to agree that the file was read.
      //
      // `sources[]` + `role: "doc"` says the surface EXISTS and is hashed; it says nothing about
      // whether this run opened it. `coverage` is where the map states that, and the two rules were
      // never bound: a map could classify a documentation file as `skipped` — "not read, and here is
      // why" — and, on the very same map, list it among the surfaces a node's harvest SEARCHED. The
      // harvest gate then read that node as harvest-complete and let it accuse, on the strength of a
      // search of a file the map itself says was never read. `partial` fails for the same reason with
      // one more step: a harvest is a claim about an ABSENCE, and an absence found in half a file is
      // not evidence (ADR C-018, PDR §8.1 guardrail 4).
      //
      // Silent when the buckets are malformed: that is already reported above, and every searched
      // surface would then look unclassified — one fault, one message.
      if (ctx.coverageWellFormed) {
        const bucket = ctx.coverageBucketOf?.get(p);
        // An UNCLASSIFIED declared source is `checkCoverage`'s own error, reported there.
        if (bucket !== undefined && bucket !== 'read') {
          err(
            `${sat}: ${show(p)} is classified in coverage.${bucket}, so this map states it was `
            + `${bucket === 'skipped' ? 'never read' : 'only partially read'} — a harvest may not report `
            + 'having searched a documentation surface the map says it did not read in full, because '
            + 'an absence is evidence only if the search that failed to find it was complete '
            + '(ADR C-018). Read the file and classify it in coverage.read, or drop it from '
            + `${rat}.searched.`,
          );
          return;
        }
      }
      if (searched.has(p)) { err(`${sat}: duplicate searched surface ${show(p)}`); return; }
      searched.add(p);
    });
  }

  // WHAT it found. A candidate with no disposition is the naive implementation this decision exists
  // to prevent, so the disposition is required and closed.
  if (!Array.isArray(record.candidates)) {
    err(`${rat}.candidates: must be an array of { path, line, quote, disposition } (possibly empty, never absent)`);
    return;
  }
  const docClaims = (Array.isArray(node.claims) ? node.claims : [])
    .filter((c) => isObj(c) && c.claimKind === 'doc');

  record.candidates.forEach((c, i) => {
    const cat = `${rat}.candidates[${i}]`;
    if (!isObj(c)) { err(`${cat}: must be an object { path, line, quote, disposition }`); return; }
    checkCitation(cat, c, ctx, err);
    if (!nonEmptyString(c.quote)) {
      err(`${cat}.quote: must quote the text the harvest actually found at that line — a candidate a reader cannot read is not reviewable`);
    }
    if (!DOC_HARVEST_DISPOSITIONS.includes(c.disposition)) {
      err(
        `${cat}.disposition: must be one of ${oneOf(DOC_HARVEST_DISPOSITIONS)} (got ${show(c.disposition)}) `
        + '— a harvest hit is a CANDIDATE, and the extractor must say whether the text ASSERTS the '
        + "node's behaviour or merely MENTIONS it",
      );
      return;
    }
    if (nonEmptyString(c.path) && !searched.has(c.path)) {
      err(`${cat}.path: ${show(c.path)} is not among ${rat}.searched — a candidate is something the harvest FOUND, and you cannot find a hit where you did not look`);
    }
    if (c.disposition === 'asserts'
      && !docClaims.some((claim) => claim.path === c.path && claim.line === c.line)) {
      err(
        `${cat}: is dispositioned "asserts" but no claimKind:"doc" claim on this node cites `
        + `${show(c.path)}:${show(c.line)} — an asserting candidate must be PROMOTED to a claim. A `
        + 'disposition never documents a node and never silences UNDOCUMENTED on its own; only a real '
        + 'doc claim does, which is what keeps a synonym or fuzzy match from suppressing a finding '
        + '(ADR decision F).',
      );
    }
  });
}

/**
 * The contradiction record — and the RUN-4 DEFECT it now closes (2026-08-14).
 *
 * The two citations were the whole contract: `claim` had to be one of this node's own claims and
 * `evidence` one of its own evidence records, each carrying its quote. Nothing said WHICH claim, and
 * "some claim on this node" is not the same rule as "the claim that is wrong".
 *
 * Run 4 wrote a STALE record on `mode.prepr` that was SUBSTANTIVELY CORRECT — the over-budget message
 * at `codex-gate.sh:519` really does tell the user to run `prepr --since-reviewed`, and
 * `_prepr_common` (`:1412`) really does keep every token but `--multi` as the `<base>` positional, so
 * the flag would be swallowed — and pointed `claim` at `README.md:97`, a line the gate reviewer
 * verified to be ACCURATE. The genuinely stale `user-message` was sitting on the same node, present in
 * `claims[]` and simply not wired as the contradicted side. Every rule above passed, the map was
 * well-formed, and `drift.json` sent a maintainer to "fix" a correct README line while the stale one
 * stayed unaccused.
 *
 * That is a DISTINCT failure from a wrong verdict — right finding, wrong pointer — and it is invisible
 * to a validator that only asks whether the cited claim EXISTS. So the record must now STATE what the
 * evidence refutes, in the claim's own words, and the pointer becomes checkable against the text it
 * names.
 *
 * WHAT IS AND IS NOT ENFORCED HERE. This function cannot judge whether a statement is true, whether
 * the evidence really refutes the quote, or whether the fragment chosen is the meaningful one — and it
 * does not pretend to. What it checks is mechanical and complete on its own terms: the field is
 * present and non-empty; the quote actually occurs in the claim the record cites; and, when it does
 * not, whether it occurs in a DIFFERENT claim on this same node — which is the run-4 shape exactly, and
 * lets the error name the claim that should have been cited instead of leaving the author to re-derive
 * it. Nothing here inspects `statement`: a statement legitimately paraphrases, so requiring the quote
 * to appear in it would refuse honest records without catching a single dishonest one.
 */
function checkContradictions(at, node, ctx, err) {
  if (!Array.isArray(node.contradictions)) { err(`${at}.contradictions: must be an array`); return; }
  node.contradictions.forEach((c, j) => {
    const cat = `${at}.contradictions[${j}]`;
    if (!isObj(c)) { err(`${cat}: must be an object { claim, evidence, refutedQuote, statement }`); return; }

    // ADR C-005: a STALE finding shows BOTH citations or it is a schema violation.
    if (!isObj(c.claim)) {
      err(`${cat}.claim: is required — a STALE finding must carry both citations (ADR C-005)`);
    } else {
      checkCitation(`${cat}.claim`, c.claim, ctx, err);
      // A bare {path,line} names a location without ever stating WHAT was asserted, so the reader
      // cannot audit the finding — PDR §8 writes the claim as {path,line,text} for that reason.
      if (!nonEmptyString(c.claim.text)) {
        err(`${cat}.claim.text: must quote the asserted behaviour — a STALE record citing only {path,line} is not auditable (PDR §8)`);
      }
      // SPEC DEFECT 8: the citation must be one of THIS node's own records.
      if (Array.isArray(node.claims) && !node.claims.some((claim) => isSubsetOf(c.claim, claim))) {
        err(`${cat}.claim: does not match any of this node's own claims[] — a contradiction assembled from unrelated citations is unauditable`);
      }
    }
    if (!isObj(c.evidence)) {
      err(`${cat}.evidence: is required — a STALE finding must carry both citations (ADR C-005)`);
    } else {
      checkCitation(`${cat}.evidence`, c.evidence, ctx, err, { requireCodeRole: true });
      // …and the same for the observed side: `note` is what was actually seen at that line.
      if (!nonEmptyString(c.evidence.note)) {
        err(`${cat}.evidence.note: must quote the observed behaviour — a STALE record citing only {path,line} is not auditable (PDR §8)`);
      }
      if (Array.isArray(node.evidence) && !node.evidence.some((e) => isSubsetOf(c.evidence, e))) {
        err(`${cat}.evidence: does not match any of this node's own evidence[] — a contradiction assembled from unrelated citations is unauditable`);
      }
    }
    checkRefutedQuote(cat, c, node, err);
    if (!nonEmptyString(c.statement)) err(`${cat}.statement: must be a non-empty statement of the conflict`);
  });
}

/**
 * WHICH claim the evidence refutes — the pointer check (see `checkContradictions`'s note).
 *
 * `claim` is the REFUTED side and `evidence` the REFUTING side; those are roles now, not merely two
 * locations. `refutedQuote` is what makes the first role checkable: the exact fragment of
 * `claim.text` whose asserted value the evidence contradicts.
 */
function checkRefutedQuote(cat, c, node, err) {
  if (!nonEmptyString(c.refutedQuote)) {
    err(
      `${cat}.refutedQuote: is REQUIRED and must be a non-empty string quoting the exact fragment of `
      + `${cat}.claim.text whose asserted value ${cat}.evidence refutes (got ${show(c.refutedQuote)}). `
      + 'Without it nothing can check that this record points at the claim that is WRONG rather than '
      + 'at a neighbouring claim on the same node that is right — and a finding that cites an accurate '
      + 'line sends a reader to change text that needs no changing.',
    );
    return;
  }
  // The claim's own text is checked above; without it there is nothing to test the quote against, and
  // reporting the same fault twice would make one defect read as two.
  if (!isObj(c.claim) || !nonEmptyString(c.claim.text)) return;
  if (quotesFragment(c.claim.text, c.refutedQuote)) return;

  // The run-4 shape, named: the refuted text really is on this node — just not in the claim the
  // record cites. Point at where it sits, so the fix is mechanical rather than another re-reading.
  const elsewhere = (Array.isArray(node.claims) ? node.claims : [])
    .filter((claim) => isObj(claim) && quotesFragment(claim.text, c.refutedQuote))
    .map((claim) => `${claim.path}:${claim.line}`);
  err(
    `${cat}.refutedQuote: ${show(c.refutedQuote)} does not appear in ${cat}.claim.text `
    + `(${show(c.claim.text)}) — a contradiction must cite the claim whose text is refuted`
    + (elsewhere.length > 0
      ? `. That text IS on this node, in the claim at ${elsewhere.join(', ')} — cite THAT claim, or the `
        + 'report accuses an accurate line while the stale one stays unaccused.'
      : ', so either the quote or the citation is wrong.'),
  );
}

function checkEdges(map, ctx, err, nodeIds) {
  const byId = new Map();
  if (!Array.isArray(map.edges)) {
    err('edges: must be an array — an absent collection is a violation, not an empty default');
    return byId;
  }
  map.edges.forEach((e, i) => {
    const at = `edges[${i}]`;
    if (!isObj(e)) { err(`${at}: must be an object`); return; }

    for (const field of ['from', 'to']) {
      if (!nonEmptyString(e[field])) err(`${at}.${field}: must be a non-empty node id`);
      // Endpoints are node ids GLOBALLY, not merely when some view references the edge.
      else if (!nodeIds.has(e[field])) err(`${at}.${field}: ${show(e[field])} is not a node id`);
    }
    if (!EDGE_KINDS.includes(e.kind)) err(`${at}.kind: must be one of ${oneOf(EDGE_KINDS)} (got ${show(e.kind)})`);
    // An unlabelled arrow only ever means "related somehow".
    if (!nonEmptyString(e.label)) err(`${at}.label: must be a non-empty string`);

    if (!nonEmptyString(e.id)) {
      err(`${at}.id: must be a non-empty string`);
    } else {
      if (nonEmptyString(e.from) && nonEmptyString(e.to) && EDGE_KINDS.includes(e.kind)) {
        const want = deriveEdgeId(e.from, e.to, e.kind);
        if (e.id !== want) {
          err(`${at}.id: must be "e.<kind>.<from>><to>" = ${show(want)} (got ${show(e.id)}) — the kind is part of the id so parallel typed edges between the same pair cannot collide`);
        }
      }
      if (byId.has(e.id)) err(`${at}.id: duplicate edge id ${show(e.id)}`);
      else byId.set(e.id, e);
    }

    if (!Array.isArray(e.evidence) || e.evidence.length === 0) {
      err(`${at}.evidence: must carry at least one citation`);
    } else {
      e.evidence.forEach((c, j) => checkCitation(`${at}.evidence[${j}]`, c, ctx, err, { requireCodeRole: true }));
    }
  });
  return byId;
}

function checkViews(map, ctx, err, nodeIds, edges) {
  if (!Array.isArray(map.views)) {
    err('views: must be an array — an absent collection is a violation, not an empty default');
    return;
  }
  if (map.views.length === 0) err('views: must not be empty — a map that renders no picture is not a map');

  const seen = new Set();
  map.views.forEach((v, i) => {
    const at = `views[${i}]`;
    if (!isObj(v)) { err(`${at}: must be an object`); return; }

    if (!nonEmptyString(v.id)) {
      err(`${at}.id: must be a non-empty string`);
    } else if (seen.has(v.id)) {
      // serialization sorts views by id, so duplicates make the bytes unstable
      err(`${at}.id: duplicate view id ${show(v.id)}`);
    } else {
      seen.add(v.id);
    }
    if (!nonEmptyString(v.title)) err(`${at}.title: must be a non-empty string`);
    if (!VIEW_FORMS.includes(v.form)) err(`${at}.form: must be one of ${oneOf(VIEW_FORMS)} (got ${show(v.form)})`);

    // A view's reference lists are SETS drawn once each, not bags. One id listed twice is one box or
    // one arrow drawn twice, and the renderers do not even agree on what that means: `layoutHero`
    // refuses the duplicate box, mermaid quietly emits the declaration a second time. ADR C-006 makes
    // this file the single executable IR contract, so the rule lives here rather than only at the
    // render boundary — a map this validator calls legal must be one every renderer can draw.
    const drawn = new Set();
    if (!Array.isArray(v.nodes)) {
      err(`${at}.nodes: must be an array (possibly empty for a table view, never absent)`);
    } else {
      v.nodes.forEach((id, j) => {
        if (!nodeIds.has(id)) err(`${at}.nodes[${j}]: unknown node id ${show(id)}`);
        else if (drawn.has(id)) err(`${at}.nodes[${j}]: duplicate node reference ${show(id)} — the view already draws it, and one box drawn twice has no defined order`);
        else drawn.add(id);
      });
    }

    // ADR C-002 caps the hero at 15 nodes and `layoutHero` fails closed above it. The rule is a rule
    // about IR SHAPE that the render boundary enforces, so by PDR §7.1 rule 14 it is enforced HERE:
    // leaving it to the renderer alone is what let a 16-node overview validate clean and then throw
    // at render time — the same validator/renderer asymmetry that produced a finding in each of the
    // first three phases. Counted on the REFERENCE LIST, before de-duplication, because that is the
    // list `layoutHero` is handed.
    if (v.form === 'svg-hero' && Array.isArray(v.nodes) && v.nodes.length > HERO_MAX_NODES) {
      err(
        `${at}.nodes: an "svg-hero" view may reference at most ${HERO_MAX_NODES} nodes (ADR C-002) — `
        + `got ${v.nodes.length}. Collapse the overview to component-level nodes; the detailed nodes `
        + 'stay available in the mermaid views, which have no such bound.',
      );
    }

    // The PRESENCE of an `edges` array is a graph-view requirement; what the array MEANS is not.
    // Rule 14 states the set semantics for "a `table` view as much as a graph one", and the render
    // boundary already reads it that way — `resolveView` runs `pick()` and the dangling check for
    // every form, only the required-ness of the array varies. Running the whole block inside
    // `if (isGraph)` therefore left a table view carrying one edge id twice — or an unresolvable
    // one, or one whose endpoint the view never lists — legal to the validator and refused by the
    // renderer: the same asymmetry, one form over.
    const isGraph = v.form === 'svg-hero' || v.form === 'mermaid';

    // PRESENT means "in the file". The snapshot settles that before this line: an INHERITED `edges`
    // has no own descriptor and is simply not carried, so it is absent to this validator exactly as
    // it is to every renderer — while an own `edges: undefined` is refused at the boundary, because
    // JSON.stringify drops the key and a map that validated would differ from the map that is
    // written. So `hasOwn` here reads the same list `resolveView` will.
    const edgeRefs = Object.hasOwn(v, 'edges') ? v.edges : undefined;
    if (edgeRefs === undefined) {
      if (isGraph) err(`${at}.edges: a graph view requires an edges array (possibly empty, never absent)`);
    } else if (!Array.isArray(edgeRefs)) {
      // ABSENT and PRESENT-BUT-NOT-A-LIST are different acts, and only the first is a table view's
      // privilege. `!Array.isArray(v.edges)` conflated them: with the whole branch reporting only
      // `if (isGraph)`, a table view carrying `edges: null` was legal to this validator while
      // `resolveView` — which asks every form for an array once the key is there — refused to draw
      // it. That is rule 14's asymmetry in the SHAPE of the key rather than in what it names.
      err(
        `${at}.edges: if present must be an array (got ${show(edgeRefs)}) — a "table" view may omit `
        + 'edges entirely, but a key that IS there is an edges list, and every view form reads it by '
        + 'the same rules',
      );
    } else {
      const linked = new Set();
      edgeRefs.forEach((id, j) => {
        const edge = edges.get(id);
        if (!edge) { err(`${at}.edges[${j}]: unknown edge id ${show(id)}`); return; }
        if (linked.has(id)) { err(`${at}.edges[${j}]: duplicate edge reference ${show(id)} — the view already draws it, and one arrow drawn twice says nothing the first did not`); return; }
        linked.add(id);
        for (const end of ['from', 'to']) {
          if (!drawn.has(edge[end])) {
            err(`${at}.edges[${j}]: dangling — the view draws edge ${show(id)} but not its ${end} endpoint ${show(edge[end])}`);
          }
        }
      });
    }

    if (v.form === 'table') {
      if (!Array.isArray(v.columns) || v.columns.length === 0) err(`${at}.columns: a table view must carry a non-empty columns array`);
      else if (!v.columns.every((c) => nonEmptyString(c))) err(`${at}.columns: every column must be a non-empty string`);
      // …and a non-empty string is not yet a COLUMN. Being a string was the only rule until run 3
      // shipped `"What it does"` and every one of its 125 rows rendered `(no value for this
      // column)`: a renderer derives a cell from the node, and it has no derivation for a name it
      // does not know. The refusal names the column AND lists the vocabulary, so an extractor that
      // hits it learns what it may write from the error alone — see `TABLE_COLUMN_KEYS`.
      else {
        v.columns.forEach((c, j) => {
          if (TABLE_COLUMN_KEYS.includes(foldColumnName(c))) return;
          err(
            `${at}.columns[${j}]: ${show(c)} is not a derivable column — no renderer can fill it, so `
            + 'every row would read "(no value for this column)". Legal columns, matched ignoring '
            + `case and punctuation: ${oneOf(TABLE_COLUMN_KEYS)}`,
          );
        });
      }
    } else if ('columns' in v) {
      err(`${at}.columns: only a table view carries columns`);
    }

    if (v.form === 'mermaid') {
      if (!MERMAID_TYPES.includes(v.mermaidType)) err(`${at}.mermaidType: must be one of ${oneOf(MERMAID_TYPES)} (got ${show(v.mermaidType)})`);
    } else if ('mermaidType' in v) {
      err(`${at}.mermaidType: only a mermaid view carries mermaidType`);
    }
  });

  const overview = map.views.filter((v) => isObj(v) && v.id === 'overview');
  if (overview.length === 0) err('views: a view with id "overview" and form "svg-hero" is required (PDR §6.1)');
  else if (!overview.some((v) => v.form === 'svg-hero')) err('views: the "overview" view must have form "svg-hero"');
}
