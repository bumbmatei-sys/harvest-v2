import { message } from "../../i18n/messages";
import { AccessError } from "../permissions";
import { InvalidStoredFile, type StorageAdapter } from "../storage/adapter";
import type { ScanInput } from "./scanner";

export async function inspectCommunityUpload(storage: StorageAdapter, file: ScanInput & { name: string }) {
  try {
    const actual = await storage.inspect(file.key, file);
    if (actual.size !== file.size || actual.mime !== file.mime || actual.checksum !== file.checksum) {
      throw new InvalidStoredFile(message("Errors.uploadVerificationFailed"));
    }
    return "uploaded" as const;
  } catch (error) {
    if (!(error instanceof InvalidStoredFile)) {
      throw new AccessError(409, message("Errors.uploadIsUnavailableFinishUploadingAndRetryConfirmation"));
    }
    return "quarantined" as const;
  }
}
