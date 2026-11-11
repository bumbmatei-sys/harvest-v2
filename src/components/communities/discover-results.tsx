"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Search } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";

/** Search and the "Open to join" filter, kept in the URL so results are shareable and server-rendered. */
export function DiscoverFilters() {
  const t = useTranslations("Discover"), router = useRouter(), params = useSearchParams();
  const [query, setQuery] = useState(params.get("q") ?? ""), timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const openOnly = params.get("open") === "1";
  function go(next: { q?: string; open?: boolean }) {
    const url = new URLSearchParams();
    const q = (next.q ?? query).trim(), open = next.open ?? openOnly;
    if (q) url.set("q", q);
    if (open) url.set("open", "1");
    router.replace(`/discover${url.size ? `?${url}` : ""}`, { scroll: false });
  }
  useEffect(() => () => clearTimeout(timer.current), []);
  return <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
    <InputGroup className="min-h-11 sm:max-w-md">
      <InputGroupAddon><Search aria-hidden="true" /></InputGroupAddon>
      <InputGroupInput type="search" aria-label={t("search")} placeholder={t("search")} value={query} maxLength={80}
        onChange={(event) => { const value = event.target.value; setQuery(value); clearTimeout(timer.current); timer.current = setTimeout(() => go({ q: value }), 300); }} />
    </InputGroup>
    <Label htmlFor="discover-open" className="flex min-h-11 items-center gap-3 rounded-md border px-3 font-normal">
      <Checkbox id="discover-open" checked={openOnly} onCheckedChange={(value) => go({ open: value === true })} />{t("openOnly")}</Label>
  </div>;
}
