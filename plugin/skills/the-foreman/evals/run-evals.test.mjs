import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadEvals, buildProbePrompt, buildJudgePrompt, parseVerdict, summarize, extractCliError, resolveResultsDir, SKILL_PATH, executeEval, runAll, EVIDENCE_SOURCES, exitCode, parseArgs } from './run-evals.mjs';
import { writeFileSync, mkdtempSync, readFileSync } from 'node:fs';
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
    assert.ok(Array.isArray(e.files), `eval ${e.id} files must be an array`);
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

// Pinned as full [id, kind, evidence] triples, not just id sequence: an id-only pin lets a future
// edit silently re-promote a criterion's kind or evidence (e.g. dispatch-logged-once back to
// deterministic/dispatch-log) without failing a single test, since the id list would still match.
const E12_CRITERIA = [
  ['dispatch-logged-once', 'semantic', 'transcript'],
  ['dispatch-fresh-and-named', 'semantic', 'transcript'],
  ['ledger-fields-untouched', 'deterministic', 'ledger-diff'],
  ['refiner-given-only-allowed-fields', 'semantic', 'transcript'],
  ['ledger-before-render', 'semantic', 'transcript'],
  ['render-once-after-refine', 'semantic', 'transcript'],
  ['surfaced', 'semantic', 'transcript'],
  ['blocked-on-question', 'semantic', 'transcript'],
  ['never-inline', 'semantic', 'transcript'],
  ['no-premature-handoff-surfacing', 'semantic', 'transcript'],
  ['twin-never-hand-edited', 'semantic', 'transcript'],
];
const E13_CRITERIA = [
  ['handoff-two-dispatches-logged', 'semantic', 'transcript'],
  ['handoff-dispatches-fresh-and-named', 'semantic', 'transcript'],
  ['handoff-one-subagent-per-file', 'semantic', 'transcript'],
  ['findings-applied-before-handoff', 'semantic', 'transcript'],
  ['hand-to-user-after-approval', 'semantic', 'transcript'],
  ['twin-matches-ledger', 'deterministic', 'rendered-twin'],
  ['twin-never-hand-edited', 'semantic', 'transcript'],
];

test('eval 12 is the pre-approval case, pinned to its exact criterion sequence', () => {
  const e = loadEvals().find((x) => x.id === 12);
  assert.ok(e, 'eval 12 must exist');
  assert.deepEqual(e.criteria.map((c) => [c.id, c.kind, c.evidence]), E12_CRITERIA);
  assert.match(e.prompt, /has not been approved/);
  assert.equal(e.resumedBy, 13, 'eval 12 must name its resumed case');
});

// eval 12's expected_output is legacy narrative text: buildJudgePrompt never sends it to the judge
// once criteria is declared, so it grades nothing, but it still documents the eval's contract for a
// human reader. Before this test it was left byte-identical to the pre-split, whole-flow contract
// (dispatch through handoff), which now falsely claims eval 12 covers ground that belongs solely to
// eval 13's resumed, post-approval case.
test('eval 12 expected_output is trimmed to the pre-approval half and never mentions the handoff doc', () => {
  const e = loadEvals().find((x) => x.id === 12);
  assert.doesNotMatch(e.expected_output, /handoff doc/);
  assert.match(e.expected_output, /AskUserQuestion/);
});

test('eval 13 is the resumed post-approval case, pinned and linked back', () => {
  const e = loadEvals().find((x) => x.id === 13);
  assert.ok(e, 'eval 13 must exist');
  assert.deepEqual(e.criteria.map((c) => [c.id, c.kind, c.evidence]), E13_CRITERIA);
  assert.equal(e.resumes, 12, 'eval 13 must name the case it resumes');
  assert.match(e.prompt, /has just been approved/);
  assert.match(e.prompt, /handoff doc and kickoff prompt are drafted/);
  assert.match(e.prompt, /Review passes have not/);
});

test('the eval 12 and eval 13 linkage is mutual and consistent', () => {
  const evals = loadEvals();
  const e12 = evals.find((x) => x.id === 12);
  const e13 = evals.find((x) => x.id === 13);
  assert.equal(evals.find((x) => x.id === e12.resumedBy).resumes, e12.id);
  assert.equal(evals.find((x) => x.id === e13.resumes).resumedBy, e13.id);
});

test('every declared criterion has a unique id, a known kind, and a known evidence source', () => {
  // Read the catalog directly, bypassing loadEvals: validateEvalCriteria enforces these same four
  // rules and THROWS inside loadEvals on any violation, so going through loadEvals would make this
  // test's own per-rule assertions unreachable: a violation would surface as loadEvals's own throw,
  // never as one of the assert.ok calls below. Reading the file directly checks the catalog
  // independently of the loader.
  const catalogPath = join(dirname(fileURLToPath(import.meta.url)), 'evals.json');
  const evals = JSON.parse(readFileSync(catalogPath, 'utf8')).evals;
  for (const e of evals) {
    if (!e.criteria) continue;
    const ids = e.criteria.map((c) => c.id);
    assert.equal(new Set(ids).size, ids.length, `eval ${e.id} ids must be unique`);
    for (const c of e.criteria) {
      assert.ok(['deterministic', 'semantic'].includes(c.kind), `eval ${e.id}/${c.id} kind`);
      assert.ok(EVIDENCE_SOURCES.includes(c.evidence), `eval ${e.id}/${c.id} evidence source`);
      assert.ok(typeof c.text === 'string' && c.text.length > 0, `eval ${e.id}/${c.id} text`);
    }
  }
});

test('no criterion claims dispatch-log evidence while the log is not run-scoped', () => {
  for (const e of loadEvals()) {
    for (const c of e.criteria ?? []) {
      assert.notEqual(c.evidence, 'dispatch-log',
        `${e.id}/${c.id}: the dispatch log is a durable per-user file the runner does not scope to a run, so a count over it cannot decide a criterion. Promote only after run-scoped isolation exists.`);
    }
  }
});

// Owner-approved addition folded into Task 3 at the Task 2 boundary (not in the written plan):
// summarize's displayed mean is ROUNDED (.toFixed(2)), so a true mean of 0.995 or higher displays
// as 1 while the per-run detail above it still shows a real failure. The old isMain gate exited 0
// whenever s.mean === 1, trusting that rounded number instead of the raw per-run verdicts. This
// test proves the rounding is real (summarize(runs).mean is 1) and that the gate no longer trusts
// it (exitCode(runs) is non-zero because one judged run did not pass every one of its criteria).
test('exitCode gates on every judged run passing every one of its criteria, not on the rounded mean', () => {
  const fullPass = (i) => ({ eval_id: i, name: `eval-${i}`, verdict: { pass_rate: 1, passed: 4, criteria: Array(4).fill(0) } });
  const runs = [
    ...Array.from({ length: 13 }, (_, i) => fullPass(i)),
    { eval_id: 13, name: 'eval-13', verdict: { pass_rate: 0.95, passed: 19, criteria: Array(20).fill(0) } },
  ];
  assert.equal(summarize(runs).mean, 1, 'rounding really does round 13.95/14 up to a displayed 1');
  assert.equal(exitCode(runs), 1, 'the gate must not trust the rounded mean when a run failed a criterion');
});

test('exitCode returns 1 on an empty runs array (zero evidence must never read as a pass)', () => {
  assert.equal(exitCode([]), 1);
});

test('exitCode returns 0 for a perfect run, for contrast with the empty-array case', () => {
  const runs = [{ eval_id: 0, name: 'a', verdict: { passed: 3, criteria: [1, 2, 3] } }];
  assert.equal(exitCode(runs), 0);
});

test('exitCode returns 1 when a run carries a null verdict', () => {
  assert.equal(exitCode([{ eval_id: 0, name: 'a', verdict: null }]), 1);
});

test('exitCode returns 1 for a mixed judged and unjudged array', () => {
  const judged = { eval_id: 0, name: 'a', verdict: { passed: 2, criteria: [1, 2] } };
  const unjudged = { eval_id: 1, name: 'b', verdict: null };
  assert.equal(exitCode([judged, unjudged]), 1);
});

test('exitCode returns 1 for an all-errored sweep (no verdict was ever produced)', () => {
  const runs = [
    { eval_id: 0, name: 'a', error: 'claude -p failed', verdict: null },
    { eval_id: 1, name: 'b', error: 'claude -p failed', verdict: null },
  ];
  assert.equal(exitCode(runs), 1);
});

test('exitCode returns 1 for a run carrying both an error and a stale truthy verdict', () => {
  // A stale verdict left over from a prior attempt must never override a recorded error, even when
  // that stale verdict looks like a perfect pass on its own.
  const runs = [
    { eval_id: 0, name: 'a', error: 'timed out on retry', verdict: { passed: 4, criteria: [1, 2, 3, 4] } },
  ];
  assert.equal(exitCode(runs), 1);
});

test('exitCode returns 1 when a verdict declares an empty criteria array (vacuously "every criterion passed")', () => {
  const runs = [{ eval_id: 0, name: 'a', verdict: { passed: 0, criteria: [] } }];
  assert.equal(exitCode(runs), 1);
});

test('parseArgs rejects --runs 0, a negative --runs, and a non-numeric --runs', () => {
  for (const bad of ['0', '-1', 'abc']) {
    assert.throws(() => parseArgs(['--runs', bad]), /--runs must be an integer >= 1/, `--runs ${bad} must throw`);
  }
});

test('parseArgs accepts a valid --runs and leaves other defaults alone', () => {
  const opts = parseArgs(['--runs', '3']);
  assert.equal(opts.runs, 3);
});
