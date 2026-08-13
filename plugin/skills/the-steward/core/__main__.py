"""the-steward core entry point.

Run it as a directory, always with -B (ADR-1):

    python3 -B tools/steward {scan|generate|check|doctor}

Nothing newer than Python 3.6 syntax may appear in this file: it is compiled
in full before its first line runs, so a syntax error here would replace the
floor message with a traceback on exactly the interpreters that need the
message. A test asserts the grammar.
"""

import sys

import bootstrap

# The floor assertion is the first action (ADR-1).
_failure = bootstrap.floor_failure(sys.version_info)
if _failure is not None:
    sys.stderr.write(_failure + "\n")
    sys.exit(2)

# Read the flag BEFORE the belt-and-braces assignment below; assigning first
# would make this notice unfireable (ADR-1). It never changes the exit code.
_notice = bootstrap.bytecode_notice(sys.dont_write_bytecode)
if _notice is not None:
    sys.stderr.write(_notice + "\n")

# Belt and braces only. It cannot suppress __main__'s own cache, which is why
# -B is part of the invocation.
sys.dont_write_bytecode = True

import cli  # noqa: E402  (must not run before the floor assertion)

sys.exit(cli.main(sys.argv[1:], sys.stdout, sys.stderr))
