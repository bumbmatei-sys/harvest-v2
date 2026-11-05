import { expect, it } from "vitest";
import { testDatabase } from "../database";
import { getProfile, updateProfile } from "../../src/server/profile";

it("persists a supported locale for the verified user and rejects account injection", async () => {
  const fixture = await testDatabase();
  try {
    await fixture.admin.query("insert into users (id, name, email) values ('profile-a', 'A', 'profile-a@example.test'), ('profile-b', 'B', 'profile-b@example.test')");
    expect((await getProfile(fixture.db, "profile-a")).locale).toBeNull();
    await updateProfile(fixture.db, "profile-a", { locale: "en" });
    expect((await getProfile(fixture.db, "profile-a")).locale).toBe("en");
    expect((await getProfile(fixture.db, "profile-b")).locale).toBeNull();
    expect(() => updateProfile(fixture.db, "profile-a", { locale: "fr" })).toThrow();
    expect(() => updateProfile(fixture.db, "profile-a", { locale: "en", userId: "profile-b" })).toThrow();
    await updateProfile(fixture.db, "profile-a", { locale: null });
    expect((await getProfile(fixture.db, "profile-a")).locale).toBeNull();
    await expect(updateProfile(fixture.db, "", { locale: "en" })).rejects.toThrow("Sign in");
  } finally { await fixture.close(); }
});
