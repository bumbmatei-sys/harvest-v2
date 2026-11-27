"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { ClipboardList, ExternalLink, Users } from "lucide-react";
import { HostedSignup } from "@/components/newsletter/hosted-signup";
import { SwipeTabs } from "@/components/swipe-tabs";
import { bioIconComponents } from "@/components/link-in-bio/bio-icons";
import { BioCover, BioHeader } from "@/components/link-in-bio/bio-header";
import { BioMessageForm } from "@/components/link-in-bio/bio-message-form";
import { WaysToGive } from "@/components/giving/ways-to-give";
import { LessonVideoPlayer } from "@/components/catalog/lesson-video";
import { BioCatalog } from "@/components/link-in-bio/blocks/bio-catalog";
import { BioContact } from "@/components/link-in-bio/blocks/bio-contact";
import { BioFileList } from "@/components/link-in-bio/blocks/bio-file-list";
import { BioLocation } from "@/components/link-in-bio/blocks/bio-location";
import { BioTestimonials } from "@/components/link-in-bio/blocks/bio-testimonials";
import { BioCountdown } from "@/components/link-in-bio/blocks/bio-countdown";
import { BioGallery } from "@/components/link-in-bio/blocks/bio-gallery";
import { BioShare } from "@/components/link-in-bio/blocks/bio-share";
import { isLegacyTabId, messageNotice, type BioView, type BioViewBlock } from "@/lib/link-in-bio";

const host = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } };
function beacon(handle: string, block: string) {
  try { void fetch(`/l/${encodeURIComponent(handle)}/click`, { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ block }) }).catch(() => undefined); } catch { /* A click is never blocked by counting. */ }
}
const linkTypes = new Set<BioViewBlock["type"]>(["link", "event", "community", "form"]);
/** Blocks in the owner's order, with neighbouring link rows grouped into one bordered list. */
function runs(blocks: BioViewBlock[]) {
  const out: (BioViewBlock | BioViewBlock[])[] = [];
  for (const block of blocks) {
    const last = out[out.length - 1];
    if (linkTypes.has(block.type)) { if (Array.isArray(last)) last.push(block); else out.push([block]); } else out.push(block);
  }
  return out;
}

/**
 * The public page and the editor's live preview: one renderer. Layout: a profile header (`BioHeader`: optional cover, round photo left or centre, name, subtitle,
 * one row of icons, main action), then the owner's tabs (swipeable on a phone, `SwipeTabs`) or a single page. Built from Harvest components and Tailwind; it sizes by its own container so the phone-framed preview and a real phone
 * stack the same way. `preview` makes every control inert (no navigation, no counting, no form posts) and takes the images from the editor.
 */
export function BioPageView({ view, handle, preview = false, photoUrl = null, coverUrl = null, galleryUrls }: { view: BioView; handle: string; preview?: boolean; photoUrl?: string | null; coverUrl?: string | null;
  /** The editor's signed previews of gallery pictures, by id (the public page uses its own redirect). */
  galleryUrls?: Record<string, string | null> }) {
  const t = useTranslations("LinkInBio.public"), tn = useTranslations("LinkInBio");
  const [tab, setTab] = useState(view.tabs[0]?.id ?? "home");
  const tabName = (x: BioView["tabs"][number]) => x.label || (isLegacyTabId(x.id) ? tn(`tabs.${x.id}`) : "");
  const active = view.tabs.some((x) => x.id === tab) ? tab : (view.tabs[0]?.id ?? "home");
  const Body = preview ? "div" : "main", Title = preview ? "h2" : "h1";
  const inert = preview ? { tabIndex: -1, onClick: (event: React.MouseEvent) => event.preventDefault() } : {};
  const photo = photoUrl ?? (view.hasPhoto && !preview ? `/l/${encodeURIComponent(handle)}/photo` : null);
  const cover = coverUrl ?? (view.hasCover && !preview ? `/l/${encodeURIComponent(handle)}/banner` : null);
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
    if (item.type === "form") return <li key={item.id} data-bio-block={item.id}><a href={`/f/${item.slug}`} className={rowClass} {...inert} onClick={click(item.id)} onAuxClick={preview ? undefined : () => beacon(handle, item.id)}>
      <ClipboardList className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="min-w-0 flex-1 break-words text-base font-medium">{item.title}</span>
      <span className="shrink-0 text-sm font-medium">{t("openForm")}</span></a></li>;
    if (item.type === "community") return <li key={item.id} data-bio-block={item.id}><a href={`/communities/${item.slug}`} className={rowClass} {...inert} onClick={click(item.id)} onAuxClick={preview ? undefined : () => beacon(handle, item.id)}>
      <Users className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="min-w-0 flex-1"><span className="block text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("communityLabel")}</span>
        <span className="block break-words text-base font-medium">{item.name}</span>{item.tagline && <span className="block text-sm text-muted-foreground">{item.tagline}</span>}</span>
      <span className="shrink-0 text-sm font-medium">{t("viewCommunity")}</span></a></li>;
    return null;
  }
  const open = (id: string) => preview ? inert.onClick : () => beacon(handle, id);
  function block(item: BioViewBlock) {
    switch (item.type) {
      case "newsletter": return preview ? <div className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">{t("newsletterPlaceholder")}</div> : <HostedSignup slug={item.slug} />;
      case "message": return <BioMessageForm handle={handle} title={item.title} notice={messageNotice(view.ministryName)} inert={preview} />;
      case "giving": return <WaysToGive methods={item.methods} title={item.title} ministryName={view.ministryName} inert={preview} reportUrl={preview ? undefined : `/l/${encodeURIComponent(handle)}/report`} />;
      case "catalog": return <BioCatalog title={item.title} items={item.items} preview={preview} onOpen={open(item.id)} />;
      case "files": return <BioFileList title={item.title} items={item.items} onOpen={open(item.id)} inert={preview ? { tabIndex: -1 } : undefined} />;
      case "video": return <section aria-label={item.title || t("videoLabel")} className="space-y-2" onClickCapture={preview ? (event) => event.preventDefault() : () => beacon(handle, item.id)}>
        {item.title && <h2 className="text-base font-semibold">{item.title}</h2>}{preview ? <div className="flex aspect-video items-center justify-center rounded-lg border bg-muted text-sm text-muted-foreground">{t("videoLabel")}</div> : <LessonVideoPlayer video={item.video} title={item.title || view.name} />}</section>;
      case "contact": return <BioContact email={item.email} phone={item.phone} whatsapp={item.whatsapp} onOpen={open(item.id)} inert={preview ? { tabIndex: -1 } : undefined} />;
      case "location": return <BioLocation label={item.label} address={item.address} onOpen={open(item.id)} inert={preview ? { tabIndex: -1 } : undefined} />;
      case "live": return <a href={item.url} target="_blank" rel="nofollow noopener noreferrer ugc" {...inert} onClick={open(item.id)} data-bio-live
        className="flex min-h-12 items-center gap-3 rounded-xl border border-destructive/40 bg-card px-4 py-3 text-card-foreground outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50">
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-destructive px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-destructive-foreground" data-bio-live-badge><span className="size-1.5 rounded-full bg-destructive-foreground motion-safe:animate-pulse" aria-hidden="true" />{t("live")}</span>
        <span className="min-w-0 flex-1 break-words text-base font-medium">{item.title}</span><ExternalLink className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /><span className="sr-only">{t("openLink")}</span></a>;
      case "testimonials": return <BioTestimonials items={item.items} />;
      case "gallery": return <BioGallery title={item.title} fileIds={item.fileIds} preview={preview} src={(id) => preview ? galleryUrls?.[id] ?? null : `/l/${encodeURIComponent(handle)}/gallery/${id}`} />;
      case "share": return <BioShare title={item.title} handle={handle} preview={preview} />;
      case "countdown": return <BioCountdown title={item.title} at={item.at} url={item.url} inert={preview ? inert : undefined} />;
      default: return null;
    }
  }
  const panel = (blocks: BioViewBlock[]) => {
    return <div className="space-y-4">
      {runs(blocks).map((item) => Array.isArray(item) ? <section key={item[0].id} className="rounded-xl border bg-card text-card-foreground"><ul className="divide-y overflow-hidden rounded-xl">{item.map(row)}</ul></section>
        : <div key={item.id} data-bio-block={item.id}>{block(item)}</div>)}
    </div>;
  };

  const tabbed = view.layout === "tabs" && view.tabs.length > 1;

  return <div className="@container w-full text-foreground" data-bio-page data-bio-layout={view.layout}>
    {view.showCover && <BioCover cover={cover} />}
    <div className="mx-auto w-full max-w-3xl space-y-5 px-4 pb-10">
      <BioHeader view={view} photo={photo} preview={preview} Title={Title} />
      <Body {...(preview ? {} : { id: "main-content" })} className="space-y-4">
        {tabbed
          ? <SwipeTabs value={active} onValueChange={setTab} label={t("tabs")} swipe={!preview} tabs={view.tabs.map((x) => ({ id: x.id, label: tabName(x), content: <div data-bio-tab={x.id}>{panel(x.blocks)}</div> }))} />
          : view.tabs.map((x) => <div key={x.id} data-bio-tab={x.id}>{panel(x.blocks)}</div>)}
      </Body>
    </div>
  </div>;
}
