---
name: the-cartographer
description: Use when someone needs to SEE what a system actually does — map a skill, feature, or codebase subtree from its own source into an at-a-glance visual page plus a doc-vs-code audit that names where the docs and the code disagree. Trigger on "map this", "what does X do under the hood", "I've lost track of this feature", "diagram this system", "show me the flow", "audit the docs against the code", or before changing code whose real behaviour is no longer obvious.
allowed-tools: Bash, Read, Grep, Glob, Write, Artifact
---

# the-cartographer — derive the picture from the source

You are mapping a **subject**: one skill, one feature, or one codebase subtree. You read its
source, emit a citation-backed intermediate representation (`map.json`), and a renderer turns that
into a visual page and a set of drift findings.

Two properties make this worth more than a hand-drawn diagram, and both are yours to protect:

- **Every claim on the page resolves to a file:line** that a reader can open. Nothing is asserted
  because it seemed true.
- **Because the map is derived from source, it doubles as an audit.** Where the documentation and
  the code disagree, the map says so — with both citations, on the picture, not only in a table.

The corollary is the standing risk: **a confident wrong map is worse than no map.** A finding you
cannot open at its own citation is a false accusation. When in doubt, tag it unverified or leave it
out; never guess to fill a lane.

**You never modify the subject.** This skill reads. The only files it writes are its own outputs.

---

## 1 · What it produces, and where

Four artifacts, written **together** by the renderer into `<subject-repo>/.maps/<slug>/`:

| File | What it is |
|---|---|
| `map.json` | the snapshot IR — generated, never hand-edited, committed with the subject |
| `drift.json` | the derived findings (not part of the snapshot) |
| `map.html` | the page: SVG hero, mermaid views, capability table, coverage, drift lane (grouped by attention bucket, §7.1) |
| `map.md` | the portable Markdown twin of the page — every finding stated in full, nothing folded |

Outputs live in the **subject's own repository**, not in this skill's install directory (ADR C-009).
The snapshot is what a later run's structural diff compares against, so it has to travel with the
source it describes. `<slug>` is the subject's slug — `.maps/<slug>/`, one directory per subject.

**The renderer owns all four writes.** Do not hand-write `map.json` into `.maps/`: the write sits
behind a fail-closed secret/PII scan that checks all four bodies *before* any of them is opened, and
writing the snapshot yourself is a path around that gate. Draft your map anywhere convenient
(scratch), then let `render.mjs` produce the accepted set (§9).

---

## 2 · The extraction protocol — enumerate first, infer second

**Start with what can be enumerated mechanically.** Do not begin by reading prose and describing
impressions; begin by listing the contracts the source itself declares. In this order:

1. **Modes / commands / subcommands** — the dispatch table, the argument switch, the routing map.
2. **Flags and options** — every accepted switch, its default, whether it takes a value.
3. **Environment variables** — every read of the environment, including ones read only to supply a
   default.
4. **Outcomes and exit paths** — statuses, verdicts, exit codes, terminal states, error returns.
5. **File artifacts** — every path the system reads, writes, or creates; state and cache locations.
6. **Public entry points** — exported functions, CLI mains, hooks, event handlers, anything another
   system can call.

**Grep, do not skim.** For each category, search for the *idiom*, then read every hit:

```bash
# examples of the SHAPE of the search — adapt the pattern to the subject's language
grep -nE '^\s*[a-z0-9_-]+\)'            <file>   # shell case-dispatch arms
grep -nE '\$\{?[A-Z][A-Z0-9_]*'         <file>   # shell env reads
grep -rnE 'process\.env\.[A-Z0-9_]+'    <dir>    # node env reads
grep -rnE '^export (function|const)'    <dir>    # public entry points
grep -rnE 'exit [0-9]+|process\.exit'   <dir>    # exit paths
```

Reading the subject's own documentation is part of the job (§3), but it is **never the source of an
enumeration**. A capability list assembled from the docs cannot find what the docs omit, which is
half of what this skill exists to report.

For each enumerated item, collect two things separately and never merge them:

- **`evidence[]`** — file:line in a `role: "code"` source that proves the code does it. Documentation
  is not behavioural evidence; the validator enforces this.
- **`claims[]`** — every place the behaviour is *asserted*, of any kind (§3).

**Only then** add the semantic layer — "this component orchestrates those", "this is the ingest
boundary". That layer is useful for readability and is allowed, but it is inference: tag it
(§5) and understand that it is excluded from the audit.

---

## 3 · Claims are not always in docs

Every claim carries a required **`claimKind`**. There is no default — a missing one is a validation
error, precisely so that nothing can quietly pose as documentation.

| `claimKind` | What it is | Cited source `role` |
|---|---|---|
| `doc` | a documentation surface: SKILL.md, README, a manual, a dedicated docs block or file | `doc` |
| `code-comment` | a comment **asserting behaviour** — what something does, defaults to, or is | `code` |
| `user-message` | a **string the program shows a user**: usage/help text, error and warning messages, prompts, printed hints | `code` |

**Search all three surfaces, for every subject.** Each has its own recipe:

- **`doc`** — read the subject's documentation files end to end, then, for each enumerated item,
  search the docs for its name and for its synonyms. Record where it is described and *what the
  description asserts* (`text`).
- **`code-comment`** — read the comments **around every evidence line you already recorded**, plus
  file and function headers, banner/usage comments at the top of a file, and any block that
  describes options or behaviour. A comment that merely explains *how* the code works is not a
  claim; a comment that asserts *what the system does, defaults to, or supports* is.
- **`user-message`** — grep the string literals that reach a user surface (whatever the subject uses
  to print: stdout/stderr writes, log/echo/print calls, help and usage blocks, thrown error
  messages) and read the ones that describe the system's own interface — flags, modes, limits,
  suggested next commands.

**Only `claimKind: "doc"` counts as documentation** for the PHANTOM and UNDOCUMENTED classes
(ADR C-014). A `code-comment` or `user-message` claim is still recorded on the node, still rendered
on the page, and can still raise STALE — but it does not make a capability documented. A capability
described *only* in a well-written comment is therefore reported as undocumented. That is the
intended reading, not a false positive: a comment buried in a source file is not documentation for
anyone reading the docs, and counting it as such makes the audit quietest on exactly the systems
that need it loudest.

**Why the other two kinds matter as much as docs.** A claim of any kind can contradict the code, and
the audience differs: a stale doc misleads a maintainer, while a stale printed message misleads a
*user*, at the moment they are trying to recover from something. Both are drift. **Make no
assumption about where a given subject's drift will be concentrated** — search all three surfaces
with equal effort, in every run, and let the findings fall where the source puts them.

---

## 4 · Emit the complete IR, or the render fails closed

`render.mjs` validates before it writes and produces **no partial page**. An incomplete map is not a
degraded result; it is no result. Emit every field.

```jsonc
{
  "schemaVersion": "1",
  "extractorVersion": "1.0.0",
  "subject": {
    "slug": "<slug>", "kind": "skill|feature|codebase",
    "root": "<repo-relative root>", "title": "…",
    "summary": "one paragraph: what this subject is"
  },
  "sources": [
    { "path": "<repo-relative>", "sha256": "<64 hex>", "lines": <int>, "role": "code|doc" }
  ],
  "coverage": {
    "read":    ["<path>"],
    "partial": [ { "path": "…", "why": "…" } ],
    "skipped": [ { "path": "…", "why": "…" } ]
  },
  "nodes": [
    { "id": "<kind>.<slugify(label)>",
      "kind": "mode|flag|env|outcome|artifact|component|external|state",
      "label": "…", "lane": "entry|core|output|external", "summary": "…",
      "evidence": [ { "path": "…", "line": 1, "note": "what is at that line" } ],
      "claims":   [ { "path": "…", "line": 1, "text": "what is asserted",
                      "claimKind": "doc|code-comment|user-message", "checked": true } ],
      "contradictions": [ { "claim": {…}, "evidence": {…}, "statement": "the conflict" } ],
      "inferred": false,
      "attrs": { "default": null } }
  ],
  "edges": [
    { "id": "e.<kind>.<from>><to>", "from": "<node id>", "to": "<node id>",
      "label": "<non-empty>", "kind": "control|data|doc",
      "evidence": [ { "path": "…", "line": 1 } ] }
  ],
  "views": [
    { "id": "overview", "form": "svg-hero", "title": "…", "nodes": [], "edges": [] },
    { "id": "control-flow", "form": "mermaid", "mermaidType": "flowchart|stateDiagram-v2",
      "title": "…", "nodes": [], "edges": [] },
    { "id": "capabilities", "form": "table", "title": "…", "columns": ["…"], "nodes": [] }
  ]
}
```

The rules that fail a render most often, stated plainly:

- **`sources[]` must contain an entry for EVERY file cited anywhere** — in any node's evidence or
  claims, in any edge, in any contradiction. Every citation must resolve to a declared source and
  sit **within that source's `lines`** count.
- **`sha256` must be the real digest and `lines` the real count. Never invent either.** They are
  what proves the map corresponds to one specific source state; the renderer recomputes both and
  refuses a snapshot that no longer matches disk. Compute them — zero dependencies, `node:crypto`
  via the shared helper, so your count matches the checker's exactly:

  ```bash
  node --input-type=module -e '
  import fs from "node:fs";
  import { digestOf, countLines } from "<skill-dir>/references/freshness.mjs";
  for (const p of process.argv.slice(1)) {
    const b = fs.readFileSync(p);
    console.log(JSON.stringify({
      path: p, sha256: digestOf(b), lines: countLines(b.toString("utf8")), role: "code",
    }));
  }' <file> [<file>…]
  ```

  (The line rule is the one an editor shows: `\n`-terminated lines plus a trailing partial line if
  the file does not end in a newline; an empty file has 0.) Paths are **repo-relative**, normalized,
  free of `..`, and contained under the repo root.
- **`evidence` must cite a `role: "code"` source**, and a claim's `claimKind` must agree with its
  source's role (§3's third column). Both are enforced.
- **IDs are derived, never invented.** `slugify(label)` = lowercase, every run outside `[a-z0-9]`
  becomes one `_`, leading/trailing `_` stripped. Node id = `<kind>.<slug>` with the node's own
  kind; edge id = `e.<kind>.<from>><to>`. Two labels that slugify to one id are reported as a
  collision — rename one, do not merge them.
- **Every edge needs a non-empty `label` and at least one evidence citation**, and both endpoints
  must be real node ids. A view may not name an unknown id, and **may not name the same id twice**.
- **Collections are required, not defaulted.** Missing `sources`, `nodes`, `edges`, `views`, or a
  `coverage` bucket is a violation. `sources` must be non-empty.
- **A view with `id: "overview"` and `form: "svg-hero"` is required.** Graph views carry an `edges`
  array (possibly empty, never absent or null).
- **No wall-clock timestamp anywhere in `map.json`** — generation time belongs to the page, not the
  snapshot. A wall-clock timestamp is a **date-TIME**, and that is what the serializer refuses, in
  either spelling and at any precision from the hour down: `2026-08-11T13:45:00Z`,
  `2026-08-11 13:45`, `20260811T134500Z`, `2026-08-11T13Z`. A stamped directory
  (`logs/20260811T1345/run.json`) is still a stamp. **A bare date is ordinary source text and is
  carried** (`2026-08-01`, `20260801`) — so quote a dated line from the subject exactly as it stands:
  a changelog entry, a version note, a dated path. Do not paraphrase around a date to get past this
  rule (ADR C-003, amended 2026-08-13). **No `drift` key anywhere in the IR** either; drift is
  derived output.
- **Plain JSON data only** — `null`, booleans, finite numbers, strings, arrays, plain objects.
  Nothing clever.

If validation fails, the error names the offending path. **Fix the map and re-render; never
hand-edit an output.**

---

## 5 · Tagging discipline (ADR C-005)

The audit must never accuse on a vibe. Three tags carry that promise:

- **`inferred: true`** — on anything not directly citable: a semantic grouping, an "orchestrates"
  relationship you concluded rather than read, a component boundary you drew for readability.
  **An inferred node can never raise a drift finding.** That is the point: inference buys
  readability without buying accusations. An `inferred: false` node must carry at least one citation.
- **`checked: false`** — on a claim you could not verify (the referenced behaviour is external, or
  the check needs a run you did not do). A node with claims but no evidence, whose claims are **all**
  `checked: false`, reports **UNVERIFIED** rather than PHANTOM — visibly distinct from a confirmed
  defect. Silence is not a disclaimer: omit `checked` and the claim counts as checked.
- **`contradictions[]`** — the ONLY way STALE is raised. PHANTOM and UNDOCUMENTED are derived
  mechanically from set membership; **STALE is asserted by you**, and it is auditable only if the
  record is complete. Each record needs:
  - `claim` — one of **that node's own** `claims[]` entries, carrying the `text` it asserts;
  - `evidence` — one of **that node's own** `evidence[]` entries, carrying a `note` quoting what is
    actually at that line;
  - `statement` — what the conflict *is*, in a sentence.

  A record missing either citation, either quote, or the statement fails closed. Never assemble a
  contradiction from two unrelated locations to make a finding look substantiated.

The four classes, for orientation: **PHANTOM** (a `doc` claim with no evidence) · **UNDOCUMENTED**
(evidence with no `doc` claim) · **STALE** (both, and they disagree — via a contradiction record) ·
**UNVERIFIED** (claimed, unevidenced, and marked unchecked).

---

## 6 · Lane assignment

Every node names one lane. Lanes are what let the hero lay itself out deterministically, so assign
them by role in the flow, not by taste:

- **`entry`** — how the system is invoked: modes, commands, entry points, triggers.
- **`core`** — the work: components, internal state, decision points, transformations.
- **`output`** — what comes out: outcomes, verdicts, exit paths, written artifacts.
- **`external`** — what the system depends on but does not own: other tools, services, binaries,
  APIs, sibling systems.

Flags and env vars usually attach to the stage they configure: an option that selects a mode is
`entry`; one that tunes internal behaviour is `core`; one that names an output location is `output`.

---

## 7 · The collapse rule (ADR C-002)

**The `overview` view takes at most 15 nodes.** This is enforced by the validator — a 16-node
overview is a violation, not a large picture. The bound is what buys the hero a simple lane layout
instead of a general graph engine, so it is load-bearing.

When a subject has more than 15 things worth showing, **collapse the overview to component-level
nodes** — group the detail behind a node that represents the group. Do not drop the detail: **the
mermaid views carry no such bound**, so the collapsed nodes stay fully visible there.

**Every drift-bearing node must appear in at least one graph view** (`svg-hero` or `mermaid`). The
renderer throws otherwise (PDR §6.2). A finding a reader can only meet in a table has been hidden
from the picture, and the map has quietly become a table with pictures — the reader who looks at the
diagram sees a clean system. So when you collapse, keep the nodes that carry findings drawn: put
them in the overview, or make sure a mermaid view includes them.

---

## 7.1 · Attention buckets — and why they are NOT your job (ADR C-017)

The page groups the drift lane into three buckets, derived from each node's `kind` **and** `lane`:
`likely-contract` and `ambiguous-review` are shown outright, and `implementation-detail` — only
`artifact`, `component` and `state` in the `core` lane, and only for UNDOCUMENTED — starts folded
behind a disclosure. PHANTOM, STALE and UNVERIFIED are never folded.

**This is done for you, by the renderer, from the map you emit. Do not pre-filter to help.**

- **Emit every capability you can evidence**, internal helpers included. UNDOCUMENTED firing on an
  internal is correct, not noise: a finding you decline to emit is gone for good, because PHANTOM is
  the opposite membership cell and STALE needs a contradiction record.
- **Do not invent a claim to quieten a node.** A `doc` claim must cite real documentation. Silencing
  UNDOCUMENTED with a claim that is not in the docs is the one thing that makes the audit lie.
- **`kind` and `lane` are now load-bearing twice** — for layout and for attention. Put a node in the
  lane that describes it: `entry` for something a caller reaches first, `core` for internal
  machinery, `output` for what the subject produces, `external` for what it depends on. Marking an
  internal helper `entry` over-reports it; marking a public entry point `core` is worse, because that
  is the cell that folds. When genuinely unsure, prefer the more visible lane.

## 8 · Coverage honesty

`coverage` is a **partition of the declared sources, in both directions**: every path appears in
exactly one of `read` / `partial` / `skipped`, and every `sources[]` path appears in one of them. A
`read` path must also be hashed in `sources[]`. `partial` and `skipped` entries must state **why**.

**Never silently truncate.** If the subject is larger than the budget, say so on the page: record
the file as `partial` ("read the dispatch table and flag handling; did not read the N helper
bodies") or `skipped` ("vendored dependency, not subject behaviour"). A map that read half the
source and says so is useful. A map that read half the source and looks complete is the failure mode
this skill exists to prevent.

**Always exclude `.maps/**` from extraction, for every subject, without exception.** A subject's own
maps are *this skill's output*, not part of the system being mapped. Including them would make the
tool map itself, inflate coverage with derived files, and let a previous run's conclusions re-enter
the next run disguised as source evidence. The validator rejects a `.maps/` citation; the protocol
rule is that you never read them in the first place. This is a standing rule, not a per-run
instruction.

Other things to exclude as a matter of course: vendored/third-party trees, build output, lockfiles,
and anything else that is not the subject's own behaviour — each recorded in `skipped` with its
reason, so the exclusion is visible rather than assumed.

---

## 9 · How to run it

> **`<skill-dir>` in the commands below** = the directory containing THIS SKILL.md (you know it —
> it's the path this skill was loaded from). Installed as a plugin that is
> `…/plugins/cache/<marketplace>/the-foreman/<version>/skills/the-cartographer`; installed as a
> personal skill it is `~/.claude/skills/the-cartographer`. Substitute the real absolute path when
> running the `node` commands. The renderer lives in the **installed skill directory**, never in the
> subject's repo — it is not copied anywhere.

```bash
node <skill-dir>/references/render.mjs <map.json> <outDir> [--repo-root <path>]
```

`<map.json>` is your drafted map; `<outDir>` is where the four artifacts go — normally
`<subject-repo>/.maps/<slug>/`. Pass `--repo-root` whenever the subject's repo root is not the
directory the map sits in; the repo-relative paths in the map resolve against it, and there is no
`cwd` fallback, because resolving against an arbitrary cwd would check the wrong files and report
fresh. In one pass the renderer ingests the map, validates it, verifies every source still matches
disk, computes drift, scans all four bodies for secrets/PII, and only then writes.

Then **publish `map.html` via the `Artifact` tool** so the page is viewable with working mermaid
views. Re-publishing the same file path returns the same URL, so a regenerated map updates in place.

**If the `Artifact` tool is absent, state the local path. That is normal and NEVER a blocker.** The
SVG hero, every table, the coverage section and the drift lane are host-independent and render from
a local `file://` open exactly as they do published; only the mermaid detail views degrade to text.
Say which path to open and move on — do not treat a missing publish tool as a failed run, and do not
install anything to work around it.

**On a stale-snapshot error, regenerate — do not patch.** If the renderer reports that the recorded
source facts no longer match disk, the source changed underneath the extraction. A snapshot is a
claim about one specific source state; hand-editing it makes it a claim about no state at all.

---

## 10 · Agent-to-agent sharing

When handing results to another agent, **hand over `map.md`** — the path, or its contents. It is the
self-sufficient twin of the page: same nodes, same tables, same coverage, same findings with their
citations.

**Never hand over the Artifact URL.** A published artifact is owner-private; another agent fetching
it gets a 403, and the handoff dies on an access error that looks like a broken link. The URL is for
the human. `map.md` is for the machine.

---

## Non-negotiables

1. **Enumerate before you infer.** The capability list comes from the code, never from the docs.
2. **Every citation resolves, or the claim does not ship.** Open it; if it is not there, it is not a
   finding.
3. **Search all three claim surfaces every run** — docs, behaviour-asserting comments, user-facing
   messages — with no assumption about where drift will be.
4. **STALE needs a complete contradiction record**: both citations, both quotes, and the statement.
5. **Inferred nodes never accuse.** Unverifiable claims are marked, not guessed.
6. **Coverage is declared, never truncated silently**, and `.maps/**` is always excluded.
7. **The renderer writes the artifacts.** Never hand-edit an output; regenerate.
