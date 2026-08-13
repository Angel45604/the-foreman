"""Shared helpers for the-steward test suite.

Deliberately dependency-free and sibling-skill-free (#29): nothing here reads,
imports, or shells out to any skill other than `the-steward`.
"""

import contextlib
import os
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


def tree_snapshot(root):
    """P2.4 — the cleanliness reading every read-only test asserts on.

    `git status --porcelain` **plus** the untracked-file listing, because
    porcelain collapses an untracked directory to one line: a read-only verb
    that created `docs/steward/orphans.md` inside an already-untracked `docs/`
    would leave porcelain byte-identical. It reads git through the test's own
    subprocess helper, **not** through the core's `paths.git_output`, so the
    subject under test is never also the oracle (the trap
    `RepoRootTest.test_returns_none_outside_a_repository` documents).
    """
    status = git(root, "status", "--porcelain", "--untracked-files=all")
    return status.stdout.decode("utf-8", "surrogateescape")


@contextlib.contextmanager
def unchanged_tree(test, root):
    """Assert the working tree is byte-identical across the block.

    Sensitivity is asserted directly in `test_gitstate.py` — a cleanliness
    guard that cannot fail is the dead test this project exists to refuse.
    """
    before = tree_snapshot(root)
    yield
    test.assertEqual(before, tree_snapshot(root), "the working tree changed")


class CoreTestCase(unittest.TestCase):
    """Base case that makes the core importable in-process."""

    @classmethod
    def setUpClass(cls):
        import_core()
