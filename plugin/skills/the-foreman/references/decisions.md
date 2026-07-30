# the-foreman decisions — living ADR index

One entry per architecture decision cited as `ADR-NNN` across SKILL.md and references/. ADR-002–006
predate this file and are recorded retroactively (one line + where enforced); ADR-007+ are recorded
here first. New decisions append here — never renumber.

- **ADR-002 — Deny rails over promises.** The Stage-0 gate is `permissions.deny` in
  `~/.claude/settings.json` (push / mass-delete / exfil categories): rails run before the auto-mode
  classifier and survive compaction; conversational "don't do X" promises do not. Auto-mode is a
  NOTE, never a blocker — the rails, not the mode, are the protection (revised 2026-06-19).
  Generalized 2026-07-08 (ADR-010): a category requirement may be a deny matcher OR a verified
  PreToolUse hook (`{hook:…}`), so a precise hook can replace a blunt deny without losing fail-closed.
  *Enforced:* `preflight.mjs` (fail-closed) + `REQUIRED_DENY_RULES.json` + `preflight.test.mjs`.
- **ADR-003 — The Artifact is a render target; the ledger is the truth.** Durable JSON ledger →
  `render.mjs` → self-contained HTML (+ portable secret-scanned `.md` twin; the hosted URL is
  owner-private). Fail-closed secret scan: a detected secret/PII shape throws and writes NOTHING.
  *Enforced:* `render.mjs`, `secret-scan.mjs` + their tests.
- **ADR-004 — `gate-contract.mjs` is the SOLE source of truth for the lifecycle machine.** Docs
  narrate; they never restate the id→artifact map. *Enforced:* `contract-drift.test.mjs` leak-line
  guards over SKILL.md §6–§8 and lifecycle.md.
- **ADR-005 — The hard-gate set is CLOSED (5 ids).** plan-approval, phase-boundary, decision-fork,
  live-run, governance-pushback — a literal oracle keeps coordinated edits from drifting it.
  *Enforced:* `gate-contract.test.mjs` EXPECTED_HARD_GATE_IDS.
- **ADR-006 — No AskUserQuestion ⇒ file-based escalation.** A gate without the tool never collapses
  to prose and never proceeds: structured questions on disk, validated read-once answers; a session
  that must end, ends AT the gate. *Enforced:* `escalation.mjs` + `escalation.test.mjs`, SKILL §7.

- **ADR-007 (2026-07-06) — Dispatch telemetry.** One JSONL line per COMPLETED dispatch, appended to
  the global `~/.claude/the-foreman/dispatch-log.jsonl` when the worker returns:
  `{ts, session, phase?, shape, tier, model, effort, why, outcome, notes?}`.
  *Why:* the §8 shape→tier mapping should be tuned by measured non-green rates (redo/escalated/
  failed per tier × shape), not vibes — and a hardcoded model choice already rotted here once.
  *Design:* outcome-at-return means no correlation ids (a redo is simply two lines); `tier`/`effort`/
  `outcome` are strict durable enums while `model` is free-form (names change — that's the point);
  one global log, not per-session ledgers, because tuning needs cross-initiative aggregation;
  append is fail-closed (invalid entry writes nothing). *Enforced:* `dispatch-log.mjs` +
  `dispatch-log.test.mjs`; the §8 "log every dispatch outcome" bullet; mindset.md rule 6.
- **ADR-008 (2026-07-06) — Batch-run boundary authorization.** The `phase-boundary` gate carries an
  optional second decision: the human may — via the structured answer ONLY — authorize auto-advancing
  the remaining approved phases without per-boundary stops.
  *Semantics:* a conversational "don't stop again" is the TRIGGER to offer the option, never a grant;
  the grant waives ONLY boundary stops — every phase still runs the full §6·4 pipeline (codex
  phase-start/phase-review, both reviews, verification, commit rules) and decision-fork / live-run /
  governance-pushback / ship's fresh ask stay armed; VOID on the first non-green signal
  (non-convergence, surviving RED, fork, scope drift, INFRA_ERROR/OVERFLOW) → STOP + surface at a
  normal boundary stop; evidence for each auto-passed boundary still lands in the ledger, with one
  consolidated checkpoint at the end or at re-arm; the grant never extends past verify.
  *Rejected alternatives:* (a) routing every "don't stop" through governance-pushback — punishes a
  legitimate ask with ceremony; (b) blanket waiver including the codex calls — guts the quality
  loop; (c) proactively offering batch-run at every boundary — nudges the human toward fewer stops,
  so offer it only when the human signals or asks. *Enforced:* `gate-contract.mjs` authorizes,
  SKILL §7 + Red Flags, lifecycle Stage 4, eval 11, `contract-drift.test.mjs` pins.
- **ADR-009 (2026-07-06) — Deliberate omissions.** Recorded so future editors don't "helpfully" add
  them: **no numeric token budgets / context-percentage triggers / $-per-tier figures** in the docs
  (numbers rot exactly like the hardcoded model name did; §8's durable shapes + the ADR-007 log are
  the substitutes); **no fan-out size caps** (the harness caps concurrency; doc caps invite
  prompt-specific gaming — see AGENTS.md's Goodhart rule); **no subagent self-escalation** (one
  owner per decision — the conductor escalates via §8's two-rung ladder); **the eval harness grades
  described behavior, not executed behavior** (accepted trade-off; upgrade path in
  `evals/run-evals.mjs` header).
- **ADR-010 (2026-07-08) — Precise git-push guard replaces the blanket deny.** The blunt
  `Bash(git push:*)` deny blocked ALL pushes (safe feature pushes included) to stop the two dangerous
  cases; owner reported it hindered productivity. Replaced with a `git-push-guard` PreToolUse(Bash)
  hook that parses the actual invocation: it SILENTLY allows safe feature-branch pushes and blocks
  only (a) pushes to a protected branch (main/master) and (b) reckless force-pushes
  (`-f`/`--force`/`+refspec`); a careful `--force-with-lease` to a non-protected branch is allowed.
  *Why a hook:* prefix/glob matchers cannot reliably see "target is main" or "a force flag is present"
  across git's flexible arg order — the permission docs themselves recommend a PreToolUse hook for
  reliable command validation. The hook is strictly BETTER-covering than the old deny (catches
  `cd x && git push`, `git -C p push`, `HEAD:main` — which the prefix matcher missed) while removing
  the false-positive on safe pushes. *Fail-closed:* a hook crash/timeout fails OPEN in Claude Code, so
  the wrapper turns any error on a push-y command into `exit 2` (block). To keep the Stage-0 preflight
  fail-closed, ADR-002's contract was generalized so the `git_push` category is satisfied by the
  verified hook OR the deny (`anyOf` with a `{hook:…}` member). *Grounding:* codex-gate `question`
  GROUNDED (Lean A), owner chose the hook via AskUserQuestion. *Decision file:*
  `.claude/context/DECISION-git-push-rail-productivity.md`. *Known residuals* (documented, accepted —
  same class the deck already acknowledges for matchers): exotic forms like `$(git push …)`, `sudo git
  push`, `xargs … push` are not parsed. *Rejected alternatives:* narrow deny (B — brittle on arg
  order), deny→ask (C — a prompt on every push, weaker than a structural block), remove entirely
  (D — reopens the ADR-002 hole). *Enforced:* `git-push-guard.mjs` + `git-push-guard.test.mjs` (34
  cases) + the preflight hook-satisfaction tests. *Follow-up:* the `destructive_git_rewrite` residual
  (`git reset --hard`/`clean -f`/`branch -D`, from the mattpocock audit) could reuse this same hook
  mechanism.
