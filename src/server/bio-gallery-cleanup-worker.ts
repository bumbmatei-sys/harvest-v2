import type { Pool } from "pg";

const batchSize = 50;

export async function sweepBioGallery(pool: Pool, storage: { deleteObject(key: string): Promise<void> }) {
  const skipped: string[] = [];
  let deleted = 0;
  try {
    for (let attempt = 0; attempt < batchSize; attempt++) {
      const client = await pool.connect();
      let discard = false;
      try {
        await client.query("BEGIN");
        const { rows: [file] } = await client.query<{ file_id: string; object_key: string }>(
          "select * from public.bio_gallery_cleanup_take($1::uuid[])", [skipped]);
        if (file) {
          try {
            await storage.deleteObject(file.object_key);
          } catch {
            await client.query("ROLLBACK");
            skipped.push(file.file_id);
            continue;
          }
          await client.query("COMMIT");
          deleted++;
        } else {
          await client.query("COMMIT");
          break;
        }
      } catch (error) {
        await client.query("ROLLBACK").catch(() => { discard = true; });
        throw error;
      } finally {
        client.release(discard);
      }
    }
  } catch (error) {
    await pool.query("select public.bio_gallery_cleanup_log($1, $2)", [deleted, skipped.length + 1]);
    throw error;
  }
  await pool.query("select public.bio_gallery_cleanup_log($1, $2)", [deleted, skipped.length]);
  return { deleted, failed: skipped.length };
}
