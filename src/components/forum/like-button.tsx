"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Heart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCrmRequest } from "@/components/crm/request";
import { cn } from "@/lib/utils";

export function LikeButton({ slug, targetType, targetId, likes, liked, disabled = false, label }: { slug: string; targetType: "post" | "comment"; targetId: string;
  likes: number; liked: boolean; disabled?: boolean; label: string }) {
  const t = useTranslations("CommunityForum"), request = useCrmRequest();
  const [state, setState] = useState({ likes, liked }), [busy, setBusy] = useState(false);
  async function toggle() {
    setBusy(true);
    const result = await request<{ liked: boolean }>(`/api/communities/${slug}/likes`, { method: "POST", body: { targetType, targetId } });
    setBusy(false);
    if (result.ok) setState((s) => ({ liked: result.data.liked, likes: s.likes + (result.data.liked ? 1 : -1) }));
  }
  if (disabled) return null;
  return <Button type="button" variant="ghost" className="min-h-11 gap-1.5 px-3" aria-pressed={state.liked} disabled={busy} onClick={() => void toggle()}
    aria-label={t(state.liked ? "unlikeNamed" : "likeNamed", { name: label })}>
    <Heart className={cn("size-4", state.liked && "fill-current")} aria-hidden="true" /><span aria-hidden="true">{state.likes}</span>
  </Button>;
}
