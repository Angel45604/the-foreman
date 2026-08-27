---
name: the-foreman
description: Use at the START of any development work — beginning a feature, resuming an in-flight initiative, reacting to a plan/board, or stopping at a gate. Trigger on "start a new feature", "let's build X", "pick up where we left off", "drive a feature idea→shipped", "stop at a gate", "render a decision/live-run brief", or when about to plan, dispatch implementer subagents, or render a brief.
---

# the-foreman

Drop into Angel's development methodology and surface progress as neumorphic Gate Board
Artifacts. This skill owns the **standing posture** + onboarding read-order (§1), **entry
detection** (fresh vs resume, §2), the fail-closed **Stage-0 preflight** (§3), the **Artifact
engine** (render a durable ledger → publish, §4), the **lifecycle conductor** (§6), the
**gate-enforcement protocol** (§7), and the **dispatch policy** (§8).

This skill **orchestrates** — it never re-encodes what another skill already does. Delegate
`codex-gate`, `subagent-driven-development`, `brainstorming`, `requesting-code-review`,
`commit-push-pr`; reference `test-driven-development`, `systematic-debugging`,
`verification-before-completion`, `keep-it-simple` by name; wrap `handoff` (§5).

> **`<skill-dir>` in the commands below** = the directory containing THIS SKILL.md (you know it —
> it's the path this skill was loaded from). Installed as a plugin that is
> `…/plugins/cache/<marketplace>/the-foreman/<version>/skills/the-foreman`; installed as a personal
> skill it is `~/.claude/skills/the-foreman`. Substitute the real absolute path when running the
> `node` commands — the scripts themselves are path-independent (state lives under
> `~/.claude/the-foreman/`, never under the install dir). Bundled sibling skills live at
> `<skill-dir>/../<name>/`. Siblings appear in the skills list bare (e.g. `codex-gate`) or
> plugin-namespaced (e.g. `the-foreman:codex-gate`) depending on install — invoke whichever the
> session lists.

## 🚦 Non-negotiables (read BEFORE acting — these are the gates this skill exists to enforce)

**Violating the letter of these IS violating the spirit. A "same spirit" substitute does NOT count.**
"Delegate X" / "run BOTH gates" means **actually invoke X** (the `Skill` tool or its CLI) — *now, this
turn* — not describe it, not approximate it, not defer it.

1. **`codex-gate` = INVOKE the `codex-gate` skill.** EVERY codex-gate call named in a §6 stage is
   mandatory AT that stage — the closed set: `question` at genuine forks (§6·1), `bundle`/`plan` at
   §6·3, `phase-start` AND `phase-review` for **every** phase (§6·4), `prepr` at §6·6. Skipping any one
   of them is skipping the gate. Invoke it — `Skill(codex-gate)` or `bash <skill-dir>/../codex-gate/codex-gate.sh …`
   — and drive it to **APPROVE**. It is the independent second pair of eyes (§1). It is **NOT** satisfied
   by: a homegrown/"completeness" critic · your own self-review · the-foreman's OWN scripts
   (`gate-contract.mjs --print`, `preflight.mjs`) · a ledger/handoff that *records* a prior "codex-gate
   APPROVE". **If you have not literally invoked `codex-gate` this initiative, the gate has NOT run** —
   say so and run it. **APPROVE/converged is a verdict codex-gate emits, never one you declare** — "the
   remaining findings are noise" is a rebuttal to feed back into the loop, not a verdict; if the gate
   still won't approve, that is non-convergence → STOP + surface (§6). An `INFRA_ERROR` on a review mode
   (`bundle`/`plan`/`phase-*`/`prepr`) also means the gate has NOT run — STOP + surface (the global "on
   INFRA_ERROR just ask directly" fallback applies ONLY to `question`-mode decision grounding).
2. **Gate the plan AT the plan stage — not "later".** Deferring all codex to Stage-4 `phase-review`
   skips the plan-bundle gate. Run `codex-gate bundle`/`plan` → APPROVE **before** you present the plan
   for approval. `codex-gate` is **synchronous — you drive it to a verdict THIS turn**: do not narrate
   "invoking codex-gate…" and end the turn waiting for a background/monitor event, and do not defer the
   render-then-ask (§7) to "when it returns". If the bundle files are not on disk yet, **write them
   first, then gate** — "there is no bundle dir to point at" is not a reason to skip or substitute.
3. **A hard gate is render → surface → `AskUserQuestion` — never a conversational ask.** When the user
   reacts to a plan/board ("approve?", "how far should I implement?", "proceed?", "looks good") you ARE
   at the **plan-approval hard gate** (§7): render the planDeck, **surface** it, and **block on a
   structured `AskUserQuestion`**. A prose "say the word / which should I start?" is NOT the gate; never
   "offer" a gate as optional. A missing **publish** tool only swaps URL → local path / Chrome tab and
   never blocks the gate (§4·3); a missing **`AskUserQuestion`** is different — do NOT collapse to prose
   and do NOT proceed: file-based escalation, validated read-once answer (§7, ADR-006).

The **Red Flags** table at the end lists the exact rationalizations these forbid — self-check against it.

> **Node-22 test quirk:** to run the skill's tests, pass explicit globs — a bare directory path no
> longer auto-discovers: `node --test <skill-dir>/references/*.test.mjs
> <skill-dir>/evals/*.test.mjs`.

## §1 — Bootstrap (the standing posture)

Adopt this posture before any work so it never has to be re-explained:

- **ULTRACODE.** Optimize for the exhaustively-correct outcome. Depth of reasoning, verification,
  and gate rigor are never traded for cost — but spend is *directed*, not indiscriminate: right-size
  every dispatch (§8) and exploit dynamic Workflows. Reason at depth before acting.
- **Conduct; don't do the workforce's job.** Delegate by task shape per the dispatch policy (§8) —
  every dispatch names model + effort. Keep your own context for decisions, contracts, and gate
  state. Read `references/mindset.md` once at initiative start — it is how this skill expects an
  opus-class conductor to think.
- **Simpler is ALWAYS better.** Challenge every layer, abstraction, and added dependency — "can
  this be done with 1/10th the complexity?" Reuse where the data already lives; don't bolt on
  fetches/helpers/plumbing the caller already has.
- **Verify contracts before asserting.** Never claim a route/helper/flag/schema/API shape that
  isn't in the code. Cite file:line. Distinguish plausible signal from proof; mark anything
  unfetchable "verify in Phase 0" rather than inventing it.
- **Run BOTH gates.** Claude's own review AND the independent `codex-gate` — **invoked, not
  approximated** (Non-negotiable #1). A homegrown critic / self-review / the-foreman's own scripts /
  a recorded prior "APPROVE" do NOT substitute for invoking the `codex-gate` skill. Verify every
  finding in code before acting on it — Codex catches real gaps Claude reviews miss, and Claude
  catches noise Codex raises.
- **Git discipline.** LOCAL-only by default. Branch off the integration base **before** any
  write/commit. Never push or open a PR without an explicit ask. **Never `git add -A`** — stage
  explicit paths only. Commit only if the human authorized scoped per-phase local commits.
- **The 🎉 win threshold.** Mark a win only on a *genuine, verified* outcome (tests green, a bug
  fixed AND verified, a live proof working, a milestone shipped/approved, a gnarly blocker
  cleared). One marker per win; never before the verification exists. Format: a line starting
  with `🎉 **Win:**` — what landed + why it matters.

**Why:** these are the rails that make autonomous work trustworthy. The posture is durable; the
git rules in particular survive context that conversational "don't push yet" promises do not.

### Onboarding read-order

1. Read the repo's `AGENTS.md` first (it overrides defaults).
2. Follow its routing to the most relevant downstream `AGENTS.md` files for the task.
3. Use the docs linked from `AGENTS.md` as the source of truth for behavior, planning
   requirements, and codebase context (the domain docs router).

Then branch on entry mode (§2): **if resuming**, also read the initiative bundle + the `handoff`
doc + auto-memory to inherit prior state. **A fresh start authors those instead of reading
them** — there is nothing to resume.

## §2 — Entry detection (fresh vs resume)

Detect the entry mode FIRST, before any work — a fresh start has none of the artifacts a resume
assumes, so guessing wrong wastes a cold-start.

- **RESUME (an in-flight initiative).** Signal: you arrived via a `handoff` kickoff prompt, or a
  plan bundle / feature branch / worktree already exists for this work. Do `handoff`'s §0
  onboarding (bundle → handoff doc → auto-memory), then **re-confirm the green baseline** —
  actually RE-RUN the stated verification THIS turn (run lint/tests/build for the touched project
  and report the result; naming or *promising* the checks is not re-confirmation) and check the git
  footing (flag a stale base / uncommitted drift) — before continuing.
- **FRESH START (greenfield — invoked to BEGIN new development).** Signal: no plan bundle, no
  handoff doc, no feature branch/worktree yet. Bootstrap from zero: read only the repo canon
  that exists (the §1 read-order), **establish branch posture first** (branch off the
  integration base; a worktree only on explicit request or a documented PDR/ADR canon
  exception), and **author** the initiative artifacts as the work proceeds — the bundle is
  created in the planning stage, not read. Skip the auto-memory/handoff reads; there is nothing
  to resume.

## §3 — Stage-0 preflight (fail-closed)

Before entering **any** auto stage, run the preflight and read its JSON:

```
node <skill-dir>/references/preflight.mjs
```

The gate is the **`permissions.deny` rails + verified hooks** in `~/.claude/settings.json` (matcher
syntax verified against the Claude Code permission docs): **git push** (satisfied EITHER by a blanket
`Bash(git push:*)` deny OR — preferred — the precise **`git-push-guard` PreToolUse hook**, which allows
safe feature pushes and blocks only main/master + reckless force-push; ADR-010), mass delete
(`rm -rf`), and external exfiltration (`curl`/`wget`) — the categories in
`references/REQUIRED_DENY_RULES.json` (a category requirement may be a deny matcher, an `anyOf`, or a
`{hook:…}`). `ok:true` requires every category covered (and a valid required set). **Prod
deploy/migrate is project-specific** (can't be matched generically without false positives) — add
explicit deny rules for your own deploy commands or a `PreToolUse` hook; and a Bash deny alone doesn't
fully stop network exfil, so pair it with `WebFetch(domain:…)` allow-rules.
**Auto-mode is detected and reported as a NOTE (`autoMode`), never a blocker** — the operator runs
auto intentionally; the rails, not the mode, are the protection.

**If `ok` is false: STOP. Show the `setupBlock` verbatim** (a ready-to-paste, MERGE-don't-replace
`permissions.deny` fragment) and let the owner install the rails. The CLI exits non-zero on failure.
**Never enter auto with the deny rails absent or incomplete.**

**Why:** `permissions.deny` runs *before* the auto-mode classifier and is compaction-immune — the
durable replacement for a "don't do X" promise that compaction silently drops. The preflight fails
closed (missing rails / malformed required set ⇒ `ok:false`). Because the operator **always** runs in
auto, the rails are the *only* thing between an irreversible/external action and execution without a
prompt — so auto makes them **more** essential, not less (ADR-002, revised 2026-06-19). On a machine
with no deny list yet, the preflight fires by design — that IS the one-time setup gate.

## §4 — Artifact engine (render from ledger → publish)

Surface plans and progress as neumorphic Gate Board, self-contained, secret-safe Artifacts. The state
of truth is a durable JSON **ledger**; the hosted Artifact is a *deploy target* regenerated from
it (ADR-003), so re-rendering to the same path keeps the same URL.

**1. Maintain the ledger** at the canonical runtime path:

```
~/.claude/the-foreman/<session>/ledger.json     # durable source of truth
~/.claude/the-foreman/<session>/artifact.html   # rendered, secret-scanned output
```

`<session>` is a short stable slug (feature name / ticket id). The full ledger shape — `meta`, every
render-type section, per-slide `blocks[]` + `chapter` — is documented in
`references/ledger.schema.md`. Summarize evidence into
the ledger — **never paste raw secrets, tokens, customer data, production connection strings,
large/sensitive raw diffs, or end-user entity IDs.** (A small, curated, non-sensitive snippet may use
the sanitized `code`/`diff` content block — it is escaped/fenced, and the fail-closed secret-scan
still covers it.)

**2. Render** (pick the type for the moment):

```
node <skill-dir>/references/render.mjs <ledgerPath> <type> <outPath>
```

Gate types: `planDeck` (the full plan board, at the plan gate) · `brief` (win/pause: what landed +
evidence + verified-vs-claimed + the ask) · `decisionCard` (options + pros/cons/risk + attributed
recommendation) · `liveRun` (what it does + cost/blast-radius + cleanup proof, before the live-run
gate). Plus four **render-only composite types** that compose the content blocks: `phaseTracker`
(phase progress — the stops track + a progress dial) · `findings` (a findings table + sources +
summary) · `comparison` (an options × criteria scored matrix) · `dashboard` (stat wells + a chart +
ranked rows). Every type renders the **neumorphic Gate Board**: ONE scrolling verdict-first page —
a sticky chapter rail (`slides[].chapter` groups consecutive slides into rail-addressable sections),
a verdict hero (`meta.verdict` + `meta.lede` + `meta.keyStats` tiles), the ask strip (an explicit
`meta.ask` wins over any derived ask), and per-unit plain-`statement` headlines with one dominant
**`figure`** up top and the verbatim evidence in a collapsed drawer. Slides may carry a rich
**`blocks[]`** array (tables, ranked rows, stat wells, dial/bar/line charts, gate-flow, the stops
track, code/diff, pills — plus the six figure blocks `topo`, `deltaRow`, `duel`, `verdictFan`,
`dotMatrix`, `ladder`). The full render catalog + every block/type ledger shape live in
`references/ledger.schema.md` (and `gate-contract.mjs --print`). The renderer inlines the stylesheet +
the Gate Board page script into one CSP-safe page, **also writes the portable Markdown twin**
(`<name>.md`, step 4) **and a browser-ready `<stem>.local.html` sibling**, and prints the full return
`{outPath, bytes, mdPath, mdBytes, localPath, localBytes}`. The two HTML files are NOT interchangeable:
`<outPath>` is the **hosted-artifact file** — shell-less by contract (no doctype/html/head/body wrapper;
the Artifact host supplies them) — while `localPath` (`<stem>.local.html`) is the **standards-mode
sibling** wrapping the same scanned content in a complete document, which `open-artifact.mjs` prefers
for local browser opens. **When stating where the file lives for opening in a browser, surface the
LOCAL path**; `<outPath>` exists for the `Artifact` publish (step 3).

**Authoring contract** (design §7 — hard rules for the agent writing the ledger): statement
headlines in plain English, ≤ ~12 words, no `model@effort` or env-var notation in a statement
or lead slot; lead ≤ 1 sentence; `keyStats` 3–5; exact figures, file paths, shas, and jargon
live in figures and drawers; every unit should carry a figure — when no figure fits (code/diff
or prose-led evidence), the drawer leads and the statement must carry the takeaway alone.
A **non-fatal render lint** in `render.mjs` checks these after template render, before write —
statement length, code-token-in-statement, missing `meta.verdict`+`meta.ask` on gate types,
keyStats count. Violations print to stderr as warnings; **the render always proceeds** (a
blocked render must never stall a human gate). The fail-closed secret scan is unchanged and
still gates all writes.

**3. Publish (optional hosting — NOT a dependency of the engine or the gate):** if the **`Artifact`
tool** is available, call it on `<outPath>` (favicon from `ledger.meta.favicon`; same path → same URL,
so a re-render to the same `<outPath>` updates the live Artifact in place — keep the favicon stable).
**If the `Artifact` tool is NOT in your toolset** (the Artifacts beta isn't enabled for the
session/org, headless `-p`, the SDK, a subagent, a non-Claude agent): this is a NORMAL, supported
path — **do not apologize, do not flag it as a blocker, do not spiral.** **Open the rendered page in a
browser tab so the human still sees it:**

```
node <skill-dir>/references/open-artifact.mjs <outPath>
```

That opens the board in **Google Chrome** (falling back to the OS default browser), **preferring the
`<stem>.local.html` sibling** render.mjs wrote next to `<outPath>` (the `localPath` in the render
output — the standards-mode document a local browser needs; `<outPath>` itself stays shell-less for
the hosted publish, step 2). The page is self-contained, so it renders identically to the hosted
Artifact, just without the shareable URL + same-URL in-place update (a re-render reopens/refreshes
the tab). **Also** state where the file lives — the **LOCAL path** (`<stem>.local.html`) for browser
opening, plus the `.md` twin (step 4) — so it's recoverable if there is no browser (when every opener
fails, `open-artifact.mjs` exits non-zero — just surface the local path). Publishing only *hosts* a finished
artifact at a URL; its absence changes the surfacing (a Chrome tab + local path instead of a hosted
URL), **never the engine and never the gate (§7)**. (Contrast `AskUserQuestion`, which *is* the gate:
if THAT is unavailable you do NOT proceed — you open a file-based escalation (`escalation.mjs`, §7/ADR-006)
and wait for a validated read-once answer; a missing *publish* tool is not a stop.)

**4. Share with other agents (the portable twin).** The published Artifact URL is **owner-private** —
another agent (Codex, Gemini, a fresh Claude) hitting it gets a **403**. **Never hand the URL over as
agent-to-agent context.** `render.mjs` ALSO writes a **secret-scanned Markdown twin** next to the HTML
(`<session>/<name>.md`, e.g. `artifact.md` beside `artifact.html`) — the same content as the board, safe
to share by construction (it passes the same fail-closed scan). To give a parallel/other agent the same
context you get from the board: **same-machine** agent → give the **`.md` path** (+ the plan bundle dir
for full detail); **remote** agent → **inline the `.md` content** for pasting. Default: surface the
`.md` path + a one-line synopsis; inline the full `.md` when you (or the other agent) ask.

**Fail-closed (ADR-003):** `render.mjs` secret-scans the fully rendered HTML *before* writing and
**throws, writing nothing,** if a secret/PII shape is detected. If render throws on a secret, do
NOT try to bypass it — fix the ledger (summarize instead of embedding) and re-render. Artifacts
are private-by-default; treat the URL as shareable-on-purpose only.

**Selective cadence:** render a `brief` only at genuine stop-the-loop moments with *material* new
progress — a plan gate, a phase boundary, a decision fork, the live-run gate. Not every stop;
noise and cost defeat the point. This cadence governs *unsolicited* progress notes only — it NEVER
adds a materiality test to a §7 hard gate. `handoff` docs stay plain markdown (§5) — don't restyle them.

## §5 — Wrap handoff

**REQUIRED SUB-SKILL:** use `handoff` to checkpoint state at phase boundaries and when low on
context. It produces the cold-start doc + paste-ready kickoff prompt the next agent resumes from
(§2 RESUME). Do not re-encode its templates here — call it by name so its structure stays single-sourced.

## §6 — The lifecycle conductor (idea → shipped, gated)

Drive a feature through the gated state machine, **delegating** to existing skills at each stage and
**wiring the Artifact moments** (§4) in. The authoritative stage/gate map is
`references/gate-contract.mjs` — render the human-readable table with
`node <skill-dir>/references/gate-contract.mjs --print`; the narrative is
`references/lifecycle.md` (read it once at the start of an initiative).

The 7 stages (🚦 = a human stop; ⚙️ = auto-advance with verification):
0. **Entry/bootstrap** ⚙️ — §1–§3 (posture, fresh-vs-resume, Stage-0 preflight).
1. **Brainstorm** 🚦 — delegate `brainstorming` (it owns the design-approval gate); ground genuine
   forks via `codex-gate question`; raise a `decision-fork` gate (§7) at each fork.
2. **Branch posture** ⚙️ — branch-first off the integration base **before any write** (authoring the
   plan bundle is a write); a worktree only on explicit ask / a documented canon exception
   (`using-git-worktrees`).
3. **Plan-bundle** 🚦 — extend `writing-plans` → the PDR+ADR+execution-plan bundle; then **invoke the
   `codex-gate` skill** (`codex-gate bundle`/`plan`) and drive it to **APPROVE** — this turn, before
   approval, no substitute (Non-negotiable #1/#2); then the **`plan-approval`** gate (§7).
   *(High-impact bundle — security / billing / data-migration / a large diff? `codex-gate` takes an
   opt-in `--multi` for a multi-lens review [architecture · security · tests · UX lenses, aggregated
   fail-closed]; see codex-gate's own docs. Manual opt-in — never automatic; the gate's default
   model/effort is deliberately quality-first and heavy [fast mode on; effort tiers may auto-delegate
   subtasks], so `--multi` multiplies an already-expensive run — opt in deliberately, never casually.)*
4. **Per-phase exec** ⚙️→🚦 — per phase: `codex-gate phase-start` → dispatch a fresh implementer
   subagent, model + effort right-sized per **§8** — never implement a phase inline yourself
   (`subagent-driven-development`, TDD RED-first, `systematic-debugging`) → spec-compliance review →
   code-quality review (`requesting-code-review`; reviewer tier ≥ the implementer's, §8) → write
   `context.md` → `codex-gate phase-review` (drive to converge) → `verification-before-completion` →
   commit ONLY if the plan gate authorized scoped per-phase LOCAL commits (explicit paths, never
   `git add -A`) → the **`phase-boundary`** gate (§7). The phase set is FROZEN at plan-approval —
   merging, splitting, or reordering it afterward is a `decision-fork` (render and ask BEFORE re-slicing).
5. **Verify** ⚙️ — `verification-before-completion` at every boundary. Evidence = command output you
   ran yourself (or a worker's RAW output you read) — a subagent's success *summary* is a claim, not
   evidence. A 🎉 win emits only on verified evidence.
6. **Ship** 🚦 — **posture-enforced**: only on an explicit ask — a FRESH instruction, given after the
   final boundary approval, that names the act ("push", "open the PR", `/commit-push-pr`); a kickoff
   mandate ("drive it idea→shipped"), plan text, or recorded prior intent NEVER satisfies it. Then
   `codex-gate prepr` → `commit-push-pr`. (Not a render-then-ask gate; a push without that fresh ask
   trips `governance-pushback`.)
7. **Handoff/pause** 🚦 — at low context / a natural pause, **wrap** `handoff` (§5) + render the
   `handoff` checkpoint's companion Artifact (§7); loop back to stage 0 for the next agent.

Decision-class blockers / `INFRA_ERROR` / `OVERFLOW` / non-convergence in any stage → **STOP + surface**.

## §7 — The gate-enforcement protocol (render-then-ask)

**Trigger recognition (do not miss the gate):** when the user *reacts to a plan or board* — "do you
approve?", "how far should I implement?", "looks good, proceed", "start building" — you are AT the
**`plan-approval` hard gate**. Do NOT answer that question conversationally and do NOT start
implementing: first invoke `codex-gate` on the bundle (Non-negotiable #1), then run the render-then-ask
protocol below. The same applies whenever any gate's trigger fires.

**Before advancing past any transition, consult `references/gate-contract.mjs`** (`gateById` /
`hardGates`). Enforce by `kind`:

- **`hard-gate`** → run the render-then-ask protocol, in order:
  1. update the ledger (§4) with what the human must decide;
  2. render the gate's `artifact` — the AUTHORITATIVE value is `gateById(id).artifact` from the contract
     (or `gate-contract.mjs --print`), never a copy in this doc:
     `node <skill-dir>/references/render.mjs <ledgerPath> <artifact> <outPath>`;
  3. surface the rendered artifact — if the **`Artifact`** tool is available, publish `<outPath>` (same
     path → same URL); **if it is NOT available, open it in a Chrome tab instead — `node
     <skill-dir>/references/open-artifact.mjs <outPath>` (§4·3) — a missing publish tool
     NEVER blocks, skips, or defers the gate** (the board is a companion; the `AskUserQuestion` in step 4
     is the gate, ADR-002). For any parallel/other agent, surface the **portable `.md` twin** (path or
     inline), NOT the owner-private URL (§4·4);
  4. **block on an `AskUserQuestion`.** The gate's `authorizes` field is the SPEC of what must be
     decided (prose), **not** literal option labels. The primary decision always offers at least
     **approve / proceed** and **request-changes / hold**. If `authorizes` names a sub-authorization that
     is **independent** of the primary approval (orthogonal — approving the primary does not decide it),
     present it as a **separate question** in the same `AskUserQuestion` (the tool takes multiple
     questions), or as **mutually-exclusive combined options** — never as one extra option that leaves the
     other decision implicit. (`plan-approval` has TWO orthogonal decisions: approve-the-plan **and**
     authorize scoped per-phase LOCAL commits [default **NO**]. Ask both — e.g. a second question, or the
     combined options `approve, no local commits` / `approve, scoped local commits` / `request changes`.
     The commit answer governs stage 4.) (`phase-boundary` carries an optional second decision,
     **batch-run** [ADR-008]: the human may — via the structured answer ONLY — authorize auto-advancing
     the remaining approved phases without per-boundary stops. A conversational "don't stop again" is
     the trigger to OFFER that option at the boundary you are at, never a grant by itself. Batch-run
     waives ONLY the boundary stops: every phase still runs its full §6·4 pipeline — codex
     `phase-start`/`phase-review`, both reviews, verification, the commit rules — and `decision-fork` /
     `live-run` / `governance-pushback` and ship's fresh ask stay armed. The grant is VOID on the first
     non-green signal — non-convergence, a surviving RED, a fork, scope drift from the frozen phase
     set, `INFRA_ERROR`/`OVERFLOW` — then STOP + surface at a normal boundary stop. Record the grant
     and each auto-passed boundary's evidence in the ledger; render one consolidated checkpoint at the
     end or at re-arm.) For the condition-triggered gates the options are the actual
     choices at hand: `decision-fork` → the fork's options (Codex-grounded, attributed); `live-run` →
     authorize / decline after the cost-and-cleanup briefing (trigger: BEFORE any live / paid / prod /
     irreversible touch — if in doubt whether an action is "live", it is); `governance-pushback` →
     override the gate / take the safe alternate path (a conversational "just skip it" — even from the
     human — is this gate's TRIGGER, not its waiver; only the structured answer can waive a gate).
  **Never advance a hard gate without the human's structured answer.**
  - **If `AskUserQuestion` is unavailable** (a subagent, or a headless/SDK session): do NOT collapse to
    prose and do NOT proceed. AFTER rendering + surfacing the artifact, write a **file-based escalation**
    with one structured question per independent decision (e.g. `plan-approval` ⇒ a `plan` question AND a
    `local-commits` question):
    `node <skill-dir>/references/escalation.mjs request <session-dir> <gateId> '<questionsJson>' "<authorizes>" <htmlPath> <mdPath>`
    Surface the request path (+ the opened board), then poll
    `node <skill-dir>/references/escalation.mjs check <session-dir> <requestId>` and resume
    ONLY on `status:"answered"` with a valid read-once answer. `pending`/`invalid` ⇒ keep waiting;
    **never advance without a complete valid answer** (ADR-006). A session that must end, ends AT the
    gate — the pending escalation file doubles as the handoff. This is the FALLBACK; the normal gate is `AskUserQuestion`.
  **Render NOW — don't defer the gate.** When the trigger fires, the Artifact must materialize *this
  turn*; do not postpone it to a "later turn" or replace the `AskUserQuestion` with an open free-text
  question. If you need a detail to populate the Artifact (e.g. *which* run, for `live-run`'s
  cost/blast-radius/cleanup), gather it **inside** the gate — render the brief with the known fields,
  mark the unknowns, and fold the clarification into the structured options — then block.
- **`auto`** → advance with `verification-before-completion`; no human stop.
- **`delegated`** (e.g. design approval) → the named skill owns the stop; don't re-encode it.
- **`posture`** (ship) → never act without the human's explicit ask (standing git discipline + deny rails).
- **`checkpoint`** (handoff) → produce the artifact/handoff at a pause; nothing to approve.

The module can't *block* you — your discipline + the AskUserQuestion do. Its job is to guarantee (via
its tests) the gate set can't silently erode. **Selectivity (§4) applies ONLY to unsolicited progress
notes — NEVER to a hard gate:** when a hard-gate trigger fires there is no materiality test; a "too
small to gate" phase still gets its boundary stop.

## §8 — Dispatch policy (right-size every subagent)

You are the conductor; workers are disposable and parallel. **The task's SHAPE — not habit, not cost
pressure — picks the worker's tier.** Choose the cheapest tier that won't need a redo: a redo (or a
blind-trusted wrong answer) costs more than dispatching right the first time.

| Task shape | Tier → current mapping | Typical work |
|---|---|---|
| Mechanical, fully-specified, crisp done-condition | **fast** → `haiku` | bulk renames, inventories, log scans, format sweeps |
| Well-scoped, crisp spec, a gate catches drift (tests / lint / review) | **standard** → `sonnet` (Sonnet 5 ≈ deep-tier on scoped work) | plan-phase implementation with tests already written, exploration/research fan-outs, spec-compliance review, docs |
| Judgment-heavy, under-specified, or high blast-radius | **deep** → `opus` (or the strongest tier available) | unknown-root-cause debugging, design & cross-cutting refactors, security surfaces, adversarial verification at a gate |

The *shapes* are durable; the *names* are not — update the mapping column when models ship. (A
hardcoded model name is exactly what rotted here before this table existed.)

- **Name model + effort on every dispatch**, with a one-line why. In dynamic Workflows the dials are
  `opts.model` / `opts.effort` (`low` · `medium` · `high` · `xhigh` · `max`); the Agent tool has no
  effort param — effort travels in the prompt (open with an explicit reasoning-depth instruction).
  When genuinely unsure, omit the model (inherit) rather than guess down.
- **Floors and ceilings.** Judgment-heavy / gate-bound work never drops below deep tier — cost
  pressure changes *what* you dispatch, never the floor. Mechanical work never "earns" deep tier by
  feeling important.
- **Reviewer ≥ implementer.** Quality reviews run at or above the implementer's tier; adversarial
  verification of anything crossing a gate runs deep.
- **Cheap findings are leads, not conclusions.** Re-verify fast/standard-tier findings — yourself at
  file:line, or via a deep worker — before they cross a gate or enter the ledger as fact.
- **Two failures at one tier = change something structural.** Escalate tier/effort, re-scope,
  decompose, or STOP + surface — never a third identical retry; carry the failure transcript along.
  If the structural change fails too, that is non-convergence — STOP + surface (two rungs max).
- **The conductor never implements.** Even a one-line phase gets a fresh implementer — your context
  (plan position, gate state, contracts) is the one thing a redo can't rebuild.
- **Log every dispatch outcome (ADR-007).** When a worker returns, append one JSONL line:
  `node <skill-dir>/references/dispatch-log.mjs append '{"session":"…","phase":"…","shape":"…","tier":"…","model":"…","effort":"…","why":"…","outcome":"ok|redo|escalated|failed"}'`.
  At initiative wrap-up, `dispatch-log.mjs stats` shows non-green rates per tier × shape — that
  data, not vibes, is what tunes this table's mapping over time.

## Red Flags — STOP, you're rationalizing a gate away

If any thought below is in your head, you are about to skip a gate. Stop and run the real gate.

| You're about to… | Reality |
|---|---|
| Run a homegrown "completeness critic" / your own review *as* the gate | That is NOT `codex-gate`. **Invoke the `codex-gate` skill.** "Same spirit" ≠ the independent gate. |
| Defer codex to "later / Stage-4 phase-review" | The PLAN bundle needs `codex-gate bundle`/`plan` → APPROVE **now**, before approval. "Later" ≠ at the gate. |
| Treat the-foreman's own `gate-contract.mjs --print` / `preflight.mjs` as the review | Those are *this skill's* scripts, not the independent gate. Run `codex-gate`. |
| Read a ledger/handoff that says "codex-gate APPROVE" and move on | A *recorded claim* is not the gate running. Invoke `codex-gate` yourself this initiative. |
| "Offer" codex-gate as an optional step at the end | §1 says run BOTH gates. It is **required, not offered.** |
| Answer "do you approve? / how far?" in prose, or ask "which should I start?" | You are AT the plan-approval hard gate. Render the planDeck, **surface** it (publish if the tool's there, else **open it in a Chrome tab** via `open-artifact.mjs` — §4·3), and **block on a structured `AskUserQuestion`** (§7). |
| Collapse the gate's two decisions into one casual question | Approve-the-plan and authorize-local-commits (default NO) are **orthogonal** — structured `AskUserQuestion`, not prose. |
| Skip a gate because "I'm just a subagent" / "the orchestrator will do it" | If `AskUserQuestion` is unavailable, render+surface then open a **file-based escalation** (`escalation.mjs`) and wait for a validated **read-once** answer (§7, ADR-006) — never silently proceed or downgrade to prose. |
| Apologize that "the Artifact publish tool isn't available" / stall / treat it as a blocker | Publishing is OPTIONAL hosting; the rendered file IS the complete, secret-scanned deliverable. **Open it in a Chrome tab** (`open-artifact.mjs`, §4·3), state the path, and **continue the gate** — the `AskUserQuestion`, not the URL, is the gate. No apology, no spiral. |
| Say "invoking codex-gate…" then end the turn waiting for a "monitor event" | `codex-gate` is **synchronous** — drive the loop to a verdict THIS turn; don't defer the gate (or the render-stop) to "when it returns". |
| Skip/substitute because "there's no real bundle dir to gate" | **Write the bundle to disk first, then run `codex-gate`.** Missing files = author them, not skip the gate. |
| Skip `phase-start`/`phase-review` because "the plan was already gated" | Each phase's codex calls are in the closed mandatory set (Non-negotiable #1) — per phase, every phase. |
| Declare "converged — the rest is noise" yourself | APPROVE is emitted by codex-gate, never by you. Rebut inside the loop; no verdict = non-convergence → STOP + surface. |
| Skip a boundary stop because the phase was "too small to be material" | Selectivity never applies to hard gates (§7) — every trigger renders and blocks, however small the phase. |
| Treat the kickoff "drive it idea→shipped" as the ship authorization | Ship needs a FRESH ask after the final boundary that names the act (§6·6). Stop at "ready to ship — awaiting your instruction". |
| Dispatch everything deep-tier out of habit — or downgrade judgment-heavy work to save tokens | §8: task shape picks the tier. Floors are floors, ceilings are ceilings. Name model + effort per dispatch. |
| Implement a phase inline "because I have the most context" | The conductor never implements (§8, §6·4). Even a one-line phase gets a fresh implementer. |
| Treat a chat "don't stop at the rest" as a granted batch-run | That is the TRIGGER to offer the structured batch-run option at the boundary (§7, ADR-008). Only the structured answer grants it. |
| Ride a granted batch-run past a non-convergence / RED / fork / scope drift | Batch-run is VOID on the first non-green signal — STOP + surface at a normal boundary stop. It never waives per-phase codex calls, reviews, verification, other gates, or ship's fresh ask. |
| Quietly lower `CODEX_GATE_MODEL`/`CODEX_GATE_EFFORT` (or flip the gate's knobs off) to save allowance | The gate's strength dials belong to the OWNER, not you — self-downgrading the independent gate is weakening a governance gate → `governance-pushback`. Cost concerns go TO the owner, never into env vars. |

**All of these mean: STOP. Invoke the real `codex-gate` skill, and run the §7 render-then-ask gate.**
