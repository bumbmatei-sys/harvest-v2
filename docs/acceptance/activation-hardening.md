# Activation hardening

Working migration 0210. This branch starts from current main and incorporates the open work from PR 342 (contact encryption) and PR 343 (CRM ad audiences).

The contact-encryption capabilities commit a scoped audit row before releasing ciphertext to the opener. Rows include ministry, record, purpose and authenticated user or worker identity. Guest invitation requests record that the receipt capability was used, with no account identity or receipt secret. Historical unscoped events remain unavailable through the owner/admin API. New rows contain no ciphertext, key material or plaintext. The API is `GET /api/workspaces/{tenantId}/connect/contact-decrypt-audit`.

CRM audience sync commits its claim and releases its eligibility locks before calling the fake provider. The result is recorded in another transaction and bound to the attempt ID. After an interruption, retry the original request key after the one-minute lease. The retry checks current consent and replaces the entire fake audience. An outstanding claim blocks other keys for the same audience until recovery completes. Real uploads remain hard-off. A live provider would require a separately reviewed recovery and ordering contract.
