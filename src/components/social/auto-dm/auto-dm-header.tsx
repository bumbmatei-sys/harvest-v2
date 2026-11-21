"use client";
import { useTranslations } from "next-intl";
import { StatusBadge } from "@/components/status-badge";
import { useSendEnabled } from "@/components/social/auto-dm/sender-state";

/** The page header of every Auto-DM screen: the title with one line, the sending-off badge and the page's own actions. */
export function AutoDmHeader({ title, subtitle, children }: { title?: string; subtitle?: string; children?: React.ReactNode }) {
  const t = useTranslations("SocialAutoDm"), sendEnabled = useSendEnabled();
  return <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
    <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h1 className="text-[28px] font-semibold tracking-tight">{title ?? t("title")}</h1>{!sendEnabled && <StatusBadge tone="warning" dot label={t("hardOff.badge")} />}</div>
      <p className="mt-1 text-sm text-muted-foreground">{subtitle ?? t("subtitle")}</p></div>
    {children && <div className="flex min-w-0 flex-wrap items-center gap-2 max-sm:w-full">{children}</div>}
  </header>;
}
