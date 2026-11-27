"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Briefcase, Building2, ExternalLink, Globe, Languages, MapPin, Users, type LucideIcon } from "lucide-react";
import { HostedSignup } from "@/components/newsletter/hosted-signup";
import { SwipeTabs } from "@/components/swipe-tabs";
import { bioIconComponents } from "@/components/link-in-bio/bio-icons";
import { BioCover, BioHeader, type BioPrimaryAction } from "@/components/link-in-bio/bio-header";
import { BioMessageForm } from "@/components/link-in-bio/bio-message-form";
import { WaysToGive } from "@/components/giving/ways-to-give";
import { isLegacyTabId, messageNotice, safeHttpsUrl, type BioDetailKind, type BioView, type BioViewBlock } from "@/lib/link-in-bio";

const detailIcons: Record<BioDetailKind, LucideIcon> = { location: MapPin, ministry: Building2, role: Briefcase, website: Globe, languages: Languages };
const host = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } };
function beacon(handle: string, block: string) {
  try { void fetch(`/l/${encodeURIComponent(handle)}/click`, { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ block }) }).catch(() => undefined); } catch { /* A click is never blocked by counting. */ }
}
const linkTypes = new Set<BioViewBlock["type"]>(["link", "event", "community"]);

/**
 * The public page and the editor's live preview: one renderer. Layout: a profile header (`BioHeader`: optional cover, round photo left or centre, name, subtitle,
 * one row of icons, main action), then the owner's tabs (swipeable on a phone, `SwipeTabs`) or a single page. Built from Harvest components and Tailwind; it sizes by its own container so the phone-framed preview and a real phone
 * stack the same way. `preview` makes every control inert (no navigation, no counting, no form posts) and takes the images from the editor.
 */
export function BioPageView({ view, handle, preview = false, photoUrl = null, coverUrl = null }: { view: BioView; handle: string; preview?: boolean; photoUrl?: string | null; coverUrl?: string | null }) {
  const t = useTranslations("LinkInBio.public"), tn = useTranslations("LinkInBio");
  const [tab, setTab] = useState(view.tabs[0]?.id ?? "home");
  const tabName = (x: BioView["tabs"][number]) => x.label || (isLegacyTabId(x.id) ? tn(`tabs.${x.id}`) : "");
  const active = view.tabs.some((x) => x.id === tab) ? tab : (view.tabs[0]?.id ?? "home");
  const Body = preview ? "div" : "main", Title = preview ? "h2" : "h1";
  const inert = preview ? { tabIndex: -1, onClick: (event: React.MouseEvent) => event.preventDefault() } : {};
  const photo = photoUrl ?? (view.hasPhoto && !preview ? `/l/${encodeURIComponent(handle)}/photo` : null);
  const cover = coverUrl ?? (view.hasCover && !preview ? `/l/${encodeURIComponent(handle)}/banner` : null);
  const all = view.tabs.flatMap((x) => x.blocks);
  const message = all.find((b) => b.type === "message");
  const firstLink = all.find((b): b is Extract<BioViewBlock, { type: "link" | "event" }> => b.type === "link" || b.type === "event");
  const tabOfMessage = message ? view.tabs.find((x) => x.blocks.includes(message))?.id : undefined;

  function goToMessage() {
    if (preview || !tabOfMessage) return;
    setTab(tabOfMessage);
    setTimeout(() => { const form = document.querySelector<HTMLElement>("[data-bio-message-form]"); form?.scrollIntoView({ block: "center" }); form?.querySelector<HTMLInputElement>("input")?.focus(); }, 60);
  }
  const click = (id: string) => preview ? inert.onClick : () => beacon(handle, id);
  const rowClass = "flex min-h-12 w-full items-center gap-3 px-4 py-3 text-left outline-none transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50";

  function row(item: BioViewBlock) {
    if (item.type === "link" || item.type === "event") {
      const Icon = item.type === "link" && item.icon ? bioIconComponents[item.icon] : null;
      return <li key={item.id} data-bio-block={item.id}><a href={item.url} target="_blank" rel="nofollow noopener noreferrer ugc" className={rowClass} {...inert} onClick={click(item.id)} onAuxClick={preview ? undefined : () => beacon(handle, item.id)}>
        {Icon && <Icon className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />}
        <span className="min-w-0 flex-1">{item.type === "event" && <span className="block text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("eventLabel")}</span>}
          <span className="block break-words text-base font-medium">{item.type === "link" ? item.label : item.title}</span>
          <span className="block truncate text-xs text-muted-foreground">{item.type === "event" ? item.when : host(item.url)}</span></span>
        <ExternalLink className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /><span className="sr-only">{t("openLink")}</span></a></li>;
    }
    if (item.type === "community") return <li key={item.id} data-bio-block={item.id}><a href={`/communities/${item.slug}`} className={rowClass} {...inert} onClick={click(item.id)} onAuxClick={preview ? undefined : () => beacon(handle, item.id)}>
      <Users className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="min-w-0 flex-1"><span className="block text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("communityLabel")}</span>
        <span className="block break-words text-base font-medium">{item.name}</span>{item.tagline && <span className="block text-sm text-muted-foreground">{item.tagline}</span>}</span>
      <span className="shrink-0 text-sm font-medium">{t("viewCommunity")}</span></a></li>;
    return null;
  }
  const panel = (id: string, blocks: BioViewBlock[]) => {
    const links = blocks.filter((b) => linkTypes.has(b.type)), others = blocks.filter((b) => !linkTypes.has(b.type));
    return <div className="space-y-4">
      {id === view.tabs[0]?.id && view.details.length > 0 && <section aria-label={t("details")} className="rounded-xl border bg-card text-card-foreground"><ul className="divide-y" data-bio-details>{view.details.map((d) => { const Icon = detailIcons[d.kind], url = d.kind === "website" ? safeHttpsUrl(d.value) : null;
        return <li key={d.id} className="flex min-h-12 items-center gap-3 px-4 py-3"><Icon className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" /><span className="sr-only">{tn(`details.kinds.${d.kind}`)}</span>
          {url ? <a href={url} target="_blank" rel="nofollow noopener noreferrer ugc" {...inert} className="min-w-0 break-words text-sm underline-offset-4 hover:underline">{d.value}</a> : <span className="min-w-0 break-words text-sm">{d.value}</span>}</li>; })}</ul></section>}
      {links.length > 0 && <section className="rounded-xl border bg-card text-card-foreground"><ul className="divide-y overflow-hidden rounded-xl">{links.map(row)}</ul></section>}
      {others.map((item) => item.type === "newsletter" ? <div key={item.id} data-bio-block={item.id}>{preview ? <div className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">{t("newsletterPlaceholder")}</div> : <HostedSignup slug={item.slug} />}</div>
        : item.type === "message" ? <div key={item.id} data-bio-block={item.id}><BioMessageForm handle={handle} title={item.title} notice={messageNotice(view.ministryName)} inert={preview} /></div>
        : item.type === "giving" ? <div key={item.id} data-bio-block={item.id}><WaysToGive methods={item.methods} title={item.title} ministryName={view.ministryName} inert={preview} reportUrl={preview ? undefined : `/l/${encodeURIComponent(handle)}/report`} /></div> : null)}
    </div>;
  };

  const primary: BioPrimaryAction = message?.type === "message" ? { kind: "message", label: message.title, onClick: goToMessage }
    : firstLink ? { kind: "link", label: firstLink.type === "link" ? firstLink.label : firstLink.title, url: firstLink.url, onClick: click(firstLink.id) } : null;
  const tabbed = view.layout === "tabs" && view.tabs.length > 1;

  return <div className="@container w-full text-foreground" data-bio-page data-bio-layout={view.layout}>
    {view.showCover && <BioCover cover={cover} />}
    <div className="mx-auto w-full max-w-3xl space-y-5 px-4 pb-10">
      <BioHeader view={view} photo={photo} preview={preview} primary={primary} Title={Title} />
      <Body {...(preview ? {} : { id: "main-content" })} className="space-y-4">
        {tabbed
          ? <SwipeTabs value={active} onValueChange={setTab} label={t("tabs")} swipe={!preview} tabs={view.tabs.map((x) => ({ id: x.id, label: tabName(x), content: <div data-bio-tab={x.id}>{panel(x.id, x.blocks)}</div> }))} />
          : view.tabs.map((x) => <div key={x.id} data-bio-tab={x.id}>{panel(x.id, x.blocks)}</div>)}
      </Body>
    </div>
  </div>;
}
