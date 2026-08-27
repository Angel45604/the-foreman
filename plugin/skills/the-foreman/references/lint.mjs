// Non-fatal authoring lint (design §7): pure, no IO. Checks the LEDGER against
// the SKILL.md authoring contract and returns warnings; the render always
// proceeds (a blocked render must never stall a human gate — the fail-closed
// secret scan is a separate, unchanged write gate in render.mjs).
//
// OUTPUT CONTRACT: every message is RULE + LOCATION ONLY — e.g.
// `lint: statement-too-long slides[3]` — NEVER any ledger text. render.mjs
// buffers these and prints them only after both renderings pass the secret
// scan, so nothing derived from the ledger can reach stderr pre-scan; keeping
// the messages location-only means they stay safe even then.

// The gate types: artifacts whose whole point is a human decision, so a
// missing verdict line or missing ask is an authoring smell worth flagging.
const GATE_TYPES = new Set(['planDeck', 'brief', 'decisionCard', 'liveRun']);

const isObj = (a) => Boolean(a) && typeof a === 'object' && !Array.isArray(a);

// The SAME shape gate as templates.mjs's askShape (mirrored again in
// markdown.mjs): a meta.ask participates ONLY as an object with a non-empty
// string headline. Anything else present ({}, {note:'x'}, {headline:''}, a
// plain string/number) falls through to the derived ask in the renderers —
// worth a lint line, since the author probably meant it to override.
const askShape = (a) => isObj(a) && typeof a.headline === 'string' && a.headline.trim() !== '';

export function lintLedger(ledger, type) {
  const warnings = [];
  const l = isObj(ledger) ? ledger : {};
  const meta = isObj(l.meta) ? l.meta : {};
  const slides = Array.isArray(l.slides) ? l.slides : [];

  slides.forEach((s, i) => {
    const statement = s?.statement ?? s?.heading; // the statement SLOT (heading is the legacy fallback)
    if (typeof statement !== 'string' || statement === '') return;
    if (statement.trim().split(/\s+/).length > 12) warnings.push(`lint: statement-too-long slides[${i}]`);
    if (/[`@]/.test(statement)) warnings.push(`lint: code-token-in-statement slides[${i}]`);
  });

  // present-but-malformed meta.ask (fails askShape): the renderers silently fall
  // through to the derived ask — flag it on EVERY type, since meta.ask can
  // override any type's ask.
  if (meta.ask != null && !askShape(meta.ask)) warnings.push('lint: malformed-ask meta');

  if (GATE_TYPES.has(type)) {
    if (!meta.verdict && !meta.subtitle) warnings.push('lint: missing-verdict meta');
    // natural ask source per type, mirroring each template's derivedAsk input
    const naturalAsk = type === 'brief' ? l.win?.next
      : type === 'liveRun' ? l.liveRun
        : l.decision; // planDeck + decisionCard derive from the decision
    if (!askShape(meta.ask) && !naturalAsk) warnings.push('lint: missing-ask meta');
  }

  if (meta.keyStats != null) {
    const n = Array.isArray(meta.keyStats) ? meta.keyStats.length : 0;
    if (n < 3 || n > 5) warnings.push('lint: keystats-count meta');
  }

  return warnings;
}
