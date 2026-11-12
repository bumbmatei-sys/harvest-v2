import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getDb } from "@/db/client";
import { communitiesEnabled } from "@/server/communities-mode";
import { myCommunities } from "@/server/community-joining";
import { myBans } from "@/server/community-moderation";
import { pageSession } from "@/server/page-session";
import { PublicFrame } from "@/components/connect/public-frame";
import { JoinDialog } from "@/components/communities/join-dialog";
import { ApplicationActions } from "@/components/communities/application-actions";
import { AppealDialog } from "@/components/communities/appeal-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

// C06/C08: the person's communities — joined, invited (accepted here by invite id) and hosted.
export default async function MyCommunities() {
  if (!communitiesEnabled()) notFound();
  const session = await pageSession("personal"), db = getDb(), t = await getTranslations("MyCommunities");
  const { joined, invited, applications, hosted } = await myCommunities(db, session.user.id), removed = await myBans(db, session.user.id);
  const section = (title: string, empty: string, items: React.ReactNode[]) => <Card>
    <CardHeader><CardTitle><h2 className="text-lg font-semibold">{title}</h2></CardTitle></CardHeader>
    <CardContent>{items.length ? <ul className="divide-y">{items}</ul> : <p className="text-sm text-muted-foreground">{empty}</p>}</CardContent>
  </Card>;
  const row = (key: string, name: string, extra: React.ReactNode, action: React.ReactNode) => <li key={key} className="flex flex-wrap items-center justify-between gap-3 py-3">
    <div className="flex min-w-0 flex-wrap items-center gap-2"><span className="font-medium break-words">{name}</span>{extra}</div><div className="w-full sm:w-auto">{action}</div></li>;
  return <PublicFrame personal notice={false}>
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[28px] font-semibold tracking-tight">{t("title")}</h1>
        <Button asChild variant="outline" className="min-h-11"><Link href="/discover" prefetch={false}>{t("discover")}</Link></Button>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        {section(t("joined"), t("joinedEmpty"), joined.map((c) => row(c.slug, c.name, null,
          <Button asChild variant="outline" className="min-h-11 w-full sm:w-auto"><Link href={`/communities/${c.slug}/forum`} prefetch={false}>{t("open")}</Link></Button>)))}
        {section(t("invited"), t("invitedEmpty"), invited.map((invite) => row(invite.inviteId, invite.name,
          <Badge variant="secondary">{t("expires", { date: new Date(invite.expiresAt) })}</Badge>,
          <JoinDialog slug={invite.slug} name={invite.name} rules={invite.rulesList} rulesVersion={invite.rulesVersion} questions={invite.joinQuestions}
            questionsVersion={invite.questionsVersion} inviteId={invite.inviteId} signedIn signInHref="/sign-in?personal=1" action="accept" />)))}
        {section(t("pending"), t("pendingEmpty"), applications.map((application) => <li key={application.id} className="space-y-2 py-3">
          <div className="flex flex-wrap items-center gap-2"><span className="font-medium break-words">{application.name}</span>
            <Badge variant={application.status === "declined" ? "outline" : "secondary"}>{t(`applicationStatus.${application.status}`)}</Badge></div>
          {application.status === "info_requested" && application.infoRequest && <p className="text-sm break-words"><span className="font-medium">{t("askedFor")} </span>{application.infoRequest}</p>}
          <ApplicationActions application={application} />
        </li>))}
        {removed.length > 0 && section(t("removed"), "", removed.map((c) => <li key={c.slug} className="space-y-2 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 flex-wrap items-center gap-2"><span className="font-medium break-words">{c.name}</span>
              {c.appeal ? <Badge variant={c.appeal.status === "open" ? "secondary" : "outline"}>{t(`appealStatus.${c.appeal.status}`)}</Badge>
                : <Badge variant="outline">{t("removedBadge")}</Badge>}</div>
            {c.canAppeal && <AppealDialog slug={c.slug} name={c.name} />}
            {!c.banned && <Button asChild variant="outline" className="min-h-11 w-full sm:w-auto"><Link href={`/communities/${c.slug}`} prefetch={false}>{t("rejoin")}</Link></Button>}
          </div>
          {c.appeal?.reply && <p className="text-sm break-words"><span className="font-medium">{t("hostReply")} </span>{c.appeal.reply}</p>}
        </li>))}
        {section(t("hosted"), t("hostedEmpty"), hosted.map((c) => row(c.id, c.name, <Badge variant="outline">{t(`status.${c.status}`)}</Badge>,
          <Button asChild variant="outline" className="min-h-11 w-full sm:w-auto"><Link href={`/workspaces/${c.tenantId}/communities/${c.id}/edit`} prefetch={false}>{t("manage")}</Link></Button>)))}
      </div>
    </div>
  </PublicFrame>;
}
