# HANDOFF — `the-cartographer` plan gate · 2026-08-11

> **STATUS (updated 2026-08-11, later in the same session):** plan bundle authored + owner-approved at
> design level. Both decision-class blockers **RESOLVED** by the owner (ADR C-014, C-015) and applied.
> The **10 agent-fixable blockers from round 1 have all been addressed** — the §3 table below is kept
> as a record of what was fixed and why, not as an open worklist. A re-gate is in flight.
> **YOUR JOB:** read the latest `codex-gate bundle` verdict, fix anything still open, drive it to
> APPROVE, then run the **plan-approval hard gate**. Do NOT start implementing Phase 1 before that gate
> returns the owner's structured answer.
> **GIT DISCIPLINE:** LOCAL-only. Nothing is committed yet. Never `git add -A`. No push, no PR without
> a fresh explicit ask from Angel.

---

## §0 — Onboarding read-order (do this first, cold)

1. `AGENTS.md` at the repo root if present, then this repo's `README.md` (install modes, test globs).
2. **`docs/initiatives/2026-08-11-the-cartographer/PDR.md`** — the approved design. Owner said "LGTM".
3. **`ADR.md`** — decisions C-001…C-015. **C-013, C-014, C-015 are the most recent and load-bearing.**
4. **`execution-plan.md`** — 5 phases, 11 tasks, stated as *test intent, not code* (that is deliberate;
   see C-013).
5. This handoff.

---

## §1 — Git + verification baseline (exact, copy-pasteable)

**Verified this session, 2026-08-11:**

- Repo: `<repo-root>`
- **HEAD is currently on the WRONG branch.** `git branch --show-current` → `feat/the-steward`.
  The initiative branch `feat/the-cartographer` exists at `ac0daf0` and is where this work belongs.
  Something switched it back mid-session; the bundle survived because `docs/` is **untracked**.

```bash
cd <repo-root>
git checkout feat/the-cartographer     # FIRST ACTION — verify before writing anything
git status -sb                          # expect: ## feat/the-cartographer...origin/main  +  ?? docs/
git rev-parse --short HEAD              # expect: ac0daf0
```

- `origin/main` = `ac0daf0` = every local branch tip. **No commits have been made this session.**
- `docs/` is untracked and contains **two initiatives**: `2026-07-30-prepublish-audit`,
  `2026-08-10-the-steward` (someone else's, pre-existing) **and** ours. **Never `git add docs/`** — it
  would sweep in the-steward's bundle. Stage explicit paths only.

**Verification commands (⬜ = not yet run; nothing is implemented yet):**

```bash
node --test plugin/skills/the-foreman/references/*.test.mjs plugin/skills/the-foreman/evals/*.test.mjs
bash plugin/skills/codex-gate/codex-gate.test.sh
```

⬜ Neither has been run this session — no code was written. The repo has **three** suites, not two
(the two node globs above plus the codex-gate bash suite); a stale README claims "Both suites".

---

## §2 — Mandated process (work the way this session worked)

- **`/the-foreman`** is the governing process skill. Its non-negotiables apply: run BOTH gates, render
  → surface → `AskUserQuestion` at every hard gate, conductor never implements.
- **`/codex-gate`** is the independent gate — **invoke it, never approximate it**. APPROVE is a verdict
  it emits, never one you declare.
- **`/subagent-driven-development`** for Phase 1+ execution: a fresh implementer per task (deep tier for
  judgement-heavy work), then spec-compliance review, then code-quality review. Re-verify findings
  yourself at `file:line` — do not blind-apply.
- **`/test-driven-development`** — RED first, always. This is *why* the plan ships test intent instead
  of code (ADR C-013).
- **`/systematic-debugging`** — root-cause before patching any failure.
- **`/verification-before-completion`** — re-run suites and read the diff before claiming anything done.

**⚡ ULTRACODE posture:** optimize for the most exhaustive, correct outcome; token cost is not a
constraint. Use dynamic Workflows for structurable fan-outs. Drive review adjudication yourself.

---

## §3 — The work: state + exact next steps

### What is DONE and verified

- ✅ Design approved by owner (PDR "LGTM").
- ✅ Architecture grounded via `codex-gate question` → **GROUNDED**, `settledByCanon:false`. Owner chose
  **Option A-refined** (spec-first `map.json` IR + mermaid views + mandatory text report), plus a
  bounded inline-SVG hero so the key view renders without the Artifact host.
- ✅ **ADR C-014** (owner): only `claimKind:"doc"` counts as documentation for PHANTOM/UNDOCUMENTED.
- ✅ **ADR C-015** (owner): the acceptance gate gets a **coverage floor** — the map must depict the
  subject (8 modes as nodes, 3 outcome vocabularies, dispatch edges, a rendering overview hero), not
  merely find its 6 defects. Both applied to ADR + PDR + plan already.
- ✅ Oracle anchors corrected to the **repo** copy at `ac0daf0` (see §4 gotcha 1).

### What is IN-FLIGHT (your job)

**Step 1 — ✅ DONE: these 10 agent-fixable blockers** from `codex-gate bundle` round 1 (thin altitude)
have been fixed in the bundle. Retained as a record of the reasoning; re-verify against the newest
verdict rather than assuming they are still open.
Full text: `~/.claude/codex-gate/runs/the-foreman-cc02b16e7af0/feat_the-steward/s-5e143879ead0/bundle-2026-08-11-the-cartographer/round-1-verdict.json`

| # | P | Where | Issue |
|---|---|---|---|
| 1 | P1 | plan Task 8 | CLI signature is `<map.json> <outDir>` but the same task requires the CLI always supply `repoRoot` for freshness. No root derivation specified → source paths resolve against an arbitrary cwd. |
| 2 | P1 | plan Task 3 | "both claims and evidence ⇒ no finding" contradicts STALE, which PDR §8 defines as having both. Reconcile: no *set-membership* finding, STALE only via contradiction. |
| 3 | P2 | plan Task 2/5 | Fixture must contain exactly PHANTOM + UNDOCUMENTED, but Task 5 asserts STALE styling from that fixture without mutation. No such fixture exists — add a third planted node with a contradiction, or relax Task 5. |
| 4 | P1 | plan Task 2 | Validator contract omits: schemaVersion/extractorVersion, full subject fields, several edge/view payloads, canonical ID derivation + collision handling, and a ban on uncited `inferred:false` nodes. |
| 5 | P1 | plan Task 2 | Citation bounds trust extractor-supplied `sources[].lines`; freshness only checks digests. A map can keep a correct hash, inflate `lines`, and cite past EOF. Derive line counts from the file. |
| 6 | P1 | plan Task 9 vs 11 | **Contamination:** Task 9 makes `SKILL.md` disclose that both STALE oracle findings use particular claim kinds, while Task 11 forbids giving the extractor expected classes. Generalize the SKILL.md wording. |
| 7 | P1 | plan Task 11 | Oracle pinned to `ac0daf0` but anchors may be updated from the mutable working tree, and extraction never happens *at* that revision → a fixed codex-gate silently re-baselines the oracle. |
| 8 | P1 | plan Task 11 | Each candidate renders into `.maps/codex-gate`, which is also defined as the *accepted* snapshot → a failed candidate can become the baseline. Render candidates to a scratch dir; promote only on pass. Also add a general `.maps` exclusion to the protocol. |
| 9 | P2 | plan Task 11 | Reconstruction gate promises a mechanical `jq` comparison but defines no subagent JSON schema or normalization rules → pass condition isn't executable. |
| 10 | P2 | PDR §7 | The IR example is invalid against the pinned target: `codex-gate.sh` has **2184** lines not 2186; `mode_prepr` is at **1590** not 1592; the `prepr` claim is at `SKILL.md:40` not :45; and `fn.prepr_common` uses a `kind` not in `NODE_KINDS`. |

**Step 2 — re-gate.** `cd <repo-root> && bash ~/.claude/skills/codex-gate/codex-gate.sh bundle docs/initiatives/2026-08-11-the-cartographer` (fresh thread; pass round+threadId to resume). Drive to **APPROVE**.

**Step 3 — the plan-approval hard gate.** Render `planDeck` from a the-foreman ledger, surface it
(publish via `Artifact`, else `open-artifact.mjs`), and block on an `AskUserQuestion` with **two
orthogonal decisions**: (a) approve the plan, (b) authorize scoped per-phase LOCAL commits (default
**NO**). Only then start Phase 1.

---

## §4 — Gotchas (highest-value bytes; hard-won this session)

1. **TWO copies of `codex-gate` exist and they have drifted.** `~/.claude/skills/codex-gate/` (personal,
   locally tuned) sits **1–2 lines higher** than the repo copy `plugin/skills/codex-gate/`. The
   acceptance oracle cites the **repo** copy at `ac0daf0`: `CODEX_HOME_DIR:41`, `CODEX_GATE_RUNS:42`,
   `MAX_FILE_LINES:61`, overflow message `:519`, DOC-tier comment `:1054`, `SKILL.md:91,190,346`.
   Citing the personal copy would make a *correct* extraction fail the gate. This cost a full round.
2. **`codex-gate bundle` exceeds the 600s Bash ceiling.** Run it with `run_in_background: true` and then
   block on `TaskOutput` — twice if needed. It is still synchronous work: drive it to a verdict, do not
   end the turn waiting.
3. **The run-dir path embeds the branch at invocation time.** Round 1–3 landed under
   `feat_the-cartographer/`; the last run under `feat_the-steward/` because HEAD had switched back.
   Check both paths when hunting for a verdict file.
4. **Don't re-gate a code-complete plan.** Three rounds at code altitude went 16 → 18 → 15 blockers
   without converging, because every fix was new unreviewed code. ADR C-013 records the decision to
   state test *intent* instead. **If you are tempted to paste implementation code back into the plan,
   read C-013 first.**
5. **`docs/` is untracked and shared with another initiative.** Never `git add docs/` or `git add -A`.
6. **the-foreman's `secret-scan.mjs` rejects any email-shaped string**, so any rendered artifact must
   express ownership as handles, not addresses.
7. **Verify every Codex finding yourself at `file:line`.** They have been ~100% real this session
   (I checked), but two were *my own* introduced bugs from a prior fix round — the loop can regress.

---

## §5 — Safety rails

- LOCAL commits only, and **only if** the owner authorizes them at the plan-approval gate.
- Stage explicit paths; never `git add -A`, never `git add docs/`.
- No push, no PR, without a fresh explicit ask that names the act.
- Decision-class blockers / `INFRA_ERROR` / `OVERFLOW` / non-convergence → **STOP + surface** to Angel.
- Never lower `CODEX_GATE_MODEL` / `CODEX_GATE_EFFORT` to save budget — those dials are the owner's.
