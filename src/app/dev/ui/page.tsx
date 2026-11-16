import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { pageSession } from "@/server/page-session";
import { uiShowcaseEnabled } from "@/lib/ui-showcase";
import { AppShell } from "@/components/app-shell";
import { UiShowcase } from "@/components/dev/ui-showcase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const dynamic = "force-dynamic";
export default async function UiShowcasePage() {
  if (!uiShowcaseEnabled(process.env.NODE_ENV, process.env.HARVEST_UI_SHOWCASE)) notFound();
  const session = await pageSession(), t = await getTranslations("UiShowcase.shell");
  // The header slots have no production consumer yet; this development-only page exercises them.
  const header = {
    search: <Input type="search" aria-label={t("searchLabel")} placeholder={t("searchPlaceholder")} className="h-11 lg:h-9" />,
    actions: <Button asChild variant="outline" size="responsive"><Link href="#shell">{t("action")}</Link></Button>,
  };
  return <AppShell email={session.user.email} workspaces={[]} header={header} defaultOpen={(await cookies()).get("sidebar_state")?.value !== "false"}><UiShowcase /></AppShell>;
}
