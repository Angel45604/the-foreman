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

const fav = (ledger) => (ledger?.meta?.favicon ?? '🛠️');

// Common preamble: the title heading + optional crumb in italics.
function head(meta) {
  const lines = [`# ${mdEsc(meta.title ?? '')}`];
  if (meta.crumb) lines.push('', `*${mdEsc(meta.crumb)}*`);
  return lines;
}

export function toMarkdown(ledger, type) {
  const meta = ledger?.meta ?? {};
  const title = String(meta.title ?? 'the-foreman');
  let lines;

  if (type === 'planDeck') {
    lines = head(meta);
    if (meta.subtitle) lines.push('', mdEsc(meta.subtitle));
    const slides = Array.isArray(ledger?.slides) ? ledger.slides : [];
    for (const s of slides) {
      lines.push('', `## ${mdEsc(s?.kicker ?? '')} — ${mdEsc(s?.heading ?? '')}`);
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
  } else if (type === 'brief') {
    const win = ledger?.win ?? {};
    lines = head(meta);
    lines.push('', `**Status:** ${win.verified ? 'Verified ✅' : 'Claimed (not yet verified) ⚠️'}`);
    if (win.landed) lines.push('', `**What landed:** ${mdEsc(win.landed)}`);
    if (win.evidence) lines.push('', `**Evidence:** ${mdEsc(win.evidence)}`);
    if (win.next) lines.push('', `**The ask / next:** ${mdEsc(win.next)}`);
  } else if (type === 'decisionCard') {
    const d = ledger?.decision ?? {};
    lines = head(meta);
    lines.push('', `**Decision:** ${mdEsc(d.question ?? '')}`);
    const options = Array.isArray(d.options) ? d.options : [];
    if (options.length) lines.push('');
    for (const o of options) {
      lines.push(`- **Option ${mdEsc(o?.label ?? '')}** — Pros: ${mdEsc(o?.pros ?? '—')} · Cons: ${mdEsc(o?.cons ?? '—')} · Risk: ${mdEsc(o?.risk ?? '—')}`);
    }
    lines.push('', `**Recommendation:** ${mdEsc(d.recommendation ?? '—')}${d.recommendedBy ? ` (${mdEsc(d.recommendedBy)})` : ''}`);
  } else if (type === 'liveRun') {
    const lr = ledger?.liveRun ?? {};
    lines = head(meta);
    lines.push('', `**What it does:** ${mdEsc(lr.what ?? '')}`);
    lines.push('', `**Cost / blast radius:** ${mdEsc(lr.cost ?? '—')} · ${mdEsc(lr.blastRadius ?? '—')}`);
    lines.push('', `**Cleanup:** ${mdEsc(lr.cleanup ?? '')}`);
    lines.push('', '> Live-run gate — confirm cost, blast radius, and cleanup before authorizing.');

  // ---- Phase 3: twins that build the SAME blocks[] their template composes ----
  } else if (type === 'phaseTracker') {
    const pt = ledger?.phaseTracker ?? {};
    const phases = Array.isArray(pt.phases) ? pt.phases : [];
    const progress = pt.progress;
    const blocks = [
      { type: 'phaseSteps', steps: phases },
      progress && { type: 'donut', value: progress.value, max: progress.max, label: progress.label },
    ].filter(Boolean);
    lines = head(meta);
    const md = blocksToMarkdown(blocks);
    if (md) lines.push('', md);
    if (pt.note) lines.push('', `> ${mdEsc(pt.note)}`);
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
    lines = head(meta);
    const md = blocksToMarkdown(blocks);
    if (md) lines.push('', md);
    if (f.summary) lines.push('', `> ${mdEsc(f.summary)}`);
  } else if (type === 'comparison') {
    const c = ledger?.comparison ?? {};
    const criteria = Array.isArray(c.criteria) ? c.criteria : [];
    const options = Array.isArray(c.options) ? c.options : [];
    // Mirror the template: a trailing "Notes" column only when an option has a note.
    const anyNote = options.some((o) => o?.note != null && o.note !== '');
    const blocks = [
      {
        type: 'table',
        columns: ['Option', ...criteria, ...(anyNote ? ['Notes'] : [])],
        rows: options.map((o) => [o?.label, ...(Array.isArray(o?.scores) ? o.scores : []), ...(anyNote ? [o?.note ?? ''] : [])]),
      },
    ];
    lines = head(meta);
    const md = blocksToMarkdown(blocks);
    if (md) lines.push('', md);
    if (c.recommendation != null) {
      lines.push('', `**Recommendation:** ${mdEsc(c.recommendation)}${c.recommendedBy ? ` (${mdEsc(c.recommendedBy)})` : ''}`);
    }
  } else if (type === 'dashboard') {
    const d = ledger?.dashboard ?? {};
    const stats = Array.isArray(d.stats) ? d.stats : null;
    const rows = Array.isArray(d.rows) ? d.rows : null;
    const blocks = [
      stats && { type: 'statRow', stats },
      d.chart, // straight through => an unknown chart type FAILS CLOSED (parity with the template)
      rows && { type: 'rankedRows', rows },
    ].filter(Boolean);
    lines = head(meta);
    const md = blocksToMarkdown(blocks);
    if (md) lines.push('', md);
    if (d.ask) lines.push('', `> ${mdEsc(d.ask)}`);
  } else {
    throw new Error('unknown artifact type: ' + type);
  }

  return { title, favicon: fav(ledger), markdown: lines.join('\n') + '\n' };
}
