"use client";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
export default function WorkspaceError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("AppWorkspacesError");
  useEffect(() => { console.error("workspace_screen_failed", { digest: error.digest }); }, [error]);
  return <div className="space-y-4"><Alert variant="destructive"><AlertTitle>{t("couldnTLoadThisPage")}</AlertTitle><AlertDescription>{t("yourChangesMayNotHaveBeenSavedTry")}</AlertDescription></Alert><Button variant="outline" onClick={reset}>{t("tryAgain")}</Button></div>;
}
