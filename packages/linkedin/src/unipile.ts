import { createHmac, timingSafeEqual } from "node:crypto";
import type { ProspectCandidate } from "@le/shared";
import type {
  AccountHealth,
  ActionResult,
  HostedAuthLink,
  InboundMessage,
  LinkedInProvider,
  ProspectPage,
  ProviderProfile,
  SearchQuery,
} from "./provider.js";

/**
 * Unipile hosts the LinkedIn session and exposes a REST API over it, so we never
 * store a rep's LinkedIn password and do not run browsers ourselves.
 *
 * Endpoint paths are collected here rather than inlined because they are the
 * part of this file most likely to need correcting against the live API docs
 * (see docs/06-research.md). Swapping providers means writing a sibling class,
 * not touching any agent or worker code.
 */
const ROUTES = {
  hostedAuth: "/api/v1/hosted/accounts/link",
  account: (id: string) => `/api/v1/accounts/${id}`,
  search: "/api/v1/linkedin/search",
  profile: (id: string) => `/api/v1/users/${id}`,
  invite: "/api/v1/users/invite",
  invitationsSent: "/api/v1/users/invite/sent",
  withdrawInvite: (id: string) => `/api/v1/users/invite/${id}`,
  chats: "/api/v1/chats",
  chatMessages: (id: string) => `/api/v1/chats/${id}/messages`,
  messages: "/api/v1/messages",
} as const;

export interface UnipileConfig {
  /** e.g. https://api1.unipile.com:13111 */
  dsn: string;
  accessToken: string;
  webhookSecret?: string;
  fetchImpl?: typeof fetch;
}

export class UnipileError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = "UnipileError";
  }
}

interface UnipileRawProfile {
  id?: string;
  provider_id?: string;
  public_identifier?: string;
  public_profile_url?: string;
  first_name?: string;
  last_name?: string;
  headline?: string;
  location?: string;
  summary?: string;
  current_position?: { title?: string; company?: string; start_date?: string };
  work_experience?: Array<{ position?: string; company?: string; start?: string }>;
}

export class UnipileProvider implements LinkedInProvider {
  readonly name = "unipile";
  private readonly dsn: string;
  private readonly token: string;
  private readonly webhookSecret?: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: UnipileConfig) {
    this.dsn = config.dsn.replace(/\/$/, "");
    this.token = config.accessToken;
    this.webhookSecret = config.webhookSecret;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await this.fetchImpl(`${this.dsn}${path}`, {
      ...init,
      headers: {
        "X-API-KEY": this.token,
        accept: "application/json",
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...init.headers,
      },
    });
    const text = await res.text();
    if (!res.ok) {
      throw new UnipileError(`Unipile ${init.method ?? "GET"} ${path} failed with ${res.status}`, res.status, text);
    }
    return (text ? JSON.parse(text) : {}) as T;
  }

  async createHostedAuthLink(input: {
    userId: string;
    successUrl: string;
    failureUrl: string;
  }): Promise<HostedAuthLink> {
    const expiresOn = new Date(Date.now() + 60 * 60_000).toISOString();
    const body = {
      type: "create",
      providers: ["LINKEDIN"],
      api_url: this.dsn,
      expiresOn,
      name: input.userId,
      success_redirect_url: input.successUrl,
      failure_redirect_url: input.failureUrl,
    };
    const res = await this.request<{ url: string }>(ROUTES.hostedAuth, {
      method: "POST",
      body: JSON.stringify(body),
    });
    return { url: res.url, expiresAt: expiresOn };
  }

  async getAccountHealth(accountId: string): Promise<AccountHealth> {
    try {
      const res = await this.request<{ sources?: Array<{ status?: string }> }>(ROUTES.account(accountId));
      const status = res.sources?.[0]?.status ?? "";
      return mapAccountStatus(status);
    } catch (err) {
      if (err instanceof UnipileError && err.status === 404) return "reauth_required";
      throw err;
    }
  }

  async searchProspects(input: {
    accountId: string;
    query: SearchQuery;
    cursor?: string;
    limit?: number;
  }): Promise<ProspectPage> {
    const params = new URLSearchParams({ account_id: input.accountId, limit: String(input.limit ?? 50) });
    if (input.cursor) params.set("cursor", input.cursor);
    const res = await this.request<{ items?: UnipileRawProfile[]; cursor?: string | null }>(
      `${ROUTES.search}?${params.toString()}`,
      { method: "POST", body: JSON.stringify(toUnipileSearchBody(input.query)) },
    );
    return {
      items: (res.items ?? []).map(toProspectCandidate),
      cursor: res.cursor ?? null,
    };
  }

  async getProfile(input: { accountId: string; providerId: string }): Promise<ProviderProfile> {
    const params = new URLSearchParams({ account_id: input.accountId });
    const raw = await this.request<UnipileRawProfile>(`${ROUTES.profile(input.providerId)}?${params.toString()}`);
    const candidate = toProspectCandidate(raw);
    return {
      providerId: candidate.providerId,
      linkedinUrl: candidate.linkedinUrl,
      firstName: candidate.firstName,
      lastName: candidate.lastName,
      headline: candidate.headline,
      title: candidate.title,
      company: candidate.company,
      location: candidate.location,
      about: candidate.about,
      startedRoleRecently: startedRoleRecently(raw),
    };
  }

  async sendInvitation(input: { accountId: string; providerId: string; note?: string }): Promise<ActionResult> {
    try {
      const res = await this.request<{ invitation_id?: string }>(ROUTES.invite, {
        method: "POST",
        body: JSON.stringify({
          account_id: input.accountId,
          provider_id: input.providerId,
          ...(input.note ? { message: input.note } : {}),
        }),
      });
      return { ok: true, providerId: res.invitation_id };
    } catch (err) {
      return toActionError(err);
    }
  }

  async withdrawInvitation(input: { accountId: string; invitationId: string }): Promise<ActionResult> {
    try {
      await this.request(`${ROUTES.withdrawInvite(input.invitationId)}?account_id=${input.accountId}`, {
        method: "DELETE",
      });
      return { ok: true };
    } catch (err) {
      return toActionError(err);
    }
  }

  async sendMessage(input: {
    accountId: string;
    chatId?: string;
    providerId?: string;
    text: string;
  }): Promise<ActionResult> {
    try {
      if (input.chatId) {
        const res = await this.request<{ message_id?: string }>(ROUTES.chatMessages(input.chatId), {
          method: "POST",
          body: JSON.stringify({ account_id: input.accountId, text: input.text }),
        });
        return { ok: true, providerId: res.message_id };
      }
      if (!input.providerId) {
        return { ok: false, error: "sendMessage requires chatId or providerId" };
      }
      const res = await this.request<{ chat_id?: string; message_id?: string }>(ROUTES.chats, {
        method: "POST",
        body: JSON.stringify({
          account_id: input.accountId,
          attendees_ids: [input.providerId],
          text: input.text,
        }),
      });
      return { ok: true, providerId: res.message_id ?? res.chat_id };
    } catch (err) {
      return toActionError(err);
    }
  }

  async listNewMessages(input: { accountId: string; since: string }): Promise<InboundMessage[]> {
    const params = new URLSearchParams({ account_id: input.accountId, after: input.since });
    const res = await this.request<{ items?: RawUnipileMessage[] }>(`${ROUTES.messages}?${params.toString()}`);
    return (res.items ?? [])
      .filter((m) => !m.is_sender)
      .map((m) => toInboundMessage(m, input.accountId));
  }

  parseWebhook(input: { body: string; signature?: string }): InboundMessage[] {
    // Fails closed. An unsigned webhook is an open door: a forged delivery
    // makes the Reply Agent answer a message no prospect ever sent, in a real
    // rep's name, so an unconfigured secret must reject rather than accept.
    if (!this.webhookSecret) {
      throw new Error("Unipile webhook secret is not configured; refusing to accept unverified deliveries");
    }
    if (!input.signature || !verifySignature(input.body, input.signature, this.webhookSecret)) {
      throw new Error("Invalid Unipile webhook signature");
    }
    const parsed = JSON.parse(input.body) as RawUnipileMessage | { items?: RawUnipileMessage[] };
    const items = "items" in parsed && Array.isArray(parsed.items) ? parsed.items : [parsed as RawUnipileMessage];
    return items.filter((m) => !m.is_sender).map((m) => toInboundMessage(m, m.account_id ?? ""));
  }
}

interface RawUnipileMessage {
  id?: string;
  message_id?: string;
  chat_id?: string;
  account_id?: string;
  sender_id?: string;
  sender_attendee_id?: string;
  text?: string;
  message?: string;
  timestamp?: string;
  is_sender?: boolean | number;
}

function toInboundMessage(m: RawUnipileMessage, fallbackAccountId: string): InboundMessage {
  return {
    providerMessageId: m.message_id ?? m.id ?? "",
    providerChatId: m.chat_id ?? "",
    providerAccountId: m.account_id ?? fallbackAccountId,
    fromProviderId: m.sender_id ?? m.sender_attendee_id ?? "",
    text: m.text ?? m.message ?? "",
    receivedAt: m.timestamp ?? new Date().toISOString(),
  };
}

function toUnipileSearchBody(query: SearchQuery): Record<string, unknown> {
  return {
    api: "sales_navigator",
    category: "people",
    keywords: query.keywords?.join(" ") || undefined,
    title: query.titles?.length ? { include: query.titles, exclude: query.excludeTitles ?? [] } : undefined,
    seniority: query.seniorities?.length ? { include: query.seniorities } : undefined,
    industry: query.industries?.length ? { include: query.industries } : undefined,
    company_headcount: query.companyHeadcount?.length ? query.companyHeadcount : undefined,
    location: query.geographies?.length ? { include: query.geographies } : undefined,
  };
}

function toProspectCandidate(raw: UnipileRawProfile): ProspectCandidate {
  const identifier = raw.provider_id ?? raw.id ?? raw.public_identifier ?? "";
  const position = raw.current_position ?? raw.work_experience?.[0];
  return {
    providerId: identifier,
    linkedinUrl:
      raw.public_profile_url ??
      (raw.public_identifier ? `https://www.linkedin.com/in/${raw.public_identifier}` : `https://www.linkedin.com/in/${identifier}`),
    firstName: raw.first_name ?? "",
    lastName: raw.last_name ?? "",
    headline: raw.headline,
    title: (position as { title?: string; position?: string } | undefined)?.title ??
      (position as { position?: string } | undefined)?.position,
    company: position?.company,
    location: raw.location,
    about: raw.summary,
    signals: startedRoleRecently(raw)
      ? [
          {
            type: "new_role" as const,
            detail: `Started at ${position?.company ?? "current company"} recently`,
            observedAt: new Date().toISOString(),
            weight: 0.8,
          },
        ]
      : [],
  };
}

function startedRoleRecently(raw: UnipileRawProfile): boolean {
  const start = raw.current_position?.start_date ?? raw.work_experience?.[0]?.start;
  if (!start) return false;
  const parsed = Date.parse(start);
  if (Number.isNaN(parsed)) return false;
  return Date.now() - parsed < 90 * 86_400_000;
}

function mapAccountStatus(status: string): AccountHealth {
  const s = status.toUpperCase();
  if (s === "OK" || s === "CONNECTED") return "ok";
  if (s.includes("CREDENTIALS") || s.includes("DISCONNECTED") || s.includes("EXPIRED")) return "reauth_required";
  if (s.includes("CAPTCHA") || s.includes("CHECKPOINT") || s.includes("IN_APP_VALIDATION") || s.includes("2FA")) {
    return "reauth_required";
  }
  if (s.includes("RESTRICT") || s.includes("BLOCK") || s.includes("BANNED")) return "restricted";
  if (s.includes("WARN") || s.includes("SYNC")) return "warning";
  return "unknown";
}

function toActionError(err: unknown): ActionResult {
  if (err instanceof UnipileError) {
    // 429 and 403 from the provider mean LinkedIn pushed back. Treat both as a
    // health signal so the scheduler pauses the account rather than retrying.
    const health: AccountHealth | undefined =
      err.status === 429 ? "warning" : err.status === 403 ? "restricted" : undefined;
    return { ok: false, error: err.message, health };
  }
  return { ok: false, error: err instanceof Error ? err.message : String(err) };
}

function verifySignature(body: string, signature: string, secret: string): boolean {
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature.replace(/^sha256=/, ""));
  return a.length === b.length && timingSafeEqual(a, b);
}
