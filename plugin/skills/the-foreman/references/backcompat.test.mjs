// Back-compat corpus (execution plan Task 12; design §4/§8): every legacy
// ledger shape that exists in the wild must keep rendering — no throw, real
// output, the Gate Board rail present, and no NaN/Infinity/undefined leaking
// into markup. The fixtures under ./fixtures/ pin the shapes the real
// ~/.claude/the-foreman corpus contains (the sweep script checks the real
// corpus itself, locally and read-only — see backcompat-sweep.mjs).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as templates from './templates.mjs';
import { toMarkdown } from './markdown.mjs';
import { sweep, SECTION_TEMPLATES as SWEEP_SECTION_TEMPLATES } from './backcompat-sweep.mjs';

const FIXDIR = fileURLToPath(new URL('./fixtures/', import.meta.url));
const readFixture = (name) => JSON.parse(readFileSync(join(FIXDIR, name), 'utf8'));

// Section → template oracle (design §6): a ledger is renderable by every
// template whose typed section it carries. This LITERAL mapping is the pinned
// contract; the sweep script must export the identical mapping (drift-guarded
// below) so the local sweep can never quietly check fewer types than the suite.
const SECTION_TEMPLATES = {
  slides: 'planDeck',
  win: 'brief',
  decision: 'decisionCard',
  liveRun: 'liveRun',
  phaseTracker: 'phaseTracker',
  findings: 'findings',
  comparison: 'comparison',
  dashboard: 'dashboard',
};
const applicableTypes = (ledger) =>
  Object.entries(SECTION_TEMPLATES).filter(([section]) => ledger?.[section] != null).map(([, t]) => t);

// The corpus — each fixture is a REAL legacy shape (see execution plan Task 12):
//   legacy-plandeck     — the full pre-redesign reference ledger (slides+chapters+
//                         findings+liveRun+decision+win; statRow/table/pillRow/
//                         phaseSteps/rankedRows blocks; the legacy house accent
//                         — held as a #-hex literal ONLY in the fixture itself)
//   legacy-minimal      — the smallest ledger the engine ever accepted
//   legacy-allblocks    — one slide per remaining legacy block type
//   legacy-dup-chapters — NON-consecutive repeated chapter labels
//   legacy-sections     — all eight typed sections in one ledger
const FIXTURES = [
  'legacy-plandeck.json',
  'legacy-minimal.json',
  'legacy-allblocks.json',
  'legacy-dup-chapters.json',
  'legacy-sections.json',
];

for (const name of FIXTURES) {
  test(`back-compat: ${name} renders every applicable type, HTML + twin`, () => {
    const ledger = readFixture(name);
    const types = applicableTypes(ledger);
    assert.ok(types.length > 0, `${name} must be renderable by at least one template`);
    for (const type of types) {
      const { title, bodyHtml } = templates[type](ledger);
      assert.ok(String(title).length > 0, `${name} × ${type}: title non-empty`);
      assert.ok(bodyHtml.length > 0, `${name} × ${type}: HTML non-empty`);
      assert.match(bodyHtml, /class="nav"/, `${name} × ${type}: the Gate Board rail is on the page`);
      assert.doesNotMatch(bodyHtml, /\b(NaN|Infinity|undefined)\b/, `${name} × ${type}: no unguarded value leaks`);
      const { markdown } = toMarkdown(ledger, type);
      assert.ok(markdown.trim().length > 0, `${name} × ${type}: twin non-empty`);
    }
  });
}

test('legacy-sections.json exercises ALL eight templates from one fixture', () => {
  assert.deepEqual(applicableTypes(readFixture('legacy-sections.json')).sort(),
    Object.values(SECTION_TEMPLATES).sort());
});

test('legacy-dup-chapters: non-consecutive repeats get collision-safe unique section ids (a, b, a-2)', () => {
  const { bodyHtml } = templates.planDeck(readFixture('legacy-dup-chapters.json'));
  for (const id of ['a', 'b', 'a-2']) {
    assert.match(bodyHtml, new RegExp(`<section class="chap" id="${id}"`), `section #${id} exists`);
    assert.match(bodyHtml, new RegExp(`href="#${id}"`), `rail chip targets #${id}`);
  }
  const ids = [...bodyHtml.matchAll(/<section class="chap" id="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length, 'every section id unique');
});

// ---- the local read-only sweep (backcompat-sweep.mjs) ----
// These tests run the sweep against FIXTURE paths in a temp root — never the
// real ~/.claude/the-foreman glob (that stays a local, machine-specific check).

test('the sweep exports the IDENTICAL section→template mapping this suite pins (no drift)', () => {
  assert.deepEqual(SWEEP_SECTION_TEMPLATES, SECTION_TEMPLATES);
});

test('sweep: a healthy ledger reports "path: OK"; a meta-less json is silently skipped', () => {
  const root = mkdtempSync(join(tmpdir(), 'foreman-sweep-'));
  writeFileSync(join(root, 'ledger.json'), readFileSync(join(FIXDIR, 'legacy-minimal.json')));
  writeFileSync(join(root, 'not-a-ledger.json'), '{"no":"meta"}');
  const lines = [];
  const { checked, failures } = sweep(root, (l) => lines.push(l));
  assert.equal(checked, 1);
  assert.equal(failures, 0);
  assert.deepEqual(lines, [`${join(root, 'ledger.json')}: OK`]);
});

test('sweep: a secret-shaped unknown block type reports FAIL unknown-block — the secret NEVER reaches output', () => {
  const secret = 'sk-ant-api03-deadbeefdeadbeefdead';
  const root = mkdtempSync(join(tmpdir(), 'foreman-sweep-'));
  writeFileSync(join(root, 'ledger.json'), JSON.stringify({
    meta: { title: 'poisoned' },
    slides: [{ heading: 'h', blocks: [{ type: secret }] }],
  }));
  const lines = [];
  const { failures } = sweep(root, (l) => lines.push(l));
  assert.equal(failures, 1);
  assert.deepEqual(lines, [`${join(root, 'ledger.json')}: FAIL unknown-block`]);
  assert.ok(!lines.join('\n').includes(secret), 'the ledger-derived block type must never be echoed');
});

test('sweep: unparseable json reports FAIL parse-error (fixed category, not the parser message)', () => {
  const root = mkdtempSync(join(tmpdir(), 'foreman-sweep-'));
  writeFileSync(join(root, 'broken.json'), '{"meta": {"title": "sk-ant-api03-oops"');
  const lines = [];
  const { failures } = sweep(root, (l) => lines.push(l));
  assert.equal(failures, 1);
  assert.deepEqual(lines, [`${join(root, 'broken.json')}: FAIL parse-error`]);
});

test('sweep: recurses into subdirectories and NEVER writes anything under the root', () => {
  const root = mkdtempSync(join(tmpdir(), 'foreman-sweep-'));
  mkdirSync(join(root, 'nested', 'deeper'), { recursive: true });
  writeFileSync(join(root, 'nested', 'deeper', 'ledger.json'), readFileSync(join(FIXDIR, 'legacy-sections.json')));
  const before = readdirSync(root, { recursive: true }).map(String).sort();
  const lines = [];
  const { checked, failures } = sweep(root, (l) => lines.push(l));
  assert.equal(checked, 1);
  assert.equal(failures, 0);
  assert.deepEqual(lines, [`${join(root, 'nested', 'deeper', 'ledger.json')}: OK`]);
  assert.deepEqual(readdirSync(root, { recursive: true }).map(String).sort(), before, 'in-memory only — no file created or removed');
});
