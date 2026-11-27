"use client";
import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { ChevronRight } from "lucide-react";

const slotId = "shell-header-page";
const none = () => () => {};
/** The element a page fills in the shell's header bar (breadcrumb continuation, status, actions). Rendered once by AppShell, after its own breadcrumb. It never shrinks below its content, so the shell breadcrumb truncates first and page actions are never overlapped. */
export function ShellHeaderSlot() { return <div id={slotId} data-shell-header-page className="flex min-w-min flex-1 items-center gap-1" />; }
/** Portals page content into the header slot. Renders nothing until the shell header exists (and on the server). */
export function ShellHeaderPortal({ children }: { children: React.ReactNode }) {
  const target = useSyncExternalStore(none, () => document.getElementById(slotId), () => null);
  return target ? createPortal(children, target) : null;
}

/**
 * What an editor puts in the header bar (shared, see EditorShell `headerInShell`): the item's title continuing the shell breadcrumb ("Ministry › Section ›
 * Title"), a small status badge from 640px, and the page's actions at the end of the bar, just before the notifications. The title truncates; on a phone
 * the title is left to screen readers so the actions keep their 44px targets.
 */
export function ShellHeaderTrail({ title, status, actions }: { title: string; status?: React.ReactNode; actions?: React.ReactNode }) {
  return <div className="flex min-w-0 flex-1 items-center gap-2" data-shell-header-trail>
    <ChevronRight className="size-3.5 shrink-0 text-muted-foreground max-sm:hidden" aria-hidden="true" />
    <span className="w-0 min-w-0 flex-1 basis-0 truncate text-[13px] font-medium max-sm:sr-only" data-shell-header-title>{title}</span>
    {status && <span className="hidden shrink-0 sm:inline-flex">{status}</span>}
    {actions && <div className="ms-auto flex shrink-0 items-center gap-2" data-shell-header-page-actions>{actions}</div>}
  </div>;
}
