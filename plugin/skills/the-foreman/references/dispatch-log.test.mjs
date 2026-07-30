import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  TIERS, EFFORTS, OUTCOMES,
  validateEntry, stamp, appendEntry, readEntries, stats, formatStats,
} from './dispatch-log.mjs';

const VALID = {
  session: 'stripe-refund-sync', phase: 'P3', shape: 'well-scoped, tests written',
  tier: 'standard', model: 'sonnet', effort: 'medium', why: 'crisp spec + failing tests gate drift',
  outcome: 'ok',
};
const tmpLog = () => join(mkdtempSync(join(tmpdir(), 'dispatch-log-')), 'log.jsonl');

test('validateEntry accepts a complete entry', () => {
  assert.deepEqual(validateEntry(VALID), { ok: true, errors: [] });
});
test('validateEntry is fail-closed on each required field', () => {
  for (const k of ['session', 'shape', 'why', 'model']) {
    for (const bad of [undefined, '', '   ', 42]) {
      const { ok, errors } = validateEntry({ ...VALID, [k]: bad });
      assert.equal(ok, false, `${k}=${JSON.stringify(bad)}`);
      assert.ok(errors.some((e) => e.startsWith(k)), `${k} named in errors`);
    }
  }
});
test('validateEntry pins the durable enums (tier/effort/outcome) but leaves model free-form', () => {
  assert.equal(validateEntry({ ...VALID, tier: 'opus' }).ok, false);       // a model name is NOT a tier
  assert.equal(validateEntry({ ...VALID, effort: 'ultra' }).ok, false);
  assert.equal(validateEntry({ ...VALID, outcome: 'done' }).ok, false);
  assert.equal(validateEntry({ ...VALID, model: 'some-future-model-7' }).ok, true);
  assert.ok(TIERS.includes('deep') && EFFORTS.includes('xhigh') && OUTCOMES.includes('escalated'));
});
test('validateEntry rejects non-objects and typed optionals', () => {
  assert.equal(validateEntry(null).ok, false);
  assert.equal(validateEntry([VALID]).ok, false);
  assert.equal(validateEntry({ ...VALID, phase: 3 }).ok, false);
  assert.equal(validateEntry({ ...VALID, notes: {} }).ok, false);
});
test('stamp prefixes an ISO timestamp without mutating the entry', () => {
  const now = new Date('2026-07-06T12:00:00Z');
  const out = stamp(VALID, now);
  assert.equal(out.ts, '2026-07-06T12:00:00.000Z');
  assert.equal(out.session, VALID.session);
  assert.equal(VALID.ts, undefined);
});
test('appendEntry writes one parseable JSONL line and readEntries round-trips it', () => {
  const path = tmpLog();
  appendEntry(VALID, path, new Date('2026-07-06T12:00:00Z'));
  appendEntry({ ...VALID, outcome: 'redo' }, path);
  const entries = readEntries(path);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].ts, '2026-07-06T12:00:00.000Z');
  assert.equal(entries[1].outcome, 'redo');
});
test('appendEntry is fail-closed: invalid entry throws and writes NOTHING', () => {
  const path = tmpLog();
  assert.throws(() => appendEntry({ ...VALID, tier: 'opus' }, path), /invalid dispatch entry/);
  assert.equal(existsSync(path), false, 'no file created on invalid entry');
});
test('readEntries skips corrupt and invalid lines instead of throwing', () => {
  const path = tmpLog();
  appendEntry(VALID, path);
  const raw = readFileSync(path, 'utf8');
  writeFileSync(path, raw + 'not-json\n' + JSON.stringify({ nope: true }) + '\n');
  assert.equal(readEntries(path).length, 1);
});
test('readEntries returns [] for a missing file', () => {
  assert.deepEqual(readEntries(join(tmpdir(), 'nope', 'missing.jsonl')), []);
});
test('stats aggregates per tier, shape, and tier×shape with nonGreenRate', () => {
  const e = (tier, shape, outcome) => ({ ...VALID, tier, shape, outcome });
  const s = stats([
    e('standard', 'well-scoped', 'ok'), e('standard', 'well-scoped', 'redo'),
    e('standard', 'well-scoped', 'ok'), e('standard', 'well-scoped', 'ok'),
    e('deep', 'judgment-heavy', 'ok'), e('fast', 'mechanical', 'failed'),
  ]);
  assert.equal(s.total, 6);
  assert.equal(s.byTier.standard.n, 4);
  assert.equal(s.byTier.standard.redo, 1);
  assert.equal(s.byTier.standard.nonGreenRate, 0.25);
  assert.equal(s.byTier.deep.nonGreenRate, 0);
  assert.equal(s.byCell['fast × mechanical'].nonGreenRate, 1);
  assert.equal(s.byShape['judgment-heavy'].ok, 1);
});
test('formatStats renders every section and sorts hottest cells first', () => {
  const e = (tier, shape, outcome) => ({ ...VALID, tier, shape, outcome });
  const out = formatStats(stats([e('fast', 'mechanical', 'failed'), e('deep', 'judgment-heavy', 'ok')]));
  assert.match(out, /dispatches: 2/);
  assert.match(out, /-- by tier --/);
  assert.match(out, /-- by tier × shape --/);
  const fastIdx = out.indexOf('fast × mechanical');
  const deepIdx = out.indexOf('deep × judgment-heavy');
  assert.ok(fastIdx !== -1 && deepIdx !== -1 && fastIdx < deepIdx, 'non-green cells sort first');
});
