"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { applyTheme, type BrandTheme } from "@/lib/theme";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
export function AppearanceForm({ tenantId, current, writable }: { tenantId: string; current: BrandTheme; writable: boolean }) {
  const router = useRouter();
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
    <div className="flex flex-wrap items-center justify-between gap-4"><div className="space-y-1"><Label htmlFor="workspace-brand">Default brand theme</Label><p className="text-xs text-muted-foreground">Used when a person has no appearance override.</p></div><Select value={theme} onValueChange={(value) => setTheme(value as BrandTheme)} disabled={!writable || busy}><SelectTrigger id="workspace-brand" className="w-32"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="harvest">Harvest</SelectItem><SelectItem value="studio">Studio</SelectItem></SelectContent></Select></div>
    <p className="text-xs leading-relaxed text-muted-foreground">Harvest brings warm neutrals and softer cards. Studio offers crisp surfaces and compact curves. Both keep Harvest’s gold actions, and work in light and dark.</p>
    <p role="status" className="text-xs text-muted-foreground">{message}</p>
    {writable ? <div className="flex justify-end border-t pt-4"><Button size="sm" disabled={busy || theme === current}>{busy ? "Saving…" : "Save appearance"}</Button></div> : <p className="rounded-md bg-muted p-3 text-xs text-muted-foreground">Only owners and admins can change the workspace default. You can still choose your own theme in the toolbar.</p>}
  </form>;
}
