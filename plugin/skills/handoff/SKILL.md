---
name: handoff
description: Use when the current session is low on context but the work isn't finished — produces a cold-start HANDOFF doc plus a paste-ready KICKOFF PROMPT so a fresh agent can resume seamlessly AND inherit this session's development workflow (the mandated skill chain, the ultracode / dynamic-Workflows posture, and the hard-won gotchas). Trigger whenever the user says they're "running out of context", asks to "prepare a handoff", "hand this off to a fresh agent", "write a handoff", "pass this to the next agent/session", or "so a new agent can pick up where we left off" — even if they don't say the word "handoff".
allowed-tools: Bash, Read, Write, Edit, Grep, Glob
---

# handoff — teach the next agent (cold-start handoff + kickoff prompt)

The next agent starts with **zero context**. Your job is not to summarize — it's to transmit
enough that a fresh agent resumes *as if it were you*: the same understanding of the work, the same
git/verification footing, and the same **development workflow** (skills, posture, hard-won gotchas).

You produce **two artifacts at two altitudes**, and they are different on purpose:

| Artifact | Altitude | Audience | Filename (default) |
|---|---|---|---|
| **Handoff doc** | deep, exhaustive | the fresh agent reads it cold | `handoff-<YYYY-MM-DD>-<slug>.md` |
| **Kickoff prompt** | lean, paste-ready | the **user** pastes it into the fresh agent | `next-agent-prompt-<YYYY-MM-DD>-<slug>.md` |

The kickoff prompt **points at** the handoff doc — it never duplicates it. The user copies the
kickoff prompt in one action; the fresh agent then reads the doc for the full picture.

---

## Step 1 — Gather ground truth (never write a handoff from memory)

A handoff is a pile of **claims about state**. A wrong claim sends the fresh agent down the wrong
path for an hour. Anchor everything in evidence before you write a word:

- **Git state** — run `git status -sb`, `git log --oneline -8`, `git branch --show-current`,
  `git rev-parse HEAD`. Capture: branch, **exact HEAD sha**, clean vs dirty, staged vs unstaged,
  **pushed vs local-only**, and anything that must **never be staged** (scratch, design bundles, dev hacks).
- **Verification** — list the test / lint / build commands this work uses and their **last actual
  result**. Tag each ✅ *verified this session* vs ⬜ *assumed*. Never mark work DONE that you didn't
  watch pass — an honest "in-flight, unverified" beats a confident lie.
- **Where the work lives** — the active plan/bundle dir (`docs/plans/active/...`), the key files as
  `path:line`, the auto-memory entry if the project uses one.
- **The conversation** — distill: the goal + *why*, decisions already made, gotchas discovered,
  what's DONE+verified, what's in-flight, and the **exact next steps in order**.

## Step 2 — Pick the location + slug

- **Dir:** if an active plan bundle dir is in play, write there; otherwise default to `.claude/context/`
  (create it if missing).
- **Date:** `date +%F`. **Slug:** short kebab naming the work/phase (e.g. `phase-c-d`, `auth-refactor`).
- **Args:** invoking `handoff` (listed bare or as `the-foreman:handoff` depending on install) with
  `<slug>` sets the slug/topic. The user may also pass overrides — a target dir, a
  different skill set, or "no ultracode". Honor them; otherwise use the defaults below.

## Step 3 — Write the handoff doc (deep)

Read `assets/handoff-template.md` and fill **every** section from Step 1's ground truth. Keep every
claim evidence-true. The skeleton: banner (status / your-job / git discipline) → §0 onboarding
read-order → §1 git + verification baseline (exact, copy-pasteable) → §2 mandated process (Step 5) →
§3 the work (state + next steps, `path:line` grounded) → §4 gotchas → §5 safety rails.

## Step 4 — Write the kickoff prompt (lean, paste-ready)

Read `assets/kickoff-prompt-template.md` and fill it. It is **one message** the user pastes into a
fresh agent: orientation (continuing X, status, you own Y) → read-first-in-order (point at the
handoff doc as the deep source) → working dir + git discipline → **Process (mandated) + ULTRACODE
block** → the immediate first action + safety rails. Lean: a pointer, not a copy of the doc.

## Step 5 — Teach the workflow (the heart of the handoff)

This is what the user is really asking for — not just *what* is left, but *how we've been working*,
so the fresh agent keeps the same discipline instead of inventing its own. Transmit three things into
both §2 of the doc and the kickoff prompt:

1. **The mandated skill chain.** Default (the user's standard set — adjust to what this session
   actually used). The `superpowers` skills below are installed via the `obra/superpowers-marketplace`
   plugin marketplace:
   - `/superpowers:subagent-driven-development` — a fresh implementer subagent per task (model **opus**); after
     each, **spec-compliance review THEN code-quality review**. Give the subagent the full task text +
     exact file anchors (it has zero context). Re-verify yourself; don't trust subagent reports.
   - `/superpowers:test-driven-development` — RED first (write the failing test, watch it fail), then implement.
   - `/superpowers:systematic-debugging` — root-cause before patching any failure.
   - `/superpowers:verification-before-completion` — re-run the suites + read the diff yourself before claiming done.
   - `/codex-gate` per phase — the independent second gate; run **both** gates.
2. **The ⚡ ULTRACODE posture** (include unless this session clearly wasn't ultracode): *optimize for
   the most exhaustive, correct outcome — token cost is not a constraint — and take advantage of
   dynamic Workflows for the structurable parts (e.g. a parallel-reader "understand" fan-out to map
   the surfaces before you spec tasks). Drive the per-task review loop yourself (review adjudication
   isn't a fan-out).*
3. **The hard-won gotchas from THIS session** — the operational lessons a fresh agent would otherwise
   rediscover painfully. These are the **highest-value bytes in the whole handoff**. Be concrete, e.g.
   "codex-gate: fresh `CODEX_GATE_SESSION` per round or it overflows on a big branch; verify each
   finding in code before fixing", "run tests under `node`, not bunx", "flag X must be set in dev".

Adapt the canonical text in the templates — don't blind-paste the project-specific bits.

## Step 6 — Hand it to the user

- Print **both file paths** (clickable).
- Print the **kickoff prompt inline in a fenced block** so the user can copy it in one action.
- One honest line on the **trust level**: what's verified vs still-claimed.

---

## Principles

- **Two altitudes, kept separate.** The doc is exhaustive; the prompt is a lean pointer. Collapsing
  them defeats the purpose — the user wants a short thing to paste and a deep thing to land on.
- **Evidence over optimism.** DONE means you watched it pass. Everything else is in-flight. A handoff
  that overstates state is worse than no handoff.
- **Assume zero context.** Spell out read-order, exact commands, exact shas, exact file paths. The
  fresh agent knows nothing about this session — not even which branch it's on.
- **Teach the process, not just the state.** That's the whole point: the next agent should work the
  way this session worked.
- **Git discipline is sacrosanct.** Carry the user's rules verbatim (LOCAL-only / never-stage-X / no
  push or PR without an explicit ask).
