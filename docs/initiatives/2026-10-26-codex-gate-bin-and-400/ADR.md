# ADR: codex-gate binary resolution and failure classification

Line numbers are for `plugin/skills/codex-gate/` at `392e889`.

## ADR-001 Base: a new worktree off `origin/main`, the gpt-6-astra change as a prerequisite commit

Decided by the owner on 2026-10-26 (AskUserQuestion, option D, grounded by `codex-gate question`). Worktree
`~/personal/the-foreman-gate-fix`, branch `fix/codex-gate-bin-and-400`, no upstream, from `origin/main` 78f2f9b.
The owner authorized one local commit of the gpt-6-astra three-file patch: `392e889`. It is byte-identical to the
installed gate and the astra worktree's working copy, and the suite passes 441/0 on it. `prepr` runs against
`392e889`, so the reviewer sees only this fix, and a later sync from this branch keeps `gpt-6-astra` / `xhigh`. The
astra checkout and its bundle are untouched; this commit does not decide how that initiative ships.

## ADR-002 Resolve the binary inside `run_codex`, in the main shell, on every call

`run_codex` is the only place Codex is invoked, and every mode that never calls Codex skips it: `config`,
`phase-start`, an empty `prepr-delta`, budget OVERFLOWs, early refusals. So `run_codex` resolves the binary first,
before `mkdir`/`rm`/the subshell, and calls `die_infra` there on failure. That ordering keeps three properties:
- **Zero calls.** The check runs before the subshell that execs Codex.
- **Fail closed.** `die_infra` exits the script. Inside the subshell or a `$(…)` it would only leave that subshell and
  fall through to a normal outcome. All 11 `run_codex` call sites and both fan-out callers are plain main-shell
  statements (PDR evidence), so `die_infra` in `run_codex` ends the run.
- **Sourceable.** Six tests `source` the wrapper; nothing new runs at load time.

The resolver is a function that prints the path or returns 1, called as `exe="$(resolve_codex_bin)" || die_infra …`
(the existing `helper || die_infra` idiom, `:2532-2534`). Re-resolving per call costs two `stat`s.

In the fan-out paths a missing binary fails at the first job, in the base status shape (no `shards[]`/`lenses[]`).
SKILL.md documents that shape for early fail-closed `INFRA_ERROR`s (`SKILL.md:417-419`), and P1 adds "binary not
found" to that list and to the sharded Status text (P1 quality review). In that status `verdictPath` names the first
job's per-job verdict path, which may hold a file from an earlier run; no verdict was produced, so the field carries no
meaning there (P1 quality review, recorded rather than changed: the outcome and summary are correct).

Rejected: resolving at load time or in `main`. It would break `config` and `phase-start` on machines without the app,
and the sourced tests.

## ADR-003 The candidate list is a constant, not a knob; `CODEX_BIN` stays the only override

```bash
CODEX_BIN="${CODEX_BIN:-}"
CODEX_BIN_CANDIDATES="/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex:/Applications/ChatGPT.app/Contents/Resources/codex"
```

- `CODEX_BIN_CANDIDATES` is a plain assignment, so an exported value cannot change it. Tests reach it by rewriting
  that one line in a runnable copy made by the suite's existing `copy_real_skill` (`codex-gate.test.sh:337`). That
  copy-and-rewrite seam is already how the suite retunes dials (`retune_gate_dials`, `:381`). Production gains no
  test-only knob.
- An explicit `CODEX_BIN` is resolved with `command -v -- "$CODEX_BIN"`, and the **resolved path** must then be a
  regular executable file (`[ -f ] && [ -x ]`). The resolver returns that resolved path.
  - `command -v` alone is not enough on bash 3.2. It resolves a non-executable file found on `PATH`, and it returns
    a builtin's bare name (e.g. `echo`). Both were reproduced on 2026-10-26 (the bundle gate's round-1 finding).
  - The extra check rejects those, along with a missing path, a non-executable file and a directory.
  - A relative result (`./codex`, `tools/codex`, or a name found through a relative `PATH` entry) is made absolute
    against the invoking directory before the check. `run_codex` later `cd`s to the repo root or the run directory,
    so the path that was checked must be the path that runs. The P1.2 spec review found this; it was reproduced on
    2026-10-26.
  - `CODEX_BIN=codex` still works when an executable `codex` is on `PATH`.
- A candidate must be a regular file with the executable bit (`[ -f ] && [ -x ]`), tried in order.
- The INFRA_ERROR summaries:
  - explicit: `CODEX_BIN is set to '<value>' but is not an executable file or command — fix or unset it (no codex invoked)`
  - none found: `Codex CLI not found: none of <path1>, <path2> is an executable file — install or update the ChatGPT app, or set CODEX_BIN (no codex invoked)`

Rejected:
- A `PATH` fallback (`command -v codex`) when both candidates are missing. It could silently pick an unrelated
  `codex` build, and the gate's auth home and flags were verified against the app's CLI.
- An env-overridable candidate list. It is a second override knob that only tests need.

## ADR-004 Classify from structured failure events only; check for a context failure first

New helpers, shared by both classifiers:

- `codex_failure_messages <jsonl> [cap]` prints one one-lined line for each structured failure event (ADR-005), cut
  to `cap` characters only when a cap is given:
  - the `.error.message` of every `{"type":"turn.failed"}` line;
  - the `.message` of every top-level `{"type":"error"}` line.

  It ignores everything else, including `item.completed` items whose `item.type` is `"error"` (warnings such as
  "Model metadata … not found") and all agent and command text.
- `codex_context_overflow <jsonl>` succeeds when any of those lines matches, case-insensitively,
  `CODEX_CONTEXT_OVERFLOW_RE='ran out of room|context window|context_length_exceeded'`.
  It reads the **uncapped** lines, so a long message whose context signature sits past character 300 still counts
  (the bundle gate's round-1 finding). Only the summary is capped.

Rule on a nonzero exit:
- context signature → `OVERFLOW`, with the summary unchanged;
- else any failure message → `INFRA_ERROR` (ADR-005);
- else the existing generic `INFRA_ERROR` `codex exited nonzero (N); see <stderr>`.

`classify_verdict_file` applies the same rule. It keeps its three-argument, one-token contract, which test
`:2472` relies on.

Why context first: OpenAI reports a context overflow as an `invalid_request_error` with code
`context_length_exceeded`. Mapping every `invalid_request_error` to `INFRA_ERROR` would mislabel real overflows. The
code survives into the formatted line (ADR-005), so the same regex catches it.

Why not grep the whole file: agent messages and command output routinely contain "context window" (including any
review of this very change). Scanning them turns an unrelated nonzero exit into a false `OVERFLOW`.

## ADR-005 The summary carries the API's own message, unwrapped, one line, capped

For each failure message, `codex_failure_messages`:
1. tries to parse it as JSON. If it is an object whose `.error` is an object, it formats
   `HTTP <status> <error.type> <error.code>: <error.message>` and omits absent parts;
2. otherwise uses the raw text;
3. replaces every run of control characters with one space, collapses spaces and trims;
4. when called with a cap (the summary path passes 300), cuts the line to that many characters plus `…`.

Steps 3 and 4 run in `jq`, so the cap counts codepoints. Classification (ADR-004) never passes a cap. `die_infra`
already JSON-escapes the summary via `jq --arg`. The summary uses the last such line, capped (the `turn.failed`
repeats the `error` event before it):

`codex turn failed (exit <N>): <message> — see <jsonl path>`

On the incident run this yields `… HTTP 400 invalid_request_error: The 'gpt-6-astra' model is not supported when using
Codex with a ChatGPT account. …` (prototyped against the real file 2026-10-26).

## ADR-006 The fan-out aggregate gains `INFRA_ERROR`: BLOCK > INFRA_ERROR > OVERFLOW > APPROVE

Today any per-job `INFRA_ERROR` becomes aggregate `OVERFLOW` "`<noun> <label> inconclusive`" (`:1807-1810, :1839-1845`).
A sharded or multi-lens run that hits the 400 would still tell the operator to shrink the diff. New rule in
`fan_out_and_aggregate`:
- any `BLOCK` → `BLOCK` (unchanged: blockers are actionable; a re-run re-surfaces the failure);
- else any `INFRA_ERROR` → `INFRA_ERROR`. The first such job's label goes to `FAN_FIRST_INFRA` and its one-line reason
  to `FAN_INFRA_REASON`; the reason comes from the same helper wording as ADR-005, or for an exit-0 job,
  `no usable verdict (<job verdict path>)`;
- else any `OVERFLOW` → `OVERFLOW` (unchanged, including the summary text that test `:2649-2675` pins);
- else `APPROVE`.

`FAN_FIRST_INCONCLUSIVE` keeps its meaning (the first `OVERFLOW` or `INFRA_ERROR` job), so existing unit tests hold.
The aggregate verdict file for `INFRA_ERROR` is written with `jq --arg` (API text never enters the raw `printf` JSON
at `:1841`).

Both callers add an `INFRA_ERROR` branch before their `OVERFLOW` branch, in the same status shape as their `OVERFLOW`
emitter (with `coverage` and `shards`/`lenses`). Summaries:
- shards: `shard <g> failed: <reason> (over-budget diff <N> chars sharded into <k>; fail closed)`
- lenses: `lens <l> failed: <reason> (<k> lenses; fail closed)`

This changes the documented contract. SKILL.md (`:68, :389, :411`) and README.md (`:139, :181`) say an errored shard or
lens is `OVERFLOW`; they will say it is `INFRA_ERROR`.

Rejected:
- (ii) Promote only per-job failures that carry an API message, and leave other per-job errors as `OVERFLOW`. It
  needs a second classification channel, and an invalid shard verdict would still be called "diff too large".
- (iii) Keep the aggregate as `OVERFLOW` and only append the reason to the summary. The top-level outcome, which is
  what drivers branch on, would still be wrong.

## ADR-007 Out of scope

- `config` reporting the resolved binary. That is useful diagnostics but a new report field; a follow-up if wanted.
- Reading `round-N.stderr`: it was empty in the incident.
- Codex exiting 0 while logging `turn.failed`. It is already `INFRA_ERROR` ("verdict file missing or empty").
- Any dial or default (`gpt-6-astra`, `xhigh`, fast off), the plugin version, and the gpt-6-astra initiative's ship
  decision.
- An automated security review of `392e889` noted that the `--multi` + `ultra` refusal (`:1496-1511`) rests on
  "only `ultra` delegates", which the astra initiative took from the model catalog rather than from a measured spawn
  sweep at gpt-6-astra/`xhigh`. That belongs to the astra initiative and is recorded as its follow-up.

## ADR-008 Two phases, a live-run gate before any sync, one real call as the live proof

- P1: binary resolution. P2: failure classification. They touch disjoint functions; P1 lands first because it is
  smaller and makes later live work possible without the `CODEX_BIN` prefix.
- Each phase: `phase-start` → red tests (sonnet builder) → Claude spec and quality review of the tests (opus) → green
  plus docs (sonnet builder) → spec and quality review (opus) → `context.md` → `phase-review` → full suite.
- After `prepr` APPROVE, nothing touches `~/.claude/skills/codex-gate/` until the owner answers the `live-run` gate.
  If authorized:
  1. Back up the installed directory.
  2. Run the README "Manual sync" loop verbatim. Copy the test file too, as the astra initiative did.
  3. Check that `config` reports `MATCH`.
  4. Make one real `question` call with `CODEX_BIN` unset. That call is the Defect-1 proof.
- Defect 2 gets no live proof: reproducing a 400 would need a model override, which is off-limits. Its proof is the
  stubbed suite replaying the incident's real lines, plus the helper run read-only against the real incident file.
