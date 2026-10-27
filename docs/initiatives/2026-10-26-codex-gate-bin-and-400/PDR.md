# PDR: codex-gate finds Codex again, and reports API failures as what they are

Status: DRAFT for the plan-approval gate. Branch `fix/codex-gate-bin-and-400` in `~/personal/the-foreman-gate-fix`, based on
`origin/main` 78f2f9b plus prerequisite commit `392e889` (the gpt-6-astra default, byte-identical to the installed gate).
All line numbers are for `plugin/skills/codex-gate/` at `392e889`.

## Problem

Two defects in the codex-gate wrapper surfaced on 2026-10-22 while another initiative used the gate:

1. **Stale binary path.** `codex-gate.sh:71` defaults `CODEX_BIN` to `/Applications/ChatGPT.app/Contents/Resources/codex`.
   ChatGPT.app 26.1016.62342 (2026-10-22) moved the Codex CLI to `…/Resources/codex-cli/bin/codex`. Every gate call
   now needs `CODEX_BIN` passed by hand; without it the shell returns 127 and the gate reports a generic
   `INFRA_ERROR "codex exited nonzero (127)"`.
2. **Every failed turn reads as a context overflow.** `classify_nonzero_exit` (`:674-679`) and `classify_verdict_file`
   (`:1683-1700`) grep the whole round JSONL for `ran out of room|context window|"turn\.failed"`. The bare
   `"turn\.failed"` alternative makes any failed turn `OVERFLOW` ("diff too large — use delta/shard"). An HTTP 400
   `invalid_request_error` ("model not supported with a ChatGPT account") was reported that way, which sent the
   operator after diff size instead of the real cause.

## Evidence base (verified 2026-10-26)

- `ls /Applications/ChatGPT.app/Contents/Resources/codex` → no such file. `…/codex-cli/bin/codex` → a 328-byte
  `#!/bin/sh` launcher that execs `../CodexCLI.app/Contents/MacOS/codex`; `--version` → `codex-cli 0.163.0-alpha.11.2`.
- `CODEX_BIN` is defined only at `:71` and used only at `:647`, inside `run_codex` (`:580-654`). Every `run_codex`
  call (`:1092, :1142, :1144, :1201, :1203, :1260, :1262, :1333, :1335, :1657, :1790`) and every caller of the fan-out
  (`:1628, :1648`) runs in the main shell. `config`, `phase-start`, an empty `prepr-delta` (`:1608-1615`), every packet-
  budget OVERFLOW and every early `die_infra` never reach `run_codex`.
- The incident run: `~/.claude/codex-gate/runs/scratchpad-64a781c3677b/norepo/s-7164f013f9f5/question-decision-icons.md/round-1.jsonl`
  (stderr: 0 bytes). Its lines, in order: `thread.started`; an `item.completed` whose `item.type` is `"error"`
  ("Model metadata for `gpt-6-astra` not found…", a warning); `turn.started`; a top-level
  `{"type":"error","message":"<JSON string: status 400, invalid_request_error, message>"}`; and
  `{"type":"turn.failed","error":{"message":"<the same JSON string>"}}`. The wrapper reported OVERFLOW.
- The classifiers' grep also scans `agent_message` and `command_execution` output. Local run logs contain many rounds
  whose text says "context window" with no failed turn; any of them that exited nonzero would read as OVERFLOW.
- Real `turn.failed` messages in local logs: usage limit (11), "Codex ran out of room in the model's context window…"
  (5), model at capacity (2), stream disconnected (1), the 400 above (1). No local `context_length_exceeded` sample
  exists; OpenAI documents it as `error.code` on an `invalid_request_error`, so a context overflow can arrive as a 400.
- The sharded and multi-lens paths classify each job with `classify_verdict_file` (`:1791`), then
  `fan_out_and_aggregate` folds every per-job `INFRA_ERROR` into aggregate `OVERFLOW` (`:1807-1810, :1839-1845`) with
  the fixed summary "`<shard|lens> X inconclusive`". Fixing the classifier alone would leave a sharded 400 reported as
  OVERFLOW.
- No helper caps or one-lines a summary today; `die_infra` (`:178-190`) and `emit_overflow` (`:192-223`) JSON-escape it
  through `jq --arg`.
- Baseline: `bash plugin/skills/codex-gate/codex-gate.test.sh` → `PASS=441 FAIL=0` (67 s) in this checkout at `392e889`;
  `git status --ignored` identical before and after. `config` with `CODEX_GATE_SOURCE` pointed here → `parity: MATCH`
  against the installed gate, effective `gpt-6-astra` / `xhigh` / fast off.

## Goal

The gate finds the Codex CLI wherever current or previous ChatGPT.app layouts put it, says plainly when it cannot,
and labels a failed Codex turn by its real cause: `OVERFLOW` only for a context-window failure, `INFRA_ERROR` with
the API's own message for everything else — the same in single-thread, sharded and multi-lens runs.

## Scope

In:
- `CODEX_BIN` resolution: explicit value wins; otherwise the first executable of the new path, then the old path;
  neither → `INFRA_ERROR` naming both, zero Codex calls. An explicit value that is not executable → `INFRA_ERROR`
  naming it.
- Failure classification from structured failure events only, shared by both classifiers; the API message, unwrapped
  and sanitized, in the `INFRA_ERROR` summary.
- The fan-out aggregate gains `INFRA_ERROR` (ADR-006), so sharded and multi-lens runs agree with single-thread runs.
- Tests in `codex-gate.test.sh` (red first), the matching contract text in `README.md`/`SKILL.md`, the wrapper's own
  comments, and the one stale sentence about `CODEX_BIN` in the repo `README.md`.

Out (ADR-007): `config` reporting the resolved binary; a `PATH` lookup fallback; reading `round-N.stderr`; a Codex
exit 0 that still logs `turn.failed` (already `INFRA_ERROR` "verdict file missing or empty"); changing any dial or
default (`gpt-6-astra`, `xhigh`, fast off stay); a plugin version bump; how the gpt-6-astra initiative itself ships.

## Acceptance criteria

1. With `CODEX_BIN` unset or empty, the wrapper runs the first executable regular file among
   `/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex` and `/Applications/ChatGPT.app/Contents/Resources/codex`.
2. With neither present, every mode that would call Codex emits `INFRA_ERROR` whose summary names both paths, and the
   stub records zero invocations. `config`, `phase-start` and an empty `prepr-delta` still succeed.
3. An explicit `CODEX_BIN` is used even when a candidate exists. If it is not runnable (missing, not executable, a
   directory, an unknown command name), the result is `INFRA_ERROR` naming it, with zero invocations.
4. A nonzero exit whose failure events carry `ran out of room`, `context window` or `context_length_exceeded` →
   `OVERFLOW` (unchanged summary). Any other failure event → `INFRA_ERROR` whose summary contains the API status, error
   type, code (if any) and message, on one line, at most 300 message characters, valid JSON. A nonzero exit with no
   failure event → the existing generic `INFRA_ERROR`.
5. The rule holds in `plan`, `bundle`, `phase-review`, `question`, `investigate`, unsharded `prepr`, sharded `prepr`
   and `prepr --multi`. In the fan-out paths the aggregate is `BLOCK` > `INFRA_ERROR` > `OVERFLOW` > `APPROVE`, and an
   aggregate `INFRA_ERROR` names the failing shard or lens and its reason.
6. The `item.completed` warning (`item.type == "error"`) never counts as a failure, and text in agent messages or
   command output never makes a run `OVERFLOW`.
7. All 441 existing checks still pass; the full suite ends `FAIL=0`; the suite still writes nothing in the repo.
8. `config` against the installed gate still reports effective `gpt-6-astra` / `xhigh` / fast off.
