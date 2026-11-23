import { redirect } from "next/navigation";

export default async function NewsletterIndex({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  redirect(`/workspaces/${encodeURIComponent(tenantId)}/newsletter/campaigns`);
}
