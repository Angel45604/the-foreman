# Design: the neumorphic Gate Board artifact engine

Initiative: `2026-08-26-neumorphic-gate-board` · Branch: `feat/neumorphic-gate-board`
Status: **spec for owner review** — approved direction, implementation not started.

## 1. Goal and non-goals

Replace the MindCloud-branded slide-deck artifact engine in
`plugin/skills/the-foreman/references/` with the owner's neumorphic design system and a new
reading model: the **Gate Board** — one scrolling, verdict-first page with poster-grade figures,
an always-visible chapter rail, and zero pagination.

The owner's complaints this design answers, verbatim:

> "Sometimes I don't even read the slides because they have a lot of information or jargon
> that's not that easy to go through."
> "I'd still want a way to quickly jump between sections without having to scroll a bunch."
> "[The poster deck] still suffers from me having to click a bunch to get to the next slide."

**Decision provenance.** Three full mockups (diagram-first deck, single-screen brief,
statement+graphic deck) were built from the real `foreman-gate-nonconvergence` ledger, critiqued,
and reviewed by the owner; a Codex `question` grounding informed the structural choice. The owner
selected a hybrid, built and approved as the **Foreman Gate Board** reference implementation
(artifact `2c16f979`, source mockup `variant-d-hybrid.html`). This spec is that reference,
written as an engine contract.

**Non-goals.** No change to the foreman lifecycle, gate contract, ledger-as-truth doctrine,
fail-closed secret scan, or Markdown-twin principle (ADR-003 invariants all survive). No
interactive runtime beyond the small page script described in §3. No new hosting mechanics.

## 2. Visual system

- **Tokens, verbatim** from the portfolio design system (`@angelm/neumorphic`): light palette on
  bare `:root`; dark is the approved **Blue Graphite** seven-token swap
  (`--bg:#282e39; --tx:#eef2f9; --sb:#9eabba; --sd:#171b24; --sl:#384250; --ac:#6687ff;
  --acq:#9cb2ff`). Derived elevation formulas (`--out/--osm/--ins/--inm`), engraved hairlines
  (`--lineV/--lineH`), `--depth:1` locked.
- **The one rule holds**: every surface is `var(--bg)`; no borders, no second fills, no colored
  dividers; hierarchy by shadow only; raised/carved alternate when nesting; engraved hairlines
  are the only connectors and the only table row separators.
- **Status colors** follow the `--acq` discipline: dot fills (`--ok/--warn/--err`) plus per-theme
  text variants (`--okq/--warnq/--errq`) — darkened on the light fill, lifted on Blue Graphite —
  exactly the values proven in the reference mockup. Shape and position carry state first; color
  confirms it.
- **Typography**: Sora 700–800 display / Nunito Sans 400–800 body — **embedded as data-URI
  `@font-face` woff2 subsets** (the same OFL-licensed latin subsets the portfolio ships), with
  real system fallback stacks. No external font links: ADR-003's self-containment guarantee
  (no external references; identical rendering from `file://`, offline) stays enforced by the
  existing tests. The ~200KB size cost per artifact is accepted.
- **Theming contract** (unchanged mechanics, restated): full light palette on bare `:root`; dark
  under `@media (prefers-color-scheme: dark)` guarded `:root:not([data-theme="light"])`; dark
  again under `:root[data-theme="dark"]`; explicit `body{background:var(--bg);color:var(--tx)}`.
  `render.mjs`'s existing allowlisted `meta.theme` init is untouched.
- **Accent override guard** in `render.mjs` re-keys from `#009ACC` to the new house default
  `#5b7cfa` (strict-hex validation unchanged).

## 3. The Gate Board scaffold (replaces `deck()` + `slide-engine.js`)

One scaffold for all eight artifact types. Structure, top to bottom:

1. **Sticky chapter rail** — carved track pinned to the viewport top; one raised-on-active chip
   per chapter plus `Top` and the final ask chapter; scrollspy (IntersectionObserver, mid-band
   rootMargin) highlights the live chapter; digit keys `1..9` jump to the first nine rail
   entries (chapters beyond nine are reached by rail click — the hint advertises only what
   works), `Home`/`End` to top/ask; below ~700px the rail wraps to a second chip row so every chapter stays one tap away
   on phones; anchor `scroll-margin-top` is measured from the rail's real height by the script
   (CSS fallback for no-JS). Chips derive from the chapters actually present in the ledger.
2. **Verdict hero** — crumb row (+ Expand/Collapse-all, JS-only), title, verdict line,
   plain-English lede.
3. **Stat tiles** — the 3–5 numbers that matter, raised tiles.
4. **Ask strip** — "what is being asked of you" + attributed recommendation + a jump link to the
   ask chapter. Impossible to miss in the first screenful.
5. **Chapters** — each a labeled section of **units**: kicker + plain-English statement headline
   (+ optional one-line lead) + **one dominant figure** (§5) + optional pill row + a collapsed
   native `<details>` **drawer** holding the full evidence (tables, bullets, callouts, nested
   drill-downs). Wide content scrolls in its own `overflow-x:auto` container.
6. **Ask chapter** — the decision rendered as option cards (letter well, risk chip, recommended
   marker, one-line gist, collapsed verbatim pros/cons) + the attributed recommendation strip +
   evidence-base chips.

**Movement contract:** scrolling and one-interaction jumps are the only movements. No pagination
anywhere. The only click-gated content is opt-in depth drawers — never sequential.

**Page script** (~60 lines, replaces `slide-engine.js`): rail scrollspy + jump + keyboard,
measured anchor offsets, expand/collapse-all. Everything else is native: `<details>` drawers,
anchors, smooth scroll (disabled under `prefers-reduced-motion`). **No-JS**: the page reads
top-to-bottom completely; rail anchors still jump; JS-only controls carry a `.jsonly` gate.

## 4. Ledger schema — additive, backward compatible

New **optional** fields; every existing ledger keeps rendering via deterministic fallbacks:

- `meta.verdict` (string) — the hero verdict line. Fallback: `meta.subtitle`.
- `meta.lede` (string) — plain-English summary paragraph. Fallback: omitted.
- `meta.keyStats[]` (`{value,label,variant?}`) — hero tiles. Fallback: omitted.
- `meta.ask` (`{headline, note?, recommendation?, recommendedBy?}`) — the ask strip. Fallback:
  derived where the type has a natural ask (decision question, liveRun gate, win.next);
  omitted otherwise.
- Per slide/unit: `statement` (plain-English headline; fallback `heading`), `lead` (one line;
  fallback none), `figure` (ONE block rendered as the unit's dominant visual; fallback: the unit's first
  block whose type is in the figure-capable set — `statRow`, `bar`, `donut`, `phaseSteps`,
  `topo`, `deltaRow`, `duel`, `verdictFan`, `dotMatrix`, `ladder` — else no figure), existing `blocks[]` render inside the drawer.
- `chapter` keeps its existing grouping meaning; the rail derives from it.

This addresses the Codex-grounded findings directly: the old title-only first slide becomes an
executive gate summary; word caps and jargon rules are authoring-side (§7) so an imperfect
ledger still renders.

## 5. Figure vocabulary (block registry changes)

The Codex grounding argued for semantic skins over new block types; the earlier draft allowed
only `topo`. **The approved Gate Board supersedes that stance knowingly**: its figure vocabulary
is the point of the redesign, and each figure below is a genuinely distinct information
structure. Every block — new or restyled — keeps the registry contract: closed set, unknown type
throws, `esc()` on every string, `safeNum` clamps on every number reaching geometry, co-located
`html()` + `md()` with twin parity.

Restyled (existing types, neumorphic skins, same ledger shape; `bar` gains optional additive
`tags[]` per bar):

| Existing block | Gate Board rendering |
|---|---|
| `statRow` | raised stat tiles / carved stat wells |
| `bar` | carved-track wall bars with raised end markers (+ per-bar tags) |
| `donut` | tick-ring dial (lit vs unlit ticks, raised center disc) |
| `phaseSteps` | stops track (vertical spine mobile, five-column rail ≥900px) |
| `table` | raised rows in a carved panel, engraved separators, own scroll container |
| `pillRow`, `flow`, `rankedRows`, `code`, `diff`, `lineSpark` | reskinned in place |

New block types (each with html+md, tests, numeric guards):

| New block | Shape (informal) | Renders |
|---|---|---|
| `topo` | `{root:{title,note}, children:[{title,note}], aside:{value,note}?}` | delegation bracket with engraved arms |
| `deltaRow` | `{items:[{label, from, to, min, max, fromPos?, toPos?}]}` | before→after carved tracks |
| `duel` | `{left:{label,value,note}, right:{…}, flatline:{label, values[]}?}` | the versus wells + count flatline |
| `verdictFan` | `{verdict, fates:[{count,label,variant}]}` | verdict chip fanning into dot clusters |
| `dotMatrix` | `{columns:[…], rows:[{label, sub?, marks:[bool…]}]}` | recall-style dot matrix |
| `ladder` | `{rows:[{claim, cause, status: ok\|mid\|no, statusLabel}]}` | causal ladder with status chips |

Markdown twins serialize each figure's data faithfully (tables/lists) — collapsed HTML content
is always fully present in the twin, per the existing doctrine.

## 6. Templates

All eight types render into the one scaffold; `deck()` and `slide-engine.js` are deleted.

- `planDeck` → full Gate Board: hero from `meta`, chapters from `slides[]` (each slide one
  unit), ask chapter from `effectiveAsk = meta.ask ?? derived-from-decision` — an explicit
  `meta.ask` is the author's intent and wins; decision options still render as evidence in the
  ask chapter, but the single recommendation strip carries the effective ask's recommendation
  exactly once.
- `brief` → hero + win unit (verified/claimed pills) + ask strip; the win's evidence in a drawer.
- `decisionCard` → hero + ask chapter (option cards + recommendation strip).
- `liveRun` → hero + one unit (what/cost/blast-radius as tiles + drawer) + the live-run gate ask.
- `phaseTracker` → hero + stops figure + note.
- `findings` → hero + `dotMatrix`/`table` figure + sources chips + summary ask.
- `comparison` → hero + table figure + recommendation ask.
- `dashboard` → hero tiles + chart figure + rows + ask.
- Single-section types with one chapter render the rail with `Top` + their ask anchor only
  (the rail never lies about structure that isn't there).

Default crumb becomes `THE-FOREMAN · DEV WORKFLOW`; the planDeck default subtitle loses
"MindCloud deck" phrasing.

## 7. Authoring contract + render lint

- **SKILL.md authoring contract** (hard rules for the agent writing the ledger): statement
  headlines in plain English, ≤ ~12 words, no `model@effort` or env-var notation in a statement
  or lead slot; lead ≤ 1 sentence; `keyStats` 3–5; exact figures, file paths, shas, and jargon
  live in figures and drawers; every unit should carry a figure — when no figure fits (code/diff
  or prose-led evidence), the drawer leads and the statement must carry the takeaway alone.
- **Non-fatal render lint** in `render.mjs`: after template render, before write — checks
  statement length, code-token-in-statement, missing `meta.verdict`+`meta.ask` on gate types,
  keyStats count. Violations print to stderr as warnings; **the render always proceeds** (a
  blocked render must never stall a human gate). The fail-closed secret scan is unchanged and
  still gates all writes.

## 8. Invariants preserved (test-pinned)

- Ledger is the sole source of truth; HTML and Markdown twin both derive from it; both are
  secret-scanned before either write; a dirty render writes neither file.
- `esc()` at every ledger-string interpolation point (existing escaping tests updated to the new
  markup, pinning the same property). `safeNum` for every number reaching geometry.
- Unknown block type throws (never a silent skip). Unknown icon/status/variant falls back
  presentationally, exactly as today.
- Same CLI (`render.mjs <ledgerPath> <type> <outPath>`); same-path re-render keeps the artifact
  URL; `meta.theme` allowlist and strict-hex accent override unchanged (default re-keyed §2).
- Backward compatibility: every pre-existing ledger in `~/.claude/the-foreman/**` renders
  without error under the new engine (fallbacks §4). The templates' byte-identical-blockless
  pin is replaced by a fallback-behavior pin.

## 9. De-brand inventory (this initiative)

`references/style.css` (rewritten), `references/templates.mjs` (+crumb/subtitle defaults),
`references/render.mjs` (accent default, lint), `references/slide-engine.js` (deleted, replaced
by the page script), `references/ledger.schema.md` (new fields + block docs), `SKILL.md`
(§4 artifact-engine language + authoring contract), `evals/evals.json` (expected-output
phrasing: "MindCloud deck/planDeck" → "neumorphic gate board"), repo `README.md`. Historical
records under `docs/initiatives/` are untouched.

## 10. Testing

- Update: `templates.test.mjs`, `render.test.mjs`, `blocks.test.mjs`, `markdown.test.mjs`,
  `slide-engine.test.mjs` (replaced by a page-script test), `contract-drift.test.mjs`.
- New: per-figure block tests (escaping, numeric-guard clamps, twin parity), scaffold tests
  (rail chips derive from chapters; anchors exist for every chip; hero fallbacks), lint tests
  (each rule fires; render still succeeds), back-compat test rendering a corpus of real legacy
  ledgers.
- TDD RED-first per the house rule: every new behavior lands as a failing test first.

## 11. Rollout

1. Implement on `feat/neumorphic-gate-board` (this worktree), phased via the implementation
   plan; full suite green at every phase.
2. Codex-gate review per the standing flow (`bundle` on this initiative, `prepr` before PR).
3. PR to `main`; owner merges.
4. **Installed-skill sync — with reconciliation**: the live `~/.claude/skills/the-foreman/`
   drifted from the repo (`SKILL.md`, `references/lifecycle.md` differ). Before overwriting,
   diff both files and fold any installed-only improvements back into the repo; only then copy
   the skill directory to the install. Never auto-overwrite blind.
5. The three exploration mockups and the Gate Board reference remain in the initiative record
   as design artifacts; the reference mockup's markup/CSS is the implementation's fidelity
   target.
