"use client";
import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { History } from "lucide-react";
import { useCrmRequest } from "@/components/crm/request";
import { RichTextView } from "@/components/rich-text/rich-text-view";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import type { RevisionVersion } from "@/server/community-moderation";

type Version = Omit<RevisionVersion, "savedAt"> & { savedAt: string };

/** C12b: hosts read the previous versions of a post or reply. Content renders as text or through RichTextView, never as HTML. */
export function EditHistory({ slug, targetType, targetId, name, compact = false }: { slug: string; targetType: "post" | "comment"; targetId: string; name: string; compact?: boolean }) {
  const t = useTranslations("EditHistory"), format = useFormatter(), request = useCrmRequest();
  const [versions, setVersions] = useState<Version[] | null>(null), [error, setError] = useState("");
  async function load(open: boolean) {
    if (!open) return;
    setVersions(null); setError("");
    const result = await request<Version[]>(`/api/communities/${slug}/moderation/revisions?targetType=${targetType}&targetId=${targetId}`, { method: "GET" });
    if (result.ok) setVersions(result.data); else setError(result.error);
  }
  const label = t("openNamed", { name });
  return <Sheet onOpenChange={(open) => void load(open)}>
    <SheetTrigger asChild>{compact
      ? <Button variant="ghost" size="icon" className="size-11 text-muted-foreground" aria-label={label}><History aria-hidden="true" /></Button>
      : <Button variant="outline" className="min-h-11" aria-label={label}><History aria-hidden="true" />{t("open")}</Button>}</SheetTrigger>
    <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
      <SheetHeader><SheetTitle>{t("title")}</SheetTitle></SheetHeader>
      <div className="space-y-3 px-4 pb-4">
        {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
        {versions === null && !error && <p role="status" className="text-sm text-muted-foreground">{t("loading")}</p>}
        {versions && versions.length === 1 && <p className="text-sm text-muted-foreground">{t("empty")}</p>}
        {versions && <ol className="space-y-3">{versions.map((v) => <li key={v.id} className="space-y-2 rounded-lg border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={v.current ? "secondary" : "outline"}>{v.current ? t("current") : t("earlier")}</Badge>
            <span className="text-sm text-muted-foreground">{format.dateTime(new Date(v.savedAt), { dateStyle: "medium", timeStyle: "short" })}</span>
          </div>
          {v.title && <p className="font-medium break-words">{v.title}</p>}
          {v.body ? <RichTextView doc={v.body} /> : <p className="text-sm whitespace-pre-line break-words">{v.text}</p>}
        </li>)}</ol>}
      </div>
    </SheetContent>
  </Sheet>;
}
