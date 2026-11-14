import ts from "typescript";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type Violation = { rule: "i18n" | "color" | "consent-gate"; line: number; text: string };
const userAttributes = /^(?:aria-label|aria-description|alt|title|placeholder|label|tooltip|description)$/;
const rawColor = /#[\da-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch)\s*\(/i;
const palette = /\b(?:bg|text|border(?:-[trblxyse])?|ring(?:-offset)?|outline|fill|stroke|shadow|accent|caret|decoration|divide|from|via|to)-(?:white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(?:-\d{2,3})?(?=[/\s"'`\]]|$)/;

export function inspectSource(source: string, file = "component.tsx"): Violation[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith("tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const errors: Violation[] = [];
  const report = (rule: Violation["rule"], node: ts.Node, value: string) => {
    if (value.trim()) errors.push({ rule, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, text: value.trim().slice(0, 90) });
  };
  function rendered(node: ts.Node | undefined) {
    if (!node) return;
    if (ts.isStringLiteralLike(node)) report("i18n", node, node.text);
    else if (ts.isTemplateExpression(node)) {
      const text = node.head.text + node.templateSpans.map((span) => span.literal.text).join("");
      report("i18n", node, text);
    } else if (ts.isConditionalExpression(node)) { rendered(node.whenTrue); rendered(node.whenFalse); }
    else if (ts.isBinaryExpression(node) && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.AmpersandAmpersandToken].includes(node.operatorToken.kind)) {
      rendered(node.left); rendered(node.right);
    } else if (ts.isParenthesizedExpression(node)) rendered(node.expression);
  }
  function visit(node: ts.Node) {
    if (ts.isJsxText(node)) report("i18n", node, node.text);
    if (ts.isJsxAttribute(node) && userAttributes.test(node.name.getText(sf))) {
      if (node.initializer && ts.isStringLiteral(node.initializer)) rendered(node.initializer);
      else if (node.initializer && ts.isJsxExpression(node.initializer)) rendered(node.initializer.expression);
    }
    if (ts.isJsxExpression(node) && !ts.isJsxAttribute(node.parent)) rendered(node.expression);
    // Errors and feedback outside JSX must also go through the catalogue.
    if (ts.isNewExpression(node) && /(?:Error|InvalidStoredFile)$/.test(node.expression.getText(sf))) {
      for (const arg of node.arguments ?? []) if ((ts.isStringLiteralLike(arg) && !/^[A-Z_]+$/.test(arg.text)) || ts.isTemplateExpression(arg)) rendered(arg);
    }
    if (ts.isCallExpression(node) && /^set(?:Error|Message|Phase)$/.test(node.expression.getText(sf))) rendered(node.arguments[0]);
    if (!file.endsWith("theme-registry.ts") && (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node))) {
      if (rawColor.test(node.text) || palette.test(node.text)) report("color", node, node.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  if (file.endsWith("css") && (rawColor.test(source) || palette.test(source))) {
    errors.push({ rule: "color", line: 1, text: "CSS must reference semantic variables; define color values in theme-registry.ts" });
  }
  return errors;
}

/**
 * HC-DEC1b consent-gate guard. A module that imports a message provider, or one of the known sender entry points, must
 * reference the consent gate (`src/server/consent-gate.ts`: import it and call `mayContact`), or be listed below with the reason
 * it is outside the consent ledger. A new sender therefore cannot be added without either the gate or a reviewed exception.
 * No sender for newsletter, follow-up or Auto-DM exists yet; this guard is what makes the first one call the gate.
 */
export const SENDER_PROVIDER_PACKAGES = ["resend", "nodemailer", "@sendgrid/mail", "postmark", "twilio", "zernio"];
/** Known sender entry points (module basenames). */
export const SENDER_ENTRY_MODULES = ["email", "community-email-sender", "connect-invitation-email"];
export const CONSENT_GATE_EXEMPTIONS: Record<string, string> = {
  "src/server/email.ts": "Sign-in code only: authentication, not a consent purpose.",
  "src/server/auth.ts": "Sends the sign-in code only: authentication, not a consent purpose.",
  "src/server/community-email-sender.ts": "Provider adapter for the member-preference community notification worker; live delivery is hard-disabled.",
  "src/server/community-email.ts": "Member-preference community notification worker (fixed templates); preference and eligibility are re-checked at claim in SQL.",
  "scripts/send-community-email.ts": "Operator script for the same worker, local test mailbox only.",
  "src/server/connect-invitation-email.ts": "Provider adapter for the fixed Connect invitation; connect_invitation_eligible re-checks account_communications at dispatch.",
};
const specifiers = (source: string) => [...source.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)["']([^"']+)["']/gm)].map((match) => match[1]);
const basename = (specifier: string) => specifier.replace(/\/+$/, "").split("/").pop() ?? "";
export function importsSender(source: string): boolean {
  return specifiers(source).some((specifier) => SENDER_PROVIDER_PACKAGES.includes(specifier) || SENDER_PROVIDER_PACKAGES.some((pkg) => specifier.startsWith(`${pkg}/`))
    || (specifier.startsWith(".") || specifier.startsWith("@/")) && SENDER_ENTRY_MODULES.includes(basename(specifier)));
}
export function referencesConsentGate(source: string): boolean {
  return specifiers(source).some((specifier) => basename(specifier) === "consent-gate") && /\bmayContact\s*\(/.test(source);
}
export function inspectSender(source: string, file: string): Violation[] {
  if (file.endsWith("consent-gate.ts") || !importsSender(source) || referencesConsentGate(source) || file in CONSENT_GATE_EXEMPTIONS) return [];
  return [{ rule: "consent-gate", line: 1, text: "A module that imports a sender or provider must call mayContact from the consent gate (or be a documented exemption)" }];
}
export function sourceFiles(directory = "src"): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(file) : /\.(?:tsx?|css)$/.test(file) ? [file] : [];
  });
}
export function checkSources() {
  const own = sourceFiles().flatMap((file) => inspectSource(readFileSync(file, "utf8"), file).map((error) => ({ file, ...error })));
  return [...own, ...checkSenders()];
}
/** The consent-gate rule over application source and operator scripts. */
export function checkSenders() {
  return [...sourceFiles("src"), ...sourceFiles("scripts")].flatMap((file) => inspectSender(readFileSync(file, "utf8"), file).map((error) => ({ file, ...error })));
}
