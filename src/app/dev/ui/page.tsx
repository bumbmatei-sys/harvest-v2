import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { pageSession } from "@/server/page-session";
import { uiShowcaseEnabled } from "@/lib/ui-showcase";
import { AppShell } from "@/components/app-shell";
import { UiShowcase } from "@/components/dev/ui-showcase";

export const dynamic = "force-dynamic";
export default async function UiShowcasePage() {
  if (!uiShowcaseEnabled(process.env.NODE_ENV, process.env.HARVEST_UI_SHOWCASE)) notFound();
  const session = await pageSession();
  return <AppShell email={session.user.email} workspaces={[]} defaultOpen={(await cookies()).get("sidebar_state")?.value !== "false"}><UiShowcase /></AppShell>;
}
