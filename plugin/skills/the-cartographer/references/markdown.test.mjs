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
import { validate } from './validate.mjs';
import { bucketForFinding } from './attention.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..', '..');
const TINY = path.join(HERE, 'fixtures', 'tiny.map.json');

const loadTiny = () => JSON.parse(fs.readFileSync(TINY, 'utf8'));
/** The fixture's one `role: "doc"` source — the surface its harvest records name. */
const TINY_DOC = 'plugin/skills/the-cartographer/references/fixtures/tiny/SKILL.md';
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
 * pick a renderer, `claimKind` decides what counts as documentation (ADR C-014), and `role` decides
 * which sources are DOCUMENTATION SURFACES, which is what a harvest's completeness is measured
 * against (ADR C-018) — so poisoning either of the last two changes how many findings exist rather
 * than how they are escaped. Poisoning any of these would test the dispatcher, not the escaper, and
 * both `claimKind`'s and `role`'s own escaping is covered by test 14b. Everything else — ids included,
 * consistently on both the definition and every reference to it — carries the payload.
 *
 * `disposition` IS on the list, and for the same reason as `claimKind`: it is a CLOSED set the report
 * DISPATCHES on — `markdown.mjs` prints a different sentence of meaning for `asserts` than for
 * `mentions` — so poisoning it would test which branch was taken rather than how the value is escaped.
 * Its own escaping is asserted in test 14b, beside `claimKind`'s and `role`'s, where the out-of-
 * vocabulary branch is the one under test. The candidate's `path` and `quote` are NOT preserved: they
 * are ordinary source-derived strings, and test 15 seeds a real candidate so that both of them, and
 * the rendered disposition line, actually enter this test at all.
 *
 * `refutedQuote` was on this list and is NOT any more. It was exempted on two grounds, and the second
 * one has stopped being true: `map.md` now renders the refuted fragment, both under the contradiction
 * record and on the STALE finding it produces (ADR C-019), so it is a source-derived string on an
 * active surface like any other and an exemption here would be a hole in exactly the coverage this
 * test claims. The first ground was real — the field is not a value of its own but a QUOTATION of the
 * claim's `text`, and the drift engine refuses a record whose two sides disagree (`staleFindings`), so
 * appending the payload to one side alone would test the pointer rule instead of the escaper. That is
 * answered by poisoning the quotation rather than by skipping it: see `poison` below.
 */
const PRESERVE = new Set(['form', 'mermaidType', 'lane', 'claimKind', 'role', 'disposition']);

/**
 * A contradiction record — the one place two source strings must stay in a QUOTATION relation.
 * Recognised structurally rather than by key name, because that is what the relation is.
 */
const isQuotation = (v) => v !== null && typeof v === 'object'
  && typeof v.refutedQuote === 'string'
  && v.claim !== null && typeof v.claim === 'object' && typeof v.claim.text === 'string'
  && v.claim.text.includes(v.refutedQuote);

function poison(value, key) {
  if (Array.isArray(value)) return value.map((v) => poison(v, key));
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = poison(v, k);
    // The payload goes INSIDE the quotation, on both sides at once: `refutedQuote` carries it, and the
    // claim's `text` carries it in the same place, so the fragment still occurs in the claim it names
    // and the record stays the self-consistent one C-019 requires. Both strings are genuinely
    // poisoned — which is the property this file is testing — and neither is exempt.
    if (isQuotation(value)) {
      out.refutedQuote = `${value.refutedQuote}${PAYLOAD}`;
      out.claim.text = value.claim.text.replace(value.refutedQuote, out.refutedQuote);
    }
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

test('6b · a contradiction states WHICH WORDS are wrong, and so does the STALE it produces', () => {
  // ADR C-019. The two citations say where the two sides sit; only `refutedQuote` says what the
  // evidence actually refutes, and run 4's defect was a substantively correct STALE whose pointer
  // named an accurate line. `map.md` is the artifact a reader is supposed to need no other file for,
  // so a reader who cannot see the refuted fragment here cannot check the pointer at all.
  const map = loadTiny();
  const md = toMarkdown(map, driftOf(map));
  const quoted = map.nodes.flatMap((n) => (n.contradictions ?? []).map((c) => c.refutedQuote));
  assert.equal(quoted.length, 2, 'fixture precondition: two contradiction records, each naming its fragment');

  for (const fragment of quoted) {
    assert.ok(md.includes(`- refuted words: ${safeText(fragment)}`),
      `the contradiction record must state the refuted fragment ${JSON.stringify(fragment)}`);
    assert.ok(md.includes(`contradicts): ${safeText(fragment)}`),
      'and the STALE finding derived from it must carry the same fragment');
  }
});

test('6c · a node states its documentation harvest — what was searched, what was found, and what it was judged to be', () => {
  // ADR C-018 made the harvest decide whether an UNDOCUMENTED finding exists at all, and `map.md`
  // carried only its CONCLUSION (the coverage section). A reader holding this file alone could not
  // see which surfaces were read for a node, what the search turned up, or why a hit at a real doc
  // line left the node accused — three facts the map carries and the report dropped.
  //
  // THE CANDIDATE SITS ON THE NODE THE QUOTED LINE IS ABOUT. It used to hang `SKILL.md:16` —
  // "`tiny_core` is the shared routine every mode calls." — on `env.tiny_debug` as a `mentions`, and
  // a `mentions` is defined as text that NAMES the node and predicates nothing of it (§3.1). That
  // line does not name `TINY_DEBUG` in any form; the fixture's documentation never mentions it at
  // all. So the record under test was a search result the source cannot produce.
  //
  // `SKILL.md:8` is a real `mentions` for `component.tiny_core`: it names the routine by synonym
  // ("the core routine") inside the entry for the `check` mode, and tells a reader what CHECK does
  // rather than anything about the routine — found by the search, correctly judged not to be
  // documentation of it.
  const map = loadTiny();
  const core = map.nodes.find((n) => n.id === 'component.tiny_core');
  const quote = '- `check` — runs the core routine and prints `check ran`.';
  core.docHarvest = {
    searched: [TINY_DOC],
    candidates: [{ path: TINY_DOC, line: 8, quote, disposition: 'mentions' }],
  };

  const md = toMarkdown(map, driftOf(map));
  assert.deepEqual(validate(map, { repoRoot: REPO_ROOT }).errors, [],
    'the record under test must be one the contract accepts');
  assert.ok(md.includes(`Documentation harvest — searched (1): ${safeText(TINY_DOC)}`),
    'the surfaces searched for this node must be named');
  assert.ok(md.includes('Candidates (1):'));
  assert.ok(md.includes(`${TINY_DOC}\`:8`), 'the candidate must be cited where it was found');
  assert.ok(md.includes(`- quote: ${safeText(quote)}`), 'and quoted, or a reader cannot judge it');
  assert.match(md, /disposition: \*\*`mentions`\*\* — the text names this node and predicates nothing of it/,
    'the disposition must arrive with its meaning — "mentions" alone explains nothing to a cold reader');

  // …and a node with NO record says so, because that is what makes it unaccusable (state 3).
  assert.ok(md.includes('Documentation harvest: **no record**'));
  assert.match(md, /no record[\s\S]{0,160}cannot report it UNDOCUMENTED/);
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
  const core = map.nodes.find((n) => n.id === 'component.tiny_core');
  core.claims = [];
  // ADR decision F — the harvest travels with the claim removal. Stripping the `doc` claim alone
  // leaves the node in state 3, where UNDOCUMENTED cannot be raised at all.
  core.docHarvest = {
    searched: ['plugin/skills/the-cartographer/references/fixtures/tiny/SKILL.md'], candidates: [],
  };
  const findings = driftOf(map);
  const internal = findings.find((f) => f.nodeId === 'component.tiny_core');
  assert.ok(internal, 'fixture precondition: the internal helper is now UNDOCUMENTED');

  const md = toMarkdown(map, findings);
  assert.ok(md.includes(`· attention: ${safeText('implementation-detail')}`));
  assert.ok(md.includes(safeText(internal.detail)), 'the collapsed-bucket finding must be stated in full');
  for (const c of internal.citations) assert.ok(md.includes(`${c.path}\`:${c.line}`));
});


test('8d · a REFUSED record is not reported as an unsearched surface — the table may not contradict it', () => {
  // THE DEFECT (round-6 gate). `harvestStateOf` blanks `searched` to `[]` and marks every declared
  // surface `missing` whenever the record carries ANY defect — correct as a STATEMENT ABOUT
  // ESTABLISHMENT, and the reason line says so. But the coverage table rendered those two fields under
  // the headers "Searched" and "Not searched", which describe an ACT. So a record that names every
  // surface and is refused only for declaring `complete: true` produced a table asserting the
  // extractor searched nothing — contradicting both the record and the row's own reason, and
  // claiming something the pipeline never observes (ADR C-018, the attestation amendment).
  const record = { searched: [TINY_DOC], candidates: [], complete: true };
  const map = loadTiny();
  map.nodes.find((n) => n.id === 'env.tiny_debug').docHarvest = record;

  const { findings, coverage } = computeDrift(map);
  const withheld = coverage.withheld.find((w) => w.nodeId === 'env.tiny_debug');
  assert.ok(withheld, 'precondition: the refused record must withhold the verdict');
  assert.deepEqual(record.searched, [TINY_DOC],
    'precondition: the RECORD itself names the surface — that is what the table must not deny');

  const md = toMarkdown(map, findings, { generatedAt: 'a fixed stamp' });
  assert.doesNotMatch(md, /Not searched/,
    'the coverage table may not report an ACT: whether the extractor searched is exactly what this '
    + 'pipeline cannot observe, and on a refused record the blanked list is about ESTABLISHMENT');
  assert.match(md, /Not established/,
    'the column states what the map has established, which is the claim it can actually support');
  assert.ok(md.includes('declares its own completeness'),
    "and the row's reason must still name the record's real defect");
});

test('8b · a clean map states plainly that no drift was found', () => {
  // REMOVING THE UNDOCUMENTED NODE IS NOT ENOUGH, and asserting it was is how this test spent five
  // gate rounds validating a report its own map contradicted. `tiny` carries FOUR planted cases;
  // dropping `env.tiny_debug` leaves a PHANTOM on `mode.build` and STALE on `mode.check` and
  // `outcome.pass`. Handing `toMarkdown` a literal `[]` then asserts "no drift" over a map that
  // computes three findings. The precondition below is what makes the claim answerable at all.
  const map = cleanExceptInferred();
  const { findings } = computeDrift(map);
  assert.deepEqual(findings, [],
    'precondition: the map rendered as clean must COMPUTE no finding, not merely be handed []');
  const md = toMarkdown(map, findings);
  assert.match(md, /No drift findings/i);
  assert.doesNotMatch(md, /\*\*PHANTOM\*\*/);
});

test('8b2 · …and a map that ESTABLISHES a node as undocumented cannot be rendered as clean', () => {
  // The reverse of test 9's mismatch in `doc-harvest.test.mjs`, and the direction a caller reaches by
  // accident rather than by re-rendering a stale artifact: `[]` is an ASSERTION that this map has no
  // drift, and on `tiny` that assertion contradicts the map's own harvest.
  assert.throws(() => toMarkdown(loadTiny(), []),
    /toMarkdown: THIS map establishes env\.tiny_debug as UNDOCUMENTED[\s\S]*accuse it of nothing/);
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

test('14b · a hostile claimKind, source role, disposition and attribute name cannot break out either', () => {
  const map = loadTiny();
  map.nodes[1].claims[0].claimKind = `doc<img src=x> | \`x\``;
  map.sources[0].role = 'doc`|<b>';
  map.nodes[1].attrs = { '<script>bad</script>': '[a](b)' };
  // A `disposition` outside the closed vocabulary — the branch `DISPOSITION_MEANS` has no entry for,
  // which prints the value alongside a statement that the validator refuses it. That is the one place
  // a hostile disposition reaches the page as itself rather than as a dictionary lookup, so it is
  // asserted here with the other closed-set fields rather than poisoned in test 15 (where changing it
  // would only pick a different branch).
  const hostileDisposition = 'mentions<img src=x> | `x`';
  map.nodes.find((n) => n.id === 'component.tiny_core').docHarvest = {
    searched: [TINY_DOC],
    candidates: [{
      path: TINY_DOC, line: 8, quote: '- `check` — runs the core routine and prints `check ran`.',
      disposition: hostileDisposition,
    }],
  };
  const md = toMarkdown(map, driftOf(map));
  assert.match(md, /disposition: \*\*[\s\S]*?\*\* — a disposition outside the closed vocabulary/,
    'an unknown disposition must render as the violation it is, never as a blank');

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
  for (const source of [map.nodes[1].claims[0].claimKind, map.sources[0].role, hostileDisposition,
    '<script>bad</script>', '[a](b)']) {
    assert.ok(recovered.has(source), `${JSON.stringify(source)} is not recoverable from map.md`);
  }
});

/**
 * `tiny.map.json` with ONE REAL HARVEST CANDIDATE on the node the quoted line is about.
 *
 * The fixture's only `docHarvest` carries `candidates: []`, so a poisoned twin built from it left the
 * candidate's `path` and `quote` — and the disposition line the report prints beside them — OUTSIDE
 * the hostile-input test entirely, while that test claimed to cover every source-derived field. Those
 * fields are RENDERED (test 6c), so they are an output surface, and an output surface no poisoned
 * value reaches is coverage asserted rather than performed.
 */
function withHarvestCandidate(map) {
  map.nodes.find((n) => n.id === 'component.tiny_core').docHarvest = {
    searched: [TINY_DOC],
    candidates: [{
      path: TINY_DOC, line: 8, quote: '- `check` — runs the core routine and prints `check ran`.',
      disposition: 'mentions',
    }],
  };
  return map;
}

/**
 * An INERT string that is nonetheless an ILLEGAL PATH — the baseline's half of a fair comparison.
 *
 * WHY THIS EXISTS (2026-08-14). This test's oracle in (c) is that the two twins have the SAME NUMBER OF
 * LINES, which only measures escaping while the twins agree on WHICH FINDINGS EXIST. `PRESERVE` above
 * keeps that true for the fields that dispatch — `role`, `claimKind`, `disposition`. A doc source's
 * `path` joined them when the C-018 harvest gate began refusing a DECLARATION whose paths the path
 * rules reject (`diff.mjs`, `docDeclarationDefect`): the payload contains `https://evil.example/p`, so a
 * poisoned doc surface carries an EMPTY PATH SEGMENT and the whole map's harvest is withheld. The
 * poisoned twin therefore drops its UNDOCUMENTED finding — 4 findings against the clean twin's 3 — and
 * the line counts differed by one for a reason that had nothing to do with escaping.
 *
 * `path` cannot simply join `PRESERVE`: it is not a closed set, it is RENDERED, and this test's own
 * preconditions require the candidate's path to carry the payload. Nor can the poisoned chain be made
 * legal — a candidate may only sit on a surface the record says it searched, and a searched surface must
 * be a declared doc source, so poisoning the candidate path necessarily poisons the declaration.
 *
 * So the BASELINE is brought to the poisoned twin's harvest state instead, with a suffix that is
 * path-illegal for the very same reason (an empty segment) while carrying **no line start and no
 * markdown construct at all**. Both twins are then withheld identically, the findings match, and the
 * line-count oracle is measuring escaping again — which is the only thing it was ever meant to measure.
 */
const INERT_ILLEGAL_SUFFIX = '//inert';

/**
 * Append `suffix` to the DOC-SURFACE CHAIN — the declaration, its coverage classification, the node's
 * `searched` entry and the candidate that sits on it — so all four still agree with each other. Only
 * the `role: "doc"` chain matters here: the harvest gate checks path syntax on doc sources alone.
 */
function suffixDocChain(map, suffix) {
  const suffixed = `${TINY_DOC}${suffix}`;
  for (const source of map.sources) if (source.path === TINY_DOC) source.path = suffixed;
  map.coverage.read = map.coverage.read.map((p) => (p === TINY_DOC ? suffixed : p));
  for (const node of map.nodes) {
    const harvest = node.docHarvest;
    if (!harvest) continue;
    harvest.searched = (harvest.searched ?? []).map((p) => (p === TINY_DOC ? suffixed : p));
    for (const candidate of harvest.candidates ?? []) {
      if (candidate.path === TINY_DOC) candidate.path = suffixed;
    }
  }
  return map;
}

test('15 · every source-derived field is neutralised — the poisoned twin injects nothing', () => {
  const clean = suffixDocChain(withHarvestCandidate(loadTiny()), INERT_ILLEGAL_SUFFIX);
  const cleanMd = toMarkdown(clean, computeDrift(clean).findings);

  const dirty = poison(withHarvestCandidate(loadTiny()), 'map');
  const dirtyMd = toMarkdown(dirty, computeDrift(dirty).findings);

  // The precondition that keeps the oracle honest: the two twins agree on WHICH FINDINGS EXIST, so
  // every difference below is escaping and nothing else. Asserted rather than assumed, because it broke
  // silently once — see INERT_ILLEGAL_SUFFIX.
  //
  // COMPARED SEMANTICALLY, NOT BY COUNT (round-6 gate). Equal LENGTHS are satisfied by a swapped class
  // or a swapped node — two maps drifting in different ways by the same amount read as agreement, and
  // then every structural difference below gets attributed to the escaper. `poison` appends PAYLOAD to
  // every string outside PRESERVE, `id` included, so the projection strips it: that is normalising the
  // DELIBERATE poison, not loosening the comparison.
  const shape = (findings) => findings
    .map((f) => `${f.class} ${String(f.nodeId).split(PAYLOAD).join('')}`)
    .sort();
  assert.deepEqual(shape(computeDrift(dirty).findings), shape(computeDrift(clean).findings),
    'fixture precondition: the twins must produce the same findings — same classes on the same nodes '
    + '— or the line-count oracle in (c) is measuring the harvest gate rather than the escaper');

  // The precondition the old form silently lacked: the poisoned map really does carry a candidate,
  // and its path and quote really do carry the payload.
  const candidates = dirty.nodes.flatMap((n) => (n.docHarvest?.candidates ?? []));
  assert.equal(candidates.length, 1, 'fixture precondition: one harvest candidate is under test');
  assert.ok(candidates[0].quote.includes(PAYLOAD), 'the candidate QUOTE must carry the payload');
  assert.ok(candidates[0].path.includes(PAYLOAD), 'the candidate PATH must carry the payload');
  assert.equal(candidates[0].disposition, 'mentions',
    'and the disposition must NOT — it is a closed set the report dispatches on (see 14b)');
  assert.ok(dirtyMd.includes(safeText(candidates[0].quote)),
    'the poisoned candidate quote must actually reach the report, escaped');

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
  // (k) …including the REFUTED FRAGMENT, which this file used to exempt from poisoning on the ground
  //     that no renderer printed it. `map.md` prints it now (ADR C-019), so it is covered here like
  //     every other source-derived string: poisoned in the map, escaped on the way out, recovered
  //     exactly. The exemption is gone rather than narrowed.
  const poisonedQuotes = dirty.nodes.flatMap((n) => (n.contradictions ?? []).map((c) => c.refutedQuote));
  assert.equal(poisonedQuotes.length, 2, 'fixture precondition: two records, each carrying a fragment');
  for (const fragment of poisonedQuotes) {
    assert.ok(fragment.includes(PAYLOAD), 'the fragment itself must carry the payload — no exemption');
    assert.ok(dirtyMd.includes(safeText(fragment)),
      'the poisoned fragment must reach map.md as an escaped span');
    assert.ok([...recovered].includes(fragment),
      'and recover EXACTLY — safety may not be paid for in fidelity, this field included');
  }
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

// ─── 19-21 · what a zero-finding report may claim, and in whose voice ────────────────────────────

const nodeOf = (map, id) => map.nodes.find((n) => n.id === id);

/** Drop the nodes named, then re-prune the edges and views that referenced them. Legal IR out. */
function pruneNodes(map, drop) {
  const gone = new Set(drop);
  map.nodes = map.nodes.filter((n) => !gone.has(n.id));
  const kept = new Set(map.nodes.map((n) => n.id));
  map.edges = map.edges.filter((e) => kept.has(e.from) && kept.has(e.to));
  const keptEdges = new Set(map.edges.map((e) => e.id));
  for (const view of map.views) {
    if (Array.isArray(view.nodes)) view.nodes = view.nodes.filter((id) => kept.has(id));
    if (Array.isArray(view.edges)) view.edges = view.edges.filter((id) => keptEdges.has(id));
  }
  return map;
}

/**
 * A map whose REPORTABLE population is spotless, and which nonetheless carries — on INFERRED nodes —
 * one instance of each shape the zero-finding paragraph swears the map does not contain.
 *
 * WHY THIS FIXTURE EXISTS. `computeDrift` excludes `inferred: true` from EVERY finding class, twice
 * over: `awaitsDocVerdict` returns false for one, and the main loop `continue`s past one before any
 * family is computed. So an inferred node may legally be documented with `evidence: []` — a PHANTOM
 * in every respect except that guardrail 2 suppresses it — or carry a recorded contradiction, and
 * the finding list stays empty either way. Two of the drift section's three derived clauses were
 * written as universals over the whole map anyway ("every documented capability carries code
 * evidence", "the extractor recorded no contradiction"), while only the middle one was scoped. On
 * this map both universals are FALSE, and the report states them to a reader whose whole reason for
 * reading it is to find out whether the map contradicts itself.
 *
 * Neither counter-example is planted rhetoric:
 *   • clause 1's is the fixture's OWN `component.dispatch_table` — shipped `inferred: true`,
 *     documented at `SKILL.md:18`, `evidence: []`. Nothing here touches it;
 *   • clause 3's is the fixture's OWN contradiction on `mode.check` (`SKILL.md:8` against
 *     `run.sh:8`). The single mutation is the node's `inferred` flag; the record is untouched, so
 *     this test fabricates no statement about the fixture's files. That matters — test 8b of
 *     `doc-harvest.test.mjs` records what happened the last time a fixture bought "clean" with an
 *     invented documentation claim.
 */
function cleanExceptInferred() {
  const map = loadTiny();
  // Both are NON-inferred and both would be reported — `mode.build` is a real PHANTOM (documented,
  // no evidence) and `env.tiny_debug` a real UNDOCUMENTED — so neither belongs in a fixture about
  // what a report with ZERO findings may say.
  pruneNodes(map, ['mode.build', 'env.tiny_debug']);
  nodeOf(map, 'mode.check').inferred = true;
  // A second suppressed STALE would prove nothing the first does not.
  delete nodeOf(map, 'outcome.pass').contradictions;
  return map;
}

/** The same map with the one thing that makes it clean removed: a harvest-eligible node with no
 *  attestation, so the report takes its OTHER zero-finding branch — "NOT a clean bill of health". */
function withheldExceptInferred() {
  const map = loadTiny();
  pruneNodes(map, ['mode.build']);
  nodeOf(map, 'mode.check').inferred = true;
  delete nodeOf(map, 'outcome.pass').contradictions;
  delete nodeOf(map, 'env.tiny_debug').docHarvest;
  return map;
}

const driftLane = (md) => md.slice(md.indexOf('## Drift'), md.indexOf('## Nodes'));

/** The two clauses that were written as universals over the whole map, and are false on one. */
const UNSCOPED = [
  ['clause 1 — that every documented capability is evidenced', /every documented capability carries code evidence/i],
  ['clause 3 — that no contradiction was recorded', /recorded no contradiction[.,]/i],
];

test('19 · a CLEAN report scopes all THREE derived clauses to the non-inferred nodes, not just the middle one', () => {
  const map = cleanExceptInferred();
  assert.deepEqual(validate(map, { repoRoot: REPO_ROOT }).errors, [],
    'the counter-example must be a map the contract ACCEPTS — an illegal one proves nothing');
  const { findings, coverage } = computeDrift(map);
  assert.deepEqual(findings, [], 'precondition: this map computes no finding at all');
  assert.deepEqual(coverage.withheld, [], 'precondition: and withholds nothing — the CLEAN branch');

  // The counter-examples are DATA in the map being rendered, asserted rather than assumed.
  const phantom = nodeOf(map, 'component.dispatch_table');
  assert.equal(phantom.inferred, true);
  assert.deepEqual(phantom.evidence, [], 'clause 1: documented, and carrying no code evidence at all');
  assert.ok(phantom.claims.some((c) => c.claimKind === 'doc'));
  const contradicted = nodeOf(map, 'mode.check');
  assert.equal(contradicted.inferred, true);
  assert.equal(contradicted.contradictions.length, 1,
    'clause 3: the extractor DID record a contradiction on this map');

  const lane = driftLane(toMarkdown(map, findings, { generatedAt: 'a fixed stamp' }));
  for (const [what, unscoped] of UNSCOPED) {
    assert.doesNotMatch(lane, unscoped,
      `${what} is FALSE on this map — an inferred node refutes it, and the report states it anyway`);
  }
  assert.match(lane, /every documented \*\*non-inferred\*\* capability carries code evidence/i,
    'clause 1 must carry the same qualifier clause 2 already carries');
  assert.match(lane, /recorded no contradiction \*\*against a non-inferred node\*\*/,
    'and so must clause 3');
  // The qualifier is only load-bearing if the report says WHY it is there — and the existing sentence
  // explained one direction (evidenced-but-undocumented) out of the three it now governs.
  assert.match(lane, /governs all three/i,
    'the explanation must cover every clause it qualifies, not only the middle one');
});

test('20 · the NOT-a-clean-bill branch scopes the same two clauses — a withheld verdict does not license them either', () => {
  // The other zero-finding branch repeats both universals verbatim ("Every documented capability
  // carries code evidence and the extractor recorded no contradiction, but N nodes…"). Inferred
  // exclusion has nothing to do with the harvest, so the defect is identical on this path, and
  // fixing only the branch a reviewer happened to open is how one of two twins goes stale.
  const map = withheldExceptInferred();
  assert.deepEqual(validate(map, { repoRoot: REPO_ROOT }).errors, []);
  const { findings, coverage } = computeDrift(map);
  assert.deepEqual(findings, [], 'precondition: nothing is accused');
  assert.equal(coverage.withheld.length, 1, 'precondition: and exactly one verdict is withheld');

  const lane = driftLane(toMarkdown(map, findings, { generatedAt: 'a fixed stamp' }));
  assert.match(lane, /not a clean bill of health/i, 'precondition: this is the other branch');
  for (const [what, unscoped] of UNSCOPED) {
    assert.doesNotMatch(lane, unscoped, `${what} is FALSE on this map here too`);
  }

  // THE HALF THAT WAS MISSING, and it made this twin a weaker test than the one it mirrors: rejecting
  // the OLD wording is satisfied just as well by deleting both clauses outright. Test 19 pins the
  // SCOPED form positively on the clean branch; this branch must pin it too, or "scoped" and "absent"
  // are indistinguishable here (round-6 gate).
  assert.match(lane, /every documented \*\*non-inferred\*\* capability carries code evidence/i,
    'clause 1 must be PRESENT in its scoped form, not merely absent in its unscoped one');
  assert.match(lane, /recorded no contradiction \*\*against a non-inferred node\*\*/,
    'and so must clause 3');
});

test('21 · the report describes the harvest ATTESTATION, and never an act the pipeline cannot observe', () => {
  // ADR C-018's amendment (2026-08-14): `docHarvest.searched` and `sources[].role` are both written
  // by the extractor, and the HARVEST CHECKS only compare those two lists to each other. No harvest
  // check opens a file. *(Scoped 2026-08-28 per ADR C-026: the unqualified "it never opens a file" is
  // false — `render.mjs` → `checkFreshness()` → `fs.readFileSync` reads every declared source. The two
  // reads are different acts: freshness verifies bytes against a declared digest; nothing verifies
  // that an extractor searched anything.)* `SKILL.md` says so to the extractor in as many words — *"Nothing downstream can check
  // whether you actually read anything"* — and then this report told the READER that a harvest "was
  // run", that "the search ran and returned no hit", and that a surface went "unread". Every one of
  // those is a claim about the world that no artifact in this pipeline can support: an extractor who
  // opened nothing at all produces byte-identical records.
  //
  // Rendered over BOTH fixtures because the phrasings are spread across three modules — the node
  // block and the coverage section (`markdown.mjs`), and the withheld reasons (`diff.mjs`) — and no
  // single map reaches all of them. `tiny` has nodes with no record AND a record with no candidate;
  // the withheld map reaches the drift lane's withheld sentence and the reason column.
  const forbidden = [
    ['that a harvest was performed, or was not', /harvest (?:was run|ran)\b/i],
    ['that a search was performed', /\bthe search ran\b|\bsearch was run\b/i],
    ['that a documentation surface went unread', /\bunread\b/i],
  ];
  for (const [what, map] of [['tiny', loadTiny()], ['a withheld map', withheldExceptInferred()]]) {
    const md = toMarkdown(map, computeDrift(map).findings, { generatedAt: 'a fixed stamp' });
    for (const [claim, pattern] of forbidden) {
      assert.doesNotMatch(md, pattern,
        `${what}: map.md may not tell a reader ${claim} — nothing in this pipeline observes a file`);
    }
  }

  // …and the correction must not go mute. Each site still has to say what the map holds, or the
  // report loses the fact rather than restating it.
  const tinyMd = toMarkdown(loadTiny(), driftOf(loadTiny()), { generatedAt: 'a fixed stamp' });
  assert.match(tinyMd, /Documentation harvest: \*\*no record\*\* — no harvest was attested for this node/,
    'the absent-record line must still state the absence, as an absent ATTESTATION');
  assert.match(tinyMd, /\(none — the attestation records no candidates\)/,
    'and an empty candidate list must be reported as what the record holds');
});
