"use client";
import { useLayoutEffect, useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { applyTheme, type BrandTheme } from "@/lib/theme";

function subscribe(callback: () => void) {
  window.addEventListener("harvest-theme-change", callback);
  window.addEventListener("storage", callback);
  return () => { window.removeEventListener("harvest-theme-change", callback); window.removeEventListener("storage", callback); };
}
function snapshot() {
  let preference = "default";
  try { const stored = localStorage.getItem("harvest-brand-theme"); if (stored === "harvest" || stored === "studio") preference = stored; } catch { /* Use workspace default. */ }
  return `${preference}|${document.documentElement.dataset.theme ?? "light"}`;
}
export function WorkspaceTheme({ brandTheme }: { brandTheme: BrandTheme }) {
  useLayoutEffect(() => { applyTheme(brandTheme); }, [brandTheme]);
  return null;
}
export function ThemeControls() {
  const [brand, mode] = useSyncExternalStore(subscribe, snapshot, () => "default|light").split("|");
  function save(key: string, value: string) {
    try { if (value === "default") localStorage.removeItem(key); else localStorage.setItem(key, value); } catch { /* Keep controls usable without storage. */ }
    applyTheme();
    if (key === "harvest-color-mode") { document.documentElement.dataset.theme = value; document.documentElement.classList.toggle("dark", value === "dark"); window.dispatchEvent(new Event("harvest-theme-change")); }
  }
  return <div className="flex items-center gap-2">
    <Select value={brand} onValueChange={(value) => save("harvest-brand-theme", value)}>
      <SelectTrigger aria-label="Brand theme" className="h-8 w-40 bg-card text-xs"><SelectValue /></SelectTrigger>
      <SelectContent><SelectItem value="default">Workspace default</SelectItem><SelectItem value="harvest">Harvest</SelectItem><SelectItem value="studio">Studio</SelectItem></SelectContent>
    </Select>
    <Button variant="ghost" size="icon-sm" aria-label={mode === "dark" ? "Switch to light mode" : "Switch to dark mode"} onClick={() => save("harvest-color-mode", mode === "dark" ? "light" : "dark")}>
      {mode === "dark" ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
    </Button>
  </div>;
}
