"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

export function ConfirmSignup({ email, token }: { email: string; token: string }) {
  const t = useTranslations("NewsletterForms.confirm");
  const [state, setState] = useState<"idle" | "busy" | "sent" | "failed">("idle");
  const valid = /^[^\s@]+@[^\s@]+$/.test(email) && /^[A-Za-z0-9_-]{43}$/.test(token);
  async function confirm() {
    setState("busy");
    try {
      const response = await fetch("/api/newsletter/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, token }) });
      setState(response.ok ? "sent" : "failed");
    } catch { setState("failed"); }
  }
  if (!valid) return <div role="status" className="space-y-2" data-confirm-invalid><h1 className="text-2xl font-semibold tracking-tight">{t("invalidTitle")}</h1></div>;
  if (state === "sent") return <div role="status" className="space-y-2" data-confirm-done><h1 className="text-2xl font-semibold tracking-tight">{t("doneTitle")}</h1><p className="text-sm text-muted-foreground">{t("doneBody")}</p></div>;
  return <div className="space-y-4"><h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
    {state === "failed" && <p role="alert" className="text-sm text-destructive">{t("failed")}</p>}
    <Button type="button" className="min-h-11" disabled={state === "busy"} onClick={() => void confirm()} data-confirm-button>{t("button")}</Button></div>;
}
