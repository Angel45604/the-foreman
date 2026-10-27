// the-cartographer — golden-file tests (PDR §12, execution plan Task 8).
//
// Fragment assertions catch CONTENT; golden bytes catch CHURN. Phase 6's structural diff compares one
// committed snapshot against the next, so anything that makes regeneration produce different bytes
// from identical input — a wall-clock stamp, a sort that is not total, a Map iteration order — turns
// every future run into false drift. These tests are the thing that notices.
//
// ─── the timestamp trap ──────────────────────────────────────────────────────────────────────────
//
// `render` injects a generation time into `map.md`, so a golden `map.md` compared against a live clock
// fails on the next minute boundary. The plan names two ways out; this file takes the first — inject a
// FIXED, deliberately non-timestamp-shaped stamp — because it also keeps the committed goldens free of
// any date, which is the property test 5 asserts outright.
//
// Regenerate with:  UPDATE_GOLDEN=1 node --test plugin/skills/the-cartographer/references/golden.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { render } from './render.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..', '..');
const TINY = path.join(HERE, 'fixtures', 'tiny.map.json');
const GOLDEN_DIR = path.join(HERE, 'fixtures', 'golden');

/** Committed byte-for-byte. `map.html` is not among them: it is large, and its determinism is proved
 *  by the render-twice test below without freezing a whole stylesheet into a fixture. */
const GOLDEN_FILES = ['map.json', 'drift.json', 'map.md'];

/**
 * The fixed stamp. Deliberately NOT ISO-shaped: a golden carrying a real instant would both churn and
 * violate the "no timestamp in any golden" rule the serializer enforces for `map.json` (ADR C-003).
 */
const GOLDEN_STAMP = 'fixed stamp for the golden fixture (the real one is a wall-clock instant)';

const UPDATING = process.env.UPDATE_GOLDEN === '1';

const tmpdirs = [];
function tmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'carto-golden-'));
  tmpdirs.push(dir);
  return dir;
}
process.on('exit', () => {
  for (const dir of tmpdirs) fs.rmSync(dir, { recursive: true, force: true });
});

const read = (dir, name) => fs.readFileSync(path.join(dir, name), 'utf8');

/** One render of the committed fixture, with the stamp pinned. */
function renderGolden(mapPath = TINY) {
  const out = tmp();
  render(mapPath, out, { repoRoot: REPO_ROOT, generatedAt: GOLDEN_STAMP });
  return out;
}

if (UPDATING) {
  const out = renderGolden();
  fs.mkdirSync(GOLDEN_DIR, { recursive: true });
  for (const name of GOLDEN_FILES) fs.copyFileSync(path.join(out, name), path.join(GOLDEN_DIR, name));
  process.stdout.write(`# UPDATE_GOLDEN=1 — rewrote ${GOLDEN_FILES.join(', ')} in ${GOLDEN_DIR}\n`);
  process.stdout.write('# READ each regenerated file before committing it: a golden blessed unread\n');
  process.stdout.write('# only freezes a bug in place.\n');
}

test('1 · the committed goldens match byte for byte', () => {
  const out = renderGolden();
  for (const name of GOLDEN_FILES) {
    assert.equal(
      read(out, name),
      read(GOLDEN_DIR, name),
      `${name} drifted from its golden. If the change is intended, regenerate with UPDATE_GOLDEN=1 `
      + 'and READ the result before committing.',
    );
  }
});

test('2 · the comparison is timestamp-INDEPENDENT — only map.md carries the stamp at all', () => {
  const early = tmp();
  const late = tmp();
  render(TINY, early, { repoRoot: REPO_ROOT, generatedAt: 'STAMP-ONE' });
  render(TINY, late, { repoRoot: REPO_ROOT, generatedAt: 'STAMP-TWO' });

  // The snapshot and the derived findings are clock-free by construction (ADR C-003).
  assert.equal(read(early, 'map.json'), read(late, 'map.json'));
  assert.equal(read(early, 'drift.json'), read(late, 'drift.json'));

  // map.md differs in EXACTLY one line — the stamp — so normalizing it is sufficient, and the golden
  // above is a stable comparison rather than a race against the next minute boundary.
  const differing = read(early, 'map.md').split('\n')
    .map((line, i) => [line, read(late, 'map.md').split('\n')[i]])
    .filter(([a, b]) => a !== b);
  assert.equal(differing.length, 1, `expected only the stamp to differ, got ${JSON.stringify(differing)}`);
  assert.ok(differing[0][0].includes('STAMP-ONE'));
  assert.ok(differing[0][1].includes('STAMP-TWO'));
});

test('3 · rendering twice produces byte-identical output, map.html included', () => {
  const first = renderGolden();
  const second = renderGolden();
  for (const name of [...GOLDEN_FILES, 'map.html']) {
    assert.equal(read(first, name), read(second, name), `${name} is not reproducible`);
  }
});

test('4 · an array-shuffled input serializes identically to the golden', () => {
  const shuffled = JSON.parse(fs.readFileSync(TINY, 'utf8'));
  shuffled.nodes.reverse();
  shuffled.edges.reverse();
  shuffled.views.reverse();
  shuffled.sources.reverse();
  shuffled.coverage.read.reverse();
  for (const node of shuffled.nodes) {
    if (Array.isArray(node.evidence)) node.evidence.reverse();
    if (Array.isArray(node.claims)) node.claims.reverse();
    if (Array.isArray(node.contradictions)) node.contradictions.reverse();
  }
  for (const view of shuffled.views) {
    if (Array.isArray(view.nodes)) view.nodes.reverse();
    if (Array.isArray(view.edges)) view.edges.reverse();
  }
  const src = path.join(tmp(), 'map.json');
  fs.writeFileSync(src, JSON.stringify(shuffled));

  const out = renderGolden(src);
  for (const name of GOLDEN_FILES) {
    assert.equal(read(out, name), read(GOLDEN_DIR, name), `${name} leaked the extractor's emission order`);
  }
});

test('5 · no golden file contains a timestamp', () => {
  for (const name of GOLDEN_FILES) {
    const text = read(GOLDEN_DIR, name);
    assert.doesNotMatch(text, /\d{4}-\d{2}-\d{2}/, `${name} carries an ISO date (ADR C-003)`);
    assert.doesNotMatch(text, /\d{2}:\d{2}:\d{2}/, `${name} carries a time of day`);
    assert.doesNotMatch(text, /(?<![\dA-Za-z])(?:19|20|21)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])(?![\dA-Za-z])/,
      `${name} carries a basic-format date`);
  }
});

test('6 · the golden map.json is itself a fixed point — re-rendering FROM it reproduces the goldens', () => {
  // The snapshot `render` writes must be exactly the snapshot it would accept as input, or the first
  // regeneration after a commit reports drift against the file it just wrote.
  const out = renderGolden(path.join(GOLDEN_DIR, 'map.json'));
  for (const name of GOLDEN_FILES) {
    assert.equal(read(out, name), read(GOLDEN_DIR, name), `${name} is not a fixed point`);
  }
});
