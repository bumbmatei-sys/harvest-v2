import { FakeCalendarProvider } from "./fake-provider";
import { ZernioCalendarAdapter } from "./zernio-adapter";
export const INTEGRATION_ENABLED = false;
/** Explicit test factory; defaults never hand out a fake or an enabled adapter. */
export const getCalendarProvider = (mode: "test" | "disabled" = "disabled") => mode === "test" ? new FakeCalendarProvider() : new ZernioCalendarAdapter();
