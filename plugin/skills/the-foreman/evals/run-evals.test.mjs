import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadEvals, buildProbePrompt, buildJudgePrompt, parseVerdict, summarize, extractCliError, resolveResultsDir, SKILL_PATH } from './run-evals.mjs';
import { homedir } from 'node:os';
import { dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

test('eval results default OUTSIDE any skill checkout (per-user state), env-overridable', () => {
  const def = resolveResultsDir({});
  assert.ok(def.startsWith(homedir() + sep), 'default lives under the user home');
  const skillRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  assert.ok(!def.startsWith(skillRoot + sep), 'default must never target the skill/checkout tree');
  assert.equal(resolveResultsDir({ FOREMAN_EVAL_RESULTS: '/tmp/x' }), '/tmp/x');
});

const EVAL = { id: 10, name: 'dispatch-right-sizing', prompt: 'Three phases: …', expected_output: 'Consults §8; …' };

test('loadEvals reads the real catalog and every eval has the required fields', () => {
  const evals = loadEvals();
  assert.ok(evals.length >= 11);
  for (const e of evals) {
    assert.equal(typeof e.id, 'number');
    for (const k of ['name', 'prompt', 'expected_output']) assert.ok(typeof e[k] === 'string' && e[k].length > 0, `eval ${e.id} ${k}`);
  }
  assert.equal(new Set(evals.map((e) => e.id)).size, evals.length, 'eval ids unique');
});
test('buildProbePrompt points the executor at the skill and demands quoted, ordered, concrete actions', () => {
  const p = buildProbePrompt(EVAL);
  assert.ok(p.includes(SKILL_PATH));
  assert.match(p, /STRICTLY under the skill/);
  assert.match(p, /Scenario: Three phases/);
  assert.match(p, /model \+ effort/);
  assert.match(p, /quote the exact skill text/);
});
test('buildProbePrompt --baseline omits every skill reference (the RED configuration)', () => {
  const p = buildProbePrompt(EVAL, { baseline: true });
  assert.ok(!p.includes('SKILL.md'));
  assert.ok(!p.includes(SKILL_PATH));
  assert.match(p, /best judgment/);
  assert.match(p, /Scenario: Three phases/);
});
test('buildJudgePrompt embeds expected_output and transcript with no-charitable-inference framing', () => {
  const p = buildJudgePrompt(EVAL, 'THE TRANSCRIPT');
  assert.match(p, /No charitable inference/);
  assert.ok(p.includes(EVAL.expected_output));
  assert.ok(p.includes('THE TRANSCRIPT'));
  assert.match(p, /STRICT JSON/);
});
test('parseVerdict accepts clean JSON and recomputes counts from criteria (judge math not trusted)', () => {
  const v = parseVerdict(JSON.stringify({
    criteria: [{ text: 'a', passed: true, evidence: 'x' }, { text: 'b', passed: false, evidence: 'ABSENT' }],
    passed: 99, failed: 99, pass_rate: 99,
  }));
  assert.equal(v.passed, 1);
  assert.equal(v.failed, 1);
  assert.equal(v.pass_rate, 0.5);
});
test('parseVerdict extracts JSON embedded in prose', () => {
  const v = parseVerdict('Here is my verdict:\n{"criteria":[{"text":"a","passed":true,"evidence":"x"}]}\nDone.');
  assert.equal(v.pass_rate, 1);
});
test('parseVerdict is fail-closed on garbage, empty criteria, and malformed criteria', () => {
  assert.equal(parseVerdict('no json here'), null);
  assert.equal(parseVerdict('{"criteria":[]}'), null);
  assert.equal(parseVerdict('{"criteria":[{"text":"a"}]}'), null);
  assert.equal(parseVerdict(undefined), null);
});
test('summarize reports per-run lines, mean over judged runs, and flags unparseable judges + run errors', () => {
  const s = summarize([
    { eval_id: 0, name: 'a', verdict: { pass_rate: 1, passed: 2, criteria: [1, 2] } },
    { eval_id: 1, name: 'b', verdict: { pass_rate: 0.5, passed: 1, criteria: [1, 2] } },
    { eval_id: 2, name: 'c', verdict: null },
    { eval_id: 3, name: 'd', error: 'claude -p failed (model=sonnet): API Error: 401' },
  ]);
  assert.equal(s.mean, 0.75);
  assert.equal(s.judged, 2);
  assert.equal(s.total, 4);
  assert.match(s.lines[2], /JUDGE-UNPARSEABLE/);
  assert.match(s.lines[3], /RUN-ERROR: .*401/);
});
test('extractCliError pulls the API error out of the CLI JSON envelope, fail-closed otherwise', () => {
  const envelope = JSON.stringify({ type: 'result', is_error: true, result: 'API Error: 401 {"type":"error"}' });
  assert.match(extractCliError(envelope), /API Error: 401/);
  assert.equal(extractCliError('not json'), null);
  assert.equal(extractCliError(JSON.stringify({ is_error: false, result: 'fine' })), null);
});
