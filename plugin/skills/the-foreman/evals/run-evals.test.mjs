import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadEvals, buildProbePrompt, buildJudgePrompt, parseVerdict, summarize, extractCliError, resolveResultsDir, SKILL_PATH, executeEval, runAll } from './run-evals.mjs';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, sep, join } from 'node:path';
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

const CRIT_EVAL = {
  id: 99, name: 'rubric-shape', prompt: 'x', expected_output: 'y',
  criteria: [
    { id: 'c1', text: 'dispatches a fresh subagent naming model and effort', kind: 'deterministic', evidence: 'dispatch-log' },
    { id: 'c2', text: 'the rewrite preserves meaning', kind: 'semantic', evidence: 'transcript' },
  ],
};
const body = (crits) => JSON.stringify({ criteria: crits });

test('buildJudgePrompt emits the declared criterion IDs, their evidence sources, and forbids re-segmentation', () => {
  const p = buildJudgePrompt(CRIT_EVAL, 'some transcript');
  assert.match(p, /"c1"/, 'the prompt must name criterion c1');
  assert.match(p, /"c2"/, 'the prompt must name criterion c2');
  assert.match(p, /dispatch-log/, 'the prompt must name c1 evidence source');
  assert.doesNotMatch(p, /split it into its individual clauses/,
    'a fixed-rubric eval must not tell the judge to segment for itself');
});

test('parseVerdict rejects an undeclared criterion ID', () => {
  assert.equal(parseVerdict(body([
    { id: 'c1', text: 'a', passed: true }, { id: 'c9', text: 'b', passed: true },
  ]), CRIT_EVAL), null);
});

test('parseVerdict rejects an omitted criterion ID', () => {
  assert.equal(parseVerdict(body([{ id: 'c1', text: 'a', passed: true }]), CRIT_EVAL), null);
});

test('parseVerdict rejects a duplicated criterion ID even though the set matches', () => {
  assert.equal(parseVerdict(body([
    { id: 'c1', text: 'a', passed: true },
    { id: 'c1', text: 'a', passed: true },
    { id: 'c2', text: 'b', passed: true },
  ]), CRIT_EVAL), null, 'c1,c1,c2 has the same SET as c1,c2 but a different denominator');
});

test('parseVerdict rejects a reordered criterion array', () => {
  assert.equal(parseVerdict(body([
    { id: 'c2', text: 'b', passed: true }, { id: 'c1', text: 'a', passed: true },
  ]), CRIT_EVAL), null, 'order is part of the declared contract');
});

test('parseVerdict rejects a numeric criterion id even when both sides match it', () => {
  // declared and returned are BOTH the number 1, the only input that distinguishes the
  // `typeof id === 'string'` guard from the JSON.stringify(returned) === JSON.stringify(declared)
  // comparison, since a same-type mismatch (string vs number) would already fail the stringify
  // check on its own.
  const numericIdEval = { id: 100, name: 'numeric-id', criteria: [{ id: 1, text: 'a' }] };
  assert.equal(parseVerdict(JSON.stringify({ criteria: [{ id: 1, text: 'a', passed: true }] }), numericIdEval), null);
});

test('parseVerdict rejects a declared rubric with duplicate ids', () => {
  const declared = { id: 1, name: 'x', criteria: [
    { id: 'c1', text: 'a', kind: 'semantic', evidence: 'transcript' },
    { id: 'c1', text: 'b', kind: 'semantic', evidence: 'transcript' }] };
  const body = JSON.stringify({ criteria: [
    { id: 'c1', text: 'a', passed: true }, { id: 'c1', text: 'b', passed: true }] });
  assert.equal(parseVerdict(body, declared), null,
    'a duplicated declared id must fail closed even when the judge mirrors it exactly');
});

test('parseVerdict rejects a declared rubric with an empty or blank id', () => {
  for (const badId of ['', '   ']) {
    const declared = { id: 1, name: 'x', criteria: [
      { id: badId, text: 'a', kind: 'semantic', evidence: 'transcript' }] };
    const body = JSON.stringify({ criteria: [{ id: badId, text: 'a', passed: true }] });
    assert.equal(parseVerdict(body, declared), null,
      `declared id ${JSON.stringify(badId)} must fail closed`);
  }
});

test('parseVerdict accepts the exact declared ID sequence and recomputes the arithmetic', () => {
  const v = parseVerdict(body([
    { id: 'c1', text: 'a', passed: true }, { id: 'c2', text: 'b', passed: false },
  ]), CRIT_EVAL);
  assert.equal(v.passed, 1);
  assert.equal(v.failed, 1);
  assert.equal(v.pass_rate, 0.5);
});

test('parseVerdict keeps its old free-form behavior when the eval declares no criteria', () => {
  const v = parseVerdict(body([{ text: 'a', passed: true }]), { id: 1, name: 'legacy' });
  assert.equal(v.pass_rate, 1);
});

test('a real fixed-rubric run is unparseable when the judge returns an undeclared ID', () => {
  const calls = [];
  const transcript = 'executor transcript';
  const fake = (prompt, model, opts) => {
    calls.push({ prompt, model, opts });
    return calls.length === 1
      ? transcript
      : body([{ id: 'c1', text: 'a', passed: true }, { id: 'zz', text: 'b', passed: true }]);
  };
  const run = executeEval(CRIT_EVAL, { model: 'm', judgeModel: 'j' }, { runClaude: fake });
  assert.equal(run.verdict, null, 'the runner must not accept an undeclared ID');
  assert.equal(calls.length, 2, 'executor then judge');
  assert.match(calls[0].prompt, /Scenario:/, 'the executor call goes first');
  assert.equal(calls[0].opts.allowedTools, 'Read,Glob,Grep,Bash(node *)');
  assert.equal(calls[0].model, 'm');
  assert.equal(calls[1].model, 'j');
  assert.match(calls[1].prompt, /executor transcript/, 'the executor transcript must reach the judge prompt verbatim');
});

test('a real fixed-rubric run parses when the judge returns the exact declared sequence', () => {
  const calls = [];
  const transcript = 'executor transcript';
  const fake = (prompt, model, opts) => {
    calls.push({ prompt, model, opts });
    return (opts && opts.allowedTools)
      ? transcript
      : body([{ id: 'c1', text: 'a', passed: true }, { id: 'c2', text: 'b', passed: true }]);
  };
  const run = executeEval(CRIT_EVAL, { model: 'm', judgeModel: 'j' }, { runClaude: fake });
  assert.equal(run.verdict.pass_rate, 1);
  assert.equal(calls.length, 2, 'executor then judge');
  assert.match(calls[0].prompt, /Scenario:/, 'the executor call goes first');
  assert.equal(calls[0].opts.allowedTools, 'Read,Glob,Grep,Bash(node *)');
  assert.equal(calls[0].model, 'm');
  assert.equal(calls[1].model, 'j');
  assert.match(calls[1].prompt, /executor transcript/, 'the executor transcript must reach the judge prompt verbatim');
});

test('executeEval never rethrows an executor error', () => {
  const run = executeEval({ id: 1, name: 'x', prompt: 'p', expected_output: 'e' },
    { model: 'm', judgeModel: 'j' },
    { runClaude: () => { throw new Error('executor exploded'); } });
  assert.match(run.error, /executor exploded/);
  assert.equal(run.verdict, null);
});

test('runAll wires each run through executeEval with the eval\'s own criteria (the isMain loop itself has no test coverage, so this is what catches a revert to a stale one-argument parseVerdict)', () => {
  const calls = [];
  const transcript = 'executor transcript';
  const fake = (prompt, model, opts) => {
    calls.push({ prompt, model, opts });
    return (opts && opts.allowedTools)
      ? transcript
      : body([{ id: 'c1', text: 'a', passed: true }, { id: 'zz', text: 'b', passed: true }]);
  };
  const runs = runAll([CRIT_EVAL], { runs: 1, model: 'm', judgeModel: 'j' }, { runClaude: fake });
  assert.equal(runs.length, 1);
  assert.equal(runs[0].verdict, null, 'an undeclared judge criterion id must fail closed, not silently pass');
  assert.equal(runs[0].eval_id, CRIT_EVAL.id);
  assert.equal(runs[0].run_number, 1);
  assert.equal(runs[0].configuration, 'with_skill');
});

test('loadEvals throws when a declared criteria key is malformed (fail-closed at load, before any paid call)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'foreman-evals-'));
  const fixturePath = join(dir, 'evals.json');
  writeFileSync(fixturePath, JSON.stringify({
    evals: [{ id: 42, name: 'bad', prompt: 'p', expected_output: 'e', criteria: null }],
  }));
  assert.throws(() => loadEvals(fixturePath), /eval 42/);

  const blankIdPath = join(dir, 'evals-blank-id.json');
  writeFileSync(blankIdPath, JSON.stringify({
    evals: [{
      id: 45, name: 'blank-id', prompt: 'p', expected_output: 'e',
      criteria: [{ id: '   ', text: 'x', kind: 'deterministic', evidence: 'dispatch-log' }],
    }],
  }));
  assert.throws(() => loadEvals(blankIdPath), /eval 45/,
    'a whitespace-only id is not a non-empty string id, loadEvals and parseVerdict must agree on this');
});

test('loadEvals accepts an eval with no criteria key at all (legacy path stays fine)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'foreman-evals-'));
  const fixturePath = join(dir, 'evals.json');
  writeFileSync(fixturePath, JSON.stringify({
    evals: [{ id: 43, name: 'legacy', prompt: 'p', expected_output: 'e' }],
  }));
  assert.equal(loadEvals(fixturePath).length, 1);
});

test('loadEvals accepts a well-formed criteria rubric', () => {
  const dir = mkdtempSync(join(tmpdir(), 'foreman-evals-'));
  const fixturePath = join(dir, 'evals.json');
  writeFileSync(fixturePath, JSON.stringify({
    evals: [{
      id: 44, name: 'good', prompt: 'p', expected_output: 'e',
      criteria: [{ id: 'c1', text: 'x', kind: 'deterministic', evidence: 'dispatch-log' }],
    }],
  }));
  const evals = loadEvals(fixturePath);
  assert.equal(evals.length, 1);
  assert.equal(evals[0].criteria[0].id, 'c1');
});

test('parseVerdict fails closed when a declared criteria key is malformed', () => {
  const body = JSON.stringify({ criteria: [{ id: 'a', text: 'x', passed: true }] });
  for (const bad of [[], null, 'c1,c2', {}, [null], [42], [{ text: 'no id' }]]) {
    assert.equal(parseVerdict(body, { id: 1, name: 'x', criteria: bad }), null,
      `declared criteria ${JSON.stringify(bad)} must fail closed, never grade`);
  }
});

test('parseVerdict still takes the legacy path when no criteria key is present at all', () => {
  const body = JSON.stringify({ criteria: [{ text: 'a', passed: true }] });
  assert.equal(parseVerdict(body, { id: 1, name: 'legacy' }).pass_rate, 1);
  assert.equal(parseVerdict(body, {}).pass_rate, 1);
  assert.equal(parseVerdict(body).pass_rate, 1);
});
