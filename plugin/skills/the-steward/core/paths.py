"""Repository-root resolution and the containment predicate (ADR-26).

The repo root always comes from **cwd via git**, never from the core's own
location, so running the packaged core against a target repo resolves the
target (ADR-1, bootstrap form).
"""

import os
import subprocess
import threading

# ADR-18: the only child process is git, with an argument vector (never a
# shell string), an explicit timeout, and an explicit output cap.
GIT_TIMEOUT_SECONDS = 30
GIT_OUTPUT_CAP_BYTES = 8 * 1024 * 1024

# How much of a pipe is taken per read. Small enough that the cap is crossed
# within one chunk of where it truly falls, large enough not to syscall a
# corpus to death.
_READ_CHUNK_BYTES = 64 * 1024

# `git --literal-pathspecs <subcommand>`: a git-level option that turns every
# pathspec in the command into a literal string, so `[R]EADME.md` stops being
# a character class. It is **half** the rule — see `literal_pathspec` — and it
# is not universal: `check-ignore` rejects pathspec magic outright, `literal`
# included, so passing it there is a fatal 128.
LITERAL_PATHSPECS = "--literal-pathspecs"


def literal_pathspec(relpath):
    """A caller-supplied path, shaped so git reads it as a **name**.

    **`--` is not enough, and neither is `--literal-pathspecs` alone.** `--`
    ends *option* parsing; it says nothing about pathspec syntax. Two separate
    things then remain, verified on git 2.50.1 in a repo holding both
    `README.md` and `[R]EADME.md`:

    * **globbing.** `ls-files -- '[R]EADME.md'` lists **both** files, so a
      probe about one path answers about another. `--literal-pathspecs` is
      what turns that off, and `ls-files` and `log` accept it.
    * **magic prefixes.** A pathspec beginning with `:` is parsed as magic
      wherever it appears: `check-ignore --no-index -- ':(top)README.md'`
      exits **0** — *ignored* — for a repository that ignores `README.md` and
      has never heard of the literal name. `check-ignore` is precisely the
      command that cannot be given `--literal-pathspecs`
      (`fatal: pathspec magic not supported by this command: 'literal'`), so
      the flag cannot be the whole answer.

    Prefixing `./` moves the colon off position 0, which is the only place
    magic is recognised, and git normalises the prefix away — `./sub/deep.md`
    and `sub/deep.md` give identical answers from `check-ignore`, `ls-files`
    and `log`. So: **`./` here, at the argument, and `--literal-pathspecs` at
    the command wherever it is accepted.** Neither alone is sufficient.

    An absolute path is returned unchanged: it cannot begin with `:`, and
    globbing is the flag's job.
    """
    if os.path.isabs(relpath):
        return relpath
    return "./" + relpath


def one_record(raw):
    """Decode one git record, removing **only** git's record terminator.

    `.strip()` is the shape this replaces, and a path is where it bites: git
    prints a path verbatim and ends the record with a single `\\n`, so a
    repository whose directory name ends in a space came back renamed. The
    resolved root then names a directory that does not exist, the manifest and
    every claim under it disappear, and the run reports a clean, *unmanaged*
    repository — a confident answer about a probe that in effect never ran.
    Verified on git 2.50.1: `rev-parse --show-toplevel` in `<tmp>/repo dir `
    emits `<tmp>/repo dir \\n`, and `config --get core.hooksPath` returns
    ` my hooks \\n` for a value set with its spaces.
    """
    text = raw.decode("utf-8", "surrogateescape")
    if text.endswith("\n"):
        text = text[:-1]
    return text


class _Completed(object):
    """What one bounded run produced. Shaped like `CompletedProcess`."""

    def __init__(self, returncode, stdout, stderr):
        self.returncode = returncode
        self.stdout = stdout
        self.stderr = stderr


class _BoundedReader(threading.Thread):
    """Drain one pipe, enforcing the cap **as it reads**.

    The moment the cap is crossed the accumulated bytes are dropped and the
    child is killed: there is no partial result, because a partial result is
    the thing ADR-10 refuses to report over. Reading continues to EOF after
    the kill so the child can never block on a full pipe and the thread always
    finishes.
    """

    def __init__(self, label, handle, cap, on_breach):
        threading.Thread.__init__(self)
        self.daemon = True
        self.label = label
        self.handle = handle
        self.cap = cap
        self.on_breach = on_breach
        self.total = 0
        self.over_cap = False
        self._chunks = []

    def run(self):
        try:
            while True:
                chunk = self.handle.read(_READ_CHUNK_BYTES)
                if not chunk:
                    return
                self.total += len(chunk)
                if self.over_cap:
                    continue
                if self.total > self.cap:
                    self.over_cap = True
                    self._chunks = []
                    self.on_breach()
                    continue
                self._chunks.append(chunk)
        except (OSError, ValueError):
            # The pipe was closed under us by the kill this class asked for.
            # It is not a fact about git's output; `over_cap` already is.
            return
        finally:
            _close(self.handle)

    def data(self):
        return b"".join(self._chunks)


def _close(handle):
    try:
        handle.close()
    except (OSError, ValueError):
        pass


def _feed(handle, payload):
    """Write the child's stdin on its own thread, so a child that never reads
    it cannot outlast the timeout by blocking this one."""
    try:
        if payload:
            handle.write(payload)
        handle.flush()
    except (OSError, ValueError):
        pass
    finally:
        _close(handle)


def _run(cwd, args, timeout, cap, stdin):
    """The one spawn site — every child is `git`, with an argument vector, an
    explicit timeout and an explicit output cap (ADR-18).

    **The timeout and the cap resolve from the module constants at call time,
    not from default arguments.** A default argument is bound once, at `def`
    time, so `paths.GIT_OUTPUT_CAP_BYTES = 200` would be a silent no-op and
    every test that lowered it would be vacuously green — and v0 has no flag
    to lower it with instead (ADR-20, P1.3).

    **The cap bounds what is READ, on BOTH pipes.** The shape this replaces
    ran `subprocess.run` and then measured `len(completed.stdout)` — a cap
    consulted only after the whole stream had been materialised in this
    process, which reports the breach it exists to prevent. Measured: a
    192 MiB blob under a 1 MiB cap grew peak RSS by 481 MiB before raising.
    And `stderr` was never measured at all, so the one stream a *failing* git
    command makes large was unbounded outright. Both pipes now go through
    `_BoundedReader`, which drops what it has and kills the child at the
    crossing.

    `stdin` feeds bytes to the child (`git check-attr -z --stdin`), which is
    what keeps a large corpus off a command line bounded by `ARG_MAX`. It is
    written on its own thread: with all three pipes pumped concurrently there
    is no ordering in which the child and this process can deadlock waiting on
    each other, and `wait(timeout=…)` stays the one bound on the whole run.

    **A child that never ran is a fault here, not a status for a caller to
    read.** `git` missing from `PATH` and a child that hit the timeout raise
    `OSError` and `subprocess.SubprocessError`, neither of which is an exit
    status and neither of which is evidence about anything the caller asked.
    Converting both at the one spawn site means no caller has to remember to,
    and — the bug this replaces — no caller can turn *git did not run* into
    one of its own answers.
    """
    if timeout is None:
        timeout = GIT_TIMEOUT_SECONDS
    if cap is None:
        cap = GIT_OUTPUT_CAP_BYTES
    env = dict(os.environ)
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    try:
        child = subprocess.Popen(
            ["git"] + list(args),
            cwd=cwd,
            env=env,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        raise GitCommandFailed(_could_not_run(args, cwd, exc))

    def kill():
        try:
            child.kill()
        except OSError:
            pass

    readers = (
        _BoundedReader("stdout", child.stdout, cap, kill),
        _BoundedReader("stderr", child.stderr, cap, kill),
    )
    writer = threading.Thread(target=_feed, args=(child.stdin, stdin))
    writer.daemon = True
    workers = readers + (writer,)
    for worker in workers:
        worker.start()
    try:
        try:
            child.wait(timeout=timeout)
        except (OSError, subprocess.SubprocessError) as exc:
            kill()
            child.wait()
            raise GitCommandFailed(_could_not_run(args, cwd, exc))
    finally:
        for worker in workers:
            worker.join()
    for reader in readers:
        if reader.over_cap:
            raise OutputCapExceeded(
                "the-steward: `git %s` produced over %d bytes on %s, past the "
                "%d-byte cap; the child was killed and nothing partial is "
                "reported — refusing to report over a corpus that was not "
                "read whole." % (" ".join(args), reader.total, reader.label, cap)
            )
    return _Completed(child.returncode, readers[0].data(), readers[1].data())


def _could_not_run(args, cwd, exc):
    return (
        "the-steward: `git %s` could not be run in %r: %s: %s. Refusing to "
        "report over a result we could not obtain."
        % (" ".join(args), cwd, type(exc).__name__, exc)
    )


def git_output(cwd, args, timeout=None, cap=None, stdin=None):
    """Run `git <args>` in `cwd`. Returns (returncode, stdout_bytes).

    **The last resort, and an audited one.** This is the only primitive that
    hands a caller a status nobody has interpreted, so it is reserved for the
    commands where an answer and a failure arrive as the *same* status and no
    answer set can separate them. There are exactly two, both named with their
    reason in `test_imports.GitStatusDisciplineTest`, which fails on a third:

    * `rev-parse --show-toplevel` — 128 outside a repository, and 128 on a
      repository git cannot read;
    * `log -1` — 128 for *no commits yet*, and 128 for a real error. (Note it
      is **not** non-zero for *nothing matched*: a pathspec matching no commit
      exits 0 with empty output, verified on git 2.50.1.)

    Everywhere else: `git_answered(..., answers)` when a status is an answer —
    `check-ignore -q` and `config --get`, 0 and 1 against everything above —
    and `git_checked` when only 0 is.
    """
    completed = _run(cwd, args, timeout, cap, stdin)
    return completed.returncode, completed.stdout


def git_answered(cwd, args, answers, timeout=None, cap=None, stdin=None):
    """Run `git <args>` where `answers` is the set of statuses git uses as
    **answers**, and **fault** on any other (ADR-13, exit 2).

    Returns (returncode, stdout_bytes), because for the commands that need
    this the status *is* the answer: `check-ignore -q` says *matched* with 0
    and *no rule matches* with 1, and reserves everything above for errors.
    Reading "not 0" as "no match" makes a broken probe indistinguishable from
    a real negative — the `if code != 0` shape, which is why there is exactly
    one place in this module that decides what a status means.
    """
    completed = _run(cwd, args, timeout, cap, stdin)
    if completed.returncode not in answers:
        raise GitCommandFailed(
            "the-steward: `git %s` exited %d in %r: %s. Refusing to report "
            "over a result we could not obtain."
            % (
                " ".join(args),
                completed.returncode,
                cwd,
                completed.stderr.decode("utf-8", "replace").strip() or "(no stderr)",
            )
        )
    return completed.returncode, completed.stdout


def git_checked(cwd, args, timeout=None, cap=None, stdin=None):
    """Run `git <args>` where **only 0 is an answer**. Returns stdout_bytes.

    For the calls where a failure has no honest interpretation. The shape this
    replaces is `if code != 0: return []`, which turns a broken git invocation
    into an empty corpus — "0 files checked, 0 problems found" rendered as
    coverage, which is ADR-30's vacuous pass with our own plumbing as the
    cause. A tool fault must never read as a pass.
    """
    _code, out = git_answered(cwd, args, (0,), timeout=timeout, cap=cap, stdin=stdin)
    return out


class OutputCapExceeded(Exception):
    """A git command exceeded its output cap (ADR-10, exit 2)."""


class GitCommandFailed(Exception):
    """A spawned git command failed unexpectedly (ADR-13, exit 2)."""


class ContainmentError(Exception):
    """A repository-data path escaped the working tree (ADR-26, exit 2)."""


def repo_root(cwd):
    """Absolute, symlink-resolved repository root, or None when cwd is not in one.

    **DOCUMENTED AMBIGUITY — the `code != 0` here is deliberate and must
    stay.** `rev-parse --show-toplevel` exits **128** both outside a repository
    and on a repository git cannot read (an unparseable config, a broken
    include), and no status separates the two. `answers=(0,)` would make *not
    a repository* — a first-class state the report names — unreachable, so the
    ambiguity is kept where it is honest: as *None*, which every caller
    already treats as "no claim source here". This is one of exactly two
    exceptions, both listed in `test_imports.GitStatusDisciplineTest`.

    **Nothing that is not a status is swallowed.** A missing `git`, a timeout
    and an over-cap read used to be caught here and returned as *None*, so
    `doctor` printed *this directory is not inside a git repository* and exited
    0 having never run git. `_run` raises `GitCommandFailed` for the first two
    and `OutputCapExceeded` for the third, and both travel straight out to the
    CLI's exit 2 (ADR-13).
    """
    code, out = git_output(cwd, ["rev-parse", "--show-toplevel"])
    if code != 0:
        return None
    top = one_record(out)
    if not top:
        return None
    return os.path.realpath(top)


def contain(root, candidate):
    """Resolve `candidate` and prove it is inside `root` (ADR-26).

    `candidate` may be relative to the root or absolute. The check is made
    **after symlink resolution**, so a symlinked directory pointing out of the
    tree escapes. Returns the resolved absolute path; raises ContainmentError,
    which the caller turns into exit 2.
    """
    real_root = os.path.realpath(root)
    target = candidate if os.path.isabs(candidate) else os.path.join(real_root, candidate)
    resolved = os.path.realpath(target)
    if resolved != real_root and not resolved.startswith(real_root + os.sep):
        raise ContainmentError(
            "the-steward: %r resolves to %r, which is outside the working tree "
            "%r. Refusing to touch it." % (candidate, resolved, real_root)
        )
    return resolved


def crosses_symlink(root, relpath):
    """True when any component of `relpath` under `root` is a symlink.

    DEBT ITEM 7. Symlink *resolution* (`contain`) is not enough on its own: an
    in-tree symlink resolves to an in-tree path and passes containment, so a
    foreign manifest recording `AGENTS.md -> secrets.txt` would match the
    recorded digest and license a write straight through the link. The chain
    is walked with `lstat`, ancestors included, and the final component counts
    — a broken symlink counts too, because it is still not a file we created.
    """
    real_root = os.path.realpath(root)
    parts = [
        part
        for part in relpath.replace(os.sep, "/").split("/")
        if part not in ("", ".")
    ]
    if os.pardir in parts or os.path.isabs(relpath):
        raise ContainmentError(
            "the-steward: %r is not a plain repository-relative path" % relpath
        )
    current = real_root
    for part in parts:
        current = os.path.join(current, part)
        if os.path.islink(current):
            return True
    return False


def target_is_writable_in_place(root, relpath):
    """May the-steward write repository data at `relpath`?

    Two limbs, and both are required (ADR-26 + DEBT ITEM 7):

    1. it must be **contained** — escape raises ContainmentError (exit 2);
    2. its component chain must **cross no symlink** — otherwise the write
       lands somewhere we did not create, which defeats create-only. This is
       False, not an exception: a symlink at a target path is an ordinary
       *not ours* classification (ADR-20), reported and left link-identical.
    """
    contain(root, relpath)
    return not crosses_symlink(root, relpath)


def core_source_dir():
    """The executing core's own directory — ADR-26's single exemption."""
    return os.path.dirname(os.path.abspath(__file__))


def core_source_path(relname):
    """Absolute path of one of **our own** source files (read-only).

    The exemption is a rule, not a hole: the only repository-content path the
    core may read outside the working tree is a file **its own inventory
    lists** under `Path(__file__).parent`. Anything else — an unlisted file, a
    traversal, an absolute path — is refused.
    """
    import inventory

    if relname not in inventory.FILES:
        raise ContainmentError(
            "the-steward: %r is not in the packaged core's inventory; the "
            "core reads nothing else outside the working tree." % relname
        )
    base = os.path.realpath(core_source_dir())
    resolved = os.path.realpath(os.path.join(base, relname))
    if not resolved.startswith(base + os.sep):
        raise ContainmentError(
            "the-steward: %r escapes the core source directory" % relname
        )
    return resolved
