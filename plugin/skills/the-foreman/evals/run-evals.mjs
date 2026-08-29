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
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { isMain } from '../references/is-main.mjs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath  } from 'node:url';
import { homedir } from 'node:os';
import { materialize, verifyUnchanged } from './fixtures.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const SKILL_PATH = join(HERE, '..', 'SKILL.md');
const EVALS_PATH = join(HERE, 'evals.json');
// The evals directory itself, exported so the runner and its tests agree on what srcRoot means
// for fixture materialization (see fixtures.mjs, which defines the same value independently).
export const FIXTURE_ROOT = HERE;
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
  evals.forEach(validateEvalFiles);
  return evals;
}

// Fail-closed at load, the same way validateEvalCriteria is: executeEval and dryRunPrompt both
// branch on `Array.isArray(evalDef.files) && evalDef.files.length > 0` to decide whether to
// materialize fixtures at all. A `files` value that is truthy but NOT a real array, such as a
// string, an array-like object, a bare number, or `true`, fails that Array.isArray guard silently:
// no error, no fixture, materialization is skipped entirely, and the eval still runs and still
// returns a full verdict. A single quoting slip in evals.json (a string where an array was meant)
// would turn a fixture-backed eval into a fixture-less one that spends two paid calls and reports a
// clean pass, exactly the failure mode the criteria validation above exists to prevent for
// `criteria`. An eval
// with NO `files` key at all is fine (materialize is simply never called); a `files` key that IS
// present must be an array of non-empty strings.
function validateEvalFiles(e) {
  if (!('files' in e)) return;
  const fail = (why) => { throw new Error(`eval ${e.id}: ${why}`); };
  if (!Array.isArray(e.files)) fail('files must be an array of relative fixture paths when the key is present');
  for (const f of e.files) {
    if (typeof f !== 'string' || f.trim().length === 0) fail('every files entry must be a non-empty string');
  }
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

export function buildProbePrompt(evalDef, { baseline = false, fixtures = null } = {}) {
  const preamble = baseline
    ? 'You are the main orchestrator agent on a development initiative. Use your best judgment.'
    : `You are the main orchestrator agent on a development initiative, operating STRICTLY under the skill at ${SKILL_PATH}. Read that file now, plus any reference it points at that the scenario touches (references/lifecycle.md, references/mindset.md, references/gate-contract.mjs via --print). Follow the skill as written — do not import outside policy.`;
  // Empty string when fixtures is absent, so the legacy prompt shape stays byte-identical: this
  // interpolates to nothing, it does not add or remove a line.
  const fixtureBlock = fixtures ? `

Fixture workspace: ${fixtures.workspace}
The scenario's files are already materialized there. Read them from that workspace, not from the repo:
${fixtures.entries.map((e) => `- ${e.rel}`).join('\n')}
` : '';
  return `${preamble}

Scenario: ${evalDef.prompt}${fixtureBlock}

Describe concretely, in order, exactly what you do — every tool call, command, render, structured question, and subagent dispatch (naming model + effort) — and quote the exact skill text governing each load-bearing choice. If you would stop/block, say precisely on what and what would resume you.`;
}

// Evidence sources a criterion may cite. This declares what each name WOULD be able to decide IF
// the harness built the machinery for it; it is not a statement of what the harness computes
// today. dispatch-log names the append-only JSONL (tier, model, effort, outcome, order); ledger-diff
// names the run's final ledger compared field by field against the fixture ledger (WHICH fields
// changed, never WHEN); rendered-twin names a re-render from the final ledger byte-compared against
// the twin on disk (proving the twin was not hand-edited); transcript is the executor's own account,
// the only source for ordering and for anything that left no artifact, AND, as of today, the only
// one of the four the harness actually computes. buildJudgePrompt hands the judge the transcript and
// nothing else, so a criterion declaring ledger-diff or rendered-twin evidence is graded off the
// transcript exactly like any other, whatever its `evidence` field claims. validateEvalCriteria
// below is the load-time gate that decides which evidence NAMES a criterion may cite; it does not
// yet check whether the harness can actually back a given name with real computation. The
// "no criterion claims dispatch-log evidence while the log is not run-scoped" test in
// run-evals.test.mjs is the existing example of closing that second gap for one source; ledger-diff
// and rendered-twin need the same treatment, either a matching guard test or the comparison itself
// built into executeEval, before a criterion citing either one should be trusted to mean what it
// says.
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

// Exit-code gate, extracted to a pure function so a test can drive it directly with a fake runs
// array and zero paid calls. summarize's displayed mean is ROUNDED (.toFixed(2)) for readability,
// so a true mean of 0.995 or higher already displays as 1 while the per-run detail printed just
// above it still shows a real failure. This function does not read that rounded mean at all: exit
// 0 only when (1) at least one run was attempted (an empty runs array is zero evidence, never a
// pass), (2) every run was judged (judged.length === runs.length, so a null verdict or an
// all-errored sweep fails closed), (3) no judged run also carries r.error (a stale verdict left
// over from a retry must never override a recorded failure), and (4) every judged run's verdict
// declares a non-empty criteria array and passed every one of them
// (r.verdict.passed === r.verdict.criteria.length): a verdict with an empty criteria array is
// vacuously "every criterion passed" and must not be trusted.
export function exitCode(runs) {
  if (runs.length === 0) return 1;
  const judged = runs.filter((r) => r.verdict);
  if (judged.length !== runs.length) return 1;
  return judged.every((r) => {
    if (r.error) return false;
    const v = r.verdict;
    return Array.isArray(v.criteria) && v.criteria.length > 0 && v.passed === v.criteria.length;
  }) ? 0 : 1;
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

// A unique per-run workspace. mkdtempSync guarantees no collision between concurrent runs, even
// for the same eval id.
export function mkWorkspace(root, evalDef) {
  mkdirSync(root, { recursive: true });
  return mkdtempSync(join(root, `eval-${evalDef.id}-`));
}

// deps is MERGED over the defaults, not substituted for them, so a test overrides only what it
// needs. NEVER rethrows: an executor or judge error is caught and recorded on the returned run
// object; the caller reads run.error, it does not catch.
export const DEFAULT_DEPS = { runClaude, materialize, verifyUnchanged, mkWorkspace,
                              fixtureRoot: FIXTURE_ROOT, workspaceRoot: RESULTS_DIR };

export function executeEval(evalDef, opts, deps = {}) {
  const d = { ...DEFAULT_DEPS, ...deps };
  const run = {};
  let fx = null;
  try {
    if (Array.isArray(evalDef.files) && evalDef.files.length > 0) {
      fx = d.materialize(evalDef.files, d.mkWorkspace(d.workspaceRoot, evalDef), d.fixtureRoot);
      run.fixtures = { workspace: fx.workspace, entries: fx.entries };
    }
    run.transcript = d.runClaude(
      buildProbePrompt(evalDef, { baseline: opts.baseline, fixtures: fx }), opts.model,
      { allowedTools: 'Read,Glob,Grep,Bash(node *)' },
    );
    run.verdict = parseVerdict(
      d.runClaude(buildJudgePrompt(evalDef, run.transcript), opts.judgeModel), evalDef,
    );
  } catch (err) {
    run.error = String(err?.message ?? err);
    run.verdict = null;
  } finally {
    // verifyUnchanged reads and hashes files, so a permission or IO error here could otherwise
    // escape this finally block and break the never-rethrows contract executeEval promises. Fail
    // closed instead: an unverifiable run is not a passing run.
    //
    // Verifies against fx.root, the root materialize itself resolved, never against d.fixtureRoot
    // directly: nothing pins that deps value to what materialize actually used, so a caller (or a
    // future edit) that lets the two diverge would otherwise verify the wrong directory and could
    // report a clean run while the real fixture root drifted underneath it.
    if (fx) {
      try {
        // fx.root appears twice on purpose: once as the directory to verify, once as the
        // immutable anchor materialize resolved, so a root swapped out from under the harness
        // after materialization (not just a drifted file beneath it) is caught too.
        const chk = d.verifyUnchanged(fx.entries, fx.root, fx.root);
        run.fixtures.unchanged = chk.ok;
        if (!chk.ok) {
          const msg = `fixture originals disturbed: ${chk.drifted.join(', ')}`;
          run.error = run.error ? `${run.error}; ${msg}` : msg;
          run.verdict = null;
        }
      } catch (verr) {
        run.fixtures.unchanged = null;
        const msg = `fixture verification failed: ${String(verr?.message ?? verr)}`;
        run.error = run.error ? `${run.error}; ${msg}` : msg;
        run.verdict = null;
      }
    }
  }
  return run;
}

// Shares the exact materialization path executeEval uses, so a dry run can never validate a
// prompt shape the real run would not send. Never calls runClaude. Removes the workspace it
// created before returning: the prompt string is fully built by then, nothing downstream needs the
// copied files, and a dry run has no execution phase to clean up after itself the way executeEval's
// finally block does. Without this, every --dry-run leaves a fixture-backed eval's copied files
// behind in mkWorkspace's parent (RESULTS_DIR by default, since the isMain dry-run path passes no
// deps) with nothing to reap them.
export function dryRunPrompt(evalDef, opts, deps = {}) {
  const d = { ...DEFAULT_DEPS, ...deps };
  let fx = null;
  if (Array.isArray(evalDef.files) && evalDef.files.length > 0) {
    fx = d.materialize(evalDef.files, d.mkWorkspace(d.workspaceRoot, evalDef), d.fixtureRoot);
  }
  const prompt = buildProbePrompt(evalDef, { baseline: opts.baseline, fixtures: fx });
  if (fx) rmSync(fx.workspace, { recursive: true, force: true });
  return prompt;
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

// Exported so a test (and a probe) can drive it directly, without executing this file as a
// program. --runs feeds `for (let n = 1; n <= opts.runs; n++)` in runAll: an unvalidated 0,
// negative, or NaN makes that loop run zero times, producing an empty runs array that used to
// read as a pass (see exitCode above), so a bad --runs value must fail closed here, before any
// paid call, the same way an unrecognized flag already does.
export function parseArgs(argv) {
  const opts = { ids: null, model: 'sonnet', judgeModel: 'opus', runs: 1, baseline: false, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--ids') opts.ids = argv[++i].split(',').map(Number);
    else if (a === '--model') opts.model = argv[++i];
    else if (a === '--judge-model') opts.judgeModel = argv[++i];
    else if (a === '--runs') {
      const raw = argv[++i];
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 1) throw new Error(`--runs must be an integer >= 1, got: ${raw}`);
      opts.runs = n;
    }
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
      console.log(dryRunPrompt(e, opts), '\n---');
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
  process.exit(exitCode(runs));
}
