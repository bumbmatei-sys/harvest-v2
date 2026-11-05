import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../src/components/ui/card";
import { Button } from "../src/components/ui/button";
import { themeStyles } from "../src/lib/theme-registry";
import { themeBootstrap } from "../src/lib/theme";
import messages from "../messages/en.json";

// Generated from the same shadcn primitives, catalogue and semantic tokens as the app.
// This file is public and contains no session, user or tenant data.
const t = messages.Pwa;
const content = renderToStaticMarkup(h("html", { lang: "en" },
  h("head", null, h("meta", { charSet: "utf-8" }), h("meta", { name: "viewport", content: "width=device-width, initial-scale=1" }),
    h("title", null, t.title), h("link", { rel: "stylesheet", href: "/offline.css" }),
    h("script", { dangerouslySetInnerHTML: { __html: themeBootstrap() } })),
  h("body", null, h("main", { className: "flex min-h-dvh items-center justify-center p-6" },
    h(Card, { className: "w-full max-w-sm" },
      h(CardHeader, null, h(CardTitle, null, h("h1", { className: "text-2xl" }, t.heading)), h(CardDescription, null, t.description)),
      h(CardContent, null, h(Button, { asChild: true }, h("a", { href: "/workspaces" }, t.retry))))))));
const source = await readFile("src/app/globals.css", "utf8");
const css = await postcss([tailwind()]).process(`${source}\n${themeStyles}`, { from: resolve("src/app/globals.css") });
await writeFile("public/offline.html", `<!doctype html>\n${content}\n`);
await writeFile("public/offline.css", css.css);
console.log("Generated public offline fallback from English messages and theme tokens.");
