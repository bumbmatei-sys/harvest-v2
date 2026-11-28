/** Derived from Shadcn UI Kit item newsletter2 (premium), registry retrieved 2026-11-28, approved 2026-11-27 (Account and newsletter screens). Kit code; local changes: docs/ui-sources.md. */
"use client";
/* eslint-disable @next/next/no-img-element */
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { MailIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { FormCover, PublicForm } from "@/components/forms/public-form";
import type { FormAnswers, FormDefinition } from "@/lib/crm-forms";

type Manifest = {
  title: string; description: string; cover: FormDefinition["cover"]; logoUrl: string; endTitle: string; endBody: string; ministryName: string | null;
  blocks: Pick<FormDefinition["blocks"][number], "id" | "type" | "label" | "required" | "options" | "text">[]; settings: Omit<FormDefinition["settings"], "ownerId" | "labels" | "landing">;
  newsletter?: { wordingVersion: string; consentText: string; fixedNotice: string }; proof: string;
};

/**
 * The public sign-up page: the published form from the hosted forms server, then a plain post. Nothing is stored in the browser. Laid out as the kit's
 * newsletter section: the title and description beside the form box (stacked on phones); the embed drops the section's outer spacing.
 */
export function HostedSignup({ slug, embed = false }: { slug: string; embed?: boolean }) {
  const t = useTranslations("NewsletterForms.hosted");
  const [state, setState] = useState<"loading" | "ready" | "unavailable" | "busy">("loading"), [manifest, setManifest] = useState<Manifest | null>(null);
  const load = useCallback(async () => {
    const response = await fetch(`/f/${encodeURIComponent(slug)}`, { headers: { Accept: "application/json" } });
    if (response.status === 429) return "busy" as const;
    const data = response.ok ? await response.json() as Manifest : null;
    return data?.newsletter ? data : null;
  }, [slug]);
  useEffect(() => {
    let live = true;
    load().then((result) => {
      if (!live) return;
      if (result === "busy") setState("busy");
      else if (!result) setState("unavailable");
      else { setManifest(result); setState("ready"); }
    }).catch(() => { if (live) setState("unavailable"); });
    return () => { live = false; };
  }, [load]);

  const submit = useCallback(async (answers: FormAnswers) => {
    if (!manifest) return;
    const response = await fetch(`/f/${encodeURIComponent(slug)}/submit`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proof: manifest.proof, answers, wording: manifest.newsletter!.wordingVersion }) });
    // 409: the consent wording changed since the page loaded (the ministry turned link-click counting on or off). Show the new wording to agree to.
    if (response.status === 409) {
      const fresh = await load().catch(() => null);
      if (fresh && fresh !== "busy") setManifest(fresh);
    }
    if (!response.ok) throw new Error(String(response.status));
    const target = manifest.settings.redirectUrl;
    if (target) window.location.assign(target);
  }, [manifest, slug, load]);

  const plain = cn("mx-auto w-full max-w-2xl", !embed && "px-4 py-8 sm:py-12");
  if (state === "loading") return <p role="status" className={cn(plain, "text-sm text-muted-foreground")}>{t("loading")}</p>;
  if (state !== "ready" || !manifest) return <div role="status" className={cn(plain, "space-y-2")} data-signup-unavailable><h1 className="text-2xl font-semibold tracking-tight">{state === "busy" ? t("busyTitle") : t("unavailableTitle")}</h1></div>;
  const definition: FormDefinition = {
    kind: "crm-form-v1", revision: 1, updatedAt: "", title: manifest.title, description: manifest.description, cover: manifest.cover, logoUrl: manifest.logoUrl, destination: null,
    endTitle: manifest.endTitle, endBody: manifest.endBody, blocks: manifest.blocks.map((block) => ({ ...block, mapTo: null })),
    settings: { ownerId: null, labels: [], landing: "build", ...manifest.settings }, newsletter: { listIds: [], ...manifest.newsletter! },
  };
  // Keyed by the wording, so a page that reloads a changed wording starts again with the box unticked.
  return (
    <section className={cn("w-full", !embed && "px-4 py-14 lg:py-24")}>
      <Card className="bg-muted/50 mx-auto max-w-4xl shadow-none">
        <CardContent className="grid gap-10 md:grid-cols-2 md:items-center md:gap-12 md:p-4">
          <div className="space-y-6">
            <FormCover cover={manifest.cover} className="sm:h-28" />
            <div className="space-y-3">
              {manifest.logoUrl ? <img src={manifest.logoUrl} alt="" className="size-16 rounded-xl border object-cover" />
                : <Badge variant="outline">
                  <MailIcon aria-hidden="true" />
                  {t("badge")}
                </Badge>}
              <h1 className="text-2xl leading-tight font-bold text-balance md:text-3xl">
                {manifest.title}
              </h1>
              {manifest.description && <p className="text-muted-foreground text-balance whitespace-pre-line">
                {manifest.description}
              </p>}
            </div>
          </div>

          <PublicForm key={manifest.newsletter!.wordingVersion} form={definition} ministryName={manifest.ministryName} idPrefix="signup" preview={false} onSubmit={submit}
            header={false} frameClassName="flex flex-col gap-4 rounded-2xl border p-6" />
        </CardContent>
      </Card>
    </section>
  );
}
