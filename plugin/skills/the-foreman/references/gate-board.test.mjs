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
  assert.match(js, /if \(e\.isIntersecting\)\{\s*\n\s*observerId = e\.target\.id;\s*\n\s*if \(e\.target\.id === navId\) arrived = true;\s*\n\s*\}/);
  // atEnd is computed by endState() (startup sample + the rAF-throttled scroll
  // tick), and ALL signal paths re-apply the rule
  assert.match(js, /var atEnd = false;/);
  assert.equal((js.match(/applyLive\(\);/g) || []).length, 5,
    'observer callback + scroll tick + jump + navId release + startup end sample each apply');
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
  // …and the observer releases it ONLY when the DESTINATION itself intersects
  // (the full release rule is pinned in its own test below)
  assert.match(js, /if \(arrived\) navId = null;/);
  assert.equal((js.match(/navId = /g) || []).length, 4,
    'declaration + jump arms + destination release + user-input release: no other writer');
});

// ---- prepr blocker: navId releases ONLY at the destination or on user input ----
// The old release — ANY intersecting entry — let the intermediate chapters
// swept through the band during a smooth jump strip the override, so a short
// destination lost its highlight to whatever chapter the band last crossed.
// The pinned rule: (a) the observer reports the DESTINATION itself
// intersecting, (b) an explicit user input occurs (programmatic smooth scroll
// fires none, so the jump cannot self-release), or (c) a new jump replaces it.
test('navId release rule: destination arrival, explicit user input, or a new jump — never an intermediate sweep', () => {
  // (a) target-match release: the observer clears navId ONLY when the
  // intersecting entry IS the destination…
  assert.match(js, /if \(e\.target\.id === navId\) arrived = true;/);
  assert.match(js, /if \(arrived\) navId = null;/);
  // …never on just ANY intersecting entry (the retired release): the old
  // landed-guarded clear is gone, and no release write sits inside the entry loop
  assert.ok(!js.includes('if (landed) navId = null'), 'the any-entry release must not survive');
  assert.ok(!/isIntersecting[^}]*navId = null/.test(js), 'no release inside the entry loop');
  // (b) user input: passive wheel/touchstart/pointerdown + scroll-key keydown
  // listeners hand control back to the observer — a programmatic smooth scroll
  // fires none of these, so a jump can never release itself mid-flight
  assert.match(js, /\['wheel', 'touchstart', 'pointerdown'\]\.forEach\(function\(type\)\{\s*\n\s*window\.addEventListener\(type, releaseNav, \{ passive: true \}\);/);
  assert.match(js, /var scrollKeys = \['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', ' '\];/);
  assert.match(js, /if \(scrollKeys\.indexOf\(e\.key\) !== -1\) releaseNav\(\);/);
  assert.equal((js.match(/\{ passive: true \}/g) || []).length, 3, 'end-scroll tick + input-type loop + scroll-key keydown');
  // (c) is jump() itself (navId = id — census pinned in the jump-helper test).
  // releaseNav re-applies the selection rule IMMEDIATELY on held→released (the
  // release-path repaint test below pins why); a pointerdown that begins a NEW
  // chip click repaints again the moment jump() re-arms in the same gesture.
  assert.match(js, /function releaseNav\(\)\{\s*\n\s*if \(navId === null\) return;\s*\n\s*navId = null;\s*\n\s*applyLive\(\);\s*\n\s*\}/);
});

// ---- prepr blocker: releasing navId re-renders immediately ----
// After user input clears the override, a mid-document scroll may neither flip
// atEnd nor cross an observer threshold (the current section is ALREADY
// intersecting the band, so the observer fires nothing new) — no later signal
// would repaint, and the jump's stale chip stayed lit indefinitely. Every
// held→released transition must re-apply the selection rule itself, using the
// current observerId/atEnd, not wait for the next signal.
test('navId held→released re-applies the selection rule on the release path itself', () => {
  assert.match(js, /function releaseNav\(\)\{\s*\n\s*if \(navId === null\) return;\s*\n\s*navId = null;\s*\n\s*applyLive\(\);\s*\n\s*\}/);
  // the observer's destination-arrival release already re-applies in the same
  // callback: applyLive follows the arrived clear before the callback returns
  assert.match(js, /if \(arrived\) navId = null;[^]*?\n\s*applyLive\(\);/);
});

// ---- prepr blocker: the end state is sampled once at initialization ----
// atEnd was only ever computed inside the scroll tick, so a document that
// already fits the viewport (no scroll event ever fires) kept the markup's Top
// chip lit despite the ask sitting on-screen at the document end. ONE shared
// endState() computation drives the scroll tick AND a startup sample+apply —
// the two can never drift.
test('initial atEnd sample: one shared endState() drives the scroll tick and a startup apply', () => {
  assert.match(js, /function endState\(\)\{\s*\n\s*return ids\.length > 0\s*\n\s*&& window\.innerHeight \+ window\.scrollY >= document\.documentElement\.scrollHeight - 2;\s*\n\s*\}/);
  assert.equal((js.match(/endState\(\)/g) || []).length, 3,
    'declaration + scroll tick + startup sample — the same computation everywhere');
  assert.match(js, /var nowEnd = endState\(\);/);            // the tick reads the shared computation
  assert.match(js, /atEnd = endState\(\);\s*\n\s*applyLive\(\);/); // the startup sample applies immediately
});

// ---- prepr blocker: layout changes recompute the end state ----
// atEnd was sampled only at startup and inside the scroll tick, but toggling a
// <details> drawer, Expand/Collapse All, a window resize, and a late font load
// all change scrollHeight WITHOUT firing a scroll event — a short page kept a
// stale atEnd (and the wrong chip) until the next real scroll. The SAME
// rAF-throttled tick now also runs on: window resize, the document 'toggle'
// event (capture:true — toggle does not bubble in older engines), after the
// expand/collapse-all handler mutates every drawer, and on font-load reflow.
test('layout changes recompute atEnd: resize + capture-phase toggle + expand/collapse-all ride the rAF tick', () => {
  assert.match(js, /window\.addEventListener\('resize', onEndScroll\);/);
  assert.match(js, /document\.addEventListener\('toggle', onEndScroll, \{ capture: true \}\);/);
  // ONE wire-up covers both buttons: setAll recomputes AFTER mutating the drawers
  assert.match(js, /function setAll\(open\)\{\s*\n\s*document\.querySelectorAll\('details'\)\.forEach\(function\(d\)\{ d\.open = open; \}\);\s*\n\s*onEndScroll\(\);\s*\n\s*\}/);
  // the font-load reflow path recomputes beside the existing offset re-measure
  assert.match(js, /document\.fonts\.ready\.then\(function\(\)\{ syncOffset\(\); onEndScroll\(\); \}\);/);
});

test('script never references deck-era elements', () => {
  assert.ok(!/#dots|#prev|#next|#crumb|\.slide\b/.test(js));
});
