import type { CSSProperties } from "react";
import type { LucideIcon } from "lucide-react";
import type { Accent } from "@/lib/theme-registry";
import { cn } from "@/lib/utils";

/** CSS variables naming one accent (`--accent-current`, `--accent-current-soft`). Set them on a wrapper to tint everything below that reads them. */
export function accentVars(accent: Accent | null | undefined): CSSProperties {
  return accent ? { "--accent-current": `var(--accent-${accent})`, "--accent-current-soft": `var(--accent-${accent}-soft)` } as CSSProperties : {};
}

const sizes = { sm: "size-8 rounded-lg [&_svg]:size-4", md: "size-10 rounded-xl [&_svg]:size-5", lg: "size-12 rounded-xl [&_svg]:size-6" } as const;

/**
 * A rounded icon tile tinted with one accent: the soft fill, the accent icon and a hairline ring of the same hue. `tone="neutral"` keeps the tile on the
 * theme's muted surface and border and colours only the icon (for long lists such as departments and features). Decorative (aria-hidden); the meaning
 * is always in the text beside it. Without `accent` it reads the inherited `--accent-current`, and falls back to the neutral muted tile.
 */
export function AccentIcon({ icon: Icon, accent, tone = "soft", size = "md", className }: {
  icon: LucideIcon; accent?: Accent | null; tone?: "soft" | "neutral"; size?: keyof typeof sizes; className?: string;
}) {
  return <span aria-hidden="true" data-slot="accent-icon" data-accent={accent ?? undefined} data-tone={tone} style={accentVars(accent)}
    className={cn("inline-flex shrink-0 items-center justify-center text-[color:var(--accent-current,var(--foreground))]",
      tone === "neutral" ? "border bg-muted" : "bg-[color:var(--accent-current-soft,var(--muted))] ring-1 ring-inset ring-[color:color-mix(in_oklab,var(--accent-current,var(--border))_22%,transparent)]",
      sizes[size], className)}>
    <Icon />
  </span>;
}
