// CF-07: one Worker for the whole app. The explicit buffered API keeps its tested entry; every other request goes to the
// OpenNext handler inside a request-scoped database and auth context that stays open until the response body has been
// fully sent or cancelled, so streamed pages never touch a closed connection or another request's handle.
import { withWorkerRequest } from "@/server/auth-instance";
import { readWorkerSettings, workerSettings, type WorkerBindings } from "@/server/worker-settings";

type WorkerSettings = ReturnType<typeof readWorkerSettings>;
import { fetchBufferedApi, isBufferedApiRequest } from "./buffered-api";

type ExecutionContext = { waitUntil(promise: Promise<unknown>): void };
export type PageHandler = { fetch(request: Request, env: never, ctx: ExecutionContext): Promise<Response> };

/** Calls `done` once, when the body has been read to the end, errors or is cancelled. A body-less response is done at once. */
export function holdUntilDone(response: Response, done: () => void): Response {
  if (!response.body) { done(); return response; }
  const reader = response.body.getReader();
  let finished = false;
  const finish = () => { if (!finished) { finished = true; done(); } };
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done: end } = await reader.read();
        if (end) { controller.close(); finish(); } else controller.enqueue(value);
      } catch (error) { controller.error(error); finish(); }
    },
    async cancel(reason) { try { await reader.cancel(reason); } finally { finish(); } },
  });
  return new Response(body, response);
}

/** Tenant pages are never shared-cacheable; public caching needs an explicit policy (PRD section 8). A response that
 * sets a cookie is always private, even if it says public, so the edge can never cache a session cookie. */
export function privatePage(response: Response) {
  const result = new Response(response.body, response);
  const explicitlyPublic = /\bpublic\b/.test(result.headers.get("cache-control") ?? "");
  if (!explicitlyPublic || result.headers.has("set-cookie")) result.headers.set("Cache-Control", "private, no-store");
  return result;
}

function withScope(settings: WorkerSettings, request: Request, run: () => Promise<void>) {
  return withWorkerRequest({
    APP_HYPERDRIVE: settings.hyperdrive, database: settings.databaseName, BETTER_AUTH_SECRET: settings.authSecret,
    BETTER_AUTH_URL: settings.origin, AUTH_IP_ADDRESS_HEADERS: "cf-connecting-ip", cookiePrefix: `harvest-${settings.stage}`,
    mail: { apiKey: settings.mailKey, from: settings.mailFrom },
  }, request, run);
}

export function createAppWorker(pages: PageHandler) {
  return {
    async fetch(request: Request, env: WorkerBindings, ctx: ExecutionContext): Promise<Response> {
      if (isBufferedApiRequest(request)) return fetchBufferedApi(request, env);
      let settings: WorkerSettings;
      try { settings = readWorkerSettings(env); } catch {
        console.error("worker_configuration_invalid");
        return new Response(null, { status: 503, headers: { "cache-control": "private, no-store" } });
      }
      if (new URL(request.url).origin !== settings.origin) return new Response(null, { status: 421, headers: { "cache-control": "private, no-store" } });
      let release!: () => void;
      const released = new Promise<void>((resolve) => { release = resolve; });
      return new Promise<Response>((resolve, reject) => {
        let answered = false;
        const scope = workerSettings.run(settings, () => withScope(settings, request, async () => {
          const response = await pages.fetch(request, env as never, ctx);
          answered = true;
          resolve(privatePage(holdUntilDone(response, release)));
          await released;
        }));
        ctx.waitUntil(scope.catch(() => { console.error("worker_page_scope_failed"); }));
        scope.catch((error) => { if (!answered) reject(error); });
      }).catch(() => new Response(null, { status: 503, headers: { "cache-control": "private, no-store" } }));
    },
  };
}
