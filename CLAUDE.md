Continue Harvest v2 in bumbmatei-sys/harvest-v2. Read the Craft Roadmap, repository PRDs, acceptance records, and open PRs before choosing work. Treat Craft as planning guidance, not proof that code is finished. Check actual current GitHub state, because the details below may have changed since they were written.

State reconciled on 2026-11-07:
- CRM-01 through CRM-08's planned foundation is merged into main. CRM-06 merged as PR #21; filename hardening and import/export isolation follow-ups merged as #26 and #27. CRM-07 merged as #23. Acceptance records: docs/acceptance/crm-0*.md.
- CRM-08 merged as PR #25 (63607c8, migration 0025). It is a phase-ready foundation, not a completed workflow engine or assistant product. See docs/acceptance/crm-08.md "Deferred". Approval TTL/concurrency follow-ups remain parked before assistant activation.
- HC-01 architecture (#18), HC-04 guest resources (#20), CW-01 campaigns (#22), and HC-02 data foundation (#28, ec7ab89, migration 0026) are merged. HC-02 adds no public intake or verified CRM association.
- HC-03 merged as PR #29 into main at b1da5a4 (reviewed head 4b63591, CI 7/7). It adds QR administration and the published-only DB resolver to HC-04. Read docs/acceptance/hc-03.md and docs/reviews/hc-03-closeout.md for current review evidence; verify the live head/checks before acting. Do not use the historical cf89062 review reference as the current head.
- Current priority: HC-05 readiness and decisions under docs/prd/hc-05-readiness.md. Matei confirmed pastoral follow-up and newsletter signup as independent opt-ins; account invitations later. This is planning, not intake implementation or activation approval.
- The five HC-02 privacy/security activation decisions remain UNAPPROVED. See docs/decisions/hc-02-activation-gates.md before HC-05/HC-07 collect real data. Engineering review or merging HC-03 does not approve those decisions or deployment.
- Eden workspace switcher PR #16 is parked: leave it as-is. CW-02+ and unrelated soft follow-ups are separate work, not part of HC-03 closeout.
- The next free migration number follows the last entry in drizzle/meta/_journal.json on main, reconciled with open PRs. HC-03 merged migration 0027; the readiness brief reserves no migration. Never renumber merged migrations.

Use Claude/Codex for coding and a separate fresh session (never the writing session) for independent review. No force pushes. No merge or deploy without my explicit approval. No real outbound messages or webhook deliveries outside tests.

Keep full-width layouts, 44px mobile tap targets, provider-neutral UI copy (no vendor names), and Organizations terminology. Report what is ready, blocked, and recommended next; don't silently expand scope.
