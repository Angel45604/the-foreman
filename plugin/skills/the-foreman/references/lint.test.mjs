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
  // liveRun's ask is ENGINE-DERIVED ('Authorize this live run?' — an engine
  // literal that always passes askShape), so it never counts as missing —
  // with OR without a ledger.liveRun section (lint agrees with the render)
  assert.deepEqual(lintLedger({ meta, liveRun: { what: 'w' } }, 'liveRun'), []);
  assert.deepEqual(lintLedger({ meta }, 'liveRun'), []);
  // a malformed (non-object) meta.ask is NOT an ask source — same askShape gate as the
  // templates — and, being present-but-malformed, it ALSO fires the malformed-ask rule
  assert.deepEqual(lintLedger({ meta: { ...meta, ask: 'approve?' } }, 'decisionCard'),
    ['lint: malformed-ask meta', 'lint: missing-ask meta']);
  // non-gate types never fire it
  assert.deepEqual(lintLedger({ meta }, 'dashboard'), []);
});

// ---- prepr round 1: malformed-ask fires when meta.ask is present but fails askShape ----
test('malformed-ask fires for {}, {note}, {headline:""} — the shapes that used to blank the strip', () => {
  for (const ask of [{}, { note: 'x' }, { headline: '' }, { headline: '   ' }, 'approve?', 7, ['a']]) {
    const out = lintLedger({ meta: { title: 't', verdict: 'v', ask }, decision: { question: 'q' } }, 'decisionCard');
    assert.deepEqual(out, ['lint: malformed-ask meta'], JSON.stringify(ask)); // natural ask present => no missing-ask
  }
});
test('malformed-ask never fires for a well-shaped ask, an absent ask, or a non-gate type without one', () => {
  assert.deepEqual(lintLedger(clean, 'planDeck'), []);
  assert.deepEqual(lintLedger({ meta: { title: 't' }, dashboard: { stats: [] } }, 'dashboard'), []);
  // present-but-malformed fires on NON-gate types too (meta.ask overrides every type's derived ask)
  assert.deepEqual(lintLedger({ meta: { title: 't', ask: {} }, dashboard: { stats: [] } }, 'dashboard'),
    ['lint: malformed-ask meta']);
});

// ---- prepr blocker 1: malformed-decision fires when ledger.decision is present
// but fails decisionShape (the same gate the renderers ride) ----
test('malformed-decision fires for {}, [], blank/whitespace/missing question, and non-objects', () => {
  for (const decision of [{}, [], { question: '' }, { question: '   ' }, { options: [{ label: 'A' }] }, 'q?', 7]) {
    const out = lintLedger({ meta: { title: 't', verdict: 'v', ask: { headline: 'H' } }, decision }, 'decisionCard');
    assert.deepEqual(out, ['lint: malformed-decision decision'], JSON.stringify(decision));
  }
});
test('a malformed decision is NOT an ask source: missing-ask fires alongside malformed-decision', () => {
  assert.deepEqual(lintLedger({ meta: { title: 't', verdict: 'v' }, decision: {} }, 'decisionCard'),
    ['lint: malformed-decision decision', 'lint: missing-ask meta']);
  assert.deepEqual(lintLedger({ meta: { title: 't', verdict: 'v' }, decision: { question: '' } }, 'planDeck'),
    ['lint: malformed-decision decision', 'lint: missing-ask meta']);
});
test('malformed-decision never fires for a well-shaped or absent decision, and fires on non-gate types too', () => {
  assert.deepEqual(lintLedger({ meta: { title: 't', verdict: 'v' }, decision: { question: 'q' } }, 'decisionCard'), []);
  assert.deepEqual(lintLedger({ meta: { title: 't' } }, 'findings'), []);
  // present-but-malformed fires on NON-gate types too (same posture as malformed-ask)
  assert.deepEqual(lintLedger({ meta: { title: 't' }, decision: {}, dashboard: { stats: [] } }, 'dashboard'),
    ['lint: malformed-decision decision']);
});

// ---- prepr blocker: lint's brief ask source rides the same askShape gate the
// renderers ride — a win.next that fails it is NOT an ask, so missing-ask fires
// exactly when the board renders no strip (lint and render agree).
test('brief missing-ask fires when win.next fails askShape (whitespace / non-string)', () => {
  const meta = { title: 't', verdict: 'v' };
  assert.deepEqual(lintLedger({ meta, win: { landed: 'x', next: '   ' } }, 'brief'), ['lint: missing-ask meta']);
  assert.deepEqual(lintLedger({ meta, win: { landed: 'x', next: 42 } }, 'brief'), ['lint: missing-ask meta']);
  assert.deepEqual(lintLedger({ meta, win: { landed: 'x', next: 'ship it' } }, 'brief'), []); // a real ask still counts
});

// ---- prepr blocker: lint/renderer AGREEMENT on liveRun ----
// The canonical liveRun template ALWAYS derives 'Authorize this live run?'
// (even with no ledger.liveRun section — the headline is an engine literal
// that passes askShape unconditionally), but lint used to check truthiness of
// l.liveRun, so a metadata-only liveRun ledger drew a missing-ask warning the
// render itself contradicted. liveRun's ask now counts as always present.
test('liveRun never fires missing-ask: the render always derives the authorize ask', () => {
  // metadata-only ledger — no liveRun section at all
  assert.deepEqual(lintLedger({ meta: { title: 't', verdict: 'v' } }, 'liveRun'), []);
  // an empty liveRun section is just as fine
  assert.deepEqual(lintLedger({ meta: { title: 't', verdict: 'v' }, liveRun: {} }, 'liveRun'), []);
});
test('a malformed meta.ask on liveRun still fires malformed-ask (but never missing-ask)', () => {
  for (const ask of [{}, { note: 'x' }, { headline: '' }, 'approve?']) {
    assert.deepEqual(lintLedger({ meta: { title: 't', verdict: 'v', ask } }, 'liveRun'),
      ['lint: malformed-ask meta'], JSON.stringify(ask));
  }
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
