"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Bold, Check, Italic, LayoutGrid, List, Plus, Underline } from "lucide-react";
import { kitProvenance } from "@/lib/ui-provenance";
import { navModes, type NavMode } from "@/lib/navigation";
import { ModeSwitcherView } from "@/components/mode-switcher";
import { uiShowcaseEntries, type UiShowcaseCategory } from "@/lib/ui-showcase";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldLabel, FieldDescription, FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";
import { Sheet, SheetTrigger, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Command, CommandInput, CommandList, CommandItem, CommandEmpty } from "@/components/ui/command";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem } from "@/components/ui/dropdown-menu";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { notify } from "@/lib/toast";
import { KitToastExample } from "./kit-toast-example";
import { KitSpinnerExample } from "./kit-spinner-example";
import { KitScrollAreaExample } from "./kit-scroll-area-example";
import { KitBottomSheetExample } from "./kit-bottom-sheet-example";
import { PagePartsExamples } from "./page-parts-examples";
import { FormPartsExamples } from "./form-parts-examples";
import { CrmPartsExamples } from "./crm-parts-examples";
import { PermissionExamples } from "./permission-examples";
import { CommunityExamples } from "./community-examples";

function ActionExamples() {
  const t = useTranslations("UiShowcase");
  const [count, setCount] = useState(0);
  return <div className="space-y-4">
    <div data-example-actions className="flex flex-wrap items-center gap-2">{(["default", "secondary", "outline", "ghost", "destructive"] as const).map(variant => <Button key={variant} size="responsive" variant={variant} onClick={() => setCount(n => n + 1)}>{t(`actions.${variant}`)}</Button>)}</div>
    <div className="flex flex-wrap items-center gap-3">
      <Tooltip><TooltipTrigger asChild><Button size="icon-responsive" variant="outline" aria-label={t("increment")} onClick={() => setCount(n => n + 1)}><Plus aria-hidden="true" /></Button></TooltipTrigger><TooltipContent>{t("increment")}</TooltipContent></Tooltip>
      <Button size="responsive" disabled><Spinner decorative />{t("busy")}</Button><Button size="responsive" disabled variant="outline">{t("disabled")}</Button>
      <ButtonGroup aria-label={t("groupedActions")}><Button size="responsive" variant="outline" onClick={() => setCount(n => n + 1)}>{t("increment")}</Button><Button size="responsive" variant="outline" onClick={() => setCount(0)}>{t("reset")}</Button></ButtonGroup>
    </div><p role="status" className="text-sm text-muted-foreground">{t("actionCount", { count })}</p>
  </div>;
}
function FieldExamples() {
  const t = useTranslations("UiShowcase");
  const [error, setError] = useState(false);
  return <form className="grid gap-4 md:grid-cols-2" noValidate onSubmit={event => { event.preventDefault(); const email = new FormData(event.currentTarget).get("email"); setError(typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)); }}>
    <Field data-invalid={error || undefined}><FieldLabel htmlFor="example-email">{t("email")}</FieldLabel><Input className="min-h-11" id="example-email" name="email" type="email" required placeholder={t("emailPlaceholder")} aria-invalid={error} aria-describedby={error ? "example-email-error" : undefined} />{error && <FieldError id="example-email-error">{t("emailError")}</FieldError>}</Field>
    <Field><FieldLabel htmlFor="example-name">{t("readOnly")}</FieldLabel><Input className="min-h-11" id="example-name" value={t("sampleName")} readOnly /></Field>
    <Field><FieldLabel htmlFor="example-note">{t("note")}</FieldLabel><Textarea id="example-note" placeholder={t("notePlaceholder")} /></Field>
    <Field><FieldLabel htmlFor="example-category">{t("category")}</FieldLabel><NativeSelect className="min-h-11" id="example-category"><NativeSelectOption>{t("sampleOption")}</NativeSelectOption><NativeSelectOption>{t("otherOption")}</NativeSelectOption></NativeSelect><FieldDescription>{t("fixtureOnly")}</FieldDescription></Field>
    <Label className="min-h-11"><Checkbox />{t("optionalChoice")}</Label>
    <RadioGroup defaultValue="first" aria-label={t("exampleChoice")}><Label className="min-h-11"><RadioGroupItem value="first" />{t("sampleOption")}</Label><Label className="min-h-11"><RadioGroupItem value="second" disabled />{t("disabled")}</Label></RadioGroup>
    <Field><FieldLabel htmlFor="example-disabled">{t("disabledField")}</FieldLabel><Input id="example-disabled" className="min-h-11" disabled value="" readOnly /></Field>
    <div className="flex items-end"><Button size="responsive" type="submit">{t("validate")}</Button></div>
  </form>;
}
function OverlayExamples() {
  const t = useTranslations("UiShowcase");
  const [choice, setChoice] = useState("first"), [open, setOpen] = useState(false), [removed, setRemoved] = useState(false);
  return <div className="space-y-4"><div className="flex flex-wrap gap-2">
    <Dialog><DialogTrigger asChild><Button size="responsive" variant="outline">{t("dialog")}</Button></DialogTrigger><DialogContent><DialogHeader><DialogTitle>{t("dialog")}</DialogTitle><DialogDescription>{t("fixtureOnly")}</DialogDescription></DialogHeader><Input aria-label={t("exampleInput")} placeholder={t("notePlaceholder")} className="min-h-11" /><DialogFooter><DialogClose asChild><Button size="responsive">{t("close")}</Button></DialogClose></DialogFooter></DialogContent></Dialog>
    <Sheet><SheetTrigger asChild><Button size="responsive" variant="outline">{t("sheet")}</Button></SheetTrigger><SheetContent><SheetHeader><SheetTitle>{t("sheet")}</SheetTitle><SheetDescription>{t("fixtureOnly")}</SheetDescription></SheetHeader></SheetContent></Sheet>
    <KitBottomSheetExample />
    <AlertDialog><AlertDialogTrigger asChild><Button size="responsive" variant="outline">{t("confirmation")}</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{t("confirmation")}</AlertDialogTitle><AlertDialogDescription>{t("fixtureOnly")}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel size="responsive">{t("cancel")}</AlertDialogCancel><AlertDialogAction size="responsive" onClick={() => setRemoved(true)}>{t("removeFixture")}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    <Popover open={open} onOpenChange={setOpen}><PopoverTrigger asChild><Button size="responsive" variant="outline">{t("searchOptions")}</Button></PopoverTrigger><PopoverContent className="w-[min(20rem,calc(100vw-2rem))] p-0"><Command><CommandInput placeholder={t("searchOptions")} /><CommandList><CommandEmpty>{t("noMatches")}</CommandEmpty>{["first", "second"].map(value => <CommandItem key={value} onSelect={() => { setChoice(value); setOpen(false); }}>{t(value === "first" ? "sampleOption" : "otherOption")}{choice === value && <Check aria-hidden="true" />}</CommandItem>)}</CommandList></Command></PopoverContent></Popover>
    <DropdownMenu><DropdownMenuTrigger asChild><Button size="responsive" variant="outline">{t("menu")}</Button></DropdownMenuTrigger><DropdownMenuContent><DropdownMenuRadioGroup value={choice} onValueChange={setChoice}><DropdownMenuRadioItem value="first">{t("sampleOption")}</DropdownMenuRadioItem><DropdownMenuRadioItem value="second">{t("otherOption")}</DropdownMenuRadioItem></DropdownMenuRadioGroup></DropdownMenuContent></DropdownMenu>
    </div><p role="status" className="text-sm text-muted-foreground">{t("selectedOption", { option: t(choice === "first" ? "sampleOption" : "otherOption") })}{removed && ` ${t("fixtureRemoved")}`}</p>
  </div>;
}
function FeedbackExamples() {
  const t = useTranslations("UiShowcase");
  const [retried, setRetried] = useState(false);
  return <div className="grid gap-4 md:grid-cols-2">
    <Alert variant="destructive"><AlertTitle>{t("error")}</AlertTitle><AlertDescription>{t("fixtureOnly")}<Button size="responsive" variant="outline" onClick={() => setRetried(true)}>{t("retry")}</Button></AlertDescription></Alert>
    <Alert role="status"><AlertTitle>{t("success")}</AlertTitle><AlertDescription>{t(retried ? "retryComplete" : "fixtureOnly")}</AlertDescription></Alert>
    <Empty className="border border-solid"><EmptyHeader><EmptyTitle>{t("empty")}</EmptyTitle><EmptyDescription>{t("emptyHelp")}</EmptyDescription></EmptyHeader></Empty>
    <Empty className="border border-solid"><EmptyHeader><EmptyTitle>{t("noMatches")}</EmptyTitle><EmptyDescription>{t("searchHelp")}</EmptyDescription></EmptyHeader></Empty>
    <Alert><AlertTitle>{t("permissionDenied")}</AlertTitle><AlertDescription>{t("permissionHelp")}</AlertDescription></Alert>
    <div aria-label={t("loading")} role="status" className="space-y-3 rounded-lg border p-4"><Skeleton className="h-5 w-1/2" /><Skeleton className="h-4 w-3/4" /><span className="sr-only">{t("loading")}</span></div>
    <div className="flex items-center gap-3"><Avatar><AvatarFallback className="bg-selected">{t("initials")}</AvatarFallback></Avatar><Badge variant="secondary">{t("unknown")}</Badge><Badge className="bg-success-tint text-success">{t("success")}</Badge></div>
  </div>;
}
function PrimitiveExamples() {
  const t = useTranslations("UiShowcase.primitives");
  const [view, setView] = useState("list"), [formats, setFormats] = useState<string[]>(["bold"]);
  return <div className="grid gap-6 md:grid-cols-2">
    <div className="space-y-3"><h3 className="text-sm font-medium">{t("spinnerTitle")}</h3><KitSpinnerExample /></div>
    <div className="space-y-3"><h3 className="text-sm font-medium">{t("toggleTitle")}</h3>
      <ToggleGroup type="single" variant="outline" value={view} onValueChange={value => { if (value) setView(value); }} aria-label={t("viewMode")}>
        <ToggleGroupItem value="list" aria-label={t("listView")}><List aria-hidden="true" /></ToggleGroupItem>
        <ToggleGroupItem value="grid" aria-label={t("gridView")}><LayoutGrid aria-hidden="true" /></ToggleGroupItem>
      </ToggleGroup>
      <ToggleGroup type="multiple" value={formats} onValueChange={setFormats} aria-label={t("formats")}>
        <ToggleGroupItem value="bold" aria-label={t("bold")}><Bold aria-hidden="true" /></ToggleGroupItem>
        <ToggleGroupItem value="italic" aria-label={t("italic")}><Italic aria-hidden="true" /></ToggleGroupItem>
        <ToggleGroupItem value="underline" aria-label={t("underline")}><Underline aria-hidden="true" /></ToggleGroupItem>
      </ToggleGroup>
      <p role="status" className="text-sm text-muted-foreground">{t("toggleState", { view: t(view === "grid" ? "gridView" : "listView"), count: formats.length })}</p></div>
    <div className="space-y-3"><h3 className="text-sm font-medium">{t("scrollTitle")}</h3><KitScrollAreaExample /></div>
    <div className="space-y-3"><h3 className="text-sm font-medium">{t("kbdTitle")}</h3>
      <p className="flex flex-wrap items-center gap-2 text-sm">{t("kbdHint")} <KbdGroup><Kbd>{t("ctrl")}</Kbd><Kbd>{t("searchKey")}</Kbd></KbdGroup></p></div>
  </div>;
}
function ToastExamples() {
  const t = useTranslations("UiShowcase.toast");
  return <div className="space-y-3"><div className="flex flex-wrap gap-2">
    <KitToastExample />
    <Button size="responsive" variant="outline" onClick={() => notify.success(t("success"))}>{t("showSuccess")}</Button>
    <Button size="responsive" variant="outline" onClick={() => notify.error(t("error"), { description: t("errorDetail") })}>{t("showError")}</Button>
  </div></div>;
}
const chartSwatches = ["bg-chart-1", "bg-chart-2", "bg-chart-3", "bg-chart-4", "bg-chart-5"] as const;
function ShellExamples() {
  const t = useTranslations("UiShowcase.shell");
  const [mode, setMode] = useState<NavMode>("operations");
  return <div className="space-y-2 text-sm"><p>{t("summary")}</p><p>{t("switcher")}</p>
    <div data-mode-switcher-example aria-label={t("modeSwitcher")} role="group" className="w-64 rounded-xl border bg-sidebar py-2"><TooltipProvider><ModeSwitcherView modes={navModes} active={mode} rail={false} onSelect={setMode} /></TooltipProvider></div>
  </div>;
}
function KitExamples() {
  const t = useTranslations("UiShowcase.kit");
  return <div className="space-y-5">
    {kitProvenance.length === 0
      ? <Empty className="border border-solid"><EmptyHeader><EmptyTitle>{t("none")}</EmptyTitle></EmptyHeader></Empty>
      : <ul className="space-y-1">{kitProvenance.map(record => <li key={record.item}>{t("adopted", { item: record.item, tier: record.tier })}</li>)}</ul>}
    <div role="group" aria-label={t("chartColors")} data-chart-swatches className="grid grid-cols-2 gap-3 sm:grid-cols-5">
      {chartSwatches.map((swatch, index) => <div key={swatch} className="flex items-center gap-2"><span aria-hidden="true" className={`size-6 shrink-0 rounded-md border ${swatch}`} /><span className="text-sm">{t("series", { number: index + 1 })}</span></div>)}
    </div>
  </div>;
}
export function UiShowcase() {
  const t = useTranslations("UiShowcase");
  const [query, setQuery] = useState(""), [category, setCategory] = useState<UiShowcaseCategory | "all">("all");
  const entries = uiShowcaseEntries.filter(entry => (category === "all" || entry.id === category) && `${t(`entries.${entry.id}.title`)} ${t(`entries.${entry.id}.description`)} ${entry.sources.join(" ")}`.toLowerCase().includes(query.toLowerCase()));
  return <TooltipProvider><div className="space-y-6"><header className="space-y-2"><h1 className="text-2xl font-semibold">{t("title")}</h1><p className="text-muted-foreground">{t("description")}</p></header>
    <div className="flex flex-wrap gap-3"><Input type="search" className="min-h-11 w-full sm:w-80" aria-label={t("searchRegistry")} placeholder={t("searchRegistry")} value={query} onChange={event => setQuery(event.target.value)} /><NativeSelect className="min-h-11" aria-label={t("categoryFilter")} value={category} onChange={event => setCategory(event.target.value as typeof category)}><NativeSelectOption value="all">{t("all")}</NativeSelectOption>{uiShowcaseEntries.map(entry => <NativeSelectOption key={entry.id} value={entry.id}>{t(`entries.${entry.id}.title`)}</NativeSelectOption>)}</NativeSelect></div>
    {entries.length === 0 && <Empty><EmptyHeader><EmptyTitle>{t("noMatches")}</EmptyTitle></EmptyHeader></Empty>}
    {entries.map(entry => <section key={entry.id} id={entry.id} aria-labelledby={`${entry.id}-title`}><Card><CardHeader><CardTitle><h2 id={`${entry.id}-title`}>{t(`entries.${entry.id}.title`)}</h2></CardTitle><p className="text-sm text-muted-foreground">{t(`entries.${entry.id}.description`)}</p></CardHeader><CardContent className="space-y-5">
      {entry.id === "actions" ? <ActionExamples /> : entry.id === "fields" ? <FieldExamples /> : entry.id === "overlays" ? <OverlayExamples /> : entry.id === "communities" ? <CommunityExamples /> : entry.id === "kit" ? <KitExamples /> : entry.id === "shell" ? <ShellExamples /> : entry.id === "primitives" ? <PrimitiveExamples /> : entry.id === "toast" ? <ToastExamples /> : entry.id === "pageParts" ? <PagePartsExamples /> : entry.id === "forms" ? <FormPartsExamples /> : entry.id === "crm" ? <CrmPartsExamples /> : entry.id === "permission" ? <PermissionExamples /> : <FeedbackExamples />}
      <details className="text-sm"><summary className="min-h-11 cursor-pointer py-3">{t("sourceAndConsumers")}</summary><ul className="space-y-1 break-all">{[...entry.sources, ...entry.consumers].map(source => <li key={source}><code>{source}</code></li>)}</ul></details>
    </CardContent></Card></section>)}
  </div></TooltipProvider>;
}
