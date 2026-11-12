import { ExternalLink, PlayCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import type { VideoEmbed } from "@/lib/video-embed";

/** Embedded player for allow-listed, privacy-enhanced video URLs (sandboxed); any other link is a link card. */
export function VideoEmbedView({ video, title }: { video: VideoEmbed; title: string }) {
  const t = useTranslations("CommunityForum");
  if (video.kind === "embed") return <div className="aspect-video w-full overflow-hidden rounded-lg border bg-muted">
    <iframe src={video.src} title={t("videoTitle", { title })} className="size-full" loading="lazy" referrerPolicy="strict-origin-when-cross-origin"
      sandbox="allow-scripts allow-same-origin allow-presentation allow-popups" allow="fullscreen; picture-in-picture; encrypted-media" />
  </div>;
  return <a href={video.href} target="_blank" rel="nofollow noopener noreferrer ugc" className="flex min-h-11 items-center gap-3 rounded-lg border p-3 text-sm hover:bg-muted">
    <PlayCircle className="size-5 shrink-0" aria-hidden="true" /><span className="min-w-0 flex-1 truncate">{video.href}</span><ExternalLink className="size-4 shrink-0" aria-hidden="true" />
  </a>;
}
