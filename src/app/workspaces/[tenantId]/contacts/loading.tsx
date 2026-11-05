import { useTranslations } from "next-intl";
import { Skeleton } from "@/components/ui/skeleton";
export default function LoadingContacts() {
  const t = useTranslations("AppWorkspacesContactsLoading"); return <div role="status" aria-label={t("loadingContacts")} className="space-y-6"><Skeleton className="h-9 w-40" /><Skeleton className="h-10 w-full" /><Skeleton className="h-64 w-full rounded-xl" /></div>; }
