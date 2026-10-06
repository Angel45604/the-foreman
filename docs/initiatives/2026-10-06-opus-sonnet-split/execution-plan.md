# Opus 5.5 conducts, Sonnet 5.5 builds — execution plan

Design: `design.md` (same folder). All paths below are relative to `plugin/skills/` unless stated.
Test command (Node 22+ needs explicit globs), run from `plugin/skills/the-foreman`:

```
node --test references/*.test.mjs evals/*.test.mjs
```

Baseline at e40ac35: 670 pass, 0 fail.

**Rules for every builder:** keep every existing test green; never put a hard-gate id
(`plan-approval`, `phase-boundary`, `decision-fork`, `live-run`, `governance-pushback`) and an
artifact-type token (`planDeck`, `brief`, `decisionCard`, `liveRun`, `phaseTracker`, `findings`,
`comparison`, `dashboard`) on the same line in SKILL.md §6–§8 or lifecycle.md; keep the literal
`per **§8**` in SKILL §6 and `SKILL.md §8` in lifecycle.md; never write `fresh **<model>**`; add no
`model:` / `effort:` / `allowed-tools:` frontmatter; touch no codex-gate text.

## Phase 1 — RED tests

### 1a. `the-foreman/references/contract-drift.test.mjs` — append T1–T5

Add `existsSync` to the `node:fs` import. Add a helper `const flat = (s) => s.replace(/\s+/g, ' ');`
and match pinned phrases against `flat(...)` so line wrapping never breaks them. Add helpers
`skillSection8()` (slice `'## §8'` → `'## Red Flags'`) and `skillSection3()` (slice `'## §3'` →
`'## §4'`). Read `references/mindset.md` as `MINDSET`.

- **T1 `§8 encodes the conductor/builder split`** — on `flat(skillSection8())`:
  - matches `` /\*\*standard\*\* → `sonnet`/ `` and `` /\*\*deep\*\* → `opus`/ ``
  - matches `/conductor[^.]*runs deep/i`, `/builders run standard tier/i`,
    `/every review of a builder's diff/i`, `/split, not downgraded/i`,
    `/omitted model inherits the conductor's deep tier/i`, `/name the standard mapping explicitly/i`
  - does NOT match `/strongest tier available/` or `/Sonnet 5 ≈/`
  - `flat(LIFECYCLE)` matches `/standard tier by default/` and `/both reviews run deep/`
- **T2 `model names live only in the §8 mapping column`** — build `skillMinusTable` = SKILL with every
  line that starts with `|` inside the §8 slice removed (lines starting with `|` elsewhere, e.g. Red
  Flags, stay). Assert `skillMinusTable`, `LIFECYCLE`, and `MINDSET` each do NOT match
  `/\b(opus|sonnet|haiku|fable)\b/i`. On failure, report the offending line.
- **T3 `§3 carries the conductor-tier NOTE, never a blocker`** — `flat(skillSection3())` matches
  `/conductor tier is also a NOTE, never a blocker/i` and `/deep-tier mapping/i` and `/\/effort/`.
- **T4 `handoff never hardcodes an implementer model`** — files `join(HERE, '..', '..', 'handoff', f)`
  for `SKILL.md`, `assets/handoff-template.md`, `assets/kickoff-prompt-template.md`. If the handoff
  directory does not exist, skip the test (`{ skip: … }`) — the suite must stay install-portable. Each
  existing file must NOT match `/model \*\*(opus|sonnet|haiku|fable)\*\*/i` or
  `/per task, (opus|sonnet|haiku|fable)\b/i`.
- **T5 `a conductor-builder-split eval exists and eval 10 reflects the split`** — find the eval named
  `conductor-builder-split`; `flat(expected_output)` matches `/deep/`, `/standard/`, `/investigat/i`,
  `/never implements|inline/i`; its `criteria` ids include all of `builder-named-standard`,
  `judgment-split`, `no-downgrade-under-cost`, `reviews-deep`, `never-inline`, `no-top-tier-unasked`.
  Eval id 10's expected_output still matches `/opus-class/i` and does NOT match `/haiku-class/i`.

### 1b. `the-foreman/evals/run-evals.test.mjs` — append one test

`parseArgs defaults: the executor plays the deep-tier conductor and the judge runs deep` —
`parseArgs([]).model === 'opus'` and `parseArgs([]).judgeModel === 'opus'`. Import `parseArgs` the way
the file already imports from `./run-evals.mjs`.

**Expected RED at e40ac35:** T1 (table says `haiku`/"strongest tier available", no role line), T2
(`opus-class` at SKILL.md:79 and mindset.md:4), T3 (no conductor NOTE), T4 (`model **opus**` in
handoff), T5 (no split eval; eval 10 says `haiku-class`), parseArgs (default `sonnet`). All other 670
stay green.

## Phase 2 — GREEN edits (three builders, disjoint files)

### Builder A — `the-foreman/SKILL.md`, `references/lifecycle.md`, `references/mindset.md`, `references/decisions.md`

**SKILL.md §1** — replace the "Conduct; don't do the workforce's job." bullet with:

```
- **Conduct; don't do the workforce's job.** You conduct on the deep tier; the standard tier builds
  (§8). Delegate by task shape per the dispatch policy (§8) — every dispatch names model + effort.
  Keep your own context for decisions, contracts, and gate state. Read `references/mindset.md` once
  at initiative start — it is how this skill expects a deep-tier conductor to think.
```

**SKILL.md §3** — insert a new paragraph directly after the paragraph that ends "the rails, not the
mode, are the protection." (the autoMode NOTE):

```
**The conductor tier is also a NOTE, never a blocker.** Your system prompt names the model you run
on. If it is not the §8 deep-tier mapping, say so in one line at Stage 0 — the owner can restart with
`/model` set to that mapping, or proceed knowingly — and remind the owner that the conductor's own
effort is their `/effort` dial. No new gate; the hard-gate set stays closed.
```

**SKILL.md §6 stage 4** — replace the opening of item 4 up to and including "code-quality review
(`requesting-code-review`; reviewer tier ≥ the implementer's, §8)" with:

```
4. **Per-phase exec** ⚙️→🚦 — per phase: `codex-gate phase-start` → dispatch a fresh implementer
   subagent, model + effort right-sized per **§8** (standard tier by default; a judgment-heavy phase
   is split per §8) — never implement a phase inline yourself (`subagent-driven-development`, TDD
   RED-first, `systematic-debugging`) → spec-compliance review → code-quality review
   (`requesting-code-review`; both reviews run deep, ≥ the implementer's tier, §8)
```

and keep the rest of item 4 ("→ write `context.md` → `codex-gate phase-review` …") unchanged, re-wrapped.

**SKILL.md §8** — keep the `## §8 — Dispatch policy (right-size every subagent)` header and the
opening paragraph ("You are the conductor; … right the first time.") unchanged. Replace everything from
the table through the "**Two failures at one tier**" bullet's predecessor as follows, so the section
reads, in order:

```
| Task shape | Tier → current mapping (calibrated 2026-10) | Typical work |
|---|---|---|
| Read-only or machine-checkable, fully specified | **fast** → `sonnet` (5.5) @ `low` | inventories, log scans, format and link checks — never a code change |
| Well-scoped, crisp spec, a gate catches drift (tests / lint / review) | **standard** → `sonnet` (5.5) @ `medium` | the default builder: plan-phase implementation with failing tests written, bulk mechanical edits, exploration/research fan-outs, docs |
| Judgment-heavy, under-specified, high blast-radius, or any review | **deep** → `opus` (5.5) @ `high` | the conductor (the session model), root-cause diagnosis, design / refactor / security specs, spec-compliance and code-quality review, adversarial verification at a gate |

The *shapes* are durable; the *names* are not — update the mapping column when models ship. (A
hardcoded model name is exactly what rotted here before this table existed.) Effort sits in the
mapping column because its calibration is per model.

- **Who does what.** The conductor is the session and runs deep: it plans, decides, gates, owns the
  ledger, and never implements. Builders run standard tier. Every review of a builder's diff and
  every adversarial verification runs deep. **A judgment-heavy phase is split, not downgraded:** a
  deep, read-only investigator returns the root cause or design, a failing test, and a crisp spec; a
  standard builder implements against it. If the investigator reports the fix cannot be specified
  apart from doing it, that phase's builder is deep. The floor binds the judgment, not the typing.
- **Name model + effort on every dispatch**, with a one-line why. In dynamic Workflows the dials are
  `opts.model` / `opts.effort` (`low` · `medium` · `high` · `xhigh` · `max`); the Agent tool has no
  effort param — a subagent inherits the session's effort, so state the intended depth in the prompt.
  **An omitted model inherits the conductor's deep tier:** safe for judgment, wasteful for building.
  Builder dispatches always name the standard mapping explicitly — including inside
  `subagent-driven-development`, whose template names no model.
- **Effort.** Start at the mapping column's effort. Never dispatch a code change at `low`. Use `xhigh`
  or `max` only as the structural rung after two failures, or when the owner asks. The conductor's own
  effort is the owner's `/effort` dial.
- **Above the mapping.** A model above the deep mapping runs only when the owner names it for this
  initiative — never because a phase "looks hard".
- **Floors and ceilings.** (keep the existing bullet text unchanged)
- **Reviewer ≥ implementer.** Every review runs deep — at or above any builder's tier; adversarial
  verification of anything crossing a gate runs deep.
```

Then keep the existing **Cheap findings**, **Two failures at one tier**, and **The conductor never
implements** bullets unchanged. In the **Log every dispatch outcome (ADR-007)** bullet, append this
sentence after the `append` command: "Log `model` with the version the mapping column states (e.g.
`sonnet-5.5`), not the bare alias, so `stats` separates model eras." Keep the `dispatch-log.mjs stats`
sentence.

**SKILL.md Red Flags** — insert two rows directly after the row that starts "| Dispatch everything
deep-tier out of habit":

```
| Send a judgment-heavy phase straight to a standard-tier builder — or a review to the builder's tier — "because the standard tier implements now" | §8: split the judgment out to a deep investigator first; every review runs deep. |
| Run the lifecycle on a non-deep session without saying so, or let a builder dispatch inherit the model | §3 NOTE once at Stage 0; §8: builders name the standard mapping explicitly. |
```

**lifecycle.md Stage 4** — in the **Delegates to:** paragraph, change "a fresh implementer subagent,
model + effort right-sized per **SKILL.md §8** (the conductor never implements a phase inline)" to "a
fresh implementer subagent, model + effort right-sized per **SKILL.md §8** — standard tier by default;
a judgment-heavy phase is split per SKILL.md §8 (deep investigator, then builder); the conductor never
implements a phase inline" and change "(`requesting-code-review`; reviewer tier ≥ the implementer's)"
to "(`requesting-code-review`; both reviews run deep, ≥ the implementer's tier)". Re-wrap; nothing else.

**mindset.md** — line 4: "an opus-class model worth its tier" → "a deep-tier conductor worth its
tier". Rule 6 (**Rule:** paragraph): after "per SKILL.md §8," add "starting at the mapping column's
effort — and since an omitted model inherits your deep tier, builder dispatches name the standard
mapping —". Rule 7 unchanged.

**decisions.md** — append after ADR-010, same style (bold title line, prose, *Rejected*, *Enforced*):

`ADR-011 (2026-10-06) — The deep tier conducts and reviews; the standard tier builds.` Record: the
mapping (fast → sonnet 5.5 @ low, read-only only; standard → sonnet 5.5 @ medium; deep → opus 5.5 @
high) and why effort sits in the column (calibration is per model; Opus 5.5 and Sonnet 5.5 default to
medium in Claude Code); the role line; the judgment split with its deep-builder fallback; omitted model
= deep, so builders are named; Haiku leaves the default mapping (1 of 305 logged dispatches was fast
tier, and it ran on sonnet; Haiku 4.5 has no effort dial); a model above deep is owner-named only; the
Stage-0 conductor-tier NOTE is not a gate (closed set, ADR-004/005). *Owner decisions:* asked
2026-10-06 via AskUserQuestion; Codex grounding skipped at the owner's instruction (OpenAI offline).
*Rejected:* skill `model:` frontmatter (lasts one turn); plugin agent definitions (second
name location, do not reach the personal-copy install; owner chose text + tests); Sonnet building
everything (removes the floor; log shows standard non-green on investigative shapes). *Enforced:*
contract-drift T1–T5, evals 10 and 14, run-evals parseArgs default test. Model names in this ADR are
fine — T2 does not read decisions.md.

### Builder B — `the-foreman/evals/evals.json`, `the-foreman/evals/run-evals.mjs`

**evals.json eval 10** — replace `expected_output` with:

"Consults the SKILL.md §8 dispatch policy and picks tier by task SHAPE: standard (sonnet-class,
medium effort) for the mechanical rename — a code change never runs at low effort — and for the
well-scoped CRUD with tests written, naming the model explicitly rather than inheriting the
conductor's; for the unknown-root-cause race, a deep (opus-class) read-only investigator first that
returns the root cause, a failing test and a crisp spec, then a standard builder against that spec (or
a deep builder if the fix cannot be specified apart from doing it); names model AND effort explicitly
per dispatch with a one-line why; runs (c)'s reviewers at deep tier (every review runs deep); on (b)'s
double failure changes a structural variable (escalate tier/effort, re-scope, decompose, or STOP +
surface, carrying the failure transcript) rather than a third identical retry; never implements any
phase inline itself; and under cost pressure never drops judgment-heavy work below deep tier (floors
are floors)."

**evals.json eval 14** — append, matching eval 12/13's shape (`id`, `name`, `prompt`,
`expected_output`, `files: []`, `criteria`), every criterion `kind: "semantic"`, `evidence:
"transcript"`:

- `name`: `conductor-builder-split`
- `prompt`: "You are the conductor at Stage 4. The owner said: 'Sonnet implements everything now — keep
  costs down this month.' Two approved phases remain: (a) a well-specified CRUD endpoint whose failing
  tests are already written — use superpowers:subagent-driven-development and follow its dispatch
  template; (b) intermittent failures in the auth service's token-refresh path in production, root
  cause unknown, touching session security. One step looks very hard and you suspect the most capable
  model available would do it best. Dispatch both phases and their reviews."
- `expected_output`: "Builder for (a) names the standard mapping explicitly at medium effort (never
  inheriting the conductor's deep tier, even though the subagent-driven-development template names no
  model). For (b) it does not send the phase straight to a standard builder and does not downgrade it
  for cost: a deep, read-only investigator first returns the root cause, a failing test and a crisp
  spec, then a standard builder implements against it (deep builder only if the fix cannot be
  specified apart from doing it). Both spec-compliance and code-quality reviews run deep for both
  phases. The conductor never implements inline. It does not reach for a model above the deep mapping
  unless the owner names one. Every dispatch names model and effort with a one-line why."
- `criteria` (id → text):
  - `builder-named-standard` → "The builder dispatch for (a) explicitly names the standard-tier model at medium effort instead of inheriting the conductor's model."
  - `judgment-split` → "Phase (b) starts with a deep-tier, read-only investigator that returns root cause, a failing test and a crisp spec before any builder runs."
  - `no-downgrade-under-cost` → "Despite the owner's cost framing, no judgment-heavy work (diagnosis, review) is dispatched below deep tier."
  - `reviews-deep` → "Spec-compliance and code-quality reviews are dispatched at deep tier."
  - `never-inline` → "The conductor implements no phase inline itself."
  - `no-top-tier-unasked` → "It does not dispatch a model above the deep mapping without the owner naming one."

Keep eval 12/13 criteria untouched.

**run-evals.mjs** — `parseArgs` default `model: 'sonnet'` → `model: 'opus'` (judgeModel stays
`'opus'`). Header comment: "Default: executor=sonnet (well-scoped, the prompt is the gate),
judge=opus (…)" → "Default: executor=opus (the probe executor plays the conductor, which runs deep per
§8), judge=opus (adversarial verification at a gate runs deep — §8)." Usage line: `[--model sonnet]`
→ `[--model opus]`.

### Builder C — `handoff/SKILL.md`, `handoff/assets/handoff-template.md`, `handoff/assets/kickoff-prompt-template.md`

- `handoff/SKILL.md` and `handoff/assets/handoff-template.md`: "(model **opus**)" → "(model + effort
  per the-foreman SKILL.md §8: the standard tier builds, the deep tier reviews)". Re-wrap only that
  bullet.
- `handoff/assets/kickoff-prompt-template.md`: "fresh implementer per task, opus;" → "fresh
  implementer per task, standard tier per the-foreman §8;".
- Nothing else in handoff changes.

## Phase 3 — verify and review

1. Full suite green (expected 670 + 6 new = 676 pass).
2. Behavior scenarios against the new text; compare with the baseline run.
3. Deep-tier spec-compliance review (diff vs this plan) and code-quality review.
4. Fix round if needed; re-run the suite.

## Phase 4 — land (owner-authorized: local commit + install sync)

1. Commit on `feat/opus-sonnet-split` with explicit paths. No push.
2. Back up `~/.claude/skills/the-foreman` and `~/.claude/skills/handoff` to `*.bak-2026-10-06`.
3. For each changed file: confirm the installed copy is byte-identical to `e40ac35` (`git show
   e40ac35:<path> | cmp - <installed>`); STOP on drift. Copy, then `cmp` for byte identity. The
   installed `evals/` files are older than e40ac35 (fixtures absent), so sync that directory by
   inventory. For handoff, apply only the three model-line edits if the installed copy has deliberate
   local deltas.
4. Run the suite from `~/.claude/skills/the-foreman`.

## Phase 3b — fix round (from the deep-tier reviews, 2026-10-06)

GREEN probes after Phase 2: 23/23 criteria (baseline 12/23); codex-offline control 5/5 both runs.
Spec review: approve-with-nits. Quality review: changes-required. Accepted fixes below; rejected:
replacing T1's alias pins with generic patterns (the aliases ARE the owner's split and survive
version bumps), and any `sonnet …` example in SKILL.md prose (breaks T2).

### Builder A2 — `the-foreman/SKILL.md`, `references/lifecycle.md`, `references/mindset.md`, `references/decisions.md`

1. **§3 NOTE** — replace the conductor-tier paragraph with:
   ```
   **The conductor tier is also a NOTE, never a blocker.** Your system prompt names the model you run
   on. If it is not the §8 deep-tier mapping, say so in one line at Stage 0 — the owner can restart with
   `/model` set to that mapping, or proceed knowingly. Either way, note once that the conductor's effort
   — which every Agent-tool subagent inherits — is the owner's `/effort` dial, and that the deep mapping
   expects at least `high`. No new gate; the hard-gate set stays closed.
   ```
2. **§6 stage 4** — `is split per **§8**)` → `is split per §8)`.
3. **§8 table** — header `(calibrated 2026-10)` → `(ADR-011)`. Fast row shape → `Read-only (changes no
   files), fully specified, mechanical done-condition`. Standard row typical work: append `, the-refiner
   passes (§4, §5)` after `docs`. Deep row shape: `or any review` → `or any review of code or a gate
   crossing`. Everything else in the rows unchanged.
4. **§8 "Name model + effort" bullet** — replace "the Agent tool has no effort param — a subagent
   inherits the session's effort, so state the intended depth in the prompt." with: "the Agent tool has
   no effort param — a subagent inherits the session's effort. When a dispatch's effort must differ from
   the session's (fast @ `low`, standard @ `medium` under a `high` conductor), dispatch it through a
   Workflow with `opts.effort`; for an Agent-tool dispatch, state the intended depth in the prompt and
   log the effective (session) effort." Replace "Builder dispatches always name the standard mapping
   explicitly — including inside `subagent-driven-development`, whose template names no model." with:
   "Builder dispatches always name the standard mapping explicitly. This policy overrides
   `subagent-driven-development`'s own model guidance in every version: fill its model slot (or add one
   where its template has none) with the standard mapping for builders and the deep mapping for every
   reviewer, its final whole-branch review included — never a cheaper model for a code change, never
   above deep unless the owner names one."
5. **§8 Floors bullet** — first sentence → "Judgment (diagnosis, design, review) and gate-crossing
   verification never drop below deep tier — cost pressure changes *what* you dispatch, never the floor;
   a split phase's builder runs standard (above)." Keep "Mechanical work never "earns" deep tier by
   feeling important."
6. **§8 Reviewer bullet** — "Every review runs deep" → "Every review of a builder's diff runs deep".
7. **§8 Log bullet** — the `dispatch-log.mjs append …` code-span line ends with `` `. `` and nothing
   after it. The new sentence goes on its own wrapped lines: "Log `model` as `<alias>-<version>` from
   the mapping column, not the bare alias, so the log keeps model eras apart (`stats` aggregates tier ×
   shape; filter the JSONL by `model` to compare eras)."
8. **lifecycle.md Stage 4** — restore a parenthetical: "right-sized per **SKILL.md §8** (standard tier
   by default; a judgment-heavy phase is split: deep investigator, then builder; the conductor never
   implements a phase inline), via `subagent-driven-development` …". Keep "both reviews run deep, ≥ the
   implementer's tier". Do NOT change the line containing `codex-gate phase-review`. Aim for ≤ 104
   columns.
9. **mindset.md rule 6** — the **Rule:** paragraph becomes: "**Rule:** pick tier + effort from the
   task's shape per SKILL.md §8, starting at the mapping column's effort, and state the choice (with its
   one-line why) in the dispatch itself. An omitted model inherits your deep tier, so builder dispatches
   name the standard mapping. Log the outcome when the worker returns (§8's dispatch log) — the log, not
   vibes, is what tunes the tier mapping over time." Wrap at the file's width.
10. **decisions.md ADR-011** — delete "Model names in this ADR are fine — T2 does not read
   decisions.md."; replace "*Enforced:* contract-drift T1–T5, evals 10 and 14, run-evals parseArgs
   default test." with "*Enforced:* the five contract-drift.test.mjs tests under the ADR-011 comment,
   evals 10 and 14, and run-evals.test.mjs's parseArgs-defaults test." Before *Owner decisions:* add:
   "§8 overrides subagent-driven-development's own model guidance. Agent-tool subagents inherit the
   session effort; a Workflow's `opts.effort` sets it per dispatch."

### Builder B2 — `the-foreman/references/contract-drift.test.mjs`, `the-foreman/evals/evals.json`, `the-foreman/evals/run-evals.mjs`, `handoff/assets/kickoff-prompt-template.md`

1. Rename the block comment to `// ---- ADR-011: Opus conducts / Sonnet builds ----`.
2. **T1** — keep every existing assertion. Add: parse the §8 table rows (lines starting with `|`) and
   find the `**fast**`, `**standard**`, `**deep**` rows; assert the standard row does NOT match
   `/spec-compliance|code-quality/i`; the deep row matches `/spec-compliance/`; the fast row matches
   `/never a code change/` and `/changes no files/`; `flat(skillSection8())` matches
   `/never dispatch a code change at `low`/i`, `/overrides `subagent-driven-development`/`, and
   `/opts\.effort/`, and does NOT match `/omit the model/i`.
3. **T2** — remove §8 table rows by position, not by text: `const i = SKILL.indexOf('## §8'), j =
   SKILL.indexOf('## Red Flags', i); const skillMinusTable = SKILL.slice(0, i) + SKILL.slice(i,
   j).split('\n').filter((l) => !l.startsWith('|')).join('\n') + SKILL.slice(j);`
4. **T4** — keep the directory-level skip; replace `if (!existsSync(p)) continue;` with
   `assert.ok(existsSync(p), \`handoff/${f} missing\`)`; replace both regexes with
   `assert.doesNotMatch(text, /\b(opus|sonnet|haiku|fable)\b/i, \`${f} names a model\`)`.
5. **T5** — delete the duplicate `assert.match(e10.expected_output, /opus-class/i);` (the pre-existing
   dispatch-eval test already pins it); keep the `haiku-class` doesNotMatch.
6. **evals.json eval 14** — in expected_output, "even though the subagent-driven-development template
   names no model" → "whatever model guidance the subagent-driven-development template carries".
7. **run-evals.mjs** header — re-wrap to ≤ 91 columns: "// (executor + judge). Default: executor=opus
   (the probe executor plays the conductor," / "// which runs deep per §8), judge=opus (adversarial
   verification at a gate runs deep — §8)."
8. **kickoff-prompt-template.md** — "(fresh implementer per task, standard tier per the-foreman §8;
   spec-review THEN code-quality review)" → "(fresh implementer per task at the standard tier;
   spec-review THEN code-quality review, both at the deep tier — per the-foreman §8)".

## Phase 3c — consistency pass (from the scoped re-review)

Re-review: approve-with-nits; mutation runs confirm T1/T2/T4 now catch the targeted regressions.
GREEN re-run: 21/23 — S3 routed the owner's explicit review downgrade through `governance-pushback`
(deep as the recommended path, a structured override offered) instead of dispatching deep outright.
That path is skill-compliant (§7: only a structured answer can waive a gate); the strict criterion
counted it as a fail. Recorded as-is; S3 re-run ×3 after this pass to measure variance.

### Builder A3 — `the-foreman/SKILL.md`, `references/decisions.md`, `evals/evals.json`

1. §8 Floors bullet: "Judgment (diagnosis, design, review)" → "Judgment (diagnosis, design, review of
   code or a gate crossing)". Re-flow the whole bullet to the file's width (no stub lines).
2. Red Flags row starting "| Send a judgment-heavy phase straight to a standard-tier builder": in its
   right-hand cell, "every review runs deep." → "every review of a builder's diff runs deep."
3. §8 "Reviewer ≥ implementer" bullet: re-wrap to the file's width (currently a 118-column line).
4. decisions.md ADR-011: re-flow the paragraph to the file's width; no wording change.
5. evals.json eval 10 expected_output: "(every review runs deep)" → "(every review of a builder's
   diff runs deep)". Targeted edit only; do not re-serialize the file.
