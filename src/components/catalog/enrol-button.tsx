"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useRequest } from "@/hooks/use-request";
import type { CatalogKind } from "@/lib/catalog";

/**
 * Free enrolment for the signed-in person. Signed out, it is a sign-in link that returns to this page. The server records one enrolment and one grant, takes the
 * person from the session and answers repeated clicks with the same result; a course opens its lessons afterwards, a download shows its files on this page.
 */
export function EnrolButton({ slug, kind, signedIn, signInHref, ariaLabel }: { slug: string; kind: CatalogKind; signedIn: boolean; signInHref: string; /** Names the item where several buttons share a page (a community shelf). */ ariaLabel?: string }) {
  const t = useTranslations("CatalogPublic"), request = useRequest(), router = useRouter();
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  if (!signedIn) return <Button asChild className="min-h-11 w-full"><Link href={signInHref}>{t(kind === "course" ? "signInEnrol" : "signInGet")}</Link></Button>;
  async function enrol() {
    setBusy(true); setError("");
    const result = await request<{ enrolled: true }>(`/api/catalog/${slug}/enrolment`, { method: "POST" });
    if (!result.ok) { setBusy(false); setError(result.error); return; }
    if (kind === "course") router.push(`/courses/${slug}/learn`); else router.refresh();
  }
  return <div className="space-y-3">
    {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
    <Button className="min-h-11 w-full" disabled={busy} aria-label={ariaLabel} onClick={() => void enrol()}>{busy && <Spinner decorative size="sm" />}{t(kind === "course" ? "enrol" : "get")}</Button>
  </div>;
}
