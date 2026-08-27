// String-contract coverage for gate-board.js — the browser IIFE that drives the
// Gate Board page (rail scrollspy + jumps + keyboard, measured anchor offsets,
// expand/collapse-all). The script is extracted from the reference mockup with
// three generalizations pinned here: chapter ids DERIVE from the rail chips at
// runtime (never a hardcoded list), number keys cover 1..9 bounded by the
// derived chapter count, and Home/End jump to the first/last derived chapter.
// No DOM harness: these tests pin the source contract the way the plan
// specifies, so any hardcoded-id or hardcoded-bound regression fails loudly.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const js = readFileSync(new URL('./gate-board.js', import.meta.url), 'utf8');

test('page script parses as valid JavaScript', () => {
  assert.doesNotThrow(() => new Function(js));   // a syntax error can no longer ship
});

test('page script derives chapters from the rail, no hardcoded ids anywhere', () => {
  assert.match(js, /querySelectorAll\('\.nav__chip'\)/);
  assert.ok(!js.includes("['top', 'diagnosis'"));
  assert.ok(!/['"]yourcall['"]|['"]your-call['"]|['"]diagnosis['"]/.test(js)); // End/Home derived, never literal
  assert.match(js, /ids\[ids\.length - 1\]/);   // End = last chapter
  assert.match(js, /ids\[0\]/);                  // Home = first chapter
});

test('keyboard, scrollspy, offsets, expand-all are wired', () => {
  for (const needle of ['IntersectionObserver', "e.key === 'Home'", "e.key === 'End'",
    'scrollMarginTop', 'exp-all', 'col-all', 'prefers-reduced-motion']) assert.ok(js.includes(needle), needle);
});

test('number keys cover 1..9 bounded by the derived chapter count', () => {
  assert.ok(js.includes("e.key >= '1' && e.key <= '9'"));       // not the reference's 1..6
  assert.ok(!js.includes("e.key <= '6'"));                       // hardcoded bound must not survive
  assert.match(js, /parseInt\(e\.key, 10\) - 1/);
  assert.match(js, /< ids\.length|ids\.length >/);               // index bounded by the derived array
});

test('script never references deck-era elements', () => {
  assert.ok(!/#dots|#prev|#next|#crumb|\.slide\b/.test(js));
});
