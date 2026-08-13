// the-cartographer — tests for the self-sufficient Markdown report (Task 7).
//
// Two families, and the second is the one that keeps finding defects:
//   COMPLETENESS — an agent given ONLY map.md must reconstruct nodes, edges, capabilities, evidence,
//                  claims and current drift without rendering a single diagram;
//   INJECTION    — every interpolated field is source-derived and therefore UNTRUSTED.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { toMarkdown, safeText, recoverText } from './markdown.mjs';
import { computeDrift } from './diff.mjs';
import { bucketForFinding } from './attention.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TINY = path.join(HERE, 'fixtures', 'tiny.map.json');

const loadTiny = () => JSON.parse(fs.readFileSync(TINY, 'utf8'));
const driftOf = (map) => computeDrift(map).findings;
const renderTiny = (opts) => {
  const map = loadTiny();
  return toMarkdown(map, driftOf(map), opts);
};

/** Every line that opens an ATX heading, reduced to its LEVEL. */
const headingLevels = (md) => md.split('\n')
  .filter((line) => /^#{1,6} /.test(line))
  .map((line) => line.match(/^#+/)[0].length);

const fenceLines = (md) => md.split('\n').filter((line) => line.startsWith('```'));

/**
 * The report MINUS its fenced blocks. Markdown syntax is inert inside a fence, so the link / fence /
 * backslash assertions belong out here — and the fence itself is proved unbreakable separately (the
 * mermaid emitter collapses whitespace, so nothing it emits can start a line, let alone close a fence).
 */
function outsideFences(md) {
  const kept = [];
  let inside = false;
  for (const line of md.split('\n')) {
    if (line.startsWith('```')) { inside = !inside; continue; }
    if (!inside) kept.push(line);
  }
  return kept.join('\n');
}

/** Only the FENCED blocks — the mermaid sources, which carry their own escaper (`mermaid.mjs`). */
function fencedBlocks(md) {
  const kept = [];
  let inside = false;
  for (const line of md.split('\n')) {
    if (line.startsWith('```')) { inside = !inside; continue; }
    if (inside) kept.push(line);
  }
  return kept.join('\n');
}

/**
 * The number of CELL DELIMITERS in a table row. A `|` a cell escapes as `\|` is content — GFM removes
 * the backslash before it parses the cell — so counting raw pipes would read a label's own pipe as a
 * column boundary and call every correct row ragged.
 */
const delimiterCount = (row) => (row.replace(/\\\|/g, '').match(/\|/g) ?? []).length;

/** Table rows grouped into the CONTIGUOUS blocks they belong to. */
function tableBlocks(md) {
  const blocks = [];
  let current = null;
  for (const line of md.split('\n')) {
    if (line.startsWith('|')) {
      if (!current) { current = []; blocks.push(current); }
      current.push(line);
    } else {
      current = null;
    }
  }
  return blocks;
}

/**
 * The injection payload: one string carrying every construct the report must refuse to let through —
 * an HTML tag, an active link, an image, an inline code span, a table pipe, a backslash escape, a
 * heading, a fence, a blockquote and a thematic break, with real newlines between them.
 */
const PAYLOAD = '<img src=x onerror=alert(1)> [link](https://evil.example/p) ![i](y) `tick` | pipe'
  + ' \\backslash\n# PWNED HEADING\n```js\nfence\n```\n> quoted\n---\n\\<img\\> \\| ';

/**
 * The fields whose values are a CLOSED SET some consumer DISPATCHES on: `form` / `mermaidType` / `lane`
 * pick a renderer, and `claimKind` decides what counts as documentation (ADR C-014), so poisoning it
 * changes how many findings exist rather than how they are escaped. Poisoning any of these would test
 * the dispatcher, not the escaper — `claimKind`'s own escaping is covered by test 14b. Everything else
 * — ids included, consistently on both the definition and every reference to it — carries the payload.
 */
const PRESERVE = new Set(['form', 'mermaidType', 'lane', 'claimKind']);

function poison(value, key) {
  if (Array.isArray(value)) return value.map((v) => poison(v, key));
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = poison(v, k);
    return out;
  }
  if (typeof value === 'string' && !PRESERVE.has(key)) return `${value}${PAYLOAD}`;
  return value;
}

// ─── completeness ────────────────────────────────────────────────────────────────────────────────

test('1 · contains no raw HTML tag', () => {
  const md = renderTiny();
  assert.doesNotMatch(md, /<[A-Za-z!/?]/, 'a "<" followed by a tag-ish character is a tag opener');
});

test('2 · every node appears with kind, lane, summary and inferred status', () => {
  const map = loadTiny();
  const md = toMarkdown(map, driftOf(map));
  for (const node of map.nodes) {
    assert.ok(md.includes(node.id), `node id ${node.id} missing`);
    assert.ok(md.includes(node.label), `node label ${node.label} missing`);
    assert.ok(md.includes(`kind: \`${node.kind}\``), `kind of ${node.id} missing`);
    assert.ok(md.includes(`lane: \`${node.lane}\``), `lane of ${node.id} missing`);
    for (const word of node.summary.split(/\s+/).slice(0, 4)) {
      assert.ok(md.includes(word), `summary of ${node.id} missing near ${word}`);
    }
  }
  // Both spellings appear: the fixture carries one inferred node and five that are not.
  assert.ok(md.includes('inferred: **yes**'));
  assert.ok(md.includes('inferred: **no**'));
});

test('3 · every node attribute appears, name and value', () => {
  const map = loadTiny();
  map.nodes[0].attrs = { default: null, retries: 3, aliases: ['a', 'b'], nested: { deep: true } };
  const md = toMarkdown(map, driftOf(map));
  assert.ok(md.includes('default'), 'attrs key missing');
  assert.ok(md.includes('retries'));
  assert.ok(md.includes('3'));
  assert.ok(md.includes('aliases'));
  assert.ok(md.includes('nested'));
  assert.ok(md.includes('deep'));
  assert.ok(md.includes('null'), 'a null attribute value must be shown as null, never dropped');
});

test('3b · a node with no attrs says so rather than printing a placeholder', () => {
  const md = renderTiny();
  assert.ok(md.includes('(none declared)'));
  assert.doesNotMatch(md, /undefined/);
});

test('4 · evidence appears with its note; claims appear with their text AND claimKind', () => {
  const map = loadTiny();
  const md = toMarkdown(map, driftOf(map));
  for (const node of map.nodes) {
    for (const e of node.evidence ?? []) {
      assert.ok(md.includes(`${e.path}\`:${e.line}`), `evidence citation ${e.path}:${e.line} missing`);
      if (e.note) assert.ok(md.includes(safeText(e.note)), `evidence NOTE missing: ${e.note}`);
    }
    for (const c of node.claims ?? []) {
      assert.ok(md.includes(safeText(c.text)), `claim TEXT missing: ${c.text}`);
      assert.ok(md.includes(`claimKind: \`${c.claimKind}\``), `claimKind missing for ${node.id}`);
    }
  }
});

test('5 · a claim with checked:false is marked unverified', () => {
  const md = renderTiny();
  assert.match(md, /checked: \*\*no\*\*/);
  assert.ok(md.toLowerCase().includes('could not check'), 'unchecked claims must say what that means');
});

test('6 · contradictions render with BOTH citations plus the claim text and the evidence note', () => {
  const map = loadTiny();
  const md = toMarkdown(map, driftOf(map));
  const withContradictions = map.nodes.filter((n) => (n.contradictions ?? []).length > 0);
  assert.equal(withContradictions.length, 2, 'fixture precondition');
  for (const node of withContradictions) {
    for (const c of node.contradictions) {
      assert.ok(md.includes(safeText(c.statement)), 'statement missing');
      assert.ok(md.includes(`${c.claim.path}\`:${c.claim.line}`), 'claim citation missing');
      assert.ok(md.includes(`${c.evidence.path}\`:${c.evidence.line}`), 'evidence citation missing');
      assert.ok(md.includes(safeText(c.claim.text)), 'claim TEXT missing from the contradiction');
      assert.ok(md.includes(safeText(c.evidence.note)), 'evidence NOTE missing from the contradiction');
    }
  }
});

test('7 · every edge appears as an explicit adjacency line, with its evidence', () => {
  const map = loadTiny();
  const md = toMarkdown(map, driftOf(map));
  for (const edge of map.edges) {
    assert.ok(
      md.includes(`\`${edge.from}\` → \`${edge.to}\``),
      `adjacency ${edge.from} -> ${edge.to} missing`,
    );
    assert.ok(md.includes(edge.id), `edge id ${edge.id} missing`);
    assert.ok(md.includes(`label: ${safeText(edge.label)}`), `edge label missing`);
    assert.ok(md.includes(`kind: \`${edge.kind}\``));
    for (const e of edge.evidence ?? []) {
      assert.ok(md.includes(`${e.path}\`:${e.line}`), `edge evidence citation missing`);
      if (e.note) assert.ok(md.includes(safeText(e.note)), `edge evidence note missing`);
    }
  }
});

test('8 · every drift finding appears with its class and citations', () => {
  const map = loadTiny();
  const findings = driftOf(map);
  assert.equal(findings.length, 4, 'fixture precondition: four planted findings');
  const md = toMarkdown(map, findings);
  for (const f of findings) {
    assert.ok(md.includes(`**${safeText(f.class)}**`), `class ${f.class} missing`);
    assert.ok(md.includes(f.nodeId), `finding nodeId ${f.nodeId} missing`);
    assert.ok(md.includes(safeText(f.detail)), 'finding detail missing');
    for (const c of f.citations) {
      assert.ok(md.includes(`${c.path}\`:${c.line}`), `finding citation ${c.path}:${c.line} missing`);
    }
  }
});

test('8d · every finding states its attention bucket, and NOTHING is folded away in Markdown', () => {
  // `map.md` has no disclosure element and gets none: it is the self-sufficient report (PDR §12), so
  // a bucket here is a LABEL a reader can triage by, never a place a finding goes to be hidden. The
  // report keeps the drift engine's reporting order untouched for the same reason.
  const map = loadTiny();
  const byId = new Map(map.nodes.map((n) => [n.id, n]));
  const findings = driftOf(map);
  const md = toMarkdown(map, findings);

  for (const f of findings) {
    const bucket = bucketForFinding(f, byId.get(f.nodeId));
    assert.ok(
      md.includes(`${safeText(f.class)}** — ${safeText(f.nodeId)} (${safeText(f.label)}) · attention: ${safeText(bucket)}`),
      `${f.nodeId} must be labelled ${bucket}`,
    );
  }
  const order = md.split('\n')
    .map((l) => l.match(/^- \*\*`([A-Z]+)`\*\* — .* · attention: /)?.[1])
    .filter((cls) => cls !== undefined);
  assert.deepEqual(order, findings.map((f) => f.class), 'the report must keep the engine\'s order');
  assert.doesNotMatch(md, /<details/i, 'the Markdown report may never collapse a finding');
});

test('8e · a finding on a COLLAPSIBLE node is still stated in full in map.md', () => {
  // The readability layer folds `component × core` away in the page. `map.md` must not: an agent
  // handed only the report has to be able to reconstruct every finding (PDR §12).
  const map = loadTiny();
  map.nodes.find((n) => n.id === 'component.tiny_core').claims = [];
  const findings = driftOf(map);
  const internal = findings.find((f) => f.nodeId === 'component.tiny_core');
  assert.ok(internal, 'fixture precondition: the internal helper is now UNDOCUMENTED');

  const md = toMarkdown(map, findings);
  assert.ok(md.includes(`· attention: ${safeText('implementation-detail')}`));
  assert.ok(md.includes(safeText(internal.detail)), 'the collapsed-bucket finding must be stated in full');
  for (const c of internal.citations) assert.ok(md.includes(`${c.path}\`:${c.line}`));
});

test('8b · a clean map states plainly that no drift was found', () => {
  const map = loadTiny();
  const md = toMarkdown(map, []);
  assert.match(md, /No drift findings/i);
  assert.doesNotMatch(md, /\*\*PHANTOM\*\*/);
});

test('8c · findings is REQUIRED — silence must never render a drifting map as clean', () => {
  const map = loadTiny();
  assert.throws(() => toMarkdown(map), /findings is required/);
  assert.throws(() => toMarkdown(map, null), /findings/);
});

test('9 · mermaid views are emitted as fenced ```mermaid blocks', () => {
  const map = loadTiny();
  const md = toMarkdown(map, driftOf(map));
  const mermaidViews = map.views.filter((v) => v.form === 'mermaid');
  assert.equal(mermaidViews.length, 1, 'fixture precondition');
  const fences = fenceLines(md);
  assert.equal(fences.length, mermaidViews.length * 2);
  assert.equal(fences[0], '```mermaid');
  assert.equal(fences[1], '```');
  assert.ok(md.includes('flowchart LR'), 'the mermaid source itself must be present');
});

test('9b · a table view renders as a markdown table with its declared columns', () => {
  const map = loadTiny();
  const md = toMarkdown(map, driftOf(map));
  const table = map.views.find((v) => v.form === 'table');
  assert.ok(md.includes(`| ${table.columns.map(safeText).join(' | ')} |`), 'declared header row missing');
  // and every node the view lists has a row
  for (const id of table.nodes) {
    const node = map.nodes.find((n) => n.id === id);
    assert.ok(md.includes(node.label), `table row for ${id} missing`);
  }
});

test('9c · an unrecognised column renders an explicit marker, never "undefined"', () => {
  const map = loadTiny();
  const view = map.views.find((v) => v.form === 'table');
  view.columns = ['Capability', 'Whatever The Author Wrote'];
  const md = toMarkdown(map, driftOf(map));
  assert.ok(md.includes(`| ${safeText('Capability')} | ${safeText('Whatever The Author Wrote')} |`));
  assert.ok(md.includes('(no value for this column)'));
  assert.doesNotMatch(md, /undefined/);
});

test('10 · coverage and every source row with its digest are present', () => {
  const map = loadTiny();
  const md = toMarkdown(map, driftOf(map));
  assert.ok(md.includes(`Fully read: ${map.coverage.read.length}`), 'read count missing');
  for (const p of map.coverage.read) assert.ok(md.includes(p), `coverage path ${p} missing`);
  for (const s of map.sources) {
    assert.ok(md.includes(s.path), `source path missing`);
    assert.ok(md.includes(s.sha256), `source digest missing`);
    assert.ok(md.includes(String(s.lines)), `source line count missing`);
    assert.ok(md.includes(s.role));
  }
  // Guardrail 4: a map that truncated nothing must SAY it truncated nothing.
  assert.match(md, /no file was partially read or skipped/i);
});

test('10b · declared partial / skipped entries render WITH their reasons', () => {
  const map = loadTiny();
  const moved = map.coverage.read.pop();
  map.coverage.partial.push({ path: moved, why: 'only the first 40 lines fit the budget' });
  map.coverage.skipped.push({ path: 'plugin/x/vendor.min.js', why: 'generated bundle, not source' });
  const md = toMarkdown(map, driftOf(map));
  assert.ok(md.includes('only the first 40 lines fit the budget'));
  assert.ok(md.includes('generated bundle, not source'));
  assert.ok(md.includes('plugin/x/vendor.min.js'));
  assert.doesNotMatch(md, /no file was partially read or skipped/i);
});

test('11 · the generation stamp renders when supplied and is absent otherwise', () => {
  assert.ok(renderTiny({ generatedAt: 'STAMP-XYZ' }).includes('STAMP-XYZ'));
  assert.doesNotMatch(renderTiny(), /\*\*Generated:\*\*/);
});

test('12 · toMarkdown neither mutates nor aliases its inputs', () => {
  const map = loadTiny();
  const findings = driftOf(map);
  const mapBefore = JSON.stringify(map);
  const findingsBefore = JSON.stringify(findings);
  toMarkdown(map, findings, { generatedAt: 'x' });
  assert.equal(JSON.stringify(map), mapBefore);
  assert.equal(JSON.stringify(findings), findingsBefore);
});

test('13 · renders from NORMALIZED order — an array-shuffled twin renders identically', () => {
  const map = loadTiny();
  const shuffled = JSON.parse(JSON.stringify(map));
  shuffled.nodes.reverse();
  shuffled.edges.reverse();
  shuffled.views.reverse();
  shuffled.sources.reverse();
  shuffled.coverage.read.reverse();
  for (const n of shuffled.nodes) {
    if (Array.isArray(n.evidence)) n.evidence.reverse();
    if (Array.isArray(n.claims)) n.claims.reverse();
  }
  assert.equal(
    toMarkdown(shuffled, computeDrift(shuffled).findings),
    toMarkdown(map, computeDrift(map).findings),
  );
});

// ─── injection safety ────────────────────────────────────────────────────────────────────────────

test('14 · HTML cannot be injected — the tag is INERT inside a code span, and still exact', () => {
  // This assertion used to read "the literal substring `<img` is GONE", which the substitution table
  // achieved by rewriting the character. That is the defect, not the safeguard: it also rewrote every
  // legitimate `<` and made the label unreconstructable (test 19). The safety claim is now made where
  // it actually lives — the ACTIVE MARKUP SURFACE, which is what a renderer can act on — and the
  // exactness that used to be sacrificed for it is asserted alongside.
  const map = loadTiny();
  map.nodes[0].label = '<img src=x onerror=alert(1)>';
  const md = toMarkdown(map, driftOf(map));

  assert.doesNotMatch(activeSurface(md), /<[A-Za-z!/?]/, 'a tag opener reached the active surface');
  assert.ok(md.includes(safeText(map.nodes[0].label)), 'and the label is carried EXACTLY');
  assert.equal(recoverText(safeText(map.nodes[0].label)), '<img src=x onerror=alert(1)>');
});

test('14b · a hostile claimKind, source role and attribute name cannot break out either', () => {
  const map = loadTiny();
  map.nodes[1].claims[0].claimKind = `doc<img src=x> | \`x\``;
  map.sources[0].role = 'doc`|<b>';
  map.nodes[1].attrs = { '<script>bad</script>': '[a](b)' };
  const md = toMarkdown(map, driftOf(map));

  const surface = activeSurface(md);
  assert.doesNotMatch(surface, /<[A-Za-z!/?]/, 'a tag opener reached the active surface');
  assert.ok(!surface.includes(']('), 'an inline link destination reached the active surface');
  // …and the pipes those values carry did not add a column: a cell escapes its own, so the only
  // DELIMITERS left are the ones `row()` wrote.
  for (const block of tableBlocks(md)) {
    assert.equal(new Set(block.map(delimiterCount)).size, 1, 'ragged table rows');
  }
  // …while every one of those values is still recoverable, character for character — the source role
  // among them, which lives in a TABLE CELL and therefore reaches the file with its pipe escaped.
  const recovered = recoverAll(md);
  for (const source of [map.nodes[1].claims[0].claimKind, map.sources[0].role, '<script>bad</script>', '[a](b)']) {
    assert.ok(recovered.has(source), `${JSON.stringify(source)} is not recoverable from map.md`);
  }
});

test('15 · every source-derived field is neutralised — the poisoned twin injects nothing', () => {
  const clean = loadTiny();
  const cleanMd = toMarkdown(clean, computeDrift(clean).findings);

  const dirty = poison(loadTiny(), 'map');
  const dirtyMd = toMarkdown(dirty, computeDrift(dirty).findings);

  const dirtyOut = activeSurface(dirtyMd);

  // (a) no HTML on the ACTIVE SURFACE — and the mermaid blocks, which have an escaper of their own,
  //     carry no tag opener at all
  assert.doesNotMatch(dirtyOut, /<[A-Za-z!/?]/);
  assert.ok(!fencedBlocks(dirtyMd).includes('<img'), 'the mermaid emitter must still neutralise its own');
  // (b) no active markdown link or image: "](", the tell of an inline destination, cannot form
  assert.ok(!dirtyOut.includes(']('), 'an active markdown link/image was injected');
  assert.ok(!dirtyOut.includes('!['));
  // (c) no injected document structure. The heading skeleton is the clean one — a hostile title may
  //     sit INSIDE a heading, but it may never add one — and, more strongly, the two reports have the
  //     same NUMBER OF LINES: every construct the payload carries (a heading, a fence, a blockquote,
  //     a thematic break) needs a line start, so proving no line was created proves none was formed.
  assert.deepEqual(headingLevels(dirtyOut), headingLevels(activeSurface(cleanMd)));
  assert.equal(
    dirtyMd.split('\n').length,
    cleanMd.split('\n').length,
    'an injected newline reached the output — every line-start construct becomes formable',
  );
  // (d) no injected code fence — the fence lines are exactly the clean report's, still balanced
  assert.deepEqual(fenceLines(dirtyMd), fenceLines(cleanMd));
  assert.equal(fenceLines(dirtyMd).length % 2, 0, 'an unbalanced fence would swallow the report');
  // (e) no broken table: within each contiguous block every row carries the same DELIMITER count —
  //     an escaped `\|` inside a cell is content, not a column boundary
  const blocks = tableBlocks(dirtyMd);
  assert.ok(blocks.length > 0);
  for (const block of blocks) {
    const widths = new Set(block.map(delimiterCount));
    assert.equal(widths.size, 1, `ragged table rows: ${[...widths].join(', ')}`);
  }
  // (f) no injected blockquote or thematic break at a line start
  assert.ok(!/^> /m.test(dirtyOut), 'a blockquote was injected');
  assert.ok(!/^-{3,}\s*$/m.test(dirtyOut), 'a thematic break was injected');
  // (g) no backslash from source text can do ESCAPING WORK. It used to be deleted outright, which was
  //     lossy (test 19); it is now escaped and confined, so the property to assert is CONFINEMENT —
  //     no backslash reaches the active surface, where it could escape a literal this module wrote.
  assert.ok(!dirtyOut.includes('\\'), 'a backslash reached the active markup surface');
  // (h) no bare URL: GFM autolinks one with no syntax at all, so it is the injection an escaping
  //     table cannot reach and a code span closes for free
  assert.doesNotMatch(dirtyOut, /https?:\/\/|www\./, 'a URL reached the active markup surface');
  // (i) the strongest form of the containment claim: NOT ONE BACKTICK survives on the active surface.
  //     Every span is therefore balanced and every source string is inside one — because a stray or
  //     unclosed fence is exactly what would leave a backtick behind out here.
  assert.equal((dirtyOut.match(/`/g) ?? []).length, 0,
    'a backtick reached the active surface — a span is unbalanced, or a source string escaped one');
  // (j) …and the whole poisoned report is still readable back: nothing was neutralised into a lie.
  //     Every span in it decodes, and what decodes out is the payload the map was poisoned with.
  let recovered;
  assert.doesNotThrow(() => { recovered = recoverAll(dirtyMd); }, 'a span in the report is unreadable');
  assert.ok([...recovered].some((v) => v.includes(PAYLOAD)),
    'the payload was not recoverable — the report neutralised it into something the map never said');
});

test('16 · safeText emits ONE line, and an unbreakable span — without discarding anything', () => {
  // This test used to assert the COLLAPSE — `safeText('a\nb\n\n  c') === 'a b c'` — which is exactly
  // the lossy step that made two different labels render alike. What has to hold is the STRUCTURAL
  // half of that guarantee (one line, so no line-start construct can form) plus the exactness the
  // collapse was paying for.
  for (const source of ['a\nb\n\n  c', '  padded  ', '```js', '[a](b)', 'a|b', 'a\r\nb', '\ttab']) {
    const rendered = safeText(source);
    assert.doesNotMatch(rendered, /[\n\r]/, `${JSON.stringify(source)} spans more than one line`);
    assert.equal(recoverText(rendered), source, `${JSON.stringify(source)} was not carried exactly`);
  }

  // The span cannot be closed from inside: the fence always beats the longest backtick run it holds.
  for (const source of ['`', '``', '```js', 'a ```` b', '`` ` ``']) {
    const rendered = safeText(source);
    const fence = /^`+/.exec(rendered)[0];
    const inside = rendered.slice(fence.length, rendered.length - fence.length);
    assert.ok(fence.length > (inside.match(/`+/g) ?? []).reduce((m, r) => Math.max(m, r.length), 0),
      `${JSON.stringify(source)} contains a backtick run its own fence does not beat`);
    assert.equal(codeSpansOn(rendered).length, 1, 'and a renderer reads it as exactly one span');
  }
});

test('17 · safeText refuses a non-string rather than printing a placeholder', () => {
  for (const bad of [undefined, null, 3, {}, []]) {
    assert.throws(() => safeText(bad), /expected a string/);
  }
});

test('17b · a missing required field fails LOUDLY, and an unrenderable value is never faked', () => {
  for (const strip of [
    (m) => { delete m.subject.title; },
    (m) => { delete m.subject.summary; },
    (m) => { delete m.nodes[0].label; },
    (m) => { delete m.edges[0].label; },
  ]) {
    const map = loadTiny();
    strip(map);
    assert.throws(() => toMarkdown(map, driftOf(map)), /expected a string/);
  }
  // An absent value must never be reported as an explicit `null` — that asserts something the map
  // never said, which is worse than omitting it.
  const map = loadTiny();
  map.nodes[0].attrs = { fn: () => {} };
  assert.throws(() => toMarkdown(map, driftOf(map)), /cannot render|is of type function/);
});

/**
 * Every inline code span on one line, by CommonMark's own rule: a backtick STRING opens a span and the
 * next backtick string OF EQUAL LENGTH closes it. Written here, in the tests, deliberately — the
 * safety and reconstruction claims below are claims about what a MARKDOWN RENDERER sees, so checking
 * them against the renderer's rule is the check; asking the module that emitted the file to confirm
 * its own output would prove nothing.
 */
function codeSpansOn(line) {
  const runs = [...line.matchAll(/`+/g)];
  const spans = [];
  let i = 0;
  while (i < runs.length) {
    const open = runs[i];
    let j = i + 1;
    while (j < runs.length && runs[j][0].length !== open[0].length) j += 1;
    if (j >= runs.length) { i += 1; continue; }
    spans.push({
      start: open.index,
      end: runs[j].index + runs[j][0].length,
      content: line.slice(open.index + open[0].length, runs[j].index),
    });
    i = j + 1;
  }
  return spans;
}

/**
 * The report's ACTIVE MARKUP SURFACE: everything a renderer still reads as markup once the code spans
 * are removed. Markdown is inert inside a code span — no link, no image, no emphasis, no HTML, no
 * autolink — so this is the only text an injection could possibly act through.
 */
const activeSurface = (md) => outsideFences(md).split('\n').map((line) => {
  let out = line;
  for (const { start, end } of codeSpansOn(line).reverse()) out = out.slice(0, start) + out.slice(end);
  return out;
}).join('\n');

/**
 * RECONSTRUCTION, performed the way an agent holding only `map.md` would have to: find every inline
 * code span in the file and read it back. This is the operation PDR §12's reconstruction condition
 * names, so the tests do it rather than trusting `safeText`'s own inverse on a value never written to
 * a file.
 */
function recoverAll(md) {
  const values = new Set();
  for (const line of outsideFences(md).split('\n')) {
    // A TABLE ROW is unescaped first, exactly as a GFM renderer does before it parses the cell's
    // inlines: a `|` inside a cell must reach the file as `\|` or it would split the row instead.
    const text = line.startsWith('|') ? line.replace(/\\\|/g, '|') : line;
    for (const span of codeSpansOn(text)) values.add(recoverText(text.slice(span.start, span.end)));
  }
  return values;
}

test('19 · the rendering of a source string is INJECTIVE — map.md can be read back', () => {
  // map.md's entire purpose is that an agent holding ONLY it can reconstruct the map (PDR §12,
  // Codex's reconstruction condition). A substitution that maps two different labels onto the same
  // output makes that impossible: the reader cannot know which one the subject actually wrote.
  for (const [a, b] of [
    ['<x>', '＜x>'],
    ['[x]', '［x］'],
    ['`x`', '｀x｀'],
    ['a|b', 'a｜b'],
    ['a\\b', 'a＼b'],
    ['a\nb', 'a b'],
    ['a  b', 'a b'],
    [' padded ', 'padded'],
  ]) {
    assert.notEqual(a, b, 'the fixture pair must be two DIFFERENT labels');
    assert.notEqual(safeText(a), safeText(b),
      `${JSON.stringify(a)} and ${JSON.stringify(b)} render identically — a reader of map.md cannot `
      + 'tell which one the subject wrote, so the label is not reconstructable');
  }
});

test('20 · a bare URL from source text never becomes an ACTIVE LINK', () => {
  // Removing `[` and `]` closes the explicit-link syntax and `<` closes the angle autolink, but GFM
  // ALSO autolinks a bare `https://` or `www.` run in running text — so the hostile payload still
  // produced a live link, which Task 7 prohibits outright.
  const map = loadTiny();
  map.nodes[0].summary = 'see https://evil.example/p and www.evil.example/q for more';
  map.nodes[1].label = 'http://evil.example/r';
  map.subject.summary = 'contact us at https://evil.example/s';
  const md = toMarkdown(map, driftOf(map));

  assert.ok(md.includes('evil.example'), 'the URL must still be REPORTED — exactness is the point');
  assert.doesNotMatch(activeSurface(md), /https?:\/\/|www\./,
    'a URL reached the active markup surface, where GFM turns it into a live link');
});

/**
 * The corpus: hostile, exotic and simply awkward. Every entry is a string a real extractor could hand
 * this report — a label, a note, a claim's text, an attribute name — including the LOOK-ALIKES the old
 * substitution table produced, which is where the losslessness claim is decided: if `"<x>"` and
 * `"＜x>"` are both in the corpus and both round-trip, no substitution collapsed them.
 */
const ROUND_TRIP_CORPUS = [
  '<img src=x onerror=alert(1)>', '＜img src=x onerror=alert(1)>',
  '[link](https://evil.example/p)', '［link］(https://evil.example/p)',
  '![i](y)', '<https://evil.example>', 'https://evil.example/p', 'www.evil.example',
  '`tick`', '｀tick｀', '``double``', '```js', '`', '``', ' ` ',
  'a|b', 'a｜b', '| ragged | row |', 'a \\| b',
  'a\\b', 'a＼b', '\\', '\\\\', 'ends with a backslash \\',
  '# heading', '> quote', '---', '***', '* item', '1. item',
  '*emphasis* _under_ ~~strike~~', '<!-- comment -->', '&amp;', '&lt;script&gt;',
  'line one\nline two', 'crlf\r\nhere', '\ttabbed', '\n', '\r', '\t',
  ' leading and trailing ', '  two spaces  ', ' ', '   ', '',
  ' ', 'e.control.mode.check>outcome.pass', '{"json":"like"}',
  'emoji 🎉 and a surrogate pair 𝕏', 'ligature ﬀ and nbsp here', 'U+2028 U+2029 ',
  'a', 'plain words with no markup at all',
];

test('21 · every source string round-trips out of map.md EXACTLY — safety is not paid for in fidelity', () => {
  // Defects 4 and 5 are one tension: safety wants the dangerous characters GONE, reconstruction wants
  // them PRESERVED. A code span settles both at once — markdown is inert inside one, and the text is
  // carried verbatim — so this test asserts the fidelity half and test 22 asserts the safety half of
  // the SAME mechanism.
  for (const source of ROUND_TRIP_CORPUS) {
    const rendered = safeText(source);
    assert.equal(recoverText(rendered), source,
      `${JSON.stringify(source)} did not survive the round trip — it rendered as `
      + `${JSON.stringify(rendered)}, which reads back as ${JSON.stringify(recoverText(rendered))}`);
  }

  // …and the rendering is injective across the whole corpus, which is the same statement made
  // globally: no two distinct sources may share one rendering.
  const seen = new Map();
  for (const source of ROUND_TRIP_CORPUS) {
    const rendered = safeText(source);
    assert.equal(seen.get(rendered), undefined,
      `${JSON.stringify(source)} and ${JSON.stringify(seen.get(rendered))} both render as ${rendered}`);
    seen.set(rendered, source);
  }
});

test('22 · the recovered value comes out of the REPORT, not merely out of safeText', () => {
  // The contract is about `map.md` — so the strings are planted in a map, rendered, and then read back
  // out of the FILE by scanning it for code spans, which is what an agent holding only map.md can do.
  const map = loadTiny();
  const planted = ROUND_TRIP_CORPUS.filter((s) => s !== '');   // an id may not be empty
  map.nodes[0].label = planted[0];
  map.nodes[0].summary = planted[1];
  map.nodes[0].attrs = Object.fromEntries(planted.slice(2, 12).map((s, i) => [`attr${i}`, s]));
  map.nodes[1].claims[0].text = planted[12];
  map.nodes[1].evidence[0].note = planted[13];
  map.subject.title = planted[14];
  map.subject.summary = planted[15];
  map.coverage.partial.push({ path: map.coverage.read[0], why: planted[16] });
  map.coverage.read.shift();
  const table = map.views.find((v) => v.form === 'table');
  table.columns = [...table.columns, planted[17]];

  const md = toMarkdown(map, driftOf(map));

  const recovered = recoverAll(md);
  for (const source of planted.slice(0, 18)) {
    assert.ok(recovered.has(source),
      `${JSON.stringify(source)} could not be recovered from map.md — the report is not reconstructable`);
  }
});

test('18 · a subject whose title and summary are hostile still yields one H1 and no markup', () => {
  const map = loadTiny();
  map.subject.title = `# Fake\n<script>alert(1)</script>`;
  map.subject.summary = `[x](https://evil.example) | ` + '```';
  const md = toMarkdown(map, driftOf(map));
  assert.equal(md.split('\n').filter((l) => /^# /.test(l)).length, 1);
  const surface = activeSurface(md);
  assert.ok(!surface.includes('<script'));
  assert.ok(!surface.includes(']('));
  // The summary's ``` needs a four-backtick fence, which would OPEN A FENCED BLOCK if a source string
  // were ever written at column 0 — so the only lines that may begin with a backtick are the report's
  // own mermaid fences.
  for (const line of md.split('\n')) {
    if (!line.startsWith('`')) continue;
    assert.ok(line === '```mermaid' || line === '```',
      `a source string was written at column 0, where its fence opens a code block: ${JSON.stringify(line)}`);
  }
  assert.equal(fenceLines(md).length % 2, 0, 'and the mermaid fences are still balanced');
});
