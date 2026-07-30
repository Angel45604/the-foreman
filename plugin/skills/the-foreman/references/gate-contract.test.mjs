import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as templates from './templates.mjs';
import { TRANSITIONS, HARD_GATE_IDS, ARTIFACT_TYPES, hardGates, gateById, printable } from './gate-contract.mjs';

// LITERAL oracle — independent of the module, so a coordinated edit to BOTH TRANSITIONS and
// HARD_GATE_IDS still fails the test (the curated five can't silently drift). ADR-004/ADR-005.
const EXPECTED_HARD_GATE_IDS = ['plan-approval', 'phase-boundary', 'decision-fork', 'live-run', 'governance-pushback'];

test('exactly the 5 CANONICAL ids are hard gates (literal oracle — coordinated edits cannot drift)', () => {
  const expected = [...EXPECTED_HARD_GATE_IDS].sort();
  assert.deepEqual([...HARD_GATE_IDS].sort(), expected);                                  // the constant
  const derived = TRANSITIONS.filter((t) => t.kind === 'hard-gate').map((t) => t.id).sort();
  assert.deepEqual(derived, expected);                                                    // and the DATA, independently
  assert.equal(hardGates().length, 5);
});
test('all transition ids are unique', () => {
  const ids = TRANSITIONS.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length);
});
test('every hard gate has a non-empty authorizes', () => {
  for (const g of hardGates())
    assert.ok(typeof g.authorizes === 'string' && g.authorizes.trim().length > 0, `${g.id} authorizes`);
});
test('every hard gate surface is AskUserQuestion (NEVER ExitPlanMode)', () => {
  for (const g of hardGates()) assert.equal(g.surface, 'AskUserQuestion', `${g.id} surface`);
});
test('no transition of ANY kind uses ExitPlanMode', () => {
  for (const t of TRANSITIONS) assert.notEqual(t.surface, 'ExitPlanMode', `${t.id}`);
});
test('every hard gate artifact is in the set AND maps to a real templates.mjs export', () => {
  for (const g of hardGates()) {
    assert.ok(ARTIFACT_TYPES.includes(g.artifact), `${g.id} artifact in set`);
    assert.equal(typeof templates[g.artifact], 'function', `${g.id} -> templates.${g.artifact}()`);
  }
});
test('ARTIFACT_TYPES all map to exported templates.mjs functions', () => {
  for (const a of ARTIFACT_TYPES) assert.equal(typeof templates[a], 'function', a);
});
test('auto transitions carry no artifact/surface', () => {
  for (const t of TRANSITIONS.filter((x) => x.kind === 'auto')) {
    assert.equal(t.artifact, null, `${t.id} artifact`);
    assert.equal(t.surface, null, `${t.id} surface`);
  }
});
test('gateById resolves a known gate and returns null otherwise', () => {
  assert.equal(gateById('plan-approval')?.kind, 'hard-gate');
  assert.equal(gateById('nope'), null);
});
test('printable() renders all 5 hard-gate ids and their artifact names', () => {
  const out = printable();
  for (const id of HARD_GATE_IDS) assert.match(out, new RegExp(id));
  for (const a of ARTIFACT_TYPES) assert.match(out, new RegExp(a));
});
test('every transition artifact (any kind, when non-null) is in ARTIFACT_TYPES and maps to a real template', () => {
  for (const t of TRANSITIONS.filter((x) => x.artifact !== null)) {
    assert.ok(ARTIFACT_TYPES.includes(t.artifact), `${t.id} artifact in set`);
    assert.equal(typeof templates[t.artifact], 'function', `${t.id} -> templates.${t.artifact}()`);
  }
});
test('every transition kind is one of the documented enum values', () => {
  const KINDS = ['hard-gate', 'auto', 'delegated', 'posture', 'checkpoint'];
  for (const t of TRANSITIONS) assert.ok(KINDS.includes(t.kind), `${t.id} kind=${t.kind}`);
});
test('the phase-boundary HARD GATE is the ONLY transition out of phase-exec (no auto bypass)', () => {
  const out = TRANSITIONS.filter((t) => t.from === 'phase-exec');
  assert.deepEqual(out.map((t) => t.id), ['phase-boundary']);
  assert.equal(out[0].kind, 'hard-gate');
});
test('printable() surfaces each hard gate authorizes text (the protocol depends on it)', () => {
  const out = printable();
  for (const g of hardGates()) assert.ok(out.includes(g.authorizes), `${g.id} authorizes missing from --print`);
});
test('every non-"any" from-state is reachable from entry via the transition graph (no orphans)', () => {
  const linear = TRANSITIONS.filter((t) => t.from !== 'any');
  const reachable = new Set(['entry']);
  for (let changed = true; changed; ) {
    changed = false;
    for (const t of linear)
      if (reachable.has(t.from) && t.to !== 'any' && !reachable.has(t.to)) { reachable.add(t.to); changed = true; }
  }
  for (const t of linear) assert.ok(reachable.has(t.from), `from-state '${t.from}' (${t.id}) is unreachable`);
});
test('only the posture ship transition may enter the ship state (no auto/hard-gate bypass to ship)', () => {
  const toShip = TRANSITIONS.filter((t) => t.to === 'ship');
  assert.deepEqual(toShip.map((t) => t.id), ['ship']);
  assert.equal(toShip[0].kind, 'posture');
});
test('an approved phase-boundary can loop to the next phase OR proceed to verify (both branches exist, post-gate)', () => {
  const postState = gateById('phase-boundary').to; // 'phase-exec-or-verify'
  const branches = TRANSITIONS.filter((t) => t.from === postState);
  assert.deepEqual(branches.map((t) => t.to).sort(), ['phase-exec', 'verify']); // loop back AND proceed
  // both are post-gate auto branches (the human's boundary answer selects which) — neither skips a hard gate
  assert.ok(branches.every((t) => t.kind === 'auto'), 'post-boundary branches must be auto (selected by the boundary answer)');
});

// ---- Phase 3: the four new render-supported types are registered ----

test('the 4 Phase-3 types are in ARTIFACT_TYPES and map to templates.mjs exports', () => {
  for (const a of ['phaseTracker', 'findings', 'comparison', 'dashboard']) {
    assert.ok(ARTIFACT_TYPES.includes(a), `${a} in ARTIFACT_TYPES`);
    assert.equal(typeof templates[a], 'function', `${a} -> templates.${a}()`);
  }
});

test('HARD_GATE_IDS is STILL the closed 5 (Phase 3 added render types, not gates)', () => {
  assert.deepEqual([...HARD_GATE_IDS].sort(), [...EXPECTED_HARD_GATE_IDS].sort());
  assert.equal(hardGates().length, 5);
});

test('printable() renders ALL ARTIFACT_TYPES (incl. the 4 new render-only types not in the transition table)', () => {
  const out = printable();
  for (const a of ARTIFACT_TYPES) assert.match(out, new RegExp(a));
  // the 4 new ones are render types, NOT lifecycle transitions, so they only
  // appear via the derived RENDER TYPES catalog line — assert each is present.
  for (const a of ['phaseTracker', 'findings', 'comparison', 'dashboard']) assert.match(out, new RegExp(a));
});
