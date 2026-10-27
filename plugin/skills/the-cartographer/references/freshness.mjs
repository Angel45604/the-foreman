// the-cartographer — freshness. A snapshot whose recorded source facts no longer match the files
// on disk is stale BY CONSTRUCTION and must be regenerated, never patched (PDR §14).
//
// Zero dependencies: node built-ins only.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ingestStrict } from './canonical.mjs';
import { pathSyntaxError, containmentError } from './validate.mjs';

export function digestOf(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

/**
 * The ONE line-count rule, shared by the extractor and by this check: the number of lines a human
 * editor shows — `\n`-terminated lines, plus a trailing partial line if the file does not end in a
 * newline. An empty file has 0 lines.
 */
export function countLines(text) {
  if (text.length === 0) return 0;
  return text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
}

/**
 * checkFreshness(map, repoRoot) -> { fresh, stale, missing, lineMismatch, unsafe, details }
 *
 *   stale         — the file exists but its recorded facts (sha256 and/or lines) no longer match
 *   missing       — the file is gone (reported separately from stale: a different repair)
 *   lineMismatch  — SPEC DEFECT 5: `lines` is RECOMPUTED here, never trusted from the map.
 *                   validate() bounds every citation against `sources[].lines`, a number the
 *                   *extractor* supplies; digest checking alone does not protect it, so a map could
 *                   otherwise carry a correct hash, inflate `lines`, and cite past end-of-file while
 *                   passing every check. Such a path appears in BOTH `lineMismatch` (the precise
 *                   diagnosis) and `stale` (so any consumer keyed on staleness still sees it).
 *   unsafe        — the path failed the syntax or containment rules; the file is NEVER read.
 *                   Defence in depth: validate() skips containment when given no repoRoot.
 *
 * `repoRoot` is REQUIRED. There is deliberately no process.cwd() fallback — resolving relative
 * source paths against an arbitrary cwd silently checks the wrong files, or none, and reports fresh.
 */
export function checkFreshness(map, repoRoot) {
  if (typeof repoRoot !== 'string' || repoRoot.trim() === '') {
    throw new Error(
      'checkFreshness: an explicit repoRoot is required — freshness never falls back to '
      + 'process.cwd(), which would silently check the wrong files (or none) and report fresh.',
    );
  }

  // The same ingest every other entry point takes. A freshness check compares RECORDED facts against
  // the disk, so it must read the facts the file records: a `sha256` behind an accessor could answer
  // this comparison with one digest and the snapshot with another, and a non-enumerable `lines` is a
  // number no reader of `map.json` will ever see. Fail closed, in the words `validate()` reports.
  // An absent map is not a snapshot at all, and the vacuous-pass report below already says so in the
  // caller's own terms — it does not need the boundary to say it as a type error.
  const snapshot = map === null || map === undefined ? null : ingestStrict(map, {
    at: 'map',
    frame: (at, reason) => (
      `checkFreshness: ${at} ${reason}. Freshness compares the facts the SNAPSHOT records against the `
      + 'files on disk, so it reads the map exactly once, as the data map.json carries.'
    ),
  });

  const stale = [];
  const missing = [];
  const lineMismatch = [];
  const unsafe = [];
  const details = [];

  // An absent OR empty collection verifies nothing. Reporting `fresh` for it is a VACUOUS pass: the
  // loop below runs zero times and every freshness gate downstream sees a green light for a snapshot
  // that proves nothing about any file. validate() likewise requires at least one source.
  const sources = snapshot?.sources;
  if (!Array.isArray(sources) || sources.length === 0) {
    details.push(
      'sources: absent, not an array, or empty — there is nothing to verify, so the snapshot is NOT '
      + 'fresh (a snapshot that checks no file cannot vouch for any file)',
    );
    return { fresh: false, stale, missing, lineMismatch, unsafe, details };
  }

  for (const source of sources) {
    const relative = source?.path;
    if (typeof relative !== 'string' || relative === '') {
      unsafe.push(String(relative));
      details.push(`${String(relative)}: sources[].path must be a non-empty string`);
      continue;
    }
    const rejection = pathSyntaxError(relative) ?? containmentError(repoRoot, relative);
    if (rejection) {
      unsafe.push(relative);
      details.push(`${relative}: ${rejection} — not read`);
      continue;
    }

    let buffer;
    try {
      buffer = fs.readFileSync(path.resolve(repoRoot, relative));
    } catch (e) {
      if (e?.code === 'ENOENT') {
        missing.push(relative);
        details.push(`${relative}: MISSING on disk`);
      } else {
        unsafe.push(relative);
        details.push(`${relative}: unreadable (${e?.code ?? e?.message})`);
      }
      continue;
    }

    const actualDigest = digestOf(buffer);
    const actualLines = countLines(buffer.toString('utf8'));
    let changed = false;
    if (actualDigest !== source.sha256) {
      details.push(`${relative}: sha256 changed — the map records ${source.sha256}, the file is ${actualDigest}`);
      changed = true;
    }
    if (actualLines !== source.lines) {
      lineMismatch.push(relative);
      details.push(`${relative}: lines mismatch — the map records ${source.lines}, the file has ${actualLines}`);
      changed = true;
    }
    if (changed) stale.push(relative);
  }

  const fresh = stale.length === 0 && missing.length === 0 && unsafe.length === 0;
  return { fresh, stale, missing, lineMismatch, unsafe, details };
}
