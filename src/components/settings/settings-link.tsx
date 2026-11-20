"use client";
import Link from "next/link";
import type { ComponentProps } from "react";
import type { SettingsSectionId } from "@/lib/settings-sections";
import { useSettings } from "@/components/settings/settings-context";

/**
 * A link that opens the Settings pop-up at `section` when the shell is there, and otherwise goes to `href` (the screen the section embeds, which stays
 * reachable at its own address). Modified clicks (new tab) keep the plain link behaviour.
 */
export function SettingsLink({ section, onClick, ...props }: Omit<ComponentProps<typeof Link>, "prefetch"> & { section: SettingsSectionId }) {
  const settings = useSettings();
  return <Link prefetch={false} {...props} onClick={(event) => {
    onClick?.(event);
    if (!settings || event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault(); settings.open(section, event.currentTarget);
  }} />;
}
