import { navModes, type NavMode } from "./navigation";

/** Per-user last explicit mode choice; a convenience only, never required. */
export const modeStorageKey = "harvest.shell.mode";

export function parseMode(value: unknown): NavMode | null {
  return typeof value === "string" && (navModes as readonly string[]).includes(value) ? value as NavMode : null;
}
export function readStoredMode(storage?: Pick<Storage, "getItem">): NavMode | null {
  try { return parseMode((storage ?? window.localStorage).getItem(modeStorageKey)); } catch { return null; }
}
export function writeStoredMode(mode: NavMode, storage?: Pick<Storage, "setItem">) {
  try { (storage ?? window.localStorage).setItem(modeStorageKey, mode); } catch { /* private window or blocked storage */ }
}

// External store for the remembered choice: storage first, an in-memory copy when storage is blocked, so the choice still holds for the session.
let remembered: NavMode | null = null;
const listeners = new Set<() => void>();
export function rememberMode(mode: NavMode) { remembered = mode; writeStoredMode(mode); listeners.forEach((listener) => listener()); }
export function modeSnapshot(): NavMode | null { return readStoredMode() ?? remembered; }
export function subscribeMode(listener: () => void) {
  listeners.add(listener); window.addEventListener("storage", listener);
  return () => { listeners.delete(listener); window.removeEventListener("storage", listener); };
}

/** Modes the viewer can open, in the fixed switcher order. */
export function availableModes(availability: Record<NavMode, boolean>): NavMode[] {
  return navModes.filter((mode) => availability[mode]);
}
/**
 * The mode whose sidebar is shown. A transient `peek` (the user tapped a mode on a page that owns its path) wins over the page's
 * own mode but only on the page it was made on, so it never outlives a navigation; a mode with no visible entries is never shown.
 */
export function displayMode({ derived, peek, pathname, available }: { derived: NavMode; peek: { mode: NavMode; pathname: string } | null; pathname: string; available: readonly NavMode[] }): NavMode {
  const wanted = peek && peek.pathname === pathname ? peek.mode : derived;
  return available.includes(wanted) ? wanted : available[0] ?? derived;
}

/** Ctrl/Cmd+Alt+1..3 picks Operations, Public, Assistant. Uses `code` because Alt changes `key` on some layouts. */
export function modeForShortcut(event: Pick<KeyboardEvent, "ctrlKey" | "metaKey" | "altKey" | "shiftKey" | "code">): NavMode | null {
  if (!(event.ctrlKey || event.metaKey) || !event.altKey || event.shiftKey) return null;
  const match = /^Digit([1-3])$/.exec(event.code);
  return match ? navModes[Number(match[1]) - 1] : null;
}
