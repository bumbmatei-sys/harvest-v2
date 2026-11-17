import { useTranslations } from "next-intl";
import { CommunityJoinCard } from "@/components/communities/join-card";
import type { CommunityField } from "@/lib/editor-preview";

export type CommunityPageViewData = { name: string; tagline: string | null; description: string | null; rulesList: string[]; hostName: string };
/** `responsive` follows the viewport (the public page); `wide` and `narrow` pin the layout for the editor preview's device frame. */
export type CommunityPageLayout = "responsive" | "wide" | "narrow";
const layouts: Record<CommunityPageLayout, string> = {
  responsive: "grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]", wide: "grid gap-8 grid-cols-[minmax(0,1fr)_22rem]", narrow: "grid gap-8",
};

/**
 * The community landing, as plain data plus the join control. One render path for the public page (which passes the published community
 * and the real join dialog) and the editor's live preview (which passes the draft and an inert button), so the two cannot drift. No data
 * fetching and no behaviour live here. With `preview` the elements carry `data-preview-field` markers (for click-to-field) and the rules
 * are shown open; without it the markup is exactly the public page's.
 */
export function CommunityPageView({ data, join, layout = "responsive", preview = false }: { data: CommunityPageViewData; join: React.ReactNode; layout?: CommunityPageLayout; preview?: boolean }) {
  const t = useTranslations("CommunityPage");
  const mark = (field: CommunityField) => preview ? { "data-preview-field": field } : {};
  const Title = preview ? "p" : "h1";
  return <div className={layouts[layout]}>
    <section className="min-w-0 space-y-6">
      <header className="space-y-2">
        <Title {...mark("name")} className="text-[28px] font-semibold tracking-tight break-words">{data.name}</Title>
        {data.tagline && <p {...mark("tagline")} className="text-muted-foreground break-words">{data.tagline}</p>}
      </header>
      {data.description && <p {...mark("description")} className="max-w-prose whitespace-pre-line break-words">{data.description}</p>}
      {data.rulesList.length > 0 && <details {...mark("rules")} open={preview ? true : undefined} className="rounded-md border px-4">
        <summary className="flex min-h-11 cursor-pointer items-center font-medium">{t("rules")}</summary>
        <ol className="list-decimal space-y-1 pb-4 pl-5 text-sm">{data.rulesList.map((rule, i) => <li key={i} className="break-words">{rule}</li>)}</ol>
      </details>}
    </section>
    <aside {...mark("admission")} className="min-w-0">
      <CommunityJoinCard name={data.name} tagline={null} host={data.hostName} preview={preview} action={join} />
    </aside>
  </div>;
}
