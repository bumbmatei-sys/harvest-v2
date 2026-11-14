/**
 * HC-DEC1: the ONE registry of consent purposes. Pure data, no UI, safe on server and client.
 *
 * Every TypeScript list of purposes (staff ledger input, Connect-offered purposes, Connect-to-CRM projection,
 * CRM association purposes, event contracts) is derived from this table, so a new purpose (referrals, events) is
 * one entry here plus the database migration that widens the matching check constraints and Connect functions.
 * `tests/unit/consent-purposes.test.ts` and `tests/integration/consent-purposes-drift.test.ts` fail while the
 * registry, `src/db/schema.ts` and the live database constraints disagree, so neither side can drift silently.
 *
 * Rules the registry cannot loosen (each is also enforced in the database and tested):
 * - a purpose is never granted unless it is offered and explicitly selected; nothing is inferred from another purpose;
 * - every purpose is withdrawn on its own; the latest ledger state wins;
 * - `legacy_unspecified` is stored history only: nobody can write it and nothing it records satisfies any check.
 */
type Flags = {
  /** Allowed in the CRM ledger (`contact_consents.purpose` check). */
  readonly ledger: boolean;
  /** Staff may record it through the API (`recordConsent`). */
  readonly staffRecordable: boolean;
  /** A published Connect form version may offer it to a guest (`form_versions.offered_purposes`). */
  readonly connectOffered: boolean;
  /** A Connect grant/withdrawal is copied to the CRM ledger on association (`connect-immutable` provenance). */
  readonly connectCrmProjected: boolean;
  /** A CRM association (`crm_associations.purpose`) may be recorded under it. */
  readonly association: boolean;
};
const purpose = <F extends Flags>(flags: F) => flags;

// Entry order is the order of the ledger check constraint; derived lists keep this order.
export const consentPurposeRegistry = {
  marketing: purpose({ ledger: true, staffRecordable: true, connectOffered: false, connectCrmProjected: false, association: false }),
  outreach_follow_up: purpose({ ledger: true, staffRecordable: true, connectOffered: true, connectCrmProjected: true, association: false }),
  event_administration: purpose({ ledger: true, staffRecordable: true, connectOffered: false, connectCrmProjected: false, association: false }),
  account_communications: purpose({ ledger: true, staffRecordable: true, connectOffered: true, connectCrmProjected: false, association: false }),
  legacy_unspecified: purpose({ ledger: true, staffRecordable: false, connectOffered: false, connectCrmProjected: false, association: false }),
  messaging: purpose({ ledger: true, staffRecordable: true, connectOffered: false, connectCrmProjected: false, association: true }),
  form_follow_up: purpose({ ledger: true, staffRecordable: true, connectOffered: false, connectCrmProjected: false, association: true }),
  newsletter: purpose({ ledger: true, staffRecordable: true, connectOffered: true, connectCrmProjected: true, association: true }),
} as const;

export type ConsentPurpose = keyof typeof consentPurposeRegistry;
type FlagName = keyof Flags;
type PurposesWith<F extends FlagName> = { [P in ConsentPurpose]: typeof consentPurposeRegistry[P][F] extends true ? P : never }[ConsentPurpose];

/** The purposes whose flag is set, in registry order. Non-empty by construction for every flag used below. */
export function purposesWith<F extends FlagName>(flag: F): [PurposesWith<F>, ...PurposesWith<F>[]] {
  const list = (Object.keys(consentPurposeRegistry) as ConsentPurpose[]).filter((key) => consentPurposeRegistry[key][flag]);
  if (!list.length) throw new Error("CONSENT_PURPOSE_REGISTRY_EMPTY");
  return list as [PurposesWith<F>, ...PurposesWith<F>[]];
}

/** Every purpose the CRM ledger accepts, including stored legacy history. */
export const ledgerPurposes = purposesWith("ledger");
/** Purposes staff can record. */
export const staffConsentPurposes = purposesWith("staffRecordable");
/** Purposes a Connect form version may offer; each is its own unchecked opt-in. */
export const connectOfferedPurposes = purposesWith("connectOffered");
/** Connect purposes that are copied to the CRM ledger (the rest stay response-scoped). */
export const connectProjectedPurposes = purposesWith("connectCrmProjected");
/** Purposes a CRM association may be recorded under. */
export const associationConsentPurposes = purposesWith("association");

/** The Connect purpose cap for one submission, from the registry (the database functions mirror it). */
export const MAX_OFFERED_PURPOSES = connectOfferedPurposes.length;

/** The same list as a SQL `in (...)` body, exactly as the schema check constraints spell it. */
export const purposeSqlList = (list: readonly string[]) => list.map((item) => `'${item}'`).join(", ");
