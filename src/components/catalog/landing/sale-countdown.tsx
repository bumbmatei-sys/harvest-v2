"use client";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

/** Days, hours and minutes left until `endsAt` (never negative). */
export function timeLeft(endsAt: string, now: number) {
  const ms = Math.max(0, new Date(endsAt).getTime() - now), minutes = Math.floor(ms / 60_000);
  return { days: Math.floor(minutes / 1440), hours: Math.floor((minutes % 1440) / 60), minutes: minutes % 60, over: ms === 0 };
}

/** Live "Sale ends in 1d 23h 4m". Rendered after mount only, so the server and the first client paint agree; when the sale ends it shows nothing (the next page load drops the sale price). */
export function SaleCountdown({ endsAt, className }: { endsAt: string; className?: string }) {
  const t = useTranslations("CatalogLanding");
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const first = window.setTimeout(() => setNow(Date.now()), 0);
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => { window.clearTimeout(first); window.clearInterval(timer); };
  }, []);
  if (now === null) return null;
  const left = timeLeft(endsAt, now);
  if (left.over) return null;
  return <span className={className} data-slot="sale-countdown">
    {left.days > 0 ? t("saleEndsDays", { days: left.days, hours: left.hours, minutes: left.minutes }) : t("saleEndsHours", { hours: left.hours, minutes: left.minutes })}
  </span>;
}
