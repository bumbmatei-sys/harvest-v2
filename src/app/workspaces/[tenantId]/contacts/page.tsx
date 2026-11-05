import { redirect } from "next/navigation";

// Contacts moved to the CRM People route (companion PRD section 5). Preserve the view query.
export default async function LegacyContactsPage({ params, searchParams }: { params: Promise<{ tenantId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { tenantId } = await params, query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) if (typeof value === "string") query.set(key, value);
  const suffix = query.toString();
  redirect(`/workspaces/${encodeURIComponent(tenantId)}/crm/people${suffix ? `?${suffix}` : ""}`);
}
