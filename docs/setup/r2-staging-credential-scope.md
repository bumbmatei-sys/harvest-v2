# Staging R2 credential scope — policy draft

Status: **deferred implementation; draft only**, 2026-11-06. No token was
created, rotated or revoked and no Cloudflare/Vercel secret was changed.
Public-release status is tracked in the [AC8 checklist](../acceptance/public-release-ac8.md).

## Evidence and target

The 2026-11-05 file-object gate passed using the private bucket
`harvest-v2-staging` on the isolated Vercel project `harvest-v2-staging`.
`/workspace/harvest-v2/exit-gate/STORAGE-RESULT.md`, **Limits and corrected
harness attempts → Credential scope**, explicitly says existing `R2_DEV`
credentials have broader provider-level access. Configuring `S3_BUCKET` proves
application routing, not a credential boundary. That evidence is external to
this repository and was read, not re-executed.

Use a dedicated **Object Read & Write** R2 token restricted to **only**
`harvest-v2-staging`. Prefer an account-owned service token where the operator's
existing account permissions allow it. Do not select either Admin permission,
all buckets, or account-level `Workers R2 Storage Read/Write`.
[Cloudflare's authentication guide](https://developers.cloudflare.com/r2/api/tokens/)
documents the bucket resource syntax and the bucket-item permission group.

| Capability | Target permission |
| --- | --- |
| Presigned conditional PUT, HEAD, GET in `harvest-v2-staging` | Allow; required by [S3 adapter](../../src/server/storage/s3.ts). |
| Object listing within that bucket | Included by R2's Object Read & Write preset; unused by the application. |
| Object overwrite/delete within that bucket | Treat write credentials as capable of destructive object operations; keep server-only. The app's signed `If-None-Match: *` does not restrict a stolen parent credential. |
| Read/write/list objects in any other bucket | Deny through the exact bucket resource scope. |
| Account-wide bucket listing; create/delete buckets; CORS, public access or domain administration | No grant. Use a separate operator identity for approved administration. |

R2's preset is coarser than the application's desired GET/HEAD/PUT-only access
under `workspaces/*/files/*`; this draft claims bucket isolation, not per-prefix
or per-action restrictions. Do not paste an AWS IAM/ARN policy into Cloudflare
and assume it applies. Object tokens authenticate through the S3 API, not the
[Cloudflare REST API](https://developers.cloudflare.com/r2/platform/troubleshooting/#object-level-api-tokens-fail-against-the-rest-api).

## Reviewable API-token policy template

This is a policy template for a future token-creation request, **not an
executable request**. An authorized operator must substitute the account ID,
the bucket's actual jurisdiction, and the current permission-group ID for the
exact name below. `default` means no jurisdiction restriction at creation;
an EU location hint alone does not establish an `eu` jurisdiction. None of
these placeholders is a credential.

```json
{
  "name": "harvest-v2-staging-objects",
  "policies": [
    {
      "effect": "allow",
      "resources": {
        "com.cloudflare.edge.r2.bucket.<ACCOUNT_ID>_<JURISDICTION>_harvest-v2-staging": "*"
      },
      "permission_groups": [
        {
          "id": "<BUCKET_ITEM_WRITE_PERMISSION_GROUP_ID>",
          "name": "Workers R2 Storage Bucket Item Write"
        }
      ]
    }
  ]
}
```

The `"*"` resource value is Cloudflare's documented representation of that one
bucket; it does not select every bucket. There must be exactly one bucket
resource, no `com.cloudflare.edge.r2.bucket.*` key and no additional account
policy. The dashboard equivalent is **Object Read & Write → Apply to specific
buckets → harvest-v2-staging**. Resolve IDs privately; do not record token
responses, secret keys or signed URLs in evidence.

## Future acceptance and handoff (not run here)

1. An authorized storage operator reviews the rendered policy and privately
   inspects the resulting token's permissions/resources. Save only a redacted
   scope summary. No account-level bucket-admin permission may be present.
2. In a separately authorized staging change, replace only `S3_ACCESS_KEY_ID`
   and `S3_SECRET_ACCESS_KEY` on the isolated project; keep the bucket private,
   exact CORS origins and existing endpoint/jurisdiction consistent. Do not
   copy the broader `R2_DEV` credentials into another project. Any deployment
   or secret cutover needs that later task's authorization.
3. With synthetic objects confined to this bucket, verify conditional PUT,
   replay rejection, HEAD, GET, and existing signed download/tenant boundaries.
   Policy inspection must show no account-wide ListBuckets/DeleteBucket grant.
   This task does not authorize probing other buckets or any deletion. A later
   behavioral negative test must use explicitly authorized disposable fixtures,
   never a production bucket or a destructive request against existing buckets.
4. Record the tested deployment SHA, redacted token scope and PASS/FAIL evidence.
   Only then mark narrower scope done. Inventory other consumers before any
   later retirement of shared credentials; do not revoke them opportunistically.

A future scanner should receive an object-specific short-lived grant or a
separate bucket-scoped read-only identity, never this application's write key.
The [scanner spike](../research/malware-scanner-spike.md) describes that boundary.
