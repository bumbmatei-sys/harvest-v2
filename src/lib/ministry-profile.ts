import { z } from "zod";

const label = (length: number) => z.string().trim().min(1).max(length).refine(text => !/[\p{Cc}]/u.test(text));
const httpsUrl = z.url({ protocol: /^https$/ }).max(2048).refine(value => {
  const url = new URL(value);
  return !url.username && !url.password;
});
export const profileVisibility = z.enum(["public", "members", "staff"]);
function field<T extends z.ZodType>(value: T) {
  return z.strictObject({ value, visibility: profileVisibility.default("staff") }).nullable().optional();
}

export const profileImageField = z.enum(["logo", "cover"]);
export const profileFields = z.strictObject({
  name: field(label(100)),
  description: field(z.string().trim().min(1).max(800)),
  logo: field(z.uuid()),
  cover: field(z.uuid()),
  tradition: field(label(100)),
  website: field(httpsUrl),
  email: field(z.email().max(254)),
  phone: field(label(40)),
  socialLinks: field(z.array(z.strictObject({ label: label(40), url: httpsUrl })).max(12)),
  serviceTimes: field(z.array(label(160)).max(20)),
});

export const locationInput = z.strictObject({
  id: z.uuid().optional(),
  name: label(120),
  address1: label(180),
  address2: label(180).nullable().default(null),
  city: label(100),
  region: label(100).nullable().default(null),
  postalCode: label(32).nullable().default(null),
  country: label(100),
  serviceTimes: z.array(label(160)).max(20).default([]),
  primary: z.boolean(),
  visibility: profileVisibility.default("staff"),
});

export const saveMinistryProfileInput = z.strictObject({
  version: z.number().int().min(0).max(2_147_483_646),
  published: z.boolean().optional(),
  fields: profileFields.optional(),
  locations: z.array(locationInput).max(30).refine(items =>
    (items.length === 0 || items.filter(item => item.primary).length === 1) &&
    new Set(items.flatMap(item => item.id ?? [])).size === items.filter(item => item.id).length
  ).optional(),
});

type Address = Pick<z.infer<typeof locationInput>, "address1" | "address2" | "city" | "region" | "postalCode" | "country">;
export function ministryMapsLink(address: Address) {
  const url = new URL("https://www.google.com/maps/search/");
  url.search = new URLSearchParams({ api: "1", query: [
    address.address1, address.address2, address.city, address.region, address.postalCode, address.country,
  ].filter(Boolean).join(", ") }).toString();
  return url.href;
}
