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

// The SAME decision gate as templates.mjs's decisionShape (mirrored again in
// markdown.mjs): a decision derives an ask ONLY as a non-array object with a
// non-empty string question. Anything else present ({}, an array,
// {question:''}, options with no question) contributes NO derived ask in the
// renderers (its options render as evidence only) — worth a lint line, since
// the author probably meant it to drive the gate.
const decisionShape = (d) => isObj(d) && typeof d.question === 'string' && d.question.trim() !== '';

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

  // present-but-malformed decision (fails decisionShape): the renderers derive
  // NO ask from it — flag it on EVERY type, same posture as malformed-ask.
  if (l.decision != null && !decisionShape(l.decision)) warnings.push('lint: malformed-decision decision');

  if (GATE_TYPES.has(type)) {
    if (!meta.verdict && !meta.subtitle) warnings.push('lint: missing-verdict meta');
    // natural ask source per type, mirroring each template's derivedAsk input —
    // and its GATE: brief's win.next candidate rides the same askShape predicate
    // the renderers apply, so a whitespace / non-string next (which renders NO
    // strip) counts as missing here too, never as present
    const naturalAsk = type === 'brief' ? askShape({ headline: l.win?.next })
      : type === 'liveRun' ? l.liveRun
        : decisionShape(l.decision); // planDeck + decisionCard derive ONLY from a well-shaped decision
    if (!askShape(meta.ask) && !naturalAsk) warnings.push('lint: missing-ask meta');
  }

  if (meta.keyStats != null) {
    const n = Array.isArray(meta.keyStats) ? meta.keyStats.length : 0;
    if (n < 3 || n > 5) warnings.push('lint: keystats-count meta');
  }

  return warnings;
}
