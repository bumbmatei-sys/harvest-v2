import type { CSSProperties, ReactNode } from "react";
import type { CatalogKind } from "@/lib/catalog";
import { cn } from "@/lib/utils";

// Original, code-drawn header art for the catalogue types, in the same family as `CampaignTypeArt`: a gradient, a fine grain, soft shapes and one line motif per type.
// Colours come only from the palette's `--art-1..5-*` tokens (every theme in theme-registry.ts defines them, light and dark), so it follows the colour scheme and needs no assets.
// Decorative: always aria-hidden. A <span>, so it can sit inside a button (the type cards). No hooks and no SVG ids, so it renders the same on the server, on the client and many times on one page.

// Each type's artwork family: one of the palette's five art slots. Courses use the Misty Blue family, downloads the Desert Sun family.
const slots: Record<CatalogKind, number> = { course: 2, download: 1 };

const ink = { stroke: "var(--ink)", fill: "none", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" } as const;
const inkFill = (opacity: number): CSSProperties => ({ fill: "var(--ink)", fillOpacity: opacity, stroke: "none" });
const glowFill = (opacity = 1): CSSProperties => ({ fill: "var(--glow)", fillOpacity: opacity, stroke: "none" });

/** An open book with ruled lessons, a ribbon and a lit first line. */
function Course() {
  return <>
    <path d="M100 30 C 84 20, 56 20, 38 28 L38 84 C 56 76, 84 76, 100 86 Z" style={inkFill(0.2)} />
    <path d="M100 30 C 116 20, 144 20, 162 28 L162 84 C 144 76, 116 76, 100 86 Z" style={inkFill(0.32)} />
    <path d="M100 30 C 84 20, 56 20, 38 28 L38 84 C 56 76, 84 76, 100 86 C 116 76, 144 76, 162 84 L162 28 C 144 20, 116 20, 100 30 Z M100 30 V86" style={ink} />
    <path d="M50 40 C 62 36, 78 37, 90 42 M50 51 C 62 47, 78 48, 90 53 M50 62 C 62 58, 78 59, 90 64" style={{ ...ink, strokeOpacity: 0.6 }} />
    <path d="M110 42 C 122 37, 138 36, 150 40 M110 53 C 122 48, 138 47, 150 51" style={{ ...ink, strokeOpacity: 0.6 }} />
    <path d="M110 64 C 122 59, 138 58, 150 62" style={{ ...ink, stroke: "var(--glow)", strokeWidth: 2.6 }} />
    <path d="M118 22 v22 l7 -6 l7 6 v-22" style={{ ...inkFill(0.9), stroke: "none" }} />
    <circle cx="125" cy="12" r="3.2" style={glowFill()} /><circle cx="150" cy="18" r="2" style={glowFill(0.7)} /><circle cx="52" cy="16" r="2.4" style={glowFill(0.8)} />
  </>;
}

/** A stack of pages above a tray, with a lit arrow dropping in. */
function Download() {
  return <>
    <rect x="68" y="14" width="52" height="64" rx="5" style={inkFill(0.14)} />
    <rect x="78" y="8" width="52" height="64" rx="5" style={inkFill(0.22)} />
    <rect x="78" y="8" width="52" height="64" rx="5" style={ink} />
    <path d="M88 22 h32 M88 32 h32 M88 42 h20" style={{ ...ink, strokeOpacity: 0.6 }} />
    <path d="M104 46 v22 M94 58 l10 10 l10 -10" style={{ ...ink, stroke: "var(--glow)", strokeWidth: 3 }} />
    <path d="M52 76 h96 l-8 16 h-80 Z" style={inkFill(0.5)} />
    <path d="M52 76 h96 l-8 16 h-80 Z" style={ink} />
    <path d="M70 84 h60" style={{ ...ink, strokeOpacity: 0.5 }} />
    <circle cx="50" cy="26" r="3" style={glowFill(0.85)} /><circle cx="152" cy="40" r="2.2" style={glowFill(0.7)} />
  </>;
}

const motifs: Record<CatalogKind, () => ReactNode> = { course: Course, download: Download };

/** The CSS variables for one type's colour family, set on the art's root so every layer reads them. */
export function catalogTypeArtVars(kind: CatalogKind): CSSProperties {
  const slot = slots[kind];
  return { "--from": `var(--art-${slot}-from)`, "--to": `var(--art-${slot}-to)`, "--glow": `var(--art-${slot}-glow)`, "--ink": `var(--art-${slot}-ink)` } as CSSProperties;
}

const layers: CSSProperties = {
  backgroundImage: [
    "radial-gradient(color-mix(in oklab, var(--ink) 9%, transparent) 0.6px, transparent 0.8px)",
    "radial-gradient(120% 140% at 92% -10%, color-mix(in oklab, var(--glow) 42%, transparent), transparent 58%)",
    "radial-gradient(90% 120% at -5% 110%, color-mix(in oklab, var(--to) 80%, transparent), transparent 60%)",
    "linear-gradient(135deg, var(--from), var(--to))",
  ].join(", "),
  backgroundSize: "7px 7px, 100% 100%, 100% 100%, 100% 100%",
};

/**
 * Decorative header art for a catalogue type. `variant="card"` is the band on the type cards; `variant="cover"` fills the box the caller sizes (a
 * list row thumbnail, the preview and public cover: the catalogue has no cover image yet, so this is the cover). Size it with `className`.
 */
export function CatalogTypeArt({ kind, variant = "card", className }: { kind: CatalogKind; variant?: "card" | "cover"; className?: string }) {
  const Motif = motifs[kind];
  return <span aria-hidden="true" data-catalog-type-art={kind} className={cn("relative isolate block overflow-hidden", variant === "card" ? "h-28" : "h-full min-h-10", className)}
    style={{ ...catalogTypeArtVars(kind), ...layers }}>
    <svg viewBox="0 0 320 120" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 size-full" focusable="false">
      <circle cx="292" cy="112" r="64" style={inkFill(0.06)} />
      <circle cx="22" cy="6" r="44" style={inkFill(0.05)} />
      <path d="M0 96 C 80 78, 160 118, 320 88 L320 120 L0 120 Z" style={inkFill(0.08)} />
      <path d="M0 104 C 90 92, 200 116, 320 100 M0 112 C 100 102, 210 122, 320 110" style={{ fill: "none", stroke: "var(--ink)", strokeOpacity: 0.12, strokeWidth: 1 }} />
    </svg>
    <svg viewBox="0 0 200 104" preserveAspectRatio="xMidYMid meet" focusable="false"
      className={cn("absolute inset-x-0 mx-auto h-full w-full drop-shadow-[0_4px_8px_color-mix(in_oklab,var(--to)_30%,transparent)]", variant === "card" ? "top-0 py-3" : "inset-y-0 py-[8%]")}>
      <Motif />
    </svg>
  </span>;
}
