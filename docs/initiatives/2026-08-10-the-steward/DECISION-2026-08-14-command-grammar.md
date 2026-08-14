# DECISION — FROZEN-DEBT item 2: the command grammar and working directory

**Owner decision, 2026-08-14. Taken at Phase 3, one phase earlier than `FROZEN-DEBT.md` predicted.**

## Why this arrived early

`FROZEN-DEBT.md` §"How to treat this debt" assigns item 2 to phases **4, 6, 9**. That phase map is
**wrong for this item**, and the correction is the first thing to record here: **P3.2 is where a
command record is created**, so the grammar must exist before a record can be written down, not merely
before one is resolved.

Two arguments make it unavoidable at Phase 3:

1. **Nothing is ever executed** (ADR-18; execution-plan.md "No documented command is ever executed"),
   so there is no later execution stage to defer the grammar to.
2. **P3.2's own acceptance criterion demands the exact strings** — "each of at least three stack
   fixtures (Node, Python, docs-only) *yields the right commands*". The test assertion **is** the
   grammar decision; it cannot be written without picking one.

A `commandRecord` is a single opaque string plus a `resolution` kind — `value`, `state`, `confidence`,
`waived`, `resolution` — with `additionalProperties: false`. There is **no** `cwd`, `project` or
`prefix` field, and adding one would reopen a shipped Phase-1 schema.

An earlier hypothesis — that the dogfood repo's *zero* package manifests dissolve the problem — is
**refuted** and recorded here so it is not re-derived: that removes only the **cwd** half. The
**grammar** half bites at the repository root too, because `{"scripts": {"test": "jest"}}` must still
become one exact string.

## Grounding

`codex-gate question` returned **`GROUNDED`, `settledByCanon: false`** — this is a real owner decision,
not something canon already settles. Codex's reasoning, in summary: ADR-28 settles *diagnose rather
than silently drop*, but does **not** define which command values are representable, nor does it
establish the repository root as an implicit cwd. ADR-18's non-invention rule settles
`resolution: "repo-declared"` only — not project identity. Because Phase 4 precedes Phase 6's
persistence, this boundary can still be replaced before any final record is generated.

## The decision

### 1. Scope — repository root only; nested projects are diagnosed, never guessed

`scan` proposes a command record **only** for a declaration at the **repository root**. A declaration
found in a **nested** project produces **no record**; it produces an **ADR-28 diagnostic** naming the
file and why it was not proposed, and the cardinality line states it. `scan` still exits 0.

Nothing is silently dropped — ADR-28: "Every unresolvable reference emits a diagnostic. A candidate
silently dropped both hides a real edge and manufactures a false orphan."

**This is an explicit, owner-approved interim boundary — not a claim that canon settled it.** The
grammar/cwd question **must be revisited before P4.2**, whose structural resolution has to be the
exact inverse of P3.2's synthesis. Recorded so a later agent does not mistake the boundary for canon.

### 2. Grammar — the invocation form

A discovered declaration becomes the string a human would actually type, derived mechanically from the
declaration kind:

| Declaration | Proposed `value` |
|---|---|
| package script `test: jest` | `npm run test` |
| Makefile target `test` | `make test` |
| tracked executable | its repository-relative path, **always prefixed `./`** |

### Correction, 2026-08-14 (after implementation) — the `./` prefix

The table originally said "its **bare** repository-relative path". That was **wrong**, and it made the
tool emit the exact false claim it exists to detect. Verified by direct probe against a root-level
tracked executable:

```
report claim:  'build.sh' is a command this repository declares,
               and a human can type it at the repository root
shell:         command not found: build.sh
```

POSIX treats a command word as a path only when it **contains a slash**; without one the word is
searched on `PATH`. So a root-level executable rendered bare is not runnable as written — the very
objection used above to reject the raw declared body (`jest`). The rendered **Verification Commands**
section would print a command a human cannot paste and run, and A1 is precisely "a documented command
that does not resolve."

**Rule: always prefix `./`.** One rule with no branch, rather than "prefix `./` only when the path
contains no slash" — `./plugin/skills/x/y.sh` is valid and unambiguous, so the conditional buys
nothing and adds a case. Consistent with "prefer deleting a rule to qualifying one."

### Correction 2, 2026-08-14 — the grammar table needs a quoting rule, and a refusal

The table gives three invocation forms and says nothing about a name that is **not a plain word**.
That omission let the scanner emit values that were not merely wrong but *dangerous*. Verified by
typing each emitted value into `/bin/sh` at the repository root — **3 of 10 did what the report
claimed**:

```
"npm run a;id"           exit 0    NPM-ARGV: [run] [a]  + uid=NNN(user) gid=NN(group)...
"./scripts/$(id).sh"     exit 127  ran `id`, then tried ./scripts/uid=NNN(user)
"./scripts/it's.sh"      exit 2    syntax error — the value cannot be typed at all
"./scripts/check me.sh"  exit 127  runs ./scripts/check with argument me.sh
"npm run --help"         exit 0    npm parses it as a FLAG, not a script named --help
```

Two of these **executed injected code**. These values are rendered into `AGENTS.md`, where an agent
reads them, so a repository declaring a script named `a;curl …|sh` would get that written into a
record the tool tells a human to type.

**Rule added — quote the word, or refuse the name.**

- Every emitted word is **POSIX-shell-quoted** where quoting makes the claim true. A value needing no
  quoting is emitted untouched, so `npm run test` and `make test` are unchanged from the table above.
- An **option-like** name cannot be rescued by quoting — `shlex.quote("--help")` is `--help`, which
  `npm` still parses as a flag, and a Make target `-j4` means "4 jobs", not a target. Such names are
  **diagnosed and not proposed** (ADR-28: name it, never drop it silently).

**Deliberately not adopted:** the end-of-options escape hatch (`npm run -- --help`, `make -- -j4`).
Those are **unverified vendor contracts**, and ADR-23 forbids shipping against one on an agent's own
authority. If either is ever verified against the pinned tool, these names become proposable — that is
the only thing blocking them.

**The claim is now a tested property, not prose.** The report's sentence "a human can type it at the
repository root" is asserted by a test that runs each emitted value through `/bin/sh -c` with cwd at
the repository root, against `npm`/`make` shims that print their argv, and checks the **received
argv** — not merely a zero exit. Its absence is why this shipped: every prior fixture used well-formed
names.

### Clarification, 2026-08-14 — "repository root only" does not exclude a nested *executable*

§1's **repository root only** rule exists to prevent one thing: a command whose **working directory is
ambiguous** and which the frozen schema cannot express. That ambiguity is a property of *manifest-
declared* commands (a `package.json` script, a `Makefile` target), which name a script relative to
their own project directory.

A **tracked executable is self-locating** — its repository-relative path fully specifies both what to
run and where it lives, so there is no cwd to express and nothing to invent. It is therefore proposed
**at any depth**, while a nested `package.json` / `Makefile` declaration is diagnosed and never
proposed.

Recorded because a literal reading of "repository root only" would have excluded it, and because this
is what the scanner already implements and what this repository's own scan depends on: its only
repo-declared commands are two tracked executables under `plugin/skills/`.

Chosen over the raw declared body (`jest`), which is frequently not runnable as written because it
relies on `node_modules/.bin` being on `PATH` — the rendered **Verification Commands** section would
then print commands a human cannot paste and run, defeating the section's purpose.

**Known ambiguity to settle in implementation:** `npm test` and `npm run test` both work for the
`test` lifecycle name, while only `npm run <x>` works for any other script name. Prefer the uniform
`npm run <script>` form so one rule covers every script; if that is departed from, a test must pin why.

### 3. Invariants unchanged by this decision

- Every proposed command record is `resolution: "repo-declared"`. **`scan` may never emit `external`**
  — the schema already enforces it (`external` is valid only on a `confirmed` record).
- Every inference is tier `inferred`, carries its evidence and a `confidence` of `high` or `low`, and
  is severity `info` — never `error` (ADR-28).
- `scan` persists nothing (ADR-11). `generate` is the sole persister.
- Every proposed value is routed through `text.ascii_strip` and `text.first_control_character`; a path
  or command whose name carries an ASCII control character is **never proposed**, a diagnostic names
  it, and `scan` still exits 0 (ADR-32).

## Still open — raised with the owner, not decided here

1. **`scan.pending[]`'s element shape is undefined everywhere.** `manifest.v1.json` declares a bare
   array with no `items`; `manifest._validate_scan` asserts only that it is a list. `generate`
   (Phase 6) is the only thing that writes it, so the shape is a **Phase 6** decision. Phase 3 asserts
   only what is true today: a re-scan reopens zero confirmed records and nothing writes pending.
   Not on the original 10-item debt list.
2. **A waiver `reason` has no representability rule.** ADR-32 forbids ASCII control characters in a
   record *value*, but `manifest._validate_waiver` applies no such rule to a waiver *reason*, so a
   schema-valid manifest can carry `"reason": "a\nb"` and split a one-item-per-line report. Phase 3
   closed this **in the renderer** (`%r` on the reason) rather than by widening the validator, because
   widening it would make an already-valid manifest exit 2 over a cosmetic issue — a decision, not an
   implementation detail. Also not on the original debt list.
