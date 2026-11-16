export type Credential = { readonly secret: string };
export type ConnectionKind = "mail" | "calendar" | "files";
export type Account = { ref: string };
export type Query = { accountRef: string; search?: string; cursor?: string; limit?: number };
export type Page<T> = { items: T[]; nextCursor: string | null };
export class OfficeProviderError extends Error {
  constructor(public readonly code: "DISABLED" | "AUTH" | "INVALID_REQUEST" | "NOT_FOUND" | "CONFLICT" | "RATE_LIMITED") { super(code); }
}
export interface AccountProvider { listAccounts(credential: Credential): Promise<Account[]> }
