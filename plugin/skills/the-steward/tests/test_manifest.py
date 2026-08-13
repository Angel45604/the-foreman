"""P1.5 — `.steward.json`, its schema and its dependency-free validator.

ADR-2  : tracked, at the repository root, canonical JSON, never digested,
         never listed among its own recorded paths. A manifest that fails
         validation is **exit 2** with expected-vs-observed detail — never a
         pass over a manifest we could not read.
ADR-11 : two stored states, `proposed | confirmed`, and nothing else.
ADR-18 : a command record carries a closed `resolution` kind, and `external`
         is valid only on a `confirmed` record.
ADR-30 : `intentionallyEmpty` records are keyed per scope, three keys.
ADR-31 : the frontmatter schema is a required-key list plus one boolean.
ADR-32 : record values must be renderable — one item per line, no control
         characters, already stripped.

**Trackedness is implemented and fixtured here** (`TrackednessTest`), through
`doctor`, for all four states the plan names. It needed no Phase-2 substrate:
`paths.git_output` already exists, and `git ls-files` answers the whole
predicate in one call.

**Escalated, NOT self-deferred** — the write-dependent halves of three
lifecycle rows. The plan's own text points two of them forward: *foreign
grants nothing* is annotated `(P6.4(d))` and *deleted after `generate`* is
P6.4(g) verbatim. The halves Phase 1 can hold are asserted below against real
production code, and each test says which half it is:
- *foreign grants nothing* → the record-is-not-a-grant limb Phase 1 owns is
  asserted (a validating foreign record over an in-tree symlink grants no
  write). The **digest-comparison** limb — a stale recorded digest making a
  file *not ours* — needs the ownership comparison P6.4 builds;
- *modified* → asserted end to end, and disclosed: `generate` is still a stub,
  so "does not revert" currently holds for a weaker reason than it will;
- *deleted after `generate`* → the *unmanaged* half is asserted; the *not
  managed* **report row** needs the target list and severities of P6.4/P7.
"""

import hashlib
import os
import shutil
import unittest

import _support as S

S.import_core()

import atomic  # noqa: E402
import cli  # noqa: E402
import inventory  # noqa: E402
import jsonio  # noqa: E402
import manifest  # noqa: E402


def a_manifest(**overrides):
    document = {
        "$schema": "tools/steward/manifest.v1.json",
        "commands": [
            {
                "value": "npm test",
                "state": "proposed",
                "resolution": "repo-declared",
                "confidence": "high",
            }
        ],
        "paths": [{"value": "docs/architecture.md", "state": "confirmed"}],
        "docsScope": {"state": "proposed", "confidence": "low", "include": ["docs"]},
        "frontmatterSchema": {"requiredKeys": ["title", "status"]},
        "intentionallyEmpty": [],
        "recorded": [
            {
                "path": "AGENTS.md",
                "kind": "rendered",
                "sha256": "0" * 64,
            }
        ],
        "scan": {"pending": []},
    }
    document.update(overrides)
    return document


class ValidDocumentTest(unittest.TestCase):
    def test_the_reference_document_validates(self):
        manifest.validate(a_manifest())

    def test_an_empty_object_validates(self):
        """A manifest declaring nothing is structurally valid; whether an empty
        *scope* is a finding is ADR-30's question, checked in Phase 4."""
        manifest.validate({})

    def test_it_round_trips_canonically(self):
        text = jsonio.dumps(a_manifest())
        self.assertEqual(text, jsonio.dumps(jsonio.loads(text)))
        manifest.validate(jsonio.loads(text))

    def test_the_manifest_never_records_itself(self):
        document = a_manifest(
            recorded=[
                {"path": ".steward.json", "kind": "rendered", "sha256": "0" * 64}
            ]
        )
        with self.assertRaises(manifest.ManifestError) as caught:
            manifest.validate(document)
        self.assertIn(".steward.json", str(caught.exception))


class UnknownKeyTest(unittest.TestCase):
    def test_an_unknown_top_level_key_is_rejected(self):
        with self.assertRaises(manifest.ManifestError) as caught:
            manifest.validate(a_manifest(hooks={"preCommit": True}))
        self.assertIn("hooks", str(caught.exception))

    def test_an_unknown_record_key_is_rejected(self):
        document = a_manifest()
        document["paths"][0]["severity"] = "error"
        with self.assertRaises(manifest.ManifestError) as caught:
            manifest.validate(document)
        self.assertIn("severity", str(caught.exception))


class RecordStateTest(unittest.TestCase):
    def test_both_stored_states_are_accepted(self):
        for state in ("proposed", "confirmed"):
            document = a_manifest()
            document["paths"][0]["state"] = state
            manifest.validate(document)

    def test_drifted_is_not_a_stored_state(self):
        """ADR-11: `drifted` is derived at read time; nothing could write it."""
        document = a_manifest()
        document["paths"][0]["state"] = "drifted"
        with self.assertRaises(manifest.ManifestError) as caught:
            manifest.validate(document)
        self.assertIn("drifted", str(caught.exception))

    def test_a_missing_state_is_rejected(self):
        document = a_manifest()
        del document["paths"][0]["state"]
        with self.assertRaises(manifest.ManifestError):
            manifest.validate(document)

    def test_a_waiver_requires_a_reason(self):
        document = a_manifest()
        document["paths"][0]["waived"] = {}
        with self.assertRaises(manifest.ManifestError) as caught:
            manifest.validate(document)
        self.assertIn("reason", str(caught.exception))

    def test_a_waiver_with_a_reason_is_accepted(self):
        document = a_manifest()
        document["paths"][0]["waived"] = {"reason": "moved to the wiki, tracked in #12"}
        manifest.validate(document)


class ConfidenceIsOptionalOnRecordsTest(unittest.TestCase):
    """DEBT ITEM 10 — the spec contradicts itself, and this is the side taken.

    P1.5 says each record carries `state` **and `confidence`**. ADR-28 (and
    ADR-2's "scan confidence per inference") define confidence as belonging to
    inferences: required exactly when a *finding*'s tier is `inferred`. The ADR
    wins per the standing instruction, so on a *record* confidence is optional
    — present when a scan inference produced the record, absent when a human
    wrote it by hand. A human editing `.steward.json` should not have to invent
    a confidence for a claim they are certain of.
    """

    def test_a_record_without_confidence_validates(self):
        document = a_manifest()
        del document["commands"][0]["confidence"]
        manifest.validate(document)
        self.assertNotIn("confidence", document["paths"][0])
        manifest.validate(document)

    def test_a_record_with_a_confidence_validates(self):
        for level in ("high", "low"):
            document = a_manifest()
            document["paths"][0]["confidence"] = level
            manifest.validate(document)

    def test_an_unknown_confidence_level_is_rejected(self):
        for bad in ("medium", "0.9", "", None):
            document = a_manifest()
            document["paths"][0]["confidence"] = bad
            with self.assertRaises(manifest.ManifestError, msg=repr(bad)):
                manifest.validate(document)


class CommandResolutionTest(unittest.TestCase):
    """ADR-18: a closed set of two, and `external` is a human's declaration."""

    def test_repo_declared_is_valid_in_both_states(self):
        for state in ("proposed", "confirmed"):
            document = a_manifest()
            document["commands"][0]["state"] = state
            document["commands"][0]["resolution"] = "repo-declared"
            manifest.validate(document)

    def test_external_is_valid_only_on_a_confirmed_record(self):
        document = a_manifest()
        document["commands"][0]["state"] = "confirmed"
        document["commands"][0]["resolution"] = "external"
        manifest.validate(document)

    def test_external_on_a_proposed_record_fails_validation(self):
        document = a_manifest()
        document["commands"][0]["state"] = "proposed"
        document["commands"][0]["resolution"] = "external"
        with self.assertRaises(manifest.ManifestError) as caught:
            manifest.validate(document)
        message = str(caught.exception)
        self.assertIn("external", message)
        self.assertIn("confirmed", message)

    def test_a_third_resolution_kind_is_rejected(self):
        for bad in ("path", "shell", "auto", ""):
            document = a_manifest()
            document["commands"][0]["resolution"] = bad
            with self.assertRaises(manifest.ManifestError, msg=bad):
                manifest.validate(document)

    def test_a_command_record_without_a_resolution_is_rejected(self):
        document = a_manifest()
        del document["commands"][0]["resolution"]
        with self.assertRaises(manifest.ManifestError):
            manifest.validate(document)

    def test_a_path_record_may_not_carry_a_resolution(self):
        document = a_manifest()
        document["paths"][0]["resolution"] = "repo-declared"
        with self.assertRaises(manifest.ManifestError):
            manifest.validate(document)


class RecordValueRepresentabilityTest(unittest.TestCase):
    """ADR-32: the two sections render one item per line, so a value carrying a
    line break would silently become two claims."""

    def bad_value(self, kind, value):
        document = a_manifest()
        document[kind][0]["value"] = value
        with self.assertRaises(manifest.ManifestError, msg=repr(value)) as caught:
            manifest.validate(document)
        return str(caught.exception)

    def test_an_empty_value_is_rejected(self):
        for kind in ("commands", "paths"):
            self.bad_value(kind, "")

    def test_a_value_differing_from_its_stripped_form_is_rejected(self):
        for value in (" npm test", "npm test ", "\tnpm test", "npm test\n"):
            self.bad_value("commands", value)

    def test_cr_lf_and_tab_are_each_rejected_by_name(self):
        for value, point in (
            ("a\rb", 13),
            ("a\nb", 10),
            ("a\tb", 9),
        ):
            message = self.bad_value("commands", value)
            self.assertIn("U+%04X" % point, message)
            self.assertIn("index 1", message)

    def test_nul_and_the_rest_of_the_control_range_are_rejected(self):
        for value, point in (("\x00ab", 0), ("a\x1fb", 31), ("ab\x7f", 127)):
            message = self.bad_value("paths", value)
            self.assertIn("U+%04X" % point, message)

    def test_the_offending_record_is_named(self):
        message = self.bad_value("commands", "a\nb")
        self.assertIn("commands[0]", message)

    def test_markdown_significant_values_validate(self):
        """Nothing parses the rendered section back, so there is nothing to
        escape for; P6.1 asserts they render verbatim inside a fence."""
        for value in ("# not-a-heading.md", "---", "a | b", "* x", "> y", "`z`"):
            document = a_manifest()
            document["paths"][0]["value"] = value
            manifest.validate(document)

    def test_a_value_padded_with_unicode_whitespace_validates(self):
        """DEBT ITEM 9 reaching the manifest: NO-BREAK SPACE is not ASCII
        whitespace, so the value does not differ from its stripped form."""
        document = a_manifest()
        document["paths"][0]["value"] = " docs/x.md "
        manifest.validate(document)

    def test_a_non_string_value_is_rejected(self):
        for bad in (None, 3, ["a"], {"v": "a"}):
            document = a_manifest()
            document["paths"][0]["value"] = bad
            with self.assertRaises(manifest.ManifestError, msg=repr(bad)):
                manifest.validate(document)


class IntentionallyEmptyTest(unittest.TestCase):
    """ADR-30: keyed per scope, three keys, and one never satisfies another."""

    def test_the_three_scope_keys_round_trip(self):
        # The literal `assertEqual(("commands", "docsScope", "paths"), SCOPE_KEYS)`
        # that used to open this test is deleted: D8. It compared a literal to
        # a literal, and `test_every_closed_vocabulary_matches_the_validator_exactly`
        # now pins the same tuple against the shipped contract, which is
        # strictly stronger.
        for scope in manifest.SCOPE_KEYS:
            document = a_manifest(
                intentionallyEmpty=[{"scope": scope, "state": "proposed"}]
            )
            manifest.validate(document)
            self.assertEqual(
                jsonio.dumps(document), jsonio.dumps(jsonio.loads(jsonio.dumps(document)))
            )

    def test_an_unknown_scope_key_is_rejected(self):
        for bad in ("docs", "everything", "", "Paths"):
            document = a_manifest(
                intentionallyEmpty=[{"scope": bad, "state": "proposed"}]
            )
            with self.assertRaises(manifest.ManifestError, msg=bad):
                manifest.validate(document)

    def test_a_record_for_one_key_does_not_satisfy_another(self):
        document = a_manifest(
            intentionallyEmpty=[{"scope": "docsScope", "state": "confirmed"}]
        )
        self.assertIsNotNone(manifest.intentionally_empty_for(document, "docsScope"))
        self.assertIsNone(manifest.intentionally_empty_for(document, "commands"))
        self.assertIsNone(manifest.intentionally_empty_for(document, "paths"))

    def test_two_records_for_the_same_key_are_rejected(self):
        document = a_manifest(
            intentionallyEmpty=[
                {"scope": "commands", "state": "proposed"},
                {"scope": "commands", "state": "confirmed"},
            ]
        )
        with self.assertRaises(manifest.ManifestError):
            manifest.validate(document)


class FrontmatterSchemaTest(unittest.TestCase):
    """ADR-31: a list of required key names plus one optional boolean. There is
    no validation vocabulary to admit."""

    def test_a_key_list_validates(self):
        manifest.validate(a_manifest(frontmatterSchema={"requiredKeys": []}))
        manifest.validate(
            a_manifest(frontmatterSchema={"requiredKeys": ["title"], "requireNonEmpty": True})
        )

    def test_a_non_string_key_name_is_rejected(self):
        with self.assertRaises(manifest.ManifestError):
            manifest.validate(a_manifest(frontmatterSchema={"requiredKeys": [3]}))

    def test_a_validation_vocabulary_is_rejected(self):
        for shape in (
            {"requiredKeys": ["title"], "type": "object"},
            {"requiredKeys": ["title"], "properties": {"title": {"type": "string"}}},
            {"requiredKeys": {"title": True}},
            {"required": ["title"]},
        ):
            with self.assertRaises(manifest.ManifestError, msg=repr(shape)):
                manifest.validate(a_manifest(frontmatterSchema=shape))

    def test_require_non_empty_must_be_a_boolean(self):
        with self.assertRaises(manifest.ManifestError):
            manifest.validate(
                a_manifest(frontmatterSchema={"requiredKeys": [], "requireNonEmpty": "yes"})
            )


class RecordedPathTest(unittest.TestCase):
    def test_both_kinds_validate(self):
        for kind in ("rendered", "copied"):
            document = a_manifest()
            document["recorded"][0]["kind"] = kind
            manifest.validate(document)

    def test_a_third_kind_is_rejected(self):
        document = a_manifest()
        document["recorded"][0]["kind"] = "adopted"
        with self.assertRaises(manifest.ManifestError):
            manifest.validate(document)

    def test_the_digest_must_be_64_lowercase_hex(self):
        for bad in ("", "abc", "0" * 63, "0" * 65, "G" * 64, "A" * 64):
            document = a_manifest()
            document["recorded"][0]["sha256"] = bad
            with self.assertRaises(manifest.ManifestError, msg=bad):
                manifest.validate(document)

    def test_a_traversing_or_absolute_recorded_path_is_rejected(self):
        for bad in ("../AGENTS.md", "/etc/hosts", "docs/../../x.md"):
            document = a_manifest()
            document["recorded"][0]["path"] = bad
            with self.assertRaises(manifest.ManifestError, msg=bad):
                manifest.validate(document)

    def test_two_records_for_the_same_path_are_rejected(self):
        document = a_manifest()
        document["recorded"].append(
            {"path": "AGENTS.md", "kind": "copied", "sha256": "1" * 64}
        )
        with self.assertRaises(manifest.ManifestError):
            manifest.validate(document)


class TemporalRuleTest(unittest.TestCase):
    """ADR-2: observation timestamps are banned everywhere."""

    def test_a_top_level_observation_timestamp_is_rejected(self):
        with self.assertRaises(manifest.ManifestError) as caught:
            manifest.validate(a_manifest(generatedAt="2026-08-13T00:00:00Z"))
        self.assertIn("generatedAt", str(caught.exception))

    def test_a_nested_observation_timestamp_is_rejected(self):
        document = a_manifest()
        document["recorded"][0]["scannedAt"] = "2026-08-13"
        with self.assertRaises(manifest.ManifestError) as caught:
            manifest.validate(document)
        self.assertIn("scannedAt", str(caught.exception))


class LifecycleTest(unittest.TestCase):
    def setUp(self):
        self.root = S.make_git_repo()
        self.addCleanup(shutil.rmtree, self.root, True)

    def write_manifest(self, text):
        with open(os.path.join(self.root, ".steward.json"), "w", encoding="utf-8") as h:
            h.write(text)

    def test_missing_manifest_loads_as_none(self):
        self.assertIsNone(manifest.load(self.root))

    def test_missing_manifest_lets_every_verb_run(self):
        for verb in ("scan", "generate", "check", "doctor"):
            result = S.run_core(S.MODERN_PYTHON, [verb], cwd=self.root)
            self.assertEqual(
                0, result.returncode, result.stderr.decode("utf-8", "replace")
            )

    def test_a_valid_foreign_manifest_is_accepted_as_the_contract(self):
        """There is no ownership proof to consult, so whatever validates *is*
        the contract for its records. It grants nothing — P6.4(d)."""
        self.write_manifest(jsonio.dumps(a_manifest()))
        loaded = manifest.load(self.root)
        self.assertEqual("npm test", loaded["commands"][0]["value"])

    def test_a_malformed_manifest_raises_with_expected_vs_observed(self):
        self.write_manifest('{"commands": [{"value": "npm test", "resolution": "repo-declared", "state": "drifted"}]}\n')
        with self.assertRaises(manifest.ManifestError) as caught:
            manifest.load(self.root)
        message = str(caught.exception)
        self.assertIn("drifted", message)
        self.assertIn("proposed", message)

    def test_unparseable_json_raises_rather_than_resetting(self):
        self.write_manifest("{not json\n")
        with self.assertRaises(manifest.ManifestError):
            manifest.load(self.root)

    def test_a_malformed_manifest_exits_two_through_the_cli(self):
        self.write_manifest('{"commands": [{"value": "npm test", "resolution": "repo-declared", "state": "drifted"}]}\n')
        for verb in ("scan", "check", "doctor", "generate"):
            result = S.run_core(S.MODERN_PYTHON, [verb], cwd=self.root)
            self.assertEqual(
                2, result.returncode, "%s exited %s" % (verb, result.returncode)
            )
            self.assertIn(b"drifted", result.stderr)

    def test_a_malformed_manifest_is_never_rewritten(self):
        raw = '{"commands": [{"value": "npm test", "resolution": "repo-declared", "state": "drifted"}]}\n'
        self.write_manifest(raw)
        S.run_core(S.MODERN_PYTHON, ["generate"], cwd=self.root)
        self.assertEqual(raw, S.read_text(os.path.join(self.root, ".steward.json")))

    def test_a_human_edit_to_a_confirmed_record_survives_a_load(self):
        document = a_manifest()
        document["commands"][0]["state"] = "confirmed"
        self.write_manifest(jsonio.dumps(document))
        self.assertEqual("confirmed", manifest.load(self.root)["commands"][0]["state"])

    def test_a_foreign_record_grants_no_write_over_an_in_tree_symlink(self):
        """Lifecycle row *foreign*, the limb Phase 1 owns (FROZEN-DEBT #7).

        The manifest is foreign, schema-valid, and records `AGENTS.md` with the
        digest of the bytes readable there — so it is **accepted as the
        contract** and the digest check it invites would pass. It still grants
        nothing: the path crosses a symlink, so the production writer refuses.
        The digest-comparison half of P6.4(d) is escalated, not asserted here.
        """
        secret = os.path.join(self.root, "secrets.txt")
        with open(secret, "w", encoding="utf-8") as handle:
            handle.write("do not clobber me\n")
        os.symlink("secrets.txt", os.path.join(self.root, "AGENTS.md"))
        with open(os.path.join(self.root, "AGENTS.md"), "rb") as handle:
            readable_digest = hashlib.sha256(handle.read()).hexdigest()

        document = a_manifest()
        document["recorded"] = [
            {"path": "AGENTS.md", "kind": "rendered", "sha256": readable_digest}
        ]
        self.write_manifest(jsonio.dumps(document))

        loaded = manifest.load(self.root)
        self.assertEqual(readable_digest, loaded["recorded"][0]["sha256"])

        with self.assertRaises(atomic.AtomicWriteError):
            atomic.write(self.root, "AGENTS.md", b"ROUTING FROM STEWARD\n")
        self.assertEqual("do not clobber me\n", S.read_text(secret))

    def test_a_hand_edited_confirmed_record_survives_a_whole_generate_run(self):
        """Lifecycle row *modified*, end to end.

        **Disclosed:** `generate` is a Phase-1 stub that writes nothing, so
        "does not revert a matching `confirmed` record" holds today for a
        weaker reason than it will once P6.4 writes the manifest. The
        assertion is on the bytes, so it keeps its meaning either way.
        """
        document = a_manifest()
        document["commands"][0]["state"] = "confirmed"
        document["paths"][0]["state"] = "confirmed"
        raw = jsonio.dumps(document)
        self.write_manifest(raw)

        result = S.run_core(S.MODERN_PYTHON, ["generate"], cwd=self.root)
        self.assertEqual(0, result.returncode, result.stderr.decode("utf-8", "replace"))
        self.assertEqual(raw, S.read_text(os.path.join(self.root, ".steward.json")))
        self.assertEqual("confirmed", manifest.load(self.root)["commands"][0]["state"])

    def test_deleting_the_manifest_leaves_the_artifacts_unmanaged_and_untouched(self):
        """Lifecycle row *deleted after `generate`*, the half Phase 1 owns.

        Artifacts exist and nothing records them any more. The *unmanaged*
        reading and the never-overwritten bytes are asserted here; the *not
        managed* report row — a severity against a Phase-6 target list — is
        escalated to P6.4(g)/P7, not silently dropped.
        """
        artifact = os.path.join(self.root, "AGENTS.md")
        with open(artifact, "w", encoding="utf-8") as handle:
            handle.write("routing we created\n")
        with open(artifact, "rb") as handle:
            digest = hashlib.sha256(handle.read()).hexdigest()
        self.write_manifest(
            jsonio.dumps(
                a_manifest(
                    recorded=[
                        {"path": "AGENTS.md", "kind": "rendered", "sha256": digest}
                    ]
                )
            )
        )
        self.assertIsNotNone(manifest.load(self.root))

        os.unlink(os.path.join(self.root, ".steward.json"))
        self.assertIsNone(manifest.load(self.root), "still reads as managed")

        for verb in ("scan", "generate", "check", "doctor"):
            result = S.run_core(S.MODERN_PYTHON, [verb], cwd=self.root)
            self.assertEqual(
                0, result.returncode, result.stderr.decode("utf-8", "replace")
            )
        self.assertEqual("routing we created\n", S.read_text(artifact))


class TrackednessTest(unittest.TestCase):
    """P1.5 trackedness (ADR-2, ADR-13) — predicate *is it in the index*.

    `generate` cannot stage its own output, so a fresh manifest is untracked;
    without a finding the repository stays green forever on a control plane
    that one `git clean -xdf` deletes. Four states, asserted through the real
    `doctor` verb in a subprocess: **untracked** → `warn`, tier *inspected*,
    **exit 0**; **staged** and **committed** → no finding; **`git rm
    --cached`** → `warn` again. The staged and committed rows are what make
    the other two non-vacuous — the same fixture, the same verb, and the
    warning count flips.
    """

    def setUp(self):
        self.root = S.make_git_repo()
        self.addCleanup(shutil.rmtree, self.root, True)
        with open(
            os.path.join(self.root, ".steward.json"), "w", encoding="utf-8"
        ) as handle:
            handle.write(jsonio.dumps(a_manifest()))

    def doctor(self):
        result = S.run_core(S.MODERN_PYTHON, ["doctor"], cwd=self.root)
        return (
            result.returncode,
            result.stdout.decode("utf-8", "replace"),
            result.stderr.decode("utf-8", "replace"),
        )

    def test_untracked_is_a_warn_at_tier_inspected_and_still_exits_zero(self):
        code, out, err = self.doctor()
        self.assertEqual(0, code, err)
        self.assertIn("0 error, 1 warn, 0 info", out)
        self.assertIn("[inspected]", out)
        self.assertIn(".steward.json", out)
        self.assertIn("git clean", out)

    def test_staged_reports_no_finding(self):
        S.git(self.root, "add", ".steward.json")
        code, out, err = self.doctor()
        self.assertEqual(0, code, err)
        self.assertIn("0 error, 0 warn, 0 info", out)

    def test_committed_reports_no_finding(self):
        S.git(self.root, "add", ".steward.json")
        S.git(self.root, "commit", "-q", "-m", "track the manifest")
        code, out, err = self.doctor()
        self.assertEqual(0, code, err)
        self.assertIn("0 error, 0 warn, 0 info", out)

    def test_git_rm_cached_warns_again(self):
        S.git(self.root, "add", ".steward.json")
        S.git(self.root, "commit", "-q", "-m", "track the manifest")
        S.git(self.root, "rm", "-q", "--cached", ".steward.json")
        code, out, err = self.doctor()
        self.assertEqual(0, code, err)
        self.assertIn("0 error, 1 warn, 0 info", out)

    def test_the_check_states_its_cardinality(self):
        """ADR-30: what a check examined is printed, always."""
        _code, out, _err = self.doctor()
        self.assertIn("manifest-trackedness: 1 items examined", out)

    def test_a_repo_with_no_manifest_examines_zero_and_says_why(self):
        os.unlink(os.path.join(self.root, ".steward.json"))
        code, out, err = self.doctor()
        self.assertEqual(0, code, err)
        self.assertIn("manifest-trackedness: 0 items examined", out)
        self.assertIn(".steward.json", out)
        self.assertIn("0 error, 0 warn, 0 info", out)

    def test_the_other_three_verbs_do_not_run_the_check(self):
        """`doctor` inspects trackedness (ADR-2); `check` is C1-C5 and does
        not, so an untracked manifest must not make `check` warn."""
        for verb in ("scan", "generate", "check"):
            result = S.run_core(S.MODERN_PYTHON, [verb], cwd=self.root)
            self.assertEqual(0, result.returncode)
            self.assertNotIn(
                "manifest-trackedness",
                result.stdout.decode("utf-8", "replace"),
                verb,
            )


class SchemaFileTest(unittest.TestCase):
    """The schema document ships with the core and is pointed at by `$schema`.
    A drift guard keeps it honest: the validator is the enforcement, and the
    file is what a human or an editor reads."""

    def setUp(self):
        self.schema = jsonio.loads(
            S.read_text(os.path.join(S.CORE_DIR, "manifest.v1.json"))
        )

    def test_the_schema_file_is_canonical_json(self):
        text = S.read_text(os.path.join(S.CORE_DIR, "manifest.v1.json"))
        self.assertEqual(text, jsonio.dumps(jsonio.loads(text)))

    def test_the_default_schema_reference_resolves_to_the_shipped_file(self):
        """The reference is a path *inside a target repo*, so it must name the
        installed core directory and a file the core actually ships."""
        directory, _sep, filename = manifest.SCHEMA_REFERENCE.rpartition("/")
        self.assertTrue(os.path.isfile(os.path.join(S.CORE_DIR, filename)))
        self.assertIn(filename, inventory.FILES)
        self.assertEqual(cli.INSTALLED_CORE_DIRECTORY, directory)

    def test_the_schema_properties_match_the_validator_exactly(self):
        self.assertEqual(
            sorted(manifest.TOP_LEVEL_KEYS), sorted(self.schema["properties"])
        )

    def test_every_record_key_set_matches_the_validator_exactly(self):
        """D7: the top level was guarded and the records were not — which is
        where drift is likeliest, since a new record key is added in the
        validator and forgotten in the readable contract."""
        definitions = self.schema["definitions"]
        properties = self.schema["properties"]
        command_extra = definitions["commandRecord"]["allOf"][1]["properties"]
        for label, expected, observed in (
            ("claimRecord", manifest._CLAIM_RECORD_KEYS,
             definitions["claimRecord"]["properties"]),
            ("commandRecord", manifest._COMMAND_RECORD_KEYS,
             dict(definitions["claimRecord"]["properties"], **command_extra)),
            ("waived", manifest._WAIVED_KEYS, definitions["waived"]["properties"]),
            ("docsScope", manifest._DOCS_SCOPE_KEYS, properties["docsScope"]["properties"]),
            ("frontmatterSchema", manifest._FRONTMATTER_KEYS,
             properties["frontmatterSchema"]["properties"]),
            ("intentionallyEmpty", manifest._INTENTIONALLY_EMPTY_KEYS,
             properties["intentionallyEmpty"]["items"]["properties"]),
            ("recorded", manifest._RECORDED_KEYS,
             properties["recorded"]["items"]["properties"]),
        ):
            self.assertEqual(sorted(expected), sorted(observed), label)

    def test_every_closed_vocabulary_matches_the_validator_exactly(self):
        """The enums are the other half of the same drift: a value the
        validator accepts and the contract does not (or the reverse)."""
        definitions = self.schema["definitions"]
        properties = self.schema["properties"]
        for label, expected, observed in (
            ("state", manifest.STATES, definitions["state"]["enum"]),
            ("confidence", manifest.CONFIDENCES, definitions["confidence"]["enum"]),
            ("resolution", manifest.RESOLUTIONS,
             definitions["commandRecord"]["allOf"][1]["properties"]["resolution"]["enum"]),
            ("recorded.kind", manifest.RECORDED_KINDS,
             properties["recorded"]["items"]["properties"]["kind"]["enum"]),
            ("intentionallyEmpty.scope", manifest.SCOPE_KEYS,
             properties["intentionallyEmpty"]["items"]["properties"]["scope"]["enum"]),
        ):
            self.assertEqual(sorted(expected), sorted(observed), label)


if __name__ == "__main__":
    unittest.main()
