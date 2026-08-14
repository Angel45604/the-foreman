"""P1.7 — the import audit, and issue #29 independence.

ADR-1  : zero third-party dependencies. At the 3.9 floor there is no `tomllib`
         and no `yaml`, and an opportunistic `import yaml` would succeed on
         3.13.5 and fail on 3.9.6 — interpreter-dependent behavior in a
         determinism tool.
ADR-18 : every child process the core spawns is `git`, with an argument vector,
         an explicit timeout and an explicit output cap. Never a shell string.
#29    : no imports, requires or shell-outs between `the-steward` and any
         sibling skill, in either direction.
"""

import ast
import os
import shutil
import subprocess
import sys
import unittest

import _support as S

S.import_core()

import inventory  # noqa: E402

# Every stdlib module the core is allowed to reach for. The list is explicit so
# that adding an import is a deliberate act reviewed as a diff, and so that a
# third-party import cannot arrive by accident.
ALLOWED_STDLIB = {
    "ast",
    "errno",
    "hashlib",
    "json",
    "os",
    "re",
    "shutil",
    "stat",
    "subprocess",
    "sys",
    "tempfile",
    # ADR-18's cap has to bound what is **read**, and both pipes at once. One
    # thread per pipe plus one feeding stdin is the only arrangement in which
    # no ordering of child and parent can block on the other, so `wait(timeout)`
    # stays the single bound on the run. `selectors` was the alternative and is
    # narrower: it cannot pump stdin and both outputs on Windows at all.
    "threading",
    "traceback",
}

SIBLING_SKILLS = ("the-foreman", "codex-gate", "handoff", "keep-it-simple",
                  "the-cartographer")

ISOLATION_ENV = "STEWARD_ISOLATION_CHILD"


def core_modules():
    return sorted(
        name for name in inventory.FILES if name.endswith(".py")
    )


def core_sources():
    """{module: source} — the real thing every structural audit runs over.

    Taken as a parameter by the audits rather than read inside them, so each
    audit can also be pointed at a planted module and shown to still report.
    An audit that only ever sees clean code cannot tell you it still works.
    """
    return {
        module: S.read_text(os.path.join(S.CORE_DIR, module))
        for module in core_modules()
    }


def imported_names(source):
    """Top-level module names this source imports."""
    names = set()
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Import):
            for alias in node.names:
                names.add(alias.name.split(".")[0])
        elif isinstance(node, ast.ImportFrom):
            if node.level:
                raise AssertionError("relative import: flat absolute only (ADR-1)")
            if node.module:
                names.add(node.module.split(".")[0])
    return names


class ImportAuditTest(unittest.TestCase):
    def test_every_import_is_stdlib_or_a_core_module(self):
        core_names = {name[:-3] for name in core_modules()}
        for module in core_modules():
            source = S.read_text(os.path.join(S.CORE_DIR, module))
            for name in sorted(imported_names(source)):
                self.assertTrue(
                    name in ALLOWED_STDLIB or name in core_names,
                    "%s imports %r, which is neither allowed stdlib nor a core "
                    "module" % (module, name),
                )

    def test_no_import_is_third_party(self):
        """The named hazards, by name, so a regression fails loudly."""
        forbidden = {"yaml", "tomllib", "toml", "requests", "jsonschema", "pytest"}
        for module in core_modules():
            source = S.read_text(os.path.join(S.CORE_DIR, module))
            self.assertEqual(
                set(), imported_names(source) & forbidden, module
            )

    def test_imports_are_flat_and_absolute(self):
        for module in core_modules():
            source = S.read_text(os.path.join(S.CORE_DIR, module))
            imported_names(source)  # raises on a relative import

    def test_the_core_declares_no_package(self):
        """`python3 -B tools/steward` runs the directory, so sys.path[0] is the
        directory itself and flat absolute imports resolve. An __init__.py
        would make it a package and break that."""
        self.assertFalse(os.path.exists(os.path.join(S.CORE_DIR, "__init__.py")))


class SubprocessDisciplineTest(unittest.TestCase):
    """ADR-18: the only child process is git."""

    def spawn_sites(self, source):
        """(enclosing def name, call node) for every spawn in `source`.

        One parse, and the tree is walked with an explicit scope stack:
        `ast.walk` flattens it, and re-parsing to recover the enclosing `def`
        would compare nodes from two different trees and silently find none —
        the audit would then pass by never checking anything.
        """
        sites = []

        def is_spawn(node):
            func = node.func
            name = getattr(func, "attr", getattr(func, "id", None))
            if name in ("run", "Popen", "call", "check_output", "check_call"):
                base = getattr(func, "value", None)
                return isinstance(base, ast.Name) and base.id == "subprocess"
            return name in ("system", "popen", "execv", "execve", "spawnv")

        def visit(parent, enclosing):
            for child in ast.iter_child_nodes(parent):
                if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    visit(child, child.name)
                    continue
                if isinstance(child, ast.Call) and is_spawn(child):
                    sites.append((enclosing, child))
                visit(child, enclosing)

        visit(ast.parse(source), "<module>")
        return sites

    def spawn_calls(self, source):
        return [call for _function, call in self.spawn_sites(source)]

    def test_only_one_module_spawns_anything(self):
        spawners = []
        for module in core_modules():
            source = S.read_text(os.path.join(S.CORE_DIR, module))
            if self.spawn_calls(source):
                spawners.append(module)
        self.assertEqual(["paths.py"], spawners)

    def timed_waits(self, source, function):
        """`.wait(timeout=…)` calls inside `function`, with a real bound.

        A bare `wait()` does not count, and neither does `timeout=None`: both
        are unbounded, which is the thing ADR-18 forbids.
        """
        body = function_source(source, function)
        if body is None:
            return []
        bounded = []
        for node in ast.walk(ast.parse(body)):
            if not isinstance(node, ast.Call):
                continue
            if getattr(node.func, "attr", None) != "wait":
                continue
            for keyword in node.keywords:
                if keyword.arg != "timeout":
                    continue
                value = keyword.value
                if isinstance(value, ast.Constant) and value.value is None:
                    continue
                bounded.append(node)
        return bounded

    def test_every_spawn_is_git_with_an_argument_vector(self):
        source = S.read_text(os.path.join(S.CORE_DIR, "paths.py"))
        sites = self.spawn_sites(source)
        self.assertTrue(sites, "no spawn found — the audit would be vacuous")
        for function, call in sites:
            argument = call.args[0]
            while isinstance(argument, ast.BinOp):
                argument = argument.left
            self.assertIsInstance(
                argument, ast.List, "argv must be a list literal, never a shell string"
            )
            first = argument.elts[0]
            self.assertIsInstance(first, ast.Constant)
            self.assertEqual("git", first.value)
            # ADR-18 requires an explicit bound on the run, not a particular
            # spelling of one. `subprocess.run(timeout=…)` carries it on the
            # spawn; `Popen` cannot take it there at all, and puts it on the
            # `wait` in the same function. Anything with neither is unbounded.
            keywords = {kw.arg for kw in call.keywords}
            if "timeout" in keywords:
                continue
            self.assertNotEqual("<module>", function, "a spawn at module scope")
            self.assertTrue(
                self.timed_waits(source, function),
                "ADR-18 requires an explicit timeout: %s spawns git with no "
                "`timeout=` on the call and no bounded `wait(timeout=…)` in "
                "the same function" % function,
            )

    def test_the_timeout_audit_detects_an_unbounded_wait(self):
        """The audit's own non-vacuity, planted in a string: a `Popen` whose
        only wait is bare must not satisfy it."""
        planted = (
            "import subprocess\n"
            "def _run(args):\n"
            "    child = subprocess.Popen(['git'] + args)\n"
            "    child.wait()\n"
            "    return child\n"
        )
        self.assertEqual(["_run"], [name for name, _call in self.spawn_sites(planted)])
        self.assertEqual([], self.timed_waits(planted, "_run"))
        bounded = planted.replace("child.wait()", "child.wait(timeout=30)")
        self.assertTrue(self.timed_waits(bounded, "_run"))
        unbounded = planted.replace("child.wait()", "child.wait(timeout=None)")
        self.assertEqual([], self.timed_waits(unbounded, "_run"))

    def test_no_shell_true_anywhere(self):
        for module in core_modules():
            source = S.read_text(os.path.join(S.CORE_DIR, module))
            for node in ast.walk(ast.parse(source)):
                if isinstance(node, ast.keyword) and node.arg == "shell":
                    self.fail("%s passes shell= to a spawn" % module)

    def test_the_output_cap_is_a_module_constant_not_a_flag(self):
        import paths

        self.assertIsInstance(paths.GIT_OUTPUT_CAP_BYTES, int)
        self.assertGreater(paths.GIT_OUTPUT_CAP_BYTES, 0)


# ---------------------------------------------------------------------------
# ONE disease, and now both of its forms under one allowlist.
#
# The shape is "a failed or unsafe probe reported as a confident answer". It
# has arrived seven times in five layers, and it wears exactly two costumes:
#
#   RAW_STATUS  — `if code != 0: return <an answer>`, which reads a git
#                 invocation that failed as one of the caller's own answers;
#   SWALLOWED   — `except OSError: return <a falsy literal>`, which reads a
#                 filesystem call that failed the same way. `_entries`
#                 returned `[]` for an unreadable hooks directory and
#                 `os.path.isdir` returned False for it, so A3 reported *no
#                 directory at that path* about a clone nobody managed to look
#                 at.
#
# A second guard for the second costume would be a second thing to remember.
# One allowlist, keyed the same way, audited by the same meta-tests: a new site
# in either form fails, and so does an entry whose site is gone — an allowlist
# nobody prunes is how an exception becomes a habit.
# ---------------------------------------------------------------------------

RAW_STATUS = "raw-git-status"
SWALLOWED = "swallowed-os-error"

FAILED_PROBE_ALLOWLIST = {
    ("paths.py", "repo_root"): (
        RAW_STATUS,
        "`git rev-parse --show-toplevel` exits 128 both outside a repository "
        "and on a repository git cannot read. No status separates them, and "
        "answers=(0,) would make `not a repository` — a first-class reported "
        "state — unreachable.",
    ),
    ("gitstate.py", "last_commit_date"): (
        RAW_STATUS,
        "`git log -1` exits 128 for the real answer `no commit touches this "
        "path` in a repository with no commits, which is indistinguishable "
        "from an error by construction. answers=(0,) would exit 2 on every "
        "freshly initialised repository. The value is a date on a report "
        "line, never a verdict, so a missing one under-states and cannot "
        "manufacture a pass.",
    ),
}

DOCUMENTED_AMBIGUITY_MARKER = "DOCUMENTED AMBIGUITY"

# Handlers that catch these are catching *a probe that did not work*. A
# narrower `except ValueError` around a parse is a different thing and is not
# this audit's business.
PROBE_FAILURES = ("OSError", "IOError", "EnvironmentError", "Exception",
                  "BaseException")


def _is_falsy_literal(node):
    """`False` / `None` / `0` / `''` / `[]` / `()` / `{}` — written out.

    A **bare** `return` is deliberately not one of these: `_BoundedReader.run`
    ends a thread that way and `_feed` closes a pipe that way, and neither
    hands a caller a value to mistake for an answer. The disease is a handler
    that *manufactures* a negative, and manufacturing it takes typing it.
    """
    if isinstance(node, ast.Constant):
        return not node.value
    if isinstance(node, (ast.List, ast.Tuple, ast.Set)):
        return not node.elts
    if isinstance(node, ast.Dict):
        return not node.keys
    return False


def swallow_sites(source):
    """(function, handler) for every `except <probe failure>` that returns a
    manufactured negative **without looking at which error it was**.

    Consulting `errno` is the whole difference: `ENOENT` genuinely means *there
    is no directory there*, and answering `False` off it is a fact. Answering
    `False` off `EACCES` is a fabrication. A handler that reads `errno` has
    done the work; one that does not has not.
    """
    found = []

    def catches_a_probe_failure(handler):
        if handler.type is None:
            return True
        names = handler.type.elts if isinstance(handler.type, ast.Tuple) else [handler.type]
        return any(getattr(name, "id", None) in PROBE_FAILURES for name in names)

    def consults_errno(handler):
        for node in ast.walk(handler):
            if isinstance(node, ast.Attribute) and node.attr == "errno":
                return True
            if isinstance(node, ast.Name) and node.id == "errno":
                return True
        return False

    def visit(parent, enclosing):
        for child in ast.iter_child_nodes(parent):
            if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)):
                visit(child, child.name)
                continue
            if isinstance(child, ast.ExceptHandler):
                returns = [
                    node
                    for node in ast.walk(child)
                    if isinstance(node, ast.Return) and _is_falsy_literal(node.value)
                ]
                if returns and catches_a_probe_failure(child) and not consults_errno(child):
                    found.append((enclosing, child))
            visit(child, enclosing)

    visit(ast.parse(source), "<module>")
    return found


def call_sites(source, wanted):
    """(function name) for every call to `wanted`, bare or via `paths.`.

    Attribution is by enclosing `def`, walked with an explicit scope stack
    rather than `ast.walk`, which flattens the tree and loses exactly the
    information the allowlist is keyed on.
    """
    found = []

    def called_name(node):
        func = node.func
        if isinstance(func, ast.Attribute):
            base = func.value
            if isinstance(base, ast.Name) and base.id == "paths":
                return func.attr
            return None
        if isinstance(func, ast.Name):
            return func.id
        return None

    def visit(node, enclosing):
        for child in ast.iter_child_nodes(node):
            if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)):
                visit(child, child.name)
                continue
            if isinstance(child, ast.Call) and called_name(child) == wanted:
                found.append(enclosing)
            visit(child, enclosing)

    visit(ast.parse(source), "<module>")
    return found


def function_source(source, name):
    tree = ast.parse(source)
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name == name:
            return ast.get_source_segment(source, node)
    return None


def failed_probe_sites(sources):
    """{(module, function): costume} across `sources` — **both** detectors.

    The one aggregation the audit calls, so pointing it at a planted module
    exercises the same code path as pointing it at the core.
    """
    sites = {}
    for module in sorted(sources):
        source = sources[module]
        for function in call_sites(source, "git_output"):
            sites[(module, function)] = RAW_STATUS
        for function, _handler in swallow_sites(source):
            sites[(module, function)] = SWALLOWED
    return sites


class FailedProbeDisciplineTest(unittest.TestCase):
    """A failed probe must never be readable as an answer (ADR-13).

    This shape has arrived **seven** times in five layers, always looking
    local, and it has exactly two costumes:

        if code != 0:  return <a confident answer>     # git
        except OSError: return <a confident answer>    # the filesystem

    `paths.git_answered` fixed the *mechanism* for the first — the caller
    declares which statuses git uses as answers and everything else faults —
    but a mechanism nobody is forced to use is a convention, and conventions
    are what produced instances two through six. Instance seven arrived in the
    other costume, in a module the first audit did not look at, which is the
    argument for auditing the **disease** rather than one of its costumes.

    So: one allowlist, both detectors.

    * `paths.git_output` is the only way to obtain a status the caller must
      interpret. Two sites qualify, both because the same status carries a
      real answer and a real failure.
    * an `except` on a probe failure may manufacture a negative **only after
      consulting `errno`** — `ENOENT` is a fact, `EACCES` read as absence is a
      fabrication. Zero sites qualify for an exception today.
    """

    def observed_sites(self):
        return failed_probe_sites(core_sources())

    def test_the_aggregate_audit_reports_BOTH_costumes(self):
        """The counter-weight the first mutation run found missing.

        Every other test here either checks one detector in isolation or
        checks the aggregate against a core that currently has no violations —
        so deleting the swallow branch from `failed_probe_sites` left the whole
        class green. This runs the **aggregate**, the one the audit above
        calls, over a planted module wearing each costume, and fails if either
        stops being collected.
        """
        planted = {
            "raw.py": (
                "import paths\n"
                "def is_tracked(root):\n"
                "    code, out = paths.git_output(root, ['ls-files'])\n"
                "    if code != 0:\n"
                "        return False\n"
                "    return bool(out)\n"
            ),
            "swallowed.py": (
                "import os\n"
                "def _entries(directory):\n"
                "    try:\n"
                "        return sorted(os.listdir(directory))\n"
                "    except OSError:\n"
                "        return []\n"
            ),
        }
        self.assertEqual(
            {
                ("raw.py", "is_tracked"): RAW_STATUS,
                ("swallowed.py", "_entries"): SWALLOWED,
            },
            failed_probe_sites(planted),
        )

    def test_every_failed_probe_site_is_a_documented_exception(self):
        """Equality, not containment, in both directions.

        A **new** site, in either costume, is the regression this exists to
        catch. A **stale** entry is the other half: an allowlist that outlives
        its exception quietly re-licenses the shape for whoever writes there
        next.
        """
        self.assertEqual(
            sorted(FAILED_PROBE_ALLOWLIST),
            sorted(self.observed_sites()),
            "a core module turns a failed probe into an answer outside the "
            "documented allowlist (or an allowlist entry no longer names a "
            "real site). For git: paths.git_checked when only 0 is an answer, "
            "paths.git_answered(..., answers) when a status is an answer. For "
            "the filesystem: look at exc.errno and fault on anything that is "
            "not genuine absence. If the site is truly ambiguous, add it here "
            "with its reason rather than leaving it unexplained.",
        )

    def test_each_site_is_recorded_under_the_costume_it_actually_wears(self):
        for site, form in sorted(self.observed_sites().items()):
            self.assertEqual(FAILED_PROBE_ALLOWLIST[site][0], form, site)

    def test_the_raw_status_detector_actually_detects_the_banned_shape(self):
        """The guard's own non-vacuity: a scanner that finds nothing would
        pass the audit above forever. Planted in a string, so the check does
        not depend on anyone remembering to mutate a real file."""
        planted = (
            "import paths\n"
            "def is_tracked(root):\n"
            "    code, out = paths.git_output(root, ['ls-files'])\n"
            "    if code != 0:\n"
            "        return False\n"
            "    return bool(out)\n"
        )
        self.assertEqual(["is_tracked"], call_sites(planted, "git_output"))
        self.assertNotIn(("manifest.py", "is_tracked"), FAILED_PROBE_ALLOWLIST)

    def test_the_swallow_detector_actually_detects_the_banned_shape(self):
        """Instance seven, planted: the exact `_entries` body that shipped."""
        planted = (
            "import os\n"
            "def _entries(directory):\n"
            "    try:\n"
            "        return sorted(os.listdir(directory))\n"
            "    except OSError:\n"
            "        return []\n"
        )
        self.assertEqual(["_entries"], [f for f, _h in swallow_sites(planted)])

    def test_the_swallow_detector_accepts_a_handler_that_read_the_errno(self):
        """The distinction the rule turns on, both ways round."""
        looked = (
            "import errno, os\n"
            "def _entries(directory):\n"
            "    try:\n"
            "        return sorted(os.listdir(directory))\n"
            "    except OSError as exc:\n"
            "        if exc.errno in (errno.ENOENT, errno.ENOTDIR):\n"
            "            return []\n"
            "        raise RuntimeError(directory)\n"
        )
        self.assertEqual([], swallow_sites(looked))

    def test_the_swallow_detector_ignores_a_bare_return_and_a_pass(self):
        """A thread ending and a pipe closing are not answers to anybody."""
        benign = (
            "def run(self):\n"
            "    try:\n"
            "        self.pump()\n"
            "    except OSError:\n"
            "        return\n"
            "def close(handle):\n"
            "    try:\n"
            "        handle.close()\n"
            "    except OSError:\n"
            "        pass\n"
        )
        self.assertEqual([], swallow_sites(benign))

    def test_the_swallow_detector_ignores_a_narrow_non_probe_handler(self):
        """`except ValueError` around a parse is a different thing."""
        parsing = (
            "def parse(text):\n"
            "    try:\n"
            "        return int(text)\n"
            "    except ValueError:\n"
            "        return 0\n"
        )
        self.assertEqual([], swallow_sites(parsing))

    def test_each_exception_states_a_reason_at_the_code_too(self):
        """The allowlist reason and the code must both carry it: a reader
        arriving at the function sees why, and does not 'fix' it."""
        for (module, function), (form, reason) in sorted(
            FAILED_PROBE_ALLOWLIST.items()
        ):
            self.assertIn(form, (RAW_STATUS, SWALLOWED), (module, function))
            self.assertGreater(
                len(reason), 80, "%s:%s has a token reason" % (module, function)
            )
            if form == RAW_STATUS:
                self.assertIn(
                    "exits", reason, "%s:%s does not name a status" % (module, function)
                )
            else:
                self.assertIn(
                    "errno",
                    reason,
                    "%s:%s does not name the error it cannot tell apart"
                    % (module, function),
                )
            source = S.read_text(os.path.join(S.CORE_DIR, module))
            body = function_source(source, function)
            self.assertIsNotNone(body, "%s:%s not found" % (module, function))
            self.assertIn(
                DOCUMENTED_AMBIGUITY_MARKER,
                body,
                "%s:%s is allowlisted but its own source does not say why"
                % (module, function),
            )

    def test_nothing_bypasses_the_status_decision_by_spawning_directly(self):
        """`paths._run` returns a `CompletedProcess`, so reaching it from
        another module would put `.returncode` back in a caller's hands with
        no answer set anywhere. It is private to the one spawn site."""
        for module in core_modules():
            if module == "paths.py":
                continue
            source = S.read_text(os.path.join(S.CORE_DIR, module))
            self.assertEqual([], call_sites(source, "_run"), module)

    def test_the_two_helpers_that_do_decide_are_used(self):
        """Counter-weight: the audit must not be satisfiable by a core that
        stopped talking to git at all."""
        users = set()
        for module in core_modules():
            source = S.read_text(os.path.join(S.CORE_DIR, module))
            if call_sites(source, "git_checked") or call_sites(source, "git_answered"):
                users.add(module)
        self.assertIn("corpus.py", users)
        self.assertIn("gitstate.py", users)
        self.assertIn("hooks.py", users)
        self.assertIn("manifest.py", users)


# The pathspecs the core builds **on purpose**, keyed by the name they are
# written under, with the reason each is not literal. Everything else after a
# `--` in a git argv must go through `paths.literal_pathspec`.
#
# `--` ends OPTION parsing and nothing else: git still reads what follows as a
# pathspec, so `[R]EADME.md` globs onto `README.md` and `:(top)x` is magic.
# One un-literal caller-supplied path is enough to answer about a different
# file than the one a document declared, which is why this is a rule with an
# allowlist rather than a habit.
DELIBERATE_PATHSPECS = {
    "DOCUMENT_PATHSPEC": (
        "ADR-10's document predicate IS a glob — `*.md`, the corpus-wide "
        "enumeration. It is ours, fixed in the module, and never comes from a "
        "declared path or a manifest record."
    ),
}

LITERAL_HELPER = "literal_pathspec"


def pathspec_arguments(source):
    """(function, argv-element) for every element after a `--` in a git argv.

    A git argv here is any list literal whose elements include the constant
    `"--"`; in this core those are built inline at the `paths.git_*` call. The
    tree is walked with a scope stack so each finding names the function it is
    in, the same way the raw-status audit does.
    """
    found = []

    def elements_after_separator(node):
        rest = []
        seen = False
        for element in node.elts:
            if seen:
                rest.append(element)
            if isinstance(element, ast.Constant) and element.value == "--":
                seen = True
        return rest

    def visit(parent, enclosing):
        for child in ast.iter_child_nodes(parent):
            if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)):
                visit(child, child.name)
                continue
            if isinstance(child, ast.List):
                for element in elements_after_separator(child):
                    found.append((enclosing, element))
            visit(child, enclosing)

    visit(ast.parse(source), "<module>")
    return found


def is_literal_call(node):
    func = getattr(node, "func", None)
    return isinstance(node, ast.Call) and getattr(func, "attr", None) == LITERAL_HELPER


class PathspecDisciplineTest(unittest.TestCase):
    """A declared path is a **name**; git must be asked about that name.

    This is the same disease as the raw-status audit above, one layer out: a
    probe that succeeds while answering about the wrong file is no better than
    a probe that failed and was read as an answer. It reached the tri-state,
    the index probe and the date lookup at once because `--` *looks* like it
    disarms the argument, so the rule is enforced structurally rather than
    remembered.
    """

    def offenders(self, sources):
        """(module, function) for every pathspec that is neither literal nor a
        named deliberate glob. The one aggregation the audit calls."""
        found = []
        for module in sorted(sources):
            for function, element in pathspec_arguments(sources[module]):
                if is_literal_call(element):
                    continue
                if getattr(element, "id", None) in DELIBERATE_PATHSPECS:
                    continue
                found.append((module, function))
        return found

    def test_every_pathspec_is_literal_or_a_named_exception(self):
        self.assertEqual(
            [],
            self.offenders(core_sources()),
            "a core module passes a pathspec that is neither "
            "paths.%s(...) nor a named deliberate glob. `--` does not make "
            "git read it as a name: a bracket globs and a leading colon is "
            "magic." % LITERAL_HELPER,
        )

    def test_the_aggregate_audit_reports_a_raw_pathspec(self):
        """The counter-weight the first mutation run found missing: with the
        core clean, short-circuiting the literal test left the class green."""
        self.assertEqual(
            [("planted.py", "probe")],
            self.offenders(
                {
                    "planted.py": (
                        "import paths\n"
                        "def probe(root, relpath):\n"
                        "    return paths.git_checked("
                        "root, ['ls-files', '-z', '--', relpath])\n"
                    )
                }
            ),
        )

    def test_every_real_pathspec_is_positively_accounted_for(self):
        """Counted, not merely un-flagged. `pathspec_arguments` finding
        nothing would satisfy an absence assertion forever."""
        literal, deliberate = 0, 0
        for source in core_sources().values():
            for _function, element in pathspec_arguments(source):
                if is_literal_call(element):
                    literal += 1
                elif getattr(element, "id", None) in DELIBERATE_PATHSPECS:
                    deliberate += 1
        self.assertGreaterEqual(literal, 4, "the literal call sites vanished")
        self.assertEqual(1, deliberate, "the deliberate glob set changed")

    def test_each_deliberate_pathspec_still_exists(self):
        """The other half: an allowlist nobody prunes re-licenses the shape."""
        observed = set()
        for module in core_modules():
            source = S.read_text(os.path.join(S.CORE_DIR, module))
            for _function, element in pathspec_arguments(source):
                name = getattr(element, "id", None)
                if name in DELIBERATE_PATHSPECS:
                    observed.add(name)
        self.assertEqual(sorted(DELIBERATE_PATHSPECS), sorted(observed))

    def test_the_detector_actually_detects_a_raw_pathspec(self):
        """Non-vacuity, planted in a string rather than by mutating a file."""
        planted = (
            "import paths\n"
            "def probe(root, relpath):\n"
            "    return paths.git_checked(root, ['ls-files', '-z', '--', relpath])\n"
        )
        found = pathspec_arguments(planted)
        self.assertEqual(["probe"], [function for function, _e in found])
        self.assertFalse(any(is_literal_call(element) for _f, element in found))
        fixed = planted.replace("'--', relpath", "'--', paths.literal_pathspec(relpath)")
        self.assertTrue(all(is_literal_call(e) for _f, e in pathspec_arguments(fixed)))

    def test_the_audit_sees_the_real_call_sites(self):
        """Counter-weight: it must not pass by finding no pathspecs at all."""
        functions = set()
        for module in core_modules():
            source = S.read_text(os.path.join(S.CORE_DIR, module))
            for function, _element in pathspec_arguments(source):
                functions.add((module, function))
        for expected in (
            ("gitstate.py", "_is_in_the_index"),
            ("gitstate.py", "_matches_an_ignore_rule"),
            ("gitstate.py", "last_commit_date"),
            ("manifest.py", "is_tracked"),
            ("corpus.py", "tracked_documents"),
        ):
            self.assertIn(expected, functions)


class CrossSkillIndependenceTest(unittest.TestCase):
    """Issue #29, both directions."""

    def test_no_core_file_mentions_a_sibling_skill(self):
        for module in inventory.FILES:
            source = S.read_text(os.path.join(S.CORE_DIR, module))
            for sibling in SIBLING_SKILLS:
                self.assertNotIn(sibling, source, "%s mentions %s" % (module, sibling))

    def test_no_test_file_imports_from_a_sibling_skill(self):
        for name in sorted(os.listdir(S.TESTS_DIR)):
            if not name.endswith(".py"):
                continue
            source = S.read_text(os.path.join(S.TESTS_DIR, name))
            for node in ast.walk(ast.parse(source)):
                if isinstance(node, (ast.Import, ast.ImportFrom)):
                    rendered = ast.dump(node)
                    for sibling in SIBLING_SKILLS:
                        self.assertNotIn(sibling, rendered, name)

    def test_no_sibling_skill_references_the_steward(self):
        """The other direction: nothing may reach into us either."""
        for sibling in SIBLING_SKILLS:
            directory = os.path.join(S.PLUGIN_SKILLS_DIR, sibling)
            if not os.path.isdir(directory):
                continue
            for base, _dirs, names in os.walk(directory):
                for name in names:
                    if not name.endswith((".py", ".mjs", ".js", ".sh")):
                        continue
                    path = os.path.join(base, name)
                    try:
                        source = S.read_text(path)
                    except (UnicodeDecodeError, OSError):
                        continue
                    self.assertNotIn(
                        "the-steward", source, "%s reaches into the-steward" % path
                    )

    def test_the_core_suite_runs_with_no_sibling_skill_present(self):
        """Copied into a directory holding nothing but the-steward, the suite
        still passes. `test_packaging` is excluded by construction: it reads the
        plugin repo on purpose."""
        if os.environ.get(ISOLATION_ENV):
            self.skipTest("already the isolated child run")
        import tempfile

        sandbox = tempfile.mkdtemp(prefix="steward-isolated-")
        self.addCleanup(shutil.rmtree, sandbox, True)
        shutil.copytree(S.CORE_DIR, os.path.join(sandbox, "core"))
        shutil.copytree(
            S.TESTS_DIR,
            os.path.join(sandbox, "tests"),
            ignore=shutil.ignore_patterns("test_packaging.py", "__pycache__"),
        )
        env = dict(os.environ)
        env[ISOLATION_ENV] = "1"
        env["PYTHONDONTWRITEBYTECODE"] = "1"
        result = subprocess.run(
            [
                sys.executable,
                "-B",
                "-m",
                "unittest",
                "discover",
                "-s",
                "tests",
                "-t",
                "tests",
            ],
            cwd=sandbox,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        self.assertEqual(
            0,
            result.returncode,
            result.stderr.decode("utf-8", "replace")[-4000:],
        )


if __name__ == "__main__":
    unittest.main()
