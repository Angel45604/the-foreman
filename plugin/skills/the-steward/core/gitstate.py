"""What git says about a path: the tri-state, and dates (P2.3).

**Three states, because two would collapse a distinction C2 depends on.** C2
resolves a declared path against the **working tree, not the index** — a fresh
`generate` output is untracked until a human runs `git add`, and v0 grows no
staging lifecycle to change that (PDR §3). But a path resolving **only** to a
git-ignored file is unresolved in the same terms as a missing one. So:

    tracked   — in git's index (staged or committed)
    ignored   — not in the index, and matched by an ignore rule
    untracked — neither

**The precedence is ours, explicitly, and `--no-index` is what makes it ours
[verified].** git honors the index over `.gitignore`, and by **default**
`git check-ignore` implements that itself: on a tracked path matched by an
ignore rule it exits 1, *not ignored*. Relying on that would leave this
module's own ordering unreachable — a rule no test could fire, which is the
dead-check class this project exists to refuse. `--no-index` reduces
`check-ignore` to the pure pattern question it should be answering here, so
the composition below is the thing under test:

    tracked wins over ignored, because trackedness is asked first.

Probed on git 2.50.1, a tracked `keep.log` under `*.log`: `check-ignore -q`
exits **1**, `check-ignore -q --no-index` exits **0**.

**The question is about the path's name and git's rules, not about the
filesystem.** A path that does not exist but matches an ignore rule is
`ignored`; whether a file is actually there is C2's separate question, asked
separately (PDR §3).

**Dates come from git, never from the filesystem** (ADR-9). `mtime` is
meaningless after any fresh clone, in any linked worktree, and on every CI
runner. The reference repo has the live illustration: a tracked `.editorconfig`
with an mtime ~2.3 years newer than the commit that last changed it
(`verified-contracts.md` §2.3.11, row 2), under an audit script whose drift
check reads that mtime.
"""

import paths

TRACKED = "tracked"
IGNORED = "ignored"
UNTRACKED = "untracked"

STATES = (TRACKED, IGNORED, UNTRACKED)


def _is_in_the_index(root, relpath):
    code, out = paths.git_output(root, ["ls-files", "-z", "--", relpath])
    if code != 0:
        return False
    return bool(out.replace(b"\0", b""))


def _matches_an_ignore_rule(root, relpath):
    # `--no-index`: the pure pattern question (see the module docstring). `-q`
    # exits 0 when a rule matches, 1 when none does, and >1 on an error —
    # which must not read as "no match" by accident, so only 0 is a yes.
    code, _out = paths.git_output(
        root, ["check-ignore", "-q", "--no-index", "--", relpath]
    )
    return code == 0


def path_state(root, relpath):
    """One of `tracked` / `ignored` / `untracked`, and never anything else."""
    if _is_in_the_index(root, relpath):
        return TRACKED
    if _matches_an_ignore_rule(root, relpath):
        return IGNORED
    return UNTRACKED


def last_commit_date(root, relpath=None):
    """`git log -1 --format=%cI`, or None when no commit touches the path.

    Strict ISO 8601 with an offset. It is read at report time and **never
    stored in an artifact** (ADR-2's temporal rule): a stored date is an
    observation timestamp, which changes on every run and destroys
    render-and-diff.
    """
    args = ["log", "-1", "--format=%cI"]
    if relpath is not None:
        args.extend(["--", relpath])
    code, out = paths.git_output(root, args)
    if code != 0:
        return None
    value = out.decode("utf-8", "surrogateescape").strip()
    return value or None
