/**
 * Render untrusted text without allowing C0, DEL, or C1 control characters to
 * reach an interactive terminal.
 */
export const terminalSafeText = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  return [...String(value)]
    .map((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code <= 0x1f || (code >= 0x7f && code <= 0x9f) ? `\\x${code.toString(16).padStart(2, '0')}` : character;
    })
    .join('');
};
