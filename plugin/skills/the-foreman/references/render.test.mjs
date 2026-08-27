import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render, cli } from './render.mjs';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function fixture(ledger){ const d=mkdtempSync(join(tmpdir(),'foreman-')); const lp=join(d,'ledger.json'); writeFileSync(lp,JSON.stringify(ledger)); return {dir:d,ledgerPath:lp,out:join(d,'artifact.html')}; }
const base = { meta:{ title:'T', crumb:'C', favicon:'🛠️', accent:'#009ACC' }, slides:[{ kicker:'K', heading:'H', cards:[] }] };

test('renders a self-contained HTML file with style + engine inlined; no external refs', async () => {
  const f = fixture(base); await render(f.ledgerPath,'planDeck',f.out);
  const html = readFileSync(f.out,'utf8');
  assert.match(html, /<title>T<\/title>/); assert.match(html, /--accent:#009ACC/);
  assert.match(html, /addEventListener\('keydown'/);
  assert.doesNotMatch(html, /<link|<script src=|https?:\/\//);
});
test('escapes <title> (no injection via meta.title)', async () => {
  const f = fixture({ ...base, meta:{ ...base.meta, title:'</title><script>alert(1)</script>' } });
  await render(f.ledgerPath,'planDeck',f.out); const html = readFileSync(f.out,'utf8');
  assert.doesNotMatch(html, /<script>alert\(1\)/); assert.match(html, /&lt;script&gt;/);
});
test('FAILS CLOSED: refuses to write if rendered output contains a secret', async () => {
  const f = fixture({ ...base, slides:[{ kicker:'K', heading:'token sk-ant-api03-deadbeefdeadbeefdead', cards:[] }] });
  await assert.rejects(() => render(f.ledgerPath,'planDeck',f.out), /secret|fail.?closed/i);
  assert.equal(existsSync(f.out), false);
});
test('same outPath overwrites in place (same-URL re-render)', async () => {
  const f = fixture(base); await render(f.ledgerPath,'planDeck',f.out);
  writeFileSync(f.ledgerPath, JSON.stringify({ ...base, meta:{ ...base.meta, title:'T2' } }));
  await render(f.ledgerPath,'planDeck',f.out);
  assert.match(readFileSync(f.out,'utf8'), /<title>T2<\/title>/);
});
test('cli() validates argv and renders', async () => {
  const f = fixture(base);
  await assert.rejects(() => cli([]), /usage/);
  const r = await cli([f.ledgerPath,'planDeck',f.out]); assert.equal(existsSync(r.outPath), true);
});
// ---- Part B: dark variant (auto via prefers-color-scheme + per-deck meta.theme override) ----
test('the rendered HTML ships BOTH the auto dark media query AND a forced [data-theme="dark"] rule', async () => {
  const f = fixture(base); await render(f.ledgerPath,'planDeck',f.out);
  const html = readFileSync(f.out,'utf8');
  assert.match(html, /@media \(prefers-color-scheme: dark\)/); // auto: respects the viewer's OS
  // auto carrier overrides light unless the deck forces light, and re-paints the canvas dark
  assert.match(html, /:root:not\(\[data-theme="light"\]\)\s*\{[^}]*--paper:#0F1419/);
  // FORCED dark rule with an actual body (not just the selector in a comment) — pins the lifted accent too
  assert.match(html, /:root\[data-theme="dark"\]\s*\{[^}]*--accent:#3BB7E8/);
});
test('meta.theme:"dark" injects exactly the inline data-theme init script (no src)', async () => {
  const f = fixture({ ...base, meta:{ ...base.meta, theme:'dark' } });
  await render(f.ledgerPath,'planDeck',f.out); const html = readFileSync(f.out,'utf8');
  assert.match(html, /<script>document\.documentElement\.dataset\.theme="dark"<\/script>/);
  assert.doesNotMatch(html, /<link|<script src=|https?:\/\//); // still an inline-only page
});
test('meta.theme:"light" injects the inline data-theme="light" init (forces light on a dark-OS viewer)', async () => {
  const f = fixture({ ...base, meta:{ ...base.meta, theme:'light' } });
  await render(f.ledgerPath,'planDeck',f.out); const html = readFileSync(f.out,'utf8');
  assert.match(html, /<script>document\.documentElement\.dataset\.theme="light"<\/script>/);
});
test('meta.theme:"auto" / absent injects NO data-theme script (the media query governs)', async () => {
  const fAuto = fixture({ ...base, meta:{ ...base.meta, theme:'auto' } });
  await render(fAuto.ledgerPath,'planDeck',fAuto.out);
  assert.doesNotMatch(readFileSync(fAuto.out,'utf8'), /dataset\.theme=/);
  const fNone = fixture(base); // no meta.theme at all
  await render(fNone.ledgerPath,'planDeck',fNone.out);
  assert.doesNotMatch(readFileSync(fNone.out,'utf8'), /dataset\.theme=/);
});
test('an INVALID meta.theme injects NOTHING (allowlisted; no script, no raw markup injected)', async () => {
  const evil = '"></script><script>alert(1)//';
  const f = fixture({ ...base, meta:{ ...base.meta, theme: evil } });
  await render(f.ledgerPath,'planDeck',f.out); const html = readFileSync(f.out,'utf8');
  assert.doesNotMatch(html, /dataset\.theme=/);          // garbage => no theme init at all
  assert.doesNotMatch(html, /<script>alert\(1\)/);       // and the payload never reaches markup
  const fWord = fixture({ ...base, meta:{ ...base.meta, theme:'blue' } });
  await render(fWord.ledgerPath,'planDeck',fWord.out);
  assert.doesNotMatch(readFileSync(fWord.out,'utf8'), /dataset\.theme=/);
});
test('a dark deck STILL has no external refs (inline <script> theme init only) and secret-scan still fails closed', async () => {
  const f = fixture({ ...base, meta:{ ...base.meta, theme:'dark' } });
  await render(f.ledgerPath,'planDeck',f.out);
  assert.doesNotMatch(readFileSync(f.out,'utf8'), /<link|<script src=|https?:\/\//);
  // fail-closed unchanged with a theme set
  const fs = fixture({ ...base, meta:{ ...base.meta, theme:'dark' }, slides:[{ kicker:'K', heading:'token sk-ant-api03-deadbeefdeadbeefdead', cards:[] }] });
  await assert.rejects(() => render(fs.ledgerPath,'planDeck',fs.out), /secret|fail.?closed/i);
  assert.equal(existsSync(fs.out), false);
});
test('honors meta.accent (strict hex) by overriding the CSS accent variable', async () => {
  const f = fixture({ ...base, meta:{ ...base.meta, accent:'#FF0000' } });
  await render(f.ledgerPath,'planDeck',f.out);
  assert.match(readFileSync(f.out,'utf8'), /--accent:#FF0000/);
});
test('ignores a non-hex accent (no CSS injection; #009ACC default stands)', async () => {
  const f = fixture({ ...base, meta:{ ...base.meta, accent:'red;}body{display:none}' } });
  await render(f.ledgerPath,'planDeck',f.out); const html = readFileSync(f.out,'utf8');
  assert.doesNotMatch(html, /body\{display:none\}/); assert.match(html, /--accent:#009ACC/);
});
test('FAILS CLOSED on a modern token format (sk-proj) in the ledger', async () => {
  const f = fixture({ ...base, slides:[{ kicker:'K', heading:'key sk-proj-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', cards:[] }] });
  await assert.rejects(() => render(f.ledgerPath,'planDeck',f.out), /secret|fail.?closed/i);
  assert.equal(existsSync(f.out), false);
});
test('writes a Markdown twin next to the HTML; returns mdPath + mdBytes', async () => {
  const f = fixture(base);
  const r = await render(f.ledgerPath,'planDeck',f.out);
  const mdPath = f.out.replace(/\.html$/, '.md');
  assert.equal(r.mdPath, mdPath);
  assert.equal(existsSync(mdPath), true);
  assert.equal(r.mdBytes, readFileSync(mdPath,'utf8').length);
  // existing return keys preserved unchanged
  assert.equal(r.outPath, f.out);
  assert.equal(r.bytes, readFileSync(f.out,'utf8').length);
});
test('the Markdown twin has the title + a slide heading and contains no HTML', async () => {
  const f = fixture({ ...base, slides:[{ kicker:'PLAN', heading:'Exclude approval wait', cards:[] }] });
  await render(f.ledgerPath,'planDeck',f.out);
  const md = readFileSync(f.out.replace(/\.html$/, '.md'),'utf8');
  assert.match(md, /^# T$/m);
  assert.match(md, /## PLAN — Exclude approval wait/);
  assert.doesNotMatch(md, /<[a-zA-Z/]/);
});
test('FAILS CLOSED for the twin: a secret in rendered output writes NEITHER file', async () => {
  const f = fixture({ ...base, slides:[{ kicker:'K', heading:'token sk-ant-api03-deadbeefdeadbeefdead', cards:[] }] });
  await assert.rejects(() => render(f.ledgerPath,'planDeck',f.out), /secret|fail.?closed/i);
  assert.equal(existsSync(f.out), false);
  assert.equal(existsSync(f.out.replace(/\.html$/, '.md')), false);
});
test('FAILS CLOSED: an unknown block type makes render() reject and write NEITHER file', async () => {
  const f = fixture({ ...base, slides:[{ kicker:'K', heading:'H', blocks:[{ type:'bogus' }] }] });
  await assert.rejects(() => render(f.ledgerPath,'planDeck',f.out), /unknown block type: bogus/);
  assert.equal(existsSync(f.out), false);
  assert.equal(existsSync(f.out.replace(/\.html$/, '.md')), false);
});
test('renders a per-slide table block in BOTH the HTML and the Markdown twin', async () => {
  const f = fixture({ ...base, slides:[{ kicker:'K', heading:'H', blocks:[
    { type:'table', columns:['Name','Spend'], rows:[['Tyler','$10']] },
  ] }] });
  await render(f.ledgerPath,'planDeck',f.out);
  const html = readFileSync(f.out,'utf8');
  assert.match(html, /<div class="scrollx"><table class="t">/);
  assert.match(html, /<td>Tyler<\/td>/);
  const md = readFileSync(f.out.replace(/\.html$/, '.md'),'utf8');
  assert.match(md, /^\| Name \| Spend \|$/m);
  assert.match(md, /^\| Tyler \| \$10 \|$/m);
});
test('renders metrics/chart blocks (donut + bar + lineSpark) with NO external refs and NO SVG sinks', async () => {
  const f = fixture({ ...base, slides:[{ kicker:'K', heading:'H', blocks:[
    { type:'statRow', stats:[{ value:'$0.12', label:'Spend', variant:'ok' }] },
    { type:'donut', value:25, max:100, label:'Used' },
    { type:'bar', bars:[{ label:'A', value:10 }, { label:'B', value:5 }] },
    { type:'lineSpark', points:[1,3,2,5], label:'Trend' },
  ] }] });
  await render(f.ledgerPath,'planDeck',f.out);
  const html = readFileSync(f.out,'utf8');
  // the chart blocks rendered
  assert.match(html, /class="wells"/);
  assert.match(html, /<polyline/);
  assert.match(html, /class="ring" role="img"/);
  // the existing no-external-refs invariant still holds for the whole page
  assert.doesNotMatch(html, /<link|<script src=|https?:\/\//);
  // NO chart SVG sinks leaked (the deck's own internal <use href="#i-..."> defs are NOT chart sinks)
  assert.doesNotMatch(html, /xlink:href|<image|<foreignObject/);
  // the twin renders the chart blocks as inert text (no HTML/SVG tag)
  const md = readFileSync(f.out.replace(/\.html$/, '.md'),'utf8');
  assert.match(md, /\*\*25%\*\* — Used/);
  assert.match(md, /^- A: 10$/m);
  assert.match(md, /Trend: 1, 3, 2, 5/);
});
test('FAILS CLOSED: a secret inside a per-slide code block writes NEITHER file (whole-twin + whole-HTML scan)', async () => {
  // A fake secret-shaped token (AKIA + 16 uppercase) lives INSIDE a code block
  // body. The code block keeps the body raw/literal (fence-contained) — so the
  // whole-twin secret scan must still catch it and refuse to write anything.
  const f = fixture({ ...base, slides:[{ kicker:'K', heading:'H', blocks:[
    { type:'code', code:'export const KEY = "AKIAABCDEFGHIJKLMNOP";', lang:'js' },
  ] }] });
  await assert.rejects(() => render(f.ledgerPath,'planDeck',f.out), /secret|fail.?closed/i);
  assert.equal(existsSync(f.out), false);
  assert.equal(existsSync(f.out.replace(/\.html$/, '.md')), false);
});
test('renders code / diff / pillRow blocks in BOTH the HTML and the Markdown twin (no external refs)', async () => {
  const f = fixture({ ...base, slides:[{ kicker:'K', heading:'H', blocks:[
    { type:'code', code:'function x(){ return "<div>"; }\nreturn x();', lang:'js' },
    { type:'diff', lines:[{ op:'+', text:'added line' }, { op:'-', text:'removed line' }] },
    { type:'pillRow', pills:[{ label:'green', variant:'ok' }, { label:'amber', variant:'warn' }] },
  ] }] });
  await render(f.ledgerPath,'planDeck',f.out);
  const html = readFileSync(f.out,'utf8');
  assert.match(html, /<pre><code/);            // code + diff use <pre><code>
  assert.match(html, /class="diff-add"/);
  assert.match(html, /class="pill pill--ok"/);
  assert.doesNotMatch(html, /<div>/);          // the code body's <div> is escaped, not a real tag
  assert.match(html, /&lt;div&gt;/);
  assert.doesNotMatch(html, /<link|<script src=|https?:\/\//); // no-external-refs invariant holds
  const md = readFileSync(f.out.replace(/\.html$/, '.md'),'utf8');
  assert.match(md, /^`{3,}js$/m);              // code twin opens a fenced block, info=js
  assert.match(md, /function x\(\)\{ return "<div>"; \}/); // body LITERAL inside the fence
  assert.match(md, /^`{3,}diff$/m);            // diff twin fence, info=diff
  assert.match(md, /green/);                   // pillRow labels present
});
// ---- Phase 3: the four new render-supported types end-to-end ----

test('renders a phaseTracker end-to-end: self-contained, twin written, no external refs', async () => {
  const f = fixture({
    meta: { ...base.meta, title: 'PT' },
    phaseTracker: { phases: [{ label: 'Design', status: 'done' }, { label: 'Build', status: 'active' }], progress: { value: 1, max: 2, label: 'phases' }, note: 'on track' },
  });
  const r = await render(f.ledgerPath, 'phaseTracker', f.out);
  const html = readFileSync(f.out, 'utf8');
  assert.match(html, /<title>PT<\/title>/);
  assert.match(html, /class="stops"/);                         // phaseSteps signature (the stops track)
  assert.match(html, /class="ring" role="img"/);               // tick-ring donut
  assert.doesNotMatch(html, /<link|<script src=|https?:\/\//); // no external refs
  // the .md twin is written next to the HTML
  assert.equal(existsSync(r.mdPath), true);
  const md = readFileSync(r.mdPath, 'utf8');
  assert.match(md, /^# PT$/m);
  assert.match(md, /^- \[x\] Design$/m);
  assert.doesNotMatch(md, /<[a-zA-Z/]/);
});

test('phaseTracker renders an optional per-phase detail sub-line end-to-end (HTML + twin), escaping a malicious detail', async () => {
  const f = fixture({
    meta: { ...base.meta, title: 'PT' },
    phaseTracker: { phases: [
      { label: 'Design', status: 'done', detail: '6 files touched' },
      { label: 'Build', status: 'active', detail: '<img onerror=x>' },
    ] },
  });
  const r = await render(f.ledgerPath, 'phaseTracker', f.out);
  const html = readFileSync(f.out, 'utf8');
  assert.match(html, /<b>Design<\/b><p>6 files touched<\/p>/);              // detail as the stop body <p>
  assert.doesNotMatch(html, /<img onerror=x>/);                             // malicious detail escaped
  assert.match(html, /&lt;img onerror=x&gt;/);
  const md = readFileSync(r.mdPath, 'utf8');
  assert.match(md, /^- \[x\] Design — 6 files touched$/m);                  // detail in the twin
  assert.doesNotMatch(md, /<img onerror=x>/);
});

test('renders a comparison end-to-end: self-contained, twin GitHub table, no external refs', async () => {
  const f = fixture({
    meta: { ...base.meta, title: 'CMP' },
    comparison: { criteria: ['Cost', 'Speed'], options: [{ label: 'Option A', scores: ['low', 'fast'] }], recommendation: 'Option A', recommendedBy: 'Codex' },
  });
  const r = await render(f.ledgerPath, 'comparison', f.out);
  const html = readFileSync(f.out, 'utf8');
  assert.match(html, /<div class="scrollx"><table class="t">/);
  assert.match(html, /<th scope="col">Option<\/th>/);
  assert.match(html, /Option A/);
  assert.doesNotMatch(html, /<link|<script src=|https?:\/\//);
  const md = readFileSync(r.mdPath, 'utf8');
  assert.match(md, /^\| Option \| Cost \| Speed \|$/m);
  assert.match(md, /^\| Option A \| low \| fast \|$/m);
  assert.doesNotMatch(md, /<[a-zA-Z/]/);
});

test('FAILS CLOSED: a secret in a phaseTracker ledger writes NEITHER file', async () => {
  const f = fixture({
    meta: base.meta,
    phaseTracker: { phases: [{ label: 'token sk-ant-api03-deadbeefdeadbeefdead', status: 'done' }] },
  });
  await assert.rejects(() => render(f.ledgerPath, 'phaseTracker', f.out), /secret|fail.?closed/i);
  assert.equal(existsSync(f.out), false);
  assert.equal(existsSync(f.out.replace(/\.html$/, '.md')), false);
});

test('FAILS CLOSED: an unknown dashboard chart type makes render() reject and write NEITHER file', async () => {
  const f = fixture({ meta: base.meta, dashboard: { chart: { type: 'bogusChart' } } });
  await assert.rejects(() => render(f.ledgerPath, 'dashboard', f.out), /unknown block type: bogusChart/);
  assert.equal(existsSync(f.out), false);
  assert.equal(existsSync(f.out.replace(/\.html$/, '.md')), false);
});

test('chapters rail: a board WITH chapters renders rail chips + matching section ids and STILL has no external refs', async () => {
  const f = fixture({ ...base, slides:[
    { kicker:'PLAN', heading:'Intro' },
    { kicker:'BUILD', heading:'Step one', chapter:'Discovery' },
    { kicker:'BUILD', heading:'Step two', chapter:'Discovery' },
  ] });
  await render(f.ledgerPath,'planDeck',f.out);
  const html = readFileSync(f.out,'utf8');
  assert.match(html, /id="navtrack"/);               // the sticky chapter rail
  assert.match(html, /href="#discovery"/);           // rail chip for the ledger chapter…
  assert.match(html, /id="discovery"/);              // …resolving to a real section id
  assert.equal((html.match(/id="discovery"/g) || []).length, 1); // consecutive slides share ONE section
  assert.doesNotMatch(html, /<link|<script src=|https?:\/\//); // the no-external-refs invariant holds
});
test('chapters panel does NOT force-open on #toctgl focus (Escape + focus-return must visually close)', async () => {
  const f = fixture(base); await render(f.ledgerPath,'planDeck',f.out);
  const html = readFileSync(f.out,'utf8');
  // #toctgl:focus must NOT reveal the panel: closePanel(true) removes .open AND refocuses
  // #toctgl, so a focus-reveal selector would keep it visible despite the close.
  assert.doesNotMatch(html, /#toctgl:focus\s*\+\s*#chapters/);
  assert.match(html, /#chapters\.open\{[^}]*visibility:visible/); // still revealed by the .open click-pin
});
test('phaseStep detail stacks UNDER the label (full-width new line, not an inline flex item)', async () => {
  const f = fixture(base); await render(f.ledgerPath,'planDeck',f.out);
  const html = readFileSync(f.out,'utf8');
  assert.match(html, /\.phasestep\{[^}]*flex-wrap:wrap/);                 // chip wraps so detail drops to its own line
  assert.match(html, /\.phasestep \.phase-detail\{[^}]*flex-basis:100%/); // detail forced full-width on a new line
});
