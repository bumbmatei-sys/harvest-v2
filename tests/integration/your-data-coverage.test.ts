import { afterAll, beforeAll, expect, it } from "vitest";
import { testDatabase } from "../database";

let fixture: Awaited<ReturnType<typeof testDatabase>>;
beforeAll(async () => { fixture = await testDatabase(); }, 120_000);
afterAll(async () => { await fixture?.close(); });

// These columns are covered by the subject's export, the Connect subject-rights
// capability, or the export request count. The catalog also catches SQL-only tables.
const exported = {
    account_export_requests: "user_id",
    blog_posts: "created_by",
    catalog_enrolments: "user_id",
    catalog_notes: "user_id",
    catalog_progress: "user_id",
    community_applications: "user_id",
    community_challenge_members: "user_id",
    community_comments: "author_id",
    community_dm_messages: "author_id",
    community_dm_participants: "user_id",
    community_files: "uploader_id",
    community_likes: "user_id",
    community_member_profiles: "user_id",
    community_memberships: "user_id",
    community_message_reactions: "user_id",
    community_messages: "author_id",
    community_point_attendance: "user_id",
    community_points_hidden_members: "user_id",
    community_posts: "author_id",
    connect_claim_completions: "user_id",
    connect_response_subjects: "user_id",
    entitlements: "user_id",
    event_rsvps: "user_id",
    ministry_donation_receipts: "donor_id",
    ministry_payment_intents: "payer_id",
    response_account_claims: "user_id",
    sessions: "user_id",
    user_profiles: "user_id",
    volunteer_assignments: "user_id",
    volunteer_availability: "user_id",
    volunteer_requests: "replacement_user_id user_id",
    volunteers: "user_id",
    workspace_members: "user_id",
    workspace_ownership_offers: "from_user_id to_user_id",
};

const reviewedNotExported = {
  // Authentication, access controls and internal accountability records.
    account_deletions: "user_id",
    account_erase_grants: "user_id",
    accounts: "user_id",
    ai_tool_approvals: "requested_by",
    audit_logs: "actor_id",
    platform_staff: "user_id",
    workspace_member_access: "granted_by user_id",
  // Ministry social and advertising operations. Actor references record staff actions and grant no ownership of source records.
    ads_accounts: "created_by",
    ads_audience_uploads: "requested_by",
    ads_conversion_sends: "requested_by",
    ads_form_publications: "published_by",
    ads_launch_requests: "created_by reviewed_by",
    ads_lead_forms: "created_by",
    ads_operations: "actor_id",
    ads_rules: "created_by",
    social_approval_notices: "recipient_user_id",
    social_approval_settings: "updated_by",
    social_approvals: "decided_by requested_by",
    social_connections: "created_by",
    social_drafts: "created_by review_by",
    social_inbox_notes: "author_id",
    social_inbox_replies: "actor_id",
    social_posts: "created_by",
    social_schedules: "created_by",
  // Ministry publishing or collaboration records. Creator, editor and access references may identify staff or collaborators.
    bio_files: "uploader_id",
    bio_pages: "created_by",
    blog_posts: "scheduled_by updated_by",
    blog_settings: "created_by",
    catalog_items: "created_by",
    doc_attachments: "attached_by",
    doc_comments: "assignee_id author_id resolved_by",
    doc_favorites: "user_id",
    doc_folders: "owner_id",
    doc_links: "created_by",
    doc_notifications: "actor_id user_id",
    doc_page_shares: "created_by user_id",
    doc_page_versions: "created_by",
    doc_pages: "created_by updated_by",
    doc_shares: "created_by user_id",
    doc_templates: "created_by updated_by",
    docs: "owner_id",
  // Shared ministry records and operational actor references. Exporting the source row could disclose another person’s data.
    campaign_boards: "created_by",
    campaign_budget_lines: "created_by",
    campaign_checklist_items: "done_by",
    campaign_draft_assignments: "user_id",
    campaign_draft_invitations: "accepted_by created_by user_id",
    campaign_drafts: "created_by",
    campaign_event_links: "created_by",
    campaign_expenses: "recorded_by",
    campaign_files: "uploader_id",
    campaign_followup_team: "user_id",
    campaign_milestones: "created_by reached_by",
    campaign_response_consents: "recorded_by",
    campaign_response_links: "created_by published_by",
    campaign_tasks: "completed_by created_by",
    campaigns: "owner_user_id",
    communities: "created_by",
    connect_landing_versions: "published_by",
    entitlements: "granted_by revoked_by",
    event_files: "uploader_id",
    events: "created_by",
    form_versions: "created_by published_by",
    forms: "created_by",
    fundraising_campaigns: "created_by",
    fundraising_files: "uploader_id",
    fundraising_pages: "created_by",
    fundraising_pledges: "created_by",
    giving_contact_links: "created_by",
    giving_ledger_entries: "confirmed_by",
    giving_methods: "created_by",
    giving_reports: "resolved_by",
    giving_standing: "changed_by",
    privacy_notice_versions: "created_by",
    workspace_invitations: "accepted_by created_by",
    workspaces: "created_by",
  // Community operations, moderation, delivery and counterpart references. Subject-authored content is projected separately.
    community_appeals: "decided_by user_id",
    community_applications: "decided_by",
    community_channel_members: "added_by user_id",
    community_channel_reads: "user_id",
    community_channels: "created_by",
    community_comments: "removed_by",
    community_dm_blocks: "blocked_id blocker_id",
    community_dm_conversations: "last_sender_id staff_engaged_by started_by",
    community_dm_messages: "deleted_by",
    community_email_deliveries: "recipient_id",
    community_exits: "user_id",
    community_invites: "created_by redeemed_by",
    community_live_events: "created_by",
    community_messages: "deleted_by pinned_by",
    community_moderation_actions: "actor_id subject_user_id",
    community_notifications: "actor_id recipient_id",
    community_posts: "removed_by",
    community_reports: "decided_by reporter_id",
    community_warnings: "issued_by user_id",
    discover_controls: "updated_by",
    discover_reports: "reporter_id",
  // Ministry CRM or newsletter records. Staff and contact identities are part of a ministry-controlled record.
    companies: "created_by",
    contact_company_links: "created_by",
    contact_consents: "recorded_by",
    contacts: "form_owner_id",
    crm_associations: "created_by",
    crm_deal_stage_moves: "moved_by",
    crm_field_definitions: "created_by",
    crm_field_values: "updated_by",
    crm_form_publications: "published_by",
    crm_form_responses: "owner_id",
    crm_imports: "created_by",
    crm_notes: "created_by",
    crm_notification_preferences: "user_id",
    crm_notifications: "actor_user_id recipient_user_id",
    crm_pipeline_stages: "created_by",
    crm_pipelines: "created_by",
    crm_saved_views: "created_by owner_user_id",
    crm_tasks: "assignee_user_id created_by",
    crm_webhook_endpoints: "created_by",
    newsletter_audiences: "created_by",
    newsletter_automations: "created_by",
    newsletter_campaigns: "created_by",
    newsletter_import_provenance: "created_by",
    newsletter_lists: "created_by",
    newsletter_segments: "created_by",
    newsletter_signup_forms: "created_by",
    newsletter_subscribers: "created_by",
    opportunities: "created_by owner_user_id",
  // Connected provider records and external or shared mailbox participants. Credentials and remote references are excluded.
    office_calendar_events: "owner_user_id",
    office_connect_attempts: "owner_user_id",
    office_connections: "owner_user_id",
    office_contact_references: "owner_user_id",
    office_thread_markers: "owner_user_id",
};

function subjects(mapping: Record<string, string>) {
  return Object.entries(mapping).flatMap(([table, columns]) => columns.split(" ").map(column => `${table}.${column}`));
}

it("requires an export or a recorded review for every user-linked column", async () => {
  const { rows } = await fixture.admin.query<{ subject_column: string }>(`
SELECT c.relname || '.' || a.attname AS subject_column
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid
WHERE n.nspname = 'public' AND c.relkind IN ('r','p') AND a.attnum > 0 AND NOT a.attisdropped
  AND (a.attname ~ '(^|_)user_id$' OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint f WHERE f.conrelid = c.oid AND f.contype = 'f'
      AND f.confrelid = 'public.users'::regclass AND a.attnum = ANY(f.conkey)))
ORDER BY 1
  `);
  const actual = rows.map(row => row.subject_column);
  const classified = [...subjects(exported), ...subjects(reviewedNotExported)];
  expect(classified.toSorted()).toEqual(actual.toSorted());
});
