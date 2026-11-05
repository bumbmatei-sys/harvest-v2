import { redirect } from "next/navigation";

export default async function LegacyContactPage({ params }: { params: Promise<{ tenantId: string; contactId: string }> }) {
  const { tenantId, contactId } = await params;
  redirect(`/workspaces/${encodeURIComponent(tenantId)}/crm/people/${encodeURIComponent(contactId)}`);
}
