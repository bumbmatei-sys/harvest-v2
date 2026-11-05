import ts from "typescript";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type Violation = { rule: "i18n" | "color"; line: number; text: string };
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
export function sourceFiles(directory = "src"): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(file) : /\.(?:tsx?|css)$/.test(file) ? [file] : [];
  });
}
export function checkSources() {
  return sourceFiles().flatMap((file) => inspectSource(readFileSync(file, "utf8"), file).map((error) => ({ file, ...error })));
}
