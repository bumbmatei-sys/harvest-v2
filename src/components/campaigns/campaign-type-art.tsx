import type { CSSProperties, ReactNode } from "react";
import type { campaignTypes } from "@/lib/campaigns";
import { cn } from "@/lib/utils";

// Original, code-drawn header art for the campaign types: refined gold-led gradients, a fine grain, soft shapes and one fine line motif per type.
// Colours come only from the palette's `--art-1..5-*` tokens (every theme in theme-registry.ts defines them) (light and dark values), so it follows the colour scheme and needs no assets.
// Decorative: always aria-hidden. A <span>, so it can sit inside a button (the type cards). No hooks and no SVG ids, so it renders the same on the server, on the client and many times on one page.

type CampaignType = typeof campaignTypes[number];
// Each type's artwork family: one of the palette's five art slots (`--art-1..5-*` in every theme of the registry).
const slots: Record<CampaignType, number> = { evangelistic_crusade: 1, mission_trip: 2, conference: 3, local_outreach: 4, custom_project: 5 };

const ink = { stroke: "var(--ink)", fill: "none", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" } as const;
const inkFill = (opacity: number): CSSProperties => ({ fill: "var(--ink)", fillOpacity: opacity, stroke: "none" });
const glowFill = (opacity = 1): CSSProperties => ({ fill: "var(--glow)", fillOpacity: opacity, stroke: "none" });

/** Stage with three light beams and a crowd line. */
function Crusade() {
  return <>
    <path d="M60 6 L36 74 L84 74 Z" style={glowFill(0.28)} />
    <path d="M100 2 L80 74 L120 74 Z" style={glowFill(0.4)} />
    <path d="M140 6 L116 74 L164 74 Z" style={glowFill(0.28)} />
    <circle cx="60" cy="8" r="4" style={glowFill()} /><circle cx="100" cy="5" r="4.5" style={glowFill()} /><circle cx="140" cy="8" r="4" style={glowFill()} />
    <rect x="44" y="70" width="112" height="10" rx="3" style={inkFill(0.9)} />
    <path d="M52 80 v10 M148 80 v10" style={ink} />
    <rect x="94" y="56" width="12" height="14" rx="2" style={inkFill(0.75)} />
    {[28, 40, 52, 64, 76, 88, 100, 112, 124, 136, 148, 160, 172].map((cx, i) => <circle key={cx} cx={cx} cy={i % 2 ? 95 : 97} r="3.4" style={inkFill(0.45)} />)}
  </>;
}

/** Globe with meridians and a dashed flight path ending in a small plane. */
function Mission() {
  return <>
    <circle cx="96" cy="58" r="32" style={inkFill(0.14)} />
    <circle cx="96" cy="58" r="32" style={ink} />
    <ellipse cx="96" cy="58" rx="13" ry="32" style={{ ...ink, strokeOpacity: 0.7 }} />
    <path d="M64 58 h64 M68 42 h56 M68 74 h56" style={{ ...ink, strokeOpacity: 0.55 }} />
    <path d="M30 88 C 48 30, 120 4, 168 22" style={{ ...ink, stroke: "var(--glow)", strokeDasharray: "2 7", strokeWidth: 2.5 }} />
    <g transform="translate(170 22) rotate(18)">
      <path d="M-9 0 L9 0 M2 0 L-4 -8 M2 0 L-4 8 M-8 0 L-11 -4 M-8 0 L-11 4" style={{ ...ink, stroke: "var(--glow)", strokeWidth: 2.6 }} />
    </g>
    <circle cx="30" cy="88" r="4" style={glowFill()} />
  </>;
}

/** Presentation screen, lectern and rows of seats in perspective. */
function Conference() {
  return <>
    <rect x="62" y="8" width="76" height="40" rx="4" style={inkFill(0.18)} />
    <rect x="62" y="8" width="76" height="40" rx="4" style={ink} />
    <path d="M74 38 v-8 M86 38 v-14 M98 38 v-10 M110 38 v-18" style={{ ...ink, stroke: "var(--glow)", strokeWidth: 4 }} />
    <path d="M120 20 h10 M120 27 h7" style={{ ...ink, strokeOpacity: 0.7 }} />
    <path d="M92 66 h16 l-2 14 h-12 Z" style={inkFill(0.8)} />
    <path d="M100 48 v6" style={{ ...ink, strokeOpacity: 0.6 }} />
    {[{ y: 84, n: 7, w: 14, gap: 4 }, { y: 93, n: 8, w: 15, gap: 4 }].map((row) => {
      const width = row.n * row.w + (row.n - 1) * row.gap, start = 100 - width / 2;
      return Array.from({ length: row.n }, (_, i) => <rect key={`${row.y}-${i}`} x={start + i * (row.w + row.gap)} y={row.y} width={row.w} height="6" rx="3" style={inkFill(row.y === 84 ? 0.5 : 0.35)} />);
    })}
  </>;
}

/** Street grid with a dashed route, two houses and a map pin. */
function Outreach() {
  return <>
    <path d="M14 70 L186 44 M30 100 L170 0 M110 100 L196 30" style={{ ...ink, strokeOpacity: 0.35, strokeWidth: 7 }} />
    <path d="M14 70 L186 44 M30 100 L170 0 M110 100 L196 30" style={{ ...ink, strokeOpacity: 0.5, strokeWidth: 1, strokeDasharray: "4 6" }} />
    <path d="M40 30 l10 -8 l10 8 v12 h-20 Z" style={inkFill(0.75)} />
    <path d="M150 74 l9 -7 l9 7 v11 h-18 Z" style={inkFill(0.6)} />
    <path d="M50 88 C 70 70, 90 86, 112 66 S 136 40, 128 34" style={{ ...ink, stroke: "var(--glow)", strokeWidth: 2.5, strokeDasharray: "3 6" }} />
    <circle cx="50" cy="88" r="3.5" style={glowFill()} />
    <path d="M128 36 C 128 36, 114 22, 114 12 A 14 14 0 0 1 142 12 C 142 22, 128 36, 128 36 Z" style={{ ...inkFill(0.95), stroke: "none" }} />
    <circle cx="128" cy="12" r="5" style={glowFill()} />
  </>;
}

/** Dot grid with modular blocks and one highlighted block to add. */
function Custom() {
  const dots: ReactNode[] = [];
  for (let x = 20; x <= 180; x += 16) for (let y = 10; y <= 98; y += 16) dots.push(<circle key={`${x}-${y}`} cx={x} cy={y} r="1.3" style={inkFill(0.35)} />);
  return <>
    {dots}
    <rect x="52" y="26" width="28" height="28" rx="6" style={inkFill(0.22)} />
    <rect x="52" y="26" width="28" height="28" rx="6" style={ink} />
    <rect x="84" y="26" width="60" height="28" rx="6" style={inkFill(0.5)} />
    <rect x="52" y="58" width="60" height="28" rx="6" style={inkFill(0.35)} />
    <rect x="116" y="58" width="28" height="28" rx="6" style={glowFill(0.95)} />
    <path d="M130 66 v12 M124 72 h12" style={{ ...ink, stroke: "var(--to)", strokeWidth: 2.4 }} />
  </>;
}

const motifs: Record<CampaignType, () => ReactNode> = {
  evangelistic_crusade: Crusade, mission_trip: Mission, conference: Conference, local_outreach: Outreach, custom_project: Custom,
};

/** The CSS variables for one type's colour family, set on the art's root so every layer reads them. */
export function campaignTypeArtVars(type: CampaignType): CSSProperties {
  const slot = slots[type];
  return { "--from": `var(--art-${slot}-from)`, "--to": `var(--art-${slot}-to)`, "--glow": `var(--art-${slot}-glow)`, "--ink": `var(--art-${slot}-ink)` } as CSSProperties;
}

const layers: CSSProperties = {
  backgroundImage: [
    // Fine dot grain.
    "radial-gradient(color-mix(in oklab, var(--ink) 9%, transparent) 0.6px, transparent 0.8px)",
    // Warm highlight from the upper right and a deeper pool lower left.
    "radial-gradient(120% 140% at 92% -10%, color-mix(in oklab, var(--glow) 42%, transparent), transparent 58%)",
    "radial-gradient(90% 120% at -5% 110%, color-mix(in oklab, var(--to) 80%, transparent), transparent 60%)",
    "linear-gradient(135deg, var(--from), var(--to))",
  ].join(", "),
  backgroundSize: "7px 7px, 100% 100%, 100% 100%, 100% 100%",
};

/**
 * Decorative header art for a campaign type. `variant="card"` is the short band on the type cards; `variant="cover"` is the larger placeholder for a
 * campaign with no cover image (the caller sets its aspect ratio or height). Size it with `className`; it fills its box and stays crisp at any width.
 */
export function CampaignTypeArt({ type, variant = "card", className }: { type: CampaignType; variant?: "card" | "cover"; className?: string }) {
  const Motif = motifs[type];
  return <span aria-hidden="true" data-campaign-type-art={type} className={cn("relative isolate block overflow-hidden", variant === "card" ? "h-28" : "h-full min-h-32", className)}
    style={{ ...campaignTypeArtVars(type), ...layers }}>
    {/* Soft shapes that fill the whole band at any aspect ratio. */}
    <svg viewBox="0 0 320 120" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 size-full" focusable="false">
      <circle cx="292" cy="112" r="64" style={inkFill(0.06)} />
      <circle cx="22" cy="6" r="44" style={inkFill(0.05)} />
      <path d="M0 96 C 80 78, 160 118, 320 88 L320 120 L0 120 Z" style={inkFill(0.08)} />
      {/* Gentle field rows along the bottom: a calm, harvest-field ground line shared by every type. */}
      <path d="M0 104 C 90 92, 200 116, 320 100 M0 112 C 100 102, 210 122, 320 110" style={{ fill: "none", stroke: "var(--ink)", strokeOpacity: 0.12, strokeWidth: 1 }} />
    </svg>
    {/* The motif keeps its proportions and sits in the middle of the band. */}
    <svg viewBox="0 0 200 104" preserveAspectRatio="xMidYMid meet" focusable="false"
      className={cn("absolute inset-x-0 mx-auto h-full w-full drop-shadow-[0_4px_8px_color-mix(in_oklab,var(--to)_30%,transparent)]", variant === "card" ? "top-0 py-3" : "inset-y-0 py-[8%]")}>
      <Motif />
    </svg>
  </span>;
}

/** Cover placeholder for a campaign without a cover image: the type's art at cover size, with rounded corners from the caller. */
export function CampaignCoverPlaceholder({ type, className }: { type: CampaignType; className?: string }) {
  return <CampaignTypeArt type={type} variant="cover" className={cn("aspect-[16/7] h-auto min-h-0", className)} />;
}

