# Shared Claude / Codex continuity contract (version 1)

Both hosts use the same checkpoint. The receiving host supplies its own tool,
worker, question and permission adapter. A host switch preserves the initiative;
it does not grant permission, complete reviews, or reset the phase baseline.

## Commands and output

Author the complete Markdown handoff first, stop/join all writers, then run:

```sh
node /path/to/skills/handoff/references/continuity.mjs capture /path/to/repo /path/to/state.json /path/to/handoff.md
node /path/to/skills/handoff/references/continuity.mjs check /path/to/handoff.md /path/to/repo
```

Quote paths containing spaces. `capture` requires an existing committed Git
checkout root, existing JSON input and existing authored Markdown. It appends
one block, or replaces exactly the existing valid block, preserving all prose
outside it:

```text
<!-- foreman-resume:start -->
{ "version": 1, "capturedAt": "...", "state": { "...": "..." }, "...": "..." }
<!-- foreman-resume:end -->
```

The actual block is raw JSON, without a Markdown code fence. Missing, duplicate,
reversed, malformed or unsupported versioned markers fail closed. Unversioned
handoffs remain readable; `check` reports `legacy` without rewriting them.

Each CLI call writes one JSON result to stdout. Exit codes:

| Status | Exit | Meaning |
| --- | --- | --- |
| `captured` | 0 | Checkpoint captured; authority remains for the receiver to adjudicate. |
| `validated` | 0 | Recorded filesystem/Git identities match. No command was rerun or permission granted. |
| `changed` | 1 | Checkout location, HEAD, branch, staging, worktree or evidence differs. |
| `missing` | 1 | Repository, required evidence or original baseline is unavailable/incomplete. |
| `legacy` | 1 | No versioned checkpoint; recover only verifiable facts and label gaps. |
| `invalid` | 2 | Invalid schema/receipt, unsupported format, unsafe text, nonquiesced writers, or failed capture. |

`check` also returns `issues`, `pendingGate`, a `pendingAuthorizations` count,
`authority: "not-adjudicated"`, and `verification: "recorded-only"` for a parsed
checkpoint. A pending decision can coexist with `validated`: files match while
the gate remains pending. Invalid takes precedence over missing, then changed.
Errors report controlled descriptions and never raw file contents or secret
values. Capture validation errors leave the existing handoff unchanged.

## Minimal usable state.json

This is a complete minimal input; the agent must replace its text with the actual
initiative. `null` verification is explicitly unknown, not green. Additional
context fields may be included and are preserved. Put plan, ledger, board Markdown
twin, findings and relevant logs in `evidence`; do not depend on hidden chat state.

```json
{
  "initiativeId": "example-initiative",
  "sourceHost": "claude",
  "stage": "execution",
  "phase": "phase-1",
  "nextAction": "Implement the already approved change after expected RED",
  "scope": {
    "approved": ["Implement the approved continuity helper"],
    "nonGoals": ["Commit, push, deploy or run a live reviewer"],
    "neverStage": ["local-only.txt"]
  },
  "verification": { "lastGreen": null, "current": null },
  "authorizations": [],
  "pendingGate": null,
  "workers": [],
  "evidence": []
}
```

Required schema:

- `initiativeId`, `stage`, `phase`, `nextAction`: nonempty strings; `sourceHost`:
  `claude` or `codex`.
- `scope`: `approved` (nonempty string array), `nonGoals` (string array),
  `neverStage` (repository-relative file paths). A scope statement records the
  claimed scope; the receiving agent checks its actual authorization evidence.
- `verification`: both `lastGreen` and `current` must exist. Each is `null` or
  `{ "command": "...", "result": "green|expected-red|failure|unverified",
  "provenance": { "host": "claude|codex", "kind": "artifact",
  "reference": "relative/log.txt" } }`. `lastGreen` accepts only `green` or
  `null`. Keep last green separate from the current expected TDD RED. The helper
  never executes the command or interprets a log as passing.
- `authorizations`: array of claims. Each requires `gate`, `scope`, original
  `request` text, `response` text, `status` and `provenance`. Status is `pending`,
  `granted`, `denied`, `consumed` or `revoked`. Pending requires `response: null`;
  other states require nonempty original response text. Keep plan approval,
  commit permission, boundary/batch authorization and live/ship permission
  separate. Do not replace provenance with `approved: true`.
- `provenance`: `{ "host": "claude|codex", "kind": "native|artifact|file-escalation",
  "reference": "relative/evidence-file" }`; `file-escalation` additionally
  requires `requestId`. Every reference becomes required hashed file evidence,
  even when omitted from `evidence`. Native receipts must preserve the actual
  request/response/channel in an accessible artifact; agent recommendations are
  not human responses. The helper checks shape and file identities, not identity
  of the human, truth of the transcript, semantic scope or authority.
- `pendingGate`: `null` or `{ "gate": "...", "request": "complete question text",
  "scope": "..." }`. Preserve native questions as pending. Extra fields such as
  a file escalation request ID or questions array may accompany it.
- `workers`: array of `{ "id": "...", "status": "completed|stopped|joined" }`.
  Active, unknown or malformed worker states prevent capture. These are records,
  not transferable running handles. Stop/join writers before capture; the helper
  cannot discover running agents in either host.
- `evidence`: existing regular-file paths, repository-relative or explicitly
  absolute for external artifacts. Relative paths cannot traverse `..`. Files
  are hashed; their contents are not embedded. Required missing files abort
  capture. Never reference state.json or the output handoff as evidence.

JSON/text inputs and the generated handoff are bounded to 2 MiB, depth 30 and
100,000 JSON values. Git inventory is bounded to 50,000 tracked/nonignored
untracked files. Submodules/non-file worktree entries fail closed rather than
claiming complete coverage.

## Consumed escalation receipt

When `checkResponse()` first returns a validated answer, persist that returned
result together with its original request before losing the live context. Use
that durable receipt as `provenance.reference`, never recreate a consumed
`.response.json` file. For example:

```json
{
  "requestId": "request-1",
  "acceptedAt": "2026-10-28T12:00:00Z",
  "request": {
    "requestId": "request-1",
    "gateId": "plan",
    "authorizes": "continuity helper",
    "questions": [
      { "id": "approve", "prompt": "Approve continuity helper?", "options": ["yes", "no"], "required": true }
    ]
  },
  "result": { "status": "answered", "answers": { "approve": "yes" } }
}
```

The corresponding claim has `gate: "plan"`, `scope: "continuity helper"`,
the original request/response text, and provenance such as
`{ "host": "claude", "kind": "file-escalation", "reference": "accepted-receipt.json",
"requestId": "request-1" }`. IDs, gate and scope must match; required answers
must be present, allowed and free of unknown question IDs. A selected `no` is a
valid answer shape, never an approval. Receipts are ordinary evidence, not
cryptographic authentication; the receiving agent adjudicates the actual answer
and scope. The helper only reads receipts and never calls `checkResponse()`.

## Original review bindings and baseline

When a phase baseline exists, include this optional `review` object. Omit it only
when no original phase-start snapshot exists; use `verdict: null` when review has
not finished:

```json
{
  "CODEX_GATE_RUNS": "/absolute/original/review-runs",
  "CODEX_GATE_SESSION": "original-session",
  "phaseId": "phase-1",
  "phaseStartSnapshot": "/absolute/original/review-runs/repository/branch/original-session/phase-1/snapshot.json",
  "PHASE_HEAD": "0123456789abcdef0123456789abcdef01234567",
  "verdict": null
}
```

`phaseStartSnapshot` names the **manifest file** `snapshot.json`, not its sibling
`snapshot/` directory. The existing reviewer manifest contains `phaseHead`,
`repoRoot`, and `entries: [{ "path": "relative/file", "baselineKind": "snapshot|deleted" }]`.
The manifest must match the reviewer's exact runtime namespace, not merely live
beneath its run root: `<CODEX_GATE_RUNS>/<sanitized-repo-name>-<root-SHA1-12>/<sanitized-branch-or-detached-worktree>/<sanitized-session>/<sanitized-phase>/snapshot.json`.
The helper mirrors `codex-gate.sh` root hashing and segment sanitization and
checks against the actual Git root/branch plus recorded session/phase. A wrong
session, phase or branch fails even when another snapshot exists there. It never
executes `phase-start` or invokes a reviewer to establish this binding.
`PHASE_HEAD` must resolve to an existing commit. The helper hashes the manifest
plus every listed `snapshot/<path>` file, and
records absence for entries explicitly marked `deleted`. A missing baseline
with kind `snapshot` is never treated as an empty file. Preserve the original
manifest and all baseline bytes. Recapturing the same initiative/phase cannot
change the recorded review bindings or bless changed baseline bytes.

A completed `verdict` requires `{ "mode": "phase-review", "outcome": "APPROVE|BLOCK|INFRA_ERROR|OVERFLOW|PENDING",
"round": 1, "scope": "actual reviewed scope/content identities", "evidence": ["verdict.json"],
"provenance": { "host": "codex", "kind": "artifact", "reference": "review.log" } }`.
All evidence must exist and is hashed. Outcome strings are recorded claims;
`APPROVE` text alone never passes a gate. Keep content identities/coverage in
the scope and referenced verdict artifacts for receiving-agent verification.

The helper inventories all tracked file bytes, executable bits, symlink targets,
index entries (including conflict stages), nonignored untracked paths, branch,
HEAD and the canonical checkout/Git directory. It excludes only the exact input
state and output handoff files, records those exclusions, and checks again before
writing. It does not read remote credentials or global configuration. Ignored
files matter only when explicitly requested as evidence. Keep the broader
human-readable handoff complete, including local/pushed status and blockers.

## Receiving-host duties

Read project canon and the full handoff, run `check`, inspect the actual evidence,
reestablish host safeguards, then rerun relevant verification as appropriate.
Historical logs stay historical. A reproducible expected RED resumes its already
authorized implementation step; it does not pass a phase boundary. Unresolved
BLOCK/INFRA_ERROR/OVERFLOW or unexpected failures remain unresolved. Carry forward
only explicit in-scope still-valid decisions; pending, revoked or conflicting
decisions remain blocked. Conditional batch permission cannot override pending
gates or non-green boundaries.

Explicitly adopt the original reviewer run/session/phase bindings. Do not rerun
`phase-start` over in-flight edits. If the old reviewer conversation is unavailable,
use a fresh reviewer against the original preserved baseline and context; record
it as fresh. A valid completed review does not need repetition solely because
the conductor host changed. Missing or changed review evidence leaves review
unverified.

The same checkout/machine is the seamless baseline. An explicit alternate repo
argument remaps repository-relative evidence and detects relocation; external
paths remain explicit. Relocation reports changed and requires reconciling the
original review namespace/baseline. The helper never copies credentials, resets
work, restores files, fetches evidence, runs tests/review, consumes decisions or
changes snapshots. Restore original missing evidence, or resolve the affected
review scope with the user; never silently create a new phase baseline.
