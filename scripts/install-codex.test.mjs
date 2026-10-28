import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, cp, symlink, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const installer = join(root, 'scripts/install-codex.mjs');
const names = ['the-foreman', 'codex-gate', 'handoff', 'keep-it-simple', 'the-refiner'];
const temporary = async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'foreman codex package '));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
};
const run = (args, options = {}) => spawnSync(process.execPath, args, { encoding: 'utf8', ...options });
const install = (destination, options = {}) => run([installer, '--dest', destination], options);
const read = (path) => readFile(path, 'utf8');
const moduleAt = async (path) => import(pathToFileURL(path).href);

test('importing the installer performs no install', async (t) => {
  const dir = await temporary(t);
  const result = run(['--input-type=module', '-e', `await import(${JSON.stringify(pathToFileURL(installer).href)})`], { cwd: dir });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(await readdir(dir), []);
});

test('isolated install includes five adapters, metadata, licenses and canonical runtime resources', async (t) => {
  const dir = await temporary(t);
  const dest = join(dir, 'skills with spaces');
  const result = install(dest, { cwd: dir });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.destination, dest);
  assert.deepEqual(report.skills, names);
  assert.deepEqual((await readdir(dest)).sort(), [...names].sort());
  for (const name of names) {
    const skill = join(dest, name);
    const overlay = join(root, 'codex/skills', name, 'SKILL.md');
    const source = await lstat(overlay).then(() => overlay, () => join(root, 'plugin/skills', name, 'SKILL.md'));
    assert.equal(await read(join(skill, 'SKILL.md')), await read(source));
    assert.equal(await read(join(skill, 'LICENSE')), await read(join(root, 'plugin/LICENSE')));
    assert.match(await read(join(skill, 'agents/openai.yaml')), new RegExp(`\\$${name}`));
  }
  assert.ok((await lstat(join(dest, 'the-foreman/references/fonts/sora-latin.woff2'))).isFile());
  assert.ok((await lstat(join(dest, 'the-refiner/references/core-contract.md'))).isFile());
  // Runtime/data live only where the caller explicitly selected; no host configuration is created.
  assert.deepEqual((await readdir(dir)).sort(), ['skills with spaces']);
});

test('installed renderer, scanner, escalation, dispatch and reviewer config run without the checkout', async (t) => {
  const dir = await temporary(t);
  const dest = join(dir, 'standalone');
  assert.equal(install(dest).status, 0);
  const refs = join(dest, 'the-foreman/references');
  const ledger = join(dir, 'ledger.json');
  const board = join(dir, 'board.html');
  await writeFile(ledger, JSON.stringify({ meta: { title: 'Package smoke', crumb: 'Local' }, slides: [{ kicker: 'Ready', heading: 'Review', cards: [] }] }));
  const rendered = run([join(refs, 'render.mjs'), ledger, 'planDeck', board], { cwd: dir });
  assert.equal(rendered.status, 0, rendered.stderr);
  assert.match(await read(board), /Package smoke/);
  assert.match(await read(join(dir, 'board.local.html')), /<!doctype html>/i);
  assert.match(await read(join(dir, 'board.md')), /Package smoke/);
  const { scan } = await moduleAt(join(refs, 'secret-scan.mjs'));
  assert.equal(scan('ordinary prose').clean, true);
  assert.equal(scan('sk-' + 'A'.repeat(25)).clean, false);
  const secretLedger = join(dir, 'secret.json');
  await writeFile(secretLedger, JSON.stringify({ meta: { title: 'sk-' + 'A'.repeat(25) } }));
  assert.notEqual(run([join(refs, 'render.mjs'), secretLedger, 'planDeck', join(dir, 'rejected.html')]).status, 0);
  await assert.rejects(lstat(join(dir, 'rejected.html')), { code: 'ENOENT' });
  const escalation = await moduleAt(join(refs, 'escalation.mjs'));
  const state = join(dir, 'state');
  const request = escalation.buildRequest({ requestId: 'package-check', gateId: 'phase-boundary', questions: [{ id: 'continue', prompt: 'Continue?', options: ['continue', 'stop'] }] });
  await escalation.writeRequest(state, request);
  assert.equal((await escalation.checkResponse(state, request.requestId)).status, 'pending');
  await writeFile(join(state, 'escalations/package-check.response.json'), JSON.stringify({ requestId: request.requestId, answers: { continue: 'continue' } }));
  assert.equal((await escalation.checkResponse(state, request.requestId)).status, 'answered');
  assert.equal((await escalation.checkResponse(state, request.requestId)).status, 'pending');
  const log = join(state, 'dispatch.jsonl');
  const dispatched = run([join(refs, 'dispatch-log.mjs'), 'append', JSON.stringify({ session: 'package-check', tier: 'standard', shape: 'smoke', why: 'packaged runtime', model: 'supported-host-model', effort: 'high', outcome: 'ok' })], { env: { ...process.env, FOREMAN_DISPATCH_LOG: log }, cwd: dir });
  assert.equal(dispatched.status, 0, dispatched.stderr);
  assert.equal(JSON.parse(await read(log)).session, 'package-check');
  const runtime = join(dest, 'codex-gate/codex-gate.sh');
  const gateEnv = { ...process.env, CODEX_GATE_RUNTIME: runtime, CODEX_GATE_SOURCE: join(dir, 'absent-source.sh'), CODEX_HOME_DIR: join(state, 'reviewer-home'), CODEX_GATE_RUNS: join(state, 'reviews'), CODEX_GATE_SESSION: 'package-check', CODEX_BIN: join(dir, 'absent-codex') };
  const configured = spawnSync('bash', [runtime, 'config'], { cwd: dir, encoding: 'utf8', env: gateEnv });
  assert.equal(configured.status, 0, configured.stderr);
  const config = JSON.parse(configured.stdout);
  assert.equal(config.outcome, 'CONFIG');
  assert.equal(config.runtimePath, runtime);
  assert.equal(config.parity, 'UNAVAILABLE');
  await assert.rejects(lstat(gateEnv.CODEX_GATE_RUNS), { code: 'ENOENT' });
  await assert.rejects(lstat(gateEnv.CODEX_HOME_DIR), { code: 'ENOENT' });
});

test('all collisions are checked before writing, including broken symlinks', async (t) => {
  for (const type of ['directory', 'file', 'symlink']) {
    const dir = await temporary(t);
    const dest = join(dir, 'skills');
    await mkdir(dest);
    const collision = join(dest, 'the-refiner');
    if (type === 'directory') await mkdir(collision);
    if (type === 'file') await writeFile(collision, 'preserve me');
    if (type === 'symlink') await symlink(join(dir, 'missing'), collision);
    const result = install(dest);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /exist|refus|collision/i);
    assert.deepEqual(await readdir(dest), ['the-refiner']);
    if (type === 'file') assert.equal(await read(collision), 'preserve me');
    if (type === 'symlink') assert.equal((await lstat(collision)).isSymbolicLink(), true);
  }
});

test('installed phase baseline survives an offline reviewer infrastructure failure', async (t) => {
  const dir = await temporary(t);
  const dest = join(dir, 'skills');
  assert.equal(install(dest).status, 0);
  const repo = join(dir, 'repo');
  await mkdir(repo);
  const git = (args) => {
    const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };
  git(['init', '-q']);
  await writeFile(join(repo, 'change.txt'), 'committed baseline\n');
  git(['add', 'change.txt']);
  git(['-c', 'user.name=Package Test', '-c', 'user.email=package@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'test fixture']);
  await writeFile(join(repo, 'change.txt'), 'in-flight baseline\n');
  const runtime = join(dest, 'codex-gate/codex-gate.sh');
  const env = { ...process.env, CODEX_GATE_RUNTIME: runtime, CODEX_HOME_DIR: join(dir, 'reviewer-home'), CODEX_GATE_RUNS: join(dir, 'review-runs'), CODEX_GATE_SESSION: 'preserved-session', CODEX_BIN: join(dir, 'missing-codex') };
  const gate = (args) => spawnSync('bash', [runtime, ...args], { cwd: repo, encoding: 'utf8', env });
  const started = gate(['phase-start', 'P1']);
  assert.equal(started.status, 0, started.stderr);
  const runDir = /^RUNDIR=(.+)$/m.exec(started.stdout)?.[1];
  assert.ok(runDir, started.stdout);
  const manifest = await read(join(runDir, 'snapshot.json'));
  assert.equal(await read(join(runDir, 'snapshot/change.txt')), 'in-flight baseline\n');
  await writeFile(join(repo, 'change.txt'), 'next authorized edit\n');
  await writeFile(join(runDir, 'context.md'), 'GOAL: package smoke; external calls forbidden.');
  const failed = gate(['phase-review', 'P1']);
  assert.equal(JSON.parse(failed.stdout).outcome, 'INFRA_ERROR', failed.stderr);
  assert.equal(await read(join(runDir, 'snapshot.json')), manifest);
  assert.equal(await read(join(runDir, 'snapshot/change.txt')), 'in-flight baseline\n');
  assert.equal(await read(join(repo, 'change.txt')), 'next authorized edit\n');
  await assert.rejects(lstat(env.CODEX_HOME_DIR), { code: 'ENOENT' });
});

test('missing canonical or overlay inputs fail before any destination writes', async (t) => {
  const { installSkills } = await moduleAt(installer);
  for (const missing of ['plugin/skills/the-refiner/SKILL.md', 'codex/skills/codex-gate', 'plugin/LICENSE',
    'plugin/skills/the-foreman/references/render.mjs', 'plugin/skills/the-foreman/references/fonts/sora-latin.woff2',
    'plugin/skills/the-foreman/references/is-main.mjs', 'plugin/skills/the-foreman/references/secret-scan.mjs',
    'plugin/skills/codex-gate/verdict.schema.json', 'plugin/skills/codex-gate/codex-gate.sh',
    'plugin/skills/handoff/references/continuity.mjs', 'plugin/skills/handoff/assets/handoff-template.md']) {
    const dir = await temporary(t);
    const sourceRoot = join(dir, 'source');
    await mkdir(sourceRoot);
    await cp(join(root, 'plugin'), join(sourceRoot, 'plugin'), { recursive: true });
    await cp(join(root, 'codex'), join(sourceRoot, 'codex'), { recursive: true });
    await rm(join(sourceRoot, missing), { recursive: true, force: true });
    const destination = join(dir, 'not-created');
    await assert.rejects(installSkills({ sourceRoot, destination }));
    await assert.rejects(lstat(destination), { code: 'ENOENT' });
  }
});

test('destination inside source trees is rejected before self-copy, including a symlink alias', async (t) => {
  const { installSkills } = await moduleAt(installer);
  const dir = await temporary(t);
  const sourceRoot = join(dir, 'source');
  await mkdir(sourceRoot);
  await cp(join(root, 'plugin'), join(sourceRoot, 'plugin'), { recursive: true });
  await cp(join(root, 'codex'), join(sourceRoot, 'codex'), { recursive: true });
  const sourceSkill = join(sourceRoot, 'plugin/skills/the-foreman');
  const alias = join(dir, 'source-alias');
  await symlink(sourceSkill, alias);
  for (const destination of [join(sourceSkill, 'nested/install'), join(sourceRoot, 'codex/skills/handoff/nested'), join(alias, 'nested/install')]) {
    await assert.rejects(installSkills({ sourceRoot, destination }), /source|inside/i);
    await assert.rejects(lstat(destination), { code: 'ENOENT' });
  }
});

test('source symlinks cannot create a package depending on an external checkout', async (t) => {
  const { installSkills } = await moduleAt(installer);
  const dir = await temporary(t);
  const sourceRoot = join(dir, 'source');
  await mkdir(sourceRoot);
  await cp(join(root, 'plugin'), join(sourceRoot, 'plugin'), { recursive: true });
  await cp(join(root, 'codex'), join(sourceRoot, 'codex'), { recursive: true });
  await symlink(join(root, 'LICENSE'), join(sourceRoot, 'plugin/skills/the-foreman/external'));
  const destination = join(dir, 'not-created');
  await assert.rejects(installSkills({ sourceRoot, destination }), /symlink|symbolic/i);
  await assert.rejects(lstat(destination), { code: 'ENOENT' });
});

test('unknown, duplicate and incomplete flags fail without writing', async (t) => {
  const dir = await temporary(t);
  for (const args of [['--force'], ['--dest'], ['--dest', join(dir, 'skills'), '--dest', join(dir, 'other')]]) {
    const result = run([installer, ...args], { cwd: dir });
    assert.notEqual(result.status, 0);
  }
  assert.deepEqual(await readdir(dir), []);
});
