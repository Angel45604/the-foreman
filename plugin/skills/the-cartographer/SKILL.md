---
name: the-cartographer
description: Use when someone needs to SEE what a system actually does — map a skill, feature, or codebase subtree from its own source into an at-a-glance visual page plus a doc-vs-code audit that names where the docs and the code disagree. Trigger on "map this", "what does X do under the hood", "I've lost track of this feature", "diagram this system", "show me the flow", "audit the docs against the code", or before changing code whose real behaviour is no longer obvious. On a repo too large for one pass it asks which modules to map (§0) and can fan the work out across parallel extractors (§2.1).
allowed-tools: Bash, Read, Grep, Glob, Write, Artifact
---

# the-cartographer — derive the picture from the source

You are mapping a **subject**: one skill, one feature, or one codebase subtree — **chosen, never
assumed (§0)**. You read its
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

## 0 · Choose the subject — never self-select

**A subject is chosen, not assumed.** The first failure mode of this skill is not a wrong finding;
it is mapping the wrong thing confidently. Pointed at a repository, an extractor that picks a
promising-looking subtree and starts reading has already made the decision that mattered, silently,
and every citation below it will resolve perfectly while answering a question nobody asked.

**Enumerate the separations mechanically, then ASK.** Before any extraction, when the root you were
given is a whole repository, or holds more than one obvious module boundary, or is larger than one
pass can honestly cover:

1. List the candidate modules from the tree itself — top-level source directories, workspace
   members, package roots — with a **tracked-file count** for each. Counts come from the VCS, not
   from an impression.
2. **Put the list to the human and let them choose.** Offer the counts, and say plainly which
   choices a single pass cannot cover.
3. Map only what was chosen. **One subject, one `.maps/<slug>/`** (ADR C-009) — two modules chosen
   is two subjects and two directories, not one map with a wider root.

**Self-selection is refused, not merely discouraged.** If you cannot ask — no human in the loop, no
question channel — then **state the enumeration and stop**. An unasked question is not a licence to
pick; recording "I chose X of these twelve" after the fact is the same defect with a receipt.

**The bounded case still needs no ask.** One skill, one feature, one small subtree named explicitly
by the requester is already a subject. This section is about the moment the root is bigger than the
question, which is the moment the choice stops being yours.

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

**One enumerated item, one node — never fold.** Every item a category above yields gets its own node,
even when several are consumed by the same machinery. It is tempting to collapse a group of
environment variables into the component that reads them, or a set of exit codes into the handler that
emits them, because the component is the more interesting *box on the diagram*. Do not: the drift
classes are computed per node, so a folded item can never be reported as undocumented — it silently
inherits the documentation status of whatever swallowed it. Collapsing for readability is a **view**
decision (§7), never an extraction one. After enumerating, count: the number of `env` nodes should
equal the number of distinct variables you grepped, and likewise for each category. **A shortfall is a
bug in your extraction, not a judgement call** — go back and find the one you merged.

For each enumerated item, collect two things separately and never merge them:

- **`evidence[]`** — file:line in a `role: "code"` source that proves the code does it. Documentation
  is not behavioural evidence; the validator enforces this.
- **`claims[]`** — every place the behaviour is *asserted*, of any kind (§3).

**Only then** add the semantic layer — "this component orchestrates those", "this is the ingest
boundary". That layer is useful for readability and is allowed, but it is inference: tag it
(§5) and understand that it is excluded from the audit.

---

## 2.1 · Mapping at scale — the swarm protocol

A subject too large for one pass is mapped by **several extractors and one conductor**. The fan-out
is the easy half. What follows is the half that goes wrong, and every rule here exists because a
merged map has to satisfy contracts that a single-agent map satisfies for free.

**The order is not negotiable, because the documentation harvest comes LAST.**

1. **The conductor freezes the source manifest first.** Every `role: "code"` path to be read and
   every `role: "doc"` surface that will be declared, fixed *before* any extractor runs. The doc
   union is a decision, not a discovery — if it is assembled by merging whatever the shards happened
   to open, it is different for every run.
2. **Shards partition the CODE surface by path, disjointly.** Each path belongs to exactly one
   shard, so `coverage.read` / `partial` / `skipped` union without collision, and one shard's
   budget exhaustion cannot be papered over by another's success. `validate.mjs` refuses coverage
   buckets that are not disjoint; a partition makes that impossible rather than merely unlikely.
3. **Extractors return nodes, edges and evidence — and NO `docHarvest`.** They read code. They may
   record `code-comment` claims, which live in the file they are already reading.
4. **The conductor reconciles identity GLOBALLY.** Two shards that both find the same shared helper
   found **one node**, not two. Dedupe by `id` and union the evidence; never namespace ids per
   shard, which would draw one helper as N boxes and quietly inflate the picture. `validate.mjs`
   refuses duplicate node, edge and view ids, so a naive concatenation is rejected outright.
5. **THEN one dedicated harvest actor runs, once, over the final node inventory.** It searches
   **every** declared doc surface for **every** final node — by name and by synonym (§3) — and
   authors the node-keyed `docHarvest` records directly.
6. **The conductor computes digests and runs `render.mjs` once**, on the merged map. Shards never
   write into `.maps/`: all four writes sit behind one fail-closed secret/PII scan (§1), and a shard
   writing its own fragment is a path around that gate.

**WHY THE HARVEST IS CENTRAL AND LAST, which is the load-bearing part.** Completeness is *derived*,
never declared: `diff.mjs` compares each node's `searched` against **every `role: "doc"` source the
map declares**, and a node whose search covered less is state 3 — its verdict is withheld, not
accused. In a merged map the declared doc set is the **union across all shards**. So a shard that
searched only its own slice of the docs produces, after merge, a node whose `searched` is a strict
subset of that union — and **every such node is withheld**. Shard the docs and the audit's one
absence-derived class stops firing across the whole map.

**That degradation is loud, not silent, and you may not rely on the loudness.** The page and the
Markdown twin both report each withheld verdict with its node, its searched set and what it missed,
and neither will print a clean bill of health while anything is withheld. That is a guardrail
against a *false* clean bill. It is not a substitute for running the harvest correctly.

**And the harvest cannot be faked by distribution.** `docHarvest` is an extractor **ATTESTATION**
(ADR C-018 amendment): the pipeline compares `searched` against `sources[]` and nothing anywhere
observes whether a search actually happened. So copying one central record into every shard's
output, or having each extractor repeat the same global search, adds **no mechanical assurance** —
only more places to drift. One actor, searching once, signing once, after the node inventory is
final, is the honest shape of that attestation.

**The harvest actor also owns doc-only capabilities.** A capability the docs describe and the code
does not have is a PHANTOM, and no code shard can find one by construction — it is looking at code.
The actor that reads every doc surface is the only participant positioned to notice.

**THE FINALIZATION GUARD.** A swarm run may be declared **complete** only if every node awaiting a
documentation verdict has a harvest covering the full declared doc union. If any node is withheld,
the run is **PARTIAL**: say so, name the withheld nodes, and do not describe the audit as finished.
This is a stricter contract that swarm runs accept on top of the schema — it is *not* a new
validator rule, and an ordinary single-agent partial map remains entirely legal as state 3.

**Coverage honesty is per-shard and survives the merge.** A shard that ran out of budget records its
remainder in `partial` / `skipped` and says so; the conductor carries those buckets through
untouched. Never let a merge turn one shard's unread file into the union's silence — §8 applies to
the assembled map exactly as it applies to a single-agent one.

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
  description asserts* (`text`). **Then record the search itself, on the node, as `docHarvest`** —
  §3.1. Without that record the item can never be reported UNDOCUMENTED, however thoroughly you
  looked.
- **`code-comment`** — read the comments **around every evidence line you already recorded**, plus
  file and function headers, banner/usage comments at the top of a file, and any block that
  describes options or behaviour. A comment that merely explains *how* the code works is not a
  claim; a comment that asserts *what the system does, defaults to, or supports* is.

  **A comment that LABELS or CLASSIFIES the code beneath it is asserting that classification**, and is
  therefore a claim you must check against the code. Section headers naming a mode, tier, category,
  phase or role; a header stating which variant a branch implements; a banner enumerating what a family
  of things returns — each says "the code below is *this kind of thing*", and each can be wrong while
  every surrounding line is right. These are the easiest claims in a codebase to leave behind, because
  the code is refactored and the label above it is not, and a reader trusts the label precisely because
  it looks like structure rather than prose. For every such label, read what the block actually does
  and confirm the two agree. Where they do not, that is a `contradictions[]` record: the label is the
  claim, the behaviour is the evidence, and the words of the label the behaviour falsifies are the
  `refutedQuote` (§5.1).
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

## 3.1 · The documentation harvest — record the search, not just the hits (ADR decision F)

UNDOCUMENTED is the one class derived from an **absence**, and an absence is evidence only if the
search that failed to find it was complete. So the map records the search.

**Every node's UNDOCUMENTED eligibility is three-state, and only the middle one accuses:**

| | State | Result |
|---|---|---|
| 1 | the node carries a `claimKind: "doc"` claim | no finding — it is documented |
| 2 | a harvest covered **every** declared `role: "doc"` source and found nothing asserting it | **UNDOCUMENTED** |
| 3 | no harvest, one that missed a declared doc source, a record the contract cannot read, **or** a map that declares no doc source at all | **no finding** — a coverage statement |

**Absence of a `docHarvest` record is state 3, always.** It is not a formality you can skip and still
get findings: a map with no harvest records raises **zero** UNDOCUMENTED, by design. This is the
mechanism that stops the audit accusing a capability **on the strength of a search your own record does
not attest** — a declared page your record never claims to have searched cannot become a finding.
**Read that literally, and read the disclaimer below it:** the check is against your record, not against
your reading. Nothing here can tell whether you opened the page; it can only tell whether you said you
did, consistently.

**And a map that declares NO `role: "doc"` source puts every node in state 3 — whatever its harvest
records say (ADR C-018 addendum).** State 2 is a comparison: `searched` against the doc surfaces the
map declares. Compared against *nothing*, that comparison succeeds **vacuously** — the set of unread
surfaces is empty because there were no surfaces — so `searched: []` would read as a complete harvest
on an **attestation that names no surface as searched**. It is also the only record the contract leaves you there, since a `searched`
entry naming an undeclared surface is a validation error. So the gate refuses it: **nowhere to look is
not the same as nothing to find.** Read this as a rule about `sources[]`, not about the node — the fix
is to declare (and read, and hash) the subject's documentation surfaces, and no record you write on a
node can substitute for that. Row 3 of the table above therefore covers four cases, not two: no
harvest, a harvest that missed a declared surface, a record the contract cannot read, and a map that
declares no documentation surface at all.

```jsonc
"docHarvest": {
  "searched":   ["<every role:\"doc\" source path>"],
  "candidates": [ { "path": "…", "line": 1, "quote": "the text you found",
                    "disposition": "asserts|mentions" } ]
}
```

- **`searched`** — the documentation surfaces you actually read for *this item*, each one a declared
  `role: "doc"` source **and classified in `coverage.read`**. A surface your own map files under
  `coverage.partial` or `coverage.skipped` may not appear here: you would be saying in one place that
  you never read the file in full and in another that you harvested a node against it, and an absence
  found in half a file is not evidence. Completeness is **derived** by comparing this list against the
  map's own doc sources; there is no `complete` field and writing one is a validation error. You state
  what you did, and the pipeline decides what it earns.
- **`candidates`** — every hit the search returned, *with what it turned out to be*.

### This record is an ATTESTATION you are signing — read this before you write one

**Nothing downstream can check whether you actually read anything.** Completeness is derived by
comparing two lists **you wrote**: `docHarvest.searched` and the `role: "doc"` entries in `sources[]`.
The validator checks that those two agree with each other, that the record is well-formed, that every
searched surface is one your own `coverage` calls fully read, and that every `asserts` was promoted
into `claims[]`. **It never opens a file to see whether you did.** So what the pipeline guarantees is
only that your record is **internally consistent**; the claim *"every doc surface I declared was
searched"* is **yours**, an attestation you sign and nothing verifies (ADR **C-018 amendment**,
2026-08-14). The map's readers will trust `searched` and `sources[].role` because there is nothing
else to trust. Two obligations follow, and they are yours alone:

1. **Declare every documentation surface, before you harvest anything.** An undeclared doc file is
   invisible to the whole mechanism: it is not in the set `searched` is compared against, so a harvest
   that never touched it still reads as complete, and every node that file documents is accused of
   being undocumented. **Under-declaring silently manufactures false accusations** — this is measured,
   not hypothetical: removing one of two declared doc surfaces from a real map took its UNDOCUMENTED
   findings from **20 to 35**, fifteen of them false by that map's own claims, with **no harvest rule
   firing and no coverage warning** to show for it — the C-018 gate accepts the reduced map's harvest
   records in full. It is not that the reduced map is error-free, and the difference matters: the
   surgery leaves one node uncited, which `validate.mjs` reports, and the committed map separately
   carries one pre-C-019 `refutedQuote` violation. Neither is a `docHarvest` error, and neither
   suppresses any of the 15 — so nothing in the harvest machinery, and no error the validator raises,
   stands between an under-declared surface and fifteen false accusations. That is the exact failure
   decision F exists to prevent, walked in through the front door. Enumerate the subject's docs from
   the filesystem —
   `README`s, `SKILL.md`, guides, `docs/**` — and **declare every one of them in `sources[]` with
   `role: "doc"`, hashed, and then classify each in `coverage` as `read`, `partial` or `skipped`**
   (`partial` and `skipped` state their reason).

   **Declaring and skipping is not the same as leaving it out, and the difference is the whole rule.**
   A `role: "doc"` source you classify `skipped` stays inside the set completeness is measured
   against, so no harvest can cover it — it may not appear in `searched` at all — and every affected
   node is **withheld**, loudly, in the coverage section. A file you simply never declare is outside
   that set: the harvest reads as complete without it and every node it documents is **accused**.
   The two are opposite outcomes, so `coverage.skipped` is never an alternative to declaring — it is
   what you write *after* declaring. Silence about a doc surface is the one thing the audit cannot
   detect.
2. **Write `searched` from what you read, never from what you intended to read.** Listing a surface
   you skimmed, or one you opened and abandoned, converts a shallow search into a licensed accusation
   against every node that surface documents. If you did not read it in full, it belongs in
   `coverage.partial` — and then it may not appear in `searched` at all.

**Omitting the record costs you findings; falsifying it costs someone else their afternoon.** The
first failure is loud and safe — the node is withheld and the coverage section says so. The second is
silent: a confident map accusing correctly-documented code, which PDR §14 names as this product's
top risk. When you are unsure whether you covered a surface, **withhold**. Under-reporting is the
designed-for failure; over-reporting is the one nothing catches.

### A hit is a candidate, not a claim

You search each item's **name and its synonyms** (§3), so the search is deliberately loose — and a
loose search whose every hit counted as documentation would replace a quiet failure with a louder
one. **Text that merely *mentions* a node is not documentation of it.** Disposition each hit:

- **`asserts`** — the text says what the item **does, defaults to, or is**. That is real
  documentation, so you must also **promote it into `claims[]`** as a `claimKind: "doc"` claim at the
  same `path`/`line`. The validator enforces the promotion.
  **A comparison asserts when the item you are harvesting is one of the things being compared**:
  *"`emit_investigate_outcome`, fails closed exactly like `emit_outcome`/`emit_question_outcome`"*
  tells the reader that `emit_question_outcome` fails closed, so for **that** node the line is
  documentation and is promoted — the same sentence, harvested for a *third* function it merely names
  in passing, would not be.
- **`mentions`** — the text names it and **predicates nothing of it**: a positional landmark ("the
  trigger fires right where `enforce_packet_budget` would"), a "see also", a cross-reference, an entry
  in a list of related things. Record it — a reader can then see you found it and judged it — and
  **do not** write a claim.

The test is not the grammatical form of the sentence but whether it leaves a reader knowing something
about **this item's behaviour**. Ask it per node, not per line: one line can `assert` for one node and
`mention` another.

**A disposition never silences a finding by itself.** Only a real `doc` claim does. A node whose
only candidate is a `mentions` is harvest-complete and still **UNDOCUMENTED**, which is correct: the
docs name it without ever saying what it does.

**Do not disposition a hit `asserts` to quieten a node.** That is §7.1's "do not invent a claim to
quieten a node", one step earlier in the pipeline, and it is the single edit that would make the
audit lie.

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
      "contradictions": [ { "claim": {…}, "evidence": {…},
                            "refutedQuote": "the exact words of claim.text that are wrong",
                            "statement": "the conflict" } ],
      "docHarvest": { "searched": [ "<every role:\"doc\" source>" ],
                      "candidates": [ { "path": "…", "line": 1, "quote": "what you found",
                                        "disposition": "asserts|mentions" } ] },
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
    { "id": "capabilities", "form": "table", "title": "…",
      "columns": ["<from the closed list below>"], "nodes": [] }
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
- **A table view's `columns` come from a CLOSED list.** The IR carries no cell data — the renderers
  derive every cell from the node — so a name they have no derivation for fills the whole column with
  `(no value for this column)`, and validation refuses it. The legal names, matched ignoring case and
  punctuation (so `Doc Status` = `docstatus`):

  `Capability` · `Name` · `Node` · `Label` — the node's label; `Id`; `Kind`; `Lane`;
  `Summary` · `Description` — the node's `summary`; `Inferred`; `Evidence`; `Claims`;
  `Documented` · `Docs` · `Documentation` · `Doc Status` — whether a `claimKind: "doc"` claim exists;
  `Drift` — the node's drift classes.

  Pick a header from that list rather than writing prose: a descriptive-sounding column
  (`What it does`, `Purpose`, `Role`) is derivable by nothing and renders empty in every row. Use
  `Summary` for what a capability does.
- **`docHarvest` is optional to the schema and load-bearing to the audit** (§3.1). Every path in
  `searched` must be a declared `role: "doc"` source **classified in `coverage.read`** — an undeclared
  surface, a `role: "code"` one, or one your own coverage calls `partial`/`skipped`, is a validation
  error, and so is a `complete` key. Every candidate must sit on a surface you actually searched, carry
  a non-empty `quote`, and name a `disposition`. An `asserts` candidate with no matching
  `claimKind: "doc"` claim is refused: **omitting the record costs you the finding.** What is NOT
  checked, and this used to claim it was: whether the disposition is TRUE of the line. Validation tests
  that `disposition` is in the closed vocabulary and that an `asserts` candidate has a `doc` claim at
  the same path and line — nothing verifies that the quoted text actually asserts anything of the node.
  A heading marked `asserts` and promoted consistently validates clean. **The disposition is yours to
  get right; the contract only checks that you were consistent about it** *(corrected 2026-08-28)*. Every one of those rules is enforced **twice, identically** — by
  `validate.mjs`, which reports it by path, and by the drift engine, which withholds the verdict rather
  than accusing on a record the contract would refuse.
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

## 4.2 · A label is a caption — write the readable one

*Owner decision, 2026-08-14. PDR §7 rule 3b and §7.1 rule 18 carry the same words.*

A `label` is **human-readable text for a reader**, not a token copied out of the source. Nothing in
the IR requires a label to equal a raw source string — only that it is non-empty and that the id is
derived from it. So write the caption that a reader of the hero understands:

```jsonc
{ "id": "outcome.exit_2_usage_or_precondition_failure", "kind": "outcome",
  "label": "exit 2 (usage or precondition failure)" }
```

**The one convention that makes a caption checkable.** A `kind: "outcome"` label's **outcome token**
is the label with **one trailing parenthetical caption** removed, inner whitespace collapsed to
single spaces, and the ends trimmed. Case is significant. `exit 2 (usage or precondition failure)`
→ `exit 2`.

Anything comparing your outcome labels against the vocabulary the source actually emits — ADR
C-015's coverage floor is the one that does — compares **that token**, in both directions. So:

- **Gloss in a TRAILING parenthesis, or not at all.** `exit 2 — usage error` is not a caption by this
  rule and will be read as an invented outcome. `exit 2 (usage error)` is.
- **A caption cannot launder an invention.** The gloss is stripped and the token underneath is still
  checked, so a node labelled `exit 7 (mystery)` fails on `exit 7` if the source never exits 7.
- **Do not caption to paper over a missing node.** A required outcome — `INFRA_ERROR` and `OVERFLOW`
  included, wherever a mode can reach `die_infra` or `emit_overflow` — must exist as its own
  `kind: "outcome"` node. Folding it into another node's caption satisfies nothing.

*Why this is in the skill and not only in a scorer.* The rule used to be "the label must equal the
raw token", enforced by an exact string comparison inside a scoring script and written nowhere. It
failed a map whose labels were true. A convention you are held to is one you get to read.

---

## 5 · Tagging discipline (ADR C-005)

The audit must never accuse on a vibe. Four tags carry that promise:

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
  - `claim` — **the claim your evidence refutes**: the one whose text has to change. One of *that
    node's own* `claims[]` entries, carrying the `text` it asserts;
  - `evidence` — **the observation that refutes it**. One of *that node's own* `evidence[]` entries,
    carrying a `note` quoting what is actually at that line;
  - `refutedQuote` — the exact words **inside `claim.text`** whose asserted value the evidence
    contradicts. Copy them from the claim; the validator checks that they are really there;
  - `statement` — what the conflict *is*, in a sentence.

  A record missing either citation, either quote, `refutedQuote`, or the statement fails closed. Never
  assemble a contradiction from two unrelated locations to make a finding look substantiated.

- **`docHarvest`** — the fourth tag, and the one that gates UNDOCUMENTED (§3.1). It is a statement
  about *your search*, not about the code: which documentation surfaces you read for this item, and
  what each hit turned out to be. Omit it and the node can never be reported **UNDOCUMENTED** — and
  that is the only class it gates. PHANTOM, STALE and UNVERIFIED are derived without ever reading a
  harvest, so a node carrying none is still accused wherever those fire: three of the four findings in
  this skill's own golden report sit on nodes with no `docHarvest` at all. It is also the one
  tag **nothing can verify** — it is checked only against the doc surfaces *you* declared, so an
  under-declared surface turns a complete-looking harvest into false accusations (§3.1).

The four classes, for orientation: **PHANTOM** (a `doc` claim with no evidence) · **UNDOCUMENTED**
(evidence, no `doc` claim, **and a complete `docHarvest`**) · **STALE** (both, and they disagree —
via a contradiction record) · **UNVERIFIED** (claimed, unevidenced, and marked unchecked).

---

## 5.1 · Point the contradiction at the claim that is WRONG

A STALE finding has two halves, and **they fail independently**. The verdict can be right while the
pointer is wrong — and a right finding aimed at the wrong line is its own failure mode, not a milder
version of a false positive. It is *worse* in one respect: nothing about it looks wrong. The
statement is true, both citations resolve, both quote real text, and a reviewer checking the finding
confirms the defect is real — while the report sends a maintainer to edit a line that was accurate,
and leaves the line that is actually stale unaccused.

**The run-4 case, verbatim.** Mapping `codex-gate`, the extractor recorded this on `mode.prepr`:

> The over-budget message tells the user to run `prepr --since-reviewed`, but no such switch exists:
> `_prepr_common` strips only `--multi` and keeps every other token as the `<base>` positional.

That is **correct**. The message really is at `codex-gate.sh:519`, the parser really is at `:1412`,
and the flag really would be swallowed. But the record's `claim` cited **`README.md:97`** — a line
about `prepr-delta` that the reviewer verified to be **accurate**. The genuinely stale
`claimKind: "user-message"` at `codex-gate.sh:519` was sitting **on the same node**, in `claims[]`,
simply not wired as the contradicted side. Every rule of the day passed, and `drift.json` told a
maintainer to fix a correct README line.

**What closes it.** `refutedQuote` makes you name the words that are wrong, and the validator checks
that those words are in the claim you cited. Here the refuted words are `prepr --since-reviewed`;
they appear in the `:519` message and nowhere in `README.md:97`, so the misdirected record is refused
— and, because the refuted text does sit in another of the node's claims, the error names that claim
so the fix is mechanical:

```jsonc
"contradictions": [{
  "claim":     { "path": "…/codex-gate.sh", "line": 519,
                 "text": "diff too large for one review — use 'prepr --since-reviewed' (Tier 2) or sharding (Tier 3)",
                 "claimKind": "user-message", "checked": true },
  "evidence":  { "path": "…/codex-gate.sh", "line": 1412,
                 "note": "the only flag _prepr_common recognises is --multi; every other token is kept as a positional" },
  "refutedQuote": "prepr --since-reviewed",
  "statement": "The over-budget message tells the user to run `prepr --since-reviewed`, but no such switch exists…"
}]
```

**Writing it, in order.** Say what the evidence shows. Find the words it makes false. Cite the claim
those words are in — not the claim that is *about* the same subject, and not the one you happened to
read first. When a node carries several claims about one behaviour, the refuted quote is what tells
them apart.

**What the validator can and cannot do for you.** It checks that `refutedQuote` is present, that it
occurs in the `claim.text` you named, and — when it does not — whether it occurs in a *different*
claim on that node. It cannot judge whether your statement is true, whether the evidence really
refutes the quote, or whether you chose the meaningful fragment. Those stay yours. A quote so short
it appears everywhere satisfies the letter of the rule and defeats its purpose: quote the assertion,
not a word from it.

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

For a swarm run this is the CONDUCTOR's single call on the merged map (§2.1); shards never invoke
it. `<map.json>` is your drafted map; `<outDir>` is where the four artifacts go — normally
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
4. **Declare every documentation surface, then record the harvest and disposition every hit honestly.**
   UNDOCUMENTED needs a complete search behind it; a hit that only *mentions* a capability never
   documents it. The harvest is an **attestation nothing can check** — an undeclared doc surface is
   invisible to the audit and turns into false accusations (§3.1). When unsure, withhold.
5. **STALE needs a complete contradiction record**: both citations, both quotes, the statement, and
   `refutedQuote` — **cite the claim that is wrong**, never a neighbouring one that is right (§5.1).
6. **Inferred nodes never accuse.** Unverifiable claims are marked, not guessed.
7. **Coverage is declared, never truncated silently**, and `.maps/**` is always excluded.
8. **The renderer writes the artifacts.** Never hand-edit an output; regenerate.
