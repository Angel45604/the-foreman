---
name: the-refiner
description: Applies when the user asks to refine, de-slop, de-AI, simplify, or plain-rewrite existing text, remove jargon from prose, or review text for AI-sounding patterns. Does not apply to writing new copy, creative or marketing text, or code.
---

## Modes

**Rewrite** (default): output the rewritten text only. No preamble, no summary of changes.

**Review** (cue words: review, flag, diff, "what's wrong"): change nothing. Output a table with columns `Span | Category | Why | Replacement`. Output the table only. No preamble, no summary, no closing note. If nothing needs changing, output a single table row with Category `none`, the only value exempt from the rule below. Category must be one of the ten group names in references/ai-tells.md, or a group name from the core contract's Banned patterns or Voice sections. Prefer the ai-tells group name; use a core-contract group name only when no ai-tells group fits.

## Process

All references/ paths below resolve under this skill's base directory (stated when this skill loads), never under the project working directory.

1. Read the core contract at `references/core-contract.md` (its Banned patterns, Truth, and Preserve verbatim when rewriting prose sections govern every mode).
2. Read the source text for meaning.
3. Fast scan for quick smells: synonym rotation (the same idea renamed sentence to sentence), nominalization (writing "perform an analysis" where "analyze" works), marketing adjectives (ai-tells groups 3 and 7), run-on sentences (core contract: "Put one idea in each sentence"), filler connectives (ai-tells group 3), and notice-flag hedge filler (ai-tells group 4). Hedge words that carry real uncertainty are never removed or weakened.
4. Walk the text against `references/ai-tells.md`.
5. Read `references/before-after.md` before producing any output in either mode.
6. Rewrite or flag, depending on the mode.
7. Run the self-check.

## Self-check

Before returning, run this pass:

- Banned-word scan.
- Em-dash scan.
- Opener and closer scan.
- Hedge-strength diff against the source.
- Preserve-verbatim diff (identifiers byte-identical).
- Shape check: the output is the rewritten text only, or the table only; no preamble or closing note.

The rules themselves live in the core contract. This section names only the checks; it does not restate the lists.

## Boundaries

Will: rewrite or review prose, preserve every fact, hedge, and identifier. Keep the source's heading levels and list structure, rewriting only their prose; keep every code block byte-identical.

Will not: draft new copy, touch creative or marketing text, add facts, change claim strength, edit code.

The core contract ships with this skill at `references/core-contract.md`; this skill applies it to existing text, including long-form rewrites.
