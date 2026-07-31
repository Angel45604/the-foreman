<!--
  HANDOFF DOC TEMPLATE — the DEEP artifact the fresh agent reads cold.
  Fill every [bracket] from real ground truth (Step 1). Delete this comment and any sections that
  genuinely don't apply. Keep claims evidence-true: ✅ = verified this session, ⬜ = assumed.
-->

# Handoff — [project / feature] : [the phase / scope you're handing off]

> Cold-start handoff for a FRESH agent with ZERO context. **Status: [what's DONE + verified].**
> **Your job: [what the next agent owns].** Read §0 in order — this doc is self-sufficient.
> **Git discipline: [e.g. LOCAL commits only; no push/PR without the user's explicit ask].**

---

## 0. Onboarding (do this first, in order)
1. **`AGENTS.md`** (repo root) — [the contracts that actually bite on this task].
2. **[downstream `AGENTS.md` / `CLAUDE.md`]** — [routing for this area].
3. **[the plan / design bundle / spec]** — `[path]` — [what to read in it; ⚠️ what must NEVER be staged].
4. **[auto-memory entry, if any]** — `[name]` — [the one relevant paragraph].
5. **This doc's §3 is the primary spec.**

## 1. Working dir / git / verification baseline
- Dir / worktree: `[path]`, branch `[branch]`. **HEAD = `[sha]`.** Verify: `git -C [path] log --oneline -3`.
  Tree [clean / dirty except [list]].
- **[git discipline restated].** **Never stage `[X]`.** [pushed vs local-only].
- Verification commands (with LAST ACTUAL result — ✅ verified this session / ⬜ assumed):
  - `[test cmd]` → **[N/N ✅]**
  - `[lint cmd]` → **[exit 0 ✅]**
  - `[build / catalog / other]` → **[result]**

## 2. Mandated process (the workflow to INHERIT — the user requires ALL of these)
- **`/superpowers:subagent-driven-development`** — a fresh implementer subagent per task (model **opus**); after
  each: **spec-compliance review THEN code-quality review**. Give it the full task text + exact file
  anchors (it has zero context). Re-verify yourself — do NOT trust subagent reports.
- **`/superpowers:test-driven-development`** — RED first (failing test, watch it fail), then implement.
- **`/superpowers:systematic-debugging`** — root-cause before patching any failure.
- **`/superpowers:verification-before-completion`** — re-run the suites + read the diff yourself before claiming done.
- **invoke `codex-gate` (listed bare or as `the-foreman:codex-gate` depending on install) per phase** — the independent second gate. Run BOTH gates. [session evidence, e.g.
  "it caught N real bugs the Claude reviews missed"].
- **⚡ ULTRACODE effort is ON** — optimize for the most exhaustive, correct outcome; token cost is not a
  constraint. **Use dynamic Workflows** for the structurable parts (e.g. a parallel-reader "understand"
  fan-out to map the surfaces before you spec tasks). Drive the per-task review loop yourself
  (adjudication isn't a fan-out). Don't workflow the trivial / handoff-style bits.

## 3. The work — current state + exact next steps
[Where you are, `path:line` grounded. What's DONE + verified vs in-flight. Then the precise next
actions, in order — phase by phase if the work is phased. Be specific enough that the fresh agent can
start without re-deriving anything.]

## 4. Gotchas / hard-won lessons (so the next agent doesn't rediscover them)
[The operational lessons from THIS session — the highest-value part of the handoff. Concrete:
data contracts, env/flag requirements, "run tests under node not bunx", codex-gate base/excludes/
fresh-session-per-round, the trap you already fell into and climbed out of.]

## 5. Safety rails
[🛑 The irreversible / expensive things NOT to do without the user — e.g. never trigger a real paid
run (test with mocks), no push/PR without an explicit ask, never commit `[X]`.]
