// the-foreman lifecycle gate-enforcement contract — the SOLE source of truth (ADR-004).
// Declarative DATA: which lifecycle transitions are hard human gates vs auto-advance, what Artifact
// each renders, what surface enforces it, what it authorizes. It is declarative — it computes nothing
// about "current stage" and never touches the ledger. A script cannot call model tools (Artifact /
// AskUserQuestion); the AGENT does that. This module only DECLARES the mapping the agent + tests
// consult. lifecycle.md narrates the machine; this module is authoritative.

import * as templates from './templates.mjs';
import { isMain } from './is-main.mjs';

// Render-supported artifact types — each MUST be an exported templates.mjs function (asserted in tests).
// The first four are also wired into lifecycle transitions (below); the Phase-3 four
// (phaseTracker/findings/comparison/dashboard) are render-only composites — they have
// no lifecycle transition, so printable() surfaces them via a derived RENDER TYPES line.
export const ARTIFACT_TYPES = ['planDeck', 'brief', 'decisionCard', 'liveRun', 'phaseTracker', 'findings', 'comparison', 'dashboard'];

// The 5 v2-owned hard human gates (render-then-AskUserQuestion, ADR-005). The set is CLOSED.
export const HARD_GATE_IDS = ['plan-approval', 'phase-boundary', 'decision-fork', 'live-run', 'governance-pushback'];

// The whole lifecycle machine, in data. kind:
//   'hard-gate'  — v2-owned render-then-AskUserQuestion gate (the 5 above)
//   'auto'       — advances with verification; no human stop (null artifact/surface)
//   'delegated'  — a human stop owned by a delegated skill (not v2's contract)
//   'posture'    — enforced by the standing posture / deny rails, not a stop-and-ask
//   'checkpoint' — a pause that renders a companion brief; not an approval gate
export const TRANSITIONS = [
  { id: 'entry-to-brainstorm', kind: 'auto', from: 'entry', to: 'brainstorm',
    trigger: 'Stage-0 preflight ok + entry mode detected', artifact: null, surface: null, authorizes: '' },

  { id: 'design-approval', kind: 'delegated', from: 'brainstorm', to: 'branch-posture',
    trigger: 'brainstorming presents the design for approval', artifact: null, surface: null,
    authorizes: '', ownedBy: 'brainstorming' },

  // Branch posture comes BEFORE plan-bundle: the standing rule is "branch off the integration base
  // before any write/commit", and authoring the plan bundle is a write. (ADR-005 stage ordering.)
  { id: 'branch-posture', kind: 'auto', from: 'branch-posture', to: 'plan-bundle',
    trigger: 'branch-first posture established (worktree only on explicit ask / canon exception)',
    artifact: null, surface: null, authorizes: '' },

  { id: 'plan-approval', kind: 'hard-gate', from: 'plan-bundle', to: 'phase-exec',
    trigger: 'plan bundle ready and codex-gate bundle APPROVEd',
    artifact: 'planDeck', surface: 'AskUserQuestion',
    authorizes: 'approve the plan, and whether scoped per-phase LOCAL commits are authorized (default: no)' },

  { id: 'phase-boundary', kind: 'hard-gate', from: 'phase-exec', to: 'phase-exec-or-verify',
    trigger: 'a phase completed (both Claude reviews + codex phase-review APPROVE + verified)',
    artifact: 'brief', surface: 'AskUserQuestion',
    authorizes: 'approve continuing to the next phase (or stop / redirect); may ALSO grant batch-run (ADR-008) — auto-advance the remaining approved phases without per-boundary stops, VOID on the first non-green signal (per-phase codex calls, reviews, verification, and every other gate still run)' },

  // The two post-boundary branches — selected by the human's phase-boundary answer (not a free
  // auto-advance): loop back for the next phase, or (all phases done) proceed to verify → ship.
  { id: 'next-phase', kind: 'auto', from: 'phase-exec-or-verify', to: 'phase-exec',
    trigger: 'the phase-boundary was approved to CONTINUE and planned phases remain → loop to the next phase',
    artifact: null, surface: null, authorizes: '' },

  // verify runs AFTER an approved phase-boundary, on the path toward ship — it is NOT a competing exit
  // from phase-exec. The phase-boundary HARD GATE is the sole exit from phase-exec (no auto bypass);
  // verification is also a precondition baked into phase-boundary's trigger ("...+ verified").
  { id: 'verify', kind: 'auto', from: 'phase-exec-or-verify', to: 'verify',
    trigger: 'an approved phase-boundary with ALL planned phases complete → final verification before ship (verification-before-completion runs at every boundary; a win emits only on verified evidence)',
    artifact: null, surface: null, authorizes: '' },

  { id: 'ship', kind: 'posture', from: 'verify', to: 'ship',
    trigger: 'the human explicitly asks to ship (push / PR)',
    artifact: null, surface: null, authorizes: '',
    ownedBy: 'standing git-discipline posture + commit-push-pr (codex-gate prepr first)' },

  { id: 'handoff', kind: 'checkpoint', from: 'any', to: 'handoff',
    trigger: 'low context / a natural pause',
    artifact: 'brief', surface: null, authorizes: '', ownedBy: 'handoff (wrapped)' },

  { id: 'decision-fork', kind: 'hard-gate', from: 'any', to: 'any',
    trigger: 'a decision-class fork arises (architecture / data-model / API / irreversible)',
    artifact: 'decisionCard', surface: 'AskUserQuestion',
    authorizes: 'pick an option at the fork (Codex-grounded + attributed)' },

  { id: 'live-run', kind: 'hard-gate', from: 'any', to: 'any',
    trigger: 'before any live / paid / prod / irreversible run',
    artifact: 'liveRun', surface: 'AskUserQuestion',
    authorizes: 'authorize the live run after seeing cost / blast-radius / cleanup proof' },

  { id: 'governance-pushback', kind: 'hard-gate', from: 'any', to: 'any',
    trigger: 'an action would weaken a governance / safety / canon / PR / git-discipline gate',
    artifact: 'decisionCard', surface: 'AskUserQuestion',
    authorizes: 'decide whether to override the governance gate or take another path' },
];

export function hardGates() {
  return TRANSITIONS.filter((t) => t.kind === 'hard-gate');
}
export function gateById(id) {
  return TRANSITIONS.find((t) => t.id === id) ?? null;
}

// Human-readable rendering of the whole machine (the ONLY human-facing view → zero static-doc drift).
export function printable() {
  const header = `${'KIND'.padEnd(10)}  ${'ID'.padEnd(20)}  ${'ARTIFACT'.padEnd(12)}  ${'SURFACE'.padEnd(16)}  TRIGGER`;
  const rows = TRANSITIONS.map((t) =>
    `${t.kind.padEnd(10)}  ${t.id.padEnd(20)}  ${(t.artifact ?? '—').padEnd(12)}  ${(t.surface ?? '—').padEnd(16)}  ${t.trigger}`);
  // The render-then-ask protocol sources the AskUserQuestion from each hard gate's `authorizes`, so the
  // human-readable view must surface it (the table alone would hide it).
  const auth = ['', 'HARD-GATE AUTHORIZES (what the human decides at each gate):',
    ...hardGates().map((g) => `  ${g.id.padEnd(20)}  ${g.authorizes}`)];
  // Render-type catalog — DERIVED from ARTIFACT_TYPES so EVERY render-supported type is surfaced, not
  // just the four wired into transitions. The Phase-3 composites (phaseTracker/findings/comparison/
  // dashboard) are render-only (no lifecycle transition), so this is the only place they appear — the
  // `printable() renders all ARTIFACT_TYPES` test depends on this line.
  const renderTypes = ['', `RENDER TYPES: ${ARTIFACT_TYPES.join(', ')}`];
  return [header, ...rows, ...auth, ...renderTypes].join('\n');
}

// CLI: `node gate-contract.mjs --print` -> prints the table.
if (isMain(import.meta.url)) {
  if (process.argv.includes('--print')) {
    console.log(printable());
  } else {
    console.error('usage: gate-contract.mjs --print');
    process.exit(2);
  }
}
