// the-foreman content-block registry — the CLOSED, validated set of per-slide
// content blocks. The foundation every later block follows.
//
// SAFETY / FAIL-CLOSED (the whole point):
//   * Every ledger value reaches markup ONLY through esc() (HTML) or mdEsc()
//     (twin), at THIS builder's own interpolation point — never raw.
//   * An UNKNOWN block type THROWS — it does NOT silently skip. A silent skip
//     would hide ledger content while rendering a clean-looking artifact.
//     renderBlocks() runs inside planDeck (HTML) and blocksToMarkdown() inside
//     toMarkdown (twin), both of which execute in render.mjs BEFORE any file
//     write — so an unknown block makes render() throw and write NEITHER file.
//     (Contrast: an unknown ICON id renders empty — that's presentational; a
//     content block is load-bearing data and must never vanish.)
//   * html + md for each block are CO-LOCATED so twin parity is reviewable.

import { esc, mdEsc } from './esc.mjs';

// Normalize a row to exactly `width` cells: pad short rows, drop extras, and
// treat a non-array row as empty. Keeps tables well-formed without ever
// throwing on a ragged ledger.
function normalizeRow(row, width) {
  const cells = Array.isArray(row) ? row : [];
  return Array.from({ length: width }, (_, i) => cells[i] ?? '');
}

// ---- numeric guard (THE safety crux for every chart block) ----
//
// EVERY ledger number that reaches an SVG attribute / geometry MUST pass through
// safeNum FIRST. JSON.parse('1e999') yields Infinity, a malformed value yields
// NaN, and ledger numbers can be negative or absurdly large — none may reach the
// markup. safeNum coerces to a finite Number, replaces non-finite with a
// fallback, then clamps into [min, max]. Result: never the string "NaN"/
// "Infinity" in output, never unbounded geometry.
function safeNum(x, { min = -Infinity, max = Infinity, fallback = 0 } = {}) {
  const n = Number(x);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

// Round an emitted coordinate to a sane precision (2dp). Input is assumed
// already safeNum'd; Math.round keeps the output short and stable.
const round = (n) => Math.round(n * 100) / 100;

// Stat-block variant allowlist — only these decorate the markup; anything else
// (incl. an injection attempt smuggled through `variant`) falls back to bare.
const STAT_VARIANTS = new Set(['ok', 'warn']);

// Flow-step kind allowlist — only these add a chip color class; anything else
// (incl. an injection smuggled through `kind`) falls back to the bare `.step`.
const FLOW_KINDS = new Set(['gate', 'go']);

// Phase-step status allowlist + per-status sign text. Anything else (incl. an
// injection smuggled through `status`) is coerced to 'pending'. The signs are
// static literals I author — never ledger text — so they're safe to emit raw.
const PHASE_STATUSES = new Set(['done', 'active', 'pending']);
const STOP_SIGN = { done: 'done ✓', active: 'active ▸', pending: 'pending' };
const PHASE_MD_MARK = { done: '[x]', active: '[~]', pending: '[ ]' };
const phaseStatus = (s) => (PHASE_STATUSES.has(s) ? s : 'pending');

// Diff-op allowlist (Phase 2d) + per-op HTML class. The op is NEVER interpolated
// raw — only used to PICK a static class — and an unknown/missing op coerces to
// the context op ' ' (a SPACE is itself a valid op). Same fail-closed posture as
// STAT_VARIANTS / FLOW_KINDS / PHASE_STATUSES.
const DIFF_OPS = new Set(['+', '-', ' ']);
const DIFF_CLASS = { '+': 'diff-add', '-': 'diff-del', ' ': 'diff-ctx' };
const diffOp = (op) => (DIFF_OPS.has(op) ? op : ' ');

// Pill-variant allowlist (Phase 2d) — only these decorate the markup; anything
// else (incl. an injection smuggled through `variant`) falls back to bare.
const PILL_VARIANTS = new Set(['ok', 'warn']);

// bar tag-kind allowlist (Gate Board) — only these pick a `.tag--…` modifier
// class; anything else (incl. an injection smuggled through `kind`) falls back
// to the bare `.tag`. Same fail-closed posture as the allowlists above.
const BAR_TAG_KINDS = new Set(['spawn', 'code']);

// verdictFan fate-variant allowlist (Gate Board) — only these pick a modifier
// class; anything else (incl. an injection smuggled through `variant`) is
// coerced to 'x'. Same fail-closed posture as the allowlists above.
const FATE_VARIANTS = new Set(['ok', 'warn', 'x']);
const fateVariant = (v) => (FATE_VARIANTS.has(v) ? v : 'x');

// ladder row-status allowlist (Gate Board) — only these pick a `.lrow__v--…`
// modifier class; anything else (incl. an injection smuggled through `status`)
// is coerced to 'no'. Same fail-closed posture as the allowlists above.
const LADDER_STATUS = new Set(['ok', 'mid', 'no']);
const ladderStatus = (s) => (LADDER_STATUS.has(s) ? s : 'no');

// Sanitize a fenced-code INFO string (the word after the opening fence) to
// alphanumeric only, capped at 20 chars — so `lang` can never inject a newline,
// a backtick, or any structure into the twin.
const fenceInfo = (lang) => String(lang ?? '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 20);

// THE CRUX (ADR-004) — serialize a RAW multiline body into a Markdown fenced
// code block whose fence the content CANNOT close. Returns a literal fenced
// block; the body stays verbatim inside (NEVER mdEsc'd — fence containment IS
// the safety, and a Markdown renderer renders fenced content as inert literal
// text; the whole-twin secret-scan in render.mjs still covers it).
//   1. normalize CR/CRLF to \n so a lone \r can't spawn structure;
//   2. find the longest run of backticks ANYWHERE in the body;
//   3. fence = max(3, longestRun + 1) backticks => strictly longer than any run
//      inside, so no body line can ever be (mis)read as a closing fence.
function fencedCode(body, lang) {
  const norm = String(body ?? '').replace(/\r\n?/g, '\n');
  const maxRun = (norm.match(/`+/g) || []).reduce((m, r) => Math.max(m, r.length), 0);
  const fence = '`'.repeat(Math.max(3, maxRun + 1));
  const info = fenceInfo(lang);
  return `${fence}${info}\n${norm}\n${fence}`;
}

const BLOCKS = {
  // { type:'table', columns:[string], rows:[[cell,…],…], caption?:string }
  table: {
    html(block) {
      const columns = Array.isArray(block?.columns) ? block.columns : [];
      const rows = Array.isArray(block?.rows) ? block.rows : [];
      const width = columns.length;
      const caption = block?.caption ? `<caption>${esc(block.caption)}</caption>` : '';
      // Gate Board .t skin — native <table> semantics KEPT (caption, th[scope=col]);
      // the .gt div-grid form is NOT used for the table block.
      const thead = `<thead><tr>${columns.map((c) => `<th scope="col">${esc(c)}</th>`).join('')}</tr></thead>`;
      const tbody = `<tbody>${rows
        .map((r) => `<tr>${normalizeRow(r, width).map((cell) => `<td>${esc(cell)}</td>`).join('')}</tr>`)
        .join('')}</tbody>`;
      return `<div class="scrollx"><table class="t">${caption}${thead}${tbody}</table></div>`;
    },
    md(block) {
      const columns = Array.isArray(block?.columns) ? block.columns : [];
      const rows = Array.isArray(block?.rows) ? block.rows : [];
      const width = columns.length;
      // mdEsc escapes `|`, so a pipe inside a cell is inert and can't add a
      // column. The structural pipes/dashes below are static literals I author.
      // The caption (HTML uses <caption>) is mirrored as a bold line above the
      // table so the twin never drops it.
      const cap = block?.caption ? `**${mdEsc(block.caption)}**\n\n` : '';
      const header = `| ${columns.map((c) => mdEsc(c)).join(' | ')} |`;
      const sep = `| ${columns.map(() => '---').join(' | ')} |`;
      const body = rows
        .map((r) => `| ${normalizeRow(r, width).map((cell) => mdEsc(cell)).join(' | ')} |`)
        .join('\n');
      const table = body ? `${header}\n${sep}\n${body}` : `${header}\n${sep}`;
      return cap + table;
    },
  },

  // { type:'rankedRows', rows:[{label:string, value:string}] }
  rankedRows: {
    html(block) {
      const rows = Array.isArray(block?.rows) ? block.rows : [];
      return rows
        .map((r) => `<div class="relrow"><span class="k">${esc(r?.label)}</span><span class="v">${esc(r?.value)}</span></div>`)
        .join('');
    },
    md(block) {
      const rows = Array.isArray(block?.rows) ? block.rows : [];
      return rows.map((r) => `- **${mdEsc(r?.label)}** — ${mdEsc(r?.value)}`).join('\n');
    },
  },

  // ---- metrics / charts (Phase 2b) ----
  // SVG safety contract (donut/lineSpark; bar is HTML-only since the Gate Board
  // restyle): inline <svg> only, with
  // <circle>/<rect>/<line>/<polyline>/<text>/<g> + LITERAL geometry and
  // var(--…) colors. NONE of href/xlink:href/<image>/<use>/<foreignObject>/
  // url(...)/style-url/http(s). Labels go through esc(); EVERY number through
  // safeNum() BEFORE it reaches an attribute. role="img" + an esc'd aria-label.

  // { type:'statRow', stats:[{ value:string, label:string, variant?:''|'ok'|'warn' }] }
  // A row of carved stat wells (HTML only — NOT a chart; Gate Board restyle).
  // `value` is a pre-formatted DISPLAY string ("$0.12", "70/70"); both value +
  // label escaped. `variant` is allowlisted and only ever PICKS the static
  // `is-ok`/`is-warn` modifier on the value — never interpolated raw.
  statRow: {
    html(block) {
      const stats = Array.isArray(block?.stats) ? block.stats : [];
      return `<div class="wells">${stats
        .map((s) => {
          const variant = STAT_VARIANTS.has(s?.variant) ? ` is-${s.variant}` : '';
          return `<div class="well"><span class="well__v${variant}">${esc(s?.value)}</span><span class="well__l">${esc(s?.label)}</span></div>`;
        })
        .join('')}</div>`;
    },
    md(block) {
      const stats = Array.isArray(block?.stats) ? block.stats : [];
      return stats.map((s) => `- **${mdEsc(s?.value)}** — ${mdEsc(s?.label)}`).join('\n');
    },
  },

  // { type:'donut', value:number, max?:number (default 100), label?:string }
  // The tick-ring dial (Gate Board restyle — HTML, no SVG): a ring of `.ring__t`
  // ticks (lit `.on` vs unlit) around a raised `.ring__c` center disc. The .ring
  // carries role="img" + an esc'd aria-label stating the COMPUTED value / max
  // (+ label); the ticks are aria-hidden decoration. Center shows `value / max`
  // (or `pct%` when max is 100) + the esc'd label.
  //
  // Tick-ring numeric contract: tick/lit REPETITION COUNTS are guard-derived
  // integers ONLY — never ledger values. max=0 (or clamped-negative) yields an
  // all-off 13-tick ring with NO division; ticks always land in [4, 24].
  donut: {
    html(block) {
      const max = safeNum(block?.max ?? 100, { min: 0, fallback: 100 });
      const value = safeNum(block?.value, { min: 0, max: max > 0 ? max : 0, fallback: 0 });
      const pct = max > 0 ? Math.round((value / max) * 100) : 0;
      const ticks = max > 0 ? Math.min(24, Math.max(4, Math.round(max <= 24 ? max : 24))) : 13; // positive integer
      const lit = max > 0 ? Math.round((value / max) * ticks) : 0; // 0 when max is 0 — never a division
      const tickHtml = Array.from({ length: ticks }, (_, i) =>
        `<i class="ring__t${i < lit ? ' on' : ''}" aria-hidden="true" style="--r:${round((i * 360) / ticks)}deg"></i>`).join('');
      const center = max === 100
        ? `<b><em>${pct}</em><small>%</small></b>`
        : `<b><em>${esc(value)}</em><small> / ${esc(max)}</small></b>`;
      const label = block?.label ? `<span>${esc(block.label)}</span>` : '';
      const aria = esc(`${value} / ${max}${block?.label ? `, ${block.label}` : ''}`);
      return `<div class="ringwrap"><div class="ring" role="img" aria-label="${aria}">${tickHtml}`
        + `<div class="ring__c">${center}${label}</div></div></div>`;
    },
    // MIRRORS the ring center display (the only md() change in the Gate Board
    // reskin of the legacy blocks): `**pct%**` when max is 100, else
    // `**value / max** (pct%)` — zero max yields `**0 / 0** (0%)`, never NaN.
    md(block) {
      const max = safeNum(block?.max ?? 100, { min: 0, fallback: 100 });
      const value = safeNum(block?.value, { min: 0, max: max > 0 ? max : 0, fallback: 0 });
      const pct = max > 0 ? Math.round((value / max) * 100) : 0;
      const label = block?.label ? ` — ${mdEsc(block.label)}` : '';
      return max === 100
        ? `**${pct}%**${label}`
        : `**${mdEsc(value)} / ${mdEsc(max)}** (${pct}%)${label}`;
    },
  },

  // { type:'bar', bars:[{ label:string, value:number, tags?:[{label, kind?:'spawn'|'code'}] }], max?:number }
  // The carved-track wall-bar figure (Gate Board restyle — HTML, no SVG): one
  // `.brow` per bar with a `.brow__rail` track whose fill/end-marker widths are
  // driven by a `--w` custom prop = round(min(100, value/denom*100)), denom per
  // the ORIGINAL rules (declared max > largest value > 1). Optional per-bar
  // `tags` render as `.tag` chips; `kind` is strictly allowlisted (BAR_TAG_KINDS)
  // and only ever PICKS a static modifier class — never interpolated raw.
  bar: {
    html(block) {
      const bars = Array.isArray(block?.bars) ? block.bars : [];
      const values = bars.map((b) => safeNum(b?.value, { min: 0 }));
      const declaredMax = block?.max != null ? safeNum(block.max, { min: 0 }) : 0;
      const largest = values.reduce((m, v) => (v > m ? v : m), 0);
      const denom = declaredMax > 0 ? declaredMax : largest > 0 ? largest : 1; // never 0
      const rows = bars.map((b, i) => {
        const v = values[i];
        const w = round(Math.min(100, (v / denom) * 100));
        const tags = (Array.isArray(b?.tags) ? b.tags : []).map((t) => {
          const kind = BAR_TAG_KINDS.has(t?.kind) ? ` tag--${t.kind}` : '';
          return `<span class="tag${kind}"><i></i>${esc(t?.label)}</span>`;
        }).join('');
        // Display the SAFE numeric value — never the raw ledger value (which
        // could be "NaN"/"Infinity"). esc() is belt-and-suspenders over a number.
        return `<div class="brow"><div class="brow__l"><b>${esc(b?.label)}</b>${tags ? `<span class="brow__tags">${tags}</span>` : ''}</div>`
          + `<div class="brow__bar"><div class="brow__rail"><i style="--w:${w}"></i><em style="--w:${w}"></em></div>`
          + `<span class="brow__v">${esc(v)}</span></div></div>`;
      }).join('');
      return `<div class="bars">${rows}</div>`;
    },
    md(block) {
      const bars = Array.isArray(block?.bars) ? block.bars : [];
      // safeNum the value so the twin never emits "NaN"/"Infinity" either. The
      // ` [tag1, tag2]` brackets are static literals I author; only each tag
      // label is ledger-derived, so only it needs mdEsc. Untagged bars emit a
      // line byte-identical to the pre-restyle twin.
      return bars.map((b) => `- ${mdEsc(b?.label)}: ${mdEsc(safeNum(b?.value, { min: 0 }))}${Array.isArray(b?.tags) && b.tags.length ? ` [${b.tags.map((t) => mdEsc(t?.label)).join(', ')}]` : ''}`).join('\n');
    },
  },

  // { type:'lineSpark', points:[number], label?:string }
  // A sparkline <polyline>: each safeNum(point) mapped into the viewBox,
  // normalized to the finite min/max of the points. 0/1 point + all-equal points
  // are handled without div-by-zero (flat mid-line).
  lineSpark: {
    html(block) {
      const raw = Array.isArray(block?.points) ? block.points : [];
      const pts = raw.map((p) => safeNum(p));
      const W = 240;
      const H = 48;
      const PAD = 4; // keep the stroke inside the viewBox
      const innerH = H - PAD * 2;
      const innerW = W - PAD * 2;
      const aria = esc(block?.label ? `sparkline, ${block.label}` : 'sparkline');
      let polyline = '';
      if (pts.length > 0) {
        const lo = Math.min(...pts);
        const hi = Math.max(...pts);
        const span = hi - lo; // 0 when 1 point OR all-equal => flat mid-line
        const n = pts.length;
        const coords = pts
          .map((p, i) => {
            const x = n === 1 ? round(W / 2) : round(PAD + (i / (n - 1)) * innerW);
            // invert y (SVG y grows downward). span===0 => mid-line; a non-finite t
            // (e.g. span overflowed to Infinity for opposite finite extremes like
            // [-1e308, 1e308], making (p-lo)/span === NaN) => mid-line; then clamp
            // into the track so geometry never escapes the viewBox.
            let t = span === 0 ? 0.5 : (p - lo) / span;
            if (!Number.isFinite(t)) t = 0.5;
            t = Math.min(1, Math.max(0, t));
            const y = round(PAD + (1 - t) * innerH);
            return `${x},${y}`;
          })
          .join(' ');
        polyline = `<polyline fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" points="${coords}"/>`;
      }
      return `<div class="sparkwrap"><svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${aria}">${polyline}</svg></div>`;
    },
    md(block) {
      const raw = Array.isArray(block?.points) ? block.points : [];
      const pts = raw.map((p) => safeNum(p)).join(', ');
      const label = block?.label ? `${mdEsc(block.label)}: ` : '';
      return `${label}${pts}`;
    },
  },

  // ---- process / flow (Phase 2c) ----
  // Pure HTML chips (no SVG). `kind`/`status` are strictly set-membership
  // allowlisted — NEVER interpolated into a class/attribute raw — exactly like
  // statRow's `variant`. Every label reaches markup through esc()/mdEsc().

  // { type:'flow', steps:[{ label:string, kind?:''|'gate'|'go' }] }
  // A horizontal flow of `.step` chips separated by `.arw` "→" arrows. `kind`
  // picks the EXISTING `.step.gate` (red) / `.step.go` (blue) class; anything
  // else (incl. an injected kind) yields a bare `.step` — no class smuggled.
  flow: {
    html(block) {
      const steps = Array.isArray(block?.steps) ? block.steps : [];
      const chips = steps.map((s) => {
        const kind = FLOW_KINDS.has(s?.kind) ? ` ${s.kind}` : '';
        return `<span class="step${kind}">${esc(s?.label)}</span>`;
      });
      // arrow BETWEEN chips, not after the last
      const inner = chips.join('<span class="arw">→</span>');
      return `<div class="flow">${inner}</div>`;
    },
    md(block) {
      const steps = Array.isArray(block?.steps) ? block.steps : [];
      // The ` → ` join and the `[gate]`/`[go]` annotations are static literals I
      // author; only the label is ledger-derived, so only it needs mdEsc.
      return steps
        .map((s) => {
          const tag = FLOW_KINDS.has(s?.kind) ? `[${s.kind}] ` : '';
          return `${tag}${mdEsc(s?.label)}`;
        })
        .join(' → ');
    },
  },

  // { type:'phaseSteps', steps:[{ label:string, status?:'done'|'active'|'pending', detail?:string }] }
  // The stops track (Gate Board restyle): a native `<ol class="stops">` of
  // `<li class="stop">` items — list semantics preserved. `status` is allowlisted
  // (default/unknown => pending) and only ever indexes the static STOP_SIGN map,
  // rendered as the `.stop__sign` text. Optional `detail` renders as the body
  // <p>; absent detail => byte-identical stop. The `.stop__mark` spine dot is
  // aria-hidden decoration; `.stop__n` is the engine-derived 1-based step index.
  phaseSteps: {
    html(block) {
      const steps = Array.isArray(block?.steps) ? block.steps : [];
      // Desktop column count rides a custom prop (style.css sizes the grid
      // columns and the marker-center rail insets from it — the layout fits ANY
      // step count, not just the reference's five). The value is an
      // ENGINE-DERIVED integer only — steps.length is a non-negative array
      // length, floored at 1 so the CSS division can never see 0 — never
      // ledger text. A sub-2-step track gets .stops--solo, hiding the rail
      // (it needs two marker centers to span).
      const cols = Math.max(1, steps.length);
      const solo = steps.length < 2 ? ' stops--solo' : '';
      const items = steps
        .map((s, i) => {
          const status = phaseStatus(s?.status); // always one of the allowlist
          const detail = s?.detail != null && s.detail !== '' ? `<p>${esc(s.detail)}</p>` : '';
          return `<li class="stop"><span class="stop__mark" aria-hidden="true"><i></i><u></u></span>`
            + `<div class="stop__body"><span class="stop__n">${i + 1}</span><b>${esc(s?.label)}</b>${detail}`
            + `<span class="stop__sign">${STOP_SIGN[status]}</span></div></li>`;
        })
        .join('');
      return `<ol class="stops${solo}" style="--stopcols:${cols}">${items}</ol>`;
    },
    md(block) {
      const steps = Array.isArray(block?.steps) ? block.steps : [];
      return steps
        .map((s) => {
          const detail = s?.detail != null && s.detail !== '' ? ` — ${mdEsc(s.detail)}` : '';
          return `- ${PHASE_MD_MARK[phaseStatus(s?.status)]} ${mdEsc(s?.label)}${detail}`;
        })
        .join('\n');
    },
  },

  // ---- code / annotation (Phase 2d) ----
  // The twin path is the crux: code/diff bodies preserve RAW multiline content
  // and MUST stay inert + uncloseable. HTML escapes every char with esc(); the
  // twin uses the dynamic-fence serializer (fencedCode) — NEVER mdEsc (which
  // collapses newlines and would destroy code). Single-line label-ish values
  // (pillRow) DO use mdEsc. `lang`/`op`/`variant` are strictly sanitized/
  // allowlisted, never interpolated raw into markup.

  // { type:'code', code:string, lang?:string }
  // Multiline code. HTML: <pre><code class="language-{alnum lang}">esc(code)</code></pre>
  // (newlines preserved, every char esc'd => any markup in the body is inert).
  // Twin: a dynamic-fence block over `code`, info = sanitized lang.
  code: {
    html(block) {
      const lang = fenceInfo(block?.lang);
      const cls = lang ? ` class="language-${lang}"` : '';
      return `<pre><code${cls}>${esc(block?.code)}</code></pre>`;
    },
    md(block) {
      return fencedCode(block?.code, block?.lang);
    },
  },

  // { type:'diff', lines:[{ op:'+'|'-'|' ', text:string }] }
  // A unified-diff body. `op` is allowlisted ('+'/'-'/' ', default/unknown => ' ')
  // and only ever PICKS a static class — never interpolated raw. HTML: <pre><code>
  // of one <span class="diff-add|diff-del|diff-ctx">{op}{esc(text)}</span> per
  // line, joined by \n. Twin: a dynamic-fence block (info `diff`) whose body is
  // each {op}{text} joined by \n — the fence is computed over the JOINED body so
  // no text line's backtick run can close it; text stays literal inside the fence.
  diff: {
    html(block) {
      const lines = Array.isArray(block?.lines) ? block.lines : [];
      const body = lines
        .map((l) => {
          const op = diffOp(l?.op);
          return `<span class="${DIFF_CLASS[op]}">${op}${esc(l?.text)}</span>`;
        })
        .join('\n');
      return `<pre><code>${body}</code></pre>`;
    },
    md(block) {
      const lines = Array.isArray(block?.lines) ? block.lines : [];
      const body = lines.map((l) => `${diffOp(l?.op)}${String(l?.text ?? '')}`).join('\n');
      return fencedCode(body, 'diff');
    },
  },

  // { type:'pillRow', pills:[{ label:string, variant?:''|'ok'|'warn' }] }
  // A row of pill chips in the Gate Board BEM form: .pill / .pill--ok /
  // .pill--warn with an aria-hidden <i> dot (the label text carries the meaning).
  // `variant` is allowlisted (else bare). HTML escapes the label. Twin: a SINGLE
  // inert line of mdEsc'd labels (single-line => mdEsc is correct, and the blanket
  // no-raw-HTML twin assertion applies here, unlike code/diff).
  pillRow: {
    html(block) {
      const pills = Array.isArray(block?.pills) ? block.pills : [];
      const inner = pills
        .map((p) => {
          const variant = PILL_VARIANTS.has(p?.variant) ? ` pill--${p.variant}` : '';
          return `<span class="pill${variant}"><i aria-hidden="true"></i>${esc(p?.label)}</span>`;
        })
        .join('');
      return `<div class="pillrow">${inner}</div>`;
    },
    md(block) {
      const pills = Array.isArray(block?.pills) ? block.pills : [];
      // Static ` · ` separator + backticks I author; only the label is ledger-
      // derived, so only it needs mdEsc. Single line => never opens structure.
      return pills.map((p) => `\`${mdEsc(p?.label)}\``).join(' · ');
    },
  },

  // ---- Gate Board figure blocks ----

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

  // { type:'dotMatrix', columns:[string], rows:[{label, sub?, marks:[boolean]}] }
  // A11y (Task 4b hardening): the .mx grid carries ARIA table semantics —
  // role="table" / role="row" / role="columnheader" / role="rowheader" /
  // role="cell" — and every mark cell holds the aria-hidden dot PLUS a
  // visually-hidden `<span class="sr">yes|no</span>` so assistive tech hears
  // every mark (the yes/no literals are engine-authored, never ledger text).
  dotMatrix: {
    html(block) {
      const cols = Array.isArray(block?.columns) ? block.columns : [];
      const rows = Array.isArray(block?.rows) ? block.rows : [];
      const head = `<div class="mx__r mx__r--h" role="row"><span role="columnheader"></span>${cols.map((c) => `<span role="columnheader">${esc(c)}</span>`).join('')}</div>`;
      const body = rows.map((r) => {
        const marks = Array.isArray(r?.marks) ? r.marks : [];
        const dots = cols.map((_, i) => `<span class="mx__d${marks[i] ? '' : ' miss'}" role="cell"><i aria-hidden="true"></i><span class="sr">${marks[i] ? 'yes' : 'no'}</span></span>`).join('');
        return `<div class="mx__r" role="row"><span class="mx__f" role="rowheader">${esc(r?.label)}${r?.sub ? `<small>${esc(r.sub)}</small>` : ''}</span>${dots}</div>`;
      }).join('');
      return `<div class="matrix"><div class="scrollx"><div class="mx" role="table" style="--mxcols:${cols.length}">${head}${body}</div></div></div>`;
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
};

// The closed set — derived from the registry so it can never drift from BLOCKS.
const BLOCK_TYPES = Object.keys(BLOCKS);

// Prototype-safe registry lookup — the ONE gate both dispatchers ride. A plain
// BLOCKS[type] resolves inherited Object.prototype keys ('__proto__',
// 'constructor', 'toString') to truthy non-renderers, skipping the contractual
// unknown-block throw and escaping as a TypeError instead — which would break
// the CLI's sanitized unknown-block category and the sweep's classification.
// Object.hasOwn coerces any type value (undefined included) to a key string,
// so only a key the registry actually OWNS ever dispatches.
const blockDef = (type) => (Object.hasOwn(BLOCKS, type) ? BLOCKS[type] : null);

// Render per-slide blocks to HTML. Empty / non-array => ''. An unknown type
// THROWS (fail-closed — see file header).
function renderBlocks(blocks) {
  if (!Array.isArray(blocks) || blocks.length === 0) return '';
  return blocks
    .map((block) => {
      const def = blockDef(block?.type);
      if (!def) throw new Error('unknown block type: ' + block?.type);
      return def.html(block);
    })
    .filter(Boolean)
    .join('\n');
}

// Render per-slide blocks to the Markdown twin. Same contract as renderBlocks,
// including THROWING on an unknown type (twin parity — the twin must be no
// weaker than the HTML path).
function blocksToMarkdown(blocks) {
  if (!Array.isArray(blocks) || blocks.length === 0) return '';
  return blocks
    .map((block) => {
      const def = blockDef(block?.type);
      if (!def) throw new Error('unknown block type: ' + block?.type);
      return def.md(block);
    })
    .filter(Boolean)
    .join('\n\n'); // blank line between blocks so adjacent tables/lists never merge in Markdown
}

export { BLOCKS, BLOCK_TYPES, renderBlocks, blocksToMarkdown };
