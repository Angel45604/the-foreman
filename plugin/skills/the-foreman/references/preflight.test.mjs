import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkSettings, hookCommands } from './preflight.mjs';

const REQ = { categories: {
  force_push:  ['Bash(git push --force:*)', 'Bash(git push -f:*)'],   // BOTH spellings (allOf)
  mass_delete: ['Bash(rm -rf:*)', 'Bash(git clean -fdx:*)'],          // BOTH forms (allOf)
  exfiltration:[{ anyOf:['Bash(curl*:*)', 'Bash(wget*:*)'] }],        // either spelling (anyOf)
} };
const fullDeny = ['Bash(git push --force:*)','Bash(git push -f:*)','Bash(rm -rf:*)','Bash(git clean -fdx:*)','Bash(curl*:*)'];

test('passes only when EVERY required form covered + defaultMode not auto', () => {
  const r = checkSettings({ permissions:{ deny: fullDeny }, defaultMode:'plan' }, REQ);
  assert.equal(r.ok, true); assert.deepEqual(r.missing, []);
});
test('FAILS CLOSED on PARTIAL coverage (a dangerous form still allowed)', () => {
  // force_push: only --force denied, -f still allowed => must fail
  const r1 = checkSettings({ permissions:{ deny:['Bash(git push --force:*)','Bash(rm -rf:*)','Bash(git clean -fdx:*)','Bash(curl*:*)'] }, defaultMode:'plan' }, REQ);
  assert.equal(r1.ok, false); assert.ok(r1.missing.includes('force_push'));
  // mass_delete: only rm -rf denied, git clean -fdx still allowed => must fail
  const r2 = checkSettings({ permissions:{ deny:['Bash(git push --force:*)','Bash(git push -f:*)','Bash(rm -rf:*)','Bash(curl*:*)'] }, defaultMode:'plan' }, REQ);
  assert.equal(r2.ok, false); assert.ok(r2.missing.includes('mass_delete'));
});
test('anyOf: either equivalent spelling satisfies the category', () => {
  const deny = ['Bash(git push --force:*)','Bash(git push -f:*)','Bash(rm -rf:*)','Bash(git clean -fdx:*)','Bash(wget*:*)']; // wget not curl
  assert.equal(checkSettings({ permissions:{ deny }, defaultMode:'plan' }, REQ).ok, true);
});
test('auto default does NOT block when deny rails are present (note, not blocker)', () => {
  const r = checkSettings({ permissions:{ deny: fullDeny }, defaultMode:'auto' }, REQ);
  assert.equal(r.ok, true); assert.equal(r.autoMode, true);
  assert.ok(r.notes.some(n => /auto/i.test(n)));
});
test('auto under permissions also does NOT block (note) when rails present', () => {
  const r = checkSettings({ defaultMode:'plan', permissions:{ defaultMode:'auto', deny: fullDeny } }, REQ);
  assert.equal(r.ok, true); assert.equal(r.autoMode, true);
});
test('deny rails remain HARD-required even in auto (auto never bypasses them)', () => {
  // force_push missing + session in auto => MUST still fail on the rails
  const r = checkSettings({ permissions:{ deny:['Bash(rm -rf:*)','Bash(git clean -fdx:*)','Bash(curl*:*)'] }, defaultMode:'auto' }, REQ);
  assert.equal(r.ok, false); assert.ok(r.missing.includes('force_push'));
});
test('FAILS CLOSED when required rules missing/empty/malformed (no silent open)', () => {
  for (const bad of [undefined, null, {}, { categories:{} }, { categories:null }, 'nope'])
    assert.equal(checkSettings({ permissions:{ deny: fullDeny }, defaultMode:'plan' }, bad).ok, false, `required=${JSON.stringify(bad)} must fail closed`);
});
test('fails closed on malformed settings (no permissions.deny)', () => {
  assert.equal(checkSettings({}, REQ).ok, false);
});
test('malformed category value (null) fails closed WITHOUT throwing', () => {
  const r = checkSettings({ permissions:{ deny:[] }, defaultMode:'plan' }, { categories:{ force_push: null } });
  assert.equal(r.ok, false); assert.ok(r.missing.includes('force_push'));
  assert.equal(typeof r.setupBlock, 'string'); // returns the documented JSON shape, not an exception
});
test('setupBlock renders a valid permissions.deny fragment (never a bare array) for missing rails', () => {
  const r = checkSettings({ permissions:{ deny:['Bash(rm -rf:*)','Bash(git clean -fdx:*)','Bash(curl*:*)'] }, defaultMode:'plan' }, REQ); // force_push missing
  assert.equal(r.ok, false);
  assert.match(r.setupBlock, /"permissions"/); assert.match(r.setupBlock, /"deny"/); assert.match(r.setupBlock, /MERGE/);
  assert.doesNotMatch(r.setupBlock, /^\s*\[\s*\]/m); // never a bare empty array
});
test('auto-only (all rails present) => ok:true with no setupBlock (auto is a note, not a failure)', () => {
  const r = checkSettings({ permissions:{ deny: fullDeny }, defaultMode:'auto' }, REQ);
  assert.equal(r.ok, true); assert.equal(r.setupBlock, '');
});

// ---- ADR-010: a category may be satisfied by a PreToolUse hook instead of a deny matcher ----
const HOOK_REQ = { categories: {
  git_push:    [{ anyOf: ['Bash(git push:*)', { hook: 'git-push-guard' }] }],
  mass_delete: ['Bash(rm -rf:*)'],
} };
// Stub filesystem: only realistic script paths "exist" (round-2 hardening: the matching token must
// be an existing FILE, so `echo git-push-guard` and dangling paths can never satisfy the rail).
const scriptExists = (p) => p.endsWith('git-push-guard.mjs');
const nothingExists = () => false;
const withGuardHook = (deny, hookOverrides = {}) => ({
  permissions: { deny }, defaultMode: 'auto',
  hooks: { PreToolUse: [{ matcher: 'Bash', ...hookOverrides.entry,
    hooks: [{ type: 'command', command: 'node /x/references/git-push-guard.mjs', ...hookOverrides.hook }] }] },
});
test('hook satisfies git_push WITHOUT the blanket deny present', () => {
  const r = checkSettings(withGuardHook(['Bash(rm -rf:*)']), HOOK_REQ, { fileExists: scriptExists });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.missing, []);
});
test('the blanket deny STILL satisfies git_push (backward compatible)', () => {
  const r = checkSettings({ permissions: { deny: ['Bash(git push:*)', 'Bash(rm -rf:*)'] }, defaultMode: 'plan' }, HOOK_REQ);
  assert.equal(r.ok, true); assert.deepEqual(r.missing, []);
});
test('git_push FAILS CLOSED when neither the deny nor the guard hook is present', () => {
  const r = checkSettings({ permissions: { deny: ['Bash(rm -rf:*)'] }, defaultMode: 'auto' }, HOOK_REQ, { fileExists: scriptExists });
  assert.equal(r.ok, false); assert.ok(r.missing.includes('git_push'));
  // setupBlock offers BOTH the deny paste-in AND the hook alternative
  assert.match(r.setupBlock, /"permissions"/); assert.match(r.setupBlock, /deny/);
  assert.match(r.setupBlock, /git-push-guard/); assert.match(r.setupBlock, /PreToolUse hook/);
});
test('a NO-OP command containing the substring (echo git-push-guard) never satisfies the rail', () => {
  const noop = withGuardHook(['Bash(rm -rf:*)'], { hook: { command: 'echo git-push-guard' } });
  const r = checkSettings(noop, HOOK_REQ, { fileExists: scriptExists });
  assert.equal(r.ok, false); assert.ok(r.missing.includes('git_push'));
});
test('a DANGLING guard path (file deleted/moved) fails the rail — D4 cutover safety', () => {
  const r = checkSettings(withGuardHook(['Bash(rm -rf:*)']), HOOK_REQ, { fileExists: nothingExists });
  assert.equal(r.ok, false); assert.ok(r.missing.includes('git_push'));
});
test('a COMMA matcher is NOT a valid Bash alternative (Claude matcher semantics are pipe-based)', () => {
  const comma = withGuardHook(['Bash(rm -rf:*)'], { entry: { matcher: 'Bash,Edit' } });
  const r = checkSettings(comma, HOOK_REQ, { fileExists: scriptExists });
  assert.equal(r.ok, false); assert.ok(r.missing.includes('git_push'));
});
test('an unrelated PreToolUse hook does NOT satisfy the git-push-guard requirement', () => {
  const other = { permissions: { deny: ['Bash(rm -rf:*)'] }, defaultMode: 'auto',
    hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'node /x/some-other-hook.mjs' }] }] } };
  const r = checkSettings(other, HOOK_REQ);
  assert.equal(r.ok, false); assert.ok(r.missing.includes('git_push'));
});
test('a guard hook under the WRONG MATCHER never satisfies the rail (fail-closed)', () => {
  const wrongMatcher = { permissions: { deny: ['Bash(rm -rf:*)'] }, defaultMode: 'auto',
    hooks: { PreToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: 'node /x/git-push-guard.mjs' }] }] } };
  const r = checkSettings(wrongMatcher, HOOK_REQ, { fileExists: scriptExists });
  assert.equal(r.ok, false); assert.ok(r.missing.includes('git_push'));
});
test('a guard hook with the WRONG TYPE (or missing matcher) never satisfies the rail (fail-closed)', () => {
  const wrongType = { permissions: { deny: ['Bash(rm -rf:*)'] }, defaultMode: 'auto',
    hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'prompt', command: 'node /x/git-push-guard.mjs' }] }] } };
  assert.equal(checkSettings(wrongType, HOOK_REQ, { fileExists: scriptExists }).ok, false);
  const noMatcher = { permissions: { deny: ['Bash(rm -rf:*)'] }, defaultMode: 'auto',
    hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'node /x/git-push-guard.mjs' }] }] } };
  assert.equal(checkSettings(noMatcher, HOOK_REQ, { fileExists: scriptExists }).ok, false);
});
test('a pipe-alternative matcher covering Bash DOES satisfy the rail', () => {
  const piped = { permissions: { deny: ['Bash(rm -rf:*)'] }, defaultMode: 'auto',
    hooks: { PreToolUse: [{ matcher: 'Bash|Edit', hooks: [{ type: 'command', command: 'node /x/git-push-guard.mjs' }] }] } };
  const r = checkSettings(piped, HOOK_REQ, { fileExists: scriptExists });
  assert.equal(r.ok, true, JSON.stringify(r));
});
test('the REAL default fileExists accepts the actually-installed guard file (integration)', () => {
  const real = { permissions: { deny: ['Bash(rm -rf:*)'] }, defaultMode: 'auto',
    hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command',
      command: `node ${new URL('./git-push-guard.mjs', import.meta.url).pathname}` }] }] } };
  const r = checkSettings(real, HOOK_REQ); // no stub — hits the filesystem
  assert.equal(r.ok, true, JSON.stringify(r));
});
test('setupBlock names the hook alternative as PREFERRED with matcher/type requirements', () => {
  const r = checkSettings({ permissions: { deny: ['Bash(rm -rf:*)'] }, defaultMode: 'auto' }, HOOK_REQ);
  assert.equal(r.ok, false);
  assert.match(r.setupBlock, /PREFERRED alternative/);
  assert.match(r.setupBlock, /matcher "Bash", type "command"/);
});
test('hookCommands flattens installed PreToolUse commands and tolerates malformed hook config', () => {
  assert.deepEqual(hookCommands(withGuardHook([])), ['node /x/references/git-push-guard.mjs']);
  assert.deepEqual(hookCommands({}), []);
  assert.deepEqual(hookCommands({ hooks: { PreToolUse: 'nope' } }), []);
  assert.deepEqual(hookCommands({ hooks: { PreToolUse: [{ hooks: [{ type: 'command' }] }] } }), []); // no command string
});
