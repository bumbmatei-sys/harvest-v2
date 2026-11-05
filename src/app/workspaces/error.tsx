"use client";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
export default function WorkspaceError({ reset }: { reset: () => void }) {
  const t = useTranslations("AppWorkspacesError");
  return <main className="mx-auto max-w-xl p-6"><Alert variant="destructive"><AlertTitle>{t("couldNotLoadWorkspaces")}</AlertTitle><AlertDescription>{t("pleaseTryAgainInAMoment")}</AlertDescription></Alert><Button className="mt-4" onClick={reset}>{t("tryAgain")}</Button></main>;
}
