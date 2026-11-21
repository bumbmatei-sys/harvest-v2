// Explicit entry point for the buffered CF-03 API. Rendering and multipart
// uploads are outside this entry point until their Worker lifetimes are proven.
import * as auth from "@/app/api/auth/[...all]/route";
import * as workspaces from "@/app/api/workspaces/route";
import * as files from "@/app/api/workspaces/[tenantId]/files/route";
import * as confirm from "@/app/api/workspaces/[tenantId]/files/[fileId]/confirm/route";
import * as download from "@/app/api/workspaces/[tenantId]/files/[fileId]/download/route";
import * as publicFile from "@/app/api/files/public/[tenantId]/[fileId]/route";
import * as catalogFile from "@/app/api/catalog/[slug]/files/[fileId]/route";
import * as communityFiles from "@/app/api/communities/[slug]/files/route";
import * as communityConfirm from "@/app/api/communities/[slug]/files/[fileId]/confirm/route";
import * as communityFile from "@/app/api/communities/[slug]/files/[fileId]/route";
import { getAuth, withWorkerRequest } from "@/server/auth-instance";
import { FILE_TRANSFER_PATH, R2FileStorage } from "@/server/storage/r2";
import { readWorkerSettings, workerSettings, type WorkerBindings } from "@/server/worker-settings";

type Handler = () => Promise<Response>;

function matchApi(request: Request, path: string): Handler | undefined {
  const method = request.method;
  if (path.startsWith("/api/auth/")) {
    if (method === "GET") return () => auth.GET(request);
    if (method === "POST") return () => auth.POST(request);
  }
  if (path === "/api/workspaces" && method === "GET") return () => workspaces.GET(request);
  const workspace = /^\/api\/workspaces\/([^/]+)\/files(?:\/([^/]+)\/(confirm|download))?$/.exec(path);
  if (workspace) {
    const [, tenantId, fileId, action] = workspace;
    const context = { params: Promise.resolve({ tenantId, fileId }) };
    if (!action && method === "GET") return () => files.GET(request, context);
    if (!action && method === "POST") return () => files.POST(request, context);
    if (action === "confirm" && method === "POST") return () => confirm.POST(request, context);
    if (action === "download" && method === "GET") return () => download.GET(request, context);
  }
  const publicMatch = /^\/api\/files\/public\/([^/]+)\/([^/]+)$/.exec(path);
  if (publicMatch && method === "GET") {
    return () => publicFile.GET(request, { params: Promise.resolve({ tenantId: publicMatch[1], fileId: publicMatch[2] }) });
  }
  const community = /^\/api\/communities\/([^/]+)\/files(?:\/([^/]+)(\/confirm)?)?$/.exec(path);
  if (community) {
    const [, slug, fileId, confirmation] = community;
    const context = { params: Promise.resolve({ slug, fileId }) };
    if (!fileId && method === "POST") return () => communityFiles.POST(request, context);
    if (confirmation && method === "POST") return () => communityConfirm.POST(request, context);
    if (fileId && !confirmation && method === "GET") return () => communityFile.GET(request, context);
  }
  const catalog = /^\/api\/catalog\/([^/]+)\/files\/([^/]+)$/.exec(path);
  if (catalog && method === "GET") {
    return () => catalogFile.GET(request, { params: Promise.resolve({ slug: catalog[1], fileId: catalog[2] }) });
  }
}

function privateResponse(response: Response) {
  // Preserve separate Set-Cookie values. Some runtime responses have immutable headers.
  const result = new Response(response.body, response);
  result.headers.set("Cache-Control", "private, no-store");
  result.headers.set("Referrer-Policy", "no-referrer");
  result.headers.set("X-Content-Type-Options", "nosniff");
  return result;
}

async function redactAuthToken(path: string, response: Response) {
  if (!response.ok || (path !== "/api/auth/get-session" && path !== "/api/auth/sign-in/email-otp")) return response;
  const body = await response.json() as { token?: string; session?: { token?: string } } | null;
  if (body) {
    delete body.token;
    if (body.session) delete body.session.token;
  }
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return Response.json(body, { status: response.status, headers });
}

export async function fetchBufferedApi(request: Request, env: WorkerBindings) {
  const url = new URL(request.url);
  try {
    const settings = readWorkerSettings(env);
    if (url.origin !== settings.origin) return privateResponse(new Response(null, { status: 421 }));
    const route = matchApi(request, url.pathname);
    if (!route && url.pathname !== FILE_TRANSFER_PATH) return privateResponse(new Response(null, { status: 404 }));

    const withAuth = <T>(run: () => Promise<T>) => withWorkerRequest({
      APP_HYPERDRIVE: settings.hyperdrive, BETTER_AUTH_SECRET: settings.authSecret, BETTER_AUTH_URL: settings.origin,
      AUTH_IP_ADDRESS_HEADERS: "cf-connecting-ip", cookiePrefix: `harvest-${settings.stage}`,
      mail: { apiKey: settings.mailKey, from: settings.mailFrom },
    }, request, run);
    const response = await workerSettings.run(settings, async () => {
      if (route) return withAuth(route);
      // Finish the database session lookup before streaming any R2 bytes.
      const storage = new R2FileStorage(settings.bucket, settings.origin, settings.grantSecret);
      return storage.transfer(request, () => withAuth(async () =>
        (await getAuth().api.getSession({ headers: request.headers }))?.user.id));
    });
    return privateResponse(await redactAuthToken(url.pathname, response));
  } catch {
    console.error("worker_request_failed");
    return privateResponse(new Response(null, { status: 503 }));
  }
}

const worker = { fetch: (request: Request, env: WorkerBindings) => fetchBufferedApi(request, env) };
export default worker;
