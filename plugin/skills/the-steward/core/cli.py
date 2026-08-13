"""Argument parsing, verb dispatch and the exit-code contract (ADR-13, ADR-20).

Three exit codes and no fourth:

    0  no `error` findings
    1  at least one `error` finding
    2  the tool itself failed and no finding set can be trusted

v0 has no flags. Every verb rejects every flag, including `--force` (which was
deleted with the record-is-not-a-grant rule) and `--version` (which never
existed — the core's version is a line in `doctor`'s report).
"""

import os
import traceback

import atomic
import bootstrap
import findings
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
        """Is there a core at the contract path in *this* repository?

        The report advertises `python3 -B tools/steward …` only when the
        answer is yes — printing it otherwise names a path we did not install.
        """
        if self.repo_root is None:
            return False
        return os.path.isfile(
            os.path.join(
                self.repo_root, *(INSTALLED_CORE_DIRECTORY.split("/") + ["__main__.py"])
            )
        )


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
