---
name: the-steward
description: Use when a repository needs agent-facing scaffolding it can trust — agentize a repo (set up AGENTS.md + CLAUDE.md routing and a doc index from what the repo actually contains), or answer "are these agent docs still true?" mid-build. Trigger on "agentize this repo", "set up AGENTS.md", "generate CLAUDE.md", "scaffold agent docs", "are the docs still true", "is this doc stale", "check the doc claims", "audit our agent docs", "why did the agent read the wrong thing", or before trusting a repo's AGENTS.md/CLAUDE.md at the start of work.
allowed-tools: Bash, Read, Grep, Glob
---

# the-steward — report the truth about a repository's agent docs

Agent-facing scaffolding is the first thing every agent reads and the last thing anyone checks.
The-steward reads a repository, writes the routing docs it does not already have, and then
**verifies that the claims those docs carry resolve to real objects in the repository**.

**What it claims, exactly:** *the-steward reports what is true about this repository's agent docs;
whether anything acts on that report is up to you.* It installs no hook and no enforcement of any
kind, and it never says a repository is protected.

## The four verbs, and nothing else

| Verb | What it does | Writes? |
|---|---|---|
| `scan` | reads the repo and prints what it inferred — project roots, stacks, commands, docs scope, existing agent docs — every inference tagged with its evidence and a confidence | no |
| `generate` | writes only what is **absent**: `AGENTS.md`, `CLAUDE.md`, `docs/steward/routing-map.md`, `docs/steward/orphans.md`, `.gitattributes`, the vendored core, and `.steward.json` | yes — create-only |
| `check` | C1–C5 over repository content: do the declared commands and paths resolve, does frontmatter carry the declared keys, is generated content fresh, did any check run over nothing | no |
| `doctor` | `check`, plus environment findings it can only get by inspection — the effective hooks path, the vendored core's version, whether each path we recorded still holds the bytes we wrote | no |

**There are no flags.** Not `--force`, not `--version`, not `--help`-with-options. Every verb
rejects every flag.

## Invocation

The core is a vendored, dependency-free Python 3 package (floor 3.9). Once installed in the
target repo:

```
python3 -B tools/steward scan
python3 -B tools/steward generate
python3 -B tools/steward check
python3 -B tools/steward doctor
```

Before a core exists in the target, run the packaged one from inside the target repo:

```
cd <target repo> && python3 -B <this skill dir>/core generate
```

**`-B` is part of the command, not an optimization.** Without it the interpreter caches
`__main__` before the core's first line runs, and a read-only verb leaves a `__pycache__/`
behind — which would make "this verb writes nothing" false. `PYTHONDONTWRITEBYTECODE=1` in the
environment is the equivalent form.

## Exit codes

| Exit | Meaning |
|---|---|
| `0` | no `error` findings |
| `1` | at least one `error` finding |
| `2` | the tool itself failed, and no finding set can be trusted |

## How to read a report

Every finding states **how it was established**, and the report prints that tier:

- **resolved** — we followed the claim to a real object in the repository.
- **rendered** — we re-rendered from source and compared bytes.
- **inspected** — we read state we do not control and are reporting what we saw.
- **inferred** — we read repository state and drew a conclusion the state does not itself
  assert. Carries a confidence (`high` / `low`), and is never reported as proof.

The report also prints **how many items each check examined**. A check that examined zero items
says so; "0 checked, 0 problems" is never allowed to read as coverage.

## What it will not do

- It does not execute any command it finds documented. Commands are resolved **structurally**,
  against the repository's own declarations (package scripts, Makefile targets, task-runner
  entries, tracked executables).
- It does not overwrite a byte it did not write. A file that exists and is not recorded as ours
  is reported and left byte-identical; a file we recorded but whose bytes have since changed is
  reported as an `error` and left alone. The remedy is yours: `git checkout` or `rm`, then re-run.
- It does not read claims out of prose. `check` verifies the records in `.steward.json`; the
  *Source of Truth Map* and *Verification Commands* sections in the generated docs are output,
  and nothing reads them back. **A claim written only in prose is not verified.**
- It does not install a git hook, a CI workflow, or any harness config, and it makes no claim
  about what your existing hooks do beyond what it can see by inspecting them.
- It is single-writer: one `generate` at a time over an otherwise-quiescent working tree.

## Tests

```bash
python3 -B -m unittest discover -s plugin/skills/the-steward/tests -t plugin/skills/the-steward/tests
```
