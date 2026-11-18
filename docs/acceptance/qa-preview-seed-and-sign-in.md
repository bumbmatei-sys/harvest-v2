# QA preview seed and sign-in

This slice adds the synthetic fixtures and QA authentication path from [the QA design](../superpowers/specs/2026-11-17-qa-preview-and-synthetic-walkthrough-design.md). It reuses the existing user, OTP, verification and audit tables. No migration is needed.

## Preview setup still pending

The committed database allow-list is empty. The Neon connector available for implementation could not look up the documented project. Verify the current branch identity and direct and pooled hostnames for `vercel-preview` before adding an allow-list entry. Record only branch and endpoint metadata. Keep all connection strings and secret values in their scoped settings. The founder sets the Preview variables, an independent Better Auth secret, `QA_SIGN_IN_SECRET`, and `QA_SIGN_IN_HELPER_SECRET`, with separate values. The preview runtime uses the app-role URL. Use a trusted seed operator connection on that same branch. It must be the migration owner and able to set `harvest_app` for fixture writes governed by the app's policies. The script changes no grants.

## Seed

`npm run qa:seed` reads the provided `DATABASE_URL` only. It refuses production, unlisted branch endpoints and databases containing an account outside the two accepted synthetic domains. It holds the users write lock through validation and seeding, then commits all fixtures together. Fixed IDs keep repeated runs stable. `npm run qa:seed -- --reset` restores mutable fixture discussion rows and recreates the seeded applications and reports within the named fixture ministries. It preserves other records and append-only audit history. It does not perform the separate initial schema-only reset of the preview branch. The command prints counts or a fixed error identifier.

## Sign-in

`makeAuth` uses a shared OTP hooks interface. The standard implementation lets Better Auth generate a normal code and calls the existing mail adapter. The build alias substitutes the QA implementation only in the exact Vercel Preview environment or an explicitly enabled local test development server. It rechecks runtime mode and only uses a derived code for the reserved synthetic addresses. It keeps the existing cooldown, hashed verification, attempts, session and audit path. The helper uses the issuance time from the reservation, checks expiry and the separate helper header secret, and sends non-cacheable, non-indexable responses.

A production-scoped QA flag causes the auth handler to respond with 503 and log `qa_sign_in_misconfigured` without values. Requests, proxy headers and origins cannot switch QA mode. The helper still returns 404 outside its gated environment. Local bundle inspection found the derived OTP implementation in the simulated Webpack Preview build. A local Turbopack smoke test loaded the local alias and returned the expected 404 for a request without credentials. That smoke test adjusted only the scratch worktree resolver root for the shared dependency directory. Vercel configuration, preview branch seeding, hosted alias behavior, and live email remain unverified. All five HC-02 activation gates remain **UNAPPROVED**.
