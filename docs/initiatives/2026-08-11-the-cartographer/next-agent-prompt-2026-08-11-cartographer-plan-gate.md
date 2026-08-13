You are continuing the **`the-cartographer`** initiative — a new skill that renders an at-a-glance,
re-generatable visual map of a feature / skill / codebase, which (because it is derived from source)
also audits where the docs and the code disagree.

**Status:** the design is owner-approved and the plan bundle is written. `codex-gate bundle` is at
**BLOCK with 10 agent-fixable blockers**. Both decision-class blockers were resolved by Angel and are
already applied to disk (ADR C-014, C-015). **You own: fix the 10, drive codex-gate to APPROVE, then run
the plan-approval hard gate.** Do not begin implementing Phase 1 until that gate returns Angel's
structured answer.

**Read first, in this order:**
1. `<repo-root>/docs/initiatives/2026-08-11-the-cartographer/handoff-2026-08-11-cartographer-plan-gate.md` — the deep source; read it fully, it has the blocker table and the gotchas.
2. `PDR.md` (approved design) → `ADR.md` (C-001…C-015; **C-013/C-014/C-015 are load-bearing**) → `execution-plan.md`.

**Working dir:** `<repo-root>`

**FIRST ACTION — the checkout is on the wrong branch:**
```bash
cd <repo-root> && git checkout feat/the-cartographer && git status -sb
```
Expect `## feat/the-cartographer...origin/main` and `?? docs/`. HEAD should be `ac0daf0`. Nothing is
committed yet.

**Git discipline (sacrosanct):** LOCAL-only. **Never `git add -A` and never `git add docs/`** — `docs/`
is untracked and also holds another initiative's bundle. No push, no PR, without a fresh explicit ask
from Angel that names the act.

**Process (mandated):**
- `/the-foreman` governs. Run BOTH gates. Render → surface → `AskUserQuestion` at every hard gate.
  The conductor never implements.
- `/codex-gate` is the independent gate — **invoke it, never approximate it**. APPROVE is a verdict it
  emits, never one you declare. Verify every finding yourself at `file:line` before acting on it.
- `/subagent-driven-development` for Phase 1+ (fresh implementer per task, then spec-compliance review,
  then code-quality review), `/test-driven-development` (RED first — this is *why* the plan states test
  intent rather than code, ADR C-013), `/systematic-debugging`, `/verification-before-completion`.

**⚡ ULTRACODE:** optimize for the most exhaustive, correct outcome — token cost is not a constraint.
Use dynamic Workflows for structurable fan-outs; drive review adjudication yourself.

**Three gotchas that will cost you a round if you miss them:**
1. **Two `codex-gate` copies exist and have drifted.** The oracle cites the **repo** copy
   `plugin/skills/codex-gate/` at `ac0daf0` — not `~/.claude/skills/codex-gate/`, which sits 1–2 lines
   higher. Citing the wrong one makes a *correct* extraction fail the gate.
2. **`codex-gate bundle` exceeds the 600s Bash ceiling** — run it with `run_in_background: true`, then
   block on `TaskOutput` (possibly twice). Still drive it to a verdict in-turn.
3. **Do not paste implementation code back into the plan.** Three rounds at code altitude went
   16 → 18 → 15 blockers without converging. ADR C-013 records why the plan states test intent instead.

**Then:** re-run `bash ~/.claude/skills/codex-gate/codex-gate.sh bundle docs/initiatives/2026-08-11-the-cartographer`,
drive to APPROVE, and render the `planDeck` for the plan-approval gate — which carries **two orthogonal
decisions**: approve the plan, and authorize scoped per-phase LOCAL commits (default **NO**).

**Stop and surface to Angel** on any decision-class blocker, `INFRA_ERROR`, `OVERFLOW`, or
non-convergence. Never lower `CODEX_GATE_MODEL`/`CODEX_GATE_EFFORT` — those dials are the owner's.
