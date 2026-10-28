---
name: codex-gate
description: Run the isolated Codex CLI reviewer for plan, bundle, phase and branch gates, decision grounding or read-only root-cause investigation. Use for independent review evidence, not as a substitute for human approval.
---

# Codex gate in Codex

Run the packaged `codex-gate.sh` as a separate, config-isolated read-only reviewer process. A Codex conductor and Codex reviewer provide process/context independence, not cross-vendor independence. Read [runtime.md](references/runtime.md) before invocation and the packaged [README.md](README.md) for the shared CLI/schema/coverage contract. Claude-specific driver labels in that shared README map to native spec/quality reviewers and the receiving host's supported human decision channel; they do not require Claude tools.

`<skill-dir>` is the actual directory containing this loaded SKILL.md. Always set `CODEX_GATE_RUNTIME=<skill-dir>/codex-gate.sh` and the explicit state/auth/session bindings described in runtime.md. Run from the target repository root for code-tier inspection. Never rely on the Claude default installation paths.

Modes: `plan <file>`, `bundle <dir>`, `phase-start <id>`, `phase-review <id>`, `prepr [base]`, `prepr-delta [base]`, `question <file>`, `investigate <brief>`, `config`. Use documented arguments from the shared contract. `config` is diagnostic, `phase-start` only captures a baseline, `question` is advisory and `investigate` proposes a fix; none is a review APPROVE.

For review modes capture the actual JSON status and per-round verdict. Only emitted APPROVE with valid evidence satisfies review. BLOCK requires reading findings: decision blockers go to the human; repair agent-fixable findings only within approved scope and re-review. INFRA_ERROR, OVERFLOW, missing/malformed verdicts, coverage gaps and non-convergence stop affected progression. Do not call a missing reviewer a pass. A prior APPROVE sentence without its verifiable files/content identity is insufficient.

Preserve default/owner model, effort, fan-out and cost controls. Never authenticate, copy credentials, modify host configuration or invoke paid/live reviews without authorization. Fixes are working-tree edits; this skill grants no commit/push/PR permission. For investigations honor the brief's allowed/forbidden probes; read-only filesystem sandbox does not make network/services side-effect-free. Missing a probe contract forbids side-effectful probes.
