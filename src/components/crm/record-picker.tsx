"use client";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { Plus } from "lucide-react";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useCrmRequest } from "./request";

export type PickerItem = { id: string; label: string; hint?: string | null };

/**
 * Server-searched combobox. Results are tenant-scoped by the same list endpoint the
 * tables use, so a picker can never offer another workspace's record.
 */
export function RecordPicker({ endpoint, toItem, exclude = [], trigger, title, placeholder, emptyLabel, onSelect, createLabel, onCreate, align = "start" }: {
  endpoint: string; toItem: (row: Record<string, unknown>) => PickerItem; exclude?: string[];
  trigger: React.ReactNode; title: string; placeholder: string; emptyLabel: string;
  onSelect: (item: PickerItem) => Promise<string | null> | void;
  createLabel?: (query: string) => string; onCreate?: (query: string) => Promise<string | null>;
  align?: "start" | "end";
}) {
  const crmRequest = useCrmRequest();
  const t = useTranslations("Crm");
  const [open, setOpen] = useState(false), [query, setQuery] = useState(""), [items, setItems] = useState<PickerItem[]>([]);
  const [loading, setLoading] = useState(false), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined), request = useRef(0);
  function search(value: string) {
    const ticket = ++request.current;
    setLoading(true); setError("");
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const result = await crmRequest<{ rows: Record<string, unknown>[] }>(`${endpoint}?${new URLSearchParams(value.trim() ? { q: value.trim() } : {})}`, { method: "GET" });
      if (ticket !== request.current) return;
      setLoading(false);
      if (!result.ok) { setError(result.error); setItems([]); return; }
      setItems(result.data.rows.map(toItem));
    }, value ? 200 : 0);
  }
  async function run(action: () => Promise<string | null> | void) {
    setBusy(true); setError("");
    const failure = await action();
    setBusy(false);
    if (failure) setError(failure); else { setOpen(false); setQuery(""); }
  }
  const visible = items.filter((item) => !exclude.includes(item.id));
  const exact = visible.some((item) => item.label.trim().toLowerCase() === query.trim().toLowerCase());
  return <Popover open={open} onOpenChange={(value) => { setOpen(value); if (value) search(query); }}>
    <PopoverTrigger asChild>{trigger}</PopoverTrigger>
    <PopoverContent align={align} className="w-[min(20rem,calc(100vw-2rem))] p-0">
      <Command shouldFilter={false} label={title}>
        <CommandInput value={query} onValueChange={(value) => { setQuery(value); search(value); }} placeholder={placeholder} disabled={busy} />
        <CommandList aria-busy={loading}>
          {error && <p role="alert" className="px-3 py-2 text-xs text-destructive">{error}</p>}
          {loading && !visible.length ? <p role="status" className="px-3 py-6 text-center text-sm text-muted-foreground">{t("searching")}</p> : <CommandEmpty>{emptyLabel}</CommandEmpty>}
          {visible.length > 0 && <CommandGroup>
            {visible.map((item) => <CommandItem key={item.id} value={item.id} disabled={busy} onSelect={() => void run(() => onSelect(item))}>
              <span className="min-w-0 flex-1 truncate">{item.label}</span>{item.hint && <span className="ml-2 truncate text-xs text-muted-foreground">{item.hint}</span>}
            </CommandItem>)}
          </CommandGroup>}
          {onCreate && createLabel && query.trim() && !exact && <><CommandSeparator /><CommandGroup>
            <CommandItem value={`create:${query}`} disabled={busy} onSelect={() => void run(() => onCreate(query.trim()))}><Plus aria-hidden="true" />{createLabel(query.trim())}</CommandItem>
          </CommandGroup></>}
        </CommandList>
      </Command>
    </PopoverContent>
  </Popover>;
}
