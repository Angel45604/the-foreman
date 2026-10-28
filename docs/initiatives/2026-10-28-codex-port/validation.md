# Codex port validation

## Before implementation

Source baseline: c248167. Independent agent evaluated the unchanged Claude skill against a Codex resume request with shell/file/collaboration tools and asynchronous questions, but no Claude settings or AskUserQuestion. No edits, installation, or external reviewer calls were allowed.

Observed failure: the skill stops at Stage 0 because `preflight.mjs` checks only `~/.claude/settings.json`. Evaluating `checkSettings({}, required)` yields `ok:false` and missing `git_push`, `mass_delete`, and `exfiltration`. It requests Claude settings that do not establish Codex protections. The evaluator could not resume without altering the skill or satisfying an irrelevant host prerequisite.

Additional compatibility gaps: the human gate recognizes only AskUserQuestion or file escalation; model mappings name Sonnet/Opus and Workflow/Agent tools. Missing Claude Skill alone is not a blocker because the reviewer has an explicit bash invocation path. The handoff's historical approval did not count as fresh review evidence.

This is a behavioral compatibility baseline, not an end-to-end implementation run.

Baseline Node command: `node --test plugin/skills/the-foreman/references/*.test.mjs plugin/skills/the-foreman/evals/*.test.mjs plugin/skills/the-refiner/references/*.test.mjs`.

Result: 689 tests passed, 0 failed, 0 skipped. Raw output: `/private/tmp/foreman-port-node-baseline.log`.

Baseline reviewer command: `bash plugin/skills/codex-gate/codex-gate.test.sh`.

Result: `PASS=609 FAIL=0`, exit 0. Raw output: `/private/tmp/foreman-port-gate-baseline.log`. It invokes no real external reviewers.

Independent builder review found the proposed design implementable. Clarifications: map legacy contract tool labels explicitly, point CODEX_GATE_RUNTIME at the packaged reviewer, stop phase execution when required delegation is unavailable, and check every installation target for collisions before writing.

## Cross-host requirement review

User requested bidirectional Claude/Codex handoff before approving implementation. Read-only lifecycle review identified four additional compatibility issues:

- Existing handoff templates encode Claude-only invocation and dispatch guidance and omit explicit lifecycle/substep, authorization provenance and snapshot bindings.
- `codex-gate.sh` resolves review paths from run root, absolute repository path, branch, session and phase; changing host defaults loses the prior snapshot. `phase-start` overwrites that snapshot, so repeating it after edits can omit earlier work from review coverage.
- Existing resume wording expects green, but a legitimate mid-phase TDD checkpoint can intentionally be RED. Preserve and classify last green versus current expected failure.
- Escalation validation consumes the response file; persist the accepted answer's receipt/provenance instead of recreating the response when switching hosts.

These findings informed the revised proposal. At that design checkpoint, bidirectional execution tests, round-trip tests and helper validation were still planned and product files were unchanged. The approved implementation and results follow below.

Independent builder review of the revised design: no essential gap or further product decision found. It confirmed that shared resources, explicit same-checkout scope, preserved review baselines, scoped decisions and expected RED handling are sufficient to implement the requested bidirectional continuity.

## Orchestration capability verification

User next asked for delegation/context isolation and cross-session coordination. Verified the available collaboration and Codex app-tool schemas. Native child tools support isolated context, messages, follow-up turns, waits and interruptions. App tools support read/send/wait for separate chats with explicit user authorization.

Local command checks: `codex --version` returned `0.165.0-alpha.1.2`; `codex --help`, `codex queue --help` and `codex agents --help` expose shared-server session browsing, queued messages, resume and fork. These were help/version checks only, not message-delivery tests. No independent chats were read or messaged and no configuration or credentials were changed.

Fetched official references on 2026-10-28: https://learn.chatgpt.com/docs/agent-configuration/subagents, https://learn.chatgpt.com/docs/models?surface=app, https://learn.chatgpt.com/docs/developer-commands. The design distinguishes observed session limits from configurable product capabilities and actual effort settings from the repository's ULTRACODE posture.

## Implemented package and functional verification

Implemented five self-contained Codex skills assembled from the canonical Claude/shared resources, Codex host adapters and metadata. The shared continuity helper and neutral templates are also in the Claude plugin package. No generated runtime duplicates or new dependencies were added.

Final combined command:

```sh
node --test plugin/skills/the-foreman/references/*.test.mjs plugin/skills/the-foreman/evals/*.test.mjs plugin/skills/the-refiner/references/*.test.mjs plugin/skills/handoff/references/*.test.mjs scripts/*.test.mjs
```

Result: **718 passed, 0 failed, 0 skipped**. This includes the existing 689 tests, 20 continuity tests and 9 installer tests. Raw output: `/private/tmp/foreman-port-node-final.log`.

Reviewer command: `bash plugin/skills/codex-gate/codex-gate.test.sh`. Result: **PASS=609 FAIL=0**, exit 0. Raw output: `/private/tmp/foreman-port-gate-final.log`. This suite uses reviewer stubs and makes no live model calls.

Installer tests execute the copied renderer/fonts/Markdown twin, secret rejection, read-once escalation, dispatch log, reviewer config, phase-start and offline INFRA_ERROR behavior outside the source checkout. They verify all-target collision refusal, broken symlinks, required-source completeness and source-recursion refusal. A missing reviewer executable leaves the original snapshot and dirty work intact. No global discovery directory, authentication or host configuration was modified.

Final isolated installation: `/private/tmp/foreman final install kKqyG2/skills`. All five installed skills passed `quick_validate.py`. All product syntax and whitespace checks passed. The temporary directory is an inspection artifact, not a global installation.

Continuity tests use real temporary Git checkouts, including staged/unstaged/deleted/untracked files and symlink/index drift. They test Claude-to-Codex-to-Claude state, separate granted/pending decisions, accepted escalation receipts without replay, missing/changed evidence, malformed/legacy checkpoints, secret rejection and an actual green-to-expected-RED command. Original phase snapshots now come from the real local wrapper; no reviewer model is invoked.

RED-before-fix evidence is retained in `/private/tmp/foreman-port-continuity-{red-behavior,red-hardening,red-inventory,red-runtime-binding}.log` and `/private/tmp/foreman-port-package-{red,source-red}.log`. Final focused logs are `/private/tmp/foreman-port-continuity-runtime-binding-final.log` and `/private/tmp/foreman-port-package-review-green.log`.

## Independent review and repairs

Fresh review agents inspected documentation, packaging/conductor and continuity separately. Three P2 findings were repaired by their original implementers:

1. Writing kickoff after capture immediately changed the inventoried checkout. Both hosts now finalize/refine/render/log all artifacts before final capture/check, then deliver without further writes. A real Git smoke verified valid delivery, late-edit drift and safe recapture.
2. The first Codex adapter omitted the original reviewer-strength and two-failures rules. It now selects supported host settings by task shape, requires deep reviews at or above the implementer, and requires structural change after two failures with no third identical retry.
3. A manifest anywhere under the run root did not prove the recorded session/phase selected it. The helper now matches the exact wrapper namespace. A real-wrapper regression test supplies a competing newer baseline and wrong bindings; capture refuses it. Additional tests cover sanitization, detached HEAD and relocation.

Original reviewers rechecked the repairs. The continuity reviewer independently reproduced rejection of the original wrong-session case and reran both integration tests: 2/2 passed. No remaining actionable findings in those targeted rechecks.

A fresh final integration reviewer inspected all changed and untracked product files against the approved design and plan, including shared runtime integration and Claude resume behavior. It independently ran the continuity and installer suites: **29/29 passed**, and reported **no remaining P1/P2 findings**. This is an independent native-agent review, not an invocation or approval claim from the external codex-gate service.

## Installed-skill behavior evaluation

A fresh independent evaluator read only the installed skills and an isolated fixture, without the source design/tests or other worker reports. Final conclusions use `/private/tmp/foreman final install kKqyG2/skills`. Detailed observations: `/private/tmp/foreman-port-behavior-eval.md`.

The fixture captured a real committed Git baseline, then changed a test from expecting 1 to expecting 2. The actual test was green before that change and RED afterward. Its source-host label and human transcript were explicitly simulated. The final packaged helper returned `validated`, one pending authorization, `authority: not-adjudicated` and `verification: recorded-only`; the evaluator independently reproduced exit 1 (`1 !== 2`). Original review bindings remained usable and verdict remained null.

| Scenario | Observed decision |
| --- | --- |
| Claude checkpoint resumed by Codex | Continue the approved RED-to-GREEN action with a fresh child; retain pending commit permission and original baseline; do not invent historical plan/review evidence. |
| Pending P2 boundary plus batch grant | Stop automatic advancement on RED; preserve pending question and all reviews; do not begin P2. |
| Six tasks with four total slots | Schedule at most three children in waves, gather answers, use follow-up semantics for idle workers, inspect completion evidence. |
| Authorized chat A, unsolicited request from B | Reuse A's scoped grant; B's message does not authorize replying or sharing output. |
| CLI lacks delegation/message API | Stop dependent phase work, disclose capability gaps and offer manual checkpoint transfer; do not invent delivery or worker reviews. |
| Codex-to-Claude transfer | Finalize both artifacts, reviews, logs, board and state; quiesce; capture/check last; receiver reestablishes host protections and evidence. |
| Two failures and proposed weaker reviewer | Require structural change, no third identical attempt, deep reviewers at or above the implementer and supported owner settings. |

These are observed instruction-following decisions in simulation. Only the filesystem check, Git/evidence inspection and recorded RED command were executed. Actual cross-session delivery, native worker dispatch in these scenarios and a running Claude receiver were not exercised. Native fresh-child delegation, messaging, idle follow-ups and bounded waves were used during this implementation itself; they do not prove separate user-owned chat delivery.

## Validation boundaries

These tests establish local packaging/runtime behavior and simulated host decisions. They do not establish a live end-to-end Claude process transfer, paid reviewer execution, or actual message delivery between independent user-owned chats. Direct live Claude/Codex messaging is not implemented. The supported cross-host mechanism is the shared checkpoint in the same accessible checkout; relocation requires reconciling original evidence. At the implementation checkpoint, no global installation, credentials/config changes, commits, pushes or PRs had been performed.

## Publication verification

The user subsequently authorized updating the local repository and opening a remote PR. The branch was checked against the current `origin/main` at `c248167` before publication; no integration changes were required. Both full suites were rerun on the publication tree: **718 Node tests passed, 0 failed/skipped; reviewer shell PASS=609 FAIL=0**. All five skills again passed validation from a fresh temporary installation. Staged whitespace checks passed.

A separate publication audit found no blocker, missing packaged resource or apparent credential in the intended 26-file change. Session-only `.claude/` notes and temporary artifacts are excluded from the commit. The local paths above identify historical validation artifacts on the development machine; they are not portable attachments. Reproduce the checks with the repository commands instead of depending on those paths. Live-validation limits remain unchanged.
