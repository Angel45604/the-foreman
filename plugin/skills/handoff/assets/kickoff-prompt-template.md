<!--
  KICKOFF PROMPT TEMPLATE — the LEAN artifact the USER pastes into a fresh agent.
  One message. Point at the handoff doc for depth; do NOT duplicate it. Fill every [bracket],
  delete this comment. Keep it tight — this is a launcher, not the manual.
-->

You're continuing [project / feature]. [One line of status: what's DONE + verified.] You own **[the next scope]**.

Read first, in order:
1. `AGENTS.md` (repo root), then [downstream `AGENTS.md` / `CLAUDE.md`].
2. `[path]/handoff-[date]-[slug].md` — the full cold-start handoff (build state, the spec, the gotchas, the data contract, the safety rails). Self-sufficient; follow its §0.
3. [the plan / design bundle / spec] — [what to read; ⚠️ what NEVER to stage].
4. [auto-memory entry, if any] — [the relevant paragraph].

Working dir: `[path]`, branch `[branch]` (HEAD = `[sha]`). [Git discipline — e.g. LOCAL commits only; no push/PR without my explicit ask. Never stage `[X]`.]

Process (mandated): /superpowers:subagent-driven-development (fresh implementer per task, opus; spec-review THEN code-quality review) · /superpowers:test-driven-development (RED first) · /superpowers:systematic-debugging · /superpowers:verification-before-completion (re-run the suites + read the diff yourself) · invoke `codex-gate` (listed bare or as `the-foreman:codex-gate` depending on install) per phase. Run BOTH gates. ⚡ We're in ULTRACODE effort: optimize for the most exhaustive, correct outcome (token cost is not a constraint) and take advantage of dynamic Workflows for the structurable parts (e.g. a parallel-reader "understand" fan-out to map the surfaces before you spec tasks). Drive the per-task review loop yourself.

[Optional but high-value: the 1–2 most critical session gotchas, e.g. codex-gate base = the pre-phase HEAD, fresh CODEX_GATE_SESSION per round (resuming OVERFLOWs on a big branch), verify each finding in code before fixing.]

[The work — one short paragraph per phase/task you own, with the `path:line` anchors and the goal. This is the distillation of the handoff doc's §3, not a re-paste.]

Start by: [the concrete first action — handoff §0 onboarding, confirm the baseline green, then propose a short plan before implementing]. 🛑 [the safety rail — e.g. NEVER trigger a real paid run; test with mocks]. Stop at phase boundaries to report.
