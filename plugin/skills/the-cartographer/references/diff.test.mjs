// the-cartographer — the drift engine's tests (PDR §8, ADR C-004 / C-005 / C-014).
//
// The drift model is TWO ORTHOGONAL FAMILIES and the tests are written to keep them apart:
//
//   (A) set membership over `doc` claims vs evidence  → PHANTOM | UNDOCUMENTED | UNVERIFIED
//   (B) an extractor-asserted contradiction record     → STALE
//
// A node can sit squarely in family (A)'s "documented AND evidenced" cell — raising no
// set-membership finding at all — and still be STALE. Any test that reads "both ⇒ no finding" full
// stop has conflated the two.
//
// Zero dependencies: node built-ins only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeDrift, DRIFT_CLASSES } from './diff.mjs';
import { validate } from './validate.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../../../..');
const FIXTURE = path.join(HERE, 'fixtures', 'tiny.map.json');
const SH = 'plugin/skills/the-cartographer/references/fixtures/tiny/run.sh';
const MD = 'plugin/skills/the-cartographer/references/fixtures/tiny/SKILL.md';

const load = () => JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
const nodeOf = (m, id) => m.nodes.find((n) => n.id === id);
const findingsOf = (m) => computeDrift(m).findings;
const forNode = (m, id) => findingsOf(m).filter((f) => f.nodeId === id);
const classesFor = (m, id) => forNode(m, id).map((f) => f.class);

/**
 * The fixture with extra nodes appended. `sources`, `coverage` and `views` stay the real ones, so the
 * composed map is still LEGAL IR — test 16 proves it rather than assuming it. A synthetic that only
 * the drift engine would accept would test a contract nobody else honours.
 */
function plus(...nodes) {
  const m = load();
  m.nodes.push(...nodes);
  return m;
}

// ─── synthetic records ────────────────────────────────────────────────────────────────────────────
// Every citation resolves to one of the fixture's two hashed sources and respects the claimKind ↔
// source-role binding (`doc` ⇒ SKILL.md, `code-comment` / `user-message` ⇒ run.sh).

const docClaim = (over = {}) => ({ path: MD, line: 7, text: 'the docs assert this', claimKind: 'doc', checked: true, ...over });
const commentClaim = (over = {}) => ({ path: SH, line: 5, text: '# a comment asserts this', claimKind: 'code-comment', checked: true, ...over });
const userMsgClaim = (over = {}) => ({ path: SH, line: 23, text: 'unknown mode', claimKind: 'user-message', checked: true, ...over });
const codeEvidence = (over = {}) => ({ path: SH, line: 6, note: 'tiny_core() {', ...over });

const node = (kind, label, over = {}) => ({
  id: `${kind}.${label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')}`,
  kind, label, lane: 'core', summary: 'a synthetic node built by diff.test.mjs.', inferred: false,
  evidence: [], claims: [], ...over,
});

/** A doc claim with NO `checked` key at all — the extractor said nothing, which is not `checked: false`. */
function docClaimWithoutCheckedKey() {
  const c = docClaim();
  delete c.checked;
  return c;
}

// (A) family — set membership
const UNDOC_BY_USER_MESSAGE = node('env', 'TINY_QUIET', { claims: [userMsgClaim()], evidence: [codeEvidence()] });
const DOCUMENTED_AND_EVIDENCED = node('env', 'TINY_LOUD', { claims: [docClaim()], evidence: [codeEvidence()] });
const ALL_CLAIMS_UNCHECKED = node('flag', 'unverified only', { claims: [docClaim({ checked: false })] });
const CHECKED_KEY_ABSENT = node('flag', 'checked absent', { claims: [docClaimWithoutCheckedKey()] });
const MIXED_CHECKS = node('flag', 'mixed checks', { claims: [docClaim({ checked: false }), commentClaim({ checked: true })] });
const UNCHECKED_BESIDE_EVIDENCE = node('external', 'unchecked beside evidence', {
  claims: [docClaim({ checked: false })], evidence: [codeEvidence()],
});
const UNDOCUMENTED_AND_UNCHECKED = node('env', 'TINY_MUTE', { claims: [commentClaim({ checked: false })], evidence: [codeEvidence()] });
const UNDOC_TWO_EVIDENCE = node('env', 'TINY_TWICE', {
  evidence: [codeEvidence({ line: 12, note: 'second site' }), codeEvidence({ line: 7, note: 'first site' })],
});
const COMMENT_CLAIM_NO_EVIDENCE = node('artifact', 'comment only', { claims: [commentClaim()] });

/**
 * A citation carrying an OWN `__proto__` key. The contract bans no key name on a citation, and
 * `JSON.parse` hands the key back verbatim from a `map.json` that carries it — so it is ordinary
 * data the drift engine must be able to tell two citations apart by. It cannot be written as an
 * object literal: `{ __proto__: v }` is the PROTOTYPE spelling and never becomes an own property.
 */
function withOwnProtoKey(record, value) {
  const out = { ...record };
  Object.defineProperty(out, '__proto__', { value, writable: true, enumerable: true, configurable: true });
  return out;
}

/**
 * The three ways a property can ANSWER A GET and still not reach the copy `citation()` makes.
 * `structuredClone` carries own ENUMERABLE DATA properties and nothing else: it DROPS an inherited
 * one and a non-enumerable one outright, and it RE-READS an accessor — so what a getter handed the
 * guard need not be what it hands the copy. Exactly the three `validate.mjs`'s `readOwnData` (:406)
 * refuses, for the same reason: a contract cannot be enforced on a value that is not the value used.
 */
const without = (record, ...keys) => {
  const out = { ...record };
  for (const key of keys) delete out[key];
  return out;
};
const inheritedKeys = (record, keys) => Object.assign(
  Object.create(Object.fromEntries(keys.map((k) => [k, record[k]]))),
  without(record, ...keys),
);
const hiddenKeys = (record, keys) => {
  const out = without(record, ...keys);
  for (const key of keys) {
    Object.defineProperty(out, key, { value: record[key], writable: true, enumerable: false, configurable: true });
  }
  return out;
};
const accessorKeys = (record, keys) => {
  const out = without(record, ...keys);
  for (const key of keys) Object.defineProperty(out, key, { get: () => record[key], enumerable: true, configurable: true });
  return out;
};
const LOC = ['path', 'line'];

/**
 * FACTORIES rather than shared constants, unlike the synthetics above: test 20 MUTATES a returned
 * finding to prove it is not an alias of the map. Against a shared constant that mutation would
 * reach a module-level synthetic and leak into every later test — hiding the aliasing defect behind
 * a fixture it had already corrupted.
 */
const protoTwinNode = () => node('env', 'TINY_PROTO', {
  evidence: [withOwnProtoKey(codeEvidence(), 'alpha'), withOwnProtoKey(codeEvidence(), 'beta')],
});
const nestedMetaNode = () => node('env', 'TINY_NESTED', {
  evidence: [codeEvidence({ note: 'nested metadata site', meta: { nested: 'from the map' } })],
});

// (B) family — contradiction records
const NO_CONTRADICTION_RECORD = node('outcome', 'no contradiction record', {
  claims: [docClaim({ text: 'the docs say it exits 0' })],
  evidence: [codeEvidence({ note: 'exit 2' })],
});
const USER_MESSAGE_STALE = node('state', 'user message stale', {
  claims: [userMsgClaim()],
  evidence: [codeEvidence({ line: 23, note: "printf 'unknown mode\\n' >&2; exit 2" })],
  contradictions: [{
    claim: userMsgClaim(),
    evidence: codeEvidence({ line: 23, note: "printf 'unknown mode\\n' >&2; exit 2" }),
    statement: 'The message says "unknown mode"; the code also exits 2, which the message never mentions.',
  }],
});
const TWO_CONTRADICTIONS = node('mode', 'two contradictions', {
  claims: [docClaim({ line: 7, text: 'first documented claim' }), docClaim({ line: 8, text: 'second documented claim' })],
  evidence: [codeEvidence({ line: 6, note: 'first observation' }), codeEvidence({ line: 8, note: 'second observation' })],
  contradictions: [
    { claim: docClaim({ line: 8, text: 'second documented claim' }), evidence: codeEvidence({ line: 8, note: 'second observation' }), statement: 'The second claim disagrees with line 8.' },
    { claim: docClaim({ line: 7, text: 'first documented claim' }), evidence: codeEvidence({ line: 6, note: 'first observation' }), statement: 'The first claim disagrees with line 6.' },
  ],
});

// (C) inference — never accuses (ADR C-005)
const INFERRED_PHANTOM = node('component', 'inferred phantom', { inferred: true, claims: [docClaim()] });
const INFERRED_CONTRADICTION = node('component', 'inferred contradiction', {
  inferred: true,
  claims: [docClaim({ text: 'an inferred node the docs also assert' })],
  evidence: [codeEvidence()],
  contradictions: [{
    claim: docClaim({ text: 'an inferred node the docs also assert' }),
    evidence: codeEvidence(),
    statement: 'A contradiction recorded on an inferred node.',
  }],
});

/** Every synthetic that is meant to be legal IR — test 16 validates the composed map. */
const LEGAL_SYNTHETICS = [
  UNDOC_BY_USER_MESSAGE, DOCUMENTED_AND_EVIDENCED, ALL_CLAIMS_UNCHECKED, CHECKED_KEY_ABSENT, MIXED_CHECKS,
  UNCHECKED_BESIDE_EVIDENCE, UNDOCUMENTED_AND_UNCHECKED, UNDOC_TWO_EVIDENCE, COMMENT_CLAIM_NO_EVIDENCE, NO_CONTRADICTION_RECORD,
  USER_MESSAGE_STALE, TWO_CONTRADICTIONS, INFERRED_PHANTOM, INFERRED_CONTRADICTION,
  protoTwinNode(), nestedMetaNode(),
];

function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const v of Object.values(value)) deepFreeze(v);
  return value;
}

// ─── the fixture's four planted cases ─────────────────────────────────────────────────────────────

test('1 · the fixture yields EXACTLY four findings — the four planted drift cases and nothing else', () => {
  const findings = findingsOf(load());
  assert.equal(findings.length, 4, `expected the four planted cases, got:\n${JSON.stringify(findings, null, 2)}`);
  assert.deepEqual(
    findings.map((f) => [f.class, f.nodeId]).sort(),
    [['PHANTOM', 'mode.build'], ['STALE', 'mode.check'], ['STALE', 'outcome.pass'], ['UNDOCUMENTED', 'env.tiny_debug']].sort(),
  );
  // The label travels with the finding: a renderer must never have to re-join against the map.
  assert.deepEqual(
    Object.fromEntries(findings.map((f) => [f.nodeId, f.label])),
    { 'mode.build': 'build', 'mode.check': 'check', 'outcome.pass': 'PASS', 'env.tiny_debug': 'TINY_DEBUG' },
  );
});

test('2 · RULE 1 — a doc claim with empty evidence is PHANTOM, cited by the claim it fails to deliver', () => {
  const m = load();
  const build = nodeOf(m, 'mode.build');
  assert.deepEqual(build.evidence, [], 'fixture precondition: mode.build carries no evidence');
  assert.equal(build.claims.filter((c) => c.claimKind === 'doc').length, 1);

  const [f] = forNode(m, 'mode.build');
  assert.equal(f.class, 'PHANTOM');
  assert.deepEqual(f.citations, build.claims);
  assert.match(f.detail, /SKILL\.md:7/);
});

test('3 · RULE 2 — evidence with no doc claim is UNDOCUMENTED, cited by the evidence nobody documented', () => {
  const m = load();
  const dbg = nodeOf(m, 'env.tiny_debug');
  assert.ok(dbg.evidence.length > 0, 'fixture precondition: env.tiny_debug is evidenced');

  const [f] = forNode(m, 'env.tiny_debug');
  assert.equal(f.class, 'UNDOCUMENTED');
  assert.deepEqual(f.citations, dbg.evidence);
  assert.match(f.detail, /run\.sh:7/);
});

test('4 · RULE 4 — ADR C-014: only claimKind "doc" documents a capability', () => {
  const m = load();
  const dbg = nodeOf(m, 'env.tiny_debug');
  // The load-bearing precondition. The node DOES carry a claim — an all-claims model would call it
  // documented and go silent, which is exactly how three oracle findings would vanish (codex-gate.sh:6
  // is a usage header asserting the env vars).
  assert.equal(dbg.claims.length, 1);
  assert.equal(dbg.claims[0].claimKind, 'code-comment');
  assert.deepEqual(classesFor(m, 'env.tiny_debug'), ['UNDOCUMENTED']);

  // …and the same for the third claim kind.
  const withUserMsg = plus(UNDOC_BY_USER_MESSAGE);
  assert.deepEqual(classesFor(withUserMsg, UNDOC_BY_USER_MESSAGE.id), ['UNDOCUMENTED']);

  // The counter-case, so the assertion above is about claimKind and not about "any claim at all":
  // an identically-shaped node whose claim IS a doc claim goes silent.
  assert.deepEqual(classesFor(plus(DOCUMENTED_AND_EVIDENCED), DOCUMENTED_AND_EVIDENCED.id), []);
});

test('5 · RULE 3 — a doc claim PLUS evidence raises no set-membership finding', () => {
  const m = load();
  const core = nodeOf(m, 'component.tiny_core');
  assert.ok(core.claims.some((c) => c.claimKind === 'doc') && core.evidence.length > 0);
  assert.equal(core.contradictions, undefined, 'fixture precondition: the clean node has no contradiction');
  assert.deepEqual(forNode(m, 'component.tiny_core'), []);
});

test('6 · RULES 3+7 ORTHOGONALITY — documented AND evidenced, and STILL stale', () => {
  const m = load();
  const check = nodeOf(m, 'mode.check');
  // Family (A) says "no finding" for this cell…
  assert.ok(check.claims.some((c) => c.claimKind === 'doc'), 'precondition: mode.check has a doc claim');
  assert.ok(check.evidence.length > 0, 'precondition: mode.check has evidence');
  // …and family (B) fires anyway, because STALE is not a set-membership class.
  assert.deepEqual(classesFor(m, 'mode.check'), ['STALE']);
});

test('7 · RULE 7 — STALE comes ONLY from a contradictions record, and carries exactly its two citations', () => {
  const m = load();
  for (const id of ['mode.check', 'outcome.pass']) {
    const n = nodeOf(m, id);
    const [f] = forNode(m, id);
    assert.equal(f.class, 'STALE');
    assert.equal(n.contradictions.length, 1);
    assert.equal(f.citations.length, 2, 'exactly two citations — the asserted side and the observed side');
    assert.deepEqual(f.citations, [n.contradictions[0].claim, n.contradictions[0].evidence]);
    assert.equal(f.detail, n.contradictions[0].statement);
  }

  // The negative: a plain value mismatch is NOT computable from set membership. Without a record,
  // nothing is raised — that is what keeps the mechanical classes trustworthy (ADR C-005).
  const noRecord = plus(NO_CONTRADICTION_RECORD);
  assert.equal(nodeOf(noRecord, NO_CONTRADICTION_RECORD.id).contradictions, undefined);
  assert.deepEqual(forNode(noRecord, NO_CONTRADICTION_RECORD.id), []);
});

test('8 · RULE 7 — STALE is CLAIM-KIND AGNOSTIC: C-014 narrows documentation, not staleness', () => {
  const m = load();
  const pass = nodeOf(m, 'outcome.pass');
  const contradicted = pass.claims.find((c) => c.line === pass.contradictions[0].claim.line);
  assert.equal(contradicted.claimKind, 'code-comment', 'precondition: the contradicted claim is a comment, not a doc');
  assert.deepEqual(classesFor(m, 'outcome.pass'), ['STALE']);

  // …and a user-message claim raises STALE too, even though it never counts as documentation.
  //
  // Both families fire here, and that is the point rather than a double-count: C-014 says the
  // user-message claim does not document the node (family A ⇒ UNDOCUMENTED), while the contradiction
  // record says what it does assert is contradicted by the code (family B ⇒ STALE). A model that
  // narrowed STALE by claimKind would drop the second — and both real oracle STALE findings are of
  // exactly this kind.
  const um = plus(USER_MESSAGE_STALE);
  assert.deepEqual(classesFor(um, USER_MESSAGE_STALE.id), ['UNDOCUMENTED', 'STALE']);
  const stale = forNode(um, USER_MESSAGE_STALE.id).find((f) => f.class === 'STALE');
  assert.equal(stale.citations.length, 2);
  assert.deepEqual(stale.citations, [USER_MESSAGE_STALE.contradictions[0].claim, USER_MESSAGE_STALE.contradictions[0].evidence]);
});

test('9 · RULE 6 — ADR C-005: an inferred:true node yields NO finding of any class', () => {
  const m = load();
  const table = nodeOf(m, 'component.dispatch_table');
  assert.equal(table.inferred, true);
  assert.deepEqual(forNode(m, 'component.dispatch_table'), []);

  // Proof it is a genuine candidate and not silent for some other reason: flip the one flag.
  const flipped = load();
  nodeOf(flipped, 'component.dispatch_table').inferred = false;
  assert.deepEqual(classesFor(flipped, 'component.dispatch_table'), ['UNVERIFIED']);

  // A node that would otherwise be PHANTOM (its claim IS checked) — silent while inferred, PHANTOM once not.
  const ip = plus(INFERRED_PHANTOM);
  assert.deepEqual(forNode(ip, INFERRED_PHANTOM.id), []);
  const ipFlipped = plus({ ...INFERRED_PHANTOM, inferred: false });
  assert.deepEqual(classesFor(ipFlipped, INFERRED_PHANTOM.id), ['PHANTOM']);

  // "No finding of ANY class" includes family (B): inference never accuses, contradiction record or not.
  const ic = plus(INFERRED_CONTRADICTION);
  assert.deepEqual(forNode(ic, INFERRED_CONTRADICTION.id), []);
  const icFlipped = plus({ ...INFERRED_CONTRADICTION, inferred: false });
  assert.deepEqual(classesFor(icFlipped, INFERRED_CONTRADICTION.id), ['STALE']);
});

test('10 · RULE 5 — every claim checked:false yields UNVERIFIED, never PHANTOM', () => {
  const m = plus(ALL_CLAIMS_UNCHECKED, MIXED_CHECKS, CHECKED_KEY_ABSENT);
  assert.deepEqual(classesFor(m, ALL_CLAIMS_UNCHECKED.id), ['UNVERIFIED']);
  assert.deepEqual(forNode(m, ALL_CLAIMS_UNCHECKED.id)[0].citations, ALL_CLAIMS_UNCHECKED.claims);

  // ALL, not ANY: one checked claim beside an unchecked one still accuses.
  assert.deepEqual(classesFor(m, MIXED_CHECKS.id), ['PHANTOM']);

  // An ABSENT `checked` key is not `checked: false`. The extractor said nothing; treating silence as
  // "could not check" would dissolve the whole PHANTOM class for any extractor that omits the flag.
  assert.deepEqual(classesFor(m, CHECKED_KEY_ABSENT.id), ['PHANTOM']);
});

test('11 · RULE 5 rewrites PHANTOM only — an unchecked claim never suppresses the other classes', () => {
  const m = plus(UNCHECKED_BESIDE_EVIDENCE, UNDOCUMENTED_AND_UNCHECKED);
  // Documented and evidenced: rule 3 already says "no finding", checked or not.
  assert.deepEqual(forNode(m, UNCHECKED_BESIDE_EVIDENCE.id), []);
  // Evidenced with no doc claim: still UNDOCUMENTED — the evidence is observed fact, not a claim.
  assert.deepEqual(classesFor(m, UNDOCUMENTED_AND_UNCHECKED.id), ['UNDOCUMENTED']);
});

test('12 · RULE 8 — findings are totally ordered: emission order never leaks', () => {
  const a = findingsOf(load());
  const b = findingsOf(load());
  assert.deepEqual(a, b, 'two runs over the same map must be identical');

  // Reverse every unordered array the extractor could have emitted differently.
  const shuffled = load();
  shuffled.nodes.reverse();
  for (const n of shuffled.nodes) {
    if (Array.isArray(n.claims)) n.claims.reverse();
    if (Array.isArray(n.evidence)) n.evidence.reverse();
    if (Array.isArray(n.contradictions)) n.contradictions.reverse();
  }
  assert.deepEqual(findingsOf(shuffled), a, 'reordering the extraction must not reorder the findings');

  // The hard tie: two findings of the SAME class on the SAME node. Only a full-content tie-break
  // orders these, and without one the contradictions[] array order leaks straight through.
  const two = plus(TWO_CONTRADICTIONS);
  const twoFindings = forNode(two, TWO_CONTRADICTIONS.id);
  assert.deepEqual(twoFindings.map((f) => f.class), ['STALE', 'STALE']);
  const twoReversed = plus({ ...TWO_CONTRADICTIONS, contradictions: [...TWO_CONTRADICTIONS.contradictions].reverse() });
  assert.deepEqual(forNode(twoReversed, TWO_CONTRADICTIONS.id), twoFindings);

  // The other place emission order can leak: the CITATIONS inside one finding. A finding built from
  // two evidence records must not depend on the order the extractor listed them in.
  const ev = forNode(plus(UNDOC_TWO_EVIDENCE), UNDOC_TWO_EVIDENCE.id);
  const evReversed = forNode(plus({ ...UNDOC_TWO_EVIDENCE, evidence: [...UNDOC_TWO_EVIDENCE.evidence].reverse() }), UNDOC_TWO_EVIDENCE.id);
  assert.equal(ev[0].citations.length, 2);
  assert.deepEqual(evReversed, ev, 'the citations inside a finding must be ordered, not emitted');
  assert.deepEqual(ev[0].citations.map((c) => c.line), [7, 12], 'citations run in path/line order');
});

test('13 · every finding carries the documented shape { class, nodeId, label, detail, citations }', () => {
  assert.deepEqual(DRIFT_CLASSES, ['PHANTOM', 'UNDOCUMENTED', 'STALE', 'UNVERIFIED']);
  const m = plus(...LEGAL_SYNTHETICS);
  const findings = findingsOf(m);
  assert.ok(findings.length >= 4);
  for (const f of findings) {
    assert.deepEqual(Object.keys(f).sort(), ['citations', 'class', 'detail', 'label', 'nodeId']);
    assert.ok(DRIFT_CLASSES.includes(f.class), `unknown class ${f.class}`);
    assert.ok(nodeOf(m, f.nodeId), `${f.nodeId} must be a node of the map`);
    assert.equal(f.label, nodeOf(m, f.nodeId).label);
    assert.ok(typeof f.detail === 'string' && f.detail.length > 0, 'a finding must say what is wrong');
    assert.ok(Array.isArray(f.citations) && f.citations.length > 0, 'a finding must show its work');
    for (const c of f.citations) {
      assert.ok(typeof c.path === 'string' && c.path.length > 0);
      assert.ok(Number.isInteger(c.line) && c.line >= 1);
    }
  }
});

test('14 · ADR C-004 — drift is DERIVED: computeDrift never mutates the map nor writes findings back', () => {
  const before = fs.readFileSync(FIXTURE, 'utf8');
  const m = load();
  const frozen = deepFreeze(load());
  assert.doesNotThrow(() => computeDrift(frozen), 'computeDrift must not write into its input');

  const snapshot = JSON.stringify(m);
  const { findings } = computeDrift(m);
  assert.equal(JSON.stringify(m), snapshot, 'the map must be byte-identical after computing drift');
  assert.equal(fs.readFileSync(FIXTURE, 'utf8'), before, 'computeDrift must not touch the snapshot on disk');
  assert.ok(!JSON.stringify(m).includes('"drift"'), 'no drift key may be written anywhere into the IR');

  // The findings must not alias the map's own records, or a caller editing a finding edits the map.
  findings[0].citations[0].line = 999999;
  findings[0].citations[0].injected = true;
  assert.equal(JSON.stringify(m), snapshot);
});

test('15 · a contradictions record missing a citation or its statement FAILS CLOSED (PDR §8)', () => {
  const base = () => ({
    claim: docClaim({ text: 'broken record claim' }),
    evidence: codeEvidence({ note: 'broken record evidence' }),
    statement: 'a stated conflict',
  });
  const broken = (drop) => {
    const record = base();
    delete record[drop];
    return plus(node('mode', 'broken record', {
      claims: [docClaim({ text: 'broken record claim' })],
      evidence: [codeEvidence({ note: 'broken record evidence' })],
      contradictions: [record],
    }));
  };
  for (const dropped of ['claim', 'evidence', 'statement']) {
    assert.throws(() => computeDrift(broken(dropped)), (e) => {
      assert.match(e.message, new RegExp(dropped));
      assert.match(e.message, /mode\.broken_record/);
      return true;
    }, `a contradiction missing ${dropped} must fail closed, not emit an unauditable STALE`);
  }
});

test('16 · the synthetic nodes these tests rely on are LEGAL IR, not a fantasy of the contract', () => {
  const res = validate(plus(...LEGAL_SYNTHETICS), { repoRoot: REPO_ROOT });
  assert.equal(res.ok, true, res.errors.join('\n'));
});

test('17 · a comment-only claim with NO evidence raises nothing — the literal reading of rules 1–2', () => {
  // Documented so the gap cannot change silently: rule 1 needs a `doc` claim (C-014 excludes this
  // one) and rule 2 needs evidence (there is none), so neither family fires. Reported as a spec gap.
  const m = plus(COMMENT_CLAIM_NO_EVIDENCE);
  assert.deepEqual(forNode(m, COMMENT_CLAIM_NO_EVIDENCE.id), []);
});

test('18 · a map with no nodes yields no findings rather than throwing', () => {
  assert.deepEqual(computeDrift({ nodes: [] }), { findings: [] });
});

test('19 · RULE 8 — an own `__proto__` key is DATA: it must not collapse the full-content tie-break', () => {
  const twin = protoTwinNode();
  const [a, b] = twin.evidence;
  // The precondition, spelled out. Two citations at the SAME path:line, identical but for one own
  // `__proto__` key — so the full-content tie-break is the ONLY thing standing between the
  // extractor's emission order and the order the findings come back in.
  assert.ok(Object.hasOwn(a, '__proto__') && Object.hasOwn(b, '__proto__'), 'own data property, not a prototype');
  assert.equal(a.path, b.path);
  assert.equal(a.line, b.line);
  assert.deepEqual(Object.keys(a).sort(), ['__proto__', 'line', 'note', 'path']);
  assert.deepEqual(Object.keys(a).sort(), Object.keys(b).sort());

  const forward = forNode(plus(twin), twin.id);
  const backward = protoTwinNode();
  backward.evidence.reverse();
  const reversed = forNode(plus(backward), twin.id);

  assert.deepEqual(forward.map((f) => f.class), ['UNDOCUMENTED']);
  assert.equal(forward[0].citations.length, 2);
  // The key must survive the copy OUT of the map too — a copy that dropped it would make the
  // tie-break "deterministic" by deleting the one thing the two citations disagree about.
  assert.deepEqual(forward[0].citations.map((c) => c['__proto__']), ['alpha', 'beta']);
  assert.deepEqual(
    reversed[0].citations.map((c) => c['__proto__']), ['alpha', 'beta'],
    'reversing the extractor\'s emission order must not reverse the citations',
  );
  assert.deepEqual(reversed, forward);
});

test('20 · ADR C-004 — a citation is copied out DEEPLY: nested metadata is not aliased either', () => {
  // Test 14 proves the TOP level is copied. One level down is where the guarantee actually gets
  // tested: a shallow copy hands the renderer the map's own nested object, so annotating a finding
  // writes the drift verdict back into the snapshot C-004 exists to keep it out of.
  const m = plus(nestedMetaNode());
  const id = nestedMetaNode().id;
  const snapshot = JSON.stringify(m);

  const [f] = forNode(m, id);
  assert.equal(f.class, 'UNDOCUMENTED');
  assert.deepEqual(f.citations[0].meta, { nested: 'from the map' }, 'precondition: the nested metadata travels with the finding');

  f.citations[0].meta.nested = 'annotated by a renderer';
  f.citations[0].meta.injected = true;
  // The targeted assertion first, so the failure names the aliased field rather than dumping the map.
  assert.equal(nodeOf(m, id).evidence[0].meta.nested, 'from the map', 'the map\'s own nested metadata must be untouched');
  assert.equal(Object.hasOwn(nodeOf(m, id).evidence[0].meta, 'injected'), false, 'a renderer must not be able to inject into the map');
  assert.equal(JSON.stringify(m), snapshot, 'editing a finding must not edit the map it came from');

  // …and the same for a STALE finding's two citations, which come from a different code path.
  const contradicted = node('mode', 'nested stale', {
    claims: [docClaim({ text: 'a claim with nested metadata', meta: { nested: 'claim side' } })],
    evidence: [codeEvidence({ note: 'observed', meta: { nested: 'evidence side' } })],
    contradictions: [{
      claim: docClaim({ text: 'a claim with nested metadata', meta: { nested: 'claim side' } }),
      evidence: codeEvidence({ note: 'observed', meta: { nested: 'evidence side' } }),
      statement: 'the claim and the evidence disagree.',
    }],
  });
  const sm = plus(contradicted);
  const staleSnapshot = JSON.stringify(sm);
  const [s] = forNode(sm, contradicted.id);
  assert.equal(s.class, 'STALE');
  for (const c of s.citations) c.meta.nested = 'annotated by a renderer';
  assert.equal(JSON.stringify(sm), staleSnapshot, 'both STALE citations must be deep copies too');
});

test('21 · a contradictions citation that is not a REAL citation fails closed — never `citations: [{}]`', () => {
  const hollowMap = (side, value) => plus(node('mode', 'hollow record', {
    claims: [docClaim({ text: 'hollow record claim' })],
    evidence: [codeEvidence({ note: 'hollow record evidence' })],
    contradictions: [{
      claim: docClaim({ text: 'hollow record claim' }),
      evidence: codeEvidence({ note: 'hollow record evidence' }),
      statement: 'a stated conflict',
      ...(side === null ? {} : { [side]: value }),
    }],
  }));

  // The positive control: the SAME scaffold with both citations intact raises exactly one STALE, so
  // every throw below is about the hollow citation rather than about the record around it.
  assert.deepEqual(forNode(hollowMap(null), 'mode.hollow_record').map((f) => f.class), ['STALE']);

  // "is it an object" was the whole test, and `{}` IS an object. Each of these passed it and produced
  // a finding accusing a node while citing a location no reader can open — exactly the unauditable
  // accusation PDR §8 forbids, and which the missing-side and missing-statement checks beside it
  // already refuse. A citation is `path` + a 1-based `line`, as validate.mjs defines one.
  const hollow = [
    ['claim', {}, 'an EMPTY object'],
    ['evidence', {}, 'an EMPTY object'],
    ['claim', { line: 7, text: 'hollow record claim' }, 'no path at all'],
    ['evidence', { path: SH, note: 'hollow record evidence' }, 'no line at all'],
    ['claim', docClaim({ path: '' }), 'an empty path'],
    ['evidence', codeEvidence({ path: '   ' }), 'a whitespace-only path'],
    ['claim', docClaim({ path: 42 }), 'a path that is not a string'],
    ['evidence', codeEvidence({ line: 0 }), 'line 0 — a citation is 1-based'],
    ['claim', docClaim({ line: -3 }), 'a negative line'],
    ['evidence', codeEvidence({ line: 7.5 }), 'a fractional line'],
    ['claim', docClaim({ line: '7' }), 'a line that is a string'],
    ['evidence', codeEvidence({ line: null }), 'a null line'],
  ];
  for (const [side, value, why] of hollow) {
    assert.throws(() => computeDrift(hollowMap(side, value)), (e) => {
      assert.match(e.message, new RegExp(`mode\\.hollow_record\\.contradictions\\[0\\]\\.${side}`));
      return true;
    }, `${side} with ${why} must fail closed rather than emit a STALE finding citing nothing`);
  }
});

test('22 · a claims / evidence record that is not a REAL citation fails closed — never `at undefined:undefined`', () => {
  // The family-(A) twin of test 21, and the SAME hole one family over: `membershipFinding` filtered
  // `claims` and `evidence` by shape alone, and `{}` is a record. So a hollow record was both COUNTED
  // as a real one and handed to `where()`, which rendered it into the human-visible detail as
  // `undefined:undefined` beside `citations: [{}]` — an accusation with nothing a reader can open,
  // which is the one thing PDR §8 says a finding may never be. Both halves of the damage are covered
  // below: the rows that WRONGLY EMITTED such a finding, and the rows where a hollow record counting
  // as real silently DELETED the finding the node should have raised.
  const rx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const at = (label, over) => node('env', label, over);
  const findings = (n) => forNode(plus(n), n.id);
  const cites = (c) => typeof c.path === 'string' && c.path.trim() !== '' && Number.isInteger(c.line) && c.line >= 1;

  // The positive controls FIRST: the same three scaffolds with INTACT citations raise exactly the
  // finding they should and name a real location — so every throw below is attributable to the
  // hollow record rather than to the scaffold around it.
  const controls = [
    ['PHANTOM', at('TINY_DOCUMENTED_ONLY', { claims: [docClaim({ text: 'documented, never built' })] }), `${MD}:7`],
    ['UNDOCUMENTED', at('TINY_EVIDENCED_ONLY', { evidence: [codeEvidence({ note: 'built, never documented' })] }), `${SH}:6`],
    ['UNVERIFIED', at('TINY_UNCHECKED_ONLY', { claims: [docClaim({ checked: false })] }), `${MD}:7`],
  ];
  for (const [cls, n, location] of controls) {
    const [f, ...rest] = findings(n);
    assert.deepEqual(rest, [], `the ${cls} control must raise exactly one finding`);
    assert.equal(f.class, cls);
    assert.ok(f.detail.includes(location), `${cls} must name ${location}, got: ${f.detail}`);
    assert.doesNotMatch(f.detail, /undefined/, `${cls}'s detail must never render an unresolved citation`);
    assert.ok(f.citations.length > 0 && f.citations.every(cites), `${cls} must cite an openable location`);
  }

  const hollow = [
    // ── the two repros exactly as reported ────────────────────────────────────────────────────────
    ['evidence[0]', at('TINY_X', { evidence: [{}] }),
      'the reported UNDOCUMENTED repro — `citations: [{}]`, "Evidenced at undefined:undefined"'],
    ['claims[0]', at('TINY_Y', { claims: [{ claimKind: 'doc' }] }),
      'the reported PHANTOM repro — `citations: [{ claimKind: "doc" }]`, "Documented at undefined:undefined"'],

    // ── the other half: a hollow record COUNTS, so it silently deletes a real finding ─────────────
    ['evidence[0]', at('TINY_SUPPRESSED_PHANTOM', { claims: [docClaim()], evidence: [{}] }),
      'hollow evidence marked the node "evidenced" and suppressed the PHANTOM it should have raised'],
    ['claims[0]', at('TINY_SUPPRESSED_UNDOC', { claims: [{ claimKind: 'doc' }], evidence: [codeEvidence()] }),
      'a hollow doc claim posed as documentation and suppressed the UNDOCUMENTED it should have raised'],

    // ── a hollow claim beside real evidence: UNDOCUMENTED fired and named "a undefined claim" ─────
    ['claims[0]', at('TINY_UNDOC_HOLLOW_KIND', { claims: [{}], evidence: [codeEvidence()] }),
      'a hollow claim rendered its own claimKind as "undefined" into the detail'],

    // ── UNVERIFIED cites EVERY claim, not only the doc ones, so it renders the hollow one too ─────
    ['claims[1]', at('TINY_UNVERIFIED_HOLLOW', { claims: [docClaim({ checked: false }), { checked: false }] }),
      'UNVERIFIED cited a hollow claim at undefined:undefined'],

    // ── and the partial citations, the same table test 21 already refuses on the STALE side ───────
    ['evidence[0]', at('TINY_NO_LINE', { evidence: [{ path: SH, note: 'no line at all' }] }), 'no line at all'],
    ['claims[0]', at('TINY_NO_PATH', { claims: [{ line: 7, text: 'no path', claimKind: 'doc' }] }), 'no path at all'],
    ['claims[0]', at('TINY_EMPTY_PATH', { claims: [docClaim({ path: '' })] }), 'an empty path'],
    ['evidence[0]', at('TINY_BLANK_PATH', { evidence: [codeEvidence({ path: '   ' })] }), 'a whitespace-only path'],
    ['claims[0]', at('TINY_PATH_NOT_STRING', { claims: [docClaim({ path: 42 })] }), 'a path that is not a string'],
    ['evidence[0]', at('TINY_LINE_ZERO', { evidence: [codeEvidence({ line: 0 })] }), 'line 0 — a citation is 1-based'],
    ['claims[0]', at('TINY_LINE_NEGATIVE', { claims: [docClaim({ line: -3 })] }), 'a negative line'],
    ['evidence[0]', at('TINY_LINE_FRACTIONAL', { evidence: [codeEvidence({ line: 7.5 })] }), 'a fractional line'],
    ['claims[0]', at('TINY_LINE_STRING', { claims: [docClaim({ line: '7' })] }), 'a line that is a string'],
    ['evidence[0]', at('TINY_LINE_NULL', { evidence: [codeEvidence({ line: null })] }), 'a null line'],
  ];

  for (const [slot, n, why] of hollow) {
    assert.throws(() => computeDrift(plus(n)), (e) => {
      // The message must name the NODE and the offending slot, as the STALE side's does — a
      // fail-closed throw a reader cannot trace back to one record is barely better than the finding.
      assert.match(e.message, new RegExp(`${rx(n.id)}\\.${rx(slot)}`));
      assert.match(e.message, /Got path .*, line /, 'the message must show the offending record');
      return true;
    }, `${slot} with ${why} must fail closed rather than emit an unauditable finding`);
  }
});

const rx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('23 · a location that will not SURVIVE the copy fails closed — the guard judges own, enumerable DATA', () => {
  // Tests 21 and 22 made a hollow citation fail closed. This is the SAME accusation coming back one
  // level down, through the copy: `citation()` is `structuredClone`, which carries own ENUMERABLE
  // DATA properties and nothing else, while the guard read `v.path` through a plain GET. So a record
  // whose location sits on its PROTOTYPE, or is NON-ENUMERABLE, answered the guard with a real
  // file:line and then handed the finding NOTHING — `undefined:undefined` beside a citation the copy
  // had already emptied, which is precisely the guard those tests added. An ACCESSOR is refused for
  // the third reason `validate.mjs`'s `readOwnData` refuses one: it is re-read when the copy is made,
  // so the value that passed the check need not be the value carried.

  // The precondition, spelled out — each shape answers a get, and none survives as checked.
  const probe = codeEvidence();
  assert.equal(inheritedKeys(probe, LOC).path, SH, 'a get sees the inherited path');
  assert.equal(structuredClone(inheritedKeys(probe, LOC)).path, undefined, 'the copy does not');
  assert.equal(hiddenKeys(probe, LOC).line, 6, 'a get sees the non-enumerable line');
  assert.equal(structuredClone(hiddenKeys(probe, LOC)).line, undefined, 'the copy does not');
  assert.equal(accessorKeys(probe, LOC).path, SH, 'a get sees the accessor path');
  assert.ok(Object.getOwnPropertyDescriptor(accessorKeys(probe, LOC), 'path').get, 'and the copy RE-READS it');

  // ── family (A): the same two halves of the damage test 22 covers ────────────────────────────────
  const membership = [
    ['evidence[0]', node('env', 'TINY_PROTO_EV', { evidence: [inheritedKeys(codeEvidence(), LOC)] }),
      'an INHERITED location — UNDOCUMENTED "Evidenced at undefined:undefined" beside an emptied citation'],
    ['evidence[0]', node('env', 'TINY_HIDDEN_EV', { evidence: [hiddenKeys(codeEvidence(), LOC)] }),
      'a NON-ENUMERABLE location the copy drops'],
    ['evidence[0]', node('env', 'TINY_ACCESSOR_EV', { evidence: [accessorKeys(codeEvidence(), LOC)] }),
      'an ACCESSOR location, re-read after the check'],
    ['claims[0]', node('env', 'TINY_PROTO_CLAIM', { claims: [inheritedKeys(docClaim(), LOC)] }),
      'an INHERITED location — PHANTOM citing nothing a reader can open'],
    ['claims[0]', node('env', 'TINY_HIDDEN_CLAIM', { claims: [hiddenKeys(docClaim(), LOC)] }), 'a NON-ENUMERABLE claim location'],
    ['claims[0]', node('env', 'TINY_ACCESSOR_CLAIM', { claims: [accessorKeys(docClaim(), LOC)] }), 'an ACCESSOR claim location'],
    // …and the half where a record too hollow to cite still COUNTS, deleting a finding that was due.
    ['evidence[0]', node('env', 'TINY_PROTO_SUPPRESSED', { claims: [docClaim()], evidence: [inheritedKeys(codeEvidence(), LOC)] }),
      'a vanishing evidence location marked the node "evidenced" and suppressed the PHANTOM it should have raised'],
    ['claims[0]', node('env', 'TINY_PROTO_SUPPRESSED_UNDOC', { claims: [inheritedKeys(docClaim(), LOC)], evidence: [codeEvidence()] }),
      'a vanishing doc claim posed as documentation and suppressed the UNDOCUMENTED it should have raised'],
  ];
  for (const [slot, n, why] of membership) {
    assert.throws(() => computeDrift(plus(n)), (e) => {
      assert.match(e.message, new RegExp(`${rx(n.id)}\\.${rx(slot)}`));
      assert.doesNotMatch(e.message, /Got path "plugin/,
        'the message must show what the copy CARRIES, not the location a get answers with');
      return true;
    }, `${slot} with ${why} must fail closed rather than emit an unauditable finding`);
  }

  // ── family (B): the same hole on the STALE side, which copies its two citations the same way ────
  const staleMap = (side, value) => plus(node('mode', 'vanishing citation', {
    claims: [docClaim({ text: 'vanishing citation claim' })],
    evidence: [codeEvidence({ note: 'vanishing citation evidence' })],
    contradictions: [{
      claim: docClaim({ text: 'vanishing citation claim' }),
      evidence: codeEvidence({ note: 'vanishing citation evidence' }),
      statement: 'a stated conflict',
      ...(side === null ? {} : { [side]: value }),
    }],
  }));
  // The positive control, so every throw below is about the vanishing location, not the scaffold.
  assert.deepEqual(forNode(staleMap(null), 'mode.vanishing_citation').map((f) => f.class), ['STALE']);

  const stale = [
    ['claim', inheritedKeys(docClaim({ text: 'vanishing citation claim' }), LOC), 'an INHERITED location'],
    ['claim', hiddenKeys(docClaim({ text: 'vanishing citation claim' }), LOC), 'a NON-ENUMERABLE location'],
    ['claim', accessorKeys(docClaim({ text: 'vanishing citation claim' }), LOC), 'an ACCESSOR location'],
    ['evidence', inheritedKeys(codeEvidence({ note: 'vanishing citation evidence' }), LOC), 'an INHERITED location'],
    ['evidence', hiddenKeys(codeEvidence({ note: 'vanishing citation evidence' }), LOC), 'a NON-ENUMERABLE location'],
    ['evidence', accessorKeys(codeEvidence({ note: 'vanishing citation evidence' }), LOC), 'an ACCESSOR location'],
  ];
  for (const [side, value, why] of stale) {
    assert.throws(() => computeDrift(staleMap(side, value)), (e) => {
      assert.match(e.message, new RegExp(`mode\\.vanishing_citation\\.contradictions\\[0\\]\\.${side}`));
      assert.doesNotMatch(e.message, /Got path "plugin/,
        'the message must show what the copy CARRIES, not the location a get answers with');
      return true;
    }, `${side} with ${why} must fail closed rather than emit a STALE citing nothing`);
  }
});

test('24 · a contradiction citation that QUOTES NOTHING fails closed — STALE must carry what was CLAIMED and what was OBSERVED', () => {
  // PDR §8 writes the record as { claim: {path,line,text}, evidence: {path,line,note}, statement },
  // and PDR §7.1 rule 5 makes both quotes mandatory — `validate.mjs` already refuses a record without
  // them (:630, :643). STALE is the ONE class resting entirely on human judgement: nothing about it
  // is derivable, so the record IS the whole audit trail. Two line numbers and a verdict, with no
  // word on what was asserted there or what was seen there, cannot be checked by anyone — the same
  // unauditable accusation as a citation naming no location, one field over.
  const CLAIM_TEXT = 'unquoted record claim';
  const EVIDENCE_NOTE = 'unquoted record evidence';
  const staleMap = (side, value) => plus(node('mode', 'unquoted record', {
    claims: [docClaim({ text: CLAIM_TEXT })],
    evidence: [codeEvidence({ note: EVIDENCE_NOTE })],
    contradictions: [{
      claim: docClaim({ text: CLAIM_TEXT }),
      evidence: codeEvidence({ note: EVIDENCE_NOTE }),
      statement: 'a stated conflict',
      ...(side === null ? {} : { [side]: value }),
    }],
  }));
  // The positive control: the same scaffold, both quotes intact, raises exactly one STALE.
  assert.deepEqual(forNode(staleMap(null), 'mode.unquoted_record').map((f) => f.class), ['STALE']);

  const claim = (over) => docClaim({ text: CLAIM_TEXT, ...over });
  const evidence = (over) => codeEvidence({ note: EVIDENCE_NOTE, ...over });
  const unquoted = [
    // The asserted side — `claim.text`.
    ['claim', 'text', without(claim(), 'text'), 'no text at all — the record never says what was CLAIMED'],
    ['claim', 'text', claim({ text: '' }), 'an empty text'],
    ['claim', 'text', claim({ text: '   ' }), 'a whitespace-only text'],
    ['claim', 'text', claim({ text: 42 }), 'a text that is not a string'],
    ['claim', 'text', claim({ text: null }), 'a null text'],
    // …and the same field vanishing in the copy, exactly as a location can (test 23).
    ['claim', 'text', inheritedKeys(claim(), ['text']), 'an INHERITED text the copy drops'],
    ['claim', 'text', hiddenKeys(claim(), ['text']), 'a NON-ENUMERABLE text the copy drops'],
    ['claim', 'text', accessorKeys(claim(), ['text']), 'an ACCESSOR text, re-read after the check'],

    // The observed side — `evidence.note`.
    ['evidence', 'note', without(evidence(), 'note'), 'no note at all — the record never says what was OBSERVED'],
    ['evidence', 'note', evidence({ note: '' }), 'an empty note'],
    ['evidence', 'note', evidence({ note: '   ' }), 'a whitespace-only note'],
    ['evidence', 'note', evidence({ note: 42 }), 'a note that is not a string'],
    ['evidence', 'note', evidence({ note: null }), 'a null note'],
    ['evidence', 'note', inheritedKeys(evidence(), ['note']), 'an INHERITED note the copy drops'],
    ['evidence', 'note', hiddenKeys(evidence(), ['note']), 'a NON-ENUMERABLE note the copy drops'],
    ['evidence', 'note', accessorKeys(evidence(), ['note']), 'an ACCESSOR note, re-read after the check'],
  ];
  for (const [side, key, value, why] of unquoted) {
    assert.throws(() => computeDrift(staleMap(side, value)), (e) => {
      // Same message shape as the checks beside it: the node, the record, the side, and the field.
      assert.match(e.message, new RegExp(`mode\\.unquoted_record\\.contradictions\\[0\\]\\.${side}\\.${key}`));
      return true;
    }, `${side}.${key} with ${why} must fail closed rather than emit an unauditable STALE`);
  }

  // The location checks must NOT have been weakened into this one: a record that quotes both sides
  // and still names no location fails closed on the location, as test 21 requires.
  assert.throws(() => computeDrift(staleMap('claim', without(claim(), 'line'))), /is not a citation/);
});

// ─── the BOUNDARY ─────────────────────────────────────────────────────────────────────────────────
//
// Tests 21–24 each hardened the PREDICATE that judges a citation, and each time the same accusation
// came back through a door the predicate does not watch. It cannot converge, because the defect is
// not the predicate's strictness: `computeDrift` VALIDATED one value and then DERIVED its output from
// a DIFFERENT READ of that value. Time-of-check was not time-of-use, so any predicate — however
// strict — judges a value the finding need not carry.
//
// The two tests below are the two live instances of that class. They are written against the ONE
// property that kills it: computeDrift must take its own inert, canonical snapshot of the input at
// the boundary, and validate and derive from that snapshot ONLY.

test('25 · the BOUNDARY — an EXOTIC object is refused before anything reads it, never validated then emptied', () => {
  // The precondition, spelled out. An exotic object — one with internal slots — carries a citation's
  // fields as OWN, ENUMERABLE DATA, so it answers every descriptor read tests 22/23 added with a real
  // file:line and clears the guard outright. `structuredClone` then drops those expandos, because it
  // copies an exotic by its INTERNAL SLOTS and not by its own properties. The guard therefore judged
  // a value the finding never carried, which is the whole class in one object.
  const dated = () => Object.assign(new Date(0), codeEvidence({ note: 'observed at a real line' }));
  assert.equal(dated().path, SH, 'a get sees the location');
  assert.equal(Object.getOwnPropertyDescriptor(dated(), 'path').enumerable, true, 'as OWN, ENUMERABLE data');
  assert.equal(structuredClone(dated()).path, undefined, 'and the copy carries none of it');

  const mapped = () => Object.assign(new Map(), docClaim({ text: 'a doc claim on a Map' }));
  const setted = () => Object.assign(new Set(), codeEvidence({ note: 'a note on a Set' }));

  const exotic = [
    ['evidence[0]', node('env', 'TINY_DATE_EV', { evidence: [dated()] }),
      'the reported repro — UNDOCUMENTED "Evidenced at undefined:undefined" beside a citation the copy had already emptied'],
    ['claims[0]', node('env', 'TINY_MAP_CLAIM', { claims: [mapped()] }), 'a Map posing as a doc claim — PHANTOM citing nothing'],
    ['evidence[0]', node('env', 'TINY_SET_EV', { evidence: [setted()] }), 'a Set posing as evidence'],
    // …and the other half of the damage, as tests 22 and 23 cover it: a record too hollow to cite
    // still COUNTED, so it deleted a finding that was due.
    ['evidence[0]', node('env', 'TINY_DATE_SUPPRESSED', { claims: [docClaim()], evidence: [dated()] }),
      'an exotic evidence record marked the node "evidenced" and suppressed the PHANTOM it should have raised'],
  ];
  for (const [slot, n, why] of exotic) {
    assert.throws(() => computeDrift(plus(n)), (e) => {
      assert.match(e.message, new RegExp(`${rx(n.id)}\\.${rx(slot)}`));
      return true;
    }, `${slot} with ${why} must fail closed rather than emit an unauditable finding`);
  }

  // The STALE side copies its two citations the same way, so it has the same hole.
  assert.throws(() => computeDrift(plus(node('mode', 'exotic stale', {
    claims: [docClaim({ text: 'exotic stale claim' })],
    evidence: [codeEvidence({ note: 'exotic stale evidence' })],
    contradictions: [{
      claim: Object.assign(new Date(0), docClaim({ text: 'exotic stale claim' })),
      evidence: codeEvidence({ note: 'exotic stale evidence' }),
      statement: 'a stated conflict',
    }],
  }))), /mode\.exotic_stale\.contradictions\[0\]\.claim/,
  'an exotic contradiction citation must fail closed rather than emit a STALE citing nothing');

  // …and the SAME class one level down, where it costs determinism rather than auditability: nested
  // exotic metadata collapses to `{}` in the full-content tie-break, so two citations at the SAME
  // path:line hash identically, the tie-break returns 0, and the extractor's emission order leaks
  // straight through the stable sort (RULE 8).
  const mapMeta = (v) => codeEvidence({ meta: new Map([['k', v]]) });
  const twins = (rev) => node('env', 'TINY_MAP_META', {
    evidence: rev ? [mapMeta('beta'), mapMeta('alpha')] : [mapMeta('alpha'), mapMeta('beta')],
  });
  for (const reversed of [false, true]) {
    assert.throws(() => computeDrift(plus(twins(reversed))), /env\.tiny_map_meta\.evidence\[[01]\]\.meta/,
      'nested exotic metadata must be refused at the boundary rather than silently collapsed in the tie-break');
  }
});

test('26 · the BOUNDARY — every value is read ONCE: a stateful accessor cannot answer the validator and the cloner differently', () => {
  // `staleFindings` READ `record.claim` to validate it (:251-284) and then RE-READ it to copy it out
  // (:293). An enumerable accessor is free to answer those two reads differently, so a record that
  // presented a complete, quoted, located citation to every single check handed the finding `{}` — a
  // STALE accusation carrying an empty citation, which is exactly what tests 21, 23 and 24 fail
  // closed on, arriving through a door no predicate can watch. Hardening the predicate cannot help:
  // the predicate never saw the value that shipped.
  let claimReads = 0;
  const statefulRecord = () => {
    let sealed = false;                    // flipped by `statement`, the LAST thing validation reads
    const record = {};
    Object.defineProperty(record, 'claim', {
      enumerable: true,
      configurable: true,
      get() { claimReads += 1; return sealed ? {} : docClaim({ text: 'a claim that vanishes' }); },
    });
    record.evidence = codeEvidence({ note: 'observed' });
    Object.defineProperty(record, 'statement', {
      enumerable: true,
      configurable: true,
      get() { sealed = true; return 'the claim and the code disagree.'; },
    });
    return record;
  };
  const m = plus(node('mode', 'stateful record', {
    claims: [docClaim({ text: 'a claim that vanishes' })],
    evidence: [codeEvidence({ note: 'observed' })],
    contradictions: [statefulRecord()],
  }));

  assert.throws(() => computeDrift(m), (e) => {
    assert.match(e.message, /mode\.stateful_record\.contradictions\[0\]\.claim/);
    return true;
  }, 'a stateful accessor must be refused at the boundary, not validated on one read and copied from another');

  // …and it is refused WITHOUT EVER BEING CONSULTED. Reading it exactly once would already close the
  // race, but test 23 requires an accessor location to fail closed, so accepting one read would
  // WEAKEN it; refusing from the descriptor satisfies both, and a value never asked cannot lie.
  assert.equal(claimReads, 0, 'the boundary must refuse an accessor from its DESCRIPTOR, never through a get');
});

test('27 · the BOUNDARY covers the WHOLE map, not only `nodes` — every entry point ingests one IR', () => {
  // PDR §7.1 rules 12–13: the shape rule is applied ONCE, at ingest, to every value in the document —
  // "a cycle, a hole, a hidden key or an exotic at the TOP LEVEL, on a node, on a SOURCE, on a VIEW,
  // or inside any array". Canonicalizing `map.nodes` alone left every other slot fail-open: the drift
  // engine accepted a map `validate()` refuses, which is the validator/consumer disagreement that
  // produced a finding in each of the first three phases, one level up.
  const cases = [
    ['an exotic at the TOP LEVEL', (m) => { m.audit = new Date(0); }, /audit/],
    ['an exotic on a SOURCE', (m) => { m.sources[0].meta = new Map([['k', 1]]); }, /sources\[0\]\.meta/],
    ['an exotic inside a VIEW', (m) => { m.views[0].note = new Set([1]); }, /views\[0\]\.note/],
    ['a HOLE in a top-level collection', (m) => { m.views.length += 1; }, /views\[\d+\]/],
    ['an ACCESSOR at the top level', (m) => {
      Object.defineProperty(m, 'coverage', {
        get() { return { read: [], partial: [], skipped: [] }; }, enumerable: true, configurable: true,
      });
    }, /coverage/],
    ['a NON-ENUMERABLE own key that JSON.stringify would drop', (m) => {
      Object.defineProperty(m, 'extractorVersion', { value: 'v9', enumerable: false, configurable: true });
    }, /extractorVersion/],
    ['a CYCLE through a view', (m) => { m.views[0].nodes.push(m.views); }, /circular|cycle/i],
    ['a symbol-keyed own key at the top level', (m) => { m[Symbol('seen')] = 'x'; }, /symbol/i],
    ['an own property on the NODES array that is not an element', (m) => { m.nodes.seen = 'x'; }, /own property on an ARRAY/],
  ];

  for (const [what, mutate, path] of cases) {
    const m = load();
    mutate(m);
    let thrown = null;
    assert.throws(() => computeDrift(m), (e) => { thrown = e.message; return true; },
      `${what}: computeDrift must refuse what it cannot carry, wherever it sits`);
    assert.match(thrown, path, `${what}: the refusal must name the offending path`);

    // …and the two entry points AGREE, which is what makes rule 14 structural rather than a promise:
    // what a consumer refuses, `validate()` reports — never throwing, for the same stated reason.
    const clean = load();
    mutate(clean);
    let res;
    assert.doesNotThrow(() => { res = validate(clean, { repoRoot: REPO_ROOT }); }, `${what}: validate never throws`);
    assert.equal(res.ok, false, `${what}: validate() must refuse what computeDrift refuses`);
  }

  // The unmutated fixture still passes both, so the cases above fail for the reason they name.
  assert.equal(validate(load(), { repoRoot: REPO_ROOT }).ok, true);
  assert.doesNotThrow(() => computeDrift(load()));
});
