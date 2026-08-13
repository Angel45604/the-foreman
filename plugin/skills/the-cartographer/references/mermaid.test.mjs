import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeDrift } from './diff.mjs';
import { MERMAID_TYPES } from './validate.mjs';
import { renderMermaid, mermaidNodeId } from './mermaid.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, 'fixtures', 'tiny.map.json');
const loadMap = () => JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
const viewOf = (map, id) => map.views.find((v) => v.id === id);

const lines = (out) => out.split('\n').map((l) => l.trim()).filter(Boolean);
const declarations = (out) => lines(out).filter((l) => /^\S+\[".*"\]$/.test(l) || /^state ".*" as \S+$/.test(l));

/** The label a declaration line carries, in either syntax. */
function labelOf(line) {
  const flow = /^\S+\["(.*)"\]$/.exec(line);
  if (flow) return flow[1];
  const state = /^state "(.*)" as \S+$/.exec(line);
  assert.ok(state, `not a node declaration: ${line}`);
  return state[1];
}

const cite = (line, note) => ({ path: 'a/run.sh', line, note });

/** A node that raises exactly one class, so a view's drift can be composed test by test. */
function driftNode(id, kind, label, lane, cls) {
  const base = { id, kind, label, lane, inferred: false, evidence: [], claims: [] };
  if (cls === 'PHANTOM') {
    return { ...base, claims: [{ path: 'a/SKILL.md', line: 4, text: `${label} exists.`, claimKind: 'doc', checked: true }] };
  }
  if (cls === 'UNVERIFIED') {
    return { ...base, claims: [{ path: 'a/SKILL.md', line: 5, text: `${label} may exist.`, claimKind: 'doc', checked: false }] };
  }
  if (cls === 'UNDOCUMENTED') {
    return { ...base, evidence: [cite(3, `${label}=1`)] };
  }
  return {
    ...base,
    evidence: [cite(9, `${label} to stderr`)],
    claims: [{ path: 'a/SKILL.md', line: 6, text: `${label} goes to stdout.`, claimKind: 'doc', checked: true }],
    contradictions: [{
      claim: { path: 'a/SKILL.md', line: 6, text: `${label} goes to stdout.` },
      evidence: cite(9, `${label} to stderr`),
      statement: `The doc says ${label} goes to stdout; the code writes it to stderr.`,
    }],
  };
}

/** Render a synthetic map's single view through the real drift engine. */
function render(map) {
  return renderMermaid(map.views[0], map, computeDrift(map).findings);
}

// ─── the two syntaxes are genuinely different languages ──────────────────────────────────────────

test('1 · a flowchart view emits flowchart syntax', () => {
  const map = loadMap();
  const out = renderMermaid(viewOf(map, 'control-flow'), map, computeDrift(map).findings);
  assert.match(out, /^flowchart (?:LR|TD|TB)\n/, 'the first line declares the diagram type');
  assert.equal(declarations(out).length, 3);
  assert.match(out, /^\s*\S+\["tiny_core"\]$/m, 'flowchart nodes use bracket-quote syntax');
  // `mode.check` is STALE in the fixture, so its label carries the class — drift reaches the label,
  // it is not confined to the classDef.
  assert.match(out, /^\s*\S+\["check \(STALE\)"\]$/m);
  assert.match(out, /-->\|emits\|/, 'flowchart edges carry their label between pipes');
  assert.doesNotMatch(out, /^\s*state "/m);
});

test('2 · a stateDiagram-v2 view emits STATE-DIAGRAM syntax, never flowchart syntax', () => {
  const map = {
    nodes: [
      { id: 'state.idle', kind: 'state', label: 'idle', lane: 'entry', inferred: false,
        evidence: [cite(1, 'idle')], claims: [{ path: 'a/SKILL.md', line: 1, text: 'starts idle', claimKind: 'doc', checked: true }] },
      { id: 'state.running', kind: 'state', label: 'running', lane: 'core', inferred: false,
        evidence: [cite(2, 'running')], claims: [{ path: 'a/SKILL.md', line: 2, text: 'then runs', claimKind: 'doc', checked: true }] },
    ],
    edges: [{ id: 'e.control.state.idle>state.running', from: 'state.idle', to: 'state.running',
      kind: 'control', label: 'start', evidence: [cite(3, 'start')] }],
    views: [{ id: 'states', form: 'mermaid', mermaidType: 'stateDiagram-v2', title: 'tiny — states',
      nodes: ['state.idle', 'state.running'], edges: ['e.control.state.idle>state.running'] }],
  };
  const out = render(map);

  assert.match(out, /^stateDiagram-v2\n/);
  assert.match(out, /^\s*state "idle" as \S+$/m, 'states are declared, not bracketed');
  assert.match(out, /^\s*\S+ --> \S+: start$/m, 'a transition label follows a colon');

  // The two failure modes the plan names explicitly.
  assert.doesNotMatch(out, /\[".*"\]/, 'flowchart node brackets must never appear in a state diagram');
  assert.doesNotMatch(out, /-->\|/, 'the flowchart pipe-label form must never appear in a state diagram');
  assert.doesNotMatch(out, /^flowchart/m);
});

test('3 · every mermaidType in the contract is emitted, so a new one cannot render as the wrong language', () => {
  assert.deepEqual([...MERMAID_TYPES].sort(), ['flowchart', 'stateDiagram-v2']);
});

// ─── node id sanitisation is INJECTIVE ───────────────────────────────────────────────────────────

test('4 · two ids that a naive non-alphanumeric→underscore map would COLLAPSE stay distinct', () => {
  const node = (id, label) => ({ id, kind: 'mode', label, lane: 'entry', inferred: false,
    evidence: [cite(1, id)], claims: [{ path: 'a/SKILL.md', line: 1, text: id, claimKind: 'doc', checked: true }] });
  const map = {
    nodes: [node('mode.a-b', 'a-b'), node('mode.a_b', 'a_b')],
    edges: [],
    views: [{ id: 'v', form: 'mermaid', mermaidType: 'flowchart', title: 'collision',
      nodes: ['mode.a-b', 'mode.a_b'], edges: [] }],
  };
  const out = render(map);
  // Assert the COUNT, not the scheme: two nodes in, two nodes drawn.
  assert.equal(declarations(out).length, 2, 'a collapsed id silently merges two nodes into one');
  assert.notEqual(mermaidNodeId('mode.a-b'), mermaidNodeId('mode.a_b'));

  // The property, not just the one example: distinct ids never share a mermaid id.
  const ids = ['a-b', 'a_b', 'a.b', 'a b', 'a__b', 'a-_b', 'a_-b', 'A_b', 'a', '_a', 'a_', 'a%b', 'ab'];
  const seen = new Map();
  for (const id of ids) {
    const mapped = mermaidNodeId(id);
    assert.equal(seen.get(mapped), undefined, `${id} and ${seen.get(mapped)} both map to ${mapped}`);
    assert.match(mapped, /^[A-Za-z][A-Za-z0-9_]*$/, `${mapped} is not a usable mermaid id`);
    seen.set(mapped, id);
  }
});

// ─── labels cannot terminate the grammar ─────────────────────────────────────────────────────────

test('5 · characters that terminate mermaid grammar cannot survive in a label', () => {
  const hostile = 'a["b"] | {c} <d> \n second line';
  const map = {
    nodes: [
      { id: 'mode.x', kind: 'mode', label: hostile, lane: 'entry', inferred: false,
        evidence: [cite(1, 'x')], claims: [{ path: 'a/SKILL.md', line: 1, text: 'x', claimKind: 'doc', checked: true }] },
      { id: 'mode.y', kind: 'mode', label: 'plain', lane: 'core', inferred: false,
        evidence: [cite(2, 'y')], claims: [{ path: 'a/SKILL.md', line: 2, text: 'y', claimKind: 'doc', checked: true }] },
    ],
    edges: [{ id: 'e.control.mode.x>mode.y', from: 'mode.x', to: 'mode.y', kind: 'control',
      label: hostile, evidence: [cite(3, 'e')] }],
    views: [{ id: 'v', form: 'mermaid', mermaidType: 'flowchart', title: 'hostile',
      nodes: ['mode.x', 'mode.y'], edges: ['e.control.mode.x>mode.y'] }],
  };
  const flow = render(map);
  assert.equal(declarations(flow).length, 2, 'the diagram still parses as two nodes');
  for (const decl of declarations(flow)) {
    for (const ch of ['[', ']', '|', '{', '}', '<', '>', '"']) {
      assert.ok(!labelOf(decl).includes(ch), `${ch} survived into a label: ${decl}`);
    }
  }
  const edgeLine = lines(flow).find((l) => l.includes('-->'));
  assert.equal(edgeLine.split('|').length, 3, 'a pipe inside an edge label would close it early');
  assert.equal(lines(flow).filter((l) => l.includes('-->')).length, 1, 'a newline must not split an edge in two');

  // Same map as a state diagram: the transition label additionally may not carry a `:`.
  const stateMap = { ...map, views: [{ ...map.views[0], mermaidType: 'stateDiagram-v2' }] };
  const state = render(stateMap);
  const transition = lines(state).find((l) => l.includes('-->'));
  const label = transition.slice(transition.indexOf(':') + 1);
  assert.ok(!label.includes(':'), `a second colon re-opens the label: ${transition}`);
  assert.ok(!label.includes('\n'));
  assert.ok(label.trim().length > 0, 'the label must survive sanitisation, not be deleted');
});

test('6 · a colon is preserved where it is legal and neutralised only where it is not', () => {
  const build = (mermaidType) => ({
    nodes: [
      { id: 'mode.x', kind: 'mode', label: 'x', lane: 'entry', inferred: false,
        evidence: [cite(1, 'x')], claims: [{ path: 'a/SKILL.md', line: 1, text: 'x', claimKind: 'doc', checked: true }] },
      { id: 'mode.y', kind: 'mode', label: 'y', lane: 'core', inferred: false,
        evidence: [cite(2, 'y')], claims: [{ path: 'a/SKILL.md', line: 2, text: 'y', claimKind: 'doc', checked: true }] },
    ],
    edges: [{ id: 'e.control.mode.x>mode.y', from: 'mode.x', to: 'mode.y', kind: 'control',
      label: 'reads env: HOME', evidence: [cite(3, 'e')] }],
    views: [{ id: 'v', form: 'mermaid', mermaidType, title: 't', nodes: ['mode.x', 'mode.y'],
      edges: ['e.control.mode.x>mode.y'] }],
  });
  const flow = lines(render(build('flowchart'))).find((l) => l.includes('-->'));
  assert.match(flow, /\|reads env: HOME\|/, 'a colon is harmless inside a flowchart pipe label');

  const state = lines(render(build('stateDiagram-v2'))).find((l) => l.includes('-->'));
  assert.equal(state.split(':').length, 2, 'a state transition may carry exactly one colon — its own');
});

// ─── drift classes on the map ────────────────────────────────────────────────────────────────────

test('7 · a classDef per drift class present, assigned to the affected nodes', () => {
  const map = {
    nodes: [
      driftNode('mode.ghost', 'mode', 'ghost', 'entry', 'PHANTOM'),
      driftNode('env.hidden', 'env', 'HIDDEN', 'external', 'UNDOCUMENTED'),
      driftNode('outcome.wrong', 'outcome', 'WRONG', 'output', 'STALE'),
      driftNode('flag.maybe', 'flag', 'maybe', 'core', 'UNVERIFIED'),
    ],
    edges: [],
    views: [{ id: 'v', form: 'mermaid', mermaidType: 'flowchart', title: 'all four', edges: [],
      nodes: ['env.hidden', 'flag.maybe', 'mode.ghost', 'outcome.wrong'] }],
  };
  const out = render(map);
  const classDefs = lines(out).filter((l) => l.startsWith('classDef'));
  const assignments = lines(out).filter((l) => l.startsWith('class '));
  assert.equal(classDefs.length, 4, 'one classDef per class actually present');
  assert.equal(assignments.length, 4, 'every drifting node is assigned its class');

  // Every classDef is USED, and every assignment refers to a DEFINED class — no dead styling.
  const defined = classDefs.map((l) => l.split(/\s+/)[1]);
  const used = assignments.map((l) => l.split(/\s+/)[2]);
  assert.deepEqual([...new Set(used)].sort(), [...defined].sort());
  for (const id of ['mode.ghost', 'env.hidden', 'outcome.wrong', 'flag.maybe']) {
    assert.ok(assignments.some((l) => l.split(/\s+/)[1] === mermaidNodeId(id)), `${id} is unstyled`);
  }
  // Each class is visually distinguishable — including UNVERIFIED.
  assert.equal(new Set(classDefs.map((l) => l.split(/\s+/).slice(2).join(' '))).size, 4);
});

test('8 · NO classDef is emitted when the view carries no drift', () => {
  const map = {
    nodes: [{ id: 'component.clean', kind: 'component', label: 'clean', lane: 'core', inferred: false,
      evidence: [cite(1, 'clean()')],
      claims: [{ path: 'a/SKILL.md', line: 1, text: 'clean does the thing.', claimKind: 'doc', checked: true }] }],
    edges: [],
    views: [{ id: 'v', form: 'mermaid', mermaidType: 'flowchart', title: 'clean', nodes: ['component.clean'], edges: [] }],
  };
  const out = render(map);
  assert.equal(computeDrift(map).findings.length, 0);
  assert.doesNotMatch(out, /classDef/);
  assert.doesNotMatch(out, /^class /m);
  assert.match(out, /\["clean"\]/, 'a clean node carries its plain label, with no drift suffix');
});

test('9 · a node with TWO classes takes one class assignment and still names both', () => {
  const map = {
    nodes: [{
      id: 'env.both', kind: 'env', label: 'BOTH', lane: 'core', inferred: false,
      evidence: [cite(3, 'BOTH=1')],
      claims: [{ path: 'a/run.sh', line: 2, text: '# BOTH defaults to 0', claimKind: 'code-comment', checked: true }],
      contradictions: [{
        claim: { path: 'a/run.sh', line: 2, text: '# BOTH defaults to 0' },
        evidence: cite(3, 'BOTH=1'),
        statement: 'The comment says BOTH defaults to 0; the code sets it to 1.',
      }],
    }],
    edges: [],
    views: [{ id: 'v', form: 'mermaid', mermaidType: 'flowchart', title: 'two classes', nodes: ['env.both'], edges: [] }],
  };
  assert.deepEqual(computeDrift(map).findings.map((f) => f.class).sort(), ['STALE', 'UNDOCUMENTED']);

  const out = render(map);
  const assignments = lines(out).filter((l) => l.startsWith('class '));
  assert.equal(assignments.length, 1, 'a node can only wear one style');
  assert.match(assignments[0], /Stale$/i, 'and it is the worst class');
  const label = labelOf(declarations(out)[0]);
  assert.match(label, /STALE/);
  assert.match(label, /UNDOCUMENTED/, 'the second class must not be silently dropped');
  assert.equal(lines(out).filter((l) => l.startsWith('classDef')).length, 1,
    'only the ASSIGNED class needs a definition — an unused classDef is styling no node wears');
});

// ─── bare source, deterministic, pure ────────────────────────────────────────────────────────────

test('10 · bare mermaid source — no fences, no HTML wrapper', () => {
  const map = loadMap();
  const out = renderMermaid(viewOf(map, 'control-flow'), map, computeDrift(map).findings);
  assert.ok(!out.includes('```'), 'the caller owns the fence');
  assert.ok(!out.includes('<'), 'no HTML, and no label may reintroduce an angle bracket');
  assert.ok(!out.startsWith('\n') && !out.endsWith('\n'), 'no stray leading or trailing blank line');
});

test('11 · deterministic, and it never mutates or aliases the map or the findings', () => {
  const map = loadMap();
  const { findings } = computeDrift(map);
  const mapBefore = JSON.stringify(map);
  const findingsBefore = JSON.stringify(findings);

  const once = renderMermaid(viewOf(map, 'control-flow'), map, findings);
  assert.equal(renderMermaid(viewOf(map, 'control-flow'), map, findings), once);

  const shuffled = { ...map, nodes: [...map.nodes].reverse(), edges: [...map.edges].reverse() };
  assert.equal(renderMermaid(viewOf(map, 'control-flow'), shuffled, [...findings].reverse()), once,
    'extractor order must not leak into the diagram');

  assert.equal(JSON.stringify(map), mapBefore);
  assert.equal(JSON.stringify(findings), findingsBefore);
});

test('12 · fails closed on a view it is not the renderer for', () => {
  const map = loadMap();
  assert.throws(() => renderMermaid(viewOf(map, 'overview'), map, []), /mermaid|form/i);
  assert.throws(() => renderMermaid(viewOf(map, 'capabilities'), map, []), /mermaid|form/i);
  const noType = { ...viewOf(map, 'control-flow'), mermaidType: undefined };
  assert.throws(() => renderMermaid(noType, map, []), /mermaidType/);
  const badType = { ...viewOf(map, 'control-flow'), mermaidType: 'sequenceDiagram' };
  assert.throws(() => renderMermaid(badType, map, []), /sequenceDiagram|mermaidType/);
  assert.ok(!/undefined|NaN/.test(renderMermaid(viewOf(map, 'control-flow'), map, computeDrift(map).findings)));
});

test('13 · findings is REQUIRED — omitting it would emit a drifting view with no classDef', () => {
  const map = loadMap();
  const view = viewOf(map, 'control-flow');
  const { findings } = computeDrift(map);
  assert.ok(findings.length > 0, 'the fixture must drift, or this test proves nothing');

  assert.throws(() => renderMermaid(view, map), /findings/,
    'a two-argument call must fail closed rather than default to "no drift"');
  assert.throws(() => renderMermaid(view, map, undefined), /findings/);

  assert.match(renderMermaid(view, map, findings), /classDef/, 'the drift is real and must be drawn');
  // An explicit [] stays legal — a caller asserting there is nothing to draw.
  assert.doesNotMatch(renderMermaid(view, map, []), /classDef/);
});

// ─── the stateDiagram-v2 breaker set, re-audited ─────────────────────────────────────────────────

/**
 * A state diagram whose ONE transition carries `edgeLabel` and whose first state carries
 * `nodeLabel`. Neither node drifts (evidence + a checked claim, no contradiction), so a label is
 * exactly what the sanitiser made of it, with no drift suffix in the way.
 */
const stateMap = (edgeLabel, nodeLabel = 'idle') => ({
  nodes: [
    { id: 'state.idle', kind: 'state', label: nodeLabel, lane: 'entry', inferred: false,
      evidence: [cite(1, 'idle')],
      claims: [{ path: 'a/SKILL.md', line: 1, text: 'starts idle', claimKind: 'doc', checked: true }] },
    { id: 'state.running', kind: 'state', label: 'running', lane: 'core', inferred: false,
      evidence: [cite(2, 'running')],
      claims: [{ path: 'a/SKILL.md', line: 2, text: 'then runs', claimKind: 'doc', checked: true }] },
  ],
  edges: [{ id: 'e.control.state.idle>state.running', from: 'state.idle', to: 'state.running',
    kind: 'control', label: edgeLabel, evidence: [cite(3, 'start')] }],
  views: [{ id: 'states', form: 'mermaid', mermaidType: 'stateDiagram-v2', title: 'tiny — states',
    nodes: ['state.idle', 'state.running'], edges: ['e.control.state.idle>state.running'] }],
});

/** The transition's DESCRIPTION — everything after the transition's own colon. */
function descriptionOf(out) {
  const line = lines(out).find((l) => l.includes('-->'));
  assert.ok(line, 'the transition must be emitted at all');
  return line.slice(line.indexOf(':') + 1);
}

test('14 · a state TRANSITION description carries no mermaid statement terminator', () => {
  // A transition description is UNQUOTED — it runs from the transition's colon to the end of the
  // statement — so every terminator in the grammar reaches it, unlike a quoted node label.

  // `;` ENDS the statement: `A --> B: first; second` makes `second` a bogus statement of its own,
  // which fails to parse and can blank the whole detail view.
  const semi = descriptionOf(render(stateMap('first; second')));
  assert.ok(!semi.includes(';'), `a semicolon terminates the transition: ${semi}`);
  assert.match(semi, /first/);
  assert.match(semi, /second/, 'and neither half may be deleted to achieve that');

  // `%%` opens a comment that runs to end of line — it would swallow the rest of the label.
  const pct = descriptionOf(render(stateMap('99%% sure')));
  assert.ok(!pct.includes('%%'), `a %% comment swallows the rest of the label: ${pct}`);
  assert.match(pct, /sure/);
  assert.ok(!descriptionOf(render(stateMap('a %%%% b'))).includes('%%'),
    'and doubling up must not reassemble a comment marker');

  // `#NN;` is a mermaid entity code — read as a character escape, it silently rewrites the label.
  const entity = descriptionOf(render(stateMap('issue #35; closed')));
  assert.ok(!/#\d+;/.test(entity), `an entity code rewrites the label: ${entity}`);

  // Ground already held, re-asserted so a fix here cannot quietly regress it.
  assert.ok(!descriptionOf(render(stateMap('reads env: HOME'))).includes(':'), 'a second colon');
  const wrapped = render(stateMap('first\nsecond'));
  assert.ok(!descriptionOf(wrapped).includes('\n'));
  assert.equal(lines(wrapped).filter((l) => l.includes('-->')).length, 1, 'a newline must not split the edge');
  assert.ok(descriptionOf(wrapped).trim().length > 0, 'sanitising may not empty the label');

  // A state NODE label IS quoted (`state "…" as id`), so the quote is its breaker — already handled.
  const quoted = render(stateMap('start', 'say "hi" now'));
  const label = labelOf(declarations(quoted).find((l) => l.includes('hi')));
  assert.ok(!label.includes('"'), `a quote closes the state label early: ${label}`);
  assert.match(label, /hi/);
});

// ─── the flowchart PIPE label is an UNQUOTED position too ────────────────────────────────────────

/** A one-edge flowchart whose single edge carries `edgeLabel`. */
const flowMap = (edgeLabel) => ({
  nodes: [
    { id: 'mode.x', kind: 'mode', label: 'x', lane: 'entry', inferred: false,
      evidence: [cite(1, 'x')],
      claims: [{ path: 'a/SKILL.md', line: 1, text: 'x', claimKind: 'doc', checked: true }] },
    { id: 'mode.y', kind: 'mode', label: 'y', lane: 'core', inferred: false,
      evidence: [cite(2, 'y')],
      claims: [{ path: 'a/SKILL.md', line: 2, text: 'y', claimKind: 'doc', checked: true }] },
  ],
  edges: [{ id: 'e.control.mode.x>mode.y', from: 'mode.x', to: 'mode.y', kind: 'control',
    label: edgeLabel, evidence: [cite(3, 'e')] }],
  views: [{ id: 'v', form: 'mermaid', mermaidType: 'flowchart', title: 't',
    nodes: ['mode.x', 'mode.y'], edges: ['e.control.mode.x>mode.y'] }],
});

/** The text between the two pipes of the one emitted flowchart edge. */
function pipeLabel(out) {
  const line = lines(out).find((l) => l.includes('-->'));
  assert.ok(line, 'the transition must be emitted at all');
  const parts = line.split('|');
  assert.equal(parts.length, 3, `the label does not sit between exactly two pipes: ${line}`);
  return parts[1];
}

/** Every ASCII character that opens or closes a construct in the flowchart grammar. */
const PIPE_BREAKERS = ['[', ']', '{', '}', '<', '>', '(', ')', '"', '|', ';'];

test('15 · a flowchart PIPE label carries no character that terminates the unquoted edge grammar', () => {
  // `-->|…|` is NOT the quoted `["…"]` position: the label is a bare text run, so every shape and
  // group delimiter in the grammar reaches it directly. Worse, the sanitiser MANUFACTURED two of
  // them — `[`, `{` and `<` all became `(` — so a hostile label emitted `-->|a('b') / (c) (d)|`,
  // a parse failure assembled by the very function that exists to prevent one.
  const label = pipeLabel(render(flowMap('a["b"] | {c} <d> (e); f %% g')));
  for (const ch of PIPE_BREAKERS) {
    assert.ok(!label.includes(ch), `${ch} survived into an unquoted pipe label: ${label}`);
  }
  assert.ok(!label.includes('%%'), `a %% comment swallows the rest of the label: ${label}`);
  // …and nothing was deleted to achieve that.
  for (const word of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) {
    assert.match(label, new RegExp(`\\b${word}\\b`), `"${word}" was deleted rather than neutralised`);
  }

  // The PROPERTY, not the one example: the substitution table must be CLOSED — no substitution may
  // emit a character that is itself a breaker, or the sanitiser hands the parser the construct it
  // was removing. Feeding each breaker in on its own is what makes that closure observable.
  for (const ch of PIPE_BREAKERS) {
    const one = pipeLabel(render(flowMap(`x${ch}y`)));
    for (const breaker of PIPE_BREAKERS) {
      assert.ok(!one.includes(breaker),
        `the substitution for ${ch} emits ${breaker}, which is itself a breaker: ${one}`);
    }
    assert.match(one, /x/, `the substitution for ${ch} ate the text before it`);
    assert.match(one, /y/, `the substitution for ${ch} ate the text after it`);
  }
});
