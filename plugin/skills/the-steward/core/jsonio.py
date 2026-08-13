"""Canonical JSON, and the temporal rule (ADR-2).

Canonical: 2-space indent, sorted keys, LF endings, exactly one trailing
newline, UTF-8, non-ASCII written as itself. Canonical serialization is what
makes render-and-diff possible, so it is a contract, not a style.
"""

import json

# ADR-2: **observation** timestamps are banned everywhere — anything recording
# when a tool ran. They change on every run, which destroys render-and-diff and
# produces pure-churn commits. A *version identity* is not a timestamp, and a
# date a human wrote into a document is not one either; only these three keys,
# which are the ones a generator reaches for, are refused.
BANNED_TIME_KEYS = ("generatedAt", "lastCheckedAt", "scannedAt")


class JsonError(Exception):
    """A document that is not readable as canonical JSON (exit 2)."""


def dumps(obj):
    """Serialize canonically. The trailing newline is part of the contract."""
    return (
        json.dumps(
            obj,
            indent=2,
            sort_keys=True,
            ensure_ascii=False,
            separators=(",", ": "),
        )
        + "\n"
    )


def dumps_bytes(obj):
    return dumps(obj).encode("utf-8")


def loads(payload):
    """Parse a JSON **object**, or raise JsonError with the parser's detail."""
    if isinstance(payload, bytes):
        try:
            payload = payload.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise JsonError("not valid UTF-8: %s" % exc)
    try:
        value = json.loads(payload)
    except ValueError as exc:
        raise JsonError("not valid JSON: %s" % exc)
    if not isinstance(value, dict):
        raise JsonError(
            "expected a JSON object at the top level, observed %s"
            % type(value).__name__
        )
    return value


def observation_timestamps(document, where=""):
    """Every banned observation-timestamp key, as (path, key) pairs."""
    found = []
    if isinstance(document, dict):
        for key in sorted(document):
            child = "%s.%s" % (where, key) if where else key
            if key in BANNED_TIME_KEYS:
                found.append((child, key))
            found.extend(observation_timestamps(document[key], child))
    elif isinstance(document, list):
        for index, item in enumerate(document):
            found.extend(observation_timestamps(item, "%s[%d]" % (where, index)))
    return found
