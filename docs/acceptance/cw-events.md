# Campaign events

Founder approval (26 Nov 2026): link the existing ministry events to a campaign, make the dashboard's events figure real, and let the
"Create initial outreach events" checklist item tick itself.

## Delivered
- Migration `0118_campaign_events` (tentative number; 0116 and 0117 are held by other open work): table `campaign_event_links`
  (tenant, campaign, event; cascades with either side; RLS enabled and forced; no app grant) and the SECURITY DEFINER entry
  `public.campaign_events_operate(tenant, campaign, action, event)` with actions `list`, `candidates`, `link`, `unlink`. It sets the
  Events definer settings like `events_operate` and restores them. Roles come from `public.access_role` (0113 guard), never `role_id`.
- Permissions, both sides:
  - campaigns area: caller must be able to write campaigns (owner/admin/member or a collaborator with campaigns manage); the campaign
    must be in the caller's own session ministry;
  - Events (communities area): owners/admins see every linked event (drafts included) and alone may add or remove one; anyone else sees
    only linked events that are published and that Events already shows them (`public.events_sources`). A campaign never reveals an
    event Events would hide, and an Events manager who cannot write campaigns does not reach a campaign's events.
- Server `src/server/campaign-events.ts`: `listCampaignEvents`, `campaignEventCandidates`, `setCampaignEvent` (idempotent; audited
  `campaign.event.link` / `campaign.event.unlink`; the event itself is never changed, published or announced). Everything is off
  (null / 404) while Events is off.
- Dashboard: `CampaignOverview.events` is the count of linked events the viewer can see; "events" leaves the unavailable list once
  Events is on. Checklist: `create_events` is automatic when the campaign shows the viewer at least one event.
- API: `GET|PUT /api/workspaces/:id/campaigns/:campaignId/events` (`{ eventId, linked }`).
- UI: campaign page "Events" card using the shared Events `EventCard` (extended: `href` optional, so viewers without an event screen
  get the same card, not a link), the shared `SearchableSelect` to add an event, a remove button, and a "New event" link to the
  existing Events editor. No second events system and no new kit items. 44px tap targets on phones; theme tokens only.

## Evidence (author-executed)
- `tests/integration/cw-campaign-events.test.ts`: 5 tests (link/unlink, candidates, audit, event unchanged, dashboard figure and
  checklist; viewer-relative visibility for non-managers; denials for member/collaborators/viewer/outsider, other-ministry event and
  campaign, unknown ids; no direct table access; cross-tenant call refused; cascade on campaign delete; RLS forced; Events off).
- `tests/integration/campaign-wizard.test.ts` updated: the overview no longer lists events as unavailable while Events is on.

## Not included
- A campaign filter on the Events list and an "add to campaign" control on the event editor (the campaign page is the one place).
- Calendar week/day views (separate PR). Production migration not applied; Events stays off in production.
