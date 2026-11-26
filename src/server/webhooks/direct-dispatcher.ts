import { httpsTransport, resolveDestination, systemResolver, TransportError, type Resolver, type Transport } from "./destination";
import type { Dispatcher } from "./dispatch";

/** Node dispatcher: re-checks the destination on every attempt (DNS may have changed), then sends on the pinned, bounded transport. */
export function directDispatcher(resolve: Resolver = systemResolver, transport: Transport = httpsTransport): Dispatcher {
  return async ({ url, headers, body, timeoutMs }) => {
    const target = await resolveDestination(url, resolve);
    if (!target.ok) return { ok: false, error: target.error };
    try {
      const { status } = await transport({ url: target.url, address: target.address, family: target.family, headers, body, timeoutMs });
      return { ok: true, status };
    } catch (error) {
      return { ok: false, error: error instanceof TransportError ? error.code : "NETWORK" };
    }
  };
}
