import test from 'node:test';
import assert from 'node:assert/strict';
import { gateBoard, unit, drawer, slugify, allocateIds, firstClause } from './scaffold.mjs';
import { FORBIDDEN_BRAND_RE } from './test-helpers.mjs';

test('slugify is stable and safe', () => {
  assert.equal(slugify('Decision record'), 'decision-record');
  assert.equal(slugify('<script>'), 'script');
  assert.equal(slugify('!!!'), 'section');
});

test('firstClause is decimal-safe and capped', () => {
  assert.equal(firstClause('$0.12 per call · no DB writes'), '$0.12 per call');
  assert.equal(firstClause('Reads v1.2 manifest. Then stops.'), 'Reads v1.2 manifest.');
  assert.equal(firstClause('touches diff.mjs only'), 'touches diff.mjs only');
  assert.equal(firstClause('x'.repeat(120)).length, 80);
});

test('allocateIds is collision-safe and reserves top', () => {
  assert.deepEqual(allocateIds(['Diagnosis', 'Plan', 'Diagnosis', 'Top', '汉字', '中文']),
    ['diagnosis', 'plan', 'diagnosis-2', 'top-2', 'section', 'section-2']);
});

test('ask strip renders recommendation without a note, and note without recommendation', () => {
  const a = gateBoard({ title: 't', ask: { headline: 'H', recommendation: 'Pick A', recommendedBy: 'Claude' }, chapters: [] });
  assert.match(a.bodyHtml, /Pick A/); assert.match(a.bodyHtml, /Claude/);
  const b = gateBoard({ title: 't', ask: { headline: 'H', note: 'just a note' }, chapters: [] });
  assert.match(b.bodyHtml, /just a note/);
});

test('ask attribution renders in .ask__by (the wrapping chip), never the generic nowrap .chip', () => {
  const long = 'Claude — on the repo record, and it is the remedy applied to its own successor';
  const { bodyHtml } = gateBoard({ title: 't', ask: { headline: 'H', recommendedBy: long }, chapters: [] });
  assert.match(bodyHtml, new RegExp(`<span class="ask__by">${long}</span>`));
  assert.doesNotMatch(bodyHtml, new RegExp(`<span class="chip">${long}</span>`)); // the clipping chip form is retired here
});

test('gateBoard renders rail chips for Top + every chapter, with matching section ids', () => {
  const { bodyHtml, ids } = gateBoard({ crumb: 'C', title: 'T', verdict: 'V', lede: 'L',
    keyStats: [{ value: '1', label: 'one' }],
    ask: { headline: 'H<x>', targetId: 'your-call' },
    chapters: [{ label: 'Diagnosis', unitsHtml: '<p>u</p>' }, { label: 'Your call', unitsHtml: '<p>d</p>' }] });
  assert.deepEqual(ids, ['diagnosis', 'your-call']);
  assert.match(bodyHtml, /href="#top"/);
  assert.match(bodyHtml, /href="#diagnosis"/); assert.match(bodyHtml, /id="diagnosis"/);
  assert.match(bodyHtml, /href="#your-call"/); assert.match(bodyHtml, /id="your-call"/);
  assert.match(bodyHtml, /H&lt;x&gt;/);
  assert.match(bodyHtml, /class="tiles"/);
  assert.ok(!FORBIDDEN_BRAND_RE.test(bodyHtml)); // no legacy brand string in the shell
});

test('keyStats tiles: an allowlisted ok/warn variant picks tile--ok/tile--warn; anything else stays bare', () => {
  const { bodyHtml } = gateBoard({ title: 't', keyStats: [
    { value: '70/70', label: 'pass', variant: 'ok' },
    { value: '2', label: 'fail', variant: 'warn' },
    { value: '1', label: 'plain' },
    { value: '3', label: 'inj', variant: 'evil" onmouseover="x' },
  ], chapters: [] });
  assert.match(bodyHtml, /class="tile tile--ok" role="listitem"><b>70\/70</);
  assert.match(bodyHtml, /class="tile tile--warn" role="listitem"><b>2</);
  assert.equal((bodyHtml.match(/class="tile" role="listitem"/g) || []).length, 2, 'plain + rejected variant fall back to the bare tile');
  assert.doesNotMatch(bodyHtml, /onmouseover/);   // no attribute smuggled via variant
  assert.doesNotMatch(bodyHtml, /tile--evil/);    // not an allowlisted class
});

test('sources survive a zero-chapter board (fall back into #top)', () => {
  const { bodyHtml } = gateBoard({ title: 't', chapters: [], sources: [{ label: 'rounds mined', value: '1,002' }] });
  assert.match(bodyHtml, /Evidence base/); assert.match(bodyHtml, /1,002/);
});

test('unit + drawer compose; empty drawer collapses to nothing', () => {
  const u = unit({ kicker: 'K', statement: 'S', figureHtml: '<div class="fig">f</div>',
    drawerLabel: 'Detail', drawerHtml: '<p>evidence</p>' });
  assert.match(u, /class="unit"/); assert.match(u, /<details class="dw">/);
  assert.equal(drawer('x', ''), '');
});
