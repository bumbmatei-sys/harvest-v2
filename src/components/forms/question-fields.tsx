"use client";
import { useTranslations } from "next-intl";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { questionLimits, type Answers, type Question } from "@/lib/questions";

/**
 * Shared renderer for a Harvest question set (src/lib/questions.ts). Used wherever people answer owner-defined
 * questions: the community join dialog, the account page and the editor preview. The server re-validates.
 */
export function QuestionFields({ questions, values, onChange, disabled = false, idPrefix }: {
  questions: Question[]; values: Answers; onChange?: (next: Answers) => void; disabled?: boolean; idPrefix: string;
}) {
  const t = useTranslations("Questions");
  const set = (id: string, value: string | string[]) => onChange?.({ ...values, [id]: value });
  return <div className="space-y-5">
    {questions.map((q) => {
      const id = `${idPrefix}-${q.id}`, label = <>{q.label}{q.required && <span aria-hidden="true">{t("requiredMark")}</span>}</>;
      if (q.type === "choice") return <fieldset key={q.id} className="space-y-2" aria-required={q.required}>
        <legend className="mb-2 text-sm font-medium">{label}{q.required && <span className="sr-only"> {t("required")}</span>}</legend>
        <RadioGroup value={(values[q.id] as string) ?? ""} onValueChange={(value) => set(q.id, value)} disabled={disabled} className="gap-2">
          {q.options!.map((option, i) => <Label key={option} htmlFor={`${id}-${i}`} className="flex min-h-11 items-center gap-3 rounded-md border px-3 font-normal">
            <RadioGroupItem id={`${id}-${i}`} value={option} />{option}</Label>)}
        </RadioGroup>
      </fieldset>;
      if (q.type === "checkboxes") {
        const picked = (values[q.id] as string[] | undefined) ?? [];
        return <fieldset key={q.id} className="space-y-2">
          <legend className="mb-2 text-sm font-medium">{label}{q.required && <span className="sr-only"> {t("required")}</span>}</legend>
          {q.options!.map((option, i) => <Label key={option} htmlFor={`${id}-${i}`} className="flex min-h-11 items-center gap-3 rounded-md border px-3 font-normal">
            <Checkbox id={`${id}-${i}`} checked={picked.includes(option)} disabled={disabled}
              onCheckedChange={(on) => set(q.id, on === true ? [...picked, option] : picked.filter((p) => p !== option))} />{option}</Label>)}
        </fieldset>;
      }
      const common = { id, value: (values[q.id] as string) ?? "", disabled, required: q.required, "aria-required": q.required,
        onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => set(q.id, event.target.value) };
      return <div key={q.id} className="space-y-2">
        <Label htmlFor={id}>{label}</Label>
        {q.type === "paragraph" ? <Textarea {...common} rows={4} maxLength={questionLimits.paragraph} /> : <Input {...common} className="min-h-11" maxLength={questionLimits.short} />}
      </div>;
    })}
  </div>;
}

/** True when every required question has an answer (the server still validates everything). */
export function answersComplete(questions: Question[], values: Answers) {
  return questions.every((q) => !q.required || (Array.isArray(values[q.id]) ? (values[q.id] as string[]).length > 0 : String(values[q.id] ?? "").trim().length > 0));
}
