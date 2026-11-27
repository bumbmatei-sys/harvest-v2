import { expect, it } from "vitest";
import { unsubscribeTokenFromHash } from "../../src/lib/community-unsubscribe";
import { signUnsubscribe } from "../../src/lib/community-email-token";
import { emailFrequencies, defaultPrefs } from "../../src/lib/notifications";

// C15c: the confirmation page reads the token from the fragment only, and rejects anything that cannot be a token.
it("reads a token from the fragment and nothing else", () => {
  const token = signUnsubscribe("test-secret-that-is-long-enough", { tenantId: "t", communityId: "c", userId: "u" });
  expect(unsubscribeTokenFromHash(`#token=${token}`)).toBe(token);
  expect(unsubscribeTokenFromHash(`token=${token}`)).toBe(token);
  expect(unsubscribeTokenFromHash(`#other=1&token=${token}`)).toBe(token);
  for (const bad of ["", "#", "#token=", "#token=abc", "#token=a.b.c", "#token=<script>.x", `#token=${"a".repeat(400)}.${"b".repeat(250)}`, `#${"x".repeat(800)}`])
    expect(unsubscribeTokenFromHash(bad)).toBeNull();
});

it("offers the four email frequencies with important as the default", () => {
  expect(emailFrequencies).toEqual(["off", "important", "daily", "weekly"]);
  expect(defaultPrefs.email).toBe("important");
});
