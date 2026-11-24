// Pure helpers of the Docs list: folder paths, subtree ids, list URLs.
export type FolderLike = { id: string; parentId: string | null; name: string };

/** The folders from the top level down to `id` (empty for the top level or an unknown id). */
export function folderPath(folders: readonly FolderLike[], id: string | null | undefined): FolderLike[] {
  const out: FolderLike[] = []; let cur = id ?? null, guard = 0;
  while (cur && guard++ < 70) { const f = folders.find((x) => x.id === cur); if (!f) break; out.unshift(f); cur = f.parentId; }
  return out;
}
/** A folder and every folder below it (a folder cannot be moved into any of these). */
export function folderSubtree(folders: readonly FolderLike[], id: string): string[] {
  const out = [id];
  for (let i = 0; i < out.length; i++) for (const f of folders) if (f.parentId === out[i] && !out.includes(f.id)) out.push(f.id);
  return out;
}
export type ListView = { folder?: string | null; q?: string; status?: "active" | "archived" | "trash"; sort?: "updated" | "title"; favorites?: boolean };
export function docsHref(tenantId: string, view: ListView = {}) {
  const params = new URLSearchParams();
  if (view.folder) params.set("folder", view.folder);
  if (view.q) params.set("q", view.q);
  if (view.status && view.status !== "active") params.set("status", view.status);
  if (view.sort && view.sort !== "updated") params.set("sort", view.sort);
  if (view.favorites) params.set("favorites", "1");
  const query = params.toString();
  return `/workspaces/${tenantId}/docs${query ? `?${query}` : ""}`;
}
export const docHref = (tenantId: string, docId: string, pageId?: string) => `/workspaces/${tenantId}/docs/${docId}${pageId ? `?page=${pageId}` : ""}`;
