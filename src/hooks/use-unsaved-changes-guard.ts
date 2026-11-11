"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * Shared editor guard (extracted unchanged from the Connect landing editor for reuse by EditorShell consumers).
 * While `guarded` is true, in-app links, Back/Forward and closing the tab ask before leaving.
 * Returns the pending destination for a confirm dialog; set it to null to stay, navigate to it to leave.
 */
export function useUnsavedChangesGuard(guarded: boolean) {
  const [destination, setDestination] = useState<string | null>(null);
  const guardedRef = useRef(guarded);
  useLayoutEffect(() => { guardedRef.current = guarded; }, [guarded]);
  useEffect(() => {
    function unload(event: BeforeUnloadEvent) { if (guardedRef.current) { event.preventDefault(); event.returnValue = ""; } }
    function click(event: MouseEvent) {
      const anchor = event.target instanceof Element ? event.target.closest("a") : null;
      if (!guardedRef.current || !anchor || anchor.target === "_blank" || anchor.hasAttribute("download") || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
      const url = new URL(anchor.href, location.href);
      if (url.href === location.href || (url.pathname === location.pathname && url.search === location.search && url.hash)) return;
      event.preventDefault(); event.stopPropagation(); setDestination(url.href);
    }
    // Navigation API cancels history before the route changes. Older browsers use the
    // capture-phase popstate fallback below; beforeunload protects full-document navigation.
    const navigation = (window as unknown as { navigation?: EventTarget }).navigation;
    function navigate(event: Event) {
      const e = event as Event & { navigationType?: string; destination?: { url: string }; canIntercept?: boolean };
      if (guardedRef.current && e.navigationType === "traverse" && e.cancelable && e.destination) { e.preventDefault(); setDestination(e.destination.url); }
    }
    const editorUrl = location.href, editorState = history.state;
    function pop(event: Event) {
      if (navigation || !guardedRef.current) return;
      const destination = new URL(location.href), editor = new URL(editorUrl);
      if (destination.pathname === editor.pathname && destination.search === editor.search) return;
      // Next has not handled this event yet. Restore the editor's URL/state before
      // asking; explicit Leave navigates to the actual destination, regardless of
      // how many entries Back/Forward traversed. The compatibility fallback replaces
      // the forward branch while preserving the draft and chosen destination.
      event.preventDefault(); history.pushState(editorState, "", editorUrl); setDestination(destination.href);
    }
    window.addEventListener("harvest-before-history", pop);
    window.addEventListener("beforeunload", unload); document.addEventListener("click", click, true); navigation?.addEventListener("navigate", navigate);
    return () => { window.removeEventListener("harvest-before-history", pop); window.removeEventListener("beforeunload", unload); document.removeEventListener("click", click, true); navigation?.removeEventListener("navigate", navigate); };
  }, []);
  /** Confirmed leave: stop guarding, then navigate to the pending destination. */
  function leave() { guardedRef.current = false; if (destination) location.assign(destination); }
  return { destination, setDestination, leave };
}
