"use client"

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Tabs as TabsPrimitive } from "radix-ui"

function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      orientation={orientation}
      className={cn(
        "group/tabs flex gap-2 data-[orientation=horizontal]:flex-col",
        className
      )}
      {...props}
    />
  )
}

const tabsListVariants = cva(
  "group/tabs-list inline-flex w-fit max-w-full items-center justify-start overflow-x-auto rounded-lg p-0.5 text-muted-foreground [scrollbar-width:none] [&::-webkit-scrollbar]:hidden group-data-[orientation=horizontal]/tabs:h-8 group-data-[orientation=horizontal]/tabs:flex-nowrap group-data-[orientation=vertical]/tabs:h-fit group-data-[orientation=vertical]/tabs:flex-col group-data-[orientation=vertical]/tabs:overflow-visible data-[variant=line]:rounded-none " +
  // Compact (32px) in one row that scrolls sideways inside the bar. Below 1024px the bar box is 44px tall with transparent bands (background clipped to the content box, radius enlarged to stay round) and a negative margin, so the 44px triggers are not clipped and the bar still looks 32px.
  "max-lg:group-data-[orientation=horizontal]/tabs:-my-1.5 max-lg:group-data-[orientation=horizontal]/tabs:h-11 max-lg:group-data-[orientation=horizontal]/tabs:py-1.5 max-lg:group-data-[orientation=horizontal]/tabs:rounded-[0.875rem] max-lg:group-data-[orientation=horizontal]/tabs:bg-clip-content max-lg:group-data-[orientation=horizontal]/tabs:px-0.5",
  {
    variants: {
      variant: {
        default: "bg-muted",
        line: "gap-1 bg-transparent",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function TabsList({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> &
  VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
  )
}

function TabsTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  // The trigger is the touch target; the inner pill is what you see. Horizontal tabs show a compact 28px pill, and below 1024px the trigger
  // itself is 44px tall (negative margin, so the bar stays compact) so every tab keeps a full touch height.
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "group/tab relative inline-flex flex-none items-stretch justify-center gap-1.5 text-sm font-medium whitespace-nowrap text-muted-foreground outline-none hover:text-foreground disabled:pointer-events-none disabled:opacity-50 data-[state=active]:text-foreground dark:text-muted-foreground dark:hover:text-foreground dark:data-[state=active]:text-foreground",
        "group-data-[orientation=horizontal]/tabs:h-7 max-lg:group-data-[orientation=horizontal]/tabs:-my-2 max-lg:group-data-[orientation=horizontal]/tabs:h-11 max-lg:group-data-[orientation=horizontal]/tabs:py-2",
        "group-data-[orientation=vertical]/tabs:min-h-7 group-data-[orientation=vertical]/tabs:w-full",
        className
      )}
      {...props}
    >
      <span
        data-slot="tabs-trigger-pill"
        className={cn(
          "relative inline-flex w-full items-center justify-center gap-[inherit] rounded-md border border-transparent px-2.5 transition-all group-data-[orientation=vertical]/tabs:justify-start group-data-[orientation=vertical]/tabs:py-1 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
          "group-focus-visible/tab:border-ring group-focus-visible/tab:ring-[3px] group-focus-visible/tab:ring-ring/50 group-focus-visible/tab:outline-1 group-focus-visible/tab:outline-ring",
          "group-data-[state=active]/tab:bg-background group-data-[variant=default]/tabs-list:group-data-[state=active]/tab:shadow-sm dark:group-data-[state=active]/tab:border-input dark:group-data-[state=active]/tab:bg-input/30",
          "group-data-[variant=line]/tabs-list:group-data-[state=active]/tab:bg-transparent group-data-[variant=line]/tabs-list:group-data-[state=active]/tab:shadow-none dark:group-data-[variant=line]/tabs-list:group-data-[state=active]/tab:border-transparent dark:group-data-[variant=line]/tabs-list:group-data-[state=active]/tab:bg-transparent",
          "after:absolute after:bg-foreground after:opacity-0 after:transition-opacity group-data-[orientation=horizontal]/tabs:after:inset-x-0 group-data-[orientation=horizontal]/tabs:after:-bottom-px group-data-[orientation=horizontal]/tabs:after:h-0.5 group-data-[orientation=vertical]/tabs:after:inset-y-0 group-data-[orientation=vertical]/tabs:after:-right-1 group-data-[orientation=vertical]/tabs:after:w-0.5 group-data-[variant=line]/tabs-list:group-data-[state=active]/tab:after:opacity-100"
        )}
      >
        {children}
      </span>
    </TabsPrimitive.Trigger>
  )
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("flex-1 outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
