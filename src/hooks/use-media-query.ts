"use client"
import { useSyncExternalStore } from "react"

/** Matches a media query on the client; the server and the first render report false. */
export function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (callback) => {
      const media = window.matchMedia(query)
      media.addEventListener("change", callback)
      return () => media.removeEventListener("change", callback)
    },
    () => window.matchMedia(query).matches,
    () => false
  )
}
