import {
  CrmError,
  HubSpotProvider,
  MockCrmProvider,
  WebhookProvider,
  refreshHubSpotToken,
  type CrmProvider,
} from "@le/crm";
import type { Db } from "@le/db";
import type { Env } from "./config.js";
import { decryptJson, encryptJson } from "./crypto.js";

export interface CrmBinding {
  provider: CrmProvider;
  accessToken: string;
}

/**
 * Resolves whichever CRM a workspace has connected, refreshing tokens as
 * needed. Returns null when none is connected: CRM sync is an enhancement, and
 * its absence must never block an outreach action.
 */
export async function resolveCrm(db: Db, env: Env, workspaceId: string): Promise<CrmBinding | null> {
  if (env.CRM_PROVIDER === "mock") {
    return { provider: new MockCrmProvider(), accessToken: "mock" };
  }

  const { data: integrations } = await db
    .from("integrations")
    .select("id, kind, credentials_encrypted, config, status")
    .eq("workspace_id", workspaceId)
    .in("kind", ["hubspot", "webhook"])
    .eq("status", "active");

  const hubspot = integrations?.find((i) => i.kind === "hubspot");
  if (hubspot?.credentials_encrypted && env.CREDENTIALS_KEY && env.HUBSPOT_CLIENT_ID && env.HUBSPOT_CLIENT_SECRET) {
    try {
      let tokens = decryptJson<{ accessToken: string; refreshToken: string; expiresAt: number }>(
        hubspot.credentials_encrypted,
        env.CREDENTIALS_KEY,
      );
      if (tokens.expiresAt <= Date.now()) {
        tokens = await refreshHubSpotToken({
          refreshToken: tokens.refreshToken,
          clientId: env.HUBSPOT_CLIENT_ID,
          clientSecret: env.HUBSPOT_CLIENT_SECRET,
        });
        await db
          .from("integrations")
          .update({ credentials_encrypted: encryptJson(tokens, env.CREDENTIALS_KEY) })
          .eq("id", hubspot.id);
      }
      return { provider: new HubSpotProvider(), accessToken: tokens.accessToken };
    } catch {
      await db.from("integrations").update({ status: "reauth_required" }).eq("id", hubspot.id);
    }
  }

  const webhook = integrations?.find((i) => i.kind === "webhook");
  const config = webhook?.config as { url?: string; secret?: string } | null;
  if (config?.url) {
    return { provider: new WebhookProvider({ url: config.url, secret: config.secret }), accessToken: "" };
  }

  return null;
}

/**
 * Pushes a prospect and the message that just happened into the CRM.
 *
 * Every failure is swallowed after logging: a CRM outage must never fail the
 * job that sent a LinkedIn message, because retrying that job would message the
 * prospect twice.
 */
export async function syncConversationToCrm(
  db: Db,
  env: Env,
  input: {
    workspaceId: string;
    prospectId: string;
    body: string;
    direction: "outbound" | "inbound";
    authoredBy: "agent" | "human";
    occurredAt: string;
  },
): Promise<void> {
  try {
    const binding = await resolveCrm(db, env, input.workspaceId);
    if (!binding) return;

    const { data: prospect } = await db
      .from("prospects")
      .select("id, first_name, last_name, title, company, linkedin_url, crm_contact_id")
      .eq("id", input.prospectId)
      .single();
    if (!prospect) return;

    const contactId =
      prospect.crm_contact_id ??
      (await binding.provider.upsertContact({
        accessToken: binding.accessToken,
        contact: {
          linkedinUrl: prospect.linkedin_url,
          firstName: prospect.first_name ?? undefined,
          lastName: prospect.last_name ?? undefined,
          company: prospect.company ?? undefined,
          jobTitle: prospect.title ?? undefined,
          source: "LinkedIn Employee",
        },
      }));

    if (contactId !== prospect.crm_contact_id) {
      await db.from("prospects").update({ crm_contact_id: contactId }).eq("id", prospect.id);
    }

    await binding.provider.logActivity({
      accessToken: binding.accessToken,
      activity: {
        contactId,
        occurredAt: input.occurredAt,
        direction: input.direction,
        authoredBy: input.authoredBy,
        body: input.body,
      },
    });
  } catch (error) {
    logCrmFailure("conversation", error);
  }
}

export async function syncMeetingToCrm(
  db: Db,
  env: Env,
  input: { workspaceId: string; meetingId: string },
): Promise<void> {
  try {
    const binding = await resolveCrm(db, env, input.workspaceId);
    if (!binding) return;

    const { data: meeting } = await db
      .from("meetings")
      .select("id, prospect_id, starts_at, ends_at, meeting_url")
      .eq("id", input.meetingId)
      .single();
    if (!meeting) return;

    const { data: prospect } = await db
      .from("prospects")
      .select("id, first_name, last_name, company, linkedin_url, crm_contact_id")
      .eq("id", meeting.prospect_id)
      .single();
    if (!prospect) return;

    const contactId =
      prospect.crm_contact_id ??
      (await binding.provider.upsertContact({
        accessToken: binding.accessToken,
        contact: {
          linkedinUrl: prospect.linkedin_url,
          firstName: prospect.first_name ?? undefined,
          lastName: prospect.last_name ?? undefined,
          company: prospect.company ?? undefined,
          source: "LinkedIn Employee",
        },
      }));

    const name = `${prospect.first_name ?? ""} ${prospect.last_name ?? ""}`.trim() || "LinkedIn contact";
    const crmEventId = await binding.provider.logMeeting({
      accessToken: binding.accessToken,
      meeting: {
        contactId,
        title: `Intro call with ${name}`,
        startsAt: meeting.starts_at,
        endsAt: meeting.ends_at,
        meetingUrl: meeting.meeting_url ?? undefined,
        notes: "Booked by the LinkedIn Employee reply agent.",
      },
    });

    await db
      .from("meetings")
      .update({ crm_event_id: crmEventId })
      .eq("id", meeting.id);
    if (contactId !== prospect.crm_contact_id) {
      await db.from("prospects").update({ crm_contact_id: contactId }).eq("id", prospect.id);
    }
  } catch (error) {
    logCrmFailure("meeting", error);
  }
}

function logCrmFailure(what: string, error: unknown): void {
  if (error instanceof CrmError) {
    console.error(`crm ${what} sync failed (${error.status}, retryable=${error.retryable}):`, error.message);
    return;
  }
  console.error(`crm ${what} sync failed:`, error);
}
