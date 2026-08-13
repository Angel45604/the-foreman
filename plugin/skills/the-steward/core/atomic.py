"""The atomic write helper (ADR-20).

One rule per line of it:

- the temp file is staged **at the repository root**, never in the target's own
  directory. Under `tools/steward/`, a kill between the create and the
  `os.replace` leaves an unrecorded child, which the next run reads as a
  foreign core — and under no-core-no-run every later `generate` then writes
  nothing at all, forever.
- the name is **random** and the create is **exclusive**. A predictable
  `.steward-tmp-<pid>-<n>` is a write primitive for somebody else: plant a
  symlink at the next name and the write is redirected out of the tree before
  the rename. `tempfile.mkstemp` opens with `O_CREAT|O_EXCL` (plus `O_NOFOLLOW`
  where the platform has it), so it never opens, follows or truncates a path
  that already exists.
- **chmod before the rename.** `os.replace` gives the installed file the
  *source* file's mode, and `mkstemp` hands back `0600`.
- a cross-filesystem `os.replace` raises `OSError`; it is reported as a tool
  failure naming both paths, never as a partial write.
- **the destination may not cross a symlink** (DEBT ITEM 7). Containment alone
  does not close this: `paths.contain` resolves the link, and an *in-tree*
  symlink resolves to an in-tree path, so `AGENTS.md -> secrets.txt` passes
  ADR-26 and the write lands in a file we never created. The predicate is
  `paths.target_is_writable_in_place`, and this is the call site that makes it
  hold rather than merely exist.

Installation is not atomic and v0 does not claim it is: `rename()` is atomic
per file, and there is no multi-file commit primitive at the 3.9 floor.
"""

import os
import tempfile

import paths

TEMP_PREFIX = ".steward-tmp-"
DEFAULT_MODE = 0o644


class AtomicWriteError(Exception):
    """The write could not be completed (exit 2)."""


def _mkstemp(directory, prefix):
    """Seam for the hostile-path fixtures; behaves exactly as mkstemp."""
    return tempfile.mkstemp(dir=directory, prefix=prefix)


def write(root, relpath, data, mode=DEFAULT_MODE):
    """Atomically place `data` at `relpath` inside `root`.

    `relpath` is repository data, so it is contained first (ADR-26): a
    destination that escapes the working tree is refused before anything is
    created, and nothing outside the tree is ever written.

    Then the second limb (DEBT ITEM 7): the component chain must cross no
    symlink. `contain` cannot see this — it hands back the *resolved* path, by
    which point `AGENTS.md -> secrets.txt` has already become `secrets.txt`.
    Crossing one is a **tool failure**, not a silent skip: whether a target is
    ours is the caller's classification to make with the same predicate before
    it ever calls a writer (ADR-20), so a writer reaching a symlinked path is a
    bug in the caller, and a bug must never read as a pass (ADR-13).
    """
    destination = paths.contain(root, relpath)
    real_root = os.path.realpath(root)

    # The *requested* path, not the resolved one: resolution is what hides the
    # link. `contain` above has already refused anything outside the tree, so a
    # relative form computed here can only point back inside it.
    requested = (
        os.path.relpath(relpath, real_root) if os.path.isabs(relpath) else relpath
    )
    if not paths.target_is_writable_in_place(root, requested):
        raise AtomicWriteError(
            "the-steward: %r crosses a symlink inside %r. Refusing to write "
            "through it — the bytes would land at %r, which the-steward did "
            "not create, and create-only never overwrites what it did not "
            "create (ADR-20). Nothing was written."
            % (requested, real_root, destination)
        )

    parent = os.path.dirname(destination)
    if parent and not os.path.isdir(parent):
        paths.contain(root, parent)
        os.makedirs(parent, exist_ok=True)

    handle, temp_path = _mkstemp(real_root, TEMP_PREFIX)
    try:
        with os.fdopen(handle, "wb") as stream:
            stream.write(data)
        os.chmod(temp_path, mode)
        os.replace(temp_path, destination)
    except OSError as exc:
        _remove_quietly(temp_path)
        raise AtomicWriteError(
            "the-steward: could not place %r at %r: %s. Nothing was written "
            "there." % (temp_path, destination, exc)
        )
    except BaseException:
        _remove_quietly(temp_path)
        raise


def _remove_quietly(path):
    try:
        os.unlink(path)
    except OSError:
        pass
