"use client";
import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Bell, BookOpen, MessageCirclePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EditorPreviewPanel, type PreviewSurface } from "@/components/editor/preview-panel";
import { CommunityPageView } from "@/components/communities/community-page-view";
import { JoinFormFields } from "@/components/communities/join-dialog";
import { WelcomeCardView, welcomeActionClass } from "@/components/communities/welcome-card";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { cn } from "@/lib/utils";
import { communityPreviewData, communityPreviewFields, isCommunityField, type CommunityDraft, type CommunityPreviewData, type CommunityPreviewTab, type PreviewViewer } from "@/lib/editor-preview";

/** A control drawn in the preview. It looks like the real one but does nothing and cannot take focus. */
function Inert({ className, variant, children }: { className?: string; variant?: "outline"; children: React.ReactNode }) {
  return <Button type="button" variant={variant} aria-disabled="true" tabIndex={-1} className={cn("min-h-11 cursor-default opacity-60", !variant && "hover:bg-primary", className)}>{children}</Button>;
}

/** The community as the preview shows it: the same views as the public page and the member welcome, fed the draft. */
function CommunityPreviewContent({ data, tab, viewer, wide }: { data: CommunityPreviewData; tab: CommunityPreviewTab; viewer: PreviewViewer; wide: boolean }) {
  const t = useTranslations("CommunityEditor"), page = useTranslations("CommunityPage"), joinT = useTranslations("JoinDialog");
  const name = data.name || t("previewUntitled");
  if (tab === "page") {
    const join = viewer === "member" ? <Inert className="w-full">{t("previewOpenCommunity")}</Inert>
      : data.canJoin ? <Inert className="w-full">{t(data.apply ? "previewApply" : "previewJoinButton")}</Inert> : <p className="text-sm text-muted-foreground">{page("closed")}</p>;
    return <CommunityPageView preview layout={wide ? "wide" : "narrow"} data={{ ...data, name }} join={join} />;
  }
  if (viewer === "member") return <WelcomeCardView preview message={data.welcomeMessage} dismiss={null}>
    <div className="flex flex-col gap-2">
      {data.rulesList.length > 0 && <div data-preview-field="rules"><Inert variant="outline" className={cn(welcomeActionClass, "w-full")}><BookOpen aria-hidden="true" />{t("previewRules")}</Inert></div>}
      {data.hasIntro && <Inert variant="outline" className={welcomeActionClass}><MessageCirclePlus aria-hidden="true" />{t("previewIntroduce")}</Inert>}
      <Inert variant="outline" className={welcomeActionClass}><Bell aria-hidden="true" />{t("previewNotifications")}</Inert>
    </div>
  </WelcomeCardView>;
  return <Card aria-label={joinT("title", { name })}>
    <CardHeader><CardTitle><p className="text-lg font-semibold break-words">{joinT("title", { name })}</p></CardTitle></CardHeader>
    <CardContent className="space-y-5">
      <JoinFormFields preview questions={data.questions} answers={{}} rules={data.rulesList} rulesOk={false} adult={false} />
      <div data-preview-field="admission"><Inert className="w-full">{t(data.apply ? "previewApply" : "previewJoinButton")}</Inert></div>
    </CardContent>
  </Card>;
}

/**
 * Live preview for the community editor (shell slice 3b): the real public page views fed the editor's draft (no save needed, no fetch, no
 * send). The draft is debounced so typing does not redraw the frame on every key. State that must survive the sheet closing lives with the editor.
 */
export function CommunityLivePreview({ surface, draft, host, tab, onTab, viewer, onViewer, onEdit, highlight, openPage }: {
  surface: PreviewSurface; draft: CommunityDraft; host: string; tab: CommunityPreviewTab; onTab: (tab: CommunityPreviewTab) => void;
  viewer: PreviewViewer; onViewer: (viewer: PreviewViewer) => void; onEdit: (field: string) => void; highlight: string | null; openPage?: { href: string; label: string };
}) {
  const t = useTranslations("CommunityEditor");
  const settled = useDebouncedValue(draft, 150);
  const data = useMemo(() => communityPreviewData(settled, host), [settled, host]);
  const fields = communityPreviewFields(tab, viewer).map((id) => ({ id, label: t(`previewFields.${id}`) }));
  return <EditorPreviewPanel surface={surface} frameLabel={t("previewFrame", { tab: t(tab === "page" ? "previewPage" : "previewWelcome"), viewer: t(viewer === "member" ? "previewMember" : "previewVisitor") })}
    tabs={[{ id: "page", label: t("previewPage") }, { id: "welcome", label: t("previewWelcome") }]} tab={tab} onTab={(id) => onTab(id as CommunityPreviewTab)}
    viewer={viewer} onViewer={onViewer} fields={fields} onEdit={(field) => { if (isCommunityField(field)) onEdit(field); }} highlight={highlight} openPage={openPage}>
    {(frame) => <CommunityPreviewContent data={data} tab={tab} viewer={viewer} wide={frame.device === "desktop"} />}
  </EditorPreviewPanel>;
}
