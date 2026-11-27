/** Layout and behaviour modelled on bumbmatei-sys/chat-app (Shadcn UI Kit, premium, founder-supplied 19 Nov 2026): components/settings-dialog.tsx; code written for Harvest, no kit code copied. Harvest notes: docs/ui-sources.md. */
"use client";
import { useCallback, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { SettingsSection, SettingsSectionId } from "@/lib/settings-sections";
import { SettingsNav } from "@/components/settings/settings-nav";
import type { SettingsShell } from "@/components/settings/settings-host";
import { AccountPanel, ConnectionsPanel, CrmPanel, MinistryPanel } from "@/components/settings/settings-panels";
import { ProfilePanel } from "@/components/settings/profile-panel";

type Props = {
  open: boolean; section: SettingsSectionId | null; sections: readonly SettingsSection[]; shell: SettingsShell;
  onSection: (section: SettingsSectionId) => void; onClose: () => void; onCloseAutoFocus: (event: Event) => void;
};

/**
 * The Settings pop-up: a section list beside the content on desktop; a full-screen sheet below 768px with the list as a scrollable tab row on top.
 * Radix traps focus and closes on Escape; the section list (SettingsNav) handles the arrow keys.
 */
export function SettingsDialog({ open, section, sections, shell, onSection, onClose, onCloseAutoFocus }: Props) {
  const t = useTranslations("SettingsDialog"), headingId = `${useId()}-heading`;
  // Unsaved edits in a panel: closing the pop-up or opening another section first asks, so a stray Escape or click cannot drop them.
  // The flag lives in a ref as well as state: a panel reports it from an effect, so a key press right after typing (Escape) must still see the edit, not last render's value.
  const dirtyRef = useRef(false), [pending, setPending] = useState<(() => void) | null>(null);
  const setDirty = useCallback((next: boolean) => { dirtyRef.current = next; }, []);
  const guard = useCallback((proceed: () => void) => { if (dirtyRef.current) setPending(() => proceed); else proceed(); }, []);
  return <Dialog open={open} onOpenChange={(next) => { if (!next) guard(onClose); }}>
    <DialogContent data-settings-dialog onCloseAutoFocus={onCloseAutoFocus}
      className="top-0 left-0 h-dvh w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 p-0 pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] [&>[data-slot=dialog-close]]:top-[calc(0.25rem+env(safe-area-inset-top))] [&>[data-slot=dialog-close]]:right-[calc(0.25rem+env(safe-area-inset-right))] md:[&>[data-slot=dialog-close]]:top-1 md:[&>[data-slot=dialog-close]]:right-1 sm:max-w-none md:p-0 md:top-[50%] md:left-[50%] md:h-[min(40rem,calc(100dvh-4rem))] md:w-full md:max-w-4xl md:translate-x-[-50%] md:translate-y-[-50%] md:flex-row md:rounded-lg md:border flex">
      <div className="flex shrink-0 flex-col border-b bg-muted/40 md:w-60 md:border-b-0 md:border-e">
        <DialogHeader className="px-4 pt-3 pe-14 md:px-5 md:pt-5 md:pe-5"><DialogTitle className="text-lg">{t("title")}</DialogTitle>
          <DialogDescription className="sr-only">{t("description")}</DialogDescription></DialogHeader>
        <SettingsNav sections={sections} section={section} onSection={(next) => { if (next !== section) guard(() => onSection(next)); }} />
      </div>
      <section aria-labelledby={headingId} className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4 md:p-6" data-settings-content>
        {section && <>
          <h2 id={headingId} className="mb-5 text-xl font-semibold tracking-tight">{t(`sectionNames.${section}`)}</h2>
          {section === "profile" && <ProfilePanel communities={shell.settings.communities ?? []} userId={shell.settings.userId} guard={guard} onDirtyChange={setDirty} />}
          {section === "account" && <AccountPanel />}
          {section === "ministry" && shell.tenantId && <MinistryPanel tenantId={shell.tenantId} name={shell.ministryName ?? ""} role={shell.role ?? ""} audience={shell.audience ?? null} timeZone={shell.timeZone} />}
          {section === "connections" && shell.tenantId && <ConnectionsPanel tenantId={shell.tenantId} testCredential={shell.settings.socialTestCredential} />}
          {section === "crm" && shell.tenantId && <CrmPanel tenantId={shell.tenantId} />}
        </>}
      </section>
    </DialogContent>
    <ConfirmDialog tone="neutral" open={pending !== null} onOpenChange={(next) => { if (!next) setPending(null); }} title={t("discardTitle")} description={t("discardBody")}
      cancelLabel={t("keepEditing")} confirmLabel={t("discard")} onConfirm={() => { const proceed = pending; setPending(null); setDirty(false); proceed?.(); }} />
  </Dialog>;
}
