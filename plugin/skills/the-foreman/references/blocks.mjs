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

// Phase-step status allowlist + per-status HTML marker. Anything else (incl. an
// injection smuggled through `status`) is coerced to 'pending'. The markers are
// static literals I author — never ledger text — so they're safe to emit raw.
const PHASE_STATUSES = new Set(['done', 'active', 'pending']);
const PHASE_MARKER = { done: '✓', active: '▸', pending: '○' };
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
      const thead = `<thead><tr>${columns.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead>`;
      const tbody = `<tbody>${rows
        .map((r) => `<tr>${normalizeRow(r, width).map((cell) => `<td>${esc(cell)}</td>`).join('')}</tr>`)
        .join('')}</tbody>`;
      return `<div class="scroll"><table>${caption}${thead}${tbody}</table></div>`;
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
  // SVG safety contract (donut/bar/lineSpark): inline <svg> only, with
  // <circle>/<rect>/<line>/<polyline>/<text>/<g> + LITERAL geometry and
  // var(--…) colors. NONE of href/xlink:href/<image>/<use>/<foreignObject>/
  // url(...)/style-url/http(s). Labels go through esc(); EVERY number through
  // safeNum() BEFORE it reaches an attribute. role="img" + an esc'd aria-label.

  // { type:'statRow', stats:[{ value:string, label:string, variant?:''|'ok'|'warn' }] }
  // A row of big-number stat blocks (HTML only — NOT a chart). `value` is a
  // pre-formatted DISPLAY string ("$0.12", "70/70"); both value + label escaped.
  statRow: {
    html(block) {
      const stats = Array.isArray(block?.stats) ? block.stats : [];
      return `<div class="statrow">${stats
        .map((s) => {
          const variant = STAT_VARIANTS.has(s?.variant) ? ` ${s.variant}` : '';
          return `<div class="stat${variant}"><span class="stat-value">${esc(s?.value)}</span><span class="stat-label">${esc(s?.label)}</span></div>`;
        })
        .join('')}</div>`;
    },
    md(block) {
      const stats = Array.isArray(block?.stats) ? block.stats : [];
      return stats.map((s) => `- **${mdEsc(s?.value)}** — ${mdEsc(s?.label)}`).join('\n');
    },
  },

  // { type:'donut', value:number, max?:number (default 100), label?:string }
  // A ring: a full-circle track + an arc drawn via stroke-dasharray for
  // safeNum(value,{min:0,max})/max. Centered text shows the COMPUTED percentage
  // (not ledger text) + an optional esc'd label.
  donut: {
    html(block) {
      const max = safeNum(block?.max ?? 100, { min: 0, fallback: 100 });
      const value = safeNum(block?.value, { min: 0, max: max > 0 ? max : 0, fallback: 0 });
      const pct = max > 0 ? Math.round((value / max) * 100) : 0;
      // geometry: a 120x120 viewBox, r=52, stroke=12 (fits inside the box).
      const r = 52;
      const circ = round(2 * Math.PI * r); // circumference (literal-ish; derived from a literal r)
      const arc = max > 0 ? round((value / max) * circ) : 0; // <= circ by construction
      const label = block?.label ? `<text x="60" y="78" text-anchor="middle" class="donut-label">${esc(block.label)}</text>` : '';
      const aria = esc(`${pct}%${block?.label ? ` ${block.label}` : ''}`);
      return `<div class="donutwrap"><svg viewBox="0 0 120 120" width="120" height="120" role="img" aria-label="${aria}">`
        + `<circle cx="60" cy="60" r="${r}" fill="none" stroke="var(--line)" stroke-width="12"/>`
        + `<circle cx="60" cy="60" r="${r}" fill="none" stroke="var(--accent)" stroke-width="12" stroke-linecap="round" stroke-dasharray="${arc} ${circ}" transform="rotate(-90 60 60)"/>`
        + `<text x="60" y="${block?.label ? 58 : 66}" text-anchor="middle" class="donut-pct">${pct}%</text>`
        + `${label}</svg></div>`;
    },
    md(block) {
      const max = safeNum(block?.max ?? 100, { min: 0, fallback: 100 });
      const value = safeNum(block?.value, { min: 0, max: max > 0 ? max : 0, fallback: 0 });
      const pct = max > 0 ? Math.round((value / max) * 100) : 0;
      const label = block?.label ? ` — ${mdEsc(block.label)}` : '';
      return `**${pct}%**${label}`;
    },
  },

  // { type:'bar', bars:[{ label:string, value:number }], max?:number }
  // Horizontal bars; width ∝ safeNum(value,{min:0}) / (max || largest value || 1).
  bar: {
    html(block) {
      const bars = Array.isArray(block?.bars) ? block.bars : [];
      const values = bars.map((b) => safeNum(b?.value, { min: 0 }));
      const declaredMax = block?.max != null ? safeNum(block.max, { min: 0 }) : 0;
      const largest = values.reduce((m, v) => (v > m ? v : m), 0);
      const denom = declaredMax > 0 ? declaredMax : largest > 0 ? largest : 1; // never 0
      // layout: a 320-wide viewBox; the track for each bar is TRACK wide.
      const TRACK = 100; // bar fills 0..TRACK user-units (the test pins this)
      const labelW = 96;
      const rowH = 26;
      const W = labelW + TRACK + 80; // room for the value text after the bar
      const H = Math.max(rowH, bars.length * rowH);
      const aria = esc(`bar chart, ${bars.length} bar${bars.length === 1 ? '' : 's'}`);
      const rows = bars
        .map((b, i) => {
          const v = values[i];
          const w = round(Math.min(TRACK, (v / denom) * TRACK)); // clamped <= TRACK
          const y = i * rowH;
          const cy = round(y + rowH / 2);
          // Display the SAFE numeric value — never the raw ledger value (which
          // could be "NaN"/"Infinity"). esc() is belt-and-suspenders over a number.
          return `<text x="0" y="${round(cy + 4)}" class="bar-label">${esc(b?.label)}</text>`
            + `<rect x="${labelW}" y="${round(y + 5)}" width="${TRACK}" height="14" rx="4" fill="var(--line)"/>`
            + `<rect x="${labelW}" y="${round(y + 5)}" width="${w}" height="14" rx="4" fill="var(--accent)"/>`
            + `<text x="${labelW + TRACK + 8}" y="${round(cy + 4)}" class="bar-value">${esc(v)}</text>`;
        })
        .join('');
      return `<div class="barwrap"><svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${aria}">${rows}</svg></div>`;
    },
    md(block) {
      const bars = Array.isArray(block?.bars) ? block.bars : [];
      // safeNum the value so the twin never emits "NaN"/"Infinity" either.
      return bars.map((b) => `- ${mdEsc(b?.label)}: ${mdEsc(safeNum(b?.value, { min: 0 }))}`).join('\n');
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
  // Phase-progression chips. `status` is allowlisted (default/unknown => pending)
  // and only ever indexes the static marker maps + emits an allowlisted class.
  // Optional `detail` renders a muted sub-line under the label (HTML: a .phase-detail
  // <span>; twin: ` — detail` after the label). Absent detail => byte-identical to before.
  phaseSteps: {
    html(block) {
      const steps = Array.isArray(block?.steps) ? block.steps : [];
      const chips = steps
        .map((s) => {
          const status = phaseStatus(s?.status); // always one of the allowlist
          const detail = s?.detail != null && s.detail !== '' ? `<span class="phase-detail">${esc(s.detail)}</span>` : '';
          return `<span class="phasestep ${status}"><span class="phase-mark">${PHASE_MARKER[status]}</span>${esc(s?.label)}${detail}</span>`;
        })
        .join('');
      return `<div class="phaseflow">${chips}</div>`;
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
  // A row of pill chips reusing the EXISTING .pill / .pill.ok / .pill.warn styles.
  // `variant` is allowlisted (else bare). HTML escapes the label. Twin: a SINGLE
  // inert line of mdEsc'd labels (single-line => mdEsc is correct, and the blanket
  // no-raw-HTML twin assertion applies here, unlike code/diff).
  pillRow: {
    html(block) {
      const pills = Array.isArray(block?.pills) ? block.pills : [];
      const inner = pills
        .map((p) => {
          const variant = PILL_VARIANTS.has(p?.variant) ? ` ${p.variant}` : '';
          return `<span class="pill${variant}">${esc(p?.label)}</span>`;
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
  dotMatrix: {
    html(block) {
      const cols = Array.isArray(block?.columns) ? block.columns : [];
      const rows = Array.isArray(block?.rows) ? block.rows : [];
      const head = `<div class="mx__r mx__r--h"><span></span>${cols.map((c) => `<span>${esc(c)}</span>`).join('')}</div>`;
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
};

// The closed set — derived from the registry so it can never drift from BLOCKS.
const BLOCK_TYPES = Object.keys(BLOCKS);

// Render per-slide blocks to HTML. Empty / non-array => ''. An unknown type
// THROWS (fail-closed — see file header).
function renderBlocks(blocks) {
  if (!Array.isArray(blocks) || blocks.length === 0) return '';
  return blocks
    .map((block) => {
      const def = BLOCKS[block?.type];
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
      const def = BLOCKS[block?.type];
      if (!def) throw new Error('unknown block type: ' + block?.type);
      return def.md(block);
    })
    .filter(Boolean)
    .join('\n\n'); // blank line between blocks so adjacent tables/lists never merge in Markdown
}

export { BLOCKS, BLOCK_TYPES, renderBlocks, blocksToMarkdown };
