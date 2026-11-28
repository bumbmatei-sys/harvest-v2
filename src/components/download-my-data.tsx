/** Derived from Shadcn UI Kit item list-block13 (premium), registry retrieved 2026-11-28, approved 2026-11-27 (Account and newsletter screens). Kit code; local changes: docs/ui-sources.md. */
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Download,
  FileJson,
} from "lucide-react";

import { useHydrated } from "@/hooks/use-hydrated";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";

/** "Download my data": asks the export route for the person's own JSON file and saves it. */
export function DownloadMyData() {
  const t = useTranslations("YourData"), router = useRouter(), hydrated = useHydrated();
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [done, setDone] = useState(false);
  async function download() {
    setBusy(true); setError(""); setDone(false);
    try {
      const response = await fetch("/api/account/data", { method: "POST" });
      if (response.status === 401) { router.replace("/sign-in?personal=1"); return; }
      if (!response.ok) { setError(t(response.status === 429 ? "limited" : "downloadFailed")); return; }
      const name = /filename="([^"]+)"/.exec(response.headers.get("Content-Disposition") ?? "")?.[1] ?? "harvest-data.json";
      const url = URL.createObjectURL(await response.blob()), link = document.createElement("a");
      link.href = url; link.download = name; document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setDone(true);
    } catch { setError(t("downloadFailed")); }
    finally { setBusy(false); }
  }

  return (
    <div className="flex flex-col gap-3">
      <Item
        size="sm"
        className="border-b-border rounded-none border-x-0 border-t-0 px-0 last:border-b-0"
      >
        <ItemMedia className="bg-muted text-muted-foreground size-8 rounded-md border">
          <FileJson className="size-4" />
        </ItemMedia>
        <ItemContent className="min-w-0">
          <ItemTitle className="flex-wrap">
            {t("fileTitle")}
            <Badge variant="outline">{t("fileFormat")}</Badge>
          </ItemTitle>
          <ItemDescription className="text-xs line-clamp-none">
            {t("downloadHelp")}
          </ItemDescription>
        </ItemContent>
        <ItemActions className="w-full justify-end sm:w-auto">
          <Button variant="outline" size="sm" className="min-h-11" onClick={() => void download()} disabled={!hydrated || busy}>
            <Download data-icon="inline-start" aria-hidden="true" />
            {busy ? t("preparing") : t("download")}
          </Button>
        </ItemActions>
      </Item>
      {done && <p role="status" className="text-sm text-muted-foreground">{t("downloaded")}</p>}
      {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
    </div>
  );
}
