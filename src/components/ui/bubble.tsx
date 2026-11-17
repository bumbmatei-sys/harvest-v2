/** Derived from Shadcn UI Kit item bubble1 (free). Shared by bubble1–bubble7. */
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function Bubble({ variant = "muted", align = "start", className, ...props }: ComponentProps<"div"> & {
  variant?: "muted" | "tinted";
  align?: "start" | "end";
}) {
  return <div data-slot="bubble" data-variant={variant} data-align={align}
    className={cn("group/bubble relative flex w-fit max-w-[85%] min-w-0 flex-col gap-1 data-[align=end]:self-end", className)} {...props} />;
}

export function BubbleContent({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="bubble-content" className={cn(
    "w-fit max-w-full min-w-0 rounded-2xl border border-transparent bg-muted px-3.5 py-2.5 text-sm leading-relaxed break-words",
    "group-data-[variant=tinted]/bubble:bg-primary/10 group-data-[align=end]/bubble:self-end",
    className,
  )} {...props} />;
}
