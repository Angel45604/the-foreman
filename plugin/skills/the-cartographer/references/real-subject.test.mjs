// the-cartographer — the READABILITY acceptance layer, on a real subject (ADR C-017, PDR §6.2).
//
// `attention.test.mjs` proves the RULE; this file proves the OUTCOME, and only a real subject can.
// The 6-node `tiny` fixture cannot: every one of its findings is `likely-contract`, which is the
// correct answer for it and says nothing about a 91-node subject whose drift lane was the problem.
//
// The fixture is the map the held-out oracle run produced from `codex-gate` at `ac0daf0` — the same
// 91 nodes, 113 edges and 16 findings recorded in `docs/initiatives/2026-08-11-the-cartographer/
// oracle-run-1.md`, in the canonical serialization `render` would write. It is committed as INPUT,
// not as a golden: nothing here compares bytes, so re-extracting the subject one day changes the
// numbers below and nothing else.
//
// Two properties, and the first is the one that licenses the second:
//
//   RAW        — recall is UNIVERSAL. Same findings, same count, same classes as before bucketing.
//                Every claim about readability is worthless if this one is not exactly true.
//   READABLE   — every high-value and every ambiguous finding is reachable without opening a
//                disclosure, `jq` — an undocumented hard prerequisite — included.
//
// Zero dependencies: node built-ins only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { computeDrift } from './diff.mjs';
import { renderPage } from './render.mjs';
import { toMarkdown } from './markdown.mjs';
import { serialize } from './serialize.mjs';
import { bucketForFinding, groupByAttention } from './attention.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SUBJECT = path.join(HERE, 'fixtures', 'codex-gate.map.json');

const load = () => JSON.parse(fs.readFileSync(SUBJECT, 'utf8'));
const nodeIndex = (map) => new Map(map.nodes.map((n) => [n.id, n]));

/**
 * The 16 findings the held-out run produced, recorded here as the RAW baseline. If bucketing ever
 * changes detection — the one thing it may not do — this list is what notices, because it was
 * written down before the buckets existed.
 */
const BASELINE = [
  ['PHANTOM', 'env.codex_gate_max_rounds'],
  ['UNDOCUMENTED', 'artifact.assembled_packet'],
  ['UNDOCUMENTED', 'component.append_context_if_present'],
  ['UNDOCUMENTED', 'component.build_manifest'],
  ['UNDOCUMENTED', 'component.classify_verdict_file'],
  ['UNDOCUMENTED', 'component.main_dispatch'],
  ['UNDOCUMENTED', 'env.codex_gate_max_file_lines'],
  ['UNDOCUMENTED', 'env.codex_home_dir'],
  ['UNDOCUMENTED', 'external.git'],
  ['UNDOCUMENTED', 'external.jq'],
  ['UNDOCUMENTED', 'outcome.usage_error_exit_2'],
  ['UNDOCUMENTED', 'state.phase_snapshot'],
  ['STALE', 'component.emit_synthetic_approve'],
  ['STALE', 'mode.prepr'],
  ['STALE', 'outcome.overflow'],
  ['UNVERIFIED', 'external.codex_cli_contract_pins'],
];

// ─── the RAW layer ───────────────────────────────────────────────────────────────────────────────

test('R1 · the fixture is the oracle run\'s subject: 91 nodes, 113 edges, 5 views, 14 sources', () => {
  const map = load();
  assert.equal(map.nodes.length, 91);
  assert.equal(map.edges.length, 113);
  assert.equal(map.views.length, 5);
  assert.equal(map.sources.length, 14);
  assert.equal(map.subject.slug, 'codex-gate');
});

test('R2 · recall is UNIVERSAL — the same 16 findings, the same classes, on every node kind', () => {
  const { findings } = computeDrift(load());
  assert.deepEqual(findings.map((f) => [f.class, f.nodeId]), BASELINE);
  assert.equal(findings.length, 16);

  // The point of "universal": findings still land on internal helpers, on intermediate artifacts and
  // on external dependencies — six of the eight node kinds. Bucketing folds some of them away in the
  // page; it removes none of them here.
  const byId = nodeIndex(load());
  const kinds = new Set(findings.map((f) => byId.get(f.nodeId).kind));
  assert.deepEqual([...kinds].sort(),
    ['artifact', 'component', 'env', 'external', 'mode', 'outcome', 'state']);
});

test('R3 · drift.json is unchanged by bucketing — no finding carries a bucket, or any new key', () => {
  const { findings } = computeDrift(load());
  for (const finding of findings) {
    assert.deepEqual(Object.keys(finding).sort(), ['citations', 'class', 'detail', 'label', 'nodeId']);
  }
  // Serialized exactly as `render` writes it, and the bytes are a pure function of the findings.
  const document = { schemaVersion: '1', subject: { slug: 'codex-gate', kind: 'skill' }, findings };
  assert.equal(serialize(document), serialize(JSON.parse(serialize(document))));
});

// ─── the READABILITY layer ───────────────────────────────────────────────────────────────────────

/** The page minus every disclosure region — literally what a reader sees before expanding anything. */
const unexpanded = (html) => html.replace(/<details[\s\S]*?<\/details>/g, '');

test('D1 · the whole drift lane is still in the page — 16 findings, none dropped', () => {
  const map = load();
  const { findings } = computeDrift(map);
  const html = renderPage(map, findings, { generatedAt: 'STAMP' });

  assert.equal(html.split('data-carto-lane="drift"').length - 1, 1);
  for (const finding of findings) {
    assert.ok(html.includes(`<code>${finding.nodeId}</code>`), `${finding.nodeId} missing from the page`);
  }
  assert.ok(html.includes('16 findings'), 'the lane must state the RAW count');
});

test('D2 · every high-value and every ambiguous finding is visible WITHOUT expanding anything', () => {
  const map = load();
  const { findings } = computeDrift(map);
  const byId = nodeIndex(map);
  const visible = unexpanded(renderPage(map, findings, { generatedAt: 'STAMP' }));

  for (const finding of findings) {
    const bucket = bucketForFinding(finding, byId.get(finding.nodeId));
    if (bucket === 'implementation-detail') continue;
    assert.ok(
      visible.includes(`<code>${finding.nodeId}</code>`),
      `${finding.class} ${finding.nodeId} (${bucket}) must be readable without expanding a group`,
    );
  }
});

test('D3 · `jq` — an undocumented hard prerequisite — surfaces for review, never as "just external"', () => {
  // `codex-gate` exits 2 when `jq` is absent and documents it as a prerequisite nowhere. This is the
  // canonical case for the rule that the `external` KIND is collapsible in no lane at all.
  const map = load();
  const { findings } = computeDrift(map);
  const jq = findings.find((f) => f.nodeId === 'external.jq');
  assert.ok(jq, 'the run must still find jq undocumented');
  assert.equal(jq.class, 'UNDOCUMENTED');
  assert.equal(bucketForFinding(jq, nodeIndex(map).get('external.jq')), 'ambiguous-review');

  const visible = unexpanded(renderPage(map, findings, { generatedAt: 'STAMP' }));
  assert.ok(visible.includes('<code>external.jq</code>'));
  assert.ok(visible.includes('<code>external.git</code>'), 'the other external prerequisite too');
});

test('D4 · the two findings the oracle actually wanted are in `likely-contract`', () => {
  const map = load();
  const byId = nodeIndex(map);
  const { findings } = computeDrift(map);
  const bucketOf = (id) => bucketForFinding(findings.find((f) => f.nodeId === id), byId.get(id));

  // Both are `env` nodes sitting in the CORE lane — the exact case that makes lane-demotion of a
  // vocabulary kind a false negative rather than a tidy-up.
  for (const id of ['env.codex_home_dir', 'env.codex_gate_max_file_lines']) {
    assert.equal(byId.get(id).lane, 'core', `fixture precondition: ${id} is drawn in the core lane`);
    assert.equal(bucketOf(id), 'likely-contract', id);
  }
  assert.equal(bucketOf('env.codex_gate_max_rounds'), 'likely-contract', 'the PHANTOM');
});

test('D5 · PHANTOM and STALE are never folded away — including the STALE on an internal helper', () => {
  const map = load();
  const byId = nodeIndex(map);
  const { findings } = computeDrift(map);
  const visible = unexpanded(renderPage(map, findings, { generatedAt: 'STAMP' }));

  for (const finding of findings.filter((f) => f.class !== 'UNDOCUMENTED')) {
    assert.ok(visible.includes(`<code>${finding.nodeId}</code>`), `${finding.class} ${finding.nodeId} was folded away`);
  }
  // The run's most consequential finding sits on `component × core`, the one collapsible cell — so
  // it is the class floor, and nothing else, that keeps it in front of a reader.
  const emit = byId.get('component.emit_synthetic_approve');
  assert.equal(emit.kind, 'component');
  assert.equal(emit.lane, 'core');
  assert.equal(bucketForFinding({ class: 'UNDOCUMENTED' }, emit), 'implementation-detail');
  assert.equal(bucketForFinding({ class: 'STALE' }, emit), 'ambiguous-review');
});

test('D6 · the noise the run surfaced IS folded away — and only internal core nouns are', () => {
  const map = load();
  const byId = nodeIndex(map);
  const { findings } = computeDrift(map);
  const groups = new Map(groupByAttention(findings, byId).map((g) => [g.bucket, g.findings.map((f) => f.nodeId)]));

  assert.deepEqual(groups.get('implementation-detail').sort(), [
    'artifact.assembled_packet',
    'component.append_context_if_present',
    'component.build_manifest',
    'component.classify_verdict_file',
    'state.phase_snapshot',
  ]);
  // 11 of 16 stay in front of the reader — and the lane is no longer 11 internals deep.
  assert.equal(groups.get('likely-contract').length + groups.get('ambiguous-review').length, 11);
  assert.equal(groups.get('implementation-detail').length, 5);
});

test('D7 · map.md still states all 16 findings in full, with no disclosure anywhere', () => {
  const map = load();
  const { findings } = computeDrift(map);
  const md = toMarkdown(map, findings, { generatedAt: 'STAMP' });

  assert.doesNotMatch(md, /<details/i);
  for (const [cls, id] of BASELINE) {
    assert.ok(md.includes(`\`${id}\``), `${id} missing from map.md`);
    assert.ok(md.includes(`**\`${cls}\`**`), `${cls} missing from map.md`);
  }
  assert.equal((md.match(/ · attention: /g) ?? []).length, 16, 'every finding must carry its bucket');
});
