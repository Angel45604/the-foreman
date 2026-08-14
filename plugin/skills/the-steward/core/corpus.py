"""Corpus enumeration over the document predicate (ADR-10).

**A document is a tracked `*.md` path that git does not mark as vendored or
generated** — two conditions and no taste — **unioned with the documents the
manifest records as `rendered`** (never `copied`, ADR-2), deduped and sorted.

Three things this module is careful about, each of which has already been got
wrong somewhere:

1. **`find` is never used.** In the reference repo `find . -name '*.md'`
   returns 175,944 paths against `git ls-files '*.md'`'s 1,091, and that
   repo's `find`-based builder now dies with `ENOBUFS`
   (`verified-contracts.md` §2.3.11, rows 1 and 6). Exceeding the output cap
   is **exit 2 naming the cap** (ADR-13), never a truncated corpus reported as
   checked.
2. **The attribute test is an allowlist, not a match on the word `set`.** git
   reports four states plus arbitrary values; `set`, `=true` and `=vendor` are
   all somebody's deliberate marker, and only `unspecified` / `unset` /
   `false` leave a path in the corpus.
3. **Two corpora, one fixed exclusion.** The **checking** corpus is the union
   above; the **source** corpus the indexes render from is that corpus minus
   the two index outputs. The exclusion lives here, on the enumerator, so an
   index can never become its own input — without it, first generation renders
   one graph and the immediate re-render sees the two files just written and
   renders another, so C4 reports freshly generated output as stale.

The corpus serves **C3, C4 and the indexes only**. C1 and C2 never read it:
their claims come from the manifest's two record sets (ADR-32).
"""

import os

import paths

DOCUMENT_SUFFIX = ".md"

# ADR-10's document predicate, as a pathspec plus an attribute allowlist.
DOCUMENT_PATHSPEC = "*" + DOCUMENT_SUFFIX
DOCUMENT_ATTRIBUTES = ("linguist-vendored", "linguist-generated")

# The only states that leave a path in the corpus. Verified against git 2.50.1:
# a bare attribute reports `set`, `=true` reports `true`, `=vendor` reports
# `vendor`, `-name` reports `unset`, `=false` reports `false`, and no matching
# rule reports `unspecified`. Matching the literal word `set` instead would
# admit every valued form, which is the bug this allowlist exists to prevent.
UNMARKED_ATTRIBUTE_STATES = ("false", "unset", "unspecified")

# ADR-20 fixes both index paths as part of the contract; ADR-10 excludes
# exactly these two from the source corpus. A fixed pair, never a heuristic.
INDEX_PATHS = ("docs/steward/orphans.md", "docs/steward/routing-map.md")

# ADR-2's two recorded kinds. Only `rendered` can be a document: `copied` bytes
# have no renderer, so C4 has nothing to re-render for them.
RENDERED_KIND = "rendered"


class Corpus(object):
    """What one enumeration found.

    `documents` — the **checking** corpus (C3, C4).
    `source`    — the **source** corpus the indexes render from.
    `missing_recorded` — recorded `rendered` documents that are not on disk.
        They are not documents, because there are no bytes to read; they are
        carried out of here rather than dropped, because a silently dropped
        path hides a real edge and manufactures a false orphan (ADR-28). The
        `warn` for them is ADR-13's.
    """

    def __init__(self, documents, missing_recorded):
        self.documents = tuple(documents)
        self.source = tuple(
            path for path in self.documents if path not in INDEX_PATHS
        )
        self.missing_recorded = tuple(missing_recorded)


def _decode(raw):
    return raw.decode("utf-8", "surrogateescape")


def _encode(value):
    return value.encode("utf-8", "surrogateescape")


def _nul_fields(raw):
    return [field for field in _decode(raw).split("\0") if field]


def tracked_documents(root):
    """Every tracked `*.md` path, repository-relative.

    `root` is the repository root and is used as the child's cwd, because
    `git ls-files` prints paths relative to **CWD** — run from a subdirectory
    it would answer a different question.
    """
    return _nul_fields(
        paths.git_checked(root, ["ls-files", "-z", "--", DOCUMENT_PATHSPEC])
    )


def unmarked_by_git(root, candidates):
    """The candidates git marks neither vendored nor generated (ADR-10).

    Paths are fed on **stdin**, not on the command line: a corpus large enough
    to matter is a corpus large enough to blow past `ARG_MAX`. `check-attr`
    answers for untracked and even nonexistent paths, which is what lets a
    freshly generated artifact face the same predicate as a tracked one.
    """
    if not candidates:
        return []
    out = paths.git_checked(
        root,
        ["check-attr", "-z", "--stdin"] + list(DOCUMENT_ATTRIBUTES),
        stdin=_encode("\0".join(candidates) + "\0"),
    )
    fields = _decode(out).split("\0")
    marked = set()
    # `-z` output is a flat run of (path, attribute, state) triples.
    for index in range(0, len(fields) - 2, 3):
        path, _attribute, state = fields[index], fields[index + 1], fields[index + 2]
        if state not in UNMARKED_ATTRIBUTE_STATES:
            marked.add(path)
    return [path for path in candidates if path not in marked]


def recorded_documents(document):
    """The manifest's `rendered` paths that could be documents (ADR-2, ADR-10).

    `copied` paths are excluded here and nowhere else, so there is one place to
    read the rule. A `rendered` artifact that is not a `*.md` — `.gitattributes`
    — is not a document either.
    """
    if not document:
        return []
    found = []
    for record in document.get("recorded", []):
        if record.get("kind") != RENDERED_KIND:
            continue
        path = record.get("path")
        if isinstance(path, str) and path.endswith(DOCUMENT_SUFFIX):
            found.append(path)
    return found


def document_location(root, relpath):
    """The **one** door from a corpus path to a filesystem path (ADR-26).

    Every corpus path arrives from somewhere untrusted — git's index, or a
    manifest record — and both can name a symlink. `os.path.join` plus
    `os.path.isfile` was the shape here, and `isfile` **follows symlinks**: it
    answers about whatever is at the far end, so a tracked `leak.md ->
    /elsewhere/secret.md`, or any path under a symlinked `docs/`, resolved
    outside the working tree and entered the corpus — which C3, C4 and the
    indexes then read, render and digest. That is the same symlink hole
    already closed on the atomic-write path and in the containment predicate,
    arriving a third time because the join was open-coded.

    `paths.contain` resolves the candidate and proves it is inside the tree,
    raising ContainmentError (exit 2) when it is not. It returns the
    **resolved** path, so a caller reading through this door reads the file
    containment was proved about rather than re-deriving one.
    """
    return paths.contain(root, relpath.replace("/", os.sep))


def enumerate_documents(root, document=None):
    """The checking corpus, the source corpus, and what went missing.

    Enumeration is read-only and spawns exactly two git commands.
    """
    from_records = set(recorded_documents(document))
    candidates = set(tracked_documents(root)) | from_records
    unmarked = unmarked_by_git(root, sorted(candidates))

    present, missing = [], []
    for path in unmarked:
        full = document_location(root, path)
        if os.path.isfile(full):
            present.append(path)
        elif path in from_records:
            # A path we recorded writing and that is no longer there. Carried
            # out rather than dropped (ADR-28); ADR-13 makes it a `warn`. A
            # *tracked* path missing from the working tree is a different
            # thing — an ordinary uncommitted deletion, which git already
            # reports and the-steward makes no claim about.
            missing.append(path)
    return Corpus(present, missing)
