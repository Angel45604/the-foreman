// the-cartographer — the documentation-harvest ATTESTATION (ADR decision F, 2026-08-14).
//
// WHAT THE RECORD IS, said once and up front (ADR C-018 amendment, owner, 2026-08-14). The harvest is
// an ATTESTATION the extractor signs, MECHANICALLY CHECKED FOR INTERNAL CONSISTENCY — never
// independently verified. `docHarvest.searched` and `sources[].role` are two lists the same extractor
// wrote, and every rule below compares them against each other or against the map's own coverage.
// NOTHING HERE OPENS A FILE. So what a passing map ships is that the extractor ATTESTS it searched
// every doc surface it DECLARED; whether it read anything, and whether the declaration was complete,
// are the extractor's to answer and this suite's to leave unclaimed.
//
// WHY THIS FILE EXISTS, measured.
//
// UNDOCUMENTED was computed from claim ABSENCE alone (ADR C-014): evidence + no `claimKind:"doc"`
// claim ⇒ accuse. That makes every doc line the extractor failed to harvest an automatic FALSE
// ACCUSATION, and leaves the map unable to tell "genuinely undocumented" from "documented, but I did
// not look there". On the only real subject ever mapped — `run-3-candidate/map.json` — at least 7 of
// 37 UNDOCUMENTED findings were false: a ~19% floor, and a FLOOR because that audit swept identifiers
// only while the protocol (SKILL.md §3) also requires synonyms. PDR §14 names a confident wrong map as
// the product's top risk; this was that risk, realized and quantified.
//
// WHERE THE SEVEN ARE IN THIS FILE, item by item, because the count above is only honest if the file
// accounts for all of it (`oracle-run-3.md` § *PRECISION*, items 1–7):
//
//   • SIX are repaired by the derived fixture below and asserted by test 2 — the five the identifier
//     sweep decided (`is_frontend_path`, `emit_investigate_outcome`, `emit_question_outcome`,
//     `die_infra`, `resolve_run_dir`), plus item 7, `component.append_context_if_present`, which the
//     identifier sweep could never have found: `grep -c append_context_if_present` over both doc
//     surfaces returns 0 and 0, and `SKILL.md:317-321` describes the helper BY SYNONYM ("the wrapper
//     folds it into the packet"). It is the item that turns the count into a floor, so a fixture that
//     omitted it would quietly re-assert the identifier-only reading the record withdrew.
//   • ONE — item 6, `component.enforce_packet_budget` — is run 3's own MARGINAL entry, and this file
//     uses it as test 3's positional-landmark case rather than repairing it. `README.md:122` locates
//     the shard trigger *"right where `enforce_packet_budget` would fire"*; run 3 filed that as a
//     false accusation and marked it marginal, the C-018 addendum then drew the boundary explicitly
//     (a comparison asserts of what it compares; a positional landmark predicates nothing of the item
//     it locates), and run 4's harvest dispositioned that same line `mentions`-only for this node
//     (`oracle-run-4.md`, *The five lines run 3 never harvested*). This file applies that boundary in
//     the direction that KEEPS the finding, which is the harder direction and the one that shows a
//     disposition is a judgement rather than a rubber stamp.
//
// Decision F makes UNDOCUMENTED eligibility THREE-STATE, and only the middle state may accuse:
//
//   1 documented            — the node carries a `claimKind:"doc"` claim.            no finding
//   2 harvest-complete      — a harvest covered EVERY declared `role:"doc"` surface
//                             and found nothing asserting this node's behaviour.     UNDOCUMENTED
//   3 harvest-incomplete    — no harvest, one that missed a declared surface, a
//                             record the contract cannot read, or a map that        NO finding;
//                             declares no doc surface at all.                       a COVERAGE
//                                                                                   statement. The
//                                                                                   map does not know.
//
// FAIL CLOSED: absence of a harvest is state 3, never state 2 — so a legacy map with no harvest
// record raises ZERO UNDOCUMENTED. That is correct, and test 1 asserts it deliberately.
//
// THE PART A NAIVE IMPLEMENTATION GETS WRONG. A harvest hit is a CANDIDATE, not a claim. Text that
// merely MENTIONS a node — a positional landmark, a "see also" — is not documentation
// of it. So the attestation records candidates with an explicit DISPOSITION, and a disposition never
// suppresses a finding: only a real `doc` claim does. `asserts` obliges the extractor to promote the
// candidate into `claims[]`, and the validator enforces that promotion. Search completeness and claim
// semantics stay separate, which is exactly what tests 2 and 3 pin.
//
// Zero dependencies: node built-ins only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { computeDrift, docHarvestCoverage } from './diff.mjs';
import { validate, DOC_HARVEST_FORBIDDEN_KEYS } from './validate.mjs';
import { renderPage } from './render.mjs';
import { toMarkdown } from './markdown.mjs';
// The SAME primitives the extractor and the freshness check use, so a `sources[]` entry built here
// states what a real one would state rather than a plausible-looking hex string (5g).
import { digestOf, countLines } from './freshness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..', '..');

/**
 * THE REAL ARTIFACT. The committed IR of the failing run 3 — read-only here, and never edited: every
 * fixture below is DERIVED from it in memory, so what these tests prove is a property of the map that
 * actually shipped the false accusations rather than of a fixture written to agree with them.
 */
const RUN_3 = path.join(
  REPO_ROOT, 'docs', 'initiatives', '2026-08-11-the-cartographer', 'run-3-candidate', 'map.json',
);
const loadRun3 = () => JSON.parse(fs.readFileSync(RUN_3, 'utf8'));

/**
 * THE OTHER FROZEN CANDIDATE — run 4, the only real extraction ever performed under the harvest
 * contract, and read here on the same terms as run 3: never edited, only derived from.
 */
const RUN_4 = path.join(
  REPO_ROOT, 'docs', 'initiatives', '2026-08-11-the-cartographer', 'run-4-candidate', 'map.json',
);
const loadRun4 = () => JSON.parse(fs.readFileSync(RUN_4, 'utf8'));

/**
 * BOTH FROZEN CANDIDATES LIVE IN THE HOST REPO, NOT IN THE PACKAGE — so every test that reaches for
 * one SKIPS where it cannot see one.
 *
 * The marketplace ships `./plugin` and nothing else (`.claude-plugin/marketplace.json`), so
 * `docs/initiatives/**` simply does not exist in a standalone install while these `.test.mjs` files
 * do, and a suite that throws `ENOENT` there is a broken suite rather than a failing one. This is the
 * convention the suite ALREADY uses for exactly these artifacts: `table-columns.test.mjs` guards run
 * 3's committed map with `existsSync` + `t.skip`, and `docs-contract.test.mjs` guards the PDR and the
 * execution plan the same way, with the same sentence.
 *
 * A SKIP RATHER THAN A VENDORED COPY, deliberately. Copying 300 KB and 380 KB of FROZEN IR into
 * `references/fixtures/` would put a second copy of a record nobody may edit inside the package, free
 * to drift from the one in `docs/` with no test able to notice — and "DERIVED from the map that
 * actually shipped, never a transcription of it" is the claim every comment in this file rests on.
 * Where a property must hold in a standalone install too, it is pinned on `tiny` as well: the
 * absent-vs-inconsistent `refutedQuote` distinction that `2c` pins on run 4's artifact is pinned on
 * the fixture by `validate.test.mjs`'s `5e · refutedQuote is REQUIRED`, which ships.
 */
const run3Present = fs.existsSync(RUN_3);
const run4Present = fs.existsSync(RUN_4);
const NO_DOCS = 'the initiative docs are not present in this checkout';

const README = 'plugin/skills/codex-gate/README.md';
const SKILL = 'plugin/skills/codex-gate/SKILL.md';
/** Every `role: "doc"` source run 3 declared — the set a harvest must cover to be complete. */
const DOC_SURFACES = [README, SKILL];

/**
 * THE LEGAL FIXTURE, for the VALIDATOR half of this file.
 *
 * Run 3's map is not valid IR and cannot be: its capability table carries the column `"What it does"`,
 * which the closed table-column vocabulary refuses (`c25f599`) — that refusal is one of the defects
 * run 3 exists to record, and the artifact is frozen. So a validator test written against it could
 * only ever assert "one more error than before", which is a weaker statement than these rules deserve.
 * `tiny.map.json` validates clean, declares exactly ONE `role: "doc"` source, and carries
 * `env.tiny_debug` — evidenced, claimed only by a code comment, and therefore the exact node whose
 * UNDOCUMENTED status the attestation now gates. Every "expected exactly one error" below is exact
 * because of it.
 */
const TINY = path.join(HERE, 'fixtures', 'tiny.map.json');
const loadTiny = () => JSON.parse(fs.readFileSync(TINY, 'utf8'));
const TINY_DOC = 'plugin/skills/the-cartographer/references/fixtures/tiny/SKILL.md';
const TINY_CODE = 'plugin/skills/the-cartographer/references/fixtures/tiny/run.sh';
/**
 * A SECOND real, hashed documentation surface, for `5g` alone — the one test that needs a map
 * declaring TWO. It is the cartographer's own protocol document, which is where the obligation `5g`
 * pins is written, and it ships inside the plugin so the test runs in a standalone install too.
 * Nothing in `tiny.map.json` cites it: that is what makes DECLARING it and NOT declaring it two
 * equally legal maps, which is the whole of what `5g` compares.
 */
const TINY_DOC_2 = 'plugin/skills/the-cartographer/SKILL.md';

/** `tiny.map.json` with a harvest record hung on its one undocumented node. */
function tinyHarvest(docHarvest) {
  const map = loadTiny();
  map.nodes.find((n) => n.id === 'env.tiny_debug').docHarvest = docHarvest;
  return map;
}
const tinyErrors = (docHarvest) => validate(tinyHarvest(docHarvest), { repoRoot: REPO_ROOT }).errors;

const undocumented = (findings) => findings.filter((f) => f.class === 'UNDOCUMENTED').map((f) => f.nodeId).sort();
const classCounts = (findings) => findings.reduce((acc, f) => {
  acc[f.class] = (acc[f.class] ?? 0) + 1;
  return acc;
}, {});

/**
 * SIX of run 3's seven confirmed false accusations, with the real doc line that documents each — the
 * five the identifier sweep decided, and the one it structurally could not (see the header).
 *
 * Every quote below was read off the file at that line — these are not paraphrases — and every `line`
 * is inside its surface's declared length (README.md 239, SKILL.md 386). The seventh, item 6
 * `component.enforce_packet_budget`, is deliberately NOT here: it is test 3's `mentions` case.
 */
const FALSELY_ACCUSED = [
  { nodeId: 'component.resolve_run_dir', path: README, line: 91,
    quote: '`resolve_ledger_path` derives it from `resolve_run_dir`\'s `WORKTREE_DIR` (no drift).' },
  { nodeId: 'component.is_frontend_path', path: README, line: 166,
    quote: '**Lens set** (`resolve_lens_set` / `is_frontend_path`) — the core lenses `arch`, `security`, `tests` ALWAYS' },
  { nodeId: 'component.die_infra', path: README, line: 189,
    quote: 'persona — raised *before* lens jobs run, via `die_infra`) uses the base status shape **without** `lenses[]`.' },
  { nodeId: 'component.emit_investigate_outcome', path: README, line: 220,
    quote: '**Outcome mapping** (`emit_investigate_outcome`, fails closed exactly like `emit_outcome`/`emit_question_outcome`):' },
  { nodeId: 'component.emit_question_outcome', path: README, line: 220,
    quote: '**Outcome mapping** (`emit_investigate_outcome`, fails closed exactly like `emit_outcome`/`emit_question_outcome`):' },
  // Item 7 — ZERO identifier hits in either doc surface; found by SYNONYM. The sentence runs
  // `SKILL.md:317-321` under the heading "Write `<RUNDIR>/context.md` before `phase-review`"; :320 is
  // the line that carries the assertion, and it names the helper by its role ("the wrapper").
  { nodeId: 'component.append_context_if_present', path: SKILL, line: 320,
    quote: '(the `RUNDIR=` line is printed by `phase-start`) and the wrapper folds it into the packet under a' },
];

/**
 * The three oracle env-var nodes. Their evidence sits at `codex-gate.sh:41`, `:42` and `:61`, none of
 * them carries a claim of any kind, and the docs really are silent about them — so a COMPLETE harvest
 * over both doc surfaces genuinely finds nothing, and they must STILL fire. They are the control: a
 * fix that silences the false accusations by silencing everything would be caught here.
 */
const TRULY_UNDOCUMENTED = [
  'env.codex_gate_max_file_lines', // codex-gate.sh:61
  'env.codex_gate_runs', //           codex-gate.sh:42
  'env.codex_home_dir', //            codex-gate.sh:41
];

/** A complete harvest — every declared doc surface searched — carrying the candidates given. */
const completeHarvest = (candidates = []) => ({ searched: [...DOC_SURFACES], candidates });

/** Deep clone through JSON: the IR is plain JSON data by contract, so this is total. */
const clone = (v) => JSON.parse(JSON.stringify(v));

/** Drop the nodes named, then re-prune the edges and views that referenced them. Legal IR out. */
function pruneNodes(map, drop) {
  const gone = new Set(drop);
  map.nodes = map.nodes.filter((n) => !gone.has(n.id));
  const kept = new Set(map.nodes.map((n) => n.id));
  map.edges = map.edges.filter((e) => kept.has(e.from) && kept.has(e.to));
  const keptEdges = new Set(map.edges.map((e) => e.id));
  for (const view of map.views) {
    if (Array.isArray(view.nodes)) view.nodes = view.nodes.filter((id) => kept.has(id));
    if (Array.isArray(view.edges)) view.edges = view.edges.filter((id) => keptEdges.has(id));
  }
  return map;
}

/**
 * `tiny.map.json` with its ONE `role: "doc"` source REMOVED — a map that declares nowhere to look.
 *
 * Legal IR, deliberately: every claim and contradiction citing the removed surface goes with it, and
 * so do the two nodes the removal would leave uncited. `validate()` returns zero errors on it (test
 * 1c asserts that outright), which is the whole point — the vacuous-completeness hole is reachable
 * from a map the contract ACCEPTS, not only from a malformed one.
 */
function tinyWithoutDocSurface() {
  const map = loadTiny();
  map.sources = map.sources.filter((s) => s.path !== TINY_DOC);
  map.coverage.read = map.coverage.read.filter((p) => p !== TINY_DOC);
  // `mode.build` and `component.dispatch_table` are documented ONLY by the removed surface; without
  // it they cite nothing at all, which is a different validation error about a different subject.
  pruneNodes(map, ['mode.build', 'component.dispatch_table']);
  for (const node of map.nodes) {
    node.claims = node.claims.filter((c) => c.path !== TINY_DOC);
    if (!node.contradictions) continue;
    node.contradictions = node.contradictions.filter((c) => c.claim.path !== TINY_DOC);
    if (node.contradictions.length === 0) delete node.contradictions;
  }
  // The harvest can no longer NAME a surface, because the map declares none to name.
  map.nodes.find((n) => n.id === 'env.tiny_debug').docHarvest = { searched: [], candidates: [] };
  return map;
}

/**
 * A map with ZERO drift findings that is nonetheless NOT a clean subject.
 *
 * One node — `env.tiny_debug` — carries code evidence and no `doc` claim, and no harvest ran for it,
 * so the map never established whether the documentation is silent about it. Everything that would
 * have raised a finding is removed, so `findings` is genuinely empty and the renderers' zero-findings
 * branch is the one under test.
 */
function harvestedNothingMap() {
  const map = loadTiny();
  pruneNodes(map, ['mode.build', 'component.dispatch_table']); // the one PHANTOM, and an inferred node
  for (const node of map.nodes) delete node.contradictions; // both STALEs
  delete map.nodes.find((n) => n.id === 'env.tiny_debug').docHarvest; // …and the one UNDOCUMENTED
  return map;
}

/**
 * The same map with that last node REMOVED — zero findings and nothing withheld: genuinely clean.
 *
 * It used to reach "clean" by pushing a `doc` claim onto `env.tiny_debug` quoting
 * "`TINY_DEBUG=1` prints each mode as it starts." at `SKILL.md:5`. **`SKILL.md:5` is `## Modes`.**
 * That sentence is `run.sh:5`, a code comment, and the fixture subject's documentation says nothing
 * about `TINY_DEBUG` at all — which is precisely why it is the fixture's undocumented node. So the
 * map called "genuinely clean" was clean only because it carried a FABRICATED documentation claim:
 * the exact defect class this skill exists to detect, planted in the test that proves the clean
 * wording is earned. Pruning the node reaches the same state — every remaining evidenced node really
 * is documented — and asserts nothing the fixture does not say.
 */
function cleanMap() {
  return pruneNodes(harvestedNothingMap(), ['env.tiny_debug']);
}

/**
 * Run 3's map, DERIVED — never edited on disk.
 *
 *   • each falsely-accused node gets a COMPLETE harvest whose candidate at the real doc line is
 *     dispositioned `asserts`, plus the `doc` claim that disposition obliges — five on README.md and
 *     one on SKILL.md, the synonym find, so the fixture exercises both surfaces rather than assuming
 *     every repaired line lives in the README;
 *   • each truly-undocumented env node gets a COMPLETE harvest that found NOTHING;
 *   • every other node keeps no harvest at all, and so stays in state 3.
 */
function run3WithHarvests() {
  const map = clone(loadRun3());
  const byId = new Map(map.nodes.map((n) => [n.id, n]));

  for (const { nodeId, path: docPath, line, quote } of FALSELY_ACCUSED) {
    const node = byId.get(nodeId);
    assert.ok(node, `run 3 must carry ${nodeId}`);
    node.docHarvest = completeHarvest([{ path: docPath, line, quote, disposition: 'asserts' }]);
    // The candidate is PROMOTED to a claim. That — and not the disposition — is what documents it.
    node.claims.push({ path: docPath, line, text: quote, claimKind: 'doc', checked: true });
  }
  for (const nodeId of TRULY_UNDOCUMENTED) {
    const node = byId.get(nodeId);
    assert.ok(node, `run 3 must carry ${nodeId}`);
    node.docHarvest = completeHarvest([]);
  }
  return map;
}

// ─── 1 · the fail-closed guarantee, on the real artifact ─────────────────────────────────────────

test('1 · run 3 has no harvest records, so decision F turns its 37 UNDOCUMENTED findings into 0', (t) => {
  if (!run3Present) return t.skip(NO_DOCS);
  const map = loadRun3();

  // The BEFORE, recomputed here from C-014's bare mechanical rule rather than quoted from a document:
  // evidence, no `doc` claim, not inferred. This is exactly the population that used to be accused.
  const mechanical = map.nodes.filter((n) => n.inferred !== true
    && Array.isArray(n.evidence) && n.evidence.length > 0
    && !n.claims.some((c) => c.claimKind === 'doc')).map((n) => n.id).sort();
  assert.equal(mechanical.length, 37,
    'the mechanical C-014 rule accuses 37 of run 3\'s nodes — the population decision F re-gates');

  // …and the AFTER. Not one of them carries a `docHarvest`, so not one of them is in state 2.
  assert.equal(map.nodes.filter((n) => n.docHarvest !== undefined).length, 0,
    'run 3 predates the attestation: no node carries a harvest record');

  const { findings } = computeDrift(map);
  assert.deepEqual(undocumented(findings), [],
    'ABSENCE of a harvest is state 3, never state 2 — a legacy map accuses nobody of being undocumented');
});

test('1b · the fail-closed gate touches UNDOCUMENTED ONLY — PHANTOM, STALE and UNVERIFIED are untouched', (t) => {
  if (!run3Present) return t.skip(NO_DOCS);
  const { findings } = computeDrift(loadRun3());
  assert.deepEqual(classCounts(findings), { PHANTOM: 1, STALE: 5, UNVERIFIED: 2 },
    'run 3\'s other three classes keep exactly the counts they had before decision F');
});

test('1c · a map that declares NO documentation surface establishes NOTHING — vacuous completeness is state 3', () => {
  // THE HOLE. Completeness is derived by checking `searched` against the map's declared `role:"doc"`
  // sources. With no such source declared, `missing` is empty VACUOUSLY — empty is all of nothing —
  // so an empty harvest read as a COMPLETE one and the node was accused on an attestation that names
  // no surface as searched (ATTESTED, NOT OBSERVED — ADR C-018 amendment; this comment said "after no
  // search at all", which claims something about the world that nothing here can observe).
  //
  // It is also the only move the contract left an extractor here: `validate.mjs` refuses a `searched`
  // entry whose source is not declared `role:"doc"`, so on this map `searched: []` is the ONLY legal
  // record, and the legal record was the one that bought a finding.
  const map = tinyWithoutDocSurface();
  assert.deepEqual(validate(map, { repoRoot: REPO_ROOT }).errors, [],
    'fixture precondition: the hole must be reachable from a map the contract ACCEPTS');

  const { findings, coverage } = computeDrift(map);
  assert.deepEqual(coverage.docSurfaces, [], 'fixture precondition: the map declares nowhere to look');

  assert.deepEqual(undocumented(findings), [],
    'absence of a documentation surface is not evidence that the documentation is silent — it is '
    + 'evidence that the map does not know where to look, which is state 3');
  assert.deepEqual(coverage.established, [],
    'and nothing at all can be ESTABLISHED as undocumented by a map with no documentation surface');

  const withheld = coverage.withheld.find((w) => w.nodeId === 'env.tiny_debug');
  assert.ok(withheld, 'the node carrying the vacuously-complete harvest is withheld instead');
  assert.deepEqual(withheld.missing, [], 'there is no surface to name as unread — that IS the reason');
  assert.match(withheld.reason, /declares no .*doc.* source/,
    'and the reason names the map\'s missing declaration rather than the node\'s missing record');
});

// ─── 2 · the false accusations stop, and the true ones survive ───────────────────────────────────

test('2 · a complete harvest separates the 6 repaired false accusations from the 3 real ones', (t) => {
  if (!run3Present) return t.skip(NO_DOCS);
  const map = run3WithHarvests();
  const { findings } = computeDrift(map);
  const accused = undocumented(findings);

  for (const { nodeId } of FALSELY_ACCUSED) {
    assert.ok(!accused.includes(nodeId),
      `${nodeId} is documented in README.md — decision F must stop accusing it`);
  }
  // The control. Silencing the false five by silencing everything would fail right here.
  assert.deepEqual(accused, [...TRULY_UNDOCUMENTED].sort(),
    'exactly the three nodes whose COMPLETE harvest genuinely found nothing still fire');
});

test('2b · the derived fixture buys its result with NO new validation error', (t) => {
  if (!run3Present) return t.skip(NO_DOCS);
  // Run 3's map is already illegal — see TINY above — so the honest statement is a DELTA: adding the
  // harvest records and their promoted claims introduces nothing the validator objects to.
  const before = validate(loadRun3(), { repoRoot: REPO_ROOT }).errors;
  const after = validate(run3WithHarvests(), { repoRoot: REPO_ROOT }).errors;
  assert.deepEqual(after, before,
    'the attestation must not make a map less legal than it already was');

  // Run 3's pre-existing errors, each a rule written AFTER it and each left standing on the frozen
  // artifact rather than repaired into it: the closed table-column vocabulary (`c25f599`), and the
  // requirement that a contradiction name the text its evidence refutes (2026-08-14) — which run 3
  // predates on all five of its records. The property this test asserts is the DELTA above; the count
  // is spelled out so a NEW error would still be noticed rather than absorbed.
  assert.ok(before.some((e) => /is not a derivable column/.test(e)),
    'the closed-column refusal is run 3\'s original recorded violation');
  assert.equal(before.filter((e) => /refutedQuote/.test(e)).length, 5,
    'and each of its five contradiction records predates the refuted-claim rule');
  assert.equal(before.length, 6, 'those, and nothing else');
});

test("2c · run 4 carries ONE refutedQuote violation, and it is the ABSENT-field kind — the ADR's sentence, pinned", (t) => {
  if (!run4Present) return t.skip(NO_DOCS);
  // THE SYMMETRY THIS RESTORES. The test above pins run 3's FIVE pre-C-019 contradiction records
  // against the frozen artifact, so neither the record nor the rule can drift without a test saying
  // so. Run 4's map was pinned for nothing of the sort: `4d` below runs `computeDrift` on it and never
  // `validate`, so the ADR's sentence about it — "the committed map separately carries one pre-C-019
  // `refutedQuote` violation" (ADR.md, *C-018 amendment · the harvest is an extractor ATTESTATION*,
  // residual 1's scope note) — rested on a measurement nobody re-ran. That sentence is load-bearing:
  // it is what licenses residual 1's 20 → 35 measurement to be read as a HARVEST result, by
  // accounting for the errors on that map which are NOT harvest errors.
  //
  // WHICH BRANCH, and why the distinction is the point. `refutedQuote` can fail two ways, and
  // `diff.mjs` treats them OPPOSITELY: an ABSENT field is passed through untouched, so a frozen
  // pre-C-019 map keeps its STALE findings, while a field that is PRESENT and inconsistent with the
  // claim it names fails closed and refuses the record. Run 4 is the first kind. A test that only
  // counted "one error mentioning refutedQuote" would go on passing if the frozen record acquired an
  // inconsistent quote instead — a change that silently deletes a finding from `drift.json`.
  const map = loadRun4();
  const records = map.nodes.flatMap((n) => (n.contradictions ?? []).map((c) => ({ nodeId: n.id, c })));
  assert.equal(records.length, 1, 'the frozen map records exactly one contradiction');
  assert.equal(records[0].nodeId, 'mode.prepr');
  assert.ok(!('refutedQuote' in records[0].c),
    'and the KEY is absent — not present-and-empty, and not present-and-wrong');

  const errors = validate(map, { repoRoot: REPO_ROOT }).errors;
  assert.equal(errors.length, 1, `expected exactly one error, got ${JSON.stringify(errors)}`);
  assert.match(errors[0], /\.refutedQuote: is REQUIRED/,
    'the ONE violation is the required-and-missing branch, which is what "pre-C-019" means here');
  assert.ok(!/does not appear in/.test(errors[0]),
    'and NOT the inconsistent-quote branch — that one fails closed in diff.mjs and would cost a finding');
  assert.equal(errors.filter((e) => /refutedQuote/.test(e)).length, 1,
    'exactly one, so a second frozen record going stale is a test failure rather than a rounding error');
});

// ─── 3 · a mention is not a claim ────────────────────────────────────────────────────────────────

test('3 · a complete harvest whose only candidate is a MENTION still raises UNDOCUMENTED', (t) => {
  if (!run3Present) return t.skip(NO_DOCS);
  const map = clone(loadRun3());
  const node = map.nodes.find((n) => n.id === 'component.enforce_packet_budget');
  assert.ok(node, 'run 3 must carry component.enforce_packet_budget');

  // README.md:122, read verbatim off the file. It is a POSITIONAL LANDMARK — it says where the
  // trigger sits relative to `enforce_packet_budget`, and never says what `enforce_packet_budget`
  // does, defaults to, or is. The harvester found it; the harvester must not be able to bank it.
  //
  // THIS IS RUN 3'S SEVENTH FALSE ACCUSATION, AND IT IS THE ONE THIS FILE DOES NOT REPAIR — said
  // outright, because the difference is a judgement and not an oversight. `oracle-run-3.md` item 6
  // filed it as a false accusation and marked it **the marginal one**, reading the sentence as
  // predicating "fires on an over-budget packet" of the function. The C-018 addendum then drew the
  // boundary explicitly — a comparison asserts of what it compares; a positional landmark predicates
  // nothing of the item it locates — and run 4's harvest dispositioned this same line `mentions`-only
  // for this node while promoting it to `asserts` for `_prepr_common`, the function the sentence is
  // actually about. That is the direction that KEEPS the finding, and it is the reading under test.
  // ONE CANDIDATE, DELIBERATELY — and a round-8 "completeness" fix that added two more is REVERTED
  // here (round-9 gate). This record is SYNTHETIC and models one shape: a harvest that covers every
  // declared surface and returns a single MENTION. That is the whole hypothesis under test, and
  // `SKILL.md:60` / `:349` were added to it on the reasoning that a complete record must carry every
  // sweep hit. Two things were wrong with that. It changed what the test tests — "whose ONLY candidate
  // is a MENTION" stopped being true of its own fixture. And it dispositioned both lines `mentions`
  // while **run 4's committed map dispositions both `asserts`**, with two promoted `doc` claims: a
  // test asserting the opposite of the frozen record on the same two lines. The exhaustive-sweep
  // obligation belongs to `real-subject.test.mjs`'s DOC_AUDIT, which audits real surfaces; it does not
  // belong to a synthetic record built to isolate one shape.
  node.docHarvest = completeHarvest([{
    path: README,
    line: 122,
    quote: '(no sharding). The trigger lives in `_prepr_common` right where `enforce_packet_budget` would fire.',
    disposition: 'mentions',
  }]);

  const { findings, coverage } = computeDrift(map);
  assert.ok(undocumented(findings).includes('component.enforce_packet_budget'),
    'a mention is not documentation — on THIS record the node is harvest-complete and undocumented');
  // …and it fires because the harvest was ESTABLISHED, not because the gate is absent. Without this
  // second half the test would pass against a build with no gate at all, and a test that cannot fail
  // for the right reason is not evidence. It is also what discriminates against the naive reading:
  // an implementation where any candidate suppresses the finding fails the line above, and one where
  // a `mentions` candidate leaves the node UNSEARCHED fails this one.
  assert.ok(coverage.established.includes('component.enforce_packet_budget'),
    'the node is in state 2 — a complete harvest looked, and what it found was not documentation');
  assert.ok(!coverage.withheld.some((w) => w.nodeId === 'component.enforce_packet_budget'));
});

/**
 * THE TWO CANDIDATES BELOW ARE HUNG ON THE NODE THE QUOTED LINE IS ACTUALLY ABOUT.
 *
 * Both used to sit on `env.tiny_debug`, quoting `SKILL.md:16` — the line that documents
 * `component.tiny_core` — so the fixture asserted, in a map it then called legal, that a sentence
 * about the shared routine was a harvest hit for the debug env var. The disposition rules are a
 * judgement about WHAT A LINE SAYS ABOUT A GIVEN NODE (§3.1: "ask it per node, not per line"), so a
 * fixture that pairs a line with the wrong node is not testing them; and a fixture that fabricates
 * documentation is the defect this skill detects, one level down. `tiny/SKILL.md` says nothing about
 * `TINY_DEBUG` at all — which is exactly why that node is the fixture's undocumented one.
 *
 * The two lines used here, read off the file:
 *   • `:16`  "`tiny_core` is the shared routine every mode calls."  — says what it IS: `asserts`.
 *   • `:8`   "- `check` — runs the core routine and prints `check ran`."  — names it by synonym ("the
 *     core routine") inside an entry ABOUT `check`, and predicates nothing of the routine itself:
 *     `mentions`. A reader learns that `check` calls it, and nothing about what it does.
 */
const TINY_ASSERTS = {
  path: TINY_DOC, line: 16, quote: '`tiny_core` is the shared routine every mode calls.',
};
const TINY_MENTIONS = {
  path: TINY_DOC, line: 8, quote: '- `check` — runs the core routine and prints `check ran`.',
};

/** `tiny.map.json` with a harvest on `component.tiny_core`, optionally stripped of its doc claim. */
function tinyCoreHarvest(docHarvest, { promoted = true } = {}) {
  const map = loadTiny();
  const node = map.nodes.find((n) => n.id === 'component.tiny_core');
  node.docHarvest = docHarvest;
  if (!promoted) node.claims = [];
  return map;
}
const tinyCoreErrors = (...args) => validate(tinyCoreHarvest(...args), { repoRoot: REPO_ROOT }).errors;

test('3b · a `mentions` candidate obliges nothing; an `asserts` candidate MUST be promoted to a doc claim', () => {
  assert.deepEqual(
    tinyCoreErrors({ searched: [TINY_DOC], candidates: [{ ...TINY_MENTIONS, disposition: 'mentions' }] }),
    [],
    'a mention is recorded and dispositioned — it obliges nothing',
  );

  // The asserting line, with no claim behind it. A disposition that could silence a finding without a
  // claim would BE the fuzzy auto-suppression decision F forbids, so the obligation is enforced
  // rather than trusted.
  const errors = tinyCoreErrors(
    { searched: [TINY_DOC], candidates: [{ ...TINY_ASSERTS, disposition: 'asserts' }] },
    { promoted: false },
  );
  assert.equal(errors.length, 1, `expected exactly one error, got ${JSON.stringify(errors)}`);
  assert.match(errors[0], /docHarvest\.candidates\[0\][\s\S]*asserts[\s\S]*doc/);
});

test('3c · promoting the `asserts` candidate to a claim satisfies the validator AND documents the node', () => {
  // The CONTROL: the same node, harvested completely, with the documentation neither found nor
  // claimed. It is accused — so the difference below is the promotion and nothing else.
  const bare = tinyCoreHarvest({ searched: [TINY_DOC], candidates: [] }, { promoted: false });
  assert.deepEqual(validate(bare, { repoRoot: REPO_ROOT }).errors, []);
  assert.ok(undocumented(computeDrift(bare).findings).includes('component.tiny_core'),
    'control: a complete harvest that found nothing accuses the node');

  const map = tinyCoreHarvest(
    { searched: [TINY_DOC], candidates: [{ ...TINY_ASSERTS, disposition: 'asserts' }] },
    { promoted: false },
  );
  // The promotion: the same path and line, with the harvest's `quote` written as the claim's `text`.
  map.nodes.find((n) => n.id === 'component.tiny_core').claims.push({
    path: TINY_ASSERTS.path, line: TINY_ASSERTS.line, text: TINY_ASSERTS.quote,
    claimKind: 'doc', checked: true,
  });

  assert.deepEqual(validate(map, { repoRoot: REPO_ROOT }).errors, []);
  assert.ok(!undocumented(computeDrift(map).findings).includes('component.tiny_core'),
    'and it is the CLAIM that documents it — state 1, reached the only way it can be');
});

test('3d · the PROTOCOL and this file agree about README.md:220 — a comparison can ASSERT', (t) => {
  if (!run3Present) return t.skip(NO_DOCS);
  // The fixture above dispositions `**Outcome mapping** (`emit_investigate_outcome`, fails closed
  // exactly like `emit_outcome`/`emit_question_outcome`):` as `asserts` for BOTH compared functions,
  // and the ADR lists `emit_question_outcome` among the confirmed false accusations — i.e. that line
  // documents it. "X fails closed exactly like Y" predicates FAILING CLOSED of Y; it is a statement
  // about Y's behaviour, not a pointer to where Y lives. So §3.1 may not offer a bare "a comparison"
  // as a canonical `mentions`: what makes a hit a mention is that it predicates NOTHING of the item.
  const skill = fs.readFileSync(path.join(HERE, '..', 'SKILL.md'), 'utf8');
  const bullets = /\n- \*\*`asserts`\*\*([\s\S]*?)\n- \*\*`mentions`\*\*([\s\S]*?)\n\n/.exec(skill);
  assert.ok(bullets, 'SKILL.md §3.1 must carry the two disposition bullets');
  const [, asserts, mentions] = bullets;

  assert.match(asserts, /fails closed exactly like/,
    'the `asserts` bullet must rule on the very sentence this file dispositions that way');
  assert.doesNotMatch(mentions, /a comparison/,
    'a bare "a comparison" in the `mentions` list contradicts the fixture about one shared sentence');
  assert.match(mentions, /predicat/,
    'the mentions rule is that the text predicates nothing of the item — say that, not "a comparison"');

  // …and the fixture side of the agreement, read off the derived map rather than restated.
  const node = run3WithHarvests().nodes.find((n) => n.id === 'component.emit_question_outcome');
  const at220 = node.docHarvest.candidates.filter((c) => c.line === 220);
  assert.deepEqual(at220.map((c) => c.disposition), ['asserts'],
    'README.md:220 is an assertion ABOUT emit_question_outcome on this side of the agreement');
  assert.ok(node.claims.some((c) => c.claimKind === 'doc' && c.line === 220),
    'and it is promoted, which is what actually documents the node');
});

// ─── 4 · a partial harvest does not qualify ──────────────────────────────────────────────────────

test('4 · searching SOME but not ALL declared doc surfaces is state 3, not state 2', (t) => {
  if (!run3Present) return t.skip(NO_DOCS);
  const map = clone(loadRun3());
  const node = map.nodes.find((n) => n.id === 'env.codex_gate_runs');
  // README.md searched, SKILL.md not. Completeness is DERIVED from the two lists, so a `searched`
  // that omits a declared surface is incomplete by comparison — not because anything checked whether
  // either file was read. Nothing here can (ADR C-018 amendment); the derivation is the whole gate.
  node.docHarvest = { searched: [README], candidates: [] };

  const { findings, coverage } = computeDrift(map);
  assert.ok(!undocumented(findings).includes('env.codex_gate_runs'),
    'a harvest that skipped a declared doc surface may not accuse');

  const withheld = coverage.withheld.find((w) => w.nodeId === 'env.codex_gate_runs');
  assert.ok(withheld, 'the node must appear in the coverage statement instead');
  assert.deepEqual(withheld.missing, [SKILL], 'and the statement must name the surface it did not read');
});

/**
 * A record whose `searched` list COVERS every declared surface, and which is malformed everywhere
 * else. Each is a shape `validate.mjs` refuses, paired with the coverage it would otherwise buy.
 *
 * The gate read ONE slot — `searched`, filtered down to its non-empty strings — so everything the
 * record says about itself went unexamined and any of these reached state 2 and accused.
 *
 * The two candidate-bearing entries quote `SKILL.md:16` in full, which is a line the fixture really
 * carries. It documents `tiny_core` rather than the node this record hangs on — deliberately not
 * repaired, because each of these records is refused for its SHAPE before any disposition is read,
 * so nothing downstream ever interprets the pairing. Where the pairing IS the point, the candidate
 * sits on the node the line is about: see `TINY_ASSERTS` / `TINY_MENTIONS` and test 4e.
 */
const MALFORMED_ATTESTATIONS = [
  // EVERY self-grading key, generated from the production vocabulary rather than a copy of it:
  // the suite used to exercise `complete` alone, so dropping `incomplete`, `covered` or
  // `exhaustive` from either enforcement point would have left it green (round-6 gate).
  ...DOC_HARVEST_FORBIDDEN_KEYS.map((key) => [
    `a record grading its own completeness via \`${key}\``,
    { searched: [TINY_DOC], candidates: [], [key]: true },
  ]),
  ['a non-string among the surfaces searched', { searched: [TINY_DOC, 42], candidates: [] }],
  ['the same surface named twice', { searched: [TINY_DOC, TINY_DOC], candidates: [] }],
  ['a surface this map never declared', { searched: [TINY_DOC, 'docs/imagined-manual.md'], candidates: [] }],
  ['no `candidates` array at all — nothing said about what was FOUND', { searched: [TINY_DOC] }],
  ['a candidate with no disposition', {
    searched: [TINY_DOC],
    candidates: [{ path: TINY_DOC, line: 16, quote: '`tiny_core` is the shared routine every mode calls.' }],
  }],
  ['a candidate quoting nothing at the line it names', {
    searched: [TINY_DOC],
    candidates: [{ path: TINY_DOC, line: 16, disposition: 'mentions' }],
  }],
];

/**
 * ADR C-018 is explicit that undeclared documentation surfaces MAY exist and that the pipeline observes
 * only the DECLARATION. A withheld reason is rendered prose, so a reason asserting that no surface
 * existed, or that no search happened, states a fact about the world this pipeline cannot observe —
 * the same overclaim the C-018 amendment retired from `markdown.mjs` and `SKILL.md`.
 */
const WORLD_CLAIMS = [
  ['that no surface EXISTED', /there (?:was|is) no documentation surface/i],
  ['that no search HAPPENED', /\bno search (?:was )?(?:ran|run|happened|occurred)\b/i],
];

// DELIBERATELY NOT A THIRD PATTERN for "a search was verified". The obvious regex —
// /search(ed|ing)?[^.]{0,80}(verified|confirmed|established)/ — fires on the honest reason "…derived
// from what was searched, never asserted by the extractor, so the map has NOT ESTABLISHED that the
// documentation is silent about it", because it cannot see the negation. That prose is the opposite
// of an overclaim. Rendered output is where the search-verification prohibition belongs and where it
// already lives (test 15c); this sweep stays on the claim it can decide: a real-world ABSENCE.

test('4c1 · no withheld REASON asserts a real-world absence — only what the map declares', () => {
  // Every state-3 shape this file can reach, swept in one place so a new reason cannot quietly
  // reintroduce the overclaim on a branch nobody thought to check (round-6 gate).
  const maps = [
    ['no role:"doc" source declared', tinyWithoutDocSurface()],
    ['no docHarvest record at all', (() => {
      // The key is DELETED, not set to `undefined` — a present-but-undefined key is a shape the
      // contract refuses outright, which is a different branch from "this node carries no record".
      const m = loadTiny();
      delete m.nodes.find((n) => n.id === 'env.tiny_debug').docHarvest;
      return m;
    })()],
    ...MALFORMED_ATTESTATIONS.map(([what, record]) => [what, tinyHarvest(record)]),
  ];
  let seen = 0;
  for (const [what, map] of maps) {
    for (const w of computeDrift(map).coverage.withheld) {
      seen += 1;
      for (const [claim, pattern] of WORLD_CLAIMS) {
        assert.doesNotMatch(w.reason, pattern,
          `${what}: the withheld reason claims ${claim}, which the pipeline never observes — `
          + `state what the MAP DECLARES instead (got ${JSON.stringify(w.reason)})`);
      }
    }
  }
  assert.ok(seen > 0, 'precondition: the sweep must actually reach some withheld verdicts');
});

test('4i · a source whose ROLE the contract cannot read leaves the surface set UNKNOWN', () => {
  // THE FOURTH FAIL-OPEN OF THE SAME FAMILY (round-7 gate): `validate()` refusing a map while
  // `computeDrift()` accuses on it anyway. `docDeclarationDefect` asked `source.role === 'doc'`, so an
  // entry whose role is neither `code` nor `doc` answered "not documentation" and was skipped — but an
  // unreadable role is exactly the case where whether it IS a doc surface is unknown. That is the
  // argument the same predicate already makes for an unreadable PATH, applied to the other field that
  // decides membership of the set a complete harvest must cover.
  const map = loadTiny();
  map.sources.push({
    path: 'plugin/skills/the-cartographer/references/fixtures/tiny/other.md',
    role: 'documentation', lines: 3, sha256: '0'.repeat(64),
  });

  assert.ok(validate(map, { repoRoot: REPO_ROOT }).errors.some((e) => /role/.test(e)),
    'precondition: the validator must refuse the illegible role');
  const { findings, coverage } = computeDrift(map);
  assert.ok(!undocumented(findings).includes('env.tiny_debug'),
    'a declaration the contract cannot read establishes nothing — it may not license an accusation');
  const withheld = coverage.withheld.find((w) => w.nodeId === 'env.tiny_debug');
  assert.ok(withheld, 'the node must appear in the coverage statement instead');
});

test('4j · an ILLEGIBLE doc path is named as such, not reported as "no doc source declared"', () => {
  // The empty-surface-set branch was tested BEFORE the declaration-defect branch, so a map whose sole
  // `role:"doc"` entry has an unreadable path fell into the first one and the reason told the reader
  // the map declares no documentation source. It declares one; the contract cannot read it. Naming the
  // wrong cause sends an extractor to add a source it already has (round-7 gate).
  const map = loadTiny();
  for (const source of map.sources) if (source.role === 'doc') source.path = '   ';

  assert.ok(validate(map, { repoRoot: REPO_ROOT }).errors.length > 0,
    'precondition: the validator refuses this map');
  const withheld = computeDrift(map).coverage.withheld.find((w) => w.nodeId === 'env.tiny_debug');
  assert.ok(withheld, 'precondition: the verdict is withheld');
  assert.doesNotMatch(withheld.reason, /declares no role:"doc" source/,
    `the map DOES declare one; the reason must name the illegible declaration (got ${JSON.stringify(withheld.reason)})`);
});

test('4k · a WHOLLY UNREADABLE sources entry leaves the surface set unknown — the fifth of this family', () => {
  // `null`, a scalar, an array: `docDeclarationDefect` opened with `if (!isRecord(source)) continue;`,
  // so an entry carrying no readable anything was skipped as "not documentation" while `validate()`
  // refused the map. Round 7 closed the illegible-ROLE case by the same argument and this one survived
  // it, which is the point: the guard has to be about what the contract CAN READ, not about which
  // field happens to be unreadable (round-8 gate).
  for (const [what, bad] of [['null', null], ['a scalar', 42], ['an array', ['x']]]) {
    const map = loadTiny();
    map.sources.push(bad);
    assert.ok(validate(map, { repoRoot: REPO_ROOT }).errors.length > 0,
      `${what}: precondition — the validator must refuse it`);
    const { findings, coverage } = computeDrift(map);
    assert.ok(!undocumented(findings).includes('env.tiny_debug'),
      `${what}: a declaration the contract cannot read may not license an accusation`);
    assert.ok(coverage.withheld.some((w) => w.nodeId === 'env.tiny_debug'),
      `${what}: the node must appear in the coverage statement instead`);
  }
});

test('4l · the withheld REASON names the field that is actually unreadable', () => {
  // `illegal` was one boolean for three different causes, so every one of them reported "a path the
  // path rules refuse". A map with a perfectly good path and `role: "documentation"` therefore sent
  // the reader to repair the path (round-8 gate).
  const roleBad = loadTiny();
  roleBad.sources.push({
    path: 'plugin/skills/the-cartographer/references/fixtures/tiny/other.md',
    role: 'documentation', lines: 3, sha256: '0'.repeat(64),
  });
  const roleReason = computeDrift(roleBad).coverage.withheld.find((w) => w.nodeId === 'env.tiny_debug').reason;
  assert.doesNotMatch(roleReason, /path rules refuse/,
    `the defect is the ROLE, not the path — the reason must not send a reader to the path (got ${JSON.stringify(roleReason)})`);
  assert.match(roleReason, /role/i, 'and it must name the role');

  // …and the path case still names the path, or the fix traded one misdirection for another.
  const pathBad = loadTiny();
  for (const source of pathBad.sources) if (source.role === 'doc') source.path = '   ';
  const pathReason = computeDrift(pathBad).coverage.withheld.find((w) => w.nodeId === 'env.tiny_debug').reason;
  assert.match(pathReason, /path/i, 'the path case must still name the path');
});

test('4c0 · the self-grading vocabulary is exactly four keys, pinned', () => {
  // The list 4c generates from. Pinned so that SHRINKING it is a test failure rather than a silent
  // loss of coverage, and so that GROWING it obliges the new key to pass 4c as well.
  assert.deepEqual([...DOC_HARVEST_FORBIDDEN_KEYS].sort(),
    ['complete', 'covered', 'exhaustive', 'incomplete'],
    'PDR rule 17 closes this vocabulary; a change here is a contract change');
});

test('4c · a MALFORMED record fails closed, however completely its `searched` list reads', () => {
  for (const [what, record] of MALFORMED_ATTESTATIONS) {
    const map = tinyHarvest(record);
    const { findings, coverage } = computeDrift(map);

    assert.ok(!undocumented(findings).includes('env.tiny_debug'),
      `${what}: a record the contract cannot read is not a search this map can accuse on`);
    const withheld = coverage.withheld.find((w) => w.nodeId === 'env.tiny_debug');
    assert.ok(withheld, `${what}: the node must appear in the coverage statement instead`);
    assert.deepEqual(withheld.missing, [TINY_DOC],
      `${what}: nothing has been established about any declared surface`);
    assert.ok(withheld.reason.includes('docHarvest record'),
      `${what}: and the reason must name the record as the defect (got ${JSON.stringify(withheld.reason)})`);

    // …and the two artifacts AGREE about it: every shape the drift engine refuses to read is a shape
    // the validator reports, by path. A record only one of them objects to is the drift class this
    // skill exists to detect, one level down.
    assert.ok(validate(map, { repoRoot: REPO_ROOT }).errors.some((e) => /docHarvest/.test(e)),
      `${what}: validate() must report it too`);
  }
});

/**
 * The CROSS-FIELD defects — the second half of the same rule, and the half that was missing.
 *
 * Every shape in `MALFORMED_ATTESTATIONS` above is wrong on its own terms: read the record, see the
 * defect. These are not. Each is a record whose shape is impeccable and whose `searched` list covers
 * every declared surface, and which `validate.mjs` REFUSES anyway, because it contradicts something
 * else in the same map. The drift engine checked only the record's own shape, so each reached state 2
 * and ACCUSED on maps the contract rejects — which is the state-3 rule ("a record the contract cannot
 * read") failing open through the one door nobody had closed.
 *
 * Each was reproduced accusing before it was fixed, on `tiny.map.json`, with exactly one validator
 * error to show for it. The second is the worst of them and is the reason this is not a tidiness fix:
 * the node's OWN harvest records documentation, at a real line, in the file it says it searched — and
 * the map accuses that node of having none.
 *
 * WHY THE MATRIX GREW (2026-08-14, pre-PR review). This list was THREE cases and the agreement it
 * claimed — "the drift engine withholds on exactly the records the validator refuses" — was therefore
 * only SAMPLED. Two reproducible fail-open shapes sat outside the sample, and both were found by
 * asking which of the validator's own cross-field rules the drift engine had no counterpart for
 * rather than by adding more of the same shape:
 *
 *   • a candidate at a line PAST THE DECLARED LENGTH of the document it says it searched. The
 *     validator has the source's `lines` and refuses the citation; the harvest gate never looked at
 *     `lines` at all, so a hit at line 999 of an 18-line file established the accusation.
 *   • a surface in `coverage.read` AND in `coverage.skipped`. The validator treats coverage as a
 *     partition and refuses the second classification; the harvest gate read `coverage.read` as a
 *     bare membership test, so a file the map says in one breath it never opened still counted as
 *     fully read.
 *
 * Each entry is [what, nodeId, build, errorRe] — `errorRe` naming the validator error the same map
 * must produce, because these two land in `coverage` and in a citation rather than in the harvest
 * record's own keys, and asserting `/docHarvest/` for them would be asserting the wrong thing.
 */
const CROSS_FIELD_DEFECTS = [
  ['a hit found on a file the harvest never searched', 'env.tiny_debug', (map) => {
    // `run.sh:5` really does say this, and it really is about TINY_DEBUG — but it is a CODE file, not
    // a documentation surface, and it is not in `searched`. A harvest of the documentation may not
    // bank a hit from a file it never claims to have read.
    map.nodes.find((n) => n.id === 'env.tiny_debug').docHarvest = {
      searched: [TINY_DOC],
      candidates: [{
        path: TINY_CODE, line: 5, quote: '# TINY_DEBUG=1 prints each mode as it starts.',
        disposition: 'mentions',
      }],
    };
  }],
  ['an `asserts` candidate never promoted into `claims[]`', 'component.tiny_core', (map) => {
    // `SKILL.md:16` is the line that documents `tiny_core`, and the harvest FOUND it and dispositioned
    // it correctly. Only the promotion is missing — so the map holds, on the node itself, the exact
    // evidence that refutes the UNDOCUMENTED finding it used to buy.
    const node = map.nodes.find((n) => n.id === 'component.tiny_core');
    node.claims = [];
    node.docHarvest = {
      searched: [TINY_DOC],
      candidates: [{
        path: TINY_DOC, line: 16, quote: '`tiny_core` is the shared routine every mode calls.',
        disposition: 'asserts',
      }],
    };
  }],
  ['a searched surface the map\'s own coverage calls `skipped`', 'env.tiny_debug', (map) => {
    // The fixture's `env.tiny_debug` already records having searched this surface; reclassifying it is
    // what makes the map say, in two places, that the file both was and was not read.
    map.coverage.read = map.coverage.read.filter((p) => p !== TINY_DOC);
    map.coverage.skipped.push({ path: TINY_DOC, why: 'only the mode list was needed' });
  }],
  ['a candidate PAST THE END of the document it says it searched', 'env.tiny_debug', (map) => {
    // `tiny/SKILL.md` is declared as 18 lines, and the map is what says so. A hit at line 999 of it
    // is a quote from text that does not exist — the record cites a place a reader cannot open, which
    // is the one thing PDR §8 says a citation may never be. It reached state 2 because the harvest
    // gate never consulted the declared length, though the same map carries it.
    map.nodes.find((n) => n.id === 'env.tiny_debug').docHarvest = {
      searched: [TINY_DOC],
      candidates: [{
        path: TINY_DOC, line: 999, quote: 'TINY_DEBUG is documented here, honestly.',
        disposition: 'mentions',
      }],
    };
  }, /docHarvest[\s\S]*exceeds/],
  ['a candidate past the end of a document whose declared length is MALFORMED', 'env.tiny_debug', (map) => {
    // THE SAME HIT, WITH THE RULER BROKEN — and until 2026-08-14 that DISABLED the case above rather
    // than failing it. `declaredLengths()` keeps a source's length only when `sources[].lines` is an
    // integer, and the bounds check then ran only `if (Number.isInteger(declaredLength))`: a source
    // declaring `"18"` as a STRING dropped out of the map of lengths, the guard read `undefined`, and
    // the check was SKIPPED. So the cheapest way past the strictest rule in the harvest gate was to
    // break the field it measures against — the map that should be refused hardest was accepted.
    //
    // A malformed length is not "no length": every source MUST declare one (`validate.mjs` refuses
    // `"18"` outright, and does so on the very same map), so a length the contract cannot read means
    // the record CANNOT be checked, and an uncheckable record is state 3. Fail closed.
    map.sources.find((s) => s.path === TINY_DOC).lines = '18';
    map.nodes.find((n) => n.id === 'env.tiny_debug').docHarvest = {
      searched: [TINY_DOC],
      candidates: [{
        path: TINY_DOC, line: 999, quote: 'TINY_DEBUG is documented here, honestly.',
        disposition: 'mentions',
      }],
    };
  }, /sources\[\d+\]\.lines: must be a non-negative integer/],
  ['a searched surface classified in BOTH `read` and `skipped`', 'env.tiny_debug', (map) => {
    // The case above moves the surface out of `read`; this one LEAVES IT THERE and adds the second
    // classification, so `coverage.read` still contains it. The gate's membership test therefore
    // still succeeded, on a map that says in one place it read the file in full and in another that
    // it never opened it. Coverage is a partition — the validator refuses this outright — and reading
    // one bucket is not reading the partition.
    map.coverage.skipped.push({ path: TINY_DOC, why: 'only the mode list was needed' });
  }, /classified exactly once/],
];

test('4e · a record the contract refuses for a CROSS-FIELD reason fails closed too', () => {
  for (const [what, nodeId, build, errorRe = /docHarvest/] of CROSS_FIELD_DEFECTS) {
    // The CONTROL first, and it is what makes each case evidence rather than a tautology: with the
    // defect removed the very same node IS accused, so the withholding below is the gate acting and
    // not the node being uninteresting.
    const control = loadTiny();
    if (nodeId === 'component.tiny_core') {
      const node = control.nodes.find((n) => n.id === nodeId);
      node.claims = [];
      node.docHarvest = { searched: [TINY_DOC], candidates: [] };
    }
    assert.ok(undocumented(computeDrift(control).findings).includes(nodeId),
      `${what}: fixture precondition — without the defect this node is accused`);

    const map = loadTiny();
    build(map);
    const { findings, coverage } = computeDrift(map);

    assert.ok(!undocumented(findings).includes(nodeId),
      `${what}: a record the contract cannot accept is not a search this map can accuse on`);
    assert.ok(!coverage.established.includes(nodeId),
      `${what}: and nothing may be ESTABLISHED as undocumented on the strength of it`);
    const withheld = coverage.withheld.find((w) => w.nodeId === nodeId);
    assert.ok(withheld, `${what}: the node must appear in the coverage statement instead`);
    assert.deepEqual(withheld.missing, [TINY_DOC],
      `${what}: nothing has been established about any declared surface`);
    assert.ok(withheld.reason.includes('docHarvest record'),
      `${what}: and the reason must name the record as the defect (got ${JSON.stringify(withheld.reason)})`);

    // …and the two artifacts AGREE, which is the property that keeps them from drifting apart again:
    // the drift engine withholds on exactly the records the validator refuses, for the same reason.
    const errors = validate(map, { repoRoot: REPO_ROOT }).errors;
    assert.equal(errors.length, 1, `${what}: expected exactly one error, got ${JSON.stringify(errors)}`);
    assert.match(errors[0], errorRe, `${what}: validate() must report it too`);
  }
});

test('4f · a coverage PARTITION the contract cannot read establishes nothing about any surface', () => {
  // The third fail-open shape of the same family, and the one no per-path rule can reach: the buckets
  // themselves. `coverage.skipped` missing, or holding something that is not a list of classifications,
  // means the map has not stated a partition at all — so "is this surface classified read, and only
  // read?" has no answer, and the gate must decline rather than answer it optimistically from the one
  // bucket that happens to be well formed. `validate.mjs` refuses the map outright for the same reason.
  //
  // EXTENDED 2026-08-15 to the bucket ENTRIES, which is where this test stopped one level short and left
  // the same fail-open open. A bucket can be a perfectly good array and still not state a partition:
  // `readOnceSurfaces()` read `key === 'read' ? entry : (isRecord(entry) ? entry.path : null)` and then
  // DROPPED anything that was not a non-empty string, so a malformed entry was not a defect, it was
  // invisible. Probed before this was written: `TINY_DOC` pushed into `coverage.partial` as a BARE STRING
  // gives `validate()` one error — `coverage.partial[0]: must be an object { path, why }` — while
  // `computeDrift()` still establishes `env.tiny_debug` and accuses it, in ten distinct shapes.
  //
  // And the direction is exactly why dropping is never safe here: the dropped entry is a SECOND,
  // CONTRADICTORY classification of the very surface the accusation rests on. Counting it would have
  // taken `TINY_DOC` to two classifications and out of `readOnce`; ignoring it left the count at one and
  // the surface usable. A smaller input makes agreement easier, and agreement is the whole of state 2.
  for (const [what, broken] of [
    ['`skipped` absent entirely', (coverage) => { delete coverage.skipped; }],
    ['`partial` is not an array', (coverage) => { coverage.partial = 'none'; }],
    // ── the ENTRIES, each one a shape `validate.mjs` refuses ──────────────────────────────────────
    ['`partial` carries a BARE STRING naming the doc surface — a second classification of it',
      (coverage) => { coverage.partial.push(TINY_DOC); }],
    ['`skipped` carries a BARE STRING naming the doc surface',
      (coverage) => { coverage.skipped.push(TINY_DOC); }],
    ['`partial` carries a bare string naming an UNRELATED file — still not a classification',
      (coverage) => { coverage.partial.push(TINY_CODE); }],
    ['`partial` carries a null entry', (coverage) => { coverage.partial.push(null); }],
    ['`partial` carries a number entry', (coverage) => { coverage.partial.push(7); }],
    ['`partial` carries an ARRAY entry', (coverage) => { coverage.partial.push([TINY_DOC]); }],
    ['`skipped` carries an object whose path is not a string',
      (coverage) => { coverage.skipped.push({ path: 42, why: 'unreadable' }); }],
    ['`skipped` carries an object whose path is empty',
      (coverage) => { coverage.skipped.push({ path: '', why: 'unreadable' }); }],
    ['`read` carries a null entry', (coverage) => { coverage.read.push(null); }],
    ['`read` carries an OBJECT — the partial/skipped shape in the bucket that takes bare paths',
      (coverage) => { coverage.read.push({ path: TINY_DOC, why: 'wrong bucket shape' }); }],
  ]) {
    const control = loadTiny();
    assert.ok(undocumented(computeDrift(control).findings).includes('env.tiny_debug'),
      `${what}: fixture precondition — with a well-formed partition this node IS accused`);

    const map = loadTiny();
    broken(map.coverage);
    const { findings, coverage } = computeDrift(map);

    assert.ok(!undocumented(findings).includes('env.tiny_debug'),
      `${what}: a map whose coverage cannot be read has not established what it read`);
    assert.deepEqual(coverage.established, [],
      `${what}: and nothing at all may be established on it`);
    const withheld = coverage.withheld.find((w) => w.nodeId === 'env.tiny_debug');
    assert.ok(withheld, `${what}: the node must appear in the coverage statement instead`);
    assert.ok(withheld.reason.includes('docHarvest record'),
      `${what}: with a reason a reader can act on (got ${JSON.stringify(withheld.reason)})`);

    assert.ok(validate(map, { repoRoot: REPO_ROOT }).errors.some((e) => /coverage\./.test(e)),
      `${what}: validate() must refuse the same map`);
  }
});

/**
 * The DECLARATION ITSELF — the fourth face of the same rule, and the one that was still open.
 *
 * 4e and 4f both police the harvest RECORD and the coverage PARTITION: given a trustworthy set of
 * declared doc surfaces, does the node's own record earn state 2? Neither of them ever asked whether
 * that SET is trustworthy. `declaredDocSurfaces()` collected every non-empty `role: "doc"` path into a
 * `Set` and sorted it, which answers "what does `sources[]` say?" and not "is what `sources[]` says a
 * legible declaration at all?". Two shapes slip through that gap, and both are shapes `validate.mjs`
 * REFUSES:
 *
 *   • a doc surface whose PATH IS NOT A LEGAL PATH — a `..` traversal, a leading `/`, a backslash
 *     separator, a `.maps/` self-reference. Purely SYNTACTIC, so it needs no filesystem and no other
 *     part of the map: exactly the kind of rule this module already restates rather than defers, since
 *     the boundary it draws leaves the validator only what needs the FILESYSTEM or the whole document.
 *   • the SAME path DECLARED TWICE — as two `doc` entries, or as one `doc` and one `code`. Then "is
 *     this path a documentation surface?" has two answers in one map, and `declaredLengths()` silently
 *     keeps whichever `lines` it saw last, so the bounds check 4e added is measuring an arbitrary one
 *     of two declarations.
 *
 * WHY THIS IS A FAIL-OPEN AND NOT A TIDINESS FIX. The trio the gate compares — `sources[]`,
 * `coverage.read`, `docHarvest.searched` — can be made to AGREE on a bogus path. Agreement is the whole
 * of state 2, so the map reaches "harvest-complete" and ACCUSES, on a declaration the validator has
 * already refused. Probed before this test was written, on `tiny.map.json` with the bogus surface
 * threaded consistently through all three places: `validate()` reported 3 errors (1 for a duplicate)
 * and `computeDrift()` established `env.tiny_debug` as UNDOCUMENTED anyway, in six distinct shapes.
 * That is the state-3 rule ("a record the contract cannot read") failing open one door further out than
 * 4e closed — the door is the DECLARATION, not the record.
 *
 * The defect is the MAP's, not the node's, so it is reported the way the zero-surfaces case is: every
 * node awaiting a doc verdict is withheld, and the reason names `sources[]` rather than the record. No
 * record an extractor could write on a node can repair an illegible declaration.
 *
 * Each entry is [what, build, errorRe]. The last case withheld even BEFORE the fix — for an unrelated
 * reason, an unaccounted second surface — so it is kept and asserted on the reason, because a case that
 * passes by accident is not evidence that the rule fired.
 */
const DECLARATION_DEFECTS = [
  ['a doc surface declared with a ".." traversal path',
    (map) => addDocSurface(map, `${path.posix.dirname(TINY_DOC)}/../tiny/SKILL.md`),
    /must not contain "\." or "\.\." segments/],
  ['a doc surface declared with an absolute path',
    (map) => addDocSurface(map, '/etc/passwd'), /must be repo-relative/],
  ['a doc surface declared with backslash separators',
    (map) => addDocSurface(map, 'plugin\\skills\\tiny\\SKILL.md'), /found a backslash/],
  ['a doc surface declared under `.maps/` — the subject\'s own output',
    (map) => addDocSurface(map, '.maps/the-cartographer/map.json'), /must not point under "\.maps\/"/],
  ['the SAME doc surface declared twice, both `role: "doc"`',
    (map) => redeclare(map, TINY_DOC, 'doc'), /duplicate source path/],
  ['a doc surface ALSO declared `role: "code"` — one path, two contradictory roles',
    (map) => redeclare(map, TINY_DOC, 'code'), /duplicate source path/],
  ['a CODE source ALSO declared `role: "doc"` — the same contradiction the other way',
    (map) => redeclare(map, TINY_CODE, 'doc'), /duplicate source path/],
  // ── 2026-08-15: a doc surface whose PATH THE CONTRACT CANNOT READ AT ALL ────────────────────────
  //
  // A DEFECT IN THE PREVIOUS ROUND'S OWN FIX, which is why it is worth naming as one. The loop the four
  // cases above added opened with `if (!isRecord(source) || !nonEmptyString(source.path)) continue;` —
  // it skipped an unreadable path BEFORE ever asking whether the entry was `role: "doc"`. So the very
  // shapes most obviously illegible were the ones the new check could not see: the guard against bogus
  // declarations was itself guarded against by a `continue`.
  //
  // Probed before these were written, each with ONE validator error and an accusation anyway: an empty
  // path, a whitespace-only path, a tab-only path, a `null` path, a number, an array, and the `path` key
  // simply absent — seven shapes, `computeDrift()` establishing `env.tiny_debug` in every one.
  //
  // NOT threaded through `coverage.read` and `docHarvest.searched` the way `addDocSurface` threads a
  // legible bogus path, and that is the point rather than an omission: a path the contract cannot read
  // cannot be classified or searched either, so the realistic malformed map is exactly this — one valid
  // doc surface, plus one declaration nothing can resolve. The trio still agrees, because the illegible
  // entry never reaches it.
  ...[
    ['an empty string', ''],
    ['a whitespace-only string', '   '],
    ['a tab-only string', '\t'],
    ['null', null],
    ['a number', 42],
    ['an array', ['plugin/skills/the-cartographer/references/fixtures/tiny/SKILL.md']],
    ['no `path` key at all', undefined],
  ].map(([shape, p]) => [
    `a doc surface whose path is ${shape}`,
    (map) => addIllegibleDocSurface(map, p),
    /must be a non-empty string/,
  ]),
];

/**
 * A `role: "doc"` declaration whose PATH is unreadable — pushed and nothing else.
 *
 * Deliberately not routed through `addDocSurface`: that helper threads the path into `coverage.read` and
 * into every node's `searched` so the trio agrees on a bogus-but-legible path. An ILLEGIBLE path has
 * nowhere to be threaded — `readOnceSurfaces` and the harvest record both filter on non-empty strings —
 * so threading it would only add validator errors while changing nothing the gate reads.
 */
/**
 * The fixture doc surface's REAL digest — of its BYTES.
 *
 * Both helpers below used to write `digestOf(path.join(REPO_ROOT, TINY_DOC))`, which hashes the
 * PATHNAME STRING: `digestOf` takes a buffer and will hash whatever it is handed, so the mistake is
 * silent and the resulting sha is simply a different 64-hex string. Nothing in these tests reads the
 * digest, which is exactly why it survived — but this file's own promise is that a constructed source
 * states real source facts about disk, and a digest of a pathname is not one (round-7 gate).
 */
// RESOLVED FROM `HERE` (round-8 gate). This was written `path.join(REPO_ROOT, TINY_DOC)` in the same
// round that fixed exactly that mistake sixty lines below — and it is worse here, because it runs at
// MODULE level: in the installed layout `REPO_ROOT` climbs past the version directory and the import
// throws before a single test runs. `TINY_DOC` stays repo-relative because that is what the map
// DECLARES; only the read is anchored.
const TINY_DOC_SHA256 = digestOf(fs.readFileSync(path.join(HERE, 'fixtures', 'tiny', 'SKILL.md')));

function addIllegibleDocSurface(map, p) {
  const source = { role: 'doc', sha256: TINY_DOC_SHA256, lines: 18 };
  if (p !== undefined) source.path = p;
  map.sources.push(source);
}

/** A second declared doc surface, threaded CONSISTENTLY through all three statements the gate reads. */
function addDocSurface(map, p) {
  map.sources.push({
    path: p, role: 'doc', sha256: TINY_DOC_SHA256, lines: 18,
  });
  map.coverage.read.push(p);
  // …including every node's `searched`, so `missing` is empty and the trio AGREES. Without this the
  // node would be withheld for an unaccounted surface and the fail-open would be masked by an accident.
  for (const n of map.nodes) {
    if (n.docHarvest && Array.isArray(n.docHarvest.searched)) n.docHarvest.searched.push(p);
  }
}

/** Re-declare an ALREADY declared path under `role`, leaving every other statement untouched. */
function redeclare(map, p, role) {
  map.sources.push({ ...map.sources.find((s) => s.path === p), role });
}

test('4g · a DECLARATION the contract cannot read establishes nothing — the defect is the map\'s', () => {
  for (const [what, build, errorRe] of DECLARATION_DEFECTS) {
    // The CONTROL, for the same reason 4e opens with one: without the defect this node IS accused, so
    // the withholding below is the gate acting rather than the fixture being uninteresting.
    const control = loadTiny();
    assert.ok(undocumented(computeDrift(control).findings).includes('env.tiny_debug'),
      `${what}: fixture precondition — without the defect this node is accused`);

    const map = loadTiny();
    build(map);
    const { findings, coverage } = computeDrift(map);

    assert.ok(!undocumented(findings).includes('env.tiny_debug'),
      `${what}: a declaration the contract cannot read is not a surface set this map can accuse on`);
    assert.deepEqual(coverage.established, [],
      `${what}: and NOTHING may be established on it — the defect is the map's, so it reaches every node`);
    const withheld = coverage.withheld.find((w) => w.nodeId === 'env.tiny_debug');
    assert.ok(withheld, `${what}: the node must appear in the coverage statement instead`);
    assert.match(withheld.reason, /declares its documentation surfaces/,
      `${what}: and the reason must name the DECLARATION as the defect, not the node's record `
      + `(got ${JSON.stringify(withheld.reason)})`);

    // …and the two artifacts AGREE, which is the property that stops them drifting apart again.
    const errors = validate(map, { repoRoot: REPO_ROOT }).errors;
    assert.ok(errors.length > 0, `${what}: validate() must refuse the same map`);
    assert.ok(errors.some((e) => errorRe.test(e)),
      `${what}: validate() must refuse it for the SAME reason (got ${JSON.stringify(errors)})`);
  }
});

test('4h · …and it does not over-refuse: a legal, singly-declared surface set still accuses', () => {
  // The other half of 4g, and what stops the fix from being a blanket withhold. `tiny.map.json` declares
  // two sources, one of them `doc`, each exactly once, every path legal — so the node it leaves
  // undocumented must STILL be established, or the gate has been tightened into a different bug.
  const map = loadTiny();
  assert.deepEqual(validate(map, { repoRoot: REPO_ROOT }).errors, [],
    'fixture precondition: the untouched map validates clean');
  const { findings, coverage } = computeDrift(map);
  assert.ok(undocumented(findings).includes('env.tiny_debug'),
    'a legible declaration still buys the accusation it earns');
  assert.deepEqual(coverage.established, ['env.tiny_debug'],
    'and the coverage statement still establishes it');
});

test('4d · …and the fail-closed reading does not over-refuse: the ONE real harvested map is untouched', (t) => {
  if (!run4Present) return t.skip(NO_DOCS);
  // `run-4-candidate/map.json` is the only real extraction ever performed under the harvest contract:
  // 109 nodes, every one carrying a record whose `searched` is byte-identical to the map's declared
  // doc sources. A predicate strict enough to catch the malformed shapes above must still read every
  // one of them as complete, or the gate has been tightened into a different bug.
  const map = loadRun4();
  const { findings, coverage } = computeDrift(map);
  assert.deepEqual(coverage.withheld, [], 'no node may be withheld for a defect in its record');
  assert.equal(coverage.established.length, 20);
  assert.equal(undocumented(findings).length, 20,
    'the 20 UNDOCUMENTED findings that run recorded are still derived from it');
});

test('4b · completeness is DERIVED, not asserted — the record may not grade its own homework', () => {
  // THE CLAIM THIS TEST MAKES, AND THE ONE IT DOES NOT. It used to be titled "an extractor cannot
  // self-certify", which the owner-authorized C-018 amendment (2026-08-14) identifies as FALSE and as
  // the reason the amendment exists. Refusing a `complete` key does not stop an extractor certifying
  // itself; it stops it doing so in the ONE field the pipeline could otherwise mistake for a derived
  // fact. A false `searched` entry, or a documentation file mis-declared `role: "code"` — or never
  // declared at all — are all still available, all still invisible here, and none of them is a defect
  // this suite can detect, because NOTHING IN THE PIPELINE OPENS A FILE.
  //
  // What is asserted, exactly: the state is DERIVED from `searched` against the map's own declared
  // sources, so the most hopeful thing an extractor could write buys nothing.
  const map = tinyHarvest({ searched: [], candidates: [], complete: true });
  assert.ok(!undocumented(computeDrift(map).findings).includes('env.tiny_debug'),
    'a record asserting its own completeness does not reach state 2 — the surface it never searched '
    + 'still decides');

  const errors = validate(map, { repoRoot: REPO_ROOT }).errors;
  assert.equal(errors.length, 1, `expected exactly one error, got ${JSON.stringify(errors)}`);
  assert.match(errors[0], /docHarvest[\s\S]*complete/,
    'and the validator refuses the self-graded field outright rather than ignoring it');
});

// ─── 5 · the validator rejects an undeclared surface ─────────────────────────────────────────────

test('5 · a harvest naming a surface the map does not declare as a `doc` source is INVALID', () => {
  const errors = tinyErrors({ searched: [TINY_DOC, 'docs/imagined-manual.md'], candidates: [] });
  assert.equal(errors.length, 1, `expected exactly one error, got ${JSON.stringify(errors)}`);
  assert.match(errors[0], /docHarvest\.searched\[1\][\s\S]*imagined-manual\.md/);
});

test('5b · a CODE source is not a documentation surface either', () => {
  // Declared in sources[], hashed, cited throughout — but `role: "code"`. Searching it proves nothing
  // about the documentation, which is the whole point of ADR C-014.
  const errors = tinyErrors({ searched: [TINY_DOC, TINY_CODE], candidates: [] });
  assert.equal(errors.length, 1, `expected exactly one error, got ${JSON.stringify(errors)}`);
  assert.match(errors[0], /docHarvest\.searched\[1\][\s\S]*role[\s\S]*code/);
});

test('5f · a harvest may not search a surface the map\'s OWN coverage says it did not read in full', () => {
  // `sources[]` + `role: "doc"` says the surface EXISTS and is hashed; it says nothing about whether
  // this run opened it. `coverage` is where the map states that, and the two rules were never bound —
  // so a map could classify a documentation file as SKIPPED ("not read, and here is why") and, on the
  // same map, list it among the surfaces a node's harvest SEARCHED. The gate then read that node as
  // harvest-complete and let it accuse, on the strength of a search of a file the map itself says was
  // never read.
  for (const bucket of ['skipped', 'partial']) {
    const map = loadTiny();
    map.coverage.read = map.coverage.read.filter((p) => p !== TINY_DOC);
    map.coverage[bucket].push({ path: TINY_DOC, why: 'only the mode list was needed' });
    // The fixture's `env.tiny_debug` already records having searched it — that is the contradiction.
    const errors = validate(map, { repoRoot: REPO_ROOT }).errors;
    assert.equal(errors.length, 1, `expected exactly one error, got ${JSON.stringify(errors)}`);
    assert.match(errors[0], new RegExp(`docHarvest\\.searched\\[0\\][\\s\\S]*coverage\\.${bucket}`));
  }

  // …and the same map with the harvest dropped is legal again: the rule binds the two statements, it
  // does not forbid either one on its own.
  const dropped = loadTiny();
  dropped.coverage.read = dropped.coverage.read.filter((p) => p !== TINY_DOC);
  dropped.coverage.skipped.push({ path: TINY_DOC, why: 'only the mode list was needed' });
  delete dropped.nodes.find((n) => n.id === 'env.tiny_debug').docHarvest;
  assert.deepEqual(validate(dropped, { repoRoot: REPO_ROOT }).errors, []);
});

test('5g · a doc surface DECLARED and SKIPPED withholds every verdict; one never declared accuses', () => {
  // THE PROTOCOL HOLE THIS PINS (SKILL.md §3.1, obligation 1). The rule used to read "declare each doc
  // file `role: "doc"` OR name it in `coverage.skipped` with a reason" — an either/or, and the second
  // branch is not a weaker version of the first, it is the OPPOSITE of it. `coverage.skipped` alone
  // keeps the file out of `sources[]`, and the completeness comparison is made against the DECLARED
  // set, so a map that admits in writing that it never opened the manual goes on accusing every node
  // that manual documents. Declaring it is what puts it inside the comparison.
  //
  // REBUILT ON `tiny`, AND MINIMALLY (2026-08-14, pre-PR review). This test used to run on run 3's
  // committed map, and its second half deleted `plugin/skills/codex-gate/SKILL.md` from `sources[]`
  // while leaving every citation of it standing. Measured: that map's validation errors go 6 -> 87,
  // 81 of them `"…" is not declared in sources[] — every citation must resolve to a hashed source`.
  // The shipping path validates before it renders, so the "undeclared" map was one the pipeline
  // REFUSES outright — the half of the scenario that matters was demonstrated on a map that can never
  // reach the gate under test. Both maps below are ones `validate()` accepts with ZERO errors, and
  // that is asserted rather than assumed.
  //
  // WHAT MAKES IT MINIMAL. The two maps differ in ONE fact: whether a second documentation surface is
  // DECLARED. Same fixture, same nodes, same harvest record, same bytes on disk — only the
  // declaration moves, and the node's fate flips with it. That is the property in isolation, and it
  // is sharper than the old construction rather than weaker: it shows the outcome turning on the
  // declaration ALONE, with the file's contents never consulted by anything, which is exactly why the
  // obligation has to sit on the extractor.
  //
  // THE BORROWED SURFACE. `tiny` declares one doc surface and a second is needed, so the second is
  // the cartographer's own `SKILL.md` — the document this obligation is written in — declared with
  // the digest and line count read off the file here, so the fixture states nothing about disk that
  // disk does not say. Nothing in `tiny` cites it, and that is precisely what makes leaving it out a
  // LEGAL edit instead of 81 errors.
  //
  // RESOLVED FROM `HERE`, NOT `REPO_ROOT` (round-6 gate). This surface is the cartographer's OWN
  // `SKILL.md`, which SHIPS inside the plugin — so unlike the run-3/run-4 maps it needs no
  // `NO_DOCS` skip. But `REPO_ROOT` climbs four levels, which lands on the repo top only in a source
  // checkout; in the documented installed layout (`…/<version>/skills/the-cartographer/references`)
  // it lands on the plugin-name directory and the join points at a path that does not exist, so the
  // test died with ENOENT in exactly the install this fixture is meant to prove works. `HERE` is the
  // one anchor true in both. The DECLARED path stays repo-relative, because that is what the map
  // declares and what `docSurfaces` is compared against.
  const bytes = fs.readFileSync(path.join(HERE, '..', 'SKILL.md'));

  // (1) DECLARED, and classified `skipped`. The map is exactly as legal as the fixture it is built
  //     from — this is not a map the contract objects to — and it establishes NOTHING about the node.
  const declared = loadTiny();
  declared.sources.push({
    lines: countLines(bytes.toString('utf8')),
    path: TINY_DOC_2,
    role: 'doc',
    sha256: digestOf(bytes),
  });
  declared.coverage.skipped.push({ path: TINY_DOC_2, why: 'not read for this experiment' });
  assert.deepEqual(validate(declared, { repoRoot: REPO_ROOT }).errors, [],
    'declaring a doc surface and skipping it is LEGAL — the rule must bite through coverage, not '
    + 'through a validation error');
  const covered = computeDrift(declared);
  // Sorted, not in `sources[]` order — the coverage statement is canonical so two runs of the same
  // map produce the same report, and `TINY_DOC_2` sorts first.
  assert.deepEqual(covered.coverage.docSurfaces, [TINY_DOC_2, TINY_DOC],
    'the skipped surface is still DECLARED, so it is still in the set completeness is measured against');
  assert.ok(!undocumented(covered.findings).includes('env.tiny_debug'),
    'a map that says it never read one of its documentation surfaces may not accuse on the absence');
  const withheld = covered.coverage.withheld.find((w) => w.nodeId === 'env.tiny_debug');
  assert.ok(withheld, 'the node is withheld instead');
  assert.deepEqual(withheld.missing, [TINY_DOC_2],
    'and the statement names the surface the harvest does not cover');

  // (2) THE SAME BYTES ON DISK, the surface simply never declared — the MECHANISM behind residual 1
  //     of the C-018 amendment, in miniature. Not a validation question and not a coverage question:
  //     the file is simply outside the comparison, so the harvest reads as complete and the node is
  //     ACCUSED. Nothing in the pipeline can notice, which is why the obligation is on the extractor
  //     and is written into §3.1 as one. This map is the unmodified fixture, so "legal" is not a
  //     claim about a construction — it is the fixture every other test in this file already runs on.
  //
  //     WHAT THIS DOES NOT CLAIM. It does not claim the accusation below is FALSE. Whether the
  //     undeclared file documents this node is exactly the question nothing here can answer — no
  //     component in this pipeline opens it — and that is residual 1 rather than a gap in the test.
  //     The measurement of falseness lives where the evidence for it lives: ADR C-018 records
  //     15 accusations false BY THE MAP'S OWN CLAIMS on run 4's committed map. What is proven here is
  //     the mechanism that makes such an accusation reachable at all, on a map the pipeline accepts.
  const undeclared = loadTiny();
  assert.deepEqual(validate(undeclared, { repoRoot: REPO_ROOT }).errors, [],
    'the under-declared map must be one the pipeline ACCEPTS, or the accusation below is unreachable');
  const thin = computeDrift(undeclared);
  assert.deepEqual(thin.coverage.docSurfaces, [TINY_DOC], 'the undeclared surface is invisible to the gate');
  assert.ok(undocumented(thin.findings).includes('env.tiny_debug'),
    'and the accusation comes back — under-declaring is the failure the harvest gate CANNOT catch');
});

test('5c · a candidate must sit on a surface the harvest actually searched', () => {
  const errors = tinyCoreErrors({
    searched: [],
    candidates: [{ ...TINY_MENTIONS, disposition: 'mentions' }],
  });
  assert.match(errors.join('\n'), /docHarvest\.candidates\[0\]\.path[\s\S]*searched/,
    'you cannot find a hit where you did not look');
});

test('5d · the disposition vocabulary is CLOSED', () => {
  const errors = tinyCoreErrors({
    searched: [TINY_DOC],
    candidates: [{ ...TINY_MENTIONS, disposition: 'probably' }],
  });
  assert.equal(errors.length, 1, `expected exactly one error, got ${JSON.stringify(errors)}`);
  assert.match(errors[0], /disposition[\s\S]*asserts \| mentions/);
});

test('5e · a `searched` entry must be a real path, and the record itself a well-formed object', () => {
  assert.match(tinyErrors({ candidates: [] }).join('\n'), /docHarvest\.searched[\s\S]*array/);
  assert.match(tinyErrors({ searched: [TINY_DOC] }).join('\n'), /docHarvest\.candidates[\s\S]*array/);
  assert.match(tinyErrors([]).join('\n'), /docHarvest[\s\S]*object/);
  assert.match(tinyErrors({ searched: [TINY_DOC, TINY_DOC], candidates: [] }).join('\n'),
    /docHarvest\.searched\[1\][\s\S]*duplicate/);
  assert.match(tinyErrors({
    searched: [TINY_DOC],
    candidates: [{ path: TINY_DOC, line: 999, quote: 'off the end', disposition: 'mentions' }],
  }).join('\n'), /docHarvest\.candidates\[0\]\.line[\s\S]*18 lines/);
  assert.match(tinyErrors({
    searched: [TINY_DOC],
    candidates: [{ path: TINY_DOC, line: 16, quote: '   ', disposition: 'mentions' }],
  }).join('\n'), /docHarvest\.candidates\[0\]\.quote/);
});

// ─── the coverage statement — state 3 is reported, never as an accusation ────────────────────────

test('6 · state 3 surfaces as a COVERAGE statement, and never as a finding', (t) => {
  if (!run3Present) return t.skip(NO_DOCS);
  const { findings, coverage } = computeDrift(loadRun3());

  assert.deepEqual(coverage.docSurfaces, DOC_SURFACES);
  assert.deepEqual(coverage.established, [],
    'run 3 established nothing as undocumented — it ran no harvest');
  assert.equal(coverage.withheld.length, 37,
    'all 37 nodes the mechanical rule would have accused are reported as NOT ESTABLISHED');

  // The findings stay accusations. Nothing from the coverage statement leaked into them.
  for (const finding of findings) {
    assert.ok(['PHANTOM', 'STALE', 'UNVERIFIED'].includes(finding.class));
  }
  const one = coverage.withheld.find((w) => w.nodeId === 'component.die_infra');
  assert.deepEqual(one.missing, DOC_SURFACES, 'and each entry says WHY it was not established');
  assert.match(one.reason, /no .*harvest/i);
});

test('6b · `docHarvestCoverage` is the ONE statement of the rule, shared with the renderers', (t) => {
  if (!run3Present) return t.skip(NO_DOCS);
  const map = loadRun3();
  assert.deepEqual(docHarvestCoverage(map), computeDrift(map).coverage,
    'the renderers must not re-derive completeness privately — that is the drift class this skill detects');
});

// ─── both renderers show it, loudly ──────────────────────────────────────────────────────────────

test('7 · a map that accuses nothing because it harvested nothing LOOKS like that, in both renderers', (t) => {
  if (!run3Present) return t.skip(NO_DOCS);
  const map = loadRun3();
  const { findings } = computeDrift(map);

  const md = toMarkdown(map, findings, { generatedAt: 'a fixed stamp' });
  assert.match(md, /37/, 'the Markdown twin states how many nodes were left unestablished');
  assert.match(md, /not established as undocumented/i);
  assert.match(md, /component\.die_infra/, 'and names them, so a reader can see which');

  const html = renderPage(map, findings, { generatedAt: 'a fixed stamp' });
  assert.match(html, /not established as undocumented/i);
  assert.match(html, /37/);
});

test('7b · a fully harvested map says so instead — the statement is not a permanent disclaimer', (t) => {
  if (!run3Present) return t.skip(NO_DOCS);
  const map = clone(loadRun3());
  for (const node of map.nodes) node.docHarvest = completeHarvest([]);

  const { findings, coverage } = computeDrift(map);
  assert.deepEqual(coverage.withheld, []);
  assert.equal(coverage.established.length, 37,
    'every node the mechanical rule would accuse is now genuinely established');
  assert.equal(undocumented(findings).length, 37);

  const md = toMarkdown(map, findings, { generatedAt: 'a fixed stamp' });
  // The sentence is SCOPED to the harvest-eligible population (test 10d): "every evidenced node" was
  // over-broad, because an inferred node carries evidence and is never in this section at all.
  assert.match(md, /harvest-eligible/i);
  assert.match(md, /established one way or the other/i);
  assert.doesNotMatch(md, /NOT established as undocumented: [1-9]/,
    'and the withheld table is gone entirely — the statement is a fact about THIS run, not boilerplate');
});

// ─── 8 · zero findings is not a clean bill of health ─────────────────────────────────────────────

test('8 · a map that harvested nothing has ZERO findings and is NOT a clean subject — both renderers say so', () => {
  // The drift section's zero-findings branch promised "every evidenced capability is documented".
  // Under decision F that sentence is no longer licensed by an empty finding list: this map accuses
  // nobody precisely because it never looked, and a page that opens with a clean bill of health and
  // then reports a withheld verdict further down contradicts itself in the reader's favour.
  const map = harvestedNothingMap();
  const { findings, coverage } = computeDrift(map);
  assert.deepEqual(findings, [], 'fixture precondition: nothing is accused');
  assert.equal(coverage.withheld.length, 1, 'fixture precondition: and exactly one verdict is withheld');

  const md = toMarkdown(map, findings, { generatedAt: 'a fixed stamp' });
  const mdDrift = md.slice(md.indexOf('## Drift'), md.indexOf('## Nodes'));
  assert.doesNotMatch(mdDrift, /every evidenced capability is documented/i,
    'the map established no such thing — it withheld the verdict on one node');
  assert.match(mdDrift, /not a clean bill of health/i);
  assert.match(mdDrift, /Documentation-harvest coverage/,
    'and the drift section must point at the section that states what was withheld');

  const html = renderPage(map, findings, { generatedAt: 'a fixed stamp' });
  const htmlDrift = html.slice(html.indexOf('data-carto-lane="drift"'), html.indexOf('id="coverage"'));
  assert.doesNotMatch(htmlDrift, /every evidenced capability is documented/i);
  assert.match(htmlDrift, /not a clean bill of health/i);
  assert.match(htmlDrift, /Documentation-harvest coverage/);
});

test('8b · …and a genuinely clean map still gets the clean sentence — the wording is conditional, not deleted', () => {
  const map = cleanMap();
  assert.deepEqual(validate(map, { repoRoot: REPO_ROOT }).errors, [],
    'a map called genuinely clean must be a map the contract accepts');
  const { findings, coverage } = computeDrift(map);
  assert.deepEqual(findings, []);
  assert.deepEqual(coverage.withheld, [], 'fixture precondition: nothing was withheld either');

  // The clean sentence survives; only its QUANTIFIER was narrowed (test 10d). It is asserted here by
  // the qualifier that makes it true rather than by the old unrestricted phrase, which this same
  // fixture would satisfy either way — a clean map with no inferred node cannot tell the two apart.
  const md = toMarkdown(map, findings, { generatedAt: 'a fixed stamp' });
  assert.match(md, /non-inferred\*\* capability carries a `doc` claim/i);
  assert.doesNotMatch(md, /not a clean bill of health/i);

  const html = renderPage(map, findings, { generatedAt: 'a fixed stamp' });
  assert.match(html, /non-inferred<\/strong>\s*capability carries a <code>doc<\/code> claim/i);
  assert.doesNotMatch(html, /not a clean bill of health/i);
});

test('8c · the withheld sentence AGREES IN NUMBER, and the surfaces bullet ends in a period', (t) => {
  if (!run3Present) return t.skip(NO_DOCS);
  const one = harvestedNothingMap();
  const { findings } = computeDrift(one);

  const md = toMarkdown(one, findings, { generatedAt: 'a fixed stamp' });
  assert.match(md, /The 1 node below carries code evidence/);
  assert.doesNotMatch(md, /below carry code evidence/, '"The 1 node below carry" is not a sentence');
  assert.match(md, /- Declared documentation surfaces: `[^`\n]+`\.\n/,
    'the bullet ends in a period when it names a surface, exactly as it does when it reads "none."');

  const html = renderPage(one, findings, { generatedAt: 'a fixed stamp' });
  assert.match(html, /The 1 node below carries code evidence/);
  assert.doesNotMatch(html, /below carry code evidence/);

  assert.match(md, /the documentation is silent about it\./,
    'the drift section\'s pronoun agrees too');

  // …and the plural still reads as a plural. Run 3 withholds 37.
  const many = loadRun3();
  const manyMd = toMarkdown(many, computeDrift(many).findings, { generatedAt: 'a fixed stamp' });
  assert.match(manyMd, /The 37 nodes below carry code evidence/);
});

test('8d · a map with NO documentation surface is told WHY in its own words, not as a short harvest', () => {
  // The withheld explanation used to say the harvest "did not cover every documentation surface" in
  // every case. On a map that declares none, that points the reader at the extractor when the missing
  // declaration is in `sources[]` — the one place the reader can actually fix it.
  const none = tinyWithoutDocSurface();
  const noneMd = toMarkdown(none, computeDrift(none).findings, { generatedAt: 'a fixed stamp' });
  assert.match(noneMd, /declares no documentation surface at all/);
  assert.doesNotMatch(noneMd, /did not cover every documentation surface/,
    'there was no surface to fall short of');

  const noneHtml = renderPage(none, computeDrift(none).findings, { generatedAt: 'a fixed stamp' });
  assert.match(noneHtml, /declares no documentation surface at all/);
  assert.doesNotMatch(noneHtml, /did not cover every documentation surface/);

  // …AND IT SAYS IT ABOUT THE RECORD, NOT ABOUT THE WORLD (ADR C-018 amendment, 2026-08-14 pre-PR
  // review). This branch used to close with *"so no search of the documentation could have been
  // made"*, which asserts that nothing was searched — and that is precisely what nothing here can
  // observe. An undeclared documentation surface is invisible to the whole mechanism, so an extractor
  // may perfectly well have read documentation this map never declares; what is actually true is
  // narrower and is about the record alone: with no surface DECLARED, no attestation this map carries
  // can cover one. Same class as `render.test.mjs`'s D3 and `markdown.test.mjs`'s 21, and the same
  // vocabulary — ATTESTATION — those two settled on.
  for (const [what, out] of [['map.md', noneMd], ['map.html', noneHtml]]) {
    assert.doesNotMatch(out, /could have been made/,
      `${what}: "no search could have been made" is a claim about an act this pipeline never observes`);
    assert.match(out, /so no attestation it carries could cover one/,
      `${what}: the honest replacement states what the RECORD can hold, and must not go mute`);
  }

  // The other case still reads DIFFERENTLY and still does not go mute — which is the property this test
  // exists for. The exact phrase it used to pin ("did not cover every documentation surface") was
  // retired on 2026-08-15: it described only one of state 3's shapes, and this map is not even that one
  // — `harvestedNothingMap()` deletes the record outright, so there is no harvest to have fallen short.
  // See 8e, which is where the restatement is pinned.
  const short = harvestedNothingMap();
  const shortMd = toMarkdown(short, computeDrift(short).findings, { generatedAt: 'a fixed stamp' });
  assert.match(shortMd, /no harvest attestation this map carries/,
    'the declared-surfaces branch must still say something');
  assert.doesNotMatch(shortMd, /declares no documentation surface at all/,
    'and it must not borrow the zero-surfaces branch\'s words');
});

test('8e · the withheld explanation covers ALL of state 3, not only a harvest that fell short', () => {
  // THE DEFECT, verified in both renderers before this was written. `whyWithheld()` branched on ONE
  // thing — whether any documentation surface is declared — and for every map that declares one it said
  // "the harvest that would have justified the accusation DID NOT COVER every documentation surface".
  //
  // State 3 is wider than that. A node is withheld when NO acceptable complete attestation covers the
  // declared surfaces, and a record can name every single one of them and still be refused: it grades
  // its own completeness, it cites a hit nobody can open, or it dispositions a hit as ASSERTING and
  // never promotes it to a claim. In each of those the sentence was simply false — and in the
  // out-of-bounds case it contradicted the very reason printed in the next column, which says the hit is
  // past the end of "the file it says it searched".
  //
  // The population is mixed, so the section sentence cannot assert one cause for all of it. What it can
  // do — and now does — is state the condition that actually holds of every withheld node and point at
  // the per-node reason, which both renderers already print in the last column.
  const SHAPES = [
    ['a self-graded record — a forbidden `complete` key', (n) => {
      n.docHarvest = { searched: [TINY_DOC], candidates: [], complete: true };
    }],
    ['an UNPROMOTED `asserts` candidate — the record holds the documentation itself', (n) => {
      n.docHarvest = {
        searched: [TINY_DOC],
        candidates: [{
          path: TINY_DOC, line: 5, quote: 'TINY_DEBUG=1 prints each mode', disposition: 'asserts',
        }],
      };
    }],
    ['a candidate past the end of the file it says it searched', (n) => {
      n.docHarvest = {
        searched: [TINY_DOC],
        candidates: [{ path: TINY_DOC, line: 999, quote: 'off the end', disposition: 'mentions' }],
      };
    }],
  ];

  for (const [what, build] of SHAPES) {
    const map = loadTiny();
    const node = map.nodes.find((n) => n.id === 'env.tiny_debug');
    build(node);
    const { findings, coverage } = computeDrift(map);

    // The precondition that makes each case evidence: the record NAMES every declared surface, so any
    // sentence about a harvest falling short of them is a false statement about this map.
    assert.deepEqual(node.docHarvest.searched, coverage.docSurfaces,
      `${what}: fixture precondition — the record names exactly the declared surfaces`);
    assert.ok(coverage.withheld.some((w) => w.nodeId === 'env.tiny_debug'),
      `${what}: fixture precondition — the node is nonetheless withheld`);

    for (const [where, out] of [
      ['map.md', toMarkdown(map, findings, { generatedAt: 'a fixed stamp' })],
      ['map.html', renderPage(map, findings, { generatedAt: 'a fixed stamp' })],
    ]) {
      assert.doesNotMatch(out, /did not cover every documentation surface/,
        `${where} · ${what}: the record names every declared surface, so this is a false statement`);
      assert.match(out, /no harvest attestation this map carries is both COMPLETE and one the contract can accept/,
        `${where} · ${what}: and the restatement must be there instead — not silence`);
      assert.match(out, /name them all and still be refused/,
        `${where} · ${what}: it must name the shape this node actually is`);
    }
  }

  // …AND IT DOES NOT OVER-REACH: the zero-surfaces branch keeps its own distinct wording, which is the
  // whole point of 8d and is not relaxed by widening the other branch.
  const none = tinyWithoutDocSurface();
  const noneMd = toMarkdown(none, computeDrift(none).findings, { generatedAt: 'a fixed stamp' });
  assert.match(noneMd, /declares no documentation surface at all/);
  assert.doesNotMatch(noneMd, /no harvest attestation this map carries is both COMPLETE/,
    'the two cases must not collapse into one sentence');
});

// ─── 9 · the exported renderers may not contradict themselves ────────────────────────────────────

test('9 · a renderer REFUSES findings its own map no longer supports — the two lanes may not disagree', () => {
  // `renderPage(map, findings)` and `toMarkdown(map, findings)` take findings from the CALLER and
  // derive coverage from the MAP, and nothing reconciled them. Re-rendering a stored PRE-F
  // `drift.json` against its own `map.json` therefore put one node in both lanes at once: accused as
  // UNDOCUMENTED in the drift section, and listed as "not established as undocumented" in the
  // coverage table, on one page. `enforceOnMapDrift` already fails closed on a different
  // caller/map mismatch; this is the same threat wearing the coverage statement's face.
  const map = harvestedNothingMap();
  const stale = [{
    class: 'UNDOCUMENTED',
    nodeId: 'env.tiny_debug',
    label: 'TINY_DEBUG',
    detail: 'Evidenced at run.sh:7, but no claimKind:"doc" claim documents it.',
    citations: [{ path: TINY_CODE, line: 7, note: '"${TINY_DEBUG:-0}"' }],
  }];

  assert.throws(() => renderPage(map, stale, { generatedAt: 'a fixed stamp' }),
    /renderPage: env\.tiny_debug[\s\S]*coverage/);
  assert.throws(() => toMarkdown(map, stale, { generatedAt: 'a fixed stamp' }),
    /toMarkdown: env\.tiny_debug[\s\S]*coverage/);
});

test('9a · the reconciliation runs in BOTH directions — an ESTABLISHED node no finding names is refused too', () => {
  // The guard was one-directional, and the direction it left open is the one a caller reaches by
  // ACCIDENT rather than by re-rendering a stale artifact. `tiny` harvests every declared doc surface
  // for `env.tiny_debug` and finds no `doc` claim, so the map ESTABLISHES that node as undocumented.
  // Rendering it against `[]` — which `toMarkdown` documents as a caller ASSERTING this map has no
  // drift — printed a coverage section stating the verdict beside a drift section that accused nobody:
  // a clean bill of health the map never issued. For an audit tool that is the worse half of the
  // mismatch, because a missing accusation is worse than a wrong one.
  const map = loadTiny();
  const { findings } = computeDrift(map);
  assert.ok(findings.some((f) => f.class === 'UNDOCUMENTED' && f.nodeId === 'env.tiny_debug'),
    'fixture precondition: this map establishes exactly the accusation the caller is dropping');

  for (const [name, render] of [['renderPage', renderPage], ['toMarkdown', toMarkdown]]) {
    assert.throws(() => render(map, [], { generatedAt: 'a fixed stamp' }),
      new RegExp(`${name}: THIS map establishes env\\.tiny_debug as UNDOCUMENTED[\\s\\S]*coverage section`),
      `${name} must refuse an empty finding list its own map contradicts`);

    // A NON-empty list that merely drops the UNDOCUMENTED half is the same defect wearing a fuller
    // report — the shape a caller produces by filtering findings by class before rendering.
    const filtered = findings.filter((f) => f.class !== 'UNDOCUMENTED');
    assert.ok(filtered.length > 0, 'fixture precondition: the filtered list is not merely empty');
    assert.throws(() => render(map, filtered, { generatedAt: 'a fixed stamp' }),
      /THIS map establishes env\.tiny_debug as UNDOCUMENTED/);
  }
});

test('9b · …and the same findings against the map that DOES support them render without complaint', () => {
  const map = loadTiny(); // `env.tiny_debug` carries a complete harvest here — state 2, genuinely.
  const { findings } = computeDrift(map);
  assert.ok(findings.some((f) => f.class === 'UNDOCUMENTED' && f.nodeId === 'env.tiny_debug'),
    'fixture precondition: the accusation is one this map establishes');
  assert.doesNotThrow(() => renderPage(map, findings, { generatedAt: 'a fixed stamp' }));
  assert.doesNotThrow(() => toMarkdown(map, findings, { generatedAt: 'a fixed stamp' }));
});

// ─── 10 · the skill's own prose must not restate the rule decision F replaced ────────────────────
//
// A rule the code enforces and the prose contradicts is a STALE finding about this skill — the exact
// class it exists to detect. Cheaper to assert than to rediscover.

test('10 · no module header still states the pre-F universal rule, and computeDrift keeps its docstring', () => {
  const src = (name) => fs.readFileSync(path.join(HERE, name), 'utf8');

  const attention = src('attention.mjs');
  assert.doesNotMatch(attention, /audits UNIVERSALLY/,
    'UNDOCUMENTED now also requires a complete docHarvest — the universal claim is false');
  assert.match(attention, /docHarvest/,
    'the header must name the precondition that made its old sentence false');
  assert.match(attention, /coverage/,
    'and keep its real point by naming the coverage section as what stops a withheld verdict vanishing');

  const diff = src('diff.mjs');
  assert.match(diff, /computeDrift\(map\) -> \{ findings, coverage \}/,
    'the module header must state the return shape the function actually has');
  assert.doesNotMatch(diff, /computeDrift\(map\) -> \{ findings \}/);

  // The docstring must sit IMMEDIATELY above the function it documents: inserting `docHarvestCoverage`
  // between the two orphaned it, and an orphaned docstring documents whatever follows it.
  const attached = /\/\*\*((?:(?!\*\/)[\s\S])*)\*\/\s*export function computeDrift\b/.exec(diff);
  assert.ok(attached, 'computeDrift must carry a docstring directly above its declaration');
  assert.match(attached[1], /computeDrift\(map\) -> \{ findings, coverage \}/);
  const coverageDoc = /\/\*\*((?:(?!\*\/)[\s\S])*)\*\/\s*export function docHarvestCoverage\b/.exec(diff);
  assert.ok(coverageDoc, 'and docHarvestCoverage must carry its own');
  assert.match(coverageDoc[1], /docHarvestCoverage\(map\)/);
});

test('10c · both reports say what "established" rests on — an ATTESTATION nothing verified', () => {
  // ADR C-018's amendment (owner, 2026-08-14) corrected what the gate is claimed to prove, and the
  // rendered reports are where that claim reaches a reader. They stated that nodes were "established
  // as undocumented" with no qualification at all, which reads as a fact the pipeline checked. It
  // checked the extractor's record against the extractor's other statements and opened no file.
  const map = loadTiny();
  const { findings } = computeDrift(map);
  const html = renderPage(map, findings, { generatedAt: 'a fixed stamp' });
  const md = toMarkdown(map, findings, { generatedAt: 'a fixed stamp' });

  for (const [what, rendered] of [['map.html', html], ['map.md', md]]) {
    assert.match(rendered, /ATTESTATION/, `${what}: the report must name the record for what it is`);
    assert.match(rendered, /internal consistency/i,
      `${what}: …and say what was actually checked about it`);
    // THE QUALIFIER IS THE WHOLE CLAIM, so it is asserted POSITIVELY rather than by banning a phrase.
    // "Nothing in this pipeline opens a file" is FALSE — `render.mjs` calls `checkFreshness()`, which
    // reads every declared source. "…opens a file TO CONFIRM IT" is true, and the difference is the
    // three words. A negative regex on the phrase cannot express this: written loosely it rejects the
    // correct sentence (round-8, where widening it to any determiner broke this test against a
    // renderer that was right); written tightly it misses the determiner that was actually used.
    // Requiring the qualifier catches BOTH failure modes, including its silent removal.
    assert.match(rendered, /nothing in (?:the|this|our) pipeline opens a file to confirm/i,
      `${what}: the claim must carry its qualifier — unqualified, it is false`);
    assert.doesNotMatch(rendered, /pipeline opens a file(?!\s+to\s+confirm)/i,
      'an unqualified "opens a file" claim is the canonically false one (ADR C-026)');
    assert.match(rendered, /surface this map DECLARES|never declared is invisible/,
      `${what}: …and scope it to the surfaces the map declared`);

    // WHOSE STATEMENT IT IS, and whose it is not (2026-08-14, pre-PR review). The paragraph named the
    // right facts and then attributed them with the wrong verb: *"the guarantee is the extractor's:
    // it attests to having searched…"*. A guarantee is something a reader may rely on; the extractor
    // issues no such thing and nothing here could check it if it did. ADR C-018's own correction
    // block settles the split — the extractor ATTESTS, the pipeline GUARANTEES only that the
    // attestation is internally consistent — so the reports must carry the split, not the word.
    assert.match(rendered, /extractor\s+ATTESTS/,
      `${what}: the searching must be attributed to the extractor as an ATTESTATION`);
    assert.match(rendered, /verifies only that the attestation is internally consistent/i,
      `${what}: …and the pipeline's half must be stated as verifying the record, nothing more`);
    for (const [claim, forbidden] of [
      ['that a guarantee is the extractor\'s to give', /the guarantee is the extractor/i],
      ['that any search is guaranteed', /guarantee[sd]?\b[^.]{0,80}\bsearch/i],
      ['that any search was verified or confirmed', /\bsearch(?:ed|ing)?\b[^.]{0,80}\b(verified|confirmed|established)\b/i],
    ]) {
      assert.doesNotMatch(rendered, forbidden,
        `${what}: the report may not claim ${claim} — nothing in the pipeline observes a file`);
    }
  }
});

test('10d · a CLEAN report scopes its all-clear to the nodes the question actually applies to', () => {
  // The green branch of the drift lane said, unconditionally, *"every evidenced capability is
  // documented"*. An `inferred: true` node may legally carry evidence and no `doc` claim: PDR §8.1
  // guardrail 2 keeps it out of every finding, and `awaitsDocVerdict` keeps it out of the harvest
  // coverage too — so it is in NEITHER of the two populations the sentence is derived from, and a
  // perfectly valid map got a green all-clear that its own data contradicts.
  //
  // What zero findings AND zero withheld actually license is narrower and exactly derivable: every
  // NON-INFERRED evidenced node carries a `doc` claim. That is what both reports must now say.
  // `cleanMap()` is the fixture test 8b calls genuinely clean — zero findings, zero withheld, and
  // valid IR. The node below is the one thing it lacks, and adding it changes neither count.
  const map = cleanMap();
  map.nodes.push({
    id: 'component.inferred_helper',
    kind: 'component',
    label: 'inferred helper',
    lane: 'core',
    summary: 'Reached only through an indirection the extractor could not resolve.',
    inferred: true,
    evidence: [{ path: TINY_CODE, line: 9, note: 'dispatched by name' }],
    claims: [],
    contradictions: [],
  });
  assert.deepEqual(validate(map, { repoRoot: REPO_ROOT }).errors, [],
    'the counter-example must be a map the contract ACCEPTS — an illegal one proves nothing');

  const { findings, coverage } = computeDrift(map);
  assert.deepEqual(findings, [], 'precondition: this map computes no finding at all');
  assert.deepEqual(coverage.withheld, [], 'precondition: and withholds nothing');

  const html = renderPage(map, findings, { generatedAt: 'a fixed stamp' });
  const md = toMarkdown(map, findings, { generatedAt: 'a fixed stamp' });
  for (const [what, rendered] of [['map.html', html], ['map.md', md]]) {
    assert.doesNotMatch(rendered, /every evidenced capability is\s+documented/i,
      `${what}: the unqualified quantifier is false on this map — an inferred node refutes it`);
    assert.match(rendered, /non-inferred/i,
      `${what}: the all-clear must name the population it is true of`);
  }

  // The harvest section's own green line has the same defect and the same fix: its population is the
  // harvest-eligible nodes, not "every evidenced node".
  for (const [what, rendered] of [['map.html', html], ['map.md', md]]) {
    assert.doesNotMatch(rendered, /Every evidenced node was established/,
      `${what}: the harvest all-clear may not quantify over nodes it never considered`);
    assert.match(rendered, /harvest-eligible/i,
      `${what}: it must name the eligible population instead`);
  }
});

test('10b · the page no longer tells every reader that detection is unchanged and universal', () => {
  const map = loadTiny();
  const { findings } = computeDrift(map);
  assert.ok(findings.length > 0, 'fixture precondition: the note under test only renders WITH findings');

  // BOTH renderers, in the same assertions. `map.html` was corrected when C-018 landed and `map.md`
  // was not — it went on telling every reader "detection is universal" for as long as this test asked
  // only about the page. One rule stated in two artifacts is this skill's own drift class, and a test
  // that checks one of them is how it survives.
  const html = renderPage(map, findings, { generatedAt: 'a fixed stamp' });
  const md = toMarkdown(map, findings, { generatedAt: 'a fixed stamp' });
  for (const [what, rendered] of [['map.html', html], ['map.md', md]]) {
    assert.doesNotMatch(rendered, /[Dd]etection is (unchanged and )?universal/,
      `${what}: it is not — UNDOCUMENTED now requires a complete documentation harvest`);
    assert.match(rendered, /PHANTOM, STALE and UNVERIFIED are unchanged/,
      `${what}: the correction must not overcorrect — the other three classes really did not change`);
    assert.match(rendered, /UNDOCUMENTED[\s\S]{0,160}complete documentation harvest/,
      `${what}: while naming the one that did`);
    assert.match(rendered, /[Bb]ucketing never suppresses a finding that was computed/,
      `${what}: and the presentation-only promise must still be stated`);
  }
});
