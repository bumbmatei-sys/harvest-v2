export const BRAND_THEMES = ["harvest", "studio"] as const;
export type BrandTheme = (typeof BRAND_THEMES)[number];
export type ColorMode = "light" | "dark";
export function resolveBrandTheme(user: unknown, workspace: unknown): BrandTheme {
  if (user === "harvest" || user === "studio") return user;
  return workspace === "studio" ? "studio" : "harvest";
}

export function contrastRatio(first: string, second: string) {
  function luminance(hex: string) {
    if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error("Expected a six-digit hex color.");
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
  return contrastRatio(color, "#2D2519") >= 4.5 ? "#2D2519" : "#FFFFFF";
}

// Only validated enum values are interpolated. Executes in <head> before body paint.
export function themeBootstrap(workspace: BrandTheme = "harvest") {
  return `(function(){var d=document.documentElement,w=${JSON.stringify(resolveBrandTheme(null, workspace))},u=null,m=null;try{u=localStorage.getItem('harvest-brand-theme');m=localStorage.getItem('harvest-color-mode')}catch(e){}d.dataset.workspaceTheme=w;d.dataset.brandTheme=u==='harvest'||u==='studio'?u:w;d.dataset.theme=m==='light'||m==='dark'?m:(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');d.classList.toggle('dark',d.dataset.theme==='dark')})()`;
}

export function applyTheme(workspace?: BrandTheme) {
  const root = document.documentElement;
  if (workspace) root.dataset.workspaceTheme = workspace;
  let user: string | null = null, mode: string | null = null;
  try { user = localStorage.getItem("harvest-brand-theme"); mode = localStorage.getItem("harvest-color-mode"); } catch { /* Storage may be unavailable. Workspace defaults still work. */ }
  root.dataset.brandTheme = resolveBrandTheme(user, root.dataset.workspaceTheme);
  root.dataset.theme = mode === "light" || mode === "dark" ? mode : matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  root.classList.toggle("dark", root.dataset.theme === "dark");
  window.dispatchEvent(new Event("harvest-theme-change"));
}
