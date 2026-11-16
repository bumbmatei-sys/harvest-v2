"use client"
import * as React from "react"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleAlertIcon, CircleCheckIcon, InfoIcon, XIcon } from "lucide-react"
import { useTranslations } from "next-intl"

/**
 * The one global toast outlet (mounted once in the root layout). All colors come from the theme tokens, so every palette and
 * light/dark mode inherits them; text is supplied by callers from the message catalogue (see `src/lib/toast.ts`).
 * Messages are announced politely and are never the only place an error appears next to a form field.
 */
function Toaster({ ...props }: ToasterProps) {
  const t = useTranslations("ComponentsUiToaster")
  return (
    <Sonner
      position="bottom-right"
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
