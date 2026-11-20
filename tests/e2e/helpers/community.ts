import { expect, type Locator, type Page } from "@playwright/test";

export async function waitForCommunityResponse(page: Page, method: string, path: string | RegExp) {
  const response = await page.waitForResponse((candidate) => {
    const pathname = new URL(candidate.url()).pathname;
    return candidate.request().method() === method && (typeof path === "string" ? pathname === path : path.test(pathname));
  });
  expect(response.ok(), `${method} ${new URL(response.url()).pathname} returned ${response.status()}`).toBe(true);
  return response;
}

export async function joinAndWaitForForum(page: Page, slug: string, submit: Locator) {
  const [joined] = await Promise.all([
    waitForCommunityResponse(page, "POST", `/api/communities/${slug}/join`),
    submit.click(),
  ]);
  expect(await joined.json()).toMatchObject({ outcome: "joined" });
  // A cold Next.js route may still be compiling after the join transaction commits.
  await page.waitForURL(`**/communities/${slug}/forum`);
  await expect(page.getByRole("heading", { name: "All posts", level: 2, exact: true })).toBeVisible();
}
