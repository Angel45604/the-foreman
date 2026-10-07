// the-cartographer — the render model: bounded lane layout (PDR §6.1, ADR C-002) and the ONE
// boundary through which both renderers read the IR (`resolveView`).
//
// Two responsibilities live here on purpose. `svg.mjs` and `mermaid.mjs` need exactly the same thing
// from `map.json` — a view's nodes and edges resolved to records, plus drift indexed by node — and
// Phase 2 recorded that the pipeline's remaining defects all trace to TWO MODULES DISAGREEING ABOUT
// WHAT A LEGAL MAP IS. Giving the renderers one shared reader rather than two hand-rolled ones is the
// cheapest way not to grow a third disagreement.
//
// The reader itself no longer decides what may be read. Both entry points below INGEST their input
// through `canonical.mjs` — the one boundary `validate.mjs`, `diff.mjs` and `serialize.mjs` also read
// through — and everything after that line works on inert JSON data, so a plain `obj.key` here IS the
// value the file carries. That is what makes the two-way agreement of PDR §7.1 rule 14 structural:
// this module cannot refuse a shape the validator accepts, because neither of them owns the rule.
//
// Zero dependencies: node built-ins only.

import { ingestStrict } from './canonical.mjs';
import { HERO_MAX_NODES } from './validate.mjs';

/** The hero's lane columns, left to right. PDR §6.1. */
export const LANE_ORDER = ['entry', 'core', 'output', 'external'];

/** Box geometry, in user units. Shared with `svg.mjs`, which draws inside these boxes. */
export const LAYOUT = Object.freeze({
  nodeWidth: 200,
  nodeHeight: 64,
  laneGap: 72,
  rowGap: 28,
  margin: 24,
});

/**
 * The severity precedence a node's SINGLE visual style is chosen by, worst first.
 *
 * A node can legitimately carry two findings of different classes — family (A) set-membership and
 * family (B) contradiction are computed independently, so UNDOCUMENTED + STALE is a real state, not a
 * bug. One box can only be drawn one way, so the worst class wins the STYLE and every class the node
 * carries is still surfaced in TEXT (`svg.mjs` writes them into `<title>` and the accessible label;
 * `mermaid.mjs` writes them into the node label). Dropping the second class silently was the failure
 * mode this ordering exists to prevent.
 *
 * The order: docs actively contradicting the code (STALE) is the most misleading state a reader can
 * be in; then documented-but-absent (PHANTOM); then implemented-but-undocumented (UNDOCUMENTED);
 * then merely unknown (UNVERIFIED), which is an absence of information rather than a defect.
 */
export const DRIFT_SEVERITY = ['STALE', 'PHANTOM', 'UNDOCUMENTED', 'UNVERIFIED'];

const SEVERITY_RANK = new Map(DRIFT_SEVERITY.map((cls, i) => [cls, i]));

const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const nonEmptyString = (v) => typeof v === 'string' && v.trim() !== '';
const show = (v) => (typeof v === 'string' ? JSON.stringify(v) : String(v));
const cmpString = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The render model's framing of an ingest refusal. The REASON is `canonical.mjs`'s — an accessor, a
 * hidden or inherited field, an exotic, a hole, a cycle — so a shape this module refuses is a shape
 * `validate()` reports in the same words, which is the agreement rule 14 asks for. What this adds is
 * what the refusal costs HERE: the value drawn would not be the value that was checked.
 */
const refusal = (entry) => (at, reason) => (
  `${entry}: ${at} ${reason}. The render model reads its input ONCE, as inert data, so the picture it `
  + 'draws is the picture that was checked.'
);

// ─── reading the SNAPSHOT ────────────────────────────────────────────────────────────────────────
//
// Everything below the ingest is plain JSON data owned by this module, so these read with `obj[key]`.
// The descriptor gymnastics that used to guard each read belong at the boundary, and only there: a
// second, weaker copy of the rule inside a reader is exactly how the renderers and the validator came
// to disagree about what a legal map is. An ABSENT field is simply not there — an inherited one is
// dropped by the ingest, and an own `undefined` is refused by it — so `undefined` here means the file
// will not carry the key either.

/** One required non-empty string field. */
function readString(at, obj, key) {
  const value = obj[key];
  if (!nonEmptyString(value)) {
    throw new Error(`${at}.${key} must be a non-empty string — got ${show(value)}.`);
  }
  return value;
}

/** One optional string field: absent or null means "not stated", never a placeholder. */
function readOptionalString(at, obj, key) {
  const value = obj[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    throw new Error(`${at}.${key} must be a string when present — got ${show(value)}.`);
  }
  return value;
}

function readArray(at, obj, key, { required }) {
  const value = obj[key];
  if (value === undefined) {
    if (required) throw new Error(`${at}.${key} is required — an absent array is a violation, not an empty default.`);
    return [];
  }
  if (!Array.isArray(value)) throw new Error(`${at}.${key} must be an array — got ${show(value)}.`);
  return value;
}

// ─── the bounded lane layout (ADR C-002) ─────────────────────────────────────────────────────────

// IMPORTED, not restated. The bound is one number in one place (ADR C-006): a local `15` here would
// be a second copy of a contract rule, which is the drift class this skill exists to detect.
const DEFAULT_MAX_NODES = HERO_MAX_NODES;

/**
 * layoutHero(nodes, opts?) -> { width, height, placed }
 *
 * Ranks nodes into lane columns and stacks them within a lane, deterministically and with no
 * overlap. Every placed box is contained by the reported `width` / `height`, so the caller can size
 * a `viewBox` from them and nothing is drawn off-canvas.
 *
 * FAILS CLOSED above `opts.maxNodes` (default 15). ADR C-002 makes the collapse rule the thing that
 * keeps this ~100 lines instead of a DAG engine, and a rule enforced only in prose is a rule the next
 * extraction quietly breaks.
 *
 * Pure: reads each input property exactly once, returns freshly built boxes, mutates nothing.
 */
export function layoutHero(nodes, opts = {}) {
  if (!Array.isArray(nodes)) {
    throw new Error(`layoutHero: nodes must be an array — got ${show(nodes)}.`);
  }
  if (!isRecord(opts)) throw new Error(`layoutHero: opts must be an object — got ${show(opts)}.`);

  const maxNodes = opts.maxNodes === undefined ? DEFAULT_MAX_NODES : opts.maxNodes;
  // Deliberately no escape hatch: `Infinity` here would make ADR C-002 advisory again, which is the
  // exact state the decision exists to leave behind.
  if (!Number.isSafeInteger(maxNodes) || maxNodes < 1) {
    throw new Error(
      `layoutHero: opts.maxNodes must be a positive integer — got ${show(maxNodes)}. The hero bound `
      + 'cannot be switched off (ADR C-002); collapse the view instead.',
    );
  }
  // …and refusing only `Infinity` would leave the hatch wide open, since any larger FINITE integer
  // raises the bound just as effectively. The option may TIGHTEN the ADR's number for a caller who
  // wants a smaller picture; it may never raise it. The option is judged on its own, not on whether
  // this particular input happened to stay under it, so the escape hatch cannot be left lying around
  // for the next caller to find.
  if (maxNodes > DEFAULT_MAX_NODES) {
    throw new Error(
      `layoutHero: opts.maxNodes is ${maxNodes}, above the hero bound of ${DEFAULT_MAX_NODES} (ADR `
      + 'C-002). maxNodes may tighten that bound, never loosen it — raising it is the escape hatch '
      + 'the bound exists to remove. Collapse the overview to component-level nodes instead; the '
      + 'detailed nodes stay available in the mermaid views, which have no such bound.',
    );
  }
  // ONE ingest, before the boxes are counted: an accessor `label` (or a hole, or a `Date` posing as
  // a node) is refused here, in the words `validate()` reports for the same value, rather than being
  // read once for the check and again by whoever draws it.
  const snapshot = ingestStrict(nodes, { at: 'nodes', frame: refusal('layoutHero') });

  if (snapshot.length > maxNodes) {
    throw new Error(
      `layoutHero: the overview carries ${snapshot.length} nodes, above the cap of ${maxNodes} (ADR `
      + 'C-002). Collapse the overview to component-level nodes — the detailed nodes stay available '
      + 'in the mermaid views, which have no such bound.',
    );
  }

  const seen = new Set();
  const read = snapshot.map((n, i) => {
    const at = `layoutHero: nodes[${i}]`;
    if (!isRecord(n)) throw new Error(`${at} must be an object — got ${show(n)}.`);
    const id = readString(at, n, 'id');
    const label = readString(`layoutHero: nodes[${i}] (${id})`, n, 'label');
    const lane = n.lane;
    if (!LANE_ORDER.includes(lane)) {
      throw new Error(
        `${at} (${id}): lane must be one of ${LANE_ORDER.join(' | ')} — got ${show(lane)}. A node `
        + 'with no lane has no column, and dropping it would hide it from the picture.',
      );
    }
    if (seen.has(id)) {
      throw new Error(
        `${at}: duplicate node id ${show(id)} — two boxes with one id have no defined order, so the `
        + 'layout would stop being deterministic.',
      );
    }
    seen.add(id);
    return { id, label, lane };
  });

  const { nodeWidth, nodeHeight, laneGap, rowGap, margin } = LAYOUT;

  // Only NON-EMPTY lanes take a column, in the fixed lane order.
  const columns = LANE_ORDER
    .map((lane) => read.filter((n) => n.lane === lane).sort((a, b) => cmpString(a.id, b.id)))
    .filter((column) => column.length > 0);

  const maxRows = columns.reduce((most, column) => Math.max(most, column.length), 0);
  const width = columns.length === 0
    ? margin * 2
    : margin * 2 + columns.length * nodeWidth + (columns.length - 1) * laneGap;
  const height = maxRows === 0
    ? margin * 2
    : margin * 2 + maxRows * nodeHeight + (maxRows - 1) * rowGap;

  const placed = [];
  columns.forEach((column, columnIndex) => {
    const x = margin + columnIndex * (nodeWidth + laneGap);
    // Short lanes are centred against the tallest one. Integer arithmetic, so the offset is stable
    // and a centred box can never be pushed past the reported height.
    const offset = Math.floor(((maxRows - column.length) * (nodeHeight + rowGap)) / 2);
    column.forEach((n, rowIndex) => {
      placed.push({
        id: n.id,
        label: n.label,
        lane: n.lane,
        x,
        y: margin + offset + rowIndex * (nodeHeight + rowGap),
        w: nodeWidth,
        h: nodeHeight,
      });
    });
  });

  return { width, height, placed };
}

// ─── resolveView — the renderers' single reader of the IR ────────────────────────────────────────

/** Index the map's nodes / edges by id, reading every field used downstream exactly once. */
function indexById(at, list, kind, fields) {
  const index = new Map();
  list.forEach((element, i) => {
    const where = `${at}: ${kind}[${i}]`;
    if (!isRecord(element)) throw new Error(`${where} must be an object — got ${show(element)}.`);
    const id = readString(where, element, 'id');
    const record = { id };
    for (const [field, required] of Object.entries(fields)) {
      record[field] = required
        ? readString(`${at}: ${kind} ${id}`, element, field)
        : readOptionalString(`${at}: ${kind} ${id}`, element, field);
    }
    // A duplicate id would make "which record is this?" depend on read order.
    if (index.has(id)) throw new Error(`${where}: duplicate ${kind} id ${show(id)}.`);
    index.set(id, record);
  });
  return index;
}

/**
 * Pull ids out of a view, refusing anything the map cannot resolve — or resolves TWICE.
 *
 * A repeated id is not caught by `validate.mjs` (checkViews only asks whether each id resolves), so
 * the map is legal to the validator while the two renderers disagree about it: `layoutHero` throws on
 * the duplicate box, mermaid quietly emits the declaration twice. That is the validator/renderer
 * disagreement this shared reader exists to eliminate, so it is refused here, once, for both.
 */
function pick(index, ids, { at, kind }) {
  const listed = new Set();
  return ids.map((id, i) => {
    if (!nonEmptyString(id)) {
      throw new Error(`${at}.${kind}[${i}] must be a non-empty id string — got ${show(id)}.`);
    }
    if (listed.has(id)) {
      throw new Error(
        `${at}.${kind}[${i}] is a duplicate reference to ${show(id)} — the view already draws it. `
        + 'One id listed twice is one box or arrow drawn twice, and the renderers do not even agree '
        + 'on what that means: the hero throws, mermaid emits the declaration twice.',
      );
    }
    listed.add(id);
    const record = index.get(id);
    if (record === undefined) {
      throw new Error(
        `${at}.${kind}[${i}] references ${show(id)}, which is not a ${kind.replace(/s$/, '')} in the `
        + 'map. Rendering it would put a box or an arrow on the page that names nothing.',
      );
    }
    return record;
  }).sort((a, b) => cmpString(a.id, b.id));
}

/**
 * resolveView(view, map, findings) -> {
 *   id, form, title, mermaidType,
 *   nodes: [{ id, kind, label, lane, summary }],   // sorted by id
 *   edges: [{ id, from, to, label, kind }],        // sorted by id
 *   drift: Map<nodeId, { classes, primary }>,      // classes worst-first; primary === classes[0]
 *   classesPresent: [...]                          // the ASSIGNED classes, in severity order
 * }
 *
 * Pure. Never mutates `map` or `findings`, and returns nothing that aliases either — every record is
 * built here from values read exactly once, so a renderer that annotates its own model cannot write
 * back into the snapshot (ADR C-004).
 *
 * `classesPresent` is the set of classes actually ASSIGNED to a node — the severity winners — not
 * every class present somewhere in the view. Emitting a style for a class no node wears would put
 * dead styling in the output and imply a treatment a reader can never find; the classes that lost the
 * precedence contest are surfaced as TEXT by both renderers instead.
 */
export function resolveView(rawView, rawMap, rawFindings) {
  if (!isRecord(rawView)) throw new Error(`resolveView: view must be an object — got ${show(rawView)}.`);
  if (!isRecord(rawMap)) throw new Error(`resolveView: map must be an object — got ${show(rawMap)}.`);
  // REQUIRED, with no empty default. A default would let a caller who simply did not pass the drift
  // render a DRIFTING map as clean — the hero would state "No drift was found" and emit no drift
  // styling. For an audit tool a missing accusation is worse than a wrong one, so silence fails
  // closed. An explicit `[]` is a different act: a caller ASSERTING this view has no drift.
  if (rawFindings === undefined) {
    throw new Error(
      'resolveView: findings is required — pass the drift findings, or an explicit [] to assert this '
      + 'view has none. Defaulting silence to [] draws a drifting map as clean, which is the one lie '
      + 'a map may not tell.',
    );
  }
  if (!Array.isArray(rawFindings)) {
    throw new Error(`resolveView: findings must be an array — got ${show(rawFindings)}.`);
  }

  // THE INGEST. Each of the three inputs is read exactly once, here, and only from own descriptors —
  // so nothing below can be answered differently by a second read, and nothing returned aliases what
  // the caller holds (ADR C-004). The view, the map and the findings all pass the same boundary: a
  // finding is data about the map, and a `class` that is re-computed when it is drawn is the same
  // defect as a `label` that is.
  const view = ingestStrict(rawView, { at: 'view', frame: refusal('resolveView') });
  const map = ingestStrict(rawMap, { at: 'map', frame: refusal('resolveView') });
  const findings = ingestStrict(rawFindings, { at: 'findings', frame: refusal('resolveView') });

  // `id` is bound to a local used for BOTH the error prefix and the returned id, so the view that
  // gets blamed in a message is the view that ships in the output.
  const viewId = readOptionalString('resolveView: view', view, 'id');
  const at = `resolveView: view ${show(viewId ?? '?')}`;
  if (!nonEmptyString(viewId)) {
    throw new Error(`${at}: id must be a non-empty string — got ${show(viewId)}.`);
  }

  // The map's own collections are named as the MAP's, not as this view's: they are the same lists for
  // every view, and a message that blamed `view "capabilities"` for `map.nodes` sent a reader to the
  // wrong record.
  const mapAt = 'resolveView: map';
  const nodeIndex = indexById(mapAt, readArray(mapAt, map, 'nodes', { required: true }), 'nodes',
    { kind: true, label: true, lane: true, summary: false });
  const edgeIndex = indexById(mapAt, readArray(mapAt, map, 'edges', { required: true }), 'edges',
    // `label` is REQUIRED: an unlabelled arrow says only "related somehow" (PDR §6.1), and drawing
    // one is how a map starts implying relationships it never recorded.
    { from: true, to: true, label: true, kind: false });

  // `form` is read HERE, once, and the local drives both the edges rule below and the returned form.
  // A graph view REQUIRES an edges array — `validate.mjs` (checkViews) says "possibly empty, never
  // absent" — so reading an absent one as [] would draw a graph view with every arrow silently
  // missing, and would put the renderer and the validator back to disagreeing about what a legal map
  // is. A `table` view carries no edges by that same contract, so it is not asked for any.
  const form = readString(at, view, 'form');
  const isGraph = form === 'svg-hero' || form === 'mermaid';

  const nodes = pick(nodeIndex, readArray(at, view, 'nodes', { required: true }), { at, kind: 'nodes' });
  const edges = pick(edgeIndex, readArray(at, view, 'edges', { required: isGraph }), { at, kind: 'edges' });

  const drawn = new Set(nodes.map((n) => n.id));
  for (const edge of edges) {
    for (const end of ['from', 'to']) {
      if (!drawn.has(edge[end])) {
        throw new Error(
          `${at}: edge ${show(edge.id)} runs ${end} ${show(edge[end])}, which this view does not `
          + 'draw. An arrow with an endpoint outside the view points at nothing (PDR §7.1 rule 7).',
        );
      }
    }
  }

  // Drift, indexed by node. A finding for a node the map HAS but this view does not DRAW belongs to
  // another view and to the drift table, and is skipped. A finding for a node the map does not
  // contain AT ALL is a different animal wearing the same coat, and the two must not be read alike:
  // skipping it deletes an accusation, the hero then states "No drift was found", and a stale or
  // mistyped nodeId has turned into a silent FALSE NEGATIVE — the one lie an audit tool may not
  // tell. So membership of the MAP fails closed, and membership of the VIEW filters.
  const byNode = new Map();
  findings.forEach((finding, i) => {
    if (!isRecord(finding)) {
      throw new Error(`${at}: findings[${i}] must be an object — got ${show(finding)}.`);
    }
    const cls = readString(`${at}: findings[${i}]`, finding, 'class');
    if (!SEVERITY_RANK.has(cls)) {
      throw new Error(
        `${at}: findings[${i}].class is ${show(cls)}, which no renderer has a treatment for. Known `
        + `classes: ${DRIFT_SEVERITY.join(', ')}. A class with no style would draw a defect as clean.`,
      );
    }
    const nodeId = readString(`${at}: findings[${i}]`, finding, 'nodeId');
    if (!nodeIndex.has(nodeId)) {
      throw new Error(
        `${at}: findings[${i}].nodeId is ${show(nodeId)}, which is not a node in the map. Skipping `
        + 'it would drop the finding silently and let the view report "No drift was found" — a '
        + 'missing accusation, which for an audit tool is worse than a wrong one. (A finding for a '
        + 'node the map HAS but this view does not draw is filtered normally; this one names '
        + 'nothing at all.)',
      );
    }
    if (!drawn.has(nodeId)) return;
    if (!byNode.has(nodeId)) byNode.set(nodeId, new Set());
    byNode.get(nodeId).add(cls);
  });

  const drift = new Map();
  for (const id of [...byNode.keys()].sort(cmpString)) {
    const classes = [...byNode.get(id)].sort((a, b) => SEVERITY_RANK.get(a) - SEVERITY_RANK.get(b));
    drift.set(id, { classes, primary: classes[0] });
  }

  const assigned = new Set([...drift.values()].map((d) => d.primary));
  const classesPresent = DRIFT_SEVERITY.filter((cls) => assigned.has(cls));

  return {
    id: viewId,
    form,
    // REQUIRED, exactly as the contract has it (`validate.mjs`, views[].title). The alternative is a
    // renderer inventing a heading for a view whose author never named it — a placeholder standing
    // in for missing data, which is the one thing a map may not put in front of a reader.
    title: readString(at, view, 'title'),
    mermaidType: readOptionalString(at, view, 'mermaidType'),
    nodes,
    edges,
    drift,
    classesPresent,
  };
}
