import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BLOCKS, BLOCK_TYPES, renderBlocks, blocksToMarkdown } from './blocks.mjs';

// ---- oracle: the CLOSED block set (gate-contract literal-oracle style) ----
// A literal expected list, independent of the module — a new block type added
// WITHOUT both an html + md renderer fails this, and a coordinated edit can't
// silently widen the set without updating the oracle here too.
const EXPECTED_BLOCK_TYPES = ['table', 'rankedRows', 'statRow', 'donut', 'bar', 'lineSpark', 'flow', 'phaseSteps', 'code', 'diff', 'pillRow', 'topo', 'deltaRow', 'duel', 'verdictFan'];

test('BLOCK_TYPES is exactly the closed expected set (literal oracle)', () => {
  assert.deepEqual([...BLOCK_TYPES].sort(), [...EXPECTED_BLOCK_TYPES].sort());
});

test('every block type co-locates an html AND an md renderer (both functions)', () => {
  for (const t of EXPECTED_BLOCK_TYPES) {
    assert.equal(typeof BLOCKS[t]?.html, 'function', `${t}.html`);
    assert.equal(typeof BLOCKS[t]?.md, 'function', `${t}.md`);
  }
});

// ---- table: HTML ----
test('table HTML wraps in .scroll and emits a table with thead/th + tbody/td', () => {
  const html = BLOCKS.table.html({ type: 'table', columns: ['Name', 'Spend'], rows: [['Tyler', '$10']] });
  assert.match(html, /<div class="scroll">/);
  assert.match(html, /<table>/);
  assert.match(html, /<thead>[\s\S]*<th>Name<\/th>[\s\S]*<th>Spend<\/th>[\s\S]*<\/thead>/);
  assert.match(html, /<tbody>[\s\S]*<td>Tyler<\/td>[\s\S]*<td>\$10<\/td>[\s\S]*<\/tbody>/);
});

test('table HTML emits an escaped optional caption', () => {
  const html = BLOCKS.table.html({ type: 'table', columns: ['A'], rows: [['x']], caption: 'Top spenders <2026>' });
  assert.match(html, /<caption>Top spenders &lt;2026&gt;<\/caption>/);
});

test('table HTML escapes a malicious cell (no raw tag survives)', () => {
  const html = BLOCKS.table.html({ type: 'table', columns: ['C'], rows: [['<img onerror=x>']] });
  assert.doesNotMatch(html, /<img onerror=x>/);
  assert.match(html, /&lt;img onerror=x&gt;/);
});

test('table HTML escapes a malicious column header', () => {
  const html = BLOCKS.table.html({ type: 'table', columns: ['<script>alert(1)</script>'], rows: [] });
  assert.doesNotMatch(html, /<script>alert\(1\)/);
  assert.match(html, /&lt;script&gt;/);
});

test('table HTML never throws on ragged / missing rows', () => {
  // a short row + a row longer than columns + non-array row must all render
  assert.doesNotThrow(() => BLOCKS.table.html({ type: 'table', columns: ['A', 'B'], rows: [['only-one'], ['x', 'y', 'extra'], null] }));
});

// ---- table: MD ----
test('table MD is a valid GitHub table with header + separator + body', () => {
  const md = BLOCKS.table.md({ type: 'table', columns: ['Name', 'Spend'], rows: [['Tyler', '$10']] });
  assert.match(md, /^\| Name \| Spend \|$/m);
  assert.match(md, /^\| --- \| --- \|$/m);
  assert.match(md, /^\| Tyler \| \$10 \|$/m);
});

test('table MD escapes a cell pipe so it cannot inject a column', () => {
  const md = BLOCKS.table.md({ type: 'table', columns: ['C'], rows: [['a|b']] });
  assert.doesNotMatch(md, /\| a\|b \|/); // a raw pipe would split into an extra column
  assert.match(md, /a\\\|b/);            // pipe is backslash-escaped (inert)
});

test('table MD emits no raw HTML tag for an injected cell', () => {
  const md = BLOCKS.table.md({ type: 'table', columns: ['C'], rows: [['<img onerror=x>']] });
  assert.doesNotMatch(md, /<img onerror=x>/);
  assert.match(md, /&lt;img/);
});

test('table MD keeps the caption (escaped) so the twin does not drop it', () => {
  const md = BLOCKS.table.md({ type: 'table', columns: ['A'], rows: [['x']], caption: 'Top spenders <2026>' });
  assert.match(md, /\*\*Top spenders &lt;2026&gt;\*\*/); // caption present + HTML-escaped
  assert.doesNotMatch(md, /<2026>/);                    // never the raw form
});

// ---- rankedRows: HTML + MD ----
test('rankedRows HTML reuses the .relrow grid with escaped label + value', () => {
  const html = BLOCKS.rankedRows.html({ type: 'rankedRows', rows: [{ label: 'Tyler', value: '$10' }] });
  assert.match(html, /class="relrow"/);
  assert.match(html, /class="k">Tyler</);
  assert.match(html, /class="v">\$10</);
});

test('rankedRows HTML escapes a malicious label and value', () => {
  const html = BLOCKS.rankedRows.html({ type: 'rankedRows', rows: [{ label: '<img onerror=l>', value: '<img onerror=v>' }] });
  assert.doesNotMatch(html, /<img onerror=[lv]>/);
  assert.match(html, /&lt;img onerror=l&gt;/);
  assert.match(html, /&lt;img onerror=v&gt;/);
});

test('rankedRows MD emits "- **label** — value" with both escaped', () => {
  const md = BLOCKS.rankedRows.md({ type: 'rankedRows', rows: [{ label: 'Tyler', value: '$10' }] });
  assert.match(md, /^- \*\*Tyler\*\* — \$10$/m);
});

test('rankedRows MD escapes a malicious label and value', () => {
  const md = BLOCKS.rankedRows.md({ type: 'rankedRows', rows: [{ label: '<img onerror=l>', value: '<img onerror=v>' }] });
  assert.doesNotMatch(md, /<img onerror=[lv]>/);
  assert.match(md, /&lt;img/);
});

// ---- registry dispatch: fail-closed on unknown type (THE point) ----
test('renderBlocks THROWS on an unknown block type (fail-closed, never silently skips)', () => {
  assert.throws(() => renderBlocks([{ type: 'bogus' }]), /unknown block type: bogus/);
});

test('blocksToMarkdown THROWS on an unknown block type (twin parity)', () => {
  assert.throws(() => blocksToMarkdown([{ type: 'bogus' }]), /unknown block type: bogus/);
});

test('renderBlocks joins multiple known blocks with a newline', () => {
  const out = renderBlocks([
    { type: 'rankedRows', rows: [{ label: 'A', value: '1' }] },
    { type: 'rankedRows', rows: [{ label: 'B', value: '2' }] },
  ]);
  assert.match(out, /class="k">A<[\s\S]*class="k">B</);
});

test('blocksToMarkdown separates adjacent tables with a blank line (no table merge)', () => {
  const md = blocksToMarkdown([
    { type: 'table', columns: ['A'], rows: [['1']] },
    { type: 'table', columns: ['B'], rows: [['2']] },
  ]);
  assert.match(md, /\| 1 \|\n\n\| B \|/);       // first body row, BLANK line, second header
  assert.doesNotMatch(md, /\| 1 \|\n\| B \|/);  // not glued (which would parse the 2nd header as a row of the 1st)
});

// ---- empty / non-array => '' (both directions) ----
test('renderBlocks returns "" for empty / non-array input', () => {
  assert.equal(renderBlocks([]), '');
  assert.equal(renderBlocks(undefined), '');
  assert.equal(renderBlocks(null), '');
  assert.equal(renderBlocks('nope'), '');
});

test('blocksToMarkdown returns "" for empty / non-array input', () => {
  assert.equal(blocksToMarkdown([]), '');
  assert.equal(blocksToMarkdown(undefined), '');
  assert.equal(blocksToMarkdown(null), '');
});

// ============================================================================
// Phase 2b — metrics / charts: statRow, donut, bar, lineSpark
// ============================================================================
//
// Shared safety vocabulary for the chart blocks:
//   * SVG_SINKS — the banned ambient-authority / external sinks. NONE may appear
//     in any SVG-emitting block's output. (Per-block isolation: there are no deck
//     <defs>/<use> symbols here, so the bare `href=` ban is correct in this file.)
//   * BAD_NUM — substrings that prove a raw non-finite number leaked into output.
const SVG_SINKS = /xlink:href|<image|<use|<foreignObject|url\(|href\s*=|https?:\/\//;
const BAD_NUM = /NaN|Infinity/;

// JSON.parse('1e999') === Infinity — the canonical ledger overflow vector.
const OVERFLOW = JSON.parse('1e999');

// ---- statRow (HTML row of big-number stats; NO SVG) ----
test('statRow HTML emits a big value in --accent and a muted label', () => {
  const html = BLOCKS.statRow.html({ type: 'statRow', stats: [{ value: '$0.12', label: 'Total spend' }] });
  assert.match(html, /class="statrow"/);
  assert.match(html, /class="stat-value"[^>]*>\$0\.12</);
  assert.match(html, /class="stat-label"[^>]*>Total spend</);
});

test('statRow HTML escapes a malicious value and label (no raw tag survives)', () => {
  const html = BLOCKS.statRow.html({ type: 'statRow', stats: [{ value: '<img onerror=v>', label: '<img onerror=l>' }] });
  assert.doesNotMatch(html, /<img onerror=[vl]>/);
  assert.match(html, /&lt;img onerror=v&gt;/);
  assert.match(html, /&lt;img onerror=l&gt;/);
});

test('statRow HTML applies an allowlisted variant class (ok/warn)', () => {
  const ok = BLOCKS.statRow.html({ type: 'statRow', stats: [{ value: '70/70', label: 'Pass', variant: 'ok' }] });
  assert.match(ok, /class="stat ok"/);
  const warn = BLOCKS.statRow.html({ type: 'statRow', stats: [{ value: '2', label: 'Fail', variant: 'warn' }] });
  assert.match(warn, /class="stat warn"/);
});

test('statRow HTML rejects an unexpected variant (no class/markup injection beyond allowlist)', () => {
  const html = BLOCKS.statRow.html({ type: 'statRow', stats: [{ value: '1', label: 'x', variant: 'err"><script>alert(1)</script>' }] });
  assert.doesNotMatch(html, /<script>alert\(1\)/);    // no markup smuggled via variant
  assert.doesNotMatch(html, /stat err/);              // not an allowlisted class
  assert.match(html, /class="stat"/);                 // falls back to the bare allowlisted class
});

test('statRow MD is an inert list of "- **value** — label" (escaped)', () => {
  const md = BLOCKS.statRow.md({ type: 'statRow', stats: [{ value: '$0.12', label: 'Total spend' }] });
  assert.match(md, /^- \*\*\$0\.12\*\* — Total spend$/m);
  assert.doesNotMatch(md, /<[a-zA-Z/]/);
});

test('statRow MD escapes a malicious value and label', () => {
  const md = BLOCKS.statRow.md({ type: 'statRow', stats: [{ value: '<img onerror=v>', label: '<img onerror=l>' }] });
  assert.doesNotMatch(md, /<img onerror=[vl]>/);
  assert.match(md, /&lt;img/);
});

// ---- donut (ring chart; SVG) ----
test('donut HTML emits an inline svg with role=img, a track + arc circle, computed %', () => {
  const html = BLOCKS.donut.html({ type: 'donut', value: 25, max: 100, label: 'Used' });
  assert.match(html, /<svg[^>]*role="img"/);
  assert.match(html, /<circle/);
  assert.match(html, /stroke-dasharray=/);
  assert.match(html, />25%</);          // percentage is COMPUTED, not ledger text
  assert.match(html, />Used</);         // optional label
});

test('donut HTML clamps value > max to 100%', () => {
  const html = BLOCKS.donut.html({ type: 'donut', value: 9999, max: 100 });
  assert.match(html, />100%</);
  assert.doesNotMatch(html, BAD_NUM);
});

test('donut HTML survives NaN / Infinity / overflow / negative / absurd value (no NaN/Infinity, arc <= circumference)', () => {
  for (const bad of [NaN, Infinity, -Infinity, OVERFLOW, -50, 1e308]) {
    const html = BLOCKS.donut.html({ type: 'donut', value: bad, max: 100 });
    assert.doesNotMatch(html, BAD_NUM, `value=${bad}`);
    // the emitted dash length must never exceed the full circumference
    const m = html.match(/stroke-dasharray="([\d.]+) ([\d.]+)"/);
    assert.ok(m, `dasharray present for value=${bad}`);
    assert.ok(Number(m[1]) <= Number(m[2]) + 1e-6, `arc<=circumference for value=${bad}`);
  }
});

test('donut HTML survives a NaN / Infinity / negative MAX without NaN/Infinity', () => {
  for (const badMax of [NaN, Infinity, OVERFLOW, 0, -10]) {
    const html = BLOCKS.donut.html({ type: 'donut', value: 50, max: badMax });
    assert.doesNotMatch(html, BAD_NUM, `max=${badMax}`);
  }
});

test('donut HTML emits NONE of the banned SVG sinks', () => {
  const html = BLOCKS.donut.html({ type: 'donut', value: 25, max: 100, label: 'x' });
  assert.doesNotMatch(html, SVG_SINKS);
});

test('donut HTML escapes a malicious label', () => {
  const html = BLOCKS.donut.html({ type: 'donut', value: 25, label: '<img onerror=x>' });
  assert.doesNotMatch(html, /<img onerror=x>/);
  assert.match(html, /&lt;img onerror=x&gt;/);
});

test('donut MD emits inert "**pct% — label**" with a computed pct', () => {
  const md = BLOCKS.donut.md({ type: 'donut', value: 25, max: 100, label: 'Used' });
  assert.match(md, /\*\*25%\*\* — Used/);
  assert.doesNotMatch(md, /<[a-zA-Z/]/);
});

test('donut MD computes pct from a bad value without NaN/Infinity', () => {
  // A NON-FINITE value (Infinity from 1e999) is not clampable — safeNum returns
  // the documented fallback (0), so pct is a safe 0%. (A FINITE value > max
  // clamps to 100%; that path is covered by the "clamps value > max" HTML test.)
  const md = BLOCKS.donut.md({ type: 'donut', value: OVERFLOW, max: 100 });
  assert.doesNotMatch(md, BAD_NUM);
  assert.match(md, /\*\*0%\*\*/);     // overflow => safeNum fallback 0 => 0%
});

test('donut MD clamps a FINITE value > max to 100%', () => {
  const md = BLOCKS.donut.md({ type: 'donut', value: 9999, max: 100 });
  assert.match(md, /\*\*100%\*\*/);   // finite over-max clamps via Math.min
});

// ---- bar (horizontal bars; SVG) ----
test('bar HTML emits an inline svg with role=img and a rect per bar', () => {
  const html = BLOCKS.bar.html({ type: 'bar', bars: [{ label: 'A', value: 10 }, { label: 'B', value: 5 }] });
  assert.match(html, /<svg[^>]*role="img"/);
  const rects = html.match(/<rect/g) || [];
  assert.ok(rects.length >= 2, 'a rect per bar');
  assert.match(html, />A</);
  assert.match(html, />10</);   // value shown as text
});

test('bar HTML survives NaN / Infinity / overflow / negative values (no NaN/Infinity, width <= track)', () => {
  const TRACK = 100; // the bar.html track width in user units; bars normalize into this
  const html = BLOCKS.bar.html({ type: 'bar', bars: [
    { label: 'nan', value: NaN },
    { label: 'inf', value: Infinity },
    { label: 'ovf', value: OVERFLOW },
    { label: 'neg', value: -10 },
    { label: 'ok', value: 5 },
  ] });
  assert.doesNotMatch(html, BAD_NUM);
  for (const m of html.matchAll(/<rect[^>]*\bwidth="([\d.]+)"/g)) {
    assert.ok(Number(m[1]) <= TRACK + 1e-6, `bar width ${m[1]} <= track ${TRACK}`);
  }
});

test('bar HTML with all-zero values does not divide by zero (no NaN/Infinity)', () => {
  const html = BLOCKS.bar.html({ type: 'bar', bars: [{ label: 'A', value: 0 }, { label: 'B', value: 0 }] });
  assert.doesNotMatch(html, BAD_NUM);
});

test('bar HTML emits NONE of the banned SVG sinks', () => {
  const html = BLOCKS.bar.html({ type: 'bar', bars: [{ label: 'A', value: 10 }] });
  assert.doesNotMatch(html, SVG_SINKS);
});

test('bar HTML escapes a malicious label', () => {
  const html = BLOCKS.bar.html({ type: 'bar', bars: [{ label: '<img onerror=x>', value: 1 }] });
  assert.doesNotMatch(html, /<img onerror=x>/);
  assert.match(html, /&lt;img onerror=x&gt;/);
});

test('bar MD emits inert "- label: value" per bar (escaped)', () => {
  const md = BLOCKS.bar.md({ type: 'bar', bars: [{ label: 'A', value: 10 }, { label: 'B', value: 5 }] });
  assert.match(md, /^- A: 10$/m);
  assert.match(md, /^- B: 5$/m);
  assert.doesNotMatch(md, /<[a-zA-Z/]/);
});

test('bar MD safeNums a bad value (no NaN/Infinity)', () => {
  const md = BLOCKS.bar.md({ type: 'bar', bars: [{ label: 'A', value: OVERFLOW }] });
  assert.doesNotMatch(md, BAD_NUM);
});

// ---- lineSpark (sparkline; SVG) ----
test('lineSpark HTML emits an inline svg with role=img and a polyline', () => {
  const html = BLOCKS.lineSpark.html({ type: 'lineSpark', points: [1, 3, 2, 5], label: 'Trend' });
  assert.match(html, /<svg[^>]*role="img"/);
  assert.match(html, /<polyline/);
});

test('lineSpark HTML survives NaN / Infinity / overflow / negative points (no NaN/Infinity, coords in viewBox)', () => {
  const html = BLOCKS.lineSpark.html({ type: 'lineSpark', points: [NaN, Infinity, OVERFLOW, -1e308, 3, 7] });
  assert.doesNotMatch(html, BAD_NUM);
  const m = html.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  assert.ok(m, 'viewBox present');
  const vbW = Number(m[1]); const vbH = Number(m[2]);
  const pts = html.match(/points="([^"]*)"/);
  assert.ok(pts, 'points present');
  for (const pair of pts[1].trim().split(/\s+/)) {
    const [x, y] = pair.split(',').map(Number);
    assert.ok(x >= -1e-6 && x <= vbW + 1e-6, `x ${x} within [0,${vbW}]`);
    assert.ok(y >= -1e-6 && y <= vbH + 1e-6, `y ${y} within [0,${vbH}]`);
  }
});

test('lineSpark HTML with 0 points does not throw', () => {
  assert.doesNotThrow(() => BLOCKS.lineSpark.html({ type: 'lineSpark', points: [] }));
  assert.doesNotThrow(() => BLOCKS.lineSpark.html({ type: 'lineSpark' }));
});

test('lineSpark HTML with 1 point does not throw or div-by-zero', () => {
  const html = BLOCKS.lineSpark.html({ type: 'lineSpark', points: [42] });
  assert.doesNotMatch(html, BAD_NUM);
});

test('lineSpark HTML with all-equal points does not div-by-zero (no NaN/Infinity)', () => {
  const html = BLOCKS.lineSpark.html({ type: 'lineSpark', points: [5, 5, 5, 5] });
  assert.doesNotMatch(html, BAD_NUM);
});

test('lineSpark HTML survives OPPOSITE finite extremes (span overflow → no NaN, coords in viewBox)', () => {
  // both points are FINITE (pass safeNum) but hi-lo overflows to Infinity, so an
  // unguarded (p-lo)/span yields NaN in the coords. The normalized t must be
  // finite-guarded + clamped so geometry stays bounded.
  const html = BLOCKS.lineSpark.html({ type: 'lineSpark', points: [-1e308, 1e308] });
  assert.doesNotMatch(html, BAD_NUM);
  const pts = html.match(/points="([^"]*)"/);
  assert.ok(pts, 'points present');
  for (const pair of pts[1].trim().split(/\s+/)) {
    const [x, y] = pair.split(',').map(Number);
    assert.ok(Number.isFinite(x) && x >= -1e-6 && x <= 240 + 1e-6, `x ${x} finite + in viewBox`);
    assert.ok(Number.isFinite(y) && y >= -1e-6 && y <= 48 + 1e-6, `y ${y} finite + in viewBox`);
  }
});

test('lineSpark HTML emits NONE of the banned SVG sinks', () => {
  const html = BLOCKS.lineSpark.html({ type: 'lineSpark', points: [1, 2, 3], label: 'x' });
  assert.doesNotMatch(html, SVG_SINKS);
});

test('lineSpark HTML escapes a malicious label', () => {
  const html = BLOCKS.lineSpark.html({ type: 'lineSpark', points: [1, 2], label: '<img onerror=x>' });
  assert.doesNotMatch(html, /<img onerror=x>/);
  assert.match(html, /&lt;img onerror=x&gt;/);
});

test('lineSpark MD emits inert "label: p1, p2, …" (safeNum\'d, escaped)', () => {
  const md = BLOCKS.lineSpark.md({ type: 'lineSpark', points: [1, 2, 3], label: 'Trend' });
  assert.match(md, /Trend: 1, 2, 3/);
  assert.doesNotMatch(md, /<[a-zA-Z/]/);
});

test('lineSpark MD safeNums bad points (no NaN/Infinity)', () => {
  const md = BLOCKS.lineSpark.md({ type: 'lineSpark', points: [NaN, Infinity, 3] });
  assert.doesNotMatch(md, BAD_NUM);
});

// ---- dispatch through the registry (the new types route + fail-closed holds) ----
test('renderBlocks dispatches all four new chart blocks without throwing', () => {
  assert.doesNotThrow(() => renderBlocks([
    { type: 'statRow', stats: [{ value: '$1', label: 'a' }] },
    { type: 'donut', value: 50 },
    { type: 'bar', bars: [{ label: 'a', value: 1 }] },
    { type: 'lineSpark', points: [1, 2, 3] },
  ]));
});

// ============================================================================
// Phase 2c — process / flow: flow, phaseSteps
// ============================================================================
//
// Reuses the Phase-2b vocabulary: SVG_SINKS (no external refs — these blocks are
// pure HTML, but the no-raw-tag / no-external-ref guarantee is asserted the same
// way) and the /<[a-zA-Z\/]/ "no raw HTML tag" check for the Markdown twin.

// ---- flow (horizontal step chips + arrows; HTML, no SVG) ----
test('flow HTML emits .flow with a .step chip per step and an .arw arrow BETWEEN (n steps -> n-1 arrows)', () => {
  const html = BLOCKS.flow.html({ type: 'flow', steps: [{ label: 'A' }, { label: 'B' }, { label: 'C' }] });
  assert.match(html, /class="flow"/);
  const steps = html.match(/class="step[^"]*"/g) || [];
  assert.equal(steps.length, 3, 'one .step chip per step');
  const arws = html.match(/class="arw"/g) || [];
  assert.equal(arws.length, 2, 'n-1 arrows between n steps');
  assert.match(html, />A</);
  assert.match(html, />B</);
  assert.match(html, />C</);
});

test('flow HTML applies the allowlisted gate/go kind classes', () => {
  const html = BLOCKS.flow.html({ type: 'flow', steps: [{ label: 'Check', kind: 'gate' }, { label: 'Run', kind: 'go' }] });
  assert.match(html, /class="step gate"/);
  assert.match(html, /class="step go"/);
});

test('flow HTML rejects an unexpected kind (no class/markup injection beyond allowlist)', () => {
  const html = BLOCKS.flow.html({ type: 'flow', steps: [
    { label: 'x', kind: 'evil" onmouseover="x' },
    { label: 'y', kind: 'foo' },
  ] });
  assert.doesNotMatch(html, /onmouseover/);   // no attribute smuggled via kind
  assert.doesNotMatch(html, /class="step foo"/); // not an allowlisted class
  assert.doesNotMatch(html, /class="step evil/); // not an allowlisted class
  assert.match(html, /class="step"/);          // falls back to the bare allowlisted class
});

test('flow HTML escapes a malicious label (no raw tag survives)', () => {
  const html = BLOCKS.flow.html({ type: 'flow', steps: [{ label: '<img onerror=x>' }] });
  assert.doesNotMatch(html, /<img onerror=x>/);
  assert.match(html, /&lt;img onerror=x&gt;/);
});

test('flow HTML emits NONE of the banned external sinks', () => {
  const html = BLOCKS.flow.html({ type: 'flow', steps: [{ label: 'A', kind: 'go' }, { label: 'B', kind: 'gate' }] });
  assert.doesNotMatch(html, SVG_SINKS);
});

test('flow MD joins labels with " -> " and annotates gate/go inertly (escaped, no raw HTML)', () => {
  const md = BLOCKS.flow.md({ type: 'flow', steps: [
    { label: 'A' },
    { label: 'B', kind: 'gate' },
    { label: 'C', kind: 'go' },
  ] });
  assert.match(md, /A → \[gate\] B → \[go\] C/);
  assert.doesNotMatch(md, /<[a-zA-Z/]/);
});

test('flow MD escapes a malicious label (inert, no raw tag)', () => {
  const md = BLOCKS.flow.md({ type: 'flow', steps: [{ label: '<img onerror=x>' }] });
  assert.doesNotMatch(md, /<img onerror=x>/);
  assert.match(md, /&lt;img/);
});

test('flow HTML/MD render an empty-but-valid container for empty / non-array steps (never throws)', () => {
  assert.doesNotThrow(() => BLOCKS.flow.html({ type: 'flow', steps: [] }));
  assert.doesNotThrow(() => BLOCKS.flow.html({ type: 'flow' }));
  assert.match(BLOCKS.flow.html({ type: 'flow', steps: [] }), /class="flow"/);
  assert.equal(BLOCKS.flow.md({ type: 'flow', steps: [] }), '');
  assert.equal(BLOCKS.flow.md({ type: 'flow' }), '');
});

// ---- phaseSteps (phase-progression chips; HTML, no SVG) ----
test('phaseSteps HTML emits a labeled chip per step with an allowlisted status class + marker', () => {
  const html = BLOCKS.phaseSteps.html({ type: 'phaseSteps', steps: [
    { label: 'Built', status: 'done' },
    { label: 'Testing', status: 'active' },
    { label: 'Ship', status: 'pending' },
  ] });
  assert.match(html, /class="phasestep done"/);
  assert.match(html, /class="phasestep active"/);
  assert.match(html, /class="phasestep pending"/);
  assert.match(html, />Built</);
  assert.match(html, />Testing</);
  assert.match(html, />Ship</);
  assert.match(html, /✓/); // done marker
  assert.match(html, /▸/); // active marker
  assert.match(html, /○/); // pending marker
});

test('phaseSteps HTML defaults an unknown / missing status to pending (no injection)', () => {
  const html = BLOCKS.phaseSteps.html({ type: 'phaseSteps', steps: [
    { label: 'a' },
    { label: 'b', status: 'evil" onmouseover="x' },
    { label: 'c', status: 'bogus' },
  ] });
  assert.doesNotMatch(html, /onmouseover/);              // no attribute smuggled via status
  assert.doesNotMatch(html, /class="phasestep evil/);    // not an allowlisted class
  assert.doesNotMatch(html, /class="phasestep bogus"/);  // not an allowlisted class
  const pendings = html.match(/class="phasestep pending"/g) || [];
  assert.equal(pendings.length, 3, 'missing + unknown statuses all fall back to pending');
});

test('phaseSteps HTML escapes a malicious label (no raw tag survives)', () => {
  const html = BLOCKS.phaseSteps.html({ type: 'phaseSteps', steps: [{ label: '<img onerror=x>', status: 'done' }] });
  assert.doesNotMatch(html, /<img onerror=x>/);
  assert.match(html, /&lt;img onerror=x&gt;/);
});

test('phaseSteps HTML emits NONE of the banned external sinks', () => {
  const html = BLOCKS.phaseSteps.html({ type: 'phaseSteps', steps: [{ label: 'a', status: 'done' }] });
  assert.doesNotMatch(html, SVG_SINKS);
});

test('phaseSteps MD emits a [x]/[~]/[ ] checklist (labels escaped, inert)', () => {
  const md = BLOCKS.phaseSteps.md({ type: 'phaseSteps', steps: [
    { label: 'Built', status: 'done' },
    { label: 'Testing', status: 'active' },
    { label: 'Ship', status: 'pending' },
    { label: 'Unknown' },
  ] });
  assert.match(md, /^- \[x\] Built$/m);
  assert.match(md, /^- \[~\] Testing$/m);
  assert.match(md, /^- \[ \] Ship$/m);
  assert.match(md, /^- \[ \] Unknown$/m); // missing status -> pending
  assert.doesNotMatch(md, /<[a-zA-Z/]/);
});

test('phaseSteps MD escapes a malicious label (inert, no raw tag)', () => {
  const md = BLOCKS.phaseSteps.md({ type: 'phaseSteps', steps: [{ label: '<img onerror=x>', status: 'done' }] });
  assert.doesNotMatch(md, /<img onerror=x>/);
  assert.match(md, /&lt;img/);
});

// ---- phaseSteps optional per-step `detail` (a muted sub-line under the label) ----
test('phaseSteps HTML renders an escaped .phase-detail sub-line when a step has detail', () => {
  const html = BLOCKS.phaseSteps.html({ type: 'phaseSteps', steps: [
    { label: 'Built', status: 'done', detail: '6 files touched' },
  ] });
  assert.match(html, /<span class="phase-detail">6 files touched<\/span>/);
  // the detail sits INSIDE the .phasestep chip, after the label
  assert.match(html, /Built<span class="phase-detail">6 files touched<\/span>/);
});

test('phaseSteps HTML omits the .phase-detail sub-line when a step has no detail (byte-identical chip)', () => {
  const html = BLOCKS.phaseSteps.html({ type: 'phaseSteps', steps: [{ label: 'Ship', status: 'pending' }] });
  assert.doesNotMatch(html, /phase-detail/);
  // unchanged chip shape
  assert.equal(html, '<div class="phaseflow"><span class="phasestep pending"><span class="phase-mark">○</span>Ship</span></div>');
});

test('phaseSteps HTML escapes a malicious detail (no raw tag survives)', () => {
  const html = BLOCKS.phaseSteps.html({ type: 'phaseSteps', steps: [{ label: 'a', status: 'done', detail: '<img onerror=x>' }] });
  assert.doesNotMatch(html, /<img onerror=x>/);
  assert.match(html, /&lt;img onerror=x&gt;/);
});

test('phaseSteps HTML detail emits NONE of the banned external sinks', () => {
  const html = BLOCKS.phaseSteps.html({ type: 'phaseSteps', steps: [{ label: 'a', status: 'done', detail: 'd' }] });
  assert.doesNotMatch(html, SVG_SINKS);
});

test('phaseSteps MD appends an escaped " — detail" after the label when present', () => {
  const md = BLOCKS.phaseSteps.md({ type: 'phaseSteps', steps: [
    { label: 'Built', status: 'done', detail: '6 files' },
    { label: 'Ship', status: 'pending' },
  ] });
  assert.match(md, /^- \[x\] Built — 6 files$/m);
  assert.match(md, /^- \[ \] Ship$/m); // no detail -> no trailing dash, byte-identical line
});

test('phaseSteps MD escapes a malicious detail (inert, no raw tag)', () => {
  const md = BLOCKS.phaseSteps.md({ type: 'phaseSteps', steps: [{ label: 'a', status: 'done', detail: '<img onerror=x>' }] });
  assert.doesNotMatch(md, /<img onerror=x>/);
  assert.match(md, /&lt;img/);
});

test('phaseSteps HTML/MD render an empty-but-valid container for empty / non-array steps (never throws)', () => {
  assert.doesNotThrow(() => BLOCKS.phaseSteps.html({ type: 'phaseSteps', steps: [] }));
  assert.doesNotThrow(() => BLOCKS.phaseSteps.html({ type: 'phaseSteps' }));
  assert.equal(BLOCKS.phaseSteps.md({ type: 'phaseSteps', steps: [] }), '');
  assert.equal(BLOCKS.phaseSteps.md({ type: 'phaseSteps' }), '');
});

// ---- dispatch through the registry (the new process blocks route + fail-closed holds) ----
test('renderBlocks dispatches the two new process blocks without throwing', () => {
  assert.doesNotThrow(() => renderBlocks([
    { type: 'flow', steps: [{ label: 'A', kind: 'gate' }, { label: 'B', kind: 'go' }] },
    { type: 'phaseSteps', steps: [{ label: 'p', status: 'done' }] },
  ]));
  assert.doesNotThrow(() => blocksToMarkdown([
    { type: 'flow', steps: [{ label: 'A' }] },
    { type: 'phaseSteps', steps: [{ label: 'p', status: 'active' }] },
  ]));
});

// ============================================================================
// Phase 2d — code / annotation: code, diff, pillRow
// ============================================================================
//
// The CRUX (ADR-004): code/diff bodies must preserve RAW multiline content while
// staying INERT and UNABLE to break out of their fence.
//   * HTML: <pre><code>${esc(body)}</code></pre> — newlines preserved, EVERY char
//     esc()'d (so a `<div>` in the body becomes &lt;div&gt; and is inert).
//   * Twin: a DYNAMIC fenced code block whose fence is strictly LONGER than the
//     longest backtick run inside the body, so the content can NEVER close it. The
//     body stays LITERAL inside the fence (NOT mdEsc'd) — fence containment is the
//     safety. So the blanket "/<[a-zA-Z\/]/ no-raw-HTML" assertion DOES NOT apply
//     to code/diff twins (a `<div>` legitimately appears verbatim inside the
//     fence); fence-aware assertions are used instead. pillRow IS single-line, so
//     the blanket no-HTML assertion applies there.

// Helper: extract the fenced block region (open fence line .. close fence line)
// from a code/diff twin, and return { openFence, closeFence, body, lines }.
// A fence line is a line that is ONLY backticks (>=3), optionally + an info word.
function parseFence(md) {
  const lines = md.split('\n');
  let openIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^`{3,}[a-zA-Z0-9]*$/.test(lines[i])) { openIdx = i; break; }
  }
  assert.ok(openIdx >= 0, 'an opening fence line is present');
  const openFence = lines[openIdx].match(/^(`{3,})/)[1];
  let closeIdx = -1;
  for (let i = lines.length - 1; i > openIdx; i--) {
    if (/^`{3,}$/.test(lines[i])) { closeIdx = i; break; }
  }
  assert.ok(closeIdx > openIdx, 'a closing fence line is present after the opening one');
  const closeFence = lines[closeIdx];
  const body = lines.slice(openIdx + 1, closeIdx).join('\n');
  return { openFence, closeFence, body, openIdx, closeIdx, lines };
}

// ---- code: HTML ----
test('code HTML wraps the body in <pre><code> with newlines preserved', () => {
  const html = BLOCKS.code.html({ type: 'code', code: 'const a = 1;\nconst b = 2;' });
  assert.match(html, /<pre><code/);
  assert.match(html, /<\/code><\/pre>/);
  assert.match(html, /const a = 1;\nconst b = 2;/); // raw newline preserved between lines
});

test('code HTML escapes a body containing markup (no raw tag survives)', () => {
  const html = BLOCKS.code.html({ type: 'code', code: 'function x(){ return "<div>"; }' });
  assert.doesNotMatch(html, /<div>/);          // no raw tag from the body
  assert.match(html, /&lt;div&gt;/);           // escaped, inert
});

test('code HTML sanitizes lang into the class (cannot inject an attribute)', () => {
  const html = BLOCKS.code.html({ type: 'code', code: 'x', lang: 'js" onload="alert(1)' });
  assert.doesNotMatch(html, /onload=/);                 // no attribute smuggled via lang
  assert.match(html, /class="language-jsonloadalert1"/); // alphanumeric-only class
});

// ---- code: twin (FENCE-AWARE) ----
test('code twin emits a dynamic fence STRICTLY LONGER than the longest inner backtick run (content cannot close it)', () => {
  // body contains a TRIPLE-backtick run; a static ``` fence would be closed by it.
  const body = 'before\n```\nnested code\n```\nafter';
  const md = BLOCKS.code.md({ type: 'code', code: body });
  const { openFence, closeFence, body: inner } = parseFence(md);
  // longest run of backticks inside the body
  const innerMaxRun = (body.match(/`+/g) || []).reduce((m, r) => Math.max(m, r.length), 0);
  assert.equal(innerMaxRun, 3, 'fixture body has a triple-backtick run');
  assert.ok(openFence.length > innerMaxRun, `open fence (${openFence.length}) strictly longer than inner run (${innerMaxRun})`);
  assert.ok(closeFence.length > innerMaxRun, `close fence (${closeFence.length}) strictly longer than inner run (${innerMaxRun})`);
  assert.equal(openFence.length, closeFence.length, 'open and close fences match length');
  assert.equal(inner, body, 'the body sits LITERALLY between the fences (uncloseable)');
});

test('code twin keeps a <div>/<script>/link/image inside the fence as LITERAL text (no real tag/link/image outside)', () => {
  const body = '<div>\n<script>alert(1)</script>\n[x](http://e)\n![y](http://e)';
  const md = BLOCKS.code.md({ type: 'code', code: body });
  const { body: inner, openIdx, closeIdx, lines } = parseFence(md);
  // the entire body is contained verbatim between the fences (literal, not transformed)
  assert.equal(inner, body, 'body preserved verbatim between the fences');
  // there is NO content line OUTSIDE the fenced region that begins a real tag /
  // contains a real link/image — everything dangerous is sandwiched inside.
  const outside = [...lines.slice(0, openIdx), ...lines.slice(closeIdx + 1)];
  for (const line of outside) {
    assert.doesNotMatch(line, /^<[a-zA-Z/]/, 'no real HTML tag at line-start outside the fence');
    assert.doesNotMatch(line, /\]\(http/, 'no real link outside the fence');
  }
});

test('code twin normalizes CR/CRLF so no carriage return survives', () => {
  const md = BLOCKS.code.md({ type: 'code', code: 'a\r\nb\rc' });
  assert.doesNotMatch(md, /\r/);
  const { body } = parseFence(md);
  assert.equal(body, 'a\nb\nc');
});

test('code twin sanitizes the info string to alphanumeric (no fence/structure injection via lang)', () => {
  const md = BLOCKS.code.md({ type: 'code', code: 'x', lang: 'js`\n```' });
  const { openFence } = parseFence(md);
  // the info string after the opening fence must be alphanumeric-only
  assert.match(md.split('\n')[md.split('\n').findIndex((l) => l.startsWith(openFence))], /^`{3,}[a-zA-Z0-9]*$/);
});

// ---- diff ----
test('diff HTML emits add/del/ctx span classes from the op allowlist', () => {
  const html = BLOCKS.diff.html({ type: 'diff', lines: [
    { op: '+', text: 'added' },
    { op: '-', text: 'removed' },
    { op: ' ', text: 'context' },
  ] });
  assert.match(html, /<pre><code/);
  assert.match(html, /class="diff-add"[^>]*>\+added</);
  assert.match(html, /class="diff-del"[^>]*>-removed</);
  assert.match(html, /class="diff-ctx"[^>]*> context</);
});

test('diff HTML coerces an unknown op to ctx (no injection via op)', () => {
  const html = BLOCKS.diff.html({ type: 'diff', lines: [
    { op: '"><script>alert(1)</script>', text: 'x' },
    { op: '@', text: 'y' },
  ] });
  assert.doesNotMatch(html, /<script>alert\(1\)/);  // no markup smuggled via op
  assert.doesNotMatch(html, /class="diff-add"/);    // unknown op is NOT add
  assert.doesNotMatch(html, /class="diff-del"/);    // unknown op is NOT del
  const ctx = html.match(/class="diff-ctx"/g) || [];
  assert.equal(ctx.length, 2, 'both unknown ops fall back to ctx');
});

test('diff HTML escapes line text (no raw tag survives)', () => {
  const html = BLOCKS.diff.html({ type: 'diff', lines: [{ op: '+', text: '<img onerror=x>' }] });
  assert.doesNotMatch(html, /<img onerror=x>/);
  assert.match(html, /&lt;img onerror=x&gt;/);
});

test('diff twin uses a diff-info fence over the JOINED body so no text line can close it', () => {
  const md = BLOCKS.diff.md({ type: 'diff', lines: [
    { op: ' ', text: 'kept' },
    { op: '+', text: '```' },      // a text line that is a triple-backtick run
    { op: '-', text: 'gone' },
  ] });
  const { openFence, closeFence, body } = parseFence(md);
  assert.match(openFence, /^`{4,}$/);                 // >=4 because the joined body has a ``` run
  assert.ok(openFence.length > 3, 'fence longer than the inner triple-backtick run');
  assert.equal(openFence.length, closeFence.length);
  // body is op+text per line, literal, joined by \n
  assert.equal(body, ' kept\n+```\n-gone');
  // info string is "diff"
  assert.match(md, new RegExp('^' + openFence + 'diff$', 'm'));
});

test('diff twin contains injected text as literal (no real tag/link outside the fence)', () => {
  const md = BLOCKS.diff.md({ type: 'diff', lines: [
    { op: '+', text: '<script>alert(1)</script>' },
    { op: '-', text: '[x](http://e)' },
  ] });
  const { body, openIdx, closeIdx, lines } = parseFence(md);
  assert.equal(body, '+<script>alert(1)</script>\n-[x](http://e)');
  const outside = [...lines.slice(0, openIdx), ...lines.slice(closeIdx + 1)];
  for (const line of outside) {
    assert.doesNotMatch(line, /^<[a-zA-Z/]/);
    assert.doesNotMatch(line, /\]\(http/);
  }
});

// ---- pillRow ----
test('pillRow HTML reuses .pill / .pill.ok / .pill.warn with an escaped label', () => {
  const html = BLOCKS.pillRow.html({ type: 'pillRow', pills: [
    { label: 'Plain' },
    { label: 'Good', variant: 'ok' },
    { label: 'Bad', variant: 'warn' },
  ] });
  assert.match(html, /class="pill">Plain</);
  assert.match(html, /class="pill ok">Good</);
  assert.match(html, /class="pill warn">Bad</);
});

test('pillRow HTML rejects an unexpected variant (no class/attr injection beyond the allowlist)', () => {
  const html = BLOCKS.pillRow.html({ type: 'pillRow', pills: [
    { label: 'x', variant: 'err"><script>alert(1)</script>' },
    { label: 'y', variant: 'foo' },
  ] });
  assert.doesNotMatch(html, /<script>alert\(1\)/);  // no markup smuggled via variant
  assert.doesNotMatch(html, /class="pill err/);     // not an allowlisted class
  assert.doesNotMatch(html, /class="pill foo"/);    // not an allowlisted class
  const bare = html.match(/class="pill">/g) || [];
  assert.equal(bare.length, 2, 'both unknown variants fall back to the bare pill class');
});

test('pillRow HTML escapes a malicious label (no raw tag survives)', () => {
  const html = BLOCKS.pillRow.html({ type: 'pillRow', pills: [{ label: '<img onerror=x>' }] });
  assert.doesNotMatch(html, /<img onerror=x>/);
  assert.match(html, /&lt;img onerror=x&gt;/);
});

test('pillRow MD is a single inert line of escaped labels (blanket no-raw-HTML applies)', () => {
  const md = BLOCKS.pillRow.md({ type: 'pillRow', pills: [
    { label: 'Alpha' },
    { label: 'Beta', variant: 'ok' },
  ] });
  assert.doesNotMatch(md, /\n/);                 // single line
  assert.match(md, /Alpha/);
  assert.match(md, /Beta/);
  assert.doesNotMatch(md, /<[a-zA-Z/]/);         // pillRow is single-line: blanket no-HTML DOES apply
});

test('pillRow MD escapes a malicious label (inert, no raw tag)', () => {
  const md = BLOCKS.pillRow.md({ type: 'pillRow', pills: [{ label: '<img onerror=x>' }] });
  assert.doesNotMatch(md, /<img onerror=x>/);
  assert.match(md, /&lt;img/);
});

// ---- empty / non-array => never throws (all three) ----
test('code/diff/pillRow render an empty-but-valid output for empty / missing input (never throws)', () => {
  assert.doesNotThrow(() => BLOCKS.code.html({ type: 'code' }));
  assert.doesNotThrow(() => BLOCKS.code.md({ type: 'code' }));
  assert.doesNotThrow(() => BLOCKS.diff.html({ type: 'diff' }));
  assert.doesNotThrow(() => BLOCKS.diff.html({ type: 'diff', lines: [] }));
  assert.doesNotThrow(() => BLOCKS.diff.md({ type: 'diff' }));
  assert.doesNotThrow(() => BLOCKS.pillRow.html({ type: 'pillRow' }));
  assert.doesNotThrow(() => BLOCKS.pillRow.html({ type: 'pillRow', pills: [] }));
  assert.doesNotThrow(() => BLOCKS.pillRow.md({ type: 'pillRow' }));
  assert.equal(BLOCKS.pillRow.md({ type: 'pillRow', pills: [] }), '');
});

// ---- dispatch through the registry (the new code blocks route + fail-closed holds) ----
test('renderBlocks dispatches the three new code/annotation blocks without throwing', () => {
  assert.doesNotThrow(() => renderBlocks([
    { type: 'code', code: 'const a = 1;', lang: 'js' },
    { type: 'diff', lines: [{ op: '+', text: 'x' }] },
    { type: 'pillRow', pills: [{ label: 'a', variant: 'ok' }] },
  ]));
  assert.doesNotThrow(() => blocksToMarkdown([
    { type: 'code', code: 'const a = 1;', lang: 'js' },
    { type: 'diff', lines: [{ op: '-', text: 'y' }] },
    { type: 'pillRow', pills: [{ label: 'b' }] },
  ]));
});

// ============================================================================
// Gate Board figure blocks — topo, deltaRow (neumorphic Gate Board, Task 1)
// ============================================================================

test('topo renders root, children, aside with escaping', () => {
  const html = renderBlocks([{ type: 'topo', root: { title: '<r>', note: 'n' },
    children: [{ title: 'impl_audit', note: 'auto' }], aside: { value: '0 → 1,060', note: '<x>' } }]);
  assert.match(html, /class="topo"/);
  assert.match(html, /&lt;r&gt;/);
  assert.match(html, /impl_audit/);
  assert.match(html, /&lt;x&gt;/);
  assert.ok(!html.includes('<r>'));
  const md = blocksToMarkdown([{ type: 'topo', root: { title: 'R' }, children: [{ title: 'C1', note: 'n1' }] }]);
  assert.match(md, /R/); assert.match(md, /C1/);
});

test('deltaRow clamps positions, renders endpoints, never emits NaN', () => {
  const html = renderBlocks([{ type: 'deltaRow', items: [
    { label: 'approve', from: '36%', to: '0%', fromPos: 36, toPos: 1e308, min: '0%', max: '100%' },
    { label: 'bad', from: 'x', to: 'y', fromPos: 'junk', toPos: -5 },
    { label: 'inf', from: 'a', to: 'b', fromPos: 1e999, toPos: Infinity }] }]);
  assert.match(html, /class="deltas"/);
  assert.ok(!/NaN|Infinity/.test(html));
  assert.match(html, /--b:100/);           // finite over-range 1e308 clamps to 100
  assert.match(html, /--a:0/);             // 'junk' falls back to 0
  assert.match(html, /style="--a:0;--b:0"/); // non-finite 1e999/Infinity => fallback 0, both
  assert.match(html, /class="delta__f"><span>0%<\/span><span>100%<\/span>/); // min/max endpoints render
  const md = blocksToMarkdown([{ type: 'deltaRow', items: [{ label: 'L', from: '1', to: '2', min: 'lo', max: 'hi' }] }]);
  assert.match(md, /L.*1.*2/); assert.match(md, /lo.*hi/); // twin carries endpoints too
});

test('registry closed-set oracle includes the new figure blocks with html+md', () => {
  for (const t of ['topo', 'deltaRow', 'duel', 'verdictFan']) {
    assert.ok(BLOCK_TYPES.includes(t), t);
    assert.equal(typeof BLOCKS[t].html, 'function');
    assert.equal(typeof BLOCKS[t].md, 'function');
  }
});

// ============================================================================
// Gate Board figure blocks — duel, verdictFan (neumorphic Gate Board, Task 2)
// ============================================================================

test('duel renders lanes, optional flatline, escapes', () => {
  const html = renderBlocks([{ type: 'duel',
    left: { label: 'Plan', value: '0 / 4', note: '<n>' }, right: { label: 'Code', value: '1 / 1', note: 'ok' },
    flatline: { label: 'Blockers / round', values: ['8', '7', '8', '7'] } }]);
  assert.match(html, /class="duel"/); assert.match(html, /&lt;n&gt;/);
  assert.equal((html.match(/class="flatline"/g) || []).length, 1);
  const noFlat = renderBlocks([{ type: 'duel', left: { label: 'a', value: '1' }, right: { label: 'b', value: '2' } }]);
  assert.ok(!noFlat.includes('flatline'));
});

test('verdictFan allowlists variants and clamps dot counts', () => {
  const html = renderBlocks([{ type: 'verdictFan', verdict: 'BLOCK', fates: [
    { count: 6, label: 'fixable', variant: 'ok' },
    { count: 1e308, label: 'huge', variant: '"><script>' },   // finite over-range → clamp 24
    { count: 1e999, label: 'inf', variant: 'warn' }] }]);      // non-finite → fallback 0 dots
  assert.match(html, /BLOCK/);
  assert.equal((html.match(/class="fate fate--ok"/g) || []).length, 1);
  assert.equal((html.match(/class="fate fate--x"/g) || []).length, 1);  // injected variant coerced
  assert.equal((html.match(/class="fate fate--warn"/g) || []).length, 1);
  // count dots INSIDE the .fate__dots spans only — the static .fan ornament
  // carries 5 decorative <i></i> strokes of its own (per the reference markup)
  const dotCount = [...html.matchAll(/class="fate__dots"[^>]*>((?:<i><\/i>)*)</g)]
    .reduce((n, m) => n + ((m[1].match(/<i><\/i>/g) || []).length), 0);
  assert.equal(dotCount, 6 + 24 + 0);
  assert.ok(!html.includes('<script>'));
});
