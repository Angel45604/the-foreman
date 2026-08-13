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
import { computeDrift } from './diff.mjs';
import { serialize } from './serialize.mjs';
import { recoverText } from './markdown.mjs';

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
