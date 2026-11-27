"use client";
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { PublicForm } from "@/components/forms/public-form";
import type { FormAnswers, FormDefinition } from "@/lib/crm-forms";

type Manifest = {
  title: string; description: string; cover: FormDefinition["cover"]; logoUrl: string; endTitle: string; endBody: string; ministryName: string | null;
  blocks: Pick<FormDefinition["blocks"][number], "id" | "type" | "label" | "required" | "options" | "text">[]; settings: Omit<FormDefinition["settings"], "ownerId" | "labels" | "landing">;
  newsletter?: { wordingVersion: string; consentText: string; fixedNotice: string }; proof: string; clicksCounted?: boolean;
};

/** The public sign-up page: the published form from the hosted forms server, then a plain post. Nothing is stored in the browser. */
export function HostedSignup({ slug }: { slug: string }) {
  const t = useTranslations("NewsletterForms.hosted");
  const [state, setState] = useState<"loading" | "ready" | "unavailable" | "busy">("loading"), [manifest, setManifest] = useState<Manifest | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`/f/${encodeURIComponent(slug)}`, { headers: { Accept: "application/json" } }).then(async (response) => {
      if (!live) return;
      if (response.status === 429) { setState("busy"); return; }
      const data = response.ok ? await response.json() as Manifest : null;
      if (!data?.newsletter) { setState("unavailable"); return; }
      setManifest(data); setState("ready");
    }).catch(() => { if (live) setState("unavailable"); });
    return () => { live = false; };
  }, [slug]);

  const submit = useCallback(async (answers: FormAnswers) => {
    if (!manifest) return;
    const response = await fetch(`/f/${encodeURIComponent(slug)}/submit`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ proof: manifest.proof, answers }) });
    if (!response.ok) throw new Error(String(response.status));
    const target = manifest.settings.redirectUrl;
    if (target) window.location.assign(target);
  }, [manifest, slug]);

  if (state === "loading") return <p role="status" className="text-sm text-muted-foreground">{t("loading")}</p>;
  if (state !== "ready" || !manifest) return <div role="status" className="space-y-2" data-signup-unavailable><h1 className="text-2xl font-semibold tracking-tight">{state === "busy" ? t("busyTitle") : t("unavailableTitle")}</h1></div>;
  const definition: FormDefinition = {
    kind: "crm-form-v1", revision: 1, updatedAt: "", title: manifest.title, description: manifest.description, cover: manifest.cover, logoUrl: manifest.logoUrl, destination: null,
    endTitle: manifest.endTitle, endBody: manifest.endBody, blocks: manifest.blocks.map((block) => ({ ...block, mapTo: null })),
    settings: { ownerId: null, labels: [], landing: "build", ...manifest.settings }, newsletter: { listIds: [], ...manifest.newsletter! },
  };
  return <>
    <PublicForm form={definition} ministryName={manifest.ministryName} idPrefix="signup" preview={false} onSubmit={submit} />
    {manifest.clicksCounted && <p className="mt-4 text-sm text-muted-foreground" data-clicks-counted>{t("clicksCounted")}</p>}
  </>;
}
