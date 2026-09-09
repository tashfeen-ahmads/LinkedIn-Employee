/**
 * Seeds a demo workspace so every screen has something on it.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... pnpm --filter @le/db seed
 *
 * Idempotent: running it twice replaces the demo workspace rather than
 * doubling it. It refuses to touch anything outside that workspace.
 *
 * The rep is created through Supabase Auth so the workspace can actually be
 * signed into — a demo you cannot log into shows nothing.
 */
import { createClient } from "@supabase/supabase-js";
import { normalizeExclusionValue } from "@le/shared";
import { DEMO } from "./demo-data.js";
import type { Database } from "../database.types.js";

type Db = ReturnType<typeof createClient<Database>>;

const DAY = 86_400_000;

export interface SeedResult {
  workspaceId: string;
  userId: string;
  email: string;
  campaignId: string;
  counts: { prospects: number; conversations: number; messages: number; meetings: number };
}

export async function seedDemo(db: Db, now: Date = new Date()): Promise<SeedResult> {
  const userId = await ensureRep(db);
  const workspaceId = await resetWorkspace(db, userId);

  const businessProfileId = await insertOne(db, "business_profiles", {
    workspace_id: workspaceId,
    website_url: "https://northwind.example",
    spec: DEMO.businessProfile as never,
    created_by: userId,
    // Approved, because the demo starts after the rep has reviewed them.
    approved_at: iso(now, -9),
  });

  const profileIds = new Map<string, string>();
  for (const profile of DEMO.customerProfiles) {
    const id = await insertOne(db, "customer_profiles", {
      workspace_id: workspaceId,
      business_profile_id: businessProfileId,
      name: profile.name,
      spec: profile as never,
      priority: profile.priority,
      // Only the profile that has a campaign is approved. The other one sits
      // where every real second profile sits: written by the agent, waiting for
      // someone to read it, and unable to search until they do.
      approved_at: profile.priority === 1 ? iso(now, -9) : null,
    });
    profileIds.set(profile.name, id);
  }

  const accountId = await insertOne(db, "linkedin_accounts", {
    workspace_id: workspaceId,
    user_id: userId,
    provider: "mock",
    provider_account_id: "demo_account",
    display_name: `${DEMO.rep.fullName} (demo)`,
    has_sales_navigator: true,
    status: "active",
    // Connected long enough ago to be past the warm-up ramp.
    connected_at: iso(now, -60),
    invites_today: 6,
    invites_this_week: 23,
    messages_today: 4,
    counters_reset_on: now.toISOString().slice(0, 10),
    last_action_at: new Date(now.getTime() - 40 * 60_000).toISOString(),
    working_hours: { start: 8, end: 18, days: [1, 2, 3, 4, 5] } as never,
  });

  const primary = DEMO.customerProfiles[0]!;
  const campaignId = await insertOne(db, "campaigns", {
    workspace_id: workspaceId,
    customer_profile_id: profileIds.get(primary.name) ?? null,
    linkedin_account_id: accountId,
    owner_user_id: userId,
    name: "RevOps leads — UK & Ireland",
    status: "running",
    connection_note: primary.connectionNote,
    daily_invite_cap: 20,
    reply_mode: "approval",
    stop_conditions: ["prospect replies", "prospect opts out", "meeting booked"] as never,
    launched_at: iso(now, -8),
  });

  await db.from("campaign_steps").insert(
    primary.followUps.map((step, index) => ({
      workspace_id: workspaceId,
      campaign_id: campaignId,
      step_number: index + 1,
      delay_days: step.delayDays,
      message: step.message,
    })) as never,
  );

  const prospectIds = new Map<string, string>();
  for (const prospect of DEMO.prospects) {
    const id = await insertOne(db, "prospects", {
      workspace_id: workspaceId,
      linkedin_url: prospect.linkedinUrl,
      provider_id: `demo_${prospect.key}`,
      first_name: prospect.firstName,
      last_name: prospect.lastName,
      title: prospect.title,
      company: prospect.company,
      company_size: prospect.companySize,
      industry: prospect.industry,
      location: prospect.location,
      fit_score: prospect.fitScore,
      fit_reasons: prospect.fitReasons as never,
      intent_score: prospect.intentScore,
      signals: prospect.signals.map((s) => ({ ...s, observedAt: iso(now, -5) })) as never,
      owner_user_id: userId,
      last_contacted_at: prospect.status === "queued" ? null : iso(now, -3),
      do_not_contact: prospect.doNotContact ?? false,
      do_not_contact_reason: prospect.doNotContactReason ?? null,
    });
    prospectIds.set(prospect.key, id);

    await db.from("campaign_prospects").insert({
      workspace_id: workspaceId,
      campaign_id: campaignId,
      prospect_id: id,
      status: prospect.status,
      invited_at: prospect.status === "queued" ? null : iso(now, -6),
      accepted_at: ["accepted", "messaged_1", "replied", "meeting_booked"].includes(prospect.status)
        ? iso(now, -5)
        : null,
      last_step_sent: prospect.status === "messaged_1" ? 1 : 0,
      replied_at: ["replied", "meeting_booked"].includes(prospect.status) ? iso(now, -1) : null,
    } as never);
  }

  let messageCount = 0;
  for (const thread of DEMO.conversations) {
    const prospectId = prospectIds.get(thread.prospect)!;
    const conversationId = await insertOne(db, "conversations", {
      workspace_id: workspaceId,
      prospect_id: prospectId,
      linkedin_account_id: accountId,
      campaign_id: campaignId,
      provider_chat_id: `demo_chat_${thread.prospect}`,
      last_message_at: iso(now, -1),
      needs_human: Boolean(thread.heldDraft),
      needs_human_reason: thread.heldDraft?.reason ?? null,
    });

    for (const message of thread.messages) {
      await db.from("messages").insert({
        workspace_id: workspaceId,
        conversation_id: conversationId,
        direction: message.direction,
        source: message.source,
        body: message.body,
        provider_message_id: `demo_${thread.prospect}_${messageCount}`,
        classification: (message.classification ?? null) as never,
        prompt_version: message.source === "agent" ? "reply.draft/2026-09-08" : null,
        sent_at: iso(now, -message.daysAgo),
      } as never);
      messageCount++;
    }

    if (thread.heldDraft) {
      await db.from("reply_drafts").insert({
        workspace_id: workspaceId,
        conversation_id: conversationId,
        body: thread.heldDraft.body,
        proposes_meeting: false,
        unanswered_questions: thread.heldDraft.unansweredQuestions as never,
        prompt_version: "reply.draft/2026-09-08",
        status: "pending",
      } as never);
    }
  }

  const meetingStart = new Date(now.getTime() + DEMO.meeting.inDays * DAY);
  meetingStart.setUTCHours(14, 0, 0, 0);
  await db.from("meetings").insert({
    workspace_id: workspaceId,
    prospect_id: prospectIds.get(DEMO.meeting.prospect)!,
    rep_user_id: userId,
    starts_at: meetingStart.toISOString(),
    ends_at: new Date(meetingStart.getTime() + DEMO.meeting.durationMinutes * 60_000).toISOString(),
    meeting_url: "https://meet.example.test/demo",
    status: "scheduled",
  } as never);

  await db.from("knowledge_documents").insert(
    DEMO.knowledge.map((doc) => ({
      workspace_id: workspaceId,
      title: doc.title,
      content: doc.content,
      source: "demo",
    })) as never,
  );

  await db.from("exclusions").insert(
    DEMO.exclusions.map((entry) => ({
      workspace_id: workspaceId,
      kind: entry.kind,
      value: normalizeExclusionValue(entry.kind, entry.rawValue),
      raw_value: entry.rawValue,
      reason: entry.reason,
      created_by: userId,
    })) as never,
  );

  // The overview counts these, so the funnel is empty without them.
  await db.from("events").insert(
    [
      ...Array.from({ length: 23 }, () => "invite.sent"),
      ...Array.from({ length: 9 }, () => "invite.accepted"),
      "message.received",
      "message.received",
      "meeting.booked",
    ].map((name) => ({
      workspace_id: workspaceId,
      name,
      actor_user_id: userId,
      payload: { demo: true } as never,
    })) as never,
  );

  return {
    workspaceId,
    userId,
    email: DEMO.rep.email,
    campaignId,
    counts: {
      prospects: DEMO.prospects.length,
      conversations: DEMO.conversations.length,
      messages: messageCount,
      meetings: 1,
    },
  };
}

/** Creates the demo rep in Auth if they do not exist, and returns their id. */
async function ensureRep(db: Db): Promise<string> {
  const { data: existingProfile } = await db
    .from("profiles")
    .select("id")
    .eq("email", DEMO.rep.email)
    .maybeSingle();

  if (existingProfile) {
    await db
      .from("profiles")
      .update({ full_name: DEMO.rep.fullName, timezone: DEMO.rep.timezone, bio: DEMO.rep.bio })
      .eq("id", existingProfile.id);
    return existingProfile.id;
  }

  const { data, error } = await db.auth.admin.createUser({
    email: DEMO.rep.email,
    email_confirm: true,
    user_metadata: { full_name: DEMO.rep.fullName },
  });
  if (error || !data.user) throw new Error(`could not create the demo user: ${error?.message}`);

  // The signup trigger creates the profile row; fill in the rest.
  await db
    .from("profiles")
    .update({ full_name: DEMO.rep.fullName, timezone: DEMO.rep.timezone, bio: DEMO.rep.bio })
    .eq("id", data.user.id);

  return data.user.id;
}

/**
 * Deletes and recreates the demo workspace. Scoped by slug so a second run
 * cannot touch a real customer's data — the cascade only follows from here.
 */
async function resetWorkspace(db: Db, userId: string): Promise<string> {
  await db.from("workspaces").delete().eq("slug", DEMO.workspace.slug);

  const workspaceId = await insertOne(db, "workspaces", {
    name: DEMO.workspace.name,
    slug: DEMO.workspace.slug,
    plan: DEMO.workspace.plan,
    trial_ends_at: new Date(Date.now() + 5 * DAY).toISOString(),
    seats: 1,
  });

  await db.from("memberships").insert({ workspace_id: workspaceId, user_id: userId, role: "owner" } as never);
  return workspaceId;
}

async function insertOne(db: Db, table: string, row: Record<string, unknown>): Promise<string> {
  const { data, error } = await db
    .from(table as never)
    .insert(row as never)
    .select("id")
    .single();
  if (error || !data) throw new Error(`seed failed on ${table}: ${error?.message}`);
  return (data as { id: string }).id;
}

function iso(now: Date, daysFromNow: number): string {
  return new Date(now.getTime() + daysFromNow * DAY).toISOString();
}
