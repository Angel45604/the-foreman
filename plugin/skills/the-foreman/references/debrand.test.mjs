// De-brand guard (execution plan Task 13; design §9): the four engine-owned
// docs — SKILL.md, references/ledger.schema.md, evals/evals.json, the repo
// README — plus EVERY shipping source under references/ (*.mjs / *.js / *.css,
// tests included) must carry none of the forbidden legacy-brand strings. The
// scan has NO carve-outs: a test that needs a NEGATIVE assertion against one of
// these strings builds its regex from split halves (see FORBIDDEN_BRAND_RE in
// test-helpers.mjs) instead of exempting its file here. fixtures/*.json sit
// outside the scope BY DESIGN — they pin real legacy ledger shapes (including
// the old accent) that the back-compat contract requires the engine to accept.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { FORBIDDEN_BRAND_RE, debrandOffenses } from './test-helpers.mjs';

const HERE = dirname(fileURLToPath(import.meta.url)); // …/plugin/skills/the-foreman/references
const ROOT = join(HERE, '..', '..', '..', '..'); // the repo root

test('the scan predicate bites on every forbidden form (positive controls, assembled at runtime)', () => {
  for (const bad of ['Mind' + 'Cloud', 'MIND' + 'CLOUD', 'mind' + 'cloud',
    '#009' + 'ACC', '#009' + 'acc', '#2d' + '323b', '#2D' + '323B', 'slide-' + 'engine']) {
    assert.ok(FORBIDDEN_BRAND_RE.test(bad), `predicate must match: ${bad}`);
  }
  // the blessed representations stay clean: render.mjs's numeric house-default
  // set and the Gate Board page script that replaced the retired engine.
  assert.ok(!FORBIDDEN_BRAND_RE.test('0x009acc, 0x5b7cfa'));
  assert.ok(!FORBIDDEN_BRAND_RE.test('gate-board.js'));
});

test('de-brand: docs, evals, README, and every references/ source are free of forbidden strings', () => {
  const files = [
    join(HERE, '..', 'SKILL.md'),
    join(HERE, 'ledger.schema.md'),
    join(HERE, '..', 'evals', 'evals.json'),
    join(ROOT, 'README.md'),
    ...readdirSync(HERE).filter((f) => /\.(mjs|js|css)$/.test(f)).sort().map((f) => join(HERE, f)),
  ];
  const offenses = files.flatMap((f) =>
    debrandOffenses(readFileSync(f, 'utf8')).map((o) => `${relative(ROOT, f)}:${o}`));
  assert.deepEqual(offenses, [], 'forbidden legacy-brand strings survive in scan scope');
});
