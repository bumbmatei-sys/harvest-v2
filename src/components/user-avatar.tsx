/** Layout and behaviour modelled on bumbmatei-sys/chat-app (Shadcn UI Kit, premium, founder-supplied 19 Nov 2026): components/user-avatar.tsx; code written for Harvest, no kit code copied. Harvest notes: docs/ui-sources.md. */
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { memberInitials } from "@/lib/community-members";
import { cn } from "@/lib/utils";

/** Initials in a round avatar. Members have no photo yet, so there is no image or presence indicator. */
export default function UserAvatar({ name, emoji, className }: { name: string; emoji?: string | null; className?: string }) {
  return <Avatar size="default" className={cn("size-10", className)}>
    <AvatarFallback aria-hidden="true">{emoji || memberInitials(name)}</AvatarFallback>
  </Avatar>;
}
