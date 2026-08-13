"""P1.1 + P1.2 — the skill exists and the plugin bundles it, asserted BY NAME.

The plan is explicit that a count assertion is the wrong test: it goes stale the
moment a concurrent skill merges. Every assertion here is a superset check.
"""

import json
import os
import unittest

import _support as S

REQUIRED_BUNDLED_SKILLS = {
    "the-foreman",
    "codex-gate",
    "handoff",
    "keep-it-simple",
    "the-steward",
}

# ADR-4: no text the-steward generates, prints or documents may claim it
# protects, gates, enforces or guarantees anything. Denials of our own
# enforcement ("installs no enforcement of any kind") are explicitly permitted
# by ADR-28, so the ban is on affirmative claims, phrase by phrase.
BANNED_PHRASES = (
    "protected by the-steward",
    "enforces",
    "enforcing",
    "will enforce",
    "guarantees",
    "guaranteed",
    "blocks your",
    "gates your",
    "enforcement works",
    "there is no enforcement",
)


class SkillFileTest(unittest.TestCase):
    def setUp(self):
        self.skill_md = os.path.join(S.SKILL_DIR, "SKILL.md")

    def test_skill_md_exists(self):
        self.assertTrue(os.path.isfile(self.skill_md), self.skill_md)

    def test_frontmatter_name_matches_directory(self):
        self.assertEqual("the-steward", S.parse_frontmatter_name(self.skill_md))

    def test_description_triggers_on_both_entry_modes(self):
        text = S.read_text(self.skill_md)
        description = ""
        for line in text.split("\n"):
            if line.startswith("description:"):
                description = line.split(":", 1)[1].strip().lower()
                break
        self.assertTrue(description, "SKILL.md has no description")
        # Entry mode 1: set this repo up.
        self.assertTrue(
            any(word in description for word in ("agentize", "set up", "scaffold")),
            "description does not trigger on the setup entry mode: %r" % description,
        )
        # Entry mode 2: are these docs still true? (mid-build, not only at setup)
        self.assertTrue(
            any(word in description for word in ("still true", "out of date", "stale")),
            "description does not trigger on the verify entry mode: %r" % description,
        )

    def test_no_enforcement_claim(self):
        lowered = S.read_text(self.skill_md).lower()
        for phrase in BANNED_PHRASES:
            self.assertNotIn(phrase, lowered, "ADR-4/ADR-28 banned phrase: %r" % phrase)

    def test_every_invocation_carries_dash_b(self):
        """ADR-1: -B is part of the command, not an optimization."""
        for line in S.read_text(self.skill_md).split("\n"):
            if "tools/steward" in line and "python3" in line:
                self.assertIn(
                    "-B", line, "invocation without -B in SKILL.md: %r" % line
                )


class PluginPackagingTest(unittest.TestCase):
    def test_bundled_skills_by_name(self):
        found = set()
        for entry in sorted(os.listdir(S.PLUGIN_SKILLS_DIR)):
            skill_md = os.path.join(S.PLUGIN_SKILLS_DIR, entry, "SKILL.md")
            if os.path.isfile(skill_md):
                name = S.parse_frontmatter_name(skill_md)
                self.assertEqual(
                    entry, name, "directory %r declares name %r" % (entry, name)
                )
                found.add(name)
        missing = REQUIRED_BUNDLED_SKILLS - found
        self.assertEqual(set(), missing, "skills not bundled: %s" % sorted(missing))

    def test_plugin_json_names_the_steward(self):
        path = os.path.join(S.PLUGIN_DIR, ".claude-plugin", "plugin.json")
        data = json.loads(S.read_text(path))
        self.assertIn("the-steward", data["description"])

    def test_marketplace_json_names_the_steward(self):
        path = os.path.join(S.REPO_ROOT, ".claude-plugin", "marketplace.json")
        data = json.loads(S.read_text(path))
        entry = [p for p in data["plugins"] if p["name"] == "the-foreman"][0]
        self.assertIn("the-steward", entry["description"])

    def test_readme_documents_the_steward(self):
        text = S.read_text(os.path.join(S.REPO_ROOT, "README.md"))
        self.assertIn("the-steward", text)
        self.assertIn("/the-foreman:the-steward", text)
        # The personal-symlink loop must include it or the local loop skips it.
        loop = [ln for ln in text.split("\n") if ln.startswith("for s in ")]
        self.assertEqual(1, len(loop), "expected exactly one symlink loop line")
        self.assertIn("the-steward", loop[0])

    def test_readme_documents_the_test_command(self):
        text = S.read_text(os.path.join(S.REPO_ROOT, "README.md"))
        self.assertIn("plugin/skills/the-steward/tests", text)


if __name__ == "__main__":
    unittest.main()
