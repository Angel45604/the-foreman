// the-cartographer — the READABILITY acceptance layer, on a real subject (ADR C-017, PDR §6.2).
//
// `attention.test.mjs` proves the RULE; this file proves the OUTCOME, and only a real subject can.
// The 6-node `tiny` fixture cannot: every one of its findings is `likely-contract`, which is the
// correct answer for it and says nothing about a 91-node subject whose drift lane was the problem.
//
// The fixture is the map the held-out oracle run produced from `codex-gate` at `ac0daf0` — the same
// 91 nodes, 113 edges and 16 findings recorded in `docs/initiatives/2026-08-11-the-cartographer/
// oracle-run-1.md`, in the canonical serialization `render` would write. It is committed as INPUT,
// not as a golden: nothing here compares bytes, so re-extracting the subject one day changes the
// numbers below and nothing else.
//
// It is also PRE-CONTRACT, in three ways that `load()` repairs in memory and `D0` pins: it carries no
// documentation harvest (ADR decision F), no `refutedQuote` on its contradictions (ADR C-019), and an
// underivable `"What it does"` capability column. Every check below runs on the repaired map, and the
// repair costs findings: `DOC_AUDIT` documents a node wherever it records an `asserts` candidate, so
// 16 recorded findings become `EXPECTED.length` scored ones — FOUR are withdrawn as of the
// 2026-08-28 disposition rulings, leaving 12. *(This said "THREE … leaving 13" for exactly as long as
// it took the same day's jq ruling to land: the count was written down beside a derivation instead of
// taken from it, which is the mistake the next sentence warns about. It is spelled out here only
// because a reader needs a number; `EXPECTED.length` is the authority.)* Those are withdrawn FALSE accusations, not
// a detection regression — `R2` asserts every remaining baseline member unchanged.
//
// Two properties, and the first is the one that licenses the second:
//
//   RAW        — recall is UNIVERSAL. Same findings, same count, same classes as before bucketing.
//                Every claim about readability is worthless if this one is not exactly true.
//   READABLE   — every high-value and every ambiguous finding is reachable without opening a
//                disclosure, `jq` — an undocumented hard prerequisite — included.
//
// Zero dependencies: node built-ins only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { computeDrift } from './diff.mjs';
import { renderPage } from './render.mjs';
import { toMarkdown } from './markdown.mjs';
import { serialize } from './serialize.mjs';
import { validate } from './validate.mjs';
import { bucketForFinding, groupByAttention } from './attention.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..', '..');
const SUBJECT = path.join(HERE, 'fixtures', 'codex-gate.map.json');

/** The committed fixture, exactly as the oracle run produced it — no harvest records, because it
 *  predates ADR decision F. */
const loadRaw = () => JSON.parse(fs.readFileSync(SUBJECT, 'utf8'));

const README = 'plugin/skills/codex-gate/README.md';
const SKILL = 'plugin/skills/codex-gate/SKILL.md';
/** The fixture's two `role: "doc"` sources — the set a harvest must cover to be complete. */
const DOC_SURFACES = [README, SKILL];

/**
 * THE DOCUMENTATION AUDIT — the harvest this file derives, one node at a time.
 *
 * WHAT IT REPLACES, and why the replacement is not a tidy-up (2026-08-14, pre-PR review). `load()`
 * used to hang `{ searched: [both surfaces], candidates: [] }` on ALL 91 nodes: a blanket attestation
 * that a complete search of both documentation surfaces returned NOTHING, for every node in the map.
 * That is a claim about the subject, and on one node this very branch establishes it is FALSE —
 * `doc-harvest.test.mjs` carries `SKILL.md:320` as the line that documents
 * `component.append_context_if_present` BY SYNONYM ("the wrapper folds it into the packet"), the
 * seventh of run 3's confirmed false accusations. The fixture was therefore fabricating an
 * attestation in order to keep a known-false accusation in a regression baseline.
 *
 * WHERE THE HARVEST IS ATTACHED. Only to the nodes where it DECIDES something — non-inferred,
 * evidenced, carrying no `doc` claim (`awaitsDocVerdict`). That is exactly the eleven below, and `F1`
 * proves the population by listing the same eleven as withheld on the un-harvested fixture. A record
 * on any other node is inert, so attaching one would be an attestation bought for nothing.
 *
 * HOW IT WAS DERIVED. Both surfaces were searched for each node's identifier AND for the synonyms the
 * protocol requires (SKILL.md §3) — "packet", "manifest", "verdict file", "snapshot", "truncate",
 * "eight modes", `CODEX_HOME`, `jq`, `git`, "exit 2". Every hit found is recorded here with its line
 * and its exact text. Recording a hit is NOT documenting the node: only an `asserts` disposition,
 * PROMOTED into `claims[]`, silences a finding (ADR C-018). A `mentions` disposition leaves the
 * finding standing and says what the search actually returned, which is the whole difference between
 * an attestation and an empty gesture.
 *
 * ONE disposition is `asserts`. Ten are `mentions` or nothing found, and each carries the reason.
 */
const DOC_AUDIT = [
  {
    nodeId: 'component.append_context_if_present',
    // THE ONE THAT CHANGES A VERDICT. Zero identifier hits in either surface — `grep -c
    // append_context_if_present` returns 0 and 0 — and SKILL.md:317-321 describes the helper by its
    // ROLE under the heading "Write `<RUNDIR>/context.md` before `phase-review`". :320 is the line
    // carrying the assertion. Same line, same quote, same disposition as `doc-harvest.test.mjs`
    // records for run 3's item 7, so the two files cannot drift apart on it.
    candidates: [
      { path: README, line: 210, quote: "  `<RUNDIR>/context.md` if present → repo-root guidance manifest → the **INVESTIGATION BRIEF** (the file verbatim)", disposition: 'mentions' },
      { path: README, line: 215, quote: "  evidence reaches Codex (the same run-dir-drop idiom as `context.md`). Round 1 fresh thread; round N resumes.", disposition: 'mentions' },
      { path: SKILL, line: 222, quote: "   write <RUNDIR>/context.md             # phase intent / acceptance / review context (see below)", disposition: 'mentions' },
      { path: SKILL, line: 317, quote: "### Write `<RUNDIR>/context.md` before `phase-review` (gives Codex the phase intent)", disposition: 'mentions' },
      { path: SKILL, line: 319, quote: "the phase did the *intended* work. Before calling `phase-review`, write a short `<RUNDIR>/context.md`", disposition: 'mentions' },
      { path: SKILL, line: 320, quote: "(the `RUNDIR=` line is printed by `phase-start`) and the wrapper folds it into the packet under a", disposition: 'asserts' },
      { path: SKILL, line: 327, quote: "  `blockers.md` (or similar), read them and fold the bits that bear on this phase into context.md.", disposition: 'mentions' },
      { path: SKILL, line: 328, quote: "  `.claude/context/` is excluded from the diff (scratch), so context.md is how that continuity reaches the reviewer.", disposition: 'mentions' },
      { path: SKILL, line: 333, quote: "cat > \"$RUNDIR/context.md\" <<'CTX'", disposition: 'mentions' },
      { path: SKILL, line: 341, quote: "(Omitting `context.md` is harmless — the wrapper simply skips the section.)", disposition: 'mentions' },
      { path: SKILL, line: 376, quote: "  `<RUNDIR>/context.md`, and writes only under the run dir — the gate never writes the repo's memory", disposition: 'mentions' },
      { path: SKILL, line: 379, quote: "  `.claude/context/` stays excluded from the diff but is reachable as review context (via context.md + read-only shell).", disposition: 'mentions' },
    ],
  },
  {
    nodeId: 'artifact.assembled_packet',
    // MARGINAL, and called `mentions` for a stated reason rather than a comfortable one. README:210
    // enumerates a packet's contents — but the bullet's subject is `mode_investigate`'s packet
    // ("**Packet** (`mode_investigate`, mirrors `mode_question`'s shape)"), and the ordering it gives
    // is a DIFFERENT one from this artifact's (persona → context.md → manifest → the artifact under
    // review → diffstat → tier-dependent bodies). A line describing one mode's packet names this
    // shared artifact without predicating what it is. The C-018 addendum's boundary, applied in the
    // direction that KEEPS the finding.
    //
    // SKILL.md:318 was MISSED by the original sweep and is recorded here. It was `mentions` under the
    // 2026-08-27 deferral; the owner RULED on 2026-08-28 and it is now `asserts` — C-018 reserves
    // `mentions` for text that predicates nothing, and this line states what `phase-review` packets
    // contain. Promoting it withdraws this node's UNDOCUMENTED finding, which is why `EXPECTED` is
    // derived from the dispositions rather than listed beside them.
    candidates: [
      { path: README, line: 38, quote: "**Doc tier — NOT-in-a-repo fallback only** (packet-only, shell OFF), cwd = a neutral run-dir:", disposition: 'mentions' },
      { path: README, line: 41, quote: "  --disable shell_tool --output-schema <ABS schema> -o <ABS out> --json -   # packet on stdin", disposition: 'mentions' },
      { path: README, line: 47, quote: "  -c approval_policy=\"never\" --output-schema <ABS schema> -o <ABS out> --json -   # packet on stdin", disposition: 'mentions' },
      { path: README, line: 51, quote: "  containing the file's token. So **no packet-only fallback needed** for code tier.", disposition: 'mentions' },
      { path: README, line: 100, quote: "  packet section (`path  sha  (verdict: <ref>)`). Empty delta ⇒ APPROVE **without invoking Codex**", disposition: 'mentions' },
      { path: README, line: 102, quote: "  guard + lean packet + OVERFLOW path with `prepr`.", disposition: 'mentions' },
      { path: README, line: 120, quote: "- **Knob** — `CODEX_GATE_SHARD` (default **`auto`**): when an assembled `prepr`/`prepr-delta` packet exceeds", disposition: 'mentions' },
      { path: README, line: 121, quote: "  `CODEX_GATE_PACKET_BUDGET`, **shard by path** instead of emitting OVERFLOW. `off` ⇒ keep the Tier-1 OVERFLOW", disposition: 'mentions' },
      { path: README, line: 122, quote: "  (no sharding). The trigger lives in `_prepr_common` right where `enforce_packet_budget` would fire.", disposition: 'mentions' },
      { path: README, line: 129, quote: "- **Per-shard review in its OWN fresh thread** — each non-empty shard gets a lean packet (the SHARED", disposition: 'mentions' },
      { path: README, line: 130, quote: "  `build_prepr_packet`, scoped to that shard's files; diff hunks never dropped), reviewed with `run_codex code`", disposition: 'mentions' },
      { path: README, line: 133, quote: "  own packet is STILL over budget, that shard is recorded **inconclusive** (`OVERFLOW`) — never silently dropped;", disposition: 'mentions' },
      { path: README, line: 160, quote: "Tier-2 machinery (config-isolated `CODEX_HOME`, `--sandbox read-only`, code tier, packet budget, coverage) — only", disposition: 'mentions' },
      { path: README, line: 161, quote: "the packet's persona and the status's provenance array differ.", disposition: 'mentions' },
      { path: README, line: 168, quote: "  Each lens loads its persona `reviewer-instructions.<lens>.md`; `build_prepr_packet` fails CLOSED if a persona is", disposition: 'mentions' },
      { path: README, line: 172, quote: "  if ANY lens packet exceeds `CODEX_GATE_PACKET_BUDGET` the run fails closed with **OVERFLOW** (pre-flight, ZERO", disposition: 'mentions' },
      { path: README, line: 176, quote: "  truncate/drop a lens; a malformed `CODEX_GATE_FANOUT_MAX_LENSES` / `CODEX_GATE_PACKET_BUDGET` ⇒ `INFRA_ERROR`;", disposition: 'mentions' },
      { path: README, line: 206, quote: "fast mode, run dirs, packet budget + OVERFLOW, `--output-schema -o --json` verdict capture) — only the packet,", disposition: 'mentions' },
      { path: README, line: 209, quote: "- **Packet** (`mode_investigate`, mirrors `mode_question`'s shape): `investigate-instructions.md` persona →", disposition: 'mentions' },
      { path: README, line: 214, quote: "  rounds; every round folds the current `evidence.md` into the packet, so a `exec resume` round is how NEW", disposition: 'mentions' },
      { path: README, line: 238, quote: "schema pinning to `investigate.schema.json`, code-tier read-only posture, brief+persona in packet, no-ledger,", disposition: 'mentions' },
      { path: SKILL, line: 48, quote: "  after a small follow-up without re-reviewing the whole branch. Shares the budget guard + lean packet", disposition: 'mentions' },
      { path: SKILL, line: 60, quote: "     too large for one review (predicted pre-flight by the packet budget, or observed at runtime via Codex's", disposition: 'mentions' },
      { path: SKILL, line: 64, quote: "     **shard that stayed inconclusive** — one shard's own packet was still over budget or it errored/overflowed,", disposition: 'mentions' },
      { path: SKILL, line: 69, quote: "     note that to the user. (You can also bump `CODEX_GATE_PACKET_BUDGET` if the budget is the only constraint", disposition: 'mentions' },
      { path: SKILL, line: 148, quote: "read-only shell, `exec resume` thread loop, fast mode, run dirs, packet budget/OVERFLOW, schema-validated", disposition: 'mentions' },
      { path: SKILL, line: 250, quote: "UNCHANGED` packet section); otherwise it is reviewed (unreviewed OR changed-since-reviewed). A changed", disposition: 'mentions' },
      { path: SKILL, line: 261, quote: "When an assembled `prepr` / `prepr-delta` packet exceeds `CODEX_GATE_PACKET_BUDGET` **and**", disposition: 'mentions' },
      { path: SKILL, line: 269, quote: "- **Per-shard review in its OWN fresh thread.** Each non-empty shard gets a lean packet with the scoped diff", disposition: 'mentions' },
      { path: SKILL, line: 272, quote: "  packet is STILL over budget, that shard is recorded **inconclusive** (`OVERFLOW`) — never silently dropped", disposition: 'mentions' },
      { path: SKILL, line: 307, quote: "  lens reviews the FULL diff (multi-lens is NOT a context-overflow mitigation). If any lens packet exceeds", disposition: 'mentions' },
      { path: SKILL, line: 308, quote: "  `CODEX_GATE_PACKET_BUDGET` the run fails closed with **OVERFLOW** (\"narrow via `prepr-delta --multi`, or drop", disposition: 'mentions' },
      { path: SKILL, line: 312, quote: "  truncates a lens); a malformed `CODEX_GATE_PACKET_BUDGET` / `CODEX_GATE_FANOUT_MAX_LENSES` ⇒ INFRA_ERROR; a", disposition: 'mentions' },
      { path: SKILL, line: 318, quote: "`phase-review` packets only the diff + touched-file contents, so on its own Codex cannot judge whether", disposition: 'asserts' },
      { path: SKILL, line: 320, quote: "(the `RUNDIR=` line is printed by `phase-start`) and the wrapper folds it into the packet under a", disposition: 'mentions' },
      { path: SKILL, line: 349, quote: "**Context-overflow (Tier 1):** `CODEX_GATE_PACKET_BUDGET` (default **300000** chars — the max assembled-packet", disposition: 'mentions' },
      { path: SKILL, line: 355, quote: "shard an over-budget packet by path, review each shard in its own fresh thread, aggregate deterministically", disposition: 'mentions' },
    ],
  },
  {
    nodeId: 'component.build_manifest',
    // The same line NAMES the manifest and says nothing about how it is built — paths and not bodies,
    // every ancestor directory of a changed file, de-duplicated across the run. Naming the output is
    // not documenting the function.
    candidates: [
      { path: README, line: 103, quote: "- **Coverage manifest + fail-closed** — `prepr` / `prepr-delta` add an additive `coverage` object to the", disposition: 'mentions' },
      { path: README, line: 112, quote: "scope/skip-proof, empty-delta no-Codex APPROVE, coverage manifest, coverage-gap fail-closed).", disposition: 'mentions' },
      { path: README, line: 210, quote: "  `<RUNDIR>/context.md` if present → repo-root guidance manifest → the **INVESTIGATION BRIEF** (the file verbatim)", disposition: 'mentions' },
    ],
  },
  {
    nodeId: 'component.classify_verdict_file',
    // README:135 says the AGGREGATE reads every shard verdict. That predicates of the aggregate, not
    // of the per-job classifier that returns APPROVE / BLOCK / OVERFLOW / INFRA_ERROR without
    // printing a status line.
    candidates: [
      { path: README, line: 131, quote: "  in a brand-new thread (no resume, round 1). Verdicts persist at `<runDir>/shard-<group>-verdict.json`", disposition: 'mentions' },
      { path: README, line: 137, quote: "    `<runDir>/round-1-verdict.json`; emit BLOCK with the combined counts.", disposition: 'mentions' },
      { path: SKILL, line: 18, quote: "per-round verdict file, fix `agent_fixable` blockers, re-review via resume, and converge.", disposition: 'mentions' },
      { path: SKILL, line: 72, quote: "   - **BLOCK** → read the verdict file (`jq . <verdictPath>`). Then:", disposition: 'mentions' },
      { path: SKILL, line: 85, quote: "     is in `runDir/lens-<lens>-verdict.json` (one per lens — read these to see which dimension raised what).", disposition: 'mentions' },
      { path: SKILL, line: 89, quote: "     (`jq -S '.blockers' <runDir>/round-<N-1>-verdict.json` vs round-N). If the **same** blocker", disposition: 'mentions' },
      { path: SKILL, line: 271, quote: "  `<runDir>/shard-<group>-verdict.json` (+ a `shard-coverage-map.tsv` of path→group). If a single shard's own", disposition: 'mentions' },
      { path: SKILL, line: 276, quote: "  `<runDir>/round-1-verdict.json` and emits BLOCK with the combined counts); else **OVERFLOW** if any shard is", disposition: 'mentions' },
    ],
  },
  {
    // main()'s pre-flight (verdict.schema.json, reviewer-instructions.md and jq must all be present)
    // and its eight-way route are described nowhere in either surface. Searched for "eight modes",
    // "first argument", "routes", "dispatch": the only "dispatch" hits are the multi-lens dispatch
    // inside `_prepr_common`, a different function.
    //
    // THE SWEEP'S OWN TERMS WERE THE GAP: it searched "eight modes" and never the bare "mode(s)", so
    // SKILL.md:27 — which tells the reader to run the matching mode and then enumerates the routes —
    // was never returned. Recorded here, and it stays `mentions` after the 2026-08-28 ruling rather
    // than by deferral: that ruling promoted the two lines which state what an item DOES, and this one
    // predicates of the MODES, not of the dispatch component that routes them — the distinction this
    // node's summary already turns on. Round 8 did not contest it.
    nodeId: 'component.main_dispatch',
    candidates: [
      { path: README, line: 34, quote: "**Tier is chosen by repo presence, NOT by mode.** Every review mode (plan, bundle, phase-review, prepr,", disposition: 'mentions' },
      { path: README, line: 44, quote: "**Code tier — default for ALL review modes inside a git repo** (plan, bundle, phase-review, prepr, prepr-delta), read-only shell ON — cwd = **repo root** (untrusted):", disposition: 'mentions' },
      { path: README, line: 93, quote: "  `{mode, ref, reviewedPaths:[{path, sha}], verdictPath, threadId, summary}`; `sha` = `git -C <repo>", disposition: 'mentions' },
      { path: README, line: 95, quote: "  OVERFLOW, and never for plan / bundle / question (only an approved surface is \"reviewed\"). The mode hands", disposition: 'mentions' },
      { path: README, line: 170, quote: "- **Non-composable with Tier-3 sharding** — the multi-lens dispatch is BEFORE the `CODEX_GATE_SHARD=auto` branch,", disposition: 'mentions' },
      { path: README, line: 193, quote: "Status: **Tier 4 contracts GREEN** — exercised by `codex-gate.test.sh` (multi-lens dispatch on `--multi` AND", disposition: 'mentions' },
      { path: README, line: 201, quote: "## Investigation mode — `investigate <brief>` (PINNED contract)", disposition: 'mentions' },
      { path: README, line: 206, quote: "fast mode, run dirs, packet budget + OVERFLOW, `--output-schema -o --json` verdict capture) — only the packet,", disposition: 'mentions' },
      { path: SKILL, line: 3, quote: "description: Automated, repo-agnostic Codex gate (the hands-free \"third pair of eyes\") for REVIEW and INVESTIGATION. Use to review a plan / PDR-ADR bundle / implementation phase / pre-PR branch and auto-loop fixes until it converges; to ground an architecture or feature decision before asking the user; OR to INVESTIGATE — root-cause a bug, narrow a flaky / orphaned / regression / \"works-on-my-machine\" symptom, or decide between competing hypotheses — under an explicit safety contract (read-only, fails closed on forbidden probes, proposes a fix but never applies one). Modes — plan <file> | bundle <dir> | phase-start <id> | phase-review <id> | question <file> | investigate <brief> | prepr [base] | prepr-delta [base]. Replaces manual copy-paste between Claude and the Codex app.", disposition: 'mentions' },
      { path: SKILL, line: 20, quote: "The **`investigate`** mode is a **sibling** workflow that reuses this exact machinery for a different", disposition: 'mentions' },
      { path: SKILL, line: 22, quote: "auto-fix; see **Investigation mode** below.", disposition: 'mentions' },
      { path: SKILL, line: 26, quote: "## When the user invokes `/codex-gate <mode> [args]`", disposition: 'mentions' },
      { path: SKILL, line: 27, quote: "Run the matching mode and drive the loop below. Modes:", disposition: 'mentions' },
      { path: SKILL, line: 32, quote: "  binding (before dispatching the implementer); it prints `RUNDIR=` / `PHASE_HEAD=` and writes nothing reviewable.", disposition: 'mentions' },
      { path: SKILL, line: 39, quote: "  root-cause status, never APPROVE/BLOCK, never auto-fixes. See **Investigation mode** below.", disposition: 'mentions' },
      { path: SKILL, line: 51, quote: "## The loop (review modes: plan / bundle / phase-review / prepr / prepr-delta)", disposition: 'mentions' },
      { path: SKILL, line: 52, quote: "1. **Round 1**: `bash <skill-dir>/codex-gate.sh <mode> <arg> 1` → capture the status JSON.", disposition: 'mentions' },
      { path: SKILL, line: 53, quote: "   (Run from the repo root for code-tier modes so Codex can inspect the repo read-only.)", disposition: 'mentions' },
      { path: SKILL, line: 77, quote: "3. **Re-review (resume)**: `bash <skill-dir>/codex-gate.sh <mode> <arg> <round+1> <threadId>` (pass the `threadId`", disposition: 'mentions' },
      { path: SKILL, line: 139, quote: "## Investigation mode (`investigate <brief-file>`) — a SIBLING workflow, not a review", disposition: 'mentions' },
      { path: SKILL, line: 148, quote: "read-only shell, `exec resume` thread loop, fast mode, run dirs, packet budget/OVERFLOW, schema-validated", disposition: 'mentions' },
      { path: SKILL, line: 227, quote: "For `/superpowers:subagent-driven-development`: call `phase-start <id>` before dispatching the implementer, and", disposition: 'mentions' },
      { path: SKILL, line: 245, quote: "`{mode, ref, reviewedPaths:[{path, sha}], verdictPath, threadId, summary}`. (BLOCK / INFRA_ERROR /", disposition: 'mentions' },
      { path: SKILL, line: 345, quote: "`CODEX_GATE_FAST` (**default 1 = ON**; Codex \"fast mode\" — same model, ~1.5× faster at **~2.5× credit cost**;", disposition: 'mentions' },
    ],
  },
  {
    // `CODEX_GATE_MAX_FILE_LINES` appears in neither surface, in any spelling. The truncation hits are
    // all about never truncating a LENS, an unrelated rule. The node's own summary says as much.
    nodeId: 'env.codex_gate_max_file_lines',
    candidates: [
      { path: README, line: 176, quote: "  truncate/drop a lens; a malformed `CODEX_GATE_FANOUT_MAX_LENSES` / `CODEX_GATE_PACKET_BUDGET` ⇒ `INFRA_ERROR`;", disposition: 'mentions' },
      { path: README, line: 195, quote: "with zero codex calls / no truncation, per-lens fresh-thread invocation + additive `lenses[]`, sharding bypassed", disposition: 'mentions' },
      { path: SKILL, line: 312, quote: "  truncates a lens); a malformed `CODEX_GATE_PACKET_BUDGET` / `CODEX_GATE_FANOUT_MAX_LENSES` ⇒ INFRA_ERROR; a", disposition: 'mentions' },
      { path: SKILL, line: 351, quote: "kicks in for `prepr`/`prepr-delta`) and `CODEX_GATE_INLINE_MAX_LINES` (default **120** — at code tier, a touched", disposition: 'mentions' },
      { path: SKILL, line: 360, quote: "set that exceeds it FAILS CLOSED with `INFRA_ERROR` and ZERO codex calls, never truncating a lens),", disposition: 'mentions' },
    ],
  },
  {
    nodeId: 'env.codex_home_dir',
    // README:20 documents the config-isolated home the wrapper EXPORTS. This node is the wrapper's own
    // `CODEX_HOME_DIR` variable — the knob a reader would look for and not find. The line names the
    // value, never the variable, which is precisely what the node's summary records.
    candidates: [
      { path: README, line: 20, quote: "**Dedicated, config-isolated home** — `CODEX_HOME=~/.claude/codex-gate/home`", disposition: 'mentions' },
      { path: README, line: 25, quote: "  demand. Mitigation: auth failure → `INFRA_ERROR` (halt+surface) → run `CODEX_HOME=~/.claude/codex-gate/home codex login`.", disposition: 'mentions' },
      { path: README, line: 40, quote: "CODEX_HOME=<home> codex exec --ignore-user-config --skip-git-repo-check --sandbox read-only \\", disposition: 'mentions' },
      { path: README, line: 46, quote: "CODEX_HOME=<home> codex exec --ignore-user-config --sandbox read-only \\", disposition: 'mentions' },
      { path: README, line: 60, quote: "CODEX_HOME=<home> codex exec resume <thread_id> --ignore-user-config \\", disposition: 'mentions' },
      { path: README, line: 66, quote: "CODEX_HOME=<home> codex exec resume <thread_id> --ignore-user-config \\", disposition: 'mentions' },
      { path: README, line: 160, quote: "Tier-2 machinery (config-isolated `CODEX_HOME`, `--sandbox read-only`, code tier, packet budget, coverage) — only", disposition: 'mentions' },
      { path: README, line: 204, quote: "SAME Phase-0 invocation contract (config-isolated `CODEX_HOME`, `--sandbox read-only`, **code tier with read-only", disposition: 'mentions' },
      { path: SKILL, line: 58, quote: "     If auth-related, tell the user: `CODEX_HOME=~/.claude/codex-gate/home <codex> login`.", disposition: 'mentions' },
      { path: SKILL, line: 147, quote: "It reuses ALL the review machinery (config-isolated `CODEX_HOME`, `--sandbox read-only`, code tier with", disposition: 'mentions' },
    ],
  },
  {
    nodeId: 'external.git',
    // git is named mostly as a CONDITION ("inside a git repo" selects the tier). README:93 is the
    // exception and was MISSED by the original sweep, which searched "git repo" and not the command
    // names: it gives an actual invocation, `git -C <repo> hash-object`.
    //
    // DISPOSITION CONTESTED, AND DELIBERATELY LEFT AS `mentions` (owner decision, 2026-08-27). The
    // round-6 gate argues :93 predicates git's operational use and should be `asserts`, which would
    // withdraw this node's UNDOCUMENTED finding and re-score run 4's precision. That re-score is a
    // SEPARATE decision the owner deferred; recording the hit is the completeness half, and it is
    // verdict-neutral because only an `asserts` candidate is promoted into `claims[]`.
    // EVERY HIT THE SEARCH RETURNED (round-7 gate). This recorded two of the sixteen lines carrying
    // `git` across the two pinned surfaces, while `load()` installs a COMPLETE harvest for the node —
    // a record attesting coverage it did not have, which is what SKILL.md §3.1 forbids. The sweep is
    // the plain substring, deliberately: narrowing the search after seeing the answers is how a
    // selective record gets a respectable name. Four of them invoke git (`hash-object`) and so
    // ASSERT of this node; the rest are tier conditions and `--skip-git-repo-check` flags, which
    // predicate nothing of it.
    candidates: [
      { path: README, line: 35, quote: "prepr-delta) runs **code tier when inside a git repo**; doc tier is the fallback **only when cwd is not a git repo**.", disposition: 'mentions' },
      { path: README, line: 40, quote: "CODEX_HOME=<home> codex exec --ignore-user-config --skip-git-repo-check --sandbox read-only \\", disposition: 'mentions' },
      { path: README, line: 44, quote: "**Code tier — default for ALL review modes inside a git repo** (plan, bundle, phase-review, prepr, prepr-delta), read-only shell ON — cwd = **repo root** (untrusted):", disposition: 'mentions' },
      { path: README, line: 52, quote: "- CONFIRMED: an **untrusted** git repo runs read-only with **no trust prompt** (we never trust the target).", disposition: 'mentions' },
      { path: README, line: 53, quote: "- Do NOT pass `--skip-git-repo-check` when cwd IS a git repo; DO pass it when cwd is not (doc tier).", disposition: 'mentions' },
      { path: README, line: 58, quote: "# CODE-tier resume (cwd = repo root; NO --skip-git-repo-check; shell ON):", disposition: 'mentions' },
      { path: README, line: 67, quote: "  --skip-git-repo-check --disable shell_tool -c sandbox_mode=\"read-only\" \\", disposition: 'mentions' },
      { path: README, line: 72, quote: "  (wrapper sets process cwd); needs `--skip-git-repo-check` when cwd isn't a git repo (doc tier).", disposition: 'mentions' },
      { path: README, line: 74, quote: "  `--skip-git-repo-check --disable shell_tool`. Dropping them would relax the round-1 sandbox posture.", disposition: 'mentions' },
      { path: README, line: 82, quote: "Status: **all critical Phase-0 contracts GREEN.** Snapshot-scoping git logic + no-write/injection", disposition: 'mentions' },
      { path: README, line: 93, quote: "  `{mode, ref, reviewedPaths:[{path, sha}], verdictPath, threadId, summary}`; `sha` = `git -C <repo>", disposition: 'asserts' },
      { path: README, line: 98, quote: "  reviewed diff to only files whose current `git hash-object` is NOT an approved-reviewed sha in the ledger", disposition: 'asserts' },
      { path: SKILL, line: 28, quote: "- `plan <file>` — review a plan doc before `ExitPlanMode`. Code tier when run inside a git repo (so", disposition: 'mentions' },
      { path: SKILL, line: 36, quote: "  Code tier when run inside a git repo (Codex grounds in real code/canon); doc tier when not in a repo.", disposition: 'mentions' },
      { path: SKILL, line: 43, quote: "  OR changed-since-reviewed (their current `git hash-object` is not an approved-reviewed sha in the", disposition: 'asserts' },
      { path: SKILL, line: 244, quote: "with their `git hash-object` sha at approval time:", disposition: 'asserts' },
    ],
  },
  {
    nodeId: 'external.jq',
    // THE AUDIT STRENGTHENS D3 RATHER THAN WEAKENING IT. `jq` is not absent from the documentation —
    // it appears four times, every one of them an instruction to the READER ("read the verdict file
    // (`jq . <verdictPath>`)"). Not one of them says the wrapper requires jq or that its absence is a
    // pre-flight exit 2. An identifier-only sweep would have called this documented; the disposition
    // is what keeps it accused.
    candidates: [
      { path: SKILL, line: 72, quote: "   - **BLOCK** → read the verdict file (`jq . <verdictPath>`). Then:", disposition: 'asserts' },
      { path: SKILL, line: 89, quote: "     (`jq -S '.blockers' <runDir>/round-<N-1>-verdict.json` vs round-N). If the **same** blocker", disposition: 'asserts' },
      { path: SKILL, line: 113, quote: "   - **GROUNDED** → read the grounding file (`jq . <verdictPath>`). It has `optionAssessments[]`", disposition: 'asserts' },
      { path: SKILL, line: 177, quote: "   - **ROOT_CAUSE_FOUND** → STOP. Read the report (`jq . <verdictPath>`): `rootCause`, the proving", disposition: 'asserts' },
    ],
  },
  {
    // No line in either surface documents the exit-2 usage path. The one "usage" hit is token usage in
    // a Codex event.
    nodeId: 'outcome.usage_error_exit_2',
    candidates: [
      { path: README, line: 31, quote: "- Token usage is in the `{\"type\":\"turn.completed\",\"usage\":{…}}` event.", disposition: 'mentions' },
    ],
  },
  {
    nodeId: 'state.phase_snapshot',
    // SKILL.md:31 predicates of the MODE ("`phase-start <id>` — snapshot the working tree"). The node
    // is the artifact it leaves behind — `<runDir>/snapshot.json` plus a `snapshot/` copy tree, each
    // entry carrying a `baselineKind` — and neither the file nor its shape appears anywhere.
    candidates: [
      { path: README, line: 82, quote: "Status: **all critical Phase-0 contracts GREEN.** Snapshot-scoping git logic + no-write/injection", disposition: 'mentions' },
      { path: SKILL, line: 31, quote: "- `phase-start <id>` — snapshot the working tree BEFORE an implementation phase. Run this in the", disposition: 'mentions' },
    ],
  },
];

/**
 * The three contradictions the fixture carries, with the fragment of each cited claim the evidence
 * refutes (ADR C-019). The committed fixture predates C-019 and is frozen, so the field is supplied
 * HERE — every quote below is a verbatim substring of that record's own `claim.text`.
 */
const REFUTED_QUOTES = new Map([
  ['component.emit_synthetic_approve', 'Still records the ledger'],
  ['mode.prepr', "use 'prepr --since-reviewed'"],
  ['outcome.overflow', 'outcome ∈ APPROVE | BLOCK | INFRA_ERROR'],
]);

/**
 * The fixture brought up to the CURRENT contract, in memory (ADR decision F, C-019, and the closed
 * table-column vocabulary). The committed fixture is never edited, so it stays what its header says
 * it is — the map the held-out oracle run produced, byte for byte.
 *
 * WHY THIS IS DERIVED AND NOT ASSERTED (2026-08-14, pre-PR review). Every D-check below calls
 * `renderPage` DIRECTLY, which bypasses the validation `render()` performs first. The fixture as
 * committed carries four things the current validator refuses — an underivable `"What it does"`
 * capability column and three contradictions with no `refutedQuote` — so the whole readability layer
 * was passing on an input from which the shipping path would have written no page at all. A
 * readability guarantee about a document that cannot be produced is not a guarantee. `D0` now asserts
 * the derived map validates clean, and every other check runs on that same map.
 *
 * The three repairs, none of which touches detection:
 *   • the harvest, per `DOC_AUDIT` above — the only one that changes a verdict, and on one node;
 *   • `refutedQuote` on each contradiction, per `REFUTED_QUOTES`;
 *   • the capability view's illegal column replaced by `Summary`, which is legal and derivable.
 *
 * The un-derived fixture is not thereby untested: `F1` below pins its fail-closed behaviour directly.
 */
function load() {
  const map = loadRaw();
  const byId = new Map(map.nodes.map((n) => [n.id, n]));

  for (const { nodeId, candidates } of DOC_AUDIT) {
    const node = byId.get(nodeId);
    assert.ok(node, `fixture precondition: the map must carry ${nodeId}`);
    node.docHarvest = { searched: [...DOC_SURFACES], candidates };
    // `asserts` obliges the extractor to PROMOTE the candidate into `claims[]` at the same path and
    // line — the validator enforces it, and it is the promotion, never the disposition, that
    // documents a node.
    for (const candidate of candidates.filter((c) => c.disposition === 'asserts')) {
      node.claims.push({
        path: candidate.path, line: candidate.line, text: candidate.quote,
        claimKind: 'doc', checked: true,
      });
    }
  }

  for (const [nodeId, refutedQuote] of REFUTED_QUOTES) {
    const node = byId.get(nodeId);
    assert.ok(node, `fixture precondition: the map must carry ${nodeId}`);
    for (const record of node.contradictions) record.refutedQuote = refutedQuote;
  }

  for (const view of map.views) {
    if (!Array.isArray(view.columns)) continue;
    view.columns = view.columns.map((c) => (c === 'What it does' ? 'Summary' : c));
  }
  return map;
}

const nodeIndex = (map) => new Map(map.nodes.map((n) => [n.id, n]));

/**
 * The 16 findings the held-out run produced, recorded here as the RAW baseline. If bucketing ever
 * changes detection — the one thing it may not do — this list is what notices, because it was
 * written down before the buckets existed.
 */
const BASELINE = [
  ['PHANTOM', 'env.codex_gate_max_rounds'],
  ['UNDOCUMENTED', 'artifact.assembled_packet'],
  ['UNDOCUMENTED', 'component.append_context_if_present'],
  ['UNDOCUMENTED', 'component.build_manifest'],
  ['UNDOCUMENTED', 'component.classify_verdict_file'],
  ['UNDOCUMENTED', 'component.main_dispatch'],
  ['UNDOCUMENTED', 'env.codex_gate_max_file_lines'],
  ['UNDOCUMENTED', 'env.codex_home_dir'],
  ['UNDOCUMENTED', 'external.git'],
  ['UNDOCUMENTED', 'external.jq'],
  ['UNDOCUMENTED', 'outcome.usage_error_exit_2'],
  ['UNDOCUMENTED', 'state.phase_snapshot'],
  ['STALE', 'component.emit_synthetic_approve'],
  ['STALE', 'mode.prepr'],
  ['STALE', 'outcome.overflow'],
  ['UNVERIFIED', 'external.codex_cli_contract_pins'],
];

/**
 * The baseline members the documentation audit refutes — **DERIVED from the audit, never listed
 * beside it.** A node is documented exactly when `DOC_AUDIT` gives it an `asserts` candidate, because
 * `load()` promotes precisely those into `claims[]`; deriving the set means a disposition change can
 * never leave a stale expectation behind it. This was a hardcoded single id until 2026-08-28, and the
 * round-7 gate is what made the coupling matter.
 *
 * The three, and why each is documented:
 *   • `component.append_context_if_present` — `SKILL.md:320`, the original member.
 *   • `external.git` — `README.md:93` gives an actual invocation, `git -C <repo> hash-object`.
 *   • `artifact.assembled_packet` — `SKILL.md:318` states what `phase-review` packets contain.
 *
 * The latter two were `mentions` until the owner ruled on 2026-08-28 (round-7 gate). C-018 reserves
 * `mentions` for text that predicates NOTHING of the item; both lines say what the item does, so both
 * are assertions and are promoted. Everything else in `BASELINE` survives unchanged.
 */
const DOCUMENTED_BY_AUDIT = new Set(
  DOC_AUDIT
    .filter(({ candidates }) => candidates.some((c) => c.disposition === 'asserts'))
    .map(({ nodeId }) => nodeId),
);
const EXPECTED = BASELINE.filter(([, id]) => !DOCUMENTED_BY_AUDIT.has(id));

/**
 * SKILL.md §3.1 obliges `candidates[]` to carry EVERY hit the search returned — the disposition is the
 * judgement, the candidate list is the RECORD, and a record that drops hits cannot be audited. Round 6
 * of the pre-PR gate found four nodes recording fewer hits than their own prose describes; nothing in
 * `validate()` can see the omission, so it is pinned here.
 */
const AUDIT_HIT_COUNTS = [
  ['component.append_context_if_present', 12],
  ['artifact.assembled_packet', 37],
  ['component.build_manifest', 3],
  ['component.classify_verdict_file', 8],
  ['component.main_dispatch', 24],
  ['env.codex_gate_max_file_lines', 5],
  ['env.codex_home_dir', 10],
  ['external.git', 16],
  ['external.jq', 4],
  ['outcome.usage_error_exit_2', 1],
  ['state.phase_snapshot', 2],
];

/**
 * THE AUDIT IS NOW EXHAUSTIVE ON ALL ELEVEN NODES (owner decision, 2026-08-28, on the round-8 gate).
 * It previously recorded only the hits each node's comment named while `load()` installed a COMPLETE
 * harvest attestation for every one — the C-018 overclaim one level up, in a fixture instead of a map,
 * and the shape that can preserve a false UNDOCUMENTED finding in the baseline. Every line of either
 * pinned surface matching a node's search terms is now recorded, 105 rows in total.
 *
 * A SWEEP IS NOT THE AUDIT, and this is the lesson that cost a rebuild: the record is the UNION of what
 * an identifier sweep returns AND what the audit found by READING. `SKILL.md:320` documents
 * `component.append_context_if_present` by its ROLE and contains neither of that node's identifiers —
 * generating candidates from the sweep alone silently dropped the one `asserts` that documents it, and
 * un-documented the node. Anything found by reading is seeded and can never be swept away.
 *
 * WHAT THE RE-HARVEST CHANGED, and it is worth stating because it is nearly nothing: no node's verdict
 * moved except `external.jq`, which the owner ruled on separately. The shallow records were shallow but
 * they were not wrong — the six undocumented nodes stay undocumented, each for the reason its own
 * comment already gave.
 */
test('A1 · every DOC_AUDIT entry records EVERY hit its search returned, not a selection', () => {
  const byNode = new Map(DOC_AUDIT.map(({ nodeId, candidates }) => [nodeId, candidates]));
  assert.equal(AUDIT_HIT_COUNTS.length, DOC_AUDIT.length,
    'every audited node must be pinned here — a node missing from this table is unchecked');
  for (const [nodeId, expected] of AUDIT_HIT_COUNTS) {
    const candidates = byNode.get(nodeId);
    assert.ok(candidates, `fixture precondition: DOC_AUDIT must carry ${nodeId}`);
    assert.equal(candidates.length, expected,
      `${nodeId}: SKILL.md §3.1 requires every returned hit be recorded; a selective record is `
      + 'unauditable and the validator cannot see the omission');
  }
});

// ─── the RAW layer ───────────────────────────────────────────────────────────────────────────────

test('D0 · the map every readability check runs on is one the CURRENT contract accepts', () => {
  // The precondition the whole file rests on, and the one it lacked. `renderPage` is called directly
  // below, so nothing else here would notice a map `render()` would refuse to write a page from —
  // and the committed fixture IS such a map: an underivable capability column and three
  // pre-C-019 contradictions. A readability guarantee about an unwritable document is not one.
  const raw = validate(loadRaw(), { repoRoot: REPO_ROOT }).errors;
  assert.ok(raw.length > 0,
    'the COMMITTED fixture is expected to be pre-contract — if it validates clean, this derivation '
    + 'is no longer needed and should be deleted rather than kept as decoration');

  assert.deepEqual(validate(load(), { repoRoot: REPO_ROOT }).errors, [],
    'the DERIVED map must validate clean, or every check below is measuring an unshippable input');
});

test('R1 · the fixture is the oracle run\'s subject: 91 nodes, 113 edges, 5 views, 14 sources', () => {
  const map = load();
  assert.equal(map.nodes.length, 91);
  assert.equal(map.edges.length, 113);
  assert.equal(map.views.length, 5);
  assert.equal(map.sources.length, 14);
  assert.equal(map.subject.slug, 'codex-gate');
});

test('R2 · recall is UNIVERSAL — every baseline finding but the audited one, on every node kind', () => {
  const { findings } = computeDrift(load());
  assert.deepEqual(findings.map((f) => [f.class, f.nodeId]), EXPECTED);
  assert.equal(findings.length, EXPECTED.length);

  // …and each one that is gone is gone for a REASON a reader can check, not because bucketing lost it:
  // the node carries a `doc` claim promoted from the harvest, so it is state 1 — documented — rather
  // than withheld. A withheld node would still appear in the coverage statement.
  const { coverage } = computeDrift(load());
  const byIdAudited = nodeIndex(load());
  assert.ok(DOCUMENTED_BY_AUDIT.size > 0, 'precondition: the audit must document something');
  for (const nodeId of DOCUMENTED_BY_AUDIT) {
    assert.ok(!coverage.withheld.some((w) => w.nodeId === nodeId),
      `${nodeId} is documented, not withheld — those are different verdicts`);
    assert.ok(byIdAudited.get(nodeId).claims.some((c) => c.claimKind === 'doc'),
      `and ${nodeId}'s documentation is on the node, at the line the audit names`);
  }

  // The point of "universal": findings still land on internal helpers, on external dependencies, on
  // env, modes, outcomes and state. Bucketing folds some of them away in the page; it removes none of
  // them here.
  //
  // `artifact` LEFT THIS LIST on 2026-08-28, and the reason is the ruling rather than a loss of
  // recall: `artifact.assembled_packet` was the only artifact-kind finding, and the audit now
  // documents it, so it is not accused. Asserted against the derived set rather than a frozen literal
  // so the next disposition change cannot leave a stale expectation here either.
  const byId = nodeIndex(load());
  const kinds = new Set(findings.map((f) => byId.get(f.nodeId).kind));
  assert.deepEqual([...kinds].sort(),
    ['component', 'env', 'external', 'mode', 'outcome', 'state']);
  assert.ok(DOCUMENTED_BY_AUDIT.has('artifact.assembled_packet'),
    'artifact is absent because the audit documents the only artifact-kind node, not because '
    + 'recall dropped one');
});

test('F1 · WITHOUT the harvest records the same fixture accuses nobody of being undocumented', () => {
  // ADR decision F, fail-closed, on a SECOND real subject. The committed fixture carries no
  // `docHarvest`, so every one of its 11 UNDOCUMENTED findings is withheld — not because the docs
  // changed, but because the map never recorded that it looked. The other five findings, which rest
  // on a written claim rather than on an absence, are untouched.
  const { findings, coverage } = computeDrift(loadRaw());
  assert.deepEqual(findings.map((f) => [f.class, f.nodeId]),
    BASELINE.filter(([cls]) => cls !== 'UNDOCUMENTED'));
  assert.equal(findings.length, 5);

  assert.deepEqual(coverage.established, []);
  assert.deepEqual(coverage.withheld.map((w) => w.nodeId),
    BASELINE.filter(([cls]) => cls === 'UNDOCUMENTED').map(([, id]) => id),
    'and every withheld accusation is stated as coverage, so none of them vanishes silently');
});

test('R3 · drift.json is unchanged by bucketing — no finding carries a bucket, or any new key', () => {
  const { findings } = computeDrift(load());
  for (const finding of findings) {
    // `refutedQuote` is the ONE extra key, it rides only on STALE, and it is contract rather than
    // presentation: ADR C-019 requires the finding to record WHICH words the evidence refutes, so a
    // reader of `drift.json` alone can tell the misdirected pointer from the sound one. A bucket
    // would be presentation, and there is still none.
    const expected = finding.class === 'STALE'
      ? ['citations', 'class', 'detail', 'label', 'nodeId', 'refutedQuote']
      : ['citations', 'class', 'detail', 'label', 'nodeId'];
    assert.deepEqual(Object.keys(finding).sort(), expected);
  }
  // Serialized exactly as `render` writes it, and the bytes are a pure function of the findings.
  const document = { schemaVersion: '1', subject: { slug: 'codex-gate', kind: 'skill' }, findings };
  assert.equal(serialize(document), serialize(JSON.parse(serialize(document))));
});

// ─── the READABILITY layer ───────────────────────────────────────────────────────────────────────

/** The page minus every disclosure region — literally what a reader sees before expanding anything. */
const unexpanded = (html) => html.replace(/<details[\s\S]*?<\/details>/g, '');

test('D1 · the whole drift lane is still in the page — every scored finding, none dropped', () => {
  const map = load();
  const { findings } = computeDrift(map);
  const html = renderPage(map, findings, { generatedAt: 'STAMP' });

  assert.equal(html.split('data-carto-lane="drift"').length - 1, 1);
  for (const finding of findings) {
    assert.ok(html.includes(`<code>${finding.nodeId}</code>`), `${finding.nodeId} missing from the page`);
  }
  assert.ok(html.includes(`${EXPECTED.length} findings`),
    `the lane must state the RAW count (${EXPECTED.length})`);
});

test('D2 · every high-value and every ambiguous finding is visible WITHOUT expanding anything', () => {
  const map = load();
  const { findings } = computeDrift(map);
  const byId = nodeIndex(map);
  const visible = unexpanded(renderPage(map, findings, { generatedAt: 'STAMP' }));

  for (const finding of findings) {
    const bucket = bucketForFinding(finding, byId.get(finding.nodeId));
    if (bucket === 'implementation-detail') continue;
    assert.ok(
      visible.includes(`<code>${finding.nodeId}</code>`),
      `${finding.class} ${finding.nodeId} (${bucket}) must be readable without expanding a group`,
    );
  }
});

test('D3 · BOTH external prerequisites were WITHDRAWN by the audit — not hidden, and checkably so', () => {
  // THIS TEST LOST ITS ORIGINAL SUBJECT, and that is the finding rather than a reason to delete it.
  // It read "`jq` — an undocumented hard prerequisite — surfaces for review, never as 'just external'",
  // and it existed because bucketing must never fold an external dependency out of sight. After the
  // owner's 2026-08-28 disposition ruling neither `external.jq` nor `external.git` is accused at all:
  // `SKILL.md` prescribes jq for reading verdicts, blockers, groundings and reports (:72, :89, :113,
  // :177) and `README.md:93`/:98 give real `git … hash-object` invocations, so under C-018 every one
  // of those is text saying what the item DOES, and all are promoted into `claims[]`.
  //
  // The property worth keeping is the DISTINCTION the old test policed: an accusation that is gone
  // because the node is documented is not the same as one bucketing folded away. So it is asserted in
  // that direction — withdrawn, and traceable to the audit that withdrew it.
  const map = load();
  const { findings } = computeDrift(map);
  const byId = nodeIndex(map);

  for (const nodeId of ['external.jq', 'external.git']) {
    assert.ok(!findings.some((f) => f.nodeId === nodeId),
      `${nodeId} is documented since the 2026-08-28 ruling — it must carry no finding at all`);
    assert.ok(DOCUMENTED_BY_AUDIT.has(nodeId),
      `${nodeId}'s withdrawal must be traceable to the AUDIT, or it is indistinguishable from a drop`);
    assert.ok(byId.get(nodeId).claims.some((c) => c.claimKind === 'doc'),
      `${nodeId} must carry the promoted doc claim the withdrawal rests on`);
  }

  // …AND THE GUARANTEE THE OLD TEST PROTECTED IS STILL TESTED, on the external node that is still
  // accused: `external.codex_cli_contract_pins` carries UNVERIFIED, and an external dependency the
  // audit does not document must reach the reader WITHOUT expanding anything. That is the property —
  // bucketing may fold internal noise, never an external prerequisite — and it survives the ruling.
  const stillAccused = findings.filter((f) => byId.get(f.nodeId).kind === 'external');
  assert.ok(stillAccused.length > 0,
    'precondition: an accused external node must exist, or this guarantee is untested');
  const visible = unexpanded(renderPage(map, findings, { generatedAt: 'STAMP' }));
  for (const f of stillAccused) {
    assert.ok(visible.includes(`<code>${f.nodeId}</code>`),
      `${f.nodeId} is an accused external prerequisite — it must be visible without expanding`);
  }
});

test('D4 · the two findings the oracle actually wanted are in `likely-contract`', () => {
  const map = load();
  const byId = nodeIndex(map);
  const { findings } = computeDrift(map);
  const bucketOf = (id) => bucketForFinding(findings.find((f) => f.nodeId === id), byId.get(id));

  // Both are `env` nodes sitting in the CORE lane — the exact case that makes lane-demotion of a
  // vocabulary kind a false negative rather than a tidy-up.
  for (const id of ['env.codex_home_dir', 'env.codex_gate_max_file_lines']) {
    assert.equal(byId.get(id).lane, 'core', `fixture precondition: ${id} is drawn in the core lane`);
    assert.equal(bucketOf(id), 'likely-contract', id);
  }
  assert.equal(bucketOf('env.codex_gate_max_rounds'), 'likely-contract', 'the PHANTOM');
});

test('D5 · PHANTOM and STALE are never folded away — including the STALE on an internal helper', () => {
  const map = load();
  const byId = nodeIndex(map);
  const { findings } = computeDrift(map);
  const visible = unexpanded(renderPage(map, findings, { generatedAt: 'STAMP' }));

  for (const finding of findings.filter((f) => f.class !== 'UNDOCUMENTED')) {
    assert.ok(visible.includes(`<code>${finding.nodeId}</code>`), `${finding.class} ${finding.nodeId} was folded away`);
  }
  // The run's most consequential finding sits on `component × core`, the one collapsible cell — so
  // it is the class floor, and nothing else, that keeps it in front of a reader.
  const emit = byId.get('component.emit_synthetic_approve');
  assert.equal(emit.kind, 'component');
  assert.equal(emit.lane, 'core');
  assert.equal(bucketForFinding({ class: 'UNDOCUMENTED' }, emit), 'implementation-detail');
  assert.equal(bucketForFinding({ class: 'STALE' }, emit), 'ambiguous-review');
});

test('D6 · the noise the run surfaced IS folded away — and only internal core nouns are', () => {
  const map = load();
  const byId = nodeIndex(map);
  const { findings } = computeDrift(map);
  const groups = new Map(groupByAttention(findings, byId).map((g) => [g.bucket, g.findings.map((f) => f.nodeId)]));

  // THREE, and it has shrunk twice for the same reason both times: a node the audit documents is not
  // accused at all, so it never reaches a bucket. `component.append_context_if_present` left on the
  // original audit; `artifact.assembled_packet` left on the 2026-08-28 disposition ruling, because
  // `SKILL.md:318` states what `phase-review` packets contain and that is an assertion, not a
  // mention. The folded set shrank because accusations left the map, not because bucketing started
  // hiding more — and `DOCUMENTED_BY_AUDIT` is the derived list that says which.
  assert.deepEqual(groups.get('implementation-detail').sort(), [
    'component.build_manifest',
    'component.classify_verdict_file',
    'state.phase_snapshot',
  ]);
  // Most of the scored set stays in front of the reader — and the lane is no longer 11 internals deep.
  // Both numbers are derived from the scored set, so a disposition ruling moves them together rather
  // than leaving one of them stale (the failure mode the round-7 gate caught here).
  const folded = groups.get('implementation-detail').length;
  const upFront = groups.get('likely-contract').length + groups.get('ambiguous-review').length;
  assert.equal(folded, 3);
  assert.equal(upFront, EXPECTED.length - folded);
});

test('D7 · map.md still states EVERY finding in full, with no disclosure anywhere', () => {
  const map = load();
  const { findings } = computeDrift(map);
  const md = toMarkdown(map, findings, { generatedAt: 'STAMP' });

  assert.doesNotMatch(md, /<details/i);
  for (const [cls, id] of EXPECTED) {
    assert.ok(md.includes(`\`${id}\``), `${id} missing from map.md`);
    assert.ok(md.includes(`**\`${cls}\`**`), `${cls} missing from map.md`);
  }
  assert.equal((md.match(/ · attention: /g) ?? []).length, EXPECTED.length,
    'every finding must carry its bucket');
});
