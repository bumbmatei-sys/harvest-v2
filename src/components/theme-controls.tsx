"use client";
import { useTranslations } from "next-intl";
import { useLayoutEffect, useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { applyTheme, BRAND_THEMES, themeRegistry, type BrandTheme } from "@/lib/theme";
import { isBrandTheme } from "@/lib/theme-registry";
import { useHydrated } from "@/hooks/use-hydrated";

function subscribe(callback: () => void) {
  const refresh = () => applyTheme();
  const media = matchMedia("(prefers-color-scheme: dark)");
  window.addEventListener("harvest-theme-change", callback);
  window.addEventListener("storage", refresh);
  media.addEventListener("change", refresh);
  return () => { window.removeEventListener("harvest-theme-change", callback); window.removeEventListener("storage", refresh); media.removeEventListener("change", refresh); };
}
function snapshot() {
  let preference = "default";
  const stored = document.documentElement.dataset.brandOverride;
  if (isBrandTheme(stored)) preference = stored;
  return `${preference}|${document.documentElement.dataset.theme ?? "light"}`;
}
export function WorkspaceTheme({ brandTheme }: { brandTheme: BrandTheme }) {
  useLayoutEffect(() => { applyTheme(brandTheme); }, [brandTheme]);
  return null;
}
function useThemeControls() {
  const hydrated = useHydrated();
  const [brand, mode] = useSyncExternalStore(subscribe, snapshot, () => "default|light").split("|");
  function save(key: "harvest-brand-theme" | "harvest-color-mode", value: string) {
    try { if (value === "default") localStorage.removeItem(key); else localStorage.setItem(key, value); } catch { /* Keep controls usable without storage. */ }
    applyTheme(undefined, key === "harvest-brand-theme" ? { brand: isBrandTheme(value) ? value : "default" } : { mode: value === "dark" ? "dark" : "light" });
  }
  return { hydrated, brand, mode, save };
}
export function BrandThemeMenu() {
  const t = useTranslations("ComponentsThemeControls");
  const names = useTranslations("ThemeNames");
  const { hydrated, brand, save } = useThemeControls();
  return <>
    <DropdownMenuLabel>{t("theme")}</DropdownMenuLabel>
    <DropdownMenuRadioGroup aria-label={t("brandTheme")} value={brand} onValueChange={(value) => save("harvest-brand-theme", value)}>
      <DropdownMenuRadioItem disabled={!hydrated} value="default">{t("workspaceDefault")}</DropdownMenuRadioItem>
      {BRAND_THEMES.map((id) => <DropdownMenuRadioItem key={id} disabled={!hydrated} value={id}>{names(themeRegistry[id].labelKey)}</DropdownMenuRadioItem>)}
    </DropdownMenuRadioGroup>
  </>;
}
export function ThemeToggle() {
  const t = useTranslations("ComponentsThemeControls");
  const { hydrated, mode, save } = useThemeControls();
  const label = mode === "dark" ? t("switchToLight") : t("switchToDark");
  return <Tooltip><TooltipTrigger asChild>
    <Button variant="ghost" size="icon" className="size-8 shrink-0 text-sidebar-foreground [&_svg]:size-[17px] [&_svg]:stroke-[1.7]" disabled={!hydrated} aria-label={label} onClick={() => save("harvest-color-mode", mode === "dark" ? "light" : "dark")}>
      {mode === "dark" ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
    </Button>
  </TooltipTrigger><TooltipContent side="top">{label}</TooltipContent></Tooltip>;
}
export function ThemeControls({ touchTargets=false }: { touchTargets?:boolean }) {
  const t = useTranslations("ComponentsThemeControls");
  const names = useTranslations("ThemeNames");
  const { hydrated, brand, mode, save } = useThemeControls();
  return <div className="flex items-center gap-2">
    <Select value={brand} onValueChange={(value) => save("harvest-brand-theme", value)} disabled={!hydrated}>
      <SelectTrigger aria-label={t("brandTheme")} className={touchTargets?"min-h-11 w-40 bg-card text-xs":"h-8 w-40 bg-card text-xs"}><SelectValue /></SelectTrigger>
      <SelectContent><SelectItem value="default">{t("workspaceDefault")}</SelectItem>{BRAND_THEMES.map((id) => <SelectItem key={id} value={id}>{names(themeRegistry[id].labelKey)}</SelectItem>)}</SelectContent>
    </Select>
    <Button className={touchTargets?"size-11":undefined} variant="ghost" size="icon-sm" disabled={!hydrated} aria-label={mode === "dark" ? t("switchToLightMode") : t("switchToDarkMode")} onClick={() => save("harvest-color-mode", mode === "dark" ? "light" : "dark")}>
      {mode === "dark" ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
    </Button>
  </div>;
}
