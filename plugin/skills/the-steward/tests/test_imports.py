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
