// the-cartographer — tests for page assembly, the fail-closed write, and the CLI (Task 8).
//
// The three defects this file exists to prevent, each of which shipped in a previous review round of
// this build's sibling code:
//   • a CLI main-guard that compared a relative argv[1] to an absolute module path, so every
//     documented invocation was a SILENT NO-OP that still exited 0;
//   • `map.json` and `drift.json` written UNSCANNED beside a claimed all-artifacts secret gate;
//   • a defaulted `findings = []` that rendered a drifting map as clean.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { renderPage, render, resolveRepoRoot } from './render.mjs';
import { ATTENTION_BUCKETS, BUCKET_META, bucketForFinding } from './attention.mjs';
import { computeDrift } from './diff.mjs';
import { validate } from './validate.mjs';
import { serialize } from './serialize.mjs';
import { recoverText } from './markdown.mjs';
import { escapeXml } from './svg.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RENDER_CLI = path.join(HERE, 'render.mjs');
const REPO_ROOT = path.resolve(HERE, '..', '..', '..', '..');
const TINY = path.join(HERE, 'fixtures', 'tiny.map.json');
const TINY_REL = 'plugin/skills/the-cartographer/references/fixtures/tiny';

const loadTiny = () => JSON.parse(fs.readFileSync(TINY, 'utf8'));
const driftOf = (map) => computeDrift(map).findings;
const page = (map, opts) => renderPage(map, driftOf(map), opts);

const tmpdirs = [];
function tmp(prefix = 'carto-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpdirs.push(dir);
  return dir;
}
process.on('exit', () => {
  for (const dir of tmpdirs) fs.rmSync(dir, { recursive: true, force: true });
});

const listing = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []);
const OUTPUTS = ['drift.json', 'map.html', 'map.json', 'map.md'];

/**
 * A throwaway repo root carrying a REAL copy of the fixture subject at its real relative path, so
 * freshness resolves against it exactly as it does against this repo. Modifying a file in here is
 * how staleness is tested without touching the committed fixture every other test hashes.
 */
function fixtureRepo() {
  const root = tmp('carto-repo-');
  const dest = path.join(root, TINY_REL);
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(path.join(HERE, 'fixtures', 'tiny'))) {
    fs.copyFileSync(path.join(HERE, 'fixtures', 'tiny', name), path.join(dest, name));
  }
  const mapPath = path.join(root, 'map.json');
  fs.writeFileSync(mapPath, fs.readFileSync(TINY));
  return { root, mapPath, sourceFile: path.join(dest, 'run.sh') };
}

// ─── renderPage ──────────────────────────────────────────────────────────────────────────────────

test('P1 · the page is fully self-contained — no link, no script, no remote URL', () => {
  const html = page(loadTiny());
  assert.ok(!html.includes('<link'), 'a <link> makes the page depend on a fetch');
  assert.ok(!html.includes('<script'), 'no script at all, src or inline');
  assert.ok(!/https?:\/\//.test(html), 'an absolute URL is a remote dependency');
  assert.ok(!html.includes('@import'), 'an @import is a stylesheet fetch');
  // `url(#…)` is a SAME-DOCUMENT fragment reference — it is how an SVG attaches its own <marker>
  // arrowhead, and it fetches nothing. Any other url() target is an asset request.
  assert.doesNotMatch(html, /url\(\s*['"]?(?!#)/, 'a url() pointing anywhere but this document');
  assert.ok(html.includes('url(#carto-arrow-'), 'precondition: the hero does use a fragment marker');
});

test('P2 · the stylesheet is inlined and carries BOTH theme carriers, in both directions', () => {
  const html = page(loadTiny());
  assert.ok(html.includes('<style>'));
  assert.ok(html.includes('--carto-warn'), 'the tokens svg.mjs reads must exist in the page');
  assert.ok(html.includes('--carto-info'));
  assert.ok(html.includes('prefers-color-scheme: dark'), 'the AUTO carrier');
  assert.ok(html.includes(':root[data-theme="dark"]'), 'the FORCED dark carrier');
  assert.ok(html.includes(':root[data-theme="light"]'), 'the FORCED light carrier');
  // …and the auto block must yield to a forced light theme, or "force light" silently does nothing
  // for a viewer whose OS is dark.
  assert.ok(
    html.includes(':root:not([data-theme="light"])'),
    'the prefers-color-scheme block must not apply once a theme is forced',
  );
});

test('P3 · the SVG hero is inline, mermaid views are wrapped for the host, tables are HTML tables', () => {
  const html = page(loadTiny());
  assert.ok(html.includes('<svg'), 'the hero renders as inline SVG, not an image reference');
  assert.ok(html.includes('carto-hero'));
  assert.ok(html.includes('<pre class="mermaid">'), 'the Artifact host renders this class');
  assert.ok(html.includes('flowchart LR'), 'the mermaid source must actually be inside');
  assert.ok(html.includes('<table>'));
  assert.ok(html.includes('<th>Capability</th>'), 'the declared columns are the header');
});

test('P4 · the drift lane renders EXACTLY once, with every finding, and is not a views[] entry', () => {
  const map = loadTiny();
  assert.ok(!map.views.some((v) => v.id === 'drift'), 'fixture precondition: drift is not a view');
  const findings = driftOf(map);
  assert.equal(findings.length, 4);

  const html = renderPage(map, findings);
  const occurrences = html.split('data-carto-lane="drift"').length - 1;
  assert.equal(occurrences, 1, 'the drift lane was rendered more than once');
  for (const finding of findings) {
    assert.ok(html.includes(finding.nodeId), `finding for ${finding.nodeId} missing`);
    assert.ok(html.includes(finding.class), `class ${finding.class} missing`);
  }
  assert.deepEqual(
    [...new Set(findings.map((f) => f.class))].sort(),
    ['PHANTOM', 'STALE', 'UNDOCUMENTED'],
  );
});

test('P4b · a drift-bearing node in NO graph view is refused — the defect must be on the picture', () => {
  const map = loadTiny();
  // The fixture passes: every drifting node is drawn by the overview.
  assert.doesNotThrow(() => renderPage(map, driftOf(map)));

  // mode.build (PHANTOM) is drawn ONLY by the overview; drop it and it survives in the capabilities
  // TABLE alone — the silent degradation to a table-with-pictures that PDR §6.2 forbids.
  const degraded = loadTiny();
  const overview = degraded.views.find((v) => v.id === 'overview');
  overview.nodes = overview.nodes.filter((id) => id !== 'mode.build');
  assert.ok(degraded.views.some((v) => v.form === 'table' && v.nodes.includes('mode.build')));
  assert.throws(
    () => renderPage(degraded, driftOf(degraded)),
    /mode\.build[\s\S]*no graph view|no graph view[\s\S]*mode\.build/,
  );
});

/**
 * The tiny fixture's four findings all land in `likely-contract`, which is the right answer for it
 * and useless for testing the other two groups. This variant plants one finding in EACH bucket by
 * moving documentation and lanes ONLY — no finding is added or removed by the mutation, so the raw
 * layer stays comparable to the fixture's own.
 */
function threeBucketMap() {
  const map = loadTiny();
  const byId = new Map(map.nodes.map((n) => [n.id, n]));
  // ADR decision F — stripping a node's `doc` claim is only half of making it UNDOCUMENTED. Without
  // a COMPLETE harvest the node is state 3 ("the map did not look") and raises nothing at all, so the
  // harvest travels with every claim removal below.
  const harvested = { searched: [`${TINY_REL}/SKILL.md`], candidates: [] };
  // component × core, undocumented → implementation-detail (the one collapsible cell).
  byId.get('component.tiny_core').claims = [];
  byId.get('component.tiny_core').docHarvest = harvested;
  // component × output, undocumented → ambiguous-review. Un-inferring it is what makes it auditable
  // at all (ADR C-005), and `output` is the lane that says "this is exposed, not internal".
  const exposed = byId.get('component.dispatch_table');
  exposed.inferred = false;
  exposed.lane = 'output';
  exposed.claims = [];
  exposed.docHarvest = harvested;
  // Read off `run.sh:21` verbatim. It said `case "$1" in` at line 11 — a line that carries
  // `mode_check() {` and a quotation the file does not contain. A fixture that misquotes its own
  // subject is the defect this skill exists to detect, sitting in the tests that prove it works.
  exposed.evidence = [{
    line: 21, note: 'case "${1:-}" in', path: `${TINY_REL}/run.sh`,
  }];
  return map;
}

/** The page's three bucket blocks, keyed by bucket, each as its own slice of the HTML. */
function bucketBlocks(html) {
  const blocks = new Map();
  for (const match of html.matchAll(/data-carto-bucket="([a-z-]+)"([\s\S]*?)<!-- \/carto-bucket -->/g)) {
    blocks.set(match[1], match[2]);
  }
  return blocks;
}

test('P4c · the drift lane groups every finding into the three attention buckets (ADR C-017)', () => {
  const map = threeBucketMap();
  const findings = driftOf(map);
  const html = renderPage(map, findings);
  const blocks = bucketBlocks(html);

  assert.deepEqual([...blocks.keys()], ['likely-contract', 'ambiguous-review', 'implementation-detail']);

  // A PARTITION of the findings the engine computed — not a filter of them.
  const placed = [];
  for (const [bucket, block] of blocks) {
    for (const finding of findings) {
      if (block.includes(`<code>${finding.nodeId}</code>`)) placed.push([finding.nodeId, finding.class, bucket]);
    }
  }
  assert.equal(placed.length, findings.length, `every finding must appear exactly once: ${JSON.stringify(placed)}`);
  const where = new Map(placed.map(([id, , bucket]) => [id, bucket]));
  assert.equal(where.get('mode.build'), 'likely-contract', 'PHANTOM on a mode');
  assert.equal(where.get('env.tiny_debug'), 'likely-contract', 'UNDOCUMENTED on an env var');
  assert.equal(where.get('component.dispatch_table'), 'ambiguous-review', 'component × output');
  assert.equal(where.get('component.tiny_core'), 'implementation-detail', 'component × core');
});

test('P4d · ONLY implementation-detail starts collapsed — and the page stays script-free', () => {
  const html = renderPage(threeBucketMap(), driftOf(threeBucketMap()));

  // Exactly one <details>, and it is the collapsible bucket. Native disclosure, no JS: the page is
  // CSP-safe and self-contained (ADR C-007), so a scripted accordion is not available and not wanted.
  assert.equal(html.split('<details').length - 1, 1, 'exactly one disclosure element');
  assert.match(html, /<details[^>]*data-carto-bucket="implementation-detail"/);
  assert.doesNotMatch(html, /<details[^>]*open/, 'the collapsed group must start CLOSED');
  assert.doesNotMatch(html, /<script/i);

  // …and the two prioritised groups sit OUTSIDE every <details>, so a reader meets them without
  // expanding anything. Checked by deleting every disclosure region from the page first.
  const withoutDisclosures = html.replace(/<details[\s\S]*?<\/details>/g, '');
  assert.ok(withoutDisclosures.includes('<code>mode.build</code>'), 'the PHANTOM must be visible unexpanded');
  assert.ok(withoutDisclosures.includes('<code>component.dispatch_table</code>'), 'the ambiguous finding must be visible unexpanded');
  assert.ok(!withoutDisclosures.includes('<code>component.tiny_core</code>'), 'fixture precondition: the internal one IS inside the disclosure');
});

test('P4e · bucketing is PRESENTATION ONLY — the drift lane still carries every finding, in one lane', () => {
  const map = threeBucketMap();
  const findings = driftOf(map);
  const html = renderPage(map, findings);

  assert.equal(html.split('data-carto-lane="drift"').length - 1, 1, 'still exactly one drift lane');
  for (const finding of findings) {
    assert.ok(html.includes(`<code>${finding.nodeId}</code>`), `${finding.nodeId} missing from the page`);
    assert.ok(html.includes(finding.class), `class ${finding.class} missing`);
  }
  // The count a reader sees is the RAW count, not the prioritised one.
  assert.ok(html.includes(`${findings.length} findings`), `the lane must state all ${findings.length} findings`);
});

test('P4f · a STALE or PHANTOM on an internal node is NEVER collapsed', () => {
  // The two classes with the strongest signal. `component × core` is the one collapsible cell, so a
  // finding of another class sitting there is the exact case the class floor exists for — and the
  // real subject has one: the `emit_synthetic_approve` STALE, the most consequential of that run.
  //
  // THE IR THIS TEST BUILDS IS CONTRACT-VALID, and it was not. It used to hang a contradiction on
  // `component.tiny_core` citing the very claim `threeBucketMap()` had just deleted, with no
  // `refutedQuote` — a record `validate()` refuses twice over, which passed only because `renderPage`
  // was called directly instead of through the validating boundary. A fixture that has to be illegal
  // to make its point is testing a shape the pipeline can never see, so both halves are honest here:
  //
  //   • the STALE sits on `tiny_core`, whose real `SKILL.md:16` doc claim is RESTORED so the record
  //     can cite it, with the fragment `every mode calls` that the code actually refutes — `build` is
  //     documented at `SKILL.md:7` and the dispatch at `run.sh:22` routes only `check`;
  //   • the collapsed UNDOCUMENTED comes from `component.dispatch_table`, returned to the `core` lane
  //     so it lands in the same collapsible cell. A node that is documented cannot also be
  //     UNDOCUMENTED, so the two roles have to sit on two nodes — which is the shape the real subject
  //     had anyway.
  const map = threeBucketMap();
  const core = map.nodes.find((n) => n.id === 'component.tiny_core');
  const claim = {
    line: 16, path: `${TINY_REL}/SKILL.md`, text: '`tiny_core` is the shared routine every mode calls.',
  };
  core.claims = [{ ...claim, claimKind: 'doc', checked: true }];
  core.evidence = [
    ...core.evidence,
    { line: 22, note: 'check) mode_check ;;', path: `${TINY_REL}/run.sh` },
  ];
  core.contradictions = [{
    claim,
    evidence: { line: 22, note: 'check) mode_check ;;', path: `${TINY_REL}/run.sh` },
    refutedQuote: 'every mode calls',
    statement: 'The doc says every mode calls it; the dispatch routes only `check`, and the documented '
      + '`build` mode reaches no handler at all.',
  }];
  const internal = map.nodes.find((n) => n.id === 'component.dispatch_table');
  internal.lane = 'core';

  // The precondition that used to be missing: this map is one the contract accepts.
  assert.deepEqual(validate(map, { repoRoot: REPO_ROOT }).errors, [],
    'the fixture must be legal IR — a test that can only be written illegally proves nothing about '
    + 'what the renderer will ever be handed');

  const findings = driftOf(map);
  assert.deepEqual(findings.filter((f) => f.nodeId === 'component.tiny_core').map((f) => f.class), ['STALE']);
  assert.deepEqual(
    findings.filter((f) => f.nodeId === 'component.dispatch_table').map((f) => f.class), ['UNDOCUMENTED'],
  );

  const blocks = bucketBlocks(renderPage(map, findings));
  assert.ok(blocks.get('ambiguous-review').includes('STALE'), 'the STALE was lifted out of the collapsed group');
  assert.ok(!blocks.get('implementation-detail').includes('STALE'), 'a STALE must never be collapsed');
  assert.ok(blocks.get('implementation-detail').includes('UNDOCUMENTED'));
  // …and the STALE that was lifted is the one on the INTERNAL node, not some other row.
  assert.ok(blocks.get('ambiguous-review').includes('<code>component.tiny_core</code>'));
  assert.ok(blocks.get('implementation-detail').includes('<code>component.dispatch_table</code>'));
});

/**
 * Every bucket block the drift lane ACTUALLY emitted, in PAGE ORDER, each with the `class · nodeId`
 * of its rows in the order they were rendered.
 *
 * A `Map` because insertion order IS the order a reader meets the groups in, and an empty group is
 * never emitted at all — so the keys are the emitted sequence, not the declared one.
 */
function emittedBuckets(html) {
  const lane = html.match(/data-carto-lane="drift"([\s\S]*?)<\/section>/);
  assert.ok(lane, 'the drift lane must be on the page at all');
  const emitted = new Map();
  for (const block of lane[1].matchAll(/data-carto-bucket="([a-z-]+)"([\s\S]*?)<!-- \/carto-bucket -->/g)) {
    const body = block[2].match(/<tbody>([\s\S]*?)<\/tbody>/);
    const rows = [];
    for (const row of (body ? body[1] : '').matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
      const parsed = JSON.parse(rowSignature(row[1]));
      rows.push(`${parsed.class} ${parsed.nodeId}`);
    }
    emitted.set(block[1], rows);
  }
  return emitted;
}

/**
 * The whole of P4h for one map — factored so the invariant is checked both where all three groups
 * render and where only some do.
 */
function assertOrderingSentenceMatchesTheRender(map, what) {
  const findings = driftOf(map);
  assert.notEqual(findings.length, 0, `${what}: fixture precondition — the map must actually drift`);
  const html = renderPage(map, findings);

  const stated = html.match(/<p data-carto-order="attention">([\s\S]*?)<\/p>/);
  assert.ok(stated, `${what}: the drift lane must state, in ONE marked paragraph, the order it renders in`);
  const sentence = stated[1].toLowerCase();

  const emitted = emittedBuckets(html);
  assert.notEqual(emitted.size, 0, `${what}: fixture precondition — at least one bucket must render`);

  // (1) The sentence must NAME every group it renders, by the title that group's heading carries.
  //     A page that groups but describes no grouping is the defect this test exists for.
  const namedAt = new Map();
  for (const bucket of ATTENTION_BUCKETS) {
    const title = BUCKET_META[bucket].title.toLowerCase();
    const index = sentence.indexOf(title);
    if (emitted.has(bucket)) {
      assert.notEqual(index, -1,
        `${what}: the page renders a "${title}" group, but its ordering sentence never names it — `
        + `so the sentence describes an order the page does not produce: "${stated[1]}"`);
    }
    if (index !== -1) namedAt.set(bucket, index);
  }

  // (2) …and must name them in the order it renders them. Restricted to the groups actually
  //     emitted, because an empty one is not rendered and a sentence may still mention it.
  const claimed = [...namedAt.entries()]
    .sort((a, b) => a[1] - b[1])
    .map(([bucket]) => bucket)
    .filter((bucket) => emitted.has(bucket));
  assert.deepEqual(claimed, [...emitted.keys()],
    `${what}: the sentence promises ${claimed.join(' → ')} but the page emits `
    + `${[...emitted.keys()].join(' → ')}`);

  // (3) The second half of the claim — WITHIN a group, the drift engine's reporting order, not
  //     permuted. Derived from the RAW engine output and the pure table read, so this is not
  //     `groupByAttention` being asked whether it agrees with itself.
  const byId = new Map(map.nodes.map((n) => [n.id, n]));
  for (const [bucket, rows] of emitted) {
    const expected = findings
      .filter((f) => bucketForFinding(f, byId.get(f.nodeId)) === bucket)
      .map((f) => `${escapeXml(f.class)} ${escapeXml(f.nodeId)}`);
    assert.deepEqual(rows, expected,
      `${what}: ${bucket} does not carry the engine's reporting order within the group`);
  }
}

/**
 * The page ORDERS by attention bucket and then by the engine — and for one build it SAID it ordered
 * by the engine alone, which on the real subject put STALE findings ahead of UNDOCUMENTED ones that
 * the engine had reported first. Prose that asserts something the code does not do is the exact
 * defect class this skill exists to detect, so the ordering sentence is pinned to the render rather
 * than trusted.
 */
test('P4h · the lane\'s ordering sentence describes the order the page ACTUALLY emits', () => {
  assertOrderingSentenceMatchesTheRender(threeBucketMap(), 'all three groups');
  assertOrderingSentenceMatchesTheRender(loadTiny(), 'a subset of the groups');
});

/**
 * The drift shape that DEFEATS a deduplicating completeness check: two findings on the SAME node,
 * with IDENTICAL citations, differing only in `detail`. This is not a contrived shape — one node can
 * carry two contradictions cited at the same two lines, and `computeDrift` emits one finding for each.
 *
 * Compare unique nodeIds and unique citations, as the hand-run bash gate in the execution plan did,
 * and dropping one of these two rows changes NEITHER set, while the page's declared count is taken
 * from the input array rather than from the rows — so the drop passes every check. Comparing rendered
 * ROWS is what closes that hole, which is why the invariant lives here and not in a checklist.
 */
function collidingDrift(map) {
  const findings = driftOf(map);
  const at = findings.findIndex((f) => f.nodeId === 'mode.check');
  assert.notEqual(at, -1, 'fixture precondition: the STALE on mode.check is what gets a twin');
  const twin = structuredClone(findings[at]);
  twin.detail = 'A second contradiction on the same node, cited at exactly the same two lines.';
  return [...findings.slice(0, at + 1), twin, ...findings.slice(at + 1)];
}

/**
 * Every finding row the page ACTUALLY rendered, in page order, parsed back into its signature.
 *
 * Deliberately not keyed by bucket and deliberately not de-duplicated anywhere: a check that folds
 * its own inputs together cannot see a fold in the page. The `<!-- /carto-bucket -->` marker is the
 * structural terminator `driftGroup` emits for exactly this purpose.
 */
function renderedFindingRows(html) {
  const lane = html.match(/data-carto-lane="drift"([\s\S]*?)<\/section>/);
  assert.ok(lane, 'the drift lane must be on the page at all');
  const rows = [];
  for (const bucket of lane[1].matchAll(/data-carto-bucket="[a-z-]+"([\s\S]*?)<!-- \/carto-bucket -->/g)) {
    const body = bucket[1].match(/<tbody>([\s\S]*?)<\/tbody>/);
    if (!body) continue;
    for (const row of body[1].matchAll(/<tr>([\s\S]*?)<\/tr>/g)) rows.push(rowSignature(row[1]));
  }
  return rows;
}

/** The label the row wraps `refutedQuote` in — one statement, so the parse and the render agree. */
const REFUTED_LABEL = 'Refuted words (the exact fragment of the claim the evidence contradicts): ';

/**
 * class · nodeId · detail · refutedQuote · citations IN ORDER — what a row must carry to BE that
 * finding.
 *
 * `refutedQuote` joined the signature on 2026-08-14. It was rendered by `map.md` and by nothing on the
 * page, and a completeness check that compares four of a finding's five fields cannot notice the
 * fifth going missing — which is how it went missing. ADR C-019 makes the fragment the part that
 * tells a reader WHICH WORDS are wrong, so a row without it is a pointer nobody can check.
 */
function rowSignature(row) {
  const cells = [...row.matchAll(/<td>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
  assert.equal(cells.length, 4, `a drift row must have four cells, saw ${cells.length}: ${row}`);
  const badge = cells[0].match(/<span class="carto-badge[^"]*">([^<]*)<\/span>/);
  const node = cells[1].match(/<code>([\s\S]*?)<\/code>/);
  assert.ok(badge && node, `a drift row must carry a class badge and a node id: ${row}`);
  // The detail cell carries the detail and, for a record that named one, the refuted fragment behind
  // its label. Split rather than matched loosely, so an unlabelled fragment fails instead of passing.
  const refuted = cells[2].match(
    new RegExp(`<span class="carto-quote">${REFUTED_LABEL.replace(/[()]/g, '\\$&')}([\\s\\S]*?)</span>`),
  );
  return JSON.stringify({
    class: badge[1],
    nodeId: node[1],
    detail: cells[2].split('<span class="carto-quote">')[0],
    refutedQuote: refuted ? refuted[1] : null,
    citations: [...cells[3].matchAll(/<span class="carto-cite"><code>([\s\S]*?)<\/code>/g)].map((m) => m[1]),
  });
}

/** The same signature, computed from the finding the engine handed the renderer. */
const findingSignature = (finding) => JSON.stringify({
  class: escapeXml(finding.class),
  nodeId: escapeXml(finding.nodeId),
  detail: escapeXml(finding.detail),
  refutedQuote: finding.refutedQuote === undefined ? null : escapeXml(finding.refutedQuote),
  citations: finding.citations.map((c) => `${escapeXml(c.path)}:${c.line}`),
});

test('P4g · every finding is ONE rendered row, and the declared count is the ROW count (not drift.length)', () => {
  const map = threeBucketMap();
  const findings = collidingDrift(map);

  // Precondition: the page's inputs really do carry the collapsing pair — same node, same citations
  // in the same order, different detail. Without this the test proves nothing the old greps missed.
  const twins = findings.filter((f) => f.nodeId === 'mode.check');
  assert.equal(twins.length, 2, 'two findings must sit on one node');
  assert.deepEqual(twins[0].citations, twins[1].citations, 'their citations must be IDENTICAL');
  assert.notEqual(twins[0].detail, twins[1].detail, 'and `detail` must be the only difference');
  assert.equal(
    new Set(findings.map(findingSignature)).size, findings.length,
    'the findings must still be distinguishable as findings — only the deduped view collapses them',
  );

  const html = renderPage(map, findings);
  const rows = renderedFindingRows(html);

  // (1) TOTAL — summed across every bucket, one row per finding.
  assert.equal(rows.length, findings.length,
    `the drift lane rendered ${rows.length} rows for ${findings.length} findings`);

  // (2) EXACTLY ONE each, matched whole. A dropped row leaves a signature unrendered; a duplicated
  //     one renders a signature twice. Both fail here, and neither is visible to a deduped compare.
  const expected = findings.map(findingSignature);
  assert.deepEqual([...rows].sort(), [...expected].sort(),
    'the rendered rows are not the computed findings, one for one');
  for (const signature of expected) {
    assert.equal(rows.filter((r) => r === signature).length, 1,
      `not rendered exactly once: ${signature}`);
  }

  // (3) The lane's DECLARED count must agree with what was actually rendered. The renderer derives
  //     it from the input array, so comparing it to `drift.length` is circular and always true; this
  //     compares it to the rows, which is the check that catches a silently shortened table.
  const declared = html.match(/<p data-carto-order="attention">(\d+) findings?,/);
  assert.ok(declared, 'the drift lane must DECLARE its count in words a reader can check');
  assert.equal(Number(declared[1]), rows.length,
    `the lane declares ${declared[1]} findings but rendered ${rows.length} rows`);
});

test('P4i · a STALE row states WHICH WORDS the evidence refutes (ADR C-019)', () => {
  // The run-4 defect, on the page: a substantively CORRECT STALE whose record cited an ACCURATE line.
  // What makes such a finding checkable is not the citation — the reader can already see that — but
  // the fragment the evidence is said to falsify. `map.md` carried it and `map.html` did not, so the
  // two reports said different things about the same finding, and the page said the less useful half.
  const map = loadTiny();
  const findings = driftOf(map);
  const stale = findings.filter((f) => f.class === 'STALE');
  assert.equal(stale.length, 2, 'fixture precondition: two STALE findings, each from a record with a fragment');

  const html = renderPage(map, findings);
  for (const finding of stale) {
    assert.ok(finding.refutedQuote !== undefined, `${finding.nodeId}: the finding must carry the fragment`);
    assert.ok(html.includes(`${REFUTED_LABEL}${escapeXml(finding.refutedQuote)}`),
      `${finding.nodeId}: the page must state the refuted fragment, and say what it is: `
      + `${JSON.stringify(finding.refutedQuote)}`);
  }

  // …and it is ESCAPED like every other source-derived string, not interpolated raw.
  //
  // THE FIXTURE HAS TO BE A MAP THAT COULD EXIST, and it did not used to be: planting the tag in
  // `contradictions[0].claim.text` alone left the node's OWN `claims[]` entry carrying the original
  // words, and a contradiction must cite one of that node's own claims — so `validate()` refused the
  // map and this branch was showing that the renderer escapes a record no extractor could ever write.
  // The plant therefore goes into the CITED CLAIM and into the record's copy of it together, which is
  // the only way a real map can carry the fragment at all. The two assertions below are what keep it
  // honest: the map is legal, and the finding this page renders really carries the hostile string.
  const PLANTED = '<img src=x onerror=alert(1)>';
  const hostile = loadTiny();
  const node = hostile.nodes.find((n) => n.id === 'mode.check');
  const record = node.contradictions[0];
  const cited = node.claims.find((c) => c.path === record.claim.path && c.line === record.claim.line);
  assert.ok(cited, 'fixture precondition: the contradiction cites one of this node\'s own claims');
  const plantedText = cited.text.replace(record.refutedQuote, PLANTED);
  assert.notEqual(plantedText, cited.text, 'fixture precondition: the fragment really is in the claim');
  cited.text = plantedText;
  record.claim.text = plantedText;
  record.refutedQuote = PLANTED;
  assert.deepEqual(validate(hostile, { repoRoot: REPO_ROOT }).errors, [],
    'the hostile fixture must be a LEGAL map — a branch that renders one the contract refuses is not '
    + 'testing the hostile path, it is testing a map that cannot exist');

  const poisonedFindings = driftOf(hostile);
  assert.ok(poisonedFindings.some((f) => f.class === 'STALE' && f.refutedQuote === PLANTED),
    'and the drift engine must actually carry the hostile fragment into a finding — otherwise the page '
    + 'below is escaping nothing');
  const poisoned = renderPage(hostile, poisonedFindings);
  assert.ok(poisoned.includes(`${REFUTED_LABEL}&lt;img src=x onerror=alert(1)&gt;`),
    'the fragment must reach the page escaped, and exactly');
  assert.ok(!poisoned.includes('<img src=x'), 'a tag opener from a refuted fragment reached the page');
});

test('P5 · coverage renders partial/skipped WITH reasons, and says plainly when neither occurred', () => {
  assert.match(page(loadTiny()), /no file was partially read or skipped/i);

  const map = loadTiny();
  const moved = map.coverage.read.pop();
  map.coverage.partial.push({ path: moved, why: 'budget ran out after 40 lines' });
  map.coverage.skipped.push({ path: 'plugin/x/vendor.min.js', why: 'generated bundle' });
  const html = renderPage(map, driftOf(map));
  assert.ok(html.includes('budget ran out after 40 lines'));
  assert.ok(html.includes('generated bundle'));
  assert.doesNotMatch(html, /no file was partially read or skipped/i);
});

test('P6 · wide content scrolls inside its own container', () => {
  const html = page(loadTiny());
  assert.ok(html.includes('overflow-x: auto'), 'the scroll container must be defined');
  const wrapped = html.split('class="carto-scroll"').length - 1;
  assert.ok(wrapped >= 2, `expected the tables and the mermaid block to be wrapped, saw ${wrapped}`);
  // every <table> and every mermaid block sits inside one
  for (const fragment of html.split('<table>').slice(1)) {
    assert.ok(fragment.length > 0);
  }
  assert.equal(
    html.split('<table>').length - 1 + html.split('<pre class="mermaid">').length - 1 <= wrapped,
    true,
    'every table and mermaid block must have its own scroll container',
  );
});

test('P7 · all source-derived text is HTML-escaped', () => {
  const map = loadTiny();
  map.nodes.find((n) => n.id === 'mode.check').label = '<img src=x onerror=alert(1)>';
  map.subject.summary = '</style><script>alert(1)</script>';
  map.sources[0].path = `${TINY_REL}/"onmouseover="alert(1)`;
  const html = renderPage(map, driftOf(map));
  assert.ok(!html.includes('<img'));
  assert.ok(!html.includes('<script'));
  assert.ok(!html.includes('</style><'), 'a </style> in content would break out of the stylesheet');
  assert.ok(!html.includes('"onmouseover='), 'an attribute could not be broken open');
});

test('P8 · findings is REQUIRED — no default may render a drifting map as clean', () => {
  const map = loadTiny();
  assert.throws(() => renderPage(map), /findings is required/);
});

test('P8b · a missing display field fails LOUDLY — never an empty element or "undefined"', () => {
  // `undefined:undefined` reaching a rendered page was a real defect in this build. An absent
  // REQUIRED field must throw, not degrade to a blank heading that reads as "this thing has no name".
  for (const strip of [
    (m) => { delete m.subject.title; },
    (m) => { delete m.subject.summary; },
    (m) => { delete m.subject.slug; },
    (m) => { delete m.sources[0].role; },
    (m) => { delete m.sources[0].sha256; },
    (m) => { delete m.sources[0].lines; },
  ]) {
    const map = loadTiny();
    strip(map);
    assert.throws(() => renderPage(map, driftOf(map)), /expected a string|expected a number/,
      'a missing required field was rendered as a blank instead of refused');
  }
});

test('P8c · no rendered page ever contains the word "undefined"', () => {
  assert.doesNotMatch(page(loadTiny()), /undefined/);
});

test('P9 · the generation stamp renders into the page', () => {
  assert.ok(page(loadTiny(), { generatedAt: 'STAMP-ABC' }).includes('STAMP-ABC'));
});

// ─── repoRoot derivation ─────────────────────────────────────────────────────────────────────────

test('R1 · an explicit repoRoot wins', () => {
  const { root, mapPath } = fixtureRepo();
  assert.equal(resolveRepoRoot(mapPath, root), fs.realpathSync(root));
});

test('R2 · with no explicit root, git rev-parse runs FROM THE MAP\'S OWN DIRECTORY', () => {
  assert.equal(resolveRepoRoot(TINY, undefined), fs.realpathSync(REPO_ROOT));
});

test('R3 · outside a repo and with no explicit root it FAILS, naming both options — never cwd', () => {
  const { mapPath } = fixtureRepo();
  let message = '';
  try {
    resolveRepoRoot(mapPath, undefined);
    assert.fail('a missing repo root must never be inferred');
  } catch (e) {
    message = e.message;
  }
  assert.match(message, /--repo-root/);
  assert.match(message, /git/);
  assert.ok(!message.includes(process.cwd()) || /never/.test(message));
  assert.match(message, /cwd|current working directory/i);
});

// ─── render: the four outputs, scanned before any write ──────────────────────────────────────────

test('W1 · writes ALL FOUR outputs and returns their paths plus the findings', () => {
  const out = tmp();
  const result = render(TINY, out, { repoRoot: REPO_ROOT, generatedAt: 'STAMP' });
  assert.deepEqual(listing(out), OUTPUTS);
  assert.equal(result.htmlPath, path.join(out, 'map.html'));
  assert.equal(result.mdPath, path.join(out, 'map.md'));
  assert.equal(result.driftPath, path.join(out, 'drift.json'));
  assert.equal(result.mapOutPath, path.join(out, 'map.json'));
  assert.equal(result.findings.length, 4);
  // `render` owns writing the snapshot, so no caller can write it unscanned.
  assert.equal(fs.readFileSync(result.mapOutPath, 'utf8'), serialize(loadTiny()));
});

test('W2 · a secret ANYWHERE fails closed and leaves NO file behind', () => {
  for (const plant of [
    (m) => { m.subject.summary = 'owned by ada@example.com'; },
    (m) => { m.nodes[0].summary = 'AKIAIOSFODNN7EXAMPLE'; },
    (m) => { m.nodes[0].evidence.push({ path: `${TINY_REL}/run.sh`, line: 1, note: 'ghp_abcdefghijklmnopqrstuvwxyz0123456789' }); },
  ]) {
    const map = loadTiny();
    plant(map);
    const src = path.join(tmp(), 'map.json');
    fs.writeFileSync(src, JSON.stringify(map));
    const out = tmp();
    assert.throws(() => render(src, out, { repoRoot: REPO_ROOT }), /secret|fail-closed/i);
    assert.deepEqual(listing(out), [], 'a file was written despite an unclean artifact');
  }
});

test('W2b · map.json is scanned too — a secret only IT carries still fails closed', () => {
  // An extra top-level key validates fine and is serialized into map.json, but neither map.md nor
  // map.html renders it. If the snapshot were written unscanned, this would ship.
  const map = loadTiny();
  map.maintainerNote = 'reach ada@example.com';
  const src = path.join(tmp(), 'map.json');
  fs.writeFileSync(src, JSON.stringify(map));
  const out = tmp();

  const rendered = renderPage(map, driftOf(map));
  assert.ok(!rendered.includes('ada@example.com'), 'precondition: the page does not carry it');

  assert.throws(() => render(src, out, { repoRoot: REPO_ROOT }), /map\.json/);
  assert.deepEqual(listing(out), []);
});

test('W3 · an invalid map is rejected before anything is written', () => {
  const map = loadTiny();
  map.schemaVersion = '99';
  const src = path.join(tmp(), 'map.json');
  fs.writeFileSync(src, JSON.stringify(map));
  const out = tmp();
  assert.throws(() => render(src, out, { repoRoot: REPO_ROOT }), /schemaVersion/);
  assert.deepEqual(listing(out), []);
});

test('W4 · a stale map throws REGENERATE-not-patch, and no escape hatch can switch the check off', () => {
  const { root, mapPath, sourceFile } = fixtureRepo();
  const out = tmp();
  assert.doesNotThrow(() => render(mapPath, out, { repoRoot: root }));

  fs.appendFileSync(sourceFile, '\n# a later edit the snapshot never saw\n');
  const stale = tmp();
  assert.throws(() => render(mapPath, stale, { repoRoot: root }), /regenerate/i);
  assert.deepEqual(listing(stale), []);

  // Freshness is not optional, and no option may make it so.
  for (const escape of [{ skipFreshness: true }, { force: true }, { freshness: false }]) {
    assert.throws(
      () => render(mapPath, tmp(), { repoRoot: root, ...escape }),
      /regenerate/i,
      `${JSON.stringify(escape)} bypassed the freshness gate`,
    );
  }
});

test('W5 · the explicit root and the git-derived root produce the same verdict, byte for byte', () => {
  const explicit = tmp();
  const derived = tmp();
  render(TINY, explicit, { repoRoot: REPO_ROOT, generatedAt: 'STAMP' });
  render(TINY, derived, { generatedAt: 'STAMP' });
  for (const name of OUTPUTS) {
    assert.equal(
      fs.readFileSync(path.join(explicit, name), 'utf8'),
      fs.readFileSync(path.join(derived, name), 'utf8'),
      `${name} differed between the explicit and the git-derived root`,
    );
  }
});

test('W6 · renders from NORMALIZED order — an array-shuffled twin produces identical bytes', () => {
  const shuffled = loadTiny();
  shuffled.nodes.reverse();
  shuffled.edges.reverse();
  shuffled.views.reverse();
  shuffled.sources.reverse();
  shuffled.coverage.read.reverse();
  for (const n of shuffled.nodes) {
    if (Array.isArray(n.evidence)) n.evidence.reverse();
    if (Array.isArray(n.claims)) n.claims.reverse();
  }
  const src = path.join(tmp(), 'map.json');
  fs.writeFileSync(src, JSON.stringify(shuffled));

  const a = tmp();
  const b = tmp();
  render(TINY, a, { repoRoot: REPO_ROOT, generatedAt: 'STAMP' });
  render(src, b, { repoRoot: REPO_ROOT, generatedAt: 'STAMP' });
  for (const name of OUTPUTS) {
    assert.equal(
      fs.readFileSync(path.join(b, name), 'utf8'),
      fs.readFileSync(path.join(a, name), 'utf8'),
      `${name} leaked extractor order`,
    );
  }
});

test('W7 · generation time lands in map.html and map.md, and NEVER in map.json or drift.json', () => {
  const out = tmp();
  const stamp = '2026-08-13T09:15:00Z';
  render(TINY, out, { repoRoot: REPO_ROOT, generatedAt: stamp });
  assert.ok(fs.readFileSync(path.join(out, 'map.html'), 'utf8').includes(stamp));
  assert.ok(fs.readFileSync(path.join(out, 'map.md'), 'utf8').includes(stamp));
  for (const name of ['map.json', 'drift.json']) {
    const text = fs.readFileSync(path.join(out, name), 'utf8');
    assert.ok(!text.includes(stamp), `${name} carries a wall-clock stamp (ADR C-003)`);
    assert.doesNotMatch(text, /\d{4}-\d{2}-\d{2}T\d{2}/, `${name} carries an ISO date-time`);
  }
});

test('W8 · a default generation time is supplied, and it is a real instant', () => {
  const out = tmp();
  render(TINY, out, { repoRoot: REPO_ROOT });
  const md = fs.readFileSync(path.join(out, 'map.md'), 'utf8');
  const match = md.match(/\*\*Generated:\*\* (.+)/);
  assert.ok(match, 'map.md must always carry a generation time');
  // Read back the way every other value in the report is: the stamp is a string this module did not
  // author either, so it is rendered as an inline code span and recovered through the same inverse.
  const stamp = recoverText(match[1]);
  assert.ok(!Number.isNaN(Date.parse(stamp)), `not a parseable instant: ${stamp}`);
});

test('W9 · the returned findings do not alias anything render keeps', () => {
  const out = tmp();
  const first = render(TINY, out, { repoRoot: REPO_ROOT, generatedAt: 'STAMP' });
  first.findings[0].class = 'MUTATED';
  const second = render(TINY, tmp(), { repoRoot: REPO_ROOT, generatedAt: 'STAMP' });
  assert.notEqual(second.findings[0].class, 'MUTATED');
});

// ─── the CLI ─────────────────────────────────────────────────────────────────────────────────────

const runCli = (script, args, cwd) => execFileSync(process.execPath, [script, ...args], {
  cwd,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
});

test('C1 · the CLI runs when invoked by a RELATIVE path — and actually writes', () => {
  const out = tmp();
  runCli(
    path.relative(REPO_ROOT, RENDER_CLI),
    [path.relative(REPO_ROOT, TINY), out],
    REPO_ROOT,
  );
  assert.deepEqual(listing(out), OUTPUTS, 'the relative invocation was a silent no-op');
});

test('C2 · the CLI runs THROUGH A SYMLINK — the documented personal install mode', () => {
  const linkDir = tmp('carto-link-');
  const link = path.join(linkDir, 'carto-render.mjs');
  fs.symlinkSync(RENDER_CLI, link);
  const out = tmp();
  runCli('./carto-render.mjs', [TINY, out], linkDir);
  assert.deepEqual(listing(out), OUTPUTS, 'the symlinked invocation was a silent no-op');
});

test('C3 · the CLI derives the repo root from the map\'s directory when not told one', () => {
  const out = tmp();
  // No --repo-root, and cwd is somewhere else entirely: the root must come from the MAP's directory.
  runCli(RENDER_CLI, [TINY, out], os.tmpdir());
  assert.deepEqual(listing(out), OUTPUTS);
});

test('C4 · the CLI honours --repo-root and enforces freshness through it', () => {
  const { root, mapPath, sourceFile } = fixtureRepo();
  const ok = tmp();
  runCli(RENDER_CLI, [mapPath, ok, '--repo-root', root], os.tmpdir());
  assert.deepEqual(listing(ok), OUTPUTS);

  fs.appendFileSync(sourceFile, '\n# edited after the snapshot\n');
  const bad = tmp();
  assert.throws(
    () => runCli(RENDER_CLI, [mapPath, bad, '--repo-root', root], os.tmpdir()),
    /Command failed|regenerate/i,
  );
  assert.deepEqual(listing(bad), [], 'the CLI wrote a page from a stale snapshot');
});

test('C5 · the CLI refuses a bad invocation with a usage message and a non-zero exit', () => {
  for (const args of [[], [TINY]]) {
    let failed = false;
    try {
      runCli(RENDER_CLI, args, REPO_ROOT);
    } catch (e) {
      failed = true;
      assert.match(String(e.stderr), /usage/i);
    }
    assert.ok(failed, `expected a non-zero exit for ${JSON.stringify(args)}`);
  }
});

// ─── D1-D3 · what a zero-finding PAGE may claim, and in whose voice ──────────────────────────────

const nodeOf = (map, id) => map.nodes.find((n) => n.id === id);

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
 * The page's twin of `markdown.test.mjs`'s `cleanExceptInferred()` — spotless over every node that
 * can be reported, and carrying on INFERRED nodes one instance of each shape the zero-finding
 * paragraph swears the map does not contain.
 *
 * The two artifacts state ONE rule, and a defect fixed in `map.md` alone is this skill's own drift
 * class shipped in the tool that detects it (test 10b of `doc-harvest.test.mjs` records the round
 * where exactly that happened: the page was corrected for C-018 and the Markdown twin went on
 * telling every reader the opposite for as long as the test asked only about the page). So the
 * fixture is duplicated deliberately rather than shared — each suite proves its own artifact.
 *
 * Neither counter-example is planted: `component.dispatch_table` ships in the fixture as
 * `inferred: true`, documented at `SKILL.md:18`, with `evidence: []`; and `mode.check` carries the
 * fixture's own recorded contradiction, with its `inferred` flag the single mutation.
 */
function cleanExceptInferred() {
  const map = loadTiny();
  pruneNodes(map, ['mode.build', 'env.tiny_debug']); // a real PHANTOM and a real UNDOCUMENTED
  nodeOf(map, 'mode.check').inferred = true;
  delete nodeOf(map, 'outcome.pass').contradictions;
  return map;
}

/** The same map, minus the one thing that makes it clean — so the page takes its OTHER branch. */
function withheldExceptInferred() {
  const map = loadTiny();
  pruneNodes(map, ['mode.build']);
  nodeOf(map, 'mode.check').inferred = true;
  delete nodeOf(map, 'outcome.pass').contradictions;
  delete nodeOf(map, 'env.tiny_debug').docHarvest;
  return map;
}

const driftLane = (html) => html.slice(html.indexOf('id="drift"'), html.indexOf('<section class="carto-section" id="view-'));

/** The two clauses written as universals over the whole map, which are false on one. */
const UNSCOPED = [
  ['clause 1 — that every documented capability is evidenced', /Every documented capability carries code evidence/i],
  ['clause 3 — that no contradiction was recorded', /recorded no contradiction[.,]/i],
];

test('D1 · a CLEAN page scopes all THREE derived clauses to the non-inferred nodes, not just the middle one', () => {
  // `computeDrift` excludes `inferred: true` from EVERY finding class — `awaitsDocVerdict` returns
  // false for one and the main loop `continue`s past one — so an inferred node may legally be
  // documented with `evidence: []`, or carry a recorded contradiction, and the finding list stays
  // empty. Two of the paragraph's three clauses were written as universals over the whole map
  // anyway; on this map both are false, and the page asserts them to the one reader who is here to
  // find out whether the map contradicts itself.
  const map = cleanExceptInferred();
  assert.deepEqual(validate(map, { repoRoot: REPO_ROOT }).errors, [],
    'the counter-example must be a map the contract ACCEPTS');
  const { findings, coverage } = computeDrift(map);
  assert.deepEqual(findings, [], 'precondition: no finding at all');
  assert.deepEqual(coverage.withheld, [], 'precondition: and nothing withheld — the CLEAN branch');
  assert.deepEqual(nodeOf(map, 'component.dispatch_table').evidence, [],
    'clause 1: an inferred node documented with no code evidence whatever');
  assert.equal(nodeOf(map, 'mode.check').contradictions.length, 1,
    'clause 3: and one the extractor recorded a contradiction against');

  const lane = driftLane(renderPage(map, findings, { generatedAt: 'a fixed stamp' }));
  for (const [what, unscoped] of UNSCOPED) {
    assert.doesNotMatch(lane, unscoped,
      `${what} is FALSE on this map — an inferred node refutes it, and the page states it anyway`);
  }
  assert.match(lane, /Every documented <strong>non-inferred<\/strong>\s*capability carries code evidence/i,
    'clause 1 must carry the qualifier clause 2 already carries');
  assert.match(lane, /recorded no contradiction <strong>against a non-inferred node<\/strong>/,
    'and so must clause 3');
  assert.match(lane, /governs all three/i,
    'and the explanation must cover every clause it qualifies, not only the middle one');
});

test('D2 · the NOT-a-clean-bill branch scopes the same two clauses — a withheld verdict does not license them', () => {
  const map = withheldExceptInferred();
  assert.deepEqual(validate(map, { repoRoot: REPO_ROOT }).errors, []);
  const { findings, coverage } = computeDrift(map);
  assert.deepEqual(findings, [], 'precondition: nothing is accused');
  assert.equal(coverage.withheld.length, 1, 'precondition: and exactly one verdict is withheld');

  const lane = driftLane(renderPage(map, findings, { generatedAt: 'a fixed stamp' }));
  assert.match(lane, /not a clean\s*bill of health/i, 'precondition: this is the other branch');
  for (const [what, unscoped] of UNSCOPED) {
    assert.doesNotMatch(lane, unscoped, `${what} is FALSE on this map here too`);
  }
});

test('D3 · the page describes the harvest ATTESTATION, and never an act the pipeline cannot observe', () => {
  // ADR C-018's amendment: `docHarvest.searched` and `sources[].role` are both extractor-authored,
  // and the HARVEST CHECKS only compare the two lists to each other — no harvest check opens a file.
  // *(Scoped 2026-08-28 per ADR C-026: "the pipeline never opens a file" is false as written —
  // `render.mjs` calls `checkFreshness()`, which reads every declared source. Freshness opens a file
  // to compare its CURRENT bytes against a declared digest; nothing anywhere observes whether an
  // extractor searched it, and that is the limitation this test is about.)* The page
  // nonetheless told readers a harvest "ran". An extractor who opened nothing produces byte-identical
  // records, so no artifact here can support the claim. Test 10c of `doc-harvest.test.mjs` already
  // forbids the GUARANTEE wording; this is the same overclaim wearing a verb instead of a noun.
  const forbidden = [
    ['that a harvest was performed, or was not', /harvest (?:was run|ran)\b/i],
    ['that a search was performed', /\bthe search ran\b|\bsearch was run\b/i],
    ['that a documentation surface went unread', /\bunread\b/i],
  ];
  for (const [what, map] of [['tiny', loadTiny()], ['a withheld map', withheldExceptInferred()]]) {
    const html = renderPage(map, computeDrift(map).findings, { generatedAt: 'a fixed stamp' });
    for (const [claim, pattern] of forbidden) {
      assert.doesNotMatch(html, pattern,
        `${what}: map.html may not tell a reader ${claim} — no harvest check observes a file`);
    }
  }

  // …and the coverage section must still state the fact, as a fact about the RECORD.
  const html = page(loadTiny(), { generatedAt: 'a fixed stamp' });
  assert.match(html, /Where no harvest attestation the contract can ACCEPT covers a node, the map does not know/,
    'the coverage section must restate the gap as a missing attestation, not a search that never ran');
});
