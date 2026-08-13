# PDR — `the-steward` v0: tell a repository the truth about its own agent docs

**Status:** v0 spec. Rewritten from scratch 2026-08-11 after the owner cut all enforcement machinery
(see "How v0 came to be shaped this way"). Phase 0 is complete; no product code written yet.
**Owner:** Angel Marcos
**Initiative:** `docs/initiatives/2026-08-10-the-steward/`
**Branch:** `feat/the-steward` (off `origin/main`)
**Bundle:** `PDR.md` (this) · [`ADR.md`](./ADR.md) · [`execution-plan.md`](./execution-plan.md) ·
[`verified-contracts.md`](./verified-contracts.md)

## Problem

Agent-facing repository scaffolding — `AGENTS.md` routing networks, harness instruction shims,
generated doc indexes — is high-leverage and, today, entirely unverified. Every agent reads it
first and trusts it completely, yet nothing checks that a single claim in it is true.

The result is a predictable and observable failure class. In a large private monorepo that
represents the state of the art for this kind of scaffolding (485 docs, a 14-node nested
`AGENTS.md` network, a doc-gardening program, a doctor script, a pre-commit enforcement hook),
three independent instances were verified on 2026-08-10:

1. **The 31-line harness shim — the first file every agent reads — had 4 of 6 concrete claims
   false.** It named a shared-config file that does not exist; it described a committed file as
   "local-only, not required for repo correctness" when that file is in fact the tracked shared
   config; and it documented two verification commands that were never wired up as scripts.
2. **A canon doc claimed hook installation happens automatically on dependency install** via a
   `prepare` script that does not exist. Activation is manual-only.
3. **The pre-commit hook everyone believed was enforcing doc-tree freshness was silently inactive**
   in the working clone: git never clones hooks, `core.hooksPath` had never been pointed at the
   tracked hooks directory, and nothing reported this.

Instance 3 is the important one. It is not "a doc went stale" — it is *an enforcement mechanism that
appears to exist and does nothing*, which is strictly worse than having no mechanism at all, because
it stops anyone from looking. The compounding detail: the doctor script that would have caught
instances 1 and 2 requires a config file the repo does not have and requires a committed file to be
empty, so wiring it up as-is would produce a doctor that fails against its own repository.

Meanwhile the *good* ideas in that system — AGENTS-first routing, a thin non-duplicating harness
shim, a machine-readable index, a frontmatter contract — are locked inside one company's monorepo,
hand-built, hand-maintained, and coupled to its stack.

**`the-steward` generalizes what works and reports, honestly, what is not true.**

**The irony is deliberate and it is the product.** v0 installs no enforcement of any kind. It does
not gate, protect, or guarantee anything. It tells you the truth about what it can actually see —
including, by inspection, that the tracked hooks directory you believe is protecting you is not the
one git runs in this clone.

## What v0 is

A **read-only-by-default repo agentizer**, shipped as a skill in the `the-foreman` plugin and
invoked `/the-foreman:the-steward`. Four verbs — **`scan` · `generate` · `check` · `doctor`** — and
nothing else on the command surface: **no verb takes a flag** (ADR-20). The report is the *output* of
`check` and `doctor`, not a fifth verb.

### 1. `scan` — read the repo, infer nothing silently

Detect project roots, stacks, build / test / lint commands, the documentation scope, and any agent
docs that already exist. **Every finding carries its evidence and a confidence level** — a scan
finding's tier is **inferred**, which is the one tier that requires a confidence and the one v0
never reports as proof (ADR-28). Writes nothing.

### 2. `generate` — write only what does not already exist

- **`AGENTS.md`** — the canonical routing network, rendered from the contract manifest, never by
  parsing prose. It **renders** the manifest's two claim record sets for a human reader — the
  **Source of Truth Map** and **Verification Commands**, one item per line. Those sections are
  output: C1 and C2 read the records, never the rendered file (ADR-32).
- **`CLAUDE.md`** — the same routing content, **written directly into it** (ADR-15). No import, no
  marked region. The duplication is deliberate: the tool owns both files, renders both from the
  manifest in the same run, so keeping them consistent is the renderer's job.
- **Doc indexes** — **`docs/steward/routing-map.md`** and **`docs/steward/orphans.md`**, rendered
  from the corpus. Fixed paths, created only when absent (ADR-20).

**The-steward never writes bytes it did not write** (ADR-20). An **existing** target the manifest
does not record is *not ours*: reported, left byte-identical, and no flag anywhere changes that. An
**absent** one is created, and creating it is what makes it ours. A path we created stays ours and
`generate` re-renders it in place — **but only while the bytes there are still the bytes we recorded
writing**: a manifest record is evidence, never a grant, so a recorded file someone has since edited
is reported and left alone. `.steward.json` is the one exception, because a record cannot record its
own creation: `generate` writes it every run, kept honest by being tracked and reviewed rather than
owned.

### 3. `check`, then `doctor` — verify that the docs' claims resolve. This is the heart of the product.

| # | Check | What it catches |
|---|---|---|
| **C1** | Every command in the manifest's **approved command set exists** — resolved **structurally, never executed**, per the record's `resolution` kind (ADR-18, ADR-32) | A1: a documented command that does not exist |
| **C2** | Every path in the manifest's **declared path list resolves** to a file in the working tree that git does not ignore (ADR-32) | A2: a doc claim about a file that does not exist |
| **C3** | Doc **frontmatter carries the keys the manifest declares required** over the declared docs scope, parsed by one vendored parser whose `key: value` subset is documented as the contract; unknown keys pass, values are never type-checked (ADR-31) | An unenforced convention drifting (the reference repo sits at ~87% for exactly this reason — `verified-contracts.md` §2.3.11, row 4), and four copy-pasted parsers disagreeing about what the convention is |
| **C4** | Generated content is **fresh** vs its source — render-and-diff, **no writes** (ADR-8/ADR-9) | Generated docs silently diverging from their inputs |
| **C5** | A declared scope resolving to **zero items fails loudly**, per scope key (ADR-30). A repo with **no manifest** declares no scope at all, so every check reports 0 items with its reason as `info` and `check` exits 0 (ADR-32) | A check that passes vacuously and reads as coverage |

**The manifest is the single claim source (ADR-32).** C1 and C2 read the manifest's two record sets
— the approved command set and the declared path list — and **nothing else**. The *Source of Truth
Map* and *Verification Commands* sections rendered into the agent docs are **output that is never
read back**; there is no parser for them. So a claim exists because a record exists, and the
coverage number the report prints is the record count. **No prose, code span, fenced block, link or
other document is ever scanned**, so no fence-language rule or URL heuristic exists in v0.

**Two honest costs.** *A claim written in prose is not verified* — a paragraph naming a script that
does not exist produces no finding. And *a hand-edit to a rendered section changes no claim*: C1 and
C2 will not see it. It is still reported, as a different thing — the file's bytes stop matching the
recorded digest, so C4 reports that file as modified (`error`, ADR-2/ADR-20), remedied by
`git checkout` or `rm` plus a re-run. Both are narrower than "we check your docs", and cheaper than
a guessing parser whose false positives get the whole report ignored.

**C2 resolves against the working tree, not the index, and that is deliberate.** Requiring a
*tracked* file would make the greenfield path impossible — `generate`'s output is untracked until a
human runs `git add`, and criterion 2 requires `check` to pass immediately afterwards — and v0 will
not grow a staging lifecycle, because a read-only-by-default tool that runs `git add` puts itself
inside the human's commit. So the rule is existence, not indexing. A path resolving **only** to a
git-ignored file is unresolved in the same terms as a missing one. Same reasoning for the corpus:
tracked documents **plus** the ones the manifest records as ours (ADR-10), or `check` skips what
`generate` just wrote and passes vacuously (ADR-30).

`check` is C1–C5 over repository content. `doctor` composes `check` with environment findings it can
only obtain by **inspection** — the hooks path and any hook's presence and mode bit (A3), the
vendored core's version, and whether each path the manifest records as ours still exists and still
matches what we wrote. **Every inspection finding is labelled as inspection** and never as proof
(ADR-28).

### 4. The report — findings with severities, and nothing else

Not a separate command: `check` and `doctor` each end in one.

`error` / `warn` / `info`. `check` and `doctor` exit non-zero when any `error` finding is present
and exit 2 if the tool itself fails (ADR-13). **Nothing blocks anything, because there is no gate to
block.**

### And it runs without Claude

The core is a **vendored, dependency-free Python 3 package** (floor 3.9) copied into the target repo
as `tools/steward/`, invoked plainly:

```
python3 -B tools/steward check
python3 -B tools/steward doctor
```

`-B` is part of the invocation, not an optimization: without it the interpreter caches `__main__`
before the core's first line runs and a read-only verb writes `__pycache__/` (ADR-1).

A Codex agent, a human, or a CI step can re-run the doctor with no Claude tooling installed. The
plugin is the front door; the target repo owns the tool — **unless `tools/steward/` is already
occupied by something that is not ours**, in which case the core cannot be installed and
**`generate` writes nothing at all**: no manifest, no docs, no indexes (ADR-20). One rule instead of
a promise to never mention a command we did not install.

## What v0 is not

- **Not an enforcer.** No git hook, no hook installation, no `core.hooksPath` handling, no CI
  workflow generation, no harness-native hooks, no `.codex/`, no `.claude/settings.json`. v0 never
  claims it protects, gates, or guarantees anything (ADR-4).
- **Not transactional.** No install transaction, no recovery journal, no rollback command, no
  `.git/steward/` anything, no atomicity contract. v0 writes at most a handful of files, each
  atomically, manifest-first. A re-run converges unattended **only for a recorded path that is
  missing**; **any** recorded path holding bytes we did not write — a human edit, or the complete
  *previous* version left by a kill mid-rewrite — is reported and never overwritten, and the remedy
  is the human's `git checkout` or `rm` plus a re-run (ADR-20).
- **Not concurrent, and it says so instead of pretending (ADR-20).** v0 is **single-writer**: one
  `generate` at a time over an otherwise-quiescent working tree. **Two agents running `generate` at
  once in one repository is undefined** — so is `generate` racing a human editor — and v0 ships no
  lockfile, no re-verify-before-replace and no retry, because each would advertise a safety it is
  not providing. Classification and the write it authorizes are not one atomic step, and nothing
  here claims they are.
- **Not an adopter.** Ownership is binary — *we created it* or *we did not* — with no adopt path and
  no intermediate classes (ADR-20, restated above under `generate`).
- **Not tiered.** One mode.
- **Not a planning-governance framework**, not a semantic/LLM gardener, not a documentation writer.
  The-steward establishes and verifies *structure, routing, and claims*; authoring good prose is
  agent work performed under the structure.
- **Not a replacement for `the-foreman`**, and not coupled to it: no imports or shell-outs in either
  direction, asserted by a test (issue [#29](https://github.com/Angel45604/the-foreman/issues/29)).
- **Not multi-vendor.** Claude and Codex read the docs v0 generates. Nothing ships for Gemini /
  Cursor / Copilot; the renderer must not foreclose them.
- **Not a fixer of the reference monorepo.** Its drift is retained as motivating evidence and as
  sanitized committed fixtures.

## Acceptance

The three verified reference failures, encoded as **sanitized, committed fixtures**. Live runs
against the private reference repo are optional corroboration, never a test dependency.

| # | Failure | Detected by | Evidence tier |
|---|---|---|---|
| **A1** | a documented command that does not exist | C1 | resolved |
| **A2** | a doc claim about a file that does not exist | C2 | resolved |
| **A3** | a silently inactive git hook | `doctor` environment findings | **inspection** |

**A3 is reported by inspection, not by firing.** v0 installs no hook, so there is nothing of ours to
fire. `doctor` resolves the effective hooks path, stats whatever is there for presence and the mode
bit, and reports **those facts and no more** — every finding carrying the *inspection* label, plus
the one thing the-steward can state without qualification: **it installed no hook and no enforcement
of any kind.** It may say neither *"enforcement works"* nor *"there is no enforcement"* (both banned,
ADR-28). What it states instead is bounded to the object inspected — *"the tracked hooks directory
`D` is not the effective hooks path, so nothing in `D` runs in this clone"* — which is the finding
the reference repo needed and which inspection genuinely supports.

## Success criteria

1. `scan`, `check` **and `doctor`** leave `git status --porcelain` byte-identical **and write no
   bytecode cache for any steward module** — asserted at **the exact cache path each module would
   use under the interpreter running it**, computed with `importlib.util.cache_from_source` (which
   honors `sys.pycache_prefix`), never at the granularity of a shared cache root that can hold
   unrelated caches. Directly asserted, because `git status` alone is vacuously green on Apple's
   3.9.6 (ADR-1). `doctor` additionally leaves every file in the hooks directory byte- and
   mode-identical (plan P7.6).
2. `generate` on a repo with no agent docs produces `AGENTS.md`, `CLAUDE.md` and the indexes, and
   `check` then passes against them — with no hand-editing of `.steward.json` first. A code-only
   repo's zero-file docs scope is reported as a `warn`, because `generate` records a **proposed**
   `intentionallyEmpty` for the `docsScope` key (ADR-30, one record per scope key); it is silent
   only once a human confirms it.
3. `generate` on a repo that already has any of those files writes **nothing at those paths**,
   reports each, and still produces the uncoupled artifacts it can create. **`AGENTS.md` and
   `CLAUDE.md` are one routing unit:** if either is *not ours* — foreign, **or recorded with bytes
   we did not write** — **neither** is written (ADR-15), so v0 can never install routing beside
   routing it does not own. A foreign peer reports `info` *not managed*; a recorded mismatch reports
   `error`.
4. `doctor` reports A1, A2 and A3 against the committed fixtures, with A3 labelled *inspection* and
   bounded to what it inspected — never "there is no enforcement", never "enforcement works".
5. `doctor` **passes against `the-foreman`'s own repository** (dogfood).
6. `python3 -B tools/steward doctor` behaves identically under Python **3.9.6 and 3.13.5**, with no
   Claude tooling on the machine.
7. No cross-skill imports or shell-outs in either direction (#29), asserted by a test.
8. Renderers are pure: rendering twice is byte-identical, and no generated artifact contains a
   wall-clock timestamp, an absolute path, or unsorted iteration (ADR-8).

## The failure mode everything is designed against

**Any path by which `the-steward` silently does nothing** reproduces the exact disease it exists to
cure, while adding the false confidence of apparent coverage. Every design choice is evaluated
against "how would this fail silently, and what makes that failure loud?"

| # | Silent-failure risk | What makes it loud |
|---|---|---|
| S1 | A check passes vacuously over an empty scope | ADR-30: a scope resolving to zero items is an `error` unless the manifest carries an `intentionallyEmpty` record **for that scope key** (`docsScope` / `commands` / `paths`) — `warn` while proposed, `info` once confirmed. Never silent. A repo with no manifest declares no scope at all: `info`, exit 0, cardinality printed (ADR-32) |
| S2 | A wall-clock stamp in a generated artifact permanently destroys render-and-diff | ADR-8: renderers are pure. Observed in the reference repo (`verified-contracts.md` §2.3.11, row 3): one generator embeds `generatedAt` and produced 19 pure-churn commits; its sibling supports `--check` precisely because it does not |
| S3 | mtime-based drift is meaningless in a fresh clone, a worktree, or CI | ADR-9: content digest only |
| S4 | Unresolvable references dropped silently — hides a real edge **and** manufactures a false orphan | ADR-28: every dropped candidate emits a diagnostic |
| S5 | Checks that scrape a vendor CLI's human-readable output become permanent no-ops when the vendor rewords | ADR-18: commands are resolved structurally and never executed; nothing parses vendor prose |
| S6 | `__pycache__` written on first run makes "writes nothing" false — and no runtime guard can prevent it, because `__main__` is cached before the core's first line runs | ADR-1: `-B` (or `PYTHONDONTWRITEBYTECODE=1`) is part of **every** documented, printed and generated invocation, not an optimization. The dual-interpreter fixture (criterion 1, plan P1.8) asserts the cache paths directly and carries a bare-invocation negative control |
| S7 | `find`-based corpus enumeration dies of buffer exhaustion — verified: 175,944 paths vs 1,091 tracked (`verified-contracts.md` §2.3.11, row 1) | ADR-10: `git ls-files -z` with an explicit output cap, **unioned with the documents the manifest records as ours** so a just-generated artifact is not skipped. Exceeding the cap is **exit 2 naming the cap**, never a truncated corpus reported as checked |
| S8 | Presence read as proof — the check that would have passed for the dead Codex harness the entire time | ADR-28: every finding carries its evidence tier; inspection is never reported as proof |
| S9 | A tool crash reads as a pass | ADR-13: exit 2 for a tool fault, distinct from exit 1 for findings |
| S10 | Vendoring Python into a Go/Rust/docs-only repo trips language stats and host linters | Contained to one directory. Ordinary create-only ownership decides the rest, in ADR-20's ordinary three states (ADR-1, owner 2026-08-11): **absent** → `generate` creates it; **ours** → re-rendered in place; **not ours** → the exact bare-form line is **printed in the report as an advisory** and never written into a file we did not create |
| S11 | Multiple competing metadata contracts drift independently (the reference repo has three, all failing) | Exactly one contract manifest, `.steward.json` (ADR-2, ADR-11) |
| S12 | Copy-pasted frontmatter parsers drift (four already exist in the reference repo) | ADR-31: exactly one vendored parser, a written-down `key: value` subset as the contract, and an `error` naming the file, line and construct for anything outside it — never a silent skip |

## Undo

There is no rollback command. Every **artifact** the-steward writes is one it created, enumerated in
`.steward.json` as a whole file, and reproducible by re-running `generate` because renderers are
pure; `.steward.json` itself is rewritten every run and is tracked, so git history covers it too
(ADR-20). Deleting them is `git rm` / `rm`, and git history is the restore path. The-steward never
holds artifact bytes it did not write, so there is nothing for a rollback command to restore.

## How v0 came to be shaped this way

The design bundle went through **five independent review rounds**: 14, 14, 15, 17, 19 findings —
rising, after two scope cuts. Roughly 82 findings. Fixes repeatedly created new defects; three
separate silent-disable bugs were introduced *by* the fixes for earlier silent-disable bugs.

The decisive observation: **every one of those findings was in enforcement plumbing** — git hooks,
the install transaction, ownership classes, rollback, recovery journals, exit-code contracts,
interpreter pinning, CI workflow ownership, harness hook configs. **Not one was about scanning a
repo, generating honest docs, or verifying that claims resolve.** That part was never contested in
five rounds.

So the owner cut all enforcement machinery. v0 is the uncontested part alone.

| Date | Decision | Source |
|------|----------|--------|
| 2026-08-10 | Build as a fifth skill in `the-foreman`; decoupling deferred to issue #29 | Owner, `codex-gate question` → GROUNDED |
| 2026-08-10 | Name `the-steward` (over `groundskeeper`, `agentize`) | Owner |
| 2026-08-10 | Core runtime = vendored dependency-free Python 3, floor 3.9 | Owner (ADR-1) |
| 2026-08-11 | Manifest = `.steward.json`, tracked, at the repository root | Owner (ADR-2) |
| 2026-08-11 | `.gitattributes` uses the **bare** attribute form, never `=true` | Owner (ADR-1) |
| 2026-08-11 | Scope cut 1 — all harness-native hooks deferred | Owner |
| 2026-08-11 | Scope cut 2 — create-only ownership | Owner |
| **2026-08-11** | **Scope cut 3 — ALL enforcement machinery cut. v0 = `scan` / `generate` / `check` / `doctor`, read-only by default.** Removes the git hook, the install transaction, the recovery journal, rollback, the launcher, the interpreter pin, the tier matrix, CI generation, and the extended exit-code contract | **Owner**, after five non-converging review rounds |
| **2026-08-12** | **Scope cut 4 — the generated-region protocol (ADR-7) deleted**, with Phase 5 and escalation E1. `CLAUDE.md` carries the routing content directly; one comparison domain, the whole file | **Owner** |
| 2026-08-12 | **A manifest record is evidence, not a grant** — a recorded path is written only while its bytes match the recorded digest. Consequence: `generate --force` is gone and v0 has no flags | Owner (ADR-20) |
| 2026-08-12 | Frontmatter is a documented `key: value` subset, one vendored parser, loud error outside it | Owner (ADR-31) |
| 2026-08-12 | Doc index paths fixed at `docs/steward/routing-map.md` and `docs/steward/orphans.md` | Owner (ADR-20) |
| 2026-08-12 | Codex's 32 KiB cap check downgraded `error` → `warn` (E2 ruled); upgrades only on verification | Owner (ADR-17) |
| **2026-08-12** | **No core, no run** — a foreign `tools/steward/` means `generate` writes **nothing at all**, manifest included, so a dangling `$schema` is impossible rather than policed | **Owner** (ADR-20) |
| **2026-08-12** | **The packaged core declares its own inventory**; `generate` syncs the target to it (install / re-copy / delete a byte-matching removal) instead of walking a directory | **Owner** (ADR-20) |
| **2026-08-12** | **The frontmatter schema is a required-key list** plus an optional non-empty check; unknown keys pass silently, no types, nothing vendored | **Owner** (ADR-31) |
| 2026-08-12 | The `CLAUDE.md` hand-edit regression is **accepted and documented**, not solved — no region, no flag, no remedy mechanism | Owner (ADR-15) |
| **2026-08-13** | **C1/C2 claims come from two manifest record sets only** — no prose, code span, fence or link is ever scanned; a prose claim is not verified | **Owner** (ADR-32) |
| **2026-08-13** | **The manifest is the single claim source.** The rendered *Source of Truth Map* and *Verification Commands* sections are output and are never read back — no parser for them exists. Claim cardinality is the record count; a hand-edit to a rendered section is reported as a modified file, not as a changed claim | **Owner** (ADR-32) |
| **2026-08-13** | **Single-writer.** Concurrent `generate` runs in one repository are unsupported and undefined; no lockfile, no re-verify-before-replace, no concurrency claim | **Owner** (ADR-20) |
| **2026-08-13** | **A recorded-but-modified routing file is *not ours*, full stop** — `error`, and it suppresses its peer's write exactly like a foreign file | **Owner** (ADR-15, ADR-20) |
| **2026-08-13** | **Zero C1/C2 inputs on a repo with no manifest is `info`, exit 0** — the vacuity rule governs scopes we manage; a managed scope resolving to zero items stays an `error` | **Owner** (ADR-30, ADR-32) |
| **2026-08-13** | **`AGENTS.md` + `CLAUDE.md` are one routing unit** — if either exists and is not ours, neither is created and both are reported unmanaged | **Owner** (ADR-15, ADR-20) |
| **2026-08-13** | **The line-count check is deleted** — check, tests and vendor reading. Restores ADR-23's count of acted-on vendor readings to two | **Owner** (ADR-17, ADR-23) |
| **2026-08-13** | **Frontmatter values are opaque literals** — everything after the first colon, verbatim. Only keys have syntax; the forbidden-construct list for values is deleted | **Owner** (ADR-31) |

## Where the design is still thin, stated plainly

- **v0 no longer invents any mechanism.** The generated-region protocol (ADR-7) — paired sentinels
  and a four-state digest × re-render table, no prior art — was the one *[invented]* piece and it is
  **deleted** (owner, 2026-08-12); everything v0 writes is now a whole file compared over the whole
  file. **The cost is a real regression and it is accepted, not solved (owner, 2026-08-12):** with
  regions gone, a human who adds a paragraph of their own prose to `CLAUDE.md` gets an `error` and
  **v0 offers no in-tool remedy** — no flag, no adopt, no marked region will be added to give one.
  The two honest answers are: **put the prose in `AGENTS.md`**, which is the canonical file anyway,
  or **keep `CLAUDE.md` as your own file** — create-only means it is yours if it existed before the
  first `generate`, and the-steward will report it as *not managed* and never touch it. That is the
  trade: a duplicated file the tool regenerates and a hand-edit you must route around, bought
  against a novel protocol plus a vendor claim nobody probed. The same trade applies to **every**
  owned artifact, `.gitattributes` included — create-only has no seam for someone else's line.
- **Two vendor readings v0 still acts on are unverified, and the behavior was reduced toward what
  the evidence supports (ADR-23).** ADR-17 (*Codex's `project_doc_max_bytes` is 32 KiB and the
  excess is silently dropped*) has **no probe** in `verified-contracts.md`; the owner's call
  (2026-08-12) keeps the check as a **`warn`**, upgrading to `error` only against a verified cap.
  **ADR-15 is the second, and "dropped" would be the overclaim:** the `@AGENTS.md` import is gone,
  but v0 still *writes* `CLAUDE.md` on the unprobed reading that Claude Code loads it — ruled
  **proceed with stated risk**, the risk being a redundant owned artifact that possibly nothing
  reads. Three further vendor readings — ADR-4, ADR-16, ADR-18 — are acted on nowhere.
- **Frontmatter validation is thinner than "schema" suggests.** The manifest declares **a list of
  required key names** plus an optional non-empty check, and nothing else: unknown keys pass
  silently, and **no value is type- or format-checked**, so a required `date:` holding `2026-13-45`
  passes (ADR-31). Values are **opaque literals** — everything after the first colon, stripped once
  and then untouched — so real YAML is read as text and `status: [draft]` is the seven-character
  string `[draft]`, not a list.
- **C1 and C2 only see the manifest's two record sets (ADR-32).** A claim written in prose is not
  verified, a hand-edit to a rendered section changes no claim, and no heuristic will be added to
  guess at either. The coverage v0 reports is the record count, which is why the report always
  prints it. **A path whose name contains a control character cannot be a record at all** — `scan`
  refuses to propose it and says so, so v0 makes no claim about it.
- **The interpreter question is one machine.** Every claim in `verified-contracts.md` about
  interpreter layout is a single macOS arm64 data point, which is why v0 asserts a floor loudly
  rather than pinning anything.
