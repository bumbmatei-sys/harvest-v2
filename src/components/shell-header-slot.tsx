"use client";
import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

const slotId = "shell-header-page";
const none = () => () => {};
/** The element a page fills in the shell's header bar (breadcrumb continuation, status, actions). Rendered once by AppShell, after its own breadcrumb. */
export function ShellHeaderSlot() { return <div id={slotId} data-shell-header-page className="flex min-w-0 flex-1 items-center gap-1" />; }
/** Portals page content into the header slot. Renders nothing until the shell header exists (and on the server). */
export function ShellHeaderPortal({ children }: { children: React.ReactNode }) {
  const target = useSyncExternalStore(none, () => document.getElementById(slotId), () => null);
  return target ? createPortal(children, target) : null;
}
