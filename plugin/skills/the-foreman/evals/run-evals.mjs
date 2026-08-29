// Behavioral eval runner for the-foreman (evals/evals.json).
//
// Harness style: PROBE-BASED. The executor agent reads the skill and DESCRIBES, concretely and in
// order, what it would do for the scenario (every tool call, render, question, dispatch with
// model+effort, quoting governing skill text); a judge then grades that description against the
// eval's expected_output, clause by clause, strict-JSON verdict. This is the same probe pattern
// that discriminated RED→GREEN during the §8/mindset work. Limitation (ADR-009): it grades
// described behavior, not executed behavior — a full-execution harness (sandboxed HOME +
// --permission-mode acceptEdits) is the upgrade path if described-vs-actual ever diverges.
//
// Requires a logged-in `claude` CLI. COSTS REAL TOKENS: 2 calls per eval per run
// (executor + judge). Default: executor=sonnet (well-scoped, the prompt is the gate),
// judge=opus (adversarial verification at a gate runs deep — §8).
//
// usage: node run-evals.mjs [--ids 0,3,10] [--model sonnet] [--judge-model opus]
//                           [--runs 1] [--baseline] [--dry-run]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { isMain } from '../references/is-main.mjs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath  } from 'node:url';
import { homedir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
export const SKILL_PATH = join(HERE, '..', 'SKILL.md');
const EVALS_PATH = join(HERE, 'evals.json');
// Results are per-user runtime state (they carry transcripts) — NEVER written inside the skill dir,
// which may live in a shared repo checkout; env-overridable for tests/CI. Exported as a function so
// the default-location invariant is directly testable.
export function resolveResultsDir(env = process.env) {
  return env.FOREMAN_EVAL_RESULTS ?? join(homedir(), '.claude', 'the-foreman', 'eval-results');
}
const RESULTS_DIR = resolveResultsDir();
const CLAUDE_TIMEOUT_MS = 10 * 60 * 1000;

export function loadEvals(path = EVALS_PATH) {
  const evals = JSON.parse(readFileSync(path, 'utf8')).evals;
  evals.forEach(validateEvalCriteria);
  return evals;
}

// Fail-closed at load, before any paid call: buildJudgePrompt and parseVerdict both branch on the
// TRUTHINESS of evalDef.criteria, so a malformed value (e.g. `criteria: null`) must never reach
// them, since that would silently drop a strict eval to the permissive legacy path and could report
// pass_rate 1 on a rubric that never actually ran. An eval with NO `criteria` key at all is legacy
// and fine; a `criteria` key that IS present must be a well-formed, ID-unique rubric.
function validateEvalCriteria(e) {
  if (!('criteria' in e)) return;
  const fail = (why) => { throw new Error(`eval ${e.id}: ${why}`); };
  if (!Array.isArray(e.criteria) || e.criteria.length === 0) fail('criteria must be a non-empty array when the key is present');
  const seen = new Set();
  for (const c of e.criteria) {
    if (typeof c !== 'object' || c === null) fail('every criterion must be an object');
    if (typeof c.id !== 'string' || c.id.trim().length === 0) fail('every criterion needs a non-empty string id');
    if (seen.has(c.id)) fail(`duplicate criterion id "${c.id}"`);
    seen.add(c.id);
    if (typeof c.text !== 'string' || c.text.length === 0) fail(`criterion "${c.id}" needs a non-empty string text`);
    if (c.kind !== 'deterministic' && c.kind !== 'semantic') fail(`criterion "${c.id}" kind must be 'deterministic' or 'semantic'`);
    if (!EVIDENCE_SOURCES.includes(c.evidence)) fail(`criterion "${c.id}" evidence must be one of: ${EVIDENCE_SOURCES.join(', ')}`);
  }
}

export function buildProbePrompt(evalDef, { baseline = false } = {}) {
  const preamble = baseline
    ? 'You are the main orchestrator agent on a development initiative. Use your best judgment.'
    : `You are the main orchestrator agent on a development initiative, operating STRICTLY under the skill at ${SKILL_PATH}. Read that file now, plus any reference it points at that the scenario touches (references/lifecycle.md, references/mindset.md, references/gate-contract.mjs via --print). Follow the skill as written — do not import outside policy.`;
  return `${preamble}

Scenario: ${evalDef.prompt}

Describe concretely, in order, exactly what you do — every tool call, command, render, structured question, and subagent dispatch (naming model + effort) — and quote the exact skill text governing each load-bearing choice. If you would stop/block, say precisely on what and what would resume you.`;
}

// Evidence sources a criterion may cite. Each names what can actually decide it: dispatch-log is
// the append-only JSONL (tier, model, effort, outcome, order); ledger-diff is the run's final
// ledger compared field by field against the fixture ledger (WHICH fields changed, never WHEN);
// rendered-twin is a re-render from the final ledger byte-compared against the twin on disk (the
// twin was not hand-edited); transcript is the executor's own account, the only source for
// ordering and for anything that left no artifact.
export const EVIDENCE_SOURCES = Object.freeze(['dispatch-log', 'ledger-diff', 'rendered-twin', 'transcript']);

export function buildJudgePrompt(evalDef, transcript) {
  if (evalDef.criteria) {
    return `You are a strict eval judge for an agent-skill test. No charitable inference: a criterion passes ONLY if the transcript explicitly demonstrates it.

Expected behavior for scenario "${evalDef.name}" is graded against this fixed, ID-keyed rubric. Return exactly one entry per declared ID below, in the declared order, adding none and omitting none. Each entry also names the evidence source that can actually decide it:
<criteria>
${JSON.stringify(evalDef.criteria, null, 2)}
</criteria>

The agent's transcript:
<transcript>
${transcript}
</transcript>

Output STRICT JSON only, no prose before or after:
{"criteria":[{"id":"<id>","text":"<clause>","passed":true|false,"evidence":"<verbatim transcript fragment or 'ABSENT'>"}],"passed":<n>,"failed":<n>,"pass_rate":<0..1>}`;
  }
  return `You are a strict eval judge for an agent-skill test. No charitable inference: a criterion passes ONLY if the transcript explicitly demonstrates it.

Expected behavior for scenario "${evalDef.name}" — split it into its individual clauses and grade EACH separately:
<expected>
${evalDef.expected_output}
</expected>

The agent's transcript:
<transcript>
${transcript}
</transcript>

Output STRICT JSON only — no prose before or after:
{"criteria":[{"text":"<clause>","passed":true|false,"evidence":"<verbatim transcript fragment or 'ABSENT'>"}],"passed":<n>,"failed":<n>,"pass_rate":<0..1>}`;
}

// Fail-closed: returns null, never throws, in three distinct states. (1) The `criteria` key is
// ABSENT from evalDef (or explicitly undefined): legacy free-form path, unchanged, no ID check.
// (2) The `criteria` key is PRESENT and well formed (non-empty array of objects, each with a
// non-blank string id, all ids unique): strict sequence comparison, requiring the returned
// criteria IDs to equal the declared IDs exactly, same length, same order, no duplicates, no
// extras, no omissions. (3) The `criteria` key is PRESENT but malformed (missing entirely covers
// state 1 only; anything else, such as `criteria: null`, `[]`, a non-array, an array with a
// non-object or id-less entry, an empty/whitespace-only id, or a duplicate id, is state 3): return
// null immediately, before ever touching the judge's JSON, so a malformed declaration can never
// fall through to the permissive legacy path and grade whatever the judge invented. The
// blank/duplicate check mirrors loadEvals's own criteria validation independently (defense in
// depth, same rule at two layers), since parseVerdict is exported and callers may hand it an
// evalDef that never passed through loadEvals.
export function parseVerdict(text, evalDef) {
  if (typeof text !== 'string') return null;
  const candidates = [];
  try { candidates.push(JSON.parse(text)); } catch { /* fall through to embedded-JSON scan */ }
  const m = text.match(/\{[\s\S]*\}/);
  if (m) { try { candidates.push(JSON.parse(m[0])); } catch { /* ignore */ } }

  const declaresCriteria = evalDef != null && typeof evalDef === 'object'
    && 'criteria' in evalDef && evalDef.criteria !== undefined;
  let declared = null;
  if (declaresCriteria) {
    const c = evalDef.criteria;
    if (!Array.isArray(c) || c.length === 0) return null;
    if (!c.every((x) => x != null && typeof x === 'object' && typeof x.id === 'string')) return null;
    const ids = c.map((x) => x.id);
    // Mirror the rule loadEvals already enforces on write, independently, on read: a blank id or a
    // duplicate id must fail closed here too, since parseVerdict is exported and its contract is a
    // no-duplicates fail-closed parser regardless of whether loadEvals ever ran on this evalDef
    // (e.g. a caller constructs one directly, as the tests below do).
    if (ids.some((id) => id.trim() === '')) return null;
    if (new Set(ids).size !== ids.length) return null;
    declared = ids;
  }

  for (const v of candidates) {
    if (!v || !Array.isArray(v.criteria) || v.criteria.length === 0) continue;
    if (!v.criteria.every((c) => typeof c === 'object' && c !== null && typeof c.text === 'string' && typeof c.passed === 'boolean')) continue;
    if (declared) {
      const returned = v.criteria.map((c) => c.id);
      if (!returned.every((id) => typeof id === 'string')) continue;
      if (JSON.stringify(returned) !== JSON.stringify(declared)) continue;
    }
    const passed = v.criteria.filter((c) => c.passed).length;
    return { criteria: v.criteria, passed, failed: v.criteria.length - passed, pass_rate: +(passed / v.criteria.length).toFixed(2) };
  }
  return null;
}

export function summarize(runs) {
  const ok = runs.filter((r) => r.verdict);
  const lines = runs.map((r) => {
    if (r.error) return `eval ${String(r.eval_id).padEnd(3)} ${r.name.padEnd(38)} RUN-ERROR: ${r.error}`;
    const v = r.verdict;
    return v
      ? `eval ${String(r.eval_id).padEnd(3)} ${r.name.padEnd(38)} pass_rate=${v.pass_rate} (${v.passed}/${v.criteria.length})`
      : `eval ${String(r.eval_id).padEnd(3)} ${r.name.padEnd(38)} JUDGE-UNPARSEABLE`;
  });
  const mean = ok.length ? +(ok.reduce((a, r) => a + r.verdict.pass_rate, 0) / ok.length).toFixed(2) : 0;
  return { lines, mean, judged: ok.length, total: runs.length };
}

const AUTH_HINT = ' — hint: a 401 here usually means the `claude` CLI login is stale (run `claude` interactively and `/login`), or a nested session inherited ANTHROPIC_BASE_URL without its token.';

// The CLI reports API failures as is_error inside its JSON result (sometimes with exit 1) —
// extract that message so a failed eval reads as one line, not a stack trace.
export function extractCliError(stdoutText) {
  try {
    const p = JSON.parse(stdoutText);
    if (p && p.is_error && typeof p.result === 'string') return p.result;
  } catch { /* not JSON — fall through */ }
  return null;
}

function decorate(msg, model) {
  return `claude -p failed (model=${model}): ${msg}${/\b401\b/.test(msg) ? AUTH_HINT : ''}`;
}

function runClaude(prompt, model, { allowedTools } = {}) {
  const args = ['-p', prompt, '--model', model, '--output-format', 'json'];
  if (allowedTools) args.push('--allowedTools', allowedTools);
  let out;
  try {
    out = execFileSync('claude', args, { timeout: CLAUDE_TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024, encoding: 'utf8' });
  } catch (err) {
    throw new Error(decorate(extractCliError(err.stdout ?? '') ?? String(err.message).split('\n')[0], model));
  }
  const parsed = JSON.parse(out);
  if (parsed.is_error) throw new Error(decorate(String(parsed.result), model));
  if (typeof parsed.result !== 'string') throw new Error(decorate('no result string in CLI output', model));
  return parsed.result;
}

// deps is MERGED over the defaults, not substituted for them, so a test overrides only what it
// needs. NEVER rethrows: an executor or judge error is caught and recorded on the returned run
// object; the caller reads run.error, it does not catch.
export const DEFAULT_DEPS = { runClaude };

export function executeEval(evalDef, opts, deps = {}) {
  const d = { ...DEFAULT_DEPS, ...deps };
  const run = {};
  try {
    run.transcript = d.runClaude(
      buildProbePrompt(evalDef, { baseline: opts.baseline }), opts.model,
      { allowedTools: 'Read,Glob,Grep,Bash(node *)' },
    );
    run.verdict = parseVerdict(
      d.runClaude(buildJudgePrompt(evalDef, run.transcript), opts.judgeModel), evalDef,
    );
  } catch (err) {
    run.error = String(err?.message ?? err);
    run.verdict = null;
  }
  return run;
}

// Per-run loop body, extracted so it is directly testable (see resolveResultsDir for the same
// idiom). The isMain block below has zero test coverage on its own, so the wiring that matters,
// executeEval called with the eval's own criteria and not some stale one-argument parseVerdict,
// lives here where a test can drive it with an injected fake and catch a regression.
export function runAll(evals, opts, deps = {}) {
  const runs = [];
  for (const e of evals) {
    for (let n = 1; n <= opts.runs; n++) {
      const base = { eval_id: e.id, name: e.name, run_number: n, configuration: opts.baseline ? 'without_skill' : 'with_skill' };
      process.stderr.write(`eval ${e.id} (${e.name}) run ${n}/${opts.runs}: executor… judge…`);
      const t0 = Date.now();
      const run = executeEval(e, opts, deps);
      // Attribute the outcome to whichever call actually failed: no transcript means the executor
      // itself never returned; a transcript plus an error means the executor succeeded and the
      // judge call is what failed. Otherwise this is the ordinary success line.
      if (run.error) process.stderr.write(run.transcript === undefined ? ' EXECUTOR-ERROR\n' : ' JUDGE-ERROR\n');
      else process.stderr.write(` done (${Math.round((Date.now() - t0) / 1000)}s)\n`);
      runs.push({ ...base, ...run });
    }
  }
  return runs;
}

function parseArgs(argv) {
  const opts = { ids: null, model: 'sonnet', judgeModel: 'opus', runs: 1, baseline: false, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--ids') opts.ids = argv[++i].split(',').map(Number);
    else if (a === '--model') opts.model = argv[++i];
    else if (a === '--judge-model') opts.judgeModel = argv[++i];
    else if (a === '--runs') opts.runs = Number(argv[++i]);
    else if (a === '--baseline') opts.baseline = true;
    else if (a === '--dry-run') opts.dryRun = true;
    else throw new Error(`unknown arg: ${a}`);
  }
  return opts;
}

if (isMain(import.meta.url)) {
  const opts = parseArgs(process.argv.slice(2));
  const evals = loadEvals().filter((e) => !opts.ids || opts.ids.includes(e.id));
  if (evals.length === 0) { console.error('no evals matched --ids'); process.exit(2); }

  if (opts.dryRun) {
    for (const e of evals) {
      console.log(`# eval ${e.id} (${e.name}) — executor=${opts.model}, judge=${opts.judgeModel}, baseline=${opts.baseline}`);
      console.log(buildProbePrompt(e, { baseline: opts.baseline }), '\n---');
    }
    process.exit(0);
  }

  const startedAt = new Date().toISOString();
  const runs = runAll(evals, opts);

  const s = summarize(runs);
  mkdirSync(RESULTS_DIR, { recursive: true });
  const outPath = join(RESULTS_DIR, `run-${startedAt.replace(/[:.]/g, '-')}.json`);
  writeFileSync(outPath, JSON.stringify({
    metadata: { skill_name: 'the-foreman', executor_model: opts.model, analyzer_model: opts.judgeModel, timestamp: startedAt, evals_run: evals.map((e) => e.id), runs_per_configuration: opts.runs, configuration: opts.baseline ? 'without_skill' : 'with_skill' },
    runs,
  }, null, 2));
  console.log(s.lines.join('\n'));
  console.log(`mean pass_rate=${s.mean} (${s.judged}/${s.total} judged) → ${outPath}`);
  process.exit(s.judged === s.total && s.mean === 1 ? 0 : 1);
}
