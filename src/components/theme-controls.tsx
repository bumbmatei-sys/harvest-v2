"use client";
import { useLayoutEffect, useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { applyTheme, type BrandTheme } from "@/lib/theme";
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
  if (stored === "harvest" || stored === "studio") preference = stored;
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
    applyTheme(undefined, key === "harvest-brand-theme" ? { brand: value === "harvest" || value === "studio" ? value : "default" } : { mode: value === "dark" ? "dark" : "light" });
  }
  return { hydrated, brand, mode, save };
}
export function BrandThemeMenu() {
  const { hydrated, brand, save } = useThemeControls();
  return <>
    <DropdownMenuLabel>Theme</DropdownMenuLabel>
    <DropdownMenuRadioGroup aria-label="Brand theme" value={brand} onValueChange={(value) => save("harvest-brand-theme", value)}>
      <DropdownMenuRadioItem disabled={!hydrated} value="default">Workspace default</DropdownMenuRadioItem>
      <DropdownMenuRadioItem disabled={!hydrated} value="harvest">Harvest</DropdownMenuRadioItem>
      <DropdownMenuRadioItem disabled={!hydrated} value="studio">Studio</DropdownMenuRadioItem>
    </DropdownMenuRadioGroup>
  </>;
}
export function ThemeToggle() {
  const { hydrated, mode, save } = useThemeControls();
  const label = mode === "dark" ? "Switch to light" : "Switch to dark";
  return <Tooltip><TooltipTrigger asChild>
    <Button variant="ghost" size="icon" className="size-8 shrink-0 text-sidebar-foreground [&_svg]:size-[17px] [&_svg]:stroke-[1.7]" disabled={!hydrated} aria-label={label} onClick={() => save("harvest-color-mode", mode === "dark" ? "light" : "dark")}>
      {mode === "dark" ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
    </Button>
  </TooltipTrigger><TooltipContent side="top">{label}</TooltipContent></Tooltip>;
}
export function ThemeControls() {
  const { hydrated, brand, mode, save } = useThemeControls();
  return <div className="flex items-center gap-2">
    <Select value={brand} onValueChange={(value) => save("harvest-brand-theme", value)} disabled={!hydrated}>
      <SelectTrigger aria-label="Brand theme" className="h-8 w-40 bg-card text-xs"><SelectValue /></SelectTrigger>
      <SelectContent><SelectItem value="default">Workspace default</SelectItem><SelectItem value="harvest">Harvest</SelectItem><SelectItem value="studio">Studio</SelectItem></SelectContent>
    </Select>
    <Button variant="ghost" size="icon-sm" disabled={!hydrated} aria-label={mode === "dark" ? "Switch to light mode" : "Switch to dark mode"} onClick={() => save("harvest-color-mode", mode === "dark" ? "light" : "dark")}>
      {mode === "dark" ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
    </Button>
  </div>;
}
