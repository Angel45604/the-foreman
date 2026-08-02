# the-foreman

A Claude Code plugin that turns Claude into a **gated development conductor**: it drives a
feature from idea → shipped through an explicit, fail-closed state machine instead of
free-running. The plugin bundles four skills: **the-foreman** (the conductor),
**codex-gate** (the independent Codex second-reviewer gate), **handoff** (cold-start handoff
docs + kickoff prompts), and **keep-it-simple** (the complexity killer).

What the skill owns:

- **Standing posture** — verify-before-assert, simpler-is-always-better, git discipline
  (LOCAL-only by default, never `git add -A`), and a verified-wins-only celebration threshold.
- **Stage-0 preflight** (`references/preflight.mjs`) — fail-closed check that the
  `permissions.deny` rails + hooks (push guard, mass-delete, exfiltration) are installed
  before any autonomous work. Missing rails ⇒ STOP with a ready-to-paste setup block.
- **Artifact engine** (`references/render.mjs`) — renders plan decks, decision cards,
  phase trackers, live-run briefs, and dashboards from a durable JSON ledger into
  self-contained, **secret-scanned** HTML (+ a portable Markdown twin). The scan is
  fail-closed: a detected secret/PII shape aborts the write.
- **Lifecycle conductor + gate contract** (`references/gate-contract.mjs`) — 7 stages with
  hard gates (plan-approval, phase-boundary, decision-fork, live-run, governance-pushback)
  enforced via render → surface → structured `AskUserQuestion`, with a file-based escalation
  fallback when that tool is unavailable.
- **Dispatch policy** — task *shape* (not habit) picks the subagent tier; reviewer ≥
  implementer; two failures at one tier forces a structural change; every dispatch outcome is
  logged (`references/dispatch-log.mjs`).

Everything above is backed by a `node:test` suite (contract-drift guards included) — see
[Tests](#tests).

## Repo layout

```
.claude-plugin/marketplace.json   # this repo doubles as its own single-plugin marketplace
LICENSE                           # MIT
plugin/
  .claude-plugin/plugin.json      # the plugin manifest
  LICENSE                         # MIT (the ./plugin dir is what the marketplace distributes)
  skills/
    the-foreman/
      SKILL.md                    # the conductor skill
      references/                 # scripts (render, preflight, gates, dispatch log) + tests
      evals/                      # skill-eval definitions + harness
    codex-gate/                   # independent Codex second-reviewer gate (CLI + test suite)
    handoff/                      # cold-start handoff doc + kickoff prompt templates
    keep-it-simple/               # ruthless complexity killer
```

## Install

### As a plugin (recommended)

```
/plugin marketplace add Angel45604/the-foreman
/plugin install the-foreman@angelm
```

All four skills then load automatically (each description triggers it at the right moment) and
can be invoked explicitly as `/the-foreman:the-foreman`, `/the-foreman:codex-gate`,
`/the-foreman:handoff`, and `/the-foreman:keep-it-simple`.

To try it locally before pushing anywhere:

```
/plugin marketplace add /path/to/this/repo
/plugin install the-foreman@angelm
```

### As personal skills (no plugin system)

Symlink each skill directory you want into your personal skills folder — then the bare names
(`/the-foreman`, `/codex-gate`, …) work unnamespaced:

```bash
git clone https://github.com/Angel45604/the-foreman ~/personal/the-foreman
for s in the-foreman codex-gate handoff keep-it-simple; do
  ln -s ~/personal/the-foreman/plugin/skills/$s ~/.claude/skills/$s
done
```

**Pick one install mode.** Both at once loads each skill twice.

## Bundled skills

- **`the-foreman`** — the gated development conductor (posture, preflight, lifecycle gates,
  Artifact engine, dispatch policy).
- **`codex-gate`** — the independent Codex second-reviewer gate (`codex-gate.sh`): review a
  plan/bundle/phase/pre-PR branch, ground decisions, investigate — with a fail-closed contract.
- **`handoff`** — produces the cold-start handoff doc + paste-ready kickoff prompt a fresh
  agent resumes from.
- **`keep-it-simple`** — ruthless complexity killer; challenge every layer before it ships.

## External prerequisites (not bundled)

- **Codex CLI + OpenAI/ChatGPT login** — required by `codex-gate` (it drives the `codex`
  binary; set `CODEX_BIN` if it's not on PATH).
- **superpowers plugin** — `brainstorming`, `writing-plans`, `subagent-driven-development`,
  `requesting-code-review`, `test-driven-development`, `systematic-debugging`,
  `verification-before-completion`, `using-git-worktrees`. Install via
  `/plugin marketplace add obra/superpowers-marketplace` then
  `/plugin install superpowers@superpowers-marketplace` (skip if a superpowers provider is
  already installed — exactly one should exist).
- **`commit-push-pr`** — repo-specific ship skill; any repo-local equivalent works, the-foreman
  references it by name at the ship stage only.

Runtime state (ledgers, rendered artifacts, dispatch log, escalations) lives under
`~/.claude/the-foreman/` — never inside the install directory, so plugin updates can't
destroy state.

## Tests

```bash
node --test plugin/skills/the-foreman/references/*.test.mjs plugin/skills/the-foreman/evals/*.test.mjs
```

(Node 22+: explicit globs are required — a bare directory no longer auto-discovers.)

```bash
bash plugin/skills/codex-gate/codex-gate.test.sh
```

(Green run ends with `PASS=<n> FAIL=0`; the printed count is the authoritative assert total.)

Both suites use no npm packages — Node stdlib + bash only. The runtime prerequisites (Codex CLI +
ChatGPT seat, superpowers skills, Claude Code host) are listed under
[External prerequisites](#external-prerequisites-not-bundled).

## Notes

- License: **MIT** (repo root + `plugin/LICENSE`).
- The marketplace `name` is `angelm`; change it if you want a different install handle
  (`/plugin install the-foreman@<name>`).
- The deck styling defaults to the MindCloud house style (accent `#009ACC`, crumb
  `MINDCLOUD · DEV WORKFLOW`) — both are per-ledger overridable (`meta.accent`, `meta.crumb`);
  genericize the defaults in `references/templates.mjs` / `style.css` if you ever want a
  brand-neutral release.
- A pre-publish audit initiative (four-skill hardening: guard-parser closure, CODEX_HOME
  bootstrap, cutover tooling, owner dials, low sweep) is specified and deferred — it resumes
  from the local initiative bundle, not this README.
