"""P2.3 / P2.4 — the tracked / untracked / ignored tri-state, commit dates,
repo-root resolution, and the cleanliness assertion every read-only test uses.

**Why a tri-state and not a boolean.** C2 resolves a declared path against the
**working tree, not the index** — requiring trackedness would make the
greenfield path impossible, because `generate`'s output is untracked until a
human runs `git add` and v0 has no staging lifecycle (PDR §3). But a path that
resolves **only** to a git-ignored file is unresolved in the same terms as a
missing one. Two different answers, so two different states, and the third is
what makes the distinction statable at all.

**Dates come from `git log -1 --format=%cI`, never from `mtime`** (ADR-9). The
reference repo holds the live counter-example: a tracked `.editorconfig` whose
mtime is ~2.3 years newer than its last commit (`verified-contracts.md`
§2.3.11, row 2). Nothing here reads `st_mtime`, and a test asserts the module
cannot.

**P2.4's deliverable is the assertion, and an assertion that cannot fail is
worse than none** — it is the vacuous pass this project exists to refuse. So
`CleanlinessGuardTest` fires the guard on purpose, both ways.
"""

import os
import shutil
import unittest

import _support as S

S.import_core()

import gitstate  # noqa: E402
import paths  # noqa: E402


class TriStateFixture(unittest.TestCase):
    def setUp(self):
        self.root = S.make_git_repo()
        self.addCleanup(shutil.rmtree, self.root, True)

    def write(self, relpath, body="x\n"):
        full = os.path.join(self.root, relpath.replace("/", os.sep))
        directory = os.path.dirname(full)
        if directory:
            os.makedirs(directory, exist_ok=True)
        with open(full, "w", encoding="utf-8") as handle:
            handle.write(body)
        return full

    def state(self, relpath):
        return gitstate.path_state(self.root, relpath)


class PathStateTest(TriStateFixture):
    def test_a_committed_path_is_tracked(self):
        self.assertEqual(gitstate.TRACKED, self.state("README.md"))

    def test_a_staged_but_uncommitted_path_is_tracked(self):
        """`git ls-files` reports the index, so staging is enough."""
        self.write("AGENTS.md")
        S.git(self.root, "add", "AGENTS.md")
        self.assertEqual(gitstate.TRACKED, self.state("AGENTS.md"))

    def test_a_fresh_generate_output_is_untracked_not_ignored(self):
        """The greenfield state C2 must still resolve (PDR §3)."""
        self.write("AGENTS.md")
        self.assertEqual(gitstate.UNTRACKED, self.state("AGENTS.md"))

    def test_a_path_matching_gitignore_is_ignored(self):
        self.write(".gitignore", "build/\n*.log\n")
        self.write("build/out.md")
        self.assertEqual(gitstate.IGNORED, self.state("build/out.md"))

    def test_an_ignored_pattern_by_suffix_is_ignored(self):
        self.write(".gitignore", "*.log\n")
        self.write("run.log")
        self.assertEqual(gitstate.IGNORED, self.state("run.log"))

    def track_a_file_matching_an_ignore_rule(self):
        self.write("keep.log")
        S.git(self.root, "add", "-f", "keep.log")
        S.git(self.root, "commit", "-q", "-m", "keep")
        self.write(".gitignore", "*.log\n")

    def test_tracked_beats_ignored(self):
        """The precedence this module owns: trackedness is asked first."""
        self.track_a_file_matching_an_ignore_rule()
        self.assertEqual(gitstate.TRACKED, self.state("keep.log"))

    def test_the_precedence_is_ours_and_not_inherited_from_a_git_default(self):
        """Otherwise the ordering above is a rule no test can fire.

        `git check-ignore` **without** `--no-index` implements the precedence
        itself — it exits 1 on a tracked path — so a module built on the
        default would return `tracked` whichever order it asked in, and
        reordering the two branches would break nothing. Probed here, live, so
        the reason the ordering is load-bearing is a fact and not a comment.
        """
        self.track_a_file_matching_an_ignore_rule()
        default = S.git(self.root, "check-ignore", "-q", "--", "keep.log")
        no_index = S.git(
            self.root, "check-ignore", "-q", "--no-index", "--", "keep.log"
        )
        self.assertEqual(1, default.returncode, "git stopped consulting the index")
        self.assertEqual(
            0,
            no_index.returncode,
            "`--no-index` stopped being the pure pattern question; the "
            "tri-state's ordering would become unreachable again",
        )

    def test_a_path_that_does_not_exist_and_matches_nothing_is_untracked(self):
        """The tri-state answers about git's rules, not about the filesystem:
        existence is C2's question, and it asks it separately (PDR §3)."""
        self.assertEqual(gitstate.UNTRACKED, self.state("nowhere.md"))

    def test_a_path_that_does_not_exist_but_matches_a_rule_is_ignored(self):
        """Pinned rather than left to emerge: with `--no-index` this is a
        statement about the name, and C2 reports the path unresolved either
        way — an ignored path and a missing one are unresolved in the same
        terms (PDR §3)."""
        self.write(".gitignore", "*.log\n")
        self.assertEqual(gitstate.IGNORED, self.state("never-existed.log"))

    def test_a_nested_path_is_answered_root_relative(self):
        self.write("docs/deep/x.md")
        S.git(self.root, "add", "docs/deep/x.md")
        self.assertEqual(gitstate.TRACKED, self.state("docs/deep/x.md"))

    def test_the_three_states_are_the_whole_set(self):
        self.assertEqual(
            ("ignored", "tracked", "untracked"),
            tuple(sorted(gitstate.STATES)),
        )

    def test_every_answer_is_one_of_the_three(self):
        self.write(".gitignore", "*.log\n")
        self.write("run.log")
        self.write("loose.md")
        for candidate in ("README.md", "run.log", "loose.md", "nowhere.md"):
            self.assertIn(self.state(candidate), gitstate.STATES, candidate)


class CommitDateTest(TriStateFixture):
    def test_it_reads_the_committer_date_of_the_last_commit_touching_a_path(self):
        value = gitstate.last_commit_date(self.root, "README.md")
        self.assertIsNotNone(value)
        # `%cI` is strict ISO 8601: 2026-08-13T12:34:56+01:00
        self.assertRegex(
            value, r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$"
        )

    def test_an_untracked_path_has_no_commit_date(self):
        self.write("AGENTS.md")
        self.assertIsNone(gitstate.last_commit_date(self.root, "AGENTS.md"))

    def test_the_repository_wide_date_is_the_head_commit(self):
        self.assertEqual(
            gitstate.last_commit_date(self.root, "README.md"),
            gitstate.last_commit_date(self.root),
        )

    def test_the_date_follows_the_commit_not_the_filesystem(self):
        """ADR-9's whole point: `mtime` moves and the commit date does not."""
        before = gitstate.last_commit_date(self.root, "README.md")
        os.utime(os.path.join(self.root, "README.md"), (0, 0))
        self.assertEqual(before, gitstate.last_commit_date(self.root, "README.md"))

    def test_the_module_cannot_reach_an_mtime(self):
        """Asserted over the module's **code**, not its prose, which is free to
        explain at length why `mtime` is the wrong signal."""
        import ast

        tree = ast.parse(S.read_text(os.path.join(S.CORE_DIR, "gitstate.py")))
        imported = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imported.update(alias.name.split(".")[0] for alias in node.names)
            elif isinstance(node, ast.ImportFrom) and node.module:
                imported.add(node.module.split(".")[0])
            elif isinstance(node, ast.Attribute):
                self.assertNotIn(
                    node.attr,
                    ("st_mtime", "st_ctime", "getmtime", "stat", "utime", "time"),
                    "gitstate.py reaches for a filesystem clock",
                )
        self.assertEqual(
            {"paths"},
            imported,
            "with only `paths` in scope there is no `os` or `time` to ask",
        )


class RepoRootTest(TriStateFixture):
    """P2.4 — the root always comes from cwd via git (ADR-26)."""

    def test_it_resolves_from_the_root(self):
        self.assertEqual(self.root, paths.repo_root(self.root))

    def test_it_resolves_the_same_root_from_a_subdirectory(self):
        nested = os.path.join(self.root, "docs", "deep")
        os.makedirs(nested)
        self.assertEqual(self.root, paths.repo_root(nested))

    def test_a_linked_worktree_resolves_to_its_own_root(self):
        """§2.3.6: a linked worktree's `--show-toplevel` is the *linked* root,
        not the main one. 106 of them existed in the reference monorepo."""
        linked = self.root + "-worktree"
        self.addCleanup(shutil.rmtree, linked, True)
        result = S.git(self.root, "worktree", "add", "-q", "-b", "wt", linked)
        self.assertEqual(0, result.returncode, result.stdout + result.stderr)
        self.addCleanup(S.git, self.root, "worktree", "prune")
        self.assertEqual(os.path.realpath(linked), paths.repo_root(linked))

    def test_the_tri_state_answers_per_worktree(self):
        linked = self.root + "-worktree2"
        self.addCleanup(shutil.rmtree, linked, True)
        S.git(self.root, "worktree", "add", "-q", "-b", "wt2", linked)
        self.addCleanup(S.git, self.root, "worktree", "prune")
        with open(os.path.join(linked, "only-here.md"), "w", encoding="utf-8") as h:
            h.write("x\n")
        self.assertEqual(
            gitstate.UNTRACKED, gitstate.path_state(linked, "only-here.md")
        )
        self.assertEqual(gitstate.TRACKED, gitstate.path_state(linked, "README.md"))


class CleanlinessGuardTest(TriStateFixture):
    """P2.4 — the guard every read-only test leans on, proven able to fail.

    Two ways, because porcelain alone has a real blind spot: it collapses an
    untracked directory to a single line, so a verb that created a **second**
    file inside an already-untracked directory leaves `git status --porcelain`
    byte-identical.
    """

    def test_it_passes_when_nothing_changes(self):
        with S.unchanged_tree(self, self.root):
            gitstate.path_state(self.root, "README.md")

    def test_it_fails_when_a_new_file_appears(self):
        with self.assertRaises(AssertionError):
            with S.unchanged_tree(self, self.root):
                self.write("written-by-a-read-only-verb.md")

    def test_it_fails_when_a_tracked_file_is_edited(self):
        with self.assertRaises(AssertionError):
            with S.unchanged_tree(self, self.root):
                self.write("README.md", "edited\n")

    def test_it_fails_on_a_second_file_inside_an_already_untracked_directory(self):
        """The porcelain blind spot, which is why the guard lists every
        untracked file rather than trusting the collapsed summary."""
        self.write("docs/steward/routing-map.md")
        with self.assertRaises(AssertionError):
            with S.unchanged_tree(self, self.root):
                self.write("docs/steward/orphans.md")

    def test_it_fails_when_the_index_changes(self):
        self.write("staged-later.md")
        S.git(self.root, "add", "-A")
        S.git(self.root, "commit", "-q", "-m", "base")
        self.write("staged-later.md", "edited\n")
        with self.assertRaises(AssertionError):
            with S.unchanged_tree(self, self.root):
                S.git(self.root, "add", "staged-later.md")


class ReadOnlyTest(TriStateFixture):
    def test_the_tri_state_and_the_date_write_nothing(self):
        self.write(".gitignore", "*.log\n")
        self.write("run.log")
        S.git(self.root, "add", "-A")
        S.git(self.root, "commit", "-q", "-m", "ignore")
        with S.unchanged_tree(self, self.root):
            gitstate.path_state(self.root, "run.log")
            gitstate.path_state(self.root, "README.md")
            gitstate.path_state(self.root, "nowhere.md")
            gitstate.last_commit_date(self.root, "README.md")
            gitstate.last_commit_date(self.root)


if __name__ == "__main__":
    unittest.main()
