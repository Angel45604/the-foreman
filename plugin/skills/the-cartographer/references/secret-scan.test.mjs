// the-cartographer — tests for the fail-closed secret scan (ADR C-008, Task 8).
//
// The scan runs on EVERY artifact before ANY of them is written, so a false negative ships a secret
// and a false positive only costs a regeneration. It is tuned accordingly.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { scan, PATTERN_NAMES } from './secret-scan.mjs';

const categories = (text) => scan(text).hits.map((h) => h.category).sort();

/** One planted secret per pattern the ADR names. The category is what the report must say. */
const PLANTED = [
  ['aws_access_key_id', 'AKIAIOSFODNN7EXAMPLE'],
  ['aws_access_key_id', 'ASIAIOSFODNN7EXAMPLE'],
  ['anthropic_key', 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789-AA'],
  ['openai_key', 'sk-abcdefghijklmnopqrstuvwxyz0123'],
  ['openai_key', 'sk-proj-abcdefghijklmnopqrstuvwxyz0123456789'],
  ['openai_key', 'sk-svcacct-abcdefghijklmnopqrstuvwxyz0123456789'],
  ['github_token', 'ghp_abcdefghijklmnopqrstuvwxyz0123456789'],
  ['github_token', 'gho_abcdefghijklmnopqrstuvwxyz0123456789'],
  ['github_fine_grained_pat', 'github_pat_11ABCDEFG0abcdefghijklmnop_qrstuvwxyz0123456789'],
  ['slack_token', 'xoxb-123456789012-1234567890123-abcdefghijklmnopqrstuvwx'],
  ['slack_token', 'xoxp-123456789012-1234567890123-abcdefghijklmnopqrstuvwx'],
  ['google_api_key', 'AIzaSyA1234567890abcdefghijklmnopqrstuvw'],
  ['private_key_block', '-----BEGIN RSA PRIVATE KEY-----'],
  ['private_key_block', '-----BEGIN OPENSSH PRIVATE KEY-----'],
  ['private_key_block', '-----BEGIN PRIVATE KEY-----'],
  ['private_key_block', '-----BEGIN EC PRIVATE KEY-----'],
  ['bearer_or_jwt', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc'],
  ['db_url_with_creds', 'postgres://someuser:somepassword@db.internal:5432/app'],
  ['generic_secret_assign', 'password = hunter2hunter2'],
  ['generic_secret_assign', 'api_key: "abcdefghijklmnop"'],
  ['generic_secret_assign', 'token=abcdefghijklmnop'],
  ['generic_secret_assign', 'secret: swordfish12345'],
  ['generic_secret_assign', 'client_secret=abcdefghijklmnopqrst'],
  ['email_pii', 'angel@example.com'],
];

test('1 · clean text passes', () => {
  const result = scan('# tiny — map\n\nA fixture subject with two files and four planted drift cases.\n');
  assert.equal(result.clean, true);
  assert.deepEqual(result.hits, []);
});

test('2 · empty and absent input are clean, and never throw', () => {
  for (const value of ['', null, undefined]) {
    assert.equal(scan(value).clean, true);
  }
});

test('3 · every named pattern fails closed on a planted secret', () => {
  for (const [category, planted] of PLANTED) {
    const result = scan(`before ${planted} after`);
    assert.equal(result.clean, false, `NOT DETECTED (${category}): ${planted}`);
    assert.ok(
      result.hits.some((h) => h.category === category),
      `detected as ${JSON.stringify(result.hits.map((h) => h.category))}, expected ${category}: ${planted}`,
    );
  }
});

test('4 · reports EVERY distinct pattern that matched, not just the first', () => {
  const text = [
    'AKIAIOSFODNN7EXAMPLE',
    'ghp_abcdefghijklmnopqrstuvwxyz0123456789',
    '-----BEGIN OPENSSH PRIVATE KEY-----',
    'angel@example.com',
  ].join('\n');
  const found = categories(text);
  assert.deepEqual(found, ['aws_access_key_id', 'email_pii', 'github_token', 'private_key_block']);
});

test('5 · one category is reported ONCE however many times it matches', () => {
  const text = 'AKIAIOSFODNN7EXAMPLE and AKIAJJJJJJJJJJJJJJJJ and AKIAKKKKKKKKKKKKKKKK';
  assert.deepEqual(categories(text), ['aws_access_key_id']);
});

test('6 · ADR C-008 — any email-shaped string is refused, so ownership renders as a handle', () => {
  assert.equal(scan('maintained by ada@example.co.uk').clean, false);
  assert.equal(scan('maintained by @ada').clean, true, 'a handle is the documented alternative');
});

test('7 · a hit names its category and the matched pattern, so the report is actionable', () => {
  const { hits } = scan('AKIAIOSFODNN7EXAMPLE');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].category, 'aws_access_key_id');
  assert.ok(PATTERN_NAMES.includes(hits[0].category));
});

test('7b · a hit carries the CATEGORY only — never the matched secret', () => {
  const secret = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';
  const { hits } = scan(`token in prose: ${secret}`);
  const serialized = JSON.stringify(hits);
  assert.ok(!serialized.includes(secret), 'the scanner leaked the credential into its own result');
  assert.ok(!serialized.includes('abcdefghij'));
  assert.deepEqual(Object.keys(hits[0]), ['category']);
});

test('8 · the scan is stateless — a global regex cannot skip a second call', () => {
  // A /g regex carries lastIndex between calls, so the same input can pass on an alternate call.
  const text = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 4; i += 1) {
    assert.equal(scan(text).clean, false, `call ${i} let the token through`);
  }
});

test('9 · plausible map content does NOT trip the scan (false positives cost regenerations)', () => {
  const innocuous = [
    'plugin/skills/the-cartographer/references/fixtures/tiny/run.sh',
    'sha256: d5286c885592c751e46e8024d10afd7ebc4ce85869c9cec7ed25a0ccdeff0f5c',
    'e.control.mode.check>outcome.pass',
    'TINY_DEBUG=1 prints each mode as it starts.',
    'printf \'core ran for %s\\n\' "$1"',
    'flowchart LR',
    'The doc says check prints "check ran"; the code prints "core ran for check".',
    'stateDiagram-v2',
    'A dispatch table maps each mode to its function.',
  ].join('\n');
  const result = scan(innocuous);
  assert.equal(result.clean, true, `false positive: ${JSON.stringify(result.hits)}`);
});

test('10 · PATTERN_NAMES covers every category the ADR names, with no duplicates', () => {
  assert.equal(new Set(PATTERN_NAMES).size, PATTERN_NAMES.length);
  for (const [category] of PLANTED) assert.ok(PATTERN_NAMES.includes(category), `missing ${category}`);
});
