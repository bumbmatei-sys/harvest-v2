/**
 * The one step that sends a signed CRM webhook: check the destination, then POST it. Two implementations share this contract:
 * `directDispatcher` (Node: resolves, screens every address, pins the connection — destination.ts) and the egress relay client
 * (relay-client.ts), which asks an isolated Node service to run the direct dispatcher, because a Workers isolate cannot pin a
 * checked address (CF-01). Results never carry a URL, header or body.
 */
export type DispatchInput = { url: string; headers: Record<string, string>; body: string; timeoutMs: number };
export type DispatchError = "TIMEOUT" | "NETWORK" | "BLOCKED_DESTINATION" | "INVALID_DESTINATION";
export type DispatchResult = { ok: true; status: number } | { ok: false; error: DispatchError };
export type Dispatcher = (input: DispatchInput) => Promise<DispatchResult>;
export const dispatchErrors: readonly DispatchError[] = ["TIMEOUT", "NETWORK", "BLOCKED_DESTINATION", "INVALID_DESTINATION"];
