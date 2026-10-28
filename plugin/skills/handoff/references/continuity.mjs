// A filesystem checkpoint, never an authorization or review decision engine.
import { readFileSync, writeFileSync, renameSync, unlinkSync, lstatSync, realpathSync, readlinkSync } from 'node:fs';
import { resolve, relative, isAbsolute, dirname, basename, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { scan } from '../../the-foreman/references/secret-scan.mjs';
import { isMain } from '../../the-foreman/references/is-main.mjs';

const START = '<!-- foreman-resume:start -->';
const END = '<!-- foreman-resume:end -->';
const LIMIT = 2 * 1024 * 1024;
const fail = (reason) => { const error = new Error(reason); error.continuityReason = reason; throw error; };
const object = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const text = (x) => typeof x === 'string' && x.trim().length > 0 && x.length <= 65536;
const requireThat = (ok, reason) => { if (!ok) fail(reason); };
const strings = (x) => Array.isArray(x) && x.every(text);
const hash = (x) => createHash('sha256').update(x).digest('hex');
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const safeRelative = (p) => text(p) && !isAbsolute(p) && !p.split(/[\\/]/).some((s) => s === '..' || s === '.' || s === '') && !p.includes('\0');
const refPath = (repo, p) => isAbsolute(p) ? p : resolve(repo, p);
const reference = (repo, p) => {
  const rel = relative(repo, resolve(p));
  return safeRelative(rel) ? rel : resolve(p);
};
const clean = (raw) => {
  const decoded = raw.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\(["\\/bfnrt])/g, (_, c) => ({ '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' }[c]));
  requireThat(scan(raw + '\n' + decoded).clean, 'fail-closed: secret or sensitive data detected');
};
const readText = (path) => {
  requireThat(lstatSync(path).isFile() && lstatSync(path).size <= LIMIT, 'expected a regular text file no larger than 2 MiB');
  const raw = readFileSync(path, 'utf8'); clean(raw); return raw;
};
const parse = (raw) => {
  let value;
  try { value = JSON.parse(raw); } catch { fail('malformed JSON'); }
  let nodes = 0;
  const visit = (v, depth) => {
    requireThat(++nodes <= 100000 && depth <= 30, 'JSON exceeds structural limits');
    if (v && typeof v === 'object') Object.values(v).forEach((child) => visit(child, depth + 1));
  };
  visit(value, 0); return value;
};
const provenance = (p) => requireThat(object(p) && ['claude', 'codex'].includes(p.host)
  && ['artifact', 'native', 'file-escalation'].includes(p.kind) && text(p.reference)
  && (p.kind !== 'file-escalation' || text(p.requestId)), 'malformed provenance');
const validateState = (s) => {
  requireThat(object(s) && ['initiativeId', 'stage', 'phase', 'nextAction'].every((k) => text(s[k]))
    && ['claude', 'codex'].includes(s.sourceHost), 'malformed required state fields');
  requireThat(object(s.scope) && strings(s.scope.approved) && s.scope.approved.length > 0
    && strings(s.scope.nonGoals) && strings(s.scope.neverStage) && s.scope.neverStage.every(safeRelative), 'malformed scope');
  requireThat(object(s.verification) && ['lastGreen', 'current'].every((k) => Object.hasOwn(s.verification, k)), 'malformed verification');
  for (const [kind, v] of Object.entries(s.verification)) {
    if (v === null) continue;
    requireThat(object(v) && text(v.command) && ['green', 'expected-red', 'failure', 'unverified'].includes(v.result)
      && (kind !== 'lastGreen' || v.result === 'green'), 'malformed verification result'); provenance(v.provenance);
  }
  requireThat(Array.isArray(s.authorizations), 'authorizations must be an array');
  for (const a of s.authorizations) {
    requireThat(object(a) && ['gate', 'scope', 'request'].every((k) => text(a[k]))
      && ['pending', 'granted', 'denied', 'consumed', 'revoked'].includes(a.status)
      && (a.status === 'pending' ? a.response === null : text(a.response)), 'malformed authorization claim');
    provenance(a.provenance);
  }
  requireThat(s.pendingGate === null || (object(s.pendingGate) && ['gate', 'request', 'scope'].every((k) => text(s.pendingGate[k]))), 'malformed pendingGate');
  requireThat(Array.isArray(s.workers) && s.workers.every((w) => object(w) && text(w.id)
    && ['completed', 'stopped', 'joined'].includes(w.status)), 'workers must be quiesced before capture');
  requireThat(strings(s.evidence) && s.evidence.every((p) => isAbsolute(p) || safeRelative(p)), 'evidence must use repository-relative or absolute file paths');
  if (s.review === undefined || s.review === null) return;
  const r = s.review;
  requireThat(object(r) && ['CODEX_GATE_RUNS', 'CODEX_GATE_SESSION', 'phaseId', 'phaseStartSnapshot', 'PHASE_HEAD'].every((k) => text(r[k]))
    && isAbsolute(r.CODEX_GATE_RUNS) && /^[a-f0-9]{40,64}$/.test(r.PHASE_HEAD) && r.phaseId === s.phase, 'malformed original review bindings');
  requireThat(r.verdict === null || object(r.verdict), 'review.verdict must be null or a claim');
  if (r.verdict !== null) {
    const v = r.verdict;
    requireThat(text(v.mode) && ['APPROVE', 'BLOCK', 'INFRA_ERROR', 'OVERFLOW', 'PENDING'].includes(v.outcome)
      && Number.isInteger(v.round) && v.round >= 1 && text(v.scope) && strings(v.evidence) && v.evidence.length > 0, 'malformed review verdict claim');
    provenance(v.provenance);
  }
};
const provenances = (s) => [...Object.values(s.verification).filter(Boolean).map((v) => v.provenance),
  ...s.authorizations.map((a) => a.provenance), ...(s.review?.verdict ? [s.review.verdict.provenance] : [])];
const evidencePaths = (s) => [...new Set([...s.evidence, ...provenances(s).map((p) => p.reference), ...(s.review?.verdict?.evidence ?? [])])].sort();
const validateReceipt = (repo, p) => {
  if (p.kind !== 'file-escalation') return;
  const receipt = parse(readText(refPath(repo, p.reference)));
  const req = receipt?.request; const result = receipt?.result;
  requireThat(object(receipt) && receipt.requestId === p.requestId && text(receipt.acceptedAt)
    && !Number.isNaN(Date.parse(receipt.acceptedAt)) && object(req) && req.requestId === p.requestId
    && text(req.gateId) && text(req.authorizes) && Array.isArray(req.questions) && req.questions.length > 0
    && object(result) && result.status === 'answered' && object(result.answers), 'malformed accepted escalation receipt');
  const ids = new Set(); let required = false;
  for (const q of req.questions) {
    requireThat(object(q) && text(q.id) && !ids.has(q.id) && text(q.prompt) && strings(q.options) && q.options.length > 0
      && (q.required === undefined || typeof q.required === 'boolean'), 'malformed escalation receipt question');
    ids.add(q.id); required ||= q.required !== false;
    requireThat((q.required === false && !Object.hasOwn(result.answers, q.id))
      || (Object.hasOwn(result.answers, q.id) && q.options.includes(result.answers[q.id])), 'malformed escalation receipt answer');
  }
  requireThat(required && Object.keys(result.answers).length > 0 && Object.keys(result.answers).every((id) => ids.has(id)), 'malformed escalation receipt answers');
  return receipt;
};
const validateReceipts = (repo, state) => {
  provenances(state).forEach((p) => validateReceipt(repo, p));
  for (const a of state.authorizations.filter((a) => a.provenance.kind === 'file-escalation')) {
    const receipt = validateReceipt(repo, a.provenance);
    requireThat(receipt.request.gateId === a.gate && receipt.request.authorizes === a.scope, 'escalation receipt gate or scope does not match authorization claim');
  }
};
const git = (repo, ...args) => {
  try { return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 32 * LIMIT, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } }); }
  catch { fail('cannot inspect Git repository'); }
};
const fingerprint = (path) => {
  let st;
  try { st = lstatSync(path); } catch (e) { if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return { kind: 'missing' }; throw e; }
  if (st.isSymbolicLink()) return { kind: 'symlink', sha256: hash(readlinkSync(path)) };
  requireThat(st.isFile(), 'unsupported non-file path in checkpoint');
  return { kind: 'file', sha256: hash(readFileSync(path)), executable: Boolean(st.mode & 0o111) };
};
const repository = (repo, exclusions) => {
  const root = realpathSync(git(repo, 'rev-parse', '--show-toplevel').trim());
  requireThat(root === realpathSync(repo), 'repository must name its checkout root');
  const index = new Map();
  for (const entry of git(root, 'ls-files', '--stage', '-z').split('\0').filter(Boolean)) {
    const tab = entry.indexOf('\t'); const path = entry.slice(tab + 1);
    const info = entry.slice(0, tab); requireThat(!info.startsWith('160000 '), 'submodule fingerprinting is unsupported');
    index.set(path, [...(index.get(path) ?? []), info]);
  }
  const paths = [...new Set([...index.keys(), ...git(root, 'ls-files', '--others', '--exclude-standard', '-z').split('\0').filter(Boolean)])].sort();
  requireThat(paths.length <= 50000, 'repository exceeds checkpoint file limit');
  const files = paths.filter((p) => !exclusions.includes(p)).map((path) => ({ path, index: index.get(path) ?? [], worktree: fingerprint(join(root, path)) }));
  return { root, head: git(root, 'rev-parse', 'HEAD').trim(), branch: git(root, 'rev-parse', '--abbrev-ref', 'HEAD').trim(),
    gitDir: realpathSync(git(root, 'rev-parse', '--absolute-git-dir').trim()), exclusions, files };
};
// Mirrors codex-gate.sh resolve_run_dir, sha1_short and sanitize_seg. Checking
// containment alone would let an incorrect session select another phase baseline.
const runtimeSnapshotPath = (repo, review) => {
  const root = git(repo, 'rev-parse', '--show-toplevel').replace(/\n+$/, '');
  const branch = git(repo, 'rev-parse', '--abbrev-ref', 'HEAD').replace(/\n+$/, '');
  const shortHash = createHash('sha1').update(root).digest('hex').slice(0, 12);
  const segment = (value) => value.replace(/[\/ :@~]/g, '_').replace(/[^A-Za-z0-9._-]/g, '');
  const worktree = !branch || branch === 'HEAD' ? 'wt-' + shortHash : segment(branch);
  return join(realpathSync(review.CODEX_GATE_RUNS), segment(basename(root)) + '-' + shortHash,
    worktree, segment(review.CODEX_GATE_SESSION), segment(review.phaseId), 'snapshot.json');
};
const snapshotPaths = (repo, state) => {
  if (!state.review) return [];
  const r = state.review; const manifestPath = refPath(repo, r.phaseStartSnapshot);
  const manifest = parse(readText(manifestPath));
  requireThat(object(manifest) && manifest.phaseHead === r.PHASE_HEAD && text(manifest.repoRoot)
    && Array.isArray(manifest.entries), 'malformed or mismatched original snapshot manifest');
  requireThat(realpathSync(manifest.repoRoot) === repo
    && safeRelative(relative(realpathSync(r.CODEX_GATE_RUNS), realpathSync(manifestPath))), 'snapshot must belong to recorded repository and original run root');
  requireThat(realpathSync(manifestPath) === runtimeSnapshotPath(repo, r), 'original snapshot does not match reviewer repository/branch/session/phase namespace');
  git(repo, 'cat-file', '-e', r.PHASE_HEAD + '^{commit}');
  const paths = [r.phaseStartSnapshot]; const seen = new Set();
  for (const e of manifest.entries) {
    requireThat(object(e) && safeRelative(e.path) && !seen.has(e.path) && ['snapshot', 'deleted'].includes(e.baselineKind), 'malformed snapshot entry');
    seen.add(e.path);
    const baseline = join(dirname(manifestPath), 'snapshot', e.path);
    const fp = fingerprint(baseline);
    requireThat(e.baselineKind === 'deleted' ? fp.kind === 'missing' : fp.kind === 'file', 'snapshot baseline missing or inconsistent');
    // Record deleted baseline absence too, so a later replacement is detected.
    paths.push(reference(repo, baseline));
  }
  return paths;
};
const collectEvidence = (repo, state, snapshots, exclusions) => {
  const required = evidencePaths(state);
  const paths = [...new Set([...required, ...snapshots])].sort();
  return paths.map((path) => {
    requireThat(!exclusions.includes(reference(repo, refPath(repo, path))), 'output and state input cannot be evidence');
    const identity = fingerprint(refPath(repo, path));
    requireThat(!required.includes(path) || identity.kind === 'file', 'required evidence is missing or not a regular file');
    return { path, identity };
  });
};
const block = (raw) => {
  const starts = raw.split(START).length - 1; const ends = raw.split(END).length - 1;
  if (starts === 0 && ends === 0) return null;
  requireThat(starts === 1 && ends === 1 && raw.indexOf(START) < raw.indexOf(END), 'malformed or duplicate resume block');
  const cp = parse(raw.slice(raw.indexOf(START) + START.length, raw.indexOf(END)).trim());
  requireThat(object(cp) && cp.version === 1, 'unsupported or missing checkpoint version');
  validateState(cp.state);
  requireThat(text(cp.capturedAt) && object(cp.repository) && strings(cp.repository.exclusions) && Array.isArray(cp.repository.files)
    && ['root', 'head', 'branch', 'gitDir'].every((k) => text(cp.repository[k]))
    && object(cp.artifacts) && text(cp.artifacts.state) && text(cp.artifacts.handoff)
    && Array.isArray(cp.evidence) && strings(cp.snapshotPaths), 'malformed checkpoint fingerprints');
  const expectedExclusions = [cp.artifacts.state, cp.artifacts.handoff].filter(safeRelative).sort();
  requireThat(equal(cp.repository.exclusions, [...new Set(expectedExclusions)]), 'invalid checkpoint exclusions');
  const identity = (f) => object(f) && (f.kind === 'missing' || (['file', 'symlink'].includes(f.kind)
    && /^[a-f0-9]{64}$/.test(f.sha256) && (f.kind !== 'file' || typeof f.executable === 'boolean')));
  requireThat(cp.repository.files.every((f) => object(f) && safeRelative(f.path) && strings(f.index) && identity(f.worktree))
    && new Set(cp.repository.files.map((f) => f.path)).size === cp.repository.files.length
    && cp.evidence.every((e) => object(e) && text(e.path) && identity(e.identity))
    && new Set(cp.evidence.map((e) => e.path)).size === cp.evidence.length, 'malformed checkpoint file identity');
  const required = [...new Set([...evidencePaths(cp.state), ...cp.snapshotPaths])].sort();
  requireThat(equal(cp.evidence.map((e) => e.path).sort(), required), 'incomplete checkpoint evidence inventory');
  requireThat(cp.evidence.filter((e) => evidencePaths(cp.state).includes(e.path) || e.path === cp.state.review?.phaseStartSnapshot)
    .every((e) => e.identity.kind === 'file'), 'required evidence must have an existing regular-file fingerprint');
  return cp;
};

export const capture = (repoPath, statePath, handoffPath) => {
  // Canonicalize existing artifacts as well as the root: /var and /private/var
  // (and /tmp aliases) must not turn the two exact exclusions into external paths.
  const repo = realpathSync(repoPath); const stateFile = realpathSync(statePath); const handoff = realpathSync(handoffPath);
  requireThat(stateFile !== handoff, 'state and handoff must be different files');
  const stateRaw = readText(stateFile); const prose = readText(handoff);
  const previous = block(prose); // Never silently replace malformed versioned data.
  const state = parse(stateRaw); validateState(state);
  validateReceipts(repo, state);
  const artifacts = { state: reference(repo, stateFile), handoff: reference(repo, handoff) };
  const exclusions = [...new Set(Object.values(artifacts).filter(safeRelative))].sort();
  const snapshots = snapshotPaths(repo, state);
  const cp = { version: 1, capturedAt: new Date().toISOString(), state, artifacts,
    repository: repository(repo, exclusions), snapshotPaths: snapshots,
    evidence: collectEvidence(repo, state, snapshots, exclusions) };
  if (previous?.state.review && previous.state.initiativeId === state.initiativeId && previous.state.phase === state.phase) {
    const bindings = (r) => r && Object.fromEntries(['CODEX_GATE_RUNS', 'CODEX_GATE_SESSION', 'phaseId', 'phaseStartSnapshot', 'PHASE_HEAD'].map((k) => [k, r[k]]));
    requireThat(equal(bindings(previous.state.review), bindings(state.review)) && equal(previous.snapshotPaths, snapshots)
      && previous.evidence.filter((e) => previous.snapshotPaths.includes(e.path)).every((e) => equal(fingerprint(refPath(repo, e.path)), e.identity)),
    'original phase review bindings or baseline changed; restore original snapshot before recapture');
  }
  const serialized = JSON.stringify(cp, null, 2); clean(serialized);
  const rendered = START + '\n' + serialized + '\n' + END;
  const output = prose.includes(START) ? prose.slice(0, prose.indexOf(START)) + rendered + prose.slice(prose.indexOf(END) + END.length)
    : prose + (prose.endsWith('\n') ? '\n' : '\n\n') + rendered + '\n';
  clean(output); requireThat(Buffer.byteLength(output) <= LIMIT, 'checkpoint exceeds 2 MiB');
  requireThat(readText(stateFile) === stateRaw && readText(handoff) === prose
    && equal(repository(repo, exclusions), cp.repository)
    && equal(collectEvidence(repo, state, snapshots, exclusions), cp.evidence), 'files changed during capture; quiesce writers');
  const temp = join(dirname(handoff), '.foreman-resume-' + randomUUID());
  try { writeFileSync(temp, output, { flag: 'wx', mode: lstatSync(handoff).mode }); renameSync(temp, handoff); }
  finally { try { unlinkSync(temp); } catch (e) { if (e.code !== 'ENOENT') throw e; } }
  return { status: 'captured', version: 1 };
};

export const check = (handoffPath, repoPath) => {
  let cp;
  try { cp = block(readText(resolve(handoffPath))); }
  catch (e) { return { status: 'invalid', reason: e.continuityReason ?? 'handoff unavailable' }; }
  if (!cp) return { status: 'legacy', reason: 'no versioned resume block; evidence and permissions remain unverified' };
  const issues = [];
  const add = (kind, reason, path) => issues.push({ kind, reason, ...(path ? { path } : {}) });
  let repo;
  try { repo = realpathSync(repoPath ?? cp.repository.root); }
  catch { return { status: 'missing', issues: [{ kind: 'missing', reason: 'repository unavailable' }] }; }
  if (repo !== cp.repository.root) add('changed', 'checkout relocated; original reviewer namespace requires reconciliation');
  if (reference(repo, realpathSync(handoffPath)) !== cp.artifacts.handoff) add('changed', 'handoff path changed');
  try { if (!equal(repository(repo, cp.repository.exclusions), cp.repository)) add('changed', 'repository HEAD, branch, index or worktree changed'); }
  catch { add('missing', 'repository cannot be inspected'); }
  for (const e of cp.evidence) {
    try {
      const current = fingerprint(refPath(repo, e.path));
      if (!equal(current, e.identity)) add(current.kind === 'missing' ? 'missing' : 'changed', 'referenced evidence or snapshot baseline differs', e.path);
    } catch { add('missing', 'referenced evidence cannot be inspected', e.path); }
  }
  try { requireThat(equal(snapshotPaths(repo, cp.state), cp.snapshotPaths), 'snapshot inventory changed'); }
  catch { add('missing', 'original snapshot incomplete, unavailable or inconsistent'); }
  try { validateReceipts(repo, cp.state); }
  catch { add('invalid', 'accepted escalation receipt is unavailable or malformed'); }
  const status = ['invalid', 'missing', 'changed'].find((s) => issues.some((i) => i.kind === s)) ?? 'validated';
  return { status, version: 1, issues, pendingGate: cp.state.pendingGate,
    pendingAuthorizations: cp.state.authorizations.filter((a) => a.status === 'pending').length,
    authority: 'not-adjudicated', verification: 'recorded-only' };
};

if (isMain(import.meta.url)) {
  const [cmd, ...args] = process.argv.slice(2);
  try {
    requireThat((cmd === 'capture' && args.length === 3) || (cmd === 'check' && [1, 2].includes(args.length)), 'usage: continuity.mjs capture <repo> <state.json> <handoff.md> | check <handoff.md> [repo]');
    const result = cmd === 'capture' ? capture(...args) : check(...args);
    console.log(JSON.stringify(result));
    process.exitCode = ['captured', 'validated'].includes(result.status) ? 0 : result.status === 'invalid' ? 2 : 1;
  } catch (e) {
    console.log(JSON.stringify({ status: 'invalid', reason: e.continuityReason ?? 'capture/check failed: required file or repository unavailable' }));
    process.exitCode = 2;
  }
}
