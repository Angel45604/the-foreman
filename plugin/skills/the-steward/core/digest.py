"""Content digests: **SHA-256 over the whole file, in every case** (ADR-9).

**One comparison domain, and no optimization.** An earlier draft used the git
blob id on clean files and SHA-256 on dirty ones. That is two domains for one
question, and it made a byte-identical artifact compare unequal to itself
across `git add`: the tool reported bytes it had written as bytes it did not
recognize, which under ADR-20 is an `error` it then refuses to overwrite. The
fast path is deleted; the cost is hashing a few small files.

**Never `mtime`, and never a git blob id.** `mtime` is meaningless after any
fresh clone, in any linked worktree, and on every CI runner — a property of
git, not a measurement. This module therefore consults git for nothing at all;
it is pure bytes in, hex out, and the test that asserts it names no git symbol
anywhere in this file.

v0 has exactly two digest *operations* and this is the one function under both
(ADR-2): the **stored** digest (the artifact as we last wrote it, living in the
manifest) and the **recomputed** one (a fresh render, never stored).
"""

import hashlib

# Bounded reads, so a large artifact does not have to be resident to be
# hashed. It is a chunk size and nothing else — there is no size limit here,
# and no partial digest is ever returned.
READ_CHUNK_BYTES = 65536


def of_bytes(data):
    """SHA-256 of `data`, lowercase hex."""
    return hashlib.sha256(data).hexdigest()


def of_file(path):
    """SHA-256 of the whole file at `path`, lowercase hex.

    A missing or unreadable path raises `OSError` — never a sentinel digest,
    which would compare equal to something and quietly authorize a write.
    """
    accumulator = hashlib.sha256()
    with open(path, "rb") as handle:
        while True:
            chunk = handle.read(READ_CHUNK_BYTES)
            if not chunk:
                break
            accumulator.update(chunk)
    return accumulator.hexdigest()
