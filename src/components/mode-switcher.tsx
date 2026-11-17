"use client";
import { useTranslations } from "next-intl";
import { LayoutDashboard, Megaphone, Sparkles, type LucideIcon } from "lucide-react";
import { navModes, type NavMode } from "@/lib/navigation";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSidebar } from "@/components/ui/sidebar";

const icons: Record<NavMode, LucideIcon> = { operations: LayoutDashboard, public: Megaphone, assistant: Sparkles };
const labelKeys = { operations: "modeOperations", public: "modePublic", assistant: "modeAssistant" } as const;
export const modeLabelKey = (mode: NavMode) => labelKeys[mode];

/**
 * Compact icon pill that sits in the sidebar header row beside the logo (Eden pattern, Studio Admin style): bare icons, the selected
 * mode on a filled rounded segment. Icon-only, so every tab carries its catalogue name as aria-label, a tooltip with name and shortcut,
 * and aria-keyshortcuts. Shared Tabs primitive supplies tablist semantics, roving tabindex, arrows and Home/End; choosing a mode never navigates.
 * Hit areas are 44px below 1024px; visually compact from lg. Selected styling uses aria-selected because the tooltip trigger overwrites data-state.
 */
export function ModeSwitcher(props: { modes: readonly NavMode[]; active: NavMode; controls: string; onSelect: (mode: NavMode) => void }) {
  const { state, isMobile } = useSidebar();
  return <ModeSwitcherView {...props} rail={state === "collapsed" && !isMobile} tooltips={!isMobile} />;
}
/** Presentation only (no sidebar context), so the development showcase can render all three modes. */
export function ModeSwitcherView({ modes, active, controls, onSelect, rail, tooltips }: { modes: readonly NavMode[]; active: NavMode; controls?: string; onSelect: (mode: NavMode) => void; rail: boolean; tooltips: boolean }) {
  const t = useTranslations("ComponentsAppShell");
  return <Tabs value={active} onValueChange={(value) => onSelect(value as NavMode)} orientation={rail ? "vertical" : "horizontal"} className="shrink-0 gap-0">
    <TabsList aria-label={t("modeSwitcher")} data-mode-switcher className="inline-flex h-auto w-auto gap-0.5 rounded-lg bg-muted p-0.5 group-data-[orientation=horizontal]/tabs:h-auto group-data-[orientation=vertical]/tabs:w-auto group-data-[collapsible=icon]:flex-col">
      {modes.map((mode) => {
        const Icon = icons[mode], label = t(labelKeys[mode]), shortcut = navModes.indexOf(mode) + 1;
        const trigger = <TabsTrigger value={mode} aria-label={label} aria-controls={controls} aria-keyshortcuts={`Control+Alt+${shortcut} Meta+Alt+${shortcut}`} data-mode={mode}
          className="h-auto size-11 min-w-0 flex-none rounded-md p-0 text-sidebar-foreground/70 hover:text-sidebar-accent-foreground aria-selected:border-border aria-selected:bg-card aria-selected:text-foreground aria-selected:shadow-sm dark:aria-selected:border-border dark:aria-selected:bg-card lg:size-7 group-data-[collapsible=icon]:size-7 [&_svg:not([class*='size-'])]:size-4">
          <Icon aria-hidden="true" className="stroke-[1.7]" />
        </TabsTrigger>;
        return <Tooltip key={mode} open={tooltips ? undefined : false}><TooltipTrigger asChild>{trigger}</TooltipTrigger>
          <TooltipContent side={rail ? "right" : "bottom"} align="center">{t("modeTooltip", { mode: label, shortcut })}</TooltipContent></Tooltip>;
      })}
    </TabsList>
  </Tabs>;
}
