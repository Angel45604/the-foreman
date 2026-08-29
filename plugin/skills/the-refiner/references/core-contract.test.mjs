import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
