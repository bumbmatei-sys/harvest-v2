"use client";
import { createContext, useContext, useRef, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { stateToParams, type ViewState } from "@/lib/crm-fields";

type ListContextValue = {
  state: ViewState; viewId: string | null; pending: boolean;
  /** Navigate to a new state. The URL stays the source of truth; page resets to 1. */
  navigate: (next: Partial<ViewState>, options?: { view?: string | null; page?: number }) => void;
};
const ListContext = createContext<ListContextValue | null>(null);
export function useListState() { const value = useContext(ListContext); if (!value) throw new Error("LIST_STATE_REQUIRED"); return value; }

export function ListState({ state, viewId, children }: { state: ViewState; viewId: string | null; children: React.ReactNode }) {
  const router = useRouter(), pathname = usePathname();
  const [pending, startTransition] = useTransition();
  // While a navigation is in flight, build on the state it is heading to (CRM-02 fix):
  // a quick second change must not resurrect filters from the state still on screen.
  const inFlight = useRef<{ state: ViewState; view: string | null } | null>(null);
  function navigate(next: Partial<ViewState>, options: { view?: string | null; page?: number } = {}) {
    const base = pending && inFlight.current ? inFlight.current : { state, view: viewId };
    const merged = { ...base.state, ...next }, view = options.view === undefined ? base.view : options.view;
    inFlight.current = { state: merged, view };
    const params = stateToParams(merged, view);
    if (options.page && options.page > 1) params.set("page", String(options.page));
    const query = params.toString();
    startTransition(() => router.push(query ? `${pathname}?${query}` : pathname));
  }
  return <ListContext.Provider value={{ state, viewId, pending, navigate }}>{children}</ListContext.Provider>;
}
export function ListResults({ children }: { children: React.ReactNode }) {
  const { pending } = useListState();
  return <div aria-busy={pending} className={cn("transition-opacity duration-200", pending && "opacity-60")}>{children}</div>;
}
