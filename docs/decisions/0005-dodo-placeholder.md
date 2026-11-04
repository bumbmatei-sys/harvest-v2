# ADR 0005: Dodo Payments placeholder

Accepted 2026-11-04. Reserve `DODO_PAYMENTS_API_KEY` in the environment template and define a provider-neutral checkout adapter contract. The unavailable implementation throws an explicit error. Do not install a Dodo SDK, read its key, call a provider, create checkout links or implement billing in PR 01a. Billing integration and webhook-led entitlements need a later scoped decision.
