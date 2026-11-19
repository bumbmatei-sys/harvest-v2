# QA walkthrough hardening

Set `QA_PREVIEW_HOST` to the exact stable Preview hostname in the repository. Set `QA_PREVIEW_URL` to the bare HTTPS origin for that hostname. The browser project and the authentication helper requests both check the pin. Helper and bypass requests use manual redirect handling. CI still requires manual dispatch.

On the allow-listed QA branch, `npm run qa:seed -- --reset` restores the fixed fixtures and removes the walkthrough's matching synthetic accounts, ministries, communities, posts, comments, applications, reports, audit rows, and OTP state. It handles interrupted runs and refuses production. Ownership, matching run IDs, and actor checks protect adjacent data. Unexpected cross-scope references abort the transaction. Cleanup uses the migration owner. Temporary policies and the scoped audit deletion run under locks in one transaction, with FORCE RLS and the append-only trigger restored when it commits.

No migration. Hosted Preview delivery, Vercel deployment protection and the hosted Neon branch remain unverified. All five HC-02 gates remain **UNAPPROVED**.
