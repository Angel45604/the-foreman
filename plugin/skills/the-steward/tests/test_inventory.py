"""The packaged core declares its own inventory (ADR-20).

Pulled forward from P6.5a into Phase 1 because **P1.8 depends on it**: the
no-incidental-writes fixture computes an expected cache path for *every module
in the core's inventory*, so the inventory has to exist before the fixture can
be written. Only the declaration and this equality test are here; the copy /
sync transitions stay in P6.5a where `generate` lives.
"""

import os
import unittest

import _support as S

S.import_core()

import inventory  # noqa: E402


class InventoryTest(unittest.TestCase):
    def actual_contents(self):
        found = []
        for base, dirs, names in os.walk(S.CORE_DIR):
            dirs[:] = [d for d in dirs if d != "__pycache__"]
            for name in names:
                if name == ".DS_Store":
                    continue
                relative = os.path.relpath(os.path.join(base, name), S.CORE_DIR)
                found.append(relative.replace(os.sep, "/"))
        return sorted(found)

    def test_the_inventory_equals_the_packaged_directory_contents(self):
        """An unlisted new module fails here rather than shipping a core that
        is missing a file, and a directory walk can never vendor a stray."""
        self.assertEqual(self.actual_contents(), list(inventory.FILES))

    def test_the_inventory_is_sorted_and_deduplicated(self):
        self.assertEqual(sorted(set(inventory.FILES)), list(inventory.FILES))

    def test_it_is_a_tuple_so_nothing_can_mutate_it_at_runtime(self):
        self.assertIsInstance(inventory.FILES, tuple)

    def test_it_contains_the_entry_point(self):
        self.assertIn("__main__.py", inventory.FILES)

    def test_every_listed_path_is_a_plain_relative_name(self):
        for name in inventory.FILES:
            self.assertFalse(os.path.isabs(name), name)
            self.assertNotIn("..", name.split("/"), name)
            self.assertTrue(os.path.isfile(os.path.join(S.CORE_DIR, name)), name)

    def test_no_bytecode_or_scratch_file_is_listed(self):
        for name in inventory.FILES:
            self.assertFalse(name.endswith(".pyc"), name)
            self.assertNotIn("__pycache__", name, name)


if __name__ == "__main__":
    unittest.main()
