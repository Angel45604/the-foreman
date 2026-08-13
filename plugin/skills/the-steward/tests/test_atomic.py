"""P1.10 — the atomic write helper (ADR-20).

Temp staged **at the repository root** (never in the target's own directory —
under `tools/steward/` a kill turns the leftover into a permanent foreign-child
collision), created exclusively with a random name via
`tempfile.mkstemp(dir=<repo root>, prefix='.steward-tmp-')`, `chmod` **before**
`os.replace` (verified: replace takes the source file's mode, and mkstemp hands
back 0600), and a cross-filesystem replace is exit 2 naming both paths.

**These are hostile-path tests, not concurrency tests.** v0 is single-writer
and concurrent `generate` runs are out of scope (ADR-20), so nothing here
asserts anything about two runs in one repository.
"""

import errno
import os
import shutil
import stat
import tempfile
import unittest

import _support as S

S.import_core()

import atomic  # noqa: E402
import paths  # noqa: E402


def read_bytes(path):
    with open(path, "rb") as handle:
        return handle.read()


class FixedNames(object):
    """Force `mkstemp` onto names we planted, so the exclusivity of the create
    is asserted as behavior rather than trusted from a flag list.

    **This patches a private stdlib API on purpose, and that is a known
    fragility, not a regression waiting to happen.**
    `tempfile._get_candidate_names` is the only seam that makes `mkstemp`
    land on a *chosen* name, and choosing the name is the whole fixture: the
    hostile-path tests must plant a file at the exact path the next create
    will try. There is no public equivalent — `dir=` and `prefix=` do not
    reach the random suffix.

    If a future CPython renames or removes it, these fixtures will fail with
    an `AttributeError` at `__enter__`, which is loud and correct. Read that
    as *the seam moved, re-point it*, not as *the writer broke*. The paired
    `used == ['.steward-tmp-SECOND']` control is what keeps them honest
    meanwhile: it fails if the patch silently stops taking effect.
    """

    def __init__(self, names):
        self.names = list(names)

    def __enter__(self):
        self.original = tempfile._get_candidate_names
        names = iter(self.names + ["fallback-%d" % n for n in range(50)])
        tempfile._get_candidate_names = lambda: names
        return self

    def __exit__(self, *exc):
        tempfile._get_candidate_names = self.original
        return False


class AtomicWriteTest(unittest.TestCase):
    def setUp(self):
        self.root = S.make_git_repo()
        self.addCleanup(shutil.rmtree, self.root, True)

    def leftovers(self):
        return sorted(
            name for name in os.listdir(self.root) if name.startswith(".steward-tmp-")
        )

    def test_writes_the_bytes_at_the_target(self):
        atomic.write(self.root, "AGENTS.md", b"routing\n")
        self.assertEqual(b"routing\n", read_bytes(os.path.join(self.root, "AGENTS.md")))

    def test_creates_missing_parent_directories(self):
        atomic.write(self.root, "docs/steward/orphans.md", b"none\n")
        self.assertTrue(
            os.path.isfile(os.path.join(self.root, "docs", "steward", "orphans.md"))
        )

    def test_leaves_no_temp_file_behind(self):
        atomic.write(self.root, "AGENTS.md", b"routing\n")
        self.assertEqual([], self.leftovers())

    def test_the_installed_file_is_readable_not_0600(self):
        """os.replace takes the SOURCE file's mode; mkstemp hands back 0600."""
        atomic.write(self.root, "AGENTS.md", b"routing\n")
        mode = stat.S_IMODE(os.stat(os.path.join(self.root, "AGENTS.md")).st_mode)
        self.assertEqual(0o644, mode, oct(mode))

    def test_an_explicit_mode_is_applied_before_the_rename(self):
        atomic.write(self.root, "hook", b"#!/bin/sh\n", mode=0o755)
        mode = stat.S_IMODE(os.stat(os.path.join(self.root, "hook")).st_mode)
        self.assertEqual(0o755, mode, oct(mode))

    def test_the_temp_file_is_staged_at_the_repository_root(self):
        seen = []
        original = atomic._mkstemp

        def spy(directory, prefix):
            seen.append(directory)
            return original(directory, prefix)

        atomic._mkstemp = spy
        try:
            atomic.write(self.root, "tools/steward/__main__.py", b"x\n")
        finally:
            atomic._mkstemp = original
        self.assertEqual([self.root], seen)


class HostilePathTest(unittest.TestCase):
    """A predictable `<pid>-<n>` staging name is a write primitive for someone
    else. These assert the behavior, not the flag list."""

    def setUp(self):
        self.root = S.make_git_repo()
        self.addCleanup(shutil.rmtree, self.root, True)
        self.outside = os.path.realpath(
            os.path.join(self.root, os.pardir, "steward-hostile-%d" % os.getpid())
        )
        os.makedirs(self.outside, exist_ok=True)
        self.addCleanup(shutil.rmtree, self.outside, True)
        self.victim = os.path.join(self.outside, "VICTIM.txt")
        with open(self.victim, "w", encoding="utf-8") as handle:
            handle.write("untouched\n")

    def write_with_planted_first_name(self):
        """Run one write over the planted name and report which name mkstemp
        actually landed on. Asserting that it landed on the SECOND name is
        what proves the fixture is sensitive: if mkstemp had truncated or
        followed the planted path, it would have landed on the first."""
        used = []
        original = atomic._mkstemp

        def spy(directory, prefix):
            handle, path = original(directory, prefix)
            used.append(os.path.basename(path))
            return handle, path

        atomic._mkstemp = spy
        try:
            with FixedNames(["PLANTED", "SECOND"]):
                atomic.write(self.root, "AGENTS.md", b"routing\n")
        finally:
            atomic._mkstemp = original
        self.assertEqual(
            [".steward-tmp-SECOND"],
            used,
            "mkstemp did not skip the planted name — the hostile-path "
            "fixtures below would be vacuously green",
        )
        self.assertEqual(b"routing\n", read_bytes(os.path.join(self.root, "AGENTS.md")))

    def test_a_regular_file_at_a_candidate_staging_path_is_never_truncated(self):
        planted = os.path.join(self.root, ".steward-tmp-PLANTED")
        with open(planted, "w", encoding="utf-8") as handle:
            handle.write("someone else's bytes\n")
        self.write_with_planted_first_name()
        self.assertEqual("someone else's bytes\n", S.read_text(planted))

    def test_a_symlink_at_a_candidate_staging_path_is_never_followed(self):
        planted = os.path.join(self.root, ".steward-tmp-PLANTED")
        os.symlink(self.victim, planted)
        self.write_with_planted_first_name()
        self.assertEqual("untouched\n", S.read_text(self.victim))
        self.assertTrue(os.path.islink(planted))

    def test_a_directory_at_a_candidate_staging_path_is_skipped(self):
        os.makedirs(os.path.join(self.root, ".steward-tmp-PLANTED"))
        self.write_with_planted_first_name()
        self.assertTrue(os.path.isdir(os.path.join(self.root, ".steward-tmp-PLANTED")))

    def test_the_planted_name_is_reached_when_nothing_occupies_it(self):
        """Negative control for the control: with nothing planted, mkstemp
        lands on the FIRST name, so 'landed on SECOND' above means something."""
        used = []
        original = atomic._mkstemp

        def spy(directory, prefix):
            handle, path = original(directory, prefix)
            used.append(os.path.basename(path))
            return handle, path

        atomic._mkstemp = spy
        try:
            with FixedNames(["PLANTED", "SECOND"]):
                atomic.write(self.root, "AGENTS.md", b"routing\n")
        finally:
            atomic._mkstemp = original
        self.assertEqual([".steward-tmp-PLANTED"], used)


class ContainmentTest(unittest.TestCase):
    """ADR-26: the core may write nothing outside the working tree, ever."""

    def setUp(self):
        self.root = S.make_git_repo()
        self.addCleanup(shutil.rmtree, self.root, True)
        self.outside = os.path.realpath(
            os.path.join(self.root, os.pardir, "steward-outside-w-%d" % os.getpid())
        )
        os.makedirs(self.outside, exist_ok=True)
        self.addCleanup(shutil.rmtree, self.outside, True)
        self.victim = os.path.join(self.outside, "VICTIM.txt")
        with open(self.victim, "w", encoding="utf-8") as handle:
            handle.write("untouched\n")

    def test_a_traversal_destination_is_refused(self):
        with self.assertRaises(paths.ContainmentError):
            atomic.write(self.root, "../VICTIM.txt", b"clobbered\n")
        self.assertEqual("untouched\n", S.read_text(self.victim))

    def test_an_absolute_destination_outside_the_tree_is_refused(self):
        with self.assertRaises(paths.ContainmentError):
            atomic.write(self.root, self.victim, b"clobbered\n")
        self.assertEqual("untouched\n", S.read_text(self.victim))

    def test_a_symlinked_directory_pointing_out_is_refused(self):
        os.symlink(self.outside, os.path.join(self.root, "docs"))
        with self.assertRaises(paths.ContainmentError):
            atomic.write(self.root, "docs/VICTIM.txt", b"clobbered\n")
        self.assertEqual("untouched\n", S.read_text(self.victim))

    def test_no_temp_file_survives_a_refusal(self):
        try:
            atomic.write(self.root, "../VICTIM.txt", b"x\n")
        except paths.ContainmentError:
            pass
        self.assertEqual(
            [],
            [n for n in os.listdir(self.root) if n.startswith(".steward-tmp-")],
        )


class WriteThroughAnInTreeSymlinkTest(unittest.TestCase):
    """DEBT ITEM 7, end to end **through the production writer**.

    `paths.target_is_writable_in_place` is the predicate and `test_paths.py`
    proves it. This class proves the one Phase-1 writer *calls* it, which is
    the whole point: a tested predicate with no production caller is presence,
    not firing. ADR-26 containment alone passes this attack — the link points
    back **inside** the tree — so without the second limb `atomic.write`
    follows it and clobbers a file the-steward never created.

    The scenario is FROZEN-DEBT.md #7 verbatim: a schema-valid *foreign*
    manifest records `AGENTS.md` with the digest of the bytes readable there,
    the digest check passes, and the write lands in `secrets.txt`.
    """

    def setUp(self):
        self.root = S.make_git_repo()
        self.addCleanup(shutil.rmtree, self.root, True)
        self.secret = os.path.join(self.root, "secrets.txt")
        with open(self.secret, "w", encoding="utf-8") as handle:
            handle.write("do not clobber me\n")
        self.link = os.path.join(self.root, "AGENTS.md")
        os.symlink("secrets.txt", self.link)

    def test_the_link_target_survives_the_write_byte_identical(self):
        """The safety property itself, asserted on the bytes rather than on
        the exception: whatever `write` decides to do, `secrets.txt` is not it."""
        try:
            atomic.write(self.root, "AGENTS.md", b"ROUTING FROM STEWARD\n")
        except atomic.AtomicWriteError:
            pass
        self.assertEqual("do not clobber me\n", S.read_text(self.secret))
        self.assertTrue(os.path.islink(self.link), "the link was replaced")
        self.assertEqual("secrets.txt", os.readlink(self.link))

    def test_the_write_is_refused_as_a_tool_failure_naming_the_symlink(self):
        with self.assertRaises(atomic.AtomicWriteError) as caught:
            atomic.write(self.root, "AGENTS.md", b"ROUTING FROM STEWARD\n")
        message = str(caught.exception)
        self.assertIn("AGENTS.md", message)
        self.assertIn("symlink", message)

    def test_an_absolute_destination_through_the_link_is_refused_too(self):
        """The same target named absolutely: `contain` resolves it to an
        in-tree path, so only the second limb can catch it."""
        with self.assertRaises(atomic.AtomicWriteError):
            atomic.write(self.root, self.link, b"ROUTING FROM STEWARD\n")
        self.assertEqual("do not clobber me\n", S.read_text(self.secret))

    def test_an_in_tree_symlinked_parent_directory_is_refused(self):
        os.makedirs(os.path.join(self.root, "real-docs"))
        os.symlink("real-docs", os.path.join(self.root, "docs"))
        with self.assertRaises(atomic.AtomicWriteError):
            atomic.write(self.root, "docs/steward/orphans.md", b"none\n")
        self.assertEqual([], os.listdir(os.path.join(self.root, "real-docs")))

    def test_no_temp_file_survives_the_refusal(self):
        try:
            atomic.write(self.root, "AGENTS.md", b"ROUTING FROM STEWARD\n")
        except atomic.AtomicWriteError:
            pass
        self.assertEqual(
            [],
            [n for n in os.listdir(self.root) if n.startswith(".steward-tmp-")],
        )

    def test_a_plain_target_beside_the_link_still_writes(self):
        """Negative control: the guard refuses symlinked targets, not writes."""
        atomic.write(self.root, "NOTES.md", b"ours\n")
        self.assertEqual(b"ours\n", read_bytes(os.path.join(self.root, "NOTES.md")))


class CrossFilesystemTest(unittest.TestCase):
    """A cross-filesystem `os.replace` raises OSError; ADR-20 says report it as
    exit 2 naming both paths, never a partial write. There is no second
    filesystem on this machine to move across, so EXDEV is injected and what is
    asserted is our handling of it."""

    def setUp(self):
        self.root = S.make_git_repo()
        self.addCleanup(shutil.rmtree, self.root, True)

    def test_exdev_is_a_tool_failure_naming_both_paths(self):
        original = os.replace

        def refuse(src, dst):
            raise OSError(errno.EXDEV, "Cross-device link", src, None, dst)

        os.replace = refuse
        try:
            with self.assertRaises(atomic.AtomicWriteError) as caught:
                atomic.write(self.root, "AGENTS.md", b"routing\n")
        finally:
            os.replace = original
        message = str(caught.exception)
        self.assertIn(".steward-tmp-", message)
        self.assertIn("AGENTS.md", message)

    def test_no_temp_file_survives_a_failed_replace(self):
        original = os.replace

        def refuse(src, dst):
            raise OSError(errno.EXDEV, "Cross-device link", src, None, dst)

        os.replace = refuse
        try:
            with self.assertRaises(atomic.AtomicWriteError):
                atomic.write(self.root, "AGENTS.md", b"routing\n")
        finally:
            os.replace = original
        self.assertEqual(
            [],
            [n for n in os.listdir(self.root) if n.startswith(".steward-tmp-")],
        )
        self.assertFalse(os.path.exists(os.path.join(self.root, "AGENTS.md")))


if __name__ == "__main__":
    unittest.main()
