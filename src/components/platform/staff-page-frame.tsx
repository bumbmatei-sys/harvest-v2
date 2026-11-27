import { Wheat } from "lucide-react";
import { Badge } from "@/components/ui/badge";

/** The Harvest staff page frame (no ministry shell): title, the open-report badge (in-app only, no email) and the staff role. Shared by the staff review pages. */
export function StaffPageFrame({ title, skip, role, openBadge, openMarker, children }: { title: string; skip: string; role: string; openBadge: string | null;
  openMarker?: Record<string, string>; children: React.ReactNode }) {
  return <div className="min-h-dvh bg-background pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)]">
    <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-card focus:p-3">{skip}</a>
    <header className="border-b">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 lg:px-6">
        <p className="flex items-center gap-2 text-base font-semibold"><Wheat className="size-6" aria-hidden="true" />{title}</p>
        <span className="flex flex-wrap items-center gap-2">
          {openBadge && <Badge {...openMarker}>{openBadge}</Badge>}
          <Badge variant="outline">{role}</Badge></span>
      </div>
    </header>
    <main id="main-content" tabIndex={-1} className="space-y-6 px-4 py-6 outline-none lg:px-6">
      <h1 className="text-[28px] font-semibold tracking-tight">{title}</h1>
      {children}
    </main>
  </div>;
}
