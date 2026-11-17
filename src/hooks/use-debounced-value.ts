"use client"
import { useEffect, useRef, useState } from "react"
import { createDebouncer } from "@/lib/editor-preview"

/** The value after it has stopped changing for `wait` ms; the first value is returned at once. */
export function useDebouncedValue<T>(value: T, wait = 150) {
  const [settled, setSettled] = useState(value)
  const debouncer = useRef<ReturnType<typeof createDebouncer<T>> | null>(null)
  useEffect(() => { debouncer.current = createDebouncer<T>(setSettled, wait); return () => debouncer.current?.cancel() }, [wait])
  useEffect(() => { debouncer.current?.push(value) }, [value])
  return settled
}
