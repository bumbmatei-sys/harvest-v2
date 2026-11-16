import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { HeartHandshake } from "lucide-react";
import { ZodError } from "zod";
import { getDb } from "@/db/client";
import { pageSession } from "@/server/page-session";
import { getWorkspace } from "@/server/workspaces";
import { listFollowUpCases } from "@/server/follow-up-cases";
import { listAssignableMembers } from "@/server/follow-up-members";
import { AccessError } from "@/server/permissions";
import { uuidInput } from "@/lib/contact-input";
import { canManageFollowUp, canOpenFollowUp, parseQueueQuery, queueTabs } from "@/lib/follow-up-ui";
import { AccessState } from "@/components/access-state";
import { FollowUpOpenButton } from "@/components/connect-admin/follow-up-open-button";
import { FollowUpQueue } from "@/components/connect-admin/follow-up-queue";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("FollowUp");
  return { title: t("pageTitle") };
}

/**
 * Follow-up queue. Owners and admins see every case; an assigned member sees only their own open cases (the database policy decides, not this
 * page); viewers see no queue at all. This screen only presents what the case API returns: ids, states and timestamps.
 */
export default async function FollowUpPage({ params, searchParams }: { params: Promise<{ tenantId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const t = await getTranslations("FollowUp");
  const session = await pageSession(), { tenantId } = await params;
  if (!uuidInput.safeParse(tenantId).success) return <AccessState />;
  const db = getDb();
  const workspace = await getWorkspace(db, session.user.id, tenantId).catch((error: unknown) => { if (error instanceof AccessError) return null; throw error; });
  if (!workspace || !canOpenFollowUp(workspace.role)) return <AccessState />;
  const query = parseQueueQuery(await searchParams, workspace.role);
  const ask = (cursor?: string) => listFollowUpCases(db, session.user.id, tenantId, { state: query.state === "all" ? undefined : query.state, cursor });
  const listing = await ask(query.cursor).then((page) => ({ page, cursor: query.cursor }), (error: unknown) => {
    if (error instanceof ZodError) return ask().then((page) => ({ page, cursor: undefined })); // a malformed cursor starts over
    throw error;
  }).catch((error: unknown) => { if (error instanceof AccessError) return null; throw error; });
  if (!listing) return <AccessState />;
  const members = await listAssignableMembers(db, session.user.id, tenantId).catch((error: unknown) => { if (error instanceof AccessError) return []; throw error; });
  const manage = canManageFollowUp(workspace.role);
  return <div className="space-y-4">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><div className="mb-1.5 flex items-center gap-2 text-xs text-muted-foreground"><HeartHandshake className="size-3.5" aria-hidden="true" />{t("area")}</div>
        <h1 className="text-[28px] font-semibold tracking-tight">{t("title")}</h1></div>
      {manage && <FollowUpOpenButton tenantId={tenantId} />}
    </div>
    <FollowUpQueue tenantId={tenantId} currentUserId={session.user.id} members={members} manage={manage} tabs={queueTabs(workspace.role)} state={query.state}
      nextCursor={listing.page.nextCursor} hasCursor={listing.cursor !== undefined}
      rows={listing.page.items.map((item) => ({ id: item.id, state: item.state, contactId: item.contactId, assigneeId: item.assigneeId, stateChangedAt: item.stateChangedAt.toISOString() }))} />
  </div>;
}
