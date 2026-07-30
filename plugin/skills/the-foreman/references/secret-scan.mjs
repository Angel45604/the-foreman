const PATTERNS = [
  ['aws_access_key_id', /\bAKIA[0-9A-Z]{16}\b/],
  ['anthropic_key', /\bsk-ant-[a-zA-Z0-9-]{20,}\b/],
  ['openai_key', /\bsk-[A-Za-z0-9_-]{20,}\b/],
  ['github_token', /\bgh[pousr]_[A-Za-z0-9]{30,}\b/],
  ['github_fine_grained_pat', /\bgithub_pat_[A-Za-z0-9_]{20,}\b/],
  ['slack_token', /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/],
  ['private_key_block', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['bearer_or_jwt', /\b(?:Bearer\s+)?eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/],
  ['db_url_with_creds', /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:[^\s:@/]+@/i],
  ['generic_secret_assign', /\b(?:password|passwd|secret|api[_-]?key|token|client[_-]?secret)\b\s*[:=]\s*["']?[^\s"']{8,}/i],
  ['email_pii', /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/],
];
export function scan(text) {
  const s = String(text ?? ''); const hits = [];
  for (const [category, re] of PATTERNS) if (re.test(s)) hits.push({ category });
  return { clean: hits.length === 0, hits };
}
