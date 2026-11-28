import { createHash } from "node:crypto";

export const receiptHash = (token: string) => createHash("sha256").update(token).digest("hex");
