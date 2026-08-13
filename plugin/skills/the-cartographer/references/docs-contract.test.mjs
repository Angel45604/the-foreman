// the-cartographer — the skill's own doc/code drift check.
//
// ADR C-006 makes validate.mjs the single executable source of truth for the IR and names PDR §7 as
// its human-readable contract. Two artifacts that must agree is exactly the drift class this skill
// exists to detect, so the agreement is TESTED rather than trusted: a rule the validator enforces
// but the docs do not state is a PHANTOM contract, and a rule the docs prescribe but the validator
// rejects makes a map built from the documentation invalid.
//
// Zero dependencies: node built-ins only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveEdgeId } from './validate.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DOCS = path.resolve(HERE, '../../../..', 'docs/initiatives/2026-08-11-the-cartographer');
const PDR = path.join(DOCS, 'PDR.md');
const PLAN = path.join(DOCS, 'execution-plan.md');

/** The initiative docs live in the host repo, not inside the plugin: absent in a standalone install. */
const docsPresent = fs.existsSync(PDR) && fs.existsSync(PLAN);
const read = (p) => fs.readFileSync(p, 'utf8');

/** The text of one `## N · …` section, up to the next `## ` heading. */
function section(markdown, heading) {
  const start = markdown.indexOf(heading);
  assert.notEqual(start, -1, `the document must contain the section ${heading}`);
  const rest = markdown.slice(start + heading.length);
  const end = rest.indexOf('\n## ');
  return end === -1 ? rest : rest.slice(0, end);
}

test('the documented edge id is the TYPED form validate.mjs derives', (t) => {
  if (!docsPresent) return t.skip('initiative docs not present in this checkout');
  const pdr = read(PDR);
  const plan = read(PLAN);

  // The untyped shape COLLIDES when a control and a data edge join the same pair, so the validator
  // rejects it. A map built from the documented contract must not be rejected by the validator.
  // The rule is checked where it is PRESCRIBED — naming the untyped shape as the rejected one is
  // exactly what the plan should do.
  const edgeIdRule = plan.split('\n').find((l) => l.includes('**Edge id**'));
  assert.ok(edgeIdRule, 'execution-plan.md must state an edge-id derivation rule');
  assert.ok(edgeIdRule.includes('e.<kind>.<from>><to>'),
    `the edge-id rule must prescribe the typed form (got: ${edgeIdRule.trim()})`);
  assert.doesNotMatch(edgeIdRule, /=\s*`e\.<from>><to>`/,
    'the edge-id rule must not prescribe the untyped form — the validator rejects it');

  const typed = deriveEdgeId('mode.prepr', 'component.prepr_common', 'control');
  assert.ok(pdr.includes(`"id": "${typed}"`),
    `the PDR §7 IR example must carry the typed edge id ${typed}`);
  assert.ok(!pdr.includes('"id": "e.mode.prepr>component.prepr_common"'),
    'the PDR §7 IR example must not carry the untyped edge id');
});

test('the plan asks for the FOUR drift cases it goes on to enumerate', (t) => {
  if (!docsPresent) return t.skip('initiative docs not present in this checkout');
  const plan = read(PLAN);
  assert.ok(!/exactly three drift cases/i.test(plan),
    'Task 2 must not say "three" while enumerating four — Tasks 3 and 8 require four');
  assert.match(plan, /four drift cases/i);
});

test('PDR §7 states the rules validate.mjs actually enforces (ADR C-006)', (t) => {
  if (!docsPresent) return t.skip('initiative docs not present in this checkout');
  const ir = section(read(PDR), '## 7 · The IR contract');
  for (const [what, re] of [
    ['path containment', /contained|repo root|repo-relative/i],
    ['the .maps exclusion', /\.maps/],
    ['the claimKind ↔ source-role binding', /claimKind[\s\S]{0,200}role|role[\s\S]{0,200}claimKind/],
    ['contradiction matching against the node\'s own records', /contradiction/i],
    ['exact id derivation', /slugify/i],
    ['graph completeness', /endpoint/i],
  ]) {
    assert.match(ir, re, `PDR §7 must state ${what} — validate.mjs enforces it`);
  }
});

/**
 * The six regexes above are broad by design — they check that a TOPIC is present. Presence of a
 * topic is not agreement on a rule: each of the rules below is one the validator FAILS CLOSED on,
 * and each was at some point enforced in code while the documentation said something weaker or
 * nothing at all. A rule enforced but undocumented is a phantom contract; a map built from the
 * documentation would be rejected by the implementation it was supposedly written against.
 */
test('PDR §7.1 states the FAIL-CLOSED rules validate.mjs enforces (ADR C-006)', (t) => {
  if (!docsPresent) return t.skip('initiative docs not present in this checkout');
  const enforced = section(read(PDR), '### 7.1 · What `validate.mjs` enforces');
  for (const [what, re] of [
    // coverage is a PARTITION — and in both directions, which is the half that was fail-open
    ['coverage classifying every path exactly once', /classified exactly once/i],
    ['coverage covering every DECLARED SOURCE, not only the reverse',
      /every `?sources\[\]`?[\s\S]{0,120}classified|every declared source[\s\S]{0,120}classified/i],
    ['that a read path must be hashed', /read[\s\S]{0,80}hashed|hashed[\s\S]{0,80}read/i],
    ['that partial / skipped state a reason', /state why|why this file/i],
    // derived drift stays out of the snapshot — at EVERY path, not one
    ['the derived-drift exclusion', /drift/],
    ['that the drift ban is document-wide, not one path', /drift[\s\S]{0,160}anywhere|anywhere[\s\S]{0,160}drift/i],
    ['ADR C-004 as the drift ban\'s source', /C-004/],
    // a STALE record must QUOTE both sides or it cannot be audited
    ['the asserted-side quote requirement', /claim\.text/],
    ['the observed-side quote requirement', /evidence\.note/],
    ['that an unquoted contradiction is unauditable', /unauditable|cannot be audited/i],
    // absent collections are violations, never empty defaults
    ['that absent collections fail closed', /fail closed|violation, not an empty default/i],
    ['which collections that covers', /sources[\s\S]{0,120}nodes[\s\S]{0,120}edges[\s\S]{0,120}views/],
    // attrs is the one free-form region, so it is the one place a non-JSON value can enter
    ['that nodes[].attrs must be plain JSON data', /attrs[\s\S]{0,120}JSON/],
    // …and the attrs ROOT is narrower than its contents, which the doc and the code disagreed on
    ['the attrs ROOT shape', /absent, `null`, or a plain object/],
    ['that a present-but-undefined attrs is a violation, not an absent key',
      /`attrs: undefined` is a violation, not an absent key/],
    // ── the INGEST BOUNDARY (rule 12). One definition of a legal map's shape, applied once ────────
    // Every phase before this one closed a round on the gap between what the validator read and what
    // the consumers read, so the doc must state that the rule is SHARED, not merely that it exists.
    ['the ingest boundary by name', /INGEST BOUNDARY/],
    ['that it is applied ONCE, at ingest', /applied ONCE, at ingest/],
    ['that every entry point reads through it', /`canonical\.mjs`/],
    ['which entry points those are',
      /validate\(\)[\s\S]{0,200}computeDrift\(\)[\s\S]{0,200}resolveView\(\)[\s\S]{0,200}serialize\(\)/],
    ['that what comes out is the value map.json carries', /the value `map\.json` itself carries/],
    ['that every property is read once, from its descriptor', /read exactly once[\s\S]{0,80}descriptor/],
    // the shapes it REFUSES, each of which was at some point a map that validated and then changed
    ['that an ACCESSOR is a violation', /accessor/i],
    ['that symbol-keyed and non-enumerable own properties are violations',
      /symbol-keyed[\s\S]{0,60}non-enumerable|non-enumerable[\s\S]{0,60}symbol-keyed/i],
    ['that an array HOLE is a violation', /hole[\s\S]{0,120}sparse array/i],
    ['that an EXOTIC object is a violation', /an \*\*exotic\*\*/],
    ['the exotic types it names', /`Map`, `Set`, `Date`/],
    // …and HOW an exotic is recognised. `Object.prototype.toString` decides it from a property the
    // input controls, so it refused plain objects wearing a tag, accepted a retagged `Map` and
    // emptied it to {}, and ran an inherited getter to find out — three ways for the value that
    // validated to differ from the value written, in the one check meant to prevent exactly that.
    ['that an exotic is recognised from INTERNAL SLOTS', /internal slots\*\*, never from `Symbol\.toStringTag`/],
    ['that a tag alone does not make a value exotic', /CLAIMS an exotic tag while holding no slots/],
    // …and what an array ELEMENT is, which is narrower than "a numeric-looking key" in two ways that
    // both silently dropped the value rather than reporting it
    ['the ECMAScript definition of an array index', /array index\*\* is the ECMAScript one/],
    ['the bound that definition carries', /2³²−2/],
    ['the two keys that bound excludes, by example', /`"4294967295"` and `"1e\+21"`/],
    ['that a function, symbol and BigInt are violations',
      /function[\s\S]{0,120}symbol[\s\S]{0,120}BigInt/],
    ['that an own undefined property is a violation — the key vanishes', /the key\s+vanishes/],
    ['that `attrs: undefined` and `edges: undefined` are ONE rule',
      /`attrs: undefined` and `edges: undefined` are one rule/],
    ['that a cycle is a violation', /and a \*\*cycle\*\*/],
    // …and the shapes it CARRIES THROUGH, which are just as load-bearing: refusing them would reject
    // a map whose serialization is perfectly legal
    ['what the boundary carries through rather than refusing', /CARRIED THROUGH/],
    ['that an INHERITED property is absent to every reader alike', /inherited\*\* property is dropped/],
    ['that an own `__proto__` key is DATA', /__proto__[\s\S]{0,12}key stays own DATA/],
    ['that -0 is carried as the 0 the file will hold', /`-0` becomes `0`/],
    // …and the property that makes rule 14's agreement structural rather than hand-maintained
    ['that the refusal names the path', /names the offending PATH/],
    ['that the reason is the same whichever entry point reports it',
      /the same sentence whichever entry point\s+reports it/],
    ['that neither artifact owns the rule', /neither artifact\s+owns the rule/],
    // every representability rule holds everywhere, not only inside attrs
    ['that these rules are rejected anywhere in the IR, not only inside attrs', /ANYWHERE in the IR/],
    // a view's reference lists are sets — the rule that closed the validator/renderer asymmetry
    ['that a view may not name the same reference twice', /SETS, not bags/],
    ['that the rule covers a table view too, not only a graph one', /`table` view as much as/],
    // …and the CLASS that rule belongs to: the render boundary may not hold shape rules of its own
    ['that every IR-SHAPE rule the render boundary enforces lives in the validator',
      /every rule about IR SHAPE[\s\S]{0,120}enforced by this\s+validator/],
    ['the two-way agreement that follows from it',
      /accepts is renderable[\s\S]{0,160}same stated reason/],
    // …and the two rules that class most recently produced: an edges list means the same thing in
    // every view form, and the hero's node cap is a CONTRACT rule, not a renderer's private one
    ['that only the PRESENCE of edges is graph-only, not the rules read over it',
      /presence\*\* of `edges` is the only part[\s\S]{0,200}graph-only|graph-only[\s\S]{0,200}absent one is legal/i],
    // …and that PRESENT means an ARRAY. The array check sat inside the same `if (isGraph)` that
    // reported an absent one, so a table view's `edges: null` validated clean and `resolveView`
    // threw on it — the rule-14 asymmetry in the shape of the key rather than in what it names.
    ['that a PRESENT edges key must BE an array, not merely carry legal contents',
      /`edges: null` is a violation and not an omission/],
    ['the svg-hero node cap', /`svg-hero` view is capped at 15 nodes/],
    ['the ADR it comes from', /C-002/],
    ['that the renderer imports the number rather than restating it', /renderer \*\*imports\*\* it/],
    ['that the cap does not apply to the mermaid views', /mermaid views carry no such bound/],
    // the return contract — validate() reports, it never throws
    ['that validate() never throws', /never throws/i],
    ['the exact return shape', /\{[^}]*ok[^}]*errors[^}]*warnings[^}]*containmentChecked[^}]*\}/],
  ]) {
    assert.match(enforced, re, `PDR §7.1 must state ${what} — validate.mjs enforces it`);
  }
});

test('PDR §7 states the timestamp rule serialize.mjs enforces (ADR C-003)', (t) => {
  if (!docsPresent) return t.skip('initiative docs not present in this checkout');
  const ir = section(read(PDR), '## 7 · The IR contract');
  for (const [what, re] of [
    ['that no wall-clock timestamp may appear in map.json', /no wall-clock timestamp/i],
    ['that BOTH ISO-8601 spellings are rejected', /basic[\s\S]{0,120}extended|extended[\s\S]{0,120}basic/i],
    ['the basic spelling by example', /20260811/],
    // the guard reads STRING TOKENS and refuses a date wherever a string can carry it — the
    // whole-value form this replaces exempted every date written into a sentence
    ['that the guard reads JSON string tokens, so a number is never a date', /string token/i],
    ['that a date embedded in PROSE is refused, not only a whole value', /prose/i],
    ['the ONE carve-out — a path token — and not "any longer string"', /path token/i],
    ['the dated-PATH carve-out that keeps it from firing on a path', /2026-08-11-the-cartographer/],
    ['that a date-TIME is caught down to the HOUR, not only to the minute', /hour/i],
    ['the calendar band that keeps an eight-digit id out of it', /1900[\s\S]{0,40}2199|20261301/],
    ['the precision the rule deliberately does NOT match', /coarser than a day|`2026-08`/],
  ]) {
    assert.match(ir, re, `PDR §7 must state ${what} — serialize.mjs enforces it`);
  }
});
