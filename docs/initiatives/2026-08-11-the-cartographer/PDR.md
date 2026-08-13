# PDR — `the-cartographer`

**Date:** 2026-08-11
**Status:** design approved by owner; implementation plan not yet written
**Branch:** `feat/the-cartographer` (off `origin/main` @ `ac0daf0`)

---

## 1 · Problem

The owner drives many concurrent skills and features and has lost visibility into what each one
actually does under the hood. The stated motivating case: the branches and capabilities of
`codex-gate` are opaque even to its author.

Prose docs do not solve this, for a reason this initiative treats as the central design fact:
**docs drift from code silently.** A scouted inventory of `codex-gate` found four real doc-vs-code
defects, all verified at file:line:

**All line numbers below are in the REPO copy at `plugin/skills/codex-gate/`, at `origin/main` =
`ac0daf0`** — the copy this initiative targets. The personally-installed copy at
`~/.claude/skills/codex-gate/` has drifted from it (locally tuned model and fast-mode config, never
pushed back) and its line numbers are 1–2 higher throughout. Citing the wrong copy would make the §12
acceptance oracle reject a correct extraction, so the copy is named explicitly here and re-verified
before any scoring run.

| # | Defect | Evidence (repo copy @ `ac0daf0`) |
|---|---|---|
| 1 | `CODEX_GATE_MAX_ROUNDS` documented as a default-8 round cap, but referenced **zero times** in the script. The entire round/fix/convergence loop lives in SKILL.md prose executed by the driving agent; the script is a single-shot "one round in, one status out" primitive and `ROUND` is only a filename label. | `codex-gate/SKILL.md:91,190,346` vs `codex-gate.sh` (grep-confirmed absent) |
| 2 | `CODEX_GATE_MAX_FILE_LINES`, `CODEX_HOME_DIR`, `CODEX_GATE_RUNS` implemented and honored, undocumented. | `codex-gate.sh:61`, `:41`, `:42` |
| 3 | User-facing OVERFLOW message names a stale flag `prepr --since-reviewed` that was never shipped; the real mode is the positional `prepr-delta`. | `codex-gate.sh:519` |
| 4 | Comment mislabels `mode_plan` as "DOC tier" though it runs CODE tier in-repo. | `codex-gate.sh:1054` vs `:1089` |

A picture of the system that is *derived from the source* would have surfaced all four.

## 2 · Goal

A skill that produces, for a subject (a skill, a feature, or a codebase subtree), a **highly visual,
at-a-glance page** that a human can read to understand the system's flow, data flow, branches, and
capabilities — and that, **because it is regenerated from source, doubles as an audit** that names
where the documentation and the code disagree.

The owner's selected framing, verbatim: *living reference + drift auditor*. Reinforced mid-design:
*"whatever the output is, it should be highly visual, a way for humans to understand a system / flow /
architecture / feature at a glance."*

**The human deliverable is the visual page.** The Markdown twin is the agent-share and
no-Artifact-host fallback. It must be self-sufficient, but it is not the centre of gravity.

## 3 · Non-goals

- Not a design canvas for live co-editing of a system.
- Not an onboarding narrative with progressive disclosure.
- Not a general-purpose graph-drawing library.
- Not a replacement for `codex-gate` review or for the docs themselves.
- Phase 1 does **not** attempt whole-codebase mapping; see §12.

## 4 · Decision record

The architecture fork was grounded through `codex-gate question` before being put to the owner
(run: `question-DECISION-system-map-skill.md`, outcome **GROUNDED**, `settledByCanon: false`).

Codex's lean, quoted: *"Option A, refined as a standalone spec-first pipeline: generated normalized
map snapshot, Mermaid when Artifact hosting is available, and a mandatory text-first Markdown report.
Defer B/C unless an identically graphical offline view becomes a hard requirement."*

Options assessed and rejected:

- **B — bespoke inline-SVG DAG engine.** Codex: *"a bespoke deterministic layout engine may cost more
  to maintain than the map itself and still be less readable on dense subjects."*
- **C — a `graph` block + `systemMap` type inside the-foreman.** Still requires all of B's layout work,
  then expands three closed contracts (blocks literal-oracle registry, enumerated artifact types,
  required `markdown.mjs` branch). Codex's condition for choosing it — that multiple foreman artifact
  types demonstrably need the same graph primitive — is not met.
- **D — hand-author an Artifact per run.** No evidence snapshot between runs, so neither structural
  change nor doc drift is mechanically computable; forfeits the stated purpose.
- **E — Graphviz/DOT static layout.** Surfaced by Codex as the missing middle path. Rejected on a
  verified prerequisite: `dot` is **not installed** on the owner's machine (`which dot` → not found;
  no graphviz in `brew list`), and the plugin is currently dependency-light (node + `jq`). Recorded as
  the first thing to evaluate if identical offline graphics later become non-negotiable.

**Owner's decision: Option A-refined**, with one addition proposed by Claude (not by Codex) and
approved by the owner — the bounded SVG hero in §6.1, which removes A's known weakness (no picture
without the Artifact host) for the single most important view.

## 5 · Architecture

A three-stage pipeline over one durable spec:

```
SUBJECT  (a skill dir · a feature · a repo subtree)
   │
   ▼  ① EXTRACT   agent-driven, evidence-first, every node cites file:line
map.json ──────── durable, git-diffable IR — the audit snapshot
   │
   ▼  ② DIFF      deterministic, two independent comparisons
drift.json ────── PHANTOM · UNDOCUMENTED · STALE · STRUCTURAL
   │
   ▼  ③ RENDER    deterministic
map.html  →  Artifact  →  stable URL, updates in place
map.md    →  the machine / fallback twin
```

Stage boundaries are strict: **extraction is the only agent-driven stage.** Diff and render are plain
deterministic code, so the audit's verdicts are reproducible and testable.

## 6 · The visual output

Six derived views from one spec (Codex: *"prefer several derived views from one spec — overview,
feature flow, data flow, capability inventory, and drift report — over forcing a 40–80-node subject
into one graph"*). A subject only receives the views it actually has; a skill with no state machine
emits no state-machine view.

| View | Answers | Form |
|---|---|---|
| Overview | "What is this thing?" | **inline SVG hero** (§6.1) |
| Control flow | branches and fan-out | mermaid `flowchart` |
| Data flow | what moves where | mermaid `flowchart` |
| State machine | outcomes + override edges | mermaid `stateDiagram-v2` |
| Capabilities | every mode / flag / knob | HTML table with evidence + doc status |
| Drift | where docs and code disagree | badges on the map + a dedicated findings section |

The first five are entries in `views[]`. **Drift is not a `views[]` entry** — it is derived from
`drift.json` rather than from nodes, and its rows have a different shape from a capability table, so it
renders as a dedicated section above the views. Keeping it out of `views[]` avoids forcing the generic
table renderer to handle two unrelated row shapes.

### 6.1 · The SVG hero (the addition to Codex's Option A)

The Overview is **generated inline SVG**, not mermaid. It is bounded to at most 15 nodes arranged in
fixed lanes (`entry` → `core` → `output`, with an `external` lane), so a simple deterministic lane
layout suffices — rank by lane, order within lane, emit coordinates. This is roughly 100 lines and is
explicitly **not** a general DAG engine; the bound is what makes it tractable.

It follows `artifact-diagramming`'s rules: native shapes plus `<text>`, `viewBox` sizing, theme via
`currentColor`, arrowheads via `<defs><marker>`, no `<script>`/`<style>`/`<foreignObject>` inside the
SVG, labelled edges only.

The payoff: the most important view renders **everywhere** — published Artifact, local `file://`, and
inside a the-foreman deck — with no host dependency. Dense detail views stay mermaid, where mature
auto-layout genuinely earns its keep and host-dependence is acceptable.

If a subject's overview exceeds 15 nodes, the extractor must **collapse to component-level nodes**
rather than overflow the layout; the detailed nodes remain available in the mermaid views.

### 6.2 · Drift renders on the map

Drift is not confined to a table. Node styling encodes drift class directly:

- **PHANTOM** — dashed outline, muted fill: documented but not implemented.
- **UNDOCUMENTED** — solid outline with a badge: implemented but not documented.
- **STALE** — warning accent: both exist and disagree.

On `codex-gate`, `CODEX_GATE_MAX_ROUNDS` appears as a ghost node with no edge into the script — the
defect is visible in the picture, not buried in prose. Mermaid supports this via `classDef`; the SVG
hero via stroke/fill attributes. **Every drift-bearing node appears in at least one graph view**, and
`render.mjs` fails closed when one does not — a finding a reader can meet only in a table has been
hidden from the picture, and the map has quietly become a table with pictures.

#### Attention buckets — how the drift lane is ORDERED (ADR C-017)

Detection stays universal. On the first real subject the drift lane carried 16 findings, 11 of them
UNDOCUMENTED, and most of those landed on internal shell helpers — so the two that mattered were
buried. **Every finding is still computed, still written to `drift.json`, still stated in full in
`map.md`, and still drawn on the diagrams.** What changed is the ORDER a reader meets them in, and
whether one group starts folded.

Scoping the class by kind would have been the shorter fix and is not available: a suppressed
UNDOCUMENTED disappears outright, because PHANTOM is the opposite cell of the same membership grid
and STALE needs an extractor-asserted contradiction record, so no other class can recover it. §8's
model is therefore untouched, and this section is the whole of the answer.

Each finding is assigned an **attention bucket** from **both the node's `kind` and its `lane`** —
never from kind alone, which is not a sound public-contract proxy: lane drives layout and kind
supplies taxonomy, and neither represents documentation obligation. The taxonomy has **no
public-entry-point kind**, so a public function commonly lands under `component`.

- **`likely-contract`** — the subject's advertised surface: `mode`, `flag`, `env` and `outcome` in
  **every** lane, plus `component` in the `entry` lane. Lane may never demote a vocabulary kind;
  doing so would turn a layout decision into a false negative, and both findings the first run
  genuinely wanted are `env` nodes drawn in the `core` lane.
- **`ambiguous-review`** — genuinely uncertain, and therefore **visible by default**. This is where
  everything unjudged lands: the `external` kind in every lane, `artifact` / `component` / `state`
  outside `core`, and any kind, lane or drift class the table has no rule for. An undocumented hard
  prerequisite is the canonical case — `codex-gate` exits 2 when `jq` is absent and documents it
  nowhere, so `jq` surfaces for review rather than being dismissed as "external".
- **`implementation-detail`** — the only collapsible group, and only **three of thirty-two** cells
  reach it: `artifact`, `component` and `state` in the `core` lane, where the kind says
  "implementation noun" and the map's own layout says "internal machinery". It is rendered as a
  native `<details>`, closed — no script, because the page stays self-contained and CSP-safe (§6,
  ADR C-007).

Two invariants make this presentation rather than suppression:

1. **Only `UNDOCUMENTED` can be collapsed.** PHANTOM, STALE and UNVERIFIED all require somebody to
   have WRITTEN a claim, so the subject has already declared the node part of its documented surface;
   UNDOCUMENTED is the only class derived from the ABSENCE of documentation, and so the only one that
   fires mechanically on every internal. A class floor lifts any other class out of the collapsed
   group — which is what keeps the run's most consequential finding, a STALE on
   `component × core`, in front of the reader.
2. **The rule is one exported table**, `references/attention.mjs`, read by both renderers. A bucket
   decided in two places is the two-artifacts-that-must-agree drift this skill exists to detect, one
   level down.

The lane states the RAW count and the per-bucket tally, so a reader can see that nothing was
filtered — only that some of it was folded. `map.md` groups nothing and folds nothing: it is the
self-sufficient report (§12), so the bucket arrives there as one more stated fact per finding.

## 7 · The IR contract (`map.json`)

`map.json` is **generated IR, never hand-edited** (Codex: *"Treat map.json as generated audit/render
IR, not behavioral canon"*). It is a pure, deterministic serialization of one extraction.

```jsonc
{
  "schemaVersion": "1",
  "extractorVersion": "1.0.0",
  "subject": {
    "slug": "codex-gate",
    "kind": "skill",                    // skill | feature | codebase
    "root": "plugin/skills/codex-gate",
    "title": "codex-gate",
    "summary": "one paragraph: what this subject is"
  },
  // line counts verified against the repo copy at ac0daf0 — every citation below must resolve
  // to one of these paths and sit within its line count
  "sources": [
    { "path": "plugin/skills/codex-gate/codex-gate.sh",
      "sha256": "<64 hex>", "lines": 2184, "role": "code" },
    { "path": "plugin/skills/codex-gate/SKILL.md",
      "sha256": "<64 hex>", "lines": 386,  "role": "doc" }
  ],
  "coverage": {
    "read":    ["…"],                   // fully read
    "partial": [ { "path": "…", "why": "…" } ],
    "skipped": [ { "path": "…", "why": "…" } ]
  },
  "nodes": [
    {
      "id": "mode.prepr",               // stable: "<kind>.<slug-of-label>"
      "kind": "mode",                   // mode|flag|env|outcome|artifact|component|external|state
      "label": "prepr",
      "lane": "entry",                  // entry|core|output|external — drives the SVG hero
      "summary": "review the whole base..HEAD diff",
      "evidence": [ { "path": "plugin/skills/codex-gate/codex-gate.sh", "line": 1590,
                      "note": "mode_prepr() { _prepr_common 0 \"$@\"; }" } ],
      "claims":   [ { "path": "plugin/skills/codex-gate/SKILL.md", "line": 40,
                      "text": "prepr [base] [--multi]", "claimKind": "doc" } ],   // doc | code-comment | user-message
      "inferred": false,
      "attrs":    { "default": null }
    }
  ],
  // NOTE: every edge endpoint must be a node id, and a node id's prefix must be a NODE_KINDS
  // value — so the shared helper is component.prepr_common, not fn.prepr_common
  "edges": [
    { "id": "e.control.mode.prepr>component.prepr_common",   // "e.<kind>.<from>><to>"
      "from": "mode.prepr", "to": "component.prepr_common",
      "label": "dispatches", "kind": "control",   // control|data|doc
      "evidence": [ { "path": "plugin/skills/codex-gate/codex-gate.sh", "line": 1590 } ] }
  ],
  "views": [
    { "id": "overview", "form": "svg-hero", "title": "…",
      "nodes": ["…"], "edges": ["…"] },
    { "id": "control-flow", "form": "mermaid", "mermaidType": "flowchart",
      "title": "…", "nodes": ["…"], "edges": ["…"] },
    { "id": "capabilities", "form": "table", "title": "…",
      "columns": ["Capability", "Kind", "Evidence", "Documented"],
      "nodes": ["…"] }
  ]
}
```

`form` is a closed set: `svg-hero` | `mermaid` | `table`. Only `mermaid` views carry `mermaidType`;
only `table` views carry `columns`. **Drift is not in `views[]`** (§6) — it derives from `drift.json`,
not from nodes, and renders as its own section; the only `table` view in Phase 1 is Capabilities.

**Determinism rules** (Codex: *"stable IDs, sorted serialization, source-content digests, and
extractor/schema version, with no observation timestamp churn"*):

1. Object keys serialized in a fixed order; arrays sorted by `id` (`sources` by `path`).
2. **No wall-clock timestamp anywhere in `map.json`.** Generation time is rendered into `map.html` and
   `map.md` only. Without this, every regeneration reports spurious structural drift. **A wall-clock
   timestamp is a date-TIME**, and that is what the serializer fails closed on, in **either
   spelling** — extended (`2026-08-11T13:45`) and basic (`20260811T134500Z`) — because ADR C-003
   prohibits the shape, not one way of writing it. The guard reads the **JSON string tokens** of the
   serialized text, so a number is never a date (`"lines": 20260811` is a count), and within them
   refuses a date immediately followed by a time of day at any precision from the **hour** down
   (`2026-08-11T13Z`, `20260811T13`, `2026-08-11 13:45`, `20260811T134500Z`) — **wherever it appears,
   a path included**: a stamped directory (`logs/20260811T1345/run.json`) is still a stamp, and a
   legitimate dated path written beside a stamp does not launder it.

   A **bare date is NOT a timestamp for this rule and is carried**, in either spelling
   (`2026-08-01`, `20260801`), wherever it appears — as the whole value, as a key, embedded in
   **prose**, and inside a path (`docs/initiatives/2026-08-11-the-cartographer/PDR.md`). *Amended
   2026-08-13, owner-authorized, after the first real subject failed:* the guard originally refused
   bare dates too, and refused the first real map outright — it quotes a README line reading *"…(245
   as of 2026-08-01)"*, verbatim source text the extractor is required to record. A generation stamp
   is always a date-time (`new Date().toISOString()` produces one), while a bare date is ordinary
   source text — a changelog line, a version note, a quoted release line — so refusing it blocked
   legitimate maps and prevented no churn. The bare-date matcher, its 1900–2199 calendar band and the
   path-token carve-out went with the rule, since all three existed only to let bare dates through.

   Deliberately **not** matched either: a precision coarser than a day (`2026-08`, `2026`) and a bare
   time of day (`13:45`) — those are indistinguishable from a version, an id or a duration, and the
   false positives would cost more than a stamp too coarse to churn a same-day regeneration.
3. IDs are derived deterministically from kind + label, never from position or read order.
4. `sha256` per source file is what proves an extraction corresponds to a specific source state.
5. **The IR is plain JSON data, and every tool reads it through one boundary.** `map.json` holds
   `null`, booleans, finite numbers, strings, arrays and plain objects, and nothing else. That is not
   a style rule: a value that clears a check and is then rewritten on the way to disk — an exotic
   object, an accessor, a hidden or inherited field, a hole, `-0` — makes "the map that validated" and
   "the map that was written" two different maps, which is the drift this skill exists to detect,
   turned inward. So the shape is defined once, in `canonical.mjs`, and applied ONCE at ingest by
   every entry point; §7.1 rule 12 states it in full.

**`drift.json` is a derived output, not part of the snapshot.** Intra-run drift is fully derivable
from `map.json` alone (evidence vs claims); keeping it out of the snapshot keeps `map.json` a clean
function of the source, so a doc edit does not perturb the structural diff.

### 7.1 · What `validate.mjs` enforces

ADR C-006 makes `validate.mjs` the one executable source of truth for this contract, which only works
if the human-readable half states the same rules. Beyond the closed sets, required fields and
determinism rules above, a valid `map.json` satisfies:

1. **Path containment.** Every `sources[].path` and every citation `path` is repo-relative,
   normalized, free of `..`, and — after symlink resolution — contained under an **explicitly
   supplied** `repoRoot`. There is no `process.cwd()` fallback: with no root the containment check is
   *skipped and reported as skipped*, never faked.
2. **`.maps/` is excluded**, by the validator and not merely by prose: a subject's own output is not
   evidence about the subject.
3. **Citation provenance.** Every citation resolves to a hashed `sources[]` entry and sits within its
   `lines` count. `evidence` must cite a `role: "code"` source — documentation is not behavioural
   evidence.
4. **`claimKind` ↔ source role.** `claimKind` is required, with no default, and must agree with the
   cited source's role (`doc` ⇒ `role: "doc"`; `code-comment` / `user-message` ⇒ `role: "code"`).
   This is what makes C-014 enforceable rather than advisory.
5. **A contradiction cites the node's own records.** `contradictions[].claim` must match one of that
   node's `claims[]` and `contradictions[].evidence` one of its `evidence[]`, and each must quote
   what it found (`claim.text`, `evidence.note`). A STALE finding assembled from unrelated or
   unquoted citations is unauditable.
6. **Exact id derivation.** `slugify(label)` = lowercase; every run outside `[a-z0-9]` becomes one
   `_`; leading and trailing `_` stripped. Node id = `<kind>.<slugify(label)>` with `kind` equal to
   the node's own kind; edge id = `e.<kind>.<from>><to>`. Two labels slugifying to one id are a
   reported **collision**, never a silent merge.
7. **Graph completeness.** Every edge carries a non-empty `label` and at least one evidence citation,
   and its `from`/`to` are node ids globally — not merely where a view references them. A view may
   not reference an unknown node or edge, nor draw an edge without both endpoints. Every graph view
   carries an `edges` array (possibly empty, never absent), and a view's reference lists are **sets,
   not bags** (rule 14). The **presence** of `edges` is the only part of this that is graph-only:
   a `table` view carries none by contract, so an absent one is legal there — but an `edges` array a
   table view *does* carry is read by exactly the same rules, because what a reference list MEANS
   cannot depend on which renderer happens to consume it. Scoping the whole check to graph views is
   what let a table view name one edge id twice, or name one that resolves to nothing, and still
   validate — while `resolveView`, which reads every form's list alike, refused it. That holds for
   the key's SHAPE as much as for its contents: present and absent are a table view's only two
   options, so **`edges: null` is a violation and not an omission** — the render boundary asks every
   form for an array the moment the key is there. What counts as ABSENT is settled by rule 12, once
   and for every reader: an *inherited* `edges` has no own descriptor, so it is in no copy, no
   renderer ever sees it, and the file will not carry it — that is absent. An *own* `edges: undefined`
   is neither present nor absent but a key that VANISHES on the way to disk, and rule 12 refuses it
   wherever it appears.
8. **Coverage is a partition OF the declared sources — in both directions.** Every path is
   classified exactly once across `read` / `partial` / `skipped`, **and every `sources[]` path is
   classified in one of them**. Checking only that `coverage.read` ⊆ `sources[]` leaves the other
   direction open: a file could be hashed and cited throughout while appearing in no bucket, so the
   rendered coverage section is empty and the map silently claims provenance it never declared —
   the truncation §8.1 guardrail 4 forbids. A `read` path must additionally be hashed in `sources[]`
   (an unhashed read input cannot be freshness-checked, so a changed input still reports fresh);
   `partial` / `skipped` entries must state why.
9. **Nothing derived is embedded.** A `drift` key is rejected **anywhere** in the IR — at the top
   level, on `subject`, on a node, an edge, a view, or at any depth inside `nodes[].attrs`. `drift.json`
   is the one drift representation (C-004); banning the key at a single path leaves every other path
   open, and any of them would serialize into `map.json` as a second verdict that can disagree with
   the derived one and perturbs the structural diff whenever a doc edit changes the finding. An
   `inferred: false` node must carry at least one citation.
10. **Absent collections fail closed.** A missing `sources`, `nodes`, `edges`, `views`, or `coverage`
    bucket is a violation, not an empty default — and `sources` must be non-empty, or freshness would
    verify nothing and report fresh.
11. **`nodes[].attrs` is plain JSON data.** Its ROOT is narrower than its contents: `attrs` is
    **absent, `null`, or a plain object**, because it is a bag of NAMED attributes — §7's example is
    `{ "default": null }` — and a scalar or array root carries no attribute name for any consumer to
    render, diff, or cite. `null` stays legal: it says "no attributes" *in the file*, and the
    serializer writes it unchanged. An own `attrs: undefined` is a violation, not an absent key —
    `JSON.stringify` drops the key, so treating it as absent would let the map that validated differ
    from the map that is written, and rule 12 says the same of every key in the document. INSIDE the
    bag, the IR's one free-form region accepts only `null`, booleans, finite numbers, strings, arrays,
    and plain objects, recursively — which is not an `attrs` rule at all but rule 12's, stated here
    because `attrs` is where a non-JSON value is most likely to enter.
12. **The INGEST BOUNDARY: one definition of a legal map's SHAPE, applied ONCE, at ingest.** Every
    entry point — `validate()`, `computeDrift()`, `resolveView()`/`layoutHero()`, `normalize()`/
    `serialize()` and `checkFreshness()` — reads its input through `canonical.mjs` before anything
    else looks at it. What comes out is inert JSON data: `null`, booleans, finite numbers, strings,
    arrays and plain objects, recursively — **the value `map.json` itself carries**. Every property is
    read exactly once and only from its own *descriptor*, so no extractor code runs and no second read
    can answer differently.

    REFUSED, because the value validated would not be the value written: an **accessor** (re-read by
    whoever uses it, so a getter may hand over something other than what was checked); a
    **symbol-keyed or non-enumerable** own property (invisible to `Object.keys`, dropped by the
    serializer, taking whatever it holds — a timestamp included, C-003 — with it); a **hole** in a
    sparse array (`JSON.stringify` writes `null` where a `forEach` walk saw nothing at all); an own
    property on an array that is not an element — where an **array index** is the ECMAScript one, a
    canonical numeric string at most 2³²−2, so `"4294967295"` and `"1e+21"` are properties and not
    elements (an array serializes its elements only); an **exotic**
    object — `Map`, `Set`, `Date`, any object with internal slots — which `JSON.stringify` empties to
    `{}` or rewrites to a bare string after it has passed every check; a **function**, **symbol**,
    **`BigInt`**, **`NaN`/`Infinity`**; an own property whose value is **`undefined`** (the key
    vanishes on the way to disk, so `attrs: undefined` and `edges: undefined` are one rule, not two);
    and a **cycle**.

    An exotic is recognised from its **internal slots**, never from `Symbol.toStringTag`. That tag is a
    property the value itself controls, so it answered this question wrongly in both directions and ran
    the input's own code doing it: a plain object tagged `"Date"` was refused though the file could
    carry it perfectly, a `Map` retagged `"Object"` — or simply re-prototyped — was accepted and
    rebuilt as `{}` with its payload gone, and reading the tag at all invokes an inherited getter
    inside the boundary that promises no extractor code runs.

    CARRIED THROUGH, because the file can hold it: an **inherited** property is dropped, exactly as
    every copy drops it — it is ABSENT to the validator and to every renderer alike, and whoever
    needed the field reports it missing by name; an own **`__proto__`** key stays own DATA; an object
    that merely CLAIMS an exotic tag while holding no slots is the ordinary object it is; a shared
    (acyclic) sub-object is copied; and **`-0` becomes `0`**, because JSON has no other spelling for
    it, so the snapshot carries the number the file will.

    A refusal names the offending PATH, and the reason is the same sentence whichever entry point
    reports it: `validate()` collects it into `errors`, a consumer throws it. That is what makes
    rule 14's two-way agreement structural rather than a promise maintained by hand — neither artifact
    owns the rule.
13. **Every rule in rule 12 applies ANYWHERE in the IR, not only inside `attrs`.** A cycle, a hole, a
    hidden key or an exotic at the top level, on a node, on a source, on a view, or inside any array is
    reported with the offending path named. Confining these to `attrs` left every other location
    fail-open: the map validated `ok: true` and `serialize()` then died with a `RangeError` raised deep
    inside normalization — exactly the unreadable failure this section promises against — or, quieter,
    wrote data the validator never saw.
14. **A view's reference lists are SETS, not bags — and every renderable-shape rule lives here.**
    `views[].nodes` and `views[].edges` may not name the same id twice, in a `table` view as much as
    a graph one. One id listed twice is one box or one arrow **drawn twice**, and the two renderers
    do not even agree on what that means: the hero refuses the duplicate box while mermaid quietly
    emits the declaration a second time. This rule is stated *and enforced* here for the reason
    C-006 gives — `validate.mjs` is the single executable contract — which generalizes past this one
    rule: **every rule about IR SHAPE that the render boundary enforces is enforced by this
    validator.** So any map `validate()` accepts is renderable, and any map a renderer refuses fails
    `validate()` **for the same stated reason**. The alternative is a validator that blesses maps
    nothing can draw, and a renderer inventing contract rules of its own — the disagreement class
    that produced a finding in each of the first three phases, most recently a repeated view
    reference that `validate()` called legal while `resolveView` threw on it. For the region of the
    contract that is about what a value IS rather than what a list NAMES, rule 12 now makes the
    agreement structural: both sides read the same snapshot, so neither can hold a rule the other
    does not.
15. **The `svg-hero` view is capped at 15 nodes (ADR C-002).** A view with `form: "svg-hero"` may
    reference at most `HERO_MAX_NODES` = 15 nodes; a 16-node overview is a violation, not a large
    picture. The cap is what buys the hero a deterministic lane layout of roughly 100 lines instead
    of a DAG engine, so it is load-bearing rather than cosmetic, and §6.1's remedy is the collapse to
    component-level nodes — **the mermaid views carry no such bound**, so no detail is lost by it.
    This is rule 14's general clause made concrete a second time: the bound was enforced only inside
    `layoutHero`, so a 16-node overview validated `ok: true` and then threw at render — the third
    consecutive phase in which a renderer held a shape rule the contract did not. The number lives in
    `validate.mjs` and the renderer **imports** it; a second copy in the layout would be the same
    two-artifacts-that-must-agree problem this skill exists to detect, one level down.

`validate()` itself never throws; a malformed map — including a cyclic one, an exotic one, or one
behind a hostile `Proxy` — returns `{ ok, errors, warnings, containmentChecked }` so the failure is
readable. It validates the map's CANONICAL form (rule 12): the input is ingested once, and every rule
above is then applied to the snapshot, so "the map that validated" and "the map that is written" name
the same bytes.

## 8 · The drift model

Every node carries `evidence[]` (file:line proving the code does it) and `claims[]` (where it is
asserted to behave that way). A **claim is not always in a doc**: `claimKind` distinguishes `doc`
(SKILL.md, README), `code-comment` (a comment asserting behaviour), and `user-message` (a string the
program prints to a user). Both STALE instances in §1 are of the latter two kinds — a stale user-facing
message at `codex-gate.sh:519` and a mislabelling comment at `:1054` — so a doc-only claim model could
not represent the approved acceptance oracle at all.

Four classes:

| Class | Rule | Comparison | Verified `codex-gate` instance |
|---|---|---|---|
| **PHANTOM** | a `doc` claim exists, `evidence` empty | intra-run | `CODEX_GATE_MAX_ROUNDS` |
| **UNDOCUMENTED** | `evidence` non-empty, no `doc` claim | intra-run | `CODEX_GATE_RUNS`, `CODEX_HOME_DIR`, `CODEX_GATE_MAX_FILE_LINES` |
| **STALE** | both non-empty, but the claim's asserted value contradicts the evidence | intra-run | `--since-reviewed` at `codex-gate.sh:519`; the "DOC tier" comment at `:1054` |
| **STRUCTURAL** | node/edge added, removed, or changed vs the last accepted snapshot | inter-run | — (Phase 2) |

**PHANTOM and UNDOCUMENTED are mechanically derived** by `diff.mjs` from set membership — no judgement
involved, fully testable. **Only `claimKind: "doc"` claims count as documentation** for these two
classes (ADR C-014): a `code-comment` or `user-message` claim is recorded and rendered, and can raise
STALE, but does not make a capability documented. Counting comments as docs would have made
`CODEX_GATE_RUNS` "documented" via the usage header at `codex-gate.sh:6` and destabilised the §12
oracle — and would leave the audit quietest on the subjects that most need it.

**Detection is universal, and stays universal.** UNDOCUMENTED therefore fires on every evidenced,
undocumented internal — which on a real subject is most of the lane. That is a READABILITY problem and
it is answered in §6.2 by presentation (ADR C-017), never by scoping the class: a suppressed
UNDOCUMENTED disappears outright, since PHANTOM is the opposite cell of the same membership grid and
STALE needs a contradiction record, so no other class can recover it.

**STALE is extractor-asserted, not derived.** A contradiction between a documented value and observed
behaviour cannot be computed from set membership. The extractor raises it explicitly by emitting a
`contradiction` record on the node — `{ claim: {path,line,text}, evidence: {path,line,note},
statement: "…" }` — and `diff.mjs` reports STALE **only** where such a record exists, with both
citations rendered. A STALE finding without both citations is a schema violation and fails closed.
This keeps the mechanical classes trustworthy and makes the judgement-based class auditable.

Codex: *"Use both comparisons. Fresh code evidence versus fresh documentation claims finds current
doc-vs-code drift; fresh normalized snapshot versus the previous accepted snapshot explains what
changed."*

### 8.1 · Trust guardrails

These exist so the audit never accuses on a vibe.

1. **Enumerable-first.** The extractor targets mechanically enumerable contracts — modes, commands,
   flags, env vars, outcomes, exit paths, file artifacts, explicit documented claims. Codex: *"Start
   with mechanically enumerable contracts … and mark broader semantic inferences as such."*
2. **`inferred: true` nodes can never raise a drift finding.** Semantic inference is allowed for
   readability (e.g. "this is the orchestrator") but is excluded from the audit.
3. **Unverifiable → `UNVERIFIED`, never a guess.** A claim the extractor could not check is reported
   as uncheckable, visually distinct from a confirmed defect.
4. **Coverage is declared, never silently truncated.** `coverage.partial` / `coverage.skipped` are
   rendered on the page, so a map that read half the source says so.

### 8.2 · Extraction is not byte-deterministic — and what that means

The extractor is agent-driven, so two runs over identical source may word a `summary` differently.
This is a real limitation and the design absorbs it explicitly rather than pretending otherwise:

- **Structural diff compares stable IDs and typed attributes only.** Prose-only changes (`summary`,
  `note`, `text`) are classified `cosmetic` and excluded from the drift verdict by default.
- **The determinism test targets the serializer, not the model:** given the same in-memory map,
  `serialize()` must be byte-identical. That is what guards against timestamp/ordering churn.
- **The extractor is validated against an oracle, not byte-equality** — see §11.

## 9 · Components

| Piece | Kind | Responsibility |
|---|---|---|
| `SKILL.md` | prose | the extraction protocol, the tagging discipline, when to collapse nodes |
| `validate.mjs` | code | the IR contract, enforced — the single source of truth (ADR C-006); no separate schema file ships, because a schema plus a validator is two artifacts that can drift from each other |
| extraction protocol | agent-driven | read source → emit `map.json` with citations |
| `diff.mjs` | code | the four drift classes; emits `drift.json` |
| `attention.mjs` | code | the kind × lane attention table (§6.2, ADR C-017) — PRESENTATION only; the one place a bucket is decided, read by both renderers |
| `canonical.mjs` | code | the shared ingest boundary (§7.1 rule 12) — what a value in the IR may BE, applied once by every entry point |
| `layout.mjs` | code | bounded lane layout for the SVG hero |
| `svg.mjs` / `mermaid.mjs` | code | the two graph emitters — inline SVG hero, mermaid for the detail views |
| `markdown.mjs` | code | the self-sufficient `map.md` report (§12) |
| `freshness.mjs` | code | source digests and line counts — does this snapshot still describe the files on disk? |
| `secret-scan.mjs` | code | the fail-closed secret / PII gate, run over all four artifacts before any write (ADR C-008) |
| `render.mjs` | code | `map.json` + `drift.json` → `map.html` + `map.md` |
| `serialize.mjs` | code | the deterministic serializer (§7) |

House convention: each `*.mjs` ships a colocated `*.test.mjs` run by `node --test` with explicit globs
(Node 22 no longer auto-discovers a bare directory).

## 10 · Placement and outputs

**Skill source:** `plugin/skills/the-cartographer/` in this repo. Codex: *"Place the maintained skill
source under plugin/skills/<name>; use ~/.claude/skills only as the documented mutually exclusive
personal symlink install mode."* The repo README explicitly warns against dual loading.

**Per-subject outputs:** `<subject-repo>/.maps/<slug>/` — with the subject's own repository, not the
install directory (Codex: *"Keep each subject's diffed snapshot with that subject's shared source
repository, not in an install directory"*). Contents: `map.json` (the accepted snapshot, committed),
`drift.json`, `map.html`, `map.md`.

For the first subject, `codex-gate`, that resolves to `.maps/codex-gate/` in this repo.

**Adding the skill to the plugin** also requires refreshing, per the repo's verified conventions:
`README.md` (repo-layout tree, slash-form list, the `for s in …` symlink loop, bundled-skills bullets,
and an explicit `node --test` glob line), the `description` prose in `.claude-plugin/marketplace.json`
and `plugin/.claude-plugin/plugin.json`, and an appended ADR in
`plugin/skills/the-foreman/references/decisions.md`. Neither manifest has a `skills` array — skills are
auto-discovered — so no manifest list needs a new entry. There is no CI in this repo.

## 11 · Error handling and degradation

| Condition | Behaviour |
|---|---|
| `Artifact` tool absent | Open `map.html` locally and state the path. The SVG hero, every table, and the drift lane still render; only the mermaid views degrade to text. Never treated as a blocker. |
| Claim not checkable | `UNVERIFIED` — visually distinct from a confirmed defect. Never guessed. |
| Subject exceeds budget | Declare `coverage.partial` / `coverage.skipped` with reasons and render them. Never silently truncate. |
| Overview > 15 nodes | Collapse to component-level nodes for the hero; detail stays in the mermaid views. |
| Schema validation fails | Fail closed before render; emit the validation error. No partial page. |
| Secret / PII in output | Fail closed before write, reusing the-foreman's `secret-scan.mjs` pattern. Note its email rule rejects any email-shaped string, so code ownership must be represented as handles, not addresses. |

## 12 · Testing

- **Golden-file tests.** A small synthetic fixture subject with a committed expected `map.json`,
  `drift.json`, `map.md`. This tests `diff.mjs` / `render.mjs` / `serialize.mjs` deterministically
  without invoking a model.
- **Drift-class tests.** Mutate the fixture — plant an undocumented env var, plant a phantom doc
  claim, plant a contradicting claim — and assert exactly the expected class fires, and that no
  finding fires for `inferred: true` nodes.
- **Determinism test.** `serialize()` on the same in-memory map twice → byte-identical output; assert
  no wall-clock string appears in `map.json`.
- **Acceptance oracle (the real one).** Run the extractor against `codex-gate` and assert it
  independently rediscovers the four defect groups in §1 — **six findings total**: one PHANTOM
  (`CODEX_GATE_MAX_ROUNDS`), three UNDOCUMENTED (`CODEX_GATE_RUNS`, `CODEX_HOME_DIR`,
  `CODEX_GATE_MAX_FILE_LINES`), and two STALE (`:519`, `:1054`). These were found by an independent
  scout before the extractor existed, so they are a genuine held-out oracle. Phase 1 ships only if all
  six are rediscovered without being fed the answers.
- **Reconstruction test** (Codex's condition): *"an agent receiving only the Markdown should be able to
  reconstruct nodes, edges, capabilities, evidence, claims, and current drift without rendering
  Mermaid."* Implemented as a subagent check against `map.md` alone, plus a mechanical **round-trip**
  test: every source-derived string in `map.md` is rendered as an **inline code span**, and
  `recoverText` in `markdown.mjs` is its exact inverse, so a corpus of hostile and exotic strings must
  come back out of the rendered report byte for byte. That one mechanism carries both halves of a
  requirement that used to be two fighting ones — Markdown is inert inside a code span (no HTML, no
  link, no image, no fence, and no **bare-URL autolink**, which no escaping table reaches), while the
  text inside it is preserved exactly. The escaping it replaces substituted look-alikes (`<` → `＜`)
  and collapsed whitespace, which made `"<x>"` and `"＜x>"` — and `"a\nb"` and `"a b"` — indistinguishable
  in the output, so the report was not in fact reconstructable. The one character still escaped is `|`
  inside a table row, because GFM splits cells before it parses their contents.

## 13 · Phasing

**Phase 1 — extract + render + intra-run drift.** The three intra-run classes, all six views, the SVG
hero, both outputs. First and only subject: `codex-gate`, scored against the §12 oracle. Useful
standalone: it answers the original question ("what does `/codex-gate` actually do?") on its own.

**Phase 2 — structural drift.** Snapshot-vs-snapshot comparison, the `cosmetic` classification of
prose-only changes, and the "what changed since last time" lane.

**Phase 3 — additional subject kinds.** `feature` and `codebase` subtrees, once the skill has proven
itself on skills. Whole-repo mapping is explicitly out of scope until Phase 3 is scoped on its own.

## 14 · Risks

| Risk | Mitigation |
|---|---|
| Extraction quality is the whole product; a sloppy extractor produces a confident, wrong map. | The §12 acceptance oracle is a held-out test, not a self-graded one. `inferred` nodes are barred from the audit. Coverage is declared. |
| `map.json` becomes a second thing to keep in sync — the exact failure this skill exists to prevent. | It is generated, never hand-edited, and carries source digests. A snapshot whose digests do not match the current source is stale by construction and must be regenerated, not patched. |
| The SVG hero's 15-node bound is too small for real subjects. | Collapse-to-component is a required extractor behaviour, not a fallback. If the bound proves wrong in Phase 1 on `codex-gate`, raise it there with measured evidence rather than guessing now. |
| Mermaid views are invisible without the Artifact host. | Accepted and bounded: the hero, all tables, and the drift lane are host-independent. This was the explicit reason for the §6.1 addition. |
| Scope creep into a general diagramming tool. | Non-goals in §3; the layout engine is deliberately bounded and lane-based. |

## 15 · Plan-stage refinements

Each carries a stated default, so the spec is unambiguous if the plan simply adopts it.

1. **Drift palette.** Default: derive the three drift classes from the existing `--warn` / `--err` /
   `--muted` token semantics rather than inventing new hues, expressed as mermaid `classDef` plus
   matching SVG stroke/fill. Revisit only if the three prove indistinguishable in dark theme.
2. **Stylesheet.** Default: `map.html` carries its **own** self-contained token block rather than
   reusing the-foreman's `style.css`. Reuse would be cheaper but would couple a standalone skill's
   output to a sibling skill's stylesheet, and §3 lists independence from the foreman renderer as the
   reason Option C was rejected.
3. **`.maps/` in version control.** Default: **committed**. The accepted snapshot is precisely what
   Phase 2's structural diff compares against, so gitignoring it would disable Phase 2.
