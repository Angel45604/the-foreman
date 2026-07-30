// the-foreman shared escaping primitives.
//
// Extracted VERBATIM from render.mjs / templates.mjs (esc) and markdown.mjs
// (mdEsc) so the HTML path, the Markdown twin, AND the block builders all reach
// markup through ONE audited escape. Behavior is byte-identical to the prior
// inline copies — the existing escaping/injection tests pin this. Extraction
// also breaks the future circular import (markdown <-> blocks).

// HTML escape — every ledger-derived string must pass through this before it
// reaches HTML markup. Identical to the copies previously inlined in render.mjs
// (~line 24) and templates.mjs (~line 10).
export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));

// Markdown escape — neutralize a ledger value so it renders as INERT PLAIN TEXT
// in Markdown: no image/link/code/emphasis can be injected via inline syntax,
// and no heading/list/blockquote can be injected via a smuggled newline. This
// mirrors the HTML artifact, which renders all ledger text inert (and asserts no
// external refs). secret-scan does NOT catch HTML injection — mdEsc must be no
// weaker than esc(). Order matters:
//   1. collapse newlines so a value can't start a new structural line;
//   2. HTML-entity escape & < > (inert when the .md is viewed as HTML);
//   3. backslash-escape the backslash FIRST, then the Markdown inline-active
//      punctuation, so links/images/code/emphasis are inert. (`<>&` are already
//      entities from step 2, so they won't appear in the backslash pass.)
// Line-start-only actives (- . +) need no escape — values never sit at line
// start after step 1 + my static prefixes — so they stay raw for readability.
// Extracted VERBATIM from markdown.mjs (~line 27).
export const mdEsc = (s) =>
  String(s ?? '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/^[ \t]+/, '') // drop leading indent so a col-1 value can't open an indented code block / indented list
    .replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
    .replace(/\\/g, '\\\\')
    .replace(/[`*_{}\[\]()#!|~]/g, (c) => '\\' + c)
    // a value emitted at column 1 (e.g. the planDeck subtitle) must not open a list/ordered-list;
    // neutralize a LEADING bullet/ordered marker (kept leading-only so mid-text "v1.1" / "a-b" stay readable)
    .replace(/^([-+])/, '\\$1')
    .replace(/^(\d+)([.)])/, '$1\\$2');
