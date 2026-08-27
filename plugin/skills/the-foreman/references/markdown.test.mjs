import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { toMarkdown } from './markdown.mjs';

const META = { title: 'Run-timing fix', crumb: 'GRAVITY · CIRRA', favicon: '🛠️' };

test('toMarkdown returns { title, favicon, markdown } with the title heading + crumb', () => {
  const r = toMarkdown({ meta: META, slides: [] }, 'planDeck');
  assert.equal(r.title, 'Run-timing fix');
  assert.equal(r.favicon, '🛠️');
  assert.match(r.markdown, /^# Run-timing fix$/m);
  assert.match(r.markdown, /^\*GRAVITY · CIRRA\*$/m);
});

test('toMarkdown emits NO HTML tags for any type', () => {
  const ledgers = {
    planDeck: { meta: META, slides: [{ kicker: 'PLAN', heading: 'H', cards: [{ title: 'Scope', body: '1 file' }], bullets: ['b1'], callout: 'note' }] },
    brief: { meta: META, win: { landed: 'x', evidence: 'y', verified: true, next: 'z' } },
    decisionCard: { meta: META, decision: { question: 'q', options: [{ label: 'A', pros: 'p', cons: 'c', risk: 'low' }], recommendation: 'A', recommendedBy: 'Codex' } },
    liveRun: { meta: META, liveRun: { what: 'w', cost: '$1', blastRadius: 'prod', cleanup: 'purged' } },
  };
  for (const [type, ledger] of Object.entries(ledgers)) {
    assert.doesNotMatch(toMarkdown(ledger, type).markdown, /<[a-zA-Z/]/, `${type} contains an HTML tag`);
  }
});

test('toMarkdown planDeck emits subtitle, slide section heading, cards, bullets, callout', () => {
  const ledger = {
    meta: { ...META, subtitle: 'A gated plan' },
    slides: [{ kicker: 'PLAN', heading: 'Exclude approval wait', cards: [{ title: 'Scope', body: '1 file' }], bullets: ['ships clean'], callout: 'render-then-ask' }],
  };
  const md = toMarkdown(ledger, 'planDeck').markdown;
  assert.match(md, /^\*\*A gated plan\*\*$/m); // the verdict line falls back to meta.subtitle, bold
  assert.match(md, /^## PLAN — Exclude approval wait$/m);
  assert.match(md, /^- \*\*Scope:\*\* 1 file$/m);
  assert.match(md, /^- ships clean$/m);
  assert.match(md, /^> render-then-ask$/m);
});

test('toMarkdown planDeck is null-safe with missing arrays/fields', () => {
  const md = toMarkdown({ meta: META }, 'planDeck').markdown;
  assert.match(md, /^# Run-timing fix$/m);
});

test('toMarkdown brief shows Verified status + fields', () => {
  const md = toMarkdown({ meta: META, win: { landed: 'Excluded wait', evidence: '189/189 green', verified: true, next: 'PR' } }, 'brief').markdown;
  assert.match(md, /\*\*Status:\*\* Verified ✅/);
  assert.match(md, /\*\*What landed:\*\* Excluded wait/);
  assert.match(md, /\*\*Evidence:\*\* 189\/189 green/);
  assert.match(md, /^> \*\*The ask:\*\* PR$/m); // win.next drives the effective ask (shared askToMarkdown)
});

test('toMarkdown brief shows Claimed status when not verified', () => {
  const md = toMarkdown({ meta: META, win: { landed: 'x', verified: false } }, 'brief').markdown;
  assert.match(md, /\*\*Status:\*\* Claimed \(not yet verified\) ⚠️/);
  assert.doesNotMatch(md, /\*\*Evidence:\*\*/); // empty field skipped
});

test('toMarkdown decisionCard shows decision, options, recommendation + attribution', () => {
  const md = toMarkdown({ meta: META, decision: { question: 'Persist how?', options: [{ label: 'A', pros: 'fast', cons: 'risky', risk: 'low' }], recommendation: 'A', recommendedBy: 'Codex' } }, 'decisionCard').markdown;
  assert.match(md, /\*\*Decision:\*\* Persist how\?/);
  assert.match(md, /^- \*\*Option A\*\* — Pros: fast · Cons: risky · Risk: low$/m);
  // recommendation + attribution serialize EXCLUSIVELY via askToMarkdown (derived ask)
  assert.match(md, /^> \*\*The ask:\*\* Persist how\?$/m);
  assert.match(md, /^> \*\*Recommendation:\*\* A$/m);
  assert.match(md, /^> \(Codex\)$/m);
  assert.equal((md.match(/\*\*Recommendation:\*\*/g) || []).length, 1); // exactly once
});

test('toMarkdown liveRun shows what/cost/cleanup + the authorize ask', () => {
  const md = toMarkdown({ meta: META, liveRun: { what: 'smoke', cost: '$0.12', blastRadius: 'prod write', cleanup: 'purge verified' } }, 'liveRun').markdown;
  assert.match(md, /\*\*What it does:\*\* smoke/);
  assert.match(md, /\*\*Cost \/ blast radius:\*\* \$0\.12 · prod write/);
  assert.match(md, /\*\*Cleanup:\*\* purge verified/);
  assert.match(md, /^> \*\*The ask:\*\* Authorize this live run\?$/m); // the same derived ask the template renders
  assert.match(md, /^> smoke$/m);                                     // note = firstClause(lr.what)
});

test('toMarkdown throws on an unknown type', () => {
  assert.throws(() => toMarkdown({ meta: META }, 'bogus'), /unknown artifact type: bogus/);
});

// ---- HTML-injection safety: the twin must be no weaker than the HTML artifact ----
// (secret-scan does NOT catch HTML injection; mirror templates.test.mjs.)
const INJ = '<img src=x onerror=alert(1)>';

test('planDeck escapes injection in a card body (and kicker/heading/bullet/callout)', () => {
  const md = toMarkdown({
    meta: { ...META, subtitle: INJ },
    slides: [{ kicker: INJ, heading: INJ, cards: [{ title: INJ, body: INJ }], bullets: [INJ], callout: INJ }],
  }, 'planDeck').markdown;
  assert.doesNotMatch(md, /<img src=x onerror/);
  assert.match(md, /&lt;img/);
});

test('planDeck escapes injection in the title + crumb', () => {
  const md = toMarkdown({ meta: { title: INJ, crumb: INJ }, slides: [] }, 'planDeck').markdown;
  assert.doesNotMatch(md, /<img src=x onerror/);
  assert.match(md, /&lt;img/);
});

test('brief escapes injection in win fields', () => {
  const md = toMarkdown({ meta: META, win: { landed: INJ, evidence: INJ, next: INJ, verified: true } }, 'brief').markdown;
  assert.doesNotMatch(md, /<img src=x onerror/);
  assert.match(md, /&lt;img/);
});

test('decisionCard escapes injection in question/options/recommendation', () => {
  const md = toMarkdown({ meta: META, decision: { question: INJ, options: [{ label: INJ, pros: INJ, cons: INJ, risk: INJ }], recommendation: INJ, recommendedBy: INJ } }, 'decisionCard').markdown;
  assert.doesNotMatch(md, /<img src=x onerror/);
  assert.match(md, /&lt;img/);
});

test('liveRun escapes injection in what/cost/blastRadius/cleanup', () => {
  const md = toMarkdown({ meta: META, liveRun: { what: INJ, cost: INJ, blastRadius: INJ, cleanup: INJ } }, 'liveRun').markdown;
  assert.doesNotMatch(md, /<img src=x onerror/);
  assert.match(md, /&lt;img/);
});

// ---- ACTIVE-Markdown injection: ledger values must render as inert plain text ----
// (HTML entity escaping alone leaves image/link/code/heading/list syntax active.)
test('planDeck renders an injected ![image](url) inert (no auto-fetch external ref)', () => {
  const md = toMarkdown({
    meta: META,
    slides: [{ kicker: 'K', heading: 'H', cards: [{ title: 'T', body: '![x](https://attacker.example/p.png)' }], bullets: ['![y](https://attacker.example/q.png)'] }],
  }, 'planDeck').markdown;
  assert.doesNotMatch(md, /!\[x\]\(https:\/\/attacker/); // raw image syntax must be neutralized
  assert.doesNotMatch(md, /!\[y\]\(https:\/\/attacker/);
  assert.match(md, /\\!\\\[x\\\]\\\(/); // escaped form present
  assert.doesNotMatch(md, /<link|<script src=/); // mirrors the HTML "no external refs" guarantee
});

test('planDeck renders an injected [text](url) link inert', () => {
  const md = toMarkdown({ meta: META, slides: [{ kicker: 'K', heading: 'H', cards: [{ title: 'T', body: '[click](https://evil.example)' }] }] }, 'planDeck').markdown;
  assert.doesNotMatch(md, /\[click\]\(https:\/\/evil/); // raw link syntax neutralized
  assert.match(md, /\\\[click\\\]\\\(/);
});

test('brief renders an injected code span inert (backticks escaped)', () => {
  const md = toMarkdown({ meta: META, win: { landed: 'run `rm -rf /` now', verified: true } }, 'brief').markdown;
  assert.doesNotMatch(md, /`rm -rf \/`/); // raw backtick span neutralized
  assert.match(md, /\\`rm -rf/);
});

test('decisionCard renders newline-injected structure inert (no value-spawned heading/list)', () => {
  const md = toMarkdown({ meta: META, decision: { question: 'pick\n## Pwned heading\n- injected item', options: [], recommendation: 'A' } }, 'decisionCard').markdown;
  assert.doesNotMatch(md, /^## Pwned heading$/m); // value cannot start a real heading line
  assert.doesNotMatch(md, /^- injected item$/m);  // value cannot start a real list line
  assert.match(md, /pick .*Pwned heading .*injected item/); // collapsed onto one line, inert
});

test('liveRun renders newline-injected blockquote/structure inert', () => {
  const md = toMarkdown({ meta: META, liveRun: { what: 'ok\n## Pwned\n> spoofed gate', cost: '$1', blastRadius: 'none', cleanup: 'done' } }, 'liveRun').markdown;
  assert.doesNotMatch(md, /^## Pwned$/m);
  assert.doesNotMatch(md, /^> spoofed gate$/m); // the ask note collapses newlines — no value-spawned blockquote line
});

test('lone carriage-return (CR) line breaks are collapsed (no CR-spawned structure)', () => {
  // some Markdown renderers treat a lone \r as a line break — a value must not smuggle one
  const md = toMarkdown({ meta: META, slides: [{ kicker: 'K', heading: 'H', bullets: ['pick\r- injected item\r1. injected ol'] }] }, 'planDeck').markdown;
  assert.doesNotMatch(md, /\r/);                 // no carriage return survives
  assert.doesNotMatch(md, /^- injected item$/m); // value cannot start a real list line via CR
  assert.doesNotMatch(md, /^1\. injected ol$/m);
});

test('a column-1 ledger value (planDeck subtitle) cannot open a list / ordered-list', () => {
  const dash = toMarkdown({ meta: { ...META, subtitle: '- injected item' }, slides: [] }, 'planDeck').markdown;
  assert.doesNotMatch(dash, /^- injected item$/m);  // leading '-' neutralized
  const plus = toMarkdown({ meta: { ...META, subtitle: '+ injected item' }, slides: [] }, 'planDeck').markdown;
  assert.doesNotMatch(plus, /^\+ injected item$/m); // leading '+' neutralized
  const ol = toMarkdown({ meta: { ...META, subtitle: '1. injected ol' }, slides: [] }, 'planDeck').markdown;
  assert.doesNotMatch(ol, /^1\. injected ol$/m);    // leading ordered marker neutralized
});

test('a column-1 value with INDENT cannot open an indented list / code block', () => {
  const indentedList = toMarkdown({ meta: { ...META, subtitle: '   - injected item' }, slides: [] }, 'planDeck').markdown;
  assert.doesNotMatch(indentedList, /^ {0,3}- injected item$/m); // 1-3 space indent neutralized
  const indentedCode = toMarkdown({ meta: { ...META, subtitle: '    codeblock line' }, slides: [] }, 'planDeck').markdown;
  assert.doesNotMatch(indentedCode, /^ {4}codeblock line$/m);    // 4-space indented code block neutralized
});

// ---- per-slide content blocks in the twin (Phase 2a) ----

test('toMarkdown planDeck emits a per-slide table block as a GitHub table', () => {
  const md = toMarkdown({ meta: META, slides: [{ kicker: 'K', heading: 'H', blocks: [
    { type: 'table', columns: ['Name', 'Spend'], rows: [['Tyler', '$10']] },
  ] }] }, 'planDeck').markdown;
  assert.match(md, /^\| Name \| Spend \|$/m);
  assert.match(md, /^\| --- \| --- \|$/m);
  assert.match(md, /^\| Tyler \| \$10 \|$/m);
});

test('toMarkdown planDeck emits a per-slide rankedRows block', () => {
  const md = toMarkdown({ meta: META, slides: [{ kicker: 'K', heading: 'H', blocks: [
    { type: 'rankedRows', rows: [{ label: 'Tyler', value: '$10' }] },
  ] }] }, 'planDeck').markdown;
  assert.match(md, /^- \*\*Tyler\*\* — \$10$/m);
});

test('toMarkdown planDeck twin escapes a block table cell pipe (no column injection)', () => {
  const md = toMarkdown({ meta: META, slides: [{ kicker: 'K', heading: 'H', blocks: [
    { type: 'table', columns: ['C'], rows: [['a|b']] },
  ] }] }, 'planDeck').markdown;
  assert.match(md, /a\\\|b/);
  assert.doesNotMatch(md, /\| a\|b \|/);
});

test('toMarkdown planDeck twin is byte-identical for a block-less slide (omitted vs undefined)', () => {
  const slide = { kicker: 'K', heading: 'H', bullets: ['b1'], callout: 'note' };
  const withKey = toMarkdown({ meta: META, slides: [slide] }, 'planDeck').markdown;
  const withUndef = toMarkdown({ meta: META, slides: [{ ...slide, blocks: undefined }] }, 'planDeck').markdown;
  assert.equal(withKey, withUndef);
});

// ---- Phase 3: the four new types' twins (same blocks[] + head() + note line) ----

test('toMarkdown phaseTracker twin emits the phase checklist + donut + note, no HTML', () => {
  const md = toMarkdown({
    meta: META,
    phaseTracker: {
      phases: [{ label: 'Design', status: 'done' }, { label: 'Build', status: 'active' }],
      progress: { value: 1, max: 2, label: 'phases' },
      note: 'on track',
    },
  }, 'phaseTracker').markdown;
  assert.match(md, /^# Run-timing fix$/m);
  assert.match(md, /^- \[x\] Design$/m);   // phaseSteps twin marker
  assert.match(md, /^- \[~\] Build$/m);
  assert.match(md, /\*\*1 \/ 2\*\* \(50%\) — phases/); // donut twin mirrors the ring display (max is not 100)
  assert.match(md, /^> \*\*The ask:\*\* on track$/m); // pt.note drives the effective ask
  assert.doesNotMatch(md, /<[a-zA-Z/]/);    // NO raw HTML tag
});

test('toMarkdown findings twin emits the finding table + sources + summary, no HTML', () => {
  const md = toMarkdown({
    meta: META,
    findings: {
      items: [{ title: 'Cache miss', confidence: 'High', evidence: 'log 42', verdict: 'Confirmed' }],
      sources: [{ label: 'app.log', value: '3 hits' }],
      summary: 'root cause found',
    },
  }, 'findings').markdown;
  assert.match(md, /^\| Finding \| Confidence \| Evidence \| Verdict \|$/m);
  assert.match(md, /^\| Cache miss \| High \| log 42 \| Confirmed \|$/m);
  assert.match(md, /^- \*\*app\.log\*\* — 3 hits$/m); // rankedRows sources twin
  assert.match(md, /^> \*\*The ask:\*\* root cause found$/m); // f.summary drives the effective ask
  assert.doesNotMatch(md, /<[a-zA-Z/]/);
});

test('toMarkdown comparison twin emits a GitHub table (Option + criteria) + recommendation, no HTML', () => {
  const md = toMarkdown({
    meta: META,
    comparison: {
      criteria: ['Cost', 'Speed'],
      options: [{ label: 'Option A', scores: ['low', 'fast'] }, { label: 'Option B', scores: ['high', 'slow'] }],
      recommendation: 'Option A',
      recommendedBy: 'Codex',
    },
  }, 'comparison').markdown;
  assert.match(md, /^\| Option \| Cost \| Speed \|$/m);
  assert.match(md, /^\| --- \| --- \| --- \|$/m);
  assert.match(md, /^\| Option A \| low \| fast \|$/m);
  // c.recommendation drives the derived ask — serialized only via askToMarkdown
  assert.match(md, /^> \*\*The ask:\*\* Pick an option$/m);
  assert.match(md, /^> \*\*Recommendation:\*\* Option A$/m);
  assert.match(md, /^> \(Codex\)$/m);
  assert.doesNotMatch(md, /<[a-zA-Z/]/);
});

test('toMarkdown dashboard twin emits stats + chart + rows + ask, no HTML', () => {
  const md = toMarkdown({
    meta: META,
    dashboard: {
      stats: [{ value: '$0.12', label: 'Spend', variant: 'ok' }],
      chart: { type: 'donut', value: 25, max: 100, label: 'Used' },
      rows: [{ label: 'Tyler', value: '$10' }],
      ask: 'approve budget?',
    },
  }, 'dashboard').markdown;
  assert.match(md, /^- \*\*\$0\.12\*\* — Spend$/m); // statRow twin
  assert.match(md, /\*\*25%\*\* — Used/);            // donut chart twin
  assert.match(md, /^- \*\*Tyler\*\* — \$10$/m);     // rankedRows twin
  assert.match(md, /^> \*\*The ask:\*\* approve budget\?$/m); // d.ask drives the effective ask
  assert.doesNotMatch(md, /<[a-zA-Z/]/);
});

test('toMarkdown dashboard twin with BOTH meta.keyStats and d.stats keeps both: hero in head, derived in section', () => {
  const md = toMarkdown({
    meta: { ...META, keyStats: [{ value: '9', label: 'hero stat' }], },
    dashboard: {
      stats: [{ value: '$0.12', label: 'Spend' }],
      ask: 'approve budget?',
    },
  }, 'dashboard').markdown;
  assert.match(md, /^- \*\*9\*\* — hero stat$/m);          // hero keyStats serialized in the head…
  assert.match(md, /^- \*\*\$0\.12\*\* — Spend$/m);        // …derived stats within the section
  assert.ok(md.indexOf('hero stat') < md.indexOf('> **The ask:**'), 'keyStats ride the head, before the ask');
  assert.ok(md.indexOf('> **The ask:**') < md.indexOf('$0.12'), 'derived stats ride the section, after the head');
});

test('toMarkdown dashboard twin FAILS CLOSED on an unknown chart type', () => {
  assert.throws(
    () => toMarkdown({ meta: META, dashboard: { chart: { type: 'bogusChart' } } }, 'dashboard'),
    /unknown block type: bogusChart/,
  );
});

// escaping: each new type's twin neutralizes HTML injection in a ledger string.
const INJ3 = '<img src=x onerror=alert(1)>';
test('phaseTracker twin escapes injection in a phase label + note', () => {
  const md = toMarkdown({ meta: META, phaseTracker: { phases: [{ label: INJ3, status: 'done' }], note: INJ3 } }, 'phaseTracker').markdown;
  assert.doesNotMatch(md, /<img src=x onerror/);
  assert.match(md, /&lt;img/);
});
test('findings twin escapes injection in a finding title + summary', () => {
  const md = toMarkdown({ meta: META, findings: { items: [{ title: INJ3, confidence: 'High' }], summary: INJ3 } }, 'findings').markdown;
  assert.doesNotMatch(md, /<img src=x onerror/);
  assert.match(md, /&lt;img/);
});
test('comparison twin escapes injection in an option label + recommendation', () => {
  const md = toMarkdown({ meta: META, comparison: { criteria: ['C'], options: [{ label: INJ3, scores: [INJ3] }], recommendation: INJ3 } }, 'comparison').markdown;
  assert.doesNotMatch(md, /<img src=x onerror/);
  assert.match(md, /&lt;img/);
});
test('comparison twin adds a trailing Notes column when ANY option has a note', () => {
  const md = toMarkdown({
    meta: META,
    comparison: {
      criteria: ['Cost'],
      options: [{ label: 'Option A', scores: ['low'], note: 'preferred' }, { label: 'Option B', scores: ['high'] }],
    },
  }, 'comparison').markdown;
  assert.match(md, /^\| Option \| Cost \| Notes \|$/m);    // Notes header column
  assert.match(md, /^\| Option A \| low \| preferred \|$/m); // A's note cell
  assert.match(md, /^\| Option B \| high \|  \|$/m);         // B has an empty note cell
});
test('comparison twin OMITS the Notes column when no option has a note', () => {
  const md = toMarkdown({
    meta: META,
    comparison: { criteria: ['Cost'], options: [{ label: 'Option A', scores: ['low'] }] },
  }, 'comparison').markdown;
  assert.match(md, /^\| Option \| Cost \|$/m);
  assert.doesNotMatch(md, /Notes/);
});
// twin parity for the ragged-scores + note normalization (same rule as the template)
test('comparison twin with SHORT scores + a note: criteria cells pad empty, the note lands in the Notes column', () => {
  const md = toMarkdown({
    meta: META,
    comparison: { criteria: ['C1', 'C2'], options: [{ label: 'O', scores: ['s1'], note: 'note-a' }] },
  }, 'comparison').markdown;
  assert.match(md, /^\| Option \| C1 \| C2 \| Notes \|$/m);
  assert.match(md, /^\| O \| s1 \|  \| note-a \|$/m);
});
test('comparison twin with OVERLONG scores + a note: extras truncate, the note stays in the Notes column', () => {
  const md = toMarkdown({
    meta: META,
    comparison: { criteria: ['C1'], options: [{ label: 'O', scores: ['s1', 's2-extra', 's3-extra'], note: 'note-a' }] },
  }, 'comparison').markdown;
  assert.match(md, /^\| O \| s1 \| note-a \|$/m);
  assert.doesNotMatch(md, /s2-extra/); // the overflow score never displaces the note
});
test('comparison twin escapes a malicious note (inert)', () => {
  const md = toMarkdown({ meta: META, comparison: { criteria: ['C'], options: [{ label: 'O', scores: ['x'], note: INJ3 }] } }, 'comparison').markdown;
  assert.doesNotMatch(md, /<img src=x onerror/);
  assert.match(md, /&lt;img/);
});
test('dashboard twin escapes injection in a stat value + ask', () => {
  const md = toMarkdown({ meta: META, dashboard: { stats: [{ value: INJ3, label: 'L' }], ask: INJ3 } }, 'dashboard').markdown;
  assert.doesNotMatch(md, /<img src=x onerror/);
  assert.match(md, /&lt;img/);
});

// ---- Task 11: executive summary + statements in the twin (Gate Board parity) ----
// The twin mirrors EVERY content addition the HTML gained (ADR-003 portable-twin
// doctrine): verdict/lede/keyStats in the head, ONE shared effectiveAsk
// (meta.ask ?? derivedAsk — askShape-gated, identical to templates.mjs) serialized
// EXCLUSIVELY by askToMarkdown, figures (explicit once + fallback never twice),
// the planDeck `## Your call` decision chapter, and the evidence-base list.

const REF_LEDGER = JSON.parse(readFileSync(new URL('../../../../docs/initiatives/2026-08-26-neumorphic-gate-board/reference-ledger.json', import.meta.url), 'utf8'));

test('planDeck twin: reference ledger gets executive summary + Your call + evidence base', () => {
  const md = toMarkdown(REF_LEDGER, 'planDeck').markdown;
  assert.match(md, /^\*\*4 rounds, 8-7-8-7 flat\./m);             // verdict line (subtitle fallback), bold
  assert.match(md, /^> \*\*The ask:\*\* Wave 2a/m);               // derived from the decision question
  assert.match(md, /^> \*\*Recommendation:\*\* A — build the manifest, gate the CODE$/m);
  assert.match(md, /^> \(Claude — on the repo/m);                 // attribution line
  assert.match(md, /^## Your call$/m);                            // the decision chapter
  for (const l of ['A — build the manifest, gate the CODE', 'B — fold round 5 and keep gating the plan',
    'C — cut to a spike: manifest with no status contract', 'D — stop Wave 2 here for tonight']) {
    assert.ok(md.includes(`- **Option ${l}**`), l);               // all four options as evidence
  }
  assert.match(md, /^\*\*Evidence base:\*\*$/m);
  assert.match(md, /^- \*\*1,002\*\* — Gate verdict rounds mined$/m);
  assert.equal((md.match(/\*\*Recommendation:\*\*/g) || []).length, 1); // serialized ONCE, by askToMarkdown only
});

test('twin executive summary: verdict, lede, keyStats, meta.ask with recommendation (no note)', () => {
  const md = toMarkdown({
    meta: {
      ...META,
      verdict: 'Ship it tonight',
      lede: 'Plain-English summary.',
      keyStats: [{ value: '12', label: 'files' }, { value: '3', label: 'rounds' }],
      ask: { headline: 'Approve the change?', recommendation: 'Ship it', recommendedBy: 'Claude' },
    },
    slides: [],
  }, 'planDeck').markdown;
  assert.match(md, /^\*\*Ship it tonight\*\*$/m);
  assert.match(md, /^Plain-English summary\.$/m);
  assert.match(md, /^- \*\*12\*\* — files$/m);
  assert.match(md, /^- \*\*3\*\* — rounds$/m);
  assert.match(md, /^> \*\*The ask:\*\* Approve the change\?$/m);
  assert.match(md, /^> \*\*Recommendation:\*\* Ship it$/m);
  assert.match(md, /^> \(Claude\)$/m);
});

test('twin ask fields render independently (attribution without recommendation)', () => {
  const md = toMarkdown({ meta: { ...META, ask: { headline: 'H', recommendedBy: 'Codex' } }, slides: [] }, 'planDeck').markdown;
  assert.match(md, /^> \*\*The ask:\*\* H$/m);
  assert.match(md, /^> \(Codex\)$/m);
  assert.doesNotMatch(md, /\*\*Recommendation:\*\*/);
});

test('twin figures: explicit figure serializes once BEFORE slide content; fallback figure once via blocks', () => {
  const md = toMarkdown({
    meta: META,
    slides: [
      { kicker: 'ONE', heading: 'H1', statement: 'Plain statement wins', lead: 'One-line lead.', bullets: ['b1'],
        figure: { type: 'statRow', stats: [{ value: '42', label: 'explicit-fig' }] } },
      { kicker: 'TWO', heading: 'H2', blocks: [{ type: 'bar', bars: [{ label: 'fallback-fig', value: 2 }] }] },
    ],
  }, 'planDeck').markdown;
  assert.match(md, /^## ONE — Plain statement wins$/m);                       // statement overrides heading
  assert.match(md, /^One-line lead\.$/m);                                     // lead as a paragraph
  assert.equal((md.match(/- \*\*42\*\* — explicit-fig/g) || []).length, 1);   // explicit figure exactly once
  assert.ok(md.indexOf('explicit-fig') < md.indexOf('- b1'));                 // figure BEFORE the slide's other content
  assert.equal((md.match(/- fallback-fig: 2/g) || []).length, 1);             // fallback figure exactly once, never duplicated
});

test('twin conflict (planDeck): meta.ask WINS — one recommendation line, decision rec only inside option evidence', () => {
  const md = toMarkdown({
    meta: { ...META, ask: { headline: 'Owner ask', recommendation: 'Owner rec', recommendedBy: 'Owner' } },
    slides: [{ kicker: 'K', heading: 'H' }],
    decision: {
      question: 'Q?',
      options: [
        { label: 'A — x', pros: 'p', cons: 'c', risk: 'low' },
        { label: 'B — y', pros: 'p2', cons: 'c2', risk: 'high' }],
      recommendation: 'A — x',
      recommendedBy: 'Codex',
    },
  }, 'planDeck').markdown;
  assert.match(md, /^> \*\*The ask:\*\* Owner ask$/m);
  assert.match(md, /^> \*\*Recommendation:\*\* Owner rec$/m);
  assert.match(md, /^> \(Owner\)$/m);
  assert.equal((md.match(/\*\*Recommendation:\*\*/g) || []).length, 1); // exactly one — meta.ask's
  assert.doesNotMatch(md, /Codex/);                                     // the decision's stale attribution nowhere
  assert.match(md, /^## Your call$/m);
  assert.match(md, /^\*\*Decision:\*\* Q\?$/m);                          // the question stays as evidence
  assert.equal((md.match(/A — x/g) || []).length, 1);                    // decision rec text ONLY in its option line
  assert.match(md, /^- \*\*Option A — x\*\* — Pros: p · Cons: c · Risk: low$/m);
});

test('twin conflict (decisionCard): meta.ask overrides the decision ask identically', () => {
  const md = toMarkdown({
    meta: { ...META, ask: { headline: 'Owner ask', recommendation: 'Owner rec' } },
    decision: { question: 'Q?', options: [{ label: 'A', pros: 'p', cons: 'c', risk: 'low' }], recommendation: 'A', recommendedBy: 'Codex' },
  }, 'decisionCard').markdown;
  assert.match(md, /^> \*\*The ask:\*\* Owner ask$/m);
  assert.match(md, /^> \*\*Recommendation:\*\* Owner rec$/m);
  assert.equal((md.match(/\*\*Recommendation:\*\*/g) || []).length, 1);
  assert.doesNotMatch(md, /Codex/);
  assert.match(md, /^\*\*Decision:\*\* Q\?$/m);                          // the options evidence still renders
});

// prepr round 1: the twin's askShape mirror also requires a non-empty string
// headline — {}, {note:'x'} and {headline:''} fall through to the derived ask.
for (const [label, ask] of [['empty object', {}], ['note-only object', { note: 'x' }], ['empty-string headline', { headline: '' }]]) {
  test(`twin askShape parity: ${label} meta.ask falls through to the derived decision ask`, () => {
    const md = toMarkdown({
      meta: { ...META, ask },
      decision: { question: 'Q?', options: [], recommendation: 'A', recommendedBy: 'Codex' },
    }, 'decisionCard').markdown;
    assert.match(md, /^> \*\*The ask:\*\* Q\?$/m);                     // derived from the decision
    assert.match(md, /^> \*\*Recommendation:\*\* A$/m);
    assert.match(md, /^> \(Codex\)$/m);
    assert.doesNotMatch(md, /^> x$/m);                                 // no orphan note line rides along
  });
}

test('twin askShape parity: a malformed meta.ask (plain string) falls through to the derived ask', () => {
  const md = toMarkdown({
    meta: { ...META, ask: 'not an object' },
    decision: { question: 'Q?', options: [], recommendation: 'A', recommendedBy: 'Codex' },
  }, 'decisionCard').markdown;
  assert.match(md, /^> \*\*The ask:\*\* Q\?$/m);                         // derived from the decision
  assert.match(md, /^> \*\*Recommendation:\*\* A$/m);
  assert.match(md, /^> \(Codex\)$/m);
});

// ---- prepr blocker 1: the twin's decisionShape mirror — a malformed decision
// derives NO ask, and an options-less malformed decision serializes NO orphan
// evidence block; options (when present) still serialize so nothing is lost.
for (const [label, decision] of [['empty object', {}], ['array', []],
  ['empty-string question', { question: '' }], ['whitespace question', { question: '  ' }]]) {
  test(`twin decisionShape: ${label} decision derives NO ask and NO empty Decision block`, () => {
    const md = toMarkdown({ meta: META, decision }, 'decisionCard').markdown;
    assert.doesNotMatch(md, /\*\*The ask:\*\*/);             // no derived ask lines
    assert.doesNotMatch(md, /\*\*Recommendation:\*\*/);
    assert.doesNotMatch(md, /\*\*Decision:\*\*/);            // no orphan empty evidence block
  });
  test(`twin decisionShape parity on planDeck: ${label} decision derives NO ask, NO Your call chapter`, () => {
    const md = toMarkdown({ meta: META, slides: [], decision }, 'planDeck').markdown;
    assert.doesNotMatch(md, /\*\*The ask:\*\*/);
    assert.doesNotMatch(md, /^## Your call$/m);
    assert.doesNotMatch(md, /\*\*Decision:\*\*/);
  });
}
test('twin options-only decision (decisionCard): options serialize as evidence, no derived ask', () => {
  const md = toMarkdown({ meta: META,
    decision: { options: [{ label: 'A', pros: 'p', cons: 'c', risk: 'low' }], recommendation: 'A' } }, 'decisionCard').markdown;
  assert.doesNotMatch(md, /\*\*The ask:\*\*/);
  assert.doesNotMatch(md, /\*\*Recommendation:\*\*/);        // rec rides askToMarkdown only — no ask, no line
  assert.match(md, /^- \*\*Option A\*\* — Pros: p · Cons: c · Risk: low$/m); // options kept
});
test('twin options-only decision (planDeck): Decision-headed evidence chapter, never Your call', () => {
  const md = toMarkdown({ meta: META, slides: [],
    decision: { options: [{ label: 'A', pros: 'p', cons: 'c', risk: 'low' }] } }, 'planDeck').markdown;
  assert.doesNotMatch(md, /\*\*The ask:\*\*/);
  assert.doesNotMatch(md, /^## Your call$/m);                // no ask => the chapter keeps a content label
  assert.match(md, /^## Decision$/m);
  assert.match(md, /^- \*\*Option A\*\*/m);
});

test('twin escapes injection in verdict/lede/keyStats/ask fields', () => {
  const md = toMarkdown({
    meta: {
      ...META,
      verdict: INJ,
      lede: INJ,
      keyStats: [{ value: INJ, label: INJ }],
      ask: { headline: INJ, note: INJ, recommendation: INJ, recommendedBy: INJ },
    },
    slides: [],
  }, 'planDeck').markdown;
  assert.doesNotMatch(md, /<img src=x onerror/);
  assert.match(md, /&lt;img/);
});
