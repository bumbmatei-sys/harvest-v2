"use client";
import { useTranslations } from "next-intl";
import { useLayoutEffect, useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { applyTheme, type BrandTheme } from "@/lib/theme";
import type { ColorMode } from "@/lib/theme-registry";
import { useHydrated } from "@/hooks/use-hydrated";

function subscribe(callback: () => void) {
  window.addEventListener("harvest-theme-change", callback);
  return () => window.removeEventListener("harvest-theme-change", callback);
}
function snapshot() {
  const root = document.documentElement;
  const stored = root.dataset.modeOverride;
  return `${stored === "light" || stored === "dark" ? stored : "system"}|${root.dataset.theme ?? "light"}`;
}
export function WorkspaceTheme({ brandTheme }: { brandTheme: BrandTheme }) {
  useLayoutEffect(() => { applyTheme(brandTheme); }, [brandTheme]);
  return null;
}
function useThemeControls() {
  const hydrated = useHydrated();
  const [preference, mode] = useSyncExternalStore(subscribe, snapshot, () => "system|light").split("|");
  function save(value: string) {
    const next: ColorMode | "system" = value === "dark" ? "dark" : value === "light" ? "light" : "system";
    try { if (next === "system") localStorage.removeItem("harvest-color-mode"); else localStorage.setItem("harvest-color-mode", next); } catch { /* Controls remain usable when storage is blocked. */ }
    applyTheme(undefined, { mode: next });
  }
  return { hydrated, preference, mode, save };
}
export function AppearanceMenu() {
  const t = useTranslations("ComponentsThemeControls");
  const { hydrated, preference, save } = useThemeControls();
  return <>
    <DropdownMenuLabel>{t("studioAdmin")}</DropdownMenuLabel>
    <DropdownMenuRadioGroup aria-label={t("colorMode")} value={preference} onValueChange={save}>
      {(["system", "light", "dark"] as const).map(mode => <DropdownMenuRadioItem key={mode} disabled={!hydrated} value={mode}>{t(mode)}</DropdownMenuRadioItem>)}
    </DropdownMenuRadioGroup>
  </>;
}
export function ThemeToggle() {
  const t = useTranslations("ComponentsThemeControls");
  const { hydrated, mode, save } = useThemeControls();
  const label = mode === "dark" ? t("switchToLight") : t("switchToDark");
  return <Tooltip><TooltipTrigger asChild>
    <Button variant="ghost" size="icon-responsive" className="shrink-0 text-sidebar-foreground [&_svg]:size-[17px] [&_svg]:stroke-[1.7]" disabled={!hydrated} aria-label={label} onClick={() => save(mode === "dark" ? "light" : "dark")}>
      {mode === "dark" ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
    </Button>
  </TooltipTrigger><TooltipContent side="top">{label}</TooltipContent></Tooltip>;
}
export function ThemeControls({ touchTargets = false }: { touchTargets?: boolean }) {
  const t = useTranslations("ComponentsThemeControls");
  const { hydrated, preference, mode, save } = useThemeControls();
  return <div className="flex items-center gap-2">
    <Select value={preference} onValueChange={save} disabled={!hydrated}>
      <SelectTrigger aria-label={t("colorMode")} className={touchTargets ? "min-h-11 w-40 bg-card text-xs" : "h-11 w-40 bg-card text-xs lg:h-9"}><SelectValue /></SelectTrigger>
      <SelectContent>{(["system", "light", "dark"] as const).map(value => <SelectItem key={value} value={value}>{t(value)}</SelectItem>)}</SelectContent>
    </Select>
    <Button className={touchTargets ? "size-11 lg:size-11" : undefined} variant="ghost" size="icon-responsive" disabled={!hydrated} aria-label={mode === "dark" ? t("switchToLightMode") : t("switchToDarkMode")} onClick={() => save(mode === "dark" ? "light" : "dark")}>
      {mode === "dark" ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
    </Button>
  </div>;
}
