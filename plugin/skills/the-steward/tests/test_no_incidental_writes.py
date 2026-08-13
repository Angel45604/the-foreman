"""P1.8 — no incidental writes, DUAL-INTERPRETER, cache paths named exactly.

The trap this fixture exists for (`verified-contracts.md` §2.3.3, re-verified
below in `PycachePrefixDivergenceTest`): Apple's CLT 3.9.6 ships a patched
`sys.pycache_prefix` pointing at `~/Library/Caches/com.apple.python`, so **no
`__pycache__` ever appears in the repository on ADR-1's own flagship
interpreter** and a single-interpreter `git status` fixture is *vacuously
green*.

So, per interpreter:

1. the expected cache path for **every module in the core's inventory** is
   computed by `importlib.util.cache_from_source` **inside the interpreter
   under test** — that is the API that applies the prefix. Naming the prefix
   root instead is wrong twice: the root is shared and can already hold
   unrelated caches, and its emptiness says nothing about *this* source file;
2. existence and mtime of each are snapshotted **before and after**, so a cache
   that was already there is read as neither a pass nor a failure;
3. `git status --porcelain` is unchanged;
4. and the **negative control runs under both interpreters**: a *bare*
   invocation must produce **exactly** the computed `__main__` cache path and
   print the bytecode notice. Without the created file the fixture cannot tell
   "`-B` works" from "nothing was checked"; without the line, nothing proves
   the notice fires rather than being shadowed by the belt-and-braces
   assignment.
"""

import json
import os
import shutil
import subprocess
import unittest

import _support as S

S.import_core()

import inventory  # noqa: E402

READ_ONLY_VERBS = ("scan", "check", "doctor")

INTERPRETERS = (
    ("3.9-floor", S.FLOOR_PYTHON),
    ("3.13-modern", S.MODERN_PYTHON),
)

_CACHE_PROBE = (
    "import importlib.util, json, sys;"
    "print(json.dumps([importlib.util.cache_from_source(p) for p in sys.argv[1:]]))"
)


def core_module_paths(core_dir):
    return [
        os.path.join(core_dir, name)
        for name in inventory.FILES
        if name.endswith(".py")
    ]


def cache_paths_under(interpreter, module_paths):
    """Ask the interpreter under test where it would put each cache file."""
    result = subprocess.run(
        [interpreter, "-B", "-c", _CACHE_PROBE] + module_paths,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if result.returncode != 0:
        raise AssertionError(result.stderr.decode("utf-8", "replace"))
    return json.loads(result.stdout.decode("utf-8"))


def snapshot(paths):
    state = {}
    for path in paths:
        if os.path.exists(path):
            state[path] = ("present", os.stat(path).st_mtime_ns)
        else:
            state[path] = ("absent", None)
    return state


def prune_empty_parents(path, stop_after=6):
    parent = os.path.dirname(path)
    for _ in range(stop_after):
        try:
            os.rmdir(parent)
        except OSError:
            return
        parent = os.path.dirname(parent)


class PycachePrefixDivergenceTest(unittest.TestCase):
    """Re-verify the trap on this machine rather than trusting the record."""

    def test_the_two_interpreters_disagree_about_where_caches_go(self):
        for label, interpreter in INTERPRETERS:
            if not os.path.exists(interpreter):
                self.skipTest("%s missing at %s" % (label, interpreter))
        floor = cache_paths_under(S.FLOOR_PYTHON, ["/nowhere/mod.py"])[0]
        modern = cache_paths_under(S.MODERN_PYTHON, ["/nowhere/mod.py"])[0]
        self.assertNotEqual(
            floor,
            modern,
            "the two builds now agree — re-read verified-contracts.md §2.3.3 "
            "before trusting this fixture",
        )
        self.assertNotIn("/nowhere/__pycache__", floor)
        self.assertEqual("/nowhere/__pycache__/mod.cpython-313.pyc", modern)


class NoIncidentalWritesTest(unittest.TestCase):
    def setUp(self):
        self.root = S.make_git_repo()
        self.addCleanup(shutil.rmtree, self.root, True)
        self.core = os.path.join(self.root, "tools", "steward")
        os.makedirs(self.core)
        for name in inventory.FILES:
            shutil.copy(os.path.join(S.CORE_DIR, name), os.path.join(self.core, name))
        S.git(self.root, "add", "-A")
        S.git(self.root, "commit", "-q", "-m", "install core")
        self.assertEqual("", S.porcelain(self.root))

    def require(self, interpreter, label):
        if not os.path.exists(interpreter):
            self.skipTest("%s interpreter missing at %s" % (label, interpreter))

    def run_installed(self, interpreter, verb, bare=False):
        cmd = [interpreter]
        if not bare:
            cmd.append("-B")
        cmd += ["tools/steward", verb]
        env = dict(os.environ)
        env.pop("PYTHONDONTWRITEBYTECODE", None)
        return subprocess.run(
            cmd,
            cwd=self.root,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )

    def test_read_only_verbs_write_no_cache_and_no_repository_bytes(self):
        for label, interpreter in INTERPRETERS:
            self.require(interpreter, label)
            expected = cache_paths_under(interpreter, core_module_paths(self.core))
            self.assertTrue(expected)
            before_cache = snapshot(expected)
            before_git = S.porcelain(self.root)

            for verb in READ_ONLY_VERBS:
                result = self.run_installed(interpreter, verb)
                self.assertEqual(
                    0,
                    result.returncode,
                    "%s %s: %s" % (label, verb, result.stderr.decode("utf-8", "replace")),
                )
                self.assertEqual(
                    b"",
                    result.stderr,
                    "%s %s printed to stderr under -B" % (label, verb),
                )

            self.assertEqual(
                before_cache,
                snapshot(expected),
                "%s: a bytecode cache path changed" % label,
            )
            self.assertEqual(
                before_git, S.porcelain(self.root), "%s: the working tree changed" % label
            )

    def test_no_pycache_directory_appears_in_the_repository(self):
        """Belt and braces beside the computed-path assertion, not instead."""
        for label, interpreter in INTERPRETERS:
            self.require(interpreter, label)
            for verb in READ_ONLY_VERBS:
                self.run_installed(interpreter, verb)
            self.assertFalse(
                os.path.exists(os.path.join(self.core, "__pycache__")),
                "%s left a __pycache__ in the core directory" % label,
            )

    def test_the_bare_invocation_negative_control_under_both_interpreters(self):
        """Proves the assertion above is sensitive rather than pointed at a
        path nothing ever writes — which is exactly the 3.9.6 failure mode."""
        for label, interpreter in INTERPRETERS:
            self.require(interpreter, label)
            main_source = os.path.join(self.core, "__main__.py")
            expected_main = cache_paths_under(interpreter, [main_source])[0]
            if os.path.exists(expected_main):
                os.unlink(expected_main)

            # A bare run caches `__main__` **and `bootstrap`**, and nothing
            # else. `bootstrap` is the module the floor assertion itself lives
            # in, and ADR-1 requires that assertion to be the first action —
            # so it is imported before the belt-and-braces
            # `sys.dont_write_bytecode = True` can take effect. Everything
            # imported after that assignment IS suppressed, which is what the
            # `expected_others` snapshot proves. See the run report: this is a
            # real gap in ADR-1's stated mechanism (it predicts one file), not
            # a defect in the implementation of it.
            bootstrap_source = os.path.join(self.core, "bootstrap.py")
            expected_bootstrap = cache_paths_under(interpreter, [bootstrap_source])[0]
            if os.path.exists(expected_bootstrap):
                os.unlink(expected_bootstrap)

            other_modules = [
                p
                for p in core_module_paths(self.core)
                if p not in (main_source, bootstrap_source)
            ]
            expected_others = cache_paths_under(interpreter, other_modules)
            before_others = snapshot(expected_others)

            result = self.run_installed(interpreter, "scan", bare=True)
            self.addCleanup(self._remove_cache, expected_main)
            self.addCleanup(self._remove_cache, expected_bootstrap)

            self.assertEqual(0, result.returncode, label)
            self.assertTrue(
                os.path.isfile(expected_main),
                "%s: the bare invocation wrote no cache at %s — the -B "
                "assertion is pointed somewhere nothing is ever written, so it "
                "was vacuously green" % (label, expected_main),
            )
            notice = result.stderr.decode("utf-8", "replace")
            self.assertIn("-B", notice, "%s: no bytecode notice printed" % label)
            self.assertIn("suppression is off", notice, label)
            self.assertTrue(
                os.path.isfile(expected_bootstrap),
                "%s: bootstrap was NOT cached by a bare run. If that is now "
                "true the ordering changed — re-read ADR-1 before relaxing "
                "this." % label,
            )
            self.assertEqual(
                before_others,
                snapshot(expected_others),
                "%s: the belt-and-braces assignment failed — a module imported "
                "AFTER it was cached" % label,
            )
            # And here is §2.3.3's trap, made an assertion rather than a note.
            # The bare run wrote a cache under BOTH interpreters — but only one
            # of them shows it to `git status`.
            dirty = bool(S.porcelain(self.root).strip())
            inside_repo = expected_main.startswith(self.root + os.sep)
            if inside_repo:
                self.assertTrue(
                    dirty,
                    "%s: the cache landed inside the repo but git status is "
                    "clean" % label,
                )
            else:
                self.assertFalse(
                    dirty,
                    "%s: the cache landed outside the repo, so git status "
                    "must be clean" % label,
                )
                self.assertTrue(
                    os.path.isfile(expected_main),
                    "%s: a `git status` fixture would be VACUOUSLY GREEN here "
                    "— a cache was written where git cannot see it" % label,
                )

    def test_the_bytecode_notice_does_not_change_the_exit_code(self):
        for label, interpreter in INTERPRETERS:
            self.require(interpreter, label)
            written = cache_paths_under(
                interpreter,
                [
                    os.path.join(self.core, "__main__.py"),
                    os.path.join(self.core, "bootstrap.py"),
                ],
            )
            result = self.run_installed(interpreter, "check", bare=True)
            for path in written:
                self.addCleanup(self._remove_cache, path)
            self.assertEqual(0, result.returncode, label)

    def test_both_interpreters_produce_identical_output(self):
        """PDR criterion 6, at Phase-1 scope: the two builds must not diverge."""
        for _label, interpreter in INTERPRETERS:
            self.require(interpreter, "both")
        for verb in READ_ONLY_VERBS:
            floor = self.run_installed(S.FLOOR_PYTHON, verb)
            modern = self.run_installed(S.MODERN_PYTHON, verb)
            self.assertEqual(floor.stdout, modern.stdout, verb)
            self.assertEqual(floor.returncode, modern.returncode, verb)

    def _remove_cache(self, path):
        if os.path.exists(path):
            os.unlink(path)
            prune_empty_parents(path)
        pycache = os.path.join(self.core, "__pycache__")
        if os.path.isdir(pycache):
            shutil.rmtree(pycache, True)


if __name__ == "__main__":
    unittest.main()
