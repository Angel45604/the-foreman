# HANDOFF — `the-steward` v0, Phase 3 onward

> **STATUS:** Phases 1 and 2 are **DONE and verified**. 483 tests green on both pinned interpreters.
> Design spec is **FROZEN** — do not reopen it.
>
> **YOUR JOB:** conduct Phases 3–9. You are the conductor: you do **not** implement. You dispatch
> fresh-context implementer subagents, review adversarially, verify by direct probe, and gate.
>
> **GIT DISCIPLINE:** LOCAL ONLY. Scoped per-phase commits are **authorized** — explicit paths,
> **never `git add -A`**, **never push**, **never open a PR**, never switch branches. You are in a
> dedicated worktree; a parallel initiative shares the same clone via a different worktree.

---

## §0 — Onboarding read-order (do this before anything else)

1. **`FROZEN-DEBT.md`** (this folder) — why the design gate was stopped, and the 10 open debt items
   with instructions per item. Read this first; it prevents you reopening a settled argument.
2. **`PDR.md`** — the problem, the locked decisions, the success criteria.
3. **`ADR.md`** — ~30 numbered decisions. When PDR/plan/ADR disagree, **the ADR wins** and you
   report the contradiction.
4. **`execution-plan.md`** — **Phase 3 is your scope.** The plan is unusually prescriptive; follow
   it literally.
5. **`verified-contracts.md`** — the Phase-0 empirical record. §2.3.x is load-bearing and several
   ADRs cite it.
6. This document, §2 onward.

---

## §1 — Git and verification baseline (exact, copy-pasteable)

**Worktree:** `~/personal/the-foreman-steward`
**Branch:** `feat/the-steward` · **HEAD:** `0409affd06b2e26bcfb88a4b3d5809deb08c9ae2`
**State:** clean, 14 ahead of `origin/main`, **NOT pushed**, no PR.

The 8 commits that are this initiative's (the other 6 are a sibling initiative's, inherited because
this branch was cut from their tip so the packaging tests would pass):

```
0409aff Own by record, share one deadline, and audit the oracles too
850b09b Answer from ownership, record every pipe failure, bound the cleanup
b79fc47 Bound the reads, make the paths literal, and widen the guard to both costumes
5882dd6 Audit every git call site, and guard the shape structurally
ea40d5b Close the P2 review defects: a failed git probe is never an answer
f6f4bf7 Implement the-steward Phase 2: the git substrate
db4f44a Implement the-steward Phase 1: skill packaging and core skeleton
64964b4 Add the-steward v0 design bundle
```

### Verification commands (these are the gate; run BOTH interpreters, always)

```
cd ~/personal/the-foreman-steward/plugin/skills/the-steward
/usr/bin/python3      -B -m unittest discover -s tests -t tests   # 3.9.6 floor
/usr/local/bin/python3 -B -m unittest discover -s tests -t tests   # 3.13.5
```

- ✅ **483 tests OK on both**, re-run by the outgoing conductor at HEAD. Takes ~100–135s each.
- ✅ Siblings unbroken: the-cartographer 285 pass, `codex-gate.test.sh` PASS=245 FAIL=0.
- ⚠️ `node --test plugin/` (bare directory) reports a spurious `ERR_TEST_FAILURE` — an invocation
  artifact. Use the **glob** form.
- **`-B` is mandatory on every invocation.** Bare `python3` writes `__pycache__` and breaks the
  read-only guarantee. There is a test asserting this; do not "simplify" it away.

---

## §2 — Mandated process (work the way this session worked)

**Per phase, in this order — this loop is what produced the quality:**

1. `codex-gate phase-start P<n>` **from this worktree** (it keys off shell cwd *and* branch).
2. Dispatch a **fresh-context implementer** (model **opus**, effort high) with the full task text and
   file anchors. It has zero context — spell everything out.
3. Dispatch an **adversarial reviewer** (also fresh, opus) whose primary job is *finding tests that
   prove nothing*, by mutating fixes away and confirming the test goes red.
4. **Verify yourself by direct probe.** A subagent's success summary is a claim. Build the attack,
   run the command, read the output. Every real finding this session came from doing this.
5. `codex-gate phase-review P<n>`, fold, re-gate until it stops finding things or the count goes flat.
6. Commit (explicit paths), then bring the human the **phase-boundary hard gate**.

**Skills:** `/the-foreman` (posture + gates) · `/codex-gate` (the independent second gate) ·
`/test-driven-development` (RED first, always) · `/systematic-debugging` (root-cause, never patch a
symptom) · `/verification-before-completion`.

**⚡ ULTRACODE posture:** optimize for the exhaustively-correct outcome; token cost is not a
constraint. Use dynamic Workflows for the structurable parts. Drive review adjudication yourself.

**Simpler is always better.** Nine design rounds taught this project that every added invariant is a
future defect. **Prefer deleting a rule to qualifying one.**

---

## §3 — The work

### DONE and verified

- **Phase 1** — `SKILL.md`, packaging, core skeleton (`scan`/`generate`/`check`/`doctor` dispatch),
  canonical JSON, manifest schema + validator, findings model, containment predicate, atomic write,
  import audit, dual-interpreter no-incidental-writes fixture.
- **Phase 2** — corpus enumeration (`git ls-files`, document predicate, two corpora), SHA-256 digests
  (one domain always), tri-state + dates, repo-root resolution + cleanliness oracle, read-only hooks
  inspection.

### NEXT: Phase 3 — the scanner

Read `execution-plan.md`'s Phase 3 section. It produces the scan findings that populate the manifest:
project roots, stacks, build/test/lint commands, docs scope, existing agent docs — **each with
evidence and a confidence level**. Note P3.5–P3.8 (scan-then-confirm reconciliation) were **moved
into Phase 3** from the old Phase 8; the plan header records the reorder.

Key contracts Phase 3 must honor: `confidence` is required **iff** the finding tier is `inferred`
(ADR-28) · `scan` **persists nothing** — `generate` is the sole persister (ADR-11) · confirmation is
a human editing the tracked manifest, **not** an interactive prompt.

### Open debt

`FROZEN-DEBT.md` lists 10 items, each tagged to the phase that resolves it. Items 1–4 need the
**owner** at their phase — do not decide them yourself.

---

## §4 — Gotchas (the highest-value bytes here)

1. **THE RECURRING DEFECT — thirteen instances closed so far.** *A failed or unsafe probe reported as
   a confident answer.* Three costumes: a raw non-zero status (`if code != 0: return X`), a swallowed
   `except` that manufactures a negative fact, and following a symlink so you answer about a
   **different file**. There is a structural guard (`test_imports.py`, `FAILED_PROBE_ALLOWLIST`)
   covering all three, extended to the test-support layer. **Expect a fourteenth.** When you find one,
   ask whether the guard should widen rather than adding a second guard.
2. **An audit over clean code reports nothing whether it works or not.** Two guards were shipped that
   could not be distinguished from broken ones until each was made to run its real aggregation over a
   *planted bad module*. Any new guard needs that self-check.
3. **Fixes generate defects here.** Multiple blockers this session were created by the previous fix
   pass — including a memory fix that introduced a partial-read hole, and a timeout fix that exceeded
   its own documented bound. Before writing a fix, ask what **new state** it makes reachable.
4. **`codex-gate` keys run dirs off shell cwd AND branch.** Run it from this worktree. If the branch
   changes mid-initiative, verdict files scatter across directories and cross-round diffing breaks.
5. **A shared clone caused four separate harms** before the worktree split: scattered gate verdicts,
   packaging files swept into a sibling's commit, concurrent memory-file edits, and mutual gate
   OVERFLOW (a phase diff containing 7,484 lines of someone else's work). **Stay in this worktree.**
6. **Two git call sites are deliberately NOT "fixed"** and are marked `DOCUMENTED AMBIGUITY`:
   `gitstate.last_commit_date` (`git log -1` exits 128 as the genuine answer "no commits yet") and
   `paths.repo_root`'s status branch (128 means both *not a repo* and *unreadable repo*). Forcing
   either breaks a real state. Do not let a future pass "helpfully" fix them.
7. **Test fixtures pass for the wrong reason more often than you'd think.** Caught this session: a
   fixture that replaced `PATH` instead of prepending (so the descendant died instantly), a
   `doCleanups()` inside a loop (so later iterations passed because cwd was gone), and a mutation that
   reddened nothing because two values coincided at an exact deadline.
8. **8 unenforced probe sites remain in individual test methods** (`test_corpus` 4, `test_gitstate` 2,
   `test_hooks` 1, `test_paths` 1). Deliberately not enforced — they fail one local assertion, not a
   shared oracle. Widening `SUPPORT_LAYER` to the full suite is one line once someone triages them.

---

## §5 — Safety rails

- **Never push, never open a PR, never `git add -A`, never switch branches.** Commits are local and
  scoped to explicit paths.
- **Do not touch `~/personal/the-foreman`** — that clone belongs to a sibling initiative
  (`feat/the-cartographer`), actively worked in a different session.
- **Do not reopen the frozen spec.** If the code contradicts an ADR, implement the ADR and *report*
  the contradiction. Escalate rather than self-defer scope.
- **Do not commit anything containing a personal path or the private reference repo's name.** The
  remote is **public**. The bundle was redaction-swept; re-check before any commit that touches docs.
- Decision-class blockers, `INFRA_ERROR`, `OVERFLOW`, or non-convergence → **STOP and surface to the
  human.** Do not design around them.
