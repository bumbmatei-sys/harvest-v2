/** Derived from bumbmatei-sys/admin-dashboard (Shadcn UI Kit, premium, founder-supplied): components/ui/custom/count-animation.tsx. Harvest changes: docs/ui-sources.md. */
"use client";

import { useEffect } from "react";
import { motion, useMotionValue, useTransform, animate } from "motion/react";

// The only file that imports the animation library. It is loaded on demand by animated-number.tsx, so no other route and no public page carries it.
export default function CountUp({ number, format, className }: { number: number; format: (value: number) => string; className?: string }) {
  const count = useMotionValue(0);
  const text = useTransform(count, (latest) => format(Math.round(latest)));

  useEffect(() => {
    const animation = animate(count, number, { duration: 0.4, ease: "easeOut" });

    return animation.stop;
  }, [count, number]);

  return <motion.span className={className}>{text}</motion.span>;
}
