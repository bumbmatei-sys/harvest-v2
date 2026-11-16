import "server-only";
import { FakeFilesProvider } from "./fake-provider";
import { ZernioFilesAdapter } from "./zernio-adapter";
export const INTEGRATION_ENABLED = false;
/** Explicit test factory; defaults never hand out a fake or an enabled adapter. */
export const getFilesProvider = (mode: "test" | "disabled" = "disabled") => mode === "test" ? new FakeFilesProvider() : new ZernioFilesAdapter();
