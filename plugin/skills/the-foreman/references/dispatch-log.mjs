// the-foreman dispatch telemetry (ADR-007, references/decisions.md). One JSONL line per COMPLETED
// dispatch — appended when the worker RETURNS, so the outcome is known and no correlation ids are
// needed (a redo = two lines: attempt 1 outcome:"redo", attempt 2 outcome:"ok"). `stats` aggregates
// redo/escalation rates per tier × task-shape; those rates — not vibes — tune the §8 mapping.
// Fail-closed: an invalid entry writes NOTHING and exits non-zero.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { isMain } from './is-main.mjs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

// Durable enums (task shapes/tiers outlive model names); `model` is deliberately free-form —
// names change, which is exactly why §8 maps shapes → tiers and only then tiers → current names.
export const TIERS = ['fast', 'standard', 'deep'];
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
export const OUTCOMES = ['ok', 'redo', 'escalated', 'failed'];

export const defaultLogPath = () =>
  process.env.FOREMAN_DISPATCH_LOG ?? join(homedir(), '.claude', 'the-foreman', 'dispatch-log.jsonl');

export function validateEntry(e) {
  if (!e || typeof e !== 'object' || Array.isArray(e)) return { ok: false, errors: ['entry must be a JSON object'] };
  const errors = [];
  for (const k of ['session', 'shape', 'why']) {
    if (typeof e[k] !== 'string' || !e[k].trim()) errors.push(`${k}: required non-empty string`);
  }
  if (!TIERS.includes(e.tier)) errors.push(`tier: one of ${TIERS.join('|')}`);
  if (typeof e.model !== 'string' || !e.model.trim()) errors.push('model: required non-empty string');
  if (!EFFORTS.includes(e.effort)) errors.push(`effort: one of ${EFFORTS.join('|')}`);
  if (!OUTCOMES.includes(e.outcome)) errors.push(`outcome: one of ${OUTCOMES.join('|')}`);
  for (const k of ['phase', 'notes']) {
    if (e[k] !== undefined && typeof e[k] !== 'string') errors.push(`${k}: string when present`);
  }
  return { ok: errors.length === 0, errors };
}

export function stamp(entry, now = new Date()) {
  return { ts: now.toISOString(), ...entry };
}

export function appendEntry(entry, path = defaultLogPath(), now = new Date()) {
  const { ok, errors } = validateEntry(entry);
  if (!ok) throw new Error(`invalid dispatch entry: ${errors.join('; ')}`);
  mkdirSync(dirname(path), { recursive: true });
  const line = JSON.stringify(stamp(entry, now));
  appendFileSync(path, line + '\n');
  return line;
}

export function readEntries(path = defaultLogPath()) {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter((e) => e && validateEntry(e).ok);
}

const bucket = () => ({ n: 0, ok: 0, redo: 0, escalated: 0, failed: 0 });
// nonGreenRate = (redo + escalated + failed) / n — the "this tier needed help" signal per cell.
export function stats(entries) {
  const byTier = {}, byShape = {}, byCell = {};
  for (const e of entries) {
    for (const [map, key] of [[byTier, e.tier], [byShape, e.shape], [byCell, `${e.tier} × ${e.shape}`]]) {
      map[key] ??= bucket();
      map[key].n += 1;
      map[key][e.outcome] += 1;
    }
  }
  const finish = (map) => {
    for (const b of Object.values(map)) b.nonGreenRate = b.n ? +((b.redo + b.escalated + b.failed) / b.n).toFixed(2) : 0;
    return map;
  };
  return { total: entries.length, byTier: finish(byTier), byShape: finish(byShape), byCell: finish(byCell) };
}

export function formatStats(s) {
  const section = (title, map) => [
    `-- ${title} --`,
    ...Object.entries(map)
      .sort(([, a], [, b]) => b.nonGreenRate - a.nonGreenRate)
      .map(([k, b]) => `${k.padEnd(34)} n=${String(b.n).padEnd(4)} ok=${String(b.ok).padEnd(4)} redo=${String(b.redo).padEnd(3)} esc=${String(b.escalated).padEnd(3)} fail=${String(b.failed).padEnd(3)} non-green=${b.nonGreenRate}`),
  ];
  return [
    `dispatches: ${s.total}`,
    ...section('by tier', s.byTier),
    ...section('by shape', s.byShape),
    ...section('by tier × shape', s.byCell),
  ].join('\n');
}

// CLI: append '<json>'  |  stats [--json]
if (isMain(import.meta.url)) {
  const [cmd, arg] = process.argv.slice(2);
  try {
    if (cmd === 'append') {
      const line = appendEntry(JSON.parse(arg ?? ''));
      console.log(line);
    } else if (cmd === 'stats') {
      const s = stats(readEntries());
      console.log(arg === '--json' ? JSON.stringify(s, null, 2) : formatStats(s));
    } else {
      console.error("usage: dispatch-log.mjs append '<json>' | stats [--json]");
      process.exit(2);
    }
  } catch (err) {
    console.error(String(err?.message ?? err));
    process.exit(1);
  }
}
