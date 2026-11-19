/** Layout and behaviour modelled on bumbmatei-sys/chat-app (Shadcn UI Kit, premium, founder-supplied 19 Nov 2026): app/(auth)/chats/components/chat-content.tsx; code written for Harvest, no kit code copied. Harvest notes: docs/ui-sources.md. */
"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { MessageScroller, MessageScrollerButton, MessageScrollerContent, MessageScrollerProvider, MessageScrollerViewport, useMessageScrollerScrollable } from "@/components/ui/message-scroller";

/** Shared by channel and private message panes: the read mark, the scrolling list and the screen reader notice for new messages. */
export async function chatRequest(path: string, method: string, body?: unknown) {
  return fetch(path, { method, headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body) });
}

export function ReadState({ seq, enabled, endpoint, onRead }: { seq?: string; enabled: boolean; endpoint: string; onRead: () => void }) {
  const { end } = useMessageScrollerScrollable();
  const sent = useRef("0");
  useEffect(() => {
    if (end || !enabled || !seq || BigInt(seq) <= BigInt(sent.current)) return;
    let active = true;
    const timer = setTimeout(async () => {
      if (document.visibilityState !== "visible" || !document.hasFocus()) return;
      try {
        const response = await chatRequest(endpoint, "PUT", { upTo: seq });
        if (response.ok && active) {
          sent.current = seq;
          onRead();
        }
      } catch { /* A later revision or focus change can retry. */ }
    }, 500);
    return () => { active = false; clearTimeout(timer); };
  }, [enabled, end, endpoint, onRead, seq]);
  return null;
}

export function MessageList({ children, label, className, onLatest }: {
  children: React.ReactNode;
  label: string;
  className?: string;
  onLatest?: React.ReactNode;
}) {
  const t = useTranslations("CommunityChat");
  return <MessageScrollerProvider autoScroll defaultScrollPosition="end">
    <MessageScroller className={className}>
      <MessageScrollerViewport aria-label={label} role="region">
        <MessageScrollerContent className="p-3 md:p-4" role="presentation" aria-live="off">{children}</MessageScrollerContent>
      </MessageScrollerViewport>
      <MessageScrollerButton label={t("jumpLatest")} />
      {onLatest}
    </MessageScroller>
  </MessageScrollerProvider>;
}

export function LiveMessageNotice({ latest, enabled }: { latest?: { id: string; name: string }; enabled: boolean }) {
  const t = useTranslations("CommunityChat");
  const { end } = useMessageScrollerScrollable();
  return <div role="log" aria-label={t("newMessages")} aria-live={enabled && !end ? "polite" : "off"} aria-relevant="additions text" className="sr-only">
    {latest && <span key={latest.id}>{t("newMessageFrom", { name: latest.name })}</span>}
  </div>;
}


const onlineEvents = (callback: () => void) => {
  window.addEventListener("offline", callback);
  window.addEventListener("online", callback);
  return () => {
    window.removeEventListener("offline", callback);
    window.removeEventListener("online", callback);
  };
};
const focusEvents = (callback: () => void) => {
  window.addEventListener("focus", callback);
  window.addEventListener("blur", callback);
  document.addEventListener("visibilitychange", callback);
  return () => {
    window.removeEventListener("focus", callback);
    window.removeEventListener("blur", callback);
    document.removeEventListener("visibilitychange", callback);
  };
};
export const useOnline = () => useSyncExternalStore(onlineEvents, () => navigator.onLine, () => true);
export const useWindowFocused = () => useSyncExternalStore(focusEvents, () => document.visibilityState === "visible" && document.hasFocus(), () => false);
