export interface ScanInput { key: string; mime: string; size: number; checksum: string }
export interface FileScanner {
  scan(file: ScanInput): Promise<"clean" | "infected" | "skipped">;
}
/** This is a development foundation, not a malware verdict. Public uploads fail closed. */
export const noOpScanner: FileScanner = { async scan() { return "skipped"; } };
