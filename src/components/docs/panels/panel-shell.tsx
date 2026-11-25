"use client";
import { ChevronsRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

/** The frame every right-hand panel shares: a title, optional header actions, the close button (»), a scrolling body and an optional footer. */
export function PanelShell({ title, onClose, actions, footer, children, name }: { title: string; onClose: () => void; actions?: React.ReactNode; footer?: React.ReactNode; children: React.ReactNode; name: string }) {
  const t = useTranslations("Docs");
  return <div className="flex h-full min-h-0 flex-col" data-docs-panel={name}>
    <div className="flex shrink-0 items-center justify-between gap-2 border-b px-4 py-3">
      <h2 className="min-w-0 truncate font-semibold">{title}</h2>
      <div className="flex items-center gap-1">{actions}<Button type="button" variant="ghost" size="icon" className="size-9" aria-label={t("closePanel")} onClick={onClose}><ChevronsRight aria-hidden="true" /></Button></div>
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    {footer && <div className="shrink-0 space-y-2 border-t p-3">{footer}</div>}
  </div>;
}
