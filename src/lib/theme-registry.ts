/** The sole palette registry. Add a definition here; every control and CSS selector is derived. Chart tokens (--chart-1..5) are series colors that meet 3:1 non-text contrast against --surface-card and --surface (checked in tests). */
export const themeRegistry = {
  "harvest": {
    "labelKey": "harvest",
    "light": {
      "--shell-canvas": "#ffffff",
      "--shell-panel": "#ffffff",
      "--shell-shadow": "0 1px 2px rgb(0 0 0 / 5%)",
      "--brand-color": "#171717",
      "--earth": "#2d2519",
      "--surface": "#ffffff",
      "--surface-raised": "#ffffff",
      "--surface-card": "#ffffff",
      "--surface-sunken": "#f5f5f5",
      "--surface-tint": "#f5f5f5",
      "--surface-chip": "#f5f5f5",
      "--text-strong": "#171717",
      "--text-body": "#171717",
      "--text-muted": "#6b6b6b",
      "--text-faint": "#6b6b6b",
      "--border-default": "#e5e5e5",
      "--border-hairline": "#e5e5e5",
      "--border-subtle": "#e5e5e5",
      "--sidebar": "#fafafa",
      "--sidebar-accent": "#f5f5f5",
      "--sidebar-hover": "#f5f5f5",
      "--sidebar-border": "#e5e5e5",
      "--radius": "10px",
      "--ds-radius-card": "14px",
      "--radius-chip": "9px",
      "--font-ui": "var(--font-geist-sans)",
      "--ds-sh-md": "0 8px 20px #2d251909",
      "--ds-sh-lg": "0 14px 32px #2d251914",
      "--shadow-popover": "0 10px 24px #2d251914",
      "--destructive": "#a23c28",
      "--destructive-foreground": "#ffffff",
      "--category-green-tint": "#ddeee5",
      "--category-green-ink": "#274335",
      "--category-amber-tint": "#f7eddf",
      "--category-amber-ink": "#54412a",
      "--overlay": "#00000033",
      "--action-hover": "#262626",
      "--ring": "#a3a3a3",
      "--shadow-color": "#000000",
      "--action-foreground": "#fafafa",
      "--chart-1": "#9a6a12",
      "--chart-2": "#2b7a57",
      "--chart-3": "#356aa3",
      "--chart-4": "#b04a36",
      "--chart-5": "#6a58a6"
    },
    "dark": {
      "--shell-canvas": "#0a0a0a",
      "--shell-panel": "#0a0a0a",
      "--shell-shadow": "0 1px 2px rgb(0 0 0 / 5%)",
      "--brand-color": "#e5e5e5",
      "--earth": "#2d2519",
      "--surface": "#0a0a0a",
      "--surface-raised": "#171717",
      "--surface-card": "#171717",
      "--surface-sunken": "#262626",
      "--surface-tint": "#262626",
      "--surface-chip": "#262626",
      "--text-strong": "#fafafa",
      "--text-body": "#fafafa",
      "--text-muted": "#a3a3a3",
      "--text-faint": "#a3a3a3",
      "--border-default": "#ffffff1a",
      "--border-hairline": "#ffffff1a",
      "--border-subtle": "#ffffff26",
      "--sidebar": "#171717",
      "--sidebar-accent": "#262626",
      "--sidebar-hover": "#262626",
      "--sidebar-border": "#ffffff1a",
      "--radius": "10px",
      "--ds-radius-card": "14px",
      "--radius-chip": "9px",
      "--font-ui": "var(--font-geist-sans)",
      "--ds-sh-md": "0 8px 20px #2d251909",
      "--ds-sh-lg": "0 14px 32px #2d251914",
      "--shadow-popover": "0 10px 24px #2d251914",
      "--destructive": "#ef858b",
      "--destructive-foreground": "#171717",
      "--category-green-tint": "#24392e",
      "--category-green-ink": "#a3d4b9",
      "--category-amber-tint": "#3e3324",
      "--category-amber-ink": "#e9c28a",
      "--overlay": "#00000080",
      "--action-hover": "#cccccc",
      "--ring": "#737373",
      "--shadow-color": "#000000",
      "--action-foreground": "#171717",
      "--chart-1": "#d9ab52",
      "--chart-2": "#5fbf92",
      "--chart-3": "#6fa4dc",
      "--chart-4": "#e08a72",
      "--chart-5": "#a99be0"
    }
  },
  "studio": {
    "labelKey": "studio",
    "light": {
      "--shell-canvas": "#ffffff",
      "--shell-panel": "#ffffff",
      "--shell-shadow": "0 1px 2px rgb(0 0 0 / 5%)",
      "--brand-color": "#171717",
      "--earth": "#2d2519",
      "--surface": "#ffffff",
      "--surface-raised": "#ffffff",
      "--surface-card": "#ffffff",
      "--surface-sunken": "#f5f5f5",
      "--surface-tint": "#f5f5f5",
      "--surface-chip": "#f5f5f5",
      "--text-strong": "#171717",
      "--text-body": "#171717",
      "--text-muted": "#6b6b6b",
      "--text-faint": "#6b6b6b",
      "--border-default": "#e5e5e5",
      "--border-hairline": "#e5e5e5",
      "--border-subtle": "#e5e5e5",
      "--sidebar": "#fafafa",
      "--sidebar-accent": "#f5f5f5",
      "--sidebar-hover": "#f5f5f5",
      "--sidebar-border": "#e5e5e5",
      "--radius": "10px",
      "--ds-radius-card": "14px",
      "--radius-chip": "9px",
      "--font-ui": "var(--font-geist-sans)",
      "--ds-sh-md": "0 8px 20px #0f172a0f",
      "--ds-sh-lg": "0 14px 32px #0f172a14",
      "--shadow-popover": "0 10px 24px #0f172a14, inset 0 1px #ffffff0d",
      "--destructive": "#c0272e",
      "--destructive-foreground": "#ffffff",
      "--category-green-tint": "#ddeee5",
      "--category-green-ink": "#274335",
      "--category-amber-tint": "#f7eddf",
      "--category-amber-ink": "#54412a",
      "--overlay": "#00000033",
      "--action-hover": "#262626",
      "--ring": "#a3a3a3",
      "--shadow-color": "#000000",
      "--action-foreground": "#fafafa",
      "--chart-1": "#2563eb",
      "--chart-2": "#0e7c86",
      "--chart-3": "#7c3aed",
      "--chart-4": "#c2410c",
      "--chart-5": "#4d7c0f"
    },
    "dark": {
      "--shell-canvas": "#0a0a0a",
      "--shell-panel": "#0a0a0a",
      "--shell-shadow": "0 1px 2px rgb(0 0 0 / 5%)",
      "--brand-color": "#e5e5e5",
      "--earth": "#2d2519",
      "--surface": "#0a0a0a",
      "--surface-raised": "#171717",
      "--surface-card": "#171717",
      "--surface-sunken": "#262626",
      "--surface-tint": "#262626",
      "--surface-chip": "#262626",
      "--text-strong": "#fafafa",
      "--text-body": "#fafafa",
      "--text-muted": "#a3a3a3",
      "--text-faint": "#a3a3a3",
      "--border-default": "#ffffff1a",
      "--border-hairline": "#ffffff1a",
      "--border-subtle": "#ffffff26",
      "--sidebar": "#171717",
      "--sidebar-accent": "#262626",
      "--sidebar-hover": "#262626",
      "--sidebar-border": "#ffffff1a",
      "--radius": "10px",
      "--ds-radius-card": "14px",
      "--radius-chip": "9px",
      "--font-ui": "var(--font-geist-sans)",
      "--ds-sh-md": "0 8px 20px #0f172a0f",
      "--ds-sh-lg": "0 14px 32px #0f172a14",
      "--shadow-popover": "0 10px 24px #0f172a14, inset 0 1px #ffffff0d",
      "--destructive": "#ef858b",
      "--destructive-foreground": "#171717",
      "--category-green-tint": "#24392e",
      "--category-green-ink": "#a3d4b9",
      "--category-amber-tint": "#3e3324",
      "--category-amber-ink": "#e9c28a",
      "--overlay": "#00000080",
      "--action-hover": "#cccccc",
      "--ring": "#737373",
      "--shadow-color": "#000000",
      "--action-foreground": "#171717",
      "--chart-1": "#6b9bff",
      "--chart-2": "#4cc3cd",
      "--chart-3": "#a78bfa",
      "--chart-4": "#f08a5d",
      "--chart-5": "#9ccc58"
    }
  }
} as const;

export type BrandTheme = keyof typeof themeRegistry;
export type ColorMode = "light" | "dark";
export const BRAND_THEMES = Object.keys(themeRegistry) as [BrandTheme, ...BrandTheme[]];
export const COLOR_MODES = ["light", "dark"] as const;
export function isBrandTheme(value: unknown): value is BrandTheme {
  return typeof value === "string" && Object.hasOwn(themeRegistry, value);
}

/**
 * Campaign type artwork (src/components/campaigns/campaign-type-art.tsx): one fixed, vivid colour family per campaign type, the same for every brand theme
 * because the theme palettes are monochrome. Decorative headers only, never behind text. Lighter in light mode, deeper in dark.
 */
export const campaignArtTokens = {
  light: {
    "--art-crusade-from": "#fb7185", "--art-crusade-to": "#db2777", "--art-crusade-glow": "#fed7aa", "--art-crusade-ink": "#ffffff",
    "--art-mission-from": "#38bdf8", "--art-mission-to": "#2563eb", "--art-mission-glow": "#a5f3fc", "--art-mission-ink": "#ffffff",
    "--art-conference-from": "#c4b5fd", "--art-conference-to": "#7c3aed", "--art-conference-glow": "#f9a8d4", "--art-conference-ink": "#ffffff",
    "--art-outreach-from": "#34d399", "--art-outreach-to": "#0d9488", "--art-outreach-glow": "#d9f99d", "--art-outreach-ink": "#ffffff",
    "--art-custom-from": "#fbbf24", "--art-custom-to": "#f97316", "--art-custom-glow": "#fef3c7", "--art-custom-ink": "#ffffff",
  },
  dark: {
    "--art-crusade-from": "#be123c", "--art-crusade-to": "#831843", "--art-crusade-glow": "#fed7aa", "--art-crusade-ink": "#ffffff",
    "--art-mission-from": "#0369a1", "--art-mission-to": "#1e3a8a", "--art-mission-glow": "#a5f3fc", "--art-mission-ink": "#ffffff",
    "--art-conference-from": "#7c3aed", "--art-conference-to": "#3b0764", "--art-conference-glow": "#f9a8d4", "--art-conference-ink": "#ffffff",
    "--art-outreach-from": "#047857", "--art-outreach-to": "#134e4a", "--art-outreach-glow": "#d9f99d", "--art-outreach-ink": "#ffffff",
    "--art-custom-from": "#ea580c", "--art-custom-to": "#9a3412", "--art-custom-glow": "#fde68a", "--art-custom-ink": "#ffffff",
  },
} as const satisfies Record<ColorMode, Record<string, string>>;

/**
 * Named accent colours: the colour layer on top of the monochrome themes, for icon chips, art, progress and highlights (never large text or page
 * backgrounds). `--accent-<name>` is the icon / line colour and `--accent-<name>-soft` the chip fill; the solid colour meets 3:1 against the card
 * surface and its own soft fill in every brand theme and mode (checked in tests). Status colours (success, attention) are separate tokens.
 */
export const ACCENTS = ["pink", "sky", "violet", "emerald", "amber", "teal", "indigo"] as const;
export type Accent = typeof ACCENTS[number];
export const accentTokens = {
  light: {
    "--accent-pink": "#db2777", "--accent-pink-soft": "#fbe5ef", "--accent-sky": "#0284c7", "--accent-sky-soft": "#e1f0f8",
    "--accent-violet": "#7c3aed", "--accent-violet-soft": "#efe7fd", "--accent-emerald": "#059669", "--accent-emerald-soft": "#e1f2ed",
    "--accent-amber": "#b45309", "--accent-amber-soft": "#fef3c7", "--accent-teal": "#0f766e", "--accent-teal-soft": "#e2efee",
    "--accent-indigo": "#4f46e5", "--accent-indigo-soft": "#eae9fc",
  },
  dark: {
    "--accent-pink": "#f472b6", "--accent-pink-soft": "#3f2734", "--accent-sky": "#38bdf8", "--accent-sky-soft": "#1d3540",
    "--accent-violet": "#a78bfa", "--accent-violet-soft": "#312c40", "--accent-emerald": "#34d399", "--accent-emerald-soft": "#1c392e",
    "--accent-amber": "#fbbf24", "--accent-amber-soft": "#403519", "--accent-teal": "#2dd4bf", "--accent-teal-soft": "#1b3935",
    "--accent-indigo": "#818cf8", "--accent-indigo-soft": "#2a2c40",
  },
} as const satisfies Record<ColorMode, Record<`--accent-${Accent}` | `--accent-${Accent}-soft`, string>>;

export const themeStyles = BRAND_THEMES.flatMap((brand) => COLOR_MODES.map((mode) => {
  const fallback = brand === "harvest" && mode === "light" ? ":root," : "";
  const selectors = fallback + ` :root[data-brand-theme="${brand}"][data-theme="${mode}"], [data-theme="${mode}"] .theme-preview[data-preview-brand="${brand}"]`;
  const tokens = Object.entries({ ...themeRegistry[brand][mode], ...campaignArtTokens[mode], ...accentTokens[mode] }).map(([name, value]) => `${name}:${value}`).join(";");
  return `${selectors}{color-scheme:${mode};${tokens}}`;
})).join("\n");

/** HC-03 printable QR exports: the quiet zone is always white; the standard ink is black. */
export const qrExportColors = { background: "#ffffff", standardInk: "#000000" } as const;

export const CHART_TOKENS = ["--chart-1", "--chart-2", "--chart-3", "--chart-4", "--chart-5"] as const;

/**
 * Network brand colours for the Inbox's coloured platform marks (src/components/social/platform-logo.tsx). They are the networks' published brand colours; black marks use
 * `light-dark()` so they read on both schemes (the root sets `color-scheme` per mode). Each mark stays subject to its owner's brand guidelines and is used only to name the network.
 */
export const platformBrandFill: Record<string, string> = {
  twitter: "light-dark(#000000, #ffffff)", facebook: "#0866FF", youtube: "#FF0000", pinterest: "#E60023", reddit: "#FF4500", bluesky: "#0085FF",
  threads: "light-dark(#000000, #ffffff)", telegram: "#26A5E4", whatsapp: "#25D366", discord: "#5865F2", wordpress: "#21759B", shopify: "#5E8E3E",
  wix: "light-dark(#000000, #ffffff)", webflow: "#146EF5", imessage: "#34C759", line: "#06C755", wechat: "#07C160", snapchat: "#FFFC00",
  tiktok: "light-dark(#000000, #ffffff)", linkedin: "#0A66C2",
  slack: "light-dark(#611F69, #E8B5F0)", googlebusiness: "#4285F4", sms: "#34C759", rcs: "#1A73E8",
};
export const platformBrandOutline = { snapchat: "light-dark(#000000, #ffffff)" } as const;
export const instagramGradient = ["#FEDA75", "#FA7E1E", "#D62976", "#962FBF", "#4F5BD5"] as const;
export const tiktokAccents = { cyan: "#25F4EE", red: "#FE2C55" } as const;
/** Mailbox provider marks for Office mail (Gmail and Outlook), in their published brand colours. */
export const mailMarkColors = {
  gmail: { blue: "#4285F4", green: "#34A853", yellow: "#FBBC04", red: "#EA4335", darkRed: "#C5221F" },
  outlook: { deep: "#0A2767", base: "#0364B8", mid: "#0078D4", light: "#28A8EA", pale: "#50D9FF", white: "#FFFFFF" },
} as const;
/** Calendar marks for the Office Calendar screen (Google Calendar and Outlook calendar), simplified and in their published brand colours. */
export const calendarMarkColors = {
  google: { blue: "#4285F4", green: "#34A853", yellow: "#FBBC04", red: "#EA4335", white: "#FFFFFF" },
  outlook: { base: "#0364B8", mid: "#0078D4", light: "#28A8EA", white: "#FFFFFF" },
} as const;
/** Drive marks for the Files screen (Google Drive and OneDrive), simplified and in their published brand colours. */
export const driveMarkColors = {
  drive: { green: "#34A853", yellow: "#FBBC04", blue: "#4285F4" },
  onedrive: { deep: "#0364B8", base: "#0078D4", mid: "#1490DF", light: "#28A8EA" },
} as const;

/** Docs editor: the text colours and highlights offered in the toolbar and the slash menu (nine each, in this order: red, orange, yellow, green, cyan, blue, purple, pink, gray). The server accepts any six-digit hex value. */
export const docTextColors = ["#dc2626", "#ea580c", "#ca8a04", "#16a34a", "#0891b2", "#2563eb", "#7c3aed", "#db2777", "#6b7280"] as const;
export const docHighlightColors = ["#fecaca", "#fed7aa", "#fef08a", "#bbf7d0", "#a5f3fc", "#bfdbfe", "#ddd6fe", "#fbcfe8", "#e5e7eb"] as const;
