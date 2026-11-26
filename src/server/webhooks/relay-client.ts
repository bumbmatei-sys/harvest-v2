import { dispatchErrors, type Dispatcher } from "./dispatch";
import { newRelayNonce, RELAY_MIN_KEY_LENGTH, RELAY_PATH, relayHeaders, signRelayRequest } from "./relay-protocol";

/** How long the relay may take beyond the delivery's own timeout: its DNS check (5 s) plus connection slack. */
const RELAY_SLACK_MS = 7_000;

/**
 * Dispatcher for Workers: sends the delivery to the isolated egress relay, which re-checks the destination and makes the pinned
 * call. `fetcher` is the relay's service binding (or global fetch to its private origin). Anything but a well-formed relay answer
 * is a retryable NETWORK failure; the relay is never told who the tenant is and the caller never learns more than the status.
 */
export function relayDispatcher({ origin, key, fetcher = fetch, now = () => Date.now() }: { origin: string; key: string; fetcher?: typeof fetch; now?: () => number }): Dispatcher {
  if (key.length < RELAY_MIN_KEY_LENGTH) throw new Error("WEBHOOK_EGRESS_KEY_TOO_SHORT");
  const target = new URL(RELAY_PATH, origin);
  return async (input) => {
    const body = JSON.stringify(input), timestamp = Math.floor(now() / 1000).toString(), nonce = newRelayNonce();
    let response: Response;
    try {
      response = await fetcher(target, { method: "POST", body, redirect: "manual", signal: AbortSignal.timeout(input.timeoutMs + RELAY_SLACK_MS), headers: {
        "content-type": "application/json", [relayHeaders.timestamp]: timestamp, [relayHeaders.nonce]: nonce,
        [relayHeaders.signature]: await signRelayRequest(key, timestamp, nonce, body),
      } });
    } catch (error) {
      return { ok: false, error: (error as { name?: string })?.name === "TimeoutError" ? "TIMEOUT" : "NETWORK" };
    }
    if (response.status !== 200) { await response.body?.cancel(); return { ok: false, error: "NETWORK" }; }
    const result = await response.json().catch(() => null) as { ok?: unknown; status?: unknown; error?: unknown } | null;
    if (result?.ok === true && Number.isInteger(result.status) && (result.status as number) >= 100 && (result.status as number) <= 599) return { ok: true, status: result.status as number };
    if (result?.ok === false && dispatchErrors.includes(result.error as never)) return { ok: false, error: result.error as (typeof dispatchErrors)[number] };
    return { ok: false, error: "NETWORK" };
  };
}
