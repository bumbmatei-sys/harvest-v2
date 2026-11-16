import { OfficeProviderError, type Credential, type Query, type Page } from "./types";
/** Synthetic data only. Each instance models one personal connection; all results are defensive copies. */
export class FakeStore {
  private counter = 0;
  private keys = new Map<string, { fingerprint: string; value: unknown }>();
  constructor(readonly accounts: readonly string[] = ["account-1"], private readonly secret = "fake-credential") {}
  authorize(c: Credential, account?: string) {
    if (c.secret !== this.secret) throw new OfficeProviderError("AUTH");
    if (account !== undefined && !this.accounts.includes(account)) throw new OfficeProviderError("NOT_FOUND");
  }
  async listAccounts(c: Credential) { this.authorize(c); return this.accounts.map(ref => ({ ref })); }
  id(prefix: string) { return `${prefix}-${++this.counter}`; }
  once<T>(account: string, method: string, key: string, input: unknown, run: () => T): T {
    if (!key) throw new OfficeProviderError("INVALID_REQUEST");
    const composite = JSON.stringify([account, method, key]), fingerprint = JSON.stringify(input), old = this.keys.get(composite);
    if (old) { if (old.fingerprint !== fingerprint) throw new OfficeProviderError("CONFLICT"); return structuredClone(old.value) as T; }
    const value = run(); this.keys.set(composite, { fingerprint, value: structuredClone(value) }); return structuredClone(value);
  }
  page<T>(values: T[], q: Query): Page<T> {
    const start = q.cursor === undefined ? 0 : Number(q.cursor), limit = q.limit ?? 25;
    if (!Number.isSafeInteger(start) || start < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new OfficeProviderError("INVALID_REQUEST");
    return { items: structuredClone(values.slice(start, start + limit)), nextCursor: start + limit < values.length ? String(start + limit) : null };
  }
  get<T>(map: Map<string, T>, account: string, ref: string): T {
    const v = map.get(JSON.stringify([account, ref])); if (!v) throw new OfficeProviderError("NOT_FOUND"); return v;
  }
  key(account: string, ref: string) { return JSON.stringify([account, ref]); }
}
