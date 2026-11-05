import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import lighthouse from "lighthouse";
import { launch } from "chrome-launcher";
import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import BaseGatherer from "lighthouse/core/gather/base-gatherer.js";
import { Audit } from "lighthouse/core/audits/audit.js";

// Lighthouse 13 removed its built-in PWA category. Keep installability as an
// explicit custom audit backed by Chromium's own installability diagnostics.
class Installability extends BaseGatherer {
  meta = { supportedModes: ["navigation"] };
  async getArtifact({ driver }) {
    const worker = await driver.executionContext.evaluate(async () => {
      const registration = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise((resolve) => setTimeout(() => resolve(null), 10_000)),
      ]);
      return registration?.active?.scriptURL.endsWith("/sw.js") ?? false;
    }, { args: [], useIsolation: false });
    const manifest = await driver.defaultSession.sendCommand("Page.getAppManifest");
    const { installabilityErrors } = await driver.defaultSession.sendCommand("Page.getInstallabilityErrors");
    return { worker, manifestPresent: !!manifest.data, manifestErrors: manifest.errors, installabilityErrors };
  }
}
class InstallableManifest extends Audit {
  static get meta() {
    return { id: "harvest-installability", title: "Harvest is installable with an active service worker",
      failureTitle: "Harvest has installability errors", description: "Chromium manifest and installability checks plus automatic production service-worker registration.",
      requiredArtifacts: ["HarvestInstallability"] };
  }
  static audit(artifacts) {
    const result = artifacts.HarvestInstallability;
    const passed = result.worker && result.manifestPresent && !result.manifestErrors.length && !result.installabilityErrors.length;
    return { score: passed ? 1 : 0, details: { type: "debugdata", ...result } };
  }
}

const url = "http://127.0.0.1:3200/sign-in";
const evidence = "docs/screenshots/pr03";
// Only anonymous pages are used. Override live integrations defensively.
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", "3200"], {
  stdio: "ignore", env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1",
    DATABASE_URL: "postgresql://unused:unused@127.0.0.1:1/harvest_test_unused", DATABASE_URL_UNPOOLED: "",
    BETTER_AUTH_SECRET: randomBytes(48).toString("base64url"), BETTER_AUTH_URL: "http://127.0.0.1:3200",
    RESEND_API_KEY: "re_local_audit_unused", EMAIL_FROM: "Harvest <audit@example.test>" },
});
let chrome, browser;
try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (server.exitCode !== null) throw new Error("Local production server exited before readiness");
    if (await fetch(url).then((response) => response.ok).catch(() => false)) { ready = true; break; }
    await delay(500);
  }
  assert(ready, "Local production server did not become ready");
  chrome = await launch({ chromeFlags: ["--headless", "--no-sandbox", "--disable-dev-shm-usage"] });
  const result = await lighthouse(url, { port: chrome.port, output: "json", logLevel: "error" }, {
    extends: "lighthouse:default",
    settings: { onlyCategories: ["accessibility", "best-practices", "harvest-pwa"] },
    artifacts: [{ id: "HarvestInstallability", gatherer: { implementation: Installability } }],
    audits: [{ implementation: InstallableManifest }],
    categories: { "harvest-pwa": { title: "Harvest PWA", description: "Local Chromium installability and production worker checks.", auditRefs: [{ id: "harvest-installability", weight: 1 }] } },
  });
  assert(result && !result.lhr.runtimeError, "Lighthouse failed to complete");
  const { lhr } = result;
  await mkdir(evidence, { recursive: true });
  const summary = { lighthouseVersion: lhr.lighthouseVersion, fetchTime: lhr.fetchTime, url,
    environment: lhr.environment,
    categories: Object.fromEntries(Object.entries(lhr.categories).map(([id, value]) => [id, value.score])),
    installability: lhr.audits["harvest-installability"],
    failedAudits: Object.values(lhr.audits).filter((audit) => audit.score !== null && audit.score < 1).map(({ id, title, score, details }) => ({ id, title, score, details })) };
  await writeFile(`${evidence}/lighthouse.json`, JSON.stringify(summary, null, 2) + "\n");
  assert.equal(summary.installability.score, 1, "Lighthouse installability audit failed; see evidence");
  assert.equal(summary.categories.accessibility, 1, "Lighthouse accessibility audit failed; see evidence");

  browser = await chromium.connectOverCDP(`http://127.0.0.1:${chrome.port}`);
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(url);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  assert(await page.evaluate(() => !!navigator.serviceWorker.controller), "Production worker did not control the page");
  await context.setOffline(true);
  await page.goto("http://127.0.0.1:3200/workspaces");
  assert.equal(await page.locator("h1").textContent(), "You’re offline");
  const axe = await new AxeBuilder({ page }).analyze();
  assert.equal(axe.violations.length, 0, "Production offline fallback has axe violations");
  const paths = await page.evaluate(async () => (await Promise.all((await caches.keys()).map(async (key) =>
    (await (await caches.open(key)).keys()).map((entry) => new URL(entry.url).pathname)))).flat().sort());
  assert.deepEqual(paths, ["/offline.html", "/offline.css", "/icons/icon-192.png", "/icons/icon-512.png"].sort());
  await page.screenshot({ path: `${evidence}/production-offline.png`, fullPage: true });
  await writeFile(`${evidence}/production-offline.json`, JSON.stringify({ automaticRegistration: true, controlled: true, fallback: true, cachedPaths: paths, axeViolations: axe.violations.length }, null, 2) + "\n");
  await context.close();
  console.log(`Lighthouse installability: PASS; accessibility: ${summary.categories.accessibility}; best practices: ${summary.categories["best-practices"]}. Production offline fallback, static-only cache and axe: PASS.`);
} finally {
  await browser?.close();
  await chrome?.kill();
  server.kill("SIGTERM");
  if (server.exitCode === null) await new Promise((resolve) => server.once("exit", resolve));
}
