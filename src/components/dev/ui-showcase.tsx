"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Check, LoaderCircle, Plus } from "lucide-react";
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

function ActionExamples() {
  const t = useTranslations("UiShowcase");
  const [count, setCount] = useState(0);
  return <div className="space-y-4">
    <div data-example-actions className="flex flex-wrap items-center gap-2">{(["default", "secondary", "outline", "ghost", "destructive"] as const).map(variant => <Button key={variant} size="responsive" variant={variant} onClick={() => setCount(n => n + 1)}>{t(`actions.${variant}`)}</Button>)}</div>
    <div className="flex flex-wrap items-center gap-3">
      <Tooltip><TooltipTrigger asChild><Button size="icon-responsive" variant="outline" aria-label={t("increment")} onClick={() => setCount(n => n + 1)}><Plus aria-hidden="true" /></Button></TooltipTrigger><TooltipContent>{t("increment")}</TooltipContent></Tooltip>
      <Button size="responsive" disabled><LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden="true" />{t("busy")}</Button><Button size="responsive" disabled variant="outline">{t("disabled")}</Button>
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
export function UiShowcase() {
  const t = useTranslations("UiShowcase");
  const [query, setQuery] = useState(""), [category, setCategory] = useState<UiShowcaseCategory | "all">("all");
  const entries = uiShowcaseEntries.filter(entry => (category === "all" || entry.id === category) && `${t(`entries.${entry.id}.title`)} ${t(`entries.${entry.id}.description`)} ${entry.sources.join(" ")}`.toLowerCase().includes(query.toLowerCase()));
  return <TooltipProvider><div className="space-y-6"><header className="space-y-2"><h1 className="text-2xl font-semibold">{t("title")}</h1><p className="text-muted-foreground">{t("description")}</p></header>
    <div className="flex flex-wrap gap-3"><Input type="search" className="min-h-11 w-full sm:w-80" aria-label={t("searchRegistry")} placeholder={t("searchRegistry")} value={query} onChange={event => setQuery(event.target.value)} /><NativeSelect className="min-h-11" aria-label={t("categoryFilter")} value={category} onChange={event => setCategory(event.target.value as typeof category)}><NativeSelectOption value="all">{t("all")}</NativeSelectOption>{uiShowcaseEntries.map(entry => <NativeSelectOption key={entry.id} value={entry.id}>{t(`entries.${entry.id}.title`)}</NativeSelectOption>)}</NativeSelect></div>
    {entries.length === 0 && <Empty><EmptyHeader><EmptyTitle>{t("noMatches")}</EmptyTitle></EmptyHeader></Empty>}
    {entries.map(entry => <section key={entry.id} id={entry.id} aria-labelledby={`${entry.id}-title`}><Card><CardHeader><CardTitle><h2 id={`${entry.id}-title`}>{t(`entries.${entry.id}.title`)}</h2></CardTitle><p className="text-sm text-muted-foreground">{t(`entries.${entry.id}.description`)}</p></CardHeader><CardContent className="space-y-5">
      {entry.id === "actions" ? <ActionExamples /> : entry.id === "fields" ? <FieldExamples /> : entry.id === "overlays" ? <OverlayExamples /> : <FeedbackExamples />}
      <details className="text-sm"><summary className="min-h-11 cursor-pointer py-3">{t("sourceAndConsumers")}</summary><ul className="space-y-1 break-all">{[...entry.sources, ...entry.consumers].map(source => <li key={source}><code>{source}</code></li>)}</ul></details>
    </CardContent></Card></section>)}
  </div></TooltipProvider>;
}
