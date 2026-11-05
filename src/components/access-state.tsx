import { useTranslations } from "next-intl";
import Link from "next/link";
import { LockKeyhole, SearchX } from "lucide-react";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent } from "@/components/ui/empty";
import { Button } from "@/components/ui/button";
export function AccessState({ missing = false, href = "/workspaces" }: { missing?: boolean; href?: string }) {
  const t = useTranslations("ComponentsAccessState");
  return <Empty className="border border-solid bg-card py-16"><EmptyHeader>
    <EmptyMedia variant="icon">{missing ? <SearchX aria-hidden="true" /> : <LockKeyhole aria-hidden="true" />}</EmptyMedia>
    <EmptyTitle><h1>{missing ? t("contactNotFound") : t("workspaceAccessDenied")}</h1></EmptyTitle>
    <EmptyDescription>{missing ? t("thisContactIsNotAvailableInThisWorkspace") : t("yourAccountDoesnTHaveAccessToThis")}</EmptyDescription>
    </EmptyHeader><EmptyContent><Button variant="outline" asChild><Link href={href}>{missing ? t("backToContacts") : t("yourWorkspaces")}</Link></Button></EmptyContent>
  </Empty>;
}
