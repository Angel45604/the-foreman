# Codex runtime and decision channel

## Installation and state

`<skill-dir>` is the actual absolute directory containing the loaded Foreman SKILL.md. Resolve it from that loaded file, never assume a source checkout or a Claude install. Siblings are `<skill-dir>/../<name>`. Node, Bash, Git and the gate's documented shell prerequisites must be available; detect missing tools before dependent work. Shared scripts/assets are packaged with the skill.

For a new initiative choose a writable state directory separate from skill installation and unrelated runs, for example an initiative directory under `~/.codex/the-foreman/`. Resolve these explicit bindings before running commands:

- `FOREMAN_DISPATCH_LOG=<state-dir>/dispatch-log.jsonl`
- `CODEX_HOME_DIR=<state-dir>/reviewer-home` (dedicated reviewer authentication)
- `CODEX_GATE_RUNS=<state-dir>/reviews`
- `CODEX_GATE_SESSION=<stable-initiative-session-id>`
- `CODEX_GATE_RUNTIME=<actual-sibling-codex-gate-dir>/codex-gate.sh`

Pass bindings to command invocations. Do not globally repurpose HOME or CODEX_HOME, modify user configuration, or copy credentials. The shared reviewer sets CODEX_HOME only inside its isolated subprocess. If login is needed, surface the dedicated login command in the sibling gate adapter for the user; do not claim authenticated review from config output. Keep owner-selected model/effort and shared CLI defaults unchanged.

On resume adopt the recorded initiative ledger, `CODEX_GATE_RUNS`, `CODEX_GATE_SESSION`, phase ID, phase-start snapshot and PHASE_HEAD when accessible; preserve namespace even across hosts. Check shared [continuity.md](../../handoff/references/continuity.md) before any new snapshot. Never rerun phase-start over in-flight edits. Source/runtime parity may be UNAVAILABLE outside the checkout; report that truthfully. It does not make a complete installed package unusable or prove a mismatch.

## Native execution boundary

Inspect the session's actual Codex sandbox, approval and network policies and available tools; record relevant limits. Honor them without weakening host configuration. Claude's `references/preflight.mjs` and REQUIRED_DENY_RULES.json describe Claude settings; do not run them as Codex's Stage 0 or claim that passing them protects Codex. No new script can prove the agent is safe. Missing necessary capability/permission stops dependent work, with the exact limitation surfaced.

Local plan approval does not authorize paid/live/prod/irreversible probes, external publishing, git push or PR creation. Keep existing project safeguards and scoped grants. Never stage broadly with `git add -A`; commit explicit paths only under separately recorded local-commit authorization.

## Render, surface, decide

Read the gate/artifact/authorizes row from `references/gate-contract.mjs` (`node <skill-dir>/references/gate-contract.mjs --print`). Update the durable ledger per `references/ledger.schema.md`, then render:

```text
node <skill-dir>/references/render.mjs <ledger.json> <artifact-type> <output.html>
```

The renderer scans HTML and Markdown before writing, includes fonts and creates `.local.html` plus `.md` siblings. Surface the real `.local.html` in a supported Codex browser/file panel or clickable absolute path and the portable Markdown twin. A missing publish service does not waive a gate. Use the shared templates/renderer; do not hand-build a substitute board. Refine ledger prose through an isolated the-refiner worker before rendering; preserve schema and facts. Never publish secret-bearing output or use a display bypass after scanner rejection.

Use a documented native question tool only when available and its permitted scope includes this decision. Some question APIs permit optional clarifications but forbid approvals; do not use such an API to approve a gate. In interactive Codex, ask an explicit scoped question in chat after surfacing the artifact and await the genuine human response. Record the original request, response, scope, channel and evidence. In a headless/no-interactive channel use the existing file escalation CLI:

```text
node <skill-dir>/references/escalation.mjs request <state-dir> <gate-id> '<questions-json>' '<authorizes>' <html-path> <md-path>
node <skill-dir>/references/escalation.mjs check <state-dir> <request-id>
```

Questions are objects with `id`, `prompt`, nonempty `options` and optional `required`. The human/external authorized responder writes the matching response; the agent never creates an answer. Pending, invalid, default-selected or expired responses do not advance. `checkResponse()` consumes a validated response: immediately persist its returned answers and request/provenance receipt for handoff. Never recreate a consumed answer to replay it. Carry a pending request ID/questions forward unchanged.

For batch-run, get an explicit answer covering the remaining frozen phases, green precondition and revocation conditions through this supported decision channel; legacy references saying "structured answer only" refer to this recorded scoped decision. Ordinary chat that lacks that scope is insufficient. Already explicit authorization for that exact scope is retained, not requested twice.
