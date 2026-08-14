"""P3.1-P3.4 — the read-only scanner: what this repository declares about itself.

`scan` reads repository state, draws conclusions the state does not itself
assert, and **writes nothing** (ADR-11: `generate` is the sole persister; ADR-20
gives it the only write path there is). Every conclusion here is therefore tier
*inferred*, carries a `confidence`, and is severity `info` — never `error`
(ADR-28, enforced by `findings.finding`), so this module cannot make the tool
exit 1 on the strength of a guess.

**The command grammar here is an owner-approved interim boundary, not canon.**
`DECISION-2026-08-14-command-grammar.md` settles FROZEN-DEBT item 2 — which the
debt document routed to phases 4, 6 and 9, one phase too late, because P3.2 is
where a command record is first *created* and a record cannot be written down
before its grammar exists. Two rules, both interim:

1. **Repository root only, for a declaration whose invocation depends on the
   working directory.** `npm run test` names whichever project the shell is
   standing in, and a `commandRecord` has no `cwd`, `project` or `prefix`
   field to disambiguate with (`manifest._COMMAND_RECORD_KEYS`, and adding one
   would reopen a shipped Phase-1 schema). So a nested `package.json`'s
   scripts produce **no record** — they produce a diagnostic naming the file
   and why (ADR-28), and the cardinality line states it. A tracked executable
   is not in that class: it is **self-locating**, so its path names one file
   from the root and nothing else, and it is proposed at any depth.

   **This bounds command records and nothing else, and reading it wider was
   defect B1.** It was applied to *stack detection* too, so a repository whose
   only manifest was `packages/web/package.json` reported no stack at all. P3.1
   asks what the repository contains and answers per project, naming the
   directory — see `stacks_and_projects`.
2. **The invocation form, not the declared body.** `{"scripts": {"test":
   "jest"}}` becomes `npm run test`, never `jest`, which is frequently not
   runnable as written because it leans on `node_modules/.bin` being on `PATH`.
   The uniform `npm run <script>` is used for every script name including
   `test`, so one rule covers all of them. A tracked executable carries a
   leading `./` for the same reason and by the same argument — see
   `EXECUTABLE_PREFIX`, which is where the decision's 2026-08-14 correction
   lives.

**This boundary must be revisited before P4.2**, whose structural resolution
has to be the exact inverse of the synthesis here.

**What this module refuses to do, and the defect each refusal prevents.**

* **It never executes anything, and never consults `PATH`** (ADR-18). Whether a
  tool is installed on the machine running the scan is not a fact about the
  repository, and making it one would give the same repository different
  findings on different machines.
* **It never proposes `resolution: "external"`.** A scanner cannot tell a
  legitimate external tool from a command that does not exist — that is
  acceptance case A1 itself — so `external` is a human's declaration on a
  `confirmed` record and the schema refuses it anywhere else
  (`manifest._validate_claim_record`).
* **It never proposes a value a record could not hold or a report render**
  (ADR-32). git permits a newline in a filename, and it permits a filename
  whose bytes are not valid UTF-8 at all; the index can therefore hold a path
  no record can represent, and proposing one would make the next `generate`
  fail at exit 2 over a value this module invented. Both are dropped from the
  record set, a diagnostic names each, and the scan still exits 0. See
  `_representability_fault`, which is the one place the rule is stated.
* **It never emits a value a shell would read as more than one word, and never
  one a tool would read as an option.** See `_shell_word` and
  `OPTION_LIKE_NAME`: a command finding claims a human can type the value at
  the repository root, and the only way to keep that sentence true is to make
  it true or not make it. **Quoting is what makes it true where it can be**
  (the decision's "quote the word, or refuse the name"), so a name carrying a
  space is proposed quoted and only the option-like one is refused —
  `_name_fault` carries the reason the older, wider refusal was defect B5.
* **It never proposes a `make` target at all** — the owner's scope amendment
  of 2026-08-14, and the largest single thing this module does not do. GNU
  make is a **macro language with conditionals and file inclusion**, so which
  targets exist depends on `$(…)` expansion, on `ifeq`/`ifdef` evaluation and
  on `include`d files. A reader that does not expand, evaluate or follow
  includes **cannot know** them, and three gate rounds proved it three times
  over with three fresh crops of fabricated commands out of one parser:
  assignments (`REGISTRY = https://x/y` → `make https`), directive arguments
  (`include config:prod.mk` → `make config`), then Make escaping, the bodies
  of *inactive* `ifeq` branches and `$(info hello: world)`. Each error is a
  documented command that does not resolve — acceptance case A1, manufactured
  here rather than detected — and ADR-32 names where that ends: a checker that
  cries wolf gets ignored, "this tool's defining failure by another road". A
  tracked makefile still establishes the **make** stack (P3.1, cheap and
  unaffected) and is **diagnosed** (`UNREAD_MAKEFILE`), which is exactly the
  treatment `Taskfile.yml`, `justfile` and `Rakefile` already get — and those
  paths produced zero defects across the same three rounds. The cost is
  stated rather than hidden: a Makefile-driven repository gets no proposed
  build or test command, and a human writes one into `.steward.json` and
  confirms it, which is what confirmation is for.
* **It never renders a repository path into a report verbatim.** git permits a
  newline, an ESC and bytes that are not UTF-8 in a filename, and a report is
  read by a human in a terminal — see `_shown`, which is the one place a
  path, a name or a value becomes text (defect B4).
* **It never reads a declaration through a symlink**, whether git records the
  link or the working tree holds one where git records a regular file. A
  declaration file's path arrives from git's index, which is untrusted input,
  and an in-tree symlink passes containment — so
  `package.json -> elsewhere/package.json` would let the scanner propose
  commands it read out of a file the repository does not declare. **Two checks,
  because either alone is a hole**: git's index mode (`120000`) catches a
  committed link without a filesystem probe, and `paths.crosses_symlink`
  catches the working tree replacing a committed regular file — which keeps
  index mode `100644` and shows up only as `git status`'s ` T`.
* **A tracked basename is not a declaration**, and the index mode is asked
  **once** for all of it — see `declaration_entries`. Asking it per consumer
  is how the stack pass and the command pass came to disagree: the command
  pass refused a symlinked or gitlinked `package.json` while the stack pass,
  matching the basename alone, reported a `high`-confidence node project over
  it (defect D1). One question, one answer, both consumers.
* **It never answers over an ambiguous index entry.** A path in an unmerged
  index appears once per stage, and taking the last one read would answer
  *this is a command* out of whichever stage git happened to print last. The
  stages need not disagree for the entry to be unmerged: three stages that all
  say `100644` are an ordinary content conflict, and reading the working-tree
  file then proposes commands out of both sides of a merge, conflict markers
  and all. **Only a single stage-0 entry is merged** — see `_merged_mode`.
"""

import errno
import os
import shlex

import corpus
import findings
import jsonio
import paths
import text

# ADR-1: the core is stdlib-only at the 3.9 floor, where there is no `tomllib`
# and no `yaml`. **JSON is the one declaration format this core reads**, and
# `package.json` is the one file it reads it out of. Everything else a
# repository may declare commands in is detected and **diagnosed**, never
# guessed at — see `UNPARSEABLE_DECLARATIONS` and `MAKEFILES`.
PACKAGE_MANIFEST = "package.json"

# The invocation form for a package script, and the uniform `npm run <script>`
# is deliberate: `npm test` also works for the `test` lifecycle name and for no
# other, so one rule covers every script rather than one rule plus a list of
# exceptions (DECISION-2026-08-14 §2, "Known ambiguity to settle in
# implementation").
SCRIPT_INVOCATION = "npm run %s"

# Every name GNU make loads as a default makefile. **v0 proposes no target out
# of any of them** (DECISION-2026-08-14 §"SCOPE AMENDMENT"), so this is not a
# precedence order and must not become one again: the order mattered only while
# targets were parsed, and the parser is gone. What the list is for now is the
# diagnostic — each tracked name is reported, so nothing is dropped silently
# (ADR-28) — and every name here also appears in `DECLARATIONS`, because a
# makefile still establishes the make stack.
MAKEFILES = ("GNUmakefile", "Makefile", "makefile")

# Declaration file -> the stack it establishes. A fixed table, matched on the
# basename: nothing here is a heuristic over file contents, and a stack is
# reported because a file the ecosystem defines is tracked, not because the
# repository "looks like" one.
DECLARATIONS = {
    "Cargo.toml": "rust",
    "GNUmakefile": "make",
    "Makefile": "make",
    "go.mod": "go",
    "makefile": "make",
    "package.json": "node",
    "pyproject.toml": "python",
    "requirements.txt": "python",
    "setup.cfg": "python",
    "setup.py": "python",
}

# Declarations that can carry commands but that the core cannot read without a
# parser it is forbidden to vendor (ADR-1). Detected, reported with its bound,
# and never guessed at: a hand-rolled YAML or TOML reader would be a dependency
# in all but name and a source of exactly the false claims this tool exists to
# detect.
UNPARSEABLE_DECLARATIONS = {
    "Justfile": "just",
    "Rakefile": "rake",
    "Taskfile.yaml": "task",
    "Taskfile.yml": "task",
    "justfile": "just",
    "pyproject.toml": "python packaging",
}

# Agent-doc names, at any depth. ADR-16: the-steward reports that these exist
# and never encodes which one wins — there is no standard, the implementers
# disagree, and a wrong reading baked in here would be a claim v0 does not make.
AGENT_DOCUMENTS = ("AGENTS.md", "CLAUDE.md")

# A short, fixed list of harness directory names. ADR-23: **existence only.**
# Asserting what a harness reads out of one would be product code written
# against an unverified vendor contract, which escalates to the owner rather
# than shipping.
HARNESS_DIRECTORIES = (".claude", ".codex", ".cursor")

# The directory names a conventional documentation layout uses. Their only job
# is to separate a `high`-confidence docs scope from a `low` one: documents at
# the root or under one of these are where documentation conventionally lives,
# and anywhere else the-steward is inferring that a directory holds
# documentation from nothing but the fact that a `*.md` file is in it.
DOCUMENT_DIRECTORIES = ("doc", "docs", "documentation")

# git's index modes. A regular file is `100644`, an executable `100755`, a
# symlink `120000` and a gitlink (submodule) `160000`. The executable bit comes
# from here and never from `os.access` or a filesystem stat: what the index
# records is a fact about the repository, and what the checkout happens to have
# on this machine is not (ADR-18).
MODE_FILE = "100644"
MODE_EXECUTABLE = "100755"
MODE_SYMLINK = "120000"
READABLE_MODES = (MODE_FILE, MODE_EXECUTABLE)

# git's merged stage. `ls-files --stage` prints `0` for an ordinary entry and
# `1`/`2`/`3` for the base, ours and theirs of an unmerged one. The stage — not
# the mode — is what says whether the index holds one answer for a path.
STAGE_MERGED = "0"

# The invocation form for a tracked executable (DECISION-2026-08-14, corrected
# the same day after the first implementation shipped the bare path).
#
# **POSIX treats a command word as a path only when it contains a slash**;
# without one the word is searched on `PATH`. So a root-level `build.sh`
# proposed bare is not runnable as written — `command not found` — while the
# finding claims "a human can type it at the repository root". That is a
# documented command that does not resolve, which is acceptance case A1: the
# failure this tool exists to detect, manufactured by us. It is the same
# objection that rules out the declared body `jest`.
#
# **Unconditional, with no branch.** `./plugin/skills/x/y.sh` is valid and
# unambiguous, so "prefix only when the path contains no slash" would buy
# nothing and add a case to every reader of this rule — and this project
# prefers deleting a rule to qualifying one.
EXECUTABLE_PREFIX = "./"

# What a name beginning with this reaches a tool as. `npm run --help` prints
# npm's help: the tool does not receive the name as the thing it names, and
# `shlex.quote("--help")` is `--help`, so quoting cannot rescue it either.
OPTION_PREFIX = "-"

# What the report calls the repository root when it has to name a directory.
# The root's repository-relative directory is the **empty string**, and `''`
# in a report names nothing a reader can go and look at. A constant of this
# module rather than repository input, so it is the one location string that
# does not go through `_shown`.
ROOT_PROJECT = "."


def _shown(value):
    """One repository-derived string, as one printable item on one line.

    **Defect B4, and it is ADR-32's argument applied where the report is
    written rather than where a record is validated.** git permits a newline
    in a filename and stores path *bytes*, so `git ls-files` is untrusted
    input: a path holding a newline printed verbatim into a finding's `where`
    ends one line of the report and starts another that looks like a finding
    of its own; a path holding **ESC** injects a terminal control sequence
    into the terminal of the human reading it; and a path whose bytes are not
    valid UTF-8 arrives carrying lone surrogates, which **cannot be written to
    a UTF-8 stream at all** — so naming one raises `UnicodeEncodeError` and
    the human gets a crash where a finding should be.

    `repr` is the whole implementation, and deliberately: it escapes by
    `str.isprintable`, so it covers the three cases above and every other
    unprintable code point without this module keeping a list of them — the
    hand-written-predicate trap `_shell_word` already paid for once. It is
    applied **unconditionally**, so the rule has no branch to get wrong and a
    reader of the report can always tell where a value starts and ends; a
    quoted `'package.json'` is the whole price.

    Every repository-derived string this module renders goes through it —
    paths, script names, proposed command values and the **docs-scope
    directories** — because a rule with one exception is a rule nobody can
    audit, and that sentence had to be earned twice. The docs-scope claim was
    the one exception (defect D2), and the character that reached the terminal
    through it was one no other guard could have caught: U+202E RIGHT-TO-LEFT
    OVERRIDE is valid UTF-8 and holds no ASCII control character, so
    `_representability_fault` passes it and `repr` — which escapes by
    `str.isprintable`, and a Unicode *format* character is not printable — is
    the only thing in this module that ever would have.
    """
    return repr(value)


def _shell_word(value):
    """`value` as one word a POSIX shell reads exactly as written.

    **The defect this prevents is B1, and two of its cases executed code.**
    Every command finding claims "a human can type it at the repository root".
    Typed verbatim into `/bin/sh` at the root of a fixture holding them, three
    of ten emitted values did that; `./scripts/$(id).sh` ran `id` through
    command substitution and then failed, `npm run a;id` ran `id` through the
    statement separator and exited **0**, and a space, a single quote and a
    backslash each turned one value into a different command or a syntax
    error. The only filter in the way was `_representability_fault`, which
    rejects non-str / empty / unstripped / ASCII-control, so `;`, `$`, `'`,
    `\\` and a space all flowed into a value the report said a human could
    type.

    Single quotes, because a POSIX shell reads **every** character inside them
    literally — there is no character to enumerate and no escape to get wrong.
    The one character that cannot appear inside them is the single quote
    itself, so it is closed, escaped and reopened (`'\\''`), which is the case a
    naive wrapper gets wrong and the one that made `/bin/sh` exit 2 with
    *unexpected end of file*.

    **A safe value is returned untouched**, so `npm run test` is what the
    decision's grammar table says rather than `npm run 'test'` — a gratuitous
    divergence every rendered artifact would then carry.

    **Quoting is not the whole rule.** It does nothing for a name a tool reads
    as an option: quoting `--help` yields `--help`. That case is refused
    outright — see `OPTION_LIKE_NAME`.

    `shlex.quote` is the whole implementation. An earlier pass spelled its
    predicate out by hand, on the stated grounds that `shlex` is Unicode-aware
    and so "leaves `café` bare where this quotes it". **That is false, and it
    was the only argument for the copy:** `shlex._find_unsafe` is
    `re.compile(r"[^\\w@%+=:,./-]", re.ASCII).search`, so its `\\w` is already
    ASCII-only and `shlex.quote("café")` returns `'café'`, quoted. The two
    agreed on every input, including the empty string and the embedded single
    quote — so the copy was hand-written shell quoting, a classic source of
    subtle bugs, carrying no behaviour the stdlib did not already have.
    """
    return shlex.quote(value)

# `errno` values that mean *there is genuinely nothing there*, as opposed to
# *the look failed*. Anything else is reported as a look that failed, because
# `except OSError: return None` manufactures a negative fact and is instance
# after instance of this project's one defect.
GENUINE_ABSENCE = (errno.ENOENT, errno.ENOTDIR)

HIGH = "high"
LOW = "low"

PROPOSED = "proposed"

# ADR-18: the only `resolution` a scanner may ever write.
REPO_DECLARED = "repo-declared"

STACK_FINDING = "stack-inferred"
COMMAND_FINDING = "command-inferred"
PATH_FINDING = "path-inferred"
DOCS_SCOPE_FINDING = "docs-scope-inferred"
HARNESS_FINDING = "harness-directory"

# Diagnostic ids. Every one of these exists because something was seen and
# **not** proposed, and ADR-28 forbids dropping a candidate silently: a silent
# drop hides a real edge and manufactures a false orphan.
NESTED_DECLARATION = "nested-declaration-not-proposed"
UNPARSEABLE_DECLARATION = "declaration-format-not-readable"
UNREADABLE_DECLARATION = "declaration-not-read"
SYMLINKED_DECLARATION = "declaration-is-a-symlink"
UNMERGED_ENTRY = "index-entry-is-unmerged"
UNREPRESENTABLE = "value-not-representable"
OPTION_LIKE_NAME = "name-reads-as-an-option"
MALFORMED_SCRIPT = "declaration-entry-is-not-a-command"
UNREAD_MAKEFILE = "makefile-targets-not-proposed"

STACK_CHECK = "stacks"
COMMAND_CHECK = "commands"
PATH_CHECK = "paths"
DOCS_SCOPE_CHECK = "docsScope"
HARNESS_CHECK = "harness"

CHECKS = (STACK_CHECK, COMMAND_CHECK, PATH_CHECK, DOCS_SCOPE_CHECK, HARNESS_CHECK)

NOT_A_REPOSITORY = "this directory is not inside a git repository"

NO_STACK = "no declaration file this core can recognise is tracked anywhere"
NO_COMMAND = "no declaration this core can read proposes one"
NO_PATH = "no agent document or root README is tracked"
NO_DOCUMENT = "no tracked document satisfies ADR-10's predicate"
NO_HARNESS = "no harness directory from the fixed list is tracked"


class ScanError(Exception):
    """Input the scanner will not read.

    Deliberately **not** in `cli.REPORTED_FAULTS`, exactly as
    `records.RecordError` is not: a reported fault is one we predicted and can
    describe in a line, and git emitting an `ls-files --stage` record with no
    tab in it is not predicted. It is still exit 2 (ADR-13) — with a traceback,
    which is what an unpredicted fault should look like.
    """


class Note(object):
    """A diagnostic: something seen and deliberately **not** proposed.

    ADR-28: "Every unresolvable reference emits a diagnostic. A candidate
    silently dropped both hides a real edge and manufactures a false orphan."
    A note is always severity `info`, tier *inspected* — we are reporting what
    we saw and the bound on it, never a conclusion — which is why it carries no
    confidence: `confidence` is forbidden on every tier but *inferred*.
    """

    def __init__(self, id, claim, observed, where):
        self.id = id
        self.claim = claim
        self.observed = observed
        self.where = where


class Survey(object):
    """What one scan found. **Nothing here is ever written** (ADR-11).

    `commands` and `paths` hold ADR-11 records in the shape
    `manifest.validate` accepts, but they are *candidates handed to a later
    `generate`* and not a manifest: this module has no write path at all, and
    `scan` does not so much as create a `.steward.json` on a repository that
    has none.
    """

    def __init__(self, unavailable=None):
        # A reason the survey could not be taken, or None. Not an empty result:
        # ADR-30's whole point is that "0 examined" must state why, and *this
        # directory is not a repository* is a different reason from *this
        # repository declares nothing*.
        self.unavailable = unavailable
        self.stacks = ()
        self.nested = ()
        self.commands = ()
        # {command value: the evidence that produced it}. Alongside the record
        # rather than inside it, because a `commandRecord`'s key set is closed.
        self.command_evidence = {}
        self.paths = ()
        self.docs_scope = None
        self.documents = ()
        self.harness = ()
        self.notes = ()


def _decode(raw):
    return raw.decode("utf-8", "surrogateescape")


def index_entries(root):
    """`{path: frozenset((mode, stage))}` for every entry in git's index.

    One `git ls-files -z --stage`, with **no pathspec at all**: the scanner
    needs the whole index — declaration files, tracked executables and the
    harness directories — and a pathspec per candidate would be a probe per
    candidate. `--stage` is what carries the mode, and the mode is the only
    honest source for *is this tracked file executable*: `os.access` answers
    about this checkout on this machine, and git's index answers about the
    repository (ADR-18).

    **The stage is kept, and keeping only the mode was defect B3.** An unmerged
    index lists a path once per stage. A set of *modes* collapses three stages
    that all record `100644` — an ordinary content conflict, no `chmod`
    involved — into one apparent mode, and the path then reads as merged. The
    scanner went on to read the **conflicted** working-tree file and propose a
    command out of each side of the merge, conflict markers and all; an
    executable conflicted the same way was proposed outright. Only the stage
    distinguishes *the index says one thing* from *the index says three things
    that happen to agree*, so the stage is what is recorded.
    """
    out = paths.git_checked(root, ["ls-files", "-z", "--stage"])
    entries = {}
    for record in _decode(out).split("\0"):
        if not record:
            continue
        head, tab, relpath = record.partition("\t")
        if not tab:
            raise ScanError(
                "the-steward: `git ls-files --stage` emitted a record with no "
                "tab separator: %r. Refusing to read a path out of a record we "
                "could not parse." % (record,)
            )
        fields = head.split(" ")
        if len(fields) != 3:
            raise ScanError(
                "the-steward: `git ls-files --stage` emitted %r, whose head is "
                "not `<mode> <object> <stage>`. Refusing to read a mode or a "
                "stage out of a record we could not parse." % (record,)
            )
        entries.setdefault(relpath, set()).add((fields[0], fields[2]))
    return dict((relpath, frozenset(stages)) for relpath, stages in entries.items())


def _merged_mode(stages):
    """The mode of the one **stage-0** entry, or None where the index says more.

    None is *the index does not say one thing*, never *not executable* and
    never *not a regular file*: the caller diagnoses it rather than proposing
    over it. The predicate is the stage and not the modes — see `index_entries`
    for the conflict that agrees about the mode and is unmerged anyway.
    """
    resolved = [mode for mode, stage in stages if stage == STAGE_MERGED]
    if len(stages) == 1 and len(resolved) == 1:
        return resolved[0]
    return None


def _describe_stages(stages):
    """What the index actually recorded, for a diagnostic to name.

    A mode alone cannot explain why an entry was refused — `100644, 100644,
    100644` reads like one answer written down three times — so the stage is
    printed with it.
    """
    return ", ".join(
        sorted("mode %s at stage %s" % (mode, stage) for mode, stage in stages)
    )


def _unmerged_note(relpath, stages):
    """The one diagnostic for one unmerged entry.

    **Emitted once, from the single pass in `survey` that sees every entry**,
    and not from each consumer that refuses the path. Two consumers ask two
    questions of the same entry — *is this a tracked executable* and *what does
    this repository declare here* — and letting each emit its own note made a
    conflicted root `package.json` produce the same diagnostic twice, which
    inflates the finding count over one fact. So the message names the fact
    rather than either question, and neither consumer's honesty depends on the
    other running.
    """
    return Note(
        id=UNMERGED_ENTRY,
        claim="git's index records one merged entry for a tracked path",
        observed=(
            "it is unmerged and records %s, so the index does not say one "
            "thing about it — neither whether it is a tracked executable nor "
            "which bytes this repository declares at that path. Reading the "
            "working-tree file would answer out of a file holding both sides "
            "of a merge, and reading the last entry would answer out of "
            "whichever stage git printed last. Nothing was proposed from it."
            % _describe_stages(stages)
        ),
        where=_shown(relpath),
    )


def _directory_of(relpath):
    """The repository-relative directory holding `relpath`, or "" for the root."""
    head, _sep, _tail = relpath.rpartition("/")
    return head


def _basename(relpath):
    _head, _sep, tail = relpath.rpartition("/")
    return tail


def declaration_entries(entries, notes):
    """`{path: mode}` for every tracked declaration git records **once, as a
    regular file** — the one input both P3.1 and the command pass take.

    **Defect D1, and its shape is an asymmetry rather than an oversight.**
    `stacks_and_projects` matched a *basename* against `DECLARATIONS` and
    asked the index nothing else, so a tracked **symlink** named
    `package.json`, and a **gitlink** (a submodule) named `package.json`, each
    produced a `high`-confidence *this repository declares a node project* —
    over an entry holding no package declaration this core can read, and in
    the gitlink's case holding no file at all. The command pass had consulted
    the mode since B4 and refused both correctly the whole time. One
    consumer's guard was never the other's, and the one without it is the
    finding a human reads first; a `high` confidence over something nobody
    read is what ADR-28's tier rule exists to forbid.

    So the mode is asked **once**, here, and what comes back is what *is* a
    declaration. Diagnosing here rather than in each consumer is the shape
    `_unmerged_note` already established — one fact, one finding: an unmerged
    entry is skipped **silently**, because `survey`'s pass over every entry
    has already named it, and everything else is named exactly once.

    **`paths.crosses_symlink` deliberately does not belong here.** It answers
    *may these bytes be read*, and where it fires the index still records a
    regular file — the repository really does declare a manifest at that path,
    so the stack is real and only the read is refused (`_package_commands`).
    Moving it here would delete a true stack finding over a working-tree
    accident.
    """
    kept = {}
    for relpath in sorted(entries):
        if _basename(relpath) not in DECLARATIONS:
            continue
        mode = _merged_mode(entries[relpath])
        if mode is None:
            continue
        if mode in READABLE_MODES:
            kept[relpath] = mode
            continue
        if mode == MODE_SYMLINK:
            notes.append(
                Note(
                    id=SYMLINKED_DECLARATION,
                    claim=(
                        "a declaration is the regular file git records at the "
                        "path it records it at"
                    ),
                    observed=(
                        "git records a symlink there, and an in-tree link "
                        "passes the containment predicate — so following it "
                        "would answer out of a file this repository does not "
                        "declare at that path. It was not followed: no stack "
                        "was inferred from it and no command was proposed "
                        "from it."
                    ),
                    where=_shown(relpath),
                )
            )
            continue
        notes.append(
            Note(
                id=UNREADABLE_DECLARATION,
                claim=(
                    "a declaration is the regular file git records at the "
                    "path it records it at"
                ),
                observed=(
                    "git records it with mode %s, which is not a regular file "
                    "this core reads — a tracked basename is not a "
                    "declaration. No stack was inferred from it and no command "
                    "was proposed from it." % _shown(mode)
                ),
                where=_shown(relpath),
            )
        )
    return kept


def stacks_and_projects(declarations):
    """`(stacks, nested)` from the index alone.

    `stacks` is one entry per **(project directory, stack)** pair —
    `(directory, stack, declarations)`, sorted, with `directory` the empty
    string at the repository root. `nested` is `(stack, declaration)` for
    every declaration outside the root **that the command pass would otherwise
    have read**, which is the boundary's input and nothing else.

    **`nested` is `package.json` only, and that is not an oversight.** The
    boundary it feeds says one thing — *this declaration names commands, but
    which project's is ambiguous from the root* — and that is now true of
    exactly one declaration kind. A makefile is refused for a different reason
    entirely (v0 reads no makefile at any depth), and listing it here would
    emit a diagnostic naming the working directory as the cause, telling the
    human that moving the file to the root would make its targets appear. It
    would not. Its own diagnostic is `UNREAD_MAKEFILE`, raised in `survey`.

    **Defect B1 was these two being one list.** `Survey.stacks` held root
    declarations only, so a repository whose sole manifest is
    `packages/web/package.json` emitted no `stack-inferred` finding at all —
    a scan reporting nothing about a repository that plainly declares
    something. The cause was a conflation: DECISION-2026-08-14 §1 bounds
    **command records**, whose value (`npm run test`) names whichever project
    the shell stands in and which the frozen schema cannot qualify with a
    directory. P3.1 asks a different question — *what does this repository
    contain* — and a stack finding names its project directory, so the
    ambiguity that boundary exists for cannot arise. The boundary itself is
    untouched and lives where it belongs, in `survey`'s command pass.

    **Keying by the pair is also what stops one project being three.** The old
    `(stack, declaration)` list reported the python stack once per
    declaration, so `pyproject.toml` + `setup.py` + `requirements.txt` made
    three findings and an ADR-30 cardinality of 3 for one project. The
    declarations are the *evidence* for a pair, not pairs of their own.

    P3.1's rule is a prohibition: *never emit one ecosystem's assumptions into
    another's repo*. It holds structurally, because everything downstream is
    driven by the declaration file actually tracked here — there is no default
    stack and no fallback.

    The input is `declaration_entries`' mapping and **not** the raw index,
    because a basename alone is not a declaration: see defect D1, which is the
    whole reason that function exists.
    """
    projects, nested = {}, []
    for relpath in sorted(declarations):
        basename = _basename(relpath)
        stack = DECLARATIONS[basename]
        directory = _directory_of(relpath)
        projects.setdefault((directory, stack), []).append(relpath)
        if directory and basename == PACKAGE_MANIFEST:
            nested.append((stack, relpath))
    stacks = tuple(
        (directory, stack, tuple(sorted(projects[(directory, stack)])))
        for directory, stack in sorted(projects)
    )
    return stacks, tuple(sorted(nested))


# ------------------------------------------------------------------
# Reading a declaration file. Two failure modes are kept apart on purpose: a
# file git tracks but the working tree does not hold is *genuinely absent*,
# and a file we could not open is *a look that failed*. Collapsing them into
# one answer is the shape `except OSError: return None` has, and it is the
# defect this project keeps re-contracting.


def _read_bytes(root, relpath):
    """`(payload, None)` or `(None, reason)`. Never a manufactured negative."""
    location = paths.contain(root, relpath.replace("/", os.sep))
    try:
        with open(location, "rb") as handle:
            return handle.read(), None
    except OSError as exc:
        if exc.errno in GENUINE_ABSENCE:
            return None, (
                "git tracks it, but there is nothing at that path in the "
                "working tree"
            )
        return None, (
            "it could not be opened (%s), so nothing was read out of it"
            % errno.errorcode.get(exc.errno, exc.errno)
        )


def _utf8_encodable(value):
    """Can this str be written as UTF-8 at all?

    **Defect B8.** git stores path *bytes* and `_decode` reads them with
    `surrogateescape`, so a filename whose bytes are not valid UTF-8 arrives
    here as a str carrying lone surrogate code points. Canonical JSON is
    written with `ensure_ascii=False` and encoded as UTF-8
    (`jsonio.dumps_bytes`), and that encode raises `UnicodeEncodeError` — so a
    value this module proposed would fail the next `generate` at exit 2.
    `manifest.validate` does **not** catch it: its rule is about ASCII control
    characters, and a surrogate is not one.
    """
    try:
        value.encode("utf-8")
    except UnicodeEncodeError:
        return False
    return True


def _representability_fault(value):
    """Why `value` could not be a record value, or None — the one statement of
    the rule (ADR-32).

    The conditions `manifest._validate_record_value` enforces, applied
    **before** the record exists rather than after — a proposal that cannot be
    persisted is not a proposal — plus the one it does not enforce and cannot
    (`_utf8_encodable`). The reason is *returned* rather than turned into a
    boolean, because every rejection here owes a diagnostic naming what was
    wrong (ADR-28), and a diagnostic that says only "not representable" tells
    the human nothing they can act on.
    """
    if not isinstance(value, str):
        return "it is %s and not a string" % type(value).__name__
    if value == "":
        return "it is empty"
    if text.ascii_strip(value) != value:
        return "it carries leading or trailing ASCII whitespace"
    control = text.first_control_character(value)
    if control is not None:
        return (
            "it carries the ASCII control character U+%04X at index %d, and a "
            "value holding a line break would silently become two claims in a "
            "one-item-per-line section" % control
        )
    if not _utf8_encodable(value):
        return (
            "git recorded a name whose bytes are not valid UTF-8, and the "
            "canonical JSON a record is written in cannot hold it — proposing "
            "it would fail the next `generate` at exit 2"
        )
    return None


def _name_fault(name, value):
    """Why `name` cannot become the command `value`, or None.

    **The subject of this predicate is defect B5.** The old one validated the
    **raw name** and refused every one carrying ASCII whitespace — a rule that
    predates POSIX quoting and that
    `DECISION-2026-08-14-command-grammar.md` §"Correction 2" then
    contradicted: it adds `shlex` quoting and states the rule as *quote the
    word, or refuse the name*, quoting **where quoting makes the claim true**.
    `build all` is exactly that case — `npm run 'build all'` is one word to a
    shell and reaches npm as the name the repository declares — so refusing it
    dropped a command this repository really has, and the refusal outlived its
    reason. A previous pass kept it on the grounds that widening what a
    scanner proposes was unasked for; the owner's decision asks for it.

    The raw name is not what a human types and not what the record holds, so
    the **final quoted value** is what is validated (ADR-32's rule, applied to
    the thing the rule is about). What survives is what quoting cannot fix:

    * an **empty** name, because `npm run ''` is typable and names no script;
    * an **ASCII control character** or a non-UTF-8 byte sequence, which no
      record value may hold — see `_representability_fault`;
    * an **option-like** name, which `_package_commands` refuses on its own
      and `OPTION_LIKE_NAME` explains.

    A leading or trailing space is the case the two predicates disagree about
    most sharply: the raw name ` build` "carries leading whitespace" and the
    value `npm run ' build'` is a perfectly ordinary, stripped, typable
    record.
    """
    if name == "":
        return (
            "it is empty, so %s names no script — quoting makes it typable "
            "and cannot supply a name that was never declared" % _shown(value)
        )
    return _representability_fault(value)


def _command(value, confidence, evidence):
    """One proposed command record, paired with the evidence that produced it.

    **`repo-declared`, always** (ADR-18). The evidence rides alongside rather
    than inside: a `commandRecord` is a closed key set with no field for it
    (`manifest._COMMAND_RECORD_KEYS`), and a finding that says only *derived
    structurally* names a method rather than evidence — the human confirming
    the record would have no idea which file to open.
    """
    record = {
        "value": value,
        "state": PROPOSED,
        "resolution": REPO_DECLARED,
        "confidence": confidence,
    }
    return record, evidence


# ------------------------------------------------------------------
# The three declaration kinds the decision's grammar table names.


def _package_scripts(payload):
    """`(names, malformed, reason)` — the script names a `package.json` declares.

    `jsonio.loads` is the only sanctioned parser, and it raises `JsonError`,
    which is **not** in `cli.REPORTED_FAULTS` — an unwrapped one prints a
    traceback. It also refuses a top-level JSON array, which a broken
    `package.json` legitimately can be. Both arrive here as a reason, so a
    repository with a broken manifest gets a finding rather than a crash.

    **The body is read, and reading only the key was defect B9.**
    `{"scripts": {"test": null}}` produced a `high`-confidence `npm run test`
    out of an entry no valid script body was ever read from. A `high`
    confidence over something nobody could read is what ADR-28's tier rule
    exists to forbid, and the record it becomes is a documented command that
    may not resolve — acceptance case A1, manufactured here rather than
    detected. `malformed` carries the refusals out so each gets its diagnostic.
    """
    try:
        document = jsonio.loads(payload)
    except jsonio.JsonError as exc:
        return None, None, "it is not readable as JSON: %s" % exc
    if "scripts" not in document:
        return [], [], None
    scripts = document["scripts"]
    if not isinstance(scripts, dict):
        return None, None, (
            "its `scripts` key is %s and not an object, so no script name "
            "could be read out of it" % type(scripts).__name__
        )
    names, malformed = [], []
    for name in sorted(scripts):
        if isinstance(scripts[name], str):
            names.append(name)
        else:
            malformed.append((name, type(scripts[name]).__name__))
    return names, malformed, None


def _package_commands(root, relpath, mode, notes):
    """`[record]` for the root `package.json`, appending any diagnostic.

    **The one declaration this core reads commands out of.** JSON is the only
    format available at the 3.9 floor (ADR-1), and the makefile reader that
    once shared this function is deleted — see the module docstring's
    `make` bullet for the owner decision and its argument.

    `mode` is the index mode `declaration_entries` has already established as
    readable, which is why this function no longer opens with three mode
    branches of its own: asking the index twice is how the stack pass and the
    command pass came to disagree about what a declaration is (defect D1). It
    is passed rather than re-read because the working-tree diagnostic below
    has to print it.

    `notes` is appended to rather than returned so that a declaration that
    produced nothing still leaves a trace: a candidate that vanishes without a
    diagnostic is the S4 failure ADR-28 names.
    """
    if paths.crosses_symlink(root, relpath):
        notes.append(
            Note(
                id=SYMLINKED_DECLARATION,
                claim="a declaration file is read at the path git records it at",
                observed=(
                    "git records a regular file there, but the working tree "
                    "holds a symlink on the way to it, which `git status` "
                    "reports as a type change. The index mode is still %s, so "
                    "the mode check cannot see it, and `paths.contain` returns "
                    "the resolved target — so opening the location it returns "
                    "would read whatever the link points at and propose "
                    "commands out of a file this repository does not declare. "
                    "It was not read." % mode
                ),
                where=_shown(relpath),
            )
        )
        return []

    payload, reason = _read_bytes(root, relpath)
    if reason is not None:
        notes.append(
            Note(
                id=UNREADABLE_DECLARATION,
                claim="a declaration file is read before anything is proposed from it",
                observed=reason + ", so nothing was proposed from it",
                where=_shown(relpath),
            )
        )
        return []

    source = _shown(relpath)
    names, malformed, reason = _package_scripts(payload)
    if reason is not None:
        notes.append(
            Note(
                id=UNREADABLE_DECLARATION,
                claim="a declaration file is read before anything is proposed from it",
                observed=reason,
                where=source,
            )
        )
        return []

    for name, observed_type in malformed:
        notes.append(
            Note(
                id=MALFORMED_SCRIPT,
                claim="every proposed command was read out of a declared command",
                observed=(
                    "the script %s has a body of type %s and not a string, so "
                    "no command body was ever read for it. Proposing it anyway "
                    "would be a high-confidence claim about something nobody "
                    "could read (ADR-28)." % (_shown(name), observed_type)
                ),
                where=source,
            )
        )

    records = []
    for name in names:
        if name.startswith(OPTION_PREFIX):
            notes.append(
                Note(
                    id=OPTION_LIKE_NAME,
                    claim=(
                        "every proposed command names a script, never an "
                        "option to the tool that runs it"
                    ),
                    observed=(
                        "the script %s begins with %s, so %s would reach the "
                        "tool as an option rather than as the thing it names — "
                        "`npm run --help` prints npm's help. Quoting cannot "
                        "change that, and this core does not assert an "
                        "end-of-options form it has not verified (ADR-23), so "
                        "no record was proposed for it."
                        % (
                            _shown(name),
                            _shown(OPTION_PREFIX),
                            _shown(SCRIPT_INVOCATION % name),
                        )
                    ),
                    where=source,
                )
            )
            continue
        value = SCRIPT_INVOCATION % _shell_word(name)
        fault = _name_fault(name, value)
        if fault is not None:
            notes.append(
                Note(
                    id=UNREPRESENTABLE,
                    claim="every proposed command renders as one item on one line",
                    observed=(
                        "the script %s cannot become an invocation this core "
                        "would propose — %s — so no record was proposed for it "
                        "(ADR-32)" % (_shown(name), fault)
                    ),
                    where=source,
                )
            )
            continue
        records.append(
            _command(
                value,
                HIGH,
                "%s declares the script %s at the repository root"
                % (source, _shown(name)),
            )
        )
    return records



def _executable_commands(root, entries, notes):
    """`[record]` for every tracked executable, plus a note per ambiguous entry.

    Confidence `low`, and the difference is real: a named script in a
    declaration file *says* it is a command, while a mode bit says a file is
    executable and nothing more. That anyone should run it is the scanner's
    inference, and it is the weaker one.

    The proposed value is the path under `EXECUTABLE_PREFIX`, quoted as one
    shell word (`_shell_word`), and **the value is what the representability
    filter is applied to — applying it to the raw path was half of defect
    B5.** A path is not what a human types: `./ lead.sh` is an ordinary,
    stripped, typable command whose path ` lead.sh` "carries leading ASCII
    whitespace", so the old order refused a real tracked executable before the
    prefix and the quoting could make it whole. Nothing is lost by moving the
    check: the prefix cannot introduce a control character or a lone
    surrogate, and quoting cannot remove one, so every value the filter refuses
    is refused for something the path really carries — which is why the
    diagnostic still names the **path**, the thing the human has to go and
    look at.
    """
    records = []
    for relpath in sorted(entries):
        mode = _merged_mode(entries[relpath])
        if mode is None:
            # Diagnosed once, by `survey`'s pass — see `_unmerged_note`.
            continue
        if mode != MODE_EXECUTABLE:
            continue
        value = _shell_word(EXECUTABLE_PREFIX + relpath)
        fault = _representability_fault(value)
        if fault is not None:
            notes.append(_unrepresentable_note(relpath, "proposed commands", fault))
            continue
        paths.contain(root, relpath.replace("/", os.sep))
        records.append(
            _command(
                value,
                LOW,
                "git's index records it with mode %s, the executable bit"
                % MODE_EXECUTABLE,
            )
        )
    return records


# ------------------------------------------------------------------
# P3.3 — the docs scope, the agent documents, and the declared path list.
#
# ADR-32 makes this the **sole** origin of the declared path list: "Nothing else
# ever becomes a C2 claim — there is no prose scanner upstream of this." No
# reader for prose, links, code spans, fenced blocks or URLs exists in this
# module, and none may be added: a claim written in prose is not verified, and
# there is no heuristic v0 will grow to guess it.


def _path_record(value, confidence):
    return {"value": value, "state": PROPOSED, "confidence": confidence}


def _source_of_truth(relpath):
    """The confidence a document carries as a source of truth, or None.

    Root `AGENTS.md` and `CLAUDE.md` are `high` — ADR-15 makes them the routing
    unit, and their names are the declaration. A root `README.md` is `low`: it
    is a convention nothing in the repository declares. A nested agent document
    is `low` too, and for a reason that is not about strength of evidence but
    about what may be encoded: **ADR-16 forbids deciding which file wins**,
    there is no standard, and the implementers disagree — so it is detected,
    reported and left for a human, which is what `low` means here.
    """
    name = _basename(relpath)
    at_root = not _directory_of(relpath)
    if name in AGENT_DOCUMENTS:
        return HIGH if at_root else LOW
    if at_root and name == "README.md":
        return LOW
    return None


def _document_container(relpath):
    """Where the docs scope would have to name this document.

    A root document names itself; anything deeper names its top-level
    directory. One kind of entry per document, so the scope stays a list a
    human can read and confirm.
    """
    head, _sep, _tail = relpath.partition("/")
    return head


def _conventional(relpath):
    container = _document_container(relpath)
    return container == relpath or container in DOCUMENT_DIRECTORIES


def _unrepresentable_note(relpath, subject, fault):
    """The one diagnostic shape for a path no record can hold.

    Both the quoted path and `where` go through `_shown`, which is what keeps
    this note printable at all: the value may carry a raw newline (which would
    split one item over two lines of a one-item-per-line section) or a lone
    surrogate (which cannot be written to a UTF-8 stream at all).

    **This note was the only one that escaped its path**, and it called `repr`
    inline. That is why B4 was a defect in five other notes and not in this
    one, and why the fix was to give the rule a name every site can call
    rather than to copy the call — a rule spelled out once per site is a rule
    the next site forgets.
    """
    return Note(
        id=UNREPRESENTABLE,
        claim="every value the-steward proposes renders as one item on one line",
        observed=(
            "the path %s cannot be a record value — %s — so it was left out of "
            "the %s and v0 makes no claim about it (ADR-32)"
            % (_shown(relpath), fault, subject)
        ),
        where=_shown(relpath),
    )


def _documents(root, document):
    """The ADR-10 checking corpus, and the only document set this module reads.

    Enumerated through `corpus`, which spawns `git ls-files` and
    `git check-attr` and nothing else. **Never `find`, never a walk**: in the
    reference repository `find . -name '*.md'` returns 175,944 paths against
    `git ls-files '*.md'`'s 1,091, and that repository's `find`-based builder
    now dies with `ENOBUFS`. Delegating also keeps the vendored/generated
    predicate in one place, so the scanner cannot quietly grow a second
    enumerator that disagrees with C3's.
    """
    return corpus.enumerate_documents(root, document).documents


def _docs_scope(documents, notes):
    """The inferred `docsScope` record, or None where the corpus is empty.

    None is not an empty record: ADR-30 turns *the inferred list came back
    empty* into a **proposed** `intentionallyEmpty` record for the `docsScope`
    key, which is `generate`'s to write, and a `docsScope` claiming to include
    nothing would be a different statement.

    The confidence records a real judgment. Documents at the root or under a
    conventional documentation directory are where documentation lives, and
    saying so adds nothing to what was seen. Anywhere else, the-steward is
    inferring that a directory holds *this repository's documentation* from
    nothing but a `*.md` file being in it — which is a guess, and is labelled
    as one.
    """
    include, conventional = [], True
    for relpath in documents:
        container = _document_container(relpath)
        fault = _representability_fault(container)
        if fault is not None:
            note = _unrepresentable_note(container, "inferred docs scope", fault)
            if not any(existing.where == note.where for existing in notes):
                notes.append(note)
            continue
        if not _conventional(relpath):
            conventional = False
        if container not in include:
            include.append(container)
    if not include:
        return None
    return {
        "state": PROPOSED,
        "confidence": HIGH if conventional else LOW,
        "include": sorted(include),
    }


def _declared_paths(documents, notes):
    """The declared path list: this repository's sources of truth, and nothing
    else. ADR-32 — there is no prose scanner upstream of this."""
    records = []
    for relpath in documents:
        confidence = _source_of_truth(relpath)
        if confidence is None:
            continue
        fault = _representability_fault(relpath)
        if fault is not None:
            notes.append(_unrepresentable_note(relpath, "declared path list", fault))
            continue
        records.append(_path_record(relpath, confidence))
    return tuple(sorted(records, key=lambda record: record["value"]))


def _harness(entries):
    """`(directory, tracked_entry_count)` per harness directory, sorted.

    **Existence only** (ADR-23). What a harness reads out of one of these is an
    unverified vendor contract, and product code written against one escalates
    to the owner rather than shipping — so the count is of tracked entries,
    which is a fact about this repository, and nothing is claimed about what
    any tool does with them.
    """
    counted = {}
    for relpath in entries:
        head, separator, _rest = relpath.partition("/")
        if separator and head in HARNESS_DIRECTORIES:
            counted[head] = counted.get(head, 0) + 1
    return tuple(sorted(counted.items()))


def survey(root, document=None):
    """Everything `scan` infers about `root`. Reads only; **writes nothing**."""
    if root is None:
        return Survey(unavailable=NOT_A_REPOSITORY)
    found = Survey()
    notes = []
    entries = index_entries(root)
    # The index mode is asked **once**, for every declaration, and both
    # consumers below take that answer — `declaration_entries`, defect D1,
    # where a stack finding read a basename and called a symlink a project.
    declarations = declaration_entries(entries, notes)
    found.stacks, found.nested = stacks_and_projects(declarations)

    commands = []
    for relpath in sorted(entries):
        basename = _basename(relpath)
        nested = bool(_directory_of(relpath))
        # One unmerged entry, one diagnostic, emitted where every entry is
        # seen rather than in each consumer that refuses it (`_unmerged_note`).
        if _merged_mode(entries[relpath]) is None:
            notes.append(_unmerged_note(relpath, entries[relpath]))
        # Every makefile, at any depth, and the reason is never the working
        # directory: v0 proposes no target out of any of them, so a note that
        # said "outside the repository root" would name a reason that is not
        # the operative one and would tell the human that moving the file to
        # the root would help. It would not. See the module docstring's `make`
        # bullet — and `MAKEFILES`, which is a list of names and no longer a
        # precedence order.
        #
        # Only for a makefile that **is** a declaration: where the index
        # records a symlink, a gitlink or an unmerged entry, that fact has
        # already been named and "v0 reads no makefile" would be a second
        # finding over one already-explained path.
        if basename in MAKEFILES and relpath in declarations:
            notes.append(
                Note(
                    id=UNREAD_MAKEFILE,
                    claim=(
                        "every command this core proposes was read out of a "
                        "declaration it can read"
                    ),
                    observed=(
                        "it is a makefile, and v0 proposes **no** target from "
                        "one. GNU make is a macro language with conditionals "
                        "and file inclusion, so which targets exist depends on "
                        "`$(...)` expansion, on `ifeq`/`ifdef` evaluation and "
                        "on included files — a reader that does none of those "
                        "cannot know them, and every approximation error is a "
                        "documented command that does not resolve. Nothing was "
                        "proposed from it, and nothing was guessed at. The "
                        "make stack is still reported, and a `make` command "
                        "this repository really has is a human's to write into "
                        "`.steward.json` and confirm."
                    ),
                    where=_shown(relpath),
                )
            )
        # **Defect B7 was the order of these two.** The nested `continue` ran
        # first, so a `tools/Taskfile.yml` produced no command (correct) and no
        # diagnostic at all (ADR-28's S4 failure: "a candidate silently dropped
        # both hides a real edge and manufactures a false orphan"). The
        # supported basenames were already named at any depth, because
        # `package.json` and `Makefile` are in `DECLARATIONS` and every nested
        # one gets a `NESTED_DECLARATION` note below; the unsupported ones are
        # not in that table, so nothing named them anywhere. The basename is
        # matched at any depth, and the nesting becomes a clause of the note
        # rather than a reason to skip it.
        if basename in UNPARSEABLE_DECLARATIONS:
            notes.append(
                Note(
                    id=UNPARSEABLE_DECLARATION,
                    claim=(
                        "every command this core proposes was read out of a "
                        "declaration it can parse"
                    ),
                    observed=(
                        "it is a %s declaration, and the core is stdlib-only "
                        "at the Python 3.9 floor, where there is neither a "
                        "TOML nor a YAML reader (ADR-1). Nothing was proposed "
                        "from it, and nothing was guessed at.%s"
                        % (
                            UNPARSEABLE_DECLARATIONS[basename],
                            " It is also outside the repository root, which is "
                            "a second reason no command record could name it."
                            if nested
                            else "",
                        )
                    ),
                    where=_shown(relpath),
                )
            )
        if nested:
            continue
        if basename == PACKAGE_MANIFEST and relpath in declarations:
            commands.extend(
                _package_commands(root, relpath, declarations[relpath], notes)
            )
    commands.extend(_executable_commands(root, entries, notes))
    for _stack, relpath in found.nested:
        notes.append(
            Note(
                id=NESTED_DECLARATION,
                claim=(
                    "a command record names one command a human can type at "
                    "the repository root"
                ),
                observed=(
                    "this declaration is in a nested project, and `npm run "
                    "<script>` names whichever project the shell is standing "
                    "in. A command record has no field for a working "
                    "directory, so no record was proposed from it. This is an "
                    "interim boundary, not a settled answer."
                ),
                where=_shown(relpath),
            )
        )
    # One record per command string. ADR-32 makes the cardinality the record
    # count, so two records holding the same string would make one claim count
    # as two examined items, and `command_evidence` — keyed by value — would
    # keep one evidence sentence and print it under both.
    #
    # **Retained deliberately, with no reachable duplicate source in v0.** The
    # source it was written for (two tracked makefiles, or one declaring a
    # target twice) went with the makefile reader; what is left proposes from
    # one root `package.json`, whose script names are JSON object keys, and
    # from tracked executables, whose paths are index keys — both unique by
    # construction. It stays because the invariant is ADR-32's rather than the
    # parser's, and P4/P6 add record sources; the honest statement of its
    # status is this comment, not a test that cannot fail. The first evidence
    # read wins, and declarations are read in sorted path order, so which one
    # that is follows from the repository and not from an iteration order
    # (ADR-8).
    unique = {}
    for record, evidence in sorted(commands, key=lambda pair: pair[0]["value"]):
        unique.setdefault(record["value"], (record, evidence))
    found.commands = tuple(unique[value][0] for value in sorted(unique))
    found.command_evidence = dict(
        (value, unique[value][1]) for value in unique
    )

    found.documents = _documents(root, document)
    found.docs_scope = _docs_scope(found.documents, notes)
    found.paths = _declared_paths(found.documents, notes)
    found.harness = _harness(entries)
    found.notes = tuple(notes)
    return found


def _project_location(directory):
    """What the report calls a project directory. See `ROOT_PROJECT`."""
    return _shown(directory) if directory else ROOT_PROJECT


def _stack_claim(directory, stack):
    """One project's stack, said of the directory it is actually in.

    Two sentences rather than one, because "at its root" is false of
    `packages/web` and a sentence naming no directory is unusable in a
    repository with several projects (defect B1).
    """
    if directory:
        return "this repository declares a %s project in %s" % (
            stack,
            _shown(directory),
        )
    return "this repository declares a %s project at its root" % stack


def _stack_findings(survey):
    return [
        findings.finding(
            id=STACK_FINDING,
            severity="info",
            tier="inferred",
            confidence=HIGH,
            claim=_stack_claim(directory, stack),
            observed=(
                "git tracks %s there, which is how the %s ecosystem declares "
                "a project"
                % (", ".join(_shown(name) for name in declarations), stack)
            ),
            where=_project_location(directory),
        )
        for directory, stack, declarations in survey.stacks
    ]


def _command_findings(survey):
    return [
        findings.finding(
            id=COMMAND_FINDING,
            severity="info",
            tier="inferred",
            confidence=record["confidence"],
            claim=(
                "%s is a command this repository declares, and a human can "
                "type it at the repository root" % _shown(record["value"])
            ),
            observed=(
                "%s. It was derived structurally, and nothing was executed to "
                "establish it (ADR-18); it is proposed for a human to confirm."
                % survey.command_evidence[record["value"]]
            ),
            where="commands[%d]" % index,
        )
        for index, record in enumerate(survey.commands)
    ]


def _nested_reason(survey):
    """The `commands` cardinality's reason, or None where there is nothing to say."""
    if survey.nested:
        return (
            "%d declaration(s) outside the repository root were diagnosed and "
            "not proposed" % len(survey.nested)
        )
    return None if survey.commands else NO_COMMAND


def _path_evidence(relpath):
    """Why this document is proposed as a source of truth, in its own terms.

    Derived from the value rather than carried alongside it, because for a path
    record the value **is** the evidence — where it sits and what it is called
    are the whole reason it was proposed.
    """
    if _directory_of(relpath):
        return (
            "it is a tracked %s below the repository root. There is no "
            "standard for what a nested agent document means, and the "
            "implementers disagree (ADR-16), so it is reported and which of "
            "them a tool reads first is not something the-steward has "
            "established" % _shown(_basename(relpath))
        )
    if _basename(relpath) in AGENT_DOCUMENTS:
        return (
            "it is tracked at the repository root under the name a repository "
            "uses to declare this kind of source of truth"
        )
    return (
        "it is the tracked README at the repository root — a convention, not "
        "something this repository declares, which is what the confidence "
        "records"
    )


def _path_findings(survey):
    return [
        findings.finding(
            id=PATH_FINDING,
            severity="info",
            tier="inferred",
            confidence=record["confidence"],
            claim=(
                "%s is one of this repository's sources of truth"
                % _shown(record["value"])
            ),
            observed=(
                "%s. It is proposed for a human to confirm, and nothing about "
                "how any tool reads it is claimed."
                % _path_evidence(record["value"])
            ),
            where="paths[%d]" % index,
        )
        for index, record in enumerate(survey.paths)
    ]


def _documents_under(documents, include):
    """How many of `documents` lie under a directory the scope actually names.

    **Defect D3.** The evidence counted `len(survey.documents)` — the whole
    corpus — while `_docs_scope` had already left out every container it could
    not represent (ADR-32) and diagnosed each. So the one sentence a human
    reads to size the scope counted documents the scope explicitly excludes:
    three documents claimed to lie under two directories, when one of them lay
    under a third the report deliberately does not name. A count that claims
    more than the thing it counts is ADR-30's concern pointed the other way.
    """
    included = set(include)
    return sum(
        1 for relpath in documents if _document_container(relpath) in included
    )


def _docs_scope_findings(survey):
    if survey.docs_scope is None:
        return []
    include = survey.docs_scope["include"]
    return [
        findings.finding(
            id=DOCS_SCOPE_FINDING,
            severity="info",
            tier="inferred",
            confidence=survey.docs_scope["confidence"],
            # **Defect D2.** These were joined raw, the one repository-derived
            # string in this module that did not go through `_shown` — and
            # `_representability_fault` cannot stand in for it, because its
            # rule is ADR-32's (ASCII control characters, non-UTF-8 bytes) and
            # a Unicode formatting character such as U+202E RIGHT-TO-LEFT
            # OVERRIDE is neither. It is valid UTF-8, it validates as a record
            # value, and it reverses every character after it in the terminal
            # of the human reading the report.
            claim="this repository's documentation lives under %s"
            % ", ".join(_shown(directory) for directory in include),
            observed=(
                "%d tracked document(s) satisfying ADR-10's predicate lie "
                "there" % _documents_under(survey.documents, include)
            ),
            where=DOCS_SCOPE_CHECK,
        )
    ]


def _harness_findings(survey):
    return [
        findings.finding(
            id=HARNESS_FINDING,
            severity="info",
            tier="inspected",
            claim="a directory of this name is tracked in this repository",
            observed=(
                "%d tracked entries are under it. Its existence is all that "
                "was looked at; what any tool reads out of it is not something "
                "the-steward has established." % count
            ),
            where=directory,
        )
        for directory, count in survey.harness
    ]


def _note_findings(survey):
    return [
        findings.finding(
            id=note.id,
            severity="info",
            tier="inspected",
            claim=note.claim,
            observed=note.observed,
            where=note.where,
        )
        for note in survey.notes
    ]


def survey_findings(survey):
    """`(found, cardinalities)` for one survey.

    Every check reports the cardinality it examined and a zero states its
    reason, so a scan that found nothing says so and can never render as
    coverage (ADR-30).
    """
    if survey.unavailable is not None:
        return [], [
            findings.cardinality(check, 0, reason=survey.unavailable)
            for check in CHECKS
        ]
    found = (
        _stack_findings(survey)
        + _command_findings(survey)
        + _path_findings(survey)
        + _docs_scope_findings(survey)
        + _harness_findings(survey)
        + _note_findings(survey)
    )
    cardinalities = [
        findings.cardinality(
            STACK_CHECK,
            len(survey.stacks),
            reason=None if survey.stacks else NO_STACK,
        ),
        findings.cardinality(
            COMMAND_CHECK, len(survey.commands), reason=_nested_reason(survey)
        ),
        findings.cardinality(
            PATH_CHECK, len(survey.paths), reason=None if survey.paths else NO_PATH
        ),
        findings.cardinality(
            DOCS_SCOPE_CHECK,
            len(survey.documents),
            reason=None if survey.documents else NO_DOCUMENT,
        ),
        findings.cardinality(
            HARNESS_CHECK,
            len(survey.harness),
            reason=None if survey.harness else NO_HARNESS,
        ),
    ]
    return found, cardinalities
