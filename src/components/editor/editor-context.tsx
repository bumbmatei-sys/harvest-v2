"use client";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { editorContextKey, type EditorContext, type EditorContextData } from "@/lib/editor-context";

type Registered = { token: symbol; context: EditorContext } | null;
type Register = (token: symbol, context: EditorContext | null) => void;
const ActiveContext = createContext<EditorContext | null>(null);
const RegisterContext = createContext<Register | null>(null);

/**
 * Holds the editor context a page registers (shell slice 3a). Mounted by AppShell only when the shell-modes flag is on; without it
 * `useEditorHosted()` is false and every editor renders its in-page layout exactly as before.
 */
export function EditorProvider({ children }: { children: React.ReactNode }) {
  const [registered, setRegistered] = useState<Registered>(null);
  // Clearing needs the token of the page that registered, so a late cleanup from a previous page cannot remove the next page's context.
  const register = useCallback<Register>((token, context) => {
    setRegistered((current) => context ? { token, context } : current?.token === token ? null : current);
  }, []);
  const active = useMemo(() => registered?.context ?? null, [registered]);
  return <RegisterContext.Provider value={register}><ActiveContext.Provider value={active}>{children}</ActiveContext.Provider></RegisterContext.Provider>;
}

/** The registered editor context, or null (also null when there is no provider). Read by the sidebar. */
export const useEditorSidebar = () => useContext(ActiveContext);
/** True when the shell can show the editing sidebar, so the editor drops its own step list. */
export const useEditorHosted = () => useContext(RegisterContext) !== null;

/**
 * A page registers its editor context. `data` is compared by value (it is plain data), `onStep` may change on every render. Registers on
 * mount and when the data changes; clears on unmount. Pass null to register nothing. Returns whether the shell is hosting the context.
 */
export function useEditorContext(data: EditorContextData | null, onStep: (id: string) => void) {
  const register = useContext(RegisterContext);
  const [token] = useState(() => Symbol("editor-context"));
  const latest = useRef(onStep);
  useLayoutEffect(() => { latest.current = onStep; });
  const key = data ? editorContextKey(data) : null;
  useEffect(() => {
    if (!register) return;
    register(token, key === null ? null : { ...(JSON.parse(key) as EditorContextData), onStep: (id) => latest.current(id) });
  }, [register, key, token]);
  useEffect(() => () => register?.(token, null), [register, token]);
  return register !== null;
}
