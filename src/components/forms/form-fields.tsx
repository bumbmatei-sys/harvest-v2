"use client";
import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { Star } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formLimits, type AnswerError, type FormBlock } from "@/lib/crm-forms";
import { RadioCards } from "@/components/forms/kit-radio-cards";
import { CheckboxCards } from "@/components/forms/kit-checkbox-cards";
import { DropZone } from "@/components/forms/kit-drop-zone";

type Value = string | string[] | undefined;
const asText = (value: Value) => (Array.isArray(value) ? "" : value ?? "");
const asList = (value: Value) => (Array.isArray(value) ? value : []);

/** A signature pad that keeps the drawing in memory only (the answer is a marker, never an uploaded image). */
function SignaturePad({ id, label, value, onChange, disabled }: { id: string; label: string; value: string; onChange: (value: string) => void; disabled?: boolean }) {
  const t = useTranslations("CrmForms.field");
  const canvas = useRef<HTMLCanvasElement>(null), drawing = useRef(false);
  useEffect(() => { if (!value) canvas.current?.getContext("2d")?.clearRect(0, 0, canvas.current.width, canvas.current.height); }, [value]);
  function point(event: React.PointerEvent<HTMLCanvasElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    return [(event.clientX - box.left) * (event.currentTarget.width / box.width), (event.clientY - box.top) * (event.currentTarget.height / box.height)] as const;
  }
  function start(event: React.PointerEvent<HTMLCanvasElement>) {
    if (disabled) return;
    drawing.current = true; event.currentTarget.setPointerCapture(event.pointerId);
    const context = event.currentTarget.getContext("2d"); if (!context) return;
    context.lineWidth = 2; context.lineCap = "round"; context.strokeStyle = getComputedStyle(event.currentTarget).color;
    const [x, y] = point(event); context.beginPath(); context.moveTo(x, y);
  }
  function move(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const context = event.currentTarget.getContext("2d"), [x, y] = point(event); context?.lineTo(x, y); context?.stroke();
  }
  return <div className="space-y-2">
    <canvas ref={canvas} id={id} width={600} height={160} aria-label={label} onPointerDown={start} onPointerMove={move}
      onPointerUp={() => { if (drawing.current) { drawing.current = false; onChange("signed"); } }}
      className="h-40 w-full touch-none rounded-md border border-input bg-card text-foreground" />
    <Button type="button" variant="outline" className="min-h-11" disabled={disabled || !value} onClick={() => onChange("")}>{t("clearSignature")}</Button>
  </div>;
}

const errorKey: Record<AnswerError, string> = { required: "required", email: "email", website: "website", phone: "phone", number: "number", consent: "consent" };

/** One form block as a respondent sees it. Pure presentation: values and errors come from the caller, nothing is sent. */
export function FormField({ block, value, onChange, error, disabled = false, idPrefix, autoFocus = false, onEnter, fixedNotice, noticeText = true }: {
  /** `noticeText` false: the consent block's own text is not shown under its statement (a newsletter sign-up form shows the fixed line only). */
  noticeText?: boolean; block: FormBlock; fixedNotice?: string; value: Value; onChange: (value: string | string[]) => void; error?: AnswerError; disabled?: boolean; idPrefix: string; autoFocus?: boolean; onEnter?: () => void;
}) {
  const t = useTranslations("CrmForms.field"), id = `${idPrefix}-${block.id}`, errorId = `${id}-error`;
  const mark = <span aria-hidden="true">{t("requiredMark")}</span>;
  const label = <>{block.label}{block.required && block.type !== "consent" && mark}</>;
  const common = { id, disabled, "aria-invalid": error ? true : undefined, "aria-describedby": error ? errorId : undefined, autoFocus,
    onKeyDown: (event: React.KeyboardEvent) => { if (event.key === "Enter" && onEnter) { event.preventDefault(); onEnter(); } } };
  const message = error && <p id={errorId} role="alert" className="text-sm text-destructive">{t(`errors.${errorKey[error]}`)}</p>;
  if (block.type === "info") return <div className="space-y-1" data-block-type="info"><p className="text-base font-semibold">{block.label}</p>{block.text && <p className="whitespace-pre-line text-sm text-muted-foreground">{block.text}</p>}</div>;
  if (block.type === "consent") return <div className="space-y-2 rounded-md border bg-card p-4" data-block-type="consent">
    <div className="flex items-start gap-3">
      <Checkbox id={id} checked={value === "yes"} disabled={disabled} aria-invalid={error ? true : undefined} aria-describedby={`${id}-text${error ? ` ${errorId}` : ""}`} onCheckedChange={(on) => onChange(on === true ? "yes" : "")} className="mt-1 size-5" />
      <div className="space-y-1"><Label htmlFor={id} className="min-h-6 text-sm font-medium">{block.label}{mark}</Label>{noticeText && <p id={`${id}-text`} className="whitespace-pre-line text-sm text-muted-foreground">{block.text}</p>}
        {fixedNotice && <p id={noticeText ? undefined : `${id}-text`} className="text-sm text-muted-foreground" data-fixed-notice>{fixedNotice}</p>}</div>
    </div>{message}</div>;
  const labelId = `${id}-label`;
  const group = (children: React.ReactNode) => <fieldset className="min-w-0 space-y-2" data-block-type={block.type}><legend id={labelId} className="mb-2 text-sm font-medium">{label}</legend>{children}{message}</fieldset>;
  const single = (control: React.ReactNode) => <div className="space-y-2" data-block-type={block.type}><Label htmlFor={id}>{label}</Label>{control}{message}</div>;
  switch (block.type) {
    case "short": case "location": return single(<Input {...common} className="min-h-11" maxLength={200} value={asText(value)} onChange={(e) => onChange(e.target.value)} autoComplete={block.mapTo === "name" ? "name" : block.mapTo === "organization" ? "organization" : undefined} />);
    case "long": return single(<Textarea {...common} onKeyDown={undefined} rows={4} maxLength={formLimits.text} value={asText(value)} onChange={(e) => onChange(e.target.value)} />);
    case "email": return single(<Input {...common} type="email" inputMode="email" autoComplete="email" className="min-h-11" maxLength={254} value={asText(value)} onChange={(e) => onChange(e.target.value)} />);
    case "website": return single(<Input {...common} type="url" inputMode="url" className="min-h-11" maxLength={300} value={asText(value)} onChange={(e) => onChange(e.target.value)} />);
    case "phone": return single(<Input {...common} type="tel" inputMode="tel" autoComplete="tel" className="min-h-11" maxLength={30} value={asText(value)} onChange={(e) => onChange(e.target.value)} />);
    case "number": case "money": return single(<Input {...common} inputMode="decimal" className="min-h-11" maxLength={20} value={asText(value)} onChange={(e) => onChange(e.target.value)} />);
    case "date": return single(<Input {...common} type="date" className="min-h-11" value={asText(value)} onChange={(e) => onChange(e.target.value)} />);
    case "dropdown": return <div className="space-y-2" data-block-type="dropdown"><Label htmlFor={id}>{label}</Label>
      <Select value={asText(value)} onValueChange={onChange} disabled={disabled}><SelectTrigger id={id} className="min-h-11 w-full" aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined}><SelectValue placeholder={t("choose")} /></SelectTrigger>
        <SelectContent>{(block.options ?? []).map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}</SelectContent></Select>{message}</div>;
    case "choice": return group(<RadioCards name={id} options={block.options ?? []} value={asText(value)} onChange={onChange} disabled={disabled} invalid={Boolean(error)} labelledBy={labelId} />);
    case "multi": return group(<CheckboxCards options={block.options ?? []} value={asList(value)} onChange={onChange} disabled={disabled} labelledBy={labelId} />);
    case "checkbox": return <div className="space-y-2" data-block-type="checkbox"><div className="flex min-h-11 items-center gap-3">
      <Checkbox id={id} checked={value === "yes"} disabled={disabled} aria-invalid={error ? true : undefined} onCheckedChange={(on) => onChange(on === true ? "yes" : "")} className="size-5" /><Label htmlFor={id}>{label}</Label></div>{message}</div>;
    case "rating": {
      const current = Number(asText(value)) || 0;
      return group(<div role="radiogroup" aria-labelledby={labelId} className="flex gap-1">{[1, 2, 3, 4, 5].map((n) =>
        <button key={n} type="button" role="radio" aria-checked={current === n} aria-label={t("stars", { count: n })} disabled={disabled} onClick={() => onChange(String(n))}
          className="flex size-11 items-center justify-center rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"><Star aria-hidden="true" className={cn("size-6", n <= current ? "fill-primary text-primary" : "text-muted-foreground")} /></button>)}</div>);
    }
    case "vote": return group(<div role="radiogroup" aria-labelledby={labelId} className="grid grid-cols-2 gap-2">{(["yes", "no"] as const).map((answer) =>
      <Button key={answer} type="button" role="radio" aria-checked={value === answer} variant={value === answer ? "default" : "outline"} className="min-h-11" disabled={disabled} onClick={() => onChange(answer)}>{t(answer)}</Button>)}</div>);
    case "upload": return group(<DropZone title={t("uploadTitle")} hint={t("uploadHint")} />);
    case "signature": return group(<SignaturePad id={id} label={block.label} value={asText(value)} onChange={onChange} disabled={disabled} />);
    default: return null;
  }
}
