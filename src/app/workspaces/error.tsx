"use client";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
export default function WorkspaceError({ reset }: { reset: () => void }) {
  return <main className="mx-auto max-w-xl p-6"><Alert variant="destructive"><AlertTitle>Could not load workspaces</AlertTitle><AlertDescription>Please try again in a moment.</AlertDescription></Alert><Button className="mt-4" onClick={reset}>Try again</Button></main>;
}
