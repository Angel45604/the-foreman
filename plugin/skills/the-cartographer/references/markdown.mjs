// the-cartographer — the SELF-SUFFICIENT Markdown report (PDR §12, execution plan Task 7).
//
// The condition this file exists to satisfy: an agent handed ONLY `map.md` must be able to
// reconstruct nodes, edges, capabilities, evidence, claims and current drift WITHOUT rendering a
// single diagram. So nothing here is a caption for a picture — every fact the IR carries is stated in
// text, and the mermaid blocks are a convenience on top rather than the payload.
//
// ─── the two contracts every interpolation has to satisfy at once ────────────────────────────────
//
// Every string this module writes came out of the SUBJECT's own files: a node label, a claim's text,
// an evidence note, a path. That is untrusted input, and Markdown is a language with a lot of active
// constructs to be injected into — a raw HTML tag, an active link or image, a heading, a code fence,
// a table pipe, and (the one an escaping table cannot reach) a BARE URL, which GFM autolinks with no
// syntax at all.
//
// So SAFETY wants those characters gone, and RECONSTRUCTION wants them kept, exactly. Two earlier
// mechanisms each satisfied one and broke the other:
//
//   • a BACKSLASH ESCAPE is not neutralisation — `\<img>` renders inert but still contains the literal
//     `<img`, so a consumer that greps the bytes sees the tag anyway;
//   • SUBSTITUTING a look-alike (`<` → `＜`, `[` → `［`, a whitespace collapse) does remove the
//     substring, but it is LOSSY and therefore fatal to the thing this report is for: `"<x>"` and
//     `"＜x>"` produced identical Markdown, as did `"a\nb"` and `"a b"`, so an agent handed only
//     `map.md` could not reconstruct the label — which is `map.md`'s entire purpose (PDR §12).
//     And it never closed the autolink anyway: a bare `https://` run survived it untouched.
//
// ONE mechanism settles both: every source-derived string is rendered as an INLINE CODE SPAN. Inside
// a code span Markdown is inert — no HTML, no link, no image, no emphasis, no fence, no autolink —
// AND the text is carried verbatim, so the two contracts stop fighting. What makes it airtight is
// that a span cannot be broken from inside: the fence is chosen LONGER than the longest backtick run
// in the content (CommonMark's own rule), so no arrangement of backticks can close it early.
//
// Three characters still cannot appear literally, and each is escaped INJECTIVELY — `\\`, `\n`, `\r`,
// `\t`, plus `\xHH` for the remaining control characters — so `recoverText` below undoes it exactly:
//
//   • a LINE ENDING would end the line and let every line-start construct (heading, fence, blockquote,
//     thematic break) form; a code span also converts one to a space, which would be lossy;
//   • a TAB and the other control characters are carried by no renderer faithfully.
//
// A `|` needs no escape here — it is inert inside a span — except in a TABLE ROW, where GFM splits
// cells before it parses inlines. `row()` escapes it there, and `recoverText`'s caller undoes that
// first, exactly as a GFM renderer does.
//
// Zero dependencies: node built-ins only.

import { ingestStrict } from './canonical.mjs';
import { normalize } from './serialize.mjs';
import { renderMermaid } from './mermaid.mjs';
import { bucketForFinding } from './attention.mjs';

/**
 * The one source string a code span cannot hold. CommonMark has no spelling for an EMPTY span —
 * ``` `` ``` is a two-backtick string, not an empty one — so the empty string is written as a marker
 * instead. It is unambiguous because every source-derived string is a code span and this is not one:
 * a subject that literally wrote "(empty string)" renders as `` `(empty string)` ``, with the fence.
 */
const EMPTY_STRING = '(empty string)';

/** The characters a code span cannot carry, mapped to an escape nothing else can produce. */
const ESCAPE = new Map([['\\', '\\\\'], ['\n', '\\n'], ['\r', '\\r'], ['\t', '\\t']]);

/** The longest run of backticks in `text` — what the fence has to beat. */
function longestBacktickRun(text) {
  let longest = 0;
  for (const run of text.match(/`+/g) ?? []) longest = Math.max(longest, run.length);
  return longest;
}

/**
 * safeText(value) -> one line of INERT and EXACTLY RECOVERABLE text: an inline code span.
 *
 * Inert, because Markdown parses nothing inside a code span — and the span cannot be broken from
 * inside, because the fence is longer than the longest backtick run it encloses. Recoverable, because
 * the content is the source string verbatim but for an injective escape; `recoverText` undoes it.
 *
 * THROWS on a non-string rather than coercing. `String(undefined)` is how a literal `undefined`
 * reaches a human reader, and a report that cannot say what a thing is called must fail loudly
 * instead of labelling it with a placeholder. (`escapeXml` in `svg.mjs` refuses for the same reason.)
 */
export function safeText(value) {
  if (typeof value !== 'string') {
    throw new Error(
      `safeText: expected a string, got ${value === null ? 'null' : typeof value}. Rendering it `
      + 'anyway would print a placeholder where the map has no value.',
    );
  }

  // Iterated by CODE POINT, so a surrogate pair is never split — an exactness claim has to hold for
  // an emoji in a label as much as for an angle bracket.
  let body = '';
  for (const ch of value) {
    const escaped = ESCAPE.get(ch);
    if (escaped !== undefined) { body += escaped; continue; }
    const code = ch.codePointAt(0);
    body += (code < 0x20 || code === 0x7f) ? `\\x${code.toString(16).padStart(2, '0')}` : ch;
  }
  if (body === '') return EMPTY_STRING;

  // CommonMark strips ONE space from each end of a span's content when it both begins and ends with
  // one — unless the content is all spaces, which is exempt. So a leading or trailing space is padded
  // back, and a leading or trailing BACKTICK is padded too: without the space it would fuse with the
  // fence into one longer backtick string and the span would not open where it appears to.
  const allSpaces = /^ +$/.test(body);
  const needsPad = body.startsWith('`') || body.endsWith('`')
    || (body.startsWith(' ') && body.endsWith(' '));
  const content = needsPad && !allSpaces ? ` ${body} ` : body;

  const fence = '`'.repeat(longestBacktickRun(body) + 1);
  return `${fence}${content}${fence}`;
}

/**
 * recoverText(rendered) -> the exact source string `safeText(source)` was given.
 *
 * The reconstruction contract, made EXECUTABLE. `map.md` exists so that an agent holding only it can
 * rebuild the map (PDR §12), which is a claim that has to be checkable rather than asserted — so the
 * inverse ships beside the renderer and the round-trip is a test, not a hope.
 *
 * It is written as the CommonMark rule read backwards, in the same order the renderer applies it:
 *   1. strip the backtick fence — the opening string, and the closing string of equal length;
 *   2. undo the SPACE PADDING exactly as a renderer would ("if the content both begins and ends with a
 *      space, and does not consist entirely of spaces, one space is removed from each end");
 *   3. undo this module's escape of the characters a code span cannot carry (below).
 */
export function recoverText(rendered) {
  if (typeof rendered !== 'string') throw new Error('recoverText: expected a string.');
  if (rendered === EMPTY_STRING) return '';

  const fence = /^`+/.exec(rendered)?.[0];
  if (fence === undefined || !rendered.endsWith(fence) || rendered.length < fence.length * 2) {
    throw new Error(
      `recoverText: ${JSON.stringify(rendered)} is not an inline code span, so it did not come from `
      + 'safeText. Every source-derived string in map.md is one.',
    );
  }
  const content = rendered.slice(fence.length, rendered.length - fence.length);
  const unpadded = content.startsWith(' ') && content.endsWith(' ') && !/^ *$/.test(content)
    ? content.slice(1, -1)
    : content;
  return unescapeInline(unpadded);
}

/** The escape table read backwards. Nothing else may follow a backslash in `safeText`'s output. */
const UNESCAPE = new Map([['\\', '\\'], ['n', '\n'], ['r', '\r'], ['t', '\t']]);

function unescapeInline(text) {
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== '\\') { out += text[i]; continue; }
    const marker = text[i + 1];
    if (marker === 'x') {
      const hex = text.slice(i + 2, i + 4);
      if (!/^[0-9a-f]{2}$/.test(hex)) throw new Error(`recoverText: malformed \\x escape at ${i}.`);
      out += String.fromCharCode(parseInt(hex, 16));
      i += 3;
      continue;
    }
    const plain = UNESCAPE.get(marker);
    if (plain === undefined) throw new Error(`recoverText: unknown escape \\${marker} at ${i}.`);
    out += plain;
    i += 1;
  }
  return out;
}

const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const asArray = (v) => (Array.isArray(v) ? v : []);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** An OPTIONAL field: absent or null renders the caller's explicit words, never a placeholder. */
const maybe = (value, absent) => (value === undefined || value === null ? absent : safeText(value));

/**
 * A JSON-shaped value rendered for a human — the only place a non-string reaches the report.
 *
 * `undefined` is REFUSED rather than printed. `JSON.stringify(undefined)` is itself `undefined`, so
 * the obvious `?? 'null'` fallback would report an ABSENT field as an explicitly null one — a
 * placeholder that does not merely omit information but asserts something the map never said. The
 * ingest boundary already refuses an own `undefined`, so reaching this is a bug worth hearing about.
 */
function showValue(value) {
  if (typeof value === 'string') return safeText(value);
  const json = JSON.stringify(value);
  if (json === undefined) {
    throw new Error(
      `showValue: cannot render ${typeof value} — it has no JSON spelling, so printing it would put a `
      + 'placeholder where the map has no value.',
    );
  }
  return safeText(json);
}

/** `path`:line — the citation form used everywhere in the report, so a reader learns it once. */
function citation(record) {
  if (!isRecord(record)) {
    throw new Error(`toMarkdown: a citation must be an object — got ${JSON.stringify(record)}.`);
  }
  if (typeof record.path !== 'string' || typeof record.line !== 'number') {
    throw new Error(
      'toMarkdown: a citation must carry a string path and a numeric line — a report that cites '
      + `nothing a reader can open is unauditable. Got ${JSON.stringify(record)}.`,
    );
  }
  return `${safeText(record.path)}:${record.line}`;
}

/**
 * The keys a citation renders with its own words. Everything ELSE a citation carries is still
 * printed (as `key = value`), so no field the extractor recorded is silently dropped.
 */
const NAMED_CITATION_KEYS = new Set(['path', 'line', 'text', 'note', 'claimKind', 'checked']);

/** The detail lines under one citation — claim text, evidence note, check status, then the rest. */
function citationDetail(record, indent) {
  const lines = [];
  const pad = ' '.repeat(indent);
  if (typeof record.claimKind === 'string') lines.push(`${pad}- claimKind: ${safeText(record.claimKind)}`);
  if (record.checked === true) lines.push(`${pad}- checked: **yes**`);
  if (record.checked === false) {
    lines.push(`${pad}- checked: **no** — the extractor could not check this claim, so it is reported`
      + ' as uncheckable rather than as a defect');
  }
  if (typeof record.text === 'string') lines.push(`${pad}- text: ${safeText(record.text)}`);
  if (typeof record.note === 'string') lines.push(`${pad}- note: ${safeText(record.note)}`);
  for (const key of Object.keys(record).sort()) {
    if (NAMED_CITATION_KEYS.has(key)) continue;
    lines.push(`${pad}- ${safeText(key)} = ${showValue(record[key])}`);
  }
  return lines;
}

/** One citation plus its detail, as a nested bullet at `indent` spaces. */
function citationBlock(record, indent) {
  return [`${' '.repeat(indent)}- ${citation(record)}`, ...citationDetail(record, indent + 2)];
}

// ─── the table view's cells ──────────────────────────────────────────────────────────────────────
//
// A `table` view declares its COLUMN NAMES and its NODES; the IR carries no cell data, so the
// renderer has to derive each cell from the node. The vocabulary below is keyed on the column name,
// letter-folded so "Doc Status" and "docstatus" are one key.
//
// An unrecognised column is FILLED, not refused. Refusing would make this vocabulary a second copy of
// the IR contract — `validate.mjs` accepts any non-empty column string (ADR C-006 makes it the single
// source of truth), so a renderer that threw on a column the validator allowed would put the two back
// to disagreeing about what a legal map is, which is the defect class every phase of this build has
// spent its review rounds on. The fallback text says exactly what happened; it is never `undefined`.

const NOT_STATED = '(not stated)';
const NO_COLUMN_VALUE = '(no value for this column)';

/**
 * Folded from the RAW column name, not from its rendering. `safeText` escapes a tab as the two
 * characters `\t`, so folding its output would read a letter `t` that the author never wrote and
 * "Doc\tStatus" would stop being "docstatus". Only reached for strings: the header row renders every
 * column through `safeText` first, which refuses anything else before a cell is ever derived.
 */
const columnKey = (name) => String(name).toLowerCase().replace(/[^a-z]/g, '');

const COLUMN_VALUE = new Map(Object.entries({
  capability: (n) => safeText(n.label),
  name: (n) => safeText(n.label),
  node: (n) => safeText(n.label),
  label: (n) => safeText(n.label),
  id: (n) => safeText(n.id),
  kind: (n) => safeText(n.kind),
  lane: (n) => safeText(n.lane),
  summary: (n) => maybe(n.summary, NOT_STATED),
  description: (n) => maybe(n.summary, NOT_STATED),
  inferred: (n) => (n.inferred === true ? 'yes' : 'no'),
  evidence: (n) => {
    const cited = asArray(n.evidence).map((e) => citation(e));
    return cited.length === 0 ? '(none)' : cited.join('; ');
  },
  claims: (n) => {
    const cited = asArray(n.claims).map((c) => citation(c));
    return cited.length === 0 ? '(none)' : cited.join('; ');
  },
  documented: docStatus,
  docs: docStatus,
  documentation: docStatus,
  docstatus: docStatus,
}));

/** ADR C-014: only a `claimKind: "doc"` claim documents a capability. */
function docStatus(node) {
  const docs = asArray(node.claims).filter((c) => isRecord(c) && c.claimKind === 'doc');
  return docs.length === 0 ? 'no' : `yes (${plural(docs.length, 'doc claim')})`;
}

function cellFor(column, node, driftByNode) {
  const key = columnKey(column);
  if (key === 'drift') return driftList(driftByNode.get(node.id));
  const derive = COLUMN_VALUE.get(key);
  return derive === undefined ? NO_COLUMN_VALUE : derive(node);
}

/**
 * The drift classes on one node. Rendered through `safeText` like every other value that arrives from
 * outside: `computeDrift` draws `class` from a closed vocabulary, but `toMarkdown` takes its findings
 * from a CALLER, and a renderer that trusts one field because it usually comes from a trustworthy
 * producer is holding a rule the contract does not state.
 */
const driftList = (classes) => (classes === undefined ? '(none)' : classes.map(safeText).join(', '));

/**
 * A row of already-safe cells. Padded, so a cell can never sit flush against a delimiter.
 *
 * The `|` escape is the one piece of neutralisation that survives, and it has to: GFM splits a row
 * into cells BEFORE it parses their inlines, so a pipe breaks the table even from inside a code span —
 * the GFM spec says as much, and prescribes `\|`. A renderer removes that backslash again before
 * parsing the cell, so the rendered text is exact; a reader of the FILE undoes it the same way, which
 * is what `recoverText`'s caller does for a table row.
 *
 * Injective, and therefore reversible: a backslash from source text is already `\\` by the time it
 * gets here, so every `\|` in a cell is one this line inserted.
 */
const row = (cells) => `| ${cells.map((cell) => cell.replace(/\|/g, '\\|')).join(' | ')} |`;

/**
 * The order the views are PRESENTED in, shared by this report and by `render.mjs` so the two
 * artifacts never tell the same story in two orders.
 *
 * Not the serializer's order. `normalize` sorts `views[]` by id because the FILE needs a total order
 * for byte-stability, and that order is alphabetical — which buries the Overview, the one view PDR
 * §6.1 calls the thing that must render everywhere, underneath "capabilities". So presentation ranks
 * by FORM first (hero, then the mermaid detail views, then the tables) and falls back to id, which is
 * still total: `validate.mjs` refuses duplicate view ids, so no two views can tie.
 */
const FORM_RANK = { 'svg-hero': 0, mermaid: 1, table: 2 };

export function orderViews(views) {
  return [...asArray(views)].sort((a, b) => {
    const rank = (FORM_RANK[a?.form] ?? 9) - (FORM_RANK[b?.form] ?? 9);
    if (rank !== 0) return rank;
    return String(a?.id) < String(b?.id) ? -1 : String(a?.id) > String(b?.id) ? 1 : 0;
  });
}

// ─── the report ──────────────────────────────────────────────────────────────────────────────────

/**
 * toMarkdown(map, findings, opts?) -> string
 *
 * Pure: nothing is mutated and nothing returned aliases the input. `opts.generatedAt` is a DISPLAY
 * string rendered into the report only — a generation time belongs in `map.html` / `map.md` and never
 * in `map.json` (ADR C-003), which is why it arrives as an argument rather than being read off the map.
 *
 * The map is read through `normalize` — the shared ingest boundary plus the IR's total ordering — so
 * the report is a function of the map's CONTENT and not of the extractor's emission order, and every
 * property is read exactly once, as the data `map.json` carries.
 *
 * `findings` is REQUIRED, with no empty default. A default once rendered a DRIFTING map as clean: the
 * report stated "No drift findings" for a caller who simply forgot the argument. For an audit tool a
 * missing accusation is worse than a wrong one, so silence fails closed. An explicit `[]` is a
 * different act — a caller ASSERTING this map has no drift.
 */
export function toMarkdown(map, findings, opts = {}) {
  if (findings === undefined) {
    throw new Error(
      'toMarkdown: findings is required — pass the drift findings, or an explicit [] to assert this '
      + 'map has none. Defaulting silence to [] reports a drifting map as clean, which is the one lie '
      + 'a map may not tell.',
    );
  }
  if (!Array.isArray(findings)) {
    throw new Error(`toMarkdown: findings must be an array — got ${JSON.stringify(findings) ?? 'undefined'}.`);
  }
  if (!isRecord(opts)) throw new Error('toMarkdown: opts must be an object when supplied.');

  // ONE ingest of each input, and everything below reads the snapshots alone.
  //
  // The MAP takes `normalize` — the shared boundary (canonical.mjs) PLUS the IR's total ordering — so
  // the report is a function of content rather than of the extractor's emission order.
  //
  // The FINDINGS take the boundary ALONE, deliberately. Their order is already canonical and it is
  // MEANINGFUL in two ways `normalize` would destroy: `computeDrift` sorts findings worst-class-first
  // (the sentence below promises exactly that), and it emits a STALE finding's citations as an ordered
  // PAIR — what was claimed, then what was observed — which it documents as "ORDERED, not sorted".
  // Re-sorting either by content would silently reword the report into something the data does not
  // say, which is the one thing an audit report may not do. Shuffle-invariance is not lost by this:
  // `computeDrift`'s own sort is total, so its output is already a function of the map's content.
  const snapshot = normalize(map);
  const drift = ingestStrict(findings, {
    at: 'findings',
    frame: (at, reason) => (
      `toMarkdown: ${at} ${reason}. The report reads its findings ONCE, as inert data, so the `
      + 'accusation printed is the accusation that was computed.'
    ),
  });

  const nodes = asArray(snapshot.nodes);
  const edges = asArray(snapshot.edges);
  const views = asArray(snapshot.views);
  const sources = asArray(snapshot.sources);
  const coverage = isRecord(snapshot.coverage) ? snapshot.coverage : {};

  const nodesById = new Map(nodes.map((n) => [n.id, n]));
  const driftByNode = new Map();
  for (const finding of drift) {
    if (!driftByNode.has(finding.nodeId)) driftByNode.set(finding.nodeId, []);
    driftByNode.get(finding.nodeId).push(finding.class);
  }

  const out = [];
  out.push(...header(snapshot, opts));
  out.push(...driftSection(drift, nodesById));
  out.push(...nodesSection(nodes, driftByNode));
  out.push(...edgesSection(edges));
  out.push(...viewsSection(views, snapshot, drift, nodesById, driftByNode));
  out.push(...coverageSection(coverage));
  out.push(...sourcesSection(sources));
  return `${out.join('\n')}\n`;
}

function header(snapshot, opts) {
  const subject = isRecord(snapshot.subject) ? snapshot.subject : {};
  const lines = [
    `# ${safeText(subject.title)} — map`,
    '',
    // The summary is a BULLET rather than a bare paragraph so that no source-derived string ever sits
    // at column 0. A code span whose fence is three or more backticks — which a summary quoting
    // ```` ``` ```` produces — would otherwise open a FENCED CODE BLOCK at the start of a line and
    // swallow the rest of the report.
    `- **Summary:** ${safeText(subject.summary)}`,
    `- **Slug:** ${safeText(subject.slug)}`,
    `- **Kind:** ${safeText(subject.kind)}`,
    `- **Root:** ${safeText(subject.root)}`,
    `- **Schema version:** ${safeText(snapshot.schemaVersion)}`,
    `- **Extractor version:** ${safeText(snapshot.extractorVersion)}`,
  ];
  if (opts.generatedAt !== undefined) lines.push(`- **Generated:** ${safeText(opts.generatedAt)}`);
  lines.push(
    '',
    'This report is self-sufficient. Every node, edge, claim, evidence citation, coverage decision'
    + ' and drift finding the map carries is stated below in full, so it can be read and'
    + ' reconstructed without rendering any diagram.',
    '',
  );
  return lines;
}

/**
 * The drift findings, in the drift engine's REPORTING order, each labelled with its attention bucket
 * (ADR C-017, PDR §6.2).
 *
 * Labelled, and NOT grouped. `map.html` folds the `implementation-detail` group behind a `<details>`
 * because a page has a reader who scrolls; `map.md` is the SELF-SUFFICIENT report (PDR §12), whose
 * whole contract is that an agent handed only this file can reconstruct every finding. So the bucket
 * arrives here as one more stated fact — usable for triage, and incapable of hiding anything. The
 * order stays the engine's, which is what the sentence above the list promises.
 */
function driftSection(drift, nodesById) {
  const lines = ['## Drift', ''];
  if (drift.length === 0) {
    lines.push(
      'No drift findings were computed for this map: every documented capability carries code'
      + ' evidence, every evidenced capability is documented, and the extractor recorded no'
      + ' contradiction. An inferred node can never raise a finding (PDR §8.1 guardrail 2), so a'
      + ' clean report is a statement about the enumerable contracts only.',
      '',
    );
    return lines;
  }
  // NOT "worst first": `computeDrift` sorts by DRIFT_CLASSES, its REPORTING order — a defect before
  // an uncheckable claim — which is not `layout.mjs`'s DRIFT_SEVERITY (the order a node's single
  // visual style is chosen by). Naming the wrong one would have this report describe an order it does
  // not have.
  lines.push(
    `${plural(drift.length, 'finding')}, in the drift engine's reporting order: a confirmed defect`
    + ' before an uncheckable claim. Each carries the attention bucket the page groups by — likely'
    + ' contract, ambiguous (needs review), or implementation detail. That is presentation only:'
    + ' detection is universal, and every finding is listed here in full whatever its bucket.',
    '',
  );
  for (const finding of drift) {
    const bucket = bucketForFinding(finding, nodesById.get(finding.nodeId));
    lines.push(
      `- **${safeText(finding.class)}** — ${safeText(finding.nodeId)} (${safeText(finding.label)})`
      + ` · attention: ${safeText(bucket)}`,
    );
    lines.push(`  - ${safeText(finding.detail)}`);
    lines.push('  - Citations:');
    for (const record of asArray(finding.citations)) lines.push(...citationBlock(record, 4));
  }
  lines.push('');
  return lines;
}

function nodesSection(nodes, driftByNode) {
  const lines = ['## Nodes', '', `${plural(nodes.length, 'node')}.`, ''];
  for (const node of nodes) {
    lines.push(`- **${safeText(node.id)}** — ${safeText(node.label)}`);
    lines.push(
      `  - kind: ${safeText(node.kind)} · lane: ${safeText(node.lane)} · inferred: `
      + `**${node.inferred === true ? 'yes' : 'no'}**`,
    );
    lines.push(`  - Summary: ${maybe(node.summary, NOT_STATED)}`);
    lines.push(`  - Attributes: ${attributes(node.attrs)}`);
    lines.push(`  - Drift: ${driftList(driftByNode.get(node.id))}`);

    const evidence = asArray(node.evidence);
    lines.push(`  - Evidence (${evidence.length}):${evidence.length === 0 ? ' (none)' : ''}`);
    for (const record of evidence) lines.push(...citationBlock(record, 4));

    const claims = asArray(node.claims);
    lines.push(`  - Claims (${claims.length}):${claims.length === 0 ? ' (none)' : ''}`);
    for (const record of claims) lines.push(...citationBlock(record, 4));

    const contradictions = asArray(node.contradictions);
    lines.push(`  - Contradictions (${contradictions.length}):${contradictions.length === 0 ? ' (none)' : ''}`);
    for (const record of contradictions) {
      if (!isRecord(record)) {
        throw new Error(`toMarkdown: ${node.id}.contradictions carries a non-object record.`);
      }
      lines.push(`    - ${safeText(record.statement)}`);
      lines.push(`      - claimed at ${citation(record.claim)}`);
      lines.push(...citationDetail(record.claim, 8));
      lines.push(`      - observed at ${citation(record.evidence)}`);
      lines.push(...citationDetail(record.evidence, 8));
    }
  }
  lines.push('');
  return lines;
}

/** `attrs` is the IR's one free-form region: absent, null, or a bag of named values. */
function attributes(attrs) {
  if (attrs === undefined || attrs === null) return '(none declared)';
  if (!isRecord(attrs)) throw new Error(`toMarkdown: attrs must be null or an object — got ${typeof attrs}.`);
  const keys = Object.keys(attrs).sort();
  if (keys.length === 0) return '(none declared)';
  return keys.map((key) => `${safeText(key)} = ${showValue(attrs[key])}`).join(' · ');
}

function edgesSection(edges) {
  const lines = ['## Edges', '', `${plural(edges.length, 'edge')}.`, ''];
  for (const edge of edges) {
    lines.push(`- **${safeText(edge.id)}**: ${safeText(edge.from)} → ${safeText(edge.to)}`);
    lines.push(`  - label: ${safeText(edge.label)} · kind: ${safeText(edge.kind)}`);
    const evidence = asArray(edge.evidence);
    lines.push(`  - Evidence (${evidence.length}):${evidence.length === 0 ? ' (none)' : ''}`);
    for (const record of evidence) lines.push(...citationBlock(record, 4));
  }
  lines.push('');
  return lines;
}

function viewsSection(views, snapshot, drift, nodesById, driftByNode) {
  const lines = ['## Views', ''];
  for (const view of orderViews(views)) {
    lines.push(`### ${safeText(view.title)}`, '');
    const facts = [`id: ${safeText(view.id)}`, `form: ${safeText(view.form)}`];
    if (view.mermaidType !== undefined) facts.push(`mermaidType: ${safeText(view.mermaidType)}`);
    lines.push(`- ${facts.join(' · ')}`);
    lines.push(`- nodes (${asArray(view.nodes).length}): ${idList(view.nodes)}`);
    if (view.edges !== undefined) {
      lines.push(`- edges (${asArray(view.edges).length}): ${idList(view.edges)}`);
    }

    if (view.form === 'mermaid') {
      lines.push('', '```mermaid', renderMermaid(view, snapshot, drift), '```', '');
    } else if (view.form === 'table') {
      const columns = asArray(view.columns);
      lines.push('');
      lines.push(row(columns.map((c) => safeText(c))));
      lines.push(row(columns.map(() => '---')));
      for (const id of asArray(view.nodes)) {
        const node = nodesById.get(id);
        if (node === undefined) {
          throw new Error(
            `toMarkdown: view ${JSON.stringify(view.id)} lists node ${JSON.stringify(id)}, which the `
            + 'map does not carry. A row naming nothing is worse than no row.',
          );
        }
        lines.push(row(columns.map((column) => cellFor(column, node, driftByNode))));
      }
      lines.push('');
    } else {
      lines.push(
        '- Rendered as an inline SVG diagram in `map.html`. Its nodes and edges are listed above in'
        + ' full, so this report needs no picture to be complete.',
        '',
      );
    }
  }
  return lines;
}

const idList = (ids) => (asArray(ids).length === 0 ? '(none)' : asArray(ids).map((id) => safeText(id)).join(', '));

function coverageSection(coverage) {
  const read = asArray(coverage.read);
  const partial = asArray(coverage.partial);
  const skipped = asArray(coverage.skipped);
  const lines = ['## Coverage', '', `- Fully read: ${plural(read.length, 'file')}.`];
  for (const p of read) lines.push(`  - ${safeText(p)}`);

  for (const [label, entries] of [['Partially read', partial], ['Skipped', skipped]]) {
    lines.push(`- ${label}: ${entries.length === 0 ? 'none.' : `${plural(entries.length, 'file')}.`}`);
    for (const entry of entries) {
      // PDR §8.1 guardrail 4: coverage is DECLARED, never silently truncated — so the reason travels
      // with the path, always.
      lines.push(`  - ${safeText(entry.path)} — why: ${safeText(entry.why)}`);
    }
  }
  lines.push('');
  lines.push(partial.length === 0 && skipped.length === 0
    ? 'Every declared source was read in full — no file was partially read or skipped.'
    : 'This map did NOT read every declared source in full. The entries above state what was left'
      + ' out and why, so nothing was silently truncated.');
  lines.push('');
  return lines;
}

function sourcesSection(sources) {
  const lines = [
    '## Sources',
    '',
    `${plural(sources.length, 'source file')}, each with the sha256 digest and line count recorded at`
    + ' extraction time. A snapshot whose digests no longer match the files on disk is stale by'
    + ' construction and must be regenerated, never patched.',
    '',
    row(['Path', 'Role', 'Lines', 'sha256']),
    row(['---', '---', '---', '---']),
  ];
  for (const source of sources) {
    lines.push(row([safeText(source.path), safeText(source.role), showValue(source.lines), safeText(source.sha256)]));
  }
  lines.push('');
  return lines;
}
