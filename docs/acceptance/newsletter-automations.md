# Newsletter automations

An automation is a trigger plus ordered steps, shown in Public > Newsletter directly below Campaigns. Migration 0096. **Hard-off:** the feature needs `HARVEST_NEWSLETTER_AUTOMATIONS=1` and is never on in production (`newsletterAutomationsEnabled`), the worker needs its own development or test flag, and delivery goes through the synthetic provider only. No real message or webhook leaves the system. All five HC-02 gates remain UNAPPROVED; nothing here approves them.

## Done

- **Screens.** `/workspaces/[tenantId]/newsletter/automations` (searchable list with status, trigger, counts, enable and pause, New automation dialog) and `/newsletter/automations/[automationId]` (editor on the shared `EditorShell`: **Flow** and **Activity**). The nav entry "Automations" (`newsletterAutomations`, icon Zap, permission `newsletter:campaigns`, shown only when the flag is on) sits directly below Campaigns.
- **Trigger.** A person joins a hosted sign-up form (confirmed), or is added to a list (subscription becomes subscribed). Only people who join while the automation is **active** are entered, once each; a person who left is not entered again. The trigger cannot change once anyone has been entered.
- **Steps.** Send email, wait (1 to 720 hours or 1 to 60 days), end; up to 12; end is last. An email step holds a subject, preview text and a **version 2 email document** edited with the same `BlockCanvas`, image picker, video block and preview as the campaign editor (uploaded images must be ready, checked on save and again at the send). Editing is only possible while draft or paused (database guard too); activating needs at least one email step.
- **Per-person run log.** Every contact has a run (`newsletter_automation_runs`) and a log (`newsletter_automation_log`: entered, email sent / unknown / failed, waiting, completed, stopped with a reason). The Activity tab lists people and opens a person's log. Owners and admins only.
- **Consent at every send.** The worker's `newsletter_automation_authorize` re-checks, in the database and immediately before each email: contact not erased, subscriber not suppressed, subscription on the run's list still `subscribed`, a current newsletter email grant (`newsletter_consent_allowed`), a usable address not on the suppression list, and every image still ready. Any failure stops the run with the reason and sends nothing.
- **Runs stop when consent is withdrawn.** Triggers stop a person's active runs at once when a newsletter consent is withdrawn, the subscription leaves subscribed (unsubscribed, bounced, suppressed) or the subscriber is suppressed, each with a log line. The send-time check above covers anything that slips past.
- **Delivery.** Worker action `automations` (`scripts/run-newsletter-worker.ts`, flag `HARVEST_NEWSLETTER_AUTOMATIONS_WORKER_ENABLED`, test or development only): `tick` (moves waits and ends, leases runs at an email step), `authorize` (the check above, plus the unsubscribe token), provider submit through `FakeNewsletterProvider`, `finish`. A lost attempt (worker died after authorising) is recorded as unknown and never sent again; a failed send is recorded and the run continues without a retry. An exception thrown by the provider call (a timeout or a dropped connection, which may follow an acceptance) is recorded as **unknown**, not failed, and is never sent again; only a failure before the call (a message that cannot be built) is a plain failure. A wait step that cannot be read (an unreadable amount or unit, found by the tick; migration 0107) stops only its own run with the reason `invalid_step` and the batch carries on.
- **Erase and merge.** A before-erase trigger on `contacts` deletes a person's runs (log cascades). Merging a contact away erases it, so its runs go too and the surviving contact keeps its own (same convention as pending sign-ups). **A merge therefore deletes the merged-away person's active runs without carrying them over**: if both people were part way through the same series, only the survivor's run continues, and a series the survivor was not in is not started for them.
- **Hosted sign-up confirmation.** `nl02_accept_form_signup` is replaced by the 0088 definition plus one line that enters the person into the form's automations after a granted confirmation (a confirmed sign-up row deliberately keeps no link to the person).

## Migration 0096 (`when` 1795560880671)

Three tables, all `ENABLE` and `FORCE ROW LEVEL SECURITY`, `REVOKE ALL ... FROM PUBLIC, harvest_app`, then explicit grants: owners and admins read all three and insert and update `newsletter_automations` (policies check the ministry and the role; a guard trigger enforces edit rules and the draft start). Runs and log are written only by definer functions through a policy `TO PUBLIC USING (current_user <> 'harvest_app' AND app.nl_auto_private = 'on')`, never `TO current_user`. Every definer function has `SET search_path = pg_catalog, pg_temp` and `REVOKE ALL ... FROM PUBLIC, harvest_app`; the three worker functions check `session_user = 'harvest_worker'` and are granted to that role only. A second `drizzle-kit generate` reports "No schema changes". The journal `when` is above PR #228's 1795559521366 and #229's 1795557848888, `prevId` is the 0089 snapshot (renumber only this migration if others land first).

## Deferred

- Sender and reply-to selection (today the synthetic sender address); real provider delivery, scheduling windows and quiet hours.
- Branching, goals, exits other than consent, re-entry, entering people who were already on the list or form before activation.
- Editing steps while a run is in flight beyond "pause to edit" (runs continue at their position with the new steps), run log retention and purge. (Per-step link-click totals arrived in 0133: `newsletter-consent-v2-automation-clicks.md`.)
- Merge keeps the target's own runs only (the source's are dropped with the source).

## Evidence

- Unit `tests/unit/newsletter-automations.test.ts`, `tests/unit/navigation.test.ts` (registry order and icons).
- Integration `tests/integration/newsletter-automations.test.ts` (restricted-owner fixture, `migrationOwner: true`): hard-off, role and tenant isolation, the application role cannot write runs or log or call worker functions, step and edit rules, entering, ordered synthetic delivery with waits, pause, stopping on withdrawal, unsubscribe and suppression, the send-time check with the stopping triggers disabled, image check, lost attempt, erase and merge, hosted sign-up form trigger. The existing sign-up forms integration suite still passes.
- Playwright `tests/e2e/newsletter-automations.spec.ts`: create, build and reorder steps, email editing inside a step, activate and lock, people and log, stop on withdrawn consent, pause and edit, list actions; axe WCAG 2.2 AA and no overflow at 360 and 1280 in light and dark; shell modes on and `HARVEST_SHELL_MODES=disabled`.
- Screenshots: `docs/screenshots/newsletter-automations/` (phone and desktop, light and dark).

## Reuse and provenance

Shared `EditorShell`, `DataTable`, `StatusBadge`, `EmptyState`, `FormSection`, `BlockCanvas`, `ImagePicker`, `EmailPreview`, shadcn Dialog, Sheet, Popover, DropdownMenu, NativeSelect. No kit code was copied, so `ui-provenance.ts` and `docs/ui-sources.md` are unchanged.
