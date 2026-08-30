import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync, symlinkSync, unlinkSync, realpathSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { materialize, verifyUnchanged, FIXTURE_ROOT } from './fixtures.mjs';

function srcTree() {
  const root = mkdtempSync(join(tmpdir(), 'fx-src-'));
  mkdirSync(join(root, 'sub'), { recursive: true });
  writeFileSync(join(root, 'sub', 'ledger.json'), '{"meta":{"title":"t"}}');
  return root;
}
const dest = () => mkdtempSync(join(tmpdir(), 'fx-dest-'));
const clean = (...ds) => ds.forEach((d) => rmSync(d, { recursive: true, force: true }));

test('materialize copies every declared file and records a sha256 for each', () => {
  const s = srcTree(); const d = dest();
  const r = materialize(['sub/ledger.json'], d, s);
  assert.strictEqual(r.entries.length, 1);
  assert.match(r.entries[0].sha256, /^[0-9a-f]{64}$/);
  assert.strictEqual(r.entries[0].kind, 'file', 'every entry records its type for verifyUnchanged');
  assert.strictEqual(r.entries[0].rel, 'sub/ledger.json');
  assert.strictEqual(readFileSync(join(r.workspace, 'sub', 'ledger.json'), 'utf8'), '{"meta":{"title":"t"}}');
  clean(s, d);
});

test('materialize throws when a declared file is missing rather than running fixture-less', () => {
  const s = srcTree(); const d = dest();
  assert.throws(() => materialize(['sub/nope.json'], d, s), /nope\.json/);
  clean(s, d);
});

test('materialize rejects empty, absolute and parent-traversing paths', () => {
  const s = srcTree(); const d = dest();
  for (const bad of ['', '   ', '/etc/passwd', '../outside.txt', 'sub/../../outside.txt']) {
    assert.throws(() => materialize([bad], d, s), /path/i, `must reject ${JSON.stringify(bad)}`);
  }
  clean(s, d);
});

test('materialize rejects an in-root symlink source, so verifyUnchanged cannot report false drift', () => {
  const s = srcTree(); const d = dest();
  symlinkSync(join(s, 'sub', 'ledger.json'), join(s, 'alias.json'));
  assert.throws(() => materialize(['alias.json'], d, s), /regular file|symlink/i,
    'an in-root symlink must be refused at materialization, not accepted then flagged as drift');
  clean(s, d);
});

test('materialize refuses a source symlink that escapes srcRoot', () => {
  const s = srcTree(); const d = dest();
  const outside = mkdtempSync(join(tmpdir(), 'fx-out-'));
  writeFileSync(join(outside, 'secret.txt'), 'nope');
  symlinkSync(join(outside, 'secret.txt'), join(s, 'escape.txt'));
  assert.throws(() => materialize(['escape.txt'], d, s), /escape|contain/i);
  clean(s, d, outside);
});

test('materialize refuses a destination whose parent directory is a symlink out of destDir', () => {
  const s = srcTree(); const d = dest();
  const outside = mkdtempSync(join(tmpdir(), 'fx-out-'));
  symlinkSync(outside, join(d, 'sub'));
  assert.throws(() => materialize(['sub/ledger.json'], d, s), /escape|contain|symlink/i,
    'a pre-existing symlinked parent must not become a write target outside destDir');
  clean(s, d, outside);
});

test('materialize refuses to overwrite through an existing destination symlink', () => {
  const s = srcTree(); const d = dest();
  const outside = mkdtempSync(join(tmpdir(), 'fx-out-'));
  writeFileSync(join(outside, 'target.txt'), 'original');
  mkdirSync(join(d, 'sub'), { recursive: true });
  symlinkSync(join(outside, 'target.txt'), join(d, 'sub', 'ledger.json'));
  assert.throws(() => materialize(['sub/ledger.json'], d, s), /symlink/i);
  assert.strictEqual(readFileSync(join(outside, 'target.txt'), 'utf8'), 'original',
    'the outside file must be untouched');
  clean(s, d, outside);
});

test('materialize rejects a duplicate declared path, naming it, rather than copying it twice', () => {
  const s = srcTree(); const d = dest();
  assert.throws(() => materialize(['sub/ledger.json', 'sub/ledger.json'], d, s), /sub\/ledger\.json/,
    'a duplicate is a catalog error, not a double copy');
  clean(s, d);
});

test('materialize returns the resolved root it used, for a caller to verify against later', () => {
  const s = srcTree(); const d = dest();
  const r = materialize(['sub/ledger.json'], d, s);
  assert.strictEqual(r.root, realpathSync(s),
    'the returned root must be the SAME resolved value materialize itself used, not left for a caller to recompute');
  clean(s, d);
});

test('verifyUnchanged reports drift when an original was modified during the run', () => {
  const s = srcTree(); const d = dest();
  const r = materialize(['sub/ledger.json'], d, s);
  assert.deepEqual(verifyUnchanged(r.entries, s), { ok: true, drifted: [] });
  writeFileSync(join(s, 'sub', 'ledger.json'), 'tampered');
  assert.deepEqual(verifyUnchanged(r.entries, s), { ok: false, drifted: ['sub/ledger.json'] });
  clean(s, d);
});

test('verifyUnchanged counts a deleted original as drift, not as unchanged', () => {
  const s = srcTree(); const d = dest();
  const r = materialize(['sub/ledger.json'], d, s);
  unlinkSync(join(s, 'sub', 'ledger.json'));
  assert.deepEqual(verifyUnchanged(r.entries, s), { ok: false, drifted: ['sub/ledger.json'] });
  clean(s, d);
});

test('verifyUnchanged treats a same-content symlink replacement as drift', () => {
  const s = srcTree(); const d = dest();
  const r = materialize(['sub/ledger.json'], d, s);
  const twin = join(s, 'twin.json');
  writeFileSync(twin, '{"meta":{"title":"t"}}');           // byte-identical content
  unlinkSync(join(s, 'sub', 'ledger.json'));
  symlinkSync(twin, join(s, 'sub', 'ledger.json'));
  assert.deepEqual(verifyUnchanged(r.entries, s), { ok: false, drifted: ['sub/ledger.json'] },
    'a type change is drift even when the bytes match');
  clean(s, d);
});

test('verifyUnchanged reports drift when the original\'s PARENT directory is swapped for a symlink into an outside directory holding byte-identical content', () => {
  const s = srcTree(); const d = dest();
  const r = materialize(['sub/ledger.json'], d, s);
  const outside = mkdtempSync(join(tmpdir(), 'fx-out-'));
  writeFileSync(join(outside, 'ledger.json'), '{"meta":{"title":"t"}}'); // byte-identical to the original
  rmSync(join(s, 'sub'), { recursive: true, force: true });
  symlinkSync(outside, join(s, 'sub'));
  assert.deepEqual(verifyUnchanged(r.entries, s), { ok: false, drifted: ['sub/ledger.json'] },
    'a symlinked parent directory must not silently redirect verification outside srcRoot, even when the leaf still lstats as a plain file with matching bytes');
  clean(s, d, outside);
});

test('verifyUnchanged still reports ok for the ordinary clean case after the containment check was added', () => {
  const s = srcTree(); const d = dest();
  const r = materialize(['sub/ledger.json'], d, s);
  assert.deepEqual(verifyUnchanged(r.entries, s), { ok: true, drifted: [] });
  clean(s, d);
});

test('verifyUnchanged reports every original as drift, without throwing, when the root itself is deleted', () => {
  const s = srcTree(); const d = dest();
  const r = materialize(['sub/ledger.json'], d, s);
  rmSync(s, { recursive: true, force: true });
  let result;
  assert.doesNotThrow(() => { result = verifyUnchanged(r.entries, s); },
    'a missing root must be reported as drift, not thrown');
  assert.deepEqual(result, { ok: false, drifted: ['sub/ledger.json'] });
  clean(d);
});

test('verifyUnchanged reports every original as drift, without throwing, when the root itself is deleted, even with a matching anchor', () => {
  const s = srcTree(); const d = dest();
  const r = materialize(['sub/ledger.json'], d, s);
  rmSync(s, { recursive: true, force: true });
  let result;
  assert.doesNotThrow(() => { result = verifyUnchanged(r.entries, s, r.root); },
    'a missing root must be reported as drift, not thrown, whether or not an anchor was supplied');
  assert.deepEqual(result, { ok: false, drifted: ['sub/ledger.json'] });
  clean(d);
});

test('verifyUnchanged, given the anchor materialize returned, catches the root itself being replaced by a symlink to an outside directory holding byte-identical files', () => {
  const s = srcTree(); const d = dest();
  const r = materialize(['sub/ledger.json'], d, s);
  const outside = mkdtempSync(join(tmpdir(), 'fx-out-'));
  mkdirSync(join(outside, 'sub'), { recursive: true });
  writeFileSync(join(outside, 'sub', 'ledger.json'), '{"meta":{"title":"t"}}'); // byte-identical
  rmSync(s, { recursive: true, force: true });
  symlinkSync(outside, s);
  let result;
  assert.doesNotThrow(() => { result = verifyUnchanged(r.entries, s, r.root); },
    'a swapped root must be reported as drift, not thrown');
  assert.deepEqual(result, { ok: false, drifted: ['sub/ledger.json'] },
    'the anchor must catch the root swap even though the leaf under the new root is byte-identical to the original, which is the exact escape the anchor closes');
  clean(d, outside);
});

test('verifyUnchanged, given the anchor materialize returned, also catches the root swapped for a symlink with DIFFERENT bytes (control)', () => {
  const s = srcTree(); const d = dest();
  const r = materialize(['sub/ledger.json'], d, s);
  const outside = mkdtempSync(join(tmpdir(), 'fx-out-'));
  mkdirSync(join(outside, 'sub'), { recursive: true });
  writeFileSync(join(outside, 'sub', 'ledger.json'), 'not the same bytes at all');
  rmSync(s, { recursive: true, force: true });
  symlinkSync(outside, s);
  let result;
  assert.doesNotThrow(() => { result = verifyUnchanged(r.entries, s, r.root); });
  assert.deepEqual(result, { ok: false, drifted: ['sub/ledger.json'] });
  clean(d, outside);
});

test('verifyUnchanged returns ok true when the supplied anchor matches the resolved root', () => {
  const s = srcTree(); const d = dest();
  const r = materialize(['sub/ledger.json'], d, s);
  assert.deepEqual(verifyUnchanged(r.entries, s, r.root), { ok: true, drifted: [] });
  clean(s, d);
});

test('verifyUnchanged returns ok false, every entry drifted, when the supplied anchor does not match the resolved root, even though nothing on disk changed', () => {
  const s = srcTree(); const d = dest();
  const r = materialize(['sub/ledger.json'], d, s);
  const somewhereElse = mkdtempSync(join(tmpdir(), 'fx-anchor-'));
  assert.deepEqual(verifyUnchanged(r.entries, s, somewhereElse), { ok: false, drifted: ['sub/ledger.json'] },
    'a mismatched anchor must fail closed even when srcRoot itself was never touched');
  clean(s, d, somewhereElse);
});

test('verifyUnchanged cannot see a modify-then-restore, which is a documented limit', () => {
  const s = srcTree(); const d = dest();
  const r = materialize(['sub/ledger.json'], d, s);
  const p = join(s, 'sub', 'ledger.json');
  const original = readFileSync(p);
  writeFileSync(p, 'tampered');
  writeFileSync(p, original);
  assert.deepEqual(verifyUnchanged(r.entries, s), { ok: true, drifted: [] },
    'this documents the limit rather than claiming a guarantee the check cannot make');
  clean(s, d);
});

test('the post fixture ledger is the pre ledger with only the refined fields changed', () => {
  const pre = JSON.parse(readFileSync(join(FIXTURE_ROOT, 'fixtures/refiner-seam-pre/ledger.json'), 'utf8'));
  const post = JSON.parse(readFileSync(join(FIXTURE_ROOT, 'fixtures/refiner-seam-post/ledger.json'), 'utf8'));
  assert.notStrictEqual(post.win.landed, pre.win.landed, 'win.landed must have been refined');
  assert.notStrictEqual(post.win.next, pre.win.next, 'win.next must have been refined');
  // Normalize ONLY the two fields allowed to differ, then deep-compare the whole remaining object.
  // Spot-checking win.evidence and slides would let a change to meta or win.verified slip through.
  const norm = (L) => {
    const c = structuredClone(L);
    delete c.win.landed;
    delete c.win.next;
    return c;
  };
  assert.deepStrictEqual(norm(post), norm(pre),
    'no field outside win.landed and win.next may differ between the two fixture ledgers');
});

test('the post fixture twin is exactly what the renderer produces from the post ledger', () => {
  // Re-render the post ledger to a temp path and byte-compare the twin.
  // This is the same check twin-matches-ledger performs, so a stale fixture fails here first.
  const out = mkdtempSync(join(tmpdir(), 'twin-'));
  execFileSync(process.execPath, [
    fileURLToPath(new URL('../references/render.mjs', import.meta.url)),
    join(FIXTURE_ROOT, 'fixtures/refiner-seam-post/ledger.json'), 'brief', join(out, 'a.html'),
  ]);
  assert.strictEqual(
    readFileSync(join(out, 'a.md'), 'utf8'),
    readFileSync(join(FIXTURE_ROOT, 'fixtures/refiner-seam-post/artifact.md'), 'utf8'),
    'the committed twin must match a fresh render of the committed ledger');
  rmSync(out, { recursive: true, force: true });
});
