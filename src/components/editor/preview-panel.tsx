"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ExternalLink, Monitor, Pencil, Smartphone } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useMediaQuery } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";
import type { PreviewDevice, PreviewViewer } from "@/lib/editor-preview";

export type PreviewSurface = "column" | "sheet";
export type PreviewFrameContext = { device: PreviewDevice; /** The frame is the viewport (phone and tablet sheet): no bezel, no device choice. */ bare: boolean };
const focusable = "a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex='-1']), [contenteditable]";
const desktopWidth = 1024;

/**
 * Shell-owned preview frame (shell slice 3b): "Preview (draft)" label, tabs, a view-as switch, a device switch, Open in browser (only when the
 * item is published) and a keyboard "Edit this" list. The module supplies the content as a render function over plain data; nothing here
 * fetches or sends. The content sits in the same document, not an iframe; its clicks are swallowed (never navigate, submit or toggle) and
 * its controls are taken out of the tab order, so the form stays the only place to act. A click on an element that carries
 * `data-preview-field` is reported through `onEdit` (click-to-field).
 */
export function EditorPreviewPanel({ surface, frameLabel, tabs, tab, onTab, viewer, onViewer, fields, onEdit, highlight = null, openPage, children }: {
  surface: PreviewSurface; frameLabel: string; tabs: { id: string; label: string }[]; tab: string; onTab: (id: string) => void;
  viewer: PreviewViewer; onViewer: (viewer: PreviewViewer) => void; fields: { id: string; label: string }[]; onEdit: (field: string) => void;
  highlight?: string | null; openPage?: { href: string; label: string }; children: (frame: PreviewFrameContext) => React.ReactNode;
}) {
  const t = useTranslations("EditorMode");
  const [device, setDevice] = useState<PreviewDevice>("phone");
  const compact = useMediaQuery("(max-width: 1023px)");
  const bare = surface === "sheet" && compact;
  const fill = surface === "sheet";
  const picked = useRef<string | null>(null);
  const region = useRef<HTMLDivElement>(null), holder = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const effective: PreviewDevice = bare ? "phone" : device;

  // Desktop width is a 64rem page shown scaled to the room there is.
  useLayoutEffect(() => {
    const node = holder.current;
    if (!node || effective !== "desktop") return;
    const measure = () => setScale(Math.min(1, node.clientWidth / desktopWidth));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [effective]);

  // The content is a picture of the page: nothing inside it can take focus.
  useEffect(() => {
    const node = region.current;
    if (!node) return;
    const park = () => node.querySelectorAll<HTMLElement>(focusable).forEach((el) => { if (el !== node && el.getAttribute("tabindex") !== "-1") el.setAttribute("tabindex", "-1"); });
    park();
    const observer = new MutationObserver(park);
    observer.observe(node, { childList: true, subtree: true, attributes: true, attributeFilter: ["tabindex"] });
    return () => observer.disconnect();
  });
  // Focusing a field in the form highlights its element here.
  useEffect(() => {
    region.current?.querySelectorAll<HTMLElement>("[data-preview-field]").forEach((el) => el.toggleAttribute("data-preview-active", el.dataset.previewField === highlight));
  });

  function swallow(event: React.MouseEvent) {
    event.preventDefault(); event.stopPropagation();
    const field = (event.target as HTMLElement).closest<HTMLElement>("[data-preview-field]")?.dataset.previewField;
    if (field) onEdit(field);
  }
  const frame: PreviewFrameContext = { device: effective, bare };
  const content = <div ref={region} role="region" aria-label={frameLabel} tabIndex={0} data-editor-preview-frame onClickCapture={swallow} onSubmitCapture={(e) => e.preventDefault()}
    className={cn("h-full overflow-y-auto overscroll-contain bg-background outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
      "[&_[data-preview-field]]:cursor-pointer [&_[data-preview-field]]:rounded-md [&_[data-preview-field]]:transition-shadow hover:[&_[data-preview-field]]:ring-2 hover:[&_[data-preview-field]]:ring-ring/60",
      "[&_[data-preview-active]]:ring-2 [&_[data-preview-active]]:ring-ring [&_[data-preview-active]]:ring-offset-2 [&_[data-preview-active]]:ring-offset-background motion-reduce:[&_[data-preview-field]]:transition-none")}>
    {effective === "desktop"
      ? <div style={{ width: desktopWidth, zoom: scale }} className="p-8">{children(frame)}</div>
      : <div className={cn("p-4", bare && "mx-auto max-w-xl")}>{children(frame)}</div>}
  </div>;

  return <div data-editor-preview-panel data-surface={surface} className={cn("flex min-w-0 flex-col gap-3", fill && "h-full min-h-0")}>
    {surface === "sheet" && !openPage
      ? <p className="sr-only" data-editor-preview-label>{t("previewDraft")}</p>
      : <div className="flex min-h-11 flex-wrap items-center justify-between gap-2 lg:min-h-0">
        <p className={cn("text-xs font-medium tracking-wide text-muted-foreground uppercase", surface === "sheet" && "sr-only")} data-editor-preview-label>{t("previewDraft")}</p>
        {openPage && <Button asChild variant="ghost" size="sm" className="ml-auto min-h-11 lg:min-h-8"><a href={openPage.href} target="_blank" rel="noopener"><ExternalLink aria-hidden="true" />{openPage.label}</a></Button>}
      </div>}
    <Tabs value={tab} onValueChange={onTab} className={cn(fill && "min-h-0 flex-1")}>
      <TabsList aria-label={t("previewTabs")} className="h-auto w-full p-[3px] group-data-[orientation=horizontal]/tabs:h-auto">
        {tabs.map((item) => <TabsTrigger key={item.id} value={item.id} className="min-h-11 lg:min-h-9">{item.label}</TabsTrigger>)}
      </TabsList>
      <div className="flex flex-wrap items-center gap-2" data-editor-preview-controls>
        <ToggleGroup type="single" variant="outline" size="sm" value={viewer} aria-label={t("viewAs")} onValueChange={(value) => { if (value) onViewer(value as PreviewViewer); }}>
          <ToggleGroupItem value="visitor">{t("visitor")}</ToggleGroupItem>
          <ToggleGroupItem value="member">{t("member")}</ToggleGroupItem>
        </ToggleGroup>
        {!bare && <ToggleGroup type="single" variant="outline" size="sm" value={device} aria-label={t("device")} onValueChange={(value) => { if (value) setDevice(value as PreviewDevice); }}>
          <ToggleGroupItem value="phone" aria-label={t("phone")}><Smartphone aria-hidden="true" /></ToggleGroupItem>
          <ToggleGroupItem value="desktop" aria-label={t("desktop")}><Monitor aria-hidden="true" /></ToggleGroupItem>
        </ToggleGroup>}
        {fields.length > 0 && <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="outline" size="sm" className="ml-auto min-h-11 lg:min-h-8"><Pencil aria-hidden="true" />{t("editThis")}</Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end" onCloseAutoFocus={(event) => { const field = picked.current; if (!field) return; picked.current = null; event.preventDefault(); onEdit(field); }}>
            {fields.map((field) => <DropdownMenuItem key={field.id} className="min-h-11 lg:min-h-8" onSelect={() => { picked.current = field.id; }}>{field.label}</DropdownMenuItem>)}
          </DropdownMenuContent>
        </DropdownMenu>}
      </div>
      <TabsContent value={tab} tabIndex={-1} className={cn("mt-1", fill && "flex min-h-0 flex-col")}>
        <div ref={holder} data-device={effective} className={cn(fill ? "min-h-0 flex-1" : "h-[min(36rem,calc(100dvh-14rem))]", fill && !bare && "mx-auto flex max-h-[48rem] justify-center")}>
          {bare
            ? <div className="h-full overflow-hidden rounded-xl border">{content}</div>
            : effective === "phone"
              ? <div className="mx-auto h-full w-full max-w-[20rem] overflow-hidden rounded-[1.75rem] border-[6px] border-foreground/15 bg-background shadow-sm">{content}</div>
              : <div className="h-full w-full overflow-hidden rounded-lg border shadow-sm">{content}</div>}
        </div>
      </TabsContent>
    </Tabs>
  </div>;
}
