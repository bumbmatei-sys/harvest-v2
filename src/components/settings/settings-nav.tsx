/** Layout and behaviour modelled on bumbmatei-sys/admin-dashboard (Shadcn UI Kit, premium, founder-supplied 19 Nov 2026): app/dashboard/(auth)/pages/settings/components/sidebar-nav.tsx; code written for Harvest, no kit code copied. Harvest notes: docs/ui-sources.md. */
"use client";
import { useRef } from "react";
import { useTranslations } from "next-intl";
import { settingsGroups, type SettingsSection, type SettingsSectionId } from "@/lib/settings-sections";
import { cn } from "@/lib/utils";

/**
 * The section list of the Settings pop-up: a column of icon rows grouped You and Ministry from 768px, a scrollable tab row below. The arrow keys
 * (up and down, left and right), Home and End move between sections and open them, one tab stop for the whole list; Tab moves on to the content.
 */
export function SettingsNav({ sections, section, onSection }: { sections: readonly SettingsSection[]; section: SettingsSectionId | null; onSection: (section: SettingsSectionId) => void }) {
  const t = useTranslations("SettingsDialog");
  const listRef = useRef<HTMLElement>(null);
  function onKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    const keys: Record<string, number | "first" | "last"> = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1, Home: "first", End: "last" };
    const move = keys[event.key];
    if (move === undefined) return;
    const buttons = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>("button[data-section]") ?? []);
    const current = buttons.findIndex((button) => button === document.activeElement);
    if (current < 0) return;
    event.preventDefault();
    const next = move === "first" ? 0 : move === "last" ? buttons.length - 1 : (current + move + buttons.length) % buttons.length;
    buttons[next]?.focus(); onSection(buttons[next]?.dataset.section as SettingsSectionId);
  }
  const grouped = settingsGroups.map((group) => ({ group, items: sections.filter((item) => item.group === group) })).filter(({ items }) => items.length > 0);
  return <nav ref={listRef} aria-label={t("sections")} onKeyDown={onKeyDown} className="overflow-x-auto px-2 pb-2 pt-1 md:overflow-y-auto md:overflow-x-visible md:px-3 md:py-3">
    <ul className="m-0 flex list-none gap-1 p-0 md:flex-col md:gap-4">
      {grouped.map(({ group, items }) => <li key={group} className="flex gap-1 md:block">
        {grouped.length > 1 && <p className="hidden px-2 pb-1 text-xs font-medium text-muted-foreground md:block">{t(`groups.${group}`)}</p>}
        <ul className="m-0 flex list-none gap-1 p-0 md:flex-col">
          {items.map((item) => <li key={item.id}>
            <button type="button" data-section={item.id} tabIndex={item.id === section ? 0 : -1} aria-current={item.id === section ? "page" : undefined} onClick={() => onSection(item.id)}
              className={cn("flex min-h-11 w-full items-center gap-2 whitespace-nowrap rounded-md px-3 text-sm font-medium outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 md:min-h-9",
                item.id === section ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/70 hover:text-foreground")}>
              <item.icon className="size-4 shrink-0" aria-hidden="true" />{t(`sectionNames.${item.id}`)}</button>
          </li>)}
        </ul>
      </li>)}
    </ul>
  </nav>;
}
