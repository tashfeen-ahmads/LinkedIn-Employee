/**
 * Hand-maintained subset of the generated Supabase types.
 *
 * Kept by hand rather than generated: `supabase gen types` emits the `public`
 * schema, and ours is not `public` — see DB_SCHEMA in client.ts. Add a column
 * to a migration and add it here in the same commit, or the query that reads it
 * infers as `never` and the error lands three files away.
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type MembershipRole = "owner" | "admin" | "manager" | "rep";
export type LinkedinAccountStatus =
  | "connecting"
  | "active"
  | "paused"
  | "warning"
  | "restricted"
  | "reauth_required"
  | "disconnected";
export type CampaignStatus = "draft" | "running" | "paused" | "completed" | "archived";
export type CampaignProspectStatusDb =
  | "queued"
  | "invited"
  | "accepted"
  | "messaged_1"
  | "messaged_2"
  | "messaged_3"
  | "replied"
  | "positive"
  | "negative"
  | "meeting_booked"
  | "closed"
  | "opted_out"
  | "failed";
export type MessageDirection = "outbound" | "inbound";
export type MessageSource = "human" | "agent";
export type ReplyModeDb = "approval" | "autopilot";
export type IntegrationKind =
  | "hubspot"
  | "salesforce"
  | "google_calendar"
  | "microsoft_calendar"
  | "slack"
  | "webhook";

type Table<Row, Insert = Partial<Row>, Update = Partial<Row>> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

export type SubscriptionStatus = "active" | "trialing" | "past_due" | "canceled" | "unpaid";

/** Mirrors the exclusion_kind enum; the matching rules live in @le/shared. */
export type ExclusionKindDb = "company" | "person";

export type WorkspaceRow = {
  id: string;
  name: string;
  slug: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  plan: string;
  trial_ends_at: string | null;
  subscription_status: SubscriptionStatus | null;
  seats: number;
  current_period_end: string | null;
  data_retention_days: number;
  created_at: string;
};

export type InvitationRow = {
  id: string;
  workspace_id: string;
  email: string;
  role: MembershipRole;
  token: string;
  invited_by: string | null;
  expires_at: string;
  accepted_at: string | null;
  accepted_by: string | null;
  revoked_at: string | null;
  created_at: string;
};

export type ExclusionRow = {
  id: string;
  workspace_id: string;
  kind: ExclusionKindDb;
  value: string;
  raw_value: string;
  reason: string | null;
  created_by: string | null;
  created_at: string;
};

export type BillingEventRow = {
  id: string;
  workspace_id: string | null;
  type: string;
  stripe_created_at: string | null;
  payload: Json;
  processed_at: string;
};

export type ProfileRow = {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  timezone: string;
  created_at: string;
};

export type MembershipRow = {
  id: string;
  workspace_id: string;
  user_id: string;
  role: MembershipRole;
  created_at: string;
};

export type LinkedinAccountRow = {
  id: string;
  workspace_id: string;
  user_id: string;
  provider: string;
  provider_account_id: string | null;
  linkedin_member_id: string | null;
  display_name: string | null;
  profile_url: string | null;
  has_sales_navigator: boolean;
  status: LinkedinAccountStatus;
  status_detail: string | null;
  connected_at: string | null;
  paused_at: string | null;
  invites_today: number;
  invites_this_week: number;
  messages_today: number;
  counters_reset_on: string | null;
  last_action_at: string | null;
  /** Day zero of the warm-up ramp. Null until the account has sent anything. */
  first_action_at: string | null;
  working_hours: Json;
  created_at: string;
};

export type BusinessProfileRow = {
  id: string;
  workspace_id: string;
  website_url: string | null;
  linkedin_company_url: string | null;
  spec: Json;
  approved_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type CustomerProfileRow = {
  id: string;
  workspace_id: string;
  business_profile_id: string;
  name: string;
  spec: Json;
  priority: number;
  do_not_pursue: boolean;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ProspectRow = {
  id: string;
  workspace_id: string;
  /**
   * The strategy whose search found this person, or null for anybody found
   * before the link existed or imported by hand.
   *
   * Single-valued by construction rather than by simplification: targeting
   * excludes everyone the workspace already knows, so the first strategy to
   * reach a person is the only one that ever can.
   */
  customer_profile_id: string | null;
  linkedin_url: string;
  provider_id: string | null;
  first_name: string | null;
  last_name: string | null;
  headline: string | null;
  title: string | null;
  company: string | null;
  company_size: string | null;
  industry: string | null;
  location: string | null;
  about: string | null;
  fit_score: number | null;
  fit_reasons: Json;
  intent_score: number | null;
  signals: Json;
  owner_user_id: string | null;
  last_contacted_at: string | null;
  do_not_contact: boolean;
  do_not_contact_reason: string | null;
  crm_contact_id: string | null;
  created_at: string;
  updated_at: string;
};

export type CampaignRow = {
  id: string;
  workspace_id: string;
  customer_profile_id: string | null;
  linkedin_account_id: string;
  owner_user_id: string;
  name: string;
  status: CampaignStatus;
  connection_note: string;
  daily_invite_cap: number;
  reply_mode: ReplyModeDb;
  rules: Json;
  stop_conditions: Json;
  /** Where the prospect search had got to, so it can be continued. Opaque. */
  search_cursor: string | null;
  /** The search has no more people to give — not merely none new this run. */
  search_exhausted: boolean;
  searched_at: string | null;
  launched_at: string | null;
  created_at: string;
  updated_at: string;
};

export type CampaignStepRow = {
  id: string;
  workspace_id: string;
  campaign_id: string;
  step_number: number;
  delay_days: number;
  message: string;
};

export type CampaignProspectRow = {
  id: string;
  workspace_id: string;
  campaign_id: string;
  prospect_id: string;
  status: CampaignProspectStatusDb;
  status_reason: string | null;
  invitation_id: string | null;
  invited_at: string | null;
  accepted_at: string | null;
  last_step_sent: number;
  next_action_at: string | null;
  replied_at: string | null;
  closed_at: string | null;
  /**
   * The connection note written for this one person. Null falls back to the
   * campaign's template, which is what every campaign created before this
   * existed does.
   */
  invite_note: string | null;
  invite_note_prompt_version: string | null;
  /** Which of the prospect's own details the note leaned on. */
  invite_note_grounding: string[];
  /** The model said this prospect's details were too thin to be specific. */
  invite_note_thin: boolean;
  /** A human rewrote it; the agent must not overwrite it. */
  invite_note_edited: boolean;
  created_at: string;
  updated_at: string;
};

export type ConversationRow = {
  id: string;
  workspace_id: string;
  prospect_id: string;
  linkedin_account_id: string;
  campaign_id: string | null;
  provider_chat_id: string | null;
  last_message_at: string | null;
  needs_human: boolean;
  needs_human_reason: string | null;
  /** Why it is waiting: a reply to approve, or a meeting to book by hand. */
  needs_human_kind: "reply" | "booking" | null;
  created_at: string;
};

export type MessageRow = {
  id: string;
  workspace_id: string;
  conversation_id: string;
  direction: MessageDirection;
  source: MessageSource;
  body: string;
  provider_message_id: string | null;
  classification: Json | null;
  prompt_version: string | null;
  approved_by: string | null;
  sent_at: string | null;
  created_at: string;
};

export type ReplyDraftRow = {
  id: string;
  workspace_id: string;
  conversation_id: string;
  in_reply_to: string | null;
  body: string;
  proposes_meeting: boolean;
  proposed_slots: Json;
  unanswered_questions: Json;
  prompt_version: string;
  status: string;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
};

export type MeetingRow = {
  id: string;
  workspace_id: string;
  prospect_id: string;
  conversation_id: string | null;
  rep_user_id: string;
  starts_at: string;
  ends_at: string;
  calendar_event_id: string | null;
  meeting_url: string | null;
  brief: Json | null;
  crm_event_id: string | null;
  status: string;
  created_at: string;
  /** The name and address the prospect gave for the invitation, if they booked it. */
  attendee_name: string | null;
  attendee_email: string | null;
  /** "agent" when a reply accepted an offered time, "link" from the booking page. */
  booked_via: string;
  cancelled_at: string | null;
  cancel_reason: string | null;
};

/** One rep's booking rules. See migration 0012. */
export type AvailabilityRow = {
  id: string;
  workspace_id: string;
  user_id: string;
  timezone: string;
  working_hours: Json;
  meeting_minutes: number;
  min_notice_hours: number;
  buffer_minutes: number;
  max_per_day: number;
  location: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * Time the rep is not available. Without an external calendar to read, this is
 * the only thing between a prospect and a double booking.
 */
export type AvailabilityBlackoutRow = {
  id: string;
  workspace_id: string;
  user_id: string;
  starts_at: string;
  ends_at: string;
  reason: string | null;
  created_at: string;
};

/** One link, one prospect. The token is the whole authorisation. */
export type BookingLinkRow = {
  id: string;
  workspace_id: string;
  rep_user_id: string;
  prospect_id: string;
  conversation_id: string | null;
  token: string;
  expires_at: string;
  meeting_id: string | null;
  used_at: string | null;
  revoked_at: string | null;
  created_at: string;
};

/**
 * A published .ics address, and how the last read of it went. See migration
 * 0013. `url_encrypted` is a bearer credential: the web app must never select
 * it, and nothing may log it.
 */
export type CalendarFeedRow = {
  id: string;
  workspace_id: string;
  user_id: string;
  url_encrypted: string;
  url_host: string;
  status: string;
  last_synced_at: string | null;
  last_error: string | null;
  event_count: number;
  created_at: string;
  updated_at: string;
};

/** Busy intervals the last successful read of a feed produced. */
export type CalendarFeedBusyRow = {
  id: string;
  workspace_id: string;
  user_id: string;
  feed_id: string;
  starts_at: string;
  ends_at: string;
};

export type IntegrationRow = {
  id: string;
  workspace_id: string;
  kind: IntegrationKind;
  user_id: string | null;
  external_account_id: string | null;
  credentials_encrypted: string | null;
  config: Json;
  status: string;
  created_at: string;
};

export type KnowledgeDocumentRow = {
  id: string;
  workspace_id: string;
  title: string;
  content: string;
  source: string | null;
  created_at: string;
};

export type EventRow = {
  id: number;
  workspace_id: string;
  name: string;
  actor_user_id: string | null;
  subject_type: string | null;
  subject_id: string | null;
  payload: Json;
  created_at: string;
};

/**
 * The last run of a worker loop, so its silence can be told from its absence.
 *
 * Deployment-wide rather than tenanted, and holding no customer data: it exists
 * so a member can see whether the thing that sends their messages is alive.
 */
export type WorkerHeartbeatRow = {
  name: string;
  beat_at: string;
  detail: Json;
};

export type LlmCallRow = {
  id: number;
  workspace_id: string | null;
  agent: string;
  model: string;
  prompt_version: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  latency_ms: number | null;
  cost_usd: number | null;
  subject_type: string | null;
  subject_id: string | null;
  error: string | null;
  created_at: string;
};

export type Database = {
  // Keyed by the schema the tables actually live in (see DB_SCHEMA in
  // client.ts). Not `public`: this deployment shares its Supabase project with
  // an unrelated product that already owns that schema's `memberships`,
  // `conversations` and `messages`.
  le: {
    Tables: {
      workspaces: Table<WorkspaceRow>;
      billing_events: Table<BillingEventRow>;
      invitations: Table<InvitationRow>;
      exclusions: Table<ExclusionRow>;
      profiles: Table<ProfileRow>;
      memberships: Table<MembershipRow>;
      linkedin_accounts: Table<LinkedinAccountRow>;
      business_profiles: Table<BusinessProfileRow>;
      customer_profiles: Table<CustomerProfileRow>;
      prospects: Table<ProspectRow>;
      campaigns: Table<CampaignRow>;
      campaign_steps: Table<CampaignStepRow>;
      campaign_prospects: Table<CampaignProspectRow>;
      conversations: Table<ConversationRow>;
      messages: Table<MessageRow>;
      reply_drafts: Table<ReplyDraftRow>;
      meetings: Table<MeetingRow>;
      availability: Table<AvailabilityRow>;
      availability_blackouts: Table<AvailabilityBlackoutRow>;
      booking_links: Table<BookingLinkRow>;
      calendar_feeds: Table<CalendarFeedRow>;
      calendar_feed_busy: Table<CalendarFeedBusyRow>;
      integrations: Table<IntegrationRow>;
      knowledge_documents: Table<KnowledgeDocumentRow>;
      events: Table<EventRow>;
      llm_calls: Table<LlmCallRow>;
      worker_heartbeats: Table<WorkerHeartbeatRow>;
    };
    // `{ [_ in never]: never }` and not `Record<string, never>`: an index
    // signature here intersects with Tables and collapses every row type to
    // `never`. This is the idiom the Supabase generator emits.
    Views: { [_ in never]: never };
    Functions: {
      record_linkedin_action: {
        Args: { p_account_id: string; p_kind: "invite" | "message" };
        Returns: { invites_today: number; invites_this_week: number; messages_today: number }[];
      };
      /**
       * Creates a workspace and the caller's owner membership together, and
       * returns the new id. Two writes rather than one because a workspace is
       * only visible to its members: inserted from the client, the row cannot
       * be read back — not even by whoever just created it.
       */
      create_workspace: {
        Args: { p_name: string; p_slug: string; p_full_name?: string | null };
        Returns: string;
      };
      /** Whether the caller is a platform administrator. */
      is_platform_admin: {
        Args: Record<string, never>;
        Returns: boolean;
      };
      /**
       * Per-workspace counts for the tables an operator may not read row by
       * row — prospects and conversations hold other people's personal data.
       * Returns nothing at all for a caller who is not an admin.
       */
      platform_workspace_stats: {
        Args: Record<string, never>;
        Returns: {
          workspace_id: string;
          prospects: number;
          conversations: number;
          pending_drafts: number;
          messages_sent: number;
        }[];
      };
    };
    Enums: {
      membership_role: MembershipRole;
      linkedin_account_status: LinkedinAccountStatus;
      campaign_status: CampaignStatus;
      campaign_prospect_status: CampaignProspectStatusDb;
      message_direction: MessageDirection;
      message_source: MessageSource;
      reply_mode: ReplyModeDb;
      integration_kind: IntegrationKind;
      subscription_status: SubscriptionStatus;
      exclusion_kind: ExclusionKindDb;
    };
    CompositeTypes: { [_ in never]: never };
  };
};
