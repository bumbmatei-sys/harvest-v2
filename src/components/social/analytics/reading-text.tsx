"use client";
import { useFormatter, useTranslations } from "next-intl";
import type { Reading } from "@/lib/social/analytics-view";
import { cn } from "@/lib/utils";

/** The one place a reading becomes text: a null value says "Unavailable" and is never formatted as zero. */
export function useNumberFormat() {
  const format = useFormatter();
  return (value: number) => format.number(value, { maximumFractionDigits: Math.abs(value) < 100 && !Number.isInteger(value) ? 1 : 0 });
}
export function ReadingText({ reading, signed = false, className }: { reading: Reading | undefined; signed?: boolean; className?: string }) {
  const t = useTranslations("SocialAnalytics.cards"), format = useFormatter(), plain = useNumberFormat();
  if (!reading || reading.value === null) return <span className={cn("text-muted-foreground", className)} data-availability="unavailable">{t("unavailable")}</span>;
  const text = signed ? format.number(reading.value, { signDisplay: "exceptZero", maximumFractionDigits: 1 }) : plain(reading.value);
  return <span className={className} data-availability={reading.availability}>{text}{reading.availability === "partial" && <span className="sr-only">{t("partialNote", { value: "" })}</span>}</span>;
}
