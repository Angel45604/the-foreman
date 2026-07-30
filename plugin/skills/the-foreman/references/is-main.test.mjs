import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, cpSync, symlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { isMain } from './is-main.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const runPreflight = (path) => execFileSync(process.execPath, [path], { encoding: 'utf8' }).toString();

test('isMain: true for this module when argv1 is its own literal path', () => {
  assert.equal(isMain(import.meta.url, join(HERE, 'is-main.test.mjs')), true);
});
test('isMain: false for a different script path, missing path, or absent argv1', () => {
  assert.equal(isMain(import.meta.url, join(HERE, 'preflight.mjs')), false);
  assert.equal(isMain(import.meta.url, join(HERE, 'nope-does-not-exist.mjs')), false);
  // NOTE: an explicit `undefined` would trigger the DEFAULT param (process.argv[1]) — JS semantics —
  // so probe the two real cases separately: an explicit no-path, and the default against a foreign module.
  assert.equal(isMain(import.meta.url, null), false);
  assert.equal(isMain('file:///not/this/file.mjs'), false);
});

// The two failure modes the helper exists for, proven by EXECUTION (not unit equality alone):
// a CLI must produce output when invoked (a) from a dir with spaces, (b) THROUGH a symlinked dir —
// the naive guard silently no-ops in both (macOS /tmp is itself a symlink; the-foreman's project
// deployment is a .claude/skills symlink).
test('preflight CLI fires from a space-containing path AND through a symlinked dir', () => {
  const base = mkdtempSync(join(tmpdir(), 'ismain-'));
  const spaced = join(base, 'sp ace');
  mkdirSync(spaced, { recursive: true });
  cpSync(HERE, join(spaced, 'references'), { recursive: true });

  const viaSpaces = runPreflight(join(spaced, 'references', 'preflight.mjs'));
  assert.match(viaSpaces, /"ok":/, 'preflight must PRINT from a spaced path');

  symlinkSync(join(spaced, 'references'), join(base, 'refs-link'));
  const viaSymlink = runPreflight(join(base, 'refs-link', 'preflight.mjs'));
  assert.match(viaSymlink, /"ok":/, 'preflight must PRINT when invoked through a symlink');
});
