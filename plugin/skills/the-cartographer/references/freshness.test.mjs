import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkFreshness, digestOf, countLines } from './freshness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../../../..');
const FIXTURE = path.join(HERE, 'fixtures', 'tiny.map.json');
const SH = 'plugin/skills/the-cartographer/references/fixtures/tiny/run.sh';
const MD = 'plugin/skills/the-cartographer/references/fixtures/tiny/SKILL.md';

const load = () => JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
const src = (m, p) => m.sources.find((s) => s.path === p);

/** Build a throwaway repo root holding a copy of the fixture's two source files. */
function scratchRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'carto-fresh-'));
  const target = path.join(dir, path.dirname(SH));
  fs.mkdirSync(target, { recursive: true });
  fs.copyFileSync(path.join(REPO_ROOT, SH), path.join(dir, SH));
  fs.copyFileSync(path.join(REPO_ROOT, MD), path.join(dir, MD));
  return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('the committed fixture is fresh against the real repo — its digests and line counts are real', () => {
  const res = checkFreshness(load(), REPO_ROOT);
  assert.equal(res.fresh, true, res.details?.join('\n'));
  assert.deepEqual(res.stale, []);
  assert.deepEqual(res.missing, []);
  assert.deepEqual(res.lineMismatch, []);
  assert.deepEqual(res.unsafe, []);
});

test('digestOf / countLines are the same primitives the fixture was built with', () => {
  const buf = fs.readFileSync(path.join(REPO_ROOT, SH));
  assert.equal(digestOf(buf), createHash('sha256').update(buf).digest('hex'));
  assert.equal(countLines('a\nb\n'), 2);
  assert.equal(countLines('a\nb'), 2);
  assert.equal(countLines(''), 0);
  assert.equal(countLines('\n'), 1);
  assert.equal(checkFreshness(load(), REPO_ROOT).fresh, true);
  assert.equal(src(load(), SH).lines, countLines(fs.readFileSync(path.join(REPO_ROOT, SH), 'utf8')));
});

test('a changed file is STALE', () => {
  const { dir, cleanup } = scratchRepo();
  try {
    fs.appendFileSync(path.join(dir, SH), '# an edit nobody re-mapped\n');
    const res = checkFreshness(load(), dir);
    assert.equal(res.fresh, false);
    assert.deepEqual(res.stale, [SH]);
    assert.deepEqual(res.missing, []);
    assert.match(res.details.join('\n'), /sha256|digest/i);
  } finally { cleanup(); }
});

test('a deleted file is MISSING, not stale', () => {
  const { dir, cleanup } = scratchRepo();
  try {
    fs.rmSync(path.join(dir, MD));
    const res = checkFreshness(load(), dir);
    assert.equal(res.fresh, false);
    assert.deepEqual(res.missing, [MD]);
    assert.deepEqual(res.stale, []);
  } finally { cleanup(); }
});

test('a changed file and a deleted file are reported TOGETHER', () => {
  const { dir, cleanup } = scratchRepo();
  try {
    fs.appendFileSync(path.join(dir, SH), '# edited\n');
    fs.rmSync(path.join(dir, MD));
    const res = checkFreshness(load(), dir);
    assert.equal(res.fresh, false);
    assert.deepEqual(res.stale, [SH]);
    assert.deepEqual(res.missing, [MD]);
  } finally { cleanup(); }
});

test('SPEC DEFECT 5 · a correct digest with an INFLATED lines count is NOT fresh', () => {
  // validate() bounds citations against sources[].lines, which the extractor supplies. Digest
  // checking alone does not protect that number — so checkFreshness must RECOMPUTE it.
  const m = load();
  src(m, SH).lines = 9999;
  const res = checkFreshness(m, REPO_ROOT);
  assert.equal(res.fresh, false);
  assert.deepEqual(res.lineMismatch, [SH]);
  assert.ok(res.stale.includes(SH), 'a lines mismatch is a stale snapshot too');
  assert.match(res.details.join('\n'), /lines/);
  assert.match(res.details.join('\n'), /9999/);
});

test('a deflated lines count is caught the same way', () => {
  const m = load();
  src(m, MD).lines = 2;
  const res = checkFreshness(m, REPO_ROOT);
  assert.equal(res.fresh, false);
  assert.deepEqual(res.lineMismatch, [MD]);
});

test('checkFreshness THROWS without a repoRoot — it never falls back to process.cwd()', () => {
  assert.throws(() => checkFreshness(load()), /repoRoot/);
  assert.throws(() => checkFreshness(load(), ''), /repoRoot/);
  assert.throws(() => checkFreshness(load(), 42), /repoRoot/);
});

test('a path escaping repoRoot is UNSAFE and never read (defence in depth over validate)', () => {
  const { dir, cleanup } = scratchRepo();
  try {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'carto-out-'));
    fs.writeFileSync(path.join(outside, 'evil.sh'), 'echo hi\n');
    fs.symlinkSync(path.join(outside, 'evil.sh'), path.join(dir, 'link.sh'));
    try {
      const m = load();
      m.sources = [{ path: 'link.sh', sha256: 'a'.repeat(64), lines: 1, role: 'code' }];
      const res = checkFreshness(m, dir);
      assert.equal(res.fresh, false);
      assert.deepEqual(res.unsafe, ['link.sh']);
      assert.deepEqual(res.stale, []);

      const traversal = load();
      traversal.sources = [{ path: '../outside/evil.sh', sha256: 'a'.repeat(64), lines: 1, role: 'code' }];
      const res2 = checkFreshness(traversal, dir);
      assert.equal(res2.fresh, false);
      assert.deepEqual(res2.unsafe, ['../outside/evil.sh']);
    } finally { fs.rmSync(outside, { recursive: true, force: true }); }
  } finally { cleanup(); }
});

test('an absent sources collection is not fresh rather than vacuously fresh', () => {
  const m = load();
  delete m.sources;
  const res = checkFreshness(m, REPO_ROOT);
  assert.equal(res.fresh, false);
  assert.match(res.details.join('\n'), /sources/);
});

test('an EMPTY sources collection is not fresh either — verifying nothing is not a pass', () => {
  // `sources: []` loops zero times and would otherwise report fresh: a vacuous pass that would let a
  // snapshot claiming no inputs sail through every freshness gate.
  const m = load();
  m.sources = [];
  const res = checkFreshness(m, REPO_ROOT);
  assert.equal(res.fresh, false);
  assert.match(res.details.join('\n'), /sources/);
});

test('freshness resolves the repoRoot through symlinks (the documented personal install mode)', () => {
  const { dir, cleanup } = scratchRepo();
  const linkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'carto-link-'));
  const link = path.join(linkDir, 'repo');
  try {
    fs.symlinkSync(dir, link);
    const res = checkFreshness(load(), link);
    assert.equal(res.fresh, true, res.details?.join('\n'));
  } finally { fs.rmSync(linkDir, { recursive: true, force: true }); cleanup(); }
});
