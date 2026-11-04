"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Alert, AlertDescription } from "@/components/ui/alert";
export function WorkspaceForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response = await fetch("/api/workspaces", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
      if (response.status === 401) { router.replace("/sign-in"); return; }
      if (!response.ok) { setError((await response.json()).error); return; }
      setName(""); router.refresh();
    } catch { setError("Could not connect. Please try again."); }
    finally { setBusy(false); }
  }
  async function signOut() {
    setBusy(true); setError("");
    try { const result = await authClient.signOut(); if (result.error) setError("Could not sign out. Try again."); else { router.replace("/sign-in"); router.refresh(); } }
    catch { setError("Could not connect. Please try again."); }
    finally { setBusy(false); }
  }
  return <FieldGroup>
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    <form onSubmit={submit}><FieldGroup><Field><FieldLabel htmlFor="workspace-name">Workspace name</FieldLabel><Input id="workspace-name" required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} /></Field><Field orientation="horizontal"><Button disabled={busy}>{busy ? "Please wait…" : "Create workspace"}</Button></Field></FieldGroup></form>
    <Button variant="outline" disabled={busy} onClick={() => void signOut()}>Sign out</Button>
  </FieldGroup>;
}
