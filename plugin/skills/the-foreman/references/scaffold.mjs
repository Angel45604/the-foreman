// the-foreman Gate Board shell renderers.
//
// One scaffold for all eight artifact types (design.md §3): sticky chapter
// rail + verdict hero + stat tiles + ask strip + chapter sections of units.
// Markup and classes lift from the owner-approved gate-board-reference.html.
// Every dynamic string reaches HTML through esc(); rail chip numbers are
// generated 1..N integers, never ledger-derived.

import { esc } from './esc.mjs';

export function slugify(label) {
  const s = String(label ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s || 'section';
}

// decimal-safe first clause: split at ' · ' or at .!? followed by whitespace/end
// (never a bare dot, so $0.12 / v1.2 / diff.mjs survive); cap 80 chars with an ellipsis.
export function firstClause(text) {
  const t = String(text ?? '');
  const m = t.match(/^(.*?)(\s·\s|[.!?](?=\s|$))/);
  const clause = m ? (m[1] + (/[.!?]/.test(m[2]) ? m[2].trim() : '')) : t;
  return clause.length > 80 ? clause.slice(0, 79) + '…' : clause;
}

export function drawer(label, innerHtml) {
  if (!innerHtml) return '';
  return `<details class="dw"><summary>${esc(label)} <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 6l5 5 5-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></summary><div class="drawer">${innerHtml}</div></details>`;
}

export function unit({ kicker = '', statement = '', lead = '', figureHtml = '', pillsHtml = '', drawerLabel = 'Detail', drawerHtml = '' } = {}) {
  return `<article class="unit"><header class="unit__head">${kicker ? `<span class="kick">${esc(kicker)}</span>` : ''}`
    + `<h3 class="hline">${esc(statement)}</h3>${lead ? `<p class="lead">${esc(lead)}</p>` : ''}</header>`
    + `${figureHtml}${pillsHtml}${drawer(drawerLabel, drawerHtml)}</article>`;
}

export function allocateIds(labels) {
  const taken = new Set(['top']);
  return labels.map((label) => {
    const base = slugify(label);
    let id = base;
    for (let n = 2; taken.has(id); n += 1) id = `${base}-${n}`;
    taken.add(id);
    return id;
  });
}

export function gateBoard({ crumb = '', title = '', verdict = '', lede = '', keyStats = [], ask = null, chapters = [], sources = [], foot = '' } = {}) {
  const ids = allocateIds(chapters.map((c) => c.label));
  const chs = chapters.map((c, i) => ({ id: ids[i], label: String(c.label ?? ''), unitsHtml: c.unitsHtml ?? '' }));
  const chips = [{ id: 'top', label: 'Top' }, ...chs]
    .map((c, i) => `<a class="nav__chip${i === 0 ? ' is-live' : ''}" href="#${c.id}" data-sec="${c.id}"${i === 0 ? ' aria-current="true"' : ''}><span class="nav__n" aria-hidden="true">${i + 1}</span>${esc(c.label)}</a>`)
    .join('');
  const nav = `<nav class="nav" aria-label="Chapters"><div class="nav__track" id="navtrack">${chips}<span class="nav__hint" aria-hidden="true">1&ndash;${Math.min(9, chs.length + 1)} jump &middot; Home / End</span></div></nav>`;
  const tiles = keyStats.length
    ? `<div class="tiles" role="list" aria-label="The numbers that matter">${keyStats.map((s) => `<div class="tile" role="listitem"><b>${esc(s?.value)}</b><span>${esc(s?.label)}</span></div>`).join('')}</div>` : '';
  // headline / note / recommendation / attribution each render independently — no field gates another
  const askBits = ask
    ? [ask.note ? esc(ask.note) : '',
       ask.recommendation ? `<strong>${esc(ask.recommendation)}</strong>` : '',
       ask.recommendedBy ? `<span class="chip">${esc(ask.recommendedBy)}</span>` : ''].filter(Boolean).join(' ')
    : '';
  const askTarget = ask?.targetId && (ask.targetId === 'top' || ids.includes(ask.targetId)) ? ask.targetId : null;
  const askStrip = ask
    ? `<div class="ask"><div class="ask__txt"><span class="ask__kick">What is being asked of you</span><b>${esc(ask.headline)}</b>${askBits ? `<p>${askBits}</p>` : ''}</div>${askTarget ? `<a class="btn btn--accent" href="#${askTarget}">Jump to the ask</a>` : ''}</div>` : '';
  // evidence-source chips render INSIDE the FINAL chapter section (the ask chapter
  // when one exists) so they are part of the rail-addressable ask target (design §3.6);
  // with ZERO chapters they fall back into the #top section so they can never be
  // silently dropped (content-preservation contract).
  const src = sources.length ? `<div class="src" aria-label="Evidence base">${sources.map((s) => `<span class="chip"><b>${esc(s?.value)}</b>&nbsp;${esc(s?.label)}</span>`).join('')}</div>` : '';
  const srcInTop = chs.length === 0 ? src : '';
  const head = `<section id="top" aria-label="Verdict"><header class="wrap crumbrow"><span class="chip crumb">${esc(crumb)}</span><div class="tools"><span class="chip">Gate artifact</span><button class="btn btn--sm jsonly" id="exp-all" type="button">Expand all</button><button class="btn btn--sm jsonly" id="col-all" type="button">Collapse all</button></div></header>`
    + `<div class="wrap hero"><h1>${esc(title)}</h1>${verdict ? `<p class="verdictline">${esc(verdict)}</p>` : ''}${lede ? `<p class="lede">${esc(lede)}</p>` : ''}</div>`
    + `<div class="wrap">${tiles}${askStrip}${srcInTop}</div></section>`;
  const sections = chs.map((c, i) => `<section class="chap" id="${c.id}" aria-label="${esc(c.label)}"><div class="wrap"><div class="seclab"><span></span><h2>${esc(c.label)}</h2></div>${c.unitsHtml}${i === chs.length - 1 ? src : ''}</div></section>`).join('');
  const footer = foot ? `<p class="wrap foot">${esc(foot)}</p>` : '';
  return { bodyHtml: `${nav}\n${head}\n${sections}\n${footer}`, ids };
}
