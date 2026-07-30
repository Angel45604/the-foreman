import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scan } from './secret-scan.mjs';

test('flags common secret shapes', () => {
  for (const bad of [
    'AKIA1234567890ABCDEF', 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz',
    'ghp_0123456789abcdefghijklmnopqrstuvwx', 'xoxb-12345-67890-abcdefABCDEF',
    '-----BEGIN PRIVATE KEY-----', 'Authorization: Bearer eyJhbGciOiJ.eyJzdWIiOiI',
    'postgres://user:p4ss@db.prod:5432/app',
  ]) assert.equal(scan(bad).clean, false, `should flag: ${bad}`);
});
test('flags modern token formats (sk-proj / sk-svcacct / github_pat)', () => {
  for (const bad of [
    'sk-proj-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'sk-svcacct-bbbbbbbbbbbbbbbbbbbbbbbb',
    'github_pat_11ABCDE0000aaaaaaaaaaaa_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  ]) assert.equal(scan(bad).clean, false, `should flag: ${bad}`);
});
test('passes clean prose + safe tokens', () => {
  const r = scan('Phase 2 added render.mjs; 19/19 tests green on commit a1b2c3.');
  assert.equal(r.clean, true); assert.deepEqual(r.hits, []);
});
test('reports categories without echoing the secret value', () => {
  const r = scan('key sk-ant-api03-deadbeefdeadbeefdeadbeef');
  assert.equal(r.clean, false);
  assert.ok(r.hits.every(h => typeof h.category === 'string' && !('value' in h)));
});
