import { createElement as h, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import messages from "../../messages/en.json";
import { copyText, mailtoHref, telHref } from "../../src/lib/copy-text";
import { trackerPosition, trackerStates } from "../../src/lib/status-tracker";
import { dealTrackerSteps } from "../../src/lib/crm-deal-tracker";
import { consentTone } from "../../src/lib/crm-consent-tone";
import { StatusTracker } from "../../src/components/status-tracker";
import { RowSummary } from "../../src/components/crm/list-row-summary";

const render = (element: ReactElement) => renderToStaticMarkup(h(NextIntlClientProvider, { locale: "en", messages, children: element }));
const steps = [{ id: "a", label: "New" }, { id: "b", label: "Qualified" }, { id: "c", label: "Proposal" }];

describe("copyText", () => {
  it("writes through the clipboard and reports success", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    expect(await copyText("ada@example.com", { writeText })).toBe("copied");
    expect(writeText).toHaveBeenCalledWith("ada@example.com");
  });
  it("reports failure for an empty value and never throws when the clipboard rejects", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    expect(await copyText("", { writeText })).toBe("failed");
    expect(writeText).not.toHaveBeenCalled();
    // No DOM in the unit project: the textarea fallback is unavailable, so a rejected clipboard fails cleanly.
    expect(await copyText("x", { writeText })).toBe("failed");
    expect(await copyText("x", undefined)).toBe("failed");
  });
});

describe("mailto and tel targets", () => {
  it("trims the address and keeps only dialable characters in the phone number", () => {
    expect(mailtoHref("  ada@example.com ")).toBe("mailto:ada@example.com");
    expect(telHref("+49 (151) 234-5678")).toBe("tel:+491512345678");
  });
});

describe("status tracker helpers", () => {
  it("marks earlier steps done, the current step current and later steps upcoming", () => {
    expect(trackerStates(steps, "b")).toEqual(["done", "current", "upcoming"]);
    expect(trackerStates(steps, "missing")).toEqual(["upcoming", "upcoming", "upcoming"]);
    expect(trackerPosition(steps, "c")).toEqual({ index: 3, total: 3 });
    expect(trackerPosition(steps, "missing")).toEqual({ index: 0, total: 3 });
  });
  it("builds a deal tracker from open stages and adds a closed stage only when the deal sits in it", () => {
    const stages = [{ id: "n", name: "New", kind: "open" as const }, { id: "q", name: "Qualified", kind: "open" as const }, { id: "old", name: "Old", kind: "open" as const, archived: true },
      { id: "w", name: "Won", kind: "won" as const }, { id: "l", name: "Lost", kind: "lost" as const }];
    expect(dealTrackerSteps(stages, "q")).toEqual({ steps: [{ id: "n", label: "New" }, { id: "q", label: "Qualified" }], tone: "default" });
    expect(dealTrackerSteps(stages, "w").steps.map((step) => step.id)).toEqual(["n", "q", "w"]);
    expect(dealTrackerSteps(stages, "w").tone).toBe("success");
    expect(dealTrackerSteps(stages, "l").tone).toBe("danger");
    expect(dealTrackerSteps(stages, "old").steps.map((step) => step.id)).toEqual(["n", "q", "old"]);
  });
});

describe("consent tone", () => {
  it("maps recorded states to tones and anything else to neutral", () => {
    expect(consentTone("granted")).toBe("success"); expect(consentTone("withdrawn")).toBe("warning");
    expect(consentTone("none")).toBe("pending"); expect(consentTone("unknown")).toBe("pending"); expect(consentTone("other")).toBe("neutral");
  });
});

describe("StatusTracker markup", () => {
  it("is a named list with one current step and state spelled out as text", () => {
    const html = render(h(StatusTracker, { steps, current: "b", label: "Stage progress" }));
    expect(html).toContain('aria-label="Stage progress"');
    expect(html.match(/aria-current="step"/g)).toHaveLength(1);
    expect(html).toContain("completed"); expect(html).toContain("current"); expect(html).toContain("upcoming");
    expect(html).toContain("Step 2 of 3");
  });
  it("renders nothing without steps and no count for an unknown current step", () => {
    expect(render(h(StatusTracker, { steps: [], current: "a", label: "x" }))).toBe("");
    expect(render(h(StatusTracker, { steps, current: "zzz", label: "x" }))).not.toContain("Step ");
  });
});

describe("RowSummary markup", () => {
  it("shows the status and links with their accessible names, and nothing when empty", () => {
    const html = render(h(RowSummary, { indent: "pl-11", data: { status: { text: "Subscribed", tone: "success" }, links: [{ kind: "email", text: "ada@example.com", href: "mailto:ada@example.com" }, { kind: "domain", text: "example.org", href: "https://example.org", external: true }] } }));
    expect(html).toContain("Subscribed"); expect(html).toContain('href="mailto:ada@example.com"'); expect(html).not.toContain('aria-label');
    expect(html).toContain('target="_blank"'); expect(html).toContain("min-h-11"); expect(html).toContain("@xl:hidden");
    expect(render(h(RowSummary, { indent: "", data: {} }))).toBe("");
  });
});
