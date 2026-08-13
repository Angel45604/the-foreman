// the-cartographer — page assembly, the fail-closed write, and the CLI (execution plan Task 8).
//
// `render()` is the ONE place the four artifacts are produced, and that is the point: the snapshot
// (`map.json`), the derived findings (`drift.json`), the page (`map.html`) and the self-sufficient
// report (`map.md`) are written together, from ONE read of ONE file, after ALL FOUR have been
// scanned. Every part of that sentence closed a real defect:
//
//   • ONE READ — a validator that reads the file and a writer that reads it again are checking a
//     different map from the one they ship. The parse happens once, is normalized once, and every
//     step below works on that value.
//   • ALL FOUR — `map.json` and `drift.json` were once written UNSCANNED beside a gate that claimed
//     to cover every artifact, because the caller wrote the snapshot itself. So `render` OWNS the
//     snapshot write: there is no path by which a caller can put one on disk unscanned.
//   • BEFORE — scanning after the first write means the first write already happened. Nothing is
//     opened for writing until every artifact has passed.
//
// Zero dependencies: node built-ins only.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { groupByAttention } from './attention.mjs';
import { ingestStrict } from './canonical.mjs';
import { normalize, serialize } from './serialize.mjs';
import { validate } from './validate.mjs';
import { checkFreshness } from './freshness.mjs';
import { computeDrift } from './diff.mjs';
import { escapeXml, renderHero } from './svg.mjs';
import { renderMermaid } from './mermaid.mjs';
import { toMarkdown, orderViews } from './markdown.mjs';
import { scan } from './secret-scan.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * The stylesheet is READ ONCE, at import, and inlined into every page (ADR C-007). Reading it per
 * render would let the page's appearance depend on when it was called; inlining it is what makes the
 * output self-contained — no `<link>`, so it renders identically from a published Artifact, from a
 * local `file://` URL, and inside a the-foreman deck.
 */
const STYLESHEET = fs.readFileSync(path.join(HERE, 'style.css'), 'utf8');

const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const asArray = (v) => (Array.isArray(v) ? v : []);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** An OPTIONAL string field: absent or null renders the caller's explicit words, never a placeholder. */
const maybe = (value, absent) => (value === undefined || value === null ? absent : escapeXml(value));

/**
 * A REQUIRED number. The counterpart to `escapeXml`'s refusal to coerce, and for the same reason:
 * `String(undefined)` is how a literal `undefined` reaches a reader, and a page that cannot say how
 * many lines a source has must fail loudly rather than print a blank cell that reads as "zero".
 * `undefined:undefined` in rendered output was a real defect in this build, not a hypothetical.
 */
function showNumber(value, what) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(
      `renderPage: ${what} expected a number, got ${value === undefined ? 'undefined' : typeof value}. `
      + 'Rendering it anyway would print a placeholder where the map has no value.',
    );
  }
  return String(value);
}

const NOT_STATED = '(not stated)';

// ─── repoRoot derivation (execution plan Task 8) ─────────────────────────────────────────────────

/**
 * resolveRepoRoot(mapPath, explicit) -> an absolute, symlink-resolved repo root.
 *
 * `sources[].path` entries are repo-relative, so freshness and containment both resolve them against
 * a root. Resolving against an arbitrary `process.cwd()` silently checks the WRONG files — or none —
 * and then reports fresh, which is the most dangerous possible failure for a tool whose whole claim
 * is "this snapshot corresponds to this source". There is therefore no cwd fallback anywhere in this
 * file, and the precedence is fixed:
 *
 *   1. an explicit root (`--repo-root`, or `opts.repoRoot`);
 *   2. else `git rev-parse --show-toplevel` run FROM THE DIRECTORY CONTAINING map.json — the snapshot
 *      lives in the subject's own repository (ADR C-009), so that is the correct anchor, and running
 *      it from the process cwd instead would anchor to whatever directory the shell happened to be in;
 *   3. else FAIL, naming both options.
 *
 * The result is realpath-resolved because the containment check it feeds compares realpaths; handing
 * it a symlinked root would make every source look like it resolves outside the repo.
 */
export function resolveRepoRoot(mapPath, explicit) {
  if (explicit !== undefined && explicit !== null) {
    if (typeof explicit !== 'string' || explicit.trim() === '') {
      throw new Error(`resolveRepoRoot: an explicit repoRoot must be a non-empty string — got ${JSON.stringify(explicit)}.`);
    }
    const resolved = path.resolve(explicit);
    try {
      return fs.realpathSync(resolved);
    } catch {
      throw new Error(
        `resolveRepoRoot: the repo root ${JSON.stringify(explicit)} does not exist on disk, so no `
        + 'source path can be resolved against it.',
      );
    }
  }

  if (typeof mapPath !== 'string' || mapPath.trim() === '') {
    throw new Error('resolveRepoRoot: mapPath must be a non-empty string.');
  }
  const from = path.dirname(path.resolve(mapPath));
  try {
    const top = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: from,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (top !== '') return fs.realpathSync(top);
  } catch {
    // Not a repository, or git is not installed. Both fall through to the explicit failure below —
    // never to a guess.
  }

  throw new Error(
    `resolveRepoRoot: could not determine the repo root for ${JSON.stringify(mapPath)}. Its source `
    + 'paths are repo-relative, so one is required. Either pass --repo-root <path> (opts.repoRoot), '
    + `or place the map inside a git worktree — "git rev-parse --show-toplevel" was run from `
    + `${JSON.stringify(from)} and found none. The root is NEVER inferred from the current working `
    + 'directory (cwd): that would silently check the wrong files, or none, and report the snapshot '
    + 'fresh.',
  );
}

// ─── the page ────────────────────────────────────────────────────────────────────────────────────

/** One drift class → the badge modifier that carries it. Colour is never the only carrier. */
const badge = (cls) => `<span class="carto-badge carto-badge--${escapeXml(cls).toLowerCase()}">${escapeXml(cls)}</span>`;

/** `path:line`, in the one citation form the whole page uses. */
function citation(record) {
  if (!isRecord(record) || typeof record.path !== 'string' || typeof record.line !== 'number') {
    throw new Error(
      'renderPage: a citation must carry a string path and a numeric line — a page that cites '
      + `nothing a reader can open is unauditable. Got ${JSON.stringify(record)}.`,
    );
  }
  return `<code>${escapeXml(record.path)}:${record.line}</code>`;
}

/** The quoted half of a citation — a claim's text or an evidence note — when it carries one. */
function quoted(record) {
  const text = typeof record.text === 'string' ? record.text
    : typeof record.note === 'string' ? record.note : null;
  return text === null ? '' : `<span class="carto-quote">${escapeXml(text)}</span>`;
}

const cell = (html) => `<td>${html}</td>`;
const headerCell = (text) => `<th>${escapeXml(text)}</th>`;

/** Wide content scrolls in its OWN box, so the page body never scrolls sideways with it. */
const scroll = (inner) => `<div class="carto-scroll">${inner}</div>`;

const table = (headers, rows) => scroll(
  `<table><thead><tr>${headers.map(headerCell).join('')}</tr></thead>`
  + `<tbody>${rows.map((r) => `<tr>${r.join('')}</tr>`).join('')}</tbody></table>`,
);

/**
 * PDR §6.2 — the defect must be visible in THE PICTURE, not only in a table.
 *
 * A map whose findings all live in the drift lane and a capability table has silently degraded into
 * a table-with-pictures: the reader who looks at the diagram, which is the thing this skill exists to
 * produce, sees a clean system. Prose in `SKILL.md` cannot guarantee otherwise, so it is enforced
 * here and it fails CLOSED — an undrawable accusation is a missing one.
 */
function enforceOnMapDrift(views, drift) {
  const drawn = new Set(
    views.filter((v) => v.form === 'svg-hero' || v.form === 'mermaid')
      .flatMap((v) => asArray(v.nodes)),
  );
  const invisible = [...new Set(drift.map((f) => f.nodeId))].filter((id) => !drawn.has(id)).sort();
  if (invisible.length > 0) {
    throw new Error(
      `renderPage: ${invisible.join(', ')} carry drift but appear in no graph view (PDR §6.2). A `
      + 'finding a reader can only meet in a table has been hidden from the picture, and the map has '
      + 'quietly become a table with pictures. Add the node to the overview or to a mermaid view.',
    );
  }
}

/**
 * renderPage(map, findings, opts?) -> a complete, self-contained HTML document.
 *
 * Pure. Reads both inputs once, through the shared boundary, and returns a string — nothing is
 * mutated and nothing aliases the caller's data.
 *
 * `findings` is REQUIRED, with no empty default: a default once drew a DRIFTING map as clean for a
 * caller who simply forgot the argument. An explicit `[]` is a different act — asserting there is
 * none.
 */
export function renderPage(map, findings, opts = {}) {
  if (findings === undefined) {
    throw new Error(
      'renderPage: findings is required — pass the drift findings, or an explicit [] to assert this '
      + 'map has none. Defaulting silence to [] draws a drifting map as clean, which is the one lie '
      + 'a map may not tell.',
    );
  }
  if (!Array.isArray(findings)) {
    throw new Error(`renderPage: findings must be an array — got ${JSON.stringify(findings) ?? 'undefined'}.`);
  }
  if (!isRecord(opts)) throw new Error('renderPage: opts must be an object when supplied.');

  // ONE ingest each. The map takes `normalize` (the shared boundary plus the IR's total ordering), so
  // the page is a function of CONTENT and not of the extractor's emission order; the findings take
  // the boundary alone, because their order is already canonical AND meaningful — see markdown.mjs.
  const snapshot = normalize(map);
  const drift = ingestStrict(findings, {
    at: 'findings',
    frame: (at, reason) => (
      `renderPage: ${at} ${reason}. The page reads its findings ONCE, as inert data, so the drift `
      + 'drawn is the drift that was computed.'
    ),
  });

  const views = orderViews(asArray(snapshot.views));
  enforceOnMapDrift(views, drift);

  const body = [
    headerSection(snapshot, opts),
    driftSection(snapshot, drift),
    ...views.map((view) => viewSection(view, snapshot, drift)),
    coverageSection(snapshot),
    sourcesSection(snapshot),
  ].join('\n');

  // Every field below is REQUIRED by the contract, so it is read without a fallback: `escapeXml`
  // throws on anything that is not a string, which is the loud failure a missing name deserves.
  const title = `${escapeXml((isRecord(snapshot.subject) ? snapshot.subject : {}).title)} — map`;
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${title}</title>`,
    '<style>',
    STYLESHEET.trim(),
    '</style>',
    '</head>',
    '<body>',
    '<article class="carto">',
    body,
    '</article>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

function headerSection(snapshot, opts) {
  const subject = isRecord(snapshot.subject) ? snapshot.subject : {};
  const meta = [
    ['Slug', subject.slug],
    ['Kind', subject.kind],
    ['Root', subject.root],
    ['Schema version', snapshot.schemaVersion],
    ['Extractor version', snapshot.extractorVersion],
  ];
  if (opts.generatedAt !== undefined) meta.push(['Generated', opts.generatedAt]);
  return [
    '<header class="carto-header">',
    `<p class="carto-kicker">the-cartographer · ${escapeXml(subject.kind)} map</p>`,
    `<h1>${escapeXml(subject.title)}</h1>`,
    `<p class="carto-lead">${escapeXml(subject.summary)}</p>`,
    `<dl class="carto-meta">${meta.map(([k, v]) => `<dt>${escapeXml(k)}</dt><dd>${escapeXml(v)}</dd>`).join('')}</dl>`,
    '</header>',
  ].join('\n');
}

/**
 * The drift lane — rendered ONCE, and NOT from `views[]`.
 *
 * PDR §6 keeps drift out of `views[]` deliberately: it derives from `drift.json` rather than from
 * nodes, and its rows have a different shape from a capability table, so making the generic table
 * renderer carry both would give one renderer two unrelated row shapes. The `data-carto-lane="drift"`
 * marker is what lets a test assert "exactly once" rather than "at least once".
 *
 * Within the lane the findings are GROUPED by attention bucket (ADR C-017, PDR §6.2). That is
 * presentation and nothing else: the count stated is the raw count, every finding is rendered, and
 * `enforceOnMapDrift` above still runs over ALL of them, so nothing a bucket touches can remove a
 * finding from the page or from the diagrams. `likely-contract` and `ambiguous-review` are plain
 * blocks a reader meets without acting; only `implementation-detail` is a native `<details>` — no
 * script, because the page is self-contained and CSP-safe (ADR C-007) and an accordion is not worth
 * a script tag.
 */
function driftSection(snapshot, drift) {
  const nodesById = new Map(asArray(snapshot.nodes).map((n) => [n.id, n]));
  const parts = [
    '<section class="carto-section" id="drift" data-carto-lane="drift">',
    '<h2>Drift</h2>',
  ];

  if (drift.length === 0) {
    parts.push(
      '<p class="carto-clean">No drift findings were computed for this map.</p>',
      '<p>Every documented capability carries code evidence, every evidenced capability is documented,'
      + ' and the extractor recorded no contradiction. An inferred node can never raise a finding'
      + ' (PDR §8.1 guardrail 2), so this is a statement about the enumerable contracts only.</p>',
      '</section>',
    );
    return parts.join('\n');
  }

  const groups = groupByAttention(drift, nodesById);
  parts.push(
    `<p>${plural(drift.length, 'finding')}, in the drift engine's reporting order: a confirmed defect`
    + ' before an uncheckable claim. Every finding below is also drawn on the diagrams.</p>',
    // The tally names every group, empty ones included, so a reader can see that nothing was
    // filtered — only that some of it was folded away.
    `<p class="carto-note">Grouped by how much attention each is likely to need — presentation only:`
    + ` ${groups.map((g) => `${g.findings.length} ${escapeXml(g.title.toLowerCase())}`).join(', ')}.`
    + ' Detection is unchanged and universal; every finding here is in <code>drift.json</code> and in'
    + ' <code>map.md</code> whichever group it lands in.</p>',
  );
  for (const group of groups) {
    if (group.findings.length > 0) parts.push(driftGroup(group, nodesById));
  }
  parts.push('</section>');
  return parts.join('\n');
}

/** One attention bucket: a heading, what the bucket promises, and its findings table. */
function driftGroup(group, nodesById) {
  const heading = `${escapeXml(group.title)} · ${plural(group.findings.length, 'finding')}`;
  const rows = group.findings.map((finding) => [
    cell(badge(finding.class)),
    cell(`<code>${escapeXml(finding.nodeId)}</code><span class="carto-quote">${escapeXml(nodesById.get(finding.nodeId)?.label ?? finding.label)}</span>`),
    cell(escapeXml(finding.detail)),
    cell(asArray(finding.citations).map((c) => `<span class="carto-cite">${citation(c)}${quoted(c)}</span>`).join('')),
  ]);
  const inner = [
    `<p class="carto-note">${escapeXml(group.blurb)}</p>`,
    table(['Class', 'Node', 'What was found', 'Cited at'], rows),
  ];
  const attrs = `class="carto-bucket" data-carto-bucket="${escapeXml(group.bucket)}"`;
  // The trailing comment is a structural marker, not decoration: it is what lets a test slice the
  // page into groups without parsing HTML, and therefore what lets "visible without expanding" be
  // asserted rather than eyeballed.
  const body = group.collapsible
    ? [`<details ${attrs}>`, `<summary>${heading}</summary>`, ...inner, '</details>']
    : [`<div ${attrs}>`, `<h3>${heading}</h3>`, ...inner, '</div>'];
  return [...body, '<!-- /carto-bucket -->'].join('\n');
}

function viewSection(view, snapshot, drift) {
  const facts = [`id: ${escapeXml(view.id)}`, `form: ${escapeXml(view.form)}`];
  if (view.mermaidType !== undefined) facts.push(`type: ${escapeXml(view.mermaidType)}`);
  const parts = [
    `<section class="carto-section" id="view-${escapeXml(view.id)}">`,
    `<h2>${escapeXml(view.title)}</h2>`,
    `<p class="carto-note">${facts.join(' · ')}</p>`,
  ];

  if (view.form === 'svg-hero') {
    parts.push(renderHero(view, snapshot, drift));
  } else if (view.form === 'mermaid') {
    // Wrapped for the Artifact host, which renders `<pre class="mermaid">` natively. Escaped even so:
    // the emitter neutralises mermaid's grammar, not HTML's, and a `&` left raw inside a <pre> is
    // still an entity opener.
    parts.push(scroll(`<pre class="mermaid">${escapeXml(renderMermaid(view, snapshot, drift))}</pre>`));
    parts.push(
      '<p class="carto-note">Mermaid renders in the Artifact host; in a bare file:// page this block'
      + ' shows as source. The overview above is generated SVG precisely so one view always draws.</p>',
    );
  } else {
    parts.push(tableView(view, snapshot, drift));
  }
  parts.push('</section>');
  return parts.join('\n');
}

/**
 * A `table` view. The IR declares the COLUMN NAMES and the NODES but carries no cell data, so each
 * cell is derived from the node by column name. An unrecognised name is FILLED with an explicit
 * marker rather than refused: `validate.mjs` is the single source of truth for the contract (ADR
 * C-006) and it accepts any non-empty column string, so a renderer that threw here would be a second,
 * stricter copy of the contract — exactly the validator/renderer disagreement every phase of this
 * build has spent its review rounds removing. It is never `undefined`.
 */
function tableView(view, snapshot, drift) {
  const nodes = new Map(asArray(snapshot.nodes).map((n) => [n.id, n]));
  const classes = new Map();
  for (const finding of drift) {
    if (!classes.has(finding.nodeId)) classes.set(finding.nodeId, []);
    classes.get(finding.nodeId).push(finding.class);
  }
  const columns = asArray(view.columns);
  const rows = asArray(view.nodes).map((id) => {
    const node = nodes.get(id);
    if (node === undefined) {
      throw new Error(
        `renderPage: view ${JSON.stringify(view.id)} lists node ${JSON.stringify(id)}, which the map `
        + 'does not carry. A row naming nothing is worse than no row.',
      );
    }
    return columns.map((column) => cell(tableCell(column, node, classes)));
  });
  return table(columns, rows);
}

const columnKey = (name) => String(name).toLowerCase().replace(/[^a-z]/g, '');

const CITED = (records) => (asArray(records).length === 0
  ? '(none)'
  : asArray(records).map((r) => citation(r)).join(' '));

/** ADR C-014: only a `claimKind: "doc"` claim documents a capability. */
function docStatus(node) {
  const docs = asArray(node.claims).filter((c) => isRecord(c) && c.claimKind === 'doc');
  return docs.length === 0 ? 'no' : `yes (${plural(docs.length, 'doc claim')})`;
}

const COLUMN_VALUE = new Map(Object.entries({
  capability: (n) => escapeXml(n.label),
  name: (n) => escapeXml(n.label),
  node: (n) => escapeXml(n.label),
  label: (n) => escapeXml(n.label),
  id: (n) => `<code>${escapeXml(n.id)}</code>`,
  kind: (n) => `<code>${escapeXml(n.kind)}</code>`,
  lane: (n) => `<code>${escapeXml(n.lane)}</code>`,
  summary: (n) => maybe(n.summary, NOT_STATED),
  description: (n) => maybe(n.summary, NOT_STATED),
  inferred: (n) => (n.inferred === true ? 'yes' : 'no'),
  evidence: (n) => CITED(n.evidence),
  claims: (n) => CITED(n.claims),
  documented: (n) => escapeXml(docStatus(n)),
  docs: (n) => escapeXml(docStatus(n)),
  documentation: (n) => escapeXml(docStatus(n)),
  docstatus: (n) => escapeXml(docStatus(n)),
}));

function tableCell(column, node, classes) {
  const key = columnKey(column);
  if (key === 'drift') {
    const found = classes.get(node.id);
    return found === undefined ? '(none)' : found.map(badge).join(' ');
  }
  const derive = COLUMN_VALUE.get(key);
  return derive === undefined ? '(no value for this column)' : derive(node);
}

/** PDR §8.1 guardrail 4 — coverage is DECLARED, never silently truncated. */
function coverageSection(snapshot) {
  const coverage = isRecord(snapshot.coverage) ? snapshot.coverage : {};
  const read = asArray(coverage.read);
  const partial = asArray(coverage.partial);
  const skipped = asArray(coverage.skipped);

  const parts = [
    '<section class="carto-section" id="coverage">',
    '<h2>Coverage</h2>',
    `<p>Fully read: ${plural(read.length, 'file')}.</p>`,
    `<ul>${read.map((p) => `<li><code>${escapeXml(p)}</code></li>`).join('')}</ul>`,
  ];
  for (const [label, entries] of [['Partially read', partial], ['Skipped', skipped]]) {
    parts.push(`<h3>${label}</h3>`);
    if (entries.length === 0) {
      parts.push('<p>None.</p>');
    } else {
      parts.push(`<ul>${entries.map((e) => `<li><code>${escapeXml(e.path)}</code> — ${escapeXml(e.why)}</li>`).join('')}</ul>`);
    }
  }
  parts.push(partial.length === 0 && skipped.length === 0
    ? '<p class="carto-clean">Every declared source was read in full — no file was partially read or skipped.</p>'
    : '<p>This map did NOT read every declared source in full. The entries above state what was left'
      + ' out and why, so nothing was silently truncated.</p>');
  parts.push('</section>');
  return parts.join('\n');
}

function sourcesSection(snapshot) {
  const sources = asArray(snapshot.sources);
  const rows = sources.map((s) => [
    cell(`<code>${escapeXml(s.path)}</code>`),
    cell(escapeXml(s.role)),
    cell(showNumber(s.lines, `sources[].lines for ${JSON.stringify(s.path)}`)),
    cell(`<code>${escapeXml(s.sha256)}</code>`),
  ]);
  return [
    '<section class="carto-section" id="sources">',
    '<h2>Sources</h2>',
    `<p>${plural(sources.length, 'source file')}, each with the sha256 digest and line count recorded`
    + ' at extraction time. A snapshot whose digests no longer match the files on disk is stale by'
    + ' construction and must be regenerated, never patched.</p>',
    table(['Path', 'Role', 'Lines', 'sha256'], rows),
    '</section>',
  ].join('\n');
}

// ─── the write ───────────────────────────────────────────────────────────────────────────────────

/**
 * `drift.json` — DERIVED output, never part of the snapshot (ADR C-004). Intra-run drift is fully
 * derivable from `map.json`, and keeping it out keeps the snapshot a clean function of the source, so
 * editing a doc does not perturb the structural diff Phase 6 runs over it.
 *
 * Written through `serialize`, the one serializer, which brings the ADR C-003 wall-clock guard with
 * it for free. That does re-sort `findings` into the serializer's total content order rather than the
 * drift engine's reporting order — deliberate, and worth naming: the FILE is machine input for a
 * structural diff that compares content, so byte-stability is what it needs, while the PAGE and the
 * Markdown report keep the reporting order a human reads by.
 */
const driftDocument = (snapshot, findings) => ({
  schemaVersion: '1',
  subject: { slug: snapshot?.subject?.slug, kind: snapshot?.subject?.kind },
  findings,
});

/** The four artifacts, in the order they are written — after every one of them has been scanned. */
const ARTIFACT_NAMES = Object.freeze(['map.json', 'drift.json', 'map.html', 'map.md']);

/**
 * render(mapPath, outDir, opts?) -> { htmlPath, mdPath, driftPath, mapOutPath, findings }
 *
 * `opts.repoRoot`   — see `resolveRepoRoot`. Optional here, never inferred from cwd.
 * `opts.generatedAt`— the display stamp. Defaults to now. It reaches `map.html` and `map.md` only:
 *                     `serialize` refuses a DATE-TIME in `map.json` or `drift.json` (ADR C-003, as
 *                     amended 2026-08-13), so the rule is enforced by the writer rather than by
 *                     discipline. Date-time, and not "ISO-shaped": a generation stamp is always a
 *                     date-time — `new Date().toISOString()` produces one — while a BARE DATE is
 *                     ordinary source text and is carried, which is what lets a map quote a dated
 *                     changelog line. The default here is a real instant, so it is refused by
 *                     construction if it ever reaches the snapshot.
 *
 * There is NO option that skips validation, freshness or the secret scan. An unrecognised option is
 * simply ignored, so a hopeful `{ force: true }` changes nothing.
 */
export function render(mapPath, outDir, opts = {}) {
  if (typeof mapPath !== 'string' || mapPath.trim() === '') {
    throw new Error('render: mapPath must be a non-empty string.');
  }
  if (typeof outDir !== 'string' || outDir.trim() === '') {
    throw new Error('render: outDir must be a non-empty string.');
  }
  if (!isRecord(opts)) throw new Error('render: opts must be an object when supplied.');

  const repoRoot = resolveRepoRoot(mapPath, opts.repoRoot);
  const generatedAt = opts.generatedAt === undefined ? new Date().toISOString() : opts.generatedAt;

  // ONE read, ONE parse, ONE normalize. Everything below reads THIS value — a second read of the file
  // would mean the map that was validated is not the map that gets written.
  const source = path.resolve(mapPath);
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(source, 'utf8'));
  } catch (e) {
    throw new Error(`render: could not read ${source} as JSON — ${e?.message ?? String(e)}`);
  }
  const map = normalize(parsed);

  const verdict = validate(map, { repoRoot });
  if (!verdict.ok) {
    throw new Error(
      `render: ${source} is not a valid map, so no page was written (PDR §11 — fail closed before `
      + `render, no partial page):\n  - ${verdict.errors.join('\n  - ')}`,
    );
  }
  // `validate` SKIPS filesystem containment when given no root and says so in `warnings`. A writer
  // must treat that skip as fatal rather than as a pass — but since a root is always resolved above,
  // reaching this is a programming error, not a user one.
  if (!verdict.containmentChecked) {
    throw new Error('render: path containment was not verified; refusing to write. This is a bug — a root is always resolved.');
  }

  const freshness = checkFreshness(map, repoRoot);
  if (!freshness.fresh) {
    throw new Error(
      `render: ${source} is STALE — its recorded source facts no longer match the files on disk, so `
      + 'REGENERATE the map; do not patch it (PDR §14). A snapshot is a claim about one specific '
      + `source state, and editing it by hand makes it a claim about no state at all.\n  - `
      + `${freshness.details.join('\n  - ')}`,
    );
  }

  const { findings } = computeDrift(map);

  const bodies = new Map([
    ['map.json', serialize(map)],
    ['drift.json', serialize(driftDocument(map, findings))],
    ['map.html', renderPage(map, findings, { generatedAt })],
    ['map.md', toMarkdown(map, findings, { generatedAt })],
  ]);

  // THE GATE. Every artifact is scanned BEFORE any of them is opened for writing, so a hit leaves the
  // output directory exactly as it was found. `render` owns the `map.json` write for this reason: a
  // caller writing the snapshot itself is a path around this gate, and that path once shipped.
  const unclean = [];
  for (const name of ARTIFACT_NAMES) {
    const result = scan(bodies.get(name));
    if (!result.clean) unclean.push(`${name} (${result.hits.map((h) => h.category).join(', ')})`);
  }
  if (unclean.length > 0) {
    throw new Error(
      `render: fail-closed — a secret or PII pattern was found, so NONE of the four artifacts was `
      + `written (ADR C-008): ${unclean.join('; ')}. Rewrite the offending source text — code `
      + 'ownership must render as a handle, never an email address — and regenerate.',
    );
  }

  fs.mkdirSync(outDir, { recursive: true });
  for (const name of ARTIFACT_NAMES) fs.writeFileSync(path.join(outDir, name), bodies.get(name), 'utf8');

  return {
    htmlPath: path.join(outDir, 'map.html'),
    mdPath: path.join(outDir, 'map.md'),
    driftPath: path.join(outDir, 'drift.json'),
    mapOutPath: path.join(outDir, 'map.json'),
    findings,
  };
}

// ─── the CLI ─────────────────────────────────────────────────────────────────────────────────────

const USAGE = 'usage: render.mjs <map.json> <outDir> [--repo-root <path>]';

function usageError(detail) {
  const error = new Error(`${detail}\n${USAGE}`);
  error.code = 2;
  return error;
}

export function cli(argv) {
  const positional = [];
  let repoRoot;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--repo-root') {
      repoRoot = argv[i + 1];
      if (repoRoot === undefined) throw usageError('--repo-root needs a path.');
      i += 1;
    } else {
      positional.push(argv[i]);
    }
  }
  const [mapPath, outDir, ...extra] = positional;
  if (!mapPath || !outDir) throw usageError('render.mjs needs a map and an output directory.');
  if (extra.length > 0) throw usageError(`unexpected argument ${JSON.stringify(extra[0])}.`);
  return render(mapPath, outDir, { repoRoot });
}

/**
 * Am I the entry point?
 *
 * The naive `import.meta.url === \`file://${process.argv[1]}\`` is wrong TWICE, and each way makes
 * the CLI a SILENT NO-OP that still exits 0 — the worst possible failure for a command:
 *
 *   1. `import.meta.url` is percent-encoded and `argv[1]` is not, so a path with a space or a `#`
 *      never matches;
 *   2. `import.meta.url` is the module's REALPATH while `argv[1]` is the literal invocation path.
 *      The documented personal install is a SYMLINK (`~/.claude/skills/…` → this file), and on macOS
 *      `/tmp` and `/var` are themselves symlinks, so the two sides routinely differ.
 *
 * Realpath the argv side, then URL-ify BOTH through the same function, so the comparison is between
 * two canonical forms. Fail closed: any resolution error means "imported as a library", never a crash.
 */
export function isMain(metaUrl, argv1 = process.argv[1]) {
  if (!argv1) return false;
  try {
    return metaUrl === pathToFileURL(fs.realpathSync(argv1)).href;
  } catch {
    return false;
  }
}

if (isMain(import.meta.url)) {
  try {
    const result = cli(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify({
      htmlPath: result.htmlPath,
      mdPath: result.mdPath,
      driftPath: result.driftPath,
      mapOutPath: result.mapOutPath,
      findings: result.findings.length,
    }, null, 2)}\n`);
  } catch (e) {
    process.stderr.write(`${String(e?.message ?? e)}\n`);
    process.exit(e?.code === 2 ? 2 : 1);
  }
}
