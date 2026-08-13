"""P2.1 — corpus enumeration and the document predicate (ADR-10).

**A document is a tracked `*.md` path that git does not mark as vendored or
generated**, unioned with the documents the manifest records as **`rendered`**
(never `copied`), deduped and sorted. Without the union, `check` skips the
artifacts `generate` just wrote and passes vacuously (ADR-30).

Four traps this file is written against, each named in the plan:

**T1 — the 100k fixture proves EXCLUSION, not the cap.** `git ls-files` omits
untracked files by design, so none of the 100k ever reach the output and the
cap is never approached. An earlier version of this project shipped that test
believing it covered the cap. Both live here: `UntrackedExclusionTest` and
`OutputCapTest`, the second over a **tracked** corpus with the cap lowered
in-process — there is no flag for it (P1.3 rejects every flag).

**T2 — the predicate is not "every tracked file".** `git check-attr` reports
four distinct states plus arbitrary values; matching the literal word `set`
alone admits `=true` and `=vendor`, which are somebody's deliberate markers.
`AttributeStateTest` has one fixture per state.

**T3 — two corpora.** The **checking** corpus contains the two index outputs;
the **source** corpus the indexes render from does not. Asserted on the
enumerator itself, so an index can never become its own input.

**T4 — belongs to test_digest.py**, but it is why nothing here compares bytes.
"""

import os
import shutil
import unittest

import _support as S

S.import_core()

import corpus  # noqa: E402
import manifest  # noqa: E402
import paths  # noqa: E402


def write(root, relpath, body="x\n"):
    full = os.path.join(root, relpath.replace("/", os.sep))
    directory = os.path.dirname(full)
    if directory:
        os.makedirs(directory, exist_ok=True)
    with open(full, "w", encoding="utf-8") as handle:
        handle.write(body)
    return full


def recorded(path, kind="rendered"):
    return {"path": path, "kind": kind, "sha256": "0" * 64}


class CorpusFixture(unittest.TestCase):
    def setUp(self):
        self.root = S.make_git_repo()
        self.addCleanup(shutil.rmtree, self.root, True)

    def commit(self, message="fixture"):
        S.git(self.root, "add", "-A")
        S.git(self.root, "commit", "-q", "-m", message)

    def documents(self, document=None):
        return corpus.enumerate_documents(self.root, document).documents


class DocumentPredicateTest(CorpusFixture):
    """"Every tracked file" is the wrong corpus — C3, C4 and the indexes would
    inspect `.py` sources, `.gitattributes` and somebody else's vendored docs."""

    def setUp(self):
        CorpusFixture.setUp(self)
        write(self.root, "docs/x.md")
        write(self.root, "app.py", "print(1)\n")
        write(self.root, "tools/steward/__main__.py", "print(1)\n")
        write(self.root, "vendor/docs/guide.md")
        write(
            self.root,
            ".gitattributes",
            "tools/steward/** linguist-vendored\nvendor/docs/** linguist-vendored\n",
        )
        self.commit()

    def test_a_tracked_markdown_document_is_present(self):
        self.assertIn("docs/x.md", self.documents())

    def test_a_tracked_python_source_is_absent(self):
        self.assertNotIn("app.py", self.documents())

    def test_the_generated_gitattributes_is_absent(self):
        self.assertNotIn(".gitattributes", self.documents())

    def test_a_copied_core_source_is_absent(self):
        self.assertNotIn("tools/steward/__main__.py", self.documents())

    def test_a_tracked_vendored_docs_tree_is_absent(self):
        """Somebody else's tracked documentation, marked with git's own
        markers — the same ones the-steward writes for its own core."""
        self.assertNotIn("vendor/docs/guide.md", self.documents())

    def test_the_corpus_is_exactly_the_predicate(self):
        """`README.md` is the fixture repo's own tracked document."""
        self.assertEqual(("README.md", "docs/x.md"), self.documents())

    def test_the_result_is_sorted(self):
        write(self.root, "b.md")
        write(self.root, "a.md")
        write(self.root, "docs/nested/c.md")
        self.commit("more")
        found = self.documents()
        self.assertEqual(tuple(sorted(found)), found)

    def test_paths_are_repository_relative_not_cwd_relative(self):
        """`git ls-files` run from a subdirectory prints paths relative to CWD.
        The enumerator takes the root and must always speak root-relative."""
        self.assertIn("docs/x.md", self.documents())
        self.assertNotIn("x.md", self.documents())


class AttributeStateTest(CorpusFixture):
    """T2 — one fixture per attribute state git can report.

    Verified states (probe, git 2.50.1): bare → `set`; `=true` → `true`;
    `=vendor` → `vendor`; `-name` → `unset`; `=false` → `false`; no rule →
    `unspecified`. Only the last three leave a path in the corpus.
    """

    def setUp(self):
        CorpusFixture.setUp(self)
        write(self.root, "plain.md")
        write(self.root, "bare-set.md")
        write(self.root, "valued-true.md")
        write(self.root, "valued-vendor.md")
        write(self.root, "explicit-unset.md")
        write(self.root, "explicit-false.md")
        write(self.root, "generated-set.md")
        write(
            self.root,
            ".gitattributes",
            "bare-set.md linguist-vendored\n"
            "valued-true.md linguist-vendored=true\n"
            "valued-vendor.md linguist-vendored=vendor\n"
            "explicit-unset.md -linguist-vendored\n"
            "explicit-false.md linguist-vendored=false\n"
            "generated-set.md linguist-generated\n",
        )
        self.commit()

    def test_only_the_unmarked_states_survive(self):
        self.assertEqual(
            (
                "README.md",
                "explicit-false.md",
                "explicit-unset.md",
                "plain.md",
            ),
            self.documents(),
        )

    def test_the_bare_set_form_excludes(self):
        self.assertNotIn("bare-set.md", self.documents())

    def test_the_valued_true_form_excludes(self):
        """Matching the literal word `set` alone admits this one."""
        self.assertNotIn("valued-true.md", self.documents())

    def test_an_arbitrary_value_excludes(self):
        self.assertNotIn("valued-vendor.md", self.documents())

    def test_linguist_generated_excludes_too(self):
        self.assertNotIn("generated-set.md", self.documents())

    def test_an_explicit_unset_does_not_exclude(self):
        self.assertIn("explicit-unset.md", self.documents())

    def test_an_explicit_false_does_not_exclude(self):
        self.assertIn("explicit-false.md", self.documents())


class UntrackedExclusionTest(CorpusFixture):
    """P2.1(a) — and the plan's own warning about what it proves.

    100k untracked markdown files are **not seen**. That is what `git ls-files`
    does by design; **it says nothing about the output cap**, because none of
    those paths ever reach the output. `OutputCapTest` is the cap.
    """

    FILE_COUNT = 100000
    PER_DIRECTORY = 500

    def test_a_hundred_thousand_untracked_documents_are_not_seen(self):
        write(self.root, "docs/tracked.md")
        self.commit()
        for index in range(self.FILE_COUNT // self.PER_DIRECTORY):
            directory = os.path.join(self.root, "untracked", "d%04d" % index)
            os.makedirs(directory)
            for item in range(self.PER_DIRECTORY):
                handle = os.open(
                    os.path.join(directory, "f%03d.md" % item),
                    os.O_CREAT | os.O_WRONLY,
                    0o644,
                )
                os.close(handle)

        found = self.documents()
        # Exactly the tracked corpus — asserted as equality, so an enumerator
        # that returned nothing at all could not pass this as "excluded".
        self.assertEqual(("README.md", "docs/tracked.md"), found)


class OutputCapTest(CorpusFixture):
    """P2.1(b) — the cap, over a **tracked** corpus, made cheap by lowering the
    cap in-process. It must exit 2 naming the cap, never truncate."""

    def setUp(self):
        CorpusFixture.setUp(self)
        self.original_cap = paths.GIT_OUTPUT_CAP_BYTES
        self.addCleanup(setattr, paths, "GIT_OUTPUT_CAP_BYTES", self.original_cap)
        for index in range(40):
            write(self.root, "docs/a-document-with-a-long-name-%02d.md" % index)
        self.commit()

    def tracked_output_size(self):
        _code, out = paths.git_output(self.root, ["ls-files", "-z", "--", "*.md"])
        return len(out)

    def test_the_fixture_really_is_a_tracked_corpus_over_the_cap(self):
        """Without this the cap test could pass over an empty corpus."""
        size = self.tracked_output_size()
        self.assertGreater(size, 200)
        self.assertGreater(len(self.documents()), 40)

    def test_exceeding_the_cap_raises_naming_the_cap(self):
        paths.GIT_OUTPUT_CAP_BYTES = 200
        with self.assertRaises(paths.OutputCapExceeded) as caught:
            corpus.enumerate_documents(self.root)
        self.assertIn("200", str(caught.exception))

    def test_exceeding_the_cap_never_returns_a_partial_corpus(self):
        """The failure mode this replaces: truncate, then report findings over
        the part we happened to read."""
        paths.GIT_OUTPUT_CAP_BYTES = 200
        try:
            result = corpus.enumerate_documents(self.root)
        except paths.OutputCapExceeded:
            return
        self.fail("a corpus was returned over the cap: %r" % (result.documents,))

    def test_the_cap_is_a_module_constant_with_no_flag(self):
        """P1.3 rejects every flag, so the only knob is the constant."""
        self.assertIsInstance(paths.GIT_OUTPUT_CAP_BYTES, int)
        for verb in ("scan", "check", "generate", "doctor"):
            result = S.run_core(
                S.MODERN_PYTHON, [verb, "--output-cap=200"], cwd=self.root
            )
            self.assertEqual(2, result.returncode)

    def test_the_lowered_cap_is_honored_live_not_at_import_time(self):
        """A default argument bound at `def` time would make the override a
        silent no-op — and every cap assertion above vacuously green."""
        paths.GIT_OUTPUT_CAP_BYTES = 200
        with self.assertRaises(paths.OutputCapExceeded):
            paths.git_output(self.root, ["ls-files", "-z", "--", "*.md"])


class OutputCapExitsTwoThroughTheCliTest(CorpusFixture):
    """ADR-13: a corpus we could not read whole is **exit 2**, not a pass.

    Injected at the verb seam, the same seam `test_paths.EscapeExitsTwoThrough
    TheCliTest` uses: Phase 2 has no verb that reads the corpus yet (they are
    stubs until Phases 3/4/6/7), and v0 has no flag that could name one.
    Everything below the seam is production code — the real enumerator, the
    real cap, and the real fault handling in `cli.main`.
    """

    def setUp(self):
        CorpusFixture.setUp(self)
        self.original_cap = paths.GIT_OUTPUT_CAP_BYTES
        self.addCleanup(setattr, paths, "GIT_OUTPUT_CAP_BYTES", self.original_cap)
        for index in range(40):
            write(self.root, "docs/a-document-with-a-long-name-%02d.md" % index)
        self.commit()

    def run_check_enumerating(self):
        import io

        import cli

        def verb(context):
            context.stdout.write(
                "%r\n" % (corpus.enumerate_documents(context.repo_root).documents,)
            )
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

    def test_over_the_cap_exits_two_naming_the_cap_and_reports_nothing(self):
        paths.GIT_OUTPUT_CAP_BYTES = 200
        code, out, err = self.run_check_enumerating()
        self.assertEqual(2, code, err)
        self.assertIn("200", err)
        self.assertIn("cap", err)
        self.assertNotIn("Traceback", err, "a predicted fault printed a crash")
        self.assertEqual("", out, "a partial corpus was reported")

    def test_under_the_cap_exits_zero(self):
        """Without the control, 'exit 2' above could just mean 'an injected
        verb'."""
        code, out, err = self.run_check_enumerating()
        self.assertEqual(0, code, err)
        self.assertIn("docs/a-document-with-a-long-name-00.md", out)


class GitFailureIsNeverAnEmptyCorpusTest(CorpusFixture):
    """ADR-13 / ADR-30: a git command that fails unexpectedly is **exit 2**.

    The tempting shape is `if code != 0: return []`. That turns a broken git
    invocation into a corpus of zero documents, which C3, C4 and the indexes
    then examine and pass over — "0 files checked, 0 problems found" rendered
    as coverage, which is this project's defining failure with the tool's own
    plumbing as the cause.
    """

    def test_enumerating_outside_a_repository_faults_rather_than_returning_empty(self):
        outside = os.path.realpath(
            os.path.join(self.root, os.pardir, "steward-not-a-repo-%d" % os.getpid())
        )
        os.makedirs(outside, exist_ok=True)
        self.addCleanup(shutil.rmtree, outside, True)
        if S.git(outside, "rev-parse", "--show-toplevel").returncode == 0:
            self.skipTest("the system temp dir is itself inside a git repository")
        with self.assertRaises(paths.GitCommandFailed) as caught:
            corpus.enumerate_documents(outside)
        self.assertIn("ls-files", str(caught.exception))

    def test_the_fault_names_the_command_and_the_status(self):
        outside = os.path.realpath(
            os.path.join(self.root, os.pardir, "steward-not-a-repo2-%d" % os.getpid())
        )
        os.makedirs(outside, exist_ok=True)
        self.addCleanup(shutil.rmtree, outside, True)
        if S.git(outside, "rev-parse", "--show-toplevel").returncode == 0:
            self.skipTest("the system temp dir is itself inside a git repository")
        try:
            corpus.enumerate_documents(outside)
        except paths.GitCommandFailed as exc:
            self.assertIn("128", str(exc))
            return
        self.fail("an empty corpus was returned instead of a fault")

    def test_it_exits_two_through_the_cli(self):
        import io

        import cli

        outside = os.path.realpath(
            os.path.join(self.root, os.pardir, "steward-not-a-repo3-%d" % os.getpid())
        )
        os.makedirs(outside, exist_ok=True)
        self.addCleanup(shutil.rmtree, outside, True)
        if S.git(outside, "rev-parse", "--show-toplevel").returncode == 0:
            self.skipTest("the system temp dir is itself inside a git repository")

        def verb(context):
            corpus.enumerate_documents(outside)
            return cli.EXIT_OK

        original = dict(cli.VERBS)
        out, err = io.StringIO(), io.StringIO()
        try:
            cli.VERBS["check"] = verb
            code = cli.main(["check"], out, err, cwd=self.root)
        finally:
            cli.VERBS.clear()
            cli.VERBS.update(original)
        # `.getvalue()` once: `x in some_stringio` *iterates* the buffer and
        # consumes it, so the second assertion would silently see nothing.
        message = err.getvalue()
        self.assertEqual(2, code, message)
        self.assertNotIn("Traceback", message, "a predicted fault printed a crash")
        self.assertIn("ls-files", message)


class LiveUnionTest(CorpusFixture):
    """P2.1(c) — the union is live.

    `git ls-files` lists the index, and an artifact `generate` created seconds
    ago is not in it until a human runs `git add`. Enumerating the index alone
    would make `check` skip the very files it just wrote (ADR-30).
    """

    def setUp(self):
        CorpusFixture.setUp(self)
        write(self.root, "docs/tracked.md")
        self.commit()

    def test_a_freshly_generated_untracked_document_is_in_the_corpus(self):
        write(self.root, "AGENTS.md", "# routing\n")
        document = {"recorded": [recorded("AGENTS.md")]}
        self.assertIn("AGENTS.md", self.documents(document))

    def test_it_is_in_the_corpus_before_any_git_add(self):
        write(self.root, "AGENTS.md", "# routing\n")
        document = {"recorded": [recorded("AGENTS.md")]}
        self.assertNotIn("AGENTS.md", S.git(self.root, "ls-files").stdout.decode())
        self.assertIn("AGENTS.md", self.documents(document))

    def test_staging_it_changes_nothing_about_membership(self):
        write(self.root, "AGENTS.md", "# routing\n")
        document = {"recorded": [recorded("AGENTS.md")]}
        before = self.documents(document)
        S.git(self.root, "add", "AGENTS.md")
        self.assertEqual(before, self.documents(document))

    def test_a_recorded_path_that_is_gone_does_not_silently_vanish(self):
        """ADR-13 reports it as a `warn`; the enumerator's job is to not drop
        it silently (ADR-28)."""
        document = {"recorded": [recorded("AGENTS.md")]}
        result = corpus.enumerate_documents(self.root, document)
        self.assertNotIn("AGENTS.md", result.documents)
        self.assertIn("AGENTS.md", result.missing_recorded)

    def test_a_present_recorded_path_is_not_reported_missing(self):
        write(self.root, "AGENTS.md", "# routing\n")
        document = {"recorded": [recorded("AGENTS.md")]}
        self.assertEqual((), corpus.enumerate_documents(self.root, document).missing_recorded)

    def test_a_copied_path_is_never_in_the_corpus(self):
        """ADR-2: `copied` bytes have no renderer, so C4 never re-renders them
        and the corpus never contains them."""
        write(self.root, "tools/steward/README.md", "# core\n")
        document = {"recorded": [recorded("tools/steward/README.md", kind="copied")]}
        self.assertNotIn("tools/steward/README.md", self.documents(document))

    def test_a_recorded_non_document_is_never_in_the_corpus(self):
        """`.gitattributes` is `rendered`, and it is not a document."""
        write(self.root, ".gitattributes", "tools/steward/** linguist-vendored\n")
        document = {"recorded": [recorded(".gitattributes")]}
        self.assertNotIn(".gitattributes", self.documents(document))

    def test_a_recorded_document_still_faces_the_attribute_predicate(self):
        write(self.root, ".gitattributes", "generated/** linguist-generated\n")
        write(self.root, "generated/index.md")
        self.commit("attrs")
        document = {"recorded": [recorded("generated/index.md")]}
        self.assertNotIn("generated/index.md", self.documents(document))

    def test_a_tracked_and_recorded_document_appears_once(self):
        document = {"recorded": [recorded("docs/tracked.md")]}
        found = self.documents(document)
        self.assertEqual(1, list(found).count("docs/tracked.md"))

    def test_no_manifest_means_the_tracked_corpus_alone(self):
        self.assertEqual(("README.md", "docs/tracked.md"), self.documents(None))

    def test_rendered_is_a_kind_the_manifest_schema_admits(self):
        """Drift guard: the enumerator keys on the literal string."""
        self.assertIn("rendered", manifest.RECORDED_KINDS)


class TwoCorporaTest(CorpusFixture):
    """P2.1(d) / T3 — an index can never become its own input (ADR-10).

    Without the exclusion, first generation renders one graph while the
    immediate re-render sees the two files just written and renders another —
    C4 reporting freshly generated output as **stale**.
    """

    def setUp(self):
        CorpusFixture.setUp(self)
        write(self.root, "docs/x.md")
        write(self.root, "docs/steward/routing-map.md", "# routing map\n")
        write(self.root, "docs/steward/orphans.md", "# orphans\n")
        self.commit()

    def test_the_checking_corpus_contains_both_indexes(self):
        result = corpus.enumerate_documents(self.root)
        self.assertIn("docs/steward/routing-map.md", result.documents)
        self.assertIn("docs/steward/orphans.md", result.documents)

    def test_the_source_corpus_contains_neither(self):
        result = corpus.enumerate_documents(self.root)
        self.assertNotIn("docs/steward/routing-map.md", result.source)
        self.assertNotIn("docs/steward/orphans.md", result.source)

    def test_the_source_corpus_is_otherwise_the_checking_corpus(self):
        result = corpus.enumerate_documents(self.root)
        self.assertEqual(
            tuple(
                path
                for path in result.documents
                if path not in corpus.INDEX_PATHS
            ),
            result.source,
        )

    def test_the_exclusion_holds_for_untracked_recorded_indexes(self):
        """The greenfield shape: `generate` just wrote both, neither is staged."""
        fresh = S.make_git_repo()
        self.addCleanup(shutil.rmtree, fresh, True)
        write(fresh, "docs/steward/routing-map.md", "# routing map\n")
        write(fresh, "docs/steward/orphans.md", "# orphans\n")
        document = {
            "recorded": [
                recorded("docs/steward/routing-map.md"),
                recorded("docs/steward/orphans.md"),
            ]
        }
        result = corpus.enumerate_documents(fresh, document)
        self.assertIn("docs/steward/routing-map.md", result.documents)
        self.assertIn("docs/steward/orphans.md", result.documents)
        self.assertEqual(("README.md",), result.source)

    def test_the_two_excluded_paths_are_the_contract_paths(self):
        self.assertEqual(
            ("docs/steward/orphans.md", "docs/steward/routing-map.md"),
            corpus.INDEX_PATHS,
        )


class ReadOnlyTest(CorpusFixture):
    """Enumeration writes nothing."""

    def test_enumerating_leaves_the_working_tree_byte_identical(self):
        write(self.root, "docs/x.md")
        self.commit()
        with S.unchanged_tree(self, self.root):
            corpus.enumerate_documents(self.root)


if __name__ == "__main__":
    unittest.main()
