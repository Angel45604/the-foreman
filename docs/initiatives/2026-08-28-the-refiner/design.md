# the-refiner joins the family: Design (PDR)

Date: 2026-08-28 · Status: decisions taken at structured gates (name, bundle depth, wiring)
Owner: Angel · Branch: feat/the-refiner off origin/main (7d9e882, rebased 2026-08-28 after a stale-base finding), linked worktree
`/Users/angel/personal/the-foreman-refiner` (matches the repo's existing worktree convention;
the live feat/the-cartographer checkout stays untouched).

## Goal

Ship the proven plain-prose system as **the-refiner**, a bundled member of the-foreman
plugin family, and seat it in the conductor's cycle at two seams. Keep Angel's personal
install in sync.

## Decisions (structured gate answers, 2026-08-28)

1. Name: **the-refiner** (field of 11 candidates; Codex leaned the-editor on contract
   accuracy, Angel chose the-refiner: removes impurities, conserves the substance).
2. Bundle depth: **full bundle**, canonical skill in `plugin/skills/the-refiner/`, a
   packaged rule source, and the plugin ships Plain Voice as an OPTIONAL, non-forced
   output style. Rationale: the personal skill's Process step 1 reads a personal absolute
   path that other plugin users do not have.
3. Cycle wiring: **ledger + handoff seams only** (Codex-grounded): deep rewrites of ledger
   SOURCE prose delegate to the-refiner before rendering (never the generated twin), and
   handoff/kickoff text gets a Review pass before banking. No new hard gate: canon fixes
   the set at five.

## Architecture

- `plugin/skills/the-refiner/SKILL.md`, the ported skill (Rewrite and Review modes,
  unchanged contract) with one structural delta: Process step 1 reads the PACKAGED
  `references/core-contract.md` instead of a personal path. The description keeps the
  proven trigger conditions and gains the "refine this text" cue.
- `plugin/skills/the-refiner/references/core-contract.md`, the five contract sections
  (Voice, Banned patterns, Truth, Preserve verbatim when rewriting prose, Scope), the
  plugin's canonical rule source.
- `plugin/skills/the-refiner/references/ai-tells.md`, `references/before-after.md`:
  the personal SOURCES are corrected FIRST (a bundle review found examples that weaken
  checkable claims, contradicting the skill's own truth invariant; the corrections are
  enumerated in the plan, snapshot-guarded, and the truth invariant itself is
  UNCHANGED), then ported byte-identically except self-references (the plain-writing
  name and the personal style path become the-refiner and the packaged contract path).
- `plugin/output-styles/plain-voice.md`, the optional always-on layer: frontmatter
  (`name: Plain Voice`, `keep-coding-instructions: true`) + the SAME five sections + the
  Diagnostics canary. NOT force-for-plugin; users opt in via their own outputStyle setting.
- Drift guard, repo idiom: `plugin/skills/the-refiner/references/core-contract.test.mjs`
  (node:test) asserts the output style contains the core-contract body verbatim, so the
  two shipped copies cannot drift.
- Conductor wiring: the-foreman SKILL.md delegate list + one sentence at the §4 authoring
  contract + one sentence in §5; lifecycle.md delegate list; README family list (four →
  five, claims kept truthful per the repo's claim rules).
- Personal sync: `~/.claude/skills/plain-writing/` becomes `~/.claude/skills/the-refiner/`
  with the same packaged-contract delta; the personal output style's Scope pointer line
  names the-refiner; the auto-memory entry updates.

## Verification

Recorded baseline on 7d9e882 before planning: node suite fail 0; codex-gate shell suite PASS=441 FAIL=0.
Free checks throughout the port (the contract itself is unchanged and was live-verified
on 2026-08-28): full repo test suite green including the new drift test, the fail-closed
port-fidelity byte derivation, structural sweeps, and the personal skill listing showing
the-refiner. PLUS exactly one separately gated paid check: the seam-isolation behavioral
eval (two calls, executor plus judge), which runs ONLY behind a live-run gate with fresh
authorization; a failure stops, is diagnosed free, and any retry needs a new
authorization stating the exact call count.

## Non-goals

No changes to the prose CONTRACT (the five core sections are untouched; the enumerated
example corrections make the shipped examples OBEY that contract, which is a defect fix,
not a contract change). No force-for-plugin. No new hard gate. No
marketplace version bump in this initiative (version/release flow is the repo's own
`version-bump` process, run separately when Angel ships).
