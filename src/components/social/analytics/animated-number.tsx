"use client";
import { lazy, Suspense } from "react";

// `motion` is imported only by count-up.tsx and only fetched while an entrance plays; the fallback shows the starting value, so nothing jumps.
const CountUp = lazy(() => import("./count-up"));

/** A number that counts up once during the entrance and is plain text otherwise (background refreshes, reduced motion, after the entrance). */
export function AnimatedNumber({ value, animate, format, className }: { value: number; animate: boolean; format: (value: number) => string; className?: string }) {
  if (!animate) return <span className={className}>{format(value)}</span>;
  return <Suspense fallback={<span className={className}>{format(0)}</span>}><CountUp number={value} format={format} className={className} /></Suspense>;
}
