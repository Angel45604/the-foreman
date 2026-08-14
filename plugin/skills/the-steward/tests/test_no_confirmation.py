"""P3.7 — no confirmation prompt exists, and the bound on how that is known.

ADR-11 : "Confirmation is a human edit to a tracked file, and there is no
         prompt anywhere in v0. A record becomes `confirmed` when a human
         changes its `state` in `.steward.json` and commits it ... `generate`
         behaves identically with or without a TTY: it never asks, never
         blocks, never promotes an inference, so an unreviewed manifest can
         neither fail a build nor declare itself approved."
ADR-20 : preflight is a report, not a transaction — "no per-target prompt and
         no prompt of any kind", which is what lets one code path serve every
         invocation, with or without a TTY.
ADR-28 : "there is no enforcement" is banned outright, and every stronger claim
         must be "scoped to the object actually inspected". That rule is what
         this file is shaped by, and it cost an entire audit — below.

**What used to be here, and why it is gone (DECISION-2026-08-14-audit-shape).**

A second AST audit asserted that *no core module **can** write a `confirmed`
record*. It was live against the literal shape and exactly one refactor deep
against every other: `_key = "state"; record[_key] = CONFIRMED` planted inside
the real `record_findings` loop — a genuine ADR-11 violation in production code
— left that audit, and the whole file, green. Its claim was ADR-28's banned
shape, made by this tool's own suite about itself, and the set of syntactic
forms that write a string into a dict key is unbounded: more detector branches
would only have made a wrong claim feel complete. It was deleted rather than
extended. The guarantee now rests on three things, and **only the first of them
is a guarantee**:

1. **the input-non-mutation snapshot** in `test_records.py`
   (`ConfirmedRecordIsNeverDeletedTest.test_the_record_set_is_read_and_never_edited`)
   — it renders the caller's own records to text before and after and compares,
   so a promotion is caught however it is spelled. It enumerates no syntax, and
   it is the only one of the three that does not. Verified against the exact
   shape that evaded the audit: planted in a **copy** of `core/records.py` it
   reddens with *"the machine edited a record"*, `"proposed"` -> `"confirmed"`
   — while this entire file stayed green, which is the measure of pillar 2;
2. a **bounded lint** that `core/records.py`'s own source names no obvious way
   to reach the filesystem — `BoundedWriteCapabilityLintTest`. **It is not a
   no-write guarantee and cannot be one**, and the first version of this
   paragraph claimed it was: `from manifest import os as filesystem` preserves
   the asserted import set and names nothing the lint knows, because purity is
   not transitive through a re-export (T7). That shape is kept below as a
   false-green regression fixture, so the lint can never again be mistaken for
   proof (DECISION-2026-08-14-audit-shape, CORRECTION);
3. the **Phase-6 write-seam invariant**, carried as an obligation in the
   decision document (P6.7), because deleting the oracle is what makes it
   load-bearing.

**Two lints and one behavioural fixture, and the difference between them is the
point.** `BoundedPromptLintTest` names the four costumes it can see and claims
nothing about the rest. `BoundedWriteCapabilityLintTest` names four capability
words in one module's own source and claims nothing about what that module can
reach *through* the modules it imports. `StandardInputChangesNothingTest`
looks at no syntax at all: it runs the real verbs twice — once with nothing on
standard input and no terminal reachable, once with a pty that is both fd 0 and
the child's **controlling terminal** — and compares the bytes, which is what
reaches `os.read(0, 16)` and `open("/dev/tty").readline()`, neither of which any
AST branch will ever enumerate.

**And its bound, stated because the first version of this paragraph did not
have one and was false (T6).** The fixture covers *the three live verbs, on one
fixture repository, under those two arrangements*. It says nothing about
`generate`, nothing about a repository shaped differently, and nothing about a
prompt on a channel that is neither fd 0 nor the controlling terminal.

**Seven traps this file is written against.**

**T1 — an audit over clean code reports nothing whether it works or not.** Two
guards shipped in this project that could not be told apart from broken ones
until each was made to run its **real aggregation** over a deliberately planted
bad module. Every aggregation here has that self-check, and each also has a
false-positive control, because a detector that flags everything would satisfy
a plant just as well as a correct one.

**T2 — the enumeration layer is where "did we even look" lives.** Every planted
self-check in `test_imports.py` hands the aggregation a `{name: source}` dict,
so the step that reads modules **off disk** is proven only indirectly. Here it
is proven directly: a module is planted in a temp directory and `core_sources`
is pointed at it.

**T3 — `stdin` is not the same word as `sys.stdin`.** The core spawns git with
a pipe and feeds it on a thread (`paths._Feeder`), so `stdin=` keywords,
`child.stdin` attributes and a parameter named `stdin` are all legitimate and
all over `paths.py`. A detector keyed on the substring would flag every one of
them, and the honest way to prove it does not is to plant that exact shape and
assert it comes back clean.

**T4 — two runs that both produced nothing agree byte for byte.** A stdin/pty
comparison over a verb that printed an empty report, or that failed identically
both times, is satisfied by `""` == `""`. Every comparison below is paired, in
the same test, with an assertion that the verb exited 0 and printed its
cardinality lines, and one further test asserts the fixture repository really
gives the scanner something to find.

**T5 — a pty that is not a terminal.** If `pty.openpty()` did not put a
terminal on the child's standard input, the fixture would be comparing two
identical *non*-terminal runs and could never see a TTY branch at all. The
control asks an **independent oracle** — the interpreter itself, not the code
under test — what it sees on fd 0 under each of the two arrangements, and
asserts they differ.

**T6 — fd 0 is not `/dev/tty`, and this file shipped claiming it was.** The
paragraph above used to say the byte comparison "covers `/dev/tty`". It did not,
and nobody had run it. `subprocess.run(stdin=slave)` sets **fd 0 only**: it
never calls `setsid()` or `TIOCSCTTY`, so the child kept the *parent's*
controlling terminal, and `/dev/tty` inside the child resolved to the runner's
terminal or — on a runner that has none, which is every CI job — to `ENXIO`.
Either way **both arrangements agreed**, so the comparison could not distinguish
them on that question at all. Verified end to end: a prompt planted in the live
`_scan` body that opens `/dev/tty`, writes the question, reads the answer and
carries the `except OSError: return` a developer writes to "degrade gracefully
in CI" left this file **green, including T5**, while the identical core run from
a process that has a terminal printed `Proceed with scan? [y/N]` and blocked
forever. T5 is necessary and was never sufficient: `isatty` asks about fd 0, and
fd 0 does not determine the controlling terminal. The child now runs in its own
session with the fixture's pty installed as its controlling terminal, and a
second independent oracle asserts the two arrangements genuinely differ about
`/dev/tty` — unavailable in one, and *the fixture's own pty* (by a window size
no default has) in the other.

**T7 — purity is not transitive through a re-export, and this file shipped a
lint that assumed it was.** The audit deleted above was replaced by a reading of
`records.py`'s import list plus a search for four capability words, and that was
called *complete and decidable* because the vocabulary is finite and the module
is one. Both halves are true and the conclusion still does not follow: a module
whose name is on the allowed list can hand over a capability the list forbids.
`from manifest import os as filesystem` leaves the asserted import set exactly
`('findings', 'manifest', 'text')`, names nothing in `WRITE_CAPABILITIES`, and
`filesystem.remove` is the real `os.remove` — `manifest` imports `os` at module
scope. Verified: with that alias planted, the lint returns `[]`; with the
promotion `_key = "state"; record[_key] = CONFIRMED` planted in a copy of the
live `record_findings` loop, **all 20 tests in this file pass** and the
behavioural snapshot in `test_records.py` is what goes red. The lint is kept as
a lint, its claim narrowed to the names it inspects, and the evading shape is
pinned below as a false-green regression fixture — **not** closed by another
branch, which would be the third syntactic enumeration in one phase.

**Deliberately out of scope, and disclosed rather than faked:** the same
byte-identity fixture for `generate`. Its subject is still a Phase-1 stub
(`cli.VERBS`), so the fixture would assert that two runs of a stub agree. It is
Phase 6's, alongside the write-seam invariant, and the decision document
records it as an obligation there.
"""

import ast
import fcntl
import os
import pty
import shutil
import struct
import subprocess
import tempfile
import termios
import threading
import unittest

import _support as S

S.import_core()

import inventory  # noqa: E402
import manifest  # noqa: E402
import records  # noqa: E402

# The costumes an interactive core would wear. `input()` needs no import, and
# `sys` is on the core's stdlib allowlist, so neither `input(...)` nor
# `sys.stdin` is visible to the import audit — which is the hole this lint
# closes. `getpass` would be caught by the import allowlist as well; it is
# detected here too so the lint stands on its own.
PROMPT_CALL = "interactive-prompt"
STDIN_READ = "standard-input-read"
TTY_BRANCH = "tty-branch"
CREDENTIAL_PROMPT = "credential-prompt"

PROMPT_BUILTINS = ("input", "raw_input")
GETPASS = "getpass"

# Sites in the core wearing one of the four costumes above. Equality-checked in
# both directions like the core's failed-probe allowlist: a new site fails, and
# so does a stale entry — an allowlist that outlives its exception quietly
# re-licenses the shape for whoever writes there next.
PROMPT_LINT_ALLOWLIST = {}

# A legitimate use of the child's standard input, planted as the false-positive
# control for the lint. This is what `paths` really does: spawn git, hand it a
# pipe, feed it on a thread. Nothing here asks a human anything.
LEGITIMATE_STDIN_PLUMBING = (
    "import subprocess\n"
    "def _run(cwd, args, stdin=None):\n"
    "    child = subprocess.Popen(args, cwd=cwd, stdin=subprocess.PIPE)\n"
    "    child.stdin.write(stdin or b'')\n"
    "    child.stdin.close()\n"
    "    return child.wait(timeout=30)\n"
)

# The ADR-11 state machine, and the three modules it imports today. Checked as
# an equality because a fourth import is a change worth seeing — **not because
# these three are pure.** `manifest` itself imports `os`, `jsonio` and `paths`,
# so this is a tripwire on one file's own import statements and never a
# statement about what the state machine can reach through them (T7).
STATE_MACHINE = "records.py"
STATE_MACHINE_IMPORTS = ("findings", "manifest", "text")

# The names that reach the filesystem: the builtin that opens a file, the
# stdlib module that moves and removes them, and the core's two writers. A
# finite vocabulary, applied to one module's own source — which is the whole of
# what the lint below inspects, and less than the decision document originally
# claimed for it (CORRECTION, 2026-08-14).
WRITE_CAPABILITIES = ("atomic", "jsonio", "open", "os")

# Where the guarantee actually lives, named here so the pointer is an object a
# test can check rather than a sentence in a comment. The test named below
# parses that file and asserts this really is a test in it, so a rename over
# there cannot quietly leave this file pointing at nothing.
BEHAVIOURAL_GUARANTEE = (
    "test_records.py",
    "ConfirmedRecordIsNeverDeletedTest",
    "test_the_record_set_is_read_and_never_edited",
)

# The shape that defeats the lint below, kept as a **false-green regression
# fixture** rather than closed by another detector branch (T7). Every import
# the state machine is asserted to have is here, and `os` arrives as an alias
# of `manifest`'s own — so the import set is preserved, no capability word
# appears, and `filesystem.remove` is nonetheless the real `os.remove`.
ALIAS_THROUGH_A_PURE_LOOKING_IMPORT = (
    "import findings\n"
    "import text\n"
    "from manifest import os as filesystem\n"
    "def promote(record, path):\n"
    "    filesystem.remove(path)\n"
)

# A module that only reads a record, planted as the false-positive control for
# the capability reading. The state machine does exactly this on every call, so
# a detector that flagged it would make the rule unimplementable.
LEGITIMATE_STATE_READ = (
    "import findings\n"
    "import manifest\n"
    "import text\n"
    "def is_confirmed(record):\n"
    "    return record.get('state') == 'confirmed'\n"
    "def severity(record):\n"
    "    return 'error' if record['state'] == 'confirmed' else 'warn'\n"
)

# The verbs that exist today. `generate` is a Phase-1 stub, so it is left out
# rather than fixtured — see the header.
LIVE_VERBS = ("scan", "check", "doctor")

# What the interpreter is asked about fd 0, as the independent oracle for T5.
ISATTY_PROBE = "import sys; print(sys.stdin.isatty())"

# A window size no pty is given by default, stamped on the fixture's terminal so
# the T6 oracle can say **which** terminal the child reached, not merely that it
# reached one.
TERMINAL_ROWS = 7
TERMINAL_COLUMNS = 13

# What the interpreter is asked about `/dev/tty`, as the independent oracle for
# T6. `/dev/tty` is the **controlling terminal**, which is not fd 0 and not
# inherited from fd 0 — so this asks the one question the isatty probe cannot.
CONTROLLING_TERMINAL_PROBE = (
    "import fcntl, os, struct, sys, termios\n"
    "try:\n"
    "    handle = os.open('/dev/tty', os.O_RDONLY)\n"
    "except OSError as exc:\n"
    "    sys.stdout.write('unavailable errno=%d\\n' % exc.errno)\n"
    "else:\n"
    "    packed = fcntl.ioctl(handle, termios.TIOCGWINSZ, b'\\0' * 8)\n"
    "    rows, columns = struct.unpack('hhhh', packed)[:2]\n"
    "    sys.stdout.write('open rows=%d columns=%d\\n' % (rows, columns))\n"
    "    os.close(handle)\n"
)
NO_CONTROLLING_TERMINAL = b"unavailable errno="
THE_FIXTURE_TERMINAL = b"open rows=%d columns=%d\n" % (TERMINAL_ROWS, TERMINAL_COLUMNS)

# Appended to the terminal transcript when the drain below never reached end of
# file, so a reading taken over a pump that was still running fails the
# emptiness assertion instead of passing as "the child wrote nothing".
PUMP_NEVER_FINISHED = b"<the terminal drain never reached end of file>"


def _take_the_controlling_terminal():
    """Make fd 0 — the fixture's pty slave — this child's controlling terminal.

    **This is the whole of the defect this file shipped.**
    `subprocess.run(stdin=slave)` sets **fd 0 and nothing else**: it never calls
    `setsid()` or `TIOCSCTTY`, so the child keeps the *parent's* controlling
    terminal. `/dev/tty` is the controlling terminal, not fd 0, so both
    arrangements always agreed about it — on a runner with a terminal both
    opened the runner's, and on a runner without one (CI, and this project's own
    agent sessions) both got `ENXIO`. A prompt that opened `/dev/tty` was
    therefore invisible to a fixture whose docstring claimed to cover it.

    `start_new_session=True` does the `setsid()` half in C before this runs, and
    this ioctl does the other half. Deliberately the **only** statement in the
    `preexec_fn`: it executes between `fork` and `exec`, where a lock some other
    thread held at fork time can never be released, so the drain thread is
    started only after the fork returns and nothing else Python-level runs here.
    """
    fcntl.ioctl(0, termios.TIOCSCTTY, 0)


def _drain(master, sink):
    """Collect everything the child writes to its terminal, until it is gone.

    **Not a convenience — the run's bound depends on it.** A child that writes
    to `/dev/tty` and is never drained wedges in the kernel at exit (macOS
    process state `E`), and **`SIGKILL` does not reap it** — verified directly.
    `subprocess.run(timeout=...)` would then time out, kill, and block forever
    in the `wait` that follows its own kill: the fixture's timeout defeated by
    the very defect it exists to catch. Reading the master keeps the child
    reapable, and the transcript is evidence besides — a prompt printed to the
    terminal is caught here rather than inferred from a timeout.

    Errors end the drain rather than being reported, because the two that can
    happen here — `EIO` and `EBADF` on a terminal whose last slave reference is
    gone — are how end of file arrives on a pty. A drain that ended without
    reaching it is reported instead, by the caller, from `is_alive()`.
    """
    while True:
        try:
            chunk = os.read(master, 4096)
        except OSError:
            return
        if not chunk:
            return
        sink.append(chunk)


def _close(descriptor):
    """Close a descriptor that may already have been taken away.

    Acquiring a pty as a controlling terminal **revokes the parent's slave
    descriptor** on macOS — verified: `os.fstat` on it afterwards raises
    `EBADF`. That is the kernel releasing the reference, which is also what lets
    the drain above reach end of file, so it is expected rather than a fault.
    """
    try:
        os.close(descriptor)
    except OSError:
        pass


def core_modules():
    return sorted(name for name in inventory.FILES if name.endswith(".py"))


def core_sources(directory=None, names=None):
    """{module: source} — the real thing the lint runs over.

    `directory` and `names` are parameters so the enumeration itself can be
    pointed at a planted module on disk (T2). Defaulted, they are the packaged
    core's own declared inventory — never a directory walk, so a stray file
    beside the core is not silently audited in place of one that is missing.
    """
    directory = S.CORE_DIR if directory is None else directory
    names = core_modules() if names is None else names
    return {
        module: S.read_text(os.path.join(directory, module)) for module in names
    }


def _attributed(tree, detect):
    """[(function, costume)] for every node `detect` names, by enclosing `def`.

    Attribution is by an explicit scope stack rather than `ast.walk`, which
    flattens the tree and loses exactly the information an allowlist is keyed
    on. A module-scope site attributes as `<module>`, so a bare `import
    getpass` at the top of a file is still a site with a name.
    """
    found = []

    def visit(node, enclosing):
        for child in ast.iter_child_nodes(node):
            name = enclosing
            if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)):
                name = child.name
            costume = detect(child)
            if costume is not None:
                found.append((name, costume))
            visit(child, name)

    visit(tree, "<module>")
    return found


def _sites(sources, detect):
    sites = {}
    for module in sorted(sources):
        for function, costume in _attributed(ast.parse(sources[module]), detect):
            sites[(module, function)] = costume
    return sites


def _prompt_costume(node):
    """Which of the four linted costumes, if any, this node wears."""
    if isinstance(node, ast.Call):
        func = node.func
        if isinstance(func, ast.Name) and func.id in PROMPT_BUILTINS:
            return PROMPT_CALL
        if isinstance(func, ast.Name) and func.id == "isatty":
            return TTY_BRANCH
        if isinstance(func, ast.Attribute) and func.attr == "isatty":
            return TTY_BRANCH
    if isinstance(node, ast.Attribute):
        base = node.value
        # **`sys.stdin`, not the word `stdin`.** The child's stdin is a pipe we
        # write to; ours is the only one a human could be at.
        if isinstance(base, ast.Name) and base.id == "sys" and node.attr == "stdin":
            return STDIN_READ
        if node.attr == GETPASS:
            return CREDENTIAL_PROMPT
    # There is no bare-`ast.Name` branch here, and its absence is a finding of
    # the mutation run rather than an oversight: deleting one reddened nothing,
    # because a module can only reach the name by importing it and the two
    # import branches below already flag that module. A branch of a guard that
    # no plant can reach is untested code inside the thing doing the testing.
    if isinstance(node, ast.Import):
        for alias in node.names:
            if alias.name.split(".")[0] == GETPASS:
                return CREDENTIAL_PROMPT
    if isinstance(node, ast.ImportFrom):
        if node.module and node.module.split(".")[0] == GETPASS:
            return CREDENTIAL_PROMPT
    return None


def bounded_prompt_sites(sources):
    """{(module, function): costume} — **the four costumes named below, and no
    others.**

    Read this as a lint, never as a proof of absence. What it detects is
    exactly:

    1. a call to a **name** that is `input` or `raw_input`;
    2. a call to anything **named** `isatty`, bare or as an attribute;
    3. the attribute expression `sys.stdin` — the base has to be the name
       `sys`, which is what keeps the child's pipe out of it (T3);
    4. `getpass` — imported by `import getpass` or `from getpass import ...`,
       or reached as an attribute of that name.

    **It cannot establish that no prompt exists.** Four shapes that ask a human
    something, or read the terminal, and go straight past every branch above:

        from sys import stdin; stdin.readline()
        ask = input; ask("confirm? ")
        open("/dev/tty").readline()
        os.read(0, 16)

    That is not a gap to be closed by adding branches — a name can be rebound
    and a file descriptor can be opened by number, so the set is unbounded and
    an enumeration of it would end *feeling* complete. It is covered instead by
    `StandardInputChangesNothingTest`, which never looks at syntax at all —
    **for the three live verbs it runs, and only there**, which is that
    fixture's own stated bound and not a second unbounded claim in its place.

    The one aggregation the lint calls, so pointing it at a planted module
    exercises the same code path as pointing it at the core.
    """
    return _sites(sources, _prompt_costume)


def imported_modules(source):
    """Every top-level module `source` imports, by the module's own name.

    `from os import path` counts as reaching `os`, because the capability
    question is *what can this module get at*, not *what did it bind the name
    to*.
    """
    found = set()
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Import):
            for alias in node.names:
                found.add(alias.name.split(".")[0])
        elif isinstance(node, ast.ImportFrom) and node.module:
            found.add(node.module.split(".")[0])
    return sorted(found)


def bounded_write_capability_names(source):
    """Sorted `WRITE_CAPABILITIES` names appearing **in `source` itself**.

    Read this as a lint. **It is not a no-write guarantee, and it cannot be
    one.** What it inspects is exactly the names written in one module's own
    source, in three shapes: an identifier used bare (`open(...)`, `os`), an
    attribute of one of those names (`os.rename`, `jsonio.dumps`), and an
    import of one.

    **Why the stronger claim does not follow.** Purity is not transitive
    through a re-export, so a module whose name is on the allowed import list
    can hand over a capability this vocabulary forbids:

        from manifest import os as filesystem   # import set unchanged
        filesystem.remove(path)                 # no capability name appears

    `manifest` imports `os` at module scope, so that alias is the real `os`
    module and `remove` is the real `remove`. The import set stays
    `('findings', 'manifest', 'text')` and every branch above sees nothing.
    That is verified, not supposed —
    `test_the_alias_through_manifest_is_invisible_and_that_is_expected` plants
    it and asserts this function returns `[]`.

    **That is not a gap to be closed by adding branches.** The reach of a
    module is not bounded by the words in its source, so an enumeration of
    re-export paths would end *feeling* complete — which is the defect that
    already cost this file one audit and then its replacement's claim
    (DECISION-2026-08-14-audit-shape). The guarantee is behavioural and lives
    in `test_records.py`, in
    `ConfirmedRecordIsNeverDeletedTest.test_the_record_set_is_read_and_never_edited`:
    it snapshots the caller's own records and compares, so a promotion is
    caught however it is spelled.

    The one aggregation this lint calls, so pointing it at a planted module
    exercises the same code path as pointing it at the core.
    """
    found = set()
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Name) and node.id in WRITE_CAPABILITIES:
            found.add(node.id)
        elif isinstance(node, ast.Attribute) and node.attr in WRITE_CAPABILITIES:
            found.add(node.attr)
        elif isinstance(node, ast.Import):
            for alias in node.names:
                if alias.name.split(".")[0] in WRITE_CAPABILITIES:
                    found.add(alias.name.split(".")[0])
        elif isinstance(node, ast.ImportFrom) and node.module:
            if node.module.split(".")[0] in WRITE_CAPABILITIES:
                found.add(node.module.split(".")[0])
    return sorted(found)


class BoundedPromptLintTest(unittest.TestCase):
    """ADR-11: no prompt and no TTY branch — asserted to the lint's bound.

    The class name says *lint* because that is what this is. Every assertion
    below is a statement about the four costumes `bounded_prompt_sites`
    enumerates, over the core's declared inventory. None of them is a statement
    that the core cannot ask a human something; that claim would be ADR-28's
    banned shape, and the behavioural fixture further down is what stands in
    its place.
    """

    def test_no_core_module_wears_one_of_the_four_linted_costumes(self):
        self.assertEqual(
            PROMPT_LINT_ALLOWLIST,
            bounded_prompt_sites(core_sources()),
            "a core module calls `input`, branches on `isatty`, reads "
            "`sys.stdin` or reaches for `getpass` — ADR-11 has one code path "
            "with or without a TTY",
        )

    def test_the_aggregate_lint_reports_every_costume(self):
        """T1. The aggregation the assertion above calls, over a planted module
        wearing each costume, so a detector that stopped being collected fails
        here rather than leaving the whole class green."""
        planted = {
            "asks.py": (
                "def confirm(record):\n"
                "    answer = input('confirm this record? ')\n"
                "    return answer == 'y'\n"
            ),
            "reads.py": (
                "import sys\n"
                "def confirm(record):\n"
                "    return sys.stdin.read().strip() == 'y'\n"
            ),
            "terminal.py": (
                "import sys\n"
                "def promote(record):\n"
                "    if sys.stdout.isatty():\n"
                "        return 'confirmed'\n"
                "    return 'proposed'\n"
            ),
            # Two modules for `getpass`, and the split is load-bearing: the
            # first draft imported it *inside* the function that called it, so
            # the import branch and the attribute branch both attributed to the
            # same key and either could be deleted with nothing going red. The
            # module-level import and the call are separate sites here, and the
            # `from` form is a third module, so each branch is proven alone.
            "secret.py": (
                "import getpass\n"
                "def unlock():\n"
                "    return getpass.getpass('token: ')\n"
            ),
            "fromimport.py": (
                "from getpass import getpass as ask\n"
                "def unlock():\n"
                "    return ask('token: ')\n"
            ),
        }
        self.assertEqual(
            {
                ("asks.py", "confirm"): PROMPT_CALL,
                ("reads.py", "confirm"): STDIN_READ,
                ("terminal.py", "promote"): TTY_BRANCH,
                ("secret.py", "<module>"): CREDENTIAL_PROMPT,
                ("secret.py", "unlock"): CREDENTIAL_PROMPT,
                ("fromimport.py", "<module>"): CREDENTIAL_PROMPT,
            },
            bounded_prompt_sites(planted),
        )

    def test_the_lint_states_the_forms_it_cannot_see(self):
        """ADR-28, applied to this file's own wording.

        The bound is not a comment somebody may drop while editing: the four
        evading shapes are named in `bounded_prompt_sites`' docstring, and this
        asserts they are still named there. A lint whose stated bound quietly
        disappears becomes a claim of absence again, which is the defect that
        cost the promotion audit its life.
        """
        stated = bounded_prompt_sites.__doc__
        self.assertIn("cannot establish that no prompt exists", stated)
        for evading in ("from sys import stdin", "ask = input", "/dev/tty", "os.read(0"):
            self.assertIn(evading, stated, evading)

    def test_the_lint_does_not_flag_the_childs_standard_input(self):
        """T3, and the counter-weight to the plant above.

        A detector that flagged everything would satisfy that test just as
        well. This is the shape the core really contains — a pipe to git, fed
        on a thread — and it must come back clean, or `paths.py` could never
        pass the lint and the lint would have to be switched off.
        """
        self.assertEqual(
            {}, bounded_prompt_sites({"paths.py": LEGITIMATE_STDIN_PLUMBING})
        )

    def test_the_core_really_does_plumb_stdin(self):
        """Positive accounting: the clean result above is only informative if
        the core actually contains the shape that could have been flagged."""
        sources = core_sources()
        mentions = [name for name in sorted(sources) if "stdin" in sources[name]]
        self.assertTrue(
            mentions, "no core module mentions stdin — the lint is uninformative"
        )

    def test_the_lint_enumerates_the_whole_declared_inventory(self):
        sources = core_sources()
        self.assertEqual(core_modules(), sorted(sources))
        self.assertTrue(sources, "the lint ran over nothing")
        for module in sorted(sources):
            self.assertTrue(sources[module].strip(), module)


class TheEnumerationIsAuditedTooTest(unittest.TestCase):
    """T2 — the step that reads modules off disk, proven directly.

    Every planted self-check in `test_imports.py` hands the aggregation a
    dict, so `core_sources` — the "did we even look at this file" step — is
    covered only indirectly, by `test_inventory`'s drift gate. A lint pointed
    at a file that is not there reports nothing forever, so this plants a real
    file on disk and walks the whole path: read it, parse it, aggregate it.
    """

    def setUp(self):
        self.directory = tempfile.mkdtemp(prefix="steward-planted-%d-" % os.getpid())
        self.addCleanup(shutil.rmtree, self.directory, True)

    def plant(self, name, source):
        with open(os.path.join(self.directory, name), "w", encoding="utf-8") as handle:
            handle.write(source)

    def test_a_module_planted_on_disk_reaches_the_aggregation(self):
        source = (
            "def confirm(record):\n"
            "    if input('confirm? ') == 'y':\n"
            "        record['state'] = 'confirmed'\n"
            "    return record\n"
        )
        self.plant("planted.py", source)
        sources = core_sources(self.directory, ("planted.py",))
        self.assertEqual({"planted.py": source}, sources)
        self.assertEqual(
            {("planted.py", "confirm"): PROMPT_CALL}, bounded_prompt_sites(sources)
        )

    def test_a_missing_module_faults_rather_than_reporting_nothing(self):
        """The failure mode this class exists for: an enumeration pointed at a
        name that is not there must not come back as an empty, clean audit."""
        with self.assertRaises(IOError):
            core_sources(self.directory, ("absent.py",))


class BoundedWriteCapabilityLintTest(unittest.TestCase):
    """A lint over `records.py`'s own source. **Not a no-write guarantee.**

    **The name is the fix.** This class used to be called
    `TheStateMachineCannotWriteAnythingTest`, and the decision document called
    its reading "a complete, decidable fact, unlike the audit you are
    deleting". The vocabulary is finite and the module is one — both true — and
    the conclusion still does not follow, because purity is not transitive
    through a re-export (T7). So the deleted audit's defect was reproduced *in
    the fix for it*, one refactor along:
    `test_the_alias_through_manifest_is_invisible_and_that_is_expected` is the
    plant that shows it, and it is kept green on purpose.

    **The bound, stated rather than implied (ADR-28).** Every assertion here is
    a statement about the names appearing in `records.py`'s own source. None of
    them is a statement that the state machine cannot write, or cannot promote
    a record: that claim would be ADR-28's banned shape, and it is not
    establishable from this file at all.

    **Where the guarantee is instead.** `BEHAVIOURAL_GUARANTEE` — the
    input-non-mutation snapshot, which enumerates no syntax and was verified to
    redden against `_key = "state"; record[_key] = CONFIRMED`, the shape that
    evaded the deleted audit, while every test in *this* file stayed green.
    Raising an alarm early is this lint's whole job.
    """

    def source(self):
        self.assertIn(
            STATE_MACHINE,
            core_modules(),
            "the state machine is not in the declared inventory — this class "
            "would be reading a file nobody ships",
        )
        return core_sources(names=(STATE_MACHINE,))[STATE_MACHINE]

    def test_the_state_machine_imports_exactly_the_three_named_modules(self):
        """Equality in both directions, as a tripwire and **not** as evidence
        of purity. A fourth import is a change worth a human's eye; the three
        already here are not thereby pure — `manifest` imports `os` — and the
        regression fixture below is what keeps that from being forgotten."""
        self.assertEqual(
            list(STATE_MACHINE_IMPORTS),
            imported_modules(self.source()),
            "the state machine's import set changed — worth reading, though "
            "an unchanged set establishes nothing on its own (T7)",
        )

    def test_the_state_machine_names_no_way_to_reach_the_filesystem(self):
        """The lint's own assertion, and it says *names*, deliberately.

        A clean result here means no line of `records.py` writes one of the
        four words. It does not mean the module cannot reach a writer, and the
        message says so rather than letting a green tick be read as proof.
        """
        self.assertEqual(
            [],
            bounded_write_capability_names(self.source()),
            "the state machine names a writer; ADR-11 leaves `confirmed` to a "
            "human editing the tracked manifest, and a record it could persist "
            "is a record it could promote. (A clean run of this assertion is "
            "not the converse: see BEHAVIOURAL_GUARANTEE.)",
        )

    def test_the_detector_sees_every_capability_it_names(self):
        """T1 for this reading: the real aggregation, over a planted module
        that has all four capabilities, so a name that stopped being collected
        fails here rather than leaving the two assertions above green."""
        planted = (
            "import atomic\n"
            "import jsonio\n"
            "import os\n"
            "def promote(record, path):\n"
            "    with open(path, 'w') as handle:\n"
            "        handle.write(jsonio.dumps(record))\n"
            "    os.rename(path, path + '.bak')\n"
            "    atomic.write(path, b'')\n"
        )
        self.assertEqual(
            sorted(WRITE_CAPABILITIES), bounded_write_capability_names(planted)
        )

    def test_a_module_that_only_reads_a_record_is_not_flagged(self):
        """The counter-weight: a detector that flagged everything would satisfy
        the assertions above just as well, and the state machine compares a
        record's state against `confirmed` on every call."""
        self.assertEqual([], bounded_write_capability_names(LEGITIMATE_STATE_READ))
        self.assertEqual(
            list(STATE_MACHINE_IMPORTS), imported_modules(LEGITIMATE_STATE_READ)
        )

    def test_the_state_machine_really_does_compare_against_confirmed(self):
        """Positive accounting for the control above: the shape that must not
        be flagged is one the module actually contains."""
        self.assertIn(records.CONFIRMED, self.source())

    def test_the_alias_through_manifest_is_invisible_and_that_is_expected(self):
        """**A false-green regression fixture. The green is the finding.**

        This plants a module that removes a file through an alias of
        `manifest`'s own `os`, and asserts the lint reports **nothing** — which
        is what a lint over one file's own words can do, and the reason this
        class is named for a bound instead of a guarantee (T7).

        **Do not "fix" this by adding a detector branch.** Two syntactic
        oracles have already been written here, each claiming an absence a
        partial look cannot establish, and the second was written *as the fix
        for the first* — a third enumeration would make the same wrong claim
        feel complete, which ADR-28 bans and
        DECISION-2026-08-14-audit-shape settles. If a future change genuinely
        widens the lint, this assertion is where that decision has to be
        argued: change it deliberately, and restate the bound in
        `bounded_write_capability_names` at the same time. What catches the
        promotion this alias could carry is `BEHAVIOURAL_GUARANTEE`, which
        looks at values rather than words.
        """
        self.assertEqual(
            list(STATE_MACHINE_IMPORTS),
            imported_modules(ALIAS_THROUGH_A_PURE_LOOKING_IMPORT),
            "the plant no longer preserves the asserted import set, so it no "
            "longer demonstrates anything about that assertion",
        )
        self.assertEqual(
            [],
            bounded_write_capability_names(ALIAS_THROUGH_A_PURE_LOOKING_IMPORT),
            "the lint now flags the alias-through-`manifest` shape. That is a "
            "widening of a bound this file states in prose and in ADR-28 "
            "terms; if it was deliberate, restate the bound. If it was an "
            "arms-race branch, it is the third one and the decision document "
            "rejected it twice.",
        )

    def test_the_alias_the_lint_cannot_see_is_a_real_capability(self):
        """Positive accounting for the fixture above, and the load-bearing
        half of it: a plant the lint misses proves nothing unless the plant
        would actually work.

        Asked of the imported module itself rather than of its source, because
        the question is what the alias *binds to* — `manifest.os` is the real
        `os` module, so `from manifest import os as filesystem` hands over the
        real `os.remove`. This is also why the import-set equality above is a
        tripwire and not a purity reading.
        """
        self.assertIn(
            "os",
            imported_modules(core_sources(names=("manifest.py",))["manifest.py"]),
            "`manifest` no longer imports `os`, so the plant above may no "
            "longer describe a reachable capability — re-derive the bound",
        )
        self.assertIs(
            os,
            manifest.os,
            "`manifest.os` is not the stdlib `os` module, so the alias in the "
            "plant would not reach the filesystem after all",
        )

    def test_the_named_behavioural_guarantee_exists(self):
        """The pointer this class hands off to, checked rather than trusted.

        Every docstring above answers "then what *is* the guarantee?" with one
        name. A name in prose rots silently, and a lint left pointing at a
        deleted test is exactly the state this whole file exists to prevent —
        so the test is located by parsing `test_records.py` and looking for the
        class and method by name.
        """
        module, class_name, method = BEHAVIOURAL_GUARANTEE
        tree = ast.parse(S.read_text(os.path.join(S.TESTS_DIR, module)))
        classes = [
            node
            for node in tree.body
            if isinstance(node, ast.ClassDef) and node.name == class_name
        ]
        self.assertEqual(
            1, len(classes), "%s does not define %s" % (module, class_name)
        )
        methods = [
            node.name
            for node in classes[0].body
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
        ]
        self.assertIn(
            method,
            methods,
            "%s.%s is gone. It is the behavioural assertion this lint defers "
            "to; without it the guarantee is a sentence in a docstring."
            % (class_name, method),
        )

    def test_the_lint_states_that_it_is_not_a_no_write_guarantee(self):
        """ADR-28 applied to this lint's own wording, exactly as
        `test_the_lint_states_the_forms_it_cannot_see` does for the other one.

        The bound is not a comment somebody may drop while editing: the
        disclaimer, the evading shape and the name of the real guarantee are
        asserted to still be in the docstring a reader would consult.
        """
        stated = bounded_write_capability_names.__doc__
        self.assertIn("not a no-write guarantee", stated)
        self.assertIn("Purity is not transitive", stated)
        self.assertIn("from manifest import os as filesystem", stated)
        self.assertIn(BEHAVIOURAL_GUARANTEE[2], stated)


class TheStateMachineReturnsNoRecordTest(unittest.TestCase):
    """The behavioural half of P3.7(b): nothing this module returns is a record.

    The reading above is structural, and structure is where a promotion would
    hide. This is the complement — every value the state machine hands back is
    a finding or a cardinality, so there is nothing for a caller to persist
    even if it wanted to.
    """

    FINDING_KEYS = {"id", "severity", "tier", "claim", "observed", "where",
                    "confidence"}
    CARDINALITY_KEYS = {"check", "examined", "reason", "declaredExternal"}

    def test_a_finding_is_a_finding_and_never_a_record(self):
        item = records.finding_for(
            {"value": "docs/x.md", "state": "confirmed"}, "paths", 0, False
        )
        self.assertTrue(set(item) <= self.FINDING_KEYS, sorted(item))
        self.assertNotIn("state", item)
        self.assertNotIn("value", item)

    def test_a_record_set_hands_back_findings_and_a_cardinality_only(self):
        claims = [
            {"value": "npm test", "state": "proposed", "resolution": "repo-declared"}
        ]
        found, examined = records.record_findings(claims, "commands", set())
        for item in found:
            self.assertTrue(set(item) <= self.FINDING_KEYS, sorted(item))
        self.assertEqual(self.CARDINALITY_KEYS, set(examined))

    def test_no_derived_reading_could_be_stored_as_a_state(self):
        """The two halves meet here: the machine cannot write, and what it
        derives could not be written even by hand."""
        for state in records.DERIVED_STATES:
            self.assertNotEqual(records.CONFIRMED, state)


class StandardInputChangesNothingTest(unittest.TestCase):
    """P3.7's own specified check: closed stdin and a terminal give the same
    bytes.

    "`generate` behaves identically with or without a TTY" (ADR-11) is a claim
    about behavior, and the lint above cannot reach it: a name can be rebound,
    and `/dev/tty` and `os.read(0, ...)` reach the terminal without naming
    anything the lint knows. This runs the real verbs, as a child process, with
    `-B`, under each of the two arrangements, and compares stdout, stderr and
    the exit status.

    **The two arrangements, precisely, because the difference between them is
    the whole instrument (T6).** Both children run in their **own session**, so
    neither inherits the test runner's terminal and the fixture means the same
    thing on a developer's machine and in CI. The closed run then has
    `/dev/null` on fd 0 and **no controlling terminal at all**. The terminal run
    has the fixture's pty slave on fd 0 **and installed as its controlling
    terminal**, so `/dev/tty` inside the child is that pty and nothing else —
    which is what `test_the_two_arrangements_really_differ_on_the_controlling_terminal`
    asserts of an independent oracle rather than leaving to be assumed.

    **A prompt has three failure shapes here and each is caught by name.**
    Under the closed run it reads EOF and the output diverges. Under the
    terminal run it blocks, so the run is bounded and a timeout is reported as
    the same defect rather than as a hung suite. And if it prints its question
    without waiting for an answer, the terminal transcript is not empty —
    nothing the core prints goes anywhere but its two pipes.

    **What this does not cover, stated rather than implied (ADR-28):**
    `generate` — a Phase-1 stub, so a fixture over it would assert that two runs
    of nothing agree; any repository shaped unlike the one built in `setUp`; and
    any channel to a human that is neither fd 0 nor the controlling terminal.
    """

    # Generous, because it is only ever spent on the failing path: the whole
    # point is to distinguish "it finished" from "it is waiting for a human".
    TIMEOUT_SECONDS = 60

    def setUp(self):
        self.root = S.make_git_repo()
        self.addCleanup(shutil.rmtree, self.root, True)
        self.write("package.json", '{"scripts": {"check": "tsc --noEmit"}}\n')
        self.write("AGENTS.md", "# agents\n")
        self.write("docs/architecture.md", "# architecture\n")
        S.git(self.root, "add", "-A")
        S.git(self.root, "commit", "-q", "-m", "fixture")

    def write(self, relpath, body="x\n"):
        full = os.path.join(self.root, relpath.replace("/", os.sep))
        directory = os.path.dirname(full)
        if directory:
            os.makedirs(directory, exist_ok=True)
        with open(full, "w", encoding="utf-8") as handle:
            handle.write(body)
        return full

    def _start(self, command, stdin, preexec_fn=None):
        """Fork/exec `command` with `stdin` on fd 0, in **its own session**.

        `start_new_session=True` is on both arrangements deliberately. The
        closed run needs it as much as the terminal run: without it the child
        inherits whatever controlling terminal the *test runner* had, `/dev/tty`
        opens in both arrangements, and the comparison is again between two
        arrangements that agree. With it, "closed" means *no terminal is
        reachable at all* — the same thing on a developer's terminal and in CI.

        `PYTHONDONTWRITEBYTECODE` is popped for the reason `_support.run_core`
        pops it: an ambient copy in the environment would make `-B` — and every
        no-write assertion that leans on it — vacuously true.
        """
        env = dict(os.environ)
        env.pop("PYTHONDONTWRITEBYTECODE", None)
        return subprocess.Popen(
            command,
            cwd=self.root,
            env=env,
            stdin=stdin,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            start_new_session=True,
            preexec_fn=preexec_fn,
        )

    def _collect(self, child, command, what):
        """Wait for `child` within the bound, or fail naming what blocked.

        The second `communicate` carries no timeout of its own, and that is safe
        for exactly one reason: on the terminal path the drain is running, so a
        child that wrote to its terminal is reapable. Without it `SIGKILL` does
        not settle the matter — see `_drain`.
        """
        try:
            stdout, stderr = child.communicate(timeout=self.TIMEOUT_SECONDS)
        except subprocess.TimeoutExpired:
            child.kill()
            stdout, stderr = child.communicate()
            raise AssertionError(
                "%s did not finish within %ds with %s on standard input. A "
                "verb that blocks for input is the defect this fixture is for: "
                "under a terminal a prompt does not diverge, it waits "
                "(ADR-11)." % (" ".join(command), self.TIMEOUT_SECONDS, what)
            )
        return subprocess.CompletedProcess(command, child.returncode, stdout, stderr)

    def closed(self, command):
        """`/dev/null` on fd 0, in a session with no controlling terminal.

        The plan's phrase is "with stdin closed". This is the portable form of
        it: nothing is there, it is not a terminal, and — since the session is
        new — `/dev/tty` resolves to nothing either.
        """
        return self._collect(
            self._start(command, subprocess.DEVNULL), command, "/dev/null"
        )

    def on_a_terminal(self, command):
        """`(result, terminal transcript)` with the fixture's pty as fd 0 **and**
        as the child's controlling terminal.

        The pty is stamped with a window size no terminal is given by default,
        which is what lets the T6 oracle say *which* terminal `/dev/tty` reached
        rather than merely that it reached one.

        **The drain thread starts after the fork, never before.** `preexec_fn`
        runs between `fork` and `exec`; in a parent that already has threads,
        any lock one of them held at fork time is held forever in the child.
        Starting the drain only once `Popen` has returned keeps the fork
        single-threaded, and it is still running for the whole of the wait,
        which is where `_drain` says it has to be.
        """
        master, slave = pty.openpty()
        fcntl.ioctl(
            slave,
            termios.TIOCSWINSZ,
            struct.pack("hhhh", TERMINAL_ROWS, TERMINAL_COLUMNS, 0, 0),
        )
        written = []
        pump = None
        blocked = None
        result = None
        try:
            child = self._start(command, slave, _take_the_controlling_terminal)
            pump = threading.Thread(target=_drain, args=(master, written))
            pump.daemon = True
            pump.start()
            try:
                result = self._collect(child, command, "a controlling terminal")
            except AssertionError as exc:
                # Held, never swallowed: it is re-raised below with what the
                # child printed to the terminal, which is only complete once
                # the drain has finished. A timeout that says *it waited* and a
                # timeout that says *it printed `Proceed with scan? [y/N]` and
                # then waited* are the same verdict and very different
                # evidence, and this project prefers the one it saw.
                blocked = exc
        finally:
            # Before the join: the drain reaches end of file when the terminal's
            # last slave reference goes, and on a path where the ioctl never ran
            # this is the reference.
            _close(slave)
            if pump is not None:
                pump.join(self.TIMEOUT_SECONDS)
                if pump.is_alive():
                    written.append(PUMP_NEVER_FINISHED)
            _close(master)
        transcript = b"".join(written)
        if blocked is not None:
            if transcript:
                raise AssertionError(
                    "%s It printed %r to its terminal first." % (blocked, transcript)
                )
            raise AssertionError(
                "%s It printed nothing to its terminal." % (blocked,)
            )
        return result, transcript

    def core_command(self, verb):
        # `-B` is not optional: bare `python3` writes `__pycache__` beside the
        # core and breaks the read-only guarantee the whole suite asserts.
        return [S.MODERN_PYTHON, "-B", S.CORE_DIR, verb]

    def run_closed(self, verb):
        return self.closed(self.core_command(verb))

    def run_on_a_terminal(self, verb):
        return self.on_a_terminal(self.core_command(verb))

    def assert_produced_a_report(self, verb, result):
        """T4. Two empty outputs match; this is what says they were not empty."""
        stderr = result.stderr.decode("utf-8", "replace")
        stdout = result.stdout.decode("utf-8", "replace")
        self.assertEqual(0, result.returncode, stderr)
        self.assertNotIn("Traceback", stderr, "a predicted state printed a crash")
        self.assertIn("the-steward %s" % verb, stdout, "no report was printed")
        self.assertIn(
            "items examined",
            stdout,
            "%s printed no cardinality line — a byte comparison over two "
            "empty reports proves nothing (ADR-30)" % verb,
        )

    def test_every_live_verb_gives_the_same_bytes_closed_and_on_a_terminal(self):
        for verb in LIVE_VERBS:
            with self.subTest(verb=verb):
                closed = self.run_closed(verb)
                on_a_terminal, printed_to_the_terminal = self.run_on_a_terminal(verb)
                self.assert_produced_a_report(verb, closed)
                self.assert_produced_a_report(verb, on_a_terminal)
                self.assertEqual(
                    b"",
                    printed_to_the_terminal,
                    "`%s` wrote to its controlling terminal. Nothing the core "
                    "prints goes anywhere but the two pipes, so a byte on the "
                    "terminal is a prompt or a TTY branch (ADR-11)." % verb,
                )
                self.assertEqual(
                    closed.stdout,
                    on_a_terminal.stdout,
                    "`%s` printed different bytes with a terminal on standard "
                    "input — ADR-11 has one code path with or without a TTY"
                    % verb,
                )
                self.assertEqual(
                    closed.stderr, on_a_terminal.stderr, "%s: stderr differed" % verb
                )
                self.assertEqual(
                    closed.returncode,
                    on_a_terminal.returncode,
                    "%s: the exit status differed" % verb,
                )

    def test_the_two_arrangements_really_differ_on_the_terminal_question(self):
        """T5, asked of an **independent oracle**.

        If `pty.openpty()` did not put a terminal on fd 0, the test above would
        compare two identical non-terminal runs and could not see a TTY branch
        at all. The interpreter is asked what it sees, because asking the code
        under test would let the subject decide whether its own assertion runs.
        """
        probe = [S.MODERN_PYTHON, "-B", "-c", ISATTY_PROBE]
        closed = self.closed(probe)
        on_a_terminal, _ = self.on_a_terminal(probe)
        for result in (closed, on_a_terminal):
            self.assertEqual(
                0, result.returncode, result.stderr.decode("utf-8", "replace")
            )
        self.assertEqual(b"False\n", closed.stdout, "the closed run saw a terminal")
        self.assertEqual(
            b"True\n",
            on_a_terminal.stdout,
            "the pty fixture is not a terminal — the comparison above is "
            "between two identical arrangements and proves nothing",
        )

    def test_the_two_arrangements_really_differ_on_the_controlling_terminal(self):
        """T6, asked of the same independent oracle as T5, about `/dev/tty`.

        The `isatty` control above is necessary and **demonstrably not
        sufficient**: it was green for the whole time the fixture could not see
        a `/dev/tty` prompt at all, because `isatty` asks about fd 0 and
        `/dev/tty` is the controlling terminal, which fd 0 does not determine.
        So this asks the interpreter — not the code under test — the question
        the comparison actually turns on, and asks it of **both** arrangements:
        the answers must differ, or the comparison is between two identical
        runs and a regression in the fixture would be silent rather than red.

        The terminal answer is checked by **window size**, not by "it opened":
        a `/dev/tty` that opened the *runner's* terminal would satisfy a
        weaker assertion, and that is exactly the shape of the original defect.
        7x13 is the fixture's own pty and nothing else's.
        """
        probe = [S.MODERN_PYTHON, "-B", "-c", CONTROLLING_TERMINAL_PROBE]
        closed = self.closed(probe)
        on_a_terminal, _ = self.on_a_terminal(probe)
        for result in (closed, on_a_terminal):
            self.assertEqual(
                0, result.returncode, result.stderr.decode("utf-8", "replace")
            )
        self.assertTrue(
            closed.stdout.startswith(NO_CONTROLLING_TERMINAL),
            "the closed run reached a controlling terminal (%r), so a prompt "
            "that opens `/dev/tty` would find one in both arrangements and "
            "diverge in neither" % closed.stdout,
        )
        self.assertEqual(
            THE_FIXTURE_TERMINAL,
            on_a_terminal.stdout,
            "`/dev/tty` in the terminal run is not the fixture's pty, so the "
            "two arrangements agree about it and the comparison above cannot "
            "see a prompt that opens it",
        )

    def test_the_fixture_repository_gives_the_scanner_something_to_report(self):
        """T4 again, for the one verb that has real findings today. Without it,
        `scan`'s two runs could agree over a report with no finding in it."""
        result = self.run_closed("scan")
        stdout = result.stdout.decode("utf-8", "replace")
        self.assertIn("Findings:", stdout, "the scan reported nothing at all")
        self.assertIn(
            "command-inferred",
            stdout,
            "the fixture declares no command — the scan had nothing to infer",
        )


if __name__ == "__main__":
    unittest.main()
