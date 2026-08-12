# ADR — Wave 1 decisions

## Owner decisions recorded at the plan-approval gate (2026-08-11)

| # | decision | owner's answer |
|---|---|---|
| — | Wave-1 plan | **APPROVED**, with **scoped per-phase LOCAL commits authorized** (explicit paths only, never `git add -A`; no push, no PR without a fresh instruction) |
| ADR-1 | reviewer pair | **`gpt-5.6-sol` @ `xhigh`** |
| ADR-3 | fast mode | **OFF (`0`)** in both copies |
| ADR-1 | recall loss | **Accepted and recorded** — `docs-contract.test.mjs:23` and `diff.mjs:201` stand as known residuals; the ADR-4 confirmatory rerun is declined |
| ADR-5 | install topology | **Physical copy at `~/.claude/skills/codex-gate`** is authoritative *(informs the manual sync target; the automated mutator it was written for no longer exists — see ADR-7)* |
| ADR-6 | sync unit | **Whole skill directory**, not the script. Retained as the *inventory/parity* contract; its automation is superseded by ADR-7 |
| ADR-7 | the mutator | **Quarantined, not shipped** — five P1s across two rounds, all in the mutating path. Branch `quarantine/gate-install-mutator` @ `fcac17e` |

Net change to the versioned copy: **effort `ultra` → `xhigh`** and **fast `1` → `0`**. The model
literal is already `gpt-5.6-sol` in the repo copy and does not move. (The *runtime* copy additionally
moves `gpt-5.6-terra` → `gpt-5.6-sol`. **That delivery is now the owner's post-approval manual sync**
— Phase 5's automated sync no longer exists, see ADR-7.)

Revised 2026-08-11 after an independent Codex audit of the sweep. Every correction below was
re-verified against the raw traces before being accepted; three of them invalidate claims an
earlier draft of this ADR made.

## ADR-1 — Default the gate to `gpt-5.6-sol` @ `xhigh`

**Status:** **ACCEPTED** by the owner at the plan-approval gate — as the **best provisional tradeoff,
not a proven recall-preserving or convergence fix.** The two-defect recall loss below was explicitly
accepted and recorded rather than absorbed silently.

### Context

Frozen-packet sweep, 2026-08-11 20:30–21:44. Six arms, `sol` × `terra` crossed with `ultra` / `max` /
`xhigh`, fresh root thread per arm, fast mode held OFF. Raw evidence: `sweep-evidence.md`.

### Validity boundaries — read before using any number here

1. **Group A (`sol@ultra`, `sol@max`) is NOT a controlled comparison.** Beyond the bundle doc added
   at 21:01, the *reviewed source code* changed mid-run: `diff.test.mjs` at 20:37:25 and
   `diff.mjs` at **20:43:27**, both inside the `sol@ultra` window (20:30:20–20:47:28). `sol@ultra`'s
   unique code finding was `diff.mjs:201` — a file being edited underneath its own review. Group A
   supports the delegation count and nothing else.
2. **Group B (`sol@xhigh`, `terra@ultra`, `terra@max`, `terra@xhigh`) is clean.** Zero `.mjs`
   modifications between 21:06 and 21:45. All quantitative comparisons below are within Group B.
3. **The `packet_sha` column was never populated** — the harness deleted `.packet.1` before hashing.
   The hashes `2f8ddc76` / `d4795db8` are **bundle-markdown hashes**, not packet hashes. Prompt-byte
   equality within each group was recovered independently from the rollout inputs.

### Evidence — Group B only, identical packet

| arm | blockers | code defects | plan-doc | aux-doc | `spawn_agent` | wall |
|---|---:|---:|---:|---:|---:|---:|
| `sol` @ `xhigh` | 14 | 4 | 7 | 3 | 0 | 555s |
| `terra` @ `ultra` | 13 | 4 | 9 | 0 | 3 | 949s |
| `terra` @ `max` | 11 | 0 | 10 | 1 | 0 | 543s |
| `terra` @ `xhigh` | 11 | 1 | 10 | 0 | 0 | 288s |

1. **Automatic delegation is exactly `ultra`-specific.** 3 root spawns at `ultra` under both
   families; 0 at `max` and 0 at `xhigh` in all four non-ultra arms; 0 across 639 historical
   `gpt-5.5@xhigh` threads. **Three is a capped floor, not ultra's ceiling** — the traces show
   descendants attempting further nested delegation and hitting the global thread limit
   (`thread limit` ×9, `max_concurrent_thread` ×2, `spawn fail` ×9). Unbounded demand, bounded only
   by an external cap.
2. **Effort drives per-round latency.** Same model, same packet: `ultra` 949s → `max` 543s →
   `xhigh` 288s, a 3.3× spread — all within Group B, same model, same packet.
   *(Correction, admission round 4: an earlier draft also cited Group A's `ultra`→`max` −5% to argue
   the ensemble is time-neutral. Group A was declared invalid — its source code changed mid-run — so
   that inference is **withdrawn**. Whether delegation is time-neutral is untested.)*
3. **Lower-effort `terra` surfaces far fewer code findings — but not because it skips the code.**
   `terra@max` and `terra@xhigh` each opened 9–10 `.mjs` files (`diff`, `serialize`, `validate`,
   `render`, `svg`, …). They inspected the same surface and reported 0 and 1 code findings against
   `sol@xhigh`'s 4. This is a reporting-threshold difference, not an inspection difference. An
   earlier draft of this ADR said terra "reviews the prose instead"; that was wrong and is retracted.

### Recall — R2 is NOT satisfied

`sol@xhigh` does not preserve every material finding the `ultra` arms produced:

| finding | `sol@xhigh` | `terra@ultra` | adjudication |
|---|---|---|---|
| `serialize.mjs:74` timestamp guard scans escaped JSON | yes | yes | material |
| `validate.mjs:119` accepts prototype-backed / inherited records | yes | yes | material |
| `serialize.mjs:159` sorts free-form `attrs` arrays | yes | — | material |
| `validate.mjs:56` parallel typed-edge ID collision | yes | — | material — #31 reports it surviving two plan rounds |
| `docs-contract.test.mjs:23` guard silently skips when docs absent | **missed** | yes | material (vacuous-pass class) |
| `validate.mjs:391` `isArrayIndex` accepts `4294967295` | — | yes | owner already judged **Negligible** (`phase-1-known-limitations.md:37`) |
| `diff.mjs:201` UNVERIFIED only when a doc claim exists | **missed** | (Group A) | still-valid defect |

So `sol@xhigh` misses **two** still-valid defects. The PDR's R2 ("no confirmed material finding from
the `ultra` arms is absent from the selected arm") is **not met**, and Wave 1 must not claim it is.
The honest statement is: comparable-but-not-superset recall, at 1.7× the speed, with delegation removed.

### Decision

Default `CODEX_GATE_MODEL=gpt-5.6-sol`, `CODEX_GATE_EFFORT=xhigh`.

- **Escalation:** `sol` @ `max` — a deliberate one-pass escalation for an unusually hard or ambiguous
  P0/P1 decision. Explicitly *not* an automatic response to a gate that will not converge.
- **Explicit opt-in only:** either model @ `ultra`, documented as natively delegating and unbounded.
- **Not adopted:** lower-effort `terra` as the mixed code-and-plan gate default, on this sample.

Rationale: it is the only measured configuration that removes wrapper-invisible delegation while
keeping code-defect reporting in the same range as `ultra`, at 1.7× the speed; and it is the nearest
neighbour to `gpt-5.5`@`xhigh`, the one historical configuration with 0 spawns across 639 threads
and a 35.6% approve rate. It is chosen as the best available tradeoff on one sample per arm, not as
a proven optimum.

### Confidence and limits

- **One round per arm, single sample.** Output is stochastic; none of these differences are
  variance-controlled.
- **Round-1 only** — measures per-round characteristics, never rounds-to-convergence.
- Group A is uncontrolled (see boundary 1). Cross-group comparison is invalid.
- The 4-vs-0/1 code-finding gap is the largest effect and is reproduced across two independent
  `terra` arms, but two samples is not a measurement.

## ADR-2 — Wave 1 is a topology-and-latency fix, NOT a convergence fix

**Status:** proposed

Blocker counts were 11–15 in every arm regardless of model or effort. The dial moves delegation and
latency; it does not move volume. Across Group B only 0–4 of 11–14 findings concern code — the rest
are about the plan documents, and 0–3 per arm about auxiliary docs (handoffs, next-agent prompts,
known-limitations), because `bundle` recursively ingests every `.md` under the initiative directory.

**Therefore Wave 1 is titled "bound reviewer topology and reduce latency."** It does **not** close
#30 or #31 and must never be described as restoring convergence. The convergence work is Wave 2:
explicit packet manifests, plan/code separation, materiality rules, enforced round caps, and blocker
reconciliation across rounds.

Revised causal picture:

| symptom | best-supported cause | settled? |
|---|---|---|
| hidden delegation | `ultra` effort tier | yes — 6 arms + 639 historical threads |
| per-round latency | model × effort configuration | yes — within Group B |
| finding volume | broad recursive packet + zero-blocker policy | strongly indicated |
| non-convergence | packet scope + lifecycle mechanics | **not directly tested** |

## ADR-3 — Fast mode: OFF (owner-decided)

**Status:** **ACCEPTED — `CODEX_GATE_FAST=0` in both copies.** The repo copy moves `1` → `0`; the
runtime copy is already `0`. Rationale below stands; the owner chose to keep this wave to one
behavioural variable and take the ~1.7x win without the ~2.5x credit multiplier.
**Correction (admission round 4):** that 1.71x is a **combined model-and-effort** result
(`sol@xhigh` 555s vs incumbent `terra@ultra` 949s, Group B, same packet) — both dials differ, so it
must not be described as an effort-only win.

### Original framing

Repo ships `CODEX_GATE_FAST=1`, live runtime has `0`. Per the wrapper's own documentation fast mode
is ~1.5× faster at ~2.5× credits and explicitly not a quality knob — a spend decision, not an
engineering one. Changing it in the same wave as the effort tier would re-create the confound the
sweep just spent an hour separating. Wave 1 makes the two copies *agree* at whichever value the
owner picks.

## ADR-4 — Confirmatory run: DECLINED

**Status:** **DECLINED** by the owner at the plan-approval gate. ADR-1 therefore stands on one sample
per arm, with its limits stated. Recorded here so a future reader knows the confirmatory experiment
was considered and consciously skipped, not overlooked.

The audit's recommendation: rerun **only `sol@xhigh` vs `sol@max`**, on an **immutable worktree**
with a **prebuilt frozen packet**, so neither bundle docs nor source can move mid-run — the two
defects that damaged Group A. Two arms, not six.

This would test whether `xhigh` gives up material recall relative to `max` under genuinely
controlled conditions, which is the one open question ADR-1 rests on. It is not required to adopt
ADR-1; it converts "best provisional tradeoff" into a measured one.

## ADR-7 — The automated sync mutator is quarantined, not shipped (owner-decided)

**Status:** **ACCEPTED** at a decision-fork gate after a third round of admission findings.

The `install` mutator accumulated **five P1 defects across two review rounds** — plugin-root bypass,
directory-symlink overwrite, unusable partial install, a non-transactional update that left a partial
install after a *reported failure*, and a `..` dot-segment containment bypass. Every one was in the
mutating path — at *those two rounds* the detector and the dial/fan-out work drew no findings.

**That is not a claim the detector was defect-free, and an earlier wording of this ADR implied it
was.** The detector has since had real defects of its own: it certified two incomplete skills as a
full `MATCH`, it briefly treated a non-executable runtime as unrunnable (retracted below), and in
round 4 it let an untracked copy self-certify as the versioned source — a P1. The accurate statement
is narrower: the *mutator* accumulated defects faster than they could be closed, across two rewrites,
while the rest of the surface converged.

Per the-foreman §8 ("two failures at one tier = change something structural"), and dogfooding issue
#30's own Finding 3 (the loop has no subtraction pressure), the mutator is **removed from Wave 1 and
quarantined** on `quarantine/gate-install-mutator` as its own initiative. Net effect on this branch:
**-726 lines.**

What survives is the part that converged: `config` detection, the 13-member inventory as a
*parity* contract, and a documented manual sync command. It survives because its defects were
closable — the three listed above were each found once and fixed once — not because it had none. ADR-6's insight — that the sync unit is the
whole skill directory, not the script — is retained; only its *automation* is deferred.

Two detector defects found in the same round were fixed rather than deferred, because the detector
ships: `config` no longer certifies two incomplete skills as a full `MATCH` (new `completeness` state
and `inventoryMissing`), and `runtimeExecutable` is reported. `parity` gains `INCOMPLETE` for
"agreement over something that is not whole".

**RETRACTED (admission round 4):** an earlier version of this ADR also made a non-executable runtime
force `parity: INCOMPLETE`, on the reasoning that it "cannot run". That was wrong — every documented
command invokes the wrapper as `bash codex-gate.sh`, which does not require `+x`, and a mode-0644
runtime was verified to run `config` successfully with exit 0. `runtimeExecutable` is now a
**diagnostic field only** and does not affect `parity` or `completeness`.

## ADR-6 — Sync unit is the whole skill directory, not the script (owner-decided)

**Status:** **PARTLY SUPERSEDED by ADR-7.** The *semantic* claim — the sync unit is the whole
13-member skill directory, so parity must be a directory-level assertion — is **accepted and live**;
`config` implements it. The *automation* it authorised (an `install` mutator) is **superseded and
removed**. Read the sections below as the rationale for the inventory contract, not for a tool.


**Status (historical, superseded — see the PARTLY SUPERSEDED note above):** accepted at a
decision-fork gate after the Wave-1 audit; Phase 5's script-only mutator was superseded by Phase 6.
Phase 6's mutator was in turn removed by ADR-7. Retained as the record of what was decided then.

Three P1 defects were reproduced in the script-only design, and a fourth — installed `SKILL.md`
still documenting terra/ultra after a "successful" sync — showed the deeper fault: **a script-only
parity MATCH overstates what was actually synchronized.** Syncing the whole skill directory is the
only option considered where MATCH means what it says, and it is the only one that can produce a
usable first-time install, since `main()` requires sibling `verdict.schema.json` and
`reviewer-instructions.md` before dispatching any mode.

Rejected *at the time*: dropping the mutator entirely (judged to push an error-prone `cp -R` back
onto the owner and leave R3 unmet), and hardening the script-only path (leaves the contract-drift P1
open).

> **Superseded by ADR-7.** Two further rounds of P1s made the rejected option the correct one, and
> ADR-7 adopts exactly it. Read this rejection as the reasoning available *before* that evidence, not
> as live canon — it is retained because the reversal is the substantive lesson, not an embarrassment
> to hide.

## ADR-5 — Installation topology: physical copy is authoritative (owner-decided)

**Status:** **ACCEPTED, but its automated-mutator consequences are SUPERSEDED by ADR-7.**

Still live: `~/.claude/skills/codex-gate` (a real directory, not a symlink) is the authoritative
runtime, and is therefore the destination of the **documented manual sync**; `config` confirms the
result. Superseded: everything this ADR originally said about a Phase-5 mutator being unblocked and
having to detect/refuse symlinks, plugin-managed installs and duplicates — **the shipping tree
contains no mutator**, so there is nothing to hold to that contract. Those requirements move with the
mutator to `quarantine/gate-install-mutator` if it is ever revived.

### Original framing

Phase 5 originally hard-coded `~/.claude/skills/codex-gate` as "the runtime". That is an assumption,
not a fact: this plugin supports plugin-managed installation and personal-skill symlinks, and its own
docs warn against duplicate installs. A sync path that blindly writes to one physical directory can
clobber a symlink, be silently shadowed by a plugin-managed copy, or update only one of two installs
— leaving the owner on the old gate while the parity report claims success.

The owner needs to decide the supported topology and the authoritative source. The plan must then
define detection, explicit-target selection, and refusal behaviour for: physical copy, symlink,
plugin-managed install, and duplicate installs.

Until answered, Phase 5 cannot be specified safely, and R3 ("one source of truth for the dials")
cannot be claimed as met.
