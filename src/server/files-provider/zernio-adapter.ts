import type { FilesProvider } from "./port";
import { OfficeProviderError } from "../office-provider/types";
export const ZERNIO_LIVE_NETWORK = false;
/** No transport, credentials, OAuth client or network access exists in this adapter. */
export class ZernioFilesAdapter implements FilesProvider {
  listAccounts: FilesProvider["listAccounts"] = async () => { throw new OfficeProviderError("DISABLED"); };
  listFiles: FilesProvider["listFiles"] = async () => { throw new OfficeProviderError("DISABLED"); };
  upload: FilesProvider["upload"] = async () => { throw new OfficeProviderError("DISABLED"); };
  download: FilesProvider["download"] = async () => { throw new OfficeProviderError("DISABLED"); };
  share: FilesProvider["share"] = async () => { throw new OfficeProviderError("DISABLED"); };
}
