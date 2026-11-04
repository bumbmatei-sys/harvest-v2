import Link from "next/link";
import { LockKeyhole, SearchX } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
export function AccessState({ missing = false, href = "/workspaces" }: { missing?: boolean; href?: string }) {
  return <Card><CardContent className="flex flex-col items-center gap-4 py-16 text-center">
    {missing ? <SearchX className="size-8 text-muted-foreground" aria-hidden="true" /> : <LockKeyhole className="size-8 text-muted-foreground" aria-hidden="true" />}
    <h1 className="text-xl font-semibold">{missing ? "Contact not found" : "Workspace access denied"}</h1>
    <p className="max-w-sm text-sm text-muted-foreground">{missing ? "This contact is not available in this workspace. Return to your contacts to continue." : "Your account doesn’t have access to this workspace. Choose a workspace you belong to."}</p>
    <Button variant="outline" asChild><Link href={href}>{missing ? "Back to contacts" : "Your workspaces"}</Link></Button>
  </CardContent></Card>;
}
