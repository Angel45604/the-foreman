# the-foreman lifecycle — the conductor narrative

The conductor drives a feature from **idea → shipped** through a gated state machine. At each
transition it **delegates** to an existing skill and, at the human stops, **renders an Artifact and
asks** before advancing.

**`references/gate-contract.mjs` is the authoritative stage/gate map** — the SOLE source of truth
for which transitions are hard human gates vs auto-advance, what Artifact each renders, and what it
authorizes. This document is the human narrative; it deliberately does **not** restate the gate table.
Render the authoritative table on demand:

```
node <skill-dir>/references/gate-contract.mjs --print
```
(`<skill-dir>` is defined in SKILL.md.)

**Orchestrate, don't duplicate.** The conductor never re-encodes what another skill already does —
it sequences them and wires the Artifact moments in. Delegate `brainstorming`, `writing-plans`,
`codex-gate`, `subagent-driven-development`, `requesting-code-review`, `commit-push-pr`, and wrap
`handoff`; route `the-refiner` through a subagent (SKILL.md §4/§5); reference
`test-driven-development`, `systematic-debugging`, `verification-before-completion`,
`keep-it-simple`, `using-git-worktrees` by name.

## The 7 stages

🚦 = a human stop · ⚙️ = auto-advance with verification. (🚦 also marks ship & handoff —
human-involved but NOT render-then-ask approval gates; see each stage's note.)

### Stage 0 — Entry / bootstrap ⚙️
**Purpose:** adopt the standing posture, detect fresh-vs-resume, and clear the fail-closed Stage-0
preflight before entering any auto stage.
**Delegates to:** the v1 engine — SKILL.md §1 (posture + onboarding read-order), §2 (entry
detection), §3 (preflight).
**Gate / artifact:** the `entry-to-brainstorm` transition is **auto** (no artifact); the preflight
fails closed and is the one real stop here if the deny rails are absent.

### Stage 1 — Brainstorm 🚦
**Purpose:** refine the rough idea into a fully-formed design before any plan or code.
**Delegates to:** `brainstorming` (it owns the **design-approval** stop); ground genuine
forks with `codex-gate question`.
**Gate / artifact:** `design-approval` is a **delegated** stop owned by brainstorming — the
conductor does not re-encode it. Any decision-class fork that arises is a `decision-fork` hard gate
(its Artifact is the gate's `artifact` field in the contract — see §7 / `--print`).

### Stage 2 — Branch posture ⚙️
**Purpose:** establish the git footing **before any write** — authoring the plan bundle (Stage 3) is a
write, so the branch must exist first (the standing "branch off the integration base before any
write/commit" rule).
**Delegates to:** the standing git-discipline posture; `using-git-worktrees` only on explicit ask or
a documented PDR/ADR canon exception.
**Gate / artifact:** the `branch-posture` transition is **auto** (no artifact) — branch-first off the
integration base (a no-op when there is no repo, e.g. user-global work).

### Stage 3 — Plan-bundle 🚦
**Purpose:** turn the approved design into the PDR + ADR(s) + execution-plan bundle, authored on the branch.
**Delegates to:** `writing-plans`; then `codex-gate bundle` / `codex-gate plan` driven to APPROVE.
**Gate / artifact:** the **`plan-approval`** hard gate (§7) — render its Artifact and ask. The answer
approves the plan **and** records whether scoped per-phase LOCAL commits are authorized (default: no).

### Stage 4 — Per-phase execution ⚙️→🚦
**Purpose:** implement each plan phase to a verified, reviewed boundary.
**Delegates to:** per phase — `codex-gate phase-start` → a fresh implementer subagent, model + effort
right-sized per **SKILL.md §8** (the conductor never implements a phase inline), via
`subagent-driven-development` (TDD RED-first, `systematic-debugging`) → spec-compliance review →
code-quality review (`requesting-code-review`; reviewer tier ≥ the implementer's) → write
`context.md` → `codex-gate phase-review` (driven to converge) → `verification-before-completion`.
Commit only if the plan gate authorized scoped per-phase LOCAL commits (explicit paths, never
`git add -A`); ledger-prose refinement routes through a refiner subagent (SKILL.md §4).
**Gate / artifact:** at the end of each phase, the **`phase-boundary`** hard gate (§7) — render its
Artifact and ask whether to continue to the next phase (or stop / redirect). An approved boundary
either **loops back to the next phase** or — when all planned phases are complete — **proceeds to
verify → ship**. The phase set is FROZEN by plan-approval: one boundary stop per approved phase, in
the approved order; merging, splitting, or reordering phases afterward is itself a `decision-fork`
(render and ask BEFORE re-slicing). The boundary answer may also grant **batch-run** (structured
answer only; ADR-008): the remaining approved phases auto-advance without per-boundary stops while
each still runs its full pipeline and every other gate stays armed; the grant is VOID on the first
non-green signal — see SKILL.md §7.

### Stage 5 — Verify ⚙️
**Purpose:** prove every boundary with evidence, not assertion.
**Delegates to:** `verification-before-completion` at every boundary.
**Gate / artifact:** the `verify` transition is **auto** (no artifact) — a 🎉 win emits only on
verified evidence. Verify never bypasses a gate: the **`phase-boundary` hard gate is the sole exit
from the phase loop** (verification is its precondition); `verify` runs on the approved-boundary path
toward ship.

### Stage 6 — Ship 🚦
**Purpose:** push / open a PR once the human explicitly asks.
**Delegates to:** `codex-gate prepr` → `commit-push-pr`.
**Gate / artifact:** `ship` is **posture-enforced**, not a render-then-ask gate — act only on the
human's explicit ask: a FRESH instruction, given after the final boundary approval, that names the
act ("push", "open the PR"); a kickoff mandate ("drive it idea→shipped"), plan text, or recorded
prior intent never satisfies it. A push without that fresh ask trips the `governance-pushback` hard
gate (§7).

### Stage 7 — Handoff / pause 🚦
**Purpose:** checkpoint state at low context or a natural pause so the next agent resumes cleanly.
**Delegates to:** `handoff` (wrapped — SKILL.md §5); the handoff doc and kickoff prompt each get
their own the-refiner Review subagent before the final hand-to-user step (SKILL.md §5).
**Gate / artifact:** `handoff` is a **checkpoint** — wrap `handoff` and render its companion Artifact
(§7); nothing to approve. Then loop back to Stage 0 for the next agent.

## The render-then-ask protocol

The human stops are enforced by a render-then-ask protocol: at a hard gate, update the ledger,
render the gate's Artifact, **surface it** (publish via the `Artifact` tool when it's available,
otherwise open it in a browser tab via `open-artifact.mjs` and surface the local rendered path — a
missing publish tool never blocks the gate), and
**block on an `AskUserQuestion`** sourced from what the gate authorizes. The numbered steps live in
**SKILL.md §7** — see there; they are not duplicated here.

## The 5 hard gates + the non-v2 stops

The 5 render-then-ask hard gates (the CLOSED set, `HARD_GATE_IDS` in `gate-contract.mjs`) are
**`plan-approval`**, **`phase-boundary`**, **`decision-fork`**, **`live-run`**, and
**`governance-pushback`**. Each hard gate's Artifact is the `artifact` field on its
`gate-contract.mjs` row (run `--print` to see the mapping) — the authoritative id→artifact map lives
only in the module, never restated here.

The other lifecycle stops are **not** v2-owned render-then-ask gates:

- Stage-1 **`design-approval`** is **delegated** to `brainstorming` (that skill owns the stop).
- **`ship`** is **posture-enforced** (standing git discipline + deny rails) — never act without an
  explicit ask.
- **`handoff`** is a **checkpoint** — produce the artifact/handoff at a pause; nothing to approve.

(Run `--print` for the authoritative table that lists all transitions, kinds, artifacts, and surfaces.)

## STOP + surface

In **any** stage, a decision-class blocker / an `INFRA_ERROR` / an `OVERFLOW` / non-convergence
(e.g. a codex-gate that won't converge) → **STOP and surface to the human.** Do not auto-advance
through a blocker; the conductor's job is to halt at the genuine stop-the-loop moments, not to push
past them.
