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


# `check-ignore -q` says *matched* with 0 and *no rule matches* with 1, and
# reserves every higher status for errors. Both of the first two are answers;
# nothing else is, and `git_answered` is what makes that true rather than
# claimed — `code == 0` cannot tell 128 from 1 and would read a failed probe
# as a clean negative.
CHECK_IGNORE_ANSWERS = (0, 1)
CHECK_IGNORE_MATCHED = 0


def _is_in_the_index(root, relpath):
    """`ls-files` has no non-zero answer: a failure here is exit 2, never
    `False`. `False` would flow on to `untracked`, and C2 treats
    untracked-but-present as **resolved** — a claim reported verified off a
    probe that never ran, which is the disease this tool exists to find."""
    out = paths.git_checked(root, ["ls-files", "-z", "--", relpath])
    return bool(out.replace(b"\0", b""))


def _matches_an_ignore_rule(root, relpath):
    # `--no-index`: the pure pattern question (see the module docstring).
    code, _out = paths.git_answered(
        root,
        ["check-ignore", "-q", "--no-index", "--", relpath],
        CHECK_IGNORE_ANSWERS,
    )
    return code == CHECK_IGNORE_MATCHED


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

    **DOCUMENTED AMBIGUITY — do not "fix" this into `git_answered`.** Every
    other git call in the core has an answer set that separates answers from
    failures; this one does not, **by construction**. Probed on git 2.50.1:

        repository with commits, pathspec matches      exit 0, a date
        repository with commits, pathspec matches none exit 0, empty output
        repository with NO commits                     exit 128
        pathspec outside the repository                exit 128
        a repository git cannot read at all            exit 128

    Rows three and four are the real answer *no commit touches this path*, and
    row five is a fault — all three arrive as **128** with no field that tells
    them apart. `answers=(0,)` would make a fresh `git init` (the greenfield
    criterion, which must pass) exit 2; `answers=(0, 128)` would only rename
    the ambiguity. So the reading stays `code != 0 -> None`, and the honesty
    lives in the blast radius instead: this value is a **date on a report
    line**, never a claim's verdict and never an input to a check. A missing
    date under-states; it cannot manufacture a pass.

    Listed as an exception in `test_imports.GitStatusDisciplineTest`, which
    fails if any *other* site regains this shape.
    """
    args = ["log", "-1", "--format=%cI"]
    if relpath is not None:
        args.extend(["--", relpath])
    code, out = paths.git_output(root, args)
    if code != 0:
        return None
    value = out.decode("utf-8", "surrogateescape").strip()
    return value or None
