# Held-out oracle run #1 — `codex-gate` @ `ac0daf0`

**Result: RECALL 4/6 — the phase does not ship.** Attempt 1 of a maximum 2 (execution-plan Task 11).

## Setup (all verified before the run)

- Subject materialised as a pinned detached worktree at `ac0daf0`; `git status --porcelain` empty and
  `git diff --quiet ac0daf0 -- plugin/skills/codex-gate` clean, so the bytes were the committed bytes.
- All six oracle anchors re-verified **inside the pinned checkout**, before the extractor ran.
- Extractor: a fresh deep-tier subagent given only `SKILL.md` and the absolute subject path, with a
  read-ban on `docs/**`, `.maps/**`, and any file named `*known-limitations*`, `*open-blockers*`,
  `*PDR*`, `*ADR*`, `*execution-plan*`, `*handoff*`, `*next-agent*`.
- Output: 91 nodes, 113 edges, 5 views, 14 sources. Validator: `VALID`. Freshness: `fresh: true`.

## Recall — 4 of 6

| # | Expected | Result |
|---|---|---|
| 1 | PHANTOM `CODEX_GATE_MAX_ROUNDS` | ✅ **FOUND**, citing `SKILL.md:91,190,346` exactly |
| 2 | UNDOCUMENTED `CODEX_GATE_MAX_FILE_LINES` | ✅ **FOUND**, citing `codex-gate.sh:61` |
| 3 | UNDOCUMENTED `CODEX_HOME_DIR` | ✅ **FOUND**, citing `codex-gate.sh:41` |
| 4 | UNDOCUMENTED `CODEX_GATE_RUNS` | ❌ **MISSED** — and it is a true positive: `grep -c CODEX_GATE_RUNS` is **0** in both `SKILL.md` and `README.md`, while the script reads it at `:42` |
| 5 | STALE `--since-reviewed` (`codex-gate.sh:519`) | ✅ **FOUND**, citing `:519` and the parser at `:1412` |
| 6 | STALE DOC-tier comment (`codex-gate.sh:1054`) | ❌ **MISSED** — `# MODE: plan  (DOC tier)` at `:1054` vs the CODE-tier path at `:1089` |

## Precision — 2 genuinely NEW defects, hand-verified

Both were unknown before this run and both hold up at their citations:

1. **`codex-gate.sh:2124` — `emit_synthetic_approve` claims a ledger write it does not perform.**
   The header comment says *"Still records the ledger (no new reviewed surface, but a coverage-complete
   pass)"*. `ledger_append` has exactly three occurrences in the file: its definition at `:641` and call
   sites at `:731` and `:1906` — **none inside `emit_synthetic_approve`**. Consequence: an empty
   `prepr-delta` APPROVE writes no ledger line, so the next delta re-reviews everything. This is the
   most consequential finding of the run and nobody had noticed it.
2. **`codex-gate.sh:23` — the file banner omits OVERFLOW from review-mode outcomes.**
   Line 23 reads `outcome ∈ APPROVE | BLOCK | INFRA_ERROR`, while line 31 (investigate) correctly lists
   OVERFLOW. Review modes do emit OVERFLOW from three paths. **Confirmed empirically the same day** — a
   `phase-review` in this very initiative returned OVERFLOW.

Per the plan, a genuine new defect is a pass and gets added to the oracle. Both qualify.

## Precision — 9 findings that are true but arguably noise

Nine UNDOCUMENTED findings landed on internal helpers (`build_manifest`, `classify_verdict_file`,
`append_context_if_present`, `main dispatch`, `assembled packet`, `phase snapshot`, `usage error`, and
the `git` / `jq` external dependencies). Each is literally correct — the helper is implemented and not
documented — but the oracle was written about *documented contracts*, not every internal function.

**This is a product finding, not an extraction error.** UNDOCUMENTED is derived mechanically from
"evidenced and no `doc` claim", so on any real subject it fires on every internal helper. That is a
design question the fixture could not surface: should the drift model scope UNDOCUMENTED to the
subject's *public contract surface* (modes, flags, env vars, outcomes) rather than every node?

## Evidence the hold-out was clean

The two misses are the strongest available signal. **A contaminated run scores 6/6.** An extractor with
the answer key would not have missed `CODEX_GATE_RUNS` — the easiest of the six — while independently
finding two defects the key does not contain.

## Blocking defect found by the run

`render.mjs` **could not produce a page at all**: the ADR C-003 timestamp guard refused the map because a
quoted README line contains the date `2026-08-01`. The guard cannot distinguish *a date quoted from the
source* from *a generation stamp we accidentally wrote*.

The extractor predicted this unprompted before it happened, flagging that `SKILL.md`'s "no timestamp
anywhere, in any spelling" is broader than the rule's purpose.

This is the top item to resolve: **no real subject can be rendered until it is.** C-003 says "Revisit if:
never — it is load-bearing for Phase 2", so narrowing it is an owner decision, not a unilateral edit.
The likely-correct narrowing is to guard date-**times** only, since a generation stamp is always a
date-time (`new Date().toISOString()`), while bare dates are ordinary source text.

## Verdict

The extraction protocol works — it found 4 of 6 planted defects unaided and 2 real new ones — but it does
not meet the shipping bar this plan set. Attempt 2 is permitted after revising `SKILL.md` (never the
answers), on a fresh extractor. After two failures, STOP and surface.
