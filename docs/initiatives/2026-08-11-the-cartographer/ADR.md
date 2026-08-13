# ADR — `the-cartographer`

**Date:** 2026-08-11 · **Status:** accepted (owner approved the PDR) · **Branch:** `feat/the-cartographer`

Decisions are numbered `C-NNN` and are append-only — never renumber. Each records the decision, why,
and what would justify revisiting it. Companion to [PDR.md](./PDR.md).

---

## C-001 · Spec-first pipeline (Option A-refined), not a bespoke graph engine

**Decision.** `EXTRACT → map.json → DIFF → RENDER`. Extraction is the only agent-driven stage; diff and
render are deterministic code.

**Why.** Grounded via `codex-gate question` (**GROUNDED**, `settledByCanon: false`). Codex: *"Option A,
refined as a standalone spec-first pipeline: generated normalized map snapshot, Mermaid when Artifact
hosting is available, and a mandatory text-first Markdown report."* Mermaid supplies mature auto-layout,
which is what makes regeneration cheap — the core requirement. A durable snapshot is what makes drift
computable at all.

**Revisit if.** Identical offline graphics become non-negotiable across every view — then evaluate C-010
before building anything bespoke.

## C-002 · A bounded inline-SVG hero for the Overview view

**Decision.** The Overview renders as generated inline SVG via a lane layout capped at 15 nodes; all
other graph views use mermaid.

**Why.** Proposed by Claude, not Codex, and approved by the owner. Option A's one real weakness is that
mermaid executes in the Artifact host, so a local `file://` page shows raw text. Making the single most
important view host-independent removes that weakness where it matters most, at a bounded cost: lanes
plus a node cap make the layout ~100 lines rather than a general DAG engine. The owner's mid-design
steer — *"highly visual, a way for humans to understand a system at a glance"* — makes the Overview the
view that must never fail to draw.

**Revisit if.** 15 nodes proves too tight on a real subject in Phase 1. Raise it with measured evidence
from `codex-gate`, not by guessing.

## C-003 · `map.json` is generated IR, never hand-edited

**Decision.** Stable derived IDs, sorted serialization, per-source `sha256`, `schemaVersion` +
`extractorVersion`, and **no wall-clock timestamp anywhere in the file**. Generation time is rendered
into `map.html` / `map.md` only.

**Why.** Codex: *"Treat map.json as generated audit/render IR, not behavioral canon … with no
observation timestamp churn."* A timestamp inside the snapshot would make every regeneration report
spurious structural drift, destroying Phase 2. Enforced by a serializer guard that throws on any
ISO-8601-shaped string (C-006), not by discipline.

**Revisit if.** Never for the timestamp rule — it is load-bearing for Phase 2.

## C-004 · `drift.json` is derived output, not part of the snapshot

**Decision.** `map.json` holds only extraction (nodes, edges, evidence, claims, sources, coverage).
Drift findings are computed into a separate `drift.json`.

**Why.** Intra-run drift is fully derivable from `map.json` alone. Keeping it out keeps the snapshot a
clean function of the source, so editing a doc does not perturb the structural diff that Phase 2 runs
over the snapshot.

## C-005 · PHANTOM/UNDOCUMENTED are mechanical; STALE is extractor-asserted

**Decision.** `diff.mjs` derives PHANTOM and UNDOCUMENTED from set membership alone. STALE is reported
**only** where the extractor emitted a `contradictions[]` record carrying both citations and a stated
conflict; a record missing either citation fails validation.

**Why.** A contradiction between a documented value and observed behaviour needs judgement and cannot
be computed from empty-or-not. Writing it as if it were a rule would smuggle judgement in behind a
mechanical-looking classifier. Separating them keeps the mechanical classes fully testable and makes
the judgement-based class auditable — every STALE finding shows its two citations.

**Corollary.** `inferred: true` nodes are excluded from every class, and a node whose claims are all
`checked: false` yields UNVERIFIED rather than PHANTOM. The audit never accuses on a vibe.

## C-006 · No `map.schema.json`; `validate.mjs` is the single source of truth

**Decision.** The IR contract is defined and enforced by hand-written checks in `validate.mjs`. No
separate JSON-Schema file ships.

**Why.** A schema file plus a validator is two artifacts that must agree — precisely the drift class
this skill exists to detect. One executable source of truth cannot drift from itself, and a
hand-written validator avoids adding a JSON-Schema dependency to a package whose only tools are node
and `jq`. The human-readable contract lives in PDR §7.

**Revisit if.** Third-party producers ever need to emit `map.json`, at which point a published schema
earns its keep.

**Amendment (2026-08-13).** The contract's SHAPE half — what a value in the IR may BE — now lives in
`references/canonical.mjs`, which `validate.mjs` imports and applies to its input before checking
anything. This is not a second artifact to keep in agreement; it is the opposite. Phases 1, 2 and 3
each closed a review round on the same defect: the validator read properties with plain gets while
`diff.mjs` and the renderers read own descriptors, so a map could be `validate().ok === true` and then
make a consumer throw, or serialize to different data than the data that was validated. Each phase
hardened one module's private reader, and the finding came back wearing a different object. Hoisting
that reader into one module the whole pipeline ingests through — `validate`, `computeDrift`,
`resolveView`/`layoutHero`, `normalize`/`serialize`, `checkFreshness` — is what makes "one executable
source of truth" true across the pipeline rather than inside one file. `validate.mjs` remains the
single source of the IR's SCHEMA (required fields, closed sets, derivation, provenance, coverage,
reference-list semantics, the C-002 bound), and PDR §7.1 rule 12 is its human-readable half.

## C-007 · `map.html` carries its own token block; no import from the-foreman

**Decision.** Self-contained CSS tokens with light/dark via `prefers-color-scheme` plus
`:root[data-theme=…]` overrides. No dependency on the-foreman's `style.css`.

**Why.** Reuse would be marginally cheaper but recreates the coupling that got Option C rejected — a
standalone skill's output should not break when a sibling skill restyles. Independence is the reason
this is not built inside the foreman renderer.

## C-008 · The secret-scan pattern is copied, not imported

**Decision.** `the-cartographer` ships its own `secret-scan.mjs` following the-foreman's proven
pattern, and fails closed before writing either output.

**Why.** Same independence rationale as C-007. Copying ~15 lines of regexes is cheaper than a
cross-skill import that makes the two skills co-release. Note the inherited email rule rejects any
email-shaped string, so code ownership must render as handles, not addresses.

## C-009 · Skill source in `plugin/skills/`; per-subject snapshots in the subject's own repo

**Decision.** Skill at `plugin/skills/the-cartographer/`. Outputs at `<subject-repo>/.maps/<slug>/`,
committed.

**Why.** Codex: *"Place the maintained skill source under plugin/skills/<name>; use ~/.claude/skills
only as the documented mutually exclusive personal symlink install mode"* and *"Keep each subject's
diffed snapshot with that subject's shared source repository, not in an install directory."* The repo
README warns against dual loading. Committing the snapshot is required — it is exactly what Phase 2's
structural diff compares against.

## C-010 · Graphviz/DOT (Option E) rejected on a verified missing prerequisite

**Decision.** Not adopted for Phase 1. Recorded as the first alternative to evaluate if C-002's bound
fails or offline graphics become mandatory everywhere.

**Why.** Codex surfaced it as the genuine middle path — mature auto-layout producing portable static
SVG with no host dependency. Rejected on verification, not preference: `dot` is not installed on the
owner's machine (`which dot` → not found; absent from `brew list`), and the plugin is deliberately
dependency-light. A map skill that silently stops drawing when a binary is missing is worse than one
that never promised the picture.

**Revisit if.** Mermaid's host dependence becomes intolerable in practice, or the 15-node hero bound
proves unworkable. Then Option E before Option B.

## C-011 · Extraction is not byte-deterministic, and the design says so

**Decision.** Structural diff (Phase 2) compares stable IDs and typed attributes only; prose-only
changes to `summary` / `note` / `text` are classified `cosmetic` and excluded from the drift verdict.
The determinism test targets the **serializer**, not the model. The extractor is validated against a
held-out oracle instead.

**Why.** An agent-driven extractor may word a summary differently across runs over identical source.
Pretending otherwise would surface every regeneration as change and make Phase 2 useless. Naming the
limitation lets the diff be built around it.

## C-012 · The acceptance oracle is held-out, not self-graded

**Decision.** Phase 1 ships only if the extractor independently rediscovers all six findings from four
defect groups in `codex-gate` (PDR §1): 1 PHANTOM, 3 UNDOCUMENTED, 2 STALE — without being told them.

**Why.** Extraction quality is the entire product; a sloppy extractor produces a confident wrong map.
These defects were found by an independent scout before this skill existed, which makes them a genuine
held-out test rather than a rubric written to match the implementation.

**Amendment (2026-08-11).** The oracle originally cited the **personally-installed** copy at
`~/.claude/skills/codex-gate/`, while the plan targets the **repo** copy at `plugin/skills/codex-gate/`.
The two have drifted, so a *correct* extraction would have failed the gate. Anchors are now pinned to
the repo copy at `ac0daf0` and re-verified before scoring. Scoring is exact in both directions — full
recall **and** no false accusations — with a two-attempt cap before stopping and surfacing.

## C-013 · The execution plan states test intent, not implementation code

**Decision.** The plan carries exact file paths, exact interface signatures, and named test conditions
per task. It does **not** carry literal implementation code. Implementation defects are caught by
RED-first TDD and the per-phase `codex-gate phase-start` / `phase-review` calls.

**Why.** `codex-gate bundle` returned BLOCK three times against a code-complete draft — 16, then 18,
then 15 blockers, all `agent_fixable`, none decision-class. The gate was doing real work: it caught a
CLI main guard that made every documented invocation a silent no-op, two artifacts written unscanned
despite a claimed fail-closed guard, an injectable Markdown report, and an acceptance oracle citing the
wrong copy of `codex-gate` (see C-012's amendment). But by round 3 the findings were overwhelmingly
defects in code that did not exist yet — a fixture path mismatch, a golden file compared against an
injected timestamp, assertions not matching exact error strings, sort tie-breaks, hash-width collision
odds. Every fix was itself new unreviewed code, so each round produced a fresh crop and the loop did not
converge.

Those are RED-test-in-seconds defects. Reviewing them at plan altitude is unbounded; the lifecycle
already has the right place for them, and there a failing test *proves* the fix rather than a reviewer
asserting it. This contradicts `writing-plans`' rule that every step ship runnable code, which is why it
was put to the owner as a decision-fork rather than taken unilaterally.

**Revisit if.** A phase's implementer produces work that the per-phase gates repeatedly fail to
converge — that would be evidence the intent-level spec is too thin, and the remedy would be more
precise *conditions*, not restored code.

## C-014 · Only `claimKind: "doc"` counts as documentation for PHANTOM / UNDOCUMENTED

**Decision.** PHANTOM and UNDOCUMENTED are computed against `doc` claims **only** — SKILL.md, README,
and dedicated documentation blocks. `code-comment` and `user-message` claims are still recorded on the
node, still rendered in both outputs, and can still raise STALE through a `contradictions` record — but
they do **not** make a capability "documented".

**Why.** Owner decision, 2026-08-11, on a decision-class blocker from `codex-gate`. Under the previous
all-claims model a behaviour-asserting comment counted as documentation, and `codex-gate.sh:6` is a
usage header asserting the env vars — so `CODEX_GATE_RUNS` would not have been UNDOCUMENTED and the
held-out oracle (C-012) would have been unstable. Beyond the oracle, the plain-language reading agrees:
a comment buried in a script is not documentation for anyone reading the docs. The alternative makes the
audit quietest on exactly the subjects that most need it, and a quiet audit looks like a clean system.

**Accepted cost.** A capability documented *only* in a well-written code comment is reported as
undocumented. That is the intended reading, not a false positive.

## C-015 · The acceptance gate requires depiction, not only defect-finding

**Decision.** Phase 1's acceptance adds a **coverage floor** on top of the six oracle findings: the
`codex-gate` map must depict all 8 modes as nodes, represent the 3 outcome vocabularies, carry the
mode → emit-function dispatch edges, and render an overview hero.

**Why.** Owner decision, 2026-08-11, on the second decision-class blocker. The gate as written checked
six drift findings plus reconstruction of *whatever the extractor emitted* — so a map that found every
defect and depicted almost nothing else would have passed while failing the product's stated purpose
("a way for humans to understand a system / flow / architecture / feature at a glance", owner, twice).
The gate tested the audit and not the map.

**Accepted cost.** More to specify, more that can fail the phase, and the floor's counts are themselves
count-bearing claims that must be re-verified against the subject if `codex-gate` changes — the same
staleness class this skill exists to detect, so the floor is derived from the source at scoring time
rather than trusted from this document.

## C-016 · Phases 1–2 are implemented before the plan bundle reaches APPROVE

**Decision.** Build Phase 1 (serializer, validator, freshness) and Phase 2 (drift engine) with TDD now,
carrying the plan gate's 11 open blockers in as **test intent**. Each phase still runs
`codex-gate phase-start` / `phase-review`. Phases 3–5 stay unbuilt pending re-assessment. Owner
decision, 2026-08-11.

**Why.** `codex-gate bundle` ran six rounds without converging: **16 → 18 → 15** against a code-complete
draft, then **12 → 12 → 11** after C-013 lowered the altitude. Findings were never repeats — but by
round 3 of the second series, three of them were defects introduced by the previous round's *fixes*
(an edge-ID rule that collides for parallel typed edges, a fixture described as three cases while
enumerating four, two edits to the same task disagreeing on absolute vs relative paths). The author had
become a comparable source of new defects to the ones being closed.

The root cause is that this contract — an IR carrying citation provenance, path containment,
`claimKind`/source-role binding and canonical IDs — is only *definitively* checkable in executable form.
"Edge IDs collide for parallel typed edges" is a RED test in seconds; in prose it stayed invisible across
two review rounds. A plan gate cannot converge on a contract whose correctness conditions are
combinatorial.

**Why this is not weakening the gate.** Every remaining blocker names Phase 1–2 modules, and
`phase-review` inspects real code and real test output — strictly more evidence than reviewing prose
about code. The gate keeps its teeth; it simply gets something executable to bite.

**Accepted cost.** Implementation begins without a formally APPROVED bundle, departing from
the-foreman's stage order. Scope discipline is the mitigation: Phases 1–2 only, then re-assess before
Phase 3. **No commits** — the plan-approval gate never ran, so per-phase local commits are not
authorized; the work stays uncommitted until the owner grants it.

**Revisit if.** Phase 1's `phase-review` also fails to converge — that would indicate the problem is the
specification's substance rather than its medium, and the remedy would be scope reduction, not another
change of venue.
