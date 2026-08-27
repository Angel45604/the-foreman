# the-foreman ledger schema

The **ledger** is the durable JSON source of truth for a rendered Artifact. The
agent maintains it across a session; `render.mjs` reads it and produces one
self-contained **neumorphic Gate Board** page — a single scrolling verdict-first
HTML file (sticky chapter rail, verdict hero, stat tiles, ask strip, figure-led
units with drawer evidence) — plus a portable Markdown twin. Re-rendering the
same ledger to the same output path overwrites in place, so the published
Artifact keeps the same URL.

## Canonical runtime location

```
~/.claude/the-foreman/<session>/ledger.json     # the durable ledger
~/.claude/the-foreman/<session>/artifact.html   # the rendered, secret-scanned output
```

`<session>` is a short, stable slug for the unit of work (e.g. a feature name or
ticket id). Keeping the ledger + artifact under one per-session directory means a
re-render always targets the same `artifact.html`, which the agent re-publishes
via the `Artifact` tool to the same URL.

## Shape

A ledger is a single JSON object. Every field is optional except `meta.title`;
each template reads only the sections it needs (`planDeck` → `slides`, `brief` →
`win`, `decisionCard` → `decision`, `liveRun` → `liveRun`, and the Phase-3
composites `phaseTracker` → `phaseTracker`, `findings` → `findings`, `comparison`
→ `comparison`, `dashboard` → `dashboard` — see **Artifact types** below).

```jsonc
{
  "meta": {
    "title":   "Cirra run-timing fix",       // REQUIRED — used as <title> and the hero heading
    "crumb":   "GRAVITY · CIRRA",            // top-left breadcrumb chip (default: "THE-FOREMAN · DEV WORKFLOW")
    "favicon": "🛠️",                          // one/two emoji for the browser tab
    "accent":  "#C85C3F",                    // strict 6-hex accent override — see "Accent" below
    "theme":   "auto",                        // 'light' | 'dark' | 'auto' (default 'auto'); auto follows the viewer's OS via prefers-color-scheme, 'light'/'dark' force a theme. Anything else => 'auto'.
    "subtitle":"A gated plan, rendered…",    // legacy lead line — the verdict fallback

    // ---- Gate Board executive summary (all optional; design §4) ----
    "verdict": "4 rounds, all green",        // the hero verdict line (fallback: meta.subtitle)
    "lede":    "Plain-English summary…",     // one summary paragraph under the verdict (fallback: omitted)
    "keyStats": [                             // hero stat tiles — aim for 3–5 (the render lint flags other counts)
      { "value": "420/420", "label": "tests green", "variant": "ok" }        // variant?: ""|"ok"|"warn" colors the value (allowlisted, else bare)
    ],
    "ask": {                                  // the ask strip — the author's intent; see "The effective ask"
      "headline":       "Approve the plan?",
      "note":           "optional one-liner",
      "recommendation": "Option A",
      "recommendedBy":  "Codex"
    }
  },

  // planDeck: one content unit per entry.
  "slides": [
    {
      "kicker":    "PLAN",                   // small uppercase eyebrow
      "statement": "One plain-English takeaway", // the unit headline (fallback: `heading`); keep it ≤ ~12 words, no code tokens
      "heading":   "Exclude human-approval wait", // legacy headline — statement's fallback
      "lead":      "One-sentence context line",   // optional; renders under the statement
      "figure":    { "type": "deltaRow", "items": [ /* … */ ] }, // ONE block as the unit's dominant visual — see "Figures"
      "chapter":   "Discovery",              // optional; groups CONSECUTIVE slides into a rail-addressable chapter section
      "cards":     [ { "title": "Scope", "body": "1 file" } ],   // render as callouts in the drawer (legacy `icon`/`variant` are ignored)
      "bullets":   [ "optional bullet list items" ],             // drawer evidence
      "callout":   "optional emphasized note",                   // drawer evidence
      "blocks":    [ { "type": "table", "columns": ["Col"], "rows": [["cell"]] } ]  // rich content blocks — see "Content blocks"
    }
  ],

  // brief: a win or pause checkpoint.
  "win": {
    "landed":   "Excluded approval wait",    // what changed
    "evidence": "189/189 green",             // the proof
    "verified": true,                        // true => "Win" (green); false => "Pause / not yet verified" (amber)
    "next":     "PR"                         // the ask / next step
  },

  // decisionCard: a fork that needs the owner's call.
  "decision": {
    "question":      "Persist events how?",
    "options":       [ { "label": "A", "pros": "x", "cons": "y", "risk": "low" } ], // risk chip allowlist: low|med|high (else med)
    "recommendation":"A",                    // the recommended option
    "recommendedBy": "Codex"                 // optional attribution
  },

  // liveRun: the pre-live-run gate.
  "liveRun": {
    "what":        "smoke c93",              // what the run does
    "cost":        "$0.12",                  // expected spend
    "blastRadius": "prod write",             // what it touches
    "cleanup":     "purge verified"          // the cleanup proof
  },

  // ---- Phase 3: composite render-only types (each COMPOSES content blocks) ----

  // phaseTracker: a progress strip — the stops track (+ an optional progress dial).
  "phaseTracker": {
    "phases":   [ { "label": "Design", "status": "done", "detail": "6 files touched" } ], // status: done|active|pending; detail → optional muted sub-line under the label
    "progress": { "value": 2, "max": 3, "label": "phases" },                       // optional → a donut (tick-ring dial)
    "note":     "optional emphasized note"                                          // optional → drives the ask
  },

  // findings: a findings table (+ optional sources), summary drives the ask.
  "findings": {
    "items":   [ { "title": "Cache miss", "confidence": "High", "evidence": "log 42", "verdict": "Confirmed" } ],
    "sources": [ { "label": "app.log", "value": "3 hits" } ],   // optional → stat wells + evidence-base chips
    "summary": "optional summary note"                          // optional → drives the ask
  },

  // comparison: an options × criteria table; recommendation drives the ask.
  "comparison": {
    "criteria":       [ "Cost", "Speed" ],                                  // become the table's score columns
    "options":        [ { "label": "Option A", "scores": ["low","fast"], "note": "preferred" } ], // ragged scores normalized; note → optional trailing "Notes" column (added only if ANY option has a note)
    "recommendation": "Option A",                                            // optional → the attributed ask
    "recommendedBy":  "Codex"                                                // optional attribution
  },

  // dashboard: stats (hero tiles) + a chart (passed straight through) + rows.
  "dashboard": {
    "stats": [ { "value": "$0.12", "label": "Spend", "variant": "ok" } ],   // optional → hero stat tiles
    "chart": { "type": "donut", "value": 25, "max": 100, "label": "Used" }, // optional — ANY content-block; unknown type FAILS CLOSED
    "rows":  [ { "label": "Tyler", "value": "$10" } ],                       // optional → a rankedRows block
    "ask":   "optional question"                                            // optional → drives the ask
  }
}
```

## Gate Board anatomy (how the fields land on the page)

Every artifact type renders ONE scrolling page through the same scaffold:

- **Rail** — a sticky chapter navigator. `planDeck` derives one chip per run of
  consecutive `slides[].chapter` values (chapter-less slides fold into a
  `Board` chapter) plus a `Your call` chip when an effective ask exists; the
  seven single-section types render `Top` + exactly one chip (the rail never
  claims structure that isn't there).
- **Hero** — `meta.title`, then the verdict line (`meta.verdict` ??
  `meta.subtitle`), then the optional `meta.lede` paragraph, then the
  `meta.keyStats` tiles.
- **Ask strip** — the effective ask's headline/note/recommendation/attribution
  with a jump link to the ask chapter.
- **Units** — each slide/section renders a plain-`statement` headline
  (fallback: `heading`), an optional `lead` line, ONE dominant **figure**, any
  `pillRow`s visibly, and everything else (bullets, cards, callout, remaining
  blocks) inside a collapsed evidence drawer. Nothing is dropped — the drawer
  and the Markdown twin always carry the full content.

**The effective ask** (design §6): a well-shaped `meta.ask` object is the
author's intent and WINS; anything else (absent, string, number, array) falls
through to the type's derived ask — `planDeck`/`decisionCard` derive from
`decision` (question + recommendation), `brief` from `win.next`, `liveRun`
always asks "Authorize this live run?", `phaseTracker` from `note`, `findings`
from `summary`, `comparison` from `recommendation`, `dashboard` from `ask`.
With no ask source at all, no strip renders (never a dead link). Decision
options always stay visible as evidence; the single recommendation strip
carries the effective ask's recommendation exactly once.

**Figures** (design §4): a unit's dominant visual is its explicit `figure`
block when given; otherwise the FIRST block in `blocks[]` whose type is in the
figure-capable set — `statRow`, `bar`, `donut`, `phaseSteps`, `topo`,
`deltaRow`, `duel`, `verdictFan`, `dotMatrix`, `ladder` — is promoted out of
the drawer; else the unit renders without a figure and the drawer leads.

**Accent** (`meta.accent`): strict `#rrggbb` hex only — anything else is
ignored (no CSS injection). A value equal to a HOUSE DEFAULT — the current
`#5B7CFA` or the retired legacy default, compared numerically and
case-insensitively in `render.mjs` — means "house style": no override is
emitted and the stylesheet's own accent chain governs (light `#5B7CFA`, dark
`#6687FF`). Any OTHER valid hex emits a `--user-ac` override that re-keys the
accent in auto, forced-light, and forced-dark alike.

**Authoring contract** (SKILL.md §4, design §7): statements plain-English and
≤ ~12 words, no `model@effort`/env-var notation in statement or lead; lead ≤ 1
sentence; `keyStats` 3–5; exact figures, paths, shas, and jargon live in
figures and drawers. `render.mjs` runs a NON-FATAL lint over these rules —
violations print rule+location warnings to stderr and the render proceeds.

## Artifact types

Each template is `templates[type](ledger) → { title, favicon, bodyHtml }` and is registered in
`gate-contract.mjs`'s `ARTIFACT_TYPES`. All eight render the Gate Board scaffold. The first four are
also wired into lifecycle transitions; the **Phase-3 four below are render-only composites** — they
build a `blocks[]` array from their typed ledger section and render it via the SAME validated block
builders (`renderBlocks` / `blocksToMarkdown`), so they inherit the blocks' escaping + fail-closed
contract for free. They have no lifecycle transition, so `printable()` surfaces them via a derived
`RENDER TYPES:` catalog line (not the transition table).

- **`planDeck`** ← `ledger.slides`. The full multi-chapter board described above.
- **`brief`** ← `ledger.win`. `landed` visible as the unit callout + a Verified/Claimed pill;
  `evidence` in the drawer; `next` drives the ask.
- **`decisionCard`** ← `ledger.decision`. The ask chapter alone — question visible up top, option
  cards as evidence (gist + allowlisted risk chip visible, verbatim pros/cons collapsed), one
  attributed recommendation strip.
- **`liveRun`** ← `ledger.liveRun`. What / Cost / Blast radius / Cleanup as four VISIBLE callouts
  (gate-critical facts never in a drawer) + keyStats synthesized from cost and blast radius.
- **`phaseTracker`** ← `ledger.phaseTracker`. Composes the **`phaseSteps`** stops track from
  `phases[]` (+ an optional **`donut`** dial from `progress`); `note` → the ask.
- **`findings`** ← `ledger.findings`. Composes a **`table`** (columns `Finding | Confidence | Evidence
  | Verdict`) from `items[]` (+ stat wells and evidence-base chips from `sources`); `summary` → the ask.
- **`comparison`** ← `ledger.comparison`. Composes a **`table`** (columns `Option`, then each
  `criteria` entry, then a trailing `Notes` column iff ANY option carries a `note`) from `options[]`;
  ragged `scores` are normalized by the table block. `recommendation` (+ optional `recommendedBy`) → the ask.
- **`dashboard`** ← `ledger.dashboard`. `stats` → hero tiles; the **`chart`** is passed STRAIGHT
  THROUGH to `renderBlocks` (so an unknown `chart.type` **fails closed** — same contract) + an
  optional **`rankedRows`** from `rows`; `ask` → the ask.

## Legacy presentational fields

Old ledgers may carry `slides[].icon`, `cards[].icon`, and `cards[].variant`
from the retired deck engine's icon sprite. They are accepted and IGNORED —
purely presentational, so nothing fails and no content is lost (cards render
their title + body as drawer callouts). New ledgers should omit them.

## Content blocks (`slides[].blocks[]` / `figure`)

Optional per-unit rich content. Each block is `{ "type": <one of the closed set>, …data }`. The set
is **closed and validated** — an **unknown `type` fails closed**: `render.mjs` throws and writes
NEITHER the HTML nor the Markdown twin (a content block carries data and must never silently vanish —
contrast a legacy *icon* id, which is presentational and is simply ignored). Every block has BOTH an
HTML renderer and a Markdown-twin renderer (parity is oracle-tested in `blocks.test.mjs`).

The closed set is the `BLOCK_TYPES` constant in `blocks.mjs` (oracle-tested). The 17 types, by family:

**Tabular / data**
- **`table`** — `{ "type":"table", "columns":[string], "rows":[[cell,…],…], "caption"?:string }`.
  Native `<table>` semantics in a carved panel; wide tables scroll inside their own container; the
  twin renders a GitHub table (the optional `caption` becomes a bold line above it). Ragged rows are
  normalized — never throws on shape.
- **`rankedRows`** — `{ "type":"rankedRows", "rows":[{ "label":string, "value":string }] }`.
  A label + right-aligned value per row; the twin renders `- **label** — value`.

**Metrics / charts** — every numeric input is coerced + clamped by `safeNum` BEFORE it reaches any
geometry (SVG attribute or CSS custom prop), so a non-finite (`NaN`/`Infinity`, incl. a `1e999`
overflow) or absurd value yields **bounded, inert** output (never `NaN`/`Infinity` in markup). The
only SVG chart left is `lineSpark` — inline only, no
`href`/`xlink:href`/`<image>`/`<use>`/`<foreignObject>`/`url(…)`/external refs.
- **`statRow`** — `{ "type":"statRow", "stats":[{ "value":string, "label":string, "variant"?:""|"ok"|"warn" }] }`.
  A row of carved stat wells (HTML, no SVG); `value` is a pre-formatted display string.
- **`donut`** — `{ "type":"donut", "value":number, "max"?:number=100, "label"?:string }`. The
  tick-ring dial (HTML, no SVG): lit vs unlit ticks around a raised center disc showing the COMPUTED
  value (`pct%` when max is 100, else `value / max`).
- **`bar`** — `{ "type":"bar", "bars":[{ "label":string, "value":number, "tags"?:[{ "label":string, "kind"?:"spawn"|"code" }] }], "max"?:number }`.
  Carved-track wall bars with raised end markers, normalized to `max` (or the largest value);
  displays the `safeNum`'d value. Optional per-bar `tags` render as chips (`kind` is allowlisted —
  anything else falls back to the bare tag); the twin appends ` [tag1, tag2]`.
- **`lineSpark`** — `{ "type":"lineSpark", "points":[number], "label"?:string }`. A sparkline `<polyline>`; 0/1/all-equal points and finite-extreme spans are guarded (no div-by-zero / NaN).

**Process / flow** — `kind`/`status` are strictly allowlisted (anything else → bare / `pending`), never interpolated into a class raw.
- **`flow`** — `{ "type":"flow", "steps":[{ "label":string, "kind"?:""|"gate"|"go" }] }`. A `→`-chained step flow; `gate` chips are red, `go` chips accent.
- **`phaseSteps`** — `{ "type":"phaseSteps", "steps":[{ "label":string, "status"?:"done"|"active"|"pending", "detail"?:string }] }`. The stops track (a native ordered list; vertical spine on mobile, columns wide); the twin renders a `[x]`/`[~]`/`[ ]` checklist. Optional `detail` → a muted sub-line under the label (twin: ` — detail`); absent detail renders byte-identically.

**Code / annotation**
- **`code`** — `{ "type":"code", "code":string, "lang"?:string }`. HTML `<pre><code>` with the body `esc`'d (a `<div>` in code shows as literal text). `lang` is sanitized to alphanumeric.
- **`diff`** — `{ "type":"diff", "lines":[{ "op":"+"|"-"|" ", "text":string }] }`. Add/del/context lines; `op` is allowlisted.
- **`pillRow`** — `{ "type":"pillRow", "pills":[{ "label":string, "variant"?:""|"ok"|"warn" }] }`. A row of status pills (rendered OUTSIDE the drawer when present in `blocks[]`).

**Figures (Gate Board)** — the six figure blocks (design §5), each a distinct information structure
meant to be a unit's dominant visual (any of them also works inside `blocks[]`):
- **`topo`** — `{ "type":"topo", "root":{ "title":string, "note"?:string }, "children":[{ "title":string, "note"?:string }], "aside"?:{ "value":string, "note"?:string } }`.
  A delegation bracket: one root fanning into child cards over engraved arms, with an optional
  aside stat. Twin: bold root, nested child list, bold aside.
- **`deltaRow`** — `{ "type":"deltaRow", "items":[{ "label":string, "from":string, "to":string, "fromPos"?:number, "toPos"?:number, "min"?:string, "max"?:string }] }`.
  Before→after carved tracks. `from`/`to` and `min`/`max` are DISPLAY strings; `fromPos`/`toPos`
  are 0–100 track positions (`safeNum`-clamped; non-finite → 0). Twin:
  `- **label**: from → to (scale min–max)`.
- **`duel`** — `{ "type":"duel", "left":{ "label":string, "value":string, "note"?:string }, "right":{ … }, "flatline"?:{ "label":string, "values":[string] } }`.
  The versus wells (left VS right) with an optional count flatline underneath. Twin:
  `**value** label vs **value** label` + a flatline line.
- **`verdictFan`** — `{ "type":"verdictFan", "verdict":string, "fates":[{ "count":number, "label":string, "variant"?:"ok"|"warn"|"x" }] }`.
  A verdict chip fanning into dot clusters, one per fate (`count` is `safeNum`'d; the dot repetition
  is capped; `variant` is allowlisted, else `x`). Twin: bold verdict + `- count — label` lines.
- **`dotMatrix`** — `{ "type":"dotMatrix", "columns":[string], "rows":[{ "label":string, "sub"?:string, "marks":[boolean] }] }`.
  A recall-style dot matrix with full ARIA table semantics and visually-hidden yes/no per mark.
  Twin: a GitHub table of yes/— marks.
- **`ladder`** — `{ "type":"ladder", "rows":[{ "claim":string, "cause":string, "status"?:"ok"|"mid"|"no", "statusLabel":string }] }`.
  A causal ladder — claim ← cause with an allowlisted status chip (unknown status → `no`; the
  visible text is always the esc'd `statusLabel`). Twin: `- **claim** ← cause — statusLabel`.

**Twin / escaping contract.** Every cell / label / value is neutralized at the block builder — HTML
via `esc`, single-line twin values via `mdEsc` — never interpolated raw. **`code`/`diff` are the one
intentional exception:** their twin bodies are emitted **verbatim inside a dynamic Markdown code fence**
(a backtick run strictly longer than any run in the content, so the content cannot close it; CR
normalized). The body stays raw (so the code reads correctly) but is inert by fence-containment, and
the whole-twin secret scan still covers it. Hence the blanket "no raw HTML tag in the twin" rule
applies to every block EXCEPT a `code`/`diff` fenced body.

## Safety

`render.mjs` HTML-escapes the `<title>`, and the templates escape every
ledger-derived string in the body. The fully rendered HTML is run through
`secret-scan.mjs` **before** any write — if a secret/PII shape is detected,
`render.mjs` throws and writes nothing (authoring-lint warnings are buffered
and print only after both renderings pass the scan). Never paste raw secrets,
customer data, or raw diffs into the ledger; summarize instead.
