"""Argument parsing, verb dispatch and the exit-code contract (ADR-13, ADR-20).

Three exit codes and no fourth:

    0  no `error` findings
    1  at least one `error` finding
    2  the tool itself failed and no finding set can be trusted

v0 has no flags. Every verb rejects every flag, including `--force` (which was
deleted with the record-is-not-a-grant rule) and `--version` (which never
existed — the core's version is a line in `doctor`'s report).
"""

import errno
import os
import traceback

import atomic
import bootstrap
import digest
import findings
import hooks
import inventory
import manifest
import paths

# Faults we raise deliberately. Each is exit 2 with its own message and no
# traceback: a tool fault must never read as a pass (ADR-13), but it should
# also not read as a crash when we predicted it.
REPORTED_FAULTS = (
    manifest.ManifestError,
    paths.ContainmentError,
    paths.OutputCapExceeded,
    paths.GitCommandFailed,
    atomic.AtomicWriteError,
    hooks.HooksInspectionFailed,
)

# The contract path a vendored core lives at inside a target repo. Named once:
# the report advertises it, and `manifest.SCHEMA_REFERENCE` points `$schema` at
# a file underneath it, so the two must not drift apart.
INSTALLED_CORE_DIRECTORY = "tools/steward"

EXIT_OK = 0
EXIT_FINDINGS = 1
EXIT_TOOL_FAILURE = 2


class StewardError(Exception):
    """A tool fault. Always exit 2; a fault must never read as a pass."""


class UsageError(StewardError):
    """The command line itself was wrong."""


class Context(object):
    """Everything a verb is allowed to know about the invocation."""

    def __init__(self, verb, cwd, stdout, stderr, repo_root=None, manifest=None):
        self.verb = verb
        self.cwd = cwd
        self.stdout = stdout
        self.stderr = stderr
        self.repo_root = repo_root
        # None means *unmanaged*, not failing (ADR-32): a repository that has
        # never run `generate` declares no scope and has no claim source.
        self.manifest = manifest

    def core_is_installed(self):
        """Is there a core **we installed** at the contract path here?"""
        if self.repo_root is None:
            return False
        return installed_core_is_ours(self.repo_root, self.manifest)


# ADR-2's kind for bytes we copied rather than rendered. A vendored core is
# `copied`: there is no renderer for it, so C4 never re-renders it.
COPIED_KIND = "copied"


def _recorded_copies(document):
    """{path: sha256} for every `copied` record in the manifest."""
    stored = {}
    for record in document.get("recorded", []):
        if record.get("kind") == COPIED_KIND:
            stored[record.get("path")] = record.get("sha256")
    return stored


def installed_core_is_ours(root, document):
    """Is the core at `tools/steward` one **this repository's manifest owns**?

    **`os.path.isfile(tools/steward/__main__.py)` is not an answer to that
    question, and answering it that way was the eleventh instance of this
    project's one bug.** Any directory somebody else put at the contract path
    is true of it the moment it holds a file of that name — an unrelated
    vendored tool, an empty placeholder, an in-tree symlink to a core copied
    from elsewhere — and the footer then advertises
    `python3 -B tools/steward doctor` for a core we did not install and do not
    own. The decided contract is the opposite (P6.5a, P1.9, P9.4): no record,
    a foreign child, a recorded child whose bytes do not match, or a
    non-directory at `tools/steward` means the core is **not ours**, and no
    `tools/steward` string may appear in the report at all.

    So the answer comes from **ownership evidence**, which is five things and
    every one of them is required:

    1. the path is **contained** — a `tools/steward` resolving out of the tree
       is ADR-26 escape and still exit 2, not a False;
    2. its component chain **crosses no symlink**, and neither does any
       child's: a link resolving back inside passes containment, which is
       DEBT ITEM 7 exactly;
    3. a **manifest** exists — it is the only place ownership is recorded, so
       a byte-perfect copy nobody recorded is somebody else's copy;
    4. the directory's children are **exactly the declared inventory** — a
       stray unlisted file is a collision, not something to overlook;
    5. every member is recorded `copied` and its **digest matches** the bytes
       on disk.

    A failed *look* is never one of these answers: `ENOENT`/`ENOTDIR` is
    genuine absence and answers False, and anything else is exit 2 (ADR-13).
    """
    directory = paths.contain(root, INSTALLED_CORE_DIRECTORY.replace("/", os.sep))
    if paths.crosses_symlink(root, INSTALLED_CORE_DIRECTORY):
        return False
    try:
        children = set(os.listdir(directory))
    except OSError as exc:
        if exc.errno in (errno.ENOENT, errno.ENOTDIR):
            return False
        raise StewardError(
            "the-steward: the installed-core path %r could not be read: %s. "
            "Refusing to report over a directory we did not manage to look at "
            "— that is not the same as an empty one." % (directory, exc)
        )
    if children != set(inventory.FILES):
        return False
    # An **unmanaged** repository (no manifest, ADR-32) records nothing, so it
    # owns nothing. It needs no rule of its own: the empty record set is the
    # answer, and a separate `document is None` branch was redundant with it.
    stored = _recorded_copies(document or {})
    for name in inventory.FILES:
        relpath = "%s/%s" % (INSTALLED_CORE_DIRECTORY, name)
        if relpath not in stored:
            return False
        if paths.crosses_symlink(root, relpath):
            return False
        located = os.path.join(directory, name)
        if not os.path.isfile(located):
            return False
        try:
            if digest.of_file(located) != stored[relpath]:
                return False
        except OSError as exc:
            raise StewardError(
                "the-steward: %r is recorded as part of the installed core but "
                "could not be read to compare: %s. Refusing to report over a "
                "digest we did not compute." % (relpath, exc)
            )
    return True


def parse_argv(argv):
    """Return the verb, or raise UsageError. No flags exist, anywhere."""
    for token in argv:
        if token.startswith("-") and token != "-":
            raise UsageError(
                "the-steward: %r is not accepted — v0 has no flags at all. "
                "Usage: python3 -B <core> {%s}" % (token, "|".join(sorted(VERBS)))
            )
    if not argv:
        raise UsageError(
            "the-steward: no verb given. Usage: python3 -B <core> {%s}"
            % "|".join(sorted(VERBS))
        )
    verb = argv[0]
    if verb not in VERBS:
        raise UsageError(
            "the-steward: %r is not a verb. Usage: python3 -B <core> {%s}"
            % (verb, "|".join(sorted(VERBS)))
        )
    if len(argv) > 1:
        raise UsageError(
            "the-steward: unexpected argument %r — %s takes none."
            % (argv[1], verb)
        )
    return verb


def _footer(context):
    """Lines printed after the finding summary.

    The installed-form invocation is advertised **only** once a core exists at
    the contract path — printing it otherwise would name a path we did not
    install (ADR-1, P1.9, P9.4).
    """
    lines = ["core %s" % bootstrap.CORE_VERSION]
    if context.core_is_installed():
        lines.append(
            "Re-run without Claude tooling: python3 -B %s %s"
            % (INSTALLED_CORE_DIRECTORY, context.verb)
        )
    return lines


def _stub(context):
    """Phase 1 placeholder: renders a real report over nothing, writes nothing.

    Phases 3, 4, 6 and 7 replace these with the real verbs. It renders through
    the real report renderer so the cardinality contract (ADR-30) holds from
    the first phase: zero items examined always states its reason.
    """
    report = findings.render_report(
        context.verb,
        [],
        [
            findings.cardinality(
                "phase-1",
                0,
                reason="the checks are not implemented in this phase",
            )
        ],
        extra_lines=_footer(context),
    )
    context.stdout.write(report)
    return EXIT_OK


TRACKEDNESS_CHECK = "manifest-trackedness"


def _trackedness(context):
    """ADR-2 / ADR-13: is `.steward.json` in the index? Returns (found, card).

    `warn`, tier *inspected*, and **exit 0** — loud enough that a control plane
    one `git clean -xdf` deletes cannot stay invisible, quiet enough that the
    greenfield criterion still passes. It belongs to `doctor`, which inspects;
    `check` is C1-C5 and asks a different question.
    """
    if context.repo_root is None:
        return [], findings.cardinality(
            TRACKEDNESS_CHECK, 0, reason="this directory is not inside a git repository"
        )
    if context.manifest is None:
        return [], findings.cardinality(
            TRACKEDNESS_CHECK,
            0,
            reason="this repository has no %s to track" % manifest.MANIFEST_NAME,
        )
    if manifest.is_tracked(context.repo_root):
        return [], findings.cardinality(TRACKEDNESS_CHECK, 1)
    return (
        [
            findings.finding(
                id="manifest-untracked",
                severity="warn",
                tier="inspected",
                claim="%s is tracked in git" % manifest.MANIFEST_NAME,
                observed=(
                    "it is not in the index, so `git clean -xdf` would delete "
                    "the control plane and every ownership record with it"
                ),
                where=manifest.MANIFEST_NAME,
            )
        ],
        findings.cardinality(TRACKEDNESS_CHECK, 1),
    )


def _doctor(context):
    """Phase 1 `doctor`: the trackedness inspection, and the stub for the rest.

    The remaining checks arrive in Phase 7. The cardinality line for them says
    so, so a thin report can never read as coverage (ADR-30).
    """
    found, trackedness = _trackedness(context)
    report = findings.render_report(
        context.verb,
        found,
        [
            trackedness,
            findings.cardinality(
                "phase-1",
                0,
                reason="the remaining checks are not implemented in this phase",
            ),
        ],
        extra_lines=_footer(context),
    )
    context.stdout.write(report)
    return findings.exit_code(found)


VERBS = {
    "scan": _stub,
    "generate": _stub,
    "check": _stub,
    "doctor": _doctor,
}


def main(argv, stdout, stderr, cwd=None):
    working_dir = os.getcwd() if cwd is None else cwd
    try:
        verb = parse_argv(argv)
    except UsageError as exc:
        stderr.write("%s\n" % exc)
        return EXIT_TOOL_FAILURE
    try:
        root = paths.repo_root(working_dir)
        context = Context(
            verb=verb,
            cwd=working_dir,
            stdout=stdout,
            stderr=stderr,
            repo_root=root,
            manifest=manifest.load(root) if root else None,
        )
        return VERBS[verb](context)
    except (StewardError,) + REPORTED_FAULTS as exc:
        stderr.write("%s\n" % exc)
        return EXIT_TOOL_FAILURE
    except Exception:  # noqa: BLE001 - a tool fault must never read as a pass
        stderr.write(traceback.format_exc())
        return EXIT_TOOL_FAILURE
