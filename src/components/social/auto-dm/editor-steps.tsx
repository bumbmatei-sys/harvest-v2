"use client";
import { useId, useRef } from "react";
import { AtSign, Hand, Menu, MessageCircle, Radio, Reply, Send, Snowflake, Plus, Trash2, Paperclip, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { PlatformLogo } from "@/components/social/platform-logo";
import { RadioCards, SwitchRow } from "@/components/social/auto-dm/editor-parts";
import { TagInput } from "@/components/social/auto-dm/tag-input";
import { useRuleLabels } from "@/components/social/auto-dm/rule-labels";
import type { PlannerItem } from "@/lib/social/api";
import type { AutoDmRule, AutoDmTrigger } from "@/lib/social/auto-dm";
import type { AutoDmAccountView } from "@/lib/social/auto-dm-api";
import { cooldownChoices, promotionalFlags, takesEntry, takesKeywords, triggerOptions, withTrigger, type TriggerReason, sym } from "@/lib/social/auto-dm-ui";
import { platformLabels } from "@/lib/social/labels";
import { formatWhen } from "@/components/social/auto-dm/rule-activity";

type Update = (change: (rule: AutoDmRule) => AutoDmRule) => void;
const field = "min-h-11 lg:min-h-9";
const icons: Record<AutoDmTrigger, React.ReactNode> = { comment: <MessageCircle />, dm: <Send />, story_reply: <Reply />, story_mention: <AtSign />, welcome: <Hand />, ice_breaker: <Snowflake />, persistent_menu: <Menu />, live_comment: <Radio /> };
const reasonKey: Record<TriggerReason, string> = { PLATFORM: "platform", INSTAGRAM_ONLY: "instagramOnly", FACEBOOK_ONLY: "facebookOnly", NO_LIVE_LOOKUP: "noLiveLookup" };

export function TriggerStep({ rule, update, accounts, connectionId, onConnection, locked, posts, issues }: {
  rule: AutoDmRule; update: Update; accounts: readonly AutoDmAccountView[]; connectionId: string; onConnection: (id: string) => void; locked: boolean;
  posts: { items: PlannerItem[]; loading: boolean; failed: boolean }; issues: readonly string[];
}) {
  const t = useTranslations("SocialAutoDm"), id = useId(), account = accounts.find((item) => item.id === connectionId) ?? null;
  const scope = rule.postId ? "harvest" : rule.postRef !== null ? "reference" : "any";
  return <>
    <label className="block space-y-1 text-sm font-medium">{t("trigger.name")}
      <Input value={rule.name} maxLength={120} aria-invalid={issues.includes("name") || undefined} onChange={(event) => update((current) => ({ ...current, name: event.target.value }))} className={field} placeholder={t("trigger.namePlaceholder")} /></label>
    <label className="block space-y-1 text-sm font-medium">{t("trigger.account")}
      <NativeSelect value={connectionId} disabled={locked} onChange={(event) => onConnection(event.target.value)} className={field}>
        {accounts.map((item) => <NativeSelectOption key={item.id} value={item.id}>{t("trigger.accountOption", { name: item.name ?? platformLabels[item.platform], platform: platformLabels[item.platform] })}</NativeSelectOption>)}</NativeSelect>
      {locked && <span className="block text-xs font-normal text-muted-foreground">{t("trigger.accountLocked")}</span>}</label>
    <RadioCards name={`${id}-trigger`} label={t("trigger.when")} value={rule.trigger} onChange={(next) => update((current) => withTrigger(current, next))}
      options={triggerOptions(account?.platform ?? null, account?.triggers ?? null).map((option) => ({ value: option.trigger, title: t(`triggers.${option.trigger}.name`), disabled: !option.available, icon: icons[option.trigger],
        badge: option.available ? undefined : t("trigger.unavailable"), note: option.available ? t(`triggers.${option.trigger}.note`) : t(`trigger.reasons.${reasonKey[option.reason!]}`) }))} />
    {rule.trigger === "comment" && <div className="space-y-2">
      <RadioCards name={`${id}-scope`} label={t("trigger.post")} columns={3} value={scope} onChange={(next) => update((current) => ({ ...current, postId: null, postRef: next === "reference" ? "" : null }))}
        options={[{ value: "any" as const, title: t("scope.any") }, { value: "harvest" as const, title: t("trigger.harvestPost"), disabled: posts.items.length === 0 && !posts.loading, note: posts.items.length === 0 && !posts.loading ? t("trigger.noPosts") : null },
          { value: "reference" as const, title: t("trigger.reference") }]} />
      {scope === "harvest" && <NativeSelect aria-label={t("trigger.harvestPost")} value={rule.postId ?? ""} className={field} aria-invalid={issues.includes("postId") || undefined}
        onChange={(event) => update((current) => ({ ...current, postId: event.target.value || null }))}>
        <NativeSelectOption value="">{t("trigger.pickPost")}</NativeSelectOption>
        {rule.postId && !posts.items.some((item) => item.id === rule.postId) && <NativeSelectOption value={rule.postId}>{t("trigger.currentPost")}</NativeSelectOption>}
        {posts.items.map((item) => <NativeSelectOption key={item.id} value={item.id}>{[(item.summary || t("trigger.untitled")).slice(0, 60), t(`trigger.postStatus.${item.status as "scheduled"}`), formatWhen(item.at)].join(sym.dot)}</NativeSelectOption>)}</NativeSelect>}
      {scope === "reference" && <label className="block space-y-1 text-sm">{t("trigger.referenceLabel")}
        <Input value={rule.postRef ?? ""} maxLength={200} onChange={(event) => update((current) => ({ ...current, postRef: event.target.value }))} className={field} aria-invalid={issues.includes("postRef") || undefined} /></label>}
      {scope === "harvest" && <p className="text-xs text-muted-foreground">{t("trigger.liveNote")}</p>}
    </div>}
    {takesEntry(rule.trigger) && <label className="block space-y-1 text-sm font-medium">{t("trigger.entryKey")}
      <Input value={rule.entryKey ?? ""} maxLength={70} onChange={(event) => update((current) => ({ ...current, entryKey: event.target.value.trim() || null }))} className={field} aria-invalid={issues.includes("entryKey") || undefined} /></label>}
  </>;
}

const keywordTrigger = (trigger: AutoDmTrigger) => takesKeywords(trigger) || trigger === "story_reply";
export function MatchStep({ rule, update, issues }: { rule: AutoDmRule; update: Update; issues: readonly string[] }) {
  const t = useTranslations("SocialAutoDm.match"), labels = useRuleLabels(), id = useId();
  if (!keywordTrigger(rule.trigger)) return <p className="text-sm text-muted-foreground" data-testid="match-every">{t("every")}</p>;
  const set = (patch: Partial<AutoDmRule["match"]>) => update((current) => ({ ...current, match: { ...current.match, ...patch } }));
  return <>
    <div className="space-y-1.5"><label htmlFor={`${id}-kw`} className="text-sm font-medium">{takesKeywords(rule.trigger) ? t("keywords") : t("keywordsOptional")}</label>
      <TagInput id={`${id}-kw`} label={t("keywords")} values={rule.match.keywords} onChange={(keywords) => set({ keywords })} invalid={issues.includes("match")} /></div>
    <label className="block space-y-1 text-sm font-medium">{t("mode")}
      <NativeSelect value={rule.match.mode} onChange={(event) => set({ mode: event.target.value as AutoDmRule["match"]["mode"] })} className={field}>
        {(["contains", "word", "exact", ...(rule.match.mode === "any" ? ["any"] : [])] as AutoDmRule["match"]["mode"][]).map((mode) => <NativeSelectOption key={mode} value={mode}>{labels.mode(mode)}</NativeSelectOption>)}</NativeSelect></label>
    <SwitchRow title={t("caseSensitive")} checked={rule.match.caseSensitive} onChecked={(caseSensitive) => set({ caseSensitive })} />
    <div className="space-y-1.5"><label htmlFor={`${id}-ex`} className="text-sm font-medium">{t("exclude")}</label><TagInput id={`${id}-ex`} label={t("exclude")} values={rule.match.exclude} onChange={(exclude) => set({ exclude })} /></div>
    <div className="space-y-1.5"><label htmlFor={`${id}-st`} className="text-sm font-medium">{t("stop")}</label><TagInput id={`${id}-st`} label={t("stop")} values={rule.match.stop} onChange={(stop) => set({ stop })} /></div>
  </>;
}

export function ResponseStep({ rule, update, issues, attested, onAttest, mediaName, onMedia, uploading, mediaError }: {
  rule: AutoDmRule; update: Update; issues: readonly string[]; attested: boolean; onAttest: (value: boolean) => void;
  mediaName: string | null; onMedia: (file: File | null) => void; uploading: boolean; mediaError: string;
}) {
  const t = useTranslations("SocialAutoDm.response"), labels = useRuleLabels(), text = useRef<HTMLTextAreaElement>(null), fileInput = useRef<HTMLInputElement>(null), id = useId();
  const comment = rule.trigger === "comment", service = rule.purpose === "service";
  const flags = promotionalFlags(rule.response.text, rule.response.publicReply, rule.response.followup?.text);
  const setResponse = (patch: Partial<AutoDmRule["response"]>) => update((current) => ({ ...current, response: { ...current.response, ...patch } }));
  function insertName() {
    const element = text.current, token = "{{firstName}}";
    if (!element) return setResponse({ text: rule.response.text + token });
    const start = element.selectionStart ?? rule.response.text.length, end = element.selectionEnd ?? start;
    setResponse({ text: rule.response.text.slice(0, start) + token + rule.response.text.slice(end) });
    requestAnimationFrame(() => { element.focus(); element.setSelectionRange(start + token.length, start + token.length); });
  }
  const used = new Set(rule.response.quickReplies.map((button) => button.key));
  function addQuick() {
    let key = "reply", n = 1; while (used.has(key)) key = `reply-${++n}`;
    setResponse({ quickReplies: [...rule.response.quickReplies, { title: "", key }] });
  }
  return <>
    <label className="block space-y-1 text-sm font-medium">{t("purpose")}
      <NativeSelect value={rule.purpose} onChange={(event) => update((current) => ({ ...current, purpose: event.target.value as AutoDmRule["purpose"], serviceOnly: false, response: { ...current.response, followup: event.target.value === "service" ? null : current.response.followup } }))} className={field}>
        <NativeSelectOption value="service">{labels.purpose("service")}</NativeSelectOption>
        {(["outreach_follow_up", "account_communications", "messaging", "marketing"] as const).map((purpose) => <NativeSelectOption key={purpose} value={purpose} disabled={comment}>{labels.purpose(purpose)}</NativeSelectOption>)}</NativeSelect>
      {comment ? <span className="block text-xs font-normal text-muted-foreground">{t("commentServiceOnly")}</span> : !service && <span className="block text-xs font-normal text-muted-foreground">{t("consentBacked")}</span>}</label>
    <div className="space-y-1">
      <div className="flex items-end justify-between gap-2"><label htmlFor={`${id}-text`} className="text-sm font-medium">{t("dm")}</label>
        <Button type="button" variant="outline" size="responsive" onClick={insertName}>{t("insertName")}</Button></div>
      <Textarea id={`${id}-text`} ref={text} value={rule.response.text} maxLength={1000} className="min-h-28" aria-invalid={issues.includes("response.text") || undefined}
        onChange={(event) => setResponse({ text: event.target.value })} />
      <p className="text-right text-xs text-muted-foreground tabular-nums">{sym.of(rule.response.text.length, 1000)}</p>
    </div>
    {comment && <SwitchRow title={t("publicReply")} note={t("publicReplyNote")} checked={rule.response.publicReply !== null} onChecked={(on) => setResponse({ publicReply: on ? "" : null })}>
      <Textarea aria-label={t("publicReply")} value={rule.response.publicReply ?? ""} maxLength={1000} className="min-h-20" onChange={(event) => setResponse({ publicReply: event.target.value })} /></SwitchRow>}
    <div className="space-y-2"><div className="flex items-center justify-between gap-2"><h3 className="text-sm font-medium">{t("quickReplies")}</h3><span className="text-xs text-muted-foreground tabular-nums">{sym.of(rule.response.quickReplies.length, 13)}</span></div>
      {rule.response.quickReplies.map((button, index) => <div key={button.key} className="flex items-center gap-2" data-testid="quick-reply">
        <Input aria-label={t("quickReplyTitle", { number: index + 1 })} value={button.title} maxLength={20} className={field}
          onChange={(event) => setResponse({ quickReplies: rule.response.quickReplies.map((item, at) => at === index ? { ...item, title: event.target.value } : item) })} />
        <Button type="button" variant="ghost" size="icon-responsive" aria-label={t("removeQuickReply", { number: index + 1 })} onClick={() => setResponse({ quickReplies: rule.response.quickReplies.filter((_, at) => at !== index) })}><Trash2 aria-hidden="true" /></Button></div>)}
      <Button type="button" variant="outline" size="responsive" aria-disabled={rule.response.quickReplies.length >= 13 || undefined} onClick={() => { if (rule.response.quickReplies.length < 13) addQuick(); }}><Plus aria-hidden="true" />{t("addQuickReply")}</Button>
      {rule.response.quickReplies.some((button) => !button.title.trim()) && <p className="text-xs text-destructive" role="alert">{t("quickReplyEmpty")}</p>}
    </div>
    {comment ? <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground" data-testid="media-unavailable">{t("mediaUnavailable")}</p>
      : <div className="space-y-2"><h3 className="text-sm font-medium">{t("media")}</h3>
        {rule.response.fileId ? <div className="flex items-center justify-between gap-2 rounded-lg border p-2 pl-3 text-sm"><span className="inline-flex min-w-0 items-center gap-2"><Paperclip className="size-4 shrink-0" aria-hidden="true" /><span className="truncate">{mediaName ?? t("mediaAttached")}</span></span>
          <Button type="button" variant="ghost" size="icon-responsive" aria-label={t("mediaRemove")} onClick={() => onMedia(null)}><X aria-hidden="true" /></Button></div>
          : <><input ref={fileInput} type="file" accept="image/jpeg,image/png,video/mp4" className="sr-only" tabIndex={-1} aria-label={t("media")} data-testid="auto-dm-media-input" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) onMedia(file); }} />
            <Button type="button" variant="outline" size="responsive" aria-disabled={uploading || undefined} onClick={() => { if (!uploading) fileInput.current?.click(); }}><Paperclip aria-hidden="true" />{uploading ? t("mediaUploading") : t("mediaAttach")}</Button>
            <p className="text-xs text-muted-foreground">{t("mediaLimits")}</p></>}
        {mediaError && <p role="alert" className="text-xs text-destructive">{mediaError}</p>}</div>}
    {!comment && !service && <SwitchRow title={t("followup")} note={t("followupNote")} checked={rule.response.followup !== null} onChecked={(on) => setResponse({ followup: on ? { text: "", delayMinutes: 60 } : null })}>
      <Textarea aria-label={t("followup")} value={rule.response.followup?.text ?? ""} maxLength={1000} className="min-h-20" onChange={(event) => setResponse({ followup: { text: event.target.value, delayMinutes: rule.response.followup?.delayMinutes ?? 60 } })} />
      <label className="block space-y-1 text-sm">{t("followupDelay")}<Input type="number" min={5} max={720} value={rule.response.followup?.delayMinutes ?? 60} className={field}
        onChange={(event) => setResponse({ followup: { text: rule.response.followup?.text ?? "", delayMinutes: Number(event.target.value) || 5 } })} /></label></SwitchRow>}
    {service && <div className="space-y-2 rounded-lg border p-3" data-testid="service-attestation" data-flagged={flags.length > 0 || undefined}>
      {flags.length > 0 && <Alert role="alert" data-testid="promo-flag"><AlertDescription>{t("flagged", { words: flags.join(", ") })}</AlertDescription></Alert>}
      <label className="flex min-h-11 items-start gap-2.5"><Checkbox checked={attested} onCheckedChange={(value) => onAttest(value === true)} className="mt-0.5" aria-invalid={issues.includes("serviceOnly") || undefined} /><span className="text-sm">{t("attest")}</span></label>
      <p className="text-xs text-muted-foreground">{t("attestNote")}</p>
    </div>}
  </>;
}

export function LimitsStep({ rule, update, account, you, onEditHours, issues }: {
  rule: AutoDmRule; update: Update; account: AutoDmAccountView | null; you: { id: string; name: string }; onEditHours: () => void; issues: readonly string[];
}) {
  const t = useTranslations("SocialAutoDm.limits"), labels = useRuleLabels(), id = useId();
  const choices = cooldownChoices.includes(rule.cooldownMinutes as (typeof cooldownChoices)[number]) ? [...cooldownChoices] : [rule.cooldownMinutes, ...cooldownChoices].sort((a, b) => a - b);
  const number = (key: "recipientDaily" | "ruleDaily", min: number, max: number) => (event: React.ChangeEvent<HTMLInputElement>) => update((current) => ({ ...current, [key]: Math.min(max, Math.max(min, Math.trunc(Number(event.target.value)) || min)) }));
  return <>
    <div className="grid gap-3 sm:grid-cols-3">
      <label className="space-y-1 text-sm font-medium">{t("cooldown")}<NativeSelect value={rule.cooldownMinutes} onChange={(event) => update((current) => ({ ...current, cooldownMinutes: Number(event.target.value) }))} className={field}>
        {choices.map((minutes) => <NativeSelectOption key={minutes} value={minutes}>{labels.cooldown(minutes)}</NativeSelectOption>)}</NativeSelect></label>
      <label className="space-y-1 text-sm font-medium">{t("recipientDaily")}<Input type="number" min={1} max={5} value={rule.recipientDaily} onChange={number("recipientDaily", 1, 5)} className={field} aria-invalid={issues.includes("recipientDaily") || undefined} /></label>
      <label className="space-y-1 text-sm font-medium">{t("ruleDaily")}<Input type="number" min={1} max={500} value={rule.ruleDaily} onChange={number("ruleDaily", 1, 500)} className={field} aria-invalid={issues.includes("ruleDaily") || undefined} /></label>
    </div>
    <RadioCards name={`${id}-hours`} label={t("hoursTitle")} columns={3} value={rule.hours} onChange={(hours) => update((current) => ({ ...current, hours }))}
      options={(["ignore", "skip", "away"] as const).map((mode) => ({ value: mode, title: t(`hoursMode.${mode}`), note: t(`hoursNote.${mode}`) }))} />
    {rule.hours !== "ignore" && <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm"><span className="inline-flex items-center gap-2">{account && <PlatformLogo platform={account.platform} className="size-4" />}{t("hoursFor", { account: account ? account.name ?? platformLabels[account.platform] : "-" })}</span>
      <Button type="button" variant="outline" size="responsive" onClick={onEditHours}>{t("editHours")}</Button></div>}
    <label className="block space-y-1 text-sm font-medium">{t("handoff")}
      <NativeSelect value={rule.handoffUserId ?? ""} onChange={(event) => update((current) => ({ ...current, handoffUserId: event.target.value || null }))} className={field}>
        <NativeSelectOption value="">{t("handoffNone")}</NativeSelectOption><NativeSelectOption value={you.id}>{t("handoffMe", { name: you.name })}</NativeSelectOption>
        {rule.handoffUserId && rule.handoffUserId !== you.id && <NativeSelectOption value={rule.handoffUserId}>{t("handoffOther")}</NativeSelectOption>}</NativeSelect></label>
  </>;
}
