"use client";
import { RotateCw } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { defineStatusTones } from "@/lib/status-tone";
import type { ConnectionView, Delivery } from "@/lib/social/api";
import { platformLabels } from "@/lib/social/labels";
import { formatWhen } from "@/lib/social/time";
import { RingMark } from "@/components/social/platform-ring";
import { useReason } from "@/components/social/use-reason";

export const deliveryTone = defineStatusTones({ draft: "neutral", scheduled: "info", queued: "info", publishing: "pending", published: "success", failed: "danger", cancelled: "neutral", unknown: "warning" });

/** One row per destination of a post: its own status and, for a failed one, a retry that touches that destination only. */
export function DeliveryResults({ deliveries, connections, retrying, onRetry }: {
  deliveries: readonly Delivery[]; connections: readonly ConnectionView[]; retrying?: string | null; onRetry?: (delivery: Delivery) => void;
}) {
  const t = useTranslations("SocialPublish.results"), status = useTranslations("SocialPublish.status"), reason = useReason(), locale = useLocale();
  return <ul className="m-0 list-none space-y-2 p-0" data-testid="delivery-results">
    {deliveries.map((delivery) => {
      const connection = connections.find((item) => item.id === delivery.connectionId);
      return <li key={delivery.id} className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3" data-delivery-status={delivery.status}>
        {connection && <RingMark platform={connection.platform} active={false} size={32} className="[&>span]:size-6 [&>span]:text-[10px]" />}
        <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{connection ? platformLabels[connection.platform] : t("account")} <span className="font-normal text-muted-foreground">{connection?.displayName}</span></p>
          <p className="truncate text-xs text-muted-foreground">{delivery.lastErrorCode ? reason(delivery.lastErrorCode) : delivery.scheduledFor ? formatWhen(delivery.scheduledFor, delivery.displayTimezone, locale) : ""}</p></div>
        <StatusBadge tone={deliveryTone(delivery.status)} label={status(delivery.status)} dot />
        {delivery.retryable && onRetry && <Button type="button" variant="outline" size="responsive" disabled={retrying === delivery.id} onClick={() => onRetry(delivery)}><RotateCw aria-hidden="true" />{t("retry")}</Button>}
      </li>;
    })}
  </ul>;
}
