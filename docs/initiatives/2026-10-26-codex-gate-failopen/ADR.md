# ADR: close two fail-open paths in codex-gate

Line numbers are for `plugin/skills/codex-gate/` at `1355ddc`.

## ADR-001 Branch: `fix/codex-gate-failopen`, stacked on `1355ddc`, same worktree

The owner chose to do this work in this session ("do it here"). The previous fix branch `fix/codex-gate-bin-and-400`
is complete, installed and awaiting a ship decision, so this work goes on its own branch from its head. The new
branch is cut in the same worktree (`~/personal/the-foreman-gate-fix`, created by the previous initiative), which
needs no new worktree. The fix branch stays at `1355ddc`. `prepr` runs against `1355ddc`, so the reviewer sees only
this change, and the future PR stacks on the fix branch.

## ADR-002 A non-array `blockers` is an inconsistent verdict, checked before counting

`verdict.schema.json` requires `blockers` and types it as an array. The wrapper treats a violation as the existing
"inconsistent verdict" class (`INFRA_ERROR`), checked once per verdict before any count:

- `emit_outcome`, right after the valid-JSON check:
  `die_infra "inconsistent verdict: blockers is <type>, not an array (<verdict path>)"`
- `classify_verdict_file`, right after its valid-JSON check: print `INFRA_ERROR`. In the fan-out, that job's reason
  is then `no usable verdict (<job verdict path>)` (`codex_failure_reason` on exit 0). By the existing BLOCK >
  INFRA_ERROR > OVERFLOW > APPROVE precedence, the aggregate is `INFRA_ERROR` when no other job blocks, and BLOCK
  when one does. It never approves. (This wording follows a bundle-gate nonblocking note.)

The type is read with `jq -r '.blockers | type'`. A missing key reads `null`, and so does a `null` value. Both fail,
because the schema requires the key.

Rejected:
- Coercing a non-array to "1 blocker" (BLOCK). It invents a finding the reviewer never wrote, and the fix loop would
  chase a blocker that does not exist.
- Leaving it to `--output-schema`. The wrapper's own invariant is that it fails closed on an inconsistent verdict;
  it must not depend on Codex enforcing the schema.

## ADR-003 Only an explicit `APPROVE` approves a fan-out run

Both emitters get one guard after their OVERFLOW branch, before any approval work (the shard ledger append, the lens
coverage check):

```bash
if [ "${FAN_OUTCOME:-}" != "APPROVE" ]; then
  die_infra "<sharded|multi-lens> review: unexpected aggregate outcome '${FAN_OUTCOME:-}' — refusing to approve (fail closed)"
fi
```

`fan_out_and_aggregate` also sets `FAN_OUTCOME=""` at its start, next to `FAN_FIRST_INCONCLUSIVE=""`, so the value is
never stale from an earlier call.

- The resulting `INFRA_ERROR` uses the base status shape, without `shards[]` or `lenses[]`. This path is an internal
  invariant failure, not a job's verdict, and `die_infra` already documents that shape.
- Today the path is unreachable: `fan_out_and_aggregate` sets only the four known values. The guard makes any future
  value fail closed instead of approving.

## ADR-004 Out of scope

- Validating each blocker element. A non-object element still counts toward BLOCK, which is fail-closed.
- The `question` and `investigate` schemas, which have no `blockers`.
- Any dial or default.
- Shipping either branch.

## ADR-005 One phase; live-run gate before any sync

There is one phase, P1, built red-first by sonnet builders with opus spec and quality reviews. It runs through
`phase-start`, `phase-review`, `prepr 1355ddc`, and a `live-run` gate before the README's manual sync into
`~/.claude/skills/codex-gate/`. The proof after the sync is `config` parity MATCH plus the installed suite. A live
Codex call cannot exercise these paths, because the real Codex enforces the schema, so none is planned.
