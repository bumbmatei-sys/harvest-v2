"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { OfficeApiError, type Connected, type Failure, type OfficePlatform, type Pending } from "@/lib/office/mail";

const pollMs = 3000;
export type ConnectPhase = { name: "idle" } | { name: "starting"; platform: OfficePlatform } | { name: "pending"; platform: OfficePlatform; attemptId: string; url: string | null; until: number } | { name: "failed" } | { name: "refused" };

/**
 * The hosted connection handoff shared by every Office area: the person's choice of provider starts an attempt, a hosted authorisation URL opens in a new tab and
 * is held in memory only, and the page polls the same signed-in account until the attempt connects, fails or expires. Nothing here knows the area.
 */
export function useConnectAttempt({ start, finish, onConnected }: {
  start: (platform: OfficePlatform) => Promise<Pending | { state: Failure }>;
  finish: (attemptId: string) => Promise<Connected | { state: "pending" | "failed" }>;
  onConnected: () => void;
}) {
  const [phase, setPhase] = useState<ConnectPhase>({ name: "idle" });
  const done = useRef(onConnected);
  useEffect(() => { done.current = onConnected; });

  const begin = useCallback(async (platform: OfficePlatform) => {
    setPhase({ name: "starting", platform });
    try {
      const result = await start(platform);
      if (result.state !== "pending") { setPhase({ name: "refused" }); return; }
      const pending = result as Pending;
      if (pending.url) window.open(pending.url, "_blank", "noopener,noreferrer");
      setPhase({ name: "pending", platform, attemptId: pending.attemptId, url: pending.url, until: Date.parse(pending.expiresAt) });
    } catch { setPhase({ name: "refused" }); }
  }, [start]);

  const attemptId = phase.name === "pending" ? phase.attemptId : null, until = phase.name === "pending" ? phase.until : 0;
  useEffect(() => {
    if (!attemptId) return;
    let stopped = false, timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (stopped) return;
      try {
        const result = await finish(attemptId);
        if (stopped) return;
        if (result.state === "connected") { setPhase({ name: "idle" }); done.current(); return; }
        if (result.state === "failed" || (Number.isFinite(until) && Date.now() > until)) { setPhase({ name: "failed" }); return; }
      } catch (error) {
        if (stopped) return;
        // A dropped request keeps waiting; a refusal ends the attempt.
        if (!(error instanceof OfficeApiError) || error.status === 0) { timer = setTimeout(tick, pollMs); return; }
        setPhase({ name: "failed" }); return;
      }
      timer = setTimeout(tick, pollMs);
    };
    timer = setTimeout(tick, 0);
    return () => { stopped = true; clearTimeout(timer); };
  }, [finish, attemptId, until]);

  return { phase, begin, cancel: () => setPhase({ name: "idle" }) };
}
