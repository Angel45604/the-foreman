"""P2.5 — hooks-path **inspection**, read-only, for A3 (ADR-28).

This is the substrate under the acceptance failure the reference repo actually
had: a pre-commit hook everyone believed was enforcing doc freshness, silently
inactive because git never clones hooks and `core.hooksPath` had never been
pointed at the tracked hooks directory. **Nothing reported it.**

What Phase 2 owns is the *facts*: the effective hooks path, whether it is the
default or a redirection, and the presence and mode bit of whatever is there.
The bounded A3 diagnosis and the "the-steward installed no hook" statement are
P7.3 / P7.4's, and are deliberately not pre-empted here.

**Three properties this file holds the line on:**

1. **Nothing is written and nothing is configured.** Not the working tree, not
   `core.hooksPath`, not one byte or mode bit in the hooks directory itself.
2. **Every finding carries the *inspected* tier** — never *resolved*, which
   would claim we followed a claim to an object, and never *rendered*.
3. **Neither banned sentence** (ADR-28). Inspection cannot establish that a
   hook fires, and it cannot establish that nothing enforces anything either:
   a hooks path and a mode bit are two facts about one directory in one clone.

**The hooks path is legitimately outside the working tree** and is not subject
to ADR-26's containment predicate — the default is `<git-dir>/hooks`, and in a
linked worktree it resolves into the *main* repository's git dir entirely
(`verified-contracts.md` §2.3.6). ADR-26 names it as outside the predicate's
domain, and `OutsideTheWorkingTreeTest` pins that so a later containment sweep
cannot quietly turn `doctor` into exit 2 on every repository.
"""

import io
import os
import shutil
import stat
import subprocess
import unittest

import _support as S

S.import_core()

import cli  # noqa: E402
import hooks  # noqa: E402
import paths  # noqa: E402


class HooksFixture(unittest.TestCase):
    def setUp(self):
        self.root = S.make_git_repo()
        self.addCleanup(shutil.rmtree, self.root, True)
        self.default_dir = os.path.join(self.root, ".git", "hooks")

    def configure(self, value):
        result = S.git(self.root, "config", "core.hooksPath", value)
        self.assertEqual(0, result.returncode, result.stderr)

    def make_hook_dir(self, relpath, name="pre-commit", mode=0o755):
        directory = os.path.join(self.root, relpath.replace("/", os.sep))
        os.makedirs(directory, exist_ok=True)
        path = os.path.join(directory, name)
        with open(path, "w", encoding="utf-8") as handle:
            handle.write("#!/bin/sh\nexit 0\n")
        os.chmod(path, mode)
        return directory, path

    def real(self, path):
        return os.path.realpath(path)


class BranchTest(HooksFixture):
    """The four branches P2.5 names, and the distinction that matters for A3."""

    def test_unset_reports_the_default(self):
        found = hooks.inspect(self.root)
        self.assertEqual(hooks.DEFAULT, found.branch)
        self.assertIsNone(found.configured)
        self.assertEqual(self.real(self.default_dir), self.real(found.effective_path))
        self.assertEqual(self.real(self.default_dir), self.real(found.default_path))

    def test_set_but_equivalent_to_the_default_reports_the_default(self):
        """The reference repo's own state: `core.hooksPath` is an absolute path
        **equal to the default location** (§2.3.6). Nothing about what runs has
        changed, so calling it a redirection would be a false A3."""
        self.configure(self.default_dir)
        found = hooks.inspect(self.root)
        self.assertEqual(hooks.DEFAULT, found.branch)
        self.assertEqual(self.default_dir, found.configured)
        self.assertEqual(self.real(self.default_dir), self.real(found.effective_path))

    def test_a_foreign_absolute_path_reports_a_redirection(self):
        directory, _path = self.make_hook_dir("elsewhere-hooks")
        self.configure(directory)
        found = hooks.inspect(self.root)
        self.assertEqual(hooks.REDIRECTED, found.branch)
        self.assertEqual(self.real(directory), self.real(found.effective_path))
        self.assertNotEqual(
            self.real(found.default_path), self.real(found.effective_path)
        )

    def test_a_relative_path_resolves_against_the_working_tree_root(self):
        """§2.3.6, verified: a **relative** `core.hooksPath` resolves per
        worktree against the working-tree root — not against CWD."""
        directory, _path = self.make_hook_dir(".githooks")
        self.configure(".githooks")
        found = hooks.inspect(self.root)
        self.assertEqual(hooks.REDIRECTED, found.branch)
        self.assertEqual(".githooks", found.configured)
        self.assertEqual(self.real(directory), self.real(found.effective_path))

    def test_a_relative_path_does_not_follow_the_current_directory(self):
        """A naive join onto CWD would answer `<root>/docs/.githooks` here."""
        self.make_hook_dir(".githooks")
        self.configure(".githooks")
        nested = os.path.join(self.root, "docs", "deep")
        os.makedirs(nested)
        found = hooks.inspect(self.root, cwd=nested)
        self.assertEqual(
            self.real(os.path.join(self.root, ".githooks")),
            self.real(found.effective_path),
        )

    def test_a_relative_path_resolves_per_linked_worktree(self):
        """The same relative value points at a **different** directory in each
        worktree — which is the whole reason it is resolved and not assumed."""
        self.make_hook_dir(".githooks")
        self.configure(".githooks")
        linked = self.root + "-worktree"
        self.addCleanup(shutil.rmtree, linked, True)
        result = S.git(self.root, "worktree", "add", "-q", "-b", "wt", linked)
        self.assertEqual(0, result.returncode, result.stdout + result.stderr)
        self.addCleanup(S.git, self.root, "worktree", "prune")

        found = hooks.inspect(linked)
        self.assertEqual(
            self.real(os.path.join(linked, ".githooks")),
            self.real(found.effective_path),
        )
        self.assertNotEqual(
            self.real(os.path.join(self.root, ".githooks")),
            self.real(found.effective_path),
        )

    def test_a_linked_worktree_shares_the_main_default_hooks_directory(self):
        """§2.3.6: with nothing configured, a linked worktree's hooks resolve
        into the **main** repository's git dir."""
        linked = self.root + "-worktree2"
        self.addCleanup(shutil.rmtree, linked, True)
        S.git(self.root, "worktree", "add", "-q", "-b", "wt2", linked)
        self.addCleanup(S.git, self.root, "worktree", "prune")
        found = hooks.inspect(linked)
        self.assertEqual(hooks.DEFAULT, found.branch)
        self.assertEqual(self.real(self.default_dir), self.real(found.effective_path))

    def test_the_two_branches_are_the_whole_set(self):
        self.assertEqual(("default", "redirected"), tuple(sorted(hooks.BRANCHES)))


class HookFileTest(HooksFixture):
    """"Stat any hook found for presence and the mode bit" — and no more."""

    def test_an_executable_hook_is_reported_with_its_mode(self):
        directory, path = self.make_hook_dir(".githooks", mode=0o755)
        self.configure(".githooks")
        found = hooks.inspect(self.root)
        by_name = {hook.name: hook for hook in found.hooks}
        self.assertIn("pre-commit", by_name)
        self.assertEqual(0o755, by_name["pre-commit"].mode)
        self.assertTrue(by_name["pre-commit"].is_executable)
        self.assertTrue(by_name["pre-commit"].is_file)
        self.assertEqual(self.real(path), self.real(by_name["pre-commit"].path))

    def test_a_non_executable_hook_is_reported_as_not_executable(self):
        """ADR-4's second reason hooks are not an enforcement boundary: a
        non-executable hook yields a suppressible `hint:` and the commit
        succeeds. The mode bit is the fact; the conclusion is not ours."""
        self.make_hook_dir(".githooks", mode=0o644)
        self.configure(".githooks")
        by_name = {hook.name: hook for hook in hooks.inspect(self.root).hooks}
        self.assertEqual(0o644, by_name["pre-commit"].mode)
        self.assertFalse(by_name["pre-commit"].is_executable)

    def test_an_absent_hooks_directory_is_reported_as_absent(self):
        self.configure("nowhere-at-all")
        found = hooks.inspect(self.root)
        self.assertFalse(found.directory_exists)
        self.assertEqual((), found.hooks)

    def test_hooks_are_sorted_by_name(self):
        directory, _path = self.make_hook_dir(".githooks", name="pre-push")
        self.make_hook_dir(".githooks", name="commit-msg")
        self.make_hook_dir(".githooks", name="pre-commit")
        self.configure(".githooks")
        names = [hook.name for hook in hooks.inspect(self.root).hooks]
        self.assertEqual(sorted(names), names)
        self.assertEqual(["commit-msg", "pre-commit", "pre-push"], names)

    def test_a_subdirectory_is_reported_but_not_as_a_file(self):
        directory, _path = self.make_hook_dir(".githooks")
        os.makedirs(os.path.join(directory, "helpers"))
        self.configure(".githooks")
        by_name = {hook.name: hook for hook in hooks.inspect(self.root).hooks}
        self.assertIn("helpers", by_name)
        self.assertFalse(by_name["helpers"].is_file)

    def test_a_dangling_symlink_does_not_crash_the_inspection(self):
        """A hook symlink whose target is gone must not turn `doctor` into
        exit 2 for the whole repository."""
        directory, _path = self.make_hook_dir(".githooks")
        os.symlink("gone.sh", os.path.join(directory, "post-commit"))
        self.configure(".githooks")
        by_name = {hook.name: hook for hook in hooks.inspect(self.root).hooks}
        self.assertIn("post-commit", by_name)
        self.assertIsNone(by_name["post-commit"].mode)
        self.assertFalse(by_name["post-commit"].is_executable)


class OutsideTheWorkingTreeTest(HooksFixture):
    """ADR-26 names the hooks path as outside the containment predicate.

    **Corrected against a live run.** The default `<root>/.git/hooks` sits
    *under* the toplevel as a path, so `paths.contain` accepts it — it is
    outside the predicate's **domain** (it is not repository data), not
    outside the tree. The cases where it is genuinely outside are the two
    §2.3.6 records: a **linked worktree**, whose hooks resolve into the main
    repository's git dir, and a foreign absolute `core.hooksPath`. Routing the
    inspection through `contain` would hard-error there — which is exactly
    what §2.3.6 measured, in all 106 worktrees of the reference monorepo.
    """

    def test_a_linked_worktrees_hooks_path_is_outside_its_own_working_tree(self):
        linked = self.root + "-worktree"
        self.addCleanup(shutil.rmtree, linked, True)
        result = S.git(self.root, "worktree", "add", "-q", "-b", "wt-out", linked)
        self.assertEqual(0, result.returncode, result.stdout + result.stderr)
        self.addCleanup(S.git, self.root, "worktree", "prune")

        import paths

        found = hooks.inspect(linked)
        self.assertFalse(
            self.real(found.effective_path).startswith(self.real(linked) + os.sep),
            "the fixture no longer reproduces §2.3.6's finding",
        )
        with self.assertRaises(paths.ContainmentError):
            paths.contain(linked, found.effective_path)

    def test_a_foreign_absolute_hooks_path_outside_the_tree_is_inspected(self):
        outside = os.path.realpath(
            os.path.join(self.root, os.pardir, "steward-hooks-%d" % os.getpid())
        )
        os.makedirs(outside, exist_ok=True)
        self.addCleanup(shutil.rmtree, outside, True)
        with open(os.path.join(outside, "pre-commit"), "w", encoding="utf-8") as h:
            h.write("#!/bin/sh\nexit 0\n")
        self.configure(outside)

        import paths

        found = hooks.inspect(self.root)
        self.assertEqual(hooks.REDIRECTED, found.branch)
        self.assertEqual(self.real(outside), self.real(found.effective_path))
        self.assertEqual(["pre-commit"], [hook.name for hook in found.hooks])
        with self.assertRaises(paths.ContainmentError):
            paths.contain(self.root, found.effective_path)

    def test_the_module_never_routes_a_path_through_the_containment_predicate(self):
        """Structural, so a later containment sweep cannot quietly turn
        `doctor` into exit 2 on every repository with a linked worktree."""
        import ast

        tree = ast.parse(S.read_text(os.path.join(S.CORE_DIR, "hooks.py")))
        for node in ast.walk(tree):
            if isinstance(node, ast.Attribute):
                self.assertNotIn(
                    node.attr,
                    ("contain", "target_is_writable_in_place", "crosses_symlink"),
                    "hooks.py applied ADR-26's predicate to a path outside its "
                    "domain",
                )


class FindingsTest(HooksFixture):
    """ADR-28: every finding carries the *inspected* tier, and no more."""

    def findings(self):
        return hooks.inspection_findings(hooks.inspect(self.root))

    def test_every_finding_is_tier_inspected(self):
        self.make_hook_dir(".githooks")
        self.configure(".githooks")
        found = self.findings()
        self.assertTrue(found)
        for item in found:
            self.assertEqual("inspected", item["tier"], item)

    def test_no_finding_carries_a_confidence(self):
        """`confidence` belongs to inferences only (P1.6); the findings model
        already refuses it, and this asserts the module does not try."""
        self.make_hook_dir(".githooks")
        self.configure(".githooks")
        for item in self.findings():
            self.assertNotIn("confidence", item)

    def test_no_finding_is_an_error(self):
        """Phase 2 reports facts. A3's severity is P7.3/P7.4's decision."""
        self.make_hook_dir(".githooks")
        self.configure(".githooks")
        for item in self.findings():
            self.assertEqual("info", item["severity"], item)

    def test_the_branch_is_reported_in_both_directions(self):
        default = " ".join(
            item["observed"] for item in hooks.inspection_findings(hooks.inspect(self.root))
        )
        self.assertIn("default", default)
        self.make_hook_dir(".githooks")
        self.configure(".githooks")
        redirected = " ".join(item["observed"] for item in self.findings())
        self.assertIn(".githooks", redirected)

    def test_a_hook_is_reported_with_its_mode_bit(self):
        self.make_hook_dir(".githooks", mode=0o644)
        self.configure(".githooks")
        rendered = " ".join(
            "%s %s %s" % (item["claim"], item["observed"], item["where"])
            for item in self.findings()
        )
        self.assertIn("pre-commit", rendered)
        self.assertIn("644", rendered)

    def test_neither_banned_sentence_appears(self):
        """ADR-28, both directions. Inspection can establish neither."""
        for setup in (lambda: None, lambda: self.configure(".githooks")):
            setup()
            rendered = " ".join(
                "%s %s %s" % (item["claim"], item["observed"], item["where"])
                for item in self.findings()
            ).lower()
            self.assertNotIn("enforcement works", rendered)
            self.assertNotIn("there is no enforcement", rendered)

    def test_no_finding_claims_a_hook_fires_or_protects(self):
        self.make_hook_dir(".githooks")
        self.configure(".githooks")
        rendered = " ".join(
            "%s %s" % (item["claim"], item["observed"]) for item in self.findings()
        ).lower()
        for banned in ("protect", "guarantee", "enforce", "will run", "prevents"):
            self.assertNotIn(banned, rendered, banned)


class ConfiguredValueProbeFailureTest(HooksFixture):
    """`core.hooksPath` is *unset* only on the status git reserves for that.

    `git config --get` answers with two statuses and reserves the rest:
    **0** — the value, printed; **1** — the key is not set. Everything above is
    a failure to read the configuration at all (a bad include, a config file
    git cannot parse or open). `if code != 0: return None` collapsed all three
    into "unset", which is a false A3 in the worst direction: the inspection
    would print *core.hooksPath is unset* over a clone whose hooks path we
    never managed to ask about.

    Both rows are here because either alone is a trap. Fault on every non-zero
    and *unset* — the overwhelmingly common state, and the reference repo's —
    becomes unreachable; fault on none and the failure keeps reading as an
    answer. The answer set is exactly `{0, 1}`.
    """

    def test_exit_one_is_the_real_answer_unset(self):
        """Non-vacuity, with git as the independent oracle for the status."""
        self.assertEqual(
            1, S.git(self.root, "config", "--get", "core.hooksPath").returncode
        )
        self.assertIsNone(hooks.inspect(self.root).configured)

    def test_exit_zero_is_the_real_answer_a_value(self):
        self.configure(".githooks")
        self.assertEqual(
            0, S.git(self.root, "config", "--get", "core.hooksPath").returncode
        )
        self.assertEqual(".githooks", hooks.inspect(self.root).configured)

    def test_a_status_above_one_faults_rather_than_reading_unset(self):
        """Failed **at the child**, at `paths._run`'s single documented spawn
        site, for the reason `test_gitstate.py` already had to fail
        `check-ignore` there: no fixture makes real git fail here *alone*.
        Everything that stops `git config --get` from reading the
        configuration — an unparseable `.git/config`, an unreadable
        `GIT_CONFIG_GLOBAL`, a bad `[include]` — stops `git rev-parse` on the
        same clone, so `_rev_parse` faults first and this branch would never
        be reached by a real repository. Probed on git 2.50.1: a garbage
        global config exits **128** for `rev-parse`, `config --get` *and*
        `ls-files` alike. Only the child's exit status is fabricated; both
        `_configured_value` and `inspect` run for real.
        """
        real = paths._run

        def failing_config(cwd, args, *rest):
            if args and args[0] == "config":
                return subprocess.CompletedProcess(
                    args, 128, b"", b"fatal: bad config line 1 in file .git/bogus.conf"
                )
            return real(cwd, args, *rest)

        paths._run = failing_config
        self.addCleanup(setattr, paths, "_run", real)
        with self.assertRaises(paths.GitCommandFailed) as caught:
            hooks.inspect(self.root)
        self.assertIn("config", str(caught.exception))
        self.assertIn("128", str(caught.exception))


class UninspectableDirectoryTest(HooksFixture):
    """A directory we could not read is not an empty directory (ADR-13).

    `except OSError: return []` and `os.path.isdir` are the same disease as
    `if code != 0: return <answer>`, one layer down: both turn a probe that
    **failed** into a confident negative. Reported through A3 that reads *the
    effective hooks path contains nothing*, or *no directory at that path*,
    about a clone whose hooks path we never managed to look at — which is one
    short step from the sentence ADR-28 bans outright.
    """

    def setUp(self):
        HooksFixture.setUp(self)
        if os.geteuid() == 0:
            self.skipTest("running as root: no directory is unreadable")

    def unreadable(self, path):
        self.addCleanup(os.chmod, path, 0o755)
        os.chmod(path, 0o000)
        return path

    def test_an_unreadable_hooks_directory_faults_rather_than_reading_empty(self):
        directory, _path = self.make_hook_dir(".githooks")
        self.configure(".githooks")
        self.unreadable(directory)
        with self.assertRaises(OSError):
            os.listdir(directory)
        with self.assertRaises(hooks.HooksInspectionFailed) as caught:
            hooks.inspect(self.root)
        self.assertIn(".githooks", str(caught.exception))

    def test_the_fault_exits_two_through_the_cli_without_a_traceback(self):
        """`doctor` gains the inspection in Phase 7, so the fault is raised
        into the CLI here rather than pretending the wiring already exists.

        The assertion that bites is *no traceback*: a fault type the CLI does
        not know about still exits 2, through `except Exception`, and prints a
        stack trace where a sentence belongs. Dropping it from
        `REPORTED_FAULTS` fails this line and nothing else would.
        """
        self.assertIn(hooks.HooksInspectionFailed, cli.REPORTED_FAULTS)
        original = dict(cli.VERBS)
        self.addCleanup(setattr, cli, "VERBS", original)

        def raising(_context):
            raise hooks.HooksInspectionFailed(
                "the-steward: the effective hooks path could not be read"
            )

        cli.VERBS = dict(original, doctor=raising)
        out, err = io.StringIO(), io.StringIO()
        code = cli.main(["doctor"], out, err, cwd=self.root)
        self.assertEqual(2, code, out.getvalue() + err.getvalue())
        self.assertNotIn("Traceback", err.getvalue(), "a predicted fault crashed")
        self.assertIn("could not be read", err.getvalue())

    def test_an_unreadable_parent_is_refused_by_git_before_we_look(self):
        """The EACCES that `os.path.isdir` used to swallow never reaches the
        filesystem probe at all — `rev-parse --git-path` validates the path
        and exits 128 first, and `git_checked` makes that a fault.

        Recorded rather than asserted the other way round because it is the
        reason the second swallow was not separately reachable: the fix
        deletes the branch, it does not make an unreachable one honest.
        """
        directory, _path = self.make_hook_dir("outer/inner")
        self.configure("outer/inner")
        self.unreadable(os.path.join(self.root, "outer"))
        self.assertFalse(
            os.path.isdir(directory),
            "isdir stopped swallowing EACCES — the fixture is inert",
        )
        with self.assertRaises(paths.GitCommandFailed) as caught:
            hooks.inspect(self.root)
        self.assertIn("rev-parse", str(caught.exception))

    def test_a_genuinely_absent_directory_is_still_absent_not_a_fault(self):
        """Non-vacuity. ENOENT is a real answer and must stay one, or every
        repository without a hooks directory becomes exit 2."""
        self.configure("nowhere-at-all")
        found = hooks.inspect(self.root)
        self.assertFalse(found.directory_exists)
        self.assertEqual((), found.hooks)

    def test_a_hooks_path_that_is_a_file_is_absent_not_a_fault(self):
        """ENOTDIR is the other genuine absence: there is no directory
        there, and we established that rather than failing to look."""
        with open(os.path.join(self.root, "notadir"), "w", encoding="utf-8") as handle:
            handle.write("x\n")
        self.configure("notadir")
        found = hooks.inspect(self.root)
        self.assertFalse(found.directory_exists)
        self.assertEqual((), found.hooks)


class WhitespaceInGitOutputTest(HooksFixture):
    """`.strip()` renames a hooks path, and a renamed path is a false A3.

    Verified on git 2.50.1: `config --get core.hooksPath` returns
    ` my hooks \\n` for a value set with its spaces, and
    `rev-parse --git-path hooks` resolves it to `<root>/ my hooks \\n`. Both
    were `.strip()`ed, so the inspection reported a *different* directory than
    the one git would use — and then stat'ed that different directory for
    presence and mode bits.
    """

    def test_a_configured_value_keeps_its_surrounding_spaces(self):
        self.configure(" my hooks ")
        control = S.git(self.root, "config", "--get", "core.hooksPath")
        self.assertEqual(
            b" my hooks \n",
            control.stdout,
            "git stopped preserving the spaces — the fixture is inert",
        )
        self.assertEqual(" my hooks ", hooks.inspect(self.root).configured)

    def test_the_effective_path_keeps_its_trailing_space(self):
        directory = os.path.join(self.root, " my hooks ")
        os.makedirs(directory)
        with open(os.path.join(directory, "pre-commit"), "w", encoding="utf-8") as h:
            h.write("#!/bin/sh\nexit 0\n")
        self.configure(" my hooks ")
        found = hooks.inspect(self.root)
        self.assertTrue(
            found.effective_path.endswith(" my hooks "),
            "the effective path was trimmed to %r" % found.effective_path,
        )
        self.assertTrue(found.directory_exists)
        self.assertEqual(["pre-commit"], [hook.name for hook in found.hooks])


class EntryTypeTest(HooksFixture):
    """Finding text may claim only what was stat'ed (ADR-28).

    Every entry was rendered as *a file present at the effective hooks path*
    with an *executable bit*, whatever it actually was. A subdirectory — a
    `helpers/` beside the hooks, mode 0755 like every directory — therefore
    read as an executable hook, which is a fabricated fact in the one report
    whose whole purpose is to state only what inspection established.
    """

    def rendered(self):
        return [
            "%s | %s | %s" % (item["claim"], item["observed"], item["where"])
            for item in hooks.inspection_findings(hooks.inspect(self.root))
        ]

    def line_for(self, name):
        for line in self.rendered():
            if name in line:
                return line
        raise AssertionError("%r is in no finding: %r" % (name, self.rendered()))

    def test_a_subdirectory_is_not_called_a_file(self):
        directory, _path = self.make_hook_dir(".githooks")
        os.makedirs(os.path.join(directory, "helpers"), 0o755)
        self.configure(".githooks")
        line = self.line_for("helpers")
        self.assertIn("directory", line.lower())
        self.assertNotIn("a file present", line)

    def test_a_subdirectory_is_not_called_executable(self):
        directory, _path = self.make_hook_dir(".githooks")
        os.makedirs(os.path.join(directory, "helpers"), 0o755)
        self.configure(".githooks")
        self.assertNotIn("executable bit set", self.line_for("helpers"))

    def test_a_dangling_symlink_is_named_as_one(self):
        directory, _path = self.make_hook_dir(".githooks")
        os.symlink("gone.sh", os.path.join(directory, "post-commit"))
        self.configure(".githooks")
        line = self.line_for("post-commit")
        self.assertNotIn("a file present", line)
        self.assertNotIn("executable bit set", line)

    def test_a_regular_hook_is_still_a_file_with_its_mode_and_bit(self):
        """Non-vacuity: the real case must keep reading exactly as before."""
        self.make_hook_dir(".githooks", mode=0o755)
        self.configure(".githooks")
        line = self.line_for("pre-commit")
        self.assertIn("a file present", line)
        self.assertIn("755", line)
        self.assertIn("executable bit set", line)

    def test_a_non_executable_regular_hook_still_says_the_bit_is_clear(self):
        self.make_hook_dir(".githooks", mode=0o644)
        self.configure(".githooks")
        line = self.line_for("pre-commit")
        self.assertIn("a file present", line)
        self.assertIn("644", line)
        self.assertIn("executable bit clear", line)


class ReadOnlyTest(HooksFixture):
    """P2.5 / P7.6: nothing written, nothing configured."""

    def snapshot_hooks_directory(self, directory):
        state = {}
        for name in sorted(os.listdir(directory)):
            path = os.path.join(directory, name)
            info = os.lstat(path)
            body = None
            if stat.S_ISREG(info.st_mode):
                with open(path, "rb") as handle:
                    body = handle.read()
            state[name] = (stat.S_IMODE(info.st_mode), body)
        return state

    def test_inspection_leaves_the_working_tree_unchanged(self):
        self.make_hook_dir(".githooks")
        self.configure(".githooks")
        with S.unchanged_tree(self, self.root):
            hooks.inspection_findings(hooks.inspect(self.root))

    def test_inspection_leaves_every_hook_byte_and_mode_identical(self):
        directory, _path = self.make_hook_dir(".githooks", mode=0o644)
        self.make_hook_dir(".githooks", name="pre-push", mode=0o755)
        self.configure(".githooks")
        before = self.snapshot_hooks_directory(directory)
        self.assertTrue(before)
        hooks.inspection_findings(hooks.inspect(self.root))
        self.assertEqual(before, self.snapshot_hooks_directory(directory))

    def test_inspection_configures_nothing(self):
        before = S.git(self.root, "config", "--get", "core.hooksPath")
        hooks.inspect(self.root)
        after = S.git(self.root, "config", "--get", "core.hooksPath")
        self.assertEqual(
            (before.returncode, before.stdout), (after.returncode, after.stdout)
        )

    def test_inspection_does_not_create_the_hooks_directory(self):
        self.configure("nowhere-at-all")
        hooks.inspect(self.root)
        self.assertFalse(os.path.exists(os.path.join(self.root, "nowhere-at-all")))


if __name__ == "__main__":
    unittest.main()
