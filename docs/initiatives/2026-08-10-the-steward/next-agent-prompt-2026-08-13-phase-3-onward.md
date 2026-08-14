You are picking up **`the-steward` v0** — a read-only repo agentizer shipping as the fifth skill in
the `the-foreman` Claude Code plugin. Phases 1 and 2 are **done and verified** (483 tests green on
both pinned interpreters). The design spec is **FROZEN**. **You own Phases 3–9**, starting with
Phase 3 (the scanner).

**You are the conductor. You do not implement.** You dispatch fresh-context implementer subagents,
review adversarially, verify by direct probe, and gate.

## Read first, in this order

1. `docs/initiatives/2026-08-10-the-steward/handoff-2026-08-13-phase-3-onward.md` — **the deep
   source. Read it fully before touching anything**; §4 (gotchas) is the highest-value part.
2. `docs/initiatives/2026-08-10-the-steward/FROZEN-DEBT.md` — why the design gate was stopped, and
   the 10 open debt items.
3. `PDR.md` → `ADR.md` → `execution-plan.md` (Phase 3 is your scope) in the same folder.

## Working directory and git

```
cd ~/personal/the-foreman-steward && git status -sb
```

Branch `feat/the-steward` @ `0409aff`, clean, **local only, never pushed**.

**LOCAL ONLY.** Scoped per-phase commits are authorized — **explicit paths, never `git add -A`,
never push, never open a PR, never switch branches.** Do **not** touch
`~/personal/the-foreman` — a sibling initiative works in that clone.

## Process (mandated)

Per phase: `codex-gate phase-start P<n>` (run it **from this worktree**) → dispatch a fresh
implementer (**opus**, high effort, full task text + file anchors) → dispatch an adversarial reviewer
whose main job is *finding tests that prove nothing* → **verify yourself by direct probe** →
`codex-gate phase-review P<n>` → fold and re-gate → commit → bring the human the phase-boundary gate.

Skills: `/the-foreman` · `/codex-gate` · `/test-driven-development` (RED first, always) ·
`/systematic-debugging` · `/verification-before-completion`.

**⚡ ULTRACODE:** optimize for the exhaustively-correct outcome; token cost is not a constraint. Use
dynamic Workflows for the structurable parts; drive review adjudication yourself.

**Simpler is always better** — prefer deleting a rule to qualifying one.

## The three things that will bite you

1. **The recurring defect: a failed or unsafe probe reported as a confident answer.** Thirteen
   instances closed so far, in three costumes (`if code != 0`, a swallowed `except`, following a
   symlink). A structural guard exists — widen it rather than adding a second. Expect a fourteenth.
2. **An audit over clean code reports nothing whether it works or not.** Every guard needs a
   self-check that runs it over a deliberately planted bad module.
3. **Fixes generate defects here.** Several blockers were created by the previous fix pass. Before
   writing a fix, ask what new state it makes reachable — and test that state.

**A subagent's success summary is a claim, not evidence.** Build the attack yourself and watch it
refuse. Every real finding this session came from doing exactly that.

## First action

Read the handoff doc, then re-confirm the green baseline yourself before building anything:

```
cd ~/personal/the-foreman-steward/plugin/skills/the-steward
/usr/bin/python3      -B -m unittest discover -s tests -t tests
/usr/local/bin/python3 -B -m unittest discover -s tests -t tests
```

Both must report **483 tests OK** (~100–135s each). `-B` is mandatory — bare `python3` writes
`__pycache__` and breaks the read-only guarantee.

Then `codex-gate phase-start P3` and begin Phase 3.

Decision-class blockers, `INFRA_ERROR`, `OVERFLOW`, or non-convergence → **STOP and surface to the
human**, don't design around them.
