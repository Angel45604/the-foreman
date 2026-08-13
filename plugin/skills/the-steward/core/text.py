"""ASCII-only text rules (ADR-31, ADR-32).

**Why this module exists.** ADR-31 specifies "a single `str.strip()` of ASCII
whitespace at each end". Python's argument-less `str.strip()` strips *Unicode*
whitespace: `"\\u00a0x".strip() == "x"`. Under the documented grammar a
NO-BREAK SPACE is an ordinary character of the value, so the stdlib default is
the wrong function. It is spelled out here once, and every caller uses it —
the frontmatter parser (C3) and the manifest's record-value representability
rule both.
"""

# The C-locale ASCII whitespace set, and nothing else. Note that Python
# considers U+001C..U+001F whitespace too; they are ASCII control characters,
# which `first_control_character` rejects outright in record values.
ASCII_WHITESPACE = " \t\n\r\v\f"


def ascii_strip(value):
    """Strip ASCII whitespace from both ends. Never Unicode whitespace."""
    return value.strip(ASCII_WHITESPACE)


def first_control_character(value):
    """Return (codepoint, index) of the first ASCII control character, or None.

    ADR-32: U+0000–U+001F (CR, LF and TAB included) and U+007F may not appear
    in a command or path record value — a value carrying a line break would
    silently become two claims in the rendered one-item-per-line sections.
    """
    for index, char in enumerate(value):
        point = ord(char)
        if point <= 0x1F or point == 0x7F:
            return (point, index)
    return None
