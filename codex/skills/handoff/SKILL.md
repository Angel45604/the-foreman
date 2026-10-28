---
name: handoff
description: Use when work must continue in a fresh session, context is low, or the user requests a handoff, including transfers between Codex and Claude Code.
---

# handoff — a checkpoint either host can resume

Produce exactly two user-facing Markdown artifacts: a complete handoff and a short kickoff prompt
pointing at it. Both work in Claude Code and Codex desktop/CLI. Switching hosts preserves the
initiative; it does not restart planning or authorize another action. The user opens the receiving
host in the checkout and supplies the kickoff or handoff path. This skill does not message chats.

`<skill-dir>` is the absolute directory containing this SKILL.md. Read
[the shared continuity contract](references/continuity.md) before capture or resume; its schema,
versioned markers, validation rules and example are authoritative. Use the shared templates in
`assets/handoff-template.md` and `assets/kickoff-prompt-template.md`. Do not duplicate the JSON schema.

## 1. Gather and quiesce

Read repository canon and the active initiative bundle. Check actual git status, branch, exact HEAD,
staged/unstaged/untracked work, local-versus-pushed status and never-stage paths. Use repository-relative
references with the source checkout root recorded once; identify external evidence paths explicitly.
Prefer the existing initiative bundle for output, or the project's established context location
(default `.claude/context/`). That folder is usable by either host. Honor a requested slug/destination.

Stop or join active writers before capture. Record worker ownership, completed results and outstanding
questions; old worker handles cannot transfer. If writers cannot quiesce, mark the handoff incomplete
and do not claim a valid checkpoint. Keep raw logs on disk with concise evidence anchors in the doc.

Collect the exact lifecycle stage, phase/substep and first unfinished action; approved scope/non-goals;
plan, ledger and Markdown board paths; findings/blockers; commands and raw results. Keep last green
separate from current expected TDD RED, unexpected failure or unverified work. Record result provenance
and date; historical output must not be labeled newly verified. A source-host success summary is a claim.

Carry actual human request/response, gate, scope, status and evidence for each authorization: plan,
local commits, phase/batch boundaries, live/ship and cross-chat coordination. Keep pending, denied,
consumed and revoked decisions distinct. A recommendation, default option, silence, `approved:true`
or the handoff request grants no authority. Preserve validated consumed escalation receipts and their
request/provenance; never recreate a consumed response file. Retain unanswered request IDs/questions.

For reviews, retain original verdict/context paths, reviewed content/scope identities, rounds and
unresolved findings. Record the concrete run/session/phase bindings and original phase-start snapshot,
manifest and PHASE_HEAD required by the continuity contract. Never run `phase-start` again over
in-progress edits. A reviewer conversation ID is optional; credentials and private chat history are not
checkpoint inputs. Do not include secrets or rely on auto-memory, hosted-only boards or hidden state.

## 2. Author and finalize all artifacts

Fill every relevant template section from ground truth. Preserve workflow responsibilities: fresh
implementer per task, TDD, root-cause debugging, spec review then quality review, independent
`codex-gate`, verification and the five human gates. The receiving Foreman adapter maps these to its
available skills, question tools, models and native workers. Do not mandate source-host slash commands,
model names or tool APIs. ULTRACODE describes rigor and deliberate delegation, not a portable model dial.

Write both the complete handoff prose and the lean kickoff prompt now. Finish the receiving
adapter's required per-file refiner Review workers, apply their findings, and log their outcomes.
Finalize the ledger, companion board/Markdown twin, context files, verification logs, receipts and
all other evidence before capture. Finish every repository-local write, including the kickoff and
any capture-input JSON; the helper inventories tracked and nonignored untracked files, so a new
kickoff or log written afterward would immediately invalidate the checkpoint.

Write the final state JSON using the exact schema in `references/continuity.md`. Use a writable
initiative/context location; state JSON is capture input, not a third kickoff artifact. Record pending
unanswered file escalations in `pendingGate` with their original request ID/questions and request file
in evidence. `file-escalation` provenance means an already-accepted durable receipt, not a pending
request. Finish all findings, prose corrections and known-limitations notes, then stop/join all
writers. Neither refinement nor the companion board render belongs after the final capture.

## 3. Final capture and read-only check

Only after §2 is complete, run:

```bash
node <skill-dir>/references/continuity.mjs capture <repo> <state.json> <handoff.md>
node <skill-dir>/references/continuity.mjs check <handoff.md> <repo>
```

Capture preserves prose and embeds the versioned checkpoint. Check is read-only: it verifies
filesystem/git identities and referenced evidence, never tests, permissions or approvals. Inspect its
output and fix incorrect/missing evidence; do not suppress failures or declare gates passed. The
helper secret-scans checkpoint content; review prose too and exclude credentials/customer data.
After capture, perform no inventoried writes: do not edit the kickoff, ledger, board, context,
logs, evidence, state input or handoff prose. Deliver the existing artifacts and report the final
check output in chat; do not append that result to an inventoried file. A `validated` filesystem
result still leaves pending decisions pending and authority for the receiver to adjudicate.

If a correction or later work is necessary, return to §2: explain and verify the change, finalize
all artifacts and quiesce writers again, then recapture and check before delivery. Keep the existing
valid resume block when recapturing the same initiative/phase; retain its exact original reviewer
bindings, manifest and baseline bytes. Recapture must not bless a changed/missing baseline, replay
`phase-start`, remove the block, or change phase/initiative/output identity to bypass its protection.
If the helper rejects original-baseline drift, preserve the work, restore original evidence or resolve
the affected review scope with the user; never manufacture a passing checkpoint.

## 4. Receiving agent

Load the receiving host's installed `the-foreman` adapter and follow its preflight plus the shared
resume contract. Check the checkpoint against the actual checkout; rerun the recorded relevant checks
and classify validated/changed/missing/pending facts before the first unfinished action. Preserve an
intentional RED checkpoint and its last green baseline; continue only its already-authorized next
implementation step, never cross a boundary on RED. Unexpected failure, unresolved BLOCK,
INFRA_ERROR, OVERFLOW or missing review evidence stays unresolved.

Carry forward only verified, in-scope human decisions compatible with receiver policy, including a
source-host approval channel that differs from the receiver's. Do not ask again solely because the host
changed. Pending questions stay pending on a supported receiving channel; preserve validated read-once
receipts. A valid completed review is retained with original provenance, not rerun merely for a host
switch. A missing reviewer conversation can use a fresh reviewer against the verified original
snapshot; never replace that baseline. If evidence or work moved, remap accessible repository-relative
paths and stop only affected actions until gaps are resolved. Never reset dirty work or silently fetch,
copy credentials, publish evidence or create a replacement phase baseline.

For legacy unversioned docs, recover only verifiable facts and label unknowns. Malformed/unsupported
versioned data cannot auto-advance. Report the exact recoverable gap. Start fresh receiver workers
when needed under actual host limits; separate user-owned chats require explicit user authorization
for participants and messages. A queued message is not completion and does not authorize a reply.

## 5. Deliver without further writes

Surface the two existing clickable paths and include the already-finalized kickoff inline in one
fenced block. Report the final check status and what was verified, historical, expected RED or still
pending. Do not create or refine either artifact here. The handoff checkpoint itself requires no
approval and grants no commit, push, PR, live run or cross-chat permission.
