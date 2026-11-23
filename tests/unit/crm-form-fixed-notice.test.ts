import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import messages from "../../messages/en.json";
import { buildForm } from "../../src/lib/crm-forms";
import { PublicForm } from "../../src/components/forms/public-form";
import { crmFormVisitorKey } from "../../src/server/crm-form-visitor";

const form = buildForm(null, null, key => key, "2026-11-23T00:00:00.000Z");
const render = (ministryName?: string | null) => renderToStaticMarkup(h(NextIntlClientProvider, { locale: "en", messages, children: h(PublicForm, { form, ministryName }) }));

describe("hosted form fixed notice", () => {
  it("always shows Harvest's minimum line after the ministry's own consent text, with an unticked box", () => {
    const html = render("Grace Church");
    expect(html).toContain("Your details go to Grace Church. You can ask them to delete them.");
    expect(html).toContain("data-fixed-notice");
    expect(html).not.toMatch(/<button[^>]*role="checkbox"[^>]*aria-checked="true"/);
    expect(html).not.toMatch(/data-state="checked"/);
  });
  it("falls back to neutral wording when no published ministry name is available", () => {
    expect(render(null)).toContain("Your details go to the ministry that published this form. You can ask them to delete them.");
  });
});

describe("hosted form visitor key", () => {
  const key = Buffer.alloc(32, 7);
  const request = (headers: Record<string, string>) => new Request("http://localhost/f/x", { headers });
  it("hashes the configured client address and never exposes it", () => {
    const one = crmFormVisitorKey(request({ "x-forwarded-for": "203.0.113.5" }), key, {});
    expect(one).toMatch(/^[a-f0-9]{64}$/);
    expect(one).toBe(crmFormVisitorKey(request({ "x-forwarded-for": "203.0.113.5" }), key, {}));
    expect(one).not.toBe(crmFormVisitorKey(request({ "x-forwarded-for": "203.0.113.6" }), key, {}));
    expect(crmFormVisitorKey(request({ "cf-connecting-ip": "203.0.113.5" }), key, { AUTH_IP_ADDRESS_HEADERS: "cf-connecting-ip" })).toMatch(/^[a-f0-9]{64}$/);
  });
  it("returns no key without a usable address", () => {
    expect(crmFormVisitorKey(request({}), key, {})).toBeNull();
    expect(crmFormVisitorKey(request({ "x-forwarded-for": "not-an-address" }), key, {})).toBeNull();
  });
});
