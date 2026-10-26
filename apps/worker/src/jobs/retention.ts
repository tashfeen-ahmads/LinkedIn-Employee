import { fetchAllRows, type Db } from "@le/db";
import type { WorkerContext } from "../context.js";
import { recordEvent } from "../context.js";

/**
 * Data retention and erasure.
 *
 * This product stores personal data about people who never signed up for it:
 * names, job titles, employers, and the contents of conversations. Under GDPR
 * that makes the customer a controller and us a processor, and it makes these
 * three operations obligations rather than features.
 */

export interface ErasureResult {
  prospectsDeleted: number;
  messagesDeleted: number;
  meetingsDeleted: number;
}

/**
 * Erases one person on request (GDPR article 17).
 *
 * The prospect row is removed along with everything derived from it, but a
 * tombstone stays behind on the do-not-contact list. Fully forgetting someone
 * who asked not to be contacted would let the next campaign import them again
 * and message them a week later, which is the opposite of what they asked for.
 */
export async function eraseProspect(
  ctx: WorkerContext,
  input: { workspaceId: string; prospectId: string; reason: string },
): Promise<ErasureResult> {
  const { db } = ctx;

  const { data: prospect } = await db
    .from("prospects")
    .select("id, workspace_id, linkedin_url")
    .eq("id", input.prospectId)
    .eq("workspace_id", input.workspaceId)
    .maybeSingle();
  if (!prospect) return { prospectsDeleted: 0, messagesDeleted: 0, meetingsDeleted: 0 };

  const { data: conversations } = await db
    .from("conversations")
    .select("id")
    .eq("workspace_id", input.workspaceId)
    .eq("prospect_id", prospect.id);
  const conversationIds = (conversations ?? []).map((c) => c.id);

  let messagesDeleted = 0;
  if (conversationIds.length) {
    const { data: messages } = await db
      .from("messages")
      .select("id")
      .in("conversation_id", conversationIds);
    messagesDeleted = messages?.length ?? 0;
    await db.from("messages").delete().in("conversation_id", conversationIds);
    await db.from("reply_drafts").delete().in("conversation_id", conversationIds);
  }

  const { data: meetings } = await db
    .from("meetings")
    .select("id")
    .eq("workspace_id", input.workspaceId)
    .eq("prospect_id", prospect.id);

  await db.from("meetings").delete().eq("prospect_id", prospect.id).eq("workspace_id", input.workspaceId);
  await db.from("conversations").delete().eq("prospect_id", prospect.id).eq("workspace_id", input.workspaceId);
  await db.from("campaign_prospects").delete().eq("prospect_id", prospect.id).eq("workspace_id", input.workspaceId);
  // Their own posts' words and our comments on them identify them as surely as a name.
  await db.from("engagement_actions").delete().eq("prospect_id", prospect.id).eq("workspace_id", input.workspaceId);

  // The tombstone: identity reduced to the one fact we must keep.
  await db
    .from("prospects")
    .update({
      first_name: null,
      last_name: null,
      headline: null,
      title: null,
      company: null,
      company_size: null,
      industry: null,
      location: null,
      about: null,
      provider_id: null,
      crm_contact_id: null,
      signals: [] as never,
      fit_reasons: [] as never,
      fit_score: null,
      intent_score: null,
      do_not_contact: true,
      do_not_contact_reason: `erased: ${input.reason}`,
    })
    .eq("id", prospect.id);

  await recordEvent(db, {
    workspaceId: input.workspaceId,
    name: "prospect.opted_out",
    subjectType: "prospect",
    subjectId: prospect.id,
    // Deliberately records no personal data, only that an erasure happened.
    payload: { erased: true, reason: input.reason, messagesDeleted },
  });

  return { prospectsDeleted: 1, messagesDeleted, meetingsDeleted: meetings?.length ?? 0 };
}

/**
 * Deletes prospect data the workspace has held longer than its retention
 * setting and is no longer using. Anyone in an open conversation or with an
 * upcoming meeting is left alone: retention limits are about data nobody needs,
 * not about deleting a deal in progress.
 */
export async function runRetentionSweep(ctx: WorkerContext, now: Date = new Date()): Promise<number> {
  const { db } = ctx;
  const { data: workspaces } = await db.from("workspaces").select("id, data_retention_days");
  let erased = 0;

  for (const workspace of workspaces ?? []) {
    const days = workspace.data_retention_days ?? 365;
    const cutoff = new Date(now.getTime() - days * 86_400_000).toISOString();

    const { data: stale } = await db
      .from("prospects")
      .select("id, created_at, last_contacted_at, do_not_contact")
      .eq("workspace_id", workspace.id)
      .lt("created_at", cutoff)
      .limit(200);

    for (const prospect of stale ?? []) {
      // Already erased down to a tombstone; nothing left to remove.
      if (prospect.do_not_contact) continue;
      // An old row that was messaged recently is not stale. Retention runs
      // from the last contact, or from creation when there never was one.
      if (prospect.last_contacted_at && prospect.last_contacted_at >= cutoff) continue;
      if (await hasLiveActivity(db, workspace.id, prospect.id, now)) continue;

      await eraseProspect(ctx, {
        workspaceId: workspace.id,
        prospectId: prospect.id,
        reason: `retention limit of ${days} days`,
      });
      erased++;
    }
  }

  return erased;
}

async function hasLiveActivity(db: Db, workspaceId: string, prospectId: string, now: Date): Promise<boolean> {
  const { data: upcoming } = await db
    .from("meetings")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("prospect_id", prospectId)
    .gte("starts_at", now.toISOString())
    .limit(1);
  if (upcoming?.length) return true;

  const { data: active } = await db
    .from("campaign_prospects")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("prospect_id", prospectId)
    .not("status", "in", "(closed,opted_out,failed)")
    .limit(1);
  return Boolean(active?.length);
}

/**
 * Bumped whenever a table or a column is added to or removed from the export,
 * so whoever reads a file can tell which shape they are holding.
 */
export const EXPORT_VERSION = 2;

/**
 * What each key in the file is, written into the file itself: an export is
 * read by somebody who has never seen this repo, often months later.
 */
export const EXPORT_README: Record<string, string> = {
  exportVersion: "The shape of this file. Bumped when tables or columns are added or removed.",
  complete: "False when any table stopped short of its end. A false file is not everything.",
  workspace: "The workspace: name, plan, data retention period and the answers given during onboarding. Billing identifiers are left out.",
  members: "Who belongs to the workspace and their role. User ids only; no email, password or sign-in data.",
  memberSettings: "Each member's own settings: timezone and their own scheduling link.",
  linkedinAccounts: "Each member's LinkedIn sending settings: working hours, plan, status. Provider account ids and counters are left out.",
  availability: "Each member's booking settings: timezone, working hours, meeting length, notice and buffers.",
  availabilityBlackouts: "Times a member marked as busy. The product's own calendar treats these as unavailable.",
  calendarFeeds: "Calendar feeds a member connected, by host only. The feed address is a credential and is never exported.",
  businessProfiles: "What the Strategy Agent wrote about this business.",
  customerProfiles: "Strategies (customer profiles): who to search for, their approval, priority and search position.",
  agents: "Agents: the name, voice, model and playbook each brand or product writes with.",
  ctas: "Calls to action: the destinations campaigns point at.",
  pitches: "Offer lines, which agent owns each, and whether a person approved it.",
  hooks: "Opening lines, which agent owns each, and whether a person approved it.",
  knowledgeDocuments: "The product facts agents may quote, and which agent each belongs to (none means every agent).",
  exclusions: "The do-not-contact list of companies and people. Re-import this first: it is a promise made to somebody.",
  campaigns: "Campaigns and their settings.",
  campaignSteps: "Each campaign's follow-up messages and their delays.",
  campaignVariants: "The angles each campaign tests, and the opener and offer attached to each.",
  campaignProspects: "Who is on which campaign, their status, angle and personalised note.",
  prospects: "Everybody this workspace has found or contacted, including when they were last contacted.",
  conversations: "LinkedIn conversations with prospects.",
  messages: "Every message sent and received.",
  meetings: "Meetings booked.",
};

export interface WorkspaceExport {
  exportVersion: number;
  readme: Record<string, string>;
  exportedAt: string;
  /** False when a table stopped short of its end. Never hidden from the file. */
  complete: boolean;
  workspace: unknown;
  members: unknown[];
  memberSettings: unknown[];
  linkedinAccounts: unknown[];
  availability: unknown[];
  availabilityBlackouts: unknown[];
  calendarFeeds: unknown[];
  businessProfiles: unknown[];
  customerProfiles: unknown[];
  agents: unknown[];
  ctas: unknown[];
  pitches: unknown[];
  hooks: unknown[];
  knowledgeDocuments: unknown[];
  exclusions: unknown[];
  campaigns: unknown[];
  campaignSteps: unknown[];
  campaignVariants: unknown[];
  campaignProspects: unknown[];
  prospects: unknown[];
  conversations: unknown[];
  messages: unknown[];
  meetings: unknown[];
}

const WORKSPACE_COLUMNS = "id, name, plan, data_retention_days, onboarding, created_at";
const MEMBER_SETTINGS_COLUMNS = "id, timezone, booking_url";

/**
 * Exactly the columns asked for, and nothing else.
 *
 * PostgREST already returns only what was selected; this says so a second
 * time in the one file whose whole job is deciding what leaves the building.
 * A column list is the line between a member's timezone and their email, or a
 * feed's host and the feed address itself, and a line drawn once is a line
 * one careless `*` away from not being there.
 */
function onlyColumns<T>(rows: T[], columns: string): T[] {
  if (columns.trim() === "*") return rows;
  const keep = columns.split(",").map((c) => c.trim()).filter(Boolean);
  return rows.map((row) => {
    const source = row as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of keep) if (key in source) out[key] = source[key];
    return out as T;
  });
}

type ExportedTable =
  | "prospects"
  | "conversations"
  | "meetings"
  | "campaigns"
  | "messages"
  | "memberships"
  | "linkedin_accounts"
  | "availability"
  | "availability_blackouts"
  | "calendar_feeds"
  | "business_profiles"
  | "customer_profiles"
  | "agents"
  | "ctas"
  | "pitches"
  | "hooks"
  | "knowledge_documents"
  | "exclusions"
  | "campaign_steps"
  | "campaign_variants"
  | "campaign_prospects";

/**
 * Everything a workspace holds, as JSON. Serves both a customer's own
 * portability request and their ability to answer one from a prospect, and
 * carries the configuration and suppression list a business would need to
 * rebuild somewhere else — the do-not-contact list above all, because it is a
 * promise made to somebody and losing it in a move is how it gets broken.
 *
 * Credentials are never included: no OAuth token, no calendar feed address
 * (`url_host` only — rule 19), no provider account id, no billing identifier,
 * no member's email or sign-in data. Columns that could carry one are named
 * explicitly rather than read with `*`, so a secret added to such a table
 * later does not ride out in this file by default.
 *
 * Every query is filtered by `workspace_id` here, because the worker holds the
 * service role and row-level security will not do it.
 *
 * The file is a faithful copy, not a backup the product can restore from.
 * `importWorkspace` (import-workspace.ts) brings back its configuration and
 * suppression list only, unapproved, into the importer's own workspace.
 */
export async function exportWorkspace(ctx: WorkerContext, workspaceId: string): Promise<WorkspaceExport> {
  const { db } = ctx;

  const { data: workspace } = await db
    .from("workspaces")
    .select(WORKSPACE_COLUMNS)
    .eq("id", workspaceId)
    .maybeSingle();

  /**
   * Every table paged to the end.
   *
   * These were plain selects, and PostgREST caps a select at a thousand rows
   * without saying so — to the service role exactly as to anyone else. This
   * file is what answers a subject-access request: a file described as
   * everything held about somebody, silently missing everyone after the
   * thousandth, is a worse answer than no file, because it looks complete.
   */
  const all = async <T>(table: ExportedTable, columns: string) => {
    const result = await fetchAllRows<T>((from, to) =>
      db
        .from(table)
        .select(columns)
        .eq("workspace_id", workspaceId)
        // Ordered, because paging an unordered query can repeat or skip a row.
        .order("id", { ascending: true })
        .range(from, to) as never,
    );
    return { ...result, rows: onlyColumns(result.rows, columns) };
  };

  const [
    prospects,
    conversations,
    meetings,
    campaigns,
    messages,
    members,
    linkedinAccounts,
    availability,
    availabilityBlackouts,
    calendarFeeds,
    businessProfiles,
    customerProfiles,
    agents,
    ctas,
    pitches,
    hooks,
    knowledgeDocuments,
    exclusions,
    campaignSteps,
    campaignVariants,
    campaignProspects,
  ] = await Promise.all([
    all<unknown>("prospects", "*"),
    all<unknown>("conversations", "*"),
    all<unknown>("meetings", "*"),
    all<unknown>("campaigns", "*"),
    all<unknown>("messages", "id, conversation_id, direction, source, body, sent_at, created_at"),
    all<{ user_id: string }>("memberships", "user_id, role, created_at"),
    // Settings, not plumbing: no provider account id, member id or counters.
    all<unknown>(
      "linkedin_accounts",
      "id, user_id, display_name, profile_url, status, has_sales_navigator, has_premium, working_hours, paused_at, connected_at, created_at",
    ),
    all<unknown>("availability", "*"),
    all<unknown>("availability_blackouts", "*"),
    // The host alone. The address is a bearer credential for the rep's whole
    // calendar (rule 19), so `url_encrypted` is never selected, not even as
    // ciphertext.
    all<unknown>("calendar_feeds", "id, user_id, url_host, status, last_synced_at, event_count, created_at"),
    all<unknown>("business_profiles", "*"),
    all<unknown>("customer_profiles", "*"),
    all<unknown>("agents", "*"),
    all<unknown>("ctas", "*"),
    all<unknown>("pitches", "*"),
    all<unknown>("hooks", "*"),
    all<unknown>("knowledge_documents", "*"),
    all<unknown>("exclusions", "*"),
    all<unknown>("campaign_steps", "*"),
    all<unknown>("campaign_variants", "*"),
    all<unknown>("campaign_prospects", "*"),
  ]);

  // Profiles carry no workspace id: a person may belong to several. Read only
  // for this workspace's own members, and only the settings — never the email,
  // address or anything sign-in related.
  const memberIds = [...new Set(members.rows.map((m) => m.user_id))];
  const memberSettings = memberIds.length
    ? await fetchAllRows<unknown>((from, to) =>
        db
          .from("profiles")
          .select(MEMBER_SETTINGS_COLUMNS)
          .in("id", memberIds)
          .order("id", { ascending: true })
          .range(from, to) as never,
      )
    : { rows: [], truncated: false };
  memberSettings.rows = onlyColumns(memberSettings.rows, MEMBER_SETTINGS_COLUMNS);

  const paged = [
    prospects,
    conversations,
    meetings,
    campaigns,
    messages,
    members,
    memberSettings,
    linkedinAccounts,
    availability,
    availabilityBlackouts,
    calendarFeeds,
    businessProfiles,
    customerProfiles,
    agents,
    ctas,
    pitches,
    hooks,
    knowledgeDocuments,
    exclusions,
    campaignSteps,
    campaignVariants,
    campaignProspects,
  ];

  return {
    exportVersion: EXPORT_VERSION,
    readme: EXPORT_README,
    exportedAt: new Date().toISOString(),
    // Said rather than hidden: an export that stopped short must not be handed
    // over as if it were everything.
    complete: !paged.some((r) => r.truncated),
    workspace: workspace ? onlyColumns([workspace], WORKSPACE_COLUMNS)[0] : null,
    members: members.rows,
    memberSettings: memberSettings.rows,
    linkedinAccounts: linkedinAccounts.rows,
    availability: availability.rows,
    availabilityBlackouts: availabilityBlackouts.rows,
    calendarFeeds: calendarFeeds.rows,
    businessProfiles: businessProfiles.rows,
    customerProfiles: customerProfiles.rows,
    agents: agents.rows,
    ctas: ctas.rows,
    pitches: pitches.rows,
    hooks: hooks.rows,
    knowledgeDocuments: knowledgeDocuments.rows,
    exclusions: exclusions.rows,
    campaigns: campaigns.rows,
    campaignSteps: campaignSteps.rows,
    campaignVariants: campaignVariants.rows,
    campaignProspects: campaignProspects.rows,
    prospects: prospects.rows,
    conversations: conversations.rows,
    messages: messages.rows,
    meetings: meetings.rows,
  };
}
