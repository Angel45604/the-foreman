# codex-gate fail-open guards: execution plan

> **For Claude:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development, driven by the the-foreman conductor.

**Goal:** a malformed `blockers` field, or an unknown fan-out aggregate value, can never produce APPROVE.

**Architecture:**
- a `blockers`-must-be-an-array check in the two verdict classifiers (ADR-002);
- an explicit-APPROVE guard in the two fan-out emitters (ADR-003).

**Tech stack:** bash 3.2 under `set -u`; jq 1.7.1; the repo's `codex-gate.test.sh`.

Paths are relative to `~/personal/the-foreman-gate-fix`. `W=plugin/skills/codex-gate/codex-gate.sh`,
`T=plugin/skills/codex-gate/codex-gate.test.sh`. Line numbers are at `1355ddc`; locate code by the quoted text.

## Process (mandated)

- Gate with the INSTALLED runtime from the checkout root: `bash ~/.claude/skills/codex-gate/codex-gate.sh <mode> …`.
  Since 2026-10-26 the installed gate needs no `CODEX_BIN` prefix. Never pass model or effort overrides.
- Builders: a fresh `sonnet` subagent per task. Reviews: `opus` spec review, then `opus` quality review, per task.
  The conductor re-runs the suite and reads the diff itself.
- Suite: one run at a time, foreground, ~90 s. Compare `git status --porcelain=v1 -uall --ignored` before and after
  each run; nothing in the repo may change.
- Commits: only if the plan-approval gate authorizes them. Use explicit paths, and commit only after `phase-review`
  APPROVE and a green suite. No push.

## Phase P1: fail-closed guards

`phase-start P1` (conductor), before any edit.

### Task P1.1 (builder): RED tests

**Files:** `T` only. Follow the P1/P2 idioms already in T:
- the `FIXTURE_DIR` and stub-arm conventions;
- `cls_*` / `bin_*` plumbing;
- per-test `####` banners;
- diagnostics on every FAIL line.

1. **Stub.** Add a mode `approve_bad_blockers`. It writes `-o` as an approve verdict whose `blockers` is taken from
   `STUB_BLOCKERS_JSON`: raw JSON text, or the word `MISSING`, which omits the key. It exits 0.
   - Document it in the stub header.
   - Keep the unquoted-heredoc escaping correct.
2. **Tests** (`run_test_84`…):

   | Case | Mode / driver | Expect |
   |---|---|---|
   | each bad shape: `true`, `false`, `0`, `{}`, `null`, `"x"`, MISSING | unsharded `prepr` | `INFRA_ERROR`. The summary starts `inconsistent verdict: blockers is ` and names the jq type: `boolean`, `boolean`, `number`, `object`, `null`, `string`, `null`. The ledger line count is unchanged. |
   | `true` | `plan` (doc tier) and `phase-review` | `INFRA_ERROR`, same summary prefix |
   | classifier unit | `classify_verdict_file <vf> <jsonl> 0` (source `W`) | every bad shape gives `INFRA_ERROR`; `approve` + `[]` gives `APPROVE`; `approve` + one object blocker gives `BLOCK`; output is exactly one token |
   | sharded | TEST 31's 3-file repo, budget 9000, `STUB_MODE=approve_bad_blockers STUB_BLOCKERS_JSON=true` | aggregate `INFRA_ERROR`, never `APPROVE`. The summary starts `shard ` and contains `failed: no usable verdict (`. The ledger is unchanged. |
   | multi-lens | `prepr --multi`, same env | `INFRA_ERROR`; summary starts `lens ` and contains `failed: no usable verdict (` |
   | unknown aggregate | Drive `main prepr` (sharded setup) and `main prepr --multi` end to end. Source `W` with `fan_out_and_aggregate` shadowed: it sets `FAN_OUTCOME` to `WEIRD`, then to empty, plus `FAN_N_JOBS=1`, `FAN_TOTAL_FILES`, `FAN_JOBS_JSON='[]'`, zero counts and empty `FAN_FIRST_*`. See the note below for how to source it. | `INFRA_ERROR` with summary `… unexpected aggregate outcome 'WEIRD' …` (or `''`); never `APPROVE`; the ledger line count is unchanged |

   **Sourcing note:** the wrapper's main guard compares `BASH_SOURCE[0]` with `$0`. One way that works:
   `bash -c '. "$1"; fan_out_and_aggregate() { …; }; main prepr' "$DIR/./codex-gate.sh" "$DIR/codex-gate.sh"`.
   - `$0` is the `./` spelling, so `SKILL_DIR` still resolves.
   - The sourced path differs from `$0`, so `main` does not auto-run.

   Find the ledger the way the existing ledger tests do (T ~:1719-1750): `.../<wtkey>/ledger.jsonl`.
3. Run the suite. **Expected RED:** every new bad-shape and unknown-aggregate case fails, because the current code
   returns APPROVE (the `"x"` shape currently gives BLOCK, so it also fails). The unchanged-behavior controls pass:
   `approve` + `[]` gives APPROVE and an object blocker gives BLOCK. All 572 existing checks pass.

**Review gate:** opus spec review, then opus quality review. The conductor confirms RED itself.

### Task P1.2 (builder): GREEN, guards and docs

**Files:** `W`; `plugin/skills/codex-gate/SKILL.md`; `plugin/skills/codex-gate/README.md`.

1. In `emit_outcome`, right after the `verdict file is not valid JSON` check (`W:~862-864`), add:

```bash
  # blockers[] must BE an array (verdict.schema.json requires it). Any other type would be miscounted:
  # false, 0, {}, null or a missing key read as zero blockers and approve; a string, a non-empty object
  # or a nonzero number reads as blockers nobody wrote. Either way it is an inconsistent verdict.
  local btype
  btype="$(jq -r '.blockers | type' "$VERDICT_FILE" 2>/dev/null)"
  if [ "$btype" != "array" ]; then
    die_infra "inconsistent verdict: blockers is ${btype:-unreadable}, not an array ($VERDICT_FILE)"
  fi
```

2. In `classify_verdict_file`, right after its valid-JSON check (`W:~1811-1813`), add:

```bash
  # A non-array blockers (verdict.schema.json requires an array) is an inconsistent verdict.
  [ "$(jq -r '.blockers | type' "$vf" 2>/dev/null)" = "array" ] || { printf 'INFRA_ERROR'; return 0; }
```

3. In `fan_out_and_aggregate`, set `FAN_OUTCOME=""` next to `FAN_FIRST_INCONCLUSIVE=""`. Add a word to the
   header comment that it is reset per call.
4. In `shard_and_review`, directly after the `if [ "$FAN_OUTCOME" = "OVERFLOW" ]` block (`W:~2126-2137`), add:

```bash
  # Only an explicit APPROVE may approve: any other aggregate value is an internal error. Fail closed
  # BEFORE the ledger append below.
  if [ "${FAN_OUTCOME:-}" != "APPROVE" ]; then
    die_infra "sharded review: unexpected aggregate outcome '${FAN_OUTCOME:-}' — refusing to approve (fail closed)"
  fi
```

   In `multi_lens_review`, directly after its OVERFLOW block (`W:~2319-2329`), before the coverage-gap check, add
   the same block with `multi-lens review:` in place of `sharded review:`, and with the comment ending "BEFORE the
   coverage check and the APPROVE emitter below."
5. Docs, minimal and in the surrounding voice:
   - **SKILL.md "Fail closed on inconsistent verdicts" (`:532-535`):** add one sentence. A `blockers` field that is
     not an array is an inconsistent verdict and gives `INFRA_ERROR`.
   - **SKILL.md and README.md Status bullets (sharded and multi-lens):** add one clause. Any aggregate value other
     than the four is an internal error and fails closed as a base-shape `INFRA_ERROR`.
   - **README.md:** add the same `blockers` sentence wherever README states the approve rule (find it with grep).
6. Run `bash -n "$W"`, then the suite. Expected: **GREEN**, `FAIL=0`, `PASS` = 572 + the new checks.

**Review gate:** opus spec review, then opus quality review. Fix loop until both pass. The conductor re-runs the suite
and reads the diff.

### P1 close (conductor)

1. Write `context.md`.
2. Run `phase-review P1` and drive it to APPROVE.
3. Run the suite.
4. If authorized, commit with explicit paths: `W`, `T`, SKILL.md, README.md and this bundle.
5. Then the phase-boundary gate.

## Pre-PR and live run

1. Run `prepr 1355ddc` and drive it to APPROVE.
2. Hold the **live-run** hard gate: AskUserQuestion, authorize or decline. If authorized:
   - back up `~/.claude/skills/codex-gate/` with a verified sha256 manifest;
   - wait until no `codex-gate.sh` process is running;
   - run the README "Manual sync" loop exactly as written, plus the test file;
   - check that `config` reports parity MATCH;
   - run the installed suite and expect `FAIL=0`.

   No live Codex call is needed (ADR-005). On any failure, restore from the backup.
3. Render the final brief, ending "ready to ship, awaiting your instruction".
