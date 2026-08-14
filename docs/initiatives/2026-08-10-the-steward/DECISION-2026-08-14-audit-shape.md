# DECISION — the P3.7 audits claimed an absence they could not establish

**Owner decision, 2026-08-14.** Taken during Phase 3, after an adversarial review and independent
conductor probes.

## What was found

P3.7 was implemented as two AST audits over the core's own sources, each with a planted-bad-module
self-check. Both audits are **live** — a literal violation planted in production code does redden
them, and 15 of 18 detector-branch deletions redden their self-checks. But both are **one refactor
deep**. Verified by calling the real aggregations over planted sources:

```
PROMOTION AUDIT
  record["state"] = "confirmed"                  -> CAUGHT
  _key = "state"; record[_key] = CONFIRMED       -> EVADES
  APPROVED = "confirmed"; record["state"] = APPROVED  -> EVADES
  record["state"] = manifest.STATES[1]           -> EVADES

PROMPT AUDIT
  input("confirm? ")                             -> CAUGHT
  from sys import stdin; stdin.readline()        -> EVADES
  ask = input; ask("confirm? ")                  -> EVADES
  open("/dev/tty").readline()                    -> EVADES
  os.read(0, 16)                                 -> EVADES
```

An adversarial reviewer planted `_key = "state"; record[_key] = CONFIRMED` **inside the real
`record_findings` loop** — a genuine ADR-11 violation in production code — and the entire 548-test
suite stayed green.

Two of the evading promotion shapes are **not adversarial**: `manifest.STATES` already exists and
`core/records.py` already hoists `PROPOSED`/`CONFIRMED`, so `record["state"] = APPROVED` is house
style. `sys`, `os` and `open` are already used by the core, and `input` is a builtin needing no
import, so the existing import allowlist cannot see any of these either.

## Why "add more detector branches" was rejected

The set of syntactic forms that write a string into a dict key is unbounded, and `record[k] = v` with
both sides from data is not statically decidable. Adding branches is an arms race that ends *feeling*
complete — which is worse than a stated bound. It is also this project's institutional lesson #3
("fixes generate defects here") in its purest form: the review already found three detector branches
that no plant can reach.

**The governing canon.** ADR-28 bans two sentences outright, one of them *"there is no enforcement"* —
claiming absence from a partial look — and requires that "every stronger claim must take that shape —
scoped to the object actually inspected." The promotion audit's claim, *"no core module **can** write
a confirmed record"*, is exactly the banned shape, committed by the tool's own test suite about
itself. A tool whose thesis is *a recorded claim is not evidence* had made a recorded claim its
evidence.

`codex-gate question` returned **`GROUNDED`, `settledByCanon: false`**: canon "strongly rejects the
current unbounded wording" but does not itself choose among the available test structures. Codex
warned that deleting the promotion oracle is safe **only once the missing mutation-seam check replaces
it**, because `record_findings` iterates the caller's mutable record dicts while the behavioural test
in `test_no_confirmation.py` checks only the *shape of returned values* and never snapshots the
inputs.

## The evidence that unblocked the decision

The complete, syntax-independent check is **input non-mutation**: snapshot the records, run,
deep-compare. It catches any promotion regardless of spelling. That invariant already existed in
`tests/test_records.py` but was blind because its fixture pre-set every record to `confirmed` — the
"two values coincided" trap. After that fixture was fixed (one `confirmed` + one `proposed` per kind),
the conductor planted the evading shape and confirmed the invariant is now load-bearing:

```
planted: _key = "state"; record[_key] = CONFIRMED
result:  FAILED - "the machine edited a record"
         "state": "proposed"  ->  "state": "confirmed"   (npm run lint)
```
Restored byte-identical (SHA-256 match), suite green again.

## The decisions

### 1. Delete the promotion AST audit — the behavioural invariant replaces it

The guarantee now rests on three things, none of which enumerate syntax:

1. the **input-non-mutation snapshot**, proven load-bearing against the shape that evaded the audit;
2. the state machine having **no write capability at all** — `core/records.py` contains no `open(`,
   no `os.`, no `atomic`, no `jsonio`;
3. the **Phase-6 write-seam invariant** (below).

Accepted cost, recorded plainly: the behavioural invariant covers `record_findings`' inputs, so a
*future* module writing `confirmed` is not caught until Phase 6. Nothing in Phases 4–5 can persist a
record, so the exposure is bounded.

### 2. Narrow the prompt audit's claim, and add the behavioural check for the three live verbs

The prompt audit is kept as an explicitly **bounded lint**: renamed, with its claim rewritten to
enumerate the forms it covers, so the suite never asserts an absence it cannot establish (ADR-28's
bounded-diagnosis shape).

Additionally, P3.7's own specified behavioural check is implemented **now** for the three verbs that
exist — `scan`, `check`, `doctor`: a run with **stdin closed** and a run **with a pty** must give
byte-identical output. The `generate` half waits for Phase 6.

### CORRECTION, 2026-08-14 — this section overclaimed, and the overclaim was the same error it names

The sentence originally here said the behavioural check "is syntax-independent, so it **covers
`/dev/tty`** and `os.read(0, …)` that no AST branch will ever enumerate." **That was false**, and it
was written without testing it — the precise failure this whole document is about, committed while
describing it.

Proven by running code (`codex-gate phase-review P3`, blocker 5, independently reproduced):

`subprocess.run(stdin=slave)` sets **fd 0 only**. It never calls `setsid()` + `TIOCSCTTY`, so the
child keeps the **parent's** controlling terminal. `/dev/tty` is the *controlling terminal*, not fd 0:

```
runner WITH a controlling terminal:
  fd 0 = /dev/null    -> /dev/tty rdev 33554432
  fd 0 = pty slave    -> fd0 rdev 268435461 (/dev/ttys005), /dev/tty rdev 33554432
                         SAME_DEVICE False
runner WITHOUT a controlling terminal:
  /dev/tty -> ENXIO in BOTH arrangements
```

So the two arrangements **always agree** about `/dev/tty` — the fixture cannot distinguish them on
that question at all. It is not that one opens and one fails.

**Demonstrated false green.** A prompt planted in the live `_scan` body — `os.open("/dev/tty",
O_RDWR)`, write the question, `os.read` the answer, wrapped in the `except OSError: return` a
developer writes to "degrade gracefully in CI" — leaves the fixture **green, 2 tests OK**, including
its own T5 control. The clean-core control still passes, so the detector is not dead. The identical
core, run from a process that *has* a controlling terminal, prints `Proceed with scan? [y/N]` and
**blocks forever**.

**Required fix:** run the pty child in its own session with the slave installed as the controlling
terminal (`pty.fork()`, or `setsid` + `TIOCSCTTY`), and add an independent oracle asserting `/dev/tty`
is **unavailable** in the closed run and **readable** in the terminal run.

### RESOLVED, 2026-08-14 — the fix landed and was proven against the plant that defeated it

Both arrangements now run in **their own session** (`start_new_session=True`); the terminal run
installs the pty slave as its controlling terminal via `TIOCSCTTY` in a `preexec_fn`.

Three details turned out to be load-bearing, and are recorded so a later "simplification" does not
quietly undo them:

1. **The closed run needs `setsid` too.** Without it a runner that *has* a terminal hands it to the
   closed child, both arrangements reach `/dev/tty`, and they agree again — the original defect.
2. **The pty is stamped with a window size no default has (7×13)** via `TIOCSWINSZ`, so the oracle can
   say *which* terminal the child reached. "It opened `/dev/tty`" would otherwise be satisfied by
   opening the **runner's** terminal — the defect's exact shape, one level up.
3. **The pty master is drained on a thread, started after the fork.** Verified: a child that writes to
   `/dev/tty` and is never drained wedges at exit in macOS process state `E`, and **`SIGKILL` does not
   reap it**, so `subprocess.run(timeout=…)` times out and then blocks forever in its own follow-up
   `wait`. The drain has its own bound, and a pump that never reached EOF appends a sentinel so the
   read fails loudly rather than passing as "wrote nothing".

**Proven, not asserted.** Against a temp copy of the core carrying the exact plant from the section
above — `os.open("/dev/tty", O_RDWR)` wrapped in `except OSError: return`:

```
planted core + the shipped fixture : Ran 3 tests  OK        <- the false green, reproduced
planted core + the fixed fixture   : FAILED (failures=1)
    "core scan did not finish within 60s with a controlling terminal on standard input...
     It printed b'Proceed with scan? [y/N] ' to its terminal first."
clean core   + the fixed fixture   : Ran 4 tests  OK        <- control, not a dead detector
write-only plant (never reads)     : caught in 1.3s, without needing the timeout
```

The independent oracle now asserts both halves directly: closed run → `unavailable errno=6` (ENXIO);
terminal run → `open rows=7 columns=13`, i.e. **the fixture's own pty**. The `isatty` control is kept
— it is necessary and was demonstrably insufficient, having stayed green throughout the period the
fixture was blind.

**The bound this check still has**, stated per ADR-28: three live verbs, one fixture repository, those
two arrangements. Not `generate` (a Phase-1 stub), and not other channels.

### 3. `FindingError` / `RecordError` stay out of `cli.REPORTED_FAULTS` — a Phase-4 caller obligation

`records.record_findings([], kind, resolved)` with no `reason` raises `FindingError`, which is not a
reported fault, so it prints a traceback. Exit 2 is correct; the presentation is not ideal. **Left
as-is**: both classes' docstrings deliberately argue they are programming errors that should be loud,
and supplying the zero-cardinality reason is the caller's responsibility. **Recorded as a contract
note for Phase 4's C1/C2**: every caller of `record_findings` must pass a `reason`, because only the
caller can distinguish an absent manifest from an empty declaration (ADR-30 rules those differently).

## Obligation carried into Phase 6

**Phase 6's first task is the total write-seam invariant:** the bytes `generate` emits must preserve
every pre-existing record's `state` exactly and must never introduce `confirmed` for a record that was
not already `confirmed` — plus the closed-stdin/pty byte-identity fixture for `generate` itself.
This is written down here rather than remembered, because deleting the AST oracle is what makes it
load-bearing.
