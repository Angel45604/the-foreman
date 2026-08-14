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
   working directory.** `npm run test` and `make test` name whichever project
   the shell is standing in, and a `commandRecord` has no `cwd`, `project` or
   `prefix` field to disambiguate with (`manifest._COMMAND_RECORD_KEYS`, and
   adding one would reopen a shipped Phase-1 schema). So a nested project's
   declaration produces **no record** — it produces a diagnostic naming the
   file and why (ADR-28), and the cardinality line states it. A tracked
   executable is not in that class: it is **self-locating**, so its path names
   one file from the root and nothing else, and it is proposed at any depth.
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
  it true or not make it.
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
# and no `yaml`. The declarations below are exactly those a dependency-free
# reader can parse: JSON, and a line-oriented Makefile grammar. Everything else
# a repository may declare commands in is detected and **diagnosed**, never
# guessed at — see `UNPARSEABLE_DECLARATIONS`.
PACKAGE_MANIFEST = "package.json"
MAKEFILE_NAMES = ("GNUmakefile", "Makefile", "makefile")

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
# npm's help and `make -j4` asks for four parallel jobs and builds the default
# target: in neither case does the tool receive the name as the thing it names.
OPTION_PREFIX = "-"


def _shell_word(value):
    """`value` as one word a POSIX shell reads exactly as written.

    **The defect this prevents is B1, and two of its cases executed code.**
    Every command finding claims "a human can type it at the repository root".
    Typed verbatim into `/bin/sh` at the root of a fixture holding them, three
    of ten emitted values did that; `./scripts/$(id).sh` ran `id` through
    command substitution and then failed, `npm run a;id` ran `id` through the
    statement separator and exited **0**, and a space, a single quote and a
    backslash each turned one value into a different command or a syntax
    error. `_proposable` rejected only non-str / empty / unstripped / ASCII
    control, so `;`, `$`, `'`, `\\` and a space all flowed into a value the
    report said a human could type.

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

STACK_CHECK = "stacks"
COMMAND_CHECK = "commands"
PATH_CHECK = "paths"
DOCS_SCOPE_CHECK = "docsScope"
HARNESS_CHECK = "harness"

CHECKS = (STACK_CHECK, COMMAND_CHECK, PATH_CHECK, DOCS_SCOPE_CHECK, HARNESS_CHECK)

NOT_A_REPOSITORY = "this directory is not inside a git repository"

NO_STACK = "no declaration file this core can recognise is tracked at the root"
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
    conflicted root `Makefile` produce the same diagnostic twice, which inflates
    the finding count over one fact. So the message names the fact rather than
    either question, and neither consumer's honesty depends on the other
    running.
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
        where=relpath,
    )


def _directory_of(relpath):
    """The repository-relative directory holding `relpath`, or "" for the root."""
    head, _sep, _tail = relpath.rpartition("/")
    return head


def _basename(relpath):
    _head, _sep, tail = relpath.rpartition("/")
    return tail


def stacks_and_projects(entries):
    """`(root_stacks, nested)` from the index alone.

    `root_stacks` is `(stack, declaration)` pairs for the declarations tracked
    **at the repository root**, sorted. `nested` is `(stack, declaration)` for
    the same declarations anywhere else — detected so they can be diagnosed
    (ADR-28), never proposed from (the interim boundary above).

    P3.1's rule is a prohibition: *never emit one ecosystem's assumptions into
    another's repo*. It holds structurally, because everything downstream is
    driven by the declaration file actually tracked here — there is no default
    stack and no fallback.
    """
    root_stacks, nested = [], []
    for relpath in sorted(entries):
        stack = DECLARATIONS.get(_basename(relpath))
        if stack is None:
            continue
        if _directory_of(relpath):
            nested.append((stack, relpath))
        else:
            root_stacks.append((stack, relpath))
    return tuple(sorted(root_stacks)), tuple(sorted(nested))


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


def _proposable(value):
    """Is `value` something a record could hold, and a report render (ADR-32)?"""
    return _representability_fault(value) is None


def _name_fault(name):
    """Why `name` is not a script or target name the grammar may use, or None.

    Representability first, then one rule of this module's own: the proposed
    value is `npm run <name>` / `make <name>`, and although `_shell_word` now
    makes a name carrying whitespace typable (`npm run 'build all'`), this core
    keeps refusing it. A refusal with a diagnostic is never a false claim,
    whereas widening what a scanner proposes is a behaviour change nobody
    asked for — and `UnnameableScriptTest` pins the refusal, having been
    written after a mutation run found the check live and completely
    unasserted.
    """
    fault = _representability_fault(name)
    if fault is not None:
        return fault
    for character in text.ASCII_WHITESPACE:
        if character in name:
            return (
                "it carries ASCII whitespace, and this core does not propose a "
                "name it would have to quote to keep whole"
            )
    return None


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


# Words that begin a Makefile *directive*, never a rule. `ifeq ($(A):,$(B))`
# holds a colon and would otherwise split into two "targets".
MAKE_DIRECTIVES = (
    "-include",
    "define",
    "else",
    "endef",
    "endif",
    "export",
    "ifdef",
    "ifeq",
    "ifndef",
    "ifneq",
    "include",
    "override",
    "sinclude",
    "undefine",
    "unexport",
    "vpath",
)

# The characters a proposed target may consist of. An allowlist, not a
# denylist: `$(GENERATED)` and `%.o` are the shapes that matter and both would
# survive any denylist somebody later trimmed.
MAKE_TARGET_CHARACTERS = (
    "abcdefghijklmnopqrstuvwxyz"
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    "0123456789"
    "_-./+"
)


def _is_make_target(token):
    if not token or token.startswith("."):
        return False
    if token in MAKE_DIRECTIVES:
        return False
    for character in token:
        if character not in MAKE_TARGET_CHARACTERS:
            return False
    return True


# Every operator that makes a line an **assignment** rather than a rule,
# longest first so `::=` is never read as the `:` of a rule followed by `=`.
# GNU make 4.4's `:::=` is included because it is one of these and leaving it
# out would read `VAR :::= x` as a rule declaring a target `VAR`.
MAKE_ASSIGNMENT_OPERATORS = (":::=", "::=", ":=", "?=", "+=", "!=", "=")

MAKE_COMMENT = "#"


def _strip_comment(line):
    """The line up to its first `#`.

    **A `\\#` escape is deliberately not honoured, and that is a decision with
    a reason, not an omission.** Escaping only ever *preserves* a `#` in the
    text, and `#` and `\\` are both outside `MAKE_TARGET_CHARACTERS`, so every
    token an escape could preserve is a token `_is_make_target` rejects anyway
    — the branch is unreachable through this reader, and this project prefers
    deleting a rule to qualifying one. Stripping can only shorten a line, so it
    can drop a candidate but can never invent one. Widening
    `MAKE_TARGET_CHARACTERS` is what would make the escape matter again.
    """
    head, _separator, _rest = line.partition(MAKE_COMMENT)
    return head


def _rule_head(line):
    """The targets side of a rule line, or None where the line declares no rule.

    **Defect B2 lived here, and it was a 5:1 false-positive rate.** The reader
    partitioned at the **first colon** and only then asked whether what
    followed looked like an assignment, so two entirely ordinary lines —

        REGISTRY = https://example.invalid/image
        FOO = bar # note: explanation

    — split at the colon inside a URL and at the colon inside a comment, and
    yielded five targets `make` does not have (`REGISTRY`, `https`, `FOO`,
    `bar`, `note`) beside the one it does. ADR-32 names the outcome: "a checker
    that cries wolf gets ignored, which is this tool's defining failure by
    another road."

    So the line is scanned left to right and **whichever comes first decides**,
    which is the only rule that separates `target: dep=1` (a rule) from
    `VAR := value` (an assignment) — they differ by which token is reached
    first, not by what either contains. The caller strips the comment before
    calling, so a colon inside one is never reached at all.
    """
    index = 0
    while index < len(line):
        for operator in MAKE_ASSIGNMENT_OPERATORS:
            if line.startswith(operator, index):
                return None
        if line[index] == ":":
            return line[:index]
        index += 1
    return None


def _makefile_targets(body):
    """Every explicit, invocable target a Makefile declares.

    Hand-rolled and deliberately narrow: there is no stdlib Makefile parser and
    none may be vendored (ADR-1), so the reader recognises the one shape it can
    be sure of — an unindented line whose first colon is not part of an
    assignment — and refuses everything else. Each refusal is a target `make`
    does not have, and proposing one would be A1 manufactured by us:

    * **recipe lines** are TAB-indented and belong to the rule above them;
    * **assignments** in every form GNU make has — `=`, `:=`, `::=`, `:::=`,
      `?=`, `+=`, `!=` — declare a variable, not a rule (`_rule_head`);
    * **comments** are removed *before* a colon is looked for, so a colon
      inside one is never a rule separator (`_strip_comment`);
    * **continuation lines** are part of the logical line above, so
      `FILES := a \\` / `b.c:extra` would otherwise yield a target `b.c`;
    * **`define` blocks** are macro bodies and their colons are text;
    * **special targets** (`.PHONY`), **pattern rules** (`%.o`) and any target
      naming a variable (`$(GENERATED)`) are not names a human can invoke.

    The comment strip and the assignment scan are both **B2's fix**, and both
    have to run before the colon is read rather than after — see `_rule_head`.
    """
    targets = []
    continued = False
    defining = False
    for line in body.split("\n"):
        carried = continued
        continued = line.endswith("\\")
        if carried:
            continue
        stripped = line.strip()
        first = stripped.split(" ")[0] if stripped else ""
        if defining:
            if first == "endef":
                defining = False
            continue
        if first == "define":
            defining = True
            continue
        if not stripped or stripped.startswith(MAKE_COMMENT) or line.startswith("\t"):
            continue
        head = _rule_head(_strip_comment(line))
        if head is None:
            continue
        for token in head.split():
            if _is_make_target(token):
                targets.append(token)
    return targets


def _declaration_commands(root, relpath, entries, notes):
    """`[record]` for one root declaration file, appending any diagnostic.

    `notes` is appended to rather than returned so that a declaration that
    produced nothing still leaves a trace: a candidate that vanishes without a
    diagnostic is the S4 failure ADR-28 names.
    """
    basename = _basename(relpath)
    stages = entries[relpath]
    mode = _merged_mode(stages)
    if mode is None:
        # Diagnosed once, by `survey`'s pass over every entry — see
        # `_unmerged_note`. Refusing here without a note of our own is what
        # keeps one fact to one finding.
        return []
    if mode == MODE_SYMLINK:
        notes.append(
            Note(
                id=SYMLINKED_DECLARATION,
                claim="a declaration file is read at the path git records it at",
                observed=(
                    "git records it as a symlink, and an in-tree link passes "
                    "the containment predicate, so following it would propose "
                    "commands read out of a file this repository does not "
                    "declare. It was not read."
                ),
                where=relpath,
            )
        )
        return []
    if mode not in READABLE_MODES:
        notes.append(
            Note(
                id=UNREADABLE_DECLARATION,
                claim="a declaration file is a regular file git records once",
                observed=(
                    "git records it with mode %r, which is not a regular file "
                    "this core reads" % (mode,)
                ),
                where=relpath,
            )
        )
        return []
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
                where=relpath,
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
                where=relpath,
            )
        )
        return []

    if basename == PACKAGE_MANIFEST:
        names, malformed, reason = _package_scripts(payload)
        template, confidence, kind = "npm run %s", HIGH, "script"
        evidence = "%s declares the script %%r at the repository root" % relpath
    else:
        names, malformed, reason = _makefile_targets(_decode(payload)), [], None
        template, confidence, kind = "make %s", HIGH, "target"
        evidence = "%s declares the target %%r at the repository root" % relpath
    if reason is not None:
        notes.append(
            Note(
                id=UNREADABLE_DECLARATION,
                claim="a declaration file is read before anything is proposed from it",
                observed=reason,
                where=relpath,
            )
        )
        return []

    for name, observed_type in malformed:
        notes.append(
            Note(
                id=MALFORMED_SCRIPT,
                claim="every proposed command was read out of a declared command",
                observed=(
                    "the %s %r has a body of type %s and not a string, so no "
                    "command body was ever read for it. Proposing it anyway "
                    "would be a high-confidence claim about something nobody "
                    "could read (ADR-28)." % (kind, name, observed_type)
                ),
                where=relpath,
            )
        )

    records = []
    for name in names:
        fault = _name_fault(name)
        if fault is not None:
            notes.append(
                Note(
                    id=UNREPRESENTABLE,
                    claim="every proposed command renders as one item on one line",
                    observed=(
                        "the %s %r cannot become an invocation without changing "
                        "what it names — %s — so no record was proposed for it "
                        "(ADR-32)" % (kind, name, fault)
                    ),
                    where=relpath,
                )
            )
            continue
        if name.startswith(OPTION_PREFIX):
            notes.append(
                Note(
                    id=OPTION_LIKE_NAME,
                    claim=(
                        "every proposed command names a script or a target, "
                        "never an option to the tool that runs it"
                    ),
                    observed=(
                        "the %s %r begins with %r, so %r would reach the tool "
                        "as an option rather than as the thing it names — `npm "
                        "run --help` prints npm's help, and `make -j4` asks for "
                        "four parallel jobs and builds the default target. "
                        "Quoting cannot change that, and this core does not "
                        "assert an end-of-options form it has not verified "
                        "(ADR-23), so no record was proposed for it."
                        % (kind, name, OPTION_PREFIX, template % name)
                    ),
                    where=relpath,
                )
            )
            continue
        value = template % _shell_word(name)
        if not _proposable(value):
            continue
        records.append(_command(value, confidence, evidence % (name,)))
    return records


def _executable_commands(root, entries, notes):
    """`[record]` for every tracked executable, plus a note per ambiguous entry.

    Confidence `low`, and the difference is real: a named script in a
    declaration file *says* it is a command, while a mode bit says a file is
    executable and nothing more. That anyone should run it is the scanner's
    inference, and it is the weaker one.

    The proposed value is the path under `EXECUTABLE_PREFIX`, quoted as one
    shell word (`_shell_word`). The representability filter is applied to the
    **path**, because the path is what the diagnostic has to name and what
    could carry a control character or a byte sequence that is not UTF-8; the
    prefix cannot introduce one, and cannot make a stripped value unstripped or
    an unempty one empty.
    """
    records = []
    for relpath in sorted(entries):
        mode = _merged_mode(entries[relpath])
        if mode is None:
            # Diagnosed once, by `survey`'s pass — see `_unmerged_note`.
            continue
        if mode != MODE_EXECUTABLE:
            continue
        fault = _representability_fault(relpath)
        if fault is not None:
            notes.append(_unrepresentable_note(relpath, "proposed commands", fault))
            continue
        paths.contain(root, relpath.replace("/", os.sep))
        records.append(
            _command(
                _shell_word(EXECUTABLE_PREFIX + relpath),
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

    `where` and the quoted path are both `%r`, which is what keeps this note
    printable at all: the value may carry a raw newline (which would split one
    item over two lines of a one-item-per-line section) or a lone surrogate
    (which cannot be written to a UTF-8 stream at all). `repr` escapes both.
    """
    return Note(
        id=UNREPRESENTABLE,
        claim="every value the-steward proposes renders as one item on one line",
        observed=(
            "the path %r cannot be a record value — %s — so it was left out of "
            "the %s and v0 makes no claim about it (ADR-32)"
            % (relpath, fault, subject)
        ),
        where=repr(relpath),
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
    found.stacks, found.nested = stacks_and_projects(entries)

    commands = []
    for relpath in sorted(entries):
        basename = _basename(relpath)
        nested = bool(_directory_of(relpath))
        # One unmerged entry, one diagnostic, emitted where every entry is
        # seen rather than in each consumer that refuses it (`_unmerged_note`).
        if _merged_mode(entries[relpath]) is None:
            notes.append(_unmerged_note(relpath, entries[relpath]))
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
                    where=relpath,
                )
            )
        if nested:
            continue
        if basename == PACKAGE_MANIFEST or basename in MAKEFILE_NAMES:
            commands.extend(_declaration_commands(root, relpath, entries, notes))
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
                    "<script>` / `make <target>` name whichever project the "
                    "shell is standing in. A command record has no field for a "
                    "working directory, so no record was proposed from it. "
                    "This is an interim boundary, not a settled answer."
                ),
                where=relpath,
            )
        )
    # One record per command string. ADR-32 makes the cardinality the record
    # count, so two records holding the same string would make one claim count
    # as two examined items — coverage inflated by the accident of two
    # Makefiles declaring the same target. The first evidence read wins, and
    # declarations are read in sorted path order, so which one that is follows
    # from the repository rather than from an iteration order (ADR-8).
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


def _stack_findings(survey):
    return [
        findings.finding(
            id=STACK_FINDING,
            severity="info",
            tier="inferred",
            confidence=HIGH,
            claim="this repository declares a %s project at its root" % stack,
            observed=(
                "%s is tracked at the repository root, which is how the %s "
                "ecosystem declares a project" % (declaration, stack)
            ),
            where=declaration,
        )
        for stack, declaration in survey.stacks
    ]


def _command_findings(survey):
    return [
        findings.finding(
            id=COMMAND_FINDING,
            severity="info",
            tier="inferred",
            confidence=record["confidence"],
            claim=(
                "%r is a command this repository declares, and a human can "
                "type it at the repository root" % record["value"]
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
            "established" % _basename(relpath)
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
                "%r is one of this repository's sources of truth"
                % record["value"]
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


def _docs_scope_findings(survey):
    if survey.docs_scope is None:
        return []
    return [
        findings.finding(
            id=DOCS_SCOPE_FINDING,
            severity="info",
            tier="inferred",
            confidence=survey.docs_scope["confidence"],
            claim="this repository's documentation lives under %s"
            % ", ".join(survey.docs_scope["include"]),
            observed=(
                "%d tracked document(s) satisfying ADR-10's predicate lie "
                "there" % len(survey.documents)
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
