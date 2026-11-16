import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { expect, it, vi } from "vitest";
import { z } from "zod";
import messages from "../../messages/en.json";
import { useHarvestForm } from "../../src/hooks/use-harvest-form";

// Exercise the hook -> real react-hook-form -> real Zod resolver -> submit handler boundary without a browser.
const schema = z.object({ name: z.string().trim().min(1, "Required"), count: z.string().transform(Number) });
function mounted(defaults: z.input<typeof schema>) {
  let captured!: ReturnType<typeof useHarvestForm<typeof schema.shape>>;
  function Harness() { captured = useHarvestForm(schema, defaults); return null; }
  renderToString(h(NextIntlClientProvider, { locale: "en", messages, children: h(Harness) }));
  captured.form.register("name"); captured.form.register("count");
  return captured;
}
it("submits transformed schema output through the shared hook without mutating the input defaults", async () => {
  const defaults = { name: " Grace ", count: "4" }, hook = mounted(defaults), saved = vi.fn();
  await hook.submit((value) => { saved(value); })();
  expect(saved).toHaveBeenCalledWith({ name: "Grace", count: 4 });
  expect(defaults).toEqual({ name: " Grace ", count: "4" });
});
it("blocks invalid values before the handler, permits correction, and maps a server refusal to the field", async () => {
  const hook = mounted({ name: " ", count: "2" }), saved = vi.fn();
  await hook.submit((value) => { saved(value); })();
  expect(saved).not.toHaveBeenCalled(); expect(hook.form.getFieldState("name").error?.message).toBe("Required");
  hook.form.setValue("name", "Hope");
  await hook.submit((value) => { saved(value); return { fields: { name: "Already used" } }; })();
  expect(saved).toHaveBeenCalledWith({ name: "Hope", count: 2 });
  expect(hook.form.getFieldState("name").error).toMatchObject({ type: "server", message: "Already used" });
});
