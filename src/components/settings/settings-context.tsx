"use client";
import { createContext, useContext } from "react";
import type { SettingsSectionId } from "@/lib/settings-sections";

/**
 * Opens the Settings pop-up from anywhere inside the shell (the profile menu, the Planner's Social accounts button). The pop-up itself lives in the
 * shell and is driven by `?settings=<section>` in the URL, so a page can also deep-link to it. `returnTo` is the control that gets focus back on close.
 */
export type SettingsOpener = { open: (section?: SettingsSectionId, returnTo?: HTMLElement | null) => void };
export const SettingsContext = createContext<SettingsOpener | null>(null);
/** Null outside the shell (for example a page rendered without AppShell): callers fall back to a plain link. */
export function useSettings() { return useContext(SettingsContext); }
