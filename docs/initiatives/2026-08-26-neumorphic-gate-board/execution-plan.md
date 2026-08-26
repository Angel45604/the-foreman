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
- **Forbidden strings** in shipping engine SOURCES and engine-owned defaults/copy after this initiative: `#009ACC`, `#2d323b`, `MINDCLOUD`, `MindCloud` (historical `docs/initiatives/` records exempt). Ledger-provided values follow the owner's accent policy recorded in Task 10 (gate round-1 decision blocker).
- **Fonts are embedded, never linked**: style.css carries Sora + Nunito Sans latin woff2 subsets as data-URI `@font-face` (OFL-licensed, copied from the portfolio's `design-system/fonts/`); no `<link>`/`url(http…)` anywhere in rendered output (ADR-003 self-containment tests stay green).
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

test('deltaRow clamps positions, renders endpoints, never emits NaN', () => {
  const html = renderBlocks([{ type: 'deltaRow', items: [
    { label: 'approve', from: '36%', to: '0%', fromPos: 36, toPos: 1e308, min: '0%', max: '100%' },
    { label: 'bad', from: 'x', to: 'y', fromPos: 'junk', toPos: -5 },
    { label: 'inf', from: 'a', to: 'b', fromPos: 1e999, toPos: Infinity }] }]);
  assert.match(html, /class="deltas"/);
  assert.ok(!/NaN|Infinity/.test(html));
  assert.match(html, /--b:100/);           // finite over-range 1e308 clamps to 100
  assert.match(html, /--a:0/);             // 'junk' falls back to 0
  assert.match(html, /style="--a:0;--b:0"/); // non-finite 1e999/Infinity => fallback 0, both
  assert.match(html, /class="delta__f"><span>0%<\/span><span>100%<\/span>/); // min/max endpoints render
  const md = blocksToMarkdown([{ type: 'deltaRow', items: [{ label: 'L', from: '1', to: '2', min: 'lo', max: 'hi' }] }]);
  assert.match(md, /L.*1.*2/); assert.match(md, /lo.*hi/); // twin carries endpoints too
});

test('registry closed-set oracle includes the new figure blocks with html+md', () => {
  for (const t of ['topo', 'deltaRow']) {
    assert.ok(BLOCK_TYPES.includes(t), t);
    assert.equal(typeof BLOCKS[t].html, 'function');
    assert.equal(typeof BLOCKS[t].md, 'function');
  }
});
```

Also update the existing `EXPECTED_BLOCK_TYPES` literal oracle in `blocks.test.mjs` to append `'topo', 'deltaRow'` (each figure task appends its own two — the oracle must list all six by Task 3 or those tasks stay red).

```js
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

  // { type:'deltaRow', items:[{label, from, to, fromPos?, toPos?, min?, max?}] } — from/to and
  // min/max are DISPLAY strings; fromPos/toPos are 0..100 track positions (safeNum-clamped;
  // non-finite => fallback 0 per the existing safeNum contract).
  deltaRow: {
    html(block) {
      const items = Array.isArray(block?.items) ? block.items : [];
      const rows = items.map((it) => {
        const a = round(safeNum(it?.fromPos, { min: 0, max: 100, fallback: 0 }));
        const b = round(safeNum(it?.toPos, { min: 0, max: 100, fallback: 0 }));
        const ends = (it?.min != null || it?.max != null)
          ? `<div class="delta__f"><span>${esc(it?.min ?? '')}</span><span>${esc(it?.max ?? '')}</span></div>` : '';
        return `<div class="delta"><span class="delta__k">${esc(it?.label)}</span>`
          + `<span class="delta__v">${esc(it?.from)}<small>→</small><span class="to">${esc(it?.to)}</span></span>`
          + `<div class="track" aria-hidden="true" style="--a:${a};--b:${b}"><b></b><i class="was"></i><i class="now"></i></div>${ends}</div>`;
      }).join('');
      return `<div class="deltas">${rows}</div>`;
    },
    md(block) {
      const items = Array.isArray(block?.items) ? block.items : [];
      return items.map((it) => {
        const ends = (it?.min != null || it?.max != null) ? ` (scale ${mdEsc(it?.min ?? '')}–${mdEsc(it?.max ?? '')})` : '';
        return `- **${mdEsc(it?.label)}**: ${mdEsc(it?.from)} → ${mdEsc(it?.to)}${ends}`;
      }).join('\n');
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
    { count: 6, label: 'fixable', variant: 'ok' },
    { count: 1e308, label: 'huge', variant: '"><script>' },   // finite over-range → clamp 24
    { count: 1e999, label: 'inf', variant: 'warn' }] }]);      // non-finite → fallback 0 dots
  assert.match(html, /BLOCK/);
  assert.equal((html.match(/class="fate fate--ok"/g) || []).length, 1);
  assert.equal((html.match(/class="fate fate--x"/g) || []).length, 1);  // injected variant coerced
  assert.equal((html.match(/class="fate fate--warn"/g) || []).length, 1);
  assert.equal((html.match(/<i><\/i>/g) || []).length, 6 + 24 + 0);
  assert.ok(!html.includes('<script>'));
});
```

Append `'duel', 'verdictFan'` to the `EXPECTED_BLOCK_TYPES` oracle and extend the html+md oracle test to cover them.

```js
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

Append `'dotMatrix', 'ladder'` to the `EXPECTED_BLOCK_TYPES` oracle (all six figure types now listed) and extend the html+md oracle test.

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

### Task 4: `bar` becomes the carved-track figure (+ optional additive `tags[]`)

**Files:** `blocks.mjs` (the `bar` block), `blocks.test.mjs`.

**Interfaces:** LEDGER SHAPE unchanged plus optional tags: `{ type:'bar', bars:[{label, value, tags?:[{label, kind?:'spawn'|'code'}]}], max? }`. The SVG rendering is REPLACED for all bars (the approved restyle) by the reference's HTML `.bars/.brow` carved-track form (reference lines ~811–829); classes `.bars/.bars__cap/.brow/.brow__l/.brow__tags/.tag(.tag--spawn|.tag--code)/.brow__bar/.brow__rail/.brow__v`. Width = `round(min(100, value/denom*100))` with today's exact denominator rules (declared max > largest value > 1). Twin unchanged except tags append ` [tag1, tag2]`.

- [ ] **Step 1: Failing test** (replace the existing bar SVG-geometry tests with semantic track tests — keep the existing safeNum/denominator cases, re-asserted against `--w`):

```js
test('bar renders carved tracks for all bars; tags allowlisted and additive', () => {
  const untagged = renderBlocks([{ type: 'bar', bars: [{ label: 'a<b', value: 2 }, { label: 'c', value: 4 }] }]);
  assert.match(untagged, /class="bars"/);
  assert.match(untagged, /a&lt;b/);
  assert.match(untagged, /--w:50/);                            // 2/4 of the largest
  assert.match(untagged, /--w:100/);
  assert.ok(!untagged.includes('<svg'));                       // SVG form retired
  const tagged = renderBlocks([{ type: 'bar', bars: [{ label: 'a', value: 1,
    tags: [{ label: '3 spawns', kind: 'spawn' }, { label: 'x', kind: 'bad"' }] }] }]);
  assert.match(tagged, /class="tag tag--spawn"/);
  assert.match(tagged, /class="tag"><i><\/i>x</);              // unknown kind → bare tag, escaped
  assert.ok(!tagged.includes('bad"'));
});

test('bar numeric guards survive the restyle', () => {
  const html = renderBlocks([{ type: 'bar', bars: [{ label: 'x', value: 1e999 }, { label: 'y', value: -3 }] }]);
  assert.ok(!/NaN|Infinity/.test(html));
  assert.match(html, /--w:0/);                                 // non-finite → fallback 0; negative → clamped 0
});
```

- [ ] **Step 2: Run → FAIL** (current impl emits SVG).
- [ ] **Step 3: Implement**: add `const BAR_TAG_KINDS = new Set(['spawn', 'code']);` beside the other allowlists; replace `bar.html` entirely:

```js
    html(block) {
      const bars = Array.isArray(block?.bars) ? block.bars : [];
      const values = bars.map((b) => safeNum(b?.value, { min: 0 }));
      const declaredMax = block?.max != null ? safeNum(block.max, { min: 0 }) : 0;
      const largest = values.reduce((m, v) => (v > m ? v : m), 0);
      const denom = declaredMax > 0 ? declaredMax : largest > 0 ? largest : 1;
      const rows = bars.map((b, i) => {
        const v = values[i];
        const w = round(Math.min(100, (v / denom) * 100));
        const tags = (Array.isArray(b?.tags) ? b.tags : []).map((t) => {
          const kind = BAR_TAG_KINDS.has(t?.kind) ? ` tag--${t.kind}` : '';
          return `<span class="tag${kind}"><i></i>${esc(t?.label)}</span>`;
        }).join('');
        return `<div class="brow"><div class="brow__l"><b>${esc(b?.label)}</b>${tags ? `<span class="brow__tags">${tags}</span>` : ''}</div>`
          + `<div class="brow__bar"><div class="brow__rail"><i style="--w:${w}"></i><em style="--w:${w}"></em></div>`
          + `<span class="brow__v">${esc(v)}</span></div></div>`;
      }).join('');
      return `<div class="bars">${rows}</div>`;
    },
```

Twin: keep today's lines, appending `${Array.isArray(b?.tags) && b.tags.length ? ` [${b.tags.map((t) => mdEsc(t?.label)).join(', ')}]` : ''}`.

- [ ] **Step 4: Run → PASS.** - [ ] **Step 5: Commit**: `git add -A && git commit -m "feat(blocks): bar renders carved tracks with optional tags"`

### Task 4b: legacy blocks move to the Gate Board class families

**Files:** `blocks.mjs` (`donut`, `phaseSteps`, `table`, `pillRow`, `statRow` html renderers — ledger shapes and md() untouched), `blocks.test.mjs`.

**Interfaces:** every emitted class pairs with a styled selector in Task 8's CSS:
- `donut` → the tick-ring: `.ringwrap/.ring/.ring__t(.on)/.ring__c/.ring__legend` (reference ~857–866). Ticks: 13 when `max<=24` use `max` ticks else 24; lit count = `round(value/max*ticks)`; angles are `round(i*360/ticks)` degrees via `--r`; center shows `value / max` (or `pct%` when max is 100) + esc'd label. All numbers through `safeNum` first.
- `phaseSteps` → the stops track: `.stops/.stop/.stop__mark/.stop__n/.stop__body/.stop__sign` (reference ~1030–1036); status renders as the `.stop__sign` text (`done ✓` / `active ▸` / `pending`), detail as the body `<p>`.
- `table` → `.scrollx` + `.gt/.gt__r(.gt__r--h)/.gt__num` raised rows with `--cols: repeat(N, 1fr)` where N = columns.length (an integer, never ledger text); caption becomes an esc'd `<h4>` above.
- `pillRow` → `.pill--ok/.pill--warn` (BEM double-dash replaces the legacy `pill ok` space form) with the `<i>` dot.
- `statRow` → `.wells/.well/.well__v(.is-ok|.is-warn)/.well__l` carved wells (reference ~386–395).

- [ ] **Step 1: Failing tests**: for each of the five, assert the new class family appears, the old one (`donutwrap`, `phaseflow`, `<table`, `"pill ok"`, `statrow`) does NOT, escaping holds, and donut/table numeric/column counts are guard-derived (e.g. `donut` with `value:1e999` → 0 lit ticks; `table` `--cols` equals columns.length).
- [ ] **Step 2: Run → FAIL.** - [ ] **Step 3: Implement the five renderers.** - [ ] **Step 4: Run → PASS** (md() outputs byte-identical — pin one md() case per block).
- [ ] **Step 5: Commit**: `git add -A && git commit -m "feat(blocks): legacy renderers emit the Gate Board class families"`

### Task 5: `scaffold.mjs` — the Gate Board shell

**Files:**
- Create: `plugin/skills/the-foreman/references/scaffold.mjs`
- Test: `plugin/skills/the-foreman/references/scaffold.test.mjs` (new)

**Interfaces (Produces — templates in Tasks 6–7 depend on these exact signatures):**

```js
export function slugify(label)                 // 'Decision record' -> 'decision-record'; alnum+dash, lowercase, never empty ('section')
export function allocateIds(labels)            // -> unique id per label, in order: slugify each; 'top' is RESERVED
                                               //    (a chapter slugifying to 'top' gets 'top-2'); any repeat gets -2/-3…
export function drawer(label, innerHtml)       // native <details class="dw"><summary>… returns '' when innerHtml is falsy
export function unit({ kicker, statement, lead, figureHtml, pillsHtml, drawerLabel, drawerHtml })
export function gateBoard({ crumb, title, verdict, lede, keyStats, ask, chapters, sources, foot })
//  keyStats: [{value,label,variant?}] (rendered as .tiles; esc'd; empty/absent -> no tiles row)
//  ask: { headline, note?, recommendation?, recommendedBy?, targetId? } -> the .ask strip (absent -> none).
//    headline/note/recommendation/recommendedBy each render INDEPENDENTLY when present (no field
//    gates another); targetId, when given, must be one of the allocated chapter ids (templates
//    pass the resolved id, never a raw label).
//  chapters: [{ label, unitsHtml }] -> ids from allocateIds(labels); rail = Top + one chip per chapter
//  sources: [{label, value}] -> .src chips; foot: string
// Returns bodyHtml: rail nav + #top section (crumb/hero/tiles/ask) + chapter <section id=…> + foot.
// gateBoard ALSO returns the id map for templates: return value is { bodyHtml, ids } — templates
// that must know the ask chapter's resolved id call allocateIds themselves first and pass both
// chapters and ask.targetId from the same allocation (single source of truth).
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

test('allocateIds is collision-safe and reserves top', () => {
  assert.deepEqual(allocateIds(['Diagnosis', 'Plan', 'Diagnosis', 'Top', '汉字', '中文']),
    ['diagnosis', 'plan', 'diagnosis-2', 'top-2', 'section', 'section-2']);
});

test('ask strip renders recommendation without a note, and note without recommendation', () => {
  const a = gateBoard({ title: 't', ask: { headline: 'H', recommendation: 'Pick A', recommendedBy: 'Claude' }, chapters: [] });
  assert.match(a.bodyHtml, /Pick A/); assert.match(a.bodyHtml, /Claude/);
  const b = gateBoard({ title: 't', ask: { headline: 'H', note: 'just a note' }, chapters: [] });
  assert.match(b.bodyHtml, /just a note/);
});

test('gateBoard renders rail chips for Top + every chapter, with matching section ids', () => {
  const { bodyHtml, ids } = gateBoard({ crumb: 'C', title: 'T', verdict: 'V', lede: 'L',
    keyStats: [{ value: '1', label: 'one' }],
    ask: { headline: 'H<x>', targetId: 'your-call' },
    chapters: [{ label: 'Diagnosis', unitsHtml: '<p>u</p>' }, { label: 'Your call', unitsHtml: '<p>d</p>' }] });
  assert.deepEqual(ids, ['diagnosis', 'your-call']);
  assert.match(bodyHtml, /href="#top"/);
  assert.match(bodyHtml, /href="#diagnosis"/); assert.match(bodyHtml, /id="diagnosis"/);
  assert.match(bodyHtml, /href="#your-call"/); assert.match(bodyHtml, /id="your-call"/);
  assert.match(bodyHtml, /H&lt;x&gt;/);
  assert.match(bodyHtml, /class="tiles"/);
  assert.ok(!/#009ACC|MINDCLOUD/i.test(bodyHtml));
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

export function allocateIds(labels) {
  const taken = new Set(['top']);
  return labels.map((label) => {
    const base = slugify(label);
    let id = base;
    for (let n = 2; taken.has(id); n += 1) id = `${base}-${n}`;
    taken.add(id);
    return id;
  });
}

export function gateBoard({ crumb = '', title = '', verdict = '', lede = '', keyStats = [], ask = null, chapters = [], sources = [], foot = '' } = {}) {
  const ids = allocateIds(chapters.map((c) => c.label));
  const chs = chapters.map((c, i) => ({ id: ids[i], label: String(c.label ?? ''), unitsHtml: c.unitsHtml ?? '' }));
  const chips = [{ id: 'top', label: 'Top' }, ...chs]
    .map((c, i) => `<a class="nav__chip${i === 0 ? ' is-live' : ''}" href="#${c.id}" data-sec="${c.id}"${i === 0 ? ' aria-current="true"' : ''}><span class="nav__n" aria-hidden="true">${i + 1}</span>${esc(c.label)}</a>`)
    .join('');
  const nav = `<nav class="nav" aria-label="Chapters"><div class="nav__track" id="navtrack">${chips}<span class="nav__hint" aria-hidden="true">1&ndash;${chs.length + 1} jump &middot; Home / End</span></div></nav>`;
  const tiles = keyStats.length
    ? `<div class="tiles" role="list" aria-label="The numbers that matter">${keyStats.map((s) => `<div class="tile" role="listitem"><b>${esc(s?.value)}</b><span>${esc(s?.label)}</span></div>`).join('')}</div>` : '';
  // headline / note / recommendation / attribution each render independently — no field gates another
  const askBits = ask
    ? [ask.note ? esc(ask.note) : '',
       ask.recommendation ? `<strong>${esc(ask.recommendation)}</strong>` : '',
       ask.recommendedBy ? `<span class="chip">${esc(ask.recommendedBy)}</span>` : ''].filter(Boolean).join(' ')
    : '';
  const askTarget = ask?.targetId && (ask.targetId === 'top' || ids.includes(ask.targetId)) ? ask.targetId : null;
  const askStrip = ask
    ? `<div class="ask"><div class="ask__txt"><span class="ask__kick">What is being asked of you</span><b>${esc(ask.headline)}</b>${askBits ? `<p>${askBits}</p>` : ''}</div>${askTarget ? `<a class="btn btn--accent" href="#${askTarget}">Jump to the ask</a>` : ''}</div>` : '';
  const head = `<section id="top" aria-label="Verdict"><header class="wrap crumbrow"><span class="chip crumb">${esc(crumb)}</span><div class="tools"><span class="chip">Gate artifact</span><button class="btn btn--sm jsonly" id="exp-all" type="button">Expand all</button><button class="btn btn--sm jsonly" id="col-all" type="button">Collapse all</button></div></header>`
    + `<div class="wrap hero"><h1>${esc(title)}</h1>${verdict ? `<p class="verdictline">${esc(verdict)}</p>` : ''}${lede ? `<p class="lede">${esc(lede)}</p>` : ''}</div>`
    + `<div class="wrap">${tiles}${askStrip}</div></section>`;
  const sections = chs.map((c) => `<section class="chap" id="${c.id}" aria-label="${esc(c.label)}"><div class="wrap"><div class="seclab"><span></span><h2>${esc(c.label)}</h2></div>${c.unitsHtml}</div></section>`).join('');
  const src = sources.length ? `<div class="wrap src" aria-label="Evidence base">${sources.map((s) => `<span class="chip"><b>${esc(s?.value)}</b>&nbsp;${esc(s?.label)}</span>`).join('')}</div>` : '';
  const footer = foot ? `<p class="wrap foot">${esc(foot)}</p>` : '';
  return { bodyHtml: `${nav}\n${head}\n${sections}\n${src}\n${footer}`, ids };
}
```

- [ ] **Step 4: Run → PASS.** - [ ] **Step 5: Commit**: `git add -A && git commit -m "feat(scaffold): Gate Board shell — rail, hero, tiles, ask, chapters"`

### Task 6: `templates.mjs` — `planDeck` on the Gate Board

**Files:** rewrite `references/templates.mjs` top half; update `references/templates.test.mjs`.

**Interfaces:**
- Consumes: `gateBoard/unit/drawer/slugify` (Task 5 signatures), `renderBlocks` (blocks registry incl. Tasks 1–4).
- Produces: `planDeck(ledger) => { title, favicon, bodyHtml }` (same external contract `render.mjs` uses). Shared helpers the other templates reuse (Task 7): `const fav`, `const crumbOf` (default now `'THE-FOREMAN · DEV WORKFLOW'`), `function heroOf(meta, fallbackVerdict)`, `function askOf(ledger)`, `function figureSplit(blocks, explicitFigure)` → `{figureHtml, drawerBlocks}` where the figure is `explicitFigure ?? first block whose type ∈ FIGURE_TYPES` (`['statRow','bar','donut','phaseSteps','topo','deltaRow','duel','verdictFan','dotMatrix','ladder']`).

Behavior: hero from `meta.title/verdict(??subtitle)/lede`; tiles from `meta.keyStats`; chapters group consecutive slides by `chapter ?? 'Board'`; each slide renders as `unit({kicker, statement: s.statement ?? s.heading, lead: s.lead, figureHtml, pillsHtml: <pillRow blocks stay outside the drawer>, drawerHtml: bullets+cards+callout+remaining blocks})`.

**Ask resolution (single source of truth):** the template builds the FULL chapter-label list first — content chapters, plus an appended ask chapter labeled `Your call` whenever `ledger.decision` OR `meta.ask` exists — then calls `allocateIds` ONCE on that list; the ask strip's `targetId` is the allocated id of that appended chapter (never a raw label, never synthesized elsewhere). Ask-strip fields: `meta.ask` wins when present; else derived from `decision` (`headline: decision.question, recommendation, recommendedBy`). The ask CHAPTER's content: with `decision`, the option cards (reference lines ~1161–1229: letter well, risk chip allowlist `low|med|high`→`--low/--med/--high` else `--med`, recommended marker on `decision.recommendation` match, gist = first sentence of pros ≤ 140 chars, collapsed verbatim pros/cons in `<details class="optpc">`) + `.rec` strip; with only `meta.ask`, a single unit restating headline/note/recommendation so the jump target always lands on real content. `sources` from `ledger.findings?.sources`. Add a test: a ledger with `meta.ask` and NO `decision` still renders a `Your call` section whose id the ask strip links to.

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

**Interfaces:** unchanged external signatures for `brief/decisionCard/liveRun/phaseTracker/findings/comparison/dashboard`. Composition per spec §6, using the same helpers.

**Visible-content contract (test-pinned): a gate's decision-critical facts are NEVER inside `<details>`.** Drawers hold supporting evidence and long verbatim prose only. Per type:
- `brief`: hero(title, verdict = win.verified ? 'Verified' : 'Claimed — not yet verified'); one `Board` chapter unit — statement `'What landed'`, **`win.landed` renders VISIBLY as the unit's `.co` callout**, status pill (`Verified` ok / `Claimed` warn) visible; the drawer holds `win.evidence` verbatim; ask from `win.next`.
- `decisionCard`: hero + `Your call` chapter exactly as planDeck's decision chapter (option cards visible with gists + risk chips; only the verbatim pros/cons prose is collapsed); ask strip from the question.
- `liveRun`: hero; **`keyStats` synthesized VISIBLY as two tiles: `{value: lr.cost-first-clause, label: 'cost'}`, `{value: lr.blastRadius-first-clause, label: 'blast radius'}`** (first clause = text up to the first `·` or `.`, ≤ 80 chars, esc'd) plus a unit whose statement is `'Live-run gate — authorize before anything runs'` and whose **`.co` callouts for What / Cost / Blast radius / Cleanup are all VISIBLE in the unit body**; the drawer holds nothing unless the ledger adds `blocks[]`; ask headline `'Authorize this live run?'` with note from `lr.what`'s first sentence.
- `phaseTracker`: figure = `phaseSteps` (stops track) VISIBLE; optional `donut` from `pt.progress` also visible beside it; ask from `pt.note`.
- `findings`: **figure = the findings `table` (Finding/Confidence/Evidence/Verdict) VISIBLE in the unit body**; `statRow` wells from `f.sources` visible above it when present; summary → ask note; sources → chips. Drawer: none by default.
- `comparison`: **figure = the options × criteria `table` VISIBLE** (statement `'Options compared'`); ask = recommendation.
- `dashboard`: keyStats = `d.stats` (visible tiles); figure = `d.chart` via `figureSplit` visible; rows → `rankedRows` visible; ask = `d.ask`.

- [ ] **Step 1: Failing tests** — for each type one test asserting: `class="nav"` present, its content fields appear escaped, its ask renders, no `slide`/old classes, **and the visible-content pin: the primary facts named above occur OUTSIDE any `<details>` element** (assert by splitting the bodyHtml on `<details` and checking the fact strings appear in the pre-details segments — e.g. for liveRun, `lr.what` text is in a segment before/outside `<details>`). Plus: `assert.throws(() => templates.dashboard({ dashboard: { chart: { type: 'nope' } } }))` (unknown chart still fails closed).
- [ ] **Step 2: Run → FAIL.** - [ ] **Step 3: Implement.** - [ ] **Step 4: Run → PASS** (full blocks+templates+scaffold suite).
- [ ] **Step 5: Commit**: `git add -A && git commit -m "feat(templates): all eight artifact types render the Gate Board; retire deck()"`

### Task 8: `style.css` rewrite

**Files:** `references/style.css` (full rewrite), `references/style.test.mjs` (new).

The CSS is an extraction, not an invention: take the `<style>` block of `docs/initiatives/2026-08-26-neumorphic-gate-board/gate-board-reference.html` (lines 5–609) verbatim as the base — it already contains tokens (light + Blue Graphite dark in both carriers), rail, hero/tiles/ask, units/drawers, and every figure family — then make exactly these adaptations:
1. Keep class names as-is (blocks/scaffold from Tasks 1–7 emit them; Task 4b moved donut/bar/table/pillRow/statRow/phaseSteps onto these families already).
2. **Replace the Google Fonts `<link>`s with embedded `@font-face` data-URI declarations** at the top of style.css: base64-encode `sora-latin.woff2` and `nunito-sans-latin.woff2` (copy the two files from the portfolio repo `/Users/angel/Desktop/portfolio/design-system/fonts/` into `references/fonts/` first, committed) as `src:url(data:font/woff2;base64,…) format('woff2')` with the same weight ranges the portfolio declares (Sora 700–800, Nunito Sans 400–800), `font-display:swap`, and full system fallback stacks in the family rules. Rendered artifacts make ZERO external requests (ADR-003).
3. Style the still-legacy emitters: `.flow/.step(.gate|.go)/.arw`, `.relrow .k/.v`, `pre/code` + `.diff-add/.diff-del/.diff-ctx`, `.sparkwrap` — ported to the neumorphic idiom; define `--accent:var(--ac)` and `--line:var(--sd)` alias tokens in `:root` ONLY for lineSpark's SVG strokes (the one remaining SVG emitter).
4. Add `.mx{grid-template-columns:1fr repeat(var(--mxcols,2),96px)}` (Task 3), `.track` var-driven `--a/--b` positioning (Task 1), `.wells` (Task 4b statRow), and `.optpc` option-card drawer styles (Task 6).

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

test('the one rule: no visible borders, no second surface fills, engraved dividers only', () => {
  const borders = css.match(/border(-\w+)?\s*:\s*(?!0|none)[^;]+;/g) || [];
  assert.deepEqual(borders.filter((b) => !/border-radius|border-collapse/.test(b)), []);
  // every background/background-color is var(--bg), a --lineV/--lineH engraved
  // gradient, transparent, or currentColor status-dot fill via allowlisted tokens
  const bgs = css.match(/background(-color)?\s*:\s*[^;]+;/g) || [];
  const allowed = /var\(--bg\)|var\(--lineV\)|var\(--lineH\)|var\(--ac\)|var\(--acq\)|var\(--ok\)|var\(--warn\)|var\(--err\)|var\(--sb\)|var\(--sd\)|transparent|none|currentColor/;
  assert.deepEqual(bgs.filter((b) => !allowed.test(b)), []);
  assert.ok(!/linear-gradient(?![^;]*--line)/.test(css));       // no gradients besides the engraved pair
  assert.ok(!/url\(\s*['"]?https?:/.test(css));                  // no external requests (ADR-003)
  assert.match(css, /data:font\/woff2;base64,/);                 // fonts embedded
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

Extraction: the reference mockup's `<script>` (lines 1244–1341) verbatim, with three generalizations: (a) `ids` is derived at runtime — `var ids = Array.prototype.map.call(document.querySelectorAll('.nav__chip'), function(a){ return a.getAttribute('data-sec'); });` — so any chapter set works; (b) number-key handling covers `1..9` bounded by `ids.length`; (c) **`Home` jumps to `ids[0]` and `End` to `ids[ids.length - 1]` — no hardcoded chapter id anywhere** (the reference's literal `'yourcall'` End target does not survive extraction; it would miss `your-call` and every non-decision page).

- [ ] **Step 1: Failing test** (string-contract tests, mirroring how `slide-engine.test.mjs` pins behavior without a DOM):

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const js = readFileSync(new URL('./gate-board.js', import.meta.url), 'utf8');

test('page script derives chapters from the rail, no hardcoded ids anywhere', () => {
  assert.match(js, /querySelectorAll\('\.nav__chip'\)/);
  assert.ok(!js.includes("['top', 'diagnosis'"));
  assert.ok(!/['"]yourcall['"]|['"]your-call['"]|['"]diagnosis['"]/.test(js)); // End/Home derived, never literal
  assert.match(js, /ids\[ids\.length - 1\]/);   // End = last chapter
  assert.match(js, /ids\[0\]/);                  // Home = first chapter
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

**Interfaces:** `lintLedger(ledger, type) => string[]` — pure, no IO. Rules (each returns a `lint: …` string): statement/heading > 12 words in a statement slot; `` ` `` or `@` inside a statement (code-token smell); gate types (`planDeck/brief/decisionCard/liveRun`) missing BOTH `meta.verdict` and `meta.subtitle`, or missing any ask source; `meta.keyStats` present with length outside 3..5.

`render.mjs` changes: read `gate-board.js` instead of `slide-engine.js`; remove the `SYMBOLS` const and its interpolation; after `make(ledger)`, `for (const w of lintLedger(ledger, type)) console.error('[gate-board lint]', w);` — before the secret scan, never throwing.

**Accent override — the `--user-ac` source token.** Task 8's tokens change to consume an inherited source: `:root{ --ac: var(--user-ac, #5b7cfa); }` and BOTH dark carriers use `--ac: var(--user-ac, #6687ff);` (the fallback differs per theme; an override wins in all three host states because the var reference, not the literal, is what the carriers redefine). `render.mjs`'s override emits `<style>:root{--user-ac:${accent}}</style>` (strict 6-hex validation unchanged). **Accent normalization policy (owner decision, gate round 1):** *resolved per the owner's answer — see the committed decision note in this file's history; implement exactly one of:* (a) legacy-default normalization — `meta.accent` equal to `#009ACC` (case-insensitive) is treated as "house default, no override emitted" (preserving the original semantics where `#009ACC` meant default), while any OTHER hex emits the override; or (b) verbatim pass-through of every valid hex including `#009ACC`. Tests: theme-matrix (override visible in auto-dark, forced-light, forced-dark via string assertions on the emitted style + carrier var usage), plus the policy case for a `#009ACC` ledger.

- [ ] **Step 1: Failing tests**: lint unit tests (one per rule firing + one clean ledger → `[]`); render test updates asserting output contains `nav__track` and NOT `<svg width="0"`/`#i-cog`/`slide-engine`, plus the existing secret-scan fail-closed tests unchanged.
- [ ] **Step 2: Run → FAIL.** - [ ] **Step 3: Implement; delete the two slide-engine files.** - [ ] **Step 4: Run full suite → PASS.**
- [ ] **Step 5: Commit**: `git add -A && git commit -m "feat(render): gate-board wiring, non-fatal authoring lint, retire slide-engine"`

### Task 11: Markdown twin — executive summary + statements

**Files:** `references/markdown.mjs`, `references/markdown.test.mjs`.

Changes — the twin mirrors EVERY content addition the HTML gained (ADR-003 portable-twin doctrine):
1. `head(meta)` gains, after the crumb: `meta.verdict ?? meta.subtitle` as a bold line, `meta.lede` as a paragraph, `meta.keyStats` as a `- **value** — label` list, and a shared `askToMarkdown(ask)` serializer emitting `> **The ask:** headline` plus separate lines for note, `**Recommendation:** …`, and `(recommendedBy)` — each independently when present.
2. planDeck slide headings become `## ${mdEsc(s?.kicker ?? '')} — ${mdEsc(s?.statement ?? s?.heading ?? '')}`; `s.lead` renders as a paragraph.
3. **Figures**: when `s.figure` is present, serialize it via `blocksToMarkdown([s.figure])` BEFORE the slide's other content; when the figure was the FALLBACK (picked from `s.blocks`), do NOT serialize it twice — `blocksToMarkdown(s.blocks)` already covers it (test both cases).
4. **Decision chapter**: planDeck with `ledger.decision` appends a `## Your call` section reusing the existing decisionCard twin body (question, per-option pros/cons/risk lines, attributed recommendation) — extract that body into a shared `decisionToMarkdown(d)` used by both planDeck and decisionCard.
5. **Sources**: `ledger.findings?.sources` appends an `**Evidence base:**` list on planDeck.

- [ ] **Step 1: Failing tests**: render the reference ledger + a synthetic ledger carrying `meta.keyStats`, `meta.ask` (recommendation, no note), an explicit `figure`, AND a fallback figure from `blocks`; assert the twin contains the verdict line, each keyStat, the ask + recommendation lines, the explicit figure's serialization exactly once, the fallback figure exactly once, the `## Your call` decision section with all four options, the sources list, and a `statement`-overridden heading; assert injection strings stay escaped (`mdEsc`).
- [ ] **Step 2: Run → FAIL.** - [ ] **Step 3: Implement.** - [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit**: `git add -A && git commit -m "feat(twin): executive summary and statements in the Markdown twin"`

### Task 12: Back-compat corpus

**Files:** Create under `references/fixtures/`:
- `legacy-plandeck.json` — copy of `docs/initiatives/2026-08-26-neumorphic-gate-board/reference-ledger.json` (carries slides+chapters+findings+liveRun+decision+win, and blocks: statRow, table, pillRow, phaseSteps, rankedRows).
- `legacy-minimal.json` — `{"meta":{"title":"t"},"slides":[{"heading":"h","bullets":["b"]}]}`.
- `legacy-allblocks.json` — one slide per REMAINING legacy block type not in the reference ledger (`donut`, `bar`, `lineSpark`, `flow`, `code`, `diff`), synthetic values.
- `legacy-dup-chapters.json` — slides with NON-consecutive repeated `chapter` labels (the shape four real ledgers have): `[{"chapter":"A","heading":"1"},{"chapter":"B","heading":"2"},{"chapter":"A","heading":"3"}]` — pins collision-safe ids (`a`, `b`, `a-2`).
- `legacy-sections.json` — a ledger carrying ALL eight typed sections (meta/slides/findings/liveRun/decision/win/phaseTracker/comparison/dashboard) so every template runs against one fixture.

Test `references/backcompat.test.mjs` (new); Script `references/backcompat-sweep.mjs` (new — NOT a test).

- [ ] **Step 1: Failing test**: for every fixture × every applicable type, call the template and `toMarkdown` — assert no throw, non-empty output, `class="nav"` present, no `NaN|Infinity|undefined` in HTML, and for `legacy-dup-chapters.json` the three section ids are unique.
- [ ] **Step 2: Run → FAIL** only if Tasks 6–11 left a legacy gap (this test EXISTS to catch that; if it passes immediately, verify it by temporarily breaking a fallback, watch it fail, restore).
- [ ] **Step 3: Write `backcompat-sweep.mjs`** — a LOCAL verification script (machine-specific, so not part of `node --test`): globs `~/.claude/the-foreman/**/*.json`, and for each file that parses as an object with `meta`, tries every template whose section is present, IN MEMORY ONLY — writes nothing, prints ONLY `path: OK` or `path: FAIL <error message>` (never ledger content). Exit non-zero if any FAIL.
- [ ] **Step 4: Run the suite → PASS; run `node references/backcompat-sweep.mjs` → every available real ledger OK** (Task 14 re-runs this as final verification).
- [ ] **Step 5: Commit**: `git add -A && git commit -m "test: legacy-ledger back-compat corpus + local read-only sweep"`

### Task 13: Schema docs, authoring contract, de-brand

**Files:** `references/ledger.schema.md` (new meta fields §, six figure blocks §, `figure` field, crumb/accent defaults, drop icon-sprite language); `SKILL.md` (§4: "MindCloud-styled" → "neumorphic Gate Board", add the **Authoring contract** subsection with the §7-of-design rules verbatim); `evals/evals.json` (each `expected_output`: "MindCloud planDeck/deck/artifact" → "neumorphic Gate Board <type>"); repo `README.md` (brand language).

- [ ] **Step 1: Failing check** (extend `contract-drift.test.mjs` or add `debrand.test.mjs`): grep the four files + all `references/*.{mjs,js,css}` for `/MindCloud|MINDCLOUD|#009ACC/` → assert zero matches.
- [ ] **Step 2: Run → FAIL.** - [ ] **Step 3: Edit the four files.** - [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit**: `git add -A && git commit -m "docs: Gate Board schema, authoring contract, full de-brand"`

### Task 14: Enriched reference ledger + full verification

**Files:** Create `docs/initiatives/2026-08-26-neumorphic-gate-board/gate-board-ledger.json` — a MIGRATED copy of `reference-ledger.json` that exercises every new capability: `meta.verdict` ("4 rounds, 8-7-8-7 flat…" moved from subtitle), `meta.lede` (the findings summary rewritten plain), `meta.keyStats` (the five hero numbers), `meta.ask` (headline + recommendation + recommendedBy), and per-slide `statement`, `lead`, and explicit `figure` blocks — each of the six new types used at least once (`deltaRow` on the complaint slide, `topo` on root-cause, `duel` + the decision on the final chapter, `verdictFan` on gate-round-1, `dotMatrix` on ADR-1, `ladder` on honest-limits) with the same real numbers. The ORIGINAL `reference-ledger.json` stays untouched as the legacy fixture.

- [ ] **Step 1:** Author `gate-board-ledger.json` per the mapping above (values verbatim from `reference-ledger.json` — nothing invented).
- [ ] **Step 2:** `node --test plugin/skills/the-foreman/references/` → ALL PASS, zero skips.
- [ ] **Step 3:** Render both ledgers for real:
  `node plugin/skills/the-foreman/references/render.mjs docs/initiatives/2026-08-26-neumorphic-gate-board/gate-board-ledger.json planDeck /tmp/gate-board-out.html` and the same for `reference-ledger.json` → both exit 0; open the enriched render and compare against `gate-board-reference.html` (rail, hero tiles, ask strip, EVERY figure family, drawers, both themes, no external requests in devtools network). Fix visual gaps; re-run tests.
- [ ] **Step 4:** Render every other type from `legacy-sections.json` (`brief`, `decisionCard`, `liveRun`, `phaseTracker`, `findings`, `comparison`, `dashboard`) → all exit 0, each page carries the rail + its ask with primary facts visible.
- [ ] **Step 5:** `node plugin/skills/the-foreman/references/backcompat-sweep.mjs` → every real local ledger OK.
- [ ] **Step 6: Commit**: `git add -A && git commit -m "feat: enriched Gate Board reference ledger; full-engine verification"`

---

## Self-review record

- Spec coverage: §2→Task 8; §3→Tasks 5,8,9; §4→Tasks 6,11,12; §5→Tasks 1–4,8; §6→Tasks 6,7; §7→Tasks 10,13; §8→every task's tests + Task 12; §9→Tasks 10,13; §10→all; §11 steps 2–5 happen after this plan (codex-gate, PR, reconciled sync — deliberately outside task scope).
- Placeholder scan: extraction tasks (8, 9) reference exact line ranges of a committed reference file — actionable, not placeholders.
- Type consistency: `figureSplit` FIGURE_TYPES matches the spec's figure-capable set; scaffold signatures quoted identically in Tasks 5, 6, 7.
