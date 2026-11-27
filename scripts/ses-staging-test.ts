import { submitStagingEmail } from "../src/server/staging-email-transport";

const args = process.argv.slice(2);
if (args.length !== 1 || process.env.NODE_ENV === "production") {
  console.error("Staging email refused.");
  process.exitCode = 1;
} else {
  try {
    await submitStagingEmail(process.env, {
      to: args[0],
      deliveryId: crypto.randomUUID(),
      subject: "Harvest staging email test",
      text: "This is a one-time test of staging email delivery.",
      headers: {},
    });
    console.log("Staging email accepted.");
  } catch {
    console.error("Staging email failed or was refused.");
    process.exitCode = 1;
  }
}
