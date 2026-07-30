# the-foreman ledger schema

The **ledger** is the durable JSON source of truth for a rendered Artifact. The
agent maintains it across a session; `render.mjs` reads it and produces a
self-contained HTML file. Re-rendering the same ledger to the same output path
overwrites in place, so the published Artifact keeps the same URL.

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
    "title":   "Cirra run-timing fix",      // REQUIRED — used as <title> and the lead heading
    "crumb":   "GRAVITY · CIRRA",            // top-right breadcrumb (default: "MINDCLOUD · DEV WORKFLOW")
    "favicon": "🛠️",                          // one/two emoji for the browser tab
    "accent":  "#009ACC",                    // brand accent (the house style is MindCloud blue)
    "theme":   "auto",                        // 'light' | 'dark' | 'auto' (default 'auto'); auto follows the viewer's OS via prefers-color-scheme, 'light'/'dark' force a theme. Anything else => 'auto'.
    "subtitle":"A gated plan, rendered…"     // optional lead line on the planDeck title slide
  },

  // planDeck: one content slide per entry.
  "slides": [
    {
      "kicker":  "PLAN",                     // small uppercase eyebrow
      "heading": "Exclude human-approval wait",
      "icon":    "i-flag",                   // symbol id from render.mjs SYMBOLS (see below)
      "chapter": "Discovery",                // optional; groups consecutive slides under a named theme in the chapters navigator; tag on 10+ slide decks
      "cards":   [ { "title": "Scope", "body": "1 file", "icon": "i-route", "variant": "" } ],
      "bullets": [ "optional bullet list items" ],
      "callout": "optional emphasized note",
      "blocks":  [ { "type": "table", "columns": ["Col"], "rows": [["cell"]] } ]  // optional rich content blocks — see "Content blocks" below
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
    "options":       [ { "label": "A", "pros": "x", "cons": "y", "risk": "low" } ],
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

  // phaseTracker: a progress strip — phaseSteps (+ an optional progress donut).
  "phaseTracker": {
    "phases":   [ { "label": "Design", "status": "done", "detail": "6 files touched" } ], // status: done|active|pending; detail → optional muted sub-line under the label
    "progress": { "value": 2, "max": 3, "label": "phases" },                       // optional → a donut
    "note":     "optional emphasized note"                                          // optional → a callout
  },

  // findings: a findings table (+ optional sources rankedRows), summary callout.
  "findings": {
    "items":   [ { "title": "Cache miss", "confidence": "High", "evidence": "log 42", "verdict": "Confirmed" } ],
    "sources": [ { "label": "app.log", "value": "3 hits" } ],   // optional → a rankedRows block
    "summary": "optional summary note"                          // optional → a callout
  },

  // comparison: an options × criteria table, recommendation callout.
  "comparison": {
    "criteria":       [ "Cost", "Speed" ],                                  // become the table's score columns
    "options":        [ { "label": "Option A", "scores": ["low","fast"], "note": "preferred" } ], // ragged scores normalized; note → optional trailing "Notes" column (added only if ANY option has a note)
    "recommendation": "Option A",                                            // optional → a callout
    "recommendedBy":  "Codex"                                                // optional attribution
  },

  // dashboard: stats (statRow) + a chart (passed straight through) + rows.
  "dashboard": {
    "stats": [ { "value": "$0.12", "label": "Spend", "variant": "ok" } ],   // optional → a statRow block
    "chart": { "type": "donut", "value": 25, "max": 100, "label": "Used" }, // optional — ANY content-block; unknown type FAILS CLOSED
    "rows":  [ { "label": "Tyler", "value": "$10" } ],                       // optional → a rankedRows block
    "ask":   "optional question"                                            // optional → a callout
  }
}
```

## Artifact types

Each template is `templates[type](ledger) → { title, favicon, bodyHtml }` and is registered in
`gate-contract.mjs`'s `ARTIFACT_TYPES`. The first four are also wired into lifecycle transitions; the
**Phase-3 four below are render-only composites** — thin single-slide decks that build a `blocks[]`
array from their typed ledger section and render it via the SAME validated block builders
(`renderBlocks` / `blocksToMarkdown`), so they inherit the blocks' escaping + fail-closed contract for
free. They have no lifecycle transition, so `printable()` surfaces them via a derived `RENDER TYPES:`
catalog line (not the transition table).

- **`phaseTracker`** ← `ledger.phaseTracker`. Composes a **`phaseSteps`** block from `phases[]` (+ an
  optional **`donut`** from `progress`); `note` → a callout. A phase progress strip.
- **`findings`** ← `ledger.findings`. Composes a **`table`** (columns `Finding | Confidence | Evidence
  | Verdict`) from `items[]` (+ an optional **`rankedRows`** from `sources`); `summary` → a callout.
- **`comparison`** ← `ledger.comparison`. Composes a **`table`** (columns `Option`, then each
  `criteria` entry, then a trailing `Notes` column iff ANY option carries a `note`) from `options[]`;
  ragged `scores` are normalized by the table block. `recommendation` (+ optional `recommendedBy`) → a callout.
- **`dashboard`** ← `ledger.dashboard`. Composes a **`statRow`** from `stats` + a **`chart`** passed
  STRAIGHT THROUGH to `renderBlocks` (so an unknown `chart.type` **fails closed** — same contract) + an
  optional **`rankedRows`** from `rows`; `ask` → a callout.

## Icons (`card.icon` / `slide.icon`)

Symbol ids defined in `render.mjs`'s `SYMBOLS` constant (copied from the approved
plan deck): `i-flag`, `i-list`, `i-warn`, `i-layers`, `i-route`, `i-shield`,
`i-deck`, `i-fork`, `i-check`, `i-cog`. An unknown id renders an empty `<use>`
(no error), so prefer one of these.

## Card variants (`card.variant`)

`""` (neutral) · `"ok"` (green tile) · `"warn"` (red tile). Drives only the
icon-tile color via `style.css`.

## Content blocks (`slides[].blocks[]`)

Optional per-slide rich content, rendered after `cards`/`bullets`/`callout`. Each block is
`{ "type": <one of the closed set>, …data }`. The set is **closed and validated** — an **unknown
`type` fails closed**: `render.mjs` throws and writes NEITHER the HTML nor the Markdown twin (a
content block carries data and must never silently vanish — contrast an unknown *icon* id, which is
presentational and renders empty). Every block has BOTH an HTML renderer and a Markdown-twin renderer
(parity is oracle-tested in `blocks.test.mjs`).

The closed set is the `BLOCK_TYPES` constant in `blocks.mjs` (oracle-tested). The 11 types, by family:

**Tabular / data**
- **`table`** — `{ "type":"table", "columns":[string], "rows":[[cell,…],…], "caption"?:string }`.
  Wide tables scroll inside their own container; the twin renders a GitHub table (the optional
  `caption` becomes a bold line above it). Ragged rows are normalized — never throws on shape.
- **`rankedRows`** — `{ "type":"rankedRows", "rows":[{ "label":string, "value":string }] }`.
  A label + right-aligned value per row; the twin renders `- **label** — value`.

**Metrics / charts** — every numeric input is coerced + clamped by `safeNum` BEFORE it reaches any
SVG geometry/attribute, so a non-finite (`NaN`/`Infinity`, incl. a `1e999` overflow) or absurd value
yields **bounded, inert** output (never `NaN`/`Infinity` in markup). Charts are **inline SVG only** —
no `href`/`xlink:href`/`<image>`/`<use>`/`<foreignObject>`/`url(…)`/external refs.
- **`statRow`** — `{ "type":"statRow", "stats":[{ "value":string, "label":string, "variant"?:""|"ok"|"warn" }] }`.
  A row of big-number stat blocks (HTML, no SVG); `value` is a pre-formatted display string.
- **`donut`** — `{ "type":"donut", "value":number, "max"?:number=100, "label"?:string }`. A progress ring; the centered percentage is computed, not ledger text.
- **`bar`** — `{ "type":"bar", "bars":[{ "label":string, "value":number }], "max"?:number }`. Horizontal bars normalized to `max` (or the largest value); displays the `safeNum`'d value.
- **`lineSpark`** — `{ "type":"lineSpark", "points":[number], "label"?:string }`. A sparkline `<polyline>`; 0/1/all-equal points and finite-extreme spans are guarded (no div-by-zero / NaN).

**Process / flow** — `kind`/`status` are strictly allowlisted (anything else → bare / `pending`), never interpolated into a class raw.
- **`flow`** — `{ "type":"flow", "steps":[{ "label":string, "kind"?:""|"gate"|"go" }] }`. A `→`-chained step flow; `gate` chips are red, `go` chips blue.
- **`phaseSteps`** — `{ "type":"phaseSteps", "steps":[{ "label":string, "status"?:"done"|"active"|"pending", "detail"?:string }] }`. Phase-progression chips; the twin renders a `[x]`/`[~]`/`[ ]` checklist. Optional `detail` → a muted sub-line under the label (twin: ` — detail`); absent detail renders byte-identically.

**Code / annotation**
- **`code`** — `{ "type":"code", "code":string, "lang"?:string }`. HTML `<pre><code>` with the body `esc`'d (a `<div>` in code shows as literal text). `lang` is sanitized to alphanumeric.
- **`diff`** — `{ "type":"diff", "lines":[{ "op":"+"|"-"|" ", "text":string }] }`. Add/del/context lines; `op` is allowlisted.
- **`pillRow`** — `{ "type":"pillRow", "pills":[{ "label":string, "variant"?:""|"ok"|"warn" }] }`. A row of status pills.

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
`render.mjs` throws and writes nothing. Never paste raw secrets, customer data,
or raw diffs into the ledger; summarize instead.
