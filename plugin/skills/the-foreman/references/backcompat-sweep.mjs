// Local read-only back-compat sweep (execution plan Task 12, Step 3).
//
// NOT a test (machine-specific: it reads the REAL ledger corpus under
// ~/.claude/the-foreman/**/*.json) and NOT part of `node --test` — run it by
// hand from the repo root:
//
//   node plugin/skills/the-foreman/references/backcompat-sweep.mjs
//
// For every .json under the corpus root that parses as an object carrying
// `meta`, it runs every template whose typed section is present PLUS that
// type's Markdown twin, ENTIRELY IN MEMORY — it writes nothing, anywhere.
//
// OUTPUT CONTRACT (privacy crux): one line per ledger, `path: OK` or
// `path: FAIL <category>`, where <category> comes from the FIXED set below.
// NEVER error.message and never any ledger content — the engine's own
// fail-closed errors interpolate ledger-derived strings (e.g. the unknown
// block type), so messages must not pass through to stdout/stderr.
// Exits non-zero if any ledger FAILs. The sweep's self-tests live in
// backcompat.test.mjs and run against fixture paths, never the home glob.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { isMain } from './is-main.mjs';
import * as templates from './templates.mjs';
import { toMarkdown } from './markdown.mjs';

// Section → template mapping (design §6). backcompat.test.mjs pins this to be
// IDENTICAL to the suite's own literal oracle — the sweep can never quietly
// check fewer types than the tests do.
export const SECTION_TEMPLATES = {
  slides: 'planDeck',
  win: 'brief',
  decision: 'decisionCard',
  liveRun: 'liveRun',
  phaseTracker: 'phaseTracker',
  findings: 'findings',
  comparison: 'comparison',
  dashboard: 'dashboard',
};

// The FIXED category vocabulary — every error maps into one of these words;
// nothing else ever reaches the output.
//   parse-error    — the file could not be read/JSON.parsed
//   unknown-block  — the fail-closed registry rejected a block type (HTML or twin)
//   template-throw — any other throw while rendering the HTML body
//   twin-throw     — any other throw while rendering the Markdown twin
const categorize = (e, phase) =>
  (/^unknown block type: /.test(String(e?.message ?? '')) ? 'unknown-block' : phase);

// Run every applicable template + twin over one parsed ledger, in memory.
// Returns null when everything renders, else the first failure's category.
export function sweepLedger(ledger) {
  for (const [section, type] of Object.entries(SECTION_TEMPLATES)) {
    if (ledger?.[section] == null) continue;
    try {
      templates[type](ledger);
    } catch (e) {
      return categorize(e, 'template-throw');
    }
    try {
      toMarkdown(ledger, type);
    } catch (e) {
      return categorize(e, 'twin-throw');
    }
  }
  return null;
}

// Walk rootDir recursively for *.json, sweep each ledger, and log one line per
// ledger via `log` (injectable so the self-tests can capture output). A file
// that parses to anything other than an object with `meta` is not a ledger and
// is skipped silently. Read-only throughout.
export function sweep(rootDir, log = console.log) {
  const files = readdirSync(rootDir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.json'))
    .map((e) => join(e.parentPath, e.name))
    .sort();
  let checked = 0;
  let failures = 0;
  for (const path of files) {
    let ledger;
    try {
      ledger = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      checked += 1;
      failures += 1;
      log(`${path}: FAIL parse-error`);
      continue;
    }
    if (!ledger || typeof ledger !== 'object' || Array.isArray(ledger) || ledger.meta == null) continue;
    checked += 1;
    const category = sweepLedger(ledger);
    if (category) {
      failures += 1;
      log(`${path}: FAIL ${category}`);
    } else {
      log(`${path}: OK`);
    }
  }
  return { checked, failures };
}

if (isMain(import.meta.url)) {
  const root = join(homedir(), '.claude', 'the-foreman');
  if (!existsSync(root)) {
    console.log(`no ledger corpus at ${root} — nothing to sweep`);
    process.exit(0);
  }
  const { checked, failures } = sweep(root);
  console.log(`swept ${checked} ledgers, ${failures} FAIL`);
  process.exit(failures > 0 ? 1 : 0);
}
