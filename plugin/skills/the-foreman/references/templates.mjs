// the-foreman artifact templates.
// Each template: (ledger) => { title, favicon, bodyHtml }.
// bodyHtml is the inner markup only; render.mjs wraps it with <title>, the
// inlined style.css, the svg <defs> SYMBOLS, and slide-engine.js.
//
// SAFETY: esc() escapes every ledger-derived string before it reaches the
// markup. The "templates HTML-escape ledger text" test pins this — never
// interpolate a ledger value without esc().

import { esc } from './esc.mjs';
import { renderBlocks } from './blocks.mjs';

// ---- shared markup components (mirror plan-deck-reference.html) ----

// A single deck slide. `on` adds the initial-visible class the slide-engine toggles.
// `chapter` (optional) stamps an escaped data-section the chapters navigator groups on.
function slide({ icon = 'i-cog', kicker = '', heading = '', inner = '', num = '', on = false, chapter = '' }) {
  const sectionAttr = chapter ? ` data-section="${esc(chapter)}"` : '';
  return `  <section class="slide${on ? ' on' : ''}"${sectionAttr}>
    <p class="kicker"><svg><use href="#${esc(icon)}"/></svg> ${esc(kicker)}</p>
    <h2>${esc(heading)}</h2>
${inner}
    ${num ? `<span class="ghostnum">${esc(num)}</span>` : ''}
  </section>`;
}

// A .card tile. variant '' | 'ok' | 'warn' picks the icon-tile color.
function card({ icon = 'i-cog', title = '', body = '', variant = '' }) {
  const cls = variant ? ` ${esc(variant)}` : '';
  return `<div class="card${cls}"><h3><svg><use href="#${esc(icon)}"/></svg> ${esc(title)}</h3><p>${esc(body)}</p></div>`;
}

function callout(html) {
  return `<div class="callout">${html}</div>`;
}

// Wrap a list of slide sections in the deck scaffold the slide-engine drives
// (#bar, #crumb, #deck/.stage, #ctl with #dots/#pg/#prev/#next).
function deck(crumb, sections) {
  return `<div id="bar"></div>
<div id="crumb">${esc(crumb)}</div>
<button id="toctgl" aria-label="Chapters" aria-haspopup="true" aria-controls="chapters" aria-expanded="false"><svg><use href="#i-list"/></svg></button>
<div id="chapters" role="menu"></div>

<div id="deck"><div class="stage">

${sections.join('\n\n')}

</div>

<div id="ctl">
  <div class="dots" id="dots"></div>
  <div class="nav"><span class="pg" id="pg"></span><button class="btn" id="prev">&#8249;</button><button class="btn" id="next">&#8250;</button></div>
</div></div>`;
}

const fav = (ledger) => (ledger?.meta?.favicon ?? '🛠️');
const crumbOf = (ledger) => (ledger?.meta?.crumb ?? 'MINDCLOUD · DEV WORKFLOW');

// ---- templates ----

// Full plan deck: title slide + overview + one slide per ledger slide.
export function planDeck(ledger) {
  const meta = ledger?.meta ?? {};
  const title = String(meta.title ?? 'the-foreman plan');
  const slides = Array.isArray(ledger?.slides) ? ledger.slides : [];

  const sections = [];

  // Title slide.
  sections.push(
    slide({
      icon: 'i-cog',
      kicker: 'Plan · the-foreman',
      heading: title,
      on: true,
      num: '01',
      inner: `    <p class="lead">${esc(meta.subtitle ?? 'A gated plan, rendered as a MindCloud deck.')}</p>`,
    }),
  );

  // One content slide per ledger slide.
  slides.forEach((s, idx) => {
    const cards = Array.isArray(s?.cards) ? s.cards : [];
    const cardsHtml = cards.length
      ? `    <div class="grid g2">\n      ${cards
          .map((c) => card({ icon: c.icon ?? 'i-route', title: c.title, body: c.body, variant: c.variant }))
          .join('\n      ')}\n    </div>`
      : '';
    const bullets = Array.isArray(s?.bullets) && s.bullets.length
      ? `    <ul>\n      ${s.bullets.map((b) => `<li>${esc(b)}</li>`).join('\n      ')}\n    </ul>`
      : '';
    const note = s?.callout ? `    ${callout(esc(s.callout))}` : '';
    // Per-slide content blocks (Phase 2a). renderBlocks() returns '' for a
    // block-less slide (filtered out below => block-less slides stay byte-identical).
    const blocksHtml = renderBlocks(s?.blocks);
    const inner = [cardsHtml, bullets, note, blocksHtml].filter(Boolean).join('\n');
    sections.push(
      slide({
        icon: s?.icon ?? 'i-flag',
        kicker: s?.kicker ?? '',
        heading: s?.heading ?? '',
        inner,
        num: String(idx + 2).padStart(2, '0'),
        chapter: s?.chapter,
      }),
    );
  });

  return { title, favicon: fav(ledger), bodyHtml: deck(crumbOf(ledger), sections) };
}

// Win / pause brief: landed + evidence, verified-vs-claimed, the ask.
export function brief(ledger) {
  const meta = ledger?.meta ?? {};
  const win = ledger?.win ?? {};
  const title = String(meta.title ?? 'Brief');
  const statusVariant = win.verified ? 'ok' : 'warn';
  const statusLabel = win.verified ? 'Verified' : 'Claimed (not yet verified)';

  const cards = [
    card({ icon: 'i-check', title: 'What landed', body: win.landed ?? '', variant: 'ok' }),
    card({ icon: 'i-shield', title: 'Evidence', body: win.evidence ?? '', variant: statusVariant }),
  ].join('\n      ');

  const inner = `    <div class="grid g2">
      ${cards}
    </div>
    <div class="pillrow">
      <span class="pill ${statusVariant}">${esc(statusLabel)}</span>
    </div>
    ${callout(`<b>The ask:</b> ${esc(win.next ?? '—')}`)}`;

  const section = slide({
    icon: win.verified ? 'i-check' : 'i-warn',
    kicker: win.verified ? 'Win' : 'Pause · waiting on you',
    heading: title,
    inner,
    num: '01',
    on: true,
  });

  return { title, favicon: fav(ledger), bodyHtml: deck(crumbOf(ledger), [section]) };
}

// Decision card: the question, options with pros/cons/risk, attributed recommendation.
export function decisionCard(ledger) {
  const meta = ledger?.meta ?? {};
  const d = ledger?.decision ?? {};
  const title = String(meta.title ?? 'Decision');
  const options = Array.isArray(d.options) ? d.options : [];

  const optionCards = options.length
    ? `    <div class="grid g2">\n      ${options
        .map((o) =>
          card({
            icon: 'i-fork',
            title: `Option ${o.label ?? ''}`,
            body: `Pros: ${o.pros ?? '—'} · Cons: ${o.cons ?? '—'} · Risk: ${o.risk ?? '—'}`,
          }),
        )
        .join('\n      ')}\n    </div>`
    : '';

  const inner = `    <p class="lead">${esc(d.question ?? '')}</p>
${optionCards}
    ${callout(`<b>Recommendation:</b> ${esc(d.recommendation ?? '—')}${d.recommendedBy ? ` <span class="num">(${esc(d.recommendedBy)})</span>` : ''}`)}`;

  const section = slide({
    icon: 'i-fork',
    kicker: 'Decision · your call',
    heading: title,
    inner,
    num: '01',
    on: true,
  });

  return { title, favicon: fav(ledger), bodyHtml: deck(crumbOf(ledger), [section]) };
}

// Live-run brief: what it does, cost / blast-radius, cleanup proof.
export function liveRun(ledger) {
  const meta = ledger?.meta ?? {};
  const lr = ledger?.liveRun ?? {};
  const title = String(meta.title ?? 'Live-run brief');

  const cards = [
    card({ icon: 'i-route', title: 'What it does', body: lr.what ?? '' }),
    card({ icon: 'i-warn', title: 'Cost / blast radius', body: `${lr.cost ?? '—'} · ${lr.blastRadius ?? '—'}`, variant: 'warn' }),
    card({ icon: 'i-check', title: 'Cleanup', body: lr.cleanup ?? '', variant: 'ok' }),
  ].join('\n      ');

  const inner = `    <div class="grid g3">
      ${cards}
    </div>
    ${callout('<b>Live-run gate:</b> a hard human gate — confirm cost, blast radius, and the cleanup proof before authorizing.')}`;

  const section = slide({
    icon: 'i-shield',
    kicker: 'Live-run · 🚦 authorize',
    heading: title,
    inner,
    num: '01',
    on: true,
  });

  return { title, favicon: fav(ledger), bodyHtml: deck(crumbOf(ledger), [section]) };
}

// ---- Phase 3: thin single-slide templates that COMPOSE the validated blocks ----
// Each builds a blocks[] array from its typed ledger section, renders it via
// renderBlocks() into the slide inner (optionally + a callout whose ledger parts
// are esc'd here), and wraps with deck(). The block builders escape every value
// INSIDE a block; only the values I interpolate directly into a callout need esc().

// phaseTracker: a progress strip — phaseSteps (+ optional progress donut), note.
export function phaseTracker(ledger) {
  const meta = ledger?.meta ?? {};
  const pt = ledger?.phaseTracker ?? {};
  const title = String(meta.title ?? 'Phase tracker');
  const phases = Array.isArray(pt.phases) ? pt.phases : [];
  const progress = pt.progress;

  const blocks = [
    { type: 'phaseSteps', steps: phases },
    progress && { type: 'donut', value: progress.value, max: progress.max, label: progress.label },
  ].filter(Boolean);

  const inner = [renderBlocks(blocks), pt.note ? `    ${callout(esc(pt.note))}` : '']
    .filter(Boolean)
    .join('\n');

  const section = slide({
    icon: 'i-layers',
    kicker: 'Phase tracker',
    heading: title,
    inner,
    num: '01',
    on: true,
  });

  return { title, favicon: fav(ledger), bodyHtml: deck(crumbOf(ledger), [section]) };
}

// findings: a findings table (+ optional sources rankedRows), summary callout.
export function findings(ledger) {
  const meta = ledger?.meta ?? {};
  const f = ledger?.findings ?? {};
  const title = String(meta.title ?? 'Findings');
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

  const inner = [renderBlocks(blocks), f.summary ? `    ${callout(esc(f.summary))}` : '']
    .filter(Boolean)
    .join('\n');

  const section = slide({
    icon: 'i-list',
    kicker: 'Findings',
    heading: title,
    inner,
    num: '01',
    on: true,
  });

  return { title, favicon: fav(ledger), bodyHtml: deck(crumbOf(ledger), [section]) };
}

// comparison: an options × criteria table, recommendation callout (+ optional by).
export function comparison(ledger) {
  const meta = ledger?.meta ?? {};
  const c = ledger?.comparison ?? {};
  const title = String(meta.title ?? 'Comparison');
  const criteria = Array.isArray(c.criteria) ? c.criteria : [];
  const options = Array.isArray(c.options) ? c.options : [];

  // A trailing "Notes" column appears ONLY when at least one option carries a
  // note; otherwise the table is unchanged (no Notes column). The table block
  // escapes every cell, so the note text is neutralized there.
  const anyNote = options.some((o) => o?.note != null && o.note !== '');

  const blocks = [
    {
      type: 'table',
      columns: ['Option', ...criteria, ...(anyNote ? ['Notes'] : [])],
      // ragged scores are normalized by the table block (normalizeRow) — just map.
      rows: options.map((o) => [o?.label, ...(Array.isArray(o?.scores) ? o.scores : []), ...(anyNote ? [o?.note ?? ''] : [])]),
    },
  ];

  const note = c.recommendation != null
    ? `    ${callout(`<b>Recommendation:</b> ${esc(c.recommendation)}${c.recommendedBy ? ` <span class="num">(${esc(c.recommendedBy)})</span>` : ''}`)}`
    : '';
  const inner = [renderBlocks(blocks), note].filter(Boolean).join('\n');

  const section = slide({
    icon: 'i-fork',
    kicker: 'Comparison',
    heading: title,
    inner,
    num: '01',
    on: true,
  });

  return { title, favicon: fav(ledger), bodyHtml: deck(crumbOf(ledger), [section]) };
}

// dashboard: stats (statRow) + a chart passed STRAIGHT THROUGH (unknown chart type
// fails closed, same contract) + optional rows (rankedRows), an ask callout.
export function dashboard(ledger) {
  const meta = ledger?.meta ?? {};
  const d = ledger?.dashboard ?? {};
  const title = String(meta.title ?? 'Dashboard');
  const stats = Array.isArray(d.stats) ? d.stats : null;
  const rows = Array.isArray(d.rows) ? d.rows : null;

  const blocks = [
    stats && { type: 'statRow', stats },
    d.chart, // passed straight to renderBlocks => an unknown chart type FAILS CLOSED
    rows && { type: 'rankedRows', rows },
  ].filter(Boolean);

  const inner = [renderBlocks(blocks), d.ask ? `    ${callout(esc(d.ask))}` : '']
    .filter(Boolean)
    .join('\n');

  const section = slide({
    icon: 'i-deck',
    kicker: 'Dashboard',
    heading: title,
    inner,
    num: '01',
    on: true,
  });

  return { title, favicon: fav(ledger), bodyHtml: deck(crumbOf(ledger), [section]) };
}
