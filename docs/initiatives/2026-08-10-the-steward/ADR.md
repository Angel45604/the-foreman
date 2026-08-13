# ADR — `the-steward` v0 (numbered decisions)

Decisions for the v0 scope defined in [`PDR.md`](./PDR.md). Evidence markers:

- **[verified]** — confirmed against a primary source (vendor docs, or real code / command output
  recorded in [`verified-contracts.md`](./verified-contracts.md)).
- **[observed in the reference repo, not re-verified]** — a real measurement taken during the
  empirical survey and recorded in [`verified-contracts.md`](./verified-contracts.md) §2.3.11, but
  **not re-run by the synthesizer, and its originating command was not preserved.** Weaker than
  *[verified]* on purpose: the decision it supports must not depend on the exact figure.
- **[observed, not re-verified]** — read from a primary source during Phase 0 but **not reproduced,
  and with no command, output, or version-pinned citation recorded** in `verified-contracts.md`.
  It is the weakest marker in the file, and for a *vendor* contract it additionally triggers
  ADR-23: an owner call, not a self-granted waiver.
- **[invented]** — our own design with no external prior art. Treated as a spike, not a pattern.

**A marker is a pointer, and the pointer must resolve.** No decision may carry *[verified]* unless
the evidence is in `verified-contracts.md`. Downgraded under that rule, and listed rather than
counted because the count has been wrong twice: ADR-8, ADR-9, the second half of ADR-10;
**ADR-15 and ADR-17**, the two vendor readings v0 used to act on (both now ruled on — ADR-23); and
**ADR-2, ADR-4, ADR-13, ADR-16, ADR-18**, each citing a claim the document does not contain.

Owner decisions are marked **(owner)** with the date.

**Numbering is historical.** Numbers are kept for decisions that genuinely survive the v0 cut, so
five rounds of review history stay resolvable. Cut decisions are listed once, by number, in
["Removed in v0"](#removed-in-v0) at the end. Three numbers are new: **ADR-30**, **ADR-31** and
**ADR-32**.

---

## ADR-1 — Core runtime: vendored, dependency-free Python 3, floor 3.9, asserted loudly **(owner, 2026-08-10; narrowed 2026-08-11)**

**Decision.** The core is a Python 3 package in a single directory, `tools/steward/`, with a
`__main__.py` entry point and flat absolute imports, copied into the target repo. It is invoked
plainly:

```
python3 -B tools/steward <subcommand>
```

**`-B` is part of the invocation, not an optimization** — see *Bytecode suppression* below. Every
invocation this bundle documents, every line the-steward prints, and every command string it
generates carries it. `PYTHONDONTWRITEBYTECODE=1` in the environment is the equivalent form and is
accepted anywhere `-B` is.

**`tools/steward` is the installed path; the bootstrap has the other one.** Before a core exists in
the target there is nothing at `tools/steward/` to run, so the first run is
`python3 -B <skill-dir>/core <subcommand>` from inside the target (ADR-20, *Where the core is copied
from*). Both forms carry `-B` — that is the invariant. The-steward **prints** the installed form
only once the core is installed; before that, and on a foreign-core collision, it prints no
`tools/steward` command at all, because that would name a path it did not install.

**There is no launcher and no interpreter pin file.** Those existed only because a git hook must
resolve an interpreter deterministically outside a login shell; v0 installs no hook. Instead the
core **asserts its own interpreter meets the 3.9 floor as its first action and fails loudly with
the observed version if it does not.**

**Zero third-party dependencies**, asserted by an import-audit test. This is not a preference: at
the floor there is no `tomllib` and no `yaml` **[verified]**, and an opportunistic `import yaml`
would succeed on 3.13.5 and fail on 3.9.6 — interpreter-dependent behavior in a determinism tool.

**Bytecode suppression, and the mechanism matters [verified].** `PYTHONDONTWRITEBYTECODE=1` and the
`-B` flag are the **normative** mechanism. `sys.dont_write_bytecode = True` in the source is
belt-and-braces only and was **verified insufficient**: `__main__` is compiled and cached before its
first line executes, so a *bare* `python3 tools/steward` creates `__pycache__/` and makes "read-only
writes nothing" false on first run.

**Nothing the core can do at runtime fixes that, so the invocation carries it** — into the canonical
form above, into every command the-steward prints or generates, and into every command in this
bundle; the core also sets `PYTHONDONTWRITEBYTECODE=1` for any child it spawns. A bare invocation is
not supported: the core **reads `sys.dont_write_bytecode` immediately after the floor assertion and
before the belt-and-braces assignment sets it** — assigning first would make the notice unfireable —
and prints one line saying suppression is off and to re-run with `-B` (P1.8 asserts the line
appears). It does **not** exit non-zero for it: a wrong-invocation warning is not a finding about
the repository, and making it one would tie the exit code to how the tool was launched.

**The "writes nothing" fixture must therefore be dual-interpreter and must name cache paths
directly [verified]:** on Apple's CLT 3.9.6 a `git status --porcelain` assertion is **vacuously
green**, because that build's patched `sys.pycache_prefix` redirects bytecode to
`~/Library/Caches/com.apple.python`. Specified in full at P1.8.

**Containment of the vendored directory (owner, 2026-08-11).** The line a host repo needs is —

```
tools/steward/** linguist-vendored
```

— plus the detected host-linter exclusion. **`.gitattributes` is an ordinary create-only artifact
and ADR-20 decides it with no special case**, in the same three states ADR-20 classifies everything
else into: **absent** → `generate` creates it carrying that line; **ours** (recorded, and the bytes
are still the recorded bytes) → re-rendered in place like any owned artifact; **not ours** → never
written, and the report prints that exact line verbatim as an advisory. A foreign-core collision
needs no case here at all, because `generate` then writes nothing anywhere (ADR-20): no line is
created and no advisory is printed. A containment line an earlier run *did* write stays on disk
while the collision persists, and the collision report says so — nothing rewrites a file to retract
it.

The **bare** attribute form is required: `tools/steward/` and `tools/steward` are both verified
**no-ops**, and `=true` is a *different git attribute state* (`true` vs `set`) that Linguist's own
docs do not use **[verified, owner 2026-08-11]** (`verified-contracts.md` §2.3.7). **`doctor` makes
no containment claim either way** — there is no "containment in effect" state to get wrong.

## ADR-2 — Contract manifest: `.steward.json`, canonical JSON, one stored digest

**Decision.** The contract manifest is a single **tracked JSON file at the repository root**,
`.steward.json`, written canonically: 2-space indent, sorted keys, LF endings, exactly one trailing
newline. A `$schema` key points at the vendored schema by relative path, and that reference always
resolves because **the manifest is never written unless the core is installed** (ADR-20: a
foreign-core collision means `generate` writes nothing at all).

**Why that path [verified].** Each alternative is independently disqualified: under `tools/steward/`
it **inherits `linguist-vendored`**, collapsing the confirmation record out of code review;
**untracked**, `git clean -xdf` destroys it; a `.steward/` directory buys nothing over one file.

**And trackedness is a finding, not an assumption.** `generate` cannot stage its own output, so a
fresh manifest is untracked; without a finding the repo stays green forever on a control plane one
`git clean -xdf` deletes. `doctor` **inspects** whether `.steward.json` is in the index and reports
untracked-or-removed as a **`warn`** (ADR-13) — loud, and still exit 0 for the greenfield criterion.

**Why JSON.** At the ADR-1 floor there is no stdlib TOML reader — `import tomllib` is unavailable at
3.9.6 **[verified**, §2.3.5**]** — and the stdlib ships no TOML *writer* **[observed, not
re-verified]**. JSON is the only format this runtime round-trips with no dependency, and canonical
serialization is what makes render-and-diff possible at all.

**What it records** — and only what a read-only tool needs:

- the approved command set and the declared path list — **the two ADR-11 record sets C1 and C2 take
  their claims from** (ADR-32), each command record carrying a closed `resolution` kind (ADR-18).
  They are *rendered* into the agent docs as **Verification Commands** and the **Source of Truth
  Map**, and the rendered sections are output that is never read back,
- the declared docs scope and, over it, the frontmatter schema — a list of required key names
  (ADR-31),
- an `intentionallyEmpty` record **per declared scope**, where one is legitimately empty (ADR-30),
- **the paths the-steward created**, each with its kind — **rendered** (a renderer produced it, so
  C4 can re-render it) or **copied** (the vendored core, ADR-20: bytes we copy, not bytes we
  render) — and the digest of the whole file as we last wrote it,
- scan confidence per inference.

**The manifest does not record itself, and there is no digest of it anywhere** — it is the control
plane, not an artifact (ADR-20 gives the argument). Its integrity check is schema validation, and a
manifest that fails it is **exit 2** with expected-vs-observed detail — never a pass over a manifest
we could not read, which is ADR-30's vacuous pass in another hat.

### The temporal rule

- **Banned everywhere:** *observation* timestamps — anything recording when a tool ran
  (`generatedAt`, `lastCheckedAt`, `scannedAt`). They change on every run, destroying render-and-diff
  and producing pure-churn commits.
- Provenance is a **version identity** (`<renderer>@<version>`), never a wall-clock time (ADR-8).
- Where a date is genuinely needed, it comes from `git log -1 --format=%cI` at read time, and is
  never stored in an artifact.

### One stored digest, one recomputation

v0 has exactly **two** digest operations, and conflating them was a defect in an earlier draft: the
**stored** digest — the artifact as we last wrote it, living in the manifest — and the
**recomputed** one, a fresh render from current sources, never stored.

**Both are the same function over the same bytes: SHA-256 over the whole file, always (ADR-9)** —
**one comparison domain** for every artifact v0 writes, never a git blob id and never a mix, because
a domain that changes with the file's git state makes a byte-identical artifact compare unequal to
itself across `git add`. The two comparisons answer two questions: *stored vs on-disk* — "are these
the bytes we wrote?" — and *recomputed vs on-disk* — "is this stale?". There is no `input` or
`corpus` digest: with pure renderers, re-rendering **is** the freshness check, and a cached input
digest is a second source of truth that can disagree with it.

**Four states for a recorded path, and they are what C4 reports** (ADR-20 decides the writes):

| Stored vs on-disk | Re-render vs on-disk | Meaning | Severity | `generate` |
|---|---|---|---|---|
| match | match | in sync | none | no-op |
| match | differ | source moved ahead — **stale** | `warn` | rewrites it |
| **differ** | either | **these are not the bytes we recorded** | `error` | **never writes it** (ADR-20, *a record is evidence, never a grant*) |
| — | — | the recorded path is **gone from disk** | `warn` | re-creates it (it is *absent*) |

The third row does not branch on the re-render, because a path whose bytes we do not recognize is
not written whatever the re-render says. There is no bookkeeping-only "content current, digest
stale" state to re-stamp either: the manifest is rewritten every run with the digest of what was
actually written (ADR-20), so that combination only arises from a hand-edited or foreign manifest —
which is row 3, reported and left alone.

A **copied** path has no renderer, so C4 has nothing to re-render and it is not a document (ADR-10);
its stored digest is compared only by `doctor`'s recorded-path check (PDR §3), which is where a
hand-edited vendored file surfaces.

## ADR-4 — v0 makes no enforcement claim of any kind

**Decision.** No text the-steward generates, prints, or documents may say that it protects, gates,
enforces, or guarantees anything. The permitted claim is exactly: *the-steward reports what is true
about this repository's agent docs; whether anything acts on that report is up to you.*

**Why.** Local hooks cannot be an enforcement boundary and pretending otherwise is this tool's
worst-case self-deception: `--no-verify` bypasses them, clone does not copy them, and a
non-executable hook yields only a suppressible `hint:` while the commit succeeds. All three are
**[observed, not re-verified]**, and v0 acts on none of them — they are motivation for installing no
hook, so the decision holds either way and nothing escalates (ADR-23). "Protected by the-steward" is
a false claim; "checked by `python3 -B tools/steward doctor`" is a true one.

**Consequence, and it is the product.** The-steward installs no enforcement and reports exactly what
it inspected of the enforcement you already have — labelled as inspection, bounded to what it looked
at (ADR-28, A3).

## ADR-8 — Renderers are pure

**Decision.** Every renderer is a pure function of declared inputs: no clock, no randomness, no
absolute paths, no unsorted map iteration, no environment reads. Provenance (which renderer version)
appears as a version identity in the manifest, never as a time.

**Why [observed in the reference repo, not re-verified].** The reference repo holds the A/B proof in
one codebase: its generated doc-tree index embeds a `generatedAt` timestamp — **19 pure-churn commits
of the 71** that touched it — while a sibling generator supports a working `--check` mode *precisely
because* its output carries no timestamp (`verified-contracts.md` §2.3.11, row 3 — **not re-run by
the synthesizer, originating command not preserved**; the contrast, not the count, is what the
decision rests on). A wall-clock stamp in a generated artifact permanently destroys freshness
checking, and purity is what makes C4 possible at all: the check *is* a re-render.

Asserted by a determinism test that renders twice and byte-compares, and by a lint over renderer
modules for clock/random/cwd/absolute-path access.

## ADR-9 — Freshness is a content digest, never mtime

**Decision.** Freshness is a **content digest**: **SHA-256 over the whole file, in every case**.
Where a date is genuinely required, use `git log -1 --format=%cI`. **Never `mtime`, and never a git
blob id.**

**One digest domain, no optimization (changed 2026-08-11).** An earlier draft used the git blob id
on clean files and SHA-256 on dirty ones — two domains for one question, so `git add` alone made the
tool report bytes it had written as bytes it did not recognize. The fast path is deleted; the cost
is hashing a few small files.

**Why [observed in the reference repo, not re-verified].** `mtime` is meaningless after any fresh
clone, in any linked worktree, and on every CI runner — a property of git, not a measurement. The
reference repo shows the bug live: a tracked `.editorconfig` with an mtime of **2026-02-21** against
a last commit of **2023-10-23**, while the repo's own audit script ships an mtime-based drift check
that is therefore unsound everywhere it matters (`verified-contracts.md` §2.3.11, row 2 — **not
re-run, originating command not preserved**).

## ADR-10 — Corpus enumeration via `git ls-files -z`, over an explicit document predicate

**Decision.** Enumerate the document corpus with `git ls-files -z -- '*.md'`, spawned with an
argument vector (never a shell string) and an explicit output cap. **Never `find`.** Exceeding the
cap is **exit 2** with the cap named — a corpus we could not read whole must not read as a corpus we
checked.

**A document is a tracked `*.md` path that git does not mark as vendored or generated** — two
conditions and no taste: the `*.md` pathspec (which alone excludes `.gitattributes`, `*.py` and every
other tracked non-document), and `git check-attr -z linguist-vendored linguist-generated` reporting
neither attribute in any state but `unspecified`, `unset` or `false` — **`set` and every *valued*
form (`=true`, `=vendor`) both exclude the path**, because both are somebody's deliberate marker and
matching only the literal word `set` would admit the valued ones. That excludes someone else's
tracked vendored documentation using git's own markers — the ones the-steward writes for its own
core (ADR-1). Without a predicate the corpus is
every tracked byte in the repository, and C3, C4 and the indexes inspect the wrong files.
**The corpus serves C3, C4 and the indexes only** — C1 and C2 never read it, because their claims
come from the manifest's two record sets (ADR-32).

**Plus the documents the manifest records as ours** — its **`rendered`** paths satisfying the same
predicate, deduped and sorted; **`copied` paths are never in the corpus** (ADR-2). `git ls-files`
lists the index, and an artifact `generate` created seconds ago is not in it until a human runs
`git add`; enumerating the index alone would make `check` skip the very files it just wrote — a
vacuous pass (ADR-30) on the greenfield path. The union stays bounded, because nothing but our own
short schema-validated record list is added.

**Two corpora, one fixed exclusion, because an index cannot be its own input.** The **checking
corpus** — the union above — is what C3 and C4 examine. The **source corpus** the indexes render
from is that corpus **minus the two index outputs** (`docs/steward/routing-map.md`,
`docs/steward/orphans.md`): a fixed exclusion of two contract paths (ADR-20), not a heuristic.
Without it, first generation renders one graph while the immediate re-render sees the two files just
written and renders another — C4 reporting freshly generated output as **stale**. The indexes stay
*checked*; they are simply not *indexed*. First-generation fixture in P6.3.

**Why [verified].** In the reference repo `find . -name '*.md'` returns **175,944** paths against
`git ls-files '*.md'`'s **1,091** — re-run by the synthesizer (`verified-contracts.md` §2.3.11,
row 1). Its `find`-based doc-tree builder now dies with `ENOBUFS`; the last successful build was
2026-06-15 (row 6, *observed, not re-verified*). Git's own index is correct and bounded.

## ADR-11 — Scan-then-confirm: the manifest record state machine

**Decision.** Automate evidence collection; ask a human only where inference confidence is low; and
never silently reopen a settled answer. Each manifest record carries a state:

- **proposed** — a scanner inference. Reported as `warn` on violation, never `error`.
- **confirmed** — human-approved. Reported as `error` on violation.

**There are exactly two stored states, and `drifted` is not one of them.** *Drifted* — a confirmed
record whose stored value no longer matches reality — is **derived at read time** from the record
and the repository, and reported as an `error` saying "re-confirm or revert." It is never written,
because nothing could write it: `scan` persists nothing, `generate` leaves a confirmed record
exactly as the human left it, and deltas go to `scan.pending[]` (below). A stored third state would
be a transition with no operation able to perform it — which is what an earlier draft specified.
The schema admits `proposed | confirmed` and nothing else.

Three rules make the machine honest:

- **`scan` persists nothing. `generate` is the only verb that writes a record.** `scan` prints its
  inferences as `info` and changes no byte on disk; a re-scan's deltas reach `scan.pending[]` only
  through the next `generate`, in the same manifest write ADR-20 already performs. One writer, one
  write — that is the whole persistence story.
- A re-scan **may not mutate a matching confirmed record.** Deltas land in `scan.pending[]` and are
  reported as `info`; the confirmed record is left exactly as the human left it.
- A confirmed record is **never auto-deleted.** "The command vanished" is precisely the drift worth
  reporting — it is A1.

**Confirmation is a human edit to a tracked file, and there is no prompt anywhere in v0.** A record
becomes `confirmed` when a human changes its `state` in `.steward.json` and commits it — which is why
ADR-2 keeps the manifest tracked, at the root, and out of `linguist-vendored`: the confirmation
record *is* a reviewable diff. `generate` behaves identically with or without a TTY: it never asks,
never blocks, never promotes an inference, so an unreviewed manifest can neither fail a build nor
declare itself approved. Deleting the prompt deleted the whole "what does it do when nobody is at the
keyboard" class, which had produced consent defects in three rounds.

**Waivers are confirmed records, not a separate mechanism.** A record may carry
`waived: {reason: "..."}`, downgrading its finding to `info` and requiring the reason. It is keyed
to the record it excuses, so it cannot absorb a different problem that later occupies the same path,
and a waiver whose target is gone is itself reported. No expiry: v0 blocks nothing, so a timed
waiver is machinery with no consequence, and date-driven checks are the churn ADR-13 rejects.

**Why.** Modeled on `detect-secrets`' baseline behavior, with one deliberate divergence:
detect-secrets auto-removes vanished findings, which for this tool would erase the exact signal it
exists to raise.

## ADR-13 — Severity and exit status

**Decision.** Three severities and three exit codes. Nothing else.

| Finding source | Severity |
|---|---|
| Violation of a **confirmed** record, including one reported as **drifted** (ADR-11) | `error` |
| Violation of a **proposed** record | `warn` |
| A generated artifact that is **stale** — stored digest matches on-disk, the re-render differs (ADR-2) | `warn` |
| A recorded artifact whose **on-disk bytes are not the bytes we recorded** (ADR-2 row 3) | `error` — never written to (ADR-20). It is *not ours*, so for a routing peer it also suppresses its peer's write (ADR-15) |
| **Frontmatter outside the documented subset** (ADR-31) | `error` — naming file, line and construct; never a silent skip |
| `AGENTS.md` **exceeding Codex's document byte cap** (ADR-17) | `warn` — the cap is unverified vendor prose; it becomes `error` only if the cap is verified against the pinned binary |
| An **empty declared scope**, *per scope key*, with no `intentionallyEmpty` record for **that key** (ADR-30) | `error` — with such a record it is the ordinary record severity: `warn` while `proposed`, `info` once confirmed |
| **Any check over a declared scope on a repo with no manifest** — nothing declares a scope, 0 items examined (ADR-30, ADR-32) | `info` — the report states the 0 cardinality and its reason (for C1/C2: *no claim source — nothing to verify*); exit 0. The vacuity rule governs scopes we manage, and an unmanaged repo declares none |
| A command record whose `resolution` is **`external`** (ADR-18) | `info`, tier *inspected* — a human's declaration reported verbatim, counted **separately** from checked claims and never as coverage (ADR-30) |
| A path the manifest records as ours that is **missing** | `warn` |
| **`.steward.json` is not tracked** — untracked, or removed from the index (ADR-2) | `warn`, tier *inspected* — `git clean -xdf` destroys an untracked control plane |
| A target we would write that is **not ours** — it exists and no record claims it | `info` — reported as *not managed*, never as coverage |
| A target we would write that is **absent with no record** — an unmanaged repo, or a target `generate` has not created yet | `info` — reported as *not managed*, never as coverage. This row exists because ADR-20's classification has three outcomes and a state with no severity is a bug (P7.5) |
| A **foreign collision on `tools/steward/`**, which makes `generate` write **nothing at all** (ADR-20) | `warn` — the report names the occupied path and states that nothing was written anywhere. Not `info`: a run that wrote nothing must not read as a clean pass (ADR-30). Still exit 0 — no claim in the repository is false |
| `scan.pending[]` items, orphan-report entries, every **inspection** or **inference** finding **with no explicit row above** | `info` |
| Anything carrying a `waived` reason | `info` |

| Exit | Meaning |
|---|---|
| `0` | no `error` findings |
| `1` | at least one `error` finding |
| `2` | the tool itself failed and **no finding set can be trusted**: an unhandled exception; a spawned git command failed unexpectedly or **exceeded its output cap** (ADR-10); the interpreter floor assertion failed; `.steward.json` is present but fails schema validation (ADR-2); a path escapes the working tree (ADR-26) |

**A tool fault must never read as a pass**, which is the only reason exit 2 is distinguished at all.
There is no further exit-code contract: v0 has no caller whose behavior depends on one.

**No date-based staleness may ever be an `error`** — date thresholds incentivize metadata-only churn
**[observed, not re-verified]**, and auto-stamping a `last_verified` field would *manufacture* the
false claims this tool exists to detect.

**The severity map is exhaustive over every state ADR-2, ADR-11 and ADR-20 can produce**, asserted by
the enumeration test in P7.5 — which also asserts the two explicit rows that outrank the general
inspection row: **manifest trackedness and a missing recorded path stay `warn`**, not `info`. A state
with no row here is a bug; the test has caught exactly that twice.

## ADR-15 — Claude shim: `CLAUDE.md` carries the routing content directly **(owner, 2026-08-12)**

**Decision.** `AGENTS.md` is canonical. `CLAUDE.md` is an **ordinary whole-file owned artifact**
(ADR-20) with the routing content **written directly into it**. No import, no marked region, no
sentinels. Not a symlink.

**They are one routing unit, and it is all-or-nothing (owner, 2026-08-13).** `generate` writes
**both or neither**: if **either** path is *not ours* by ADR-20 — it exists and either nothing
records it **or** its bytes are not the bytes we recorded — **neither file is written**. Every
uncoupled target (the indexes, `.gitattributes`, the manifest) is still written.

**A recorded-but-modified peer is *not ours*, full stop (owner, 2026-08-13).** It reports `error`
(ADR-13) and it suppresses its peer's write **exactly like a foreign file**. One rule, no
exceptions: the write predicate is the bytes (ADR-20, *a record is evidence, never a grant*), and a
file whose bytes we do not recognize is a file we may not render routing beside. The remedy is v0's
universal one — `git checkout` or `rm`, then re-run.

**Every pair state, and what each peer gets.** A peer is in exactly one of five states; the first
three are writable, the last two are *not ours* and suppress the whole unit:

| Peer state | Condition | Written, if the unit is not suppressed? | Severity for that peer |
|---|---|---|---|
| **ours** | recorded, bytes match | yes, re-rendered | none in sync; `warn` if stale (ADR-2) |
| **absent, unrecorded** | no file, no record | yes, created | none once created; `info` *not managed* if the unit is suppressed |
| **absent, recorded** | recorded, file gone | yes, re-created | `warn` — a path we wrote that is missing (ADR-13) |
| **foreign** | exists, nothing records it | **no** | `info` — *not managed* |
| **recorded mismatch** | recorded, bytes differ | **no** | **`error`** — *not the bytes we wrote* |

**The unit rule:** if either peer is **foreign** or **recorded mismatch**, neither peer is written
this run. Each peer still reports its own row — the suppressed peer's line names the peer that
suppressed it, so a report can never say "nothing written" without saying why. A suppressed peer
that is *ours* is simply not re-rendered this run and keeps its ordinary C4 severity. Fixtured
state-by-state in P6.4(b) and enumerated in P7.5.

**Why it is structural, not tidiness.** Rendering `CLAUDE.md` from our manifest beside a foreign
`AGENTS.md` installs instructions contradicting the repo's own canonical file while reporting that
file as merely *unmanaged* — the tool becoming the source of the drift it exists to report. The
coupling makes the state unreachable instead of warning about it. Fixtured both ways in P6.4(b).

**The two files duplicate the routing content, and that is fine because the tool owns both.**
Keeping them consistent is the **renderer's** job, not a human's or a harness's: both render from
the same manifest (ADR-8) and **both are regenerated in the same `generate` run**, so they cannot
drift apart without C4 reporting it. **And the duplication cannot produce two competing claim
sets**, because neither rendered file is ever read back: C1 and C2 read the records (ADR-32). The previous design avoided the duplication with an
`@AGENTS.md` import inside a machine-owned region — one un-duplicated line bought with an invented
protocol (the deleted ADR-7) and an unverified claim that the import expands at all.

**Why the shim exists at all — [observed, not re-verified], and v0 still acts on it.** The reading is
that Claude Code reads `CLAUDE.md`; it came from Anthropic's documentation in Phase 0 and
`verified-contracts.md` records no probe of it. **Product code generates the file on that reading
alone**, so E1's ruling is **proceed with stated risk** (ADR-23), not *drop the dependency* — what
round 7 dropped was the `@AGENTS.md` **import-expansion** contract, which is a different claim.
**The remaining blast radius if the reading is wrong:** a real file the-steward creates, records,
owns and re-renders in every target repo that no harness ever reads — redundant bytes plus a
permanent C4 surface, reported green. Bounded by what is *not* at risk: nothing is routed through a
line that must expand, so no agent silently loses the routing content.

## ADR-16 — Nesting: root is canonical, nested is opt-in and warned

**Decision.** The root `AGENTS.md` is the single canonical source. Nested `AGENTS.md` files are an
explicit opt-in that the generator **warns** about. Generated docs state the chosen semantic
explicitly and never imply that an ecosystem standard exists.

**Why [observed, not re-verified].** There is no standard, and the implementers disagree: the
`agents.md` homepage says the closest file wins, Codex's docs say it concatenates all levels
root→leaf under a byte cap, and Claude Code does not load subdirectory instruction files at launch
at all. The spec issue asking exactly this is unanswered. All three readings are vendor prose with
no record in `verified-contracts.md`, and the decision **encodes neither as truth** — so a wrong
reading changes no v0 behavior and nothing escalates (ADR-23).

## ADR-17 — Codex's document byte cap is checked, and reported as a `warn` **(owner, 2026-08-12)**

**Decision.** The generated `AGENTS.md` is **checked** against Codex's `project_doc_max_bytes`
(default **32 KiB**) and exceeding it is reported as a **`warn`**, not an `error`. Nothing is
enforced (ADR-4). **No line-count check exists (owner, 2026-08-13)** — the ~200-line warning is
deleted, with the vendor reading it rested on.

**Why `warn` and not `error` (owner, 2026-08-12, resolving what was escalation E2)
[observed, not re-verified].** Codex is understood to stop accumulating at the cap with the excess
**silently** dropped — a truncation indistinguishable from success, exactly the class this tool
exists to detect, which is why the check is worth keeping. But it is unverified vendor prose:
`verified-contracts.md` contains no probe of `project_doc_max_bytes` and no version-pinned source for
the value or its silence — the number appears there only in cross references citing *this* ADR.
**v0 fails no repository on a number it cannot back**, so the finding is a `warn` and **upgrades to
`error` the day the cap is verified against the pinned binary** (extract the default, overrun it
once, record command and output). It is one of the **two** vendor readings v0 still acts on —
ADR-15's `CLAUDE.md` is the other — and setting the severity to what the evidence supports is what
ADR-23 asks.

## ADR-18 — Subprocess discipline, and documented commands are never executed

**Decision, two halves of one rule.**

1. **Every child process the core spawns is `git`**, invoked with an explicit argument vector (never
   `bash -lc`, never a shell string), an explicit `timeout=`, and an explicit output cap.
2. **A documented command is verified structurally and never executed.** C1 resolves each record in
   the manifest's **approved command set** (ADR-32 — no document is read) against the repo's own
   declarations: package scripts, Makefile targets, task-runner entries, a tracked executable at
   that path.

**A command record carries a closed `resolution` kind, because state and confidence cannot express
this distinction.** Exactly two values, and the schema admits no others:

| `resolution` | Meaning | C1 behavior |
|---|---|---|
| **`repo-declared`** | the command is claimed to resolve to one of the repo's own declarations above | resolved structurally; unresolved → a finding at the record's severity, tier *resolved* (this is A1) |
| **`external`** | the command names a tool the repository does not declare and is not expected to (`docker`, `shellcheck`) | **not resolved and not counted as checked**: `info`, tier *inspected*, counted separately in the cardinality line (ADR-13, ADR-30) |

**`external` is a human's declaration and the scanner may never write it.** A scanner cannot
distinguish "a legitimate external tool" from "a command that does not exist" — that is precisely
A1 — so inventing the distinction would manufacture the false claim this tool exists to detect.
`scan` therefore proposes **`repo-declared`** always; `external` is only valid on a `confirmed`
record, which the schema enforces and which is a human edit to the tracked manifest reviewed as a
diff (ADR-11). **C1 never consults `PATH`** for either kind: whether a tool is installed on the
machine running `check` is not a fact about the repository, and making it one would give the same
repo different findings on different machines.

**Why.** Executing documented commands would run arbitrary repository code from a read-only tool and
turn a determinism check into a build-environment check. Scraping a vendor CLI's output is the same
mistake's second half: the reference doctor asserts literal substrings that become permanent no-ops
the moment the vendor rewords **[observed, not re-verified]**. Structural resolution has neither
failure mode.

## ADR-20 — Ownership is binary, writes are create-only, and the manifest is written first **(owner, 2026-08-11)**

**Decision, in one line: the-steward never writes bytes it did not write.** Ownership is binary —
a path is **ours** or it is not — but *classification* has **three** outcomes, because a path that
does not exist has no bytes to protect and creating it is how anything becomes ours at all:

| Classification | Condition | Behavior |
|---|---|---|
| **ours** | `.steward.json` records this path **and the bytes at it are the bytes the record says we wrote** | render in place |
| **absent** | the path **does not exist** on disk | `generate` **creates** it and records it as ours **in the same run** — the only way a path becomes ours. `check` / `doctor` write nothing: with no record it is simply not managed (`info`); with a record it is a path we wrote that is now missing (`warn`, ADR-13) |
| **not ours** | the path **exists** and is not *ours* by the row above — no record claims it, **or** a record claims it but the bytes differ from the recorded digest | **never written to.** Reported: *not managed* (`info`) when nothing records it, *not the bytes we wrote* (`error`) when a record claims it |

***Absent* is split out because the two-row version was unsatisfiable** — with no manifest on a first
run, every target was permanently unwritable. Nothing else widens: *absent* means no file at that
path, checked immediately before the write, and a path existing in any form (regular file,
directory, symlink, broken symlink) is **not** absent.

A pre-existing target is reported and left **byte-identical** — never adopted, overwritten, backed
up, or moved. A human who wants it managed moves it aside and re-runs `generate`. There is no adopt
path, therefore no pre-adoption bytes, no backup store, and no origin distinction in the design.

**One coupling, and only one: `AGENTS.md` + `CLAUDE.md` (ADR-15, owner 2026-08-13).** They carry the
same routing content, so they are classified as a **unit**: if either is *not ours* — by **either**
limb of the row above, no record **or** recorded-with-different-bytes — neither is written. Each
peer still reports at its own severity (`info` *not managed* / `error` *not the bytes we wrote*);
ADR-15's table is the complete state list. No other target is coupled to anything — the indexes,
`.gitattributes` and the core are classified independently, as the table above says.

**The target set is fixed and its paths are part of the contract.** `generate` writes only:
`.steward.json`, `AGENTS.md`, `CLAUDE.md`, `.gitattributes` (ADR-1), the vendored core under
`tools/steward/`, and the two doc indexes — **`docs/steward/routing-map.md`** and
**`docs/steward/orphans.md`**. The index paths are neither configurable nor inferred from the repo's
docs layout: a fixed path is a claim a reader can check, a negotiated one is a second contract to
keep true. `generate` creates `docs/steward/` when absent, including in a repo with no `docs/`
convention. Each index is then an ordinary create-only artifact, and if `docs/steward` exists as a
non-directory both are simply *not ours*.

### A manifest record is evidence, never a grant **(owner, 2026-08-12)**

**A record alone can never authorize writing an existing file.** The write predicate is the *bytes*:
we overwrite a path only when what is there is **byte-identical to what the record says we last
wrote**. Anything else that exists — a human edit, a partial write, a stale record, a hand-authored
`.steward.json` naming a file it never produced — is **reported and left exactly as it is**. Fixtured
in P6.4(d). This closes a bypass the record-only rule left open: `.steward.json` is a file anyone can
write, so *naming* a pre-existing `AGENTS.md` used to make it ours and the next `generate` overwrote
it as stale.

**The bound, honestly:** a manifest recording a path *together with the exact bytes now at it* is
indistinguishable from one we wrote. Nothing on disk closes that; review does, for the reason the
next section gives.

**Consequence: `--force` is gone and v0 has no flags at all.** Its only power was re-rendering over a
hand-edit — exactly the case this rule forbids. A hand-edited owned artifact is an `error` (ADR-13)
whose remedy is the human's: revert it, or remove it and let the next `generate` create it as
*absent* — the same remedy create-only already gives for a *not ours* path.

### The manifest is the one path this rule cannot cover, and pretending otherwise is circular

`.steward.json` cannot be *recorded as created* without the record already existing, so
classification does not apply to it and **`generate` writes it every run**. It is never digested,
never compared, never in its own recorded-paths list (ADR-2).

**The-steward cannot tell a foreign `.steward.json` from its own, and does not try** — the file *is*
the ownership proof, so there is nothing else to consult. Whatever sits there is the contract if it
validates and **exit 2** if it does not: never a silent reset, never a pass. What makes that safe is
review, not ownership: tracked canonical JSON at the root means every `generate` is a reviewable
diff, git history is the undo (PDR, "Undo"), and a rewrite dropping a human's `confirmed` state —
which ADR-11 forbids — would show up in it. That is also what bounds the byte-match rule above.

### The vendored core is one prerequisite, and no core means no run **(owner, 2026-08-12)**

Treating a many-file directory as one owned artifact hides two failures: a **foreign directory**
already at that path, and a **foreign child** inside an otherwise-ours core that a directory-level
re-copy would overwrite. So it is an **all-or-nothing bootstrap prerequisite**:

- The manifest records **each vendored file individually**, with its digest, as kind **`copied`**
  (ADR-2) — not rendered, so C4 never re-renders it and the corpus never contains it.
- If `tools/steward/` **exists and is not fully ours** — no record at all, any child present that the
  record does not list, or a recorded child whose bytes are not the recorded bytes — then the core
  **cannot be installed**, and **`generate` writes nothing at all: not the manifest, not `AGENTS.md`
  or `CLAUDE.md`, not `.gitattributes`, not the indexes, nothing under `tools/steward/`.** The run
  reports the collision naming the offending paths and stops. **One rule, checked in preflight
  before the first write.**
- **Why the whole run and not just the directory (owner, 2026-08-12).** The earlier design let
  `generate` proceed while *suppressing* every `python3 -B tools/steward …` string from the docs it
  wrote — which still leaves a manifest whose `$schema` points at a schema nobody installed, and a
  suppression rule to keep true in every renderer forever. Writing nothing makes the dangling
  reference impossible instead of policing it. All that survives of suppression: the **report**
  prints no `tools/steward` command either, because none was installed.

**"We created it and a human has since edited it" is a *finding*** — the byte-match predicate
failing. The record stays (a confirmed record is never auto-deleted, ADR-11) and the hand-edit is an
`error` (ADR-13) the human resolves by reverting or removing the file. No flag overrides it, because
**adoption is what such a flag re-opens**, and adoption produced a **verified permanent data loss**
(`verified-contracts.md` §4, ADR-27 row): ownership verification *succeeded* on an adopted file, so
the file was deleted.

**Preflight is a report, not a transaction.** `generate` first enumerates every target it would
write, classifies each **ours / absent / not ours** with zero writes, and prints the complete list —
stating for each target it is leaving alone why, and what would have been written there. **The core
prerequisite is settled in that same zero-write pass**, and if it fails the run stops there having
written nothing. Otherwise it writes: the absent targets (created) and the ours targets
(re-rendered). There is no per-target prompt and no prompt of any kind (ADR-11), which is what lets
one code path serve every invocation, with or without a TTY.

### Single-writer: one `generate` at a time, and concurrency is out of scope **(owner, 2026-08-13)**

**v0 supports exactly one `generate` per repository at a time, and says so rather than defending
against the alternative.** Classification happens in preflight and *absent* is re-checked
immediately before each write, but the window between a check and its `os.replace` is not closed and
**v0 makes no concurrent-safety claim of any kind**. If a second writer creates or edits a target
inside that window, the run's create-only guarantee does not hold for that path, and there is no
mechanism here that would tell you so.

**Two agents running `generate` at once in one repository is undefined behavior.** So is `generate`
racing a human editor or a `git checkout` of a target path. The-steward is a deliberately invoked
tool over an otherwise-quiescent working tree; that is the contract.

**No lockfile, no re-verify-before-replace, no retry — deliberately.** Each of those would announce
a safety v0 is not providing, and none of them closes the window against a writer that does not
participate in the protocol. What v0 offers instead is the same thing it offers everywhere else:
the next run reads the bytes on disk, and bytes it does not recognize are an `error` it will not
overwrite. Concurrency is not defended, it is simply out of scope.

### Write ordering: manifest first, and why there is no journal

**Order: write `.steward.json` recording the grant set, then write the artifacts. Every individual
write is `os.replace` from a temp file staged at the repository root**, created with
`tempfile.mkstemp(dir=<repo root>, prefix='.steward-tmp-')`.

**The temp name is random and its creation is exclusive, because a predictable one is a write
primitive for somebody else.** The requirement: create with `O_CREAT|O_EXCL`, never follow a symlink,
never truncate an existing path — which is what `mkstemp` does (it adds `O_NOFOLLOW` where the
platform has it), and **P1.10 asserts the behavior rather than trusting the flag list**. The
previous `.steward-tmp-<pid>-<n>` invited the opposite through a pre-planted link: a write
redirected outside the tree before `os.replace`, breaking containment (ADR-26) and create-only at
once. **This is a hostile-path property, not a concurrency one** — it does not make two `generate`
runs safe, which is out of scope above.

**One staging location, and it is the root, because staging in the target directory was a trap.**
Under `tools/steward/`, a kill between temp creation and `os.replace` leaves an unrecorded child in
the core directory, which the next run reads as a **foreign child** — the core is "not vendored"
forever, so under the no-core-no-run rule every later `generate` writes nothing at all, and the
claimed convergence is false. The root is a directory nothing classifies, so a
leftover blocks nothing. Fixtured as a kill point during core copying (P6.4(c)). Two costs, stated
rather than mitigated: crash litter is an untracked `.steward-tmp-*` at the root, removed with `rm`
(we do not sweep — a sweeper is a writer, and deleting files nobody recorded is exactly what
create-only forbids); and a cross-filesystem `os.replace` raises `OSError`, reported as **exit 2**
naming both paths.

**Installation is not atomic and v0 does not claim it is.** `rename()` is atomic per file, so no
individual file is ever observed half-written, but there is no multi-file atomic commit primitive
available at the floor **[verified: no `renameat2` / `RENAME_EXCHANGE` at 3.9, and replacing a
non-empty directory fails `ENOTEMPTY`]**.

**Manifest-first makes the window benign, which is why v0 needs no journal, no recovery command, and
no marked intermediate state.** A crash mid-`generate` leaves the manifest claiming paths that may
not exist, may be incomplete, or **may still hold their complete previous contents**. On the next
run those paths are **ours**, so:

- missing → `doctor` reports it (`warn`) and the next `generate` re-creates it, unattended;
- **anything else that is not byte-for-byte the recorded digest** → an `error`, and **nothing
  overwrites it**; the report names the path and one `rm` plus a re-run finishes it.

**The second bullet is wider than "partially written", and the difference matters.** The manifest
records the *new* digest before any artifact is replaced, so a kill during a re-render of an
existing artifact — a stale rewrite, or a core file changing across versions — leaves the **complete
old file**, not a torn one. It is still not the recorded bytes, so it is still an `error` needing a
human `rm`, and nothing distinguishes it from a hand-edit: the tool sees bytes it did not write and
says so.

Convergence is therefore automatic **only** for the missing case, and one human `rm` for every other
crash state — weaker than the previous draft claimed, and said that way on purpose, because the
alternative is the flag that re-opens the adoption class. It converges at all because renderers are pure and every
input is tracked content. The journal existed to protect *manifest-last* ordering, which could leave
files written with no ownership record; manifest-first cannot produce that state.

**A crash cannot, by ordering, make the-steward claim a path it did not classify as writable**:
classification completes before the manifest is written, and the manifest is one `os.replace`, so a
crash leaves either the previous manifest or the complete new one, never a partial grant set. **That
is an ordering argument bounded by its assumptions** — a single-`os.replace` manifest write and a
filesystem honoring `rename()` atomicity. It is not a claim about power loss: every "crash" measured
in Phase 0 means *process killed* (§5), and the previous design's unbounded *"no partial state on
any path"* was **falsified by measurement** (§2.3.9).

### Where the core is copied from, and what "the core" is **(bootstrap; owner, 2026-08-12)**

`generate` copies the core from **the directory the executing core lives in** —
`Path(__file__).parent`. On a first run that is the plugin's own copy, invoked from inside the
target repo as `python3 -B <plugin>/skills/the-steward/core generate`; on a later run driven from
the target repo it is `tools/steward/` itself. There is no second source and no upgrade command
(ADR-19 is gone): re-running the skill runs the plugin copy, which is the newer one. That source
tree is program text, not repository data, which is the one thing ADR-26's containment predicate
does not cover.

**The packaged core declares its own inventory, and the copy never walks a directory.** The core
ships an explicit, sorted list of its own relative paths (`inventory.py`, a tuple — no format to
parse, no file to keep in sync by hand at read time). Walking `Path(__file__).parent` instead would
vendor whatever happens to be sitting there: a `__pycache__/` a bare invocation created, an editor
backup, a test scratch file. **A test asserts the inventory equals the packaged directory's actual
contents**, so adding a module without listing it fails in our repo rather than shipping a core
missing a file.

**`generate` syncs the target to that inventory** — it does not merely re-copy a recorded list, which
could never install a module added in a later version:

- listed, **not recorded, and absent** → installed and recorded;
- listed, **not recorded, but already on disk** → **collision**, by the foreign-child rule above:
  create-only has no exception for the core. (The earlier single row, *listed and not recorded →
  installed*, violated create-only the first time a new version's inventory named a path the repo
  already had.)
- listed and recorded but the packaged bytes differ → **re-copied** and the record updated;
- listed, recorded, and byte-identical → no write;
- **recorded but no longer listed** (a file the new version removed; a rename is a removal plus an
  addition) → **deleted and unrecorded**. Safe by construction rather than by a second rule: a
  recorded child whose bytes are not the recorded bytes is a collision, and on a collision nothing
  is written *or deleted* anywhere — so anything this branch removes is byte-identical to what we
  put there.

**The removal branch has a crash state, created by manifest-first.** The new manifest — which no
longer records the removed file — is written before the deletion, so a kill in that window leaves a
child under `tools/steward/` that exists and nothing records: a foreign child, so **every later
`generate` writes nothing at all** until a human `rm`s it. It does not converge unattended, and it
gets the same remedy every other mismatch does. Kill-point (v) in P6.4(c).

### Also chmod before rename **[verified]**

`os.replace` gives the installed file the **source** temp file's mode. Any atomic-write helper must
`chmod` the temp file before the rename, or a file lands with the wrong permissions.

## ADR-23 — An unverified vendor contract is an owner decision, never a self-granted waiver **(owner, 2026-08-11)**

**Decision.** **No product code may be written against an unverified vendor contract.** When a
contract cannot be verified, the agent may **not** downgrade it to accepted residual risk on its own
authority. Each unresolved contract is escalated to the owner individually with (a) what is known,
(b) what would be guessed, and (c) the blast radius if the guess is wrong. The owner chooses per
item: **ship** / **drop that dependency** / **proceed with stated risk**.

**Why.** An earlier plan simultaneously forbade coding against unverified contracts and permitted
any unknown to be "downgraded to accepted residual risk with a one-line justification" — the second
clause silently repeals the first. This rule is the reason the harness-hook surface was cut instead
of guessed at.

### Both escalations are ruled on **(owner, 2026-08-12)** — nothing is open

The bundle reads vendor prose in **ADR-4, ADR-15, ADR-16, ADR-17 and ADR-18**, none with a resolving
record in `verified-contracts.md`. Two were escalated in round 6 because v0 *acted* on them, and
both rulings reduce the behavior toward what the evidence supports rather than guessing:

- **E1 (ADR-15) → proceed with stated risk.** The import-expansion half is deleted; the
  file-loading half **ships**, so "dropped" would be the overclaim ADR-28 bans. Risk and bound
  stated in ADR-15.
- **E2 (ADR-17) → keep the check at `warn`.** v0 fails no repository on an unverified number; it
  upgrades to `error` if and when the cap is verified against the pinned binary.

**The count was wrong until 2026-08-13 and is true again.** A *third* reading was acted on —
Anthropic's ~200-line guidance, made a `warn` by ADR-17 with no escalation, no severity row and no
test. The owner deleted that check, so the readings v0 acts on are exactly **two — ADR-15 and
ADR-17**, both ruled above; **ADR-4, ADR-16 and ADR-18** are acted on nowhere. Every vendor-prose
behavior is now listed here, which is the property ADR-23 needs.

## ADR-26 — One containment predicate: everything stays inside the working tree

**Decision.** Every path of **repository data** the core reads or writes must resolve — **after
symlink resolution** — inside `git rev-parse --show-toplevel`. Escape is a hard error (exit 2). The
repo root always comes from **cwd via git**, never from the core's own location, so running the core
from the plugin directory against a target repo resolves correctly **[verified]**.

**Exactly one thing is outside the predicate: the executing core's own source directory** — a
bootstrap cannot live inside the tree it is bootstrapping, and on a first run the core must read its
own files to copy them in (ADR-20, *Where the core is copied from*). The exemption is a rule, not a
hole: **the only *repository-content* path the core may read outside the working tree is a file its
own inventory lists under `Path(__file__).parent`, and it may write nothing outside the working
tree, ever.** Both halves are tested (P1.9). *Repository-content* is the scope word that makes the
statement true: the stdlib the interpreter imports, the `git` executable and the git configuration
it reads, and the hooks path `doctor` inspects are all outside it and always were.

**One predicate suffices because v0 writes nothing under `.git`** — the two-predicate split existed
for the hook, the pin and the journal, none of which exist. **The predicate is verified sound**: it
refused a `../VICTIM.txt` traversal and an inside-the-repo symlink pointing out, and the outside file
survived. What was wrong before was its *domain* — applied to hook installs it hard-errored in all
106 worktrees of the reference monorepo, because a linked worktree's common directory legitimately
sits outside its root **[verified]**.

## ADR-28 — Every finding carries its evidence tier; inspection is never proof **[the cross-cutting lesson of Phase 0]**

**Decision.** Every finding the-steward emits states **how it was established**, and the report
prints the tier:

| Tier | Meaning | Example |
|---|---|---|
| **resolved** | we followed the claim to a real object in the repo and it did or did not exist | C1, C2 |
| **rendered** | we re-rendered from source and compared bytes | C4 |
| **inspected** | we read state we do not control and are reporting what we saw | A3: the hooks path, a hook's presence and mode bit; the vendored core's version; a command record declared `external` (ADR-18), which is a human's declaration read out of a file we cannot prove we wrote (ADR-20) |
| **inferred** | we read repository state and drew a conclusion the state does not itself assert | every `scan` finding: "this is the test command", "these are the sources of truth", "this is the docs scope" |

**`inferred` exists because the other three would each be a lie about a scan (new 2026-08-13).** A
scanner's conclusion is not *resolved* (nothing was followed to an object), not *rendered*, and not
*inspected* (that tier reports what was seen, and an inference goes beyond it). Giving inference its
own tier is what makes the schema rule in P1.6 statable in one line: **`confidence` is required
exactly when the tier is `inferred`, and forbidden on every other tier.** An `inferred` finding is
never reported as proof, and it is never an `error` on its own — it becomes an ADR-11 record whose
severity is the record's.

**An `inspected` finding is never reported as proof of behavior.** Concretely, for A3 `doctor` says
*"the effective hooks path is X; a `pre-commit` file is present / absent; its mode bit is M;
**the-steward installed no hook and no enforcement of any kind here** — established by inspection,
not by firing anything. This does not establish what else may or may not enforce something: other
local hooks, server-side rules and CI were not inspected."*

**Two sentences are banned outright, and the wording test asserts both.** Never *"enforcement
works"* — inspection cannot establish that a hook fires. Never *"there is no enforcement"* —
inspection cannot establish that either, though an earlier draft permitted it. A hooks path and a
mode bit are two facts about one directory in one clone; branch protection, a server-side hook, a
required CI check and an unstatted local hook are all outside them. Claiming absence from a partial
look is the same inference error as claiming presence proves behavior, run backwards.

**Bounded diagnoses are still allowed, and must name their bound.** *"The tracked hooks directory
`D` is not the effective hooks path, so nothing in `D` runs in this clone"* is establishable by
inspection alone and is exactly the A3 finding: a statement about `D`, not about the repository.
Every stronger inactive-hook claim must take that shape — scoped to the object actually inspected.

**Every unresolvable reference emits a diagnostic.** A candidate silently dropped both hides a real
edge and manufactures a false orphan — verified in the reference implementation.

**Why.** Every Phase-0 claim that mattered came from a side effect actually observed; every claim
that misled came from prose. **A presence check is precisely the check that would have passed for
the Codex harness the entire time it was dead** (`verified-contracts.md` §2.1.1) — the finding that
removed harness hooks altogether. A tool whose thesis is "a recorded claim is not evidence" must
apply that to its own output.

## ADR-30 — A vacuous pass is a failure **(new in v0)**

**Decision.** A declared scope that resolves to **zero** items is an `error`, not a pass — unless
the manifest carries an `intentionallyEmpty` record for that scope, which takes the ordinary ADR-11
severity: `warn` while `proposed`, `info` once confirmed. **`proposed` is enough to clear the
`error`**, because requiring `confirmed` deadlocked the greenfield flow — `generate` cannot write a
`confirmed` record and no prompt exists (ADR-11). A `proposed` record is still reported, still
`warn`, and still prints its cardinality. The same rule covers any check with an empty input set:
the report states the cardinality each check examined, so "0 files checked, 0 problems found" can
never render as coverage.

**The records are keyed per scope, and there are three keys (2026-08-13).** One
`intentionallyEmpty` record covering everything would let a code-only repo's legitimately empty
docs scope silence an accidentally empty command set. The keys are the declared scopes v0 has:
**`docsScope`** (C3, C4, the indexes), **`commands`** (C1's approved command set) and **`paths`**
(C2's declared path list). A record clears the `error` for **its key only**; the other two are
unaffected. `generate` writes a **proposed** record for each key whose inferred list came back
empty, in the same manifest write — so greenfield never needs a hand-edit, and a repo that
genuinely has no verification commands reports `warn`, not `error`.

**The rule governs scopes the-steward manages, and only those (owner, 2026-08-13).** A scope is
declared by a record; where **no manifest exists at all** there is no declaration and nothing to be
vacuous about. Every check over a declared scope — C1 and C2 on the two claim record sets (ADR-32),
C3 and C5 on the docs scope — then reports **0 items with its reason** as `info` (ADR-13), and
`check` exits **0**. A repository that has never run `generate` is unmanaged, not failing. Once a
manifest exists the repo is managed and every one of its scopes is subject to the paragraphs above,
empty ones included.

**Why.** A check passing over nothing is the purest form of this project's defining failure —
coverage without substance, and worse than no check at all because it stops anyone from looking.

## ADR-31 — Frontmatter is a documented minimal subset, and anything else is a loud error **(owner, 2026-08-12; new in v0)**

**Decision, part one — the grammar.** C3 parses frontmatter with **one** implementation —
`tools/steward/frontmatter.py`, vendored in the core, stdlib-only (ADR-1: no `yaml` at the 3.9 floor
**[verified]**). Its grammar is the contract and it is deliberately tiny: a block delimited by a line
that is exactly `---` **as the first line of the file**, closed by the next exact `---`; between them
every non-blank line is **`key: value`**, split on the **first colon**. Nothing else.

**One whitespace rule, applied once, and then the value is opaque (2026-08-13).** The line is split
at the first colon; the **key** is the part before it with surrounding whitespace stripped; the
**value** is everything after it with surrounding whitespace stripped **exactly once** — a single
`str.strip()` of ASCII whitespace at each end, and no other transformation ever. The stripped result
is the value, taken literally. This is the whole contract: an earlier draft said both "the value is
stripped" and "everything after the colon, preserved verbatim", which are different strings whenever
the conventional space after the colon is present.

**Only keys have syntax; the value is never inspected beyond that strip (owner, 2026-08-13).**
`status: [draft]` is the literal **seven**-character string `[draft]`; `title: "x"` is the three
characters `"x"`; `owner: R & D`, `lang: C#`, `note: * see below`, `body: | more` and
`summary: > later` are each exactly the characters after the colon once stripped. There is no
unquoting step, no flow-collection reader, no block scalar, no anchor / alias / tag, no comment
stripping — **those constructs do not exist in this grammar, so they cannot be errors in it
either**. An earlier draft declared them forbidden, which needed exact token-position rules nobody
could write and made every ordinary bracket, ampersand or hash ambiguous.

**The three whitespace cases, pinned so no reader has to infer them:** `k:  a  b ` → `a  b`
(interior whitespace is part of the value, both ends are not); `k:` and `k:    ` → the **empty
string**, which is a valid value here and is what the schema's optional non-empty check exists to
flag (part two); `k: "  x  "` → `"  x  "` including the quotes and the spaces inside them, because
the quotes are ordinary characters and the strip already happened outside them.

**Unsupported, by name — all of it key-side:** a non-blank line between the delimiters that is not
`key: value` (no colon at all, which covers a `- x` list item and a bare `# comment` line); an
**indented** line, since nesting has no representation here; a **duplicate key**; an **unclosed**
block. **Anything outside the subset is an `error` naming file, line and construct** (ADR-13) —
never a silent skip and never a partial parse, because a skipped line is a doc whose contract we
reported on without reading. **A file with no frontmatter at all parses as the empty mapping** — not
a syntax error; whether empty is *valid* is then the declared schema's question, not the parser's.

**Decision, part two — the schema is a required-key list (owner, 2026-08-12).** The "frontmatter
schema" the manifest declares (ADR-2) is exactly: **a list of required key names**, plus an optional
boolean requiring their values be non-empty after stripping. A document satisfies it when every
listed key is present (and non-empty, if asked). **Unknown keys pass silently** — repos own their own
conventions and v0 has no opinion about them. There is no schema language, no validation keywords, no
types, no patterns, and nothing new vendored to evaluate any. The schema is an ADR-11 record, so a
violation takes the ordinary record severity: `warn` while `proposed`, `error` once `confirmed`.

**What that honestly does not do.** No value is ever type-checked or format-checked. A key declared
required and present with the value `2026-13-45`, `yes`, or `tbd` passes — including in a field
whose name looks like a date. C3 reports *the key is missing* and, at most, *the value is
empty*; any claim beyond that is a claim v0 does not make. **And real YAML is read as text:** a
block a YAML reader would resolve to a list, a mapping or a folded string parses here as one literal
string, silently and by design. Where such a document exists, v0's answer about it is weaker than a
YAML parser's — it is never louder, because the only thing v0 asserts is that a key is present.

**Why a subset rather than YAML.** There is no YAML at the floor and no dependencies are permitted,
so the real choice is a documented subset versus a home-grown parser pretending to be YAML. The
reference repo has **four** copy-pasted parsers that disagree (PDR, S12): the failure was never a
missing feature, it was four undocumented grammars.

## ADR-32 — The manifest is the single claim source for C1 and C2 **(owner, 2026-08-13; new in v0)**

**Decision.** C1 and C2 take their claims from exactly two record sets in `.steward.json`, and from
nowhere else:

- the **declared path list** — one repository path per record. **C2** resolves each (working tree,
  not the index; a path resolving only to an ignored file is unresolved).
- the **approved command set** — one command per record. **C1** resolves each structurally, never by
  executing it, per its `resolution` kind (ADR-18).

Both are ADR-11 records (ADR-2), so **a claim exists because a record exists**, its severity is the
record's — `warn` while `proposed`, `error` once `confirmed` (ADR-13) — and **the cardinality each
check reports is exactly the record count**.

**The rendered sections are output, never an input (owner, 2026-08-13).** `AGENTS.md` and
`CLAUDE.md` carry a **Source of Truth Map** and a **Verification Commands** list rendered from those
same records (ADR-8, ADR-15). **Nothing reads them back off disk. There is no parser for them, and
none will be written.**

**Why one source and not two.** The two sections are duplicated across two files that can each be
missing, stale or hand-edited. Reading them back would give C1 and C2 two on-disk projections with
no defined winner, leaving cardinality, severity and *which* claims were checked undefined —
implementation-dependent in a determinism tool. Reading the records instead makes the duplication
**harmless**: both files render from the same records in the same run, so they cannot disagree
without C4 saying so.

**The limit this creates, stated plainly.** A human who edits a rendered section changes **nothing**
C1 or C2 see — the claim set is unchanged, and the check will not report the edited line. The edit
is not invisible: it makes that file's bytes differ from the recorded digest, which is ADR-2's row
3 — reported as *not the bytes we wrote* (`error`), never overwritten (ADR-20). So a hand-edited
section surfaces as **a modified file**, not as a changed claim. The remedy is v0's universal one:
`git checkout` or `rm`, then re-run.

**No document is scanned at all** — not prose, code spans, fenced blocks, links, URLs, or any other
file. No fence-language rule, no URL discrimination and no code-span heuristic exists, because with
records as the input there is nothing for one to apply to. **The ADR-10 corpus serves C3, C4 and the
indexes; C1 and C2 do not read it either.** Prose was never a candidate input: identifiers,
examples, counter-examples and URLs wear the same syntax as a declaration, so two conforming
implementations would produce different false-positive sets from one repository — and a checker that
cries wolf gets ignored, which is this tool's defining failure by another road.

**The limitation.** *A claim written in prose is not verified.* A paragraph naming a script that
does not exist produces **no finding** — the reference-repo failure class, undetected — unless a
record declares that command. There is no heuristic v0 will grow to guess it, and calling partial
prose coverage *coverage* is the vacuous pass ADR-30 forbids. P4.1 and P4.2 fixture the limit both
ways.

### Record values must be renderable, and the schema rejects the ones that are not (2026-08-13)

The two sections render **one item per line**, so a value carrying a line break would silently
become two claims and could forge a Markdown structure around itself. Nothing parses the sections
back (above), so there is nothing to escape *for* — the fix belongs where the value enters, not
where it leaves:

- **Schema validation rejects** any command or path record whose value is empty, differs from its
  own stripped form, or contains an **ASCII control character** — U+0000–U+001F (CR, LF and TAB
  included) or U+007F. The failure is a manifest that does not validate, which is **exit 2** naming
  the record, the offending code point and its index (ADR-2), never a silent drop.
- **`scan` may not propose one.** Git permits a newline in a filename, so the corpus can contain a
  path no record can represent. `scan` refuses to propose it and emits a diagnostic naming it
  (ADR-28 — never a silent drop), so C2 never claims it and no one is told it was checked. That is
  the honest limit: **v0 cannot make a claim about a path whose name contains a control character.**
- **Everything else renders verbatim, inside a fenced block.** Values that merely *look* like
  Markdown — a path beginning `#`, a command containing `|`, an item that is literally `---` —
  are legal and are rendered as-is inside a fenced block per section, which is what keeps them from
  becoming a heading, a table or a rule in the surrounding document. The fence is a rendering
  decision only; no fence anywhere is ever scanned.

### No manifest, no claim source — `info`, exit 0 **(owner, 2026-08-13; closes the item this ADR left open)**

On a repository with **no `.steward.json`** — never generated, or the manifest deleted — C1 and C2
have no record set to read and examine **zero** items. That is **`info`**, and `check` **exits 0**.
The report states the cardinality and the reason: *no claim source — nothing to verify*.

**Why this is not ADR-30's vacuous pass.** The vacuity rule makes an empty *declared* scope an
error, and a declaration is a record. An unmanaged repository declares nothing, so there is no claim
to pass vacuously over — reporting `error` there would fail every repository that has never run
`generate`, for the offense of not being managed. **The other side is unchanged and is tested with
it:** once a manifest exists, a scope that resolves to zero items is an `error` unless that scope's
`intentionallyEmpty` record says otherwise (ADR-30).

**One consequence worth naming.** Because the claim source is the manifest and not the docs, a
brownfield repo whose routing pair is *not ours* (ADR-15) still has C1 and C2 claims if a manifest
with records exists there — `generate` writes the manifest even when the coupled pair is suppressed.
Those claims are checked normally. Zero-cardinality is reached by having **no manifest**, not by
having no agent docs.

---

## Removed in v0

Every decision cut, by number, so review history stays resolvable. **The evidence behind these
decisions is not deleted** — it is retained and annotated in `verified-contracts.md`.

| ADR | What it specified | Why it is gone |
|---|---|---|
| **ADR-3** | `.codex/hooks.json` generation, two-stage install probe, harness version binding, `steward reprobe` | The shipped Codex binary does not read the repo layer at all (`verified-contracts.md` §2.1.1). Removed 2026-08-11 with all harness-native hooks |
| **ADR-5** | Git hook install: identity token, `.legacy` chaining, four-branch `hooksPath`, hook-state digests | v0 installs no hook |
| **ADR-6** | Pre-commit gate, auto-sync self-staging, input-digest rule 0/0′/0″, hook-time consent contract | No hook, so no gate, no self-staging, and no non-interactive consent problem |
| **ADR-7** | Generated-region protocol: paired sentinels, `gen=` stamp, digest in the end marker, the four-state digest × re-render table, region-body comparison domain | **Removed 2026-08-12 (owner).** The one artifact that needed it, `CLAUDE.md`, now carries the routing content directly (ADR-15), so v0 writes whole files only. It was the bundle's single *[invented]* mechanism and its most defect-prone decision, and it carried the unverified "an `@AGENTS.md` import is expanded inside a comment-delimited region" dependency with it |
| **ADR-12** | Overrides with mandatory `expiresAt`, digest-keying, 14-day pre-expiry warning | v0 blocks nothing, so a timed override has no consequence to time out. Replaced by a `waived` reason on an ADR-11 record |
| **ADR-14** | POSIX-`sh` hook shim as a status adapter, enrolment discriminator, exit-3 reservation, capture-then-truncate output cap | No hook, no shim, no launcher |
| **ADR-19** | `steward upgrade --from <plugin path>` + behind-version report | Re-running the skill **syncs the core to the packaged inventory** — installing, re-copying and removing per ADR-20 — and does nothing at all on a foreign collision; `doctor` reports the core version. One command instead of two |
| **ADR-21** | CI generation, `steward ci init`, workflow ownership, four doctor CI states incl. `ci-self-attested` | v0 generates no CI. Anyone can add `python3 -B tools/steward doctor` to a workflow themselves |
| **ADR-22** | Tier matrix (minimal / standard / full) | v0 is one mode |
| **ADR-24** | Committed `sh` launcher + per-machine interpreter pin under the git common dir | Both existed so a git hook could resolve an interpreter outside a login shell. `python3 -B tools/steward` plus a loud floor assertion replaces them (ADR-1) |
| **ADR-25** | Linked-worktree isolation, shared-hook ownership, per-worktree vs common-dir state | All of it was hook and pin state. The surviving rule — resolve the repo root from cwd via git — is in ADR-26 |
| **ADR-27** | Rollback: delete-what-we-created, decline everything else, `.legacy` restore gate | No rollback command. `git rm` and git history are the undo (PDR, "Undo") |
| **ADR-29** | Claude `settings.json` hook status adapter and its version binding | v0 writes no harness hook config. `CLAUDE.md` is a Markdown doc shim (ADR-15) and is unaffected |

Also removed, as scope rather than as numbered decisions: the install transaction and recovery
journal, `steward recover`, `.git/steward/` in every form, ownership classes beyond ours / not-ours,
**`generate --force` and every other flag** (2026-08-12 — a record is evidence, not a grant, ADR-20),
the planning-governance framework, semantic/LLM gardening, and the extended exit-code contract.

## Rejected alternatives worth recording

| Rejected | Why |
|---|---|
| Node as the vendored runtime | No `/usr/bin/node` on macOS; version managers hide it from GUI clients (ADR-1) |
| Two implementations, chosen per repo | Any behavioral divergence is a correctness bug in a determinism tool |
| `CLAUDE.md` as a symlink to `AGENTS.md` | Cannot carry harness-specific content; Windows-hostile (ADR-15) |
| Parsing `AGENTS.md` prose to render generated artifacts | Free-form prose is not a safe rendering input; render from the manifest |
| mtime-based freshness | Unsound on every clone, worktree, and CI runner (ADR-9) |
| Blocking on review-cycle dates | Incentivizes metadata churn; the reference repo already rejected it (ADR-13) |
| Executing documented commands to verify them | Runs arbitrary repo code from a read-only tool, and turns a determinism check into a build-environment check (ADR-18) |
| A cached input/corpus digest as the freshness signal | A second source of truth that can disagree with the re-render. With pure renderers, re-rendering *is* the check (ADR-2) |
| Adopting pre-existing files | Produced a verified data-loss defect: ownership verification *succeeds* on an adopted file, so rollback deleted it — an adopted untracked file was permanently lost. Create-only removes the class (ADR-20) |
| A recovery journal for `generate` | Existed to protect manifest-*last* ordering. Manifest-first cannot produce the unrecoverable state, so the journal has nothing to protect (ADR-20) |
| Multi-vendor harness shims | Out of scope; the renderer must not foreclose them |
| Structural key-level merge into JSON config | Needs a merge engine, durable-key identity, and a second ownership model. Moot in v0, which writes no harness config |
