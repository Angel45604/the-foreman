"""P1.9 — the containment predicate (ADR-26) and DEBT ITEM 7.

ADR-26: every path of **repository data** the core reads or writes must
resolve, after symlink resolution, inside `git rev-parse --show-toplevel`.
Escape is exit 2. The repo root always comes from cwd via git, never from the
core's own location.

DEBT ITEM 7 (safety, FROZEN-DEBT.md #7) — "Ownership compares recorded vs
on-disk bytes only, so a schema-valid foreign manifest can record an IN-TREE
SYMLINK and pass the digest check." Resolving symlinks is not enough on its
own: an in-tree symlink resolves to an in-tree path and passes ADR-26. The
second limb is therefore required — a target whose **path component chain
crosses a symlink** is never writable in place. `TargetIsSymlinkedTest` builds
the exact attack and shows the digest check alone waving it through.
"""

import errno
import hashlib
import io
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import unittest

import _support as S

S.import_core()

import atomic  # noqa: E402
import cli  # noqa: E402
import corpus  # noqa: E402
import paths  # noqa: E402


def sha256_of(path):
    with open(path, "rb") as handle:
        return hashlib.sha256(handle.read()).hexdigest()


class RepoRootTest(unittest.TestCase):
    def setUp(self):
        self.root = S.make_git_repo()
        self.addCleanup(shutil.rmtree, self.root, True)

    def test_resolves_from_cwd(self):
        self.assertEqual(self.root, paths.repo_root(self.root))

    def test_resolves_from_a_subdirectory(self):
        nested = os.path.join(self.root, "a", "b")
        os.makedirs(nested)
        self.assertEqual(self.root, paths.repo_root(nested))

    def test_returns_none_outside_a_repository(self):
        """The environment guard must consult **git**, not `repo_root`.

        Guarding with `if paths.repo_root(outside) is not None: skipTest(...)`
        and then asserting the same call is None is unfailable: the subject
        under test decides whether its own assertion runs, so a `repo_root`
        that always returns a path skips instead of failing. Git is the
        independent oracle for the environment fact.
        """
        outside = os.path.realpath(
            os.path.join(self.root, os.pardir, "definitely-not-a-repo-%d" % os.getpid())
        )
        os.makedirs(outside)
        self.addCleanup(shutil.rmtree, outside, True)
        if S.git(outside, "rev-parse", "--show-toplevel").returncode == 0:
            self.skipTest("the system temp dir is itself inside a git repository")
        self.assertIsNone(paths.repo_root(outside))


class RepoRootProbeFailureTest(unittest.TestCase):
    """`repo_root` may answer *None* off a **status**, never off a **fault**.

    The status branch is a documented ambiguity and stays: `git rev-parse
    --show-toplevel` exits **128** outside a repository *and* on a repository
    git cannot read, and no status separates them (probed on git 2.50.1: a
    garbage `GIT_CONFIG_GLOBAL` exits 128 for `rev-parse`, `config --get` and
    `ls-files` alike). Forcing that one into a fault would make *not a
    repository* — a first-class, reported state — unreachable.

    What was never ambiguous is everything that is **not a status**. `git`
    missing from `PATH`, a child that timed out, output over ADR-10's cap:
    none of those is evidence about whether cwd is inside a repository, and
    `except (OSError, subprocess.SubprocessError, OutputCapExceeded, ...):
    return None` turned each of them into `doctor` printing *this directory is
    not inside a git repository* and exiting **0** — a green report produced by
    never having run git at all.
    """

    def setUp(self):
        self.root = S.make_git_repo()
        self.addCleanup(shutil.rmtree, self.root, True)

    def test_a_missing_git_faults_rather_than_reading_not_a_repository(self):
        original = os.environ.get("PATH", "")
        self.addCleanup(os.environ.__setitem__, "PATH", original)
        os.environ["PATH"] = os.path.join(self.root, "no-git-here")
        with self.assertRaises(paths.GitCommandFailed) as caught:
            paths.repo_root(self.root)
        self.assertIn("rev-parse", str(caught.exception))
        self.assertIn("git", str(caught.exception))

    def test_a_cap_breach_faults_rather_than_reading_not_a_repository(self):
        """ADR-10's cap is a fault everywhere else; here it was swallowed."""
        original = paths.GIT_OUTPUT_CAP_BYTES
        self.addCleanup(setattr, paths, "GIT_OUTPUT_CAP_BYTES", original)
        paths.GIT_OUTPUT_CAP_BYTES = 1
        with self.assertRaises(paths.OutputCapExceeded):
            paths.repo_root(self.root)

    def test_it_exits_two_through_the_cli_without_a_traceback(self):
        original = os.environ.get("PATH", "")
        self.addCleanup(os.environ.__setitem__, "PATH", original)
        os.environ["PATH"] = os.path.join(self.root, "no-git-here")
        out, err = io.StringIO(), io.StringIO()
        code = cli.main(["doctor"], out, err, cwd=self.root)
        self.assertEqual(2, code, out.getvalue() + err.getvalue())
        self.assertNotIn("Traceback", err.getvalue(), "a predicted fault crashed")
        self.assertNotIn(
            "not inside a git repository",
            out.getvalue(),
            "it reported an environment fact it never established",
        )

    def test_a_real_status_of_128_is_still_the_answer_none(self):
        """Non-vacuity: the documented ambiguity must stay reachable."""
        outside = os.path.realpath(
            os.path.join(self.root, os.pardir, "steward-root-probe-%d" % os.getpid())
        )
        os.makedirs(outside, exist_ok=True)
        self.addCleanup(shutil.rmtree, outside, True)
        probe = S.git(outside, "rev-parse", "--show-toplevel")
        if probe.returncode == 0:
            self.skipTest("the system temp dir is itself inside a git repository")
        self.assertEqual(128, probe.returncode)
        self.assertIsNone(paths.repo_root(outside))


class GitAnsweredTest(unittest.TestCase):
    """One place decides what a git exit status *means* (ADR-13).

    `git_checked` is the `answers=(0,)` case and `git_answered` is the general
    one, because some commands answer with a status: `check-ignore -q` says
    *matched* with 0 and *no rule matches* with 1. What both refuse is the
    third reading — `if code != 0`, which collapses *no* and *the probe
    failed* into one value and lets a broken invocation be reported as a
    finding-free result. Exercised against real git, with real failures.
    """

    def setUp(self):
        self.root = S.make_git_repo()
        self.addCleanup(shutil.rmtree, self.root, True)

    def test_a_status_in_answers_is_returned_not_raised(self):
        code, _out = paths.git_answered(
            self.root, ["check-ignore", "-q", "--no-index", "--", "plain.md"], (0, 1)
        )
        self.assertEqual(1, code, "git stopped using 1 for `no rule matches`")

    def test_a_status_outside_answers_faults(self):
        with self.assertRaises(paths.GitCommandFailed) as caught:
            paths.git_answered(
                self.root,
                ["check-ignore", "-q", "--no-index", "--", "../outside.md"],
                (0, 1),
            )
        message = str(caught.exception)
        self.assertIn("check-ignore", message)
        self.assertIn("128", message)

    def test_git_checked_is_the_zero_only_case(self):
        """Same real failure, admitted by neither: `ls-files` has no non-zero
        answer at all."""
        with self.assertRaises(paths.GitCommandFailed) as caught:
            paths.git_checked(self.root, ["ls-files", "-z", "--", "../outside.md"])
        self.assertIn("ls-files", str(caught.exception))

    def test_git_checked_returns_stdout_on_success(self):
        out = paths.git_checked(self.root, ["ls-files", "-z", "--", "*.md"])
        self.assertEqual(b"README.md\0", out)


# A blob big enough that buffering it whole is unmistakable in `ru_maxrss`,
# and a cap far below it. The blob is one repeated byte, so the object store
# holds a few kilobytes and only the *stream* is large.
CAP_PROBE_BLOB_BYTES = 192 * 1024 * 1024
CAP_PROBE_CAP_BYTES = 1024 * 1024
# Peak RSS the child is allowed above its own pre-git baseline. Generous by
# two orders of magnitude against the blob, and an implementation that
# buffers the stream cannot fit under it.
CAP_PROBE_HEADROOM_BYTES = 48 * 1024 * 1024

_CAP_PROBE = """
import resource, sys
sys.path.insert(0, sys.argv[1])
import paths
paths.GIT_OUTPUT_CAP_BYTES = int(sys.argv[4])
baseline = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
try:
    paths.git_checked(sys.argv[2], ["cat-file", "blob", sys.argv[3]])
    outcome = "returned-a-result"
except paths.OutputCapExceeded:
    outcome = "OutputCapExceeded"
except MemoryError:
    outcome = "MemoryError"
except BaseException as exc:
    outcome = type(exc).__name__
peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
print(outcome)
print(peak - baseline)
"""


class OutputCapTest(unittest.TestCase):
    """ADR-18/ADR-10: the cap is a **bound on what is read**, both pipes.

    The shape this replaces measured `len(completed.stdout)` — that is, it
    asked how big the output was *after* `subprocess.run` had already
    materialised all of it in this process. A cap checked after the fact
    reports the breach it was supposed to prevent, and `stderr` was not
    measured at all, so the one stream a failing git command makes large was
    unbounded outright.
    """

    def setUp(self):
        self.root = S.make_git_repo()
        self.addCleanup(shutil.rmtree, self.root, True)

    def lower_the_cap(self, value):
        original = paths.GIT_OUTPUT_CAP_BYTES
        self.addCleanup(setattr, paths, "GIT_OUTPUT_CAP_BYTES", original)
        paths.GIT_OUTPUT_CAP_BYTES = value

    def noisy_attributes(self, lines=500):
        """A repo whose every `check-attr` writes a warning per bad line.

        `b@d` is not a valid attribute name, so git warns and carries on: the
        command **succeeds** with a small stdout and a large stderr, which is
        exactly the case an stdout-only cap cannot see.
        """
        body = "".join("p%d.md b@d%d\n" % (i, i) for i in range(lines))
        with open(
            os.path.join(self.root, ".gitattributes"), "w", encoding="utf-8"
        ) as handle:
            handle.write(body)

    def test_an_oversized_stdout_faults(self):
        self.lower_the_cap(4)
        with self.assertRaises(paths.OutputCapExceeded) as caught:
            paths.git_checked(self.root, ["ls-files", "-z", "--", "*.md"])
        self.assertIn("ls-files", str(caught.exception))

    def test_an_oversized_stderr_faults(self):
        """git succeeded and its stdout is tiny; the flood is on stderr."""
        self.noisy_attributes()
        control = S.git(self.root, "check-attr", "-a", "README.md")
        self.assertGreater(
            len(control.stderr), 4096, "git stopped warning — the fixture is inert"
        )
        self.lower_the_cap(4096)
        with self.assertRaises(paths.OutputCapExceeded) as caught:
            paths.git_checked(
                self.root,
                ["check-attr", "-z", "--stdin", "linguist-generated"],
                stdin=b"README.md\0",
            )
        self.assertIn("check-attr", str(caught.exception))

    def test_the_stream_is_bounded_as_it_is_read_not_after(self):
        """The finding itself: a cap enforced after `subprocess.run` returns
        has already paid the memory it exists to refuse.

        Measured in a **fresh child**, because `ru_maxrss` is a high-water
        mark: in this process an earlier test could have set it above the
        threshold and the assertion would be vacuous.
        """
        if sys.platform != "darwin":
            self.skipTest("ru_maxrss is only in bytes on darwin (%s)" % sys.platform)
        blob = subprocess.run(
            ["git", "hash-object", "-w", "--stdin"],
            cwd=self.root,
            input=b"s" * CAP_PROBE_BLOB_BYTES,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        self.assertEqual(0, blob.returncode, blob.stderr.decode("utf-8", "replace"))
        sha = blob.stdout.decode("ascii").strip()

        probe = subprocess.run(
            [
                sys.executable,
                "-B",
                "-c",
                _CAP_PROBE,
                S.CORE_DIR,
                self.root,
                sha,
                str(CAP_PROBE_CAP_BYTES),
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        self.assertEqual(
            0, probe.returncode, probe.stderr.decode("utf-8", "replace")[-4000:]
        )
        outcome, peak = probe.stdout.decode("utf-8").split()
        self.assertEqual(
            "OutputCapExceeded",
            outcome,
            "a %d-byte stream under a %d-byte cap produced %r"
            % (CAP_PROBE_BLOB_BYTES, CAP_PROBE_CAP_BYTES, outcome),
        )
        self.assertLess(
            int(peak),
            CAP_PROBE_HEADROOM_BYTES,
            "the child's peak RSS grew by %s bytes reading a %d-byte stream "
            "under a %d-byte cap — the whole stream was buffered before the "
            "cap was consulted" % (peak, CAP_PROBE_BLOB_BYTES, CAP_PROBE_CAP_BYTES),
        )

    def test_a_breach_returns_no_partial_result(self):
        self.lower_the_cap(4)
        for call in (
            lambda: paths.git_output(self.root, ["ls-files", "-z", "--", "*.md"]),
            lambda: paths.git_answered(
                self.root, ["ls-files", "-z", "--", "*.md"], (0,)
            ),
            lambda: paths.git_checked(self.root, ["ls-files", "-z", "--", "*.md"]),
        ):
            with self.assertRaises(paths.OutputCapExceeded):
                call()

    def test_a_stream_at_the_cap_is_still_an_answer(self):
        """Non-vacuity in the other direction: the bound is `>`, not `>=`,
        and an ordinary read must not start failing."""
        expected = b"README.md\0"
        self.lower_the_cap(len(expected))
        self.assertEqual(
            expected, paths.git_checked(self.root, ["ls-files", "-z", "--", "*.md"])
        )

    def test_a_timeout_is_still_a_fault_not_an_answer(self):
        original = paths.GIT_TIMEOUT_SECONDS
        self.addCleanup(setattr, paths, "GIT_TIMEOUT_SECONDS", original)
        paths.GIT_TIMEOUT_SECONDS = 0.000001
        with self.assertRaises(paths.GitCommandFailed) as caught:
            paths.git_checked(self.root, ["ls-files", "-z", "--", "*.md"])
        self.assertIn("ls-files", str(caught.exception))


class _FlakyPipe(object):
    """A pipe that fails partway through, the way a real one can.

    Wraps the child's real pipe and delegates, so everything up to the
    injected error is genuine git output — which is the point: the failure
    mode being reproduced is *truncation*, not absence.
    """

    def __init__(self, real, reads_before_failing):
        self.real = real
        self.left = reads_before_failing
        self.wrote = 0

    def read(self, size):
        if self.left <= 0:
            raise OSError(errno.EIO, "injected read failure")
        self.left -= 1
        return self.real.read(size)

    def write(self, payload):
        if self.left <= 0:
            raise OSError(errno.EPIPE, "injected write failure")
        self.left -= 1
        self.wrote += len(payload)
        return self.real.write(payload)

    def flush(self):
        return self.real.flush()

    def close(self):
        return self.real.close()


class _ShimSubprocess(object):
    """`paths.subprocess`, with the child's pipes wrapped on the way out.

    The module under test is untouched: it spawns the same git, reads the
    same pipes and takes the same branches. Only the file objects the kernel
    handed back are replaced, which is the one seam where a pipe failure
    genuinely originates.
    """

    def __init__(self, real, wrap):
        self.real = real
        self.wrap = wrap
        self.PIPE = real.PIPE
        self.SubprocessError = real.SubprocessError
        self.TimeoutExpired = real.TimeoutExpired

    def Popen(self, *args, **keywords):
        child = self.real.Popen(*args, **keywords)
        self.wrap(child)
        return child


class PartialPipeIsNeverAnAnswerTest(unittest.TestCase):
    """A pipe that failed is a **fault**, never a shorter answer (ADR-13).

    The bounded reader that fixed the 504 MiB buffering bug introduced this
    one layer down. `_BoundedReader.run` caught **every** `OSError`/
    `ValueError` and returned, and `_feed` swallowed write failures the same
    way, both on the honest-looking grounds that the error is usually the
    kill this class asked for. But that reasoning only holds when a cap
    breach or a timeout was actually recorded. With neither set, `_run`
    returned a **successful** `_Completed` carrying truncated stdout, or a
    successful result over stdin git never received — and `corpus`
    enumerates over exactly those two calls. That is ADR-13/ADR-30's false
    answer with our own plumbing as the cause: an `ls-files` cut off after
    one chunk reads as a repository with four documents in it.
    """

    def setUp(self):
        self.root = S.make_git_repo()
        self.addCleanup(shutil.rmtree, self.root, True)
        for name in ("a.md", "b.md", "c.md", "d.md"):
            with open(os.path.join(self.root, name), "w", encoding="utf-8") as handle:
                handle.write("# %s\n" % name)
        S.git(self.root, "add", "-A")
        S.git(self.root, "commit", "-q", "-m", "docs")

    def small_chunks(self, size=4):
        original = paths._READ_CHUNK_BYTES
        self.addCleanup(setattr, paths, "_READ_CHUNK_BYTES", original)
        paths._READ_CHUNK_BYTES = size

    def inject(self, wrap):
        original = paths.subprocess
        self.addCleanup(setattr, paths, "subprocess", original)
        paths.subprocess = _ShimSubprocess(original, wrap)

    def fail_stdout_after(self, reads):
        def wrap(child):
            child.stdout = _FlakyPipe(child.stdout, reads)

        self.inject(wrap)

    def fail_stderr_after(self, reads):
        def wrap(child):
            child.stderr = _FlakyPipe(child.stderr, reads)

        self.inject(wrap)

    def fail_stdin_after(self, writes):
        def wrap(child):
            child.stdin = _FlakyPipe(child.stdin, writes)

        self.inject(wrap)

    # -- the control -----------------------------------------------------
    def test_the_uninjected_control_reads_the_whole_corpus(self):
        """Without this the assertions below could pass for any reason."""
        self.small_chunks()
        self.assertEqual(
            ["README.md", "a.md", "b.md", "c.md", "d.md"],
            sorted(corpus.tracked_documents(self.root)),
        )

    # -- readers ---------------------------------------------------------
    def test_a_truncated_stdout_faults_rather_than_answering_short(self):
        self.small_chunks()
        self.fail_stdout_after(1)
        with self.assertRaises(paths.GitCommandFailed) as caught:
            paths.git_checked(self.root, ["ls-files", "-z", "--", "*.md"])
        message = str(caught.exception)
        self.assertIn("ls-files", message)
        self.assertIn("stdout", message)
        self.assertIn(
            "injected read failure",
            message,
            "the fault is reported without saying what the pipe did",
        )

    def test_a_failed_stderr_read_faults_too(self):
        """stderr is where a *failing* git says why; a short one is still a
        result nobody read whole."""
        self.small_chunks()
        self.fail_stderr_after(0)
        with self.assertRaises(paths.GitCommandFailed) as caught:
            paths.git_checked(self.root, ["ls-files", "-z", "--", "*.md"])
        self.assertIn("stderr", str(caught.exception))

    def test_no_partial_result_reaches_any_of_the_three_primitives(self):
        for call in (
            lambda: paths.git_output(self.root, ["ls-files", "-z", "--", "*.md"]),
            lambda: paths.git_answered(
                self.root, ["ls-files", "-z", "--", "*.md"], (0,)
            ),
            lambda: paths.git_checked(self.root, ["ls-files", "-z", "--", "*.md"]),
        ):
            self.small_chunks()
            self.fail_stdout_after(1)
            with self.assertRaises(paths.GitCommandFailed):
                call()
            self.doCleanups()

    def test_corpus_enumeration_never_reports_over_a_short_ls_files(self):
        self.small_chunks()
        self.fail_stdout_after(1)
        with self.assertRaises(paths.GitCommandFailed):
            corpus.enumerate_documents(self.root)

    # -- the writer ------------------------------------------------------
    def test_undelivered_stdin_faults_rather_than_answering_over_nothing(self):
        """`check-attr --stdin` answers about what it was fed. Fed half a
        corpus it answers about half a corpus, with exit 0 and no sign."""
        self.fail_stdin_after(0)
        with self.assertRaises(paths.GitCommandFailed) as caught:
            paths.git_checked(
                self.root,
                ["check-attr", "-z", "--stdin", "linguist-generated"],
                stdin=b"a.md\0b.md\0",
            )
        message = str(caught.exception)
        self.assertIn("check-attr", message)
        self.assertIn("stdin", message)
        self.assertIn(
            "injected write failure",
            message,
            "the fault is reported without saying what the pipe did",
        )

    def test_corpus_enumeration_never_reports_over_a_short_check_attr(self):
        self.fail_stdin_after(0)
        with self.assertRaises(paths.GitCommandFailed):
            corpus.enumerate_documents(self.root)

    def test_a_pump_that_died_outright_is_a_fault_too(self):
        """The failure the recorded-error check cannot see.

        `_BoundedReader` catches `OSError`/`ValueError`, so anything else —
        a `MemoryError` on a huge chunk, a bug in the loop — kills the thread
        without recording anything at all. `reached_eof` is what makes that
        legible: the read did not end at an end of stream, so whatever
        arrived is not the output.
        """

        class _Exploding(_FlakyPipe):
            def read(self, size):
                if self.left <= 0:
                    raise MemoryError("injected pump death")
                self.left -= 1
                return self.real.read(size)

        def wrap(child):
            child.stdout = _Exploding(child.stdout, 1)

        self.small_chunks()
        self.inject(wrap)
        quiet = threading.excepthook
        self.addCleanup(setattr, threading, "excepthook", quiet)
        threading.excepthook = lambda args: None
        with self.assertRaises(paths.GitCommandFailed) as caught:
            paths.git_checked(self.root, ["ls-files", "-z", "--", "*.md"])
        self.assertIn("no end-of-stream was reached", str(caught.exception))

    # -- the two faults that are already recorded ------------------------
    def test_a_cap_breach_is_still_reported_as_a_cap_breach(self):
        """The reader's own kill closes the pipes under it, so every breach
        also produces a pipe error. The breach is the fact; the error it
        caused must not rename it."""
        original = paths.GIT_OUTPUT_CAP_BYTES
        self.addCleanup(setattr, paths, "GIT_OUTPUT_CAP_BYTES", original)
        paths.GIT_OUTPUT_CAP_BYTES = 4
        self.small_chunks()
        with self.assertRaises(paths.OutputCapExceeded):
            paths.git_checked(self.root, ["ls-files", "-z", "--", "*.md"])

    def test_a_timeout_is_still_reported_as_a_timeout(self):
        original = paths.GIT_TIMEOUT_SECONDS
        self.addCleanup(setattr, paths, "GIT_TIMEOUT_SECONDS", original)
        paths.GIT_TIMEOUT_SECONDS = 0.000001
        with self.assertRaises(paths.GitCommandFailed) as caught:
            paths.git_checked(self.root, ["ls-files", "-z", "--", "*.md"])
        self.assertIn("ls-files", str(caught.exception))


# A `git` that leaves a descendant holding stdout and stderr. Nothing exotic:
# a hook, a credential helper, a pager or an `ssh` control-master does exactly
# this, and each inherits the pipes it was handed.
_GIT_LEAVING_A_DESCENDANT = """#!/bin/sh
sleep %d &
exit 0
"""

# The same, but git itself also hangs, so the timeout fires *and* the pipes
# are held afterwards.
_GIT_HANGING_WITH_A_DESCENDANT = """#!/bin/sh
sleep %d &
sleep %d
"""

_GIT_BEHAVING = """#!/bin/sh
printf 'fine\\n'
exit 0
"""

# Long enough that "we waited for it" is unmistakable in the elapsed time.
DESCENDANT_LIFETIME_SECONDS = 30


class CleanupIsBoundedTest(unittest.TestCase):
    """The timeout must bound the **call**, not just the first `wait`.

    ADR-18 says every child is bounded. The bound was on `child.wait(timeout=)`
    alone: after it — on the timeout path, and on every ordinary path too —
    `_run` did an unbounded `child.wait()` and an unbounded `join()` on each
    pump thread. Git closing its own pipes is what made that look safe, and
    git is not the only holder of them. Anything git spawns inherits stdout
    and stderr, so a hook that backgrounds a daemon keeps the write end open
    after git exits or is killed, the reader blocks in `read`, and the join
    waits for it forever — an explicitly bounded command hanging indefinitely,
    which is the failure ADR-18 exists to make impossible.

    Driven with a real `git` on PATH, because the defect is about what a real
    child's descendants do with real pipes.
    """

    def setUp(self):
        self.root = S.make_git_repo()
        self.addCleanup(shutil.rmtree, self.root, True)
        self.bin = os.path.join(self.root, os.pardir, "steward-fake-git-%d" % os.getpid())
        self.bin = os.path.realpath(self.bin)
        os.makedirs(self.bin, exist_ok=True)
        self.addCleanup(shutil.rmtree, self.bin, True)

    def fake_git(self, script):
        path = os.path.join(self.bin, "git")
        with open(path, "w", encoding="utf-8") as handle:
            handle.write(script)
        os.chmod(path, 0o755)
        original = os.environ.get("PATH", "")
        self.addCleanup(os.environ.__setitem__, "PATH", original)
        # **Prepended, not replaced.** Replacing it takes `sleep` off PATH too,
        # so the descendant dies instantly and the fixture proves nothing —
        # the first draft of this test passed for exactly that reason.
        os.environ["PATH"] = self.bin + os.pathsep + original

    def bound(self, timeout=1.0, grace=2.0):
        for name, value in (
            ("GIT_TIMEOUT_SECONDS", timeout),
            ("GIT_CLEANUP_GRACE_SECONDS", grace),
        ):
            self.addCleanup(setattr, paths, name, getattr(paths, name))
            setattr(paths, name, value)
        return timeout + grace

    def test_the_fake_git_control_still_answers_normally(self):
        """Without this, every assertion below could be 'the fixture broke'."""
        self.fake_git(_GIT_BEHAVING)
        self.bound()
        self.assertEqual(b"fine\n", paths.git_checked(self.root, ["ls-files"]))

    def test_a_descendant_holding_the_pipes_cannot_outlast_the_bound(self):
        self.fake_git(_GIT_LEAVING_A_DESCENDANT % DESCENDANT_LIFETIME_SECONDS)
        budget = self.bound()
        started = time.monotonic()
        with self.assertRaises(paths.GitCommandFailed) as caught:
            paths.git_checked(self.root, ["ls-files"])
        elapsed = time.monotonic() - started
        self.assertIn("ls-files", str(caught.exception))
        self.assertLess(
            elapsed,
            budget + 5,
            "the call took %.1fs under a %.1fs bound — it waited for a "
            "descendant, not for git" % (elapsed, budget),
        )

    def test_a_timed_out_git_with_a_descendant_still_returns(self):
        self.fake_git(
            _GIT_HANGING_WITH_A_DESCENDANT
            % (DESCENDANT_LIFETIME_SECONDS, DESCENDANT_LIFETIME_SECONDS)
        )
        budget = self.bound()
        started = time.monotonic()
        with self.assertRaises(paths.GitCommandFailed):
            paths.git_checked(self.root, ["ls-files"])
        elapsed = time.monotonic() - started
        self.assertLess(elapsed, budget + 5, "%.1fs under a %.1fs bound" % (elapsed, budget))

    def test_the_descendant_is_gone_afterwards(self):
        """The pipes are released because the **tree** was taken down, not
        because we walked away from threads still holding them."""
        self.fake_git(_GIT_LEAVING_A_DESCENDANT % DESCENDANT_LIFETIME_SECONDS)
        self.bound()
        with self.assertRaises(paths.GitCommandFailed):
            paths.git_checked(self.root, ["ls-files"])
        survivors = subprocess.run(
            ["pgrep", "-f", "sleep %d" % DESCENDANT_LIFETIME_SECONDS],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        self.assertEqual(
            b"",
            survivors.stdout.strip(),
            "a descendant of the killed git is still running",
        )

    def test_a_run_that_needed_forcing_is_never_reported_as_an_answer(self):
        """The other half: closing a stream is not the stream ending. A
        forced cleanup means nobody can say the output was read whole."""
        self.fake_git(_GIT_LEAVING_A_DESCENDANT % DESCENDANT_LIFETIME_SECONDS)
        self.bound()
        for call in (
            lambda: paths.git_output(self.root, ["ls-files"]),
            lambda: paths.git_answered(self.root, ["ls-files"], (0,)),
            lambda: paths.git_checked(self.root, ["ls-files"]),
        ):
            with self.assertRaises(paths.GitCommandFailed):
                call()


class GitOutputDecodingTest(unittest.TestCase):
    """`.strip()` on git output is lossy, and paths are where it bites.

    `git rev-parse --show-toplevel` terminates its one record with a single
    `\\n` and prints every other byte of the path verbatim. A directory whose
    name ends in a space is legal on every filesystem this runs on, and
    `.strip()` silently renames it: the root resolves to a path that does not
    exist, so the manifest, the claims and the whole managed scope vanish and
    the run reports a clean, unmanaged repository. Verified on git 2.50.1 —
    `show-toplevel` for `<tmp>/repo dir ` emits exactly `...repo dir \\n`.
    """

    def make_repo_named(self, name):
        parent = tempfile.mkdtemp(prefix="steward-oddname-")
        self.addCleanup(shutil.rmtree, parent, True)
        root = os.path.join(os.path.realpath(parent), name)
        os.mkdir(root)
        S.git(root, "init", "-q")
        S.git(root, "config", "user.email", "fixture@example.invalid")
        S.git(root, "config", "user.name", "Fixture")
        return root

    def test_a_repository_root_ending_in_a_space_is_preserved(self):
        root = self.make_repo_named("repo dir ")
        self.assertTrue(os.path.isdir(root), "the fixture name did not survive mkdir")
        self.assertEqual(root, paths.repo_root(root))

    def test_a_repository_root_starting_with_a_space_is_preserved(self):
        root = self.make_repo_named(" leading repo")
        self.assertEqual(root, paths.repo_root(root))

    def test_a_repository_root_ending_in_a_tab_is_preserved(self):
        root = self.make_repo_named("tabbed repo\t")
        self.assertEqual(root, paths.repo_root(root))


class ContainTest(unittest.TestCase):
    def setUp(self):
        self.root = S.make_git_repo()
        self.addCleanup(shutil.rmtree, self.root, True)
        self.outside_dir = os.path.realpath(
            os.path.join(self.root, os.pardir, "steward-outside-%d" % os.getpid())
        )
        os.makedirs(self.outside_dir, exist_ok=True)
        self.addCleanup(shutil.rmtree, self.outside_dir, True)
        self.victim = os.path.join(self.outside_dir, "VICTIM.txt")
        with open(self.victim, "w", encoding="utf-8") as handle:
            handle.write("untouched\n")

    def test_a_plain_relative_path_is_contained(self):
        self.assertEqual(
            os.path.join(self.root, "AGENTS.md"), paths.contain(self.root, "AGENTS.md")
        )

    def test_a_nested_relative_path_is_contained(self):
        self.assertEqual(
            os.path.join(self.root, "docs", "steward", "orphans.md"),
            paths.contain(self.root, "docs/steward/orphans.md"),
        )

    def test_the_root_itself_is_contained(self):
        self.assertEqual(self.root, paths.contain(self.root, "."))

    def test_a_dotdot_traversal_escapes(self):
        with self.assertRaises(paths.ContainmentError) as caught:
            paths.contain(self.root, "../VICTIM.txt")
        self.assertIn("VICTIM.txt", str(caught.exception))
        self.assertEqual("untouched\n", S.read_text(self.victim))

    def test_a_buried_dotdot_traversal_escapes(self):
        with self.assertRaises(paths.ContainmentError):
            paths.contain(self.root, "docs/../../VICTIM.txt")

    def test_an_absolute_path_outside_the_tree_escapes(self):
        with self.assertRaises(paths.ContainmentError):
            paths.contain(self.root, self.victim)

    def test_a_sibling_directory_sharing_the_root_prefix_escapes(self):
        """`/tmp/repo-evil` must not pass a naive startswith('/tmp/repo')."""
        sibling = self.root + "-evil"
        os.makedirs(sibling, exist_ok=True)
        self.addCleanup(shutil.rmtree, sibling, True)
        with self.assertRaises(paths.ContainmentError):
            paths.contain(self.root, os.path.join(sibling, "AGENTS.md"))

    def test_a_symlinked_directory_pointing_out_escapes(self):
        os.symlink(self.outside_dir, os.path.join(self.root, "docs"))
        with self.assertRaises(paths.ContainmentError) as caught:
            paths.contain(self.root, "docs/VICTIM.txt")
        self.assertIn("VICTIM.txt", str(caught.exception))
        self.assertEqual("untouched\n", S.read_text(self.victim))

    def test_a_symlinked_file_pointing_out_escapes(self):
        os.symlink(self.victim, os.path.join(self.root, "AGENTS.md"))
        with self.assertRaises(paths.ContainmentError):
            paths.contain(self.root, "AGENTS.md")

    def test_a_symlink_pointing_back_inside_is_contained(self):
        """ADR-26 alone lets this through — which is exactly debt item 7."""
        with open(os.path.join(self.root, "real.md"), "w", encoding="utf-8") as handle:
            handle.write("x\n")
        os.symlink("real.md", os.path.join(self.root, "AGENTS.md"))
        self.assertEqual(
            os.path.join(self.root, "real.md"), paths.contain(self.root, "AGENTS.md")
        )


class CrossesSymlinkTest(unittest.TestCase):
    """DEBT ITEM 7, limb two."""

    def setUp(self):
        self.root = S.make_git_repo()
        self.addCleanup(shutil.rmtree, self.root, True)

    def test_a_plain_path_crosses_nothing(self):
        self.assertFalse(paths.crosses_symlink(self.root, "AGENTS.md"))
        self.assertFalse(paths.crosses_symlink(self.root, "docs/steward/orphans.md"))

    def test_the_final_component_being_a_symlink_counts(self):
        with open(os.path.join(self.root, "real.md"), "w", encoding="utf-8") as handle:
            handle.write("x\n")
        os.symlink("real.md", os.path.join(self.root, "AGENTS.md"))
        self.assertTrue(paths.crosses_symlink(self.root, "AGENTS.md"))

    def test_an_ancestor_component_being_a_symlink_counts(self):
        os.makedirs(os.path.join(self.root, "real-docs", "steward"))
        os.symlink("real-docs", os.path.join(self.root, "docs"))
        self.assertTrue(
            paths.crosses_symlink(self.root, "docs/steward/routing-map.md")
        )

    def test_a_broken_symlink_counts(self):
        os.symlink("nowhere.md", os.path.join(self.root, "AGENTS.md"))
        self.assertTrue(paths.crosses_symlink(self.root, "AGENTS.md"))

    def test_a_dotdot_component_is_refused_outright(self):
        with self.assertRaises(paths.ContainmentError):
            paths.crosses_symlink(self.root, "../AGENTS.md")


class TargetIsSymlinkedTest(unittest.TestCase):
    """DEBT ITEM 7, end to end: the digest check alone waves the attack through."""

    def setUp(self):
        self.root = S.make_git_repo()
        self.addCleanup(shutil.rmtree, self.root, True)

    def test_a_plain_absent_or_regular_target_is_writable_in_place(self):
        self.assertTrue(paths.target_is_writable_in_place(self.root, "AGENTS.md"))
        with open(os.path.join(self.root, "AGENTS.md"), "w", encoding="utf-8") as handle:
            handle.write("ours\n")
        self.assertTrue(paths.target_is_writable_in_place(self.root, "AGENTS.md"))

    def test_an_in_tree_symlink_recorded_with_a_matching_digest_is_refused(self):
        secret = os.path.join(self.root, "secrets.txt")
        with open(secret, "w", encoding="utf-8") as handle:
            handle.write("do not clobber me\n")
        os.symlink("secrets.txt", os.path.join(self.root, "AGENTS.md"))

        # A foreign but schema-valid manifest records AGENTS.md with the digest
        # of the bytes now readable there. Byte comparison alone SUCCEEDS...
        recorded_digest = sha256_of(secret)
        self.assertEqual(
            recorded_digest, sha256_of(os.path.join(self.root, "AGENTS.md"))
        )
        # ...and ADR-26 containment alone also succeeds, because the link
        # points back inside the tree.
        paths.contain(self.root, "AGENTS.md")
        # The predicate is what refuses it.
        self.assertFalse(
            paths.target_is_writable_in_place(self.root, "AGENTS.md"),
            "an in-tree symlink passed the ownership predicate — create-only "
            "is defeated: a write to AGENTS.md would clobber secrets.txt",
        )

    def test_a_symlinked_parent_directory_is_refused(self):
        os.makedirs(os.path.join(self.root, "real-docs"))
        os.symlink("real-docs", os.path.join(self.root, "docs"))
        self.assertFalse(
            paths.target_is_writable_in_place(self.root, "docs/steward/orphans.md")
        )

    def test_an_escaping_target_is_exit_two_not_merely_unwritable(self):
        with self.assertRaises(paths.ContainmentError):
            paths.target_is_writable_in_place(self.root, "../AGENTS.md")


class EscapeExitsTwoThroughTheCliTest(unittest.TestCase):
    """P1.9 says each escape is **exit 2** — observed, not read.

    `ContainmentError` is in `cli.REPORTED_FAULTS`, but until now that was
    asserted by reading `cli.py`, which is the failure mode this project
    exists to refuse. Only `ManifestError` had an end-to-end proof.

    **Disclosure — where the seam is.** v0 has no flags, so nothing on a
    command line can name a repository-data path, and no Phase-1 verb computes
    one (they are stubs until Phases 3/4/6/7). The escaping *path* is
    therefore injected at the verb seam — the same seam `ToolFailureTest`
    already uses. Everything below that seam is production code: the real
    `atomic.write`, the real `paths.contain`, and the real fault handling in
    `cli.main`. What is proven here is the mapping — a genuine escape from the
    real predicate leaves the process at **exit 2**, with the path named and
    **no traceback** (a predicted fault must not read as a crash, ADR-13) —
    and that the victim outside the tree is byte-identical afterwards.
    """

    def setUp(self):
        self.root = S.make_git_repo()
        self.addCleanup(shutil.rmtree, self.root, True)
        self.outside_dir = os.path.realpath(
            os.path.join(self.root, os.pardir, "steward-cli-escape-%d" % os.getpid())
        )
        os.makedirs(self.outside_dir, exist_ok=True)
        self.addCleanup(shutil.rmtree, self.outside_dir, True)
        self.victim = os.path.join(self.outside_dir, "VICTIM.txt")
        with open(self.victim, "w", encoding="utf-8") as handle:
            handle.write("untouched\n")

    def run_a_verb_writing(self, relpath):
        """Dispatch `check` through the real `cli.main`, with a verb whose only
        act is one real `atomic.write` at `relpath`."""

        def verb(context):
            atomic.write(context.repo_root, relpath, b"clobbered\n")
            return cli.EXIT_OK

        original = dict(cli.VERBS)
        out, err = io.StringIO(), io.StringIO()
        try:
            cli.VERBS["check"] = verb
            code = cli.main(["check"], out, err, cwd=self.root)
        finally:
            cli.VERBS.clear()
            cli.VERBS.update(original)
        return code, out.getvalue(), err.getvalue()

    def assert_exit_two_and_victim_intact(self, relpath):
        code, _out, err = self.run_a_verb_writing(relpath)
        self.assertEqual(2, code, "escape %r did not exit 2: %s" % (relpath, err))
        self.assertIn("VICTIM.txt", err, err)
        self.assertNotIn("Traceback", err, "a predicted fault printed a crash")
        self.assertEqual("untouched\n", S.read_text(self.victim))

    def test_a_dotdot_traversal_exits_two(self):
        self.assert_exit_two_and_victim_intact("../VICTIM.txt")

    def test_an_absolute_path_outside_the_tree_exits_two(self):
        self.assert_exit_two_and_victim_intact(self.victim)

    def test_a_symlinked_directory_pointing_out_exits_two(self):
        os.symlink(self.outside_dir, os.path.join(self.root, "docs"))
        self.assert_exit_two_and_victim_intact("docs/VICTIM.txt")

    def test_an_in_tree_symlink_exits_two(self):
        """DEBT ITEM 7 through the CLI: refused, and reported as a fault."""
        secret = os.path.join(self.root, "secrets.txt")
        with open(secret, "w", encoding="utf-8") as handle:
            handle.write("do not clobber me\n")
        os.symlink("secrets.txt", os.path.join(self.root, "AGENTS.md"))
        code, _out, err = self.run_a_verb_writing("AGENTS.md")
        self.assertEqual(2, code, err)
        self.assertIn("symlink", err)
        self.assertNotIn("Traceback", err)
        self.assertEqual("do not clobber me\n", S.read_text(secret))

    def test_the_control_writing_inside_the_tree_exits_zero(self):
        """Without this, 'exit 2' above could just mean 'an injected verb'."""
        code, _out, err = self.run_a_verb_writing("docs/steward/orphans.md")
        self.assertEqual(0, code, err)
        self.assertEqual("", err)
        self.assertEqual(
            "clobbered\n",
            S.read_text(os.path.join(self.root, "docs", "steward", "orphans.md")),
        )


class CoreSourceExemptionTest(unittest.TestCase):
    """ADR-26's single exemption: the executing core's own source directory,
    read-only, and only for files its own inventory lists."""

    def test_the_core_may_read_a_listed_file_outside_the_tree(self):
        import inventory

        path = paths.core_source_path("__main__.py")
        self.assertTrue(os.path.isfile(path))
        self.assertIn("__main__.py", inventory.FILES)
        with open(path, "rb") as handle:
            self.assertTrue(handle.read())

    def test_the_core_may_not_read_an_unlisted_file_in_its_own_directory(self):
        with self.assertRaises(paths.ContainmentError):
            paths.core_source_path("not-in-the-inventory.py")

    def test_the_exemption_does_not_extend_to_traversal(self):
        for candidate in ("../SKILL.md", "../../keep-it-simple/SKILL.md", "/etc/hosts"):
            with self.assertRaises(paths.ContainmentError, msg=candidate):
                paths.core_source_path(candidate)

    def test_the_core_source_directory_is_outside_a_target_repo(self):
        root = S.make_git_repo()
        self.addCleanup(shutil.rmtree, root, True)
        with self.assertRaises(paths.ContainmentError):
            paths.contain(root, paths.core_source_path("__main__.py"))


class BootstrapInvocationTest(unittest.TestCase):
    """ADR-1's sanctioned bootstrap form, run for real."""

    def setUp(self):
        self.root = S.make_git_repo()
        self.addCleanup(shutil.rmtree, self.root, True)

    def test_root_resolves_from_cwd_not_from_the_core_location(self):
        result = S.run_core(S.MODERN_PYTHON, ["scan"], cwd=self.root)
        self.assertEqual(
            0, result.returncode, result.stderr.decode("utf-8", "replace")
        )
        self.assertEqual(b"", result.stderr)

    def test_it_advertises_no_tools_steward_command_with_no_core_installed(self):
        result = S.run_core(S.MODERN_PYTHON, ["scan"], cwd=self.root)
        output = (result.stdout + result.stderr).decode("utf-8", "replace")
        self.assertNotIn("tools/steward", output)

    def test_it_advertises_the_installed_form_once_a_core_is_ours(self):
        """Owned, end to end: the inventory copied and every file recorded.

        Copying one `__main__.py` in was what this used to do, and it proved
        only that `os.path.isfile` is true — the same evidence a foreign
        `tools/steward/` supplies.
        """
        S.install_owned_core(self.root)
        result = S.run_core(S.MODERN_PYTHON, ["scan"], cwd=self.root)
        output = result.stdout.decode("utf-8", "replace")
        self.assertIn("python3 -B tools/steward scan", output)

    def test_a_foreign_core_directory_advertises_nothing(self):
        installed = os.path.join(self.root, "tools", "steward")
        os.makedirs(installed)
        shutil.copy(
            os.path.join(S.CORE_DIR, "__main__.py"),
            os.path.join(installed, "__main__.py"),
        )
        result = S.run_core(S.MODERN_PYTHON, ["scan"], cwd=self.root)
        output = (result.stdout + result.stderr).decode("utf-8", "replace")
        self.assertEqual(0, result.returncode, output)
        self.assertNotIn("tools/steward", output)

    def test_the_bootstrap_run_leaves_the_working_tree_untouched(self):
        before = S.porcelain(self.root)
        S.run_core(S.MODERN_PYTHON, ["scan"], cwd=self.root)
        self.assertEqual(before, S.porcelain(self.root))


if __name__ == "__main__":
    unittest.main()
