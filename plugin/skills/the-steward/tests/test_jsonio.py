"""P1.4 — canonical JSON I/O and the temporal rule (ADR-2).

Canonical means: 2-space indent, sorted keys, LF endings, exactly one trailing
newline. Canonical serialization is what makes render-and-diff possible at all,
so it is asserted on bytes, not on shape.
"""

import json
import unittest

import _support as S

S.import_core()

import jsonio  # noqa: E402


class CanonicalFormTest(unittest.TestCase):
    def test_two_space_indent_sorted_keys_lf_and_one_trailing_newline(self):
        text = jsonio.dumps({"b": 1, "a": {"d": [1, 2], "c": True}})
        self.assertEqual(
            '{\n'
            '  "a": {\n'
            '    "c": true,\n'
            '    "d": [\n'
            '      1,\n'
            '      2\n'
            '    ]\n'
            '  },\n'
            '  "b": 1\n'
            '}\n',
            text,
        )

    def test_exactly_one_trailing_newline(self):
        text = jsonio.dumps({})
        self.assertTrue(text.endswith("}\n"))
        self.assertFalse(text.endswith("\n\n"))

    def test_no_carriage_returns_anywhere(self):
        text = jsonio.dumps({"a": "line"})
        self.assertNotIn("\r", text)

    def test_non_ascii_is_written_as_itself_not_escaped(self):
        text = jsonio.dumps({"k": "café"})
        self.assertIn("café", text)
        self.assertNotIn("\\u00e9", text)

    def test_no_trailing_whitespace_on_any_line(self):
        text = jsonio.dumps({"a": {}, "b": [], "c": [1]})
        for line in text.split("\n"):
            self.assertEqual(line.rstrip(), line, repr(line))

    def test_render_twice_is_byte_identical(self):
        payload = {"z": [3, 2, 1], "a": {"n": None, "t": False}}
        self.assertEqual(jsonio.dumps(payload), jsonio.dumps(payload))

    def test_round_trips_byte_identically(self):
        text = jsonio.dumps({"b": [1, {"y": "x"}], "a": "v"})
        self.assertEqual(text, jsonio.dumps(jsonio.loads(text)))

    def test_encodes_to_utf8_bytes_ending_in_one_newline(self):
        raw = jsonio.dumps_bytes({"k": "café"})
        self.assertIsInstance(raw, bytes)
        self.assertTrue(raw.endswith(b"}\n"))
        self.assertEqual(raw.decode("utf-8"), jsonio.dumps({"k": "café"}))


class MalformedInputTest(unittest.TestCase):
    def test_malformed_json_raises_with_expected_vs_observed_detail(self):
        with self.assertRaises(jsonio.JsonError) as caught:
            jsonio.loads("{\n  \"a\": 1,\n}\n")
        message = str(caught.exception)
        self.assertIn("line", message.lower())

    def test_a_non_object_document_is_rejected(self):
        for document in ("[]", '"a"', "3", "null"):
            with self.assertRaises(jsonio.JsonError, msg=document):
                jsonio.loads(document)


class TemporalRuleTest(unittest.TestCase):
    """ADR-2: observation timestamps are banned everywhere. They change on
    every run, destroying render-and-diff and producing pure-churn commits."""

    def test_finds_a_banned_key_at_the_top_level(self):
        found = jsonio.observation_timestamps({"generatedAt": "2026-08-13"})
        self.assertEqual(["generatedAt"], [where for where, _ in found])

    def test_finds_banned_keys_nested_in_objects_and_arrays(self):
        document = {
            "recorded": [
                {"path": "AGENTS.md", "scannedAt": "2026-08-13"},
                {"path": "CLAUDE.md"},
            ],
            "scan": {"pending": [{"lastCheckedAt": 1}]},
        }
        wheres = sorted(where for where, _ in jsonio.observation_timestamps(document))
        self.assertEqual(
            ["recorded[0].scannedAt", "scan.pending[0].lastCheckedAt"], wheres
        )

    def test_all_three_named_keys_are_banned(self):
        for key in ("generatedAt", "lastCheckedAt", "scannedAt"):
            self.assertEqual(1, len(jsonio.observation_timestamps({key: "x"})), key)

    def test_a_version_identity_is_not_a_timestamp(self):
        document = {"renderer": "agents-md@1", "date": "2026-08-13"}
        self.assertEqual([], jsonio.observation_timestamps(document))


if __name__ == "__main__":
    unittest.main()
