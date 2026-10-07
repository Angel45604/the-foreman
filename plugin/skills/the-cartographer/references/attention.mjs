// the-cartographer — attention buckets (ADR C-017, PDR §6.2).
//
// DETECTION IS NOT CHANGED HERE, and this module is the reason it did not have to be.
//
// `computeDrift` audits every non-inferred node, and it does not ask what KIND of thing the node is.
// A node that is evidenced, carries no `doc` claim, and carries a COMPLETE documentation harvest is
// UNDOCUMENTED (ADR C-005, C-014, and the harvest precondition C-018 added). On a synthetic fixture
// that is exactly right. On the first REAL subject — `codex-gate`, 91 nodes — it produced 11
// UNDOCUMENTED findings of which roughly 2–4 are what a reader means by "a documentation gap"; the
// rest landed on internal shell helpers, and the findings that matter were buried among them.
//
// The tempting fix is to stop DETECTING the internals — to scope detection by KIND. That is not
// available here, and not merely unattractive: a finding suppressed by kind DISAPPEARS. PHANTOM is
// the opposite cell of the same membership grid, and STALE needs an extractor-asserted contradiction
// record — so no other class can recover a finding this one declines to raise, and nothing else in
// the pipeline would report that it was declined. That is a deliberate false-negative stage in an
// audit tool, which is the defect class this initiative has twice treated as its most serious (a
// hollow record that silently deleted a PHANTOM; a defaulted `findings = []` that drew a drifting map
// as clean).
//
// C-018's `docHarvest` gate is NOT that, and the difference is the whole point. It withholds a
// verdict on the same EVIDENTIARY grounds the finding would have rested on — an absence is evidence
// only if the search that failed to find it was complete — and, decisively, the withheld verdict does
// not vanish: `docHarvestCoverage` states every one of them, by node and by reason, in a coverage
// section that neither renderer folds or omits, and both renderers refuse to call a map clean while
// one is outstanding. Suppression by kind would have had nowhere to say so.
//
// So the whole of this module is PRESENTATION. It reorders and it collapses; it never removes.
// Every finding stays in `drift.json`, in `map.md`, in the drift lane of `map.html`, and on the
// diagrams — `render.mjs`'s rule that every drift-bearing node appears in at least one graph view is
// untouched. What a bucket changes is one thing only: whether a reader has to open a `<details>` to
// meet the finding.
//
// ─── why the rule reads BOTH kind and lane ───────────────────────────────────────────────────────
//
// Codex, grounding this decision: *"lane drives layout, kind supplies taxonomy and identity; neither
// explicitly represents visibility or documentation obligation"* — and the taxonomy has no
// public-entry-point kind, so a public function commonly lands under `component`. Kind alone is
// therefore not a sound public-contract proxy, and `component` must DEFAULT to review rather than to
// detail. Reading both is what lets the one demotion be conservative: a finding is collapsed only
// where the kind says "implementation noun" AND the map's own layout says "internal machinery".
//
// Zero dependencies: node built-ins only.

/** Most attention first. Also the order the groups are rendered in. */
export const ATTENTION_BUCKETS = Object.freeze(['likely-contract', 'ambiguous-review', 'implementation-detail']);

/** Where anything uncertain lands — an unknown kind, an unknown lane, a finding whose node is absent. */
export const DEFAULT_BUCKET = 'ambiguous-review';

/** The ONE bucket a renderer may start collapsed. Named here so no renderer has to know which it is. */
export const COLLAPSIBLE_BUCKET = 'implementation-detail';

/**
 * The classes bucketing may never collapse, whatever their node's cell says.
 *
 * All three require somebody to have WRITTEN something: PHANTOM is a `doc` claim with no evidence,
 * UNVERIFIED is a claim the extractor could not check, and STALE is an extractor-asserted
 * contradiction quoting both sides. A node those fire on has already been declared part of the
 * subject's documented surface BY THE SUBJECT. UNDOCUMENTED is the only class derived from the
 * ABSENCE of documentation — so it is the only one that fires mechanically on every internal, and the
 * only one that needs collapsing at all.
 *
 * Stated as a list of classes rather than as "not UNDOCUMENTED" so that a future class is
 * NEVER-COLLAPSED by default: `classFloor` below floors anything it does not recognise.
 */
export const NEVER_COLLAPSED_CLASSES = Object.freeze(['PHANTOM', 'STALE', 'UNVERIFIED']);

const freezeRow = (row) => Object.freeze(row);

/**
 * THE TABLE — kind × lane → bucket. The single place a bucket is decided.
 *
 * One exported table rather than a chain of conditions, because a rule spread across two renderers
 * is the two-artifacts-that-must-agree problem this whole skill exists to detect (ADR C-006), one
 * level down. `render.mjs` and `markdown.mjs` both read THIS.
 *
 * Justification, cell by cell:
 *
 *   mode / flag / env / outcome — `likely-contract` in EVERY lane.
 *     These four ARE the advertised vocabulary: a mode is an invocation a caller types, a flag is
 *     passed, an env var is set by anyone in the process environment, an outcome is read back. There
 *     is no private member of any of them. Lane is a LAYOUT axis (PDR §6.1), so letting it demote
 *     one would turn a diagram decision into a false negative — a caller-facing knob drawn in `core`
 *     for layout reasons would go quiet. Both findings the first real run genuinely wanted
 *     (`CODEX_HOME_DIR`, `CODEX_GATE_MAX_FILE_LINES`) are `env` nodes sitting in the `core` lane, so
 *     this is not a hypothetical.
 *
 *   external — `ambiguous-review` in EVERY lane, and collapsible in none.
 *     A dependency the subject needs but does not ship is a PREREQUISITE, and an undocumented one is
 *     an install-time defect: `codex-gate` exits 2 when `jq` is absent and documents it nowhere.
 *     There is no lane in which "we depend on something we never wrote down" is safely hidden.
 *
 *   component — `likely-contract` at `entry`, `implementation-detail` at `core`, `ambiguous-review`
 *     otherwise.
 *     `entry`: this is the cell that answers Codex's warning. The taxonomy has no public-entry-point
 *       kind, so a public function lands under `component`; the entry lane is precisely the map's own
 *       statement that this is where control comes IN. It PROMOTES — bucketing can only make a
 *       component more visible than its default, never silently less.
 *     `core`: both signals agree — an implementation noun in the internal-machinery lane. This is the
 *       one demotion that carries the real subject's noise (`build_manifest`,
 *       `classify_verdict_file`, `append_context_if_present`).
 *     `output` / `external`: something the subject exposes, or something outside its boundary.
 *       Neither is safely internal, and neither is demonstrably contract. Visible, for review.
 *
 *   artifact — `implementation-detail` at `core`, `ambiguous-review` elsewhere.
 *     An artifact is a file the subject writes. In `core` it is an intermediate nobody outside is
 *     meant to open (`assembled packet`). In `output` it is a DELIVERABLE — a reader may well be
 *     entitled to documentation for it — so it stays visible. In `entry` it is an input the caller
 *     supplies, which is contract-adjacent; visible for the same reason.
 *
 *   state — `implementation-detail` at `core`, `ambiguous-review` elsewhere.
 *     Same shape as artifact. Internal bookkeeping in `core` (`phase snapshot`); anything a caller
 *     can observe or is expected to supply sits in another lane and stays visible.
 *
 * The asymmetry across the table is deliberate and is the conservatism: THREE cells out of thirty-two
 * are collapsible, all of them in the `core` lane, and none of them for a kind a caller interacts
 * with directly.
 */
export const ATTENTION_TABLE = Object.freeze({
  mode: freezeRow({
    entry: 'likely-contract', core: 'likely-contract', output: 'likely-contract', external: 'likely-contract',
  }),
  flag: freezeRow({
    entry: 'likely-contract', core: 'likely-contract', output: 'likely-contract', external: 'likely-contract',
  }),
  env: freezeRow({
    entry: 'likely-contract', core: 'likely-contract', output: 'likely-contract', external: 'likely-contract',
  }),
  outcome: freezeRow({
    entry: 'likely-contract', core: 'likely-contract', output: 'likely-contract', external: 'likely-contract',
  }),
  artifact: freezeRow({
    entry: 'ambiguous-review', core: 'implementation-detail', output: 'ambiguous-review', external: 'ambiguous-review',
  }),
  component: freezeRow({
    entry: 'likely-contract', core: 'implementation-detail', output: 'ambiguous-review', external: 'ambiguous-review',
  }),
  external: freezeRow({
    entry: 'ambiguous-review', core: 'ambiguous-review', output: 'ambiguous-review', external: 'ambiguous-review',
  }),
  state: freezeRow({
    entry: 'ambiguous-review', core: 'implementation-detail', output: 'ambiguous-review', external: 'ambiguous-review',
  }),
});

/** What each bucket is CALLED and what it PROMISES — shared, so the page and the report agree. */
export const BUCKET_META = Object.freeze({
  'likely-contract': Object.freeze({
    title: 'Likely contract',
    collapsible: false,
    blurb: 'The subject\'s advertised surface — every mode, flag, environment variable and outcome,'
      + ' whatever lane it is drawn in, plus a COMPONENT the map places in the entry lane, where the'
      + ' layout says control comes in and the taxonomy has no public-entry-point kind to say so. No'
      + ' other kind reaches this bucket from the entry lane. A finding here is what a reader usually'
      + ' means by "a documentation gap".',
  }),
  'ambiguous-review': Object.freeze({
    title: 'Ambiguous — needs review',
    collapsible: false,
    blurb: 'Neither demonstrably contract nor safely internal, so it stays visible. Node kind is not a'
      + ' sound proxy for a public contract — the taxonomy has no public-entry-point kind — so anything'
      + ' uncertain lands here by design. An undocumented external prerequisite is the canonical case:'
      + ' a dependency that is missing at run time is an install-time defect, not housekeeping.',
  }),
  'implementation-detail': Object.freeze({
    title: 'Implementation detail',
    collapsible: true,
    blurb: 'An implementation noun that the map\'s own layout places in the internal core lane, raised'
      + ' only by UNDOCUMENTED — the one class derived from the ABSENCE of documentation. Collapsed by'
      + ' default and never removed: every finding here is in drift.json, in map.md, and drawn on the'
      + ' diagrams exactly as the rest.',
  }),
});

const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * bucketForKindLane(kind, lane) -> bucket. The pure table read.
 *
 * TOTAL: an unrecognised kind or lane returns `DEFAULT_BUCKET`, never the collapsible one. A value
 * the table has no rule for is by definition a value nobody has judged, and an unjudged finding is
 * exactly the thing that must stay in front of a reader.
 */
export function bucketForKindLane(kind, lane) {
  if (typeof kind !== 'string' || typeof lane !== 'string') return DEFAULT_BUCKET;
  const row = Object.hasOwn(ATTENTION_TABLE, kind) ? ATTENTION_TABLE[kind] : undefined;
  if (row === undefined || !Object.hasOwn(row, lane)) return DEFAULT_BUCKET;
  return row[lane];
}

/**
 * The class floor, applied AFTER the table. One-directional by construction: it can only RAISE a
 * collapsed cell to `DEFAULT_BUCKET`, and it never touches a cell that is already visible — a STALE
 * on a `mode` stays `likely-contract`.
 *
 * Fails safe on a class it does not recognise: anything that is not literally `UNDOCUMENTED` is
 * treated as never-collapsible, so adding a fifth drift class cannot silently make it hideable.
 */
const classFloor = (cls, bucket) => (
  cls === 'UNDOCUMENTED' || bucket !== COLLAPSIBLE_BUCKET ? bucket : DEFAULT_BUCKET
);

/**
 * bucketForFinding(finding, node) -> bucket.
 *
 * `node` is the map's node for `finding.nodeId`, or `undefined` when the map does not carry one —
 * which is itself an "unknown, therefore visible" case rather than an error, because `render.mjs`
 * already fails closed on a finding whose node appears in no graph view.
 *
 * Pure: reads two fields off `node` and one off `finding`, mutates nothing, returns a string.
 */
export function bucketForFinding(finding, node) {
  const cell = isRecord(node) ? bucketForKindLane(node.kind, node.lane) : DEFAULT_BUCKET;
  return classFloor(isRecord(finding) ? finding.class : undefined, cell);
}

/**
 * groupByAttention(findings, nodeById) -> [{ bucket, title, blurb, collapsible, findings }, …]
 *
 * ALL THREE buckets are returned, in `ATTENTION_BUCKETS` order, empty ones included — a caller
 * deciding what to do with an empty group is a rendering choice, and returning a shorter array would
 * make "the same three groups, always" something each renderer had to reconstruct.
 *
 * A PARTITION: every input finding appears in exactly one group, and the drift engine's reporting
 * order (a confirmed defect before an uncheckable claim) is preserved WITHIN each group. Nothing is
 * copied, wrapped or annotated — the finding objects handed back are the caller's own, unchanged, so
 * `drift.json` and this grouping can never disagree about what a finding says.
 *
 * Fails closed on inputs it cannot partition, rather than silently grouping nothing: a drift lane
 * that renders empty because an argument was the wrong shape is the "drawn as clean" failure that
 * `renderPage` and `toMarkdown` both already refuse.
 */
export function groupByAttention(findings, nodeById) {
  if (!Array.isArray(findings)) {
    throw new Error(
      'groupByAttention: findings must be an array — grouping decides only what a reader has to '
      + `expand, so it must be handed every finding that was computed. Got ${typeof findings}.`,
    );
  }
  if (!(nodeById instanceof Map)) {
    throw new Error(
      'groupByAttention: nodeById must be a Map of node id -> node. A bucket reads the node\'s kind '
      + `AND lane (ADR C-017); without the map every finding would fall to ${DEFAULT_BUCKET}. `
      + `Got ${typeof nodeById}.`,
    );
  }
  const grouped = new Map(ATTENTION_BUCKETS.map((bucket) => [bucket, []]));
  for (const finding of findings) {
    const node = isRecord(finding) ? nodeById.get(finding.nodeId) : undefined;
    grouped.get(bucketForFinding(finding, node)).push(finding);
  }
  return ATTENTION_BUCKETS.map((bucket) => ({
    bucket,
    title: BUCKET_META[bucket].title,
    blurb: BUCKET_META[bucket].blurb,
    collapsible: BUCKET_META[bucket].collapsible,
    findings: grouped.get(bucket),
  }));
}
