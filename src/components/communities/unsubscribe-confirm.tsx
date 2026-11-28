/** Derived from Shadcn UI Kit item dashboard-modal12 (premium), registry retrieved 2026-11-27, approved 2026-11-27 (Community screens). Kit code; local changes: docs/ui-sources.md. */
"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { MailCheckIcon, MailXIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { request } from "@/hooks/use-request";
import { unsubscribeTokenFromHash } from "@/lib/community-unsubscribe";
import { notify } from "@/lib/toast";

/**
 * C15c: asks before switching a community's email off, as the kit's confirmation window, which is the whole page here (it cannot be
 * dismissed). The token is taken from the fragment once and the fragment is then removed from the address bar. Whatever the token,
 * the result is the same neutral message, as the route's answer is.
 */
export function UnsubscribeConfirm() {
  const t = useTranslations("CommunityUnsubscribe");
  const token = useRef<string | null>(null);
  const [done, setDone] = useState(false), [busy, setBusy] = useState(false);
  useEffect(() => {
    // Read once: the fragment is cleared right after, so a second run (development strict mode) must not overwrite it.
    token.current ??= unsubscribeTokenFromHash(window.location.hash);
    if (window.location.hash) window.history.replaceState(window.history.state, "", window.location.pathname);
  }, []);
  async function confirm() {
    setBusy(true);
    // A missing or malformed token gets the same result without a request, so nothing on screen depends on validity.
    const result = token.current ? await request("/api/communities/unsubscribe", { method: "POST", body: { token: token.current } }) : null;
    setBusy(false);
    if (result && !result.ok && result.status === 0) { notify.error(result.error); return; }
    token.current = null; setDone(true);
  }
  const Icon = done ? MailCheckIcon : MailXIcon;

  return (
    <Dialog open>
      <DialogContent showCloseButton={false} onEscapeKeyDown={(event) => event.preventDefault()} onInteractOutside={(event) => event.preventDefault()}>
        <DialogHeader className="items-center text-center" aria-live="polite">
          <span className="bg-muted mb-2 flex size-10 items-center justify-center rounded-full">
            <Icon
              className={done ? "text-success size-5" : "text-muted-foreground size-5"}
              aria-hidden="true"
            />
          </span>
          <DialogTitle>{done ? t("doneTitle") : t("title")}</DialogTitle>
          <DialogDescription>
            {done ? t("doneBody") : t("body")}
          </DialogDescription>
        </DialogHeader>
        {!done && <DialogFooter>
          <Button className="min-h-11 w-full" disabled={busy} onClick={() => void confirm()}>
            {busy && <Spinner decorative size="sm" />}{t("confirm")}
          </Button>
        </DialogFooter>}
      </DialogContent>
    </Dialog>
  );
}
