"use client";
import { cn } from "@/lib/utils";

/** Page sections as a button row with aria-current (the sections swap the page body and the URL, so they are navigation, not tab panels). */
export function TabNav({ label, value, onChange, items }: { label: string; value: string; onChange: (value: string) => void; items: { value: string; label: string; count?: number }[] }) {
  return <nav aria-label={label} className="max-w-full self-start overflow-x-auto"><div className="inline-flex rounded-lg bg-muted p-[3px]">
    {items.map((item) => <button key={item.value} type="button" aria-current={value === item.value ? "page" : undefined} onClick={() => onChange(item.value)}
      className={cn("inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-md px-4 text-sm font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 lg:min-h-8", value === item.value ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}>
      {item.label}{item.count !== undefined && <span className="rounded-full bg-background/60 px-1.5 text-xs tabular-nums">{item.count}</span>}</button>)}
  </div></nav>;
}
