// the-foreman artifact templates.
// Each template: (ledger) => { title, favicon, bodyHtml }.
// bodyHtml is the inner markup only; render.mjs wraps it with <title>, the
// inlined style.css, and the page script.
//
// ALL EIGHT types render the Gate Board (design.md §3/§6): one scrolling
// verdict-first page composed via scaffold.mjs — planDeck as the full
// multi-chapter board, the other seven as single-section boards (singleBoard).
// The deck()/slide()/card() era is retired (Task 7).
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
//
// askShape is the ONE gate deciding whether meta.ask participates: only an
// object with a NON-EMPTY string headline counts. A malformed meta.ask (empty
// string, plain string, number, OR an object without a real headline — {},
// {note:'x'}, {headline:''}) must fall through to the derived ask — such an
// object would otherwise win the nullish check, blank the ask strip, and
// silently drop decision.question (a decisionCard's entire payload). Both
// templates' paths (askOf here, singleBoard below) MUST use this same
// normalizer. MIRRORED in markdown.mjs (its module-local copy — two copies by
// design; keep the two in lockstep), and lint.mjs's malformed-ask rule rides
// the same predicate.
const askShape = (a) => (a && typeof a === 'object' && !Array.isArray(a)
  && typeof a.headline === 'string' && a.headline.trim() !== '' ? a : null);

function askOf(ledger) {
  const shaped = askShape(ledger?.meta?.ask);
  if (shaped) return shaped;
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

// ---- the single-section Gate Board (Task 7 — the seven non-planDeck types) ----
//
// Ask-target + rail contract (design §6): a single-section type renders exactly
// ONE chapter — the rail is Top + one chip, never a separate content chip and
// ask chip. When the type has an effective ask (meta.ask ?? its derived ask),
// that chapter is labeled `Your call` and carries BOTH the type's visible
// primary content AND the ask; when the ask source is absent, the chapter keeps
// its content label and no ask strip renders (never a dead link). Ids resolve
// ONCE via allocateIds; the strip's targetId is the resolved id (gateBoard
// re-derives the same id from the same single-label list).
function singleBoard(ledger, { fallbackTitle, contentLabel, unitHtml, derivedAsk = null, decision = null, keyStats = null, sources = [] }) {
  const meta = ledger?.meta ?? {};
  const title = String(meta.title ?? fallbackTitle);
  const effectiveAsk = askShape(meta.ask) ?? derivedAsk; // the author's meta.ask wins ONLY when well-shaped (design §6; askShape is the single gate)
  const label = effectiveAsk ? 'Your call' : contentLabel;
  const [targetId] = allocateIds([label]);
  const unitsHtml = `${unitHtml}${effectiveAsk ? askChapterHtml(effectiveAsk, decision) : ''}`;
  const { verdict, lede } = heroOf(meta);
  const { bodyHtml } = gateBoard({
    crumb: crumbOf(ledger),
    title,
    verdict,
    lede,
    // meta.keyStats (author intent) wins over a type's derived stats
    keyStats: Array.isArray(meta.keyStats) ? meta.keyStats : (keyStats ?? []),
    ask: effectiveAsk ? { ...effectiveAsk, targetId } : null,
    chapters: [{ label, unitsHtml }],
    sources,
  });
  return { title, favicon: fav(ledger), bodyHtml };
}

// A labeled `.co` callout — the visible-fact carrier for gate-critical prose
// (the label is an engine-authored literal; the value is esc'd here).
const coFact = (label, value) => `<div class="co"><b>${label}</b><p>${esc(value ?? '—')}</p></div>`;

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

// Win / pause brief: `win.landed` VISIBLE as the unit's callout, status pill
// visible, the ask (win.next) visible beneath; the verbatim evidence in a drawer.
export function brief(ledger) {
  const win = ledger?.win ?? {};
  const statusVariant = win.verified ? 'ok' : 'warn';
  const statusLabel = win.verified ? 'Verified' : 'Claimed (not yet verified)';
  const unitHtml = unit({
    kicker: win.verified ? 'Win' : 'Pause · waiting on you',
    statement: 'What landed',
    figureHtml: `<div class="co"><p>${esc(win.landed ?? '')}</p></div>`,
    pillsHtml: renderBlocks([{ type: 'pillRow', pills: [{ label: statusLabel, variant: statusVariant }] }]),
    drawerLabel: 'Evidence',
    drawerHtml: win.evidence ? `<p>${esc(win.evidence)}</p>` : '',
  });
  return singleBoard(ledger, {
    fallbackTitle: 'Brief',
    contentLabel: 'What landed',
    unitHtml,
    derivedAsk: win.next ? { headline: win.next } : null,
  });
}

// Decision card: the ask chapter alone — question visible up top, option cards
// as evidence (gists + risk chips visible, verbatim pros/cons collapsed), the
// single attributed `.rec` strip.
export function decisionCard(ledger) {
  const d = ledger?.decision ?? null;
  return singleBoard(ledger, {
    fallbackTitle: 'Decision',
    contentLabel: 'Decision',
    unitHtml: '',
    derivedAsk: d ? { headline: d.question ?? '', recommendation: d.recommendation, recommendedBy: d.recommendedBy } : null,
    decision: d,
  });
}

// Live-run brief: What / Cost / Blast radius / Cleanup as four VISIBLE callouts
// (gate-critical facts never in a drawer), keyStats synthesized from cost +
// blast radius, and the authorize ask always present.
export function liveRun(ledger) {
  const lr = ledger?.liveRun ?? {};
  const unitHtml = unit({
    kicker: 'Live run · authorize',
    statement: 'Live-run gate — authorize before anything runs',
    figureHtml: coFact('What', lr.what) + coFact('Cost', lr.cost)
      + coFact('Blast radius', lr.blastRadius) + coFact('Cleanup', lr.cleanup),
  });
  const keyStats = [
    { value: firstClause(lr.cost), label: 'cost' },
    { value: firstClause(lr.blastRadius), label: 'blast radius' },
  ].filter((s) => s.value);
  return singleBoard(ledger, {
    fallbackTitle: 'Live-run brief',
    contentLabel: 'Live run',
    unitHtml,
    derivedAsk: { headline: 'Authorize this live run?', note: firstClause(lr.what) },
    keyStats,
  });
}

// ---- the four composite types — same singleBoard, figures from the validated
// blocks registry (the block builders escape every value inside a block) ----

// phaseTracker: the stops track VISIBLE (+ optional progress donut beside it);
// pt.note drives the ask (Your call chapter) when present, else Progress.
export function phaseTracker(ledger) {
  const pt = ledger?.phaseTracker ?? {};
  const phases = Array.isArray(pt.phases) ? pt.phases : [];
  const progress = pt.progress;
  const figureHtml = renderBlocks([
    { type: 'phaseSteps', steps: phases },
    progress && { type: 'donut', value: progress.value, max: progress.max, label: progress.label },
  ].filter(Boolean));
  return singleBoard(ledger, {
    fallbackTitle: 'Phase tracker',
    contentLabel: 'Progress',
    unitHtml: unit({ kicker: 'Phase tracker', statement: 'Where the work stands', figureHtml }),
    derivedAsk: pt.note ? { headline: pt.note } : null,
  });
}

// findings: the findings table VISIBLE; statRow wells from f.sources above it
// when present, sources doubling as evidence-base chips; f.summary drives the ask.
export function findings(ledger) {
  const f = ledger?.findings ?? {};
  const items = Array.isArray(f.items) ? f.items : [];
  const sources = Array.isArray(f.sources) ? f.sources : [];
  const figureHtml = renderBlocks([
    sources.length ? { type: 'statRow', stats: sources.map((s) => ({ value: s?.value, label: s?.label })) } : null,
    {
      type: 'table',
      columns: ['Finding', 'Confidence', 'Evidence', 'Verdict'],
      rows: items.map((i) => [i?.title, i?.confidence, i?.evidence, i?.verdict]),
    },
  ].filter(Boolean));
  return singleBoard(ledger, {
    fallbackTitle: 'Findings',
    contentLabel: 'Findings',
    unitHtml: unit({ kicker: 'Findings', statement: 'What the evidence shows', figureHtml }),
    derivedAsk: f.summary ? { headline: f.summary } : null,
    sources,
  });
}

// comparison: the options × criteria table VISIBLE; c.recommendation drives the
// attributed ask (`Pick an option` + the .rec strip).
export function comparison(ledger) {
  const c = ledger?.comparison ?? {};
  const criteria = Array.isArray(c.criteria) ? c.criteria : [];
  const options = Array.isArray(c.options) ? c.options : [];

  // A trailing "Notes" column appears ONLY when at least one option carries a
  // note; otherwise the table is unchanged (no Notes column). The table block
  // escapes every cell, so the note text is neutralized there.
  const anyNote = options.some((o) => o?.note != null && o.note !== '');
  const figureHtml = renderBlocks([
    {
      type: 'table',
      columns: ['Option', ...criteria, ...(anyNote ? ['Notes'] : [])],
      // ragged scores are normalized by the table block (normalizeRow) — just map.
      rows: options.map((o) => [o?.label, ...(Array.isArray(o?.scores) ? o.scores : []), ...(anyNote ? [o?.note ?? ''] : [])]),
    },
  ]);
  return singleBoard(ledger, {
    fallbackTitle: 'Comparison',
    contentLabel: 'Comparison',
    unitHtml: unit({ kicker: 'Comparison', statement: 'How the options compare', figureHtml }),
    derivedAsk: c.recommendation != null
      ? { headline: 'Pick an option', recommendation: c.recommendation, recommendedBy: c.recommendedBy }
      : null,
  });
}

// dashboard: d.stats as hero tiles, the chart passed STRAIGHT THROUGH (unknown
// chart type fails closed, same contract) + optional ranked rows, both VISIBLE;
// d.ask drives the ask.
export function dashboard(ledger) {
  const d = ledger?.dashboard ?? {};
  const stats = Array.isArray(d.stats) ? d.stats : [];
  const rows = Array.isArray(d.rows) ? d.rows : null;
  const figureHtml = renderBlocks([
    d.chart, // passed straight to renderBlocks => an unknown chart type FAILS CLOSED
    rows && { type: 'rankedRows', rows },
  ].filter(Boolean));
  return singleBoard(ledger, {
    fallbackTitle: 'Dashboard',
    contentLabel: 'Dashboard',
    unitHtml: unit({ kicker: 'Dashboard', statement: 'The numbers right now', figureHtml }),
    derivedAsk: d.ask ? { headline: d.ask } : null,
    keyStats: stats,
  });
}
