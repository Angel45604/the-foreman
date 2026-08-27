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

test('end-of-document handler: a passive rAF-throttled scroll listener lights the LAST derived chapter', () => {
  // the observer's mid-viewport band (-40%/-55%) never fires for a final
  // section shorter than ~55vh, so document-end must set the last chip live
  assert.match(js, /addEventListener\('scroll', [A-Za-z_$][\w$]*, \{ passive: true \}\)/);
  assert.match(js, /requestAnimationFrame/);
  assert.match(js, /window\.innerHeight \+ window\.scrollY >= document\.documentElement\.scrollHeight - 2/);
  // last-id selection stays DERIVED, never literal (via the atEnd selection rule below)
  assert.match(js, /atEnd \? ids\[ids\.length - 1\]/);
});

test('end-override RELEASES on scroll-up: observerId + atEnd drive one selection rule, no fresh observer event needed', () => {
  // Scrolling back up from the forced document-end chip may produce NO new
  // IntersectionObserver callback (the section above is ALREADY intersecting
  // the band), so the selection must recompute from tracked state instead:
  // setLive(navId || (atEnd ? last : observerId)) on EVERY signal path.
  assert.match(js, /var id = navId !== null \? navId : atEnd \? ids\[ids\.length - 1\] : observerId;/);
  assert.match(js, /if \(id\) setLive\(id\);/);   // null-guarded: no signal yet keeps the markup's Top state
  // observerId is written ONLY by the observer callback (one declaration + one write)
  assert.equal((js.match(/observerId =/g) || []).length, 2);
  assert.match(js, /if \(e\.isIntersecting\)\{ observerId = e\.target\.id; landed = true; \}/);
  // atEnd is owned by the rAF-throttled scroll tick, and ALL paths re-apply the rule
  assert.match(js, /var atEnd = false;/);
  assert.equal((js.match(/applyLive\(\);/g) || []).length, 3, 'observer callback + scroll tick + jump each apply');
});

test('nav jumps route through ONE helper; navId gates the scroll-tick reapplication of a stale observerId', () => {
  // Leaving document-end, the tick's atEnd EDGE reapplies the selection rule —
  // without a navigation override the requested chip flips back to the
  // previously-observed chapter, and a short destination section may never
  // fire an observer callback to correct it. Every navigation path must
  // therefore route through one jump helper that clears atEnd and arms navId.
  assert.match(js, /function jump\(id, scroll\)\{/);
  assert.match(js, /atEnd = false;\s*\n\s*navId = id;/, 'the helper clears atEnd and arms the override');
  // rail chips AND the ask-strip anchor: every in-page anchor to a derived
  // chapter routes through the helper (scroll:false keeps native hash nav)
  assert.match(js, /querySelectorAll\('a\[href\^="#"\]'\)/);
  assert.match(js, /addEventListener\('click', function\(\)\{ jump\(k, false\); \}\)/);
  // the keyboard path (1..9, Home/End) routes through the same helper
  assert.match(js, /e\.preventDefault\(\);\s*\n\s*jump\(id\);/);
  // navId OVERRIDES the observer/atEnd selection…
  assert.match(js, /var id = navId !== null \? navId : atEnd \? ids\[ids\.length - 1\] : observerId;/);
  // …and ONLY an observer callback carrying an INTERSECTING entry releases it —
  // a leave-only callback must not (that is the stale flip-back in observer form)
  assert.match(js, /if \(landed\) navId = null;/);
  assert.equal((js.match(/navId =/g) || []).length, 3, 'declaration + jump arms + observer releases: no other writer');
});

test('script never references deck-era elements', () => {
  assert.ok(!/#dots|#prev|#next|#crumb|\.slide\b/.test(js));
});
