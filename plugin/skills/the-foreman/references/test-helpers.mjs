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
