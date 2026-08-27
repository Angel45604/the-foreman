// Shared TEST helpers — imported by *.test.mjs only, never by shipping engine
// code (the engine's own modules must not depend on test infrastructure).
//
// stripDetails(html): returns only the content OUTSIDE every <details> element
// — the "visible without interaction" surface. The visible-content contract
// (execution plan Task 7) pins that a gate's decision-critical facts are NEVER
// inside <details>; tests assert those facts appear in stripDetails(bodyHtml).
//
// Mechanism: scan the string for <details…> / </details> tags tracking nesting
// depth; keep only text at depth 0. The tags themselves and everything between
// an opening tag and its matching close are dropped. An unclosed <details>
// swallows the rest of the string (still "not visible without interaction").
// Its negative-control self-test lives in templates.test.mjs.
export function stripDetails(html) {
  const s = String(html ?? '');
  const re = /<details\b[^>]*>|<\/details\s*>/gi;
  let out = '';
  let depth = 0;
  let pos = 0;
  for (let m = re.exec(s); m !== null; m = re.exec(s)) {
    if (depth === 0) out += s.slice(pos, m.index);
    depth = m[0][1] === '/' ? Math.max(0, depth - 1) : depth + 1;
    pos = re.lastIndex;
  }
  return depth === 0 ? out + s.slice(pos) : out;
}

// ---- Gate Board CSS one-rule oracle (execution plan Task 8) ----
//
// parseRules(css): a brace-depth walker over the stylesheet. Comments are
// stripped first; every `{` pushes the pending prelude as a selector and every
// `}` pops it, flushing one {selector, declarations} record — so rules nested
// inside @media / @supports bodies are captured with their OWN selectors (a
// naive split('}') skips the first nested rule and would let a media-query
// fill through). Declarations split on ';' then on the FIRST ':'; fragments
// without a colon (e.g. the tail of a semicolon-bearing data: URI) are
// skipped — they can never carry a background/border prop.
export function parseRules(css) {
  const s = String(css ?? '').replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  const stack = [];
  let buf = '';
  const flush = (selector, text) => {
    if (!selector) return;
    const declarations = text
      .split(';')
      .map((d) => d.trim())
      .filter(Boolean)
      .flatMap((d) => {
        const idx = d.indexOf(':');
        if (idx === -1) return [];
        const rawProp = d.slice(0, idx).trim();
        // standard property names are case-insensitive in CSS (BACKGROUND: is valid);
        // custom properties (--lineV) are case-SENSITIVE by spec and must not be folded
        const prop = rawProp.startsWith('--') ? rawProp : rawProp.toLowerCase();
        return [{ prop, value: d.slice(idx + 1).trim() }];
      });
    rules.push({ selector, declarations });
  };
  for (const ch of s) {
    if (ch === '{') {
      stack.push(buf.trim());
      buf = '';
    } else if (ch === '}') {
      flush(stack.pop() ?? '', buf);
      buf = '';
    } else {
      buf += ch;
    }
  }
  return rules;
}

// Exact documented marker allowlist — selectors whose fills are dots / ticks /
// meter cores / scrollbar thumbs / toggle glyph bars. Everything else must be
// var(--bg) / engraved / transparent / none. Adjust ONLY by ADDING an exact
// selector that is genuinely such a marker — the review gate sees any diff to
// this set. Entries past the plan's baseline set (each a real reference-sheet
// marker the baseline missed): '.pill i' (the bare pill dot), '.arm--ok span i'
// and '.arm--bad span i' (the arm status dots as actually written in the
// reference), '.mx__d.miss i::after' (the unfilled matrix dot core),
// '.ev__tog::before' / '.ev__tog::after' (the +/- toggle glyph bars,
// currentColor).
export const MARKER_SELECTORS = new Set([
  '.track b', '.track i.now::after', '.track i::after', '.brow__rail i', '.pmeter i',
  '.seclab span', '.rec__dot::after', '.stop__mark i::after', '.mx__d i::after',
  '.ring__t', '.ring__t.on', '.ring__legend i', '.ring__legend span + span i',
  '.fate--ok .fate__dots i::after', '.fate--warn .fate__dots i::after', '.fate--x .fate__dots i::after',
  '.pill i.is-ok', '.pill i.is-warn', '.pill--ok i', '.pill--warn i', '.arm i', '.arm--bad i',
  '.tag i', '.tag--spawn i', '.tag--code i', '.opt__rec i', '.opt__risk i',
  '.opt__risk--low i', '.opt__risk--med i', '.opt__risk--high i',
  '.lrow__v i', '.lrow__v--ok i', '.lrow__v--mid i', '.lrow__v--no i',
  '.blt i', '.scrollx::-webkit-scrollbar-thumb', '.flatline i',
  '.pill i', '.arm--ok span i', '.arm--bad span i', '.mx__d.miss i::after',
  '.ev__tog::before', '.ev__tog::after',
]);

// ---- de-brand scan predicate (execution plan Task 13; Global Constraints) ----
//
// The forbidden legacy strings for shipping engine sources + engine-owned docs:
// the old brand name (any casing), the old accent + canvas hex literals, and
// the retired page-script name. Every alternative is assembled from split
// halves at runtime, so this helper — which sits INSIDE the scan scope
// (references/*.mjs) — can never trip its own scan; the same split-halves
// technique is the sanctioned way for any test to write a NEGATIVE assertion
// against one of these strings (never a per-file carve-out in the scan).
// render.mjs holds the legacy accent NUMERICALLY (0x…), which the #-anchored
// hex pattern deliberately does not match.
export const FORBIDDEN_BRAND_RE = new RegExp(
  ['Mind' + 'Cloud', '#009' + 'ACC', '#2d' + '323b', 'slide-' + 'engine'].join('|'),
  'i',
);

// Every offending line of `text`, as "<lineNo>: <content>" — [] when clean.
// Content is capped so a single-line data-URI can't flood a failure report.
export function debrandOffenses(text) {
  const out = [];
  String(text ?? '').split('\n').forEach((line, i) => {
    if (FORBIDDEN_BRAND_RE.test(line)) out.push(`${i + 1}: ${line.trim().slice(0, 100)}`);
  });
  return out;
}

// Borders: only complete 0/none resets pass — '0.5px solid x' must fail.
export function oracleBadBorders(css) {
  const bad = [];
  for (const r of parseRules(css)) {
    for (const d of r.declarations) {
      const isBorderProp = /^border(-(top|right|bottom|left|width|style|color|block|inline)(-(start|end))?(-(width|style|color))?)?$/.test(d.prop)
        || /^border-image(-source|-slice|-width|-outset|-repeat)?$/.test(d.prop);
      if (isBorderProp && !/^(0|none)$/.test(d.value.trim())) bad.push(`${r.selector} → ${d.prop}:${d.value}`);
    }
  }
  return bad;
}

// Backgrounds: ANCHORED whole-value patterns — a value must BE one of these,
// not merely contain one (radial-gradient(var(--bg),#ff0000) fails: it is not
// an anchored allowed value). Marker values pass only when EVERY selector in
// the rule's selector list is in MARKER_SELECTORS.
export function oracleOffenders(css) {
  const SURFACE_VALUES = /^(var\(--bg\)|var\(--lineV\)|var\(--lineH\)|transparent|none)$/;
  const MARKER_VALUES = /^(var\(--(ac|acq|ok|warn|err|sb|sd|bg)\)|currentColor|transparent|none)$/;
  const offenders = [];
  for (const r of parseRules(css)) {
    for (const d of r.declarations) {
      if (!/^background(-color|-image)?$/.test(d.prop)) continue;
      const v = d.value.trim();
      const ok = SURFACE_VALUES.test(v)
        || (r.selector.split(',').every((s) => MARKER_SELECTORS.has(s.trim())) && MARKER_VALUES.test(v));
      if (!ok) offenders.push(`${r.selector} → ${d.prop}:${d.value}`);
    }
  }
  return offenders;
}
