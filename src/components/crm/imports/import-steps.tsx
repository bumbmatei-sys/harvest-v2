"use client";
import { useFormatter, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Play, RotateCcw, ScanSearch } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { FieldDescription, FieldLegend, FieldSet } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { mappingSchema, targetsFor, type ImportEntity } from "@/lib/crm-import";
import { useCrmRequest } from "../request";

type Summary = { id: string; version: number; status: string; rowCount: number; stats: Record<string, number | undefined> };

/** Map columns. Every change autosaves (with the import's version), so a closed tab resumes here. */
export function MappingStep({ tenantId, importId, entity, headers, samples, mapping: initialMapping, onMatch: initialOnMatch, version: initialVersion }: {
  tenantId: string; importId: string; entity: ImportEntity; headers: string[]; samples: string[][]; mapping: (string | null)[]; onMatch: "skip" | "fill"; version: number;
}) {
  const t = useTranslations("Imports");
  const router = useRouter();
  const crmRequest = useCrmRequest();
  const [mapping, setMapping] = useState(initialMapping), [onMatch, setOnMatch] = useState(initialOnMatch), [version, setVersion] = useState(initialVersion);
  const [saving, setSaving] = useState<"idle" | "saving" | "saved">("idle"), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const pending = useRef(Promise.resolve(version));
  const endpoint = `/api/workspaces/${tenantId}/crm/imports/${importId}`;
  // Saves run one after another so each carries the version the previous one returned.
  function save(next: { mapping?: (string | null)[]; onMatch?: "skip" | "fill" }) {
    setSaving("saving"); setError("");
    pending.current = pending.current.then(async (current) => {
      const result = await crmRequest<Summary>(endpoint, { method: "PATCH", body: { ...next, version: current } });
      if (!result.ok) { setError(result.error); setSaving("idle"); return current; }
      setVersion(result.data.version); setSaving("saved");
      return result.data.version;
    });
    return pending.current;
  }
  const check = mappingSchema(entity, headers.length).safeParse(mapping);
  const problems = check.success ? [] : [...new Set(check.error.issues.map((issue) => issue.message))].filter((code) => code === "name_required" || code === "duplicate_target" || code === "title_needs_company");
  async function preview() {
    setBusy(true); setError("");
    const current = await pending.current;
    const result = await crmRequest<Summary>(`${endpoint}/preview`, { method: "POST", body: { version: current } });
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    router.push(`/workspaces/${tenantId}/crm/imports/${importId}`); router.refresh();
  }
  return <div className="space-y-5">
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    <div className="overflow-x-auto rounded-lg border">
      <Table aria-label={t("mapTitle")}>
        <TableHeader><TableRow><TableHead>{t("column")}</TableHead><TableHead className="hidden md:table-cell">{t("samples")}</TableHead><TableHead className="w-[45%] sm:w-64">{t("field")}</TableHead></TableRow></TableHeader>
        <TableBody>{headers.map((header, index) => {
          const examples = samples.map((row) => row[index] ?? "").filter(Boolean).slice(0, 3);
          return <TableRow key={`${index}-${header}`}>
            <TableCell className="w-full max-w-0 whitespace-normal align-top md:w-auto md:max-w-[12rem]"><span className="block truncate font-medium" title={header}>{header}</span>
              <span className="block truncate text-xs text-muted-foreground md:hidden">{examples.join(" · ")}</span></TableCell>
            <TableCell className="hidden max-w-[22rem] align-top text-xs text-muted-foreground md:table-cell"><span className="block truncate" title={examples.join(" · ")}>{examples.join(" · ")}</span></TableCell>
            <TableCell className="align-top">
              <NativeSelect aria-label={t("fieldFor", { column: header })} value={mapping[index] ?? ""} className="w-full"
                onChange={(event) => { const next = mapping.map((value, position) => (position === index ? event.target.value || null : value)); setMapping(next); void save({ mapping: next }); }}>
                <NativeSelectOption value="">{t("dontImport")}</NativeSelectOption>
                {targetsFor(entity).map((target) => <NativeSelectOption key={target} value={target}>{t(`targets.${target}`)}</NativeSelectOption>)}
              </NativeSelect>
            </TableCell>
          </TableRow>;
        })}</TableBody>
      </Table>
    </div>
    {problems.length > 0 && <Alert><AlertDescription><ul className="list-disc pl-4">{problems.map((code) => <li key={code}>{t(`mappingProblems.${code as "name_required"}`)}</li>)}</ul></AlertDescription></Alert>}
    <FieldSet><FieldLegend variant="label">{t("onMatch")}</FieldLegend>
      <FieldDescription className="text-xs">{t("onMatchHelp")}</FieldDescription>
      <RadioGroup value={onMatch} onValueChange={(value) => { setOnMatch(value as "skip" | "fill"); void save({ onMatch: value as "skip" | "fill" }); }} className="gap-3">
        {(["skip", "fill"] as const).map((value) => <div key={value} className="flex items-start gap-2">
          <RadioGroupItem id={`on-match-${value}`} value={value} aria-describedby={`on-match-${value}-help`} className="mt-0.5" />
          <div><Label htmlFor={`on-match-${value}`}>{value === "skip" ? t("skipMatches") : t("fillEmpty")}</Label>
            <p id={`on-match-${value}-help`} className="text-xs text-muted-foreground">{value === "skip" ? t("skipMatchesHelp") : t("fillEmptyHelp")}</p></div>
        </div>)}
      </RadioGroup>
    </FieldSet>
    <div className="flex flex-wrap items-center gap-3">
      <Button onClick={() => void preview()} disabled={busy || problems.length > 0}><ScanSearch aria-hidden="true" />{busy ? t("previewing") : t("previewImport")}</Button>
      <span className="text-xs text-muted-foreground" aria-live="polite">{saving === "saving" ? t("saving") : saving === "saved" ? t("saved") : ""}</span>
    </div>
  </div>;
}

/**
 * Runs the commit in server chunks until nothing is left, showing real progress. A reload or a
 * closed tab leaves the import "Importing"; resuming continues with the rows not yet done.
 */
export function ImportRunner({ tenantId, importId, total, done: initialDone, resume = false, ready }: { tenantId: string; importId: string; total: number; done: number; resume?: boolean; ready: number }) {
  const t = useTranslations("Imports");
  const format = useFormatter();
  const router = useRouter();
  const crmRequest = useCrmRequest();
  const [running, setRunning] = useState(false), [done, setDone] = useState(initialDone), [error, setError] = useState("");
  const started = useRef(false);
  async function run() {
    if (started.current) return;
    started.current = true; setRunning(true); setError("");
    for (;;) {
      const result = await crmRequest<Summary & { remaining: number }>(`/api/workspaces/${tenantId}/crm/imports/${importId}/commit`, { method: "POST" });
      if (!result.ok) { setError(result.error); setRunning(false); started.current = false; return; }
      setDone(total - result.data.remaining);
      if (result.data.remaining === 0) break;
    }
    router.refresh();
  }
  const value = total ? Math.round((done / total) * 100) : 0;
  return <div className="space-y-3">
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    {resume && !running && <Alert><AlertDescription>{t("resumeHelp")}</AlertDescription></Alert>}
    {(running || resume) && <div className="space-y-1.5"><Progress value={value} aria-label={t("progressLabel")} />
      <p className="text-xs text-muted-foreground" aria-live="polite">{t("progress", { done: format.number(done), total: format.number(total) })}</p></div>}
    {ready === 0 && !resume ? <p className="text-sm text-muted-foreground">{t("nothingToImport")}</p>
      : <Button onClick={() => void run()} disabled={running}><Play aria-hidden="true" />{running ? t("importing") : resume ? t("resume") : t("startImport", { count: ready })}</Button>}
  </div>;
}

/** Batch rollback, behind an explicit confirmation that says exactly what it does and keeps. */
export function RollbackButton({ tenantId, importId }: { tenantId: string; importId: string }) {
  const t = useTranslations("Imports");
  const router = useRouter();
  const crmRequest = useCrmRequest();
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function rollback() {
    setBusy(true); setError("");
    const result = await crmRequest(`/api/workspaces/${tenantId}/crm/imports/${importId}/rollback`, { method: "POST" });
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    router.refresh();
  }
  return <>
    <AlertDialog>
      <AlertDialogTrigger asChild><Button variant="outline" disabled={busy}><RotateCcw aria-hidden="true" />{busy ? t("rollingBack") : t("rollBack")}</Button></AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>{t("rollBackTitle")}</AlertDialogTitle><AlertDialogDescription>{t("rollBackDescription")}</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel>{t("cancel")}</AlertDialogCancel><AlertDialogAction onClick={() => void rollback()}>{t("rollBack")}</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
  </>;
}
