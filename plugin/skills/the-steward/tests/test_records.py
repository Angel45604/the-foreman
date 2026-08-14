"""P3.5 / P3.6 / P3.8 — the ADR-11 record state machine, end to end.

ADR-11 : exactly two stored states, `proposed | confirmed`. *Drifted* — a
         confirmed record whose stored value no longer matches reality — is
         **derived at read time** and never written. A confirmed record is
         never auto-deleted. `waived: {reason}` downgrades that record's
         finding and requires the reason. Nothing promotes an inference.
ADR-13 : a confirmed record's violation is `error` → exit 1; a proposed
         record's is `warn` → exit 0; waived, `external`/*inspected* and
         `scan.pending[]` are `info` → exit 0. Three exit codes, no fourth.
ADR-18 : `external` is a human's declaration — never resolved, counted
         separately in the cardinality line, never as coverage.
ADR-28 : a drift finding is tier *resolved* (we followed the claim to a real
         object and it did or did not exist) and carries **no** confidence,
         which is forbidden on every tier but `inferred`. The *record* may
         still carry a stored confidence; it is a different field on a
         different object, and conflating them is the likeliest way to get
         this phase wrong.
ADR-30 : every check states the cardinality it examined, and a zero states why.

**Eight traps this file is written against.**

**T1 — "byte-identical" has to mean bytes.** A state machine that wrote a
derived reading back into the document it was handed would still compare equal
to a freshly loaded dict if the comparison ran after the mutation. Every
unchanged-record assertion here reads the file's *text* through
`S.read_text`, and the in-memory half compares `jsonio.dumps` of the document
rendered before the machine ran against the text rendered after.

**T2 — `assertRaises` is the most forgiving assertion in this suite.** An
`assertRaises` is satisfied by any instance of the type. Every one here also
pins a distinguishing token of the message, so a different failure with the
same class cannot stand in for the one under test.

**T3 — the resolution answer is the fixture's, deliberately.** C1 and C2 are
Phase 4's, and the command grammar — how a command string maps to one of the
repository's own declarations — is FROZEN-DEBT item 2 and unsettled. What is
under test here is the state machine *over* the answer, never the answer, so
the fixture's declaration source is an obvious fixture file that asserts no
grammar at all, and a declared path resolves in the working tree (ADR-32)
through the production containment door.

**T4 — a refusal branch that nothing makes fire is a comment.** ADR-13: a state
with no row is a bug. The tables are asserted to cover `DERIVED_STATES` in both
directions, an unrecognised state is asserted to *raise* rather than to read as
`proposed`, and — because each of these was neutered to `if False:` while this
file stayed green — `severity_of`'s and `tier_of`'s exhaustiveness guards,
`record_findings`' own `_require_kind`, and all three of `pending_findings`'
type refusals each have a test that watches them fire. A silent default would
downgrade a confirmed record's `error` to a `warn`, which is this project's one
recurring defect wearing the state machine's clothes.

**T5 — "nothing wrote a pending delta" must not pass because a pending delta
is unrepresentable.** The control writes one by hand and proves it validates,
so the absence assertion is about behaviour and not about the schema.

**T6 — a fixture whose two values coincide cannot see the change.**
`test_the_record_set_is_read_and_never_edited` used to pre-set *every* record
to `confirmed`, so a machine that promoted every record wrote the value that
was already there and the byte comparison was satisfied by the mutation it
exists to catch. At least one record is `proposed` now, and a
fixture-liveness assertion says why.

**T7 — the one input that decides severity was the one with no guard.**
`record_findings` asks the repository exactly one question, `value in
resolved`, and on a `str` that question means *substring*: a confirmed record
for `npm run test` against the answer `"npm run test-all"` read *in sync* and
printed `1 item examined` over a check nobody performed. `finding_for` read the
same answer for bare truthiness. Both refusals are asserted here, each with the
control that proves the ordinary shapes still pass.

**T8 — a wording test that compares a constant to itself proves nothing.**
`NO_CLAIM_SOURCE` carries ADR-32's *verbatim* required wording; the claim and
observed strings are the report's only statement of what was checked and what
was seen. All four were gutted in a mutation run and nothing went red, because
the assertions compared each constant against itself. They are pinned as
literal text here, and one is pinned through the rendered report.

**Boundary.** `manifest.validate`'s own state enum is test_manifest.py's
subject (`RecordStateTest`, test_manifest.py:120-133, which pins the literal
`drifted`). What is asserted here is the cross-module invariant, parameterised
by this module's own constant set: *every* reading the state machine derives is
one the validator refuses to store. Likewise P3.4's tree-wide "`scan` writes
nothing" belongs to the scan fixture; what is asserted here is the record-level
half — a re-scan reopens zero confirmed records.
"""

import io
import os
import shutil
import unittest

import _support as S

S.import_core()

import cli  # noqa: E402
import findings  # noqa: E402
import jsonio  # noqa: E402
import manifest  # noqa: E402
import paths  # noqa: E402
import records  # noqa: E402

# The fixture's declaration source. A file nobody could mistake for a real
# package manifest, because reading a real one would assert a command grammar
# this project has not decided (FROZEN-DEBT item 2).
DECLARED = "declared-commands.txt"


def a_path_record(value="docs/architecture.md", state="proposed", **extra):
    record = {"value": value, "state": state}
    record.update(extra)
    return record


def a_command_record(
    value="npm test", state="proposed", resolution="repo-declared", **extra
):
    record = {"value": value, "state": state, "resolution": resolution}
    record.update(extra)
    return record


def a_document(**overrides):
    document = {
        "$schema": manifest.SCHEMA_REFERENCE,
        "commands": [a_command_record()],
        "paths": [a_path_record()],
    }
    document.update(overrides)
    return document


def resolved_values(root, document, kind):
    """What the repository answers about each record's claim — the fixture's.

    A declared path resolves in the **working tree**, not the index (ADR-32),
    and it goes through `paths.contain` because that is the production door
    from a repository-relative string to a filesystem path (ADR-26). A command
    resolves against a line in `declared-commands.txt`: C1's real declaration
    sources are Phase 4's, and the grammar that would map `npm test` onto one
    of them is an open decision, so the fixture asserts none.
    """
    answers = set()
    for record in document.get(kind, []):
        value = record.get("value")
        if kind == "paths":
            if os.path.exists(paths.contain(root, value.replace("/", os.sep))):
                answers.add(value)
        else:
            declared = os.path.join(root, DECLARED)
            if os.path.isfile(declared):
                if value in S.read_text(declared).split("\n"):
                    answers.add(value)
    return answers


def a_record_verb(kind):
    """A verb that reads records off the real manifest and reports them.

    Injected at the `cli.VERBS` seam because Phase 3 owns no verb that reaches
    the state machine: P3.1-P3.4's `scan` is another task's and C1-C5's `check`
    is Phase 4's. Everything below the seam is production code — the real
    argv parser, the real repo-root resolution, the real manifest loader and
    validator, the real state machine, the real report renderer and the real
    exit-code plumbing in `cli.main`.
    """

    def verb(context):
        document = context.manifest or {}
        found, examined = records.record_findings(
            document.get(kind, []),
            kind,
            resolved_values(context.repo_root, document, kind),
            reason=records.NO_CLAIM_SOURCE,
        )
        pending, pending_examined = records.pending_findings(document)
        found = found + pending
        context.stdout.write(
            findings.render_report(
                context.verb, found, [examined, pending_examined]
            )
        )
        return findings.exit_code(found)

    return verb


def an_inference_verb(context):
    """One `inferred` finding, which ADR-13 maps to `info` and ADR-28 forbids
    from ever being an `error` on its own.

    P3.8's mapping omits the inference class entirely; ADR-13:343 does not, and
    the ADR wins. The structural half — `severity="error"` on tier `inferred`
    raises — is test_findings.py's `InferenceIsNeverProofTest`; this is the
    exit-code half.
    """
    found = [
        findings.finding(
            id="inferred-command",
            severity="info",
            tier="inferred",
            claim="`npm test` is this repository's test command",
            observed="a scanner concluded it; nobody has confirmed it",
            where="package.json",
            confidence="low",
        )
    ]
    context.stdout.write(
        findings.render_report(
            context.verb,
            found,
            [findings.cardinality("inference", 1)],
        )
    )
    return findings.exit_code(found)


class RecordFixture(unittest.TestCase):
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

    def write_manifest(self, document):
        raw = jsonio.dumps(document)
        self.write(manifest.MANIFEST_NAME, raw)
        return raw

    def manifest_text(self):
        return S.read_text(os.path.join(self.root, manifest.MANIFEST_NAME))

    def run_injected(self, verb, name="check"):
        """Drive the real `cli.main` with `verb` bound to `name`.

        `try/finally` with a full save-and-restore of the table, which is the
        house form at this seam: `addCleanup` would leave the table mutated for
        the rest of the method.
        """
        original = dict(cli.VERBS)
        out, err = io.StringIO(), io.StringIO()
        try:
            cli.VERBS[name] = verb
            code = cli.main([name], out, err, cwd=self.root)
        finally:
            cli.VERBS.clear()
            cli.VERBS.update(original)
        return code, out.getvalue(), err.getvalue()


# ----------------------------------------------------------------------
# The vocabulary. ADR-11's whole decision is a closed set of two stored states
# with everything else derived, so the first thing worth pinning is that the
# derived set and the stored set cannot overlap — asserted from this module's
# own constants, so a reading added later is covered without editing a test.


class VocabularyTest(unittest.TestCase):
    def test_the_two_stored_states_are_the_manifests_own(self):
        self.assertEqual(
            manifest.STATES,
            (records.PROPOSED, records.CONFIRMED),
            "the state machine and the validator disagree about what is stored",
        )

    def test_no_derived_state_is_a_stored_state(self):
        for state in records.DERIVED_STATES:
            self.assertNotIn(
                state,
                manifest.STATES,
                "%r is derived at read time and must never be storable" % state,
            )

    def test_the_validator_refuses_to_store_any_derived_state(self):
        """The cross-module invariant, not the literal `drifted`.

        test_manifest.py:127 pins the one word the ADR names. This pins the
        whole derived set, so a reading added to `DERIVED_STATES` that the
        schema happens to admit fails here.
        """
        for state in records.DERIVED_STATES:
            document = a_document()
            document["paths"][0]["state"] = state
            with self.assertRaises(manifest.ManifestError, msg=state) as caught:
                manifest.validate(document)
            self.assertIn(state, str(caught.exception), state)

    def test_the_severity_table_covers_every_derived_state(self):
        """ADR-13:359 — a state with no row here is a bug, not a default."""
        self.assertEqual(sorted(records.DERIVED_STATES), sorted(records.SEVERITY))
        self.assertEqual(sorted(records.DERIVED_STATES), sorted(records.TIER))

    def test_the_external_reading_is_the_resolution_kind_itself(self):
        """ADR-18: the reading *is* the human's declaration, so the two names
        must not drift apart."""
        self.assertIn(records.EXTERNAL, manifest.RESOLUTIONS)

    def test_the_claim_kinds_are_the_manifests_two_record_sets(self):
        self.assertEqual(("commands", "paths"), records.CLAIM_KINDS)
        for kind in records.CLAIM_KINDS:
            self.assertIn(kind, manifest.SCOPE_KEYS)


# ----------------------------------------------------------------------
# T4 — the two tables never default. Both `severity_of` and `tier_of` carry a
# docstring citing the ADR that forbids a default; neither guard had anything
# that made it fire, and each was neutered to `if False:` with this file still
# green. A refusal nothing exercises is a comment.


class TheTablesNeverDefaultTest(unittest.TestCase):
    # The two **stored** states are in here on purpose: reading either as a
    # derived one is the same conflation `DERIVED_STATES` exists to prevent, so
    # they must be refused by these tables too.
    UNKNOWN = ("drifted-ish", "approved", "", None, records.PROPOSED, records.CONFIRMED)

    def test_severity_of_refuses_a_state_with_no_row(self):
        for bad in self.UNKNOWN:
            with self.assertRaises(records.RecordError, msg=repr(bad)) as caught:
                records.severity_of(bad)
            self.assertIn("ADR-13", str(caught.exception), repr(bad))

    def test_tier_of_refuses_a_state_with_no_row(self):
        for bad in self.UNKNOWN:
            with self.assertRaises(records.RecordError, msg=repr(bad)) as caught:
                records.tier_of(bad)
            self.assertIn("ADR-28", str(caught.exception), repr(bad))

    def test_a_stored_state_has_no_row_in_either_table(self):
        for state in manifest.STATES:
            self.assertNotIn(state, records.SEVERITY, state)
            self.assertNotIn(state, records.TIER, state)

    def test_every_derived_state_is_answered_rather_than_refused(self):
        """Non-vacuity, both directions: refusing an unknown state must not
        refuse the five the machine really derives. Pinned through the
        accessors and against ADR-13's literal rows, so a table edited to
        silence a finding fails here rather than in a report nobody reads."""
        self.assertEqual(
            {
                records.IN_SYNC: None,
                records.DRIFTED: "error",
                records.UNRESOLVED: "warn",
                records.WAIVED: "info",
                records.EXTERNAL: "info",
            },
            dict((state, records.severity_of(state)) for state in records.DERIVED_STATES),
        )
        self.assertEqual(
            {
                records.IN_SYNC: None,
                records.DRIFTED: "resolved",
                records.UNRESOLVED: "resolved",
                records.WAIVED: "resolved",
                records.EXTERNAL: "inspected",
            },
            dict((state, records.tier_of(state)) for state in records.DERIVED_STATES),
        )


# ----------------------------------------------------------------------
# The machine itself, as a pure function of (record, does it still resolve).


class DerivedStateTest(unittest.TestCase):
    def test_a_resolved_record_is_in_sync_in_either_stored_state(self):
        for state in manifest.STATES:
            self.assertEqual(
                records.IN_SYNC,
                records.derived_state(a_path_record(state=state), True),
                state,
            )

    def test_an_unresolved_confirmed_record_is_drifted(self):
        self.assertEqual(
            records.DRIFTED,
            records.derived_state(a_path_record(state="confirmed"), False),
        )

    def test_an_unresolved_proposed_record_is_not_drifted(self):
        """Drift is defined for a confirmed record only (ADR-11). A proposed
        record that does not resolve is an unconfirmed inference that missed,
        and the severity difference between the two is the whole point."""
        state = records.derived_state(a_path_record(state="proposed"), False)
        self.assertEqual(records.UNRESOLVED, state)
        self.assertNotEqual(records.DRIFTED, state)

    def test_a_waiver_downgrades_an_unresolved_record_in_either_state(self):
        for state in manifest.STATES:
            record = a_path_record(
                state=state, waived={"reason": "moved to the wiki, tracked in #12"}
            )
            self.assertEqual(
                records.WAIVED, records.derived_state(record, False), state
            )

    def test_a_resolved_waived_record_is_still_in_sync(self):
        """A waiver excuses a finding. Where the claim resolves there is no
        finding to excuse, so the waiver changes nothing."""
        record = a_path_record(waived={"reason": "kept for the migration"})
        self.assertEqual(records.IN_SYNC, records.derived_state(record, True))

    def test_an_external_record_is_never_resolved_either_way(self):
        """ADR-18: `external` is not resolved and not counted as checked. The
        resolution answer is not consulted at all — passing True must not turn
        it into coverage."""
        record = a_command_record(state="confirmed", resolution="external")
        for answer in (True, False):
            self.assertEqual(
                records.EXTERNAL, records.derived_state(record, answer), repr(answer)
            )

    def test_an_unknown_stored_state_raises_rather_than_defaulting(self):
        """T4. Reading it as `proposed` would downgrade an `error` to a `warn`
        on the strength of a lookup that failed."""
        for bad in ("drifted", "approved", "", None):
            with self.assertRaises(records.RecordError, msg=repr(bad)) as caught:
                records.derived_state(a_path_record(state=bad), False)
            self.assertIn("state", str(caught.exception), repr(bad))

    def test_a_waiver_with_no_usable_reason_raises_rather_than_downgrading(self):
        """A `waived` key somebody typed and left empty is not a waiver.

        Accepting it would turn a confirmed record's `error` into an `info` for
        free. `manifest.validate` already rejects the shape; this is the second
        layer, and the one that holds for a record that reached the machine
        without passing through the validator.
        """
        for bad in ({}, {"reason": ""}, {"reason": "   "}, {"reason": None}, "yes"):
            record = a_path_record(state="confirmed", waived=bad)
            with self.assertRaises(records.RecordError, msg=repr(bad)) as caught:
                records.derived_state(record, False)
            self.assertIn("reason", str(caught.exception), repr(bad))

    def test_a_real_waiver_is_not_caught_by_that_rule(self):
        """Non-vacuity: refusing an empty reason must not refuse a real one."""
        record = a_path_record(
            state="confirmed", waived={"reason": "moved to the wiki"}
        )
        self.assertEqual(records.WAIVED, records.derived_state(record, False))


# ----------------------------------------------------------------------
# T7 — the two typed inputs. `resolved` is the only input that decides a
# severity and was the only one with no guard, so it is the only place a
# caller's type error could change a verdict instead of raising. Both refusals
# are asserted against the exact shapes that shipped.


class TheResolutionSetAnswersMembershipTest(unittest.TestCase):
    """A wrong-typed probe must fault, not answer.

    Three costumes of this project's one defect are already closed: a raw
    non-zero status read as an answer, a swallowed `except` manufacturing a
    negative fact, a followed symlink answering about a different file. This is
    the fourth, and it needs no failure at all. `record_findings` asks the
    repository exactly one question — `value in resolved` — and on a `str` that
    question means *substring*. A **confirmed** record for `npm run test`
    against the answer `"npm run test-all"` read *in sync*, emitted no finding,
    exited 0, and still printed `1 item examined`: ADR-30's vacuous pass
    wearing a cardinality.
    """

    def claims(self):
        return [a_command_record("npm run test", state="confirmed")]

    def test_the_substring_answer_is_the_defect_and_python_really_gives_it(self):
        """Fixture-liveness for the whole class. Without it every refusal below
        could be refusing a shape that was never dangerous in the first place,
        and the class would prove only that strings are unwelcome."""
        self.assertIn("npm run test", "npm run test-all")

    def test_the_container_form_of_the_same_answer_reports_the_drift(self):
        """The control the string form silently lost: same record, same value,
        the answer as a set — an `error` and exit 1."""
        found, examined = records.record_findings(
            self.claims(), "commands", {"npm run test-all"}
        )
        self.assertEqual(["command-drifted"], [item["id"] for item in found])
        self.assertEqual("error", found[0]["severity"])
        self.assertEqual(1, findings.exit_code(found))
        self.assertEqual(1, examined["examined"])

    def test_a_string_answer_is_refused_rather_than_substring_matched(self):
        with self.assertRaises(records.RecordError) as caught:
            records.record_findings(self.claims(), "commands", "npm run test-all")
        self.assertIn("substring", str(caught.exception))

    def test_bytes_are_refused_for_the_same_reason(self):
        for bad in (b"npm run test-all", bytearray(b"npm run test-all")):
            with self.assertRaises(records.RecordError, msg=repr(bad)) as caught:
                records.record_findings(self.claims(), "commands", bad)
            self.assertIn("substring", str(caught.exception), repr(bad))

    def test_an_answer_that_cannot_be_asked_twice_is_refused(self):
        """An iterator answers the first record and then answers no to every
        record after it, having been consumed by the first question — which is
        the same defect on a delay. `None` and an `int` cannot answer at all."""
        for bad in (None, 7, (value for value in ("npm run test",))):
            with self.assertRaises(records.RecordError, msg=repr(bad)) as caught:
                records.record_findings(self.claims(), "commands", bad)
            self.assertIn("membership", str(caught.exception), repr(bad))

    def test_the_ordinary_containers_are_not_refused(self):
        """Non-vacuity: refusing a string must not refuse the answer C1 and C2
        will really hand it (ADR-32), in any of the shapes it could take."""
        for good in (
            {"npm run test"},
            frozenset(["npm run test"]),
            ["npm run test"],
            ("npm run test",),
            {"npm run test": "declared in package.json"},
        ):
            found, examined = records.record_findings(
                self.claims(), "commands", good
            )
            self.assertEqual([], found, repr(good))
            self.assertEqual(1, examined["examined"], repr(good))


class TheResolutionAnswerIsABoolTest(unittest.TestCase):
    """The same defect one call in: `finding_for` took the answer as
    truthiness.

    Any truthy object — the set that should have been searched, a command's
    output, a `CompletedProcess` — read as *the claim resolved*, so
    `finding_for(confirmed_record, "commands", 0, "anything-truthy")` returned
    `None` and a confirmed record's drift disappeared into an exit 0. The falsy
    half is no better: `0`, `""` and an empty set all read as *did not
    resolve*, manufacturing a drift finding out of an answer nobody gave.

    The refusal lives in `derived_state`, which is the one place the answer is
    read; `finding_for` and `record_findings` both reach it, and
    `record_findings` can only ever hand it a real `bool` because `in` returns
    one. Asserted at both seams so the guard cannot be moved off the path.
    """

    def test_a_truthy_non_bool_answer_is_refused_by_finding_for(self):
        record = a_command_record("npm test", state="confirmed")
        for bad in ("anything-truthy", 1, ["npm test"], {"npm test"}):
            with self.assertRaises(records.RecordError, msg=repr(bad)) as caught:
                records.finding_for(record, "commands", 0, bad)
            self.assertIn("bool", str(caught.exception), repr(bad))

    def test_a_falsy_non_bool_answer_is_refused_too(self):
        record = a_command_record("npm test", state="confirmed")
        for bad in (0, "", set(), None):
            with self.assertRaises(records.RecordError, msg=repr(bad)) as caught:
                records.finding_for(record, "commands", 0, bad)
            self.assertIn("bool", str(caught.exception), repr(bad))

    def test_the_state_machine_itself_refuses_it(self):
        with self.assertRaises(records.RecordError) as caught:
            records.derived_state(a_path_record(state="confirmed"), "truthy")
        self.assertIn("bool", str(caught.exception))

    def test_an_external_record_does_not_escape_the_refusal(self):
        """ADR-18 says the answer is never *consulted* for an `external`
        record. Never consulted is not never checked: a caller who got the type
        wrong got it wrong for the whole record set, and the other records in
        it are the ones that decide an exit code."""
        record = a_command_record(
            "docker build .", state="confirmed", resolution="external"
        )
        with self.assertRaises(records.RecordError) as caught:
            records.finding_for(record, "commands", 0, "truthy")
        self.assertIn("bool", str(caught.exception))

    def test_the_two_bools_are_not_refused(self):
        """Non-vacuity, both directions: absence of a finding is an answer."""
        record = a_command_record("npm test", state="confirmed")
        self.assertIsNone(records.finding_for(record, "commands", 0, True))
        self.assertEqual(
            "command-drifted",
            records.finding_for(record, "commands", 0, False)["id"],
        )


# ----------------------------------------------------------------------
# One record's finding: ADR-13's severity, ADR-28's tier, and the confidence
# trap that `findings.finding` would otherwise catch only by accident.


class FindingSeverityTest(unittest.TestCase):
    def severity_of(self, record, resolved):
        item = records.finding_for(record, "paths", 0, resolved)
        return None if item is None else item["severity"]

    def test_each_derived_state_takes_its_adr13_severity(self):
        cases = (
            (a_path_record(state="confirmed"), False, "error"),
            (a_path_record(state="proposed"), False, "warn"),
            (
                a_path_record(state="confirmed", waived={"reason": "known gap"}),
                False,
                "info",
            ),
            (a_path_record(state="confirmed"), True, None),
        )
        for record, resolved, expected in cases:
            with self.subTest(record=record, resolved=resolved):
                self.assertEqual(expected, self.severity_of(record, resolved))

    def test_an_external_record_is_info_at_tier_inspected(self):
        item = records.finding_for(
            a_command_record(state="confirmed", resolution="external"),
            "commands",
            0,
            False,
        )
        self.assertEqual("info", item["severity"])
        self.assertEqual("inspected", item["tier"])

    def test_an_in_sync_record_produces_no_finding_at_all(self):
        self.assertIsNone(records.finding_for(a_path_record(), "paths", 0, True))

    def test_a_drift_finding_says_re_confirm_or_revert(self):
        """ADR-11 names the remedy in the finding itself."""
        item = records.finding_for(
            a_path_record(state="confirmed"), "paths", 0, False
        )
        self.assertIn("re-confirm or revert", item["observed"])

    def test_a_drift_finding_is_tier_resolved_and_carries_no_confidence(self):
        """ADR-28, and the single likeliest way to get this phase wrong.

        `findings.finding` refuses `severity="error"` on tier `inferred`
        (findings.py:68-72) and forbids `confidence` on every tier but that one
        (findings.py:74-78) — so a drift finding built as an inference could
        not be an error at all. The record's own stored confidence is a
        different field on a different object and must not leak onto it.
        """
        record = a_path_record(state="confirmed", confidence="low")
        item = records.finding_for(record, "paths", 0, False)
        self.assertEqual("resolved", item["tier"])
        self.assertEqual("error", item["severity"])
        self.assertNotIn("confidence", item)
        self.assertEqual("low", record["confidence"], "the record lost its own")

    def test_the_finding_names_the_record_it_came_from(self):
        item = records.finding_for(
            a_command_record(state="confirmed"), "commands", 3, False
        )
        self.assertEqual("commands[3]", item["where"])
        self.assertEqual("command-drifted", item["id"])
        self.assertIn("npm test", item["claim"])

    def test_a_line_break_in_a_waiver_reason_cannot_split_the_report(self):
        """The reason is rendered with `%r` for the reason ADR-32 gives for
        record values: a value carrying a line break would silently become two
        lines of a report that is one item per line. The validator does not
        reject a control character in a *reason*, so the renderer must not be
        able to be split by one."""
        record = a_path_record(
            state="confirmed", waived={"reason": "line one\nline two"}
        )
        item = records.finding_for(record, "paths", 0, False)
        self.assertNotIn("\n", item["observed"])
        self.assertIn("line one", item["observed"])

    def test_an_unknown_kind_raises(self):
        with self.assertRaises(records.RecordError) as caught:
            records.finding_for(a_path_record(), "docsScope", 0, False)
        self.assertIn("docsScope", str(caught.exception))


# ----------------------------------------------------------------------
# T8 — the report's own words, pinned against **literal strings**. Every
# constant below was gutted in a mutation run and nothing went red, because the
# assertions that touched them compared each constant against itself and so
# moved with the mutation. A report is the entire product of a tool that
# reports; its sentences are behaviour, not decoration.


class ReportWordingIsPinnedTest(unittest.TestCase):
    def test_the_zero_cardinality_reason_is_adr32s_wording_verbatim(self):
        """ADR-32:987-989 fixes these words: on a repository with no claim
        source the report "states the cardinality and the reason: *no claim
        source — nothing to verify*". It is the one sentence that keeps `0
        items examined` from reading as coverage (ADR-30), so it is pinned as
        text rather than as a name."""
        self.assertEqual(
            "no claim source — nothing to verify", records.NO_CLAIM_SOURCE
        )

    def test_the_reason_reaches_the_rendered_report_unaltered(self):
        """Pinned where a human reads it, not only where it is declared: a
        constant that survives and a renderer that drops it are the same
        outcome."""
        _found, examined = records.record_findings(
            [], "paths", set(), reason=records.NO_CLAIM_SOURCE
        )
        self.assertIn(
            "paths: 0 items examined — no claim source — nothing to verify",
            findings.render_report("check", [], [examined]),
        )

    def test_the_paths_claim_says_which_path_and_where_it_was_looked_for(self):
        item = records.finding_for(
            a_path_record("docs/architecture.md", state="confirmed"),
            "paths",
            0,
            False,
        )
        self.assertEqual(
            "the declared path 'docs/architecture.md' resolves in the working "
            "tree",
            item["claim"],
        )

    def test_the_commands_claim_says_which_command_and_against_what(self):
        """ADR-18: C1 resolves a command against *this repository's own
        declarations* and never by executing it or consulting `PATH`. The claim
        line is where that bound is stated to the reader."""
        item = records.finding_for(
            a_command_record("npm test", state="confirmed"), "commands", 0, False
        )
        self.assertEqual(
            "the approved command 'npm test' resolves to one of this "
            "repository's own declarations",
            item["claim"],
        )

    def test_the_drifted_wording_names_the_state_and_the_remedy(self):
        item = records.finding_for(a_path_record(state="confirmed"), "paths", 0, False)
        self.assertIn("The record is confirmed", item["observed"])
        self.assertIn("this is drift and not a bad guess", item["observed"])
        self.assertIn("re-confirm or revert", item["observed"])

    def test_the_unresolved_wording_says_the_inference_settles_nothing(self):
        """ADR-11: a proposed record is an inference nobody has confirmed. Say
        less and a `warn` reads as a verdict about the repository, which is
        exactly what an unconfirmed inference is not (ADR-28)."""
        item = records.finding_for(a_path_record(state="proposed"), "paths", 0, False)
        self.assertIn("The record is proposed", item["observed"])
        self.assertIn("an inference nobody has confirmed", item["observed"])
        self.assertIn("settles nothing", item["observed"])

    def test_the_external_wording_says_it_was_never_counted_as_coverage(self):
        """ADR-18. The last clause is the load-bearing one: without it an
        `info` line beside a cardinality reads as a check that passed."""
        item = records.finding_for(
            a_command_record(
                "docker build .", state="confirmed", resolution="external"
            ),
            "commands",
            0,
            False,
        )
        self.assertIn("this repository does not declare", item["observed"])
        self.assertIn("as the human declared it", item["observed"])
        self.assertIn("never counted as coverage", item["observed"])

    def test_the_waived_wording_quotes_the_reason_it_was_given(self):
        item = records.finding_for(
            a_path_record(state="confirmed", waived={"reason": "tracked in #12"}),
            "paths",
            0,
            False,
        )
        self.assertIn("the record carries a waiver", item["observed"])
        self.assertIn("tracked in #12", item["observed"])


# ----------------------------------------------------------------------
# A whole record set: cardinality (ADR-30) and the separate external count
# (ADR-18), plus the rule that the set is read and never edited.


class RecordSetTest(unittest.TestCase):
    def test_the_cardinality_is_exactly_the_record_count(self):
        """ADR-32: a claim exists because a record exists."""
        claims = [a_path_record("a.md"), a_path_record("b.md"), a_path_record("c.md")]
        _found, examined = records.record_findings(claims, "paths", {"a.md"})
        self.assertEqual(3, examined["examined"])
        self.assertEqual("paths", examined["check"])

    def test_an_external_record_is_counted_separately_never_as_coverage(self):
        claims = [
            a_command_record("npm test"),
            a_command_record(
                "docker build .", state="confirmed", resolution="external"
            ),
        ]
        found, examined = records.record_findings(claims, "commands", set())
        self.assertEqual(1, examined["examined"], "an external record was counted")
        self.assertEqual(1, examined["declaredExternal"])
        self.assertEqual(
            ["command-unresolved", "command-external"], [item["id"] for item in found]
        )

    def test_an_all_external_set_states_why_it_examined_nothing(self):
        claims = [
            a_command_record(
                "docker build .", state="confirmed", resolution="external"
            )
        ]
        _found, examined = records.record_findings(claims, "commands", set())
        self.assertEqual(0, examined["examined"])
        self.assertTrue(examined["reason"], "a zero cardinality with no reason")

    def test_an_all_external_set_names_the_condition_over_the_callers_reason(self):
        """ADR-30 and ADR-18: the **observed** condition outranks a reason the
        caller supplied before it knew what the set contained.

        A caller decides its zero-cardinality reason at the call site, not after
        counting — the end-to-end helper already passes `NO_CLAIM_SOURCE` on
        every call — and the reason was taken only when the caller had given
        none. So an all-external set rendered *0 items examined (+1 declared
        external, not checked) — no claim source — nothing to verify* over a
        record set that **has** a claim source: one record, declared external by
        a human (ADR-18, ADR-32). A reason contradicting the line it annotates
        is ADR-30's vacuous pass with better manners — the cardinality is right
        and the sentence that stops it reading as coverage is about a different
        repository. `NO_CLAIM_SOURCE` belongs to the genuinely empty set; every
        record being external is a different fact and the one that was seen.
        """
        claims = [
            a_command_record(
                "docker build .", state="confirmed", resolution="external"
            )
        ]
        _found, examined = records.record_findings(
            claims, "commands", set(), reason=records.NO_CLAIM_SOURCE
        )
        self.assertEqual(0, examined["examined"])
        self.assertEqual(1, examined["declaredExternal"])
        self.assertEqual(records.ALL_EXTERNAL, examined["reason"])
        self.assertIn(
            "commands: 0 items examined (+1 declared external, not checked) — "
            + records.ALL_EXTERNAL,
            findings.render_report("check", [], [examined]),
            "the rendered cardinality does not name the condition it observed",
        )

    def test_an_empty_set_with_no_reason_is_a_programming_error(self):
        """ADR-30 through `findings.cardinality`: a vacuous pass must never
        render as coverage, and the caller is the only one who knows whether
        the set is empty because there is no manifest or because the manifest
        declares nothing."""
        with self.assertRaises(findings.FindingError) as caught:
            records.record_findings([], "paths", set())
        self.assertIn("0 items", str(caught.exception))

    def test_an_empty_set_with_a_reason_is_reported(self):
        _found, examined = records.record_findings(
            [], "paths", set(), reason=records.NO_CLAIM_SOURCE
        )
        self.assertEqual(0, examined["examined"])
        self.assertEqual(records.NO_CLAIM_SOURCE, examined["reason"])

    def test_a_populated_set_does_not_carry_the_empty_reason(self):
        """Non-vacuity for the line above: the reason is for the empty case
        alone, or every report would carry a sentence that is not true of it."""
        _found, examined = records.record_findings(
            [a_path_record()], "paths", set(), reason=records.NO_CLAIM_SOURCE
        )
        self.assertIsNone(examined["reason"])

    def test_an_unknown_kind_is_refused_by_the_aggregate_entry_point_too(self):
        """T4. `finding_for`'s own `_require_kind` is proved by
        `test_an_unknown_kind_raises`; this is `record_findings`' call, which
        is the one a verb actually reaches. Deleting it reddened nothing, so
        the aggregate entry point would have read `docsScope` — a scope key,
        never a claim record set (ADR-32) — as if it were one.

        The empty list and the reason are deliberate: with the guard gone this
        call returns a clean `([], cardinality)`, so the red is the missing
        refusal and not an incidental `KeyError` further down.
        """
        with self.assertRaises(records.RecordError) as caught:
            records.record_findings(
                [], "docsScope", set(), reason=records.NO_CLAIM_SOURCE
            )
        self.assertIn("ADR-32", str(caught.exception))
        self.assertIn("docsScope", str(caught.exception))

    def test_the_two_real_kinds_are_not_refused(self):
        """Non-vacuity: `docsScope` is a declared scope (ADR-30) but not a
        claim record set, and the two that are must still pass."""
        for kind in records.CLAIM_KINDS:
            _found, examined = records.record_findings(
                [], kind, set(), reason=records.NO_CLAIM_SOURCE
            )
            self.assertEqual(kind, examined["check"], kind)


# ----------------------------------------------------------------------
# P3.6 — a confirmed record is never auto-deleted. "The command vanished" is
# the drift worth reporting; deleting the record would delete the finding.


class ConfirmedRecordIsNeverDeletedTest(unittest.TestCase):
    def test_a_vanished_command_is_a_drifted_finding(self):
        claims = [a_command_record("npm test", state="confirmed")]
        found, examined = records.record_findings(claims, "commands", set())
        self.assertEqual(["command-drifted"], [item["id"] for item in found])
        self.assertEqual("error", found[0]["severity"])
        self.assertEqual(1, examined["examined"])

    def test_the_record_set_is_read_and_never_edited(self):
        """T1 and T6, in memory. Rendered to text before and after, so an
        in-place edit of a nested dict cannot hide behind an aliased
        comparison — and **at least one record is `proposed`**, which is the
        other half of the fixture and the more easily lost one.

        This test used to pre-set *every* record to `confirmed`. A machine that
        promoted every record it read would then have written the value that
        was already there: the rendered text stays byte-identical, and the
        comparison passes over the exact edit it exists to catch. Planting
        `record["state"] = "confirmed"` in `record_findings` after the finding
        is built left all 62 tests in this file green. That is this codebase's
        "two values coincided" failure mode, and the liveness assertion below
        is what keeps it out.
        """
        document = a_document(
            commands=[
                a_command_record("npm test", state="confirmed"),
                a_command_record("npm run lint", state="proposed"),
            ],
            paths=[
                a_path_record("docs/architecture.md", state="confirmed"),
                a_path_record("docs/design.md", state="proposed"),
            ],
        )
        stored = self.stored_states(document)
        self.assertIn(
            "proposed",
            stored,
            "the fixture is inert: with every record already `confirmed`, a "
            "machine that promoted all of them would write the value that is "
            "already there and this comparison could not see it",
        )
        self.assertIn(
            "confirmed",
            stored,
            "the fixture no longer covers the record a promotion cannot move",
        )
        before = jsonio.dumps(document)

        for kind in records.CLAIM_KINDS:
            records.record_findings(document.get(kind, []), kind, set())

        self.assertEqual(before, jsonio.dumps(document), "the machine edited a record")
        self.assertEqual(2, len(document["commands"]), "a command record was deleted")
        self.assertEqual(2, len(document["paths"]), "a path record was deleted")
        self.assertEqual(
            stored, self.stored_states(document), "a record's stored state moved"
        )

    def stored_states(self, document):
        return [
            record["state"]
            for kind in records.CLAIM_KINDS
            for record in document[kind]
        ]

    def test_the_comparison_would_notice_an_edit(self):
        """Non-vacuity: the rendered comparison above must be able to fail."""
        document = a_document()
        before = jsonio.dumps(document)
        document["commands"][0]["state"] = "confirmed"
        self.assertNotEqual(before, jsonio.dumps(document))

    def test_the_comparison_would_notice_a_promotion_of_a_proposed_record(self):
        """Non-vacuity for T6 specifically, and not for edits in general: the
        edit the guard has to see is *this* one, on *this* fixture. Asserted
        over the same record set the test above builds, so a later change to
        the fixture that quietly re-confirms everything fails here."""
        document = a_document(
            commands=[a_command_record("npm run lint", state="proposed")],
            paths=[a_path_record("docs/design.md", state="proposed")],
        )
        before = jsonio.dumps(document)
        for kind in records.CLAIM_KINDS:
            for record in document[kind]:
                record["state"] = "confirmed"
        self.assertNotEqual(
            before,
            jsonio.dumps(document),
            "a promotion of every record left the rendered text unchanged",
        )


# ----------------------------------------------------------------------
# `scan.pending[]`. Its element shape is undefined in the frozen spec, so the
# reporting reads no field of an item — only that one is there.


class PendingDeltaTest(unittest.TestCase):
    def test_each_pending_item_is_an_info_that_reads_no_field_of_it(self):
        document = {"scan": {"pending": [{"anything": 1}, "a bare string", 7]}}
        found, examined = records.pending_findings(document)
        self.assertEqual(["info", "info", "info"], [item["severity"] for item in found])
        self.assertEqual(
            ["scan.pending[0]", "scan.pending[1]", "scan.pending[2]"],
            [item["where"] for item in found],
        )
        self.assertEqual(3, examined["examined"])

    def test_no_pending_items_states_why_it_examined_nothing(self):
        found, examined = records.pending_findings({})
        self.assertEqual([], found)
        self.assertEqual(0, examined["examined"])
        self.assertTrue(examined["reason"])

    def test_a_document_of_none_is_the_unmanaged_repository(self):
        found, examined = records.pending_findings(None)
        self.assertEqual([], found)
        self.assertEqual(0, examined["examined"])

    # T4 — three refusals, each of which survived deletion. `None` was the only
    # document shape covered, and `None` is the *unmanaged repository*, not a
    # malformed one: it exercises the early return, never the refusal below it.
    #
    # **What each refusal actually prevents differs, and the docstrings say so
    # rather than repeating one sentence three times.** Removed, the first two
    # do not produce a silent zero — `document.get` and `scan.get` raise
    # `AttributeError` on every non-object JSON can hold — so what is lost is
    # the *named* fault: `RecordError` is deliberately outside
    # `cli.REPORTED_FAULTS`, so either way the run stops, but only one of them
    # says which key of the manifest was the wrong shape. The third is the one
    # that really does answer wrongly.

    def test_a_document_that_is_not_an_object_is_refused(self):
        """Refused by name, not by `AttributeError` three frames down: a fault
        that cannot say what was wrong is the next version of this bug."""
        for bad in ([], "a manifest", 7, ({},)):
            with self.assertRaises(records.RecordError, msg=repr(bad)) as caught:
                records.pending_findings(bad)
            self.assertIn("manifest document", str(caught.exception), repr(bad))

    def test_a_scan_that_is_not_an_object_is_refused(self):
        for bad in ([], "pending", 7):
            with self.assertRaises(records.RecordError, msg=repr(bad)) as caught:
                records.pending_findings({"scan": bad})
            self.assertIn("vacuous", str(caught.exception), repr(bad))

    def test_a_pending_that_is_not_an_array_is_refused(self):
        """The refusal that stops a wrong answer rather than a bare crash.

        `range(len(pending))` takes any sized object, so with this branch gone
        `{"pending": {}}` reports **0 pending deltas** with the reason "no
        re-scan delta is recorded" — ADR-30's vacuous pass, stated as a
        cardinality — and `{"pending": "one delta"}` reports **nine** `info`
        findings, one per character, at `scan.pending[0..8]`. A fabricated
        count is worse than a crash; both are named here.
        """
        for bad in ({}, "one delta", 7):
            with self.assertRaises(records.RecordError, msg=repr(bad)) as caught:
                records.pending_findings({"scan": {"pending": bad}})
            self.assertIn("scan.pending", str(caught.exception), repr(bad))

    def test_the_well_formed_shapes_are_not_refused(self):
        """Non-vacuity for all three: refusing a malformed document must not
        refuse the two shapes a real manifest takes — no `scan` key at all, and
        a `scan` carrying an empty list."""
        for good in ({}, {"scan": {}}, {"scan": {"pending": []}}):
            found, examined = records.pending_findings(good)
            self.assertEqual([], found, repr(good))
            self.assertEqual(0, examined["examined"], repr(good))


# ----------------------------------------------------------------------
# P3.8 — the severity mapping asserted end to end, as the exit codes a caller
# sees, through the real `cli.main`.


class ExitCodeMappingTest(RecordFixture):
    def run_kind(self, kind):
        return self.run_injected(a_record_verb(kind))

    def test_a_confirmed_records_violation_is_exit_one(self):
        self.write_manifest(
            a_document(paths=[a_path_record("docs/gone.md", state="confirmed")])
        )
        code, out, err = self.run_kind("paths")
        self.assertEqual(1, code, err)
        self.assertNotIn("Traceback", err, "a predicted fault printed a crash")
        self.assertIn("error [resolved] path-drifted", out)
        self.assertIn("1 error, 0 warn, 0 info", out)

    def test_a_proposed_records_violation_is_exit_zero_with_a_warn(self):
        self.write_manifest(
            a_document(paths=[a_path_record("docs/gone.md", state="proposed")])
        )
        code, out, err = self.run_kind("paths")
        self.assertEqual(0, code, err)
        self.assertIn("path-unresolved", out)
        self.assertIn("0 error, 1 warn, 0 info", out)

    def test_a_waived_record_is_exit_zero_with_an_info(self):
        self.write_manifest(
            a_document(
                paths=[
                    a_path_record(
                        "docs/gone.md",
                        state="confirmed",
                        waived={"reason": "moved to the wiki, tracked in #12"},
                    )
                ]
            )
        )
        code, out, err = self.run_kind("paths")
        self.assertEqual(0, code, err)
        self.assertIn("path-waived", out)
        self.assertIn("0 error, 0 warn, 1 info", out)

    def test_an_external_record_is_exit_zero_and_counted_separately(self):
        self.write_manifest(
            a_document(
                commands=[
                    a_command_record(
                        "docker build .", state="confirmed", resolution="external"
                    )
                ]
            )
        )
        code, out, err = self.run_kind("commands")
        self.assertEqual(0, code, err)
        self.assertIn("info  [inspected] command-external", out)
        self.assertIn("(+1 declared external, not checked)", out)
        self.assertIn("0 error, 0 warn, 1 info", out)

    def test_a_pending_delta_is_exit_zero_with_an_info(self):
        document = a_document(paths=[])
        document["scan"] = {"pending": [{"value": "npm run lint"}]}
        self.write_manifest(document)
        code, out, err = self.run_kind("paths")
        self.assertEqual(0, code, err)
        self.assertIn("scan.pending[0]", out)
        self.assertIn("0 error, 0 warn, 1 info", out)

    def test_an_inference_is_exit_zero_with_an_info(self):
        """The class P3.8's list omits and ADR-13:343 does not."""
        code, out, err = self.run_injected(an_inference_verb)
        self.assertEqual(0, code, err)
        self.assertIn("info  [inferred] inferred-command (confidence low)", out)
        self.assertIn("0 error, 0 warn, 1 info", out)

    def test_the_seam_can_produce_exit_one(self):
        """Non-vacuity for every exit-0 assertion above: an injected verb that
        never reached an `error` would satisfy all of them."""
        self.write_manifest(
            a_document(commands=[a_command_record("npm test", state="confirmed")])
        )
        code, _out, err = self.run_kind("commands")
        self.assertEqual(1, code, err)


# ----------------------------------------------------------------------
# P3.5's headline: confirm a record, change the repository under it, and the
# finding reads *drifted* while the stored record does not move.


class DriftIsDerivedNotStoredTest(RecordFixture):
    def setUp(self):
        RecordFixture.setUp(self)
        self.write("docs/architecture.md", "# architecture\n")
        self.raw = self.write_manifest(
            a_document(
                commands=[],
                paths=[a_path_record("docs/architecture.md", state="confirmed")],
            )
        )
        S.git(self.root, "add", "-A")
        S.git(self.root, "commit", "-q", "-m", "fixture")

    def test_a_confirmed_record_that_still_resolves_reports_nothing(self):
        """The precondition, asserted: without it the drift below could be the
        fixture never having resolved in the first place."""
        code, out, err = self.run_injected(a_record_verb("paths"))
        self.assertEqual(0, code, err)
        self.assertIn("0 error, 0 warn, 0 info", out)

    def test_changing_the_repository_under_it_reads_drifted(self):
        os.unlink(os.path.join(self.root, "docs", "architecture.md"))
        code, out, err = self.run_injected(a_record_verb("paths"))
        self.assertEqual(1, code, err)
        self.assertIn("error [resolved] path-drifted", out)
        self.assertIn("re-confirm or revert", out)

    def test_the_stored_record_is_byte_identical_before_and_after(self):
        """T1. The bytes, not the parsed dict — and the manifest is untracked
        here, which is exactly the gap `git status --porcelain` cannot see."""
        before = self.manifest_text()
        os.unlink(os.path.join(self.root, "docs", "architecture.md"))
        with S.unchanged_tree(self, self.root):
            code, _out, err = self.run_injected(a_record_verb("paths"))
        self.assertEqual(1, code, err)
        self.assertEqual(before, self.manifest_text(), "the drift was written down")
        self.assertEqual(self.raw, before, "the fixture's own bytes moved")

    def test_the_record_still_reads_confirmed_after_the_drift_was_reported(self):
        os.unlink(os.path.join(self.root, "docs", "architecture.md"))
        self.run_injected(a_record_verb("paths"))
        loaded = manifest.load(self.root)
        self.assertEqual("confirmed", loaded["paths"][0]["state"])
        self.assertEqual(1, len(loaded["paths"]), "the record was auto-deleted")

    def test_re_confirming_the_new_value_clears_the_drift(self):
        """Re-confirmation is a human editing the tracked file (ADR-11) — here,
        the test — and nothing else. The tool's part is to stop reporting."""
        os.unlink(os.path.join(self.root, "docs", "architecture.md"))
        self.write("docs/design.md", "# design\n")
        code, _out, err = self.run_injected(a_record_verb("paths"))
        self.assertEqual(1, code, err)

        self.write_manifest(
            a_document(
                commands=[],
                paths=[a_path_record("docs/design.md", state="confirmed")],
            )
        )
        code, out, err = self.run_injected(a_record_verb("paths"))
        self.assertEqual(0, code, err)
        self.assertIn("0 error, 0 warn, 0 info", out)

    def test_the_byte_comparison_would_notice_a_write(self):
        """Non-vacuity: the manifest comparison above must be able to fail."""
        before = self.manifest_text()
        self.write(manifest.MANIFEST_NAME, before + " ")
        self.assertNotEqual(before, self.manifest_text())


# ----------------------------------------------------------------------
# P3.5's other half, at the record level: a re-scan reopens nothing, and the
# only route a delta has to disk is a later `generate`. (P3.4 owns the
# tree-wide "`scan` writes nothing"; this is the record-level statement.)


class ARescanReopensNoConfirmedRecordTest(RecordFixture):
    """ADR-11: a re-scan may not mutate a matching confirmed record.

    **Disclosed:** `scan` is still a Phase-1 stub (`cli.VERBS`), so "reopens
    zero confirmed records" holds today for a weaker reason than it will once
    P3.1-P3.4 land — nothing is inferred yet to reopen them with. The
    assertions are on the manifest's bytes and on the absence of the `scan`
    key, so they keep their meaning either way, and the control below proves a
    pending delta is representable so the absence is behaviour and not schema.
    """

    def setUp(self):
        RecordFixture.setUp(self)
        self.raw = self.write_manifest(
            a_document(
                commands=[a_command_record("npm test", state="confirmed")],
                paths=[a_path_record("docs/architecture.md", state="confirmed")],
            )
        )

    def scan(self):
        out, err = io.StringIO(), io.StringIO()
        code = cli.main(["scan"], out, err, cwd=self.root)
        self.assertEqual(0, code, err.getvalue())
        self.assertNotIn("Traceback", err.getvalue())
        return out.getvalue()

    def test_two_scans_leave_the_confirmed_records_exactly_as_the_human_left_them(self):
        with S.unchanged_tree(self, self.root):
            self.scan()
            self.scan()
        self.assertEqual(self.raw, self.manifest_text())
        loaded = manifest.load(self.root)
        self.assertEqual("confirmed", loaded["commands"][0]["state"])
        self.assertEqual("confirmed", loaded["paths"][0]["state"])

    def test_no_scan_writes_a_pending_delta(self):
        self.scan()
        self.scan()
        self.assertNotIn(
            "scan",
            manifest.load(self.root),
            "a delta reached the manifest without a `generate`",
        )

    def test_a_pending_delta_is_representable_so_the_absence_means_something(self):
        """T5. Without this, `assertNotIn("scan", ...)` would pass forever on a
        schema that could not hold a pending delta at all."""
        document = a_document()
        document["scan"] = {"pending": [{"value": "npm run lint"}]}
        manifest.validate(document)
        self.write_manifest(document)
        self.assertIn("scan", manifest.load(self.root))


if __name__ == "__main__":
    unittest.main()
