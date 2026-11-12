import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { expectFullWidthShell } from "./helpers/layout";
import { origin, signIn } from "./helpers/session";

// The shell scrolls main, not the document: fullPage screenshots alone miss lower actions.
// This test captures actual viewport images after scrolling controls into view, including
// both ends of scrollable dialogs. All state changes use the disposable e2e-server database.
const evidence = process.env.HC03_QA_DIR ?? join(tmpdir(), "harvest-hc03-responsive");
test.use({ reducedMotion: "reduce" });

async function keyboardReach(page: Page, target: Locator, dialog: Locator) {
  for (let i = 0; i < 30; i++) {
    expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
    if (await target.evaluate((node) => node === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  throw new Error("Dialog action was not reachable by keyboard");
}

for (const viewport of [{ name: "mobile", width: 390, height: 844 }, { name: "tablet", width: 768, height: 1024 }]) {
  for (const scheme of ["light", "dark"] as const) {
    test(`HC-03 responsive actions and dialogs: ${viewport.name} ${scheme}`, async ({ page, browser }) => {
      test.setTimeout(180_000);
      await mkdir(evidence, { recursive: true });
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" }); await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
      const metrics: Record<string, unknown> = {};
      const suffix = `${viewport.name}-${scheme}`;
      async function capture(targetPage: Page, state: string, scope: Locator) {
        const geometry = await scope.evaluate((node) => {
          const box = node.getBoundingClientRect();
          return { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width,
            overflow: document.documentElement.scrollWidth - innerWidth, innerOverflow: node.scrollWidth - node.clientWidth };
        });
        expect(geometry.left).toBeGreaterThanOrEqual(0);
        expect(geometry.right).toBeLessThanOrEqual(viewport.width);
        expect(geometry.overflow).toBeLessThanOrEqual(0);
        expect(geometry.innerOverflow).toBeLessThanOrEqual(1);
        const targets = [];
        for (const control of await scope.locator("a:visible, button:visible, input:visible, select:visible").all()) {
          const box = await control.boundingBox();
          if (!box || box.width <= 1) continue;
          expect(box.height, await control.innerText()).toBeGreaterThanOrEqual(44);
          expect(box.width, await control.innerText()).toBeGreaterThanOrEqual(44);
          targets.push({ label: (await control.innerText()) || await control.getAttribute("aria-label"), width: box.width, height: box.height });
        }
        const axe = await new AxeBuilder({ page: targetPage }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
        expect(axe.violations, state).toEqual([]);
        metrics[state] = { viewport, scheme, geometry, targets, axeViolations: axe.violations, screenshot: `${state}-${suffix}.png` };
        await targetPage.screenshot({ path: join(evidence, `${state}-${suffix}.png`) });
      }
      async function openDialog(trigger: Locator, role: "dialog" | "alertdialog") {
        await trigger.scrollIntoViewIfNeeded(); await trigger.focus(); await page.keyboard.press("Enter");
        const dialog = page.getByRole(role);
        await expect(dialog).toBeVisible();
        await expect.poll(() => dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
        const box = (await dialog.boundingBox())!;
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
        return dialog;
      }
      async function dialogEvidence(dialog: Locator, state: string, submit: string) {
        await dialog.evaluate((node) => node.scrollTo(0, 0));
        await capture(page, `${state}-top`, dialog);
        await keyboardReach(page, dialog.getByRole("button", { name: submit, exact: true }), dialog);
        await expect(dialog.getByRole("button", { name: submit, exact: true })).toBeInViewport();
        // Keyboard navigation scrolls the actual dialog footer into view on small screens.
        await capture(page, `${state}-footer`, dialog);
      }
      await signIn(page);
      const workspace = await page.request.post("/api/workspaces", { headers: { origin }, data: { audience: "church", name: "Synthetic responsive QA" } });
      expect(workspace.status()).toBe(201);
      const tenant = (await workspace.json()).tenantId as string;
      const campaign = await page.request.post(`/api/workspaces/${tenant}/campaigns`, { headers: { origin, "Idempotency-Key": randomUUID() }, data: { name: "Synthetic local QA", type: "conference" } });
      expect(campaign.status()).toBe(201);
      const campaignId = (await campaign.json()).id as string;
      const root = `/workspaces/${tenant}/campaigns/${campaignId}/connect`;
      const api = `/api/workspaces/${tenant}/campaigns/${campaignId}/connect/links`;
      await page.goto(root);
      await expect(page.getByRole("heading", { level: 1, name: "QR codes and short links" })).toBeVisible();
      metrics.shell = await expectFullWidthShell(page);
      const trigger = page.getByRole("button", { name: "New link", exact: true });
      // Escape restores focus to the trigger; then reopen and submit through keyboard.
      await openDialog(trigger, "dialog"); await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0); await expect(trigger).toBeFocused();
      const create = await openDialog(trigger, "dialog");
      await create.getByLabel("Internal name").fill("Synthetic main screen");
      await create.getByLabel("Public title").fill("Synthetic local resources");
      await dialogEvidence(create, "create", "Create draft");
      await page.keyboard.press("Enter"); await expect(create).toBeHidden();
      const card = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: "Synthetic main screen" }) });
      await expect(card.getByText("Draft", { exact: true })).toBeVisible();
      const publish = await openDialog(card.getByRole("button", { name: "Publish", exact: true }), "dialog");
      await dialogEvidence(publish, "publish", "Publish link");
      await page.keyboard.press("Enter"); await expect(publish).toBeHidden();
      await expect(card.getByText("Live", { exact: true })).toBeVisible();
      // Main's bottom contains the lower organizer and lifecycle action groups.
      await page.getByRole("main").evaluate((node) => node.scrollTo(0, node.scrollHeight));
      for (const name of ["Preview", "Present"]) await expect(card.getByRole("link", { name, exact: true })).toBeInViewport();
      for (const name of ["Download", "Pause", "Rotate code", "Archive"]) await expect(card.getByRole("button", { name, exact: true })).toBeInViewport();
      metrics.liveShell = await expectFullWidthShell(page);
      await capture(page, "owner-actions", card);
      await card.getByRole("button", { name: "Download", exact: true }).focus(); await page.keyboard.press("Enter");
      await expect(page.getByRole("menu")).toBeVisible();
      await page.keyboard.press("Escape"); await expect(card.getByRole("button", { name: "Download", exact: true })).toBeFocused();
      const rotate = await openDialog(card.getByRole("button", { name: "Rotate code", exact: true }), "alertdialog");
      await dialogEvidence(rotate, "rotate", "Rotate code");
      await page.keyboard.press("Enter"); await expect(rotate).toBeHidden();
      await expect(card.getByText("Rotated once")).toBeVisible();
      const memberContext = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, colorScheme: scheme, reducedMotion: "reduce" });
      try {
        const member = await memberContext.newPage();
        const email = await signIn(member);
        expect((await page.request.put(`/api/workspaces/${tenant}/members`, { headers: { origin }, data: { email, role: "member" } })).status()).toBe(200);
        await member.goto(root);
        await expect(member.getByText("Only owners and admins can publish, pause, rotate or archive links.")).toBeVisible();
        await member.getByRole("main").evaluate((node) => node.scrollTo(0, node.scrollHeight));
        for (const name of ["Preview", "Present"]) await expect(member.getByRole("link", { name, exact: true })).toBeInViewport();
        await expect(member.getByRole("button", { name: "Download", exact: true })).toBeInViewport();
        for (const name of ["Rotate code", "Archive", "Pause", "Change expiry"]) await expect(member.getByRole("button", { name, exact: true })).toHaveCount(0);
        metrics.memberShell = await expectFullWidthShell(member);
        await capture(member, "member-actions", member.getByRole("listitem").filter({ has: member.getByRole("heading", { name: "Synthetic main screen" }) }));
        const [link] = (await (await page.request.get(api)).json()).links as { id: string }[];
        expect((await member.request.post(`${api}/${link.id}/actions`, { headers: { origin }, data: { action: "archive" } })).status()).toBe(403);
      } finally { await memberContext.close(); }
      const archive = await openDialog(card.getByRole("button", { name: "Archive", exact: true }), "alertdialog");
      await dialogEvidence(archive, "archive", "Archive link");
      await page.keyboard.press("Enter"); await expect(archive).toBeHidden();
      await expect(page.getByRole("heading", { name: "Archived links" })).toBeVisible();
      await writeFile(join(evidence, `metrics-${suffix}.json`), `${JSON.stringify(metrics, null, 2)}\n`);
    });
  }
}
