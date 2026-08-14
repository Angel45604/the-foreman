"""Shared helpers for the-steward test suite.

Deliberately dependency-free and sibling-skill-free (#29): nothing here reads,
imports, or shells out to any skill other than `the-steward`.
"""

import contextlib
import hashlib
import os
import stat
import subprocess
import sys
import tempfile
import unittest

TESTS_DIR = os.path.dirname(os.path.abspath(__file__))
SKILL_DIR = os.path.dirname(TESTS_DIR)
CORE_DIR = os.path.join(SKILL_DIR, "core")
PLUGIN_SKILLS_DIR = os.path.dirname(SKILL_DIR)
PLUGIN_DIR = os.path.dirname(PLUGIN_SKILLS_DIR)
REPO_ROOT = os.path.dirname(PLUGIN_DIR)

# Interpreters the dual-interpreter fixtures need (ADR-1, P1.8).
FLOOR_PYTHON = "/usr/bin/python3"          # Apple CLT 3.9.6, patched sys.pycache_prefix
MODERN_PYTHON = "/usr/local/bin/python3"   # python.org 3.13.5, sys.pycache_prefix None


def import_core():
    """Put the core on sys.path so its flat absolute imports resolve."""
    if CORE_DIR not in sys.path:
        sys.path.insert(0, CORE_DIR)


def read_text(path):
    with open(path, "r", encoding="utf-8") as handle:
        return handle.read()


def parse_frontmatter_name(path):
    """Tiny `name:` reader for SKILL.md files. Not the C3 parser."""
    lines = read_text(path).split("\n")
    if not lines or lines[0].strip() != "---":
        return None
    for line in lines[1:]:
        if line.strip() == "---":
            return None
        if line.startswith("name:"):
            return line.split(":", 1)[1].strip()
    return None


def run_core(interpreter, argv, cwd, core_dir=None, bare=False, env=None):
    """Run the core out of `core_dir` (default: the packaged core).

    `bare` drops `-B`, which is only ever used by the P1.8 negative control.
    """
    core = core_dir if core_dir is not None else CORE_DIR
    cmd = [interpreter]
    if not bare:
        cmd.append("-B")
    cmd.append(core)
    cmd.extend(argv)
    run_env = dict(os.environ) if env is None else dict(env)
    run_env.pop("PYTHONDONTWRITEBYTECODE", None)
    return subprocess.run(
        cmd, cwd=cwd, env=run_env, stdout=subprocess.PIPE, stderr=subprocess.PIPE
    )


def git(cwd, *args):
    return subprocess.run(
        ["git"] + list(args), cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.PIPE
    )


def make_git_repo(prefix="steward-fixture-"):
    """A quiescent temp git repo with one commit. Caller cleans up."""
    root = tempfile.mkdtemp(prefix=prefix)
    root = os.path.realpath(root)
    git(root, "init", "-q")
    git(root, "config", "user.email", "fixture@example.invalid")
    git(root, "config", "user.name", "Fixture")
    git(root, "config", "commit.gpgsign", "false")
    with open(os.path.join(root, "README.md"), "w", encoding="utf-8") as handle:
        handle.write("# fixture\n")
    git(root, "add", "README.md")
    git(root, "commit", "-q", "-m", "init")
    return root


def porcelain(root):
    return git(root, "status", "--porcelain").stdout.decode("utf-8")


INSTALLED_CORE_DIRECTORY = "tools/steward"


def install_owned_core(root, manifest_extra=None):
    """Vendor the packaged core into `root` **with its ownership evidence**.

    This is what an installation the-steward actually performed looks like
    (P6.5a): the complete declared inventory, copied byte for byte, and one
    `recorded` entry per file — `kind: copied`, with the file's digest — in a
    tracked `.steward.json`. A directory that merely *contains* a
    `__main__.py` is not this, which is the distinction the footer's
    installed-core predicate turns on.

    Written with the test's own `json` and `hashlib` rather than through the
    core's `jsonio`/`digest`, so the subject under test is never also the
    oracle. Returns the manifest document.
    """
    import json

    directory = os.path.join(root, *INSTALLED_CORE_DIRECTORY.split("/"))
    if not os.path.isdir(directory):
        os.makedirs(directory)
    recorded = []
    for name in core_inventory():
        source = os.path.join(CORE_DIR, name)
        target = os.path.join(directory, name)
        with open(source, "rb") as handle:
            payload = handle.read()
        with open(target, "wb") as handle:
            handle.write(payload)
        recorded.append(
            {
                "path": "%s/%s" % (INSTALLED_CORE_DIRECTORY, name),
                "kind": "copied",
                "sha256": hashlib.sha256(payload).hexdigest(),
            }
        )
    document = {"recorded": recorded}
    if manifest_extra:
        document.update(manifest_extra)
    with open(os.path.join(root, ".steward.json"), "w", encoding="utf-8") as handle:
        handle.write(json.dumps(document, indent=2, sort_keys=True) + "\n")
    return document


def core_inventory():
    """The packaged core's declared inventory, read as data, not imported.

    `tests/_support` is imported by fixtures that run before `import_core()`,
    and the list is a plain tuple of string literals, so it is parsed out of
    the source rather than executed.
    """
    import ast

    source = read_text(os.path.join(CORE_DIR, "inventory.py"))
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id == "FILES":
                    return tuple(ast.literal_eval(node.value))
    raise AssertionError("inventory.py no longer declares FILES")


GIT_DIRECTORY = ".git"
_DIGEST_CHUNK = 1 << 16


def _digest_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        while True:
            chunk = handle.read(_DIGEST_CHUNK)
            if not chunk:
                return digest.hexdigest()
            digest.update(chunk)


def _entry_line(full):
    """One line of ground truth about one entry, without following symlinks.

    `lstat` throughout: a symlink is described by *itself* — its mode and its
    target — never by whatever it points at, so retargeting a link is a change
    and a link to a file outside the fixture is never read.
    """
    try:
        info = os.lstat(full)
    except OSError as exc:
        # Not swallowed into "absent": the guard says what it could not read,
        # and a change in *that* is still a change.
        return "unreadable errno=%s" % exc.errno
    mode = stat.S_IMODE(info.st_mode)
    if stat.S_ISLNK(info.st_mode):
        try:
            target = os.readlink(full)
        except OSError as exc:
            target = "<unreadable errno=%s>" % exc.errno
        return "symlink %04o -> %s" % (mode, target)
    if stat.S_ISDIR(info.st_mode):
        return "directory %04o" % mode
    if stat.S_ISREG(info.st_mode):
        try:
            return "file %04o %d %s" % (mode, info.st_size, _digest_file(full))
        except OSError as exc:
            return "file %04o %d unreadable errno=%s" % (mode, info.st_size, exc.errno)
    return "other %06o" % info.st_mode


def _walk(root):
    """Every entry under `root` except git's own bookkeeping, as relpaths.

    Written as an explicit `lstat` walk rather than `os.walk`, because
    `os.walk` classifies a symlink to a directory as a directory and this
    snapshot must describe the link.
    """
    seen = {}
    stack = [""]
    while stack:
        relative = stack.pop()
        directory = os.path.join(root, relative) if relative else root
        try:
            names = sorted(os.listdir(directory))
        except OSError as exc:
            seen[relative + "/<unlistable>"] = "errno=%s" % exc.errno
            continue
        for name in names:
            if name == GIT_DIRECTORY:
                continue
            child = name if not relative else relative + "/" + name
            full = os.path.join(root, child.replace("/", os.sep))
            line = _entry_line(full)
            seen[child] = line
            if line.startswith("directory "):
                stack.append(child)
    return seen


def tree_snapshot(root):
    """P2.4 — the cleanliness reading every read-only test asserts on.

    **Two readings, because each is blind where the other sees.**

    1. `git status --porcelain --untracked-files=all` — the only half that can
       see the **index**, which is not in the working tree at all. `git add`
       leaves every byte on disk untouched.
    2. A direct `lstat` walk of the working tree with a SHA-256 per regular
       file. Porcelain answers *which paths differ from the index*, which is a
       different question from *are the bytes the same*, and the gap between
       them is where a read-only verb can rewrite a file and stay green:
       porcelain prints the same single `?? AGENTS.md` whatever that file now
       contains, prints nothing at all for an **ignored** path, and collapses
       an untracked directory to one line. Greenfield — `generate`'s output,
       untracked until a human stages it — sits entirely inside that gap.

    The walk records type, mode, size, content digest and symlink target, so a
    name-preserving rewrite, a `chmod`, a retargeted link and a new empty
    directory are all changes. `.git` is excluded: git rewrites its own
    bookkeeping on operations we do not control, and the guard is about
    repository **data**.

    Both halves read the filesystem and git through the test's own helpers,
    **not** through the core's `paths` module, so the subject under test is
    never also the oracle (the trap
    `RepoRootTest.test_returns_none_outside_a_repository` documents).
    """
    status = git(root, "status", "--porcelain", "--untracked-files=all")
    lines = [status.stdout.decode("utf-8", "surrogateescape")]
    entries = _walk(root)
    for relative in sorted(entries):
        lines.append("%s\t%s" % (relative, entries[relative]))
    return "\n".join(lines)


@contextlib.contextmanager
def unchanged_tree(test, root):
    """Assert the working tree is byte-identical across the block.

    Sensitivity is asserted directly in `test_gitstate.py` — a cleanliness
    guard that cannot fail is the dead test this project exists to refuse — and
    it is asserted for each blind spot separately, because a guard that catches
    only *new names* is the one this replaces.
    """
    before = tree_snapshot(root)
    yield
    test.assertEqual(before, tree_snapshot(root), "the working tree changed")


class CoreTestCase(unittest.TestCase):
    """Base case that makes the core importable in-process."""

    @classmethod
    def setUpClass(cls):
        import_core()
