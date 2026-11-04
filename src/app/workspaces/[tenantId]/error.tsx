"use client";
import { useEffect } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
export default function WorkspaceError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error("workspace_screen_failed", { digest: error.digest }); }, [error]);
  return <div className="space-y-4"><Alert variant="destructive"><AlertTitle>Couldn’t load this page</AlertTitle><AlertDescription>Your changes may not have been saved. Try again.</AlertDescription></Alert><Button variant="outline" onClick={reset}>Try again</Button></div>;
}
