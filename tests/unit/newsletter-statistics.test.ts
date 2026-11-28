import { expect, it } from "vitest";
import { statisticsPoint } from "../../src/server/newsletter-campaigns/statistics";

it("keeps zero, suppressed counts and uncollected opens distinct", () => {
  expect(statisticsPoint({ sent: 5, delivered: 5, bounced: 0, complained: 0, unsubscribed: 0 }, 0))
    .toEqual({ sends: 5, opens: null, clicks: 0, unsubscribes: 0 });
  expect(statisticsPoint(null, null)).toEqual({ sends: null, opens: null, clicks: null, unsubscribes: null });
});
