import type { Database } from "../db/client";
import { paramsToState, sameState, stateToParams, type ObjectType, type RawParams, type ViewState } from "../lib/crm-fields";
import { listViews, type SavedView } from "./crm-views";
import { AccessError } from "./permissions";

/** Why the list fell back to the default view, if it did. */
export type ViewNotice = "viewUnavailable" | "invalidView" | null;
const stateKeys = ["q", "sort", "f", "cols", "density", "company", "email", "marketing", "people", "domain"];

export function toRawParams(params: URLSearchParams): RawParams {
  const raw: RawParams = {};
  for (const key of new Set(params.keys())) { const all = params.getAll(key); raw[key] = all.length > 1 ? all : all[0]; }
  return raw;
}

/**
 * Resolve what a list shows from the URL. A `view` id alone applies that saved view;
 * explicit parameters win over it (the URL is the source of truth). A missing, foreign
 * or unauthorized view, or any state the tenant's fields no longer support, falls back
 * to the default view as a whole, with a notice: never half-applied, never leaking.
 */
export async function resolveListView<T extends { state: ViewState }>(db: Database, userId: string, tenantId: string, objectType: ObjectType, raw: RawParams, writable: boolean, load: (params: RawParams) => Promise<T>) {
  const views = await listViews(db, userId, tenantId, objectType, { writable });
  const fallback = views[0];
  const parsed = paramsToState(objectType, raw);
  let notice: ViewNotice = null, current: SavedView = fallback, state = fallback.state, page = 1, viewId: string | null = null;
  if (!parsed) notice = "invalidView";
  else {
    const view = parsed.view ? views.find((item) => item.id === parsed.view) : undefined;
    if (parsed.view && !view) notice = "viewUnavailable";
    else {
      current = view ?? fallback; viewId = view?.id ?? null; page = parsed.page;
      state = view && !stateKeys.some((key) => raw[key] !== undefined) ? view.state : parsed.state;
    }
  }
  const request = (next: ViewState, nextPage: number) => {
    const params = stateToParams(next);
    if (nextPage > 1) params.set("page", String(nextPage));
    return load(toRawParams(params));
  };
  let list: T;
  try { list = await request(state, page); }
  catch (error) {
    if (!(error instanceof AccessError && error.details?.reason === "invalid_view")) throw error;
    notice = "invalidView"; current = fallback; viewId = null; page = 1;
    list = await request(fallback.state, 1);
  }
  return { list, views, current, viewId, notice, modified: !sameState(list.state, current.state), query: stateToParams(list.state, viewId).toString() };
}
