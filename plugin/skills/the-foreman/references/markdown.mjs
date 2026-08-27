// the-foreman Markdown twin.
// toMarkdown(ledger, type) => { title, favicon, markdown }.
//
// Mirrors the section logic of templates.mjs but emits clean, paste-friendly
// Markdown (no raw HTML tags, no <style>/<title> — EXCEPT inside a code/diff
// block's fenced body, which preserves raw content verbatim and is kept inert by
// a dynamic fence strictly longer than any backtick run in it; see blocks.mjs +
// ledger.schema.md). The render.mjs caller secret-scans the result before writing
// — so the twin is safe to share by construction.
//
// SAFETY: mdEsc() neutralizes HTML injection (& < >) in EVERY ledger-derived
// value before it reaches the markdown — the twin must be no weaker than the
// HTML artifact (templates.mjs esc()), and secret-scan does NOT catch HTML
// injection. The injection tests in markdown.test.mjs pin this; never
// interpolate a ledger value without mdEsc(). Static literals I author stay raw.
// Be null-safe: missing arrays => [], missing fields => skipped.

// mdEsc neutralizes a ledger value so it renders as INERT PLAIN TEXT in
// Markdown — extracted to ./esc.mjs (shared with the block builders). The
// injection tests in markdown.test.mjs pin it; never interpolate a ledger value
// without mdEsc(). Static literals I author stay raw.
import { mdEsc } from './esc.mjs';
import { blocksToMarkdown } from './blocks.mjs';
import { firstClause, hasText } from './scaffold.mjs';

const fav = (ledger) => (ledger?.meta?.favicon ?? '🛠️');

// The effective-ask gate, MIRRORED VERBATIM from templates.mjs (which keeps it
// module-local — two copies by design; keep the two in lockstep): only an
// object with a NON-EMPTY string headline counts as meta.ask; anything else
// ({}, {note:'x'}, {headline:''}, a plain string/number/array) falls through to
// the type's derived ask — so a conflicting meta.ask wins IDENTICALLY in HTML
// and twin (design §6, Task 11).
const askShape = (a) => (a && typeof a === 'object' && !Array.isArray(a)
  && typeof a.headline === 'string' && a.headline.trim() !== '' ? a : null);

// The decision-shape gate, MIRRORED VERBATIM from templates.mjs (its
// module-local copy — two copies by design; keep the two in lockstep): a
// decision derives an ask ONLY as a non-array object with a NON-EMPTY string
// question. Anything else ({}, an array, {question:''}, options with no
// question) contributes NO derived ask; its options (when any) still serialize
// as evidence so nothing is lost — parity with the HTML's content-labeled
// chapter. lint.mjs's malformed-decision rule rides the same predicate.
const decisionShape = (d) => (d && typeof d === 'object' && !Array.isArray(d)
  && typeof d.question === 'string' && d.question.trim() !== '' ? d : null);

// A malformed decision still carries renderable evidence when it has options.
const decisionHasOptions = (d) => Array.isArray(d?.options) && d.options.length > 0;

// The shared ask serializer: recommendation and attribution reach the twin
// EXCLUSIVELY through here (never via decisionToMarkdown or a per-type line).
// Each field renders independently when present — no field gates another —
// mirroring the HTML ask strip (scaffold.mjs gateBoard). Recommendation +
// attribution presence rides the SHARED hasText predicate (scaffold.mjs), the
// same one the hero ask strip and templates.mjs recStrip apply — one
// predicate, so the twin and the HTML agree on emptiness byte-for-byte.
function askToMarkdown(ask) {
  if (!ask) return '';
  const lines = [];
  if (ask.headline) lines.push(`> **The ask:** ${mdEsc(ask.headline)}`);
  if (ask.note) lines.push(`> ${mdEsc(ask.note)}`);
  if (hasText(ask.recommendation)) lines.push(`> **Recommendation:** ${mdEsc(ask.recommendation)}`);
  if (hasText(ask.recommendedBy)) lines.push(`> (${mdEsc(ask.recommendedBy)})`);
  return lines.join('\n');
}

// The decision as EVIDENCE only: per-option pros/cons/risk lines, plus the
// question line ONLY when the decision IS the effective ask source
// (withQuestion). Never the recommendation/attribution — those are
// askToMarkdown's alone — and never the question beside an overriding meta.ask:
// the HTML omits the overridden question, so the twin must too, or the reader
// sees the authoritative ask AND the conflicting stale question side by side.
// Shared by planDeck's `## Your call` chapter and decisionCard. Returns [] for
// an overridden options-less decision — the caller then serializes nothing.
function decisionToMarkdown(d, withQuestion) {
  const lines = withQuestion ? [`**Decision:** ${mdEsc(d?.question ?? '')}`] : [];
  const options = Array.isArray(d?.options) ? d.options : [];
  if (options.length && lines.length) lines.push('');
  for (const o of options) {
    lines.push(`- **Option ${mdEsc(o?.label ?? '')}** — Pros: ${mdEsc(o?.pros ?? '—')} · Cons: ${mdEsc(o?.cons ?? '—')} · Risk: ${mdEsc(o?.risk ?? '—')}`);
  }
  return lines;
}

// Common preamble — the twin's executive gate summary, mirroring the HTML hero
// (Task 11): title heading, optional crumb in italics, then the verdict line
// (meta.verdict ?? meta.subtitle, bold), the plain-English lede, the keyStats
// tiles as a list, and the effective ask via the shared serializer.
function head(meta, effectiveAsk = null) {
  const lines = [`# ${mdEsc(meta.title ?? '')}`];
  if (meta.crumb) lines.push('', `*${mdEsc(meta.crumb)}*`);
  const verdict = meta.verdict ?? meta.subtitle;
  if (verdict) lines.push('', `**${mdEsc(verdict)}**`);
  if (meta.lede) lines.push('', mdEsc(meta.lede));
  const keyStats = Array.isArray(meta.keyStats) ? meta.keyStats : [];
  if (keyStats.length) lines.push('', ...keyStats.map((s) => `- **${mdEsc(s?.value ?? '')}** — ${mdEsc(s?.label ?? '')}`));
  const askMd = askToMarkdown(effectiveAsk);
  if (askMd) lines.push('', askMd);
  return lines;
}

export function toMarkdown(ledger, type) {
  const meta = ledger?.meta ?? {};
  const title = String(meta.title ?? 'the-foreman');
  let lines;

  if (type === 'planDeck') {
    // The SAME effective ask templates.mjs askOf computes: meta.ask (askShape-
    // gated) wins; else a decisionShape-passing decision derives one.
    const d = ledger?.decision;
    const shapedD = decisionShape(d);
    const metaAsk = askShape(meta.ask);
    const effectiveAsk = metaAsk
      ?? (shapedD ? askShape({ headline: shapedD.question, recommendation: shapedD.recommendation, recommendedBy: shapedD.recommendedBy }) : null);
    lines = head(meta, effectiveAsk);
    const slides = Array.isArray(ledger?.slides) ? ledger.slides : [];
    for (const s of slides) {
      lines.push('', `## ${mdEsc(s?.kicker ?? '')} — ${mdEsc(s?.statement ?? s?.heading ?? '')}`);
      if (s?.lead) lines.push('', mdEsc(s.lead));
      // The EXPLICIT figure serializes first, before the slide's other content
      // (mirroring the dominant visual). A FALLBACK figure (promoted from
      // s.blocks by the template) is NOT serialized here — blocksToMarkdown
      // over s.blocks below already covers it exactly once (never duplicated),
      // mirroring templates.mjs figureSplit.
      if (s?.figure) {
        const figMd = blocksToMarkdown([s.figure]);
        if (figMd) lines.push('', figMd);
      }
      const cards = Array.isArray(s?.cards) ? s.cards : [];
      const bullets = Array.isArray(s?.bullets) ? s.bullets : [];
      if (cards.length || bullets.length) lines.push('');
      for (const c of cards) lines.push(`- **${mdEsc(c?.title ?? '')}:** ${mdEsc(c?.body ?? '')}`);
      for (const b of bullets) lines.push(`- ${mdEsc(b)}`);
      if (s?.callout) lines.push('', `> ${mdEsc(s.callout)}`);
      // Per-slide content blocks (Phase 2a). Empty => skipped, so block-less
      // slides stay byte-identical to the prior twin output.
      const blocksMd = blocksToMarkdown(s?.blocks);
      if (blocksMd) lines.push('', blocksMd);
    }
    // The decision chapter — evidence only; the recommendation already rode in
    // via askToMarkdown above, and the question line rides ONLY when the
    // decision is the effective ask source (a meta.ask override omits it —
    // HTML parity). A malformed decision serializes ONLY when it has options
    // to preserve, and with no effective ask the chapter keeps a content label
    // (mirrors templates.mjs planDeck's content-labeled Decision chapter).
    const decisionEvidence = (shapedD || decisionHasOptions(d))
      ? decisionToMarkdown(d, Boolean(shapedD) && !metaAsk) : [];
    if (decisionEvidence.length) {
      lines.push('', effectiveAsk ? '## Your call' : '## Decision', '', ...decisionEvidence);
    }
    // Evidence-base chips (value bold, then label — the HTML .src chip order).
    const sources = Array.isArray(ledger?.findings?.sources) ? ledger.findings.sources : [];
    if (sources.length) {
      lines.push('', '**Evidence base:**', '');
      for (const s of sources) lines.push(`- **${mdEsc(s?.value ?? '')}** — ${mdEsc(s?.label ?? '')}`);
    }
  } else if (type === 'brief') {
    const win = ledger?.win ?? {};
    // EVERY derived ask rides the same askShape gate as meta.ask (parity with
    // templates.mjs singleBoard): the candidate object is built from the raw
    // source, then gated — absent/blank/non-string means NO ask lines.
    const effectiveAsk = askShape(meta.ask) ?? askShape({ headline: win.next });
    lines = head(meta, effectiveAsk);
    lines.push('', `**Status:** ${win.verified ? 'Verified ✅' : 'Claimed (not yet verified) ⚠️'}`);
    if (win.landed) lines.push('', `**What landed:** ${mdEsc(win.landed)}`);
    if (win.evidence) lines.push('', `**Evidence:** ${mdEsc(win.evidence)}`);
  } else if (type === 'decisionCard') {
    const d = ledger?.decision ?? null;
    const shapedD = decisionShape(d);
    const metaAsk = askShape(meta.ask);
    const effectiveAsk = metaAsk
      ?? (shapedD ? askShape({ headline: shapedD.question, recommendation: shapedD.recommendation, recommendedBy: shapedD.recommendedBy }) : null);
    lines = head(meta, effectiveAsk);
    // Evidence serializes for a well-shaped decision, or for a malformed one
    // that still carries options (nothing lost, no orphan empty block). The
    // question line rides only when the decision IS the effective ask source —
    // a meta.ask override serializes the option evidence alone (HTML parity).
    const decisionEvidence = (shapedD || decisionHasOptions(d))
      ? decisionToMarkdown(d, Boolean(shapedD) && !metaAsk) : [];
    if (decisionEvidence.length) lines.push('', ...decisionEvidence);
  } else if (type === 'liveRun') {
    const lr = ledger?.liveRun ?? {};
    // The synthesized cost/blast-radius keyStats, MIRRORED VERBATIM from
    // templates.mjs liveRun (keep the two in lockstep), riding the same
    // both-present rule the HTML follows: meta.keyStats — whenever it is an
    // array, the singleBoard hero pick — takes the head's hero list and the
    // synthesized pair serializes WITHIN the section beneath the gate facts
    // (the HTML's visible stat wells); with no meta.keyStats the synthesized
    // pair IS the head's hero list. Either way nothing is dropped.
    const keyStats = [
      { value: firstClause(lr.cost), label: 'cost' },
      { value: firstClause(lr.blastRadius), label: 'blast radius' },
    ].filter((s) => s.value);
    const heroTaken = Array.isArray(meta.keyStats);
    const effectiveAsk = askShape(meta.ask)
      ?? askShape({ headline: 'Authorize this live run?', note: firstClause(lr.what) }); // engine literal — always passes; gated for uniformity
    lines = head(heroTaken ? meta : { ...meta, keyStats }, effectiveAsk);
    lines.push('', `**What it does:** ${mdEsc(lr.what ?? '')}`);
    lines.push('', `**Cost / blast radius:** ${mdEsc(lr.cost ?? '—')} · ${mdEsc(lr.blastRadius ?? '—')}`);
    lines.push('', `**Cleanup:** ${mdEsc(lr.cleanup ?? '')}`);
    if (heroTaken && keyStats.length) {
      const wellsMd = blocksToMarkdown([{ type: 'statRow', stats: keyStats }]);
      if (wellsMd) lines.push('', wellsMd);
    }

  // ---- Phase 3: twins that build the SAME blocks[] their template composes ----
  } else if (type === 'phaseTracker') {
    const pt = ledger?.phaseTracker ?? {};
    const phases = Array.isArray(pt.phases) ? pt.phases : [];
    const progress = pt.progress;
    const blocks = [
      { type: 'phaseSteps', steps: phases },
      progress && { type: 'donut', value: progress.value, max: progress.max, label: progress.label },
    ].filter(Boolean);
    const effectiveAsk = askShape(meta.ask) ?? askShape({ headline: pt.note }); // derived candidate gated like meta.ask
    lines = head(meta, effectiveAsk);
    const md = blocksToMarkdown(blocks);
    if (md) lines.push('', md);
  } else if (type === 'findings') {
    const f = ledger?.findings ?? {};
    const items = Array.isArray(f.items) ? f.items : [];
    const sources = Array.isArray(f.sources) ? f.sources : null;
    const blocks = [
      {
        type: 'table',
        columns: ['Finding', 'Confidence', 'Evidence', 'Verdict'],
        rows: items.map((i) => [i?.title, i?.confidence, i?.evidence, i?.verdict]),
      },
      sources && { type: 'rankedRows', rows: sources },
    ].filter(Boolean);
    const effectiveAsk = askShape(meta.ask) ?? askShape({ headline: f.summary }); // derived candidate gated like meta.ask
    lines = head(meta, effectiveAsk);
    const md = blocksToMarkdown(blocks);
    if (md) lines.push('', md);
  } else if (type === 'comparison') {
    const c = ledger?.comparison ?? {};
    const criteria = Array.isArray(c.criteria) ? c.criteria : [];
    const options = Array.isArray(c.options) ? c.options : [];
    // Mirror the template: a trailing "Notes" column only when an option has a note.
    const anyNote = options.some((o) => o?.note != null && o.note !== '');
    // MIRRORED from templates.mjs comparison (keep in lockstep): scores
    // normalize to EXACTLY criteria.length BEFORE the note is appended, so a
    // ragged row can never shift the note out of the Notes column or drop it.
    const scoreCells = (o) => {
      const scores = Array.isArray(o?.scores) ? o.scores : [];
      return Array.from({ length: criteria.length }, (_, i) => scores[i] ?? '');
    };
    const blocks = [
      {
        type: 'table',
        columns: ['Option', ...criteria, ...(anyNote ? ['Notes'] : [])],
        rows: options.map((o) => [o?.label, ...scoreCells(o), ...(anyNote ? [o?.note ?? ''] : [])]),
      },
    ];
    // The derived-ask gate, MIRRORED from templates.mjs comparison (keep in
    // lockstep): only a recommendation passing the SHARED hasText predicate
    // (non-empty trimmed STRING) derives an ask — a malformed value ('',
    // '   ', 42, {}) derives none, so the twin never serializes the spurious
    // 'Pick an option' block the HTML no longer renders.
    const effectiveAsk = askShape(meta.ask)
      ?? (hasText(c.recommendation)
        ? askShape({ headline: 'Pick an option', recommendation: c.recommendation, recommendedBy: c.recommendedBy })
        : null);
    lines = head(meta, effectiveAsk);
    const md = blocksToMarkdown(blocks);
    if (md) lines.push('', md);
  } else if (type === 'dashboard') {
    const d = ledger?.dashboard ?? {};
    const stats = Array.isArray(d.stats) ? d.stats : null;
    const rows = Array.isArray(d.rows) ? d.rows : null;
    const blocks = [
      stats && { type: 'statRow', stats },
      d.chart, // straight through => an unknown chart type FAILS CLOSED (parity with the template)
      rows && { type: 'rankedRows', rows },
    ].filter(Boolean);
    const effectiveAsk = askShape(meta.ask) ?? askShape({ headline: d.ask }); // derived candidate gated like meta.ask
    lines = head(meta, effectiveAsk);
    const md = blocksToMarkdown(blocks);
    if (md) lines.push('', md);
  } else {
    throw new Error('unknown artifact type: ' + type);
  }

  return { title, favicon: fav(ledger), markdown: lines.join('\n') + '\n' };
}
