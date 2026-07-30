import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildRequest, writeRequest, checkResponse } from './escalation.mjs';

const mkdir = () => mkdtempSync(join(tmpdir(), 'foreman-esc-'));
const planQuestions = [
  { id: 'plan', prompt: 'Approve the plan?', options: ['approve', 'request-changes'] },
  { id: 'local-commits', prompt: 'Authorize scoped per-phase LOCAL commits?', options: ['no', 'yes'] },
];
const baseReq = (over = {}) => buildRequest({ requestId: 'R1', gateId: 'plan-approval',
  questions: planQuestions, authorizes: 'approve the plan + commit authorization',
  createdAt: '2026-06-22T00:00:00Z', ...over });
const writeRes = (d, obj) => writeFileSync(join(d, 'escalations', 'R1.response.json'), JSON.stringify(obj));

test('buildRequest validates requestId (safe token), gateId, and ≥1 well-formed question', () => {
  assert.throws(() => buildRequest({ gateId: 'g', questions: planQuestions }), /requestId/);
  assert.throws(() => buildRequest({ requestId: 'a/b', gateId: 'g', questions: planQuestions }), /requestId/);
  assert.throws(() => buildRequest({ requestId: 'R', questions: planQuestions }), /gateId/);
  assert.throws(() => buildRequest({ requestId: 'R', gateId: 'g', questions: [] }), /question/);
  assert.throws(() => buildRequest({ requestId: 'R', gateId: 'g', questions: [{ id: 'q', options: [] }] }), /options/);
  assert.throws(() => buildRequest({ requestId: 'R', gateId: 'g', questions: [{ id: 'q', options: ['a'] }, { id: 'q', options: ['b'] }] }), /unique/);
  assert.equal(baseReq().questions.length, 2);
});
test('writeRequest writes under escalations/<id>.request.json and returns the path', async () => {
  const d = mkdir(); const p = await writeRequest(d, baseReq());
  assert.equal(p, join(d, 'escalations', 'R1.request.json'));
  assert.ok(existsSync(p)); assert.match(readFileSync(p, 'utf8'), /plan-approval/);
});
test('writeRequest is FAIL-CLOSED: refuses to write a secret-shaped payload', async () => {
  const d = mkdir();
  await assert.rejects(() => writeRequest(d, baseReq({ authorizes: 'use sk-ant-api03-deadbeefdeadbeefdeadbeef now' })),
    /fail.?closed|secret/i);
  assert.equal(existsSync(join(d, 'escalations', 'R1.request.json')), false);
});
test('checkResponse: no response yet → pending (STOP, never advance)', async () => {
  const d = mkdir(); await writeRequest(d, baseReq());
  assert.deepEqual(await checkResponse(d, 'R1'), { status: 'pending' });
});
test('checkResponse: ALL required questions answered with allowed options → answered AND deleted (read-once)', async () => {
  const d = mkdir(); await writeRequest(d, baseReq());
  writeRes(d, { requestId: 'R1', answers: { plan: 'approve', 'local-commits': 'no' } });
  const r = await checkResponse(d, 'R1');
  assert.deepEqual(r, { status: 'answered', answers: { plan: 'approve', 'local-commits': 'no' } });
  assert.equal(existsSync(join(d, 'escalations', 'R1.response.json')), false);
  assert.deepEqual(await checkResponse(d, 'R1'), { status: 'pending' });
});
test('checkResponse: INCOMPLETE multi-decision answer → invalid, NOT deleted', async () => {
  const d = mkdir(); await writeRequest(d, baseReq());
  const rp = join(d, 'escalations', 'R1.response.json');
  writeRes(d, { requestId: 'R1', answers: { plan: 'approve' } });
  assert.equal((await checkResponse(d, 'R1')).status, 'invalid');
  assert.ok(existsSync(rp));
});
test('checkResponse: option not in a question’s allowed set → invalid', async () => {
  const d = mkdir(); await writeRequest(d, baseReq());
  writeRes(d, { requestId: 'R1', answers: { plan: 'ship-it-now', 'local-commits': 'no' } });
  assert.equal((await checkResponse(d, 'R1')).status, 'invalid');
});
test('checkResponse: unknown question id → invalid', async () => {
  const d = mkdir(); await writeRequest(d, baseReq());
  writeRes(d, { requestId: 'R1', answers: { plan: 'approve', 'local-commits': 'no', bogus: 'x' } });
  assert.equal((await checkResponse(d, 'R1')).status, 'invalid');
});
test('checkResponse: requestId mismatch → invalid, not deleted', async () => {
  const d = mkdir(); await writeRequest(d, baseReq());
  const rp = join(d, 'escalations', 'R1.response.json');
  writeRes(d, { requestId: 'WRONG', answers: { plan: 'approve', 'local-commits': 'no' } });
  assert.equal((await checkResponse(d, 'R1')).status, 'invalid');
  assert.ok(existsSync(rp));
});
test('checkResponse: unknown request (no request file) → invalid', async () => {
  const d = mkdir();
  assert.equal((await checkResponse(d, 'NOPE')).status, 'invalid');
});
test('buildRequest rejects an all-optional request (never advance on an empty decision)', () => {
  assert.throws(() => buildRequest({ requestId: 'R', gateId: 'g',
    questions: [{ id: 'q', options: ['a'], required: false }] }), /required/);
});
test('writeRequest re-validates shape: rejects a raw all-optional or missing-question request', async () => {
  const d = mkdir();
  await assert.rejects(() => writeRequest(d, { requestId: 'R1', gateId: 'g',
    questions: [{ id: 'q', options: ['a'], required: false }] }), /required/);
  await assert.rejects(() => writeRequest(d, { requestId: 'R1', gateId: 'g' }), /question/);
  assert.equal(existsSync(join(d, 'escalations')), false);
});
test('path safety: writeRequest rejects an unsafe requestId BEFORE touching the fs', async () => {
  const d = mkdir();
  await assert.rejects(() => writeRequest(d, { requestId: '../escape', gateId: 'g',
    questions: [{ id: 'q', options: ['a'], required: true }] }), /requestId/);
  assert.equal(existsSync(join(d, 'escalations')), false);
});
test('path safety: checkResponse rejects an unsafe requestId (invalid, no fs)', async () => {
  const d = mkdir();
  assert.equal((await checkResponse(d, '../escape')).status, 'invalid');
});
test('checkResponse FAILS CLOSED on a malformed PERSISTED request (planted, bypassing writeRequest)', async () => {
  const d = mkdir(); mkdirSync(join(d, 'escalations'), { recursive: true });
  writeFileSync(join(d, 'escalations', 'R1.request.json'), JSON.stringify(
    { requestId: 'R1', gateId: 'g', questions: [{ id: 'q', options: ['a'], required: false }] }));
  writeRes(d, { requestId: 'R1', answers: { q: 'a' } });
  const r = await checkResponse(d, 'R1');
  assert.equal(r.status, 'invalid'); assert.match(r.reason, /malformed/);
});
test('checkResponse: persisted request whose embedded requestId ≠ the filename → invalid, not deleted', async () => {
  const d = mkdir(); mkdirSync(join(d, 'escalations'), { recursive: true });
  writeFileSync(join(d, 'escalations', 'R1.request.json'), JSON.stringify(
    { requestId: 'R2', gateId: 'g', questions: [{ id: 'q', options: ['a'], required: true }] }));
  const rp = join(d, 'escalations', 'R1.response.json');
  writeFileSync(rp, JSON.stringify({ requestId: 'R1', answers: { q: 'a' } }));
  const r = await checkResponse(d, 'R1');
  assert.equal(r.status, 'invalid'); assert.match(r.reason, /mismatch/);
  assert.ok(existsSync(rp));
});
test('checkResponse FAILS CLOSED on a planted persisted request containing a secret (read-path scan)', async () => {
  const d = mkdir(); mkdirSync(join(d, 'escalations'), { recursive: true });
  // a structurally-valid request planted on disk (bypassing writeRequest's scan) with a secret in authorizes
  writeFileSync(join(d, 'escalations', 'R1.request.json'), JSON.stringify(
    { requestId: 'R1', gateId: 'g', authorizes: 'token sk-ant-api03-deadbeefdeadbeefdeadbeef',
      questions: [{ id: 'q', options: ['a'], required: true }] }));
  writeRes(d, { requestId: 'R1', answers: { q: 'a' } });
  const r = await checkResponse(d, 'R1');
  assert.equal(r.status, 'invalid'); assert.match(r.reason, /fail.?closed|secret|persisted request contains/i);
});
test('buildRequest rejects non-string question ids and non-string options', () => {
  assert.throws(() => buildRequest({ requestId: 'R', gateId: 'g', questions: [{ id: 5, options: ['a'] }] }), /string id/);
  assert.throws(() => buildRequest({ requestId: 'R', gateId: 'g', questions: [{ id: 'q', options: [1, 2] }] }), /string options/);
});
test('a required question id colliding with a prototype prop ("toString") is reported MISSING, not mis-validated', async () => {
  const d = mkdir();
  await writeRequest(d, buildRequest({ requestId: 'R1', gateId: 'g',
    questions: [{ id: 'toString', options: ['a'], required: true }, { id: 'real', options: ['x'], required: true }] }));
  writeRes(d, { requestId: 'R1', answers: { real: 'x' } }); // 'toString' genuinely absent as an OWN key
  const r = await checkResponse(d, 'R1');
  assert.equal(r.status, 'invalid');
  assert.match(r.reason, /missing required answer: toString/); // the `in` operator would have mis-validated via the prototype
});
test('checkResponse FAILS CLOSED on a response with a secret-shaped VALUE — categories only, value never echoed', async () => {
  const d = mkdir(); await writeRequest(d, baseReq());
  writeRes(d, { requestId: 'R1', answers: { plan: 'sk-ant-api03-deadbeefdeadbeefdeadbeef', 'local-commits': 'no' } });
  const r = await checkResponse(d, 'R1');
  assert.equal(r.status, 'invalid');
  assert.match(r.reason, /fail.?closed|secret|response contains/i);
  assert.doesNotMatch(r.reason, /sk-ant-api03/); // the untrusted secret value is NOT echoed
});
test('checkResponse FAILS CLOSED on a response whose question KEY is secret-shaped (value never echoed)', async () => {
  const d = mkdir(); await writeRequest(d, baseReq());
  writeRes(d, { requestId: 'R1', answers: { 'sk-ant-api03-deadbeefdeadbeefdeadbeef': 'x', plan: 'approve', 'local-commits': 'no' } });
  const r = await checkResponse(d, 'R1');
  assert.equal(r.status, 'invalid');
  assert.doesNotMatch(r.reason, /sk-ant-api03/);
});
test('checkResponse FAILS CLOSED on a secret hidden behind JSON \\u escapes (scan runs POST-parse)', async () => {
  const d = mkdir(); await writeRequest(d, baseReq());
  // 's' written as s — a RAW-text scan misses 'sk-ant-…'; after JSON.parse it becomes the real secret
  const hidden = '\\u0073k-ant-api03-deadbeefdeadbeefdeadbeef';
  writeFileSync(join(d, 'escalations', 'R1.response.json'),
    `{"requestId":"R1","answers":{"plan":"${hidden}","local-commits":"no"}}`);
  const r = await checkResponse(d, 'R1');
  assert.equal(r.status, 'invalid');
  assert.match(r.reason, /fail.?closed|secret|response contains/i);
  assert.doesNotMatch(r.reason, /sk-ant-api03/);
});
test('checkResponse FAILS CLOSED on a duplicate-key response hiding a secret in the DROPPED key', async () => {
  const d = mkdir(); await writeRequest(d, baseReq());
  // duplicate "plan": JSON.parse keeps the LAST ("approve"); the secret in the first is dropped by parse
  // but still present in the raw file — the raw portion of the scan must catch it.
  writeFileSync(join(d, 'escalations', 'R1.response.json'),
    `{"requestId":"R1","answers":{"plan":"sk-ant-api03-deadbeefdeadbeefdeadbeef","plan":"approve","local-commits":"no"}}`);
  const r = await checkResponse(d, 'R1');
  assert.equal(r.status, 'invalid');
  assert.match(r.reason, /fail.?closed|secret|response contains/i);
});
test('checkResponse FAILS CLOSED on a secret that is BOTH \\u-escaped AND in a DROPPED duplicate key', async () => {
  const d = mkdir(); await writeRequest(d, baseReq());
  const esc = '\\u0073k-ant-api03-deadbeefdeadbeefdeadbeef'; // \\u0073='s'; the first "plan" is dropped by JSON.parse
  writeFileSync(join(d, 'escalations', 'R1.response.json'),
    `{"requestId":"R1","answers":{"plan":"${esc}","plan":"approve","local-commits":"no"}}`);
  const r = await checkResponse(d, 'R1');
  // raw-text scan misses it (escaped); post-parse scan misses it (dropped) — only the escape-resolved raw catches it
  assert.equal(r.status, 'invalid');
  assert.match(r.reason, /fail.?closed|secret|response contains/i);
});
test('checkResponse FAILS CLOSED on a db-url secret hidden behind escaped solidus (\\/)', async () => {
  const d = mkdir(); await writeRequest(d, baseReq());
  // db url with each / as \/ (valid JSON) and a DOT-LESS host (@localhost) so ONLY the db_url pattern can
  // match — never email_pii — isolating the \/ resolution: raw misses '://'; resolveJsonEscapes unmasks it.
  writeFileSync(join(d, 'escalations', 'R1.response.json'),
    `{"requestId":"R1","answers":{"plan":"postgres:\\/\\/u:p4ssword@localhost","local-commits":"no"}}`);
  const r = await checkResponse(d, 'R1');
  assert.equal(r.status, 'invalid');
  assert.match(r.reason, /fail.?closed|secret|response contains/i); // db_url_with_creds, only after \/ resolution
});
