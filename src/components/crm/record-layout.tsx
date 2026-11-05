import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/** The back link sits at the content's left edge, directly under the shell breadcrumb. */
export function RecordBackLink({ href, label }: { href: string; label: string }) {
  return <Button asChild variant="ghost" size="sm" className="-ml-2.5 h-7 gap-1.5 px-2.5 has-[>svg]:px-2.5 text-muted-foreground"><Link href={href}><ArrowLeft aria-hidden="true" />{label}</Link></Button>;
}
export function RecordHeader({ back, children }: { back: React.ReactNode; children: React.ReactNode }) {
  return <div className="space-y-2">{back}<div className="flex flex-wrap items-center justify-between gap-3">{children}</div></div>;
}
/**
 * Shared record-page workspace. Phones stack profile → context → history. From lg,
 * profile and context sit side by side with history as a full-width row; from 2xl
 * (1536px, where each column still fits identifiers unbroken) the three regions
 * form columns, using the whole content width.
 */
export function RecordGrid({ profile, context, history, contextWide = false }: { profile: React.ReactNode; context: React.ReactNode; history: React.ReactNode; contextWide?: boolean }) {
  return <div className={cn("grid items-start gap-4 lg:grid-cols-2", contextWide ? "2xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)_minmax(0,1.1fr)]" : "2xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.3fr)]")}>
    <div data-record-region="profile" className="min-w-0 space-y-4">{profile}</div>
    <div data-record-region="context" className="min-w-0 space-y-4">{context}</div>
    <div data-record-region="history" className="min-w-0 space-y-4 lg:col-span-2 2xl:col-span-1">{history}</div>
  </div>;
}
