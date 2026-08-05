import { createHash } from 'node:crypto';

const SECRET_KEY =
  /^(?:authorization|bearer|client.?secret|consumer.?key|cookie|set.?cookie|password|private.?key|refresh.?token|secret|subject.?token|access.?token|api.?key|jwt|.*token.*)$/iu;
const SECRET_FLAG =
  /^--(?:access-token|api-key|authorization|client-secret|consumer-key|cookie|header|password|private-key|refresh-token|secret|session|sid|token)$/iu;
const SECRET_HEADER =
  /\b((?:authorization|cookie|set-cookie|x-[a-z\d-]*token|x-[a-z\d-]*session|x-[a-z\d-]*sid)\s*:\s*)(?!<redacted>)[^\r\n]+/giu;
const QUOTED_SECRET_ASSIGNMENT =
  /(["']?(?:authorization|client_?secret|consumer_?key|cookie|password|private_?key|refresh_?token|secret|token|api_?key|jwt)["']?\s*[:=]\s*)(["'])(?!<redacted)(?:(?!\2)[^\\\r\n]|\\.)*\2/giu;
const UNQUOTED_SECRET_ASSIGNMENT =
  /(["']?(?:authorization|client_?secret|consumer_?key|cookie|password|private_?key|refresh_?token|secret|token|api_?key|jwt)["']?\s*[:=])(?!\s*(?:["']|<redacted))(\s*)([^&,\r\n}\]]+)/giu;
const SECRET_QUERY = /([?&](?:sid|session|token)=)(?!<redacted)[^&\s]+/giu;
const SUPPORT_IDENTIFIER_KEY =
  /^(?:x-(?:client-)?(?:correlation|request|trace)-id|(?:correlation|request|trace)(?:_|-)?id)$/iu;
const INLINE_SUPPORT_IDENTIFIER =
  /\b((?:correlation|request|trace)(?:[-_ ]?id)?\s*[:=]\s*)(?!<support:|<redacted)([a-f\d-]{8,})\b/giu;
const SUPPORT_IDENTIFIER_ASSIGNMENT =
  /(["']?(?:x-(?:client-)?(?:correlation|request|trace)-id|(?:correlation|request|trace)(?:_|-)?id)["']?\s*[:=]\s*)(["']?)(?!<support:|<redacted)([a-z\d._:-]{6,})/giu;
const PRIVATE_KEY_BLOCK =
  /-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/gu;
const SALESFORCE_ID_CANDIDATE = /(?<![A-Za-z\d])(?:[A-Za-z\d]{15}|[A-Za-z\d]{18})(?![A-Za-z\d])/gu;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/giu;
const PATTERNS = [
  { label: 'Salesforce access token', pattern: /\b00D[A-Za-z\d]{12,15}![A-Za-z\d._-]{8,}\b/gu },
  { label: 'bearer token', pattern: /\bBearer\s+[A-Za-z\d._~+/=-]+/giu },
  { label: 'JWT', pattern: /\beyJ[A-Za-z\d_-]+\.[A-Za-z\d_-]+\.[A-Za-z\d_-]+\b/gu },
  {
    label: 'private key',
    pattern:
      /-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----|-----END (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/gu,
  },
  { label: 'Salesforce org ID', pattern: /\b00D[A-Za-z\d]{12,15}\b/gu },
  { label: 'email or org username', pattern: /\b[A-Z\d._%+-]+@[A-Z\d.-]+\.[A-Z]{2,}\b/giu },
  {
    label: 'Salesforce tenant hostname',
    pattern: /\b(?:[a-z\d-]+\.)+(?:salesforce\.com|cloudforce\.com|force\.com)\b/giu,
  },
  {
    label: 'sensitive header',
    pattern:
      /\b(?:authorization|cookie|set-cookie|x-[a-z\d-]*token|x-[a-z\d-]*session|x-[a-z\d-]*sid)\s*:\s*(?!<redacted)[^\r\n]{6,}/giu,
  },
  { label: 'session id query', pattern: /[?&](?:sid|session|token)=(?!<redacted)[^&\s]{6,}/giu },
];

export const digest = (value) => createHash('sha256').update(value).digest('hex');

export const fingerprint = (value) => digest(String(value)).slice(0, 12);

const isSalesforce18 = (value) => {
  if (!/^[A-Za-z\d]{18}$/u.test(value)) return false;
  const suffix = [...Array(3).keys()]
    .map((chunk) => {
      let flags = 0;
      for (let index = 0; index < 5; index += 1) {
        const character = value[chunk * 5 + index];
        if (character >= 'A' && character <= 'Z') flags += 1 << index;
      }
      return 'ABCDEFGHIJKLMNOPQRSTUVWXYZ012345'[flags];
    })
    .join('');
  return value.slice(15) === suffix;
};

const isSalesforce15 = (value) =>
  /^[A-Za-z\d]{15}$/u.test(value) && /[a-z]/u.test(value) && /[A-Z]/u.test(value) && /\d/u.test(value);

const isSalesforceId = (value) => isSalesforce15(value) || isSalesforce18(value);

export const redactString = (value) =>
  String(value)
    .replace(PRIVATE_KEY_BLOCK, '<redacted:private-key>')
    .replace(PATTERNS[0].pattern, '<redacted:access-token>')
    .replace(PATTERNS[1].pattern, 'Bearer <redacted:token>')
    .replace(PATTERNS[2].pattern, '<redacted:jwt>')
    .replace(PATTERNS[3].pattern, '<redacted:private-key>')
    .replace(PATTERNS[5].pattern, (match) => `org:${fingerprint(match.toLowerCase())}`)
    .replace(PATTERNS[4].pattern, (match) => `org:${fingerprint(match)}`)
    .replace(PATTERNS[6].pattern, '<tenant>')
    .replace(INLINE_SUPPORT_IDENTIFIER, (_, prefix, identifier) => `${prefix}<support:${fingerprint(identifier)}>`)
    .replace(
      SUPPORT_IDENTIFIER_ASSIGNMENT,
      (_, prefix, quote, identifier) => `${prefix}${quote}<support:${fingerprint(identifier)}>`
    )
    .replace(SALESFORCE_ID_CANDIDATE, (match) => (isSalesforceId(match) ? `<record:${fingerprint(match)}>` : match))
    .replace(UUID, (match) => `<uuid:${fingerprint(match.toLowerCase())}>`)
    .replace(/\/(?:Users|home)\/[^/\s]+/gu, (match) => `${match.slice(0, match.lastIndexOf('/') + 1)}<user>`)
    .replace(SECRET_HEADER, '$1<redacted:secret>')
    .replace(SECRET_QUERY, '$1<redacted:secret>')
    .replace(QUOTED_SECRET_ASSIGNMENT, '$1$2<redacted:secret>$2')
    .replace(UNQUOTED_SECRET_ASSIGNMENT, '$1$2<redacted:secret>');

export const redactValue = (value) => {
  if (typeof value === 'string') return redactString(value);
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return redactString(Buffer.from(value).toString('utf8'));
  if (Array.isArray(value))
    return value.map((entry, index) =>
      index > 0 && typeof value[index - 1] === 'string' && SECRET_FLAG.test(value[index - 1])
        ? '<redacted:secret>'
        : redactValue(entry)
    );
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      SECRET_KEY.test(key)
        ? '<redacted:secret>'
        : SUPPORT_IDENTIFIER_KEY.test(key) && entry !== null && entry !== undefined
          ? `<support:${fingerprint(String(entry))}>`
          : redactValue(entry),
    ])
  );
};

export const serializeRedacted = (value) => {
  const redacted = redactValue(value);
  if (typeof redacted === 'string') return redacted;
  if (redacted === undefined) return '';
  return JSON.stringify(redacted) ?? '';
};

export const findLeaks = (value) => {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  const assignmentText = text.replace(/\\"/gu, '"').replace(/\\[nrt]/gu, ' ');
  const findings = [];
  for (const { label, pattern } of PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) findings.push(label);
  }
  SALESFORCE_ID_CANDIDATE.lastIndex = 0;
  if ([...text.matchAll(SALESFORCE_ID_CANDIDATE)].some(([candidate]) => isSalesforceId(candidate)))
    findings.push('Salesforce record ID');
  UUID.lastIndex = 0;
  if (UUID.test(text)) findings.push('UUID');
  QUOTED_SECRET_ASSIGNMENT.lastIndex = 0;
  UNQUOTED_SECRET_ASSIGNMENT.lastIndex = 0;
  if (QUOTED_SECRET_ASSIGNMENT.test(assignmentText) || UNQUOTED_SECRET_ASSIGNMENT.test(assignmentText))
    findings.push('secret-valued field');
  INLINE_SUPPORT_IDENTIFIER.lastIndex = 0;
  SUPPORT_IDENTIFIER_ASSIGNMENT.lastIndex = 0;
  if (INLINE_SUPPORT_IDENTIFIER.test(assignmentText) || SUPPORT_IDENTIFIER_ASSIGNMENT.test(assignmentText))
    findings.push('support correlation ID');
  return [...new Set(findings)];
};

export const assertLeakFree = (value, label = 'artifact') => {
  const findings = findLeaks(value);
  if (findings.length > 0) throw new Error(`${label} failed leak scan: ${findings.join(', ')}`);
};
