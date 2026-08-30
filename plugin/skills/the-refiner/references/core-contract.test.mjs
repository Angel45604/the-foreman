import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const contract = readFileSync(join(here, 'core-contract.md'), 'utf8');
const style = readFileSync(join(here, '..', '..', '..', 'output-styles', 'plain-voice.md'), 'utf8');

test('the style body between Voice and Diagnostics IS the core contract, byte for byte', () => {
  const start = style.indexOf('## Voice');
  const end = style.indexOf('## Diagnostics');
  assert.ok(start >= 0 && end > start, 'style must contain Voice before Diagnostics');
  assert.strictEqual(style.slice(start, end), contract,
    'plugin/output-styles/plain-voice.md body must equal references/core-contract.md byte for byte');
});

test('the style frontmatter has no force-for-plugin key at all', () => {
  const fmEnd = style.indexOf('---', 3);
  const fm = style.slice(0, fmEnd);
  assert.ok(!/force-for-plugin/i.test(fm), 'the frontmatter must not contain a force-for-plugin key');
});

test('the core contract carries exactly the five contract sections', () => {
  const heads = contract.split('\n').filter(l => l.startsWith('## '));
  assert.deepEqual(heads, [
    '## Voice',
    '## Banned patterns',
    '## Truth',
    '## Preserve verbatim when rewriting prose',
    '## Scope',
  ]);
});

test('ai-tells.md points back at the core contract by path', () => {
  const aiTells = readFileSync(join(here, 'ai-tells.md'), 'utf8');
  assert.ok(aiTells.includes('references/core-contract.md'),
    'ai-tells.md must reference references/core-contract.md');
});

test('ai-tells.md has exactly ten groups', () => {
  const aiTells = readFileSync(join(here, 'ai-tells.md'), 'utf8');
  const heads = aiTells.split('\n').filter(l => l.startsWith('## '));
  assert.strictEqual(heads.length, 10, 'ai-tells.md must have exactly ten "## " headings');
});

test('none of the shipped files contains an em dash', () => {
  const emDash = '\u2014';
  const beforeAfter = readFileSync(join(here, 'before-after.md'), 'utf8');
  const aiTells = readFileSync(join(here, 'ai-tells.md'), 'utf8');
  const skill = readFileSync(join(here, '..', 'SKILL.md'), 'utf8');
  assert.ok(!contract.includes(emDash), 'core-contract.md must not contain an em dash');
  assert.ok(!aiTells.includes(emDash), 'ai-tells.md must not contain an em dash');
  assert.ok(!beforeAfter.includes(emDash), 'before-after.md must not contain an em dash');
  assert.ok(!style.includes(emDash), 'the output style must not contain an em dash');
  assert.ok(!skill.includes(emDash), 'SKILL.md must not contain an em dash');
});

function pairsOf(md) {
  const parts = md.split(/^### (\d+)\. /m);
  const out = [];
  for (let i = 1; i < parts.length; i += 2) out.push({ n: Number(parts[i]), body: parts[i + 1] });
  return out;
}

function sidesOf(body) {
  const BEFORE = '**Before:**';
  const AFTER = '**After:**';
  const b = body.indexOf(BEFORE);
  const a = body.indexOf(AFTER);
  if (b < 0 || a <= b) throw new Error('malformed pair: expected **Before:** then **After:**');
  return { before: body.slice(b + BEFORE.length, a), after: body.slice(a + AFTER.length) };
}

function fencesOf(text) {
  return [...text.matchAll(/^```[^\n]*\n[\s\S]*?^```$/gm)].map((m) => m[0]);
}

test('before-after.md carries exactly nine exemplar pairs, numbered in order', () => {
  const md = readFileSync(join(here, 'before-after.md'), 'utf8');
  const ps = pairsOf(md);
  assert.strictEqual(ps.length, 9, 'before-after.md must hold exactly nine pairs');
  assert.deepEqual(ps.map((p) => p.n), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.strictEqual((md.match(/\*\*Before:\*\*/g) || []).length, 9);
  assert.strictEqual((md.match(/\*\*After:\*\*/g) || []).length, 9);
});

test('the header states the tail rule', () => {
  const md = readFileSync(join(here, 'before-after.md'), 'utf8');
  const header = md.slice(0, md.indexOf('### 1.'));
  assert.match(header, /checkable claim or an actionable statement is restated as a direct sentence, and a tail that only inflates significance is dropped/);
});

test('pair 1 preserves its numerals byte for byte across the rewrite', () => {
  const md = readFileSync(join(here, 'before-after.md'), 'utf8');
  const p1 = pairsOf(md).find((p) => p.n === 1);
  assert.ok(p1, 'pair 1 must exist');
  const { before, after } = sidesOf(p1.body);
  const digits = (s) => (s.match(/\d+/g) || []).join(',');
  const latency = (s) => (s.match(/\d+ms/g) || []).join(',');
  assert.strictEqual(latency(before), '420ms,90ms', 'pair 1 Before must carry the latency numerals');
  assert.strictEqual(latency(after), '420ms,90ms', 'and the After must carry them identically');
  assert.strictEqual(digits(after), digits(before), 'every numeral must survive the rewrite unchanged');
});

test('pair 9 keeps heading level and list structure across the rewrite', () => {
  const md = readFileSync(join(here, 'before-after.md'), 'utf8');
  const p9 = pairsOf(md).find((p) => p.n === 9);
  assert.ok(p9, 'pair 9 must exist');
  const { before, after } = sidesOf(p9.body);
  for (const [side, text] of [['Before', before], ['After', after]]) {
    assert.match(text, /^#### Upgrade Notes$/m, `pair 9 ${side} must keep the h4 heading verbatim`);
    assert.strictEqual((text.match(/^- /gm) || []).length, 3, `pair 9 ${side} must hold three list items`);
  }
});

test('pair 9 keeps its fenced code block byte for byte', () => {
  const md = readFileSync(join(here, 'before-after.md'), 'utf8');
  const p9 = pairsOf(md).find((p) => p.n === 9);
  assert.ok(p9, 'pair 9 must exist');
  const { before, after } = sidesOf(p9.body);
  const fb = fencesOf(before);
  const fa = fencesOf(after);
  assert.strictEqual(fb.length, 1, 'pair 9 Before must hold exactly one fenced block');
  assert.strictEqual(fa.length, 1, 'pair 9 After must hold exactly one fenced block');
  assert.strictEqual(fa[0], fb[0], 'the fenced code block must be byte-identical');
  for (const [side, text] of [['Before', before], ['After', after]]) {
    assert.doesNotMatch(text, /^```[ \t]+$/m, `pair 9 ${side} must not pad a fence delimiter`);
  }
});

// before-after.md is case law: SKILL.md instructs the-refiner to read this file before
// producing any output, so an unnoticed edit changes shipped behavior. This pin makes every
// change deliberate, the same byte-identity posture this file already applies to the output
// style body and to pair 9's fenced block.
//
// It is CHANGE CONTROL, not semantic validation. It proves the canonical exemplars changed.
// It cannot prove a hedge was weakened or a number altered. A human reading the diff is the
// semantic oracle. To change an exemplar on purpose: make the edit, read the diff, satisfy
// yourself the Before-to-After promise still holds, then update this digest in the same commit.
const BEFORE_AFTER_SHA256 = '82778aa8861f85a1c5da4396b36db0bf18b1cabebaf80c36fb07e546480a2e6b';

test('the skill still instructs the-refiner to read the exemplar pairs', () => {
  const skill = readFileSync(join(here, '..', 'SKILL.md'), 'utf8');
  assert.match(skill, /references\/before-after\.md/,
    'SKILL.md must still tell the-refiner to read the exemplar pairs. If it no longer does, the golden pin below is guarding a file nothing reads, and both should be revisited.');
});

test('the exemplar pairs file matches its golden digest', () => {
  const md = readFileSync(join(here, 'before-after.md'));
  const actual = createHash('sha256').update(md).digest('hex');
  assert.strictEqual(actual, BEFORE_AFTER_SHA256,
    'before-after.md changed. This is change control, not a semantic failure: the file may be fine. Read the diff, confirm the Before-to-After promise still holds for every pair, then update BEFORE_AFTER_SHA256 in this test to the new digest.');
});
