/** Layout and behaviour modelled on bumbmatei-sys/admin-dashboard (Shadcn UI Kit, premium, founder-supplied): app/dashboard/(auth)/apps/mail/components/mail.tsx (three panes, one pane at a time on phones); code written for Harvest, no kit code copied. Harvest notes: docs/ui-sources.md. */
"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

/** Item style shared by the folder panels of every inbox (44px on touch screens, 36px from 1024px). */
export const inboxNavItem = "flex min-h-11 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-sm outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 lg:min-h-9";

/** List pane collapse state with its focus rule: after a toggle, focus lands on the control that is now visible. Never moves focus on first render. */
export function useCollapsibleList() {
  const [listOpen, setListOpen] = useState(true), listToggle = useRef<HTMLButtonElement>(null), reopen = useRef<HTMLButtonElement>(null), toggled = useRef(false);
  useEffect(() => { if (!toggled.current) return; (listOpen ? listToggle : reopen).current?.focus(); }, [listOpen]);
  const toggleList = (open: boolean) => { toggled.current = true; setListOpen(open); };
  return { listOpen, toggleList, listToggle, reopen };
}

/**
 * The one inbox frame (Social inbox and Office mail): a bordered card holding a folder pane, the list pane and the thread pane. Three panes from 1280px,
 * list and thread from 768px, one pane at a time on phones (the thread replaces the list while `selected`). The folder pane is the shell's contextual sidebar
 * when `hosted` (portalled into `slot`); otherwise it stays inline from 1280px and opens in a sheet below that. Each module owns its own data, copy and
 * permissions; this frame owns only the layout and the pane switching.
 */
export function InboxFrame({ testId = "inbox", hosted, slot, filterPane, labels, paneOpen, onPaneOpenChange, selected, listOpen, list, thread, reopenBar }: {
  testId?: string; hosted: boolean; slot: HTMLElement | null; filterPane: React.ReactNode;
  labels: { filters: string; filtersDescription: string; thread: string };
  paneOpen: boolean; onPaneOpenChange: (open: boolean) => void;
  /** True while a conversation is open: on phones the list hides. */
  selected: boolean; listOpen: boolean; list: React.ReactNode; thread: React.ReactNode;
  /** Shown above the thread while the list is collapsed (768px and up). */
  reopenBar?: React.ReactNode;
}) {
  return <>
    <div className="flex flex-col overflow-hidden rounded-xl border bg-card md:h-[calc(100dvh-11.5rem)] md:min-h-[32rem] md:flex-row" data-testid={testId}>
      {hosted ? slot && createPortal(filterPane, slot)
        : <aside className="hidden overflow-y-auto border-r xl:block xl:w-64 xl:shrink-0" aria-label={labels.filters}>{filterPane}</aside>}
      <div id="inbox-list-pane" className={`min-h-0 min-w-0 flex-col md:w-[22rem] md:shrink-0 md:border-r xl:w-[24rem] ${selected ? "hidden" : "flex"} ${listOpen ? "md:flex" : "md:hidden"}`}>{list}</div>
      <section className={`min-h-0 min-w-0 flex-1 flex-col ${selected ? "flex" : "hidden md:flex"}`} aria-label={labels.thread} data-testid="thread-pane">
        {!listOpen && reopenBar && <div className="hidden border-b p-2 md:block">{reopenBar}</div>}
        {thread}
      </section>
    </div>
    {!hosted && <Sheet open={paneOpen} onOpenChange={onPaneOpenChange}>
      <SheetContent side="left" className="w-[min(20rem,90vw)] overflow-y-auto p-0 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)]">
        <SheetHeader><SheetTitle>{labels.filters}</SheetTitle><SheetDescription className="sr-only">{labels.filtersDescription}</SheetDescription></SheetHeader>
        {filterPane}
      </SheetContent>
    </Sheet>}
  </>;
}
