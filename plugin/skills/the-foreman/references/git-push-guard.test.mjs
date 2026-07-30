import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PROTECTED_BRANCHES, extractPushArgs, classifyPushArgs, classifyCommand, commandHasGitPush,
} from './git-push-guard.mjs';

// Injected branch/config resolvers (no real git in unit tests).
const onFeature = () => 'my-feature';
const onMain = () => 'main';
const detached = () => null;
const safeCfg = () => ({ pushDefault: 'simple', remotePushRefspecs: [] });
const matchingCfg = () => ({ pushDefault: 'matching', remotePushRefspecs: [] });
const refspecCfg = () => ({ pushDefault: 'simple', remotePushRefspecs: ['refs/heads/*:refs/heads/*'] });
const unreadableCfg = () => null;

const decide = (cmd, resolve = onFeature, cfg = safeCfg) => classifyCommand(cmd, resolve, cfg).decision;

test('PROTECTED_BRANCHES is main + master', () => {
  assert.deepEqual([...PROTECTED_BRANCHES].sort(), ['main', 'master']);
});

// ---- extractPushArgs: only a LEADING git-push invocation counts ----
test('extractPushArgs returns args for a real push and null for non-pushes', () => {
  assert.deepEqual(extractPushArgs('git push origin feature'), ['origin', 'feature']);
  assert.deepEqual(extractPushArgs('git push'), []);
  assert.equal(extractPushArgs('git status'), null);
  assert.equal(extractPushArgs('git pushup origin x'), null); // 'pushup' is not 'push'
  assert.equal(extractPushArgs('npm run push'), null);
});
test('extractPushArgs sees through leading env-assignments and git global options', () => {
  assert.deepEqual(extractPushArgs('FOO=bar git push origin feature'), ['origin', 'feature']);
  assert.deepEqual(extractPushArgs('git -C /some/path push origin main'), ['origin', 'main']);
  assert.deepEqual(extractPushArgs('git -c user.name=x push origin feature'), ['origin', 'feature']);
});
test('extractPushArgs does NOT treat an echoed/greped push string as a push (leading cmd is echo/grep)', () => {
  assert.equal(extractPushArgs('echo "git push origin main"'), null);
  assert.equal(extractPushArgs('grep "git push" file.txt'), null);
});

// ---- safe pushes ALLOW (the productivity goal) ----
for (const cmd of [
  'git push origin my-feature',
  'git push -u origin my-feature',
  'git push --set-upstream origin my-feature',
  'git push',                                   // bare → resolves to my-feature
  'git push origin',                            // remote only → resolves to my-feature
  'git push origin main:my-feature',            // dst is the feature branch
  'git push --force-with-lease origin my-feature',
  'git push --force-with-lease=origin/my-feature origin my-feature',
  'git push --force-if-includes origin my-feature',
  'git push origin feature && echo done',       // compound; push part is safe
]) {
  test(`ALLOW: ${cmd}`, () => assert.equal(decide(cmd), 'allow'));
}

// ---- protected-branch pushes BLOCK ----
for (const cmd of [
  'git push origin main',
  'git push origin master',
  'git push origin HEAD:main',
  'git push origin my-feature:main',            // dst side is protected
  'git push origin refs/heads/main',
  'git -C /repo push origin main',              // global-opt form still caught
  'cd /repo && git push origin main',           // compound; push segment caught (old prefix deny missed this)
  'git push --force-with-lease origin main',    // careful force can't rescue a protected target
]) {
  test(`BLOCK protected: ${cmd}`, () => assert.equal(decide(cmd), 'block'));
}

// ---- reckless force BLOCKS on any branch; bare push on main BLOCKS via resolver ----
test('BLOCK reckless force on a feature branch', () => {
  assert.equal(decide('git push --force origin my-feature'), 'block');
  assert.equal(decide('git push -f origin my-feature'), 'block');
  assert.equal(decide('git push origin +my-feature'), 'block'); // +refspec == force
});
test('BLOCK a bare push while the current branch is protected', () => {
  assert.equal(decide('git push', onMain), 'block');
  assert.equal(decide('git push origin', onMain), 'block');
});
test('BLOCK a refspec-less push when the branch is unknown (detached/failure) — fail-closed', () => {
  assert.equal(decide('git push', detached), 'block');
});

// ---- round-2 hardening: multi-ref modes, clustered force, config-driven targets ----
for (const cmd of ['git push --mirror origin', 'git push --all origin', 'git push origin --prune', 'git push --branches origin']) {
  test(`BLOCK multi-ref mode: ${cmd}`, () => assert.equal(decide(cmd), 'block'));
}
test('BLOCK deletion and wildcard refspecs (cheap high-value best-effort blocks)', () => {
  assert.equal(decide('git push origin :stale-branch'), 'block'); // ref deletion
  assert.equal(decide('git push origin :'), 'block');
  assert.equal(decide('git push origin refs/heads/*:refs/heads/*'), 'block'); // wildcard = all branches
});
test('BLOCK clustered short force flags (-fu / -uf)', () => {
  assert.equal(decide('git push -fu origin my-feature'), 'block');
  assert.equal(decide('git push -uf origin my-feature'), 'block');
});
test('ALLOW clustered short flags WITHOUT f (-un is not force)', () => {
  assert.equal(decide('git push -un origin my-feature'), 'allow');
});
test('BLOCK refspec-less push under push.default=matching (targets every matching branch)', () => {
  assert.equal(decide('git push', onFeature, matchingCfg), 'block');
  assert.equal(decide('git push origin', onFeature, matchingCfg), 'block');
});
test('BLOCK refspec-less push when the remote has configured push refspecs', () => {
  assert.equal(decide('git push origin', onFeature, refspecCfg), 'block');
});
test('BLOCK refspec-less push when push config is unreadable or resolver absent — fail-closed', () => {
  assert.equal(decide('git push', onFeature, unreadableCfg), 'block');
  assert.equal(classifyCommand('git push', onFeature /* no config resolver */).decision, 'block');
});
test('explicit refspec pushes do NOT consult push config (target is proven from the command)', () => {
  assert.equal(decide('git push origin my-feature', onFeature, unreadableCfg), 'allow');
});

// ---- non-pushes always ALLOW ----
for (const cmd of ['git status', 'git commit -m "x"', 'git fetch origin', 'ls -la', 'echo push', 'git pull --rebase']) {
  test(`ALLOW non-push: ${cmd}`, () => assert.equal(decide(cmd), 'allow'));
}

// ---- reasons are actionable ----
test('block reasons name the cause', () => {
  assert.match(classifyCommand('git push origin main', onFeature).reason, /protected branch 'main'/);
  assert.match(classifyCommand('git push --force origin my-feature', onFeature).reason, /force-push/);
  assert.match(classifyCommand('git push', detached).reason, /could not be determined|explicit/);
});

// ---- commandHasGitPush drives the wrapper's fail-closed direction ----
test('commandHasGitPush detects pushes (leading cmd) and ignores mentions', () => {
  assert.equal(commandHasGitPush('git push origin x'), true);
  assert.equal(commandHasGitPush('cd r && git push'), true);
  assert.equal(commandHasGitPush('echo "git push"'), false);
  assert.equal(commandHasGitPush('git status'), false);
  assert.equal(commandHasGitPush(null), false);
});

// ---- classifyPushArgs unit-level (protected wins over force ordering) ----
test('classifyPushArgs: protected target reported before force', () => {
  assert.match(classifyPushArgs(['origin', 'main'], onFeature, safeCfg).reason, /protected/);
  assert.match(classifyPushArgs(['--force', 'origin', 'main'], onFeature, safeCfg).reason, /protected/);
  assert.equal(classifyPushArgs(['--force-with-lease', 'origin', 'my-feature'], onFeature, safeCfg).decision, 'allow');
});
