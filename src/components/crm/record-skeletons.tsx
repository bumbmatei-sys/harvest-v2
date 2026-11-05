import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function ListSkeleton({ label }: { label: string }) {
  return <div role="status" aria-label={label} className="space-y-4">
    <div className="space-y-2"><Skeleton className="h-3 w-12" /><Skeleton className="h-8 w-40" /><Skeleton className="h-4 w-72 max-w-full" /></div>
    <div className="flex gap-2"><Skeleton className="h-9 flex-1" /><Skeleton className="h-9 w-20" /><Skeleton className="h-9 w-24" /></div>
    <Card className="gap-0 py-0">{Array.from({ length: 8 }, (_, row) => <div key={row} className="flex h-12 items-center gap-3 border-b px-4 last:border-b-0"><Skeleton className="size-8 rounded-full" /><Skeleton className="h-3 w-40" /><Skeleton className="ml-auto hidden h-3 w-32 sm:block" /><Skeleton className="hidden h-3 w-24 lg:block" /></div>)}</Card>
  </div>;
}
export function RecordSkeleton({ label }: { label: string }) {
  return <div role="status" aria-label={label} className="space-y-4">
    <div className="space-y-2"><Skeleton className="h-7 w-24" /><div className="flex items-center gap-3.5"><Skeleton className="size-12 rounded-full" /><div className="space-y-2"><Skeleton className="h-7 w-56" /><Skeleton className="h-3 w-32" /></div></div></div>
    <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.3fr)]"><div className="space-y-4"><Skeleton className="h-40 rounded-xl" /><Skeleton className="h-32 rounded-xl" /></div><div className="space-y-4"><Skeleton className="h-28 rounded-xl" /><Skeleton className="h-36 rounded-xl" /></div><Skeleton className="h-72 rounded-xl lg:col-span-2 2xl:col-span-1" /></div>
  </div>;
}
export function PeopleLoading() { const t = useTranslations("Crm"); return <ListSkeleton label={t("loadingPeople")} />; }
export function CompaniesLoading() { const t = useTranslations("Crm"); return <ListSkeleton label={t("loadingCompanies")} />; }
export function RecordLoading() { const t = useTranslations("Crm"); return <RecordSkeleton label={t("loadingRecord")} />; }
