import { readFile } from "node:fs/promises";
import { expect as check, test, type Page } from "./helpers/test";
import { origin, signIn } from "./helpers/session";

// Per-feature access: a collaborator who accepts an invitation sees only the areas granted; a guest sees no feature entries.
test.use({ actionTimeout: 20_000, reducedMotion: "reduce" });
const expect = check.configure({ timeout: 30_000 });
const headers = { origin };
const sidebar = (page: Page) => page.getByRole("navigation", { name: /^Ministry navigation/ });

async function invitationToken(email: string) {
  let token = "";
  await expect.poll(async () => {
    const lines = (await readFile(process.env.HARVEST_E2E_MAILBOX!, "utf8").catch(() => "")).trim().split("\n").filter(Boolean);
    token = lines.map((line) => JSON.parse(line)).find((mail) => mail.to === email && /^invitation /.test(mail.text))?.text.split(" ")[1] ?? "";
    return token.length;
  }).toBeGreaterThan(20);
  return token;
}
test("a collaborator with Social only sees Social; a guest sees no features", async ({ page, browser }) => {
  test.setTimeout(300_000);
  await signIn(page);
  const tenant = (await (await page.request.post("/api/workspaces", { headers, data: { name: "Grace Community Church", audience: "church" } })).json()).tenantId as string;
  const join = async (role: string, grants: object) => {
    const context = await browser.newContext({ baseURL: origin, viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
    const guest = await context.newPage(), email = await signIn(guest);
    expect((await page.request.post(`/api/workspaces/${tenant}/invitations`, { headers, data: { email, role, grants } })).status()).toBe(201);
    expect((await guest.request.post("/api/workspace-invitations/accept", { headers, data: { token: await invitationToken(email) } })).status()).toBe(200);
    return { guest, context };
  };
  const social = await join("collaborator", { social: "manage" });
  await social.guest.goto(`/workspaces/${tenant}/social/planner`);
  await expect(social.guest.locator("[data-hydrated=true]")).toBeVisible();
  await expect(sidebar(social.guest).getByRole("link", { name: "People", exact: true })).toHaveCount(0);
  await expect(sidebar(social.guest).getByRole("link", { name: "Documents", exact: true })).toHaveCount(0);
  await social.guest.goto(`/workspaces/${tenant}/crm/people`);
  await expect(social.guest.getByRole("link", { name: "People", exact: true })).toHaveCount(0);
  const guest = await join("guest", {});
  await guest.guest.goto(`/workspaces/${tenant}`);
  await expect(sidebar(guest.guest).getByRole("link")).toHaveCount(0);
  await social.context.close(); await guest.context.close();
});
