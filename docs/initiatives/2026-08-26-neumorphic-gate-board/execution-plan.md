# Neumorphic Gate Board Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the-foreman's MindCloud slide-deck artifact engine with the neumorphic Gate Board: one scrolling verdict-first page with poster figures, a sticky chapter rail, and zero pagination.

**Architecture:** The deterministic pipeline stays: ledger JSON → `templates.mjs` → `render.mjs` wraps with inlined CSS + page script → HTML + Markdown twin, secret-scanned fail-closed. What changes: `style.css` is rewritten in the neumorphic system, `slide-engine.js` is replaced by `gate-board.js`, a new `scaffold.mjs` renders the shared page shell, `blocks.mjs` gains six figure blocks, and a new non-fatal `lint.mjs` runs at render time.

**Tech Stack:** Vanilla ESM Node (no deps), node:test via the repo's test files (`node --test plugin/skills/the-foreman/references/`), plain CSS/JS artifacts.

## Global Constraints

- Repo root for all paths below: `/Users/angel/personal/the-foreman-gate-board` (worktree, branch `feat/neumorphic-gate-board`). All engine paths are under `plugin/skills/the-foreman/`.
- **Design source of truth:** `docs/initiatives/2026-08-26-neumorphic-gate-board/design.md` (the spec) and `gate-board-reference.html` (the owner-approved mockup — lift markup/CSS patterns from it verbatim where the plan says so). `reference-ledger.json` is the real content fixture.
- **Escaping law:** every ledger-derived string reaches HTML only via `esc()` and Markdown only via `mdEsc()`/`fencedCode()` (`references/esc.mjs`). Every ledger number reaching geometry/CSS custom props passes `safeNum()` first.
- **Fail-closed law:** unknown block type throws in BOTH `renderBlocks` and `blocksToMarkdown`. Never add a silent skip.
- **The one rule:** no `border:` used as a visible edge (only `border: 0`/`border: none` resets), no background other than `var(--bg)` on surfaces, no colored dividers. Dark = Blue Graphite seven-token swap exactly: `--bg:#282e39; --tx:#eef2f9; --sb:#9eabba; --sd:#171b24; --sl:#384250; --ac:#6687ff; --acq:#9cb2ff`.
- **Forbidden strings** anywhere in shipping engine output or sources after this initiative: `#009ACC`, `#2d323b`, `MINDCLOUD`, `MindCloud` (historical `docs/initiatives/` records exempt).
- Run tests from the repo root: `node --test plugin/skills/the-foreman/references/`. All existing tests must pass at every commit (updated where the plan says so, never deleted without replacement).
- Commit after every task with the message given; end every message with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Never push; never touch `~/.claude/skills/the-foreman/` (the live install).

## File Structure

| File | Role |
|---|---|
| `references/style.css` | REWRITE — Gate Board CSS (tokens, rail, hero/tiles/ask, units/drawers, figures) |
| `references/gate-board.js` | NEW — page script (rail scrollspy/jumps/keys, measured offsets, expand-all) |
| `references/slide-engine.js` + its test | DELETE (Task 10; replacement lands first) |
| `references/scaffold.mjs` | NEW — `gateBoard()`, `unit()`, `drawer()`, `slugify()` shell renderers |
| `references/blocks.mjs` | MODIFY — six new figure blocks; `bar` gains optional `tags[]` |
| `references/templates.mjs` | REWRITE — all 8 types compose the scaffold |
| `references/markdown.mjs` | MODIFY — meta verdict/lede/keyStats/ask + statement in the twin |
| `references/lint.mjs` | NEW — `lintLedger(ledger, type) => string[]` (non-fatal) |
| `references/render.mjs` | MODIFY — inline gate-board.js, drop icon SYMBOLS, accent default `#5B7CFA`, print lint warnings |
| `references/ledger.schema.md`, `SKILL.md`, `evals/evals.json`, `README.md` | MODIFY — schema additions, authoring contract, de-brand |
| `references/fixtures/*.json` | NEW — back-compat ledger corpus |

---

### Task 1: Figure blocks — `topo` and `deltaRow`

**Files:**
- Modify: `plugin/skills/the-foreman/references/blocks.mjs` (add to `BLOCKS` after `pillRow`)
- Test: `plugin/skills/the-foreman/references/blocks.test.mjs` (append)

**Interfaces:**
- Consumes: `esc`, `mdEsc` from `./esc.mjs`; `safeNum`, `round` already in blocks.mjs.
- Produces: block types `'topo'` and `'deltaRow'` in the closed registry; CSS classes `.topo/.topo__root/.topo__link/.topo__kids/.topo__kid/.topo__aside` and `.deltas/.delta/.delta__k/.delta__v/.track` (Task 8's CSS provides them; block markup must use exactly these).

- [ ] **Step 1: Write the failing tests** (append to `blocks.test.mjs`):

```js
test('topo renders root, children, aside with escaping', () => {
  const html = renderBlocks([{ type: 'topo', root: { title: '<r>', note: 'n' },
    children: [{ title: 'impl_audit', note: 'auto' }], aside: { value: '0 → 1,060', note: '<x>' } }]);
  assert.match(html, /class="topo"/);
  assert.match(html, /&lt;r&gt;/);
  assert.match(html, /impl_audit/);
  assert.match(html, /&lt;x&gt;/);
  assert.ok(!html.includes('<r>'));
  const md = blocksToMarkdown([{ type: 'topo', root: { title: 'R' }, children: [{ title: 'C1', note: 'n1' }] }]);
  assert.match(md, /R/); assert.match(md, /C1/);
});

test('deltaRow clamps positions and never emits NaN', () => {
  const html = renderBlocks([{ type: 'deltaRow', items: [
    { label: 'approve', from: '36%', to: '0%', fromPos: 36, toPos: 1e999 },
    { label: 'bad', from: 'x', to: 'y', fromPos: 'junk', toPos: -5 }] }]);
  assert.match(html, /class="deltas"/);
  assert.ok(!/NaN|Infinity/.test(html));
  assert.match(html, /--b:100/);           // 1e999 clamped to 100
  assert.match(html, /--a:0/);             // 'junk' falls back to 0
  const md = blocksToMarkdown([{ type: 'deltaRow', items: [{ label: 'L', from: '1', to: '2' }] }]);
  assert.match(md, /L.*1.*2/);
});
```

- [ ] **Step 2: Run to verify both fail**: `node --test plugin/skills/the-foreman/references/blocks.test.mjs` → FAIL `unknown block type: topo` / `deltaRow`.

- [ ] **Step 3: Implement** — add to `BLOCKS` (markup mirrors `gate-board-reference.html` lines ~716–725 for topo and ~672–697 for deltas, with dynamic content):

```js
  // { type:'topo', root:{title,note?}, children:[{title,note?}], aside?:{value,note?} }
  topo: {
    html(block) {
      const root = block?.root ?? {};
      const kids = Array.isArray(block?.children) ? block.children : [];
      const kidHtml = kids.map((k) =>
        `<div class="topo__kid"><strong>${esc(k?.title)}</strong><span>${esc(k?.note ?? '')}</span></div>`).join('');
      const aside = block?.aside
        ? `<div class="topo__aside"><b>${esc(block.aside.value)}</b><p>${esc(block.aside.note ?? '')}</p></div>` : '';
      return `<div class="topo"><div class="topo__root"><b>${esc(root.title)}</b><span>${esc(root.note ?? '')}</span></div>`
        + `<div class="topo__link" aria-hidden="true"></div><div class="topo__kids">${kidHtml}</div>${aside}</div>`;
    },
    md(block) {
      const root = block?.root ?? {};
      const kids = Array.isArray(block?.children) ? block.children : [];
      const lines = [`**${mdEsc(root.title)}**${root.note ? ` — ${mdEsc(root.note)}` : ''}`];
      for (const k of kids) lines.push(`  - ${mdEsc(k?.title)}${k?.note ? ` — ${mdEsc(k.note)}` : ''}`);
      if (block?.aside) lines.push(`  - **${mdEsc(block.aside.value)}**${block.aside.note ? ` — ${mdEsc(block.aside.note)}` : ''}`);
      return lines.join('\n');
    },
  },

  // { type:'deltaRow', items:[{label, from, to, fromPos?, toPos?}] } — from/to are
  // DISPLAY strings; fromPos/toPos are 0..100 track positions (safeNum-clamped).
  deltaRow: {
    html(block) {
      const items = Array.isArray(block?.items) ? block.items : [];
      const rows = items.map((it) => {
        const a = round(safeNum(it?.fromPos, { min: 0, max: 100, fallback: 0 }));
        const b = round(safeNum(it?.toPos, { min: 0, max: 100, fallback: 0 }));
        return `<div class="delta"><span class="delta__k">${esc(it?.label)}</span>`
          + `<span class="delta__v">${esc(it?.from)}<small>→</small><span class="to">${esc(it?.to)}</span></span>`
          + `<div class="track" aria-hidden="true" style="--a:${a};--b:${b}"><b></b><i class="was"></i><i class="now"></i></div></div>`;
      }).join('');
      return `<div class="deltas">${rows}</div>`;
    },
    md(block) {
      const items = Array.isArray(block?.items) ? block.items : [];
      return items.map((it) => `- **${mdEsc(it?.label)}**: ${mdEsc(it?.from)} → ${mdEsc(it?.to)}`).join('\n');
    },
  },
```

Note the CSS in Task 8 moves `--a`/`--b` onto the `.track` element (one style attr, numbers only, safeNum-clamped) with `.was{left:calc(var(--a)*1%)}` etc.

- [ ] **Step 4: Run to verify pass**: same command → PASS (all pre-existing tests still green).
- [ ] **Step 5: Commit**: `git add -A && git commit -m "feat(blocks): add topo and deltaRow figure blocks"`

### Task 2: Figure blocks — `duel` and `verdictFan`

**Files:** same two files as Task 1.

**Interfaces:** produces block types `'duel'`, `'verdictFan'`; classes `.duel/.duel__lane/.duel__k/.duel__n/.duel__mid/.flatline` and `.verdict/.verdict__chip/.fan/.fates/.fate/.fate__dots` (CSS in Task 8; markup per reference lines ~1143–1159 and ~994–1011). `verdictFan` fate `variant` is allowlisted `ok|warn|x` (else `x`); dot count = `safeNum(count,{min:0,max:24,fallback:0})` rendered as that many `<i>` elements.

- [ ] **Step 1: Failing tests**:

```js
test('duel renders lanes, optional flatline, escapes', () => {
  const html = renderBlocks([{ type: 'duel',
    left: { label: 'Plan', value: '0 / 4', note: '<n>' }, right: { label: 'Code', value: '1 / 1', note: 'ok' },
    flatline: { label: 'Blockers / round', values: ['8', '7', '8', '7'] } }]);
  assert.match(html, /class="duel"/); assert.match(html, /&lt;n&gt;/);
  assert.equal((html.match(/class="flatline"/g) || []).length, 1);
  const noFlat = renderBlocks([{ type: 'duel', left: { label: 'a', value: '1' }, right: { label: 'b', value: '2' } }]);
  assert.ok(!noFlat.includes('flatline'));
});

test('verdictFan allowlists variants and clamps dot counts', () => {
  const html = renderBlocks([{ type: 'verdictFan', verdict: 'BLOCK', fates: [
    { count: 6, label: 'fixable', variant: 'ok' }, { count: 1e999, label: 'huge', variant: '"><script>' }] }]);
  assert.match(html, /BLOCK/);
  assert.equal((html.match(/class="fate fate--ok"/g) || []).length, 1);
  assert.equal((html.match(/class="fate fate--x"/g) || []).length, 1);  // injected variant coerced
  assert.equal((html.match(/<i><\/i>/g) || []).length, 6 + 24);          // clamp at 24
  assert.ok(!html.includes('<script>'));
});
```

- [ ] **Step 2: Run → FAIL** (unknown block types).
- [ ] **Step 3: Implement**:

```js
  const FATE_VARIANTS = new Set(['ok', 'warn', 'x']);            // near the other allowlists
  const fateVariant = (v) => (FATE_VARIANTS.has(v) ? v : 'x');

  // { type:'duel', left:{label,value,note?}, right:{label,value,note?}, flatline?:{label, values:[string]} }
  duel: {
    html(block) {
      const lane = (s) => `<div class="duel__lane"><span class="duel__k">${esc(s?.label)}</span>`
        + `<span class="duel__n">${esc(s?.value)}</span>${s?.note ? `<p>${esc(s.note)}</p>` : ''}</div>`;
      const fl = block?.flatline && Array.isArray(block.flatline.values)
        ? `<div class="flatline"><b>${esc(block.flatline.label)}</b>${block.flatline.values
            .map((v) => `<i>${esc(v)}</i>`).join('<u aria-hidden="true"></u>')}</div>` : '';
      return `<div class="duel">${lane(block?.left)}<div class="duel__mid" aria-hidden="true"><u></u><span>VS</span><u></u></div>${lane(block?.right)}</div>${fl}`;
    },
    md(block) {
      const s = (x) => `**${mdEsc(x?.value)}** ${mdEsc(x?.label)}${x?.note ? ` (${mdEsc(x.note)})` : ''}`;
      const fl = block?.flatline && Array.isArray(block.flatline.values)
        ? `\n${mdEsc(block.flatline.label)}: ${block.flatline.values.map((v) => mdEsc(v)).join(' — ')}` : '';
      return `${s(block?.left)} vs ${s(block?.right)}${fl}`;
    },
  },

  // { type:'verdictFan', verdict:string, fates:[{count:number, label, variant?:'ok'|'warn'|'x'}] }
  verdictFan: {
    html(block) {
      const fates = Array.isArray(block?.fates) ? block.fates : [];
      const cells = fates.map((f) => {
        const v = fateVariant(f?.variant);
        const n = Math.round(safeNum(f?.count, { min: 0, max: 24, fallback: 0 }));
        return `<div class="fate fate--${v}"><span class="fate__dots" aria-hidden="true">${'<i></i>'.repeat(n)}</span>`
          + `<b>${esc(safeNum(f?.count, { min: 0, fallback: 0 }))}</b><span>${esc(f?.label)}</span></div>`;
      }).join('');
      return `<div class="verdict"><span class="verdict__chip">${esc(block?.verdict)}</span>`
        + `<div class="fan" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div><div class="fates">${cells}</div></div>`;
    },
    md(block) {
      const fates = Array.isArray(block?.fates) ? block.fates : [];
      return [`**${mdEsc(block?.verdict)}**`,
        ...fates.map((f) => `- ${mdEsc(safeNum(f?.count, { min: 0, fallback: 0 }))} — ${mdEsc(f?.label)}`)].join('\n');
    },
  },
```

- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit**: `git add -A && git commit -m "feat(blocks): add duel and verdictFan figure blocks"`

### Task 3: Figure blocks — `dotMatrix` and `ladder`

**Files:** same two files.

**Interfaces:** produces `'dotMatrix'`, `'ladder'`; classes `.matrix/.mx/.mx__r/.mx__f/.mx__d(.miss)` and `.ladder/.lrow/.lrow__s/.lrow__j/.lrow__c/.lrow__v(--ok|--mid|--no)` (reference lines ~897–906 and ~939–959). `ladder` status allowlist `ok|mid|no` (else `no`).

- [ ] **Step 1: Failing tests**:

```js
test('dotMatrix renders marks as filled/miss dots with escaped labels', () => {
  const html = renderBlocks([{ type: 'dotMatrix', columns: ['a<b', 'B'],
    rows: [{ label: 'f1', sub: 's', marks: [true, false] }] }]);
  assert.match(html, /class="matrix"/); assert.match(html, /a&lt;b/);
  assert.equal((html.match(/class="mx__d miss"/g) || []).length, 1);
  const md = blocksToMarkdown([{ type: 'dotMatrix', columns: ['A'], rows: [{ label: 'f', marks: [true] }] }]);
  assert.match(md, /\| yes \|/);
});

test('ladder allowlists status', () => {
  const html = renderBlocks([{ type: 'ladder', rows: [
    { claim: 'delegation', cause: 'ultra', status: 'ok', statusLabel: 'settled' },
    { claim: 'x', cause: 'y', status: 'evil"', statusLabel: 'z' }] }]);
  assert.equal((html.match(/lrow__v--ok/g) || []).length, 1);
  assert.equal((html.match(/lrow__v--no/g) || []).length, 1);
  assert.ok(!html.includes('evil'));
});
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement**:

```js
  const LADDER_STATUS = new Set(['ok', 'mid', 'no']);
  const ladderStatus = (s) => (LADDER_STATUS.has(s) ? s : 'no');

  // { type:'dotMatrix', columns:[string], rows:[{label, sub?, marks:[boolean]}] }
  dotMatrix: {
    html(block) {
      const cols = Array.isArray(block?.columns) ? block.columns : [];
      const rows = Array.isArray(block?.rows) ? block.rows : [];
      const head = `<div class="mx__r mx__r--h"><span>${cols.length ? '' : ''}</span>${cols.map((c) => `<span>${esc(c)}</span>`).join('')}</div>`;
      const body = rows.map((r) => {
        const marks = Array.isArray(r?.marks) ? r.marks : [];
        const dots = cols.map((_, i) => `<span class="mx__d${marks[i] ? '' : ' miss'}"><i></i></span>`).join('');
        return `<div class="mx__r"><span class="mx__f">${esc(r?.label)}${r?.sub ? `<small>${esc(r.sub)}</small>` : ''}</span>${dots}</div>`;
      }).join('');
      return `<div class="matrix"><div class="scrollx"><div class="mx" style="--mxcols:${cols.length}">${head}${body}</div></div></div>`;
    },
    md(block) {
      const cols = Array.isArray(block?.columns) ? block.columns : [];
      const rows = Array.isArray(block?.rows) ? block.rows : [];
      const header = `| ${['finding', ...cols.map((c) => mdEsc(c))].join(' | ')} |`;
      const sep = `| ${['finding', ...cols].map(() => '---').join(' | ')} |`;
      const body = rows.map((r) => {
        const marks = Array.isArray(r?.marks) ? r.marks : [];
        return `| ${mdEsc(r?.label)}${r?.sub ? ` (${mdEsc(r.sub)})` : ''} | ${cols.map((_, i) => (marks[i] ? 'yes' : '—')).join(' | ')} |`;
      }).join('\n');
      return [header, sep, body].filter(Boolean).join('\n');
    },
  },

  // { type:'ladder', rows:[{claim, cause, status?:'ok'|'mid'|'no', statusLabel}] }
  ladder: {
    html(block) {
      const rows = Array.isArray(block?.rows) ? block.rows : [];
      return `<div class="ladder">${rows.map((r) => {
        const st = ladderStatus(r?.status);
        return `<div class="lrow"><span class="lrow__s">${esc(r?.claim)}</span><i class="lrow__j" aria-hidden="true"></i>`
          + `<span class="lrow__c">${esc(r?.cause)}</span><span class="lrow__v lrow__v--${st}"><i></i>${esc(r?.statusLabel)}</span></div>`;
      }).join('')}</div>`;
    },
    md(block) {
      const rows = Array.isArray(block?.rows) ? block.rows : [];
      return rows.map((r) => `- **${mdEsc(r?.claim)}** ← ${mdEsc(r?.cause)} — ${mdEsc(r?.statusLabel)}`).join('\n');
    },
  },
```

(`.mx` uses `grid-template-columns: 1fr repeat(var(--mxcols), 96px)` in Task 8's CSS, so column count comes from the safeguarded integer `cols.length`, never ledger text.)

- [ ] **Step 4: Run → PASS.**  - [ ] **Step 5: Commit**: `git add -A && git commit -m "feat(blocks): add dotMatrix and ladder figure blocks"`

### Task 4: `bar` gains optional additive `tags[]`

**Files:** `blocks.mjs` (the `bar` block), `blocks.test.mjs`.

**Interfaces:** `{ type:'bar', bars:[{label, value, tags?:[{label, kind?:'spawn'|'code'}]}], max? }`. Tags render ONLY in the HTML wrapper (`.tag/.tag--spawn/.tag--code` chips above each bar row — reference lines ~813–828); the twin appends ` [tag1, tag2]` after the value. Absent `tags` → byte-identical output to today (pin it).

- [ ] **Step 1: Failing test**:

```js
test('bar tags are additive and allowlisted; absent tags unchanged', () => {
  const plain = { type: 'bar', bars: [{ label: 'a', value: 2 }] };
  const before = renderBlocks([plain]);                       // uses current impl
  const tagged = renderBlocks([{ type: 'bar', bars: [{ label: 'a', value: 2,
    tags: [{ label: '3 spawns', kind: 'spawn' }, { label: 'x', kind: 'bad"' }] }] }]);
  assert.match(tagged, /class="tag tag--spawn"/);
  assert.match(tagged, /class="tag"[^-]/);                    // unknown kind → bare tag
  assert.equal(renderBlocks([plain]), before);                // byte-identical without tags
});
```

- [ ] **Step 2: Run → FAIL** (no `.tag` markup).
- [ ] **Step 3: Implement**: add `const BAR_TAG_KINDS = new Set(['spawn', 'code']);` beside the other allowlists. In `bar.html`, when any bar has tags, wrap the SVG in a `.barwrap` that is preceded per-bar by an HTML tag row — implement by switching bar rendering to the reference's HTML `.bars/.brow` form when `tags` are present, keeping the SVG path untouched when absent:

```js
      const anyTags = bars.some((b) => Array.isArray(b?.tags) && b.tags.length);
      if (anyTags) {
        const denomH = denom; // same computed denominator as the SVG path
        const rows = bars.map((b, i) => {
          const v = values[i];
          const w = round(Math.min(100, (v / denomH) * 100));
          const tags = (Array.isArray(b?.tags) ? b.tags : []).map((t) => {
            const kind = BAR_TAG_KINDS.has(t?.kind) ? ` tag--${t.kind}` : '';
            return `<span class="tag${kind}"><i></i>${esc(t?.label)}</span>`;
          }).join('');
          return `<div class="brow"><div class="brow__l"><b>${esc(b?.label)}</b><span class="brow__tags">${tags}</span></div>`
            + `<div class="brow__bar"><div class="brow__rail"><i style="--w:${w}"></i><em style="--w:${w}"></em></div>`
            + `<span class="brow__v">${esc(v)}</span></div></div>`;
        }).join('');
        return `<div class="bars">${rows}</div>`;
      }
      // …existing SVG path unchanged below…
```

Twin: append `${tags.length ? ` [${tags.map((t) => mdEsc(t?.label)).join(', ')}]` : ''}` to each bar line.

- [ ] **Step 4: Run → PASS** (including the byte-identical pin). - [ ] **Step 5: Commit**: `git add -A && git commit -m "feat(blocks): additive per-bar tags with HTML track rendering"`

### Task 5: `scaffold.mjs` — the Gate Board shell

**Files:**
- Create: `plugin/skills/the-foreman/references/scaffold.mjs`
- Test: `plugin/skills/the-foreman/references/scaffold.test.mjs` (new)

**Interfaces (Produces — templates in Tasks 6–7 depend on these exact signatures):**

```js
export function slugify(label)                 // 'Decision record' -> 'decision-record'; alnum+dash, lowercase, never empty ('section')
export function drawer(label, innerHtml)       // native <details class="dw"><summary>… returns '' when innerHtml is falsy
export function unit({ kicker, statement, lead, figureHtml, pillsHtml, drawerLabel, drawerHtml })
export function gateBoard({ crumb, title, verdict, lede, keyStats, ask, chapters, sources, foot })
//  keyStats: [{value,label,variant?}] (rendered as .tiles; esc'd; empty/absent -> no tiles row)
//  ask: { headline, note?, recommendation?, recommendedBy?, targetId } -> the .ask strip (absent -> none)
//  chapters: [{ label, unitsHtml }] -> ids from slugify(label); rail = Top + one chip per chapter
//  sources: [{label, value}] -> .src chips; foot: string
// Returns bodyHtml: rail nav + #top section (crumb/hero/tiles/ask) + chapter <section id=…> + foot.
```

Markup and classes lift from `gate-board-reference.html`: rail lines ~612–622, hero/tiles/ask ~625–658, unit/drawer ~666–707. All dynamic strings esc'd; rail chip numbers are 1..N generated integers.

- [ ] **Step 1: Failing tests** (`scaffold.test.mjs`):

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { gateBoard, unit, drawer, slugify } from './scaffold.mjs';

test('slugify is stable and safe', () => {
  assert.equal(slugify('Decision record'), 'decision-record');
  assert.equal(slugify('<script>'), 'script');
  assert.equal(slugify('!!!'), 'section');
});

test('gateBoard renders rail chips for Top + every chapter, with matching section ids', () => {
  const body = gateBoard({ crumb: 'C', title: 'T', verdict: 'V', lede: 'L',
    keyStats: [{ value: '1', label: 'one' }],
    ask: { headline: 'H<x>', targetId: 'your-call' },
    chapters: [{ label: 'Diagnosis', unitsHtml: '<p>u</p>' }, { label: 'Your call', unitsHtml: '<p>d</p>' }] });
  assert.match(body, /href="#top"/);
  assert.match(body, /href="#diagnosis"/); assert.match(body, /id="diagnosis"/);
  assert.match(body, /href="#your-call"/); assert.match(body, /id="your-call"/);
  assert.match(body, /H&lt;x&gt;/);
  assert.match(body, /class="tiles"/);
  assert.ok(!/#009ACC|MINDCLOUD/i.test(body));
});

test('unit + drawer compose; empty drawer collapses to nothing', () => {
  const u = unit({ kicker: 'K', statement: 'S', figureHtml: '<div class="fig">f</div>',
    drawerLabel: 'Detail', drawerHtml: '<p>evidence</p>' });
  assert.match(u, /class="unit"/); assert.match(u, /<details class="dw">/);
  assert.equal(drawer('x', ''), '');
});
```

- [ ] **Step 2: Run → FAIL** (module not found).
- [ ] **Step 3: Implement `scaffold.mjs`** (~90 lines):

```js
import { esc } from './esc.mjs';

export function slugify(label) {
  const s = String(label ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s || 'section';
}

export function drawer(label, innerHtml) {
  if (!innerHtml) return '';
  return `<details class="dw"><summary>${esc(label)} <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 6l5 5 5-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></summary><div class="drawer">${innerHtml}</div></details>`;
}

export function unit({ kicker = '', statement = '', lead = '', figureHtml = '', pillsHtml = '', drawerLabel = 'Detail', drawerHtml = '' } = {}) {
  return `<article class="unit"><header class="unit__head">${kicker ? `<span class="kick">${esc(kicker)}</span>` : ''}`
    + `<h3 class="hline">${esc(statement)}</h3>${lead ? `<p class="lead">${esc(lead)}</p>` : ''}</header>`
    + `${figureHtml}${pillsHtml}${drawer(drawerLabel, drawerHtml)}</article>`;
}

export function gateBoard({ crumb = '', title = '', verdict = '', lede = '', keyStats = [], ask = null, chapters = [], sources = [], foot = '' } = {}) {
  const chs = chapters.map((c) => ({ id: slugify(c.label), label: String(c.label ?? ''), unitsHtml: c.unitsHtml ?? '' }));
  const chips = [{ id: 'top', label: 'Top' }, ...chs]
    .map((c, i) => `<a class="nav__chip${i === 0 ? ' is-live' : ''}" href="#${c.id}" data-sec="${c.id}"${i === 0 ? ' aria-current="true"' : ''}><span class="nav__n" aria-hidden="true">${i + 1}</span>${esc(c.label)}</a>`)
    .join('');
  const nav = `<nav class="nav" aria-label="Chapters"><div class="nav__track" id="navtrack">${chips}<span class="nav__hint" aria-hidden="true">1&ndash;${chs.length + 1} jump &middot; Home / End</span></div></nav>`;
  const tiles = keyStats.length
    ? `<div class="tiles" role="list" aria-label="The numbers that matter">${keyStats.map((s) => `<div class="tile" role="listitem"><b>${esc(s?.value)}</b><span>${esc(s?.label)}</span></div>`).join('')}</div>` : '';
  const askStrip = ask
    ? `<div class="ask"><div class="ask__txt"><span class="ask__kick">What is being asked of you</span><b>${esc(ask.headline)}</b>${ask.note ? `<p>${esc(ask.note)}${ask.recommendation ? ` <strong>${esc(ask.recommendation)}</strong>${ask.recommendedBy ? ` <span class="chip">${esc(ask.recommendedBy)}</span>` : ''}` : ''}</p>` : ''}</div>${ask.targetId ? `<a class="btn btn--accent" href="#${slugify(ask.targetId)}">Jump to the ask</a>` : ''}</div>` : '';
  const head = `<section id="top" aria-label="Verdict"><header class="wrap crumbrow"><span class="chip crumb">${esc(crumb)}</span><div class="tools"><span class="chip">Gate artifact</span><button class="btn btn--sm jsonly" id="exp-all" type="button">Expand all</button><button class="btn btn--sm jsonly" id="col-all" type="button">Collapse all</button></div></header>`
    + `<div class="wrap hero"><h1>${esc(title)}</h1>${verdict ? `<p class="verdictline">${esc(verdict)}</p>` : ''}${lede ? `<p class="lede">${esc(lede)}</p>` : ''}</div>`
    + `<div class="wrap">${tiles}${askStrip}</div></section>`;
  const sections = chs.map((c) => `<section class="chap" id="${c.id}" aria-label="${esc(c.label)}"><div class="wrap"><div class="seclab"><span></span><h2>${esc(c.label)}</h2></div>${c.unitsHtml}</div></section>`).join('');
  const src = sources.length ? `<div class="wrap src" aria-label="Evidence base">${sources.map((s) => `<span class="chip"><b>${esc(s?.value)}</b>&nbsp;${esc(s?.label)}</span>`).join('')}</div>` : '';
  const footer = foot ? `<p class="wrap foot">${esc(foot)}</p>` : '';
  return `${nav}\n${head}\n${sections}\n${src}\n${footer}`;
}
```

- [ ] **Step 4: Run → PASS.** - [ ] **Step 5: Commit**: `git add -A && git commit -m "feat(scaffold): Gate Board shell — rail, hero, tiles, ask, chapters"`

### Task 6: `templates.mjs` — `planDeck` on the Gate Board

**Files:** rewrite `references/templates.mjs` top half; update `references/templates.test.mjs`.

**Interfaces:**
- Consumes: `gateBoard/unit/drawer/slugify` (Task 5 signatures), `renderBlocks` (blocks registry incl. Tasks 1–4).
- Produces: `planDeck(ledger) => { title, favicon, bodyHtml }` (same external contract `render.mjs` uses). Shared helpers the other templates reuse (Task 7): `const fav`, `const crumbOf` (default now `'THE-FOREMAN · DEV WORKFLOW'`), `function heroOf(meta, fallbackVerdict)`, `function askOf(ledger)`, `function figureSplit(blocks, explicitFigure)` → `{figureHtml, drawerBlocks}` where the figure is `explicitFigure ?? first block whose type ∈ FIGURE_TYPES` (`['statRow','bar','donut','phaseSteps','topo','deltaRow','duel','verdictFan','dotMatrix','ladder']`).

Behavior: hero from `meta.title/verdict(??subtitle)/lede`; tiles from `meta.keyStats`; ask strip from `meta.ask ?? (ledger.decision ? {headline: decision.question, recommendation, recommendedBy, targetId: 'your-call'} : null)`; chapters group consecutive slides by `chapter ?? 'Board'`; each slide renders as `unit({kicker, statement: s.statement ?? s.heading, lead: s.lead, figureHtml, pillsHtml: <pillRow blocks stay outside the drawer>, drawerHtml: bullets+cards+callout+remaining blocks})`; when `ledger.decision` exists, append a `Your call` chapter rendering option cards (reference lines ~1161–1229: letter well, risk chip allowlist `low|med|high`→`--low/--med/--high` else `--med`, recommended marker on `decision.recommendation` match, gist = first sentence of pros ≤ 140 chars, collapsed verbatim pros/cons in `<details class="optpc">`) + `.rec` strip; `sources` from `ledger.findings?.sources`.

- [ ] **Step 1: Failing tests** — replace the deck-era assertions in `templates.test.mjs` for planDeck with:

```js
test('planDeck renders a Gate Board: rail, hero fallbacks, chapters, decision chapter', () => {
  const ledger = JSON.parse(readFileSync(new URL('../../../../docs/initiatives/2026-08-26-neumorphic-gate-board/reference-ledger.json', import.meta.url), 'utf8'));
  const { bodyHtml, title } = planDeck(ledger);
  assert.equal(title, ledger.meta.title);
  assert.match(bodyHtml, /class="nav"/);
  assert.match(bodyHtml, /id="diagnosis"/);                       // chapter from slide.chapter
  assert.match(bodyHtml, /id="your-call"/);                       // decision chapter
  assert.match(bodyHtml, /class="verdictline"/);                  // meta.subtitle fallback
  assert.ok(!/id="bar"|slide"|#009ACC|MINDCLOUD/i.test(bodyHtml));
});

test('planDeck escapes ledger text and tolerates a minimal legacy ledger', () => {
  const { bodyHtml } = planDeck({ meta: { title: '<t>' }, slides: [{ heading: 'H<img>', bullets: ['<b>'] }] });
  assert.match(bodyHtml, /&lt;t&gt;/); assert.match(bodyHtml, /H&lt;img&gt;/);
  assert.ok(!bodyHtml.includes('<img>'));
});
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** the rewritten planDeck + shared helpers per the Interfaces block (bullets render as `<ul class="drawer-bullets">`-free plain `<ul>` inside the drawer; cards as `<div class="co"><b>title</b><p>body</p></div>`; callout as `<div class="co co--warn">`). Keep every legacy field rendering somewhere (heading, kicker, bullets, cards, callout, blocks, chapter) — nothing dropped.
- [ ] **Step 4: Run → PASS** (other templates may still be old-style; only planDeck tests updated in this task — the file keeps the old `deck()` helper until Task 7 removes it).
- [ ] **Step 5: Commit**: `git add -A && git commit -m "feat(templates): planDeck renders the Gate Board"`

### Task 7: `templates.mjs` — the seven single-section types + delete `deck()`

**Files:** `templates.mjs` (rest), `templates.test.mjs` (update the seven), delete the now-unused `deck()`/`slide()`/`card()` helpers.

**Interfaces:** unchanged external signatures for `brief/decisionCard/liveRun/phaseTracker/findings/comparison/dashboard`. Composition per spec §6, using the same helpers:
- `brief`: hero(title, verdict=win.verified?'Verified':'Claimed — not yet verified'); one `Board` chapter unit (statement=win.landed distilled? NO — statement = meta.title stays in hero; the unit statement is `'What landed'` literal with lead ''); figure = `verdictFan`? NO — brief has no natural figure: unit with pills (`Verified`/`Claimed` variant) and drawer holding landed+evidence verbatim; ask from `win.next`.
- `decisionCard`: hero + `Your call` chapter exactly as planDeck's decision chapter; ask strip from the question.
- `liveRun`: hero + one unit; figure = `statRow` built from `{what→lead}`? NO: keyStats absent; unit statement `'Live-run gate — authorize before anything runs'`, pills `cost`/`blastRadius` summary chips are ledger text so they render as drawer content; drawer = What/Cost/Blast radius/Cleanup as four `.co` callouts (verbatim); ask headline literal `'Authorize this live run?'` + note from `lr.cost`.
- `phaseTracker`: figure = `phaseSteps` block from `pt.phases`; optional `donut` from `pt.progress` into the drawer; ask from `pt.note`.
- `findings`: figure = `dotMatrix` when every item has a boolean-mappable verdict? NO — keep deterministic: figure = existing `table` block (columns Finding/Confidence/Evidence/Verdict) rendered in the drawer, and the FIGURE is `statRow` built from `f.sources` (value/label) when present; summary → ask note; sources → chips.
- `comparison`: figure = `table` (options × criteria) in the unit body (tables are drawer-first: place the table as drawerHtml with drawerLabel 'The comparison', statement = meta.title? statement = `'Options compared'` literal); ask = recommendation.
- `dashboard`: keyStats = `d.stats`; figure = `d.chart` via `figureSplit`; rows → drawer `rankedRows`; ask = `d.ask`.

- [ ] **Step 1: Failing tests** — for each type one test asserting: `class="nav"` present, its content fields appear escaped, its ask renders, and no `slide`/old classes. Plus: `assert.throws(() => templates.dashboard({ dashboard: { chart: { type: 'nope' } } }))` (unknown chart still fails closed).
- [ ] **Step 2: Run → FAIL.** - [ ] **Step 3: Implement.** - [ ] **Step 4: Run → PASS** (full blocks+templates+scaffold suite).
- [ ] **Step 5: Commit**: `git add -A && git commit -m "feat(templates): all eight artifact types render the Gate Board; retire deck()"`

### Task 8: `style.css` rewrite

**Files:** `references/style.css` (full rewrite), `references/style.test.mjs` (new).

The CSS is an extraction, not an invention: take the `<style>` block of `docs/initiatives/2026-08-26-neumorphic-gate-board/gate-board-reference.html` (lines 5–609) verbatim as the base — it already contains tokens (light + Blue Graphite dark in both carriers), rail, hero/tiles/ask, units/drawers, and every figure family — then make exactly these adaptations:
1. Keep class names as-is (blocks/scaffold from Tasks 1–7 emit them).
2. Add legacy-block classes still emitted by the registry (`.statrow/.stat/.stat-value/.stat-label`, `.donutwrap/.barwrap/.sparkwrap` + SVG text classes, `.flow/.step/.arw`, `.phaseflow/.phasestep/.phase-mark/.phase-detail`, `.relrow`, `pre/code` code+diff styles, `.callout`→restyle as `.co`) — port each to the neumorphic idiom (carved panels, raised rows, engraved separators; SVG `var(--line)`→`var(--sd)`, `var(--accent)`→`var(--ac)`; define `--line`/`--accent`/`--tint`/`--ok-tint`/`--err-tint` as neumorphic-mapped aliases in `:root` so legacy SVG markup keeps rendering).
3. Add `.mx{grid-template-columns:1fr repeat(var(--mxcols,2),96px)}` (Task 3) and `.track` var-driven `--a/--b` positioning (Task 1).

- [ ] **Step 1: Failing test** (`style.test.mjs`):

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const css = readFileSync(new URL('./style.css', import.meta.url), 'utf8');

test('css carries Blue Graphite in both dark carriers and no old brand', () => {
  for (const hex of ['#282e39', '#171b24', '#384250', '#6687ff', '#9cb2ff']) {
    assert.equal((css.match(new RegExp(hex, 'g')) || []).length >= 2, true, hex);
  }
  assert.ok(!/009ACC|2d323b|23272e|3a414d|8ea6ff/i.test(css));
  assert.match(css, /prefers-color-scheme: dark/);
  assert.match(css, /:root:not\(\[data-theme="light"\]\)/);
  assert.match(css, /:root\[data-theme="dark"\]/);
});

test('the one rule: no visible borders, surfaces are --bg', () => {
  const borders = css.match(/border(-\w+)?\s*:\s*(?!0|none)[^;]+;/g) || [];
  assert.deepEqual(borders.filter((b) => !/border-radius|border-collapse/.test(b)), []);
});

test('rail, unit, drawer, and every figure family have styles', () => {
  for (const cls of ['.nav__track', '.nav__chip', '.tiles', '.ask', '.unit', '.dw', '.drawer',
    '.deltas', '.topo', '.duel', '.verdict', '.matrix', '.ladder', '.stops', '.bars', '.ring']) {
    assert.ok(css.includes(cls), cls);
  }
});
```

- [ ] **Step 2: Run → FAIL** (old css). - [ ] **Step 3: Rewrite per the extraction spec above.** - [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit**: `git add -A && git commit -m "feat(css): the Gate Board stylesheet — neumorphic, Blue Graphite dark"`

### Task 9: `gate-board.js` page script

**Files:** Create `references/gate-board.js`; Test `references/gate-board.test.mjs` (new).

Extraction: the reference mockup's `<script>` (lines 1244–1341) verbatim, with two generalizations: (a) `ids` is derived at runtime — `var ids = Array.prototype.map.call(document.querySelectorAll('.nav__chip'), function(a){ return a.getAttribute('data-sec'); });` — so any chapter set works; (b) number-key handling covers `1..9` bounded by `ids.length`.

- [ ] **Step 1: Failing test** (string-contract tests, mirroring how `slide-engine.test.mjs` pins behavior without a DOM):

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const js = readFileSync(new URL('./gate-board.js', import.meta.url), 'utf8');

test('page script derives chapters from the rail, no hardcoded ids', () => {
  assert.match(js, /querySelectorAll\('\.nav__chip'\)/);
  assert.ok(!js.includes("['top', 'diagnosis'"));
});
test('keyboard, scrollspy, offsets, expand-all are wired', () => {
  for (const needle of ['IntersectionObserver', "e.key === 'Home'", "e.key === 'End'",
    'scrollMarginTop', 'exp-all', 'col-all', 'prefers-reduced-motion']) assert.ok(js.includes(needle), needle);
});
test('script never references deck-era elements', () => {
  assert.ok(!/#dots|#prev|#next|#crumb|\.slide\b/.test(js));
});
```

- [ ] **Step 2: Run → FAIL.** - [ ] **Step 3: Implement per the extraction spec.** - [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit**: `git add -A && git commit -m "feat(engine): gate-board page script — rail, scrollspy, keys, expand-all"`

### Task 10: `render.mjs` integration + `lint.mjs` + delete `slide-engine.*`

**Files:** Modify `references/render.mjs`; Create `references/lint.mjs` + `references/lint.test.mjs`; Update `references/render.test.mjs`; Delete `references/slide-engine.js`, `references/slide-engine.test.mjs`.

**Interfaces:** `lintLedger(ledger, type) => string[]` — pure, no IO. Rules (each returns a `lint: …` string): statement/heading > 12 words in a statement slot; `` ` `` or `@` inside a statement (code-token smell); gate types (`planDeck/brief/decisionCard/liveRun`) missing BOTH `meta.verdict` and `meta.subtitle`, or missing any ask source; `meta.keyStats` present with length outside 3..5. `render.mjs`: read `gate-board.js` instead of `slide-engine.js`; remove the `SYMBOLS` const and its interpolation; accent guard compares against `'#5B7CFA'`; after `make(ledger)`, `for (const w of lintLedger(ledger, type)) console.error('[gate-board lint]', w);` — before the secret scan, never throwing.

- [ ] **Step 1: Failing tests**: lint unit tests (one per rule firing + one clean ledger → `[]`); render test updates asserting output contains `nav__track` and NOT `<svg width="0"`/`#i-cog`/`slide-engine`, plus the existing secret-scan fail-closed tests unchanged.
- [ ] **Step 2: Run → FAIL.** - [ ] **Step 3: Implement; delete the two slide-engine files.** - [ ] **Step 4: Run full suite → PASS.**
- [ ] **Step 5: Commit**: `git add -A && git commit -m "feat(render): gate-board wiring, non-fatal authoring lint, retire slide-engine"`

### Task 11: Markdown twin — executive summary + statements

**Files:** `references/markdown.mjs`, `references/markdown.test.mjs`.

Changes: `head(meta)` gains, after the crumb: `meta.verdict ?? meta.subtitle` as a bold line, `meta.lede` as a paragraph, `meta.keyStats` as a `- **value** — label` list, `meta.ask.headline` as `> **The ask:** …`. planDeck slide headings become `## ${mdEsc(s?.kicker ?? '')} — ${mdEsc(s?.statement ?? s?.heading ?? '')}`; `s.lead` renders as a paragraph when present. All other type twins keep their shapes (they already mirror content, which is unchanged).

- [ ] **Step 1: Failing tests**: render the reference ledger + a `meta.keyStats`-bearing synthetic ledger; assert the twin contains the verdict line, each keyStat, the ask quote, and a `statement`-overridden heading; assert injection strings stay escaped (`mdEsc`).
- [ ] **Step 2: Run → FAIL.** - [ ] **Step 3: Implement.** - [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit**: `git add -A && git commit -m "feat(twin): executive summary and statements in the Markdown twin"`

### Task 12: Back-compat corpus

**Files:** Create `references/fixtures/legacy-plandeck.json` (copy of `docs/initiatives/2026-08-26-neumorphic-gate-board/reference-ledger.json`), `references/fixtures/legacy-minimal.json` (`{"meta":{"title":"t"},"slides":[{"heading":"h","bullets":["b"],"blocks":[{"type":"statRow","stats":[{"value":"1","label":"l"}]}]}]}`); Test `references/backcompat.test.mjs` (new).

- [ ] **Step 1: Failing test**: for every fixture × every applicable type (`planDeck`, plus `findings`/`liveRun`/`decisionCard`/`brief` against the reference ledger which carries those sections), call the template and `toMarkdown` — assert no throw, non-empty output, `class="nav"` present, and no `NaN|Infinity|undefined` in HTML.
- [ ] **Step 2: Run → FAIL** only if Tasks 6–11 left a legacy gap (this test EXISTS to catch that; if it passes immediately, verify it by temporarily breaking a fallback, watch it fail, restore).
- [ ] **Step 3/4: Fix any gaps → PASS.**
- [ ] **Step 5: Commit**: `git add -A && git commit -m "test: legacy-ledger back-compat corpus renders under the Gate Board"`

### Task 13: Schema docs, authoring contract, de-brand

**Files:** `references/ledger.schema.md` (new meta fields §, six figure blocks §, `figure` field, crumb/accent defaults, drop icon-sprite language); `SKILL.md` (§4: "MindCloud-styled" → "neumorphic Gate Board", add the **Authoring contract** subsection with the §7-of-design rules verbatim); `evals/evals.json` (each `expected_output`: "MindCloud planDeck/deck/artifact" → "neumorphic Gate Board <type>"); repo `README.md` (brand language).

- [ ] **Step 1: Failing check** (extend `contract-drift.test.mjs` or add `debrand.test.mjs`): grep the four files + all `references/*.{mjs,js,css}` for `/MindCloud|MINDCLOUD|#009ACC/` → assert zero matches.
- [ ] **Step 2: Run → FAIL.** - [ ] **Step 3: Edit the four files.** - [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit**: `git add -A && git commit -m "docs: Gate Board schema, authoring contract, full de-brand"`

### Task 14: Full verification + rendered artifact check

- [ ] **Step 1:** `node --test plugin/skills/the-foreman/references/` → ALL PASS, zero skips.
- [ ] **Step 2:** Render the reference ledger for real:
  `node plugin/skills/the-foreman/references/render.mjs docs/initiatives/2026-08-26-neumorphic-gate-board/reference-ledger.json planDeck /tmp/gate-board-out.html` → exits 0, prints the JSON result; open the HTML and compare against `gate-board-reference.html` (rail, hero, all figures, drawers, both themes). Fix visual gaps; re-run tests.
- [ ] **Step 3:** Render every other type from the same ledger (`brief`, `decisionCard`, `liveRun`, `findings`) → all exit 0, each page carries the rail + its ask.
- [ ] **Step 4: Commit** any fixes: `git add -A && git commit -m "fix: visual parity with the Gate Board reference"`

---

## Self-review record

- Spec coverage: §2→Task 8; §3→Tasks 5,8,9; §4→Tasks 6,11,12; §5→Tasks 1–4,8; §6→Tasks 6,7; §7→Tasks 10,13; §8→every task's tests + Task 12; §9→Tasks 10,13; §10→all; §11 steps 2–5 happen after this plan (codex-gate, PR, reconciled sync — deliberately outside task scope).
- Placeholder scan: extraction tasks (8, 9) reference exact line ranges of a committed reference file — actionable, not placeholders.
- Type consistency: `figureSplit` FIGURE_TYPES matches the spec's figure-capable set; scaffold signatures quoted identically in Tasks 5, 6, 7.
