"use client";
import { Eye, Heart, ClipboardList, MessageCircle, MousePointerClick, PlayCircle, Smartphone, Sparkles, TrendingUp, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AdGoal } from "@/lib/ads/ads";

/** The icon tile used beside each objective in the picker. */
export const objectiveIcon: Record<AdGoal, LucideIcon> = {
  awareness: Eye, traffic: MousePointerClick, engagement: Heart, video_views: PlayCircle, lead_generation: ClipboardList, messages: MessageCircle, conversions: TrendingUp, app_promotion: Smartphone,
};

/**
 * The spot illustration for an objective, or a generic one while none is chosen. A neutral placeholder for now (a tinted tile with the objective's icon); the code-drawn
 * illustrations in the Harvest palette replace the body of this component and keep its props, so no caller changes.
 */
export function ObjectiveArt({ objective, className }: { objective: AdGoal | null; className?: string }) {
  const Icon = objective ? objectiveIcon[objective] : Sparkles;
  return <div aria-hidden="true" data-slot="objective-art" data-objective={objective ?? "none"} className={cn("flex aspect-[4/3] w-full max-w-60 items-center justify-center rounded-xl bg-muted text-muted-foreground", className)}>
    <Icon className="size-12" strokeWidth={1.25} />
  </div>;
}
