"use client";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Archive, ArrowDown, ArrowUp, MoreHorizontal, Pencil, Plus, RotateCcw, Star } from "lucide-react";
import { stageColors, stageKinds, type Pipeline, type Stage, type StageColor, type StageKind } from "@/lib/crm-deals";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCrmRequest } from "../request";
import { StageDot } from "./stage-badge";

type Editing = { kind: "pipeline-new" } | { kind: "pipeline-rename"; pipeline: Pipeline } | { kind: "stage-new"; pipeline: Pipeline } | { kind: "stage-edit"; stage: Stage };

/** Pipelines and their ordered stages. Owners and admins edit; everyone else reads. */
export function PipelineSettings({ tenantId, pipelines, writable }: { tenantId: string; pipelines: Pipeline[]; writable: boolean }) {
  const t = useTranslations("Deals");
  const router = useRouter();
  const crmRequest = useCrmRequest();
  const [editing, setEditing] = useState<Editing | null>(null), [busy, setBusy] = useState(""), [error, setError] = useState("");
  const api = `/api/workspaces/${tenantId}/crm`;
  async function run(key: string, path: string, method: "PATCH" | "PUT" | "POST", body: unknown) {
    setBusy(key); setError("");
    const result = await crmRequest(`${api}${path}`, { method, body });
    setBusy("");
    if (!result.ok) { setError(result.error); return result.error; }
    router.refresh();
    return null;
  }
  function moveStage(pipeline: Pipeline, index: number, delta: number) {
    const live = pipeline.stages.filter((stage) => !stage.archivedAt).map((stage) => stage.id);
    const [item] = live.splice(index, 1); live.splice(index + delta, 0, item);
    void run(`order-${pipeline.id}`, `/pipelines/${pipeline.id}/stages`, "PUT", { stageIds: live });
  }
  const kindLabel = (kind: StageKind) => t(`stageKinds.${kind}`);
  return <div className="space-y-4">
    {writable && <div className="flex justify-end"><Button size="sm" onClick={() => setEditing({ kind: "pipeline-new" })}><Plus aria-hidden="true" />{t("newPipeline")}</Button></div>}
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    {pipelines.map((pipeline) => {
      const live = pipeline.stages.filter((stage) => !stage.archivedAt), archived = pipeline.stages.filter((stage) => stage.archivedAt);
      const editable = writable && !pipeline.archivedAt;
      return <Card key={pipeline.id} className={cn("gap-3", pipeline.archivedAt && "opacity-80")}>
        <CardHeader><CardTitle className="flex flex-wrap items-center gap-2 text-base"><span className="truncate">{pipeline.name}</span>
          {pipeline.isDefault && <Badge variant="secondary" className="font-normal">{t("default")}</Badge>}
          {pipeline.archivedAt && <Badge variant="secondary" className="font-normal text-muted-foreground">{t("archived")}</Badge>}</CardTitle>
          {writable && <CardAction className="flex items-center gap-2">
            {editable && <Button size="sm" variant="outline" onClick={() => setEditing({ kind: "stage-new", pipeline })} disabled={live.length >= 20}><Plus aria-hidden="true" />{t("addStage")}</Button>}
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild><Button size="icon-sm" variant="ghost" aria-label={t("pipelineActions", { pipeline: pipeline.name })} disabled={!!busy}><MoreHorizontal aria-hidden="true" /></Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {editable && <DropdownMenuItem onSelect={() => setEditing({ kind: "pipeline-rename", pipeline })}><Pencil aria-hidden="true" />{t("renamePipeline")}</DropdownMenuItem>}
                {editable && !pipeline.isDefault && <DropdownMenuItem onSelect={() => void run(pipeline.id, `/pipelines/${pipeline.id}`, "PATCH", { isDefault: true, version: pipeline.version })}><Star aria-hidden="true" />{t("makeDefault")}</DropdownMenuItem>}
                {pipeline.archivedAt ? <DropdownMenuItem onSelect={() => void run(pipeline.id, `/pipelines/${pipeline.id}`, "PATCH", { archived: false, version: pipeline.version })}><RotateCcw aria-hidden="true" />{t("restorePipeline")}</DropdownMenuItem>
                  : !pipeline.isDefault && <DropdownMenuItem onSelect={() => void run(pipeline.id, `/pipelines/${pipeline.id}`, "PATCH", { archived: true, version: pipeline.version })}><Archive aria-hidden="true" />{t("archivePipeline")}</DropdownMenuItem>}
              </DropdownMenuContent>
            </DropdownMenu>
          </CardAction>}
        </CardHeader>
        <CardContent className="px-0">
          <div className="@container"><Table aria-label={t("stagesOf", { pipeline: pipeline.name })} className="table-fixed">
            <TableHeader><TableRow>
              {editable && <TableHead className="w-20 pl-6"><span className="sr-only">{t("order")}</span></TableHead>}
              <TableHead className={cn(!editable && "pl-6")}>{t("stage")}</TableHead><TableHead className="hidden w-40 @xl:table-cell">{t("stageKey")}</TableHead>
              <TableHead className="w-24">{t("stageKind")}</TableHead><TableHead className="hidden w-28 text-right @md:table-cell">{t("probability")}</TableHead>
              {editable && <TableHead className="w-14 pr-6"><span className="sr-only">{t("actions")}</span></TableHead>}
            </TableRow></TableHeader>
            <TableBody>{[...live, ...archived].map((stage) => { const index = live.indexOf(stage), isArchived = !!stage.archivedAt;
              return <TableRow key={stage.id} className={cn("h-11", isArchived && "text-muted-foreground")}>
                {editable && <TableCell className="pl-6">{!isArchived && <span className="flex gap-0.5">
                  <Button size="icon-xs" variant="ghost" disabled={index === 0 || !!busy} aria-label={t("moveStageUp", { stage: stage.name })} onClick={() => moveStage(pipeline, index, -1)}><ArrowUp aria-hidden="true" /></Button>
                  <Button size="icon-xs" variant="ghost" disabled={index === live.length - 1 || !!busy} aria-label={t("moveStageDown", { stage: stage.name })} onClick={() => moveStage(pipeline, index, 1)}><ArrowDown aria-hidden="true" /></Button>
                </span>}</TableCell>}
                <TableCell className={cn("overflow-hidden", !editable && "pl-6")}><span className="flex min-w-0 items-center gap-2"><StageDot color={stage.color} /><span className="truncate font-medium">{stage.name}</span>{isArchived && <Badge variant="secondary" className="h-5 shrink-0 text-[11px] font-normal">{t("archived")}</Badge>}</span></TableCell>
                <TableCell className="hidden truncate font-mono text-xs text-muted-foreground @xl:table-cell">{stage.key}</TableCell>
                <TableCell className="text-xs">{kindLabel(stage.kind)}</TableCell>
                <TableCell className="hidden text-right text-xs tabular-nums @md:table-cell">{stage.probability === null ? <span className="text-muted-foreground">{t("noProbability")}</span> : t("probabilityValue", { value: stage.probability })}</TableCell>
                {editable && <TableCell className="pr-6 text-right"><DropdownMenu modal={false}>
                  <DropdownMenuTrigger asChild><Button size="icon-sm" variant="ghost" disabled={!!busy} aria-label={t("stageActions", { stage: stage.name })}><MoreHorizontal aria-hidden="true" /></Button></DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {!isArchived && <DropdownMenuItem onSelect={() => setEditing({ kind: "stage-edit", stage })}><Pencil aria-hidden="true" />{t("editStage")}</DropdownMenuItem>}
                    {isArchived ? <DropdownMenuItem onSelect={() => void run(stage.id, `/stages/${stage.id}`, "PATCH", { archived: false, version: stage.version })}><RotateCcw aria-hidden="true" />{t("restoreStage")}</DropdownMenuItem>
                      : <DropdownMenuItem onSelect={() => void run(stage.id, `/stages/${stage.id}`, "PATCH", { archived: true, version: stage.version })}><Archive aria-hidden="true" />{t("archiveStage")}</DropdownMenuItem>}
                  </DropdownMenuContent>
                </DropdownMenu></TableCell>}
              </TableRow>; })}</TableBody>
          </Table></div>
        </CardContent>
      </Card>;
    })}
    <p className="text-xs leading-relaxed text-muted-foreground">{t("pipelineSettingsHelp")}</p>
    {editing && <SettingsDialog key={JSON.stringify(editing).slice(0, 80)} editing={editing} kindLabel={kindLabel} onClose={() => setEditing(null)}
      onSubmit={async (values) => {
        if (editing.kind === "pipeline-new") return run("new", "/pipelines", "POST", { name: values.name });
        if (editing.kind === "pipeline-rename") return run(editing.pipeline.id, `/pipelines/${editing.pipeline.id}`, "PATCH", { name: values.name, version: editing.pipeline.version });
        const probability = values.probability === "" ? null : Number(values.probability);
        if (editing.kind === "stage-new") return run("stage", `/pipelines/${editing.pipeline.id}/stages`, "POST", { name: values.name, kind: values.kind, probability, color: values.color });
        return run(editing.stage.id, `/stages/${editing.stage.id}`, "PATCH", { name: values.name, probability, color: values.color, version: editing.stage.version });
      }} />}
  </div>;
}

type Values = { name: string; kind: StageKind; probability: string; color: StageColor };
function SettingsDialog({ editing, kindLabel, onClose, onSubmit }: { editing: Editing; kindLabel: (kind: StageKind) => string; onClose: () => void; onSubmit: (values: Values) => Promise<string | null> }) {
  const t = useTranslations("Deals");
  const stage = editing.kind === "stage-edit" ? editing.stage : null, isStage = editing.kind === "stage-new" || editing.kind === "stage-edit";
  const [values, setValues] = useState<Values>({
    name: editing.kind === "pipeline-rename" ? editing.pipeline.name : stage?.name ?? "", kind: stage?.kind ?? "open",
    probability: stage?.probability === null || stage?.probability === undefined ? "" : String(stage.probability), color: stage?.color ?? "neutral",
  });
  const [busy, setBusy] = useState(false), [problem, setProblem] = useState("");
  const title = { "pipeline-new": t("newPipeline"), "pipeline-rename": t("renamePipeline"), "stage-new": t("addStage"), "stage-edit": t("editStage") }[editing.kind];
  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault(); setProblem("");
    if (isStage && values.probability !== "" && !/^(100|[1-9]?\d)$/.test(values.probability)) { setProblem(t("enterAProbability")); return; }
    setBusy(true);
    const failure = await onSubmit({ ...values, name: values.name.trim() });
    setBusy(false);
    if (failure) setProblem(failure); else onClose();
  }
  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
    <DialogContent className="rounded-xl sm:max-w-[440px]">
      <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{isStage ? t("stageDialogHelp") : t("pipelineDialogHelp")}</DialogDescription></DialogHeader>
      <form onSubmit={submit} className="space-y-4">
        {problem && <p role="alert" className="text-xs text-destructive">{problem}</p>}
        <Field className="gap-2"><FieldLabel htmlFor="settings-name">{isStage ? t("stageName") : t("pipelineName")}</FieldLabel>
          <Input id="settings-name" required maxLength={60} value={values.name} autoFocus onChange={(event) => setValues({ ...values, name: event.target.value })} /></Field>
        {isStage && <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field className="gap-2"><FieldLabel htmlFor="settings-kind">{t("stageKind")}</FieldLabel>
              <NativeSelect id="settings-kind" value={values.kind} disabled={!!stage} onChange={(event) => setValues({ ...values, kind: event.target.value as StageKind })} className="w-full">
                {stageKinds.map((kind) => <NativeSelectOption key={kind} value={kind}>{kindLabel(kind)}</NativeSelectOption>)}
              </NativeSelect></Field>
            <Field className="gap-2"><FieldLabel htmlFor="settings-probability">{t("probabilityPercent")}</FieldLabel>
              <Input id="settings-probability" inputMode="numeric" maxLength={3} value={values.probability} onChange={(event) => setValues({ ...values, probability: event.target.value })} /></Field>
          </div>
          {stage && <FieldDescription className="-mt-2 text-xs">{t("stageKindFixed")}</FieldDescription>}
          <fieldset><legend id="settings-color" className="mb-2 text-sm font-medium">{t("stageColor")}</legend>
            <RadioGroup aria-labelledby="settings-color" value={values.color} onValueChange={(color) => setValues({ ...values, color: color as StageColor })} className="flex flex-wrap gap-3">
              {stageColors.map((color) => <Label key={color} className="flex items-center gap-1.5 text-xs font-normal"><RadioGroupItem value={color} /><StageDot color={color} />{t(`stageColors.${color}`)}</Label>)}
            </RadioGroup></fieldset>
        </>}
        <DialogFooter><DialogClose asChild><Button type="button" variant="ghost" disabled={busy}>{t("cancel")}</Button></DialogClose><Button disabled={busy}>{busy ? t("saving") : t("save")}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
