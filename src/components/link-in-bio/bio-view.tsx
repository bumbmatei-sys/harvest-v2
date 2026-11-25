"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Briefcase, Building2, ExternalLink, Globe, Languages, MapPin, MessageCircle, Users, type LucideIcon } from "lucide-react";
import { HostedSignup } from "@/components/newsletter/hosted-signup";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { bioIconComponents, NetworkMark } from "@/components/link-in-bio/bio-icons";
import { BioMessageForm } from "@/components/link-in-bio/bio-message-form";
import { messageNotice, safeHttpsUrl, type BioDetailKind, type BioView, type BioViewBlock } from "@/lib/link-in-bio";
import { cn } from "@/lib/utils";

const detailIcons: Record<BioDetailKind, LucideIcon> = { location: MapPin, ministry: Building2, role: Briefcase, website: Globe, languages: Languages };
const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map((word) => Array.from(word)[0] ?? "").join("").toUpperCase() || "·";
const host = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } };
function beacon(handle: string, block: string) {
  try { void fetch(`/l/${encodeURIComponent(handle)}/click`, { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ block }) }).catch(() => undefined); } catch { /* A click is never blocked by counting. */ }
}
const linkTypes = new Set<BioViewBlock["type"]>(["link", "event", "community"]);

/**
 * The public page and the editor's live preview: one renderer. Layout idea: a profile page (cover, round photo overlapping it, name and one-line subtitle, a row of
 * social icons, a details list, then tabs). Built from Harvest components and Tailwind; it sizes by its own container so the phone-framed preview and a real phone
 * stack the same way. `preview` makes every control inert (no navigation, no counting, no form posts) and takes the images from the editor.
 */
export function BioPageView({ view, handle, preview = false, photoUrl = null, coverUrl = null }: { view: BioView; handle: string; preview?: boolean; photoUrl?: string | null; coverUrl?: string | null }) {
  const t = useTranslations("LinkInBio.public"), tn = useTranslations("LinkInBio");
  const [tab, setTab] = useState(view.tabs[0]?.id ?? "home");
  const active = view.tabs.some((x) => x.id === tab) ? tab : (view.tabs[0]?.id ?? "home");
  const Body = preview ? "div" : "main", Title = preview ? "h2" : "h1";
  const inert = preview ? { tabIndex: -1, onClick: (event: React.MouseEvent) => event.preventDefault() } : {};
  const photo = photoUrl ?? (view.hasPhoto && !preview ? `/l/${encodeURIComponent(handle)}/photo` : null);
  const cover = coverUrl ?? (view.hasCover && !preview ? `/l/${encodeURIComponent(handle)}/banner` : null);
  const all = view.tabs.flatMap((x) => x.blocks);
  const message = all.find((b) => b.type === "message");
  const firstLink = all.find((b): b is Extract<BioViewBlock, { type: "link" | "event" }> => b.type === "link" || b.type === "event");
  const tabOfMessage = message ? view.tabs.find((x) => x.blocks.includes(message))?.id : undefined;
  const primaryStyle = view.buttons === "filled" ? "default" : "outline";

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
      {id === "home" && view.details.length > 0 && <section aria-label={t("details")} className="rounded-xl border bg-card text-card-foreground"><ul className="divide-y" data-bio-details>{view.details.map((d) => { const Icon = detailIcons[d.kind], url = d.kind === "website" ? safeHttpsUrl(d.value) : null;
        return <li key={d.id} className="flex min-h-12 items-center gap-3 px-4 py-3"><Icon className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" /><span className="sr-only">{tn(`details.kinds.${d.kind}`)}</span>
          {url ? <a href={url} target="_blank" rel="nofollow noopener noreferrer ugc" {...inert} className="min-w-0 break-words text-sm underline-offset-4 hover:underline">{d.value}</a> : <span className="min-w-0 break-words text-sm">{d.value}</span>}</li>; })}</ul></section>}
      {links.length > 0 && <section className="rounded-xl border bg-card text-card-foreground"><ul className="divide-y overflow-hidden rounded-xl">{links.map(row)}</ul></section>}
      {others.map((item) => item.type === "newsletter" ? <div key={item.id} data-bio-block={item.id}>{preview ? <div className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">{t("newsletterPlaceholder")}</div> : <HostedSignup slug={item.slug} />}</div>
        : item.type === "message" ? <div key={item.id} data-bio-block={item.id}><BioMessageForm handle={handle} title={item.title} notice={messageNotice(view.ministryName)} inert={preview} /></div> : null)}
    </div>;
  };

  return <div className="@container w-full text-foreground" data-bio-page>
    <div className={cn("relative h-40 w-full overflow-hidden bg-gradient-to-br from-primary/70 via-primary/40 to-secondary")} data-bio-cover={cover ? "image" : "gradient"} aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element -- a signed redirect from the server, not optimisable */}
      {cover && <img src={cover} alt="" className="size-full object-cover" />}
    </div>
    <div className="mx-auto w-full max-w-3xl space-y-5 px-4 pb-10">
      <header className="-mt-12 flex flex-col items-center gap-4 text-center @md:flex-row @md:items-end @md:text-left">
        {/* eslint-disable-next-line @next/next/no-img-element -- a signed redirect from the server, not optimisable */}
        {photo ? <img src={photo} alt={t("photoAlt", { name: view.name })} className="size-24 shrink-0 rounded-full border-4 border-background bg-muted object-cover" data-bio-photo />
          : <span className="flex size-24 shrink-0 items-center justify-center rounded-full border-4 border-background bg-muted text-2xl font-semibold text-muted-foreground" aria-hidden="true" data-bio-initials>{initials(view.name)}</span>}
        <div className="min-w-0 flex-1 space-y-1 @md:pb-1"><Title className="break-words text-2xl font-semibold tracking-tight">{view.name}</Title>
          <p className="break-words text-sm text-muted-foreground">{view.subtitle || t("ministry", { ministry: view.ministryName })}</p></div>
        {message ? <Button type="button" variant={primaryStyle} className="min-h-11 w-full @md:w-auto" onClick={goToMessage} data-bio-primary><MessageCircle aria-hidden="true" />{message.type === "message" ? message.title : ""}</Button>
          : firstLink ? <Button asChild variant={primaryStyle} className="min-h-11 w-full @md:w-auto" data-bio-primary><a href={firstLink.url} target="_blank" rel="nofollow noopener noreferrer ugc" {...inert} onClick={click(firstLink.id)}>{firstLink.type === "link" ? firstLink.label : firstLink.title}<ExternalLink aria-hidden="true" /></a></Button> : null}
      </header>
      {view.bio && <p className="whitespace-pre-line break-words text-base">{view.bio}</p>}
      {view.socials.length > 0 && <ul className="flex flex-wrap justify-center gap-2 @md:justify-start" data-bio-socials>{view.socials.map((social) => <li key={social.network}>
        <a href={social.url} target="_blank" rel="nofollow noopener noreferrer ugc" {...inert} aria-label={t("socialLabel", { name: view.name, network: t(`networks.${social.network}`) })}
          className="flex size-11 items-center justify-center rounded-full border bg-card text-card-foreground outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"><NetworkMark network={social.network} /></a></li>)}</ul>}
      <Body {...(preview ? {} : { id: "main-content" })} className="space-y-4">
        {view.tabs.length > 1
          ? <Tabs value={active} onValueChange={(value) => setTab(value as typeof tab)} className="gap-4">
            <TabsList className="w-full" aria-label={t("tabs")}>{view.tabs.map((x) => <TabsTrigger key={x.id} value={x.id} className="flex-1">{tn(`tabs.${x.id}`)}</TabsTrigger>)}</TabsList>
            {view.tabs.map((x) => <TabsContent key={x.id} value={x.id} data-bio-tab={x.id}>{panel(x.id, x.blocks)}</TabsContent>)}
          </Tabs>
          : view.tabs.map((x) => <div key={x.id} data-bio-tab={x.id}>{panel(x.id, x.blocks)}</div>)}
      </Body>
    </div>
  </div>;
}
