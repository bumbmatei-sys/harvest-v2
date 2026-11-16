"use client";
import { useTranslations } from "next-intl";
import { LayoutDashboard, Globe, Sparkles, type LucideIcon } from "lucide-react";
import { navModes, type NavMode } from "@/lib/navigation";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSidebar } from "@/components/ui/sidebar";

const icons: Record<NavMode, LucideIcon> = { operations: LayoutDashboard, public: Globe, assistant: Sparkles };
const labelKeys = { operations: "modeOperations", public: "modePublic", assistant: "modeAssistant" } as const;
export const modeLabelKey = (mode: NavMode) => labelKeys[mode];
const columns = ["", "grid-cols-1", "grid-cols-2", "grid-cols-3"];

// Selected styling uses aria-selected: the tooltip trigger overwrites data-state on the same element.
/**
 * Mode switcher at the top of the sidebar: icon + label segments when expanded (and in the drawer), stacked icons with tooltips in the rail.
 * Shared Tabs primitive supplies tablist semantics, roving focus, arrows and Home/End; choosing a mode never navigates.
 */
export function ModeSwitcher(props: { modes: readonly NavMode[]; active: NavMode; controls: string; onSelect: (mode: NavMode) => void }) {
  const { state, isMobile } = useSidebar();
  return <ModeSwitcherView {...props} rail={state === "collapsed" && !isMobile} />;
}
/** Presentation only (no sidebar context), so the development showcase can render all three modes. */
export function ModeSwitcherView({ modes, active, controls, onSelect, rail }: { modes: readonly NavMode[]; active: NavMode; controls?: string; onSelect: (mode: NavMode) => void; rail: boolean }) {
  const t = useTranslations("ComponentsAppShell");
  // Three segments do not fit icon + label side by side in the 256px sidebar: stack them.
  const stacked = modes.length > 2;
  return <Tabs value={active} onValueChange={(value) => onSelect(value as NavMode)} orientation={rail ? "vertical" : "horizontal"} className="shrink-0 gap-0 px-[13px] pb-1 group-data-[collapsible=icon]:px-0">
    <TabsList aria-label={t("modeSwitcher")} data-mode-switcher className={`grid w-full group-data-[orientation=horizontal]/tabs:h-auto gap-1 rounded-[10px] p-1 group-data-[collapsible=icon]:mx-auto group-data-[collapsible=icon]:w-9 group-data-[collapsible=icon]:grid-cols-1 group-data-[collapsible=icon]:bg-transparent group-data-[collapsible=icon]:p-0 ${columns[modes.length] ?? "grid-cols-3"}`}>
      {modes.map((mode) => {
        const Icon = icons[mode], label = t(labelKeys[mode]), shortcut = navModes.indexOf(mode) + 1;
        const trigger = <TabsTrigger value={mode} aria-controls={controls} aria-keyshortcuts={`Control+Alt+${shortcut} Meta+Alt+${shortcut}`} data-mode={mode}
          className={`h-auto min-h-11 w-full ${stacked ? "flex-col gap-0.5 px-1 text-[11px] lg:min-h-11 group-data-[collapsible=icon]:flex-row" : "gap-1.5 px-1.5 text-xs lg:min-h-8"} aria-selected:border-border aria-selected:bg-card aria-selected:font-semibold aria-selected:text-foreground aria-selected:shadow-sm dark:aria-selected:border-border dark:aria-selected:bg-card min-w-0 justify-center group-data-[collapsible=icon]:size-9 group-data-[collapsible=icon]:min-h-0 group-data-[collapsible=icon]:p-0`}>
          <Icon aria-hidden="true" className="size-[15px] stroke-[1.7]" /><span className="truncate group-data-[collapsible=icon]:sr-only">{label}</span>
        </TabsTrigger>;
        return <Tooltip key={mode} open={rail ? undefined : false}><TooltipTrigger asChild>{trigger}</TooltipTrigger>
          <TooltipContent side="right" align="center">{t("modeTooltip", { mode: label, shortcut })}</TooltipContent></Tooltip>;
      })}
    </TabsList>
  </Tabs>;
}
