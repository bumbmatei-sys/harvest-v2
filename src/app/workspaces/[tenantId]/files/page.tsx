import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { getAuth } from "@/server/auth-instance";
import { getDb } from "@/db/client";
import { listFiles } from "@/server/files/service";
import { withTenant } from "@/server/tenancy";
import { AccessError, can } from "@/server/permissions";
import { officeScreensEnabled } from "@/server/office-gate";
import { FilesScreen } from "@/components/files/files-screen";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("AppWorkspacesFilesPage");
  return { title: t("pageTitle") };
}

// The one Files screen: Harvest's own uploads (always) plus, for owners and admins while the non-production Office gate is open, the person's own connected drives.
// Drive listings are fetched by the browser from the Office routes; this page reads no drive content and changes nothing about uploads, scanning or roles.
export default async function FilesPage({ params }: { params: Promise<{ tenantId: string }> }) {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  const parsed = z.uuid().safeParse((await params).tenantId);
  if (!parsed.success) notFound();
  const tenantId = parsed.data;
  let access, files;
  try {
    [access, files] = await Promise.all([
      withTenant(getDb(), session.user.id, tenantId, "workspace:read", async (_tx, _id, role) => ({ canUpload: role === "owner" || role === "admin" || role === "member", officeEnabled: officeScreensEnabled() && can(role, "office:files") })),
      listFiles(getDb(), session.user.id, tenantId),
    ]);
  } catch (error) { if (error instanceof AccessError) notFound(); throw error; }
  return <FilesScreen tenantId={tenantId} files={files} canUpload={access.canUpload} officeEnabled={access.officeEnabled} />;
}
