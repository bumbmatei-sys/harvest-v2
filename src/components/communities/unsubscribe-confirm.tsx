"use client";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { request } from "@/hooks/use-request";
import { unsubscribeTokenFromHash } from "@/lib/community-unsubscribe";
import { notify } from "@/lib/toast";

/**
 * C15c: asks before switching a community's email off. The token is taken from the fragment once and the fragment is then
 * removed from the address bar. Whatever the token, the result is the same neutral message, as the route's answer is.
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
  return <Card className="w-full">
    <CardHeader aria-live="polite">
      <CardTitle><h1 className="text-2xl font-semibold tracking-tight">{done ? t("doneTitle") : t("title")}</h1></CardTitle>
      <CardDescription className="text-base">{done ? t("doneBody") : t("body")}</CardDescription>
    </CardHeader>
    {!done && <CardFooter><Button className="min-h-11" disabled={busy} onClick={() => void confirm()}>{t("confirm")}</Button></CardFooter>}
  </Card>;
}
