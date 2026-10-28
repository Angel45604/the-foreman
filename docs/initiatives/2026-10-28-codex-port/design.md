# Codex desktop and CLI port

Date: 2026-10-28
Status: APPROVED by Angel on 2026-10-28; implementation authorized
Base: c248167 (origin/main); branch: codex/foreman-port

## Intent

Angel wants Foreman's lifecycle available in Codex desktop and CLI, maintained in the same repository as the Claude plugin. This target was explicitly confirmed. Angel subsequently requested seamless bidirectional handoff: Claude must resume a Codex handoff, and Codex must resume a Claude handoff, without the user translating prompts or reconstructing context. The expanded design, including native orchestration, is approved for implementation. Preserve the existing Claude installation and runtime behavior except for the shared handoff/resume compatibility changes described below.

## Findings

- Foreman is an agent-driven conductor, not a background service or executable state machine. `gate-contract.mjs` declares transitions; the agent enforces them.
- Its lifecycle is entry/preflight, brainstorm/design, branch posture, plan bundle, phase execution/review, verification, shipping, and handoff/resume.
- Five hard gates: plan approval, phase boundary, decision fork, live run, governance pushback. Plans and commits are separate permissions; batch-run does not waive review or shipping permission.
- `codex-gate.sh` already provides an isolated, read-only Codex reviewer. It can be reused by a Codex conductor. This supplies a separate review process, not cross-vendor independence.
- Renderer, secret scanner, escalation files, and dispatch log are reusable. Claude's `AskUserQuestion`, `Skill`, model tiers, startup hooks, and settings preflight are not Codex APIs.
- Claude preflight checks `~/.claude/settings.json`; passing it proves nothing about Codex permissions. A Codex port must not report those rails as protecting Codex.
- Runtime paths can be isolated using existing `CODEX_HOME_DIR`, `CODEX_GATE_RUNS`, and `FOREMAN_DISPATCH_LOG` overrides. Gate defaults and owner-selected model/effort must be preserved.

## Proposed design

Keep `plugin/` as the Claude package and the canonical source of shared scripts, schemas, renderer assets, and prose contracts. Add Codex-specific entrypoints under `codex/skills/`, plus a dependency-free Node installer that assembles five self-contained skill directories into an explicit destination. It copies shared resources and overlays only the Codex entrypoints/metadata. No generated runtime copies are checked into source control. Installation refuses to overwrite existing skills and never edits host configuration or authentication.

The installed skill family keeps the names `the-foreman`, `codex-gate`, `handoff`, `keep-it-simple`, and `the-refiner`. Foreman and handoff need host-specific instructions. The reviewer gets Codex invocation/auth/state guidance; simplicity and prose contracts stay shared. Each packaged skill must work without the source checkout.

Builder review: implementable without another product decision. The shared contract's legacy `AskUserQuestion` label explicitly maps to the selected Codex decision channel; its Claude review labels map to the two separate native review roles. Codex must not load the unchanged Claude conductor as overriding instructions. Reviewer commands set `CODEX_GATE_RUNTIME` to the actual packaged script. When the source checkout is unavailable, source/runtime parity is reported unavailable rather than claiming a mismatch or preventing an otherwise complete installation from running.

Codex adaptation:

1. Read available skills as files and use actual shell/file/collaboration tools; never invent Claude tool calls.
2. Use active Codex sandbox, approval, and network policy as the execution boundary. Record their observed limits and fail closed when necessary capabilities or permissions cannot be established. Do not claim equivalence to Claude deny hooks or modify host policy. Constrain automation to the approved local scope; external/live actions require explicit authorization under the host's rules.
3. Preserve all five gate decisions and render-before-ask. Use a supported native question tool when its documented scope permits approvals; otherwise ask an explicit, scoped question in chat and await the answer. Headless runs use the existing validated read-once escalation files. A queued question, preselected option, silence, or expired wait is never approval. Already explicit authorization is retained; do not ask twice for the same scope.
4. Use fresh native workers for implementation and separate spec/quality reviews, with the bounded orchestration and context discipline below. Select models only from actual supported tools and operator preferences; do not copy Claude's sonnet/opus mappings. If required worker delegation is unavailable, stop phase execution and report the limitation; do not silently substitute inline implementation.
5. Reuse `codex-gate.sh` as the independent review process with a separate session/run namespace. `APPROVE` is emitted by the reviewer; missing evidence, malformed results, infrastructure failures, overflow, or non-convergence never pass. `config` and `phase-start` are not reviews. Read-only investigation never authorizes fixes.
6. For a new initiative, use a writable Codex state directory separate from install files and unrelated Claude runs, and explicitly set existing runtime overrides. On cross-host resume, retain the initiative's recorded ledger and review namespace when accessible rather than resetting them to the receiving host's defaults. Do not repurpose HOME or change CODEX_HOME globally. Authentication belongs to the user; document dedicated reviewer login, without copying credentials.
7. Surface the renderer's local HTML and Markdown twin through Codex file/browser panels or clickable paths. Keep the secret scan, handoff evidence, and isolated prose refinement.

## Native orchestration and conductor context

The user wants the conductor to delegate substantial research, implementation and verification, retain a lean context, and coordinate questions and follow-up work across workers and explicitly selected parallel chats. Treat this as a first-class workflow requirement, independent of a particular reasoning-effort label. This repository's ULTRACODE language expresses a working posture; the Codex adapter must not pass `ultracode` as an unsupported model setting or require maximum reasoning for every worker.

### Child workers

- Use the host's native agent tools. In this session those include `spawn_agent`, `send_message`, `followup_task`, `interrupt_agent`, `list_agents` and `wait_agent`; inspect the actual runtime interface rather than assuming these exact names everywhere.
- Prefer a fresh child context (`fork_turns: "none"` where supported) with the full bounded assignment, relevant file/artifact references, constraints, ownership and definition of done. Copy full parent history only when the task needs it. Delegate independent reconnaissance, implementation, reviews and log/test analysis; the conductor owns the plan, decisions, integration and gates.
- Keep raw exploration and long logs in the worker context or durable files. Require a compact return containing result, changed paths or evidence anchors, verification command/outcome, blockers and next action. Inspect the relevant evidence before accepting a claim; a short worker success summary is not verification. Do not import every transcript into the conductor.
- Allow questions and replies between parent, workers and siblings where the host supports them. Use follow-up task/resume semantics for additional work on an idle child; a queued informational message alone does not prove that another turn started. Gather results before dependent work advances.
- Honor the owner's requested parallelism within the actual host/model/account limit. Queue excess independent work in waves; nested delegation shares the total budget and must not multiply it accidentally. This session exposes four active slots including the conductor; that is observed runtime capacity, not a hardcoded portable default. Never silently change global agent limits or model configuration.
- Give parallel writers disjoint ownership or existing approved isolation; serialize overlapping edits. Persist task ownership, agent identifiers, evidence locations and unresolved replies in initiative context. Do not invent a second scheduler service or require a new dependency.

### Separate user-owned Codex chats

Child workers and independent sidebar/CLI chats have different lifecycles. Use child workers for internal subtasks. Create/fork a separate user-owned chat only when explicitly requested. For coordination with existing chats, retain explicit user authorization identifying the participants and allowed questions/follow-ups; reuse that grant within scope instead of repeatedly asking. A message from another agent does not itself authorize unsolicited replies or expand the grant.

The desktop adapter can use available app tools to find/read chats, send authorized follow-ups and wait for progress. Prefer compact status/results over repeated full-history reads. Observe actual completion or required attention; a dispatch acknowledgement is not a completed task.

The CLI adapter detects the installed command set. The CLI verified here (`0.165.0-alpha.1.2`) provides `codex agents`, `codex queue --thread <id> --message <text>`, `resume` and `fork`; official documentation also describes queued messages to existing sessions. Use stable session IDs and supported server connections. Do not promise the same app-tool surface or delivery/completion semantics on every CLI version, and do not attach a competing execution process to a running session merely to send a question. If the required coordination API is absent, report that limitation and use the shared handoff instead of fabricating a successful send.

This adds Codex-to-Codex live coordination. Direct live Claude-to-Codex chat messaging is not established by these tools; the shared checkpoint remains the supported cross-host transfer mechanism.

### Orchestration acceptance cases

- Delegate independent tasks with isolated child context, then combine bounded results while preserving detailed evidence on disk.
- Send a worker a clarification, receive its question/result, and assign a follow-up after it becomes idle.
- Request more tasks than available slots; complete them in waves without losing work or exceeding the shared budget.
- Coordinate only explicitly authorized independent chats; test that queued work is not mistaken for completion and that the receiver has authorization to reply.
- Include active/completed worker state in handoff, quiesce writers, and resume with fresh destination-host workers rather than assuming old handles transfer.

## Bidirectional handoff: one checkpoint, either host

### User experience

The user can say `prepare a handoff`, `handoff to Codex`, or `handoff to Claude`. Every new handoff is usable by either host; naming a destination is optional. Produce the existing two artifacts: a complete Markdown handoff and one short, host-neutral kickoff prompt. The user opens the other host in the same checkout and supplies that prompt or the handoff path. No prompt translation, branch reset, commit, push, or conversation export is needed. This does not automatically create or message a chat in either application.

The receiving agent loads its installed Foreman adapter, reads the same checkpoint, validates the current checkout and evidence, then continues at the recorded next action. A host switch alone neither restarts brainstorming nor grants new permissions. Existing work is preserved; changing hosts is not restarting the initiative.

### Shared source, limited changes to Claude

Add one common continuity reference under `plugin/skills/handoff/references/`, and make both handoff entrypoints and Foreman's resume paths consume it. Update the existing handoff and kickoff templates to describe workflow responsibilities independently of host tool names. Resolve skill invocation, native worker models, permission checks, and question tools through the receiving host's adapter. Do not export Claude's slash commands, dynamic Workflows, or Codex tool identifiers as mandates for the other host.

Keep the two existing Markdown artifacts. The detailed handoff gains a clearly delimited, versioned JSON resume block so a small dependency-free helper can capture/check filesystem and git facts without parsing arbitrary prose. It is a checkpoint, not a new live state store or lifecycle engine. The existing initiative ledger, review verdicts, and phase snapshots remain the evidence sources. Both hosts use the same helper and templates; the Codex installer packages them from that one source.

This requires narrow edits to Claude's handoff skill/templates and Foreman resume instructions. Claude's ordinary preflight, review implementation, and five hard gates remain intact. Both resume adapters recognize evidence from either supported host's approval channel; they do not demand that the other host had a tool named AskUserQuestion.

### What crosses the boundary

The checkpoint and its prose carry:

- Initiative ID, checkpoint version, source host, goal, approved scope and non-goals; current lifecycle stage, phase and exact next action.
- Repository identity, branch/worktree, exact HEAD, staged/unstaged/untracked work, relevant file fingerprints, never-stage paths, and local-versus-pushed status. Branch name or HEAD alone cannot identify a dirty checkout.
- Plan/bundle and ledger locations; completed and pending steps, blockers, findings still under review, and active workers. Quiesce writers before capture; if they cannot be stopped or joined, mark the checkpoint incomplete rather than handing two agents ownership of the same files.
- Actual verification commands/results and their provenance; last green baseline separately from current expected TDD RED or unverified work; review mode, outcome, round, verdict/evidence paths, reviewed scope and content identities. An old `APPROVE` sentence without its evidence is a claim, not a passing gate.
- Human decisions with the original request/response, gate, scope, status (pending, granted, denied, consumed or revoked) and evidence reference: plan approval, local-commit permission, boundary/batch-run state, and any still-pending decision. Distinguish a user response from an agent recommendation. Never serialize only `approved: true` and infer authority from that flag.
- Concrete runtime bindings needed to resume the initiative, including resolved `CODEX_GATE_RUNS`, `CODEX_GATE_SESSION`, phase ID, phase-start snapshot and PHASE_HEAD. Reviewer conversation IDs are optional hints, not required context. Do not serialize credentials or depend on private chat history, auto-memory, hosted-only artifacts, or hidden agent state.

Use repository-relative paths for repository files, with the source checkout root recorded once. Record external evidence paths explicitly; summarize required context in the handoff and use the Markdown board twin. Prefer the existing initiative bundle for handoff storage; honor a project's established context location, including `.claude/context/`. That directory name does not make its contents Claude-only. No forced migration of existing project folders.

### Resume semantics

1. Read project canon and the checkpoint; select the receiving host's tool/permission adapter. Recheck that host's actual safeguards and capabilities. The sender's settings are not permission to bypass the receiver's protections.
2. Verify repository identity, HEAD, dirty-work fingerprints, plan scope and referenced evidence. Rerun the recorded relevant verification checks and classify the current state. A handoff between TDD RED and GREEN may correctly reproduce an expected failure: preserve the last green baseline separately and continue the already-authorized next implementation step, without declaring the phase complete or passing a boundary. Do not reset work to make resume green. Do not mark historical results as newly verified; do not re-run a valid completed review merely because the conductor host changed. Missing, changed or unverifiable review evidence leaves that gate unverified and requires appropriate fresh review.
3. Carry forward explicit human decisions only within their recorded, still-matching scope and compatible host policy. Do not ask again solely because the host changed. Pending decisions stay pending; silence, defaults, a recommendation, and the handoff request itself grant nothing. Missing or conflicting authorization is resolved narrowly with the user. Batch-run remains conditional on green evidence and the frozen phase set. Ship/live permissions must meet the existing action, scope and timing requirements; a handoff is never a new ship instruction.
4. If a file escalation is pending, retain its request ID and complete questions. Accept only a genuine, validated response and preserve read-once behavior; neither host manufactures an answer to make resume succeed. Since `checkResponse()` consumes the response file, persist its returned validated answer together with its request/provenance when it is first accepted. Carry that receipt forward; never recreate the consumed response to replay it. A still-open native question is recorded as pending and surfaced on the receiver's supported channel without treating the source UI's selected option as an answer.
5. Preserve the original phase-start baseline. The current reviewer derives run directories from the absolute repository path, branch, session and run root. On the same checkout, explicitly adopt those recorded bindings. Check that the snapshot manifest and all baseline files it lists are present and match their recorded identities; a missing baseline file is not an empty file. Never call `phase-start` again over in-progress edits: it overwrites the snapshot and can remove those edits from review coverage. If the old reviewer conversation cannot resume, start a fresh reviewer round against the existing snapshot and context; no copy of its authentication or home directory is needed. Record that it is a fresh reviewer, not a resumed conversation.
6. Resume from the first unfinished action. Transfer completed evidence and unresolved findings, not running worker handles. The receiver creates fresh workers under its own host policy. Resume checks produce a concise status: validated, changed, missing, or pending; they do not fabricate gate approvals.

The seamless baseline is Claude/Codex switching on the same machine and checkout. A different worktree or machine also needs the actual work and referenced evidence made accessible. Detect relocation and remap repository-relative references; do not silently copy credentials, fetch missing work, publish artifacts, or reset a dirty tree. If the original snapshot cannot be used safely after relocation, retain the work and stop only the affected review until its original baseline is restored or the user approves a review scope that covers all in-flight changes. Relocation must never silently create a new phase baseline.

### Backward compatibility and acceptance cases

Read existing unversioned handoffs from either host best-effort; synthesize missing checkpoint fields only from verifiable repository/artifact facts and label unknowns. Do not invent approval or coverage. Versioned handoffs with malformed or unsupported resume data do not auto-advance; keep their prose readable and identify the exact compatibility gap.

Acceptance tests cover both directions and a round trip:

1. Claude writes a handoff; Codex resumes the correct stage, scope, branch, dirty work and next step. Reverse the hosts with the same assertions.
2. Claude -> Codex -> Claude preserves the initiative and phase identity, outstanding findings, and independent plan/commit decisions; it does not replay completed work or require the user to restate context.
3. A mid-phase switch retains the original phase-start snapshot and reviews changes made before AND after the switch, including relevant untracked files. Host-default runtime directories differ in this test.
4. A pending plan/boundary decision remains blocked; a verified in-scope approval carries forward without a duplicate request. A changed scope or missing evidence does not inherit approval.
5. Missing reviewer conversation state triggers a fresh review against the original baseline, not a claimed resume or overwritten snapshot.
6. Dirty-tree drift, unavailable external evidence, legacy handoffs, unsupported versions, and unavailable receiver capabilities produce precise recoverable limitations. Test that no credentials, global settings, hidden chat state or new dependencies are required.
7. An intentional TDD RED checkpoint resumes its authorized implementation step; an unresolved BLOCK/INFRA_ERROR/OVERFLOW or unexpected failure remains unresolved. An implementation-complete checkpoint resumes the first unfinished review, without skipping the two review roles or independent gate.
8. A consumed escalation receipt stays auditable without replay, and conditional batch authorization never overrides a pending gate or a non-green boundary.

## Alternatives

- One mixed Claude/Codex SKILL.md: fewer entrypoints, but branches throughout already-large instructions and risks changing Claude behavior.
- Full fork of plugin runtime: straightforward initially, but duplicates renderer/reviewer/security fixes and creates drift.
- Proposed adapters plus assembled shared resources: a small packaging step, explicit host boundaries, one runtime source.

## Verification

- Behavioral baseline with the unmodified Claude skill in a Codex scenario; independent forward tests after the port.
- Installer tests in temporary destinations: complete resources, no checkout dependency, no overwrites, no authentication/config writes, useful errors.
- Execute packaged rendering/secret-scan/escalation/dispatch helpers in temporary workspaces and check fail-closed behavior.
- Validate Codex frontmatter and metadata; run existing Foreman/refiner Node suites and the reviewer bash suite.
- Review lifecycle coverage against canonical contract; do not label mocked reviewer tests or agent simulations as a live paid end-to-end review.
- Exercise the shared handoff helper against temporary Git repositories and preserved phase snapshots. Run independent cross-host behavioral scenarios, including both directions and a round trip; distinguish simulated host behavior from actual Claude/Codex execution.

## Implementation boundaries

No new dependencies, MCP server, unrelated Claude behavior changes, global installation, credential changes, live external reviewer runs, push, PR, or deployment in this implementation scope. Claude changes are limited to the shared handoff format and interoperable resume behavior described above. Installation or live validation may be requested separately. Changes remain local and reviewable. No claim of ChatGPT web compatibility; the new port targets Codex desktop and CLI, interoperating with the existing Claude Code plugin.

## Approval

Angel: "I approve the updated design. Go ahead and implement it in the repo, including seamless Claude↔Codex handoffs, subagent delegation, and cross-session orchestration."

This authorizes the described local implementation and verification. No global installation, external paid reviewer runs, commits, pushes or PRs are included in this execution scope. The working clone has moved to `/Users/angel/personal/the-foreman-codex-port` so the result is durable; branch remains `codex/foreman-port`.

### Publication follow-up

After implementation and validation, the user explicitly requested updating the local repository and creating a remote pull request. That later instruction authorizes committing and pushing `codex/foreman-port` and opening a PR against `main`. It supersedes the original local-only publication boundary; it does not authorize merging, global installation or live paid validation. Local session notes remain outside the published change.

## Official format reference

Codex skill layout, discovery, symlink support, and optional UI metadata were verified against https://learn.chatgpt.com/docs/build-skills on 2026-10-28. Install default is `~/.agents/skills`; an explicit destination can select an existing user installation convention. The installer does not require a dependency installation or an OpenAI API key.

Subagent and effort capabilities: https://learn.chatgpt.com/docs/agent-configuration/subagents and https://learn.chatgpt.com/docs/models?surface=app. CLI session coordination: https://learn.chatgpt.com/docs/developer-commands. Checked on 2026-10-28 alongside this session's live collaboration/app-tool schemas and installed CLI help. These checks do not constitute an end-to-end message-delivery test between independent chats.
