import { createHmac, timingSafeEqual } from "node:crypto";
import type { ProspectCandidate } from "@le/shared";
import type {
  AccountHealth,
  ActionResult,
  HostedAuthLink,
  InboundMessage,
  LinkedInProvider,
  ProspectPage,
  SearchTier,
  ConnectedAccount,
  ProviderProfile,
  ProviderRelation,
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
  accounts: "/api/v1/accounts",
  account: (id: string) => `/api/v1/accounts/${id}`,
  search: "/api/v1/linkedin/search",
  searchParameters: "/api/v1/linkedin/search/parameters",
  profile: (id: string) => `/api/v1/users/${id}`,
  invite: "/api/v1/users/invite",
  invitationsSent: "/api/v1/users/invite/sent",
  withdrawInvite: (id: string) => `/api/v1/users/invite/${id}`,
  chats: "/api/v1/chats",
  chatMessages: (id: string) => `/api/v1/chats/${id}/messages`,
  messages: "/api/v1/messages",
  relations: "/api/v1/users/relations",
} as const;

export interface UnipileConfig {
  /** e.g. https://api1.unipile.com:13111 */
  dsn: string;
  accessToken: string;
  webhookSecret?: string;
  fetchImpl?: typeof fetch;
}

/**
 * The provider does not have the account we are asking with.
 *
 * Worth its own question because it is the one provider failure a rep can fix
 * themselves, and it is indistinguishable from the rest at the call site: a
 * campaign that cannot search because the connected account is gone reads as
 * "LinkedIn refused the search", which sounds like LinkedIn's problem and is
 * not. Matched on the status and the body together — a 404 alone is also how
 * this API answers a route it does not have.
 */
export function isAccountGone(err: unknown): boolean {
  if (!(err instanceof UnipileError) || err.status !== 404) return false;
  return /account not found/i.test(err.body);
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
  /**
   * LinkedIn's own id for a place or an industry, keyed by the words we asked
   * with. The taxonomy does not change between searches and a lookup costs a
   * round trip per term, so the answer is kept for the life of the process.
   * `null` is cached too: a term LinkedIn does not recognise stays unrecognised.
   */
  private readonly parameterIds = new Map<string, SearchParameter | null>();

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
      // Unipile's own sentence, carried out with the status.
      //
      // A 404 from this API means one of several unrelated things — no such
      // account, a feature the subscription does not include, a route that
      // does not exist on this deployment — and the body is where it says
      // which. Reporting the number alone leaves whoever reads the event to
      // guess, which is how a search that was failing for a nameable reason
      // looked for a day like a search that matched nobody.
      throw new UnipileError(
        `Unipile ${init.method ?? "GET"} ${path} failed with ${res.status}${said(text)}`,
        res.status,
        text,
      );
    }
    return (text ? JSON.parse(text) : {}) as T;
  }

  async createHostedAuthLink(input: {
    userId: string;
    successUrl: string;
    failureUrl: string;
    notifyUrl?: string;
  }): Promise<HostedAuthLink> {
    const expiresOn = new Date(Date.now() + 60 * 60_000).toISOString();
    const body = {
      type: "create",
      providers: ["LINKEDIN"],
      api_url: this.dsn,
      expiresOn,
      // Echoed back on the notification, and the only thing tying a connected
      // account to the rep who started the flow.
      name: input.userId,
      success_redirect_url: input.successUrl,
      failure_redirect_url: input.failureUrl,
      // The redirect tells the rep's browser it worked; this tells us. Without
      // it the account has no provider id and every job skips it silently.
      ...(input.notifyUrl ? { notify_url: input.notifyUrl } : {}),
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
    tier?: SearchTier;
  }): Promise<ProspectPage> {
    const tier = input.tier ?? "classic";
    const params = new URLSearchParams({ account_id: input.accountId, limit: String(input.limit ?? 50) });
    if (input.cursor) params.set("cursor", input.cursor);

    const resolved = await this.resolveFilters(input.accountId, input.query);
    const { body, droppedFilters } = toUnipileSearchBody(input.query, tier, resolved);
    const notes = [...resolved.notes];

    // Every constraint at once is an AND, and a customer profile is a
    // description rather than a query: titles AND keywords AND industry AND
    // location is a conjunction almost nobody on LinkedIn satisfies. The first
    // live campaign asked for eight titles, five keywords, three industries and
    // two countries and matched zero people, which read on screen as "your
    // customer profile is wrong" when the profile was fine and the query was
    // unsatisfiable.
    //
    // So a search that finds nobody is widened and tried again, in an order
    // that gives up the weakest signal first. What was given up is named:
    // a list broader than the one that was approved is fine, and a reviewer
    // being told it is the one they approved is not.
    for (const step of relaxations(input.query, tier, resolved, body)) {
      const res = await this.request<{ items?: UnipileRawProfile[]; cursor?: string | null }>(
        `${ROUTES.search}?${params.toString()}`,
        { method: "POST", body: JSON.stringify(step.body) },
      );
      const items = (res.items ?? []).map(toProspectCandidate);
      if (items.length > 0 || step.last) {
        if (step.note) notes.push(step.note);
        return { items, cursor: res.cursor ?? null, droppedFilters, filterNotes: notes };
      }
    }

    return { items: [], cursor: null, droppedFilters, filterNotes: notes };
  }

  /**
   * Turns the places and industries a customer profile names into the ids
   * LinkedIn searches by.
   *
   * LinkedIn does not take words here. `location: ["United States"]` is not a
   * loose match that returns fewer people — it is not a location, and the
   * search comes back empty. That is how a campaign aimed at four industries
   * across two countries returned nobody at all, with no error anywhere: the
   * Strategy Agent writes what a person would write, and every one of those
   * words had to become a number before it left this file.
   *
   * A term LinkedIn does not recognise is dropped and named rather than
   * guessed at, and a term it recognises as something slightly different — its
   * taxonomy renamed most industries in 2022 — is reported as what it actually
   * became. Both end up on the campaign the reviewer reads before launching.
   */
  private async resolveFilters(
    accountId: string,
    query: SearchQuery,
  ): Promise<ResolvedFilters> {
    const notes: string[] = [];

    const resolve = async (field: string, type: SearchParameterType, names: string[] | undefined) => {
      const ids: string[] = [];
      for (const name of names ?? []) {
        const looked = await this.lookupParameter(accountId, type, name);
        if (looked.failed) {
          // Not the same thing as LinkedIn not having the term, and saying so
          // matters: every lookup failing means the search runs with no
          // location and no industry at all, which is a different campaign
          // from the one that was approved.
          notes.push(`The ${field} "${name}" could not be looked up (${looked.failed}), so it was left out of the search.`);
          continue;
        }
        const hit = looked.found;
        if (!hit) {
          notes.push(`LinkedIn has no ${field} called "${name}", so it was left out of the search.`);
          continue;
        }
        ids.push(hit.id);
        if (hit.title.trim().toLowerCase() !== name.trim().toLowerCase()) {
          notes.push(`The ${field} "${name}" was searched as LinkedIn's "${hit.title}".`);
        }
      }
      return ids;
    };

    return {
      locations: await resolve("location", "LOCATION", query.geographies),
      industries: await resolve("industry", "INDUSTRY", query.industries),
      notes,
    };
  }

  /** One name, one id, asked once per process. */
  private async lookupParameter(
    accountId: string,
    type: SearchParameterType,
    name: string,
  ): Promise<Lookup> {
    const key = `${type}:${name.trim().toLowerCase()}`;
    const cached = this.parameterIds.get(key);
    if (cached !== undefined) return { found: cached };

    const params = new URLSearchParams({ account_id: accountId, type, keywords: name });
    let items: Array<{ id?: string; title?: string; name?: string }> = [];
    try {
      const res = await this.request<{ items?: typeof items }>(
        `${ROUTES.searchParameters}?${params.toString()}`,
      );
      items = res.items ?? [];
    } catch (err) {
      // A lookup that fails is not a filter that matched nothing. Nothing is
      // cached, so the next search asks again rather than inheriting a wrong
      // answer for the life of the process, and the caller is told which of
      // the two happened.
      return { found: null, failed: (err as { message?: string })?.message ?? "the lookup failed" };
    }

    // Exact first: "Design" is a real LinkedIn industry and also a word inside
    // several others, and the typeahead does not promise to put it first.
    const wanted = name.trim().toLowerCase();
    const hit =
      items.find((i) => (i.title ?? i.name ?? "").trim().toLowerCase() === wanted) ?? items[0];
    const id = hit?.id;
    if (!id) {
      this.parameterIds.set(key, null);
      return { found: null };
    }
    const found = { id, title: hit?.title ?? hit?.name ?? name };
    this.parameterIds.set(key, found);
    return { found };
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

  /**
   * The account's connections, newest first.
   *
   * `since` filters client-side rather than in the query: the provider's own
   * cursor is opaque and its date filtering is the part of this API most likely
   * to differ from the docs, and a connection missed here means a follow-up
   * that never sends. Over-fetching a page is the cheaper mistake.
   */
  async listRelations(input: { accountId: string; since?: string; limit?: number }): Promise<ProviderRelation[]> {
    const params = new URLSearchParams({ account_id: input.accountId, limit: String(input.limit ?? 100) });
    const response = await this.request<{ items?: Array<Record<string, unknown>> }>(
      `${ROUTES.relations}?${params.toString()}`,
    );

    const relations = (response.items ?? []).map((item) => ({
      providerId: String(item.member_id ?? item.provider_id ?? item.id ?? ""),
      connectedAt: typeof item.created_at === "string" ? item.created_at : null,
    }));

    const known = relations.filter((relation) => relation.providerId);
    if (!input.since) return known;
    // A relation with no date is kept: not knowing when someone connected is
    // not evidence that they did not.
    return known.filter((relation) => !relation.connectedAt || relation.connectedAt >= input.since!);
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

  parseAccountWebhook(input: { body: string; signature?: string }): ConnectedAccount[] {
    // Fails closed for the same reason the message webhook does, and one more:
    // a forged delivery would bind a stranger's LinkedIn account to a rep's
    // row, and every message the campaign sends would leave that account.
    if (!this.webhookSecret) {
      throw new Error("Unipile webhook secret is not configured; refusing to accept unverified deliveries");
    }
    if (!input.signature || !verifySignature(input.body, input.signature, this.webhookSecret)) {
      throw new Error("Invalid Unipile webhook signature");
    }

    const parsed = JSON.parse(input.body) as RawUnipileAccount | { items?: RawUnipileAccount[] };
    const items = "items" in parsed && Array.isArray(parsed.items) ? parsed.items : [parsed as RawUnipileAccount];
    return toConnectedAccounts(items);
  }

  /**
   * Which parts of a classic search body LinkedIn actually honours.
   *
   * Built because the widest possible search — a keyword, two countries, second
   * and third degree — returned zero people, which is not an answer the real
   * LinkedIn gives. That means a field in the body is silently matching
   * nothing, and working out which one by changing the code and asking someone
   * to press a button is a round trip per guess.
   *
   * So every candidate is asked at once and the counts are reported. One click
   * replaces six deployments. Each probe requests a single result: this is a
   * diagnostic, and it runs against a seat somebody is paying for.
   */
  async probeSearch(accountId: string): Promise<Array<{ label: string; count: number | null; error?: string }>> {
    const usId = (await this.lookupParameter(accountId, "LOCATION", "United States")).found?.id;

    const candidates: Array<{ label: string; body: Record<string, unknown> }> = [
      { label: "keywords only", body: { api: "classic", category: "people", keywords: "Founder" } },
      {
        label: "keywords + location",
        body: { api: "classic", category: "people", keywords: "Founder", ...(usId ? { location: [usId] } : {}) },
      },
      {
        label: "keywords as a boolean OR",
        body: { api: "classic", category: "people", keywords: '"Founder" OR "Chief Executive Officer"' },
      },
      {
        label: "keywords + network_distance",
        body: { api: "classic", category: "people", keywords: "Founder", network_distance: [2, 3] },
      },
      {
        label: "advanced_keywords.title",
        body: { api: "classic", category: "people", advanced_keywords: { title: "Founder" } },
      },
      {
        label: "no filters at all",
        body: { api: "classic", category: "people" },
      },
    ];

    const params = new URLSearchParams({ account_id: accountId, limit: "1" });
    const out: Array<{ label: string; count: number | null; error?: string }> = [];
    for (const candidate of candidates) {
      try {
        const res = await this.request<{ items?: unknown[] }>(`${ROUTES.search}?${params.toString()}`, {
          method: "POST",
          body: JSON.stringify(candidate.body),
        });
        out.push({ label: candidate.label, count: (res.items ?? []).length });
      } catch (err) {
        // A refusal is as informative as a count: a rejected field names
        // itself, where one that is quietly ignored does not.
        out.push({
          label: candidate.label,
          count: null,
          error: (err as { message?: string })?.message ?? "unknown",
        });
      }
    }
    return out;
  }

  /**
   * Every account Unipile currently holds for this deployment.
   *
   * The hosted flow tells us an account connected by calling `notify_url`, and
   * until this existed that notification was the only way a row could ever be
   * bound. A delivery rejected once — a signature mismatch, a restart, a
   * webhook registered after the fact — left the account connected at Unipile
   * and permanently `connecting` here, with a Reconnect button that only ran
   * the same flow again.
   *
   * Asking is the recovery path: the answer is the same list the notification
   * carries, and `name` is the rep's user id either way.
   */
  async listAccounts(): Promise<ConnectedAccount[]> {
    const res = await this.request<{ items?: RawUnipileAccount[] }>(ROUTES.accounts);
    return toConnectedAccounts(res.items ?? []);
  }
}

/** One shape for a connected account, whether it arrived by push or by pull. */
function toConnectedAccounts(items: RawUnipileAccount[]): ConnectedAccount[] {
  return items
    .map((item) => ({
      providerAccountId: String(item.account_id ?? item.id ?? ""),
      // `name` is what we passed into the hosted flow.
      reference: String(item.name ?? item.reference ?? ""),
      displayName: typeof item.account_name === "string" ? item.account_name : undefined,
      status: mapAccountStatus(String(item.status ?? "OK")),
    }))
    // An entry naming neither the account nor the rep cannot be acted on, and
    // guessing which row it meant is how the wrong account gets bound to the
    // wrong person.
    .filter((account) => account.providerAccountId && account.reference);
}

interface RawUnipileAccount {
  id?: string;
  account_id?: string;
  name?: string;
  reference?: string;
  account_name?: string;
  status?: string;
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

/**
 * The search body, and what the tier could not express.
 *
 * Sales Navigator takes the whole customer profile. Classic search takes
 * keywords, titles, industry and location, and has no concept of seniority or
 * company headcount — so on classic those two are folded into the keyword
 * string, where they act as a weak text hint rather than a filter, and both are
 * reported as dropped. A filter that quietly becomes a suggestion is worse than
 * one that is missing, because the result still looks like what was asked for.
 */
/**
 * What the provider said, short enough to store beside the status.
 *
 * Error bodies here are small JSON objects — `type`, `title`, `detail` — and
 * the interesting part is a sentence. Truncated rather than dropped: an HTML
 * error page from something in front of the API is still worth the first line
 * of, because it says the request never reached Unipile at all.
 */
function said(body: string): string {
  const text = body.trim();
  if (!text) return "";
  let detail = text;
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === "object") {
      const { title, detail: d, type, message } = parsed as Record<string, unknown>;
      const parts = [title, d, message, type].filter((v): v is string => typeof v === "string" && v.trim() !== "");
      if (parts.length) detail = [...new Set(parts)].join(" — ");
    }
  } catch {
    // Not JSON. The raw first line is still the most informative thing here.
  }
  const oneLine = detail.replace(/\s+/g, " ").trim();
  return `: ${oneLine.length > 300 ? `${oneLine.slice(0, 300)}…` : oneLine}`;
}

/** The parameter lists this product needs ids from. */
type SearchParameterType = "LOCATION" | "INDUSTRY";

interface SearchParameter {
  id: string;
  /** LinkedIn's own name for it, which is often not the one we asked with. */
  title: string;
}

/**
 * The three answers a taxonomy lookup has, kept apart.
 *
 * `found` set is a term LinkedIn knows. `found: null` with no `failed` is a
 * term it does not have. `failed` is a term nobody managed to ask about, which
 * says nothing at all about whether LinkedIn has it.
 */
interface Lookup {
  found: SearchParameter | null;
  failed?: string;
}

interface ResolvedFilters {
  locations: string[];
  industries: string[];
  /** One sentence per term that was left out or became something else. */
  notes: string[];
}

/**
 * Several terms, as one field LinkedIn will match any of.
 *
 * Joined with spaces these are an AND: a profile had to contain "BNI" and
 * "chapter" and "membership" and "Chamber" and every seniority word, which
 * essentially nobody does. A list of titles is a list of alternatives, and has
 * to be written as one.
 */
function anyOf(terms: Array<string | undefined>): string | undefined {
  const quoted = terms
    .map((t) => t?.trim())
    .filter((t): t is string => Boolean(t))
    .map((t) => `"${t.replace(/"/g, "")}"`);
  if (quoted.length === 0) return undefined;
  return quoted.length === 1 ? quoted[0] : quoted.join(" OR ");
}

function toUnipileSearchBody(
  query: SearchQuery,
  tier: SearchTier,
  resolved: ResolvedFilters,
): { body: Record<string, unknown>; droppedFilters: string[] } {
  if (tier === "sales_navigator") {
    return {
      body: {
        api: "sales_navigator",
        category: "people",
        keywords: anyOf(query.keywords ?? []),
        title: query.titles?.length ? { include: query.titles, exclude: query.excludeTitles ?? [] } : undefined,
        seniority: query.seniorities?.length ? { include: query.seniorities } : undefined,
        industry: resolved.industries.length ? { include: resolved.industries } : undefined,
        company_headcount: query.companyHeadcount?.length ? query.companyHeadcount : undefined,
        location: resolved.locations.length ? { include: resolved.locations } : undefined,
      },
      droppedFilters: [],
    };
  }

  const droppedFilters: string[] = [];
  if (query.seniorities?.length) droppedFilters.push("seniority");
  if (query.companyHeadcount?.length) droppedFilters.push("company size");
  // Classic search has no exclude list. The scoring pass still sees every
  // candidate's title, so an excluded title is caught there rather than here —
  // it costs model spend it would not have cost on Sales Navigator.
  if (query.excludeTitles?.length) droppedFilters.push("excluded titles");

  return {
    body: {
      api: "classic",
      category: "people",
      // Seniority survives as a text hint rather than vanishing entirely, and
      // is still reported dropped above, because a hint is not a filter.
      keywords: anyOf([...(query.keywords ?? []), ...(query.seniorities ?? [])]),
      // Classic's one structured field for what someone does. Free text, not
      // an id — unlike location and industry, which are ids or nothing.
      advanced_keywords: query.titles?.length ? { title: anyOf(query.titles) } : undefined,
      industry: resolved.industries.length ? resolved.industries : undefined,
      location: resolved.locations.length ? resolved.locations : undefined,
      // First-degree connections cannot be invited — they already accepted. A
      // campaign that spends its daily invite allowance on them sends nothing.
      network_distance: [2, 3],
    },
    droppedFilters,
  };
}

/**
 * The same search, asked less and less precisely.
 *
 * Ordered by what a list can most afford to lose. Free-text keywords go first:
 * they are the loosest thing in a customer profile and the likeliest to exclude
 * somebody who is a perfect fit but does not use that word. The title filter
 * becomes ordinary keywords next, because classic search matches it against one
 * field and a person whose title is "Chapter Director" is missed by a filter
 * asking for "Chapter President". Industry goes last of the real filters, since
 * LinkedIn's taxonomy rarely matches how a business describes its own market.
 *
 * Location is never given up. A campaign that quietly starts messaging another
 * continent is worse than one that finds nobody.
 */
function relaxations(
  query: SearchQuery,
  tier: SearchTier,
  resolved: ResolvedFilters,
  full: Record<string, unknown>,
): Array<{ body: Record<string, unknown>; note?: string; last?: boolean }> {
  // Sales Navigator expresses the whole profile properly, so an empty result
  // there means an empty result, not a query we mangled.
  if (tier === "sales_navigator") return [{ body: full, last: true }];

  const steps: Array<{ body: Record<string, unknown>; note?: string; last?: boolean }> = [
    { body: full },
  ];

  const hasKeywords = Boolean(full.keywords);
  const hasTitle = Boolean(full.advanced_keywords);

  if (hasKeywords && hasTitle) {
    steps.push({
      body: { ...full, keywords: undefined },
      note: "Nobody matched every part of the profile at once, so the search was widened: the keywords were dropped and the titles kept.",
    });
  }

  if (hasTitle) {
    // Titles as ordinary keywords, which matches them anywhere on a profile
    // rather than against the one title field.
    steps.push({
      body: { ...full, advanced_keywords: undefined, keywords: anyOf(query.titles ?? []) },
      note: "Nobody matched the titles as written, so they were searched as keywords instead — this list is broader than the profile asked for.",
    });
  }

  if (resolved.industries.length > 0) {
    steps.push({
      body: {
        ...full,
        advanced_keywords: undefined,
        industry: undefined,
        keywords: anyOf([...(query.titles ?? []), ...(query.keywords ?? [])]),
      },
      note: "Nobody matched inside those industries, so the industry filter was dropped. Read the names carefully — this list is not filtered by industry at all.",
    });
  }

  steps[steps.length - 1]!.last = true;
  return steps;
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

/**
 * Unipile signs the timestamp and the body together, not the body alone:
 *
 *   unipile-signature: t=1710662400,v0=<hex>
 *   v0 = HMAC-SHA256(secret, `${t}.${rawBody}`)
 *
 * Verifying the body on its own — which is what this did — rejects every real
 * delivery. Because the webhook fails closed, the symptom is not an error
 * anyone sees: inbound replies simply never arrive, and a connected LinkedIn
 * account never finishes binding. The campaign looks like it is running and
 * nobody is answering.
 *
 * The plain-body form is still accepted so a deployment that predates this, or
 * any sender configured to sign the body directly, keeps working. Both forms
 * require the shared secret; neither is weaker than the other.
 *
 * There is deliberately no freshness window on `t`. Unipile retries a delivery
 * the endpoint rejected, and a window narrow enough to be worth having would
 * reject those retries permanently — trading a replay we are already idempotent
 * against (a message is queued under its own id; an account binds only from
 * `connecting`) for the exact silent failure described above.
 */
function verifySignature(body: string, signature: string, secret: string): boolean {
  const timestamp = /(?:^|,)\s*t=(\d+)\s*(?=,|$)/.exec(signature)?.[1];
  const v0 = /(?:^|,)\s*v0=([0-9a-fA-F]+)\s*(?=,|$)/.exec(signature)?.[1];

  if (timestamp && v0) {
    return hexEquals(createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex"), v0);
  }
  return hexEquals(createHmac("sha256", secret).update(body).digest("hex"), signature.replace(/^sha256=/, "").trim());
}

/** Constant-time, and length-safe: timingSafeEqual throws on a length mismatch. */
function hexEquals(expected: string, actual: string): boolean {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(actual.toLowerCase(), "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}
