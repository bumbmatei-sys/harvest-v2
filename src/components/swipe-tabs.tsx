"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import useEmblaCarousel from "embla-carousel-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

export type SwipeTab = { id: string; label: string; content: ReactNode };

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

/**
 * Tabs whose panels sit side by side in a carousel (embla-carousel, MIT, pinned; docs/ui-sources.md): tap a tab, use the arrow keys on the tab list, or
 * swipe the panel sideways on a touch screen. Only touch starts a swipe, so a mouse still selects text and form fields keep working. Every panel is a real
 * tabpanel; the ones out of view are `inert`, so neither the keyboard nor a screen reader lands in them. The viewport takes the height of the panel in
 * view. Under reduced motion the change is instant. The tab bar scrolls sideways when the names do not fit.
 */
export function SwipeTabs({ tabs, value, onValueChange, label, swipe = true, listClassName, className }: {
  tabs: readonly SwipeTab[]; value: string; onValueChange: (id: string) => void; label: string; swipe?: boolean; listClassName?: string; className?: string;
}) {
  const index = Math.max(0, tabs.findIndex((tab) => tab.id === value));
  const [viewport, api] = useEmblaCarousel({ startIndex: index, duration: 22, watchDrag: (_api, event) => swipe && event.type === "touchstart" });
  const slides = useRef<(HTMLDivElement | null)[]>([]);
  const [height, setHeight] = useState<number | undefined>(undefined);
  const ids = tabs.map((tab) => tab.id).join("|");

  // A swipe chooses the tab.
  useEffect(() => {
    if (!api) return;
    const select = () => { const next = tabs[api.selectedScrollSnap()]; if (next && next.id !== value) onValueChange(next.id); };
    api.on("select", select);
    return () => { api.off("select", select); };
  }, [api, tabs, value, onValueChange]);
  // A tab chosen by tap or keyboard brings its panel into view.
  useEffect(() => { if (api && api.selectedScrollSnap() !== index) api.scrollTo(index, reducedMotion()); }, [api, index]);
  // Panels can be added, removed or reordered (the editor's preview).
  useEffect(() => { api?.reInit(); }, [api, ids]);
  // The viewport follows the height of the panel in view.
  useEffect(() => {
    const node = slides.current[index];
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setHeight(node.offsetHeight));
    observer.observe(node); setHeight(node.offsetHeight);
    return () => observer.disconnect();
  }, [index, ids]);

  return <Tabs value={tabs[index]?.id} onValueChange={onValueChange} className={cn("gap-4", className)}>
    <TabsList variant="line" className={cn("w-full justify-start border-b", listClassName)} aria-label={label}>
      {tabs.map((tab) => <TabsTrigger key={tab.id} value={tab.id} className="min-w-11">{tab.label}</TabsTrigger>)}
    </TabsList>
    <div ref={viewport} className="overflow-hidden motion-safe:transition-[height] motion-safe:duration-200" style={height === undefined ? undefined : { height }} data-swipe-tabs>
      <div className="flex items-start">
        {tabs.map((tab, position) => <TabsContent key={tab.id} value={tab.id} forceMount ref={(node) => { slides.current[position] = node; }}
          inert={position !== index} className="min-w-0 shrink-0 grow-0 basis-full" data-swipe-tab={tab.id}>{tab.content}</TabsContent>)}
      </div>
    </div>
  </Tabs>;
}
