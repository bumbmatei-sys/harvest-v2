"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowDown, ArrowUp, ChevronDown, Pencil, Plus, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { newQuestionId, questionLimits, questionTypes, type Question, type QuestionType } from "@/lib/questions";

const isChoice = (type: QuestionType) => type === "choice" || type === "checkboxes";

/**
 * Shared owner-side builder for a Harvest question set. Rows show the question, its type and whether it is required;
 * a row expands in place to edit. Order changes with Move up / Move down (keyboard accessible, no drag library).
 */
export function QuestionListEditor({ questions, onChange, disabled = false }: { questions: Question[]; onChange: (next: Question[]) => void; disabled?: boolean }) {
  const t = useTranslations("Questions");
  const [open, setOpen] = useState<string | null>(null);
  const update = (id: string, change: Partial<Question>) => onChange(questions.map((q) => q.id === id ? normalize({ ...q, ...change }) : q));
  const move = (index: number, by: number) => { const next = [...questions]; [next[index], next[index + by]] = [next[index + by], next[index]]; onChange(next); };
  function add(type: QuestionType) {
    const q: Question = normalize({ id: newQuestionId(), type, label: t(`defaults.${type}`), required: false });
    onChange([...questions, q]); setOpen(q.id);
  }
  return <div className="space-y-2">
    <ol className="space-y-2" aria-label={t("listLabel")}>
      {questions.map((q, index) => <li key={q.id} className="rounded-md border">
        <div className="flex min-h-11 flex-wrap items-center gap-2 px-3 py-1">
          <span className="min-w-0 flex-1 break-words text-sm">{q.label}{q.required && <span className="text-muted-foreground" aria-hidden="true">{t("requiredMark")}</span>}</span>
          <Badge variant="secondary">{t(`types.${q.type}`)}</Badge>
          {q.required && <Badge variant="outline">{t("required")}</Badge>}
          <div className="flex items-center">
            <Button type="button" variant="ghost" size="icon" className="size-11" disabled={disabled || index === 0} onClick={() => move(index, -1)} aria-label={t("moveUp", { label: q.label })}><ArrowUp aria-hidden="true" /></Button>
            <Button type="button" variant="ghost" size="icon" className="size-11" disabled={disabled || index === questions.length - 1} onClick={() => move(index, 1)} aria-label={t("moveDown", { label: q.label })}><ArrowDown aria-hidden="true" /></Button>
            <Button type="button" variant="ghost" size="icon" className="size-11" disabled={disabled} aria-expanded={open === q.id} onClick={() => setOpen(open === q.id ? null : q.id)} aria-label={t("edit", { label: q.label })}>{open === q.id ? <ChevronDown aria-hidden="true" /> : <Pencil aria-hidden="true" />}</Button>
            <Button type="button" variant="ghost" size="icon" className="size-11" disabled={disabled} onClick={() => onChange(questions.filter((x) => x.id !== q.id))} aria-label={t("remove", { label: q.label })}><Trash2 aria-hidden="true" /></Button>
          </div>
        </div>
        {open === q.id && <QuestionDetails question={q} onChange={(change) => update(q.id, change)} disabled={disabled} />}
      </li>)}
    </ol>
    {questions.length < questionLimits.questions && <DropdownMenu>
      <DropdownMenuTrigger asChild><Button type="button" variant="outline" className="min-h-11" disabled={disabled}><Plus aria-hidden="true" />{t("add")}</Button></DropdownMenuTrigger>
      <DropdownMenuContent align="start">{questionTypes.map((type) => <DropdownMenuItem key={type} className="min-h-11" onSelect={() => add(type)}>{t(`types.${type}`)}</DropdownMenuItem>)}</DropdownMenuContent>
    </DropdownMenu>}
  </div>;
}

function normalize(q: Question): Question {
  if (isChoice(q.type)) return { ...q, options: q.options?.length ? q.options : ["", ""] };
  const rest = { ...q }; delete rest.options; return rest;
}

function QuestionDetails({ question: q, onChange, disabled }: { question: Question; onChange: (change: Partial<Question>) => void; disabled: boolean }) {
  const t = useTranslations("Questions"), id = `question-${q.id}`;
  const options = q.options ?? [];
  const setOption = (index: number, value: string) => onChange({ options: options.map((o, i) => i === index ? value : o) });
  return <div className="space-y-4 border-t p-3">
    <div className="space-y-2"><Label htmlFor={`${id}-label`}>{t("question")}</Label>
      <Input id={`${id}-label`} className="min-h-11" value={q.label} maxLength={questionLimits.label} disabled={disabled} onChange={(e) => onChange({ label: e.target.value })} /></div>
    <div className="space-y-2"><Label htmlFor={`${id}-type`}>{t("type")}</Label>
      <Select value={q.type} onValueChange={(type) => onChange({ type: type as QuestionType })} disabled={disabled}>
        <SelectTrigger id={`${id}-type`} className="min-h-11 w-full sm:w-64"><SelectValue /></SelectTrigger>
        <SelectContent>{questionTypes.map((type) => <SelectItem key={type} value={type}>{t(`types.${type}`)}</SelectItem>)}</SelectContent>
      </Select></div>
    {isChoice(q.type) && <fieldset className="space-y-2"><legend className="mb-2 text-sm font-medium">{t("options")}</legend>
      {options.map((option, index) => <div key={index} className="flex items-center gap-2">
        <Input className="min-h-11" value={option} maxLength={questionLimits.option} disabled={disabled} aria-label={t("optionNumber", { number: index + 1 })} onChange={(e) => setOption(index, e.target.value)} />
        <Button type="button" variant="ghost" size="icon" className="size-11" disabled={disabled || options.length <= 2} onClick={() => onChange({ options: options.filter((_, i) => i !== index) })} aria-label={t("removeOption", { number: index + 1 })}><X aria-hidden="true" /></Button>
      </div>)}
      {options.length < questionLimits.options && <Button type="button" variant="outline" className="min-h-11" disabled={disabled} onClick={() => onChange({ options: [...options, ""] })}><Plus aria-hidden="true" />{t("addOption")}</Button>}
    </fieldset>}
    <Label htmlFor={`${id}-required`} className="flex min-h-11 items-center gap-3 font-normal">
      <Switch id={`${id}-required`} checked={q.required} disabled={disabled} onCheckedChange={(required) => onChange({ required })} />{t("requiredSwitch")}</Label>
  </div>;
}
