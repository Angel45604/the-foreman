# `the-cartographer` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement
> this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a skill that renders a highly visual, at-a-glance, re-generatable map of a feature,
skill, or codebase — which, because it is derived from source, also audits where docs and code disagree.

**Architecture:** `EXTRACT → map.json → DIFF → RENDER`. Extraction is the only agent-driven stage; diff
and render are deterministic code, so every audit verdict is reproducible and testable. Output is
`map.html` (inline-SVG hero + mermaid detail views + tables + drift lane) and `map.md` (a self-sufficient
text report for agents and for when the Artifact host is absent).

**Tech Stack:** Node 22 ESM, `node:test` + `node:assert/strict`, zero runtime dependencies. Mermaid is
rendered by the Artifact host. Hand-authored inline SVG per `artifact-diagramming`.

**Companion docs:** [PDR.md](./PDR.md) · [ADR.md](./ADR.md) (C-001…C-013).

## How to read this plan (ADR C-013)

This plan states, per task: exact files, exact interface signatures, and **test intent** — each required
behaviour named with the precise condition that must hold. It does **not** ship literal implementation
code.

That is deliberate and was decided by the owner after `codex-gate bundle` returned BLOCK three times
(16 → 18 → 15 blockers, all `agent_fixable`, none decision-class) against a code-complete draft. Round 3
findings were overwhelmingly defects in unwritten code — a fixture path mismatch, a golden file compared
against an injected timestamp, assertions not matching exact error strings, sort tie-breaks, hash-width
collision odds. Each fix was itself new unreviewed code, so the loop did not converge.

**Implementation defects are caught by TDD and the per-phase gates, not by plan review.** Every task is
RED-first: write the failing test, watch it fail, implement minimally, watch it pass. Every phase runs
`codex-gate phase-start` before and `codex-gate phase-review` after. The named test conditions below are
the contract; how they are satisfied is the implementer's business.

## Global Constraints

Every task's requirements implicitly include this section.

- **Node 22+.** Explicit test globs — a bare directory no longer auto-discovers:
  `node --test plugin/skills/the-cartographer/references/*.test.mjs`
- **Zero runtime dependencies.** Node built-ins only. Adding a package requires a new ADR (see C-010,
  where a missing `dot` binary killed an option).
- **Self-contained output.** No external host in `map.html`: no CDN, stylesheet, font, or `fetch`.
  Inline all CSS. Assert it.
- **Every `*.mjs` ships a colocated `*.test.mjs`.**
- **ES modules throughout.**
- **`map.json` never contains a wall-clock timestamp** (ADR C-003), enforced by a serializer guard.
  Generation time appears in `map.html` / `map.md` only.
- **No artifact is written until every artifact is scanned** (ADR C-008). `render` owns writing all four
  outputs so nothing can be written unscanned.
- **`inferred: true` nodes never produce a drift finding** (ADR C-005).
- **Never `git add -A`.** Stage explicit paths.
- **Commits are LOCAL only** unless the owner authorizes otherwise at the plan-approval gate.

## File Structure

Paths relative to repo root `<repo-root>`. Each `*.mjs` has a colocated test.

| File | Responsibility |
|---|---|
| `plugin/skills/the-cartographer/SKILL.md` | Extraction protocol, tagging discipline, collapse rule |
| `references/serialize.mjs` | Total-order normalization + canonical serialization; timestamp guard |
| `references/validate.mjs` | The IR contract, enforced — single source of truth (ADR C-006) |
| `references/freshness.mjs` | Recomputes source digests so a stale snapshot is detectable |
| `references/diff.mjs` | The drift classes → `drift.json` |
| `references/layout.mjs` | Bounded lane layout → node coordinates |
| `references/svg.mjs` | Coordinates → inline SVG hero |
| `references/mermaid.mjs` | A view → mermaid source with drift `classDef`s |
| `references/markdown.mjs` | `map` + `drift` → the self-sufficient `map.md` |
| `references/secret-scan.mjs` | Fail-closed secret/PII scan |
| `references/style.css` | Own light/dark token block (ADR C-007) |
| `references/render.mjs` | Orchestrates, scans, writes all four outputs; CLI |
| `references/fixtures/tiny/` | Real source files the fixture map describes |
| `references/fixtures/tiny.map.json` | Input fixture with planted drift |
| `references/fixtures/golden/` | Committed expected `map.json` / `drift.json` / `map.md` bytes |

---

# PHASE 1 — IR core

## Task 1: Deterministic serializer

**Files:** create `references/serialize.mjs` + `serialize.test.mjs`.

**Interfaces produced:**
- `normalize(map) -> map` — pure; does not mutate input.
- `serialize(map) -> string` — canonical JSON text ending in `\n`; throws on a timestamp.

**Why total ordering matters:** two equivalent extractions differing only in emission order must
serialize identically, or Phase 6's structural diff reports false drift on every regeneration, defeating
ADR C-003.

**Test intent** — each is a required behaviour:

1. Object keys serialize in sorted order; output ends with a newline.
2. `nodes` sort by `id`; `edges` by `id`; `sources` by `path`; `views` by `id`.
3. **Every** semantically unordered nested array sorts too: `view.nodes`, `view.edges`,
   per-node `evidence` / `claims` / `contradictions`, per-edge `evidence`,
   `coverage.read` / `partial` / `skipped`.
4. `view.columns` is presentation order and is **not** sorted.
5. Citations sort by `path`, then **numerically** by `line` (`a.sh:9` before `a.sh:10`), then by a
   tie-breaking key so two records on the same line cannot retain extractor order. Choose a total
   order over the record's full content and assert that two same-path/same-line records with
   different content always sort deterministically.
6. Re-ordering an input's arrays does not change `serialize()` output.
7. `normalize` does not mutate its argument.
8. `serialize` **fails closed** on any ISO-8601-shaped string anywhere in the map.

- [ ] Write the failing tests · [ ] Run, confirm they fail · [ ] Implement minimally · [ ] Run, confirm green
- [ ] **Commit:** `git add plugin/skills/the-cartographer/references/serialize.mjs plugin/skills/the-cartographer/references/serialize.test.mjs && git commit -m "feat(cartographer): deterministic map serializer with timestamp guard"`

## Task 2: IR validator, freshness check, fixture

**Files:** create `references/validate.mjs` + test, `references/freshness.mjs` + test,
`references/fixtures/tiny/{run.sh,SKILL.md}`, `references/fixtures/tiny.map.json`.

**Interfaces produced:**
- `validate(map) -> { ok, errors: string[] }` — never throws, even on malformed nested input.
- `checkFreshness(map, repoRoot) -> { fresh, stale: string[], missing: string[] }`.
- Closed sets exported for reuse: `NODE_KINDS` (`mode|flag|env|outcome|artifact|component|external|state`),
  `LANES` (`entry|core|output|external`), `VIEW_FORMS` (`svg-hero|mermaid|table`),
  `CLAIM_KINDS` (`doc|code-comment|user-message`), `EDGE_KINDS` (`control|data|doc`),
  `SOURCE_ROLES` (`code|doc`), `MERMAID_TYPES` (`flowchart|stateDiagram-v2`).

**The fixture must describe files that actually exist.** Create the tiny source files first, compute
their real SHA-256 digests and line counts with `node:crypto`, and paste those into `sources[]` — never
invent a digest. Fixture citations must point at the real lines in those files; verify each by opening
the file.

**Plant four drift cases** — one per class, plus the second STALE shape below — so downstream tasks
can assert every drift style from the fixture without test-only mutation:

1. a node with a `doc` claim and no evidence ⇒ **PHANTOM**;
2. a node with evidence and no `doc` claim ⇒ **UNDOCUMENTED**;
3. a node with a `doc` claim **and** evidence **and** a `contradictions` record ⇒ **STALE** — this one
   also proves the two families are orthogonal (Task 3 intent 8);
4. a node whose contradiction is raised on a **`code-comment`** (or `user-message`) claim ⇒ **STALE**
   as well. This case is not optional: ADR C-014 removes those kinds from the *documentation* test but
   keeps them **STALE-eligible**, and both real oracle STALE findings are of exactly those kinds. A
   fixture that only ever raises STALE from a `doc` claim would leave the oracle's actual shape untested.

Put every drift-bearing node in the `overview` view so the rendered page exercises PDR §6.2's on-map
drift encoding rather than only the drift table. A final clean node keeps a no-finding case in scope.

**Test intent — `validate`:**

1. The fixture validates with zero errors.
1b. **Top-level required fields**: `schemaVersion` must equal `"1"` and `extractorVersion` must be a
   non-empty string; each is rejected when absent or wrong-typed. `subject` requires non-empty `slug`,
   `root`, `title`, `summary`, and a `kind` in `SUBJECT_KINDS`; each missing field is its own error.
2. **Fails closed on an absent collection**: `sources`, `nodes`, `edges`, `views`, and each of
   `coverage.read` / `partial` / `skipped`. Absent is a violation, not an empty default.
3. Rejects unknown `subject.kind`, node `kind`, node `lane`, `claimKind`, edge `kind`, source `role`,
   view `form`, and `mermaidType` outside the closed set.
4. Requires a full **64-character** hex `sha256` per source (a truncated prefix is not a proof, ADR C-003)
   and an integer `lines`. Rejects duplicate source paths.
5. **Citation provenance:** every `evidence` / `claims` / `contradictions` / edge-evidence citation must
   have a positive integer `line`, a `path` declared in `sources[]`, and a `line` within that source's
   `lines` count. All four citation sites are validated identically.
5b. **Path containment.** Every `sources[].path` and every citation `path` must be **relative,
   normalized, and contained under the repo root**: reject an absolute path, any `..` segment, any
   leading `/` or drive prefix, and any path that resolves (after symlink resolution) outside
   `repoRoot`. Without this, an agent-produced map can point freshness at files outside the subject.
   Also reject any path under `.maps/` — a subject's own output is not evidence about the subject, and
   that exclusion must be **enforced by the validator, not just stated in prose**.
5c. **`claimKind` must agree with the cited source's role** (this is what makes ADR C-014 real rather
   than advisory): a `doc` claim must cite a source with `role: "doc"`; `code-comment` and
   `user-message` claims must cite a source with `role: "code"`. Otherwise an extractor can label a
   code comment `doc` and silently suppress an UNDOCUMENTED finding — defeating C-014 exactly.
5d. **Contradiction citations must be that node's own records.** A `contradictions[].claim` must
   deep-match one of the node's `claims[]` entries, and `contradictions[].evidence` one of its
   `evidence[]` entries. A STALE finding assembled from unrelated citations is unauditable.
6. Requires node `id` shaped `<kind>.<slug>`, non-empty `label`, `summary`, boolean `inferred`, and
   arrays for `evidence` / `claims`. Rejects duplicate node and edge ids.
7. Requires claim `text`; `checked` if present must be boolean.
8. A `contradictions` entry requires **both** citations plus a non-empty `statement` (ADR C-005).
9. Requires edge and view `id`s and view `title`s. Rejects a view referencing an unknown node or edge,
   and an edge whose endpoints the view does not draw (it would render as a dangling line).
10. Requires a `table` view to carry `columns`, and a `mermaid` view to carry `mermaidType`.
11. Requires at least one view with `id: "overview"` and `form: "svg-hero"`, and rejects an empty
    `views` array — a map that renders no picture is not a map.
12. **Never throws**: malformed nested values (a string where an array belongs, `null` entries) return
    errors rather than raising.
13. **Canonical id derivation and collision handling.** Ambiguity here produces false structural drift,
    so specify exactly ONE transformation and test it:
    - `slugify(label)` = lowercase; replace every run of characters outside `[a-z0-9]` with a single
      `_`; strip leading and trailing `_`. (`CODEX_GATE_RUNS` → `codex_gate_runs`; `prepr-delta` →
      `prepr_delta`; `--multi` → `multi`.) Note `prepr-delta` and `prepr_delta` therefore collide by
      design — that is what rule 13c catches.
    - **Node id** = `<kind>.<slugify(label)>`, and `kind` must equal the node's own `kind` field
      (`mode.go` on a node of kind `env` is an error).
    - **Edge id** = `e.<kind>.<from>><to>` — the edge `kind` followed by the two node ids verbatim
      (`e.control.mode.prepr>component.prepr_common`). Reject any other shape. The kind is part of
      the id because the untyped `e.<from>><to>` shape **collides** whenever a `control` and a `data`
      edge join the same pair, silently making a valid graph unrepresentable. It stays unambiguous:
      `kind` is a closed-set token containing no `.`, node ids are `<kind>.<slug>` with the slug in
      `[a-z0-9_]*`, and `>` occurs in neither.
    - Reject duplicate node ids, duplicate edge ids, **and duplicate view ids** — serialization sorts
      views by id, so duplicates make the order (and the bytes) unstable.
13c. Two nodes whose labels slugify to the same id within the same kind are a **collision** and must be
    reported, not silently accepted — otherwise two capabilities merge and one vanishes from the map.
13d. **Graph completeness for the renderer contract.** Every edge requires a non-empty `label` (PDR:
    an unlabelled arrow means "related somehow") and at least one evidence citation. Every edge's
    `from`/`to` must be node ids **globally**, not merely when some view references the edge. Every
    graph view (`svg-hero`, `mermaid`) requires an `edges` array (possibly empty, never absent).
14. **No uncited `inferred: false` node.** A node asserting it is *not* inferred must carry at least one
    `evidence` or `claims` citation. An uncited node claiming to be grounded is exactly the "confident
    wrong map" risk PDR §14 names.
15. Required edge payload: `id`, `from`, `to`, `kind`. Required view payload: `id`, `title`, `form`,
    and a `nodes` array (possibly empty for a `table` view, never absent).

**Test intent — `checkFreshness`:** matching digests ⇒ `fresh`; a changed file ⇒ `stale`; a deleted file
⇒ `missing` (not stale); both reported together when both occur.

**Plus — `lines` must be recomputed, not trusted.** Citation bounds in `validate` compare against
`sources[].lines`, which the *extractor* supplies. Digest checking alone does not protect that number:
`checkFreshness` must also recompute each file's line count and report a mismatch, otherwise a map can
carry a correct hash, inflate `lines`, and cite past end-of-file while passing every check. Assert it:
a map whose digest matches but whose `lines` is inflated is **not** fresh.

- [ ] Create the fixture source files, compute real digests, verify each cited line by opening the file
- [ ] Write the failing tests · [ ] Run, confirm they fail · [ ] Implement minimally · [ ] Run, confirm green
- [ ] **Commit:** `git add plugin/skills/the-cartographer/references/validate.mjs plugin/skills/the-cartographer/references/validate.test.mjs plugin/skills/the-cartographer/references/freshness.mjs plugin/skills/the-cartographer/references/freshness.test.mjs plugin/skills/the-cartographer/references/fixtures && git commit -m "feat(cartographer): fail-closed IR validator, freshness check, golden fixture"`

---

# PHASE 2 — Audit engine

## Task 3: Drift computation

**Files:** create `references/diff.mjs` + test.

**Interfaces produced:** `computeDrift(map) -> { findings }`, where a finding is
`{ class, nodeId, label, detail, citations }` and `class` ∈ `PHANTOM | UNDOCUMENTED | STALE | UNVERIFIED`.

**Test intent:**

**The two families are orthogonal — do not conflate them.** PHANTOM / UNDOCUMENTED / UNVERIFIED are
*set-membership* classes over `doc` claims vs evidence. STALE is *not* a set-membership class: it comes
only from an explicit `contradictions` record. A node can therefore have both a `doc` claim and evidence
— raising no set-membership finding — **and still raise STALE**. Any wording that says "both ⇒ no
finding" full stop is wrong.

1. A `doc` claim exists and `evidence` is empty ⇒ **PHANTOM**.
2. `evidence` non-empty and **no `doc` claim** ⇒ **UNDOCUMENTED**.
3. A `doc` claim plus evidence ⇒ **no set-membership finding** (STALE remains possible, see 7).
4. **Only `claimKind: "doc"` counts as documentation** (ADR C-014). Assert explicitly: a node with
   evidence whose only claim is a `code-comment` (or a `user-message`) is still **UNDOCUMENTED**. This
   is the condition that keeps the acceptance oracle stable — `codex-gate.sh:6` is a usage header
   asserting the env vars, so an all-claims model would silently drop three oracle findings.
5. The fixture yields exactly **four** findings — PHANTOM, UNDOCUMENTED, STALE-from-a-`doc`-claim, and
   STALE-from-a-`code-comment`-claim.
5b. **STALE is claim-kind agnostic.** Assert the fourth case explicitly: a contradiction raised on a
   `code-comment` or `user-message` claim still produces STALE. ADR C-014 narrows only the
   *documentation* test (PHANTOM/UNDOCUMENTED); it does not narrow STALE eligibility, and both real
   oracle STALE findings depend on that.
6. An `inferred: true` node yields **no** finding of any class (ADR C-005) — assert for a node that
   would otherwise be PHANTOM.
7. Claims all carrying `checked: false` ⇒ **UNVERIFIED**, not PHANTOM.
8. **STALE** is raised only from an explicit `contradictions` record, and the finding carries both
   citations. A node with a value mismatch but no contradiction record raises no STALE. Assert STALE
   fires on a node that *also* has a `doc` claim and evidence — proving orthogonality.
9. Findings are sorted deterministically; two runs over the same map produce identical order.

- [ ] Write the failing tests · [ ] Run, confirm they fail · [ ] Implement minimally · [ ] Run, confirm green
- [ ] **Commit:** `git add plugin/skills/the-cartographer/references/diff.mjs plugin/skills/the-cartographer/references/diff.test.mjs && git commit -m "feat(cartographer): drift engine with mechanical and asserted classes"`

---

# PHASE 3 — Visual renderers

## Task 4: Bounded lane layout

**Files:** create `references/layout.mjs` + test.

**Interfaces produced:** `layoutHero(nodes, opts?) -> { width, height, placed }` where `placed` entries
carry `{ id, label, lane, x, y, w, h }`. `opts.maxNodes` defaults to 15. Box dimensions are exported for
`svg.mjs`.

**Test intent:**

1. Lanes become columns in the fixed order `entry → core → output → external` (assert by x-ordering).
2. Nodes in one lane stack vertically without overlapping.
3. Every placed box fits inside the reported `width` / `height`.
4. An empty lane consumes no column.
5. Layout is deterministic for the same input regardless of input order.
6. **Fails closed above the cap** with a message naming the cap and directing the caller to collapse to
   component-level nodes (ADR C-002) — this is what makes the collapse rule enforced, not advisory.

- [ ] Write the failing tests · [ ] Run, confirm they fail · [ ] Implement minimally · [ ] Run, confirm green
- [ ] **Commit:** `git add plugin/skills/the-cartographer/references/layout.mjs plugin/skills/the-cartographer/references/layout.test.mjs && git commit -m "feat(cartographer): bounded lane layout that fails closed above the node cap"`

## Task 5: Inline SVG hero

**Files:** create `references/svg.mjs` + test.

**Interfaces produced:** `renderHero(view, map, findings) -> string` — a `<figure>`-wrapped `<svg>`.
Also exports an HTML escape helper reused by `render.mjs`.

**Test intent:**

1. Emits `<figure>` + `<svg viewBox="0 0 W H">` + `<figcaption>`, with `role="img"` and `aria-label`.
2. Every node in the view is labelled; every edge is drawn with a `<defs><marker>` arrowhead and its
   label (an unlabelled arrow means "related somehow").
3. **Drift is encoded on the map** (PDR §6.2), asserted from the fixture without test-only mutation:
   PHANTOM draws dashed with a muted fill, UNDOCUMENTED is badged, STALE takes the warning accent.
4. Theme-safe: uses `currentColor` and CSS variables; no hardcoded black or white.
5. CSP-safe: no `<script>`, `<style>`, `<foreignObject>`, `<image>`, `xlink:href`, or `http(s)://`.
6. Labels containing `<`, `>`, `&`, `"` are escaped so they cannot form markup.

- [ ] Write the failing tests · [ ] Run, confirm they fail · [ ] Implement minimally · [ ] Run, confirm green
- [ ] **Commit:** `git add plugin/skills/the-cartographer/references/svg.mjs plugin/skills/the-cartographer/references/svg.test.mjs && git commit -m "feat(cartographer): theme-safe inline SVG hero with drift encoded on the map"`

## Task 6: Mermaid view emitter

**Files:** create `references/mermaid.mjs` + test.

**Interfaces produced:** `renderMermaid(view, map, findings) -> string` — bare mermaid source, no fences,
no HTML wrapper. Callers wrap it.

**Test intent:**

1. A `flowchart` view emits flowchart syntax; a `stateDiagram-v2` view emits **state-diagram** syntax
   (state declarations and `A --> B: label`), never flowchart node brackets or `-->|label|`.
2. **Node id sanitisation is injective**: two distinct ids that collapse alike under a naive
   non-alphanumeric→underscore map (e.g. `mode.a-b` and `mode.a_b`) must remain distinct in the output.
   Assert the count of emitted node declarations, not the specific scheme.
3. Characters that terminate mermaid grammar (`[`, `]`, `|`, `{`, `}`, `<`, `>`, `"`) cannot survive in a
   label; a state-diagram transition label cannot contain a newline or a `:`.
4. A `classDef` is emitted for each drift class actually present in the view, and each affected node is
   assigned its class.
5. No `classDef` is emitted when the view has no drift.
6. Output is deterministic.

- [ ] Write the failing tests · [ ] Run, confirm they fail · [ ] Implement minimally · [ ] Run, confirm green
- [ ] **Commit:** `git add plugin/skills/the-cartographer/references/mermaid.mjs plugin/skills/the-cartographer/references/mermaid.test.mjs && git commit -m "feat(cartographer): mermaid view emitter with drift classDefs"`

---

# PHASE 4 — Outputs

## Task 7: The self-sufficient Markdown report

**Files:** create `references/markdown.mjs` + test.

**Interfaces produced:** `toMarkdown(map, findings, opts?) -> string`. `opts.generatedAt` is a display
string rendered into the report only.

This is Codex's hard condition: an agent given **only** `map.md` must reconstruct nodes, edges,
capabilities, evidence, claims and current drift without rendering any mermaid.

**Test intent — completeness:**

1. Contains no raw HTML tag.
2. Every node appears with its `kind`, `lane`, `summary`, and `inferred` status.
3. Every node's `attrs` appear.
4. Evidence appears with its `note`; claims appear with their **`text` and `claimKind`** — a bare
   citation is not enough to reconstruct what was claimed.
5. A claim with `checked: false` is marked as unverified.
6. Contradiction records render with both citations **and** the claim text and evidence note, so a
   reader can reconstruct a STALE finding.
7. Every edge appears as an explicit adjacency line, with its evidence.
8. Every drift finding appears with class and citations; a clean map states plainly that none was found.
9. Mermaid views are emitted as fenced ```mermaid blocks.
10. `coverage` (read count, and every partial/skipped entry with its reason) and every source row with
    its digest are present.

**Test intent — injection safety.** Source-derived text is untrusted. **Every** interpolated
source-derived field must be neutralised — node labels/summaries/ids/attrs, claim text, evidence notes,
citation paths, edge labels, view titles, subject title/summary/root, coverage paths, and source paths:

11. Cannot inject HTML: the literal substring `<img` must not appear in the output when a label contains
    `<img src=x onerror=alert(1)>`. **A backslash escape is not sufficient** — `\<img>` still contains
    `<img`; angle brackets must be neutralised so the substring is gone.
12. Cannot inject an active Markdown link or image.
13. Cannot inject document structure (a heading) or a code fence.
14. Cannot break a table (pipes) or a citation (markdown metacharacters in a path).

- [ ] Write the failing tests · [ ] Run, confirm they fail · [ ] Implement minimally · [ ] Run, confirm green
- [ ] **Commit:** `git add plugin/skills/the-cartographer/references/markdown.mjs plugin/skills/the-cartographer/references/markdown.test.mjs && git commit -m "feat(cartographer): self-sufficient, injection-safe markdown report"`

## Task 8: Secret scan, page assembly, CLI, golden files

**Files:** create `references/secret-scan.mjs` + test, `references/style.css`, `references/render.mjs` +
test, `references/golden.test.mjs`, `references/fixtures/golden/`.

**Interfaces produced:**
- `scan(text) -> { clean, hits }`.
- `renderPage(map, findings, opts?) -> string` (full HTML).
- `render(mapPath, outDir, opts?) -> { htmlPath, mdPath, driftPath, mapOutPath, findings }`.
- CLI: `node render.mjs <map.json> <outDir> [--repo-root <path>]`.

**`repoRoot` derivation must be specified, not assumed.** `sources[].path` entries are relative, so
freshness resolves them against a root — and resolving against an arbitrary `process.cwd()` silently
checks the wrong files (or none). The CLI resolves the root in this fixed precedence, and **always**
passes one to `render`:

1. an explicit `--repo-root <path>` argument;
2. else `git rev-parse --show-toplevel` executed **from the directory containing `<map.json>`** — the
   snapshot lives in the subject's own repo (ADR C-009), so that is the correct anchor;
3. else fail with a clear error naming both options. **Never silently fall back to `process.cwd()`.**

**Test intent — `secret-scan`:** clean text passes; fails closed on AWS keys (incl. session `ASIA`),
Anthropic keys, OpenAI keys **including the modern `sk-proj-` / `sk-svcacct-` prefixes**, GitHub tokens
**and fine-grained `github_pat_`**, Slack tokens, Google API keys, PEM private keys (incl. OPENSSH),
JWTs, DB URLs with credentials, assigned `secret`/`password`/`api_key`/`token` values, **`client_secret`
assignments**, and any email address (ADR C-008 — so code ownership must render as handles). Reports
every distinct pattern that matched, not just the first.

**Test intent — `renderPage`:**

1. Fully self-contained: no `<link>`, no `<script src=>`, no `http(s)://`.
2. Inlines the stylesheet and supports **both** theme carriers: `prefers-color-scheme: dark` and
   `:root[data-theme="dark"|"light"]`.
3. Renders the SVG hero inline and wraps mermaid views in `<pre class="mermaid">` for the Artifact host.
4. Renders the drift lane with **all four** planted findings — and **exactly once**, not duplicated as
   a view (drift is not a `views[]` entry, PDR §6).
4b. **Enforces on-map drift encoding.** `render` throws if any drift-bearing node appears in **no**
   graph view (`svg-hero` or `mermaid`). PDR §6.2 requires the defect to be visible in the picture;
   prose alone in `SKILL.md` cannot guarantee it, and a map whose findings live only in the drift table
   silently degrades to a table-with-pictures. Assert both directions: the fixture passes, and a map
   with a drift node absent from every graph view throws.
5. Renders declared `coverage.partial` / `skipped` with their reasons, and states plainly when neither
   occurred (PDR §8.1 guardrail 4).
6. Wide content (tables, mermaid) scrolls in its own `overflow-x: auto` container.
7. All source-derived text is HTML-escaped.

**Test intent — `render`:**

1. **Renders from normalized order**, not extractor order: rendering a map and its array-shuffled twin
   produces byte-identical HTML, Markdown and drift output. (Normalizing only at serialize time is not
   enough — the page would still draw in extractor order.)
2. Writes **all four** outputs — `map.html`, `map.md`, `drift.json`, `map.json`. `render` owns writing
   the snapshot so no caller can write it unscanned.
3. **Scans every one of the four before writing any of them**; on a hit it throws and **no file exists**.
4. Rejects an invalid map before writing anything.
5. Enforces freshness: a map whose digests (or line counts) no longer match the source throws with a
   regenerate-not-patch message. **Freshness is not optional in the CLI path** — assert that invoking
   the CLI against a modified source fails, and that `--repo-root` and the git-derived root produce the
   same verdict. Any programmatic escape hatch must be explicit, named, and separately tested; assert
   that the CLI never enables it.
6. The **CLI runs when invoked by a relative path and through a symlink** — the documented personal
   install mode is a symlink, and comparing anything less than both-realpathed makes the CLI a silent
   no-op. Assert by executing the CLI as a child process via a relative path.
7. Generation time appears in `map.html` and `map.md` and **never** in `map.json`.

**Test intent — golden files.** Fragment assertions catch content but not churn; golden bytes are what
prove regeneration is stable, which Phase 6's structural diff depends on.

1. Committed golden `map.json`, `drift.json` and `map.md` match byte-for-byte.
2. **The golden comparison must be timestamp-independent.** `render` injects a generation time into
   `map.md`, so either compare with a fixed injected `generatedAt` or normalize the stamp before
   comparing — a golden `map.md` compared against a live clock fails on the next minute boundary.
3. Rendering twice produces byte-identical output.
4. An array-shuffled input serializes identically.
5. No golden file contains a timestamp.

Provide an `UPDATE_GOLDEN=1` regeneration path. **Read each generated golden file before committing it**
— a golden blessed unread only freezes a bug in place.

- [ ] Write the failing tests · [ ] Run, confirm they fail · [ ] Implement minimally · [ ] Run, confirm green
- [ ] Run the full suite twice; confirm identical counts (no order dependence)
- [ ] **Commit:** `git add plugin/skills/the-cartographer/references/secret-scan.mjs plugin/skills/the-cartographer/references/secret-scan.test.mjs plugin/skills/the-cartographer/references/style.css plugin/skills/the-cartographer/references/render.mjs plugin/skills/the-cartographer/references/render.test.mjs plugin/skills/the-cartographer/references/golden.test.mjs plugin/skills/the-cartographer/references/fixtures/golden && git commit -m "feat(cartographer): fail-closed page assembly, stylesheet, CLI and golden files"`

---

# PHASE 5 — Skill, integration, acceptance

## Task 9: Author `SKILL.md`

**Files:** create `plugin/skills/the-cartographer/SKILL.md`. Prose only.

Frontmatter follows the house pattern (`name`, `description`, `allowed-tools`), with a description whose
triggers include "map this", "what does X do under the hood", "I've lost track of this feature",
"diagram this system", "show me the flow", "audit the docs against the code".

The body must cover, in order:

1. **What it produces** and where: `map.json`, `map.html`, `map.md`, `drift.json` in
   `<subject-repo>/.maps/<slug>/` (ADR C-009).
2. **The extraction protocol** — enumerate mechanically enumerable contracts first: modes/commands,
   flags, env vars, outcomes/exit paths, file artifacts, public entry points.
3. **Claims are not always in docs.** Every claim carries `claimKind`: `doc`, `code-comment` (a comment
   asserting behaviour), or `user-message` (a string printed to a user). Searching only docs misses the
   latter two — and a stale error message tells a *user* something false, which is the most damaging
   drift there is. **Only `doc` claims count as documentation** for PHANTOM/UNDOCUMENTED (ADR C-014);
   the other kinds are still recorded, still rendered, and can still raise STALE.

   ⚠️ **Write this section generically.** `SKILL.md` is visible to the extraction worker, and Task 11
   forbids telling that worker which classes or claim kinds to expect. Describe the taxonomy and how to
   search for each kind — never mention the acceptance oracle, the subject `codex-gate`, how many
   findings exist, or which kinds its findings use. A worker that reads "both STALE findings are
   comments and messages" is no longer a held-out evaluation.
4. **Emit the complete IR or the render fails closed** — `schemaVersion`, `extractorVersion`, full
   `subject`, a `sources[]` entry for **every file cited anywhere** with a real 64-char `sha256` and
   `lines` count (compute with `node:crypto`; never invent one), plus `coverage`, `nodes`, `edges`, and
   `views` including a required `overview`.
5. **Tagging discipline** (ADR C-005) — `inferred: true` on anything not directly citable; `checked:
   false` on an unverifiable claim; STALE only via a `contradictions` record with both citations.
6. **Lane assignment** — `entry` / `core` / `output` / `external`.
7. **The collapse rule** (ADR C-002) — `overview` takes ≤15 nodes; above that collapse to
   component-level. Drift-bearing nodes must appear in at least one graph view so defects show in the
   picture (PDR §6.2).
8. **Coverage honesty** — record `partial` / `skipped` with reasons; never silently truncate.
   **Always exclude `.maps/**` from extraction, for every subject.** A subject's own maps are this
   skill's output, not part of the system being mapped — including them would make the tool map itself,
   inflate coverage with derived files, and let a previous run's conclusions re-enter the next run
   disguised as source evidence. This is a general protocol rule, not a per-run instruction.
9. **How to run it** — `node <skill-dir>/references/render.mjs <map.json> <outDir>`, using the same
   `<skill-dir>` resolution paragraph the-foreman's SKILL.md carries (plugin vs personal-symlink
   install). The renderer lives in the installed skill directory, not the subject's repo. Then publish
   `map.html` via the `Artifact` tool (same path → same URL). **If the Artifact tool is absent, state
   the local path — that is normal and never a blocker**: the hero, all tables, the coverage section and
   the drift lane are host-independent; only mermaid views degrade to text.
10. **Agent-to-agent sharing** — hand over `map.md`, never the Artifact URL (owner-private, 403s).

- [ ] Write it · [ ] Verify the frontmatter parses and the skill is discoverable
- [ ] **Commit:** `git add plugin/skills/the-cartographer/SKILL.md && git commit -m "docs(cartographer): extraction protocol and tagging discipline"`

## Task 10: Plugin integration

**Files:** modify `README.md`, `.claude-plugin/marketplace.json`, `plugin/.claude-plugin/plugin.json`.
**Explicitly NOT modified:** `plugin/skills/the-foreman/references/decisions.md` — see the final step.

Neither manifest has a `skills` array — skills are auto-discovered from `plugin/skills/*/SKILL.md` — so
only `description` prose needs updating there. There is no CI in this repo.

- [ ] Locate the touch points: `grep -n "keep-it-simple" README.md .claude-plugin/marketplace.json plugin/.claude-plugin/plugin.json`
- [ ] Locate **count-bearing claims** that go stale with a fifth skill:
      `grep -nEi "four|all four|both suites|4 skills" README.md`.
      The repo was bitten by exactly this before — commit `9b160ad` was "Fix stale test-assert counts…".
      **Read each hit in context; do not rewrite every "four" mechanically.** Only phrases counting the
      *currently bundled skills* are stale. A reference to a historical, owner-scoped four-skill audit
      describes a past initiative's scope — rewriting it would silently rewrite that history. Flag
      ambiguous hits to the owner rather than guessing.
- [ ] Update the README: repo-layout tree, slash-form list, the `for s in …` symlink loop, bundled-skills
      bullets, the genuinely-stale counts, and a new explicit test glob line
      `node --test plugin/skills/the-cartographer/references/*.test.mjs`
- [ ] Append `the-cartographer` to both manifest `description` strings. **Do not touch `version`** — the
      release bump is a separate owner-authorized act.
- [ ] **Do NOT add an entry to `plugin/skills/the-foreman/references/decisions.md`.** That index is
      the-foreman's own ADR log (`ADR-NNN`), scoped to decisions about *the-foreman's* behaviour and
      cited by its own docs. `the-cartographer` is a sibling skill with its own `C-NNN` decision log
      in this initiative's `ADR.md`, and shipping it changes nothing about how the-foreman conducts
      work — so there is no the-foreman decision to record, and inventing one would pollute a log whose
      value is that every entry is load-bearing.
      *If* a later change makes the-foreman's conductor delegate to `the-cartographer` (e.g. "map the
      subsystem before planning"), **that** would be a genuine the-foreman behaviour change and would
      earn an `ADR-NNN` entry at that time.
- [ ] Verify **all three** suites — the repo has three, not two:
      `node --test plugin/skills/the-foreman/references/*.test.mjs plugin/skills/the-foreman/evals/*.test.mjs plugin/skills/the-cartographer/references/*.test.mjs`
      and `bash plugin/skills/codex-gate/codex-gate.test.sh`.
      **Report observed counts**; do not repeat a figure from this plan, which is itself a count-bearing
      claim that can go stale.
- [ ] **Commit:** `git add README.md .claude-plugin/marketplace.json plugin/.claude-plugin/plugin.json && git commit -m "chore(cartographer): register the skill in the plugin bundle"`

## Task 11: The held-out acceptance run

This gates the whole phase (ADR C-012). The oracle is six findings across four defect groups, found by
an independent scout before this skill existed.

**Anchors are in the REPO copy `plugin/skills/codex-gate/` at `ac0daf0`.** The personally-installed copy
at `~/.claude/skills/codex-gate/` has drifted and sits 1–2 lines higher; scoring against it would reject
a correct extraction. Re-verify before scoring, because the file may have moved since this was written:

```bash
grep -nE 'CODEX_HOME_DIR=|CODEX_GATE_RUNS=|^MAX_FILE_LINES=' plugin/skills/codex-gate/codex-gate.sh
grep -n "since-reviewed' (Tier 2)" plugin/skills/codex-gate/codex-gate.sh
grep -n '^# MODE: plan  (DOC tier)' plugin/skills/codex-gate/codex-gate.sh
grep -n 'MAX_ROUNDS' plugin/skills/codex-gate/SKILL.md
```

Expected at time of writing: `CODEX_HOME_DIR:41`, `CODEX_GATE_RUNS:42`, `MAX_FILE_LINES:61`,
overflow message `:519`, DOC-tier comment `:1054` (contradicted by the CODE-tier path at `:1089`), and
`SKILL.md:91,190,346`. `codex-gate.sh` is 2184 lines and `SKILL.md` is 386 at this revision.

**Extract from PINNED, VERIFIED-IMMUTABLE bytes — not the mutable working tree, and not a pointer
check.** The oracle is only meaningful against the revision it was derived from. `rev-parse HEAD`
verifies only *which commit is checked out*; it says nothing about whether the files were since edited.
Bind the bytes:

```bash
git worktree add --detach /tmp/carto-subject ac0daf0
# 1. the pointer is right
git -C /tmp/carto-subject rev-parse HEAD          # must be ac0daf07234...
# 2. the tree is UNMODIFIED (this is the check rev-parse cannot make)
git -C /tmp/carto-subject status --porcelain      # must be EMPTY
# 3. the subject's bytes match the committed blobs, not just the index
git -C /tmp/carto-subject diff --quiet ac0daf0 -- plugin/skills/codex-gate && echo SUBJECT_PINNED
# 4. make it read-only for the run so nothing can mutate it mid-extraction
chmod -R a-w /tmp/carto-subject/plugin/skills/codex-gate
```

**Run every anchor grep from §Task 11 inside `/tmp/carto-subject`, not the repo cwd** — greps against
the mutable checkout would validate anchors the extractor never saw. Give the worker the **absolute**
subject path `/tmp/carto-subject/plugin/skills/codex-gate/`; a relative path resolves against whatever
cwd the worker happens to have.

Clean up after scoring: `chmod -R u+w /tmp/carto-subject && git worktree remove --force /tmp/carto-subject`.

**If an anchor genuinely moved at `ac0daf0`, this document is wrong** — correct it from the grep output
*before* running the extractor, never after, and never to match what the extractor produced. **If an
anchor moved because the defect was FIXED upstream, stop and surface to the owner**: the oracle needs
re-deriving, which is an owner decision, not a silent edit.

- [ ] **Extract under a hold-out.** Dispatch a fresh subagent — deep tier, high effort (judgement-heavy
      and gate-bound, the-foreman §8) — given only the `SKILL.md` protocol and the subject root
      `plugin/skills/codex-gate/`. The prompt must not contain the expected findings, their count, or
      the class names as examples. Reading `docs/initiatives/**` or `.maps/**` is forbidden; verify
      compliance afterwards from the agent's tool-call record and void the run if violated. The worker
      emits the map; **`render.mjs` writes `map.json`** (it owns the scanned write).

      *Residual weakness, stated rather than papered over:* a subagent dispatched from this session
      cannot be proven free of the orchestrator's knowledge. The read-ban and audit reduce but do not
      eliminate leakage. Two things carry the real weight: copying an answer key inflates **recall
      only** and does nothing for the precision half below, and only two attempts are permitted. If
      stronger isolation is wanted later, score a second never-analysed subject — record that as the
      follow-up rather than claiming this run is airtight.
- [ ] **Render each candidate to SCRATCH, never to the accepted-snapshot location.**
      `.maps/codex-gate/` is defined as the *accepted* snapshot (ADR C-009) and is what Phase 6's
      structural diff compares against. Rendering a candidate straight into it means a **failed**
      attempt silently becomes the baseline. Render to a scratch dir and promote only after the run
      passes every gate below:

```bash
node plugin/skills/the-cartographer/references/render.mjs <extracted-map> /tmp/carto-candidate-N \
  --repo-root /tmp/carto-subject
```

      Confirm `checkFreshness` reports `fresh: true` against the pinned worktree.

      **Every downstream gate reads the CANDIDATE dir**, never `.maps/codex-gate` — scoring, the
      coverage floor, and the reconstruction gate all operate on `/tmp/carto-candidate-N/`. On a first
      run `.maps/codex-gate` does not exist, and on a retry it holds the *previous* attempt, so reading
      it would score the wrong artifact.

      **Promote only after every gate passes, and promote by re-rendering, not by `cp`.** A raw copy
      bypasses the renderer-owned scanned write (Task 8) and can promote a partial or hand-edited set:

```bash
node plugin/skills/the-cartographer/references/render.mjs \
  /tmp/carto-candidate-N/map.json .maps/codex-gate --repo-root /tmp/carto-subject
```
- [ ] **Score exactly, in both directions.** A scanner that flags everything would otherwise pass.
      - **Recall — match the whole finding, not one anchor.** All six present: 1 PHANTOM
        (`CODEX_GATE_MAX_ROUNDS`, citing SKILL.md `91`/`190`/`346`), 3 UNDOCUMENTED (citing `:61`,
        `:41`, `:42`), 2 STALE (citing `:519` and `:1054`). Wording may differ, but for each expected
        finding verify **the class, the full citation set, and — for STALE — both citations plus a
        `statement` that actually describes the real contradiction**. Checking class-plus-one-location
        would let a STALE pair the right claim line with unrelated evidence, or a fabricated statement,
        and still score as recalled. Any miss fails the phase.
      - **Precision — review EVERY finding, not only the extras.** Open each finding at its cited
        file:line: the six expected ones *and* any additional ones. A genuine new defect passes (record
        it; add it to the oracle). Any finding that does not hold up at its citation is a false
        accusation and **fails the phase** — PDR §14 names a confident wrong map as the top risk, and a
        wrong-but-expected finding is still wrong.
      - **Coverage floor — the map must DEPICT the subject, not only its defects (ADR C-015).** Derive
        every expected value from the pinned source at scoring time; do not trust the numbers below.
        Each check is a command with a pass condition, because "represent the system" is otherwise not
        assertable:

```bash
CAND=/tmp/carto-candidate-N/map.json
SUBJ=/tmp/carto-subject/plugin/skills/codex-gate

# (a) MODES — every mode in main()'s dispatch case appears as a node of kind "mode"
sed -n '/^main()/,/^}/p' "$SUBJ/codex-gate.sh" | grep -oE '^\s+[a-z-]+\)' | tr -d ' )' | sort -u > /tmp/exp-modes
jq -r '[.nodes[]|select(.kind=="mode")|.label]|sort|.[]' "$CAND" | sort -u > /tmp/got-modes
diff /tmp/exp-modes /tmp/got-modes && echo MODES_OK

# (b) OUTCOME VOCABULARIES — all three emit functions appear as nodes
for f in emit_outcome emit_question_outcome emit_investigate_outcome; do
  jq -e --arg f "$f" 'any(.nodes[]; .label==$f or (.id|test($f)))' "$CAND" >/dev/null || echo "MISSING $f"
done

# (c) DISPATCH EDGES — every mode whose handler actually reaches an emit_* function
#     has an edge to it. NOTE: not every mode emits a verdict — at ac0daf0 `phase-start`
#     dispatches at :2167 but its handler has NO emit_* path, so requiring an edge for
#     ALL 8 modes would be factually wrong and would fail a CORRECT map.
#     Derive the emitting subset from the source, then require an edge for exactly those.
jq -e '[.edges[]|select(.kind=="control")]|length > 0' "$CAND" >/dev/null && echo DISPATCH_EDGES_PRESENT

# (d) OVERVIEW renders — already proven by render.mjs exiting 0, which throws on a
#     layout overflow or a drift node missing from every graph view
```

        **Pass condition:** `MODES_OK`, no `MISSING` lines, an edge from each *emitting* mode to its
        emit function, and a rendering `overview`. A map that scores 6/6 on drift but depicts almost
        nothing **fails the phase** — the product goal is at-a-glance system understanding, and a
        defect-only map does not meet it.
      - **Bounded iteration:** on a miss or a false accusation you may revise `SKILL.md` and re-run on a
        fresh extractor, recording each attempt in `.maps/codex-gate/oracle-log.md`. **After two failed
        attempts, STOP and surface to the owner** — repeated tuning against a known answer key is
        overfitting, which destroys the only held-out evidence that extraction works. Never put the
        answers in the prompt.
- [ ] **Reconstruction gate.** Copy `map.md` to a scratch dir **outside the repo**
      (`/tmp/carto-recon/`). Dispatch a fresh standard-tier subagent given only that path and banned
      from reading the repo.

      **The subagent must emit exactly this JSON shape** (otherwise the comparison is not executable):

```jsonc
{
  "nodes": [{ "id": "…", "label": "…", "kind": "…", "lane": "…" }],
  "edges": [{ "from": "…", "to": "…", "label": "…", "kind": "control|data|doc" }],
  "capabilities": [{
    "id": "…",
    "evidence": ["<path>:<line>", "…"],          // MUST be present — PDR §12 requires it
    "claims":   [{ "cite": "<path>:<line>", "claimKind": "doc|code-comment|user-message" }]
  }],
  "drift": [{ "class": "PHANTOM|UNDOCUMENTED|STALE|UNVERIFIED", "nodeId": "…",
              "citations": ["<path>:<line>", "…"] }]
}
```

      **Isolation must be auditable, not merely instructed.** Give the worker a directory containing
      *only* `map.md`, and after the run confirm from its tool-call record that it opened no path
      outside `/tmp/carto-recon/`. A prompt-level ban with no audit is not isolation.

      **Normalization (both sides):** trim whitespace; compare ids, kinds and classes case-sensitively
      as the pipeline emits them; sort and de-duplicate every list; citations compare as the exact
      `path:line` string. Write the agent's JSON to `/tmp/carto-recon/recon.json`, then run the checks
      **with `set -e` so a failing `diff` cannot be masked by a later command**:

```bash
set -e
CAND=/tmp/carto-candidate-N            # the candidate, NOT .maps/codex-gate
R=/tmp/carto-recon/recon.json

# nodes: id + label + kind + lane, not id alone
jq -Sr '[.nodes[]|{id,label,kind,lane}]|sort' "$CAND/map.json" > /tmp/a-nodes
jq -Sr '[.nodes[]|{id,label,kind,lane}]|sort' "$R"             > /tmp/b-nodes
diff /tmp/a-nodes /tmp/b-nodes

# edges: full payload, not just endpoints
jq -Sr '[.edges[]|{from,to,label,kind}]|sort' "$CAND/map.json" > /tmp/a-edges
jq -Sr '[.edges[]|{from,to,label,kind}]|sort' "$R"             > /tmp/b-edges
diff /tmp/a-edges /tmp/b-edges

# capabilities: every non-inferred node, with its citations
jq -Sr '[.nodes[]|select(.inferred==false)|{id,
          evidence:[.evidence[]|"\(.path):\(.line)"]|sort,
          claims:[.claims[]|{cite:"\(.path):\(.line)",claimKind:(.claimKind//"doc")}]|sort}]|sort' \
  "$CAND/map.json" > /tmp/a-caps
jq -Sr '[.capabilities[]|{id,evidence:(.evidence|sort),claims:(.claims|sort)}]|sort' "$R" > /tmp/b-caps
diff /tmp/a-caps /tmp/b-caps

# drift: class + node + citations
jq -Sr '[.findings[]|{class,nodeId,citations:[.citations[]|"\(.path):\(.line)"]|sort}]|sort' \
  "$CAND/drift.json" > /tmp/a-drift
jq -Sr '[.drift[]|{class,nodeId,citations:(.citations|sort)}]|sort' "$R" > /tmp/b-drift
diff /tmp/a-drift /tmp/b-drift

# a non-empty capability set that actually carries citations
jq -e '(.capabilities|length) > 0 and all(.capabilities[]; (.evidence|length) + (.claims|length) > 0)' "$R"
echo "RECONSTRUCTION EXACT"
```

      **Pass condition:** the script reaches `RECONSTRUCTION EXACT` with exit 0. An empty
      `capabilities` array fails. A miss means `map.md` is not self-sufficient — **fix `markdown.mjs`,
      not the prompt.**
- [ ] **Surface the visual.** Open `map.html`; confirm the hero draws, the drift lane shows all six
      findings with citations, and the coverage section is present. Publish via the `Artifact` tool if
      available. **Publication is not a gate condition** — the six oracle findings are.
- [ ] **Commit:** `git add .maps/codex-gate && git commit -m "feat(cartographer): first accepted snapshot — codex-gate, 6/6 oracle findings"`

---

# Phases 6+ (outline only — NOT authorized by this plan)

**Phase 6 — structural drift** (PDR §13 Phase 2): `structuralDiff(prev, next)` over stable ids and typed
attributes; prose-only changes classified `cosmetic` and excluded from the verdict (ADR C-011); a "what
changed since last time" lane in both outputs.

**Phase 7 — additional subject kinds** (PDR §13 Phase 3): `feature` and `codebase` subjects. Whole-repo
mapping stays out of scope until scoped on its own.

The phase set frozen by this plan is **Phases 1–5, Tasks 1–11**. Merging, splitting or reordering it
afterwards is a decision-fork.

---

# Gate record

`codex-gate bundle` ran three rounds against a code-complete draft of this plan: **BLOCK** at 16, 18 and
15 blockers — all `agent_fixable`, none decision-class. Every round-1 blocker and round 2's line-number
finding were independently verified at file:line before being acted on; all held up.

Substantive defects the gate caught, now fixed in this plan or its companions:

| Defect | Resolution |
|---|---|
| CLI main guard compared a relative `argv[1]` to an absolute module path — every documented invocation was a silent no-op, and the personal symlink install broke it again | Task 8 test intent 6: CLI must run via relative path *and* symlink |
| `map.json` and `drift.json` were written **unscanned** despite a claimed all-artifacts guard | Task 8: `render` owns all four writes; all scanned before any write |
| `map.md` interpolated source text with only pipe handling — HTML and active links were injectable; a backslash escape still leaves `<img` intact | Task 7 test intent 11–14, with the escaping trap named |
| **The oracle cited the wrong copy of `codex-gate`** — the plan targets the repo copy, the citations came from the drifted personal copy; a *correct* extraction would have failed the gate | PDR §1 and Task 11 re-anchored to the repo copy at `ac0daf0`, with a re-verification step |
| Claims were modelled as doc-only, but both STALE oracle findings are a script message and a script comment — the oracle was unrepresentable | `claimKind` added (PDR §8, Task 9 item 3) |
| `renderMermaid` emitted flowchart syntax for `stateDiagram-v2`; node-id sanitisation was not injective | Task 6 test intent 1–3 |
| The oracle was not held out (answers live in this repo), permitted unlimited tuning, accepted `>= 6` | Task 11: read-ban + audit, exact scoring both directions, two-attempt cap, residual weakness stated |
| Freshness was never enforced; the validator accepted absent collections and unbounded citations | Task 2 test intent 2, 5, 11, 12; Task 8 test intent 5 |
| Golden-file testing was described but not planned | Task 8, including the timestamp-independence trap |
| README's "four skills" / "Both suites" claims would go stale — the defect `9b160ad` already fixed once | Task 10, with the historical-reference caveat |

**Round 3 was not re-gated at code altitude.** Its findings were overwhelmingly defects in unwritten
code, and each fix generated the next crop. The owner chose to lower the plan's altitude (ADR C-013)
rather than start a fourth identical round.

# Self-review

**Spec coverage.** PDR §5 pipeline → Tasks 1, 3, 8. §6 six views → Tasks 5, 6, 8. §6.1 SVG hero + node
cap → Tasks 4, 5. §6.2 drift on the map → Tasks 5, 6, 9. §7 IR + determinism → Tasks 1, 2. §8 classes →
Task 3 (STRUCTURAL deferred to Phase 6 per §13). §8.1 guardrails → Task 3 (`inferred`, `UNVERIFIED`),
Task 8 (coverage rendered), Task 9 (coverage honesty). §8.2 non-determinism → ADR C-011, Phase 6. §9
components → all. §10 placement → Tasks 10, 11. §11 degradation → Tasks 8, 9, 11. §12 testing → every
task, plus Task 11's oracle and reconstruction gates. §15 defaults adopted: own `style.css` (Task 8),
committed `.maps/` (Task 11), drift palette from the stylesheet's warn/muted/accent tokens (Task 8).

**Placeholder scan.** No TBD/TODO. Implementation code is absent **by decision** (ADR C-013), not by
omission; each task carries exact files, exact interface signatures, and named test conditions.

**Type consistency.** `validate(map) -> {ok, errors}` (Task 2) consumed in Task 8. `computeDrift(map) ->
{findings}` with `{class, nodeId, label, detail, citations}` (Task 3) consumed by Tasks 5, 6, 7, 8.
`layoutHero -> {width, height, placed}` (Task 4) consumed in Task 5. `renderMermaid(view, map, findings)`
(Task 6) consumed identically in Tasks 7 and 8. `checkFreshness` (Task 2) consumed in Tasks 8 and 11.
`serialize` (Task 1) used for `map.json` and `drift.json` in Task 8. The closed sets are exported once
from `validate.mjs` and imported by `layout.mjs` and `mermaid.mjs`.
