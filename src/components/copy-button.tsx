/** Derived from Shadcn UI Kit item tables21 (premium), registry retrieved 2026-11-16, approved 2026-11-16 (Kit PR 5). Visual reference only; local changes: docs/ui-sources.md. */
"use client";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { copyText } from "@/lib/copy-text";
import { notify } from "@/lib/toast";
import { Button } from "@/components/ui/button";

/**
 * Icon button that copies a value and confirms with a toast. The caller names what is copied
 * (`label`, for example "Copy email address") so the accessible name is specific. 44px below 1024px.
 */
export function CopyButton({ value, label, className }: { value: string; label: string; className?: string }) {
  const t = useTranslations("ComponentsCopyButton");
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  async function copy() {
    const result = await copyText(value);
    if (result === "failed") { notify.error(t("failed")); return; }
    notify.success(t("copied"));
    setCopied(true); clearTimeout(timer.current); timer.current = setTimeout(() => setCopied(false), 1800);
  }
  return <Button type="button" variant="ghost" size="icon-responsive" aria-label={label} title={label} className={className ?? "text-muted-foreground lg:size-8"} onClick={() => void copy()}>
    {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
  </Button>;
}
