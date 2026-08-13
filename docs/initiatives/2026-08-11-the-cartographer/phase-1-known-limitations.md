# Phase 1 — known limitations (recorded, not fixed)

**State:** 75 tests passing. `codex-gate phase-review P1` ran 4 rounds against the code:
**8 → 5 → 4 → 5** code-scoped blockers. The gate's verdict is still **BLOCK** — this document records
what remains and why it was not fixed. **Nothing here is a claim that the gate approved.**

## What the gate caught and we DID fix

These were real and are closed, each with a red test written first:

- **`__proto__` prototype pollution in `normalize`** — an own `__proto__` key was treated as a prototype
  mutation, silently dropping valid `attrs` data and letting a timestamp inside that subtree bypass the
  ADR C-003 guard entirely.
- **`Date` reconstruction destroying timestamps** — a loose `typeof v === 'object'` check rebuilt a
  `Date` from its zero own keys into `{}`, erasing the very value C-003 exists to catch.
- **Vacuous freshness pass** — `checkFreshness({sources: []})` returned `fresh: true`.
- **Fail-open coverage** — the partition ran one direction only; emptying `coverage.read` still validated.
- **Unauditable STALE records** — a contradiction carrying only `{path,line}` validated, with no claim
  text or evidence note.
- **Derived drift bypass** — the ADR C-004 ban checked only `nodes[].attrs.drift`; `map.drift`,
  `subject.drift`, `edges[].drift` and any nested `attrs.audit.drift` all validated clean.
- **Sparse arrays, symbol keys, accessors, non-enumerable properties, cycles** — input that validated
  and then serialized to *different data*, or threw `RangeError` during serialization.
- **Doc/code drift in our own bundle** — PDR §7 was named by ADR C-006 as the IR contract but stated
  none of the rules `validate.mjs` enforces. Now §7.1, guarded by `docs-contract.test.mjs` so it cannot
  silently drift again. (The skill detecting its own drift class is the point.)

## What remains open, and the reasoning for stopping

The threat model matters. `map.json` has **exactly one producer — our own extractor.** The C-003 guard
exists to stop *us* accidentally writing a generation timestamp into the snapshot and churning every
structural diff. It is not an adversarial parser boundary, and no untrusted party authors this file.

| # | Finding | Assessment |
|---|---|---|
| 1 | `validate.mjs:119` — `isObj` accepts inherited/exotic records; a prototype-backed record is read normally by schema checks and the document-wide walk | **Has genuine merit.** The one worth doing. Same class as the `__proto__` bug already fixed, one level out. Recommended as the first item if Phase 1 is reopened. |
| 2 | `validate.mjs:391` — `isArrayIndex` accepts `4294967295` and larger canonical numeric names, which are not real array indices | Negligible. Requires a hand-crafted `attrs` array with a property at 2³²−1. |
| 3 | `serialize.mjs:74` — detection scans escaped JSON token text, so an actual newline/tab before a date is `\n`/`\t` and defeats the boundary | Low. Requires a citation quoting a source line with an embedded literal newline followed by a date. |
| 4 | `serialize.mjs:55` — ISO ordinal and week-date timestamps (`2026-223T13:45Z`, `2026-W33-2T13:45Z`) pass | Negligible. No producer emits these; `new Date().toISOString()` is extended calendar form. |
| 5 | `serialize.mjs:55` — the basic date-time branch accepts any eight digits, so `20261301T13` is rejected though its date part is invalid | Cosmetic: an inconsistency with PDR §7's calendar-band carve-out, not a fail-open. |

**Item 1 — CLOSED 2026-08-13.** `isObj` no longer decides what a record is: every entry point ingests
its input through `references/canonical.mjs` first, so a prototype-backed record is rebuilt from its
own properties (the inherited fields are absent, exactly as they are in the file) and an exotic one is
refused.

**Item 2 — CLOSED 2026-08-13.** `canonical.mjs`'s `isArrayIndex` is now the ECMAScript definition — a
canonical numeric string at most 2³²−2 — so `"4294967295"` and `"1e+21"` are refused as own properties
on an array rather than mistaken for elements and dropped in silence. The assessment above still reads
correctly (it takes a hand-crafted array to reach), but the fix is three lines and the failure mode was
the one this boundary exists to prevent: a value that passes every check and is then written nowhere.
Items 3–5 stand as recorded — all three are the C-003 guard, which this change does not touch.

**Why stop here rather than keep going:** the code-scoped trajectory is flat at ~5 across four rounds,
and the findings have migrated from real defects (silent data loss, prototype pollution, vacuous passes)
to ISO-8601 notation pedantry. Continuing hardens a guard against inputs that cannot occur, at the cost
of complexity in the module whose entire job is to be boringly deterministic — which `keep-it-simple`
weighs against directly.

**This is a judgement, not a verdict.** `codex-gate` still says BLOCK. Reopening item 1 is cheap and
defensible; items 2–5 should be closed as won't-fix unless `map.json` ever gains a producer we do not
control — at which point every one of them becomes live and this table is the checklist.
