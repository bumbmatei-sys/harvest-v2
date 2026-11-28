import { AtSign, BookOpen, Calendar, Globe, Gift, Heart, MapPin, Mail, Music, Phone, Podcast, Video, type LucideIcon } from "lucide-react";
import { PlatformLogo } from "@/components/social/platform-logo";
import type { BioIcon, BioNetwork } from "@/lib/link-in-bio";
import type { SocialPlatform } from "@/lib/social/platforms";
import { cn } from "@/lib/utils";

export const bioIconComponents: Record<BioIcon, LucideIcon> = { globe: Globe, mail: Mail, phone: Phone, heart: Heart, book: BookOpen, calendar: Calendar, video: Video, music: Music, map: MapPin, gift: Gift };
const platformOf: Partial<Record<BioNetwork, SocialPlatform>> = { instagram: "instagram", facebook: "facebook", youtube: "youtube", x: "twitter", tiktok: "tiktok", linkedin: "linkedin", threads: "threads", whatsapp: "whatsapp" };
/**
 * The mark of a social network (the network's own glyph where Harvest has one, a neutral icon otherwise). Decorative: the link carries the accessible name.
 * `colored` draws the network's own colours (the page's "colour" icon style); a mark without brand colours takes the theme's primary colour.
 */
export function NetworkMark({ network, className = "size-5", colored = false }: { network: BioNetwork; className?: string; colored?: boolean }) {
  const platform = platformOf[network];
  if (platform) return <PlatformLogo platform={platform} className={className} colored={colored} />;
  const Icon = network === "podcast" ? Podcast : network === "website" ? Globe : AtSign;
  return <Icon className={cn(className, colored && "text-primary")} aria-hidden="true" data-colored={colored || undefined} />;
}
