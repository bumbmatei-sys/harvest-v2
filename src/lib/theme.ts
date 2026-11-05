import { message } from "../i18n/messages";
import { BRAND_THEMES, isBrandTheme, themeRegistry, type BrandTheme, type ColorMode } from "./theme-registry";
export { BRAND_THEMES, themeRegistry, type BrandTheme, type ColorMode } from "./theme-registry";
export function resolveBrandTheme(user: unknown, workspace: unknown): BrandTheme {
  if (isBrandTheme(user)) return user;
  return isBrandTheme(workspace) ? workspace : "harvest";
}

export function contrastRatio(first: string, second: string) {
  function luminance(hex: string) {
    if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error(message("Errors.expectedHexColor"));
    const [r, g, b] = [1, 3, 5].map((offset) => {
      const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return r * 0.2126 + g * 0.7152 + b * 0.0722;
  }
  const a = luminance(first), b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
export function actionForeground(color: string) {
  const dark = themeRegistry.harvest.light["--earth"];
  return contrastRatio(color, dark) >= 4.5 ? dark.toUpperCase() : themeRegistry.harvest.light["--destructive-foreground"].toUpperCase();
}

// Only validated enum values are interpolated. Executes in <head> before body paint.
export function themeBootstrap(workspace: BrandTheme = "harvest") {
  return `(function(){var brands=${JSON.stringify(BRAND_THEMES)},d=document.documentElement,w=${JSON.stringify(resolveBrandTheme(null, workspace))},u=null,m=null;try{u=localStorage.getItem('harvest-brand-theme');m=localStorage.getItem('harvest-color-mode')}catch(e){}d.dataset.workspaceTheme=w;d.dataset.brandOverride=brands.includes(u)?u:'';d.dataset.modeOverride=m==='light'||m==='dark'?m:'';d.dataset.brandTheme=brands.includes(u)?u:w;d.dataset.theme=m==='light'||m==='dark'?m:(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');d.classList.toggle('dark',d.dataset.theme==='dark')})()`;
}

export function applyTheme(workspace?: BrandTheme, preference?: { brand?: BrandTheme | "default"; mode?: ColorMode }) {
  const root = document.documentElement;
  if (workspace) root.dataset.workspaceTheme = workspace;
  let user: string | null = root.dataset.brandOverride ?? null, mode: string | null = root.dataset.modeOverride ?? null;
  try { user = localStorage.getItem("harvest-brand-theme"); mode = localStorage.getItem("harvest-color-mode"); } catch { /* Storage may be unavailable. Workspace defaults still work. */ }
  if (preference?.brand) user = preference.brand === "default" ? null : preference.brand;
  if (preference?.mode) mode = preference.mode;
  root.dataset.brandOverride = isBrandTheme(user) ? user : "";
  root.dataset.modeOverride = mode === "light" || mode === "dark" ? mode : "";
  root.dataset.brandTheme = resolveBrandTheme(user, root.dataset.workspaceTheme);
  root.dataset.theme = mode === "light" || mode === "dark" ? mode : matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  root.classList.toggle("dark", root.dataset.theme === "dark");
  window.dispatchEvent(new Event("harvest-theme-change"));
}
