import { createElement, type ComponentType, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { expect, it } from "vitest";
import messages from "../../messages/en.json";
import { CommunityPageView } from "../../src/components/communities/community-page-view";

const Provider = NextIntlClientProvider as unknown as ComponentType<{ locale: string; messages: Record<string, unknown>; children?: ReactNode }>;
const data = { name: "Grace <b>Bible</b> Study", tagline: "Weekly & warm", description: "Line one\nLine two", rulesList: ["Be kind", "No spam"], hostName: "Grace Church" };
const render = (props: Partial<Parameters<typeof CommunityPageView>[0]>) => renderToStaticMarkup(createElement(Provider, { locale: "en", messages },
  createElement(CommunityPageView, { data, join: createElement("button", null, "Join"), ...props })));

it("the public page and the editor preview share one render path: with the preview markers removed the markup is the same", () => {
  const publicHtml = render({}), previewHtml = render({ preview: true, layout: "narrow" });
  expect(publicHtml).not.toContain("data-preview-field");
  const normalised = previewHtml.replace(/ data-preview-field="[a-z]+"/g, "").replace(/<details open="" /, "<details ").replace(/<p class="text-\[28px\]([^>]*)>(.*?)<\/p>/, '<h1 class="text-[28px]$1>$2</h1>')
    .replace(/<p class="text-center text-xs text-muted-foreground">Preview<\/p>/, "").replace('<div class="grid gap-8">', '<div class="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">');
  expect(normalised).toBe(publicHtml);
});
it("renders draft text as text, never as markup", () => {
  const html = render({ preview: true });
  expect(html).toContain("Grace &lt;b&gt;Bible&lt;/b&gt; Study");
  expect(html).not.toContain("<b>Bible</b>");
});
it("marks the fields that click-to-field can reach, only in preview", () => {
  const html = render({ preview: true });
  for (const field of ["name", "tagline", "description", "rules", "admission"]) expect(html).toContain(`data-preview-field="${field}"`);
  expect(html).toContain("<details");
});
