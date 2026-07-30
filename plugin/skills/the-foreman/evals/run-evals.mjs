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
  return JSON.parse(readFileSync(path, 'utf8')).evals;
}

export function buildProbePrompt(evalDef, { baseline = false } = {}) {
  const preamble = baseline
    ? 'You are the main orchestrator agent on a development initiative. Use your best judgment.'
    : `You are the main orchestrator agent on a development initiative, operating STRICTLY under the skill at ${SKILL_PATH}. Read that file now, plus any reference it points at that the scenario touches (references/lifecycle.md, references/mindset.md, references/gate-contract.mjs via --print). Follow the skill as written — do not import outside policy.`;
  return `${preamble}

Scenario: ${evalDef.prompt}

Describe concretely, in order, exactly what you do — every tool call, command, render, structured question, and subagent dispatch (naming model + effort) — and quote the exact skill text governing each load-bearing choice. If you would stop/block, say precisely on what and what would resume you.`;
}

export function buildJudgePrompt(evalDef, transcript) {
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

// Fail-closed: returns null unless a JSON object with a well-formed criteria[] is found.
export function parseVerdict(text) {
  if (typeof text !== 'string') return null;
  const candidates = [];
  try { candidates.push(JSON.parse(text)); } catch { /* fall through to embedded-JSON scan */ }
  const m = text.match(/\{[\s\S]*\}/);
  if (m) { try { candidates.push(JSON.parse(m[0])); } catch { /* ignore */ } }
  for (const v of candidates) {
    if (!v || !Array.isArray(v.criteria) || v.criteria.length === 0) continue;
    if (!v.criteria.every((c) => typeof c.text === 'string' && typeof c.passed === 'boolean')) continue;
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
  const runs = [];
  for (const e of evals) {
    for (let n = 1; n <= opts.runs; n++) {
      const base = { eval_id: e.id, name: e.name, run_number: n, configuration: opts.baseline ? 'without_skill' : 'with_skill' };
      process.stderr.write(`eval ${e.id} (${e.name}) run ${n}/${opts.runs}: executor…`);
      const t0 = Date.now();
      try {
        const transcript = runClaude(buildProbePrompt(e, { baseline: opts.baseline }), opts.model, { allowedTools: 'Read,Glob,Grep,Bash(node *)' });
        process.stderr.write(' judge…');
        const verdict = parseVerdict(runClaude(buildJudgePrompt(e, transcript), opts.judgeModel));
        process.stderr.write(` done (${Math.round((Date.now() - t0) / 1000)}s)\n`);
        runs.push({ ...base, transcript, verdict });
      } catch (err) {
        process.stderr.write(' ERROR\n');
        runs.push({ ...base, error: String(err?.message ?? err) });
      }
    }
  }

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
