const secretKey =
  /(?:authorization|cookie|password|secret|session|sid|jwt|token|consumer.?key|api.?key|private.?key)/iu;
const inlineSecret =
  /((?:authorization|cookie|password|secret|session|sid|jwt|token|consumer.?key|api.?key|private.?key)\s*["']?\s*[:=]\s*["']?)([^\s,"';&}]+)/giu;
const authorization = /\b(Bearer|Basic)\s+[A-Za-z\d._~+/=-]+/giu;
const jwt = /\b[A-Za-z\d_-]{10,}\.[A-Za-z\d_-]{10,}\.[A-Za-z\d_-]{10,}\b/gu;
const salesforceSession = /(?<![A-Za-z\d])00D[A-Za-z\d]{12,15}(?:!|%21)[A-Za-z\d._~+%/=-]{8,}(?![A-Za-z\d._~+%/=-])/gu;

export const redactSecretString = (value: string): string =>
  value
    .replace(authorization, '$1 [REDACTED]')
    .replace(inlineSecret, '$1[REDACTED]')
    .replace(jwt, '[REDACTED]')
    .replace(salesforceSession, '[REDACTED]');

export const redactSecrets = (value: unknown): unknown => {
  if (typeof value === 'string') return redactSecretString(value);
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      key,
      secretKey.test(key) ? '[REDACTED]' : redactSecrets(entry),
    ])
  );
};
