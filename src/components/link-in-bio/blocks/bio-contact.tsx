/** Derived from Shadcn UI Kit item contact9 (premium), registry retrieved 2026-11-27, approved 2026-11-27 (Link in bio rework). Visual reference only; local changes: docs/ui-sources.md. */
"use client";
import { useTranslations } from "next-intl";
import { Mail, MessageCircle, Phone, type LucideIcon } from "lucide-react";
import { telHref, whatsappHref } from "@/lib/link-in-bio";

/** Contact: email, phone and WhatsApp as tappable cards (one per channel the owner filled in), each with a round icon, the channel name and the value. */
export function BioContact({ email, phone, whatsapp, onOpen, inert }: { email: string; phone: string; whatsapp: string; onOpen?: (event: React.MouseEvent) => void; inert?: { tabIndex?: number } }) {
  const t = useTranslations("LinkInBio.public");
  const channels: { key: string; Icon: LucideIcon; label: string; value: string; href: string; external: boolean }[] = [
    ...(email ? [{ key: "email", Icon: Mail, label: t("contactEmail"), value: email, href: `mailto:${email}`, external: false }] : []),
    ...(phone ? [{ key: "phone", Icon: Phone, label: t("contactPhone"), value: phone, href: telHref(phone), external: false }] : []),
    ...(whatsapp ? [{ key: "whatsapp", Icon: MessageCircle, label: t("contactWhatsapp"), value: whatsapp, href: whatsappHref(whatsapp), external: true }] : []),
  ];
  return <section aria-label={t("contactLabel")} className="grid gap-3 @md:grid-cols-3" data-bio-contact>
    {channels.map(({ key, Icon, label, value, href, external }) => <a key={key} href={href} {...inert} onClick={onOpen} {...(external ? { target: "_blank", rel: "nofollow noopener noreferrer ugc" } : {})}
      className="flex min-h-11 flex-row items-center gap-3 rounded-xl border bg-card p-4 text-card-foreground outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 @md:flex-col @md:text-center" data-bio-contact-channel={key}>
      <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary/10" aria-hidden="true"><Icon className="size-5 text-primary" /></span>
      <span className="min-w-0"><span className="block text-sm font-semibold">{label}</span><span className="block break-all text-sm text-muted-foreground">{value}</span></span>
    </a>)}
  </section>;
}
