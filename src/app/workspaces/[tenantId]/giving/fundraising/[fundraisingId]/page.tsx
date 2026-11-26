import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getDb } from "@/db/client";
import { pageSession } from "@/server/page-session";
import { getWorkspace } from "@/server/workspaces";
import { fundraisingEnabled, getFundraising, listGifts, listPledges } from "@/server/fundraising";
import { AccessError, can } from "@/server/permissions";
import { uuidInput } from "@/lib/contact-input";
import { AccessState } from "@/components/access-state";
import { FundraisingDetail } from "@/components/fundraising/fundraising-detail";

export async function generateMetadata() { return { title: (await getTranslations("Fundraising"))("metaTitle") }; }

// One fundraising campaign: goal, raised and progress; owners and admins also see and record pledges and gifts (each read is audited).
export default async function FundraisingDetailPage({ params }: { params: Promise<{ tenantId: string; fundraisingId: string }> }) {
  if (!fundraisingEnabled()) notFound();
  const session = await pageSession(), { tenantId, fundraisingId } = await params;
  if (!uuidInput.safeParse(tenantId).success || !uuidInput.safeParse(fundraisingId).success) return <AccessState />;
  const db = getDb(), denied = (error: unknown) => { if (error instanceof AccessError) return null; throw error; };
  const workspace = await getWorkspace(db, session.user.id, tenantId).catch(denied);
  if (!workspace || !can(workspace.role, "fundraising:read")) return <AccessState />;
  const row = await getFundraising(db, session.user.id, tenantId, fundraisingId).catch(denied);
  if (!row) notFound();
  const records = can(workspace.role, "giving:read_donors");
  const [pledges, gifts] = records ? await Promise.all([listPledges(db, session.user.id, tenantId, fundraisingId), listGifts(db, session.user.id, tenantId, fundraisingId)]) : [null, null];
  return <FundraisingDetail tenantId={tenantId} row={row} pledges={pledges} gifts={gifts}
    can={{ manage: can(workspace.role, "fundraising:manage"), publish: can(workspace.role, "fundraising:publish"), record: can(workspace.role, "giving:record"), correct: can(workspace.role, "giving:correct") }} />;
}
