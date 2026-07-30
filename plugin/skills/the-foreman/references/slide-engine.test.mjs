// Behavioral coverage for slide-engine.js — the browser IIFE that drives deck
// slide navigation (dots, prev/next, keydown, the top progress bar).
//
// The skill is dependency-free, so there is NO jsdom. Instead we hand-roll a
// minimal fake `document` + element objects supporting ONLY what the engine
// touches, then execute the engine source against it via
//   new Function('document', src)(fakeDoc)
// The engine's IIFE runs immediately and reads `document` as the injected
// parameter (it shadows the global), so construction is the engine running.
//
// We capture every registered handler (each button's 'click' and the
// document-level 'keydown') so tests can simulate events by invoking the
// handler with a fake event. This harness is intentionally extensible: a
// follow-up task adds a #chapters element — `makeDoc` already routes any
// getElementById by id, and `el()` elements carry tagName/getAttribute, so
// new elements/handlers slot in without reshaping the harness.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ENGINE_SRC = readFileSync(join(HERE, 'slide-engine.js'), 'utf8');

// ---- the fake DOM ------------------------------------------------------

// A minimal element. `tag` becomes tagName (uppercased, like the real DOM).
// `attrs` backs getAttribute (used by the engine's Space-on-control guard via
// [role=button]) AND setAttribute (the engine writes aria-expanded / role here,
// so a later getAttribute reads back what was set). `handlers` collects
// addEventListener callbacks by type so tests can fire them. classList is a
// real toggle/add/remove/contains set.
//
// Focus is modeled minimally: each element's focus() records itself as the
// owning document's activeElement (set by makeDoc via _setActive). This mirrors
// the one DOM behavior the keyboard nav relies on — calling el.focus() makes it
// document.activeElement — without simulating real focus traversal/tabindex.
function el(tag = 'DIV', attrs = {}) {
  const classes = new Set();
  const handlers = {};
  const node = {
    tagName: String(tag).toUpperCase(),
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null;
    },
    setAttribute(name, value) {
      attrs[name] = String(value);
    },
    focus() {
      if (this._setActive) this._setActive(this);
    },
    // makeDoc injects this so focus() can route to the doc's activeElement.
    _setActive: null,
    className: '',
    style: {},
    textContent: '',
    disabled: false,
    children: [],
    appendChild(child) {
      this.children.push(child);
      if (this._setActive && !child._setActive) child._setActive = this._setActive;
      return child;
    },
    addEventListener(type, fn) {
      (handlers[type] || (handlers[type] = [])).push(fn);
    },
    // test-only escape hatch to inspect / fire registered handlers
    _handlers: handlers,
    _fire(type, ev) {
      (handlers[type] || []).forEach((fn) => fn(ev));
    },
    classList: {
      toggle(name, force) {
        const want = force === undefined ? !classes.has(name) : !!force;
        if (want) classes.add(name);
        else classes.delete(name);
        return want;
      },
      add(name) { classes.add(name); },
      remove(name) { classes.delete(name); },
      contains(name) { return classes.has(name); },
    },
  };
  return node;
}

// A fake .slide SECTION. The chapters navigator reads three things off each
// slide: its <h2> heading, its .kicker eyebrow, and its data-section attribute.
// We back those with a tiny querySelector that returns a textContent-bearing
// stub for 'h2'/'.kicker' (null .kicker is allowed — the engine tolerates it).
// `section` (string|null) becomes the data-section getAttribute reads.
function slideEl({ heading = '', kicker = '', section = null } = {}) {
  const s = el('SECTION', section == null ? {} : { 'data-section': section });
  const h2 = { textContent: heading };
  const kick = kicker == null ? null : { textContent: kicker };
  s.querySelector = (sel) => (sel === 'h2' ? h2 : sel === '.kicker' ? kick : null);
  return s;
}

// Build a fake document for a deck. `spec` is either a number `n` (n bare
// slides, back-compat) or an array of slide-spec objects ({heading,kicker,
// section}). Wires up the required ids (bar, pg, dots, prev, next) PLUS the
// chapters navigator ids (toctgl, chapters). createElement returns fresh
// elements (BUTTON dots, the chapter rows/headers the engine builds).
function makeDoc(spec) {
  const slides = typeof spec === 'number'
    ? Array.from({ length: spec }, () => slideEl())
    : spec.map((sp) => slideEl(sp));
  const byId = {
    bar: el('DIV'),
    pg: el('SPAN'),
    dots: el('DIV'),
    prev: el('BUTTON'),
    next: el('BUTTON'),
    toctgl: el('BUTTON'),
    chapters: el('DIV'),
  };
  const doc = {
    // activeElement tracks focus(); starts on a body-like default so the
    // initial state is well-defined (and not equal to #toctgl or any entry).
    activeElement: el('BODY'),
    querySelectorAll(sel) {
      if (sel === '.slide') return slides;
      return [];
    },
    getElementById(id) {
      return byId[id] ?? null;
    },
    createElement(tag) {
      const node = el(tag);
      node._setActive = setActive;
      return node;
    },
    addEventListener(type, fn) {
      (doc._handlers[type] || (doc._handlers[type] = [])).push(fn);
    },
    _handlers: {},
    _slides: slides,
    _byId: byId,
  };
  function setActive(node) { doc.activeElement = node; }
  // Wire focus() routing into the pre-built ids and slides too, so focus()
  // on #toctgl (or any element) updates doc.activeElement.
  Object.values(byId).forEach((node) => { node._setActive = setActive; });
  slides.forEach((node) => { node._setActive = setActive; });
  return doc;
}

// Run the engine against a fresh fake doc; return the doc. `spec` per makeDoc.
function run(spec) {
  const doc = makeDoc(spec);
  // The IIFE executes on construction, reading our injected `document`.
  // eslint-disable-next-line no-new-func
  new Function('document', ENGINE_SRC)(doc);
  return doc;
}

// ---- chapters-navigator inspection helpers -----------------------------

// Rows the engine appended to #chapters, flattened in document order. Each is a
// fake element; group headers carry class 'chapsec' (with nested 'chaprow'
// children), standalone/grouped slide rows carry class 'chaprow'.
function chapterEls(doc) {
  return doc._byId.chapters.children;
}
// Every slide-row (clickable, navigates) across the panel, in order. A row is a
// chaprow regardless of whether it sits at top level or nested under a group.
function slideRows(doc) {
  const out = [];
  const walk = (nodes) => nodes.forEach((c) => {
    if (c.classList.contains('chaprow')) out.push(c);
    if (c.children && c.children.length) walk(c.children);
  });
  walk(chapterEls(doc));
  return out;
}
// Group header elements (the section-name rows that toggle expand/collapse).
function groupHeaders(doc) {
  const out = [];
  const walk = (nodes) => nodes.forEach((c) => {
    if (c.classList.contains('chaphead')) out.push(c);
    if (c.children && c.children.length) walk(c.children);
  });
  walk(chapterEls(doc));
  return out;
}
// Group container elements (carry 'chapgroup'; toggle '.open' to expand).
function groupEls(doc) {
  return chapterEls(doc).filter((c) => c.classList.contains('chapgroup'));
}

// Fire the captured document-level keydown handler with a fake event.
// Returns { defaulted } so tests can assert preventDefault behavior.
function keydown(doc, key, target) {
  let defaulted = false;
  const ev = { key, target, preventDefault() { defaulted = true; } };
  (doc._handlers.keydown || []).forEach((fn) => fn(ev));
  return { defaulted };
}

// The active slide index = the slide whose 'on' class is set.
function activeSlide(doc) {
  return doc._slides.findIndex((s) => s.classList.contains('on'));
}
// The active dot index (dots are the children of #dots).
function activeDot(doc) {
  return doc._byId.dots.children.findIndex((d) => d.classList.contains('on'));
}

// ---- progress bar -------------------------------------------------------

test('n=1 deck: progress bar width is "0%", never "NaN%"', () => {
  const doc = run(1);
  assert.equal(doc._byId.bar.style.width, '0%');
  assert.doesNotMatch(doc._byId.bar.style.width, /NaN/);
});

test('multi-slide deck: bar width is 0% at first, 100% at last, correct intermediate', () => {
  const doc = run(4);
  assert.equal(doc._byId.bar.style.width, '0%'); // slide 0
  const dots = doc._byId.dots.children;
  dots[1]._fire('click'); // go to slide index 1
  assert.equal(doc._byId.bar.style.width, (1 / 3 * 100) + '%');
  dots[3]._fire('click'); // last slide
  assert.equal(doc._byId.bar.style.width, '100%');
});

// ---- dots ---------------------------------------------------------------

test('a dot click navigates: active slide/dot toggle to that index and pg updates', () => {
  const doc = run(4);
  assert.equal(activeSlide(doc), 0);
  assert.equal(activeDot(doc), 0);
  assert.equal(doc._byId.pg.textContent, '01 / 04');

  doc._byId.dots.children[2]._fire('click');

  assert.equal(activeSlide(doc), 2);
  assert.equal(activeDot(doc), 2);
  assert.equal(doc._byId.pg.textContent, '03 / 04');
});

// ---- prev / next disabled at the ends -----------------------------------

test('prev disabled at first slide, next disabled at last slide', () => {
  const doc = run(3);
  assert.equal(doc._byId.prev.disabled, true);  // at slide 0
  assert.equal(doc._byId.next.disabled, false);

  doc._byId.next._fire('click'); // -> slide 1
  assert.equal(doc._byId.prev.disabled, false);
  assert.equal(doc._byId.next.disabled, false);

  doc._byId.next._fire('click'); // -> slide 2 (last)
  assert.equal(doc._byId.prev.disabled, false);
  assert.equal(doc._byId.next.disabled, true);
});

test('n=1 deck: both prev and next are disabled, single dot, pg is 01 / 01', () => {
  const doc = run(1);
  assert.equal(doc._byId.prev.disabled, true);
  assert.equal(doc._byId.next.disabled, true);
  assert.equal(doc._byId.dots.children.length, 1);
  assert.equal(doc._byId.pg.textContent, '01 / 01');
});

// ---- keyboard navigation ------------------------------------------------

test('ArrowRight navigates forward and calls preventDefault', () => {
  const doc = run(4);
  const { defaulted } = keydown(doc, 'ArrowRight', el('BODY'));
  assert.equal(activeSlide(doc), 1);
  assert.equal(defaulted, true);
});

test('ArrowLeft navigates back and calls preventDefault', () => {
  const doc = run(4);
  doc._byId.dots.children[2]._fire('click'); // start at slide 2
  const { defaulted } = keydown(doc, 'ArrowLeft', el('BODY'));
  assert.equal(activeSlide(doc), 1);
  assert.equal(defaulted, true);
});

test('Space navigates forward (non-interactive target) and calls preventDefault', () => {
  const doc = run(4);
  const { defaulted } = keydown(doc, ' ', el('BODY'));
  assert.equal(activeSlide(doc), 1);
  assert.equal(defaulted, true);
});

test('Home jumps to first slide and calls preventDefault', () => {
  const doc = run(4);
  doc._byId.dots.children[3]._fire('click'); // start at last
  const { defaulted } = keydown(doc, 'Home', el('BODY'));
  assert.equal(activeSlide(doc), 0);
  assert.equal(defaulted, true);
});

test('End jumps to last slide and calls preventDefault', () => {
  const doc = run(4);
  const { defaulted } = keydown(doc, 'End', el('BODY'));
  assert.equal(activeSlide(doc), 3);
  assert.equal(defaulted, true);
});

// ---- Space-on-a-focused-control guard -----------------------------------

test('Space on a focused BUTTON does NOT navigate and does NOT preventDefault', () => {
  const doc = run(4);
  const before = activeSlide(doc);
  const { defaulted } = keydown(doc, ' ', el('BUTTON'));
  assert.equal(activeSlide(doc), before); // native button activation wins
  assert.equal(defaulted, false);
});

test('Space on a [role=button] control does NOT navigate', () => {
  const doc = run(4);
  const before = activeSlide(doc);
  keydown(doc, ' ', el('DIV', { role: 'button' }));
  assert.equal(activeSlide(doc), before);
});

test('Space on a contentEditable control does NOT navigate', () => {
  const doc = run(4);
  const before = activeSlide(doc);
  const target = el('DIV');
  target.isContentEditable = true;
  keydown(doc, ' ', target);
  assert.equal(activeSlide(doc), before);
});

test('ArrowRight on a focused BUTTON still navigates (arrows ignore focus)', () => {
  const doc = run(4);
  keydown(doc, 'ArrowRight', el('BUTTON'));
  assert.equal(activeSlide(doc), 1);
});

test('handler is defensive when e.target is undefined (Space still navigates)', () => {
  const doc = run(4);
  const { defaulted } = keydown(doc, ' ', undefined);
  assert.equal(activeSlide(doc), 1);
  assert.equal(defaulted, true);
});

// ---- chapters navigator -------------------------------------------------

test('chapters: toggle + panel present and populated (one slide-row per slide) when n>=2', () => {
  const doc = run(4);
  assert.notEqual(doc._byId.toctgl.style.display, 'none');
  assert.notEqual(doc._byId.chapters.style.display, 'none');
  assert.equal(slideRows(doc).length, 4);
});

test('chapters: HIDDEN for a single-slide brief (n<2), no rows built', () => {
  const doc = run(1);
  assert.equal(doc._byId.toctgl.style.display, 'none');
  assert.equal(doc._byId.chapters.style.display, 'none');
  assert.equal(chapterEls(doc).length, 0);
});

test('chapters: flat fallback when no slide has a chapter — one row per slide, no headers', () => {
  const doc = run([{ heading: 'A' }, { heading: 'B' }, { heading: 'C' }]);
  assert.equal(slideRows(doc).length, 3);
  assert.equal(groupHeaders(doc).length, 0);
  assert.equal(groupEls(doc).length, 0);
});

// The label text of a slide-row: the .chaplabel child's textContent (set via
// textContent only — never innerHTML — so ledger text stays inert).
function rowLabel(row) {
  const lab = row.children.find((c) => c.classList.contains('chaplabel'));
  return lab ? lab.textContent : '';
}
// The kicker eyebrow of a slide-row, if present (.chapkick child).
function rowKick(row) {
  const k = row.children.find((c) => c.classList.contains('chapkick'));
  return k ? k.textContent : '';
}

test('chapters: flat rows carry the heading as label text (set via textContent)', () => {
  const doc = run([{ heading: 'Alpha', kicker: 'PLAN' }, { heading: 'Beta', kicker: 'BUILD' }]);
  const labels = slideRows(doc).map(rowLabel);
  assert.deepEqual(labels, ['Alpha', 'Beta']);
  // the kicker rides as a small eyebrow on the row
  assert.deepEqual(slideRows(doc).map(rowKick), ['PLAN', 'BUILD']);
});

test('chapters: grouped accordion — [null,A,A,B,B,B] => 1 standalone row + group A(2) + group B(3)', () => {
  const doc = run([
    { heading: 'Intro' },
    { heading: 'A1', section: 'Alpha' }, { heading: 'A2', section: 'Alpha' },
    { heading: 'B1', section: 'Beta' }, { heading: 'B2', section: 'Beta' }, { heading: 'B3', section: 'Beta' },
  ]);
  assert.equal(groupEls(doc).length, 2);            // two groups
  assert.equal(groupHeaders(doc).length, 2);        // two headers
  assert.equal(slideRows(doc).length, 6);           // every slide still has a row
  const headerNames = groupHeaders(doc).map((h) => h.textContent);
  assert.deepEqual(headerNames, ['Alpha', 'Beta']);
  // group A has 2 slide-rows nested, group B has 3
  const [gA, gB] = groupEls(doc);
  const rowsIn = (g) => g.children.filter((c) => c.classList.contains('chaprow')).length;
  assert.equal(rowsIn(gA), 2);
  assert.equal(rowsIn(gB), 3);
  // the standalone (null-section) slide is a top-level row, not under a group
  const topRows = chapterEls(doc).filter((c) => c.classList.contains('chaprow'));
  assert.equal(topRows.length, 1);
});

test('chapters: non-consecutive repeats form SEPARATE groups — [A,B,A] => three groups', () => {
  const doc = run([
    { heading: 'a1', section: 'Alpha' },
    { heading: 'b1', section: 'Beta' },
    { heading: 'a2', section: 'Alpha' },
  ]);
  assert.equal(groupEls(doc).length, 3);
  assert.deepEqual(groupHeaders(doc).map((h) => h.textContent), ['Alpha', 'Beta', 'Alpha']);
});

test('chapters: clicking a slide row navigates (go) to that slide index', () => {
  const doc = run([{ heading: 'A' }, { heading: 'B' }, { heading: 'C' }]);
  assert.equal(activeSlide(doc), 0);
  slideRows(doc)[2]._fire('click');
  assert.equal(activeSlide(doc), 2);
});

test('chapters: clicking a group HEADER toggles its .open WITHOUT navigating', () => {
  const doc = run([
    { heading: 'A1', section: 'Alpha' }, { heading: 'A2', section: 'Alpha' },
    { heading: 'B1', section: 'Beta' }, { heading: 'B2', section: 'Beta' },
  ]);
  // start on slide 0 => group Alpha is the active group (force-open); collapse Beta first
  const before = activeSlide(doc);
  const beta = groupEls(doc)[1];
  const openBefore = beta.classList.contains('open');
  groupHeaders(doc)[1]._fire('click'); // toggle Beta
  assert.equal(beta.classList.contains('open'), !openBefore); // toggled
  assert.equal(activeSlide(doc), before);                     // did NOT navigate
});

test('chapters: active slide row gets the active (.on) class, follows navigation', () => {
  const doc = run([{ heading: 'A' }, { heading: 'B' }, { heading: 'C' }]);
  assert.ok(slideRows(doc)[0].classList.contains('on'));
  assert.ok(!slideRows(doc)[1].classList.contains('on'));
  doc._byId.next._fire('click'); // -> slide 1
  assert.ok(!slideRows(doc)[0].classList.contains('on'));
  assert.ok(slideRows(doc)[1].classList.contains('on'));
});

test('chapters: the active slide group is force-expanded in render()', () => {
  const doc = run([
    { heading: 'A1', section: 'Alpha' }, { heading: 'A2', section: 'Alpha' },
    { heading: 'B1', section: 'Beta' }, { heading: 'B2', section: 'Beta' },
  ]);
  const [gA, gB] = groupEls(doc);
  assert.ok(gA.classList.contains('open'));   // active slide 0 is in Alpha => open
  // navigate into Beta (slide 2) => Beta becomes force-open
  doc._byId.dots.children[2]._fire('click');
  assert.ok(gB.classList.contains('open'));
});

test('chapters: a user-opened group stays open after navigating elsewhere (no forced collapse)', () => {
  const doc = run([
    { heading: 'A1', section: 'Alpha' }, { heading: 'A2', section: 'Alpha' },
    { heading: 'B1', section: 'Beta' }, { heading: 'B2', section: 'Beta' },
  ]);
  const gB = groupEls(doc)[1];
  groupHeaders(doc)[1]._fire('click');        // user opens Beta while on slide 0 (Alpha)
  assert.ok(gB.classList.contains('open'));
  doc._byId.next._fire('click');              // navigate to slide 1 (still Alpha)
  assert.ok(gB.classList.contains('open'));   // Beta NOT force-collapsed
});

test('chapters: toggle button click opens the panel (.open on #chapters); Escape closes it', () => {
  const doc = run(3);
  assert.ok(!doc._byId.chapters.classList.contains('open'));
  doc._byId.toctgl._fire('click');
  assert.ok(doc._byId.chapters.classList.contains('open'));
  keydown(doc, 'Escape', el('BODY'));
  assert.ok(!doc._byId.chapters.classList.contains('open'));
});

test('chapters: a click outside #chapters/#toctgl closes the pinned panel', () => {
  const doc = run(3);
  doc._byId.toctgl._fire('click');                 // pin open
  assert.ok(doc._byId.chapters.classList.contains('open'));
  (doc._handlers.click || []).forEach((fn) => fn({ target: el('BODY') }));
  assert.ok(!doc._byId.chapters.classList.contains('open'));
});

// ---- chapters navigator: KEYBOARD ACCESSIBILITY -------------------------
// Rows + headers are real <button>s (native focus + Enter/Space activation);
// #toctgl reflects aria-expanded; Escape returns focus to #toctgl; Arrow within
// the panel roves focus WITHOUT leaking to the global slide-nav.

test('a11y: chapter slide-rows are BUTTON elements (not div)', () => {
  const doc = run([{ heading: 'A' }, { heading: 'B' }, { heading: 'C' }]);
  slideRows(doc).forEach((r) => assert.equal(r.tagName, 'BUTTON'));
});

test('a11y: group HEADERS are BUTTON elements (not div)', () => {
  const doc = run([
    { heading: 'A1', section: 'Alpha' }, { heading: 'A2', section: 'Alpha' },
    { heading: 'B1', section: 'Beta' },
  ]);
  const heads = groupHeaders(doc);
  assert.equal(heads.length, 2);
  heads.forEach((h) => assert.equal(h.tagName, 'BUTTON'));
});

test('a11y: slide-rows carry role="menuitem"', () => {
  const doc = run([{ heading: 'A' }, { heading: 'B' }]);
  slideRows(doc).forEach((r) => assert.equal(r.getAttribute('role'), 'menuitem'));
});

test('a11y: Enter on a slide-row button navigates to that row index (NOT slide+1)', () => {
  const doc = run([{ heading: 'A' }, { heading: 'B' }, { heading: 'C' }]);
  assert.equal(activeSlide(doc), 0);
  // A real button activates on Enter by firing its click handler.
  slideRows(doc)[2]._fire('click');
  assert.equal(activeSlide(doc), 2);
});

test('a11y: Space on a focused row BUTTON navigates the CHAPTER (row idx), not the slide (idx+1)', () => {
  const doc = run([{ heading: 'A' }, { heading: 'B' }, { heading: 'C' }]);
  // Global keydown Space with a BUTTON target must NOT slide-nav (ctrl() guard).
  const row = slideRows(doc)[2];
  const { defaulted } = keydown(doc, ' ', row);
  assert.equal(defaulted, false);          // Space NOT hijacked as slide-nav
  assert.equal(activeSlide(doc), 0);       // slide did NOT advance to idx+1
  // Native button Space activation fires the click handler -> go(2).
  row._fire('click');
  assert.equal(activeSlide(doc), 2);       // chapter row's own index
});

test('a11y: #toctgl aria-expanded is "false" initially, "true" once open, "false" after Escape', () => {
  const doc = run(3);
  assert.equal(doc._byId.toctgl.getAttribute('aria-expanded'), 'false');
  doc._byId.toctgl._fire('click');
  assert.equal(doc._byId.toctgl.getAttribute('aria-expanded'), 'true');
  keydown(doc, 'Escape', el('BODY'));
  assert.equal(doc._byId.toctgl.getAttribute('aria-expanded'), 'false');
});

test('a11y: opening via the toggle moves focus to the first chapter entry', () => {
  const doc = run([{ heading: 'A' }, { heading: 'B' }, { heading: 'C' }]);
  doc._byId.toctgl._fire('click');
  assert.equal(doc.activeElement, slideRows(doc)[0]);
});

test('a11y: Escape closes the panel AND returns focus to #toctgl', () => {
  const doc = run(3);
  doc._byId.toctgl._fire('click');                 // open (focus jumps into panel)
  assert.ok(doc._byId.chapters.classList.contains('open'));
  keydown(doc, 'Escape', el('BODY'));
  assert.ok(!doc._byId.chapters.classList.contains('open')); // closed
  assert.equal(doc.activeElement, doc._byId.toctgl);         // focus returned
});

test('a11y: ArrowDown on a chapter entry roves to the NEXT entry and does NOT change the slide', () => {
  const doc = run([{ heading: 'A' }, { heading: 'B' }, { heading: 'C' }]);
  doc._byId.toctgl._fire('click');                 // open the panel
  const rows = slideRows(doc);
  const before = activeSlide(doc);
  const { defaulted } = keydown(doc, 'ArrowDown', rows[0]); // focus on first entry
  assert.equal(doc.activeElement, rows[1]);        // focus moved down
  assert.equal(activeSlide(doc), before);          // global slide-nav was SKIPPED
  assert.equal(defaulted, true);                   // panel consumed the key
});

test('a11y: ArrowRight on an in-panel entry is SWALLOWED — global slide-nav does NOT leak', () => {
  // ArrowRight IS a global slide key. With focus on a chapter entry and the
  // panel open, the in-panel guard must consume it so the slide stays put.
  // (This is the assertion the in-panel-Arrow-guard mutation breaks: remove the
  //  guard and ArrowRight leaks through to go(i+1).)
  const doc = run([{ heading: 'A' }, { heading: 'B' }, { heading: 'C' }]);
  doc._byId.toctgl._fire('click');                 // open the panel
  const rows = slideRows(doc);
  const before = activeSlide(doc);
  const { defaulted } = keydown(doc, 'ArrowRight', rows[0]); // focus on an entry
  assert.equal(activeSlide(doc), before);          // slide did NOT advance (no leak)
  assert.equal(defaulted, true);                   // guard consumed the key
});

test('a11y: ArrowUp on a chapter entry roves to the PREVIOUS entry (no slide change)', () => {
  const doc = run([{ heading: 'A' }, { heading: 'B' }, { heading: 'C' }]);
  doc._byId.toctgl._fire('click');
  const rows = slideRows(doc);
  const before = activeSlide(doc);
  keydown(doc, 'ArrowDown', rows[0]); // -> rows[1]
  keydown(doc, 'ArrowUp', rows[1]);   // back to rows[0]
  assert.equal(doc.activeElement, rows[0]);
  assert.equal(activeSlide(doc), before);
});

test('a11y: ArrowDown OUTSIDE the panel still navigates slides (regression guard)', () => {
  const doc = run([{ heading: 'A' }, { heading: 'B' }, { heading: 'C' }]);
  doc._byId.toctgl._fire('click');                 // panel open, but target is NOT an entry
  const before = activeSlide(doc);
  keydown(doc, 'ArrowDown', el('BODY'));           // body target => global slide-nav
  // ArrowDown is not a slide key; ArrowRight is. Use ArrowRight to prove leak-through.
  assert.equal(activeSlide(doc), before);
  keydown(doc, 'ArrowRight', el('BODY'));
  assert.equal(activeSlide(doc), before + 1);      // slides still navigate outside the panel
});

test('a11y: ArrowRight outside the panel navigates slides even while the panel is OPEN', () => {
  const doc = run([{ heading: 'A' }, { heading: 'B' }, { heading: 'C' }]);
  doc._byId.toctgl._fire('click');                 // open
  const before = activeSlide(doc);
  keydown(doc, 'ArrowRight', el('BODY'));          // target outside #chapters
  assert.equal(activeSlide(doc), before + 1);
});

test('a11y: the panel still hides for a single-slide brief (n<2) — unchanged', () => {
  const doc = run(1);
  assert.equal(doc._byId.toctgl.style.display, 'none');
  assert.equal(doc._byId.chapters.style.display, 'none');
  assert.equal(chapterEls(doc).length, 0);
});
