import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
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

// ---- ADR-011: Opus conducts / Sonnet builds ----
const MINDSET = readFileSync(join(HERE, 'mindset.md'), 'utf8');
const flat = (s) => s.replace(/\s+/g, ' ');
function skillSection8() {
  const s = SKILL.indexOf('## §8');
  const e = SKILL.indexOf('## Red Flags', s);
  assert.ok(s !== -1 && e !== -1, 'SKILL.md must have §8 and Red Flags headers');
  return SKILL.slice(s, e);
}
function skillSection3() {
  const s = SKILL.indexOf('## §3');
  const e = SKILL.indexOf('## §4', s);
  assert.ok(s !== -1 && e !== -1, 'SKILL.md must have §3 and §4 headers');
  return SKILL.slice(s, e);
}

test('§8 encodes the conductor/builder split', () => {
  const s8 = flat(skillSection8());
  assert.match(s8, /\*\*standard\*\* → `sonnet`/);
  assert.match(s8, /\*\*deep\*\* → `opus`/);
  assert.match(s8, /conductor[^.]*runs deep/i);
  assert.match(s8, /builders run standard tier/i);
  assert.match(s8, /every review of a builder's diff/i);
  assert.match(s8, /split, not downgraded/i);
  assert.match(s8, /omitted model inherits the conductor's deep tier/i);
  assert.match(s8, /name the standard mapping explicitly/i);
  assert.doesNotMatch(s8, /strongest tier available/);
  assert.doesNotMatch(s8, /Sonnet 5 ≈/);
  const lc = flat(LIFECYCLE);
  assert.match(lc, /standard tier by default/);
  assert.match(lc, /both reviews run deep/);
  const rows = skillSection8().split('\n').filter((l) => l.startsWith('|'));
  const rowOf = (k) => rows.find((l) => l.includes(`**${k}**`));
  const fast = rowOf('fast'), standard = rowOf('standard'), deep = rowOf('deep');
  assert.ok(fast && standard && deep, '§8 table must carry fast, standard and deep rows');
  assert.doesNotMatch(standard, /spec-compliance|code-quality/i);
  assert.match(deep, /spec-compliance/);
  assert.match(fast, /never a code change/);
  assert.match(fast, /changes no files/);
  assert.match(s8, /never dispatch a code change at `low`/i);
  assert.match(s8, /overrides `subagent-driven-development`/);
  assert.match(s8, /opts\.effort/);
  assert.doesNotMatch(s8, /omit the model/i);
});

test('model names live only in the §8 mapping column', () => {
  const i = SKILL.indexOf('## §8'), j = SKILL.indexOf('## Red Flags', i);
  const skillMinusTable = SKILL.slice(0, i) + SKILL.slice(i, j).split('\n').filter((l) => !l.startsWith('|')).join('\n') + SKILL.slice(j);
  const re = /\b(opus|sonnet|haiku|fable)\b/i;
  const offending = (text) => text.split('\n').find((l) => re.test(l));
  assert.doesNotMatch(skillMinusTable, re, `SKILL.md outside the §8 table names a model: ${offending(skillMinusTable)}`);
  assert.doesNotMatch(LIFECYCLE, re, `lifecycle.md names a model: ${offending(LIFECYCLE)}`);
  assert.doesNotMatch(MINDSET, re, `mindset.md names a model: ${offending(MINDSET)}`);
});

test('§3 carries the conductor-tier NOTE, never a blocker', () => {
  const s3 = flat(skillSection3());
  assert.match(s3, /conductor tier is also a NOTE, never a blocker/i);
  assert.match(s3, /deep-tier mapping/i);
  assert.match(s3, /\/effort/);
});

test('handoff never hardcodes an implementer model', (t) => {
  const handoffDir = join(HERE, '..', '..', 'handoff');
  if (!existsSync(handoffDir)) { t.skip('handoff skill not installed alongside the-foreman'); return; }
  for (const f of ['SKILL.md', 'assets/handoff-template.md', 'assets/kickoff-prompt-template.md']) {
    const p = join(handoffDir, f);
    assert.ok(existsSync(p), `handoff/${f} missing`);
    const text = readFileSync(p, 'utf8');
    assert.doesNotMatch(text, /\b(opus|sonnet|haiku|fable)\b/i, `${f} names a model`);
  }
});

test('a conductor-builder-split eval exists and eval 10 reflects the split', () => {
  const split = EVALS.evals.find((e) => e.name === 'conductor-builder-split');
  assert.ok(split, 'evals.json must carry an eval named conductor-builder-split');
  const out = flat(split.expected_output);
  assert.match(out, /deep/);
  assert.match(out, /standard/);
  assert.match(out, /investigat/i);
  assert.match(out, /never implements|inline/i);
  const ids = split.criteria.map((c) => c.id);
  for (const id of ['builder-named-standard', 'judgment-split', 'no-downgrade-under-cost', 'reviews-deep', 'never-inline', 'no-top-tier-unasked']) {
    assert.ok(ids.includes(id), `conductor-builder-split is missing criterion ${id}`);
  }
  const e10 = EVALS.evals.find((e) => e.id === 10);
  assert.ok(e10, 'eval 10 must exist');
  assert.doesNotMatch(e10.expected_output, /haiku-class/i);
});
