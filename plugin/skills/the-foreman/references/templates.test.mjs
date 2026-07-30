import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planDeck, brief, decisionCard, liveRun, phaseTracker, findings, comparison, dashboard } from './templates.mjs';

const ledger = {
  meta:{ title:'Cirra run-timing fix', crumb:'GRAVITY · CIRRA', favicon:'🛠️', accent:'#009ACC' },
  slides:[{ kicker:'PLAN', heading:'Exclude human-approval wait', cards:[{title:'Scope',body:'1 file'}] }],
  win:{ landed:'Excluded approval wait', evidence:'189/189 green', verified:true, next:'PR' },
  decision:{ question:'Persist events how?', options:[{label:'A',pros:'x',cons:'y',risk:'low'}], recommendation:'A' },
  liveRun:{ what:'smoke c93', cost:'$0.12', blastRadius:'prod write', cleanup:'purge verified' },
};
test('planDeck renders title + a slide from the ledger', () => {
  const r = planDeck(ledger);
  assert.match(r.title, /Cirra/); assert.match(r.bodyHtml, /Exclude human-approval wait/); assert.match(r.bodyHtml, /class="slide/);
});
test('brief surfaces verified-vs-claimed + the ask', () => {
  const h = brief(ledger).bodyHtml; assert.match(h, /189\/189/); assert.match(h, /verified/i);
});
test('decisionCard lists options + attributed recommendation', () => { assert.match(decisionCard(ledger).bodyHtml, /recommendation/i); });
test('liveRun shows cost + cleanup', () => { const h = liveRun(ledger).bodyHtml; assert.match(h, /\$0\.12/); assert.match(h, /cleanup/i); });
test('templates HTML-escape ledger text (no raw injection)', () => {
  const h = brief({ ...ledger, win:{ ...ledger.win, landed:'<img src=x onerror=alert(1)>' } }).bodyHtml;
  assert.doesNotMatch(h, /<img src=x onerror/); assert.match(h, /&lt;img/);
});

// ---- chapters navigator (Phase 1b) ----

test('planDeck stamps an escaped data-section on a slide carrying a chapter', () => {
  const h = planDeck({ ...ledger, slides:[{ kicker:'K', heading:'H', chapter:'Discovery' }] }).bodyHtml;
  assert.match(h, /data-section="Discovery"/);
});
test('planDeck omits data-section on slides without a chapter (and on the title slide)', () => {
  const h = planDeck({ ...ledger, slides:[{ kicker:'K', heading:'H' }] }).bodyHtml;
  // title slide + the single chapter-less content slide => zero data-section attrs
  assert.doesNotMatch(h, /data-section=/);
});
test('planDeck escapes a malicious chapter into data-section (no raw tag)', () => {
  const h = planDeck({ ...ledger, slides:[{ kicker:'K', heading:'H', chapter:'<img onerror=x>' }] }).bodyHtml;
  assert.doesNotMatch(h, /data-section="<img onerror=x>"/);
  assert.match(h, /data-section="&lt;img onerror=x&gt;"/);
});
test('deck() emits the chapters toggle button + empty #chapters menu container', () => {
  const h = planDeck(ledger).bodyHtml;
  assert.match(h, /id="toctgl"[^>]*aria-haspopup="true"/);
  assert.match(h, /aria-label="Chapters"/);
  assert.match(h, /<use href="#i-list"\/>/);
  assert.match(h, /<div id="chapters" role="menu"><\/div>/);
});
test('deck() wires #toctgl to the panel via aria-controls="chapters" (a11y)', () => {
  const h = planDeck(ledger).bodyHtml;
  assert.match(h, /id="toctgl"[^>]*aria-controls="chapters"/);
});

// ---- per-slide content blocks (Phase 2a) ----

test('planDeck renders a per-slide table block (scroll wrapper + escaped cells)', () => {
  const h = planDeck({ ...ledger, slides: [{ kicker: 'K', heading: 'H', blocks: [
    { type: 'table', columns: ['Name', 'Spend'], rows: [['<b>Tyler</b>', '$10']] },
  ] }] }).bodyHtml;
  assert.match(h, /<div class="scroll"><table>/);
  assert.match(h, /<th>Name<\/th>/);
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
  assert.doesNotMatch(withKey, /class="scroll"/); // no stray block scaffold
});

// ---- Phase 3: four new artifact types, each composing already-built blocks ----

const META3 = { title: 'Phase 3 art', crumb: 'GRAVITY · FOREMAN', favicon: '🛠️', accent: '#009ACC' };

// phaseTracker — phaseSteps block (+ optional donut + optional note callout).
test('phaseTracker renders a phaseSteps block (+ progress donut + note)', () => {
  const r = phaseTracker({
    meta: META3,
    phaseTracker: {
      phases: [{ label: 'Design', status: 'done' }, { label: 'Build', status: 'active' }, { label: 'Ship', status: 'pending' }],
      progress: { value: 2, max: 3, label: 'phases' },
      note: 'on track',
    },
  });
  assert.match(r.title, /Phase 3 art/);
  assert.match(r.bodyHtml, /class="phaseflow"/);   // phaseSteps signature
  assert.match(r.bodyHtml, /Design/);
  assert.match(r.bodyHtml, /class="slide/);
  assert.match(r.bodyHtml, /stroke-dasharray=/);    // donut rendered
  assert.match(r.bodyHtml, /class="callout"/);      // note callout
  assert.match(r.bodyHtml, /on track/);
});
test('phaseTracker omits the donut when no progress and omits callout when no note', () => {
  const h = phaseTracker({ meta: META3, phaseTracker: { phases: [{ label: 'P1', status: 'done' }] } }).bodyHtml;
  assert.match(h, /class="phaseflow"/);
  assert.doesNotMatch(h, /stroke-dasharray=/);  // no donut
  assert.doesNotMatch(h, /class="callout"/);    // no note callout
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

// findings — table block (+ optional rankedRows sources + optional summary callout).
test('findings renders a table with a finding title + sources + summary', () => {
  const r = findings({
    meta: META3,
    findings: {
      items: [{ title: 'Cache miss', confidence: 'High', evidence: 'log line 42', verdict: 'Confirmed' }],
      sources: [{ label: 'app.log', value: '3 hits' }],
      summary: 'root cause found',
    },
  });
  assert.match(r.bodyHtml, /<table>/);
  assert.match(r.bodyHtml, /Cache miss/);
  assert.match(r.bodyHtml, /<th>Finding<\/th>/);
  assert.match(r.bodyHtml, /class="relrow"/);  // rankedRows sources
  assert.match(r.bodyHtml, /app\.log/);
  assert.match(r.bodyHtml, /class="callout"/); // summary
  assert.match(r.bodyHtml, /root cause found/);
});
test('findings omits sources block when none and omits summary callout when none', () => {
  const h = findings({ meta: META3, findings: { items: [{ title: 'Only', confidence: 'Low' }] } }).bodyHtml;
  assert.match(h, /<table>/);
  assert.doesNotMatch(h, /class="relrow"/);  // no sources
  assert.doesNotMatch(h, /class="callout"/); // no summary
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

// comparison — table (Option + criteria columns), recommendation callout.
test('comparison renders a table with an option label, criterion header + recommendation', () => {
  const r = comparison({
    meta: META3,
    comparison: {
      criteria: ['Cost', 'Speed'],
      options: [{ label: 'Option A', scores: ['low', 'fast'] }, { label: 'Option B', scores: ['high', 'slow'] }],
      recommendation: 'Option A',
      recommendedBy: 'Codex',
    },
  });
  assert.match(r.bodyHtml, /<table>/);
  assert.match(r.bodyHtml, /Option A/);     // option label
  assert.match(r.bodyHtml, /<th>Cost<\/th>/); // criterion header
  assert.match(r.bodyHtml, /<th>Option<\/th>/);
  assert.match(r.bodyHtml, /class="callout"/);
  assert.match(r.bodyHtml, /Option A/);
  assert.match(r.bodyHtml, /Codex/);          // attribution
});
test('comparison normalizes ragged scores (table block pads short rows; no throw)', () => {
  const h = comparison({
    meta: META3,
    comparison: { criteria: ['C1', 'C2', 'C3'], options: [{ label: 'O', scores: ['only one'] }] },
  }).bodyHtml;
  assert.match(h, /<table>/);
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
  assert.match(h, /<th>Notes<\/th>/);    // the trailing Notes header
  assert.match(h, /<td>preferred<\/td>/); // A's note cell
});
test('comparison OMITS the Notes column when no option has a note (table unchanged)', () => {
  const h = comparison({
    meta: META3,
    comparison: { criteria: ['Cost'], options: [{ label: 'Option A', scores: ['low'] }] },
  }).bodyHtml;
  assert.doesNotMatch(h, /<th>Notes<\/th>/);
});
test('comparison escapes a malicious note (no raw tag survives)', () => {
  const h = comparison({
    meta: META3,
    comparison: { criteria: ['C'], options: [{ label: 'O', scores: ['x'], note: '<img src=x onerror=note>' }] },
  }).bodyHtml;
  assert.match(h, /<th>Notes<\/th>/);
  assert.doesNotMatch(h, /<img src=x onerror=note>/);
  assert.match(h, /&lt;img/);
});

// dashboard — statRow (+ chart passthrough + rankedRows + ask callout).
test('dashboard renders a statRow (+ chart + rows + ask)', () => {
  const r = dashboard({
    meta: META3,
    dashboard: {
      stats: [{ value: '$0.12', label: 'Spend', variant: 'ok' }],
      chart: { type: 'donut', value: 25, max: 100, label: 'Used' },
      rows: [{ label: 'Tyler', value: '$10' }],
      ask: 'approve budget?',
    },
  });
  assert.match(r.bodyHtml, /class="statrow"/);   // statRow signature
  assert.match(r.bodyHtml, /\$0\.12/);
  assert.match(r.bodyHtml, /stroke-dasharray=/);  // chart (donut) passthrough rendered
  assert.match(r.bodyHtml, /class="relrow"/);     // rankedRows
  assert.match(r.bodyHtml, /class="callout"/);    // ask
  assert.match(r.bodyHtml, /approve budget\?/);
});
test('dashboard FAILS CLOSED on an unknown chart type (chart passed straight to renderBlocks)', () => {
  assert.throws(
    () => dashboard({ meta: META3, dashboard: { chart: { type: 'bogusChart' } } }),
    /unknown block type: bogusChart/,
  );
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
