"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Link2, UserRound, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { RecordPicker, type PickerItem } from "@/components/crm/record-picker";

/**
 * Link a thread to a CRM person: an explicit reference to an existing, visible contact. Linking creates no contact and records no consent. The name is read
 * from the contact record so the chip stays accurate after a rename; the picker is the same server-searched one the CRM uses.
 */
export function PersonLink({ tenantId, contactId, busy, onLink, onUnlink }: {
  tenantId: string; contactId: string | null; busy: boolean; onLink: (item: PickerItem) => Promise<string | null>; onUnlink: () => void;
}) {
  const t = useTranslations("OfficeMail.person");
  const [names, setNames] = useState<Record<string, string>>({});
  const name = contactId ? names[contactId] : undefined;
  useEffect(() => {
    if (!contactId || names[contactId] !== undefined) return;
    const controller = new AbortController();
    fetch(`/api/workspaces/${tenantId}/contacts/${contactId}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => response.ok ? (await response.json() as { name?: string }).name ?? "" : "")
      .then((value) => setNames((current) => ({ ...current, [contactId]: value })), () => undefined);
    return () => controller.abort();
  }, [tenantId, contactId, names]);

  if (contactId) {
    const label = name || t("unknown");
    return <span className="inline-flex min-h-11 items-center gap-1 rounded-md border bg-card pl-2.5 lg:min-h-9" data-testid="person-chip">
      <UserRound className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <Link href={`/workspaces/${tenantId}/crm/people/${contactId}`} prefetch={false} className="max-w-48 truncate text-sm font-medium underline-offset-2 hover:underline" aria-label={t("open", { name: label })}>{t("linked", { name: label })}</Link>
      <Button type="button" variant="ghost" size="icon-responsive" disabled={busy} aria-label={t("unlink")} onClick={onUnlink} data-testid="person-unlink"><X aria-hidden="true" /></Button>
    </span>;
  }
  return <RecordPicker endpoint={`/api/workspaces/${tenantId}/contacts`} toItem={(row) => ({ id: String(row.id), label: String(row.name) })}
    title={t("searchTitle")} placeholder={t("search")} emptyLabel={t("none")}
    onSelect={async (item) => { const failure = await onLink(item); if (!failure) setNames((current) => ({ ...current, [item.id]: item.label })); return failure; }}
    trigger={<Button type="button" variant="outline" size="responsive" disabled={busy} data-testid="person-link"><Link2 aria-hidden="true" />{t("link")}</Button>} />;
}
