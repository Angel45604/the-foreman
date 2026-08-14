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
    "traceback",
}

SIBLING_SKILLS = ("the-foreman", "codex-gate", "handoff", "keep-it-simple",
                  "the-cartographer")

ISOLATION_ENV = "STEWARD_ISOLATION_CHILD"


def core_modules():
    return sorted(
        name for name in inventory.FILES if name.endswith(".py")
    )


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

    def spawn_calls(self, source):
        calls = []
        for node in ast.walk(ast.parse(source)):
            if not isinstance(node, ast.Call):
                continue
            func = node.func
            name = getattr(func, "attr", getattr(func, "id", None))
            if name in ("run", "Popen", "call", "check_output", "check_call"):
                base = getattr(func, "value", None)
                if isinstance(base, ast.Name) and base.id == "subprocess":
                    calls.append(node)
            if name in ("system", "popen", "execv", "execve", "spawnv"):
                calls.append(node)
        return calls

    def test_only_one_module_spawns_anything(self):
        spawners = []
        for module in core_modules():
            source = S.read_text(os.path.join(S.CORE_DIR, module))
            if self.spawn_calls(source):
                spawners.append(module)
        self.assertEqual(["paths.py"], spawners)

    def test_every_spawn_is_git_with_an_argument_vector(self):
        source = S.read_text(os.path.join(S.CORE_DIR, "paths.py"))
        calls = self.spawn_calls(source)
        self.assertTrue(calls, "no spawn found — the audit would be vacuous")
        for call in calls:
            argument = call.args[0]
            while isinstance(argument, ast.BinOp):
                argument = argument.left
            self.assertIsInstance(
                argument, ast.List, "argv must be a list literal, never a shell string"
            )
            first = argument.elts[0]
            self.assertIsInstance(first, ast.Constant)
            self.assertEqual("git", first.value)
            keywords = {kw.arg for kw in call.keywords}
            self.assertIn("timeout", keywords, "ADR-18 requires an explicit timeout")

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


# Every call site allowed to take a raw git exit status and decide for itself
# what it means, and the reason each one cannot use a declared answer set. The
# map is the contract: a new site fails the audit, and so does an entry whose
# site is gone — an allowlist nobody prunes is how an exception becomes a
# habit. `git_output` is the only primitive that hands back an uninterpreted
# status, so this is the whole surface: `git_checked` faults on everything but
# 0, and `git_answered`'s caller has already written its answer set down.
GIT_OUTPUT_ALLOWLIST = {
    ("paths.py", "repo_root"): (
        "`git rev-parse --show-toplevel` exits 128 both outside a repository "
        "and on a repository git cannot read. No status separates them, and "
        "answers=(0,) would make `not a repository` — a first-class reported "
        "state — unreachable."
    ),
    ("gitstate.py", "last_commit_date"): (
        "`git log -1` exits 128 for the real answer `no commit touches this "
        "path` in a repository with no commits, which is indistinguishable "
        "from an error by construction. answers=(0,) would exit 2 on every "
        "freshly initialised repository. The value is a date on a report "
        "line, never a verdict, so a missing one under-states and cannot "
        "manufacture a pass."
    ),
}

DOCUMENTED_AMBIGUITY_MARKER = "DOCUMENTED AMBIGUITY"


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


class GitStatusDisciplineTest(unittest.TestCase):
    """A failed git probe must never be readable as an answer (ADR-13).

    This shape has arrived six times in five layers, always looking local and
    always reading the same: `if code != 0: return <a confident answer>`, so a
    probe that never ran renders as a finding. `paths.git_answered` fixed the
    *mechanism* — the caller declares which statuses git uses as answers and
    everything else faults — but a mechanism nobody is forced to use is a
    convention, and conventions are what produced instances two through six.

    So the audit is structural: **`paths.git_output` is the only way to obtain
    a status the caller must interpret, and every one of its call sites is
    named here with the reason it cannot declare an answer set.** Two sites
    qualify, both because the same status carries a real answer and a real
    failure. Everything else routes through `git_checked` or `git_answered`.
    """

    def observed_sites(self):
        sites = {}
        for module in core_modules():
            source = S.read_text(os.path.join(S.CORE_DIR, module))
            for function in call_sites(source, "git_output"):
                sites.setdefault((module, function), 0)
                sites[(module, function)] += 1
        return sites

    def test_every_raw_status_call_site_is_a_documented_exception(self):
        """Equality, not containment, in both directions.

        A **new** site is the regression this exists to catch. A **stale**
        entry is the other half: an allowlist that outlives its exception
        quietly re-licenses the shape for whoever writes there next.
        """
        self.assertEqual(
            sorted(GIT_OUTPUT_ALLOWLIST),
            sorted(self.observed_sites()),
            "a core module calls paths.git_output outside the documented "
            "allowlist (or an allowlist entry no longer names a real site). "
            "Use paths.git_checked when only 0 is an answer, or "
            "paths.git_answered(..., answers) when a status is an answer — "
            "and if the site is genuinely ambiguous, add it here with its "
            "reason rather than leaving `if code != 0` unexplained.",
        )

    def test_the_detector_actually_detects_the_banned_shape(self):
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
        self.assertNotIn(("manifest.py", "is_tracked"), GIT_OUTPUT_ALLOWLIST)

    def test_each_exception_states_a_reason_at_the_code_too(self):
        """The allowlist reason and the code must both carry it: a reader
        arriving at the function sees why, and does not 'fix' it."""
        for (module, function), reason in sorted(GIT_OUTPUT_ALLOWLIST.items()):
            self.assertGreater(len(reason), 80, "%s:%s has a token reason" % (module, function))
            self.assertIn("exits", reason, "%s:%s does not name a status" % (module, function))
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
