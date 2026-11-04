import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { testDatabase } from "../tests/database";
import { storageMock } from "../tests/storage-mock";
const database = await testDatabase();
const storage = await storageMock();
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--webpack", "--hostname", "127.0.0.1", "--port", "3100"], {
  stdio: ["ignore", "inherit", "inherit"], env: { ...process.env,
    // Override any real credentials and avoid reading live .env.local during browser tests.
    DATABASE_URL: database.appURL, DATABASE_URL_UNPOOLED: "", BETTER_AUTH_SECRET: randomBytes(48).toString("base64url"),
    BETTER_AUTH_URL: "http://127.0.0.1:3100", RESEND_API_KEY: "re_e2e_mock_only", EMAIL_FROM: "Harvest <test@example.test>",
    HARVEST_E2E_MOCK_EMAIL: "1", NEXT_TELEMETRY_DISABLED: "1",
    S3_ENDPOINT: storage.config.endpoint, S3_BUCKET: storage.config.bucket, S3_REGION: storage.config.region,
    S3_ACCESS_KEY_ID: storage.config.accessKeyId, S3_SECRET_ACCESS_KEY: storage.config.secretAccessKey,
  },
});
let stopping = false;
async function stop() {
  if (stopping) return; stopping = true;
  child.kill("SIGTERM");
  await new Promise<void>((resolve) => { if (child.exitCode !== null) resolve(); else child.once("exit", () => resolve()); });
  await storage.close(); await database.close(); process.exit(0);
}
process.once("SIGTERM", () => void stop()); process.once("SIGINT", () => void stop());
child.once("exit", () => { if (!stopping) void Promise.all([storage.close(), database.close()]).finally(() => process.exit(1)); });
