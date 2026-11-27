# Staging email connection

The staging sender implements the community mail sender and newsletter provider interfaces. It uses Web Crypto and Fetch for SigV4 signing. The transport requires `HARVEST_ENV=staging`, `EMAIL_LIVE_STAGING=1`, and an exact recipient address in `EMAIL_STAGING_ALLOWLIST`. Separate addresses with commas or whitespace. The deployment's production environment fails the check before signing or sending.

Supply `SES_ACCESS_KEY_ID`, `SES_SECRET_ACCESS_KEY`, `SES_REGION`, `SES_FROM_ADDRESS`, and `SES_CONFIGURATION_SET` through the staging environment. Use a verified sender and a staging configuration set. The region selected for this project is `us-east-1`. Automatic job dispatch remains synthetic. The transport includes the delivery tag used by the newsletter verifier and reserved for the community feedback integration in #322.

Once the staging environment is configured, an operator can run the following command with one allowlisted recipient.

```sh
node --import tsx scripts/ses-staging-test.ts reader@example.invalid
```

The command submits once and exits. It prints a generic result without the address, provider response, or signing material. The newsletter adapter reports a lost response as an unknown outcome. The transport does not retry an ambiguous send.
