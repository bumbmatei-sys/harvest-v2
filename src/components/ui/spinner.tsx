"use client"
import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { LoaderCircleIcon } from "lucide-react"
import { useTranslations } from "next-intl"
import { cn } from "@/lib/utils"

const spinnerVariants = cva("shrink-0 animate-spin text-current motion-reduce:animate-none", {
  variants: { size: { sm: "size-3", default: "size-4", lg: "size-6" } },
  defaultVariants: { size: "default" },
})

type SpinnerProps = Omit<React.ComponentProps<"svg">, "children"> &
  VariantProps<typeof spinnerVariants> & {
    /** Accessible name. Defaults to the catalogue's "Loading". Ignored when `decorative`. */
    label?: string
    /** Use inside a control that already announces its busy state in text (for example a button label). */
    decorative?: boolean
  }

/** Loading indicator. Announced as a status unless `decorative`; stops rotating under reduced motion. */
function Spinner({ className, size, label, decorative = false, ...props }: SpinnerProps) {
  const t = useTranslations("ComponentsUiSpinner")
  return (
    <LoaderCircleIcon
      data-slot="spinner"
      data-size={size ?? "default"}
      {...(decorative
        ? { "aria-hidden": true }
        : { role: "status", "aria-label": label ?? t("loading") })}
      className={cn(spinnerVariants({ size }), className)}
      {...props}
    />
  )
}

export { Spinner, spinnerVariants }
