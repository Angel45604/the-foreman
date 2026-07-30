// the-foreman — file-based ASYNC escalation: the FALLBACK decision channel for a hard gate when
// `AskUserQuestion` is unavailable (subagents, headless/SDK). FALLBACK-ONLY (ADR-006): the agent
// renders+surfaces the artifact FIRST and creates a request ONLY when AskUserQuestion is absent; it
// never advances without a validated read-once response. No external deps; requestId/createdAt are
// injected into the pure builder (the CLI supplies them) so the module is deterministic + testable.

import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import { isMain } from './is-main.mjs';
import { join } from 'node:path';
import { scan } from './secret-scan.mjs';

const SAFE_ID = /^[A-Za-z0-9_-]+$/; // requestId must be path-safe (no separators) — it names the files
function assertSafeId(id) {
  if (!id || typeof id !== 'string' || !SAFE_ID.test(id))
    throw new Error('escalation: requestId must match [A-Za-z0-9_-]+ (no path separators)');
}

// Resolve ALL standard JSON string escapes in the RAW text — \uXXXX AND the single-char escapes
// (\" \\ \/ \b \f \n \r \t) — so a secret hidden behind ANY escape (e.g. a db-url written
// `postgres:\/\/user:pass@…`, or \u-encoded chars) is unmasked for the scan, WITHOUT going through
// JSON.parse (which drops duplicate keys and would lose a secret stashed in a dropped occurrence).
// Over-resolving is harmless here — it only makes the fail-closed scan MORE eager, never less. Scanning
// raw + this catches literal, escaped (\u and \/-style), and duplicate-key (incl. escaped-in-a-dropped-key) secrets.
const resolveJsonEscapes = (s) =>
  String(s)
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\(["\\/bfnrt])/g, (_, c) => ({ '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' }[c]));

// The ONE request-shape validator (throws; returns the normalized request). Used by buildRequest,
// writeRequest (before persisting), AND checkResponse (on the persisted request) — so a raw/tampered
// request can never be built, written, OR later accepted; every path fails closed. `questions`:
// [{ id, prompt, options:[ids], required=true }] — one independent decision each; ≥1 must be required.
function normalizeRequest(input = {}) {
  const { requestId, gateId, questions = [], authorizes = '',
          artifactHtmlPath = null, artifactMdPath = null, createdAt = null } = input ?? {};
  if (!requestId) throw new Error('escalation: requestId is required');
  assertSafeId(requestId);
  if (!gateId) throw new Error('escalation: gateId is required');
  if (!Array.isArray(questions) || questions.length === 0) throw new Error('escalation: at least one question is required');
  const norm = questions.map((q, i) => {
    if (!q || typeof q.id !== 'string' || !q.id) throw new Error(`escalation: question[${i}] needs a string id`);
    if (!Array.isArray(q.options) || q.options.length === 0 || !q.options.every((o) => typeof o === 'string' && o.length))
      throw new Error(`escalation: question '${q.id}' needs non-empty string options`);
    return { id: q.id, prompt: q.prompt ?? '', options: [...q.options], required: q.required !== false };
  });
  const ids = norm.map((q) => q.id);
  if (new Set(ids).size !== ids.length) throw new Error('escalation: question ids must be unique');
  if (!norm.some((q) => q.required)) throw new Error('escalation: at least one question must be required (never advance on an empty decision)');
  return { requestId, gateId, questions: norm, authorizes, artifactHtmlPath, artifactMdPath, createdAt };
}

export function buildRequest(input = {}) { return normalizeRequest(input); }

const reqPath = (dir, id) => join(dir, 'escalations', `${id}.request.json`);
const resPath = (dir, id) => join(dir, 'escalations', `${id}.response.json`);

export async function writeRequest(dir, request) {
  const valid = normalizeRequest(request); // re-validate the FULL shape even if it bypassed buildRequest — before any fs
  const json = JSON.stringify(valid, null, 2);
  const r = scan(json); // FAIL-CLOSED before any write (ADR-003/006)
  if (!r.clean) throw new Error(`fail-closed: escalation request contains ${r.hits.map((h) => h.category).join(', ')}`);
  await mkdir(join(dir, 'escalations'), { recursive: true });
  const p = reqPath(dir, valid.requestId);
  await writeFile(p, json, 'utf8');
  return p;
}

// Read-once: { status:'pending' } | { status:'invalid', reason } | { status:'answered', answers:{qid:optId} }.
export async function checkResponse(dir, requestId) {
  if (!requestId || typeof requestId !== 'string' || !SAFE_ID.test(requestId)) // before ANY fs access
    return { status: 'invalid', reason: 'unsafe requestId' };
  let rawReq;
  try { rawReq = await readFile(reqPath(dir, requestId), 'utf8'); }
  catch { return { status: 'invalid', reason: 'unknown request' }; }
  let parsedReq;
  try { parsedReq = JSON.parse(rawReq); } catch { return { status: 'invalid', reason: 'malformed persisted request' }; }
  // fail-closed READ-path scan over BOTH the raw text AND its JSON-escape-resolved form: raw catches a
  // literal secret (incl. one in a dropped DUPLICATE key); resolveJsonEscapes unmasks \u/\/-escaped ones
  // (without JSON.parse, which would drop duplicate keys). A planted/tampered file bypassed writeRequest's scan. Categories only.
  const sreq = scan(rawReq + '\n' + resolveJsonEscapes(rawReq));
  if (!sreq.clean) return { status: 'invalid', reason: `fail-closed: persisted request contains ${sreq.hits.map((h) => h.category).join(', ')}` };
  let request;
  try { request = normalizeRequest(parsedReq); }
  catch { return { status: 'invalid', reason: 'malformed persisted request' }; }
  if (request.requestId !== requestId) return { status: 'invalid', reason: 'persisted request id mismatch (tampered/stale)' };
  let raw;
  try { raw = await readFile(resPath(dir, requestId), 'utf8'); }
  catch { return { status: 'pending' }; }
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return { status: 'invalid', reason: 'response is not valid JSON' }; }
  // fail-closed scan of the externally-written response over BOTH raw (literal / dropped-duplicate-key
  // secrets) AND its JSON-escape-resolved form (\u/\/-escaped ones). Categories only — never echo the value.
  const sres = scan(raw + '\n' + resolveJsonEscapes(raw));
  if (!sres.clean) return { status: 'invalid', reason: `fail-closed: response contains ${sres.hits.map((h) => h.category).join(', ')}` };
  if (parsed.requestId !== requestId) return { status: 'invalid', reason: 'response requestId mismatch' };
  const answers = parsed.answers;
  if (!answers || typeof answers !== 'object' || Array.isArray(answers))
    return { status: 'invalid', reason: 'answers must be an object keyed by question id' };
  if (Object.keys(answers).length === 0) return { status: 'invalid', reason: 'no answer provided' };
  const byId = new Map(request.questions.map((q) => [q.id, q]));
  for (const qid of Object.keys(answers))
    if (!byId.has(qid)) return { status: 'invalid', reason: 'response contains an unknown question id' }; // do not echo the untrusted key
  for (const q of request.questions) {
    if (!Object.prototype.hasOwnProperty.call(answers, q.id)) { // OWN key only — never a prototype prop (e.g. 'constructor')
      if (q.required) return { status: 'invalid', reason: `missing required answer: ${q.id}` };
      continue;
    }
    if (!q.options.includes(answers[q.id])) return { status: 'invalid', reason: `answer for '${q.id}' is not one of its allowed options` }; // q.id is request-side/safe; never echo the untrusted value
  }
  await unlink(resPath(dir, requestId)); // read-once
  return { status: 'answered', answers };
}

// CLI: request <dir> <gateId> '<questionsJson>' "<authorizes>" [htmlPath] [mdPath] | check <dir> <requestId>
if (isMain(import.meta.url)) {
  const [cmd, ...rest] = process.argv.slice(2);
  (async () => {
    if (cmd === 'request') {
      const [dir, gateId, questionsJson, authorizes, htmlPath, mdPath] = rest;
      const { randomUUID } = await import('node:crypto');
      const request = buildRequest({ requestId: randomUUID(), gateId,
        questions: JSON.parse(questionsJson || '[]'), authorizes: authorizes ?? '',
        artifactHtmlPath: htmlPath ?? null, artifactMdPath: mdPath ?? null,
        createdAt: new Date().toISOString() });
      console.log(JSON.stringify({ requestId: request.requestId, requestPath: await writeRequest(dir, request) }));
    } else if (cmd === 'check') {
      const [dir, requestId] = rest;
      console.log(JSON.stringify(await checkResponse(dir, requestId)));
    } else {
      console.error("usage: escalation.mjs request <dir> <gateId> '<questionsJson>' <authorizes> [html] [md] | check <dir> <requestId>");
      process.exit(2);
    }
  })().catch((e) => { console.error(String(e.message || e)); process.exit(1); });
}
