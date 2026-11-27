# Contact key rotation

The HC-05 synthetic staging path uses AES-256-GCM with a random data key per response. Cloudflare secrets hold the key-encryption keys, with one 32-byte value encoded as 64 hexadecimal characters for each version. The same keys must be available to the isolated rotation process through its secret injection. Keep the existing synthetic test key during legacy migration.

1. Generate the next key through the approved secret-management process. Put it in `CONTACT_KEK_V2` for the staging application and operator process while retaining `CONTACT_KEK_V1`. Confirm the application uses v2 for new staging receipts.
2. Connect the rotation process to the isolated database using the dedicated worker login. With `HARVEST_CONTACT_ROTATION_ENABLED=1`, run `npx tsx scripts/contact-key-rotation.ts run`. Re-run if the output reports remaining rows or conflicts. Already migrated rows are skipped. The command reports counts.
3. Run `npx tsx scripts/contact-key-rotation.ts check` and require zero remaining envelopes. Rehearse opening a staged receipt and restoring a representative backup before retiring the old key. Keep the old key recoverable for the lifetime of backups that require it.
4. Remove the retired secret from the application and rotation process once the restore and backup conditions are satisfied. If a key is unavailable, stop the rotation, restore the matching version from authorized custody, and repeat the check. Missing keys fail closed.

The database checks the proof for staged reads and records the purpose and key version before returning ciphertext to the audited application opener. Key rotation changes only the wrapped data key for existing envelopes. Moving a legacy receipt into the new format requires one audited plaintext open. Review the audit and complete an independent staging recovery rehearsal before collecting real data.
