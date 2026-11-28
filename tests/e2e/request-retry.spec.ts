import { createServer } from "node:http";
import { expect, test } from "./helpers/test";

test("API transport retries one reset and leaves HTTP errors alone", async ({ request }) => {
  const calls = new Map<string, number>();
  const server = createServer((incoming, response) => {
    const path = incoming.url ?? "/";
    const count = (calls.get(path) ?? 0) + 1;
    calls.set(path, count);
    if (path === "/two-resets" || (path === "/one-reset" && count === 1)) {
      incoming.socket.destroy();
      return;
    }
    response.writeHead(path === "/http-error" ? 503 : 204).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Loopback server failed to bind");
    const url = `http://127.0.0.1:${address.port}`;
    expect((await request.get(`${url}/one-reset`)).status()).toBe(204);
    await expect(request.get(`${url}/two-resets`)).rejects.toThrow(/ECONNRESET|socket hang up/);
    await expect(request.get(`${url}/http-error`, { failOnStatusCode: true })).rejects.toThrow(/503/);
    expect(Object.fromEntries(calls)).toEqual({ "/one-reset": 2, "/two-resets": 2, "/http-error": 1 });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
