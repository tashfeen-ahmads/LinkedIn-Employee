import {
  CrmError,
  isRetryableStatus,
  type CrmActivity,
  type CrmContact,
  type CrmMeeting,
  type CrmProvider,
} from "./provider.js";

const API_VERSION = "v62.0";

export interface SalesforceConfig {
  /** Per-org host returned by the token exchange, e.g. https://acme.my.salesforce.com */
  instanceUrl: string;
  fetchImpl?: typeof fetch;
}

/**
 * Salesforce. Two things differ from HubSpot and shape this adapter.
 *
 * Leads and Contacts are separate objects, and a prospect who has never spoken
 * to anyone is a Lead. Writing them as Contacts pollutes the customer's
 * account model, so this creates Leads and looks in both when deduping.
 *
 * There is no standard LinkedIn URL field, so dedupe falls back to name plus
 * company. That is weaker than HubSpot's URL match, and the code says so rather
 * than pretending otherwise.
 */
export class SalesforceProvider implements CrmProvider {
  readonly name = "salesforce";
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: SalesforceConfig) {
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  private async request<T>(path: string, accessToken: string, init: RequestInit = {}): Promise<T> {
    const res = await this.fetchImpl(`${this.config.instanceUrl}/services/data/${API_VERSION}${path}`, {
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
        `Salesforce ${init.method ?? "GET"} ${path} failed with ${res.status}`,
        res.status,
        text,
        isRetryableStatus(res.status),
      );
    }
    return (text ? JSON.parse(text) : {}) as T;
  }

  async upsertContact(input: { accessToken: string; contact: CrmContact }): Promise<string> {
    const existing = await this.findExisting(input.accessToken, input.contact);
    if (existing) return existing;

    const lastName = input.contact.lastName?.trim() || input.contact.firstName?.trim() || "Unknown";
    const created = await this.request<{ id: string }>("/sobjects/Lead", input.accessToken, {
      method: "POST",
      body: JSON.stringify({
        // LastName and Company are the only required fields on a Lead.
        LastName: lastName,
        FirstName: input.contact.firstName ?? undefined,
        Company: input.contact.company || "Unknown",
        Title: input.contact.jobTitle ?? undefined,
        Email: input.contact.email ?? undefined,
        Website: input.contact.linkedinUrl,
        LeadSource: input.contact.source,
      }),
    });
    return created.id;
  }

  /**
   * Looks for an existing Lead or Contact. Salesforce has no LinkedIn URL field
   * as standard, so this matches on email when we have one and otherwise on
   * name plus company — good enough to avoid obvious duplicates, not good
   * enough to be certain.
   */
  private async findExisting(accessToken: string, contact: CrmContact): Promise<string | null> {
    const clauses: string[] = [];
    if (contact.email) clauses.push(`Email = ${quote(contact.email)}`);
    if (contact.lastName && contact.company) {
      clauses.push(`(LastName = ${quote(contact.lastName)} AND Company = ${quote(contact.company)})`);
    }
    if (clauses.length === 0) return null;

    const soql = `SELECT Id FROM Lead WHERE ${clauses.join(" OR ")} LIMIT 1`;
    const result = await this.request<{ records?: Array<{ Id: string }> }>(
      `/query?q=${encodeURIComponent(soql)}`,
      accessToken,
    );
    return result.records?.[0]?.Id ?? null;
  }

  async logActivity(input: { accessToken: string; activity: CrmActivity }): Promise<string | null> {
    const task = await this.request<{ id: string }>("/sobjects/Task", input.accessToken, {
      method: "POST",
      body: JSON.stringify({
        WhoId: input.activity.contactId,
        Subject: activitySubject(input.activity),
        Description: input.activity.body,
        Status: "Completed",
        ActivityDate: input.activity.occurredAt.slice(0, 10),
        TaskSubtype: "Task",
      }),
    });
    return task.id;
  }

  async logMeeting(input: { accessToken: string; meeting: CrmMeeting }): Promise<string | null> {
    const event = await this.request<{ id: string }>("/sobjects/Event", input.accessToken, {
      method: "POST",
      body: JSON.stringify({
        WhoId: input.meeting.contactId,
        Subject: input.meeting.title,
        StartDateTime: input.meeting.startsAt,
        EndDateTime: input.meeting.endsAt,
        Description: [input.meeting.notes, input.meeting.meetingUrl].filter(Boolean).join("\n\n") || undefined,
      }),
    });
    return event.id;
  }
}

/** Names the author in the subject, since Salesforce tasks are skimmed as a list. */
export function activitySubject(activity: CrmActivity): string {
  if (activity.direction === "inbound") return "LinkedIn: reply from prospect";
  return activity.authoredBy === "agent" ? "LinkedIn: message sent by AI agent" : "LinkedIn: message sent";
}

/**
 * Escapes a SOQL string literal. Salesforce queries are built as text, so an
 * unescaped quote in a company name is both a broken query and an injection
 * point.
 */
export function quote(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

export interface SalesforceTokens {
  accessToken: string;
  refreshToken?: string;
  instanceUrl: string;
  expiresAt: number;
}

export function salesforceConsentUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
  loginUrl?: string;
}): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    scope: "api refresh_token offline_access",
    state: input.state,
  });
  return `${input.loginUrl ?? "https://login.salesforce.com"}/services/oauth2/authorize?${params.toString()}`;
}

export async function exchangeSalesforceCode(
  input: { code: string; clientId: string; clientSecret: string; redirectUri: string; loginUrl?: string },
  fetchImpl: typeof fetch = fetch,
): Promise<SalesforceTokens> {
  return salesforceToken(
    {
      grant_type: "authorization_code",
      code: input.code,
      client_id: input.clientId,
      client_secret: input.clientSecret,
      redirect_uri: input.redirectUri,
    },
    input.loginUrl,
    fetchImpl,
  );
}

export async function refreshSalesforceToken(
  input: { refreshToken: string; clientId: string; clientSecret: string; loginUrl?: string },
  fetchImpl: typeof fetch = fetch,
): Promise<SalesforceTokens> {
  const tokens = await salesforceToken(
    {
      grant_type: "refresh_token",
      refresh_token: input.refreshToken,
      client_id: input.clientId,
      client_secret: input.clientSecret,
    },
    input.loginUrl,
    fetchImpl,
  );
  // A refresh response does not repeat the refresh token; keep the one we have.
  return { ...tokens, refreshToken: tokens.refreshToken ?? input.refreshToken };
}

async function salesforceToken(
  body: Record<string, string>,
  loginUrl: string | undefined,
  fetchImpl: typeof fetch,
): Promise<SalesforceTokens> {
  const res = await fetchImpl(`${loginUrl ?? "https://login.salesforce.com"}/services/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new CrmError(`Salesforce token request failed with ${res.status}`, res.status, text, isRetryableStatus(res.status));
  }

  const parsed = JSON.parse(text) as {
    access_token: string;
    refresh_token?: string;
    instance_url: string;
    issued_at?: string;
  };
  return {
    accessToken: parsed.access_token,
    refreshToken: parsed.refresh_token,
    instanceUrl: parsed.instance_url,
    // Salesforce does not return expires_in; sessions are typically two hours,
    // so refresh conservatively rather than waiting for a 401.
    expiresAt: Date.now() + 90 * 60_000,
  };
}
