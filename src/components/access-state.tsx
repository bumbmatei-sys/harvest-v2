import Link from "next/link";
import { LockKeyhole, SearchX } from "lucide-react";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent } from "@/components/ui/empty";
import { Button } from "@/components/ui/button";
export function AccessState({ missing = false, href = "/workspaces" }: { missing?: boolean; href?: string }) {
  return <Empty className="border border-solid bg-card py-16"><EmptyHeader>
    <EmptyMedia variant="icon">{missing ? <SearchX aria-hidden="true" /> : <LockKeyhole aria-hidden="true" />}</EmptyMedia>
    <EmptyTitle><h1>{missing ? "Contact not found" : "Workspace access denied"}</h1></EmptyTitle>
    <EmptyDescription>{missing ? "This contact is not available in this workspace. Return to your contacts to continue." : "Your account doesn’t have access to this workspace. Choose a workspace you belong to."}</EmptyDescription>
    </EmptyHeader><EmptyContent><Button variant="outline" asChild><Link href={href}>{missing ? "Back to contacts" : "Your workspaces"}</Link></Button></EmptyContent>
  </Empty>;
}
