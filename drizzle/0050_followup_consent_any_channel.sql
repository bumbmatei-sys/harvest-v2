-- Consent withdrawal follow-ups (migration 0050). Aligns the HC-13 follow-up consent recheck with the send-time rule `mayContact` (HC-DEC1b,
-- src/server/consent-gate.ts): for the follow-up purpose a withdrawal on ANY channel blocks opening, assigning and attempting while it is
-- outstanding (strict withdrawal), whereas a grant must still be the effective event on the response's own channel. Before this, a withdrawal
-- only counted on the response's channel, so a person who withdrew by SMS could still have an email case opened or attempted.
-- Only the withdrawal lookup changes: the `AND w.channel = g.channel` predicate is removed. Every other line of the 0048 body, the invoker
-- rights, the search_path pin and the privileges are unchanged (CREATE OR REPLACE keeps the owner and grants; the REVOKE is repeated so the
-- migration is re-runnable). No table, trigger, policy or grant changes; the schema snapshot is unchanged.
CREATE OR REPLACE FUNCTION public.followup_consent_effective(p_tenant uuid, p_response uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.campaign_responses r
    JOIN public.campaign_response_consents g ON g.tenant_id = r.tenant_id AND g.response_id = r.id AND g.purpose = 'outreach_follow_up'
      AND g.status = 'granted' AND g.redacted_at IS NULL AND g.channel IS NOT NULL
    WHERE r.tenant_id = p_tenant AND r.id = p_response AND r.status = 'associated' AND r.contact_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.campaign_response_consents w WHERE w.tenant_id = r.tenant_id AND w.response_id = r.id
        AND w.purpose = 'outreach_follow_up' AND w.status = 'withdrawn')
      AND NOT EXISTS (SELECT 1 FROM public.contact_consents w WHERE w.tenant_id = r.tenant_id AND w.contact_id = r.contact_id
        AND w.purpose = 'outreach_follow_up' AND w.status = 'withdrawn' AND w.redacted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM public.contact_consents n WHERE n.tenant_id = w.tenant_id AND n.contact_id = w.contact_id
          AND n.channel = w.channel AND n.purpose = w.purpose AND n.status = 'granted' AND n.redacted_at IS NULL
          AND n.recorded_at > w.recorded_at AND n.occurred_at > w.occurred_at))
      AND (SELECT l.status FROM public.contact_consents l WHERE l.tenant_id = r.tenant_id AND l.contact_id = r.contact_id
        AND l.purpose = 'outreach_follow_up' AND l.channel = g.channel AND l.redacted_at IS NULL
        ORDER BY l.recorded_at DESC, l.occurred_at DESC, l.id DESC LIMIT 1) = 'granted')
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.followup_consent_effective(uuid, uuid) FROM PUBLIC;
