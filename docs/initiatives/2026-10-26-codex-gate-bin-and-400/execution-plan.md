# codex-gate binary path + failure classification: execution plan

> **For Claude:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development, driven by the the-foreman conductor
> (per-phase codex-gate calls, deep reviews, hard gates).

**Goal:** the gate finds the Codex CLI at the current or previous ChatGPT.app path, and labels a failed Codex turn
`OVERFLOW` only for a context-window failure, otherwise `INFRA_ERROR` with the API's message, in every mode.

**Architecture:** one resolver called at the top of `run_codex` (ADR-002/003). Three small shared helpers replace the
two classifiers' whole-file grep (ADR-004/005). The fan-out aggregate learns `INFRA_ERROR` (ADR-006). Tests drive a
stub `codex`; candidate paths are rewritten in a copy made by `copy_real_skill`.

**Tech stack:** bash 3.2 (`/bin/bash` on macOS: no `mapfile`, no `local -n`, no empty-array expansion under `set -u`),
jq 1.7.1, the repo's own `codex-gate.test.sh`.

Paths are relative to `~/personal/the-foreman-gate-fix`. `W=plugin/skills/codex-gate/codex-gate.sh`,
`T=plugin/skills/codex-gate/codex-gate.test.sh`. Line numbers are at `392e889` and shift as edits land; locate by the
quoted text.

---

## Process (mandated)

- **Gate with the INSTALLED runtime, from the checkout root, with the binary prefix** (the installed default path is
  broken until a sync):
  `cd ~/personal/the-foreman-gate-fix && CODEX_BIN=/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex bash ~/.claude/skills/codex-gate/codex-gate.sh <mode> …`
  No `CODEX_GATE_*` variable is set in this environment (checked 2026-10-26); never pass model or effort overrides.
- **The installed classifier still has Defect 2 during this work.** This diff is full of "context window" text, so
  any nonzero Codex exit during a review may read as a false `OVERFLOW`. On any non-APPROVE outcome, read
  `<runDir>/round-<N>.jsonl` and `.stderr` before acting.
- **Builders:** a fresh `sonnet` subagent per task (standard tier: a crisp spec, and the suite catches drift). It gets
  the full task text, the ADR, and `~/.claude/the-foreman/codex-gate-fix/findings.md`.
- **Reviews:** `opus` (deep tier). For each task, spec compliance first, then code quality. Findings are fixed by a
  fresh builder and re-reviewed until both pass. The conductor re-runs the suite and reads the diff itself; a
  subagent's report is a claim, not evidence.
- **Suite:** one run at a time, in the foreground; about 70 s. Command:
  `bash plugin/skills/codex-gate/codex-gate.test.sh > /tmp/…/suite.log 2>&1; tail -1 …`. Before every run, take
  `git status --porcelain=v1 -uall --ignored` and compare it after: the suite must write nothing in the repo. Kill a
  leftover process only by pid.
- **Commits:** only if the plan-approval gate authorizes scoped per-phase LOCAL commits. Explicit paths, never
  `git add -A`, and only after `phase-review` APPROVE and a green suite. No push, PR, or PublishPlugin.
- Do not edit the astra checkout, the main checkout, or `~/.claude/skills/codex-gate/` outside the live-run gate.

---

## Phase P1: resolve the Codex binary

`phase-start` (conductor, before any P1 edit):
`RUNDIR_P1=$(… codex-gate.sh phase-start P1 | sed -n 's/^RUNDIR=//p')`; record `RUNDIR` and `PHASE_HEAD` in the ledger.

### Task P1.1 (builder): RED tests for binary resolution

**Files:** modify `T` only.

1. Add a helper beside `copy_real_skill` (`T:337`):
   `bin_fixture <dir> <candidates>` runs `copy_real_skill "$dir"`, then replaces the line matching
   `^CODEX_BIN_CANDIDATES=` in `$dir/codex-gate.sh` with `CODEX_BIN_CANDIDATES="<candidates>"`. It **fails the
   calling test loudly** when no such line exists (a silent no-op would make every resolution test pass vacuously).
   Also add `mk_marker_stub <path> <tag>`: a `#!/bin/sh` script that appends `<tag>` to `$SANDBOX/pick.log`, then
   `exec "$STUB_DIR/codex" "$@"`. Make it `chmod +x`.
2. Add tests (new `run_test_64`… appended to the runner list at `T:4836-4900`). Each runs the fixture's wrapper with
   `env -u CODEX_BIN` unless the case sets `CODEX_BIN`. Truncate `pick.log` and `reset_argv_log` first. Count calls
   with `grep -c -- '---END-ARGV---' "$STUB_ARGV_LOG"` plus the `|| ncalls=0` fallback.

   | Case | Setup | Expect |
   |---|---|---|
   | new first | candidates `NEW:OLD`, both marker stubs | `prepr` APPROVE; `pick.log` is exactly `NEW` |
   | old fallback | `NEW` absent, `OLD` stub | APPROVE; `pick.log` = `OLD` |
   | skip non-executable | `NEW` a file without `+x`, `OLD` stub | APPROVE; `OLD` |
   | skip directory | `NEW` a directory, `OLD` stub | APPROVE; `OLD` |
   | empty means unset | `CODEX_BIN=""`, both stubs | APPROVE; `NEW` |
   | explicit wins | `CODEX_BIN=<EXPL stub>`, both candidates present | APPROVE; `pick.log` = `EXPL` only |
   | explicit command name | marker stub `cg-marker` in a dir prepended to `PATH`, `CODEX_BIN=cg-marker` | APPROVE; marker ran |
   | explicit missing | `CODEX_BIN=$SANDBOX/nope`, both candidates present | `INFRA_ERROR`; summary contains `CODEX_BIN` and the path; 0 calls; `pick.log` empty |
   | explicit not executable / directory / unknown name | as above, with a non-`+x` file, a dir, `no-such-cmd-cg` | same as explicit missing |
   | explicit name, non-executable on PATH | a non-`+x` file `cg-noexec` in a dir prepended to `PATH`, `CODEX_BIN=cg-noexec` | same as explicit missing (bash 3.2 `command -v` resolves it; the resolver must still refuse) |
   | explicit builtin name | `CODEX_BIN=echo` | same as explicit missing |
   | explicit relative (added after the P1.2 spec review) | `tools/cg-rel` at doc tier; `./cg-rel2` from a repo subdirectory; a name found through a relative `PATH` entry. The second and third each have a decoy at the repo root | the checked file runs (its marker only), in a directory other than the invoking one |
   | none found | candidates `NEW:OLD`, both absent | `INFRA_ERROR`; summary contains both paths; 0 calls. Run this for every Codex mode: `plan`, `bundle`, `question`, `investigate`, `phase-review` (after a `phase-start` that must itself succeed), unsharded `prepr`, sharded `prepr` (TEST 31's 3-file repo with `CODEX_GATE_PACKET_BUDGET=9000`), `prepr --multi` |
   | no-Codex modes unaffected | both absent | `config` (with `CODEX_GATE_RUNTIME`/`CODEX_GATE_SOURCE` = the fixture) exits 0 with a `parity` field; `phase-start` prints `RUNDIR=`; an empty `prepr-delta` (seed the ledger with a stub-backed `prepr`, then remove the candidates) APPROVEs with 0 new calls |
   | shipped constants | the real `W` | exactly one line `CODEX_BIN="${CODEX_BIN:-}"`; exactly one line equal to `CODEX_BIN_CANDIDATES="/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex:/Applications/ChatGPT.app/Contents/Resources/codex"`; no other occurrence of `Resources/codex"` as a default |

3. Run the suite. **Expected RED:** each test that uses `bin_fixture` stops at one loud FAIL (the
   `CODEX_BIN_CANDIDATES` seam line is missing), and the three static checks fail, giving 5 + 3 FAIL lines. The 441
   existing checks still pass. Report the exact `PASS=… FAIL=…` and the failing test names. Candidate fixture paths
   are named against alphabetical order (`z-new`, `a-old`), so a resolver that sorted the list would fail (P1.1
   spec review).

**Review gate:** opus spec review (do the tests encode PDR criteria 1-3 and ADR-002/003, including zero calls and the
loud-fixture rule?) then opus quality review (idiom match with the suite, hermeticity, no test writes outside
`$SANDBOX`). The conductor confirms RED itself.

### Task P1.2 (builder): GREEN — resolver, call site, docs

**Files:** modify `W` (`:71`, a new helper, `run_codex` `:580-654`); `plugin/skills/codex-gate/README.md`; `plugin/skills/codex-gate/SKILL.md`; `README.md` (repo root).

1. Replace `W:71` with:

```bash
# The Codex CLI. An explicit CODEX_BIN (an executable path, or a command name on PATH) always wins.
# Unset or empty: resolve_codex_bin takes the first executable of CODEX_BIN_CANDIDATES at the first
# real codex call (never at load time, so config / phase-start work without the app).
CODEX_BIN="${CODEX_BIN:-}"
# Where ChatGPT.app ships the Codex CLI, newest layout first, colon-separated. ChatGPT.app 26.1016.62342
# (2026-10-22) moved it from Resources/codex to Resources/codex-cli/bin/codex. Deliberately not an env
# knob — CODEX_BIN is the override; the test suite rewrites this line in a copy.
CODEX_BIN_CANDIDATES="/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex:/Applications/ChatGPT.app/Contents/Resources/codex"
```

2. Add, directly above the `run_codex` banner comment:

```bash
# ----------------------------------------------------------------------------
# Resolve the Codex executable: print it and return 0, or return 1 when there is none.
# An explicit CODEX_BIN is looked up with `command -v` (a path, or a command on PATH) and
# the RESOLVED path must be an executable regular file: on bash 3.2 `command -v` also
# resolves a non-executable file found on PATH, and returns a builtin's bare name. A
# relative result is anchored to the invoking directory.
# Otherwise the first executable regular file in CODEX_BIN_CANDIDATES wins. Never exits,
# so it is safe inside $(...); the caller turns a 1 into an INFRA_ERROR.
# ----------------------------------------------------------------------------
resolve_codex_bin() {
  if [ -n "$CODEX_BIN" ]; then
    local p
    p="$(command -v -- "$CODEX_BIN" 2>/dev/null)" || return 1
    case "$p" in
      /*) ;;
      */*) p="$PWD/$p" ;;   # relative (./x, tools/x, or found via a relative PATH entry): anchor it
                            # to the invoking cwd now, because run_codex later cd's elsewhere
      *) return 1 ;;        # a builtin, function or keyword: never a file
    esac
    [ -f "$p" ] && [ -x "$p" ] || return 1
    printf '%s\n' "$p"
    return 0
  fi
  local c
  while IFS= read -r c; do
    if [ -n "$c" ] && [ -f "$c" ] && [ -x "$c" ]; then
      printf '%s\n' "$c"
      return 0
    fi
  done <<EOF
$(printf '%s\n' "$CODEX_BIN_CANDIDATES" | tr ':' '\n')
EOF
  return 1
}
```

3. At the very top of `run_codex`, after its `local tier=… packet=… cwd=…` line:

```bash
  # Find the binary BEFORE anything else, in this (main) shell: die_infra exits the run here,
  # with zero codex calls. Inside the subshell below it would only leave the subshell.
  local codex_exe
  if ! codex_exe="$(resolve_codex_bin)"; then
    if [ -n "$CODEX_BIN" ]; then
      die_infra "CODEX_BIN is set to '$CODEX_BIN' but is not an executable file or command — fix or unset it (no codex invoked)"
    fi
    die_infra "Codex CLI not found: none of $(printf '%s' "$CODEX_BIN_CANDIDATES" | sed 's/:/, /g') is an executable file — install or update the ChatGPT app, or set CODEX_BIN (no codex invoked)"
  fi
```

   and change the exec line from `"$CODEX_BIN" "${argv[@]}" < "$packet" \` to `"$codex_exe" "${argv[@]}" < "$packet" \`.

4. Docs:
   - `plugin/skills/codex-gate/README.md` Phase-0 block (`:18-19`): keep the historical "Verified live against
     `codex-cli 0.144.0-alpha.4` at …/codex" sentence. After it, add: since ChatGPT.app 26.1016.62342 (2026-10-22) the
     CLI lives at `…/Resources/codex-cli/bin/codex` (`codex-cli 0.163.0-alpha.11.2` on 2026-10-26). The wrapper uses
     `CODEX_BIN` when set (a path or a command on `PATH`); otherwise it uses the first executable of the new path,
     then the old one; with neither it emits `INFRA_ERROR` naming both and calls Codex zero times.
   - `plugin/skills/codex-gate/SKILL.md`:
     - In the INFRA_ERROR bullet (`:60-62`), add one sentence: an `INFRA_ERROR` raised before Codex runs (binary
       not found, malformed knob, refusal) writes no `round-<N>.stderr` (any file there is from an earlier attempt);
       its reason is in `summary`. In the `question` INFRA_ERROR bullet (`:118`), add ", or `summary` when Codex
       never ran".
     - In "Env knobs" (`:465`), add a `CODEX_BIN` entry: optional; a path or command name; default = the resolution
       above.
   - Repo `README.md:111-112`: replace "set `CODEX_BIN` if it's not on PATH" with "it finds the CLI inside ChatGPT.app;
     set `CODEX_BIN` to use another one" (there is no PATH lookup for the default).
5. Run the suite → **GREEN**: `PASS=481 FAIL=0` (441 + the 34 checks P1.1 added + the 6 relative-path checks). Also `bash -n "$W"`.

**Review gate:** opus spec review against PDR 1-3, 7-8 and ADR-002/003; then opus quality review. Fix loop until
both pass. Then the conductor:
- re-runs the suite;
- reads `git diff 392e889 -- plugin README.md`;
- runs `CODEX_GATE_SOURCE=$PWD/$W bash ~/.claude/skills/codex-gate/codex-gate.sh config`, expecting `effective`
  `gpt-6-astra`/`xhigh`/fast false; `digestParity` is now expected to be MISMATCH.

### P1 close (conductor)

Write `$RUNDIR_P1/context.md`: goal, acceptance (PDR 1-3, 7, 8), the implementer reports, "spec review PASSED;
code-quality review PASSED", and the gotcha that the reviewer's own gate is the pre-fix installed copy. Then:
`… codex-gate.sh phase-review P1`, and drive it to APPROVE (resume with `phase-review P1 <round> <threadId>`). Run
verification-before-completion: the suite again. Then a P1 commit if authorized:
`git add -- plugin/skills/codex-gate/codex-gate.sh plugin/skills/codex-gate/codex-gate.test.sh plugin/skills/codex-gate/README.md plugin/skills/codex-gate/SKILL.md README.md docs/initiatives/2026-10-26-codex-gate-bin-and-400/`.
Then the **phase-boundary** hard gate.

---

## Phase P2: classify failed turns by cause

`phase-start P2` (conductor), as for P1.

### Task P2.1 (builder): RED tests for classification

**Files:** modify `T` only.

1. **Fixtures.** Before `write_stub` runs, write these files under `$SANDBOX/fixtures/`, each with a quoted heredoc
   (`<<'JSONL'`) so the bytes are literal:
   - `api_400.jsonl`: the incident's lines verbatim (provenance comment: the run named in the PDR). In order:
     `{"type":"item.completed","item":{"id":"item_0","type":"error","message":"Model metadata for `gpt-6-astra` not found. Defaulting to fallback metadata; this can degrade performance and cause issues."}}`,
     `{"type":"turn.started"}`,
     `{"type":"error","message":"{\"type\":\"error\",\"status\":400,\"error\":{\"type\":\"invalid_request_error\",\"message\":\"The 'gpt-6-astra' model is not supported when using Codex with a ChatGPT account.\"}}"}`,
     and `{"type":"turn.failed","error":{"message":"{\"type\":\"error\",\"status\":400,\"error\":{\"type\":\"invalid_request_error\",\"message\":\"The 'gpt-6-astra' model is not supported when using Codex with a ChatGPT account.\"}}"}}`.
     The stub already prints `thread.started` and `turn.completed` first; that stays.
   - `context_length.jsonl`: an `error` line and a `turn.failed` line whose message is the JSON string
     `{"type":"error","status":400,"error":{"type":"invalid_request_error","code":"context_length_exceeded","message":"Input is too long for the requested model."}}`.
     The text deliberately lacks "context window", so only the code can match.
   - `usage_limit.jsonl`: `error` and `turn.failed`, both with the plain message
     `You've hit your usage limit. Upgrade to Pro or try again later.`
   - `chatter.jsonl`: one `item.completed` `agent_message` whose text says "The diff may not fit the context window;
     Codex ran out of room last time." No failure event.
   - `long.jsonl`: a `turn.failed` whose message (built with `jq -nc --arg`) is 1000+ characters and contains a
     newline, a tab, double quotes and a backslash.
   - `long_context.jsonl`: a `turn.failed` whose message is 400 characters of filler followed by
     `Codex ran out of room in the model's context window.`, so the signature sits past character 300.
2. **Stub modes** (before the `*)` arm, `T:253`; document them in `T:80-99`):
   - `api_400`, `context_length`, `usage_limit`, `chatter`, `long_message`, `long_context`: `cat` the matching
     fixture, `exit 1`, write no `-o`;
   - `approve_with_warning`: print `api_400.jsonl`'s first line only, then do exactly what `approve` does, `exit 0`.

   Add the seam `STUB_API400_IF_STDIN` to the per-call chain (`T:135-139`), mapping a matching stdin to `api_400`, and
   add it to the exports in `run_fan` (`:2350`) and `run_fan_sum` (`:2620`).
3. **Tests** (`run_test_N…`, after P1's):

   | Case | Modes | Expect |
   |---|---|---|
   | the 400 | `plan`, `bundle`, `phase-review`, `question`, `investigate`, unsharded `prepr` | `INFRA_ERROR`; summary contains `HTTP 400`, `invalid_request_error` and `not supported when using Codex with a ChatGPT account`; summary has no newline |
   | context code | unsharded `prepr`, `question`, `investigate`, `phase-review` | `OVERFLOW` |
   | plain API text | unsharded `prepr` with `usage_limit` | `INFRA_ERROR`; summary contains `usage limit` |
   | chatter, nonzero | unsharded `prepr` with `chatter` | `INFRA_ERROR` with summary starting `codex exited nonzero (1)`; never `OVERFLOW` |
   | warning is harmless | unsharded `prepr` with `approve_with_warning` | `APPROVE` |
   | long message | unsharded `prepr` with `long_message` | `INFRA_ERROR`; status is one valid JSON line; summary has no control character and contains `…`; the message part is exactly 301 characters (300 + `…`) |
   | special characters through the fan-out (added after the P2.1 spec review) | `long_message` in one `fan_out_and_aggregate` job, in sharded `prepr`, and in `prepr --multi` | the aggregate verdict file and both status lines are valid JSON and carry `"double quotes"` and `back\slash` (so a raw-`printf` aggregate fails) |
   | the LAST failure line wins | unit, with a fixture whose `error` and `turn.failed` messages differ | `codex_failure_reason` carries the `turn.failed` text |
   | warning plus nonzero exit | stub mode printing the warning item, then exit 1 | `INFRA_ERROR` starting `codex exited nonzero (1)` |
   | command output | a `command_execution` item whose output mentions the context window, nonzero exit | `INFRA_ERROR` starting `codex exited nonzero (1)` |
   | reconnect events in a completed turn (added after the P2.2 spec review) | a fan-out job that logs real-shaped `{"type":"error","message":"Reconnecting... N/5 (…)"}` events, then `turn.completed`, writes a degenerate verdict (request_changes, no blockers) and exits 0; also `codex_failure_reason <fixture> 0 x <verdict>` as a unit | `FAN_INFRA_REASON` and the unit both read `no usable verdict (<verdict path>)`; never `codex turn failed (exit 0)` |
   | signature past the cap | unsharded `prepr` and `question` with `long_context`; `classify_verdict_file <missing> long_context.jsonl 1` | `OVERFLOW`, and `OVERFLOW` from the classifier (classification reads the uncapped message) |
   | sharded 400 | TEST 31's repo with `app.js` carrying the marker `SHARD-API400-HERE` and `STUB_API400_IF_STDIN=SHARD-API400-HERE` | `INFRA_ERROR`; summary starts `shard other failed:` and contains `HTTP 400`; `shards[]` has `other`=`INFRA_ERROR` and the rest `APPROVE`; `round-1-verdict.json` is valid JSON whose `.summary` contains `HTTP 400` |
   | sharded context | same repo with `STUB_OVERFLOW_IF_STDIN` (as TEST 33) | `OVERFLOW` (characterizes the unchanged path) |
   | multi-lens 400 | `prepr --multi` with `STUB_MODE=api_400` | `INFRA_ERROR`; summary starts `lens ` and contains `failed:` and `HTTP 400`; every `lenses[]` entry is `INFRA_ERROR` |
   | aggregate precedence (unit, via the suite's own `cls_fan` driver; `run_fan` is local to TEST 36) | jobs {alpha: block marker, beta: 400 marker} | `FAN_OUTCOME=BLOCK` |
   | | {alpha: 400, beta: overflow} | `INFRA_ERROR`, `FAN_FIRST_INFRA=alpha`, `FAN_FIRST_INCONCLUSIVE=alpha` |
   | | {alpha: overflow, beta: 400} | `INFRA_ERROR`, `FAN_FIRST_INFRA=beta`, `FAN_FIRST_INCONCLUSIVE=alpha`; `FAN_INFRA_REASON` contains `HTTP 400` |
   | classifier unit (source `W`) | `classify_verdict_file <missing> <fixture> 1` | `api_400`→`INFRA_ERROR`, `context_length`→`OVERFLOW`, `chatter`→`INFRA_ERROR`, overflow-stub text→`OVERFLOW`; output is exactly one token |
   | helper unit (source `W`) | `codex_failure_messages api_400.jsonl` | exactly two identical lines, `HTTP 400 invalid_request_error: The 'gpt-6-astra' model is not supported when using Codex with a ChatGPT account.`; nothing for `chatter.jsonl` or a missing file; `long.jsonl` uncapped is one line longer than 1000 characters, and with cap `300` is 300 characters plus `…` |

4. Run the suite. **Expected RED:** the 400 / plain-text / chatter / long / sharded / multi / precedence / helper
   cases fail (they come back `OVERFLOW`, or the helpers are undefined). `context code`, `sharded context` and the
   exit-0 half of `warning is harmless` may already pass: they guard behavior that must not change (the
   warning-plus-nonzero-exit half fails on the old classifier by design). All 481 checks from before P2 pass.
   Measured at P2.1 sign-off: RED `PASS=511 FAIL=56`; the plan's P2.2 code in a scratch copy gives `PASS=567 FAIL=0`.

**Review gate:** opus spec review (PDR 4-6, ADR-004/005/006, the trap, fixture provenance), then opus quality review.
The conductor confirms RED itself.

### Task P2.2 (builder): GREEN — helpers, classifiers, aggregate, docs

**Files:** modify `W` (helpers; `classify_nonzero_exit` `:668-679`; `classify_verdict_file` `:1675-1700`;
`fan_out_and_aggregate` `:1702-1852`; the shard emitter `~:1950-1975`; the multi-lens emitter `~:2119-2153`; the
`emit_overflow` comment `:192-197`), `plugin/skills/codex-gate/SKILL.md`, `plugin/skills/codex-gate/README.md`.

1. Add, directly above the `classify_nonzero_exit` banner:

```bash
# ----------------------------------------------------------------------------
# Failure events of a codex round. A failed turn is a context overflow only when its
# failure text says so: Codex's own "ran out of room in the model's context window",
# or the API's context_length_exceeded code (which arrives as an invalid_request_error,
# so the error TYPE alone never decides). Only structured failure events count: the
# .error.message of {"type":"turn.failed"} and the .message of top-level {"type":"error"}.
# item.completed items of type "error" are warnings, and agent / command text is
# content, so neither is ever read here.
# ----------------------------------------------------------------------------
CODEX_CONTEXT_OVERFLOW_RE='ran out of room|context window|context_length_exceeded'

# One line per failure event. A message that is itself a JSON API error is unwrapped to
# "HTTP <status> <type> <code>: <message>" (absent parts omitted). Control characters
# become spaces. With a cap (> 0) each line is cut to that many characters plus "…" (jq
# counts codepoints); classification passes no cap, so a long message is matched whole.
codex_failure_messages() { # <jsonl> [cap]
  [ -f "${1:-}" ] || return 0
  jq -rR --argjson cap "${2:-0}" '
    fromjson? | select(type == "object")
    | if .type == "turn.failed" then (.error.message? // empty)
      elif .type == "error" then (.message? // empty)
      else empty end
    | tostring
    | . as $raw
    | ((fromjson? // null) | if type == "object" and (.error | type) == "object" then . else null end) as $api
    | (if $api == null then $raw
       else ([ ($api.status // empty | "HTTP \(.)"), ($api.error.type // empty), ($api.error.code // empty) ]
             | map(tostring) | join(" ")) as $head
            | (if $head == "" then "" else $head + ": " end) + (($api.error.message // $raw) | tostring)
       end)
    | gsub("[[:cntrl:]]+"; " ") | gsub(" {2,}"; " ") | sub("^ +"; "") | sub(" +$"; "")
    | select(length > 0)
    | if $cap > 0 and length > $cap then .[0:$cap] + "…" else . end
  ' "$1" 2>/dev/null
}

codex_context_overflow() { # <jsonl> — succeeds when a failure event carries the context signature
  codex_failure_messages "${1:-}" | grep -iqE "$CODEX_CONTEXT_OVERFLOW_RE"
}

# The one-line reason a codex round produced no usable result: on a zero exit, the missing or
# unusable verdict; on a nonzero exit, the API's own message when the round logged a failure
# event, else the exit code. A zero exit never reads failure events: Codex logs top-level "error"
# events ("Reconnecting... N/5") inside turns that then complete normally (18 of 38 local logs
# with such events end in turn.completed).
codex_failure_reason() { # <jsonl> <exit> <stderr> <verdict>
  local msg
  if [ "${2:-1}" -eq 0 ]; then
    printf 'no usable verdict (%s)\n' "${4:-}"
    return 0
  fi
  msg="$(codex_failure_messages "${1:-}" 300 | tail -n 1)"
  if [ -n "$msg" ]; then
    printf 'codex turn failed (exit %s): %s — see %s\n' "$2" "$msg" "${1:-}"
  else
    printf 'codex exited nonzero (%s); see %s\n' "$2" "${3:-}"
  fi
}
```

2. `classify_nonzero_exit` becomes the following, with its banner comment rewritten to match:

```bash
classify_nonzero_exit() {
  if codex_context_overflow "${JSONL_FILE:-}"; then
    emit_overflow "codex hit the context window (turn.failed); diff too large — use delta/shard"
  fi
  die_infra "$(codex_failure_reason "${JSONL_FILE:-}" "${CODEX_EXIT:-1}" "${STDERR_FILE:-}" "${VERDICT_FILE:-}")"
}
```

3. In `classify_verdict_file`, replace the `grep -iE 'ran out of room|context window|"turn\.failed"' "$jf"` test with
   `codex_context_overflow "$jf"`. Keep the three arguments and the one-token output, and update its comment.
4. `fan_out_and_aggregate`:
   - set `FAN_FIRST_INFRA=""; FAN_INFRA_REASON=""` and `local any_infra=0` next to the existing initializers;
   - per job, set `local job_reason=""`. After `classify_verdict_file`, while `CODEX_EXIT` and the job paths are still
     current, when the outcome is `INFRA_ERROR` set
     `job_reason="$(codex_failure_reason "$job_jsonl" "$CODEX_EXIT" "$job_stderr" "$job_verdict")"`;
   - split the `*)` arm: `INFRA_ERROR)` sets `any_inconclusive=1 any_infra=1`, records `FAN_FIRST_INCONCLUSIVE` as
     today, and records the first `FAN_FIRST_INFRA`/`FAN_INFRA_REASON`; `*)` (OVERFLOW) is unchanged;
   - after the BLOCK branch and its `rm -f`, before the inconclusive branch:

```bash
  if [ "$any_infra" = "1" ]; then
    # A job failed for a non-context reason (API error, unusable verdict). That is an infra failure,
    # not an oversized diff: say so, with the job's own reason. jq escapes the API text.
    jq -nc --arg s "$fan_noun $FAN_FIRST_INFRA failed: $FAN_INFRA_REASON" \
      '{verdict:"request_changes", summary:$s, blockers:[], nonBlocking:[]}' > "$VERDICT_FILE" 2>/dev/null || :
    rm -f "$jobs_jsonl"
    FAN_OUTCOME="INFRA_ERROR"
    return 0
  fi
```

   - update the header comment: the aggregate rule (BLOCK > INFRA_ERROR > OVERFLOW > APPROVE), the `FAN_OUTCOME`
     vocabulary, and the two new output variables.
5. In `shard_and_review` and `multi_lens_review`, add an `INFRA_ERROR` branch before each `OVERFLOW` branch. Copy
   that branch's `jq -nc` status verbatim with `outcome "INFRA_ERROR"` and the summaries:
   - shards: `shard $FAN_FIRST_INFRA failed: $FAN_INFRA_REASON (over-budget diff $fullchars chars sharded into $n_shards; fail closed)`
   - lenses: `lens $FAN_FIRST_INFRA failed: $FAN_INFRA_REASON ($n_lenses lenses; fail closed)`
6. Comments: `emit_overflow` (`:192-197`) says "observed at runtime via a context-window failure event
   (CODEX_CONTEXT_OVERFLOW_RE)".
7. Docs (contract text only; no restructuring):
   - SKILL.md OVERFLOW bullet (`:63-68`): runtime OVERFLOW is a context-window failure only ("ran out of room… context
     window" or `context_length_exceeded`). Add a sentence: any other failed turn (HTTP error, usage limit, model not
     supported, capacity) is `INFRA_ERROR` with the API's message in `summary`. "it errored/overflowed" becomes "it
     overflowed".
   - SKILL.md sharding aggregate (`:387-391`) and multi-lens aggregate (`:409-411`): insert "else **INFRA_ERROR** if
     any shard/lens failed for a non-context reason (`<shard|lens> <g> failed: <reason>`)" between BLOCK and OVERFLOW;
     "inconclusive/errored" becomes "inconclusive". The "Status" lists gain `INFRA_ERROR`.
   - README.md: the sharding aggregate (`:136-141`), multi-lens aggregate (`:179-182`) and investigate mapping (`:224`,
     "context-window failure event" instead of "context-window `turn.failed`") get the same wording.
   - The INFRA_ERROR bullets that send the driver to `round-<N>.stderr` (SKILL.md review loop `:60-63`, `question`
     `:121`, `investigate` `:196`) say to read `summary` first. A failed Codex turn carries the API's message there,
     and an aggregate one names the failing shard or lens and its per-job `.jsonl`. `round-<N>.stderr` is the
     fallback and is often empty. Where a doc says an aggregate INFRA_ERROR summary carries "the API's own message",
     it says "the job's reason (the API's own message when one was logged)" (P2.2 spec review).
   - Keep the two INFRA_ERROR shapes distinct in every Status text. An aggregate `INFRA_ERROR` (a shard or lens
     failed) carries `shards[]`/`lenses[]` and `coverage`. The early base-shape `INFRA_ERROR` (malformed knob,
     MAX_LENSES, missing persona, Codex binary not found, as P1 documented) carries neither.
8. Run the suite → **GREEN**: `FAIL=0`; `PASS` = previous + the new checks. Run `bash -n "$W"`.
9. Replay on the real incident, read-only (the conductor runs this):
   `bash -c '. plugin/skills/codex-gate/codex-gate.sh; codex_failure_reason <incident round-1.jsonl> 1 /dev/null x; codex_context_overflow <incident> && echo OVERFLOW || echo NOT'`
   Expect `codex turn failed (exit 1): HTTP 400 invalid_request_error: The 'gpt-6-astra' model … account. — see …`
   and `NOT`.

**Review gate:** opus spec review against PDR 4-8 and ADR-004/005/006; then opus quality review (bash 3.2 safety, `set -u`,
no API text in raw `printf` JSON, comment accuracy). Fix loop until both pass. The conductor re-runs the suite and reads
the diff.

### P2 close (conductor)

Write `context.md`, run `phase-review P2` → APPROVE, run the suite. Then a P2 commit if authorized:
`git add -- plugin/skills/codex-gate/codex-gate.sh plugin/skills/codex-gate/codex-gate.test.sh plugin/skills/codex-gate/README.md plugin/skills/codex-gate/SKILL.md`.
Then the **phase-boundary** hard gate.

---

## Pre-PR and live run

1. `… codex-gate.sh prepr 392e889` → drive to APPROVE. If it shards or OVERFLOWs, follow codex-gate's own loop
   (`prepr-delta 392e889` covers what the phase reviews already approved). Run verification-before-completion: the
   suite, `bash -n`, and a read of `git diff 392e889`.
2. **live-run hard gate** (render `liveRun`, AskUserQuestion: authorize / decline). Only if authorized:
   1. Back up `~/.claude/skills/codex-gate/` to `~/.claude/the-foreman/codex-gate-fix/runtime-backup-<UTC stamp>/`
      with `cp -Rp`, write a `shasum -a 256` manifest of it, and verify the manifest.
   2. Run the README "Manual sync" loop exactly as written (`README.md:436-445`) with `GATE=$PWD/plugin/skills/codex-gate`.
      Then `cp "$GATE/codex-gate.test.sh" "$DEST/"`, the one documented extra the astra initiative also made.
   3. `CODEX_GATE_SOURCE=$GATE/codex-gate.sh bash ~/.claude/skills/codex-gate/codex-gate.sh config` → `parity: MATCH`,
      effective `gpt-6-astra`/`xhigh`/fast false. Run `bash ~/.claude/skills/codex-gate/codex-gate.test.sh` → `FAIL=0`.
   4. The one real proof: `env -u CODEX_BIN bash ~/.claude/skills/codex-gate/codex-gate.sh question <a two-option decision file>`
      → `GROUNDED`. Confirm in `round-1.jsonl` that a real thread ran.
   5. Rollback, if any step fails: copy every file from the backup into `DEST` by the same loop, verify the manifest
      digests, and re-run `config`.
3. Final brief (render `brief`, publish or open locally): what landed, the evidence, what is verified versus claimed,
   and "ready to ship, awaiting your instruction". Ship (push or PR) only on a fresh, explicit ask.
