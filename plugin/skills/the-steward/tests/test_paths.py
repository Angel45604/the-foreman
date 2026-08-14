"""P1.9 — the containment predicate (ADR-26) and DEBT ITEM 7.

ADR-26: every path of **repository data** the core reads or writes must
resolve, after symlink resolution, inside `git rev-parse --show-toplevel`.
Escape is exit 2. The repo root always comes from cwd via git, never from the
core's own location.

DEBT ITEM 7 (safety, FROZEN-DEBT.md #7) — "Ownership compares recorded vs
on-disk bytes only, so a schema-valid foreign manifest can record an IN-TREE
SYMLINK and pass the digest check." Resolving symlinks is not enough on its
own: an in-tree symlink resolves to an in-tree path and passes ADR-26. The
second limb is therefore required — a target whose **path component chain
crosses a symlink** is never writable in place. `TargetIsSymlinkedTest` builds
the exact attack and shows the digest check alone waving it through.
"""

import hashlib
import io
import os
import shutil
import unittest

import _support as S

S.import_core()

import atomic  # noqa: E402
import cli  # noqa: E402
import paths  # noqa: E402


def sha256_of(path):
    with open(path, "rb") as handle:
        return hashlib.sha256(handle.read()).hexdigest()


class RepoRootTest(unittest.TestCase):
    def setUp(self):
        self.root = S.make_git_repo()
        self.addCleanup(shutil.rmtree, self.root, True)

    def test_resolves_from_cwd(self):
        self.assertEqual(self.root, paths.repo_root(self.root))

    def test_resolves_from_a_subdirectory(self):
        nested = os.path.join(self.root, "a", "b")
        os.makedirs(nested)
        self.assertEqual(self.root, paths.repo_root(nested))

    def test_returns_none_outside_a_repository(self):
        """The environment guard must consult **git**, not `repo_root`.

        Guarding with `if paths.repo_root(outside) is not None: skipTest(...)`
        and then asserting the same call is None is unfailable: the subject
        under test decides whether its own assertion runs, so a `repo_root`
        that always returns a path skips instead of failing. Git is the
        independent oracle for the environment fact.
        """
        outside = os.path.realpath(
            os.path.join(self.root, os.pardir, "definitely-not-a-repo-%d" % os.getpid())
        )
        os.makedirs(outside)
        self.addCleanup(shutil.rmtree, outside, True)
        if S.git(outside, "rev-parse", "--show-toplevel").returncode == 0:
            self.skipTest("the system temp dir is itself inside a git repository")
        self.assertIsNone(paths.repo_root(outside))


class GitAnsweredTest(unittest.TestCase):
    """One place decides what a git exit status *means* (ADR-13).

    `git_checked` is the `answers=(0,)` case and `git_answered` is the general
    one, because some commands answer with a status: `check-ignore -q` says
    *matched* with 0 and *no rule matches* with 1. What both refuse is the
    third reading — `if code != 0`, which collapses *no* and *the probe
    failed* into one value and lets a broken invocation be reported as a
    finding-free result. Exercised against real git, with real failures.
    """

    def setUp(self):
        self.root = S.make_git_repo()
        self.addCleanup(shutil.rmtree, self.root, True)

    def test_a_status_in_answers_is_returned_not_raised(self):
        code, _out = paths.git_answered(
            self.root, ["check-ignore", "-q", "--no-index", "--", "plain.md"], (0, 1)
        )
        self.assertEqual(1, code, "git stopped using 1 for `no rule matches`")

    def test_a_status_outside_answers_faults(self):
        with self.assertRaises(paths.GitCommandFailed) as caught:
            paths.git_answered(
                self.root,
                ["check-ignore", "-q", "--no-index", "--", "../outside.md"],
                (0, 1),
            )
        message = str(caught.exception)
        self.assertIn("check-ignore", message)
        self.assertIn("128", message)

    def test_git_checked_is_the_zero_only_case(self):
        """Same real failure, admitted by neither: `ls-files` has no non-zero
        answer at all."""
        with self.assertRaises(paths.GitCommandFailed) as caught:
            paths.git_checked(self.root, ["ls-files", "-z", "--", "../outside.md"])
        self.assertIn("ls-files", str(caught.exception))

    def test_git_checked_returns_stdout_on_success(self):
        out = paths.git_checked(self.root, ["ls-files", "-z", "--", "*.md"])
        self.assertEqual(b"README.md\0", out)


class ContainTest(unittest.TestCase):
    def setUp(self):
        self.root = S.make_git_repo()
        self.addCleanup(shutil.rmtree, self.root, True)
        self.outside_dir = os.path.realpath(
            os.path.join(self.root, os.pardir, "steward-outside-%d" % os.getpid())
        )
        os.makedirs(self.outside_dir, exist_ok=True)
        self.addCleanup(shutil.rmtree, self.outside_dir, True)
        self.victim = os.path.join(self.outside_dir, "VICTIM.txt")
        with open(self.victim, "w", encoding="utf-8") as handle:
            handle.write("untouched\n")

    def test_a_plain_relative_path_is_contained(self):
        self.assertEqual(
            os.path.join(self.root, "AGENTS.md"), paths.contain(self.root, "AGENTS.md")
        )

    def test_a_nested_relative_path_is_contained(self):
        self.assertEqual(
            os.path.join(self.root, "docs", "steward", "orphans.md"),
            paths.contain(self.root, "docs/steward/orphans.md"),
        )

    def test_the_root_itself_is_contained(self):
        self.assertEqual(self.root, paths.contain(self.root, "."))

    def test_a_dotdot_traversal_escapes(self):
        with self.assertRaises(paths.ContainmentError) as caught:
            paths.contain(self.root, "../VICTIM.txt")
        self.assertIn("VICTIM.txt", str(caught.exception))
        self.assertEqual("untouched\n", S.read_text(self.victim))

    def test_a_buried_dotdot_traversal_escapes(self):
        with self.assertRaises(paths.ContainmentError):
            paths.contain(self.root, "docs/../../VICTIM.txt")

    def test_an_absolute_path_outside_the_tree_escapes(self):
        with self.assertRaises(paths.ContainmentError):
            paths.contain(self.root, self.victim)

    def test_a_sibling_directory_sharing_the_root_prefix_escapes(self):
        """`/tmp/repo-evil` must not pass a naive startswith('/tmp/repo')."""
        sibling = self.root + "-evil"
        os.makedirs(sibling, exist_ok=True)
        self.addCleanup(shutil.rmtree, sibling, True)
        with self.assertRaises(paths.ContainmentError):
            paths.contain(self.root, os.path.join(sibling, "AGENTS.md"))

    def test_a_symlinked_directory_pointing_out_escapes(self):
        os.symlink(self.outside_dir, os.path.join(self.root, "docs"))
        with self.assertRaises(paths.ContainmentError) as caught:
            paths.contain(self.root, "docs/VICTIM.txt")
        self.assertIn("VICTIM.txt", str(caught.exception))
        self.assertEqual("untouched\n", S.read_text(self.victim))

    def test_a_symlinked_file_pointing_out_escapes(self):
        os.symlink(self.victim, os.path.join(self.root, "AGENTS.md"))
        with self.assertRaises(paths.ContainmentError):
            paths.contain(self.root, "AGENTS.md")

    def test_a_symlink_pointing_back_inside_is_contained(self):
        """ADR-26 alone lets this through — which is exactly debt item 7."""
        with open(os.path.join(self.root, "real.md"), "w", encoding="utf-8") as handle:
            handle.write("x\n")
        os.symlink("real.md", os.path.join(self.root, "AGENTS.md"))
        self.assertEqual(
            os.path.join(self.root, "real.md"), paths.contain(self.root, "AGENTS.md")
        )


class CrossesSymlinkTest(unittest.TestCase):
    """DEBT ITEM 7, limb two."""

    def setUp(self):
        self.root = S.make_git_repo()
        self.addCleanup(shutil.rmtree, self.root, True)

    def test_a_plain_path_crosses_nothing(self):
        self.assertFalse(paths.crosses_symlink(self.root, "AGENTS.md"))
        self.assertFalse(paths.crosses_symlink(self.root, "docs/steward/orphans.md"))

    def test_the_final_component_being_a_symlink_counts(self):
        with open(os.path.join(self.root, "real.md"), "w", encoding="utf-8") as handle:
            handle.write("x\n")
        os.symlink("real.md", os.path.join(self.root, "AGENTS.md"))
        self.assertTrue(paths.crosses_symlink(self.root, "AGENTS.md"))

    def test_an_ancestor_component_being_a_symlink_counts(self):
        os.makedirs(os.path.join(self.root, "real-docs", "steward"))
        os.symlink("real-docs", os.path.join(self.root, "docs"))
        self.assertTrue(
            paths.crosses_symlink(self.root, "docs/steward/routing-map.md")
        )

    def test_a_broken_symlink_counts(self):
        os.symlink("nowhere.md", os.path.join(self.root, "AGENTS.md"))
        self.assertTrue(paths.crosses_symlink(self.root, "AGENTS.md"))

    def test_a_dotdot_component_is_refused_outright(self):
        with self.assertRaises(paths.ContainmentError):
            paths.crosses_symlink(self.root, "../AGENTS.md")


class TargetIsSymlinkedTest(unittest.TestCase):
    """DEBT ITEM 7, end to end: the digest check alone waves the attack through."""

    def setUp(self):
        self.root = S.make_git_repo()
        self.addCleanup(shutil.rmtree, self.root, True)

    def test_a_plain_absent_or_regular_target_is_writable_in_place(self):
        self.assertTrue(paths.target_is_writable_in_place(self.root, "AGENTS.md"))
        with open(os.path.join(self.root, "AGENTS.md"), "w", encoding="utf-8") as handle:
            handle.write("ours\n")
        self.assertTrue(paths.target_is_writable_in_place(self.root, "AGENTS.md"))

    def test_an_in_tree_symlink_recorded_with_a_matching_digest_is_refused(self):
        secret = os.path.join(self.root, "secrets.txt")
        with open(secret, "w", encoding="utf-8") as handle:
            handle.write("do not clobber me\n")
        os.symlink("secrets.txt", os.path.join(self.root, "AGENTS.md"))

        # A foreign but schema-valid manifest records AGENTS.md with the digest
        # of the bytes now readable there. Byte comparison alone SUCCEEDS...
        recorded_digest = sha256_of(secret)
        self.assertEqual(
            recorded_digest, sha256_of(os.path.join(self.root, "AGENTS.md"))
        )
        # ...and ADR-26 containment alone also succeeds, because the link
        # points back inside the tree.
        paths.contain(self.root, "AGENTS.md")
        # The predicate is what refuses it.
        self.assertFalse(
            paths.target_is_writable_in_place(self.root, "AGENTS.md"),
            "an in-tree symlink passed the ownership predicate — create-only "
            "is defeated: a write to AGENTS.md would clobber secrets.txt",
        )

    def test_a_symlinked_parent_directory_is_refused(self):
        os.makedirs(os.path.join(self.root, "real-docs"))
        os.symlink("real-docs", os.path.join(self.root, "docs"))
        self.assertFalse(
            paths.target_is_writable_in_place(self.root, "docs/steward/orphans.md")
        )

    def test_an_escaping_target_is_exit_two_not_merely_unwritable(self):
        with self.assertRaises(paths.ContainmentError):
            paths.target_is_writable_in_place(self.root, "../AGENTS.md")


class EscapeExitsTwoThroughTheCliTest(unittest.TestCase):
    """P1.9 says each escape is **exit 2** — observed, not read.

    `ContainmentError` is in `cli.REPORTED_FAULTS`, but until now that was
    asserted by reading `cli.py`, which is the failure mode this project
    exists to refuse. Only `ManifestError` had an end-to-end proof.

    **Disclosure — where the seam is.** v0 has no flags, so nothing on a
    command line can name a repository-data path, and no Phase-1 verb computes
    one (they are stubs until Phases 3/4/6/7). The escaping *path* is
    therefore injected at the verb seam — the same seam `ToolFailureTest`
    already uses. Everything below that seam is production code: the real
    `atomic.write`, the real `paths.contain`, and the real fault handling in
    `cli.main`. What is proven here is the mapping — a genuine escape from the
    real predicate leaves the process at **exit 2**, with the path named and
    **no traceback** (a predicted fault must not read as a crash, ADR-13) —
    and that the victim outside the tree is byte-identical afterwards.
    """

    def setUp(self):
        self.root = S.make_git_repo()
        self.addCleanup(shutil.rmtree, self.root, True)
        self.outside_dir = os.path.realpath(
            os.path.join(self.root, os.pardir, "steward-cli-escape-%d" % os.getpid())
        )
        os.makedirs(self.outside_dir, exist_ok=True)
        self.addCleanup(shutil.rmtree, self.outside_dir, True)
        self.victim = os.path.join(self.outside_dir, "VICTIM.txt")
        with open(self.victim, "w", encoding="utf-8") as handle:
            handle.write("untouched\n")

    def run_a_verb_writing(self, relpath):
        """Dispatch `check` through the real `cli.main`, with a verb whose only
        act is one real `atomic.write` at `relpath`."""

        def verb(context):
            atomic.write(context.repo_root, relpath, b"clobbered\n")
            return cli.EXIT_OK

        original = dict(cli.VERBS)
        out, err = io.StringIO(), io.StringIO()
        try:
            cli.VERBS["check"] = verb
            code = cli.main(["check"], out, err, cwd=self.root)
        finally:
            cli.VERBS.clear()
            cli.VERBS.update(original)
        return code, out.getvalue(), err.getvalue()

    def assert_exit_two_and_victim_intact(self, relpath):
        code, _out, err = self.run_a_verb_writing(relpath)
        self.assertEqual(2, code, "escape %r did not exit 2: %s" % (relpath, err))
        self.assertIn("VICTIM.txt", err, err)
        self.assertNotIn("Traceback", err, "a predicted fault printed a crash")
        self.assertEqual("untouched\n", S.read_text(self.victim))

    def test_a_dotdot_traversal_exits_two(self):
        self.assert_exit_two_and_victim_intact("../VICTIM.txt")

    def test_an_absolute_path_outside_the_tree_exits_two(self):
        self.assert_exit_two_and_victim_intact(self.victim)

    def test_a_symlinked_directory_pointing_out_exits_two(self):
        os.symlink(self.outside_dir, os.path.join(self.root, "docs"))
        self.assert_exit_two_and_victim_intact("docs/VICTIM.txt")

    def test_an_in_tree_symlink_exits_two(self):
        """DEBT ITEM 7 through the CLI: refused, and reported as a fault."""
        secret = os.path.join(self.root, "secrets.txt")
        with open(secret, "w", encoding="utf-8") as handle:
            handle.write("do not clobber me\n")
        os.symlink("secrets.txt", os.path.join(self.root, "AGENTS.md"))
        code, _out, err = self.run_a_verb_writing("AGENTS.md")
        self.assertEqual(2, code, err)
        self.assertIn("symlink", err)
        self.assertNotIn("Traceback", err)
        self.assertEqual("do not clobber me\n", S.read_text(secret))

    def test_the_control_writing_inside_the_tree_exits_zero(self):
        """Without this, 'exit 2' above could just mean 'an injected verb'."""
        code, _out, err = self.run_a_verb_writing("docs/steward/orphans.md")
        self.assertEqual(0, code, err)
        self.assertEqual("", err)
        self.assertEqual(
            "clobbered\n",
            S.read_text(os.path.join(self.root, "docs", "steward", "orphans.md")),
        )


class CoreSourceExemptionTest(unittest.TestCase):
    """ADR-26's single exemption: the executing core's own source directory,
    read-only, and only for files its own inventory lists."""

    def test_the_core_may_read_a_listed_file_outside_the_tree(self):
        import inventory

        path = paths.core_source_path("__main__.py")
        self.assertTrue(os.path.isfile(path))
        self.assertIn("__main__.py", inventory.FILES)
        with open(path, "rb") as handle:
            self.assertTrue(handle.read())

    def test_the_core_may_not_read_an_unlisted_file_in_its_own_directory(self):
        with self.assertRaises(paths.ContainmentError):
            paths.core_source_path("not-in-the-inventory.py")

    def test_the_exemption_does_not_extend_to_traversal(self):
        for candidate in ("../SKILL.md", "../../keep-it-simple/SKILL.md", "/etc/hosts"):
            with self.assertRaises(paths.ContainmentError, msg=candidate):
                paths.core_source_path(candidate)

    def test_the_core_source_directory_is_outside_a_target_repo(self):
        root = S.make_git_repo()
        self.addCleanup(shutil.rmtree, root, True)
        with self.assertRaises(paths.ContainmentError):
            paths.contain(root, paths.core_source_path("__main__.py"))


class BootstrapInvocationTest(unittest.TestCase):
    """ADR-1's sanctioned bootstrap form, run for real."""

    def setUp(self):
        self.root = S.make_git_repo()
        self.addCleanup(shutil.rmtree, self.root, True)

    def test_root_resolves_from_cwd_not_from_the_core_location(self):
        result = S.run_core(S.MODERN_PYTHON, ["scan"], cwd=self.root)
        self.assertEqual(
            0, result.returncode, result.stderr.decode("utf-8", "replace")
        )
        self.assertEqual(b"", result.stderr)

    def test_it_advertises_no_tools_steward_command_with_no_core_installed(self):
        result = S.run_core(S.MODERN_PYTHON, ["scan"], cwd=self.root)
        output = (result.stdout + result.stderr).decode("utf-8", "replace")
        self.assertNotIn("tools/steward", output)

    def test_it_advertises_the_installed_form_once_a_core_is_there(self):
        installed = os.path.join(self.root, "tools", "steward")
        os.makedirs(installed)
        shutil.copy(
            os.path.join(S.CORE_DIR, "__main__.py"),
            os.path.join(installed, "__main__.py"),
        )
        result = S.run_core(S.MODERN_PYTHON, ["scan"], cwd=self.root)
        output = result.stdout.decode("utf-8", "replace")
        self.assertIn("python3 -B tools/steward scan", output)

    def test_the_bootstrap_run_leaves_the_working_tree_untouched(self):
        before = S.porcelain(self.root)
        S.run_core(S.MODERN_PYTHON, ["scan"], cwd=self.root)
        self.assertEqual(before, S.porcelain(self.root))


if __name__ == "__main__":
    unittest.main()
