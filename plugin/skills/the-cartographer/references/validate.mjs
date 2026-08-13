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

// ─── path rules (SPEC DEFECT 6) ──────────────────────────────────────────────────────────────────

/**
 * Purely SYNTACTIC path rules — no filesystem, so they always run, with or without a repoRoot.
 * Returns an error fragment, or null when the path is acceptable.
 */
export function pathSyntaxError(p) {
  if (typeof p !== 'string' || p.length === 0) return 'must be a non-empty string';
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
      runChecks(ingested.value, { errors, repoRoot, sources: new Map() });
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
}

function checkPath(where, p, ctx, err) {
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
  if (bucketsWellFormed) {
    for (const declared of ctx.sources.keys()) {
      if (!classifiedIn.has(declared)) {
        err(`coverage: ${show(declared)} is declared in sources[] but appears in NO coverage bucket — every declared source is classified exactly once across read / partial / skipped`);
      }
    }
  }
}

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
      const where = at === '' ? key : `${at}.${key}`;
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

function checkContradictions(at, node, ctx, err) {
  if (!Array.isArray(node.contradictions)) { err(`${at}.contradictions: must be an array`); return; }
  node.contradictions.forEach((c, j) => {
    const cat = `${at}.contradictions[${j}]`;
    if (!isObj(c)) { err(`${cat}: must be an object { claim, evidence, statement }`); return; }

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
    if (!nonEmptyString(c.statement)) err(`${cat}.statement: must be a non-empty statement of the conflict`);
  });
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
