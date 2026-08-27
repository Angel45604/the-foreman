import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lintLedger } from './lint.mjs';

// A ledger that violates NOTHING for a gate type: verdict present, well-shaped
// ask, keyStats in range, short plain statements.
const clean = {
  meta: {
    title: 't',
    verdict: 'Approve with two fixes',
    ask: { headline: 'Approve the plan?' },
    keyStats: [
      { value: '4', label: 'rounds' },
      { value: '0', label: 'blockers' },
      { value: '12', label: 'files' },
    ],
  },
  slides: [{ statement: 'The gate converged after four rounds' }],
};

test('a clean gate ledger lints to an empty array (pure, no IO)', () => {
  assert.deepEqual(lintLedger(clean, 'planDeck'), []);
});

test('statement-too-long fires on a statement slot past 12 words, with location only', () => {
  const wordy = 'one two three four five six seven eight nine ten eleven twelve thirteen';
  const out = lintLedger({ ...clean, slides: [clean.slides[0], { statement: wordy }] }, 'planDeck');
  assert.deepEqual(out, ['lint: statement-too-long slides[1]']);
  assert.ok(!out.join('\n').includes('thirteen')); // rule + location ONLY, never ledger text
});

test('statement slot falls back to heading (a wordy legacy heading fires too)', () => {
  const wordy = 'a b c d e f g h i j k l m';
  const out = lintLedger({ ...clean, slides: [{ heading: wordy }] }, 'planDeck');
  assert.deepEqual(out, ['lint: statement-too-long slides[0]']);
});

test('code-token-in-statement fires on backticks and on @-notation', () => {
  const tick = lintLedger({ ...clean, slides: [{ statement: 'Run `render.mjs` now' }] }, 'planDeck');
  assert.deepEqual(tick, ['lint: code-token-in-statement slides[0]']);
  const at = lintLedger({ ...clean, slides: [{ statement: 'Uses codex@xhigh here' }] }, 'planDeck');
  assert.deepEqual(at, ['lint: code-token-in-statement slides[0]']);
});

test('a secret-shaped statement never leaks into the messages', () => {
  const secret = 'token sk-ant-api03-deadbeefdeadbeefdead plus enough words to also run past the twelve word cap';
  const out = lintLedger({ ...clean, slides: [{ statement: secret }] }, 'planDeck');
  assert.ok(out.length > 0);
  assert.ok(!out.join('\n').includes('sk-ant'));
  assert.ok(out.every((w) => /^lint: [a-z-]+ [a-z]+(\[\d+\])?$/.test(w))); // rule + location, nothing else
});

test('missing-verdict fires on gate types missing BOTH meta.verdict and meta.subtitle', () => {
  const bare = { meta: { title: 't', ask: { headline: 'H' } }, slides: [] };
  for (const type of ['planDeck', 'brief', 'decisionCard', 'liveRun']) {
    assert.deepEqual(lintLedger(bare, type), ['lint: missing-verdict meta'], type);
  }
  // subtitle alone satisfies the rule (legacy fallback)
  assert.deepEqual(lintLedger({ meta: { title: 't', subtitle: 's', ask: { headline: 'H' } } }, 'planDeck'), []);
  // non-gate types never fire it
  assert.deepEqual(lintLedger(bare, 'findings'), []);
});

test('missing-ask fires on a gate type with neither meta.ask nor a natural ask source', () => {
  const meta = { title: 't', verdict: 'v' };
  assert.deepEqual(lintLedger({ meta }, 'planDeck'), ['lint: missing-ask meta']);
  // each natural source satisfies its type
  assert.deepEqual(lintLedger({ meta, decision: { question: 'q' } }, 'planDeck'), []);
  assert.deepEqual(lintLedger({ meta, decision: { question: 'q' } }, 'decisionCard'), []);
  assert.deepEqual(lintLedger({ meta, win: { landed: 'x', next: 'ship it' } }, 'brief'), []);
  assert.deepEqual(lintLedger({ meta, liveRun: { what: 'w' } }, 'liveRun'), []);
  // a malformed (non-object) meta.ask is NOT an ask source — same askShape gate as the templates
  assert.deepEqual(lintLedger({ meta: { ...meta, ask: 'approve?' } }, 'decisionCard'), ['lint: missing-ask meta']);
  // non-gate types never fire it
  assert.deepEqual(lintLedger({ meta }, 'dashboard'), []);
});

test('keystats-count fires when meta.keyStats is present with length outside 3..5', () => {
  const mk = (n) => ({ meta: { ...clean.meta, keyStats: Array.from({ length: n }, (_, i) => ({ value: String(i), label: 'l' })) }, slides: [] });
  assert.deepEqual(lintLedger(mk(2), 'planDeck'), ['lint: keystats-count meta']);
  assert.deepEqual(lintLedger(mk(6), 'planDeck'), ['lint: keystats-count meta']);
  for (const n of [3, 4, 5]) assert.deepEqual(lintLedger(mk(n), 'planDeck'), [], String(n));
  // absent keyStats never fires
  assert.deepEqual(lintLedger({ meta: { title: 't', verdict: 'v', ask: { headline: 'H' } } }, 'planDeck'), []);
});

test('lintLedger tolerates garbage input without throwing', () => {
  assert.deepEqual(lintLedger(null, 'findings'), []);
  assert.deepEqual(lintLedger(undefined, 'planDeck'),
    ['lint: missing-verdict meta', 'lint: missing-ask meta']);
  assert.deepEqual(lintLedger({ slides: 'not-an-array', meta: 7 }, 'dashboard'), []);
});
