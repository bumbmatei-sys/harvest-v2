/** Loopback-only S3 subset for tests. It verifies AWS SigV4, not just URL shape. */
import { createServer, type IncomingMessage } from "node:http";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
const credentials = { accessKeyId: "harvest-local-test", secretAccessKey: "local-test-only-no-cloud-access" };
const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const hmac = (key: string | Buffer, value: string) => createHmac("sha256", key).update(value).digest();
const encode = (value: string) => encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
function authorized(request: IncomingMessage, url: URL) {
  const query = url.searchParams;
  const presigned = query.has("X-Amz-Signature");
  const auth = request.headers.authorization ?? "";
  const credential = presigned ? query.get("X-Amz-Credential") : auth.match(/Credential=([^, ]+)/)?.[1];
  const signed = presigned ? query.get("X-Amz-SignedHeaders") : auth.match(/SignedHeaders=([^, ]+)/)?.[1];
  const signature = presigned ? query.get("X-Amz-Signature") : auth.match(/Signature=([a-f0-9]+)/)?.[1];
  const date = presigned ? query.get("X-Amz-Date") : request.headers["x-amz-date"]?.toString();
  if (!credential || !signed || !signature || !date || !/^[a-f0-9]{64}$/.test(signature)) return false;
  const [access, day, region, service, terminator] = credential.split("/");
  if (access !== credentials.accessKeyId || service !== "s3" || terminator !== "aws4_request" || day !== date.slice(0, 8)) return false;
  const timestamp = Date.parse(date.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, "$1-$2-$3T$4:$5:$6Z"));
  const age = (Date.now() - timestamp) / 1000;
  if (!Number.isFinite(age) || age < -60 || age > (presigned ? Number(query.get("X-Amz-Expires")) : 900)) return false;
  const names = signed.split(";");
  if (!names.includes("host") || names.some((name) => !request.headers[name])) return false;
  if (request.method === "PUT" && !["content-type", "content-length", "if-none-match"].every((name) => names.includes(name))) return false;
  const headers = names.map((name) => `${name}:${String(request.headers[name]).trim().replace(/\s+/g, " ")}\n`).join("");
  const canonicalQuery = [...query.entries()].filter(([name]) => name !== "X-Amz-Signature")
    .map(([name, value]) => [encode(name), encode(value)]).sort(([a, av], [b, bv]) => a < b ? -1 : a > b ? 1 : av < bv ? -1 : av > bv ? 1 : 0)
    .map(([name, value]) => `${name}=${value}`).join("&");
  const payload = presigned ? "UNSIGNED-PAYLOAD" : String(request.headers["x-amz-content-sha256"] ?? sha(""));
  const canonical = [request.method, url.pathname, canonicalQuery, headers, signed, payload].join("\n");
  const scope = `${day}/${region}/s3/aws4_request`;
  const key = hmac(hmac(hmac(hmac(`AWS4${credentials.secretAccessKey}`, day), region), "s3"), "aws4_request");
  const expected = createHmac("sha256", key).update(`AWS4-HMAC-SHA256\n${date}\n${scope}\n${sha(canonical)}`).digest();
  return timingSafeEqual(expected, Buffer.from(signature, "hex"));
}
export async function storageMock() {
  const objects = new Map<string, { body: Buffer; mime: string; etag: string }>();
  const server = createServer(async (request, response) => {
    response.setHeader("Access-Control-Allow-Origin", "http://127.0.0.1:3100");
    response.setHeader("Access-Control-Allow-Methods", "GET, HEAD, PUT, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "content-type, if-none-match");
    response.setHeader("Access-Control-Expose-Headers", "etag, content-type, content-length");
    if (request.method === "OPTIONS") { response.writeHead(204).end(); return; }
    const url = new URL(request.url!, `http://${request.headers.host}`);
    const fail = (status: number, code: string) => { response.writeHead(status, { "Content-Type": "application/xml" }).end(`<Error><Code>${code}</Code></Error>`); };
    if (!authorized(request, url)) { fail(403, "SignatureDoesNotMatch"); return; }
    if (!url.pathname.startsWith("/harvest-files-test/workspaces/")) { fail(404, "NoSuchBucket"); return; }
    if (request.method === "PUT") {
      if (request.headers["if-none-match"] !== "*" || objects.has(url.pathname)) { fail(412, "PreconditionFailed"); return; }
      const chunks: Buffer[] = []; let length = 0;
      for await (const chunk of request) {
        length += chunk.length;
        if (length > 10 * 1024 * 1024) { fail(413, "EntityTooLarge"); return; }
        chunks.push(chunk);
      }
      if (length !== Number(request.headers["content-length"])) { fail(400, "IncompleteBody"); return; }
      const body = Buffer.concat(chunks);
      const etag = `"${createHash("md5").update(body).digest("hex")}"`;
      objects.set(url.pathname, { body, mime: request.headers["content-type"]!, etag });
      response.writeHead(200, { ETag: etag }).end(); return;
    }
    const object = objects.get(url.pathname);
    if (!object) { fail(404, "NoSuchKey"); return; }
    if (request.headers["if-match"] && request.headers["if-match"] !== object.etag) { fail(412, "PreconditionFailed"); return; }
    if (request.method !== "GET" && request.method !== "HEAD") { fail(405, "MethodNotAllowed"); return; }
    response.setHeader("Content-Length", object.body.length); response.setHeader("ETag", object.etag);
    response.setHeader("Content-Type", url.searchParams.get("response-content-type") ?? object.mime);
    response.setHeader("Cache-Control", url.searchParams.get("response-cache-control") ?? "no-store");
    if (url.searchParams.has("response-content-disposition")) response.setHeader("Content-Disposition", url.searchParams.get("response-content-disposition")!);
    response.writeHead(200).end(request.method === "HEAD" ? undefined : object.body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("S3 mock did not start.");
  return { config: { ...credentials, endpoint: `http://127.0.0.1:${address.port}`, region: "us-east-1", bucket: "harvest-files-test" },
    async close() { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); },
  };
}
