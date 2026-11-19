import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { expect, test, type APIResponse, type BrowserContext } from "@playwright/test";

const documentBody = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

async function success(response: APIResponse, action: string) {
  expect(response.status(), action).toBeGreaterThanOrEqual(200);
  expect(response.status(), action).toBeLessThan(300);
}

async function signIn(context: BrowserContext, origin: string, email: string) {
  const hosted = Boolean(process.env.QA_PREVIEW_URL);
  const headers = new Headers({ Origin: origin });
  if (hosted && process.env.QA_PREVIEW_BYPASS) {
    headers.set("x-vercel-protection-bypass", process.env.QA_PREVIEW_BYPASS);
    headers.set("x-vercel-set-bypass-cookie", "true");
  }
  const cookies = async (response: Response) => {
    const scoped = response.headers.getSetCookie().map(value => {
      const pair = value.split(";", 1)[0];
      const separator = pair.indexOf("=");
      return { name: pair.slice(0, separator), value: pair.slice(separator + 1), url: origin };
    });
    await context.addCookies(scoped);
  };
  const request = (path: string, init: RequestInit) =>
    fetch(new URL(path, origin), { ...init, redirect: "manual", signal: AbortSignal.timeout(30_000) });
  const post = (path: string, data: object) => {
    const json = new Headers(headers);
    json.set("Content-Type", "application/json");
    return request(path, { method: "POST", headers: json, body: JSON.stringify(data) });
  };
  const helperHeaders = new Headers(headers);
  if (hosted) {
    if (!process.env.QA_PREVIEW_HELPER_KEY) throw new Error("QA helper key is required.");
    helperHeaders.set("x-qa-secret", process.env.QA_PREVIEW_HELPER_KEY);
    const readiness = await request("/api/qa/otp?ready=1", { headers: helperHeaders });
    expect(readiness.status, "preview QA readiness").toBe(204);
    await cookies(readiness);
  }

  // The wait also applies to the first send of a retry and uses no forwarded-IP spoofing.
  await delay(25_000);
  const send = await post("/api/auth/email-otp/send-verification-otp", { email, type: "sign-in" });
  expect(send.status, "synthetic OTP request").toBe(200);
  let code = "";
  if (hosted) {
    const response = await request("/api/qa/otp?email=" + encodeURIComponent(email), { headers: helperHeaders });
    expect(response.status, "synthetic OTP retrieval").toBe(200);
    ({ code } = await response.json());
  } else {
    await expect.poll(async () => {
      const raw = await readFile(process.env.HARVEST_E2E_MAILBOX!, "utf8").catch(() => "");
      code = raw.trim().split("\n").filter(Boolean).map(line => JSON.parse(line))
        .find(mail => mail.to === email)?.text.match(/\b\d{6}\b/)?.[0] ?? "";
      return /^\d{6}$/.test(code);
    }, { message: "mock mailbox code was issued" }).toBe(true);
  }
  if (!/^\d{6}$/.test(code)) throw new Error("QA helper returned an invalid code.");
  const session = await post("/api/auth/sign-in/email-otp", { email, otp: code });
  expect(session.status, "synthetic sign-in").toBe(200);
  await cookies(session);
}

test("synthetic ministry, membership, forum and moderation walkthrough", async ({ browser, baseURL }, info) => {
  const origin = new URL(baseURL!).origin;
  const owner = await browser.newContext({ baseURL: origin, serviceWorkers: "block" });
  const member = await browser.newContext({ baseURL: origin, serviceWorkers: "block" });
  // OTP requests use Node fetch. The workflow exports only redacted action metadata.
  const run = randomUUID().replaceAll("-", "");
  const name = `QA Circle ${run.slice(0, 8)}`;
  const slug = `qa-${run}`;
  const ownerPage = await owner.newPage();
  const memberPage = await member.newPage();
  const headers = { origin };
  const evidence = (page: typeof ownerPage, name: string) => page.screenshot({ path: info.outputPath(name + ".png"), fullPage: true });
  let communityPath = "", editPath = "", version = 0;
  try {
    await test.step("Create and publish a community", async () => {
      await signIn(owner, origin, `owner-${run}@qa.harvest.invalid`);
      const workspace = await owner.request.post("/api/workspaces", { headers, data: { name: `QA Ministry ${run.slice(0, 8)}`, audience: "church" } });
      await success(workspace, "create ministry");
      const { tenantId } = await workspace.json();
      const communities = `/api/workspaces/${tenantId}/communities`;
      const create = await owner.request.post(communities, { headers, data: { name, slug } });
      await success(create, "create community");
      const { id } = await create.json();
      communityPath = communities + "/" + id;
      editPath = `/workspaces/${tenantId}/communities/${id}/edit`;
      const current = await owner.request.get(communityPath);
      await success(current, "load draft");
      const configured = await owner.request.patch(communityPath, { headers, data: { version: (await current.json()).version, visibility: "listed", allowOpen: false, allowApply: true } });
      await success(configured, "enable applications");
      const publish = await owner.request.post(communityPath + "/publish", { headers, data: { version: (await configured.json()).version, published: true } });
      await success(publish, "publish community");
      version = (await publish.json()).version;
      await ownerPage.goto(editPath);
      await expect(ownerPage.getByRole("navigation", { name: "Community setup" })).toBeVisible();
      await evidence(ownerPage, "01-community");
    });
    await test.step("Apply and approve the second account", async () => {
      await signIn(member, origin, `member-${run}@qa.harvest.invalid`);
      await memberPage.goto(`/communities/${slug}`);
      await memberPage.getByRole("button", { name: "Apply", exact: true }).click();
      const join = memberPage.getByRole("dialog", { name: `Join ${name}` });
      await join.getByLabel("I confirm I am 18 or older").click();
      await join.getByRole("button", { name: "Apply", exact: true }).click();
      await expect(join.getByText("Application sent")).toBeVisible();
      await ownerPage.goto(editPath);
      await ownerPage.getByRole("navigation", { name: "Community setup" }).getByRole("button", { name: /People/ }).click();
      const pending = ownerPage.getByRole("table", { name: "Applications" }).getByRole("row").filter({ hasText: "Pending" });
      await pending.getByRole("button").click();
      const review = ownerPage.getByRole("dialog");
      await review.getByRole("button", { name: "Approve", exact: true }).click();
      await expect(review).toBeHidden();
      await memberPage.goto(`/communities/${slug}/forum`);
      await expect(memberPage.getByRole("heading", { name: "All posts", level: 2 })).toBeVisible();
      await evidence(memberPage, "02-membership");
    });
    await test.step("Post, comment and verify a moderation report", async () => {
      const categories = await owner.request.get(communityPath + "/categories");
      await success(categories, "load categories");
      const title = "QA walkthrough post";
      const post = await member.request.post(`/api/communities/${slug}/posts`, { headers, data: {
        categoryId: (await categories.json())[0].id, title, body: documentBody("Synthetic walkthrough post."),
        videoUrl: null, coverFileId: null, attachmentIds: [], commentsOff: false, likesOff: false,
      } });
      await success(post, "create post");
      const postPath = `/communities/${slug}/posts/${(await post.json()).id}`;
      const reply = "Synthetic walkthrough comment.";
      await ownerPage.goto(postPath);
      await ownerPage.getByLabel("Reply", { exact: true }).fill(reply);
      await ownerPage.getByRole("button", { name: "Reply", exact: true }).click();
      await expect(ownerPage.getByText(reply)).toBeVisible();
      await evidence(ownerPage, "03-discussion");
      await ownerPage.getByRole("button", { name: `Report post ${title}` }).click();
      const report = ownerPage.getByRole("dialog", { name: "Report post" });
      await report.getByLabel("Spam or advertising").click();
      await report.getByRole("button", { name: "Send report" }).click();
      await expect(report.getByRole("status")).toBeVisible();
      await ownerPage.goto(`/communities/${slug}/moderation`);
      await expect(ownerPage.getByRole("table", { name: "Reports" }).getByText(title)).toBeVisible();
      await evidence(ownerPage, "04-moderation");
    });
  } finally {
    try {
      if (version) {
        const status = await owner.request.post(communityPath + "/publish", {
          headers, timeout: 12_000, data: { version, published: false },
        }).then(response => response.status(), () => null);
        if (status === null || status < 200 || status >= 300) throw new Error("Could not unpublish the synthetic community.");
      }
    } finally {
      await Promise.all([owner.close(), member.close()]);
    }
  }
});
