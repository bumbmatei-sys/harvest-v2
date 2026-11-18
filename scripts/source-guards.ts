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
    // Toasts: the title and the description option must come from the catalogue (src/lib/toast.ts).
    if (ts.isCallExpression(node) && /^(?:notify|toast)\.(?:success|error|info)$/.test(node.expression.getText(sf))) {
      rendered(node.arguments[0]);
      const options = node.arguments[1];
      // Option text may not hide a raw string: description, label and action/cancel labels are checked; a spread is rejected.
      const checkOptions = (object: ts.ObjectLiteralExpression, nested: boolean) => {
        for (const property of object.properties) {
          if (ts.isSpreadAssignment(property)) { report("i18n", property, `toast options spread: ${property.expression.getText(sf)}`); continue; }
          if (!ts.isPropertyAssignment(property)) continue;
          const name = property.name.getText(sf);
          if (/^(?:description|label)$/.test(name)) rendered(property.initializer);
          else if (!nested && /^(?:action|cancel)$/.test(name) && ts.isObjectLiteralExpression(property.initializer)) checkOptions(property.initializer, true);
        }
      };
      if (options && ts.isObjectLiteralExpression(options)) checkOptions(options, false);
    }
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

// ---- Social provider boundary (src/server/social). Added with the integration layer; independent of the guards above. ----
// Nothing outside the vendor adapter may import it, name the vendor host, or use a vendor HTTP client; the hard-disable constants must stay
// false and may not become environment toggles; sending entry points live only in the port and the two adapters.
const SOCIAL_ADAPTER = "src/server/social/zernio-adapter.ts";
const SOCIAL_REGISTRY = "src/server/social/registry.ts";
const SOCIAL_SEND_HOMES = [SOCIAL_ADAPTER, "src/server/social/port.ts", "src/server/social/fake-provider.ts"];
export type BoundaryViolation = { file: string; rule: string };
export function inspectSocialBoundary(file: string, source: string): BoundaryViolation[] {
  const found: BoundaryViolation[] = [];
  const add = (rule: string) => found.push({ file, rule });
  const norm = file.replaceAll("\\", "/");
  const inSocial = norm.startsWith("src/server/social/");
  const officeAdapter = /^src\/server\/(?:mail|calendar|files-provider)\/zernio-adapter\.ts$/.test(norm);
  const officeRegistry = /^src\/server\/(?:mail|calendar|files-provider)\/registry\.ts$/.test(norm);
  const inOffice = /^src\/server\/(?:mail|calendar|files-provider|office-provider)\//.test(norm);
  if (norm !== SOCIAL_ADAPTER && !officeAdapter) {
    if (/zernio\.com/i.test(source)) add("vendor host outside the adapter");
    if (specifiers(source).some(s => /^(?:@zernio\/|@getlatedev\/|late-sdk(?:\/|$)|zernio(?:\/|$)|googleapis(?:\/|$)|@microsoft\/microsoft-graph-client)/i.test(s))) add("vendor HTTP client import outside the adapter");
    if (/(?:from|import)\s*\(?\s*["'][^"']*zernio-adapter["']/.test(source) && norm !== SOCIAL_REGISTRY && !officeRegistry) add("adapter imported outside the registry");
  }
  if (!SOCIAL_SEND_HOMES.includes(norm) && /\b(?:sendMessage|replyToComment)\s*\(/.test(source)) add("sending entry point outside the port and adapters");
  if (!SOCIAL_SEND_HOMES.includes(norm) && norm !== SOCIAL_REGISTRY && /\bgetSocialSender\b/.test(source)) add("sender accessor used outside the registry");
  if (inSocial || inOffice) {
    if (/process\.env/.test(source)) add("environment read inside the social layer (kill switches are constants)");
    if (norm !== SOCIAL_ADAPTER && /\bfetch\s*\(|globalThis\.fetch|\bXMLHttpRequest\b|node:https?\b/.test(source)) add("network call inside the social layer outside the adapter");
  }
  if (officeAdapter && !/export const ZERNIO_LIVE_NETWORK = false;/.test(source)) add("office adapter must remain disabled");
  if (officeRegistry && !/export const INTEGRATION_ENABLED = false;/.test(source)) add("office registry must remain disabled");
  if (officeRegistry && /\bfetch\b/.test(source)) add("office registry cannot inject transport");
  if (norm === "src/server/office-provider/connections.ts" && !/export const OFFICE_INTEGRATION_ENABLED = false;/.test(source)) add("office connections must remain disabled");
  if (norm === SOCIAL_ADAPTER && !/export const ZERNIO_LIVE_NETWORK = false;/.test(source)) add("ZERNIO_LIVE_NETWORK must be the literal constant false");
  if (norm === SOCIAL_REGISTRY && !/export const SOCIAL_INTEGRATION_ENABLED = false;/.test(source)) add("SOCIAL_INTEGRATION_ENABLED must be the literal constant false");
  if (norm === SOCIAL_REGISTRY && /\bfetch\b/.test(source)) add("the registry must not inject a fetch");
  return found;
}
// Operator scripts are held to the same boundary (this file is exempt: it names the patterns it forbids).
export function checkSocialBoundary(directories: string[] = ["src", "scripts"]): BoundaryViolation[] {
  const violations = directories.flatMap((directory) => sourceFiles(directory)).filter((file) => /\.tsx?$/.test(file) && file.replaceAll("\\", "/") !== "scripts/source-guards.ts")
    .flatMap((file) => inspectSocialBoundary(file, readFileSync(file, "utf8")));
  return [...violations, ...inspectProviderCopy(JSON.parse(readFileSync("messages/en.json", "utf8")))];
}

// ---- Toast library boundary: only the Harvest adapter and helper may import `sonner` (kinds, copy and actions stay uniform). ----
const SONNER_HOMES = ["src/lib/toast.ts", "src/components/ui/sonner.tsx"];
export function inspectSonnerBoundary(file: string, source: string): BoundaryViolation[] {
  const norm = file.replaceAll("\\", "/");
  if (SONNER_HOMES.includes(norm)) return [];
  return specifiers(source).some((specifier) => specifier === "sonner" || specifier.startsWith("sonner/")) ? [{ file, rule: "sonner may only be imported by src/lib/toast.ts and src/components/ui/sonner.tsx" }] : [];
}
export function checkSonnerBoundary(directories: string[] = ["src", "scripts"]): BoundaryViolation[] {
  return directories.flatMap((directory) => sourceFiles(directory)).filter((file) => /\.tsx?$/.test(file) && file.replaceAll("\\", "/") !== "scripts/source-guards.ts")
    .flatMap((file) => inspectSonnerBoundary(file, readFileSync(file, "utf8")));
}

/** Catalogue keys may name internal providers; displayed leaf values must remain neutral. */
export function inspectProviderCopy(value: unknown): BoundaryViolation[] {
  if (typeof value === "string") return /\b(?:zernio|gmail|outlook|onedrive|google drive|microsoft)\b/i.test(value) ? [{ file: "messages/en.json", rule: "vendor name in user-facing copy" }] : [];
  return value && typeof value === "object" ? Object.values(value).flatMap(inspectProviderCopy) : [];
}

// The QA signer is a build alias, and only the gate reads QA environment flags and secrets.
export function inspectQaBoundary(file: string, source: string): BoundaryViolation[] {
  const normal = file.replaceAll("\\", "/");
  const found: BoundaryViolation[] = [];
  const add = (rule: string) => found.push({ file, rule });
  if (normal.startsWith("tests/") || normal === "scripts/source-guards.ts") return found;
  const flag = /\bHARVEST_QA_SIGN_IN\b/;
  if (normal === ".env.example" || normal.startsWith(".github/workflows/") || normal.startsWith(".circleci/")) {
    if (/\bQA_SIGN_IN_SECRET\b/.test(source)) add("QA signing key is scoped to the auth deployment");
    if (/(?:^|[\s{,])["']?HARVEST_QA_SIGN_IN["']?\s*[:=]/m.test(source)) add("QA sign-in flag cannot be set in CI or .env.example");
    return found;
  }
  if (normal !== "src/server/qa-sign-in-gate.ts" && (flag.test(source) || /\bQA_SIGN_IN_(?:HELPER_)?SECRET\b/.test(source))) {
    add("QA sign-in flags and secrets are read only in the gate");
  }
  if (normal !== "src/app/api/qa/otp/route.ts" && /\/api\/qa\/otp\b/.test(source)) add("QA helper route referenced outside its boundary");
  if (normal !== "next.config.ts" && /\bauth-otp-hooks-preview\b/.test(source)) add("QA OTP implementation must be loaded through the build alias");
  return found;
}

export function checkQaBoundary() {
  const configs = [".env.example", "next.config.ts", "package.json", ...[".github/workflows", ".circleci"].flatMap((directory) =>
    readdirSync(directory).filter((file) => /\.ya?ml$/.test(file)).map((file) => join(directory, file)))];
  return [...sourceFiles("src"), ...sourceFiles("scripts"), ...configs]
    .flatMap((file) => inspectQaBoundary(file, readFileSync(file, "utf8")));
}
