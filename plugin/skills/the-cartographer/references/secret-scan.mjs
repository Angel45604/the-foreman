// the-cartographer — the fail-closed secret scan (ADR C-008, PDR §11).
//
// COPIED from the-foreman's proven pattern, deliberately NOT imported (ADR C-008): ~20 lines of
// regexes are cheaper than a cross-skill import that makes the two skills co-release. This copy adds
// the categories the plan named that the original did not carry — AWS session keys (`ASIA`), OpenAI's
// modern `sk-proj-` / `sk-svcacct-` prefixes, and Google API keys.
//
// ─── the asymmetry this file is tuned around ─────────────────────────────────────────────────────
//
// `render.mjs` scans every artifact BEFORE it writes any of them. A FALSE NEGATIVE therefore ships a
// credential into a committed snapshot; a FALSE POSITIVE costs one regeneration and a reworded note.
// The two are not comparable, so every pattern here is deliberately loose at the tail (`{20,}` rather
// than an exact length) — a rotated key format that grew two characters must not walk straight past.
//
// The one rule that surprises people is the LAST one, and it is a rule rather than an accident: any
// email-shaped string is refused, so code ownership must render as a HANDLE, never an address.
//
// Zero dependencies: node built-ins only.

/**
 * Category → pattern. Ordered for readability only; every pattern is tested against the whole text.
 *
 * NONE of these carries the `g` flag, and that is load-bearing: a `/g` regex keeps `lastIndex`
 * between calls, so `re.test(x)` on a shared module-level regex alternates true/false on identical
 * input — a scanner that lets a token through on every second call is worse than no scanner.
 */
const PATTERNS = [
  // AKIA is a long-lived key; ASIA is a temporary session key, and a leaked session key is still a
  // leaked credential for as long as it lives.
  ['aws_access_key_id', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['anthropic_key', /\bsk-ant-[A-Za-z0-9_-]{20,}/],
  // `sk-` alone would already catch the modern forms, but naming `proj` / `svcacct` / `admin`
  // explicitly is what makes the coverage auditable against the key formats it claims to cover.
  ['openai_key', /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}/],
  ['github_token', /\bgh[pousr]_[A-Za-z0-9]{30,}/],
  ['github_fine_grained_pat', /\bgithub_pat_[A-Za-z0-9_]{20,}/],
  ['slack_token', /\bxox[baprse]-[A-Za-z0-9-]{10,}/],
  ['google_api_key', /\bAIza[0-9A-Za-z_-]{30,}/],
  // Any armoured private key: RSA, DSA, EC, OPENSSH, PGP, or the bare PKCS#8 header.
  ['private_key_block', /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/],
  ['bearer_or_jwt', /\b(?:Bearer\s+)?eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/],
  // A connection string carrying `user:password@`. A URL with no credentials does not match.
  ['db_url_with_creds', /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:[^\s:@/]+@/i],
  ['generic_secret_assign', /\b(?:password|passwd|secret|api[_-]?key|token|client[_-]?secret)\b\s*[:=]\s*["']?[^\s"']{8,}/i],
  // ADR C-008: ANY email-shaped string. This is the rule that forces ownership to render as a handle.
  ['email_pii', /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/],
];

/** The categories a hit can name — exported so a caller can assert coverage rather than guess it. */
export const PATTERN_NAMES = Object.freeze(PATTERNS.map(([name]) => name));

/**
 * scan(text) -> { clean, hits } — pure, stateless, and never throws.
 *
 * Reports EVERY distinct category that matched, not just the first: a caller told only about the AWS
 * key rewrites one line, regenerates, and is told about the JWT — one round trip per secret. Each
 * category appears at most ONCE however many times it matched.
 *
 * A hit names the CATEGORY and nothing else. Deliberately: putting the matched text in the return
 * value would carry the credential into whatever the caller does with it — an exception message, a
 * log line, a CI transcript — which is the leak this module exists to prevent, one indirection over.
 */
export function scan(text) {
  const subject = String(text ?? '');
  const hits = [];
  for (const [category, pattern] of PATTERNS) {
    if (pattern.test(subject)) hits.push({ category });
  }
  return { clean: hits.length === 0, hits };
}
