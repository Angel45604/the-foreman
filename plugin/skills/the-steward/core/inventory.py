"""The packaged core declares its own inventory (ADR-20).

`generate` copies **this list**, never a directory walk. Walking
`Path(__file__).parent` would vendor whatever happens to be sitting there: a
`__pycache__/` a bare invocation created, an editor backup, a test scratch
file. A test asserts this tuple equals the packaged directory's actual
contents, so adding a module without listing it fails in our repo rather than
shipping a core missing a file.

Sorted, relative to the core directory, POSIX separators.
"""

FILES = (
    "__main__.py",
    "atomic.py",
    "bootstrap.py",
    "cli.py",
    "findings.py",
    "inventory.py",
    "jsonio.py",
    "manifest.py",
    "manifest.v1.json",
    "paths.py",
    "text.py",
)
