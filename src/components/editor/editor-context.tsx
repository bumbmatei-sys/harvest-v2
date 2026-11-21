"use client";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { editorContextKey, type EditorContext, type EditorContextData } from "@/lib/editor-context";

type Registered = { token: symbol; context: EditorContext } | null;
type Register = (token: symbol, context: EditorContext | null) => void;
/**
 * A page-owned contextual sidebar (Inbox): the shell swaps its whole sidebar for a frame (back arrow, title) and the page portals its own panel into the
 * frame's slot, so the panel's state stays in the page. Plain data only, like the editor context.
 */
export type ContextualSpec = { title: string; back: { href: string; label: string }; label: string };
type PortalRegistered = { token: symbol; spec: ContextualSpec } | null;
type PortalState = { spec: ContextualSpec | null; slot: HTMLElement | null; setSlot: (element: HTMLElement | null) => void };
const PortalContext = createContext<PortalState>({ spec: null, slot: null, setSlot: () => {} });
type RegisterPortal = (token: symbol, spec: ContextualSpec | null) => void;
const RegisterPortalContext = createContext<RegisterPortal | null>(null);
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
  const [portal, setPortal] = useState<PortalRegistered>(null), [slot, setSlot] = useState<HTMLElement | null>(null);
  const registerPortal = useCallback<RegisterPortal>((token, spec) => {
    setPortal((current) => spec ? { token, spec } : current?.token === token ? null : current);
  }, []);
  const portalState = useMemo(() => ({ spec: portal?.spec ?? null, slot, setSlot }), [portal, slot]);
  return <RegisterContext.Provider value={register}><RegisterPortalContext.Provider value={registerPortal}><PortalContext.Provider value={portalState}>
    <ActiveContext.Provider value={active}>{children}</ActiveContext.Provider></PortalContext.Provider></RegisterPortalContext.Provider></RegisterContext.Provider>;
}

/** Read by the shell: the registered contextual sidebar (or null), its slot element and the slot ref callback. */
export const useContextualPortal = () => useContext(PortalContext);
/**
 * A page asks for the contextual sidebar. Returns `{ hosted, slot }`: `hosted` is false without the shell-modes flag (the page then renders its panel
 * inline, exactly as before); `slot` is the element to portal the panel into, null until the shell has drawn the frame (and on a closed phone drawer).
 */
export function useContextualSidebar(spec: ContextualSpec | null) {
  const register = useContext(RegisterPortalContext), { slot } = useContext(PortalContext);
  const [token] = useState(() => Symbol("contextual-sidebar"));
  const key = spec ? JSON.stringify(spec) : null;
  useEffect(() => {
    if (!register) return;
    register(token, key === null ? null : JSON.parse(key) as ContextualSpec);
  }, [register, key, token]);
  useEffect(() => () => register?.(token, null), [register, token]);
  // Hosted only while a spec is registered: a page that asks for nothing (null) must keep rendering its panel inline.
  return { hosted: register !== null && spec !== null, slot };
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
