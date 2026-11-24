"use client"
import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Toggle as TogglePrimitive } from "radix-ui"
import { cn } from "@/lib/utils"

// Same look and 44px phone targets as ToggleGroup items; a single pressed/not-pressed button (toolbars, marks).
const toggleVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 data-[state=on]:bg-accent data-[state=on]:text-accent-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: { default: "bg-transparent", outline: "border bg-transparent shadow-xs" },
      size: { default: "h-11 min-w-11 px-3 lg:h-9 lg:min-w-9", sm: "h-11 min-w-11 px-2.5 lg:h-8 lg:min-w-8", lg: "h-11 min-w-11 px-4 lg:h-10 lg:min-w-10" },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
)

function Toggle({ className, variant, size, ...props }: React.ComponentProps<typeof TogglePrimitive.Root> & VariantProps<typeof toggleVariants>) {
  return <TogglePrimitive.Root data-slot="toggle" className={cn(toggleVariants({ variant, size, className }))} {...props} />
}
export { Toggle, toggleVariants }
