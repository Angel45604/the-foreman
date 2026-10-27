# PDR: codex-gate never approves a malformed verdict or an unknown aggregate

Status: DRAFT for the plan-approval gate. Branch `fix/codex-gate-failopen` in `~/personal/the-foreman-gate-fix`, stacked
on `1355ddc` (the CODEX_BIN and failure-classification fix, already installed). Line numbers are for
`plugin/skills/codex-gate/` at `1355ddc`.

## Problem

Two pre-existing fail-open paths, found by the opus code-quality review of the previous initiative
(`docs/initiatives/2026-10-26-codex-gate-bin-and-400/`):

1. **A non-array `blockers` approves.** `emit_outcome` (`codex-gate.sh:869-889`) and `classify_verdict_file`
   (`:1815-1817`) count blockers with `(.blockers // []) | length` and approve when the count is 0 and `.verdict` is
   `"approve"`. When `.blockers` is a boolean, jq errors and the count falls back to 0. When it is `{}`, `null`, `0`
   or missing, the count is 0. All of these reach APPROVE. Only Codex's `--output-schema` stops them today, because
   `verdict.schema.json` requires `blockers` and types it as an array.
2. **An unknown aggregate outcome approves.** `shard_and_review` (`:2098-2165`) and `multi_lens_review`
   (`:2282-2360`) test `FAN_OUTCOME` for BLOCK, INFRA_ERROR and OVERFLOW, then fall through to the APPROVE emitter
   for anything else. Today `fan_out_and_aggregate` sets only the four known values, so this is latent. A future
   fifth value, or an empty one, would approve.

The repo's invariant (SKILL.md "Fail closed on inconsistent verdicts"): APPROVE only when `verdict=="approve"` AND
`blockers[]` is empty.

## Evidence (verified 2026-10-26)

- Probe of the counting expression on `{"verdict":"approve","blockers":X}`:
  - `X` = `true`, `false`, `0`, `{}`, `null`, or a missing key → count `''` or `0` → APPROVE.
  - `X` = `"x"` → count 1 → BLOCK.
- Every verdict the wrapper writes itself has `"blockers":[]`:
  - `emit_synthetic_approve` (`:2383-2388`), which never passes through `emit_outcome`;
  - the fan-out's per-job over-budget verdict (`:1909`);
  - the aggregate verdicts (`:1963`, `:1979`, `:1987`, `:1994`).
- The two emitters' APPROVE paths run the ledger append (shards) and the coverage check (lenses) before emitting, so
  a fall-through also writes a "reviewed" ledger line for an unreviewed surface.
- A `codex-gate question` (GROUNDED, thread `01a17b7e-d434-7070-8410-241eece7d812`) leaned toward fixing both in one
  bounded follow-up. Fixing only the emitters leaves a malformed verdict producing a legitimate APPROVE token upstream.
- Baseline: `bash plugin/skills/codex-gate/codex-gate.test.sh` → `PASS=572 FAIL=0` at `1355ddc`.

## Goal

A review-mode verdict whose `blockers` is not an array is an inconsistent verdict, `INFRA_ERROR`, everywhere a
verdict is classified. A sharded or multi-lens run approves only when the aggregate says exactly `APPROVE`.

## Scope

In:
- the `blockers` type check in `emit_outcome` and `classify_verdict_file`;
- an explicit APPROVE guard in both emitters, and `FAN_OUTCOME` initialized at the start of `fan_out_and_aggregate`;
- red-first tests;
- the matching contract sentences in SKILL.md and README.md.

Out:
- validating each blocker element (a non-object element still counts toward a BLOCK, which is fail-closed);
- the `question` and `investigate` schemas, which have no `blockers`;
- any dial or default;
- shipping either branch.

## Acceptance criteria

1. In every review mode (`plan`, `bundle`, `phase-review`, `prepr`, `prepr-delta`), a verdict whose `blockers` is
   anything but an array is `INFRA_ERROR`. That covers `true`, `false`, `0`, `{}`, `null`, `"x"` and a missing key.
   The summary names the type it found, and no ledger line is written.
2. `classify_verdict_file` returns `INFRA_ERROR` for the same shapes. In sharded and multi-lens runs the aggregate is
   `INFRA_ERROR` when no job blocks. When another job returns BLOCK, the existing BLOCK > INFRA_ERROR precedence
   gives BLOCK. Neither case approves.
3. With `FAN_OUTCOME` anything other than `APPROVE`, `BLOCK`, `INFRA_ERROR` or `OVERFLOW` (including empty), both
   emitters emit `INFRA_ERROR` naming the value, never APPROVE, and write no ledger line.
4. `approve` + `[]` still approves; `approve`/`request_changes` + a non-empty array still blocks; the existing
   inconsistent-verdict rules are unchanged.
5. All 572 existing checks still pass; the suite writes nothing in the repo; `config` still reports `gpt-6-astra` /
   `xhigh` / fast off.
