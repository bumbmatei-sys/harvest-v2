import { AccessState } from "@/components/access-state";
import { AutoDmBoard } from "@/components/social/auto-dm/auto-dm-board";
import { autoDmPageContext } from "@/server/social-auto-dm-page";

type Props = { params: Promise<{ tenantId: string }> };

// Social Auto-DM screen. 404 before any session work while the non-production gate is closed; owner and admin only; the data comes from the Auto-DM routes.
export default async function AutoDmPage({ params }: Props) {
  const context = await autoDmPageContext(params);
  return context ? <AutoDmBoard tenantId={context.tenantId} /> : <AccessState />;
}
