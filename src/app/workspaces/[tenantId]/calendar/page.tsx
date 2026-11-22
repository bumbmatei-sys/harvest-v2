import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { getDb } from "@/db/client";
import { pageSession } from "@/server/page-session";
import { getWorkspace } from "@/server/workspaces";
import { requireOfficeScreens } from "@/server/office-gate";
import { socialPublishGateOpen } from "@/server/social-publish-gate";
import { AccessError, can } from "@/server/permissions";
import { uuidInput } from "@/lib/contact-input";
import { AccessState } from "@/components/access-state";
import { OfficeCalendar } from "@/components/office/calendar/calendar";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("OfficeCalendar");
  return { title: t("pageTitle") };
}

// Office Calendar screen. 404 before any session work while the non-production Office gate is closed; owner and admin only (neutral answer for everyone else).
// Events are fetched by the browser from the Office routes for the signed-in person's own connection; this page reads no calendar content.
// The social overlay is offered only to people who may use the social planner while its own gate is open.
export default async function CalendarPage({ params }: { params: Promise<{ tenantId: string }> }) {
  requireOfficeScreens();
  const session = await pageSession(), { tenantId } = await params;
  if (!uuidInput.safeParse(tenantId).success) return <AccessState />;
  const workspace = await getWorkspace(getDb(), session.user.id, tenantId).catch((error: unknown) => { if (error instanceof AccessError) return null; throw error; });
  if (!workspace || !can(workspace.role, "office:calendar")) return <AccessState />;
  return <OfficeCalendar tenantId={tenantId} socialOverlay={socialPublishGateOpen() && can(workspace.role, "social:schedule")} />;
}
