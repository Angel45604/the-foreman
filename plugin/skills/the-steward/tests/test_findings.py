"""P1.6 — the findings model (ADR-28, ADR-13, ADR-30).

The one rule the tier carries: **`confidence` is required exactly when `tier`
is `inferred`, and forbidden on every other tier.**

DEBT ITEM 10 — the spec contradicts itself and this file records which side was
implemented. P1.5 says the two ADR-32 record sets are "each an ADR-11 record
carrying `state` and `confidence`", i.e. confidence is mandatory on every
record. ADR-28 and P1.6 define confidence as **per-inference**, required iff
the tier is `inferred`. ADR-2 agrees with ADR-28 ("scan confidence per
inference"). The ADR wins, per the standing instruction: confidence is required
on `inferred` findings, forbidden elsewhere, and **optional** on a manifest
record (present when a scan inference produced it, absent when a human wrote
it). See `test_manifest.py::ConfidenceIsOptionalOnRecordsTest`.
"""

import unittest

import _support as S

S.import_core()

import findings  # noqa: E402
import jsonio  # noqa: E402


def a_finding(**overrides):
    payload = dict(
        id="C1.unresolved-command",
        severity="warn",
        tier="resolved",
        claim="`npm run lint` resolves to a repository declaration",
        observed="no package script, Makefile target or tracked executable",
        where=".steward.json commands[0]",
    )
    payload.update(overrides)
    return payload


class VocabularyTest(unittest.TestCase):
    def test_exactly_three_severities(self):
        self.assertEqual(("error", "warn", "info"), findings.SEVERITIES)

    def test_exactly_four_tiers(self):
        self.assertEqual(
            ("resolved", "rendered", "inspected", "inferred"), findings.TIERS
        )

    def test_exactly_two_confidence_levels(self):
        self.assertEqual(("high", "low"), findings.CONFIDENCES)

    def test_unknown_values_are_rejected(self):
        for bad in ("critical", "fatal", "note", ""):
            with self.assertRaises(findings.FindingError, msg=bad):
                findings.finding(**a_finding(severity=bad))
        for bad in ("observed", "proved", "guessed", ""):
            with self.assertRaises(findings.FindingError, msg=bad):
                findings.finding(**a_finding(tier=bad))


class ConfidenceRuleTest(unittest.TestCase):
    def test_inferred_without_confidence_is_rejected(self):
        with self.assertRaises(findings.FindingError) as caught:
            findings.finding(**a_finding(tier="inferred", severity="info"))
        self.assertIn("confidence", str(caught.exception))

    def test_inferred_with_confidence_is_accepted(self):
        for level in findings.CONFIDENCES:
            record = findings.finding(
                **a_finding(tier="inferred", severity="info", confidence=level)
            )
            self.assertEqual(level, record["confidence"])

    def test_every_other_tier_carrying_confidence_is_rejected(self):
        for tier in ("resolved", "rendered", "inspected"):
            with self.assertRaises(findings.FindingError, msg=tier) as caught:
                findings.finding(**a_finding(tier=tier, confidence="high"))
            self.assertIn("confidence", str(caught.exception))

    def test_unknown_confidence_level_is_rejected(self):
        for bad in ("medium", "certain", "0.7", ""):
            with self.assertRaises(findings.FindingError, msg=bad):
                findings.finding(
                    **a_finding(tier="inferred", severity="info", confidence=bad)
                )

    def test_a_finding_with_no_confidence_omits_the_key_entirely(self):
        record = findings.finding(**a_finding())
        self.assertNotIn("confidence", record)


class InferenceIsNeverProofTest(unittest.TestCase):
    """ADR-28: an inferred finding is never an `error` on its own — it becomes
    an ADR-11 record, and the record's state sets the severity."""

    def test_inferred_at_error_is_rejected(self):
        with self.assertRaises(findings.FindingError) as caught:
            findings.finding(
                **a_finding(tier="inferred", severity="error", confidence="high")
            )
        self.assertIn("inferred", str(caught.exception))

    def test_inferred_at_warn_and_info_are_accepted(self):
        for severity in ("warn", "info"):
            findings.finding(
                **a_finding(tier="inferred", severity=severity, confidence="low")
            )


class RequiredFieldsTest(unittest.TestCase):
    def test_every_field_is_required(self):
        for field in ("id", "severity", "tier", "claim", "observed", "where"):
            payload = a_finding()
            del payload[field]
            with self.assertRaises(findings.FindingError, msg=field):
                findings.finding(**payload)

    def test_an_empty_required_field_is_rejected(self):
        for field in ("id", "claim", "observed", "where"):
            with self.assertRaises(findings.FindingError, msg=field):
                findings.finding(**a_finding(**{field: "  "}))

    def test_round_trips_through_canonical_json(self):
        record = findings.finding(
            **a_finding(tier="inferred", severity="info", confidence="low")
        )
        text = jsonio.dumps(record)
        self.assertEqual(record, jsonio.loads(text))
        self.assertEqual(text, jsonio.dumps(jsonio.loads(text)))


class ExitCodeFromFindingsTest(unittest.TestCase):
    def test_any_error_is_exit_one(self):
        self.assertEqual(
            1, findings.exit_code([a_finding(severity="info"), a_finding(severity="error")])
        )

    def test_warn_and_info_alone_are_exit_zero(self):
        self.assertEqual(
            0, findings.exit_code([a_finding(severity="warn"), a_finding(severity="info")])
        )

    def test_no_findings_is_exit_zero(self):
        self.assertEqual(0, findings.exit_code([]))


class ReportRendererTest(unittest.TestCase):
    def setUp(self):
        self.findings = [
            findings.finding(**a_finding(severity="error", tier="resolved")),
            findings.finding(
                **a_finding(
                    id="scan.test-command",
                    severity="info",
                    tier="inferred",
                    confidence="low",
                )
            ),
        ]
        self.cardinalities = [
            findings.cardinality("C1", 3, declared_external=2),
            findings.cardinality(
                "C2", 0, reason="no claim source — nothing to verify"
            ),
        ]

    def test_prints_the_tier_of_every_finding(self):
        text = findings.render_report("check", self.findings, self.cardinalities)
        self.assertIn("[resolved]", text)
        self.assertIn("[inferred]", text)

    def test_prints_confidence_only_where_there_is_one(self):
        text = findings.render_report("check", self.findings, self.cardinalities)
        self.assertIn("confidence low", text)
        self.assertEqual(1, text.count("confidence "))

    def test_prints_the_cardinality_each_check_examined(self):
        text = findings.render_report("check", self.findings, self.cardinalities)
        self.assertIn("C1: 3 items examined", text)
        self.assertIn("C2: 0 items examined", text)

    def test_a_zero_cardinality_always_states_its_reason(self):
        text = findings.render_report("check", self.findings, self.cardinalities)
        self.assertIn("no claim source — nothing to verify", text)

    def test_a_zero_cardinality_without_a_reason_is_a_programming_error(self):
        """ADR-30: '0 checked, 0 problems found' may never render as coverage."""
        with self.assertRaises(findings.FindingError):
            findings.cardinality("C3", 0)

    def test_declared_external_is_counted_separately_never_as_coverage(self):
        text = findings.render_report("check", self.findings, self.cardinalities)
        self.assertIn("2 declared external", text)
        self.assertIn("not checked", text)

    def test_summary_counts_every_severity(self):
        text = findings.render_report("check", self.findings, self.cardinalities)
        self.assertIn("1 error", text)
        self.assertIn("0 warn", text)
        self.assertIn("1 info", text)

    def test_rendering_twice_is_byte_identical(self):
        first = findings.render_report("check", self.findings, self.cardinalities)
        second = findings.render_report("check", self.findings, self.cardinalities)
        self.assertEqual(first, second)

    def test_an_empty_report_still_prints_cardinalities(self):
        text = findings.render_report("check", [], self.cardinalities)
        self.assertIn("C1: 3 items examined", text)
        self.assertIn("0 error", text)


if __name__ == "__main__":
    unittest.main()
