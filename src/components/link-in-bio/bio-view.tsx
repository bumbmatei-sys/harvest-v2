"use client";
import { useTranslations } from "next-intl";
import { ExternalLink, Users } from "lucide-react";
import { HostedSignup } from "@/components/newsletter/hosted-signup";
import { bioIconComponents, NetworkMark } from "@/components/link-in-bio/bio-icons";
import { BioMessageForm } from "@/components/link-in-bio/bio-message-form";
import { messageNotice, type BioView, type BioViewBlock } from "@/lib/link-in-bio";
import { cn } from "@/lib/utils";

const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map((word) => Array.from(word)[0] ?? "").join("").toUpperCase() || "·";
const host = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } };
function beacon(handle: string, block: string) {
  try { void fetch(`/l/${encodeURIComponent(handle)}/click`, { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ block }) }).catch(() => undefined); } catch { /* A click is never blocked by counting. */ }
}

/**
 * The public page and the editor's live preview: one renderer. `preview` makes every control inert (no navigation, no counting, no form posts) and
 * takes the photo address from the editor. The public column is intentionally narrow and centred; the owner's editor keeps the full-width shell.
 */
export function BioPageView({ view, handle, preview = false, photoUrl = null }: { view: BioView; handle: string; preview?: boolean; photoUrl?: string | null }) {
  const t = useTranslations("LinkInBio.public"), Body = preview ? "div" : "main", Title = preview ? "h2" : "h1";
  const filled = view.buttons === "filled";
  const row = cn("flex min-h-12 w-full items-center gap-3 rounded-xl px-4 py-2.5 text-left outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50",
    filled ? "bg-primary text-primary-foreground hover:bg-primary/90" : "border bg-card text-card-foreground hover:bg-accent");
  const inert = preview ? { tabIndex: -1, onClick: (event: React.MouseEvent) => event.preventDefault() } : {};
  const src = photoUrl ?? (view.hasPhoto && !preview ? `/l/${encodeURIComponent(handle)}/photo` : null);

  function block(item: BioViewBlock) {
    switch (item.type) {
      case "link": {
        const Icon = item.icon ? bioIconComponents[item.icon] : null;
        return <a key={item.id} href={item.url} target="_blank" rel="nofollow noopener noreferrer ugc" className={row} data-bio-block={item.id}
          {...inert} onClick={preview ? inert.onClick : () => beacon(handle, item.id)} onAuxClick={preview ? undefined : () => beacon(handle, item.id)}>
          {Icon && <Icon className="size-5 shrink-0" aria-hidden="true" />}
          <span className="min-w-0 flex-1"><span className="block break-words text-base font-medium">{item.label}</span><span className="block truncate text-xs opacity-80">{host(item.url)}</span></span>
          <ExternalLink className="size-4 shrink-0 opacity-70" aria-hidden="true" /><span className="sr-only">{t("openLink")}</span></a>;
      }
      case "event":
        return <a key={item.id} href={item.url} target="_blank" rel="nofollow noopener noreferrer ugc" className={row} data-bio-block={item.id}
          {...inert} onClick={preview ? inert.onClick : () => beacon(handle, item.id)} onAuxClick={preview ? undefined : () => beacon(handle, item.id)}>
          <span className="min-w-0 flex-1"><span className="block text-xs font-medium uppercase tracking-wide opacity-80">{t("eventLabel")}</span>
            <span className="block break-words text-base font-semibold">{item.title}</span><span className="block text-sm opacity-90">{item.when}</span></span>
          <ExternalLink className="size-4 shrink-0 opacity-70" aria-hidden="true" /><span className="sr-only">{t("openLink")}</span></a>;
      case "community":
        return <a key={item.id} href={`/communities/${item.slug}`} className={row} data-bio-block={item.id} {...inert}
          onClick={preview ? inert.onClick : () => beacon(handle, item.id)} onAuxClick={preview ? undefined : () => beacon(handle, item.id)}>
          <Users className="size-5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1"><span className="block text-xs font-medium uppercase tracking-wide opacity-80">{t("communityLabel")}</span>
            <span className="block break-words text-base font-semibold">{item.name}</span>{item.tagline && <span className="block text-sm opacity-90">{item.tagline}</span>}</span>
          <span className="shrink-0 text-sm font-medium">{t("viewCommunity")}</span></a>;
      case "newsletter":
        return <div key={item.id} data-bio-block={item.id}>{preview ? <div className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">{t("newsletterPlaceholder")}</div> : <HostedSignup slug={item.slug} />}</div>;
      case "message":
        return <div key={item.id} data-bio-block={item.id}><BioMessageForm handle={handle} title={item.title} notice={messageNotice(view.ministryName)} inert={preview} /></div>;
    }
  }

  return <div className="mx-auto flex w-full max-w-md flex-col items-center gap-6 px-4 py-10 text-foreground" data-bio-page>
    <header className="flex w-full flex-col items-center gap-3 text-center">
      {/* eslint-disable-next-line @next/next/no-img-element -- a signed redirect from the server, not optimisable */}
      {src ? <img src={src} alt={t("photoAlt", { name: view.name })} className="size-24 rounded-full border object-cover" data-bio-photo />
        : <span className="flex size-24 items-center justify-center rounded-full border bg-muted text-2xl font-semibold text-muted-foreground" aria-hidden="true" data-bio-initials>{initials(view.name)}</span>}
      <div className="space-y-1"><Title className="break-words text-2xl font-semibold tracking-tight">{view.name}</Title>
        <p className="text-sm text-muted-foreground">{t("ministry", { ministry: view.ministryName })}</p></div>
      {view.bio && <p className="whitespace-pre-line break-words text-base">{view.bio}</p>}
      {view.socials.length > 0 && <ul className="flex flex-wrap justify-center gap-2" data-bio-socials>{view.socials.map((social) => <li key={social.network}>
        <a href={social.url} target="_blank" rel="nofollow noopener noreferrer ugc" {...inert} aria-label={t("socialLabel", { name: view.name, network: t(`networks.${social.network}`) })}
          className="flex size-11 items-center justify-center rounded-full border bg-card text-card-foreground outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"><NetworkMark network={social.network} /></a></li>)}</ul>}
    </header>
    <Body {...(preview ? {} : { id: "main-content" })} className="flex w-full flex-col gap-3">{view.blocks.map(block)}</Body>
  </div>;
}
