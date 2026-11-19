import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The hook is exercised without a DOM renderer: React's hooks are replaced by the smallest versions it needs.
let cleanups: (() => void)[] = [];
vi.mock("react", () => ({
  useRef: <T,>(value: T) => ({ current: value }),
  useCallback: <T,>(fn: T) => fn,
  useEffectEvent: <T,>(fn: T) => fn,
  useEffect: (effect: () => void | (() => void)) => { const cleanup = effect(); if (cleanup) cleanups.push(cleanup); },
}));
const { usePolling } = await import("../../src/hooks/use-polling");

const doc = Object.assign(new EventTarget(), { visibilityState: "visible", hasFocus: () => true });
const win = new EventTarget();
let online = true;
const response = (status: number, headers: Record<string, string> = {}) => ({ status, headers: new Headers(headers) });

beforeEach(() => {
  vi.useFakeTimers();
  doc.visibilityState = "visible";
  online = true;
  vi.stubGlobal("document", doc);
  vi.stubGlobal("window", win);
  vi.stubGlobal("navigator", { get onLine() { return online; } });
});
afterEach(() => { for (const cleanup of cleanups) cleanup(); cleanups = []; vi.useRealTimers(); vi.unstubAllGlobals(); });

function usePoller(poll: (signal: AbortSignal) => Promise<ReturnType<typeof response>>) {
  const onStop = vi.fn();
  usePolling({ resource: "chat", mode: "rail", poll, onStop });
  return onStop;
}

describe("usePolling", () => {
  it.each([401, 403, 404] as const)("polls at once and stops for good on %i", async status => {
    const poll = vi.fn(async () => response(status));
    const onStop = usePoller(poll);
    await vi.advanceTimersByTimeAsync(0);
    expect(onStop).toHaveBeenCalledWith(status);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(poll).toHaveBeenCalledTimes(1);
  });

  it("stops while the tab is hidden, aborting the request in flight, and resumes when visible", async () => {
    let signal: AbortSignal | undefined;
    const poll = vi.fn((next: AbortSignal) => {
      signal = signal ?? next;
      return signal === next ? new Promise<ReturnType<typeof response>>(resolve => next.addEventListener("abort", () => resolve(response(200)))) : Promise.resolve(response(200));
    });
    usePoller(poll);
    await vi.advanceTimersByTimeAsync(0);
    expect(poll).toHaveBeenCalledTimes(1);
    doc.visibilityState = "hidden";
    doc.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(120_000);
    expect(poll).toHaveBeenCalledTimes(1);
    expect(signal?.aborted).toBe(true);
    doc.visibilityState = "visible";
    doc.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(poll).toHaveBeenCalledTimes(2);
  });

  it("pauses when offline and resumes when back online", async () => {
    const poll = vi.fn(async () => response(200));
    usePoller(poll);
    await vi.advanceTimersByTimeAsync(0);
    online = false;
    win.dispatchEvent(new Event("offline"));
    await vi.advanceTimersByTimeAsync(120_000);
    expect(poll).toHaveBeenCalledTimes(1);
    online = true;
    win.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(0);
    expect(poll).toHaveBeenCalledTimes(2);
  });

  it("treats 304 as success and follows the advertised interval", async () => {
    const poll = vi.fn(async () => response(304, { "X-Poll-Interval": "20000" }));
    usePoller(poll);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(19_000);
    expect(poll).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(poll).toHaveBeenCalledTimes(2);
  });

  it("waits out Retry-After before polling again", async () => {
    const poll = vi.fn()
      .mockResolvedValueOnce(response(429, { "Retry-After": "90" }))
      .mockResolvedValue(response(200));
    usePoller(poll);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(89_000);
    expect(poll).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(poll).toHaveBeenCalledTimes(2);
  });

  it("backs off after failures and caps the delay at one minute", async () => {
    const poll = vi.fn(async () => response(500));
    usePoller(poll);
    await vi.advanceTimersByTimeAsync(0);
    expect(poll).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(poll).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(poll).toHaveBeenCalledTimes(3);
    for (let round = 4; round <= 7; round++) {
      await vi.advanceTimersByTimeAsync(60_000);
      expect(poll).toHaveBeenCalledTimes(round);
    }
  });
});
