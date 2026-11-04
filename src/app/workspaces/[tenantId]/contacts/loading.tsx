import { Skeleton } from "@/components/ui/skeleton";
export default function LoadingContacts() { return <div role="status" aria-label="Loading contacts" className="space-y-6"><Skeleton className="h-9 w-40" /><Skeleton className="h-10 w-full" /><Skeleton className="h-64 w-full rounded-xl" /></div>; }
