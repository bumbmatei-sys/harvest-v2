"use client"
import { useSyncExternalStore } from "react"
const MOBILE_QUERY = "(max-width: 1023px)"
function subscribe(callback: () => void) {
  const media = window.matchMedia(MOBILE_QUERY)
  media.addEventListener("change", callback)
  return () => media.removeEventListener("change", callback)
}
export function useIsMobile() {
  return useSyncExternalStore(subscribe, () => window.matchMedia(MOBILE_QUERY).matches, () => false)
}
