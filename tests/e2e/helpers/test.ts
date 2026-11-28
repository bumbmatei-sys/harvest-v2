import { test as base, type APIRequestContext } from "@playwright/test";

export * from "@playwright/test";

const configured = new WeakSet<APIRequestContext>();
function withRequestRetry(request: APIRequestContext) {
  if (!configured.has(request)) {
    configured.add(request);
    const fetch = request.fetch.bind(request);
    // Playwright's HTTP verbs delegate to fetch. Its transport retries only ECONNRESET.
    request.fetch = (url, options) => fetch(url, { ...options, maxRetries: 1 });
  }
  return request;
}

export const test = base.extend({
  request: async ({ request }, provide) => provide(withRequestRetry(request)),
  context: async ({ context }, provide) => {
    withRequestRetry(context.request);
    await provide(context);
  },
  // Cover specs that create additional signed-in browser contexts or pages.
  browser: [async ({ browser }, provide) => {
    const newContext = browser.newContext.bind(browser);
    const newPage = browser.newPage.bind(browser);
    browser.newContext = async (options) => {
      const context = await newContext(options);
      withRequestRetry(context.request);
      return context;
    };
    browser.newPage = async (options) => {
      const page = await newPage(options);
      withRequestRetry(page.request);
      return page;
    };
    try {
      await provide(browser);
    } finally {
      browser.newContext = newContext;
      browser.newPage = newPage;
    }
  }, { scope: "worker" }],
});
