#!/usr/bin/env node
// Assemble self-contained Codex skills from canonical resources and host overlays.
import { access, cp, lstat, mkdir, readdir, realpath, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMain } from '../plugin/skills/the-foreman/references/is-main.mjs';

export const SKILL_NAMES = ['the-foreman', 'codex-gate', 'handoff', 'keep-it-simple', 'the-refiner'];
const SOURCE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Essential entry resources and their runtime dependencies; full trees are still copied.
const REQUIRED_CANONICAL = {
  'the-foreman': [
    'references/render.mjs', 'references/templates.mjs', 'references/markdown.mjs',
    'references/blocks.mjs', 'references/scaffold.mjs', 'references/esc.mjs',
    'references/lint.mjs', 'references/is-main.mjs', 'references/secret-scan.mjs',
    'references/escalation.mjs', 'references/dispatch-log.mjs', 'references/gate-contract.mjs',
    'references/ledger.schema.md', 'references/style.css', 'references/gate-board.js',
    'references/fonts/sora-latin.woff2', 'references/fonts/nunito-sans-latin.woff2',
  ],
  'codex-gate': [
    'codex-gate.sh', 'README.md', 'verdict.schema.json', 'question.schema.json',
    'investigate.schema.json', 'reviewer-instructions.md', 'reviewer-instructions.arch.md',
    'reviewer-instructions.frontend.md', 'reviewer-instructions.security.md',
    'reviewer-instructions.tests.md', 'question-instructions.md', 'investigate-instructions.md',
  ],
  handoff: ['references/continuity.mjs', 'references/continuity.md', 'assets/handoff-template.md', 'assets/kickoff-prompt-template.md'],
  'keep-it-simple': [],
  'the-refiner': ['references/core-contract.md', 'references/ai-tells.md', 'references/before-after.md'],
};
const REQUIRED_OVERLAY = {
  'the-foreman': ['SKILL.md', 'references/runtime.md', 'references/lifecycle-codex.md', 'references/orchestration.md'],
  'codex-gate': ['SKILL.md', 'references/runtime.md'],
  handoff: ['SKILL.md'],
};

const existing = async (path) => {
  try { return await lstat(path); }
  catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
};

const validateSource = async (path) => {
  const stat = await lstat(path);
  if (stat.isSymbolicLink()) throw new Error(`Source symlink refused: ${path}`);
  if (!stat.isFile() && !stat.isDirectory()) throw new Error(`Unsupported source: ${path}`);
  await access(path, constants.R_OK | (stat.isDirectory() ? constants.X_OK : 0));
  if (!stat.isDirectory()) return;
  for (const entry of await readdir(path)) await validateSource(join(path, entry));
};

const requireFile = async (path) => {
  if (!(await lstat(path)).isFile()) throw new Error(`Required file missing: ${path}`);
};

const effectivePath = async (path) => {
  try { return await realpath(path); }
  catch (error) {
    if (error.code !== 'ENOENT' || dirname(path) === path) throw error;
    return join(await effectivePath(dirname(path)), basename(path));
  }
};

const prepareSources = async ({ dest, sourceRoot }) => {
  const license = join(sourceRoot, 'plugin', 'LICENSE');
  // Validate the complete source and target set before creating even the destination.
  await validateSource(license);
  await requireFile(license);
  const effectiveDest = await effectivePath(dest);
  const sources = [];
  for (const name of SKILL_NAMES) {
    const canonical = join(sourceRoot, 'plugin', 'skills', name);
    const overlay = join(sourceRoot, 'codex', 'skills', name);
    for (const path of [canonical, overlay]) {
      await validateSource(path);
      if (!(await lstat(path)).isDirectory()) throw new Error(`Required directory missing: ${path}`);
      const sourcePath = await realpath(path);
      if (effectiveDest === sourcePath || effectiveDest.startsWith(sourcePath + sep))
        throw new Error(`Destination is inside a source tree: ${dest}`);
    }
    for (const file of ['SKILL.md', ...REQUIRED_CANONICAL[name]]) await requireFile(join(canonical, file));
    for (const file of ['agents/openai.yaml', ...(REQUIRED_OVERLAY[name] ?? [])]) await requireFile(join(overlay, file));
    const target = join(dest, name);
    if (await existing(target)) throw new Error(`Refusing existing skill target: ${target}`);
    sources.push({ canonical, overlay, target });
  }
  return { license, sources };
};

export const installSkills = async ({ destination = join(homedir(), '.agents', 'skills'), sourceRoot = SOURCE_ROOT } = {}) => {
  const dest = resolve(destination);
  const { license, sources } = await prepareSources({ dest, sourceRoot });
  const created = [];
  await mkdir(dest, { recursive: true });
  try {
    for (const { canonical, overlay, target } of sources) {
      // Exclusive mkdir also refuses a target that appeared after prevalidation.
      await mkdir(target);
      created.push(target);
      await cp(canonical, target, { recursive: true, force: false, errorOnExist: true });
      await cp(overlay, target, { recursive: true, force: true });
      await cp(license, join(target, 'LICENSE'), { force: false, errorOnExist: true });
    }
  } catch (error) {
    // Only remove directories this invocation created; existing skills are never owned here.
    for (const target of created.reverse()) await rm(target, { recursive: true, force: true });
    throw error;
  }
  return { destination: dest, skills: [...SKILL_NAMES] };
};

export const cli = async (argv) => {
  if (argv.length === 0) return installSkills();
  if (argv.length !== 2 || argv[0] !== '--dest' || !argv[1] || argv[1].startsWith('--'))
    throw new Error('usage: node scripts/install-codex.mjs [--dest <skills-dir>]');
  return installSkills({ destination: argv[1] });
};

if (isMain(import.meta.url)) {
  cli(process.argv.slice(2))
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error) => { console.error(String(error.message)); process.exitCode = 1; });
}
