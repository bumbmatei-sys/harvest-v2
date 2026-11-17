"use client";

import { useCallback, useEffect, useEffectEvent, useRef } from "react";

type PollResult = {
  status: number;
  headers?: Headers;
  activity?: boolean;
  more?: boolean;
};
type PollOptions = {
  resource: string | null;
  mode: "active" | "rail";
  poll: (signal: AbortSignal) => Promise<PollResult>;
  onStop: (status: 401 | 403 | 404) => void;
};

export function pollingDelay({
  mode, focused, idleMs, failures, serverIntervalMs = 0, jitter = Math.random(),
}: {
  mode: PollOptions["mode"];
  focused: boolean;
  idleMs: number;
  failures: number;
  serverIntervalMs?: number;
  jitter?: number;
}) {
  let interval = 15_000;
  if (mode === "active") {
    if (idleMs >= 300_000) interval = 30_000;
    else if (focused && idleMs < 120_000) {
      interval = Math.max(4_000, serverIntervalMs) - 1_000 + 2_000 * jitter;
      return Math.min(60_000, interval * 2 ** failures);
    }
  }
  return Math.min(60_000, Math.max(interval, serverIntervalMs) * 2 ** failures);
}

export function retryAfterDelay(header: string | null, now = Date.now()) {
  if (!header) return 0;
  const timestamp = /^\d+$/.test(header) ? now + Number(header) * 1_000 : Date.parse(header);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - now) : 0;
}

/** The caller owns its cursor, ETag, and event merge. The hook owns scheduling. */
export function usePolling({ resource, mode, poll, onStop }: PollOptions) {
  const runPoll = useEffectEvent(poll);
  const reportStop = useEffectEvent(onStop);
  const refresh = useRef<() => void>(() => {});

  useEffect(() => {
    if (resource === null) return;
    let timer: ReturnType<typeof setTimeout>;
    let request: AbortController | undefined;
    let stopped = false;
    let refreshPending = false;
    let failures = 0;
    let serverIntervalMs = 0;
    let retryAt = 0;
    let lastActivity = Date.now();

    const canPoll = () => !stopped && document.visibilityState === "visible" && navigator.onLine;
    const interval = () => pollingDelay({
      mode,
      focused: document.hasFocus(),
      idleMs: Date.now() - lastActivity,
      failures,
      serverIntervalMs,
    });

    function schedule(delay: number) {
      clearTimeout(timer);
      if (!canPoll()) return;
      // Keep every wake-up behind the server's Retry-After deadline.
      timer = setTimeout(tick, Math.min(2_147_483_647, Math.max(delay, retryAt - Date.now())));
    }

    async function tick() {
      if (!canPoll() || request) return;
      if (Date.now() < retryAt) {
        schedule(0);
        return;
      }
      const controller = new AbortController();
      request = controller;
      let more = false;
      try {
        const { status, headers, activity, more: morePages } = await runPoll(controller.signal);
        if (controller.signal.aborted) return;
        if (status === 401 || status === 403 || status === 404) {
          stopped = true;
          reportStop(status);
          return;
        }
        if (status === 429) retryAt = Date.now() + retryAfterDelay(headers?.get("Retry-After") ?? null);
        if (status === 304 || (status >= 200 && status < 300)) {
          more = morePages === true;
          failures = 0;
          retryAt = 0;
          const advertised = Number(headers?.get("X-Poll-Interval"));
          if (Number.isFinite(advertised) && advertised > 0) serverIntervalMs = advertised;
          if (activity) lastActivity = Date.now();
        } else failures++;
      } catch {
        if (!controller.signal.aborted) failures++;
      } finally {
        request = undefined;
        // If the tab resumed during an abort, queue its immediate refresh now.
        const delay = refreshPending || more ? 0 : interval();
        refreshPending = false;
        schedule(delay);
      }
    }

    function wake() {
      if (request) refreshPending ||= request.signal.aborted;
      else schedule(0);
    }

    function pause() {
      clearTimeout(timer);
      request?.abort();
      refreshPending = false;
    }

    function visibilityChanged() {
      if (canPoll()) wake();
      else pause();
    }

    function unfocused() {
      if (!request) schedule(interval());
    }

    refresh.current = () => {
      if (request) refreshPending = true;
      else wake();
    };
    document.addEventListener("visibilitychange", visibilityChanged);
    window.addEventListener("focus", wake);
    window.addEventListener("blur", unfocused);
    window.addEventListener("online", wake);
    window.addEventListener("offline", pause);
    wake();
    return () => {
      stopped = true;
      pause();
      refresh.current = () => {};
      document.removeEventListener("visibilitychange", visibilityChanged);
      window.removeEventListener("focus", wake);
      window.removeEventListener("blur", unfocused);
      window.removeEventListener("online", wake);
      window.removeEventListener("offline", pause);
    };
  }, [resource, mode]);

  return useCallback(() => refresh.current(), []);
}
