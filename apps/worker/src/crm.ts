import {
  CrmError,
  HubSpotProvider,
  MockCrmProvider,
  SalesforceProvider,
  WebhookProvider,
  refreshHubSpotToken,
  refreshSalesforceToken,
  type CrmProvider,
} from "@le/crm";
import type { Db } from "@le/db";
import type { Env } from "./config.js";
import { loadRefreshedCredential } from "./oauth-credentials.js";

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
    .in("kind", ["hubspot", "salesforce", "webhook"])
    .eq("status", "active");

  // HubSpot then Salesforce then webhook: a workspace should not have two
  // CRMs writing the same activity twice, so the first connected one wins.
  const oauthCrms = [
    {
      kind: "hubspot" as const,
      clientId: env.HUBSPOT_CLIENT_ID,
      clientSecret: env.HUBSPOT_CLIENT_SECRET,
      refresh: refreshHubSpotToken,
      build: () => new HubSpotProvider(),
    },
    {
      kind: "salesforce" as const,
      clientId: env.SALESFORCE_CLIENT_ID,
      clientSecret: env.SALESFORCE_CLIENT_SECRET,
      refresh: (input: { refreshToken: string; clientId: string; clientSecret: string }) =>
        // A sandbox org authenticates against test.salesforce.com; omitting
        // this sends the refresh to production and fails a working connection.
        refreshSalesforceToken({ ...input, loginUrl: env.SALESFORCE_LOGIN_URL }),
      build: (tokens: { instanceUrl?: string }) =>
        new SalesforceProvider({ instanceUrl: tokens.instanceUrl ?? "" }),
    },
  ];

  for (const crm of oauthCrms) {
    const integration = integrations?.find((i) => i.kind === crm.kind);
    if (!integration?.credentials_encrypted || !env.CREDENTIALS_KEY) continue;
    if (!crm.clientId || !crm.clientSecret) continue;

    const tokens = await loadRefreshedCredential<{
      accessToken: string;
      refreshToken?: string;
      expiresAt: number;
      instanceUrl?: string;
    }>(db, {
      integrationId: integration.id,
      credentialsEncrypted: integration.credentials_encrypted,
      key: env.CREDENTIALS_KEY,
      refresh: (current) =>
        crm.refresh({
          refreshToken: current.refreshToken!,
          clientId: crm.clientId!,
          clientSecret: crm.clientSecret!,
        }) as never,
    });
    if (!tokens) continue;

    return { provider: crm.build(tokens), accessToken: tokens.accessToken };
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

    const contactId = await resolveContactId(db, binding, prospect);

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
      .select("id, first_name, last_name, title, company, linkedin_url, crm_contact_id")
      .eq("id", meeting.prospect_id)
      .single();
    if (!prospect) return;

    const contactId = await resolveContactId(db, binding, prospect);

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

    await db.from("meetings").update({ crm_event_id: crmEventId }).eq("id", meeting.id);
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

/**
 * The CRM's id for this prospect, creating the record if it does not exist yet
 * and remembering it so the next sync does not look it up again.
 *
 * Both sync paths needed this and each had its own copy; the meeting one had
 * already lost the job title.
 */
async function resolveContactId(
  db: Db,
  binding: CrmBinding,
  prospect: {
    id: string;
    linkedin_url: string;
    first_name: string | null;
    last_name: string | null;
    company: string | null;
    title?: string | null;
    crm_contact_id: string | null;
  },
): Promise<string> {
  if (prospect.crm_contact_id) return prospect.crm_contact_id;

  const contactId = await binding.provider.upsertContact({
    accessToken: binding.accessToken,
    contact: {
      linkedinUrl: prospect.linkedin_url,
      firstName: prospect.first_name ?? undefined,
      lastName: prospect.last_name ?? undefined,
      company: prospect.company ?? undefined,
      jobTitle: prospect.title ?? undefined,
      source: "LinkedIn Employee",
    },
  });

  await db.from("prospects").update({ crm_contact_id: contactId }).eq("id", prospect.id);
  return contactId;
}
