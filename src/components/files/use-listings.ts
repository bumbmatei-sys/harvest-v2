"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { OfficeApiError, type Failure } from "@/lib/office/mail";
import type { DriveItem, FilesApi } from "@/lib/office/files";

export type ListingRequest = { key: string; connectionId: string; folderRef?: string; search?: string };
export type Listing = { status: "loading" | "ready" | "error" | "gone" | Failure; items: DriveItem[]; nextCursor: string | null; partial: boolean; loadingMore: boolean; moreFailed: boolean };
const loading: Listing = { status: "loading", items: [], nextCursor: null, partial: false, loadingMore: false, moreFailed: false };
const failed = (status: Listing["status"]): Listing => ({ ...loading, status });

/**
 * Live provider listings, one per request key. A new request set starts every listing over; a non-null cursor is followed even from an empty page; rows are
 * de-duplicated by reference. A 404 (a missing folder, another person's connection) is `gone`. Nothing is stored beyond component state.
 */
export function useListings(api: FilesApi, requests: readonly ListingRequest[]) {
  const signature = JSON.stringify(requests);
  const [state, setState] = useState<{ signature: string; listings: Record<string, Listing> }>({ signature: "", listings: {} });
  const [nonce, setNonce] = useState(0);
  const patch = useCallback((forSignature: string, key: string, change: (current: Listing) => Listing) =>
    setState((current) => current.signature !== forSignature ? current : { ...current, listings: { ...current.listings, [key]: change(current.listings[key] ?? loading) } }), []);

  useEffect(() => {
    const list = JSON.parse(signature) as ListingRequest[];
    const controller = new AbortController();
    void Promise.resolve().then(() => {
      if (controller.signal.aborted) return;
      setState({ signature, listings: Object.fromEntries(list.map((request) => [request.key, loading])) });
      for (const request of list) void (async () => {
        try {
          const result = await api.files(request.connectionId, { ...(request.folderRef ? { folderRef: request.folderRef } : {}), ...(request.search ? { search: request.search } : {}), limit: 50 }, controller.signal);
          if (controller.signal.aborted) return;
          patch(signature, request.key, () => result.state === "available"
            ? { status: "ready", items: result.data.items, nextCursor: result.data.nextCursor ?? null, partial: result.data.partial === true, loadingMore: false, moreFailed: false }
            : failed(result.state));
        } catch (error) {
          if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) return;
          patch(signature, request.key, () => failed(error instanceof OfficeApiError && error.unavailable ? "gone" : "error"));
        }
      })();
    });
    return () => controller.abort();
  }, [api, signature, nonce, patch]);

  const loadMore = useCallback(async (key: string) => {
    const list = JSON.parse(signature) as ListingRequest[];
    const request = list.find((item) => item.key === key), current = state.listings[key];
    if (!request || !current?.nextCursor || current.loadingMore) return;
    patch(signature, key, (listing) => ({ ...listing, loadingMore: true, moreFailed: false }));
    try {
      const result = await api.files(request.connectionId, { ...(request.folderRef ? { folderRef: request.folderRef } : {}), ...(request.search ? { search: request.search } : {}), cursor: current.nextCursor, limit: 50 });
      patch(signature, key, (listing) => {
        if (result.state !== "available") return { ...listing, loadingMore: false, moreFailed: true };
        const seen = new Set(listing.items.map((item) => item.ref));
        return { status: "ready", items: [...listing.items, ...result.data.items.filter((item) => !seen.has(item.ref))], nextCursor: result.data.nextCursor ?? null, partial: listing.partial || result.data.partial === true, loadingMore: false, moreFailed: false };
      });
    } catch { patch(signature, key, (listing) => ({ ...listing, loadingMore: false, moreFailed: true })); }
  }, [api, signature, state.listings, patch]);

  const retry = useCallback(() => setNonce((value) => value + 1), []);
  const listings = useMemo(() => state.signature === signature ? state.listings : {}, [state, signature]);
  return { listings, loadMore, retry };
}
