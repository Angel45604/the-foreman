import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validate, slugify, deriveNodeId, deriveEdgeId, foldColumnName,
  SUBJECT_KINDS, NODE_KINDS, LANES, VIEW_FORMS, CLAIM_KINDS, EDGE_KINDS, SOURCE_ROLES, MERMAID_TYPES,
  TABLE_COLUMN_KEYS,
} from './validate.mjs';
import { serialize } from './serialize.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../../../..');
const FIXTURE = path.join(HERE, 'fixtures', 'tiny.map.json');
const SH = 'plugin/skills/the-cartographer/references/fixtures/tiny/run.sh';
const MD = 'plugin/skills/the-cartographer/references/fixtures/tiny/SKILL.md';

/**
 * THE ARTIFACT THAT MOTIVATED C-019, read-only and never edited.
 *
 * `tiny.map.json` is where every rule below is exercised, and for the refuted-quote rule that is not
 * quite enough on its own: `tiny`'s biggest node carries TWO claims of ONE kind, while the record the
 * rule exists to catch sits on a node of SIX, spanning three `claimKind`s and three files. The 5e
 * block therefore reaches for run 4's own committed map to exercise the shape it was written for.
 * It is used exactly as `doc-harvest.test.mjs` uses run 3's — DERIVED in memory, so the shape under
 * test is the one that actually shipped rather than a transcription of it, which for a line carrying
 * an em-dash and straight apostrophes is the difference between evidence and a plausible copy.
 *
 * AND IT IS IN THE HOST REPO, NOT IN THE PACKAGE, so the two tests that reach for it SKIP where it is
 * absent. The marketplace ships `./plugin` alone; `docs/initiatives/**` does not travel with it while
 * these `.test.mjs` files do, and a suite that throws `ENOENT` in a standalone install is broken
 * rather than failing. Guarded the way this suite already guards these artifacts —
 * `table-columns.test.mjs` on run 3's map, `docs-contract.test.mjs` on the PDR and the plan — and NOT
 * by vendoring a copy: a second copy of a frozen record inside the package can drift from the record,
 * which would cost exactly the property these two tests exist to buy. Everything the rule itself
 * guarantees is pinned on `tiny` above and below, so what skips is the artifact evidence, never the
 * rule.
 */
const RUN_4 = path.join(
  REPO_ROOT, 'docs', 'initiatives', '2026-08-11-the-cartographer', 'run-4-candidate', 'map.json',
);
const loadRun4 = () => JSON.parse(fs.readFileSync(RUN_4, 'utf8'));
const run4Present = fs.existsSync(RUN_4);
const NO_DOCS = 'the initiative docs are not present in this checkout';

const load = () => JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
const nodeOf = (m, id) => m.nodes.find((n) => n.id === id);
const run = (m, opts = { repoRoot: REPO_ROOT }) => validate(m, opts);
const errText = (m, opts) => run(m, opts).errors.join('\n');

function tmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'carto-'));
  return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

// ─── closed sets ──────────────────────────────────────────────────────────────────────────────────

test('closed sets are exported exactly as the contract names them', () => {
  assert.deepEqual(SUBJECT_KINDS, ['skill', 'feature', 'codebase']);
  assert.deepEqual(NODE_KINDS, ['mode', 'flag', 'env', 'outcome', 'artifact', 'component', 'external', 'state']);
  assert.deepEqual(LANES, ['entry', 'core', 'output', 'external']);
  assert.deepEqual(VIEW_FORMS, ['svg-hero', 'mermaid', 'table']);
  assert.deepEqual(CLAIM_KINDS, ['doc', 'code-comment', 'user-message']);
  assert.deepEqual(EDGE_KINDS, ['control', 'data', 'doc']);
  assert.deepEqual(SOURCE_ROLES, ['code', 'doc']);
  assert.deepEqual(MERMAID_TYPES, ['flowchart', 'stateDiagram-v2']);
});

// ─── 1 · the fixture ──────────────────────────────────────────────────────────────────────────────

test('1 · the fixture validates with zero errors', () => {
  const res = run(load());
  assert.deepEqual(res.errors, []);
  assert.equal(res.ok, true);
  assert.equal(res.containmentChecked, true);
  assert.deepEqual(res.warnings, []);
});

test('1 · the fixture plants FOUR drift cases and one clean node (plan Task 2; four, not three)', () => {
  const m = load();
  const docClaims = (n) => (n.claims ?? []).filter((c) => c.claimKind === 'doc');
  const phantom = m.nodes.filter((n) => !n.inferred && docClaims(n).length > 0 && n.evidence.length === 0);
  const undocumented = m.nodes.filter((n) => !n.inferred && n.evidence.length > 0 && docClaims(n).length === 0);
  const staleNodes = m.nodes.filter((n) => (n.contradictions ?? []).length > 0);
  assert.deepEqual(phantom.map((n) => n.id), ['mode.build']);
  assert.deepEqual(undocumented.map((n) => n.id), ['env.tiny_debug']);
  assert.equal(staleNodes.length, 2, 'two STALE cases');
  const staleClaimKinds = staleNodes.flatMap((n) => n.contradictions.map((c) => {
    const match = n.claims.find((cl) => cl.path === c.claim.path && cl.line === c.claim.line);
    return match.claimKind;
  })).sort();
  // ADR C-014 narrows the DOCUMENTATION test only; STALE stays claim-kind agnostic. The real STALE
  // findings on `codex-gate` are a message and a comment: the oracle's one retained STALE is the
  // user-message at `:519`, and the verified `code-comment` STALE at `:2124` was found BY the
  // extractor — a recorded defect, not a held-out oracle member (the oracle's second STALE was
  // retired by owner decision on 2026-08-13, ADR C-012 amendment). So the fixture must span more
  // than one claimKind, not just `doc`.
  assert.deepEqual(staleClaimKinds, ['code-comment', 'doc']);
  const clean = m.nodes.filter((n) => !n.inferred && n.evidence.length > 0
    && docClaims(n).length > 0 && (n.contradictions ?? []).length === 0);
  assert.deepEqual(clean.map((n) => n.id), ['component.tiny_core']);
  const overview = m.views.find((v) => v.id === 'overview');
  for (const n of [...phantom, ...undocumented, ...staleNodes]) {
    assert.ok(overview.nodes.includes(n.id), `${n.id} must be drawn on the overview (PDR §6.2)`);
  }
});

test('1 · the fixture embeds NO derived drift — findings live in drift.json (ADR C-004)', () => {
  // map.json holds only extraction. An `attrs.drift` label is a DERIVED audit result, and embedding
  // it creates a second drift representation that can disagree with the one diff.mjs computes.
  for (const n of load().nodes) {
    assert.ok(!('drift' in (n.attrs ?? {})), `${n.id}: map.json must not carry a derived drift verdict`);
  }
});

test('1 · the validator REJECTS an embedded drift verdict (ADR C-004 enforced, not just observed)', () => {
  const m = load();
  nodeOf(m, 'mode.build').attrs = { drift: 'phantom' };
  assert.match(errText(m), /drift/i);
  assert.equal(run(m).ok, false);
});

test('1 · the drift ban holds at EVERY path a verdict could occupy, not just nodes[].attrs.drift', () => {
  // FAIL-OPEN: the ban was checked at exactly one location, so a TOP-LEVEL `drift` payload — or one
  // on the subject, an edge, a view, or nested deeper inside attrs — validated and would serialize
  // straight into map.json, recreating the second drift representation C-004 exists to prevent.
  const sites = [
    ['top-level', (m) => { m.drift = { phantom: ['mode.build'] }; }, /^drift:/m],
    ['subject', (m) => { m.subject.drift = 'clean'; }, /subject\.drift:/],
    ['a node', (m) => { nodeOf(m, 'mode.build').drift = 'phantom'; }, /nodes\[\d+\]\.drift:/],
    ['an edge', (m) => { m.edges[0].drift = 'structural'; }, /edges\[0\]\.drift:/],
    ['a view', (m) => { m.views[0].drift = { count: 4 }; }, /views\[0\]\.drift:/],
    ['coverage', (m) => { m.coverage.drift = []; }, /coverage\.drift:/],
    ['nested inside attrs', (m) => { nodeOf(m, 'mode.build').attrs = { audit: { drift: 'stale' } }; },
      /nodes\[\d+\]\.attrs\.audit\.drift:/],
  ];
  for (const [where, mutate, re] of sites) {
    const m = load();
    mutate(m);
    const res = run(m);
    assert.equal(res.ok, false, `${where}: an embedded drift verdict must be rejected`);
    const text = res.errors.join('\n');
    assert.match(text, re, `${where}: the error must name the offending path`);
    assert.match(text, /C-004/, `${where}: the error must cite ADR C-004`);
  }
});

// ─── 1b · top-level required fields ───────────────────────────────────────────────────────────────

test('1b · schemaVersion, extractorVersion and every subject field are required', () => {
  for (const [mutate, re] of [
    [(m) => { delete m.schemaVersion; }, /schemaVersion/],
    [(m) => { m.schemaVersion = 1; }, /schemaVersion/],
    [(m) => { m.schemaVersion = '2'; }, /schemaVersion/],
    [(m) => { delete m.extractorVersion; }, /extractorVersion/],
    [(m) => { m.extractorVersion = ''; }, /extractorVersion/],
    [(m) => { delete m.subject; }, /subject/],
    [(m) => { delete m.subject.slug; }, /subject\.slug/],
    [(m) => { m.subject.root = ''; }, /subject\.root/],
    [(m) => { delete m.subject.title; }, /subject\.title/],
    [(m) => { delete m.subject.summary; }, /subject\.summary/],
    [(m) => { m.subject.kind = 'plugin'; }, /subject\.kind/],
  ]) {
    const m = load();
    mutate(m);
    assert.match(errText(m), re);
  }
});

// ─── 2 · absent collections fail closed ───────────────────────────────────────────────────────────

test('2 · an ABSENT collection is a violation, never an empty default', () => {
  for (const [key, re] of [
    ['sources', /sources/], ['nodes', /nodes/], ['edges', /edges/], ['views', /views/],
  ]) {
    const m = load();
    delete m[key];
    assert.match(errText(m), re);
  }
  for (const key of ['read', 'partial', 'skipped']) {
    const m = load();
    delete m.coverage[key];
    assert.match(errText(m), new RegExp(`coverage\\.${key}`));
  }
  const noCoverage = load();
  delete noCoverage.coverage;
  assert.match(errText(noCoverage), /coverage/);
});

// ─── 3 · closed-set enforcement ───────────────────────────────────────────────────────────────────

test('3 · rejects any value outside a closed set', () => {
  const cases = [
    [(m) => { nodeOf(m, 'mode.build').kind = 'macro'; }, /kind/],
    [(m) => { nodeOf(m, 'mode.build').lane = 'middle'; }, /lane/],
    [(m) => { nodeOf(m, 'mode.build').claims[0].claimKind = 'readme'; }, /claimKind/],
    [(m) => { m.edges[0].kind = 'sideways'; }, /kind/],
    [(m) => { m.sources[0].role = 'config'; }, /role/],
    [(m) => { m.views[0].form = 'graphviz'; }, /form/],
    [(m) => { m.views.find((v) => v.form === 'mermaid').mermaidType = 'gantt'; }, /mermaidType/],
  ];
  for (const [mutate, re] of cases) {
    const m = load();
    mutate(m);
    assert.match(errText(m), re);
  }
});

// ─── 4 · source integrity ─────────────────────────────────────────────────────────────────────────

test('4 · requires a full 64-char hex sha256, an integer lines, and unique source paths', () => {
  const short = load();
  short.sources[0].sha256 = short.sources[0].sha256.slice(0, 12);
  assert.match(errText(short), /sha256/);

  const nonHex = load();
  nonHex.sources[0].sha256 = 'z'.repeat(64);
  assert.match(errText(nonHex), /sha256/);

  const floatLines = load();
  floatLines.sources[0].lines = 24.5;
  assert.match(errText(floatLines), /lines/);

  const dup = load();
  dup.sources.push({ ...dup.sources[0] });
  assert.match(errText(dup), /duplicate/i);
});

// ─── 5 · citation provenance ──────────────────────────────────────────────────────────────────────

test('5 · every citation site needs a positive integer line, a declared path, and an in-range line', () => {
  const sites = [
    ['node evidence', (m) => nodeOf(m, 'outcome.pass').evidence[0]],
    ['node claim', (m) => nodeOf(m, 'mode.build').claims[0]],
    ['contradiction claim', (m) => nodeOf(m, 'mode.check').contradictions[0].claim],
    ['edge evidence', (m) => m.edges[0].evidence[0]],
  ];
  for (const [label, pick] of sites) {
    const zero = load();
    pick(zero).line = 0;
    assert.match(errText(zero), /line/, `${label}: line 0`);

    const negative = load();
    pick(negative).line = -3;
    assert.match(errText(negative), /line/, `${label}: negative line`);

    const fractional = load();
    pick(fractional).line = 3.5;
    assert.match(errText(fractional), /line/, `${label}: fractional line`);

    const past = load();
    pick(past).line = 9999;
    assert.match(errText(past), /line|exceeds/i, `${label}: past end of file`);

    const undeclared = load();
    pick(undeclared).path = 'plugin/skills/the-cartographer/references/fixtures/tiny/nope.sh';
    assert.match(errText(undeclared), /sources|declared/i, `${label}: undeclared path`);
  }
});

// ─── 5b · path containment (SPEC DEFECT 1 + 6) ────────────────────────────────────────────────────

test('5b · syntactic path rules are enforced with or without a repoRoot', () => {
  const bad = [
    ['/etc/passwd', /absolute|relative/i],
    ['C:/windows/system32', /drive|relative/i],
    ['..\\escape', /backslash|relative/i],
    ['../outside/run.sh', /\.\./],
    ['plugin/../plugin/skills/x.sh', /\.\./],
    ['./run.sh', /normalized|\./],
    ['plugin//run.sh', /empty segment|normalized/i],
    ['.maps/codex-gate/map.json', /\.maps/],
    ['plugin/.maps/x.json', /\.maps/],
  ];
  for (const [p, re] of bad) {
    const m = load();
    m.sources[0].path = p;
    const withRoot = errText(m);
    const withoutRoot = validate(m, {}).errors.join('\n');
    assert.match(withRoot, re, `${p} with repoRoot`);
    assert.match(withoutRoot, re, `${p} without repoRoot — syntax needs no filesystem`);
  }
});

test('5b · a symlink escaping repoRoot is rejected — and WITHOUT repoRoot the check is SKIPPED, visibly', () => {
  const { dir, cleanup } = tmpRepo();
  try {
    const root = path.join(dir, 'root');
    const outside = path.join(dir, 'outside');
    fs.mkdirSync(root);
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'evil.sh'), '#!/bin/sh\necho hi\n');
    fs.symlinkSync(path.join(outside, 'evil.sh'), path.join(root, 'link.sh'));

    const m = load();
    // one source only, reachable by a syntactically innocent relative path
    m.sources = [{ path: 'link.sh', sha256: 'a'.repeat(64), lines: 2, role: 'code' }];
    m.coverage.read = ['link.sh'];
    m.nodes = [{
      id: 'mode.only', kind: 'mode', label: 'only', lane: 'entry', summary: 's', inferred: false,
      evidence: [{ path: 'link.sh', line: 2, note: 'echo hi' }], claims: [],
    }];
    m.edges = [];
    m.views = [{ id: 'overview', form: 'svg-hero', title: 'o', nodes: ['mode.only'], edges: [] }];

    const enforced = validate(m, { repoRoot: root });
    assert.equal(enforced.containmentChecked, true);
    assert.match(enforced.errors.join('\n'), /outside|containment/i);
    assert.equal(enforced.ok, false);

    // SPEC DEFECT 1: no repoRoot ⇒ containment is SKIPPED (never a silent cwd fallback), and the
    // skip is visible to the caller.
    const skipped = validate(m);
    assert.equal(skipped.containmentChecked, false);
    assert.deepEqual(skipped.errors, []);
    assert.equal(skipped.ok, true);
    assert.equal(skipped.warnings.length, 1);
    assert.match(skipped.warnings[0], /containment/i);
    assert.match(skipped.warnings[0], /skip/i);
    assert.match(skipped.warnings[0], /repoRoot/);
  } finally {
    cleanup();
  }
});

test('5b · the same path rules apply to CITATION paths, not only to sources[]', () => {
  for (const [p, re] of [['../secrets/run.sh', /\.\./], ['.maps/tiny/map.json', /\.maps/], ['/etc/passwd', /relative/i]]) {
    const m = load();
    nodeOf(m, 'outcome.pass').evidence[0].path = p;
    assert.match(errText(m), re, `node evidence: ${p}`);

    const edge = load();
    edge.edges[0].evidence[0].path = p;
    assert.match(errText(edge), re, `edge evidence: ${p}`);

    const claim = load();
    nodeOf(claim, 'mode.build').claims[0].path = p;
    assert.match(errText(claim), re, `claim: ${p}`);
  }
});

test('5b · a non-existent but contained path is NOT a containment error (freshness reports missing)', () => {
  const m = load();
  m.sources.push({ path: 'plugin/skills/the-cartographer/references/fixtures/tiny/gone.sh', sha256: 'a'.repeat(64), lines: 5, role: 'code' });
  assert.doesNotMatch(errText(m), /containment|outside/i);
});

// ─── 5c · claimKind ↔ source role (SPEC DEFECT 7) ─────────────────────────────────────────────────

test('5c · claimKind must agree with the cited source role (ADR C-014 made real)', () => {
  const docInCode = load();
  // a `doc` claim citing the shell script — the exact move that would suppress an UNDOCUMENTED finding
  nodeOf(docInCode, 'env.tiny_debug').claims[0].claimKind = 'doc';
  assert.match(errText(docInCode), /claimKind|role/i);

  const commentInDoc = load();
  nodeOf(commentInDoc, 'mode.build').claims[0].claimKind = 'code-comment';
  assert.match(errText(commentInDoc), /claimKind|role/i);

  const messageInDoc = load();
  nodeOf(messageInDoc, 'mode.build').claims[0].claimKind = 'user-message';
  assert.match(errText(messageInDoc), /claimKind|role/i);
});

test('5c · evidence must cite a code source — documentation is not behavioural evidence', () => {
  const m = load();
  nodeOf(m, 'outcome.pass').evidence[0] = { path: MD, line: 12, note: 'the doc says so' };
  assert.match(errText(m), /evidence|role/i);

  const edge = load();
  edge.edges[0].evidence[0] = { path: MD, line: 12 };
  assert.match(errText(edge), /evidence|role/i);
});

// ─── 5d · contradiction citations (SPEC DEFECT 8) ─────────────────────────────────────────────────

test("5d · a contradiction's citations must be that node's OWN claim and evidence records", () => {
  const wrongLine = load();
  nodeOf(wrongLine, 'mode.check').contradictions[0].claim.line = 7;
  assert.match(errText(wrongLine), /contradiction/i);

  const wrongText = load();
  nodeOf(wrongText, 'mode.check').contradictions[0].claim.text = 'something else entirely';
  assert.match(errText(wrongText), /contradiction/i);

  const otherNodesEvidence = load();
  nodeOf(otherNodesEvidence, 'mode.check').contradictions[0].evidence = { path: SH, line: 18, note: "printf 'PASS\\n' >&2" };
  assert.match(errText(otherNodesEvidence), /contradiction/i);

  // a citation that is a SUBSET of the node's record (PDR §8 shape: no claimKind) still matches
  const subset = load();
  const n = nodeOf(subset, 'mode.check');
  n.contradictions[0].claim = { path: n.claims[0].path, line: n.claims[0].line, text: n.claims[0].text };
  assert.deepEqual(run(subset).errors, []);
});

test('5d · a STALE record must be AUDITABLE: the claim carries its text and the evidence its note', () => {
  // A contradiction whose citations are bare {path,line} names two locations without ever stating
  // what was asserted or what was observed — the reader cannot audit the finding.
  const noText = load();
  delete nodeOf(noText, 'mode.check').contradictions[0].claim.text;
  assert.match(errText(noText), /text/);
  assert.equal(run(noText).ok, false);

  const noNote = load();
  delete nodeOf(noNote, 'mode.check').contradictions[0].evidence.note;
  assert.match(errText(noNote), /note/);
  assert.equal(run(noNote).ok, false);

  const blankText = load();
  nodeOf(blankText, 'mode.check').contradictions[0].claim.text = '   ';
  assert.match(errText(blankText), /text/);
});

// ─── 5e · a contradiction must name the claim it REFUTES (the run-4 defect) ───────────────────────
//
// RUN 4, reproduced on the fixture. `outcome.pass` carries TWO claims, and only one of them is wrong:
//
//   claims[0]   SKILL.md:12   "`PASS` is emitted when the core routine succeeds."   ACCURATE
//   claims[1]   run.sh:16     "# emits PASS on stdout"                              STALE
//
// The evidence — `printf 'PASS\n' >&2` at run.sh:18 — refutes "on stdout", which is claims[1]. Point
// the record's `claim` at claims[0] instead and EVERY pre-existing rule still passes: both citations
// resolve to declared sources, both deep-match one of this node's own records, both carry their
// quote, and the statement is true. Only the POINTER is wrong — and `drift.json` then sends a
// maintainer to "fix" an accurate line while the stale one stays on the node, unaccused.
//
// That is a DISTINCT failure from a wrong verdict: the finding is right and the citation is wrong. It
// is what run 4 shipped on `mode.prepr`, where the record named the accurate `README.md:97` while the
// genuinely stale `user-message` at `codex-gate.sh:519` sat on the same node, uncited.

test('5e · refutedQuote is REQUIRED — a record that never says WHICH text is wrong cannot be checked at all', () => {
  const m = load();
  delete nodeOf(m, 'outcome.pass').contradictions[0].refutedQuote;
  assert.match(errText(m), /refutedQuote/);
  assert.equal(run(m).ok, false);

  const blank = load();
  nodeOf(blank, 'outcome.pass').contradictions[0].refutedQuote = '   ';
  assert.match(errText(blank), /refutedQuote/);

  // …AND IT IS THE ABSENT-FIELD BRANCH, named as such. `refutedQuote` fails two ways and `diff.mjs`
  // treats them OPPOSITELY: an ABSENT field is passed through untouched, so a frozen pre-C-019 map
  // keeps its STALE findings, while a PRESENT field inconsistent with the claim it names fails closed
  // and REFUSES the record — which deletes a finding from `drift.json`. A test that only matched
  // "some error mentioning refutedQuote" cannot tell those two apart, and would go on passing if the
  // two messages were merged or the branches swapped.
  //
  // WHY IT IS PINNED HERE, on the shipped fixture. `doc-harvest.test.mjs`'s `2c` pins the same
  // distinction against run 4's frozen artifact, and that artifact lives in `docs/` — absent in a
  // standalone install, where the pin can only skip. This is the half that travels with the package.
  for (const [what, absent] of [['deleted', m], ['blank', blank]]) {
    const errors = run(absent).errors.filter((e) => /refutedQuote/.test(e));
    assert.equal(errors.length, 1, `${what}: expected exactly one refutedQuote error, got ${JSON.stringify(errors)}`);
    assert.match(errors[0], /\.refutedQuote: is REQUIRED/,
      `${what}: the required-and-missing branch must say so — that is what "pre-C-019" names`);
    assert.ok(!/does not appear in/.test(errors[0]),
      `${what}: and it is NOT the inconsistent-quote branch, which fails closed in diff.mjs and costs a finding`);
  }
});

test('5e · a contradiction pointing at an ACCURATE claim is REFUSED, and the error names where the refuted text really sits', () => {
  const misdirected = load();
  const pass = nodeOf(misdirected, 'outcome.pass');
  const record = pass.contradictions[0];
  record.refutedQuote = 'on stdout';
  record.claim = { ...pass.claims[0] }; // the ACCURATE doc claim — still one of this node's OWN claims

  const errors = run(misdirected).errors.join('\n');
  assert.equal(run(misdirected).ok, false,
    'a contradiction whose evidence refutes a DIFFERENT claim than the one it cites must not validate');
  assert.match(errors, /refutedQuote/);
  // The diagnostic that makes the fix mechanical rather than a re-read: the validator can see that the
  // refuted text sits in another of this node's claims, and must say which.
  assert.match(errors, /run\.sh:16/,
    'the error must name the claim that actually carries the refuted text, or the fix is a guess');
});

test('5e · a quote that is on NO claim of the node gets the OTHER diagnostic — the two branches may not blur', () => {
  // THE SECOND HALF OF THE SAME REFUSAL, and the half nothing above reaches. The test before this one
  // covers ONE of the two shapes a bad pointer takes — the refuted text sits on a DIFFERENT claim of
  // this node, so the validator can name that claim and the fix is mechanical. This is the other:
  // the quote occurs in NO claim here at all, so there is nothing to redirect the author TO.
  //
  // The distinction is not cosmetic, and it is the whole reason the message forks. "Cite THAT claim
  // instead" is an INSTRUCTION, and issuing it when no such claim exists sends the author looking for
  // a line the node does not carry. What is actually known in this branch is weaker and must be said
  // as such: either the quote was mistyped or paraphrased, or the record is on the wrong node — the
  // validator cannot tell which, and says so rather than inventing a destination.
  //
  // WHAT BREAKS WITHOUT THIS TEST. The `elsewhere.length === 0` arm of that ternary was reachable from
  // no test in this suite: the sibling above passes with the branch forced ON for every input, because
  // its own quote IS on a second claim. So the fork could collapse in either direction — an empty
  // "in the claim at  —" naming nowhere, or the honest sentence deleted — and every test stayed green.
  const nowhere = load();
  const pass = nodeOf(nowhere, 'outcome.pass');
  // "to stderr" is what the evidence OBSERVES, not what any claim ASSERTS: `outcome.pass` says
  // "on stdout" at run.sh:16 and says nothing at all about stderr. A record quoting the observation
  // instead of the assertion is the ordinary way this branch is reached in practice.
  pass.contradictions[0].refutedQuote = 'to stderr';

  const res = run(nowhere);
  assert.equal(res.ok, false, 'a quote no claim on the node carries cannot be checked, so it is refused');
  assert.equal(res.errors.length, 1, `expected exactly one error, got ${JSON.stringify(res.errors)}`);
  const [error] = res.errors;
  assert.match(error, /refutedQuote/);
  assert.match(error, /so either the quote or the citation is wrong/,
    'the message must state what is actually known — one of the two sides is wrong, and which is not derivable here');
  // …and it must NOT hand out the redirection the other branch owns. Both halves are load-bearing:
  // the first catches the sentence going missing, the second catches the branches being merged.
  assert.ok(!/That text IS on this node/.test(error),
    'the node does not carry that text anywhere — claiming it does would send the author to a line that does not exist');
  assert.ok(!/in the claim at/.test(error),
    `the error must name no claim at all, not an empty one (got ${JSON.stringify(error)})`);
});

test('5e · when SEVERAL claims carry the refuted text the error names EVERY one of them, not the first', () => {
  // The same stale sentence in two places is the ordinary case, not the exotic one: a comment gets
  // copied to a second helper, or a doc line is repeated in a summary section. The error then has more
  // than one candidate to redirect the author to, and naming only the first is a HALF fix — the author
  // corrects run.sh:16, re-runs, and the record is still misdirected at whichever copy went unnamed.
  //
  // WHAT BREAKS WITHOUT THIS TEST. `elsewhere` is a list and the message joins it, but every existing
  // case produces a one-element list, where `join` is indistinguishable from "print the only one".
  // `elsewhere[0]`, `elsewhere.slice(0, 1)`, or a different separator all read as correct against a
  // single match, so the plural path — the one that makes the field a list at all — was unasserted.
  const twice = load();
  const pass = nodeOf(twice, 'outcome.pass');
  // A THIRD claim on the node, repeating the stale assertion the fixture already carries at run.sh:16.
  // `run.sh:20` CARRIES this comment verbatim. It used to be a BLANK line, and the justification here
  // read "the source is 24 lines long, so :20 is a real line of it" — which proves the line exists and
  // not that it says this. A record citing text a line does not carry is the attestation gap C-018
  // says validation cannot see, and a test exploiting it teaches the shape (round-7 gate).
  pass.claims.push({
    checked: true,
    claimKind: 'code-comment',
    line: 20,
    path: SH,
    text: '# emit_pass: announces PASS on stdout for the caller',
  });
  const record = pass.contradictions[0];
  record.refutedQuote = 'on stdout';
  record.claim = { ...pass.claims[0] }; // the ACCURATE doc claim, as in the misdirection above

  const res = run(twice);
  assert.equal(res.ok, false);
  assert.equal(res.errors.length, 1, `expected exactly one error, got ${JSON.stringify(res.errors)}`);
  const [error] = res.errors;
  // Asserted as ONE substring rather than two matches, because that is what pins the SEPARATOR as
  // well as the membership: a comma-joined list is what a reader can act on line by line.
  assert.ok(error.includes(`${SH}:16, ${SH}:20`),
    `both claims carrying the refuted text must be named, comma-joined (got ${JSON.stringify(error)})`);
  // …in the order the node declares them, so two runs of the same map produce the same error text.
  assert.ok(error.indexOf(`${SH}:16`) < error.indexOf(`${SH}:20`),
    'the claims are named in claims[] order — a set-ordered message would churn between runs');
});

test('5e · a correctly-wired contradiction still validates — the rule may not make a genuine finding harder to record', () => {
  const m = load();
  assert.deepEqual(run(m).errors, [], 'the fixture wires both of its contradictions at the refuted claim');

  const pass = nodeOf(m, 'outcome.pass');
  assert.equal(pass.contradictions[0].refutedQuote, 'on stdout');
  assert.ok(pass.claims[0].text.includes('emitted when the core routine succeeds'),
    'precondition: the node also carries an ACCURATE claim, so the misdirection above was reachable');
  assert.equal(pass.contradictions[0].claim.line, 16,
    'and the record cites the STALE claim at run.sh:16, not the accurate one at SKILL.md:12');

  // A quote spanning the whole claim text is legal too — some claims are wrong end to end.
  const whole = load();
  const check = nodeOf(whole, 'mode.check');
  check.contradictions[0].refutedQuote = check.claims[0].text;
  assert.deepEqual(run(whole).errors, []);
});

// ─── 5e · …and the same rule against the record that caused it ────────────────────────────────────
//
// Everything above runs on `tiny`, whose worst node carries TWO claims of ONE kind in ONE file. The
// defect C-019 exists for did not have that shape: `mode.prepr` in `run-4-candidate/map.json` carries
// SIX claims spanning `doc`, `code-comment` and `user-message` across three files, and the misdirected
// pointer and the genuinely stale claim are four apart in the list —
//
//   claims[0]   README.md:97        doc            "…`prepr-delta` … like `prepr` …"      ACCURATE, CITED
//   claims[4]   codex-gate.sh:519   user-message   "…use 'prepr --since-reviewed'…"       STALE, uncited
//
// — which is precisely the distance a rule can be correct on a two-claim fixture and wrong on. So the
// rule is exercised once against the artifact itself, not only against the reproduction of it.

test("5e · run 4's OWN record: give it the field C-019 requires and the validator names codex-gate.sh:519", (t) => {
  if (!run4Present) return t.skip(NO_DOCS);
  const map = loadRun4();
  const prepr = nodeOf(map, 'mode.prepr');
  assert.ok(prepr, 'fixture precondition: the frozen map must still carry mode.prepr');

  // THE SHAPE, asserted rather than assumed — this is the whole reason the test reaches past `tiny`,
  // so if the frozen record ever stopped having it the test must say so instead of quietly proving
  // something smaller.
  assert.equal(prepr.claims.length, 6, 'the node the rule was written for carries SIX claims');
  assert.deepEqual([...new Set(prepr.claims.map((c) => c.claimKind))].sort(),
    ['code-comment', 'doc', 'user-message'],
    'spanning all three claim kinds — a shape `tiny` cannot reach');
  const stale = prepr.claims[4];
  assert.equal(`${stale.path}:${stale.line}`, 'plugin/skills/codex-gate/codex-gate.sh:519');
  assert.equal(stale.claimKind, 'user-message');
  assert.equal(prepr.contradictions.length, 1);
  const record = prepr.contradictions[0];
  assert.equal(record.claim.path, 'plugin/skills/codex-gate/README.md');
  assert.equal(record.claim.line, 97, 'the record cites the ACCURATE doc line — that IS the defect');
  assert.ok(!('refutedQuote' in record),
    'and it predates C-019, so the field is absent (pinned as a frozen fact in doc-harvest.test.mjs)');
  assert.equal(run(map).errors.length, 1,
    'precondition: that missing field is the map\'s ONE error, so the count below is exact');

  // Now supply the field HONESTLY — the fragment the evidence at codex-gate.sh:1412 actually refutes,
  // read verbatim off the stale claim. Nothing else about the record changes.
  record.refutedQuote = 'prepr --since-reviewed';
  assert.ok(stale.text.includes(record.refutedQuote),
    'precondition: the quote is a verbatim fragment of the STALE claim');
  assert.ok(!record.claim.text.includes(record.refutedQuote),
    'and not of the accurate one the record cites — which is what the rule must detect');

  const res = run(map);
  assert.equal(res.ok, false,
    'the one honest answer to "what does the evidence refute?" convicts the pointer immediately');
  assert.equal(res.errors.length, 1, `expected exactly one error, got ${JSON.stringify(res.errors)}`);
  // Asserted as one substring, so the elsewhere list is pinned to EXACTLY this claim: a message
  // naming :519 plus something else would not be the mechanical fix it advertises.
  const named = 'in the claim at plugin/skills/codex-gate/codex-gate.sh:519 — cite THAT claim';
  assert.ok(res.errors[0].includes(named),
    `the error must send the maintainer to the stale user-message (got ${JSON.stringify(res.errors[0])})`);
});

test('5e · RECORDED LIMIT, not an endorsement: a fragment short enough to sit everywhere still passes', (t) => {
  if (!run4Present) return t.skip(NO_DOCS);
  // THE RESIDUE THE ADR ADMITS, made VISIBLE. `quotesFragment` asks one question — does the quote
  // occur in the cited claim's text — and a fragment common to several claims answers YES on all of
  // them. The rule is therefore satisfiable by a quote that discriminates nothing, and on run 4's own
  // node the cheapest such quote is the mode name itself.
  //
  // WHY PIN A HOLE. A limitation nobody can point at gets rediscovered as a bug, argued about, and
  // "fixed" by loosening something else. Written down as a test, it is a fact with a location: this is
  // exactly how far the mechanical check reaches, the frozen record used here is exactly what slips
  // through it, and any future tightening — a minimum informative length, or requiring the quote to
  // occur in ONE claim only — changes this test deliberately rather than discovering it by surprise.
  //
  // THIS TEST ENDORSES NOTHING. It asserts what the validator DOES, not what an author MAY write. A
  // record whose `refutedQuote` cannot single out the claim it refutes is a bad record; it is simply
  // not a record this rule can refuse, and C-019 never claimed otherwise.
  const map = loadRun4();
  const prepr = nodeOf(map, 'mode.prepr');
  const record = prepr.contradictions[0];

  // The fragment carries no information: it is in the ACCURATE claim the record cites AND in the
  // STALE one it should have cited, so it cannot tell the two apart — which is the entire hole.
  const bareModeName = 'prepr';
  assert.ok(record.claim.text.includes('`prepr`'), 'the cited ACCURATE claim mentions the mode…');
  assert.ok(prepr.claims[4].text.includes(bareModeName), '…and so does the STALE one it should have cited');

  record.refutedQuote = bareModeName;
  const res = run(map);
  assert.deepEqual(res.errors, [],
    'RECORDED LIMIT: the misdirected pointer this map ships validates CLEAN under a quote that '
    + 'discriminates nothing — the letter of C-019 is satisfied and its purpose is not');
  assert.equal(res.ok, true);
});

// ─── 6/7/8 · node and claim payload ───────────────────────────────────────────────────────────────

test('6 · node payload: derived id, label, summary, boolean inferred, evidence/claims arrays', () => {
  for (const [mutate, re] of [
    [(m) => { nodeOf(m, 'mode.build').id = 'build'; }, /id/],
    [(m) => { nodeOf(m, 'mode.build').label = ''; }, /label/],
    [(m) => { delete nodeOf(m, 'mode.build').summary; }, /summary/],
    [(m) => { nodeOf(m, 'mode.build').inferred = 'no'; }, /inferred/],
    [(m) => { delete nodeOf(m, 'mode.build').evidence; }, /evidence/],
    [(m) => { delete nodeOf(m, 'mode.build').claims; }, /claims/],
  ]) {
    const m = load();
    mutate(m);
    assert.match(errText(m), re);
  }
});

test('7 · a claim requires claimKind (REQUIRED, not optional) and text; checked must be boolean', () => {
  // SPEC DEFECT 2: a missing claimKind must be an ERROR, never a silent default to "doc" —
  // defaulting would let any claim pose as documentation and bypass ADR C-014.
  const missing = load();
  delete nodeOf(missing, 'mode.build').claims[0].claimKind;
  assert.match(errText(missing), /claimKind/);
  assert.equal(run(missing).ok, false);

  const noText = load();
  delete nodeOf(noText, 'mode.build').claims[0].text;
  assert.match(errText(noText), /text/);

  const badChecked = load();
  nodeOf(badChecked, 'mode.build').claims[0].checked = 'yes';
  assert.match(errText(badChecked), /checked/);
});

test('8 · a contradiction requires BOTH citations plus a non-empty statement (ADR C-005)', () => {
  for (const [mutate, re] of [
    [(m) => { delete nodeOf(m, 'mode.check').contradictions[0].claim; }, /claim/],
    [(m) => { delete nodeOf(m, 'mode.check').contradictions[0].evidence; }, /evidence/],
    [(m) => { nodeOf(m, 'mode.check').contradictions[0].statement = '  '; }, /statement/],
    [(m) => { delete nodeOf(m, 'mode.check').contradictions[0].statement; }, /statement/],
  ]) {
    const m = load();
    mutate(m);
    assert.match(errText(m), re);
  }
});

// ─── 9/10/11 · edges and views ────────────────────────────────────────────────────────────────────

test('9 · views reject unknown node/edge references and dangling edges', () => {
  const unknownNode = load();
  unknownNode.views.find((v) => v.id === 'overview').nodes.push('mode.ghost');
  assert.match(errText(unknownNode), /mode\.ghost/);

  const unknownEdge = load();
  unknownEdge.views.find((v) => v.id === 'overview').edges.push('e.control.a>b');
  assert.match(errText(unknownEdge), /e\.control\.a>b/);

  const dangling = load();
  const cf = dangling.views.find((v) => v.id === 'control-flow');
  cf.nodes = cf.nodes.filter((n) => n !== 'outcome.pass');
  assert.match(errText(dangling), /dangl|endpoint/i);
});

test('9b · a view may not name the same node or edge TWICE (PDR §7.1 rule 14)', () => {
  // A view's reference lists are SETS, not bags: one id listed twice is one box or one arrow drawn
  // twice. This lives here rather than only at the render boundary because ADR C-006 makes this file
  // the single executable IR contract — and because leaving it to the renderers meant they did not
  // even agree with EACH OTHER about a map this validator called legal (the hero refuses the
  // duplicate box; mermaid quietly emits the declaration a second time).
  const nodeTwice = load();
  nodeTwice.views.find((v) => v.id === 'overview').nodes.push('mode.check');
  assert.match(errText(nodeTwice), /duplicate/i);
  assert.match(errText(nodeTwice), /mode\.check/, 'the error must name the id that was listed twice');

  const edgeTwice = load();
  const overview = edgeTwice.views.find((v) => v.id === 'overview');
  overview.edges.push(overview.edges[0]);
  assert.match(errText(edgeTwice), /duplicate/i);
  assert.match(errText(edgeTwice), /e\.control\.mode\.check>component\.tiny_core/);

  // A TABLE view is a list of rows and repeats a row for no better reason, so the rule is not a
  // graph-view rule: it is a rule about what a reference LIST means anywhere in the IR.
  const tableTwice = load();
  tableTwice.views.find((v) => v.form === 'table').nodes.push('mode.check');
  assert.match(errText(tableTwice), /duplicate/i);

  // …and that holds for the EDGE list too. The whole edge-reference block used to run inside
  // `if (isGraph)`, so a table view carrying one edge id twice — or an edge id that resolves to
  // nothing, or one whose endpoint the view never lists — validated clean while `resolveView`
  // refused it: `pick()` and the dangling check run for every form. PDR §7.1 rule 14 states the
  // rule for "a `table` view as much as a graph one", so the validator applies it to every form.
  const withEdges = (mutate) => {
    const m = load();
    const table = m.views.find((v) => v.form === 'table');
    table.nodes.push('component.tiny_core');
    mutate(table);
    return m;
  };
  const real = 'e.control.mode.check>component.tiny_core';

  const tableEdgeTwice = withEdges((t) => { t.edges = [real, real]; });
  assert.match(errText(tableEdgeTwice), /duplicate/i);
  assert.match(errText(tableEdgeTwice), /e\.control\.mode\.check>component\.tiny_core/);

  const tableEdgeUnknown = withEdges((t) => { t.edges = ['e.control.a>b']; });
  assert.match(errText(tableEdgeUnknown), /unknown edge id/i);

  const tableEdgeDangling = withEdges((t) => { t.edges = ['e.control.mode.check>outcome.pass']; });
  assert.match(errText(tableEdgeDangling), /dangl/i);

  // A table view carrying a WELL-FORMED edge list is not itself an error — the rule is about the
  // list's semantics, not about which forms may own one.
  assert.equal(validate(withEdges((t) => { t.edges = [real]; })).ok, true);

  // …and a table view with NO edges key at all stays legal: it carries none by contract, so
  // "possibly empty, never absent" is a GRAPH-view requirement and must not leak onto this one.
  assert.equal(validate(load()).ok, true);

  // …and the fixture itself, which names each reference once, stays valid.
  assert.equal(validate(load()).ok, true);
});

test('9c · a table view may OMIT edges — but a key that is PRESENT must be an array (rule 7 + 14)', () => {
  // ABSENT and PRESENT-BUT-NOT-A-LIST are different acts, and only the first is a table view's
  // privilege. The array check ran inside the same `if (isGraph)` that reported the absent one, so
  // `edges: null` on a table view validated clean while `resolveView` — which asks every form for
  // an array the moment the key is there — threw `.edges must be an array`. Same class as 9b, one
  // level up: not what the list NAMES, but whether it is a list at all.
  const tableWith = (value) => {
    const m = load();
    const table = m.views.find((v) => v.form === 'table');
    table.edges = value;
    return m;
  };
  for (const bad of [null, {}, 'e.control.mode.check>component.tiny_core', 3, true]) {
    const result = run(tableWith(bad));
    assert.equal(result.ok, false, `a table view with edges: ${JSON.stringify(bad)} must be refused`);
    assert.match(result.errors.join('\n'), /edges: if present must be an array/,
      `edges: ${JSON.stringify(bad)} must be reported as a shape violation`);
  }

  // An own `edges: undefined` is a VIOLATION, not the absent key. It used to be read as absent here,
  // on the grounds that JSON.stringify drops it and leaves behind exactly the absent `edges` a table
  // view may carry — while rule 11 called an own `attrs: undefined` a violation on the grounds that
  // the map validated is then not the map written. Both cannot be right: `attrs` and `edges` are both
  // OPTIONAL keys, so the two rules said opposite things about the same act. The ingest boundary
  // settles it once, in the fail-closed direction rule 11 already took: an own property whose value is
  // `undefined` is not JSON data anywhere in the IR. Say nothing, or say `null`.
  const ownUndefined = run(tableWith(undefined));
  assert.equal(ownUndefined.ok, false, 'an own edges: undefined is a key that vanishes, not an omission');
  assert.match(ownUndefined.errors.join('\n'), /edges/);
  assert.match(ownUndefined.errors.join('\n'), /undefined/i);

  // …while an INHERITED one really is absent: there is no own descriptor, so it is in no copy, no
  // renderer ever sees it, and the file will not carry it either.
  const inherited = load();
  const table = inherited.views.find((v) => v.form === 'table');
  inherited.views = inherited.views.map((v) => (v === table
    ? Object.assign(Object.create({ edges: null }), v) : v));
  assert.equal(run(inherited).ok, true, 'an INHERITED edges is absent to the render boundary, so it is absent here');

  // …and a graph view is unchanged: it still REQUIRES the array, absent or undefined alike.
  const graph = load();
  delete graph.views.find((v) => v.id === 'overview').edges;
  assert.match(errText(graph), /a graph view requires an edges array/);
});

test('10 · a table view needs columns; a mermaid view needs mermaidType; neither may carry the other', () => {
  const noCols = load();
  delete noCols.views.find((v) => v.form === 'table').columns;
  assert.match(errText(noCols), /columns/);

  const noType = load();
  delete noType.views.find((v) => v.form === 'mermaid').mermaidType;
  assert.match(errText(noType), /mermaidType/);

  const strayType = load();
  noType.views.find((v) => v.form === 'table');
  strayType.views.find((v) => v.form === 'table').mermaidType = 'flowchart';
  assert.match(errText(strayType), /mermaidType/);

  const strayCols = load();
  strayCols.views.find((v) => v.form === 'svg-hero').columns = ['a'];
  assert.match(errText(strayCols), /columns/);
});

// ─── 10b · the table-column vocabulary is CLOSED (the silently-empty column) ───────────────────────
//
// A column is not a caption: no renderer can invent a value for a name it has no derivation for, so
// a column outside the vocabulary fills EVERY row with `(no value for this column)`. That is the
// worst failure this tool can have — the page looks complete and says nothing — and it is exactly
// what run 3 shipped: `"What it does"` folds to `whatitdoes`, which neither renderer derives, so 125
// of 125 rows were placeholders and nothing objected.
//
// The rule belongs HERE and nowhere else (ADR C-006): "which columns are derivable" is part of what
// a legal map is, and a check that lives in a renderer is a second contract that drifts. The error
// teaches the vocabulary, so an extractor that hits it does not have to go read a source file to
// learn what it may have written instead — which is the only reason a CLOSED set is kinder than an
// alias: the next natural name (`Purpose`, `Role`, `What it is`) would fail identically and
// silently, and no list of aliases ever catches up with prose.

test('10b · a table column NO renderer can derive is refused, and the error teaches the vocabulary', () => {
  const m = load();
  m.views.find((v) => v.form === 'table').columns = ['Capability', 'What it does'];
  const res = run(m);

  assert.equal(res.ok, false,
    'a column that renders `(no value for this column)` in every row is not a legal map — the page '
    + 'would look complete and convey nothing');

  const text = res.errors.join('\n');
  assert.match(text, /What it does/, 'the error must NAME the offending column');
  assert.match(text, /views\[\d+\]\.columns\[1\]/, 'and the path it sits at');
  for (const key of TABLE_COLUMN_KEYS) {
    assert.ok(text.includes(key),
      `the error must LIST the legal column ${key} — an extractor learns the vocabulary from the `
      + 'error alone, or it guesses again');
  }
});

test('10b · every name in the exported vocabulary IS accepted, in any spelling that folds to it', () => {
  const legal = load();
  const table = legal.views.find((v) => v.form === 'table');

  // The whole vocabulary at once: if the set and the check ever disagree, this fails first.
  table.columns = [...TABLE_COLUMN_KEYS];
  assert.deepEqual(run(legal).errors, [], 'every exported key must be a legal column');

  // …and folding is what makes the vocabulary usable prose: a reader sees "Doc Status", the
  // renderer keys on `docstatus`, and `foldColumnName` is the ONE function both sides read.
  for (const [written, folded] of [
    ['Doc Status', 'docstatus'], ['Documented', 'documented'], ['CAPABILITY', 'capability'],
    ['Drift', 'drift'], ['  lane  ', 'lane'], ['Evidence!', 'evidence'],
  ]) {
    assert.equal(foldColumnName(written), folded, `${written} must fold to ${folded}`);
    table.columns = ['Capability', written];
    assert.deepEqual(run(legal).errors, [], `${written} must be a legal spelling of ${folded}`);
  }
});

test('11 · exactly one overview svg-hero view is required, and views may not be empty', () => {
  const empty = load();
  empty.views = [];
  assert.match(errText(empty), /views/);

  const noOverview = load();
  noOverview.views = noOverview.views.filter((v) => v.id !== 'overview');
  assert.match(errText(noOverview), /overview/);

  const wrongForm = load();
  wrongForm.views.find((v) => v.id === 'overview').form = 'mermaid';
  assert.match(errText(wrongForm), /overview|svg-hero/);
});

/** The fixture with its `overview` grown to `n` nodes — valid, uniquely-labelled filler. */
function overviewWith(n) {
  const m = load();
  const overview = m.views.find((v) => v.id === 'overview');
  for (let i = overview.nodes.length; i < n; i += 1) {
    const label = `filler ${i}`;
    const id = deriveNodeId('mode', label);
    m.nodes.push({
      id,
      kind: 'mode',
      label,
      lane: 'entry',
      inferred: false,
      summary: 'Filler mode, cited from the fixture script so the node itself is valid.',
      evidence: [{ path: SH, line: 11, note: 'mode_check() {' }],
      claims: [],
    });
    overview.nodes.push(id);
  }
  return m;
}

test('11b · an svg-hero view may reference at most 15 nodes (ADR C-002), enforced HERE not only in layoutHero', () => {
  // ADR C-002 buys the hero's ~100-line lane layout with a 15-node bound, and `layoutHero` fails
  // closed above it. Leaving the rule ONLY there is the validator/renderer asymmetry that has now
  // produced a finding in three consecutive phases: a 16-node overview validated `ok: true` and then
  // renderHero threw. ADR C-006 makes this file the single executable IR contract, so a map the
  // validator calls legal must be one the hero can draw.
  assert.equal(run(overviewWith(15)).ok, true, 'equalling the bound is not exceeding it');

  const over = run(overviewWith(16));
  assert.equal(over.ok, false, 'a 16-node svg-hero view must fail validate(), not just renderHero');
  const said = over.errors.join('\n');
  assert.match(said, /15/, 'the error must name the bound that was exceeded');
  assert.match(said, /C-002/, '…and the decision it comes from');
  assert.match(said, /views\[/, '…and which view carries it');

  // The bound is a rule about the HERO, not about maps: the mermaid views have no such cap (PDR
  // §6.1 — "the detailed nodes stay available in the mermaid views"), so a 16-node mermaid view of
  // the very same nodes stays legal.
  const big = overviewWith(16);
  const overview = big.views.find((v) => v.id === 'overview');
  const cf = big.views.find((v) => v.id === 'control-flow');
  cf.nodes = [...overview.nodes];
  overview.nodes = overview.nodes.slice(0, 6);
  overview.edges = overview.edges.filter((id) => {
    const e = big.edges.find((x) => x.id === id);
    return overview.nodes.includes(e.from) && overview.nodes.includes(e.to);
  });
  assert.equal(run(big).ok, true, 'only the svg-hero form carries the cap');
});

// ─── 12 · never throws ────────────────────────────────────────────────────────────────────────────

test('12 · NEVER throws — malformed nested input returns errors', () => {
  const circular = load();
  circular.nodes[0].attrs = {};
  circular.nodes[0].attrs.self = circular.nodes[0].attrs;

  const inputs = [
    null, undefined, 'a map', 42, [], {},
    { schemaVersion: '1' },
    { ...load(), nodes: 'oops' },
    { ...load(), nodes: [null, 3, 'x'] },
    { ...load(), sources: [null] },
    { ...load(), views: [{ id: null }] },
    { ...load(), edges: [{ evidence: 'no' }] },
    { ...load(), coverage: 'none' },
    { ...load(), subject: [] },
    circular,
  ];
  for (const [i, input] of inputs.entries()) {
    let res;
    assert.doesNotThrow(() => { res = validate(input, { repoRoot: REPO_ROOT }); }, `input #${i}`);
    assert.equal(typeof res.ok, 'boolean');
    assert.ok(Array.isArray(res.errors));
    if (!res.ok) assert.ok(res.errors.length > 0, 'a failing validation must say why');
  }
  assert.equal(validate(null).ok, false);
});

// ─── 13 · canonical id derivation ─────────────────────────────────────────────────────────────────

test('13 · slugify is the ONE transformation', () => {
  assert.equal(slugify('CODEX_GATE_RUNS'), 'codex_gate_runs');
  assert.equal(slugify('prepr-delta'), 'prepr_delta');
  assert.equal(slugify('--multi'), 'multi');
  assert.equal(slugify('prepr_delta'), 'prepr_delta');
  assert.equal(slugify('  Mixed Case!  '), 'mixed_case');
  assert.equal(deriveNodeId('mode', 'prepr-delta'), 'mode.prepr_delta');
});

test('13 · a node id must be <kind>.<slugify(label)> with kind equal to the node kind', () => {
  const wrongKind = load();
  const n = nodeOf(wrongKind, 'env.tiny_debug');
  n.id = 'mode.tiny_debug';
  wrongKind.views.forEach((v) => { v.nodes = v.nodes.map((x) => (x === 'env.tiny_debug' ? 'mode.tiny_debug' : x)); });
  wrongKind.edges.forEach((e) => {
    if (e.to === 'env.tiny_debug') { e.to = 'mode.tiny_debug'; e.id = `e.${e.kind}.${e.from}>${e.to}`; }
  });
  wrongKind.views.forEach((v) => { if (v.edges) v.edges = v.edges.map((x) => x.replace('>env.tiny_debug', '>mode.tiny_debug')); });
  assert.match(errText(wrongKind), /id/);

  const wrongSlug = load();
  nodeOf(wrongSlug, 'mode.build').label = 'rebuild';
  assert.match(errText(wrongSlug), /id|slug/i);
});

test('13 · SPEC DEFECT 3 — an edge id carries its KIND, so parallel typed edges cannot collide', () => {
  assert.equal(deriveEdgeId('mode.prepr', 'component.prepr_common', 'control'),
    'e.control.mode.prepr>component.prepr_common');
  assert.notEqual(deriveEdgeId('a.b', 'c.d', 'control'), deriveEdgeId('a.b', 'c.d', 'data'));

  // the fixture already ships the collision case: same endpoints, control + data
  const m = load();
  const pairs = m.edges.filter((e) => e.from === 'mode.check' && e.to === 'component.tiny_core');
  assert.equal(pairs.length, 2, 'the fixture must plant parallel typed edges');
  assert.deepEqual(pairs.map((e) => e.kind).sort(), ['control', 'data']);
  assert.equal(new Set(pairs.map((e) => e.id)).size, 2, 'their ids must differ');
  assert.deepEqual(run(m).errors, []);

  // the untyped `e.<from>><to>` shape is rejected outright — it is the shape that collides
  const legacy = load();
  const target = legacy.edges.find((e) => e.kind === 'data' && e.to === 'component.tiny_core');
  const oldId = target.id;
  target.id = `e.${target.from}>${target.to}`;
  legacy.views.forEach((v) => { if (v.edges) v.edges = v.edges.map((x) => (x === oldId ? target.id : x)); });
  assert.match(errText(legacy), /id/);
});

test('13c · two labels slugifying to the same id inside one kind are reported as a COLLISION', () => {
  const m = load();
  const clone = structuredClone(nodeOf(m, 'mode.build'));
  clone.label = 'BUILD';           // slugifies to the same id as `build`
  m.nodes.push(clone);
  const text = errText(m);
  assert.match(text, /collision|duplicate/i);
  assert.match(text, /mode\.build/);
});

test('13d · every edge needs a label, evidence, and globally-real endpoints; graph views need edges[]', () => {
  const noLabel = load();
  noLabel.edges[0].label = '';
  assert.match(errText(noLabel), /label/);

  const noEvidence = load();
  noEvidence.edges[0].evidence = [];
  assert.match(errText(noEvidence), /evidence/);

  const ghostEndpoint = load();
  ghostEndpoint.edges[0].to = 'component.ghost';
  ghostEndpoint.edges[0].id = `e.control.${ghostEndpoint.edges[0].from}>component.ghost`;
  ghostEndpoint.views.forEach((v) => { if (v.edges) v.edges = v.edges.filter((x) => x.includes('tiny_core') === false || !x.startsWith('e.control.mode.check>component.tiny_core')); });
  assert.match(errText(ghostEndpoint), /component\.ghost/);

  const heroNoEdges = load();
  delete heroNoEdges.views.find((v) => v.form === 'svg-hero').edges;
  assert.match(errText(heroNoEdges), /edges/);

  const dupEdge = load();
  dupEdge.edges.push(structuredClone(dupEdge.edges[0]));
  assert.match(errText(dupEdge), /duplicate/i);

  const dupView = load();
  dupView.views.push(structuredClone(dupView.views[0]));
  assert.match(errText(dupView), /duplicate/i);
});

// ─── 14/15 · grounding and payloads ───────────────────────────────────────────────────────────────

test('14 · an inferred:false node must carry at least one citation', () => {
  const m = load();
  const n = nodeOf(m, 'mode.build');
  n.claims = [];
  assert.match(errText(m), /uncited|citation|evidence/i);

  // the same node with inferred:true is fine — inference is allowed, it just cannot accuse
  const inferred = load();
  const i = nodeOf(inferred, 'mode.build');
  i.claims = [];
  i.inferred = true;
  assert.deepEqual(run(inferred).errors, []);
});

test('15 · required edge and view payload fields', () => {
  for (const [mutate, re] of [
    [(m) => { delete m.edges[0].from; }, /from/],
    [(m) => { delete m.edges[0].to; }, /to/],
    [(m) => { delete m.edges[0].kind; }, /kind/],
    [(m) => { delete m.views[0].title; }, /title/],
    [(m) => { delete m.views[0].nodes; }, /nodes/],
    [(m) => { delete m.views[0].form; }, /form/],
  ]) {
    const m = load();
    mutate(m);
    assert.match(errText(m), re);
  }
});

// ─── 16 · coverage integrity ──────────────────────────────────────────────────────────────────────

test('16 · every coverage.read path must be a hashed source, and partial/skipped need a reason', () => {
  const unhashed = load();
  unhashed.coverage.read.push('plugin/skills/the-cartographer/references/fixtures/tiny/other.sh');
  assert.match(errText(unhashed), /coverage\.read|sources/);

  const noWhy = load();
  noWhy.coverage.partial.push({ path: SH });
  assert.match(errText(noWhy), /why/);

  const doubleClassified = load();
  doubleClassified.coverage.skipped.push({ path: MD, why: 'skipped it' });
  assert.match(errText(doubleClassified), /coverage/);
});

test('16 · every coverage path is classified EXACTLY ONCE across read / partial / skipped', () => {
  const OTHER = 'plugin/skills/the-cartographer/references/fixtures/tiny/other.sh';

  // partial AND skipped: two contradictory coverage claims about the same file
  const bothBuckets = load();
  bothBuckets.coverage.partial.push({ path: OTHER, why: 'budget' });
  bothBuckets.coverage.skipped.push({ path: OTHER, why: 'binary' });
  assert.match(errText(bothBuckets), /coverage/);
  assert.equal(run(bothBuckets).ok, false);

  // duplicated WITHIN a bucket — the coverage report would count the same file twice
  const dupWithinPartial = load();
  dupWithinPartial.coverage.partial.push({ path: OTHER, why: 'budget' });
  dupWithinPartial.coverage.partial.push({ path: OTHER, why: 'ran out of budget' });
  assert.match(errText(dupWithinPartial), /coverage/);
  assert.equal(run(dupWithinPartial).ok, false);

  const dupWithinRead = load();
  dupWithinRead.coverage.read.push(MD);
  assert.match(errText(dupWithinRead), /coverage/);
  assert.equal(run(dupWithinRead).ok, false);
});

test('16 · the partition runs in BOTH directions: every DECLARED SOURCE is classified', () => {
  // FAIL-OPEN: only `coverage.read ⊆ sources[]` was checked. The reverse containment was not, so a
  // map could hash and cite two sources while classifying NEITHER — the coverage report renders
  // empty and the map silently claims provenance it never declared (PDR §7.1 rule 8, §8.1 rule 4).
  const none = load();
  none.coverage.read = [];
  const res = run(none);
  assert.equal(res.ok, false, 'a declared source in no coverage bucket must be a violation');
  const text = res.errors.join('\n');
  assert.match(text, /coverage/);
  assert.match(text, /run\.sh/);
  assert.match(text, /SKILL\.md/);

  // dropping just one is still a violation, and the error names THAT file
  const one = load();
  one.coverage.read = one.coverage.read.filter((p) => p !== MD);
  assert.equal(run(one).ok, false);
  assert.match(errText(one), /SKILL\.md/);

  // …and classifying it as partial or skipped — with a stated reason — satisfies the rule.
  //
  // The harvest record goes with it, and that is a RULE and not fixture housekeeping: the fixture's
  // `env.tiny_debug` records having SEARCHED this doc surface, and a map may not say in one place that
  // it never read a file in full and in another that a node was harvested against it (ADR C-018 — the
  // binding is asserted on its own terms in `doc-harvest.test.mjs` 5f). Leaving it would make this
  // test about that rule instead of about the coverage partition.
  for (const bucket of ['partial', 'skipped']) {
    const m = load();
    m.coverage.read = m.coverage.read.filter((p) => p !== MD);
    m.coverage[bucket].push({ path: MD, why: 'only the mode list was needed' });
    delete nodeOf(m, 'env.tiny_debug').docHarvest;
    assert.deepEqual(run(m).errors, [], `classified as ${bucket}`);
  }
});

// ─── 17 · attrs is plain JSON data (the one free-form region) ──────────────────────────────────────

test('17 · a non-JSON attrs value is rejected at the CONTRACT boundary, not lost in the serializer', () => {
  // FAIL-OPEN: `attrs` was accepted on a bare `typeof === "object"` test, so a Map passed the
  // contract and JSON.stringify later rendered it as `{}` — taking whatever it held (a timestamp,
  // ADR C-003) with it, invisibly, past the serializer's own guard.
  const nonJson = [
    ['a Map', () => new Map([['seen', '2026-08-11T13:45:00Z']])],
    ['a Set', () => new Set(['2026-08-11T13:45:00Z'])],
    ['a Date', () => new Date(0)],
    ['a function', () => () => 1],
    ['a symbol', () => Symbol('seen')],
    ['a BigInt', () => 10n],
    ['NaN', () => NaN],
    ['Infinity', () => Infinity],
  ];
  for (const [what, make] of nonJson) {
    const whole = load();
    nodeOf(whole, 'mode.build').attrs = make();
    assert.equal(run(whole).ok, false, `${what} as the whole attrs payload`);
    assert.match(errText(whole), /attrs/, what);

    const nested = load();
    nodeOf(nested, 'mode.build').attrs = { audit: { value: make() } };
    assert.equal(run(nested).ok, false, `${what} nested inside attrs`);
    assert.match(errText(nested), /attrs/, what);
  }

  // an explicitly-undefined member is DROPPED by JSON.stringify — the same silent-loss class
  const undef = load();
  nodeOf(undef, 'mode.build').attrs = { note: undefined };
  assert.equal(run(undef).ok, false);
  assert.match(errText(undef), /attrs\.note/);

  // a cycle must be REJECTED here and validate() must still never throw: it used to validate clean
  // and then fail deep inside normalization, far from the contract it actually violates.
  const cyclic = load();
  const attrs = { k: 1 };
  attrs.self = attrs;
  nodeOf(cyclic, 'mode.build').attrs = attrs;
  let res;
  assert.doesNotThrow(() => { res = run(cyclic); });
  assert.equal(res.ok, false);
  assert.match(res.errors.join('\n'), /circular|cycle/i);

  // …and ordinary JSON data still passes, including a shared (non-cyclic) sub-object
  const shared = { deep: [1, 2] };
  const fine = load();
  nodeOf(fine, 'mode.build').attrs = {
    default: null, n: 1, s: 'x', b: true, list: [1, 'a', { nested: [] }], a: shared, b2: shared,
  };
  assert.deepEqual(run(fine).errors, []);
});

test('18 · the attrs walk sees exactly what the serializer writes: holes, symbol / non-enumerable keys, accessors', () => {
  // FAIL-OPEN: the walk used `forEach` (which SKIPS array holes) and `Object.keys` + `obj[key]`
  // (which skips symbol and non-enumerable own keys, and INVOKES accessors). Each blind spot lets a
  // map validate as one value and serialize as another — the defect this contract boundary exists
  // to prevent.

  // a HOLE is not the value that was validated: JSON.stringify writes it as null
  const holed = [1, 2, 3];
  delete holed[1];
  const sparse = load();
  nodeOf(sparse, 'mode.build').attrs = { list: holed };
  assert.equal(run(sparse).ok, false, 'a hole in an attrs array');
  assert.match(errText(sparse), /attrs\.list\[1\]/);
  assert.match(errText(sparse), /hole|sparse/i);
  assert.equal(JSON.parse(JSON.stringify({ list: holed })).list[1], null, 'the hole really does serialize as null');

  // a SYMBOL-keyed own property is skipped by Object.keys and DROPPED by JSON.stringify
  const symbolled = load();
  const withSymbol = { k: 1 };
  withSymbol[Symbol('seen')] = '2026-08-11T13:45:00Z';
  nodeOf(symbolled, 'mode.build').attrs = { audit: withSymbol };
  assert.equal(run(symbolled).ok, false, 'a symbol-keyed member of attrs');
  assert.match(errText(symbolled), /symbol/i);

  // a NON-ENUMERABLE own property is likewise invisible to Object.keys and dropped by the serializer
  const hidden = load();
  const withHidden = { k: 1 };
  Object.defineProperty(withHidden, 'seen', { value: '2026-08-11T13:45:00Z', enumerable: false });
  nodeOf(hidden, 'mode.build').attrs = { audit: withHidden };
  assert.equal(run(hidden).ok, false, 'a non-enumerable member of attrs');
  assert.match(errText(hidden), /attrs\.audit\.seen/);
  assert.match(errText(hidden), /enumerable/i);

  // an ACCESSOR is re-computed when the serializer reads it, so the value checked is not the value
  // written — the contract cannot be enforced on a value that is recomputed after the check
  const computed = load();
  let reads = 0;
  const withGetter = { k: 1 };
  Object.defineProperty(withGetter, 'seen', {
    get() { reads += 1; return `read-${reads}`; },
    enumerable: true,
    configurable: true,
  });
  nodeOf(computed, 'mode.build').attrs = { audit: withGetter };
  assert.equal(run(computed).ok, false, 'an accessor member of attrs');
  assert.match(errText(computed), /attrs\.audit\.seen/);
  assert.match(errText(computed), /accessor|getter/i);

  // an own NON-INDEX property on an array is dropped by JSON.stringify the same way
  const tagged = [1, 2];
  tagged.seen = '2026-08-11T13:45:00Z';
  const taggedMap = load();
  nodeOf(taggedMap, 'mode.build').attrs = { list: tagged };
  assert.equal(run(taggedMap).ok, false, 'a non-index own property on an attrs array');
  assert.match(errText(taggedMap), /attrs\.list\.seen/);

  // …and a dense array of ordinary JSON data still passes
  const fine = load();
  nodeOf(fine, 'mode.build').attrs = { list: [1, 'a', null, { nested: [true] }] };
  assert.deepEqual(run(fine).errors, []);
});

// ─── 19 · a cycle is not serializable ANYWHERE, not only inside attrs ──────────────────────────────

test('19 · a cycle is reported wherever it sits in the IR — validate() reports, serialize() must not blow the stack', () => {
  // FAIL-OPEN: the cycle guard lived only inside `nodes[].attrs`, so a self-reference anywhere else
  // validated `ok: true` and then took `serialize()` down with a RangeError — the unreadable failure
  // PDR §7.1 promises will not happen.
  const cases = [
    ['a top-level self-reference', (m) => { m.self = m; }, /^self\b/m],
    ['a node self-reference', (m) => { nodeOf(m, 'mode.build').cycle = nodeOf(m, 'mode.build'); }, /nodes\[\d+\]\.cycle/],
    ['a citation pointing back at its collection', (m) => { m.sources[0].all = m.sources; }, /sources\[0\]\.all/],
    ['a two-step cycle', (m) => { m.views[0].up = m; }, /views\[0\]\.up/],
    ['a cycle through an array element', (m) => { m.edges[0].evidence.push(m.edges[0].evidence); }, /edges\[0\]\.evidence/],
  ];
  for (const [what, mutate, where] of cases) {
    const m = load();
    mutate(m);
    let res;
    assert.doesNotThrow(() => { res = run(m); }, `${what}: validate() never throws`);
    assert.equal(res.ok, false, what);
    assert.match(res.errors.join('\n'), /circular|cycle/i, what);
    assert.match(res.errors.join('\n'), where, `${what}: the error must name where the cycle sits`);
  }

  // a shared (acyclic) sub-object is legitimate JSON and must still validate clean
  const shared = load();
  const cited = { path: SH, line: 3, note: 'shared' };
  nodeOf(shared, 'mode.build').evidence = [cited, cited];
  assert.deepEqual(run(shared).errors, []);

  // ONE defect, ONE error: a cycle inside attrs is reachable by both the document-wide walk and the
  // attrs JSON-data walk, and reporting it twice would double-count a single fault.
  const inAttrs = load();
  const attrs = { k: 1 };
  attrs.self = attrs;
  nodeOf(inAttrs, 'mode.build').attrs = attrs;
  const cycleErrors = run(inAttrs).errors.filter((e) => /circular reference/i.test(e));
  assert.equal(cycleErrors.length, 1, `one cycle, one error (got ${cycleErrors.length})`);
});

// ─── 20 · the attrs ROOT shape (code ↔ PDR §7.1 reconciliation) ────────────────────────────────────

test('20 · attrs is absent, null, or a plain object — a present-but-undefined attrs is a violation, not an absent key', () => {
  // FAIL-OPEN: an OWN `attrs: undefined` was read as "absent", while serialization DROPS the key —
  // the silent-loss class §7.1 already names, and `'attrs' in n` is exactly what tells a present
  // undefined apart from a key that is not there.
  const undef = load();
  const n = nodeOf(undef, 'mode.build');
  n.attrs = undefined;
  assert.ok('attrs' in n, 'the key IS present — only its value is undefined');
  assert.equal(run(undef).ok, false);
  assert.match(errText(undef), /attrs/);
  assert.match(errText(undef), /undefined/i);
  assert.equal('attrs' in JSON.parse(JSON.stringify({ attrs: undefined })), false,
    'the key really does vanish on serialization');

  // a scalar or array ROOT carries no attribute NAME, so nothing downstream can render or diff it
  for (const bad of [5, 'x', true, [1, 2]]) {
    const m = load();
    nodeOf(m, 'mode.build').attrs = bad;
    assert.equal(run(m).ok, false, `attrs: ${JSON.stringify(bad)}`);
    assert.match(errText(m), /attrs/, `attrs: ${JSON.stringify(bad)}`);
  }

  // …while the two shapes that mean "no attributes" stay legitimate: an absent key, and an explicit
  // null — null is not rewritten by the serializer, so it says so in the file rather than vanishing.
  const absent = load();
  delete nodeOf(absent, 'mode.build').attrs;
  assert.deepEqual(run(absent).errors, []);

  const nulled = load();
  nodeOf(nulled, 'mode.build').attrs = null;
  assert.deepEqual(run(nulled).errors, []);

  const populated = load();
  nodeOf(populated, 'mode.build').attrs = { default: null, retries: 3 };
  assert.deepEqual(run(populated).errors, []);
});

// ─── 21 · the return contract holds on every input the walks now inspect ───────────────────────────

test('21 · validate() NEVER throws on cyclic, sparse, symbol-keyed or accessor-bearing input', () => {
  const withNode = (mutate) => { const m = load(); mutate(nodeOf(m, 'mode.build'), m); return m; };
  const sparseNodes = load();
  sparseNodes.nodes.length += 1;                       // a hole at the TOP level, not inside attrs
  const symbolRoot = load();
  symbolRoot.nodes[0][Symbol('seen')] = new Date(0);   // a symbol key outside attrs
  const cyclicDeep = load();
  cyclicDeep.views[0].nodes.push(cyclicDeep.views);

  const inputs = [
    ['a getter that throws where the serializer would read it', withNode((n) => {
      Object.defineProperty(n, 'attrs', { get() { throw new Error('boom'); }, enumerable: true, configurable: true });
    })],
    ['a Proxy that refuses to be walked', withNode((n) => {
      n.attrs = new Proxy({}, { ownKeys() { throw new Error('nope'); } });
    })],
    ['a hole in a top-level collection', sparseNodes],
    ['a symbol-keyed property outside attrs', symbolRoot],
    ['a cycle through a view', cyclicDeep],
    ['a frozen cyclic object', withNode((n) => {
      const frozen = { k: 1 };
      frozen.self = frozen;
      Object.freeze(frozen);
      n.attrs = frozen;
    })],
    ['a null-prototype attrs object', withNode((n) => { n.attrs = Object.assign(Object.create(null), { k: 1 }); })],
  ];

  for (const [what, input] of inputs) {
    let res;
    assert.doesNotThrow(() => { res = run(input); }, what);
    assert.equal(typeof res.ok, 'boolean', what);
    assert.ok(Array.isArray(res.errors), what);
    if (!res.ok) assert.ok(res.errors.length > 0, `${what}: a failing validation must say why`);
  }

  // the same guarantee with no repoRoot, where containment is skipped rather than faked
  for (const [what, input] of inputs) {
    assert.doesNotThrow(() => validate(input), `${what} (no repoRoot)`);
  }
});

// ─── 22 · the validator judges the value the FILE will carry, not the value a get answers with ──────

test('22 · a field a plain GET can see but the file cannot carry is judged as the file will carry it', () => {
  // The asymmetry that produced a finding in each of the first three phases, asserted from the
  // validator's side: `isObj` + `map.nodes` read INHERITED, hidden and exotic values that
  // `JSON.stringify` — and every consumer's own reader — never sees. So a map could validate on data
  // no reader of map.json would ever find. The ingest boundary settles it once: the validator judges
  // the snapshot, which is exactly what `serialize()` writes.

  // (a) an INHERITED `inferred: true`. A get says "inferred, so never accuse it" (diff.mjs RULE 6)
  // while the file says nothing at all — and the drift engine, which copies own properties, would
  // accuse the node. Phase 2 recorded this as finding 1; it is a refusal now, not a disagreement.
  const inheritedFlag = load();
  const target = nodeOf(inheritedFlag, 'component.tiny_core');
  const rebuilt = Object.assign(Object.create({ inferred: true }), target);
  delete rebuilt.inferred;
  inheritedFlag.nodes = inheritedFlag.nodes.map((n) => (n === target ? rebuilt : n));
  assert.equal(rebuilt.inferred, true, 'a plain get really does see the inherited flag');
  assert.equal(Object.hasOwn(JSON.parse(JSON.stringify(rebuilt)), 'inferred'), false, 'the file does not');
  const flagResult = run(inheritedFlag);
  assert.equal(flagResult.ok, false, 'an inherited field is not a field');
  assert.match(flagResult.errors.join('\n'), /inferred/);

  // (b) an EXOTIC record OUTSIDE attrs. It answers every field read with real data and serializes as
  // a bare string, so the node the validator judged is not in the file at all.
  const exotic = load();
  const check = nodeOf(exotic, 'mode.check');
  exotic.nodes = exotic.nodes.map((n) => (n === check ? Object.assign(new Date(0), check) : n));
  const exoticResult = run(exotic);
  assert.equal(exoticResult.ok, false);
  assert.match(exoticResult.errors.join('\n'), /Date/);
  assert.equal(typeof JSON.parse(JSON.stringify(exotic)).nodes.find((n) => typeof n === 'string'), 'string',
    'the file really does carry a string where the node was');

  // (c) an ACCESSOR outside attrs — re-read by the writer, so the value checked need not be written.
  const computed = load();
  delete computed.subject.title;
  Object.defineProperty(computed.subject, 'title', {
    get: () => 'tiny', enumerable: true, configurable: true,
  });
  const computedResult = run(computed);
  assert.equal(computedResult.ok, false);
  assert.match(computedResult.errors.join('\n'), /subject\.title/);
  assert.match(computedResult.errors.join('\n'), /accessor/i);

  // (d) a NON-ENUMERABLE collection — read by the validator, dropped by the writer.
  const hidden = load();
  Object.defineProperty(hidden, 'sources', {
    value: hidden.sources, writable: true, enumerable: false, configurable: true,
  });
  const hiddenResult = run(hidden);
  assert.equal(hiddenResult.ok, false);
  assert.match(hiddenResult.errors.join('\n'), /sources/);
  assert.match(hiddenResult.errors.join('\n'), /enumerable/i);

  // (e) …and the one shape that is CARRIED rather than refused, because the file can hold it — just
  // not with that sign. `-0` validates, and what is written is `0`, so the value validated IS the
  // value serialized.
  const signedZero = load();
  nodeOf(signedZero, 'mode.build').attrs = { weight: -0 };
  assert.deepEqual(run(signedZero).errors, []);
  const written = JSON.parse(serialize(signedZero));
  assert.ok(Object.is(written.nodes.find((n) => n.id === 'mode.build').attrs.weight, 0),
    'the file carries 0, so that is what the validator accepted');
});

// ─── 23 · an INVISIBLE control character is refused (owner, 2026-08-15 · ADR C-023) ─────────────────

/**
 * THE DEFECT THIS CLOSES, and why it is closed HERE rather than in the scorer that lost the byte.
 *
 * A `kind: "outcome"` label could legally carry a NUL and nothing in the contract could see it.
 * `slugify` collapses every run outside `[a-z0-9]` to a single `_` — the NUL included — so
 * `PASS<U+0000>` derives the required id `outcome.pass` BYTE-IDENTICALLY to the clean `PASS`, and
 * `validate()` returned ZERO errors on both: not "accepted it and complained elsewhere", but could not
 * DISTINGUISH them. The C-015 coverage-floor scorer then lost the byte at its own `tok=$(…)`, because
 * command substitution cannot carry a NUL, so `grep -qxF` accepted the label as the legitimate
 * `exit 2` and printed no `INVENTED OUTCOME LABEL`. That is the laundering ADR C-020 refuses for a
 * trailing parenthesis, reached through a byte instead — and the direction is FAIL-OPEN.
 *
 * It was also SHELL-DEPENDENT: observed in this tree, `bash` and `sh` drop the byte at the capture
 * while `zsh` carries it and reports the invention. A check whose verdict depends on which interpreter
 * ran it is undefined rather than closed, which is the second reason the IR is the right place.
 *
 * WHAT IS AND IS NOT REFUSED, and the property that draws the line. A control character that is NOT
 * whitespace is INVISIBLE: it changes the bytes of a record without changing anything a reader can
 * see, and two records a reader cannot tell apart must not be two different records. Tab, line feed
 * and carriage return are visible AS SEPARATION, every normalizer here already collapses them
 * (`slugify`, `quotesFragment`'s `flatten`, mermaid's `safeLabel`), and a quote copied out of a claim
 * legitimately picks up a re-wrap on the way into the record — which `quotesFragment` exists to
 * tolerate. So those three stay legal in prose and the other thirty do not.
 *
 * The same line is drawn independently by the map's own output format: the XML 1.0 `Char` production
 * admits exactly U+0009, U+000A and U+000D from the C0 range and NO escape for the rest, so the raw
 * U+0000 that `svg.mjs` was observed emitting into a hero `<title>` makes `map.html` a document no
 * conformant parser may accept.
 *
 * THIS REMOVES THE INPUT, NOT THE WEAKNESS. The C-015 scorer is still not binary-safe; what changed is
 * that the IR can no longer carry the byte for it to lose (ADR C-023).
 */

/** The refused class, spelled out rather than derived, so the test states the contract it pins. */
const REFUSED_CODES = Object.freeze([
  ...Array.from({ length: 0x20 }, (_, i) => i).filter((c) => c !== 0x09 && c !== 0x0a && c !== 0x0d),
  0x7f,
]);
const ch = (code) => String.fromCodePoint(code);
const uPlus = (code) => `U+${code.toString(16).toUpperCase().padStart(4, '0')}`;

test('23 · the PROVEN shape: a NUL in an outcome label is refused, and the id rule could never see it', () => {
  const m = load();
  const outcome = nodeOf(m, 'outcome.pass');
  outcome.label = `PASS${ch(0)}`;

  // Stated as an assertion rather than as prose: this is WHY no rule already in this file caught it.
  assert.equal(deriveNodeId('outcome', outcome.label), 'outcome.pass',
    'slugify collapses the NUL, so the REQUIRED id is byte-identical to the clean label\'s');
  assert.equal(outcome.id, 'outcome.pass', 'and the map carries exactly that id, so the id rule is silent');
  assert.notEqual(outcome.label, 'PASS', 'the label really does differ in bytes');

  const res = run(m);
  assert.equal(res.ok, false, 'a label carrying U+0000 must be REFUSED');
  const text = res.errors.join('\n');
  assert.match(text, /nodes\[\d+\]\.label/, 'the error names the field that carries it');
  assert.match(text, /U\+0000/, 'and names the code point, so the byte is identifiable in a message');
});

test('23 · the refusal is the WHOLE CLASS — every C0 control but tab / newline / return, plus DEL', () => {
  // A rule that refuses one byte and admits thirty others is a rule that will be re-found, so the
  // class is asserted exhaustively rather than sampled.
  assert.equal(REFUSED_CODES.length, 30, '29 C0 controls (32 less tab, newline, return) plus DEL');
  for (const code of REFUSED_CODES) {
    const m = load();
    nodeOf(m, 'mode.build').summary = `built${ch(code)}here`;
    const res = run(m);
    assert.equal(res.ok, false, `${uPlus(code)} must be refused`);
    assert.ok(res.errors.some((e) => e.includes(uPlus(code)) && e.includes('nodes[')),
      `${uPlus(code)} must be named in an error against the field that carries it, got: ${res.errors.join(' | ')}`);
  }
});

test('23 · tab, newline and return stay LEGAL in prose — a RE-WRAPPED quote is not a violation', () => {
  // The content this refusal must not break. Every prose field the IR carries gets a whitespace
  // control, INCLUDING the pair `quotesFragment` binds together: `claim.text` keeps its newline and
  // `refutedQuote` a tab where the claim has a space, which is exactly the re-wrap that function's own
  // comment exists to tolerate. If the refusal reached whitespace, this map would be refused and an
  // honest record would have become a contract violation.
  const m = load();
  m.subject.summary = `A two-file fixture subject.${ch(0x0a)}Carrying four planted drift cases.`;

  const check = nodeOf(m, 'mode.check');
  check.summary = `The only real mode:${ch(0x09)}calls the shared core routine.`;
  const wrapped = `- \`check\` — runs the core routine and${ch(0x0a)}prints \`check ran\`.`;
  check.claims[0].text = wrapped;
  check.contradictions[0].claim.text = wrapped;
  check.contradictions[0].refutedQuote = `prints${ch(0x09)}\`check ran\``;
  check.contradictions[0].statement = `The doc says check prints "check ran";${ch(0x0a)}the code prints "core ran for check".`;
  check.evidence[0].note = `printf 'core ran for %s\\n'${ch(0x0d)}"$1"`;
  check.contradictions[0].evidence.note = check.evidence[0].note;

  const dbg = nodeOf(m, 'env.tiny_debug');
  // VERBATIM FROM `MD:3`, re-wrapped — the exact case this test exists to permit. The quote used to be
  // the invented string "mentions\nTINY_DEBUG in passing"; `tiny/SKILL.md` mentions TINY_DEBUG on no
  // line at all, which is precisely why that node is the planted UNDOCUMENTED one. `mentions` is the
  // honest disposition here for the reason C-018 gives: the line predicates nothing of this node.
  dbg.docHarvest.candidates.push({
    path: MD,
    line: 3,
    disposition: 'mentions',
    quote: `A fixture skill used by${ch(0x0a)}the-cartographer's own tests.`,
  });
  m.coverage.partial.push({
    path: 'plugin/skills/the-cartographer/references/fixtures/tiny/other.sh',
    why: `budget ran out${ch(0x0a)}before the tail`,
  });

  const res = run(m);
  assert.deepEqual(res.errors, [], 'legitimate multi-line prose must still validate');
  assert.equal(res.ok, true);
});

test('23c · a LABEL is prose too — tab, newline and return stay legal in one, and the id does not move', () => {
  // The half rule 19 pins and this file did not exercise: the contract says a label is NOT stricter
  // than prose, yet every whitespace-control case above lands in a summary, a claim or a quote. A
  // label-only rejection would have stayed green through all of them.
  //
  // `component.dispatch_table`'s label already carries a SPACE, and `slugify` collapses every run
  // outside [a-z0-9] to a single `_` — so swapping that space for a whitespace control derives the
  // byte-identical id `component.dispatch_table`. Nothing else in the map moves, which is what makes
  // this a clean test of the label rule rather than of the id rule.
  for (const code of [0x09, 0x0a, 0x0d]) {
    const m = load();
    nodeOf(m, 'component.dispatch_table').label = `dispatch${ch(code)}table`;
    const res = run(m);
    assert.deepEqual(res.errors, [],
      `${uPlus(code)} must stay LEGAL in a node label — rule 19 permits tab, newline and return `
      + 'everywhere prose is permitted, and a label is prose');
    assert.equal(res.ok, true, `${uPlus(code)} in a label must leave the map valid`);
  }
});

test('23 · a PATH refuses all thirty-three — whitespace included, because a path is not prose', () => {
  // Stricter than prose, and deliberately: a repo-relative source path is consumed by line-oriented
  // tools — the C-015 scorer reads one path per line, `grep` and the drift report the same — so a tab
  // or a newline inside one is not a re-wrap, it is a second path. And a NUL is worse than invisible
  // here: `realpathOfExistingPrefix` catches the throw `fs.realpathSync` raises on it and walks UP to
  // an ancestor that does resolve, so containment would be checked against a path the map never named.
  for (const code of [...REFUSED_CODES, 0x09, 0x0a, 0x0d]) {
    const m = load();
    m.sources[1].path = `plugin/skills/the-cartographer/references/fixtures/tiny/run${ch(code)}.sh`;
    const res = run(m);
    assert.equal(res.ok, false, `a path carrying ${uPlus(code)} must be refused`);
    assert.ok(res.errors.some((e) => e.startsWith('sources[1].path')),
      `${uPlus(code)} must be reported against sources[1].path, got: ${res.errors.join(' | ')}`);
  }
});

test('23 · the walk reaches EVERY string in the document — nested attrs values and attrs KEYS', () => {
  // Whole-document, for the reason `checkNoEmbeddedDrift` is whole-document: a rule enforced at a list
  // of known fields is a rule that misses the next field somebody adds. `attrs` is the IR's one
  // free-form region and it is where an invisible byte has the most room to hide.
  const nested = load();
  nodeOf(nested, 'mode.build').attrs = { tags: ['fine', { deep: `bad${ch(0x1b)}value` }] };
  const nestedRes = run(nested);
  assert.equal(nestedRes.ok, false, 'a control character nested inside attrs is still in the file');
  assert.ok(nestedRes.errors.some((e) => e.includes('attrs.tags[1].deep') && e.includes('U+001B')),
    `the error names the full path, got: ${nestedRes.errors.join(' | ')}`);

  // A KEY is as much a string in the file as a value is, and it is the half a value-only walk misses.
  const keyed = load();
  nodeOf(keyed, 'mode.build').attrs = { [`weight${ch(0)}`]: 1 };
  const keyedRes = run(keyed);
  assert.equal(keyedRes.ok, false, 'an invisible byte in a KEY is still an invisible byte');
  assert.ok(keyedRes.errors.some((e) => e.includes('U+0000') && /object KEY/i.test(e)),
    `the error must say the fault is in a KEY, not in a value: ${keyedRes.errors.join(' | ')}`);
});

test('23 · a KEY may not SPELL another location, and so borrow the silence a path was judged with', () => {
  // The one place this walk stays silent is a location `checkPath` has already spoken about — paths are
  // judged more strictly elsewhere, and one fault keeps one message. That skip is keyed by LOCATION, so
  // it is only sound if a location identifies exactly one string. It did not: the walk composed a
  // child's location by concatenating an UNESCAPED object key, and `[`, `]` and `.` are the location
  // grammar's own metacharacters — so a key spelled `searched[0]` sitting beside `searched` produced the
  // location of `searched[0]`, a location already judged, and its value was skipped. Three independent
  // forgeries were reachable on `tiny.map.json`, each validating with ZERO errors while carrying a NUL.
  //
  // Whether such a key is legal is beside the point: extra keys ARE walked and reported (the control
  // case below), which is exactly why this one must be too.
  const forgeries = [
    ['an extra `coverage` key spelling coverage.read[0]', (m) => { m.coverage['read[0]'] = `x${ch(0)}y`; }],
    ['an extra `docHarvest` key spelling docHarvest.searched[0]', (m) => {
      nodeOf(m, 'env.tiny_debug').docHarvest['searched[0]'] = `x${ch(0)}y`;
    }],
    ['an extra top-level key spelling sources[0]', (m) => { m['sources[0]'] = { path: `x${ch(0)}y` }; }],
    ['an extra node key spelling nodes[i].evidence[0]', (m) => {
      nodeOf(m, 'mode.check')['evidence[0]'] = { path: `x${ch(0)}y` };
    }],
  ];
  for (const [what, forge] of forgeries) {
    const m = load();
    forge(m);
    const res = run(m);
    assert.equal(res.ok, false, `${what}: a NUL reached the file unreported`);
    assert.ok(res.errors.some((e) => e.includes('U+0000')),
      `${what}: the byte must be named, got: ${res.errors.join(' | ')}`);
  }

  // …and the skip it exists for still works: a REAL path carrying a control character is reported ONCE,
  // by the path rule, and this walk does not report it a second time.
  const once = load();
  once.sources[1].path = `plugin/skills/the-cartographer/references/fixtures/tiny/run${ch(0)}.sh`;
  const onceRes = run(once);
  assert.equal(onceRes.errors.filter((e) => e.includes('U+0000')).length, 1,
    `one fault, one message: ${onceRes.errors.join(' | ')}`);
  assert.ok(onceRes.errors.some((e) => e.startsWith('sources[1].path:') && /line-oriented tools/.test(e)),
    `and the one message is the PATH rule's, not this walk's: ${onceRes.errors.join(' | ')}`);
});

test('23 · REGRESSION FLOOR: no committed fixture and neither FROZEN candidate map changes verdict', (t) => {
  // The refusal is only correct if it refuses nothing already recorded. Asserted as the EXACT
  // pre-existing error sets rather than as "still zero": `codex-gate.map.json`, run 3's candidate and
  // run 4's candidate each already carry errors at HEAD — run 4's single missing `refutedQuote` on
  // `nodes[93]` is the one ADR C-021 records — and the property that matters is that this change adds
  // NOTHING to those sets. A frozen candidate is a dated record and may not be edited to suit a later
  // rule (ADR C-021), so if this had newly refused one, the change would have been wrong, not the map.
  for (const [name, file, expected] of [
    ['tiny.map.json', FIXTURE, 0],
    ['fixtures/codex-gate.map.json', path.join(HERE, 'fixtures', 'codex-gate.map.json'), 4],
    ['fixtures/golden/map.json', path.join(HERE, 'fixtures', 'golden', 'map.json'), 0],
  ]) {
    const res = validate(JSON.parse(fs.readFileSync(file, 'utf8')), { repoRoot: REPO_ROOT });
    assert.equal(res.errors.length, expected, `${name}: ${res.errors.join(' | ')}`);
    assert.equal(res.errors.filter((e) => /control character/i.test(e)).length, 0,
      `${name} must carry no control-character finding`);
  }

  // The frozen candidates live in the host repo, not in the shipped package — guarded exactly as the
  // 5e block guards run 4's map.
  if (!run4Present) { t.skip(NO_DOCS); return; }
  const initiatives = path.dirname(path.dirname(RUN_4));
  for (const [name, file, expected] of [
    ['run-3-candidate/map.json', path.join(initiatives, 'run-3-candidate', 'map.json'), 6],
    ['run-4-candidate/map.json', path.join(initiatives, 'run-4-candidate', 'map.json'), 1],
  ]) {
    const res = validate(JSON.parse(fs.readFileSync(file, 'utf8')), { repoRoot: REPO_ROOT });
    assert.equal(res.errors.length, expected, `${name}: ${res.errors.join(' | ')}`);
    assert.equal(res.errors.filter((e) => /control character/i.test(e)).length, 0,
      `${name} — a FROZEN record — must not be newly refused`);
  }
});
