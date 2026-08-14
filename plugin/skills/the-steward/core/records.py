"""The ADR-11 record state machine: two stored states, everything else derived.

`.steward.json` stores exactly two states — `proposed` and `confirmed`
(`manifest.STATES`) — and this module is the only place any other reading of a
record is produced. *Drifted* is a **confirmed** record whose stored value no
longer matches reality. It is computed here, at read time, from the record and
one answer about the repository, and it is **never written**: an earlier draft
stored it as a third state, which is a transition no operation could perform —
`scan` persists nothing, and `generate` leaves a confirmed record exactly as
the human left it, so nothing would ever have set it or cleared it.

**Four things this module refuses to do, and the defect each refusal
prevents.**

1. **It never returns a record**, so nothing here can promote an inference to
   `confirmed`. Confirmation is a human editing the tracked manifest and
   committing the diff (ADR-11); a tool able to write `confirmed` would let an
   unreviewed manifest declare itself approved and then fail a build with it.
2. **It never deletes a record.** "The command vanished" is precisely the drift
   worth reporting — it is acceptance case A1 — and a machine that pruned the
   record instead would delete the finding along with the claim, so the repo
   would go quiet at the exact moment it became wrong.
3. **It never defaults.** An unrecognised stored state raises, and a `waived`
   key with no usable reason raises, because reading either leniently turns a
   confirmed record's `error` into a `warn` or an `info` on the strength of a
   lookup that failed. That is this project's one recurring defect — a failed
   probe reported as a confident answer — wearing the state machine's clothes.
4. **It never reads an untyped answer.** `resolved` is the repository's answer
   about a record's own claim: the only input here that decides a severity, and
   for a while the only one with no guard at all. See
   `_require_resolution_set` — the same defect again, in a costume that needs
   no failure.

**What this module re-checks, and what it delegates (the bound).** The four
refusals are a *second* layer over `manifest.validate`, and deliberately not a
copy of it. Re-checked here because each decides a **severity**, and reading it
leniently changes a finding: the stored `state`, a `waived` key with no usable
reason, and — since these come from the caller and never from the manifest at
all — the two typed inputs above. Delegated to the validator and re-checked
nowhere: ADR-18's rule that `external` is valid only on a `confirmed` record,
and the fact that `resolution` is not a legal key on a **paths** record. The
first would change nothing if it arrived — an `external` record reads
`EXTERNAL` in either stored state, which is the reading ADR-18 gives it anyway.
The second *would* change a reading — a paths record carrying `resolution:
"external"` would read `EXTERNAL` here — and `manifest.validate` is where it is
stopped, rejecting the unknown key with **exit 2** before any check runs, so no
such record can reach this module. A second layer for it would buy a defence
against a record shape that cannot exist, priced at one more refusal branch and
one more reachable state. That is the trade this project declines: prefer
deleting a rule to qualifying one.

**Tiers, and the trap in them (ADR-28).** A drift or violation finding is tier
`resolved`: we followed the claim to a real object in the repository and it did
or did not exist. It is *not* `inferred`, and it could not be — `findings`
refuses `severity="error"` on that tier, because an inference is never proof.
The consequence is easy to get backwards: a *record* may carry a stored
`confidence` (ADR-2 stores confidence per inference), while the *finding* it
produces carries none, since `confidence` is forbidden on every tier but
`inferred`. They are different fields on different objects.

**Resolution is a parameter, deliberately.** Whether a command resolves to one
of the repository's own declarations (C1) and whether a declared path resolves
in the working tree (C2) are two different questions, both Phase 4's, and
ADR-32 is the only place either is defined. This module takes the answer and
owns what follows from it: which reading the record takes, which severity that
reading carries, and which cardinality line the record lands on.
"""

import findings
import manifest
import text

# The two stored states, named so the reading code below is legible. Pinned
# against `manifest.STATES` by a test rather than re-derived here: a third
# stored state would have to pass the validator, and no operation could write
# one.
PROPOSED = "proposed"
CONFIRMED = "confirmed"

# The read-time readings. **None of these is ever stored** (ADR-11), and a test
# asserts the validator refuses every one of them as a `state` value. They are
# derived from (record, does it still resolve) and from nothing else.
#
# `EXTERNAL` is deliberately spelled the same as the record's `resolution`
# kind: the reading *is* the declaration. ADR-18 says a human's `external`
# declaration is never resolved and never counted as coverage, so the
# resolution answer is not consulted for it at all.
IN_SYNC = "in-sync"
DRIFTED = "drifted"
UNRESOLVED = "unresolved"
WAIVED = "waived"
EXTERNAL = "external"

DERIVED_STATES = (IN_SYNC, DRIFTED, UNRESOLVED, WAIVED, EXTERNAL)

# ADR-13, one row per derived state. `None` is *no finding at all*, which is
# the only honest reading of a claim that resolved. The table is exhaustive by
# construction and a test asserts it covers `DERIVED_STATES` in both
# directions: a state with no row here is a bug, never a default.
SEVERITY = {
    IN_SYNC: None,
    DRIFTED: "error",
    UNRESOLVED: "warn",
    WAIVED: "info",
    EXTERNAL: "info",
}

TIER = {
    IN_SYNC: None,
    DRIFTED: "resolved",
    UNRESOLVED: "resolved",
    WAIVED: "resolved",
    EXTERNAL: "inspected",
}

# ADR-32's two record sets, and the only two this machine reads. `docsScope` is
# a scope key too (ADR-30) but it is not a claim record set.
CLAIM_KINDS = ("commands", "paths")

# ADR-32's wording for a check with no record set to read, **verbatim**
# (ADR.md:987-989). Choosing it is the caller's, because only the caller knows
# whether the set is empty because there is no manifest or because the manifest
# declares nothing — and ADR-30 rules those two cases differently. Pinned by a
# test against the literal sentence, never against this name: a comparison of
# the constant to itself moves with whatever a mutation puts here.
NO_CLAIM_SOURCE = "no claim source — nothing to verify"

# The reason the machine itself can supply, because it is a property of the
# records rather than of the repository (ADR-18, ADR-30) — and, being the
# condition actually observed, the one that wins over a reason the caller chose
# before the records were counted. See `record_findings`.
ALL_EXTERNAL = (
    "every record is a human-declared external tool, counted separately and "
    "never as coverage"
)

PENDING_CHECK = "scan-pending"
NO_PENDING = "no re-scan delta is recorded"

_NOUN = {"commands": "command", "paths": "path"}

_CLAIM = {
    "commands": (
        "the approved command %r resolves to one of this repository's own "
        "declarations"
    ),
    "paths": "the declared path %r resolves in the working tree",
}

# `%r` on the waiver's reason, for the reason ADR-32 gives for a record value:
# a value carrying a line break would silently become two lines of a report
# that is one item per line. The validator rejects a control character in a
# record *value* and says nothing about a *reason*, so the renderer is where
# that has to be unable to happen.
_OBSERVED = {
    DRIFTED: (
        "it does not. The record is confirmed, so this is drift and not a bad "
        "guess: re-confirm or revert."
    ),
    UNRESOLVED: (
        "it does not. The record is proposed — an inference nobody has "
        "confirmed — so it is reported and settles nothing."
    ),
    WAIVED: "it does not; the record carries a waiver: %r",
    EXTERNAL: (
        "it names a tool this repository does not declare, so it is reported "
        "as the human declared it and never counted as coverage."
    ),
}


class RecordError(Exception):
    """A record the state machine will not read.

    Always a programming error here, exactly as `findings.FindingError` is:
    every claim record reaching this module has already passed
    `manifest.validate`, so an unreadable one means a caller built it by hand
    and got it wrong. It is deliberately **not** in `cli.REPORTED_FAULTS` —
    a predicted fault gets a one-line message, and this is not predicted.
    """


def _require_kind(kind):
    if kind not in CLAIM_KINDS:
        raise RecordError(
            "the-steward: %r is not one of ADR-32's two record sets %s"
            % (kind, list(CLAIM_KINDS))
        )


def _state_of(record):
    """The record's stored state, or a refusal to guess at it."""
    state = record.get("state") if isinstance(record, dict) else None
    if state not in manifest.STATES:
        raise RecordError(
            "the-steward: a record's stored state must be one of %s, observed "
            "%r. Reading an unrecognised state as %r would downgrade a "
            "confirmed record's error to a warn on the strength of a lookup "
            "that failed (ADR-11, ADR-13)."
            % (list(manifest.STATES), state, PROPOSED)
        )
    return state


def _waiver_reason(record):
    """The waiver's reason, or None where there is no waiver.

    A `waived` key somebody typed and left empty is not a waiver, and reading
    it as one downgrades a confirmed record's `error` to an `info` for free.
    `manifest.validate` already rejects that shape (manifest.py:118-126); this
    is the second layer, and the one that still holds for a record that reached
    the machine without passing through the validator.
    """
    if not isinstance(record, dict) or "waived" not in record:
        return None
    waived = record["waived"]
    reason = waived.get("reason") if isinstance(waived, dict) else None
    if not isinstance(reason, str) or not text.ascii_strip(reason):
        raise RecordError(
            "the-steward: a waived record must carry a non-empty reason, "
            "observed %r. An empty waiver is not a waiver, and reading it as "
            "one would excuse a confirmed record's error for free (ADR-11)."
            % (waived,)
        )
    return reason


def _require_resolution_set(resolved):
    """`resolved` answers membership, and a `str` does not — not usefully.

    **Instance fourteen of this project's one defect** — *a failed or unsafe
    probe reported as a confident answer* — in a fourth costume: **a
    wrong-typed probe silently answered.** The three costumes already closed
    all involve something going wrong first (a raw non-zero status read as an
    answer, a swallowed `except` manufacturing a negative fact, a followed
    symlink answering about a different file). This one needs no failure at
    all. `record_findings` asks the repository exactly one question,
    `value in resolved`, and it is the only input that decides a severity; on a
    `str`, `in` means **substring**. Hand it `"npm run test-all"` and a
    **confirmed** record for `npm run test` reads *in sync*, emits no finding,
    exits 0, and is still counted as examined — a check nobody performed,
    printed as coverage, which is ADR-30's vacuous pass wearing a cardinality
    (ADR-32).

    An object with no `__contains__` is refused for the same reason and not for
    tidiness: it either cannot answer `in` at all, or answers it by iterating —
    and an iterator answers the first record, then answers *no* to every record
    after it, having been consumed by the first question.
    """
    if isinstance(resolved, (str, bytes, bytearray)):
        raise RecordError(
            "the-steward: `resolved` is the container of values the repository "
            "resolved, observed the %s %r. On a string `in` is a substring "
            "test, so a confirmed record whose value merely occurs inside it "
            "would read in sync, emit no finding, and still be counted as "
            "examined — a check nobody performed, printed as coverage "
            "(ADR-30, ADR-32)." % (type(resolved).__name__, resolved)
        )
    if not hasattr(resolved, "__contains__"):
        raise RecordError(
            "the-steward: `resolved` must answer membership without being "
            "consumed, observed the %s %r. An object with no `__contains__` "
            "either cannot answer at all or answers by iterating — and an "
            "iterator answers the first record, then answers no to every "
            "record after it (ADR-30, ADR-32)."
            % (type(resolved).__name__, resolved)
        )


def _require_resolution_answer(resolved):
    """One record's answer is a `bool`, and truthiness is not that.

    The same defect as `_require_resolution_set`, one call in. Read for
    truthiness, any truthy object — the set that should have been searched, a
    command's output, a `CompletedProcess` — stands in for *the claim
    resolved*, and a confirmed record's drift disappears into an exit 0. The
    falsy half is no better: `0`, `""` and an empty container all read as *did
    not resolve*, manufacturing a drift finding out of an answer nobody gave.
    Nothing downstream ever looks again, so this is the only place it can be
    caught.
    """
    if not isinstance(resolved, bool):
        raise RecordError(
            "the-steward: a record's resolution answer is a bool, observed the "
            "%s %r. Reading it for truthiness would let any truthy object "
            "stand in for *the claim resolved*, and a confirmed record's drift "
            "would vanish into an exit 0 (ADR-11, ADR-13)."
            % (type(resolved).__name__, resolved)
        )


def severity_of(state):
    """ADR-13's severity row for one derived state, or `None` for no finding.

    A state with no row is a bug and fails here, rather than falling through to
    whichever severity happened to be the default (ADR-13:359).
    """
    if state not in SEVERITY:
        raise RecordError(
            "the-steward: no ADR-13 severity row for the derived state %r; the "
            "map is exhaustive over %s" % (state, list(DERIVED_STATES))
        )
    return SEVERITY[state]


def tier_of(state):
    """ADR-28's evidence tier for one derived state, or `None` for no finding."""
    if state not in TIER:
        raise RecordError(
            "the-steward: no ADR-28 tier for the derived state %r; the map is "
            "exhaustive over %s" % (state, list(DERIVED_STATES))
        )
    return TIER[state]


def derived_state(record, resolved):
    """How one stored record reads right now. Never written (ADR-11).

    `resolved` is the repository's answer to this record's own claim, and it is
    a `bool` — this is where that is required, because this is the one place
    the answer is read. `finding_for` and `record_findings` both come through
    here, and `record_findings` can only ever hand over a real `bool`, since
    `in` returns one.

    The order below is the decision:

    * an `external` record is never resolved and never coverage (ADR-18), so
      the answer is not consulted for it at all — passing `True` cannot turn a
      human's declaration into a checked claim;
    * a claim that resolved is in sync, waiver or no waiver: a waiver excuses a
      finding, and where there is none there is nothing to excuse;
    * a waived claim that did not resolve is reported at `info` — including a
      waiver whose target is gone, which is itself worth reporting (ADR-11);
    * and otherwise the stored state sets the reading: `confirmed` drifted,
      `proposed` merely unresolved. That one difference is the whole severity
      story (ADR-13).
    """
    _require_resolution_answer(resolved)
    state = _state_of(record)
    reason = _waiver_reason(record)
    if record.get("resolution") == EXTERNAL:
        return EXTERNAL
    if resolved:
        return IN_SYNC
    if reason is not None:
        return WAIVED
    return DRIFTED if state == CONFIRMED else UNRESOLVED


def _finding(record, kind, index, state):
    severity = severity_of(state)
    if severity is None:
        return None
    observed = _OBSERVED[state]
    if state == WAIVED:
        observed = observed % (_waiver_reason(record),)
    return findings.finding(
        id="%s-%s" % (_NOUN[kind], state),
        severity=severity,
        tier=tier_of(state),
        claim=_CLAIM[kind] % (record.get("value"),),
        observed=observed,
        # A pointer into the manifest, never a filesystem path: the record is
        # what the finding is about, and an absolute path in a report would
        # break ADR-8's purity besides.
        where="%s[%d]" % (kind, index),
    )


def finding_for(record, kind, index, resolved):
    """The finding one record produces, or `None` where it is in sync."""
    _require_kind(kind)
    return _finding(record, kind, index, derived_state(record, resolved))


def record_findings(claims, kind, resolved, reason=None):
    """`(found, cardinality)` over one ADR-32 record set.

    `resolved` is a container of the record values the repository resolved, so
    membership is the whole question this module asks of it — and the only
    question this module asks of the repository at all, which is why
    `_require_resolution_set` refuses a shape that would answer it wrongly
    rather than not at all.

    **The claims are read and never edited** — no record is rewritten, promoted
    or removed, which is P3.6: a confirmed record whose target vanished stays
    exactly where the human put it and is reported as drift.

    ADR-32: the cardinality is the record count, so a claim exists because a
    record exists. ADR-18: an `external` record is counted on its own line and
    never as coverage. ADR-30: a zero cardinality states its reason — this
    supplies the one it knows (every record was external) and takes the other
    from the caller, who is the only one who can tell an absent manifest from
    an empty declaration.

    **The condition observed here outranks the reason the caller supplied, and
    reading it the other way round was a defect.** A caller chooses its reason
    at the call site, *before* it knows what the set contained — the end-to-end
    helper passes `NO_CLAIM_SOURCE` on every call, and the decision document
    makes passing one a caller obligation — so treating it as a default that
    only applies when the caller gave none makes it win exactly where it is
    false. An all-external set rendered *0 items examined (+1 declared external,
    not checked) — no claim source — nothing to verify*, over records that are
    themselves the claim source (ADR-32). ADR-30's rule is that a zero
    cardinality states **its** reason; a sentence contradicting the line it
    annotates is the vacuous pass in better manners. So: every record external
    is the reason whenever there were records, and the caller's reason is for
    the case only the caller can name — **no records at all**.
    """
    _require_kind(kind)
    _require_resolution_set(resolved)
    found = []
    examined = 0
    declared_external = 0
    for index, record in enumerate(claims):
        value = record.get("value") if isinstance(record, dict) else None
        state = derived_state(record, value in resolved)
        if state == EXTERNAL:
            declared_external += 1
        else:
            examined += 1
        item = _finding(record, kind, index, state)
        if item is not None:
            found.append(item)
    if examined:
        reason = None
    elif declared_external:
        reason = ALL_EXTERNAL
    return found, findings.cardinality(
        kind, examined, reason=reason, declared_external=declared_external
    )


def pending_findings(document):
    """`(found, cardinality)` for `scan.pending[]` — one `info` per item.

    **This reads no field of an item, deliberately.** The element shape of
    `scan.pending[]` is undefined everywhere in the frozen spec:
    `manifest.v1.json` declares a bare array and `manifest._validate_scan`
    asserts only that it is a list. Printing a field would be inventing the
    schema; reporting that a delta is recorded, and where, is everything that
    is true today.

    Tier *inspected*, because that is the honest one: nothing was followed to
    an object (*resolved*), nothing was rendered, and calling it *inferred*
    would require a confidence this module has no way to know (ADR-28).

    ADR-11: a re-scan may not mutate a matching confirmed record, so a delta is
    reported and never applied — `generate` is the only writer, and the item is
    here because a `generate` put it here.
    """
    document = {} if document is None else document
    if not isinstance(document, dict):
        raise RecordError(
            "the-steward: a manifest document is an object or None, observed %r"
            % (document,)
        )
    scan = document.get("scan", {})
    if not isinstance(scan, dict):
        raise RecordError(
            "the-steward: `scan` is an object, observed %r. Reporting zero "
            "pending deltas over a shape we could not read would be a vacuous "
            "pass (ADR-30)." % (scan,)
        )
    pending = scan.get("pending", [])
    if not isinstance(pending, list):
        raise RecordError(
            "the-steward: `scan.pending` is an array, observed %r" % (pending,)
        )
    found = []
    for index in range(len(pending)):
        found.append(
            findings.finding(
                id="scan-pending",
                severity="info",
                tier="inspected",
                claim="a re-scan delta is recorded here for a human to act on",
                observed=(
                    "it is reported and never applied: a re-scan may not "
                    "mutate a matching confirmed record (ADR-11)"
                ),
                where="scan.pending[%d]" % index,
            )
        )
    return found, findings.cardinality(
        PENDING_CHECK, len(pending), reason=None if pending else NO_PENDING
    )
