import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { openCandidates, openInBrowser, resolveLocalPath } from './open-artifact.mjs';

// A fake `spawn`: returns an EventEmitter per call and, on the next microtask, emits the planned
// outcome for that call — 'error' (ENOENT), 'exit0', 'exit1', or 'none' (emit nothing → the survival
// window must resolve it). It never emits 'exit' for 'none', so a wait-for-close impl would hang.
function fakeSpawn(plan) {
  const calls = [];
  const fn = (cmd, args, opts) => {
    const ee = new EventEmitter();
    ee.unrefCount = 0;
    ee.unref = () => { ee.unrefCount += 1; };
    calls.push({ cmd, args, opts, ee });
    const outcome = plan[calls.length - 1] ?? 'none';
    queueMicrotask(() => {
      if (outcome === 'error') ee.emit('error', new Error('ENOENT'));
      else if (outcome === 'exit0') ee.emit('exit', 0);
      else if (outcome === 'exit1') ee.emit('exit', 1);
      // 'none' → emit nothing; the windowMs timer resolves it
    });
    return ee;
  };
  fn.calls = calls;
  return fn;
}

// ---- prepr round 1: prefer the .local.html sibling (the full standards-mode document) ----
test('resolveLocalPath prefers the .local.html sibling when it exists', () => {
  const exists = (p) => p === '/tmp/deck.local.html';
  assert.equal(resolveLocalPath('/tmp/deck.html', exists), '/tmp/deck.local.html');
});
test('resolveLocalPath keeps the given path when no sibling exists', () => {
  assert.equal(resolveLocalPath('/tmp/deck.html', () => false), '/tmp/deck.html');
});
// ---- prepr round 2: an outPath itself ending in .local.html is LEGAL — the
// renderer still writes its sibling (<outPath minus .html>.local.html, i.e.
// deck.local.local.html). The resolver must ALWAYS probe for the renderer-
// derived sibling first: bypassing the probe for .local.html inputs opened
// the shell-less hosted file instead of the standards-mode document. ----
test('resolveLocalPath on a .local.html input opens the generated .local.local.html sibling when present', () => {
  const exists = (p) => p === '/tmp/deck.local.local.html';
  assert.equal(resolveLocalPath('/tmp/deck.local.html', exists), '/tmp/deck.local.local.html');
});
test('resolveLocalPath on a .local.html input with no sibling opens the input itself', () => {
  assert.equal(resolveLocalPath('/tmp/deck.local.html', () => false), '/tmp/deck.local.html');
});
test('resolveLocalPath handles a non-.html path by appending the sibling suffix', () => {
  const exists = (p) => p === '/tmp/artifact.local.html';
  assert.equal(resolveLocalPath('/tmp/artifact', exists), '/tmp/artifact.local.html');
  assert.equal(resolveLocalPath('/tmp/artifact', () => false), '/tmp/artifact');
});

test('darwin: Chrome first, then the OS default browser', () => {
  const c = openCandidates('/tmp/a.html', 'darwin');
  assert.deepEqual(c[0], ['open', ['-a', 'Google Chrome', '/tmp/a.html']]); // Chrome first (owner's ask)
  assert.deepEqual(c[1], ['open', ['/tmp/a.html']]);                        // fallback: default browser
});

test('win32 and linux lead with a Chrome candidate', () => {
  assert.match(openCandidates('x', 'win32')[0].join(' '), /chrome/i);
  assert.match(openCandidates('x', 'linux')[0][0], /chrome/);
});

test('win32 is SHELL-FREE: a path with cmd metacharacters is passed as DATA, never via cmd.exe', () => {
  const evil = 'C:\\tmp\\deck&calc^x.html';
  const c = openCandidates(evil, 'win32');
  assert.equal(c[0][0], 'chrome');                                  // direct spawn, not `cmd /c start`
  assert.deepEqual(c[0][1], [evil]);                                // the path is ONE argv element, intact
  assert.equal(c[1][0], 'rundll32.exe');
  assert.deepEqual(c[1][1], ['url.dll,FileProtocolHandler', evil]); // intact as data on the fallback too
  assert.ok(!c.some(([cmd]) => /^cmd(\.exe)?$/i.test(cmd)), 'must never route through cmd.exe');
});

test('every candidate carries the path through unchanged', () => {
  for (const plat of ['darwin', 'win32', 'linux']) {
    for (const [, args] of openCandidates('/tmp/deck.html', plat)) {
      assert.ok(args.includes('/tmp/deck.html'), `${plat} arg list must include the path`);
    }
  }
});

test('Chrome launches (exit 0) → resolves with Chrome, default browser never tried', async () => {
  const spawnFn = fakeSpawn(['exit0']);
  const r = await openInBrowser('/tmp/a.html', 'darwin', spawnFn, 50);
  assert.deepEqual(r, { cmd: 'open', args: ['-a', 'Google Chrome', '/tmp/a.html'] });
  assert.equal(spawnFn.calls.length, 1);
});

test('Chrome dispatcher FAILS (exit 1) → falls through to the default browser', async () => {
  const spawnFn = fakeSpawn(['exit1', 'exit0']); // macOS `open -a "Google Chrome"` when Chrome is absent
  const r = await openInBrowser('/tmp/a.html', 'darwin', spawnFn, 50);
  assert.deepEqual(r, { cmd: 'open', args: ['/tmp/a.html'] }); // fell back to default
  assert.equal(spawnFn.calls.length, 2);
});

test('launcher binary cannot spawn (error/ENOENT) → falls through to the next candidate', async () => {
  const spawnFn = fakeSpawn(['error', 'exit0']);
  const r = await openInBrowser('/tmp/a.html', 'linux', spawnFn, 50);
  assert.deepEqual(r, { cmd: 'xdg-open', args: ['/tmp/a.html'] });
  assert.equal(spawnFn.calls.length, 2);
});

test('a long-lived browser that never exits resolves via the window — NEVER waits for it to close', async () => {
  const spawnFn = fakeSpawn(['none']); // foreground Chrome on Linux: emits no exit
  const r = await openInBrowser('/tmp/a.html', 'linux', spawnFn, 10); // resolves after the 10ms window
  assert.deepEqual(r, { cmd: 'google-chrome', args: ['/tmp/a.html'] });
  assert.equal(spawnFn.calls.length, 1);
});

test('on success the child is unref()ed and spawned detached with stdio ignored', async () => {
  const spawnFn = fakeSpawn(['exit0']);
  await openInBrowser('/tmp/a.html', 'darwin', spawnFn, 50);
  const first = spawnFn.calls[0];
  assert.equal(first.opts.detached, true);
  assert.equal(first.opts.stdio, 'ignore');
  assert.equal(first.ee.unrefCount, 1); // unref'd → this process can exit while the browser stays open
});

test('rejects when EVERY candidate fails (caller then just surfaces the path)', async () => {
  const spawnFn = fakeSpawn(['exit1', 'error']); // both darwin candidates fail
  await assert.rejects(() => openInBrowser('/tmp/a.html', 'darwin', spawnFn, 50), /could not open/i);
  assert.equal(spawnFn.calls.length, 2);
});
