#!/usr/bin/env bash
# codex-gate.test.sh — TDD harness for codex-gate.sh
#
# Self-contained. Creates its own temp git repos and a STUB `codex` (NO real
# codex calls). Drives stub behavior via $STUB_MODE. Each test prints PASS/FAIL;
# the script exits nonzero if ANY test fails.
#
# Run: bash <skill-dir>/codex-gate.test.sh
#
# Invariants enforced here (contract source of truth is README.md, sibling of this file):
#  1. Outcome mapping (approve/block_fixable/block_decision/nonzero/empty/invalidjson).
#  2. thread_id parsed from JSONL despite a non-JSON prelude line.
#  3. phase-start/phase-review scoped diff: new untracked, modified pre-existing
#     untracked, deletion, $PHASE_HEAD anchoring across a mid-phase commit,
#     pre-existing-deletion-not-re-reported.
#  4. Scratch excludes: .png + .claude/context/ EXCLUDED; .docker/ + .claude/skills/ INCLUDED.
#  5. Read-only: git status --porcelain byte-identical before/after; output files
#     land UNDER the run dir; NO new files appear in the target repo.
#  6. Stub invoked with ABSOLUTE -o and --output-schema paths.

set -u

# --- locate the wrapper under test (sibling of this file) -------------------
TEST_DIR="$(cd "$(dirname "$0")" && pwd)"
WRAPPER="$TEST_DIR/codex-gate.sh"

# --- hermetic environment ---------------------------------------------------
# Scrub EVERY CODEX_GATE_* the caller exported. Without this the suite silently
# inherits the developer's shell: a `defaults`/dial assertion can be satisfied by an
# exported value instead of by the script's own literal, an exported CODEX_GATE_MODEL
# or CODEX_GATE_FAST can move `effectiveParity` off the fixture's declared dials, and
# an exported CODEX_GATE_SHARD can bypass the Tier-3 tests entirely. The scrub is
# blanket (every CODEX_GATE_* name the environment carries, not a hand-kept list), so a
# knob added later is hermetic the day it lands.
# (Closes the "the suite is not hermetic" root cause behind the audited false-greens.)
for __cgv in $(env | sed -n 's/^\(CODEX_GATE_[A-Za-z0-9_]*\)=.*/\1/p'); do
  unset "$__cgv"
done
unset __cgv
# Re-scrub at CALL time for the default-dial tests, so the property is asserted locally
# and survives anything the suite itself might export later. The two vars the HARNESS
# itself owns are kept — dropping them would point the wrapper at the developer's real
# ~/.claude/codex-gate/runs instead of the sandbox.
HERMETIC_KEEP=" CODEX_GATE_RUNS CODEX_GATE_SESSION "
hermetic() { # hermetic [VAR=value ...] <cmd> [args...] — runs with every non-harness CODEX_GATE_* unset
  local unsets="" v
  for v in $(env | sed -n 's/^\(CODEX_GATE_[A-Za-z0-9_]*\)=.*/\1/p'); do
    case "$HERMETIC_KEEP" in *" $v "*) continue ;; esac
    unsets="$unsets -u $v"
  done
  # shellcheck disable=SC2086
  env $unsets "$@"
}

# --- scratch root; everything we create lives here and is removed on exit ----
# CANONICAL (`pwd -P`): on macOS $TMPDIR lives under /var, which is itself a symlink to
# /private/var. `config` classifies a path as `symlink` when ANY of its components is one,
# so a non-canonical sandbox would make every fixture report runtimeKind=symlink for a
# reason that has nothing to do with what the test is asserting.
SANDBOX="$(cd "$(mktemp -d "${TMPDIR:-/tmp}/cgx-test.XXXXXX")" && pwd -P)"
STUB_DIR="$SANDBOX/stub"
mkdir -p "$STUB_DIR"
STUB_ARGV_LOG="$SANDBOX/stub-argv.log"
STUB_STDIN_DUMP="$SANDBOX/stub-stdin.dump"
STUB_CWD_LOG="$SANDBOX/stub-cwd.log"
PICK_LOG="$SANDBOX/pick.log"
FIXTURE_DIR="$SANDBOX/fixtures"   # the failed-turn fixtures (write_failure_fixtures); the stub cats them

cleanup() { rm -rf "$SANDBOX"; }
trap cleanup EXIT

# --- pass/fail bookkeeping ---------------------------------------------------
PASS_COUNT=0
FAIL_COUNT=0
pass() { PASS_COUNT=$((PASS_COUNT + 1)); printf 'PASS: %s\n' "$1"; }
fail() { FAIL_COUNT=$((FAIL_COUNT + 1)); printf 'FAIL: %s\n' "$1"; }
check() { # check <desc> <condition-already-evaluated:0/1>
  if [ "$2" -eq 0 ]; then pass "$1"; else fail "$1"; fi
}

# --- failed-turn FIXTURES (P2: failure classification) ------------------------
# Written under $SANDBOX/fixtures/ with QUOTED heredocs, so the bytes are literal (the JSON
# below carries backticks, backslashes and quotes that the shell must never touch). They must
# exist BEFORE the stub's first run: the stub `cat`s them by the absolute path write_stub
# expands into it. The same files feed the helper / classifier unit tests directly.
write_failure_fixtures() {
  local fx="$FIXTURE_DIR" lm filler
  mkdir -p "$fx"

  # api_400.jsonl — the INCIDENT's lines, verbatim and in order. Provenance: the run named in
  # the PDR, ~/.claude/codex-gate/runs/scratchpad-64a781c3677b/norepo/s-7164f013f9f5/
  # question-decision-icons.md/round-1.jsonl (a gpt-6-astra call refused with HTTP 400). Its
  # thread.started line is left out: the stub already prints thread.started and turn.completed
  # first. The warning (an item.completed whose item.type is "error") is NOT a failure; the
  # error and the turn.failed carry the SAME JSON-encoded API error as their message.
  cat > "$fx/api_400.jsonl" <<'JSONL'
{"type":"item.completed","item":{"id":"item_0","type":"error","message":"Model metadata for `gpt-6-astra` not found. Defaulting to fallback metadata; this can degrade performance and cause issues."}}
{"type":"turn.started"}
{"type":"error","message":"{\"type\":\"error\",\"status\":400,\"error\":{\"type\":\"invalid_request_error\",\"message\":\"The 'gpt-6-astra' model is not supported when using Codex with a ChatGPT account.\"}}"}
{"type":"turn.failed","error":{"message":"{\"type\":\"error\",\"status\":400,\"error\":{\"type\":\"invalid_request_error\",\"message\":\"The 'gpt-6-astra' model is not supported when using Codex with a ChatGPT account.\"}}"}}
JSONL

  # context_length.jsonl — OpenAI's documented shape for a context overflow: an
  # invalid_request_error carrying code context_length_exceeded. The text says neither
  # "context window" nor "ran out of room", so ONLY the code can identify it.
  cat > "$fx/context_length.jsonl" <<'JSONL'
{"type":"error","message":"{\"type\":\"error\",\"status\":400,\"error\":{\"type\":\"invalid_request_error\",\"code\":\"context_length_exceeded\",\"message\":\"Input is too long for the requested model.\"}}"}
{"type":"turn.failed","error":{"message":"{\"type\":\"error\",\"status\":400,\"error\":{\"type\":\"invalid_request_error\",\"code\":\"context_length_exceeded\",\"message\":\"Input is too long for the requested model.\"}}"}}
JSONL

  # usage_limit.jsonl — a failure whose message is plain API text (not a JSON string).
  cat > "$fx/usage_limit.jsonl" <<'JSONL'
{"type":"error","message":"You've hit your usage limit. Upgrade to Pro or try again later."}
{"type":"turn.failed","error":{"message":"You've hit your usage limit. Upgrade to Pro or try again later."}}
JSONL

  # chatter.jsonl — the agent TALKS about the context window, and a command it ran PRINTED it;
  # there is NO failure event. Line 1 is an agent_message. Line 2 is a command_execution item
  # (real shape: command, aggregated_output, exit_code, status) whose OUTPUT says the signature:
  # command output must never make a run OVERFLOW (PDR 6).
  cat > "$fx/chatter.jsonl" <<'JSONL'
{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"The diff may not fit the context window; Codex ran out of room last time."}}
{"type":"item.completed","item":{"id":"item_3","type":"command_execution","command":"cat notes.md","aggregated_output":"The review ran out of room in the model's context window; split the diff.\n","exit_code":0,"status":"completed"}}
JSONL

  # warning_context.jsonl — an item.completed of type "error" (a WARNING) whose text mentions the
  # context window. Never a failure event. Read by the unit tests and by the stub's
  # `warning_nonzero` arm (this line, then exit 1).
  cat > "$fx/warning_context.jsonl" <<'JSONL'
{"type":"item.completed","item":{"id":"item_2","type":"error","message":"Context window usage is high; Codex ran out of room for older turns and trimmed them."}}
JSONL

  # two_messages.jsonl — a top-level `error` and a `turn.failed` whose messages DIFFER (the real
  # events repeat one message; this pins ADR-005's "the summary uses the LAST failure line").
  # Both are plain text with no context signature, so the run is an INFRA_ERROR whose reason is
  # the LAST line. Unit tests only (no stub mode uses it).
  cat > "$fx/two_messages.jsonl" <<'JSONL'
{"type":"error","message":"FIRST-MSG upstream hiccup"}
{"type":"turn.failed","error":{"message":"LAST-MSG model not supported"}}
JSONL

  # long.jsonl — ONE turn.failed whose message is 1000+ characters and carries a newline, a tab,
  # double quotes and a backslash. jq builds the JSON, so every one of them is escaped correctly.
  lm="$(printf 'LONG-HEAD first line\nsecond line\ttabbed "double quotes" and back\\slash then filler '; printf 'filler-%04d ' $(seq 1 120))"
  jq -nc --arg m "$lm" '{type:"turn.failed",error:{message:$m}}' > "$fx/long.jsonl"

  # long_context.jsonl — ONE turn.failed whose message is 400 characters of filler, THEN the
  # signature: it starts past character 300, so only an UNCAPPED classification can see it.
  filler="$(printf 'f%.0s' $(seq 1 399)) "
  jq -nc --arg m "${filler}Codex ran out of room in the model's context window." '{type:"turn.failed",error:{message:$m}}' > "$fx/long_context.jsonl"

  # error_only.jsonl — a top-level `error` event with the context signature and NO turn.failed:
  # the ".message of a top-level error" is a failure source on its own (unit tests only).
  cat > "$fx/error_only.jsonl" <<'JSONL'
{"type":"error","message":"Codex ran out of room in the model's context window while reading the diff."}
JSONL

  # overflow.jsonl — the stub's own `overflow` arm line, byte for byte, so a classifier unit test
  # can feed the file the existing overflow tests exercise through the wrapper.
  cat > "$fx/overflow.jsonl" <<'JSONL'
{"type":"turn.failed","error":{"message":"Codex ran out of room in the model's context window while reading the diff."}}
JSONL

  # reconnect_ok.jsonl — what real Codex logs when the API hiccups mid-turn and recovers: top-level
  # `error` events ("Reconnecting... N/5 (request timed out)", the exact line shapes seen in real
  # logs), then a turn that COMPLETES normally. They are noise, not a failure: a zero exit with
  # this log and an unusable verdict is "no usable verdict", never "codex turn failed" (ADR-005).
  cat > "$fx/reconnect_ok.jsonl" <<'JSONL'
{"type":"error","message":"Reconnecting... 2/5 (request timed out)"}
{"type":"error","message":"Reconnecting... 5/5 (request timed out)"}
{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":1}}
JSONL
}

# --- build the STUB codex ----------------------------------------------------
# Behavior driven by $STUB_MODE:
#   approve        -> verdict approve, exit 0
#   block_fixable  -> request_changes w/ a class=agent_fixable blocker, exit 0
#   block_decision -> request_changes w/ a class=decision blocker, exit 0
#   nonzero        -> writes a valid verdict BUT exits 7 (infra: exit!=0 wins)
#   empty          -> writes an EMPTY -o file, exit 0
#   invalidjson    -> writes non-JSON to -o, exit 0
#   approve_with_blockers -> verdict approve BUT a non-empty blockers[] (inconsistent), exit 0
#   reqchanges_no_blockers -> request_changes with ZERO blockers (degenerate), exit 0
#   approve_bad_blockers -> verdict approve whose `blockers` is NOT an array (verdict.schema.json requires
#                      one), exit 0. $STUB_BLOCKERS_JSON is the raw JSON text spliced in as the `blockers`
#                      value (true, false, 0, {}, null, "x", [] ... ; unset or empty means []), or the word MISSING,
#                      which omits the key altogether
#   grounded        -> GROUNDING object (question.schema.json), settledByCanon=false, exit 0
#   grounded_settled-> GROUNDING object, settledByCanon=true + canonAnswer set, exit 0
#   inv_root_cause  -> INVESTIGATION report (investigate.schema.json), outcome
#                      root_cause_found (the default when --output-schema is investigate.schema.json)
#   inv_needs_evidence-> INVESTIGATION report, outcome needs_more_evidence + a nextSafeProbe
#   inv_unsafe      -> INVESTIGATION report, outcome unsafe_or_blocked (forbidden probe declined)
#   overflow        -> prints the context-window turn.failed JSONL to stdout AND
#                      exits 1 with NO valid -o file (mirrors a real Codex context overflow)
#   block_from_stdin-> request_changes w/ ONE agent_fixable blocker whose issue text is a
#                      SHARDBLOCKER-<tag> marker grepped from THIS call's stdin packet (Tier-3
#                      shard-union seam — selected via STUB_BLOCK_IF_STDIN, see below)
# Failed-turn modes (P2: failure classification). Each one prints fixture lines from
# $FIXTURE_DIR (written by write_failure_fixtures, BEFORE the stub's first run); all but
# approve_with_warning and reconnect_degenerate exit 1 and write no -o file — the shape of a
# real failed Codex turn:
#   api_400         -> the INCIDENT's four JSONL lines: an item.completed warning, turn.started,
#                      a top-level error and a turn.failed whose message is a JSON-encoded
#                      HTTP 400 invalid_request_error ("model not supported ... ChatGPT account")
#   context_length  -> error + turn.failed carrying the API's context_length_exceeded CODE (the
#                      text deliberately lacks "context window": only the code can match)
#   usage_limit     -> error + turn.failed with the plain message "You've hit your usage limit..."
#   chatter         -> an agent_message that merely TALKS about the context window AND a
#                      command_execution item whose output says it too; no failure event at all
#                      (a nonzero exit with this log is a generic failure)
#   long_message    -> a turn.failed whose message is 1000+ chars with a newline, a tab, double
#                      quotes and a backslash (the one-line + cap contract)
#   long_context    -> a turn.failed whose context-window signature sits PAST character 300
#   approve_with_warning -> prints ONLY api_400's warning line (an item.completed of type
#                      "error": a warning, not a failure), then behaves exactly like `approve`
#   warning_nonzero -> prints ONLY warning_context.jsonl's line (a warning whose text mentions the
#                      context window), then exits 1 and writes NO -o file: a nonzero exit whose
#                      only "failure" is a warning
#   reconnect_degenerate -> prints reconnect_ok.jsonl (real-shaped top-level "Reconnecting... N/5"
#                      error events, then turn.completed), writes the DEGENERATE verdict
#                      (request_changes, no blockers) to -o and exits 0: a turn that completed
#                      normally despite the logged errors, with an unusable verdict
# Per-shard seams (Tier 3 sharding — the wrapper invokes the stub once per shard with a
# DIFFERENT scoped packet on stdin): STUB_OVERFLOW_IF_STDIN / STUB_API400_IF_STDIN /
# STUB_BLOCK_IF_STDIN hold a sentinel string; if THIS invocation's stdin contains it, the
# effective mode is overridden to overflow / api_400 / block_from_stdin for THIS call only
# (others keep $STUB_MODE, default approve; when several match, the order is overflow, then
# api_400, then block).
# Also: when --output-schema points at question.schema.json AND STUB_MODE is the
# default 'approve', the stub auto-remaps to 'grounded' (explicit infra/grounded modes win).
# The stub logs its full argv to $STUB_ARGV_LOG and dumps stdin to
# $STUB_STDIN_DUMP, then prints fixture JSONL (with a non-JSON prelude line) to
# stdout so the wrapper's redirect captures it. It also records its process cwd
# to $STUB_CWD_LOG (one line per invocation) so tier-cwd can be asserted.
write_stub() {
  cat > "$STUB_DIR/codex" <<STUBEOF
#!/usr/bin/env bash
set -u
: "\${STUB_MODE:=approve}"
: "\${STUB_ARGV_LOG:=/dev/null}"
: "\${STUB_STDIN_DUMP:=/dev/null}"
: "\${STUB_CWD_LOG:=/dev/null}"

# record argv (one arg per line, NUL-safe-ish for our paths)
printf '%s\n' "\$@" >> "\$STUB_ARGV_LOG"
printf -- '---END-ARGV---\n' >> "\$STUB_ARGV_LOG"

# record the process cwd (the wrapper sets it per tier via a subshell cd)
printf '%s\n' "\$(pwd)" >> "\$STUB_CWD_LOG"

# consume stdin so the wrapper's pipe never blocks; keep last invocation's copy
cat > "\$STUB_STDIN_DUMP"

# Per-shard behavior seam (Tier 3): when sharding, the wrapper calls this stub once
# per shard, each with a DIFFERENT scoped packet on stdin. To make one shard BLOCK or
# OVERFLOW while the others APPROVE, the test sets STUB_BLOCK_IF_STDIN / STUB_OVERFLOW_IF_STDIN
# to a sentinel string that appears ONLY in that shard's diff; if THIS invocation's stdin
# contains it, override the effective mode for THIS call only. (Drives variation by the
# packet contents the stub actually sees, exactly as the plan suggests.)
if [ -n "\${STUB_OVERFLOW_IF_STDIN:-}" ] && grep -q -- "\$STUB_OVERFLOW_IF_STDIN" "\$STUB_STDIN_DUMP" 2>/dev/null; then
  STUB_MODE="overflow"
elif [ -n "\${STUB_API400_IF_STDIN:-}" ] && grep -q -- "\$STUB_API400_IF_STDIN" "\$STUB_STDIN_DUMP" 2>/dev/null; then
  STUB_MODE="api_400"
elif [ -n "\${STUB_BLOCK_IF_STDIN:-}" ] && grep -q -- "\$STUB_BLOCK_IF_STDIN" "\$STUB_STDIN_DUMP" 2>/dev/null; then
  STUB_MODE="block_from_stdin"
fi

# find the -o <path> value AND the --output-schema <path> value in argv
OUT=""
SCHEMA=""
prev=""
for a in "\$@"; do
  if [ "\$prev" = "-o" ]; then OUT="\$a"; fi
  if [ "\$prev" = "--output-schema" ]; then SCHEMA="\$a"; fi
  prev="\$a"
done

# Grounding (question mode) auto-detect: when the schema is question.schema.json
# AND no explicit verdict/infra STUB_MODE was requested (i.e. the default 'approve'),
# remap to the grounded fixture. Explicit infra modes (nonzero/invalidjson/empty) and
# explicit grounded/grounded_settled are left untouched so their behavior wins.
case "\$SCHEMA" in
  */question.schema.json)
    if [ "\$STUB_MODE" = "approve" ]; then STUB_MODE="grounded"; fi
    ;;
  */investigate.schema.json)
    if [ "\$STUB_MODE" = "approve" ]; then STUB_MODE="inv_root_cause"; fi
    ;;
esac

# always emit JSONL to stdout, including a NON-JSON prelude line first
printf 'Reading additional input from stdin...\n'
printf '%s\n' '{"type":"thread.started","thread_id":"stub-tid-123"}'
printf '%s\n' '{"type":"turn.completed","usage":{"input_tokens":10,"output_tokens":5}}'

case "\$STUB_MODE" in
  approve)
    [ -n "\$OUT" ] && printf '%s\n' '{"verdict":"approve","summary":"looks good","blockers":[],"nonBlocking":[]}' > "\$OUT"
    exit 0 ;;
  block_fixable)
    [ -n "\$OUT" ] && printf '%s\n' '{"verdict":"request_changes","summary":"fix this","blockers":[{"class":"agent_fixable","severity":"P1","file":"a.js","line":3,"issue":"bug","suggestion":"fix it"}],"nonBlocking":[]}' > "\$OUT"
    exit 0 ;;
  block_decision)
    [ -n "\$OUT" ] && printf '%s\n' '{"verdict":"request_changes","summary":"need a call","blockers":[{"class":"decision","severity":"P1","file":"b.js","line":0,"issue":"design choice","suggestion":"pick one"}],"nonBlocking":[]}' > "\$OUT"
    exit 0 ;;
  block_from_stdin)
    # SHARD union seam: emit ONE agent_fixable blocker whose issue text is a unique
    # marker grepped from THIS shard's packet (SHARDBLOCKER-<tag>). Lets two different
    # shards block with DISTINCT blockers so the aggregate union can be proven.
    SB_TAG="\$(grep -o 'SHARDBLOCKER-[A-Za-z0-9_]*' "\$STUB_STDIN_DUMP" 2>/dev/null | head -1)"
    [ -n "\$SB_TAG" ] || SB_TAG="SHARDBLOCKER-unknown"
    [ -n "\$OUT" ] && printf '%s\n' "{\"verdict\":\"request_changes\",\"summary\":\"shard blocked\",\"blockers\":[{\"class\":\"agent_fixable\",\"severity\":\"P1\",\"file\":\"shard.js\",\"line\":1,\"issue\":\"\$SB_TAG\",\"suggestion\":\"fix \$SB_TAG\"}],\"nonBlocking\":[]}" > "\$OUT"
    exit 0 ;;
  nonzero)
    # write a perfectly valid verdict, but exit nonzero: exit code must win
    [ -n "\$OUT" ] && printf '%s\n' '{"verdict":"approve","summary":"ignored","blockers":[],"nonBlocking":[]}' > "\$OUT"
    exit 7 ;;
  empty)
    [ -n "\$OUT" ] && : > "\$OUT"
    exit 0 ;;
  invalidjson)
    [ -n "\$OUT" ] && printf '%s\n' 'this is not json {' > "\$OUT"
    exit 0 ;;
  approve_with_blockers)
    # INCONSISTENT: says approve but carries a blocker -> wrapper must fail closed to BLOCK
    [ -n "\$OUT" ] && printf '%s\n' '{"verdict":"approve","summary":"approve but blocked","blockers":[{"class":"agent_fixable","severity":"P1","file":"c.js","line":1,"issue":"leftover","suggestion":"fix"}],"nonBlocking":[]}' > "\$OUT"
    exit 0 ;;
  reqchanges_no_blockers)
    # DEGENERATE: request_changes with an empty blockers[] -> wrapper must surface INFRA_ERROR
    [ -n "\$OUT" ] && printf '%s\n' '{"verdict":"request_changes","summary":"changes but no blockers","blockers":[],"nonBlocking":[]}' > "\$OUT"
    exit 0 ;;
  approve_bad_blockers)
    # SCHEMA VIOLATION: says approve, but "blockers" is not an array (or is absent). The raw JSON text of
    # \$STUB_BLOCKERS_JSON is spliced in as the value (default []); the word MISSING omits the key. The wrapper
    # must fail closed on every one of them: a non-array can never count as "zero blockers".
    if [ "\${STUB_BLOCKERS_JSON:-}" = "MISSING" ]; then
      [ -n "\$OUT" ] && printf '%s\n' '{"verdict":"approve","summary":"looks good","nonBlocking":[]}' > "\$OUT"
    else
      [ -n "\$OUT" ] && printf '%s\n' "{\"verdict\":\"approve\",\"summary\":\"looks good\",\"blockers\":\${STUB_BLOCKERS_JSON:-[]},\"nonBlocking\":[]}" > "\$OUT"
    fi
    exit 0 ;;
  grounded)
    # QUESTION mode: a GROUNDING-shaped object (valid vs question.schema.json), unsettled.
    [ -n "\$OUT" ] && printf '%s\n' '{"settledByCanon":false,"canonAnswer":"","recommendation":"Option A: a dedicated table","rationale":"Option A keeps writes append-only and matches the existing event-store pattern.","optionAssessments":[{"option":"Option A","pros":"append-only; matches event store","cons":"one more table","risk":"migration ordering"},{"option":"Option B","pros":"fewer tables","cons":"mixes concerns","risk":"lock contention"}],"missingOptions":[{"option":"Option C: a materialized view","why":"avoids a write path entirely if reads dominate"}],"considerations":["read/write ratio","migration cost"]}' > "\$OUT"
    exit 0 ;;
  grounded_settled)
    # QUESTION mode: canon ALREADY decides it -> settledByCanon=true + canonAnswer set.
    [ -n "\$OUT" ] && printf '%s\n' '{"settledByCanon":true,"canonAnswer":"ADR-0007 (docs/adr/0007.md:12) mandates a dedicated append-only table.","recommendation":"none","rationale":"The repo canon already settles this in ADR-0007.","optionAssessments":[{"option":"Option A","pros":"conforms to ADR-0007","cons":"none","risk":"none"}],"missingOptions":[],"considerations":["follow ADR-0007"]}' > "\$OUT"
    exit 0 ;;
  inv_root_cause)
    # INVESTIGATE mode: a PROVEN root cause (valid vs investigate.schema.json).
    [ -n "\$OUT" ] && printf '%s\n' '{"outcome":"root_cause_found","rootCause":"nodemon CLI -w re-includes the eval write+exec tree","confidence":"high","evidence":[{"observation":"writes under the watched tree trip a restart","source":"package.json:12"}],"hypothesesTested":[{"hypothesis":"transient watched file","verdict":"confirmed","evidence":"observed restart after write"}],"commandsRun":["git show HEAD:package.json"],"forbiddenActionsAvoided":["did not trigger a Layer B (live AI) run"],"minimalFix":"narrow the nodemon watch / ignore the eval run tree","nextSafeProbe":""}' > "\$OUT"
    exit 0 ;;
  inv_needs_evidence)
    # INVESTIGATE mode: a leading hypothesis needing one more SAFE probe.
    [ -n "\$OUT" ] && printf '%s\n' '{"outcome":"needs_more_evidence","rootCause":"leading hypothesis: a transient watched file (UNCONFIRMED)","confidence":"low","evidence":[{"observation":"restart fires ~8-19s after each run start","source":"docker logs api-platform"}],"hypothesesTested":[{"hypothesis":"legacy-poll phantom restart","verdict":"inconclusive","evidence":"need an fs-event trace under load"}],"commandsRun":["docker logs -t api-platform"],"forbiddenActionsAvoided":[],"minimalFix":"","nextSafeProbe":"run a Layer A suite while busy-polling: find <watched dirs> -newer <marker>"}' > "\$OUT"
    exit 0 ;;
  inv_unsafe)
    # INVESTIGATE mode: forward progress requires a FORBIDDEN probe -> fail closed.
    [ -n "\$OUT" ] && printf '%s\n' '{"outcome":"unsafe_or_blocked","rootCause":"confirming would require triggering a Layer B run, which the brief forbids","confidence":"low","evidence":[],"hypothesesTested":[],"commandsRun":[],"forbiddenActionsAvoided":["declined to start a Layer B (live AI) run that spends money + writes prod"],"minimalFix":"","nextSafeProbe":"a human can reproduce with Layer A only, then re-run investigate"}' > "\$OUT"
    exit 0 ;;
  lens_dedup)
    # MULTI-LENS de-dup seam (Phase 3d): each lens reviews the SAME diff but with its OWN
    # persona at the TOP of the packet. Read which lens THIS call is by the persona banner
    # in stdin (arch/security/tests/frontend). arch + security emit the IDENTICAL blocker
    # (file=shared.js,line=7,issue=DUPE-FINDING) so the union carries a cross-lens duplicate;
    # tests emits a DISTINCT one (issue=TESTS-ONLY-FINDING). The aggregate dedup must collapse
    # the shared one to a single blocker.
    LENS="other"
    if grep -qi 'You are the ARCHITECTURE' "\$STUB_STDIN_DUMP" 2>/dev/null; then LENS="arch"
    elif grep -qi 'You are the SECURITY' "\$STUB_STDIN_DUMP" 2>/dev/null; then LENS="security"
    elif grep -qi 'You are the TESTS' "\$STUB_STDIN_DUMP" 2>/dev/null; then LENS="tests"
    elif grep -qi 'You are the FRONTEND' "\$STUB_STDIN_DUMP" 2>/dev/null; then LENS="frontend"
    fi
    case "\$LENS" in
      arch|security)
        [ -n "\$OUT" ] && printf '%s\n' '{"verdict":"request_changes","summary":"shared finding","blockers":[{"class":"agent_fixable","severity":"P1","file":"shared.js","line":7,"issue":"DUPE-FINDING","suggestion":"fix the shared issue"}],"nonBlocking":[]}' > "\$OUT" ;;
      tests)
        [ -n "\$OUT" ] && printf '%s\n' '{"verdict":"request_changes","summary":"tests finding","blockers":[{"class":"agent_fixable","severity":"P1","file":"tests.js","line":1,"issue":"TESTS-ONLY-FINDING","suggestion":"add a test"}],"nonBlocking":[]}' > "\$OUT" ;;
      *)
        [ -n "\$OUT" ] && printf '%s\n' '{"verdict":"approve","summary":"clean","blockers":[],"nonBlocking":[]}' > "\$OUT" ;;
    esac
    exit 0 ;;
  overflow)
    # CONTEXT OVERFLOW: codex blew the context window. Emit the turn.failed signature
    # JSONL to stdout and exit nonzero WITHOUT writing a valid -o verdict file. The
    # wrapper must classify this as OVERFLOW (distinct from generic INFRA_ERROR).
    printf '%s\n' '{"type":"turn.failed","error":{"message":"Codex ran out of room in the model'"'"'s context window while reading the diff."}}'
    exit 1 ;;
  api_400|context_length|usage_limit|chatter)
    # FAILED TURN (P2): cat the matching fixture (the path expands at WRITE time, so the stub
    # carries the literal sandbox path), exit nonzero, write NO -o verdict file.
    cat '$FIXTURE_DIR/'"\$STUB_MODE".jsonl
    exit 1 ;;
  long_message)
    cat '$FIXTURE_DIR/long.jsonl'
    exit 1 ;;
  long_context)
    cat '$FIXTURE_DIR/long_context.jsonl'
    exit 1 ;;
  approve_with_warning)
    # ONLY the incident's first line (an item.completed WARNING), then exactly what 'approve'
    # does (verdict written, exit 0): the warning must NOT be read as a failure.
    head -n 1 '$FIXTURE_DIR/api_400.jsonl'
    [ -n "\$OUT" ] && printf '%s\n' '{"verdict":"approve","summary":"looks good","blockers":[],"nonBlocking":[]}' > "\$OUT"
    exit 0 ;;
  warning_nonzero)
    # ONLY a WARNING item (its text mentions the context window), then a nonzero exit and NO -o
    # verdict file: the warning is not a failure event, so the exit is a generic failure.
    cat '$FIXTURE_DIR/warning_context.jsonl'
    exit 1 ;;
  reconnect_degenerate)
    # A turn that logged top-level "Reconnecting... N/5" error events and then COMPLETED, exit 0,
    # with a degenerate verdict (request_changes, zero blockers): the exit is clean, the verdict
    # is unusable, and the logged errors are noise, not the cause.
    cat '$FIXTURE_DIR/reconnect_ok.jsonl'
    [ -n "\$OUT" ] && printf '%s\n' '{"verdict":"request_changes","summary":"x","blockers":[],"nonBlocking":[]}' > "\$OUT"
    exit 0 ;;
  *)
    printf 'unknown STUB_MODE: %s\n' "\$STUB_MODE" >&2
    exit 99 ;;
esac
STUBEOF
  chmod +x "$STUB_DIR/codex"
}
write_failure_fixtures      # BEFORE the first stub run: the stub reads these by absolute path
write_stub

# --- common env for every wrapper invocation ---------------------------------
export CODEX_BIN="$STUB_DIR/codex"
export CODEX_GATE_RUNS="$SANDBOX/runs"
export CODEX_HOME_DIR="$SANDBOX/codex-home"
export CODEX_GATE_SESSION="testsession"
export STUB_ARGV_LOG STUB_STDIN_DUMP STUB_CWD_LOG
mkdir -p "$CODEX_GATE_RUNS" "$CODEX_HOME_DIR"

# Helper: make a fresh temp git repo, echo its path
make_repo() {
  local r
  r="$(mktemp -d "$SANDBOX/repo.XXXXXX")"
  git -C "$r" init -q
  git -C "$r" config user.email t@t.co
  git -C "$r" config user.name "t"
  git -C "$r" config commit.gpgsign false
  printf '%s' "$r"
}

# Helper: read the JSON status line the wrapper prints to stdout.
# The wrapper may print the runDir/phaseHead lines (phase-start) or a single
# status JSON object (review modes). We grab the LAST line that parses as JSON.
last_json_line() { # <file>
  local line out=""
  while IFS= read -r line; do
    if printf '%s' "$line" | jq -e . >/dev/null 2>&1; then out="$line"; fi
  done < "$1"
  printf '%s' "$out"
}

# --- the documented SYNC INVENTORY -------------------------------------------
# The whole-skill-directory sync unit (README.md "Install/sync"). Pinned HERE on
# purpose rather than read back out of the script: the suite must FAIL if the
# script's inventory ever drifts from the documented one, in either direction.
# The script (`codex-gate.sh`) is first — it is the entry whose destination name is
# taken from CODEX_GATE_RUNTIME; every other entry is a sibling of it.
GATE_INVENTORY="codex-gate.sh
verdict.schema.json
question.schema.json
investigate.schema.json
reviewer-instructions.md
reviewer-instructions.arch.md
reviewer-instructions.frontend.md
reviewer-instructions.security.md
reviewer-instructions.tests.md
question-instructions.md
investigate-instructions.md
SKILL.md
README.md"

# Helper: build a COMPLETE synthetic skill directory fixture (every inventory member
# present). <docTag> is stamped into the non-script members so two fixtures can carry
# an identical script but DIFFERENT docs — the exact shape of the P1-d defect.
make_skill_fixture() { # <dir> <model> <effort> <fast> <docTag>
  local d="$1" n
  mkdir -p "$d"
  {
    printf '#!/usr/bin/env bash\n'
    printf 'CODEX_GATE_MODEL="${CODEX_GATE_MODEL-%s}"\n' "$2"
    printf 'CODEX_GATE_EFFORT="${CODEX_GATE_EFFORT:-%s}"\n' "$3"
    printf 'CODEX_GATE_FAST="${CODEX_GATE_FAST:-%s}"\n' "$4"
  } > "$d/codex-gate.sh"
  chmod +x "$d/codex-gate.sh"
  printf '%s\n' "$GATE_INVENTORY" | while IFS= read -r n; do
    [ -n "$n" ] || continue
    [ "$n" = "codex-gate.sh" ] && continue
    printf 'fixture %s (%s)\n' "$n" "$5" > "$d/$n"
  done
}

# Helper: a REAL, RUNNABLE copy of this skill — all 13 inventory members, taken from the
# checkout under test. `make_skill_fixture` writes a 3-line stub that only declares dials,
# which is enough to be COMPARED but not enough to be EXECUTED (`main` requires the sibling
# verdict.schema.json + reviewer-instructions.md). Use this wherever the fixture itself has
# to run a mode.
copy_real_skill() { # <dir>
  local d="$1" n
  mkdir -p "$d"
  printf '%s\n' "$GATE_INVENTORY" | while IFS= read -r n; do
    [ -n "$n" ] || continue
    cp "$TEST_DIR/$n" "$d/$n"
  done
  chmod +x "$d/codex-gate.sh"
}

# Helper: a REAL, RUNNABLE copy of this skill whose Codex candidate list is <candidates>
# (colon-separated, the exact shape of the shipped constant). It rewrites the ONE line that
# begins `CODEX_BIN_CANDIDATES=` in the COPY's codex-gate.sh — never the checkout's — through
# the same rewrite-to-temp-then-mv seam `retune_gate_dials` uses, so production gains no
# test-only knob (ADR-003). LOUD by construction: when the seam line is missing (production
# not implemented yet, or the constant was renamed) the helper records a FAIL and returns 1,
# and a rewrite that did not land fails the same way (whole-line read-back). A silent no-op
# would leave an unmodified copy that resolves the REAL ChatGPT.app and make every resolution
# test pass or fail for the wrong reason. It also proves the rewritten copy names `/Applications/`
# nowhere outside a comment, so a second hard-coded path (or a default inside the CODEX_BIN
# expansion) left behind in the wrapper cannot let a run reach the real app: that FAILs here,
# before any wrapper runs. Callers MUST `|| return` on a nonzero status.
# Call it directly (never inside `$(...)`): the FAIL has to land in this shell's counters.
bin_fixture() { # <dir> <candidates>
  local d="$1" cands="$2" f tmp n
  copy_real_skill "$d"
  f="$d/codex-gate.sh"
  tmp="$f.tmpbin"
  n="$(grep -c '^CODEX_BIN_CANDIDATES=' "$f" 2>/dev/null)"; [ -n "$n" ] || n=0
  if [ "$n" -lt 1 ]; then
    fail "bin_fixture: no line beginning CODEX_BIN_CANDIDATES= in the copy ($f) — the candidate-list seam is missing, so no resolution test can run"
    return 1
  fi
  # ENVIRON (not awk -v) so the paths reach awk with no backslash-escape processing.
  CG_BIN_CANDS="$cands" awk '
    index($0, "CODEX_BIN_CANDIDATES=")==1 { print "CODEX_BIN_CANDIDATES=\"" ENVIRON["CG_BIN_CANDS"] "\""; next }
    { print }
  ' "$f" > "$tmp" && mv "$tmp" "$f"
  chmod +x "$f"
  if [ "$(grep -cFx -- "CODEX_BIN_CANDIDATES=\"$cands\"" "$f" 2>/dev/null)" != "$n" ]; then
    fail "bin_fixture: rewriting CODEX_BIN_CANDIDATES in $f did not take effect (expected $n line(s) equal to the new value)"
    return 1
  fi
  if grep -n '/Applications/' "$f" | grep -qv '^[0-9]*:[[:space:]]*#'; then
    fail "bin_fixture: $f still names /Applications/ outside a comment after the rewrite, so a run could reach the real app :: $(grep -n '/Applications/' "$f" | grep -v '^[0-9]*:[[:space:]]*#' | head -3)"
    return 1
  fi
  return 0
}

# Helper: a marker stub for the resolution tests. Each run appends <tag> as one line to
# $PICK_LOG — so the log says WHICH candidate the wrapper chose and how many times —
# then hands over to the suite's real stub, so a correct pick yields a normal round.
# `#!/bin/sh` on purpose: it mirrors the shipped ChatGPT.app launcher. The heredoc is
# UNQUOTED so $PICK_LOG / $STUB_DIR / $2 expand at write time (the stub carries the literal
# sandbox paths, single-quoted); the `\$@` and the `\n` stay for the stub's own shell.
mk_marker_stub() { # <path> <tag>
  mkdir -p "$(dirname "$1")"
  cat > "$1" <<MARKEREOF
#!/bin/sh
printf '%s\n' '$2' >> '$PICK_LOG'
exec '$STUB_DIR/codex' "\$@"
MARKEREOF
  chmod +x "$1"
}

# Helper: rewrite a COPY's `CODEX_GATE_SYNC_INVENTORY` constant (a multi-line
# single-quoted assignment) to <members>, so a TRUNCATED or EMPTY inventory can be driven
# without touching the checkout. <members> is passed through `awk -v`, so `\n` separates
# members and an empty string yields an empty constant.
# Deliberately anchored on `CODEX_GATE_SYNC_INVENTORY=` (with the `=`), so the sibling
# `CODEX_GATE_SYNC_INVENTORY_COUNT=` pin is LEFT ALONE — the point of these fixtures is a
# constant that disagrees with the pin.
set_fixture_inventory() { # <script> <members>
  local f="$1" tmp="$1.tmpmut"
  awk -v repl="$2" -v q="'" '
    index($0, "CODEX_GATE_SYNC_INVENTORY=")==1 { print "CODEX_GATE_SYNC_INVENTORY=" q repl q; skip=1; next }
    skip==1 { if (substr($0, length($0), 1) == q) skip=0; next }
    { print }
  ' "$f" > "$tmp" && mv "$tmp" "$f"
  chmod +x "$f"
}

# Helper: break the ENUMERATION without touching the constant. `inventory_pairs`' heredoc
# body is the single line `$CODEX_GATE_SYNC_INVENTORY`; replacing it with <body> ("" for a
# zero-row enumeration) reproduces "the command substitution yielded fewer rows than the
# inventory declares" — enumeration failure, not constant corruption.
break_fixture_enumeration() { # <script> <heredoc-body>
  local f="$1" tmp="$1.tmpmut"
  awk -v body="$2" '$0=="$CODEX_GATE_SYNC_INVENTORY" { print body; next } { print }' "$f" > "$tmp" && mv "$tmp" "$f"
  chmod +x "$f"
}

# Helper: retune a REAL copy's three dial declarations in place, keeping each dial's
# expansion form (`-` for model, `:-` for effort/fast) so the copy stays a valid,
# runnable gate whose `config` parser-trust gate is satisfied.
retune_gate_dials() { # <script> <model> <effort> <fast>
  local f="$1" tmp="$1.tmpdial"
  sed -e "s|^CODEX_GATE_MODEL=.*|CODEX_GATE_MODEL=\"\${CODEX_GATE_MODEL-$2}\"|" \
      -e "s|^CODEX_GATE_EFFORT=.*|CODEX_GATE_EFFORT=\"\${CODEX_GATE_EFFORT:-$3}\"|" \
      -e "s|^CODEX_GATE_FAST=.*|CODEX_GATE_FAST=\"\${CODEX_GATE_FAST:-$4}\"|" \
      "$f" > "$tmp" && mv "$tmp" "$f"
  chmod +x "$f"
}

# Helper: retune a REAL copy's three dial declarations INCLUDING their expansion
# operators. `retune_gate_dials` above pins the operators to this repo's own (`-` for the
# model, `:-` for effort/fast); this variant lets a fixture declare EITHER operator per
# dial, which is the whole point of the cross-product in TEST 63 — `${VAR-lit}` and
# `${VAR:-lit}` disagree about an EMPTY override, and a copy is free to use either.
retune_gate_dial_ops() { # <script> <modelOp> <model> <effortOp> <effort> <fastOp> <fast>
  local f="$1" tmp="$1.tmpdialop"
  sed -e "s|^CODEX_GATE_MODEL=.*|CODEX_GATE_MODEL=\"\${CODEX_GATE_MODEL$2$3}\"|" \
      -e "s|^CODEX_GATE_EFFORT=.*|CODEX_GATE_EFFORT=\"\${CODEX_GATE_EFFORT$4$5}\"|" \
      -e "s|^CODEX_GATE_FAST=.*|CODEX_GATE_FAST=\"\${CODEX_GATE_FAST$6$7}\"|" \
      "$f" > "$tmp" && mv "$tmp" "$f"
  chmod +x "$f"
}

# Helper: an identity fingerprint that changes on ANY write — mtime with sub-second
# precision AND the inode. A rewrite-with-identical-bytes moves the mtime; a
# temp-file+rename moves the inode. Digest comparison alone sees neither, which is
# exactly the false-green the audit proved by injecting a `touch`.
file_stamp() { # <path> -> "<mtime>|<inode>", or "ABSENT"
  [ -e "$1" ] || { printf 'ABSENT'; return 0; }
  stat -f '%Fm|%i' "$1" 2>/dev/null || stat -c '%.9Y|%i' "$1" 2>/dev/null
}

# Helper: reset the argv log between assertions
reset_argv_log() { : > "$STUB_ARGV_LOG"; }
# Helper: reset the cwd log between assertions
reset_cwd_log() { : > "$STUB_CWD_LOG"; }
# Helper: reset the marker-stub pick log between assertions
reset_pick_log() { : > "$PICK_LOG"; }

#############################################################################
# TEST 1 — outcome mapping
#############################################################################
test_outcome() { # <stub_mode> <expected_outcome> <extra_jq_filter_or_empty>
  local mode="$1" expect="$2" extra="${3:-}"
  local repo out status outcome
  repo="$(make_repo)"
  ( cd "$repo" && STUB_MODE="$mode" bash "$WRAPPER" prepr ) > "$SANDBOX/out.txt" 2>"$SANDBOX/err.txt"
  status="$(last_json_line "$SANDBOX/out.txt")"
  outcome="$(printf '%s' "$status" | jq -r '.outcome // empty' 2>/dev/null)"
  if [ "$outcome" = "$expect" ]; then
    if [ -n "$extra" ]; then
      if printf '%s' "$status" | jq -e "$extra" >/dev/null 2>&1; then
        pass "outcome[$mode] = $expect ($extra)"
      else
        fail "outcome[$mode] = $expect but extra filter failed: $extra :: $status"
      fi
    else
      pass "outcome[$mode] = $expect"
    fi
  else
    fail "outcome[$mode]: expected $expect got '$outcome' :: $status :: $(cat "$SANDBOX/err.txt")"
  fi
}

run_test_1() {
  test_outcome approve        APPROVE     '.outcome=="APPROVE"'
  test_outcome block_fixable  BLOCK       '.agentFixableBlockers>=1'
  test_outcome block_decision BLOCK       '.decisionBlockers>=1'
  test_outcome nonzero        INFRA_ERROR ''
  test_outcome empty          INFRA_ERROR ''
  test_outcome invalidjson    INFRA_ERROR ''
}

#############################################################################
# TEST 2 — thread_id parsed despite non-JSON prelude line
#############################################################################
run_test_2() {
  local repo status tid
  repo="$(make_repo)"
  ( cd "$repo" && STUB_MODE=approve bash "$WRAPPER" prepr ) > "$SANDBOX/out.txt" 2>"$SANDBOX/err.txt"
  status="$(last_json_line "$SANDBOX/out.txt")"
  tid="$(printf '%s' "$status" | jq -r '.threadId // empty' 2>/dev/null)"
  if [ "$tid" = "stub-tid-123" ]; then
    pass "thread_id parsed as stub-tid-123 despite non-JSON prelude"
  else
    fail "thread_id: expected stub-tid-123 got '$tid' :: $status"
  fi
}

#############################################################################
# TEST 3 — phase-start + phase-review scoped diff semantics
#############################################################################
run_test_3() {
  local repo runDir phaseHead status packet
  repo="$(make_repo)"

  # Pre-existing committed files: keepme (untouched), modifyme, deleteme,
  # and predeleted (will be deleted BEFORE phase-start -> must NOT be re-reported).
  printf 'keep\n'    > "$repo/keepme.txt"
  printf 'orig-mod\n' > "$repo/modifyme.txt"
  printf 'to-delete\n' > "$repo/deleteme.txt"
  printf 'predeleted-content\n' > "$repo/predeleted.txt"
  # A pre-existing UNTRACKED file that will be modified after phase-start.
  git -C "$repo" add keepme.txt modifyme.txt deleteme.txt predeleted.txt
  git -C "$repo" commit -qm init

  # Pre-existing untracked source file (exists at phase-start, modified after).
  printf 'untracked-v1\n' > "$repo/preexist_untracked.js"
  # predeleted.txt is removed BEFORE phase-start (deleted at start).
  rm -f "$repo/predeleted.txt"

  # phase-start
  ( cd "$repo" && bash "$WRAPPER" phase-start P1 ) > "$SANDBOX/ps.txt" 2>"$SANDBOX/ps.err"
  runDir="$(grep -E '^RUNDIR=' "$SANDBOX/ps.txt" | head -1 | sed 's/^RUNDIR=//')"
  phaseHead="$(grep -E '^PHASE_HEAD=' "$SANDBOX/ps.txt" | head -1 | sed 's/^PHASE_HEAD=//')"
  if [ -z "$runDir" ] || [ -z "$phaseHead" ]; then
    fail "phase-start did not print RUNDIR=/PHASE_HEAD= :: $(cat "$SANDBOX/ps.txt") :: $(cat "$SANDBOX/ps.err")"
    return
  fi
  [ -f "$runDir/snapshot.json" ] && pass "phase-start wrote snapshot.json" || fail "phase-start missing snapshot.json at $runDir"

  # snapshot must record predeleted.txt as baselineKind=deleted (tracked, deleted at start)
  if jq -e '.entries[] | select(.path=="predeleted.txt" and .baselineKind=="deleted")' "$runDir/snapshot.json" >/dev/null 2>&1; then
    pass "phase-start snapshot marks pre-existing deletion baselineKind=deleted"
  else
    fail "phase-start snapshot did not mark predeleted.txt deleted :: $(cat "$runDir/snapshot.json")"
  fi
  # snapshot must copy contents of the pre-existing untracked source file
  if [ -f "$runDir/snapshot/preexist_untracked.js" ] && grep -q 'untracked-v1' "$runDir/snapshot/preexist_untracked.js"; then
    pass "phase-start snapshotted pre-existing untracked source contents"
  else
    fail "phase-start did not snapshot preexist_untracked.js contents"
  fi

  # ---- mid-phase commit (must NOT move the baseline) ----
  printf 'orig-mod\nmid-phase-change\n' > "$repo/modifyme.txt"
  git -C "$repo" add modifyme.txt
  git -C "$repo" commit -qm "mid-phase commit"

  # ---- the phase's actual changes ----
  printf 'brand-new-tracked-source\n' > "$repo/newfile.js"          # (a) NEW untracked source
  printf 'untracked-v2\n' > "$repo/preexist_untracked.js"           # (b) MODIFY pre-existing untracked
  rm -f "$repo/deleteme.txt"                                         # (c) DELETION (tracked)

  # phase-review
  ( cd "$repo" && STUB_MODE=approve bash "$WRAPPER" phase-review P1 ) > "$SANDBOX/pr.txt" 2>"$SANDBOX/pr.err"
  status="$(last_json_line "$SANDBOX/pr.txt")"
  if [ -z "$status" ]; then
    fail "phase-review printed no status JSON :: $(cat "$SANDBOX/pr.txt") :: $(cat "$SANDBOX/pr.err")"
    return
  fi
  # the packet is what the wrapper piped to codex (captured by the stub)
  packet="$STUB_STDIN_DUMP"

  # (a) new untracked source present in packet
  grep -q 'brand-new-tracked-source' "$packet" && pass "phase-review packet includes NEW untracked file" \
    || fail "phase-review packet missing new untracked file content"
  grep -q 'newfile.js' "$packet" && pass "phase-review packet names newfile.js" \
    || fail "phase-review packet does not name newfile.js"

  # (b) modification to pre-existing untracked: BOTH old (v1, from snapshot baseline) and new (v2)
  grep -q 'untracked-v2' "$packet" && pass "phase-review packet includes modified untracked NEW content (v2)" \
    || fail "phase-review packet missing modified untracked v2"
  grep -q 'untracked-v1' "$packet" && pass "phase-review packet diffs untracked vs phase-start baseline (v1 in diff)" \
    || fail "phase-review packet did not anchor untracked to snapshot baseline (no v1)"

  # (c) deletion present
  grep -q 'deleteme.txt' "$packet" && pass "phase-review packet includes the deletion (deleteme.txt)" \
    || fail "phase-review packet missing deleted file deleteme.txt"

  # (d) $PHASE_HEAD anchoring: the mid-phase-committed change to modifyme.txt
  #     MUST appear (anchored to phase-start, not HEAD).
  grep -q 'mid-phase-change' "$packet" && pass "phase-review anchored to PHASE_HEAD (mid-phase commit captured)" \
    || fail "phase-review NOT anchored to PHASE_HEAD: mid-phase commit change missing"

  # (e) pre-existing deletion (predeleted.txt) must NOT be re-reported
  if grep -q 'predeleted' "$packet"; then
    fail "phase-review RE-REPORTED a pre-existing deletion (predeleted) — should be silent"
  else
    pass "phase-review does NOT re-report pre-existing deletion"
  fi
}

#############################################################################
# TEST 4 — scratch excludes
#############################################################################
run_test_4() {
  local repo runDir packet
  repo="$(make_repo)"
  printf 'seed\n' > "$repo/seed.txt"
  git -C "$repo" add seed.txt
  git -C "$repo" commit -qm init

  ( cd "$repo" && bash "$WRAPPER" phase-start P1 ) > "$SANDBOX/ps.txt" 2>"$SANDBOX/ps.err"
  runDir="$(grep -E '^RUNDIR=' "$SANDBOX/ps.txt" | head -1 | sed 's/^RUNDIR=//')"

  # Create EXCLUDED scratch changes ...
  printf 'PNGDATA-should-be-excluded\n' > "$repo/diagram.png"
  mkdir -p "$repo/.claude/context"
  printf 'CONTEXTNOTE-should-be-excluded\n' > "$repo/.claude/context/foo.md"
  # ... and INCLUDED real-surface changes
  mkdir -p "$repo/.docker"
  printf 'DOCKERCOMPOSE-should-be-included\n' > "$repo/.docker/docker-compose.yml"
  mkdir -p "$repo/.claude/skills"
  printf 'SKILLSCRIPT-should-be-included\n' > "$repo/.claude/skills/x.sh"

  ( cd "$repo" && STUB_MODE=approve bash "$WRAPPER" phase-review P1 ) > "$SANDBOX/pr.txt" 2>"$SANDBOX/pr.err"
  packet="$STUB_STDIN_DUMP"

  # GUARD: the packet must actually exist and be non-empty, otherwise the
  # "EXCLUDED" assertions below would false-green on a missing file.
  if [ ! -s "$packet" ]; then
    fail "scratch: packet was never produced (stub stdin dump empty/missing) :: $(cat "$SANDBOX/pr.err")"
    return
  fi

  if grep -q 'PNGDATA-should-be-excluded' "$packet"; then
    fail "scratch: .png content leaked into packet"
  else
    pass "scratch: .png EXCLUDED from packet"
  fi
  if grep -q 'CONTEXTNOTE-should-be-excluded' "$packet"; then
    fail "scratch: .claude/context/ content leaked into packet"
  else
    pass "scratch: .claude/context/ EXCLUDED from packet"
  fi
  if grep -q 'DOCKERCOMPOSE-should-be-included' "$packet"; then
    pass "scratch: .docker/ INCLUDED in packet"
  else
    fail "scratch: .docker/ wrongly excluded from packet"
  fi
  if grep -q 'SKILLSCRIPT-should-be-included' "$packet"; then
    pass "scratch: .claude/skills/ INCLUDED in packet"
  else
    fail "scratch: .claude/skills/ wrongly excluded from packet"
  fi
}

#############################################################################
# TEST 5 — read-only: git status unchanged; outputs under run dir; no new
#          files in the repo.
#############################################################################
run_test_5() {
  local repo before after runDir new_in_repo
  repo="$(make_repo)"
  printf 'seed\n' > "$repo/seed.txt"
  git -C "$repo" add seed.txt
  git -C "$repo" commit -qm init
  # make it dirty (tracked-dirty + untracked source)
  printf 'seed\nchange\n' > "$repo/seed.txt"
  printf 'console.log(1)\n' > "$repo/extra.js"

  # snapshot the FULL repo file listing before
  local before_files after_files
  before_files="$(cd "$repo" && find . -type f | LC_ALL=C sort)"
  before="$(git -C "$repo" status --porcelain)"

  ( cd "$repo" && bash "$WRAPPER" phase-start P1 ) > "$SANDBOX/ps.txt" 2>"$SANDBOX/ps.err"
  runDir="$(grep -E '^RUNDIR=' "$SANDBOX/ps.txt" | head -1 | sed 's/^RUNDIR=//')"
  ( cd "$repo" && STUB_MODE=approve bash "$WRAPPER" phase-review P1 ) > "$SANDBOX/pr.txt" 2>"$SANDBOX/pr.err"

  # GUARD: a status line must have been produced, otherwise the read-only
  # assertions below would false-green on a wrapper that never executed.
  if [ -z "$(last_json_line "$SANDBOX/pr.txt")" ]; then
    fail "read-only: phase-review produced no status (wrapper did not run) :: $(cat "$SANDBOX/pr.err")"
    return
  fi

  after="$(git -C "$repo" status --porcelain)"
  after_files="$(cd "$repo" && find . -type f | LC_ALL=C sort)"

  if [ "$before" = "$after" ]; then
    pass "read-only: git status --porcelain byte-identical before/after"
  else
    fail "read-only: git status changed!\n--- before ---\n$before\n--- after ---\n$after"
  fi
  if [ "$before_files" = "$after_files" ]; then
    pass "read-only: NO new files appeared in the target repo"
  else
    fail "read-only: file listing changed in repo:\n$(diff <(printf '%s' "$before_files") <(printf '%s' "$after_files"))"
  fi

  # output files exist UNDER the run dir
  local ok=0
  [ -f "$runDir/round-1-verdict.json" ] || ok=1
  [ -f "$runDir/round-1.jsonl" ] || ok=1
  [ -f "$runDir/round-1.stderr" ] || ok=1
  check "read-only: round-1 verdict/jsonl/stderr exist under run dir" "$ok"

  # run dir must be OUTSIDE the repo
  case "$runDir" in
    "$repo"/*) fail "run dir is INSIDE the repo: $runDir" ;;
    *)         pass "run dir is outside the repo ($CODEX_GATE_RUNS/...)" ;;
  esac
}

#############################################################################
# TEST 6 — stub invoked with ABSOLUTE -o and --output-schema paths
#############################################################################
run_test_6() {
  local repo o_val schema_val
  repo="$(make_repo)"
  printf 'seed\n' > "$repo/seed.txt"
  git -C "$repo" add seed.txt && git -C "$repo" commit -qm init
  printf 'x\n' > "$repo/d.js"

  reset_argv_log
  ( cd "$repo" && STUB_MODE=approve bash "$WRAPPER" phase-start P1 ) >/dev/null 2>&1
  ( cd "$repo" && STUB_MODE=approve bash "$WRAPPER" phase-review P1 ) >/dev/null 2>&1

  # extract the value following -o and following --output-schema from argv log
  o_val="$(awk 'prev=="-o"{print; exit} {prev=$0}' "$STUB_ARGV_LOG")"
  schema_val="$(awk 'prev=="--output-schema"{print; exit} {prev=$0}' "$STUB_ARGV_LOG")"

  case "$o_val" in
    /*) pass "codex received ABSOLUTE -o path ($o_val)" ;;
    *)  fail "codex -o path not absolute: '$o_val'" ;;
  esac
  case "$schema_val" in
    /*) pass "codex received ABSOLUTE --output-schema path ($schema_val)" ;;
    *)  fail "codex --output-schema path not absolute: '$schema_val'" ;;
  esac
  # -o must live under the run dir (i.e. under CODEX_GATE_RUNS)
  case "$o_val" in
    "$CODEX_GATE_RUNS"/*) pass "codex -o path is under the run dir" ;;
    *) fail "codex -o path not under run dir: '$o_val'" ;;
  esac
}

#############################################################################
# TEST 7 — fail-closed on inconsistent verdicts [FIX 4]
#   (a) verdict=approve WITH a non-empty blockers[]  -> outcome BLOCK
#   (b) verdict=request_changes with ZERO blockers    -> outcome INFRA_ERROR
#############################################################################
run_test_7() {
  # (a) approve + blockers -> BLOCK (fail closed; .verdict field is ignored when blockers>0)
  test_outcome approve_with_blockers  BLOCK       '.blockers>=1'
  # (b) request_changes + 0 blockers -> INFRA_ERROR (degenerate, surfaced)
  test_outcome reqchanges_no_blockers INFRA_ERROR ''
}

#############################################################################
# TEST 8 — plan in a git repo runs at CODE tier [FIX 1]
#   Assert the stub was invoked WITHOUT --disable shell_tool and WITHOUT
#   --skip-git-repo-check (i.e. code tier, not doc tier), with cwd = repo root.
#############################################################################
run_test_8() {
  local repo repo_phys planfile argv cwd
  repo="$(make_repo)"
  repo_phys="$(cd "$repo" && pwd -P)"   # wrapper cd's to the physical repo root
  printf 'seed\n' > "$repo/seed.txt"
  git -C "$repo" add seed.txt && git -C "$repo" commit -qm init
  # also create a repo-root AGENTS.md so the in-repo manifest has something to emit
  printf 'repo-root-agents\n' > "$repo/AGENTS.md"
  git -C "$repo" add AGENTS.md && git -C "$repo" commit -qm agents

  planfile="$SANDBOX/myplan.md"
  printf '# A plan\n\nDo the thing.\n' > "$planfile"

  reset_argv_log
  reset_cwd_log
  ( cd "$repo" && STUB_MODE=approve bash "$WRAPPER" plan "$planfile" ) > "$SANDBOX/out.txt" 2>"$SANDBOX/err.txt"

  argv="$(cat "$STUB_ARGV_LOG")"
  cwd="$(head -1 "$STUB_CWD_LOG")"

  if printf '%s' "$argv" | grep -q -- '--disable'; then
    fail "plan-in-repo: code tier expected but '--disable shell_tool' present (doc tier) :: $argv"
  else
    pass "plan-in-repo: NO '--disable shell_tool' (code tier)"
  fi
  if printf '%s' "$argv" | grep -q -- '--skip-git-repo-check'; then
    fail "plan-in-repo: code tier expected but '--skip-git-repo-check' present (doc tier)"
  else
    pass "plan-in-repo: NO '--skip-git-repo-check' (code tier)"
  fi
  # code tier always passes `-c approval_policy="never"`; bash stores the value
  # element as the bare word approval_policy=never (the literal quotes are shell
  # syntax, stripped before exec), so match that exact stored arg.
  if printf '%s' "$argv" | grep -q 'approval_policy=never'; then
    pass "plan-in-repo: code tier passes approval_policy=never"
  else
    fail "plan-in-repo: missing approval_policy=never (not code tier) :: $argv"
  fi
  # cwd must be the repo root (physical path)
  if [ "$cwd" = "$repo_phys" ]; then
    pass "plan-in-repo: codex cwd = repo root"
  else
    fail "plan-in-repo: codex cwd '$cwd' != repo root '$repo_phys'"
  fi
  # the plan text must still reach the packet (stdin)
  if grep -q 'Do the thing.' "$STUB_STDIN_DUMP"; then
    pass "plan-in-repo: plan text present in packet"
  else
    fail "plan-in-repo: plan text missing from packet"
  fi
}

#############################################################################
# TEST 9 — manifest walks ANCESTOR dirs [FIX 5]
#   projects/api/AGENTS.md must be listed for a change to
#   projects/api/services/foo.js (not just the file's exact dirname).
#############################################################################
run_test_9() {
  local repo repo_phys runDir packet
  repo="$(make_repo)"
  # The wrapper resolves REPO_ROOT via `git rev-parse --show-toplevel`, which
  # returns the PHYSICAL path (macOS $TMPDIR is /var/folders -> /private/var/...).
  # Compare against that physical path, not the symlinked temp path.
  repo_phys="$(cd "$repo" && pwd -P)"
  mkdir -p "$repo/projects/api/services"
  printf 'seed\n' > "$repo/seed.txt"
  printf 'api-agents\n' > "$repo/projects/api/AGENTS.md"
  printf 'orig\n' > "$repo/projects/api/services/foo.js"
  git -C "$repo" add . && git -C "$repo" commit -qm init

  ( cd "$repo" && bash "$WRAPPER" phase-start P1 ) > "$SANDBOX/ps.txt" 2>"$SANDBOX/ps.err"
  runDir="$(grep -E '^RUNDIR=' "$SANDBOX/ps.txt" | head -1 | sed 's/^RUNDIR=//')"

  # change the deeply-nested file
  printf 'orig\nchange\n' > "$repo/projects/api/services/foo.js"

  ( cd "$repo" && STUB_MODE=approve bash "$WRAPPER" phase-review P1 ) > "$SANDBOX/pr.txt" 2>"$SANDBOX/pr.err"
  packet="$STUB_STDIN_DUMP"

  if [ ! -s "$packet" ]; then
    fail "manifest-ancestor: packet never produced :: $(cat "$SANDBOX/pr.err")"
    return
  fi
  # the ancestor AGENTS.md (one level above the file's dir) must be in the manifest
  if grep -q "$repo_phys/projects/api/AGENTS.md" "$packet"; then
    pass "manifest-ancestor: lists projects/api/AGENTS.md for projects/api/services/foo.js"
  else
    fail "manifest-ancestor: ancestor AGENTS.md NOT listed :: manifest=$(grep -n 'AGENTS.md' "$packet" || echo none)"
  fi
}

#############################################################################
# TEST 10 — prepr unions filtered UNTRACKED source files [FIX 6]
#############################################################################
run_test_10() {
  local repo status packet
  repo="$(make_repo)"
  printf 'seed\n' > "$repo/seed.txt"
  git -C "$repo" add seed.txt && git -C "$repo" commit -qm init
  # tracked change
  printf 'seed\ntracked-change\n' > "$repo/seed.txt"
  # an UNTRACKED source file (must be unioned into the prepr diff)
  printf 'UNTRACKED-PREPR-SOURCE\n' > "$repo/brand_new.js"
  # an EXCLUDED untracked scratch file (must NOT leak)
  printf 'PREPR-PNG-EXCLUDED\n' > "$repo/pic.png"

  ( cd "$repo" && STUB_MODE=approve bash "$WRAPPER" prepr ) > "$SANDBOX/out.txt" 2>"$SANDBOX/err.txt"
  status="$(last_json_line "$SANDBOX/out.txt")"
  packet="$STUB_STDIN_DUMP"

  if [ -z "$status" ]; then
    fail "prepr-untracked: no status JSON :: $(cat "$SANDBOX/err.txt")"
    return
  fi
  if grep -q 'UNTRACKED-PREPR-SOURCE' "$packet"; then
    pass "prepr-untracked: untracked source file content present in packet"
  else
    fail "prepr-untracked: untracked source file NOT in packet"
  fi
  if grep -q 'brand_new.js' "$packet"; then
    pass "prepr-untracked: untracked source file named in packet diff"
  else
    fail "prepr-untracked: untracked source file name NOT in packet"
  fi
  if grep -q 'PREPR-PNG-EXCLUDED' "$packet"; then
    fail "prepr-untracked: excluded .png untracked leaked into packet"
  else
    pass "prepr-untracked: excluded .png untracked stays out of packet"
  fi
}

#############################################################################
# TEST 11 — phase-review includes <RUN_DIR>/context.md when present [FIX 3]
#############################################################################
run_test_11() {
  local repo runDir packet
  repo="$(make_repo)"
  printf 'seed\n' > "$repo/seed.txt"
  git -C "$repo" add seed.txt && git -C "$repo" commit -qm init

  ( cd "$repo" && bash "$WRAPPER" phase-start P1 ) > "$SANDBOX/ps.txt" 2>"$SANDBOX/ps.err"
  runDir="$(grep -E '^RUNDIR=' "$SANDBOX/ps.txt" | head -1 | sed 's/^RUNDIR=//')"
  if [ -z "$runDir" ]; then
    fail "context.md: phase-start did not print RUNDIR= :: $(cat "$SANDBOX/ps.err")"
    return
  fi

  # write the phase intent/acceptance/review context the loop driver would author
  printf 'PHASE-GOAL: wire the widget\nACCEPTANCE: widget renders\nIMPLEMENTER-REPORT: done\nCLAUDE-SPEC-REVIEW: passed\nCLAUDE-QUALITY-REVIEW: passed\nCONTEXT-SENTINEL-XYZZY\n' > "$runDir/context.md"

  # make a change so there's something to review
  printf 'seed\nchange\n' > "$repo/seed.txt"

  ( cd "$repo" && STUB_MODE=approve bash "$WRAPPER" phase-review P1 ) > "$SANDBOX/pr.txt" 2>"$SANDBOX/pr.err"
  packet="$STUB_STDIN_DUMP"

  if [ ! -s "$packet" ]; then
    fail "context.md: packet never produced :: $(cat "$SANDBOX/pr.err")"
    return
  fi
  if grep -q 'CONTEXT-SENTINEL-XYZZY' "$packet"; then
    pass "context.md: phase-review packet includes context.md contents"
  else
    fail "context.md: context.md contents NOT in packet"
  fi
  if grep -q 'PHASE INTENT / ACCEPTANCE / REVIEW CONTEXT' "$packet"; then
    pass "context.md: packet has the PHASE INTENT/ACCEPTANCE/REVIEW CONTEXT section header"
  else
    fail "context.md: section header missing from packet"
  fi
}

#############################################################################
# TEST 12 — phase-review WITHOUT context.md still works (no regression) [FIX 3]
#############################################################################
run_test_12() {
  local repo status
  repo="$(make_repo)"
  printf 'seed\n' > "$repo/seed.txt"
  git -C "$repo" add seed.txt && git -C "$repo" commit -qm init
  ( cd "$repo" && bash "$WRAPPER" phase-start P1 ) > "$SANDBOX/ps.txt" 2>"$SANDBOX/ps.err"
  printf 'seed\nchange\n' > "$repo/seed.txt"
  ( cd "$repo" && STUB_MODE=approve bash "$WRAPPER" phase-review P1 ) > "$SANDBOX/pr.txt" 2>"$SANDBOX/pr.err"
  status="$(last_json_line "$SANDBOX/pr.txt")"
  if [ "$(printf '%s' "$status" | jq -r '.outcome // empty' 2>/dev/null)" = "APPROVE" ]; then
    pass "context.md-absent: phase-review still APPROVEs with no context.md"
  else
    fail "context.md-absent: phase-review broke without context.md :: $status :: $(cat "$SANDBOX/pr.err")"
  fi
}

# test_13 (hook-arming integration, [FIX 7]) removed from the portable suite — it depends on
# owner-installed ~/.claude/hooks infrastructure and lives with that hook, not the plugin.

#############################################################################
# TEST 14 — bundle manifest uses REPO-ROOT-relative paths (ancestor walk) [FIX 5b]
#   bundle <dir> must list AGENTS.md in the bundle dir (+ ancestors), not miss them
#   by feeding build_manifest paths relative to the bundle dir instead of $REPO_ROOT.
#############################################################################
run_test_14() {
  local repo repo_phys packet
  repo="$(make_repo)"
  repo_phys="$(cd "$repo" && pwd -P)"
  mkdir -p "$repo/docs/pdr"
  printf 'pdr-agents\n' > "$repo/docs/pdr/AGENTS.md"
  printf '# plan\n' > "$repo/docs/pdr/plan.md"
  git -C "$repo" add . && git -C "$repo" commit -qm init

  ( cd "$repo" && STUB_MODE=approve bash "$WRAPPER" bundle docs/pdr ) > "$SANDBOX/b.txt" 2>"$SANDBOX/b.err"
  packet="$STUB_STDIN_DUMP"
  if [ ! -s "$packet" ]; then
    fail "bundle-manifest: packet never produced :: $(cat "$SANDBOX/b.err")"
    return
  fi
  if grep -q "$repo_phys/docs/pdr/AGENTS.md" "$packet"; then
    pass "bundle-manifest: lists docs/pdr/AGENTS.md for bundle docs/pdr"
  else
    fail "bundle-manifest: bundle-dir AGENTS.md NOT listed :: manifest=$(grep -n 'AGENTS.md' "$packet" || echo none)"
  fi
}

#############################################################################
# TEST 15 — question <file> grounds a decision (GROUNDED outcome) [QUESTION MODE]
#   In a temp git repo with STUB_MODE=grounded:
#     - status outcome == "GROUNDED", settledByCanon == false, recommendation non-empty
#     - the packet (stdin) contains BOTH the decision file's text AND the
#       question-instructions persona ("senior architecture advisor grounding a DECISION")
#     - the packet has the DECISION TO GROUND section header
#############################################################################
run_test_15() {
  local repo qfile status outcome packet
  repo="$(make_repo)"
  printf 'seed\n' > "$repo/seed.txt"
  git -C "$repo" add seed.txt && git -C "$repo" commit -qm init

  qfile="$SANDBOX/decision.md"
  printf 'DECISION: how do we persist run events?\n\nCONTEXT: high write volume.\n\nOPTIONS:\n- Option A: a dedicated append-only table\n- Option B: reuse the existing jobs table\n\nQUESTION-SENTINEL-PERSIST-EVENTS\n' > "$qfile"

  ( cd "$repo" && STUB_MODE=grounded bash "$WRAPPER" question "$qfile" ) > "$SANDBOX/q.txt" 2>"$SANDBOX/q.err"
  status="$(last_json_line "$SANDBOX/q.txt")"
  packet="$STUB_STDIN_DUMP"

  if [ -z "$status" ]; then
    fail "question-grounded: no status JSON :: $(cat "$SANDBOX/q.txt") :: $(cat "$SANDBOX/q.err")"
    return
  fi
  outcome="$(printf '%s' "$status" | jq -r '.outcome // empty' 2>/dev/null)"
  if [ "$outcome" = "GROUNDED" ]; then
    pass "question-grounded: outcome == GROUNDED"
  else
    fail "question-grounded: expected GROUNDED got '$outcome' :: $status :: $(cat "$SANDBOX/q.err")"
  fi
  if printf '%s' "$status" | jq -e '.settledByCanon == false' >/dev/null 2>&1; then
    pass "question-grounded: settledByCanon == false"
  else
    fail "question-grounded: settledByCanon not false :: $status"
  fi
  if [ -n "$(printf '%s' "$status" | jq -r '.recommendation // ""' 2>/dev/null)" ]; then
    pass "question-grounded: recommendation is non-empty"
  else
    fail "question-grounded: recommendation empty :: $status"
  fi
  # status.summary must be the grounding rationale
  if [ -n "$(printf '%s' "$status" | jq -r '.summary // ""' 2>/dev/null)" ]; then
    pass "question-grounded: summary (rationale) is non-empty"
  else
    fail "question-grounded: summary empty :: $status"
  fi
  # packet must carry the decision file text
  if grep -q 'QUESTION-SENTINEL-PERSIST-EVENTS' "$packet"; then
    pass "question-grounded: packet includes the decision file text"
  else
    fail "question-grounded: decision file text NOT in packet"
  fi
  # packet must carry the question-grounding persona (NOT the reviewer persona)
  if grep -q 'senior architecture advisor grounding a DECISION' "$packet"; then
    pass "question-grounded: packet includes the question-instructions persona"
  else
    fail "question-grounded: question-instructions persona NOT in packet"
  fi
  # packet must have the DECISION TO GROUND section header
  if grep -q 'DECISION TO GROUND' "$packet"; then
    pass "question-grounded: packet has the DECISION TO GROUND section header"
  else
    fail "question-grounded: DECISION TO GROUND header missing from packet"
  fi
}

#############################################################################
# TEST 16 — question settled-by-canon path [QUESTION MODE]
#   STUB_MODE=grounded_settled -> status settledByCanon == true and canonAnswer non-empty.
#############################################################################
run_test_16() {
  local repo qfile status
  repo="$(make_repo)"
  printf 'seed\n' > "$repo/seed.txt"
  git -C "$repo" add seed.txt && git -C "$repo" commit -qm init

  qfile="$SANDBOX/decision2.md"
  printf 'DECISION: where do run events go?\n\nOPTIONS:\n- Option A: dedicated table\n' > "$qfile"

  ( cd "$repo" && STUB_MODE=grounded_settled bash "$WRAPPER" question "$qfile" ) > "$SANDBOX/q.txt" 2>"$SANDBOX/q.err"
  status="$(last_json_line "$SANDBOX/q.txt")"
  if [ -z "$status" ]; then
    fail "question-settled: no status JSON :: $(cat "$SANDBOX/q.err")"
    return
  fi
  # still GROUNDED outcome (the wrapper grounds regardless; canon-settled is a field)
  if [ "$(printf '%s' "$status" | jq -r '.outcome // empty' 2>/dev/null)" = "GROUNDED" ]; then
    pass "question-settled: outcome == GROUNDED"
  else
    fail "question-settled: outcome != GROUNDED :: $status"
  fi
  if printf '%s' "$status" | jq -e '.settledByCanon == true' >/dev/null 2>&1; then
    pass "question-settled: settledByCanon == true"
  else
    fail "question-settled: settledByCanon not true :: $status"
  fi
  # canonAnswer must be non-empty in the verdict file
  local verdictPath canonAnswer
  verdictPath="$(printf '%s' "$status" | jq -r '.verdictPath // empty' 2>/dev/null)"
  if [ -n "$verdictPath" ] && [ -f "$verdictPath" ]; then
    canonAnswer="$(jq -r '.canonAnswer // ""' "$verdictPath" 2>/dev/null)"
    if [ -n "$canonAnswer" ]; then
      pass "question-settled: canonAnswer is non-empty"
    else
      fail "question-settled: canonAnswer empty :: $(cat "$verdictPath")"
    fi
  else
    fail "question-settled: verdictPath missing or not a file :: $status"
  fi
}

#############################################################################
# TEST 17 — question mode fails closed on infra errors [QUESTION MODE]
#   nonzero codex exit and invalid-JSON -o must both -> outcome INFRA_ERROR.
#############################################################################
run_test_17() {
  local repo qfile status
  repo="$(make_repo)"
  printf 'seed\n' > "$repo/seed.txt"
  git -C "$repo" add seed.txt && git -C "$repo" commit -qm init
  qfile="$SANDBOX/decision3.md"
  printf 'DECISION: x?\n\nOPTIONS:\n- Option A\n- Option B\n' > "$qfile"

  # (a) nonzero exit
  ( cd "$repo" && STUB_MODE=nonzero bash "$WRAPPER" question "$qfile" ) > "$SANDBOX/q.txt" 2>"$SANDBOX/q.err"
  status="$(last_json_line "$SANDBOX/q.txt")"
  if [ "$(printf '%s' "$status" | jq -r '.outcome // empty' 2>/dev/null)" = "INFRA_ERROR" ]; then
    pass "question-infra: nonzero codex exit -> INFRA_ERROR"
  else
    fail "question-infra: nonzero did not yield INFRA_ERROR :: $status"
  fi

  # (b) invalid JSON in the -o file
  ( cd "$repo" && STUB_MODE=invalidjson bash "$WRAPPER" question "$qfile" ) > "$SANDBOX/q.txt" 2>"$SANDBOX/q.err"
  status="$(last_json_line "$SANDBOX/q.txt")"
  if [ "$(printf '%s' "$status" | jq -r '.outcome // empty' 2>/dev/null)" = "INFRA_ERROR" ]; then
    pass "question-infra: invalid-JSON -o -> INFRA_ERROR"
  else
    fail "question-infra: invalid-JSON did not yield INFRA_ERROR :: $status"
  fi

  # (c) missing/empty file argument errors out (not a grounding)
  ( cd "$repo" && STUB_MODE=grounded bash "$WRAPPER" question "$SANDBOX/does-not-exist.md" ) > "$SANDBOX/q.txt" 2>"$SANDBOX/q.err"
  status="$(last_json_line "$SANDBOX/q.txt")"
  # the wrapper exits nonzero with an error message (no JSON status) for a missing file
  if [ -z "$status" ] && grep -qi 'not' "$SANDBOX/q.err"; then
    pass "question-infra: missing decision file errors out (no grounding)"
  else
    fail "question-infra: missing file did not error cleanly :: status=$status :: err=$(cat "$SANDBOX/q.err")"
  fi
}

#############################################################################
# TEST 18 — question runs at CODE tier in a repo + uses question.schema.json [QUESTION MODE]
#   Stub invoked WITHOUT --disable shell_tool / --skip-git-repo-check (code tier),
#   with --output-schema pointing at question.schema.json (NOT verdict.schema.json),
#   cwd = repo root.
#############################################################################
run_test_18() {
  local repo repo_phys qfile argv cwd schema_val
  repo="$(make_repo)"
  repo_phys="$(cd "$repo" && pwd -P)"
  printf 'seed\n' > "$repo/seed.txt"
  git -C "$repo" add seed.txt && git -C "$repo" commit -qm init
  printf 'repo-root-agents\n' > "$repo/AGENTS.md"
  git -C "$repo" add AGENTS.md && git -C "$repo" commit -qm agents

  qfile="$SANDBOX/decision4.md"
  printf 'DECISION: y?\n\nOPTIONS:\n- Option A\n- Option B\n' > "$qfile"

  reset_argv_log
  reset_cwd_log
  ( cd "$repo" && STUB_MODE=grounded bash "$WRAPPER" question "$qfile" ) > "$SANDBOX/q.txt" 2>"$SANDBOX/q.err"
  argv="$(cat "$STUB_ARGV_LOG")"
  cwd="$(head -1 "$STUB_CWD_LOG")"

  if printf '%s' "$argv" | grep -q -- '--disable'; then
    fail "question-codetier: code tier expected but '--disable shell_tool' present (doc tier) :: $argv"
  else
    pass "question-codetier: NO '--disable shell_tool' (code tier)"
  fi
  if printf '%s' "$argv" | grep -q -- '--skip-git-repo-check'; then
    fail "question-codetier: code tier expected but '--skip-git-repo-check' present (doc tier)"
  else
    pass "question-codetier: NO '--skip-git-repo-check' (code tier)"
  fi
  if printf '%s' "$argv" | grep -q 'approval_policy=never'; then
    pass "question-codetier: code tier passes approval_policy=never"
  else
    fail "question-codetier: missing approval_policy=never (not code tier) :: $argv"
  fi
  # the --output-schema must point at question.schema.json (NOT verdict.schema.json)
  schema_val="$(awk 'prev=="--output-schema"{print; exit} {prev=$0}' "$STUB_ARGV_LOG")"
  case "$schema_val" in
    */question.schema.json) pass "question-codetier: --output-schema is question.schema.json ($schema_val)" ;;
    *) fail "question-codetier: --output-schema not question.schema.json: '$schema_val'" ;;
  esac
  case "$schema_val" in
    /*) pass "question-codetier: --output-schema path is absolute" ;;
    *)  fail "question-codetier: --output-schema path not absolute: '$schema_val'" ;;
  esac
  # cwd must be the repo root (physical path) — code tier
  if [ "$cwd" = "$repo_phys" ]; then
    pass "question-codetier: codex cwd = repo root"
  else
    fail "question-codetier: codex cwd '$cwd' != repo root '$repo_phys'"
  fi
}

#############################################################################
# TEST 19 — question is read-only: git status --porcelain unchanged [QUESTION MODE]
#############################################################################
run_test_19() {
  local repo before after qfile status
  repo="$(make_repo)"
  printf 'seed\n' > "$repo/seed.txt"
  git -C "$repo" add seed.txt && git -C "$repo" commit -qm init
  # make it dirty so there is a non-empty porcelain to preserve
  printf 'seed\nchange\n' > "$repo/seed.txt"
  printf 'console.log(1)\n' > "$repo/extra.js"

  qfile="$SANDBOX/decision5.md"
  printf 'DECISION: z?\n\nOPTIONS:\n- Option A\n- Option B\n' > "$qfile"

  before="$(git -C "$repo" status --porcelain)"
  ( cd "$repo" && STUB_MODE=grounded bash "$WRAPPER" question "$qfile" ) > "$SANDBOX/q.txt" 2>"$SANDBOX/q.err"
  status="$(last_json_line "$SANDBOX/q.txt")"
  if [ -z "$status" ]; then
    fail "question-readonly: produced no status (wrapper did not run) :: $(cat "$SANDBOX/q.err")"
    return
  fi
  after="$(git -C "$repo" status --porcelain)"
  if [ "$before" = "$after" ]; then
    pass "question-readonly: git status --porcelain byte-identical before/after"
  else
    fail "question-readonly: git status changed!\n--- before ---\n$before\n--- after ---\n$after"
  fi
}

#############################################################################
# TEST 20 — model/effort defaults + fast-mode dial [FAST/EFFORT]
#   Default (no env set): -m gpt-6-astra + model_reasoning_effort="xhigh", and
#   fast mode OFF (fast flags absent — fast is now opt-in, not enforced).
#   Negative invariant: the default argv must NEVER carry the OLD
#   model_reasoning_effort="ultra" value — this protects against silently
#   reverting to a natively-delegating tier, independent of which non-delegating
#   tier ends up chosen. CODEX_GATE_FAST=1: fast flags appear AND gpt-6-astra/
#   xhigh survive (fast is a speed knob, not a quality knob).
#############################################################################
run_test_20() {
  local repo qfile argv_default argv_fast1 model_val
  repo="$(make_repo)"
  printf 'seed\n' > "$repo/seed.txt"
  git -C "$repo" add seed.txt && git -C "$repo" commit -qm init
  qfile="$SANDBOX/decision_fast.md"
  printf 'DECISION: x?\n\nOPTIONS:\n- Option A\n- Option B\n' > "$qfile"

  # default (no env set): -m gpt-6-astra + model_reasoning_effort="xhigh"
  reset_argv_log
  ( cd "$repo" && hermetic STUB_MODE=grounded bash "$WRAPPER" question "$qfile" ) > "$SANDBOX/f_def.txt" 2>"$SANDBOX/f_def.err"
  argv_default="$(cat "$STUB_ARGV_LOG")"
  model_val="$(awk 'prev=="-m"{print; exit} {prev=$0}' "$STUB_ARGV_LOG")"
  if [ "$model_val" = "gpt-6-astra" ] && printf '%s' "$argv_default" | grep -q 'model_reasoning_effort="xhigh"'; then
    pass 'defaults: no-env argv carries -m gpt-6-astra + model_reasoning_effort="xhigh"'
  else
    fail "defaults: no-env argv expected -m gpt-6-astra + model_reasoning_effort=\"xhigh\", got -m '$model_val' :: $argv_default"
  fi

  # negative invariant: default argv must NOT carry the OLD ultra effort value
  # (holds regardless of which non-delegating tier ends up chosen)
  if printf '%s' "$argv_default" | grep -q 'model_reasoning_effort="ultra"'; then
    fail "defaults: no-env argv still carries the OLD model_reasoning_effort=\"ultra\" :: $argv_default"
  else
    pass 'defaults: no-env argv does NOT carry model_reasoning_effort="ultra"'
  fi

  # default fast is OFF: fast flags absent
  if printf '%s' "$argv_default" | grep -q 'fast_mode' || printf '%s' "$argv_default" | grep -q 'service_tier="fast"'; then
    fail "fast-mode: default (no env) still passed fast flags :: $argv_default"
  else
    pass "fast-mode: default (no env) omits fast flags (fast is opt-in, not enforced)"
  fi

  # CODEX_GATE_FAST=1: fast flags present AND fast is not a quality knob
  reset_argv_log
  ( cd "$repo" && hermetic CODEX_GATE_FAST=1 STUB_MODE=grounded bash "$WRAPPER" question "$qfile" ) > "$SANDBOX/f1.txt" 2>"$SANDBOX/f1.err"
  argv_fast1="$(cat "$STUB_ARGV_LOG")"
  if printf '%s' "$argv_fast1" | grep -q 'fast_mode' && printf '%s' "$argv_fast1" | grep -q 'service_tier="fast"'; then
    pass 'fast-mode: CODEX_GATE_FAST=1 passes --enable fast_mode + service_tier="fast"'
  else
    fail "fast-mode: CODEX_GATE_FAST=1 did NOT pass fast flags :: $argv_fast1"
  fi
  if printf '%s' "$argv_fast1" | grep -q 'gpt-6-astra' && printf '%s' "$argv_fast1" | grep -q 'model_reasoning_effort="xhigh"'; then
    pass "fast-mode: gpt-6-astra model + xhigh reasoning effort preserved under fast mode (fast is not a quality knob)"
  else
    fail "fast-mode: model/reasoning defaults NOT preserved under fast mode :: $argv_fast1"
  fi
}

#############################################################################
# TEST 20b — empty-vs-unset CODEX_GATE_MODEL contract [MODEL]
#   The production declaration is "${VAR-default}" -- WITHOUT the colon. That
#   operator is the whole point: ":-" treats empty like unset, "-" does not, so
#   only "-" lets an explicitly empty value stand as a real override.
#   CODEX_GATE_MODEL unset -> "${VAR-default}" resolves to gpt-6-astra -> -m
#   IS present. CODEX_GATE_MODEL="" (explicitly empty) -> the wrapper's
#   `[ -n "$CODEX_GATE_MODEL" ]` guard must treat empty as "no override" and
#   omit -m entirely (falls through to Codex's own default). The two states
#   must be distinguishable, not both silently resolving to gpt-6-astra.
#############################################################################
run_test_20b() {
  local repo qfile argv_empty model_val
  repo="$(make_repo)"
  printf 'seed\n' > "$repo/seed.txt"
  git -C "$repo" add seed.txt && git -C "$repo" commit -qm init
  qfile="$SANDBOX/decision_model.md"
  printf 'DECISION: y?\n\nOPTIONS:\n- Option A\n- Option B\n' > "$qfile"

  # unset -> -m gpt-6-astra
  reset_argv_log
  ( cd "$repo" && hermetic STUB_MODE=grounded bash "$WRAPPER" question "$qfile" ) > "$SANDBOX/m_unset.txt" 2>"$SANDBOX/m_unset.err"
  model_val="$(awk 'prev=="-m"{print; exit} {prev=$0}' "$STUB_ARGV_LOG")"
  if [ "$model_val" = "gpt-6-astra" ]; then
    pass "model-contract: CODEX_GATE_MODEL unset -> -m gpt-6-astra"
  else
    fail "model-contract: CODEX_GATE_MODEL unset -> expected -m gpt-6-astra, got -m '$model_val' :: $(cat "$STUB_ARGV_LOG")"
  fi

  # explicitly empty -> NO -m flag at all (distinct from unset)
  reset_argv_log
  ( cd "$repo" && hermetic CODEX_GATE_MODEL="" STUB_MODE=grounded bash "$WRAPPER" question "$qfile" ) > "$SANDBOX/m_empty.txt" 2>"$SANDBOX/m_empty.err"
  argv_empty="$(cat "$STUB_ARGV_LOG")"
  if printf '%s\n' "$argv_empty" | grep -qx -- '-m'; then
    fail "model-contract: CODEX_GATE_MODEL=\"\" still emitted -m (empty treated as unset) :: $argv_empty"
  else
    pass 'model-contract: CODEX_GATE_MODEL="" omits -m entirely (falls through to Codex default)'
  fi
  # ...and the CALL STILL HAPPENED. "-m is absent" is satisfied vacuously by an argv log
  # that is empty because Codex was never invoked at all, so the absence assertion above
  # cannot tell "omitted the flag" from "dropped the review". Mutation-proven: an early
  # `if [ -z "$CODEX_GATE_MODEL" ]; then return 0; fi` in run_codex — the empty-model hatch
  # "optimized" into skipping the review — left the ENTIRE suite green at PASS=316 FAIL=0.
  # The argv assertion is the load-bearing one (it observes the invocation itself); the
  # outcome assertion after it pins that the round still completes end to end.
  if printf '%s\n' "$argv_empty" | grep -qx -- 'exec' \
     && printf '%s\n' "$argv_empty" | grep -qx -- '--output-schema'; then
    pass 'model-contract: CODEX_GATE_MODEL="" still INVOKES codex (exec + --output-schema reached the stub) — the flag is omitted, the call is not'
  else
    fail "model-contract: CODEX_GATE_MODEL=\"\" produced no codex invocation at all :: argv='$argv_empty'"
  fi
  if printf '%s' "$(last_json_line "$SANDBOX/m_empty.txt")" | jq -e '.outcome=="GROUNDED"' >/dev/null 2>&1; then
    pass 'model-contract: CODEX_GATE_MODEL="" still produces a real GROUNDED result (the omitted -m did not break the round)'
  else
    fail "model-contract: CODEX_GATE_MODEL=\"\" did not produce a GROUNDED result :: $(last_json_line "$SANDBOX/m_empty.txt") :: $(cat "$SANDBOX/m_empty.err")"
  fi
}

#############################################################################
# TEST 21 — runtime OVERFLOW classification [TIER 1]
#   STUB_MODE=overflow -> codex exits nonzero AND the round JSONL carries the
#   context-window turn.failed signature -> outcome OVERFLOW (distinct from
#   INFRA_ERROR).
#############################################################################
run_test_21() {
  test_outcome overflow OVERFLOW '.outcome=="OVERFLOW"'
}

#############################################################################
# TEST 22 — lean code-tier packet [TIER 1]
#   In a phase, touch a BIG file (>CODEX_GATE_INLINE_MAX_LINES) and a SMALL file
#   (<= the cap). The phase-review packet must:
#     (a) list BOTH files in the TOUCHED FILES (diffstat) section with line counts,
#     (b) NOT inline the big file's body (a sentinel line deep in the big file is
#         ABSENT) but emit the "inspect via read-only shell" note for it,
#     (c) DOES inline the small file's body (its sentinel IS present),
#     (d) still contains the diff hunks for the change.
#############################################################################
run_test_22() {
  local repo runDir packet i
  repo="$(make_repo)"
  printf 'seed\n' > "$repo/seed.txt"
  # BIG file: > 120 lines (default CODEX_GATE_INLINE_MAX_LINES). COMMIT it first
  # with a unique sentinel DEEP inside (line ~150) so the phase produces a small
  # hunk (not a whole-file +dump): then "sentinel absent from packet" cleanly
  # means "body not inlined" without colliding with hunks-never-dropped.
  {
    for i in $(seq 1 149); do printf 'bigline-%s\n' "$i"; done
    printf 'BIGFILE-DEEP-SENTINEL-OMITME\n'
    for i in $(seq 151 200); do printf 'bigline-%s\n' "$i"; done
  } > "$repo/bigfile.js"
  git -C "$repo" add seed.txt bigfile.js && git -C "$repo" commit -qm init

  ( cd "$repo" && bash "$WRAPPER" phase-start P1 ) > "$SANDBOX/ps.txt" 2>"$SANDBOX/ps.err"
  runDir="$(grep -E '^RUNDIR=' "$SANDBOX/ps.txt" | head -1 | sed 's/^RUNDIR=//')"
  if [ -z "$runDir" ]; then
    fail "lean-packet: phase-start did not print RUNDIR= :: $(cat "$SANDBOX/ps.err")"
    return
  fi

  # Change ONE line at the TOP of the big file (far from the deep sentinel) so the
  # hunk does NOT carry the deep sentinel as context. The file stays > 120 lines.
  perl -0pi -e 's/^bigline-1$/BIGFILE-TOP-CHANGE/m' "$repo/bigfile.js" 2>/dev/null \
    || sed -i '' 's/^bigline-1$/BIGFILE-TOP-CHANGE/' "$repo/bigfile.js"

  # SMALL file (new, <= 120 lines), with a unique sentinel that MUST be inlined.
  printf 'small-1\nSMALLFILE-SENTINEL-KEEPME\nsmall-3\n' > "$repo/smallfile.js"

  ( cd "$repo" && STUB_MODE=approve bash "$WRAPPER" phase-review P1 ) > "$SANDBOX/pr.txt" 2>"$SANDBOX/pr.err"
  packet="$STUB_STDIN_DUMP"
  if [ ! -s "$packet" ]; then
    fail "lean-packet: packet never produced :: $(cat "$SANDBOX/pr.err")"
    return
  fi

  # (a) diffstat section lists BOTH files with line counts
  if grep -q 'TOUCHED FILES (diffstat)' "$packet"; then
    pass "lean-packet: packet has the TOUCHED FILES (diffstat) section header"
  else
    fail "lean-packet: TOUCHED FILES (diffstat) section header missing"
  fi
  if grep -Eq 'bigfile\.js[[:space:]]+\(20[0-9] lines\)' "$packet"; then
    pass "lean-packet: diffstat lists bigfile.js with its line count"
  else
    fail "lean-packet: diffstat missing bigfile.js line count :: $(grep -n 'bigfile.js' "$packet" || echo none)"
  fi
  if grep -Eq 'smallfile\.js[[:space:]]+\(3 lines\)' "$packet"; then
    pass "lean-packet: diffstat lists smallfile.js with its line count"
  else
    fail "lean-packet: diffstat missing smallfile.js line count :: $(grep -n 'smallfile.js' "$packet" || echo none)"
  fi

  # (b) big file body NOT inlined: its deep sentinel must be ABSENT (it is far from
  #     the changed hunk, so it does not appear as diff context either).
  if grep -q 'BIGFILE-DEEP-SENTINEL-OMITME' "$packet"; then
    fail "lean-packet: BIG file body was inlined (deep sentinel present) — should be omitted"
  else
    pass "lean-packet: BIG file body NOT inlined (deep sentinel absent)"
  fi
  # ... and the inspect-via-shell note must be present for it
  if grep -q 'body NOT inlined' "$packet" && grep -q 'inspect via read-only shell' "$packet"; then
    pass "lean-packet: BIG file carries the 'inspect via read-only shell' note"
  else
    fail "lean-packet: missing the 'body NOT inlined / inspect via read-only shell' note"
  fi

  # (c) small file body IS inlined: its sentinel must be PRESENT
  if grep -q 'SMALLFILE-SENTINEL-KEEPME' "$packet"; then
    pass "lean-packet: SMALL file body IS inlined (sentinel present)"
  else
    fail "lean-packet: SMALL file body was NOT inlined (sentinel absent)"
  fi

  # (d) diff hunks for the change are still present (bodies omitted != hunks dropped):
  #     the big file's TOP change appears in the diff section.
  if grep -q 'END DIFF' "$packet" && grep -q 'BIGFILE-TOP-CHANGE' "$packet"; then
    pass "lean-packet: scoped DIFF section still present (hunks not dropped)"
  else
    fail "lean-packet: DIFF section missing — hunks were dropped"
  fi
}

#############################################################################
# TEST 23 — pre-flight budget guard [TIER 1]
#   With CODEX_GATE_PACKET_BUDGET=50, the assembled packet exceeds the budget,
#   so phase-review returns outcome=OVERFLOW and the stub is NEVER invoked
#   (empty argv log; no verdict file written by the stub).
#############################################################################
run_test_23() {
  local repo runDir status outcome
  repo="$(make_repo)"
  printf 'seed\n' > "$repo/seed.txt"
  git -C "$repo" add seed.txt && git -C "$repo" commit -qm init

  ( cd "$repo" && bash "$WRAPPER" phase-start P1 ) > "$SANDBOX/ps.txt" 2>"$SANDBOX/ps.err"
  runDir="$(grep -E '^RUNDIR=' "$SANDBOX/ps.txt" | head -1 | sed 's/^RUNDIR=//')"
  if [ -z "$runDir" ]; then
    fail "budget-guard: phase-start did not print RUNDIR= :: $(cat "$SANDBOX/ps.err")"
    return
  fi

  printf 'seed\nchange\n' > "$repo/seed.txt"

  reset_argv_log
  ( cd "$repo" && CODEX_GATE_PACKET_BUDGET=50 STUB_MODE=approve bash "$WRAPPER" phase-review P1 ) > "$SANDBOX/pr.txt" 2>"$SANDBOX/pr.err"
  status="$(last_json_line "$SANDBOX/pr.txt")"
  outcome="$(printf '%s' "$status" | jq -r '.outcome // empty' 2>/dev/null)"

  if [ "$outcome" = "OVERFLOW" ]; then
    pass "budget-guard: over-budget packet -> outcome OVERFLOW"
  else
    fail "budget-guard: expected OVERFLOW got '$outcome' :: $status :: $(cat "$SANDBOX/pr.err")"
  fi
  # the stub must NOT have been invoked (no argv recorded)
  if [ -s "$STUB_ARGV_LOG" ]; then
    fail "budget-guard: stub WAS invoked over budget (argv log non-empty) :: $(cat "$STUB_ARGV_LOG")"
  else
    pass "budget-guard: stub was NEVER invoked over budget (argv log empty)"
  fi
  # and no verdict file written for this round
  if [ -f "$runDir/round-1-verdict.json" ]; then
    fail "budget-guard: a verdict file was written despite over-budget short-circuit"
  else
    pass "budget-guard: no verdict file written (codex never ran)"
  fi
}

#############################################################################
# TEST 24 — hunks never dropped even when bodies omitted [TIER 1 INVARIANT]
#   A BIG file's body is omitted, but the DIFF section header AND a changed line
#   from that big file MUST still appear in the packet.
#############################################################################
run_test_24() {
  local repo runDir packet i
  repo="$(make_repo)"
  printf 'seed\n' > "$repo/seed.txt"
  git -C "$repo" add seed.txt && git -C "$repo" commit -qm init

  # commit a BIG file first so the phase produces a real hunk (not a whole-new-file)
  {
    for i in $(seq 1 200); do printf 'origline-%s\n' "$i"; done
  } > "$repo/huge.js"
  git -C "$repo" add huge.js && git -C "$repo" commit -qm huge

  ( cd "$repo" && bash "$WRAPPER" phase-start P1 ) > "$SANDBOX/ps.txt" 2>"$SANDBOX/ps.err"
  runDir="$(grep -E '^RUNDIR=' "$SANDBOX/ps.txt" | head -1 | sed 's/^RUNDIR=//')"
  if [ -z "$runDir" ]; then
    fail "hunks-kept: phase-start did not print RUNDIR= :: $(cat "$SANDBOX/ps.err")"
    return
  fi

  # change ONE line deep in the big file -> a single hunk with a unique changed line
  perl -0pi -e 's/origline-100/CHANGED-HUNK-LINE-MARKER/' "$repo/huge.js" 2>/dev/null \
    || sed -i '' 's/origline-100/CHANGED-HUNK-LINE-MARKER/' "$repo/huge.js"

  ( cd "$repo" && STUB_MODE=approve bash "$WRAPPER" phase-review P1 ) > "$SANDBOX/pr.txt" 2>"$SANDBOX/pr.err"
  packet="$STUB_STDIN_DUMP"
  if [ ! -s "$packet" ]; then
    fail "hunks-kept: packet never produced :: $(cat "$SANDBOX/pr.err")"
    return
  fi

  # the big file body must be omitted (a non-changed deep line must NOT be inlined)
  if grep -q 'origline-150' "$packet"; then
    fail "hunks-kept: big file body was inlined (origline-150 present) — should be omitted"
  else
    pass "hunks-kept: big file body omitted (a non-changed deep line absent)"
  fi
  # but the DIFF section header is present
  if grep -q 'END DIFF' "$packet"; then
    pass "hunks-kept: DIFF section header present"
  else
    fail "hunks-kept: DIFF section header missing"
  fi
  # and the changed line from the hunk IS present (hunks never dropped)
  if grep -q 'CHANGED-HUNK-LINE-MARKER' "$packet"; then
    pass "hunks-kept: the changed hunk line is present in the packet"
  else
    fail "hunks-kept: changed hunk line MISSING — hunks were dropped!"
  fi
}

#############################################################################
# TEST 25 — review LEDGER written on APPROVE; NOT written on a block [TIER 2]
#   (a) An APPROVE'd phase-review appends ONE JSONL line to ledger.jsonl at the
#       WORKTREE level (one level above the session dir), and the entry records the
#       changed file with its current git hash-object sha + the mode + a verdictPath.
#   (b) A block_fixable phase-review must NOT append to the ledger (only an approved
#       surface is "reviewed").
#############################################################################
run_test_25() {
  local repo runDir ledger entry sha_expect
  repo="$(make_repo)"
  printf 'seed\n' > "$repo/seed.txt"
  git -C "$repo" add seed.txt && git -C "$repo" commit -qm init

  # --- (a) APPROVE writes the ledger ---
  ( cd "$repo" && bash "$WRAPPER" phase-start P1 ) > "$SANDBOX/ps.txt" 2>"$SANDBOX/ps.err"
  runDir="$(grep -E '^RUNDIR=' "$SANDBOX/ps.txt" | head -1 | sed 's/^RUNDIR=//')"
  if [ -z "$runDir" ]; then
    fail "ledger: phase-start did not print RUNDIR= :: $(cat "$SANDBOX/ps.err")"
    return
  fi
  # change a file so there's a reviewed surface
  printf 'seed\nLEDGER-CHANGE\n' > "$repo/seed.txt"
  ( cd "$repo" && STUB_MODE=approve bash "$WRAPPER" phase-review P1 ) > "$SANDBOX/pr.txt" 2>"$SANDBOX/pr.err"

  # The ledger lives at the WORKTREE level: one dir ABOVE the session dir. The runDir is
  # .../<repoSlug>-<hash>/<wtkey>/<session>/<phaseKey>; ledger = .../<wtkey>/ledger.jsonl.
  ledger="$(dirname "$(dirname "$runDir")")/ledger.jsonl"
  if [ -f "$ledger" ]; then
    pass "ledger: ledger.jsonl exists at the worktree level after APPROVE"
  else
    fail "ledger: ledger.jsonl NOT found at worktree level ($ledger) :: $(cat "$SANDBOX/pr.err")"
    return
  fi
  # ledger must NOT be inside the repo
  case "$ledger" in
    "$repo"/*) fail "ledger: ledger.jsonl is INSIDE the repo: $ledger" ;;
    *)         pass "ledger: ledger.jsonl is outside the repo (under runs/)" ;;
  esac
  # exactly one entry; entry has mode=phase-review and reviewedPaths with seed.txt + its sha
  entry="$(tail -1 "$ledger")"
  if printf '%s' "$entry" | jq -e '.mode=="phase-review"' >/dev/null 2>&1; then
    pass "ledger: entry records mode=phase-review"
  else
    fail "ledger: entry missing mode=phase-review :: $entry"
  fi
  sha_expect="$(git -C "$repo" hash-object -- seed.txt 2>/dev/null)"
  if printf '%s' "$entry" | jq -e --arg p seed.txt --arg s "$sha_expect" \
       '.reviewedPaths[] | select(.path==$p and .sha==$s)' >/dev/null 2>&1; then
    pass "ledger: entry records the changed file with its git hash-object sha"
  else
    fail "ledger: entry missing seed.txt @ $sha_expect :: $entry"
  fi
  if [ -n "$(printf '%s' "$entry" | jq -r '.verdictPath // ""' 2>/dev/null)" ]; then
    pass "ledger: entry records a verdictPath"
  else
    fail "ledger: entry missing verdictPath :: $entry"
  fi

  # --- (b) a block_fixable review does NOT append ---
  local before_lines after_lines
  before_lines="$(wc -l < "$ledger" | tr -d ' ')"
  printf 'seed\nLEDGER-CHANGE\nMORE\n' > "$repo/seed.txt"
  ( cd "$repo" && STUB_MODE=block_fixable bash "$WRAPPER" phase-review P1 2 ) > "$SANDBOX/pr2.txt" 2>"$SANDBOX/pr2.err"
  after_lines="$(wc -l < "$ledger" | tr -d ' ')"
  if [ "$before_lines" = "$after_lines" ]; then
    pass "ledger: a block_fixable review does NOT append to the ledger"
  else
    fail "ledger: block_fixable WRONGLY appended ($before_lines -> $after_lines)"
  fi
}

#############################################################################
# TEST 26 — prepr-delta scopes to changed-since-reviewed + new; skips unchanged [TIER 2]
#   Seed the ledger by APPROVING a prepr over files A and C at their current shas.
#   Then: change A (sha mismatch), add NEW file B, leave C unchanged (sha match).
#   prepr-delta must:
#     - REVIEW the changed A and the new B (their content reaches the packet),
#     - put C in the "ALREADY REVIEWED & UNCHANGED" section with its sha shown,
#     - and NOT carry C's body into the reviewed surface.
#############################################################################
run_test_26() {
  local repo status packet sha_c root
  repo="$(make_repo)"
  # ROOT commit holds A and C at their ORIGINAL content. The branch then modifies BOTH
  # A and C so both appear in `git diff <root>` and both get recorded in the seed ledger.
  printf 'AAA-root\n' > "$repo/A.js"
  printf 'CCC-root\n' > "$repo/C.js"
  git -C "$repo" add A.js C.js && git -C "$repo" commit -qm init
  root="$(git -C "$repo" rev-list --max-parents=0 HEAD | head -1)"
  # branch commit: change A and C so both are in the diff vs root
  printf 'AAA-reviewed\n' > "$repo/A.js"
  printf 'CCC-stable-reviewed\n' > "$repo/C.js"
  git -C "$repo" add A.js C.js && git -C "$repo" commit -qm branch

  # --- seed the ledger: approve a prepr vs root so A AND C are recorded at current shas ---
  ( cd "$repo" && STUB_MODE=approve bash "$WRAPPER" prepr "$root" ) > "$SANDBOX/seed.txt" 2>"$SANDBOX/seed.err"
  status="$(last_json_line "$SANDBOX/seed.txt")"
  if [ "$(printf '%s' "$status" | jq -r '.outcome // empty')" != "APPROVE" ]; then
    fail "prepr-delta: seed prepr did not APPROVE :: $status :: $(cat "$SANDBOX/seed.err")"
    return
  fi
  # C's reviewed sha (it stays unchanged after the seed -> must be SKIPPED by the delta)
  sha_c="$(git -C "$repo" hash-object -- C.js)"

  # --- now: change A (sha mismatch), add B (new untracked), leave C at its reviewed sha ---
  printf 'AAA-CHANGED-SINCE-REVIEW\n' > "$repo/A.js"
  printf 'BBB-BRAND-NEW\n' > "$repo/B.js"

  # run prepr-delta against the root (same base) so the candidate universe = {A, B, C};
  # the ledger should knock C out (unchanged) but keep A (changed) and B (new/unreviewed).
  ( cd "$repo" && STUB_MODE=approve bash "$WRAPPER" prepr-delta "$root" ) > "$SANDBOX/d.txt" 2>"$SANDBOX/d.err"
  status="$(last_json_line "$SANDBOX/d.txt")"
  packet="$STUB_STDIN_DUMP"
  if [ -z "$status" ]; then
    fail "prepr-delta: no status JSON :: $(cat "$SANDBOX/d.txt") :: $(cat "$SANDBOX/d.err")"
    return
  fi
  if [ ! -s "$packet" ]; then
    fail "prepr-delta: packet never produced (stub stdin empty) :: $(cat "$SANDBOX/d.err")"
    return
  fi

  # changed A reviewed
  if grep -q 'AAA-CHANGED-SINCE-REVIEW' "$packet"; then
    pass "prepr-delta: CHANGED-since-reviewed file A is reviewed (new content in packet)"
  else
    fail "prepr-delta: changed A NOT in the reviewed packet"
  fi
  # new B reviewed
  if grep -q 'BBB-BRAND-NEW' "$packet"; then
    pass "prepr-delta: NEW unreviewed file B is reviewed (content in packet)"
  else
    fail "prepr-delta: new B NOT in the reviewed packet"
  fi
  # the ALREADY REVIEWED & UNCHANGED section exists and lists C with its sha
  if grep -q 'ALREADY REVIEWED & UNCHANGED' "$packet"; then
    pass "prepr-delta: packet has the ALREADY REVIEWED & UNCHANGED section"
  else
    fail "prepr-delta: missing the ALREADY REVIEWED & UNCHANGED section"
  fi
  if grep -Eq "C\.js[[:space:]]+$sha_c" "$packet"; then
    pass "prepr-delta: unchanged file C is listed with its sha (proof, not silent)"
  else
    fail "prepr-delta: C.js + sha not shown in the already-reviewed section :: $(grep -n 'C.js' "$packet" || echo none)"
  fi
  # C's body must NOT be in the reviewed surface (the FULL CONTENTS section).
  # C.js content 'CCC-stable' may appear ONLY in the already-reviewed listing; assert it is
  # not present in the diff hunks (no '+CCC-stable' / no FULL CONTENTS dump of C).
  if grep -Eq '^\+?CCC-stable$' "$packet"; then
    fail "prepr-delta: unchanged C body leaked into the reviewed surface"
  else
    pass "prepr-delta: unchanged C body NOT carried into the reviewed surface"
  fi
  # coverage: reviewedNow counts A + B (>=2), priorHashMatch counts C (>=1)
  if printf '%s' "$status" | jq -e '.coverage.reviewedNow >= 2 and .coverage.priorHashMatch >= 1' >/dev/null 2>&1; then
    pass "prepr-delta: coverage reviewedNow>=2 (A,B) and priorHashMatch>=1 (C)"
  else
    fail "prepr-delta: coverage counts wrong :: $(printf '%s' "$status" | jq -c '.coverage')"
  fi
}

#############################################################################
# TEST 27 — prepr-delta with EVERYTHING reviewed+unchanged -> APPROVE, no codex [TIER 2]
#   Seed the ledger approving the whole branch surface at current shas, then run
#   prepr-delta with NO further changes: it must APPROVE WITHOUT invoking the stub
#   (empty argv log) and the summary must mention "already reviewed".
#############################################################################
run_test_27() {
  local repo status outcome root
  repo="$(make_repo)"
  printf 'one\n' > "$repo/one.js"
  printf 'two\n' > "$repo/two.js"
  git -C "$repo" add one.js two.js && git -C "$repo" commit -qm init
  printf 'one\n// branch\n' > "$repo/one.js"
  git -C "$repo" add one.js && git -C "$repo" commit -qm branch
  root="$(git -C "$repo" rev-list --max-parents=0 HEAD | head -1)"

  # seed: approve a prepr over the whole branch (base=root) so one.js + two.js are recorded
  ( cd "$repo" && STUB_MODE=approve bash "$WRAPPER" prepr "$root" ) > "$SANDBOX/seed.txt" 2>"$SANDBOX/seed.err"
  if [ "$(last_json_line "$SANDBOX/seed.txt" | jq -r '.outcome // empty')" != "APPROVE" ]; then
    fail "prepr-delta-empty: seed prepr did not APPROVE :: $(cat "$SANDBOX/seed.err")"
    return
  fi

  # NO further changes -> the delta candidate set is empty (all branch files reviewed+unchanged).
  reset_argv_log
  ( cd "$repo" && STUB_MODE=approve bash "$WRAPPER" prepr-delta "$root" ) > "$SANDBOX/d.txt" 2>"$SANDBOX/d.err"
  status="$(last_json_line "$SANDBOX/d.txt")"
  outcome="$(printf '%s' "$status" | jq -r '.outcome // empty')"

  if [ "$outcome" = "APPROVE" ]; then
    pass "prepr-delta-empty: all-reviewed delta -> APPROVE"
  else
    fail "prepr-delta-empty: expected APPROVE got '$outcome' :: $status :: $(cat "$SANDBOX/d.err")"
  fi
  # the stub must NOT have been invoked
  if [ -s "$STUB_ARGV_LOG" ]; then
    fail "prepr-delta-empty: stub WAS invoked for an empty delta (argv non-empty) :: $(cat "$STUB_ARGV_LOG")"
  else
    pass "prepr-delta-empty: stub was NEVER invoked (empty delta short-circuit)"
  fi
  # the summary mentions "already reviewed"
  if printf '%s' "$status" | jq -r '.summary // ""' | grep -qi 'already reviewed'; then
    pass "prepr-delta-empty: summary mentions 'already reviewed'"
  else
    fail "prepr-delta-empty: summary missing 'already reviewed' :: $(printf '%s' "$status" | jq -r '.summary')"
  fi
  # coverage present: reviewedNow=0, priorHashMatch>=1, unreviewed=0
  if printf '%s' "$status" | jq -e '.coverage.reviewedNow==0 and .coverage.priorHashMatch>=1 and .coverage.unreviewed==0' >/dev/null 2>&1; then
    pass "prepr-delta-empty: coverage reviewedNow=0, priorHashMatch>=1, unreviewed=0"
  else
    fail "prepr-delta-empty: coverage wrong :: $(printf '%s' "$status" | jq -c '.coverage')"
  fi
}

#############################################################################
# TEST 28 — coverage manifest present in prepr AND prepr-delta status [TIER 2]
#   A plain prepr (no ledger) over a changed file must carry a coverage object with
#   reviewedNow>=1 and unreviewed==0 (everything got reviewed now). prepr-delta's
#   coverage is exercised by 26/27; here we pin the prepr-side additive field.
#############################################################################
run_test_28() {
  local repo status
  repo="$(make_repo)"
  printf 'seed\n' > "$repo/seed.txt"
  git -C "$repo" add seed.txt && git -C "$repo" commit -qm init
  printf 'seed\ncov-change\n' > "$repo/seed.txt"

  ( cd "$repo" && STUB_MODE=approve bash "$WRAPPER" prepr ) > "$SANDBOX/out.txt" 2>"$SANDBOX/err.txt"
  status="$(last_json_line "$SANDBOX/out.txt")"
  if [ -z "$status" ]; then
    fail "coverage-prepr: no status :: $(cat "$SANDBOX/err.txt")"
    return
  fi
  if printf '%s' "$status" | jq -e 'has("coverage")' >/dev/null 2>&1; then
    pass "coverage-prepr: prepr status carries a coverage object"
  else
    fail "coverage-prepr: prepr status has NO coverage object :: $status"
  fi
  if printf '%s' "$status" | jq -e '.coverage.reviewedNow>=1 and .coverage.unreviewed==0' >/dev/null 2>&1; then
    pass "coverage-prepr: reviewedNow>=1 and unreviewed==0 for a plain prepr"
  else
    fail "coverage-prepr: coverage counts wrong :: $(printf '%s' "$status" | jq -c '.coverage')"
  fi
  # additive: the canonical review fields are still present (no existing consumer broke)
  if printf '%s' "$status" | jq -e 'has("outcome") and has("blockers") and has("agentFixableBlockers") and has("decisionBlockers")' >/dev/null 2>&1; then
    pass "coverage-prepr: existing status fields still present (coverage is additive)"
  else
    fail "coverage-prepr: existing status fields missing :: $status"
  fi
}

#############################################################################
# TEST 29 — coverage gap fails closed: an unreviewed file blocks APPROVE [TIER 2]
#   Force a synthetic coverage gap via CODEX_GATE_FORCE_UNREVIEWED (a test-only seam
#   the wrapper honors): even on a stub APPROVE verdict, unreviewed>0 must downgrade
#   the outcome away from APPROVE (to OVERFLOW/INFRA_ERROR-style) with a
#   "coverage gap" summary. (Approval is impossible when required surface is unreviewed.)
#############################################################################
run_test_29() {
  local repo status outcome
  repo="$(make_repo)"
  printf 'seed\n' > "$repo/seed.txt"
  git -C "$repo" add seed.txt && git -C "$repo" commit -qm init
  printf 'seed\ngap-change\n' > "$repo/seed.txt"

  ( cd "$repo" && CODEX_GATE_FORCE_UNREVIEWED=1 STUB_MODE=approve bash "$WRAPPER" prepr ) > "$SANDBOX/out.txt" 2>"$SANDBOX/err.txt"
  status="$(last_json_line "$SANDBOX/out.txt")"
  outcome="$(printf '%s' "$status" | jq -r '.outcome // empty')"

  if [ "$outcome" = "APPROVE" ]; then
    fail "coverage-gap: APPROVED despite an unreviewed coverage gap :: $status"
  else
    pass "coverage-gap: a coverage gap does NOT APPROVE (got $outcome, fail-closed)"
  fi
  if printf '%s' "$status" | jq -r '.summary // ""' | grep -qi 'coverage gap'; then
    pass "coverage-gap: summary names the coverage gap"
  else
    fail "coverage-gap: summary missing 'coverage gap' :: $(printf '%s' "$status" | jq -r '.summary')"
  fi
  # the coverage object still reports the unreviewed count
  if printf '%s' "$status" | jq -e '.coverage.unreviewed>=1' >/dev/null 2>&1; then
    pass "coverage-gap: coverage.unreviewed>=1 surfaced"
  else
    fail "coverage-gap: coverage.unreviewed not surfaced :: $(printf '%s' "$status" | jq -c '.coverage // empty')"
  fi
}

#############################################################################
# TEST 30 — shard assignment is a COMPLETE, DISJOINT partition [TIER 3]
#   Source the wrapper (sourcing guard => main not run) and drive shard_group_for_path
#   over a candidate set spanning docs/tests/config/other. Assert:
#     - every candidate maps to exactly ONE of the four known groups,
#     - the union of the four group-buckets == the full candidate set,
#     - the buckets are pairwise disjoint (no path in two groups),
#     - specific first-match precedence: a *.md UNDER docs/ -> docs (docs before tests),
#       a *test*.yml -> tests (tests before config), a Dockerfile -> config, a .js -> other.
#############################################################################
run_test_30() {
  # source for direct function access (guarded main => no dispatch)
  ( # subshell so sourcing side-effects don't leak into the harness
    set +u
    # shellcheck disable=SC1090
    . "$WRAPPER" >/dev/null 2>&1 || { printf 'SOURCEFAIL\n'; exit 0; }
    if ! type shard_group_for_path >/dev/null 2>&1; then printf 'NOFUNC\n'; exit 0; fi

    # candidate set spanning all four groups (+ precedence edge cases)
    cands="docs/readme.md
projects/api/notes.md
src/foo.test.js
src/__tests__/bar.js
test/helper.js
ci/deploy.test.yml
.docker/docker-compose.yml
Dockerfile
package-lock.json
config/app.toml
src/app.js
projects/react/index.jsx"

    union=""
    bad_multi=0
    all_known=1
    printf '%s\n' "$cands" | while IFS= read -r p; do
      [ -n "$p" ] || continue
      g="$(shard_group_for_path "$p")"
      printf 'MAP\t%s\t%s\n' "$g" "$p"
    done
  ) > "$SANDBOX/shardmap.txt" 2>/dev/null

  if grep -q 'SOURCEFAIL' "$SANDBOX/shardmap.txt"; then
    fail "shard-partition: could not source wrapper (sourcing guard missing?)"
    return
  fi
  if grep -q 'NOFUNC' "$SANDBOX/shardmap.txt"; then
    fail "shard-partition: shard_group_for_path not defined in wrapper"
    return
  fi

  # every line is MAP<TAB>group<TAB>path ; collect groups + paths
  local total mapped known_groups dup_paths
  total=12   # number of candidate lines above
  mapped="$(grep -c '^MAP	' "$SANDBOX/shardmap.txt")"
  if [ "$mapped" -eq "$total" ]; then
    pass "shard-partition: every candidate ($total) assigned to exactly one group (union complete)"
  else
    fail "shard-partition: expected $total assignments got $mapped :: $(cat "$SANDBOX/shardmap.txt")"
  fi
  # all groups are one of the four known names
  known_groups="$(awk -F'\t' '$1=="MAP"{print $2}' "$SANDBOX/shardmap.txt" | LC_ALL=C sort -u)"
  if printf '%s\n' "$known_groups" | grep -qvE '^(docs|tests|config|other)$'; then
    fail "shard-partition: an unknown group appeared :: $known_groups"
  else
    pass "shard-partition: all groups are in {docs,tests,config,other}"
  fi
  # disjoint: no path appears under two groups (each path mapped once -> unique path count == total)
  dup_paths="$(awk -F'\t' '$1=="MAP"{print $3}' "$SANDBOX/shardmap.txt" | LC_ALL=C sort | uniq -d)"
  if [ -z "$dup_paths" ]; then
    pass "shard-partition: buckets are pairwise disjoint (no path in two groups)"
  else
    fail "shard-partition: a path landed in two groups :: $dup_paths"
  fi

  # precedence: docs before tests for a *.md under docs/
  if awk -F'\t' '$3=="docs/readme.md"{print $2}' "$SANDBOX/shardmap.txt" | grep -qx 'docs'; then
    pass "shard-partition: docs/readme.md -> docs (docs precedes tests)"
  else
    fail "shard-partition: docs/readme.md not classified docs"
  fi
  # a *.md NOT under docs/ still -> docs (the **/*.md rule)
  if awk -F'\t' '$3=="projects/api/notes.md"{print $2}' "$SANDBOX/shardmap.txt" | grep -qx 'docs'; then
    pass "shard-partition: a non-docs/ *.md still -> docs (**/*.md rule)"
  else
    fail "shard-partition: projects/api/notes.md not classified docs"
  fi
  # tests before config for a *test*.yml
  if awk -F'\t' '$3=="ci/deploy.test.yml"{print $2}' "$SANDBOX/shardmap.txt" | grep -qx 'tests'; then
    pass "shard-partition: ci/deploy.test.yml -> tests (tests precedes config)"
  else
    fail "shard-partition: deploy.test.yml not classified tests"
  fi
  # config: Dockerfile, lockfile, .toml, .docker/
  if awk -F'\t' '$3=="Dockerfile"{print $2}' "$SANDBOX/shardmap.txt" | grep -qx 'config' \
     && awk -F'\t' '$3=="package-lock.json"{print $2}' "$SANDBOX/shardmap.txt" | grep -qx 'config' \
     && awk -F'\t' '$3=="config/app.toml"{print $2}' "$SANDBOX/shardmap.txt" | grep -qx 'config' \
     && awk -F'\t' '$3==".docker/docker-compose.yml"{print $2}' "$SANDBOX/shardmap.txt" | grep -qx 'config'; then
    pass "shard-partition: Dockerfile/lockfile/.toml/.docker -> config"
  else
    fail "shard-partition: a config-class file misclassified :: $(cat "$SANDBOX/shardmap.txt")"
  fi
  # other: plain source files
  if awk -F'\t' '$3=="src/app.js"{print $2}' "$SANDBOX/shardmap.txt" | grep -qx 'other' \
     && awk -F'\t' '$3=="projects/react/index.jsx"{print $2}' "$SANDBOX/shardmap.txt" | grep -qx 'other'; then
    pass "shard-partition: plain source (.js/.jsx) -> other"
  else
    fail "shard-partition: a plain source file not classified other"
  fi
}

#############################################################################
# TEST 31 — auto-shard trigger: over-budget prepr shards + aggregates [TIER 3]
#   With a tiny CODEX_GATE_PACKET_BUDGET so the FULL packet is over budget and
#   CODEX_GATE_SHARD=auto, prepr must:
#     - shard the candidate set by path, review EACH non-empty shard in its own
#       fresh thread (stub invoked once per non-empty shard),
#     - persist per-shard verdict files $RUN_DIR/shard-<group>-verdict.json,
#     - aggregate to APPROVE (all shards approve) with a `shards` summary in the status,
#     - keep the coverage object.
#   Candidate set spans 3 groups (docs, tests, other) so we expect 3 shard reviews.
#############################################################################
run_test_31() {
  local repo status outcome runDir nshards i
  repo="$(make_repo)"
  printf 'seed\n' > "$repo/seed.txt"
  git -C "$repo" add seed.txt && git -C "$repo" commit -qm init
  # Changes spanning 3 shard groups. Each file is ~60 lines (< the 120-line inline cap, so
  # bodies inline + add bulk) so the FULL 3-file packet (~14 KB) exceeds the budget but each
  # SINGLE-file shard packet (~6.6 KB) fits under it. Budget 9000 separates the two cleanly.
  mkdir -p "$repo/docs"
  { for i in $(seq 1 60); do printf 'docs-line-%s SHARD-DOCS-MARK\n' "$i"; done; } > "$repo/docs/guide.md"      # docs
  { for i in $(seq 1 60); do printf 'test-line-%s SHARD-TESTS-MARK\n' "$i"; done; } > "$repo/thing.test.js"     # tests
  { for i in $(seq 1 60); do printf 'src-line-%s SHARD-OTHER-MARK\n' "$i"; done; } > "$repo/app.js"             # other

  reset_argv_log
  ( cd "$repo" && CODEX_GATE_PACKET_BUDGET=9000 CODEX_GATE_SHARD=auto STUB_MODE=approve \
       bash "$WRAPPER" prepr ) > "$SANDBOX/out.txt" 2>"$SANDBOX/err.txt"
  status="$(last_json_line "$SANDBOX/out.txt")"
  outcome="$(printf '%s' "$status" | jq -r '.outcome // empty')"
  runDir="$(printf '%s' "$status" | jq -r '.runDir // empty')"

  if [ -z "$status" ]; then
    fail "auto-shard: no status JSON :: $(cat "$SANDBOX/err.txt")"
    return
  fi
  if [ "$outcome" = "APPROVE" ]; then
    pass "auto-shard: over-budget prepr with SHARD=auto aggregates to APPROVE"
  else
    fail "auto-shard: expected APPROVE got '$outcome' :: $status :: $(cat "$SANDBOX/err.txt")"
  fi
  # per-shard verdict files exist for the 3 non-empty groups
  local ok=0
  [ -f "$runDir/shard-docs-verdict.json" ]  || ok=1
  [ -f "$runDir/shard-tests-verdict.json" ] || ok=1
  [ -f "$runDir/shard-other-verdict.json" ] || ok=1
  check "auto-shard: per-shard verdict files (docs/tests/other) persisted under run dir" "$ok"
  # an EMPTY group (config) must NOT get a shard verdict file
  if [ -f "$runDir/shard-config-verdict.json" ]; then
    fail "auto-shard: an empty (config) shard wrongly produced a verdict file"
  else
    pass "auto-shard: empty (config) shard produced NO verdict file"
  fi
  # the stub was invoked exactly ONCE per non-empty shard (3 invocations)
  nshards="$(grep -c -- '---END-ARGV---' "$STUB_ARGV_LOG")"
  if [ "$nshards" -eq 3 ]; then
    pass "auto-shard: stub invoked once PER non-empty shard (3 invocations)"
  else
    fail "auto-shard: expected 3 stub invocations got $nshards :: $(cat "$STUB_ARGV_LOG")"
  fi
  # the status carries a `shards` summary array with group/files/outcome/verdictPath
  if printf '%s' "$status" | jq -e '(.shards | type=="array") and (.shards | length==3)' >/dev/null 2>&1; then
    pass "auto-shard: status has a shards[] summary of length 3"
  else
    fail "auto-shard: status missing shards[] summary :: $status"
  fi
  if printf '%s' "$status" | jq -e '.shards | all(.[]; has("group") and has("files") and has("outcome") and has("verdictPath"))' >/dev/null 2>&1; then
    pass "auto-shard: each shards[] entry has group/files/outcome/verdictPath"
  else
    fail "auto-shard: shards[] entries missing required keys :: $(printf '%s' "$status" | jq -c '.shards')"
  fi
  # coverage object still present (additive Tier-2 field preserved)
  if printf '%s' "$status" | jq -e 'has("coverage") and (.coverage.reviewedNow>=3)' >/dev/null 2>&1; then
    pass "auto-shard: coverage object preserved (reviewedNow>=3)"
  else
    fail "auto-shard: coverage object missing/wrong :: $(printf '%s' "$status" | jq -c '.coverage // empty')"
  fi
  # the aggregate verdict file the status points to must exist (round-1-verdict.json)
  local vpath
  vpath="$(printf '%s' "$status" | jq -r '.verdictPath // empty')"
  if [ -n "$vpath" ] && [ -f "$vpath" ]; then
    pass "auto-shard: aggregate verdict file exists ($vpath)"
  else
    fail "auto-shard: aggregate verdict file missing :: $status"
  fi
}

#############################################################################
# TEST 32 — aggregate UNIONS blockers across shards [TIER 3]
#   Two different shards (docs + other) each carry a distinct SHARDBLOCKER-<tag>
#   marker; STUB_BLOCK_IF_STDIN=SHARDBLOCKER makes any shard whose diff contains a
#   marker BLOCK (with that tag as its blocker issue). A third shard (tests) has no
#   marker and approves. The aggregate must be BLOCK and the combined verdict file
#   must contain BOTH tags (real union, not passthrough).
#############################################################################
run_test_32() {
  local repo status outcome vpath i
  repo="$(make_repo)"
  printf 'seed\n' > "$repo/seed.txt"
  git -C "$repo" add seed.txt && git -C "$repo" commit -qm init
  mkdir -p "$repo/docs"
  # ~60-line files (see TEST 31 sizing); each blocking shard carries a DISTINCT marker.
  { for i in $(seq 1 60); do printf 'doc-line-%s SHARDBLOCKER-DOCS\n' "$i"; done; } > "$repo/docs/guide.md"   # docs shard blocks (tag DOCS)
  { for i in $(seq 1 60); do printf 'src-line-%s SHARDBLOCKER-OTHER\n' "$i"; done; } > "$repo/app.js"         # other shard blocks (tag OTHER)
  { for i in $(seq 1 60); do printf 'test-line-%s clean-approve\n' "$i"; done; } > "$repo/thing.test.js"      # tests shard approves

  ( cd "$repo" && CODEX_GATE_PACKET_BUDGET=9000 CODEX_GATE_SHARD=auto STUB_MODE=approve \
       STUB_BLOCK_IF_STDIN=SHARDBLOCKER bash "$WRAPPER" prepr ) > "$SANDBOX/out.txt" 2>"$SANDBOX/err.txt"
  status="$(last_json_line "$SANDBOX/out.txt")"
  outcome="$(printf '%s' "$status" | jq -r '.outcome // empty')"

  if [ "$outcome" = "BLOCK" ]; then
    pass "shard-union: any blocking shard -> aggregate BLOCK"
  else
    fail "shard-union: expected BLOCK got '$outcome' :: $status :: $(cat "$SANDBOX/err.txt")"
  fi
  # aggregate blocker count is the UNION of the two blocking shards (>=2)
  if printf '%s' "$status" | jq -e '.blockers>=2' >/dev/null 2>&1; then
    pass "shard-union: aggregate blockers>=2 (union of two blocking shards)"
  else
    fail "shard-union: aggregate blockers not unioned :: $status"
  fi
  # the combined verdict file must contain BOTH distinct shard tags
  vpath="$(printf '%s' "$status" | jq -r '.verdictPath // empty')"
  if [ -n "$vpath" ] && [ -f "$vpath" ] \
     && grep -q 'SHARDBLOCKER-DOCS' "$vpath" && grep -q 'SHARDBLOCKER-OTHER' "$vpath"; then
    pass "shard-union: combined verdict file contains BOTH shard blockers (real union)"
  else
    fail "shard-union: combined verdict missing one/both tags :: $([ -f "$vpath" ] && jq -c '.blockers' "$vpath" || echo no-file)"
  fi
  # the status shards[] summary must mark >=2 shards BLOCK
  if printf '%s' "$status" | jq -e '[.shards[]? | select(.outcome=="BLOCK")] | length >= 2' >/dev/null 2>&1; then
    pass "shard-union: shards[] summary records >=2 BLOCK shards"
  else
    fail "shard-union: shards[] summary BLOCK count wrong :: $(printf '%s' "$status" | jq -c '.shards')"
  fi
}

#############################################################################
# TEST 33 — fail-closed when a shard is inconclusive (overflow/error) [TIER 3]
#   One shard's OWN packet overflows (STUB_OVERFLOW_IF_STDIN matches a marker in the
#   `other` shard) while the rest approve. The aggregate must NOT APPROVE — it fails
#   closed to OVERFLOW (cannot certify full coverage), even though other shards passed.
#############################################################################
run_test_33() {
  local repo status outcome i
  repo="$(make_repo)"
  printf 'seed\n' > "$repo/seed.txt"
  git -C "$repo" add seed.txt && git -C "$repo" commit -qm init
  mkdir -p "$repo/docs"
  # ~60-line files (see TEST 31 sizing). The `other` shard's diff carries the overflow marker
  # so its Codex call (under budget, so it IS invoked) returns the context-window signature.
  { for i in $(seq 1 60); do printf 'doc-line-%s clean\n' "$i"; done; } > "$repo/docs/guide.md"               # docs shard approves
  { for i in $(seq 1 60); do printf 'test-line-%s clean\n' "$i"; done; } > "$repo/thing.test.js"              # tests shard approves
  { for i in $(seq 1 60); do printf 'src-line-%s SHARD-OVERFLOW-HERE\n' "$i"; done; } > "$repo/app.js"        # other shard overflows

  ( cd "$repo" && CODEX_GATE_PACKET_BUDGET=9000 CODEX_GATE_SHARD=auto STUB_MODE=approve \
       STUB_OVERFLOW_IF_STDIN=SHARD-OVERFLOW-HERE bash "$WRAPPER" prepr ) > "$SANDBOX/out.txt" 2>"$SANDBOX/err.txt"
  status="$(last_json_line "$SANDBOX/out.txt")"
  outcome="$(printf '%s' "$status" | jq -r '.outcome // empty')"

  if [ "$outcome" = "APPROVE" ]; then
    fail "shard-failclosed: APPROVED despite an inconclusive (overflow) shard :: $status"
  else
    pass "shard-failclosed: an inconclusive shard does NOT APPROVE (got $outcome, fail-closed)"
  fi
  # the surfaced outcome is OVERFLOW (cannot certify full coverage) and names the shard
  if [ "$outcome" = "OVERFLOW" ]; then
    pass "shard-failclosed: surfaced outcome is OVERFLOW"
  else
    fail "shard-failclosed: expected OVERFLOW got '$outcome' :: $status"
  fi
  if printf '%s' "$status" | jq -r '.summary // ""' | grep -qi 'inconclusive'; then
    pass "shard-failclosed: summary explains a shard was inconclusive"
  else
    fail "shard-failclosed: summary missing 'inconclusive' :: $(printf '%s' "$status" | jq -r '.summary')"
  fi
  # the shards[] summary records the inconclusive shard (outcome OVERFLOW for `other`)
  if printf '%s' "$status" | jq -e '[.shards[]? | select(.outcome=="OVERFLOW" or .outcome=="INFRA_ERROR")] | length >= 1' >/dev/null 2>&1; then
    pass "shard-failclosed: shards[] summary records the inconclusive shard"
  else
    fail "shard-failclosed: shards[] summary missing the inconclusive shard :: $(printf '%s' "$status" | jq -c '.shards')"
  fi
}

#############################################################################
# TEST 34 — CODEX_GATE_SHARD=off keeps Tier-1 OVERFLOW (no sharding) [TIER 3]
#   Over-budget prepr with SHARD=off must emit OVERFLOW and NOT shard: no per-shard
#   verdict files, and the stub is never invoked (the budget guard short-circuits).
#############################################################################
run_test_34() {
  local repo status outcome runDir
  repo="$(make_repo)"
  printf 'seed\n' > "$repo/seed.txt"
  git -C "$repo" add seed.txt && git -C "$repo" commit -qm init
  mkdir -p "$repo/docs"
  printf 'doc change\n' > "$repo/docs/guide.md"
  printf 'src change\n' > "$repo/app.js"

  reset_argv_log
  ( cd "$repo" && CODEX_GATE_PACKET_BUDGET=50 CODEX_GATE_SHARD=off STUB_MODE=approve \
       bash "$WRAPPER" prepr ) > "$SANDBOX/out.txt" 2>"$SANDBOX/err.txt"
  status="$(last_json_line "$SANDBOX/out.txt")"
  outcome="$(printf '%s' "$status" | jq -r '.outcome // empty')"
  runDir="$(printf '%s' "$status" | jq -r '.runDir // empty')"

  if [ "$outcome" = "OVERFLOW" ]; then
    pass "shard-off: over-budget prepr with SHARD=off -> OVERFLOW (Tier-1 behavior)"
  else
    fail "shard-off: expected OVERFLOW got '$outcome' :: $status :: $(cat "$SANDBOX/err.txt")"
  fi
  # NO sharding happened: no shard verdict files
  if ls "$runDir"/shard-*-verdict.json >/dev/null 2>&1; then
    fail "shard-off: shard verdict files were produced despite SHARD=off :: $(ls "$runDir"/shard-*-verdict.json)"
  else
    pass "shard-off: NO per-shard verdict files (no sharding)"
  fi
  # the stub was NEVER invoked (budget guard short-circuited, no shard reviews)
  if [ -s "$STUB_ARGV_LOG" ]; then
    fail "shard-off: stub WAS invoked despite SHARD=off over budget :: $(cat "$STUB_ARGV_LOG")"
  else
    pass "shard-off: stub was NEVER invoked (Tier-1 OVERFLOW short-circuit)"
  fi
  # the status must NOT carry a shards[] summary (no sharding)
  if printf '%s' "$status" | jq -e 'has("shards")' >/dev/null 2>&1; then
    fail "shard-off: status wrongly carries a shards[] summary :: $status"
  else
    pass "shard-off: status has no shards[] summary (no sharding)"
  fi
}

#############################################################################
# TEST 35 — investigate <brief> root-cause mode [INVESTIGATE MODE]
#   In a temp git repo:
#     - default STUB_MODE auto-remaps to inv_root_cause -> outcome ROOT_CAUSE_FOUND,
#       confidence + summary(=rootCause) non-empty
#     - the packet carries the brief text, the investigator persona, and the
#       INVESTIGATION BRIEF header
#     - schema pinned to investigate.schema.json; code tier (cwd=repo root, approval_policy=never)
#     - investigate NEVER writes the review ledger (no approved surface)
#     - read-only: git status --porcelain byte-identical before/after
#     - needs_more_evidence + unsafe_or_blocked + infra/overflow mappings
#     - resume round 2 sends `exec resume <tid>` and folds in <runDir>/evidence.md
#############################################################################
run_test_35() {
  local repo repo_phys brief status outcome runDir before after schema_val argv cwd ledger packet

  # ---- (A) root_cause_found happy path + packet shape ----
  repo="$(make_repo)"
  repo_phys="$(cd "$repo" && pwd -P)"
  printf 'seed\n' > "$repo/seed.txt"
  git -C "$repo" add seed.txt && git -C "$repo" commit -qm init
  brief="$SANDBOX/brief.md"
  printf 'TASK: why do eval runs get orphaned ~8-19s after start?\n\nINVESTIGATE-SENTINEL-ORPHAN\n\nSAFETY:\nALLOWED PROBES: Layer A code tests; read-only docker inspect/logs; read-only file inspection.\nFORBIDDEN PROBES: never trigger a Layer B (live AI) run.\n' > "$brief"

  before="$(git -C "$repo" status --porcelain)"
  reset_argv_log; reset_cwd_log
  ( cd "$repo" && STUB_MODE=approve bash "$WRAPPER" investigate "$brief" ) > "$SANDBOX/inv.txt" 2>"$SANDBOX/inv.err"
  status="$(last_json_line "$SANDBOX/inv.txt")"
  if [ -z "$status" ]; then
    fail "investigate: produced no status JSON :: $(cat "$SANDBOX/inv.txt") :: $(cat "$SANDBOX/inv.err")"
    return
  fi
  outcome="$(printf '%s' "$status" | jq -r '.outcome // empty' 2>/dev/null)"
  runDir="$(printf '%s' "$status" | jq -r '.runDir // empty' 2>/dev/null)"
  packet="$STUB_STDIN_DUMP"

  if [ "$outcome" = "ROOT_CAUSE_FOUND" ]; then
    pass "investigate: outcome == ROOT_CAUSE_FOUND"
  else
    fail "investigate: expected ROOT_CAUSE_FOUND got '$outcome' :: $status :: $(cat "$SANDBOX/inv.err")"
  fi
  if [ -n "$(printf '%s' "$status" | jq -r '.confidence // ""' 2>/dev/null)" ]; then
    pass "investigate: status carries confidence"
  else
    fail "investigate: confidence missing :: $status"
  fi
  if [ -n "$(printf '%s' "$status" | jq -r '.summary // ""' 2>/dev/null)" ]; then
    pass "investigate: status summary (rootCause) non-empty"
  else
    fail "investigate: summary empty :: $status"
  fi
  # packet carries the brief text, the investigator persona, and the BRIEF header
  if grep -q 'INVESTIGATE-SENTINEL-ORPHAN' "$packet"; then
    pass "investigate: packet includes the brief text"
  else
    fail "investigate: brief text NOT in packet"
  fi
  if grep -q 'independent ROOT-CAUSE INVESTIGATOR' "$packet"; then
    pass "investigate: packet includes the investigator persona"
  else
    fail "investigate: investigator persona NOT in packet"
  fi
  if grep -q 'INVESTIGATION BRIEF' "$packet"; then
    pass "investigate: packet has the INVESTIGATION BRIEF section header"
  else
    fail "investigate: INVESTIGATION BRIEF header missing from packet"
  fi
  # schema pinned to investigate.schema.json
  schema_val="$(awk 'prev=="--output-schema"{print; exit} {prev=$0}' "$STUB_ARGV_LOG")"
  case "$schema_val" in
    */investigate.schema.json) pass "investigate: --output-schema pinned to investigate.schema.json" ;;
    *) fail "investigate: --output-schema not investigate.schema.json: '$schema_val'" ;;
  esac
  # code tier: cwd = repo root + approval_policy=never (read-only shell posture)
  argv="$(cat "$STUB_ARGV_LOG")"
  cwd="$(head -1 "$STUB_CWD_LOG")"
  if [ "$cwd" = "$repo_phys" ]; then
    pass "investigate: code tier — codex cwd = repo root"
  else
    fail "investigate: codex cwd '$cwd' != repo root '$repo_phys'"
  fi
  if printf '%s' "$argv" | grep -q 'approval_policy=never'; then
    pass "investigate: code tier passes approval_policy=never (read-only shell)"
  else
    fail "investigate: missing approval_policy=never :: $argv"
  fi
  # investigate must NEVER write the review ledger (no approved surface)
  ledger="$(dirname "$(dirname "$runDir")")/ledger.jsonl"
  if [ -f "$ledger" ]; then
    fail "investigate: WRONGLY wrote a review ledger at $ledger"
  else
    pass "investigate: no review ledger written (investigation is not an approval)"
  fi
  # read-only invariant
  after="$(git -C "$repo" status --porcelain)"
  if [ "$before" = "$after" ]; then
    pass "investigate: git status --porcelain byte-identical before/after"
  else
    fail "investigate: git status changed!\n--- before ---\n$before\n--- after ---\n$after"
  fi

  # ---- (B) needs_more_evidence -> NEEDS_MORE_EVIDENCE + nextSafeProbe ----
  ( cd "$repo" && STUB_MODE=inv_needs_evidence bash "$WRAPPER" investigate "$brief" ) > "$SANDBOX/inv2.txt" 2>"$SANDBOX/inv2.err"
  status="$(last_json_line "$SANDBOX/inv2.txt")"
  outcome="$(printf '%s' "$status" | jq -r '.outcome // empty' 2>/dev/null)"
  if [ "$outcome" = "NEEDS_MORE_EVIDENCE" ]; then
    pass "investigate: needs_more_evidence -> NEEDS_MORE_EVIDENCE"
  else
    fail "investigate: expected NEEDS_MORE_EVIDENCE got '$outcome' :: $status"
  fi
  if [ -n "$(printf '%s' "$status" | jq -r '.nextSafeProbe // ""' 2>/dev/null)" ]; then
    pass "investigate: NEEDS_MORE_EVIDENCE carries a nextSafeProbe"
  else
    fail "investigate: nextSafeProbe empty on NEEDS_MORE_EVIDENCE :: $status"
  fi

  # ---- (C) unsafe_or_blocked -> UNSAFE_OR_BLOCKED (fail closed on a forbidden probe) ----
  ( cd "$repo" && STUB_MODE=inv_unsafe bash "$WRAPPER" investigate "$brief" ) > "$SANDBOX/inv3.txt" 2>"$SANDBOX/inv3.err"
  status="$(last_json_line "$SANDBOX/inv3.txt")"
  outcome="$(printf '%s' "$status" | jq -r '.outcome // empty' 2>/dev/null)"
  if [ "$outcome" = "UNSAFE_OR_BLOCKED" ]; then
    pass "investigate: unsafe_or_blocked -> UNSAFE_OR_BLOCKED"
  else
    fail "investigate: expected UNSAFE_OR_BLOCKED got '$outcome' :: $status"
  fi

  # ---- (D) infra + overflow fail-closed mappings (shared with review modes) ----
  ( cd "$repo" && STUB_MODE=nonzero bash "$WRAPPER" investigate "$brief" ) > "$SANDBOX/inv4.txt" 2>"$SANDBOX/inv4.err"
  outcome="$(last_json_line "$SANDBOX/inv4.txt" | jq -r '.outcome // empty' 2>/dev/null)"
  if [ "$outcome" = "INFRA_ERROR" ]; then
    pass "investigate: nonzero codex exit -> INFRA_ERROR"
  else
    fail "investigate: expected INFRA_ERROR got '$outcome'"
  fi
  ( cd "$repo" && STUB_MODE=overflow bash "$WRAPPER" investigate "$brief" ) > "$SANDBOX/inv5.txt" 2>"$SANDBOX/inv5.err"
  outcome="$(last_json_line "$SANDBOX/inv5.txt" | jq -r '.outcome // empty' 2>/dev/null)"
  if [ "$outcome" = "OVERFLOW" ]; then
    pass "investigate: context-window failure -> OVERFLOW"
  else
    fail "investigate: expected OVERFLOW got '$outcome'"
  fi

  # ---- (E) resume round 2 sends `exec resume <tid>` and folds in <runDir>/evidence.md ----
  printf 'ROUND2-EVIDENCE-SENTINEL: find <watched dirs> -newer marker showed NO new watched file\n' > "$runDir/evidence.md"
  reset_argv_log
  ( cd "$repo" && STUB_MODE=approve bash "$WRAPPER" investigate "$brief" 2 stub-tid-123 ) > "$SANDBOX/inv6.txt" 2>"$SANDBOX/inv6.err"
  argv="$(cat "$STUB_ARGV_LOG")"
  packet="$STUB_STDIN_DUMP"
  if printf '%s' "$argv" | grep -q 'resume' && printf '%s' "$argv" | grep -q 'stub-tid-123'; then
    pass "investigate: round 2 resumes the same thread (exec resume <tid>)"
  else
    fail "investigate: round 2 did not resume :: $argv"
  fi
  if grep -q 'ROUND2-EVIDENCE-SENTINEL' "$packet"; then
    pass "investigate: round 2 packet folds in <runDir>/evidence.md"
  else
    fail "investigate: evidence.md NOT folded into the resume packet"
  fi
}

#############################################################################
# TEST 36 — fan_out_and_aggregate: the extracted generic fan-out+aggregate helper
#   [TIER 3 core — the reusable trust-critical unit under shard_and_review]
#
#   Drive fan_out_and_aggregate DIRECTLY (source the wrapper, guarded main => no
#   dispatch) over a synthetic LIST OF JOBS, each job = a pre-staged packet file, and
#   assert the deterministic fail-closed aggregate rule holds regardless of the
#   partition that produced the jobs (proves generality beyond path-sharding):
#     (A) all jobs APPROVE            -> FAN_OUTCOME=APPROVE
#     (B) one BLOCK among approves     -> FAN_OUTCOME=BLOCK, blockers UNIONED (both tags)
#     (C) one inconclusive among appr. -> FAN_OUTCOME=OVERFLOW (never APPROVE over it)
#   plus a job whose OWN packet exceeds budget -> that job is OVERFLOW (inconclusive)
#   without ever invoking codex (fail closed, no recursion).
#
#   The helper takes a jobs file (TAB: label<TAB>files<TAB>packetPath), writes per-job
#   verdict files to $RUN_DIR/<prefix><label>-verdict.json, and returns via output
#   vars: FAN_OUTCOME / FAN_N_JOBS / FAN_TOTAL_FILES / FAN_FIRST_INCONCLUSIVE /
#   FAN_BLOCKERS / FAN_JOBS_JSON. On BLOCK it unions blockers[]+nonBlocking[] into
#   $VERDICT_FILE. It is field-name / vocabulary neutral (each job summary entry uses
#   group/files/outcome/verdictPath) so a future lens caller can reuse it verbatim.
#
#   MUTATION-CHECK (scenario D): re-run scenario C but INVERT the aggregate rule via a
#   drop-in stub of classify_verdict_file that reports an inconclusive job as APPROVE.
#   The all-approve branch would then wrongly APPROVE — the test asserts that if the
#   helper's decision is APPROVE here, it is a FAILURE. This proves the assertions bite
#   on the fail-closed rule (a broken aggregate does not silently pass).
#############################################################################
run_test_36() {
  local out job_dir
  job_dir="$SANDBOX/fan-jobs"
  rm -rf "$job_dir"; mkdir -p "$job_dir"

  # ---- pre-stage per-job packets (each a small, under-budget "packet") ----
  # Jobs vary by PACKET CONTENT (not path) to prove the helper is partition-agnostic.
  printf 'lens-alpha packet: clean review, nothing to flag\n' > "$job_dir/alpha.packet"
  printf 'lens-beta packet: clean review, nothing to flag\n'  > "$job_dir/beta.packet"
  printf 'lens-gamma packet: FAN-BLOCK-GAMMA problem here\n'   > "$job_dir/gamma.packet"
  printf 'lens-delta packet: SHARDBLOCKER-DELTA distinct issue\n' > "$job_dir/delta.packet"
  printf 'lens-epsilon packet: FAN-OVERFLOW-EPSILON marker\n'  > "$job_dir/epsilon.packet"

  # Helper: source the wrapper in a subshell, set up run-dir + round paths, invoke
  # fan_out_and_aggregate over a jobs file, and print the output vars + a probe of the
  # aggregate verdict file. Extra pre-source shell (arg 3) allows a mutation override.
  run_fan() { # <jobs-file> <stub-env-string> <presource-override>
    local jobs="$1" stubenv="$2" override="${3:-}"
    (
      set +u
      # shellcheck disable=SC1090
      . "$WRAPPER" >/dev/null 2>&1 || { printf 'SOURCEFAIL\n'; exit 0; }
      if ! type fan_out_and_aggregate >/dev/null 2>&1; then printf 'NOFUNC\n'; exit 0; fi
      RUN_DIR="$job_dir/run"; rm -rf "$RUN_DIR"; mkdir -p "$RUN_DIR"
      REPO_ROOT="$job_dir"
      ROUND=1; set_round_paths   # VERDICT_FILE=$RUN_DIR/round-1-verdict.json
      # optional mutation override (evaluated AFTER sourcing so it shadows the real fn)
      [ -n "$override" ] && eval "$override"
      # export the stub seams for this invocation
      eval "$stubenv"
      export STUB_MODE="${STUB_MODE:-approve}"
      export STUB_BLOCK_IF_STDIN="${STUB_BLOCK_IF_STDIN:-}"
      export STUB_OVERFLOW_IF_STDIN="${STUB_OVERFLOW_IF_STDIN:-}"
      export STUB_API400_IF_STDIN="${STUB_API400_IF_STDIN:-}"
      fan_out_and_aggregate "$jobs" >/dev/null 2>&1
      printf 'OUTCOME=%s\n' "${FAN_OUTCOME:-}"
      printf 'NJOBS=%s\n' "${FAN_N_JOBS:-}"
      printf 'TOTAL=%s\n' "${FAN_TOTAL_FILES:-}"
      printf 'BLOCKERS=%s\n' "${FAN_BLOCKERS:-}"
      printf 'FIRSTINC=%s\n' "${FAN_FIRST_INCONCLUSIVE:-}"
      printf 'JOBSJSON=%s\n' "${FAN_JOBS_JSON:-}"
      printf 'VERDICTFILE=%s\n' "${VERDICT_FILE:-}"
    ) 2>/dev/null
  }

  # jobs file field layout: label<TAB>files<TAB>packetPath
  mkjobs() { : > "$1"; shift; while [ "$#" -ge 3 ]; do printf '%s\t%s\t%s\n' "$1" "$2" "$3" >> "$job_dir/jobs.tmp"; shift 3; done; mv "$job_dir/jobs.tmp" "$job_dir/jobs.$RANDOM" 2>/dev/null; }

  # ---- (A) all-APPROVE ----
  {
    printf 'alpha\t2\t%s\n' "$job_dir/alpha.packet"
    printf 'beta\t3\t%s\n'  "$job_dir/beta.packet"
  } > "$job_dir/jobs-A.tsv"
  out="$(run_fan "$job_dir/jobs-A.tsv" 'STUB_MODE=approve')"
  if printf '%s' "$out" | grep -q 'SOURCEFAIL'; then
    fail "fan-agg: could not source wrapper (sourcing guard missing?)"; return
  fi
  if printf '%s' "$out" | grep -q 'NOFUNC'; then
    fail "fan-agg: fan_out_and_aggregate not defined in wrapper"; return
  fi
  if printf '%s\n' "$out" | grep -qx 'OUTCOME=APPROVE'; then
    pass "fan-agg (A): all jobs APPROVE -> aggregate APPROVE"
  else
    fail "fan-agg (A): expected APPROVE :: $out"
  fi
  # total files summed across jobs (2+3)
  if printf '%s\n' "$out" | grep -qx 'TOTAL=5'; then
    pass "fan-agg (A): FAN_TOTAL_FILES sums job file counts (5)"
  else
    fail "fan-agg (A): expected TOTAL=5 :: $out"
  fi
  # per-job summary array has 2 entries with the neutral keys
  if printf '%s\n' "$out" | sed -n 's/^JOBSJSON=//p' | jq -e '(type=="array") and (length==2) and all(.[]; has("group") and has("files") and has("outcome") and has("verdictPath"))' >/dev/null 2>&1; then
    pass "fan-agg (A): FAN_JOBS_JSON has 2 entries w/ group/files/outcome/verdictPath"
  else
    fail "fan-agg (A): FAN_JOBS_JSON malformed :: $(printf '%s\n' "$out" | sed -n 's/^JOBSJSON=//p')"
  fi

  # ---- (B) one BLOCK among approves -> BLOCK, blockers UNIONED across the two blockers ----
  # gamma blocks (FAN-BLOCK-GAMMA), delta blocks (SHARDBLOCKER-DELTA), alpha approves.
  # STUB_BLOCK_IF_STDIN matches the SHARED prefix so BOTH blocking packets block, each
  # emitting its own distinct SHARDBLOCKER-* tag (the stub greps a SHARDBLOCKER- marker).
  printf 'lens-gamma packet: SHARDBLOCKER-GAMMA problem here\n' > "$job_dir/gamma.packet"
  {
    printf 'alpha\t1\t%s\n' "$job_dir/alpha.packet"
    printf 'gamma\t1\t%s\n' "$job_dir/gamma.packet"
    printf 'delta\t1\t%s\n' "$job_dir/delta.packet"
  } > "$job_dir/jobs-B.tsv"
  out="$(run_fan "$job_dir/jobs-B.tsv" 'STUB_MODE=approve; STUB_BLOCK_IF_STDIN=SHARDBLOCKER')"
  if printf '%s\n' "$out" | grep -qx 'OUTCOME=BLOCK'; then
    pass "fan-agg (B): one blocking job -> aggregate BLOCK"
  else
    fail "fan-agg (B): expected BLOCK :: $out"
  fi
  if printf '%s\n' "$out" | grep -Eqx 'BLOCKERS=[2-9][0-9]*'; then
    pass "fan-agg (B): aggregate blockers UNIONED (>=2)"
  else
    fail "fan-agg (B): blockers not unioned :: $out"
  fi
  # the aggregate verdict file contains BOTH distinct blocker tags (real union)
  local vf_b
  vf_b="$(printf '%s\n' "$out" | sed -n 's/^VERDICTFILE=//p')"
  if [ -n "$vf_b" ] && [ -f "$vf_b" ] \
     && grep -q 'SHARDBLOCKER-GAMMA' "$vf_b" && grep -q 'SHARDBLOCKER-DELTA' "$vf_b"; then
    pass "fan-agg (B): aggregate verdict file unions BOTH job blockers"
  else
    fail "fan-agg (B): aggregate verdict missing a tag :: $([ -f "$vf_b" ] && jq -c '.blockers' "$vf_b" || echo no-file)"
  fi

  # ---- (C) one inconclusive (overflow) among approves -> OVERFLOW, never APPROVE ----
  {
    printf 'alpha\t1\t%s\n'   "$job_dir/alpha.packet"
    printf 'beta\t1\t%s\n'    "$job_dir/beta.packet"
    printf 'epsilon\t1\t%s\n' "$job_dir/epsilon.packet"
  } > "$job_dir/jobs-C.tsv"
  out="$(run_fan "$job_dir/jobs-C.tsv" 'STUB_MODE=approve; STUB_OVERFLOW_IF_STDIN=FAN-OVERFLOW-EPSILON')"
  if printf '%s\n' "$out" | grep -qx 'OUTCOME=APPROVE'; then
    fail "fan-agg (C): APPROVED over an inconclusive job (fail-closed VIOLATED) :: $out"
  else
    pass "fan-agg (C): inconclusive job does NOT APPROVE (fail-closed)"
  fi
  if printf '%s\n' "$out" | grep -qx 'OUTCOME=OVERFLOW'; then
    pass "fan-agg (C): surfaced outcome is OVERFLOW"
  else
    fail "fan-agg (C): expected OVERFLOW :: $out"
  fi
  if printf '%s\n' "$out" | grep -qx 'FIRSTINC=epsilon'; then
    pass "fan-agg (C): names the first inconclusive job (epsilon)"
  else
    fail "fan-agg (C): FAN_FIRST_INCONCLUSIVE wrong :: $out"
  fi

  # ---- (C2) a job whose OWN packet is over budget is inconclusive without invoking codex ----
  { for i in $(seq 1 50); do printf 'huge-line-%s padding padding padding\n' "$i"; done; } > "$job_dir/huge.packet"
  {
    printf 'alpha\t1\t%s\n' "$job_dir/alpha.packet"
    printf 'huge\t1\t%s\n'  "$job_dir/huge.packet"
  } > "$job_dir/jobs-C2.tsv"
  reset_argv_log
  out="$(CODEX_GATE_PACKET_BUDGET=200 run_fan "$job_dir/jobs-C2.tsv" 'STUB_MODE=approve')"
  if printf '%s\n' "$out" | grep -qx 'OUTCOME=OVERFLOW'; then
    pass "fan-agg (C2): a job whose own packet exceeds budget -> OVERFLOW (fail closed)"
  else
    fail "fan-agg (C2): expected OVERFLOW for over-budget job :: $out"
  fi

  # ---- (D) MUTATION-CHECK: invert the rule (treat inconclusive as APPROVE) => must APPROVE ----
  # Shadow classify_verdict_file so it ALWAYS reports APPROVE. If the helper's aggregate is
  # correctly fail-closed on its OWN over-budget pre-check, this scenario uses the codex path
  # (under budget) where the mutated classifier lies -> the all-approve branch WRONGLY fires.
  # We assert the mutant DOES flip the outcome to APPROVE (proving scenario C's OVERFLOW came
  # from the real classifier, i.e. the assertion bites: a broken aggregate would pass C).
  out="$(run_fan "$job_dir/jobs-C.tsv" 'STUB_MODE=approve; STUB_OVERFLOW_IF_STDIN=FAN-OVERFLOW-EPSILON' 'classify_verdict_file() { printf APPROVE; }')"
  if printf '%s\n' "$out" | grep -qx 'OUTCOME=APPROVE'; then
    pass "fan-agg (D mutation): inverting classify_verdict_file flips C to APPROVE (assertion bites)"
  else
    fail "fan-agg (D mutation): mutant did NOT change the outcome — scenario C may not be exercising the rule :: $out"
  fi
}

#############################################################################
# TEST 37 — build_prepr_packet: the OPTIONAL trailing per-job instruction seam [PHASE 2a]
#
#   The multi-lens path (Phase 3) will call build_prepr_packet once per persona with a
#   DIFFERENT instruction file per job, WITHOUT mutating the $INSTRUCTIONS_FILE global.
#   Drive build_prepr_packet DIRECTLY (source the wrapper, guarded main => no dispatch) over
#   a tiny real repo and assert:
#     (A) with the new 7th arg = a temp instruction file, the built packet contains THAT
#         file's unique marker (and NOT the default reviewer-instructions text).
#     (B) with NO 7th arg, the packet still uses $INSTRUCTIONS_FILE (default, unchanged).
#     (C) MUTATION-CHECK: if the seam were a no-op (build_prepr_packet ignored $7 and always
#         used $INSTRUCTIONS_FILE), scenario A's marker would be ABSENT — assert it's present,
#         then re-run with a shadow that ignores $7 and confirm the marker DISAPPEARS.
#############################################################################
run_test_37() {
  local repo pkgdir
  repo="$(make_repo)"
  printf 'seed\n' > "$repo/seed.txt"
  git -C "$repo" add seed.txt && git -C "$repo" commit -qm init
  printf 'changed line\n' >> "$repo/seed.txt"   # a tracked modification to diff

  # a per-job persona file with a marker that CANNOT appear in the default instructions
  local custom="$SANDBOX/custom-lens-instr.md"
  printf 'CUSTOM-LENS-MARKER-9F3A: review only through the widget lens.\n' > "$custom"

  # driver: source the wrapper, set the deps build_prepr_packet reads, call it, print packet
  run_bpp() { # <instr-arg-or-empty> <presource-override>
    local instr_arg="$1" override="${2:-}"
    (
      set +u
      # shellcheck disable=SC1090
      . "$WRAPPER" >/dev/null 2>&1 || { printf 'SOURCEFAIL\n'; exit 0; }
      if ! type build_prepr_packet >/dev/null 2>&1; then printf 'NOFUNC\n'; exit 0; fi
      REPO_ROOT="$repo"; RUN_DIR="$SANDBOX/bpp-run"; ROUND=1
      rm -rf "$RUN_DIR"; mkdir -p "$RUN_DIR"
      [ -n "$override" ] && eval "$override"
      local changed="$RUN_DIR/changed" untracked="$RUN_DIR/untracked" packet="$RUN_DIR/packet"
      printf 'seed.txt\n' > "$changed"; : > "$untracked"
      local base; base="$(git -C "$repo" rev-parse HEAD)"
      if [ -n "$instr_arg" ]; then
        build_prepr_packet "$packet" "$changed" "$untracked" "$base" 0 "" "$instr_arg" >/dev/null 2>&1
      else
        build_prepr_packet "$packet" "$changed" "$untracked" "$base" 0 "" >/dev/null 2>&1
      fi
      cat "$packet" 2>/dev/null
    ) 2>/dev/null
  }

  local out_custom out_default
  out_custom="$(run_bpp "$custom")"
  if printf '%s' "$out_custom" | grep -q 'SOURCEFAIL'; then
    fail "bpp: could not source wrapper"; return
  fi
  if printf '%s' "$out_custom" | grep -q 'NOFUNC'; then
    fail "bpp: build_prepr_packet not defined in wrapper"; return
  fi
  # (A) the custom instruction marker appears when the 7th arg is supplied
  if printf '%s' "$out_custom" | grep -q 'CUSTOM-LENS-MARKER-9F3A'; then
    pass "bpp (A): 7th-arg instruction file is used (custom marker present in packet)"
  else
    fail "bpp (A): custom instruction marker missing from packet"
  fi
  # (A') and the DEFAULT reviewer text is NOT what led the packet (seam replaced it)
  if printf '%s' "$out_custom" | grep -q 'THIRD independent reviewer'; then
    fail "bpp (A'): default reviewer text leaked despite a custom 7th arg"
  else
    pass "bpp (A'): default reviewer text NOT used when a 7th arg is supplied"
  fi

  # (B) no 7th arg -> default $INSTRUCTIONS_FILE (its signature phrase) is used, custom absent
  out_default="$(run_bpp "")"
  if printf '%s' "$out_default" | grep -q 'THIRD independent reviewer' \
     && ! printf '%s' "$out_default" | grep -q 'CUSTOM-LENS-MARKER-9F3A'; then
    pass "bpp (B): no 7th arg -> default \$INSTRUCTIONS_FILE used (unchanged)"
  else
    fail "bpp (B): default packet wrong (expected default reviewer text, no custom marker)"
  fi

  # (C) MUTATION-CHECK: shadow build_prepr_packet with a version that IGNORES $7 (no-op seam).
  # The custom marker must then DISAPPEAR — proving assertion (A) actually bites on the seam.
  local mut
  mut='build_prepr_packet() { local packet="$1"; cat "$INSTRUCTIONS_FILE" > "$packet"; }'
  out_custom="$(run_bpp "$custom" "$mut")"
  if printf '%s' "$out_custom" | grep -q 'CUSTOM-LENS-MARKER-9F3A'; then
    fail "bpp (C mutation): no-op seam STILL produced the custom marker (assertion A does not bite)"
  else
    pass "bpp (C mutation): a seam that ignores \$7 drops the custom marker (assertion A bites)"
  fi

  # (D) FAIL-CLOSED: a missing/unreadable custom instruction file MUST fail closed (INFRA_ERROR),
  # never silently build a persona-LESS packet and go on to invoke Codex (a fail-open review with no
  # HARD INVARIANTS). Capture build_prepr_packet's OWN stdout (die_infra prints INFRA_ERROR there).
  local out_missing
  out_missing="$(
    set +u
    . "$WRAPPER" >/dev/null 2>&1 || { printf 'SOURCEFAIL'; exit 0; }
    REPO_ROOT="$repo"; RUN_DIR="$SANDBOX/bpp-run-d"; ROUND=1; VERDICT_FILE="$SANDBOX/bpp-run-d/verdict.json"
    rm -rf "$RUN_DIR"; mkdir -p "$RUN_DIR"
    ch="$RUN_DIR/changed"; ut="$RUN_DIR/untracked"; pk="$RUN_DIR/packet"
    printf 'seed.txt\n' > "$ch"; : > "$ut"
    b="$(git -C "$repo" rev-parse HEAD)"
    build_prepr_packet "$pk" "$ch" "$ut" "$b" 0 "" "$SANDBOX/nonexistent-lens-9Z7.md" 2>/dev/null
  )"
  if printf '%s' "$out_missing" | grep -q 'INFRA_ERROR' && printf '%s' "$out_missing" | grep -qi 'not readable'; then
    pass "bpp (D): missing custom instruction file fails CLOSED (INFRA_ERROR, no persona-less packet)"
  else
    fail "bpp (D): missing custom instruction file did NOT fail closed :: [$out_missing]"
  fi
}

#############################################################################
# TEST 38 — fan_out_and_aggregate: the vocabulary seam on the aggregate .summary [PHASE 2b]
#
#   fan_out_and_aggregate words its aggregate VERDICT-FILE .summary with FAN_NOUN/FAN_NOUN_PLURAL
#   (default shard/shards). A lens caller sets FAN_NOUN=lens / FAN_NOUN_PLURAL=lenses. Assert:
#     (A) DEFAULT summary is byte-identical to the historical shard wording (all 3 branches:
#         all-approve, block-union, inconclusive) — so shard_and_review's output is unchanged.
#     (B) OVERRIDE summary says "lens"/"lenses" (never "shard"/"shards") in each branch.
#     (C) MUTATION-CHECK: an override that is a no-op (helper ignores FAN_NOUN) would leave
#         "shards" in the override run — assert the override run has NO "shard" token.
#############################################################################
run_test_38() {
  local job_dir
  job_dir="$SANDBOX/fan-vocab"
  rm -rf "$job_dir"; mkdir -p "$job_dir"
  printf 'lens-alpha packet: clean review\n' > "$job_dir/alpha.packet"
  printf 'lens-beta packet: clean review\n'  > "$job_dir/beta.packet"
  printf 'lens-gamma packet: SHARDBLOCKER-GAMMA problem\n' > "$job_dir/gamma.packet"
  printf 'lens-epsilon packet: FAN-OVERFLOW-EPSILON marker\n' > "$job_dir/epsilon.packet"

  # driver: source wrapper, run fan_out_and_aggregate, print the aggregate .summary ONLY.
  run_fan_sum() { # <jobs-file> <stub-env> <fan-env>
    local jobs="$1" stubenv="$2" fanenv="${3:-}"
    (
      set +u
      # shellcheck disable=SC1090
      . "$WRAPPER" >/dev/null 2>&1 || { printf 'SOURCEFAIL\n'; exit 0; }
      if ! type fan_out_and_aggregate >/dev/null 2>&1; then printf 'NOFUNC\n'; exit 0; fi
      RUN_DIR="$job_dir/run"; rm -rf "$RUN_DIR"; mkdir -p "$RUN_DIR"
      REPO_ROOT="$job_dir"; ROUND=1; set_round_paths
      eval "$stubenv"; [ -n "$fanenv" ] && eval "$fanenv"
      export STUB_MODE="${STUB_MODE:-approve}"
      export STUB_BLOCK_IF_STDIN="${STUB_BLOCK_IF_STDIN:-}"
      export STUB_OVERFLOW_IF_STDIN="${STUB_OVERFLOW_IF_STDIN:-}"
      export STUB_API400_IF_STDIN="${STUB_API400_IF_STDIN:-}"
      fan_out_and_aggregate "$jobs" >/dev/null 2>&1
      jq -r '.summary // ""' "$VERDICT_FILE" 2>/dev/null
    ) 2>/dev/null
  }

  # jobs files for each branch
  { printf 'alpha\t2\t%s\n' "$job_dir/alpha.packet"; printf 'beta\t3\t%s\n' "$job_dir/beta.packet"; } > "$job_dir/jobs-approve.tsv"
  { printf 'alpha\t1\t%s\n' "$job_dir/alpha.packet"; printf 'gamma\t1\t%s\n' "$job_dir/gamma.packet"; } > "$job_dir/jobs-block.tsv"
  { printf 'alpha\t1\t%s\n' "$job_dir/alpha.packet"; printf 'epsilon\t1\t%s\n' "$job_dir/epsilon.packet"; } > "$job_dir/jobs-inc.tsv"

  # ---- (A) DEFAULT wording is the historical shard wording, byte-for-byte ----
  local sA sB sI
  sA="$(run_fan_sum "$job_dir/jobs-approve.tsv" 'STUB_MODE=approve')"
  if printf '%s' "$sA" | grep -q 'SOURCEFAIL\|NOFUNC'; then fail "fan-vocab: source/func setup failed :: $sA"; return; fi
  if [ "$sA" = "sharded review: 2 shards all approved (5 files, full coverage)" ]; then
    pass "fan-vocab (A): default all-approve summary is byte-identical shard wording"
  else
    fail "fan-vocab (A): default all-approve summary drifted :: $sA"
  fi
  sB="$(run_fan_sum "$job_dir/jobs-block.tsv" 'STUB_MODE=approve; STUB_BLOCK_IF_STDIN=SHARDBLOCKER')"
  if [ "$sB" = "sharded review: one or more shards reported blockers (union)" ]; then
    pass "fan-vocab (A): default block-union summary is byte-identical shard wording"
  else
    fail "fan-vocab (A): default block-union summary drifted :: $sB"
  fi
  sI="$(run_fan_sum "$job_dir/jobs-inc.tsv" 'STUB_MODE=approve; STUB_OVERFLOW_IF_STDIN=FAN-OVERFLOW-EPSILON')"
  if [ "$sI" = "shard epsilon inconclusive" ]; then
    pass "fan-vocab (A): default inconclusive summary is byte-identical shard wording"
  else
    fail "fan-vocab (A): default inconclusive summary drifted :: $sI"
  fi

  # ---- (B) OVERRIDE wording says lens/lenses, never shard/shards ----
  local lA lB lI
  lA="$(run_fan_sum "$job_dir/jobs-approve.tsv" 'STUB_MODE=approve' 'FAN_NOUN=lens; FAN_NOUN_PLURAL=lenses')"
  if printf '%s' "$lA" | grep -q 'lenses' && ! printf '%s' "$lA" | grep -q 'shard'; then
    pass "fan-vocab (B): override all-approve summary uses 'lenses' (no 'shard')"
  else
    fail "fan-vocab (B): override all-approve summary wrong :: $lA"
  fi
  lB="$(run_fan_sum "$job_dir/jobs-block.tsv" 'STUB_MODE=approve; STUB_BLOCK_IF_STDIN=SHARDBLOCKER' 'FAN_NOUN=lens; FAN_NOUN_PLURAL=lenses')"
  if printf '%s' "$lB" | grep -q 'lenses' && ! printf '%s' "$lB" | grep -q 'shard'; then
    pass "fan-vocab (B): override block-union summary uses 'lenses' (no 'shard')"
  else
    fail "fan-vocab (B): override block-union summary wrong :: $lB"
  fi
  lI="$(run_fan_sum "$job_dir/jobs-inc.tsv" 'STUB_MODE=approve; STUB_OVERFLOW_IF_STDIN=FAN-OVERFLOW-EPSILON' 'FAN_NOUN=lens; FAN_NOUN_PLURAL=lenses')"
  if printf '%s' "$lI" | grep -q 'lens ' && ! printf '%s' "$lI" | grep -q 'shard'; then
    pass "fan-vocab (B): override inconclusive summary uses 'lens' (no 'shard')"
  else
    fail "fan-vocab (B): override inconclusive summary wrong :: $lI"
  fi

  # ---- (C) MUTATION-CHECK: the override MUST actually change the wording ----
  # sA (default) and lA (override) must DIFFER; if the seam were a no-op they'd be identical.
  if [ "$sA" != "$lA" ] && printf '%s' "$lA" | grep -q 'lenses'; then
    pass "fan-vocab (C mutation): override wording differs from default (seam is not a no-op)"
  else
    fail "fan-vocab (C mutation): override wording == default -> vocabulary seam is a no-op :: def='$sA' ovr='$lA'"
  fi
}

#############################################################################
# TEST 39 — the 4 lens persona files exist AND each carries the shared contract [PHASE 2c]
#
#   The lens dispatch (Phase 3) will feed one of these persona files per reviewer thread.
#   EACH persona must preserve the base HARD INVARIANTS + the G6 must-fix->blockers[] rule,
#   or a lens whose must-fix items skip blockers[] would classify as inconclusive downstream.
#   Assert (grep-level contract check) that every lens file exists and contains:
#     - single-JSON invariant ("EXACTLY ONE JSON object")
#     - read-only invariant ("read-only")
#     - the G6 must-fix -> blockers[] contract (a MUST-FIX ... belongs in / goes in blockers[])
#     - the LENS SCOPE directive
#   The frontend lens additionally carries its "no frontend surface" no-fabrication rule.
#############################################################################
run_test_39() {
  local skill_dir lens f
  skill_dir="$TEST_DIR"   # persona files live next to reviewer-instructions.md (== wrapper dir)
  for lens in arch security tests frontend; do
    f="$skill_dir/reviewer-instructions.$lens.md"
    if [ ! -f "$f" ]; then
      fail "lens-persona ($lens): file missing at $f"; continue
    fi
    pass "lens-persona ($lens): file exists"
    # single-JSON-object invariant
    if grep -q 'EXACTLY ONE JSON object' "$f"; then
      pass "lens-persona ($lens): carries single-JSON-object invariant"
    else
      fail "lens-persona ($lens): missing single-JSON-object invariant"
    fi
    # read-only invariant
    if grep -q 'read-only' "$f"; then
      pass "lens-persona ($lens): carries read-only invariant"
    else
      fail "lens-persona ($lens): missing read-only invariant"
    fi
    # G6: must-fix -> blockers[] (case-insensitive on MUST-FIX, requires the words blockers[])
    if grep -qi 'must-fix' "$f" && grep -qi 'belongs in blockers\[\]' "$f"; then
      pass "lens-persona ($lens): carries G6 must-fix->blockers[] contract"
    else
      fail "lens-persona ($lens): missing G6 must-fix->blockers[] contract"
    fi
    # LENS SCOPE directive present
    if grep -q 'LENS SCOPE' "$f"; then
      pass "lens-persona ($lens): carries the LENS SCOPE directive"
    else
      fail "lens-persona ($lens): missing the LENS SCOPE directive"
    fi
    # scope-DISTINCTNESS: each lens must carry its OWN unique focus keyword. Guards against a
    # future edit collapsing one lens's scope onto another's (a swap the presence-greps above
    # would miss — the "union = 4x the same finding" risk). Uniqueness verified: arch has no
    # 'injection'/'accessibility', etc.
    case "$lens" in
      arch)     kw='layering' ;;
      security) kw='injection' ;;
      tests)    kw='false-green' ;;
      frontend) kw='accessibility' ;;
      *)        kw='' ;;
    esac
    if [ -n "$kw" ] && grep -qi "$kw" "$f"; then
      pass "lens-persona ($lens): carries its distinctive scope keyword '$kw'"
    else
      fail "lens-persona ($lens): missing distinctive scope keyword '$kw' (scope drift/collapse?)"
    fi
  done
  # frontend-specific no-fabrication rule (note: wording may wrap across lines, so match the
  # note phrase and the never-fabricate directive independently rather than as one line).
  f="$skill_dir/reviewer-instructions.frontend.md"
  if [ -f "$f" ] && grep -qi 'no frontend surface in this' "$f" && grep -qi 'NEVER fabricate' "$f"; then
    pass "lens-persona (frontend): carries the 'no FE surface -> approve, never fabricate' rule"
  else
    fail "lens-persona (frontend): missing the no-fabrication / no-FE-surface rule"
  fi
}


#############################################################################
# TEST 40 — multi-lens DISPATCH fires on --multi AND CODEX_GATE_FANOUT=1 [PHASE 3a]
#   A non-FE diff resolves to the 3 core lenses (arch/security/tests). Both triggers
#   (the --multi flag and the env knob) must reach the multi-lens path: aggregate
#   APPROVE, an additive lenses[] of length 3, per-lens verdict files, the stub invoked
#   ONCE per lens (3), the shards[] key ABSENT (bypassed sharding), coverage preserved.
#   MUTATION sense: without dispatch this would be a single-thread review (1 stub call,
#   no lenses[]); we assert 3 calls + lenses[] present.
#############################################################################
run_test_40() {
  local repo status outcome runDir ncalls trigger
  for trigger in flag env; do
    repo="$(make_repo)"
    printf 'seed\n' > "$repo/seed.txt"
    git -C "$repo" add seed.txt && git -C "$repo" commit -qm init
    printf 'a non-fe change\n' >> "$repo/seed.txt"   # .txt => NOT a FE path => 3 core lenses
    reset_argv_log
    if [ "$trigger" = "flag" ]; then
      ( cd "$repo" && STUB_MODE=approve bash "$WRAPPER" prepr --multi ) > "$SANDBOX/out.txt" 2>"$SANDBOX/err.txt"
    else
      ( cd "$repo" && STUB_MODE=approve CODEX_GATE_FANOUT=1 bash "$WRAPPER" prepr ) > "$SANDBOX/out.txt" 2>"$SANDBOX/err.txt"
    fi
    status="$(last_json_line "$SANDBOX/out.txt")"
    outcome="$(printf '%s' "$status" | jq -r '.outcome // empty')"
    runDir="$(printf '%s' "$status" | jq -r '.runDir // empty')"

    if [ "$outcome" = "APPROVE" ]; then
      pass "multi-dispatch[$trigger]: over a non-FE diff aggregates to APPROVE"
    else
      fail "multi-dispatch[$trigger]: expected APPROVE got '$outcome' :: $status :: $(cat "$SANDBOX/err.txt")"
    fi
    # additive lenses[] present with exactly the 3 core lenses
    if printf '%s' "$status" | jq -e '(.lenses|type=="array") and (.lenses|length==3)' >/dev/null 2>&1; then
      pass "multi-dispatch[$trigger]: status carries lenses[] of length 3"
    else
      fail "multi-dispatch[$trigger]: lenses[] missing/wrong :: $status"
    fi
    if printf '%s' "$status" | jq -e '([.lenses[].lens]|sort)==["arch","security","tests"]' >/dev/null 2>&1; then
      pass "multi-dispatch[$trigger]: applicable lens set is arch/security/tests (no frontend for non-FE diff)"
    else
      fail "multi-dispatch[$trigger]: lens set wrong :: $(printf '%s' "$status" | jq -c '[.lenses[].lens]')"
    fi
    # each lenses[] entry has lens/outcome/verdictPath
    if printf '%s' "$status" | jq -e '.lenses|all(.[]; has("lens") and has("outcome") and has("verdictPath"))' >/dev/null 2>&1; then
      pass "multi-dispatch[$trigger]: each lenses[] entry has lens/outcome/verdictPath"
    else
      fail "multi-dispatch[$trigger]: lenses[] entries missing keys :: $(printf '%s' "$status" | jq -c '.lenses')"
    fi
    # per-lens verdict files persisted under the run dir
    local ok=0
    [ -f "$runDir/lens-arch-verdict.json" ]     || ok=1
    [ -f "$runDir/lens-security-verdict.json" ] || ok=1
    [ -f "$runDir/lens-tests-verdict.json" ]    || ok=1
    check "multi-dispatch[$trigger]: per-lens verdict files (arch/security/tests) persisted" "$ok"
    # stub invoked once PER lens (3)
    ncalls="$(grep -c -- '---END-ARGV---' "$STUB_ARGV_LOG")"
    if [ "$ncalls" -eq 3 ]; then
      pass "multi-dispatch[$trigger]: stub invoked once per lens (3 fresh-thread reviews)"
    else
      fail "multi-dispatch[$trigger]: expected 3 stub calls got $ncalls"
    fi
    # sharding was BYPASSED: no shards[] key on a multi-lens status
    if printf '%s' "$status" | jq -e 'has("shards")' >/dev/null 2>&1; then
      fail "multi-dispatch[$trigger]: status wrongly carries shards[] (sharding not bypassed) :: $status"
    else
      pass "multi-dispatch[$trigger]: no shards[] key (sharding bypassed, non-composable)"
    fi
    # coverage object preserved (additive Tier-2 field)
    if printf '%s' "$status" | jq -e 'has("coverage") and (.coverage.reviewedNow>=1)' >/dev/null 2>&1; then
      pass "multi-dispatch[$trigger]: coverage object preserved"
    else
      fail "multi-dispatch[$trigger]: coverage object missing :: $(printf '%s' "$status" | jq -c '.coverage // empty')"
    fi
  done
}

#############################################################################
# TEST 41 — frontend lens applies ONLY when the diff touches a FE path [PHASE 3a]
#   A diff that touches a .tsx file resolves to 4 lenses (adds frontend); a diff that
#   touches only non-FE files resolves to 3. Proves the FE-path gate.
#############################################################################
run_test_41() {
  local repo status
  # (A) FE diff -> frontend lens present (4 lenses)
  repo="$(make_repo)"
  printf 'seed\n' > "$repo/seed.txt"
  git -C "$repo" add seed.txt && git -C "$repo" commit -qm init
  printf 'export const X = 1;\n' > "$repo/Widget.tsx"    # untracked FE source
  reset_argv_log
  ( cd "$repo" && STUB_MODE=approve bash "$WRAPPER" prepr --multi ) > "$SANDBOX/out.txt" 2>"$SANDBOX/err.txt"
  status="$(last_json_line "$SANDBOX/out.txt")"
  if printf '%s' "$status" | jq -e '([.lenses[].lens]|sort)==["arch","frontend","security","tests"]' >/dev/null 2>&1; then
    pass "fe-lens: a .tsx in the diff adds the frontend lens (4 lenses)"
  else
    fail "fe-lens: expected 4 lenses incl frontend :: $(printf '%s' "$status" | jq -c '[.lenses[].lens]')"
  fi
  # stub called 4x (one per lens)
  local ncalls; ncalls="$(grep -c -- '---END-ARGV---' "$STUB_ARGV_LOG")"
  check "fe-lens: stub invoked once per lens (4)" "$([ "$ncalls" -eq 4 ] && echo 0 || echo 1)"

  # (B) non-FE diff -> NO frontend lens (3 lenses) [complements TEST 40; a direct pairing]
  repo="$(make_repo)"
  printf 'seed\n' > "$repo/seed.txt"
  git -C "$repo" add seed.txt && git -C "$repo" commit -qm init
  printf 'plain text change\n' > "$repo/notes.md"        # docs, not FE
  ( cd "$repo" && STUB_MODE=approve bash "$WRAPPER" prepr --multi ) > "$SANDBOX/out.txt" 2>"$SANDBOX/err.txt"
  status="$(last_json_line "$SANDBOX/out.txt")"
  if printf '%s' "$status" | jq -e '[.lenses[].lens]|index("frontend")|not' >/dev/null 2>&1 \
     && printf '%s' "$status" | jq -e '(.lenses|length)==3' >/dev/null 2>&1; then
    pass "fe-lens: a non-FE diff (.md only) does NOT add the frontend lens (3 lenses)"
  else
    fail "fe-lens: non-FE diff wrongly resolved a frontend lens :: $(printf '%s' "$status" | jq -c '[.lenses[].lens]')"
  fi
}

#############################################################################
# TEST 42 — MAX_LENSES exceeded => INFRA_ERROR with ZERO codex calls [PHASE 3a]
#   Lower CODEX_GATE_FANOUT_MAX_LENSES below the applicable set size and assert the run
#   FAILS CLOSED: outcome INFRA_ERROR, ZERO stub invocations, NO per-lens verdict files.
#   MUTATION-CHECK: a TRUNCATING impl (review only the first MAX lenses) would still make
#   codex calls; we assert the stub argv log has 0 invocations. Then, as a positive control,
#   raise the cap and confirm the SAME diff DOES review (proving the cap was the gate).
#############################################################################
run_test_42() {
  local repo status outcome runDir ncalls
  repo="$(make_repo)"
  printf 'seed\n' > "$repo/seed.txt"
  git -C "$repo" add seed.txt && git -C "$repo" commit -qm init
  printf 'export const X=1;\n' > "$repo/Widget.tsx"      # FE diff => 4 applicable lenses
  reset_argv_log
  # cap = 3, applicable = 4 => must fail closed with ZERO calls
  ( cd "$repo" && STUB_MODE=approve CODEX_GATE_FANOUT_MAX_LENSES=3 bash "$WRAPPER" prepr --multi ) > "$SANDBOX/out.txt" 2>"$SANDBOX/err.txt"
  status="$(last_json_line "$SANDBOX/out.txt")"
  outcome="$(printf '%s' "$status" | jq -r '.outcome // empty')"
  runDir="$(printf '%s' "$status" | jq -r '.runDir // empty')"

  if [ "$outcome" = "INFRA_ERROR" ]; then
    pass "max-lenses: applicable set > cap fails CLOSED (INFRA_ERROR)"
  else
    fail "max-lenses: expected INFRA_ERROR got '$outcome' :: $status :: $(cat "$SANDBOX/err.txt")"
  fi
  if printf '%s' "$status" | jq -r '.summary // ""' | grep -qi 'exceeds CODEX_GATE_FANOUT_MAX_LENSES'; then
    pass "max-lenses: summary names the cap (exceeds CODEX_GATE_FANOUT_MAX_LENSES)"
  else
    fail "max-lenses: summary missing the cap message :: $(printf '%s' "$status" | jq -r '.summary')"
  fi
  # THE key fail-closed assertion (mutation-bite): ZERO codex invocations.
  ncalls="$(grep -c -- '---END-ARGV---' "$STUB_ARGV_LOG" 2>/dev/null)"; [ -n "$ncalls" ] || ncalls=0
  if [ "$ncalls" -eq 0 ]; then
    pass "max-lenses: ZERO codex calls when the cap is exceeded (a truncating impl would call)"
  else
    fail "max-lenses: expected 0 codex calls got $ncalls (fail-closed VIOLATED — likely truncating) :: $(cat "$STUB_ARGV_LOG")"
  fi
  # NO per-lens verdict files were written (nothing was reviewed)
  if ls "$runDir"/lens-*-verdict.json >/dev/null 2>&1; then
    fail "max-lenses: per-lens verdict files exist despite fail-closed :: $(ls "$runDir"/lens-*-verdict.json)"
  else
    pass "max-lenses: NO per-lens verdict files (nothing reviewed)"
  fi
  # positive control: raise the cap to 4 => the SAME diff DOES review (4 lenses, APPROVE).
  reset_argv_log
  ( cd "$repo" && STUB_MODE=approve CODEX_GATE_FANOUT_MAX_LENSES=4 bash "$WRAPPER" prepr --multi ) > "$SANDBOX/out2.txt" 2>"$SANDBOX/err2.txt"
  status="$(last_json_line "$SANDBOX/out2.txt")"
  ncalls="$(grep -c -- '---END-ARGV---' "$STUB_ARGV_LOG" 2>/dev/null)"; [ -n "$ncalls" ] || ncalls=0
  if [ "$(printf '%s' "$status" | jq -r '.outcome')" = "APPROVE" ] && [ "$ncalls" -eq 4 ]; then
    pass "max-lenses: raising the cap to 4 reviews the SAME diff (4 calls, APPROVE) — the cap was the gate"
  else
    fail "max-lenses: positive control failed (outcome=$(printf '%s' "$status" | jq -r '.outcome') calls=$ncalls)"
  fi
  # malformed knob must fail CLOSED (a bad value would otherwise make the -gt test error and fall
  # through / fail OPEN). Expect INFRA_ERROR with ZERO codex calls.
  reset_argv_log
  ( cd "$repo" && STUB_MODE=approve CODEX_GATE_FANOUT_MAX_LENSES=abc bash "$WRAPPER" prepr --multi ) > "$SANDBOX/out3.txt" 2>"$SANDBOX/err3.txt"
  status="$(last_json_line "$SANDBOX/out3.txt")"
  ncalls="$(grep -c -- '---END-ARGV---' "$STUB_ARGV_LOG" 2>/dev/null)"; [ -n "$ncalls" ] || ncalls=0
  if [ "$(printf '%s' "$status" | jq -r '.outcome // empty')" = "INFRA_ERROR" ] && [ "$ncalls" -eq 0 ]; then
    pass "max-lenses: a malformed CODEX_GATE_FANOUT_MAX_LENSES fails CLOSED (INFRA_ERROR, 0 calls)"
  else
    fail "max-lenses: malformed cap did not fail closed (outcome=$(printf '%s' "$status" | jq -r '.outcome') calls=$ncalls) :: $status"
  fi
}

#############################################################################
# TEST 43 — --multi is non-composable with sharding: over-budget => OVERFLOW, never shard [PHASE 3b]
#   With a tiny budget so each lens FULL-diff packet is over budget, a multi-lens run must
#   fail closed to OVERFLOW (NOT shard). Assert: outcome OVERFLOW, ZERO codex calls (the
#   over-budget check is pre-flight), NO shard verdict files, NO lens verdict files, and the
#   summary tells the user to narrow (prepr-delta --multi) or drop --multi.
#############################################################################
run_test_43() {
  local repo status outcome runDir ncalls i
  repo="$(make_repo)"
  printf 'seed\n' > "$repo/seed.txt"
  git -C "$repo" add seed.txt && git -C "$repo" commit -qm init
  { for i in $(seq 1 60); do printf 'src-line-%s padding padding\n' "$i"; done; } > "$repo/app.js"  # ~1.6KB body
  reset_argv_log
  # Tiny budget so even a single-lens FULL packet blows it; SHARD=auto to prove multi-lens
  # does NOT hand off to sharding.
  ( cd "$repo" && CODEX_GATE_PACKET_BUDGET=200 CODEX_GATE_SHARD=auto STUB_MODE=approve \
       bash "$WRAPPER" prepr --multi ) > "$SANDBOX/out.txt" 2>"$SANDBOX/err.txt"
  status="$(last_json_line "$SANDBOX/out.txt")"
  outcome="$(printf '%s' "$status" | jq -r '.outcome // empty')"
  runDir="$(printf '%s' "$status" | jq -r '.runDir // empty')"

  if [ "$outcome" = "OVERFLOW" ]; then
    pass "multi-nobudget: over-budget multi-lens fails closed to OVERFLOW (never shards)"
  else
    fail "multi-nobudget: expected OVERFLOW got '$outcome' :: $status :: $(cat "$SANDBOX/err.txt")"
  fi
  ncalls="$(grep -c -- '---END-ARGV---' "$STUB_ARGV_LOG" 2>/dev/null)"; [ -n "$ncalls" ] || ncalls=0
  if [ "$ncalls" -eq 0 ]; then
    pass "multi-nobudget: ZERO codex calls (over-budget is a pre-flight fail-closed gate)"
  else
    fail "multi-nobudget: expected 0 codex calls got $ncalls"
  fi
  if ls "$runDir"/shard-*-verdict.json >/dev/null 2>&1; then
    fail "multi-nobudget: shard verdict files produced — multi-lens WRONGLY sharded :: $(ls "$runDir"/shard-*-verdict.json)"
  else
    pass "multi-nobudget: NO shard verdict files (mutually exclusive with sharding)"
  fi
  if printf '%s' "$status" | jq -e 'has("shards")' >/dev/null 2>&1; then
    fail "multi-nobudget: status carries shards[] — sharding was not bypassed :: $status"
  else
    pass "multi-nobudget: status has no shards[] key"
  fi
  if printf '%s' "$status" | jq -r '.summary // ""' | grep -qi 'prepr-delta --multi'; then
    pass "multi-nobudget: summary tells the user to narrow via 'prepr-delta --multi'"
  else
    fail "multi-nobudget: summary missing the narrow guidance :: $(printf '%s' "$status" | jq -r '.summary')"
  fi
  # 3e (fail-closed provenance): even the over-budget OVERFLOW status carries additive lenses[],
  # with the over-budget lens marked OVERFLOW (and no shards[]).
  if printf '%s' "$status" | jq -e '(.lenses | type=="array") and (.lenses | length >= 1) and (any(.lenses[]; .outcome=="OVERFLOW"))' >/dev/null 2>&1; then
    pass "multi-nobudget: OVERFLOW status carries lenses[] provenance (over-budget lens = OVERFLOW)"
  else
    fail "multi-nobudget: OVERFLOW status missing lenses[] provenance :: $status"
  fi

  # MALFORMED budget knob must fail CLOSED (a non-numeric value would otherwise make the `-gt`
  # comparison error and fall through / fail OPEN, invoking codex). Cover BOTH the --multi path
  # and the normal (non-multi) path — the guard is central in _prepr_common. Expect INFRA_ERROR, 0 calls.
  local mstatus mcalls
  reset_argv_log
  ( cd "$repo" && CODEX_GATE_PACKET_BUDGET=abc STUB_MODE=approve bash "$WRAPPER" prepr --multi ) > "$SANDBOX/outm.txt" 2>"$SANDBOX/errm.txt"
  mstatus="$(last_json_line "$SANDBOX/outm.txt")"
  mcalls="$(grep -c -- '---END-ARGV---' "$STUB_ARGV_LOG" 2>/dev/null)"; [ -n "$mcalls" ] || mcalls=0
  if [ "$(printf '%s' "$mstatus" | jq -r '.outcome // empty')" = "INFRA_ERROR" ] && [ "$mcalls" -eq 0 ]; then
    pass "budget-validate: malformed CODEX_GATE_PACKET_BUDGET fails CLOSED under --multi (INFRA_ERROR, 0 calls)"
  else
    fail "budget-validate: malformed budget did not fail closed under --multi (outcome=$(printf '%s' "$mstatus" | jq -r '.outcome') calls=$mcalls) :: $mstatus"
  fi
  reset_argv_log
  ( cd "$repo" && CODEX_GATE_PACKET_BUDGET=abc STUB_MODE=approve bash "$WRAPPER" prepr ) > "$SANDBOX/outn.txt" 2>"$SANDBOX/errn.txt"
  mstatus="$(last_json_line "$SANDBOX/outn.txt")"
  mcalls="$(grep -c -- '---END-ARGV---' "$STUB_ARGV_LOG" 2>/dev/null)"; [ -n "$mcalls" ] || mcalls=0
  if [ "$(printf '%s' "$mstatus" | jq -r '.outcome // empty')" = "INFRA_ERROR" ] && [ "$mcalls" -eq 0 ]; then
    pass "budget-validate: malformed CODEX_GATE_PACKET_BUDGET fails CLOSED on the NORMAL path too (INFRA_ERROR, 0 calls)"
  else
    fail "budget-validate: malformed budget did not fail closed on the normal path (outcome=$(printf '%s' "$mstatus" | jq -r '.outcome') calls=$mcalls) :: $mstatus"
  fi
}

#############################################################################
# TEST 44 — any lens inconclusive => whole run OVERFLOWs (fail closed) [PHASE 3 fail-closed]
#   All lenses review the SAME diff; STUB_OVERFLOW_IF_STDIN matches a marker that appears in
#   EVERY lens packet (same full diff), so at least one lens call returns the context-window
#   signature. The aggregate must NOT APPROVE — it fails closed to OVERFLOW.
#############################################################################
run_test_44() {
  local repo status outcome
  repo="$(make_repo)"
  printf 'seed\n' > "$repo/seed.txt"
  git -C "$repo" add seed.txt && git -C "$repo" commit -qm init
  printf 'src line MULTI-LENS-OVERFLOW-MARK\n' >> "$repo/seed.txt"
  ( cd "$repo" && STUB_MODE=approve STUB_OVERFLOW_IF_STDIN=MULTI-LENS-OVERFLOW-MARK \
       bash "$WRAPPER" prepr --multi ) > "$SANDBOX/out.txt" 2>"$SANDBOX/err.txt"
  status="$(last_json_line "$SANDBOX/out.txt")"
  outcome="$(printf '%s' "$status" | jq -r '.outcome // empty')"
  if [ "$outcome" = "APPROVE" ]; then
    fail "multi-failclosed: APPROVED despite an inconclusive lens :: $status"
  else
    pass "multi-failclosed: an inconclusive lens does NOT APPROVE (got $outcome)"
  fi
  if [ "$outcome" = "OVERFLOW" ]; then
    pass "multi-failclosed: surfaced outcome is OVERFLOW"
  else
    fail "multi-failclosed: expected OVERFLOW got '$outcome' :: $status"
  fi
  if printf '%s' "$status" | jq -e '[.lenses[]? | select(.outcome=="OVERFLOW" or .outcome=="INFRA_ERROR")]|length>=1' >/dev/null 2>&1; then
    pass "multi-failclosed: lenses[] records the inconclusive lens"
  else
    fail "multi-failclosed: lenses[] missing the inconclusive lens :: $(printf '%s' "$status" | jq -c '.lenses')"
  fi
}

#############################################################################
# TEST 45 — cross-lens blocker DE-DUP (G3) [PHASE 3d]
#   Two lenses report the SAME finding (same file+line+issue); a third reports a DISTINCT
#   one. The aggregate BLOCK must collapse the duplicate to ONE blocker (dedup), so the count
#   reflects DISTINCT findings, not lens count. Driven by the DEDUP-shaped stub mode below.
#   MUTATION sense: without dedup the union would carry 3 blockers (2 identical); we assert 2.
#############################################################################
run_test_45() {
  local repo status outcome vpath nb
  repo="$(make_repo)"
  printf 'seed\n' > "$repo/seed.txt"
  git -C "$repo" add seed.txt && git -C "$repo" commit -qm init
  printf 'a change to force a non-empty diff\n' >> "$repo/seed.txt"
  # STUB_MODE=lens_dedup: each lens emits blockers keyed to its OWN persona-marker in the
  # packet. arch+security emit the SAME shared blocker (file=shared.js,line=7,issue=DUPE);
  # tests emits a DISTINCT one. The stub greps the lens persona marker from stdin.
  ( cd "$repo" && STUB_MODE=lens_dedup bash "$WRAPPER" prepr --multi ) > "$SANDBOX/out.txt" 2>"$SANDBOX/err.txt"
  status="$(last_json_line "$SANDBOX/out.txt")"
  outcome="$(printf '%s' "$status" | jq -r '.outcome // empty')"
  vpath="$(printf '%s' "$status" | jq -r '.verdictPath // empty')"

  if [ "$outcome" = "BLOCK" ]; then
    pass "multi-dedup: a blocking lens set aggregates to BLOCK"
  else
    fail "multi-dedup: expected BLOCK got '$outcome' :: $status :: $(cat "$SANDBOX/err.txt")"
  fi
  # DISTINCT blockers after dedup == 2 (the shared DUPE collapses to one; tests contributes one).
  nb="$(printf '%s' "$status" | jq -r '.blockers // 0')"
  if [ "$nb" = "2" ]; then
    pass "multi-dedup: cross-lens duplicate collapses -> 2 DISTINCT blockers (not 3)"
  else
    fail "multi-dedup: expected 2 distinct blockers got $nb :: $([ -f "$vpath" ] && jq -c '.blockers' "$vpath" || echo no-file)"
  fi
  # the verdict file has EXACTLY one entry for the shared DUPE issue (dedup applied to the file too)
  if [ -f "$vpath" ] && [ "$(jq -r '[.blockers[]|select(.issue=="DUPE-FINDING")]|length' "$vpath" 2>/dev/null)" = "1" ]; then
    pass "multi-dedup: the shared finding appears exactly ONCE in the union verdict file"
  else
    fail "multi-dedup: shared finding not de-duped in verdict file :: $([ -f "$vpath" ] && jq -c '[.blockers[].issue]' "$vpath" || echo no-file)"
  fi
  # and the DISTINCT finding survived
  if [ -f "$vpath" ] && jq -e '[.blockers[]|select(.issue=="TESTS-ONLY-FINDING")]|length==1' "$vpath" >/dev/null 2>&1; then
    pass "multi-dedup: the distinct (tests-only) finding survives dedup"
  else
    fail "multi-dedup: distinct finding lost :: $([ -f "$vpath" ] && jq -c '[.blockers[].issue]' "$vpath" || echo no-file)"
  fi
}

#############################################################################
# TEST 45b — dedup_verdict_blockers is a NO-OP on an already-unique set (SHARD-path safety)
#   Drive dedup_verdict_blockers DIRECTLY (source the wrapper) over a verdict file whose
#   blockers are already distinct; assert the count is unchanged. Proves the dedup helper
#   never alters a unique set (so the shard path, which only ever produces disjoint-by-path
#   blockers, is unaffected even though it never calls dedup).
#############################################################################
run_test_45b() {
  local out
  out="$(
    set +u
    . "$WRAPPER" >/dev/null 2>&1 || { printf 'SOURCEFAIL'; exit 0; }
    type dedup_verdict_blockers >/dev/null 2>&1 || { printf 'NOFUNC'; exit 0; }
    vf="$SANDBOX/dedup-unique.json"
    printf '%s\n' '{"verdict":"request_changes","summary":"x","blockers":[{"class":"agent_fixable","file":"a.js","line":1,"issue":"one"},{"class":"agent_fixable","file":"b.js","line":2,"issue":"two"}],"nonBlocking":[]}' > "$vf"
    dedup_verdict_blockers "$vf"
    jq -r '(.blockers//[])|length' "$vf"
  )"
  if [ "$out" = "2" ]; then
    pass "dedup-noop: dedup leaves an already-unique 2-blocker set unchanged (shard path safe)"
  else
    fail "dedup-noop: expected 2 got '$out' (dedup altered a unique set)"
  fi
}

#############################################################################
# TEST 46 — additive lenses[] present; existing required status fields intact [PHASE 3e]
#   A multi-lens APPROVE status must carry ALL the usual required fields (outcome/threadId/
#   round/verdictPath/runDir/blockers/agentFixableBlockers/decisionBlockers/summary) PLUS
#   the additive lenses[] — and must NOT carry shards[]. Guards field-shape stability for
#   existing single-thread + shards[] consumers.
#############################################################################
run_test_46() {
  local repo status
  repo="$(make_repo)"
  printf 'seed\n' > "$repo/seed.txt"
  git -C "$repo" add seed.txt && git -C "$repo" commit -qm init
  printf 'a change\n' >> "$repo/seed.txt"
  ( cd "$repo" && STUB_MODE=approve bash "$WRAPPER" prepr --multi ) > "$SANDBOX/out.txt" 2>"$SANDBOX/err.txt"
  status="$(last_json_line "$SANDBOX/out.txt")"
  if printf '%s' "$status" | jq -e 'has("outcome") and has("threadId") and has("round") and has("verdictPath") and has("runDir") and has("blockers") and has("agentFixableBlockers") and has("decisionBlockers") and has("summary")' >/dev/null 2>&1; then
    pass "lenses-status: all existing required status fields are present"
  else
    fail "lenses-status: a required status field is missing :: $status"
  fi
  if printf '%s' "$status" | jq -e '(.lenses|type)=="array"' >/dev/null 2>&1; then
    pass "lenses-status: additive lenses[] array present"
  else
    fail "lenses-status: additive lenses[] missing :: $status"
  fi
  if printf '%s' "$status" | jq -e 'has("shards")|not' >/dev/null 2>&1; then
    pass "lenses-status: no shards[] on the multi-lens path (existing shard consumers unaffected)"
  else
    fail "lenses-status: shards[] wrongly present :: $status"
  fi
}

#############################################################################
# TEST 47 — ledger NO over-claim (G5) [PHASE 3f]
#   A multi-lens APPROVE must NOT write per-file approved-sha ledger rows. Proof: after a
#   `prepr --multi` APPROVE, a subsequent single-thread `prepr-delta` (NO --multi) must STILL
#   review the file (its reviewedNow must include it) — i.e. the lens APPROVE did not mark the
#   file as since-reviewed. Contrast control: a NORMAL single-thread `prepr` APPROVE on the
#   same setup DOES let the next prepr-delta skip the file (reviewedNow drops to 0), proving
#   the ledger-append path exists and that the multi-lens path deliberately abstains.
#############################################################################
run_test_47() {
  local repo status rn

  # ---- (A) multi-lens APPROVE must NOT create a since-reviewed skip ----
  repo="$(make_repo)"
  printf 'seed\n' > "$repo/seed.txt"
  git -C "$repo" add seed.txt && git -C "$repo" commit -qm init
  printf 'a change\n' >> "$repo/seed.txt"
  ( cd "$repo" && STUB_MODE=approve bash "$WRAPPER" prepr --multi ) >/dev/null 2>"$SANDBOX/err.txt"
  # now a delta with NO --multi: the file must STILL be reviewed-now (not skipped)
  ( cd "$repo" && STUB_MODE=approve bash "$WRAPPER" prepr-delta ) > "$SANDBOX/out.txt" 2>>"$SANDBOX/err.txt"
  status="$(last_json_line "$SANDBOX/out.txt")"
  rn="$(printf '%s' "$status" | jq -r '.coverage.reviewedNow // -1')"
  if [ "$rn" -ge 1 ]; then
    pass "ledger-noclaim (A): after a --multi APPROVE, prepr-delta STILL reviews the file (reviewedNow>=1)"
  else
    fail "ledger-noclaim (A): a --multi APPROVE wrongly marked the file since-reviewed (reviewedNow=$rn) :: $status"
  fi

  # ---- (B) contrast control: a NORMAL prepr APPROVE DOES let the next delta skip ----
  repo="$(make_repo)"
  printf 'seed\n' > "$repo/seed.txt"
  git -C "$repo" add seed.txt && git -C "$repo" commit -qm init
  printf 'a change\n' >> "$repo/seed.txt"
  ( cd "$repo" && STUB_MODE=approve bash "$WRAPPER" prepr ) >/dev/null 2>>"$SANDBOX/err.txt"
  ( cd "$repo" && STUB_MODE=approve bash "$WRAPPER" prepr-delta ) > "$SANDBOX/out2.txt" 2>>"$SANDBOX/err.txt"
  status="$(last_json_line "$SANDBOX/out2.txt")"
  rn="$(printf '%s' "$status" | jq -r '.coverage.reviewedNow // -1')"
  local pr="$(printf '%s' "$status" | jq -r '.coverage.priorHashMatch // -1')"
  if [ "$rn" = "0" ] && [ "$pr" -ge 1 ]; then
    pass "ledger-noclaim (B control): a NORMAL prepr APPROVE lets the next prepr-delta skip (reviewedNow=0, priorHashMatch>=1)"
  else
    fail "ledger-noclaim (B control): normal prepr ledger-append did not take effect (reviewedNow=$rn priorHashMatch=$pr) :: $status"
  fi
}

#############################################################################
# TEST 48 — multi-lens APPROVE must NOT bypass the coverage fail-closed guard [PHASE 3f / Tier-2]
#   Even when every lens APPROVES the reviewed-now diff, an unreviewed branch-diff file
#   (coverage.unreviewed>0, forced via CODEX_GATE_FORCE_UNREVIEWED) makes approval impossible —
#   the run must downgrade to OVERFLOW (mirrors emit_outcome's guard), carrying coverage + lenses[].
#############################################################################
run_test_48() {
  local repo status outcome
  repo="$(make_repo)"
  printf 'seed\n' > "$repo/seed.txt"
  git -C "$repo" add seed.txt && git -C "$repo" commit -qm init
  printf 'changed line\n' >> "$repo/seed.txt"   # backend-only change => 3 lenses, all approve
  reset_argv_log
  ( cd "$repo" && STUB_MODE=approve CODEX_GATE_FORCE_UNREVIEWED=1 bash "$WRAPPER" prepr --multi ) > "$SANDBOX/out.txt" 2>"$SANDBOX/err.txt"
  status="$(last_json_line "$SANDBOX/out.txt")"
  outcome="$(printf '%s' "$status" | jq -r '.outcome // empty')"
  if [ "$outcome" = "OVERFLOW" ]; then
    pass "multi-coverage: unreviewed>0 downgrades a multi-lens all-approve to OVERFLOW (fail-closed)"
  else
    fail "multi-coverage: expected OVERFLOW got '$outcome' (coverage guard BYPASSED) :: $status :: $(cat "$SANDBOX/err.txt")"
  fi
  if printf '%s' "$status" | jq -e '(.coverage.unreviewed // 0) > 0' >/dev/null 2>&1; then
    pass "multi-coverage: status carries coverage.unreviewed>0"
  else
    fail "multi-coverage: coverage.unreviewed not >0 :: $status"
  fi
  if printf '%s' "$status" | jq -e '(.lenses | type=="array") and (.lenses | length >= 1)' >/dev/null 2>&1; then
    pass "multi-coverage: the coverage-gap OVERFLOW still carries lenses[] provenance"
  else
    fail "multi-coverage: missing lenses[] :: $status"
  fi
}

#############################################################################
# TEST 49 — `config` reports the EFFECTIVE dials + both digests + a parity state [CONFIG]
#   The read-only config subcommand must print ONE JSON object carrying all three
#   dials as DEFAULTS (the literal fallbacks baked into the running script), the
#   EFFECTIVE values, the per-dial ORIGIN, both endpoint digests, and a parity state.
#   Hermetic: BOTH endpoints are pinned at the wrapper under test, so the assertion
#   never depends on the developer's real ~/.claude/skills/ install.
#############################################################################
run_test_49() {
  local status rc
  ( hermetic CODEX_GATE_RUNTIME="$WRAPPER" CODEX_GATE_SOURCE="$WRAPPER" bash "$WRAPPER" config ) \
    > "$SANDBOX/cfg49.txt" 2>"$SANDBOX/cfg49.err"
  rc=$?
  status="$(last_json_line "$SANDBOX/cfg49.txt")"

  if [ "$rc" -eq 0 ]; then
    pass "config: exits 0 on success"
  else
    fail "config: expected exit 0 got $rc :: $(cat "$SANDBOX/cfg49.err")"
  fi
  if printf '%s' "$status" | jq -e '.outcome=="CONFIG"' >/dev/null 2>&1; then
    pass "config: emits a machine-readable status line with outcome=CONFIG"
  else
    fail "config: no CONFIG status line :: $(cat "$SANDBOX/cfg49.txt") :: $(cat "$SANDBOX/cfg49.err")"
    return
  fi

  # all three dials, as the LITERAL fallbacks in the running script (the pinned pair)
  if printf '%s' "$status" | jq -e '.defaults.model=="gpt-6-astra" and .defaults.effort=="xhigh" and .defaults.fast=="0"' >/dev/null 2>&1; then
    pass "config: defaults report all three dials as the running script's literal fallbacks (astra/xhigh/0)"
  else
    fail "config: defaults do not match the script's literal fallbacks :: $status"
  fi
  # effective + origin present for every dial
  if printf '%s' "$status" | jq -e '(.effective|has("model") and has("effort") and has("fast")) and (.origin|has("model") and has("effort") and has("fast"))' >/dev/null 2>&1; then
    pass "config: effective + origin carry all three dials"
  else
    fail "config: effective/origin missing a dial :: $status"
  fi
  # …and each one carries the EXACT value in force, not merely a present key. Asserting
  # only `has("model")` was a proven false-green: reporting effective.model as
  # "bogus-model" left the whole suite at PASS=322 FAIL=0. `effective` is the field an
  # operator actually reads to answer "what is this gate running?", so it is pinned exactly.
  if printf '%s' "$status" | jq -e '.effective.model=="gpt-6-astra"' >/dev/null 2>&1; then
    pass "config: effective.model is EXACTLY gpt-6-astra with no override in play"
  else
    fail "config: effective.model is not exactly gpt-6-astra :: $status"
  fi
  if printf '%s' "$status" | jq -e '.effective.effort=="xhigh"' >/dev/null 2>&1; then
    pass "config: effective.effort is EXACTLY xhigh with no override in play"
  else
    fail "config: effective.effort is not exactly xhigh :: $status"
  fi
  if printf '%s' "$status" | jq -e '.effective.fast==false and .effective.fastRaw=="0"' >/dev/null 2>&1; then
    pass "config: effective.fast is EXACTLY false (raw \"0\") with no override in play"
  else
    fail "config: effective.fast/fastRaw not exactly false/\"0\" :: $status"
  fi
  # with no override, `effective` must equal `defaults` dial-for-dial — the two blocks
  # are computed by different code paths (live vars vs parse_dial), so this is a real check
  if printf '%s' "$status" | jq -e '.effective.model==.defaults.model and .effective.effort==.defaults.effort and (.effective.fastRaw==.defaults.fast)' >/dev/null 2>&1; then
    pass "config: with no override, effective equals defaults dial-for-dial"
  else
    fail "config: effective diverges from defaults with no override in play :: $status"
  fi
  # with NO env override in play, every dial's origin is the file default and effective==defaults
  if printf '%s' "$status" | jq -e '.origin.model=="default" and .origin.effort=="default" and .origin.fast=="default"' >/dev/null 2>&1; then
    pass "config: with no env override, every dial's origin is the file default"
  else
    fail "config: origin should be default for every dial :: $status"
  fi

  # both digests, as real sha256 hex
  if printf '%s' "$status" | jq -e '(.runtimeDigest|test("^[0-9a-f]{64}$")) and (.sourceDigest|test("^[0-9a-f]{64}$"))' >/dev/null 2>&1; then
    pass "config: reports BOTH a runtimeDigest and a sourceDigest (sha256 hex)"
  else
    fail "config: missing/!sha256 runtime or source digest :: $status"
  fi
  if printf '%s' "$status" | jq -e '(.runtimePath|length>0) and (.sourcePath|length>0)' >/dev/null 2>&1; then
    pass "config: reports both endpoint PATHS alongside their digests"
  else
    fail "config: missing runtimePath/sourcePath :: $status"
  fi

  # a parity state — and for a byte-identical, unoverridden pair it is MATCH,
  # with digest parity and EFFECTIVE parity reported separately.
  if printf '%s' "$status" | jq -e '(.parity|IN("MATCH","MISMATCH","UNAVAILABLE"))' >/dev/null 2>&1; then
    pass "config: parity is one of MATCH/MISMATCH/UNAVAILABLE"
  else
    fail "config: parity missing or not a known state :: $status"
  fi
  if printf '%s' "$status" | jq -e '.digestParity=="MATCH" and .effectiveParity=="MATCH" and .parity=="MATCH"' >/dev/null 2>&1; then
    pass "config: an identical, unoverridden pair reports digest + effective parity separately, both MATCH"
  else
    fail "config: identical pair did not report MATCH on both parities :: $status"
  fi
}

#############################################################################
# TEST 50 — env override shows up in `effective` + `origin`; fast is NORMALIZED [CONFIG]
#   An override must make `effective` DIFFER from `defaults` and `origin` must NAME the
#   variable that did it. And `fast` must be reported by its REAL trigger: the wrapper
#   enables fast mode only when the value is exactly "1", so CODEX_GATE_FAST=2 is
#   DISABLED — reporting it as enabled would be a lie about what argv Codex gets.
#############################################################################
run_test_50() {
  local status

  # ---- (A) an effort override: effective differs from defaults, origin names the var ----
  ( CODEX_GATE_RUNTIME="$WRAPPER" CODEX_GATE_SOURCE="$WRAPPER" CODEX_GATE_EFFORT=low \
      bash "$WRAPPER" config ) > "$SANDBOX/cfg50a.txt" 2>"$SANDBOX/cfg50a.err"
  status="$(last_json_line "$SANDBOX/cfg50a.txt")"
  if printf '%s' "$status" | jq -e '.effective.effort=="low" and .defaults.effort=="xhigh" and (.effective.effort != .defaults.effort)' >/dev/null 2>&1; then
    pass "config-origin: CODEX_GATE_EFFORT=low makes effective differ from defaults"
  else
    fail "config-origin: effective.effort did not reflect the override :: $status"
  fi
  if printf '%s' "$status" | jq -e '.origin.effort=="CODEX_GATE_EFFORT" and .origin.model=="default"' >/dev/null 2>&1; then
    pass "config-origin: origin NAMES the overriding env var (and leaves untouched dials as default)"
  else
    fail "config-origin: origin did not name CODEX_GATE_EFFORT :: $status"
  fi

  # ---- (B) fast normalization: only an exact "1" enables fast mode ----
  ( CODEX_GATE_RUNTIME="$WRAPPER" CODEX_GATE_SOURCE="$WRAPPER" CODEX_GATE_FAST=2 \
      bash "$WRAPPER" config ) > "$SANDBOX/cfg50b.txt" 2>"$SANDBOX/cfg50b.err"
  status="$(last_json_line "$SANDBOX/cfg50b.txt")"
  if printf '%s' "$status" | jq -e '.effective.fast==false' >/dev/null 2>&1; then
    pass "config-fast: CODEX_GATE_FAST=2 reports fast DISABLED (only an exact 1 is the trigger)"
  else
    fail "config-fast: CODEX_GATE_FAST=2 did NOT report fast as disabled :: $status"
  fi
  if printf '%s' "$status" | jq -e '.effective.fastRaw=="2" and .origin.fast=="CODEX_GATE_FAST"' >/dev/null 2>&1; then
    pass "config-fast: the raw overriding value stays visible and origin names CODEX_GATE_FAST"
  else
    fail "config-fast: raw value/origin lost for CODEX_GATE_FAST=2 :: $status"
  fi

  # ---- (C) contrast control: an exact 1 DOES report enabled ----
  ( CODEX_GATE_RUNTIME="$WRAPPER" CODEX_GATE_SOURCE="$WRAPPER" CODEX_GATE_FAST=1 \
      bash "$WRAPPER" config ) > "$SANDBOX/cfg50c.txt" 2>"$SANDBOX/cfg50c.err"
  status="$(last_json_line "$SANDBOX/cfg50c.txt")"
  if printf '%s' "$status" | jq -e '.effective.fast==true' >/dev/null 2>&1; then
    pass "config-fast (control): CODEX_GATE_FAST=1 reports fast ENABLED"
  else
    fail "config-fast (control): CODEX_GATE_FAST=1 did not report enabled :: $status"
  fi
}

#############################################################################
# TEST 51 — parity states: MISMATCH names both digests; no source => UNAVAILABLE [CONFIG]
#   A deliberately divergent fixture pair (mirroring the real drift that motivated this
#   subcommand: a different model, a different fast default, a different sha256) must
#   report MISMATCH and name BOTH digests. And when no source copy can be located the
#   answer is UNAVAILABLE — NEVER a silent MATCH. Symlink/missing endpoints are reported
#   honestly too. Temp fixtures only: never reads the developer's ~/.claude/skills state.
#############################################################################
run_test_51() {
  local fx status rd sd
  fx="$SANDBOX/cfgfx"
  mkdir -p "$fx"
  {
    printf '#!/usr/bin/env bash\n'
    printf 'CODEX_GATE_MODEL="${CODEX_GATE_MODEL-gpt-5.6-sol}"\n'
    printf 'CODEX_GATE_EFFORT="${CODEX_GATE_EFFORT:-xhigh}"\n'
    printf 'CODEX_GATE_FAST="${CODEX_GATE_FAST:-0}"\n'
  } > "$fx/source.sh"
  {
    printf '#!/usr/bin/env bash\n'
    printf 'CODEX_GATE_MODEL="${CODEX_GATE_MODEL:-gpt-5.6-terra}"\n'
    printf 'CODEX_GATE_EFFORT="${CODEX_GATE_EFFORT:-ultra}"\n'
    printf 'CODEX_GATE_FAST="${CODEX_GATE_FAST:-1}"\n'
  } > "$fx/runtime.sh"

  # ---- (A) divergent pair => MISMATCH, both digests named and different ----
  ( CODEX_GATE_RUNTIME="$fx/runtime.sh" CODEX_GATE_SOURCE="$fx/source.sh" \
      bash "$WRAPPER" config ) > "$SANDBOX/cfg51a.txt" 2>"$SANDBOX/cfg51a.err"
  status="$(last_json_line "$SANDBOX/cfg51a.txt")"
  if printf '%s' "$status" | jq -e '.parity=="MISMATCH" and .digestParity=="MISMATCH"' >/dev/null 2>&1; then
    pass "config-parity: a divergent runtime/source pair reports MISMATCH"
  else
    fail "config-parity: divergent pair did not report MISMATCH :: $status :: $(cat "$SANDBOX/cfg51a.err")"
  fi
  rd="$(printf '%s' "$status" | jq -r '.runtimeDigest // ""')"
  sd="$(printf '%s' "$status" | jq -r '.sourceDigest  // ""')"
  if printf '%s' "$rd" | grep -qE '^[0-9a-f]{64}$' && printf '%s' "$sd" | grep -qE '^[0-9a-f]{64}$' && [ "$rd" != "$sd" ]; then
    pass "config-parity: the MISMATCH names BOTH digests, and they differ"
  else
    fail "config-parity: MISMATCH did not name two distinct digests (runtime='$rd' source='$sd') :: $status"
  fi
  # the drift is legible, not just flagged: each side's declared dials are reported
  if printf '%s' "$status" | jq -e '.runtimeDefaults.model=="gpt-5.6-terra" and .sourceDefaults.model=="gpt-5.6-sol"' >/dev/null 2>&1; then
    pass "config-parity: both sides' DECLARED dials are reported, so the drift is legible"
  else
    fail "config-parity: declared dials of the two sides not reported :: $status"
  fi

  # ---- (B) no locatable source => UNAVAILABLE, never a silent MATCH ----
  ( CODEX_GATE_RUNTIME="$WRAPPER" CODEX_GATE_SOURCE="$fx/does-not-exist.sh" \
      bash "$WRAPPER" config ) > "$SANDBOX/cfg51b.txt" 2>"$SANDBOX/cfg51b.err"
  status="$(last_json_line "$SANDBOX/cfg51b.txt")"
  if printf '%s' "$status" | jq -e '.parity=="UNAVAILABLE"' >/dev/null 2>&1; then
    pass "config-parity: no locatable source reports UNAVAILABLE (not MATCH)"
  else
    fail "config-parity: unlocatable source did not report UNAVAILABLE :: $status :: $(cat "$SANDBOX/cfg51b.err")"
  fi
  if printf '%s' "$status" | jq -e '.sourceKind=="missing" and (.sourceDigest=="") and (.sourceDiscovery|length>0)' >/dev/null 2>&1; then
    pass "config-parity: the unlocatable source is reported honestly (kind=missing, empty digest, a stated reason)"
  else
    fail "config-parity: unlocatable source not reported honestly :: $status"
  fi

  # ---- (C) a MISSING runtime endpoint is reported, never assumed to MATCH ----
  ( CODEX_GATE_RUNTIME="$fx/no-runtime-here.sh" CODEX_GATE_SOURCE="$fx/source.sh" \
      bash "$WRAPPER" config ) > "$SANDBOX/cfg51c.txt" 2>"$SANDBOX/cfg51c.err"
  status="$(last_json_line "$SANDBOX/cfg51c.txt")"
  if printf '%s' "$status" | jq -e '.runtimeKind=="missing" and .parity!="MATCH"' >/dev/null 2>&1; then
    pass "config-parity: a MISSING runtime is reported as missing and never pretends MATCH"
  else
    fail "config-parity: missing runtime mis-reported :: $status"
  fi

  # ---- (D) a SYMLINKED runtime is reported as a symlink (owner: the real install is not one) ----
  ln -sf "$fx/source.sh" "$fx/runtime-link.sh"
  ( CODEX_GATE_RUNTIME="$fx/runtime-link.sh" CODEX_GATE_SOURCE="$fx/source.sh" \
      bash "$WRAPPER" config ) > "$SANDBOX/cfg51d.txt" 2>"$SANDBOX/cfg51d.err"
  status="$(last_json_line "$SANDBOX/cfg51d.txt")"
  if printf '%s' "$status" | jq -e '.runtimeKind=="symlink"' >/dev/null 2>&1; then
    pass "config-parity: a symlinked runtime path is reported as a symlink, not silently as a file"
  else
    fail "config-parity: symlinked runtime not detected :: $status"
  fi

  # ---- (E) auto-discovery (source knob unset) still yields a stated origin + a legal parity ----
  ( CODEX_GATE_RUNTIME="$WRAPPER" bash "$WRAPPER" config ) > "$SANDBOX/cfg51e.txt" 2>"$SANDBOX/cfg51e.err"
  status="$(last_json_line "$SANDBOX/cfg51e.txt")"
  if printf '%s' "$status" | jq -e '(.sourceDiscovery|length>0) and (.parity|IN("MATCH","MISMATCH","INCOMPLETE","UNAVAILABLE"))' >/dev/null 2>&1; then
    pass "config-parity: auto-discovery (no CODEX_GATE_SOURCE) states how it resolved and yields a legal parity"
  else
    fail "config-parity: auto-discovery produced no discovery note/parity :: $status"
  fi

  # ---- (F) a DIRECTORY-symlinked runtime is a symlink too, not a plain file ----
  #   `-L` on the leaf alone said "file": the repo-root README's documented personal-skill
  #   setup symlinks the skill DIRECTORY, so `<link>/codex-gate.sh` is an ordinary file by
  #   the leaf test while the install it names is a linked one. The classification must
  #   cover ANY component of the path, and the physical control must still read as `file`.
  mkdir -p "$fx/real-parent"
  printf '#!/usr/bin/env bash\necho REAL-TARGET\n' > "$fx/real-parent/codex-gate.sh"
  ln -s "$fx/real-parent" "$fx/link-parent"
  ( CODEX_GATE_RUNTIME="$fx/link-parent/codex-gate.sh" CODEX_GATE_SOURCE="$fx/source.sh" \
      bash "$WRAPPER" config ) > "$SANDBOX/cfg51f.txt" 2>"$SANDBOX/cfg51f.err"
  status="$(last_json_line "$SANDBOX/cfg51f.txt")"
  if printf '%s' "$status" | jq -e '.runtimeKind=="symlink"' >/dev/null 2>&1; then
    pass "config-parity: a runtime reached through a DIRECTORY symlink reports runtimeKind=symlink (any component, not just the leaf)"
  else
    fail "config-parity: a directory-symlinked runtime was reported as a plain file :: $status"
  fi
  ( CODEX_GATE_RUNTIME="$fx/real-parent/codex-gate.sh" CODEX_GATE_SOURCE="$fx/source.sh" \
      bash "$WRAPPER" config ) > "$SANDBOX/cfg51g.txt" 2>"$SANDBOX/cfg51g.err"
  status="$(last_json_line "$SANDBOX/cfg51g.txt")"
  if printf '%s' "$status" | jq -e '.runtimeKind=="file"' >/dev/null 2>&1; then
    pass "config-parity (control): the same file reached by its REAL path reports runtimeKind=file"
  else
    fail "config-parity (control): a physical runtime path was not reported as a plain file :: $status"
  fi
}

#############################################################################
# TEST 52 — `config` is READ-ONLY: zero Codex calls, no run dir, no repo mutation [CONFIG]
#   The whole point of a config report is that it is safe to run at any time — including
#   while another gate is mid-review. It must invoke Codex ZERO times, create NO run dir
#   (hence no ledger), leave a target repo byte-identical, and fail closed (exit 2) on
#   malformed input like the rest of the script's arg validation.
#############################################################################
run_test_52() {
  local repo runs before after rc argv_lines
  runs="$SANDBOX/cfg-runs-absent"
  rm -rf "$runs"
  repo="$(make_repo)"
  printf 'seed\n' > "$repo/seed.txt"
  git -C "$repo" add seed.txt && git -C "$repo" commit -qm init
  before="$(git -C "$repo" status --porcelain)"

  reset_argv_log
  ( cd "$repo" && CODEX_GATE_RUNS="$runs" CODEX_GATE_RUNTIME="$WRAPPER" CODEX_GATE_SOURCE="$WRAPPER" \
      bash "$WRAPPER" config ) > "$SANDBOX/cfg52.txt" 2>"$SANDBOX/cfg52.err"
  rc=$?
  after="$(git -C "$repo" status --porcelain)"
  argv_lines="$(wc -l < "$STUB_ARGV_LOG" | tr -d ' ')"

  if [ "$argv_lines" = "0" ]; then
    pass "config-readonly: ZERO codex invocations (stub argv log empty)"
  else
    fail "config-readonly: codex was invoked $argv_lines argv line(s) :: $(cat "$STUB_ARGV_LOG")"
  fi
  if [ ! -e "$runs" ]; then
    pass "config-readonly: creates NO run dir (and therefore no ledger)"
  else
    fail "config-readonly: a run dir was created at $runs :: $(find "$runs" | head -5)"
  fi
  if [ "$before" = "$after" ]; then
    pass "config-readonly: target repo git status is byte-identical before/after"
  else
    fail "config-readonly: repo mutated :: before='$before' after='$after'"
  fi
  if [ "$rc" -eq 0 ]; then
    pass "config-readonly: exits 0 while another gate could be mid-review"
  else
    fail "config-readonly: expected exit 0 got $rc :: $(cat "$SANDBOX/cfg52.err")"
  fi

  # malformed input fails closed, matching the script's other arg validation (exit 2)
  ( CODEX_GATE_RUNTIME="$WRAPPER" bash "$WRAPPER" config bogus-extra-arg ) \
    > "$SANDBOX/cfg52b.txt" 2>"$SANDBOX/cfg52b.err"
  rc=$?
  if [ "$rc" -eq 2 ]; then
    pass "config-readonly: an unexpected argument fails closed with exit 2 (arg-validation convention)"
  else
    fail "config-readonly: expected exit 2 on a bogus arg, got $rc :: $(cat "$SANDBOX/cfg52b.txt") :: $(cat "$SANDBOX/cfg52b.err")"
  fi

  # ---- NOTHING in this script ever writes the runtime endpoint ----------------
  #   `CODEX_GATE_RUNTIME` names the gate an operator actually runs. It is a REPORTING
  #   input only: no mode may write it, so the report can never be the thing that changed
  #   what it is reporting on. Asserted by mtime AND inode, not by digest — a
  #   rewrite-with-identical-bytes (or a bare `touch`) is invisible to a digest, and that
  #   hole was proven by mutation: an injected `touch` left the whole suite green.
  local fx marker rtBefore rtAfter stampBefore stampAfter
  fx="$SANDBOX/cfg52rt"
  mkdir -p "$fx"
  marker="untouched-marker-$$"
  printf '%s\n' "$marker" > "$fx/runtime.sh"
  rtBefore="$(shasum -a 256 "$fx/runtime.sh" | awk '{print $1}')"
  stampBefore="$(file_stamp "$fx/runtime.sh")"

  printf 'a change\n' >> "$repo/seed.txt"
  ( cd "$repo" && STUB_MODE=approve CODEX_GATE_RUNTIME="$fx/runtime.sh" bash "$WRAPPER" prepr ) \
    > "$SANDBOX/cfg52c.txt" 2>"$SANDBOX/cfg52c.err"
  rtAfter="$(shasum -a 256 "$fx/runtime.sh" | awk '{print $1}')"
  stampAfter="$(file_stamp "$fx/runtime.sh")"
  if [ "$rtBefore" = "$rtAfter" ] && [ "$stampBefore" = "$stampAfter" ]; then
    pass "config-readonly: a normal \`prepr\` review performs ZERO writes to the CODEX_GATE_RUNTIME path (mtime AND inode unchanged)"
  else
    fail "config-readonly: prepr touched the runtime path :: before='$stampBefore' after='$stampAfter'"
  fi

  ( CODEX_GATE_RUNTIME="$fx/runtime.sh" bash "$WRAPPER" config ) \
    > "$SANDBOX/cfg52d.txt" 2>"$SANDBOX/cfg52d.err"
  rtAfter="$(shasum -a 256 "$fx/runtime.sh" | awk '{print $1}')"
  stampAfter="$(file_stamp "$fx/runtime.sh")"
  if [ "$rtBefore" = "$rtAfter" ] && [ "$stampBefore" = "$stampAfter" ]; then
    pass "config-readonly: \`config\` itself performs ZERO writes there either (mtime AND inode unchanged)"
  else
    fail "config-readonly: config touched the runtime path :: before='$stampBefore' after='$stampAfter'"
  fi
}

#############################################################################
# TEST 53 — ultra + multi-lens fan-out refuses BEFORE any codex call [ULTRA-GUARD]
#   `ultra` performs its OWN automatic sub-reviewer delegation (observed ~3 wrapper-
#   invisible children per round; a capped floor, not a ceiling — see codex-gate.sh's
#   CODEX_GATE_EFFORT comment). Combined with our OWN multi-lens fan-out (lenses ×
#   ultra's native children) that is unbounded review, so the wrapper must refuse
#   rather than proceed. The guard must read the RESOLVED multilens state (BOTH
#   --multi and CODEX_GATE_FANOUT=1 trigger it identically) — a guard on the flag
#   alone would leave the env path wide open (the bug this test locks closed).
#   (A)+(B) --multi and CODEX_GATE_FANOUT=1, each + ultra -> INFRA_ERROR, ZERO codex
#       calls, summary names BOTH the trigger and the tier.
#   (C) either trigger + the DEFAULT xhigh -> proceeds exactly as today (multi-lens
#       dispatch fires, 3 stub calls, APPROVE).
#   (D) NEITHER trigger + ultra -> unaffected: a normal single-lens ultra run still
#       goes through (1 stub call, model_reasoning_effort="ultra" reaches argv,
#       APPROVE). This IS the owner's documented escape hatch — no separate bypass
#       env var exists; dropping --multi/CODEX_GATE_FANOUT is the only way to keep ultra.
#   (E) bundle / plan at ultra -> completely unaffected, even with a GLOBAL
#       CODEX_GATE_FANOUT=1 in the environment (they never parse --multi and never
#       consult CODEX_GATE_FANOUT; the guard lives only in the prepr/prepr-delta path).
#############################################################################
run_test_53() {
  local repo status outcome summary ncalls trigger planfile

  # ---- (A)+(B): --multi / CODEX_GATE_FANOUT=1, each + ultra -> refused, 0 calls ----
  for trigger in flag env; do
    repo="$(make_repo)"
    printf 'seed\n' > "$repo/seed.txt"
    git -C "$repo" add seed.txt && git -C "$repo" commit -qm init
    printf 'a change\n' >> "$repo/seed.txt"
    reset_argv_log
    if [ "$trigger" = "flag" ]; then
      ( cd "$repo" && STUB_MODE=approve CODEX_GATE_EFFORT=ultra bash "$WRAPPER" prepr --multi ) \
        > "$SANDBOX/u53.txt" 2>"$SANDBOX/u53.err"
    else
      ( cd "$repo" && STUB_MODE=approve CODEX_GATE_EFFORT=ultra CODEX_GATE_FANOUT=1 bash "$WRAPPER" prepr ) \
        > "$SANDBOX/u53.txt" 2>"$SANDBOX/u53.err"
    fi
    status="$(last_json_line "$SANDBOX/u53.txt")"
    outcome="$(printf '%s' "$status" | jq -r '.outcome // empty')"
    summary="$(printf '%s' "$status" | jq -r '.summary // ""')"

    if [ "$outcome" = "INFRA_ERROR" ]; then
      pass "ultra-guard[$trigger]: multi-lens + ultra refuses (INFRA_ERROR)"
    else
      fail "ultra-guard[$trigger]: expected INFRA_ERROR got '$outcome' :: $status :: $(cat "$SANDBOX/u53.err")"
    fi
    if [ "$trigger" = "flag" ]; then
      if printf '%s' "$summary" | grep -q -- '--multi'; then
        pass "ultra-guard[$trigger]: refusal names the --multi trigger"
      else
        fail "ultra-guard[$trigger]: refusal does not name --multi :: $summary"
      fi
    else
      if printf '%s' "$summary" | grep -q 'CODEX_GATE_FANOUT'; then
        pass "ultra-guard[$trigger]: refusal names the CODEX_GATE_FANOUT trigger"
      else
        fail "ultra-guard[$trigger]: refusal does not name CODEX_GATE_FANOUT :: $summary"
      fi
    fi
    if printf '%s' "$summary" | grep -qi 'ultra'; then
      pass "ultra-guard[$trigger]: refusal names the ultra tier"
    else
      fail "ultra-guard[$trigger]: refusal does not name ultra :: $summary"
    fi
    ncalls="$(grep -c -- '---END-ARGV---' "$STUB_ARGV_LOG" 2>/dev/null)"; [ -n "$ncalls" ] || ncalls=0
    if [ "$ncalls" -eq 0 ]; then
      pass "ultra-guard[$trigger]: ZERO codex calls on the refusal path"
    else
      fail "ultra-guard[$trigger]: expected 0 codex calls got $ncalls :: $(cat "$STUB_ARGV_LOG")"
    fi
  done

  # ---- (C): either trigger + the DEFAULT xhigh -> proceeds exactly as today ----
  repo="$(make_repo)"
  printf 'seed\n' > "$repo/seed.txt"
  git -C "$repo" add seed.txt && git -C "$repo" commit -qm init
  printf 'a change\n' >> "$repo/seed.txt"
  reset_argv_log
  ( cd "$repo" && STUB_MODE=approve bash "$WRAPPER" prepr --multi ) > "$SANDBOX/u53c.txt" 2>"$SANDBOX/u53c.err"
  status="$(last_json_line "$SANDBOX/u53c.txt")"
  outcome="$(printf '%s' "$status" | jq -r '.outcome // empty')"
  ncalls="$(grep -c -- '---END-ARGV---' "$STUB_ARGV_LOG" 2>/dev/null)"; [ -n "$ncalls" ] || ncalls=0
  if [ "$outcome" = "APPROVE" ] && [ "$ncalls" -eq 3 ]; then
    pass "ultra-guard[xhigh]: --multi at the DEFAULT effort still dispatches multi-lens (3 calls, APPROVE)"
  else
    fail "ultra-guard[xhigh]: expected APPROVE/3 calls got outcome='$outcome' calls=$ncalls :: $status :: $(cat "$SANDBOX/u53c.err")"
  fi

  # ---- (D): NEITHER trigger + ultra -> unaffected (single-lens ultra still runs) ----
  repo="$(make_repo)"
  printf 'seed\n' > "$repo/seed.txt"
  git -C "$repo" add seed.txt && git -C "$repo" commit -qm init
  printf 'a change\n' >> "$repo/seed.txt"
  reset_argv_log
  ( cd "$repo" && STUB_MODE=approve CODEX_GATE_EFFORT=ultra bash "$WRAPPER" prepr ) > "$SANDBOX/u53d.txt" 2>"$SANDBOX/u53d.err"
  status="$(last_json_line "$SANDBOX/u53d.txt")"
  outcome="$(printf '%s' "$status" | jq -r '.outcome // empty')"
  ncalls="$(grep -c -- '---END-ARGV---' "$STUB_ARGV_LOG" 2>/dev/null)"; [ -n "$ncalls" ] || ncalls=0
  if [ "$outcome" = "APPROVE" ] && [ "$ncalls" -eq 1 ]; then
    pass "ultra-guard[single-lens]: NEITHER trigger set -> plain ultra prepr still runs (1 call, APPROVE)"
  else
    fail "ultra-guard[single-lens]: expected APPROVE/1 call got outcome='$outcome' calls=$ncalls :: $status :: $(cat "$SANDBOX/u53d.err")"
  fi
  if grep -q 'model_reasoning_effort="ultra"' "$STUB_ARGV_LOG"; then
    pass "ultra-guard[single-lens]: the ultra effort actually reached argv (proves it ran, not silently downgraded)"
  else
    fail "ultra-guard[single-lens]: model_reasoning_effort=\"ultra\" missing from argv :: $(cat "$STUB_ARGV_LOG")"
  fi

  # ---- (E): bundle / plan at ultra -> completely unaffected (even with a GLOBAL
  #      CODEX_GATE_FANOUT=1 in the environment; they never look at it) ----
  repo="$(make_repo)"
  printf 'seed\n' > "$repo/seed.txt"
  git -C "$repo" add seed.txt && git -C "$repo" commit -qm init
  mkdir -p "$repo/docs/pdr"
  printf 'pdr-agents\n' > "$repo/docs/pdr/AGENTS.md"
  printf '# plan\n' > "$repo/docs/pdr/plan.md"
  git -C "$repo" add . && git -C "$repo" commit -qm pdr
  reset_argv_log
  ( cd "$repo" && STUB_MODE=approve CODEX_GATE_EFFORT=ultra CODEX_GATE_FANOUT=1 bash "$WRAPPER" bundle docs/pdr ) \
    > "$SANDBOX/u53e_b.txt" 2>"$SANDBOX/u53e_b.err"
  status="$(last_json_line "$SANDBOX/u53e_b.txt")"
  outcome="$(printf '%s' "$status" | jq -r '.outcome // empty')"
  ncalls="$(grep -c -- '---END-ARGV---' "$STUB_ARGV_LOG" 2>/dev/null)"; [ -n "$ncalls" ] || ncalls=0
  if [ "$outcome" = "APPROVE" ] && [ "$ncalls" -eq 1 ]; then
    pass "ultra-guard[bundle]: bundle at ultra + a global CODEX_GATE_FANOUT=1 is unaffected (1 call, APPROVE)"
  else
    fail "ultra-guard[bundle]: expected APPROVE/1 call got outcome='$outcome' calls=$ncalls :: $status :: $(cat "$SANDBOX/u53e_b.err")"
  fi

  planfile="$SANDBOX/u53-plan.md"
  printf '# A plan\n\nDo the thing.\n' > "$planfile"
  reset_argv_log
  ( cd "$repo" && STUB_MODE=approve CODEX_GATE_EFFORT=ultra CODEX_GATE_FANOUT=1 bash "$WRAPPER" plan "$planfile" ) \
    > "$SANDBOX/u53e_p.txt" 2>"$SANDBOX/u53e_p.err"
  status="$(last_json_line "$SANDBOX/u53e_p.txt")"
  outcome="$(printf '%s' "$status" | jq -r '.outcome // empty')"
  ncalls="$(grep -c -- '---END-ARGV---' "$STUB_ARGV_LOG" 2>/dev/null)"; [ -n "$ncalls" ] || ncalls=0
  if [ "$outcome" = "APPROVE" ] && [ "$ncalls" -eq 1 ]; then
    pass "ultra-guard[plan]: plan at ultra + a global CODEX_GATE_FANOUT=1 is unaffected (1 call, APPROVE)"
  else
    fail "ultra-guard[plan]: expected APPROVE/1 call got outcome='$outcome' calls=$ncalls :: $status :: $(cat "$SANDBOX/u53e_p.err")"
  fi
}

#############################################################################
# TEST 54 — parity is a DIRECTORY-level claim over the documented INVENTORY [CONFIG]
#   A script-only comparison reported MATCH while the runtime's SKILL.md / README.md
#   still documented superseded terra/ultra dials — the parity claim overstated what
#   the two copies actually shared. Parity is therefore claimed over the whole
#   documented inventory: two skill directories whose SCRIPTS are byte-identical but
#   whose DOCS differ must report MISMATCH and NAME the drifted members. Also pinned:
#   `config` reports the inventory itself, so the list cannot silently drift from the
#   documented one in either direction.
#############################################################################
run_test_54() {
  local fx status
  fx="$SANDBOX/invfx54"
  # identical SCRIPTS, divergent DOCS — the exact shape a script-only claim cannot see
  make_skill_fixture "$fx/src" gpt-5.6-sol xhigh 0 current-docs
  make_skill_fixture "$fx/rt"  gpt-5.6-sol xhigh 0 stale-terra-ultra-docs

  ( CODEX_GATE_RUNTIME="$fx/rt/codex-gate.sh" CODEX_GATE_SOURCE="$fx/src/codex-gate.sh" \
    bash "$WRAPPER" config ) > "$SANDBOX/inv54a.txt" 2>"$SANDBOX/inv54a.err"
  status="$(last_json_line "$SANDBOX/inv54a.txt")"

  # the inventory is observable, and it is exactly the documented list
  if printf '%s' "$status" | jq -e --arg inv "$GATE_INVENTORY" '(.syncInventory | join("\n")) == $inv' >/dev/null 2>&1; then
    pass "sync-inventory: config reports the sync inventory and it matches the documented list exactly"
  else
    fail "sync-inventory: reported inventory differs from the documented list :: $(printf '%s' "$status" | jq -c '.syncInventory')"
  fi
  if printf '%s' "$status" | jq -e '(.syncInventory|length)==13' >/dev/null 2>&1; then
    pass "sync-inventory: the inventory carries exactly 13 members"
  else
    fail "sync-inventory: expected 13 inventory members :: $(printf '%s' "$status" | jq -c '.syncInventory|length')"
  fi

  # identical scripts + divergent docs => MISMATCH (this was a false MATCH before)
  if printf '%s' "$status" | jq -e '.digestParity=="MISMATCH" and .parity=="MISMATCH"' >/dev/null 2>&1; then
    pass "sync-inventory: identical scripts with DIVERGENT DOCS report MISMATCH (parity is a directory-level claim)"
  else
    fail "sync-inventory: divergent docs did not produce MISMATCH :: $status"
  fi
  if printf '%s' "$status" | jq -e '(.inventoryDrift | type=="array") and ((.inventoryDrift | map(.file) | index("SKILL.md")) != null) and ((.inventoryDrift | map(.file) | index("README.md")) != null)' >/dev/null 2>&1; then
    pass "sync-inventory: the MISMATCH NAMES the drifted members (SKILL.md, README.md), so it is legible"
  else
    fail "sync-inventory: drifted members not named :: $(printf '%s' "$status" | jq -c '.inventoryDrift')"
  fi
  if printf '%s' "$status" | jq -e '.inventoryDrift | map(select(.file=="codex-gate.sh")) | length == 0' >/dev/null 2>&1; then
    pass "sync-inventory: the byte-identical SCRIPT is not listed as drifted (only the members that actually differ are)"
  else
    fail "sync-inventory: an identical member was reported as drifted :: $(printf '%s' "$status" | jq -c '.inventoryDrift')"
  fi

  # control: two IDENTICAL complete skill directories report MATCH across the inventory
  make_skill_fixture "$fx/rt2" gpt-5.6-sol xhigh 0 current-docs
  ( CODEX_GATE_RUNTIME="$fx/rt2/codex-gate.sh" CODEX_GATE_SOURCE="$fx/src/codex-gate.sh" \
    bash "$WRAPPER" config ) > "$SANDBOX/inv54b.txt" 2>"$SANDBOX/inv54b.err"
  status="$(last_json_line "$SANDBOX/inv54b.txt")"
  if printf '%s' "$status" | jq -e '.parity=="MATCH" and (.inventoryDrift|length)==0' >/dev/null 2>&1; then
    pass "sync-inventory (control): two identical COMPLETE skill directories report MATCH with no drift"
  else
    fail "sync-inventory (control): identical complete directories did not report a clean MATCH :: $status :: $(cat "$SANDBOX/inv54b.err")"
  fi
}

#############################################################################
# TEST 55 — [D1] a member absent from BOTH endpoints is INCOMPLETE, never MATCH [CONFIG]
#   digestParity skipped any inventory member missing from both sides, on the reasoning
#   that "two copies that both lack a file have no drift BETWEEN them". True, and beside
#   the point: the question `config` is asked is "is the gate that runs the versioned
#   one, and can it run?". Two skill directories that BOTH lack question.schema.json
#   were certified `parity: MATCH` with an EMPTY inventoryDrift — a full green over two
#   incomplete installs, one of which is the gate the operator is about to trust.
#   Completeness is therefore its own reported state, and MATCH requires it.
#############################################################################
run_test_55() {
  local fx status
  fx="$SANDBOX/cmpfx55"
  make_skill_fixture "$fx/src" gpt-5.6-sol xhigh 0 same-docs
  make_skill_fixture "$fx/rt"  gpt-5.6-sol xhigh 0 same-docs

  # ---- (A) control FIRST: while both are complete this pair is a real, full MATCH ----
  ( CODEX_GATE_RUNTIME="$fx/rt/codex-gate.sh" CODEX_GATE_SOURCE="$fx/src/codex-gate.sh" \
    bash "$WRAPPER" config ) > "$SANDBOX/cmp55a.txt" 2>"$SANDBOX/cmp55a.err"
  status="$(last_json_line "$SANDBOX/cmp55a.txt")"
  if printf '%s' "$status" | jq -e '.parity=="MATCH" and .completeness=="COMPLETE" and (.inventoryMissing|length)==0' >/dev/null 2>&1; then
    pass "config-completeness (control): two COMPLETE identical skill dirs report MATCH with completeness=COMPLETE"
  else
    fail "config-completeness (control): a complete identical pair did not report a clean COMPLETE MATCH :: $status :: $(cat "$SANDBOX/cmp55a.err")"
  fi

  # ---- (B) the defect: remove a required member from BOTH sides ----
  rm -f "$fx/src/question.schema.json" "$fx/rt/question.schema.json"
  ( CODEX_GATE_RUNTIME="$fx/rt/codex-gate.sh" CODEX_GATE_SOURCE="$fx/src/codex-gate.sh" \
    bash "$WRAPPER" config ) > "$SANDBOX/cmp55b.txt" 2>"$SANDBOX/cmp55b.err"
  status="$(last_json_line "$SANDBOX/cmp55b.txt")"
  if printf '%s' "$status" | jq -e '.parity!="MATCH"' >/dev/null 2>&1; then
    pass "config-completeness: a member absent from BOTH endpoints is never certified parity MATCH"
  else
    fail "config-completeness: two INCOMPLETE skill dirs were certified a full MATCH :: $status :: $(cat "$SANDBOX/cmp55b.err")"
  fi
  if printf '%s' "$status" | jq -e '.completeness=="INCOMPLETE"' >/dev/null 2>&1; then
    pass "config-completeness: completeness is reported as its own explicit state (INCOMPLETE)"
  else
    fail "config-completeness: no INCOMPLETE completeness state reported :: $status"
  fi
  if printf '%s' "$status" | jq -e '.inventoryMissing | map(select(.file=="question.schema.json" and .endpoint=="both")) | length == 1' >/dev/null 2>&1; then
    pass "config-completeness: the missing member is NAMED, with the endpoint it is missing from (both)"
  else
    fail "config-completeness: the absent member/endpoint was not named :: $(printf '%s' "$status" | jq -c '.inventoryMissing')"
  fi
  if printf '%s' "$status" | jq -e '.summary | contains("question.schema.json")' >/dev/null 2>&1; then
    pass "config-completeness: the human summary names the missing member too, not just the machine field"
  else
    fail "config-completeness: summary does not name the missing member :: $(printf '%s' "$status" | jq -r '.summary')"
  fi

  # ---- (C) a ONE-SIDED absence is still MISMATCH, and names which endpoint lacks it ----
  fx="$SANDBOX/cmpfx55c"
  make_skill_fixture "$fx/src" gpt-5.6-sol xhigh 0 same-docs
  make_skill_fixture "$fx/rt"  gpt-5.6-sol xhigh 0 same-docs
  rm -f "$fx/rt/investigate.schema.json"
  ( CODEX_GATE_RUNTIME="$fx/rt/codex-gate.sh" CODEX_GATE_SOURCE="$fx/src/codex-gate.sh" \
    bash "$WRAPPER" config ) > "$SANDBOX/cmp55c.txt" 2>"$SANDBOX/cmp55c.err"
  status="$(last_json_line "$SANDBOX/cmp55c.txt")"
  if printf '%s' "$status" | jq -e '.parity=="MISMATCH" and .completeness=="INCOMPLETE"' >/dev/null 2>&1; then
    pass "config-completeness: a one-sided absence stays MISMATCH (a real difference) AND reports INCOMPLETE"
  else
    fail "config-completeness: one-sided absence not reported as MISMATCH+INCOMPLETE :: $status"
  fi
  if printf '%s' "$status" | jq -e '.inventoryMissing | map(select(.file=="investigate.schema.json" and .endpoint=="runtime")) | length == 1' >/dev/null 2>&1; then
    pass "config-completeness: a one-sided absence names the endpoint that lacks it (runtime)"
  else
    fail "config-completeness: one-sided absence did not name the runtime endpoint :: $(printf '%s' "$status" | jq -c '.inventoryMissing')"
  fi
}

#############################################################################
# TEST 56 — `runtimeExecutable` is a DIAGNOSTIC, not a parity failure [CONFIG]
#   RETRACTION of an earlier overcorrection in this same file. Making a missing +x bit
#   force `parity: INCOMPLETE` asserted something FALSE: every documented invocation of
#   this skill runs the wrapper as `bash codex-gate.sh …`, and `bash <file>` needs only
#   READ permission. A mode-0644 runtime runs perfectly well — proven below by running
#   `config` FROM a 0644 copy and getting exit 0 — so calling it "cannot run" sent an
#   operator to chase a bit that was never the problem.
#   The bit is still worth REPORTING (an install meant to be exec'd directly, or a copy
#   tool that dropped the mode, is a real thing to notice), so `runtimeExecutable` stays
#   in the report. It just must not move `parity` or `completeness`.
#############################################################################
run_test_56() {
  local fx status rc
  fx="$SANDBOX/execfx56"
  make_skill_fixture "$fx/src" gpt-5.6-sol xhigh 0 same-docs
  make_skill_fixture "$fx/rt"  gpt-5.6-sol xhigh 0 same-docs

  # ---- (A) control FIRST: executable + identical => a real MATCH ----
  ( CODEX_GATE_RUNTIME="$fx/rt/codex-gate.sh" CODEX_GATE_SOURCE="$fx/src/codex-gate.sh" \
    bash "$WRAPPER" config ) > "$SANDBOX/exec56a.txt" 2>"$SANDBOX/exec56a.err"
  status="$(last_json_line "$SANDBOX/exec56a.txt")"
  if printf '%s' "$status" | jq -e '.runtimeExecutable==true and .parity=="MATCH"' >/dev/null 2>&1; then
    pass "config-executable (control): an executable, byte-identical runtime reports runtimeExecutable=true and MATCH"
  else
    fail "config-executable (control): an executable identical runtime did not report a clean MATCH :: $status :: $(cat "$SANDBOX/exec56a.err")"
  fi

  # ---- (B) same bytes, no +x: STILL REPORTED, but no longer a parity failure ----
  chmod -x "$fx/rt/codex-gate.sh"
  ( CODEX_GATE_RUNTIME="$fx/rt/codex-gate.sh" CODEX_GATE_SOURCE="$fx/src/codex-gate.sh" \
    bash "$WRAPPER" config ) > "$SANDBOX/exec56b.txt" 2>"$SANDBOX/exec56b.err"
  status="$(last_json_line "$SANDBOX/exec56b.txt")"
  if printf '%s' "$status" | jq -e '.digestParity=="MATCH"' >/dev/null 2>&1; then
    pass "config-executable: the bytes really are identical (digestParity MATCH) — the mode is the only difference"
  else
    fail "config-executable: fixture is wrong, the bytes differ :: $status :: $(cat "$SANDBOX/exec56b.err")"
  fi
  if printf '%s' "$status" | jq -e '.runtimeExecutable==false' >/dev/null 2>&1; then
    pass "config-executable: a runtime without the executable bit is still REPORTED as runtimeExecutable=false (the diagnostic survives)"
  else
    fail "config-executable: the missing executable bit was not surfaced :: $status"
  fi
  if printf '%s' "$status" | jq -e '.parity=="MATCH" and .completeness=="COMPLETE"' >/dev/null 2>&1; then
    pass "config-executable: the missing +x does NOT move parity or completeness — \`bash codex-gate.sh\` does not need it"
  else
    fail "config-executable: a mode-only difference was still scored against parity/completeness :: $(printf '%s' "$status" | jq -c '{parity,completeness,runtimeExecutable}')"
  fi
  if printf '%s' "$status" | jq -e '.summary | test("cannot run"; "i") | not' >/dev/null 2>&1; then
    pass "config-executable: the summary no longer claims a non-executable runtime cannot run"
  else
    fail "config-executable: summary still claims the gate cannot run :: $(printf '%s' "$status" | jq -r '.summary')"
  fi

  # ---- (C) the RETRACTION's evidence: a 0644 copy of THIS skill really does run ----
  #   Not an argument about permissions — an execution. Copy the whole inventory, drop the
  #   +x bit, and drive `config` through `bash`. Exit 0 with outcome CONFIG is proof that
  #   "not executable" and "cannot run" are different claims.
  copy_real_skill "$fx/live"
  chmod 0644 "$fx/live/codex-gate.sh"
  ( CODEX_GATE_RUNTIME="$fx/live/codex-gate.sh" CODEX_GATE_SOURCE="$fx/live/codex-gate.sh" \
    bash "$fx/live/codex-gate.sh" config ) > "$SANDBOX/exec56d.txt" 2>"$SANDBOX/exec56d.err"
  rc=$?
  status="$(last_json_line "$SANDBOX/exec56d.txt")"
  if [ "$rc" -eq 0 ] && printf '%s' "$status" | jq -e '.outcome=="CONFIG"' >/dev/null 2>&1; then
    pass "config-executable: a mode-0644 copy of this skill RUNS \`config\` to completion (exit 0) — 'not executable' != 'cannot run'"
  else
    fail "config-executable: the 0644 copy did not run :: rc=$rc :: $(cat "$SANDBOX/exec56d.err")"
  fi
  if [ ! -x "$fx/live/codex-gate.sh" ] && printf '%s' "$status" | jq -e '.runtimeExecutable==false and .parity!="INCOMPLETE"' >/dev/null 2>&1; then
    pass "config-executable: that very run reports runtimeExecutable=false about ITSELF and still does not call the install INCOMPLETE"
  else
    fail "config-executable: the self-report of a running 0644 gate is inconsistent :: $(printf '%s' "$status" | jq -c '{parity,completeness,runtimeExecutable}')"
  fi

  # ---- (D) restoring the bit changes nothing about parity (it never should have) ----
  chmod +x "$fx/rt/codex-gate.sh"
  ( CODEX_GATE_RUNTIME="$fx/rt/codex-gate.sh" CODEX_GATE_SOURCE="$fx/src/codex-gate.sh" \
    bash "$WRAPPER" config ) > "$SANDBOX/exec56c.txt" 2>"$SANDBOX/exec56c.err"
  status="$(last_json_line "$SANDBOX/exec56c.txt")"
  if printf '%s' "$status" | jq -e '.runtimeExecutable==true and .parity=="MATCH"' >/dev/null 2>&1; then
    pass "config-executable: restoring +x flips only the diagnostic; parity stays MATCH (nothing else was disturbed)"
  else
    fail "config-executable: restoring +x disturbed the report :: $status"
  fi
}

#############################################################################
# TEST 57 — auto-discovery must PROVE the tracked canonical source [CONFIG]
#   `config`'s whole value is telling an operator whether the gate that runs is the code
#   in the repo. It answered that by asking `git rev-parse --show-toplevel` from the
#   running script's directory and, on success, nominating the RUNNING SCRIPT as "the
#   versioned copy" — so a runtime that merely SITS under some git work tree (a dotfiles
#   repo, an unrelated checkout, a scratch repo) compared itself with itself and reported
#   MATCH / COMPLETE while the real repo had moved on. Being inside a work tree is not
#   evidence of being the versioned copy; being TRACKED at the canonical repo-relative
#   path `plugin/skills/codex-gate/codex-gate.sh` is. Unprovable => UNAVAILABLE, never
#   silent self-certification.
#############################################################################
mk_repo_at() { # <dir> — a committed git repo at an exact path (make_repo picks its own)
  mkdir -p "$1"
  git -C "$1" init -q
  git -C "$1" config user.email t@t.co
  git -C "$1" config user.name "t"
  git -C "$1" config commit.gpgsign false
}

run_test_57() {
  local base repo status
  base="$SANDBOX/srcfx57"

  # ---- (A) the defect: a complete but UNTRACKED skill under a git work tree ----
  repo="$base/untracked"
  mk_repo_at "$repo"
  printf 'anchor\n' > "$repo/anchor.txt"
  git -C "$repo" add anchor.txt && git -C "$repo" commit -qm anchor
  copy_real_skill "$repo/untracked-skill"
  # the premise, asserted rather than assumed: git really does not know this file
  if git -C "$repo" ls-files --error-unmatch -- untracked-skill/codex-gate.sh >/dev/null 2>&1; then
    fail "config-source (fixture): untracked-skill/codex-gate.sh is TRACKED — the fixture does not reproduce the defect"
  else
    pass "config-source (fixture): the copied skill really is untracked, inside a real git work tree"
  fi
  ( cd "$SANDBOX" && CODEX_GATE_RUNTIME="$repo/untracked-skill/codex-gate.sh" \
      bash "$repo/untracked-skill/codex-gate.sh" config ) > "$SANDBOX/src57a.txt" 2>"$SANDBOX/src57a.err"
  status="$(last_json_line "$SANDBOX/src57a.txt")"
  if printf '%s' "$status" | jq -e '.sourcePath=="" and .sourcePath!=.runtimePath' >/dev/null 2>&1; then
    pass "config-source: an UNTRACKED running script never nominates ITSELF as the versioned source"
  else
    fail "config-source: an untracked runtime self-certified as the source :: $(printf '%s' "$status" | jq -c '{sourcePath,runtimePath,sourceDiscovery}')"
  fi
  if printf '%s' "$status" | jq -e '.parity=="UNAVAILABLE" and .digestParity=="UNAVAILABLE" and .completeness=="UNAVAILABLE"' >/dev/null 2>&1; then
    pass "config-source: with no provable source the answer is UNAVAILABLE — not a MATCH of a copy against itself"
  else
    fail "config-source: unprovable source did not report UNAVAILABLE :: $(printf '%s' "$status" | jq -c '{parity,digestParity,completeness}')"
  fi
  if printf '%s' "$status" | jq -e '.sourceDiscovery | test("track"; "i")' >/dev/null 2>&1; then
    pass "config-source: sourceDiscovery states WHY (the running script is not the tracked canonical copy)"
  else
    fail "config-source: the refusal is unexplained :: $(printf '%s' "$status" | jq -r '.sourceDiscovery')"
  fi

  # ---- (B) the normal case MUST keep working: a real checkout auto-discovers ----
  repo="$base/checkout"
  mk_repo_at "$repo"
  copy_real_skill "$repo/plugin/skills/codex-gate"
  git -C "$repo" add -A && git -C "$repo" commit -qm skill
  ( cd "$SANDBOX" && CODEX_GATE_RUNTIME="$repo/plugin/skills/codex-gate/codex-gate.sh" \
      bash "$repo/plugin/skills/codex-gate/codex-gate.sh" config ) > "$SANDBOX/src57b.txt" 2>"$SANDBOX/src57b.err"
  status="$(last_json_line "$SANDBOX/src57b.txt")"
  if printf '%s' "$status" | jq -e --arg p "$repo/plugin/skills/codex-gate/codex-gate.sh" '.sourcePath==$p' >/dev/null 2>&1; then
    pass "config-source: running from a real checkout, where the script IS tracked at the canonical path, still auto-discovers itself as the source"
  else
    fail "config-source: the legitimate checkout case stopped auto-discovering :: $(printf '%s' "$status" | jq -c '{sourcePath,sourceDiscovery}') :: $(cat "$SANDBOX/src57b.err")"
  fi
  if printf '%s' "$status" | jq -e '.parity=="MATCH"' >/dev/null 2>&1; then
    pass "config-source: that legitimate self-discovery still yields a full MATCH end to end"
  else
    fail "config-source: legitimate checkout did not reach MATCH :: $(printf '%s' "$status" | jq -c '{parity,digestParity,effectiveParity,completeness}')"
  fi

  # ---- (C) TRACKED but at a NON-canonical path is not the canonical copy either ----
  repo="$base/offpath"
  mk_repo_at "$repo"
  copy_real_skill "$repo/tools/gate"
  git -C "$repo" add -A && git -C "$repo" commit -qm offpath
  ( cd "$SANDBOX" && CODEX_GATE_RUNTIME="$repo/tools/gate/codex-gate.sh" \
      bash "$repo/tools/gate/codex-gate.sh" config ) > "$SANDBOX/src57c.txt" 2>"$SANDBOX/src57c.err"
  status="$(last_json_line "$SANDBOX/src57c.txt")"
  if printf '%s' "$status" | jq -e '.sourcePath=="" and .parity=="UNAVAILABLE"' >/dev/null 2>&1; then
    pass "config-source: tracked but at a non-canonical path is NOT the versioned copy (UNAVAILABLE, no self-certification)"
  else
    fail "config-source: a tracked off-path copy self-certified :: $(printf '%s' "$status" | jq -c '{sourcePath,sourceDiscovery,parity}')"
  fi

  # ---- (D) the explicit override still works, tracked or not ----
  ( cd "$SANDBOX" && CODEX_GATE_RUNTIME="$base/untracked/untracked-skill/codex-gate.sh" \
      CODEX_GATE_SOURCE="$base/untracked/untracked-skill/codex-gate.sh" \
      bash "$base/untracked/untracked-skill/codex-gate.sh" config ) > "$SANDBOX/src57d.txt" 2>"$SANDBOX/src57d.err"
  status="$(last_json_line "$SANDBOX/src57d.txt")"
  if printf '%s' "$status" | jq -e '.sourceDiscovery=="CODEX_GATE_SOURCE" and .parity=="MATCH"' >/dev/null 2>&1; then
    pass "config-source: an EXPLICIT CODEX_GATE_SOURCE is still honoured for an untracked path (the operator said so)"
  else
    fail "config-source: the explicit override stopped working :: $(printf '%s' "$status" | jq -c '{sourceDiscovery,parity}') :: $(cat "$SANDBOX/src57d.err")"
  fi

  # ---- (E) the cwd-checkout rule still resolves, and only to a TRACKED canonical file ----
  ( cd "$base/checkout" && CODEX_GATE_RUNTIME="$base/untracked/untracked-skill/codex-gate.sh" \
      bash "$base/untracked/untracked-skill/codex-gate.sh" config ) > "$SANDBOX/src57e.txt" 2>"$SANDBOX/src57e.err"
  status="$(last_json_line "$SANDBOX/src57e.txt")"
  if printf '%s' "$status" | jq -e --arg p "$base/checkout/plugin/skills/codex-gate/codex-gate.sh" '.sourcePath==$p' >/dev/null 2>&1; then
    pass "config-source: an untracked runtime run FROM a real checkout resolves the source to that checkout's tracked canonical copy (rule 3 intact)"
  else
    fail "config-source: the cwd-checkout discovery rule regressed :: $(printf '%s' "$status" | jq -c '{sourcePath,sourceDiscovery}')"
  fi
}

#############################################################################
# TEST 58 — the MISMATCH remedy must match the CAUSE [CONFIG]
#   One remedy sentence for two opposite causes is a wrong instruction half the time.
#   Identical, complete endpoints plus a SUPPORTED env override (`CODEX_GATE_MODEL=''`,
#   the documented "let Codex pick" hatch) reported `digestParity: MATCH`,
#   `effectiveParity: MISMATCH`, an EMPTY inventoryDrift and `origin.model:
#   CODEX_GATE_MODEL` — and then told the operator "a fix in the source may not be
#   reaching the running gate", i.e. go copy files. Copying cannot clear an env override;
#   the operator would copy, see the same MISMATCH, and copy again.
#   Files differ => sync. Environment differs => name the variable. Both => say both.
#   PROVEN FALSE GREEN (round 1): this test used to assert the env-only case only by the
#   ABSENCE of phrases ("sync by hand|Manual sync|reaching the running gate") in `summary`.
#   Seeding a file-sync remedy in the digestParity MATCH path with different wording (e.g.
#   plain "sync the files") left the whole suite green, because an absence-of-phrase check
#   cannot see a correct claim dressed in new words. Fix: `config` now emits a `remediation`
#   action list — a small closed set (sync-files | clear-env-override | rerun-from-source)
#   built from the exact same conditions that grow `summary`.
#   PROVEN FALSE GREEN (round 2): the action list alone still missed a PROSE-only defect —
#   poisoning `remedy`'s initial value (`local remedy=""` -> `local remedy="sync the
#   files"`) leaves `remediation` correct (the guard around `remActionsRaw` is untouched)
#   while `summary` wrongly tells the operator to sync files on an env-only mismatch, and
#   no assertion looked at prose at all anymore. Fix: two more structural, non-guessable
#   prose checks, both read the LIVE running script rather than hard-coding a guess —
#   (1) `syncFileRemedy` is single-sourced in codex-gate.sh; the test extracts that exact
#   sentence and checks its CONTAINMENT (present when sync-files fires, absent when it does
#   not) — single-sourced so a legitimate reword updates both sides at once; (2) the ". ALSO:
#   " join token only appears when `remedy` is non-empty BEFORE a second cause is appended,
#   i.e. only when TWO real causes coincide — so its presence/absence is a structural tell
#   for "a clause got prepended that should not have fired" regardless of that clause's
#   actual wording, which is exactly what a poisoned default produces.
#############################################################################
run_test_58() {
  local fx status syncText
  fx="$SANDBOX/remfx58"
  make_skill_fixture "$fx/src"   gpt-6-astra  xhigh 0 same-docs
  make_skill_fixture "$fx/rt"    gpt-6-astra  xhigh 0 same-docs
  make_skill_fixture "$fx/drift" gpt-5.6-terra ultra 1 drifted-docs
  # Single-sourced: read the CANONICAL sync-file sentence out of the running script under
  # test rather than hard-coding a guess of it here — a legitimate reword in codex-gate.sh
  # updates this extraction too, but a mutation that bypasses `syncFileRemedy` (uses
  # different, ad hoc wording) leaves this variable holding the OLD/real sentence, which
  # then correctly fails to appear where it should and correctly fails to be absent where
  # it should not.
  syncText="$(sed -n "s/^.*local syncFileRemedy='\\(.*\\)'\$/\\1/p" "$WRAPPER" | head -1)"
  [ -n "$syncText" ] || fail "config-remedy: could not extract syncFileRemedy from $WRAPPER — is the single-source declaration still there?"

  # ---- (A) ENV-ONLY drift: nothing on disk is wrong ----
  ( CODEX_GATE_MODEL="" CODEX_GATE_RUNTIME="$fx/rt/codex-gate.sh" CODEX_GATE_SOURCE="$fx/src/codex-gate.sh" \
    bash "$WRAPPER" config ) > "$SANDBOX/rem58a.txt" 2>"$SANDBOX/rem58a.err"
  status="$(last_json_line "$SANDBOX/rem58a.txt")"
  if printf '%s' "$status" | jq -e '.digestParity=="MATCH" and .effectiveParity=="MISMATCH" and (.inventoryDrift|length)==0 and .origin.model=="CODEX_GATE_MODEL"' >/dev/null 2>&1; then
    pass "config-remedy (premise): identical complete copies + CODEX_GATE_MODEL='' is an effective-ONLY mismatch with zero inventory drift"
  else
    fail "config-remedy: the env-only fixture is not the state under test :: $(printf '%s' "$status" | jq -c '{digestParity,effectiveParity,inventoryDrift,origin}') :: $(cat "$SANDBOX/rem58a.err")"
  fi
  if printf '%s' "$status" | jq -e '.summary | test("CODEX_GATE_MODEL")' >/dev/null 2>&1; then
    pass "config-remedy: an env-only mismatch NAMES the overriding variable"
  else
    fail "config-remedy: env-only mismatch does not name the variable :: $(printf '%s' "$status" | jq -r '.summary')"
  fi
  if printf '%s' "$status" | jq -e '.summary | test("clear or change"; "i")' >/dev/null 2>&1; then
    pass "config-remedy: an env-only mismatch says to clear or change that variable"
  else
    fail "config-remedy: env-only mismatch gives no env remedy :: $(printf '%s' "$status" | jq -r '.summary')"
  fi
  # Structural, not prose: the action list must be clear-env-override and ONLY that — no
  # sync-files, under ANY wording the summary might use. A digestParity MATCH means
  # copying files fixes nothing, so sync-files must never appear here.
  if printf '%s' "$status" | jq -e '(.remediation | index("clear-env-override") != null) and (.remediation | index("sync-files") == null)' >/dev/null 2>&1; then
    pass "config-remedy: an env-only mismatch's action list is clear-env-override ONLY, never sync-files"
  else
    fail "config-remedy: env-only mismatch has the wrong action list :: $(printf '%s' "$status" | jq -c '.remediation')"
  fi
  # PROSE, not just structure — two checks, neither a guessed synonym:
  # (1) the single-sourced canonical sync sentence must be ABSENT (copying fixes nothing
  #     here); (2) the ". ALSO: " join token must be ABSENT — it can only appear when a
  #     first clause already fired before the env clause was appended, so its presence
  #     here means SOMETHING wrongly fired first, whatever words it used.
  if printf '%s' "$status" | jq -e --arg t "$syncText" '(.summary | contains($t) | not) and (.summary | contains(". ALSO: ") | not)' >/dev/null 2>&1; then
    pass "config-remedy: an env-only mismatch's PROSE carries no sync sentence and no ALSO-join (nothing fired ahead of the env clause)"
  else
    fail "config-remedy: env-only mismatch's prose leaks a sync instruction :: $(printf '%s' "$status" | jq -r '.summary')"
  fi

  # ---- (B) FILE-ONLY drift: no override in play ----
  #   Both parities report MISMATCH here, and both for the SAME cause. The runtime's file
  #   differs from the source's, and one of the things it differs in is its declared dials
  #   — so the dials that will actually be in force at that runtime are not the source's
  #   either. That is one fault with one fix (copy the files), not two, which is why the
  #   action list below must be sync-files ALONE and the prose must carry no ALSO-join.
  ( CODEX_GATE_RUNTIME="$fx/drift/codex-gate.sh" CODEX_GATE_SOURCE="$fx/src/codex-gate.sh" \
    bash "$WRAPPER" config ) > "$SANDBOX/rem58b.txt" 2>"$SANDBOX/rem58b.err"
  status="$(last_json_line "$SANDBOX/rem58b.txt")"
  if printf '%s' "$status" | jq -e '.digestParity=="MISMATCH" and .origin=={model:"default",effort:"default",fast:"default"}' >/dev/null 2>&1; then
    pass "config-remedy (premise): a divergent runtime with NO env override in play is a file-caused mismatch"
  else
    fail "config-remedy: the file-only fixture is not the state under test :: $(printf '%s' "$status" | jq -c '{digestParity,effectiveParity,origin}')"
  fi
  if printf '%s' "$status" | jq -e '.effectiveParity=="MISMATCH" and .effective.model=="gpt-5.6-terra" and .sourceDefaults.model=="gpt-6-astra"' >/dev/null 2>&1; then
    pass "config-remedy (premise): the drifted runtime's OWN dials are what will be in force, so effectiveParity reports the divergence too"
  else
    fail "config-remedy: effectiveParity did not see the runtime's declared drift :: $(printf '%s' "$status" | jq -c '{effectiveParity,effective,sourceDefaults}')"
  fi
  if printf '%s' "$status" | jq -e --arg t "$syncText" '.summary | contains($t)' >/dev/null 2>&1; then
    pass "config-remedy: a file-only mismatch's PROSE carries the exact single-sourced sync sentence"
  else
    fail "config-remedy: file drift lost its sync remedy :: $(printf '%s' "$status" | jq -r '.summary')"
  fi
  if printf '%s' "$status" | jq -e '.summary | test("CODEX_GATE_(MODEL|EFFORT|FAST)") | not' >/dev/null 2>&1; then
    pass "config-remedy: a file-only mismatch blames no environment variable (there is none in play)"
  else
    fail "config-remedy: file-only mismatch invented an env cause :: $(printf '%s' "$status" | jq -r '.summary')"
  fi
  if printf '%s' "$status" | jq -e '(.remediation | index("sync-files") != null) and (.remediation | index("clear-env-override") == null)' >/dev/null 2>&1; then
    pass "config-remedy: a file-only mismatch's action list is sync-files ONLY, never clear-env-override"
  else
    fail "config-remedy: file-only mismatch has the wrong action list :: $(printf '%s' "$status" | jq -c '.remediation')"
  fi
  # No second cause is in play, so no join should have happened either.
  if printf '%s' "$status" | jq -e '.summary | contains(". ALSO: ") | not' >/dev/null 2>&1; then
    pass "config-remedy: a file-only mismatch's PROSE has no ALSO-join (only one cause is real)"
  else
    fail "config-remedy: file-only mismatch's prose wrongly joins a second clause :: $(printf '%s' "$status" | jq -r '.summary')"
  fi

  # ---- (C) BOTH causes at once: say both ----
  ( CODEX_GATE_EFFORT="low" CODEX_GATE_RUNTIME="$fx/drift/codex-gate.sh" CODEX_GATE_SOURCE="$fx/src/codex-gate.sh" \
    bash "$WRAPPER" config ) > "$SANDBOX/rem58c.txt" 2>"$SANDBOX/rem58c.err"
  status="$(last_json_line "$SANDBOX/rem58c.txt")"
  if printf '%s' "$status" | jq -e '.digestParity=="MISMATCH" and .effectiveParity=="MISMATCH"' >/dev/null 2>&1; then
    pass "config-remedy (premise): divergent files PLUS an override is both causes at once"
  else
    fail "config-remedy: the both-causes fixture is not the state under test :: $(printf '%s' "$status" | jq -c '{digestParity,effectiveParity}')"
  fi
  if printf '%s' "$status" | jq -e '(.summary | test("sync"; "i")) and (.summary | test("CODEX_GATE_EFFORT"))' >/dev/null 2>&1; then
    pass "config-remedy: with both causes the summary prescribes BOTH — sync the files and clear the named variable"
  else
    fail "config-remedy: both-causes summary is missing one of the two remedies :: $(printf '%s' "$status" | jq -r '.summary')"
  fi
  if printf '%s' "$status" | jq -e '(.remediation | index("sync-files") != null) and (.remediation | index("clear-env-override") != null)' >/dev/null 2>&1; then
    pass "config-remedy: with both causes the action list contains BOTH sync-files and clear-env-override"
  else
    fail "config-remedy: both-causes action list is missing one of the two actions :: $(printf '%s' "$status" | jq -c '.remediation')"
  fi
  # PROSE, not just structure — the sync sentence AND the join token must BOTH be
  # present, because two independent causes are genuinely real here.
  if printf '%s' "$status" | jq -e --arg t "$syncText" '(.summary | contains($t)) and (.summary | contains(". ALSO: "))' >/dev/null 2>&1; then
    pass "config-remedy: with both causes the PROSE carries the sync sentence AND the ALSO-join"
  else
    fail "config-remedy: both-causes prose is missing the sync sentence or the join :: $(printf '%s' "$status" | jq -r '.summary')"
  fi

  # ---- (D) the REPORTER is the outlier: both endpoints agree, the reporting copy does not ----
  #   Runtime and source are the SAME drifted file, so the two endpoints genuinely match —
  #   parity MATCH is the honest verdict, and `effective` says terra/ultra/fast because that
  #   is what the configured runtime will use. What is off is the copy that produced the
  #   report: this suite's checkout declares sol/xhigh/0. That is not a parity fault, but it
  #   does mean the report was not computed by the source's code, so it must be SAID (a
  #   CAVEAT, not an ALSO-join) and it must ask for rerun-from-source — the one case where a
  #   MATCH legitimately carries an action.
  ( CODEX_GATE_RUNTIME="$fx/drift/codex-gate.sh" CODEX_GATE_SOURCE="$fx/drift/codex-gate.sh" \
    bash "$WRAPPER" config ) > "$SANDBOX/rem58d.txt" 2>"$SANDBOX/rem58d.err"
  status="$(last_json_line "$SANDBOX/rem58d.txt")"
  if printf '%s' "$status" | jq -e '.digestParity=="MATCH" and .effectiveParity=="MATCH" and .parity=="MATCH" and .origin=={model:"default",effort:"default",fast:"default"}' >/dev/null 2>&1; then
    pass "config-remedy (premise): one file used as BOTH endpoints is a real MATCH, with no env override in play"
  else
    fail "config-remedy: the reporter-outlier fixture is not the state under test :: $(printf '%s' "$status" | jq -c '{digestParity,effectiveParity,parity,origin}')"
  fi
  if printf '%s' "$status" | jq -e '.effective.model=="gpt-5.6-terra" and .reporter.dials.model=="gpt-6-astra" and (.effective.model != .reporter.dials.model)' >/dev/null 2>&1; then
    pass "config-remedy (premise): the reporter really is the outlier — effective is the runtime's terra, reporter.dials is the checkout's astra"
  else
    fail "config-remedy: the reporter is not distinguishable from the endpoints here :: $(printf '%s' "$status" | jq -c '{effective,reporter:.reporter.dials}')"
  fi
  if printf '%s' "$status" | jq -e '(.summary | test("no environment override|with NO environment"; "i")) and (.summary | test("CODEX_GATE_(MODEL|EFFORT|FAST)") | not)' >/dev/null 2>&1; then
    pass "config-remedy: the reporter caveat says there is no environment override, and still blames no variable"
  else
    fail "config-remedy: reporter drift mis-attributed :: $(printf '%s' "$status" | jq -r '.summary')"
  fi
  if printf '%s' "$status" | jq -e '.remediation == ["rerun-from-source"]' >/dev/null 2>&1; then
    pass "config-remedy: reporter drift's action list is rerun-from-source ONLY — even over a MATCH"
  else
    fail "config-remedy: reporter drift has the wrong action list :: $(printf '%s' "$status" | jq -c '.remediation')"
  fi
  # PROSE: no sync sentence (nothing on disk differs) and no ALSO-join — the caveat is not
  # a second PARITY cause, and the ALSO token must keep meaning only that.
  if printf '%s' "$status" | jq -e --arg t "$syncText" '(.summary | contains($t) | not) and (.summary | contains(". ALSO: ") | not) and (.summary | contains(". CAVEAT: "))' >/dev/null 2>&1; then
    pass "config-remedy: reporter drift's PROSE carries no sync sentence and no ALSO-join, and is flagged as a CAVEAT"
  else
    fail "config-remedy: reporter drift's prose leaks a sync instruction or mis-joins :: $(printf '%s' "$status" | jq -r '.summary')"
  fi

  # ---- (E) NO drift at all: a clean MATCH must carry an EMPTY action list ----
  ( CODEX_GATE_RUNTIME="$fx/rt/codex-gate.sh" CODEX_GATE_SOURCE="$fx/src/codex-gate.sh" \
    bash "$WRAPPER" config ) > "$SANDBOX/rem58e.txt" 2>"$SANDBOX/rem58e.err"
  status="$(last_json_line "$SANDBOX/rem58e.txt")"
  if printf '%s' "$status" | jq -e '.parity=="MATCH"' >/dev/null 2>&1; then
    pass "config-remedy (premise): identical complete copies with no override at all is a clean MATCH"
  else
    fail "config-remedy: the no-drift fixture is not the state under test :: $(printf '%s' "$status" | jq -c '{digestParity,effectiveParity,parity}') :: $(cat "$SANDBOX/rem58e.err")"
  fi
  if printf '%s' "$status" | jq -e '.remediation == []' >/dev/null 2>&1; then
    pass "config-remedy: a clean MATCH carries an EMPTY action list"
  else
    fail "config-remedy: a clean MATCH still lists a remediation action :: $(printf '%s' "$status" | jq -c '.remediation')"
  fi
}

#############################################################################
# TEST 59 — `install` is an UNKNOWN, NON-MUTATING mode [DISPATCH]
#   The install mutator was deliberately removed: this script REPORTS drift and never
#   writes either endpoint, so syncing stays a manual, visible act. Nothing in the suite
#   pinned that removal — adding a dispatch arm back (even a benign one) left every test
#   green, so the quarantine was a comment, not a contract. Pin it as behaviour: `install`
#   is rejected exactly like any other unknown mode, and the invocation writes NOTHING —
#   not the runtime endpoint, not the repo, not a run dir.
#   This test adds NO production surface; it asserts the absence of one.
#############################################################################
run_test_59() {
  local repo runs fx rc before after argv_lines stampBefore stampAfter body
  runs="$SANDBOX/inst59-runs"
  rm -rf "$runs"
  repo="$(make_repo)"
  printf 'seed\n' > "$repo/seed.txt"
  git -C "$repo" add seed.txt && git -C "$repo" commit -qm init
  before="$(git -C "$repo" status --porcelain)"

  # the endpoint a resurrected mutator would aim at
  fx="$SANDBOX/inst59rt"
  mkdir -p "$fx"
  printf 'do-not-touch-59\n' > "$fx/codex-gate.sh"
  stampBefore="$(file_stamp "$fx/codex-gate.sh")"

  reset_argv_log
  ( cd "$repo" && CODEX_GATE_RUNS="$runs" CODEX_GATE_RUNTIME="$fx/codex-gate.sh" \
      bash "$WRAPPER" install ) > "$SANDBOX/inst59.txt" 2>"$SANDBOX/inst59.err"
  rc=$?
  after="$(git -C "$repo" status --porcelain)"
  argv_lines="$(wc -l < "$STUB_ARGV_LOG" | tr -d ' ')"
  stampAfter="$(file_stamp "$fx/codex-gate.sh")"
  body="$(cat "$fx/codex-gate.sh")"

  if [ "$rc" -eq 2 ] && grep -q 'unknown mode' "$SANDBOX/inst59.err"; then
    pass "dispatch-install: \`install\` is rejected as an unknown mode (exit 2, 'unknown mode' on stderr)"
  else
    fail "dispatch-install: \`install\` was not rejected as unknown :: rc=$rc :: out='$(cat "$SANDBOX/inst59.txt")' :: err='$(cat "$SANDBOX/inst59.err")'"
  fi
  if [ "$stampBefore" = "$stampAfter" ] && [ "$body" = "do-not-touch-59" ]; then
    pass "dispatch-install: it writes NOTHING to the CODEX_GATE_RUNTIME endpoint (mtime, inode and bytes unchanged)"
  else
    fail "dispatch-install: the runtime endpoint was touched :: before='$stampBefore' after='$stampAfter' body='$body'"
  fi
  if [ "$before" = "$after" ]; then
    pass "dispatch-install: the target repo is byte-identical afterwards"
  else
    fail "dispatch-install: the repo was mutated :: before='$before' after='$after'"
  fi
  if [ ! -e "$runs" ]; then
    pass "dispatch-install: no run dir (and therefore no ledger) is created"
  else
    fail "dispatch-install: a run dir was created at $runs :: $(find "$runs" | head -5)"
  fi
  if [ "$argv_lines" = "0" ]; then
    pass "dispatch-install: ZERO codex invocations"
  else
    fail "dispatch-install: codex was invoked :: $(cat "$STUB_ARGV_LOG")"
  fi

  # the usage line must not advertise a mode that does not exist
  ( cd "$repo" && bash "$WRAPPER" ) > "$SANDBOX/inst59b.txt" 2>"$SANDBOX/inst59b.err"
  if grep -q 'usage:' "$SANDBOX/inst59b.err" && ! grep -q 'install' "$SANDBOX/inst59b.err"; then
    pass "dispatch-install: the usage line does not advertise \`install\` (no phantom surface)"
  else
    fail "dispatch-install: usage mentions install (or printed no usage) :: $(cat "$SANDBOX/inst59b.err")"
  fi
}

#############################################################################
# TEST 60 — the inventory ENUMERATION is VALIDATED before any comparison [CONFIG]
#   `inventory_pairs` feeds the digest/completeness loop through a command substitution
#   inside a heredoc. When that substitution yields ZERO rows the loop body simply never
#   executes: `drift` and `missing` stay empty and the code falls straight through to
#   `digestParity: MATCH`, `completeness: COMPLETE`, `parity: MATCH`. A drift detector
#   that compared NOTHING certified perfect agreement — the loudest possible false green,
#   and precisely the state an operator reads as "the installed gate is the repo's code".
#   Four independent ways to reach a short enumeration are driven here — two that break
#   the ENUMERATION with the constant intact, two that corrupt the CONSTANT with the
#   enumeration intact — each against a pair that (control, case E) genuinely IS a MATCH,
#   so an INFRA_ERROR is attributable to the truncation and to nothing else.
#############################################################################
run_test_60() {
  local fx status desc
  fx="$SANDBOX/invguard60"
  # a pair that really would be a full MATCH — the comparison is sound, only the
  # enumeration feeding it is broken
  make_skill_fixture "$fx/src" gpt-5.6-sol xhigh 0 same-docs
  make_skill_fixture "$fx/rt"  gpt-5.6-sol xhigh 0 same-docs

  # ---- (E) control FIRST: the UNMUTATED copy over this very pair is a clean MATCH ----
  copy_real_skill "$fx/gate-control"
  ( cd "$SANDBOX" && CODEX_GATE_RUNTIME="$fx/rt/codex-gate.sh" CODEX_GATE_SOURCE="$fx/src/codex-gate.sh" \
    bash "$fx/gate-control/codex-gate.sh" config ) > "$SANDBOX/inv60e.txt" 2>"$SANDBOX/inv60e.err"
  status="$(last_json_line "$SANDBOX/inv60e.txt")"
  if printf '%s' "$status" | jq -e '.outcome=="CONFIG" and .parity=="MATCH" and (.syncInventory|length)==13' >/dev/null 2>&1; then
    pass "inventory-guard (control): an intact gate compares all 13 members over this pair and reports MATCH"
  else
    fail "inventory-guard (control): the fixture pair is not a MATCH-able pair :: $status :: $(cat "$SANDBOX/inv60e.err")"
  fi

  # ---- (A)-(D) every way of reaching a short enumeration must be INFRA_ERROR ----
  #   Driven as a table so each case is asserted identically: outcome INFRA_ERROR, and —
  #   said separately because it is the actual harm — the report must NOT claim MATCH.
  # NB: every field is split in its OWN statement — a single `local a=… b=$a` expands all
  # of its words BEFORE the builtin runs, so `b` would carry the PREVIOUS iteration's value.
  local dir tag rest slug what
  for desc in \
    "A|enum-zero|zero rows from inventory_pairs (constant intact)" \
    "B|enum-one|a TRUNCATED enumeration of 1 row (constant intact)" \
    "C|const-empty|an EMPTY CODEX_GATE_SYNC_INVENTORY constant" \
    "D|const-short|a TRUNCATED 2-member CODEX_GATE_SYNC_INVENTORY constant" ; do
    tag="${desc%%|*}"
    rest="${desc#*|}"
    slug="${rest%%|*}"
    what="${rest#*|}"
    dir="$fx/gate-$slug"
    copy_real_skill "$dir"
    case "$tag" in
      A) break_fixture_enumeration "$dir/codex-gate.sh" "" ;;
      B) break_fixture_enumeration "$dir/codex-gate.sh" "codex-gate.sh" ;;
      C) set_fixture_inventory     "$dir/codex-gate.sh" "" ;;
      D) set_fixture_inventory     "$dir/codex-gate.sh" 'codex-gate.sh\nverdict.schema.json' ;;
    esac
    ( cd "$SANDBOX" && CODEX_GATE_RUNTIME="$fx/rt/codex-gate.sh" CODEX_GATE_SOURCE="$fx/src/codex-gate.sh" \
      bash "$dir/codex-gate.sh" config ) > "$SANDBOX/inv60$tag.txt" 2>"$SANDBOX/inv60$tag.err"
    status="$(last_json_line "$SANDBOX/inv60$tag.txt")"
    local seen
    seen="$(printf '%s' "$status" | jq -c '{outcome, parity, completeness, digestParity, inventoryMembersReported:(.syncInventory|length)}' 2>/dev/null)"
    if printf '%s' "$status" | jq -e '.outcome=="INFRA_ERROR"' >/dev/null 2>&1; then
      pass "inventory-guard: $what => INFRA_ERROR (the enumeration is validated before it is trusted)"
    else
      fail "inventory-guard: $what did NOT fail closed :: $seen :: $(cat "$SANDBOX/inv60$tag.err")"
    fi
    if printf '%s' "$status" | jq -e '(.parity // "ABSENT") != "MATCH" and (.completeness // "ABSENT") != "COMPLETE"' >/dev/null 2>&1; then
      pass "inventory-guard: $what never reaches MATCH/COMPLETE (a comparison over nothing is not agreement)"
    else
      fail "inventory-guard: $what certified agreement over an incomplete comparison :: $seen"
    fi
    # WHY it refused — and gated on the refusal itself, because the MATCH summary this
    # defect produces already contains the phrase "sync inventory": asserting the wording
    # alone would pass vacuously on the very output it is meant to reject.
    if printf '%s' "$status" | jq -e '.outcome=="INFRA_ERROR" and (.summary | test("inventor"; "i"))' >/dev/null 2>&1; then
      pass "inventory-guard: $what says WHY it refused (an INFRA_ERROR summary naming the inventory)"
    else
      fail "inventory-guard: $what refused without naming the cause :: $(printf '%s' "$status" | jq -r '.outcome + " :: " + (.summary // "<no summary>")')"
    fi
  done
}

#############################################################################
# TEST 61 — `effective` describes the RUNTIME, not the reporter [CONFIG]
#   `effective` was the REPORTING process's own resolved dials, so the answer to "what
#   will the gate that actually runs use?" changed depending on which copy you happened
#   to invoke `config` from: a runtime declaring gpt-5.6-terra/ultra reported
#   `runtimeDefaults: {terra, ultra}` alongside `effective: {sol, xhigh}` whenever the
#   report was produced from the source checkout — useless for reasoning about the
#   configured runtime, and actively misleading in exactly the drift scenario this
#   subcommand exists for.
#   `effective` must therefore be the RUNTIME's declared defaults with the same
#   environment overrides applied that would apply when that runtime is invoked, and it
#   must be INVARIANT to which copy reports it. The reporting process is not lost — it is
#   reported separately as `reporter` (path, digest and its own resolved dials), which
#   this test also pins by showing the two invocations really are different reporters.
#############################################################################
run_test_61() {
  local fx a b
  fx="$SANDBOX/effinv61"
  copy_real_skill "$fx/src"                                         # astra / xhigh / 0
  copy_real_skill "$fx/rt"
  retune_gate_dials "$fx/rt/codex-gate.sh" gpt-5.6-terra ultra 1    # terra / ultra / 1

  # premise: the two copies really do declare different dials
  ( cd "$SANDBOX" && CODEX_GATE_RUNTIME="$fx/rt/codex-gate.sh" CODEX_GATE_SOURCE="$fx/src/codex-gate.sh" \
    bash "$fx/src/codex-gate.sh" config ) > "$SANDBOX/eff61a.txt" 2>"$SANDBOX/eff61a.err"
  a="$(last_json_line "$SANDBOX/eff61a.txt")"
  ( cd "$SANDBOX" && CODEX_GATE_RUNTIME="$fx/rt/codex-gate.sh" CODEX_GATE_SOURCE="$fx/src/codex-gate.sh" \
    bash "$fx/rt/codex-gate.sh" config ) > "$SANDBOX/eff61b.txt" 2>"$SANDBOX/eff61b.err"
  b="$(last_json_line "$SANDBOX/eff61b.txt")"

  if printf '%s' "$a" | jq -e '.runtimeDefaults=={model:"gpt-5.6-terra",effort:"ultra",fast:"1"} and .sourceDefaults=={model:"gpt-6-astra",effort:"xhigh",fast:"0"}' >/dev/null 2>&1; then
    pass "config-effective (premise): the runtime declares terra/ultra/1 and the source declares astra/xhigh/0"
  else
    fail "config-effective: the drifted-runtime fixture is not the state under test :: $(printf '%s' "$a" | jq -c '{runtimeDefaults,sourceDefaults}') :: $(cat "$SANDBOX/eff61a.err")"
    return
  fi

  # ---- the INVARIANCE itself: same configured runtime + same env, either reporter ----
  if [ -n "$a" ] && [ -n "$b" ] && \
     printf '%s\n%s\n' "$a" "$b" | jq -se '.[0].effective == .[1].effective' >/dev/null 2>&1; then
    pass "config-effective: \`effective\` is IDENTICAL whether config is run from the source copy or from the runtime copy"
  else
    fail "config-effective: \`effective\` depends on which copy reported it :: fromSource=$(printf '%s' "$a" | jq -c '.effective') fromRuntime=$(printf '%s' "$b" | jq -c '.effective')"
  fi
  # …and it is the RUNTIME's configuration that both agree on, not the reporter's
  if printf '%s' "$a" | jq -e '.effective=={model:"gpt-5.6-terra",effort:"ultra",fast:true,fastRaw:"1"}' >/dev/null 2>&1; then
    pass "config-effective: reported FROM THE SOURCE copy, \`effective\` still describes the runtime endpoint (terra/ultra/fast)"
  else
    fail "config-effective: from the source copy, effective does not describe the runtime :: $(printf '%s' "$a" | jq -c '.effective')"
  fi
  if printf '%s' "$b" | jq -e '.effective=={model:"gpt-5.6-terra",effort:"ultra",fast:true,fastRaw:"1"}' >/dev/null 2>&1; then
    pass "config-effective: reported FROM THE RUNTIME copy, \`effective\` describes that same runtime endpoint"
  else
    fail "config-effective: from the runtime copy, effective is wrong :: $(printf '%s' "$b" | jq -c '.effective')"
  fi
  # structural restatement: with no override in play, effective IS runtimeDefaults
  if printf '%s\n%s\n' "$a" "$b" | jq -se 'all(.[]; .effective.model==.runtimeDefaults.model and .effective.effort==.runtimeDefaults.effort and .effective.fastRaw==.runtimeDefaults.fast)' >/dev/null 2>&1; then
    pass "config-effective: with no env override, effective equals runtimeDefaults dial-for-dial in BOTH directions"
  else
    fail "config-effective: effective diverges from runtimeDefaults with no override :: A=$(printf '%s' "$a" | jq -c '{effective,runtimeDefaults}') B=$(printf '%s' "$b" | jq -c '{effective,runtimeDefaults}')"
  fi
  # effectiveParity is the runtime-effective dials vs what the SOURCE declares — also invariant
  if printf '%s\n%s\n' "$a" "$b" | jq -se 'all(.[]; .effectiveParity=="MISMATCH") and (.[0].effectiveParity==.[1].effectiveParity)' >/dev/null 2>&1; then
    pass "config-effective: effectiveParity compares the RUNTIME-effective dials with the source's, identically from either copy"
  else
    fail "config-effective: effectiveParity is not the runtime-vs-source comparison :: A=$(printf '%s' "$a" | jq -r '.effectiveParity') B=$(printf '%s' "$b" | jq -r '.effectiveParity')"
  fi

  # ---- the reporter is NOT lost: it is reported separately, and it really differs ----
  if printf '%s' "$a" | jq -e --arg p "$fx/src/codex-gate.sh" '.reporter.path==$p and (.reporter.digest|test("^[0-9a-f]{64}$")) and .reporter.dials.model=="gpt-6-astra" and .reporter.dials.effort=="xhigh" and .reporter.dials.fast==false' >/dev/null 2>&1; then
    pass "config-effective: the SOURCE-copy run reports its own identity + dials under \`reporter\` (path, digest, astra/xhigh/off)"
  else
    fail "config-effective: reporter block missing/wrong on the source-copy run :: $(printf '%s' "$a" | jq -c '.reporter')"
  fi
  if printf '%s' "$b" | jq -e --arg p "$fx/rt/codex-gate.sh" '.reporter.path==$p and .reporter.dials.model=="gpt-5.6-terra" and .reporter.dials.effort=="ultra" and .reporter.dials.fast==true' >/dev/null 2>&1; then
    pass "config-effective: the RUNTIME-copy run reports a DIFFERENT reporter (terra/ultra/fast) — the two really are different processes"
  else
    fail "config-effective: reporter block missing/wrong on the runtime-copy run :: $(printf '%s' "$b" | jq -c '.reporter')"
  fi

  # ---- env overrides apply to the RUNTIME's declared defaults, from either copy ----
  ( cd "$SANDBOX" && CODEX_GATE_EFFORT=low CODEX_GATE_RUNTIME="$fx/rt/codex-gate.sh" CODEX_GATE_SOURCE="$fx/src/codex-gate.sh" \
    bash "$fx/src/codex-gate.sh" config ) > "$SANDBOX/eff61c.txt" 2>"$SANDBOX/eff61c.err"
  a="$(last_json_line "$SANDBOX/eff61c.txt")"
  ( cd "$SANDBOX" && CODEX_GATE_EFFORT=low CODEX_GATE_RUNTIME="$fx/rt/codex-gate.sh" CODEX_GATE_SOURCE="$fx/src/codex-gate.sh" \
    bash "$fx/rt/codex-gate.sh" config ) > "$SANDBOX/eff61d.txt" 2>"$SANDBOX/eff61d.err"
  b="$(last_json_line "$SANDBOX/eff61d.txt")"
  if [ -n "$a" ] && [ -n "$b" ] && printf '%s\n%s\n' "$a" "$b" | jq -se '.[0].effective == .[1].effective and .[0].origin == .[1].origin' >/dev/null 2>&1; then
    pass "config-effective: under an env override, effective + origin are STILL identical from either copy"
  else
    fail "config-effective: an env override reintroduced reporter-dependence :: A=$(printf '%s' "$a" | jq -c '{effective,origin}') B=$(printf '%s' "$b" | jq -c '{effective,origin}')"
  fi
  if printf '%s' "$a" | jq -e '.effective.effort=="low" and .effective.model=="gpt-5.6-terra" and .origin.effort=="CODEX_GATE_EFFORT" and .origin.model=="default"' >/dev/null 2>&1; then
    pass "config-effective: the override lands on the RUNTIME's dials (effort=low over terra), and origin names the variable"
  else
    fail "config-effective: env override not applied to the runtime's declared defaults :: $(printf '%s' "$a" | jq -c '{effective,origin}')"
  fi
}

#############################################################################
# TEST 62 — `UNAVAILABLE` must carry a cause-specific remediation [CONFIG]
#   `remediation` was documented as "empty exactly when MATCH", but a complete skill
#   outside any checkout reported `parity: UNAVAILABLE` with `remediation: []` — byte for
#   byte the same signal as a clean MATCH. A consumer branching on "empty means all good"
#   reads "we could not tell" as "everything agrees", which is the one inference this
#   subcommand exists to prevent. Every non-MATCH parity must name something to DO:
#   `resolve-source` when the versioned copy cannot be located/read/parsed,
#   `resolve-runtime` when the installed gate cannot be.
#############################################################################
run_test_62() {
  local fx status
  fx="$SANDBOX/unavail62"

  # ---- (A) a COMPLETE skill outside any checkout: no source can be proven ----
  copy_real_skill "$fx/orphan"
  ( cd "$SANDBOX" && CODEX_GATE_RUNTIME="$fx/orphan/codex-gate.sh" \
    bash "$fx/orphan/codex-gate.sh" config ) > "$SANDBOX/un62a.txt" 2>"$SANDBOX/un62a.err"
  status="$(last_json_line "$SANDBOX/un62a.txt")"
  if printf '%s' "$status" | jq -e '.parity=="UNAVAILABLE" and .sourcePath==""' >/dev/null 2>&1; then
    pass "config-unavailable (premise): a complete skill outside any checkout reports UNAVAILABLE with no source"
  else
    fail "config-unavailable: the orphan fixture is not the state under test :: $(printf '%s' "$status" | jq -c '{parity,sourcePath,sourceDiscovery}') :: $(cat "$SANDBOX/un62a.err")"
    return
  fi
  if printf '%s' "$status" | jq -e '.remediation | length > 0' >/dev/null 2>&1; then
    pass "config-unavailable: UNAVAILABLE does NOT emit an empty action list (that is the MATCH signal)"
  else
    fail "config-unavailable: UNAVAILABLE emitted remediation [] — indistinguishable from a clean MATCH :: $(printf '%s' "$status" | jq -c '{parity,remediation}')"
  fi
  if printf '%s' "$status" | jq -e '(.remediation | index("resolve-source") != null) and (.remediation | index("sync-files") == null)' >/dev/null 2>&1; then
    pass "config-unavailable: the action is CAUSE-specific — resolve-source, never a sync of files it could not compare"
  else
    fail "config-unavailable: wrong action for an unresolvable source :: $(printf '%s' "$status" | jq -c '.remediation')"
  fi
  if printf '%s' "$status" | jq -e '.summary | test("CODEX_GATE_SOURCE")' >/dev/null 2>&1; then
    pass "config-unavailable: the prose says how to resolve it (names CODEX_GATE_SOURCE)"
  else
    fail "config-unavailable: the prose gives no way out :: $(printf '%s' "$status" | jq -r '.summary')"
  fi

  # ---- (B) the other endpoint: an unlocatable RUNTIME is its own cause ----
  make_skill_fixture "$fx/src" gpt-5.6-sol xhigh 0 same-docs
  ( cd "$SANDBOX" && CODEX_GATE_RUNTIME="$fx/nowhere/codex-gate.sh" CODEX_GATE_SOURCE="$fx/src/codex-gate.sh" \
    bash "$WRAPPER" config ) > "$SANDBOX/un62b.txt" 2>"$SANDBOX/un62b.err"
  status="$(last_json_line "$SANDBOX/un62b.txt")"
  if printf '%s' "$status" | jq -e '.parity=="UNAVAILABLE" and .runtimeKind=="missing"' >/dev/null 2>&1; then
    pass "config-unavailable (premise): a missing runtime endpoint also rolls up to UNAVAILABLE"
  else
    fail "config-unavailable: the missing-runtime fixture is not the state under test :: $(printf '%s' "$status" | jq -c '{parity,runtimeKind}')"
  fi
  if printf '%s' "$status" | jq -e '(.remediation | index("resolve-runtime") != null) and (.remediation | index("resolve-source") == null)' >/dev/null 2>&1; then
    pass "config-unavailable: an unlocatable RUNTIME asks for resolve-runtime, not resolve-source"
  else
    fail "config-unavailable: wrong action for an unresolvable runtime :: $(printf '%s' "$status" | jq -c '.remediation')"
  fi

  # ---- (C) the CONTRACT, stated as behaviour: non-MATCH is never an empty list ----
  #   Asserted over every parity state the suite can produce cheaply, so the invariant is
  #   pinned as a property rather than case by case.
  local caseSpec rt src label
  for caseSpec in \
    "MISMATCH|$fx/drift/codex-gate.sh|$fx/src/codex-gate.sh" \
    "INCOMPLETE|$fx/thin-rt/codex-gate.sh|$fx/thin-src/codex-gate.sh" \
    "UNAVAILABLE|$fx/nowhere/codex-gate.sh|$fx/src/codex-gate.sh" ; do
    label="${caseSpec%%|*}"; rt="${caseSpec#*|}"; src="${rt#*|}"; rt="${rt%%|*}"
    case "$label" in
      MISMATCH)   make_skill_fixture "$fx/drift" gpt-5.6-terra ultra 1 drifted-docs ;;
      INCOMPLETE) make_skill_fixture "$fx/thin-rt"  gpt-5.6-sol xhigh 0 same-docs
                  make_skill_fixture "$fx/thin-src" gpt-5.6-sol xhigh 0 same-docs
                  rm -f "$fx/thin-rt/question.schema.json" "$fx/thin-src/question.schema.json" ;;
    esac
    ( cd "$SANDBOX" && CODEX_GATE_RUNTIME="$rt" CODEX_GATE_SOURCE="$src" bash "$WRAPPER" config ) \
      > "$SANDBOX/un62c-$label.txt" 2>"$SANDBOX/un62c-$label.err"
    status="$(last_json_line "$SANDBOX/un62c-$label.txt")"
    if printf '%s' "$status" | jq -e --arg p "$label" '.parity==$p and (.remediation|length)>0' >/dev/null 2>&1; then
      pass "config-unavailable: parity $label carries a NON-EMPTY remediation (empty is reserved for 'nothing to act on')"
    else
      fail "config-unavailable: parity $label produced no action :: $(printf '%s' "$status" | jq -c '{parity,remediation}') :: $(cat "$SANDBOX/un62c-$label.err")"
    fi
  done
}

#############################################################################
# TEST 63 — each copy's OWN expansion operator decides its dials [CONFIG]
#   `config` parsed every dial's declared default out of the target script but threw the
#   EXPANSION OPERATOR away, then resolved the RUNTIME's dials under the REPORTER's
#   operator. The two are NOT interchangeable: `${VAR:-lit}` falls back to `lit` when the
#   variable is set but EMPTY, `${VAR-lit}` keeps the empty value and overrides with it.
#   Against a runtime declaring `${CODEX_GATE_MODEL:-…}` with `CODEX_GATE_MODEL=''`
#   exported — the drift shape live on this machine today — the report claimed
#   `effective.model: ""`, `origin.model: CODEX_GATE_MODEL`, and told the operator to
#   CLEAR a variable that was changing nothing, about a value that runtime never uses
#   (its own shell resolves the literal). A copy declaring `:-` for the model could not
#   even report: the hardcoded operator gate refused it as INFRA_ERROR.
#   So: every dial is resolved under the operator of the SCRIPT BEING DESCRIBED — the
#   runtime's `effective`/`origin` under the RUNTIME's operators, `reporter.dials` under
#   the reporter's own — and those may legitimately differ from each other, per dial.
#############################################################################
run_test_63() {
  local fx fxs status a b
  fx="$SANDBOX/dialop63"

  # ---- (A) THE REPRODUCED CASE: a `:-` runtime + an EMPTY override -------------------
  # Byte-identical endpoints declaring the SAME literal with `:-` instead of `-`. The
  # empty value cannot reach the dial, so the declared default is what runs: nothing
  # drifted, nothing to clear, and `remediation` must be the empty all-clear.
  copy_real_skill "$fx/colon"
  retune_gate_dial_ops "$fx/colon/codex-gate.sh" ":-" gpt-5.6-sol ":-" xhigh ":-" 0
  fxs="$fx/colon/codex-gate.sh"
  ( hermetic CODEX_GATE_MODEL= CODEX_GATE_RUNTIME="$fxs" CODEX_GATE_SOURCE="$fxs" \
      bash "$WRAPPER" config ) > "$SANDBOX/op63a.txt" 2>"$SANDBOX/op63a.err"
  status="$(last_json_line "$SANDBOX/op63a.txt")"
  if printf '%s' "$status" | jq -e '.effective.model=="gpt-5.6-sol"' >/dev/null 2>&1; then
    pass "config-operator: a \`:-\` runtime with CODEX_GATE_MODEL='' resolves to its DECLARED default (gpt-5.6-sol), as its own shell would"
  else
    fail "config-operator: the \`:-\` runtime's empty override was applied as if it were \`-\` :: $(printf '%s' "$status" | jq -c '{effective,runtimeDefaults}') :: $(cat "$SANDBOX/op63a.err")"
  fi
  if printf '%s' "$status" | jq -e '.origin.model=="default"' >/dev/null 2>&1; then
    pass "config-operator: origin says \`default\` — under \`:-\` the empty variable did NOT override"
  else
    fail "config-operator: origin named CODEX_GATE_MODEL for a value that never reached the dial :: $(printf '%s' "$status" | jq -c '.origin')"
  fi
  if printf '%s' "$status" | jq -e '.effectiveParity=="MATCH" and .parity=="MATCH" and (.remediation|length)==0' >/dev/null 2>&1; then
    pass "config-operator: no drift and NOTHING to act on — remediation is the empty all-clear"
  else
    fail "config-operator: an inert empty override was reported as drift :: $(printf '%s' "$status" | jq -c '{digestParity,effectiveParity,parity,remediation}')"
  fi
  if printf '%s' "$status" | jq -e '(.remediation|index("clear-env-override"))==null and (.summary|test("clear or change")|not)' >/dev/null 2>&1; then
    pass "config-operator: the remediation does NOT tell the operator to clear a variable that changes nothing"
  else
    fail "config-operator: still advising a no-op clear :: $(printf '%s' "$status" | jq -c '{remediation,summary}')"
  fi
  # …and the same answer when the `:-` copy reports on ITSELF (the hardcoded operator
  # gate used to refuse this copy outright with INFRA_ERROR).
  ( hermetic CODEX_GATE_MODEL= CODEX_GATE_RUNTIME="$fxs" CODEX_GATE_SOURCE="$fxs" \
      bash "$fxs" config ) > "$SANDBOX/op63b.txt" 2>"$SANDBOX/op63b.err"
  b="$(last_json_line "$SANDBOX/op63b.txt")"
  if printf '%s\n%s\n' "$status" "$b" | jq -se '.[0].outcome=="CONFIG" and .[1].outcome=="CONFIG" and .[0].effective==.[1].effective and .[0].origin==.[1].origin' >/dev/null 2>&1; then
    pass "config-operator: a copy declaring \`:-\` can report at all, and gives the SAME effective+origin as the pristine reporter"
  else
    fail "config-operator: the \`:-\` copy could not report, or reported differently :: $(printf '%s' "$b" | jq -c '{outcome,summary,effective,origin}')"
  fi

  # ---- (B) THE CONTRAST: with `-`, an EMPTY value genuinely DOES override ------------
  # Same fixture, same empty variable, only the operator differs — and now the empty
  # value really is what the gate runs with, so the advice to clear it is correct.
  copy_real_skill "$fx/dash"
  retune_gate_dial_ops "$fx/dash/codex-gate.sh" "-" gpt-5.6-sol ":-" xhigh ":-" 0
  fxs="$fx/dash/codex-gate.sh"
  ( hermetic CODEX_GATE_MODEL= CODEX_GATE_RUNTIME="$fxs" CODEX_GATE_SOURCE="$fxs" \
      bash "$WRAPPER" config ) > "$SANDBOX/op63c.txt" 2>"$SANDBOX/op63c.err"
  status="$(last_json_line "$SANDBOX/op63c.txt")"
  if printf '%s' "$status" | jq -e '.effective.model=="" and .origin.model=="CODEX_GATE_MODEL"' >/dev/null 2>&1; then
    pass "config-operator (contrast): with \`-\`, CODEX_GATE_MODEL='' DOES override — effective.model is empty and origin names the variable"
  else
    fail "config-operator (contrast): the \`-\` runtime lost its legitimate empty override :: $(printf '%s' "$status" | jq -c '{effective,origin}') :: $(cat "$SANDBOX/op63c.err")"
  fi
  if printf '%s' "$status" | jq -e '.effectiveParity=="MISMATCH" and (.remediation|index("clear-env-override"))!=null' >/dev/null 2>&1; then
    pass "config-operator (contrast): the real override is reported as drift, with clear-env-override as the action"
  else
    fail "config-operator (contrast): a real env override stopped being actionable :: $(printf '%s' "$status" | jq -c '{effectiveParity,remediation}')"
  fi

  # ---- (C) SOURCE and RUNTIME operators DIFFER, each honoured on its own terms -------
  # Exactly the drift on this machine: the versioned source declares `${VAR-…}`, the
  # installed runtime declares `${VAR:-…}`. `effective` follows the RUNTIME's operator
  # from either reporter, while `reporter.origin` follows whichever copy is reporting —
  # so the two really are decoupled rather than one standing in for the other.
  copy_real_skill "$fx/src"
  copy_real_skill "$fx/rt"
  retune_gate_dial_ops "$fx/src/codex-gate.sh" "-"  gpt-5.6-sol   ":-" xhigh ":-" 0
  retune_gate_dial_ops "$fx/rt/codex-gate.sh"  ":-" gpt-5.6-terra ":-" xhigh ":-" 0
  ( hermetic CODEX_GATE_MODEL= CODEX_GATE_RUNTIME="$fx/rt/codex-gate.sh" CODEX_GATE_SOURCE="$fx/src/codex-gate.sh" \
      bash "$fx/src/codex-gate.sh" config ) > "$SANDBOX/op63d.txt" 2>"$SANDBOX/op63d.err"
  a="$(last_json_line "$SANDBOX/op63d.txt")"
  ( hermetic CODEX_GATE_MODEL= CODEX_GATE_RUNTIME="$fx/rt/codex-gate.sh" CODEX_GATE_SOURCE="$fx/src/codex-gate.sh" \
      bash "$fx/rt/codex-gate.sh" config ) > "$SANDBOX/op63e.txt" 2>"$SANDBOX/op63e.err"
  b="$(last_json_line "$SANDBOX/op63e.txt")"
  if printf '%s' "$a" | jq -e '.sourceDefaults.model=="gpt-5.6-sol" and .runtimeDefaults.model=="gpt-5.6-terra"' >/dev/null 2>&1; then
    pass "config-operator (premise): the source declares sol with \`-\` and the runtime declares terra with \`:-\`"
  else
    fail "config-operator: the mixed-operator fixture is not the state under test :: $(printf '%s' "$a" | jq -c '{sourceDefaults,runtimeDefaults}') :: $(cat "$SANDBOX/op63d.err")"
    return
  fi
  if printf '%s' "$a" | jq -e '.effective.model=="gpt-5.6-terra" and .origin.model=="default"' >/dev/null 2>&1; then
    pass "config-operator: reported FROM the \`-\` source, \`effective\` still follows the RUNTIME's \`:-\` (terra, origin default)"
  else
    fail "config-operator: the reporter's operator leaked into the runtime's effective :: $(printf '%s' "$a" | jq -c '{effective,origin}')"
  fi
  if printf '%s\n%s\n' "$a" "$b" | jq -se '.[0].effective==.[1].effective and .[0].origin==.[1].origin' >/dev/null 2>&1; then
    pass "config-operator: effective + origin are IDENTICAL from either copy even when the two copies' operators differ"
  else
    fail "config-operator: mixed operators reintroduced reporter-dependence :: A=$(printf '%s' "$a" | jq -c '{effective,origin}') B=$(printf '%s' "$b" | jq -c '{effective,origin}')"
  fi
  # The reporter is resolved under ITS OWN operator, and the two reporters disagree —
  # correctly, because they really do expand the same empty variable differently.
  if printf '%s' "$a" | jq -e '.reporter.origin.model=="CODEX_GATE_MODEL" and .reporter.dials.model==""' >/dev/null 2>&1; then
    pass "config-operator: the \`-\` reporter reports its OWN dials as overridden-to-empty"
  else
    fail "config-operator: the \`-\` reporter's own origin/dials are wrong :: $(printf '%s' "$a" | jq -c '.reporter')"
  fi
  if printf '%s' "$b" | jq -e '.reporter.origin.model=="default" and .reporter.dials.model=="gpt-5.6-terra"' >/dev/null 2>&1; then
    pass "config-operator: the \`:-\` reporter reports its OWN dials as defaulted — each script's operator honoured independently"
  else
    fail "config-operator: the \`:-\` reporter's own origin/dials are wrong :: $(printf '%s' "$b" | jq -c '.reporter')"
  fi
  # The runtime's dials were NOT moved by the environment, so the remedy is the file
  # sync alone — clearing the variable would change nothing at that runtime.
  if printf '%s' "$a" | jq -e '(.remediation|index("sync-files"))!=null and (.remediation|index("clear-env-override"))==null' >/dev/null 2>&1; then
    pass "config-operator: the mixed-operator drift is a FILE fix, not an env one"
  else
    fail "config-operator: wrong cause attributed to the mixed-operator drift :: $(printf '%s' "$a" | jq -c '{remediation,summary}')"
  fi

  # ---- (D) THE CROSS-PRODUCT: every dial × both operators × {unset, empty, set} ------
  # One byte-identical endpoint pair per row (runtime and source are the same file, so
  # the only thing under test is the resolution), reported from the pristine wrapper so
  # the reporter's own operators are never the ones being read.
  copy_real_skill "$fx/xp"
  fxs="$fx/xp/codex-gate.sh"
  local dial op lit state expVal expOrigin mOp mLit eOp eLit fOp fLit var ovr key
  while IFS='|' read -r dial op lit state expVal expOrigin; do
    [ -n "$dial" ] || continue
    mOp="-"; mLit="gpt-5.6-sol"; eOp=":-"; eLit="xhigh"; fOp=":-"; fLit="0"
    case "$dial" in
      model)  mOp="$op"; mLit="$lit"; var="CODEX_GATE_MODEL";  ovr="gpt-5.6-ultra"; key="model" ;;
      effort) eOp="$op"; eLit="$lit"; var="CODEX_GATE_EFFORT"; ovr="low";           key="effort" ;;
      fast)   fOp="$op"; fLit="$lit"; var="CODEX_GATE_FAST";   ovr="1";             key="fastRaw" ;;
    esac
    retune_gate_dial_ops "$fxs" "$mOp" "$mLit" "$eOp" "$eLit" "$fOp" "$fLit"
    case "$state" in
      unset) ( hermetic CODEX_GATE_RUNTIME="$fxs" CODEX_GATE_SOURCE="$fxs" bash "$WRAPPER" config ) ;;
      empty) ( hermetic "$var=" CODEX_GATE_RUNTIME="$fxs" CODEX_GATE_SOURCE="$fxs" bash "$WRAPPER" config ) ;;
      set)   ( hermetic "$var=$ovr" CODEX_GATE_RUNTIME="$fxs" CODEX_GATE_SOURCE="$fxs" bash "$WRAPPER" config ) ;;
    esac > "$SANDBOX/op63xp.txt" 2>"$SANDBOX/op63xp.err"
    status="$(last_json_line "$SANDBOX/op63xp.txt")"
    if printf '%s' "$status" | jq -e --arg v "$expVal" ".effective.$key==\$v" >/dev/null 2>&1; then
      pass "config-operator [\${$var$op$lit} + $state]: effective.$key is '$expVal'"
    else
      fail "config-operator [\${$var$op$lit} + $state]: expected effective.$key '$expVal', got $(printf '%s' "$status" | jq -c ".effective.$key // \"<none>\"") :: $(cat "$SANDBOX/op63xp.err")"
    fi
    if printf '%s' "$status" | jq -e --arg o "$expOrigin" ".origin.$dial==\$o" >/dev/null 2>&1; then
      pass "config-operator [\${$var$op$lit} + $state]: origin.$dial is '$expOrigin'"
    else
      fail "config-operator [\${$var$op$lit} + $state]: expected origin.$dial '$expOrigin', got $(printf '%s' "$status" | jq -c ".origin.$dial // \"<none>\"")"
    fi
  done <<'DIALROWS'
model|:-|gpt-5.6-terra|unset|gpt-5.6-terra|default
model|:-|gpt-5.6-terra|empty|gpt-5.6-terra|default
model|:-|gpt-5.6-terra|set|gpt-5.6-ultra|CODEX_GATE_MODEL
model|-|gpt-5.6-terra|unset|gpt-5.6-terra|default
model|-|gpt-5.6-terra|empty||CODEX_GATE_MODEL
model|-|gpt-5.6-terra|set|gpt-5.6-ultra|CODEX_GATE_MODEL
effort|:-|ultra|unset|ultra|default
effort|:-|ultra|empty|ultra|default
effort|:-|ultra|set|low|CODEX_GATE_EFFORT
effort|-|ultra|unset|ultra|default
effort|-|ultra|empty||CODEX_GATE_EFFORT
effort|-|ultra|set|low|CODEX_GATE_EFFORT
fast|:-|0|unset|0|default
fast|:-|0|empty|0|default
fast|:-|0|set|1|CODEX_GATE_FAST
fast|-|0|unset|0|default
fast|-|0|empty||CODEX_GATE_FAST
fast|-|0|set|1|CODEX_GATE_FAST
DIALROWS

  # ---- (E) an UNPARSEABLE operator fails closed; it is never guessed ----------------
  # `${VAR:=lit}` is a legal expansion this parser does not model. Guessing an operator
  # is what produced the bug above, so the reporter refuses to report at all, and an
  # unreadable RUNTIME yields a null `effective` with a null `origin` beside it — there
  # is no operator to resolve under, so there is nothing origin could honestly say.
  copy_real_skill "$fx/noop"
  local nf="$fx/noop/codex-gate.sh" tmp="$fx/noop/codex-gate.sh.t"
  sed -e 's|^CODEX_GATE_MODEL=.*|CODEX_GATE_MODEL="${CODEX_GATE_MODEL:=gpt-5.6-sol}"|' "$nf" > "$tmp" && mv "$tmp" "$nf"
  chmod +x "$nf"
  ( hermetic CODEX_GATE_RUNTIME="$WRAPPER" CODEX_GATE_SOURCE="$WRAPPER" bash "$nf" config ) \
    > "$SANDBOX/op63f.txt" 2>"$SANDBOX/op63f.err"
  status="$(last_json_line "$SANDBOX/op63f.txt")"
  if printf '%s' "$status" | jq -e '.outcome=="INFRA_ERROR" and (.summary|test("CODEX_GATE_MODEL"))' >/dev/null 2>&1; then
    pass "config-operator: a reporter whose model dial uses an unmodelled operator REFUSES to report rather than guess one"
  else
    fail "config-operator: an unparseable dial did not fail closed :: $(printf '%s' "$status" | jq -c '{outcome,summary}') :: $(cat "$SANDBOX/op63f.err")"
  fi
  ( hermetic CODEX_GATE_RUNTIME="$nf" CODEX_GATE_SOURCE="$WRAPPER" bash "$WRAPPER" config ) \
    > "$SANDBOX/op63g.txt" 2>"$SANDBOX/op63g.err"
  status="$(last_json_line "$SANDBOX/op63g.txt")"
  if printf '%s' "$status" | jq -e '.effective==null and .origin==null and .effectiveParity=="UNAVAILABLE"' >/dev/null 2>&1; then
    pass "config-operator: an unparseable RUNTIME yields effective:null AND origin:null — no operator, nothing to attribute"
  else
    fail "config-operator: origin claimed an attribution for a runtime whose operator is unknown :: $(printf '%s' "$status" | jq -c '{effective,origin,effectiveParity}') :: $(cat "$SANDBOX/op63g.err")"
  fi
  if printf '%s' "$status" | jq -e '.reporter.origin=={model:"default",effort:"default",fast:"default"}' >/dev/null 2>&1; then
    pass "config-operator: the reporter still carries its OWN origin even when the runtime's cannot be known"
  else
    fail "config-operator: reporter.origin lost when the runtime is unparseable :: $(printf '%s' "$status" | jq -c '.reporter')"
  fi
}

#############################################################################
# TESTS 64-69 — resolve the Codex binary [P1: ADR-002 / ADR-003, PDR criteria 1-3 + 7]
#   The wrapper must find the Codex CLI at the CURRENT or the PREVIOUS ChatGPT.app layout:
#   an explicit non-empty CODEX_BIN (a path, or a command name on PATH) always wins; else the
#   first executable REGULAR file of CODEX_BIN_CANDIDATES (newest layout first); else an
#   INFRA_ERROR that names what was tried, raised BEFORE any Codex call.
#   The candidate list is a constant, not a knob, so every behavioral case runs a bin_fixture
#   copy whose `CODEX_BIN_CANDIDATES=` line is rewritten to temp paths under $SANDBOX (that
#   helper FAILS LOUDLY when the line does not exist). Marker stubs record WHICH candidate
#   ran in $PICK_LOG. Nothing here touches /Applications, ~/.claude or the repo.
#
#   Shared plumbing for 64-68:
#     bin_repo                          a repo with a seed commit + one untracked source file
#     bin_wrap <gate> <repo> <env-word>... -- <wrapper-arg>...
#                                       ONE wrapper run inside <repo>, then sets BIN_STATUS /
#                                       BIN_OUTCOME / BIN_SUMMARY / BIN_NCALLS / BIN_PICKS.
#                                       CODEX_BIN is UNSET unless a case sets it: a case passes
#                                       CODEX_BIN=value (or CODEX_BIN= for the empty string), and
#                                       env applies it after the built-in `-u CODEX_BIN`. Further
#                                       env words go to `env` as NAME=value. pick.log and the argv
#                                       log are truncated first. STUB_MODE=approve is always set.
#     bin_expect_pick / bin_expect_refused / bin_expect_none_found / bin_expect_base_shape
#                                       the shared assertions
#############################################################################
bin_repo() {
  local r
  r="$(make_repo)"
  printf 'seed\n' > "$r/seed.txt"
  git -C "$r" add seed.txt && git -C "$r" commit -qm init
  printf 'export const X=1;\n' > "$r/change.js"      # untracked, and a FE path (multi-lens applies)
  printf '%s' "$r"
}

bin_wrap() { # <gate-dir> <repo> <env-word>... -- <wrapper-arg>...
  local gate="$1" repo="$2"
  local -a ew aw
  shift 2
  ew=(-u CODEX_BIN)       # never empty under bash 3.2 `set -u`; CODEX_BIN unset unless a case sets it
  aw=()
  while [ $# -gt 0 ] && [ "$1" != "--" ]; do ew[${#ew[@]}]="$1"; shift; done
  [ $# -gt 0 ] && shift
  while [ $# -gt 0 ]; do aw[${#aw[@]}]="$1"; shift; done
  reset_pick_log
  reset_argv_log
  ( cd "$repo" && env "${ew[@]}" STUB_MODE=approve bash "$gate/codex-gate.sh" "${aw[@]}" ) \
    > "$SANDBOX/bin.out" 2> "$SANDBOX/bin.err"
  BIN_STATUS="$(last_json_line "$SANDBOX/bin.out")"
  BIN_OUTCOME="$(printf '%s' "$BIN_STATUS" | jq -r '.outcome // empty' 2>/dev/null)"
  BIN_SUMMARY="$(printf '%s' "$BIN_STATUS" | jq -r '.summary // empty' 2>/dev/null)"
  BIN_NCALLS="$(grep -c -- '---END-ARGV---' "$STUB_ARGV_LOG" 2>/dev/null)"; [ -n "$BIN_NCALLS" ] || BIN_NCALLS=0
  BIN_PICKS="$(tr '\n' ',' < "$PICK_LOG" 2>/dev/null | sed 's/,$//')"
}

bin_expect_pick() { # <label> <expected-tag> — APPROVE, and pick.log is EXACTLY that one tag
  if [ "$BIN_OUTCOME" = "APPROVE" ] && [ "$BIN_PICKS" = "$2" ]; then
    pass "bin-resolve: $1 -> APPROVE, only $2 ran"
  else
    fail "bin-resolve: $1: expected APPROVE with pick.log exactly '$2', got outcome='$BIN_OUTCOME' picks='$BIN_PICKS' calls=$BIN_NCALLS :: $BIN_SUMMARY :: $(head -c 300 "$SANDBOX/bin.err" 2>/dev/null)"
  fi
}

bin_expect_refused() { # <label> <value-the-summary-must-name> — an explicit CODEX_BIN that cannot run
  local ok=0
  [ "$BIN_OUTCOME" = "INFRA_ERROR" ] || ok=1
  printf '%s' "$BIN_SUMMARY" | grep -qF -- 'CODEX_BIN' || ok=1
  printf '%s' "$BIN_SUMMARY" | grep -qF -- "$2" || ok=1
  [ "$BIN_NCALLS" -eq 0 ] || ok=1
  [ -z "$BIN_PICKS" ] || ok=1      # no silent fall-back to a candidate that IS present
  if [ "$ok" -eq 0 ]; then
    pass "bin-refuse: $1 -> INFRA_ERROR naming CODEX_BIN and '$2', zero calls, no candidate used"
  else
    fail "bin-refuse: $1: expected INFRA_ERROR naming CODEX_BIN and '$2' with zero calls and an empty pick.log, got outcome='$BIN_OUTCOME' calls=$BIN_NCALLS picks='$BIN_PICKS' :: $BIN_SUMMARY :: $(head -c 300 "$SANDBOX/bin.err" 2>/dev/null)"
  fi
}

bin_expect_none_found() { # <label> <new-path> <old-path> — no explicit CODEX_BIN, no candidate present
  local ok=0
  [ "$BIN_OUTCOME" = "INFRA_ERROR" ] || ok=1
  printf '%s' "$BIN_SUMMARY" | grep -qF -- "$2" || ok=1
  printf '%s' "$BIN_SUMMARY" | grep -qF -- "$3" || ok=1
  [ "$BIN_NCALLS" -eq 0 ] || ok=1
  [ -z "$BIN_PICKS" ] || ok=1
  if [ "$ok" -eq 0 ]; then
    pass "bin-none: $1 -> INFRA_ERROR naming BOTH candidate paths, zero codex calls"
  else
    fail "bin-none: $1: expected INFRA_ERROR naming both candidates with zero calls, got outcome='$BIN_OUTCOME' calls=$BIN_NCALLS picks='$BIN_PICKS' :: $BIN_SUMMARY :: $(head -c 300 "$SANDBOX/bin.err" 2>/dev/null)"
  fi
}

bin_expect_base_shape() { # <label> — a fan-out run that failed at its first job carries the BASE status shape
  # ADR-002: no shards[] / lenses[] (the shape SKILL.md documents for an early fail-closed
  # INFRA_ERROR). An empty or non-JSON status makes jq -e fail, so that fails too.
  if printf '%s' "$BIN_STATUS" | jq -e '(has("shards")|not) and (has("lenses")|not)' >/dev/null 2>&1; then
    pass "bin-none: $1 -> the status is in the BASE shape (no shards[] and no lenses[])"
  else
    fail "bin-none: $1: expected the base status shape (neither shards[] nor lenses[]), got :: $BIN_STATUS"
  fi
}

#############################################################################
# TEST 64 — default resolution: CODEX_BIN unset or EMPTY -> the first executable regular
#   file of the candidate list; non-executable files and directories are skipped.
#   The directories are named AGAINST alphabetical order (z-new is listed first but sorts last,
#   like the shipped list: …/Resources/codex sorts BEFORE …/Resources/codex-cli/bin/codex), so a
#   resolver that sorted or de-duplicated the list (`sort -u`) would pick OLD and fail here.
#############################################################################
run_test_64() {
  local fx gate repo new old
  fx="$SANDBOX/bin64"
  new="$fx/z-new/codex"
  old="$fx/a-old/codex"
  bin_fixture "$fx/gate" "$new:$old" || return
  gate="$fx/gate"
  repo="$(bin_repo)"

  # new first: both present -> NEW, never OLD
  rm -rf "$fx/z-new" "$fx/a-old"
  mk_marker_stub "$new" NEW
  mk_marker_stub "$old" OLD
  bin_wrap "$gate" "$repo" -- prepr
  bin_expect_pick "default, both layouts present: the NEW layout is first" NEW

  # old fallback: NEW absent, OLD present
  rm -rf "$fx/z-new" "$fx/a-old"
  mk_marker_stub "$old" OLD
  bin_wrap "$gate" "$repo" -- prepr
  bin_expect_pick "default, NEW absent: falls back to the OLD layout" OLD

  # skip non-executable: NEW is a regular file without the executable bit
  rm -rf "$fx/z-new" "$fx/a-old"
  mkdir -p "$fx/z-new"
  printf '#!/bin/sh\nexit 0\n' > "$new"
  chmod 644 "$new"
  mk_marker_stub "$old" OLD
  bin_wrap "$gate" "$repo" -- prepr
  bin_expect_pick "default, NEW is a non-executable file: skipped for OLD" OLD

  # skip directory: NEW is a directory (executable bit set, but not a regular file)
  rm -rf "$fx/z-new" "$fx/a-old"
  mkdir -p "$new"
  mk_marker_stub "$old" OLD
  bin_wrap "$gate" "$repo" -- prepr
  bin_expect_pick "default, NEW is a directory: skipped for OLD" OLD

  # empty means unset: CODEX_BIN="" is not an explicit choice
  rm -rf "$fx/z-new" "$fx/a-old"
  mk_marker_stub "$new" NEW
  mk_marker_stub "$old" OLD
  bin_wrap "$gate" "$repo" CODEX_BIN= -- prepr
  bin_expect_pick "CODEX_BIN set to the EMPTY string behaves as unset (first candidate)" NEW
}

#############################################################################
# TEST 65 — an explicit CODEX_BIN wins over BOTH candidates, as a path and as a command name.
#############################################################################
run_test_65() {
  local fx gate repo new old expl
  fx="$SANDBOX/bin65"
  new="$fx/new/codex"
  old="$fx/old/codex"
  expl="$fx/expl/my-codex"
  bin_fixture "$fx/gate" "$new:$old" || return
  gate="$fx/gate"
  repo="$(bin_repo)"
  mk_marker_stub "$new" NEW
  mk_marker_stub "$old" OLD

  # explicit path: used even though both candidates are present; neither candidate ran
  mk_marker_stub "$expl" EXPL
  bin_wrap "$gate" "$repo" "CODEX_BIN=$expl" -- prepr
  bin_expect_pick "explicit CODEX_BIN path wins over both present candidates" EXPL

  # explicit command name: resolved on PATH (a marker stub named cg-marker, dir prepended)
  mk_marker_stub "$fx/pathbin/cg-marker" CMD
  bin_wrap "$gate" "$repo" "PATH=$fx/pathbin:$PATH" CODEX_BIN=cg-marker -- prepr
  bin_expect_pick "explicit CODEX_BIN command name is resolved on PATH and wins over the candidates" CMD
}

#############################################################################
# TEST 65b — a RELATIVE explicit CODEX_BIN means "relative to where the wrapper was INVOKED"
#   [ADR-003 relative-result bullet, PDR criterion 3]. bash 3.2 `command -v` returns a
#   RELATIVE result for `./x`, for `tools/x`, and for a bare name found through a relative PATH
#   entry (`PATH=rel:$PATH`). run_codex then `cd`s to the repo root (code tier) or to the run dir
#   (doc tier) and runs that same relative path THERE: a binary that passed the check in the
#   invoking directory ends in the generic `codex exited nonzero (127)`, or worse, runs a
#   DIFFERENT file than the one checked. The decoys below make the second shape visible: each
#   code-tier case plants a WRONG* marker stub at the same relative spot under the repo root
#   (where the code tier `cd`s), so a resolver that hands over the unanchored path picks WRONG*.
#   Each case also asserts its PREMISE (bin_expect_ran_elsewhere): the stub really ran in a
#   directory other than the invoking one, in the intended tier — otherwise the case could pass
#   for the wrong reason (a relative path only works when cwd never changes).
#   Reuses bin_wrap with the invocation directory in the <repo> slot (it is just `cd "$repo"`).
#############################################################################
bin_expect_ran_elsewhere() { # <label> <invoked-from> <doc|code> — the stub's cwd != the invoking dir, in this tier
  local ran ok=0 skipflag=1
  ran="$(tail -n 1 "$STUB_CWD_LOG" 2>/dev/null)"
  [ -n "$ran" ] && [ "$ran" != "$2" ] || ok=1
  grep -qFx -- '--skip-git-repo-check' "$STUB_ARGV_LOG" 2>/dev/null && skipflag=0     # only the DOC tier passes it
  if [ "$3" = "doc" ]; then [ "$skipflag" -eq 0 ] || ok=1; else [ "$skipflag" -ne 0 ] || ok=1; fi
  if [ "$ok" -eq 0 ]; then
    pass "bin-relative: $1 -> the stub ran in '$ran', not in the invoking dir '$2', at the $3 tier"
  else
    fail "bin-relative: $1: expected the stub to run at the $3 tier in a directory other than '$2', got cwd='$ran' skip-git-repo-check-present=$([ "$skipflag" -eq 0 ] && echo yes || echo no) outcome='$BIN_OUTCOME' picks='$BIN_PICKS' :: $BIN_SUMMARY"
  fi
}

run_test_65b() {
  local fx gate repo
  fx="$SANDBOX/bin65b"
  bin_fixture "$fx/gate" "$fx/z-new/codex:$fx/a-old/codex" || return
  gate="$fx/gate"
  mk_marker_stub "$fx/z-new/codex" NEW         # both candidates present: a resolver that fell back
  mk_marker_stub "$fx/a-old/codex" OLD         # to either would pick NEW/OLD, never the tag below

  # (a) explicit RELATIVE path, DOC tier: `plan` outside any git repo. The invoking dir holds
  #     tools/cg-rel; the run dir the doc tier cd's to does not. GIT_CEILING_DIRECTORIES stops git
  #     from finding a repo above the sandbox, so this is a doc-tier run wherever TMPDIR lives.
  mkdir -p "$fx/a-doc"
  mk_marker_stub "$fx/a-doc/tools/cg-rel" REL
  printf '# A plan\n\nDo the thing.\n' > "$fx/plan.md"
  reset_cwd_log
  bin_wrap "$gate" "$fx/a-doc" "GIT_CEILING_DIRECTORIES=$SANDBOX" CODEX_BIN=tools/cg-rel -- plan "$fx/plan.md"
  bin_expect_pick "explicit relative CODEX_BIN 'tools/cg-rel', DOC tier" REL
  bin_expect_ran_elsewhere "explicit relative CODEX_BIN 'tools/cg-rel', DOC tier" "$fx/a-doc" doc

  # (b) explicit './'-relative path, CODE tier, invoked from a SUBDIRECTORY of the repo: the code
  #     tier cd's to the repo root, where ./cg-rel2 is the WRONG2 decoy.
  repo="$(bin_repo)"
  mkdir -p "$repo/sub"
  mk_marker_stub "$repo/sub/cg-rel2" REL2
  mk_marker_stub "$repo/cg-rel2" WRONG2
  reset_cwd_log
  bin_wrap "$gate" "$repo/sub" CODEX_BIN=./cg-rel2 -- prepr
  bin_expect_pick "explicit './cg-rel2' invoked from a repo subdirectory, CODE tier" REL2
  bin_expect_ran_elsewhere "explicit './cg-rel2' invoked from a repo subdirectory, CODE tier" "$repo/sub" code

  # (c) a bare command name found through a RELATIVE PATH entry (`PATH=relbin:$PATH`), CODE tier,
  #     invoked from a repo subdirectory: `command -v cg-rel3` answers `relbin/cg-rel3`, and the
  #     WRONG3 decoy sits at relbin/cg-rel3 under the repo root.
  mkdir -p "$repo/sub2"
  mk_marker_stub "$repo/sub2/relbin/cg-rel3" REL3
  mk_marker_stub "$repo/relbin/cg-rel3" WRONG3
  reset_cwd_log
  bin_wrap "$gate" "$repo/sub2" "PATH=relbin:$PATH" CODEX_BIN=cg-rel3 -- prepr
  bin_expect_pick "explicit bare command name found through the relative PATH entry 'relbin', CODE tier" REL3
  bin_expect_ran_elsewhere "explicit bare command name found through the relative PATH entry 'relbin', CODE tier" "$repo/sub2" code
}

#############################################################################
# TEST 66 — an explicit CODEX_BIN that cannot run is an INFRA_ERROR naming it: zero calls and
#   NO silent fall-back, even though both candidates are present and runnable.
#############################################################################
run_test_66() {
  local fx gate repo new old
  fx="$SANDBOX/bin66"
  new="$fx/new/codex"
  old="$fx/old/codex"
  bin_fixture "$fx/gate" "$new:$old" || return
  gate="$fx/gate"
  repo="$(bin_repo)"
  mk_marker_stub "$new" NEW
  mk_marker_stub "$old" OLD

  # missing path
  bin_wrap "$gate" "$repo" "CODEX_BIN=$fx/nope" -- prepr
  bin_expect_refused "explicit path that does not exist" "$fx/nope"

  # a file without the executable bit
  mkdir -p "$fx/files"
  printf '#!/bin/sh\nexit 0\n' > "$fx/files/plain-file"
  chmod 644 "$fx/files/plain-file"
  bin_wrap "$gate" "$repo" "CODEX_BIN=$fx/files/plain-file" -- prepr
  bin_expect_refused "explicit path that is not executable" "$fx/files/plain-file"

  # a directory
  mkdir -p "$fx/files/a-dir"
  bin_wrap "$gate" "$repo" "CODEX_BIN=$fx/files/a-dir" -- prepr
  bin_expect_refused "explicit path that is a directory" "$fx/files/a-dir"

  # a command name that resolves to nothing
  bin_wrap "$gate" "$repo" CODEX_BIN=no-such-cmd-cg -- prepr
  bin_expect_refused "explicit command name that is unknown" "no-such-cmd-cg"

  # a command name that bash 3.2 `command -v` resolves to a NON-EXECUTABLE file on PATH:
  # the resolver must still refuse it
  mkdir -p "$fx/pathnx"
  printf '#!/bin/sh\nexit 0\n' > "$fx/pathnx/cg-noexec"
  chmod 644 "$fx/pathnx/cg-noexec"
  bin_wrap "$gate" "$repo" "PATH=$fx/pathnx:$PATH" CODEX_BIN=cg-noexec -- prepr
  bin_expect_refused "explicit command name that is a non-executable file on PATH" "cg-noexec"

  # a shell builtin: `command -v echo` prints the bare word, which is not a file
  bin_wrap "$gate" "$repo" CODEX_BIN=echo -- prepr
  bin_expect_refused "explicit command name that is a shell builtin" "echo"
}

#############################################################################
# TEST 67 — no explicit CODEX_BIN and neither candidate present: EVERY mode that would call
#   Codex ends in an INFRA_ERROR naming BOTH paths, with ZERO Codex calls (mirrors TEST 42).
#   Resolution happens inside run_codex, in the main shell, so even the fan-out paths stop at
#   the first job.
#############################################################################
run_test_67() {
  local fx gate repo new old prepo srepo i
  fx="$SANDBOX/bin67"
  new="$fx/new/codex"
  old="$fx/old/codex"
  bin_fixture "$fx/gate" "$new:$old" || return
  gate="$fx/gate"
  mkdir -p "$fx/new" "$fx/old"         # the parent dirs exist; the two binaries do not

  repo="$(bin_repo)"
  mkdir -p "$repo/docs/pdr"
  printf '# plan\n' > "$repo/docs/pdr/plan.md"
  git -C "$repo" add docs && git -C "$repo" commit -qm docs

  # plan
  printf '# A plan\n\nDo the thing.\n' > "$fx/plan.md"
  bin_wrap "$gate" "$repo" -- plan "$fx/plan.md"
  bin_expect_none_found "plan" "$new" "$old"

  # bundle
  bin_wrap "$gate" "$repo" -- bundle docs/pdr
  bin_expect_none_found "bundle" "$new" "$old"

  # question
  printf 'DECISION: how do we persist run events?\n\nCONTEXT: high write volume.\n\nOPTIONS:\n- Option A: a dedicated append-only table\n- Option B: reuse the existing jobs table\n' > "$fx/decision.md"
  bin_wrap "$gate" "$repo" -- question "$fx/decision.md"
  bin_expect_none_found "question" "$new" "$old"

  # investigate
  printf 'TASK: why do eval runs get orphaned ~8-19s after start?\n\nSAFETY:\nALLOWED PROBES: read-only file inspection.\nFORBIDDEN PROBES: never trigger a Layer B (live AI) run.\n' > "$fx/brief.md"
  bin_wrap "$gate" "$repo" -- investigate "$fx/brief.md"
  bin_expect_none_found "investigate" "$new" "$old"

  # phase-review: phase-start needs no Codex, so it must itself succeed first
  prepo="$(bin_repo)"
  bin_wrap "$gate" "$prepo" -- phase-start P1
  if grep -q '^RUNDIR=' "$SANDBOX/bin.out" && [ "$BIN_NCALLS" -eq 0 ]; then
    pass "bin-none: phase-start (the prelude of phase-review) succeeds without any Codex binary"
    printf 'phase-change\n' > "$prepo/phase_new.js"
    bin_wrap "$gate" "$prepo" -- phase-review P1
    bin_expect_none_found "phase-review" "$new" "$old"
  else
    fail "bin-none: phase-start must succeed with no Codex binary so phase-review can be tested :: $(cat "$SANDBOX/bin.out") :: $(head -c 300 "$SANDBOX/bin.err")"
  fi

  # unsharded prepr, then the same run with a `codex` ON PATH: the PATH is never a fall-back
  bin_wrap "$gate" "$repo" -- prepr
  bin_expect_none_found "prepr (unsharded)" "$new" "$old"
  mk_marker_stub "$fx/pathbin/codex" PATHDECOY
  bin_wrap "$gate" "$repo" "PATH=$fx/pathbin:$PATH" -- prepr
  bin_expect_none_found "prepr (unsharded) with a 'codex' on PATH: PATH is not a fall-back" "$new" "$old"
  rm -rf "$fx/pathbin"

  # sharded prepr: TEST 31's three-file repo, over the budget so SHARD=auto shards it
  srepo="$(make_repo)"
  printf 'seed\n' > "$srepo/seed.txt"
  git -C "$srepo" add seed.txt && git -C "$srepo" commit -qm init
  mkdir -p "$srepo/docs"
  { for i in $(seq 1 60); do printf 'docs-line-%s SHARD-DOCS-MARK\n' "$i"; done; } > "$srepo/docs/guide.md"
  { for i in $(seq 1 60); do printf 'test-line-%s SHARD-TESTS-MARK\n' "$i"; done; } > "$srepo/thing.test.js"
  { for i in $(seq 1 60); do printf 'src-line-%s SHARD-OTHER-MARK\n' "$i"; done; } > "$srepo/app.js"
  bin_wrap "$gate" "$srepo" CODEX_GATE_PACKET_BUDGET=9000 CODEX_GATE_SHARD=auto -- prepr
  bin_expect_none_found "prepr (sharded)" "$new" "$old"
  bin_expect_base_shape "prepr (sharded)"
  # positive control: with a binary present the SAME setup really shards (several calls), so
  # the INFRA_ERROR above came from the fan-out path and not from an unsharded fall-through
  mk_marker_stub "$new" NEW
  bin_wrap "$gate" "$srepo" CODEX_GATE_PACKET_BUDGET=9000 CODEX_GATE_SHARD=auto -- prepr
  if [ "$BIN_OUTCOME" = "APPROVE" ] && [ "$BIN_NCALLS" -ge 2 ]; then
    pass "bin-none: control — the same sharded setup with a binary present fans out ($BIN_NCALLS calls, APPROVE)"
  else
    fail "bin-none: control — sharded setup with a binary present did not fan out: outcome='$BIN_OUTCOME' calls=$BIN_NCALLS picks='$BIN_PICKS' :: $BIN_SUMMARY :: $(head -c 300 "$SANDBOX/bin.err" 2>/dev/null)"
  fi
  rm -rf "$fx/new"
  mkdir -p "$fx/new"

  # prepr --multi
  bin_wrap "$gate" "$repo" -- prepr --multi
  bin_expect_none_found "prepr --multi" "$new" "$old"
  bin_expect_base_shape "prepr --multi"
  mk_marker_stub "$new" NEW
  bin_wrap "$gate" "$repo" -- prepr --multi
  if [ "$BIN_OUTCOME" = "APPROVE" ] && [ "$BIN_NCALLS" -ge 2 ]; then
    pass "bin-none: control — prepr --multi with a binary present fans out ($BIN_NCALLS calls, APPROVE)"
  else
    fail "bin-none: control — prepr --multi with a binary present did not fan out: outcome='$BIN_OUTCOME' calls=$BIN_NCALLS picks='$BIN_PICKS' :: $BIN_SUMMARY :: $(head -c 300 "$SANDBOX/bin.err" 2>/dev/null)"
  fi
}

#############################################################################
# TEST 68 — the modes that never call Codex keep working with NO Codex binary: resolution must
#   not run at load time or in main. `config`, `phase-start`, a budget-OVERFLOW `prepr` (the
#   budget guard stops the run before run_codex, so the resolver never sees it), and an EMPTY
#   `prepr-delta`.
#############################################################################
run_test_68() {
  local fx gate repo new old rc status root
  fx="$SANDBOX/bin68"
  new="$fx/new/codex"
  old="$fx/old/codex"
  bin_fixture "$fx/gate" "$new:$old" || return
  gate="$fx/gate"
  mkdir -p "$fx/new" "$fx/old"         # neither binary exists

  # config, with runtime and source pinned at the fixture so the check never reads the real install
  ( hermetic -u CODEX_BIN CODEX_GATE_RUNTIME="$gate/codex-gate.sh" CODEX_GATE_SOURCE="$gate/codex-gate.sh" \
      bash "$gate/codex-gate.sh" config ) > "$SANDBOX/cfg68.txt" 2>"$SANDBOX/cfg68.err"
  rc=$?
  status="$(last_json_line "$SANDBOX/cfg68.txt")"
  if [ "$rc" -eq 0 ] && printf '%s' "$status" | jq -e '.outcome=="CONFIG" and has("parity")' >/dev/null 2>&1; then
    pass "bin-nocodex: config exits 0 with a parity field when no Codex binary exists"
  else
    fail "bin-nocodex: config must work without a Codex binary: rc=$rc :: $status :: $(head -c 300 "$SANDBOX/cfg68.err")"
  fi

  # phase-start
  repo="$(bin_repo)"
  bin_wrap "$gate" "$repo" -- phase-start P1
  if grep -q '^RUNDIR=' "$SANDBOX/bin.out" && [ "$BIN_NCALLS" -eq 0 ]; then
    pass "bin-nocodex: phase-start prints RUNDIR= when no Codex binary exists"
  else
    fail "bin-nocodex: phase-start must work without a Codex binary :: $(cat "$SANDBOX/bin.out") :: $(head -c 300 "$SANDBOX/bin.err")"
  fi

  # a budget OVERFLOW never reaches the resolver (ADR-002): SHARD=off over a 10-char budget stops at
  # the packet-budget guard, so with no binary anywhere the outcome is OVERFLOW, not INFRA_ERROR
  bin_wrap "$gate" "$repo" CODEX_GATE_SHARD=off CODEX_GATE_PACKET_BUDGET=10 -- prepr
  if [ "$BIN_OUTCOME" = "OVERFLOW" ] && [ "$BIN_NCALLS" -eq 0 ] && [ -z "$BIN_PICKS" ]; then
    pass "bin-nocodex: a budget-OVERFLOW prepr stays OVERFLOW (zero calls) when no Codex binary exists — the guard runs before the resolver"
  else
    fail "bin-nocodex: budget OVERFLOW must not reach the resolver: expected OVERFLOW with zero calls and an empty pick.log, got outcome='$BIN_OUTCOME' calls=$BIN_NCALLS picks='$BIN_PICKS' :: $BIN_SUMMARY :: $(head -c 300 "$SANDBOX/bin.err")"
  fi

  # an empty prepr-delta (TEST 27's shape): seed the ledger with a stub-backed prepr, THEN remove
  # the binary; the delta has nothing to review, so it APPROVEs with no new call
  repo="$(make_repo)"
  printf 'one\n' > "$repo/one.js"
  printf 'two\n' > "$repo/two.js"
  git -C "$repo" add one.js two.js && git -C "$repo" commit -qm init
  printf 'one\n// branch\n' > "$repo/one.js"
  git -C "$repo" add one.js && git -C "$repo" commit -qm branch
  root="$(git -C "$repo" rev-list --max-parents=0 HEAD | head -1)"
  mk_marker_stub "$new" NEW
  bin_wrap "$gate" "$repo" -- prepr "$root"
  if [ "$BIN_OUTCOME" != "APPROVE" ]; then
    fail "bin-nocodex: seed prepr (binary present) did not APPROVE, so the empty-delta case cannot run :: outcome='$BIN_OUTCOME' :: $BIN_SUMMARY :: $(head -c 300 "$SANDBOX/bin.err")"
    return
  fi
  rm -f "$new"
  bin_wrap "$gate" "$repo" -- prepr-delta "$root"
  if [ "$BIN_OUTCOME" = "APPROVE" ] && [ "$BIN_NCALLS" -eq 0 ] && [ -z "$BIN_PICKS" ] \
     && printf '%s' "$BIN_SUMMARY" | grep -qi 'already reviewed'; then
    pass "bin-nocodex: an empty prepr-delta APPROVEs with ZERO calls after the binary is gone"
  else
    fail "bin-nocodex: empty prepr-delta must APPROVE without a binary: outcome='$BIN_OUTCOME' calls=$BIN_NCALLS picks='$BIN_PICKS' :: $BIN_SUMMARY :: $(head -c 300 "$SANDBOX/bin.err")"
  fi
}

#############################################################################
# TEST 69 — the SHIPPED constants, read from the real wrapper: no path default inside the
#   CODEX_BIN expansion, and the one candidate list the ADR pins (newest layout first).
#############################################################################
run_test_69() {
  local binline candline n
  binline='CODEX_BIN="${CODEX_BIN:-}"'
  candline='CODEX_BIN_CANDIDATES="/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex:/Applications/ChatGPT.app/Contents/Resources/codex"'

  n="$(grep -cFx -- "$binline" "$WRAPPER" 2>/dev/null)"; [ -n "$n" ] || n=0
  if [ "$n" -eq 1 ] && [ "$(grep -c '^CODEX_BIN=' "$WRAPPER" 2>/dev/null)" = "1" ]; then
    pass "shipped constants: exactly one CODEX_BIN assignment, and it is $binline"
  else
    fail "shipped constants: expected exactly one '^CODEX_BIN=' line and it equal to $binline, found $n exact match(es); lines: $(grep -n '^CODEX_BIN=' "$WRAPPER" 2>/dev/null | head -3)"
  fi

  n="$(grep -cFx -- "$candline" "$WRAPPER" 2>/dev/null)"; [ -n "$n" ] || n=0
  if [ "$n" -eq 1 ]; then
    pass "shipped constants: exactly one CODEX_BIN_CANDIDATES line, new layout first then the old one"
  else
    fail "shipped constants: expected exactly one line equal to $candline, found $n exact match(es); lines: $(grep -n '^CODEX_BIN_CANDIDATES=' "$WRAPPER" 2>/dev/null | head -3)"
  fi

  # No OTHER line may end a quoted or braced word in Resources/codex: that is the shape of the
  # old default `${CODEX_BIN:-/Applications/…/Resources/codex}` (or a second hard-coded path).
  n="$(grep -E 'Resources/codex["}]' "$WRAPPER" 2>/dev/null | grep -vFx -- "$candline" | wc -l | tr -d ' ')"
  if [ "$n" = "0" ]; then
    pass "shipped constants: no other line defaults to the Resources/codex path"
  else
    fail "shipped constants: $n other line(s) default to Resources/codex :: $(grep -E 'Resources/codex["}]' "$WRAPPER" 2>/dev/null | grep -vFx -- "$candline" | head -3)"
  fi
}

#############################################################################
# TESTS 70-83 — classify a FAILED Codex turn by its cause [P2: ADR-004 / ADR-005 / ADR-006,
#   PDR criteria 4-7]
#   The wrapper used to call every failed turn OVERFLOW ("diff too large"). The rule now:
#     - a nonzero exit whose STRUCTURED failure events (the .error.message of a turn.failed and
#       the .message of a top-level error event) carry `ran out of room`, `context window` or
#       `context_length_exceeded` -> OVERFLOW, summary unchanged;
#     - any other failure event -> INFRA_ERROR, whose summary carries the API's own message
#       (a JSON API error unwrapped to `HTTP <status> <type> <code>: <message>`), on ONE line,
#       capped at 300 characters + `…`;
#     - a nonzero exit with no failure event -> the generic `codex exited nonzero (N)`;
#     - the item.completed warning (item.type "error") and agent / command text never count;
#     - a ZERO exit never reads failure events: the top-level "Reconnecting... N/5" errors Codex
#       logs inside turns that then complete normally are noise, so an exit-0 job with an
#       unusable verdict reads `no usable verdict (<path>)`, never `codex turn failed`.
#   In the fan-out paths (sharded prepr, prepr --multi) the aggregate is
#   BLOCK > INFRA_ERROR > OVERFLOW > APPROVE, and an aggregate INFRA_ERROR names the failing
#   shard or lens and its reason.
#   Fixtures: write_failure_fixtures (under $SANDBOX/fixtures/, written before the stub's first
#   run). Stub modes: api_400 context_length usage_limit chatter long_message long_context
#   approve_with_warning warning_nonzero reconnect_degenerate, plus the per-call seam
#   STUB_API400_IF_STDIN.
#
#   Shared plumbing for 70-83:
#     cls_run <repo> <stub-mode> [NAME=value ...] -- <wrapper-arg>...
#                                       ONE wrapper run inside <repo> (CODEX_BIN is the suite's
#                                       stub); sets CLS_STATUS / CLS_OUTCOME / CLS_SUMMARY /
#                                       CLS_NCALLS / CLS_ERR. The argv log is truncated first.
#     cls_collect                       the five-variable result collection cls_run ends with, reading
#                                       $SANDBOX/cls.out / cls.err and the argv log (also called by
#                                       bad_run_shadow in 84-90)
#     cls_run_mode <mode> <stub-mode> [NAME=value ...]
#                                       one of plan bundle phase-review question investigate
#                                       prepr, against a fresh fixture
#     cls_diag                          the one-line diagnostic every FAIL line carries: outcome,
#                                       call count, summary, and the head of stderr
#     cls_call <fn> [args...]           source the wrapper in a subshell and run <fn> there
#                                       (stdout only; exit 97 when the wrapper does not source or
#                                       <fn> is undefined, so RED reports a FAIL, never aborts)
#############################################################################
CLS_FX="$FIXTURE_DIR"
CLS_LINE_400="HTTP 400 invalid_request_error: The 'gpt-6-astra' model is not supported when using Codex with a ChatGPT account."
# The five result variables cls_run / cls_run_mode set, given safe defaults so a caller that
# reads one before any run (or after an arm that sets only some) never hits an unbound variable.
CLS_STATUS=""; CLS_OUTCOME=""; CLS_SUMMARY=""; CLS_NCALLS=0; CLS_ERR=""

cls_collect() { # read the last run's $SANDBOX/cls.out / cls.err into CLS_STATUS / OUTCOME / SUMMARY / NCALLS / ERR
  CLS_STATUS="$(last_json_line "$SANDBOX/cls.out")"
  CLS_OUTCOME="$(printf '%s' "$CLS_STATUS" | jq -r '.outcome // empty' 2>/dev/null)"
  CLS_SUMMARY="$(printf '%s' "$CLS_STATUS" | jq -r '.summary // empty' 2>/dev/null)"
  CLS_NCALLS="$(grep -c -- '---END-ARGV---' "$STUB_ARGV_LOG" 2>/dev/null)"; [ -n "$CLS_NCALLS" ] || CLS_NCALLS=0
  CLS_ERR="$(head -c 300 "$SANDBOX/cls.err" 2>/dev/null)"
}

cls_run() { # <repo> <stub-mode> [NAME=value ...] -- <wrapper-arg>...
  local repo="$1" mode="$2"
  local -a ew aw
  shift 2
  ew=(STUB_MODE="$mode")           # never empty under bash 3.2 `set -u`
  aw=()
  while [ $# -gt 0 ] && [ "$1" != "--" ]; do ew[${#ew[@]}]="$1"; shift; done
  [ $# -gt 0 ] && shift
  while [ $# -gt 0 ]; do aw[${#aw[@]}]="$1"; shift; done
  reset_argv_log
  ( cd "$repo" && env "${ew[@]}" bash "$WRAPPER" "${aw[@]}" ) > "$SANDBOX/cls.out" 2> "$SANDBOX/cls.err"
  cls_collect
}

cls_run_mode() { # <mode> <stub-mode> [NAME=value ...]
  local m="$1" sm="$2" repo
  shift 2
  repo="$(bin_repo)"
  case "$m" in
    plan)
      printf '# A plan\n\nDo the thing.\n' > "$SANDBOX/cls-plan.md"
      cls_run "$repo" "$sm" "$@" -- plan "$SANDBOX/cls-plan.md" ;;
    bundle)
      mkdir -p "$repo/docs/pdr"
      printf '# plan\n' > "$repo/docs/pdr/plan.md"
      git -C "$repo" add docs && git -C "$repo" commit -qm docs
      cls_run "$repo" "$sm" "$@" -- bundle docs/pdr ;;
    question)
      printf 'DECISION: how do we persist run events?\n\nCONTEXT: high write volume.\n\nOPTIONS:\n- Option A: a dedicated append-only table\n- Option B: reuse the existing jobs table\n' > "$SANDBOX/cls-decision.md"
      cls_run "$repo" "$sm" "$@" -- question "$SANDBOX/cls-decision.md" ;;
    investigate)
      printf 'TASK: why do eval runs get orphaned ~8-19s after start?\n\nSAFETY:\nALLOWED PROBES: read-only file inspection.\nFORBIDDEN PROBES: never trigger a Layer B (live AI) run.\n' > "$SANDBOX/cls-brief.md"
      cls_run "$repo" "$sm" "$@" -- investigate "$SANDBOX/cls-brief.md" ;;
    phase-review)
      # phase-start needs no Codex; it must succeed first, then a change makes the phase non-empty
      cls_run "$repo" approve -- phase-start P1
      if ! grep -q '^RUNDIR=' "$SANDBOX/cls.out"; then
        CLS_STATUS=""; CLS_OUTCOME="(phase-start failed)"; CLS_SUMMARY="$(tr '\n' ' ' < "$SANDBOX/cls.out" | head -c 300)"
        return 0
      fi
      printf 'phase-change\n' > "$repo/phase_new.js"
      cls_run "$repo" "$sm" "$@" -- phase-review P1 ;;
    prepr)
      cls_run "$repo" "$sm" "$@" -- prepr ;;
    *)
      fail "cls_run_mode: unknown mode '$m'"
      CLS_STATUS=""; CLS_OUTCOME="(unknown mode)"; CLS_SUMMARY=""; CLS_NCALLS=0; CLS_ERR="" ;;
  esac
}

cls_diag() { # one line, whatever the summary / stderr carry
  printf "outcome='%s' calls=%s :: summary: %s :: stderr: %s" "$CLS_OUTCOME" "$CLS_NCALLS" \
    "$(printf '%s' "$CLS_SUMMARY" | tr '\n\t\r' '   ' | head -c 600)" "$(printf '%s' "$CLS_ERR" | tr '\n\t\r' '   ')"
}

cls_summary_has() { printf '%s' "$CLS_SUMMARY" | grep -qF -- "$1"; }

cls_summary_one_line() { # the status JSON's .summary is a string with no control character in it
  printf '%s' "$CLS_STATUS" | jq -e '(.summary | type == "string") and ((.summary | test("[[:cntrl:]]")) | not)' >/dev/null 2>&1
}

cls_call() { # <fn> [args...]
  (
    set +u
    # shellcheck disable=SC1090
    . "$WRAPPER" >/dev/null 2>&1 || { printf '__SOURCEFAIL__'; exit 97; }
    [ "$(type -t "$1" 2>/dev/null)" = function ] || { printf '__NOFUNC__:%s' "$1"; exit 97; }
    "$@"
  ) 2>/dev/null
}

cls_expect_api400() { # <label> — the incident's API error, as an INFRA_ERROR, on one line
  local ok=0
  [ "$CLS_OUTCOME" = "INFRA_ERROR" ] || ok=1
  cls_summary_has 'HTTP 400' || ok=1
  cls_summary_has 'invalid_request_error' || ok=1
  cls_summary_has 'not supported when using Codex with a ChatGPT account' || ok=1
  cls_summary_has "$CLS_LINE_400" || ok=1                 # the unwrapped `HTTP <status> <type>: <message>` line
  cls_summary_has 'codex turn failed (exit 1): ' || ok=1  # ADR-005's summary shape
  cls_summary_one_line || ok=1
  [ "$CLS_NCALLS" -ge 1 ] || ok=1                         # the failure came from a real (stub) call
  if [ "$ok" -eq 0 ]; then
    pass "classify-400: $1 -> INFRA_ERROR with HTTP 400 / invalid_request_error / the model message, one line"
  else
    fail "classify-400: $1: expected INFRA_ERROR whose one-line summary unwraps the API error ('$CLS_LINE_400'), got $(cls_diag)"
  fi
}

cls_expect_context_overflow() { # <label> — a RUNTIME context-window OVERFLOW (the stub really ran), summary unchanged
  local ok=0
  [ "$CLS_OUTCOME" = "OVERFLOW" ] || ok=1
  cls_summary_has 'codex hit the context window' || ok=1  # emit_overflow's runtime wording, not a budget guard's
  [ "$CLS_NCALLS" -ge 1 ] || ok=1                         # a budget OVERFLOW makes zero calls
  if [ "$ok" -eq 0 ]; then
    pass "classify-context: $1 -> runtime OVERFLOW ('codex hit the context window ...', the stub was called)"
  else
    fail "classify-context: $1: expected a RUNTIME OVERFLOW (summary 'codex hit the context window ...', at least one call), got $(cls_diag)"
  fi
}

#############################################################################
# TEST 70 — the fixtures and the stub's new arms are what the other tests say they are.
#   A broken fixture or stub arm would let the classification tests below fail (or pass) for a
#   reason that has nothing to do with the wrapper: pin the premises here, wrapper-free.
#############################################################################
run_test_70() {
  local f ok rc rc2 pair
  f="$CLS_FX/api_400.jsonl"
  # --- api_400.jsonl: the incident's four lines, in order ---
  if [ "$(jq -c '.type' "$f" 2>/dev/null | tr '\n' ' ')" = '"item.completed" "turn.started" "error" "turn.failed" ' ] \
     && jq -es '.[0].item.type == "error" and (.[2].message | fromjson | .status == 400 and .error.type == "invalid_request_error")
                and (.[2].message == .[3].error.message)' "$f" >/dev/null 2>&1; then
    pass "fixtures: api_400.jsonl is the incident's four lines (warning, turn.started, error, turn.failed; one shared JSON-string message with status 400)"
  else
    fail "fixtures: api_400.jsonl is not the incident's shape :: $(head -c 400 "$f" 2>&1)"
  fi
  # --- context_length.jsonl: the CODE is the only signature ---
  if jq -es 'length == 2 and all(.[]; ((.message // .error.message) | fromjson | .error.code == "context_length_exceeded")
                       and (((.message // .error.message) | test("context window|ran out of room"; "i")) | not))' "$CLS_FX/context_length.jsonl" >/dev/null 2>&1; then
    pass "fixtures: context_length.jsonl carries context_length_exceeded and NO 'context window' / 'ran out of room' text"
  else
    fail "fixtures: context_length.jsonl must carry the code and no signature text :: $(head -c 400 "$CLS_FX/context_length.jsonl" 2>&1)"
  fi
  # --- usage_limit.jsonl: plain text on both events ---
  if jq -es 'length == 2 and all(.[]; ((.message // .error.message) == "You'"'"'ve hit your usage limit. Upgrade to Pro or try again later.")
                                   and (((.message // .error.message) | try fromjson catch "NOT-JSON") == "NOT-JSON"))' "$CLS_FX/usage_limit.jsonl" >/dev/null 2>&1; then
    pass "fixtures: usage_limit.jsonl is two events with the same plain (non-JSON) message"
  else
    fail "fixtures: usage_limit.jsonl is not two plain-text failure events :: $(head -c 400 "$CLS_FX/usage_limit.jsonl" 2>&1)"
  fi
  # --- chatter.jsonl / warning_context.jsonl: signature text, but NO failure event ---
  if jq -es 'length == 2 and all(.[]; .type == "item.completed")
             and .[0].item.type == "agent_message"
             and (.[0].item.text | test("context window")) and (.[0].item.text | test("ran out of room"))
             and .[1].item.type == "command_execution" and .[1].item.exit_code == 0 and .[1].item.status == "completed"
             and (.[1].item.command | type == "string")
             and (.[1].item.aggregated_output | test("ran out of room in the model'"'"'s context window"))' "$CLS_FX/chatter.jsonl" >/dev/null 2>&1 \
     && jq -es 'length == 1 and .[0].type == "item.completed" and .[0].item.type == "error"
                and (.[0].item.message | test("context window"; "i"))' "$CLS_FX/warning_context.jsonl" >/dev/null 2>&1; then
    pass "fixtures: chatter.jsonl (agent_message + command_execution output) and warning_context.jsonl (item error) say 'context window' but carry no failure event"
  else
    fail "fixtures: chatter / warning_context shape wrong :: $(head -c 400 "$CLS_FX/chatter.jsonl" 2>&1 | tr '\n' '|') :: $(head -c 300 "$CLS_FX/warning_context.jsonl" 2>&1)"
  fi
  # --- two_messages.jsonl: an error and a turn.failed with DIFFERENT plain messages, no signature ---
  if jq -es 'length == 2 and .[0].type == "error" and .[1].type == "turn.failed"
             and .[0].message == "FIRST-MSG upstream hiccup" and .[1].error.message == "LAST-MSG model not supported"
             and (all(.[]; (.message // .error.message) | test("context window|ran out of room|context_length_exceeded"; "i") | not))' "$CLS_FX/two_messages.jsonl" >/dev/null 2>&1; then
    pass "fixtures: two_messages.jsonl is a top-level error (FIRST-MSG) then a turn.failed (LAST-MSG), plain text, no context signature"
  else
    fail "fixtures: two_messages.jsonl shape wrong :: $(head -c 300 "$CLS_FX/two_messages.jsonl" 2>&1 | tr '\n' '|')"
  fi
  # --- long.jsonl: 1000+ chars with a newline, a tab, a double quote and a backslash ---
  if jq -es 'length == 1 and .[0].type == "turn.failed" and (.[0].error.message | length > 1000)
             and (.[0].error.message | contains("\n")) and (.[0].error.message | contains("\t"))
             and (.[0].error.message | contains("\"")) and (.[0].error.message | contains("\\"))' "$CLS_FX/long.jsonl" >/dev/null 2>&1; then
    pass "fixtures: long.jsonl is one turn.failed of 1000+ chars with a newline, a tab, a double quote and a backslash"
  else
    fail "fixtures: long.jsonl shape wrong :: $(head -c 300 "$CLS_FX/long.jsonl" 2>&1)"
  fi
  # --- long_context.jsonl: the signature starts past character 300 ---
  if jq -es 'length == 1 and .[0].type == "turn.failed"
             and ((.[0].error.message | index("Codex ran out of room in the model'"'"'s context window.")) > 300)
             and (.[0].error.message[0:300] | test("ran out of room|context window") | not)' "$CLS_FX/long_context.jsonl" >/dev/null 2>&1; then
    pass "fixtures: long_context.jsonl keeps its context-window signature past character 300"
  else
    fail "fixtures: long_context.jsonl signature is not past char 300 :: $(head -c 300 "$CLS_FX/long_context.jsonl" 2>&1)"
  fi
  # --- reconnect_ok.jsonl: two or more real-shaped "Reconnecting... N/5" top-level errors, then a
  #     turn that COMPLETES (no turn.failed anywhere) ---
  if jq -es 'length >= 3 and (.[-1].type == "turn.completed") and (.[:-1] | length >= 2)
             and all(.[:-1][]; .type == "error" and (.message | test("^Reconnecting\\.\\.\\. [0-9]+/5 \\(.+\\)$")))
             and (any(.[]; .type == "turn.failed") | not)' "$CLS_FX/reconnect_ok.jsonl" >/dev/null 2>&1; then
    pass "fixtures: reconnect_ok.jsonl is 2+ real-shaped 'Reconnecting... N/5 (...)' error events, then turn.completed, with no turn.failed"
  else
    fail "fixtures: reconnect_ok.jsonl shape wrong :: $(head -c 400 "$CLS_FX/reconnect_ok.jsonl" 2>&1 | tr '\n' '|')"
  fi

  # --- the stub arms: each failed-turn mode cats its fixture, exits 1, writes NO -o file ---
  ok=0
  for pair in api_400:api_400 context_length:context_length usage_limit:usage_limit chatter:chatter long_message:long long_context:long_context warning_nonzero:warning_context; do
    rm -f "$SANDBOX/cls70.o"
    printf 'packet\n' | env STUB_MODE="${pair%%:*}" "$STUB_DIR/codex" -o "$SANDBOX/cls70.o" > "$SANDBOX/cls70.stdout" 2>/dev/null
    rc=$?
    # the stub's own 3 lines (prelude, thread.started, turn.completed), then the WHOLE fixture, byte for byte
    tail -n +4 "$SANDBOX/cls70.stdout" > "$SANDBOX/cls70.body"
    if [ "$rc" -ne 1 ] || [ -e "$SANDBOX/cls70.o" ] \
       || ! cmp -s "$SANDBOX/cls70.body" "$CLS_FX/${pair#*:}.jsonl" \
       || ! grep -qF -- "$(head -n 1 "$CLS_FX/${pair#*:}.jsonl")" "$SANDBOX/cls70.stdout" \
       || ! grep -qF -- '"type":"thread.started"' "$SANDBOX/cls70.stdout"; then
      ok=1
      fail "stub-arms: STUB_MODE=${pair%%:*} must print ${pair#*:}.jsonl, exit 1 and write no -o file (rc=$rc, -o written: $([ -e "$SANDBOX/cls70.o" ] && echo yes || echo no)) :: $(head -c 300 "$SANDBOX/cls70.stdout")"
    fi
  done
  [ "$ok" -eq 0 ] && pass "stub-arms: api_400 / context_length / usage_limit / chatter / long_message / long_context / warning_nonzero each print their whole fixture, exit 1 and write no -o file"

  # --- the overflow arm and overflow.jsonl are the SAME line: the file is hand-written, so pin it to the stub ---
  rm -f "$SANDBOX/cls70.o"
  printf 'packet\n' | env STUB_MODE=overflow "$STUB_DIR/codex" -o "$SANDBOX/cls70.o" > "$SANDBOX/cls70.stdout" 2>/dev/null
  rc=$?
  tail -n 1 "$SANDBOX/cls70.stdout" > "$SANDBOX/cls70.body"
  if [ "$rc" -eq 1 ] && [ ! -e "$SANDBOX/cls70.o" ] \
     && [ "$(grep -c '' "$CLS_FX/overflow.jsonl")" = "1" ] \
     && cmp -s "$SANDBOX/cls70.body" "$CLS_FX/overflow.jsonl"; then
    pass "stub-arms: STUB_MODE=overflow prints a line identical to overflow.jsonl's only line (exit 1, no -o file), so the two cannot drift apart"
  else
    fail "stub-arms: STUB_MODE=overflow must print overflow.jsonl's single line byte for byte, exit 1, write no -o file (rc=$rc) :: stub: $(head -c 300 "$SANDBOX/cls70.body") :: file: $(head -c 300 "$CLS_FX/overflow.jsonl")"
  fi

  rm -f "$SANDBOX/cls70.o"
  printf 'packet\n' | env STUB_MODE=approve_with_warning "$STUB_DIR/codex" -o "$SANDBOX/cls70.o" > "$SANDBOX/cls70.stdout" 2>/dev/null
  rc=$?
  if [ "$rc" -eq 0 ] && jq -e '.verdict == "approve"' "$SANDBOX/cls70.o" >/dev/null 2>&1 \
     && grep -qF -- 'Model metadata for' "$SANDBOX/cls70.stdout" \
     && ! jq -Rr 'fromjson? | select(type == "object") | .type' "$SANDBOX/cls70.stdout" 2>/dev/null | grep -qE '^(error|turn\.failed)$'; then
    pass "stub-arms: approve_with_warning prints ONLY the warning line, writes an approve verdict and exits 0"
  else
    fail "stub-arms: approve_with_warning wrong (rc=$rc) :: $(head -c 300 "$SANDBOX/cls70.stdout") :: $(head -c 200 "$SANDBOX/cls70.o" 2>&1)"
  fi

  # --- reconnect_degenerate: the WHOLE reconnect_ok.jsonl, the degenerate verdict in -o, exit 0 ---
  rm -f "$SANDBOX/cls70.o"
  printf 'packet\n' | env STUB_MODE=reconnect_degenerate "$STUB_DIR/codex" -o "$SANDBOX/cls70.o" > "$SANDBOX/cls70.stdout" 2>/dev/null
  rc=$?
  tail -n +4 "$SANDBOX/cls70.stdout" > "$SANDBOX/cls70.body"
  if [ "$rc" -eq 0 ] && cmp -s "$SANDBOX/cls70.body" "$CLS_FX/reconnect_ok.jsonl" \
     && jq -e '.verdict == "request_changes" and (.blockers | length == 0)' "$SANDBOX/cls70.o" >/dev/null 2>&1; then
    pass "stub-arms: reconnect_degenerate prints the whole reconnect_ok.jsonl, writes the degenerate verdict (request_changes, no blockers) and exits 0"
  else
    fail "stub-arms: reconnect_degenerate wrong (rc=$rc) :: $(head -c 300 "$SANDBOX/cls70.stdout" | tr '\n' '|') :: $(head -c 200 "$SANDBOX/cls70.o" 2>&1)"
  fi

  # --- the seam: a matching stdin turns STUB_MODE=approve into api_400 for THAT call only ---
  printf 'packet with SEAM-API400-MARK inside\n' | env STUB_MODE=approve STUB_API400_IF_STDIN=SEAM-API400-MARK "$STUB_DIR/codex" > "$SANDBOX/cls70.stdout" 2>/dev/null
  rc=$?
  rm -f "$SANDBOX/cls70.o"
  printf 'a different packet\n' | env STUB_MODE=approve STUB_API400_IF_STDIN=SEAM-API400-MARK "$STUB_DIR/codex" -o "$SANDBOX/cls70.o" > /dev/null 2>&1
  rc2=$?
  if [ "$rc" -eq 1 ] && grep -qF -- 'status\":400' "$SANDBOX/cls70.stdout" \
     && [ "$rc2" -eq 0 ] && jq -e '.verdict == "approve"' "$SANDBOX/cls70.o" >/dev/null 2>&1; then
    pass "stub-seam: STUB_API400_IF_STDIN switches a matching call to api_400 (exit 1) and leaves a non-matching call approving (exit 0)"
  else
    fail "stub-seam: STUB_API400_IF_STDIN wrong (matching call rc=$rc, non-matching call rc=$rc2) :: $(head -c 300 "$SANDBOX/cls70.stdout")"
  fi
  reset_argv_log
}

#############################################################################
# TEST 71 — the 400: an HTTP 400 invalid_request_error that is NOT a context failure is an
#   INFRA_ERROR carrying the API's own message, in EVERY mode that calls Codex [PDR 4, 5].
#   RED: all six come back OVERFLOW ("diff too large") — the incident.
#############################################################################
run_test_71() {
  local m
  for m in plan bundle phase-review question investigate prepr; do
    cls_run_mode "$m" api_400
    cls_expect_api400 "$m"
  done
}

#############################################################################
# TEST 72 — context code: context_length_exceeded (an invalid_request_error whose TEXT says
#   nothing about the window) is still a context OVERFLOW, with the summary unchanged [PDR 4].
#   A guard of unchanged behavior: it may already pass (RED reads it as OVERFLOW because of the
#   bare "turn.failed" alternative); it keeps the CODE from being mapped to INFRA_ERROR with
#   every other invalid_request_error once the classifier changes.
#############################################################################
run_test_72() {
  local m
  for m in prepr question investigate phase-review; do
    cls_run_mode "$m" context_length
    cls_expect_context_overflow "context_length_exceeded code, $m"
  done
}

#############################################################################
# TEST 73 — plain API text: a failure whose message is not a JSON API error (a usage limit) is
#   an INFRA_ERROR with that text as the reason — the bare "turn.failed" is no longer enough
#   to call a run OVERFLOW [PDR 4].
#############################################################################
run_test_73() {
  local ok=0
  cls_run_mode prepr usage_limit
  [ "$CLS_OUTCOME" = "INFRA_ERROR" ] || ok=1
  cls_summary_has 'usage limit' || ok=1
  cls_summary_has "codex turn failed (exit 1): You've hit your usage limit. Upgrade to Pro or try again later." || ok=1
  cls_summary_one_line || ok=1
  [ "$CLS_NCALLS" -ge 1 ] || ok=1
  if [ "$ok" -eq 0 ]; then
    pass "classify-plain: a usage-limit turn.failed -> INFRA_ERROR whose summary carries the plain message"
  else
    fail "classify-plain: expected INFRA_ERROR with the usage-limit message in the summary, got $(cls_diag)"
  fi
}

#############################################################################
# TEST 74 — chatter, nonzero: an agent_message that TALKS about the context window ("ran out of
#   room", "context window") and a command_execution item whose OUTPUT says it, with NO failure
#   event, are not a context failure. The nonzero exit is a generic INFRA_ERROR; it must never be
#   OVERFLOW [PDR 4, 6: agent text and command output never make a run OVERFLOW]. (The old
#   whole-file grep read this log as OVERFLOW.)
#############################################################################
run_test_74() {
  local ok=0
  cls_run_mode prepr chatter
  [ "$CLS_OUTCOME" = "INFRA_ERROR" ] || ok=1
  case "$CLS_SUMMARY" in 'codex exited nonzero (1)'*) : ;; *) ok=1 ;; esac
  [ "$CLS_NCALLS" -ge 1 ] || ok=1
  if [ "$ok" -eq 0 ]; then
    pass "classify-chatter: a nonzero exit whose log only TALKS about the context window (agent text and command output) -> generic INFRA_ERROR, never OVERFLOW"
  else
    fail "classify-chatter: expected INFRA_ERROR with a summary starting 'codex exited nonzero (1)', got $(cls_diag)"
  fi
}

#############################################################################
# TEST 75 — warning is harmless: the item.completed warning (item.type "error": "Model
#   metadata ... not found") never counts as a failure [PDR 6]. Two halves:
#   (a) a clean run whose log carries it still APPROVEs (exit 0 never reads failure events: a guard
#       of unchanged behavior, it passes today and must keep passing);
#   (b) a NONZERO exit whose only "failure" is a warning that mentions the context window is the
#       generic INFRA_ERROR `codex exited nonzero (1)` — never OVERFLOW, never `codex turn failed`
#       (a classifier that counted warnings as failure events would fail only here).
#############################################################################
run_test_75() {
  local ok=0 runDir
  cls_run_mode prepr approve_with_warning
  runDir="$(printf '%s' "$CLS_STATUS" | jq -r '.runDir // empty' 2>/dev/null)"
  [ "$CLS_OUTCOME" = "APPROVE" ] || ok=1
  # the premise: the warning really is in the round log this run produced
  grep -qF -- 'Model metadata for' "$runDir/round-1.jsonl" 2>/dev/null || ok=1
  if [ "$ok" -eq 0 ]; then
    pass "classify-warning: a round whose log carries the item.completed warning still APPROVEs"
  else
    fail "classify-warning: expected APPROVE with the warning in $runDir/round-1.jsonl, got $(cls_diag)"
  fi

  # (b) warning + nonzero exit, no failure event
  ok=0
  cls_run_mode prepr warning_nonzero
  runDir="$(printf '%s' "$CLS_STATUS" | jq -r '.runDir // empty' 2>/dev/null)"
  [ "$CLS_OUTCOME" = "INFRA_ERROR" ] || ok=1
  case "$CLS_SUMMARY" in 'codex exited nonzero (1)'*) : ;; *) ok=1 ;; esac
  cls_summary_has 'codex turn failed' && ok=1             # a warning is not a failure event
  [ "$CLS_NCALLS" -ge 1 ] || ok=1
  # the premise: the warning really is in the round log this run produced
  grep -qF -- 'Context window usage is high' "$runDir/round-1.jsonl" 2>/dev/null || ok=1
  if [ "$ok" -eq 0 ]; then
    pass "classify-warning: a nonzero exit whose log only carries a context-window WARNING -> INFRA_ERROR 'codex exited nonzero (1)', never OVERFLOW or 'codex turn failed'"
  else
    fail "classify-warning: expected INFRA_ERROR with a summary starting 'codex exited nonzero (1)' (no 'codex turn failed') and the warning in $runDir/round-1.jsonl, got $(cls_diag)"
  fi
}

#############################################################################
# TEST 76 — long message: the summary is ONE line (control characters become spaces), carries the
#   quotes and the backslash intact, and cuts the API's message to 300 characters plus `…`;
#   the status is still ONE valid JSON line [PDR 4, ADR-005].
#############################################################################
run_test_76() {
  local ok=0 nlines msglen
  cls_run_mode prepr long_message
  [ "$CLS_OUTCOME" = "INFRA_ERROR" ] || ok=1
  cls_summary_one_line || ok=1                                  # no newline, tab or any control character
  cls_summary_has '…' || ok=1
  cls_summary_has 'codex turn failed (exit 1): ' || ok=1
  # stdout: exactly ONE line, and it is the status JSON
  nlines="$(grep -c '' "$SANDBOX/cls.out" 2>/dev/null)"; [ -n "$nlines" ] || nlines=0
  [ "$nlines" -eq 1 ] || ok=1
  jq -e . "$SANDBOX/cls.out" >/dev/null 2>&1 || ok=1
  # the message part: 300 characters + the ellipsis, built from the normalized head of the message
  msglen="$(printf '%s' "$CLS_STATUS" | jq -r '.summary | capture("^codex turn failed \\(exit 1\\): (?<m>.*) — see ") | .m | length' 2>/dev/null)"
  [ "$msglen" = "301" ] || ok=1
  printf '%s' "$CLS_STATUS" | jq -e --arg h 'LONG-HEAD first line second line tabbed "double quotes" and back\slash then filler filler-0001 ' \
    '.summary | capture("^codex turn failed \\(exit 1\\): (?<m>.*) — see ") | .m | (startswith($h) and endswith("…"))' >/dev/null 2>&1 || ok=1
  if [ "$ok" -eq 0 ]; then
    pass "classify-long: a 1000+ char message with newline/tab/quotes/backslash -> one-line INFRA_ERROR, message cut to 300 chars + '…', one JSON status line"
  else
    fail "classify-long: expected a one-line INFRA_ERROR whose message part is 301 chars ('…' last) in ONE JSON line (stdout lines=$nlines, message length='$msglen'), got $(cls_diag)"
  fi
}

#############################################################################
# TEST 77 — signature past the cap: classification reads the UNCAPPED message, so a context
#   signature that sits past character 300 still means OVERFLOW (only the SUMMARY is capped)
#   [ADR-004; the bundle gate's round-1 finding]. A guard of unchanged behavior (RED reads it as
#   OVERFLOW through the whole-file grep): it breaks if classification is ever fed the capped line.
#   Three routes: unsharded prepr, question, and the shard classifier.
#############################################################################
run_test_77() {
  local got
  cls_run_mode prepr long_context
  cls_expect_context_overflow "long message, signature past char 300, prepr"
  cls_run_mode question long_context
  cls_expect_context_overflow "long message, signature past char 300, question"
  got="$(cls_call classify_verdict_file "$CLS_FX/no-such-verdict.json" "$CLS_FX/long_context.jsonl" 1)"
  if [ "$got" = "OVERFLOW" ]; then
    pass "classify-long-context: classify_verdict_file reads the UNCAPPED message (signature past char 300 -> OVERFLOW)"
  else
    fail "classify-long-context: classify_verdict_file <missing> long_context.jsonl 1: expected OVERFLOW, got '$got'"
  fi
}

#############################################################################
# TEST 78 — sharded 400 [PDR 5, ADR-006]: TEST 31's three-file repo (docs / tests / other shards)
#   with the `other` shard's packet carrying SHARD-API400-HERE, so ONLY that shard's call hits the
#   400 (STUB_API400_IF_STDIN). The aggregate is INFRA_ERROR naming the shard and the API error,
#   not "shard other inconclusive" OVERFLOW. RED: aggregate OVERFLOW with no API message.
#############################################################################
cls_shard_repo() { # <marker> — TEST 31's repo; app.js (group `other`) carries <marker> on every line
  local r i
  r="$(make_repo)"
  printf 'seed\n' > "$r/seed.txt"
  git -C "$r" add seed.txt && git -C "$r" commit -qm init
  mkdir -p "$r/docs"
  { for i in $(seq 1 60); do printf 'docs-line-%s SHARD-DOCS-MARK\n' "$i"; done; } > "$r/docs/guide.md"
  { for i in $(seq 1 60); do printf 'test-line-%s SHARD-TESTS-MARK\n' "$i"; done; } > "$r/thing.test.js"
  { for i in $(seq 1 60); do printf 'src-line-%s %s\n' "$i" "$1"; done; } > "$r/app.js"
  printf '%s' "$r"
}

cls_multi_repo() { # <marker> — TEST 44's repo: a seed commit, then one changed line carrying <marker>
  local r
  r="$(make_repo)"
  printf 'seed\n' > "$r/seed.txt"
  git -C "$r" add seed.txt && git -C "$r" commit -qm init
  printf 'src line %s\n' "$1" >> "$r/seed.txt"
  printf '%s' "$r"
}

# The fan-out emitters (the aggregate verdict file, the shard status line, the lens status line)
# build their JSON from the failing job's message. The 400's text has no quote, backslash or control
# character, so it cannot tell a jq-built emitter from a raw printf (ADR-006 forbids the printf).
# Every job of the run just failed with STUB_MODE=long_message — long.jsonl's message carries a
# newline, a tab, "double quotes" and back\slash — so only a jq-built emitter yields valid JSON.
cls_expect_long_fanout() { # <label> <noun: shard|lens> — call right after cls_run
  local ok=0 nlines vpath
  [ "$CLS_OUTCOME" = "INFRA_ERROR" ] || ok=1
  [ -n "$CLS_STATUS" ] || ok=1                                       # no parseable status line is a FAIL, never a skip
  nlines="$(grep -c '' "$SANDBOX/cls.out" 2>/dev/null)"; [ -n "$nlines" ] || nlines=0
  [ "$nlines" -eq 1 ] || ok=1                                        # stdout is the status line and nothing else
  jq -e . "$SANDBOX/cls.out" >/dev/null 2>&1 || ok=1                 # ALL of stdout parses (last_json_line alone would skip a broken line)
  printf '%s' "$CLS_STATUS" | jq -e --arg n "$2" \
    '.summary | test("^" + $n + " [a-z]+ failed: codex turn failed \\(exit 1\\): LONG-HEAD")' >/dev/null 2>&1 || ok=1
  cls_summary_has '"double quotes"' || ok=1
  cls_summary_has 'back\slash' || ok=1
  cls_summary_one_line || ok=1
  [ "$CLS_NCALLS" -ge 2 ] || ok=1                                    # a real fan-out: several (stub) calls, each failing
  # the aggregate verdict file the status points at: ONE valid JSON document with the same text
  vpath="$(printf '%s' "$CLS_STATUS" | jq -r '.verdictPath // empty' 2>/dev/null)"
  if [ -n "$vpath" ] && jq -es --arg q '"double quotes"' --arg b 'back\slash' \
       'length == 1 and (.[0].summary | type == "string" and contains($q) and contains($b))' "$vpath" >/dev/null 2>&1; then :; else ok=1; fi
  if [ "$ok" -eq 0 ]; then
    pass "fanout-json: $1, every $2 failing with a long message -> INFRA_ERROR; the status line and the aggregate verdict file are valid JSON carrying \"double quotes\" and back\\slash, summary on one line"
  else
    fail "fanout-json: $1: expected INFRA_ERROR whose one-line summary starts '$2 <name> failed: codex turn failed (exit 1): LONG-HEAD', carries \"double quotes\" and back\\slash, with a valid single-line status and a valid aggregate verdict file '$vpath' (stdout lines=$nlines), got $(cls_diag) :: stdout: $(head -c 300 "$SANDBOX/cls.out" | tr '\n\t' '  ') :: verdict file: $(head -c 300 "${vpath:-/nonexistent}" 2>&1 | tr '\n\t' '  ')"
  fi
}

run_test_78() {
  local repo ok=0 vpath
  repo="$(cls_shard_repo SHARD-API400-HERE)"
  cls_run "$repo" approve CODEX_GATE_PACKET_BUDGET=9000 CODEX_GATE_SHARD=auto STUB_API400_IF_STDIN=SHARD-API400-HERE -- prepr
  [ "$CLS_OUTCOME" = "INFRA_ERROR" ] || ok=1
  case "$CLS_SUMMARY" in 'shard other failed:'*) : ;; *) ok=1 ;; esac
  cls_summary_has 'HTTP 400' || ok=1
  cls_summary_has "$CLS_LINE_400" || ok=1
  cls_summary_has 'sharded into 3; fail closed' || ok=1
  cls_summary_one_line || ok=1
  if [ "$ok" -eq 0 ]; then
    pass "sharded-400: aggregate INFRA_ERROR, summary 'shard other failed: ... HTTP 400 ...' (not OVERFLOW)"
  else
    fail "sharded-400: expected INFRA_ERROR with a summary starting 'shard other failed:' that carries the 400, got $(cls_diag)"
  fi
  # shards[]: ONLY `other` failed; the other two shards approved (the seam hit one call)
  if printf '%s' "$CLS_STATUS" | jq -e '(.shards | length == 3)
       and ((.shards | map({(.group): .outcome}) | add) == {"docs":"APPROVE","tests":"APPROVE","other":"INFRA_ERROR"})' >/dev/null 2>&1 \
     && [ "$CLS_NCALLS" -eq 3 ]; then
    pass "sharded-400: shards[] has other=INFRA_ERROR and docs/tests=APPROVE (3 calls: the other shards still ran)"
  else
    fail "sharded-400: expected shards[] other=INFRA_ERROR, docs=APPROVE, tests=APPROVE with 3 calls, got shards=$(printf '%s' "$CLS_STATUS" | jq -c '(.shards // []) | map({(.group): .outcome}) | add' 2>/dev/null) :: $(cls_diag)"
  fi
  # the aggregate keeps its fail-closed status shape: coverage + shards (ADR-006), no lenses
  if printf '%s' "$CLS_STATUS" | jq -e '.outcome == "INFRA_ERROR" and has("coverage") and (.coverage | type == "object")
       and (.shards | type == "array") and (has("lenses") | not)' >/dev/null 2>&1; then
    pass "sharded-400: the INFRA_ERROR status carries coverage and shards[] (the shard emitter's shape)"
  else
    fail "sharded-400: expected an INFRA_ERROR status with coverage and shards[] (and no lenses[]), got $(cls_diag) :: $(printf '%s' "$CLS_STATUS" | jq -c '{outcome, keys: keys}' 2>/dev/null)"
  fi
  # the aggregate verdict file is valid JSON and carries the API error too
  vpath="$(printf '%s' "$CLS_STATUS" | jq -r '.verdictPath // empty' 2>/dev/null)"
  if [ "$(basename "${vpath:-x}")" = "round-1-verdict.json" ] && [ -f "$vpath" ] \
     && jq -e '(.summary | type == "string") and (.summary | contains("HTTP 400"))' "$vpath" >/dev/null 2>&1; then
    pass "sharded-400: round-1-verdict.json is valid JSON and its .summary carries 'HTTP 400'"
  else
    fail "sharded-400: round-1-verdict.json missing / invalid / without 'HTTP 400' :: path='$vpath' :: $(head -c 300 "$vpath" 2>&1) :: $(cls_diag)"
  fi
  # the shard emitter and the aggregate verdict file on a message that needs JSON escaping: every
  # shard fails with long.jsonl's message (a newline, a tab, "double quotes", a backslash)
  repo="$(cls_shard_repo SHARD-LONG-MARK)"
  cls_run "$repo" long_message CODEX_GATE_PACKET_BUDGET=9000 CODEX_GATE_SHARD=auto -- prepr
  cls_expect_long_fanout "sharded prepr" shard
}

#############################################################################
# TEST 79 — sharded context: a shard that really overflows the context window is still aggregate
#   OVERFLOW "shard other inconclusive" (TEST 33's shape). It characterizes the path that must NOT
#   change when ADR-006 adds INFRA_ERROR. May already pass.
#############################################################################
run_test_79() {
  local repo ok=0
  repo="$(cls_shard_repo SHARD-OVERFLOW-HERE)"
  cls_run "$repo" approve CODEX_GATE_PACKET_BUDGET=9000 CODEX_GATE_SHARD=auto STUB_OVERFLOW_IF_STDIN=SHARD-OVERFLOW-HERE -- prepr
  [ "$CLS_OUTCOME" = "OVERFLOW" ] || ok=1
  cls_summary_has 'shard other inconclusive' || ok=1
  cls_summary_has 'failed:' && ok=1                       # the INFRA_ERROR wording must NOT leak into an overflow
  [ "$CLS_NCALLS" -eq 3 ] || ok=1                         # all three shards really ran: a runtime overflow, not a budget one
  if printf '%s' "$CLS_STATUS" | jq -e '[.shards[] | select(.group == "other")] | .[0].outcome == "OVERFLOW"' >/dev/null 2>&1; then :; else ok=1; fi
  if [ "$ok" -eq 0 ]; then
    pass "sharded-context: a shard that overflows the context window stays aggregate OVERFLOW 'shard other inconclusive' (3 calls)"
  else
    fail "sharded-context: expected OVERFLOW 'shard other inconclusive' with other=OVERFLOW and 3 calls, got shards=$(printf '%s' "$CLS_STATUS" | jq -c '(.shards // []) | map({(.group): .outcome}) | add' 2>/dev/null) :: $(cls_diag)"
  fi
}

#############################################################################
# TEST 80 — multi-lens 400 [PDR 5, ADR-006]: `prepr --multi` where EVERY lens call gets the 400
#   (STUB_MODE=api_400). The aggregate is INFRA_ERROR naming the first failing lens and the API
#   error; every lenses[] entry is INFRA_ERROR. RED: aggregate OVERFLOW "lens <l> inconclusive".
#############################################################################
run_test_80() {
  local repo ok=0
  repo="$(cls_multi_repo MULTI-LENS-API400-MARK)"                     # TEST 44's setup
  cls_run "$repo" api_400 -- prepr --multi
  [ "$CLS_OUTCOME" = "INFRA_ERROR" ] || ok=1
  case "$CLS_SUMMARY" in 'lens '*) : ;; *) ok=1 ;; esac
  cls_summary_has ' failed: ' || ok=1
  cls_summary_has 'HTTP 400' || ok=1
  cls_summary_has "$CLS_LINE_400" || ok=1
  cls_summary_has 'lenses; fail closed)' || ok=1
  cls_summary_one_line || ok=1
  if [ "$ok" -eq 0 ]; then
    pass "multi-400: aggregate INFRA_ERROR, summary 'lens <l> failed: ... HTTP 400 ...' (not OVERFLOW)"
  else
    fail "multi-400: expected INFRA_ERROR with a summary starting 'lens ' that contains ' failed: ' and the 400, got $(cls_diag)"
  fi
  if printf '%s' "$CLS_STATUS" | jq -e '(.lenses | type == "array") and (.lenses | length >= 2) and all(.lenses[]; .outcome == "INFRA_ERROR")' >/dev/null 2>&1 \
     && printf '%s' "$CLS_STATUS" | jq -e 'has("coverage") and (has("shards") | not)' >/dev/null 2>&1; then
    pass "multi-400: every lenses[] entry is INFRA_ERROR, and the status carries coverage (the lens emitter's shape)"
  else
    fail "multi-400: expected >=2 lenses[] entries, ALL INFRA_ERROR, plus coverage; got lenses=$(printf '%s' "$CLS_STATUS" | jq -c '(.lenses // []) | map({(.lens): .outcome}) | add' 2>/dev/null) :: $(cls_diag)"
  fi
  # the lens emitter and the aggregate verdict file on a message that needs JSON escaping: every
  # lens fails with long.jsonl's message (a newline, a tab, "double quotes", a backslash)
  repo="$(cls_multi_repo MULTI-LENS-LONG-MARK)"
  cls_run "$repo" long_message -- prepr --multi
  cls_expect_long_fanout "prepr --multi" lens
}

#############################################################################
# TEST 81 — aggregate precedence BLOCK > INFRA_ERROR > OVERFLOW > APPROVE, driven on
#   fan_out_and_aggregate directly (the wrapper sourced in a subshell, as TEST 36 does) over two
#   jobs whose packets carry per-call stub markers [ADR-006]. cls_fan prints the aggregate and the
#   output variables, including the two new ones: FAN_FIRST_INFRA (the first INFRA_ERROR job) and
#   FAN_INFRA_REASON (its one-line reason), while FAN_FIRST_INCONCLUSIVE keeps its meaning (the
#   first OVERFLOW *or* INFRA_ERROR job). It has its own job directory: TEST 36's run_fan reads
#   a `job_dir` local of TEST 36 itself.
#############################################################################
cls_fan() { # <job-dir> <jobs-file> <stub-env-string> — prints OUTCOME / FIRSTINC / FIRSTINFRA / INFRAREASON / JOBS / AGGSUMMARY
  local jd="$1" jobs="$2" stubenv="$3"
  (
    set +u
    # shellcheck disable=SC1090
    . "$WRAPPER" >/dev/null 2>&1 || { printf 'SOURCEFAIL\n'; exit 0; }
    if [ "$(type -t fan_out_and_aggregate 2>/dev/null)" != function ]; then printf 'NOFUNC\n'; exit 0; fi
    RUN_DIR="$jd/run"; rm -rf "$RUN_DIR"; mkdir -p "$RUN_DIR"
    REPO_ROOT="$jd"
    ROUND=1; set_round_paths
    eval "$stubenv"
    export STUB_MODE="${STUB_MODE:-approve}"
    export STUB_BLOCK_IF_STDIN="${STUB_BLOCK_IF_STDIN:-}"
    export STUB_OVERFLOW_IF_STDIN="${STUB_OVERFLOW_IF_STDIN:-}"
    export STUB_API400_IF_STDIN="${STUB_API400_IF_STDIN:-}"
    fan_out_and_aggregate "$jobs" >/dev/null 2>&1
    printf 'OUTCOME=%s\n' "${FAN_OUTCOME:-}"
    printf 'FIRSTINC=%s\n' "${FAN_FIRST_INCONCLUSIVE:-}"
    printf 'FIRSTINFRA=%s\n' "${FAN_FIRST_INFRA:-}"
    printf 'INFRAREASON=%s\n' "${FAN_INFRA_REASON:-}"
    printf 'JOBS=%s\n' "$(printf '%s' "${FAN_JOBS_JSON:-[]}" | jq -cS 'map({(.group): .outcome}) | add' 2>/dev/null)"
    printf 'AGGSUMMARY=%s\n' "$(jq -r '.summary // ""' "$VERDICT_FILE" 2>/dev/null)"
  ) 2>/dev/null
}

cls_fan_field() { # <field> — the value of OUTCOME= / FIRSTINC= ... in $CLS_FAN_OUT
  printf '%s\n' "$CLS_FAN_OUT" | sed -n "s/^$1=//p" | head -n 1
}

cls_expect_fan() { # <label> <outcome> <first-inconclusive|ANY> <first-infra|ANY> <jobs-json> — compare the aggregate AND each job's own outcome
  local ok=0
  [ "$(cls_fan_field OUTCOME)" = "$2" ] || ok=1
  [ "$3" = ANY ] || [ "$(cls_fan_field FIRSTINC)" = "$3" ] || ok=1
  [ "$4" = ANY ] || [ "$(cls_fan_field FIRSTINFRA)" = "$4" ] || ok=1
  # the premise: each job really ended as the case says (the seams hit the jobs they were aimed at)
  [ "$(cls_fan_field JOBS)" = "$(printf '%s' "$5" | jq -cS . 2>/dev/null)" ] || ok=1
  if [ "$ok" -eq 0 ]; then
    pass "fan-precedence: $1 -> $2 (jobs $5; FAN_FIRST_INCONCLUSIVE='$3', FAN_FIRST_INFRA='$4')"
  else
    fail "fan-precedence: $1: expected OUTCOME=$2 FIRSTINC='$3' FIRSTINFRA='$4' JOBS=$5, got :: $(printf '%s' "$CLS_FAN_OUT" | tr '\n' '|' | head -c 700)"
  fi
}

run_test_81() {
  local jd="$SANDBOX/cls81" reason agg
  rm -rf "$jd"; mkdir -p "$jd"

  # control: the driver and the seams do not leak — two clean jobs APPROVE, no INFRA job named
  printf 'packet alpha: clean\n' > "$jd/a.packet"
  printf 'packet beta: clean\n'  > "$jd/b.packet"
  printf 'alpha\t1\t%s\nbeta\t1\t%s\n' "$jd/a.packet" "$jd/b.packet" > "$jd/jobs-ok.tsv"
  CLS_FAN_OUT="$(cls_fan "$jd" "$jd/jobs-ok.tsv" 'STUB_MODE=approve; STUB_API400_IF_STDIN=FAN-API400-NEVER-PRESENT')"
  cls_expect_fan "control: two clean jobs" APPROVE "" "" '{"alpha":"APPROVE","beta":"APPROVE"}'

  # {alpha: BLOCK, beta: 400} -> BLOCK (blockers are actionable and a re-run re-surfaces the failure)
  printf 'packet alpha: SHARDBLOCKER-ALPHA flagged\n' > "$jd/a.packet"
  printf 'packet beta: FAN-API400-BETA\n'             > "$jd/b.packet"
  printf 'alpha\t1\t%s\nbeta\t1\t%s\n' "$jd/a.packet" "$jd/b.packet" > "$jd/jobs-1.tsv"
  CLS_FAN_OUT="$(cls_fan "$jd" "$jd/jobs-1.tsv" 'STUB_MODE=approve; STUB_BLOCK_IF_STDIN=SHARDBLOCKER; STUB_API400_IF_STDIN=FAN-API400-BETA')"
  # (beta's own outcome must be INFRA_ERROR: the 400 really reached it and was classified, then outranked)
  cls_expect_fan "{alpha: block, beta: 400}: BLOCK outranks INFRA_ERROR" BLOCK ANY ANY '{"alpha":"BLOCK","beta":"INFRA_ERROR"}'

  # {alpha: 400, beta: overflow} -> INFRA_ERROR, first infra alpha, first inconclusive alpha
  printf 'packet alpha: FAN-API400-ALPHA\n'   > "$jd/a.packet"
  printf 'packet beta: FAN-OVERFLOW-BETA\n'   > "$jd/b.packet"
  printf 'alpha\t1\t%s\nbeta\t1\t%s\n' "$jd/a.packet" "$jd/b.packet" > "$jd/jobs-2.tsv"
  CLS_FAN_OUT="$(cls_fan "$jd" "$jd/jobs-2.tsv" 'STUB_MODE=approve; STUB_API400_IF_STDIN=FAN-API400-ALPHA; STUB_OVERFLOW_IF_STDIN=FAN-OVERFLOW-BETA')"
  cls_expect_fan "{alpha: 400, beta: overflow}: INFRA_ERROR outranks OVERFLOW" INFRA_ERROR alpha alpha '{"alpha":"INFRA_ERROR","beta":"OVERFLOW"}'

  # {alpha: overflow, beta: 400} -> INFRA_ERROR, first infra beta, first inconclusive alpha
  printf 'packet alpha: FAN-OVERFLOW-ALPHA\n' > "$jd/a.packet"
  printf 'packet beta: FAN-API400-BETA\n'     > "$jd/b.packet"
  printf 'alpha\t1\t%s\nbeta\t1\t%s\n' "$jd/a.packet" "$jd/b.packet" > "$jd/jobs-3.tsv"
  CLS_FAN_OUT="$(cls_fan "$jd" "$jd/jobs-3.tsv" 'STUB_MODE=approve; STUB_OVERFLOW_IF_STDIN=FAN-OVERFLOW-ALPHA; STUB_API400_IF_STDIN=FAN-API400-BETA')"
  cls_expect_fan "{alpha: overflow, beta: 400}: the INFRA job is named even when an OVERFLOW job came first" INFRA_ERROR alpha beta '{"alpha":"OVERFLOW","beta":"INFRA_ERROR"}'
  reason="$(cls_fan_field INFRAREASON)"
  if printf '%s' "$reason" | grep -qF -- 'HTTP 400' && printf '%s' "$reason" | grep -qF -- "$CLS_LINE_400" \
     && [ "$(cls_fan_field AGGSUMMARY)" = "shard beta failed: $reason" ]; then
    pass "fan-precedence: FAN_INFRA_REASON carries 'HTTP 400' and the aggregate verdict .summary is 'shard beta failed: <reason>'"
  else
    fail "fan-precedence: expected FAN_INFRA_REASON with the unwrapped 400 and AGGSUMMARY 'shard beta failed: <reason>', got reason='$reason' :: $(printf '%s' "$CLS_FAN_OUT" | tr '\n' '|' | head -c 600)"
  fi

  # {alpha: exit 0 with an EMPTY verdict, beta: same} -> INFRA_ERROR; the reason is the missing verdict
  # (clean packets again: the ones above still carry the previous case's markers)
  printf 'packet alpha: clean\n' > "$jd/a.packet"
  printf 'packet beta: clean\n'  > "$jd/b.packet"
  printf 'alpha\t1\t%s\nbeta\t1\t%s\n' "$jd/a.packet" "$jd/b.packet" > "$jd/jobs-4.tsv"
  CLS_FAN_OUT="$(cls_fan "$jd" "$jd/jobs-4.tsv" 'STUB_MODE=empty')"
  cls_expect_fan "{alpha: empty verdict, beta: empty verdict} (exit 0): an unusable verdict is INFRA_ERROR" INFRA_ERROR alpha alpha '{"alpha":"INFRA_ERROR","beta":"INFRA_ERROR"}'
  if [ "$(cls_fan_field INFRAREASON)" = "no usable verdict ($jd/run/shard-alpha-verdict.json)" ]; then
    pass "fan-precedence: an exit-0 job's reason is 'no usable verdict (<its verdict path>)'"
  else
    fail "fan-precedence: expected FAN_INFRA_REASON='no usable verdict ($jd/run/shard-alpha-verdict.json)', got :: $(printf '%s' "$CLS_FAN_OUT" | tr '\n' '|' | head -c 600)"
  fi

  # {alpha: a long failure message with a newline, a tab, "double quotes" and a backslash} -> the
  # aggregate verdict file is built by jq (ADR-006), so it is still valid JSON and carries the text.
  # The 400's message has none of those characters: only this case can tell jq from a raw printf.
  printf 'packet alpha: clean\n' > "$jd/a.packet"
  printf 'alpha\t1\t%s\n' "$jd/a.packet" > "$jd/jobs-5.tsv"
  CLS_FAN_OUT="$(cls_fan "$jd" "$jd/jobs-5.tsv" 'STUB_MODE=long_message')"
  cls_expect_fan "{alpha: long message with quotes, a backslash, a newline and a tab}: INFRA_ERROR" INFRA_ERROR alpha alpha '{"alpha":"INFRA_ERROR"}'
  agg="$jd/run/round-1-verdict.json"
  if jq -es --arg h 'shard alpha failed: codex turn failed (exit 1): LONG-HEAD' --arg q '"double quotes"' --arg b 'back\slash' \
       'length == 1 and (.[0].summary | type == "string" and startswith($h) and contains($q) and contains($b)
                         and ((test("[[:cntrl:]]")) | not))' "$agg" >/dev/null 2>&1; then
    pass "fan-json: the aggregate verdict file is valid JSON; its one-line .summary starts 'shard alpha failed: codex turn failed (exit 1): LONG-HEAD' and carries \"double quotes\" and back\\slash"
  else
    fail "fan-json: $agg must be ONE valid JSON document whose one-line .summary starts 'shard alpha failed: codex turn failed (exit 1): LONG-HEAD' and contains \"double quotes\" and back\\slash, got :: $(head -c 400 "$agg" 2>&1 | tr '\n\t' '  ') :: $(printf '%s' "$CLS_FAN_OUT" | tr '\n' '|' | head -c 400)"
  fi

  # {alpha: real-shaped "Reconnecting... N/5" error events, then turn.completed, a degenerate verdict, exit 0}
  # -> INFRA_ERROR whose reason is the unusable verdict. Codex logs those top-level errors inside turns that
  # then complete normally, so on a zero exit they are noise: the reason must NOT be `codex turn failed (exit 0)`.
  printf 'packet alpha: clean\n' > "$jd/a.packet"
  printf 'alpha\t1\t%s\n' "$jd/a.packet" > "$jd/jobs-6.tsv"
  CLS_FAN_OUT="$(cls_fan "$jd" "$jd/jobs-6.tsv" 'STUB_MODE=reconnect_degenerate')"
  cls_expect_fan "{alpha: reconnect errors, turn.completed, degenerate verdict} (exit 0): INFRA_ERROR" INFRA_ERROR alpha alpha '{"alpha":"INFRA_ERROR"}'
  reason="$(cls_fan_field INFRAREASON)"
  if [ "${reason#no usable verdict (}" != "$reason" ] \
     && printf '%s' "$reason" | grep -qF -- "$jd/run/shard-alpha-verdict.json" \
     && ! printf '%s' "$reason" | grep -qF -- 'codex turn failed'; then
    pass "fan-reconnect: an exit-0 job whose log holds Reconnecting... error events reads 'no usable verdict (<its verdict path>)', never 'codex turn failed'"
  else
    fail "fan-reconnect: expected FAN_INFRA_REASON starting 'no usable verdict (' with '$jd/run/shard-alpha-verdict.json' and no 'codex turn failed', got reason='$reason' :: $(printf '%s' "$CLS_FAN_OUT" | tr '\n' '|' | head -c 600)"
  fi
}

#############################################################################
# TEST 82 — classify_verdict_file (the non-emitting shard / lens classifier) on its own
#   [ADR-004]: `classify_verdict_file <missing verdict> <jsonl> 1` for each failed-turn log, and
#   its unchanged exit-0 paths. Always exactly ONE token (TEST 36 shadows this function and the
#   fan-out reads it through $(...), so the 3-argument one-token contract is load-bearing).
#############################################################################
cls_expect_token() { # <label> <expected-token> <jsonl> <exit> [verdict-file]
  local got words
  cls_call classify_verdict_file "${5:-$CLS_FX/no-such-verdict.json}" "$3" "$4" > "$SANDBOX/cls.unit"
  got="$(cat "$SANDBOX/cls.unit")"
  words="$(wc -w < "$SANDBOX/cls.unit" | tr -d ' ')"
  if [ "$got" = "$2" ] && [ "$words" = "1" ]; then
    pass "classify-unit: $1 -> exactly '$2'"
  else
    fail "classify-unit: $1: expected exactly the one token '$2', got '$got' ($words words)"
  fi
}

run_test_82() {
  # nonzero exit, no verdict file: the cause is read from the failure events only
  cls_expect_token "api_400 (a 400 that is not a context failure)" INFRA_ERROR "$CLS_FX/api_400.jsonl" 1
  cls_expect_token "context_length (the code, no signature text)" OVERFLOW "$CLS_FX/context_length.jsonl" 1
  cls_expect_token "chatter (signature text, no failure event)" INFRA_ERROR "$CLS_FX/chatter.jsonl" 1
  cls_expect_token "the overflow stub's own turn.failed text" OVERFLOW "$CLS_FX/overflow.jsonl" 1
  cls_expect_token "a top-level error event alone (no turn.failed) with the signature" OVERFLOW "$CLS_FX/error_only.jsonl" 1
  cls_expect_token "usage_limit (plain failure text)" INFRA_ERROR "$CLS_FX/usage_limit.jsonl" 1
  cls_expect_token "long_context (signature past char 300, uncapped)" OVERFLOW "$CLS_FX/long_context.jsonl" 1
  cls_expect_token "long_message (a long failure with no signature)" INFRA_ERROR "$CLS_FX/long.jsonl" 1
  cls_expect_token "a warning item that mentions the context window" INFRA_ERROR "$CLS_FX/warning_context.jsonl" 1
  cls_expect_token "a missing jsonl" INFRA_ERROR "$CLS_FX/no-such.jsonl" 1

  # exit 0: the verdict decides, as before (the classifier edit must not touch these)
  printf '%s\n' '{"verdict":"approve","summary":"ok","blockers":[],"nonBlocking":[]}' > "$CLS_FX/v-approve.json"
  printf '%s\n' '{"verdict":"request_changes","summary":"no","blockers":[{"class":"agent_fixable","severity":"P1","file":"a.js","line":1,"issue":"x","suggestion":"y"}],"nonBlocking":[]}' > "$CLS_FX/v-block.json"
  printf '%s\n' '{"verdict":"request_changes","summary":"degenerate","blockers":[],"nonBlocking":[]}' > "$CLS_FX/v-degenerate.json"
  cls_expect_token "exit 0 with an approve verdict" APPROVE "$CLS_FX/chatter.jsonl" 0 "$CLS_FX/v-approve.json"
  cls_expect_token "exit 0 with a blocker" BLOCK "$CLS_FX/chatter.jsonl" 0 "$CLS_FX/v-block.json"
  cls_expect_token "exit 0 with request_changes and no blockers" INFRA_ERROR "$CLS_FX/chatter.jsonl" 0 "$CLS_FX/v-degenerate.json"
  cls_expect_token "exit 0 with no verdict file" INFRA_ERROR "$CLS_FX/chatter.jsonl" 0
}

#############################################################################
# TEST 83 — the shared helpers on their own [ADR-004 / ADR-005]: codex_failure_messages (the
#   structured failure events, one line each, optionally capped), codex_context_overflow (the
#   context signature test over the UNCAPPED lines) and codex_failure_reason (the one-line reason
#   both callers put in a summary). Each runs in a subshell with the wrapper sourced, so an
#   undefined helper (RED) is a FAIL, never an abort.
#############################################################################
cls_expect_lines() { # <label> <expected-file> <jsonl> — codex_failure_messages output == expected, byte for byte
  cls_call codex_failure_messages "$3" > "$SANDBOX/cls.unit"
  if cmp -s "$SANDBOX/cls.unit" "$2"; then
    pass "helper-messages: $1"
  else
    fail "helper-messages: $1: expected $(wc -c < "$2" | tr -d ' ') bytes ($(head -c 200 "$2" | tr '\n' '|')) got $(wc -c < "$SANDBOX/cls.unit" | tr -d ' ') bytes ($(head -c 200 "$SANDBOX/cls.unit" | tr '\n' '|'))"
  fi
}

cls_expect_overflow_rc() { # <label> <expected-rc> <jsonl> — codex_context_overflow's exit status
  local rc
  cls_call codex_context_overflow "$3" > /dev/null
  rc=$?
  if [ "$rc" -eq "$2" ]; then
    pass "helper-overflow: $1 -> exit $2"
  else
    fail "helper-overflow: $1: expected exit $2, got $rc (97 = the wrapper did not source or the helper is undefined)"
  fi
}

run_test_83() {
  local exp="$SANDBOX/cls83.expected" lenu lenc line1 reason rc

  # --- codex_failure_messages: the incident's TWO failure events (error + turn.failed), identical,
  #     the JSON API error unwrapped; the warning and the lifecycle lines contribute nothing ---
  printf '%s\n%s\n' "$CLS_LINE_400" "$CLS_LINE_400" > "$exp"
  cls_expect_lines "api_400.jsonl -> exactly two identical unwrapped lines '$CLS_LINE_400'" "$exp" "$CLS_FX/api_400.jsonl"
  printf 'HTTP 400 invalid_request_error context_length_exceeded: Input is too long for the requested model.\n%s\n' \
    'HTTP 400 invalid_request_error context_length_exceeded: Input is too long for the requested model.' > "$exp"
  cls_expect_lines "context_length.jsonl -> the code is kept in the line ('HTTP 400 <type> <code>: <message>')" "$exp" "$CLS_FX/context_length.jsonl"
  printf "You've hit your usage limit. Upgrade to Pro or try again later.\nYou've hit your usage limit. Upgrade to Pro or try again later.\n" > "$exp"
  cls_expect_lines "usage_limit.jsonl -> plain messages pass through unchanged" "$exp" "$CLS_FX/usage_limit.jsonl"
  printf "Codex ran out of room in the model's context window while reading the diff.\n" > "$exp"
  cls_expect_lines "error_only.jsonl -> the top-level error event's message, one line" "$exp" "$CLS_FX/error_only.jsonl"
  : > "$exp"
  cls_expect_lines "chatter.jsonl (agent text and command output) -> nothing" "$exp" "$CLS_FX/chatter.jsonl"
  cls_expect_lines "warning_context.jsonl (an item.completed of type error) -> nothing" "$exp" "$CLS_FX/warning_context.jsonl"
  cls_expect_lines "a missing file -> nothing" "$exp" "$CLS_FX/no-such.jsonl"
  cls_call codex_failure_messages "$CLS_FX/no-such.jsonl" > /dev/null
  rc=$?
  if [ "$rc" -eq 0 ]; then
    pass "helper-messages: a missing file is not an error (exit 0, so no caller aborts)"
  else
    fail "helper-messages: a missing file must exit 0, got $rc (97 = the wrapper did not source or the helper is undefined)"
  fi

  # --- long.jsonl: uncapped, ONE line, 1000+ characters, quotes and backslash kept, control
  #     characters turned into spaces ---
  cls_call codex_failure_messages "$CLS_FX/long.jsonl" > "$SANDBOX/cls83.long"
  lenu="$(jq -Rr 'length' "$SANDBOX/cls83.long" 2>/dev/null | tr '\n' ' ')"
  if [ "$(grep -c '' "$SANDBOX/cls83.long")" = "1" ] && [ "${lenu% }" -gt 1000 ] 2>/dev/null \
     && ! grep -q "$(printf '\t')" "$SANDBOX/cls83.long" \
     && grep -qF -- 'LONG-HEAD first line second line tabbed "double quotes" and back\slash then filler filler-0001 ' "$SANDBOX/cls83.long"; then
    pass "helper-messages: long.jsonl uncapped -> one line of $lenu characters, control characters became spaces, quotes and backslash intact"
  else
    fail "helper-messages: long.jsonl uncapped: expected ONE line > 1000 chars with no tab, got lines=$(grep -c '' "$SANDBOX/cls83.long") lengths='$lenu' :: $(head -c 200 "$SANDBOX/cls83.long")"
  fi
  # --- with cap 300: exactly the first 300 characters of the uncapped line, plus the ellipsis ---
  cls_call codex_failure_messages "$CLS_FX/long.jsonl" 300 > "$SANDBOX/cls83.cap"
  lenc="$(jq -Rr 'length' "$SANDBOX/cls83.cap" 2>/dev/null | tr '\n' ' ')"
  if [ "$(grep -c '' "$SANDBOX/cls83.cap")" = "1" ] && [ "${lenc% }" = "301" ] \
     && jq -ne --rawfile u "$SANDBOX/cls83.long" --rawfile c "$SANDBOX/cls83.cap" \
          '($u | rtrimstr("\n")) as $uu | ($c | rtrimstr("\n")) as $cc | $cc == ($uu[0:300] + "…")' >/dev/null 2>&1; then
    pass "helper-messages: long.jsonl with cap 300 -> the first 300 characters of the uncapped line plus '…' (301)"
  else
    fail "helper-messages: long.jsonl with cap 300: expected one line of 301 chars = uncapped[0:300] + '…', got lines=$(grep -c '' "$SANDBOX/cls83.cap") length='$lenc' :: $(head -c 200 "$SANDBOX/cls83.cap")"
  fi
  # a cap longer than the line leaves it alone (no ellipsis on a short message)
  cls_call codex_failure_messages "$CLS_FX/usage_limit.jsonl" 300 > "$SANDBOX/cls83.cap"
  line1="$(head -n 1 "$SANDBOX/cls83.cap")"
  if [ "$line1" = "You've hit your usage limit. Upgrade to Pro or try again later." ]; then
    pass "helper-messages: a message shorter than the cap is not cut and gets no '…'"
  else
    fail "helper-messages: a short message under cap 300 must be unchanged, got '$line1'"
  fi

  # --- codex_context_overflow: the signature test, over the UNCAPPED failure lines only ---
  cls_expect_overflow_rc "context_length.jsonl (the code)" 0 "$CLS_FX/context_length.jsonl"
  cls_expect_overflow_rc "overflow.jsonl (the stub's 'ran out of room ... context window')" 0 "$CLS_FX/overflow.jsonl"
  cls_expect_overflow_rc "error_only.jsonl (a top-level error event, no turn.failed)" 0 "$CLS_FX/error_only.jsonl"
  cls_expect_overflow_rc "long_context.jsonl (signature past char 300)" 0 "$CLS_FX/long_context.jsonl"
  cls_expect_overflow_rc "api_400.jsonl (a 400 that is not a context failure)" 1 "$CLS_FX/api_400.jsonl"
  cls_expect_overflow_rc "usage_limit.jsonl" 1 "$CLS_FX/usage_limit.jsonl"
  cls_expect_overflow_rc "chatter.jsonl (agent text and command output about the context window)" 1 "$CLS_FX/chatter.jsonl"
  cls_expect_overflow_rc "warning_context.jsonl (a warning item about the context window)" 1 "$CLS_FX/warning_context.jsonl"
  cls_expect_overflow_rc "a missing file" 1 "$CLS_FX/no-such.jsonl"

  # --- codex_failure_reason <jsonl> <exit> <stderr> <verdict>: the three shapes of a reason ---
  reason="$(cls_call codex_failure_reason "$CLS_FX/api_400.jsonl" 1 /dev/null "$CLS_FX/v.json")"
  if [ "$reason" = "codex turn failed (exit 1): $CLS_LINE_400 — see $CLS_FX/api_400.jsonl" ]; then
    pass "helper-reason: a failure event -> 'codex turn failed (exit N): <unwrapped API error> — see <jsonl>'"
  else
    fail "helper-reason: api_400 expected 'codex turn failed (exit 1): $CLS_LINE_400 — see $CLS_FX/api_400.jsonl', got '$reason'"
  fi
  reason="$(cls_call codex_failure_reason "$CLS_FX/chatter.jsonl" 1 "$CLS_FX/the.stderr" "$CLS_FX/v.json")"
  if [ "$reason" = "codex exited nonzero (1); see $CLS_FX/the.stderr" ]; then
    pass "helper-reason: no failure event, nonzero exit -> 'codex exited nonzero (N); see <stderr>'"
  else
    fail "helper-reason: chatter + exit 1 expected 'codex exited nonzero (1); see $CLS_FX/the.stderr', got '$reason'"
  fi
  reason="$(cls_call codex_failure_reason "$CLS_FX/chatter.jsonl" 0 "$CLS_FX/the.stderr" "$CLS_FX/v.json")"
  if [ "$reason" = "no usable verdict ($CLS_FX/v.json)" ]; then
    pass "helper-reason: no failure event, exit 0 -> 'no usable verdict (<verdict>)'"
  else
    fail "helper-reason: chatter + exit 0 expected 'no usable verdict ($CLS_FX/v.json)', got '$reason'"
  fi
  # a ZERO exit never reads failure events: real Codex logs top-level "Reconnecting... N/5" errors inside turns
  # that then complete normally, so with exit 0 they are noise and the reason is still the unusable verdict
  reason="$(cls_call codex_failure_reason "$CLS_FX/reconnect_ok.jsonl" 0 x /some/verdict.json)"
  if [ "$reason" = "no usable verdict (/some/verdict.json)" ]; then
    pass "helper-reason: reconnect error events in a completed turn, exit 0 -> exactly 'no usable verdict (<verdict>)', never 'codex turn failed'"
  else
    fail "helper-reason: reconnect_ok.jsonl + exit 0 expected exactly 'no usable verdict (/some/verdict.json)', got '$(printf '%s' "$reason" | head -c 300)'"
  fi
  # two failure events with DIFFERENT messages: the reason is the LAST one (ADR-005; the real events repeat
  # one message, so only this fixture can tell the last line from the first)
  reason="$(cls_call codex_failure_reason "$CLS_FX/two_messages.jsonl" 1 /dev/null "$CLS_FX/v.json")"
  if printf '%s' "$reason" | grep -qF -- 'LAST-MSG model not supported' && ! printf '%s' "$reason" | grep -qF -- 'FIRST-MSG'; then
    pass "helper-reason: with two different failure messages the reason carries the LAST one (LAST-MSG), not the first"
  else
    fail "helper-reason: two_messages.jsonl expected a reason with 'LAST-MSG model not supported' and no 'FIRST-MSG', got '$(printf '%s' "$reason" | head -c 300)'"
  fi
  reason="$(cls_call codex_failure_reason "$CLS_FX/long.jsonl" 1 /dev/null "$CLS_FX/v.json")"
  if printf '%s' "$reason" | jq -Rre --arg p "$CLS_FX/long.jsonl" \
       'capture("^codex turn failed \\(exit 1\\): (?<m>.*) — see (?<f>.*)$") | (.m | length == 301 and endswith("…")) and (.f == $p)' >/dev/null 2>&1; then
    pass "helper-reason: the reason caps the API message at 300 characters + '…'"
  else
    fail "helper-reason: long.jsonl expected a 301-char message part ending in '…', got '$(printf '%s' "$reason" | head -c 200)'"
  fi
}

#############################################################################
# TESTS 84-90 — a malformed `blockers`, or an unknown fan-out aggregate, can never approve
#   [fail-closed guards: ADR-002 / ADR-003, PDR criteria 1-4]
#   verdict.schema.json requires `blockers` and types it as an array. The wrapper counted
#   `(.blockers // []) | length`, so a boolean, a number, an object, null or a missing key counted
#   as ZERO blockers and an `approve` verdict approved. The rule now: a `blockers` that is not an
#   array is an INCONSISTENT verdict, INFRA_ERROR, in every classifier:
#     - emit_outcome (plan, bundle, phase-review, prepr, prepr-delta): the summary starts
#       `inconsistent verdict: blockers is <jq type>, not an array (` and no ledger line is written;
#     - classify_verdict_file (one shard or lens job): INFRA_ERROR, so the job's reason reads
#       `no usable verdict (<path>)` and, with no BLOCK job, the aggregate is INFRA_ERROR.
#   The two fan-out emitters (shard_and_review, multi_lens_review) approve only when the aggregate
#   is exactly APPROVE: any other FAN_OUTCOME (WEIRD, empty) is an INFRA_ERROR in the BASE status
#   shape (no shards[] / lenses[]) naming the value, with no ledger line. In multi_lens_review the guard
#   runs BEFORE the coverage-gap check (ADR-003), so a forced gap with a WEIRD aggregate is still an
#   INFRA_ERROR naming the value, never the coverage OVERFLOW.
#   The `FAN_OUTCOME=""` reset at the top of fan_out_and_aggregate is not observable through these tests:
#   every return path of that function sets FAN_OUTCOME, and the shadow (bad_run_shadow) replaces the whole
#   function. The reset is defensive.
#   Stub mode: approve_bad_blockers + STUB_BLOCKERS_JSON (raw JSON text, or MISSING).
#
#   Shared plumbing for 84-90 (on top of cls_run / cls_run_mode / cls_shard_repo / cls_multi_repo):
#     BAD_SHAPES                         a bash array of "<raw blockers JSON>:<jq type>" entries, one per
#                                        shape that must fail. Split an entry on its LAST colon
#                                        (raw="${spec%:*}"; typ="${spec##*:}"): the raw JSON may itself
#                                        contain colons ({"a":1}), the jq type never does
#     bad_seed <repo> [NAME=value ...] -- <wrapper-arg>...
#                                        ONE clean approve run first: it writes the review ledger's
#                                        baseline (BAD_LEDGER0), so "no new ledger line" is a before/after
#                                        comparison and not an absent file nobody could find
#     bad_ledger_lines <status-json>     the line count of the worktree ledger beside the status' runDir
#                                        (the lookup TEST 25 does: <wtkey>/ledger.jsonl), "NA" when no runDir is named
#     bad_ledger_unchanged <baseline>    the seed approved, the baseline is <baseline>, the run under test
#                                        left the count where it was (it first sets BAD_LEDGER1 from
#                                        CLS_STATUS, so call it right after the run; bad_diag shows it). Only the
#                                        single-thread and sharded runs use it: a multi-lens run never
#                                        writes a ledger line, so those cases take no seed and check that
#                                        the count after the run is 0
#     bad_job_verdict_approve_true <status-json> <shard|lens>
#                                        at least one per-job verdict file in the status' runDir
#                                        (<shard|lens>-*-verdict.json) holds verdict approve with
#                                        blockers == true: the stub's verdict is the cause of the INFRA_ERROR
#     bad_diag                           cls_diag + the ledger counts: the line every FAIL carries
#     bad_run_shadow <repo> <fan-outcome> [NAME=value ...] -- <wrapper-arg>...
#                                        the REAL `main`, end to end, with fan_out_and_aggregate shadowed
#                                        so it sets FAN_OUTCOME to <fan-outcome> and calls no Codex; fills
#                                        the same CLS_* variables cls_run does
#############################################################################
BAD_SHAPES=('true:boolean' 'false:boolean' '0:number' '{}:object' 'null:null' '"x":string' 'MISSING:null')
BAD_OBJ_BLOCKER='[{"class":"agent_fixable","severity":"P1","file":"a.js","line":1,"issue":"x","suggestion":"y"}]'
BAD_SEED_OK=1; BAD_LEDGER0="NA"; BAD_LEDGER1="NA"

# The shadow driver. `bash -c` sources the wrapper, REDEFINES fan_out_and_aggregate, then runs the real
# main. The wrapper's main guard compares BASH_SOURCE[0] with $0: $0 is the `./` spelling and the sourced
# path ($WRAPPER) is not, so sourcing never auto-runs main, yet SKILL_DIR (dirname of $0) still resolves to
# the skill directory. The shadow sets every FAN_* output the two callers read, and calls no Codex.
# A driver that cannot get that far fails with a cause on stderr (cls_diag shows its head): __SOURCEFAIL__
# when sourcing the wrapper failed, __NOFUNC__ when the wrapper no longer defines fan_out_and_aggregate
# (so the shadow would define a function nothing calls); both exit 97.
BAD_SHADOW_SCRIPT='
src="$1"; shift
. "$src" || { echo __SOURCEFAIL__ >&2; exit 97; }
[ "$(type -t fan_out_and_aggregate)" = function ] || { echo __NOFUNC__ >&2; exit 97; }
fan_out_and_aggregate() {
  FAN_OUTCOME="${FANSHADOW_OUTCOME-}"
  FAN_N_JOBS=1
  FAN_TOTAL_FILES=3
  FAN_JOBS_JSON="[]"
  FAN_BLOCKERS=0; FAN_AGENT_FIXABLE=0; FAN_DECISION_BLOCKERS=0
  FAN_FIRST_INCONCLUSIVE=""; FAN_FIRST_INFRA=""; FAN_INFRA_REASON=""
  return 0
}
main "$@"
'

bad_ledger_lines() { # <status-json>
  local rd ledger n
  rd="$(printf '%s' "$1" | jq -r '.runDir // empty' 2>/dev/null)"
  [ -n "$rd" ] || { printf 'NA'; return 0; }
  ledger="$(dirname "$(dirname "$rd")")/ledger.jsonl"
  if [ -f "$ledger" ]; then
    n="$(grep -c '' "$ledger" 2>/dev/null)"; [ -n "$n" ] || n=0
    printf '%s' "$n"
  else
    printf '0'
  fi
}

bad_seed() { # <repo> [NAME=value ...] -- <wrapper-arg>...
  local repo="$1"
  shift
  cls_run "$repo" approve "$@"
  BAD_SEED_OK=1
  [ "$CLS_OUTCOME" = "APPROVE" ] && BAD_SEED_OK=0
  BAD_LEDGER0="$(bad_ledger_lines "$CLS_STATUS")"
  BAD_LEDGER1="NA"
}

bad_ledger_unchanged() { # <baseline> — call right after the run under test; first sets BAD_LEDGER1 from CLS_STATUS
  BAD_LEDGER1="$(bad_ledger_lines "$CLS_STATUS")"            # global on purpose: bad_diag reads it
  [ "$BAD_SEED_OK" -eq 0 ] && [ "$BAD_LEDGER0" = "$1" ] && [ "$BAD_LEDGER1" = "$BAD_LEDGER0" ]
}

bad_job_verdict_approve_true() { # <status-json> <shard|lens> — see the header: the cause, read straight from the run dir
  local rd f
  rd="$(printf '%s' "$1" | jq -r '.runDir // empty' 2>/dev/null)"
  [ -n "$rd" ] || return 1
  for f in "$rd/$2"-*-verdict.json; do
    [ -f "$f" ] || continue                                 # an unmatched glob stays a literal pattern: skip it
    jq -e '.verdict == "approve" and .blockers == true' "$f" >/dev/null 2>&1 && return 0
  done
  return 1
}

bad_summary_starts() { # <prefix> — the status summary begins with <prefix> (literal, no pattern characters)
  case "$CLS_SUMMARY" in "$1"*) return 0 ;; esac
  return 1
}

bad_diag() {
  printf '%s :: ledger lines: after the seed run=%s, after the run under test=%s (seed approved: %s)' \
    "$(cls_diag)" "$BAD_LEDGER0" "$BAD_LEDGER1" "$([ "$BAD_SEED_OK" -eq 0 ] && echo yes || echo NO)"
}

bad_run_shadow() { # <repo> <fan-outcome> [NAME=value ...] -- <wrapper-arg>...
  local repo="$1" fo="$2"
  local -a ew aw
  shift 2
  ew=(FANSHADOW_OUTCOME="$fo")     # never empty under bash 3.2 `set -u`; the value may be the empty string
  aw=()
  while [ $# -gt 0 ] && [ "$1" != "--" ]; do ew[${#ew[@]}]="$1"; shift; done
  [ $# -gt 0 ] && shift
  while [ $# -gt 0 ]; do aw[${#aw[@]}]="$1"; shift; done
  reset_argv_log
  ( cd "$repo" && env STUB_MODE=approve "${ew[@]}" bash -c "$BAD_SHADOW_SCRIPT" "$TEST_DIR/./codex-gate.sh" "$WRAPPER" "${aw[@]}" ) \
    > "$SANDBOX/cls.out" 2> "$SANDBOX/cls.err"
  cls_collect
}

#############################################################################
# TEST 84 — the approve_bad_blockers stub arm is what the other tests say it is.
#   A stub that coerced the value, dropped the key for the wrong word, or exited nonzero would make
#   every test below pass or fail for a reason that has nothing to do with the wrapper: pin the
#   premise here, wrapper-free. Each shape arrives byte for byte; MISSING omits the key; an unset
#   STUB_BLOCKERS_JSON means [] (the unchanged-behavior control).
#############################################################################
run_test_84() {
  local spec raw typ rc ok=0 o="$SANDBOX/bad84.o"
  for spec in "${BAD_SHAPES[@]}" '[]:array'; do
    raw="${spec%:*}"; typ="${spec##*:}"
    rm -f "$o"
    printf 'packet\n' | env STUB_MODE=approve_bad_blockers STUB_BLOCKERS_JSON="$raw" "$STUB_DIR/codex" -o "$o" > "$SANDBOX/bad84.stdout" 2>/dev/null
    rc=$?
    if [ "$raw" = "MISSING" ]; then
      if [ "$rc" -eq 0 ] && jq -e '.verdict == "approve" and (has("blockers") | not) and (.nonBlocking == [])' "$o" >/dev/null 2>&1; then :; else
        ok=1; fail "stub-arm: approve_bad_blockers + STUB_BLOCKERS_JSON=MISSING must write an approve verdict WITHOUT a blockers key and exit 0 (rc=$rc) :: $(head -c 300 "$o" 2>&1)"
      fi
    else
      if [ "$rc" -eq 0 ] && jq -e --arg t "$typ" '.verdict == "approve" and has("blockers") and ((.blockers | type) == $t)' "$o" >/dev/null 2>&1 \
         && [ "$(jq -c '.blockers' "$o" 2>/dev/null)" = "$raw" ]; then :; else
        ok=1; fail "stub-arm: approve_bad_blockers + STUB_BLOCKERS_JSON=$raw must write an approve verdict whose blockers is exactly $raw (a $typ) and exit 0 (rc=$rc) :: $(head -c 300 "$o" 2>&1)"
      fi
    fi
  done
  [ "$ok" -eq 0 ] && pass "stub-arm: approve_bad_blockers writes an approve verdict whose blockers is exactly true / false / 0 / {} / null / \"x\" / [] (raw), or no blockers key for MISSING, and exits 0"
  rm -f "$o"
  printf 'packet\n' | env -u STUB_BLOCKERS_JSON STUB_MODE=approve_bad_blockers "$STUB_DIR/codex" -o "$o" > "$SANDBOX/bad84.stdout" 2>/dev/null
  rc=$?
  if [ "$rc" -eq 0 ] && jq -e '.verdict == "approve" and .blockers == []' "$o" >/dev/null 2>&1; then
    pass "stub-arm: approve_bad_blockers with STUB_BLOCKERS_JSON unset writes an approve verdict with blockers []"
  else
    fail "stub-arm: approve_bad_blockers with STUB_BLOCKERS_JSON unset must write an approve verdict with blockers [] and exit 0 (rc=$rc) :: $(head -c 300 "$o" 2>&1)"
  fi
  reset_argv_log
}

#############################################################################
# TEST 85 — every bad shape through UNSHARDED prepr [ADR-002; PDR 1]: `approve` + a `blockers` that
#   is not an array is an INFRA_ERROR, never APPROVE. The summary names the jq type; exactly one
#   stub call ran; and the ledger line count is where a clean approve left it. RED: six shapes APPROVE
#   (and write a ledger line), "x" is BLOCK (one string = one blocker). Controls (already green):
#   approve + [] is APPROVE, and approve + one object blocker is BLOCK.
#############################################################################
run_test_85() {
  local spec raw typ repo ok
  for spec in "${BAD_SHAPES[@]}"; do
    raw="${spec%:*}"; typ="${spec##*:}"; ok=0
    repo="$(bin_repo)"
    bad_seed "$repo" -- prepr
    cls_run "$repo" approve_bad_blockers STUB_BLOCKERS_JSON="$raw" -- prepr
    [ "$CLS_OUTCOME" = "INFRA_ERROR" ] || ok=1
    bad_summary_starts "inconsistent verdict: blockers is $typ, not an array (" || ok=1
    [ "$CLS_NCALLS" -eq 1 ] || ok=1                         # the stub really produced the verdict, once
    bad_ledger_unchanged 1 || ok=1                          # the seed wrote ONE line; the bad run added none
    if [ "$ok" -eq 0 ]; then
      pass "bad-blockers: prepr + approve with blockers=$raw -> INFRA_ERROR 'inconsistent verdict: blockers is $typ, not an array (...)', ledger unchanged"
    else
      fail "bad-blockers: prepr + approve with blockers=$raw: expected INFRA_ERROR whose summary starts 'inconsistent verdict: blockers is $typ, not an array (' with exactly 1 call and the ledger unchanged at 1 line, got $(bad_diag)"
    fi
  done

  # control: approve + [] is still an APPROVE (the stub arm itself does not distort a good verdict)
  repo="$(bin_repo)"
  cls_run "$repo" approve_bad_blockers STUB_BLOCKERS_JSON='[]' -- prepr
  if [ "$CLS_OUTCOME" = "APPROVE" ] && [ "$CLS_NCALLS" -eq 1 ]; then
    pass "bad-blockers: control, prepr + approve with blockers=[] -> APPROVE"
  else
    fail "bad-blockers: control, prepr + approve with blockers=[] must still be APPROVE with 1 call, got $(cls_diag)"
  fi
  # control: approve + one OBJECT blocker is still a BLOCK (one blocker, an agent-fixable one)
  repo="$(bin_repo)"
  cls_run "$repo" approve_bad_blockers STUB_BLOCKERS_JSON="$BAD_OBJ_BLOCKER" -- prepr
  if [ "$CLS_OUTCOME" = "BLOCK" ] && printf '%s' "$CLS_STATUS" | jq -e '.blockers == 1 and .agentFixableBlockers == 1' >/dev/null 2>&1; then
    pass "bad-blockers: control, prepr + approve with one object blocker -> BLOCK (1 blocker, 1 agent-fixable)"
  else
    fail "bad-blockers: control, prepr + approve with one object blocker must still be BLOCK (blockers=1, agentFixableBlockers=1), got $(cls_diag)"
  fi
}

#############################################################################
# TEST 86 — the same inconsistent verdict in the other review modes [ADR-002; PDR 1]: `true` through
#   `plan`, `bundle` and `phase-review` (all three run at the code tier here, because cls_run_mode
#   executes them inside a Git fixture; `phase-review` also reviews a phase diff) is an
#   INFRA_ERROR with the same summary prefix. They share emit_outcome with prepr; this pins that
#   the check sits in the shared emitter and not in one mode's wrapper code. `prepr-delta` (named by
#   PDR criterion 1) gets its own case: a clean approve seeds the ledger with one line, the reviewed
#   file then changes so the delta is NOT empty (an empty delta short-circuits to a synthetic approve
#   and never reaches emit_outcome), and the bad verdict must leave the ledger at that one line.
#   RED: all APPROVE (and prepr-delta adds a second ledger line).
#############################################################################
run_test_86() {
  local m ok repo
  for m in plan bundle phase-review; do
    ok=0
    cls_run_mode "$m" approve_bad_blockers STUB_BLOCKERS_JSON=true
    [ "$CLS_OUTCOME" = "INFRA_ERROR" ] || ok=1
    bad_summary_starts "inconsistent verdict: blockers is boolean, not an array (" || ok=1
    [ "$CLS_NCALLS" -ge 1 ] || ok=1
    if [ "$ok" -eq 0 ]; then
      pass "bad-blockers: $m + approve with blockers=true -> INFRA_ERROR 'inconsistent verdict: blockers is boolean, not an array (...)'"
    else
      fail "bad-blockers: $m + approve with blockers=true: expected INFRA_ERROR whose summary starts 'inconsistent verdict: blockers is boolean, not an array (' (at least 1 call), got $(cls_diag)"
    fi
  done

  # prepr-delta: seed ONE clean approve (the ledger now holds the reviewed change.js), change that file so
  # the delta has an unreviewed change, then run prepr-delta with the bad verdict (the stub is called once)
  ok=0
  repo="$(bin_repo)"
  bad_seed "$repo" -- prepr
  printf 'export const X=2;\n' > "$repo/change.js"
  cls_run "$repo" approve_bad_blockers STUB_BLOCKERS_JSON=true -- prepr-delta
  [ "$CLS_OUTCOME" = "INFRA_ERROR" ] || ok=1
  bad_summary_starts "inconsistent verdict: blockers is boolean, not an array (" || ok=1
  [ "$CLS_NCALLS" -eq 1 ] || ok=1                           # the delta was not empty: the stub really produced the verdict
  bad_ledger_unchanged 1 || ok=1                            # the seed wrote ONE line; the bad prepr-delta added none
  if [ "$ok" -eq 0 ]; then
    pass "bad-blockers: prepr-delta (unreviewed change) + approve with blockers=true -> INFRA_ERROR 'inconsistent verdict: blockers is boolean, not an array (...)', ledger unchanged"
  else
    fail "bad-blockers: prepr-delta (unreviewed change) + approve with blockers=true: expected INFRA_ERROR whose summary starts 'inconsistent verdict: blockers is boolean, not an array (' with exactly 1 call and the ledger unchanged at 1 line, got $(bad_diag)"
  fi
}

#############################################################################
# TEST 87 — classify_verdict_file on its own [ADR-002]: `classify_verdict_file <verdict> <jsonl> 0`
#   (the wrapper sourced in a subshell) prints exactly ONE token. Every bad shape is INFRA_ERROR;
#   approve + [] is APPROVE and approve + one object blocker is BLOCK (the two unchanged controls).
#   RED: six shapes print APPROVE, "x" prints BLOCK.
#############################################################################
run_test_87() {
  local spec raw typ vf n=0
  for spec in "${BAD_SHAPES[@]}"; do
    raw="${spec%:*}"; typ="${spec##*:}"
    n=$((n + 1))
    vf="$CLS_FX/v-bad-blockers-$n.json"
    if [ "$raw" = "MISSING" ]; then
      printf '%s\n' '{"verdict":"approve","summary":"s","nonBlocking":[]}' > "$vf"
    else
      printf '{"verdict":"approve","summary":"s","blockers":%s,"nonBlocking":[]}\n' "$raw" > "$vf"
    fi
    cls_expect_token "an approve verdict whose blockers is $([ "$raw" = "MISSING" ] && echo 'MISSING (key absent)' || echo "$raw ($typ)")" INFRA_ERROR "$CLS_FX/chatter.jsonl" 0 "$vf"
  done
  printf '%s\n' '{"verdict":"approve","summary":"s","blockers":[],"nonBlocking":[]}' > "$CLS_FX/v-bad-ctl-approve.json"
  printf '{"verdict":"approve","summary":"s","blockers":%s,"nonBlocking":[]}\n' "$BAD_OBJ_BLOCKER" > "$CLS_FX/v-bad-ctl-block.json"
  cls_expect_token "control: approve + blockers [] (an empty array)" APPROVE "$CLS_FX/chatter.jsonl" 0 "$CLS_FX/v-bad-ctl-approve.json"
  cls_expect_token "control: approve + one object blocker" BLOCK "$CLS_FX/chatter.jsonl" 0 "$CLS_FX/v-bad-ctl-block.json"
}

#############################################################################
# TEST 88 — sharded [ADR-002; PDR 2]: TEST 31's three-file repo, budget 9000, every shard's stub call
#   writes approve + blockers=true. Each shard job is classified INFRA_ERROR (its reason is
#   `no usable verdict (<its verdict path>)`), so the aggregate is INFRA_ERROR, never APPROVE; the
#   summary names a shard; and the ledger count stays where a clean sharded approve left it.
#   RED: every shard APPROVEs, the aggregate APPROVEs and the ledger grows by a line.
#############################################################################
run_test_88() {
  local repo ok=0
  repo="$(cls_shard_repo SHARD-BADBLK-MARK)"
  bad_seed "$repo" CODEX_GATE_PACKET_BUDGET=9000 CODEX_GATE_SHARD=auto -- prepr
  cls_run "$repo" approve_bad_blockers CODEX_GATE_PACKET_BUDGET=9000 CODEX_GATE_SHARD=auto STUB_BLOCKERS_JSON=true -- prepr
  [ "$CLS_OUTCOME" = "INFRA_ERROR" ] || ok=1
  bad_summary_starts "shard " || ok=1
  cls_summary_has 'failed: no usable verdict (' || ok=1
  [ "$CLS_NCALLS" -eq 3 ] || ok=1                           # all three shards really ran and returned the bad verdict
  bad_ledger_unchanged 1 || ok=1
  if [ "$ok" -eq 0 ]; then
    pass "bad-blockers-sharded: every shard approves with blockers=true -> aggregate INFRA_ERROR 'shard <g> failed: no usable verdict (...)', ledger unchanged"
  else
    fail "bad-blockers-sharded: expected INFRA_ERROR whose summary starts 'shard ' and contains 'failed: no usable verdict (' after 3 calls, the ledger unchanged at 1 line, got $(bad_diag)"
  fi
  # each shard job is itself INFRA_ERROR (the classifier, not only the aggregate, refuses the shape)
  if printf '%s' "$CLS_STATUS" | jq -e '(.shards | length == 3) and all(.shards[]; .outcome == "INFRA_ERROR")' >/dev/null 2>&1; then
    pass "bad-blockers-sharded: shards[] has three entries, all INFRA_ERROR"
  else
    fail "bad-blockers-sharded: expected shards[] with three entries, all INFRA_ERROR, got shards=$(printf '%s' "$CLS_STATUS" | jq -c '(.shards // []) | map({(.group): .outcome}) | add' 2>/dev/null) :: $(cls_diag)"
  fi
  # the cause, read straight from the run dir: at least one shard-*-verdict.json IS an approve with blockers=true
  if bad_job_verdict_approve_true "$CLS_STATUS" shard; then
    pass "bad-blockers-sharded: the run dir holds a shard-*-verdict.json with verdict approve and blockers=true (the stub's verdict is the cause)"
  else
    fail "bad-blockers-sharded: expected at least one shard-*-verdict.json in the run dir with verdict approve and blockers == true, runDir=$(printf '%s' "$CLS_STATUS" | jq -r '.runDir // "none"' 2>/dev/null) :: $(cls_diag)"
  fi
}

#############################################################################
# TEST 89 — multi-lens [ADR-002; PDR 2]: `prepr --multi` where every lens writes approve +
#   blockers=true. Every lens job is INFRA_ERROR, the aggregate is INFRA_ERROR, never APPROVE; the
#   summary names a lens and the job's reason. RED: every lens APPROVEs.
#############################################################################
run_test_89() {
  local repo ok=0
  repo="$(cls_multi_repo MULTI-LENS-BADBLK-MARK)"
  cls_run "$repo" approve_bad_blockers STUB_BLOCKERS_JSON=true -- prepr --multi
  [ "$CLS_OUTCOME" = "INFRA_ERROR" ] || ok=1
  bad_summary_starts "lens " || ok=1
  cls_summary_has 'failed: no usable verdict (' || ok=1
  [ "$CLS_NCALLS" -ge 2 ] || ok=1                           # a real fan-out: several (stub) calls, each returning the bad verdict
  if [ "$ok" -eq 0 ]; then
    pass "bad-blockers-multi: every lens approves with blockers=true -> aggregate INFRA_ERROR 'lens <l> failed: no usable verdict (...)'"
  else
    fail "bad-blockers-multi: expected INFRA_ERROR whose summary starts 'lens ' and contains 'failed: no usable verdict (' after at least 2 calls, got $(cls_diag)"
  fi
  if printf '%s' "$CLS_STATUS" | jq -e '(.lenses | length >= 2) and all(.lenses[]; .outcome == "INFRA_ERROR")' >/dev/null 2>&1; then
    pass "bad-blockers-multi: lenses[] has at least two entries, all INFRA_ERROR"
  else
    fail "bad-blockers-multi: expected lenses[] with at least two entries, all INFRA_ERROR, got lenses=$(printf '%s' "$CLS_STATUS" | jq -c '(.lenses // []) | map({(.lens): .outcome}) | add' 2>/dev/null) :: $(cls_diag)"
  fi
  # the cause, read straight from the run dir: at least one lens-*-verdict.json IS an approve with blockers=true
  if bad_job_verdict_approve_true "$CLS_STATUS" lens; then
    pass "bad-blockers-multi: the run dir holds a lens-*-verdict.json with verdict approve and blockers=true (the stub's verdict is the cause)"
  else
    fail "bad-blockers-multi: expected at least one lens-*-verdict.json in the run dir with verdict approve and blockers == true, runDir=$(printf '%s' "$CLS_STATUS" | jq -r '.runDir // "none"' 2>/dev/null) :: $(cls_diag)"
  fi
}

#############################################################################
# TEST 90 — an unknown aggregate outcome never approves [ADR-003; PDR 3]: the REAL `main prepr`
#   (TEST 31's sharded setup) and `main prepr --multi`, end to end, with fan_out_and_aggregate
#   shadowed (bad_run_shadow) so FAN_OUTCOME is `WEIRD`, then empty. Each emitter must answer
#   INFRA_ERROR in the BASE status shape (no shards[], no lenses[]) with a summary that names the
#   value, call no Codex (the shadow replaced the fan-out), and write no ledger line. The control
#   shadow sets APPROVE: the emitter approves, which proves the driver reaches the real emitter
#   and that the other cases fail for the aggregate value and for nothing else. The sharded cases seed
#   one clean approve so "no ledger line" is a before/after comparison; a multi-lens run never writes a
#   ledger line, so those cases take no seed and check that no ledger line exists. One more multi-lens
#   case forces a coverage gap (CODEX_GATE_FORCE_UNREVIEWED=1) under a WEIRD aggregate: the guard must
#   answer first (ADR-003), so the status is the guard's INFRA_ERROR, not the coverage OVERFLOW.
#   RED: `WEIRD` and empty both fall through to the APPROVE emitter (and, with a forced gap, to OVERFLOW).
#############################################################################
bad_expect_unknown_agg() { # <label> <emitter prefix> <value> <ledger baseline|NONE> — call right after bad_run_shadow
  # <ledger baseline> is the line count the seed run left (single-thread / sharded: the run under test must
  # leave it there). NONE is the multi-lens form: a lens run never writes a ledger line, so no seed ran and
  # the count after the run must be 0.
  local ok=0 ledger_say ledger_got
  [ "$CLS_OUTCOME" = "INFRA_ERROR" ] || ok=1                # never APPROVE
  bad_summary_starts "$2: unexpected aggregate outcome '$3'" || ok=1
  cls_summary_has 'refusing to approve' || ok=1
  cls_summary_one_line || ok=1
  [ "$CLS_NCALLS" -eq 0 ] || ok=1                           # the shadow ran, not the real fan-out
  printf '%s' "$CLS_STATUS" | jq -e '(has("shards") | not) and (has("lenses") | not)' >/dev/null 2>&1 || ok=1   # the BASE shape
  if [ "$4" = "NONE" ]; then
    BAD_LEDGER1="$(bad_ledger_lines "$CLS_STATUS")"         # no seed, so bad_ledger_unchanged is not called here
    [ "$BAD_LEDGER1" = "0" ] || ok=1
    ledger_say="no ledger line written (multi-lens never writes one)"
    ledger_got="ledger lines after the run=$BAD_LEDGER1 (must be 0)"
  else
    bad_ledger_unchanged "$4" || ok=1
    ledger_say="ledger unchanged"
    ledger_got="ledger lines: after the seed run=$BAD_LEDGER0, after the run under test=$BAD_LEDGER1, expected unchanged at $4 (seed approved: $([ "$BAD_SEED_OK" -eq 0 ] && echo yes || echo NO))"
  fi
  if [ "$ok" -eq 0 ]; then
    pass "unknown-aggregate: $1 -> INFRA_ERROR \"$2: unexpected aggregate outcome '$3' ...\" in the base shape, no Codex call, $ledger_say"
  else
    fail "unknown-aggregate: $1: expected INFRA_ERROR whose one-line summary starts \"$2: unexpected aggregate outcome '$3'\" and contains 'refusing to approve' (0 calls, no shards[] / lenses[], $ledger_say), got $(cls_diag) :: $ledger_got :: status keys: $(printf '%s' "$CLS_STATUS" | jq -c 'keys' 2>/dev/null)"
  fi
}

bad_expect_shadow_control() { # <label> <summary text an approve carries> — call right after bad_run_shadow with APPROVE
  if [ "$CLS_OUTCOME" = "APPROVE" ] && [ "$CLS_NCALLS" -eq 0 ] && cls_summary_has "$2"; then
    pass "unknown-aggregate: control, $1 with the shadow setting APPROVE -> APPROVE ('$2', no Codex call): the driver reaches the real emitter"
  else
    fail "unknown-aggregate: control, $1 with the shadow setting APPROVE must be APPROVE with a summary containing '$2' and 0 calls, got $(cls_diag) (hint: calls > 0 means sourcing ran main itself: did the BASH_SOURCE[0]/\$0 guard near the end of codex-gate.sh change? __SOURCEFAIL__ / __NOFUNC__ in the stderr above mean the driver never reached main)"
  fi
}

run_test_90() {
  local repo shard_env_a="CODEX_GATE_PACKET_BUDGET=9000" shard_env_b="CODEX_GATE_SHARD=auto" fo label
  # --- shard_and_review ---
  repo="$(cls_shard_repo SHARD-WEIRD-MARK)"
  bad_run_shadow "$repo" APPROVE "$shard_env_a" "$shard_env_b" -- prepr
  bad_expect_shadow_control "sharded prepr" "sharded review: 1 shards all approved"
  for fo in WEIRD ""; do
    repo="$(cls_shard_repo SHARD-WEIRD-MARK)"
    bad_seed "$repo" "$shard_env_a" "$shard_env_b" -- prepr
    bad_run_shadow "$repo" "$fo" "$shard_env_a" "$shard_env_b" -- prepr
    label="sharded prepr, aggregate FAN_OUTCOME='$fo'"
    bad_expect_unknown_agg "$label" "sharded review" "$fo" 1
  done
  # --- multi_lens_review: a lens run never writes a ledger line, so there is no seed run and no baseline:
  #     the ledger check is "no ledger line written" (the count after the run is 0) ---
  repo="$(cls_multi_repo MULTI-LENS-WEIRD-MARK)"
  bad_run_shadow "$repo" APPROVE -- prepr --multi
  bad_expect_shadow_control "prepr --multi" "lenses all approved"
  for fo in WEIRD ""; do
    repo="$(cls_multi_repo MULTI-LENS-WEIRD-MARK)"
    bad_run_shadow "$repo" "$fo" -- prepr --multi
    label="prepr --multi, aggregate FAN_OUTCOME='$fo'"
    bad_expect_unknown_agg "$label" "multi-lens review" "$fo" NONE
  done
  # --- ordering (ADR-003): the multi-lens guard runs BEFORE the coverage-gap check. CODEX_GATE_FORCE_UNREVIEWED
  #     (the test seam TEST 47 uses) forces a gap; with a WEIRD aggregate the answer must still be the guard's
  #     INFRA_ERROR naming WEIRD. A guard placed after the coverage check answers OVERFLOW ('coverage gap: ...')
  #     here, and the base-shape and summary checks fail with it ---
  repo="$(cls_multi_repo MULTI-LENS-WEIRD-MARK)"
  bad_run_shadow "$repo" WEIRD CODEX_GATE_FORCE_UNREVIEWED=1 -- prepr --multi
  bad_expect_unknown_agg "prepr --multi with a forced coverage gap, FAN_OUTCOME='WEIRD'" "multi-lens review" WEIRD NONE
}

#############################################################################
# run everything
#############################################################################
printf '======== codex-gate.test.sh ========\n'
if [ ! -f "$WRAPPER" ]; then
  printf 'NOTE: wrapper not found at %s (expected during RED phase)\n' "$WRAPPER"
fi

run_test_1
run_test_2
run_test_3
run_test_4
run_test_5
run_test_6
run_test_7
run_test_8
run_test_9
run_test_10
run_test_11
run_test_12
# test_13 (hook-arming integration) removed from the portable suite — it depends on owner-installed ~/.claude/hooks infrastructure and lives with that hook, not the plugin.
run_test_14
run_test_15
run_test_16
run_test_17
run_test_18
run_test_19
run_test_20
run_test_20b
run_test_21
run_test_22
run_test_23
run_test_24
run_test_25
run_test_26
run_test_27
run_test_28
run_test_29
run_test_30
run_test_31
run_test_32
run_test_33
run_test_34
run_test_35
run_test_36
run_test_37
run_test_38
run_test_39
run_test_40
run_test_41
run_test_42
run_test_43
run_test_44
run_test_45
run_test_45b
run_test_46
run_test_47
run_test_48
run_test_49
run_test_50
run_test_51
run_test_52
run_test_53
run_test_54
run_test_55
run_test_56
run_test_57
run_test_58
run_test_59
run_test_60
run_test_61
run_test_62
run_test_63
run_test_64
run_test_65
run_test_65b
run_test_66
run_test_67
run_test_68
run_test_69
run_test_70
run_test_71
run_test_72
run_test_73
run_test_74
run_test_75
run_test_76
run_test_77
run_test_78
run_test_79
run_test_80
run_test_81
run_test_82
run_test_83
run_test_84
run_test_85
run_test_86
run_test_87
run_test_88
run_test_89
run_test_90

printf '====================================\n'
printf 'PASS=%d FAIL=%d\n' "$PASS_COUNT" "$FAIL_COUNT"
if [ "$FAIL_COUNT" -ne 0 ]; then
  exit 1
fi
exit 0
