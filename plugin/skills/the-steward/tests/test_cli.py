"""P1.3 — subcommand dispatch, zero flags, the floor assertion, exit codes.

ADR-1  : floor assertion is the first action; the bytecode notice fires when
         `sys.dont_write_bytecode` is false and does NOT change the exit code.
ADR-13 : exit codes are exactly 0 / 1 / 2 and nothing else.
ADR-20 : v0 has no flags at all.
"""

import ast
import io
import os
import unittest

import _support as S

S.import_core()

import bootstrap  # noqa: E402
import cli  # noqa: E402

VERBS = ("scan", "generate", "check", "doctor")

# Every flag shape a caller might reach for, including the two the plan names
# explicitly: --force (deleted with the record-is-not-a-grant rule) and
# --version (never existed; the core's version is a line in doctor's report).
FLAGS = ("--force", "--version", "--help", "-h", "-v", "--adopt", "--json", "-B")


class ExitCodeContractTest(unittest.TestCase):
    def test_only_three_exit_codes_are_defined(self):
        self.assertEqual(0, cli.EXIT_OK)
        self.assertEqual(1, cli.EXIT_FINDINGS)
        self.assertEqual(2, cli.EXIT_TOOL_FAILURE)
        defined = {
            value
            for name, value in vars(cli).items()
            if name.startswith("EXIT_") and isinstance(value, int)
        }
        self.assertEqual({0, 1, 2}, defined, "a fourth exit code was introduced")


class DispatchTest(unittest.TestCase):
    def run_main(self, argv):
        out, err = io.StringIO(), io.StringIO()
        code = cli.main(argv, out, err)
        return code, out.getvalue(), err.getvalue()

    def test_each_verb_dispatches(self):
        for verb in VERBS:
            code, out, err = self.run_main([verb])
            self.assertIn(code, (0, 1), "%s exited %s: %s" % (verb, code, err))

    def test_no_verb_is_a_tool_failure(self):
        code, out, err = self.run_main([])
        self.assertEqual(2, code)
        for verb in VERBS:
            self.assertIn(verb, err)

    def test_unknown_verb_is_a_tool_failure(self):
        code, out, err = self.run_main(["gerbil"])
        self.assertEqual(2, code)
        self.assertIn("gerbil", err)

    def test_exactly_four_verbs_exist(self):
        self.assertEqual(set(VERBS), set(cli.VERBS))

    def test_extra_positional_argument_is_a_tool_failure(self):
        code, out, err = self.run_main(["check", "somewhere"])
        self.assertEqual(2, code)
        self.assertIn("somewhere", err)


class NoFlagsTest(unittest.TestCase):
    def run_main(self, argv):
        out, err = io.StringIO(), io.StringIO()
        code = cli.main(argv, out, err)
        return code, out.getvalue(), err.getvalue()

    def test_every_verb_rejects_every_flag(self):
        for verb in VERBS:
            for flag in FLAGS:
                code, out, err = self.run_main([verb, flag])
                self.assertEqual(
                    2, code, "%s %s was accepted (exit %s)" % (verb, flag, code)
                )
                self.assertIn(flag, err, "%s %s: flag not named" % (verb, flag))

    def test_a_flag_before_the_verb_is_rejected_too(self):
        for flag in FLAGS:
            code, out, err = self.run_main([flag, "check"])
            self.assertEqual(2, code, "%s check was accepted" % flag)
            self.assertIn(flag, err)


class ToolFailureTest(unittest.TestCase):
    def test_unhandled_exception_exits_two_never_zero(self):
        def explode(context):
            raise RuntimeError("boom from a verb")

        original = dict(cli.VERBS)
        try:
            cli.VERBS["check"] = explode
            out, err = io.StringIO(), io.StringIO()
            code = cli.main(["check"], out, err)
        finally:
            cli.VERBS.clear()
            cli.VERBS.update(original)
        self.assertEqual(2, code)
        self.assertIn("boom from a verb", err.getvalue())

    def test_steward_error_exits_two(self):
        def fail(context):
            raise cli.StewardError("the manifest does not validate")

        original = dict(cli.VERBS)
        try:
            cli.VERBS["check"] = fail
            out, err = io.StringIO(), io.StringIO()
            code = cli.main(["check"], out, err)
        finally:
            cli.VERBS.clear()
            cli.VERBS.update(original)
        self.assertEqual(2, code)
        self.assertIn("the manifest does not validate", err.getvalue())


class FloorAssertionTest(unittest.TestCase):
    """We cannot run a 3.8 interpreter on this machine, so the predicate is
    tested directly and the wiring is tested by inspection of __main__.py."""

    def test_below_floor_reports_the_observed_version(self):
        message = bootstrap.floor_failure((3, 8, 19))
        self.assertIsNotNone(message)
        self.assertIn("3.8.19", message)
        self.assertIn("3.9", message)

    def test_at_and_above_floor_passes(self):
        self.assertIsNone(bootstrap.floor_failure((3, 9, 6)))
        self.assertIsNone(bootstrap.floor_failure((3, 13, 5)))
        self.assertIsNone(bootstrap.floor_failure((4, 0, 0)))

    def test_floor_assertion_is_the_first_action_in_main(self):
        source = S.read_text(os.path.join(S.CORE_DIR, "__main__.py"))
        tree = ast.parse(source)
        calls = [
            n
            for n in ast.walk(tree)
            if isinstance(n, ast.Call)
            and isinstance(n.func, ast.Attribute)
            and n.func.attr in ("floor_failure", "bytecode_notice")
        ]
        self.assertTrue(calls, "__main__.py never calls the bootstrap checks")
        self.assertEqual(
            "floor_failure",
            calls[0].func.attr,
            "the floor assertion is not the first bootstrap action",
        )

    def test_bootstrap_and_main_parse_under_an_ancient_grammar(self):
        """A floor message is useless if the file cannot be parsed to print it."""
        for name in ("__main__.py", "bootstrap.py"):
            source = S.read_text(os.path.join(S.CORE_DIR, name))
            try:
                ast.parse(source, feature_version=(3, 6))
            except SyntaxError as exc:
                self.fail("%s needs syntax newer than 3.6: %s" % (name, exc))


class BytecodeNoticeTest(unittest.TestCase):
    def test_notice_text_when_suppression_is_off(self):
        notice = bootstrap.bytecode_notice(False)
        self.assertIsNotNone(notice)
        self.assertIn("-B", notice)

    def test_no_notice_when_suppression_is_on(self):
        self.assertIsNone(bootstrap.bytecode_notice(True))

    def test_main_reads_dont_write_bytecode_before_assigning_it(self):
        """Assigning first would make the notice unfireable (ADR-1)."""
        source = S.read_text(os.path.join(S.CORE_DIR, "__main__.py"))
        tree = ast.parse(source)
        read_line = None
        write_line = None
        for node in ast.walk(tree):
            if (
                isinstance(node, ast.Call)
                and isinstance(node.func, ast.Attribute)
                and node.func.attr == "bytecode_notice"
            ):
                read_line = node.lineno if read_line is None else read_line
            if isinstance(node, ast.Assign):
                for target in node.targets:
                    if (
                        isinstance(target, ast.Attribute)
                        and target.attr == "dont_write_bytecode"
                    ):
                        write_line = (
                            node.lineno if write_line is None else write_line
                        )
        self.assertIsNotNone(read_line, "__main__.py never reads the flag")
        self.assertIsNotNone(write_line, "__main__.py never sets the flag")
        self.assertLess(read_line, write_line)


class FloorAssertionFiresTest(unittest.TestCase):
    """The wiring, proven by a side effect rather than by reading the source.

    No interpreter below 3.9 exists on this machine, so the floor is raised
    instead of the interpreter lowered: a copy of the core with
    `bootstrap.FLOOR = (99, 0)` must refuse to run, name the observed version,
    and exit 2. That proves `__main__.py` acts on `floor_failure` — the thing
    the AST test above can only infer.
    """

    def setUp(self):
        import shutil
        import tempfile

        import inventory

        self.sandbox = tempfile.mkdtemp(prefix="steward-floor-")
        self.addCleanup(shutil.rmtree, self.sandbox, True)
        self.core = os.path.join(self.sandbox, "core")
        os.makedirs(self.core)
        for name in inventory.FILES:
            shutil.copy(os.path.join(S.CORE_DIR, name), os.path.join(self.core, name))

    def raise_the_floor(self, floor):
        path = os.path.join(self.core, "bootstrap.py")
        source = S.read_text(path)
        source = source.replace("FLOOR = (3, 9)", "FLOOR = %r" % (floor,))
        with open(path, "w", encoding="utf-8") as handle:
            handle.write(source)

    def test_an_interpreter_below_the_floor_exits_two_naming_its_version(self):
        # `continue` here would let this pass vacuously on a machine with
        # neither interpreter, and the run would still say OK. Degrade
        # visibly instead — the dual-interpreter guarantee is the point
        # (P1.8), and a silent single-interpreter run is a vacuous green.
        missing = [
            path
            for path in (S.FLOOR_PYTHON, S.MODERN_PYTHON)
            if not os.path.exists(path)
        ]
        if missing:
            self.skipTest("interpreter(s) missing: %s" % ", ".join(missing))

        self.raise_the_floor((99, 0))
        for interpreter in (S.FLOOR_PYTHON, S.MODERN_PYTHON):
            result = S.run_core(
                interpreter, ["scan"], cwd=self.sandbox, core_dir=self.core
            )
            self.assertEqual(2, result.returncode, interpreter)
            message = result.stderr.decode("utf-8", "replace")
            self.assertIn("99.0", message)
            self.assertIn("requires Python", message)
            self.assertEqual(b"", result.stdout, "it ran a verb anyway")

    def test_the_control_at_the_real_floor_runs_normally(self):
        """Without this the test above could pass for the wrong reason."""
        result = S.run_core(
            S.MODERN_PYTHON, ["scan"], cwd=self.sandbox, core_dir=self.core
        )
        self.assertEqual(0, result.returncode, result.stderr.decode("utf-8", "replace"))


if __name__ == "__main__":
    unittest.main()
