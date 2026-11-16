"use client"
import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { ToggleGroup as ToggleGroupPrimitive } from "radix-ui"
import { cn } from "@/lib/utils"

const toggleGroupItemVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 text-sm font-medium whitespace-nowrap outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:z-10 focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 data-[state=on]:bg-accent data-[state=on]:text-accent-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: { default: "bg-transparent", outline: "border bg-transparent shadow-xs" },
      // 44px targets below 1024px, the same rule as Button's responsive sizes.
      size: {
        default: "h-11 min-w-11 px-3 lg:h-9 lg:min-w-9",
        sm: "h-11 min-w-11 px-2.5 lg:h-8 lg:min-w-8",
        lg: "h-11 min-w-11 px-4 lg:h-10 lg:min-w-10",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
)

type ItemVariants = VariantProps<typeof toggleGroupItemVariants>
const ToggleGroupContext = React.createContext<ItemVariants & { spacing: number }>({ size: "default", variant: "default", spacing: 0 })

function ToggleGroup({
  className, variant, size, spacing = 0, children, ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Root> & ItemVariants & { spacing?: number }) {
  return (
    <ToggleGroupPrimitive.Root
      data-slot="toggle-group"
      data-variant={variant}
      data-size={size}
      data-spacing={spacing}
      className={cn("group/toggle-group flex w-fit items-center rounded-md", className)}
      {...props}
      style={{ gap: `${spacing * 0.25}rem`, ...props.style }}
    >
      <ToggleGroupContext.Provider value={{ variant, size, spacing }}>{children}</ToggleGroupContext.Provider>
    </ToggleGroupPrimitive.Root>
  )
}

function ToggleGroupItem({
  className, children, variant, size, ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Item> & ItemVariants) {
  const context = React.useContext(ToggleGroupContext)
  const resolvedVariant = context.variant ?? variant, resolvedSize = context.size ?? size
  return (
    <ToggleGroupPrimitive.Item
      data-slot="toggle-group-item"
      data-variant={resolvedVariant}
      data-size={resolvedSize}
      data-spacing={context.spacing}
      className={cn(
        toggleGroupItemVariants({ variant: resolvedVariant, size: resolvedSize }),
        // Joined items share edges and corners; spaced items keep their own.
        context.spacing === 0
          ? "rounded-none shadow-none first:rounded-s-md last:rounded-e-md data-[variant=outline]:border-s-0 data-[variant=outline]:first:border-s"
          : "rounded-md",
        className
      )}
      {...props}
    >
      {children}
    </ToggleGroupPrimitive.Item>
  )
}

export { ToggleGroup, ToggleGroupItem, toggleGroupItemVariants }
