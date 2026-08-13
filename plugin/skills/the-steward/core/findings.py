"""The findings model and the report renderer (ADR-28, ADR-13, ADR-30).

A finding is a plain dict so it round-trips through canonical JSON unchanged:

    {id, severity, tier, claim, observed, where[, confidence]}

**The one rule the tier carries (ADR-28):** `confidence` is required exactly
when `tier` is `inferred`, and forbidden on every other tier. *inferred* is the
tier of every `scan` conclusion; a check that resolved a real object has a
tier, not a guess.
"""

import text

SEVERITIES = ("error", "warn", "info")
TIERS = ("resolved", "rendered", "inspected", "inferred")
CONFIDENCES = ("high", "low")

_REQUIRED_TEXT_FIELDS = ("id", "claim", "observed", "where")


class FindingError(Exception):
    """A finding that violates the model. Always a programming error here."""


def finding(
    id=None,
    severity=None,
    tier=None,
    claim=None,
    observed=None,
    where=None,
    confidence=None,
):
    """Build a validated finding. Every field but `confidence` is required —
    omitting one raises FindingError naming it, not a bare TypeError."""
    if severity not in SEVERITIES:
        raise FindingError(
            "severity must be one of %s, observed %r" % (list(SEVERITIES), severity)
        )
    if tier not in TIERS:
        raise FindingError("tier must be one of %s, observed %r" % (list(TIERS), tier))

    record = {
        "id": id,
        "severity": severity,
        "tier": tier,
        "claim": claim,
        "observed": observed,
        "where": where,
    }
    for field in _REQUIRED_TEXT_FIELDS:
        value = record[field]
        if not isinstance(value, str) or not text.ascii_strip(value):
            raise FindingError("%s must be a non-empty string, observed %r" % (field, value))

    if tier == "inferred":
        if confidence is None:
            raise FindingError(
                "an `inferred` finding must carry a confidence (%s); %r has none"
                % ("|".join(CONFIDENCES), id)
            )
        if confidence not in CONFIDENCES:
            raise FindingError(
                "confidence must be one of %s, observed %r"
                % (list(CONFIDENCES), confidence)
            )
        if severity == "error":
            raise FindingError(
                "an `inferred` finding is never an error on its own (ADR-28); "
                "it becomes a record, and the record's state sets the severity: %r" % id
            )
        record["confidence"] = confidence
    elif confidence is not None:
        raise FindingError(
            "confidence is forbidden on tier %r — it belongs to inferences only "
            "(ADR-28): %r" % (tier, id)
        )
    return record


def exit_code(found):
    """ADR-13: exit 1 iff any `error` finding is present. Never a fourth code."""
    for item in found:
        if item.get("severity") == "error":
            return 1
    return 0


def cardinality(check, examined, reason=None, declared_external=0):
    """How many items a check examined — printed always (ADR-30).

    A zero cardinality **must** state its reason, so "0 checked, 0 problems
    found" can never render as coverage.
    """
    if examined == 0 and not reason:
        raise FindingError(
            "check %r examined 0 items and gave no reason; a vacuous pass must "
            "never render as coverage (ADR-30)" % check
        )
    return {
        "check": check,
        "examined": examined,
        "reason": reason,
        "declaredExternal": declared_external,
    }


def render_report(verb, found, cardinalities, extra_lines=()):
    """Deterministic report. Prints tier always, confidence where there is one,
    and the cardinality of every check."""
    lines = ["the-steward %s" % verb, ""]

    lines.append("Examined:")
    for item in cardinalities:
        line = "  %s: %d items examined" % (item["check"], item["examined"])
        if item.get("declaredExternal"):
            line += " (+%d declared external, not checked)" % item["declaredExternal"]
        if item.get("reason"):
            line += " — %s" % item["reason"]
        lines.append(line)
    lines.append("")

    if found:
        lines.append("Findings:")
        for item in found:
            head = "  %-5s [%s] %s" % (item["severity"], item["tier"], item["id"])
            if "confidence" in item:
                head += " (confidence %s)" % item["confidence"]
            lines.append(head)
            lines.append("        claim:    %s" % item["claim"])
            lines.append("        observed: %s" % item["observed"])
            lines.append("        where:    %s" % item["where"])
        lines.append("")

    counts = {name: 0 for name in SEVERITIES}
    for item in found:
        counts[item["severity"]] += 1
    lines.append(
        "%d error, %d warn, %d info"
        % (counts["error"], counts["warn"], counts["info"])
    )
    for line in extra_lines:
        lines.append(line)
    return "\n".join(lines) + "\n"
