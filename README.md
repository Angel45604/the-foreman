# the-foreman

A Claude Code plugin that turns Claude into a **gated development conductor**: it drives a
feature from idea → shipped through an explicit, fail-closed state machine instead of
free-running.

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
plugin/
  .claude-plugin/plugin.json      # the plugin manifest
  skills/the-foreman/
    SKILL.md                      # the skill itself
    references/                   # scripts (render, preflight, gates, dispatch log) + tests
    evals/                        # skill-eval definitions + harness
```

## Install

### As a plugin (recommended)

```
/plugin marketplace add <your-github-username>/the-foreman
/plugin install the-foreman@angelm
```

The skill then loads automatically (its description triggers it at the start of development
work) and can be invoked explicitly as `/the-foreman:the-foreman`.

To try it locally before pushing anywhere:

```
/plugin marketplace add /path/to/this/repo
/plugin install the-foreman@angelm
```

### As a personal skill (no plugin system)

Symlink the skill directory into your personal skills folder — then `/the-foreman` works
unnamespaced:

```bash
git clone <repo-url> ~/personal/the-foreman
ln -s ~/personal/the-foreman/plugin/skills/the-foreman ~/.claude/skills/the-foreman
```

**Pick one install mode.** Both at once loads the skill twice.

## Dependencies (not bundled)

The skill *orchestrates* — it delegates to other skills by name and degrades loudly, not
silently, when they're absent:

- **`codex-gate`** (hard dependency for the gate lifecycle) — the independent second-reviewer
  gate the Non-negotiables require. Expected as a personal skill at `~/.claude/skills/codex-gate`.
- **`handoff`** (hard dependency for §5) — produces the cold-start handoff doc + kickoff prompt.
  Expected at `~/.claude/skills/handoff`.
- **superpowers plugin** — `brainstorming`, `writing-plans`, `subagent-driven-development`,
  `requesting-code-review`, `test-driven-development`, `systematic-debugging`,
  `verification-before-completion`, `using-git-worktrees`.
- **`commit-push-pr`** — repo-specific ship skill; any repo-local equivalent works, the skill
  references it by name at the ship stage only.

Runtime state (ledgers, rendered artifacts, dispatch log, escalations) lives under
`~/.claude/the-foreman/` — never inside the install directory, so plugin updates can't
destroy state.

## Tests

```bash
node --test plugin/skills/the-foreman/references/*.test.mjs plugin/skills/the-foreman/evals/*.test.mjs
```

(Node 22+: explicit globs are required — a bare directory no longer auto-discovers.)

## Before you publish (TODOs)

- [ ] `.claude-plugin/marketplace.json` — the marketplace `name` is `angelm`; change it if you
      want a different install handle (`/plugin install the-foreman@<name>`).
- [ ] Add `"repository"` + `"homepage"` to `plugin/.claude-plugin/plugin.json` once the GitHub
      URL exists.
- [ ] Choose a license and add a `LICENSE` file (none is set — the repo is all-rights-reserved
      until you pick one).
- [ ] The deck styling defaults to the MindCloud house style (accent `#009ACC`, crumb
      `MINDCLOUD · DEV WORKFLOW`) — both are per-ledger overridable (`meta.accent`,
      `meta.crumb`); genericize the defaults in `references/templates.mjs` / `style.css` if you
      ever want a brand-neutral public release.
