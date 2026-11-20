import { getDb } from "@/db/client";
import { pageSession } from "@/server/page-session";
import { getWorkspace } from "@/server/workspaces";
import { requireSocialScreens } from "@/server/social-publish-gate";
import { AccessError, can } from "@/server/permissions";
import { uuidInput } from "@/lib/contact-input";
import { AccessState } from "@/components/access-state";
import { Composer } from "@/components/social/composer";

type Props = { params: Promise<{ tenantId: string }>; searchParams: Promise<{ draft?: string }> };

// Social Publish screen. 404 before any session work while the non-production gate is closed; owner and admin only; the data comes from the Publish routes.
export default async function ComposePage({ params, searchParams }: Props) {
  requireSocialScreens();
  const session = await pageSession(), { tenantId } = await params;
  if (!uuidInput.safeParse(tenantId).success) return <AccessState />;
  const workspace = await getWorkspace(getDb(), session.user.id, tenantId).catch((error: unknown) => { if (error instanceof AccessError) return null; throw error; });
  if (!workspace || !can(workspace.role, "social:schedule")) return <AccessState />;
  const draft = (await searchParams).draft;
  return <Composer tenantId={tenantId} initialDraftId={draft && uuidInput.safeParse(draft).success ? draft : null} />;
}
