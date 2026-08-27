// Gate Board stylesheet contract (execution plan Task 8).
//
// The sheet is an EXTRACTION of the owner-approved gate-board-reference.html
// <style> content, plus the documented adaptations (embedded fonts, legacy-
// emitter skins, .t/.sr/.wells, the --user-ac accent consumer). These tests
// pin the visual system's laws: Blue Graphite dark in both carriers, the one
// rule (no visible borders, no second surface fills, engraved dividers only),
// self-containment (fonts embedded, no external requests), and a styled
// selector for every class family the blocks/scaffold emit.
//
// The one-rule scanner lives in test-helpers.mjs (parseRules + the two oracle
// helpers + MARKER_SELECTORS — ONE copy, so the mutation checks exercise the
// exact predicate the real assertions use).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseRules, oracleOffenders, oracleBadBorders } from './test-helpers.mjs';
const css = readFileSync(new URL('./style.css', import.meta.url), 'utf8');

// The seven-token Blue Graphite dark map, plus the status-token overrides the
// sheet legitimately carries in the same carriers. Each carrier must hold
// EXACTLY these declarations — literal counts anywhere in the file could be
// satisfied by strays outside the carriers (prepr round 1 replaced them).
const BLUE_GRAPHITE = {
  '--bg': '#282e39', '--tx': '#eef2f9', '--sb': '#9eabba',
  '--sd': '#171b24', '--sl': '#384250',
  '--ac': 'var(--user-ac, #6687ff)', '--acq': '#9cb2ff',
};
const STATUS_EXTRAS = { '--okq': '#7ccfa4', '--warnq': '#e0a45e', '--errq': '#e08a8a' };

test('BOTH dark carriers hold exactly the seven-token Blue Graphite map (+ the named status extras)', () => {
  const rules = parseRules(css);
  const carriers = [
    ['media-guarded', rules.filter((r) => r.selector === ':root:not([data-theme="light"])')],
    ['stamped', rules.filter((r) => r.selector === ':root[data-theme="dark"]')],
  ];
  assert.match(css, /prefers-color-scheme: dark/); // the media carrier is inside the dark media query
  for (const [name, found] of carriers) {
    assert.equal(found.length, 1, `exactly one ${name} dark carrier rule`);
    const map = Object.fromEntries(found[0].declarations.map((d) => [d.prop, d.value]));
    for (const [prop, value] of Object.entries(BLUE_GRAPHITE)) {
      assert.equal(map[prop], value, `${name} carrier: ${prop}`);
    }
    for (const [prop, value] of Object.entries(STATUS_EXTRAS)) {
      assert.equal(map[prop], value, `${name} carrier extra: ${prop}`);
    }
    assert.deepEqual(Object.keys(map).sort(),
      [...Object.keys(BLUE_GRAPHITE), ...Object.keys(STATUS_EXTRAS)].sort(),
      `${name} carrier: the seven tokens + the documented extras, nothing else`);
  }
  assert.ok(!/009ACC|2d323b|23272e|3a414d|8ea6ff/i.test(css)); // no old brand / retired darks
});

test('the accent chain: all three --ac declarations consume var(--user-ac', () => {
  // CSS side of the --user-ac pair (Task 10 adds the render.mjs producer):
  // with no producer the fallbacks apply — light #5b7cfa, dark #6687ff.
  assert.match(css, /--ac: var\(--user-ac, #5b7cfa\)/);
  assert.equal((css.match(/--ac: var\(--user-ac, #6687ff\)/g) || []).length, 2);
  assert.equal((css.match(/--ac:(?!\s*var\(--user-ac)/g) || []).length, 0); // no bare --ac declaration anywhere
});

test('the one rule: no visible borders, no second surface fills, engraved dividers only', () => {
  // borders: only complete 0/none resets pass — '0.5px solid x' must fail
  assert.deepEqual(oracleBadBorders(css), []);
  // backgrounds: anchored surface values, or allowlisted marker dots/ticks/thumbs
  assert.deepEqual(oracleOffenders(css), []);
  // gradients exist ONLY as the two engraved token DEFINITIONS
  const grads = parseRules(css).flatMap((r) => r.declarations.filter((d) => d.value.includes('linear-gradient')).map((d) => d.prop));
  assert.deepEqual(grads.sort(), ['--lineH', '--lineV']);
  assert.ok(!/url\(\s*['"]?https?:/.test(css));                  // no external requests (ADR-003)
  assert.match(css, /data:font\/woff2;base64,/);                 // fonts embedded
  assert.match(css, /SIL OPEN FONT LICENSE|OFL/);                // license notice rides in the stylesheet
});

test('one-rule oracle mutation checks: forbidden fills and borders are caught', () => {
  // the oracle itself is tested: each mutation of the real sheet must produce offenders
  assert.ok(oracleOffenders(css + '\n.evil{background:#ff0000;}').length > 0);
  assert.ok(oracleOffenders(css + '\n@media (min-width:600px){.evil{background:var(--sd);}}').length > 0);
  assert.ok(oracleBadBorders(css + '\n.evil{border:0.5px solid var(--sd);}').length > 0);
  assert.ok(oracleBadBorders(css + '\n.evil{border-block-start:1px solid red;}').length > 0);
  assert.ok(oracleBadBorders(css + '\n.evil{border-image-source:radial-gradient(red,red);}').length > 0);
  assert.ok(oracleOffenders(css + '\n.ring__t.on{background:#ff0000;}').length > 0);
  assert.ok(oracleOffenders(css + '\n.evil{background:radial-gradient(var(--bg),#ff0000);}').length > 0);
  assert.ok(oracleOffenders(css + '\n.evil{BACKGROUND: #ff0000;}').length > 0); // case-smuggled property
});

// ---- prepr round 1: the font payloads live in references/fonts/, not here ----
// The sheet carries PLACEHOLDERS in the @font-face src; render.mjs base64-embeds
// references/fonts/*.woff2 into them at assembly (fail-loud on a missing
// placeholder or unreadable font file). The stylesheet itself stays reviewable.
test('style.css holds font placeholders + the OFL notice, and NO base64 payload', () => {
  assert.match(css, /url\(data:font\/woff2;base64,__FONT_SORA_B64__\) format\('woff2'\)/);
  assert.match(css, /url\(data:font\/woff2;base64,__FONT_NUNITO_B64__\) format\('woff2'\)/);
  assert.match(css, /SIL Open Font License/i);     // the license notice still rides in the sheet
  assert.doesNotMatch(css, /[A-Za-z0-9+/]{200,}/); // no base64 payload anywhere in the sheet
  assert.ok(css.length < 60000, `style.css stays reviewable (${css.length} bytes)`);
});

test('embedded fonts: both faces declared with the portfolio weight ranges', () => {
  assert.match(css, /font-family: 'Sora';\s*\n\s*src: url\(data:font\/woff2;base64,/);
  assert.match(css, /font-family: 'Nunito Sans';\s*\n\s*src: url\(data:font\/woff2;base64,/);
  assert.match(css, /font-weight: 700 800/);                     // Sora display range
  assert.match(css, /font-weight: 400 800/);                     // Nunito Sans body range
  assert.equal((css.match(/font-display: swap/g) || []).length, 2);
});

test('rail, unit, drawer, and every figure family have styles', () => {
  const selectors = parseRules(css).map((r) => r.selector.trim());
  for (const cls of ['.nav__track', '.nav__chip', '.tiles', '.ask', '.unit', '.drawer',
    '.deltas', '.topo', '.duel', '.verdict', '.matrix', '.ladder', '.stops', '.bars', '.ring',
    '.t', '.sr', '.wells', '.optpc']) {
    // selector-parsed, not substring: '.t' must exist as its own rule head — '.topo' does not satisfy it
    assert.ok(selectors.some((s) => s === cls || s.startsWith(cls + ' ') || s.startsWith(cls + '{') || s.startsWith(cls + ',') || s.startsWith(cls + ':') || s.startsWith(cls + '.')), cls);
  }
});

test('legacy emitters keep styled selectors in the neumorphic sheet', () => {
  const selectors = parseRules(css).map((r) => r.selector.trim());
  for (const cls of ['.flow', '.step', '.arw', '.relrow', '.sparkwrap', 'pre']) {
    assert.ok(selectors.some((s) => s === cls || s.startsWith(cls + ' ') || s.startsWith(cls + ':') || s.startsWith(cls + '.') || s.startsWith(cls + ',')), cls);
  }
  // lineSpark's SVG strokes are the ONE remaining consumer of the alias tokens
  assert.match(css, /--accent: var\(--ac\)/);
  assert.match(css, /--line: var\(--sd\)/);
  // diff ops color by TEXT tokens, never by fills (the one rule holds in code blocks)
  assert.match(css, /\.diff-add\{[^}]*color: var\(--okq\)/);
  assert.match(css, /\.diff-del\{[^}]*color: var\(--errq\)/);
});
