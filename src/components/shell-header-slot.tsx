"use client";
import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { ChevronRight } from "lucide-react";

const slotId = "shell-header-page";
const none = () => () => {};
/** The element a page fills in the shell's header bar (breadcrumb continuation, status, actions). Rendered once by AppShell, after its own breadcrumb. */
export function ShellHeaderSlot() { return <div id={slotId} data-shell-header-page className="flex min-w-0 flex-1 items-center gap-1" />; }
/** Portals page content into the header slot. Renders nothing until the shell header exists (and on the server). */
export function ShellHeaderPortal({ children }: { children: React.ReactNode }) {
  const target = useSyncExternalStore(none, () => document.getElementById(slotId), () => null);
  return target ? createPortal(children, target) : null;
}

/**
 * What an editor puts in the header bar (shared, see EditorShell `headerInShell`): the item's title continuing the shell breadcrumb ("Ministry › Section ›
 * Title"), a small status badge from 640px, and the page's actions at the end of the bar, just before the notifications. The title truncates; on a phone
 * the actions keep their 44px targets and the title gives way first.
 */
export function ShellHeaderTrail({ title, status, actions }: { title: string; status?: React.ReactNode; actions?: React.ReactNode }) {
  return <div className="flex min-w-0 flex-1 items-center gap-2" data-shell-header-trail>
    <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
    <span className="min-w-0 truncate text-[13px] font-medium" data-shell-header-title>{title}</span>
    {status && <span className="hidden shrink-0 sm:inline-flex">{status}</span>}
    {actions && <div className="ms-auto flex shrink-0 items-center gap-2" data-shell-header-page-actions>{actions}</div>}
  </div>;
}
