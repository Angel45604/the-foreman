// the-foreman artifact templates.
// Each template: (ledger) => { title, favicon, bodyHtml }.
// bodyHtml is the inner markup only; render.mjs wraps it with <title>, the
// inlined style.css, and the page script.
//
// planDeck renders the Gate Board (design.md §3/§6): one scrolling verdict-first
// page composed via scaffold.mjs. The remaining seven types still compose the
// legacy deck() until Task 7 moves them onto the same scaffold.
//
// SAFETY: esc() escapes every ledger-derived string before it reaches the
// markup. The "templates HTML-escape ledger text" test pins this — never
// interpolate a ledger value without esc().

import { esc } from './esc.mjs';
import { renderBlocks } from './blocks.mjs';
import { gateBoard, unit, allocateIds, firstClause } from './scaffold.mjs';

// ---- Gate Board shared helpers (Tasks 6–7: every template composes these) ----

const fav = (ledger) => (ledger?.meta?.favicon ?? '🛠️');
const crumbOf = (ledger) => (ledger?.meta?.crumb ?? 'THE-FOREMAN · DEV WORKFLOW');

// Hero fields (design §4 fallbacks): verdict falls back to meta.subtitle, then
// to the type's own fallback line; lede is optional.
function heroOf(meta, fallbackVerdict = '') {
  return {
    verdict: meta?.verdict ?? meta?.subtitle ?? fallbackVerdict,
    lede: meta?.lede ?? '',
  };
}

// The effective ask (AUTHORITATIVE rule, design §6): meta.ask is the author's
// intent and WINS over any derived ask. With no meta.ask, a decision derives
// one from its question + recommendation. One computation drives the ask
// strip, the target chapter's visible header, AND the single .rec strip.
function askOf(ledger) {
  const meta = ledger?.meta ?? {};
  if (meta.ask) return meta.ask;
  const d = ledger?.decision;
  if (d) return { headline: d.question ?? '', recommendation: d.recommendation, recommendedBy: d.recommendedBy };
  return null;
}

// The figure-capable set (design §4): a unit's dominant visual is the explicit
// `figure` when given, else the FIRST block whose type is in this set (that
// block is promoted out of the drawer); everything else stays drawer evidence.
const FIGURE_TYPES = ['statRow', 'bar', 'donut', 'phaseSteps', 'topo', 'deltaRow', 'duel', 'verdictFan', 'dotMatrix', 'ladder'];

function figureSplit(blocks, explicitFigure) {
  const list = Array.isArray(blocks) ? blocks : [];
  if (explicitFigure) return { figureHtml: renderBlocks([explicitFigure]), drawerBlocks: list };
  const idx = list.findIndex((b) => FIGURE_TYPES.includes(b?.type));
  if (idx === -1) return { figureHtml: '', drawerBlocks: list };
  return { figureHtml: renderBlocks([list[idx]]), drawerBlocks: list.filter((_, i) => i !== idx) };
}

// Option-card risk chip allowlist — `risk` only ever PICKS a static modifier
// class (unknown/absent-from-list values, e.g. legacy 'medium', coerce to
// 'med'); the risk TEXT itself is esc'd. Same fail-closed posture as blocks.mjs.
const RISK_LEVELS = new Set(['low', 'med', 'high']);
const riskLevel = (r) => (RISK_LEVELS.has(r) ? r : 'med');

// Decision option cards (reference lines ~1161–1229): letter well, recommended
// marker (keyed off decision.recommendation matching the option label — data
// about the options, never a second ask), allowlisted risk chip, one-line gist
// via firstClause, and the verbatim pros/cons collapsed in <details class="optpc">.
function optionCards(d) {
  const options = Array.isArray(d?.options) ? d.options : [];
  if (!options.length) return '';
  const cards = options.map((o) => {
    const label = String(o?.label ?? '');
    const [ltr, ...restParts] = label.split(' — ');
    const optTitle = restParts.length ? `<b class="opt__t">${esc(restParts.join(' — '))}</b>` : '';
    const recommended = d?.recommendation != null && label === d.recommendation;
    const recMark = recommended ? '<span class="opt__rec"><i></i>Recommended</span>' : '';
    const risk = o?.risk != null && o.risk !== ''
      ? `<span class="opt__risk opt__risk--${riskLevel(o.risk)}"><i></i>${esc(o.risk)} risk</span>` : '';
    const gist = o?.pros ? `<p class="opt__gist">${esc(firstClause(o.pros))}</p>` : '';
    const pc = (o?.pros || o?.cons)
      ? '<details class="optpc"><summary>Pros &amp; cons</summary><div class="optpc__b">'
        + `<h4>Pros</h4><p>${esc(o?.pros ?? '—')}</p><h4 class="con">Cons</h4><p>${esc(o?.cons ?? '—')}</p></div></details>`
      : '';
    return `<section class="opt${recommended ? ' opt--rec' : ''}" aria-label="Option ${esc(ltr)}">`
      + `<div class="opt__top"><span class="opt__ltr">${esc(ltr)}</span>${recMark}${risk}</div>${optTitle}${gist}${pc}</section>`;
  }).join('');
  return `<div class="opts">${cards}</div>`;
}

// The SINGLE recommendation strip — renders the EFFECTIVE ask's recommendation
// and attribution exactly once (a decision's own recommendation line is never
// separately rendered when meta.ask overrides it).
function recStrip(ask) {
  if (!ask || (ask.recommendation == null && ask.recommendedBy == null)) return '';
  const b = ask.recommendation != null ? `<b>Recommendation — <span>${esc(ask.recommendation)}</span></b>` : '';
  const p = ask.recommendedBy != null ? `<p>${esc(ask.recommendedBy)}</p>` : '';
  return `<div class="rec"><span class="rec__dot" aria-hidden="true"></span><div class="rec__txt">${b}${p}</div></div>`;
}

// The ask chapter's unit: the effective ask VISIBLE up top (headline + note —
// never inside a drawer), option cards as evidence when a decision exists,
// then the single .rec strip.
function askChapterHtml(effectiveAsk, decision) {
  const head = '<header class="unit__head"><span class="kick">The ask</span>'
    + `<h3 class="hline">${esc(effectiveAsk.headline ?? '')}</h3>`
    + `${effectiveAsk.note ? `<p class="lead">${esc(effectiveAsk.note)}</p>` : ''}</header>`;
  return `<article class="unit">${head}${decision ? optionCards(decision) : ''}${recStrip(effectiveAsk)}</article>`;
}

// One ledger slide -> one Gate Board unit: plain-statement headline, dominant
// figure, pill rows OUTSIDE the drawer, and the full evidence (bullets, cards,
// callout, remaining blocks) inside the collapsed drawer. Every legacy field
// still renders somewhere — nothing is dropped.
function slideUnit(s) {
  const { figureHtml, drawerBlocks } = figureSplit(s?.blocks, s?.figure);
  const pillBlocks = drawerBlocks.filter((b) => b?.type === 'pillRow');
  const rest = drawerBlocks.filter((b) => b?.type !== 'pillRow');
  const bullets = Array.isArray(s?.bullets) && s.bullets.length
    ? `<ul>${s.bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>` : '';
  const cardsHtml = Array.isArray(s?.cards) && s.cards.length
    ? s.cards.map((c) => `<div class="co"><b>${esc(c?.title)}</b><p>${esc(c?.body)}</p></div>`).join('') : '';
  const note = s?.callout ? `<div class="co co--warn"><p>${esc(s.callout)}</p></div>` : '';
  const drawerHtml = [bullets, cardsHtml, note, renderBlocks(rest)].filter(Boolean).join('');
  return unit({
    kicker: s?.kicker ?? '',
    statement: s?.statement ?? s?.heading ?? '',
    lead: s?.lead ?? '',
    figureHtml,
    pillsHtml: renderBlocks(pillBlocks),
    drawerHtml,
  });
}

// ---- legacy deck markup components (used by the seven pre-Gate-Board types
// below until Task 7 moves them onto the scaffold; deleted then) ----

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

// ---- templates ----

// Full plan board: verdict hero + stat tiles + ask strip + one chapter per
// consecutive run of slide.chapter (+ the appended `Your call` ask chapter).
export function planDeck(ledger) {
  const meta = ledger?.meta ?? {};
  const title = String(meta.title ?? 'the-foreman plan');
  const slides = Array.isArray(ledger?.slides) ? ledger.slides : [];
  const { verdict, lede } = heroOf(meta);

  // Chapters group CONSECUTIVE slides by `chapter ?? 'Board'` (non-consecutive
  // repeats become separate sections; allocateIds keeps their ids unique).
  const groups = [];
  for (const s of slides) {
    const label = String(s?.chapter ?? 'Board');
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.slides.push(s);
    else groups.push({ label, slides: [s] });
  }

  // Ask resolution (single source of truth): build the FULL chapter-label list
  // — content chapters plus the appended `Your call` chapter whenever an
  // effective ask exists — then allocate ids ONCE. gateBoard re-derives the
  // same ids from the same list, so the strip's targetId always resolves.
  const effectiveAsk = askOf(ledger);
  const labels = groups.map((g) => g.label);
  const ids = allocateIds(effectiveAsk ? [...labels, 'Your call'] : labels);
  const askTargetId = effectiveAsk ? ids[ids.length - 1] : null;

  const chapters = groups.map((g) => ({ label: g.label, unitsHtml: g.slides.map(slideUnit).join('') }));
  if (effectiveAsk) chapters.push({ label: 'Your call', unitsHtml: askChapterHtml(effectiveAsk, ledger?.decision) });

  const sources = Array.isArray(ledger?.findings?.sources) ? ledger.findings.sources : [];

  const { bodyHtml } = gateBoard({
    crumb: crumbOf(ledger),
    title,
    verdict,
    lede,
    keyStats: Array.isArray(meta.keyStats) ? meta.keyStats : [],
    ask: effectiveAsk ? { ...effectiveAsk, targetId: askTargetId } : null,
    chapters,
    sources,
  });
  return { title, favicon: fav(ledger), bodyHtml };
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
