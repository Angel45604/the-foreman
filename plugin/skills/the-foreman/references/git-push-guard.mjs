// the-foreman git-push guard — a fast, BEST-EFFORT local backstop against the two catastrophic push
// classes (ADR-002 amended, ADR-010; scope narrowed to owner-only by ADR-004, 2026-07-23). Runs as a
// PreToolUse(Bash) hook. It lets SAFE feature-branch pushes through SILENTLY and BLOCKS:
//   1. any push to a protected branch (main / master) — PRs are the flow;
//   2. a RECKLESS force-push (`-f` / `--force` / clustered `-f` / `+refspec`) — history destruction;
//   3. multi-ref modes (`--mirror`/`--all`/`--branches`/`--prune`), deletion (`:dst`) and wildcard
//      (`*`) refspecs, and refspec-less pushes whose target can't be proven safe — all fail-closed.
// A CAREFUL force (`--force-with-lease` / `--force-if-includes`) to a NON-protected branch is allowed.
//
// **NOT A SECURITY BOUNDARY.** This parses the bash command string, and git's CLI surface is too large
// for a parser to be provably complete — known-uncovered forms include `git -c`/`-C`/`cd` cwd+config
// overrides, `--repo=`, `push.default=upstream`, and shell indirection (`$(...)`, aliases, sudo). The
// real guarantee that teammates cannot push to protected branches or rewrite history is **GitHub
// server-side branch protection** on the repo; this hook is a convenience tripwire for the owner's own
// auto-mode sessions, not a control shipped to teammates (ADR-004 keeps it out of project settings).
//
// FAIL-CLOSED within its scope: an unclassifiable git push BLOCKS (the wrapper maps any thrown error on
// a push-shaped command to exit 2). Non-push commands always pass.

import { execFileSync } from 'node:child_process';
import { isMain } from './is-main.mjs';

export const PROTECTED_BRANCHES = ['main', 'master'];
// git global options that CONSUME the next token as a value — must be skipped in pairs when finding
// the subcommand, else `git -C /path push` reads "push" as the value of -C and misses the push.
const VALUE_GLOBAL_OPTS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--super-prefix']);
const SHELL_SEPARATORS = /\s*(?:&&|\|\||;|\||\n)\s*/;

const stripQuotes = (s) => s.replace(/^['"]|['"]$/g, '');
const isProtected = (branch) => PROTECTED_BRANCHES.includes(branch);

// From a single shell segment, return the args AFTER `git push` if the segment's LEADING command is a
// git push invocation (handling leading `VAR=val` env assignments and `git <global-opts> push …`),
// else null. Requiring git to be the leading command (not merely present) is what keeps
// `echo "git push origin main"` and `grep "git push" f` from being mis-read as pushes — segments are
// already split on shell separators, so a real `cd x && git push …` arrives here as its own segment.
export function extractPushArgs(segment) {
  const toks = segment.trim().split(/\s+/).filter(Boolean).map(stripQuotes);
  let i = 0;
  while (i < toks.length && /^\w+=/.test(toks[i])) i += 1;      // skip leading env assignments
  if (toks[i] !== 'git') return null;                          // leading command must be git
  i += 1;
  while (i < toks.length) { // skip git global options to reach the subcommand
    const t = toks[i];
    if (VALUE_GLOBAL_OPTS.has(t)) { i += 2; continue; }        // opt + its value
    if (t.startsWith('-')) { i += 1; continue; }                // boolean global opt / --opt=val
    break;                                                       // first non-option = subcommand
  }
  if (toks[i] !== 'push') return null;
  return toks.slice(i + 1);
}

// Push modes that target SETS of refs (potentially including protected branches, or deleting remote
// refs) — never provably safe from the command line alone → fail-closed block.
const MULTI_REF_MODES = new Set(['--mirror', '--all', '--branches', '--prune']);

// Classify ONE push invocation's args. resolveBranch() supplies the current branch for a push with
// no explicit refspec; resolvePushConfig(remote) supplies {pushDefault, remotePushRefspecs} so a
// refspec-less push can be proven to target ONLY the current branch (push.default=matching pushes
// EVERY matching branch — main included — and remote.<name>.push refspecs redirect arbitrarily).
// Either resolver returning null/undefined → fail-closed block.
export function classifyPushArgs(args, resolveBranch, resolvePushConfig) {
  let reckless = false;      // -f / --force / clustered f / +refspec  → history-destroying
  let remote = null;
  const targets = [];
  for (const tok of args) {
    if (tok.startsWith('-')) {
      if (MULTI_REF_MODES.has(tok)) {
        return { decision: 'block', reason: `git push ${tok} operates on a whole SET of refs (cannot be proven to avoid ${PROTECTED_BRANCHES.join('/')} or remote deletions) — push explicit branches instead.` };
      }
      if (tok === '-f' || tok === '--force') reckless = true;
      else if (/^-[A-Za-z]+$/.test(tok) && tok.includes('f')) reckless = true; // clustered short flags, e.g. -fu
      // --force-with-lease[=..] / --force-if-includes are the CAREFUL forms → not reckless
      continue;
    }
    if (remote === null) { remote = tok; continue; } // first positional = remote
    let rs = tok;
    if (rs.startsWith('+')) { reckless = true; rs = rs.slice(1); }   // +src[:dst] forces
    if (rs.includes('*')) return { decision: 'block', reason: 'wildcard refspec can target protected branches — push an explicit `<remote> <branch>`.' };
    if (rs.startsWith(':')) return { decision: 'block', reason: 'deletion refspec (`:dst`) removes a remote ref — not permitted through the guard; delete deliberately outside auto-mode.' };
    const dst = rs.includes(':') ? rs.split(':').pop() : rs;         // dst side of a refspec
    targets.push(dst.replace(/^refs\/heads\//, ''));
  }
  if (targets.length === 0) {
    // No explicit refspec: the true target comes from git CONFIG, not the command line. Prove it.
    const cfg = typeof resolvePushConfig === 'function' ? resolvePushConfig(remote ?? 'origin') : null;
    if (!cfg) return { decision: 'block', reason: 'git push with no explicit refspec and unverifiable push config — push with an explicit `<remote> <branch>` so the guard can verify the target.' };
    if (cfg.pushDefault === 'matching') return { decision: 'block', reason: 'git push with push.default=matching pushes EVERY matching branch (protected ones included) — push an explicit `<remote> <branch>`.' };
    if (Array.isArray(cfg.remotePushRefspecs) && cfg.remotePushRefspecs.length > 0) {
      return { decision: 'block', reason: `remote '${remote ?? 'origin'}' has configured push refspecs (${cfg.remotePushRefspecs.join(', ')}) — the real target is not the current branch; push an explicit \`<remote> <branch>\`.` };
    }
    const cur = resolveBranch();
    if (!cur) return { decision: 'block', reason: 'git push with no explicit refspec and the current branch could not be determined — push with an explicit `<remote> <branch>` so the guard can verify the target.' };
    targets.push(cur);
  }
  for (const t of targets) {
    if (isProtected(t)) return { decision: 'block', reason: `git push targets protected branch '${t}' — open a PR instead of pushing to ${PROTECTED_BRANCHES.join('/')}.` };
  }
  if (reckless) return { decision: 'block', reason: 'reckless force-push (-f / --force / clustered -f / +refspec) can destroy remote history — use --force-with-lease on a non-protected branch, or push without --force.' };
  return { decision: 'allow' };
}

// Whole-command decision: any push segment that blocks blocks the command.
export function classifyCommand(command, resolveBranch, resolvePushConfig) {
  if (typeof command !== 'string' || !command.includes('push')) return { decision: 'allow' };
  const segments = command.split(SHELL_SEPARATORS);
  for (const seg of segments) {
    const args = extractPushArgs(seg);
    if (args === null) continue;
    const r = classifyPushArgs(args, resolveBranch, resolvePushConfig);
    if (r.decision === 'block') return r;
  }
  return { decision: 'allow' };
}

// Does the command contain a git push at all? (used by the wrapper to decide fail-closed direction)
export function commandHasGitPush(command) {
  if (typeof command !== 'string') return false;
  return command.split(SHELL_SEPARATORS).some((seg) => extractPushArgs(seg) !== null);
}

// Resolve the current branch for a refspec-less push, from the hook's cwd. Returns null on any
// failure or a detached HEAD → classifyPushArgs turns that into a fail-closed block.
export function branchResolver(cwd) {
  return () => {
    try {
      const out = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'],
        { cwd: cwd || process.cwd(), timeout: 2000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      const b = out.trim();
      return b && b !== 'HEAD' ? b : null; // 'HEAD' == detached → unknown → block
    } catch { return null; }
  };
}

// Resolve the push CONFIG that governs a refspec-less push. `git config --get` exits 1 when the key
// is unset — that is the SAFE default ('simple' since git 2.0), not an error. Any unexpected failure
// returns null → fail-closed block upstream.
export function pushConfigResolver(cwd) {
  const cfg = (args) => {
    try {
      return execFileSync('git', ['config', ...args],
        { cwd: cwd || process.cwd(), timeout: 2000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
        .trim();
    } catch (err) {
      if (err && err.status === 1) return ''; // key unset — normal
      throw err;
    }
  };
  return (remote) => {
    try {
      const pushDefault = cfg(['--get', 'push.default']) || 'simple';
      const raw = cfg(['--get-all', `remote.${remote}.push`]);
      const remotePushRefspecs = raw ? raw.split('\n').filter(Boolean) : [];
      return { pushDefault, remotePushRefspecs };
    } catch { return null; } // unverifiable config → caller blocks
  };
}

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

// PreToolUse(Bash) hook entry. Block == exit 2 (the robust signal: blocks even on malformed output,
// and stderr is fed back to the agent). A crash/timeout in a hook FAILS OPEN in Claude Code, so every
// error path here decides explicitly — fail-closed whenever the command is (or looks like) a git push.
if (isMain(import.meta.url)) {
  const BLOCK = (reason) => { process.stderr.write(`[git-push-guard] BLOCKED: ${reason}\n`); process.exit(2); };
  const ALLOW = () => process.exit(0);
  let raw = '';
  try { raw = await readStdin(); } catch { /* no stdin readable */ }
  let command, cwd;
  try {
    const input = JSON.parse(raw);
    command = input?.tool_input?.command;
    cwd = input?.cwd;
  } catch {
    // Hook input unparseable: don't block ALL bash (this matcher fires on every Bash call) — only
    // fail-closed if the raw blob clearly looks like a git push.
    if (/git[\s\S]*push/.test(raw)) BLOCK('could not parse hook input, but it looks like a git push (fail-closed).');
    ALLOW();
  }
  if (typeof command !== 'string') ALLOW();
  try {
    const r = classifyCommand(command, branchResolver(cwd), pushConfigResolver(cwd));
    if (r.decision === 'block') BLOCK(r.reason);
    ALLOW();
  } catch (err) {
    if (commandHasGitPush(command)) BLOCK(`guard error on a git push (fail-closed): ${err?.message ?? err}`);
    ALLOW();
  }
}
