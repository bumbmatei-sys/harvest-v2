"use client";
import { Suspense, useCallback, useMemo, useRef, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import type { Audience } from "@/lib/audience";
import type { NavFeature } from "@/lib/navigation";
import { openSection, resolveSettingsSections, settingsParam, settingsViewer, type SettingsSectionId, type ShellSettings } from "@/lib/settings-sections";
import { SettingsContext, type SettingsOpener } from "@/components/settings/settings-context";
import { SettingsDialog } from "@/components/settings/settings-dialog";

export type SettingsShell = { email: string; tenantId?: string; ministryName?: string; role?: string; audience?: Audience | null; features: readonly NavFeature[]; settings: ShellSettings };

/** Writes the section into the URL without a server round trip (Next keeps useSearchParams in step with the History API). */
function writeSection(section: SettingsSectionId | null) {
  const url = new URL(window.location.href);
  if (section) url.searchParams.set(settingsParam, section); else url.searchParams.delete(settingsParam);
  window.history.replaceState(null, "", url);
}
function Host({ shell, returnRef }: { shell: SettingsShell; returnRef: React.RefObject<HTMLElement | null> }) {
  const params = useSearchParams();
  const sections = useMemo(() => resolveSettingsSections(settingsViewer({ role: shell.role, hasMinistry: Boolean(shell.tenantId), features: shell.features, settings: shell.settings })), [shell.role, shell.tenantId, shell.features, shell.settings]);
  const section = openSection(params.get(settingsParam), sections);
  return <SettingsDialog open={section !== null} section={section} sections={sections} shell={shell}
    onSection={writeSection} onClose={() => writeSection(null)}
    onCloseAutoFocus={(event) => { const target = returnRef.current; returnRef.current = null; if (target?.isConnected) { event.preventDefault(); target.focus(); } }} />;
}
/** Provides the opener and renders the pop-up. The search-params reader sits in its own Suspense boundary so static pages still build. */
export function SettingsProvider({ shell, children }: { shell: SettingsShell; children: ReactNode }) {
  const returnRef = useRef<HTMLElement | null>(null);
  const open = useCallback<SettingsOpener["open"]>((section, from) => {
    returnRef.current = from ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    writeSection(section ?? "profile");
  }, []);
  const value = useMemo<SettingsOpener>(() => ({ open }), [open]);
  return <SettingsContext.Provider value={value}>
    {children}
    <Suspense fallback={null}><Host shell={shell} returnRef={returnRef} /></Suspense>
  </SettingsContext.Provider>;
}
