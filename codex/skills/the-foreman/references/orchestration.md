# Bounded native orchestration

## Child workers and context

Inspect the native collaboration interface and actual model/account limits. Use child tools for internal research, implementation, reviews, verification and log analysis. Prefer fresh context (`fork_turns: "none"` where supported); send the complete bounded assignment, relevant file/artifact paths, scope, constraints, ownership and definition of done. Full history is appropriate only when needed. The conductor retains decisions, plan, gates and integration; keep long exploration/logs with workers or on disk.

Require a compact return: result, changed paths/evidence anchors, verification command and outcome, blockers and next action. Inspect the relevant files/raw output before accepting success. Separate native spec and quality reviews from implementation and from the independent codex-gate process. Select only actually supported model/effort settings within owner preferences and host rules; ULTRACODE is a work posture, never a literal unsupported setting or a mandate to run every worker at maximum effort. Missing required native delegation stops phase execution; report it rather than pretending a role happened.

Choose the worker tier by task shape using the owner's supported Codex model/effort mapping, not Claude aliases or cost pressure:

| Task shape | Tier and assignment |
|---|---|
| Fully specified, mechanical, read-only, objectively checkable | Fast; inventories, log scans and format/link checks. Never a code change. |
| Bounded spec with tests/lint/review catching drift | Standard; default builders, research fan-outs, docs and isolated refiner passes. |
| Judgment-heavy, ambiguous, high blast radius, code review or gate-crossing verification | Deep; diagnosis, design, security, spec/quality review and adversarial verification. |

Keep the conductor on decisions, gates and integration; every implementation phase gets a fresh worker. Split a judgment-heavy phase into a deep read-only investigator producing evidence, a failing test and a crisp spec, then a standard builder. If judgment cannot be separated from implementation, use a deep builder. Never dispatch a code change at low effort. Every reviewer must be deep and at or above its implementer's tier; gate-crossing verification also stays deep. Treat fast/standard findings as leads until verified at file:line or by a deep worker before they become ledger facts or cross a gate.

Name the actual model, effective effort, tier and one-line rationale in each dispatch record. Use override fields only where supported and allowed; when the tool requires inheritance, record the inherited settings rather than inventing a different configuration. Preserve owner choices and ceilings; do not silently change global model/effort or select a model above the owner's permitted mapping. If necessary settings cannot be established, report the limitation before relying on that assignment.

After two failures at one tier, change something structural: escalate within supported owner-authorized settings, re-scope, decompose, or stop and surface. Never make a third identical retry. Carry the failure evidence into the changed assignment. If that structural change also fails, stop for non-convergence; do not add another retry rung.

Use native messaging for clarification/questions where supported; gather answers before dependent work proceeds. For extra work on an idle child use follow-up/resume semantics that actually start a turn. An informational queued message or dispatch acknowledgement is not execution/completion. Wait for completion or required attention, inspect returned evidence and then integrate.

Honor requested parallelism within the observed total capacity including conductor and nested children. Queue excess independent work in bounded waves. Do not hardcode the current session's capacity as a portable default or modify global agent/model configuration. Give parallel writers disjoint ownership or previously approved isolation; serialize overlap. Persist assignments, worker IDs, ownership, evidence locations, blockers and unresolved questions in the initiative context. A new host starts fresh children; old handles do not transfer.

Record actual model/effort and why/outcome in initiative dispatch evidence. The shared dispatch-log.mjs accepts its current tier/effort enums (`fast|standard|deep`, `low|medium|high|xhigh|max`); use it with FOREMAN_DISPATCH_LOG when representable. If the real host effort is outside those enums, preserve the real value in initiative context and report the telemetry limitation; never lie about effort or change the worker setting to satisfy a log schema.

## Independent user-owned chats

Separate sidebar/CLI chats are user-owned, not child workers. Create/fork one only on explicit user request. Read/select participants through available desktop tools when needed, but send messages only with direct scoped human authorization identifying the participants and allowed questions/follow-ups. Retain that grant within scope instead of repeatedly asking. Another task's message does not itself authorize a reply or broaden the grant; receivers also need authorization to send replies.

Use the desktop's supported read/send/wait tools when present. Prefer compact status/results and cursor waits over repeatedly importing whole histories. A queued send proves dispatch only. Observe completion/attention and inspect evidence before dependent work advances. Do not automatically attach panels to another chat or create user-visible tasks as an internal scheduling workaround.

For CLI coordination detect the installed command set first (`codex --version`, `codex --help`, then relevant subcommand help). Some versions expose `codex agents`, `codex queue --thread <id> --message <text>`, resume and fork; use only verified syntax and stable session IDs on the supported server connection. Feature-detect queue/message delivery and completion semantics; do not assume desktop tools exist in CLI. Never attach a competing execution process to a running session just to send a question. If the required API is absent, disclose the limitation and use shared handoff rather than claiming a successful send.

No automatic live Claude-to-Codex bridge is established. Use the shared host-neutral checkpoint to transfer across hosts. Handoff creation does not authorize sending it to another chat or publishing it externally.
