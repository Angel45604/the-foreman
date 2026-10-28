import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, statSync, symlinkSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync, execFileSync } from 'node:child_process';

const CLI = join(dirname(fileURLToPath(import.meta.url)), 'continuity.mjs');
const WRAPPER = join(dirname(CLI), '../../codex-gate/codex-gate.sh');
const START = '<!-- foreman-resume:start -->';
const END = '<!-- foreman-resume:end -->';
const git = (repo, ...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
const parsed = (result) => { assert.ok(result.stdout.trim(), result.stderr); return JSON.parse(result.stdout); };
const fixture = (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'continuity spaces '));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const repo = join(dir, 'repo space');
  mkdirSync(repo);
  git(repo, 'init', '-q');
  for (const name of ['tracked.txt', 'deleted.txt', 'staged.txt']) writeFileSync(join(repo, name), 'original\n');
  git(repo, 'add', '.');
  git(repo, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'baseline');
  const handoff = join(repo, 'handoff.md');
  const statePath = join(repo, 'state.json');
  const evidence = join(repo, 'verification.log');
  writeFileSync(evidence, 'Observed expected failing assertion, exit 1\n');
  writeFileSync(handoff, '# Authored handoff\n\nKeep this prose exactly.\n');
  const state = {
    initiativeId: 'port', sourceHost: 'claude', stage: 'execution', phase: 'phase-1',
    nextAction: 'Implement the already approved change after expected RED',
    scope: { approved: ['continuity helper'], nonGoals: ['shipping'], neverStage: ['local-only.txt'] },
    verification: { lastGreen: null, current: { command: 'node --test feature.test.mjs', result: 'expected-red',
      provenance: { host: 'claude', kind: 'artifact', reference: 'verification.log' } } },
    authorizations: [], pendingGate: null, workers: [], evidence: ['verification.log'],
  };
  const capture = () => {
    writeFileSync(statePath, JSON.stringify(state));
    return run('capture', repo, statePath, handoff);
  };
  return { dir, repo, handoff, statePath, evidence, state, capture, check: () => run('check', handoff, repo) };
};
const checkpoint = (handoff) => JSON.parse(readFileSync(handoff, 'utf8').split(START)[1].split(END)[0]);
const mutateCheckpoint = (handoff, mutate) => {
  const cp = checkpoint(handoff); mutate(cp);
  const raw = readFileSync(handoff, 'utf8');
  writeFileSync(handoff, raw.slice(0, raw.indexOf(START)) + START + '\n' + JSON.stringify(cp) + '\n' + END + raw.slice(raw.indexOf(END) + END.length));
};
const snapshot = (f) => {
  const runs = join(f.dir, 'old review runs');
  writeFileSync(join(f.repo, 'tracked.txt'), 'phase baseline\n');
  rmSync(join(f.repo, 'deleted.txt'));
  const result = spawnSync('bash', [WRAPPER, 'phase-start', f.state.phase], { cwd: f.repo, encoding: 'utf8',
    env: { ...process.env, CODEX_GATE_RUNS: runs, CODEX_GATE_SESSION: 'old-session', CODEX_BIN: '/never-call-live-reviewer' } });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const rundir = result.stdout.match(/^RUNDIR=(.+)$/m)?.[1];
  const head = result.stdout.match(/^PHASE_HEAD=(.+)$/m)?.[1];
  assert.ok(rundir && head, result.stdout);
  const manifest = join(rundir, 'snapshot.json');
  f.state.review = { CODEX_GATE_RUNS: runs, CODEX_GATE_SESSION: 'old-session', phaseId: f.state.phase,
    phaseStartSnapshot: manifest, PHASE_HEAD: head, verdict: null };
  return { manifest, baseline: join(rundir, 'snapshot', 'tracked.txt') };
};

test('capture preserves authored prose and validates dirty/index/untracked/deleted work with paths containing spaces', (t) => {
  const f = fixture(t);
  writeFileSync(join(f.repo, 'tracked.txt'), 'dirty\n');
  writeFileSync(join(f.repo, 'staged.txt'), 'staged\n'); git(f.repo, 'add', 'staged.txt');
  writeFileSync(join(f.repo, 'staged.txt'), 'unstaged too\n');
  writeFileSync(join(f.repo, 'new file.txt'), 'untracked\n'); rmSync(join(f.repo, 'deleted.txt'));
  const prose = readFileSync(f.handoff, 'utf8');
  const result = f.capture(); assert.equal(result.status, 0, result.stderr);
  assert.ok(readFileSync(f.handoff, 'utf8').startsWith(prose));
  const cp = checkpoint(f.handoff);
  assert.equal(cp.version, 1); assert.equal(cp.state.verification.current.result, 'expected-red');
  assert.equal(cp.repository.files.find((x) => x.path === 'deleted.txt').worktree.kind, 'missing');
  assert.ok(cp.repository.files.some((x) => x.path === 'new file.txt'));
  assert.equal(parsed(f.check()).status, 'validated');
  assert.equal(readFileSync(join(f.repo, 'tracked.txt'), 'utf8'), 'dirty\n');
});

test('read-only check detects worktree, index, branch, HEAD and new untracked drift', (t) => {
  for (const change of ['worktree', 'index', 'branch', 'HEAD', 'untracked']) {
    const f = fixture(t); assert.equal(f.capture().status, 0);
    if (change === 'worktree') writeFileSync(join(f.repo, 'tracked.txt'), 'changed');
    if (change === 'index') { writeFileSync(join(f.repo, 'tracked.txt'), 'changed'); git(f.repo, 'add', 'tracked.txt'); writeFileSync(join(f.repo, 'tracked.txt'), 'original\n'); }
    if (change === 'branch') git(f.repo, 'checkout', '-qb', 'different');
    if (change === 'HEAD') git(f.repo, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-qm', 'new head');
    if (change === 'untracked') writeFileSync(join(f.repo, 'later file.txt'), 'new');
    const before = readFileSync(f.handoff); const index = readFileSync(join(f.repo, '.git', 'index'));
    const check = f.check(); assert.equal(parsed(check).status, 'changed', change); assert.equal(check.status, 1);
    assert.deepEqual(readFileSync(f.handoff), before); assert.deepEqual(readFileSync(join(f.repo, '.git', 'index')), index);
  }
});

test('evidence missing and changed are distinct; capture refuses missing evidence without modifying output', (t) => {
  const f = fixture(t); assert.equal(f.capture().status, 0);
  writeFileSync(f.evidence, 'drift'); assert.equal(parsed(f.check()).status, 'changed');
  rmSync(f.evidence); assert.equal(parsed(f.check()).status, 'missing');
  const before = readFileSync(f.handoff); assert.equal(f.capture().status, 2); assert.deepEqual(readFileSync(f.handoff), before);
});

test('original runtime bindings and snapshot survive round trip and missing baseline never becomes empty', (t) => {
  const f = fixture(t); const s = snapshot(f); const original = readFileSync(s.manifest); const baseline = readFileSync(s.baseline);
  f.state.authorizations = [
    { gate: 'plan', scope: 'helper', status: 'granted', request: 'Approve helper?', response: 'I approve the helper', provenance: { host: 'claude', kind: 'native', reference: 'verification.log' } },
    { gate: 'commit', scope: 'helper', status: 'pending', request: 'Commit helper?', response: null, provenance: { host: 'claude', kind: 'native', reference: 'verification.log' } },
  ];
  f.state.findings = ['Review finding still unresolved'];
  assert.equal(f.capture().status, 0);
  const first = checkpoint(f.handoff);
  f.state.sourceHost = 'codex'; assert.equal(f.capture().status, 0);
  f.state.sourceHost = 'claude'; assert.equal(f.capture().status, 0);
  assert.equal(checkpoint(f.handoff).state.initiativeId, first.state.initiativeId);
  assert.deepEqual(checkpoint(f.handoff).state.review, first.state.review);
  assert.deepEqual(checkpoint(f.handoff).state.authorizations, first.state.authorizations);
  assert.deepEqual(checkpoint(f.handoff).state.findings, first.state.findings);
  assert.equal(parsed(f.check()).pendingAuthorizations, 1);
  assert.equal(parsed(f.check()).status, 'validated');
  assert.deepEqual(readFileSync(s.manifest), original); assert.deepEqual(readFileSync(s.baseline), baseline);
  rmSync(s.baseline); assert.equal(parsed(f.check()).status, 'missing');
  const before = readFileSync(f.handoff); assert.equal(f.capture().status, 2); assert.deepEqual(readFileSync(f.handoff), before);
});

test('snapshot manifest drift, invalid traversal and missing review bindings fail closed', (t) => {
  const f = fixture(t); const s = snapshot(f); assert.equal(f.capture().status, 0);
  writeFileSync(s.manifest, readFileSync(s.manifest, 'utf8') + '\n'); assert.equal(parsed(f.check()).status, 'changed');
  writeFileSync(s.manifest, JSON.stringify({ phaseHead: f.state.review.PHASE_HEAD, repoRoot: f.repo, entries: [{ path: '../escape', baselineKind: 'snapshot' }] }));
  assert.equal(f.capture().status, 2);
  delete f.state.review.CODEX_GATE_SESSION; assert.equal(f.capture().status, 2);
});

test('pending gates remain pending and active workers prevent capture', (t) => {
  const f = fixture(t);
  f.state.pendingGate = { gate: 'phase-boundary', request: 'Continue phase?', scope: 'phase-2' };
  f.state.workers = [{ id: 'worker-1', status: 'joined' }];
  assert.equal(f.capture().status, 0); assert.equal(parsed(f.check()).pendingGate.gate, 'phase-boundary');
  f.state.workers[0].status = 'running'; const before = readFileSync(f.handoff);
  assert.equal(f.capture().status, 2); assert.deepEqual(readFileSync(f.handoff), before);
});

test('legacy is read-only; malformed duplicate unsupported or incomplete blocks are invalid', (t) => {
  const f = fixture(t); const prose = readFileSync(f.handoff);
  assert.equal(parsed(f.check()).status, 'legacy'); assert.deepEqual(readFileSync(f.handoff), prose);
  for (const text of [START, START + '\n{}\n' + END, START + '\n{broken}\n' + END, START + '\n{"version":99}\n' + END, START + END + START + END]) {
    writeFileSync(f.handoff, text); const result = f.check(); assert.equal(parsed(result).status, 'invalid'); assert.equal(result.status, 2);
    assert.equal(f.capture().status, 2); assert.equal(readFileSync(f.handoff, 'utf8'), text);
  }
});

test('malformed state, forged receipt shapes and tampered fingerprint inventories cannot validate', (t) => {
  const f = fixture(t); assert.equal(f.capture().status, 0);
  mutateCheckpoint(f.handoff, (cp) => { cp.repository.files = []; });
  assert.notEqual(parsed(f.check()).status, 'validated');
  f.state.authorizations = [{ gate: 'plan', scope: 'helper', status: 'granted', request: 'Approve?', response: 'yes', provenance: {} }];
  assert.equal(f.capture().status, 2);
});

test('authorizations require evidence and consumed file escalation receipts remain auditable without replay', (t) => {
  const f = fixture(t);
  const receiptPath = join(f.repo, 'accepted-receipt.json');
  const receipt = { requestId: 'req-1', acceptedAt: '2026-10-28T12:00:00Z',
    request: { requestId: 'req-1', gateId: 'plan', authorizes: 'helper', questions: [{ id: 'approve', prompt: 'Approve helper?', options: ['yes', 'no'], required: true }] },
    result: { status: 'answered', answers: { approve: 'yes' } } };
  writeFileSync(receiptPath, JSON.stringify(receipt));
  f.state.authorizations = [{ gate: 'plan', scope: 'helper', status: 'granted', request: 'Approve helper?', response: 'yes',
    provenance: { host: 'claude', kind: 'file-escalation', reference: 'accepted-receipt.json', requestId: 'req-1' } }];
  const initial = f.capture(); assert.equal(initial.status, 0, initial.stdout); assert.equal(parsed(f.check()).status, 'validated');
  assert.equal(readFileSync(receiptPath, 'utf8'), JSON.stringify(receipt));
  receipt.result.answers.approve = 'manufactured'; writeFileSync(receiptPath, JSON.stringify(receipt));
  assert.equal(f.capture().status, 2);
});

test('secret scanning covers authored prose, state, escaped and dropped duplicate values; errors never echo secrets', (t) => {
  const f = fixture(t); const secret = 'sk-' + 'a'.repeat(30);
  for (const location of ['prose', 'state', 'escaped', 'duplicate']) {
    writeFileSync(f.handoff, location === 'prose' ? '# Handoff\n' + secret : '# Handoff\n');
    writeFileSync(f.statePath, JSON.stringify({ ...f.state, nextAction: location === 'state' ? secret : 'continue' }));
    if (location === 'escaped') writeFileSync(f.statePath, readFileSync(f.statePath, 'utf8').replace('continue', [...secret].map((c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')).join('')));
    if (location === 'duplicate') writeFileSync(f.statePath, '{"nextAction":"' + secret + '",' + JSON.stringify(f.state).slice(1));
    const before = readFileSync(f.handoff); const result = run('capture', f.repo, f.statePath, f.handoff);
    assert.equal(result.status, 2); assert.ok(!(result.stdout + result.stderr).includes(secret)); assert.deepEqual(readFileSync(f.handoff), before);
  }
});

test('check rejects malformed required nested fields and does not run commands', (t) => {
  const f = fixture(t); f.state.verification.current.command = 'touch must-not-run'; assert.equal(f.capture().status, 0);
  const before = statSync(f.handoff).mtimeMs; assert.equal(parsed(f.check()).status, 'validated');
  assert.equal(statSync(f.handoff).mtimeMs, before);
  assert.equal(existsSync(join(f.repo, 'must-not-run')), false);
  mutateCheckpoint(f.handoff, (cp) => { cp.state.verification.current.provenance = null; });
  assert.equal(parsed(f.check()).status, 'invalid');
});

test('recapture cannot bless a changed original phase baseline or switch review namespaces', (t) => {
  const f = fixture(t); const s = snapshot(f); assert.equal(f.capture().status, 0);
  const before = readFileSync(f.handoff); writeFileSync(s.baseline, 'new baseline hides in-flight changes');
  assert.equal(f.capture().status, 2); assert.deepEqual(readFileSync(f.handoff), before);
  writeFileSync(s.baseline, 'phase baseline\n');
  f.state.review.CODEX_GATE_RUNS = join(f.dir, 'new-defaults');
  assert.equal(f.capture().status, 2); assert.deepEqual(readFileSync(f.handoff), before);
});

test('symlink target changes and index-only transitions are detected', (t) => {
  const f = fixture(t); symlinkSync('tracked.txt', join(f.repo, 'link.txt'));
  assert.equal(f.capture().status, 0); rmSync(join(f.repo, 'link.txt')); symlinkSync('staged.txt', join(f.repo, 'link.txt'));
  assert.equal(parsed(f.check()).status, 'changed');
  const g = fixture(t); writeFileSync(join(g.repo, 'tracked.txt'), 'dirty'); assert.equal(g.capture().status, 0);
  git(g.repo, 'add', 'tracked.txt'); assert.equal(parsed(g.check()).status, 'changed');
});

test('receipt for another gate/scope cannot be attached as provenance for a granted decision', (t) => {
  const f = fixture(t);
  writeFileSync(join(f.repo, 'receipt.json'), JSON.stringify({ requestId: 'r', acceptedAt: '2026-10-28T12:00:00Z',
    request: { requestId: 'r', gateId: 'plan', authorizes: 'helper', questions: [{ id: 'a', prompt: 'Approve?', options: ['yes'], required: true }] },
    result: { status: 'answered', answers: { a: 'yes' } } }));
  f.state.authorizations = [{ gate: 'commit', scope: 'shipping', status: 'granted', request: 'Commit?', response: 'yes',
    provenance: { host: 'claude', kind: 'file-escalation', reference: 'receipt.json', requestId: 'r' } }];
  const before = readFileSync(f.handoff); assert.equal(f.capture().status, 2); assert.deepEqual(readFileSync(f.handoff), before);
});

test('malformed input diagnostics identify schema fields without echoing untrusted contents', (t) => {
  const f = fixture(t); f.state.nextAction = 42;
  const result = f.capture(); assert.equal(result.status, 2); assert.match(parsed(result).reason, /state/);
});

test('a tampered required-evidence missing fingerprint is invalid, never a validated missing file', (t) => {
  const f = fixture(t); assert.equal(f.capture().status, 0);
  rmSync(f.evidence);
  mutateCheckpoint(f.handoff, (cp) => {
    cp.evidence.find((e) => e.path === 'verification.log').identity = { kind: 'missing' };
    cp.repository.files = cp.repository.files.filter((e) => e.path !== 'verification.log');
  });
  assert.equal(parsed(f.check()).status, 'invalid');
});

test('snapshot manifest must belong to recorded repository/run root and a real phase commit', (t) => {
  const f = fixture(t); const s = snapshot(f);
  const original = JSON.parse(readFileSync(s.manifest, 'utf8'));
  writeFileSync(s.manifest, JSON.stringify({ ...original, repoRoot: f.dir }));
  assert.equal(f.capture().status, 2);
  writeFileSync(s.manifest, JSON.stringify(original)); f.state.review.CODEX_GATE_RUNS = join(f.dir, 'other runs');
  assert.equal(f.capture().status, 2);
  f.state.review.CODEX_GATE_RUNS = dirname(dirname(s.manifest));
  f.state.review.PHASE_HEAD = 'a'.repeat(40); writeFileSync(s.manifest, JSON.stringify({ ...original, phaseHead: 'a'.repeat(40) }));
  assert.equal(f.capture().status, 2);
});

test('a real expected TDD RED resumes as recorded RED while preserving the last green evidence', (t) => {
  const f = fixture(t); const feature = join(f.repo, 'feature.test.mjs');
  // A fresh verification process must not inherit node:test's child marker;
  // otherwise Node deliberately skips recursive test discovery with exit 0.
  const verificationEnv = { ...process.env }; delete verificationEnv.NODE_TEST_CONTEXT;
  const verify = () => spawnSync(process.execPath, ['--test', feature], { encoding: 'utf8', env: verificationEnv });
  writeFileSync(feature, "import assert from 'node:assert/strict'; assert.equal(1, 1);\n");
  const green = verify(); assert.equal(green.status, 0);
  writeFileSync(join(f.repo, 'green.log'), green.stdout + green.stderr);
  f.state.verification.lastGreen = { command: 'node --test feature.test.mjs', result: 'green', provenance: { host: 'claude', kind: 'artifact', reference: 'green.log' } };
  writeFileSync(feature, "import assert from 'node:assert/strict'; assert.equal(1, 2, 'missing behavior');\n");
  const red = verify(); assert.equal(red.status, 1, red.stdout + red.stderr);
  writeFileSync(f.evidence, red.stdout + red.stderr);
  const before = readFileSync(feature); assert.equal(f.capture().status, 0);
  assert.equal(parsed(f.check()).status, 'validated');
  assert.equal(checkpoint(f.handoff).state.verification.current.result, 'expected-red');
  assert.equal(checkpoint(f.handoff).state.verification.lastGreen.result, 'green');
  assert.deepEqual(readFileSync(feature), before);
  assert.equal(verify().status, 1);
});

test('real wrapper namespace must match original session, phase and current branch without rewriting baseline', (t) => {
  const f = fixture(t);
  // Exercise wrapper sanitization rather than constructing a synthetic namespace.
  git(f.repo, 'checkout', '-qb', 'feature/continuity');
  f.state.phase = 'phase:1 @~';
  const s = snapshot(f); const manifest = readFileSync(s.manifest); const baseline = readFileSync(s.baseline);
  // A competing namespace already has a newer baseline that would hide these
  // edits if phase-review used wrong-session while check validated old-session.
  writeFileSync(join(f.repo, 'tracked.txt'), 'in-flight edits after original baseline\n');
  const competing = spawnSync('bash', [WRAPPER, 'phase-start', f.state.phase], { cwd: f.repo, encoding: 'utf8',
    env: { ...process.env, CODEX_GATE_RUNS: f.state.review.CODEX_GATE_RUNS, CODEX_GATE_SESSION: 'wrong-session', CODEX_BIN: '/never-call-live-reviewer' } });
  assert.equal(competing.status, 0, competing.stdout + competing.stderr);
  const competingRun = competing.stdout.match(/^RUNDIR=(.+)$/m)?.[1];
  assert.ok(competingRun);
  assert.equal(readFileSync(join(competingRun, 'snapshot', 'tracked.txt'), 'utf8'), 'in-flight edits after original baseline\n');
  const initial = f.capture(); assert.equal(initial.status, 0, initial.stdout); assert.equal(parsed(f.check()).status, 'validated');
  const goodHandoff = readFileSync(f.handoff);
  for (const change of ['session', 'phase', 'branch']) {
    writeFileSync(f.handoff, '# Fresh output for binding validation\n');
    const originalReview = { ...f.state.review }; const originalPhase = f.state.phase;
    if (change === 'session') f.state.review.CODEX_GATE_SESSION = 'wrong-session';
    if (change === 'phase') { f.state.phase = 'wrong-phase'; f.state.review.phaseId = 'wrong-phase'; }
    if (change === 'branch') git(f.repo, 'checkout', '-qb', 'wrong/branch');
    const before = readFileSync(f.handoff); const result = f.capture();
    assert.equal(result.status, 2, change + ': ' + result.stdout);
    assert.deepEqual(readFileSync(f.handoff), before);
    f.state.review = originalReview; f.state.phase = originalPhase;
    if (change === 'branch') git(f.repo, 'checkout', '-q', 'feature/continuity');
    assert.deepEqual(readFileSync(s.manifest), manifest); assert.deepEqual(readFileSync(s.baseline), baseline);
  }
  writeFileSync(f.handoff, goodHandoff);
  mutateCheckpoint(f.handoff, (cp) => { cp.state.review.CODEX_GATE_SESSION = 'wrong-session'; });
  assert.notEqual(parsed(f.check()).status, 'validated');
});

test('real wrapper detached-HEAD namespace remains valid and relocation is reported without a new baseline', (t) => {
  const f = fixture(t); git(f.repo, 'checkout', '--detach', '-q'); const s = snapshot(f);
  assert.equal(f.capture().status, 0); assert.equal(parsed(f.check()).status, 'validated');
  const before = readFileSync(s.manifest); const baseline = readFileSync(s.baseline);
  const moved = join(f.dir, 'relocated checkout');
  // A new worktree shares commits but cannot reuse the original absolute-root
  // reviewer namespace implicitly; no phase-start is run in the destination.
  git(f.repo, 'worktree', 'add', '--detach', '-q', moved, 'HEAD');
  const result = parsed(run('check', f.handoff, moved));
  assert.notEqual(result.status, 'validated');
  assert.ok(result.issues.some((issue) => issue.reason.includes('relocated')));
  assert.deepEqual(readFileSync(s.manifest), before); assert.deepEqual(readFileSync(s.baseline), baseline);
});
