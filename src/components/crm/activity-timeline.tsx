import { useFormatter, useTranslations } from "next-intl";
import Link from "next/link";
import { Building2, History, Link2, Link2Off, PencilLine, ShieldCheck, Sparkles } from "lucide-react";
import type { ActivityItem } from "@/server/activity";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";

const fieldKeys = ["name", "notes", "email", "phone", "social", "domain", "description", "title", "primary"] as const;
type FieldKey = typeof fieldKeys[number];
const icons = { "contact.create": Sparkles, "company.create": Sparkles, "contact.update": PencilLine, "company.update": PencilLine,
  "contact.company_link": Link2, "contact.company_link_update": Building2, "contact.company_unlink": Link2Off, "contact.consent_record": ShieldCheck } as const;

/**
 * A chronological, read-only view of the audit ledger for one record. It shows what
 * changed (field names) and who did it, never the old or new personal values.
 */
export function ActivityTimeline({ items, tenantId, subject, currentUserId, customLabels = {} }: { items: ActivityItem[]; tenantId: string; subject: "person" | "company"; currentUserId: string; customLabels?: Record<string, string> }) {
  const t = useTranslations("Crm");
  const labels = useTranslations("ConsentLabels");
  const format = useFormatter();
  if (!items.length) return <Empty className="p-3 py-6 md:p-3"><EmptyHeader><EmptyMedia variant="icon"><History aria-hidden="true" /></EmptyMedia><EmptyTitle className="text-sm">{t("noActivityYet")}</EmptyTitle><EmptyDescription>{t("changesWillAppearHere")}</EmptyDescription></EmptyHeader></Empty>;
  // Custom fields are logged as cf:<key>; an archived or unknown key reads as "a custom field".
  const fieldName = (field: string) => field.startsWith("cf:") ? customLabels[field.slice(3)] ?? t("aCustomField") : (fieldKeys as readonly string[]).includes(field) ? t(`fields.${field as FieldKey}`) : null;
  const fields = (list: string[]) => format.list([...new Set(list.map(fieldName).filter((name): name is string => !!name))], { type: "conjunction" });
  const companyLink = (item: ActivityItem) => item.company ? <Link className="font-medium text-foreground hover:underline" href={`/workspaces/${tenantId}/crm/companies/${item.company.id}`}>{item.company.name}</Link> : <span>{t("aCompany")}</span>;
  const personLink = (item: ActivityItem) => item.contact ? <Link className="font-medium text-foreground hover:underline" href={`/workspaces/${tenantId}/crm/people/${item.contact.id}`}>{item.contact.name}</Link> : <span>{t("aPerson")}</span>;
  const target = (item: ActivityItem) => subject === "person" ? companyLink(item) : personLink(item);
  function sentence(item: ActivityItem) {
    switch (item.action) {
      case "contact.create": return t("activity.createdPerson");
      case "company.create": return t("activity.createdCompany");
      case "contact.update": case "company.update": return item.fields.length ? t("activity.updatedFields", { fields: fields(item.fields) }) : t("activity.updatedDetails");
      case "contact.company_link": return t.rich(subject === "person" ? "activity.linkedCompany" : "activity.linkedPerson", { target: () => target(item) });
      case "contact.company_unlink": return t.rich(subject === "person" ? "activity.unlinkedCompany" : "activity.unlinkedPerson", { target: () => target(item) });
      case "contact.company_link_update": return t.rich(item.fields.includes("primary") ? (subject === "person" ? "activity.madePrimary" : "activity.madePrimaryForPerson") : (subject === "person" ? "activity.updatedRole" : "activity.updatedRoleForPerson"), { target: () => target(item) });
      case "contact.consent_record": return item.channel && item.status && ["email", "sms", "social"].includes(item.channel) && ["granted", "withdrawn", "unknown"].includes(item.status)
        ? t("activity.recordedConsent", { channel: labels(item.channel as "email"), status: labels(item.status as "granted") }) : t("activity.recordedConsentGeneric");
    }
  }
  return <ol className="relative space-y-0">
    {items.map((item, index) => {
      const Icon = icons[item.action] ?? History;
      const actor = item.actor.id === currentUserId ? t("you") : item.actor.isMember ? (item.actor.name ?? t("aWorkspaceMember")) : t("aFormerMember");
      return <li key={item.id} className="relative flex gap-3 pb-5 last:pb-0">
        {index < items.length - 1 && <span aria-hidden="true" className="absolute top-8 bottom-0 left-[15px] w-px bg-border" />}
        <span className="relative flex size-8 shrink-0 items-center justify-center rounded-full border bg-card text-muted-foreground"><Icon aria-hidden="true" className="size-3.5" /></span>
        <div className="min-w-0 pt-1.5 text-sm">
          <p className="text-muted-foreground"><span className="font-medium text-foreground">{actor}</span> {sentence(item)}</p>
          <time className="mt-0.5 block text-xs text-muted-foreground" dateTime={item.createdAt.toISOString()}>{format.dateTime(item.createdAt, "dateTime")}</time>
        </div>
      </li>;
    })}
  </ol>;
}
