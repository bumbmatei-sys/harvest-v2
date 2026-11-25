"use client";
import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { useRequest } from "@/hooks/use-request";

type Accepted = { tenantId: string; draftId: string; department: string; role: "leader" | "member"; joined: boolean };

/** Accepting an invitation to a campaign department. The signed-in account must be the one the invitation was made for; the server decides. */
export function AcceptInvitation({ token, email }: { token: string; email: string }) {
  const t = useTranslations("CampaignInvitation"), tw = useTranslations("CampaignWizard"), request = useRequest();
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [done, setDone] = useState<Accepted | null>(null);
  async function accept() {
    setBusy(true); setError("");
    const result = await request<Accepted>("/api/campaign-invitations/accept", { method: "POST", body: { token } });
    setBusy(false);
    if (result.ok) setDone(result.data);
    else setError(result.status === 404 ? t("notFound") : result.status === 409 ? t(result.details?.reason === "expired" ? "expired" : "closed") : result.error);
  }
  return <Card className="w-full">
    <CardHeader><CardTitle><h1 className="text-xl font-semibold">{t("title")}</h1></CardTitle><p className="text-sm text-muted-foreground">{t("signedInAs", { email })}</p></CardHeader>
    <CardContent className="space-y-4">
      {done ? <div className="space-y-2" role="status">
        <p className="font-medium">{t("accepted")}</p>
        <p className="text-sm">{t("placed", { role: t(done.role === "leader" ? "roleLeader" : "roleMember"), department: tw(`departments.${done.department}` as "departments.volunteers") })}</p>
        {done.joined && <p className="text-sm text-muted-foreground">{t("joined")}</p>}
      </div> : <p className="text-sm">{t("body")}</p>}
      {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
    </CardContent>
    <CardFooter>
      {done ? (!done.joined && <Button asChild className="min-h-11"><Link href={`/workspaces/${done.tenantId}/campaigns/drafts/${done.draftId}`}>{t("open")}</Link></Button>)
        : <Button type="button" className="min-h-11" disabled={busy} onClick={() => void accept()}>{busy ? <><Spinner decorative size="sm" />{t("accepting")}</> : error ? t("retry") : t("accept")}</Button>}
    </CardFooter>
  </Card>;
}
