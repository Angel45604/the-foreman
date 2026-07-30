import { fileURLToPath } from 'node:url';
import { statSync } from 'node:fs';
import { isMain } from './is-main.mjs';
// Installed PreToolUse hook command strings that would actually FIRE on Bash tool calls. Used so a
// category requirement of the form {hook:"substr"} can be satisfied by a hook instead of a deny
// matcher (ADR-010). Fail-closed by construction: an entry only counts if its matcher covers Bash
// (exact, or a PIPE alternative — Claude Code matcher semantics; a comma form is NOT a valid
// alternative and is rejected) AND the hook is type "command" — a guard registered under the wrong
// matcher or wrong type can never satisfy a rail (it would never fire where it matters).
export function hookCommands(settings) {
  const pt = settings?.hooks?.PreToolUse;
  if (!Array.isArray(pt)) return [];
  const matchesBash = (m) =>
    typeof m === 'string' && m.split('|').map((x) => x.trim()).includes('Bash');
  return pt
    .filter((entry) => entry && matchesBash(entry.matcher))
    .flatMap((entry) => (Array.isArray(entry.hooks) ? entry.hooks : []))
    .map((h) => (h && h.type === 'command' && typeof h.command === 'string') ? h.command : '')
    .filter(Boolean);
}

// A {hook:"substr"} requirement is satisfied only by a command whose matching TOKEN is a real,
// existing file (script path containing the substring). This kills two fail-opens round 2 caught:
// a no-op like `echo git-push-guard` (the matching token is not an existing file) and a DANGLING
// registration after the guard file moved/was deleted (exists check fails → rail reported missing).
// fileExists is injectable for tests; the default hits the real filesystem.
export function hookSatisfies(commandStr, substr, fileExists) {
  if (typeof commandStr !== 'string' || !commandStr.includes(substr)) return false;
  const tokens = commandStr.split(/\s+/).map((t) => t.replace(/^['"]|['"]$/g, ''));
  return tokens.some((t) => t.includes(substr) && fileExists(t));
}

export function checkSettings(settings, required, opts = {}) {
  const fileExists = opts.fileExists ?? ((p) => { try { return statSync(p).isFile(); } catch { return false; } });
  const cats = required && typeof required === 'object' ? required.categories : null;
  if (!cats || typeof cats !== 'object' || Object.keys(cats).length === 0) {
    // no usable required rails => HARD FAIL (never pass with empty rails)
    return { ok:false, missing:[], reasons:['required deny-rule set missing/empty/malformed'],
      setupBlock:'Restore references/REQUIRED_DENY_RULES.json with all mandated categories.' };
  }
  const reasons = [], missing = [];
  const perms = settings && typeof settings === 'object' ? settings.permissions : null;
  const deny = perms && Array.isArray(perms.deny) ? perms.deny : [];
  if (!perms || !Array.isArray(perms.deny)) reasons.push('permissions.deny block missing');
  // A requirement is a deny-matcher string, an {anyOf:[req,…]} (satisfied if ANY member is), or a
  // {hook:"substr"} (satisfied by an installed, Bash-matched, type:"command" PreToolUse hook whose
  // command invokes an EXISTING script containing substr — ADR-010, hardened per plan-review round 2).
  const hookCmds = hookCommands(settings);
  const satisfied = (req) => {
    if (typeof req === 'string') return deny.includes(req);
    if (req && typeof req === 'object') {
      if (Array.isArray(req.anyOf)) return req.anyOf.some(satisfied);      // recursive: members may be {hook}
      if (typeof req.hook === 'string') return hookCmds.some((c) => hookSatisfies(c, req.hook, fileExists));
    }
    return false;
  };
  for (const [cat, reqs] of Object.entries(cats)) {
    if (!Array.isArray(reqs) || reqs.length === 0) { missing.push(cat); continue; } // empty => fail-closed
    if (!reqs.every(satisfied)) missing.push(cat); // allOf: EVERY required form must be satisfied
  }
  const autoMode = settings?.defaultMode === 'auto' || perms?.defaultMode === 'auto'; // detect (BOTH locations)
  if (missing.length) reasons.push(`uncovered deny categories: ${missing.join(', ')}`);
  // Auto-mode is the operator's intentional choice (they always run auto) — NOT a blocker. But it makes
  // the deny rails the ONLY compaction-proof guard, so the rails stay HARD-required. Reported as a note.
  const notes = autoMode
    ? ['Session default is "auto" (intentional): the deny rails + guard hooks are your only compaction-proof guard against irreversible/external actions in auto — keep them current.']
    : ['Session is not globally "auto": cross into auto per-session via the native "Approve and start in auto mode".'];
  const ok = reasons.length === 0; // ok = rails present (+ valid required set); auto does NOT block
  // Flatten missing categories' requirements (recursing anyOf) into concrete deny matchers (strings)
  // and hook alternatives ({hook}); guard malformed values — fail-closed, never throw.
  const flatten = (reqs) => Array.isArray(reqs)
    ? reqs.flatMap((r) => (r && Array.isArray(r.anyOf)) ? flatten(r.anyOf) : [r]) : [];
  const missingReqs = missing.flatMap((c) => flatten(cats[c]));
  const needed = [...new Set(missingReqs.filter((r) => typeof r === 'string'))];
  const hookAlts = [...new Set(missingReqs.filter((r) => r && typeof r === 'object' && typeof r.hook === 'string').map((r) => r.hook))];
  let setupBlock = '';
  if (!ok && needed.length) {
    setupBlock = 'MERGE these into "permissions".deny in ~/.claude/settings.json (ADD to any existing list — do NOT replace it; verify exact matcher syntax):\n' +
      JSON.stringify({ permissions: { deny: needed } }, null, 2);
  }
  if (!ok && hookAlts.length) {
    setupBlock += (setupBlock ? '\n\n' : '') +
      `PREFERRED alternative (ADR-010): satisfy via a PreToolUse hook — matcher "Bash", type "command", command containing ${hookAlts.map((h) => `"${h}"`).join(' / ')} (e.g. references/git-push-guard.mjs). The hook allows safe feature-branch pushes; the paste-in blanket deny above also blocks the ship stage's own pushes.`;
  }
  return { ok, missing, reasons, notes, autoMode, setupBlock };
}

export async function preflightFromDisk(homeSettingsPath, requiredPath) {
  const fs = await import('node:fs/promises');
  let settings = null, required = null;
  try { settings = JSON.parse(await fs.readFile(homeSettingsPath, 'utf8')); } catch { settings = null; }
  try { required = JSON.parse(await fs.readFile(requiredPath, 'utf8')); } catch { required = null; }
  return checkSettings(settings ?? {}, required); // required=null => hard fail
}

// CLI: `node preflight.mjs` -> prints JSON, exit 1 if not ok
if (isMain(import.meta.url)) {
  const home = process.env.HOME;
  const r = await preflightFromDisk(`${home}/.claude/settings.json`, fileURLToPath(new URL('./REQUIRED_DENY_RULES.json', import.meta.url)));
  console.log(JSON.stringify(r, null, 2)); process.exit(r.ok ? 0 : 1);
}
