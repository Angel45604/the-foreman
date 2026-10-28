# Reviewer invocation and continuity

Resolve `<skill-dir>` from the loaded skill. The unchanged sibling script and its schemas/personas/README are the canonical runtime; the installer copies all of them. Before a new initiative select writable state outside installation and unrelated Claude runs. Pass these command-scoped values with actual absolute paths:

```text
CODEX_GATE_RUNTIME=<skill-dir>/codex-gate.sh
CODEX_HOME_DIR=<initiative-state>/reviewer-home
CODEX_GATE_RUNS=<initiative-state>/reviews
CODEX_GATE_SESSION=<stable-initiative-session-id>
bash <skill-dir>/codex-gate.sh config
```

These are environment assignments, not extra positional script arguments. Use shell quoting for real paths containing spaces. Record the bindings. CODEX_GATE_RUNTIME affects config's selected runtime endpoint; it does not redirect the script being invoked, so also invoke the actual installed script above. Keep CODEX_GATE_MODEL/CODEX_GATE_EFFORT and other owner dials unchanged unless the owner chooses an override. `config` makes zero model calls, creates no run dir and proves no authentication or review. If the versioned source is absent, parity UNAVAILABLE is an honest diagnostic; it does not mean incomplete installed resources or a fabricated MATCH. Do not rewrite canonical runtime files or sync over Codex adapters to make parity green.

The shared script discovers its documented CLI locations; if unavailable detect an installed supported executable and use CODEX_BIN. Bash/Git/Node and the shared README's shell prerequisites remain necessary. Missing binaries/auth/quota are INFRA_ERROR, never approval. Surface the actual error; one bounded retry only if clearly transient. Dedicated login is user-controlled, for example a one-command `CODEX_HOME='<actual reviewer-home>' '<actual codex executable>' login`. This sets CODEX_HOME for that process only; never globally change HOME/CODEX_HOME or copy existing credentials. This adapter does not log in automatically.

## Review loop and baseline

Invoke a review's first round with `bash <skill-dir>/codex-gate.sh <mode> <arg> 1`; capture status JSON, verdictPath, runDir, round and threadId. Inspect evidence before accepting APPROVE. Feed concrete rebuttals/fixes back as a new round with the original threadId. Repeated same blocker without progress or the shared round cap stops the loop. On stop surface outcome, concrete findings, summary and evidence paths. Question-mode infra failure permits asking the scoped human decision without grounding after disclosure; review-mode failure never does.

Before fresh phase implementation run `phase-start <id>` exactly once and record RUNDIR/PHASE_HEAD. After independent native spec and quality review, write `<RUNDIR>/context.md` with phase goal, acceptance, implementer result, both review outcomes/evidence and relevant project context. Then invoke phase-review to actual APPROVE. The wrapper tolerates absent context.md mechanically; Foreman's pipeline still requires it.

On resume preserve accessible CODEX_GATE_RUNS, CODEX_GATE_SESSION, phase ID, snapshot and PHASE_HEAD from the [shared checkpoint](../../handoff/references/continuity.md). Validate snapshot manifest and every listed baseline file identity. Never call phase-start again over mid-phase changes: it overwrites the baseline and can remove edits from coverage. If the old reviewer conversation cannot resume, start a fresh review round against the existing snapshot and context; record it as fresh. Do not copy its auth/home. Missing evidence leaves the review unverified, and relocation must not silently create a new baseline.

`prepr-delta` may narrow to changed/unreviewed content only when its ledger/hash evidence covers the rest. Shared sharding preserves full coverage. Multi-lens is supported only for prepr/prepr-delta and re-runs fresh, with no aggregate thread resume. Its resolved ultra+fan-out refusal remains enforced; do not bypass it or silently change owner effort. Consult README for exact dials and result files.
