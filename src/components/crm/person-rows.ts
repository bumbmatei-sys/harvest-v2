import type { getFormatter, getTranslations } from "next-intl/server";
import { customFieldKey } from "@/lib/crm-fields";
import { consentTone } from "@/lib/crm-consent-tone";
import { mailtoHref, telHref } from "@/lib/copy-text";
import type { listContacts } from "@/server/contacts";
import { customCell } from "./list-parts";
import type { GridRow } from "./record-grid";

type List = Awaited<ReturnType<typeof listContacts>>;

/** People list rows for the grid. Shared by CRM People and the newsletter Audience lens, so a person reads the same in both. */
export function personRows({ t, format, tenantId, list, sourceAccess }: {
  t: Awaited<ReturnType<typeof getTranslations<"Crm">>>; format: Awaited<ReturnType<typeof getFormatter>>; tenantId: string; list: List; sourceAccess: boolean;
}): GridRow[] {
  const people = `/workspaces/${tenantId}/crm/people`, companies = `/workspaces/${tenantId}/crm/companies`;
  return list.rows.map((person) => {
    const email = person.identifiers.find((item) => item.kind === "email")?.value, phone = person.identifiers.find((item) => item.kind === "phone")?.value;
    const [primary, ...others] = person.companies;
    const cells: GridRow["cells"] = {
      company: primary ? { text: primary.name, href: `${companies}/${primary.companyId}`, more: others.length, title: [primary, ...others].map((item) => item.name).join(", ") } : { text: t("noCompany"), muted: true },
      email: { text: email ?? t("notProvided"), muted: true, edit: { kind: "email", value: email ?? "", target: "builtin", field: "email", maxLength: 254 } },
      phone: { text: phone ?? t("notProvided"), muted: true, edit: { kind: "tel", value: phone ?? "", target: "builtin", field: "phone", maxLength: 40 } },
      marketing: { text: t(`marketing.${person.marketingEmail}`), badge: person.marketingEmail },
      ...(sourceAccess ? {source: {text: person.sourceKinds?.length ? person.sourceKinds.map(kind => t(`sourceHistory.${kind}`)).join(", ") : t("sourceHistory.unknown"), muted: true}} : {}),
      created: { text: format.dateTime(person.createdAt, "date"), muted: true },
      updated: { text: format.dateTime(person.updatedAt, "date"), muted: true },
    };
    for (const field of list.definitions) cells[customFieldKey(field.key)] = customCell(t, format, tenantId, field, person.custom[field.key], list.related);
    return { id: person.id, version: person.version, name: person.name, href: `${people}/${person.id}`, secondary: primary?.name ?? email ?? t("notProvided"), cells,
      summary: { status: { text: t(`marketing.${person.marketingEmail}`), tone: consentTone(person.marketingEmail) },
        links: [...(email ? [{ kind: "email" as const, text: email, href: mailtoHref(email) }] : []), ...(phone && telHref(phone) ? [{ kind: "phone" as const, text: phone, href: telHref(phone)! }] : [])] } };
  });
}
