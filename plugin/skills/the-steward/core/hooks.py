"""Hooks-path **inspection** — read-only, for A3 (ADR-28, ADR-4).

**The-steward installs no hook and configures nothing.** This module resolves
the hooks path git would actually use, says whether that is the default or a
redirection, and stats whatever is there for presence and the mode bit. It
reports **those facts and no more** — every finding at tier *inspected*, never
as proof of behavior.

**Two sentences are banned outright** (ADR-28): never *"enforcement works"* —
inspection cannot establish that a hook fires — and never *"there is no
enforcement"*, which inspection cannot establish either. A hooks path and a
mode bit are two facts about one directory in one clone; branch protection, a
server-side hook, a required CI check and an unstatted local hook are all
outside them. The bounded diagnosis A3 needs — *"the tracked hooks directory
`D` is not the effective hooks path, so nothing in `D` runs in this clone"* —
is a statement about `D`, and it is P7.4's to make from these facts.

**git does the path resolution, because the cases are not guessable
[verified, `verified-contracts.md` §2.3.6 and a live probe on git 2.50.1]:**
`git rev-parse --path-format=absolute --git-path hooks` returns the default
`<git-dir>/hooks` when nothing is configured, the configured value when one is
absolute, and — the case a naive join gets wrong — a **relative**
`core.hooksPath` resolved against the **working-tree root**, per worktree, not
against CWD. In a linked worktree with nothing configured it resolves into the
*main* repository's git dir. Reimplementing any of that here would be four
guesses where one command is verified.

**The hooks path is outside the working tree, and that is not a containment
violation.** ADR-26's predicate covers *repository data*; the git executable,
the git configuration and the hooks path `doctor` inspects are outside it and
always were. Routing this through `paths.contain` would hard-error on every
repository, because the default hooks path lives under `.git`.
"""

import os
import stat

import findings
import paths

DEFAULT = "default"
REDIRECTED = "redirected"
BRANCHES = (DEFAULT, REDIRECTED)


class HookFile(object):
    """One entry found in the effective hooks directory.

    `mode` is None when the entry could not be stat'ed at all — a dangling
    symlink is the ordinary case, and it must not turn `doctor` into exit 2
    for the whole repository.
    """

    def __init__(self, name, path, mode, is_file):
        self.name = name
        self.path = path
        self.mode = mode
        self.is_file = is_file
        self.is_executable = bool(mode & 0o111) if mode is not None else False


class HooksInspection(object):
    """What one read-only look at the hooks path saw."""

    def __init__(self, effective_path, default_path, configured, hooks):
        self.effective_path = effective_path
        self.default_path = default_path
        # The raw `core.hooksPath` value, verbatim, or None when unset. Kept
        # separately from `branch`: a configured path *equal to the default*
        # is still the default, and the reference repo is in exactly that
        # state (§2.3.6). Calling it a redirection would be a false A3.
        self.configured = configured
        self.branch = (
            DEFAULT
            if os.path.realpath(effective_path) == os.path.realpath(default_path)
            else REDIRECTED
        )
        self.directory_exists = os.path.isdir(effective_path)
        self.hooks = tuple(hooks)


def _rev_parse(cwd, args):
    """Checked: inside a repository these cannot fail, and swallowing a
    failure would hand the inspection a `None` path to report facts about
    (ADR-13, exit 2)."""
    out = paths.git_checked(cwd, ["rev-parse"] + list(args))
    value = out.decode("utf-8", "surrogateescape").strip()
    if not value:
        raise paths.GitCommandFailed(
            "the-steward: `git rev-parse %s` returned nothing in %r; the hooks "
            "path cannot be inspected." % (" ".join(args), cwd)
        )
    return value


# `git config --get` answers with two statuses and reserves the rest: **0** is
# the value and **1** is *the key is not set*. Everything above means it could
# not read the configuration at all — a bad `[include]`, a config file it
# cannot parse or open. `code != 0` collapsed all three into *unset*, which is
# a false A3 in the worst direction: the inspection would report
# `core.hooksPath is unset` over a clone whose hooks path we never managed to
# ask about, and `branch` would read `default` off it.
CONFIG_GET_ANSWERS = (0, 1)
CONFIG_GET_UNSET = 1


def _configured_value(cwd):
    code, out = paths.git_answered(
        cwd, ["config", "--get", "core.hooksPath"], CONFIG_GET_ANSWERS
    )
    if code == CONFIG_GET_UNSET:
        return None
    value = out.decode("utf-8", "surrogateescape").strip()
    return value or None


def _entries(directory):
    try:
        names = sorted(os.listdir(directory))
    except OSError:
        return []
    found = []
    for name in names:
        path = os.path.join(directory, name)
        try:
            info = os.stat(path)
        except OSError:
            found.append(HookFile(name, path, None, False))
            continue
        found.append(
            HookFile(name, path, stat.S_IMODE(info.st_mode), stat.S_ISREG(info.st_mode))
        )
    return found


def inspect(root, cwd=None):
    """Resolve the effective hooks path and stat what is there. Writes nothing.

    `cwd` exists so a caller running from a subdirectory can be shown to get
    the same answer — a relative `core.hooksPath` resolves against the
    working-tree root, not against the directory git was invoked from.
    """
    where = root if cwd is None else cwd
    effective = _rev_parse(where, ["--path-format=absolute", "--git-path", "hooks"])
    common = _rev_parse(where, ["--path-format=absolute", "--git-common-dir"])
    return HooksInspection(
        effective_path=effective,
        default_path=os.path.join(common, "hooks"),
        configured=_configured_value(where),
        hooks=_entries(effective),
    )


def inspection_findings(inspection):
    """The facts, each at tier *inspected*, each `info` (ADR-28, ADR-13).

    Severity is `info` here because these are observations, not violations:
    what A3 *means* for a given repository is P7.4's bounded diagnosis, built
    from these same facts. Nothing in this text may say a hook fires, or that
    nothing does.
    """
    found = [
        findings.finding(
            id="hooks-path",
            severity="info",
            tier="inspected",
            claim="the hooks path git would use in this clone",
            observed=(
                "%s (%s); core.hooksPath is %s"
                % (
                    inspection.effective_path,
                    inspection.branch,
                    "unset"
                    if inspection.configured is None
                    else repr(inspection.configured),
                )
            ),
            where=inspection.effective_path,
        )
    ]
    if not inspection.directory_exists:
        found.append(
            findings.finding(
                id="hooks-directory-absent",
                severity="info",
                tier="inspected",
                claim="what the effective hooks path contains",
                observed="no directory at that path",
                where=inspection.effective_path,
            )
        )
        return found
    for hook in inspection.hooks:
        found.append(
            findings.finding(
                id="hook-file",
                severity="info",
                tier="inspected",
                claim="a file present at the effective hooks path",
                observed=(
                    "%s, mode %s, executable bit %s"
                    % (
                        hook.name,
                        "unreadable" if hook.mode is None else "%o" % hook.mode,
                        "set" if hook.is_executable else "clear",
                    )
                ),
                where=hook.path,
            )
        )
    return found
