import { AtSign, BookOpen, Calendar, Globe, Gift, Heart, MapPin, Mail, Music, Phone, Podcast, Video, type LucideIcon } from "lucide-react";
import { PlatformLogo } from "@/components/social/platform-logo";
import type { BioIcon, BioNetwork } from "@/lib/link-in-bio";
import type { SocialPlatform } from "@/lib/social/platforms";

export const bioIconComponents: Record<BioIcon, LucideIcon> = { globe: Globe, mail: Mail, phone: Phone, heart: Heart, book: BookOpen, calendar: Calendar, video: Video, music: Music, map: MapPin, gift: Gift };
const platformOf: Partial<Record<BioNetwork, SocialPlatform>> = { instagram: "instagram", facebook: "facebook", youtube: "youtube", x: "twitter", tiktok: "tiktok", linkedin: "linkedin", threads: "threads", whatsapp: "whatsapp" };
/** The mark of a social network (the network's own glyph where Harvest has one, a neutral icon otherwise). Decorative: the link carries the accessible name. */
export function NetworkMark({ network, className = "size-5" }: { network: BioNetwork; className?: string }) {
  const platform = platformOf[network];
  if (platform) return <PlatformLogo platform={platform} className={className} />;
  const Icon = network === "podcast" ? Podcast : network === "website" ? Globe : AtSign;
  return <Icon className={className} aria-hidden="true" />;
}
