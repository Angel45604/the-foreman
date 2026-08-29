# the-refiner follow-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to
> implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the-refiner's exemplar pairs with the tail rule, a preserved numeral and a
structured example, and lay the three prerequisites that let eval 12 close on executed behavior.

**Architecture:** Follow-up A is a single file edit guarded by a snapshot ritual and pinned by five
new live tests. Follow-up B phase 1 is three code changes to the eval harness: stable criterion IDs
so the judge stops re-segmenting, a split of eval 12 either side of its hard gate, and a live
fixture materializer so `files` stops being inert. The execution canary is phase 2, behind an
evidence gate, and is not built by this plan.

**Tech Stack:** Node 22 with `node --test`, plain ES modules, bash, python3 for the fidelity proof.

**Spec:** `docs/initiatives/2026-08-29-refiner-followups/design.md` and
`docs/initiatives/2026-08-29-refiner-followups/ADR-001-followup-b-staging.md`.

## Global Constraints

- No paid eval run anywhere in this plan. Every phase is code plus offline unit tests, plus
  `--dry-run` where a prompt shape needs eyeballing. Any paid run needs a separate live-run gate
  naming the exact call count.
- LOCAL commits only, explicit paths only, and only if the plan-approval gate authorized them.
  Never `git add -A`. Never stage `.claude/` or `docs/initiatives/2026-07-30-prepublish-audit/`.
- Never touch the main checkout at `/Users/angel/personal/the-foreman`. It sits on
  `feat/the-cartographer`, someone else's in-flight branch.
- Em dashes. The repo does NOT ban them everywhere, and this plan does not pretend otherwise.
  Measured on this branch: `run-evals.mjs` already holds 12 and `evals.json` already holds 7.
  Removing them is not in scope. What binds is narrower and checkable:
  1. The five files the drift test scans stay clean: `core-contract.md`, `ai-tells.md`,
     `before-after.md`, the-refiner's `SKILL.md`, and `plugin/output-styles/plain-voice.md`.
     `core-contract.test.mjs` already enforces this and must keep passing.
  2. Every file this plan CREATES is clean: `fixtures.mjs`, `fixtures.test.mjs`, the fixture
     files, `pair-9.fragment.md`, and every doc in this bundle.
  3. Every line this plan ADDS to an existing file is clean. Pre-existing lines are left alone.
  Task 5 is the final sweep that proves all three.
- Node 22 needs explicit globs for `node --test`. A bare directory discovers nothing.
- zsh does not word-split `$VAR` in `for f in $VAR`. Use per-file calls or arrays.
- The snapshot namespace for this initiative is `$TMPDIR/refiner-followups-verify`. The Aug 28
  snapshot at `$TMPDIR/the-refiner-verify` belongs to the prior initiative and is never touched.
- Before overwriting anything under `~/.claude/skills/`, `cmp` it against the repo state pinned to
  a422612. A mismatch means STOP and diagnose, never clobber.

## File Structure

- `plugin/skills/the-refiner/references/before-after.md` gains a header sentence, a numeral in
  pair 1, and a new structured pair 9.
- `plugin/skills/the-refiner/references/core-contract.test.mjs` gains five tests that pin the new
  structure. It stays the single test file for this skill.
- `plugin/skills/the-foreman/evals/evals.json` gains a `criteria` array per eval and splits eval 12.
- `plugin/skills/the-foreman/evals/run-evals.mjs` learns fixed-ID judging and fixture paths.
- `plugin/skills/the-foreman/evals/fixtures.mjs` is new. It owns fixture materialization and the
  unchanged-originals proof, and nothing else.
- `plugin/skills/the-foreman/evals/run-evals.test.mjs` and a new
  `plugin/skills/the-foreman/evals/fixtures.test.mjs` carry the offline tests.

---

## Phase 1: Follow-up A, the exemplar pairs extension

### Task 1: Extend before-after.md and pin it with live tests

**Files:**
- Modify: `plugin/skills/the-refiner/references/before-after.md`
- Test: `plugin/skills/the-refiner/references/core-contract.test.mjs`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: a nine-pair `before-after.md`, and five test names later phases must not break:
  `before-after.md carries exactly nine exemplar pairs, numbered in order`,
  `the header states the tail rule`,
  `pair 1 preserves its numerals byte for byte across the rewrite`,
  `pair 9 keeps heading level and list structure across the rewrite`,
  `pair 9 keeps its fenced code block byte for byte`.

- [ ] **Step 0: The snapshot ritual. Run this BEFORE any edit.**

```bash
S="${TMPDIR:-/tmp}/refiner-followups-verify"
mkdir -p "$S"
for f in pre-edit-before-after.md pre-edit.sha256; do
  if [ -e "$S/$f" ]; then
    echo "SNAPSHOT EXISTS: $S/$f. STOP and surface: a retry must not overwrite the baseline."
    exit 1
  fi
done
cp -n plugin/skills/the-refiner/references/before-after.md "$S/pre-edit-before-after.md"
( cd "$S" && shasum -a 256 pre-edit-before-after.md > pre-edit.sha256 && cat pre-edit.sha256 )

# Fingerprint the PRIOR initiative's snapshot so Task 5 can prove we never touched it.
# This READS the old namespace and WRITES only into the new one.
# It fingerprints OLD and its descendants ONLY. It must never include the shared TMPDIR parent,
# because Task 4's mkdtemp tests create and remove sibling directories there, which would change
# the parent's mtime and fail this check while the protected snapshot was in fact untouched.
cat > "$S/fingerprint.py" <<'FPY'
import hashlib, os, stat, sys
root = sys.argv[1]
if not os.path.isdir(root):
    print("ABSENT"); raise SystemExit(0)
rows = []
# The root's OWN metadata. Without this row an add-then-remove inside OLD changes the root's
# mtime while every descendant row stays identical, and the comparison would wrongly pass.
rst = os.lstat(root)
rows.append(f".\tdir\t{rst.st_size}\t{rst.st_mtime_ns}\t")
for dirpath, dirnames, filenames in os.walk(root):
    for name in dirnames + filenames:
        full = os.path.join(dirpath, name)
        rel = os.path.relpath(full, root)
        st = os.lstat(full)
        if stat.S_ISLNK(st.st_mode):
            kind, digest = "link", hashlib.sha256(os.readlink(full).encode()).hexdigest()
        elif stat.S_ISDIR(st.st_mode):
            kind, digest = "dir", ""
        else:
            kind = "file"
            with open(full, "rb") as fh:
                digest = hashlib.sha256(fh.read()).hexdigest()
        rows.append(f"{rel}\t{kind}\t{st.st_size}\t{st.st_mtime_ns}\t{digest}")
for row in sorted(rows):
    print(row)
FPY
OLD="${TMPDIR:-/tmp}/the-refiner-verify"
python3 "$S/fingerprint.py" "$OLD" > "$S/prior-snapshot.fingerprint"
cat "$S/prior-snapshot.fingerprint"
```

Expected: the recorded hash is
`16495e832b0dee21ee080bbbae88511879ab8deba16462bd04a86eba78fda7c6`. If it differs, STOP: the file
is not at the state this plan was written against.

- [ ] **Step 1: Write the failing tests**

Append to `plugin/skills/the-refiner/references/core-contract.test.mjs`, after the existing
em-dash test. The three helpers go directly above the five tests.

```javascript
function pairsOf(md) {
  const parts = md.split(/^### (\d+)\. /m);
  const out = [];
  for (let i = 1; i < parts.length; i += 2) out.push({ n: Number(parts[i]), body: parts[i + 1] });
  return out;
}

function sidesOf(body) {
  const b = body.indexOf('**Before:**');
  const a = body.indexOf('**After:**');
  return { before: body.slice(b + 11, a), after: body.slice(a + 10) };
}

function fencesOf(text) {
  return [...text.matchAll(/```[a-z]*\n[\s\S]*?```/g)].map((m) => m[0]);
}

test('before-after.md carries exactly nine exemplar pairs, numbered in order', () => {
  const md = readFileSync(join(here, 'before-after.md'), 'utf8');
  const ps = pairsOf(md);
  assert.strictEqual(ps.length, 9, 'before-after.md must hold exactly nine pairs');
  assert.deepEqual(ps.map((p) => p.n), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.strictEqual((md.match(/\*\*Before:\*\*/g) || []).length, 9);
  assert.strictEqual((md.match(/\*\*After:\*\*/g) || []).length, 9);
});

test('the header states the tail rule', () => {
  const md = readFileSync(join(here, 'before-after.md'), 'utf8');
  const header = md.slice(0, md.indexOf('### 1.'));
  assert.match(header, /restated as a direct sentence/);
  assert.match(header, /inflates significance/);
});

test('pair 1 preserves its numerals byte for byte across the rewrite', () => {
  const md = readFileSync(join(here, 'before-after.md'), 'utf8');
  const p1 = pairsOf(md).find((p) => p.n === 1);
  assert.ok(p1, 'pair 1 must exist');
  const { before, after } = sidesOf(p1.body);
  const nums = (s) => (s.match(/\d+ms/g) || []).join(',');
  assert.strictEqual(nums(before), '420ms,90ms', 'pair 1 Before must carry the latency numerals');
  assert.strictEqual(nums(after), nums(before), 'numerals must survive the rewrite unchanged');
});

test('pair 9 keeps heading level and list structure across the rewrite', () => {
  const md = readFileSync(join(here, 'before-after.md'), 'utf8');
  const p9 = pairsOf(md).find((p) => p.n === 9);
  assert.ok(p9, 'pair 9 must exist');
  const { before, after } = sidesOf(p9.body);
  for (const [side, text] of [['Before', before], ['After', after]]) {
    assert.ok(text.includes('#### Upgrade Notes'), `pair 9 ${side} must keep the h4 heading verbatim`);
    assert.strictEqual((text.match(/^- /gm) || []).length, 3, `pair 9 ${side} must hold three list items`);
  }
});

test('pair 9 keeps its fenced code block byte for byte', () => {
  const md = readFileSync(join(here, 'before-after.md'), 'utf8');
  const p9 = pairsOf(md).find((p) => p.n === 9);
  assert.ok(p9, 'pair 9 must exist');
  const { before, after } = sidesOf(p9.body);
  const fb = fencesOf(before);
  const fa = fencesOf(after);
  assert.strictEqual(fb.length, 1, 'pair 9 Before must hold exactly one fenced block');
  assert.strictEqual(fa.length, 1, 'pair 9 After must hold exactly one fenced block');
  assert.strictEqual(fa[0], fb[0], 'the fenced code block must be byte-identical');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test plugin/skills/the-refiner/references/*.test.mjs`
Expected: 6 pass, 5 fail. Record the RED output verbatim in the phase context. The five failures
should read: nine pairs (got 8), header tail rule (no match), pair 1 numerals (got empty string),
pair 9 must exist, pair 9 must exist.

- [ ] **Step 3: Apply correction 1, the header tail rule**

In `before-after.md`, the header paragraph currently ends with `dangling participles) are removed.`
Append one sentence to that same paragraph, separated by a single space:

```
Dangling participial tails split by what they carry: a tail whose content is a checkable claim or an actionable statement is restated as a direct sentence, and a tail that only inflates significance is dropped.
```

- [ ] **Step 4: Apply corrections 2 and 3, the numeral in pair 1**

In pair 1's Before, replace the exact substring `to reduce latency.` with
`to reduce median latency from 420ms to 90ms.`

In pair 1's After, replace the exact substring `to reduce latency.` with
`to reduce median latency from 420ms to 90ms.`

Both sides now carry the identical numerals. Nothing else in pair 1 changes.

- [ ] **Step 5: Apply correction 4, append pair 9**

Write the block below to `docs/initiatives/2026-08-29-refiner-followups/pair-9.fragment.md` FIRST,
then append those exact bytes to the end of `before-after.md`, after pair 8's After paragraph,
separated by one blank line. The fragment file is what Step 7's fidelity proof reads, so the two
must be the same bytes and there must be exactly one copy of this text under your control.

The block:

````
### 9. Structured release note

**Before:**

#### Upgrade Notes

This release leverages a robust new resolver to seamlessly improve dependency handling. It's worth noting that the following steps are crucial:

- Firstly, update the lockfile.
- Secondly, clear the local cache.
- Thirdly, re-run the install, ensuring a clean tree and highlighting the value of reproducible builds.

Run the upgrade with:

```bash
npm ci --prefer-offline
```

**After:**

#### Upgrade Notes

This release uses a new resolver to improve dependency handling. Take these steps:

- Update the lockfile.
- Clear the local cache.
- Re-run the install. This leaves a clean tree.

Run the upgrade with:

```bash
npm ci --prefer-offline
```
````

The heading text, the list item count, and the fenced block are identical on both sides. The
banned tells that go: `leverages`, `robust`, `seamlessly`, `It's worth noting`, `crucial`, and the
`Firstly / Secondly / Thirdly` ladder. The tail `ensuring a clean tree and highlighting the value of
reproducible builds` splits per the rule: the checkable half becomes `This leaves a clean tree.`
and the significance-inflating half drops.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node --test plugin/skills/the-refiner/references/*.test.mjs`
Expected: 11 pass, 0 fail.

- [ ] **Step 7: Run the fidelity proof**

This derives the expected file from the immutable snapshot plus the four enumerated corrections and
byte-compares it against the edited file. It fails closed.

```bash
python3 - <<'PY'
import hashlib, os, subprocess, sys
S = os.path.join(os.environ.get('TMPDIR', '/tmp'), 'refiner-followups-verify')
snap = os.path.join(S, 'pre-edit-before-after.md')
recorded = open(os.path.join(S, 'pre-edit.sha256')).read().split()[0]
raw = open(snap, 'rb').read()
if hashlib.sha256(raw).hexdigest() != recorded:
    sys.exit('snapshot no longer matches its recorded hash: the baseline was tampered with')
text = raw.decode('utf-8')
TAIL = (' Dangling participial tails split by what they carry: a tail whose content is a checkable '
        'claim or an actionable statement is restated as a direct sentence, and a tail that only '
        'inflates significance is dropped.')
assert text.count('dangling participles) are removed.') == 1
text = text.replace('dangling participles) are removed.', 'dangling participles) are removed.' + TAIL)
assert text.count('to reduce latency.') == 2, 'expected the phrase once in Before and once in After'
text = text.replace('to reduce latency.', 'to reduce median latency from 420ms to 90ms.')
PAIR9 = open('docs/initiatives/2026-08-29-refiner-followups/pair-9.fragment.md', encoding='utf-8').read()
text = text.rstrip('\n') + '\n\n' + PAIR9.strip('\n') + '\n'
live = open('plugin/skills/the-refiner/references/before-after.md', encoding='utf-8').read()
if text != live:
    open('/tmp/derived.md', 'w').write(text)
    subprocess.run(['diff', '-u', 'plugin/skills/the-refiner/references/before-after.md', '/tmp/derived.md'])
    sys.exit('FIDELITY FAIL: the edited file is not the snapshot plus the enumerated corrections')
print('FIDELITY OK: edited file == snapshot + 4 enumerated corrections')
PY
```

The proof reads the pair 9 text from `pair-9.fragment.md`, written in Step 5. That fragment is the
CANONICAL source: the fidelity proof compares against it, and `before-after.md` must match it byte
for byte.

The block printed above in Step 5 is a REPRODUCTION of those canonical bytes, present so an
implementer can see what to write without opening another file. It is a second copy and it can drift,
which is not hypothetical: it did. Task 1's code review found that pair 9's After asserted "adds a
new resolver" where its Before said "leverages a robust new resolver", while every sibling pair maps
leverage to USES. The fix was applied to `before-after.md` and to the fragment, and this Step 5 block
was left saying "adds" until the pre-PR gate caught the disagreement. All three now read "uses".

If you edit pair 9, edit the fragment first, then propagate to `before-after.md` and to this block,
then re-run the fidelity proof. The proof will catch a fragment-versus-shipped mismatch on its own;
nothing automated catches a stale copy in this document, so it is on you.

- [ ] **Step 8: Re-run all four baselines plus the em-dash sweep**

```bash
node --test plugin/skills/the-foreman/references/*.test.mjs plugin/skills/the-foreman/evals/*.test.mjs
bash plugin/skills/codex-gate/codex-gate.test.sh
node --test plugin/skills/the-refiner/references/*.test.mjs
claude plugin validate ./plugin --strict
grep -q $'\xe2\x80\x94' plugin/skills/the-refiner/references/before-after.md; echo "em-dash exit=$?"
```

Expected: 593/0, PASS=441 FAIL=0, 11/0, Validation passed, em-dash exit 1.

- [ ] **Step 9: Sync the personal copy, guarded**

```bash
cmp <(git show a422612:plugin/skills/the-refiner/references/core-contract.md) \
    ~/.claude/skills/the-refiner/references/core-contract.md && echo "SYNC BASE CLEAN"
cmp <(git show a422612:plugin/skills/the-refiner/references/before-after.md) \
    ~/.claude/skills/the-refiner/references/before-after.md && echo "PAIRS BASE CLEAN"
```

Both must print their CLEAN line before you copy anything. If either differs, STOP and diagnose.
Then copy the edited pairs file over and `cmp` the two copies to prove they match.

- [ ] **Step 10: Commit, only if the plan gate authorized local commits**

```bash
git add plugin/skills/the-refiner/references/before-after.md \
        plugin/skills/the-refiner/references/core-contract.test.mjs \
        docs/initiatives/2026-08-29-refiner-followups/
git commit -m "Add the tail rule, a preserved numeral, and a structured pair to the refiner exemplars"
```

---

## Phase 2: A fixed rubric so the judge stops re-segmenting

### Task 2: Stable criterion IDs, wired into the runtime, not just the unit tests

**Files:**
- Modify: `plugin/skills/the-foreman/evals/run-evals.mjs`
- Test: `plugin/skills/the-foreman/evals/run-evals.test.mjs`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces:
  - `EVIDENCE_SOURCES` is exported and frozen:
    `['dispatch-log', 'ledger-diff', 'rendered-twin', 'transcript']`.
    Each name states what can actually decide a criterion, and the set is deliberately small:
    `dispatch-log` is the append-only JSONL, which carries tier, model, effort, outcome and order;
    `ledger-diff` is the run's final ledger compared field by field against the fixture ledger,
    which proves WHICH fields changed but never WHEN; `rendered-twin` is a re-render from the final
    ledger byte-compared against the twin on disk, which proves the twin was not hand-edited; and
    `transcript` is the executor's own account, which is the only source for ordering and for
    anything that left no artifact. An earlier draft listed `artifact-html` and `escalation-file`.
    Both were wrong. A rendered HTML file existing does not prove it was surfaced, and the
    escalation file exists only on the file-based fallback path, never on the normal
    `AskUserQuestion` path this eval exercises.
  - A criterion is `{ id, text, kind, evidence }` where `kind` is `deterministic` or `semantic`
    and `evidence` is a member of `EVIDENCE_SOURCES`.
  - `buildJudgePrompt(evalDef, transcript)` keeps its signature and emits an ID-keyed rubric that
    names each criterion's evidence source when `evalDef.criteria` is present.
  - `parseVerdict(text, evalDef)` takes an optional second parameter. With `evalDef.criteria`
    present it requires the returned `criteria` array to equal the declared ID array exactly:
    same length, same order, no duplicates, no extras, no omissions.
  - `executeEval(evalDef, opts, deps)` is exported so a test can drive the whole
    executor-plus-judge path with zero paid calls. `deps` is MERGED over the defaults, not
    substituted for them, so a test overrides only what it needs. In THIS task the only default is
    `{ runClaude }`. Task 4 extends `DEFAULT_DEPS` after `fixtures.mjs` exists. Task 2 must not
    reference `materialize`, `verifyUnchanged`, `FIXTURE_ROOT` or any workspace helper, because
    none of them exists yet and the module would fail to load.
  - `executeEval` NEVER rethrows. It catches an executor or judge error internally, records it on
    the returned run object, and returns a complete run object every time. The caller reads
    `run.error`, it does not catch.

- [ ] **Step 1: Write the failing tests**

```javascript
const CRIT_EVAL = {
  id: 99, name: 'rubric-shape', prompt: 'x', expected_output: 'y',
  criteria: [
    { id: 'c1', text: 'dispatches a fresh subagent naming model and effort', kind: 'deterministic', evidence: 'dispatch-log' },
    { id: 'c2', text: 'the rewrite preserves meaning', kind: 'semantic', evidence: 'transcript' },
  ],
};
const body = (crits) => JSON.stringify({ criteria: crits });

test('buildJudgePrompt emits the declared criterion IDs, their evidence sources, and forbids re-segmentation', () => {
  const p = buildJudgePrompt(CRIT_EVAL, 'some transcript');
  assert.ok(p.includes('"c1"'), 'the prompt must name criterion c1');
  assert.ok(p.includes('"c2"'), 'the prompt must name criterion c2');
  assert.ok(p.includes('dispatch-log'), 'the prompt must name c1 evidence source');
  assert.doesNotMatch(p, /split it into its individual clauses/,
    'a fixed-rubric eval must not tell the judge to segment for itself');
});

test('parseVerdict rejects an undeclared criterion ID', () => {
  assert.strictEqual(parseVerdict(body([
    { id: 'c1', text: 'a', passed: true }, { id: 'c9', text: 'b', passed: true },
  ]), CRIT_EVAL), null);
});

test('parseVerdict rejects an omitted criterion ID', () => {
  assert.strictEqual(parseVerdict(body([{ id: 'c1', text: 'a', passed: true }]), CRIT_EVAL), null);
});

test('parseVerdict rejects a duplicated criterion ID even though the set matches', () => {
  assert.strictEqual(parseVerdict(body([
    { id: 'c1', text: 'a', passed: true },
    { id: 'c1', text: 'a', passed: true },
    { id: 'c2', text: 'b', passed: true },
  ]), CRIT_EVAL), null, 'c1,c1,c2 has the same SET as c1,c2 but a different denominator');
});

test('parseVerdict rejects a reordered criterion array', () => {
  assert.strictEqual(parseVerdict(body([
    { id: 'c2', text: 'b', passed: true }, { id: 'c1', text: 'a', passed: true },
  ]), CRIT_EVAL), null, 'order is part of the declared contract');
});

test('parseVerdict accepts the exact declared ID sequence and recomputes the arithmetic', () => {
  const v = parseVerdict(body([
    { id: 'c1', text: 'a', passed: true }, { id: 'c2', text: 'b', passed: false },
  ]), CRIT_EVAL);
  assert.strictEqual(v.passed, 1);
  assert.strictEqual(v.failed, 1);
  assert.strictEqual(v.pass_rate, 0.5);
});

test('parseVerdict keeps its old free-form behavior when the eval declares no criteria', () => {
  const v = parseVerdict(body([{ text: 'a', passed: true }]), { id: 1, name: 'legacy' });
  assert.strictEqual(v.pass_rate, 1);
});

test('a real fixed-rubric run is unparseable when the judge returns an undeclared ID', () => {
  const calls = [];
  const fake = (prompt, model) => {
    calls.push(model);
    return calls.length === 1
      ? 'executor transcript'
      : body([{ id: 'c1', text: 'a', passed: true }, { id: 'zz', text: 'b', passed: true }]);
  };
  const run = executeEval(CRIT_EVAL, { model: 'm', judgeModel: 'j' }, { runClaude: fake });
  assert.strictEqual(run.verdict, null, 'the runner must not accept an undeclared ID');
  assert.strictEqual(calls.length, 2, 'executor then judge');
});

test('a real fixed-rubric run parses when the judge returns the exact declared sequence', () => {
  const fake = (p, m, o) => (o && o.allowedTools
    ? 'executor transcript'
    : body([{ id: 'c1', text: 'a', passed: true }, { id: 'c2', text: 'b', passed: true }]));
  const run = executeEval(CRIT_EVAL, { model: 'm', judgeModel: 'j' }, { runClaude: fake });
  assert.strictEqual(run.verdict.pass_rate, 1);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test plugin/skills/the-foreman/evals/run-evals.test.mjs`

Expected RED, stated precisely because the current `parseVerdict` ignores its second argument and
therefore already satisfies two of these:

- FAIL: the `buildJudgePrompt` rubric test. The prose path still says "split it into its individual clauses".
- FAIL: undeclared ID, omitted ID, duplicated ID, reordered array. Four failures.
- FAIL: both `executeEval` tests, with a ReferenceError, because `executeEval` is not exported yet.
- PASS already: the exact-sequence arithmetic test and the legacy free-form test.

So the expected result is 7 fail, 2 pass among the new tests. If you see a different split, stop
and diagnose before implementing.

- [ ] **Step 3: Implement the fixed rubric**

Export the frozen `EVIDENCE_SOURCES` array.

Branch `buildJudgePrompt` on `evalDef.criteria`. When present, emit the criteria as a JSON array of
`{id, text, kind, evidence}` and instruct the judge to return exactly one entry per declared ID, in
the declared order, adding none and omitting none. Keep the existing prose path byte-identical when
`criteria` is absent.

Give `parseVerdict` a second parameter `evalDef`. When `evalDef?.criteria` is present, build
`declared = evalDef.criteria.map((c) => c.id)` and `returned = v.criteria.map((c) => c.id)`.
Return `null` unless every returned entry has a string `id` and
`JSON.stringify(returned) === JSON.stringify(declared)`. That single comparison enforces length,
order, duplicates, extras and omissions at once. Keep the arithmetic recomputation as it is.

Extract the per-run executor-then-judge body into an exported `executeEval(evalDef, opts, deps)`:

Task 2 ships exactly this. It has no fixture awareness at all; Task 4 adds that.

```javascript
export const DEFAULT_DEPS = { runClaude };

export function executeEval(evalDef, opts, deps = {}) {
  const d = { ...DEFAULT_DEPS, ...deps };
  const run = {};
  try {
    run.transcript = d.runClaude(
      buildProbePrompt(evalDef, { baseline: opts.baseline }), opts.model,
      { allowedTools: 'Read,Glob,Grep,Bash(node *)' },
    );
    run.verdict = parseVerdict(
      d.runClaude(buildJudgePrompt(evalDef, run.transcript), opts.judgeModel), evalDef,
    );
  } catch (err) {
    run.error = String(err?.message ?? err);
    run.verdict = null;
  }
  return run;
}
```

- [ ] **Step 4: Change the production call site**

This is the step that makes the change real. In the `isMain` block, replace the inline
executor-then-judge pair with a call to `executeEval(e, opts)` and spread its result onto the run
object. Confirm by grep that no bare one-argument `parseVerdict(` call survives outside the tests:

```bash
grep -n "parseVerdict(" plugin/skills/the-foreman/evals/run-evals.mjs
```

Expected: the definition, and exactly one call inside `executeEval` that passes `evalDef`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test plugin/skills/the-foreman/evals/run-evals.test.mjs`
Expected: every test passes, old and new.

- [ ] **Step 6: Commit, only if authorized**

```bash
git add plugin/skills/the-foreman/evals/run-evals.mjs plugin/skills/the-foreman/evals/run-evals.test.mjs
git commit -m "Grade evals against a declared criterion sequence and wire it into the runner"
```

---

## Phase 3: Split eval 12 either side of its hard gate

### Task 3: Two linked cases, with pinned ID sequences and explicit linkage

**Files:**
- Modify: `plugin/skills/the-foreman/evals/evals.json`
- Test: `plugin/skills/the-foreman/evals/run-evals.test.mjs`

**Interfaces:**
- Consumes: the criterion shape and `EVIDENCE_SOURCES` from Task 2.
- Produces: eval 12 carries `"resumedBy": 13`; eval 13 carries `"resumes": 12`. Task 4 assigns
  fixtures to both by these IDs.

- [ ] **Step 1: Write the failing tests**

```javascript
const E12_IDS = ['dispatch-logged-once', 'dispatch-fresh-and-named', 'ledger-fields-untouched',
                 'refiner-given-only-allowed-fields', 'ledger-before-render',
                 'render-once-after-refine', 'surfaced', 'blocked-on-question', 'never-inline',
                 'no-premature-handoff-surfacing', 'twin-never-hand-edited'];
const E13_IDS = ['handoff-two-dispatches-logged', 'handoff-dispatches-fresh-and-named',
                 'handoff-one-subagent-per-file', 'findings-applied-before-handoff',
                 'hand-to-user-after-approval', 'twin-matches-ledger', 'twin-never-hand-edited'];

test('eval 12 is the pre-approval case, pinned to its exact criterion sequence', () => {
  const e = loadEvals().find((x) => x.id === 12);
  assert.ok(e, 'eval 12 must exist');
  assert.deepEqual(e.criteria.map((c) => c.id), E12_IDS);
  assert.match(e.prompt, /has not been approved/);
  assert.strictEqual(e.resumedBy, 13, 'eval 12 must name its resumed case');
});

test('eval 13 is the resumed post-approval case, pinned and linked back', () => {
  const e = loadEvals().find((x) => x.id === 13);
  assert.ok(e, 'eval 13 must exist');
  assert.deepEqual(e.criteria.map((c) => c.id), E13_IDS);
  assert.strictEqual(e.resumes, 12, 'eval 13 must name the case it resumes');
  assert.match(e.prompt, /has just been approved/);
  assert.match(e.prompt, /handoff doc and kickoff prompt are drafted/);
  assert.match(e.prompt, /Review passes have not yet run/);
});

test('the eval 12 and eval 13 linkage is mutual and consistent', () => {
  const evals = loadEvals();
  const e12 = evals.find((x) => x.id === 12);
  const e13 = evals.find((x) => x.id === 13);
  assert.strictEqual(evals.find((x) => x.id === e12.resumedBy).resumes, e12.id);
  assert.strictEqual(evals.find((x) => x.id === e13.resumes).resumedBy, e13.id);
});

test('every declared criterion has a unique id, a known kind, and a known evidence source', () => {
  for (const e of loadEvals()) {
    if (!e.criteria) continue;
    const ids = e.criteria.map((c) => c.id);
    assert.strictEqual(new Set(ids).size, ids.length, `eval ${e.id} ids must be unique`);
    for (const c of e.criteria) {
      assert.ok(['deterministic', 'semantic'].includes(c.kind), `eval ${e.id}/${c.id} kind`);
      assert.ok(EVIDENCE_SOURCES.includes(c.evidence), `eval ${e.id}/${c.id} evidence source`);
      assert.ok(typeof c.text === 'string' && c.text.length > 0, `eval ${e.id}/${c.id} text`);
    }
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test plugin/skills/the-foreman/evals/run-evals.test.mjs`

Expected RED, stated precisely: THREE fail and ONE passes vacuously. The eval 12, eval 13 and
mutual-linkage tests fail, because eval 12 declares no `criteria` and no `resumedBy` and eval 13
does not exist. The fourth test, which walks every eval that declares criteria, passes without
asserting anything because no eval in the current catalog declares any. That vacuous pass is
expected and is not evidence of anything; it only becomes meaningful after Step 3.

- [ ] **Step 3: Rewrite eval 12 and add eval 13**

Eval 12 keeps its scenario text up to the boundary stop and gains `"resumedBy": 13` plus these
ELEVEN criteria, in this order. Several of them are deliberate splits of a single clause (or, for
the dispatch pair, a single compound claim) from the old `expected_output`: a final-state, count, or
field-presence half a deterministic check can prove, and a historical, freshness, or naming half
only the transcript can speak to. Splitting them is what keeps a `deterministic` label honest.

The `no-premature-handoff-surfacing` and `twin-never-hand-edited` rows were NOT in this table when
the plan was approved. The Task 3 quality review found that `no-premature-handoff-surfacing` belongs
only in eval 12, because only a pre-approval transcript can violate it, while `twin-never-hand-edited`
belongs in BOTH eval 12 and eval 13, because each transcript can hand-edit the twin and each must pin
the prohibition for itself. This table is corrected rather than left to disagree with the code:
  - `no-premature-handoff-surfacing`. Eval 12's own prompt tells the agent the handoff files are
    "drafted and ready to surface once the boundary clears" and to "wrap up", and the original
    `expected_output` carried "surfacing either file before the approval fails". The split had left
    that obligation only in eval 13, whose scenario is post-approval, so nothing tested it in the
    one case that can actually violate it. An eval 12 transcript could surface both files early and
    still score full marks.
  - `twin-never-hand-edited`. `render.mjs` writes the Markdown twin during the phase-boundary
    render, and that render is eval 12's work. Eval 13 never renders. Leaving both twin criteria in
    eval 13 meant the only run that produces a twin carried no twin criterion at all.

The `dispatch-named` row is a later, separate correction. It was labelled `deterministic` with
evidence `dispatch-log`, but its text claimed a FRESH subagent and a named one-line tier
rationale, neither of which `validateEntry` in `references/dispatch-log.mjs` records. That function
requires exactly session, shape, why, tier, model, effort and outcome, with `phase` and `notes`
optional; it says nothing about subagent freshness, the dispatch's purpose, which file it handled,
Review mode, or whether a rationale is one line. Labelling that compound claim deterministic wrongly
removed semantic residue from the canary scope the evidence gate measures. The row split into
`dispatch-logged-once` (the count and field-presence half) and `dispatch-fresh-and-named` (the
freshness and naming claim the log cannot prove). Eval 13's `handoff-two-dispatches-named` had the
identical defect and split the same way, below. A LATER correction reclassifies `dispatch-logged-once`
itself (and its eval 13 counterpart) again, for an unrelated reason: see the paragraph after the
eval 13 table.

| id | kind | evidence | why this source can decide it |
|---|---|---|---|
| `dispatch-logged-once` | semantic | `transcript` | RECLASSIFIED: `defaultLogPath` resolves to a durable, per-user, append-only `dispatch-log.jsonl` that the runner never scopes, isolates, snapshots, or overrides per run, so a count over it cannot distinguish this run's dispatch from unrelated historical entries. Not decidable by `dispatch-log` until the runner adds run-scoped isolation; only the transcript can currently speak to the count and to whether the entry carries a valid tier, model, effort and outcome |
| `dispatch-fresh-and-named` | semantic | `transcript` | freshness and the one-line tier rationale leave no artifact in the log; only the transcript can show a genuinely fresh subagent was invoked and hear it name model, effort and the rationale |
| `ledger-fields-untouched` | deterministic | `ledger-diff` | stated as a final-state guarantee: the final ledger differs from the fixture ONLY in `win.landed` and `win.next`, with `win.evidence` and every drawer field byte-identical. A diff proves that. It does NOT prove which inputs the refiner was handed, so that separate claim is the next row |
| `refiner-given-only-allowed-fields` | semantic | `transcript` | what was passed INTO the subagent leaves no artifact |
| `ledger-before-render` | semantic | `transcript` | ordering, and nothing on disk records when the ledger was written relative to the render |
| `render-once-after-refine` | semantic | `transcript` | `render.mjs` overwrites its three outputs and keeps no invocation history |
| `surfaced` | semantic | `transcript` | a rendered HTML file existing does not prove anyone was shown it |
| `blocked-on-question` | semantic | `transcript` | the normal `AskUserQuestion` path writes no file; `escalation.mjs` only fires on the fallback path |
| `never-inline` | semantic | `transcript` | an absence of an inline invocation leaves no artifact |
| `no-premature-handoff-surfacing` | semantic | `transcript` | added by review: the pre-approval negative the original prose carried, which only this case can violate |
| `twin-never-hand-edited` | semantic | `transcript` | added by review: the historical claim, placed in the case that actually renders the twin |

One of the eleven is deterministic and ten are semantic. That ratio is the honest one, and it is
lower than two earlier drafts of this plan claimed, and lower again than the eleven-criteria table
first read before `dispatch-logged-once` was itself reclassified (see the paragraph after the eval 13
table). Do NOT read it as the final residue. The residue is whatever the evidence gate measures after
Tasks 1 to 5 have actually run, not a number declared here in advance.

Eval 13 is new. Its prompt states that the boundary has just been approved and that the handoff doc
and kickoff prompt are drafted, but their Review passes have not yet run. It carries `"resumes": 12`
and these SEVEN criteria, in this order. As in eval 12, a claim is split whenever one half is
provable from an artifact and the other is not, rather than labelling the whole thing deterministic
and hoping.

`twin-never-hand-edited` lives in BOTH eval 12 and eval 13; it was never moved, only added to
eval 13 as well. Eval 12 keeps its copy because `render.mjs` writes the Markdown twin during eval
12's own render. Eval 13 gets its own copy because an eval 13 transcript can hand-edit that same
twin and restore it before the run ends: `twin-matches-ledger` only compares final state, fixed-rubric
judging ignores `expected_output` entirely, and eval 12 cannot judge actions that happen in eval 13's
resumed transcript. Each case must pin the prohibition for its own transcript.

| id | kind | evidence | why this source can decide it |
|---|---|---|---|
| `handoff-two-dispatches-logged` | semantic | `transcript` | RECLASSIFIED: the same durable, per-user, run-unscoped `dispatch-log.jsonl` cannot decide a count of exactly two entries against the unrelated historical entries already in the file. Not decidable by `dispatch-log` until the runner adds run-scoped isolation; only the transcript can currently speak to the count and to whether each entry carries a valid tier, model, effort and outcome |
| `handoff-dispatches-fresh-and-named` | semantic | `transcript` | the log records nothing about subagent freshness, which file a dispatch handled, or Review mode; only the transcript can show each dispatch was a fresh subagent invoking the-refiner in Review mode and naming model, effort and a one-line tier rationale |
| `handoff-one-subagent-per-file` | semantic | `transcript` | WHICH file each dispatch handled is not in the log. `validateEntry` requires session, shape, why, tier, model, effort and outcome, with no target or file identity, and a convention buried in free-form `shape` or `why` text is not a validated field |
| `findings-applied-before-handoff` | semantic | `transcript` | the findings land in the handoff files, not the ledger, and ordering leaves no artifact |
| `hand-to-user-after-approval` | semantic | `transcript` | rewritten by review for the resumed frame. Its original text described a window outside eval 13's transcript, since eval 13 begins after the approval, so it passed for any transcript at all |
| `twin-matches-ledger` | deterministic | `rendered-twin` | stated as a final-state guarantee: the twin on disk is byte-identical to a fresh render from the final ledger. Eval 13's own fixture set supplies both the post-approval ledger and its renderer-generated `artifact.md`, so the comparison has real inputs. An edit-then-restore would still pass on this row alone, which is why the historical half is pinned separately, below |
| `twin-never-hand-edited` | semantic | `transcript` | added by review: an eval 13 transcript could hand-edit the twin and restore it, satisfying `twin-matches-ledger`'s final-state check while still violating the prohibition; only the transcript can catch the hand-edit itself |

One of the seven is deterministic and six are semantic.

**Neither table cites `dispatch-log`, and here is why.** `dispatch-logged-once` (eval 12) and
`handoff-two-dispatches-logged` (eval 13) were both reclassified from `deterministic`/`dispatch-log`
to `semantic`/`transcript`, so no criterion in either eval currently cites `dispatch-log` as its
evidence source. Measured against the real runner: `defaultLogPath` in `run-evals.mjs` resolves to
`~/.claude/the-foreman/dispatch-log.jsonl`, a durable, append-only, PER-USER file that currently
holds 210 entries from many unrelated sessions, and `run-evals.mjs` never reads, isolates, snapshots,
or overrides that file before or after an eval runs (`grep -n DISPATCH_LOG` on the runner returns
only the `EVIDENCE_SOURCES` comment). A count over that file cannot distinguish this run's dispatch
from any pre-existing unrelated entry, so "exactly one dispatch is recorded" and "exactly two
dispatches are recorded" are not decidable claims against it: either they read as always false against
the real file, or they are satisfiable by entries this run never produced. Labelling either criterion
`deterministic` on `dispatch-log` would be exactly the overstatement the earlier `dispatch-named` /
`handoff-two-dispatches-named` split was already trying to fix, just moved one layer down.

Promoting either criterion back to `deterministic` requires run-scoped isolation first: for example,
the runner setting `FOREMAN_DISPATCH_LOG` to a per-run path before the probe executes, or capturing a
pre-run and post-run snapshot of the log and diffing the delta. That isolation is NOT built by this
plan. It is recorded here only as an input for the evidence gate to weigh alongside the residue the
gate already computes, not as work this plan performs.

Each criterion's `text` restates the corresponding clause of the old eval 12 `expected_output`,
except where a clause was deliberately split into a provable final-state (or count) half and a
historical (or freshness/naming) half. `ledger-fields-untouched` and `twin-matches-ledger` are the
two criteria that add a final-state obligation the original clause did not state.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test plugin/skills/the-foreman/evals/*.test.mjs`
Expected: all pass. The catalog uniqueness test still holds with 14 evals.

- [ ] **Step 5: Commit, only if authorized**

```bash
git add plugin/skills/the-foreman/evals/evals.json plugin/skills/the-foreman/evals/run-evals.test.mjs
git commit -m "Split the refiner seam eval into linked pre-approval and post-approval cases"
```

---

## Phase 4: Make the fixture field live

### Task 4: Real fixtures, containment-safe materialization, and a drift check that fails the run

Note: `ledger-fields-untouched` (eval 12) cites `ledger-diff` and `twin-matches-ledger` (eval 13)
cites `rendered-twin`, but no fixture ledger or twin exists until this task lands. A red result on
either eval before this task's fixtures land is not a skill regression.

**Files:**
- Create: `plugin/skills/the-foreman/evals/fixtures.mjs`
- Create: `plugin/skills/the-foreman/evals/fixtures.test.mjs`
- Create: `plugin/skills/the-foreman/evals/fixtures/refiner-seam-pre/ledger.json`
- Create: `plugin/skills/the-foreman/evals/fixtures/refiner-seam-pre/handoff.md`
- Create: `plugin/skills/the-foreman/evals/fixtures/refiner-seam-pre/kickoff.md`
- Create: `plugin/skills/the-foreman/evals/fixtures/refiner-seam-post/ledger.json`
- Create: `plugin/skills/the-foreman/evals/fixtures/refiner-seam-post/artifact.md`
- Create: `plugin/skills/the-foreman/evals/fixtures/refiner-seam-post/handoff.md`
- Create: `plugin/skills/the-foreman/evals/fixtures/refiner-seam-post/kickoff.md`
- Modify: `plugin/skills/the-foreman/evals/run-evals.mjs`
- Modify: `plugin/skills/the-foreman/evals/evals.json`
- Test: `plugin/skills/the-foreman/evals/run-evals.test.mjs`

**Interfaces:**
- Consumes: evals 12 and 13 from Task 3.
- Produces:
  - `materialize(files, destDir, srcRoot)` returns `{ workspace, entries: [{ rel, sha256, kind }] }`.
    `kind` is always the string `'file'`, because materialization accepts nothing else. It is
    recorded rather than implied so `verifyUnchanged` compares against a stored value instead of a
    hardcoded assumption.
    It throws on a missing file, an empty path, an absolute path, a parent-traversing path, a
    source that escapes `srcRoot` after symlink resolution, or a destination that escapes
    `destDir`. Source and destination containment use DIFFERENT algorithms on purpose, because the
    destination does not exist yet and cannot be realpath-resolved before it is created.
  - `verifyUnchanged(entries, srcRoot)` returns `{ ok, drifted }`. A deleted original counts as
    drift. It never writes.
  - `FIXTURE_ROOT` is the evals directory, exported so the runner and the tests agree on `srcRoot`.

- [ ] **Step 1: Write the fixture files, two sets, one per case**

The two split cases are at DIFFERENT points in the same story, so one fixture set cannot serve
both. Eval 13 resumes after the boundary was approved, which means the refinement and the render
have already happened. Handing it the pre-approval slop ledger would leave `twin-matches-ledger`
with nothing to compare, and the resumed case would have no continuity with the case it resumes.

**`fixtures/refiner-seam-pre/` serves eval 12.**

`ledger.json` is a Phase 2 boundary ledger whose `win.landed` and `win.next` are deliberately
written in AI slop, so the refiner seam has something real to rewrite. Give it `meta.title`, a
`win` object with `landed`, `evidence`, `verified: true` and `next`, and at least one `slides[]`
entry carrying `bullets` as drawer evidence the eval forbids touching. `win.evidence` must be clean
prose, so any change to it is unambiguous.

`handoff.md` and `kickoff.md` are short drafted documents, each carrying at least one banned tell
so the Review pass has something to find.

**`fixtures/refiner-seam-post/` serves eval 13.**

`ledger.json` is the SAME ledger after the refinement landed: `win.landed` and `win.next` now read
in plain voice, and `win.evidence` plus every drawer field are byte-identical to the pre set. This
is what gives eval 13 its continuity with eval 12.

`artifact.md` is the generated Markdown twin of that post-approval ledger, and it must be produced
by the real renderer, never hand-written:

```bash
OUT=$(mktemp -d)
node plugin/skills/the-foreman/references/render.mjs \
  plugin/skills/the-foreman/evals/fixtures/refiner-seam-post/ledger.json \
  brief "$OUT/artifact.html"
cp "$OUT/artifact.md" plugin/skills/the-foreman/evals/fixtures/refiner-seam-post/artifact.md
rm -rf "$OUT"
```

`mktemp -d` is required, not stylistic. `render.mjs` writes straight to the paths it is given and
does not create parent directories, so a hardcoded `/tmp/seam-post/artifact.html` fails with ENOENT
on any machine where that directory does not already exist.

That file is the evidence source `twin-matches-ledger` compares against. Generating it with the
renderer is what makes the criterion meaningful: a re-render from the ledger must reproduce it byte
for byte, so a hand edit anywhere shows up.

`handoff.md` and `kickoff.md` in the post set are the same drafted documents, still carrying their
tells, because eval 13's Review pass has not run on them yet.

Every file in both sets must be em-dash clean.

Pin the continuity with a test:

```javascript
test('the post fixture ledger is the pre ledger with only the refined fields changed', () => {
  const pre = JSON.parse(readFileSync(join(FIXTURE_ROOT, 'fixtures/refiner-seam-pre/ledger.json'), 'utf8'));
  const post = JSON.parse(readFileSync(join(FIXTURE_ROOT, 'fixtures/refiner-seam-post/ledger.json'), 'utf8'));
  assert.notStrictEqual(post.win.landed, pre.win.landed, 'win.landed must have been refined');
  assert.notStrictEqual(post.win.next, pre.win.next, 'win.next must have been refined');
  // Normalize ONLY the two fields allowed to differ, then deep-compare the whole remaining object.
  // Spot-checking win.evidence and slides would let a change to meta or win.verified slip through.
  const norm = (L) => {
    const c = structuredClone(L);
    delete c.win.landed;
    delete c.win.next;
    return c;
  };
  assert.deepStrictEqual(norm(post), norm(pre),
    'no field outside win.landed and win.next may differ between the two fixture ledgers');
});

test('the post fixture twin is exactly what the renderer produces from the post ledger', () => {
  // Re-render the post ledger to a temp path and byte-compare the twin.
  // This is the same check twin-matches-ledger performs, so a stale fixture fails here first.
  const out = mkdtempSync(join(tmpdir(), 'twin-'));
  execFileSync(process.execPath, [
    fileURLToPath(new URL('../references/render.mjs', import.meta.url)),
    join(FIXTURE_ROOT, 'fixtures/refiner-seam-post/ledger.json'), 'brief', join(out, 'a.html'),
  ]);
  assert.strictEqual(
    readFileSync(join(out, 'a.md'), 'utf8'),
    readFileSync(join(FIXTURE_ROOT, 'fixtures/refiner-seam-post/artifact.md'), 'utf8'),
    'the committed twin must match a fresh render of the committed ledger');
  rmSync(out, { recursive: true, force: true });
});
```

- [ ] **Step 2: Write the failing tests**

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync, symlinkSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { materialize, verifyUnchanged } from './fixtures.mjs';

function srcTree() {
  const root = mkdtempSync(join(tmpdir(), 'fx-src-'));
  mkdirSync(join(root, 'sub'), { recursive: true });
  writeFileSync(join(root, 'sub', 'ledger.json'), '{"meta":{"title":"t"}}');
  return root;
}
const dest = () => mkdtempSync(join(tmpdir(), 'fx-dest-'));
const clean = (...ds) => ds.forEach((d) => rmSync(d, { recursive: true, force: true }));

test('materialize copies every declared file and records a sha256 for each', () => {
  const s = srcTree(); const d = dest();
  const r = materialize(['sub/ledger.json'], d, s);
  assert.strictEqual(r.entries.length, 1);
  assert.match(r.entries[0].sha256, /^[0-9a-f]{64}$/);
  assert.strictEqual(r.entries[0].kind, 'file', 'every entry records its type for verifyUnchanged');
  assert.strictEqual(r.entries[0].rel, 'sub/ledger.json');
  assert.strictEqual(readFileSync(join(r.workspace, 'sub', 'ledger.json'), 'utf8'), '{"meta":{"title":"t"}}');
  clean(s, d);
});

test('materialize throws when a declared file is missing rather than running fixture-less', () => {
  const s = srcTree(); const d = dest();
  assert.throws(() => materialize(['sub/nope.json'], d, s), /nope\.json/);
  clean(s, d);
});

test('materialize rejects empty, absolute and parent-traversing paths', () => {
  const s = srcTree(); const d = dest();
  for (const bad of ['', '   ', '/etc/passwd', '../outside.txt', 'sub/../../outside.txt']) {
    assert.throws(() => materialize([bad], d, s), /path/i, `must reject ${JSON.stringify(bad)}`);
  }
  clean(s, d);
});

test('materialize rejects an in-root symlink source, so verifyUnchanged cannot report false drift', () => {
  const s = srcTree(); const d = dest();
  symlinkSync(join(s, 'sub', 'ledger.json'), join(s, 'alias.json'));
  assert.throws(() => materialize(['alias.json'], d, s), /regular file|symlink/i,
    'an in-root symlink must be refused at materialization, not accepted then flagged as drift');
  clean(s, d);
});

test('materialize refuses a source symlink that escapes srcRoot', () => {
  const s = srcTree(); const d = dest();
  const outside = mkdtempSync(join(tmpdir(), 'fx-out-'));
  writeFileSync(join(outside, 'secret.txt'), 'nope');
  symlinkSync(join(outside, 'secret.txt'), join(s, 'escape.txt'));
  assert.throws(() => materialize(['escape.txt'], d, s), /escape|contain/i);
  clean(s, d, outside);
});

test('materialize refuses a destination whose parent directory is a symlink out of destDir', () => {
  const s = srcTree(); const d = dest();
  const outside = mkdtempSync(join(tmpdir(), 'fx-out-'));
  symlinkSync(outside, join(d, 'sub'));
  assert.throws(() => materialize(['sub/ledger.json'], d, s), /escape|contain|symlink/i,
    'a pre-existing symlinked parent must not become a write target outside destDir');
  clean(s, d, outside);
});

test('materialize refuses to overwrite through an existing destination symlink', () => {
  const s = srcTree(); const d = dest();
  const outside = mkdtempSync(join(tmpdir(), 'fx-out-'));
  writeFileSync(join(outside, 'target.txt'), 'original');
  mkdirSync(join(d, 'sub'), { recursive: true });
  symlinkSync(join(outside, 'target.txt'), join(d, 'sub', 'ledger.json'));
  assert.throws(() => materialize(['sub/ledger.json'], d, s), /symlink/i);
  assert.strictEqual(readFileSync(join(outside, 'target.txt'), 'utf8'), 'original',
    'the outside file must be untouched');
  clean(s, d, outside);
});

test('verifyUnchanged reports drift when an original was modified during the run', () => {
  const s = srcTree(); const d = dest();
  const r = materialize(['sub/ledger.json'], d, s);
  assert.deepEqual(verifyUnchanged(r.entries, s), { ok: true, drifted: [] });
  writeFileSync(join(s, 'sub', 'ledger.json'), 'tampered');
  assert.deepEqual(verifyUnchanged(r.entries, s), { ok: false, drifted: ['sub/ledger.json'] });
  clean(s, d);
});

test('verifyUnchanged counts a deleted original as drift, not as unchanged', () => {
  const s = srcTree(); const d = dest();
  const r = materialize(['sub/ledger.json'], d, s);
  unlinkSync(join(s, 'sub', 'ledger.json'));
  assert.deepEqual(verifyUnchanged(r.entries, s), { ok: false, drifted: ['sub/ledger.json'] });
  clean(s, d);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node --test plugin/skills/the-foreman/evals/fixtures.test.mjs`

Expected RED, stated precisely: a MODULE LOAD failure with ZERO registered tests. The import of
`./fixtures.mjs` is static and the file does not exist, so the runner reports one file-level error
and never registers a single test. Do not expect eight failing tests. If you see registered test
failures instead of a load failure, something already created the module and you should stop and
find out what.

- [ ] **Step 4: Implement fixtures.mjs**

`materialize(files, destDir, srcRoot)`:

1. Reject a non-string, an empty or whitespace-only path, an absolute path, and any path whose
   normalized form starts with `..`. This is the lexical gate and it runs first, before any
   filesystem call.
2. Source side, in exactly this order. The order matters, because two different rules can both
   reject a symlink and each needs to stay reachable with its own message.

   a. Throw naming the entry when the source is absent.
   b. CONTAINMENT FIRST. Resolve with `realpathSync` and require the resolved path to sit inside
      `realpathSync(srcRoot)`. Throw an escape error if it does not. An escaping symlink hits this
      rule, and its message names containment.
   c. THEN the type rule. `lstat` the entry and reject anything that is not a regular file, symlinks
      included. An in-root symlink survives step b and is rejected here, with a message naming the
      regular-file requirement.

   Running the type rule first would make the containment error unreachable for symlinks, since
   every symlink would be refused before containment was ever evaluated, and the two tests below
   would then demand incompatible messages from the same branch.

   Rejecting every non-regular source is what keeps `materialize` and `verifyUnchanged` consistent.
   Materialization accepts only regular files, so `verifyUnchanged` can treat any non-regular
   original as drift without ever producing a spurious report on a run that changed nothing.
3. Destination side, in this order, because the destination does not exist yet:
   a. Compute the destination lexically as `resolve(destDir, rel)` and require it to sit inside
      `resolve(destDir)`. The lexical check is the primary destination guard.
   b. Walk the parent chain from `destDir` downward, creating each missing directory. For each
      parent that ALREADY exists, `realpathSync` it and require it to stay inside
      `realpathSync(destDir)`. This catches a pre-existing symlinked subdirectory.
   c. If the final destination path already exists and is a symlink, throw. Never follow it and
      never overwrite through it.
4. Copy the bytes and record `{ rel, sha256, kind: 'file' }` for the source.

Return `{ workspace: destDir, entries }`.

`verifyUnchanged(entries, srcRoot)`: for each entry, `lstat` the original and re-hash it. Drift is
any of: the file is missing, its current type no longer matches the entry's recorded `kind` (a
symlink replacement counts, even one pointing at identical bytes), or its sha256 moved. Return `{ ok, drifted }` listing every affected
`rel`. Never write.

**State the guarantee honestly, because a post-run comparison cannot deliver more than this.** What
this proves is FINAL byte drift plus a type change. It does NOT prove the originals were never
written to. An executor that modifies a file and restores it byte-for-byte before returning passes
this check, and nothing available in phase 1 can catch that. Closing that hole needs read-only
isolation of the fixture source, which is execution-harness work and therefore belongs to the
canary, not here. Say so in the module's header comment rather than letting a future reader assume
a stronger property. `materialize` must therefore record `kind: 'file'` alongside `rel` and
`sha256`, so `verifyUnchanged` has a type to compare against.

Add these two tests:

```javascript
test('verifyUnchanged treats a same-content symlink replacement as drift', () => {
  const s = srcTree(); const d = dest();
  const r = materialize(['sub/ledger.json'], d, s);
  const twin = join(s, 'twin.json');
  writeFileSync(twin, '{"meta":{"title":"t"}}');           // byte-identical content
  unlinkSync(join(s, 'sub', 'ledger.json'));
  symlinkSync(twin, join(s, 'sub', 'ledger.json'));
  assert.deepEqual(verifyUnchanged(r.entries, s), { ok: false, drifted: ['sub/ledger.json'] },
    'a type change is drift even when the bytes match');
  clean(s, d);
});

test('verifyUnchanged cannot see a modify-then-restore, which is a documented limit', () => {
  const s = srcTree(); const d = dest();
  const r = materialize(['sub/ledger.json'], d, s);
  const p = join(s, 'sub', 'ledger.json');
  const original = readFileSync(p);
  writeFileSync(p, 'tampered');
  writeFileSync(p, original);
  assert.deepEqual(verifyUnchanged(r.entries, s), { ok: true, drifted: [] },
    'this documents the limit rather than claiming a guarantee the check cannot make');
  clean(s, d);
});
```

The second test is deliberately an assertion that the check does NOT catch something. It exists so
the limit is written down in executable form and cannot quietly be forgotten.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test plugin/skills/the-foreman/evals/fixtures.test.mjs`
Expected: 0 fail. The suite should hold 11 tests at this point: copies and hashes, missing file,
the five rejected path shapes in one test, in-root symlink source rejected, source symlink escape,
destination parent symlink, destination symlink overwrite, modified original, deleted original,
same-content symlink replacement, and the documented modify-then-restore limit. Verify zero
failures rather than trusting that count. If the number differs, reconcile it against the tests you
actually wrote before moving on.

- [ ] **Step 6: Assign the fixtures to evals 12 and 13**

Each case gets its OWN set, relative to `FIXTURE_ROOT`, which is the evals directory.

Eval 12: `["fixtures/refiner-seam-pre/ledger.json", "fixtures/refiner-seam-pre/handoff.md",
"fixtures/refiner-seam-pre/kickoff.md"]`

Eval 13: `["fixtures/refiner-seam-post/ledger.json", "fixtures/refiner-seam-post/artifact.md",
"fixtures/refiner-seam-post/handoff.md", "fixtures/refiner-seam-post/kickoff.md"]`

Add this catalog test:

```javascript
test('the split refiner seam evals declare real, existing fixture files', () => {
  for (const id of [12, 13]) {
    const e = loadEvals().find((x) => x.id === id);
    assert.ok(Array.isArray(e.files) && e.files.length > 0, `eval ${id} must declare fixtures`);
    for (const rel of e.files) {
      assert.ok(existsSync(join(FIXTURE_ROOT, rel)), `eval ${id} fixture missing: ${rel}`);
    }
  }
});

test('the pre ledger fixture carries the exact state the scenario needs', () => {
  const L = JSON.parse(readFileSync(join(FIXTURE_ROOT, 'fixtures/refiner-seam-pre/ledger.json'), 'utf8'));
  assert.ok(L.meta && typeof L.meta.title === 'string' && L.meta.title.length > 0);
  assert.ok(L.win, 'the fixture must carry a win block for the boundary brief');
  for (const k of ['landed', 'evidence', 'next']) {
    assert.ok(typeof L.win[k] === 'string' && L.win[k].length > 0, `win.${k} required`);
  }
  assert.strictEqual(L.win.verified, true);
  assert.ok(Array.isArray(L.slides) && L.slides.length > 0 && L.slides[0].bullets,
    'the fixture must carry drawer evidence the eval forbids touching');
});

test('the pre ledger fixture prose is actually refinable and its protected fields are not', () => {
  const L = JSON.parse(readFileSync(join(FIXTURE_ROOT, 'fixtures/refiner-seam-pre/ledger.json'), 'utf8'));
  const TELLS = /leverag|robust|seamless|crucial|it's worth noting|comprehensive/i;
  assert.match(L.win.landed, TELLS, 'win.landed must contain a tell for the refiner to remove');
  assert.match(L.win.next, TELLS, 'win.next must contain a tell for the refiner to remove');
  assert.doesNotMatch(L.win.evidence, TELLS,
    'win.evidence must be clean, so any change to it is unambiguous evidence of a seam violation');
});

test('both markdown fixtures are non-empty and give the Review pass something to find', () => {
  const TELLS = /leverag|robust|seamless|crucial|it's worth noting|firstly/i;
  for (const rel of ['fixtures/refiner-seam-pre/handoff.md', 'fixtures/refiner-seam-pre/kickoff.md',
                     'fixtures/refiner-seam-post/handoff.md', 'fixtures/refiner-seam-post/kickoff.md']) {
    const body = readFileSync(join(FIXTURE_ROOT, rel), 'utf8');
    assert.ok(body.trim().length > 200, `${rel} must be a real document, not a stub`);
    assert.match(body, TELLS, `${rel} must contain a tell the Review pass should report`);
  }
});
```

- [ ] **Step 7: Wire fixtures into the runner and make drift fail the run**

This is where fixtures enter `run-evals.mjs`. Task 2 deliberately left `DEFAULT_DEPS` as
`{ runClaude }` so that `run-evals.mjs` could load before `fixtures.mjs` existed. Now extend it.

Add the import, export `FIXTURE_ROOT` as the evals directory, and define the workspace helper here,
not in Task 2:

```javascript
import { materialize, verifyUnchanged } from './fixtures.mjs';
export const FIXTURE_ROOT = HERE;

// A unique per-run workspace. mkdtempSync guarantees no collision between concurrent runs.
export function mkWorkspace(root, evalDef) {
  mkdirSync(root, { recursive: true });
  return mkdtempSync(join(root, `eval-${evalDef.id}-`));
}

export const DEFAULT_DEPS = { runClaude, materialize, verifyUnchanged, mkWorkspace,
                              fixtureRoot: FIXTURE_ROOT, workspaceRoot: RESULTS_DIR };
```

Then rewrite `executeEval` to the full form. Note the nested try around the verification itself:
`verifyUnchanged` reads and hashes files, so a permission or IO error there could otherwise escape
`finally` and break the never-rethrows contract this function promises.

```javascript
export function executeEval(evalDef, opts, deps = {}) {
  const d = { ...DEFAULT_DEPS, ...deps };
  const run = {};
  let fx = null;
  try {
    if (Array.isArray(evalDef.files) && evalDef.files.length > 0) {
      fx = d.materialize(evalDef.files, d.mkWorkspace(d.workspaceRoot, evalDef), d.fixtureRoot);
      run.fixtures = { workspace: fx.workspace, entries: fx.entries };
    }
    run.transcript = d.runClaude(
      buildProbePrompt(evalDef, { baseline: opts.baseline, fixtures: fx }), opts.model,
      { allowedTools: 'Read,Glob,Grep,Bash(node *)' },
    );
    run.verdict = parseVerdict(
      d.runClaude(buildJudgePrompt(evalDef, run.transcript), opts.judgeModel), evalDef,
    );
  } catch (err) {
    run.error = String(err?.message ?? err);
    run.verdict = null;
  } finally {
    if (fx) {
      try {
        const chk = d.verifyUnchanged(fx.entries, d.fixtureRoot);
        run.fixtures.unchanged = chk.ok;
        if (!chk.ok) {
          const msg = `fixture originals disturbed: ${chk.drifted.join(', ')}`;
          run.error = run.error ? `${run.error}; ${msg}` : msg;
          run.verdict = null;
        }
      } catch (verr) {
        // Fail closed. An unverifiable run is not a passing run.
        run.fixtures.unchanged = null;
        const msg = `fixture verification failed: ${String(verr?.message ?? verr)}`;
        run.error = run.error ? `${run.error}; ${msg}` : msg;
        run.verdict = null;
      }
    }
  }
  return run;
}
```

Update the `isMain` loop to read `run.error` rather than catching, since `executeEval` no longer
throws. When `files` is empty or absent, the function behaves exactly as Task 2 left it.

Add these runner tests, all with an injected fake `runClaude` and therefore free:

```javascript
// Every test below injects a temp fixtureRoot and workspaceRoot, so nothing touches the committed
// fixtures under plugin/skills/the-foreman/evals/fixtures/ or the real per-user results directory.
function fxEval() {
  return { id: 98, name: 'fx', prompt: 'p', expected_output: 'e', files: ['sub/ledger.json'] };
}
function tempRoots() {
  const src = mkdtempSync(join(tmpdir(), 'rt-src-'));
  mkdirSync(join(src, 'sub'), { recursive: true });
  writeFileSync(join(src, 'sub', 'ledger.json'), '{"ok":true}');
  return { src, work: mkdtempSync(join(tmpdir(), 'rt-work-')) };
}
const GOOD = JSON.stringify({ criteria: [{ id: 'c1', text: 'a', passed: true }] });
const ONE_CRIT = { ...fxEval(), criteria: [{ id: 'c1', text: 'a', kind: 'semantic', evidence: 'transcript' }] };

test('a fixture run that leaves the originals untouched keeps its verdict', () => {
  const { src, work } = tempRoots();
  const run = executeEval(ONE_CRIT, { model: 'm', judgeModel: 'j' },
    { runClaude: (p, m, o) => (o ? 'transcript' : GOOD), fixtureRoot: src, workspaceRoot: work });
  assert.strictEqual(run.verdict.pass_rate, 1);
  assert.strictEqual(run.fixtures.unchanged, true);
  assert.strictEqual(run.error, undefined);
  rmSync(src, { recursive: true, force: true }); rmSync(work, { recursive: true, force: true });
});

test('a fixture run whose executor modified an original fails and discards the verdict', () => {
  const { src, work } = tempRoots();
  const run = executeEval(ONE_CRIT, { model: 'm', judgeModel: 'j' }, {
    runClaude: (p, m, o) => {
      if (o) { writeFileSync(join(src, 'sub', 'ledger.json'), 'tampered'); return 'transcript'; }
      return GOOD;
    }, fixtureRoot: src, workspaceRoot: work });
  assert.strictEqual(run.verdict, null, 'a drifted run must never report a pass_rate');
  assert.match(run.error, /sub\/ledger\.json/);
  assert.strictEqual(run.fixtures.unchanged, false);
  rmSync(src, { recursive: true, force: true }); rmSync(work, { recursive: true, force: true });
});

test('a fixture run whose executor deleted an original fails the run', () => {
  const { src, work } = tempRoots();
  const run = executeEval(ONE_CRIT, { model: 'm', judgeModel: 'j' }, {
    runClaude: (p, m, o) => { if (o) { unlinkSync(join(src, 'sub', 'ledger.json')); return 't'; } return GOOD; },
    fixtureRoot: src, workspaceRoot: work });
  assert.strictEqual(run.verdict, null);
  assert.match(run.error, /sub\/ledger\.json/);
  rmSync(src, { recursive: true, force: true }); rmSync(work, { recursive: true, force: true });
});

test('a fixture run whose executor threw still verifies the originals and never rethrows', () => {
  const { src, work } = tempRoots();
  const run = executeEval(ONE_CRIT, { model: 'm', judgeModel: 'j' }, {
    runClaude: () => { throw new Error('executor exploded'); }, fixtureRoot: src, workspaceRoot: work });
  assert.match(run.error, /executor exploded/);
  assert.strictEqual(run.fixtures.unchanged, true, 'verification must still have run');
  rmSync(src, { recursive: true, force: true }); rmSync(work, { recursive: true, force: true });
});

test('a run whose verification itself throws fails closed rather than escaping executeEval', () => {
  const { src, work } = tempRoots();
  const run = executeEval(ONE_CRIT, { model: 'm', judgeModel: 'j' }, {
    runClaude: (p, m, o) => (o ? 'transcript' : GOOD),
    verifyUnchanged: () => { throw new Error('hash IO error'); },
    fixtureRoot: src, workspaceRoot: work });
  assert.strictEqual(run.verdict, null, 'an unverifiable run is not a passing run');
  assert.match(run.error, /hash IO error/);
  assert.strictEqual(run.fixtures.unchanged, null);
  rmSync(src, { recursive: true, force: true }); rmSync(work, { recursive: true, force: true });
});
```

- [ ] **Step 7b: Make buildProbePrompt actually carry the fixtures**

`buildProbePrompt` currently ignores everything except `evalDef.prompt`. Passing it a `fixtures`
option changes nothing until the builder reads it, and without this step `files` stays inert while
every runner test still passes. Change the signature to
`buildProbePrompt(evalDef, { baseline = false, fixtures = null } = {})` and, when `fixtures` is
present, append exactly this block after the scenario line:

```javascript
const fixtureBlock = fixtures ? `

Fixture workspace: ${fixtures.workspace}
The scenario's files are already materialized there. Read them from that workspace, not from the repo:
${fixtures.entries.map((e) => `- ${e.rel}`).join('\n')}
` : '';
```

Add these tests:

```javascript
test('buildProbePrompt names the workspace and every relative path when fixtures are present', () => {
  const fx = { workspace: '/tmp/ws-1', entries: [{ rel: 'a/b.json' }, { rel: 'c.md' }] };
  const p = buildProbePrompt({ id: 1, name: 'n', prompt: 'scenario text' }, { fixtures: fx });
  assert.ok(p.includes('/tmp/ws-1'), 'the workspace path must reach the executor');
  assert.ok(p.includes('- a/b.json'), 'every declared relative path must reach the executor');
  assert.ok(p.includes('- c.md'));
});

test('buildProbePrompt is byte-identical to the legacy prompt when no fixtures are present', () => {
  const e = { id: 1, name: 'n', prompt: 'scenario text' };
  assert.strictEqual(buildProbePrompt(e, { fixtures: null }), buildProbePrompt(e));
  assert.doesNotMatch(buildProbePrompt(e), /Fixture workspace/);
});
```

- [ ] **Step 8: Make the dry run exercise the same path**

`--dry-run` must materialize through `materialize` and print the same fixture-bearing prompt the
real run would send, then exit without any CLI call. Otherwise the dry run validates a prompt the
runner never sends.

```bash
node plugin/skills/the-foreman/evals/run-evals.mjs --ids 12 --dry-run
```

Expected: the prompt prints, it names a fixture workspace and the three relative paths, and no
`claude` process is spawned.

Pin that last clause with a test rather than trusting it:

```javascript
test('a dry run materializes fixtures but never invokes runClaude', () => {
  const { src, work } = tempRoots();
  let called = 0;
  const out = dryRunPrompt(ONE_CRIT, { model: 'm', judgeModel: 'j', dryRun: true },
    { runClaude: () => { called += 1; return 'x'; }, fixtureRoot: src, workspaceRoot: work });
  assert.strictEqual(called, 0, 'a dry run must never spend a call');
  assert.match(out, /Fixture workspace:/);
  rmSync(src, { recursive: true, force: true }); rmSync(work, { recursive: true, force: true });
});
```

Export `dryRunPrompt(evalDef, opts, deps)` for this, sharing the same materialization path
`executeEval` uses, so the dry run can never validate a prompt the real run would not send.

- [ ] **Step 9: Run everything**

```bash
node --test plugin/skills/the-foreman/evals/*.test.mjs
```

Expected: all pass.

- [ ] **Step 10: Commit, only if authorized**

```bash
git add plugin/skills/the-foreman/evals/fixtures.mjs plugin/skills/the-foreman/evals/fixtures.test.mjs \
        plugin/skills/the-foreman/evals/fixtures/ \
        plugin/skills/the-foreman/evals/run-evals.mjs plugin/skills/the-foreman/evals/run-evals.test.mjs \
        plugin/skills/the-foreman/evals/evals.json
git commit -m "Materialize declared eval fixtures and fail any run that disturbs the originals"
```

---

## Phase 5: The final sweep

### Task 5: Prove the three em-dash rules and the untouched frozen record

**Files:** none created or modified. This task only verifies.

- [ ] **Step 1: Prove the five drift-scanned files are clean**

```bash
node --test plugin/skills/the-refiner/references/*.test.mjs
```

Expected: 11 pass, 0 fail. Its em-dash test is the proof for rule 1.

- [ ] **Step 2: Prove every file this plan created is clean**

```bash
CREATED=(
  plugin/skills/the-foreman/evals/fixtures.mjs
  plugin/skills/the-foreman/evals/fixtures.test.mjs
  plugin/skills/the-foreman/evals/fixtures/refiner-seam-pre/ledger.json
  plugin/skills/the-foreman/evals/fixtures/refiner-seam-pre/handoff.md
  plugin/skills/the-foreman/evals/fixtures/refiner-seam-pre/kickoff.md
  plugin/skills/the-foreman/evals/fixtures/refiner-seam-post/ledger.json
  plugin/skills/the-foreman/evals/fixtures/refiner-seam-post/artifact.md
  plugin/skills/the-foreman/evals/fixtures/refiner-seam-post/handoff.md
  plugin/skills/the-foreman/evals/fixtures/refiner-seam-post/kickoff.md
  docs/initiatives/2026-08-29-refiner-followups/pair-9.fragment.md
  docs/initiatives/2026-08-29-refiner-followups/design.md
  docs/initiatives/2026-08-29-refiner-followups/ADR-001-followup-b-staging.md
  docs/initiatives/2026-08-29-refiner-followups/execution-plan.md
)
missing=0
for f in "${CREATED[@]}"; do
  if [ ! -f "$f" ]; then echo "MISSING $f"; missing=1; fi
done
[ "$missing" -eq 0 ] || { echo "STOP: the sweep cannot prove a rule about files that do not exist"; exit 1; }
for f in "${CREATED[@]}"; do
  grep -q $'\xe2\x80\x94' "$f"; echo "$? $f"
done
```

Expected: no `MISSING` line, then every remaining line starts with `1`. The existence pass runs
first on purpose: `grep` against an absent file also exits non-zero, which would read as a pass and
prove nothing. Note the bash array. zsh does not word-split a plain `$VAR` in a `for` loop, which is
why this uses `"${CREATED[@]}"` rather than a space-joined string.

- [ ] **Step 3: Prove no ADDED line introduced an em dash**

```bash
git diff a422612 -- plugin/ | grep '^+' | grep -c $'\xe2\x80\x94'
```

Expected: `0`. This counts only added lines, so pre-existing em dashes are correctly ignored.

- [ ] **Step 4: Prove the prior initiative's record is untouched**

```bash
git diff a422612 -- docs/initiatives/2026-08-28-the-refiner/
```

Expected: no output.

- [ ] **Step 4b: Prove the Aug 28 snapshot directory is untouched**

```bash
S="${TMPDIR:-/tmp}/refiner-followups-verify"
python3 "$S/fingerprint.py" "${TMPDIR:-/tmp}/the-refiner-verify" > "$S/prior-snapshot.now"
diff "$S/prior-snapshot.fingerprint" "$S/prior-snapshot.now" && echo "PRIOR SNAPSHOT UNTOUCHED"
```

Expected: `PRIOR SNAPSHOT UNTOUCHED`, with no diff output. It replays the SAME script recorded in
Task 1 Step 0, so the two sides are directly comparable. Each row is a relative path, the entry
kind, the size, the exact `st_mtime_ns` and the sha256, sorted by path. Nanosecond stat values are
used rather than an `ls` listing, because `ls` reports minute precision and would silently satisfy
an exact-mtime claim it cannot actually check. Both writes land in the NEW namespace, so the check
never disturbs what it checks.

- [ ] **Step 5: Run the full baseline one last time**

```bash
node --test plugin/skills/the-foreman/references/*.test.mjs plugin/skills/the-foreman/evals/*.test.mjs
bash plugin/skills/codex-gate/codex-gate.test.sh
node --test plugin/skills/the-refiner/references/*.test.mjs
claude plugin validate ./plugin --strict
```

Expected: no regression against 593/0, PASS=441 FAIL=0, 11/0, Validation passed. The foreman suite
count will exceed 593 because Tasks 2, 3 and 4 add tests to it; it must never drop and must never
report a failure.

---

## The evidence gate

The evidence gate sits after Task 5, not after Task 4. Task 5 is what produces the verification
this gate reads, so running the gate before it would be reading claims instead of evidence. It is a
`phase-boundary` hard gate and it decides one extra thing: whether the execution canary is built at
all, and if so under what call budget. Bring three things to it.

1. The full green baseline after Tasks 1 to 5, including Task 5's four proofs.
2. The MEASURED split of eval 12 and eval 13 criteria into those a `dispatch-log`, `ledger-diff` or
   `rendered-twin` check can decide, and those that still need a judge. Measure it against the
   criterion tables as built, do not restate the tables in this plan.
3. The residue, computed at the gate rather than declared in advance: the criteria that no
   evidence source available at that moment can settle. Compute it for EVAL 12 ONLY. ADR-001
   narrows the canary to eval 12, so eval 12's residue is the only input that can scope it. This
   plan's tables suggest the residue will be the ordering and absence criteria, but that is an
   expectation, not a finding.

The residue is what scopes the canary, and it scopes it by exclusion. A criterion the log or a
ledger diff already settles falls OUT of canary scope, because the canary would add nothing to it.
The canary targets only the unresolved criteria, and its job is to introduce execution evidence
that can settle them, such as an append-only render trace for a render count no final artifact can
prove. If eval 12's residue is empty, the canary is unnecessary and ADR-001's phase 2 closes as not
needed. Any paid run at any point needs its own live-run gate naming the exact call count.

**Eval 13 is closed separately and is NOT canary scope.** ADR-001 narrows the canary to eval 12, so
eval 13's own residue has no disposition inside this plan and must not silently acquire one. Eval 13
stays graded by the fixed-rubric probe that Tasks 2 to 4 give it, which is already a strict
improvement on what it had. Bring eval 13's residue to the gate as INFORMATION, clearly labelled as
out of scope. Extending execution coverage to eval 13 would widen an ADR the owner accepted with
"narrow eval-12 execution canary" as an explicit amendment, so it needs a fresh owner decision at a
`decision-fork`, not a quiet inclusion here.

## Follow-up B phase 2, the execution canary, is deliberately unscoped here

ADR-001 fixes it as a narrow eval-12 execution canary. Its design depends on the residue the
evidence gate measures, so writing its steps now would be guessing. It gets its own plan bundle and
its own codex-gate pass after the evidence gate answers. This is a gate, not a gap. It is not
"Phase 5"; Phase 5 in this plan is the final sweep, and it is a different thing.
