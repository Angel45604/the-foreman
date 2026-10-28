# the-foreman

A **gated development conductor** for Claude Code and Codex desktop/CLI: it drives a feature
from idea → shipped through an explicit, fail-closed lifecycle. The Claude plugin and Codex
skill package share the runtime and continuity contract. Both bundle five skills: **the-foreman** (the conductor),
**codex-gate** (the independent Codex second-reviewer gate), **handoff** (cold-start handoff
docs + kickoff prompts), **keep-it-simple** (the complexity killer), and **the-refiner**
(rewrites and reviews existing prose against a plain, direct, non-AI voice contract; preserves
every fact, hedge, and identifier).

What the skill owns:

- **Standing posture** — verify-before-assert, simpler-is-always-better, git discipline
  (LOCAL-only by default, never `git add -A`), and a verified-wins-only celebration threshold.
- **Stage-0 preflight** — Claude checks its `permissions.deny` rails + hooks
  (`references/preflight.mjs`); Codex checks its actual sandbox, approval, network and worker
  capabilities. Missing required protections/capabilities ⇒ stop and surface the gap. Claude
  settings do not protect Codex.
- **Artifact engine** (`references/render.mjs`) — renders plan boards, decision cards,
  phase trackers, live-run briefs, and dashboards from a durable JSON ledger into
  self-contained, **secret-scanned** neumorphic Gate Board HTML (+ a portable Markdown
  twin). The scan is fail-closed: a detected secret/PII shape aborts the write.
- **Lifecycle conductor + gate contract** (`references/gate-contract.mjs`) — 7 stages with
  hard gates (plan-approval, phase-boundary, decision-fork, live-run, governance-pushback)
  enforced via render → surface → an explicit human decision through the receiving host's
  supported channel. Claude uses structured `AskUserQuestion`; Codex uses a permitted native
  question channel or explicit scoped chat answer. Headless runs use validated read-once
  file escalations. Pending questions and silence never grant approval.
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
  output-styles/                  # optional Plain Voice output style
  skills/
    the-foreman/
      SKILL.md                    # the conductor skill
      references/                 # scripts (render, preflight, gates, dispatch log) + tests
      evals/                      # skill-eval definitions + harness
    codex-gate/                   # independent Codex second-reviewer gate (CLI + test suite)
    handoff/                      # cold-start handoff doc + kickoff prompt templates
    keep-it-simple/               # ruthless complexity killer
    the-refiner/                  # plain-voice prose rewriter/reviewer
codex/skills/                    # Codex entrypoint/metadata overlays; shared resources stay canonical
scripts/install-codex.mjs         # dependency-free, no-clobber five-skill installer
```

## Install

### Claude Code plugin

```
/plugin marketplace add Angel45604/the-foreman
/plugin install the-foreman@angelm
```

All five skills then load automatically (each description triggers it at the right moment) and
can be invoked explicitly as `/the-foreman:the-foreman`, `/the-foreman:codex-gate`,
`/the-foreman:handoff`, `/the-foreman:keep-it-simple`, and `/the-foreman:the-refiner`.

To try it locally before pushing anywhere:

```
/plugin marketplace add /path/to/this/repo
/plugin install the-foreman@angelm
```

### Claude Code personal skills (no plugin system)

Symlink each skill directory you want into your personal skills folder — then the bare names
(`/the-foreman`, `/codex-gate`, …) work unnamespaced:

```bash
git clone https://github.com/Angel45604/the-foreman ~/personal/the-foreman
for s in the-foreman codex-gate handoff keep-it-simple the-refiner; do
  ln -s ~/personal/the-foreman/plugin/skills/$s ~/.claude/skills/$s
done
```

**Pick one install mode.** Both at once loads each skill twice — nothing detects that for you, so keep
track of which mode you chose. If you'd rather keep a **physical copy** at `~/.claude/skills/codex-gate`
instead of a symlink, `cp -r` the directory instead of `ln -s` — then a copy can drift from the checkout,
so see `plugin/skills/codex-gate/README.md`'s "Manual sync" section for the exact copy command and the
parity check that confirms it landed. Run `codex-gate.sh config` any time to check whether the two copies
have quietly drifted apart and whether the installed one is complete: it inspects **one** configured
runtime endpoint against the versioned source and enumerates no other installs.

### Codex desktop and CLI

From a checkout, run the installer with Node. It assembles all five self-contained skill directories
from canonical shared sources plus Codex overlays. There is no npm install, source-checkout dependency,
configuration edit or authentication step in installation.

```bash
node scripts/install-codex.mjs --dest "$HOME/.agents/skills"
```

`--dest` is optional; the default is `~/.agents/skills`. Use an explicit directory for another existing
skill-discovery convention. The installer validates every source and target before copying and refuses
any existing skill target, including symlinks; it has no force/overwrite mode. Each installed skill
includes its resource dependencies and license. Load skills in a new Codex session, then ask to use
`the-foreman`, `handoff`, `codex-gate`, `keep-it-simple` or `the-refiner` by the listed skill name.

To inspect a temporary install without touching discovered skills:

```bash
foreman_test_install="$(mktemp -d)"
node scripts/install-codex.mjs --dest "$foreman_test_install/skills"
node "$foreman_test_install/skills/the-foreman/references/gate-contract.mjs" --print
```

For an update, install into a **new empty staging directory** first and inspect/test it. Close or
quiesce active sessions, back up the five old skill directories outside the discovery directory,
then move the five reviewed replacements into their now-vacant destinations. Keep a rollback copy;
do not copy new files over old directories or delete runtime state. The installer intentionally
refuses an in-place update. Choose one discovered copy of each skill per host to avoid duplicates.

## Handoff between Claude and Codex

Ask either host to `prepare a handoff`, `handoff to Codex` or `handoff to Claude`. It writes the same
two Markdown artifacts: a full checkpoint and a short kickoff prompt. Open the receiving host in
the same checkout and give it the kickoff or handoff path. No prompt translation, branch reset,
commit, push or conversation export is needed. Existing project context locations, including
`.claude/context/`, remain usable by both hosts.

The [shared continuity contract](plugin/skills/handoff/references/continuity.md) defines the versioned
resume data and capture/check helper. It preserves dirty work, initiative/stage/phase/next action,
original review snapshots and evidence, actual human decisions, pending gates and consumed escalation
receipts. The receiver validates identities/evidence, reruns relevant checks and resumes the first
unfinished action. Matching verified approvals carry forward; a host switch grants no new permission.
An expected TDD RED checkpoint can resume its authorized implementation step while retaining the last
green baseline, but cannot pass a phase boundary. Missing or changed evidence leaves the affected gate
unverified. Different machines/worktrees also require the actual work and evidence to be accessible;
the receiver reports gaps instead of resetting dirty work or replacing the original review baseline.

Native child workers handle bounded research, implementation, reviews and verification with isolated
assignments and durable evidence. Required delegation must be available before phase execution.
Independent user-owned chats are separate: creation/forking and messages need the user's explicit
request/authorization for the participants and scope. The desktop uses available app tools; CLI
coordination depends on the installed command set. A queued message is not completed work or
permission for an unsolicited reply. These skills provide no direct live Claude↔Codex chat bridge;
the shared checkpoint is the supported cross-host transfer.

## Bundled skills

- **`the-foreman`** — the gated development conductor (posture, preflight, lifecycle gates,
  Artifact engine, dispatch policy).
- **`codex-gate`** — the independent Codex second-reviewer gate (`codex-gate.sh`): review a
  plan/bundle/phase/pre-PR branch, ground decisions, investigate — with a fail-closed contract.
- **`handoff`** — produces the cold-start handoff doc + paste-ready kickoff prompt a fresh
  agent resumes from.
- **`keep-it-simple`** — ruthless complexity killer; challenge every layer before it ships.
- **`the-refiner`**: rewrites and reviews existing prose against a plain, direct, non-AI voice
  contract; preserves every fact, hedge, and identifier.

The plugin also ships an optional **Plain Voice** output style
(`plugin/output-styles/plain-voice.md`); it is not forced on users, and it activates via
`/config` or the `outputStyle` setting.

## External prerequisites (not bundled)

- **Node.js** for the installer, renderer, continuity helper, escalation and dispatch tools (Node 22+
  for the documented test commands). No npm packages are required.
- **Bash, git, jq and shasum** for the independent reviewer runtime and its shell suite, plus standard
  Unix command-line utilities. The skills do not install these tools.
- **Codex CLI + user-managed OpenAI/ChatGPT authentication** for live `codex-gate` reviews. Set
  `CODEX_BIN` to an executable path or command on PATH when the bundled macOS app path is unavailable.
  Installing the skills alone neither requires an API key nor performs a paid reviewer call.
- **Workflow skills** for brainstorming, planning, worker implementation, spec/quality review, TDD,
  debugging and verification, available to the selected host. Claude's usual provider is superpowers:
  `/plugin marketplace add obra/superpowers-marketplace`, then
  `/plugin install superpowers@superpowers-marketplace` (only if no provider is already installed).
  Codex must use its installed compatible skills and native tools; do not load Claude conductor
  instructions as a Codex adapter or assume Claude plugin commands exist there.
- **`commit-push-pr`** or the project's equivalent ship workflow, needed only when shipping is explicitly
  authorized. Plan approval and local-commit permission are separate; neither authorizes push or PR.

### Runtime isolation and reviewer login

Keep ledgers, rendered boards, escalations, dispatch logs and reviewer runs in writable state directories,
never the skill install. Claude's defaults stay under `~/.claude/the-foreman/` and
`~/.claude/codex-gate/`. For a **new Codex initiative**, select a separate state root and set the existing
per-process overrides before invoking packaged commands, for example:

```bash
export FOREMAN_STATE_DIR="$HOME/.local/state/the-foreman/codex"
export CODEX_HOME_DIR="$FOREMAN_STATE_DIR/reviewer-home"
export CODEX_GATE_RUNS="$FOREMAN_STATE_DIR/reviewer-runs"
export FOREMAN_DISPATCH_LOG="$FOREMAN_STATE_DIR/dispatch-log.jsonl"
export CODEX_GATE_SESSION="my-initiative"
export CODEX_GATE_RUNTIME="$HOME/.agents/skills/codex-gate/codex-gate.sh"
```

`FOREMAN_STATE_DIR` is an operator-selected path convention for the ledger/artifacts/escalations;
the runtime overrides above bind the reviewer/log locations. Use the actual installed path for
`CODEX_GATE_RUNTIME` and choose a stable initiative session. On a cross-host resume, adopt the
checkpoint's accessible ledger/run/session/snapshot bindings rather than resetting to these defaults.
Never call `phase-start` again over an in-progress phase.

Reviewer authentication belongs to the user. When needed, the user logs into the dedicated reviewer
home with the selected Codex executable (for example `CODEX_HOME="$CODEX_HOME_DIR" codex login`). Keep
that assignment scoped to the login/reviewer process; do not globally change CODEX_HOME, copy/symlink
credentials or repurpose HOME. The installer never performs this login. The wrapper runs reviews in
an isolated, read-only process; it preserves owner-selected model/effort settings. `config` and
`phase-start` do not perform a review. Without the source checkout, source/runtime parity is
unavailable; packaged completeness can still be checked without declaring a mismatch. With the source
checkout visible, intentional Codex entrypoint/metadata overlays can differ from the Claude source
inventory. Do not overwrite Codex adapters with Claude files to chase diagnostic parity.

## Tests

```bash
node --test plugin/skills/the-foreman/references/*.test.mjs plugin/skills/the-foreman/evals/*.test.mjs
```

(Node 22+: explicit globs are required — a bare directory no longer auto-discovers.)

```bash
node --test plugin/skills/the-refiner/references/*.test.mjs plugin/skills/handoff/references/*.test.mjs scripts/install-codex.test.mjs
```

```bash
bash plugin/skills/codex-gate/codex-gate.test.sh
```

(Green run ends with `PASS=<n> FAIL=0`; the printed count is the authoritative assert total.)

The suites require no npm packages. Node tests use built-ins and temporary files/git repositories;
the reviewer Bash suite uses stubs and does not call a live external reviewer. Behavioral simulations
are distinct from live Claude/Codex execution and actual delivery between independent chats. Runtime
prerequisites are listed under [External prerequisites](#external-prerequisites-not-bundled).

## Notes

- License: **MIT** (repo root + `plugin/LICENSE`).
- The marketplace `name` is `angelm`; change it if you want a different install handle
  (`/plugin install the-foreman@<name>`).
- Artifacts render as the neumorphic Gate Board (house accent `#5B7CFA`, crumb
  `THE-FOREMAN · DEV WORKFLOW`) — both are per-ledger overridable (`meta.accent`, `meta.crumb`);
  the defaults live in `references/style.css` / `references/templates.mjs`.
- A pre-publish audit initiative (four-skill hardening: guard-parser closure, CODEX_HOME
  bootstrap, cutover tooling, owner dials, low sweep) is specified and deferred — it resumes
  from the local initiative bundle, not this README.
