import type { MailProvider } from "./port";
import { OfficeProviderError } from "../office-provider/types";
export const ZERNIO_LIVE_NETWORK = false;
/** No transport, credentials, OAuth client or network access exists in this adapter. */
export class ZernioMailAdapter implements MailProvider {
  listAccounts: MailProvider["listAccounts"] = async () => { throw new OfficeProviderError("DISABLED"); };
  listThreads: MailProvider["listThreads"] = async () => { throw new OfficeProviderError("DISABLED"); };
  listMessages: MailProvider["listMessages"] = async () => { throw new OfficeProviderError("DISABLED"); };
  send: MailProvider["send"] = async () => { throw new OfficeProviderError("DISABLED"); };
  reply: MailProvider["reply"] = async () => { throw new OfficeProviderError("DISABLED"); };
  forward: MailProvider["forward"] = async () => { throw new OfficeProviderError("DISABLED"); };
  saveDraft: MailProvider["saveDraft"] = async () => { throw new OfficeProviderError("DISABLED"); };
  deleteDraft: MailProvider["deleteDraft"] = async () => { throw new OfficeProviderError("DISABLED"); };
  listDrafts: MailProvider["listDrafts"] = async () => { throw new OfficeProviderError("DISABLED"); };
  listLabels: MailProvider["listLabels"] = async () => { throw new OfficeProviderError("DISABLED"); };
  setLabels: MailProvider["setLabels"] = async () => { throw new OfficeProviderError("DISABLED"); };
  getSendCap: MailProvider["getSendCap"] = async () => { throw new OfficeProviderError("DISABLED"); };
}
