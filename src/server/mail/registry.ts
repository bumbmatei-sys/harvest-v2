import { FakeMailProvider } from "./fake-provider";
import { ZernioMailAdapter } from "./zernio-adapter";
export const INTEGRATION_ENABLED = false;
/** Explicit test factory; defaults never hand out a fake or an enabled adapter. */
export const getMailProvider = (mode: "test" | "disabled" = "disabled") => mode === "test" ? new FakeMailProvider() : new ZernioMailAdapter();
