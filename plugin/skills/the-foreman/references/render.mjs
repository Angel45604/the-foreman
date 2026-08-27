import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isMain } from './is-main.mjs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as templates from './templates.mjs';
import { toMarkdown } from './markdown.mjs';
import { scan } from './secret-scan.mjs';
import { esc } from './esc.mjs';
import { lintLedger } from './lint.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

// House-default accents, held NUMERICALLY (de-brand: the legacy default never
// appears as a #-hex literal in engine sources — a fixture ledger carrying it
// lives in fixtures/legacy-accent.json). A meta.accent equal to either default
// (case-insensitive) means "house default — no override emitted", preserving
// the field's original semantics: the legacy ledgers that pinned the old brand
// default re-key to the neumorphic accent automatically, while any OTHER valid
// hex becomes a --user-ac override that all three of style.css's --ac carriers
// (bare :root, media-guarded dark, stamped dark) consume via var(--user-ac, …).
const HOUSE_DEFAULT_ACCENTS = new Set([0x009acc, 0x5b7cfa]);

// Font embedding (prepr round 1): style.css ships PLACEHOLDERS in its
// @font-face src so the stylesheet stays reviewable; the actual woff2 payloads
// live as files under references/fonts/ and are base64-embedded here at
// assembly time. The substitution FAILS LOUDLY — a missing placeholder or an
// unreadable font file must never produce a quietly font-less page. The base64
// alphabet contains no `$`, so String.replace needs no replacement escaping.
const FONT_PLACEHOLDERS = [
  ['__FONT_SORA_B64__', 'sora-latin.woff2'],
  ['__FONT_NUNITO_B64__', 'nunito-sans-latin.woff2'],
];

async function loadCss() {
  let css = await readFile(join(HERE, 'style.css'), 'utf8');
  for (const [placeholder, file] of FONT_PLACEHOLDERS) {
    if (!css.includes(placeholder)) {
      throw new Error(`style.css is missing the font placeholder ${placeholder}`);
    }
    let b64;
    try {
      b64 = (await readFile(join(HERE, 'fonts', file))).toString('base64');
    } catch {
      throw new Error(`font file unreadable: fonts/${file}`);
    }
    css = css.replace(placeholder, b64);
  }
  return css;
}

export async function render(ledgerPath, type, outPath) {
  const ledger = JSON.parse(await readFile(ledgerPath, 'utf8'));
  const make = templates[type];
  if (!make) throw new Error(`unknown artifact type: ${type}`);
  // Non-fatal authoring lint (design §7): run EARLY but BUFFER the warnings —
  // they print only after BOTH renderings pass the secret scan, immediately
  // before the writes. A scan-rejected render therefore prints nothing here,
  // and the messages themselves are rule+location only (see lint.mjs).
  const lintWarnings = lintLedger(ledger, type);
  const { title, bodyHtml: contentHtml } = make(ledger);
  const css = await loadCss(); // style.css + the embedded font payloads (fail-loud)
  const js = await readFile(join(HERE, 'gate-board.js'), 'utf8');
  // Honor ledger.meta.accent — STRICT hex only (prevents CSS injection); a
  // house-default value (see HOUSE_DEFAULT_ACCENTS) emits nothing, so the
  // stylesheet's own var(--user-ac, …) fallback chain stands.
  const accent = ledger?.meta?.accent;
  let accentOverride = '';
  if (typeof accent === 'string' && /^#[0-9a-fA-F]{6}$/.test(accent)
    && !HOUSE_DEFAULT_ACCENTS.has(parseInt(accent.slice(1), 16))) {
    accentOverride = `\n<style>:root{--user-ac:${accent}}</style>`; // AFTER the sheet => wins the cascade
  }
  // Honor ledger.meta.theme — a 2-value ALLOWLIST ('light'|'dark'); anything else
  // (incl. 'auto'/absent/garbage/an injection attempt) => null => NO attribute, so
  // the @media(prefers-color-scheme) query governs (auto). Because `theme` is one of
  // two known literals (never raw ledger text), JSON.stringify(theme) is injection-safe.
  const m = ledger?.meta ?? {};
  const theme = (m.theme === 'light' || m.theme === 'dark') ? m.theme : null;
  const themeInit = theme ? `\n<script>document.documentElement.dataset.theme=${JSON.stringify(theme)}</script>` : '';
  // Shared assembly fragments (prepr blocker: head/body split). headHtml is the
  // metadata half (title + inlined sheet + accent override + theme init);
  // bodyHtml is the content half (the template's markup + the page script).
  // BOTH outputs concatenate these SAME fragments in the SAME order — the
  // hosted `html` joins them with the bare '\n' the pre-split assembly used
  // (byte-identical to it, pinned by render.test.mjs), while the local shell
  // slots headHtml into <head> and bodyHtml into <body>.
  const headHtml = `<title>${esc(title)}</title>\n<style>${css}</style>${accentOverride}${themeInit}`;
  const bodyHtml = `${contentHtml}\n<script>${js}</script>\n`;
  const html = `${headHtml}\n${bodyHtml}`;
  // DUAL OUTPUT (prepr round 1). outPath stays SHELL-LESS — the hosted-Artifact
  // publish contract requires NO doctype/html/head/body wrapper (the host
  // supplies them). The local Chrome fallback needs a real standards-mode shell
  // for charset/viewport correctness, so a `.local.html` sibling wraps the SAME
  // two fragments in a complete document — headHtml in <head> (one title,
  // metadata only), bodyHtml in <body>. It goes through the SAME fail-closed
  // gate, scanned ONCE via `html`: `html` IS headHtml + '\n' + bodyHtml, so
  // every ledger-derived byte the local file carries sits inside a fragment the
  // scan already covered contiguously — the local variant's only additions are
  // engine-authored shell literals (doctype/meta/head/body tags), which no
  // secret pattern can span — so a second scan could catch nothing new.
  const stem = outPath.endsWith('.html') ? outPath.slice(0, -5) : outPath;
  const localPath = `${stem}.local.html`;
  const localHtml = '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
    + `${headHtml}\n</head>\n<body>\n${bodyHtml}</body>\n</html>\n`;
  // Portable Markdown twin: a parallel agent can read it from disk / be pasted it.
  const { markdown } = toMarkdown(ledger, type);
  const mdPath = `${stem}.md`;
  // FAIL-CLOSED gate (ADR-003) — scan BOTH renderings BEFORE any write. If
  // EITHER is unclean, throw and write NO file (the local wrapper included).
  const rh = scan(html);
  if (!rh.clean) throw new Error(`fail-closed: rendered artifact contains ${rh.hits.map((h) => h.category).join(', ')}`);
  const rm = scan(markdown);
  if (!rm.clean) throw new Error(`fail-closed: rendered markdown twin contains ${rm.hits.map((h) => h.category).join(', ')}`);
  for (const w of lintWarnings) console.error(w); // both scans passed — the buffered lint may speak now
  await writeFile(outPath, html, 'utf8'); // same path => agent re-publishes => same URL
  await writeFile(localPath, localHtml, 'utf8'); // the browser-ready sibling (open-artifact.mjs prefers it)
  await writeFile(mdPath, markdown, 'utf8');
  return { outPath, bytes: html.length, mdPath, mdBytes: markdown.length, localPath, localBytes: localHtml.length };
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

const sha8 = (value) => createHash('sha256').update(String(value)).digest('hex').slice(0, 8);

// Sanitized CLI error categories: the catch below never prints raw e.message —
// unknown-block / unknown-type errors interpolate ledger-derived names, so a
// secret-shaped value could otherwise reach stderr BEFORE the secret scan runs.
// Those two categories carry an 8-char sha256 locator instead, so the ledger
// author can find the offending value (hash their candidates) without it ever
// being echoed. Everything else maps to a fixed word.
export function cliErrorCategory(e) {
  if (e?.code === 2) return 'usage';
  if (e instanceof SyntaxError) return 'parse-error'; // JSON.parse rejected the ledger
  const msg = String(e?.message ?? e);
  let m = /^unknown block type: ([\s\S]*)$/.exec(msg);
  if (m) return `unknown-block ${sha8(m[1])}`;
  m = /^unknown artifact type: ([\s\S]*)$/.exec(msg);
  if (m) return `unknown-type ${sha8(m[1])}`;
  if (msg.startsWith('fail-closed:')) return 'scan-rejected';
  return 'render-error';
}

if (isMain(import.meta.url)) {
  cli(process.argv.slice(2))
    .then((r) => console.log(JSON.stringify(r)))
    .catch((e) => {
      console.error(cliErrorCategory(e));
      process.exit(e?.code === 2 ? 2 : 1);
    });
}
