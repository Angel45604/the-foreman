# Sweep evidence — frozen-packet effort sweep, 2026-08-11

Command shape per arm (read-only, fresh root thread, fast OFF):
```
CODEX_GATE_RUNS=<exp-root> CODEX_GATE_SESSION=exp-<fam>-<eff> CODEX_GATE_FAST=0 \
  CODEX_GATE_MODEL=gpt-5.6-<fam> CODEX_GATE_EFFORT=<eff> \
  bash codex-gate.sh bundle docs/initiatives/2026-08-11-the-cartographer 1
```

## Raw per-arm results

```
arm              model          effort  secs  exit  blockers            verdict                                   packet_sha  bundle_sha
exp-sol-ultra    gpt-5.6-sol    ultra   1028  0     15 request_changes  2f8ddc76465fc469137b615c90ea994df2c7826c
exp-sol-max      gpt-5.6-sol    max     1079  0     15 request_changes  2f8ddc76465fc469137b615c90ea994df2c7826c
exp-sol-xhigh    gpt-5.6-sol    xhigh   556   0     14 request_changes  d4795db833e511c19c2cb5888f2982ae85539f7c
exp-terra-ultra  gpt-5.6-terra  ultra   951   0     13 request_changes  d4795db833e511c19c2cb5888f2982ae85539f7c
exp-terra-max    gpt-5.6-terra  max     544   0     11 request_changes  d4795db833e511c19c2cb5888f2982ae85539f7c
exp-terra-xhigh  gpt-5.6-terra  xhigh   289   0     11 request_changes  d4795db833e511c19c2cb5888f2982ae85539f7c
```

## Analysis (spawns, artifact-class split, cross-arm agreement)

```
arm                       verdict  blk  CODE  PLAN  AUX  P1  P2 dec  SPAWN  wall_s
exp-sol-ultra     request_changes   15     4    10    1  10   5   1      3    1027
exp-sol-max       request_changes   15     4     9    2   9   6   1      0    1078
exp-sol-xhigh     request_changes   14     4     7    3  10   4   1      0     555
exp-terra-ultra   request_changes   13     4     9    0  13   0   2      3     949
exp-terra-max     request_changes   11     0    10    1   9   2   1      0     543
exp-terra-xhigh   request_changes   11     1    10    0   8   3   1      0     288

=== CROSS-ARM AGREEMENT (same file, line within +/-25) ===
arm               total  shared>=2arms  UNIQUE unique CODE
exp-sol-ultra        15             11       4           1
      UNIQUE-CODE P1 diff.mjs:201  UNVERIFIED is considered only when a doc claim exists. A node whose sole code-co
exp-sol-max          15             13       2           1
      UNIQUE-CODE P1 validate.mjs:719  A required overview svg-hero with empty nodes and edges validates successfully. 
exp-sol-xhigh        14             12       2           1
      UNIQUE-CODE P1 validate.mjs:56  The edge ID includes kind but still cannot represent two edges of the same kind 
exp-terra-ultra      13              8       5           2
      UNIQUE-CODE P1 validate.mjs:391  isArrayIndex accepts 4294967295 and larger values as array indices even though J
      UNIQUE-CODE P1 docs-contract.test.mjs:23  The PDR-to-validator contract guard silently skips when initiative docs are abse
exp-terra-max        11             10       1           0
exp-terra-xhigh      11             11       0           0

=== CODE findings by arm (the ones that matter for recall) ===
  exp-sol-ultra     P1 diff.mjs:201   UNVERIFIED is considered only when a doc claim exists. A node whose sole code-comment
  exp-sol-ultra     P1 serialize.mjs:74    The timestamp guard scans escaped JSON token text rather than decoded strings. Values
  exp-sol-ultra     P1 serialize.mjs:158   Normalization sorts every array except views[].columns, including free-form attrs arr
  exp-sol-ultra     P1 validate.mjs:119   Schema checks accept prototype-backed records and inherited required fields, while se
  exp-sol-max       P2 serialize.mjs:74    Timestamp matching runs against JSON-escaped token bodies. A literal newline or tab i
  exp-sol-max       P1 serialize.mjs:159   normalizeValue sorts every array except views[].columns, including arrays inside free
  exp-sol-max       P1 validate.mjs:119   The loose object predicate accepts prototype-backed schema records. A top-level Objec
  exp-sol-max       P1 validate.mjs:719   A required overview svg-hero with empty nodes and edges validates successfully. This 
  exp-sol-xhigh     P1 serialize.mjs:74    The timestamp guard scans escaped JSON token text. A date immediately following an es
  exp-sol-xhigh     P1 serialize.mjs:159   normalizeValue sorts every array except views[].columns, including arrays inside free
  exp-sol-xhigh     P1 validate.mjs:56    The edge ID includes kind but still cannot represent two edges of the same kind betwe
  exp-sol-xhigh     P1 validate.mjs:119   validate accepts prototype-backed and non-enumerable records that diff and serialize 
  exp-terra-ultra   P1 docs-contract.test.mjs:23    The PDR-to-validator contract guard silently skips when initiative docs are absent. T
  exp-terra-ultra   P1 serialize.mjs:74    The timestamp guard scans escaped JSON-token text rather than decoded strings. A lite
  exp-terra-ultra   P1 validate.mjs:119   Validation, serialization, and drift computation disagree on structural object semant
  exp-terra-ultra   P1 validate.mjs:391   isArrayIndex accepts 4294967295 and larger values as array indices even though JSON a
  exp-terra-xhigh   P1 validate.mjs:119   `validate()` accepts inherited records while `serialize()` drops inherited data. A va
```

## Provenance (added after gate round 1)

| item | value |
|---|---|
| wrapper actually invoked | `/Users/angel/.claude/skills/codex-gate/codex-gate.sh` (the INSTALLED runtime, not the repo copy) |
| wrapper sha256 (first 16) | `7ba68432ca0804f8` |
| versioned repo copy sha256 (first 16) | `d2fbee8c4f727407` — **differs; the sweep did not exercise the repo copy** |
| Codex CLI | `codex-cli 0.147.0-alpha.6.5` |
| reviewer instructions / verdict schema | unchanged across all six arms (installed copy) |
| bundle reviewed | `docs/initiatives/2026-08-11-the-cartographer` in `/Users/angel/personal/the-foreman` |

**Column caveat.** In the table above `packet_sha` is **blank** — the harness deletes `.packet.N`
after a run, so the hash could not be taken post-hoc. `bundle_sha` IS populated and is a hash of the
concatenated bundle `.md` files; the two values `2f8ddc76…` / `d4795db8…` are therefore
**bundle-markdown hashes, not packet hashes**. Prompt-byte equality within each group was confirmed
separately from the recovered rollout inputs. A gate round-1 finding asserted `bundle_sha` was the
blank column; that is incorrect — it is `packet_sha`. The underlying provenance gap it identified
was real and is closed by this section.

**Uncontrolled-arm warning.** Group A (`sol@ultra`, `sol@max`) also saw *source code* change mid-run:
`diff.test.mjs` 20:37:25 and `diff.mjs` 20:43:27, both inside the `sol@ultra` window. Group A is not
a controlled comparison and supports only the delegation count.
