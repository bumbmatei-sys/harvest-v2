/** Pure scanners behind the token-leak guard (tests/unit/ui-provenance.test.ts). Nothing here holds a credential. */
const placeholderValues = new Set(["${REGISTRY_TOKEN}", "proxy-injected"]);
const bearer = /Bearer\s+["'`]?([^\s"'`,;)<]+)/gi;
const assignment = /\bREGISTRY_TOKEN["']?[ \t]*[=:][ \t]*["']?([^\s"'`,;]*)/g;

/** Findings are rule names only; the offending value is never echoed. */
export function scanForSecrets(text: string): string[] {
  const findings: string[] = [];
  for (const match of text.matchAll(bearer)) {
    const value = match[1];
    if (!placeholderValues.has(value) && /^[A-Za-z0-9._~+/=-]{20,}$/.test(value)) findings.push("bearer-token");
  }
  for (const match of text.matchAll(assignment)) if (match[1] && !placeholderValues.has(match[1])) findings.push("registry-token-assignment");
  if (/"\$schema"\s*:\s*"[^"]*registry\.json"/.test(text) && /"name"\s*:\s*"shadcnuikit"/.test(text)) findings.push("kit-registry-index");
  if (/"type"\s*:\s*"registry:(?:block|component)"/.test(text) && /"files"\s*:\s*\[/.test(text) && /"content"\s*:/.test(text)) findings.push("kit-registry-item");
  return findings;
}
