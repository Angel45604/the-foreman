// the-foreman — fallback surfacing: open a rendered artifact LOCALLY in the browser when the hosted
// `Artifact` tool is unavailable (the beta isn't enabled for the session / org, or you're a subagent).
// render.mjs output is fully self-contained + CSP-safe, so a local file open renders identically to the
// hosted page — minus the shareable URL and same-URL in-place update. Chrome first (owner's request),
// then the OS default browser. If even that fails, the caller just surfaces the path (§4) — never spirals.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { isMain } from './is-main.mjs';
import { platform as osPlatform } from 'node:os';

// Prefer the `.local.html` sibling render.mjs writes next to the shell-less
// hosted variant: it is the complete standards-mode document (doctype, charset,
// viewport), which a local browser needs for correct parsing — the shell-less
// outPath exists for the hosted publish contract. Falls back to the given path
// when no sibling exists (e.g. a pre-dual-output render). `exists` is
// injectable so tests never touch the filesystem.
export function resolveLocalPath(path, exists = existsSync) {
  const p = String(path);
  if (p.endsWith('.local.html')) return p; // already the local document
  const sibling = `${p.endsWith('.html') ? p.slice(0, -5) : p}.local.html`;
  return exists(sibling) ? sibling : p;
}

// Pure: the ordered [cmd, args] candidates to open `path` in a browser, Chrome-first, per platform.
export function openCandidates(path, platform = osPlatform()) {
  const p = String(path);
  switch (platform) {
    case 'darwin':
      return [
        ['open', ['-a', 'Google Chrome', p]], // Chrome first
        ['open', [p]],                         // fallback: the OS default browser
      ];
    case 'win32':
      // Shell-free: spawn (no shell) passes `p` as ONE argv element, so cmd metacharacters in the path
      // (`&`, `^`, …) are DATA, never shell syntax. (Routing through `cmd /c start` would parse them.)
      return [
        ['chrome', [p]],                                       // Chrome directly (ENOENT → falls through)
        ['rundll32.exe', ['url.dll,FileProtocolHandler', p]],  // default browser, no shell
      ];
    default: // linux & others
      return [
        ['google-chrome', [p]],
        ['xdg-open', [p]],
      ];
  }
}

// Open `path` in a browser, Chrome-first, resolving with the candidate that worked.
//
// Each candidate is spawned DETACHED. Resolution rules, designed so we (a) detect a real failure and
// fall through to the next candidate, yet (b) never wait on a long-lived browser's lifetime:
//   - 'error' (the launcher binary can't be spawned, e.g. ENOENT)      -> try the next candidate
//   - 'exit' with a NON-ZERO code (a fast dispatcher reported failure,  -> try the next candidate
//     e.g. macOS `open -a "Google Chrome"` when Chrome isn't installed)
//   - 'exit' with code 0 (dispatcher succeeded: `open`, `xdg-open`)     -> success
//   - still alive after `windowMs` (a foreground browser like Linux     -> success (don't wait for it
//     `google-chrome <path>` that never exits on its own)                  to be closed — that would block)
// Rejects only if every candidate fails, so the caller can fall back to plainly surfacing the path.
// `spawnFn` and `windowMs` are injectable so tests are deterministic and never launch a real browser.
export function openInBrowser(path, platform = osPlatform(), spawnFn = spawn, windowMs = 250) {
  const candidates = openCandidates(path, platform);
  return new Promise((resolve, reject) => {
    const tryAt = (i) => {
      if (i >= candidates.length) return reject(new Error(`could not open ${path} in any browser`));
      const [cmd, args] = candidates[i];
      let settled = false;
      const child = spawnFn(cmd, args, { detached: true, stdio: 'ignore' });
      const succeed = () => { if (settled) return; settled = true; clearTimeout(timer); child.unref?.(); resolve({ cmd, args }); };
      const next = () => { if (settled) return; settled = true; clearTimeout(timer); tryAt(i + 1); };
      const timer = setTimeout(succeed, windowMs); // survived the failure window → treat as launched
      child.once('error', next);                   // launcher binary missing → next candidate
      child.once('exit', (code) => (code === 0 ? succeed() : next())); // fast dispatcher result → resolve / next
    };
    tryAt(0);
  });
}

// CLI: `node open-artifact.mjs <htmlPath>` -> opens it in a Chrome tab (fallback: default browser),
// preferring the `.local.html` sibling when render.mjs wrote one.
if (isMain(import.meta.url)) {
  const given = process.argv[2];
  if (!given) {
    console.error('usage: open-artifact.mjs <htmlPath>');
    process.exit(2);
  }
  const path = resolveLocalPath(given);
  openInBrowser(path)
    .then((r) => console.log(JSON.stringify({ opened: path, via: `${r.cmd} ${r.args.join(' ')}` })))
    .catch((e) => {
      console.error(String(e.message || e));
      process.exit(1);
    });
}
