/**
 * Hand-maintained subset of the generated Supabase types.
 * Regenerate with `pnpm db:types` once a project is linked; this file exists so
 * the packages typecheck before any Supabase project is provisioned.
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

interface Table<Row, Insert = Partial<Row>, Update = Partial<Row>> {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
}

export interface WorkspaceRow {
  id: string;
  name: string;
  slug: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  plan: string;
  trial_ends_at: string | null;
  data_retention_days: number;
  created_at: string;
}

export interface ProfileRow {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  timezone: string;
  created_at: string;
}

export interface MembershipRow {
  id: string;
  workspace_id: string;
  user_id: string;
  role: MembershipRole;
  created_at: string;
}

export interface LinkedinAccountRow {
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
  working_hours: Json;
  created_at: string;
}

export interface BusinessProfileRow {
  id: string;
  workspace_id: string;
  website_url: string | null;
  linkedin_company_url: string | null;
  spec: Json;
  approved_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CustomerProfileRow {
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
}

export interface ProspectRow {
  id: string;
  workspace_id: string;
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
}

export interface CampaignRow {
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
  launched_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CampaignStepRow {
  id: string;
  workspace_id: string;
  campaign_id: string;
  step_number: number;
  delay_days: number;
  message: string;
}

export interface CampaignProspectRow {
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
  created_at: string;
  updated_at: string;
}

export interface ConversationRow {
  id: string;
  workspace_id: string;
  prospect_id: string;
  linkedin_account_id: string;
  campaign_id: string | null;
  provider_chat_id: string | null;
  last_message_at: string | null;
  needs_human: boolean;
  needs_human_reason: string | null;
  created_at: string;
}

export interface MessageRow {
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
}

export interface ReplyDraftRow {
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
}

export interface MeetingRow {
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
}

export interface IntegrationRow {
  id: string;
  workspace_id: string;
  kind: IntegrationKind;
  user_id: string | null;
  external_account_id: string | null;
  credentials_encrypted: string | null;
  config: Json;
  status: string;
  created_at: string;
}

export interface KnowledgeDocumentRow {
  id: string;
  workspace_id: string;
  title: string;
  content: string;
  source: string | null;
  created_at: string;
}

export interface EventRow {
  id: number;
  workspace_id: string;
  name: string;
  actor_user_id: string | null;
  subject_type: string | null;
  subject_id: string | null;
  payload: Json;
  created_at: string;
}

export interface LlmCallRow {
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
}

export interface Database {
  public: {
    Tables: {
      workspaces: Table<WorkspaceRow>;
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
      integrations: Table<IntegrationRow>;
      knowledge_documents: Table<KnowledgeDocumentRow>;
      events: Table<EventRow>;
      llm_calls: Table<LlmCallRow>;
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      membership_role: MembershipRole;
      linkedin_account_status: LinkedinAccountStatus;
      campaign_status: CampaignStatus;
      campaign_prospect_status: CampaignProspectStatusDb;
      message_direction: MessageDirection;
      message_source: MessageSource;
      reply_mode: ReplyModeDb;
      integration_kind: IntegrationKind;
    };
    CompositeTypes: Record<string, never>;
  };
}
