# Spec freeze — known debt carried into implementation

**Owner decision, 2026-08-13: the design bundle is FROZEN. Implementation starts at Phase 1.**

The `codex-gate` bundle loop never reached `APPROVE`. It was stopped deliberately, not skipped.

## Why the loop was stopped

| Repaired-gate round | Blockers | Decision-class | Bundle lines |
|---|---|---|---|
| 1 | 12 | 5 | 2,602 |
| 2 | 10 | 3 | 2,692 |
| 3 | 9 | 4 | 2,879 |
| 4 | 10 | 4 | 3,169 |
| 5 | 10 | 5 | (frozen here) |

Blockers held flat at 9–12 while the specification grew ~10% per round — a 22% increase across four
rounds. v0 was written at 1,988 lines to be "small enough to hold in your head"; it is now larger
than the pre-v0 bundle that was cut for being over-constrained (3,021).

Every individual finding was real and every fix was legitimate. The problem is structural: **closing
an ambiguity costs more text than the ambiguity did**, and that text is new surface for the next
round. Roughly 70% of the growth is fixture text, which is the deliverable, so there is nothing to
trim. A specification can always be made more precise; this loop has no natural terminator.

The counter-evidence was decisive. **Phase 0 — one empirical pass — settled more than three review
rounds did**, and everything it found came from running something: the shipped Codex binary not
reading the repo hook layer, a `/bin/echo` pin passing an exit-status floor check, a
"writes nothing" fixture that was vacuously green. None of it came from prose.

**Every unambiguous win in this initiative came from executing code or from deleting scope. None came
from another review round.**

## Open debt at freeze (gate round 5 — 10 blockers)

### Decision-class (5)

1. **A1/A2 are no longer reproducible as specified.** ADR-32 restricts claims to structured sections
   the-steward generates, but A1/A2 are prose-sourced failures from the reference repo. The headline
   acceptance criterion — "detects all three verified reference failures" — is now literally true for
   A3 only. **Resolve before writing the acceptance fixtures (Phase 4 / Phase 9).**
2. **No command grammar or working directory.** C1 stores a command string plus a `resolution` kind,
   but never defines the grammar or the repository-relative cwd. Ambiguous in multi-project repos.
3. **Index edge extraction undefined.** The routing map and orphan report are said to render "from
   the source corpus", but how edges are extracted is never specified.
4. **A3's fixture assumes a known tracked hooks directory `D`**, while the git substrate only
   resolves git's *effective* hooks path. Nothing defines `D`.
5. **Bootstrap ordering can still publish a manifest whose `$schema` is absent** — ADR-2 and ADR-20
   disagree on whether that state is reachable.

### Agent-fixable (5)

6. C4's scope: ADR-10 says the document-predicate corpus; P4.6 says every recorded `rendered`
   artifact. Two answers.
7. Ownership compares recorded vs on-disk bytes only — a foreign manifest can record an **in-tree
   symlink** and pass the digest check.
8. Rendering values verbatim inside a fenced block is unsafe when a value equals the fence delimiter.
9. `str.strip()` removes **Unicode** whitespace; the grammar specifies ASCII. Real behavioral gap.
10. `confidence` is required on every command/path record by one task, but defined as per-inference
    scan confidence by the ADR.

## How to treat this debt

- **Items 1, 2, 3, 4** block the phases that implement them (4, 6, 9) — resolve at that phase, with
  the owner, not now.
- **Items 6–10** are ordinary implementation bugs; fix them as the phase that touches them is built,
  RED-first.
- **Item 7 (symlink) is a safety issue** — it defeats create-only. Treat as a Phase 1 containment
  requirement, not a later nicety.
- Do **not** reopen the bundle loop to close these on paper. The freeze decision exists precisely
  because that loop does not terminate. Let the tests settle them.

## Standing constraints (unchanged by the freeze)

Everything cut stays cut: git hook · install transaction · recovery journal · rollback · launcher +
interpreter pin · CI ownership · tier matrix · harness-native hooks · adopt path · region protocol ·
every command-line flag · the line-count check · prose claim scanning.

v0 is: **scan · generate · check · doctor.** Create-only, zero flags, zero third-party dependencies,
Python 3.9 floor. It reports the truth about a repository; it never claims to enforce anything.
