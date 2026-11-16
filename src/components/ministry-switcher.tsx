/** Derived from Shadcn UI Kit item dashboard-dropdown7 (premium), registry retrieved 2026-11-16, approved 2026-11-16 (Kit PR 2). Local changes: docs/ui-sources.md. */
"use client";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Building2, Check, ChevronsUpDown, Plus } from "lucide-react";
import { ministryHref, ministryInitials, ministryMatches, shouldShowMinistrySearch, type SwitcherMinistry } from "@/lib/ministry-switcher";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";

const itemClass = "min-h-11 lg:min-h-0 gap-3 py-2 lg:py-1.5";
const roleKeys = ["owner", "admin", "member", "viewer"] as const;

function useRoleDetail() {
  const t = useTranslations("ComponentsAppShell");
  return (item: SwitcherMinistry) => {
    const role = (roleKeys as readonly string[]).includes(item.role) ? t(`roles.${item.role as typeof roleKeys[number]}`) : item.role;
    return item.memberCount === undefined ? role : t("roleAndMembers", { role, members: t("memberCount", { count: item.memberCount }) });
  };
}
/** Initials mark, name, role and member count, and a check on the current ministry. */
function MinistryRow({ item, current }: { item: SwitcherMinistry; current: boolean }) {
  const detail = useRoleDetail()(item);
  return <>
    <Avatar aria-hidden="true" className="size-8 rounded-lg"><AvatarFallback className="rounded-lg bg-primary/10 text-xs font-semibold text-foreground">{ministryInitials(item.name)}</AvatarFallback></Avatar>
    <span className="min-w-0 flex-1"><span data-workspace-name className="block truncate text-sm font-medium">{item.name}</span><span className="block truncate text-xs text-muted-foreground">{detail}</span></span>
    {current && <Check aria-hidden="true" className="size-4 shrink-0 text-foreground" />}
  </>;
}

/**
 * Ministry switcher inside the account (profile picture) menu.
 * Up to five ministries are listed as menu items that navigate like links. Above five the menu shows the current
 * ministry and a "Switch ministry" item that opens the searchable list (a text field cannot live inside a menu).
 */
export function MinistrySwitcher({ ministries, selected, onNavigate, onOpenSearch }: { ministries: readonly SwitcherMinistry[]; selected?: string; onNavigate?: () => void; onOpenSearch: () => void }) {
  const t = useTranslations("ComponentsAppShell");
  const searchable = shouldShowMinistrySearch(ministries.length);
  const current = ministries.find((item) => item.tenantId === selected);
  const listed = searchable ? (current ? [current] : []) : ministries;
  return <>
    <DropdownMenuLabel>{t("workspaces")}</DropdownMenuLabel>
    <DropdownMenuGroup aria-label={t("workspaces")}>
      {listed.map((item) => <DropdownMenuItem key={item.tenantId} asChild className={itemClass}>
        <Link href={ministryHref(item.tenantId)} aria-current={item.tenantId === selected ? "true" : undefined} onClick={onNavigate}><MinistryRow item={item} current={item.tenantId === selected} /></Link>
      </DropdownMenuItem>)}
      {searchable && <DropdownMenuItem className={itemClass} onSelect={onOpenSearch}><ChevronsUpDown aria-hidden="true" />{t("switchMinistry")}</DropdownMenuItem>}
    </DropdownMenuGroup>
    {ministries.length === 0 && <DropdownMenuItem disabled className={itemClass}>{t("noMinistries")}</DropdownMenuItem>}
    <DropdownMenuSeparator />
    <DropdownMenuItem asChild className={itemClass}><Link href="/workspaces" onClick={onNavigate}><Building2 aria-hidden="true" />{t("yourWorkspaces")}</Link></DropdownMenuItem>
    <DropdownMenuItem asChild className={itemClass}><Link href="/workspaces#create-workspace" onClick={onNavigate}><Plus aria-hidden="true" />{t("createMinistry")}</Link></DropdownMenuItem>
  </>;
}

/** Searchable ministry list (cmdk): arrow keys, type to filter, Enter to go, Escape to close with focus restored by the caller. */
export function MinistrySearchDialog({ ministries, selected, open, onOpenChange, onNavigate, onCloseAutoFocus }: {
  ministries: readonly SwitcherMinistry[]; selected?: string; open: boolean; onOpenChange: (open: boolean) => void; onNavigate?: () => void; onCloseAutoFocus?: (event: Event) => void;
}) {
  const t = useTranslations("ComponentsAppShell");
  const router = useRouter();
  const [query, setQuery] = useState("");
  const names = new Map(ministries.map((item) => [item.tenantId, item.name]));
  return <Dialog open={open} onOpenChange={(next) => { if (!next) setQuery(""); onOpenChange(next); }}>
    <DialogContent onCloseAutoFocus={onCloseAutoFocus} className="gap-0 overflow-hidden p-0 sm:max-w-md">
      <DialogTitle className="sr-only">{t("switchMinistry")}</DialogTitle>
      <DialogDescription className="sr-only">{t("switchMinistryHelp")}</DialogDescription>
      <Command loop filter={(value, search) => ministryMatches(names.get(value) ?? "", search) ? 1 : 0}>
        <CommandInput value={query} onValueChange={setQuery} placeholder={t("searchMinistries")} aria-label={t("searchMinistries")} className="h-12 text-base md:text-sm" />
        <CommandList className="max-h-[min(60dvh,20rem)]">
          <CommandEmpty>{t("noMinistriesFound")}</CommandEmpty>
          <CommandGroup>
            {ministries.map((item) => <CommandItem key={item.tenantId} value={item.tenantId} className="min-h-11 gap-3 py-2"
              onSelect={() => { onOpenChange(false); onNavigate?.(); router.push(ministryHref(item.tenantId)); }}>
              <MinistryRow item={item} current={item.tenantId === selected} />
            </CommandItem>)}
          </CommandGroup>
        </CommandList>
      </Command>
    </DialogContent>
  </Dialog>;
}
