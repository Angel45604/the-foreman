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

import os
import shutil
import stat
import unittest

import _support as S

S.import_core()

import hooks  # noqa: E402


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
