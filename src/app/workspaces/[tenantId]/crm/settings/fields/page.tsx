import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { SlidersHorizontal } from "lucide-react";
import { getDb } from "@/db/client";
import { pageSession } from "@/server/page-session";
import { getWorkspace } from "@/server/workspaces";
import { listFieldDefinitions } from "@/server/crm-fields";
import { AccessError, can } from "@/server/permissions";
import { uuidInput } from "@/lib/contact-input";
import type { ObjectType } from "@/lib/crm-fields";
import { AccessState } from "@/components/access-state";
import { FieldSettings } from "@/components/crm/field-settings";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Crm");
  return { title: t("pageTitle", { page: t("customFields") }) };
}

export default async function CrmFieldsPage({ params, searchParams }: { params: Promise<{ tenantId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const t = await getTranslations("Crm");
  const session = await pageSession(), { tenantId } = await params;
  if (!uuidInput.safeParse(tenantId).success) return <AccessState />;
  const object: ObjectType = (await searchParams).object === "company" ? "company" : "person";
  const db = getDb();
  const result = await Promise.all([getWorkspace(db, session.user.id, tenantId), listFieldDefinitions(db, session.user.id, tenantId, "person"), listFieldDefinitions(db, session.user.id, tenantId, "company")])
    .catch((error: unknown) => { if (error instanceof AccessError) return null; throw error; });
  if (!result) return <AccessState />;
  const [workspace, people, companies] = result, writable = can(workspace.role, "crm:fields_write");
  const toSettings = (list: typeof people) => list.map((field) => ({ id: field.id, key: field.key, label: field.label, description: field.description, type: field.type, required: field.required, options: field.options, relationTarget: field.relationTarget, archived: !!field.archivedAt, version: field.version }));
  return <div className="space-y-4">
    <div><div className="mb-1.5 flex items-center gap-2 text-xs text-muted-foreground"><SlidersHorizontal className="size-3.5" aria-hidden="true" />{t("crm")}</div>
      <h1 className="text-[28px] font-semibold tracking-tight">{t("customFields")}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t("customFieldsDescription")}</p></div>
    {!writable && <Alert><AlertDescription>{t("viewOnlyFields")}</AlertDescription></Alert>}
    <Tabs defaultValue={object} className="gap-3">
      <TabsList><TabsTrigger value="person">{t("people")}</TabsTrigger><TabsTrigger value="company">{t("companies")}</TabsTrigger></TabsList>
      <TabsContent value="person"><FieldSettings tenantId={tenantId} objectType="person" fields={toSettings(people)} writable={writable} /></TabsContent>
      <TabsContent value="company"><FieldSettings tenantId={tenantId} objectType="company" fields={toSettings(companies)} writable={writable} /></TabsContent>
    </Tabs>
  </div>;
}
