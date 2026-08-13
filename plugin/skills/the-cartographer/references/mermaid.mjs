// the-cartographer — the mermaid view emitter (PDR §6, §6.2).
//
// Emits BARE mermaid source: no fences, no HTML wrapper. The caller decides whether it lands in a
// ```mermaid block (Markdown) or a <pre class="mermaid"> (the Artifact host).
//
// A `flowchart` view and a `stateDiagram-v2` view are two different LANGUAGES, not one language with
// a different header. Emitting flowchart node brackets or the `-->|label|` form inside a state
// diagram produces a diagram that silently fails to render in the host — the exact host-dependent
// failure the SVG hero exists to avoid for the Overview, so the detail views must at least be
// syntactically right.
//
// Zero dependencies: node built-ins only.

import { MERMAID_TYPES } from './validate.mjs';
import { DRIFT_SEVERITY, resolveView } from './layout.mjs';

/**
 * A mermaid-safe node id, INJECTIVELY derived.
 *
 * The obvious scheme — every non-alphanumeric run becomes one `_` — is NOT injective: `mode.a-b` and
 * `mode.a_b` both become `mode_a_b`, so two distinct nodes silently merge into one box and the map
 * quietly loses a node. This escapes instead of replacing: `_` doubles, and every other
 * non-alphanumeric becomes `_<hex>_`. Decoding is unambiguous left to right (a `_` is followed
 * either by another `_`, or by hex digits and a closing `_`, and hex digits are never `_`), which is
 * what makes the mapping one-to-one.
 *
 * The `n` prefix guarantees the id starts with a letter, as mermaid requires.
 */
export function mermaidNodeId(id) {
  let out = 'n';
  for (const ch of String(id)) {
    if (/[A-Za-z0-9]/.test(ch)) out += ch;
    else if (ch === '_') out += '__';
    else out += `_${ch.codePointAt(0).toString(16)}_`;
  }
  return out;
}

/**
 * Characters that TERMINATE mermaid grammar. Left in a label, each one closes the construct it sits
 * inside and turns the rest of the label into syntax — a parse error at best, and at worst a diagram
 * that renders something the map never said.
 *
 * Substituted rather than deleted: a label reduced to nothing tells the reader less than a label with
 * a look-alike bracket. The exact text is always available in `map.md` and in the SVG hero's
 * `<title>`, so the lossy step here costs nothing that is not recoverable elsewhere.
 *
 * THE RULE THIS TABLE OBEYS: it is CLOSED — no substitution may emit a character that is itself a
 * breaker. The bracket family used to map onto `(` and `)`, which reads as harmless only if you
 * forget that a parenthesis is a mermaid SHAPE delimiter (`id(round)`), and that the flowchart edge
 * label `-->|…|` is an UNQUOTED position where shape delimiters are live tokens. The table therefore
 * manufactured the failure it existed to prevent: `a["b"] | {c} <d>` came out as `a('b') / (c) (d)`,
 * which the pipe-label grammar can refuse outright. Every bracketing character now maps to its
 * FULLWIDTH counterpart instead: outside ASCII, a token in no mermaid position, and still visibly the
 * bracket the source had. `|` and `"` keep their ASCII stand-ins because `/` and `'` are tokens
 * nowhere in the grammar either — inertness is the property, not non-ASCII-ness.
 */
const GRAMMAR_BREAKERS = new Map(Object.entries({
  '[': '［', ']': '］', '{': '｛', '}': '｝', '<': '＜', '>': '＞', '(': '（', ')': '）',
  '|': '/', '"': "'",
}));

/**
 * One label, made safe for a QUOTED mermaid construct — a flowchart node (`id["…"]`) or a state node
 * (`state "…" as id`). Whitespace runs — newlines included — collapse to a single space, because
 * mermaid's grammar is line-based: a newline inside a label ends the statement and the remainder of
 * the label becomes a bogus statement of its own.
 *
 * This is the BASE that the two unquoted positions layer onto; on its own it assumes a delimiter is
 * doing the work of stopping the lexer, so a caller emitting an unquoted label must use
 * `safeEdgeLabel` or `safeTransitionLabel` instead.
 */
function safeLabel(text) {
  let out = '';
  for (const ch of String(text)) out += GRAMMAR_BREAKERS.get(ch) ?? ch;
  return out.replace(/\s+/g, ' ').trim();
}

/**
 * A flowchart EDGE label — the text between the pipes of `A -->|…| B`.
 *
 * Unquoted, so it is not the `["…"]` position and no delimiter stops the lexer for it. Beyond the
 * bracketing characters `safeLabel` already neutralises, the two STATEMENT terminators reach it, for
 * the same reasons they reach a state transition description:
 *
 *   • `;`  — separates statements, so `-->|first; second| B` leaves `second` as a bogus statement.
 *            Removing it also makes the `#NN;` entity code unformable, since an entity needs its
 *            terminating semicolon.
 *   • `%%` — opens a comment that runs to end of line, swallowing the rest of the label. Runs of two
 *            or more collapse to ONE `%`, so `%%%%` cannot reassemble into a marker.
 *
 * A `:` is NOT touched here: inside a pipe label a colon is ordinary text, and neutralising it would
 * cost fidelity to buy nothing. That is the one place this position differs from a transition.
 */
const safeEdgeLabel = (text) => safeLabel(text)
  .replace(/;/g, ',')
  .replace(/%{2,}/g, '%');

/**
 * A state-diagram TRANSITION label is the LOOSEST position in either language. A flowchart node label
 * sits inside `["…"]` and a state node label is likewise quoted (`state "…" as id`), so the lexer
 * consumes each to its closing delimiter. A flowchart edge label at least has its two pipes. A
 * transition description, by contrast, is everything from the transition's own `:` to the end of the
 * statement — so it is the edge-label position PLUS one more terminator:
 *
 *   • `:`  — a second colon is ambiguous to read and, in some mermaid versions, to parse. This is the
 *            one breaker a pipe label does not share, which is why the two sanitisers differ by
 *            exactly this line rather than by two hand-maintained lists.
 *
 * `;`, `%%` and the `#N;` entity code are neutralised by `safeEdgeLabel`, and `\n` plus the bracket
 * family by `safeLabel` beneath it. Substituted, never deleted, exactly as `GRAMMAR_BREAKERS` is: a
 * look-alike separator says more to a reader than a hole, and the exact text stays available in
 * `map.md` and the SVG hero's `<title>`.
 */
const safeTransitionLabel = (text) => safeEdgeLabel(text).replace(/:/g, ' -');

/** Per-class mermaid styling. Distinct per class, UNVERIFIED included (PDR §8.1 guardrail 3). */
const CLASS_STYLE = {
  STALE: 'stroke:#b45309,stroke-width:3px',
  PHANTOM: 'stroke-dasharray:7 5,opacity:0.70',
  UNDOCUMENTED: 'stroke-width:3px,stroke-dasharray:0',
  UNVERIFIED: 'stroke-dasharray:1 5,opacity:0.60',
};

const CLASS_NAME = {
  STALE: 'cartoStale',
  PHANTOM: 'cartoPhantom',
  UNDOCUMENTED: 'cartoUndocumented',
  UNVERIFIED: 'cartoUnverified',
};

/** The label a drifting node wears: its own text, plus EVERY class it carries. */
function labelFor(node, drift) {
  const base = safeLabel(node.label);
  if (!drift) return base;
  // The style can only show the worst class, so the text carries all of them — a node that is both
  // UNDOCUMENTED and STALE must not read as merely STALE.
  return `${base} (${drift.classes.join(', ')})`;
}

/**
 * renderMermaid(view, map, findings) -> string — bare mermaid source.
 *
 * Pure. Reads the IR through `resolveView`, so it neither mutates nor aliases `map` or `findings`,
 * and it fails closed on a view it is not the renderer for rather than emitting a diagram in the
 * wrong language.
 *
 * `findings` is REQUIRED — `resolveView` refuses an omitted one. A default would emit a drifting view
 * with no classDef at all for any caller who simply forgot it.
 */
export function renderMermaid(view, map, findings) {
  const resolved = resolveView(view, map, findings);

  if (resolved.form !== 'mermaid') {
    throw new Error(
      `renderMermaid: view ${JSON.stringify(resolved.id)} has form ${JSON.stringify(resolved.form)}; `
      + 'this renders form "mermaid" only. Render the overview with renderHero, and a table view '
      + 'with the table renderer.',
    );
  }
  if (!MERMAID_TYPES.includes(resolved.mermaidType)) {
    throw new Error(
      `renderMermaid: view ${JSON.stringify(resolved.id)} has mermaidType `
      + `${JSON.stringify(resolved.mermaidType)}; a mermaid view must declare one of `
      + `${MERMAID_TYPES.join(' | ')}. Guessing would emit one diagram language as another.`,
    );
  }

  const isState = resolved.mermaidType === 'stateDiagram-v2';
  const out = [isState ? 'stateDiagram-v2' : 'flowchart LR'];

  // Nodes and edges arrive from `resolveView` already sorted by id, so the emitted order is a
  // function of the map's content and never of the extractor's emission order.
  for (const node of resolved.nodes) {
    const id = mermaidNodeId(node.id);
    const label = labelFor(node, resolved.drift.get(node.id));
    out.push(isState ? `    state "${label}" as ${id}` : `    ${id}["${label}"]`);
  }

  for (const edge of resolved.edges) {
    const from = mermaidNodeId(edge.from);
    const to = mermaidNodeId(edge.to);
    out.push(isState
      ? `    ${from} --> ${to}: ${safeTransitionLabel(edge.label)}`
      : `    ${from} -->|${safeEdgeLabel(edge.label)}| ${to}`);
  }

  // A classDef only for a class some node actually WEARS. Defining a style nothing is assigned would
  // put dead styling in the output and imply a treatment the reader can never find on the diagram.
  for (const cls of resolved.classesPresent) {
    out.push(`    classDef ${CLASS_NAME[cls]} ${CLASS_STYLE[cls]}`);
  }
  for (const node of resolved.nodes) {
    const drift = resolved.drift.get(node.id);
    if (drift) out.push(`    class ${mermaidNodeId(node.id)} ${CLASS_NAME[drift.primary]}`);
  }

  return out.join('\n');
}

/** Exported for the same reason `DRIFT_SEVERITY` is: a renderer must not invent its own class set. */
export const MERMAID_CLASS_NAMES = Object.freeze(
  DRIFT_SEVERITY.reduce((acc, cls) => Object.assign(acc, { [cls]: CLASS_NAME[cls] }), {}),
);
