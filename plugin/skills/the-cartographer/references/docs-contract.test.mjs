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
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveEdgeId, TABLE_COLUMN_KEYS, foldColumnName } from './validate.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DOCS = path.resolve(HERE, '../../../..', 'docs/initiatives/2026-08-11-the-cartographer');
const PDR = path.join(DOCS, 'PDR.md');
const PLAN = path.join(DOCS, 'execution-plan.md');

/** The initiative docs live in the host repo, not inside the plugin: absent in a standalone install. */
const docsPresent = fs.existsSync(PDR) && fs.existsSync(PLAN);
const read = (p) => fs.readFileSync(p, 'utf8');

/**
 * The C-015 scorer's `norm_outcome` helper, LIFTED OUT OF THE PLAN AND MADE RUNNABLE.
 *
 * A documented shell block is code nobody executes, so a test that only greps it pins its SPELLING.
 * This pulls the helper's own definition out of `execution-plan.md` — the definition the operator
 * would paste — and runs it under `bash` against one label at a time, so what is asserted below is
 * what the scorer WOULD DO. Nothing is transcribed: if the plan's line changes, this runs the changed
 * line, which is the only way a pin here can keep up with the document it guards.
 *
 * The definition is taken as the whole `norm_outcome() { … }` LINE, matched at column 0 so a mention
 * of the name in a comment or in prose is never mistaken for the definition.
 *
 * THE OUTPUT IS COMPARED AS BYTES, with no trailing-newline forgiveness, and that is load-bearing
 * rather than pedantic. `norm_outcome` maps ONE label to ONE token, and the defect this pin exists
 * for is precisely a helper that turns one label into TWO records: on
 * `exit 2\n(usage or precondition failure)` the line-oriented helper emitted `"exit 2\n"` — `exit 2`
 * and then an EMPTY second record — while the record-oriented one emits `"exit 2"`. Those two differ
 * in exactly one byte, so a probe that stripped a trailing newline "to be safe" would score the
 * broken helper as correct and pin nothing. `sed` and `tr` both leave the final newline off when
 * their input had none, and `printf '%s'` supplies none, so a correct helper carries none out.
 */
function normOutcomeFromPlan(plan) {
  const definitions = plan.split('\n').filter((l) => l.startsWith('norm_outcome() {'));
  assert.equal(definitions.length, 1,
    `the plan must define norm_outcome() exactly once, at column 0 (found ${definitions.length})`);
  const [definition] = definitions;
  assert.ok(definition.trimEnd().endsWith('}'),
    `norm_outcome() must be a ONE-LINE helper so it can be lifted whole (got ${JSON.stringify(definition)})`);
  return (label) => execFileSync(
    'bash',
    ['-c', `${definition}\nprintf '%s' "$1" | norm_outcome`, 'norm_outcome_probe', label],
    { encoding: 'utf8' },
  );
}

/** `jq` is the one non-builtin the call-site probe needs; without it the probe is skipped, not faked. */
function hasJq() {
  try {
    execFileSync('jq', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * The C-015 scorer's CALL SITE, lifted out of the plan and made runnable — framing plus decode.
 *
 * `normOutcomeFromPlan` runs the helper; this runs the two lines that FEED it, which is where the
 * remaining gap was. The pin it replaces asserted that one framing string was present and another
 * absent: a regex can see that `jq -c` is spelled at the top and that the bad `norm_outcome <` form is
 * gone, and it can see nothing about whether the framing and the decode COMPOSE. A `jq -c` that frames a
 * newline correctly is worth nothing if the decode below it unframes line-by-line, and that pairing is
 * the only thing the call site exists to get right.
 *
 * Three lines are taken from the document, each matched on a distinctive substring rather than
 * transcribed, so a changed plan is what runs:
 *   • the `norm_outcome() { … }` definition;
 *   • the `jq -c '[.nodes[]…]' "$CAND"` framing line;
 *   • the `tok=$(… | jq -r . | norm_outcome)` decode line.
 *
 * The ONLY edit is dropping the framing line's `> /tmp/got-labels` redirect, so the two can be composed
 * in a pipe rather than through a file at all — the probe writes nothing to disk. *(The reason given
 * here used to be that the initiative keeps artifacts out of `/tmp` "on principle". ADR C-024 records
 * that claim as FALSE: a session scratchpad under `/private/tmp` IS `/tmp` on macOS, and the rule was
 * always about durable evidence rather than directory names.)*
 * on principle. That substitution is ASSERTED, so nothing else can be quietly edited in on the way, and
 * `$CAND` is fed as `/dev/stdin` so the candidate never touches the filesystem either.
 */
function callSiteDecoderFromPlan(plan) {
  const lines = plan.split('\n');
  const pick = (what, predicate) => {
    const found = lines.filter(predicate);
    assert.equal(found.length, 1,
      `the plan must carry exactly one ${what} line (found ${found.length})`);
    return found[0];
  };

  const definition = pick('norm_outcome() definition', (l) => l.startsWith('norm_outcome() {'));
  const framing = pick('outcome-label framing', (l) => l.startsWith('jq -c \'[.nodes[]|select(.kind=="outcome")'));
  const decode = pick('outcome-label decode', (l) => l.trim().startsWith('tok=$(') && l.includes('norm_outcome'));

  // THE READER IS EXTRACTED, NOT SYNTHESIZED (round-6 gate). This probe used to hard-code
  // `while IFS= read -r j; do`, which is the one line in the chain that decides whether a JSON `\n`
  // escape survives. A documented loop that lost `-r` would corrupt every escaped label while this
  // "whole-chain" test stayed green — it was testing a reader the test wrote itself. The loop that
  // encloses the DECODE line is the one that matters, and the plan carries two identical headers, so
  // it is located by position relative to that line rather than by a uniqueness assumption.
  const decodeAt = lines.indexOf(decode);
  assert.ok(decodeAt >= 0, 'the decode line must be locatable in the plan');
  let openAt = -1;
  for (let i = decodeAt; i >= 0; i -= 1) {
    if (/^\s*while\b.*\bread\b.*;\s*do\s*$/.test(lines[i])) { openAt = i; break; }
  }
  assert.ok(openAt >= 0, 'the plan must open a read loop above the decode line');
  let closeAt = -1;
  for (let i = decodeAt; i < lines.length; i += 1) {
    if (/^\s*done\s*<\s*\S+\s*$/.test(lines[i])) { closeAt = i; break; }
  }
  assert.ok(closeAt >= 0, 'the plan must close that loop with a redirected `done`');
  const loopHeader = lines[openAt].trim();
  const doneLine = lines[closeAt].trim();

  const REDIRECT = ' > /tmp/got-labels';
  assert.ok(framing.endsWith(REDIRECT),
    `the framing line must end by writing the label list to a file (got ${JSON.stringify(framing)})`);
  const framingPiped = framing.slice(0, -REDIRECT.length);
  assert.ok(framingPiped.includes('"$CAND"'),
    'the framing line must read the candidate through $CAND, so the probe can substitute one');
  // …and the loop really is fed by the framing line's own output, or the two halves this probe
  // splices together were never one chain in the plan either.
  assert.equal(doneLine, `done <${REDIRECT.replace(' >', '')}`,
    `the decode loop must read the framing line's output file (got ${JSON.stringify(doneLine)})`);

  return (label) => {
    const map = { nodes: [{ id: 'outcome.probe', kind: 'outcome', label }] };
    const script = [
      definition,
      'CAND=/dev/stdin',
      // the plan's OWN loop header, verbatim — only its input is substituted (a pipe for the file)
      `${framingPiped} | ${loopHeader}`,
      `  ${decode.trim()}`,
      // `printf '%s'` and not `echo`: the token is compared as bytes by the caller, and a trailing
      // newline this probe added itself would forgive exactly the one-byte defect the helper pin exists
      // to catch.
      '  printf \'%s\' "$tok"',
      'done',
    ].join('\n');
    return execFileSync('bash', ['-c', script], { encoding: 'utf8', input: JSON.stringify(map) });
  };
}

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
    // …and WHICH words are wrong (ADR C-019). The two quotes above were the whole documented
    // contract, and "the record quotes both sides" is not the same rule as "the record names the
    // claim that is wrong": run 4 shipped a STALE whose citations both resolved, both deep-matched
    // one of the node's own records, and both carried their quote — pointing at a README line the
    // reviewer verified ACCURATE, while the genuinely stale claim sat unwired on the same node. A
    // §7.1 that pins only the two quotes lets §8 keep prescribing that record shape.
    ['the refuted-fragment requirement, by name', /`?refutedQuote`?/],
    ['that it is matched against the claim the record CITES',
      /refutedQuote[\s\S]{0,400}(fragment of `?claim\.text`?|occurs? in|matched against)/i],
    ['that claim and evidence are ROLES, not two interchangeable locations',
      /\*\*roles\*\*, not two interchangeable locations|roles[\s\S]{0,80}refuted side/i],
    ['that a wrong POINTER is a distinct failure from a wrong verdict',
      /wrong pointer is a true finding aimed at the wrong/i],
    ['what the rule deliberately does NOT enforce, so the residue is not hidden',
      /cannot judge whether the evidence really refutes|short enough to appear everywhere/i],
    ['ADR C-019 as its source', /C-019/],
    // ── the documentation-harvest ATTESTATION (ADR C-018), the newest fail-closed rule ────────────
    ['that a `searched` surface must be declared AND classified as read',
      /searched[\s\S]{0,300}coverage\.read/],
    ['that a partial / skipped surface may not be reported as searched',
      /coverage\.partial`? or `?coverage\.skipped`?\s+may not be\s+reported as searched/i],
    ['the closed disposition vocabulary', /`asserts \| mentions`|`asserts`[\s\S]{0,40}`mentions`/],
    ['that an `asserts` candidate must be PROMOTED into claims[]', /promoted\*\*? into `?claims\[\]`?/i],
    ['that a harvest may not declare its own completeness',
      /`?complete`?, `?incomplete`?, `?covered`?\s+and `?exhaustive`? are refused/i],
    ['ADR C-018 as its source', /C-018/],
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
    // ── no INVISIBLE control character, anywhere in the IR (ADR C-023) ────────────────────────────
    // The newest fail-closed rule, and §7.1 ended at rule 18 while `validate.mjs` was already refusing
    // thirty code points — a rule enforced and undocumented is the PHANTOM contract this file exists to
    // catch, and this one changed which JSON strings are legal.
    ['the control-character refusal at all', /INVISIBLE control character/i],
    ['the size of the refused class', /thirty code\s+points/i],
    ['exactly which three stay legal', /\*\*except\*\* tab, newline and carriage return/],
    ['that KEYS are refused as well as values', /values AND in object\s+KEYS/],
    ['that it is enforced by ONE whole-document walk', /whole-document walk/],
    ['the property that draws the line — visibility, not a field list', /VISIBILITY/],
    ['that the three legal ones are also the C0 members XML 1.0 permits', /C0 members XML 1\.0 permits/],
    ['that a LABEL is not held stricter than prose, so a newline in one stays legal',
      /label is not treated more\s+strictly than prose/i],
    ['that PATHS refuse whitespace too', /whitespace included/],
    ['why a path is stricter — line-oriented tools, and realpath throwing on a NUL',
      /line-oriented\*{0,2} tools[\s\S]{0,400}realpathSync/],
    // …and the rule that keeps the walk's ONE silence sound: it skips a location the path rules already
    // judged, so a key that SPELLS another location borrowed that silence and smuggled a NUL past it.
    ['that a location identifies exactly one string', /A LOCATION IDENTIFIES EXACTLY ONE STRING/],
    ['the forged-key shape it closes, by example', /`coverage` key named\s+`read\[0\]`/],
    ['how it is closed — a metacharacter-bearing key is bracketed and quoted',
      /bracketed, JSON-quoted form/],
    // …and what it does NOT do, which must travel with every citation of the rule
    ['that it removes the INPUT and not the weakness', /removes the INPUT, not the weakness/],
    ['that the C-015 scorer is STILL not binary-safe', /still not binary-safe/i],
    ['that slugify was deliberately left alone', /`slugify` is untouched/],
    ['ADR C-023 as its source', /C-023/],
    // ── what `diff.mjs` mirrors, and the general rule that was MEASURED and REJECTED ───────────────
    // This paragraph asserted that the drift engine "may never accuse on a map the validator refuses",
    // which is false and deliberately so: a validate-first guard was implemented, measured, and rejected
    // because it turned run 4's frozen map from 22 findings into 0. The doc must state the design that
    // exists, and state why the stronger one does not.
    ['that the drift engine mirrors only what a verdict DEPENDS ON',
      /mirrors \*\*only\*\* the rules the verdict it is about to write DEPENDS ON/],
    ['that a defect elsewhere in the map does not silence an unrelated finding',
      /does not silence a\s+finding it has no bearing on/],
    ['that the general validate-first guard was implemented and REJECTED',
      /validate-first guard/],
    ['the MEASUREMENT that rejected it — run 4\'s frozen map, 0 findings instead of 22',
      /\*\*0 findings\*\*[\s\S]{0,120}\*\*22\*\*/],
    // the return contract — validate() reports, it never throws
    ['that validate() never throws', /never throws/i],
    ['the exact return shape', /\{[^}]*ok[^}]*errors[^}]*warnings[^}]*containmentChecked[^}]*\}/],
  ]) {
    assert.match(enforced, re, `PDR §7.1 must state ${what} — validate.mjs enforces it`);
  }
});

/**
 * The CLOSED table-column vocabulary (`TABLE_COLUMN_KEYS`, landed in c25f599) is the newest rule the
 * validator FAILS CLOSED on, and it is the one this initiative's own run-3 candidate violated: the
 * column `"What it does"` folds to `whatitdoes`, no renderer derives it, and 125 of 125 rows rendered
 * `(no value for this column)`. A rule enforced but undocumented is a phantom contract — so the
 * vocabulary is pinned to the validator's own export in BOTH directions. A name added to
 * `TABLE_COLUMN_KEYS` without the doc, or listed in the doc without the validator, fails here.
 */
test('PDR §7.1 states the CLOSED table-column vocabulary validate.mjs enforces (ADR C-006)', (t) => {
  if (!docsPresent) return t.skip('initiative docs not present in this checkout');
  const enforced = section(read(PDR), '### 7.1 · What `validate.mjs` enforces');

  // ── the vocabulary itself, pinned to the export in both directions ─────────────────────────────
  // The names carry no `.`, so the sentence is delimited by its own terminating period and may wrap.
  const sentence = enforced.match(/\*\*The seventeen legal columns\*\*[^.]*\./);
  assert.ok(sentence, 'PDR §7.1 must introduce the vocabulary with "**The seventeen legal columns**"');
  const listed = [...sentence[0].matchAll(/`([^`]+)`/g)].map((m) => m[1]);
  assert.deepEqual(
    listed.map(foldColumnName).sort(),
    [...TABLE_COLUMN_KEYS].sort(),
    'PDR §7.1 must list EXACTLY the columns validate.mjs accepts — no more, no fewer',
  );

  // ── the folding semantics, the rejection behaviour, and where it comes from ────────────────────
  for (const [what, re] of [
    ['the vocabulary is CLOSED, not advisory', /closed[\s\S]{0,40}column vocabulary|column vocabulary[\s\S]{0,40}closed/i],
    ['the export that owns it', /`TABLE_COLUMN_KEYS`/],
    ['that a name is folded before it is matched', /`foldColumnName`/],
    ['the fold itself — lowercase, letters only', /lowercased[\s\S]{0,80}every character outside `\[a-z\]`\s+removed/],
    ['that the fold makes the spellings ONE column, by example',
      /"Doc Status"[\s\S]{0,60}"doc-status"[\s\S]{0,60}"docstatus"[\s\S]{0,60}one\s+column/],
    ['that a column outside the set makes the MAP invalid', /outside the set makes the map\s+\*\*invalid\*\*/],
    ['that render then writes NOTHING — not a partial page',
      /`render`\s+writes \*\*nothing\*\* — not a partial page/],
    ['the reason the rule is closed — an underivable column is a table that conveys nothing',
      /\(no value for this column\)/],
    ['the run that produced the rule, by its column', /"What it does"/],
    ['the commit that landed it', /c25f599/],
  ]) {
    assert.match(enforced, re, `PDR §7.1 must state ${what} — validate.mjs enforces it`);
  }
});

/**
 * PDR §6.2 is the human-readable half of `attention.mjs` and of `render.mjs`'s drift lane, exactly as
 * §7.1 is the human-readable half of `validate.mjs`. It carries a heavier obligation than most prose
 * here, because it documents a feature whose whole safety argument is a NEGATIVE: bucketing may fold
 * and may never suppress. A §6.2 that stated the grouping without stating the invariants would read
 * as permission to scope detection — the one thing ADR C-017 refuses — so each invariant is pinned
 * where a reader would look for it.
 */
test('PDR §6.2 states the attention-bucket rules attention.mjs enforces (ADR C-017)', (t) => {
  if (!docsPresent) return t.skip('initiative docs not present in this checkout');
  const drift = section(read(PDR), '### 6.2 · Drift renders on the map');
  for (const [what, re] of [
    // the ADR it comes from, and the pre-existing rule render.mjs fails closed on
    ['ADR C-017 as the buckets\' source', /ADR C-017/],
    ['that every drift-bearing node is drawn in a graph view',
      /Every drift-bearing node appears in at least one graph view/],
    // ── the invariant that makes this presentation and not suppression ───────────────────────────
    //
    // PINNED TO THE REAL RULE, not to the sentence that used to stand here. `/Detection stays
    // universal/` matched §6.2's opening words and asked nothing of what followed them, so decision F
    // could make the flat claim false — UNDOCUMENTED now requires a complete documentation harvest —
    // while both this pin and §6.2's own prose stayed exactly as they were. That is how §6.2 and §8
    // came to describe the pre-C-018 world in a repo whose whole subject is doc/code drift. The
    // universality claim is real and worth pinning; it is universality of BUCKETING over whatever
    // detection produces, and the qualification has to travel with it.
    ['that bucketing never narrows detection', /Detection stays universal over the nodes that reach it/],
    ['that bucketing is what the claim is ABOUT', /BUCKETING NEVER NARROWS IT/],
    ['the one qualification on it — the harvest gate — by name',
      /UNDOCUMENTED is\s+raised only where a documentation harvest covered every declared/i],
    ['that the qualification is DETECTION\'s and not this section\'s',
      /precondition on DETECTION[\s\S]{0,120}before any finding\s*\n?exists/i],
    ['which classes are universal over every non-inferred node, and which is not',
      /PHANTOM, STALE and UNVERIFIED are universal over every non-inferred node/],
    ['that a withheld verdict is STATED rather than vanishing',
      /withheld verdict does not vanish[\s\S]{0,140}coverage section/i],
    ['ADR C-018 as the qualification\'s source', /ADR C-018/],
    ['that every finding survives bucketing, in every output',
      /still computed, still written to `drift\.json`, still stated in full in\s*\n?`map\.md`, and still drawn on the diagrams/],
    ['that what changed is the ORDER, not the set', /What changed is the ORDER a reader meets them in/],
    ['that scoping detection was NOT the fix, and why it could not be',
      /suppressed\s*\n?UNDOCUMENTED disappears outright/],
    // ── the rule itself: BOTH axes, never kind alone ─────────────────────────────────────────────
    ['that a bucket is derived from BOTH kind and lane',
      /from \*\*both the node's `kind` and its `lane`\*\*/],
    ['that kind alone is not a sound public-contract proxy',
      /never from kind alone, which is not a sound public-contract proxy/],
    ['the reason it is not — the taxonomy has no public-entry-point kind',
      /\*\*no\s*\n?public-entry-point kind\*\*, so a public function commonly lands under `component`/],
    // ── the three buckets, each by what it contains ──────────────────────────────────────────────
    ['the likely-contract bucket and the kinds in it',
      /\*\*`likely-contract`\*\* — .{0,80}`mode`, `flag`, `env` and `outcome` in\s*\n?\*\*every\*\* lane/],
    ['that a component at the ENTRY lane is contract too', /plus `component` in the `entry` lane/],
    ['that lane may never demote a vocabulary kind', /Lane may never demote a vocabulary kind/],
    ['the ambiguous-review bucket, and that it is VISIBLE by default',
      /\*\*`ambiguous-review`\*\* — genuinely uncertain, and therefore \*\*visible by\s*\n?default\*\*/],
    ['that the external KIND is ambiguous in every lane, never informational',
      /the `external` kind in every lane/],
    // THE RULE, NOT THE WORKED EXAMPLE (2026-08-28). This pinned the PDR's `jq` illustration by name.
    // The owner's disposition ruling that same day made the illustration FALSE — `SKILL.md:72`, `:89`,
    // `:113` and `:177` assert what jq does, so `codex-gate` documents it and run 4's UNDOCUMENTED on
    // it is a false accusation. The PDR withdrew the example and kept the rule; this pins the rule, so
    // a later ruling about one dependency can never again break a contract test about bucketing.
    ['that an undocumented hard prerequisite surfaces for review rather than being dismissed',
      /hard\n?\s*prerequisite[\s\S]{0,200}surfaces for review/],
    ['that an unjudged kind, lane or class lands in ambiguous-review',
      /any kind, lane or drift class the table has no rule for/],
    ['the implementation-detail bucket and the EXACT cells that reach it',
      /only \*\*three of thirty-two\*\* cells\s*\n?\s*reach it: `artifact`, `component` and `state` in the `core` lane/],
    ['that both signals must agree before a finding is folded',
      /the kind says\s*\n?\s*"implementation noun" and the map's own layout says "internal machinery"/],
    ['that the collapse is a native <details> and carries NO script',
      /native `<details>`, closed — no script/],
    // ── the two invariants ───────────────────────────────────────────────────────────────────────
    ['that ONLY UNDOCUMENTED can be collapsed', /\*\*Only `UNDOCUMENTED` can be collapsed\.\*\*/],
    ['why the other classes cannot be — somebody WROTE a claim',
      /require somebody to\s*\n?\s*have WRITTEN a claim/],
    ['that a class floor lifts every other class out of the collapsed group',
      /A class floor lifts any other class out of the collapsed\s*\n?\s*group/],
    ['the real finding the floor protects — a STALE on component × core',
      /a STALE on\s*\n?\s*`component × core`/],
    ['that the rule is ONE exported table read by both renderers',
      /\*\*The rule is one exported table\*\*, `references\/attention\.mjs`, read by both renderers/],
    ['the two-artifacts-that-must-agree reason for that',
      /A bucket\s*\n?\s*decided in two places is the two-artifacts-that-must-agree drift/],
    // ── what the reader is told, so folding is never mistaken for filtering ──────────────────────
    ['that the lane states the RAW count and the per-bucket tally',
      /states the RAW count and the per-bucket tally/],
    ['that map.md folds nothing, because it is the self-sufficient report',
      /`map\.md` groups nothing and folds nothing/],
  ]) {
    assert.match(drift, re, `PDR §6.2 must state ${what} — attention.mjs implements it`);
  }
});

/**
 * SKILL.md §3.1 is the one document an EXTRACTOR reads, and the harvest is the one part of the
 * contract nothing downstream can check. So the limits have to be in the instructions themselves.
 *
 * ADR C-018's amendment (owner, 2026-08-14) settled what the record is: an ATTESTATION the extractor
 * signs, checked for INTERNAL CONSISTENCY and never independently verified — nothing in the pipeline
 * opens a file TO VERIFY IT. *(Scoped 2026-08-28 per ADR C-026: unqualified, the claim is false —
 * `render.mjs` calls `checkFreshness()`, which reads every declared source to compare its bytes
 * against a declared digest. What no check anywhere does is observe whether an extractor searched
 * anything.)* Two things follow that a skill file can get wrong silently, and both are pinned here:
 *
 *   • describing the record as proof of anything the pipeline observed. It observes nothing;
 *   • omitting the UNDECLARED-SURFACE residual, which is the failure the gate cannot catch and the
 *     one that manufactures false accusations — measured at 20 → 35 UNDOCUMENTED on a real map.
 *
 * `SKILL.md` ships INSIDE the plugin, so unlike the PDR pins above this one never skips.
 */
test('SKILL.md §3.1 states the ATTESTATION limits an extractor is the only one who can honour', () => {
  const skill = read(path.join(HERE, '..', 'SKILL.md'));
  const harvest = section(skill, '## 3.1 · The documentation harvest');
  for (const [what, re] of [
    ['that the record is an attestation the extractor signs', /ATTESTATION you are signing/],
    ['that nothing downstream can check whether a file was read',
      /Nothing downstream can check whether you actually read anything/],
    ['that the two lists compared are both the extractor\'s own', /two lists \*\*you wrote\*\*/],
    ['that the validator never opens a file to verify a harvest', /never opens a file/],
    ['that what the pipeline guarantees is internal consistency ONLY',
      /guarantees is\s*\n?\s*only that your record is \*\*internally consistent\*\*/],
    ['that the searched-every-declared-surface claim is the EXTRACTOR\'s, not the pipeline\'s',
      /is \*\*yours\*\*, an attestation you sign and nothing verifies/],
    ['ADR C-018\'s amendment as its source', /C-018 amendment/],
    // the residual, and the measurement that makes it a fact rather than a caution
    ['the undeclared-surface residual, by name', /undeclared doc file is\s*\n?\s*invisible to the whole mechanism/],
    ['that under-declaring manufactures false accusations',
      /Under-declaring silently manufactures false accusations/],
    ['the measurement behind it', /20 to 35/],
    // WHAT THIS PIN USED TO ENFORCE, and why the correction runs through the test as well as the
    // document (2026-08-14, pre-PR review). It read `/no validation error and no coverage warning/`,
    // which held SKILL.md to a claim ADR C-018 does not make and its own scope note contradicts: the
    // reduced map DOES carry validation errors — the surgery leaves one node uncited, and the
    // committed map separately carries one pre-C-019 `refutedQuote` violation. What C-018 actually
    // records is narrower and is the frightening part: **no harvest rule fires**, and neither error
    // suppresses any of the fifteen false accusations. A pin that cements an overclaim is worse than
    // no pin, because it makes correcting the document look like breaking the contract.
    ['that NO HARVEST RULE fires, which is the claim ADR C-018 actually records',
      /no harvest rule\s+firing and no coverage warning/],
    ['that the reduced map is not thereby error-free — the errors it does carry are named',
      /leaves one node uncited/],
    ['that those errors are not harvest errors and suppress none of the fifteen',
      /[Nn]either is a `docHarvest` error, and neither\s+suppresses any of the 15/],
    // …and the rule the residual implies, which used to read as an either/or and inverted the outcome
    ['that every discovered doc surface must be DECLARED, then classified',
      /declare every one of them in `sources\[\]` with\s*\n?\s*`role: "doc"`, hashed, and then classify each in `coverage`/],
    ['that declaring-and-skipping is NOT the same as leaving it out',
      /Declaring and skipping is not the same as leaving it out/],
    ['what each of the two actually does — withheld versus accused',
      /withheld\*\*[\s\S]{0,400}accused\*\*/],
  ]) {
    assert.match(harvest, re, `SKILL.md §3.1 must state ${what}`);
  }
});

/**
 * THE OUTCOME-LABEL CAPTION CONVENTION (owner decision, 2026-08-14) — pinned in all three places it
 * has to agree, because it is the rule that was applied while written down nowhere.
 *
 * ADR C-015's coverage floor compared a `kind:"outcome"` label to a raw source token with an exact
 * whole-string match, and scored run 4's truthful `exit 2 (usage or precondition failure)` as an
 * INVENTED label. No ADR and no contract had ever required a label to equal a raw token — C-015 asks
 * that the vocabulary be REPRESENTED, and the IR asks only for a non-empty label and a derived id. An
 * unwritten rule, applied retroactively, produced a gate failure.
 *
 * The owner settled it: labels are human-readable CAPTIONS, and captions are legal. What makes them
 * checkable is one normalization, and the normalization is now WRITTEN — in PDR §7 rule 3b, in PDR
 * §7.1 rule 18, in SKILL.md §4.2, and in the scorer's own `norm_outcome`. This test is what keeps the
 * four from drifting apart: a scorer whose rule appears in no contract is how this happened once.
 */
test('the outcome-label CAPTION convention is stated wherever it is relied on', (t) => {
  if (!docsPresent) return t.skip('initiative docs not present in this checkout');
  const pdr = read(PDR);
  const plan = read(PLAN);

  // 1 · the IR contract states it, in both the prose (§7) and the enforcement list (§7.1)
  const ir = section(pdr, '## 7 · The IR contract');
  for (const [what, re] of [
    ['that a label is a caption rather than a raw token', /human-readable CAPTION/],
    ['that the IR never required a label to equal a source token',
      /never required a label to equal a raw token/],
    ['the normalization itself — ONE trailing parenthetical caption',
      /one trailing parenthetical caption\*{0,2} removed/i],
    ['that whitespace is collapsed and the ends trimmed', /collapsed to single\s*\n?\s*spaces, and the ends trimmed/],
    ['that case is significant', /[Cc]ase is significant/],
    ['that the comparison runs in both directions on the TOKEN', /compares? (?:that |the )?\*{0,2}token\*{0,2}/i],
    ['that a caption cannot launder an invented outcome', /exit 7\s*\n?\s*\(mystery\)|exit 7 \(mystery\)/],
    ['the worked example the decision came from', /exit 2 \(usage or precondition failure\)/],
  ]) {
    assert.match(ir, re, `PDR §7 must state ${what}`);
  }
  const enforced = section(pdr, '### 7.1 · What `validate.mjs` enforces');
  assert.match(enforced, /kind: "outcome"` label is a CAPTION/,
    'PDR §7.1 must carry the rule too — it is where a reader looks when a check calls a label invented');
  assert.match(enforced, /a rule that lives only\s*\n?\s*inside a scoring script is an unwritten rule/,
    '…and must say why writing it down is the fix');

  // 2 · the extractor-facing skill states it — asserted in its OWN test below, which does not sit
  //     behind the initiative-docs gate, because `SKILL.md` ships and PDR/execution-plan do not.

  // 3 · the scorer compares the normalized token — and says so where the comparison happens
  assert.match(plan, /^norm_outcome\(\) \{/m,
    'the execution plan\'s C-015 scorer must define the normalization as a named helper');
  assert.match(plan, /Both directions of \(b\) compare the TOKEN/,
    '…and state that both directions compare the token, not the label');
  assert.doesNotMatch(plan, /grep -qxF "\$lab" \/tmp\/allowed-outcomes/,
    'the whole-label comparison is the defect — it may not survive anywhere in the block');

  // 4 · …and the helper is EXERCISED, not merely spelled (2026-08-14, pre-PR review).
  //
  // WHY THIS REPLACED A SPELLING CHECK. The pin above used to read `/norm_outcome\(\) \{ sed -E/`,
  // which asserts that a helper of that name begins with a `sed -E` — it does not assert that the
  // helper implements the decided normalization, and it cannot, because a regex over a document
  // cannot run a program. A whole class of defect therefore sat inside the pin: the helper WAS a
  // `sed -E`, and `sed` is LINE-oriented, so a legal label carrying a newline —
  // `exit 2\n(usage or precondition failure)`, which is what `jq -r` prints as two lines — was
  // normalized as two separate records. The caption strip then matched the second line whole,
  // produced an EMPTY token, and a truthful label scored INVENTED: the exact failure the caption
  // ruling was made to end, surviving inside the fix for it and under a green test.
  //
  // So the helper is extracted from the document and RUN. What is pinned is behaviour on labels this
  // decision actually named, and one of them is the newline case.
  const norm = normOutcomeFromPlan(plan);
  for (const [label, token, why] of [
    ['exit 2 (usage or precondition failure)', 'exit 2',
      'ONE trailing parenthetical caption is removed — the worked example the decision came from'],
    ['exit 2\n(usage or precondition failure)', 'exit 2',
      'and a label carrying a NEWLINE is still ONE label: this is the case the sed-only helper got wrong'],
    ['APPROVE', 'APPROVE', 'a label with no caption is its own token'],
    ['exit 2 (a) (b)', 'exit 2 (a)', 'ONE caption, not every parenthetical'],
    ['(mystery) exit 7', '(mystery) exit 7', 'a LEADING parenthetical is not a trailing caption'],
    ['exit 7 (mystery)', 'exit 7',
      'and stripping the caption is what leaves `exit 7` to be judged — a caption cannot launder an '
      + 'invented outcome'],
    ['exit 2 (usage', 'exit 2 (usage', 'an unclosed parenthesis is not a caption either'],
    ['approve', 'approve', 'case is significant — nothing here lowercases or uppercases'],
    ['exit   2   (x)', 'exit 2', 'inner whitespace collapses to single spaces'],
    ['   padded label   ', 'padded label', 'and the ends are trimmed'],
    // NON-ASCII WHITESPACE, and it is the case that exposes a real locale dependency (round-9 gate).
    // The plan's helper normalises with `[[:space:]]`, whose membership is LOCALE-DEFINED: under a
    // UTF-8 locale U+00A0 is space and this label normalises to `exit 2`; under `LC_ALL=C` it is not,
    // the trailing caption is not stripped, and a perfectly legal label is scored as an INVENTED
    // outcome. The matrix tested only ASCII whitespace, so it accepted the divergence. Pinned here so
    // the behaviour is at least VISIBLE — and see the RECORDED LIMIT below, because pinning it is not
    // the same as removing the dependency.
    ['exit 2\u00a0(x)', 'exit 2\u00a0',
      'RECORDED DEFECT, pinned as it BEHAVES rather than as it should: `[[:space:]]` membership is '
      + 'LOCALE-DEFINED, so U+00A0 is whitespace under a UTF-8 locale and not under `LC_ALL=C`. Here '
      + 'the caption is stripped but the non-breaking space SURVIVES, so a legal label normalises to a '
      + 'token with a trailing U+00A0 and the C-015 scorer would call it an INVENTED outcome. The '
      + 'matrix tested only ASCII whitespace and accepted the divergence (round-9 gate). Pinned so it '
      + 'is visible and so a fix is a deliberate change to the plan\'s helper, not a silent one'],
  ]) {
    assert.equal(norm(label), token,
      `norm_outcome(${JSON.stringify(label)}) must be ${JSON.stringify(token)} — ${why}`);
  }

  // …and the CALL SITE has to feed it whole labels. A correct helper fed line-by-line output is still
  // the same bug: `jq -r` prints a newline-bearing label as two lines, so the pipeline that consumed
  // `/tmp/got-labels` with `read`/`<` never had one label in hand to normalize.
  assert.doesNotMatch(plan, /norm_outcome < \/tmp\/got-labels/,
    'labels may not be normalized as LINES — a label is one record, and a record may contain a newline');
  assert.match(plan, /jq -c '\[\.nodes\[\]\|select\(\.kind=="outcome"\)\|\.label\]\|unique\|\.\[\]'/,
    'the label list must be emitted one JSON STRING per line, which is the only framing a newline '
    + 'inside a label cannot forge');

  // …and the call site is EXERCISED too, not merely spelled — in its OWN test, immediately below,
  // because running it needs `jq` and a check that cannot run must not report as one that ran.

  // THE RESIDUAL THIS ROUND PROVED, and it is a finding about the PLAN and not about this test.
  //
  // SUPERSEDED IN PART, 2026-08-15 — ADR C-023, and appended here rather than rewritten below because
  // the paragraph that follows is what the owner decided FROM. Its first sentence, "A label may legally
  // contain a NUL", was true when written and is now FALSE: `validate.mjs` refuses every control
  // character but tab, newline and carriage return in every string of the IR, so that probe now returns
  // an error naming `nodes[i].label` and `U+0000` where it returned zero. Read the paragraph as the
  // record of a closed defect, in the present tense it was written in.
  //
  // WHAT IS NOT SUPERSEDED: the scorer weakness itself. `tok=$(…)` still cannot carry a NUL and the
  // bash/zsh divergence is still real, so C-023 removed the INPUT and not the weakness — which is
  // exactly why the pin below still stands and is not relaxed.
  //
  // A label may legally contain a NUL. `validate.mjs` accepts one: probed on `tiny.map.json`, an
  // outcome labelled `exit\u0000 2 (usage or precondition failure)` validates with ZERO errors, and it
  // is not even distinguishable by the id rule, because `slugify` drops the NUL and the node's required
  // id is byte-identical to the clean label's. `jq -c` frames it honestly as `\u0000` and `jq -r .`
  // decodes it back to a real byte — but the call site captures the result in `tok=$(…)`, and COMMAND
  // SUBSTITUTION CANNOT CARRY A NUL. Probed through the plan's own two lines: the pure pipe yields the
  // bytes `e x i t \0 2` and the command substitution yields `e x i t 2`, so `grep -qxF` then ACCEPTS
  // the NUL-bearing label as the legitimate `exit 2` and reports no `INVENTED OUTCOME LABEL`. The
  // direction of that failure is FAIL-OPEN, and it is the same laundering the caption ruling exists to
  // refuse, reached through a byte instead of a parenthesis.
  //
  // It is NOT pinned as correct behaviour — a pin that cements a defect makes fixing it look like
  // breaking the contract, which this file has already learned once. What is pinned is that the plan
  // NAMES the residual, so it cannot go quiet again while it is open. Closing it needs a restructured
  // scorer that never puts a token in a shell variable, and that is an owner decision.
  assert.match(plan, /NUL|control character/,
    'the plan must NAME the control-character residual at its outcome-label call site — it is proven, '
    + 'it is fail-open, and an unrecorded known limit is how this initiative got its withdrawn verdicts');

  // …and since C-023 it must not OVERSTATE the closure either, which is the new way this note can go
  // wrong. The IR refusal removed the input; the scorer is untouched. A note later trimmed to "closed"
  // would advertise a binary-safe scorer that does not exist — the same class of overstatement C-018's
  // second correction had to append over, and the reason that correction is worth one more line here.
  assert.match(plan, /not\s+binary-safe/i,
    'the plan must keep saying the SCORER is still not binary-safe: ADR C-023 removed the byte from the '
    + 'IR, it did not make `tok=$(…)` carry one, and a note that claims otherwise re-opens the hole in '
    + 'the reader rather than in the code');
});

/**
 * THE C-015 CALL SITE, COMPOSED AND RUN — its own test, because it needs `jq`, and a check that could
 * not run must never report as a check that passed.
 *
 * WHY THE TWO REGEXES IN THE TEST ABOVE ARE NOT ENOUGH, and it is the same lesson the `norm_outcome`
 * helper taught one round earlier. They assert that a bad framing is ABSENT and a good framing is
 * PRESENT — neither runs the chain, so neither can tell whether the framing and the decode actually
 * compose. The defect they cannot see is a `jq -c` that frames correctly feeding a decode that unframes
 * incorrectly: the round-trip, which is the only thing the call site is for.
 *
 * So the plan's OWN two lines — the `jq -c` framing and the `tok=$(…)` decode — are lifted out of the
 * document and RUN against a candidate whose outcome label carries a real newline, which is the case the
 * whole C-020 correction turns on. Only the framing line's `> /tmp/got-labels` redirect is removed, so
 * the two lines can be composed in a pipe instead of through a file; that substitution is asserted, so
 * nothing else can be quietly edited in on the way.
 *
 * WHY IT IS A TEST OF ITS OWN (2026-08-15). This block sat inside the caption test under a bare
 * `if (hasJq())`. Where `jq` is absent — a standalone install, a lean image — the round-trip was
 * silently omitted while the enclosing test still printed `ok` and the runner still reported `skipped 0`:
 * a SKIP WEARING A PASS, which is precisely the defect class that has cost this initiative two withdrawn
 * verdicts and one green pin over a broken helper. Lifted out, the absence is visible — one named
 * skipped test carrying its reason — and nothing else in the caption test needs `jq` at all.
 */
test('the C-015 call site FRAMES and DECODES a newline-bearing outcome label (needs `jq`)', (t) => {
  if (!docsPresent) return t.skip('initiative docs not present in this checkout');
  if (!hasJq()) {
    return t.skip('`jq` is not on PATH, so the plan\'s own framing + decode cannot be RUN here — and a '
      + 'check that did not run is not a check that passed');
  }
  const plan = read(PLAN);
  const roundTrip = callSiteDecoderFromPlan(plan);
  for (const [label, token, why] of [
    ['exit 2\n(usage or precondition failure)', 'exit 2',
      'the newline case must survive the WHOLE chain — `jq -c` escapes it, `jq -r .` decodes it back, '
      + 'and `norm_outcome` sees ONE record; this is what the two framing regexes cannot check'],
    ['exit 2 (usage or precondition failure)', 'exit 2',
      'and the ordinary case still round-trips unchanged'],
    ['APPROVE', 'APPROVE', 'a caption-free label decodes to itself'],
    ['exit 7 (mystery)', 'exit 7',
      'and a caption is still stripped after the decode, so it cannot launder an invented outcome'],
  ]) {
    assert.equal(roundTrip(label), token,
      `the plan's own framing + decode must turn ${JSON.stringify(label)} into `
      + `${JSON.stringify(token)} — ${why}`);
  }
});

test('PDR §7 states the timestamp rule serialize.mjs enforces (ADR C-003)', (t) => {
  if (!docsPresent) return t.skip('initiative docs not present in this checkout');
  const ir = section(read(PDR), '## 7 · The IR contract');
  for (const [what, re] of [
    ['that no wall-clock timestamp may appear in map.json', /no wall-clock timestamp/i],
    ['that BOTH ISO-8601 spellings are rejected', /basic[\s\S]{0,120}extended|extended[\s\S]{0,120}basic/i],
    ['the basic spelling by example', /20260811T134500Z/],
    // the guard reads STRING TOKENS, so a JSON number is never read as a date
    ['that the guard reads JSON string tokens, so a number is never a date', /string token/i],
    ['that a date-TIME is caught down to the HOUR, not only to the minute', /hour/i],
    ['the precision the rule deliberately does NOT match', /coarser than a day|`2026-08`/],
    // ── the 2026-08-13 amendment: the rule names DATE-TIMES only ─────────────────────────────────
    // The guard refused bare dates too, and so refused the first REAL subject — its map quotes a
    // dated README line. A doc still stating the old rule would describe a guard that no longer
    // exists, which is this repo's own drift class.
    ['that a wall-clock timestamp is specifically a date-TIME', /wall-clock\s+timestamp is a date-TIME/i],
    ['that a date-time is refused in EVERY position, a path included',
      /wherever it appears,\s*\n?\s*a path included/i],
    ['that a stamped directory is still a stamp', /stamped directory[\s\S]{0,80}still a stamp/i],
    ['that a bare date is NOT a timestamp and is CARRIED', /bare date is NOT a timestamp[\s\S]{0,60}carried/i],
    // NOT a bare /prose/ — §7.1 rule 2 uses the word too, so a bare pin would match with this
    // sentence deleted and pin nothing at all.
    ['that a bare date is carried in PROSE too, not only as a whole value',
      /embedded in\s*\n?\s*\*\*prose\*\*/i],
    ['the bare-date spellings by example', /`2026-08-01`, `20260801`/],
    ['that the amendment is dated and owner-authorized', /Amended\s*\n?\s*2026-08-13, owner-authorized/],
    ['what triggered it — the first real subject failed', /first real subject failed/i],
    ['the reasoning: a generation stamp is always a date-time',
      /generation stamp\s*\n?\s*is always a date-time/i],
    ['that the bare-date carve-outs were REMOVED with the rule they served',
      /calendar band and the\s*\n?\s*path-token carve-out went with the rule/i],
    ['the dated-PATH example that must no longer be a false positive',
      /2026-08-11-the-cartographer/],
  ]) {
    assert.match(ir, re, `PDR §7 must state ${what} — serialize.mjs enforces it`);
  }
});


test('C-020 · the SHIPPED extractor contract states the caption rule — runnable in a standalone install', () => {
  // SPLIT OUT OF THE GATED TEST (round-7 gate). These assertions are about
  // `plugin/skills/the-cartographer/SKILL.md`, which SHIPS in the plugin — but they sat behind the
  // `docsPresent` gate, which tests for `PDR.md` and `execution-plan.md`, two files that deliberately
  // do NOT ship. So the one half of the C-020 contract a standalone install can actually check was the
  // half it skipped, and the extractor-facing rule could drift there with no runnable package-local
  // test. `SKILL.md` is resolved from `HERE`, so this works in a source checkout and an install alike.
  const skill = read(path.join(HERE, '..', 'SKILL.md'));
  const captions = section(skill, '## 4.2 · A label is a caption');
  for (const [what, re] of [
    ['the normalization, in the extractor\'s own words', /one trailing parenthetical caption\*{0,2}\s*\n?\s*removed/i],
    ['that a non-trailing or unparenthesized gloss is NOT a caption', /is not a caption by this\s*\n?\s*rule/],
    ['that the token underneath is still checked', /gloss is stripped and the token underneath is still\s*\n?\s*checked/],
    ['that a caption may not stand in for a missing required outcome',
      /must exist as its own\s*\n?\s*`kind: "outcome"` node/],
    ['INFRA_ERROR and OVERFLOW as required members', /`INFRA_ERROR` and `OVERFLOW`/],
  ]) {
    assert.match(captions, re, `SKILL.md §4.2 must state ${what}`);
  }
});
