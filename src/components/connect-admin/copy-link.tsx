"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

export function CopyLink({ value, display }: { value: string; display: string }) {
  const t = useTranslations("ConnectLinks");
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  async function copy() {
    try { await navigator.clipboard.writeText(value); setState("copied"); } catch { setState("failed"); }
  }
  return <div className="flex min-w-0 flex-wrap items-center gap-2">
    <code className="min-w-0 break-all rounded-md bg-muted px-2 py-1 font-mono text-sm">{display}</code>
    <Button type="button" variant="ghost" size="sm" className="min-h-11" onClick={() => void copy()} aria-label={t("copyNamed", { url: display })}>
      {state === "copied" ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}{state === "copied" ? t("copied") : t("copy")}
    </Button>
    <span role="status" className="sr-only">{state === "copied" ? t("copied") : state === "failed" ? t("copyFailed") : ""}</span>
    {state === "failed" && <span className="text-sm text-muted-foreground">{t("copyFailed")}</span>}
  </div>;
}
