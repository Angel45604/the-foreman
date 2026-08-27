import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as templates from './templates.mjs';
import { planDeck, brief, decisionCard, liveRun, phaseTracker, findings, comparison, dashboard } from './templates.mjs';
import { stripDetails, FORBIDDEN_BRAND_RE } from './test-helpers.mjs';

// ---- shared Gate Board test helpers ----

// rail chips in document order, by their data-sec ids (Top is always first)
const chipIds = (h) => [...h.matchAll(/data-sec="([^"]+)"/g)].map((m) => m[1]);

// slice one <section> out of the board by its id (sections never nest)
function sectionOf(h, id) {
  const at = h.indexOf(`id="${id}"`);
  assert.notEqual(at, -1, `section #${id} exists`);
  return h.slice(h.lastIndexOf('<section', at), h.indexOf('</section>', at));
}

// ask-target contract: the ask strip's jump href must resolve to a REAL section
// whose VISIBLE (details-stripped) content contains the ask text
function assertAskVisible(h, askText) {
  const m = h.match(/class="ask"[\s\S]*?href="#([^"]+)"/);
  assert.ok(m, 'ask strip renders a jump link');
  assert.ok(stripDetails(sectionOf(h, m[1])).includes(askText), `ask text visible in #${m[1]}`);
}

// ---- stripDetails self-tests (the helper the visible-content contract rides on) ----

test('stripDetails drops details content (negative control) and handles nesting', () => {
  const html = '<p>seen</p><details class="dw"><summary>s</summary><p>HIDDEN-FACT</p>'
    + '<details><p>DEEP-FACT</p></details><p>AFTER-NESTED</p></details><p>tail</p>';
  const out = stripDetails(html);
  assert.match(out, /seen/); assert.match(out, /tail/);
  assert.ok(!out.includes('HIDDEN-FACT'));   // a fact ONLY inside <details> must NOT survive
  assert.ok(!out.includes('DEEP-FACT'));     // nested details handled
  assert.ok(!out.includes('AFTER-NESTED'));  // inner close returns depth to 1, not 0
  assert.ok(!out.includes('<details'));      // the tags themselves are gone
});
test('stripDetails keeps depth-0 content between sibling details and drops an unclosed tail', () => {
  assert.equal(stripDetails('<details>ONE</details><b>mid</b><details>TWO</details>'), '<b>mid</b>');
  assert.ok(!stripDetails('<p>ok</p><details><p>SWALLOWED').includes('SWALLOWED'));
});

const ledger = {
  meta:{ title:'Cirra run-timing fix', crumb:'GRAVITY · CIRRA', favicon:'🛠️', accent:'#C85C3F' },
  slides:[{ kicker:'PLAN', heading:'Exclude human-approval wait', cards:[{title:'Scope',body:'1 file'}] }],
  win:{ landed:'Excluded approval wait', evidence:'189/189 green', verified:true, next:'PR' },
  decision:{ question:'Persist events how?', options:[{label:'A',pros:'x',cons:'y',risk:'low'}], recommendation:'A' },
  liveRun:{ what:'smoke c93', cost:'$0.12', blastRadius:'prod write', cleanup:'purge verified' },
};

// ---- planDeck on the Gate Board (Task 6) ----

test('planDeck renders a Gate Board: rail, hero fallbacks, chapters, decision chapter', () => {
  const ref = JSON.parse(readFileSync(new URL('../../../../docs/initiatives/2026-08-26-neumorphic-gate-board/reference-ledger.json', import.meta.url), 'utf8'));
  const { bodyHtml, title } = planDeck(ref);
  assert.equal(title, ref.meta.title);
  assert.match(bodyHtml, /class="nav"/);
  assert.match(bodyHtml, /id="diagnosis"/);                       // chapter from slide.chapter
  assert.match(bodyHtml, /id="your-call"/);                       // decision chapter
  assert.match(bodyHtml, /class="verdictline"/);                  // meta.subtitle fallback
  assert.ok(!/id="bar"|slide"/i.test(bodyHtml));      // deck-era markup retired
  assert.ok(!FORBIDDEN_BRAND_RE.test(bodyHtml));      // no legacy brand string on the board
});

test('planDeck escapes ledger text and tolerates a minimal legacy ledger', () => {
  const { bodyHtml } = planDeck({ meta: { title: '<t>' }, slides: [{ heading: 'H<img>', bullets: ['<b>'] }] });
  assert.match(bodyHtml, /&lt;t&gt;/); assert.match(bodyHtml, /H&lt;img&gt;/);
  assert.ok(!bodyHtml.includes('<img>'));
});
// ---- the seven single-section types on the Gate Board (Task 7) ----
// Rail contract: exactly ONE chapter — Top + one chip. With an effective ask the
// chapter is `Your call` and carries BOTH the primary content AND the ask; with
// no ask source it keeps its content label and no ask strip renders.

test('brief: Your call chapter — landed + status pill VISIBLE, ask beneath, evidence in the drawer', () => {
  const h = brief(ledger).bodyHtml;
  assert.match(h, /class="nav"/);
  assert.deepEqual(chipIds(h), ['top', 'your-call']);            // Top + Your call, 2 chips
  const vis = stripDetails(h);
  assert.match(vis, /What landed/);                              // the unit statement
  assert.match(vis, /Excluded approval wait/);                   // win.landed VISIBLE (.co callout)
  assert.match(vis, /class="pill pill--ok"/);                    // Verified pill, BEM form
  assert.match(vis, /Verified/);
  assert.ok(!vis.includes('189/189'));                           // evidence is drawer-only…
  assert.match(h, /189\/189/);                                   // …but never dropped
  assertAskVisible(h, 'PR');                                     // effective ask = win.next
});
test('brief without win.next keeps the content label and renders NO ask strip (never a dead link)', () => {
  const h = brief({ meta: { title: 'B' }, win: { landed: 'L', verified: false } }).bodyHtml;
  assert.deepEqual(chipIds(h), ['top', 'what-landed']);
  assert.doesNotMatch(h, /class="ask"/);
  assert.doesNotMatch(h, /id="your-call"/);
  assert.match(stripDetails(h), /class="pill pill--warn"/);      // Claimed pill still visible
});
test('decisionCard: the ask chapter — question visible up top, option cards, ONE .rec strip', () => {
  const h = decisionCard(ledger).bodyHtml;
  assert.deepEqual(chipIds(h), ['top', 'your-call']);
  const vis = stripDetails(h);
  assert.match(vis, /Persist events how\?/);                     // the question, visible
  assert.match(vis, /class="opts"/);                             // option cards as evidence
  assert.equal((h.match(/class="rec"/g) || []).length, 1);       // exactly one recommendation strip
  assert.match(h, /Recommendation — <span>A<\/span>/);           // derived ask carries the decision's rec
  assertAskVisible(h, 'Persist events how?');
});
test('decisionCard: meta.ask WINS over the decision in strip/target/.rec; options stay as evidence', () => {
  const h = decisionCard({ ...ledger, meta: { ...ledger.meta,
    ask: { headline: 'OVERRIDE ASK', recommendation: 'Meta rec', recommendedBy: 'Owner' } } }).bodyHtml;
  assert.match(h, /OVERRIDE ASK/);
  assert.equal((h.match(/class="rec"/g) || []).length, 1);
  assert.match(h, /Recommendation — <span>Meta rec<\/span>/);
  assert.doesNotMatch(h, /Recommendation — <span>A<\/span>/);    // never the decision's own line
  assert.match(h, /class="opts"/); assert.match(h, /class="opt__rec"/);
  assert.doesNotMatch(h, /Persist events how\?/);                // stale question out of strip + header
});
test('decisionCard escapes a malicious question (no raw tag)', () => {
  const h = decisionCard({ meta: { title: 't' }, decision: { question: '<img onerror=q>', options: [] } }).bodyHtml;
  assert.doesNotMatch(h, /<img onerror=q>/); assert.match(h, /&lt;img/);
});
test('liveRun: gate facts as four VISIBLE callouts, synthesized keyStats tiles, the authorize ask', () => {
  const h = liveRun(ledger).bodyHtml;
  const vis = stripDetails(h);
  assert.match(vis, /Live-run gate — authorize before anything runs/);
  for (const fact of ['smoke c93', '$0.12', 'prod write', 'purge verified']) assert.ok(vis.includes(fact), fact);
  assert.equal((vis.match(/class="co"/g) || []).length, 4);      // What / Cost / Blast radius / Cleanup
  assert.match(vis, /class="tiles"/);                            // synthesized keyStats…
  assert.match(vis, /blast radius/);                             // …cost + blast radius labels
  assert.deepEqual(chipIds(h), ['top', 'your-call']);
  assertAskVisible(h, 'Authorize this live run?');
});
test('liveRun escapes a malicious what (no raw injection)', () => {
  const h = liveRun({ meta: { title: 't' }, liveRun: { what: '<img src=x onerror=alert(1)>' } }).bodyHtml;
  assert.doesNotMatch(h, /<img src=x onerror/); assert.match(h, /&lt;img/);
});
test('templates HTML-escape ledger text (no raw injection)', () => {
  const h = brief({ ...ledger, win:{ ...ledger.win, landed:'<img src=x onerror=alert(1)>' } }).bodyHtml;
  assert.doesNotMatch(h, /<img src=x onerror/); assert.match(h, /&lt;img/);
});
test('no artifact type emits deck-era markup (slides, callouts, ghost numbers, icon sprites)', () => {
  const outs = [planDeck(ledger), brief(ledger), decisionCard(ledger), liveRun(ledger),
    phaseTracker({ meta: { title: 't' }, phaseTracker: { phases: [{ label: 'P', status: 'done' }], note: 'n' } }),
    findings({ meta: { title: 't' }, findings: { items: [{ title: 'T' }], summary: 's' } }),
    comparison({ meta: { title: 't' }, comparison: { criteria: ['C'], options: [{ label: 'O', scores: ['x'] }], recommendation: 'O' } }),
    dashboard({ meta: { title: 't' }, dashboard: { stats: [{ value: '1', label: 'l' }], ask: 'a?' } })];
  for (const { bodyHtml } of outs) {
    assert.match(bodyHtml, /class="nav"/);
    assert.ok(!/class="slide|class="callout"|class="card|ghostnum|id="deck"|id="toctgl"|#i-/.test(bodyHtml));
  }
});

// ---- chapters: the rail derives from slide.chapter (Gate Board form) ----

test('planDeck groups consecutive slides by chapter into rail-addressable sections', () => {
  const h = planDeck({ ...ledger, decision: undefined, slides:[
    { kicker:'K', heading:'H1', chapter:'Discovery' },
    { kicker:'K', heading:'H2', chapter:'Discovery' },
    { kicker:'K', heading:'H3', chapter:'Build' },
  ] }).bodyHtml;
  assert.match(h, /href="#discovery"/); assert.match(h, /id="discovery"/);
  assert.match(h, /href="#build"/); assert.match(h, /id="build"/);
  assert.equal((h.match(/id="discovery"/g) || []).length, 1); // consecutive slides share ONE section
});
test('planDeck folds chapter-less slides into a Board chapter (no dead rail)', () => {
  const h = planDeck({ ...ledger, decision: undefined, slides:[{ kicker:'K', heading:'H' }] }).bodyHtml;
  assert.match(h, /id="board"/); assert.match(h, /href="#board"/);
});
test('planDeck escapes a malicious chapter label; its id stays slug-safe (no raw tag)', () => {
  const h = planDeck({ ...ledger, slides:[{ kicker:'K', heading:'H', chapter:'<img onerror=x>' }] }).bodyHtml;
  assert.ok(!h.includes('<img onerror=x>'));
  assert.match(h, /&lt;img onerror=x&gt;/);   // label esc'd in the rail chip + section heading
  assert.match(h, /id="img-onerror-x"/);      // slugified id — nothing injected
});
// deck()/slide()/card() are retired (Task 7): their chrome tests are replaced by
// the Gate Board rail pins below (same property — navigable chapter chrome).
test('planDeck(reference ledger) rail = Top + Diagnosis + Experiment + Decision + Plan + Your call', () => {
  const ref = JSON.parse(readFileSync(new URL('../../../../docs/initiatives/2026-08-26-neumorphic-gate-board/reference-ledger.json', import.meta.url), 'utf8'));
  const { bodyHtml } = planDeck(ref);
  assert.deepEqual(chipIds(bodyHtml), ['top', 'diagnosis', 'experiment', 'decision', 'plan', 'your-call']);
  assertAskVisible(bodyHtml, 'Change the artifact class rather than the scope?');
});

// ---- ask resolution: effectiveAsk = meta.ask ?? derived-from-decision ----

test('planDeck with meta.ask and NO decision renders a Your call chapter the strip links to', () => {
  const { bodyHtml } = planDeck({
    meta: { title: 't', ask: { headline: 'Approve the plan?', note: 'one note', recommendation: 'Go', recommendedBy: 'Claude' } },
    slides: [{ heading: 'H', chapter: 'Work' }],
  });
  assert.match(bodyHtml, /href="#your-call"/);   // ask strip jump target…
  assert.match(bodyHtml, /id="your-call"/);      // …resolves to a real section
  assert.match(bodyHtml, /Approve the plan\?/);
  assert.match(bodyHtml, /one note/);
  assert.match(bodyHtml, /class="rec"/);         // the single recommendation strip
  assert.doesNotMatch(bodyHtml, /class="opts"/); // no decision => no option cards
});
test('planDeck with BOTH meta.ask and decision: meta.ask wins strip/target/.rec; options stay as evidence', () => {
  const { bodyHtml } = planDeck({
    meta: { title: 't', ask: { headline: 'OVERRIDE ASK', recommendation: 'Meta rec', recommendedBy: 'Owner' } },
    slides: [],
    decision: { question: 'Old q?', options: [{ label: 'A', pros: 'pro text', cons: 'con text', risk: 'low' }],
      recommendation: 'A', recommendedBy: 'Codex' },
  });
  assert.match(bodyHtml, /OVERRIDE ASK/);                       // meta.ask headline in strip + target header
  assert.equal((bodyHtml.match(/class="rec"/g) || []).length, 1); // exactly one .rec strip
  assert.match(bodyHtml, /Recommendation — <span>Meta rec<\/span>/); // …carrying meta.ask's recommendation
  assert.doesNotMatch(bodyHtml, /Recommendation — <span>A<\/span>/); // never the decision's own line
  assert.match(bodyHtml, /class="opts"/);                       // options still render as evidence
  assert.match(bodyHtml, /class="opt__rec"/);                   // recommended marker keys off decision.recommendation
  assert.match(bodyHtml, /pro text/); assert.match(bodyHtml, /con text/);
});
test('planDeck derives the ask from the decision when meta.ask is absent (question drives the strip)', () => {
  const { bodyHtml } = planDeck(ledger); // base ledger: decision, no meta.ask
  assert.match(bodyHtml, /Persist events how\?/);
  assert.match(bodyHtml, /href="#your-call"/); assert.match(bodyHtml, /id="your-call"/);
  assert.match(bodyHtml, /class="opts"/);
  assert.match(bodyHtml, /opt__risk opt__risk--low/);           // risk chip allowlisted
});

// ---- per-slide content blocks (Phase 2a) ----

test('planDeck renders a per-slide table block (scroll wrapper + escaped cells)', () => {
  const h = planDeck({ ...ledger, slides: [{ kicker: 'K', heading: 'H', blocks: [
    { type: 'table', columns: ['Name', 'Spend'], rows: [['<b>Tyler</b>', '$10']] },
  ] }] }).bodyHtml;
  assert.match(h, /<div class="scrollx"><table class="t">/);
  assert.match(h, /<th scope="col">Name<\/th>/);
  assert.doesNotMatch(h, /<b>Tyler<\/b>/);     // cell value is escaped, not raw markup
  assert.match(h, /&lt;b&gt;Tyler/);
});

test('planDeck renders a per-slide rankedRows block reusing .relrow', () => {
  const h = planDeck({ ...ledger, slides: [{ kicker: 'K', heading: 'H', blocks: [
    { type: 'rankedRows', rows: [{ label: 'Tyler', value: '$10' }] },
  ] }] }).bodyHtml;
  assert.match(h, /class="relrow"/);
  assert.match(h, /class="k">Tyler</);
});

test('planDeck: a block-less slide renders identically (no blocks markup leaks in)', () => {
  const slides = [{ kicker: 'K', heading: 'H', cards: [{ title: 'Scope', body: '1 file' }], bullets: ['b1'], callout: 'note' }];
  const withKey = planDeck({ ...ledger, slides }).bodyHtml;
  const withUndef = planDeck({ ...ledger, slides: [{ ...slides[0], blocks: undefined }] }).bodyHtml;
  assert.equal(withKey, withUndef);             // omitting vs explicit-undefined are byte-identical
  assert.doesNotMatch(withKey, /class="scrollx"/); // no stray block scaffold
});

// ---- Phase 3: four new artifact types, each composing already-built blocks ----

const META3 = { title: 'Phase 3 art', crumb: 'GRAVITY · FOREMAN', favicon: '🛠️', accent: '#C85C3F' };

// phaseTracker — the stops figure VISIBLE (+ optional donut); pt.note drives the ask.
test('phaseTracker: stops figure + donut VISIBLE, note as the ask (Your call chapter)', () => {
  const r = phaseTracker({
    meta: META3,
    phaseTracker: {
      phases: [{ label: 'Design', status: 'done' }, { label: 'Build', status: 'active' }, { label: 'Ship', status: 'pending' }],
      progress: { value: 2, max: 3, label: 'phases' },
      note: 'on track',
    },
  });
  assert.match(r.title, /Phase 3 art/);
  const vis = stripDetails(r.bodyHtml);
  assert.match(vis, /class="stops"/);              // phaseSteps figure, visible
  assert.match(vis, /Design/);
  assert.match(vis, /class="ring" role="img"/);    // tick-ring donut rendered beside it
  assert.deepEqual(chipIds(r.bodyHtml), ['top', 'your-call']);
  assertAskVisible(r.bodyHtml, 'on track');        // derivedAsk.headline = pt.note
});
test('phaseTracker without progress/note: Progress label, no donut, NO ask strip', () => {
  const h = phaseTracker({ meta: META3, phaseTracker: { phases: [{ label: 'P1', status: 'done' }] } }).bodyHtml;
  assert.match(h, /class="stops"/);
  assert.deepEqual(chipIds(h), ['top', 'progress']);
  assert.doesNotMatch(h, /class="ring"/);       // no donut
  assert.doesNotMatch(h, /class="ask"/);        // no ask source => no strip (never a dead link)
});
test('phaseTracker escapes a malicious phase label (no raw tag) and a malicious note', () => {
  const h = phaseTracker({
    meta: META3,
    phaseTracker: { phases: [{ label: '<img src=x onerror=alert(1)>', status: 'done' }], note: '<img onerror=note>' },
  }).bodyHtml;
  assert.doesNotMatch(h, /<img src=x onerror/);
  assert.doesNotMatch(h, /<img onerror=note>/);
  assert.match(h, /&lt;img/);
});

// findings — the table figure VISIBLE, statRow wells + chips from sources, summary as the ask.
test('findings: table VISIBLE, wells above from sources, evidence chips, summary as the ask', () => {
  const r = findings({
    meta: META3,
    findings: {
      items: [{ title: 'Cache miss', confidence: 'High', evidence: 'log line 42', verdict: 'Confirmed' }],
      sources: [{ label: 'app.log', value: '3 hits' }],
      summary: 'root cause found',
    },
  });
  const vis = stripDetails(r.bodyHtml);
  assert.match(vis, /<table class="t">/);          // the findings table, visible
  assert.match(vis, /Cache miss/);
  assert.match(vis, /<th scope="col">Finding<\/th>/);
  assert.match(vis, /class="wells"/);              // statRow wells from f.sources
  assert.match(vis, /app\.log/);
  assert.match(r.bodyHtml, /class="src"/);         // sources → evidence-base chips too
  assert.deepEqual(chipIds(r.bodyHtml), ['top', 'your-call']);
  assertAskVisible(r.bodyHtml, 'root cause found');
  assert.ok(vis.indexOf('class="wells"') < vis.indexOf('<table class="t">')); // wells sit ABOVE the table
});
test('findings without sources/summary: Findings label, no wells, no chips, NO ask strip', () => {
  const h = findings({ meta: META3, findings: { items: [{ title: 'Only', confidence: 'Low' }] } }).bodyHtml;
  assert.match(h, /<table class="t">/);
  assert.deepEqual(chipIds(h), ['top', 'findings']);
  assert.doesNotMatch(h, /class="wells"/);   // no sources
  assert.doesNotMatch(h, /class="src"/);     // no chips
  assert.doesNotMatch(h, /class="ask"/);     // no summary => no ask strip
});
test('findings escapes a malicious finding title (no raw tag) and summary', () => {
  const h = findings({
    meta: META3,
    findings: { items: [{ title: '<img src=x onerror=alert(1)>', confidence: 'High' }], summary: '<img onerror=sum>' },
  }).bodyHtml;
  assert.doesNotMatch(h, /<img src=x onerror/);
  assert.doesNotMatch(h, /<img onerror=sum>/);
  assert.match(h, /&lt;img/);
});

// comparison — the options × criteria table VISIBLE; recommendation drives the ask.
test('comparison: table VISIBLE with criterion headers; recommendation as the attributed ask', () => {
  const r = comparison({
    meta: META3,
    comparison: {
      criteria: ['Cost', 'Speed'],
      options: [{ label: 'Option A', scores: ['low', 'fast'] }, { label: 'Option B', scores: ['high', 'slow'] }],
      recommendation: 'Option A',
      recommendedBy: 'Codex',
    },
  });
  const vis = stripDetails(r.bodyHtml);
  assert.match(vis, /<table class="t">/);
  assert.match(vis, /Option A/);                            // option label
  assert.match(vis, /<th scope="col">Cost<\/th>/);          // criterion header
  assert.match(vis, /<th scope="col">Option<\/th>/);
  assert.match(r.bodyHtml, /Recommendation — <span>Option A<\/span>/); // the single .rec strip
  assert.match(r.bodyHtml, /Codex/);                        // attribution
  assert.deepEqual(chipIds(r.bodyHtml), ['top', 'your-call']);
  assertAskVisible(r.bodyHtml, 'Pick an option');
});
test('comparison without a recommendation: Comparison label, NO ask strip', () => {
  const h = comparison({
    meta: META3,
    comparison: { criteria: ['Cost'], options: [{ label: 'Option A', scores: ['low'] }] },
  }).bodyHtml;
  assert.deepEqual(chipIds(h), ['top', 'comparison']);
  assert.doesNotMatch(h, /class="ask"/);
  assert.doesNotMatch(h, /class="rec"/);
});
test('comparison normalizes ragged scores (table block pads short rows; no throw)', () => {
  const h = comparison({
    meta: META3,
    comparison: { criteria: ['C1', 'C2', 'C3'], options: [{ label: 'O', scores: ['only one'] }] },
  }).bodyHtml;
  assert.match(h, /<table class="t">/);
  assert.match(h, /only one/);
});
test('comparison escapes a malicious option label (no raw tag) and recommendation', () => {
  const h = comparison({
    meta: META3,
    comparison: { criteria: ['C'], options: [{ label: '<img src=x onerror=alert(1)>', scores: ['x'] }], recommendation: '<img onerror=rec>' },
  }).bodyHtml;
  assert.doesNotMatch(h, /<img src=x onerror/);
  assert.doesNotMatch(h, /<img onerror=rec>/);
  assert.match(h, /&lt;img/);
});
test('comparison adds a trailing Notes column when ANY option has a note', () => {
  const h = comparison({
    meta: META3,
    comparison: {
      criteria: ['Cost'],
      options: [
        { label: 'Option A', scores: ['low'], note: 'preferred' },
        { label: 'Option B', scores: ['high'] }, // no note on B -> empty Notes cell
      ],
    },
  }).bodyHtml;
  assert.match(h, /<th scope="col">Notes<\/th>/);    // the trailing Notes header
  assert.match(h, /<td>preferred<\/td>/); // A's note cell
});
test('comparison OMITS the Notes column when no option has a note (table unchanged)', () => {
  const h = comparison({
    meta: META3,
    comparison: { criteria: ['Cost'], options: [{ label: 'Option A', scores: ['low'] }] },
  }).bodyHtml;
  assert.doesNotMatch(h, /<th scope="col">Notes<\/th>/);
});
test('comparison escapes a malicious note (no raw tag survives)', () => {
  const h = comparison({
    meta: META3,
    comparison: { criteria: ['C'], options: [{ label: 'O', scores: ['x'], note: '<img src=x onerror=note>' }] },
  }).bodyHtml;
  assert.match(h, /<th scope="col">Notes<\/th>/);
  assert.doesNotMatch(h, /<img src=x onerror=note>/);
  assert.match(h, /&lt;img/);
});

// dashboard — d.stats as hero tiles, chart + rows VISIBLE, d.ask as the ask.
test('dashboard: stats as tiles, chart + ranked rows VISIBLE, ask strip resolves', () => {
  const r = dashboard({
    meta: META3,
    dashboard: {
      stats: [{ value: '$0.12', label: 'Spend', variant: 'ok' }],
      chart: { type: 'donut', value: 25, max: 100, label: 'Used' },
      rows: [{ label: 'Tyler', value: '$10' }],
      ask: 'approve budget?',
    },
  });
  const vis = stripDetails(r.bodyHtml);
  assert.match(vis, /class="tiles"/);            // d.stats render as hero tiles
  assert.match(vis, /\$0\.12/);
  assert.match(vis, /class="ring" role="img"/);  // chart (tick-ring donut) passthrough, visible
  assert.match(vis, /class="relrow"/);           // rankedRows, visible
  assert.deepEqual(chipIds(r.bodyHtml), ['top', 'your-call']);
  assertAskVisible(r.bodyHtml, 'approve budget?');
});
test('dashboard without an ask: Dashboard label, NO ask strip', () => {
  const h = dashboard({ meta: META3, dashboard: { stats: [{ value: '1', label: 'x' }] } }).bodyHtml;
  assert.deepEqual(chipIds(h), ['top', 'dashboard']);
  assert.doesNotMatch(h, /class="ask"/);
});
test('dashboard FAILS CLOSED on an unknown chart type (chart passed straight to renderBlocks)', () => {
  assert.throws(
    () => dashboard({ meta: META3, dashboard: { chart: { type: 'bogusChart' } } }),
    /unknown block type: bogusChart/,
  );
  assert.throws(() => templates.dashboard({ dashboard: { chart: { type: 'nope' } } })); // meta-less ledger too
});
test('dashboard escapes a malicious stat value (no raw tag) and ask', () => {
  const h = dashboard({
    meta: META3,
    dashboard: { stats: [{ value: '<img src=x onerror=alert(1)>', label: 'L' }], ask: '<img onerror=ask>' },
  }).bodyHtml;
  assert.doesNotMatch(h, /<img src=x onerror/);
  assert.doesNotMatch(h, /<img onerror=ask>/);
  assert.match(h, /&lt;img/);
});

// ---- askShape: malformed meta.ask never silently drops content (wave-B review P2/P3) ----
const ASK_DECISION = { question: 'Ship it?', options: [{ label: 'A', pros: 'p', cons: 'c', risk: 'low' }], recommendation: 'A', recommendedBy: 'Claude' };
test('empty-string meta.ask falls through to the derived ask — the decision still renders in full', () => {
  const h = decisionCard({ meta: { title: 'D', ask: '' }, decision: ASK_DECISION }).bodyHtml;
  assert.deepEqual(chipIds(h), ['top', 'your-call']);
  const vis = stripDetails(h);
  assert.match(vis, /Ship it\?/);                       // question visible at the target
  assert.match(vis, /class="opt\b/);                    // option cards render
  assert.equal((h.match(/class="rec"/g) || []).length, 1);
});
test('plain-string meta.ask is malformed: no empty-headline strip, derived ask wins', () => {
  const h = decisionCard({ meta: { title: 'D', ask: 'Approve the plan?' }, decision: ASK_DECISION }).bodyHtml;
  assert.doesNotMatch(h, /<b><\/b>/);                   // never an empty ask headline
  assert.match(stripDetails(h), /Ship it\?/);           // derived headline drives strip + target
});
test('decisionCard with NO ask source: content label, no ask strip, no dead link', () => {
  const h = decisionCard({ meta: { title: 'D' } }).bodyHtml;
  assert.deepEqual(chipIds(h), ['top', 'decision']);
  assert.doesNotMatch(h, /class="ask"/);
});
