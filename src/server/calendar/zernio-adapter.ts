import type { CalendarProvider } from "./port";
import { OfficeProviderError } from "../office-provider/types";
export const ZERNIO_LIVE_NETWORK = false;
/** No transport, credentials, OAuth client or network access exists in this adapter. */
export class ZernioCalendarAdapter implements CalendarProvider {
  listAccounts: CalendarProvider["listAccounts"] = async () => { throw new OfficeProviderError("DISABLED"); };
  listEvents: CalendarProvider["listEvents"] = async () => { throw new OfficeProviderError("DISABLED"); };
  createEvent: CalendarProvider["createEvent"] = async () => { throw new OfficeProviderError("DISABLED"); };
  updateEvent: CalendarProvider["updateEvent"] = async () => { throw new OfficeProviderError("DISABLED"); };
  deleteEvent: CalendarProvider["deleteEvent"] = async () => { throw new OfficeProviderError("DISABLED"); };
  rsvp: CalendarProvider["rsvp"] = async () => { throw new OfficeProviderError("DISABLED"); };
  findFreeTime: CalendarProvider["findFreeTime"] = async () => { throw new OfficeProviderError("DISABLED"); };
}
