"""`.steward.json` — the contract manifest, its schema and its validator (ADR-2).

Tracked, canonical JSON, at the **repository root**. It is the control plane,
not an artifact: never digested, never compared, never listed among its own
recorded paths. Its integrity check is schema validation, and a manifest that
fails it is **exit 2** with expected-vs-observed detail — never a pass over a
manifest we could not read, which is ADR-30's vacuous pass in another hat.

The validator here is the enforcement. `manifest.v1.json` ships beside it as
the readable contract that `$schema` points at, and
`test_the_schema_properties_match_the_validator_exactly` is the drift guard
between them. Vendoring a JSON-Schema evaluator to close the gap completely
would be a dependency in all but name (ADR-1), so the gap is guarded rather
than eliminated, and this sentence is the honest statement of it.

**Unknown keys are rejected**, at the top level and inside every record. That
is the opposite of ADR-31's frontmatter rule, deliberately: a repo owns its own
frontmatter conventions, but `.steward.json` is our contract, and a typo in it
must be loud rather than silently ignored.
"""

import os
import re

import jsonio
import paths
import text

MANIFEST_NAME = ".steward.json"
SCHEMA_REFERENCE = "tools/steward/manifest.v1.json"

STATES = ("proposed", "confirmed")
CONFIDENCES = ("high", "low")
RESOLUTIONS = ("repo-declared", "external")
RECORDED_KINDS = ("rendered", "copied")

# ADR-30: the three declared scopes v0 has. A record clears the vacuity error
# for its key only.
SCOPE_KEYS = ("commands", "docsScope", "paths")

TOP_LEVEL_KEYS = (
    "$schema",
    "commands",
    "docsScope",
    "frontmatterSchema",
    "intentionallyEmpty",
    "paths",
    "recorded",
    "scan",
)

# Every key set the validator enforces, hoisted out of the functions that use
# them so `test_the_schema_matches_the_validator_exactly` can compare all of
# them against `manifest.v1.json`. Record level is where drift is likeliest,
# and a guard that covered only the top level would not have seen it.
_CLAIM_RECORD_KEYS = ("value", "state", "confidence", "waived")
_COMMAND_RECORD_KEYS = _CLAIM_RECORD_KEYS + ("resolution",)
_DOCS_SCOPE_KEYS = ("state", "confidence", "include", "waived")
_FRONTMATTER_KEYS = ("requiredKeys", "requireNonEmpty")
_INTENTIONALLY_EMPTY_KEYS = ("scope", "state", "confidence", "waived")
_RECORDED_KEYS = ("path", "kind", "sha256")
_WAIVED_KEYS = ("reason",)
_DIGEST = re.compile(r"^[0-9a-f]{64}$")


class ManifestError(Exception):
    """The manifest does not validate. Always exit 2 (ADR-2, ADR-13)."""


def _fail(where, expected, observed):
    raise ManifestError(
        "the-steward: %s does not validate at %s: expected %s, observed %r"
        % (MANIFEST_NAME, where, expected, observed)
    )


def _require_object(value, where):
    if not isinstance(value, dict):
        _fail(where, "an object", value)


def _require_list(value, where):
    if not isinstance(value, list):
        _fail(where, "an array", value)


def _require_only(mapping, allowed, where):
    for key in sorted(mapping):
        if key not in allowed:
            _fail(
                "%s.%s" % (where, key),
                "one of %s" % list(allowed),
                key,
            )


def _validate_state(record, where):
    state = record.get("state")
    if state not in STATES:
        _fail("%s.state" % where, "one of %s" % list(STATES), state)
    return state


def _validate_confidence(record, where):
    """DEBT ITEM 10: optional on a record, ∈ high|low when present.

    ADR-28 and ADR-2 define confidence as per-inference — a scan-produced
    record carries it, a hand-written record need not. P1.5's "each record
    carrying `state` and `confidence`" reads it as mandatory; the ADR wins.
    """
    if "confidence" not in record:
        return
    level = record["confidence"]
    if level not in CONFIDENCES:
        _fail("%s.confidence" % where, "one of %s" % list(CONFIDENCES), level)


def _validate_waiver(record, where):
    if "waived" not in record:
        return
    waived = record["waived"]
    _require_object(waived, "%s.waived" % where)
    _require_only(waived, _WAIVED_KEYS, "%s.waived" % where)
    reason = waived.get("reason")
    if not isinstance(reason, str) or not text.ascii_strip(reason):
        _fail("%s.waived.reason" % where, "a non-empty string", reason)


def _validate_record_value(value, where):
    """ADR-32: renderable, one item per line, already stripped."""
    if not isinstance(value, str):
        _fail("%s.value" % where, "a string", value)
    control = text.first_control_character(value)
    if control is not None:
        point, index = control
        raise ManifestError(
            "the-steward: %s does not validate at %s.value: the value contains "
            "ASCII control character U+%04X at index %d, which cannot be "
            "rendered as one item on one line (ADR-32). Observed %r."
            % (MANIFEST_NAME, where, point, index, value)
        )
    if not value:
        _fail("%s.value" % where, "a non-empty string", value)
    if text.ascii_strip(value) != value:
        _fail(
            "%s.value" % where,
            "a value equal to its own ASCII-stripped form",
            value,
        )


def _validate_claim_record(record, where, kind):
    _require_object(record, where)
    allowed = _COMMAND_RECORD_KEYS if kind == "commands" else _CLAIM_RECORD_KEYS
    _require_only(record, allowed, where)
    if "value" not in record:
        _fail("%s.value" % where, "a string", None)
    _validate_record_value(record["value"], where)
    state = _validate_state(record, where)
    _validate_confidence(record, where)
    _validate_waiver(record, where)

    if kind == "commands":
        resolution = record.get("resolution")
        if resolution not in RESOLUTIONS:
            _fail("%s.resolution" % where, "one of %s" % list(RESOLUTIONS), resolution)
        if resolution == "external" and state != "confirmed":
            raise ManifestError(
                "the-steward: %s does not validate at %s: resolution "
                "'external' is a human's declaration and is valid only on a "
                "'confirmed' record; observed state %r. A scanner cannot tell "
                "a legitimate external tool from a command that does not "
                "exist (ADR-18)." % (MANIFEST_NAME, where, state)
            )


def _validate_docs_scope(scope):
    where = "docsScope"
    _require_object(scope, where)
    _require_only(scope, _DOCS_SCOPE_KEYS, where)
    _validate_state(scope, where)
    _validate_confidence(scope, where)
    _validate_waiver(scope, where)
    include = scope.get("include", [])
    _require_list(include, "docsScope.include")
    for index, item in enumerate(include):
        _validate_record_value(item, "docsScope.include[%d]" % index)


def _validate_frontmatter_schema(schema):
    where = "frontmatterSchema"
    _require_object(schema, where)
    _require_only(schema, _FRONTMATTER_KEYS, where)
    keys = schema.get("requiredKeys")
    _require_list(keys, "%s.requiredKeys" % where)
    for index, key in enumerate(keys):
        if not isinstance(key, str) or not key:
            _fail(
                "%s.requiredKeys[%d]" % (where, index), "a non-empty string", key
            )
    if "requireNonEmpty" in schema and not isinstance(
        schema["requireNonEmpty"], bool
    ):
        _fail("%s.requireNonEmpty" % where, "a boolean", schema["requireNonEmpty"])


def _validate_intentionally_empty(records):
    _require_list(records, "intentionallyEmpty")
    seen = []
    for index, record in enumerate(records):
        where = "intentionallyEmpty[%d]" % index
        _require_object(record, where)
        _require_only(record, _INTENTIONALLY_EMPTY_KEYS, where)
        scope = record.get("scope")
        if scope not in SCOPE_KEYS:
            _fail("%s.scope" % where, "one of %s" % list(SCOPE_KEYS), scope)
        if scope in seen:
            _fail(where, "at most one record per scope key", scope)
        seen.append(scope)
        _validate_state(record, where)
        _validate_confidence(record, where)
        _validate_waiver(record, where)


def _validate_recorded(records):
    _require_list(records, "recorded")
    seen = []
    for index, record in enumerate(records):
        where = "recorded[%d]" % index
        _require_object(record, where)
        _require_only(record, _RECORDED_KEYS, where)
        path = record.get("path")
        _validate_record_value(path, where)
        if os.path.isabs(path) or os.pardir in path.replace(os.sep, "/").split("/"):
            _fail("%s.path" % where, "a plain repository-relative path", path)
        if path == MANIFEST_NAME:
            raise ManifestError(
                "the-steward: %s does not validate at %s.path: the manifest is "
                "the control plane, not an artifact — it is never listed among "
                "its own recorded paths (ADR-2)." % (MANIFEST_NAME, where)
            )
        if path in seen:
            _fail("%s.path" % where, "at most one record per path", path)
        seen.append(path)
        kind = record.get("kind")
        if kind not in RECORDED_KINDS:
            _fail("%s.kind" % where, "one of %s" % list(RECORDED_KINDS), kind)
        digest = record.get("sha256")
        if not isinstance(digest, str) or not _DIGEST.match(digest):
            _fail("%s.sha256" % where, "64 lowercase hex characters", digest)


def _validate_scan(scan):
    _require_object(scan, "scan")
    _require_only(scan, ("pending",), "scan")
    _require_list(scan.get("pending", []), "scan.pending")


def validate(document):
    """Raise ManifestError unless `document` is a valid manifest."""
    _require_object(document, "the document")
    _require_only(document, TOP_LEVEL_KEYS, "")

    banned = jsonio.observation_timestamps(document)
    if banned:
        raise ManifestError(
            "the-steward: %s does not validate: observation timestamps are "
            "banned everywhere — they change on every run and destroy "
            "render-and-diff (ADR-2). Observed %s."
            % (MANIFEST_NAME, ", ".join(where for where, _ in banned))
        )

    if "$schema" in document and not isinstance(document["$schema"], str):
        _fail("$schema", "a string", document["$schema"])

    for kind in ("commands", "paths"):
        records = document.get(kind, [])
        _require_list(records, kind)
        for index, record in enumerate(records):
            _validate_claim_record(record, "%s[%d]" % (kind, index), kind)

    if "docsScope" in document:
        _validate_docs_scope(document["docsScope"])
    if "frontmatterSchema" in document:
        _validate_frontmatter_schema(document["frontmatterSchema"])
    if "intentionallyEmpty" in document:
        _validate_intentionally_empty(document["intentionallyEmpty"])
    if "recorded" in document:
        _validate_recorded(document["recorded"])
    if "scan" in document:
        _validate_scan(document["scan"])


def intentionally_empty_for(document, scope):
    """The `intentionallyEmpty` record for one scope key, or None (ADR-30)."""
    for record in document.get("intentionallyEmpty", []):
        if record.get("scope") == scope:
            return record
    return None


def path(root):
    return os.path.join(root, MANIFEST_NAME)


def is_tracked(root):
    """Is `.steward.json` in git's **index**? (ADR-2's trackedness predicate.)

    One question answers all four states P1.5 names, because `git ls-files`
    reports the index and nothing else: **untracked** and **`git rm --cached`**
    are both absent from it, **staged** and **committed** are both present.
    Asking `git log` or the working tree instead would answer a different
    question and miss `git rm --cached` entirely.

    Trackedness is a finding, not an assumption: `generate` cannot stage its
    own output, so a fresh manifest is untracked, and one `git clean -xdf`
    then deletes the control plane. `doctor` reports it (`warn`, tier
    *inspected*, exit 0 — ADR-13).

    **`ls-files` has no non-zero answer, so a non-zero status is a fault and
    never `False`.** It exits 0 whether or not the pathspec matches; every
    non-zero status means it could not do the work — a corrupt `.git/index`
    exits 128 while `rev-parse` still exits 0, so the run reaches here with a
    resolved root and a loaded manifest. `if code != 0: return False` turned
    that into the confident finding *the manifest is not in the index*, warned
    about a state nobody had established, and exited 0. A failed probe is not
    an answer (ADR-13, exit 2).
    """
    out = paths.git_checked(root, ["ls-files", "-z", "--", MANIFEST_NAME])
    listed = out.decode("utf-8", "surrogateescape").split("\0")
    return MANIFEST_NAME in listed


def load(root):
    """Read and validate the manifest, or return None when there is none.

    A repository with no manifest is **unmanaged, not failing** (ADR-32).
    """
    location = path(root)
    if not os.path.isfile(location):
        return None
    with open(location, "rb") as handle:
        raw = handle.read()
    try:
        document = jsonio.loads(raw)
    except jsonio.JsonError as exc:
        raise ManifestError(
            "the-steward: %s is present but could not be read as canonical "
            "JSON: %s. Refusing to run rather than silently resetting it."
            % (MANIFEST_NAME, exc)
        )
    validate(document)
    return document
