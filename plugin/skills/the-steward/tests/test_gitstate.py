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
import subprocess
import tempfile
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

    def track_a_file_matching_an_ignore_rule(self):
        self.write("keep.log")
        S.git(self.root, "add", "-f", "keep.log")
        S.git(self.root, "commit", "-q", "-m", "keep")
        self.write(".gitignore", "*.log\n")


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

    # ------------------------------------------------------------------
    # The porcelain blind spots that make a *name-preserving* rewrite
    # invisible. `git status` reports which paths differ from the index; for
    # a path that is not in the index it reports the same one line whatever
    # the bytes are, and for an ignored path it reports nothing at all. Every
    # `unchanged_tree` in the suite is an assertion about *bytes*, so each of
    # these is a way a read-only verb could rewrite a file and stay green.
    # ------------------------------------------------------------------

    def test_it_fails_when_an_existing_untracked_file_is_rewritten(self):
        """The greenfield state this whole design is about: `generate`'s
        output is untracked until a human stages it, so "a read-only verb
        rewrote a freshly generated artifact" is precisely the bug the guard
        has to be able to see."""
        self.write("AGENTS.md", "generated\n")
        with self.assertRaises(AssertionError):
            with S.unchanged_tree(self, self.root):
                self.write("AGENTS.md", "rewritten by a read-only verb\n")

    def test_it_fails_when_an_ignored_file_is_rewritten(self):
        self.write(".gitignore", "*.log\n")
        S.git(self.root, "add", "-A")
        S.git(self.root, "commit", "-q", "-m", "ignore")
        self.write("run.log", "before\n")
        with self.assertRaises(AssertionError):
            with S.unchanged_tree(self, self.root):
                self.write("run.log", "after\n")

    def test_it_fails_when_an_ignored_file_appears(self):
        self.write(".gitignore", "*.log\n")
        S.git(self.root, "add", "-A")
        S.git(self.root, "commit", "-q", "-m", "ignore")
        with self.assertRaises(AssertionError):
            with S.unchanged_tree(self, self.root):
                self.write("appeared.log")

    def test_it_fails_when_a_mode_bit_changes_on_an_untracked_file(self):
        full = self.write("hook-ish.sh")
        with self.assertRaises(AssertionError):
            with S.unchanged_tree(self, self.root):
                os.chmod(full, 0o755)

    def test_it_fails_when_a_symlink_is_retargeted(self):
        self.write("a.md", "a\n")
        self.write("b.md", "b\n")
        link = os.path.join(self.root, "link.md")
        os.symlink("a.md", link)
        with self.assertRaises(AssertionError):
            with S.unchanged_tree(self, self.root):
                os.unlink(link)
                os.symlink("b.md", link)

    def test_it_fails_when_an_empty_directory_appears(self):
        with self.assertRaises(AssertionError):
            with S.unchanged_tree(self, self.root):
                os.makedirs(os.path.join(self.root, "docs", "steward"))

    # ------------------------------------------------------------------
    # The oracle's own failed-probe costume — instance **twelve**, and the
    # first one inside the test-support layer rather than the core. The guard
    # ran `git status` and read its stdout without ever looking at its status.
    # Remove or corrupt `.git/index` and the second `status` exits 128 with
    # **empty** stdout; the walk excludes `.git`; so the snapshot equals the
    # clean one and the guard *passes*. "Nothing changed" and "I could not
    # look" became the same reading, in the one place whose entire job is to
    # tell those apart — and an oracle that cannot fail is worth less than no
    # oracle, because every read-only test in the suite leans on it.
    # ------------------------------------------------------------------

    def test_it_fails_when_its_own_git_probe_fails(self):
        with self.assertRaises(AssertionError) as caught:
            with S.unchanged_tree(self, self.root):
                os.remove(os.path.join(self.root, ".git", "index"))
                os.mkdir(os.path.join(self.root, ".git", "index"))
        self.assertIn("git status", str(caught.exception))

    def test_the_damaged_probe_really_does_answer_empty(self):
        """Without this the test above could pass because the *walk* saw
        something, leaving the ignored status a live bug behind a green test.
        """
        os.remove(os.path.join(self.root, ".git", "index"))
        os.mkdir(os.path.join(self.root, ".git", "index"))
        broken = S.git(self.root, "status", "--porcelain", "--untracked-files=all")
        self.assertNotEqual(0, broken.returncode, "the fixture did not break git")
        self.assertEqual(b"", broken.stdout, "the fixture's probe still answered")

    def test_it_reports_what_the_failed_probe_said(self):
        """A fault that cannot say why is the next version of this bug."""
        os.remove(os.path.join(self.root, ".git", "index"))
        os.mkdir(os.path.join(self.root, ".git", "index"))
        with self.assertRaises(AssertionError) as caught:
            S.tree_snapshot(self.root)
        message = str(caught.exception)
        self.assertIn(self.root, message)
        self.assertIn("index", message, "git's own stderr is not in the fault")

    def test_the_other_oracle_faults_on_a_failed_probe_too(self):
        """`S.porcelain` is the same oracle without the walk, and four suites
        assert `assertEqual("", S.porcelain(root))` against it. It was found
        by pointing the structural guard at the test-support layer, not by
        anyone noticing it — which is the argument for the widened scan."""
        self.assertEqual("", S.porcelain(self.root), "the control is not clean")
        os.remove(os.path.join(self.root, ".git", "index"))
        os.mkdir(os.path.join(self.root, ".git", "index"))
        with self.assertRaises(AssertionError) as caught:
            S.porcelain(self.root)
        self.assertIn("index", str(caught.exception))

    def test_it_ignores_churn_inside_the_git_directory(self):
        """The guard is about repository *data*. git rewrites its own
        bookkeeping (`index`, logs, `gc` output) on reads we do not control,
        so digesting `.git` would make the guard flaky rather than strict."""
        with S.unchanged_tree(self, self.root):
            gitstate.path_state(self.root, "README.md")
            S.git(self.root, "status")


class GitFailureIsNeverAConfidentAnswerTest(TriStateFixture):
    """ADR-13 / ADR-30, the `corpus` rule applied to the tri-state.

    `if code != 0: return False` is the same shape as `if code != 0: return []`
    one module over: it turns a git invocation that **failed** into the
    confident answer `untracked`. Downstream that is the disease itself — C2
    treats untracked-but-present as *resolved*, so a claim would be reported
    verified off a probe that never ran. Only statuses git uses as answers are
    answers; everything else is a fault, and a fault is exit 2.
    """

    def not_a_repository(self, tag):
        outside = os.path.realpath(
            os.path.join(
                self.root, os.pardir, "steward-not-a-repo-%s-%d" % (tag, os.getpid())
            )
        )
        os.makedirs(outside, exist_ok=True)
        self.addCleanup(shutil.rmtree, outside, True)
        if S.git(outside, "rev-parse", "--show-toplevel").returncode == 0:
            self.skipTest("the system temp dir is itself inside a git repository")
        return outside

    def test_a_path_outside_the_repository_faults_rather_than_reading_untracked(self):
        """Every probe fails here: `ls-files` exits 128 and so does
        `check-ignore`. Answering `untracked` off two failures is the vacuous
        pass with our own plumbing as the cause."""
        with self.assertRaises(paths.GitCommandFailed) as caught:
            self.state("../outside.md")
        self.assertIn("ls-files", str(caught.exception))

    def test_outside_a_repository_the_tri_state_faults(self):
        outside = self.not_a_repository("tristate")
        with self.assertRaises(paths.GitCommandFailed) as caught:
            gitstate.path_state(outside, "anything.md")
        self.assertIn("128", str(caught.exception))

    def test_it_exits_two_through_the_cli(self):
        import io

        import cli

        outside = self.not_a_repository("cli")

        def verb(context):
            gitstate.path_state(outside, "anything.md")
            return cli.EXIT_OK

        original = dict(cli.VERBS)
        out, err = io.StringIO(), io.StringIO()
        try:
            cli.VERBS["check"] = verb
            code = cli.main(["check"], out, err, cwd=self.root)
        finally:
            cli.VERBS.clear()
            cli.VERBS.update(original)
        message = err.getvalue()
        self.assertEqual(2, code, message)
        self.assertNotIn("Traceback", message, "a predicted fault printed a crash")
        self.assertIn("ls-files", message)

    def test_check_ignore_exit_one_stays_a_real_answer(self):
        """The other half of the rule: `check-ignore -q` uses **1** for *no
        rule matches*, so faulting on every non-zero would make `untracked`
        unreachable. `{0, 1}` are answers; nothing else is."""
        self.write("AGENTS.md")
        self.assertEqual(1, S.git(
            self.root, "check-ignore", "-q", "--no-index", "--", "AGENTS.md"
        ).returncode)
        self.assertEqual(gitstate.UNTRACKED, self.state("AGENTS.md"))

    def test_a_check_ignore_status_that_is_not_an_answer_faults(self):
        """`ls-files` can succeed and `check-ignore` still fail — a corrupt
        `.gitignore` chain, a `core.excludesFile` git cannot read.

        Failed **at the child**, at `paths._run`'s documented single spawn
        site, because no fixture makes real git fail *there alone*: every
        pathspec that breaks `check-ignore` breaks `ls-files` first, so the
        composition would otherwise be untestable and 128 would go on reading
        as *no rule matches*. Only the child's exit status is fabricated; both
        modules' own logic runs for real.
        """
        real = paths._run

        def failing_check_ignore(cwd, args, *rest):
            if args and args[0] == "check-ignore":
                return subprocess.CompletedProcess(
                    args, 128, b"", b"fatal: cannot read excludes file"
                )
            return real(cwd, args, *rest)

        paths._run = failing_check_ignore
        self.addCleanup(setattr, paths, "_run", real)
        self.write("AGENTS.md")
        with self.assertRaises(paths.GitCommandFailed) as caught:
            self.state("AGENTS.md")
        self.assertIn("check-ignore", str(caught.exception))


class CommitDateAmbiguityIsDeliberateTest(unittest.TestCase):
    """The one site that is **not** fixed, pinned so it stays a decision.

    Every other git call in the core separates answers from failures by exit
    status. `git log -1` cannot: **128** is the real answer *no commit touches
    this path* in a repository with no commits, and it is also every genuine
    failure. This is a pin, not a bugfix — it fails if someone tightens the
    site into `git_checked` and makes a fresh `git init` exit 2, and it records
    the probe so the next reader does not have to re-derive it.
    """

    def setUp(self):
        self.root = os.path.realpath(
            tempfile.mkdtemp(prefix="steward-no-commits-")
        )
        self.addCleanup(shutil.rmtree, self.root, True)
        S.git(self.root, "init", "-q")

    def test_a_repository_with_no_commits_answers_none_and_does_not_fault(self):
        """The greenfield criterion: `git init`, then run the tool. If 128 were
        a fault this would be exit 2 on every brand-new repository."""
        self.assertEqual(128, S.git(self.root, "log", "-1", "--format=%cI").returncode)
        self.assertIsNone(gitstate.last_commit_date(self.root))
        self.assertIsNone(gitstate.last_commit_date(self.root, "README.md"))

    def test_the_answer_and_the_failure_are_the_same_status(self):
        """Why `git_answered` cannot help: the set that admits the answer
        admits the failure too, so it would only rename the ambiguity."""
        S.git(self.root, "config", "user.email", "fixture@example.invalid")
        S.git(self.root, "config", "user.name", "Fixture")
        with open(os.path.join(self.root, "a.md"), "w", encoding="utf-8") as handle:
            handle.write("a\n")
        S.git(self.root, "add", "a.md")
        S.git(self.root, "-c", "commit.gpgsign=false", "commit", "-q", "-m", "init")
        # A pathspec that matches nothing is exit 0 with empty output — so the
        # only *answers* git spends 128 on are the two indistinguishable ones.
        self.assertEqual(
            0, S.git(self.root, "log", "-1", "--format=%cI", "--", "nope.md").returncode
        )
        self.assertEqual(
            128,
            S.git(self.root, "log", "-1", "--format=%cI", "--", "../outside.md").returncode,
        )

    def test_the_value_cannot_manufacture_a_pass(self):
        """The blast radius is what makes the ambiguity tolerable: a date is a
        report line, never a verdict. Nothing in the core branches on it."""
        for module in ("cli.py", "findings.py", "manifest.py", "corpus.py", "hooks.py"):
            source = S.read_text(os.path.join(S.CORE_DIR, module))
            self.assertNotIn("last_commit_date", source, module)


class TheArgvIsTheContractTest(TriStateFixture):
    """D2 — the guard above probes **git**; this one probes the **module**.

    `test_the_precedence_is_ours_and_not_inherited_from_a_git_default` asks git
    directly what `--no-index` does, so it cannot notice the module dropping
    the flag: deleting `--no-index` from `_matches_an_ignore_rule` left the
    whole suite green, and deleting it *and* reversing the two branches also
    left it green. Both mutations are observable only in the argv the module
    actually builds, so the argv is what this asserts.
    """

    def record_the_argv(self):
        """Recorded at `paths._run`, the one spawn site, so the reading does
        not depend on which wrapper the module happens to call through."""
        real = paths._run
        seen = []

        def recording(cwd, args, *rest):
            seen.append(list(args))
            return real(cwd, args, *rest)

        paths._run = recording
        self.addCleanup(setattr, paths, "_run", real)
        return seen

    def subcommand(self, args):
        """The git subcommand, past any git-level options in front of it."""
        for token in args:
            if not token.startswith("-"):
                return token
        return None

    def test_the_ignore_probe_passes_no_index(self):
        self.write(".gitignore", "*.log\n")
        self.write("run.log")
        seen = self.record_the_argv()
        self.assertEqual(gitstate.IGNORED, self.state("run.log"))
        probes = [args for args in seen if self.subcommand(args) == "check-ignore"]
        self.assertEqual(1, len(probes), seen)
        self.assertIn(
            "--no-index",
            probes[0],
            "without `--no-index` git applies its own index-over-ignore "
            "precedence and this module's ordering becomes unreachable",
        )

    def test_trackedness_is_asked_first(self):
        """The precedence, read off the call order rather than off an answer
        that git would produce either way."""
        self.track_a_file_matching_an_ignore_rule()
        seen = self.record_the_argv()
        self.assertEqual(gitstate.TRACKED, self.state("keep.log"))
        self.assertEqual(
            ["ls-files"],
            [self.subcommand(args) for args in seen],
            "either `check-ignore` was asked first, or it was asked at all "
            "after `ls-files` already said tracked",
        )

    def test_every_probe_passes_the_declared_path_literally(self):
        """The argv is the only place the literal rule is visible.

        Both halves are asserted, because each is silent about the other:
        `--literal-pathspecs` turns off globbing but `check-ignore` refuses
        it, and the `./` prefix is what disarms a leading `:` in every
        command. A module that dropped either half would answer correctly for
        ordinary paths and wrongly for exactly the paths this exists for.
        """
        self.write(".gitignore", "*.log\n")
        seen = self.record_the_argv()
        self.assertEqual(gitstate.UNTRACKED, self.state("docs/notes.md"))
        gitstate.last_commit_date(self.root, "docs/notes.md")
        self.assertEqual(3, len(seen), seen)
        for args in seen:
            self.assertIn(
                "./docs/notes.md",
                args,
                "%s was given a raw pathspec, so a leading `:` would be magic"
                % self.subcommand(args),
            )
            if self.subcommand(args) != "check-ignore":
                self.assertIn(
                    paths.LITERAL_PATHSPECS,
                    args,
                    "%s globs its pathspec without it" % self.subcommand(args),
                )

    def test_check_ignore_is_never_given_the_literal_flag(self):
        """It is fatal there — `pathspec magic not supported by this command:
        'literal'`, exit 128 — so the exception is asserted, not assumed."""
        control = S.git(
            self.root,
            paths.LITERAL_PATHSPECS,
            "check-ignore",
            "-q",
            "--no-index",
            "--",
            "./anything.md",
        )
        self.assertEqual(
            128, control.returncode, "check-ignore now accepts the flag: simplify"
        )
        seen = self.record_the_argv()
        self.state("anything.md")
        for args in seen:
            if self.subcommand(args) == "check-ignore":
                self.assertNotIn(paths.LITERAL_PATHSPECS, args)


class PathspecMagicTest(TriStateFixture):
    """A declared path is a **name**, and git must be asked about that name.

    `--` ends *option* parsing; it does nothing about pathspec syntax, and git
    reads a pathspec two further ways a filename does not deserve. Both are
    live on git 2.50.1 and both make the tri-state answer about a *different
    file* than the one a document declared:

    * a **glob** — `[R]EADME.md` is a character class matching `README.md`;
    * **magic** — a leading `:` introduces `:(top)`, `:(exclude)`, `:!`.

    Either way the answer is confident and about the wrong path, which C2 then
    reports as a resolved claim.
    """

    def test_a_glob_named_path_is_not_tracked_by_its_neighbour(self):
        """`README.md` is tracked; the literal file `[R]EADME.md` is not."""
        self.write("[R]EADME.md")
        control = S.git(self.root, "ls-files", "-z", "--", "[R]EADME.md")
        self.assertIn(
            b"README.md\0",
            control.stdout,
            "git stopped globbing bracket pathspecs — the fixture is inert",
        )
        self.assertEqual(gitstate.UNTRACKED, self.state("[R]EADME.md"))

    def test_a_glob_named_path_that_IS_tracked_is_still_tracked(self):
        """Non-vacuity: making the probe literal must not make it blind."""
        self.write("[R]EADME.md")
        S.git(self.root, "add", "-A")
        S.git(self.root, "commit", "-q", "-m", "bracket")
        self.assertEqual(gitstate.TRACKED, self.state("[R]EADME.md"))

    def test_a_magic_prefixed_name_is_not_ignored_by_its_neighbour(self):
        """`:(top)` is pathspec magic that `--` does not disarm. The repo
        ignores `README.md`; nothing here ignores the literal name."""
        self.write(".gitignore", "README.md\n")
        S.git(self.root, "add", "-A")
        S.git(self.root, "commit", "-q", "-m", "ignore")
        control = S.git(
            self.root, "check-ignore", "-q", "--no-index", "--", ":(top)README.md"
        )
        self.assertEqual(
            0,
            control.returncode,
            "git stopped honouring :(top) here — the fixture is inert",
        )
        self.assertEqual(gitstate.UNTRACKED, self.state(":(top)README.md"))

    def test_an_ordinary_ignored_path_is_still_ignored(self):
        """Non-vacuity for the ignore limb."""
        self.write(".gitignore", "*.log\n")
        S.git(self.root, "add", "-A")
        S.git(self.root, "commit", "-q", "-m", "ignore")
        self.assertEqual(gitstate.IGNORED, self.state("run.log"))
        self.assertEqual(gitstate.IGNORED, self.state("nested/deep/run.log"))

    def test_the_date_is_not_taken_from_a_globbed_neighbour(self):
        """`log -1 -- '[R]EADME.md'` matches the committed `README.md` and
        returns its date for a path that has never been committed."""
        self.write("[R]EADME.md")
        control = S.git(self.root, "log", "-1", "--format=%cI", "--", "[R]EADME.md")
        self.assertTrue(
            control.stdout.strip(),
            "git stopped globbing the log pathspec — the fixture is inert",
        )
        self.assertIsNone(gitstate.last_commit_date(self.root, "[R]EADME.md"))

    def test_the_date_of_a_real_path_still_arrives(self):
        """Non-vacuity for the date limb."""
        self.assertIsNotNone(gitstate.last_commit_date(self.root, "README.md"))


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
