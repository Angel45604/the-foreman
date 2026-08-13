"""DEBT ITEM 9 — the grammar says ASCII whitespace; str.strip() says Unicode.

ADR-31 pins one whitespace rule: "a single `str.strip()` of ASCII whitespace at
each end". Python's argument-less `str.strip()` strips **Unicode** whitespace,
so the obvious implementation silently strips U+00A0 NO-BREAK SPACE, U+2009
THIN SPACE, U+3000 IDEOGRAPHIC SPACE and friends — characters that are part of
the value under the documented grammar.

These tests are the behavioral gap, stated as a difference: the first test
proves the stdlib does the wrong thing, so the rest cannot pass vacuously.
"""

import unittest

import _support as S

S.import_core()

import text  # noqa: E402

NBSP = " "
THIN_SPACE = " "
IDEOGRAPHIC_SPACE = "　"
NEXT_LINE = ""


class StdlibIsWrongForThisGrammarTest(unittest.TestCase):
    """The negative control. If these ever fail, the gap closed upstream."""

    def test_stdlib_strip_removes_unicode_whitespace(self):
        self.assertEqual("x", (NBSP + "x" + NBSP).strip())
        self.assertEqual("x", (THIN_SPACE + "x" + THIN_SPACE).strip())
        self.assertEqual("x", (IDEOGRAPHIC_SPACE + "x").strip())
        self.assertEqual("x", (NEXT_LINE + "x").strip())


class AsciiStripTest(unittest.TestCase):
    def test_keeps_unicode_whitespace(self):
        self.assertEqual(NBSP + "x" + NBSP, text.ascii_strip(NBSP + "x" + NBSP))
        self.assertEqual(
            THIN_SPACE + "x", text.ascii_strip(THIN_SPACE + "x")
        )
        self.assertEqual(
            "x" + IDEOGRAPHIC_SPACE, text.ascii_strip("x" + IDEOGRAPHIC_SPACE)
        )
        self.assertEqual(NEXT_LINE + "x", text.ascii_strip(NEXT_LINE + "x"))

    def test_strips_every_ascii_whitespace_character(self):
        for char in (" ", "\t", "\n", "\r", "\v", "\f"):
            self.assertEqual(
                "x", text.ascii_strip(char + "x" + char), repr(char)
            )

    def test_strips_mixed_runs_at_both_ends_only(self):
        self.assertEqual("a  b", text.ascii_strip("  \t a  b \n "))

    def test_ascii_whitespace_around_unicode_whitespace_is_stripped(self):
        # The ASCII run is at the end, so it goes; the NBSP is now the boundary
        # and stays, because a single pass strips ASCII only.
        self.assertEqual("x" + NBSP, text.ascii_strip("x" + NBSP + "  "))
        # ...and an interior ASCII space is never touched.
        self.assertEqual("a" + NBSP + " b", text.ascii_strip(" a" + NBSP + " b "))

    def test_all_whitespace_becomes_the_empty_string(self):
        self.assertEqual("", text.ascii_strip("   \t\n  "))
        self.assertEqual("", text.ascii_strip(""))

    def test_is_idempotent(self):
        once = text.ascii_strip("  a  ")
        self.assertEqual(once, text.ascii_strip(once))


class AsciiControlCharacterTest(unittest.TestCase):
    """ADR-32: U+0000–U+001F (CR, LF, TAB included) and U+007F are rejected in
    record values. Note the overlap with the strip set is deliberate — a value
    that strips to something containing one of these is still rejected."""

    def test_finds_the_first_control_character_and_its_index(self):
        self.assertIsNone(text.first_control_character("plain value"))
        self.assertEqual((0, 0), text.first_control_character("\x00abc"))
        self.assertEqual((9, 3), text.first_control_character("abc\tdef"))
        self.assertEqual((10, 3), text.first_control_character("abc\ndef"))
        self.assertEqual((13, 3), text.first_control_character("abc\rdef"))
        self.assertEqual((31, 1), text.first_control_character("a\x1fb"))
        self.assertEqual((127, 2), text.first_control_character("ab\x7f"))

    def test_non_ascii_and_markdown_characters_are_not_control_characters(self):
        for value in ("# heading-ish", "---", "a | b", "café", NBSP, "→"):
            self.assertIsNone(text.first_control_character(value), repr(value))


if __name__ == "__main__":
    unittest.main()
