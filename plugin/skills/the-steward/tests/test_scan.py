"""P3.1-P3.4 — the read-only scanner: stacks, commands, docs scope, and the
report that writes nothing.

ADR-8  : deterministic. No clock, no randomness, no absolute path in output,
         sorted iteration — two scans of one tree render identical text.
ADR-10 : the document corpus is enumerated through `corpus`, never `find` and
         never a filesystem walk.
ADR-11 : `scan` persists nothing. `generate` is the only verb that writes.
ADR-18 : commands are discovered **structurally** and never executed; every
         proposed command record is `resolution: "repo-declared"`, because a
         scanner cannot tell a legitimate external tool from a command that
         does not exist — which is A1 itself.
ADR-26 : every path read resolves inside the working tree, after symlinks.
ADR-28 : every scan conclusion is tier *inferred*, carries a confidence, and is
         never an `error`; every candidate deliberately not proposed emits a
         diagnostic naming it, because a silent drop hides a real edge.
ADR-30 : every check states the cardinality it examined, and a zero states its
         reason. "0 examined, 0 problems" may never render as coverage.
ADR-32 : a path whose name carries an ASCII control character is never
         proposed — v0 can make no claim about it — and a diagnostic says so.

DECISION-2026-08-14-command-grammar: the interim boundary this file pins.
Package scripts and Makefile targets are proposed **only at the repository
root**, because `npm run test` and `make test` name whatever project the cwd
is in; a nested one is diagnosed and never proposed. The grammar is the
invocation form (`npm run <script>`, `make <target>`, a tracked executable's
repository-relative path **under a leading `./`**), not the declared body. A
tracked executable is self-locating, so it is proposed at any depth; the
`./` is that decision's 2026-08-14 correction, and `CommandGrammarTest` and
`CommandClaimWordingTest` are where it is pinned.

**Six traps this file is written against, each named where it is defended.**

**T1 — "scan writes nothing" is a negative property, and the single most
likely thing in this phase to pass vacuously.** A fixture that runs `scan` over
a clean repository and observes no change cannot distinguish a correct scanner
from one that was never called. Every write assertion here is therefore paired,
in the same test, with an assertion that the scan *ran and produced findings*,
and `ScanWritesNothingTest.test_the_guard_would_notice_a_write` plants a byte
to prove the comparison is live.

**T2 — porcelain is blind where this needs sight.** `.steward.json` in a fresh
repository is untracked, and `git status --porcelain` prints the same single
`?? .steward.json` whatever that file now contains. A `scan` that rewrote the
manifest in place would pass a porcelain-only fixture. The bytes are read from
disk directly, and the tree is compared with `S.tree_snapshot`, which digests
every regular file.

**T3 — an exclusion asserted as `assertNotIn` over an empty answer.** Every
"this was not proposed" assertion is an equality over the whole proposed set,
or is paired with a positive control in the same class, so a scanner that
proposed nothing at all cannot pass as one that excluded the right thing.

**T4 — a fixture whose two values coincide.** `npm run test` is the one script
name where the shorter `npm test` also works, so a fixture that used only
`test` could not tell the uniform `npm run <script>` rule from a lifecycle
special case. Every package fixture declares a non-lifecycle script too.

**T5 — the subject deciding whether its own assertion runs.** Environment
facts come from `S.git`, never from the code under test.

**T6 — a live check nobody asserted.** Reading this file will not tell you
which of the scanner's refusals are actually pinned; a mutation run will.
Deleting the whitespace rule from the name check (`scan._name_fault`) reddened
nothing on the first pass — the check was correct, and completely unasserted.
That gap became `UnnameableScriptTest`, and it is here because the mutation
found it, not because the review did. **Its subject then inverted**: the
whitespace rule was not merely unasserted, it contradicted the owner's own
quoting decision, and the class now pins the quoting (defect B5). The lesson
survives the inversion — an unasserted rule is one nobody has had to defend.

**T7 — the claim nobody executed.** Twelve defects were later found in this
module by *running* it rather than reading it, and the fixtures in this file
are why they were not found here first: they were well-formed exclusively. A
Makefile that only ever held real targets never showed the reader an
assignment or a directive; a command value nobody ever typed never had to be
typable; a path nobody chose to be hostile never had to be escaped. The
classes from `TypedCommandTest` down are the hostile half, and the first of
them stops reading the claim and types it into a shell.

**T8 — a fix that reaches further than the defect it repairs.** Three of the
last five defects were *created* by the previous round's fixes: a boundary
that belonged to command records was pushed down into stack detection, a
directive vocabulary was consulted where it could not see what it needed to,
and a correction that added quoting left the rule it obsoleted standing. Each
class from `NestedProjectStackTest` down therefore carries the counter-weight
for the concern its fix might swallow — nested commands still refused, the
rule after a directive line still read, the option-like name still diagnosed.
"""

import contextlib
import io
import json
import os
import shutil
import subprocess
import tempfile
import unittest

import _support as S

S.import_core()

import cli  # noqa: E402
import findings  # noqa: E402
import manifest  # noqa: E402
import scan  # noqa: E402
import text  # noqa: E402


MANIFEST = ".steward.json"
PACKAGE_JSON = "package.json"


class ScanFixture(unittest.TestCase):
    """A throwaway repository, plus the three stack fixtures P3 names."""

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

    def commit(self, message="fixture"):
        S.git(self.root, "add", "-A")
        S.git(self.root, "commit", "-q", "-m", message)

    def survey(self, document=None):
        return scan.survey(self.root, document)

    def values(self, records):
        return [record["value"] for record in records]

    def note_ids(self, survey):
        return sorted(note.id for note in survey.notes)

    def run_scan(self):
        """`scan` end to end, in process. Returns (code, stdout, stderr)."""
        out, err = io.StringIO(), io.StringIO()
        code = cli.main(["scan"], out, err, cwd=self.root)
        return code, out.getvalue(), err.getvalue()

    @contextlib.contextmanager
    def other_repo(self):
        """A second fixture repository, so one test can cover all three stacks.

        A **narrow** save/restore of `self.root` alone. `self.doCleanups()`
        would run the whole cleanup stack, `rmtree`-ing the first repository,
        and every later iteration would then be asserting over a directory that
        no longer exists — the loop trap this suite has already paid for once.
        """
        saved = self.root
        self.root = S.make_git_repo()
        self.addCleanup(shutil.rmtree, self.root, True)
        try:
            yield self.root
        finally:
            self.root = saved

    # -----------------------------------------------------------------
    # The three stack fixtures the plan names. Each is committed, so every
    # declaration reaches git's index — which is the only enumerator the
    # scanner has (ADR-10: never `find`, never a walk).

    def node_fixture(self):
        """A Node repository, with a nested package the boundary excludes."""
        self.write(
            "package.json",
            '{"name": "app", "scripts": {"test": "jest", "lint": "eslint ."}}\n',
        )
        self.write("docs/architecture.md", "# architecture\n")
        self.write(
            "packages/web/package.json",
            '{"name": "web", "scripts": {"build": "vite build"}}\n',
        )
        self.commit()

    def python_fixture(self):
        """A Python repository: a Makefile, an unparseable declaration, and a
        tracked executable. **No `npm` may appear anywhere in its scan.**"""
        self.write("pyproject.toml", '[project]\nname = "app"\n')
        self.write("Makefile", "lint:\n\truff check .\n\ntest:\n\tpytest\n")
        self.write("scripts/check.sh", "#!/bin/sh\nexit 0\n")
        os.chmod(os.path.join(self.root, "scripts", "check.sh"), 0o755)
        self.write("src/app/README.md", "# app\n")
        self.commit()

    def docs_only_fixture(self):
        """No declaration of any kind — documents and nothing else."""
        self.write("AGENTS.md", "# agents\n")
        self.write("docs/guide.md", "# guide\n")
        self.commit()


class VocabularyTest(unittest.TestCase):
    """The scanner's vocabulary is the manifest's, pinned rather than re-derived.

    `scan` names its own `PROPOSED` / `HIGH` / `LOW` / `REPO_DECLARED` so the
    record-building code reads as prose, and it does not import `manifest` to
    get them — the module has no other use for it. That is a duplication, and
    the way a duplication stays honest is a test that fails when the two drift,
    rather than a comment asking the next agent to remember.
    """

    def test_the_state_a_scan_proposes_is_a_stored_state(self):
        self.assertIn(scan.PROPOSED, manifest.STATES)

    def test_the_confidence_levels_are_the_manifest_vocabulary(self):
        self.assertEqual(
            sorted((scan.HIGH, scan.LOW)), sorted(manifest.CONFIDENCES)
        )
        self.assertEqual(sorted(manifest.CONFIDENCES), sorted(findings.CONFIDENCES))

    def test_the_only_resolution_a_scan_writes_is_repo_declared(self):
        self.assertIn(scan.REPO_DECLARED, manifest.RESOLUTIONS)
        self.assertNotEqual("external", scan.REPO_DECLARED)

    def test_every_check_name_the_report_prints_is_declared_once(self):
        self.assertEqual(sorted(set(scan.CHECKS)), sorted(scan.CHECKS))

    def test_the_scope_keyed_checks_are_the_manifest_scope_keys(self):
        """ADR-30 keys `intentionallyEmpty` per scope, and `generate` writes one
        for each key whose inferred list came back empty. A check named
        differently here would leave a scope with nothing to key on."""
        for key in manifest.SCOPE_KEYS:
            self.assertIn(key, scan.CHECKS, key)


class StackDetectionTest(ScanFixture):
    """P3.1 — project roots and stacks, per project.

    The rule the plan states is a prohibition, not a feature: **never emit one
    ecosystem's assumptions into another's repo.** So the positive assertions
    below are each paired with the negative that matters — a Python repository
    is never told about `npm`, and a Node repository is never told about
    `make` — because a detector that reported every stack everywhere would
    satisfy the positive halves alone.
    """

    def stacks(self, survey):
        return [stack for _directory, stack, _declarations in survey.stacks]

    def root_stacks(self, survey):
        return [
            stack
            for directory, stack, _declarations in survey.stacks
            if not directory
        ]

    def test_a_root_package_manifest_is_a_node_project(self):
        self.node_fixture()
        self.assertEqual(["node"], self.root_stacks(self.survey()))

    def test_the_evidence_is_the_declaration_that_established_it(self):
        """A stack with no named declaration is an assertion, not a finding.

        The pair is `(project directory, stack)` and the evidence is **every**
        declaration that established it — see `NestedProjectStackTest`, which
        owns the reason.
        """
        self.node_fixture()
        self.assertEqual(
            [
                ("", "node", ("package.json",)),
                ("packages/web", "node", ("packages/web/package.json",)),
            ],
            list(self.survey().stacks),
        )

    def test_a_python_repository_is_never_told_about_node(self):
        self.python_fixture()
        survey = self.survey()
        self.assertEqual(["make", "python"], self.stacks(survey))
        self.assertEqual(
            [],
            [name for name in self.stacks(survey) if name == "node"],
            "a Node assumption reached a Python repository",
        )

    def test_a_node_repository_is_never_told_about_make(self):
        """The counter-weight: the exclusion above must not be `nothing was
        ever detected`, so the same predicate is asserted the other way."""
        self.node_fixture()
        self.assertNotIn("make", self.stacks(self.survey()))
        self.write("Makefile", "test:\n\techo hi\n")
        self.commit()
        self.assertIn(
            "make",
            self.stacks(self.survey()),
            "the detector cannot see a Makefile at all — the exclusion above "
            "proved nothing",
        )

    def test_a_docs_only_repository_declares_no_stack(self):
        self.docs_only_fixture()
        self.assertEqual([], self.stacks(self.survey()))

    def test_an_untracked_declaration_is_not_a_stack(self):
        """git's index is the enumerator (ADR-10). A `package.json` nobody
        committed is not something this repository declares."""
        self.write("package.json", '{"scripts": {"test": "jest"}}\n')
        self.assertEqual([], self.stacks(self.survey()))
        self.commit()
        self.assertEqual(
            ["node"],
            self.stacks(self.survey()),
            "committing it changed nothing — the enumerator is not reading "
            "the index",
        )

    def test_a_nested_declaration_is_a_project_of_its_own_never_a_root_one(self):
        """The command boundary is not the stack boundary.

        DECISION-2026-08-14 §1 is about **command records**: `npm run test`
        names whichever project the shell stands in, and the record has no
        field for a working directory. P3.1 asks a different question — *what
        does this repository contain* — and the answer for
        `packages/web/package.json` is a node project **in `packages/web`**,
        not silence. `NestedProjectStackTest` owns the rest.
        """
        self.write("packages/web/package.json", '{"scripts": {"test": "x"}}\n')
        self.commit()
        self.assertEqual([], self.root_stacks(self.survey()))
        self.assertEqual(["node"], self.stacks(self.survey()))

    def test_every_stack_finding_is_an_inference_carrying_a_confidence(self):
        self.node_fixture()
        found, _cardinalities = scan.survey_findings(self.survey())
        stacks = [item for item in found if item["id"] == scan.STACK_FINDING]
        self.assertTrue(stacks, "no stack finding was emitted at all")
        for item in stacks:
            self.assertEqual("inferred", item["tier"])
            self.assertIn(item["confidence"], findings.CONFIDENCES)
            self.assertNotEqual("error", item["severity"])


class CommandGrammarTest(ScanFixture):
    """P3.2 — the invocation form, and the repository-root boundary.

    DECISION-2026-08-14 chose the string a human would actually type over the
    declared body: `jest` leans on `node_modules/.bin` being on `PATH` and is
    frequently not runnable as written, so a rendered Verification Commands
    section full of declared bodies would print commands nobody can paste.
    """

    def test_a_package_script_becomes_the_uniform_npm_run_form(self):
        """T4 — `test` is the one name where `npm test` also works, so the
        fixture declares a non-lifecycle script too. Without it, a scanner
        that special-cased the lifecycle names would pass."""
        self.write(
            "package.json",
            '{"scripts": {"test": "jest", "check": "tsc --noEmit"}}\n',
        )
        self.commit()
        self.assertEqual(
            ["npm run check", "npm run test"],
            self.values(self.survey().commands),
        )

    def test_the_declared_body_is_never_the_proposed_value(self):
        self.write("package.json", '{"scripts": {"test": "jest"}}\n')
        self.commit()
        self.assertNotIn("jest", self.values(self.survey().commands))

    def test_a_makefile_target_becomes_the_make_form(self):
        self.write("Makefile", "lint:\n\truff check .\n\ntest:\n\tpytest\n")
        self.commit()
        self.assertEqual(
            ["make lint", "make test"], self.values(self.survey().commands)
        )

    def test_a_tracked_executable_is_proposed_with_a_leading_dot_slash(self):
        """The decision's table, after its **2026-08-14 correction**.

        The table first said "its **bare** repository-relative path", and the
        version of this test that pinned that recorded the tension in its own
        docstring: a root-level `build.sh` is not runnable as typed. That was
        not a tension to live with, it was the tool emitting the exact false
        claim it exists to detect (A1) — `command not found: build.sh` against
        a report saying a human can type it. The rule is now **always prefix
        `./`**, with no branch: `./plugin/skills/x/y.sh` is valid and
        unambiguous, so "only when the path has no slash" would buy nothing and
        add a case.
        """
        self.write("scripts/build.sh", "#!/bin/sh\nexit 0\n")
        self.write("build.sh", "#!/bin/sh\nexit 0\n")
        os.chmod(os.path.join(self.root, "scripts", "build.sh"), 0o755)
        os.chmod(os.path.join(self.root, "build.sh"), 0o755)
        self.commit()
        self.assertEqual(
            ["./build.sh", "./scripts/build.sh"],
            self.values(self.survey().commands),
        )

    def test_a_root_level_executable_is_never_proposed_bare(self):
        """The defect the correction fixes, isolated to the case that carries it.

        POSIX treats a command word as a path only when it **contains a
        slash**; without one the word is searched on `PATH`. A root-level
        executable is therefore the one kind where the bare form is not a path
        at all, and the rendered Verification Commands section would have
        printed a line a human cannot paste and run. The nested case is
        asserted above and is deliberately still proposed — a tracked
        executable is self-locating, so the "repository root only" boundary
        never excluded it (DECISION §"Clarification, 2026-08-14").
        """
        self.write("build.sh", "#!/bin/sh\nexit 0\n")
        os.chmod(os.path.join(self.root, "build.sh"), 0o755)
        self.commit()
        values = self.values(self.survey().commands)
        self.assertEqual(["./build.sh"], values)
        self.assertNotIn(
            "build.sh",
            values,
            "the bare form is a word a shell looks up on PATH, not a path into "
            "this repository — that is a documented command that does not "
            "resolve, which is A1",
        )

    def test_a_tracked_file_that_is_not_executable_is_not_a_command(self):
        self.write("scripts/notes.sh", "#!/bin/sh\nexit 0\n")
        self.commit()
        self.assertEqual([], self.values(self.survey().commands))
        os.chmod(os.path.join(self.root, "scripts", "notes.sh"), 0o755)
        self.commit("chmod")
        self.assertEqual(
            ["./scripts/notes.sh"],
            self.values(self.survey().commands),
            "the executable bit is not being read from the index at all — the "
            "exclusion above proved nothing",
        )

    def test_the_executable_bit_comes_from_the_index_not_the_checkout(self):
        """ADR-18: what the index records is a fact about the repository; what
        this checkout happens to have on this machine is not."""
        self.write("scripts/build.sh", "#!/bin/sh\nexit 0\n")
        os.chmod(os.path.join(self.root, "scripts", "build.sh"), 0o755)
        self.commit()
        control = S.git(self.root, "ls-files", "--stage", "scripts/build.sh")
        self.assertEqual(0, control.returncode, control.stderr.decode("utf-8", "replace"))
        self.assertTrue(
            control.stdout.startswith(b"100755"),
            "git stopped recording the executable bit — the fixture is inert",
        )
        os.chmod(os.path.join(self.root, "scripts", "build.sh"), 0o644)
        self.assertEqual(
            ["./scripts/build.sh"],
            self.values(self.survey().commands),
            "a chmod in the working tree changed the answer, so the mode is "
            "being read from the filesystem rather than from git",
        )


class CommandClaimWordingTest(ScanFixture):
    """P3.2 — the claim a command finding makes, read back against every kind.

    `_command_findings` makes **one** sentence for all three declaration kinds:
    "%r is a command this repository declares, and a human can type it at the
    repository root". One sentence for several kinds is only true if it is true
    of each of them, and before the 2026-08-14 correction it was false for
    exactly one — a root-level tracked executable, which a POSIX shell looks up
    on `PATH` because the word holds no slash. `command not found: build.sh`
    against a report claiming a human can type it is A1, emitted by the tool
    that exists to detect it.

    So the wording is asserted here per kind rather than left to a reader, and
    the property it turns on — a value naming a file **in this repository** is
    a path, never a bare word — is asserted over the survey rather than over a
    literal, so a scanner that stopped prefixing cannot pass.
    """

    # Four values, covering all three kinds and both depths of the third.
    KINDS = ("./build.sh", "./scripts/deploy.sh", "make release", "npm run check")

    TYPABLE = "a human can type it at the repository root"

    # The program names the claim leaves to `PATH`, which is what a human
    # typing `npm` or `make` at the root actually wants. Named here so the skip
    # in the path assertion below is a stated exception and not a hole.
    PROGRAM_WORDS = ("make", "npm")

    def claims(self):
        self.write("package.json", '{"scripts": {"check": "tsc --noEmit"}}\n')
        self.write("Makefile", "release:\n\techo\n")
        self.write("build.sh", "#!/bin/sh\nexit 0\n")
        self.write("scripts/deploy.sh", "#!/bin/sh\nexit 0\n")
        os.chmod(os.path.join(self.root, "build.sh"), 0o755)
        os.chmod(os.path.join(self.root, "scripts", "deploy.sh"), 0o755)
        self.commit()
        survey = self.survey()
        found, _cardinalities = scan.survey_findings(survey)
        return dict(
            zip(
                self.values(survey.commands),
                [
                    item["claim"]
                    for item in found
                    if item["id"] == scan.COMMAND_FINDING
                ],
            )
        )

    def test_the_fixture_produces_all_four_kinds(self):
        """Non-vacuity: the wording assertions below say nothing at all about a
        kind this fixture never got the scanner to propose."""
        self.assertEqual(list(self.KINDS), sorted(self.claims()))

    def test_every_kind_is_claimed_as_typable_at_the_repository_root(self):
        claims = self.claims()
        for value in self.KINDS:
            self.assertIn(self.TYPABLE, claims[value], value)
            self.assertIn(
                repr(value),
                claims[value],
                "the claim does not quote the value it is about",
            )

    def test_a_value_naming_a_file_here_is_a_path_and_not_a_bare_word(self):
        """The property that makes the sentence true, over the real survey.

        `npm` and `make` are program names and being looked up on `PATH` is
        exactly right for them. Everything else the scanner proposes names a
        file inside this repository, and a shell only reads such a word as a
        path when it contains a slash — so it has to carry one, and the counter
        is what stops this passing over a survey where nothing did.

        **Both assertions, and the second is not the first restated.** Written
        against `scan.EXECUTABLE_PREFIX` alone, emptying that constant would
        make this vacuous — `"anything".startswith("")` is true — which is this
        codebase's "two values coincided" trap in one line. `"/" in first` is
        the POSIX property itself and survives that mutation.
        """
        checked = 0
        for value in sorted(self.claims()):
            first = value.split(" ")[0]
            if first in self.PROGRAM_WORDS:
                continue
            checked += 1
            self.assertIn(
                "/",
                first,
                "%r would be searched on PATH rather than run out of this "
                "repository, while the claim says a human can type it" % value,
            )
            self.assertTrue(
                first.startswith(scan.EXECUTABLE_PREFIX),
                "%r does not carry the grammar's prefix %r"
                % (value, scan.EXECUTABLE_PREFIX),
            )
        self.assertEqual(
            2, checked, "no repository-relative command reached the assertion"
        )


class CommandRecordShapeTest(ScanFixture):
    """P3.2 — every proposed record is a persistable ADR-11 record."""

    def test_every_proposed_command_record_is_repo_declared(self):
        for build in (self.node_fixture, self.python_fixture):
            with self.other_repo():
                build()
                records = self.survey().commands
                self.assertTrue(records, "no command record was proposed at all")
                for record in records:
                    self.assertEqual(scan.REPO_DECLARED, record["resolution"])
                    self.assertEqual("proposed", record["state"])
                    self.assertIn(record["confidence"], manifest.CONFIDENCES)

    def test_scan_can_never_emit_an_external_resolution(self):
        """ADR-18: `external` is a human's declaration on a `confirmed`
        record. A scanner cannot tell a legitimate external tool from a
        command that does not exist — that is A1 itself.

        Asserted three ways, because the first alone would be satisfied by a
        scanner that proposed nothing: over every fixture's real record set,
        with the set asserted non-empty; against the resolution vocabulary, so
        a third value could not slip past; and with the counter-weight that
        the manifest refuses `external` on a `proposed` record, which is what
        makes the value meaningful rather than cosmetic.
        """
        examined = 0
        for build in (self.node_fixture, self.python_fixture, self.docs_only_fixture):
            with self.other_repo():
                build()
                for record in self.survey().commands:
                    self.assertNotEqual("external", record["resolution"])
                    examined += 1
        self.assertGreater(examined, 0, "no command record was examined at all")
        self.assertEqual(("repo-declared", "external"), manifest.RESOLUTIONS)
        with self.assertRaises(manifest.ManifestError) as caught:
            manifest.validate(
                {
                    "commands": [
                        {
                            "value": "docker build .",
                            "state": "proposed",
                            "resolution": "external",
                        }
                    ]
                }
            )
        self.assertIn("only on a 'confirmed' record", str(caught.exception))

    def test_the_proposed_record_sets_validate_as_a_manifest(self):
        """A record `generate` could not persist is not a proposal.

        Validation is the strongest single assertion available here: it covers
        the value's representability (ADR-32), the state vocabulary, the
        confidence vocabulary and the closed key set at once.
        """
        for build in (self.node_fixture, self.python_fixture, self.docs_only_fixture):
            with self.other_repo():
                build()
                survey = self.survey()
                document = {
                    "commands": list(survey.commands),
                    "paths": list(survey.paths),
                }
                if survey.docs_scope is not None:
                    document["docsScope"] = survey.docs_scope
                manifest.validate(document)

    def test_confidence_is_high_for_a_declaration_and_low_for_an_executable(self):
        """Both levels, in one repository, with the reason for each.

        A named script in a declaration file *says* it is a command. A mode
        bit says a file is executable and nothing more — that it is a command
        anyone should run is the scanner's inference, and it is a weaker one.
        """
        self.python_fixture()
        levels = dict(
            (record["value"], record["confidence"])
            for record in self.survey().commands
        )
        self.assertEqual("high", levels["make test"])
        self.assertEqual("low", levels["./scripts/check.sh"])


class EvidenceTest(ScanFixture):
    """P3.2 / P3.3 — "every finding carries its evidence" (PDR §1, ADR-28).

    A finding that says only *this was derived structurally* names a method,
    not evidence: a human confirming the record cannot tell which file to open.
    """

    def observed(self, finding_id):
        found, _c = scan.survey_findings(self.survey())
        return [item["observed"] for item in found if item["id"] == finding_id]

    def test_a_command_finding_names_the_declaration_it_was_read_from(self):
        self.write("package.json", '{"scripts": {"check": "tsc"}}\n')
        self.write("Makefile", "release:\n\techo\n")
        self.write("scripts/build.sh", "#!/bin/sh\nexit 0\n")
        os.chmod(os.path.join(self.root, "scripts", "build.sh"), 0o755)
        self.commit()
        observed = dict(
            zip(self.values(self.survey().commands), self.observed(scan.COMMAND_FINDING))
        )
        self.assertIn("package.json", observed["npm run check"])
        self.assertIn("Makefile", observed["make release"])
        self.assertIn("index", observed["./scripts/build.sh"])

    def test_a_path_finding_distinguishes_a_root_document_from_a_nested_one(self):
        self.write("AGENTS.md", "# agents\n")
        self.write("sub/AGENTS.md", "# nested\n")
        self.commit()
        observed = dict(
            zip(self.values(self.survey().paths), self.observed(scan.PATH_FINDING))
        )
        self.assertIn("at the repository root", observed["AGENTS.md"])
        self.assertIn("below the repository root", observed["sub/AGENTS.md"])
        self.assertNotIn(
            "at the repository root",
            observed["sub/AGENTS.md"],
            "a nested document is described as a root one",
        )
        self.assertIn("convention", observed["README.md"])


class DuplicateProposalTest(ScanFixture):
    """P3.2 — one claim per command, because the cardinality is the record count.

    ADR-32: "the cardinality each check reports is exactly the record count."
    Two records holding the same string would make one claim count as two
    examined items — coverage inflated by an accident of which files happen to
    declare the same target.
    """

    def test_a_target_declared_twice_in_one_makefile_is_proposed_once(self):
        """**The duplication source changed with B3, and the property did
        not.** Two tracked makefiles used to be the way to declare one target
        twice; `make` reads only the highest-precedence file, so the scanner
        now reads only that one too (`ShadowedMakefileTest`) and the pair can
        no longer collide. A target declared twice **in one file** still can —
        GNU make accepts it, warns about the overridden recipe, and has one
        target — and that is what this class is about.
        """
        self.write("Makefile", "test: a\n\techo a\n\ntest: b\n\techo b\n")
        self.commit()
        self.assertEqual(["make test"], self.values(self.survey().commands))

    def test_the_fixture_really_declares_it_twice(self):
        """Non-vacuity: the equality above would also hold if the reader saw
        only the first rule line of the file."""
        self.write("Makefile", "test: a\n\techo a\n\nonly-here: b\n\techo b\n")
        self.commit()
        self.assertEqual(
            ["make only-here", "make test"], self.values(self.survey().commands)
        )


class RootBoundaryTest(ScanFixture):
    """P3.2 — a nested project is diagnosed, never guessed at.

    `npm run test` and `make test` name whichever project the shell is in, and
    `commandRecord` has no field to carry a working directory. Nothing is
    silently dropped (ADR-28): the file is named, and the cardinality line
    states the count.
    """

    def test_a_nested_package_manifest_proposes_nothing(self):
        self.node_fixture()
        self.assertEqual(
            ["npm run lint", "npm run test"], self.values(self.survey().commands)
        )

    def test_a_nested_package_manifest_is_diagnosed_by_name(self):
        self.node_fixture()
        notes = [
            note
            for note in self.survey().notes
            if note.id == scan.NESTED_DECLARATION
        ]
        self.assertEqual(
            [repr("packages/web/package.json")], [n.where for n in notes]
        )

    def test_a_nested_makefile_is_diagnosed_too(self):
        self.write("sub/Makefile", "test:\n\techo hi\n")
        self.commit()
        survey = self.survey()
        self.assertEqual([], self.values(survey.commands))
        self.assertIn(scan.NESTED_DECLARATION, self.note_ids(survey))

    def test_the_cardinality_line_states_the_nested_count(self):
        self.node_fixture()
        _found, cardinalities = scan.survey_findings(self.survey())
        line = [c for c in cardinalities if c["check"] == scan.COMMAND_CHECK][0]
        self.assertEqual(2, line["examined"])
        self.assertIn("1", line["reason"] or "")
        self.assertIn("root", (line["reason"] or "").lower())

    def test_a_nested_declaration_alone_still_exits_zero(self):
        self.write("sub/package.json", '{"scripts": {"test": "jest"}}\n')
        self.commit()
        code, out, err = self.run_scan()
        self.assertEqual(0, code, err)
        self.assertNotIn("Traceback", err, "a predicted case printed a crash")
        self.assertIn("sub/package.json", out)


class UnreadableDeclarationTest(ScanFixture):
    """P3.2 — a declaration the scanner cannot read is a finding, never a crash.

    `jsonio.loads` raises `JsonError`, which is **not** in
    `cli.REPORTED_FAULTS`: an unwrapped one prints a traceback. And it rejects
    a top-level JSON array, which a broken `package.json` can legitimately be.
    """

    def scan_with(self, body):
        self.write(PACKAGE_JSON, body)
        self.commit()
        return self.survey()

    def test_a_syntactically_broken_package_manifest_is_a_finding(self):
        survey = self.scan_with('{"scripts": ')
        self.assertEqual([], self.values(survey.commands))
        self.assertIn(scan.UNREADABLE_DECLARATION, self.note_ids(survey))

    def test_a_top_level_array_is_a_finding_and_not_a_traceback(self):
        """The named trap: `jsonio.loads` refuses a top-level array."""
        self.scan_with("[1, 2]\n")
        code, _out, err = self.run_scan()
        self.assertEqual(0, code, err)
        self.assertNotIn("Traceback", err, "a predicted fault printed a crash")

    def test_a_scripts_key_of_the_wrong_type_is_a_finding(self):
        survey = self.scan_with('{"scripts": "nope"}\n')
        self.assertEqual([], self.values(survey.commands))
        self.assertIn(scan.UNREADABLE_DECLARATION, self.note_ids(survey))

    def test_a_package_manifest_with_no_scripts_is_not_a_diagnostic(self):
        """The counter-weight: a perfectly ordinary manifest declaring no
        script must not be reported as unreadable, or the diagnostic above
        means nothing."""
        survey = self.scan_with('{"name": "app"}\n')
        self.assertEqual([], self.values(survey.commands))
        self.assertNotIn(scan.UNREADABLE_DECLARATION, self.note_ids(survey))

    def test_bytes_that_are_not_utf8_are_a_finding(self):
        full = os.path.join(self.root, PACKAGE_JSON)
        with open(full, "wb") as handle:
            handle.write(b'{"scripts": {"test": "\xff\xfe"}}')
        self.commit()
        survey = self.survey()
        self.assertEqual([], self.values(survey.commands))
        self.assertIn(scan.UNREADABLE_DECLARATION, self.note_ids(survey))

    def test_a_tracked_declaration_missing_from_the_working_tree_is_a_finding(self):
        self.write(PACKAGE_JSON, '{"scripts": {"test": "jest"}}\n')
        self.commit()
        self.assertEqual(["npm run test"], self.values(self.survey().commands))
        os.remove(os.path.join(self.root, PACKAGE_JSON))
        survey = self.survey()
        self.assertEqual([], self.values(survey.commands))
        self.assertIn(scan.UNREADABLE_DECLARATION, self.note_ids(survey))

    def test_a_declaration_that_is_a_symlink_is_never_read(self):
        """An in-tree symlink passes containment, so containment is not the
        answer here: `package.json -> elsewhere/package.json` would let the
        scanner propose commands out of a file this repository does not
        declare. git's index mode says `120000` and that is enough."""
        self.write("elsewhere/package.json", '{"scripts": {"leak": "x"}}\n')
        os.symlink(
            os.path.join("elsewhere", "package.json"),
            os.path.join(self.root, PACKAGE_JSON),
        )
        self.commit()
        control = S.git(self.root, "ls-files", "--stage", PACKAGE_JSON)
        self.assertEqual(0, control.returncode, control.stderr.decode("utf-8", "replace"))
        self.assertTrue(
            control.stdout.startswith(b"120000"),
            "git stopped recording the symlink mode — the fixture is inert",
        )
        survey = self.survey()
        self.assertEqual([], self.values(survey.commands))
        self.assertIn(scan.SYMLINKED_DECLARATION, self.note_ids(survey))


class UnparseableDeclarationTest(ScanFixture):
    """P3.2 — "task-runner entries", bounded honestly.

    At the 3.9 floor there is no `tomllib` and no `yaml` (ADR-1), so a
    `Taskfile.yml`, a `justfile` or `pyproject.toml`'s script tables cannot be
    read without inventing a parser — which would be a dependency in all but
    name and a source of exactly the false claims this tool detects. Detected,
    bounded, and never guessed at.
    """

    def test_a_task_runner_declaration_proposes_nothing_and_says_why(self):
        self.write("Taskfile.yml", "tasks:\n  test:\n    cmds:\n      - pytest\n")
        self.commit()
        survey = self.survey()
        self.assertEqual([], self.values(survey.commands))
        notes = [n for n in survey.notes if n.id == scan.UNPARSEABLE_DECLARATION]
        self.assertEqual([repr("Taskfile.yml")], [n.where for n in notes])

    def test_pyproject_is_detected_as_python_and_read_by_nobody(self):
        self.python_fixture()
        survey = self.survey()
        self.assertIn(
            "python", [stack for _directory, stack, _d in survey.stacks]
        )
        self.assertIn(scan.UNPARSEABLE_DECLARATION, self.note_ids(survey))

    def test_no_ecosystem_leaks_into_another(self):
        """P3.1's prohibition, asserted where it would actually bite."""
        self.python_fixture()
        for value in self.values(self.survey().commands):
            self.assertNotIn("npm", value)
            self.assertNotIn("yarn", value)


class UnnameableScriptTest(ScanFixture):
    """P3.2 — **B5**: the refusal is the name quoting cannot rescue, not
    whitespace.

    This class used to pin the opposite, and its own docstring said why: the
    whitespace refusal was "a choice rather than a necessity", kept because
    "widening what a scanner proposes is a behaviour change nobody asked
    for". **The owner did ask for it.**
    `DECISION-2026-08-14-command-grammar.md` §"Correction 2" adds POSIX
    quoting and states the rule as *quote the word, or refuse the name* —
    quoting where quoting makes the claim true, and a refusal only for the
    **option-like** name, which `shlex.quote("--help")` returns unchanged and
    `npm` still parses as a flag.

    So `build all` is now proposed as `npm run 'build all'`, which
    `TypedCommandTest` types into a shell and checks npm's received argv for.
    What is still refused is what quoting cannot fix:

    * an **ASCII control character**, which no record value may hold (ADR-32)
      and which would render as two lines of a one-item-per-line section;
    * an **empty** name, which names no script and which `make ''` rejects
      outright ("empty string invalid as file name");
    * an **option-like** name — `OptionLikeNameTest` owns that half.

    The predicate moved with the rule: what is validated is the **final
    quoted value**, not the raw name, because the raw name is not what a
    human types and not what the record holds.
    """

    def scan_with_script(self, name):
        self.write(
            PACKAGE_JSON,
            json.dumps({"scripts": {name: "x", "ok": "y"}}) + "\n",
        )
        self.commit()
        return self.survey()

    def test_a_script_name_with_whitespace_is_proposed_quoted(self):
        survey = self.scan_with_script("build all")
        self.assertEqual(
            ["npm run 'build all'", "npm run ok"], self.values(survey.commands)
        )
        self.assertNotIn(scan.UNREPRESENTABLE, self.note_ids(survey))

    def test_a_name_whose_spaces_are_leading_or_trailing_is_proposed_too(self):
        """The half the old rule refused twice over: `_representability_fault`
        rejected the raw name for its outer whitespace *before* quoting could
        make it whole. `npm run ' build'` is one word to a shell and reaches
        npm as the name it declares."""
        survey = self.scan_with_script(" build ")
        self.assertEqual(
            ["npm run ' build '", "npm run ok"], self.values(survey.commands)
        )

    def test_a_script_name_with_a_control_character_is_not_proposed(self):
        survey = self.scan_with_script("build\nall")
        self.assertEqual(["npm run ok"], self.values(survey.commands))
        self.assertIn(scan.UNREPRESENTABLE, self.note_ids(survey))

    def test_an_empty_script_name_is_not_proposed(self):
        """Quoting makes `npm run ''` typable and leaves it naming nothing,
        and `make ''` is an error in GNU make — so this is a refusal the
        quoting rule does not reach."""
        survey = self.scan_with_script("")
        self.assertEqual(["npm run ok"], self.values(survey.commands))
        self.assertIn(scan.UNREPRESENTABLE, self.note_ids(survey))

    def test_the_diagnostic_names_the_declaration_and_the_name(self):
        survey = self.scan_with_script("build\nall")
        notes = [n for n in survey.notes if n.id == scan.UNREPRESENTABLE]
        self.assertEqual([repr(PACKAGE_JSON)], [n.where for n in notes])
        self.assertIn(repr("build\nall"), notes[0].observed)

    def test_an_ordinary_name_is_still_proposed_unquoted(self):
        """The control, and the second half is the decision's grammar table:
        a value needing no quoting acquires none, or every rendered artifact
        would carry `npm run 'test'` where the table says `npm run test`."""
        survey = self.scan_with_script("build-all")
        self.assertEqual(
            ["npm run build-all", "npm run ok"], self.values(survey.commands)
        )
        self.assertNotIn(scan.UNREPRESENTABLE, self.note_ids(survey))

    def test_a_quoted_name_still_validates_as_a_record(self):
        """Widening what is proposed must not trade a refusal for an exit 2 in
        the next `generate` (ADR-32)."""
        survey = self.scan_with_script("build all")
        manifest.validate({"commands": list(survey.commands)})


class MakefileGrammarTest(ScanFixture):
    """P3.2 — the hand-rolled Makefile reader, and what it must not propose.

    No stdlib parser exists for this and none may be vendored, so the grammar
    is line-oriented and deliberately narrow. Everything it refuses is
    something that would otherwise become a command record naming a target
    `make` does not have — which is A1, manufactured by us.
    """

    HOSTILE = (
        "# a comment\n"
        "CFLAGS := -g\n"
        "PREFIX ?= /usr/local\n"
        "export TAG := v1\n"
        "SIMPLE ::= x\n"
        "FILES := one.c \\\n"
        "         two.c:extra\n"
        "\n"
        ".PHONY: test lint\n"
        "\n"
        "test: build\n"
        "\tpytest\n"
        "\n"
        "lint:\n"
        "\truff check .\n"
        "\n"
        "%.o: %.c\n"
        "\tcc -c $<\n"
        "\n"
        "$(GENERATED):\n"
        "\ttouch $@\n"
        "\n"
        "ifeq ($(A):,$(B))\n"
        "endif\n"
        "\n"
        "define helper\n"
        "hidden: nope\n"
        "endef\n"
        "\n"
        "double::\n"
        "\techo hi\n"
        "\n"
        "build/artifact: build\n"
        "\ttouch $@\n"
    )

    def test_only_the_real_targets_are_proposed(self):
        self.write("Makefile", self.HOSTILE)
        self.commit()
        self.assertEqual(
            [
                "make build/artifact",
                "make double",
                "make lint",
                "make test",
            ],
            self.values(self.survey().commands),
        )

    def test_the_fixture_really_contains_every_shape_it_excludes(self):
        """Non-vacuity: an equality over four targets would also pass if the
        fixture had simply lost the hostile lines."""
        for fragment in (
            "CFLAGS :=",
            "SIMPLE ::=",
            "two.c:extra",
            ".PHONY:",
            "%.o: %.c",
            "$(GENERATED):",
            "ifeq ($(A):,$(B))",
            "hidden: nope",
        ):
            self.assertIn(fragment, self.HOSTILE)

    def test_only_the_makefile_make_would_read_is_read(self):
        """**This assertion is B3 inverted.** It used to say the-steward reads
        every tracked makefile name, "because each is a declaration and
        neither is silently preferred" — which proposed `make a` for a repo
        where bare `make a` fails, since `make` loads `GNUmakefile` alone.
        `ShadowedMakefileTest` owns the rule and its diagnostic."""
        self.write("Makefile", "a:\n\techo\n")
        self.write("GNUmakefile", "b:\n\techo\n")
        self.commit()
        self.assertEqual(["make b"], self.values(self.survey().commands))


class AmbiguousIndexEntryTest(ScanFixture):
    """P3.2 — an unmerged index says two things, so the scanner says neither.

    A path in an unmerged index is listed once per stage and the stages can
    disagree about the executable bit. `entries[path] = mode` would answer
    *this is a command* out of whichever stage git printed last: a confident
    answer over an input that never said one thing, which is this project's
    one defect in the costume that needs no failure to occur.
    """

    def conflict(self, relpath):
        """Plant an unmerged entry whose stages disagree about the mode.

        `git update-index --index-info` reads its instructions on stdin, and
        `S.git` cannot feed stdin, so these two calls spawn git directly — and
        **both read the status**, which is the rule the support layer's fourth
        detector exists to enforce (`_support.git_read`'s docstring).
        """
        raw = subprocess.run(
            ["git", "hash-object", "-w", "--stdin"],
            cwd=self.root,
            input=b"#!/bin/sh\nexit 0\n",
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        self.assertEqual(0, raw.returncode, raw.stderr.decode("utf-8", "replace"))
        sha = raw.stdout.decode("utf-8").strip()
        info = "".join(
            "%s %s %d\t%s\n" % (mode, sha, stage, relpath)
            for mode, stage in (("100644", 1), ("100644", 2), ("100755", 3))
        )
        written = subprocess.run(
            ["git", "update-index", "--index-info"],
            cwd=self.root,
            input=info.encode("utf-8"),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        self.assertEqual(
            0, written.returncode, written.stderr.decode("utf-8", "replace")
        )

    def test_an_unmerged_entry_is_never_proposed(self):
        self.conflict("conflict.sh")
        survey = self.survey()
        self.assertEqual([], self.values(survey.commands))
        self.assertIn(scan.UNMERGED_ENTRY, self.note_ids(survey))

    def test_the_fixture_really_planted_disagreeing_modes(self):
        """Without this the exclusion could pass because nothing was planted."""
        self.conflict("conflict.sh")
        listed = S.git_read(self.root, "ls-files", "--stage").decode("utf-8")
        modes = set(
            line.split(" ")[0]
            for line in listed.splitlines()
            if line.endswith("conflict.sh")
        )
        self.assertEqual({"100644", "100755"}, modes, "the fixture is inert")

    def test_a_merged_executable_is_still_proposed(self):
        """The counter-weight: refusing an ambiguous entry must not make the
        scanner blind to an unambiguous one."""
        self.write("scripts/ok.sh", "#!/bin/sh\nexit 0\n")
        os.chmod(os.path.join(self.root, "scripts", "ok.sh"), 0o755)
        self.commit()
        self.conflict("conflict.sh")
        self.assertEqual(["./scripts/ok.sh"], self.values(self.survey().commands))


class DeclaredPathListTest(ScanFixture):
    """P3.3 — the declared path list, and the only thing that produces it.

    ADR-32: "Nothing else ever becomes a C2 claim — there is no prose scanner
    upstream of this." So the negative here is load-bearing: a paragraph naming
    a file produces **no** record, and this phase builds no reader that could
    make it produce one.
    """

    def test_a_root_agent_document_is_a_source_of_truth(self):
        self.write("AGENTS.md", "# agents\n")
        self.commit()
        self.assertEqual(
            ["AGENTS.md", "README.md"], self.values(self.survey().paths)
        )

    def test_the_claude_shim_is_one_too(self):
        self.write("CLAUDE.md", "# claude\n")
        self.commit()
        self.assertIn("CLAUDE.md", self.values(self.survey().paths))

    def test_a_nested_agent_document_is_detected_at_any_depth(self):
        """ADR-16: reported as a detected fact. Which file *wins* is not
        encoded here, because there is no standard and the implementers
        disagree."""
        self.write("sub/deep/AGENTS.md", "# nested\n")
        self.commit()
        self.assertIn("sub/deep/AGENTS.md", self.values(self.survey().paths))

    def test_confidence_separates_the_canonical_from_the_conventional(self):
        self.write("AGENTS.md", "# agents\n")
        self.write("sub/AGENTS.md", "# nested\n")
        self.commit()
        levels = dict(
            (record["value"], record["confidence"])
            for record in self.survey().paths
        )
        self.assertEqual("high", levels["AGENTS.md"])
        self.assertEqual("low", levels["sub/AGENTS.md"])
        self.assertEqual("low", levels["README.md"])

    def test_an_ordinary_document_is_never_a_declared_path(self):
        """The whole set, as equality: a scanner that proposed nothing could
        not pass this as `it excluded the right file`."""
        self.write("docs/design.md", "# design\n")
        self.write("notes.md", "See docs/design.md and scripts/build.sh\n")
        self.commit()
        self.assertEqual(["README.md"], self.values(self.survey().paths))

    def test_no_prose_is_read_at_all(self):
        """ADR-32: a claim written in prose is not verified, and there is no
        heuristic v0 will grow to guess it."""
        self.write("README.md", "Run `npm run nonexistent`. See MISSING.md.\n")
        self.commit()
        survey = self.survey()
        self.assertEqual(["README.md"], self.values(survey.paths))
        self.assertEqual([], self.values(survey.commands))

    def test_a_declared_path_record_carries_no_resolution(self):
        """`resolution` is a command-record key. A paths record carrying one
        would be rejected by the validator at exit 2 (ADR-32)."""
        self.write("AGENTS.md", "# agents\n")
        self.commit()
        for record in self.survey().paths:
            self.assertNotIn("resolution", record)


class ControlCharacterPathTest(ScanFixture):
    """P3.3 / ADR-32 — v0 can make no claim about such a path, and says so.

    `manifest._validate_record_value` refuses a value carrying U+0000-U+001F or
    U+007F at **exit 2**, so proposing one would make the next `generate` fail
    validation over a value this module invented. The path is dropped from every
    record set, a diagnostic names it, and the scan still exits 0.
    """

    NEWLINE_DOCUMENT = "weird\nname.md"
    NEWLINE_AGENT_DIRECTORY = "weird\ndir"

    def plant(self):
        for relpath in (
            self.NEWLINE_DOCUMENT,
            self.NEWLINE_AGENT_DIRECTORY + "/AGENTS.md",
        ):
            self.write(relpath, "# x\n")
        self.commit()

    def test_the_fixture_really_tracks_a_control_character_path(self):
        """Non-vacuity: on a filesystem that refused the name, every assertion
        below would pass over a repository that never held one."""
        self.plant()
        listed = S.git_read(self.root, "ls-files", "-z").decode("utf-8")
        self.assertIn(
            self.NEWLINE_DOCUMENT,
            listed.split("\0"),
            "git is not tracking the newline path — the fixture is inert",
        )

    def test_it_is_never_a_declared_path_record(self):
        self.plant()
        for record in self.survey().paths:
            self.assertIsNone(
                text.first_control_character(record["value"]),
                "a control-character path was proposed: %r" % record["value"],
            )
        self.assertEqual(["README.md"], self.values(self.survey().paths))

    def test_it_is_never_in_the_inferred_docs_scope(self):
        self.plant()
        for entry in self.survey().docs_scope["include"]:
            self.assertIsNone(text.first_control_character(entry))

    def test_a_diagnostic_names_it(self):
        self.plant()
        notes = [n for n in self.survey().notes if n.id == scan.UNREPRESENTABLE]
        self.assertTrue(notes, "the path was dropped without a diagnostic")
        self.assertTrue(
            any(repr(self.NEWLINE_DOCUMENT) in note.observed for note in notes),
            "the diagnostic does not name the path it dropped",
        )

    def test_the_scan_still_exits_zero_and_renders_one_item_per_line(self):
        self.plant()
        code, out, err = self.run_scan()
        self.assertEqual(0, code, err)
        self.assertNotIn("Traceback", err, "a predicted case printed a crash")
        self.assertNotIn(
            self.NEWLINE_DOCUMENT,
            out,
            "the raw newline reached the report and split one item over two "
            "lines",
        )


class DocsScopeTest(ScanFixture):
    """P3.3 — the docs scope, inferred from the ADR-10 corpus and nothing else.

    The corpus is `corpus.enumerate_documents`: a tracked `*.md` path git marks
    neither vendored nor generated. No filesystem walk and no `find` — in the
    reference repository `find . -name '*.md'` returns 175,944 paths against
    `git ls-files`'s 1,091.
    """

    def include(self, survey=None):
        survey = self.survey() if survey is None else survey
        return list((survey.docs_scope or {}).get("include", []))

    def test_root_documents_and_document_directories_are_the_scope(self):
        self.write("docs/a.md", "# a\n")
        self.write("docs/deep/b.md", "# b\n")
        self.commit()
        self.assertEqual(["README.md", "docs"], self.include())

    def test_an_untracked_document_is_not_in_the_scope(self):
        self.write("docs/a.md", "# a\n")
        self.assertEqual(["README.md"], self.include())
        self.commit()
        self.assertEqual(
            ["README.md", "docs"],
            self.include(),
            "committing it changed nothing — the corpus is not being read",
        )

    def test_a_document_git_marks_as_generated_is_not_in_the_scope(self):
        """Delegated to ADR-10's predicate, and asserted here so the scanner
        cannot quietly grow its own enumerator."""
        self.write("build/out.md", "# generated\n")
        self.write(".gitattributes", "build/out.md linguist-generated=true\n")
        self.commit()
        self.assertEqual(["README.md"], self.include())

    def test_a_conventional_layout_is_high_confidence(self):
        self.write("docs/a.md", "# a\n")
        self.commit()
        self.assertEqual("high", self.survey().docs_scope["confidence"])

    def test_documents_scattered_outside_a_docs_directory_are_low(self):
        """The judgment the confidence records: that `src/` holds this
        repository's *documentation* is an inference from nothing but a `*.md`
        file being in it."""
        self.write("src/app/README.md", "# app\n")
        self.commit()
        survey = self.survey()
        self.assertEqual(["README.md", "src"], self.include(survey))
        self.assertEqual("low", survey.docs_scope["confidence"])

    def test_a_repository_with_no_document_declares_no_scope(self):
        """ADR-30: `generate` turns exactly this into a **proposed**
        `intentionallyEmpty` record for the `docsScope` key, so scan has to be
        able to say the inferred list came back empty."""
        S.git(self.root, "rm", "-q", "README.md")
        self.commit("drop docs")
        survey = self.survey()
        self.assertIsNone(survey.docs_scope)
        _found, cardinalities = scan.survey_findings(survey)
        line = [c for c in cardinalities if c["check"] == scan.DOCS_SCOPE_CHECK][0]
        self.assertEqual(0, line["examined"])
        self.assertTrue(line["reason"], "a zero cardinality gave no reason")

    def test_the_scope_record_validates_as_a_docs_scope(self):
        self.write("docs/a.md", "# a\n")
        self.commit()
        manifest.validate({"docsScope": self.survey().docs_scope})


class HarnessDetectionTest(ScanFixture):
    """P3.3 — harness directories, **existence only** (ADR-23, ADR-4).

    Asserting what a harness *reads* out of one would be product code written
    against an unverified vendor contract, which escalates to the owner rather
    than shipping. So the finding says a directory is there and how many tracked
    entries are under it, and nothing else.
    """

    def harness_findings(self, survey=None):
        found, _c = scan.survey_findings(self.survey() if survey is None else survey)
        return [item for item in found if item["id"] == scan.HARNESS_FINDING]

    def test_a_tracked_harness_directory_is_reported(self):
        self.write(".claude/settings.json", "{}\n")
        self.commit()
        self.assertEqual([".claude"], [f["where"] for f in self.harness_findings()])

    def test_it_is_inspection_and_never_an_inference(self):
        """Pure existence is *inspected*: nothing was concluded beyond what was
        seen, which is why it carries no confidence (ADR-28)."""
        self.write(".codex/config.toml", "\n")
        self.commit()
        for item in self.harness_findings():
            self.assertEqual("inspected", item["tier"])
            self.assertNotIn("confidence", item)

    def test_a_repository_with_none_reports_none(self):
        self.docs_only_fixture()
        self.assertEqual([], self.harness_findings())
        self.write(".cursor/rules", "\n")
        self.commit()
        self.assertEqual(
            [".cursor"],
            [f["where"] for f in self.harness_findings()],
            "the detector cannot see a harness directory at all — the "
            "assertion above proved nothing",
        )


class ReportWordingTest(ScanFixture):
    """ADR-4 and ADR-16 — what the scan report may never say."""

    BANNED = (
        "enforces",
        "enforcing",
        "guarantees",
        "guaranteed",
        "enforcement works",
        "there is no enforcement",
        "protected by the-steward",
    )

    # ADR-16: there is no standard for nested `AGENTS.md`, the implementers
    # disagree, and the decision encodes neither reading as truth. A scan that
    # said which file wins would ship one.
    PRECEDENCE = ("takes precedence", "overrides", "wins over", "is canonical")

    def report(self):
        self.node_fixture()
        self.write("AGENTS.md", "# agents\n")
        self.write("sub/AGENTS.md", "# nested\n")
        self.write(".claude/settings.json", "{}\n")
        self.commit()
        code, out, err = self.run_scan()
        self.assertEqual(0, code, err)
        self.assertTrue(out.strip(), "the report is empty — nothing to audit")
        return out.lower()

    def test_no_enforcement_claim_appears(self):
        report = self.report()
        for phrase in self.BANNED:
            self.assertNotIn(phrase, report)

    def test_no_precedence_between_agent_documents_is_asserted(self):
        report = self.report()
        for phrase in self.PRECEDENCE:
            self.assertNotIn(phrase, report)


class ScanWritesNothingTest(ScanFixture):
    """P3.4 — `scan` writes nothing, not even a pending record (ADR-11).

    **T1, and it is the whole reason this class is shaped the way it is.** A
    fixture that runs `scan` over a repository and observes no change cannot
    distinguish a correct scanner from one that was never called: an audit over
    clean code reports nothing whether it works or not. So every write
    assertion below is paired, *in the same test*, with an assertion that the
    scan ran and produced findings — and `test_the_guard_would_notice_a_write`
    plants a byte to prove the comparison itself can fail.

    **T2 — the tree is compared with `S.tree_snapshot`, never `S.porcelain`
    alone.** `.steward.json` in a fresh repository is untracked, and
    `git status --porcelain` prints the same single `?? .steward.json` whatever
    that file now contains, nothing at all for an ignored path, and one line for
    a whole untracked directory. A `scan` that rewrote the manifest in place
    would pass a porcelain-only fixture. The plan names both halves, so both are
    asserted: the snapshot digests every regular file, and the manifest bytes are
    read straight off disk.
    """

    def scan_producing_findings(self):
        """One `scan`, asserted to have actually done something.

        Without this the byte comparisons in every test below would be
        satisfied by a verb that returned immediately.
        """
        code, out, err = self.run_scan()
        self.assertEqual(0, code, err)
        self.assertNotIn("Traceback", err, "a predicted fault printed a crash")
        self.assertIn("Findings:", out, "the scan produced no finding at all")
        return out

    def test_two_consecutive_scans_leave_the_tree_byte_identical(self):
        self.node_fixture()
        first = self.scan_producing_findings()
        before_tree = S.tree_snapshot(self.root)
        before_porcelain = S.porcelain(self.root)
        second = self.scan_producing_findings()
        self.assertEqual(
            before_tree, S.tree_snapshot(self.root), "`scan` wrote to the tree"
        )
        self.assertEqual(
            before_porcelain, S.porcelain(self.root), "`git status` changed"
        )
        self.assertEqual(first, second, "two scans of one tree disagreed")

    def test_the_manifest_bytes_are_untouched(self):
        self.node_fixture()
        raw = json.dumps(
            {
                "commands": [
                    {
                        "value": "npm run test",
                        "state": "confirmed",
                        "resolution": "repo-declared",
                    }
                ]
            },
            indent=2,
            sort_keys=True,
        ) + "\n"
        self.write(MANIFEST, raw)
        self.scan_producing_findings()
        self.scan_producing_findings()
        self.assertEqual(
            raw, S.read_text(os.path.join(self.root, MANIFEST)), "the manifest changed"
        )

    def test_a_repository_with_no_manifest_is_never_written_to(self):
        """The plan names this case explicitly: `scan` must not CREATE one."""
        self.node_fixture()
        location = os.path.join(self.root, MANIFEST)
        self.assertFalse(os.path.exists(location))
        with S.unchanged_tree(self, self.root):
            self.scan_producing_findings()
            self.scan_producing_findings()
        self.assertFalse(
            os.path.exists(location),
            "`scan` created a manifest — `generate` is the sole persister",
        )

    def test_no_pending_record_is_written_into_an_existing_manifest(self):
        """ADR-11: a re-scan's deltas reach `scan.pending[]` only through the
        next `generate`, in the same manifest write ADR-20 already performs."""
        self.node_fixture()
        raw = '{\n  "commands": []\n}\n'
        self.write(MANIFEST, raw)
        self.scan_producing_findings()
        document = json.loads(S.read_text(os.path.join(self.root, MANIFEST)))
        self.assertNotIn("scan", document)

    def test_the_guard_would_notice_a_write(self):
        """Non-vacuity, in all three of the shapes the comparisons above use.

        A guard that cannot fail is the dead test this project exists to
        refuse, and porcelain's blind spots are why the snapshot is the
        primary oracle rather than the convenient one.
        """
        self.node_fixture()
        before = S.tree_snapshot(self.root)
        self.write(MANIFEST, "{}\n")
        self.assertNotEqual(before, S.tree_snapshot(self.root), "a new file")

        rewritten = S.tree_snapshot(self.root)
        self.write(MANIFEST, '{"paths": []}\n')
        self.assertNotEqual(
            rewritten,
            S.tree_snapshot(self.root),
            "a name-preserving rewrite of an untracked file — the exact shape "
            "a `scan` regression would take, and the one porcelain cannot see",
        )


class ScanReportTest(ScanFixture):
    """P3.4 — the report itself: every check's cardinality, and no absolute path."""

    def test_every_check_states_the_cardinality_it_examined(self):
        self.node_fixture()
        _found, cardinalities = scan.survey_findings(self.survey())
        self.assertEqual(list(scan.CHECKS), [c["check"] for c in cardinalities])

    def test_a_zero_cardinality_always_states_its_reason(self):
        """ADR-30: "0 examined, 0 problems found" may never render as coverage.

        `findings.cardinality` raises when a zero carries no reason, so the
        assertion is that the survey can produce one at all — over a repository
        deliberately built to make every check come back empty.
        """
        S.git(self.root, "rm", "-q", "README.md")
        self.commit("empty")
        _found, cardinalities = scan.survey_findings(self.survey())
        for line in cardinalities:
            self.assertEqual(0, line["examined"], line["check"])
            self.assertTrue(line["reason"], line["check"])

    def test_the_report_names_no_absolute_path(self):
        """ADR-8: a renderer reads no absolute path. One in a report would also
        make two machines' output differ over the same repository."""
        self.node_fixture()
        _code, out, _err = self.run_scan()
        self.assertNotIn(self.root, out)
        self.assertNotIn(os.sep + "private" + os.sep, out)

    def test_a_directory_outside_a_repository_is_reported_and_not_a_fault(self):
        outside = os.path.realpath(
            os.path.join(self.root, os.pardir, "steward-not-a-repo-%d" % os.getpid())
        )
        os.makedirs(outside, exist_ok=True)
        self.addCleanup(shutil.rmtree, outside, True)
        if S.git(outside, "rev-parse", "--show-toplevel").returncode == 0:
            self.skipTest("the system temp dir is itself inside a git repository")
        out, err = io.StringIO(), io.StringIO()
        code = cli.main(["scan"], out, err, cwd=outside)
        message = err.getvalue()
        self.assertEqual(0, code, message)
        self.assertNotIn("Traceback", message, "a predicted state printed a crash")
        self.assertIn(scan.NOT_A_REPOSITORY, out.getvalue())

    def test_the_footer_advertises_no_core_this_repository_does_not_have(self):
        """ADR-1 / P9.4: printing `tools/steward` for a core we did not install
        would name a path we did not install."""
        self.node_fixture()
        _code, out, _err = self.run_scan()
        self.assertIn("core ", out)
        self.assertNotIn("tools/steward", out)

    def test_every_finding_the_scan_emits_obeys_the_tier_contract(self):
        """ADR-28, over the whole finding set rather than one class of it: an
        inference carries a confidence and is never an `error`, and every other
        tier carries none."""
        self.node_fixture()
        self.write("AGENTS.md", "# agents\n")
        self.write(".claude/settings.json", "{}\n")
        self.commit()
        found, _cardinalities = scan.survey_findings(self.survey())
        self.assertTrue(found, "no finding was emitted at all")
        inferred = 0
        for item in found:
            self.assertNotEqual("error", item["severity"], item["id"])
            if item["tier"] == "inferred":
                self.assertIn(item["confidence"], findings.CONFIDENCES)
                inferred += 1
            else:
                self.assertNotIn("confidence", item)
        self.assertGreater(inferred, 0, "no inference was emitted at all")


# =====================================================================
# Seven defects, every one reproduced by **running** the scanner before it was
# changed. They share one cause with each other and with T6 above: the fixtures
# this file shipped with were well-formed exclusively. A Makefile that only ever
# contained real targets never showed the reader an assignment; a command value
# nobody ever typed never had to be typable. So the fixtures below are hostile
# on purpose, and the class that matters most is `TypedCommandTest`, which stops
# reading the claim and runs it.


class IndexFixture(ScanFixture):
    """A fixture that can plant arbitrary index entries, stages included.

    `git update-index --index-info` reads its instructions on stdin and
    `S.git` cannot feed stdin, so these two calls spawn git directly — and
    **both read the status**, which is the rule `_support.git_read`'s docstring
    states and `TestSupportProbeDisciplineTest` enforces.

    It is also the only door to a path git tracks but this filesystem cannot
    hold: APFS refuses a filename whose bytes are not valid UTF-8 with
    `EILSEQ`, while git's index stores path **bytes** and will carry one
    happily.
    """

    def blob(self, payload):
        raw = subprocess.run(
            ["git", "hash-object", "-w", "--stdin"],
            cwd=self.root,
            input=payload,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        self.assertEqual(0, raw.returncode, raw.stderr.decode("utf-8", "replace"))
        return raw.stdout.decode("utf-8").strip()

    def plant(self, entries):
        """`entries` is ((mode, sha, stage, path_bytes), ...), fed verbatim.

        **NUL-terminated, under `-z`.** The default `--index-info` grammar
        separates records with LF, so a path *containing* one is
        `fatal: malformed index info` — and a path containing one is exactly
        what `HostileIndexPathDiagnosticTest` exists to plant. `-z` is the
        documented form for the same input with NUL separators, and it carries
        the non-UTF-8 path this class already planted just as happily.
        """
        payload = b""
        for mode, sha, stage, path in entries:
            payload += b"%s %s %d\t" % (
                mode.encode("ascii"),
                sha.encode("ascii"),
                stage,
            )
            payload += path + b"\0"
        written = subprocess.run(
            ["git", "update-index", "-z", "--index-info"],
            cwd=self.root,
            input=payload,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        self.assertEqual(
            0, written.returncode, written.stderr.decode("utf-8", "replace")
        )

    def staged(self):
        """The raw `<mode> <sha> <stage>\\t<path>` lines git records."""
        return (
            S.git_read(self.root, "ls-files", "--stage")
            .decode("utf-8", "surrogateescape")
            .splitlines()
        )


class TypedCommandTest(ScanFixture):
    """**B1 — the acceptance test that matters most.**

    Every command finding claims "a human can type it at the repository root".
    Until this class existed that sentence was prose: the fixtures used
    well-formed names exclusively, so no assertion in the suite ever put an
    emitted value in front of a shell. Typing the ten values the scanner
    emitted for the fixture below into `/bin/sh` at the repository root, three
    did what the claim says. Two of the remaining seven **executed injected
    code**: `./scripts/$(id).sh` ran `id` through command substitution, and
    `npm run a;id` ran it through the statement separator.

    **Hermetic and safe, by three separate devices.**

    * `npm` and `make` are **shims this test writes**, which print their argv
      and nothing else. Nothing real is installed, nothing is downloaded, no
      network is touched, and no build is run.
    * The shim directory is **prepended** to `PATH`, never substituted for it —
      the trap this codebase has already paid for once, where a fixture
      replaced `PATH`, the child died instantly, and the test "passed". Two
      assertions defend it: the environment is checked to still end in the real
      `PATH`, and every shim invocation is checked to have actually produced
      the shim's own marker line.
    * The argv is asserted, not the exit status. `npm run a;id` exits **0**
      while running `id`, so a fixture that asserted only "exit 0" would have
      passed over the injection it exists to catch.

    The executables print a unique token each, so "it ran" is a positive
    reading rather than the absence of an error.
    """

    # (repository-relative path, the token the script prints). Every
    # metacharacter case from the B1 report, plus two controls that were
    # already correct — a plain path and a leading hyphen, which
    # `EXECUTABLE_PREFIX` already neutralises — plus the two **B5** cases: a
    # path whose name begins and one whose name ends with a space. Those two
    # were refused by `_representability_fault` before the `./` and the
    # quoting could make them whole, and they are here because the fix is only
    # honest if the widened value is typable.
    EXECUTABLES = (
        ("scripts/plain.sh", "PLAIN_RAN"),
        ("-lead.sh", "DASH_RAN"),
        ("scripts/check me.sh", "SPACE_RAN"),
        ("scripts/a;id.sh", "SEMI_RAN"),
        ("scripts/it's.sh", "QUOTE_RAN"),
        ("scripts/back\\slash.sh", "BACKSLASH_RAN"),
        ("scripts/$(id).sh", "SUBST_RAN"),
        (" lead space.sh", "LEADSPACE_RAN"),
        ("trail space.sh ", "TRAILSPACE_RAN"),
    )

    # What a correct scan must produce when each of its values is typed.
    # Thirteen lines: nine executables, three package scripts, one Makefile
    # target. Three fixture declarations are deliberately absent:
    #
    # * the option-like names `--help` and `-j4` — quoting cannot rescue them,
    #   so they are diagnosed instead (`OptionLikeNameTest`);
    # * the target `shadowed`, which only the **shadowed** `Makefile` declares
    #   — `make` loads `GNUmakefile` alone, so `make shadowed` would be a
    #   documented command that does not resolve (`ShadowedMakefileTest`).
    EXPECTED_OUTPUT = (
        "BACKSLASH_RAN",
        "DASH_RAN",
        "LEADSPACE_RAN",
        "MAKE-ARGV: [release]",
        "NPM-ARGV: [run] [a;id]",
        "NPM-ARGV: [run] [build all]",
        "NPM-ARGV: [run] [check]",
        "PLAIN_RAN",
        "QUOTE_RAN",
        "SEMI_RAN",
        "SPACE_RAN",
        "SUBST_RAN",
        "TRAILSPACE_RAN",
    )

    SHIM = (
        "#!/bin/sh\n"
        "printf '%s-ARGV:'\n"
        'for argument in "$@"; do printf \' [%%s]\' "$argument"; done\n'
        "printf '\\n'\n"
    )

    def setUp(self):
        ScanFixture.setUp(self)
        # Outside the repository, deliberately: a shim inside it would be
        # committed by `self.commit()` and become a proposed command of its own.
        self.shim_directory = tempfile.mkdtemp(prefix="steward-shim-")
        self.addCleanup(shutil.rmtree, self.shim_directory, True)
        for tool in ("npm", "make"):
            location = os.path.join(self.shim_directory, tool)
            with open(location, "w", encoding="utf-8") as handle:
                handle.write(self.SHIM % tool.upper())
            os.chmod(location, 0o755)
        self.env = dict(os.environ)
        self.env["PATH"] = (
            self.shim_directory + os.pathsep + os.environ.get("PATH", "")
        )

    def hostile_repository(self):
        self.write(
            PACKAGE_JSON,
            json.dumps(
                {
                    "scripts": {
                        "check": "tsc --noEmit",
                        "a;id": "x",
                        "--help": "y",
                        "build all": "z",
                    }
                }
            )
            + "\n",
        )
        # `GNUmakefile` is the file `make` loads; the `Makefile` beside it is
        # never read, and its target must never be offered (B3).
        self.write("GNUmakefile", "release:\n\techo\n\n-j4:\n\techo\n")
        self.write("Makefile", "shadowed:\n\techo\n")
        for relpath, token in self.EXECUTABLES:
            self.write(relpath, "#!/bin/sh\necho %s\n" % token)
            os.chmod(os.path.join(self.root, relpath.replace("/", os.sep)), 0o755)
        self.commit()

    def typed(self, value):
        """One emitted value, typed verbatim at the repository root."""
        return subprocess.run(
            ["/bin/sh", "-c", value],
            cwd=self.root,
            env=self.env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
        )

    def test_the_shim_is_prepended_and_never_a_replacement(self):
        """The named trap, asserted before anything leans on the shim."""
        self.assertTrue(self.env["PATH"].startswith(self.shim_directory + os.pathsep))
        self.assertTrue(
            self.env["PATH"].endswith(os.environ["PATH"]),
            "PATH was replaced rather than prepended to — a child that dies "
            "instantly makes every assertion below vacuous",
        )

    def test_the_shim_really_intercepts_the_tool(self):
        """Non-vacuity for the two argv assertions: without this, an `npm` that
        was never reachable would make them assertions about nothing."""
        done = self.typed("npm run something")
        self.assertEqual(0, done.returncode, done.stdout.decode("utf-8", "replace"))
        self.assertEqual(
            "NPM-ARGV: [run] [something]",
            done.stdout.decode("utf-8").strip(),
            "the shim did not run — PATH is not reaching the child",
        )

    def test_the_fixture_really_holds_every_hostile_name(self):
        """Non-vacuity: on a filesystem that refused one of these names, the
        acceptance assertion below would pass over a repository that never
        held the case it is about."""
        self.hostile_repository()
        tracked = S.git_read(self.root, "ls-files", "-z").decode("utf-8").split("\0")
        for relpath, _token in self.EXECUTABLES:
            self.assertIn(relpath, tracked, "the fixture is inert for %r" % relpath)

    def test_every_emitted_command_runs_the_thing_it_names(self):
        """The whole point: the claim, executed rather than read.

        Asserted as an equality over the **multiset of outputs**, not as ten
        independent `assertIn`s, so a value that silently ran the wrong thing
        (`npm run a;id` reaching npm as `run a`, then `id`) cannot pass.
        """
        self.hostile_repository()
        values = self.values(self.survey().commands)
        self.assertEqual(
            len(self.EXPECTED_OUTPUT),
            len(values),
            "the scanner proposed %r, which is not the ten commands this "
            "fixture declares" % (values,),
        )
        observed = []
        for value in values:
            done = self.typed(value)
            output = done.stdout.decode("utf-8", "replace").strip()
            self.assertEqual(
                0,
                done.returncode,
                "%r exited %d at the repository root: %s"
                % (value, done.returncode, output),
            )
            observed.append(output)
        self.assertEqual(sorted(self.EXPECTED_OUTPUT), sorted(observed))

    def test_no_emitted_command_executes_anything_it_does_not_name(self):
        """The injection half, isolated. `id` prints `uid=`, so its output is
        the tell — and the two cases that carried it exit **0**, which is why
        the exit status alone was never going to catch this."""
        self.hostile_repository()
        for value in self.values(self.survey().commands):
            output = self.typed(value).stdout.decode("utf-8", "replace")
            self.assertNotIn(
                "uid=",
                output,
                "%r reached a shell as more than one command — it executed "
                "`id`, which this repository does not declare" % value,
            )

    def test_no_emitted_command_names_the_shadowed_makefiles_target(self):
        """B3, end to end in the fixture that types the values.

        The shims answer to any argv, so this half cannot be established by
        running the value — `make shadowed` would print `MAKE-ARGV:
        [shadowed]` against a shim exactly as `make release` does. What is
        assertable here is that the scanner never offers it, and
        `ShadowedMakefileTest.test_gnu_make_really_ignores_the_shadowed_file`
        is where real `make` is asked whether that is the right answer.
        """
        self.hostile_repository()
        values = self.values(self.survey().commands)
        self.assertNotIn("make shadowed", values)
        self.assertIn(
            "make release",
            values,
            "no makefile was read at all — the exclusion above proved nothing",
        )


class OptionLikeNameTest(ScanFixture):
    """B1's other half — a name quoting cannot rescue.

    `shlex`-style quoting makes every metacharacter safe, and does **nothing**
    for a name that reads as an option: quoting `--help` yields `--help`
    unchanged. `npm run --help` prints npm's help, and `make -j4` asks for four
    parallel jobs and builds the default target — neither names the thing the
    record claims. ADR-23 forbids writing product code against an unverified
    vendor contract, so an end-of-options form nobody here has verified is not
    the answer either; ADR-28 leaves exactly one: diagnose it, and propose
    nothing.
    """

    def test_an_option_like_script_name_is_not_proposed(self):
        self.write(
            PACKAGE_JSON, json.dumps({"scripts": {"--help": "x", "ok": "y"}}) + "\n"
        )
        self.commit()
        survey = self.survey()
        self.assertEqual(["npm run ok"], self.values(survey.commands))
        self.assertIn(scan.OPTION_LIKE_NAME, self.note_ids(survey))

    def test_an_option_like_make_target_is_not_proposed(self):
        self.write("Makefile", "-j4:\n\techo jobs\n\nreal:\n\techo real\n")
        self.commit()
        survey = self.survey()
        self.assertEqual(["make real"], self.values(survey.commands))
        self.assertIn(scan.OPTION_LIKE_NAME, self.note_ids(survey))

    def test_the_diagnostic_names_the_name_and_the_file(self):
        self.write("Makefile", "-j4:\n\techo jobs\n")
        self.commit()
        notes = [n for n in self.survey().notes if n.id == scan.OPTION_LIKE_NAME]
        self.assertEqual([repr("Makefile")], [n.where for n in notes])
        self.assertIn(repr("-j4"), notes[0].observed)

    def test_a_leading_hyphen_still_reaches_an_executable(self):
        """The counter-weight, and it is not symmetry for its own sake:
        `EXECUTABLE_PREFIX` already neutralises a leading hyphen — `./-lead.sh`
        is a path, not an option — so refusing it there would drop a command
        that is perfectly typable. Verified by `TypedCommandTest`."""
        self.write("-lead.sh", "#!/bin/sh\nexit 0\n")
        os.chmod(os.path.join(self.root, "-lead.sh"), 0o755)
        self.commit()
        survey = self.survey()
        self.assertEqual(["./-lead.sh"], self.values(survey.commands))
        self.assertNotIn(scan.OPTION_LIKE_NAME, self.note_ids(survey))


class ShellWordTest(ScanFixture):
    """B1 — the quoting rule itself, at its two edges.

    A value that needs no quoting must not acquire any: `npm run test` is what
    the decision's grammar table says, and `npm run 'test'` would be a
    gratuitous divergence from it that every rendered artifact would carry.
    """

    def test_an_ordinary_value_is_never_quoted(self):
        self.write(PACKAGE_JSON, '{"scripts": {"test": "jest"}}\n')
        self.write("Makefile", "lint:\n\truff check .\n")
        self.write("scripts/build.sh", "#!/bin/sh\nexit 0\n")
        os.chmod(os.path.join(self.root, "scripts", "build.sh"), 0o755)
        self.commit()
        self.assertEqual(
            ["./scripts/build.sh", "make lint", "npm run test"],
            self.values(self.survey().commands),
        )

    def test_a_value_carrying_a_metacharacter_is_one_quoted_word(self):
        self.write("scripts/a;id.sh", "#!/bin/sh\nexit 0\n")
        os.chmod(os.path.join(self.root, "scripts", "a;id.sh"), 0o755)
        self.commit()
        self.assertEqual(
            ["'./scripts/a;id.sh'"], self.values(self.survey().commands)
        )

    def test_a_single_quote_is_closed_reopened_and_escaped(self):
        """The one case a naive `"'" + value + "'"` gets wrong, and the one
        that made `/bin/sh` exit 2 with `unexpected end of file`."""
        self.write("scripts/it's.sh", "#!/bin/sh\nexit 0\n")
        os.chmod(os.path.join(self.root, "scripts", "it's.sh"), 0o755)
        self.commit()
        self.assertEqual(
            ["'./scripts/it'\"'\"'s.sh'"], self.values(self.survey().commands)
        )

    def test_a_quoted_value_is_still_a_persistable_record(self):
        """Quoting must not put a value past `manifest.validate`, or the fix
        would trade a false claim for an exit 2 in the next `generate`."""
        self.write("scripts/$(id).sh", "#!/bin/sh\nexit 0\n")
        os.chmod(os.path.join(self.root, "scripts", "$(id).sh"), 0o755)
        self.commit()
        survey = self.survey()
        self.assertTrue(survey.commands, "nothing was proposed at all")
        manifest.validate({"commands": list(survey.commands)})


class MakefileAssignmentTest(ScanFixture):
    """B2 — an ordinary assignment is not a rule, and five of them are not five.

    The reader partitioned at the **first colon** before excluding assignments
    and inline comments, so two perfectly ordinary lines produced five targets
    `make` does not have — a 5:1 false-positive rate against the one real
    target in the same file. ADR-32 names the outcome: "a checker that cries
    wolf gets ignored, which is this tool's defining failure by another road."
    """

    ASSIGNMENTS = (
        "REGISTRY = https://example.invalid/image\n"
        "FOO = bar # note: explanation\n"
        "test:\n"
        "\techo real\n"
    )

    # What the old reader invented, named individually so a regression says
    # which shape came back.
    FABRICATED = ("make FOO", "make REGISTRY", "make bar", "make https", "make note")

    def test_an_assignment_line_declares_no_target(self):
        self.write("Makefile", self.ASSIGNMENTS)
        self.commit()
        self.assertEqual(["make test"], self.values(self.survey().commands))

    def test_none_of_the_five_fabricated_targets_survive(self):
        """The same property one name at a time, because a regression that
        brings back one of them should say which."""
        self.write("Makefile", self.ASSIGNMENTS)
        self.commit()
        values = self.values(self.survey().commands)
        for invented in self.FABRICATED:
            self.assertNotIn(invented, values)
        self.assertIn(
            "make test", values, "the reader lost the one real target too"
        )

    def test_the_fixture_really_contains_both_assignment_shapes(self):
        """Non-vacuity: an equality over one target would also hold if the
        fixture had quietly lost the lines that produce the wrong ones."""
        self.assertIn("REGISTRY = https://", self.ASSIGNMENTS)
        self.assertIn("# note: explanation", self.ASSIGNMENTS)

    def test_every_assignment_operator_is_excluded(self):
        self.write(
            "Makefile",
            "PLAIN = a:b\n"
            "SIMPLE := c:d\n"
            "POSIX ::= e:f\n"
            "CONDITIONAL ?= g:h\n"
            "APPEND += i:j\n"
            "SHELLED != echo k:l\n"
            "real:\n\techo\n",
        )
        self.commit()
        self.assertEqual(["make real"], self.values(self.survey().commands))

    def test_a_rule_whose_dependency_holds_an_equals_is_still_a_rule(self):
        """The counter-weight the rule turns on: whichever comes **first**
        decides, so `target: dep=1` is a rule and `VAR := value` is not."""
        self.write("Makefile", "deploy: ENV=prod\n\techo\n")
        self.commit()
        self.assertEqual(["make deploy"], self.values(self.survey().commands))

    def test_a_double_colon_rule_is_still_a_rule(self):
        """`double::` is a rule and `double::=` is an assignment, and the two
        differ by one character at the same position."""
        self.write("Makefile", "double::\n\techo\n\nSTORED ::= x\n")
        self.commit()
        self.assertEqual(["make double"], self.values(self.survey().commands))

    def test_a_colon_inside_a_comment_is_not_a_rule_separator(self):
        """The other half of B2's fix, and the half an assignment rule alone
        does not cover.

        `FOO = bar # note: explanation` is caught by the assignment operator
        before its comment ever matters. A **directive** line is not: nothing
        in `include config.mk # target: nope` is an assignment, so without
        stripping the comment first the reader partitions at the colon inside
        it and reads `config.mk` and `target` as two targets `make` has never
        had.
        """
        self.write(
            "Makefile", "include config.mk # target: nope\nreal:\n\techo\n"
        )
        self.commit()
        self.assertEqual(["make real"], self.values(self.survey().commands))


class SameModeConflictTest(IndexFixture):
    """B3 — an unmerged path whose stages agree about the mode is still unmerged.

    `index_entries` recorded a **set of modes**, so three stages that all say
    `100644` collapsed to one apparent mode and `_one_mode` called the path
    merged. The scanner then read the **conflicted** working-tree file —
    conflict markers and all — and proposed a command out of each side of the
    merge. The suite's existing fixture only ever planted stages that disagreed
    about the executable bit, which is the rarer case.
    """

    CONFLICTED_MAKEFILE = (
        b"<<<<<<< HEAD\none:\n\techo a\n=======\ntwo:\n\techo b\n>>>>>>> other\n"
    )

    def conflict_all_stages(self):
        sha_ours = self.blob(b"one:\n\techo a\n")
        sha_theirs = self.blob(b"two:\n\techo b\n")
        sha_script = self.blob(b"#!/bin/sh\nexit 0\n")
        self.plant(
            (
                ("100644", sha_ours, 1, b"Makefile"),
                ("100644", sha_ours, 2, b"Makefile"),
                ("100644", sha_theirs, 3, b"Makefile"),
                ("100755", sha_script, 1, b"conflicted.sh"),
                ("100755", sha_script, 2, b"conflicted.sh"),
                ("100755", sha_script, 3, b"conflicted.sh"),
            )
        )
        full = os.path.join(self.root, "Makefile")
        with open(full, "wb") as handle:
            handle.write(self.CONFLICTED_MAKEFILE)

    def test_the_fixture_really_planted_agreeing_modes(self):
        """Non-vacuity, and it is the whole distinction from the existing
        fixture: if the planted stages disagreed the old code would already
        have caught them."""
        self.conflict_all_stages()
        for path, mode in (("Makefile", "100644"), ("conflicted.sh", "100755")):
            stages = [line for line in self.staged() if line.endswith("\t" + path)]
            self.assertEqual(3, len(stages), path)
            self.assertEqual(
                {mode},
                set(line.split(" ")[0] for line in stages),
                "the fixture is inert — the stages disagree about the mode, "
                "which is the case already covered",
            )

    def test_a_conflicted_declaration_is_never_read(self):
        self.conflict_all_stages()
        survey = self.survey()
        self.assertEqual([], self.values(survey.commands))
        self.assertIn(scan.UNMERGED_ENTRY, self.note_ids(survey))

    def test_neither_side_of_the_merge_becomes_a_command(self):
        """Named individually: reading the conflicted file proposed **both**
        sides, so the repository was told it declares two targets it has
        never had at the same time."""
        self.conflict_all_stages()
        values = self.values(self.survey().commands)
        self.assertNotIn("make one", values)
        self.assertNotIn("make two", values)

    def test_a_conflicted_executable_is_never_a_command(self):
        self.conflict_all_stages()
        self.assertNotIn("./conflicted.sh", self.values(self.survey().commands))

    def test_the_diagnostic_names_both_paths_and_their_stages(self):
        """ADR-28: nothing is dropped silently, and the note has to say what it
        saw — a mode alone cannot explain why an entry was refused."""
        self.conflict_all_stages()
        notes = [n for n in self.survey().notes if n.id == scan.UNMERGED_ENTRY]
        self.assertEqual(
            [repr("Makefile"), repr("conflicted.sh")],
            sorted(n.where for n in notes),
        )
        for note in notes:
            self.assertIn("stage", note.observed)

    def test_a_merged_declaration_is_still_read(self):
        """The counter-weight: refusing an unmerged entry must not make the
        scanner blind to an ordinary one."""
        self.write("Makefile", "honest:\n\techo\n")
        self.commit()
        self.assertEqual(["make honest"], self.values(self.survey().commands))


class WorkingTreeSymlinkDeclarationTest(ScanFixture):
    """B4 — instance fifteen, costume (c): answering about a different file.

    A committed regular `package.json` **replaced in the working tree** by an
    in-tree symlink keeps index mode `100644`, so the `120000` guard never
    fires. `paths.contain` returns `os.path.realpath(target)`, so the location
    the reader opens is **already the resolved target** — which is why
    `O_NOFOLLOW` at the open would be a no-op, and why the check has to be
    `paths.crosses_symlink` over the current component chain **in addition to**
    the index mode.

    The two controls that already worked are asserted here too, because a fix
    that closed this hole by refusing every declaration would satisfy the
    negative half on its own.
    """

    HONEST_PACKAGE = '{"scripts": {"build": "x", "test": "y"}}\n'
    HONEST_MAKEFILE = "honest:\n\techo\n"

    def swap_for_symlinks(self):
        self.write(PACKAGE_JSON, self.HONEST_PACKAGE)
        self.write("Makefile", self.HONEST_MAKEFILE)
        self.write("elsewhere/package.json", '{"scripts": {"SMUGGLED": "z"}}\n')
        self.write("elsewhere/Makefile", "SMUGGLED_TARGET:\n\techo\n")
        self.commit()
        for relpath in (PACKAGE_JSON, "Makefile"):
            os.remove(os.path.join(self.root, relpath))
            os.symlink(
                os.path.join("elsewhere", relpath), os.path.join(self.root, relpath)
            )

    def test_the_fixture_really_keeps_the_regular_file_index_mode(self):
        """Non-vacuity, and it is the defect in one assertion: git still
        records `100644`, so the mode guard cannot possibly fire."""
        self.swap_for_symlinks()
        listed = S.git_read(self.root, "ls-files", "--stage").decode("utf-8")
        for relpath in (PACKAGE_JSON, "Makefile"):
            line = [l for l in listed.splitlines() if l.endswith("\t" + relpath)]
            self.assertEqual(1, len(line), relpath)
            self.assertTrue(
                line[0].startswith("100644"),
                "git no longer records the replaced file as regular — the "
                "fixture is inert: %s" % line[0],
            )
        self.assertIn(" T ", " " + S.porcelain(self.root))

    def test_the_smuggled_declaration_never_becomes_a_command(self):
        self.swap_for_symlinks()
        for value in self.values(self.survey().commands):
            self.assertNotIn("SMUGGLED", value)

    def test_nothing_at_all_is_proposed_from_a_replaced_declaration(self):
        """The stronger form: the scanner must not read the link's target for
        the honest names either, because it is not reading the file git
        records at that path."""
        self.swap_for_symlinks()
        self.assertEqual([], self.values(self.survey().commands))

    def test_a_diagnostic_names_both_replaced_declarations(self):
        self.swap_for_symlinks()
        notes = [
            n for n in self.survey().notes if n.id == scan.SYMLINKED_DECLARATION
        ]
        self.assertEqual(
            [repr("Makefile"), repr(PACKAGE_JSON)],
            sorted(n.where for n in notes),
        )

    def test_the_scan_still_exits_zero(self):
        self.swap_for_symlinks()
        code, _out, err = self.run_scan()
        self.assertEqual(0, code, err)
        self.assertNotIn("Traceback", err, "a predicted case printed a crash")

    def test_the_same_declarations_are_read_when_no_link_is_in_the_way(self):
        """The control that makes every exclusion above mean something."""
        self.write(PACKAGE_JSON, self.HONEST_PACKAGE)
        self.write("Makefile", self.HONEST_MAKEFILE)
        self.commit()
        self.assertEqual(
            ["make honest", "npm run build", "npm run test"],
            self.values(self.survey().commands),
        )


class NestedTaskRunnerTest(ScanFixture):
    """B7 — a nested task-runner declaration vanished with no diagnostic.

    The nested-path `continue` ran **before** `UNPARSEABLE_DECLARATIONS` was
    consulted, so `tools/Taskfile.yml` produced nothing at all: no command
    (correct) and no diagnostic (ADR-28's S4 failure — "a candidate silently
    dropped both hides a real edge and manufactures a false orphan"). The
    supported basenames were already diagnosed at any depth, because
    `package.json` and `Makefile` are in `DECLARATIONS`; the unsupported ones
    are not, so nothing named them anywhere.
    """

    NESTED = (
        ("tools/Taskfile.yml", "tasks:\n  test:\n    cmds:\n      - pytest\n"),
        ("tools/Justfile", "test:\n  pytest\n"),
        ("tools/Rakefile", "task :test\n"),
    )

    def nested_runners(self):
        for relpath, body in self.NESTED:
            self.write(relpath, body)
        self.commit()

    def test_every_nested_task_runner_is_named_by_a_diagnostic(self):
        self.nested_runners()
        notes = [
            n for n in self.survey().notes if n.id == scan.UNPARSEABLE_DECLARATION
        ]
        self.assertEqual(
            sorted(repr(relpath) for relpath, _body in self.NESTED),
            sorted(n.where for n in notes),
        )

    def test_a_nested_task_runner_still_proposes_no_command(self):
        """The diagnostic is the fix; proposing from it would be the other
        defect. Both halves, so neither can be traded for the other."""
        self.nested_runners()
        self.assertEqual([], self.values(self.survey().commands))

    def test_the_diagnostic_says_it_is_outside_the_repository_root(self):
        """Two things are true of a nested `Taskfile.yml` — the core cannot
        read its format, and no record could name it from the root — and a
        note that stated only the first would name a reason that is not the
        whole one."""
        self.nested_runners()
        notes = [
            n for n in self.survey().notes if n.id == scan.UNPARSEABLE_DECLARATION
        ]
        # T3: a `for` over an empty list asserts nothing, and before the fix
        # this list *was* empty — which is the defect, not a pass.
        self.assertEqual(len(self.NESTED), len(notes))
        for note in notes:
            self.assertIn("outside the repository root", note.observed)

    def test_a_root_task_runner_is_still_diagnosed_without_that_clause(self):
        """The counter-weight: the nested clause must be a clause, not the
        whole message, or the root case would start claiming something false."""
        self.write("Taskfile.yml", "tasks:\n  test:\n    cmds:\n      - pytest\n")
        self.commit()
        notes = [
            n for n in self.survey().notes if n.id == scan.UNPARSEABLE_DECLARATION
        ]
        self.assertEqual([repr("Taskfile.yml")], [n.where for n in notes])
        self.assertNotIn("outside the repository root", notes[0].observed)

    def test_a_nested_supported_declaration_is_still_diagnosed_as_nested(self):
        """The other half of "at any depth": recognising the unsupported names
        deeper must not lose the diagnostic the supported ones already had."""
        self.write("packages/web/package.json", '{"scripts": {"build": "x"}}\n')
        self.commit()
        notes = [
            n for n in self.survey().notes if n.id == scan.NESTED_DECLARATION
        ]
        self.assertEqual(
            [repr("packages/web/package.json")], [n.where for n in notes]
        )


class UnencodableValueTest(IndexFixture):
    """B8 — a value `scan` proposed that `generate` cannot serialise.

    Git stores path **bytes**, and `scan` decodes them with `surrogateescape`,
    so a filename whose bytes are not valid UTF-8 arrives as a str carrying
    lone surrogates. The filter accepted it; `jsonio.dumps` writes canonical
    JSON with `ensure_ascii=False`, and the UTF-8 encode of that output raises
    `UnicodeEncodeError` — a later `generate` failing at exit 2 over a value
    this module invented.

    **Platform bound, stated rather than worked around.** APFS refuses such a
    filename outright (`EILSEQ`), so only the git **index** can hold one here.
    That reaches the executable path end to end, and it does not reach the
    document corpus at all — `corpus.enumerate_documents` keeps only paths that
    are `os.path.isfile`. The declared-path and docs-scope guards are therefore
    asserted against the functions that own them, which is where the rule lives
    and where a Linux checkout would exercise it.
    """

    BAD_EXECUTABLE = b"bad\xff.sh"
    BAD_DOCUMENT = "sub\udcfe/AGENTS.md"
    BAD_CONTAINER = "sub\udcfe"

    def plant_executable(self):
        self.plant(
            (("100755", self.blob(b"#!/bin/sh\nexit 0\n"), 0, self.BAD_EXECUTABLE),)
        )

    def test_the_fixture_really_tracks_a_path_that_is_not_utf8(self):
        """Non-vacuity: on a git that normalised the name, every assertion
        below would pass over a repository that never held one."""
        self.plant_executable()
        raw = S.git_read(self.root, "ls-files", "-z")
        self.assertIn(self.BAD_EXECUTABLE, raw.split(b"\0"))

    def test_it_is_never_proposed_as_a_command(self):
        self.plant_executable()
        self.assertEqual([], self.values(self.survey().commands))

    def test_a_diagnostic_names_it_repr_safely(self):
        self.plant_executable()
        notes = [n for n in self.survey().notes if n.id == scan.UNREPRESENTABLE]
        self.assertTrue(notes, "the path was dropped without a diagnostic")
        decoded = self.BAD_EXECUTABLE.decode("utf-8", "surrogateescape")
        self.assertTrue(
            any(repr(decoded) in note.observed for note in notes),
            "the diagnostic does not name the path it dropped",
        )

    def test_the_scan_still_exits_zero_over_it(self):
        self.plant_executable()
        code, _out, err = self.run_scan()
        self.assertEqual(0, code, err)
        self.assertNotIn("Traceback", err, "a predicted case printed a crash")

    def test_a_declared_path_that_is_not_utf8_is_refused(self):
        """The C2 half, at the function that owns the rule — see the platform
        bound in this class's docstring."""
        notes = []
        records = scan._declared_paths((self.BAD_DOCUMENT, "AGENTS.md"), notes)
        self.assertEqual(["AGENTS.md"], [record["value"] for record in records])
        self.assertEqual([scan.UNREPRESENTABLE], [note.id for note in notes])
        self.assertIn(repr(self.BAD_DOCUMENT), notes[0].observed)

    def test_a_docs_scope_entry_that_is_not_utf8_is_refused(self):
        notes = []
        scope = scan._docs_scope((self.BAD_DOCUMENT, "docs/a.md"), notes)
        self.assertEqual(["docs"], scope["include"])
        self.assertEqual([scan.UNREPRESENTABLE], [note.id for note in notes])
        self.assertIn(repr(self.BAD_CONTAINER), notes[0].observed)

    def test_the_control_shows_those_two_guards_are_not_refusing_everything(self):
        """Without this, a `_representability_fault` that rejected every value
        would satisfy both assertions above."""
        notes = []
        records = scan._declared_paths(("AGENTS.md",), notes)
        self.assertEqual(["AGENTS.md"], [record["value"] for record in records])
        self.assertEqual([], notes)
        self.assertEqual(["docs"], scan._docs_scope(("docs/a.md",), notes)["include"])
        self.assertEqual([], notes)

    def test_every_proposed_record_set_serialises_as_canonical_json(self):
        """The property the whole defect is about, over the real fixtures.

        `manifest.validate` passes a surrogate-bearing value — it checks
        control characters, not encodability — so validation alone was never
        going to catch this. The serialiser is the oracle.
        """
        self.plant_executable()
        for build in (
            self.node_fixture,
            self.python_fixture,
            self.docs_only_fixture,
            self.plant_executable,
        ):
            with self.other_repo():
                build()
                survey = self.survey()
                document = {
                    "commands": list(survey.commands),
                    "paths": list(survey.paths),
                }
                if survey.docs_scope is not None:
                    document["docsScope"] = survey.docs_scope
                import jsonio

                jsonio.dumps_bytes(document)


class MalformedScriptBodyTest(ScanFixture):
    """B9 — a script whose body is not a string is not a script.

    `{"scripts": {"test": null}}` produced a **high**-confidence `npm run test`
    from a key whose value was never read. A high confidence over an entry
    nobody could read is the shape ADR-28 exists to forbid, and the record it
    becomes is a documented command that may not resolve, which is A1.
    """

    def scan_with(self, scripts):
        self.write(PACKAGE_JSON, json.dumps({"scripts": scripts}) + "\n")
        self.commit()
        return self.survey()

    def test_a_null_script_body_is_not_a_command(self):
        survey = self.scan_with({"test": None, "ok": "y"})
        self.assertEqual(["npm run ok"], self.values(survey.commands))
        self.assertIn(scan.MALFORMED_SCRIPT, self.note_ids(survey))

    def test_every_non_string_body_is_refused(self):
        survey = self.scan_with(
            {
                "nulled": None,
                "numbered": 3,
                "listed": ["a"],
                "objected": {"a": "b"},
                "ok": "y",
            }
        )
        self.assertEqual(["npm run ok"], self.values(survey.commands))
        notes = [n for n in survey.notes if n.id == scan.MALFORMED_SCRIPT]
        self.assertEqual(4, len(notes))

    def test_the_diagnostic_names_the_script_and_what_was_there_instead(self):
        survey = self.scan_with({"test": None})
        notes = [n for n in survey.notes if n.id == scan.MALFORMED_SCRIPT]
        self.assertEqual([repr(PACKAGE_JSON)], [n.where for n in notes])
        self.assertIn(repr("test"), notes[0].observed)
        self.assertIn("NoneType", notes[0].observed)

    def test_a_string_body_is_still_proposed(self):
        """The control: a validator that refused every body would satisfy
        every exclusion above."""
        survey = self.scan_with({"test": "jest", "check": ""})
        self.assertEqual(
            ["npm run check", "npm run test"], self.values(survey.commands)
        )
        self.assertNotIn(scan.MALFORMED_SCRIPT, self.note_ids(survey))


# =====================================================================
# Five more defects, from an independent gate over the module above. Three of
# them were **created by the previous round's fixes**: the command-record cwd
# boundary was pushed down into stack detection (B1), the Makefile reader grew
# a directive vocabulary it consulted in the wrong place (B2), and the
# `./`-prefix correction left the whitespace refusal contradicting the very
# decision that added quoting (B5). The fixtures below are hostile for the
# reason the header above gives, and two of them ask a real tool rather than
# asserting a vendor contract from memory.


class NestedProjectStackTest(ScanFixture):
    """**B1** — a nested project is a project, and P3.1 says so per project.

    `Survey.stacks` held only root declarations, so a repository whose only
    manifest is `packages/web/package.json` emitted **no `stack-inferred`
    finding at all** — the scan reported nothing about a repository that
    plainly declares something. The cause was a conflation: the
    DECISION-2026-08-14 boundary is about **command records**, whose value
    (`npm run test`) names whichever project the shell stands in and which the
    frozen schema cannot qualify with a directory. A stack finding names its
    project directory, so it has no such problem.

    The same list also **duplicated** a stack: `(stack, declaration)` pairs
    meant `pyproject.toml` + `setup.py` + `requirements.txt` reported the
    python stack three times, and the ADR-30 cardinality line then counted
    three examined items for one project.

    Both halves are the same fix — key by `(project directory, stack)` and
    aggregate the evidence — and both are asserted here, together with the
    counter-weight that keeps the command boundary where the decision put it.
    """

    def stack_findings(self, survey):
        found, _cardinalities = scan.survey_findings(survey)
        return [item for item in found if item["id"] == scan.STACK_FINDING]

    def test_a_repository_whose_only_project_is_nested_still_reports_it(self):
        self.write("packages/web/package.json", '{"scripts": {"build": "x"}}\n')
        self.commit()
        survey = self.survey()
        self.assertEqual(
            [("packages/web", "node", ("packages/web/package.json",))],
            list(survey.stacks),
        )
        self.assertEqual(
            1,
            len(self.stack_findings(survey)),
            "a repository declaring a node project reported no stack at all",
        )

    def test_the_finding_names_the_project_directory_it_is_about(self):
        """A stack finding that said "at its root" about `packages/web` would
        be a false claim; one that named no directory would be unusable."""
        self.write("packages/web/package.json", '{"scripts": {"build": "x"}}\n')
        self.commit()
        item = self.stack_findings(self.survey())[0]
        self.assertIn(repr("packages/web"), item["claim"])
        self.assertNotIn("at its root", item["claim"])
        self.assertIn(repr("packages/web/package.json"), item["observed"])

    def test_a_root_project_is_still_described_as_the_root(self):
        """The counter-weight: naming the directory must not make the root
        case say `''`, which names nothing a reader can go and look at."""
        self.write("package.json", '{"scripts": {"build": "x"}}\n')
        self.commit()
        item = self.stack_findings(self.survey())[0]
        self.assertIn("at its root", item["claim"])
        self.assertEqual(scan.ROOT_PROJECT, item["where"])

    def test_two_nested_projects_are_two_findings(self):
        self.write("packages/web/package.json", '{"scripts": {"a": "x"}}\n')
        self.write("services/api/pyproject.toml", '[project]\nname = "api"\n')
        self.commit()
        self.assertEqual(
            [
                ("packages/web", "node", ("packages/web/package.json",)),
                ("services/api", "python", ("services/api/pyproject.toml",)),
            ],
            list(self.survey().stacks),
        )

    def test_one_project_with_several_python_declarations_is_one_stack(self):
        self.write("pyproject.toml", '[project]\nname = "app"\n')
        self.write("setup.py", "from setuptools import setup\nsetup()\n")
        self.write("requirements.txt", "requests\n")
        self.commit()
        self.assertEqual(
            [
                (
                    "",
                    "python",
                    ("pyproject.toml", "requirements.txt", "setup.py"),
                )
            ],
            list(self.survey().stacks),
        )

    def test_the_evidence_names_every_declaration_that_established_it(self):
        """Aggregating must not throw two thirds of the evidence away: the
        human confirming the record has to know which files were read."""
        self.write("pyproject.toml", '[project]\nname = "app"\n')
        self.write("setup.py", "from setuptools import setup\nsetup()\n")
        self.commit()
        observed = self.stack_findings(self.survey())[0]["observed"]
        for declaration in ("pyproject.toml", "setup.py"):
            self.assertIn(repr(declaration), observed)

    def test_the_cardinality_counts_projects_and_not_declaration_files(self):
        """ADR-30: the number the report prints is what a reader takes as the
        size of what was examined. Three files, one project, one item."""
        self.write("pyproject.toml", '[project]\nname = "app"\n')
        self.write("setup.py", "from setuptools import setup\nsetup()\n")
        self.write("requirements.txt", "requests\n")
        self.commit()
        _found, cardinalities = scan.survey_findings(self.survey())
        line = [c for c in cardinalities if c["check"] == scan.STACK_CHECK][0]
        self.assertEqual(1, line["examined"])

    def test_two_stacks_in_one_directory_stay_two(self):
        """The counter-weight to the deduplication: the key is the *pair*, so
        a Makefile beside a `package.json` is still two findings."""
        self.write("package.json", '{"scripts": {"a": "x"}}\n')
        self.write("Makefile", "test:\n\techo\n")
        self.commit()
        self.assertEqual(
            [("", "make", ("Makefile",)), ("", "node", ("package.json",))],
            list(self.survey().stacks),
        )

    def test_a_nested_project_still_proposes_no_command(self):
        """**The concern this fix must not swallow.** The command boundary is
        DECISION-2026-08-14 §1 and it is untouched: the nested declaration is
        a stack, and it is still diagnosed rather than proposed from."""
        self.write("packages/web/package.json", '{"scripts": {"build": "x"}}\n')
        self.write("packages/web/Makefile", "deploy:\n\techo\n")
        self.commit()
        survey = self.survey()
        self.assertEqual([], self.values(survey.commands))
        self.assertEqual(
            [
                repr("packages/web/Makefile"),
                repr("packages/web/package.json"),
            ],
            sorted(
                note.where
                for note in survey.notes
                if note.id == scan.NESTED_DECLARATION
            ),
        )

    def test_every_stack_finding_is_still_an_inference(self):
        """ADR-28, over the widened set: emitting more findings must not emit
        one that claims more than an inference may."""
        self.write("packages/web/package.json", '{"scripts": {"a": "x"}}\n')
        self.write("Makefile", "test:\n\techo\n")
        self.commit()
        items = self.stack_findings(self.survey())
        self.assertEqual(2, len(items))
        for item in items:
            self.assertEqual("inferred", item["tier"])
            self.assertEqual("info", item["severity"])
            self.assertIn(item["confidence"], findings.CONFIDENCES)


class MakefileDirectiveTest(ScanFixture):
    """**B2** — a directive line is not a rule, wherever its colon sits.

    `MAKE_DIRECTIVES` existed and was consulted in the **wrong place**: only
    `_is_make_target` looked at it, and that sees the tokens of a rule head
    *after* the line has already been split at a colon. So the directive word
    itself was filtered and its **argument** was not —

        include config:prod.mk   ->  ['config', 'real']
        vpath %.c src:lib        ->  ['src', 'real']

    — proposing `make config`, a target `make` does not have, which is A1
    manufactured by us. The line has to be refused **before** a rule separator
    is looked for, which is where the comment strip and the assignment scan
    already run.

    The `define` cases are the same defect through a different hole: the block
    detector compared `stripped.split(" ")[0]`, so a TAB-separated `define`
    and GNU make's documented `override define` were not recognised as blocks
    at all and their bodies' labels leaked out as targets.
    """

    def targets(self, body):
        self.write("Makefile", body)
        self.commit()
        return self.values(self.survey().commands)

    def test_a_directive_argument_containing_a_colon_is_not_a_target(self):
        self.assertEqual(
            ["make real"], self.targets("include config:prod.mk\nreal:\n\techo\n")
        )

    def test_every_include_spelling_is_a_directive(self):
        self.assertEqual(
            ["make real"],
            self.targets(
                "include a:1.mk\n"
                "-include b:2.mk\n"
                "sinclude c:3.mk\n"
                "real:\n\techo\n"
            ),
        )

    def test_a_vpath_directive_is_not_a_target(self):
        self.assertEqual(
            ["make real"], self.targets("vpath %.c src:lib\nreal:\n\techo\n")
        )

    def test_a_conditional_directive_is_not_a_target(self):
        self.assertEqual(
            ["make real"],
            self.targets(
                "ifdef HOST:\nelse\nendif\n"
                "ifneq (a:b,c)\nendif\n"
                "real:\n\techo\n"
            ),
        )

    def test_a_tab_separated_define_block_leaks_no_body_label(self):
        self.assertEqual(
            ["make real"],
            self.targets("define\thelper\nhidden: nope\nendef\nreal:\n\techo\n"),
        )

    def test_an_override_define_block_leaks_no_body_label(self):
        self.assertEqual(
            ["make real"],
            self.targets(
                "override define helper\nhidden: nope\nendef\nreal:\n\techo\n"
            ),
        )

    def test_an_export_define_block_leaks_no_body_label(self):
        self.assertEqual(
            ["make real"],
            self.targets(
                "export define helper\nhidden: nope\nendef\nreal:\n\techo\n"
            ),
        )

    def test_a_nested_define_block_is_closed_by_its_own_endef(self):
        """A flat "am I defining" flag lets the **inner** `endef` reopen the
        file, and everything after it in the outer body reads as rules."""
        self.assertEqual(
            ["make real"],
            self.targets(
                "define outer\n"
                "define inner\n"
                "inner-label: nope\n"
                "endef\n"
                "outer-label: nope\n"
                "endef\n"
                "real:\n\techo\n"
            ),
        )

    def test_a_target_is_still_read_from_a_file_full_of_directives(self):
        """The counter-weight: refusing directive lines must not refuse the
        rule that follows them, or every exclusion above passes vacuously."""
        self.assertEqual(
            ["make build", "make real"],
            self.targets(
                "include config:prod.mk\n"
                "export TAG := v1\n"
                "build:\n\techo\n"
                "real:\n\techo\n"
            ),
        )

    def test_a_target_whose_name_begins_with_a_directive_word_is_a_rule(self):
        """`includes:` is not the directive `include`, and the split has to be
        on whitespace for that to stay true."""
        self.assertEqual(
            ["make includes"], self.targets("includes:\n\techo\n")
        )


class RecipePrefixTest(ScanFixture):
    """**B2's other half** — `.RECIPEPREFIX`, refused rather than guessed at.

    A recipe line is TAB-indented, and `.RECIPEPREFIX = >` changes that for
    the rest of the file. The reader's only recipe rule is
    `line.startswith("\\t")`, so every recipe line of such a file was read as
    a potential rule and a URL in one of them fabricated a target:

        .RECIPEPREFIX = >
        real:
        >   curl https://example.invalid/x     ->  ['real', 'curl', 'https']

    **Refused, not supported**, and the refusal is the whole file. Supporting
    it means encoding GNU make's semantics for a directive this project has
    not verified — that the value's first character is the prefix, that an
    empty value restores the tab, that it applies from the assignment onward —
    which is product code against an unverified vendor contract (ADR-23). A
    refusal carrying a diagnostic is never a false claim (ADR-28).
    """

    CUSTOM = (
        ".RECIPEPREFIX = >\n"
        "real:\n"
        ">\tcurl https://example.invalid/x\n"
    )

    def scan_with(self, body):
        self.write("Makefile", body)
        self.commit()
        return self.survey()

    def test_a_custom_recipe_prefix_fabricates_no_target(self):
        survey = self.scan_with(self.CUSTOM)
        for invented in ("make curl", "make https"):
            self.assertNotIn(invented, self.values(survey.commands))

    def test_nothing_at_all_is_proposed_from_such_a_file(self):
        """The stronger form, and the honest one: once the recipe marker is
        something this reader does not track, it cannot tell a rule from a
        recipe anywhere in the file — including for `real`."""
        self.assertEqual([], self.values(self.scan_with(self.CUSTOM).commands))

    def test_the_refusal_is_diagnosed_by_name(self):
        survey = self.scan_with(self.CUSTOM)
        notes = [n for n in survey.notes if n.id == scan.RECIPE_PREFIX]
        self.assertEqual([repr("Makefile")], [n.where for n in notes])
        self.assertIn(".RECIPEPREFIX", notes[0].observed)

    def test_the_scan_still_exits_zero(self):
        self.scan_with(self.CUSTOM)
        code, out, err = self.run_scan()
        self.assertEqual(0, code, err)
        self.assertNotIn("Traceback", err, "a predicted case printed a crash")
        self.assertIn(scan.RECIPE_PREFIX, out)

    def test_every_spelling_of_the_assignment_is_caught(self):
        for body in (
            ".RECIPEPREFIX = >\nreal:\n\techo\n",
            ".RECIPEPREFIX:=>\nreal:\n\techo\n",
            ".RECIPEPREFIX ?= >\nreal:\n\techo\n",
            "override .RECIPEPREFIX = >\nreal:\n\techo\n",
        ):
            with self.other_repo():
                survey = self.scan_with(body)
                self.assertEqual([], self.values(survey.commands), body)
                self.assertIn(scan.RECIPE_PREFIX, self.note_ids(survey), body)

    def test_a_makefile_that_never_touches_it_is_read_normally(self):
        """The counter-weight: a refusal keyed on a substring somebody typed
        in a comment or a variable *name* would refuse every Makefile."""
        survey = self.scan_with(
            "# see .RECIPEPREFIX in the manual\n"
            "MY_RECIPEPREFIX = >\n"
            "real:\n\techo\n"
        )
        self.assertEqual(["make real"], self.values(survey.commands))
        self.assertNotIn(scan.RECIPE_PREFIX, self.note_ids(survey))


class ShadowedMakefileTest(ScanFixture):
    """**B3** — `make` reads one makefile, so the-steward proposes from one.

    Every tracked root makefile name was parsed and every target of every one
    of them proposed. Bare `make <target>` loads only the
    **highest-precedence** file, so with `GNUmakefile` present a target
    declared only in `Makefile` produced `make test` — and `make test` fails
    with *No rule to make target*, against a finding claiming a human can type
    it at the repository root. That is A1, emitted by the tool that exists to
    detect it.

    The lookup order is GNU make's documented one — `GNUmakefile`,
    `makefile`, `Makefile` — and it is **verified against real `make`** below
    rather than asserted from memory, because a fix written against a vendor
    contract nobody checked is what ADR-23 forbids.
    """

    def test_the_lookup_order_is_gnu_makes_documented_one(self):
        """Pinned as an ordered tuple: the list it replaces was alphabetical
        (`GNUmakefile`, `Makefile`, `makefile`), which is the wrong order and
        reads as the right one.

        The second assertion is the cross-check that keeps the two tables
        honest: a makefile name that establishes the `make` stack but is
        missing from the lookup order would be a file the scanner reports and
        can never read.
        """
        self.assertEqual(
            ("GNUmakefile", "makefile", "Makefile"), scan.MAKEFILE_PRECEDENCE
        )
        self.assertEqual(
            sorted(scan.MAKEFILE_PRECEDENCE),
            sorted(
                name
                for name, stack in scan.DECLARATIONS.items()
                if stack == "make"
            ),
        )

    def shadowed_repository(self):
        """The regression the gate named: **only the shadowed file** declares
        a target, so a scanner that reads both proposes a command that fails
        and one that reads neither proposes nothing."""
        self.write("GNUmakefile", "only-here:\n\techo active\n")
        self.write("Makefile", "test:\n\techo shadowed\n")
        self.commit()

    def test_a_target_only_the_shadowed_file_declares_is_never_proposed(self):
        self.shadowed_repository()
        values = self.values(self.survey().commands)
        self.assertEqual(["make only-here"], values)
        self.assertNotIn("make test", values)

    def test_the_shadowed_file_is_diagnosed_and_the_active_one_named(self):
        """ADR-28: the declaration is real and was deliberately not proposed
        from, so it owes a diagnostic — and one that does not say which file
        *is* read leaves the human with no way to act on it."""
        self.shadowed_repository()
        notes = [n for n in self.survey().notes if n.id == scan.SHADOWED_MAKEFILE]
        self.assertEqual([repr("Makefile")], [n.where for n in notes])
        self.assertIn("GNUmakefile", notes[0].observed)

    def test_the_filesystem_cannot_hold_the_middle_pair_of_the_order(self):
        """**The platform bound, asserted rather than assumed.**

        `makefile` and `Makefile` differ only in case, and APFS is
        case-insensitive: writing both leaves **one** file, so the end-to-end
        fixture below it cannot exist here — the first `write` is overwritten
        by the second, and a test asserting `make lower` would be asserting
        over a repository that never held two makefiles. This is the same
        shape as `UnencodableValueTest`'s bound, and it is stated the same
        way: prove the platform collapses them, then ask the function that
        owns the rule.
        """
        self.write("makefile", "lower:\n\techo\n")
        self.write("Makefile", "upper:\n\techo\n")
        self.commit()
        tracked = S.git_read(self.root, "ls-files", "-z").decode("utf-8")
        names = [
            name
            for name in tracked.split("\0")
            if name.lower() == "makefile"
        ]
        if len(names) == 2:
            self.skipTest(
                "this filesystem is case-sensitive; the end-to-end pair is "
                "expressible here and the unit assertion below is not the "
                "only coverage"
            )
        self.assertEqual(1, len(names), tracked)

    def test_lowercase_makefile_outranks_the_capitalised_one(self):
        """The middle of the three, which an alphabetical order gets wrong —
        at the function that owns it, for the reason stated above.

        `_active_makefile` reads nothing but the **names** in the index, so a
        mapping is the whole input it needs; the diagnostic is what says which
        name it chose, and it is asserted here rather than the target list
        because on a case-insensitive checkout both names resolve to the same
        bytes on disk.
        """
        notes = []
        entries = {
            "makefile": frozenset((("100644", "0"),)),
            "Makefile": frozenset((("100644", "0"),)),
        }
        self.assertEqual("makefile", scan._active_makefile(entries, notes))
        self.assertEqual([repr("Makefile")], [note.where for note in notes])
        self.assertIn(scan.SHADOWED_MAKEFILE, [note.id for note in notes])

    def test_the_gnumakefile_pair_is_the_end_to_end_coverage_of_the_order(self):
        """The counter-weight to the bound above: the *first* of the three
        differs from the third by more than case, so that pair is a real
        repository and is asserted end to end — twice over, by
        `test_a_target_only_the_shadowed_file_declares_is_never_proposed` and
        by real `make` below."""
        self.shadowed_repository()
        listed = S.git_read(self.root, "ls-files", "-z").decode("utf-8")
        self.assertIn("GNUmakefile", listed.split("\0"))
        self.assertIn("Makefile", listed.split("\0"))

    def test_the_only_tracked_makefile_is_read_whatever_it_is_called(self):
        """The counter-weight: preferring one name must not stop the scanner
        reading a repository that tracks only a lower-precedence name."""
        for name in scan.MAKEFILE_PRECEDENCE:
            with self.other_repo():
                self.write(name, "solo:\n\techo\n")
                self.commit()
                self.assertEqual(
                    ["make solo"], self.values(self.survey().commands), name
                )

    def test_a_nested_makefile_is_no_ones_shadow(self):
        """Precedence is resolved per directory by `make`, and only the root
        is proposed from — so a nested `Makefile` is diagnosed as nested, not
        as shadowed by a root `GNUmakefile` it has nothing to do with."""
        self.write("GNUmakefile", "root-target:\n\techo\n")
        self.write("sub/Makefile", "nested:\n\techo\n")
        self.commit()
        survey = self.survey()
        self.assertEqual(["make root-target"], self.values(survey.commands))
        self.assertEqual(
            [repr("sub/Makefile")],
            [n.where for n in survey.notes if n.id == scan.NESTED_DECLARATION],
        )
        self.assertNotIn(scan.SHADOWED_MAKEFILE, self.note_ids(survey))

    def test_a_shadowed_file_is_still_evidence_of_the_make_stack(self):
        """The two concerns stay apart. Which file `make` *reads* decides what
        may be proposed; both files are tracked declarations of a make
        project, and P3.1 reports what the repository contains."""
        self.shadowed_repository()
        self.assertEqual(
            [("", "make", ("GNUmakefile", "Makefile"))],
            list(self.survey().stacks),
        )

    def test_gnu_make_really_ignores_the_shadowed_file(self):
        """**The vendor contract, verified rather than remembered** (ADR-23).

        Both directions, because "make test failed" alone would also be true
        of a repository make could not read at all: the active file's target
        must succeed in the same tree where the shadowed file's target fails.
        `-n` prints the recipe and runs nothing.
        """
        real_make = shutil.which("make")
        if real_make is None:
            self.skipTest("no `make` on PATH to verify the lookup order against")
        self.shadowed_repository()
        active = subprocess.run(
            [real_make, "-n", "only-here"],
            cwd=self.root,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
        )
        self.assertEqual(
            0,
            active.returncode,
            "make could not read the active file at all — the fixture is "
            "inert: %s" % active.stdout.decode("utf-8", "replace"),
        )
        shadowed = subprocess.run(
            [real_make, "-n", "test"],
            cwd=self.root,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
        )
        self.assertNotEqual(
            0,
            shadowed.returncode,
            "`make test` succeeded, so this `make` does read the shadowed "
            "file and the precedence rule this fix is written against is "
            "wrong for it",
        )
        self.assertIn(
            "No rule to make target",
            shadowed.stdout.decode("utf-8", "replace"),
        )


class HostilePathDiagnosticTest(ScanFixture):
    """**B4** — a diagnostic renders its path escaped, in the text and in
    `where`.

    ADR-32's argument is about a value that would "silently become two claims
    in the rendered one-item-per-line sections", and it applies to a
    diagnostic exactly as it does to a record value: `where: weird` /
    `name.md` is two lines of a report, and the second one looks like a
    finding. An **ESC**-bearing path is worse than cosmetic — it injects
    terminal control sequences into the terminal of the human reading the
    report — and a **surrogate-escaped** path (git stores path bytes) cannot
    be written to a UTF-8 stream at all, so a report naming one raises
    `UnicodeEncodeError` on a real stdout.

    `_unrepresentable_note` already escaped its path; the unmerged, nested,
    unparseable and symlink notes did not, and neither did the stack findings
    B1 adds. One function, used everywhere, is the only shape of this fix that
    stays fixed.
    """

    NEWLINE_PROJECT = "weird\ndir"
    ESC_PROJECT = "esc\x1bdir"

    def plant(self, directory):
        self.write(directory + "/package.json", '{"scripts": {"a": "x"}}\n')
        self.commit()

    def notes_for(self, note_id):
        return [n for n in self.survey().notes if n.id == note_id]

    def test_the_fixture_really_tracks_the_hostile_directories(self):
        """Non-vacuity: on a filesystem that refused either name, every
        assertion below would pass over a repository that never held one."""
        for directory in (self.NEWLINE_PROJECT, self.ESC_PROJECT):
            with self.other_repo():
                self.plant(directory)
                tracked = (
                    S.git_read(self.root, "ls-files", "-z")
                    .decode("utf-8")
                    .split("\0")
                )
                self.assertIn(directory + "/package.json", tracked)

    def test_a_newline_path_is_escaped_in_the_nested_declaration_note(self):
        self.plant(self.NEWLINE_PROJECT)
        notes = self.notes_for(scan.NESTED_DECLARATION)
        self.assertEqual(
            [repr(self.NEWLINE_PROJECT + "/package.json")],
            [n.where for n in notes],
        )
        self.assertNotIn("\n", notes[0].where)

    def test_a_newline_path_never_reaches_the_report_raw(self):
        self.plant(self.NEWLINE_PROJECT)
        code, out, err = self.run_scan()
        self.assertEqual(0, code, err)
        self.assertNotIn("Traceback", err, "a predicted case printed a crash")
        self.assertNotIn(
            self.NEWLINE_PROJECT,
            out,
            "the raw newline reached the report and split one item over two "
            "lines",
        )
        self.assertIn(repr(self.NEWLINE_PROJECT + "/package.json"), out)

    def test_an_escape_bearing_path_never_reaches_the_report_raw(self):
        self.plant(self.ESC_PROJECT)
        code, out, err = self.run_scan()
        self.assertEqual(0, code, err)
        self.assertNotIn(
            "\x1b",
            out,
            "an ESC from a repository path reached a human's terminal, where "
            "it is a control sequence and not text",
        )
        self.assertIn(repr(self.ESC_PROJECT + "/package.json"), out)

    def test_the_stack_finding_for_such_a_project_is_escaped_too(self):
        """B1 makes a nested project's directory reachable in a finding for
        the first time, so it is the newest place this defect could live."""
        self.plant(self.NEWLINE_PROJECT)
        found, _cardinalities = scan.survey_findings(self.survey())
        items = [item for item in found if item["id"] == scan.STACK_FINDING]
        self.assertEqual(1, len(items))
        for field in ("claim", "observed", "where"):
            self.assertNotIn("\n", items[0][field], field)
        self.assertIn(repr(self.NEWLINE_PROJECT), items[0]["claim"])

    def test_an_ordinary_path_is_still_readable_in_a_diagnostic(self):
        """The counter-weight: escaping must leave the path findable. A human
        who cannot recognise `packages/web/package.json` in the note cannot
        act on it, and quoting a safe path is the whole price of the rule."""
        self.write("packages/web/package.json", '{"scripts": {"a": "x"}}\n')
        self.commit()
        note = self.notes_for(scan.NESTED_DECLARATION)[0]
        self.assertIn("packages/web/package.json", note.where)

    def test_an_unparseable_declaration_note_is_escaped(self):
        self.write(self.NEWLINE_PROJECT + "/Taskfile.yml", "tasks:\n")
        self.commit()
        notes = self.notes_for(scan.UNPARSEABLE_DECLARATION)
        self.assertEqual(
            [repr(self.NEWLINE_PROJECT + "/Taskfile.yml")],
            [n.where for n in notes],
        )


class HostileIndexPathDiagnosticTest(IndexFixture):
    """**B4** over the two paths only git's index can hold.

    An unmerged entry and a path whose bytes are not valid UTF-8 both arrive
    from `git ls-files --stage`, which is untrusted input by definition — and
    APFS refuses the second name outright (`EILSEQ`), so the index is the only
    door to it. A report naming one raises `UnicodeEncodeError` when written
    to a real stdout, which is a crash in place of a finding.
    """

    UNMERGED_NEWLINE = b"con\nflict.sh"
    SURROGATE_NESTED = b"su\xffb/package.json"

    def plant_unmerged(self, path):
        sha = self.blob(b"#!/bin/sh\nexit 0\n")
        self.plant(
            (
                ("100644", sha, 1, path),
                ("100644", sha, 2, path),
                ("100755", sha, 3, path),
            )
        )

    def test_the_fixture_really_plants_both_hostile_index_paths(self):
        self.plant_unmerged(self.UNMERGED_NEWLINE)
        self.plant((("100644", self.blob(b"{}\n"), 0, self.SURROGATE_NESTED),))
        listed = S.git_read(self.root, "ls-files", "-z").split(b"\0")
        self.assertIn(self.UNMERGED_NEWLINE, listed)
        self.assertIn(self.SURROGATE_NESTED, listed)

    def test_an_unmerged_newline_path_is_escaped_in_its_note(self):
        self.plant_unmerged(self.UNMERGED_NEWLINE)
        notes = [n for n in self.survey().notes if n.id == scan.UNMERGED_ENTRY]
        self.assertEqual(
            [repr(self.UNMERGED_NEWLINE.decode("utf-8"))],
            [n.where for n in notes],
        )

    def test_a_surrogate_bearing_nested_declaration_is_escaped(self):
        """The tell is not cosmetic: `out.encode("utf-8")` is what writing to
        a real stdout does, and a lone surrogate makes it raise — so an
        unescaped one turns a finding into a crash."""
        self.plant((("100644", self.blob(b"{}\n"), 0, self.SURROGATE_NESTED),))
        decoded = self.SURROGATE_NESTED.decode("utf-8", "surrogateescape")
        notes = [
            n for n in self.survey().notes if n.id == scan.NESTED_DECLARATION
        ]
        self.assertEqual([repr(decoded)], [n.where for n in notes])
        code, out, err = self.run_scan()
        self.assertEqual(0, code, err)
        self.assertNotIn("Traceback", err, "a predicted case printed a crash")
        out.encode("utf-8")
        self.assertIn(repr(decoded), out)

    def test_the_report_over_every_hostile_index_path_is_writable(self):
        """Both planted at once, which is the state a conflicted tree holding
        one odd filename is actually in."""
        self.plant_unmerged(self.UNMERGED_NEWLINE)
        self.plant((("100644", self.blob(b"{}\n"), 0, self.SURROGATE_NESTED),))
        code, out, err = self.run_scan()
        self.assertEqual(0, code, err)
        out.encode("utf-8")
        self.assertNotIn(self.UNMERGED_NEWLINE.decode("utf-8"), out)


if __name__ == "__main__":
    unittest.main()
