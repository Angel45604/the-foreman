// Fixture materialization for the eval harness (evals/run-evals.mjs), and nothing else.
//
// materialize(files, destDir, srcRoot) copies each declared relative path from srcRoot into
// destDir and records { rel, sha256, kind } for every copy, plus the resolved `root` it used (see
// verifyUnchanged below for why that value is handed back rather than left for a caller to
// recompute separately). Containment is enforced CHECK-THEN-USE, not held across a descriptor:
// checkSource resolves the source with realpathSync and requires it inside realpathSync(srcRoot),
// then lstats it for the type rule, and materialize itself re-resolves the same path a THIRD time
// via readFileSync. No file descriptor is held open across those lookups and nothing opens with
// O_NOFOLLOW, so this holds against a symlink planted BEFORE materialize runs but NOT against one
// planted CONCURRENTLY with it: a flipper that swaps a path from a regular file to an outside
// symlink between the realpath check and the read can still be followed and its bytes copied. The
// stronger property (immune to a concurrent flip) needs descriptor-based opens, meaning open the
// path once, fstat the descriptor, and read from the descriptor, instead of the repeated path resolution
// this module uses; that rewrite is out of scope here, since the harness materializes fully before
// the executor starts and has no concurrent writer during that window. Source and destination use
// DIFFERENT containment algorithms on purpose: the source already exists, so it can be
// realpath-resolved and checked before anything else runs; the destination does not exist yet
// (materialize is what creates it), so it is checked lexically first, then its parent chain is
// walked and realpath-checked only for the directories that already exist, and finally the leaf
// itself is refused if it is already a symlink.
//
// verifyUnchanged(entries, srcRoot, anchor = null) re-hashes those same originals afterward and
// reports drift. It also re-resolves each original with realpathSync and requires the result inside
// realpathSync(srcRoot) before ever hashing it, so a redirection upstream of the leaf (for example
// the original's PARENT directory replaced with a symlink into an outside directory) counts as drift
// too, even when the leaf itself still lstats as a plain file and the bytes it holds happen to match
// the original. A failed containment check, or a realpath call that throws (a dangling link, a
// removed parent), counts as drift, never as a thrown error.
//
// THE ROOT ITSELF IS RESOLVED FRESH ON EVERY CALL, not cached from some earlier resolution, which
// used to mean srcRoot's own identity was trusted rather than verified: if srcRoot were replaced
// wholesale (the directory deleted, or swapped for a symlink into a different directory entirely,
// even one holding byte-for-byte identical files at the same relative paths), the fresh resolution
// would happily follow the new target and every entry would compare clean against it, because the
// containment check above only ever asks "is this entry inside whatever srcRoot resolves to RIGHT
// NOW", never "does srcRoot still point where it originally did". The optional third argument closes
// that gap: anchor is the canonical root an earlier call (materialize's returned `root`) already
// resolved, treated here as IMMUTABLE. When anchor is supplied, verifyUnchanged resolves the given
// srcRoot with realpathSync inside a try and requires the result to equal anchor EXACTLY before
// checking any entry; a root that no longer resolves (deleted, a dangling link) or that resolves to
// a different path than the anchor (replaced, symlinked elsewhere) makes EVERY entry drift
// immediately, without ever touching the filesystem beneath it, and never throws for either case.
// When anchor is omitted (the default, kept so existing callers and tests are unaffected), there is
// no independently-captured value to compare against, so a root swapped for a symlink before the
// call cannot be detected that way (there is nothing to detect it AGAINST); what the default still
// guarantees is that a root which no longer resolves at all is reported as total drift rather than
// thrown, the same as the anchored path. Callers that hold the resolved root materialize returned
// should pass it as anchor (see run-evals.mjs's executeEval, which verifies against fx.root already
// and should hand that same value as the third argument too) to get the full guarantee; a caller that
// cannot yet do that still gets the non-throwing behavior for a missing root.
//
// HONEST LIMIT, stated here rather than left for a future reader to assume something stronger:
// verifyUnchanged is a single post-run comparison over a fixed srcRoot argument, and nothing pins
// that argument to the root materialize actually resolved, which is why materialize returns that
// resolved root as `root`: a caller (see run-evals.mjs's executeEval) should verify against THAT
// value, not against a separately configured constant that could drift out of sync with it. Beyond
// containment, the check proves FINAL byte drift at the leaf plus a LEAF-level type change (a
// symlink swapped in for the original file itself counts as drift even when it points at
// byte-identical content, because materialize only ever hands out regular-file originals): this is
// a check on the leaf and its containment, not a general guarantee against every way a filesystem
// could be rearranged upstream of it. It does NOT prove the originals were never written to during
// the run: an executor that modifies a file and restores it byte-for-byte before this check runs
// passes cleanly, and nothing in this module can catch that. Closing that gap needs read-only
// isolation of the fixture source for the run's duration (a copy-on-write mount, or a permissions
// lockdown), which is execution-harness / canary work, not this module's job.

import { readFileSync, writeFileSync, mkdirSync, existsSync, lstatSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// The evals directory itself (this file lives directly inside it), exported so callers agree on
// what srcRoot means without each recomputing it independently.
export const FIXTURE_ROOT = dirname(fileURLToPath(import.meta.url));

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

function isWithin(candidateRealPath, rootRealPath) {
  return candidateRealPath === rootRealPath || candidateRealPath.startsWith(rootRealPath + sep);
}

// The lexical gate. Runs BEFORE any filesystem call, on every declared path: rejects a non-string,
// an empty or whitespace-only path, an absolute path, and any path whose normalized form starts
// with '..'.
function assertLexicallySafe(rel) {
  if (typeof rel !== 'string' || rel.trim().length === 0) {
    throw new Error(`fixture path must be a non-empty string: ${JSON.stringify(rel)}`);
  }
  if (isAbsolute(rel)) {
    throw new Error(`fixture path must be relative, not absolute: ${rel}`);
  }
  const norm = normalize(rel);
  if (norm === '..' || norm.startsWith(`..${sep}`)) {
    throw new Error(`fixture path must not traverse above its root: ${rel}`);
  }
}

// Source side, in exactly this order, because two different rules can both reject a symlink and
// each must stay reachable with its own message:
//   a. absent source: throw naming the entry.
//   b. CONTAINMENT FIRST: realpathSync and require the resolved path to sit inside
//      realpathSync(srcRoot). An escaping symlink hits this rule and its message names containment.
//   c. THEN the type rule: lstat and reject anything that is not a regular file, symlinks
//      included. An in-root symlink survives (b) and is rejected here, with a message naming the
//      regular-file requirement.
// Running (c) before (b) would make the containment error unreachable for symlinks: every symlink
// would be refused before containment was ever evaluated.
function checkSource(rel, srcRoot, realSrcRoot) {
  const srcPath = join(srcRoot, rel);
  if (!existsSync(srcPath)) {
    throw new Error(`fixture source is missing: ${rel}`);
  }
  const realSrc = realpathSync(srcPath);
  if (!isWithin(realSrc, realSrcRoot)) {
    throw new Error(`fixture source escapes containment: ${rel} resolves outside srcRoot`);
  }
  const st = lstatSync(srcPath);
  if (!st.isFile()) {
    throw new Error(`fixture source must be a regular file, symlinks included: ${rel}`);
  }
  return srcPath;
}

// Walks the parent chain from destDir down to (but not including) the leaf file, creating any
// missing directory. For each parent that ALREADY exists, realpathSync it and require it to stay
// inside realpathSync(destDir). This catches a pre-existing symlinked subdirectory that would
// otherwise silently redirect the write elsewhere.
function ensureDestinationParents(destDir, relDir, realDestRoot) {
  if (!relDir || relDir === '.') return;
  const segments = relDir.split(/[\\/]+/).filter(Boolean);
  let current = destDir;
  for (const seg of segments) {
    current = join(current, seg);
    if (existsSync(current)) {
      const real = realpathSync(current);
      if (!isWithin(real, realDestRoot)) {
        throw new Error(`fixture destination escapes containment: ${seg} resolves outside destDir`);
      }
    } else {
      mkdirSync(current);
    }
  }
}

// Destination side, in this order, because the destination does not exist yet and cannot be
// realpath-resolved before it is created:
//   a. Compute the destination lexically as resolve(destDir, rel) and require it to sit inside
//      resolve(destDir). The lexical check is the primary destination guard.
//   b. Walk the parent chain, creating missing directories, realpath-checking existing ones.
//   c. If the final destination path already exists and is a symlink, throw. Never follow it and
//      never overwrite through it.
function checkDestination(rel, destDir, lexicalDestRoot, realDestRoot) {
  const destPath = resolve(destDir, rel);
  if (!isWithin(destPath, lexicalDestRoot)) {
    throw new Error(`fixture destination escapes containment: ${rel} resolves outside destDir`);
  }
  ensureDestinationParents(destDir, dirname(rel), realDestRoot);
  let destSt = null;
  try { destSt = lstatSync(destPath); } catch { /* does not exist yet: fine */ }
  if (destSt && destSt.isSymbolicLink()) {
    throw new Error(`fixture destination must not be a symlink: ${rel}`);
  }
  return destPath;
}

export function materialize(files, destDir, srcRoot) {
  if (!Array.isArray(files)) {
    throw new Error('materialize: files must be an array of relative fixture paths');
  }
  const realSrcRoot = realpathSync(srcRoot);
  const lexicalDestRoot = resolve(destDir);
  const realDestRoot = realpathSync(destDir);
  const seen = new Set();
  const entries = [];
  for (const rel of files) {
    assertLexicallySafe(rel);
    // A duplicate declared path is a catalog error, not a double copy: it would otherwise be
    // copied twice, recorded twice, and repeat itself in any drift message that later names it.
    if (seen.has(rel)) {
      throw new Error(`fixture path declared more than once: ${rel}`);
    }
    seen.add(rel);
    const srcPath = checkSource(rel, srcRoot, realSrcRoot);
    const destPath = checkDestination(rel, destDir, lexicalDestRoot, realDestRoot);
    const bytes = readFileSync(srcPath);
    writeFileSync(destPath, bytes);
    // kind is recorded, never hardcoded again downstream, so verifyUnchanged compares against a
    // stored value instead of an assumption. Materialization accepts nothing but regular files, so
    // this is always 'file' today.
    entries.push({ rel, sha256: sha256(bytes), kind: 'file' });
  }
  // The resolved root this call actually used, handed back so a caller verifies against the SAME
  // root materialize resolved rather than a separately configured value that could diverge from it.
  return { workspace: destDir, root: realSrcRoot, entries };
}

function kindOf(st) {
  if (st.isSymbolicLink()) return 'symlink';
  if (st.isDirectory()) return 'dir';
  if (st.isFile()) return 'file';
  return 'other';
}

// Never writes. Drift is any of: srcRoot itself no longer resolves, or (when anchor is given) no
// longer resolves to that anchor; the original is missing; it (or a directory above it) no longer
// resolves inside srcRoot; its current type no longer matches the entry's recorded kind (a symlink
// replacement counts, even one pointing at identical bytes, because lstat never follows it to
// compare content); or its sha256 moved.
export function verifyUnchanged(entries, srcRoot, anchor = null) {
  // The root itself is the first thing checked, and checked against the immutable anchor when one
  // is given, before any entry is touched: a root that cannot be resolved (deleted, a dangling
  // link) or that resolves to somewhere other than the anchor (swapped for a symlink into a
  // different directory, even one holding byte-identical files) makes every declared entry drift
  // right here, never a thrown error and never a per-entry check that a swapped root could fool.
  let realSrcRoot;
  try {
    realSrcRoot = realpathSync(srcRoot);
  } catch {
    return { ok: false, drifted: entries.map((entry) => entry.rel) };
  }
  if (anchor !== null && realSrcRoot !== anchor) {
    return { ok: false, drifted: entries.map((entry) => entry.rel) };
  }
  const drifted = [];
  for (const entry of entries) {
    const p = join(srcRoot, entry.rel);
    let st;
    try {
      st = lstatSync(p);
    } catch {
      drifted.push(entry.rel);
      continue;
    }
    // CONTAINMENT, checked before type or content: a directory above the leaf may have been
    // replaced with a symlink into an outside directory, in which case the leaf itself can still
    // lstat as a plain file with byte-identical content and slip past the checks below undetected.
    // realpathSync resolves every path component, so this catches that redirection even when
    // nothing about the leaf itself changed. A realpath that throws (a dangling link somewhere in
    // the chain, a removed parent) is drift too, not a separate error.
    let real;
    try {
      real = realpathSync(p);
    } catch {
      drifted.push(entry.rel);
      continue;
    }
    if (!isWithin(real, realSrcRoot)) {
      drifted.push(entry.rel);
      continue;
    }
    if (kindOf(st) !== entry.kind) {
      drifted.push(entry.rel);
      continue;
    }
    const bytes = readFileSync(p);
    if (sha256(bytes) !== entry.sha256) {
      drifted.push(entry.rel);
    }
  }
  return { ok: drifted.length === 0, drifted };
}
