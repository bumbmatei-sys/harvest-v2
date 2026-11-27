"use client";
import { useState } from "react";
import { Download } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useHydrated } from "@/hooks/use-hydrated";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

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
  return <div className="space-y-3">
    <Button type="button" variant="outline" className="min-h-11" onClick={() => void download()} disabled={!hydrated || busy}>
      <Download aria-hidden="true" />{busy ? t("preparing") : t("download")}</Button>
    {done && <p role="status" className="text-sm text-muted-foreground">{t("downloaded")}</p>}
    {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
  </div>;
}
