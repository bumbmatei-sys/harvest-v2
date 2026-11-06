Continue Harvest v2 in bumbmatei-sys/harvest-v2. Read the Craft Roadmap, repository PRDs, acceptance records, and open PRs before choosing work. Treat Craft as planning guidance, not proof that code is finished.

CRM-06 PR #21 has review fixes pushed at bf74e959c252a59035c7f8422b68cc53654d4796, with CI 7/7 green. An independent Codex review is pending; do not assume approval.

CRM-07 PR #23 is draft at eecf1b559f0bf7c2ac9665ad5fd8d9d4a4627373. Vendor names were removed from visible copy and Companies renamed Organizations. After #21 merges, merge main into CRM-07, verify the migration chain (0024 was reserved for CRM-07), and run the previously skipped integration test. One browser test failed in the full run and passed alone; investigate rather than calling the full run clean.

Use Claude/Codex for coding and a separate fresh Codex session for independent review. Check actual current GitHub state because these details may have changed. No force pushes. No merge or deploy without my explicit approval.

Keep full-width layouts, 44px mobile tap targets, provider-neutral UI copy, and Organizations terminology. Report what is ready, blocked, and recommended next; don’t silently expand scope.
