"use client";
import { useState } from "react";
import { useHydrated } from "@/hooks/use-hydrated";
import { useRouter } from "next/navigation";
import { applyTheme, type BrandTheme } from "@/lib/theme";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
export function AppearanceForm({ tenantId, current, writable }: { tenantId: string; current: BrandTheme; writable: boolean }) {
  const router = useRouter(), hydrated = useHydrated();
  const [theme, setTheme] = useState(current), [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  async function save(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/workspaces/${tenantId}/appearance`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ brandTheme: theme }) });
      if (response.status === 401) { router.replace("/sign-in"); return; }
      if (!response.ok) { setError((await response.json()).error ?? "Could not save appearance. Try again."); return; }
      applyTheme(theme); setMessage("Workspace appearance saved."); router.refresh();
    } catch { setError("Could not connect. Please try again."); }
    finally { setBusy(false); }
  }
  return <form onSubmit={save} className="space-y-4">
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    <div className="space-y-1"><p id="workspace-brand-label" className="text-sm font-medium">Default brand theme</p><p id="workspace-brand-help" className="text-xs text-muted-foreground">Used when a person has no appearance override.</p></div>
    <RadioGroup orientation="horizontal" value={theme} onValueChange={(value) => setTheme(value as BrandTheme)} disabled={!hydrated || !writable || busy} aria-labelledby="workspace-brand-label" aria-describedby="workspace-brand-help" className="grid grid-cols-2 gap-3">
      {(["harvest", "studio"] as const).map((brand) => <Card key={brand} className={`gap-0 py-0 ${theme === brand ? "border-ring" : ""}`}><CardContent className="p-3">
        <div aria-hidden="true" data-preview-brand={brand} className="theme-preview mb-3 flex h-24 gap-2 rounded-md bg-background p-2"><Skeleton className="h-full w-1/4 rounded-sm" /><div className="flex flex-1 flex-col justify-center gap-2"><Card className="h-9 gap-0 rounded-md py-0" /><Skeleton className="h-2 w-1/2" /></div></div>
        <div className="flex items-center gap-2"><RadioGroupItem id={`brand-${brand}`} value={brand} /><Label htmlFor={`brand-${brand}`} className="flex-1">{brand === "harvest" ? "Harvest" : "Studio"}</Label></div>
      </CardContent></Card>)}
    </RadioGroup>
    <p className="text-xs leading-relaxed text-muted-foreground">Harvest brings warm neutrals and softer cards. Studio offers crisp surfaces and compact curves. Both keep Harvest’s gold actions, and work in light and dark.</p>
    <p role="status" className="text-xs text-muted-foreground">{message}</p>
    {writable ? <div className="space-y-4"><Separator /><div className="flex justify-end"><Button size="sm" disabled={busy || theme === current}>{busy ? "Saving…" : "Save appearance"}</Button></div></div> : <Alert><AlertDescription>Only owners and admins can change the workspace default. You can still choose your own theme in the toolbar.</AlertDescription></Alert>}
  </form>;
}
