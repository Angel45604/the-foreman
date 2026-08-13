"""Interpreter-floor assertion and the bytecode notice (ADR-1).

This module is imported by `__main__.py` before anything else, so it must be
parseable by every interpreter old enough to need the floor message. Nothing
newer than Python 3.6 syntax may appear here, and a test asserts it
(`test_bootstrap_and_main_parse_under_an_ancient_grammar`). Use `%`
formatting, not f-strings, and import nothing.
"""

CORE_VERSION = "0.1.0"

# ADR-1: the floor. Below this, the core refuses to run and says what it saw.
FLOOR = (3, 9)


def floor_failure(version_info):
    """Return a loud message if `version_info` is below the floor, else None."""
    observed = tuple(version_info)[:3]
    if tuple(observed[:2]) >= FLOOR:
        return None
    return (
        "the-steward: this core requires Python %d.%d or newer; "
        "the interpreter running it is %s. "
        "Re-run with a newer python3."
        % (FLOOR[0], FLOOR[1], ".".join([str(part) for part in observed]))
    )


def bytecode_notice(dont_write_bytecode):
    """Return the one-line notice when bytecode suppression is off, else None.

    `__main__` is compiled and cached before its first line runs, so nothing
    the core does at runtime can undo a bare invocation. The notice says so.
    It never changes the exit code: how the tool was launched is not a finding
    about the repository.
    """
    if dont_write_bytecode:
        return None
    return (
        "the-steward: bytecode suppression is off, so this interpreter has "
        "already cached __main__ next to the core. Re-run with -B (or "
        "PYTHONDONTWRITEBYTECODE=1) so a read-only verb writes nothing."
    )
