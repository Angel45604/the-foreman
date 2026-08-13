I have independently re-verified the load-bearing claims. Here is the deliverable.

---

# `verified-contracts.md` — the-steward Phase 0 (code-first descent)

**Status:** Phase 0 evidence record. Supersedes prose-derived contract claims in PDR.md / ADR.md.
**Method:** every line below was produced by running a command or reading a primary source (a shipped binary, vendor documentation, or `git`/POSIX behavior). Prose vendor docs were used only where explicitly labelled, and in three places they were found wrong.
**Scope honesty up front:** one of the three surfaces (Codex) produced **almost no positive contract**. No Codex hook was ever made to fire. Everything in §2.1 is a *declared* wire format read out of the binary, never a payload observed on the wire. Read that section as "what the binary says it will send," not "what it sends."

---

## 0. v0 RELEVANCE MAP — added 2026-08-11, read this first

**This document is unchanged as an evidence record and nothing in it has been deleted.** What
changed is the design it was written to serve. On 2026-08-11, after five review rounds produced ~82
findings — **every one of them in enforcement plumbing and none in the product** — the owner cut all
enforcement machinery. v0 is `scan` / `generate` / `check` / `doctor`, read-only by default: no git hook,
no install transaction, no rollback, no launcher, no interpreter pin, no tiers, no CI generation, no
harness-native hooks. See [`PDR.md`](./PDR.md) and the *Removed in v0* table in [`ADR.md`](./ADR.md).

Several sections below therefore pin contracts for features that no longer exist. **Those findings
are the reason the features were cut**, so they are annotated, not removed.

| Section | v0 status |
|---|---|
| §1 Version pins | **Partly load-bearing** — the Python / git / CLT rows justify ADR-1's floor assertion. The two harness CLI rows are historical |
| §2.1 Codex harness | **Historical.** The finding that `<repo>/.codex/` is inert is *why* harness hooks are gone. Nothing in v0 reads or writes `.codex/` |
| §2.2 Claude Code harness | **Historical**, and — corrected in round 6 — **it contains no evidence for ADR-15.** This row previously read *"§2.2's evidence that Claude Code reads `CLAUDE.md` and not `AGENTS.md` underpins ADR-15."* There is no such evidence here: the claim appears only in §2.2's own banner, with no command, no output, and no version-pinned citation. Every probe in §2.2 is about hooks. ADR-15's marker stays *[observed, not re-verified]*, and **escalation E1 is ruled *proceed with stated risk* (owner, 2026-08-12)**: deleting the region protocol and the `@AGENTS.md` import dropped the *import-expansion* contract, but v0 still generates `CLAUDE.md` on the unprobed file-loading claim, so the dependency is reduced, not removed |
| §2.3.1–§2.3.2 Interpreter facts | **Load-bearing** — the divergence is why ADR-1 asserts a floor loudly instead of pinning |
| §2.3.3 Bytecode | **Load-bearing** — the normative mechanism and the dual-interpreter fixture (ADR-1) |
| §2.3.4 No atomic multi-file primitive | **Load-bearing in part** — `chmod` before `os.replace` survives as the atomic-write helper rule (ADR-20). The atomicity *contract* is gone, and **temp-in-target-directory was replaced on 2026-08-12 by temp-at-repository-root**: staging inside `tools/steward/` let a kill leave an unrecorded child that permanently reads as a foreign-core collision |
| §2.3.5 Parsers at the floor | **Load-bearing** — no TOML, no YAML at 3.9 (ADR-1, ADR-2) |
| §2.3.6 Git worktree facts | **Load-bearing in part** — `--show-toplevel` resolution and the sound realpath predicate (ADR-26). Everything about `hooks`, the pin, and common-dir vs per-worktree state is historical |
| §2.3.7 `.gitattributes` | **Load-bearing** — the bare form is the one v0 uses. `.gitattributes` is an ordinary owned artifact in ADR-20's ordinary three states — created when absent, re-rendered when ours, and otherwise left alone with the exact bare-form line **printed as an advisory** (owner, 2026-08-11) |
| §2.3.8 A hook cannot prompt | **Historical** — there is no hook. Retained: it is why hook-time consent was never a policy question |
| §2.3.9 Journal-first recovery | **Historical** — no install transaction, no journal, no recovery. Retained: the measured "no partial state" falsification is why v0 writes manifest-first instead of claiming atomicity (ADR-20) |
| §2.3.10 CI evidence | **Historical** — v0 generates no CI. Retained: "presence check wrong on 8/9 cases" is the sharpest available proof of ADR-28's thesis that presence is not evidence |
| **§2.3.11 Reference-repo corpus, freshness, churn** | **Load-bearing — added 2026-08-11.** The measurements behind ADR-8, ADR-9 and ADR-10, consolidated here because their evidence markers pointed at this document and it did not contain them. **Provenance differs per row** (row 1 re-verified; rows 2–6 observed and not re-run), which is why ADR-8 and ADR-9 read *[observed, not re-verified]* |
| §3 Blockers 1, 3, 4, 5 + the new blocker | **Historical** — each resolved a question about consent-at-hook-time, tiers, CI, or install atomicity, none of which v0 has. **Blocker 2 (`.steward.json` at the root, tracked) is load-bearing** (ADR-2) |
| §4 ADR impact | **Historical as a table of required changes** — many rows target ADRs that no longer exist. The *findings* stand; see the banner at the head of §4 |
| §5 Still unverifiable | **Two owner calls were opened in round 6 and both are now ruled (2026-08-12).** This row and §5's banner both said *"nothing in §5 needs an owner call for v0"*; that was true only of the six items §5 already listed. It missed the two contracts v0 depended on — **E1** (ADR-15's `CLAUDE.md` / `@AGENTS.md` import) and **E2** (ADR-17's 32 KiB document cap) — neither of which has a probe anywhere in this document. **E1: proceed with stated risk** — the import and the region are deleted, but the generated `CLAUDE.md` still rests on the unprobed file-loading claim. **E2: kept as a `warn`**, upgrading to `error` only on verification. Neither ruling asserts the unprobed claim is true, so this document still needs to contain nothing new |
| Appendix — Phase-0 working artifacts | **Historical.** Every row describes a throwaway probe, and several cite decisions and plan-task ids that no longer exist; annotated in place rather than deleted |
| Provenance (final paragraph) | **Load-bearing as a method statement** — it is what makes "re-run by the synthesizer" a checkable distinction, which §2.3.11 relies on row by row |

**The cross-cutting recommendation at the end of §4 is the one thing that grew in importance.**
"Make the doctor prove firing, not presence" generalizes in v0 to ADR-28: every finding carries its
evidence tier, and an *inspected* finding is never reported as proof. v0 installs nothing that can
fire, so A3 is reported by inspection — labelled as such, every time.

---

## 1. VERSION PINS

Every contract in this document is tied to exactly these versions. A bump to any of them invalidates the section that depends on it, and the doctor must re-derive rather than trust this file.

> **How v1 discharges this obligation: by not depending on it.** The version-binding machinery once specified here — per-harness `contractVersion` / `probedVersion` / probe outcome in the manifest, a live-version comparison in `doctor`, and a `steward reprobe <harness>` command — is **removed** (harness-native hooks deferred to v2; ADR-3, ADR-29, P1.5b, P6.4b). **v1 generates nothing that any harness executes, so no harness contract in §2.1 or §2.2 is load-bearing for shipped behavior**, and a version bump cannot silently invalidate a claim v1 does not make. The one harness fact v1 still relies on is Codex's `project_doc_max_bytes` document cap (ADR-17), which is a size check on `AGENTS.md`. **The obligation returns in full with v2**, and this section is what it re-derives from. *(Round 6: "the one harness fact" was wrong on both counts — there were
**two** (ADR-15's `CLAUDE.md` import as well as ADR-17's cap), and **neither is verified in this
document**. Round 7, 2026-08-12: the owner dropped the import entirely and downgraded the cap check
to a `warn`, so the count is back to one — and that one no longer fails a repository.)*

**Redaction status of this document.** User, home, repository, worktree, session, cwd, and scratch paths are placeholdered (`<user>`, `<HOME>`, `<REFERENCE-REPO>`, `<worktree>`, `<SCRATCH>`, `<REDACT>`), and every live session id, prompt id, and transcript path captured in §2.2.7 was replaced with a placeholder before this file was written — the raw capture was deleted and never committed. The reference monorepo is never named, and **no repo-internal source, doc, or workflow filename is reproduced.** Two categories are deliberately retained rather than redacted, because each is evidence and neither identifies the repository: **(1)** the disabled-hook artifact name, reproduced **verbatim including its literal timestamp** — `post-checkout.gitbutler-disabled-20260624-181323` (§2.3.6, §4) — it is the proof that another tool renames hooks, which is why ADR-5 needs a `.legacy` collision policy, and the timestamp identifies a third-party tool's run, not the repository; and **(2)** the conventional root dotfile names in Blocker 2 (`.dockerignore`, `.editorconfig`, `.mcp.json`, `.nvmrc`, `.prettierrc.json`) — they are ecosystem conventions found in thousands of repositories, cited only to justify a root-level manifest path.

| Component | Version | How established | Notes |
|---|---|---|---|
| Claude Code CLI | `2.1.201 (Claude Code)` | `claude --version` | Binary at `<HOME>/.local/share/claude/versions/2.1.201`, Mach-O arm64, 221 MB. All §2.2 contracts extracted from this binary. |
| Codex CLI | `codex-cli 0.147.0-alpha.6.5` | `/Applications/ChatGPT.app/Contents/Resources/codex --version` | **Not on `PATH`.** `which codex` → `codex not found`. Only copy is inside ChatGPT.app, located via `CODEX_CLI_PATH` in `~/.codex/config.toml`. |
| Python — floor | `Python 3.9.6` | `/usr/bin/python3 -V` | Apple CLT. **Not a plain interpreter — see §2.3.1.** |
| Python — PATH | `Python 3.13.5` | `python3 -V` | python.org framework build at `/Library/Frameworks/Python.framework/Versions/3.13`, **not Homebrew**. |
| Python — other on PATH | `3.14.2` (Homebrew), `3.13.5` (`/usr/local/bin`) | `which -a python3` | Four `python3` on PATH, in this order: `/Library/Frameworks/.../3.13/bin`, `/opt/homebrew/bin`, `/usr/local/bin`, `/usr/bin`. |
| git | `git version 2.50.1 (Apple Git-155)` | `git --version` | All `rev-parse`/`check-attr`/worktree behavior below. |
| Xcode CLT | `26.3.0.0.1.1771626560` | `pkgutil --pkg-info=com.apple.pkg.CLTools_Executables` | `xcode-select -p` = `/Library/Developer/CommandLineTools`. Xcode.app absent. |
| Reference monorepo | `<REFERENCE-REPO>`, **106 worktrees** | `git worktree list \| wc -l` → `106` | Read-only throughout. |

**Single-machine caveat.** This is one macOS arm64 machine. Every claim about interpreter layout, CLT patching, and launchd PATH is a single data point and is labelled as such where it matters.

---

## 2. VERIFIED CONTRACTS

### 2.1 Codex harness — `codex-cli 0.147.0-alpha.6.5`

> **HISTORICAL for v0 (annotated 2026-08-11).** v0 reads and writes nothing under `.codex/` and
> generates no harness hook config, so no contract in this section is load-bearing for shipped
> behavior. **§2.1.1 is nevertheless the most consequential finding in the whole descent** — a
> harness layer that looked configured and was inert is the exact disease the product detects, and
> it is what removed harness hooks from the design. The only Codex fact v0 still depends on is the
> `project_doc_max_bytes` document cap (ADR-17), which is a size check on `AGENTS.md`.
>
> **CORRECTION, round 6: that cap is not verified anywhere in this document.** There is no probe of
> `project_doc_max_bytes`, no measured truncation, and no version-pinned citation for the 32 KiB
> value or for the claim that overflow is *silent* — the number appears in this file only in cross
> references that cite ADR-17, which cited this file back. Given this section's own opening
> admission that the Codex surface produced **almost no positive contract** and that nothing here
> was observed on the wire, that circle should have been visible sooner. It was **ADR-23 escalation
> E2**; the owner ruled on 2026-08-12 that the check **stays at `warn`** — ADR-17 keeps *[observed,
> not re-verified]*, nothing is gated, and v0 fails no repository on this number.
> **What would upgrade it to `error`:** read the default out of the pinned codex-cli
> 0.147.0-alpha.6.5 binary (§1) the same way §2.1.2's schemas were extracted, then feed it an
> `AGENTS.md` over the cap and observe whether the excess is dropped and whether anything is said
> about it. Record the command and the output here.

#### 2.1.1 The headline: the repo layer is not read at all

This is the single most consequential finding in Phase 0.

> `<repo>/.codex/config.toml` and `<repo>/.codex/hooks.json` are **not read, not parsed, and not diagnosed** by codex-cli 0.147.0-alpha.6.5.

Established by four independent probes:

```
# 1. A bogus key in a repo-level .codex/config.toml survives --strict-config
$ codex exec -C $W -s read-only --strict-config "reply OK"
  exit=0, no error about `totally_bogus_key_xyz`

# 2. ...and the repo-level value is ignored in favour of the user-level one
  repo .codex/config.toml said: model_reasoning_effort = "low"
  session banner printed:       reasoning effort: ultra   (the ~/.codex value)

# 3. Control proving --strict-config actually works, in CODEX_HOME
$ codex exec --strict-config   # same bogus key, but in $CODEX_HOME/config.toml
  Error loading config.toml: ...:1:1: unknown configuration field `bogus_key_abc`

# 4. Deliberately malformed repo hooks.json produces zero diagnostics
$ printf '{ this is not json' > $W/.codex/hooks.json
$ codex exec -C $W -s read-only "reply OK"
  exit=0; grep -i "hook|json|error|warn|invalid|parse" over full output -> nothing
```

Corroborated at the binary level:

```
'.codex/hooks.json' literal present in binary: False
```

Only `hooks/hooks.json` (the *plugin* path) and a bare `hooks.json` (used by
`external-agent-migration/src/hooks_common.rs`, the Claude-Code migration importer) exist as strings.

**Consequence:** the file ADR-3 specified is inert. It would be written, it would look installed, and nothing reads it. This is the exact failure mode the project brief names as its worst outcome. **Resolution (owner, 2026-08-11): the file is never generated — ADR-3 is removed and all harness-native hooks are deferred to v2.** This finding is the primary reason.

#### 2.1.2 Per-event hook schemas — the actual shipped wire format

All 21 generated JSON-Schema draft-07 documents are embedded verbatim as literals in the shipped binary. Extracted via a regex scan for the `$schema` preamble plus `json.JSONDecoder().raw_decode` at each hit; **21 parsed**. This is strictly better evidence than the GitHub `main` schemas the docs point at — the vendor's own docs warn that `main` "may include hook fields that are not in the current release."

Artifact (28,397 bytes, 21 schemas). **Extraction origin:** a scratch directory that will be wiped —
so the extraction path is deliberately not recorded here, because it is not a usable reference.

> **ACTION — WITHDRAWN 2026-08-11 (harness-native hooks deferred to v2).** P1.12 and P7.3 are both
> removed; v1 ships no code that reads a Codex hook schema, so there is nothing to vendor and nothing
> to hash-check. The extraction method below is retained verbatim so v2 can regenerate the artifact
> from the pinned binary. The original action read:
>
> vendor this artifact at the stable tracked path
> `plugin/skills/the-steward/core/contracts/codex-hook-schemas.json` — shipped into target repos as
> `tools/steward/contracts/codex-hook-schemas.json` — with a sibling
> `codex-hook-schemas.provenance.json` recording the **source binary version**
> (`codex-cli 0.147.0-alpha.6.5`), the extraction method, the schema count (21), and the artifact's
> **sha256**. A test asserts the artifact parses, holds exactly the 21 named schemas, and matches the
> recorded hash. Regenerate it from the binary on every Codex version bump. Do **not** re-derive it
> from GitHub `main`, whose schemas may carry unreleased fields.

Independently re-read by the synthesizer:

```
$ /usr/bin/python3 -c "import json; d=json.load(open('codex_hook_schemas.json')); print(len(d)); print(sorted(d))"
21
['permission-request.command.input', 'permission-request.command.output',
 'post-compact.command.input', 'post-compact.command.output',
 'post-tool-use.command.input', 'post-tool-use.command.output',
 'pre-compact.command.input', 'pre-compact.command.output',
 'pre-tool-use.command.input', 'pre-tool-use.command.output',
 'session-end.command.input',                              <-- NOTE: no .output
 'session-start.command.input', 'session-start.command.output',
 'stop.command.input', 'stop.command.output',
 'subagent-start.command.input', 'subagent-start.command.output',
 'subagent-stop.command.input', 'subagent-stop.command.output',
 'user-prompt-submit.command.input', 'user-prompt-submit.command.output']
```

**Input contracts** (re-dumped by the synthesizer; every one is `additionalProperties: false`, so the input contract is *closed* — a consumer may not rely on undeclared fields):

| Event | `required` | Optional |
|---|---|---|
| `pre-tool-use` | `cwd, hook_event_name, model, permission_mode, session_id, tool_input, tool_name, tool_use_id, transcript_path, turn_id` | `agent_id, agent_type` |
| `post-tool-use` | same **+ `tool_response`** | `agent_id, agent_type` |
| `user-prompt-submit` | `cwd, hook_event_name, model, permission_mode, prompt, session_id, transcript_path, turn_id` | `agent_id, agent_type` |
| `stop` | `cwd, hook_event_name, last_assistant_message, model, permission_mode, session_id, stop_hook_active, transcript_path, turn_id` | — |
| `session-start` | `cwd, hook_event_name, model, permission_mode, session_id, source, transcript_path` — **no `turn_id`** | — |
| `session-end` | `cwd, hook_event_name, reason, session_id, transcript_path` — **no `model`, no `permission_mode`** | — |

Field details worth pinning:
- `permission_mode` enum: `['default','acceptEdits','plan','dontAsk','bypassPermissions']`
- `session-start.source` enum: `['startup','resume','clear','compact']`
- `session-end.reason`: `{"const": "other"}` — a single-valued constant
- `transcript_path`: `$ref` → `NullableString`, i.e. `type: ["string","null"]`. **May be null.**
- `turn_id` description: `"Codex extension: expose the active turn id to internal turn-scoped hooks."`

**Output contracts** — the trap:

```
pre-tool-use.command.output
  top-level props: continue, decision, hookSpecificOutput, reason, stopReason,
                   suppressOutput, systemMessage
  def PreToolUseDecisionWire            enum ['approve', 'block']
  def PreToolUsePermissionDecisionWire  enum ['allow', 'deny', 'ask']
  def PreToolUseHookSpecificOutputWire  props [additionalContext, hookEventName,
        permissionDecision, permissionDecisionReason, updatedInput]
        required ['hookEventName']  additionalProperties False
```

> **Two decision mechanisms, two disjoint vocabularies.** Top-level `decision` takes `approve|block`. `hookSpecificOutput.permissionDecision` takes `allow|deny|ask`. Writing an `allow` into `decision`, or an `approve` into `permissionDecision`, is a **silent no-op** — the schema rejects nothing that matters and the decision simply does not apply.

```
post-tool-use.command.output   BlockDecisionWire enum ['block']   (no 'approve')
                               hookSpecificOutput: additionalContext,
                                 hookEventName (const PostToolUse, required),
                                 updatedMCPToolOutput
stop.command.output            props: continue, decision, reason, stopReason,
                                 suppressOutput, systemMessage
                               -- NO hookSpecificOutput at all
session-start.command.output   props: continue, hookSpecificOutput, stopReason,
                                 suppressOutput, systemMessage
                               -- NO decision. SessionStart CANNOT block.
session-end                    -- NO OUTPUT SCHEMA. Its output is structurally ignored.
```

A note the vendor left in `stop.command.output.reason`, verbatim:
`"Claude requires `reason` when `decision` is `block`; we enforce that semantic rule during output parsing rather than in the JSON schema."`

#### 2.1.3 Three documented Codex claims that are wrong

1. The docs page states *"All events receive these fields: session_id, transcript_path, cwd, hook_event_name, model, permission_mode (most events)."* — **`session-end` receives neither `model` nor `permission_mode`**, and has **no output schema whatsoever**.
2. ADR-3's *"Detection only needs to find a `[hooks]` section header"* — **`hooks` is a typed top-level key with three valid spellings, one of which has no section header at all.** Type-check control proving the key is real and validated:
   ```
   hooks = 5  ->  Error loading config.toml: ...:1:9: invalid type: integer `5`,
                  expected struct HooksToml
   ```
   Then, all three parse clean (`config.toml parse ok`):
   ```toml
   [hooks]
   SessionStart = [ {...} ]
   ```
   ```toml
   hooks.SessionStart = [ {...} ]      # bare dotted key, NO section header
   ```
   ```toml
   [[hooks.SessionStart]]
   [[hooks.SessionStart.hooks]]
   ```
   A `^\s*\[hooks\]` matcher misses the third form entirely and, depending on the regex, the second.
3. **Codex does not validate hook event names at config-load time.** A typo'd event loads silently and never fires:
   ```
   $ printf '[[hooks.NotARealEvent]]\n[[hooks.NotARealEvent.hooks]]\ntype="command"\ncommand="/bin/true"' > $CODEX_HOME/config.toml
   $ codex exec --strict-config
     no configuration error; run proceeded past config load to
     401 Unauthorized ... wss://api.openai.com/v1/responses
   ```
   Claude Code, by contrast, **does** validate: `unknown hook event. Valid events: ${hO.join(", ")}`.

#### 2.1.4 Codex trust and CI

Hook trust is a real gate and it is **TUI-only**:

```
$ codex exec --help
  --dangerously-bypass-hook-trust   Run enabled hooks without requiring persisted
                                    hook trust for this invocation. DANGEROUS.
                                    Intended only for automation that already
                                    vets hook sources
```
Binary strings: `tui/src/startup_hooks_review.rs`, `' hooks need review before they can run.'`, `bypass_hook_trust`, `hook review state`. The review UI exists only under `tui/`.

Three `codex exec` runs in a scratch repo — plain, with `--dangerously-bypass-hook-trust`, and with that flag plus `-c projects."$W".trust_level="trusted"` — all completed a real turn (model `gpt-5.6-terra` actually ran `/bin/zsh -lc 'cat README.md .'` and replied DONE) and all ended:
```
ls: .../hookfire.log: No such file or directory
```
The bypass warning (`warning: --dangerously-bypass-hook-trust is enabled...`) is emitted **from the flag alone**, not from discovering hooks.

**Net: the Codex path has no CI story at all.** In CI a hook is either bypassed with a flag the vendor labels DANGEROUS, or it does not run — and the repo layer it would be configured from is unread regardless. This contradicted the project premise that "an OpenAI Codex agent or CI gets identical behavior" **only as long as that premise ran through harness hooks.** It no longer does: v1 defers harness hooks entirely, and the premise is carried by `AGENTS.md` + the git hook + CI, none of which involves Codex's hook system.

### 2.2 Claude Code harness — `2.1.201`

> **HISTORICAL for v0 (annotated 2026-08-11).** v0 writes no `.claude/settings.json` and no harness
> hook config, so the hook-event enum, handler union, matcher semantics, output contract, trust
> gating, and payload captures below bind nothing that ships. Retained in full as the v2 starting
> point and as the record of why a credential-less install cannot prove a Claude hook fires
> (ADR-28).
>
> **CORRECTION, round 6.** This banner previously claimed *"one thing survives and is load-bearing:
> the evidence that Claude Code reads `CLAUDE.md` and not `AGENTS.md`."* **That evidence is not in
> this section, or anywhere in this document.** Every probe below concerns hooks; nothing here reads
> an instruction file, expands an `@import`, or tests `AGENTS.md`. The claim was read from vendor
> prose during Phase 0 and never reproduced, so a banner asserting it was the *only* thing standing
> behind ADR-15's `[verified]` marker — a pointer resolving to itself.
>
> **RULED, round 7 (owner, 2026-08-12) — *proceed with stated risk*, and round 8 corrects how this
> was described.** Round 7 called E1 "dropped". Only half of it was: `CLAUDE.md` now carries the
> routing content directly, so the **import-expansion** contract is gone (no `@AGENTS.md`, no
> region; ADR-15, ADR-7 deleted). The **file-loading** claim still ships — v0 writes `CLAUDE.md`
> because Claude Code is understood to read it, and that reading has no probe here. Stated risk: a
> redundant owned artifact re-rendered forever in every target repo. ADR-15 keeps
> *[observed, not re-verified]*. The probe it would take, if ever wanted: one headless run against
> the pinned 2.1.201 (§1).

All contracts below were extracted from the shipped binary's embedded zod source. The synthesizer independently re-ran the extractions marked ✔.

#### 2.2.1 The `hooks` key shape

```js
fUr = Ae(()=> E.object({
      matcher: E.string().optional()
              .describe('String pattern to match (e.g. tool names like "Write")'),
      hooks:   E.array(w1s()).describe("List of hooks to execute when the matcher matches")
    }))
J6  = Ae(()=> E.partialRecord(E.enum(hO), E.array(fUr())))
w1s = ... E.discriminatedUnion("type",[BashCommandHookSchema, PromptHookSchema,
                                        AgentHookSchema, HttpHookSchema, McpToolHookSchema])
```

So: `hooks` is `partialRecord(event -> array of {matcher?, hooks[]})`; `matcher` is **optional**; and the handler list is a discriminated union on `type` with **five** variants — `command`, `prompt`, `mcp_tool`, `http`, `agent`. Any prior claim that only `command` exists was reading a subset of the docs.

#### 2.2.2 Thirty hook events, not ~10 ✔

Re-extracted by the synthesizer (`hO` is the enum the settings validator uses):

```
hO=["PreToolUse","PostToolUse","PostToolUseFailure","PostToolBatch","Notification",
    "UserPromptSubmit","UserPromptExpansion","SessionStart","SessionEnd","Stop",
    "StopFailure","SubagentStart","SubagentStop","PreCompact","PostCompact",
    "PermissionRequest","PermissionDenied","Setup","TeammateIdle","TaskCreated",
    "TaskCompleted","Elicitation","ElicitationResult","ConfigChange","WorktreeCreate",
    "WorktreeRemove","InstructionsLoaded","CwdChanged","FileChanged","MessageDisplay"]
```

This is the direct cause of two prior researchers disagreeing: both read prose, and prose documents a subset.

#### 2.2.3 The `command` handler's full field set

```js
type:    E.literal("command"),
command: E.string().describe("Shell command to execute"),
args:    E.array(E.string()).optional().describe(
   "Argument list for exec form. When present, `command` is resolved as an executable
    and spawned directly with these arguments — no shell. ... When absent, `command`
    runs through a shell (bash on POSIX, PowerShell on Windows without Git Bash)."),
shell:   E.enum(["bash","powershell"]).optional(),
timeout: E.number().positive().optional().describe("Timeout in seconds for this specific command"),
once:    E.boolean().optional(),
async:   E.boolean().optional(),
asyncRewake: E.boolean().optional()
// plus: if?, statusMessage?, rewakeMessage?, rewakeSummary?
```

**`args` is the security-relevant field neither prior researcher reported.** It selects a no-shell exec form.

> **RECOMMENDATION DEFERRED — reads as (v2) only (harness-native hooks deferred to v2).** The earlier text here — *"the-steward's generated Claude hook should use it"* — was the last surviving instruction telling v1 to generate a Claude hook. **v1 generates no `.claude/settings.json` and no Claude hook of any kind**, so there is nothing here to configure. Retained as a v2 prerequisite: if v2 ever ships a generated Claude hook it should use `args`, which removes shell quoting from the attack surface entirely.

#### 2.2.4 `matcher` is a regex, not a glob

```js
try { let s=new RegExp(t);
      if(s.test(e)) return !0;
      for(let i of qTn(e)) if(s.test(i)) return !0;
      for(let i of GTn(e,r)) if(s.test(i)) return !0;
      return !1 }
catch { C(`Invalid regex pattern in hook matcher: ${t}`), !1 }
```
It is additionally tested against derived *alias* forms of the tool name. Matchers apply only to: `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PermissionRequest`, `PermissionDenied`.

#### 2.2.5 Output contract, and a fourth permission value

```js
okp = Ae(()=> E.enum(["allow","deny","ask","defer"]))
skp = ... decision: E.enum(["approve","block"]).optional(),
      hookSpecificOutput union incl.
        {hookEventName:"PreToolUse",  permissionDecision, permissionDecisionReason,
                                      updatedInput, additionalContext},
        {hookEventName:"SessionStart",additionalContext, initialUserMessage,
                                      sessionTitle, watchPaths, reloadSkills},
        {hookEventName:"PostToolUse", additionalContext, updatedToolOutput,
                                      updatedMCPToolOutput}
```
`defer` is a **fourth** `permissionDecision` value, absent from the docs and absent from Codex's mirror of the same field.

Exit-status signalling:
```js
if (ie.status===2 && !Se.blockingError)
    Se.blockingError = {blockingError:`[${Z}]: ${ie.stderr||"No stderr output"}`, command:Z};
... outcome: ie.status===0 ? "success" : "error"
```
→ **exit 2 = blocking error, stderr is the reason; exit 0 = success; any other non-zero = non-blocking error.**

#### 2.2.6 DECISIVE EXPERIMENT — repo-shipped hooks run on an untrusted fresh clone

A fresh git repo, never opened in Claude Code, with `.claude/settings.json` declaring hooks:

```
$ cd $W && claude -p "Read the file README.md using the Read tool, then reply DONE." \
      --allowedTools Read --max-turns 4
Not logged in · Please run /login          (exit 1)

$ ls -l hookfire.log
-rw-r--r--  1 <user>  <group>  1209 ...       # the hooks fired anyway
```

The directory was genuinely untrusted at the moment they ran:
```
before: cchooklab present: False   (46 projects known)
after:  cchooklab in projects with {"hasTrustDialogAccepted": false,
                                    "projectOnboardingSeenCount": 0}
```

**A/B falsification proving the log test is sensitive** (i.e. the firing was real, not an artifact):
```
$ CLAUDE_CODE_SAFE_MODE=1 claude -p "reply DONE" --max-turns 2
  ls: .../hookfire.log: No such file or directory      # suppressed
$ claude -p "reply DONE" --max-turns 2                 # control, immediately after
  -rw-r--r--  1 <user> <group> 1209 ... hookfire.log ; grep -c FIRED = 2
```

Source-level confirmation that there is **no trust check on any path** ✔ (re-extracted):
```js
function xfo(){ let e=xn("policySettings");
  if(e?.disableAllHooks===!0) return {};
  if(e?.allowManagedHooksOnly===!0||sc()) return e?.hooks??{};
  if(AE("hooks")) return e?.hooks??{};
  let t=rs(); if(t.disableAllHooks===!0) return e?.hooks??{};
  return t.hooks??{} }
```
`sc()` = safe mode (`CLAUDE_CODE_SAFE_MODE` / `--safe-mode`), `AE("hooks")` = `policySettings.strictPluginOnlyCustomization`. No `hasTrustDialogAccepted` reference anywhere in the path.

**The only three kill switches are:** enterprise `policySettings.disableAllHooks`, `policySettings.allowManagedHooksOnly` / `strictPluginOnlyCustomization`, and safe mode.

> **Security corollary — and a second reason for the v2 deferral.** Had the-steward shipped `.claude/settings.json` hooks, its installer would itself have been a supply-chain vector: anyone cloning a touched repo would execute those hooks unprompted, headless, with no trust gate. **v1 writes no `.claude/settings.json` at all, so the-steward adds no such vector** — the property remains true of Claude Code generally and must be re-confronted, with a warning in the generated docs, if v2 ever ships harness hooks.

#### 2.2.7 Live payload capture — redacted

> **Redaction applied.** The block below came from a live Claude Code session and originally carried a real `session_id`, a real `prompt_id`, and a `transcript_path` under the user's home directory. All three are placeholdered here; the raw capture (and the lab that produced it) was deleted and never committed. What is preserved is the payload *shape*, which is the only part that is contract.

```json
// SessionStart
{"session_id":"<REDACT>","transcript_path":"<REDACT: ~/.claude/projects/.../<id>.jsonl>",
 "cwd":"<repo>","hook_event_name":"SessionStart","source":"startup"}
// SessionEnd
{"session_id":"<REDACT>","transcript_path":"<REDACT>","cwd":"<repo>",
 "prompt_id":"<REDACT>","hook_event_name":"SessionEnd","reason":"other"}
```

**The most important thing about this capture is what is missing.** The binary's base-payload builder declares more than the wire carries:

```js
function $d(...) { return { session_id:r, transcript_path:cx(r), cwd:Lt(),
    prompt_id:a9e()??void 0, permission_mode:e, agent_id:n?.agentId,
    agent_type:o, effort:a } }
```
The live `SessionStart` payload contains **no `model` and no `permission_mode`**, and no `prompt_id`. This is consistent with `undefined` values being dropped at JSON serialization.

> **Contract rule this forces:** every field derived from the binary's payload-construction source must be treated as **optional** by any consumer. The one event where we have both a source-derived field list and a live capture shows the live payload is a strict subset. The field sets for `PreToolUse` / `PostToolUse` / `Stop` below are **source-derived and were never observed live** — see §5.

Source-derived, unobserved:
- `PreToolUse` adds `{hook_event_name:"PreToolUse", tool_name, tool_input, tool_use_id}`
- `PostToolUse` adds `{tool_name, tool_input, tool_response, tool_use_id, duration_ms}`
- `Stop` adds `{stop_hook_active, last_assistant_message, background_tasks, session_crons}`

#### 2.2.8 Settings sources and precedence

```js
case "userSettings":    return "User settings (~/.claude/settings.json)"
case "projectSettings": return "Project settings (.claude/settings.json)"
case "localSettings":   return "Local settings (.claude/set..."
```
Plus separate `pluginHook` and `sessionHook` sources, and enterprise `policySettings`.

#### 2.2.9 The asymmetry the bundle does not model

| | Claude Code 2.1.201 | Codex 0.147.0-alpha.6.5 |
|---|---|---|
| Repo-level hook config read? | **Yes** (`.claude/settings.json`) | **No** (`.codex/` unread entirely) |
| Trust gate on a fresh clone? | **None** | Real, but **TUI-only** |
| Runs headless / in CI? | Yes, unprompted | Only via `--dangerously-bypass-hook-trust`, and there is nothing to run |
| Validates event names? | **Yes** | **No** — typos load silently |
| Kill switches | enterprise policy + safe mode | trust review + bypass flag |

**Any generated documentation that describes "the harness" in one voice will be wrong about one of them.**

### 2.3 Runtime, git, and POSIX contracts

#### 2.3.1 `/usr/bin/python3` is a dispatcher, not an interpreter ✔

Re-verified by the synthesizer:
```
$ stat -f '%i %l %N' /usr/bin/python3 /usr/bin/git /usr/bin/clang
1152921500312571585 78 /usr/bin/python3
1152921500312571585 78 /usr/bin/git
1152921500312571585 78 /usr/bin/clang        # identical inode, 78 hard links

$ DEVELOPER_DIR=/nonexistent /usr/bin/python3 -V
xcrun: error: missing DEVELOPER_DIR path: /nonexistent      exit=1
```
It is the `xcode-select` shim. An environment variable redirects it.

And it is the **one** candidate where the pin can never be validated against the running interpreter ✔:
```
pin=/usr/bin/python3
  realpath(pin)      = /usr/bin/python3
  realpath(sys.exec) = /Library/Developer/CommandLineTools/Library/Frameworks/
                       Python3.framework/Versions/3.9/bin/python3.9
  MATCH: False
pin=/usr/local/bin/python3     MATCH: True
pin=/opt/homebrew/bin/python3  MATCH: True
```

#### 2.3.2 PATH regimes — three regimes, three interpreters, same hook

A git hook inherits the invoking process's PATH verbatim (git only *prepends* its `git-core` exec dir) and sources no profile:

| Invocation | PATH head | Resolved `python3` |
|---|---|---|
| bash-tool env | `.../git-core:<HOME>/.local/bin:...` | `/Library/Frameworks/.../3.13/bin/python3` — **3.13.5** |
| `env -i HOME=$HOME git commit` | `.../git-core:/usr/local/bin:/usr/bin:/bin` | `/usr/local/bin/python3` — **3.13.5** |
| launchd-like (`getconf PATH`) | `.../git-core:/usr/bin:/bin:/usr/sbin:/sbin` | `/usr/bin/python3` — **3.9.6** |

GUI inheritance verified by **two independent launchd mechanisms** (`launchctl submit` and `launchctl bootstrap gui/501`), both producing identically:
```
PATH=/usr/bin:/bin:/usr/sbin:/sbin
python3=/usr/bin/python3
version=Python 3.9.6
```
`launchctl getenv PATH` is empty (no launchd override configured). The LaunchAgent was booted out and its plist deleted; absence verified.

> ADR-1's claim that "the fallback resolves to 3.9.6" is true only under the launchd/`confstr` PATH. Under `env -i` the hook resolved 3.13.5 via `/usr/local/bin`. The pinning argument is *stronger* than ADR-1 states, but ADR-1 states it wrongly.

#### 2.3.3 Bytecode ✔ — ADR-1's mechanism does not work

Re-run by the synthesizer, with `sys.dont_write_bytecode = True` as **line 2** of `__main__.py`:

```
$ /usr/local/bin/python3 tools/steward
ran dwb=True val=42
$ ls tools/steward/__pycache__
__main__.cpython-313.pyc          <-- the guard did NOT prevent this
$ git status --porcelain
?? tools/

$ PYTHONDONTWRITEBYTECODE=1 /usr/local/bin/python3 tools/steward
ran dwb=True val=42
$ ls tools/steward/__pycache__
ls: tools/steward/__pycache__: No such file or directory
```
`__main__` is compiled and cached **before its first line executes**. (`helper.cpython-313.pyc` *was* correctly suppressed — the guard takes effect only after `__main__` is already cached.) `-B` also works.

And the fixture trap ✔:
```
$ /usr/bin/python3   -c "import sys;print(sys.pycache_prefix)"
<HOME>/Library/Caches/com.apple.python
$ /usr/local/bin/python3 -c "import sys;print(sys.pycache_prefix)"
None
```
Apple's CLT 3.9.6 ships a patched `pycache_prefix`, so **no `__pycache__` ever appears in the repo on ADR-1's own flagship interpreter.** A single-interpreter "minimal writes nothing" fixture is vacuously green.

*Reading of the same output, added 2026-08-13 (no new measurement):* the redirect target is a **shared, home-level cache root** — `<HOME>/Library/Caches/com.apple.python` — not a per-repository directory, so its contents are not attributable to any one program and asserting on the root is not an assertion about a steward module. This is why P1.8 asserts the **exact per-module cache path** computed by `importlib.util.cache_from_source` inside the interpreter under test, which is the API that applies this prefix.

#### 2.3.4 No multi-file atomic commit primitive at the floor ✔

```
python 3.9.6
 os.renameat2        False
 os.RENAME_EXCHANGE  False
 os.RENAME_SWAP      False
 os.exchangedata     False
 os.renamex_np       False
 os.replace          True
 same-fs os.replace: OK
 os.replace(dir over NON-EMPTY dir): FAILED errno=66 (Directory not empty)
```
Also: `os.replace` takes the **source** file's mode and changes the inode (`inode 178916594->178916595, mode 600->644`). Any atomic-write helper must `chmod` the temp file **before** the rename, or the installed file lands with the wrong mode. *(Measured here; no ADR is cited as its evidence — a claim may not be its own source.)*

#### 2.3.5 Parsers at the floor ✔

```
                floor 3.9.6      PATH 3.13.5
 import json    OK
 import tomllib NOT AVAILABLE    OK
 import yaml    NOT AVAILABLE    OK
 import configparser OK
```
Re-confirms ADR-2 (no stdlib TOML at the floor) and adds a new hazard: an opportunistic `import yaml` would **succeed on 3.13.5 and fail on 3.9.6**, producing exactly the interpreter-dependent behavior ADR-1 exists to prevent.

#### 2.3.6 Git worktree facts ✔ — reproduced live in the reference monorepo

```
$ cd <REFERENCE-REPO>/.claude/worktrees/<worktree>
toplevel:        <REFERENCE-REPO>/.claude/worktrees/<worktree>
hooks(abs):      <REFERENCE-REPO>/.git/hooks          <-- OUTSIDE toplevel
common-dir:      <REFERENCE-REPO>/.git
core.hooksPath:  <REFERENCE-REPO>/.git/hooks
$ git worktree list | wc -l
     106
```

**ADR-26 as written hard-errors on the hook install in all 106 of these worktrees.**

Also established:
- `git rev-parse --git-path hooks` returns a **relative** path in the main worktree (`.git/hooks`, or `../../.git/hooks` from a subdir — relative to **CWD**, not the toplevel) and an **absolute** path in a linked worktree. `--path-format=absolute` normalizes both. A naive join onto the toplevel is wrong in one of the two cases.
- `git rev-parse --git-path <arbitrary-name>` resolves to the **per-worktree** gitdir. Only an allowlist is redirected to the common dir:
  ```
  from a linked worktree:
    hooks, info/exclude, config, objects, shallow  -> <main>/.git/...      SHARED
    index, HEAD, config.worktree, steward-pin.local
                                                   -> <main>/.git/worktrees/<wt>/...  PER-WORKTREE
  ```
  The working expression for shared state is `$(git rev-parse --path-format=absolute --git-common-dir)/<name>`. Verified: a pin written there resolved identically from all three worktrees, and `git status --porcelain` was empty in all three (it lives inside `.git`, so no `.gitignore` entry is needed).
- A **relative** `core.hooksPath` resolves **per worktree**, against the working-tree root, not CWD — verified by committing from nested subdirectories in both a main and a linked worktree and observing each fire its own `.githooks/pre-commit`. This is an unexploited lever that would make hooks containment-valid and per-branch, at the cost of colliding with the reference monorepo's existing absolute `core.hooksPath`.
- ADR-5 re-verified against the reference monorepo: `core.hooksPath` is an absolute path *equal to the default location*, and `.git/hooks` contains `post-checkout.gitbutler-disabled-20260624-181323`.
- ADR-25's core mechanism **confirmed**: a shared hook in a linked worktree sees `--show-toplevel` = the *linked* worktree and runs that worktree's own core (verified with a distinguishable core printing `WORKTREE-CORE`).

#### 2.3.7 `.gitattributes` ✔ — two of three intuitive spellings are silent no-ops

Re-run by the synthesizer:
```
PATTERN tools/steward/     -> tools/steward/__main__.py: linguist-vendored: unspecified
PATTERN tools/steward      -> tools/steward/__main__.py: linguist-vendored: unspecified
PATTERN tools/steward/**   -> tools/steward/__main__.py: linguist-vendored: set
```
`man 5 gitattributes`: *"patterns that match a directory do not recursively match paths inside that directory (so using the trailing-slash path/ syntax is pointless in an attributes file; use path/** instead)"*.

Attribute names verified against the primary source (`github-linguist/linguist/docs/overrides.md`): `linguist-vendored`, `linguist-generated`, written **bare**. Linguist's own examples use `Api.elm linguist-generated`, `special-vendored-path/* linguist-vendored`, `ano-dir/** linguist-vendored`. `linguist-*` appears **0 times** in `man 5 gitattributes` — these are Linguist/GitHub attributes, not git-native. git's four states are distinct: bare → `set`, `=true` → `true`, `-prefix` → `unset`, `=false` → `false`.

**The line v0 writes:** `tools/steward/** linguist-vendored`. Bare, with `/**`. *(Corrected 2026-08-13: the `linguist-generated` form is verified identically and is retained above as evidence, but **v0 generates no `linguist-generated` line** — ADR-1 and P6.5b render `.gitattributes` with the vendored-core line alone. v0 still **reads** the attribute, in ADR-10's document predicate.)*

#### 2.3.8 A hook cannot prompt

> **HISTORICAL for v0 (annotated 2026-08-11).** v0 installs no hook, so nothing of ours runs in this
> environment. Retained because it settled — by measurement, not preference — that hook-time consent
> was never a policy question, and because it is the shape of the argument v0 avoids entirely: the
> only writes v0 performs happen in `generate`, invoked directly by a human or an agent.

```
=== A: no controlling terminal (agent shape) ===
STDIN_IS_TTY=no
DEVTTY_OPEN=FAIL
=== B: inside a pty (interactive-human shape) ===
STDIN_IS_TTY=no
DEVTTY_OPEN=OK
```
Earlier probe, agent shape: `.git/hooks/pre-commit: line 8: /dev/tty: Device not configured` / `DEVTTY_READ_FAILED rc=1` — **and the commit still succeeded, `GIT_EXIT=0`.**

Git redirects hook stdin away from the terminal in **both** shapes. With no controlling terminal, `/dev/tty` cannot even be opened.

#### 2.3.9 Journal-first recovery, measured

> **HISTORICAL for v0 (annotated 2026-08-11).** There is no install transaction, no journal, no
> `steward recover`, and no `.git/steward/` in v0. **The measurement itself is why**: it falsified
> the "no partial state on any path" claim, and every subsequent attempt to restore that guarantee
> added machinery that produced new findings. v0 replaces the guarantee with an ordering — write
> `.steward.json` first, then the artifacts — so an interrupted run leaves paths recorded as ours
> that are missing or mismatched. **The two do not recover alike (corrected 2026-08-13):** a
> **missing** recorded path is a `warn` the next `generate` re-creates unattended; **anything else
> that is not the recorded bytes** — including the complete *previous* file left by a kill
> mid-rewrite — is an `error` that **nothing overwrites**, and it needs a human `rm` before a re-run
> finishes it (ADR-20). The `.git/steward/` storage constraints measured at the end of
> this section (`git gc`, `git clean -xdf`) survive as the reason the manifest must be **tracked**
> (Blocker 2).

ADR-20 as literally written, SIGKILLed at each write step:
```
crash point                      killed  marked  recovers clean
preflight                        True    False   True
write:AGENTS.md                  True    False   False
write:CLAUDE.md                  True    False   False
write:.codex/hooks.json          True    False   False
write:tools/steward/steward      True    False   False
manifest                         True    False   False
```
Journal-first (backups → commit journal → mutate → manifest → clear journal), identical fixture and injection — **note the `backups` row is `marked: False`**, which is the hole round 4 caught:
```
crash point                      killed  marked  recovers clean
preflight                        True    False   True
backups                          True    False   True
journal                          True    True    True
write:AGENTS.md                  True    True    True
write:CLAUDE.md                  True    True    True
write:.codex/hooks.json          True    True    True
write:tools/steward/steward      True    True    True
manifest                         True    True    True
```
Recovery is itself crash-safe and idempotent: killed mid-recovery, still marked, second run reaches the pre-install state exactly. End-to-end through a real hook: killed install → `commit exit code: 2 commits exist (2 = blocked)` → recover → `commits now: 3`, `final status: (empty)`.

> **The prototyped ordering does not satisfy the guarantee it was written to support.** A crash during `backups` is recorded above as **unmarked** (`marked: False`), which directly contradicts "no unmarked intermediate state exists". It recovered cleanly only because nothing outside `.git` had been touched at that point — a property of this fixture, not of the design.
>
> **SUPERSEDED — the round-5 journal sequence, recorded as history. None of it ships.** *(Annotated 2026-08-11: scope cut 3 removed the journal, the install transaction, `steward recover`, `.git/steward/` and plan task P6.2b outright. What ships is ADR-20's manifest-first ordering with **no journal of any kind**. The paragraph is kept because it is the last rung of the ladder the owner cut, and because the reason it was written — the round-4 sequence was unachievable as stated — is part of why the whole mechanism went.)*
>
> The round-4 correction — "write the journal in `phase: preparing` first, before creating `.git/steward/`, record each backup copy transactionally, then flip to `phase: mutating`" — was itself superseded: it required writing the journal *before* creating the very directory the journal was defined to live in. The round-5 replacement was **one journal file at `$(git rev-parse --path-format=absolute --git-path steward-install-journal.json)`** — the worktree's own gitdir, no `.git/steward/` directory — written atomically as the first mutation, then mutate → manifest → delete the journal, with no backups step and no phases (create-only ownership, owner 2026-08-11, means nothing pre-existing is ever replaced). Plan task **P6.2b**, which was to carry its kill-point fixtures, no longer exists. **v0's surviving kill-point fixture is P6.4(c)**, against the manifest-first ordering — *(corrected 2026-08-13: it is a **matrix of five** kill points, not one, and only the first converges unattended)*.

Storage constraints, both verified:
```
git gc --prune=now:  candidate A (git hash-object -w blob) survives: False
                     candidate B (plain copy under .git/steward/) survives: True
git clean -xdf:      Removing .steward/ | Removing CLAUDE.md
                     .git journal exists = True | in-tree journal exists = False
                     untracked manifest after git clean -xdf: DESTROYED
```

#### 2.3.10 CI evidence is not obtainable from file contents

> **HISTORICAL for v0 (annotated 2026-08-11).** v0 generates no CI workflow, owns no workflow, and
> reports no CI state; anyone who wants `python3 -B tools/steward doctor` in a pipeline adds that line
> themselves. **Retained because the first table is the sharpest evidence in the whole document for
> ADR-28's thesis:** a presence check was wrong on 8 of 9 cases — it reported "configured" for a
> workflow that genuinely gates nothing. That is the same shape as the inert Codex layer (§2.1.1)
> and the inactive pre-commit hook in the reference repo. Presence is not evidence, which is why
> every v0 finding carries its evidence tier and an *inspected* finding is never reported as proof.
> The `on`-parses-as-`True` result and the platform self-attestation quotes are historical.

```
case                 really gates?  presence check  strict check
dispatch_only        False          True            False
paths_filtered       False          True            False
if_false             False          True            False
continue_on_error    False          True            False
swallowed_exit       False          True            False
no_checkout          False          True            False
wrong_command        False          True            False
commented_out        False          True            False
presence check wrong on 8/9 cases; strict check wrong on 0/9
```
But the strict checker is a heuristic, not a parser, and it **wrongly rejects 3 of 6 legitimate workflow variants** (`flow_seq_trigger`, `multiline_run_block`, `reusable_workflow_call`). And adding YAML would not help: under YAML 1.1 the workflow key `on` parses as the **boolean `True`**:
```
parsed top-level keys: ['name', True, 'permissions', 'jobs']
is the string 'on' a key? False
is boolean True a key?   True
```

Platform self-attestation, verified against primary vendor docs:
- GitHub — `GITHUB_ACTIONS`: *"Always set to `true` when GitHub Actions is running the workflow."*; `GITHUB_WORKFLOW_REF`: *"The ref path to the workflow. For example, `octocat/hello-world/.github/workflows/my-workflow.yml@refs/heads/my_branch`."*
- GitLab — `GITLAB_CI`: *"Available for all jobs executed in CI/CD. `true` when available."*; `CI_CONFIG_PATH`, `CI_JOB_NAME`.

Reference-repo convention (~40 workflows in `<REFERENCE-REPO>`): the great majority carry a `paths:` filter, and **5 of 5 sampled workflows omit a `permissions:` block entirely** (`permissions_block=0`; the sampled filenames are repo-internal and are not reproduced here).

#### 2.3.11 Reference-repo corpus, freshness and churn — the measurements ADR-8, ADR-9 and ADR-10 rest on

> **Added 2026-08-11. Why it is here:** ADR-8, ADR-9 and ADR-10 each cited a measurement with an
> evidence marker, and this document — which those markers point at — did not contain the
> measurement. The numbers are real: they come from the **pre-Phase-0 survey of the reference
> monorepo (2026-08-10)** and were recorded only in that survey's own synthesis, which is not part of
> the bundle. They are consolidated here so no marker points at nothing.
>
> **Provenance is stated per row and it is not uniform.** Row 1 was **re-run by the synthesizer**.
> Rows 2–6 were **reported by an empirical agent and not re-run**, and their originating commands
> were not preserved — so they are recorded as *observed*, and **ADR-8 and ADR-9 carry
> `[observed in the reference repo, not re-verified]` rather than `[verified]`** for exactly that
> reason. This is the ADR-28 standard applied to the bundle's own bookkeeping: a recorded claim is
> not evidence, including when the claim is ours.
>
> **Redaction as §1.** No repo-internal source, doc, or workflow filename is reproduced; each script
> and artifact is named by its role. `.editorconfig` is named because it is one of the conventional
> root dotfiles §1 deliberately retains — it is an ecosystem convention, not an identifier.

| # | Measurement | Command / source | Result | Tier |
|---|---|---|---|---|
| **1** | Corpus enumeration: `find` vs the git index | `find . -name '*.md'` and `git ls-files '*.md'`, both run at the root of `<REFERENCE-REPO>` | **175,944** paths from `find`; **1,091** from `git ls-files` | **re-verified by the synthesizer** |
| **2** | mtime is not a freshness signal | a tracked root `.editorconfig`: filesystem mtime vs `git log -1` on the same path | mtime **2026-02-21**, last commit **2023-10-23** — ~2.3 years newer than the content it is supposed to date. The repo's agent-doc audit script ships an mtime-based drift check over exactly this class of file | observed, not re-verified |
| **3** | A wall-clock stamp in a generated artifact produces pure churn | commit history of the repo's generated doc-tree index (which embeds a `generatedAt` field) | **71 commits** touched that artifact, of which **19 were pure-timestamp churn**. A sibling artifact generator in the same repo ships a working `--check` mode *precisely because* its output carries no timestamp — the A/B contrast, in one codebase | observed, not re-verified |
| **4** | An unenforced frontmatter convention drifts | frontmatter field coverage across the repo's declared docs scope | three declared frontmatter fields present on **~425 of 485** docs (**~87%**), a fourth on 116 | observed, not re-verified |
| **5** | First-run orphan flood | the doc-tree index's own output at its last successful build | **601 orphans of 1,073 indexed docs (~56%)** | observed, not re-verified |
| **6** | `find`-based enumeration has already failed in production | the repo's doc-tree builder, which enumerates with `find` | dies with **`ENOBUFS`**; **last successful build 2026-06-15**, ~2 months before the survey. Whether the failure was reproduced during the survey or read from the builder's error path was not recorded | observed, not re-verified |

**What each row is load-bearing for.** Row 1 → ADR-10 (`git ls-files -z` with an output cap, never
`find`). Row 2 → ADR-9 (content digest, never mtime). Row 3 → ADR-8 (pure renderers; no wall-clock
stamp in any artifact) and the temporal rule in ADR-2. Row 4 → C3, and the PDR's `~87%` figure.
Row 5 → the orphan report being advisory-only with a triage ordering (plan P6.3). Row 6 → ADR-10's
output cap and ADR-13's exit-2 distinction (a tool that dies must not read as a pass).

**Two different denominators, on purpose.** Row 4's **485** is the repo's *declared docs scope*;
row 5's **1,073** is what the doc-tree index actually spans, and row 1's **1,091** is every tracked
`*.md` in the repository. They are not in conflict and none of them should be substituted for
another — the relationship between the three (index ≈ repo-wide, docs scope much narrower) is an
inference from the counts, not a separate measurement.

**What these rows do *not* establish.** They are one repository, at one point in time, read
read-only. They motivate the decisions; none of them is a contract with a vendor, and none is
re-derived at runtime. ADR-9's *"mtime is meaningless after any fresh clone, in any linked worktree,
and on every CI runner"* does not depend on row 2 at all — that is a property of git, and row 2 is
only the live illustration.

---

## 3. THE FIVE OPEN DECISION BLOCKERS

> **v0 disposition (annotated 2026-08-11).** Four of these five blockers were questions *about
> enforcement machinery*, and v0 answers them by not having it:
>
> | Blocker | v0 |
> |---|---|
> | 1 — consent vs auto-sync | **Moot.** Nothing writes non-interactively; `generate` is invoked deliberately. The confirmation gate is ADR-11/ADR-20 |
> | 2 — canonical manifest path | **LOAD-BEARING, unchanged.** `.steward.json`, tracked, at the repository root (ADR-2) |
> | 3 — minimal tier vs the launcher | **Moot.** No tiers and no launcher. The surviving fact — the repo root comes from cwd via git, never from the core's own location — is ADR-26 |
> | 4 — `steward ci init` | **Moot.** No CI generation |
> | 5 — atomicity | **Replaced, not achieved.** v0 claims no atomicity at all. Manifest-first ordering makes an interrupted run **reportable**, and *(corrected 2026-08-13)* it converges on re-run **only for a missing recorded path**; any other mismatch is an `error` needing a human `rm` (ADR-20) |
> | new — Codex repo layer inert | **The reason harness hooks are gone.** Retained as the v2 starting point |
>
> The contract language quoted in each blocker below is the *previous* design's. Where it
> contradicts the v0 ADRs, the ADRs win.

### Blocker 1 — Consent vs auto-sync — **RESOLVED**

Not by preference, by physics. §2.3.8: a hook cannot open `/dev/tty` with no controlling terminal, and stdin is never a tty in either shape. Hook-time consent **fails closed in every agent and CI invocation**. The argument was being had as a policy question; it is an environment question.

**Contract language for the ADR:**

> Consent is required to **establish ownership** of a path — to bring a path under the-steward's control for the first time. *(Narrowed by the owner's create-only cut, 2026-08-11: that now means **creating** it and nothing else. Adopting existing content is no longer a thing the tool can do, so the second half of this clause is deleted rather than restated.)* Consent is granted by a human, out of band, and recorded in the contract manifest as a grant naming the path and the renderer identity. Re-rendering an already-owned path under an already-consented renderer is the **execution of that existing grant**, not a new write, and requires no further approval. The pre-commit hook may only execute existing grants. It never solicits consent, because in the non-interactive context where it runs it cannot.

Four stress cases, resolved and exercised in the prototype:

| Case | Resolution |
|---|---|
| A new doc expands the corpus | Regenerate freely — the index is already owned, the renderer is unchanged, and the corpus is a declared *input*, not a new artifact. |
| A human deleted an owned file | **BLOCK, do not recreate.** Deletion is a plausible revocation; silently restoring re-establishes a claim the human dropped. |
| Renderer version changed | Version the grant. Same **major** → regenerate silently. **Major bump → BLOCK**, requires re-consent; a major bump is by definition a change to the artifact contract the human approved. |
| Path not in the manifest | Always **BLOCK**. |

Every block must be actionable without interaction: print the exact `steward` command, exit 1.

### Blocker 2 — Canonical manifest path — **RESOLVED**

**`.steward.json`, a single tracked JSON file at the repository root.**

Three pieces of evidence, each independently disqualifying the alternatives:
1. A manifest under `tools/steward/` **inherits `linguist-vendored`** (`tools/steward/manifest.json: linguist-vendored: set`), collapsing the human consent record out of code review. A root-level path inherits no attributes.
2. The rollback task (**P6.5**) — *"remove `tools/steward/`"* — would **delete the ownership record rollback is driving from**.
3. An **untracked** manifest is destroyed by `git clean -xdf` (§2.3.9). It must be tracked.

Prefer the single file to a `.steward/` directory: smaller ownership surface, and nothing yet needs a second file — the ADR-2 `$schema` key can point at the vendored schema under `tools/steward/` by relative path, and ADR-12 overrides live inside the manifest. Matches the reference monorepo's tracked-root-dotfile convention (`.dockerignore`, `.editorconfig`, `.mcp.json`, `.nvmrc`, `.prettierrc.json`).

### Blocker 3 — Minimal tier vs the launcher — **RESOLVED, in ADR-22's favour**

Minimal **can** run the core straight from the plugin/skill directory, and the repo stays byte-for-byte clean:

```
core reported: cwd = .../brownfield
               git --show-toplevel = '/private/.../brownfield' (rc=0)
               git ls-files count  = 2   (corpus enumeration, ADR-10)
               core inside repo?   = False
git status --porcelain AFTER: (empty)
```
`__pycache__` landed in the **plugin** dir, not the repo, and vanished under `PYTHONDONTWRITEBYTECODE=1`. With the plugin dir `chmod 555`: exit 0, empty stderr, no cache — Python degrades silently.

The **only** thing that broke was an over-broad assertion in the ADR-24 launcher prototype:
```
steward: core at .../fake-plugin/skills/the-steward/core is outside repo root .../brownfield
EXIT=2
```

**Contract language:**

> ADR-24's "every caller invokes `tools/steward/steward`" applies to the **installed tiers only**. Minimal is invoked as `python3 <plugin>/core --tier=minimal` with cwd inside the target repo. **The repo root always comes from cwd via git, never from the core's own location.** Containment (ADR-26) does not extend to the core's own directory.

That one sentence makes installed and minimal share a single resolution rule. Nothing about path resolution, containment, or the manifest breaks — minimal writes no manifest, so there are no manifest-derived paths to contain.

### Blocker 4 — `steward ci init` — **RESOLVED on all four sub-questions**, with one named residual

| Sub-question | Answer | Basis |
|---|---|---|
| Supported platform set | **GitHub Actions only, v1** | Its contract is verified (§2.3.10). GitLab's is too and is the obvious v2; shipping one verified platform respects ADR-23. |
| Workflow contract | `on: pull_request` with **no `paths:` filter**; explicit `permissions: contents: read`; `actions/checkout`; then `tools/steward/steward check --all --profile=ci` and `... doctor --profile=ci` as separate run steps, **each also exporting `STEWARD_PROFILE: ci`** (the `sh` launcher reads only the environment — ADR-24 forbids argv sniffing — so a flag-only workflow exits 3 before the core parses anything), **no `\|\| true`, no `continue-on-error`** | the reference monorepo's near-universal `paths:` filters would leave docs-only PRs ungated; most of its workflows omit `permissions:` and inherit repo defaults |
| Owned or not | **OWNED artifact under ADR-20 preflight** | Forced by evidence, not preference — see below |
| Evidence threshold | Four states, redefined (below) | Presence wrong 8/9; regex wrong 3/6; no YAML at floor; YAML parses `on` as `True` |

**The ownership question is forced, and it reverses a recorded ADR-21 rejection.** Verifying a workflow we did **not** write is unsound in both directions. Ownership-plus-digest replaces parsing entirely: if the file's digest matches our recorded render, we know exactly what it says. ADR-21 said both things — **owned** in its own workflow-contract paragraph, **rejected** in the *Rejected alternatives worth recording* table at the end of `ADR.md` — and must pick this one. *(Done: the rejected row is struck through and marked REVERSED.)*

**The four doctor states, restated honestly:**

| State | Meaning |
|---|---|
| **not configured** | No CI artifact recorded in the manifest. |
| **configured but unverified** | An owned CI artifact exists and its digest matches our render. **This is the ceiling for any local offline run, and doctor must say so in those words.** |
| **configured but modified** | *(new)* An owned CI artifact's digest no longer matches. Never silently upgrade a hand-edited workflow to a stronger state. |
| **`ci-self-attested`** | *(renamed by owner decision, 2026-08-11 — was "configured and verified")* Under `--profile=ci`, doctor reads `GITHUB_ACTIONS=true` and `GITHUB_WORKFLOW_REF` and asserts the workflow path in `GITHUB_WORKFLOW_REF` is the manifest-recorded owned CI artifact. **Both are ordinary environment variables that any local process can set** — nothing here is signed or platform-attested. The state means "this process *claims* to be our CI job and nothing it says contradicts our records", and doctor must print that meaning. **Never describe it as verified, proven, or unforgeable.** The stronger claim would need an authenticated platform API call, which is network access this tool has ruled out. |

The generated docs must state plainly that whether Actions is enabled, whether the workflow is on the default branch, and whether it is a required check are **all invisible to the tool**.

**Named residual (not part of this resolution):** whether a required check *skipped* by a `paths:` filter blocks a merge or silently passes it. See §5.

### Blocker 5 — Atomicity — **RESOLVED by replacing the guarantee, not by achieving it**

ADR-20's original *"No partial state on any path"* claim is **false**, measured. Manifest-last prevents a manifest that over-claims; it guarantees nothing about the files. SIGKILL after the `AGENTS.md` write leaves ` M AGENTS.md` plus untracked artifacts, **no manifest, no marker, unrecoverable**.

Note the conflation ADR-20 makes: an **abort** (a decision taken before writing) *is* byte-identical, and that part survives. A **crash** is not. "Abort at any point" is used to cover both.

**Contract language replacing ADR-20's atomicity claim** *(as written in round 5; ADR-20 has no "recoverability contract" subsection in v0 — the surviving text is ADR-20's "Write ordering: manifest first, and why there is no journal")*​**:**

> Installation is **not atomic**. POSIX `rename()` is atomic per file, and the-steward uses it for every write, so no individual file is ever observed half-written or truncated. There is **no multi-file atomic commit primitive available to this tool** — verified: no `renameat2`/`RENAME_EXCHANGE` at the Python 3.9 floor, and replacing a non-empty directory fails `ENOTEMPTY` (errno 66). A multi-file install therefore has a real window in which some targets are written and others are not.
>
> What is guaranteed instead is that the window is **never silent and never terminal**: at every instant the repository is in exactly one of three states — (a) the pre-install state, (b) the post-install state, or (c) a **marked** intermediate state carrying a journal that describes precisely how to reach a resolved one — **(b) always, and (a) as well when the install had no predecessor** (a re-install rolls forward only; create-only ownership keeps no bytes of the previous render). **No unmarked intermediate state exists.** Every steward entry point, including the git hook, refuses to do anything but recover while a journal is present.

**Implementation — round 5's replacement ordering, which is NOT the prototyped one, and is NOT what v0 ships either** *(annotated 2026-08-11)*. The ordering measured above (backups → journal → mutate → manifest → clear) was **superseded twice over** and must not be read as the resolution:

- Round 4 caught that it leaves an **unmarked** window: the `backups` row above measures `marked: False`, contradicting "no unmarked intermediate state exists".
- The owner's create-only cut (2026-08-11) then deleted the backups step outright — nothing is adopted, so there are no pre-adoption bytes to copy and no `.git/steward/backup/` store.

**SUPERSEDED — what round 5 would have shipped, and does not.** *(Annotated 2026-08-11.)* The sequence below is history: v0 has **no journal, no recovery, and no `.git/steward/`**, and ADR-6 no longer exists, so "rule 0-prime" has nothing to attach to. **What actually ships is ADR-20's ordering: write `.steward.json` first, then the artifacts, each by `os.replace`; an interrupted run leaves paths recorded as ours that are missing or mismatched, and both are ordinary findings.** *(Corrected 2026-08-13: only the **missing** case converges on the next `generate`. A mismatch — including the complete previous file a kill mid-rewrite leaves — is an `error` nothing overwrites, resolved by a human `rm`.)* v0 claims no atomicity at all.

> Write the journal **first**, as a *single file* at
> `$(git rev-parse --path-format=absolute --git-path steward-install-journal.json)` — this worktree's own gitdir, **no `.git/steward/` directory**, so the marker needs no `mkdir` and is one `os.replace` into a directory that already exists (the ordering the earlier text demanded but could not achieve, since it defined the marker *as* the directory it had to precede). Then: mutate → write the manifest → delete the journal. Recovery is idempotent and re-entrant; discard is available on a first install and roll-forward-only on a re-install, because no bytes of a previous render are kept. Keep manifest-last — it is correct, just far weaker than advertised. The journal is **per-worktree** so an interrupted install in one worktree cannot block commits in another (§2.3.6 verifies `git rev-parse --git-path <name>` resolves per-worktree).
>
> **ADR-6 rule 0-prime: journal present → exit 1, never exit 2.** A killed install leaves a dirty tree that the current gate table would happily let through, and exit 2 maps to warn-and-allow.

**The one line of this that survives** is the falsification itself: an unbounded "no partial state" guarantee did not hold under measurement, which is why ADR-20 now states an *ordering* and names its assumptions instead of making a guarantee.

### NEW BLOCKER SURFACED — Codex repo layer is inert — **RESOLVED 2026-08-11: option (a), and wider**

This was not one of the five and it is larger than three of them. §2.1.1: ADR-3 generates a file that codex-cli 0.147.0-alpha.6.5 does not read. **Do not ship `<repo>/.codex/hooks.json` as currently designed.**

> **Owner's resolution (2026-08-11): option (a), extended to every harness.** Codex gets `AGENTS.md` only — and the same reasoning removed the Claude hook surface too, since a tool-scoped Claude hook cannot be proven to fire on a credential-less install and this project's own standard is firing, not presence (ADR-28). **All harness-native hooks are deferred to v2** (see "Deferred out of v0" in `execution-plan.md`); ADR-3 and ADR-29 are removed, along with the harness plan tasks that then carried the ids P1.5b, P1.12, P6.4b, P7.2, P7.2a, P7.2b, P7.2c, P7.3 and P7.4. *(Annotated 2026-08-11: those are **old** ids from the pre-cut plan. The rewritten plan reuses P7.2 / P7.3 / P7.4 for unrelated v0 work — C4 freshness, inspection findings, and the **A3 acceptance fixture**, which is very much alive. Read this list as "the harness tasks that then bore these numbers", never as "P7.4 was cut".)* Option (c) — the two-stage probe described below — was the *previous* resolution and is **no longer the design**; it is retained here as the record of what was considered and as the starting point for v2.

Three options, all requiring an owner call:
- **(a)** Drop the Codex harness from v1 and say plainly in the generated docs that Codex gets `AGENTS.md` only, no hooks.
- **(b)** Retarget the user layer (`$CODEX_HOME/hooks.json`) — but that is a machine-local install step, not a committed repo artifact, and therefore **cannot be the shared-contract story ADR-3 wants**.
- **(c)** Gate generation behind a runtime probe. The cheapest honest probe is the one used here: write a sentinel key into the target config and check whether `codex exec --strict-config` **rejects** it.

Whatever is chosen, the installer must **probe rather than assume**.

> **Polarity warning, added after round 4 caught the bundle getting this backwards.** In this probe, **rejection of the sentinel is the PASS** — it proves the layer is read and validated. **Acceptance is the FAIL**, because an unread layer accepts everything (§2.1.1 accepted a bogus key *and* malformed JSON without a diagnostic). A probe that reads acceptance as success passes exactly when the harness is dead, which is the failure this whole descent exists to prevent.
>
> **And even the correct polarity is not sufficient.** Parsing a key out of `config.toml` says nothing about whether a separately generated `hooks.json` is *dispatched*. Managed status requires an **observed side effect from a hook that actually fired**, in an isolated scratch repo + `CODEX_HOME` — never by writing into the target repo, which would violate the ADR-20 no-write preflight. On this pinned version stage 2 is unreachable (no credentials → 401), so the probe's outcome would be **unmanaged** and no `.codex/hooks.json` generated — which is what made the probe pure overhead and led the owner to delete it. *(Written when option (c) was the design; ADR-3 and P7.2c no longer exist. Retained as the v2 starting point.)*

---

## 4. ADR IMPACT

This is what the descent cost. Ordered by severity.

> **Read this table as the Phase-0 record, not as the current design.** Two owner scope cuts on
> 2026-08-11 landed after it was written: **harness-native hooks → v2** (removing ADR-3 and ADR-29
> outright) and **create-only ownership** (removing the adopt path, pre-adoption bytes, the
> `.git/steward/backup` store, and origin-based rollback). Rows whose "required change" targeted a
> now-deleted feature are marked **SUPERSEDED** inline; their *findings* still stand and are the
> reason the features were cut.
>
> **A third cut landed later the same day and supersedes far more of this table (annotated
> 2026-08-11).** All enforcement machinery is gone. Every row addressed to **ADR-3, ADR-5, ADR-14,
> ADR-21, ADR-24, ADR-25, ADR-27 and ADR-29** now targets a decision that **no longer exists** —
> the required changes are not outstanding work, and the ADRs are listed in the *Removed in v0*
> table in [`ADR.md`](./ADR.md). The rows that remain live for v0 are: **ADR-1 (bytecode)**,
> **ADR-1 / ADR-22 (the vacuous dual-interpreter fixture — the fixture rule survives even though
> the tier does not)**, **ADR-1 (facts)**, **ADR-1 (containment task / `.gitattributes` spelling)**,
> **ADR-26** (now a single working-tree predicate, since v0 writes nothing under `.git`),
> **ADR-2 / manifest path**, **"any ADR leaning on vendor prose"**, and the cross-cutting
> recommendation below.
>
> Two rows deserve special notice because their *findings* shaped v0 even though their subjects are
> gone: **ADR-27's data-loss defect** (ownership verification succeeds on an adopted file, so
> rollback deleted it — an adopted untracked file was PERMANENTLY LOST) is why ownership is binary
> and create-only; and **ADR-14 + ADR-24's silent disable** (bootstrap failure exited 2, which the
> shim warn-and-allowed, giving an unbootstrapped machine zero enforcement forever) is a
> load-bearing argument for v0's posture: a tool that claims no enforcement cannot silently lose it.

| ADR | Verdict | Required change |
|---|---|---|
| **ADR-3** | **BROKEN AT THE FOUNDATION** → **SUPERSEDED: ADR-3 REMOVED** | The generated `<repo>/.codex/hooks.json` is unread by codex-cli 0.147.0-alpha.6.5 (§2.1.1). Resolved by the owner as *drop the harness*: **harness-native hooks deferred to v2**, ADR-3 removed, no probe shipped. |
| **ADR-3 (detection)** | **WRONG AS WRITTEN** → **SUPERSEDED: no longer needed in v1** | *"Detection only needs to find a `[hooks]` section header"* misses two of three valid spellings (broaden to `^\s*\[\[?hooks[.\]]` plus a dotted `^\s*hooks\s*\.`). v1 does not preflight `.codex/` at all, so nothing consumes this; it is a v2 prerequisite. `hooks` **is** a real typed top-level key (`expected struct HooksToml`). |
| **ADR-3 (evidence tier)** | **OVERSTATED** → **moot with ADR-3 removed** | *"Codex treats the two forms as functionally equivalent **[verified]**"* — no verification could be reproduced in either direction. The lesson generalizes and is retained: the bundle's own evidence tier overstated what was known. |
| **ADR-20** | **CONTRADICTED, rewrite required** (partly SUPERSEDED) | ADR-20's original *"No partial state on any path"* claim is false (§2.3.9). Round 5 replaced it with the recoverability contract in Blocker 5 — **whose own journal-first ordering is superseded there too**. *(Annotated 2026-08-11: v0 ships **neither**. ADR-20 now writes `.steward.json` first, then the artifacts, claims no atomicity, and states the ordering argument with its assumptions named.)* The `preAdoptionDigest` → pre-adoption **bytes** change is **withdrawn**: create-only ownership removed adoption entirely. |
| **ADR-27** | **CONTAINS A DATA-LOSS DEFECT** → **SUPERSEDED: the class is deleted** | *"Rollback verifies ownership before deleting"* is **exactly backwards for adopted files**: verification **succeeds** (the digest matches our render, because we own it now) and the file is therefore **deleted**. An adopted **untracked** file was `PERMANENTLY LOST`. The origin-based fix (restore pre-adoption bytes) was the first resolution; the owner's create-only cut is the second and final one — **there is no adopt path, so there is nothing to restore and nothing to lose.** Rollback is now: delete what we created where the digest still matches, decline everything else. |
| **ADR-26** | **CONTRADICTED by reality, reproduced live in the reference monorepo** | *"every install location asserted to lie inside the repository root ... a path escaping the root is a hard error, never a warning"* hard-errors on the hook install in **all 106 worktrees of the reference monorepo** (§2.3.6). Split into **two** predicates: **(a)** every **working-tree** path derived from the manifest must resolve inside `git rev-parse --show-toplevel` after symlink resolution — the arbitrary-write/arbitrary-delete guard, stays a hard error; **(b)** every **git-metadata** path must resolve inside `--path-format=absolute --git-common-dir` **or** the worktree's own gitdir, **and** be on an explicit allowlist — **four entries as ADR-26 now stands: hooks, the interpreter pin, the hook-state record, and the install journal** (this row was written when only the first two existed). The realpath predicate itself is **verified sound** (refused both `../VICTIM.txt` and an inside-the-repo symlink pointing out; the outside file survived) — keep it, just apply it to the right domain. |
| **ADR-1 (bytecode)** | **CONTRADICTED** | *"`sys.dont_write_bytecode = True` set before any import"* does not prevent `__main__.cpython-*.pyc`. Make `PYTHONDONTWRITEBYTECODE=1` (launcher-exported) and `-B` the **normative** mechanism; keep the in-file line as belt-and-braces only. |
| **ADR-1 / ADR-22 (fixture)** | **VACUOUS AS SPECIFIED** | The "minimal writes nothing / `git status --porcelain` unchanged" fixture is **vacuously green on Apple's 3.9.6**, which redirects bytecode to `~/Library/Caches/com.apple.python`. **Must be a dual-interpreter fixture** or it tests nothing. Extend it to assert the **import set** too, since `import yaml` succeeds at 3.13.5 and fails at 3.9.6. |
| **ADR-1 (pinning)** | **UNIMPLEMENTABLE AS WRITTEN** | *"doctor asserts the running interpreter matches the pinned one"* produces a **guaranteed false failure** for `/usr/bin/python3`: `realpath(pin) != realpath(sys.executable)`, always. Pick one and write it down — either resolve the pin through the interpreter at install time (write `sys.executable`, not the invoked path) and compare realpaths on both sides, **or** state that `/usr/bin/python3` is pinned by shim path and doctor compares version + shim path, never `sys.executable`. The current text supports neither. Related: do **not** pin `/usr/bin/python3` — it is an `xcode-select` dispatcher (same inode as `/usr/bin/git`) that `DEVELOPER_DIR` redirects. |
| **ADR-1 (facts)** | **FACTUALLY IMPRECISE** | The 3.13.5 on PATH is a **python.org framework build**, not Homebrew (Homebrew's is 3.14.2). There are **four** `python3` on PATH. "The fallback resolves to 3.9.6" holds only under the launchd PATH; under `env -i` the hook got 3.13.5 via `/usr/local/bin`. This makes the pinning argument stronger, but ADR-1 states it wrongly. |
| **ADR-1 (containment task)** | **WOULD SILENTLY NO-OP** | The `.gitattributes` task must be written `tools/steward/** linguist-vendored`. `tools/steward/` and `tools/steward` are both verified no-ops. Do not use `=true` (a different git attribute state, and Linguist's docs use the bare form). |
| **ADR-24 (pin scope)** | **CONTRADICTED** | *"Only the interpreter pin is machine-global, which is correct — it describes the machine, not the checkout"* is false as specified. `tools/steward/.pin.local` is **per-worktree**: a fresh `git worktree add` has no pin and dies at exit 2 on the next commit — **~100 bootstrap steps in the reference monorepo, and every future `worktree add` breaks commits**. Fix: `$(git rev-parse --path-format=absolute --git-common-dir)/steward-pin.local` — verified shared across all worktrees, invisible to `git status`, no `.gitignore` entry needed. **Note `git rev-parse --git-path <arbitrary-name>` does NOT do this** (it resolves to the per-worktree gitdir); only the common-dir expression works. |
| **ADR-24 (floor check)** | **UNSOUND IF EXIT-STATUS-BASED** | Pinning `/bin/echo` **passed** an exit-status floor check and the launcher reported `EXIT=0` having run nothing — the project's stated worst case, reproduced in its own launcher. Require a **proof-of-python token on stdout**: with `print("STEWARD_PY_OK %d %d")` matched literally, the same pin gives `steward: pinned path /bin/echo is not a working python3` `EXIT=2`. Costs a measured **52 ms/run** (85 ms vs 34 ms over 10 runs) — budget it or design a cached fingerprint (untested). |
| **ADR-24 vs ADR-22** | **CONTRADICTED — ADR-22 wins** | Narrow *"every caller invokes `tools/steward/steward`"* to the **installed tiers**. See Blocker 3. |
| **ADR-24 (argv sniffing)** | **FRAGILE** | *"if absent AND running under `--profile=ci`"* forces the `sh` launcher to parse argv, creating a second parser that must agree with the core's; a loose scan mis-fires on a bare `ci` argument after any `--profile`. **Prefer an environment signal (`STEWARD_PROFILE=ci`).** |
| **ADR-14 + ADR-24** | **UNSTATED, DANGEROUS INTERACTION** | The launcher signals **every** bootstrap failure as exit 2, and the shim maps exit 2 to warn-and-allow. Verified end-to-end: `core 2 -> "the-steward: the tool itself broke (exit 2); allowing the commit" -> COMMIT CREATED`. So **an unbootstrapped machine gets zero enforcement, forever, silently** — the exact silent-disable this project exists to prevent, arriving through the front door. Either pin-absent needs its own exit code the shim treats as **blocking**, or doctor must be wired into a path a developer cannot scroll past. (Launcher passthrough is otherwise exact: 0→0, 1→1, 2→2, 7→7; the ADR-14 adapter itself works.) |
| **ADR-21** | **SELF-CONTRADICTORY** | ADR-21's own text (CI file **is** an owned artifact) vs the *Rejected alternatives worth recording* table (that design **rejected**). Evidence forces **OWNED**; delete the rejected-alternatives row. Also re-specify the doctor states: the strongest state **is not reachable from a local offline run**, and add a fourth state, *configured but modified*. (The fourth state was subsequently renamed **`ci-self-attested`** by owner decision, 2026-08-11.) |
| **ADR-6** | **NEEDS A NEW RULE** | Add **rule 0-prime**: journal present → **BLOCK, exit 1**. The gate table has no state for "an interrupted install is pending", and a killed install leaves a dirty tree the current rules pass. Must be exit 1, not exit 2. |
| **ADR-6 / ADR-8 (consent)** | **REFRAMED, not contradicted** | The justification changes from preference to physics — a hook cannot solicit consent. Contract language in Blocker 1. |
| **ADR-2 / ADR-24 (manifest path)** | **MUST BE NAMED, at the root, tracked** | `.steward.json`. See Blocker 2. |
| **ADR-25** | **CONFIRMED** (recorded because round 3 flagged it as a suspected ADR-26 conflict) | Repo-relative resolution genuinely works — the shared hook runs with `--show-toplevel` at the linked worktree and executes that worktree's own core. `git rev-parse --git-path steward` gives per-worktree private state, and an interrupted install in one worktree does not block the other — **this measurement is what pins the install journal to the per-worktree gitdir** (ADR-20). **Only its "the pin is machine-global" clause fails** (see ADR-24). |
| **ADR-25 (version tolerance)** | **UNSOUND — REWRITTEN 2026-08-11** | *"the shared hook detects a core whose `.vendor.json` version it does not understand and degrades to a warning (exit-2 semantics)"* routes a **pre-core** condition into warn-and-allow, which is a silent disable; the exit reservation assigns pre-core failures to **3** (blocking). Rewritten: the shim is **version-agnostic** — it reads no `.vendor.json`, dispatches to the invoking worktree's own committed launcher, and decides only via the enrolment discriminator (not enrolled → 0 silently; enrolled but unbootstrappable → 3, blocking). |
| **ADR-14 (shim output cap)** | **SILENT DISABLE — FIXED 2026-08-11** | The cap was specified as piping the child through `head -c`. POSIX `sh` has no `PIPESTATUS`, so the pipeline's status is the **filter's**: a core emitting a large diagnostic and exiting **1** yields **0** and the commit is **allowed**. The plan tested "exit 1 blocks" and "output is capped" separately, so both passed while the combination failed. Fixed by capture-then-truncate (child never on the left of a pipe; `$?` captured immediately) plus a **combined** regression test. |
| **ADR-5** | **RE-VERIFIED, holds** | the reference monorepo's `core.hooksPath` is the absolute path equal to the default location; `.git/hooks` contains `post-checkout.gitbutler-disabled-20260624-181323`. **Add a fourth branch:** a **relative** `core.hooksPath` resolves per-worktree against the working-tree root — the three-branch model does not cover it. |
| **ADR-4** | **UNCHANGED** | An `os.replace`-installed file inherits the **source** file's mode; chmod before rename or it lands with the wrong mode. (This row measures the mode behavior only. ADR-4's three hook claims — `--no-verify`, hooks not cloned, `hint:`-only on a non-executable hook — are **not probed anywhere in this document**, which is why ADR-4 now reads *[observed, not re-verified]*.) |
| **Any ADR leaning on vendor prose** | **INHERITS AT LEAST THREE ERRORS** | Codex `session-end` lacks `model`/`permission_mode` and has no output schema; Claude Code accepts **30** hook events, not ~10; Claude Code has **five** handler types, not one. The two prior researchers disagreed because both read prose. **Pin every contract to the binaries and to the versions in §1.** |
| **Any ADR assuming a bare `codex` command** | **WRONG ON THE REFERENCE MACHINE** | `which codex` fails; the only binary is inside `/Applications/ChatGPT.app`. Same treatment as ADR-1's interpreter pinning. |

**Cross-cutting recommendation the evidence earned:** *make the doctor prove firing, not presence.* Every claim in this document that mattered came from a hook that did or did not append to a log file; every claim that misled came from prose. Doctor should ship a self-test that **actually fires a no-op hook and verifies the log** — because "the config file exists and parses" is precisely the check that would have passed for Codex the entire time the harness was dead.

---

## 5. STILL UNVERIFIABLE

> **v0 disposition (annotated 2026-08-11; CORRECTED round 6).** ADR-23 survives unchanged — an
> unverified vendor contract is still an owner decision and never a self-granted waiver — and v0
> discharges it almost entirely **by subtraction**. The 2026-08-11 text then said: *"v0 depends on
> exactly one vendor contract: Codex's `project_doc_max_bytes` document cap (ADR-17), which is
> verified."* **Both halves were false.** v0 *acts on* two — ADR-15's `CLAUDE.md` / `@AGENTS.md`
> import as well as ADR-17's cap — and **neither has a probe in this document**. They were added to
> the owner-decision table below as **E1** and **E2**. **Both are ruled on as of 2026-08-12** — E1
> *proceed with stated risk* (the import and the region are gone; the generated `CLAUDE.md` is not),
> E2 kept as a `warn` — so **no owner call is open
> and no plan task is gated**, and neither ruling requires this document to gain a probe. It also
> *reads* vendor prose in ADR-4, ADR-16 and ADR-18 without acting on it; those carry *[observed, not
> re-verified]* and escalate nothing. Everything else in this banner stands.
>
> - The three **Codex hook** items were already deferred; v0 makes them permanent non-dependencies.
> - The **live Claude payload** item is likewise a non-dependency: v0 writes no harness hook config.
> - **`/usr/bin/python3` on a CLT-less machine** is **MOOT for v0 (owner, 2026-08-11).** It was
>   load-bearing only because ADR-1 pinned an interpreter path. **v0 pins nothing**: it runs whatever
>   `python3` the caller provides and asserts the 3.9 floor loudly as its first action, so a machine
>   with no working `python3` gets an immediate, legible failure rather than a silently wrong
>   interpreter. What is left is *installation ergonomics*, not correctness. **Closed — no owner call
>   needed.**
> - **GitHub's skipped-required-check semantics** is **MOOT for v0 (owner, 2026-08-11)** — v0
>   generates no CI, owns no workflow, and makes no claim about any check. **Closed — no owner call
>   needed.**
> - The `.gitattributes` bare-form question was settled by the owner and is folded into ADR-1.
>
> ~~**Nothing in §5 requires an owner decision for v0 to proceed — no exceptions, including the two
> non-harness items, both of which are closed above.**~~ **Withdrawn in round 6.** The six items
> listed below were indeed all closed; the sentence was wrong because the list was incomplete. The
> two contracts v0 actually ships against — **E1** and **E2** — were never in this table at all,
> because both were believed verified. **Both were ruled on 2026-08-12 and neither is open.** The
> residual-risk table below is retained in full; the bytecode / `pycache_prefix` and `os.replace`
> rows remain the live ones. Bytecode is mitigated by the dual-interpreter fixture. The `os.replace`
> mitigation **changed on 2026-08-12**: temp files stage at the **repository root**, not in the
> target's own directory (staging inside `tools/steward/` turned a kill into a permanent
> foreign-child collision, ADR-20), and a cross-filesystem `os.replace` is handled as **exit 2**.

### Needed an owner decision (ADR-23) — all closed as of 2026-08-12

> **Status:** the six original items closed for v0 on 2026-08-11. **E1 and E2 were ruled on by the
> owner on 2026-08-12** and gate nothing: **E1 — proceed with stated risk** (the `@AGENTS.md` import
> and the region are deleted, but `CLAUDE.md` is still generated on the unprobed file-loading
> reading; ADR-15); **E2 — keep the check at `warn`**, upgradeable only against a verified cap
> (ADR-17). Both reduce the behavior instead of asserting the claim, which is what ADR-23 exists to
> make possible.
>
> - The **three harness items** are DECIDED, and the decision is *"defer that harness"* (an ADR-23
>   option, taken wholesale). All harness-native hooks move to v2, so no v0 code is written against
>   any unverified harness contract — exactly what ADR-23 requires. Retained as **v2 prerequisites**.
> - The **two non-harness items** — `/usr/bin/python3` on a CLT-less machine, and GitHub's
>   skipped-required-check semantics — are **MOOT for v0** (owner, 2026-08-11), for the reasons given
>   in the §5 banner above: v0 pins no interpreter and generates no CI. **They were open against the
>   *previous* design and are recorded as answered, not as pending.**
> - The `.gitattributes` item was **settled** by the owner (bare form) and folded into ADR-1.
>
> The "why it needs a decision" column below is the *previous* design's reasoning, preserved as
> written. Read it as the record of why each was once a blocker.

| Item | Why it needs a decision |
|---|---|
| ~~**E1 — Does Claude Code read `CLAUDE.md` and not `AGENTS.md`, and does it honor an `@AGENTS.md` import (including inside a comment-delimited region)?**~~ — **RULED 2026-08-12: PROCEED WITH STATED RISK** | Was ADR-15's entire justification. Read from vendor prose in Phase 0 and **never reproduced**: §2.2 contains only hook probes, and its banner asserting this claim was the sole thing behind ADR-15's `[verified]` marker. **Owner's ruling:** delete the import and the region protocol (ADR-7), which removes the *expansion* question entirely — but v0 **still generates `CLAUDE.md`** on the unprobed reading that Claude Code loads it, so this is *proceed with stated risk*, not a dropped dependency. **Remaining blast radius:** a real owned artifact created, recorded and re-rendered in every target repo that possibly no harness reads — waste and a permanent C4 surface, not a false routing claim, since nothing depends on an import expanding. No probe is owed at that risk level. |
| ~~**E2 — Is Codex's `project_doc_max_bytes` 32 KiB, does it apply to the generated `AGENTS.md`, and is the excess dropped silently?**~~ — **RULED 2026-08-12: KEEP THE CHECK, DOWNGRADE TO `warn`** | **No probe exists** in this document; §2.1 states outright that the Codex surface produced almost no positive contract, and the 32 KiB figure appears here only in cross references that cite ADR-17 citing this file. **Owner's ruling:** the check stays, because silent truncation is exactly the class the tool exists to surface, but at `warn` — v0 fails no repository on an unverified number. **It upgrades to `error` if and only if the cap is verified against the pinned binary** (extract the default as §2.1.2 did, overrun it once, record command and output here). |
| ~~**Real Codex hook stdin payload on the wire**~~ — **DEFERRED TO v2** | No Codex hook was ever made to fire. Repo-level `.codex/` is unread; writing hooks into the user's live authenticated `~/.codex/config.toml` was refused; an isolated `CODEX_HOME` has no credentials and dies at `401 Unauthorized ... wss://api.openai.com/v1/responses` before a session starts. Copying the user's `auth.json`/keychain credentials into a scratch home was refused. **The entire Codex contract in §2.1.2 is declared, never observed.** ADR-23 forbids coding against it without an owner call. *Cheap for a human at a terminal.* |
| ~~**Do user-layer Codex hooks fire at all, and do the two forms really produce a merge warning + duplicate execution?**~~ — **DEFERRED TO v2** | Same blocker. `codex doctor` reported only `config.toml parse ok` with no merge warning — **but that run never reached hook dispatch, so absence of a warning is not evidence of absence.** ADR-3's `[verified]` marker rests on nothing reproducible. |
| ~~**Does the Codex TUI read repo-level `.codex/hooks.json` behind the `startup_hooks_review` prompt**~~ — **DEFERRED TO v2** | Cannot drive an interactive TUI from a non-interactive session. Evidence points to *wholly unimplemented* (`tui/src/startup_hooks_review.rs` exists, but the literal string `.codex/hooks.json` does **not** exist in the binary, and repo `.codex/config.toml` is demonstrably unread) — but the TUI path was not observed. It would have decided between options (a) and (c); the owner chose **(a) for both harnesses**, so v1 needs no answer and v2 must obtain one before generating anything. |
| ~~**Whether `/usr/bin/python3` works on a machine with no CLT/Xcode installed**~~ — **MOOT for v0 (owner, 2026-08-11)** | *Previous design's reasoning:* ADR-1's *"ships with the Xcode CLT that already provide git"* rested on this. CLT cannot be uninstalled here. Strongest proxy: `DEVELOPER_DIR=/nonexistent /usr/bin/python3 -V` → `xcrun: error`, exit 1 — suggesting a CLT-less machine gets a non-functional shim (likely a GUI install prompt), but not proving it; it would have needed a clean VM. **It was load-bearing because ADR-1 pinned an interpreter path. v0 pins nothing and asserts the 3.9 floor loudly**, so this machine's answer changes no v0 behavior: an unusable `python3` produces an immediate, legible failure. Re-opens only if v0 ever pins again. |
| ~~**Does a GitHub required check *skipped* by a `paths:` filter block the merge, or silently pass it?**~~ — **MOOT for v0 (owner, 2026-08-11)** | *Previous design's reasoning:* not determinable offline or from repo contents; it depends on branch-protection configuration and GitHub's required-check semantics, needing an authenticated API call against a real repo. It would have decided whether a path-filtered steward job was merely useless or actively misleading, and therefore what the generated docs had to warn about. **v0 generates no CI, owns no workflow, and its generated docs make no claim about any check**, so there is nothing for the answer to change. Re-opens with CI generation, which is cut, not scheduled. |
| ~~**`linguist-generated=true` vs bare `linguist-generated`**~~ **— SETTLED by owner, 2026-08-11: use the BARE form** | git reports them as **different attribute states** (`true` vs `set`). Linguist's docs show only the bare form; Linguist itself could not be run (no Ruby/Linguist install) and GitHub's server-side behavior is not locally observable. Owner's call: **use the bare form (`linguist-vendored`, `linguist-generated`), never `=true`** — the form the vendor's own docs literally use. *(2026-08-13: this settles the **form**, not what is written; v0 generates only the `linguist-vendored` line and merely reads `linguist-generated` — §2.3.7.)* Folded into ADR-1 and plan task **P6.5** *(renumbered 2026-08-11; the old id P7.6 now names an unrelated task)*, whose fixture asserts `git check-attr` reports `set` in the case where `generate` created `.gitattributes`. |

### Acceptable residual risk

| Item | One-line justification |
|---|---|
| **Live Claude Code `PreToolUse`/`PostToolUse`/`Stop` payloads** | Nested `claude -p` is unauthenticated (`Not logged in`) and exits before any tool runs; keychain extraction was refused. Field sets are source-derived from the binary's own payload builder, and §2.2.7 already forces the correct defensive posture — **treat every field as optional** — so an over-declared list cannot cause a wrong contract, only a missed opportunity. **2026-08-11: no longer even a residual risk for v1** — this unverifiability, applied to the ADR-28 "prove firing" standard, is the second half of *why* Claude hook config is deferred to v2. |
| **Claude Code's *interactive* first-run trust dialog** | Cannot drive the TUI here, but `xfo()` contains **no trust check on any path**, so an interactive/headless divergence is unlikely; and the headless path is the one the-steward's users (agents, CI) actually take. |
| **Whether the 21 embedded Codex schemas match GitHub `main`'s generated schemas** | A `curl` to api.github.com was denied by the sandbox, and the embedded copy is **strictly the better source** — it is the shipped release, and the vendor's docs warn `main` may contain unreleased fields. Divergence is unmeasured and irrelevant if we vendor the binary-extracted copy, as recommended. |
| **Whether cross-filesystem `os.replace` raises `EXDEV` here** | No second writable filesystem was reachable (every candidate path reports `st_dev=16777231`; the RAM-disk attempt failed at `diskutil eraseVolume` with `ERASE_FAILED`, no authorization; the device was detached). The design rule was **always stage the temp file in the target's own directory**, adopted on POSIX-specification grounds. **Superseded 2026-08-12** (ADR-20): temp files stage at the **repository root** — same working tree, and outside every directory the ownership rules classify — and a cross-filesystem `os.replace` is reported as **exit 2** naming both paths instead of being designed away. The risk this row records is therefore handled, not eliminated. |
| **Whether fsync+rename survives real power loss** | Only `SIGKILL` could be sent. That proves application logic left nothing half-written; it does not exercise the kernel/disk write-back path. **All "crash" claims in §2.3.9 mean "process killed", not "host lost power"** — stated plainly rather than overclaimed, and the journal design degrades gracefully either way. |
| **Whether Apple's `sys.pycache_prefix` patch is stable across macOS/CLT versions and applies to the Xcode.app python** | One CLT version installed (26.3.0.0.1.1771626560), Xcode.app absent. Single data point; the mitigation (dual-interpreter fixture) is correct regardless of which interpreters diverge. |
| **What PATH a specific GUI git client (Tower, Fork, GitHub Desktop, SourceTree) hands to a hook** | None installed, and `ps -Eww` cannot read process environments on this macOS (returned 0 `PATH=` lines even for the agent's own shell). Substituted **two real launchd jobs**, which is the same inheritance path a GUI app gets; both gave `/usr/bin:/bin:/usr/sbin:/sbin`. A client that spawns hooks through a *login shell* would differ — and the pin makes the answer irrelevant. |
| **How often `git gc --auto` fires in practice** | Only the explicit `git gc --prune=now` case was exercised; automatic-gc thresholds and the default two-week prune expiry were not. Does not change the recommendation — the plain-copy store is unaffected either way. |
| **Whether a whitespace-trimmed/fingerprinted pin can avoid the 52 ms floor-probe cost soundly** | The fingerprint-cache design is untested; only the two-process form was measured. 52 ms/run is affordable, so shipping the verified-but-slower form is the safe default. (Separately: a pin with trailing spaces/CRLF **fails closed at exit 2** — correct, but confusingly worded; add whitespace trimming.) |

---

### Appendix — Phase-0 working artifacts

> **HISTORICAL for v0 (annotated 2026-08-11).** Every row is a throwaway probe, and several cite
> decisions and plan-task ids that **no longer exist** — the cut removed ADR-3, ADR-14, ADR-24 and
> ADR-29, and the plan was renumbered. The dispositions are annotated in place; no row describes
> work v0 owes.

These lived in a **local scratch directory that is wiped**, so their absolute paths are deliberately
not recorded: a path no reader can resolve is not evidence, and the scratch prefix carries the user
and session identifiers this document redacts. What matters is **which artifact must become tracked
content and where it goes** — everything else was a throwaway probe whose *result* is already written
into the sections above.

| Artifact | Disposition |
|---|---|
| **21 Codex hook schemas** (28,397 bytes) | ~~VENDOR AS TRACKED CONTENT (P1.12 → P7.3)~~ — **WITHDRAWN 2026-08-11**: both tasks are removed with the v2 harness deferral, so nothing in v1 consumes a Codex hook schema. Throwaway for now; **regenerate from the pinned binary if v2 needs it** (method in §2.1.2), never from GitHub `main` |
| Codex / Claude Code binary strings dumps | Throwaway. Regenerate from the pinned binaries if a claim needs re-checking; not evidence to be committed (they are multi-hundred-MB derivatives of vendor binaries) |
| Codex hook lab (repo-layer probes), Claude hook lab | Throwaway, and the Claude lab **contained live session ids** — deleted, never committed, and no path to it is recorded here. The sanitized payload shapes it produced are in §2.2.7 with `<REDACT>` placeholders |
| Runtime/launcher probes + the 96-line ADR-24 launcher prototype | Throwaway, and now **doubly moot**: *(annotated 2026-08-11)* **ADR-24 is removed** — there is no launcher and no interpreter pin in v0 — and the exit-3 reservation went with ADR-14, so v0 has exactly three exit codes (ADR-13). The plan-task ids named here (P1.8 / P6.1b) are pre-cut ids; **the surviving descendant is P1.3's loud floor assertion**, and P1.8 in the rewritten plan is the unrelated dual-interpreter no-writes fixture |
| Atomicity/consent harnesses + journal prototype | Throwaway. *(Annotated 2026-08-11: the "corrected sequence" this row pointed at — journal-first, a single per-worktree file — **is itself removed**. v0 has no journal at all; ADR-20 writes `.steward.json` first, then the artifacts, and claims no atomicity. Plan task P6.2b no longer exists; the surviving kill-point fixture is **P6.4(c)**, a matrix of five points.)* The measurement the harness produced still matters: it falsified an unbounded "no partial state" guarantee, which is why v0 states an ordering with named assumptions instead |

**Provenance of this document.** Written from three empirical agents' raw findings. The synthesizer independently re-ran and re-read: all version pins; the 21-schema artifact and its input/output field sets; the Claude Code 30-event enum, handler union, `permissionDecision` enum, and `xfo()` loader; the live hook capture; the reference monorepo's worktree containment facts and worktree count; the `.gitattributes` pattern forms; the Python 3.9 floor primitives and parser availability; the `pycache` leak and `pycache_prefix` divergence; and the interpreter-pin realpath mismatch. Claims not personally re-run by the synthesizer are reported with the originating agent's exact command and output. **Nothing in the design bundle or in `<REFERENCE-REPO>` was modified; nothing was committed or pushed.**
