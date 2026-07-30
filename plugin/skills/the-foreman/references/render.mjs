import { readFile, writeFile } from 'node:fs/promises';
import { isMain } from './is-main.mjs';
import { dirname, join } from 'node:path';
import { fileURLToPath  } from 'node:url';
import * as templates from './templates.mjs';
import { toMarkdown } from './markdown.mjs';
import { scan } from './secret-scan.mjs';
import { esc } from './esc.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

// icon symbols copied verbatim from plan-deck-reference.html <defs>
const SYMBOLS = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
  <symbol id="i-flag" viewBox="0 0 24 24"><path d="M4 22V4M4 4h13l-2 4 2 4H4"/></symbol>
  <symbol id="i-list" viewBox="0 0 24 24"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></symbol>
  <symbol id="i-warn" viewBox="0 0 24 24"><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/></symbol>
  <symbol id="i-layers" viewBox="0 0 24 24"><path d="m12 2 9 5-9 5-9-5 9-5ZM3 12l9 5 9-5M3 17l9 5 9-5"/></symbol>
  <symbol id="i-route" viewBox="0 0 24 24"><path d="M6 19a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM18 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM6 13V8a4 4 0 0 1 4-4h5"/></symbol>
  <symbol id="i-shield" viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10ZM9 12l2 2 4-4"/></symbol>
  <symbol id="i-deck" viewBox="0 0 24 24"><path d="M3 4h18v12H3zM3 20h18M8 16v4M16 16v4"/></symbol>
  <symbol id="i-fork" viewBox="0 0 24 24"><path d="M12 3v6M12 9 7 14M12 9l5 5M7 14v4M17 14v4"/></symbol>
  <symbol id="i-check" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></symbol>
  <symbol id="i-cog" viewBox="0 0 24 24"><path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7 19.4l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 10 4.6V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 .9 2.7H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z"/></symbol>
</defs></svg>`;

export async function render(ledgerPath, type, outPath) {
  const ledger = JSON.parse(await readFile(ledgerPath, 'utf8'));
  const make = templates[type];
  if (!make) throw new Error(`unknown artifact type: ${type}`);
  const { title, bodyHtml } = make(ledger);
  const css = await readFile(join(HERE, 'style.css'), 'utf8');
  const js = await readFile(join(HERE, 'slide-engine.js'), 'utf8');
  // Honor ledger.meta.accent — STRICT hex only (prevents CSS injection); the #009ACC house default otherwise stands.
  const accent = ledger?.meta?.accent;
  const accentOverride = (typeof accent === 'string' && /^#[0-9a-fA-F]{6}$/.test(accent) && accent.toUpperCase() !== '#009ACC')
    ? `\n<style>:root{--accent:${accent}}</style>` : '';
  // Honor ledger.meta.theme — a 2-value ALLOWLIST ('light'|'dark'); anything else
  // (incl. 'auto'/absent/garbage/an injection attempt) => null => NO attribute, so
  // the @media(prefers-color-scheme) query governs (auto). Because `theme` is one of
  // two known literals (never raw ledger text), JSON.stringify(theme) is injection-safe.
  const m = ledger?.meta ?? {};
  const theme = (m.theme === 'light' || m.theme === 'dark') ? m.theme : null;
  const themeInit = theme ? `\n<script>document.documentElement.dataset.theme=${JSON.stringify(theme)}</script>` : '';
  const html = `<title>${esc(title)}</title>\n<style>${css}</style>${accentOverride}${themeInit}\n${SYMBOLS}\n${bodyHtml}\n<script>${js}</script>\n`;
  // Portable Markdown twin: a parallel agent can read it from disk / be pasted it.
  const { markdown } = toMarkdown(ledger, type);
  const mdPath = outPath.endsWith('.html') ? `${outPath.slice(0, -5)}.md` : `${outPath}.md`;
  // FAIL-CLOSED gate (ADR-003) — scan BOTH renderings BEFORE any write. If
  // EITHER is unclean, throw and write neither file.
  const rh = scan(html);
  if (!rh.clean) throw new Error(`fail-closed: rendered artifact contains ${rh.hits.map((h) => h.category).join(', ')}`);
  const rm = scan(markdown);
  if (!rm.clean) throw new Error(`fail-closed: rendered markdown twin contains ${rm.hits.map((h) => h.category).join(', ')}`);
  await writeFile(outPath, html, 'utf8'); // same path => agent re-publishes => same URL
  await writeFile(mdPath, markdown, 'utf8');
  return { outPath, bytes: html.length, mdPath, mdBytes: markdown.length };
}

export async function cli(argv) {
  const [ledgerPath, type, outPath] = argv;
  if (!ledgerPath || !type || !outPath) {
    const e = new Error('usage: render.mjs <ledgerPath> <type> <outPath>');
    e.code = 2;
    throw e;
  }
  return render(ledgerPath, type, outPath);
}

if (isMain(import.meta.url)) {
  cli(process.argv.slice(2))
    .then((r) => console.log(JSON.stringify(r)))
    .catch((e) => {
      console.error(String(e.message || e));
      process.exit(e.code === 2 ? 2 : 1);
    });
}
