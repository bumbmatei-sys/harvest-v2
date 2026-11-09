"use client";
import { useEffect } from "react";
import { applyTheme } from "@/lib/theme";

/** Keep device/storage preferences live even while mobile sidebar controls are unmounted. */
export function ThemeRuntime() {
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const refresh = () => applyTheme();
    window.addEventListener("storage", refresh);
    media.addEventListener("change", refresh);
    // Reconcile changes between the pre-paint bootstrap and hydration.
    refresh();
    return () => { window.removeEventListener("storage", refresh); media.removeEventListener("change", refresh); };
  }, []);
  return null;
}
