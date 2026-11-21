"use client";
import { ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { SidebarGroup, SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar";
import { editorStepViews, type EditorContext } from "@/lib/editor-context";
import { menuButton } from "@/components/shell-styles";
import { ContextualBack } from "@/components/editor/contextual-sidebar";
import { focusStepHeadingWhenDrawerCloses, StepIndicator, StepStatusText } from "@/components/editor/editor-step-parts";

/**
 * The item's own sidebar body while an editor is open (shell slice 3a): back link, item name with status, numbered steps, Open page.
 * Replaces only the entry list; the logo row with the mode switcher and the account footer stay. In the icon rail it shows the back arrow
 * and numbered step markers with tooltips.
 */
export function EditingSidebar({ context, id }: { context: EditorContext; id: string }) {
  const t = useTranslations("EditorMode");
  const { setOpenMobile, isMobile } = useSidebar();
  const steps = editorStepViews(context.steps, context.current);
  return <div id={id} role="group" aria-label={t("editing", { title: context.title })} data-shell-editing className="flex min-h-full flex-col">
    <ContextualBack href={context.back.href} label={context.back.label} />
    <div className="mt-3 space-y-1 px-[21px] group-data-[collapsible=icon]:hidden">
      <p className="truncate text-sm font-semibold text-sidebar-accent-foreground" title={context.title} data-editor-title>{context.title}</p>
      <div className="flex flex-wrap items-center gap-2">
        {context.typeLabel && <span className="text-xs text-sidebar-foreground/85">{context.typeLabel}</span>}
        <Badge variant={context.status.kind === "live" ? "default" : "secondary"} data-editor-status={context.status.kind}>{context.status.label}</Badge>
      </div>
      {context.dirty && <p className="text-xs text-sidebar-foreground/85">{t("unsaved")}</p>}
    </div>
    <SidebarGroup className="mt-4 px-[13px] py-0 group-data-[collapsible=icon]:mt-2 group-data-[collapsible=icon]:px-0">
      <nav aria-label={context.stepsLabel} data-editor-steps>
        <ol data-slot="sidebar-menu" data-sidebar="menu" className="flex w-full min-w-0 flex-col gap-px">
          {steps.map((step) => <SidebarMenuItem key={step.id}>
            <SidebarMenuButton isActive={step.current} tooltip={isMobile ? undefined : step.label} className={menuButton}
              aria-current={step.current ? "step" : undefined} aria-disabled={!step.selectable || undefined}
              onClick={() => { if (!step.selectable) return; context.onStep(step.id); if (isMobile) { setOpenMobile(false); focusStepHeadingWhenDrawerCloses(); } }}>
              <StepIndicator step={step} />
              <span className="min-w-0 flex-1 truncate text-left group-data-[collapsible=icon]:sr-only">{step.label}</span>
              {step.badge && <span className="shrink-0 rounded-md bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground group-data-[collapsible=icon]:hidden">{step.badge}</span>}
              <StepStatusText step={step} />
            </SidebarMenuButton></SidebarMenuItem>)}
        </ol>
      </nav>
    </SidebarGroup>
    {context.openPage && <SidebarGroup className="mt-auto px-[13px] pb-2 pt-4 group-data-[collapsible=icon]:px-0">
      <SidebarMenu className="gap-px"><SidebarMenuItem>
        <SidebarMenuButton asChild tooltip={isMobile ? undefined : context.openPage.label} className={menuButton}>
          <a href={context.openPage.href} target="_blank" rel="noopener" data-editor-open-page>
            <ExternalLink aria-hidden="true" /><span className="group-data-[collapsible=icon]:sr-only">{context.openPage.label}</span></a>
        </SidebarMenuButton></SidebarMenuItem></SidebarMenu>
    </SidebarGroup>}
  </div>;
}
