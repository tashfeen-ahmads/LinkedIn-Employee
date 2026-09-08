import {
  CrmError,
  isRetryableStatus,
  type CrmActivity,
  type CrmContact,
  type CrmMeeting,
  type CrmProvider,
} from "./provider.js";

const API = "https://api.hubapi.com";

/**
 * HubSpot. Contacts are keyed on the LinkedIn URL rather than email, because a
 * LinkedIn conversation frequently never produces an email address — which is
 * exactly why reps end up with duplicate contacts when they sync by hand.
 */
export class HubSpotProvider implements CrmProvider {
  readonly name = "hubspot";
  private readonly fetchImpl: typeof fetch;

  constructor(options: { fetchImpl?: typeof fetch } = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async request<T>(path: string, accessToken: string, init: RequestInit = {}): Promise<T> {
    const res = await this.fetchImpl(`${API}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
        ...init.headers,
      },
    });
    const text = await res.text();
    if (!res.ok) {
      throw new CrmError(
        `HubSpot ${init.method ?? "GET"} ${path} failed with ${res.status}`,
        res.status,
        text,
        isRetryableStatus(res.status),
      );
    }
    return (text ? JSON.parse(text) : {}) as T;
  }

  async upsertContact(input: { accessToken: string; contact: CrmContact }): Promise<string> {
    const existing = await this.findByLinkedInUrl(input.accessToken, input.contact.linkedinUrl);

    const properties: Record<string, string> = {
      hs_linkedin_url: input.contact.linkedinUrl,
      ...(input.contact.firstName ? { firstname: input.contact.firstName } : {}),
      ...(input.contact.lastName ? { lastname: input.contact.lastName } : {}),
      ...(input.contact.company ? { company: input.contact.company } : {}),
      ...(input.contact.jobTitle ? { jobtitle: input.contact.jobTitle } : {}),
      ...(input.contact.email ? { email: input.contact.email } : {}),
    };

    if (existing) {
      await this.request(`/crm/v3/objects/contacts/${existing}`, input.accessToken, {
        method: "PATCH",
        body: JSON.stringify({ properties }),
      });
      return existing;
    }

    const created = await this.request<{ id: string }>("/crm/v3/objects/contacts", input.accessToken, {
      method: "POST",
      body: JSON.stringify({
        properties: { ...properties, hs_lead_status: "NEW", hs_analytics_source: "OTHER_CAMPAIGNS" },
      }),
    });
    return created.id;
  }

  private async findByLinkedInUrl(accessToken: string, linkedinUrl: string): Promise<string | null> {
    const result = await this.request<{ results?: Array<{ id: string }> }>(
      "/crm/v3/objects/contacts/search",
      accessToken,
      {
        method: "POST",
        body: JSON.stringify({
          filterGroups: [
            { filters: [{ propertyName: "hs_linkedin_url", operator: "EQ", value: linkedinUrl }] },
          ],
          properties: ["hs_linkedin_url"],
          limit: 1,
        }),
      },
    );
    return result.results?.[0]?.id ?? null;
  }

  async logActivity(input: { accessToken: string; activity: CrmActivity }): Promise<string | null> {
    const note = await this.request<{ id: string }>("/crm/v3/objects/notes", input.accessToken, {
      method: "POST",
      body: JSON.stringify({
        properties: {
          hs_timestamp: input.activity.occurredAt,
          hs_note_body: renderActivity(input.activity),
        },
        associations: [
          {
            to: { id: input.activity.contactId },
            // 202 is HubSpot's note-to-contact association type.
            types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 202 }],
          },
        ],
      }),
    });
    return note.id;
  }

  async logMeeting(input: { accessToken: string; meeting: CrmMeeting }): Promise<string | null> {
    const meeting = await this.request<{ id: string }>("/crm/v3/objects/meetings", input.accessToken, {
      method: "POST",
      body: JSON.stringify({
        properties: {
          hs_timestamp: input.meeting.startsAt,
          hs_meeting_title: input.meeting.title,
          hs_meeting_start_time: input.meeting.startsAt,
          hs_meeting_end_time: input.meeting.endsAt,
          hs_meeting_outcome: "SCHEDULED",
          ...(input.meeting.meetingUrl ? { hs_meeting_external_url: input.meeting.meetingUrl } : {}),
          ...(input.meeting.notes ? { hs_meeting_body: input.meeting.notes } : {}),
        },
        associations: [
          {
            to: { id: input.meeting.contactId },
            // 200 is HubSpot's meeting-to-contact association type.
            types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 200 }],
          },
        ],
      }),
    });
    return meeting.id;
  }
}

/**
 * Activity bodies say plainly when the agent wrote something. A CRM that hides
 * which messages were automated is worse than no CRM record at all: the next
 * person to open the deal needs to know what the prospect was actually told,
 * and by whom.
 */
export function renderActivity(activity: CrmActivity): string {
  const who =
    activity.direction === "inbound"
      ? "Prospect wrote on LinkedIn"
      : activity.authoredBy === "agent"
        ? "Sent on LinkedIn by the AI agent"
        : "Sent on LinkedIn";
  return `<b>${who}</b><br><br>${escapeHtml(activity.body).replace(/\n/g, "<br>")}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Scopes needed for contacts plus engagement logging. */
export const HUBSPOT_SCOPES = [
  "crm.objects.contacts.read",
  "crm.objects.contacts.write",
] as const;

export function hubspotConsentUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const params = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    scope: HUBSPOT_SCOPES.join(" "),
    state: input.state,
  });
  return `https://app.hubspot.com/oauth/authorize?${params.toString()}`;
}

export interface HubSpotTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export async function exchangeHubSpotCode(
  input: { code: string; clientId: string; clientSecret: string; redirectUri: string },
  fetchImpl: typeof fetch = fetch,
): Promise<HubSpotTokens> {
  return hubspotToken(
    {
      grant_type: "authorization_code",
      client_id: input.clientId,
      client_secret: input.clientSecret,
      redirect_uri: input.redirectUri,
      code: input.code,
    },
    fetchImpl,
  );
}

export async function refreshHubSpotToken(
  input: { refreshToken: string; clientId: string; clientSecret: string },
  fetchImpl: typeof fetch = fetch,
): Promise<HubSpotTokens> {
  return hubspotToken(
    {
      grant_type: "refresh_token",
      client_id: input.clientId,
      client_secret: input.clientSecret,
      refresh_token: input.refreshToken,
    },
    fetchImpl,
  );
}

async function hubspotToken(
  body: Record<string, string>,
  fetchImpl: typeof fetch,
): Promise<HubSpotTokens> {
  const res = await fetchImpl(`${API}/oauth/v1/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new CrmError(`HubSpot token request failed with ${res.status}`, res.status, text, isRetryableStatus(res.status));
  }
  const parsed = JSON.parse(text) as { access_token: string; refresh_token: string; expires_in: number };
  return {
    accessToken: parsed.access_token,
    refreshToken: parsed.refresh_token,
    expiresAt: Date.now() + (parsed.expires_in - 60) * 1000,
  };
}
