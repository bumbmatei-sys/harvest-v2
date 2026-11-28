"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { StarIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { useRequest } from "@/hooks/use-request";
import { landingLimits } from "@/lib/catalog-landing";
import { cn } from "@/lib/utils";

/**
 * Write or edit the caller's one review (1 to 5 stars, up to 1,000 characters). Shown only to someone who has the item; the server checks that again. Signed out, a
 * sign-in link that returns here.
 */
export function ReviewForm({ slug, initial, signInHref }: { slug: string; initial: { rating: number; body: string; hidden: boolean } | null; signInHref: string | null }) {
  const t = useTranslations("CatalogLanding.reviews"), request = useRequest(), router = useRouter();
  const [rating, setRating] = useState(initial?.rating ?? 0), [body, setBody] = useState(initial?.body ?? "");
  const [busy, setBusy] = useState(false), [status, setStatus] = useState<"" | "saved" | "failed" | "notEligible">("");
  if (signInHref) return <Button asChild variant="outline" className="min-h-11"><Link href={signInHref}>{t("signIn")}</Link></Button>;
  async function save() {
    setBusy(true); setStatus("");
    const result = await request<{ saved: true }>(`/api/catalog/${slug}/review`, { method: "PUT", body: { rating, body } });
    setBusy(false);
    if (result.ok) { setStatus("saved"); router.refresh(); }
    else setStatus(result.details?.reason === "not_eligible" ? "notEligible" : "failed");
  }
  return <form className="bg-card space-y-4 rounded-2xl border p-5" data-slot="review-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
    <h3 className="font-semibold">{t(initial ? "edit" : "write")}</h3>
    {initial?.hidden && <Alert><AlertDescription>{t("hiddenNote")}</AlertDescription></Alert>}
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{t("rating")}</legend>
      <div role="radiogroup" aria-label={t("rating")} className="flex gap-1">
        {[1, 2, 3, 4, 5].map((value) => <button key={value} type="button" role="radio" aria-checked={rating === value} aria-label={t("ratingOption", { value })}
          onClick={() => setRating(value)} className="flex size-11 items-center justify-center rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
          <StarIcon aria-hidden="true" className={cn("size-6", value <= rating ? "fill-warning text-warning" : "text-muted-foreground")} />
        </button>)}
      </div>
    </fieldset>
    <Field><FieldLabel htmlFor="review-body">{t("body")}</FieldLabel>
      <Textarea id="review-body" rows={4} maxLength={landingLimits.review} value={body} onChange={(event) => setBody(event.target.value)} /></Field>
    {status === "saved" && <p role="status" className="text-sm text-success">{t("saved")}</p>}
    {(status === "failed" || status === "notEligible") && <Alert variant="destructive" role="alert"><AlertDescription>{t(status === "failed" ? "failed" : "notEligible")}</AlertDescription></Alert>}
    <Button type="submit" className="min-h-11" disabled={busy || rating < 1}>{busy && <Spinner decorative size="sm" />}{t("save")}</Button>
  </form>;
}
