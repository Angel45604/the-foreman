import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { HARD_GATE_IDS, ARTIFACT_TYPES, gateById } from './gate-contract.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL = readFileSync(join(HERE, '..', 'SKILL.md'), 'utf8');
const LIFECYCLE = readFileSync(join(HERE, 'lifecycle.md'), 'utf8');
const EVALS = JSON.parse(readFileSync(join(HERE, '..', 'evals', 'evals.json'), 'utf8'));

function skillSection6() { // the §6 stage list only (NOT §4's render-type catalog, NOT §7 mechanics)
  const s = SKILL.indexOf('## §6');
  const e = SKILL.indexOf('## §7', s);
  assert.ok(s !== -1 && e !== -1, 'SKILL.md must have §6 and §7 headers');
  return SKILL.slice(s, e);
}
function skillSection7to8() { // §7 gate prose + §8 dispatch policy (stops before Red Flags, which
  // deliberately hard-codes vivid gate→artifact pairings as anti-rationalization bulletproofing)
  const s = SKILL.indexOf('## §7');
  const e = SKILL.indexOf('## Red Flags', s);
  assert.ok(s !== -1 && e !== -1, 'SKILL.md must have §7 and Red Flags headers');
  return SKILL.slice(s, e);
}
function leakLines(text) { // a line "leaks" if it co-locates a hard-gate id with an artifact-TYPE token
  return text.split('\n').filter((line) =>
    HARD_GATE_IDS.some((id) => line.includes(id)) &&
    ARTIFACT_TYPES.some((t) => new RegExp(`\\b${t}\\b`).test(line)));
}

test('contract path: design-approval -> branch-posture -> plan-bundle -> plan-approval', () => {
  assert.equal(gateById('design-approval').to, 'branch-posture');
  assert.equal(gateById('branch-posture').to, 'plan-bundle');
  assert.equal(gateById('plan-approval').from, 'plan-bundle');
  assert.equal(gateById('plan-approval').to, 'phase-exec');
});
test('docs present "Branch posture" BEFORE "Plan-bundle" (matches the contract path)', () => {
  const s6 = skillSection6();
  assert.ok(s6.includes('Branch posture') && s6.includes('Plan-bundle'), 'SKILL §6 names both stages');
  assert.ok(s6.indexOf('Branch posture') < s6.indexOf('Plan-bundle'), 'SKILL §6 order');
  assert.ok(LIFECYCLE.includes('Branch posture') && LIFECYCLE.includes('Plan-bundle'), 'lifecycle.md names both stages');
  assert.ok(LIFECYCLE.indexOf('Branch posture') < LIFECYCLE.indexOf('Plan-bundle'), 'lifecycle.md order');
});
test('lifecycle.md narrative never co-locates a hard-gate id with an artifact-type token', () => {
  assert.deepEqual(leakLines(LIFECYCLE), [], 'id->artifact map must live ONLY in gate-contract.mjs');
});
test('SKILL.md §6 stage list never co-locates a hard-gate id with an artifact-type token', () => {
  assert.deepEqual(leakLines(skillSection6()), []);
});
// §7 discusses the gates in prose, so it is the section MOST likely to leak an id→artifact pairing
// (e.g. "live-run → … brief"); §8 rides along in the same slice. NOTE for editors: "render its
// Artifact" phrasing near a hard-gate id (here and in lifecycle.md) must never be "helpfully"
// tightened to the literal type name — that is exactly the drift this guard catches.
test('SKILL.md §7–§8 never co-locates a hard-gate id with an artifact-type token', () => {
  assert.deepEqual(leakLines(skillSection7to8()), []);
});
test('the §6 stage-4 dispatch defers to the §8 policy — no hardcoded implementer model', () => {
  const s6 = skillSection6();
  assert.match(s6, /per \*\*§8\*\*/, 'stage 4 must point dispatches at the §8 policy');
  assert.ok(!/fresh \*\*(opus|sonnet|haiku|fable)\*\*/.test(s6), 'no hardcoded implementer model in §6');
  assert.ok(SKILL.includes('## §8'), 'SKILL.md must have the §8 dispatch-policy section');
  assert.match(LIFECYCLE, /SKILL\.md §8/, 'lifecycle.md Stage 4 must point at the §8 policy');
  assert.ok(!/fresh \*\*(opus|sonnet|haiku|fable)\*\*/.test(LIFECYCLE), 'no hardcoded implementer model in lifecycle.md');
});
test('a dedicated dispatch/model-selection eval exists and pins shape-based tiering', () => {
  const e = EVALS.evals.find((x) => /dispatch/i.test(x.name || ''));
  assert.ok(e, 'a dispatch-policy eval must exist');
  assert.match(e.expected_output, /§8/, 'it must require consulting the §8 policy');
  assert.match(e.expected_output, /opus-class/i, 'it must pin a deep-tier floor for judgment-heavy work');
  assert.match(e.expected_output, /third identical retry|structural/i, 'it must pin the escalation ladder');
});
test('phase-boundary authorizes carries the batch-run sub-authorization with fail-closed voiding (ADR-008)', () => {
  const a = gateById('phase-boundary').authorizes;
  assert.match(a, /batch-run/, 'batch-run named in authorizes');
  assert.match(a, /VOID/i, 'void-on-non-green named in authorizes');
  assert.match(a, /still run/i, 'per-phase pipeline preservation named in authorizes');
});
// The skill is distributed into shared repos: its frontmatter must never pre-approve tools for
// every teammate's sessions (a permission grant shipped via git). Permission posture belongs to
// each user's/project's settings, not to the skill.
test('SKILL.md frontmatter carries NO allowed-tools permission grant', () => {
  const fm = SKILL.split('---')[1] ?? '';
  assert.ok(!/allowed-tools\s*:/i.test(fm), 'frontmatter must not contain allowed-tools');
});
test('a dedicated batch-run eval pins structured-grant, scope, and re-arm semantics', () => {
  const e = EVALS.evals.find((x) => /batch-run/i.test(x.name || ''));
  assert.ok(e, 'a batch-run eval must exist');
  assert.match(e.expected_output, /never as a grant by itself/i, 'chat instruction = trigger, not grant');
  assert.match(e.expected_output, /phase-start AND phase-review|closed set/i, 'per-phase codex calls still run');
  assert.match(e.expected_output, /VOID/i, 'grant voids on non-green');
});
test('lifecycle.md keeps the disclaimer that the id->artifact map lives only in the module', () => {
  assert.match(LIFECYCLE, /only in the module|gate-contract\.mjs/i);
  assert.match(LIFECYCLE, /--print|authoritative/i);
});
test('behavioral eval id 8 (Artifact unavailable) requires open-artifact.mjs / a browser tab', () => {
  const e8 = EVALS.evals.find((e) => e.id === 8);
  assert.ok(e8, 'eval id 8 exists');
  assert.match(e8.expected_output, /open-artifact\.mjs|chrome tab|browser tab/i);
});
// Now that escalation.mjs (Phase B) exists AND §7 documents the file-based fallback (Phase C), this
// pin is no longer premature: the DEDICATED "AskUserQuestion unavailable" eval must require the
// escalation path. Pin that scenario directly (by its name+prompt). Matching on an incidental
// `escalation.mjs` mention would false-green on eval 8 (Artifact-unavailable), which also references
// the escalation fallback as a hypothetical — the guard could then pass even if the dedicated eval were
// deleted. AskUserQuestion-unavailable is the discriminator eval 8 cannot satisfy: it never names
// AskUserQuestion in its scenario (name/prompt), only in its expected_output narrative.
test('the dedicated "AskUserQuestion unavailable" eval requires the escalation fallback', () => {
  const scenario = (x) => `${x.name || ''} ${x.prompt || ''}`;
  const e = EVALS.evals.find((x) =>
    /askuserquestion/i.test(scenario(x)) && /unavail|isn'?t available|not available/i.test(scenario(x)));
  assert.ok(e, 'a dedicated eval whose SCENARIO is "AskUserQuestion unavailable" must exist');
  assert.match(e.prompt, /askuserquestion/i, 'the eval prompt must set up the AskUserQuestion-unavailable trigger');
  assert.match(e.expected_output, /escalation\.mjs/, 'it must require the escalation.mjs fallback');
  assert.match(e.expected_output, /read-once|answered|valid.*response|never advance/i, 'it must require a validated read-once answer / never-advance');
});
