"use client";
import { useEffect, useState, useSyncExternalStore, type CSSProperties } from "react";

const query = "(prefers-reduced-motion: reduce)";
/** The system setting, read live. The server and the first render report false. */
export function useReducedMotion() {
  return useSyncExternalStore(
    (callback) => { const media = window.matchMedia(query); media.addEventListener("change", callback); return () => media.removeEventListener("change", callback); },
    () => window.matchMedia(query).matches,
    () => false);
}

export type Entrance = {
  /** True only for the first render of data in this visit, and never when the system asks for reduced motion. */
  animate: boolean;
  /** For the page root: `waiting` (skeletons), `playing`, `done`, or `off` (reduced motion). Tests read it to know the entrance has settled. */
  phase: "waiting" | "playing" | "done" | "off";
};
const playMs = 1000;

/**
 * Once per visit: the entrance plays when `ready` first becomes true and is over `playMs` later. Later data (a background refresh, a new range or scope)
 * never replays it, and with reduced motion it never plays at all.
 */
export function useEntrance(ready: boolean): Entrance {
  const reduced = useReducedMotion();
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!ready || reduced || done) return;
    const timer = setTimeout(() => setDone(true), playMs);
    return () => clearTimeout(timer);
  }, [ready, reduced, done]);
  const animate = ready && !reduced && !done;
  return { animate, phase: reduced ? "off" : done ? "done" : ready ? "playing" : "waiting" };
}

/** A short fade and rise, staggered by position. Plain CSS; no animation library is involved. */
export function enter(animate: boolean, index: number): { className?: string; style?: CSSProperties } {
  return animate ? { className: "animate-in fade-in slide-in-from-bottom-2 duration-300 fill-mode-backwards", style: { animationDelay: `${Math.min(index, 8) * 60}ms` } } : {};
}
