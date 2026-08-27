import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render, cli } from './render.mjs';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { FORBIDDEN_BRAND_RE } from './test-helpers.mjs';
import { planDeck } from './templates.mjs';

function fixture(ledger){ const d=mkdtempSync(join(tmpdir(),'foreman-')); const lp=join(d,'ledger.json'); writeFileSync(lp,JSON.stringify(ledger)); return {dir:d,ledgerPath:lp,out:join(d,'artifact.html')}; }
const base = { meta:{ title:'T', crumb:'C', favicon:'🛠️' }, slides:[{ kicker:'K', heading:'H', cards:[] }] };

test('renders a self-contained HTML file with style + engine inlined; no external refs', async () => {
  const f = fixture(base); await render(f.ledgerPath,'planDeck',f.out);
  const html = readFileSync(f.out,'utf8');
  assert.match(html, /<title>T<\/title>/); assert.match(html, /--ac: var\(--user-ac, #5b7cfa\)/); // the sheet is inlined (house-default accent chain)
  assert.match(html, /addEventListener\('keydown'/);
  assert.match(html, /id="navtrack"/);                              // the Gate Board rail is on the page
  // deck-era icon sprite + retired page script (its name split so the de-brand scan stays strict)
  assert.doesNotMatch(html, new RegExp('<svg width="0"|#i-cog|slide-' + 'engine'));
  assert.doesNotMatch(html, /<link|<script src=|https?:\/\//);
});
test('the RENDERED page embeds BOTH real font payloads (no placeholder text survives assembly)', async () => {
  const f = fixture(base); await render(f.ledgerPath,'planDeck',f.out);
  const html = readFileSync(f.out,'utf8');
  assert.doesNotMatch(html, /__FONT_/); // the style.css placeholders are substituted at assembly
  const payloads = html.match(/url\(data:font\/woff2;base64,[A-Za-z0-9+/=]{10000,}\) format\('woff2'\)/g) || [];
  assert.equal(payloads.length, 2, 'both woff2 payloads embedded');
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
// ---- prepr round 1: dual output — shell-less outPath + a .local.html full document ----
// The hosted assembly, pinned BYTE-FOR-BYTE (prepr blocker: head/body split).
// The expected string is reconstructed here from the same inputs render.mjs
// reads (templates + style.css + font payloads + gate-board.js), so any
// refactor of the fragment assembly that changes even one hosted byte fails
// this test — the publish contract keeps the same-URL re-render byte-stable.
test('hosted outPath is EXACTLY title + inlined sheet + template body + page script', async () => {
  const f = fixture(base); await render(f.ledgerPath,'planDeck',f.out);
  const html = readFileSync(f.out,'utf8');
  let css = readFileSync(fileURLToPath(new URL('./style.css', import.meta.url)),'utf8');
  for (const [ph, file] of [['__FONT_SORA_B64__','sora-latin.woff2'],['__FONT_NUNITO_B64__','nunito-sans-latin.woff2']]) {
    css = css.replace(ph, readFileSync(fileURLToPath(new URL(`./fonts/${file}`, import.meta.url))).toString('base64'));
  }
  const js = readFileSync(fileURLToPath(new URL('./gate-board.js', import.meta.url)),'utf8');
  const { bodyHtml } = planDeck(base); // no accent/theme in `base` => no override/init fragments
  assert.equal(html, `<title>T</title>\n<style>${css}</style>\n${bodyHtml}\n<script>${js}</script>\n`);
});
test('outPath stays SHELL-LESS: no doctype/html/head/body (the hosted-Artifact publish contract)', async () => {
  const f = fixture(base); await render(f.ledgerPath,'planDeck',f.out);
  const html = readFileSync(f.out,'utf8');
  assert.doesNotMatch(html, /<!doctype/i);
  assert.doesNotMatch(html, /<html[\s>]/i);
  assert.doesNotMatch(html, /<head[\s>]/i); // <header> is fine — this pins the literal head tag
  assert.doesNotMatch(html, /<body[\s>]/i);
});
// Fragment extraction for the .local.html shell: the two engine fragments as
// the local document carries them — headHtml after the shell's two meta lines,
// bodyHtml between <body> and </body>.
const SHELL_META = '<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n';
function localFragments(local) {
  const head = local.slice(local.indexOf('<head>\n') + '<head>\n'.length, local.indexOf('\n</head>'));
  assert.ok(head.startsWith(SHELL_META), 'the shell metadata leads the <head>');
  return {
    head,
    headHtml: head.slice(SHELL_META.length),
    bodyHtml: local.slice(local.indexOf('<body>\n') + '<body>\n'.length, local.lastIndexOf('</body>')),
  };
}
test('writes a .local.html sibling: proper head/body split of the SAME assembled fragments', async () => {
  const f = fixture(base);
  const r = await render(f.ledgerPath,'planDeck',f.out);
  const localPath = f.out.replace(/\.html$/, '.local.html');
  assert.equal(r.localPath, localPath);
  assert.equal(existsSync(localPath), true);
  const local = readFileSync(localPath,'utf8');
  assert.equal(r.localBytes, local.length);
  assert.match(local, /^<!doctype html>\n<html lang="en">\n<head>\n/);        // standards mode
  assert.match(local, /<meta charset="utf-8">/);                              // charset in <head>
  assert.match(local, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
  assert.match(local, /<\/body>\n<\/html>\n$/);
  // identical inner content, by FRAGMENT: the local head carries headHtml, the
  // local body carries bodyHtml, and those SAME two fragments concatenate (in
  // the same order, joined by the same newline) into the hosted outPath bytes.
  const { head, headHtml, bodyHtml } = localFragments(local);
  assert.equal(`${headHtml}\n${bodyHtml}`, readFileSync(f.out,'utf8'));
  // exactly ONE title, and it lives in <head>; metadata-only elements never in <body>
  assert.equal((local.match(/<title>/g) || []).length, 1);
  assert.match(head, /<title>T<\/title>/);
  assert.ok(!bodyHtml.includes('<title>'), 'no title in <body>');
  assert.ok(!bodyHtml.includes('<style>'), 'no stylesheet in <body>');
});
test('local shell with accent + theme: the override style and theme init ride the HEAD; fragments still recombine', async () => {
  const f = fixture({ ...base, meta:{ ...base.meta, accent:'#C85C3F', theme:'dark' } });
  await render(f.ledgerPath,'planDeck',f.out);
  const local = readFileSync(f.out.replace(/\.html$/, '.local.html'),'utf8');
  const { head, headHtml, bodyHtml } = localFragments(local);
  assert.equal(`${headHtml}\n${bodyHtml}`, readFileSync(f.out,'utf8'));       // same fragments, same order
  assert.match(head, /<style>:root\{--user-ac:#C85C3F\}<\/style>/);           // accent override in <head>
  assert.match(head, /<script>document\.documentElement\.dataset\.theme="dark"<\/script>/); // theme init in <head>
  assert.equal((local.match(/<title>/g) || []).length, 1);                    // still exactly one title
});
test('FAILS CLOSED for the local variant too: a secret writes NONE of the three files', async () => {
  const f = fixture({ ...base, slides:[{ kicker:'K', heading:'token sk-ant-api03-deadbeefdeadbeefdead', cards:[] }] });
  await assert.rejects(() => render(f.ledgerPath,'planDeck',f.out), /secret|fail.?closed/i);
  assert.equal(existsSync(f.out), false);
  assert.equal(existsSync(f.out.replace(/\.html$/, '.md')), false);
  assert.equal(existsSync(f.out.replace(/\.html$/, '.local.html')), false);
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
  // auto carrier overrides light unless the deck forces light, and re-paints the canvas Blue Graphite
  assert.match(html, /:root:not\(\[data-theme="light"\]\)\s*\{[^}]*--bg:#282e39/);
  // FORCED dark rule with an actual body (not just the selector in a comment) — pins the lifted accent chain too
  assert.match(html, /:root\[data-theme="dark"\]\s*\{[^}]*--ac: var\(--user-ac, #6687ff\)/);
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
test('honors meta.accent (strict hex) by emitting a --user-ac override', async () => {
  const f = fixture({ ...base, meta:{ ...base.meta, accent:'#FF0000' } });
  await render(f.ledgerPath,'planDeck',f.out);
  assert.match(readFileSync(f.out,'utf8'), /<style>:root\{--user-ac:#FF0000\}<\/style>/);
});
test('ignores a non-hex accent (no CSS injection; the house-default accent chain stands)', async () => {
  const f = fixture({ ...base, meta:{ ...base.meta, accent:'red;}body{display:none}' } });
  await render(f.ledgerPath,'planDeck',f.out); const html = readFileSync(f.out,'utf8');
  assert.doesNotMatch(html, /body\{display:none\}/);
  assert.doesNotMatch(html, /<style>:root\{--user-ac:/);           // no override style emitted
  assert.match(html, /--ac: var\(--user-ac, #5b7cfa\)/);           // the sheet's default chain stands
});
// ---- Task 10: the --user-ac producer, accent normalization, buffered lint, sanitized CLI ----
test('accent override chain end-to-end: a custom hex controls --ac in all three host states', async () => {
  for (const theme of [undefined, 'light', 'dark']) {
    const meta = theme ? { ...base.meta, accent:'#C85C3F', theme } : { ...base.meta, accent:'#C85C3F' };
    const f = fixture({ ...base, meta });
    await render(f.ledgerPath,'planDeck',f.out);
    const html = readFileSync(f.out,'utf8');
    const override = '<style>:root{--user-ac:#C85C3F}</style>';
    assert.ok(html.includes(override), `override emitted (theme=${theme})`);
    // all three --ac carriers resolve through var(--user-ac …) — auto, forced-light, forced-dark
    assert.match(html, /:root\{[^}]*--ac: var\(--user-ac, #5b7cfa\)/);                                    // bare :root
    assert.match(html, /:root:not\(\[data-theme="light"\]\)\s*\{[^}]*--ac: var\(--user-ac, #6687ff\)/);   // media-guarded dark
    assert.match(html, /:root\[data-theme="dark"\]\s*\{[^}]*--ac: var\(--user-ac, #6687ff\)/);            // stamped dark
    // cascade order: the override style tag rides AFTER the main stylesheet
    assert.ok(html.indexOf(override) > html.indexOf('--ac: var(--user-ac, #5b7cfa)'), 'override after the sheet');
    if (theme) assert.match(html, new RegExp(`dataset\\.theme=${JSON.stringify(theme)}`)); // host state stamped where forced
  }
});
test('legacy-default accent (fixtures/legacy-accent.json) emits NO override — normalized to the house default', async () => {
  const lp = fileURLToPath(new URL('./fixtures/legacy-accent.json', import.meta.url));
  const out = join(mkdtempSync(join(tmpdir(),'foreman-')), 'artifact.html');
  await render(lp,'planDeck',out);
  const html = readFileSync(out,'utf8');
  assert.doesNotMatch(html, /<style>:root\{--user-ac:/);           // the 89 legacy ledgers re-key automatically
  assert.match(html, /--ac: var\(--user-ac, #5b7cfa\)/);           // the neumorphic default governs
});
test('current-default accent emits NO override, case-insensitively', async () => {
  for (const accent of ['#5b7cfa', '#5B7CFA']) {
    const f = fixture({ ...base, meta:{ ...base.meta, accent } });
    await render(f.ledgerPath,'planDeck',f.out);
    assert.doesNotMatch(readFileSync(f.out,'utf8'), /<style>:root\{--user-ac:/, accent);
  }
});
test('de-brand: render.mjs source passes the scan predicate (defaults held numerically)', () => {
  const src = readFileSync(fileURLToPath(new URL('./render.mjs', import.meta.url)),'utf8');
  assert.doesNotMatch(src, FORBIDDEN_BRAND_RE); // Task 13's actual scan predicate
});
test('lint warnings are BUFFERED: a scan-rejected render prints nothing at all', async () => {
  const statement = 'this statement runs far past the twelve word cap and carries token sk-ant-api03-deadbeefdeadbeefdead too';
  const f = fixture({ meta:{ title:'T' }, slides:[{ statement, heading:'H' }] });
  const orig = console.error; const lines = [];
  console.error = (...a) => { lines.push(a.join(' ')); };
  try {
    await assert.rejects(() => render(f.ledgerPath,'planDeck',f.out), /secret|fail.?closed/i);
  } finally { console.error = orig; }
  assert.deepEqual(lines, []);                                     // no lint line beat the scan to stderr
  assert.equal(existsSync(f.out), false);
});
test('a clean ledger with a lint violation renders fine; stderr carries rule + location ONLY', async () => {
  const wordy = 'one two three four five six seven eight nine ten eleven twelve thirteen';
  const f = fixture({ meta:{ title:'T', verdict:'v', ask:{ headline:'H' } }, slides:[{ statement: wordy }] });
  const orig = console.error; const lines = [];
  console.error = (...a) => { lines.push(a.join(' ')); };
  try {
    await render(f.ledgerPath,'planDeck',f.out);
  } finally { console.error = orig; }
  assert.deepEqual(lines, ['lint: statement-too-long slides[0]']); // the render still proceeded
  assert.ok(!lines.join('\n').includes('thirteen'));               // never any ledger text
  assert.equal(existsSync(f.out), true);
});
const RENDER_CLI = fileURLToPath(new URL('./render.mjs', import.meta.url));
const sha8 = (v) => createHash('sha256').update(String(v)).digest('hex').slice(0, 8);
const runCli = (args) => spawnSync(process.execPath, [RENDER_CLI, ...args], { encoding: 'utf8' });
test('CLI sanitization: a secret-shaped unknown block type prints unknown-block <sha8>, never the value', () => {
  const secretType = 'sk-ant-api03-deadbeefdeadbeefdead';
  const f = fixture({ ...base, slides:[{ kicker:'K', heading:'H', blocks:[{ type: secretType }] }] });
  const r = runCli([f.ledgerPath,'planDeck',f.out]);
  assert.equal(r.status, 1);
  assert.equal(r.stderr.trim(), `unknown-block ${sha8(secretType)}`); // locator only
  assert.ok(!r.stderr.includes('sk-ant'));                            // the secret is absent
  assert.equal(existsSync(f.out), false);
});
test('CLI category matrix: usage / parse-error / unknown-type / scan-rejected / render-error', () => {
  let r = runCli([]);
  assert.equal(r.status, 2); assert.equal(r.stderr.trim(), 'usage');
  const d = mkdtempSync(join(tmpdir(),'foreman-'));
  const badLedger = join(d,'bad.json'); writeFileSync(badLedger, '{nope');
  r = runCli([badLedger,'planDeck',join(d,'o.html')]);
  assert.equal(r.status, 1); assert.equal(r.stderr.trim(), 'parse-error');
  const f = fixture(base);
  r = runCli([f.ledgerPath,'bogusType',f.out]);
  assert.equal(r.status, 1);
  assert.equal(r.stderr.trim(), `unknown-type ${sha8('bogusType')}`); // value not echoed, sha8 locator instead
  assert.ok(!r.stderr.includes('bogusType'));
  const fs2 = fixture({ ...base, slides:[{ kicker:'K', heading:'token sk-ant-api03-deadbeefdeadbeefdead', cards:[] }] });
  r = runCli([fs2.ledgerPath,'planDeck',fs2.out]);
  assert.equal(r.status, 1); assert.equal(r.stderr.trim(), 'scan-rejected');
  assert.ok(!r.stderr.includes('sk-ant'));                            // the raw scan message never prints
  r = runCli([join(d,'missing.json'),'planDeck',join(d,'o2.html')]);
  assert.equal(r.status, 1); assert.equal(r.stderr.trim(), 'render-error');
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
// Gate Board successor to the retired #toctgl/#chapters panel pin: navigation is
// now the sticky rail, and the page must degrade cleanly without JS — the same
// "chrome never wedges/lies" property, in the new system.
test('gate-board chrome: sticky rail styled; JS-only controls ship hidden until the script lands', async () => {
  const f = fixture(base); await render(f.ledgerPath,'planDeck',f.out);
  const html = readFileSync(f.out,'utf8');
  assert.match(html, /\.nav\{\s*position: sticky/);               // the rail pins to the viewport top
  assert.match(html, /\.jsonly\{ display: none; \}/);             // Expand/Collapse-all hidden no-JS
  assert.match(html, /\.js \.jsonly\{ display: inline-flex; \}/); // revealed only once the script lands
});
// Gate Board successor to the retired .phasestep detail pin: the stops track's
// detail paragraph stacks under the label (same stacking property, new markup).
test('phaseSteps stop detail stacks UNDER the label (flex-column stop body)', async () => {
  const f = fixture(base); await render(f.ledgerPath,'planDeck',f.out);
  const html = readFileSync(f.out,'utf8');
  assert.match(html, /\.stop__body\{[^}]*flex-direction: column/); // the stop body is a column: label, detail <p>, sign
});
