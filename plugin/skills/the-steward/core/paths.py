"""Repository-root resolution and the containment predicate (ADR-26).

The repo root always comes from **cwd via git**, never from the core's own
location, so running the packaged core against a target repo resolves the
target (ADR-1, bootstrap form).
"""

import os
import subprocess

# ADR-18: the only child process is git, with an argument vector (never a
# shell string), an explicit timeout, and an explicit output cap.
GIT_TIMEOUT_SECONDS = 30
GIT_OUTPUT_CAP_BYTES = 8 * 1024 * 1024


def _run(cwd, args, timeout, cap, stdin):
    """The one spawn site — every child is `git`, with an argument vector, an
    explicit timeout and an explicit output cap (ADR-18).

    **The timeout and the cap resolve from the module constants at call time,
    not from default arguments.** A default argument is bound once, at `def`
    time, so `paths.GIT_OUTPUT_CAP_BYTES = 200` would be a silent no-op and
    every test that lowered it would be vacuously green — and v0 has no flag
    to lower it with instead (ADR-20, P1.3).

    `stdin` feeds bytes to the child (`git check-attr -z --stdin`), which is
    what keeps a large corpus off a command line bounded by `ARG_MAX`.
    """
    if timeout is None:
        timeout = GIT_TIMEOUT_SECONDS
    if cap is None:
        cap = GIT_OUTPUT_CAP_BYTES
    env = dict(os.environ)
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    completed = subprocess.run(
        ["git"] + list(args),
        cwd=cwd,
        env=env,
        input=stdin,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=timeout,
    )
    if len(completed.stdout) > cap:
        raise OutputCapExceeded(
            "the-steward: `git %s` produced %d bytes, over the %d-byte cap; "
            "refusing to report over a corpus that was not read whole."
            % (" ".join(args), len(completed.stdout), cap)
        )
    return completed


def git_output(cwd, args, timeout=None, cap=None, stdin=None):
    """Run `git <args>` in `cwd`. Returns (returncode, stdout_bytes).

    For the calls where a non-zero status is an answer **and every non-zero
    status is the same answer**: `log` exits non-zero when nothing matches and
    `rev-parse` exits non-zero outside a repository, and in both cases the
    caller has nothing else to say. Where some statuses are answers and the
    rest are errors — `check-ignore -q`, 0 and 1 against everything above —
    use `git_answered`, and where none of them are, `git_checked`.
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
    """Absolute, symlink-resolved repository root, or None when cwd is not in one."""
    try:
        code, out = git_output(cwd, ["rev-parse", "--show-toplevel"])
    except (OSError, subprocess.SubprocessError, OutputCapExceeded, GitCommandFailed):
        return None
    if code != 0:
        return None
    top = out.decode("utf-8", "surrogateescape").strip()
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
