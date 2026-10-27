// the-cartographer — the table-column vocabulary, bound across the validator and BOTH renderers.
//
// The defect this file exists to make impossible, in full:
//
//   Run 3's capabilities table declared a column called `What it does`. It folds to `whatitdoes`,
//   which neither renderer had a derivation for, so `cellFor` fell through to its placeholder and
//   ALL 125 rows read `(no value for this column)`. The validator saw a non-empty string and called
//   the map legal; the renderers filled and did not complain; no test touched the placeholder path.
//   The page looked complete and the column said nothing — PDR §14's "confident wrong map".
//
// Two rules close it, and the second is why this file is separate from `validate.test.mjs`:
//
//   1. `validate.mjs` FAILS CLOSED on a column outside the vocabulary (asserted in
//      `validate.test.mjs` 10b, where the contract's other closed sets are asserted).
//   2. The vocabulary is ONE statement. It was three implicit ones — a `COLUMN_VALUE` map in
//      `markdown.mjs`, another in `render.mjs`, and now a validator rule — and three copies of a
//      list inside a tool whose entire purpose is auditing duplicated statements that drift apart is
//      not a risk to be watched, it is the defect being shipped. So both renderers IMPORT the key
//      set, and what remains hand-maintained — each renderer's `COLUMN_VALUE` entries — is pinned
//      here against it, in BOTH directions:
//
//        • a key in the vocabulary that a renderer cannot derive  → that column renders placeholders
//          in that output, which is the original defect wearing a different name;
//        • a key a renderer derives that the vocabulary omits     → the validator refuses a column
//          the renderer would have filled perfectly well, and the extractor is told a working name
//          is illegal.
//
// Neither direction is hypothetical: the first is precisely what happened, and the second is what a
// well-meaning "just teach the renderer this one extra name" patch produces.
//
// Zero dependencies: node built-ins only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { TABLE_COLUMN_KEYS, foldColumnName, validate } from './validate.mjs';
import { DERIVABLE_COLUMN_KEYS as MARKDOWN_KEYS, toMarkdown } from './markdown.mjs';
import { DERIVABLE_COLUMN_KEYS as HTML_KEYS, renderPage } from './render.mjs';
import { computeDrift } from './diff.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../../../..');
const FIXTURE = path.join(HERE, 'fixtures', 'tiny.map.json');
const load = () => JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

const PLACEHOLDER = '(no value for this column)';
const sorted = (keys) => [...keys].sort();

// ─── the drift guard ─────────────────────────────────────────────────────────────────────────────

test('DRIFT GUARD · both renderers derive EXACTLY the vocabulary validate.mjs exports', () => {
  // Not "at least" and not "at most" — exactly, and stated as one comparison per renderer so a
  // failure names which side gained or lost a key.
  assert.deepEqual(sorted(MARKDOWN_KEYS), sorted(TABLE_COLUMN_KEYS),
    'markdown.mjs must derive every legal column and no illegal one — a key the vocabulary has and '
    + 'this renderer lacks renders `(no value for this column)` in every row of map.md; a key it '
    + 'derives that the vocabulary omits makes validate() refuse a column that works');
  assert.deepEqual(sorted(HTML_KEYS), sorted(TABLE_COLUMN_KEYS),
    'render.mjs must derive every legal column and no illegal one — same two failures, in map.html');

  // …and therefore to each other. Asserted rather than inferred: two renderers that agree with the
  // validator agree with each other only while the transitive step actually holds, and this is the
  // sentence a reader of a failure will want to see.
  assert.deepEqual(sorted(MARKDOWN_KEYS), sorted(HTML_KEYS),
    'the two renderers must fill the same set of columns — a table that is complete in map.html and '
    + 'full of placeholders in map.md is the same defect, half-shipped');

  // The vocabulary is a SET, not a bag: a duplicated key would make the two `deepEqual`s above pass
  // while the counts disagreed with the number of distinct columns anyone can actually write.
  for (const [what, keys] of [['the vocabulary', TABLE_COLUMN_KEYS],
    ['markdown.mjs', MARKDOWN_KEYS], ['render.mjs', HTML_KEYS]]) {
    assert.equal(new Set(keys).size, keys.length, `${what} must not name one column twice`);
  }

  // Every key is already folded, so `foldColumnName` is a no-op on it. If it is not, the set holds a
  // spelling no column name can ever match and that entry is dead — the silent-empty defect again,
  // one level up.
  for (const key of TABLE_COLUMN_KEYS) {
    assert.equal(foldColumnName(key), key,
      `${JSON.stringify(key)} is not in folded form — no column name could ever match it`);
  }
});

// ─── the guard is about BEHAVIOUR, not about two lists agreeing ──────────────────────────────────
//
// The assertions above compare exported values, and an exported value can be right while the code
// that reads it is wrong. So the same claim is made again through the only interface that matters:
// render each legal column and read the cell.

test('every legal column produces a REAL cell in map.md and map.html — no placeholders anywhere', () => {
  const map = load();
  const view = map.views.find((v) => v.form === 'table');
  const { findings } = computeDrift(map);

  for (const column of TABLE_COLUMN_KEYS) {
    view.columns = ['Capability', column];

    const md = toMarkdown(map, findings, { generatedAt: 'STAMP' });
    assert.ok(!md.includes(PLACEHOLDER),
      `map.md rendered ${PLACEHOLDER} for the legal column ${JSON.stringify(column)}`);

    const html = renderPage(map, findings, { generatedAt: 'STAMP' });
    assert.ok(!html.includes(PLACEHOLDER),
      `map.html rendered ${PLACEHOLDER} for the legal column ${JSON.stringify(column)}`);
  }
});

test('the vocabulary and the validator are the same rule — every legal name validates, and only those', () => {
  const map = load();
  const view = map.views.find((v) => v.form === 'table');

  for (const column of TABLE_COLUMN_KEYS) {
    view.columns = ['Capability', column];
    assert.deepEqual(validate(map, { repoRoot: REPO_ROOT }).errors, [],
      `${JSON.stringify(column)} is derivable by both renderers, so validate() must accept it`);
  }

  // The four names that made this rule necessary: each is a perfectly reasonable thing to write, each
  // folds to nothing any renderer knows, and each would have rendered a full column of placeholders.
  // They are listed to make the point an alias cannot fix — `whatitdoes` was only the first.
  for (const column of ['What it does', 'Purpose', 'Role', 'What it is']) {
    view.columns = ['Capability', column];
    const errors = validate(map, { repoRoot: REPO_ROOT }).errors.join('\n');
    assert.match(errors, new RegExp(column),
      `${JSON.stringify(column)} is derivable by neither renderer, so validate() must refuse it by name`);
  }
});

// ─── the artifact that proves the rule was needed ────────────────────────────────────────────────

test('run 3\'s committed map.json is REFUSED by the rule it violated — the record stays unedited', (t) => {
  const RUN3 = path.join(REPO_ROOT,
    'docs/initiatives/2026-08-11-the-cartographer/run-3-candidate/map.json');
  if (!fs.existsSync(RUN3)) return t.skip('the initiative docs are not present in this checkout');

  const map = JSON.parse(fs.readFileSync(RUN3, 'utf8'));
  const errors = validate(map, { repoRoot: REPO_ROOT }).errors.join('\n');
  assert.match(errors, /What it does/,
    'the artifact that demonstrated the defect must now fail the rule that closes it — it is kept '
    + 'unedited as a dated record of a real contract violation, not repaired into a passing map');
  return undefined;
});
