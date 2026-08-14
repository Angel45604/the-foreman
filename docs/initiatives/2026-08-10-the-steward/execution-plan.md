# `the-steward` v0 — Implementation Plan

Derived from [`PDR.md`](./PDR.md) + [`ADR.md`](./ADR.md) in this folder. Phases are
dependency-ordered; each is scoped to one review sitting. **The phase set is frozen at
plan-approval** — merging, splitting, or reordering it afterward is a decision-fork that returns to
the owner.

> **Pre-approval changes, kept visible.** *Round 6:* the scan-then-confirm state machine moved from
> Phase 8 to **P3.5–P3.8** because Phases 4 and 6 read record state, and C4 moved from Phase 7 to
> **P4.6** because the PDR defines it as part of `check`. *Round 7 (owner, 2026-08-12):* **Phase 5 is
> retired** with the region protocol it existed to build (ADR-7 deleted). *Round 8:* P4.6's
> **remaining** forward dependency — the real renderers, which arrive in Phase 6 — is stated rather
> than waved away: Phase 4 builds the comparison engine, Phase 6 fixtures the real artifacts.
> This plan is **not yet approved**, so the freeze above has not taken effect; it binds from approval
> onward. The numbers **5** and **8** are retired, not reused.

- **Branch:** `feat/the-steward` (off `origin/main`)
- **Skill home:** `plugin/skills/the-steward/`
- **Vendored core (what ships into target repos):** `plugin/skills/the-steward/core/` → copied to
  `tools/steward/` in the target
- **Bundle:** this folder (untracked, matching the prior initiative's pattern — it cites a private
  reference repo)

## Global constraints

- [ ] **Issue [#29](https://github.com/Angel45604/the-foreman/issues/29) invariants hold at every
      phase.** No imports, requires, or shell-outs between `the-steward` and any sibling skill, in
      either direction. A shared helper is a signal to duplicate a few lines, not to create a common
      module. Asserted by a test from Phase 1 onward.
- [ ] **Zero third-party dependencies** in the core (ADR-1). Asserted by an import-audit test.
- [ ] **TDD, RED first.** Every behavioral task starts with a failing test.
- [ ] **Every documented, printed, generated and tested invocation carries `-B`** (ADR-1). A bare
      `python3 tools/steward` caches `__main__` before the core's first line runs, so no runtime
      guard can make it read-only; `-B` is part of the command, not an optimization. **The path has
      exactly two forms:** the canonical **installed** form `python3 -B tools/steward …`, and the
      **bootstrap** form `python3 -B <skill-dir>/core …`, which is the only way to run before a core
      exists in the target (ADR-1, ADR-20; tested in P1.9). **The report advertises the installed
      form only after the core is installed** — before that, and on a foreign-core collision, it
      prints no `tools/steward` string at all (P6.5a, P9.4).
- [ ] **Read-only by default.** `scan`, `check` and `doctor` write nothing — asserted as P1.8
      specifies (`git status` **plus** both candidate cache paths named directly, because a
      `git status` assertion alone is vacuously green on Apple's 3.9.6). Only `generate` writes.
- [ ] **`generate` is the only writer, and the only persister.** `scan` prints and writes nothing;
      scan deltas reach `scan.pending[]` only through the next `generate` (ADR-11).
- [ ] **No prompt anywhere** (ADR-11). Confirmation is a human edit to the tracked `.steward.json`,
      reviewed as a diff. Every verb behaves identically with and without a TTY — there is no
      interactive mode to test and no non-interactive fallback to get wrong.
- [ ] **One digest function, one domain** (ADR-9): SHA-256 over the **whole file**, for stored and
      recomputed alike. Never a git blob id, never mtime. There is no second comparison domain.
- [ ] **Renderers are pure** (ADR-8): render twice, byte-compare; no clock, randomness, absolute
      paths, or unsorted iteration.
- [ ] **The only subprocess is `git`** (ADR-18), spawned with an argument vector, an explicit
      `timeout=`, and an output cap. **No documented command is ever executed.**
- [ ] **One containment predicate** (ADR-26): every path of **repository data** resolves, after
      symlink resolution, inside `git rev-parse --show-toplevel`; the repo root comes from cwd via
      git, never from the core's own location. The single exemption is **read-only** and is the
      executing core's own source directory (`Path(__file__).parent`), which is what a first run
      copies from; nothing outside the working tree is ever written.
- [ ] **Create-only, and a record is evidence not a grant** (ADR-20): **an existing file is written
      only if the manifest records it *and* its bytes match the recorded digest.** Everything else
      that exists is left byte-identical and reported. An **absent** target is created and recorded
      in the same run; that is the only way a path becomes ours. `.steward.json` is outside this
      rule by construction and is rewritten every `generate`.
- [ ] **Single-writer** (ADR-20, owner 2026-08-13): one `generate` at a time over an otherwise-
      quiescent working tree. **Concurrency is out of scope, not defended** — no phase may add a
      lockfile, a re-verify-before-replace step, a retry, or a test asserting two simultaneous runs
      are safe, because each would claim a guarantee v0 does not provide.
- [ ] **The manifest is the single claim source** (ADR-32, owner 2026-08-13): C1 and C2 read
      `.steward.json` records **only**. The rendered *Source of Truth Map* and *Verification
      Commands* sections are output — **no phase may add a reader, parser or round-tripper for
      them**, and no task may take a claim off disk.
- [ ] **No core, no run** (ADR-20, owner 2026-08-12): if `tools/steward/` is occupied by anything not
      fully ours, `generate` writes **nothing at all** — no manifest, no docs, no indexes, no
      `.gitattributes` — and reports the collision. No phase may add a partial-write path around it.
- [ ] **No flags anywhere** (ADR-20). `generate --force` is gone with the record-is-not-a-grant
      rule; a hand-edited owned artifact is an `error` whose remedy is `git checkout` / `rm` plus a
      re-run. Every verb rejects every flag.
- [ ] **No enforcement claim** (ADR-4) in any generated text, report line, `SKILL.md` sentence, or
      README paragraph. Asserted by a wording test over the rendered corpus.
- [ ] **Exit codes are exactly `0` / `1` / `2`** (ADR-13). No phase may introduce a fourth.
- [ ] **No product code against an unverified vendor contract** (ADR-23). The agent may not waive
      this; each unresolved contract is escalated to the owner individually. **Both round-6
      escalations are ruled on (owner, 2026-08-12) and no plan task is gated:** E1 is *proceed with
      stated risk* — the `@AGENTS.md` import is gone, the generated `CLAUDE.md` is not (ADR-15) —
      and E2 keeps the cap check at **`warn`** (ADR-17). If a new unverified contract appears, it escalates — it does not ship.
- [ ] Existing suites stay green: `node --test plugin/skills/the-foreman/references/*.test.mjs
      plugin/skills/the-foreman/evals/*.test.mjs` and `bash plugin/skills/codex-gate/codex-gate.test.sh`.

## Acceptance test set

Three real failures observed in a reference monorepo, reproduced as **sanitized, committed
fixtures** (defined in PDR "Acceptance"; live runs against the private repo are optional
corroboration, never a test dependency).

- [ ] **A1** — documented command that does not exist → C1, *resolved* (P4.5).
- [ ] **A2** — doc claim about a file that does not exist → C2, *resolved* (P4.5).
- [ ] **A3** — silently inactive git hook → `doctor`, **inspected**, bounded, neither banned
      sentence. Specified once, in P7.4.

`doctor` **aggregates all three**: `check` owns C1–C5, and `doctor` composes `check`'s findings with
its own inspection findings so one command answers "is this repo telling the truth?"

---

## Phase 0 — Contract pinning — ✅ **COMPLETE 2026-08-11**

**Deliverable: [`verified-contracts.md`](./verified-contracts.md).** Contracts extracted from the
**shipped binaries** (Claude Code 2.1.201; codex-cli 0.147.0-alpha.6.5), not from prose. Hooks were
actually fired where possible.

**Most of what Phase 0 investigated is now historical**, because the features it pinned contracts
for were cut — its findings are the *reason* they were cut. **`verified-contracts.md` §0 is the map
of what remains load-bearing** and is not restated here, so the two cannot drift apart.

## Phase 1 — Skill packaging + core skeleton

The skill itself is a deliverable, not an afterthought — the repo currently documents and installs
exactly four skills.

- [ ] **P1.1** `plugin/skills/the-steward/SKILL.md`, with a description that triggers on **both**
      entry modes (agentize this repo / check whether these docs are still true), so agents invoke
      it mid-build and not only at setup. **No enforcement language anywhere in it** (ADR-4).
- [ ] **P1.2** Packaging: `plugin/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`,
      README (bundled-skills list, install instructions, the personal-symlink loop, test commands),
      release metadata. **Package smoke test asserting the bundled skills by name**, `the-steward`
      among them — not by count, which goes stale the moment a concurrent skill merges.
- [ ] **P1.3** `core/` with `__main__.py`, flat absolute imports, and subcommand dispatch:
      **`scan` · `generate` · `check` · `doctor`**. Nothing else. **v0 has no flags** (ADR-20); a
      test asserts every verb rejects every flag — including `--force`, which no longer exists, and
      `--version`, which never did (the core's version is a line in `doctor`'s report, ADR-28).
      Interpreter **floor
      assertion as the first action**, failing loudly with the observed version (ADR-1), plus the
      one-line bytecode notice when `sys.dont_write_bytecode` is false, which does **not** change
      the exit code. Exit codes `0/1/2` (ADR-13), with a test that an unhandled exception yields
      **2**, never 0.
- [ ] **P1.4** Canonical JSON I/O (ADR-2), including the temporal rule: observation timestamps are
      rejected by the schema.
- [ ] **P1.5** `manifest.v1.json` schema + dependency-free validator. **The manifest is
      `.steward.json`, tracked, at the repository root** — never under `tools/steward/`, which
      inherits `linguist-vendored`. It is the control plane, so it is never digested, never
      compared, and never listed among its own recorded paths (ADR-2). Lifecycle tests, one per
      state it can be in:
      **missing** → every verb still runs; `generate` creates it; `check`/`doctor` report an
      unmanaged repo and write nothing;
      **foreign** (valid, but not written by this tool) → **accepted as the contract** for its scope
      and command records, since there is no ownership proof to consult — **but it grants nothing**
      (P6.4(d));
      **malformed** → **exit 2** with expected-vs-observed detail, never exit 0, never a silent
      reset;
      **modified** (a human edited a record) → honored; `generate` does not revert a matching
      `confirmed` record (ADR-11);
      **deleted after `generate`** → the artifacts it created are *not ours* again (they exist and
      nothing records them): reported *not managed*, never overwritten.
      **The frontmatter schema is a required-key list** (ADR-31): schema tests for a list of key
      names plus the optional non-empty-value boolean, and for the rejection of any other shape —
      there is no validation vocabulary to admit. **Plus the two ADR-32 record sets** — the approved
      command set and the declared path list — each an ADR-11 record carrying `state` and
      `confidence`, and each round-tripping canonically. **Command records additionally carry
      `resolution` ∈ `repo-declared | external`, a closed set** (ADR-18): schema tests for each
      value, for the rejection of any third, and for the rule that **`external` is valid only on a
      `confirmed` record** — a `proposed` record carrying it fails validation, because a scanner
      cannot establish that an absent tool is legitimately external.
      **Plus record-value representability** (ADR-32): a command or path value that is empty,
      differs from its stripped form, or contains an ASCII control character (U+0000–U+001F —
      **CR, LF and TAB each fixtured** — or U+007F) **fails validation → exit 2**, naming the
      record, the code point and its index. A value containing Markdown-significant characters
      (`# x`, `---`, `a | b`) **validates**, because nothing parses the rendered section back;
      P6.1 asserts it renders verbatim.
      **Plus `intentionallyEmpty` records, keyed per scope** (ADR-30): the three keys
      `docsScope` / `commands` / `paths` round-trip, an unknown key is rejected, and a record for
      one key does **not** satisfy another.
      **Plus trackedness** (ADR-2, ADR-13), predicate *is it in the index*: **untracked** (what
      greenfield leaves) → `doctor` `warn`, tier *inspected*, **exit 0**; **staged** and
      **committed** → no finding; **`git rm --cached`** → `warn` again.
- [ ] **P1.6** Findings model: `{id, severity, tier, claim, observed, where, confidence}` with
      `tier` ∈ *resolved | rendered | inspected | **inferred*** (ADR-28) and **`confidence` ∈
      *high | low*, exactly two values**. **The rule is one line and the tier carries it:
      `confidence` is required when `tier` is `inferred` and forbidden on every other tier** —
      *inferred* is the tier of every `scan` conclusion (PDR §1, ADR-11), and a check that resolved
      a real object has a tier, not a guess. Schema tests assert both halves: an `inferred` finding
      with no `confidence`, and a *resolved* / *rendered* / *inspected* finding carrying one, are
      each rejected. A test also asserts **no `inferred` finding is ever emitted at `error`** on its
      own (ADR-28) — an inference becomes an ADR-11 record, and the record's state sets the
      severity. **ADR-11 records persist the same field**
      (ADR-2, *scan confidence per inference*), so the level survives into `.steward.json` and
      round-trips through canonical JSON byte-identically (P1.4). The report renderer always prints
      the tier, prints the confidence wherever there is one, and prints the cardinality of what each
      check examined (ADR-30).
- [ ] **P1.7** Import-audit test: zero third-party imports; no cross-skill import edges (#29); the
      core suite runs independently of every sibling skill.
- [ ] **P1.8** No-incidental-writes fixture — **dual-interpreter** (3.9.6 and 3.13.5), asserting per
      interpreter: `git status --porcelain` unchanged; **no cache file at the exact path each
      steward module would use under that interpreter**; and the import set. Single-interpreter, or
      `git status` alone, is vacuously green on Apple's build (ADR-1).
      **The paths are computed, not named.** For every module in the core's inventory (P6.5a),
      including `__main__.py`, the expected cache path is
      `importlib.util.cache_from_source(<module path>)` **evaluated inside the interpreter under
      test**, which is what honors that build's `sys.pycache_prefix` — so the assertion lands on
      `tools/steward/__pycache__/<mod>.cpython-3XX.pyc` on 3.13.5 and on the redirected path under
      Apple's 3.9.6. **Naming the `sys.pycache_prefix` root instead is wrong twice:** the root is
      shared and can already hold unrelated caches from other programs, and its mere emptiness or
      non-emptiness says nothing about *this* source file.
      **Snapshot before and after** — existence and mtime of each computed path — and assert each is
      unchanged, so a cache that was already there is not read as a pass **or** as a failure.
      **Negative control, under both interpreters (not only 3.13.5):** the **bare** form must
      produce **exactly the computed cache path for `__main__.py` under that interpreter** — which
      on 3.9.6 proves the redirected-path assertion is sensitive rather than green because it is
      pointed somewhere nothing ever writes — **and** print the bytecode notice. Without the cache
      file the fixture cannot tell "`-B` works" from "nothing was checked", and without the line
      nothing proves the notice fires rather than being shadowed by the belt-and-braces assignment.
- [ ] **P1.9** Containment predicate (ADR-26). Tests: `../` escape, an absolute path outside the
      tree, a symlinked docs dir pointing out — each exit 2 — and the **bootstrap invocation**
      `python3 -B <plugin>/skills/the-steward/core scan` with cwd inside a target repo: the root
      resolves from cwd, not from the core's location, and the run does not error on its own source
      path. **That invocation is the sanctioned bootstrap form** (ADR-1) — it carries `-B` like every
      other, and a test asserts its output advertises **no `tools/steward` command** while no core is
      installed there. Plus one test per half of the exemption: the core **may read** a file under
      `Path(__file__).parent` outside the tree and **may not write** outside it at all.
- [ ] **P1.10** Atomic write helper: temp staged **at the repository root** — never in the target's
      own directory, which under `tools/steward/` turns a kill into a permanent foreign-child
      collision (ADR-20) — created **exclusively and with a random name** via
      `tempfile.mkstemp(dir=<repo root>, prefix='.steward-tmp-')`, never opening, following or
      truncating a path that already exists; **`chmod` before `os.replace`** (verified: it takes the
      source file's mode, and `mkstemp` hands back `0600`); cross-filesystem `os.replace` → **exit 2**
      naming both paths, never a partial write. **Tests, because a predictable `<pid>-<n>` name is a
      write primitive for somebody else:** a regular file already at a candidate staging path is
      never truncated, and a **symlink** at one is never followed (the outside target survives
      byte-identical, ADR-26). **These are hostile-path tests, not concurrency tests — v0 is
      single-writer and concurrent `generate` runs are out of scope (ADR-20), so no test asserts
      anything about two runs in one repo and no code defends against one.**

**Done when:** the plugin loads `the-steward` among its bundled skills, by name, and
`/the-foreman:the-steward` resolves; `python3 -B tools/steward scan` behaves identically under 3.9.6
and 3.13.5 and creates no cache file at either candidate location; manifests round-trip
byte-identically; every manifest-lifecycle test passes and a malformed manifest exits 2; the import
audit passes.

## Phase 2 — Git substrate

- [ ] **P2.1** Corpus enumeration via `git ls-files -z -- '*.md'` with an explicit output cap
      (ADR-10), filtered by the **document predicate** — tracked `*.md`, minus anything
      `git check-attr -z linguist-vendored linguist-generated` reports in any state but
      `unspecified` / `unset` / `false` (so `set` **and** valued forms like `=true` both exclude;
      one fixture per state, because matching the word `set` alone admits the valued ones) — unioned with the
      manifest's **`rendered`** paths satisfying the same predicate (never `copied` — ADR-2), deduped
      and sorted; otherwise `check` skips the artifacts `generate` just wrote and passes vacuously.
      **Predicate tests, because "every tracked file" is the wrong corpus:** a tracked `.py`, the
      generated `.gitattributes`, a copied `tools/steward/*.py`, and a **tracked vendored docs tree**
      carrying `linguist-vendored` are each absent; a tracked `docs/x.md` is present.
      **Then three enumeration tests, because the obvious one proves the wrong thing:**
      (a) **exclusion** — 100k untracked markdown files are **not seen** (this is what `git ls-files`
          does by design; it says nothing about the cap, since none of them reach the output);
      (b) **bounded loud failure on a large tracked corpus** — a fixture whose **tracked** NUL-
          delimited output exceeds the cap, built cheaply by lowering the cap rather than by
          committing 100k files. **The cap is a module constant the test overrides in-process;
          there is no flag for it** (P1.3 rejects every flag). It must **exit 2 naming
          the cap** (ADR-13), never truncate and report findings over a partial corpus;
      (c) **the union is live** — a freshly generated, still-untracked `AGENTS.md` appears in the
          corpus, and a path recorded as ours that no longer exists does not silently vanish from
          the report (it is the `warn` in ADR-13);
      (d) **two corpora** (ADR-10) — the **checking** corpus contains
          `docs/steward/routing-map.md` and `docs/steward/orphans.md`; the **source** corpus the
          indexes render from does **not**. Asserted as an exclusion on the enumerator itself, so an
          index can never become its own input.
- [ ] **P2.2** Content digests (ADR-9): **SHA-256 over the whole file, one domain always** — no git
      blob ids and no clean/dirty fast path. Regression test over the
      transitions that broke the two-domain version: the same generated file **untracked → staged →
      committed → dirty** yields **one** digest throughout, so `git add` alone can never turn an
      in-sync artifact into one whose bytes we claim not to recognize.
- [ ] **P2.3** Tracked / untracked / ignored tri-state; `git log -1 --format=%cI` for dates.
- [ ] **P2.4** Repo-root resolution and the `git status --porcelain` cleanliness assertion used by
      every read-only test.
- [ ] **P2.5** Hooks-path **inspection** (read-only, for A3): resolve it via
      `git rev-parse --path-format=absolute --git-path hooks`, report default vs redirected, and stat
      any hook found for presence and mode bit. Tests: unset · set-but-equivalent-to-default · a
      foreign path · a **relative** path (resolved per-worktree against the working-tree root).
      **Nothing written, nothing configured**; every finding carries the *inspected* tier.

**Done when:** the document predicate excludes tracked non-documents and tracked vendored docs;
untracked files are excluded at 100k scale **and** an oversized tracked corpus exits 2 naming the
cap; one digest survives the untracked→staged→committed→dirty walk and is stable across a fresh
clone; and the hooks-path inspection matrix reports correctly in all four branches with no writes.

## Phase 3 — Scan, and the record state machine

**Moved forward from Phase 8 in round 6**, because every consumer downstream reads record *state*:
C1's severity depends on proposed-vs-confirmed, C5 reads an `intentionallyEmpty` record's state, and
`generate`'s grant set goes into the same manifest. The old Phase 8's tasks are **P3.5–P3.8** below,
renumbered and otherwise intact; the number 8 is retired, not reused.

- [ ] **P3.1** Project-root and stack detection, per project. Never emit one ecosystem's assumptions
      into another's repo.
- [ ] **P3.2** Build / test / lint command discovery, **structural only** (package scripts, Makefile
      targets, task-runner entries, tracked executables) — ADR-18. **Every inference is tier
      *inferred* and carries its evidence and a `confidence` of `high` or `low`** (P1.6), on the
      finding and on the record it becomes; scan fixtures cover both levels, since `low` is the path
      P3.7 exercises. **Every proposed command record gets `resolution: "repo-declared"`, and a test
      asserts `scan` can never emit `external`** (ADR-18) — the scanner cannot tell a legitimate
      external tool from a command that does not exist, which is A1 itself. Fixtures: a
      repo-declared command resolves; a **human-confirmed `external`** record (e.g. `docker build`)
      is reported `info`/*inspected* and counted separately; a missing unapproved command is a
      finding at the record's severity.
- [ ] **P3.3** Docs-scope inference and existing-agent-doc detection (`AGENTS.md` at any depth,
      `CLAUDE.md`, harness dirs). **This is also where the declared path list comes from** (ADR-32):
      the paths scan infers as a repo's sources of truth become ADR-11 records, each with its
      evidence and confidence, and P6.1 renders them as the Source of Truth Map — **rendering only;
      the records stay the claim source**. Nothing else ever becomes a C2 claim — there is no prose
      scanner upstream of this. **A path git reports whose name contains a control character is
      never proposed** (ADR-32): fixture a repo with a newline-containing tracked `*.md` path — the
      record set omits it, a diagnostic names it (ADR-28), and `scan` still exits 0.
- [ ] **P3.4** Scan report rendering. **`scan` writes nothing — not even a pending record** (fixture:
      two consecutive `scan` runs leave `git status --porcelain` and `.steward.json` byte-identical,
      including on a repo with no manifest at all).
- [ ] **P3.5** The ADR-11 state machine end to end. **Two stored states only — `proposed` and
      `confirmed`**, asserted by a schema test rejecting any other value. **`drifted` is derived at
      read time**, never stored: confirm a record, change the repository under it, assert the finding
      reads *drifted* / `error` while the **stored record is byte-identical** before and after. Plus
      re-confirmation and the `waived: {reason}` downgrade. A re-scan reopens **zero** confirmed
      records; deltas reach `scan.pending[]` only through the next `generate`, the sole persister.
- [ ] **P3.6** A confirmed record is **never auto-deleted** — "the command vanished" surfaces as a
      derived *drifted* finding, which is A1's steady-state form.
- [ ] **P3.7** **No confirmation prompt exists** (ADR-11); confirmation is a human editing `state` in
      the tracked `.steward.json`. Tests: `generate` with unconfirmed `confidence: low` records
      **records them `proposed`, keeps the level, and neither prompts nor promotes**; the same run with stdin closed
      and with a pty gives **byte-identical** output and manifest. The tool never writes `confirmed`.
      **PARTIALLY DEFERRED TO PHASE 6 by owner decision 2026-08-14** (see
      `DECISION-2026-08-14-audit-shape.md`). Delivered in Phase 3: the closed-stdin vs
      controlling-terminal byte-identity fixture for the three verbs that exist (`scan`, `check`,
      `doctor`), and a bounded prompt lint whose claim is scoped to the forms it inspects. **Deferred,
      because `generate` does not exist until Phase 6:** its own byte-identity run, and the
      state-preservation invariant. The promotion AST audit was **deleted**, not narrowed — it claimed
      an absence it could not establish (ADR-28), and a syntactic oracle is never the guarantee.
- [ ] **P3.8** ADR-13 severity mapping asserted end-to-end as exit codes: confirmed → 1, proposed →
      0 with a `warn`, pending/waived/inspected → 0 with `info`.

**Done when:** scanning the-foreman's own repo and each of at least three stack fixtures (Node,
Python, docs-only) yields the right commands and scope with evidence and writes nothing; a second
scan reopens zero confirmed records; every transition has a test asserting its severity; and no code
path prompts.

## Phase 4 — Checks, read-only

- [ ] **P4.1** **C2** — read the manifest's **declared path list**, one claim per record, and
      nothing else (ADR-32): **no file is read for claims at all**, so there is no Source-of-Truth-Map
      parser, no code-span, fenced-block or link extraction, and no fence-language or URL rule to
      build. Normalize, then resolve contained and safe **against the working tree, not the index**:
      a declared path resolves if a non-ignored file exists at it.
      Tracked-ness is deliberately not required — `generate`'s output is untracked until a human
      stages it and v0 has no staging lifecycle. A path resolving **only** to a git-ignored file is
      unresolved, in the same terms as a missing one. Fixture: the greenfield artifacts satisfy C2
      **before** any `git add`. **Every unresolvable listed path emits a diagnostic** (ADR-28) —
      silent drops hide real edges and manufacture false orphans.
      **Negative fixtures, because the claim-source limit is the contract:** a document whose
      *prose* names a missing file, whose *code span* holds `` `docs/gone.md` ``, whose *fenced
      block* (tagged and untagged) contains missing paths, and whose *link* targets `./gone.md` and
      `https://example.com/gone.md` produce **zero C2 findings** — and the same missing path
      **does** produce one the moment a **record** declares it.
      **Plus the ruling's own edge (ADR-32, owner 2026-08-13):** hand-edit a path line **into** the
      rendered Source of Truth Map of `AGENTS.md` → **C2's cardinality and findings are unchanged**
      (the claim set is the record set), and the edit surfaces instead as `AGENTS.md` not matching
      its recorded digest — `error`, never overwritten. Delete a path line **out** of the rendered
      section → same result. Asserted on both the finding list and the printed cardinality.
- [ ] **P4.2** **C1** — read the manifest's **approved command set**, one claim per record, and
      nothing else (ADR-32) — **no document is read**; resolve each structurally against the repo's
      own declarations, **branching on the record's `resolution` kind** (ADR-18): `repo-declared` →
      resolved structurally, unresolved is a finding at the record's severity, tier *resolved*;
      `external` → **not resolved and not counted as checked**, reported `info`, tier *inspected*,
      and counted on its own line of the cardinality report so it can never inflate coverage
      (ADR-30). **`PATH` is never consulted for either kind**, asserted by a test — an installed vs
      absent external tool must give byte-identical findings.
      **Three fixtures for the distinction the schema now carries:** a repo-declared command that
      resolves; a **confirmed** `external` record whose tool is absent from the machine → `info`,
      no `error`; and a `repo-declared` command that resolves to nothing → the A1 finding. **Plus
      the negative fixture:** a shell snippet in a fenced block and an inline `` `npm run nope` ``
      in prose produce **zero C1 findings**; the same command as a record produces one.
- [ ] **P4.3** **C3** — the vendored `frontmatter.py` (ADR-31) + schema validation over the declared
      scope. **One test per unsupported construct, and the list is key-side only** — an indented
      line, a non-`key: value` line (a `- ` list item, a bare `# comment`), a duplicate key, an
      unterminated block — each an `error` naming **file, line and construct**, never a skip and
      never a partial parse. Plus the happy path and a file with **no frontmatter**, which parses as
      the empty mapping and is a syntax error in no case.
      **Then the negative fixtures that pin values as opaque literals** (ADR-31, owner 2026-08-13),
      because the previous draft made these ambiguous: `status: [draft]`, `tags: {a: b}`,
      `owner: R & D`, `ref: *main`, `lang: C#`, `body: | more`, `summary: > later` and
      `title: "x"` each parse to **exactly the characters after the first colon, stripped once**,
      and produce **no finding of any kind** — asserted on the parsed value, not just on the absence
      of an error, and with the **exact string** written into the assertion (`[draft]` is **seven**
      characters, `"x"` is three).
      **Then the whitespace rule, which is where the previous draft contradicted itself** (ADR-31):
      one `strip()` per side, applied once, then opaque. Exact-value assertions for `k: a` → `a`;
      `k:  a  b ` → `a  b` (interior preserved, both ends not); `k:` and `k:` + three spaces → the
      **empty string** (not a syntax error, and flagged only when the schema's non-empty boolean is
      set); `k: "  x  "` → `"  x  "` with quotes and inner spaces intact; and a key with space
      before the colon (`k : v`) → key `k`, value `v`.
      **Then the schema, which is a required-key list and nothing more** (ADR-31, owner 2026-08-12):
      a required key missing → finding at the record's severity (`warn` proposed / `error`
      confirmed); present but empty → a finding only when the non-empty boolean is set; **an unknown
      key → no finding at all**, asserted, because repos own their conventions. And one test that
      pins the honest limit: a required `date:` holding `2026-13-45` **passes**, because v0 checks no
      types and no formats.
- [ ] **P4.4** **C5 / ADR-30** — a scope resolving to zero items is an `error` unless an
      `intentionallyEmpty` record exists **for that scope key**, in which case it takes the record's
      ordinary severity: `warn` proposed, `info` confirmed. **Three fixtures × three keys**
      (`docsScope`, `commands`, `paths`), because one record must not silence another scope:
      **no record → `error`**, **proposed → `warn`** (the greenfield state, reachable with no
      hand-editing — P6.4(a) writes it), **confirmed → `info`**. **Plus the cross-key negative:** an
      `intentionallyEmpty` for `docsScope` leaves an empty `commands` set an `error`. Every check
      reports the cardinality it examined.
      **Then the unmanaged side, which the vacuity rule does not govern** (ADR-32, owner
      2026-08-13): on a repo with **no `.steward.json`**, C1 and C2 examine **zero** items and that
      is **`info`** — asserted on cardinality (`0`), on the finding text (*no claim source — nothing
      to verify*), and on the severity — and **the whole `check` exits 0**, C3 and C5 included,
      since nothing declares a scope there either (ADR-30). The exit code is asserted, because this
      row is the difference between exit 0 and exit 1 on every repository that has never run
      `generate`.
      Two brownfield variants of the same assertion: **AGENTS-only** and **CLAUDE-only** repos with
      no manifest. And the discriminator, asserted directly: **once a manifest exists the repo is
      managed** — the same brownfield repo after a `generate` has records, so C1/C2 report the
      **record count**, not zero, even though the routing pair was suppressed (ADR-15).
- [ ] **P4.5** **A1 and A2 acceptance fixtures**, sanitized and committed — a missing command in the
      **approved command set** (`resolution: repo-declared`) and a missing path in the **declared
      path list**, both from `confirmed` records (ADR-32): `check` exits 1, names both, and tags
      each *resolved*.
- [ ] **P4.6** **C4 — freshness by render-and-diff, and it belongs to `check`** (PDR: `check` is
      C1–C5; `doctor` composes it). Re-render every **`rendered`** artifact recorded as ours and
      compare **whole file to whole file** — one comparison domain, no region or marker handling;
      **`copied` paths have no renderer and C4 never touches them** (ADR-2). **Writes nothing.**
      ADR-2's states map to: stale → `warn`, bytes-we-do-not-recognize → `error`, missing → `warn`.
      **Phase 4 builds and fixtures the comparison engine against a *test* renderer**, since the real
      renderers do not exist until Phase 6 — that keeps the phase genuinely self-contained instead of
      declaring it so. **The real-artifact fixtures are in Phase 6, where the renderers are built**
      (`AGENTS.md` in P6.1, `CLAUDE.md` in P6.2, the indexes in P6.3) and are re-asserted **through
      `doctor`** in P7.2, because a check that exists only under `doctor` is a check `check` silently
      does not do.

**Done when:** `check` against the A1/A2 fixtures exits 1 and names both; an accidentally-empty
scope fails **per key**, while a repo with no manifest reports 0 claims as `info` and **exits 0**;
C4 detects a stale **test-renderer** artifact **from `check`** and writes nothing; a hand-edit to a
rendered claim section changes no claim and surfaces as a modified file; every unresolvable
reference produces a diagnostic; `git status --porcelain` is unchanged.

## Phase 5 — retired

**Empty on purpose (owner, 2026-08-12).** Phase 5 was *Renderers + the generated-region protocol*;
P5.2–P5.5 and P5.7 described region machinery that no longer exists (ADR-7 deleted). Renderer purity
and idempotence (old P5.1, P5.6) survive as a **global constraint** above and in Phase 6's done-when,
where the artifacts are actually built. The heading stays so review history citing P5.x resolves;
the number is not reused. **P4.6's comparison engine therefore has no forward dependency** — it
compares whole files, which Phase 2 already provides — while its *real-artifact* fixtures wait for
the renderers in Phase 6, which is where they are listed.

## Phase 6 — Generate

- [ ] **P6.1** **`AGENTS.md`** — the canonical routing network, rendered **from the manifest, never
      by parsing prose**. Pure (ADR-8), whole-file, create-only (ADR-20). Subject to ADR-16 (root
      canonical; nested is opt-in and warned). ADR-4's no-enforcement wording asserted in the output.
      **It renders the two claim record sets for a human reader** (ADR-32) — the **Source of Truth
      Map** from the manifest's declared path list and **Verification Commands** from its approved
      command set, one item per line, sorted, each line rendered from a record and from nothing
      else. **Rendering only: these sections are output, and P4.1/P4.2 read the records, so no
      parser for them is built here or anywhere** (global constraint).
      Tests: the rendered section is **byte-equal to the expected line block derived from the
      records** — one line per record, sorted, no extras — and an empty record set renders the
      section with its cardinality stated, never omitted, because a reader must not mistake an
      absent section for an empty one. **Each section renders inside a fenced block** (ADR-32) so a
      value that looks like Markdown cannot restructure the document: fixtures for a path beginning
      `#`, a command containing `|`, and an item that is literally `---` — each appears **verbatim**
      and the document's heading structure is unchanged. Values that cannot render at all never
      reach here: the schema rejected them (P1.5).
      **The ADR-17 byte-cap check reports a `warn`** (owner, 2026-08-12 — the 32 KiB value is
      unverified vendor prose): a boundary fixture at cap−1 / cap / cap+1 asserting **`warn` and
      exit 0**, and a test asserting the finding text says the cap is unconfirmed. No gate.
- [ ] **P6.2** **`CLAUDE.md`** — the routing content **written directly into the file** (ADR-15): an
      ordinary pure, whole-file, create-only artifact rendered from the same manifest as `AGENTS.md`
      **in the same run**. No import, no region, no sentinels. **One routing unit** (ADR-15): both
      or neither. Tests: one `generate` produces both and their routing sections agree (compared,
      not eyeballed) — including the two rendered claim sections, which must be **byte-identical**
      in the two files; a manifest change changes both; a hand-edited `CLAUDE.md` is a C4 `error`
      **through `check`**, never overwritten, and — the ruling that makes duplication safe —
      **changes no C1/C2 claim** (P4.1's edge fixture); and the coupling fixtures are P6.4(b).
- [ ] **P6.3** **Doc indexes** — **`docs/steward/routing-map.md`** and **`docs/steward/orphans.md`**
      (ADR-20), rendered from the **source corpus — the checking corpus minus these two paths**
      (ADR-10), so neither index is ever an input to itself. Both pure, both whole-file, both
      create-only; `generate` creates `docs/steward/` when absent, including in a repo with no
      `docs/` convention.
      **First-generation fixture, because this is where a self-input shows up:** on a greenfield
      repo, `generate` followed immediately by `check` re-renders both indexes **byte-identically**
      and reports neither as stale — run again after `git add`, which must change **git state
      only**: the rendered paths are already unioned into the checking corpus (ADR-10), so staging
      must leave **both corpus membership and the rendered index bytes unchanged**.
      Fixtures: greenfield creates and records both at exactly those paths; an existing
      `docs/steward/orphans.md` is left byte-identical and reported *not managed* (`info`) while the
      routing map is **still written**; `docs/steward` existing as a **file** leaves both *not ours*.
      **The orphan report is advisory**: never an `error`, and it must stay useful at reference
      scale — **601 orphans of 1,073 indexed docs (~56%)** (`verified-contracts.md` §2.3.11, row 5)
      — a triage ordering, not a flat dump.
- [ ] **P6.4** **Preflight + manifest-first write ordering** (ADR-20): classify every target
      **ours / absent / not ours** with zero writes — *absent* meaning no file of any kind there,
      checked immediately before the write — print the complete list including what would have been
      written at each skipped path, then write `.steward.json` recording the grant set, then the
      artifacts. **`.steward.json` is written every run and is not classified.** Fixtures:
      (a) greenfield — all targets created and `check` passes afterwards **with no hand-editing of
          `.steward.json`**: the same `generate` writes a **proposed** `intentionallyEmpty` for
          **each scope key whose inferred list came back empty** (ADR-30) — a code-only repo's
          `docsScope`, and a repo with no discoverable commands or sources of truth its `commands`
          and `paths` — so each reports `warn`, not `error`, with no hand-edit. Asserted per key.
          The `error` case — no record for that key — is P4.4's;
      (b) **the routing unit is all-or-nothing, and a recorded mismatch is *not ours* like any
          foreign file** (ADR-15/ADR-20, owner 2026-08-13). **Four brownfield fixtures — the two
          not-ours peer states × the two directions:** *foreign* **AGENTS-only** (hand-written
          `AGENTS.md`, no `CLAUDE.md`) and *foreign* **CLAUDE-only**; then **recorded-mismatch
          AGENTS** (recorded by us, since hand-edited) with an absent `CLAUDE.md`, and the mirror.
          In every one: the existing file is **byte-identical** afterwards, **no peer file is
          created** (asserted by absence on disk, not only by the report), and every uncoupled
          artifact — both indexes, `.gitattributes`, the manifest — **is** still created. The
          severities differ and are asserted per peer, per ADR-15's table: a foreign peer `info`
          *not managed*; a **recorded mismatch `error`**; a suppressed absent peer `info` *not
          managed*; and the suppressed peer's line **names the peer that suppressed it**. Remedy
          asserted too: `rm` the offending file, re-run, both are created;
      (c) **five `SIGKILL` points, and only the first converges unattended.** (i) Between the
          manifest write and the first artifact write, target **absent** → the next `doctor` reports
          the missing path as `warn` and the next `generate` re-creates it, unattended. (ii) After a
          core temp file is created, before its `os.replace` → the leftover is a `.steward-tmp-*` at
          the **repository root**, nothing unrecorded appears under `tools/steward/`, the next run
          does **not** read the core as a foreign collision (P1.10). (iii) Mid-rewrite of an
          **existing stale rendered artifact** and (iv) mid-**core-file upgrade** → the file still
          holds its **complete previous contents**, which are not the digest the manifest already
          recorded: both are an `error` and **nothing overwrites them**. Convergence needs one human
          `rm` — and for (iv) the `rm` is load-bearing, because a recorded core child whose bytes are
          wrong is a **collision**, so until it is removed every `generate` writes nothing at all;
          removing it makes it merely absent, and the next sync re-installs it. (v) **After the
          manifest that drops a removed core file is written, before that file is deleted** — the
          child now exists and nothing records it, which is a **collision**: every later `generate`
          writes nothing anywhere until a human `rm`s it, and the report names it. Asserted, not
          assumed, because the claim that only human edits need intervention was false (ADR-20). No
          journal, no recover command;
      (d) **a manifest record is evidence, not a grant** (ADR-20, owner 2026-08-12): a **foreign,
          schema-valid `.steward.json`** recording a **pre-existing hand-written `AGENTS.md`** — with
          a stale digest, and with none — leaves that file **byte-identical** and reports it *not
          the bytes we wrote* (`error`). **It writes every *uncoupled* artifact normally — the
          indexes, `.gitattributes`, the manifest — and does *not* write `CLAUDE.md`** (owner,
          2026-08-13): a recorded mismatch is *not ours*, and *not ours* suppresses the peer exactly
          like a foreign file, with no exception for the recorded case. Asserted by `CLAUDE.md`
          being **absent on disk** after the run. Same for the ordinary case: an artifact we created
          and a human then edited stays recorded, is an `error`, is **never** re-rendered by any
          invocation, and — if it is a routing peer — suppresses its peer too. No flag changes this
          — `--force`, `--adopt` and every other flag are **rejected by the parser** (P1.3). The
          removed adopt path is what made this a data-loss class, so it is fixtured rather than
          argued;
      (e) **the bootstrap actually bootstraps**: on a repo with no `.steward.json`, a plain
          `generate` creates the manifest and every absent target — the case the two-state ownership
          table forbade outright, a first run having no records;
      (f) **an existing target is never overwritten in any of its forms**: a regular file, a
          directory, and a **symlink** at a target path are each left byte- and link-identical and
          reported *not managed*;
      (g) **no adoption by proxy**: after a `generate`, deleting `.steward.json` and re-running
          leaves the created artifacts **byte-identical** (they exist and nothing records them), and
          a hand-edited `.steward.json` keeps its `confirmed` records across the run (ADR-11).
- [ ] **P6.5a** **Vendoring the core** into `tools/steward/` as an **all-or-nothing bootstrap
      prerequisite, recorded per file** (ADR-20) — never as one opaque directory-shaped artifact.
      The manifest lists every vendored file with its digest, **as kind `copied`**, so C4 never
      re-renders it and the corpus never contains it (a test asserts a `.py` under `tools/steward/`
      appears in neither). **The packaged core declares its own inventory** — an explicit sorted list
      of its relative paths — and the copy reads that list and **never walks the source directory**,
      which would vendor a `__pycache__/`, an editor backup or a test scratch file. **A test asserts
      the inventory equals the packaged directory's contents**, so an unlisted new module fails here
      rather than shipping.
      **`generate` syncs the target to the inventory**, one transition fixture per case: **added and
      absent** → installed and recorded; **added but already present on disk** → a **collision**,
      never an install, because create-only has no exception for the core; **changed** → re-copied;
      **unchanged** → not written; **removed** → deleted and unrecorded; **renamed** → the removal
      plus the addition; **stray unlisted file** → a collision, not something to clean up.
      **The collision case governs the whole run** (owner, 2026-08-12): no record, a foreign child, a
      recorded child whose bytes do not match, or a non-directory at `tools/steward` → the core
      cannot be installed, so **`generate` writes nothing anywhere in the repository**. Fixtures: a
      foreign **directory**; a foreign **child** in an otherwise-ours core (every recorded child
      **byte-identical**, the foreign child untouched); a **symlink** at `tools/steward`; and a
      **greenfield repo with a foreign `tools/steward/`** asserting **zero writes anywhere** —
      `git status --porcelain` byte-identical and no `.steward.json` created. Each asserts **no
      `tools/steward` command string** in the report, while the diagnostic **does** name the occupied
      path — a collision report that cannot say which path collided is not a report.
- [ ] **P6.5b** `.gitattributes` by ordinary create-only ownership (ADR-1, owner 2026-08-11), in
      ADR-20's ordinary three states and no special case: **absent →** `generate` **creates it**
      carrying `tools/steward/** linguist-vendored` (bare, with `/**`); **ours →** re-rendered in
      place; **not ours →** nothing written, and the report prints that exact line verbatim as an
      advisory alongside the detected host-linter exclusion. A collision needs no case here, because
      P6.5a's run wrote nothing at all — fixtured with the foreign-directory case, asserting
      `.gitattributes` **untouched** and **no advisory emitted**.
      Fixtures: `git check-attr linguist-vendored` reports **`set`** in the created case; the `/`
      and bare-dir forms report `unspecified` (so a regression to a silent no-op fails loudly); a
      **pre-existing** `.gitattributes` is left byte-identical, gains no record, and the report
      prints the line to add. **`doctor` makes no containment claim** — asserted by a wording test.
- [ ] **P6.6** Re-running `generate` syncs the core to the packaged inventory and reports the core
      version; there is no separate upgrade command.
- [ ] **P6.7** **THE WRITE-SEAM INVARIANT — inherited from P3.7, and load-bearing because the
      promotion AST audit was deleted rather than narrowed** (owner decision 2026-08-14,
      `DECISION-2026-08-14-audit-shape.md`). `generate` is the **sole persister** (ADR-11), so this is
      the one seam at which "the tool never writes `confirmed`" is **decidable and total**, as against
      a syntactic audit which is neither. Assert over the **bytes `generate` emits**: every
      pre-existing record's `state` is preserved **exactly**, and **no record acquires `confirmed`**
      that did not already carry it. Prove it non-vacuously by planting a promotion at the seam and
      watching it redden — an audit over clean code reports nothing whether it works or not.
- [ ] **P6.8** `generate`'s half of P3.7's behavioural check: a run with **stdin closed** and a run
      with the pty installed as the **controlling terminal** (`setsid` + `TIOCSCTTY`, not merely fd 0
      — that distinction is what made the Phase-3 fixture blind) give **byte-identical** output *and*
      manifest. Both arrangements run in their own session, the pty carries a distinguishing window
      size so the oracle can say *which* terminal was reached, and the master is drained: a child that
      writes to `/dev/tty` and is not drained wedges where `SIGKILL` does not reap it.

**Done when:** greenfield `generate` on a repo with no manifest creates `.steward.json` and every
absent target, and `check` then passes against them **before any `git add`** and with no hand-edit
of the manifest (the empty docs scope is a `warn` from a proposed record, ADR-30); every pre-existing
target — file, directory or symlink — is byte-identical and reported *not managed*; a pre-existing
**or recorded-but-modified** `AGENTS.md` **or** `CLAUDE.md` leaves **both** unwritten, each at its
own severity (ADR-15); a foreign
`tools/steward/` makes `generate` write **nothing anywhere** and print no steward command string;
C4's real-artifact fixtures run **through `check`** here — stale detected, current passes, a
hand-edited `AGENTS.md` and `CLAUDE.md` each an `error` naming the remedy, `git status` unchanged in
all; every artifact survives a **render → render byte-compare** and the **renderer-purity lint**
(clock / random / cwd / absolute path — ADR-8, the assertion the retired Phase 5 used to carry); the
cap boundary fixture reports `warn` and exit 0; a test asserts **no file under `.claude/` or
`.codex/` is written by any code path** — the standing guard that the deferred harness work has not
leaked in; **P6.7's write-seam invariant holds and reddens against a planted promotion**; and
**P6.8's closed-stdin vs controlling-terminal comparison is byte-identical for `generate`'s output
and its manifest**.

## Phase 7 — Doctor

- [ ] **P7.1** `doctor` composes `check`'s C1–C5 findings with its own inspection findings and emits
      one report.
- [ ] **P7.2** **C4 comes from `check`, and `doctor` must not be the only way to get it.** C4 is
      implemented in P4.6 as shared check behavior; here `doctor` composes it unchanged. The
      **stale** and **current** regressions are asserted **through both entry points** — `check` and
      `doctor` — with the same artifact and the same expected severity, so the freshness check can
      never quietly become doctor-only again. `git status` unchanged in all of them.
- [ ] **P7.3** Inspection findings: the hooks-path branch and any hook's presence and mode bit
      (**A3**); the vendored core's version; each recorded-ours path's existence; and **whether
      `.steward.json` is in the index** — untracked or removed is a `warn` (states fixtured in P1.5).
      **Every one labelled *inspected*, with the plain statement that the-steward installed no hook
      and no enforcement of any kind** (ADR-28) — a statement about what *we* did, which inspection
      can support. A test asserts the label text, because the label is the feature.
- [ ] **P7.4** **A3 acceptance fixture**: `core.hooksPath` redirected away from a tracked hooks
      directory → `doctor` reports it, tier *inspected*, with the **bounded** diagnosis *"the tracked
      hooks directory `D` is not the effective hooks path, so nothing in `D` runs in this clone"*.
      The test asserts **neither** "enforcement works" **nor** "there is no enforcement" appears
      (ADR-28) — the second is a claim of absence that inspecting one directory cannot support.
- [ ] **P7.5** Severity-map exhaustiveness test over every state **ADR-2, ADR-11 and ADR-20** can
      produce — all four ADR-2 comparison rows, **all three ADR-20 outcomes (ours / absent / not
      ours)**, the **coupled routing-unit matrix** (ADR-15's five peer states × two peers, generated
      as a cross product: writes happen only when **both** peers are ours/absent, and each peer's
      severity comes from its own row — `info` foreign, **`error` recorded mismatch**, `warn`
      absent-but-recorded), the **no-claim-source outcome** (no manifest → C1/C2 `info`, exit 0 —
      ADR-32), the **`external` command record** (`info`, *inspected*, counted separately — ADR-18),
      and the **core-collision precondition** (`warn`, wrote nothing); a state with no row
      in ADR-13 fails. It also asserts the rows that outrank the general inspection row — **manifest
      trackedness and a missing recorded path stay `warn`, not `info`**. Narrow scoping is what let two states ship with
      no severity in earlier rounds, so the enumeration is generated from the state definitions, not
      hand-listed.
- [ ] **P7.6** `doctor` writes nothing: `HEAD`, the index, `git status --porcelain`, and every file
      in the hooks directory are byte- and mode-identical across a run.

**Done when:** `doctor` reports A1, A2 and A3 in one run with correct tiers; the freshness check
fails on stale output without writing **from both `check` and `doctor`**; the A3 report carries
neither banned sentence; and the no-write fixture passes.

## Phase 8 — retired

**Empty on purpose.** Phase 8 was *Scan-then-confirm*; round 6 moved it to **P3.5–P3.8**, ahead of
the checks and the generator that read record state. The heading is kept so the five rounds of
review history that cite P8.x stay resolvable, and the number is not reused.

## Phase 9 — Acceptance, dogfood, docs

- [ ] **P9.1** All three acceptance fixtures green end to end through `doctor`, with tiers asserted.
- [ ] **P9.2** **Dogfood:** run the-steward against `the-foreman`'s own repository; **its `doctor`
      must pass** (PDR criterion 5). Any finding it raises is either fixed in this repo or is a real
      defect in the-steward — not waived.
- [ ] **P9.3** Cross-runtime proof: `python3 -B tools/steward doctor` on the dogfood repo under
      **3.9.6 and 3.13.5**, on a machine path with **no Claude tooling involved**, producing
      identical findings.
- [ ] **P9.4** Wording audit over the rendered corpus and report strings, asserted not eyeballed: no
      enforcement claim (ADR-4); **neither "enforcement works" nor "there is no enforcement"**
      (ADR-28); no inspection finding presented as proof; no "0 checked, 0 problems" without
      cardinality (ADR-30); no `tools/steward` command string **in any report written before the
      core is installed**, foreign-core collisions included (P6.5a, P1.9);
      **no sentence implying a run is safe against a concurrent writer** (ADR-20 — v0 is
      single-writer and claims nothing about concurrency, so a report that implies otherwise is the
      same class of false claim as an enforcement claim);
      and **every** printed or generated invocation carrying `-B` in either sanctioned form (ADR-1).
- [ ] **P9.5** README / `SKILL.md` / release metadata final pass; the #29 independence test green.

**Done when:** the dogfood doctor is clean, all three acceptance fixtures pass, both interpreters
agree, and the wording audit passes.

---

## Verification at every boundary

- [ ] Both existing test suites green.
- [ ] The new `the-steward` suite green, runnable independently of every sibling skill (#29).
- [ ] `codex-gate phase-start` before the phase; `codex-gate phase-review` driven to APPROVE after.
- [ ] Evidence is command output actually read — a subagent's success summary is a claim, not
      evidence.

## Deferred out of v0 (recorded, not silently dropped)

| Item | Where it goes |
|---|---|
| **All enforcement machinery** — the git pre-commit hook and its shim, the launcher, the interpreter pin, the install transaction and recovery journal, `steward recover`, `steward rollback`, `steward upgrade`, the extended exit-code contract | **Cut, not scheduled.** Five review rounds produced ~82 findings, every one of them in this machinery and none in the product. Re-opening any of it requires an owner decision and a fresh evidence pass |
| **All harness-native hooks** — `.claude/settings.json` hooks, `.codex/` anything, harness probes and version binding | **Not planned.** The shipped Codex binary does not read the repo layer (`verified-contracts.md` §2.1.1) and a Claude tool-scoped hook cannot be proven to fire on a credential-less install (ADR-28) |
| **CI generation** — `steward ci init`, workflow ownership, doctor CI states | **Not planned.** `python3 -B tools/steward doctor` is one line anyone can add to their own workflow; the-steward does not own it and makes no claim about it |
| **Tiers** (minimal / standard / full) | **Not planned.** v0 is one mode; `scan`/`check` already are the no-write entry point |
| **Adopting pre-existing files** | **Not planned.** Create-only (ADR-20) removes a verified data-loss class; a human who wants a file managed moves it aside |
| **Planning-governance framework, semantic/LLM gardening** | **Not planned** for v0 |
| Extracting `the-steward` into its own repo | Issue [#29](https://github.com/Angel45604/the-foreman/issues/29) |
| Gemini / Cursor / Copilot shims | Out of scope; the renderer must not foreclose them |
| Nested-`AGENTS.md` semantics beyond opt-in + warn | ADR-16; re-open if the ecosystem converges |
| Fixing the reference monorepo's own drift | Owner explicitly declined; retained as sanitized fixtures |
