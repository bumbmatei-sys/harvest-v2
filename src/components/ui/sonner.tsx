"use client"
import * as React from "react"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleAlertIcon, CircleCheckIcon, InfoIcon, XIcon } from "lucide-react"
import { useTranslations } from "next-intl"
import { useMediaQuery } from "@/hooks/use-media-query"

/** Sonner switches to its full-width phone layout at this width; the position follows the same breakpoint. */
const phoneQuery = "(max-width: 600px)"
/** Distance from the screen edge plus the device safe area (notch, home indicator), so a toast never sits under either. */
const edge = (gap: number, side: "top" | "right" | "bottom" | "left") => `calc(${gap}px + env(safe-area-inset-${side}, 0px))`

/**
 * The one global toast outlet (mounted once in the root layout). All colors come from the theme tokens, so every palette and
 * light/dark mode inherits them; text is supplied by callers from the message catalogue (see `src/lib/toast.ts`).
 * Messages are announced politely and are never the only place an error appears next to a form field.
 * One position for the whole app: bottom right from 601px; on phones full width at the top, clear of the bottom navigation, sticky save
 * bars, the chat composer and the on-screen keyboard. Both keep the safe-area insets.
 */
function Toaster({ ...props }: ToasterProps) {
  const t = useTranslations("ComponentsUiToaster")
  const phone = useMediaQuery(phoneQuery)
  return (
    <Sonner
      position={phone ? "top-center" : "bottom-right"}
      offset={{ top: edge(24, "top"), right: edge(24, "right"), bottom: edge(24, "bottom"), left: edge(24, "left") }}
      mobileOffset={{ top: edge(16, "top"), right: edge(16, "right"), bottom: edge(16, "bottom"), left: edge(16, "left") }}
      duration={5000}
      visibleToasts={3}
      closeButton
      containerAriaLabel={t("notifications")}
      hotkey={["altKey", "KeyT"]}
      icons={{
        success: <CircleCheckIcon aria-hidden="true" className="size-4 text-success" />,
        error: <CircleAlertIcon aria-hidden="true" className="size-4 text-destructive" />,
        info: <InfoIcon aria-hidden="true" className="size-4 text-muted-foreground" />,
        close: <XIcon aria-hidden="true" className="size-3.5" />,
      }}
      style={{
        "--normal-bg": "var(--popover)",
        "--normal-text": "var(--popover-foreground)",
        "--normal-border": "var(--border)",
        "--border-radius": "var(--radius)",
      } as React.CSSProperties}
      toastOptions={{
        closeButtonAriaLabel: t("close"),
        classNames: {
          toast: "!shadow-lg !font-sans !text-sm !gap-3",
          title: "!font-medium !text-popover-foreground",
          description: "!text-muted-foreground",
          // Action targets are 44px on phones, like every Harvest button.
          actionButton: "!inline-flex !h-11 !items-center !rounded-md !bg-primary !px-3 !text-sm !font-medium !text-primary-foreground lg:!h-9",
          closeButton: "!size-11 !border-border !bg-popover !text-popover-foreground lg:!size-6",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
