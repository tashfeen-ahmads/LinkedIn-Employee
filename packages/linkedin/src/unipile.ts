import { createHmac, timingSafeEqual } from "node:crypto";
import type { ProspectCandidate } from "@le/shared";
import type {
  AccountPlan,
  AccountHealth,
  ActionResult,
  PublishPostInput,
  HostedAuthLink,
  InboundMessage,
  LinkedInProvider,
  ProspectPage,
  SearchTier,
  ConnectedAccount,
  ProviderProfile,
  ProviderRelation,
  SearchQuery,
  PendingInvitation,
  PostReaction,
  ProviderPost,
} from "./provider.js";
import type { ClassicPosition } from "./cursor.js";
import { decodeClassicCursor, encodeClassicCursor, isClassicCursor } from "./cursor.js";

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
  posts: "/api/v1/posts",
  userPosts: (id: string) => `/api/v1/users/${encodeURIComponent(id)}/posts`,
  postReaction: "/api/v1/posts/reaction",
  postComments: (id: string) => `/api/v1/posts/${encodeURIComponent(id)}/comments`,
  chatMessages: (id: string) => `/api/v1/chats/${id}/messages`,
  messages: "/api/v1/messages",
  relations: "/api/v1/users/relations",
  inmailBalance: "/api/v1/linkedin/inmail_balance",
  webhooks: "/api/v1/webhooks",
  webhook: (id: string) => `/api/v1/webhooks/${id}`,
} as const;

/** Unipile's own ceiling for a page of results; larger is a 400. */
const PAGE_MAX = 100;
/** How many pages of pending invitations are worth reading before the answer stops changing. */
const MAX_PAGES = 5;

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

interface RawUnipilePost {
  social_id?: string;
  share_url?: string;
  text?: string;
  parsed_datetime?: string;
  is_repost?: boolean;
  permissions?: { can_react?: boolean; can_post_comments?: boolean };
}

interface UnipileRawProfile {
  id?: string;
  provider_id?: string;
  public_identifier?: string;
  public_profile_url?: string;
  profile_url?: string;
  /** Search results carry one full name; the profile endpoint splits it. */
  name?: string;
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
   *
   * Only a match is kept. A miss is asked again next time: a wrong answer
   * cached here is wrong for every search this process runs, and the price of
   * asking again is one request.
   */
  private readonly parameterIds = new Map<string, Lookup>();

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
        // JSON bodies only: a form sets its own multipart boundary, and a
        // content-type written over it makes the body unreadable.
        ...(typeof init.body === "string" ? { "content-type": "application/json" } : {}),
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

  /**
   * Which paid LinkedIn plans the account has, from its InMail balances.
   *
   * The balance call answers per product and leaves a product the account is
   * not subscribed to empty, which is the only place the provider says what
   * the account pays for. Any failure is null, never "free": a lookup that
   * could not look must not take an account's notes away (rule 17).
   */
  async getAccountPlan(accountId: string): Promise<AccountPlan | null> {
    try {
      const res = await this.request<Record<string, unknown>>(
        `${ROUTES.inmailBalance}?account_id=${encodeURIComponent(accountId)}`,
      );
      const has = (key: string) => {
        const value = res[key];
        return value !== null && value !== undefined && value !== false;
      };
      if (!("premium" in res) && !("sales_navigator" in res)) return null;
      return { premium: has("premium") || has("sales_navigator"), salesNavigator: has("sales_navigator") };
    } catch {
      return null;
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
    const limit = input.limit ?? 50;

    const resolved = await this.resolveFilters(input.accountId, input.query);
    const { body, droppedFilters } = toUnipileSearchBody(input.query, tier, resolved);
    const notes = [...resolved.notes];

    // Sales Navigator takes the whole profile as one structured query, which is
    // what the seat is for.
    if (tier === "sales_navigator") {
      // The first Sales Navigator account this product ever searched with was
      // refused six times in a row with "Invalid parameters", and the customer
      // sat on "building your campaign" with no list and no way forward. A
      // field the provider will not take is not a reason to find nobody: the
      // whole profile is asked first, then the part every search accepts, and
      // only then regular search, each step named on the campaign.
      const attempts = [
        { attempt: "full" as const, body, droppedFilters, note: null as string | null },
        { attempt: "partial" as const, ...salesNavigatorFallback(input.query, resolved) },
      ];

      // A position belongs to the search that produced it. The narrower search
      // is a different result set, so a cursor from it handed to the full one
      // (or the other way round) is a position in a list nobody asked for. The
      // next run resumes the step that answered last time, and only that step
      // gets the cursor. A classic position describes six searches and means
      // nothing here; an account that gained a seat since the last run carries one.
      const resume = readSalesNavigatorCursor(input.cursor);
      const from = resume ? attempts.findIndex((a) => a.attempt === resume.attempt) : 0;

      for (const attempt of attempts.slice(from)) {
        const params = new URLSearchParams({ account_id: input.accountId, limit: String(limit) });
        if (resume && resume.attempt === attempt.attempt) params.set("cursor", resume.cursor);
        try {
          const res = await this.request<{ items?: UnipileRawProfile[]; cursor?: string | null }>(
            `${ROUTES.search}?${params.toString()}`,
            { method: "POST", body: JSON.stringify(attempt.body) },
          );
          return {
            items: (res.items ?? []).map(toProspectCandidate),
            cursor: res.cursor ? `${SALES_NAVIGATOR_CURSOR_PREFIX[attempt.attempt]}${res.cursor}` : null,
            droppedFilters: attempt.droppedFilters,
            filterNotes: attempt.note ? [...notes, attempt.note] : notes,
          };
        } catch (err) {
          if (!isRefusedSearch(err)) throw err;
        }
      }

      // Regular search runs on any account, a seat included. Its position
      // carries over only when the last run already fell back here.
      const classic = await this.searchProspects({
        ...input,
        tier: "classic",
        cursor: input.cursor && isClassicCursor(input.cursor) ? input.cursor : undefined,
      });
      return {
        ...classic,
        filterNotes: [salesNavigatorRefusedNote(classic.droppedFilters), ...(classic.filterNotes ?? [])],
      };
    }

    // Classic search has one keyword box, and a box is not a query language.
    // Unipile's own documented example passes plain text -- `"keywords":
    // "product manager"` -- so a boolean string built from eight titles goes
    // into that box literally and matches nobody. That is exactly what the
    // first live campaign got: a widening ladder that ran every step it had,
    // down to a keyword plus two countries and second-and-third degree, and
    // still returned zero people. That is not an answer the real LinkedIn
    // gives to that query.
    //
    // So the profile is asked one term at a time, the way a person would type
    // it, and the answers are merged. More requests, but each is a question
    // LinkedIn can actually answer.
    const terms = classicTerms(input.query);
    const resume = decodeClassicCursor(input.cursor);

    // Where the last pass attempted got to, for the case where it answered with
    // nobody at all. An empty page is usually the end, but a provider that
    // hands back a cursor with it is saying otherwise, and reading that as the
    // end would retire a search that still had people in it.
    let position: ClassicPosition | null = null;

    for (const round of [0, 1]) {
      // A resumed search does not redo the passes it already finished.
      if (resume && round < resume.round) continue;

      // Second pass without the industry filter. LinkedIn's taxonomy rarely
      // matches how a business describes its own market, and this profile
      // named four industries, one of which LinkedIn does not have at all.
      const withIndustry = round === 0 && resolved.industries.length > 0;

      // Where each term begins. A pass being resumed begins where it stopped,
      // and only for the terms that had anything left; any other pass begins at
      // the first page of every term.
      const start =
        resume && round === resume.round
          ? { ...resume.terms }
          : Object.fromEntries(terms.map((t) => [t, ""]));

      // Advanced as each term answers, and carried into the cursor below. A
      // term this run had no room to reach keeps its starting position rather
      // than being skipped, or the next run would step over it entirely.
      const next: Record<string, string> = { ...start };
      const merged = new Map<string, UnipileRawProfile>();

      for (const [term, at] of Object.entries(start)) {
        // Each term asks for what is still missing rather than a full page, so
        // the merged list stops at the limit instead of overshooting it. The
        // overshoot used to be trimmed off the end -- which was fine while
        // every run started from the first page, and throws away people whose
        // page has now been read and paid for.
        const want = limit - merged.size;
        if (want <= 0) break;

        const params = new URLSearchParams({ account_id: input.accountId, limit: String(want) });
        if (at) params.set("cursor", at);

        const res = await this.request<{ items?: UnipileRawProfile[]; cursor?: string | null }>(
          `${ROUTES.search}?${params.toString()}`,
          {
            method: "POST",
            body: JSON.stringify({
              api: "classic",
              category: "people",
              keywords: term,
              ...(withIndustry ? { industry: resolved.industries } : {}),
              // Never given up, at any stage. A campaign that quietly starts
              // messaging another continent is worse than one finding nobody.
              ...(resolved.locations.length ? { location: resolved.locations } : {}),
              // Second degree only. Third-degree profiles come back as
              // "LinkedIn Member" with no name and no address -- real people,
              // but nobody a reviewer can check and nobody an invitation
              // should be spent on. Second-degree profiles carry their name,
              // headline and vanity URL, and a shared connection is also the
              // stronger reason to accept a request.
              network_distance: [2],
            }),
          },
        );
        for (const item of res.items ?? []) {
          const id = item.provider_id ?? item.id ?? item.public_identifier ?? "";
          if (id && !merged.has(id)) merged.set(id, item);
        }

        // No cursor back means this term has no more people to give. It leaves
        // the position entirely: an exhausted term asked again from the start
        // returns the same first page for as long as the campaign runs.
        if (res.cursor) next[term] = res.cursor;
        else delete next[term];
      }

      position = nextPosition(round, next, terms, withIndustry);

      if (merged.size > 0) {
        if (terms.length > 1) {
          notes.push(
            `Classic search takes one keyword at a time, so the profile was searched as ${terms.length} separate queries and the results combined: ${terms.join(", ")}.`,
          );
        }
        // Each term is its own search, so a title and a keyword the profile
        // asked for together came back as either one. The mechanics stay (one
        // box, one term), and the reviewer is told what the list therefore is.
        if (hasAny(input.query.titles) && hasAny(input.query.keywords)) {
          notes.push(CLASSIC_TITLES_OR_KEYWORDS_NOTE);
        }
        if (!withIndustry && resolved.industries.length > 0) {
          notes.push(
            "Nobody matched inside those industries, so the industry filter was dropped. Read the names carefully — this list is not filtered by industry at all.",
          );
        }
        return {
          items: [...merged.values()].map(toProspectCandidate),
          cursor: encodeClassicCursor(position),
          droppedFilters,
          filterNotes: notes,
        };
      }

      if (!withIndustry) break;
    }

    return { items: [], cursor: encodeClassicCursor(position), droppedFilters, filterNotes: notes };
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
        // Only a deliberate rename says "searched as". A place matched by its
        // full name ("New York, NY" is "New York, New York, United States") is
        // the same place, and saying otherwise teaches people to skip notes.
        if (looked.renamed) {
          notes.push(`The ${field} "${name}" was searched as LinkedIn's "${hit.title}".`);
        } else if (looked.ambiguous) {
          notes.push(
            `The ${field} "${name}" names more than one place on LinkedIn, so it was searched as "${hit.title}". Name the state or country to pick another.`,
          );
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

  /**
   * One name, one id, asked once per process once it has matched.
   *
   * An industry LinkedIn renamed in 2022 is asked by its current name first,
   * because the typeahead does not know the old one and answers it with
   * whatever happens to contain its words.
   */
  private async lookupParameter(
    accountId: string,
    type: SearchParameterType,
    name: string,
  ): Promise<Lookup> {
    const key = `${type}:${normaliseParameter(name)}`;
    const cached = this.parameterIds.get(key);
    if (cached) return cached;

    const current = type === "INDUSTRY" ? currentIndustryName(name) : undefined;
    let looked: Lookup | undefined;
    if (current) {
      const renamed = await this.askParameter(accountId, type, current);
      if (renamed.failed) return renamed;
      if (renamed.found) looked = { ...renamed, renamed: true };
    }
    looked ??= await this.askParameter(accountId, type, name);
    if (looked.failed) return looked;

    if (looked.found) this.parameterIds.set(key, looked);
    return looked;
  }

  /** One typeahead request, and only a candidate that genuinely is the term. */
  private async askParameter(
    accountId: string,
    type: SearchParameterType,
    name: string,
  ): Promise<Lookup> {
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

    const usable = items.filter((i): i is typeof i & { id: string } => typeof i.id === "string" && i.id !== "");
    const match = matchParameter(type, name, usable.map((i) => i.title ?? i.name ?? ""));
    if (!match) return { found: null };
    const hit = usable[match.index]!;
    return { found: { id: hit.id, title: hit.title ?? hit.name ?? name }, ambiguous: match.ambiguous || undefined };
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

  /**
   * Fetch the profile through the rep's own session, which is what registers
   * the view.
   *
   * The same endpoint `getProfile` uses, deliberately: there is no separate
   * "view" call because on LinkedIn there is no separate act — opening
   * somebody's profile is what notifies them, and this is that request made
   * on purpose rather than as a side effect of research.
   *
   * The profile it returns is thrown away. The caller wants to know the view
   * happened, and handing back a profile here would invite somebody to use
   * this in place of `getProfile` and spend a visible action on research.
   */
  async viewProfile(input: { accountId: string; providerId: string }): Promise<ActionResult> {
    try {
      const params = new URLSearchParams({ account_id: input.accountId });
      await this.request(`${ROUTES.profile(input.providerId)}?${params.toString()}`);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
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

  /**
   * The invitations LinkedIn still has outstanding for this account.
   *
   * Mapped defensively and handed back with the raw payload, because this
   * product cannot read Unipile's documentation from its build environment and
   * a field name guessed wrong here reports "0 pending" for an account
   * drowning in them — which is worse than reporting nothing at all.
   */
  async listPendingInvitations(input: {
    accountId: string;
    limit?: number;
  }): Promise<{ invitations: PendingInvitation[]; raw: unknown; truncated: boolean }> {
    /*
     * A hundred at a time, because that is Unipile's ceiling.
     *
     * Asking for five hundred is a 400 — "the value can be set between 1 and
     * 100" — and this product spent an afternoon reading that rejection as a
     * mysterious failure rather than as the schema it literally contains.
     *
     * Paged rather than capped at one request, because the question is "is
     * this account carrying a backlog", and a backlog is precisely the case
     * where one page is not the answer. Bounded all the same: five pages is
     * five hundred invitations, which is far past the point where the answer
     * stops being interesting and the recommendation stops changing.
     */
    const wanted = Math.min(Math.max(input.limit ?? PAGE_MAX, 1), PAGE_MAX * MAX_PAGES);
    const rows: unknown[] = [];
    let cursor: string | null = null;
    let raw: unknown = null;
    let truncated = false;

    for (let page = 0; page < MAX_PAGES && rows.length < wanted; page += 1) {
      const params = new URLSearchParams({ account_id: input.accountId });
      params.set("limit", String(Math.min(PAGE_MAX, wanted - rows.length)));
      if (cursor) params.set("cursor", cursor);

      const body = await this.request<{ items?: unknown[]; cursor?: string | null }>(
        `${ROUTES.invitationsSent}?${params.toString()}`,
      );
      if (page === 0) raw = body;

      const items = Array.isArray(body) ? body : Array.isArray(body?.items) ? body.items : [];
      rows.push(...items);

      cursor = (body as { cursor?: string | null })?.cursor ?? null;
      if (!cursor || items.length === 0) break;
      // More to read than we were willing to ask for. Said out loud rather
      // than rounded down: "500" and "at least 500" are different answers to
      // "is this account crowded".
      if (page === MAX_PAGES - 1) truncated = true;
    }

    const invitations = rows.map((row) => {
      const r = (row ?? {}) as Record<string, unknown>;
      const str = (...keys: string[]): string | null => {
        for (const key of keys) {
          const value = r[key];
          if (typeof value === "string" && value.trim()) return value;
        }
        return null;
      };
      return {
        invitationId: str("invitation_id", "id"),
        providerId: str("provider_id", "member_id", "user_id", "recipient_id"),
        name: str("name", "full_name", "display_name"),
        sentAt: str("sent_at", "created_at", "date", "invited_at"),
      };
    });

    return { invitations, raw, truncated };
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

  async deleteAccount(accountId: string): Promise<ActionResult> {
    try {
      await this.request(ROUTES.account(accountId), { method: "DELETE" });
      return { ok: true };
    } catch (err) {
      // Already gone is the outcome being asked for.
      if (err instanceof UnipileError && err.status === 404) return { ok: true };
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
        return { ok: true, providerId: res.message_id, chatId: input.chatId };
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
      // The message and the chat it opened are two ids, kept apart: the chat is
      // what the conversation row needs so the next message continues it.
      return { ok: true, providerId: res.message_id, chatId: res.chat_id };
    } catch (err) {
      return toActionError(err);
    }
  }

  /**
   * Publish to the account holder's own profile.
   *
   * The failure is handed back rather than thrown, exactly as every other
   * action here does: the provider's own sentence — "422: ..." — is the most
   * useful thing in a refusal, and it used to end up in a log on a host the
   * person who pressed the button cannot reach (rule 25). The caller writes
   * it onto the row so the screen can say what happened.
   */
  async publishPost(input: PublishPostInput): Promise<ActionResult> {
    try {
      // A form, as the provider's own SDK sends it: the picture travels as a
      // file under `attachments`, and a post without one is the same form
      // with that field left out.
      const body = new FormData();
      body.append("account_id", input.accountId);
      body.append("text", input.text);
      if (input.image) {
        body.append(
          "attachments",
          new Blob([input.image.data], { type: input.image.contentType }),
          input.image.filename,
        );
      }
      const res = await this.request<{ post_id?: string; id?: string }>(ROUTES.posts, {
        method: "POST",
        body,
      });
      return { ok: true, providerId: res.post_id ?? res.id };
    } catch (err) {
      return toActionError(err);
    }
  }

  async listPosts(input: { accountId: string; userId: string; limit?: number }): Promise<ProviderPost[]> {
    const params = new URLSearchParams({ account_id: input.accountId, limit: String(input.limit ?? 5) });
    const res = await this.request<{ items?: RawUnipilePost[] }>(`${ROUTES.userPosts(input.userId)}?${params.toString()}`);
    return (res.items ?? [])
      .filter((post) => typeof post.social_id === "string" && post.social_id)
      .map((post) => ({
        socialId: post.social_id as string,
        url: post.share_url ?? null,
        text: post.text ?? "",
        postedAt: post.parsed_datetime ?? null,
        isRepost: Boolean(post.is_repost),
        canReact: post.permissions?.can_react !== false,
        canComment: post.permissions?.can_post_comments !== false,
      }));
  }

  /**
   * React to a post by its social id. The id in a post's URL can fail here,
   * which is why `listPosts` carries the social id and nothing else.
   */
  async reactToPost(input: { accountId: string; postId: string; reaction: PostReaction }): Promise<ActionResult> {
    try {
      await this.request(ROUTES.postReaction, {
        method: "POST",
        body: JSON.stringify({ account_id: input.accountId, post_id: input.postId, reaction_type: input.reaction }),
      });
      return { ok: true };
    } catch (err) {
      return toActionError(err);
    }
  }

  async commentOnPost(input: { accountId: string; postId: string; text: string }): Promise<ActionResult> {
    try {
      await this.request(ROUTES.postComments(input.postId), {
        method: "POST",
        body: JSON.stringify({ account_id: input.accountId, text: input.text }),
      });
      return { ok: true };
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
    /*
     * Paged with the provider's cursor, as `listPendingInvitations` is.
     *
     * One page of a hundred was the whole answer, so an account that gained
     * more than a hundred connections since the oldest outstanding invitation
     * never saw the older acceptances: those prospects sat at `invited` and
     * their follow-ups never sent. Newest first, so paging stops at the first
     * page that reaches past `since`; bounded all the same, because every
     * request comes off a seat somebody pays for.
     */
    const wanted = Math.min(Math.max(input.limit ?? PAGE_MAX * MAX_PAGES, 1), PAGE_MAX * MAX_PAGES);
    const items: Array<Record<string, unknown>> = [];
    let cursor: string | null = null;

    for (let page = 0; page < MAX_PAGES && items.length < wanted; page += 1) {
      const params = new URLSearchParams({
        account_id: input.accountId,
        limit: String(Math.min(PAGE_MAX, wanted - items.length)),
      });
      if (cursor) params.set("cursor", cursor);
      const response: { items?: Array<Record<string, unknown>>; cursor?: string | null } = await this.request<{
        items?: Array<Record<string, unknown>>;
        cursor?: string | null;
      }>(`${ROUTES.relations}?${params.toString()}`);

      const pageItems = Array.isArray(response?.items) ? response.items : [];
      items.push(...pageItems);
      cursor = response?.cursor ?? null;
      if (!cursor || pageItems.length === 0) break;
      // Everything older than `since` is filtered out below anyway, so a page
      // that already reaches past it is the last one worth reading.
      const dated = pageItems
        .map((item) => (typeof item.created_at === "string" ? item.created_at : null))
        .filter((value): value is string => Boolean(value));
      if (input.since && dated.some((value) => value < input.since!)) break;
    }

    const relations = items.map((item) => ({
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

  /**
   * Whether a delivery really came from Unipile. One check, for both webhooks.
   *
   * Unipile authenticates webhooks two different ways depending on which API
   * created them, and this accepted only one of them. Its v2 API signs every
   * delivery with an HMAC in `unipile-signature`. Its v1 API — the one this
   * deployment uses for everything — does not sign at all: a v1 webhook is
   * created with a `headers` array, and the documented way to authenticate it
   * is to put a shared secret in a custom header such as `Unipile-Auth`.
   *
   * So every webhook this deployment ever registered arrived with no
   * `unipile-signature`, was refused as unsigned, and no secret anybody could
   * set in Unipile would have changed that: the header being waited for is one
   * v1 never sends. Prospect replies were dropped at the door for weeks, on the
   * trial account and the premium one alike, while the advice — "set the
   * signing secret" — pointed at a setting that does not exist for v1.
   *
   * Both are accepted now, and neither loosens rule 8. The secret is still
   * required; a delivery with neither credential, or with one that does not
   * match, is still refused; and the header is compared in constant time, as
   * the signature is. What changed is only which of Unipile's two real
   * mechanisms counts as proof.
   */
  private verifyDelivery(input: { body: string; signature?: string; authHeader?: string }): void {
    if (!this.webhookSecret) {
      throw new Error("Unipile webhook secret is not configured; refusing to accept unverified deliveries");
    }
    const signed = Boolean(input.signature) && verifySignature(input.body, input.signature!, this.webhookSecret);
    const headed = Boolean(input.authHeader) && secretEquals(input.authHeader!, this.webhookSecret);
    if (!signed && !headed) {
      throw new Error("Invalid Unipile webhook signature");
    }
  }

  parseWebhook(input: { body: string; signature?: string; authHeader?: string }): InboundMessage[] {
    // Fails closed. An unverified webhook is an open door: a forged delivery
    // makes the Reply Agent answer a message no prospect ever sent, in a real
    // rep's name, so an unconfigured secret must reject rather than accept.
    this.verifyDelivery(input);
    const parsed = JSON.parse(input.body) as RawUnipileMessage | { items?: RawUnipileMessage[] };
    const items = "items" in parsed && Array.isArray(parsed.items) ? parsed.items : [parsed as RawUnipileMessage];
    return items.filter((m) => !m.is_sender).map((m) => toInboundMessage(m, m.account_id ?? ""));
  }

  parseAccountWebhook(input: { body: string; signature?: string; authHeader?: string }): ConnectedAccount[] {
    // Fails closed for the same reason the message webhook does, and one more:
    // a forged delivery would bind a stranger's LinkedIn account to a rep's
    // row, and every message the campaign sends would leave that account.
    this.verifyDelivery(input);

    const parsed = JSON.parse(input.body) as RawUnipileAccount | { items?: RawUnipileAccount[] };
    const items = "items" in parsed && Array.isArray(parsed.items) ? parsed.items : [parsed as RawUnipileAccount];
    return toConnectedAccounts(items, "push");
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
   *
   * `salesNavigator` asks Sales Navigator's fields instead of classic's.
   */
  async probeSearch(
    accountId: string,
    options: { salesNavigator?: boolean } = {},
  ): Promise<Array<{ label: string; count: number | null; error?: string }>> {
    const usId = (await this.lookupParameter(accountId, "LOCATION", "United States")).found?.id;
    const sn = (extra: Record<string, unknown>) => ({ api: "sales_navigator", category: "people", keywords: "Founder", ...extra });

    const classic: Array<{ label: string; body: Record<string, unknown> }> = [
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
    // Sales Navigator, one field at a time, in each shape it might take. The
    // first live seat had every search refused as "Invalid parameters", and
    // the refusal names the field only here, where it is asked alone. Asked
    // instead of the classic probes, not as well: the question is which
    // Sales Navigator field was refused, and every probe is a request off a
    // paid seat.
    const salesNavigator: Array<{ label: string; body: Record<string, unknown> }> = [
      { label: "SN keywords only", body: sn({}) },
      { label: "SN location", body: sn(usId ? { location: { include: [usId] } } : {}) },
      { label: "SN role", body: sn({ role: { include: ["Founder"] } }) },
      { label: "SN title", body: sn({ title: { include: ["Founder"] } }) },
      { label: "SN seniority owner/partner", body: sn({ seniority: { include: ["owner/partner"] } }) },
      { label: "SN seniority director", body: sn({ seniority: { include: ["director"] } }) },
      { label: "SN seniority as an id", body: sn({ seniority: { include: ["220"] } }) },
      { label: "SN headcount as a range", body: sn({ company_headcount: [{ min: 11, max: 50 }] }) },
      { label: "SN headcount as text", body: sn({ company_headcount: ["11-50"] }) },
    ];
    const candidates = options.salesNavigator ? salesNavigator : classic;

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
  /** Diagnostic: the raw keys the provider sent, and the shape of each value. */
  async describeAccountFields(): Promise<Array<Record<string, string>>> {
    const res = await this.request<{ items?: Record<string, unknown>[] }>(ROUTES.accounts);
    return (res.items ?? []).map((item) => {
      const out: Record<string, string> = {};
      for (const [key, value] of Object.entries(item)) {
        if (value === null || value === undefined) out[key] = "null";
        else if (typeof value === "string") out[key] = shapeOfValue(value);
        else if (Array.isArray(value)) out[key] = `array(${value.length})`;
        else out[key] = typeof value;
      }
      return out;
    });
  }

  /**
   * Register this deployment's webhooks with the secret as a header.
   *
   * Unipile's v1 webhooks are not signed; the only way a delivery proves where
   * it came from is a header configured on the webhook itself. Leaving that to
   * somebody in the provider's dashboard meant every prospect reply was refused
   * at the door for days — correctly, and silently. So the worker does it.
   *
   * Created first. Only once the new one exists are older webhooks pointing at
   * the same address removed: they are ours by address, they carry no header
   * (or a stale one), and left in place each delivery would arrive twice, once
   * refused. A failure to create leaves everything exactly as it was.
   */
  async ensureWebhooks(input: {
    secret: string;
    endpoints: Array<{ source: "messaging" | "account_status"; url: string; name: string }>;
  }): Promise<{ created: number; removed: number }> {
    const existing = await this.request<{ items?: Array<{ id?: string; request_url?: string }> }>(ROUTES.webhooks);
    let created = 0;
    let removed = 0;
    for (const endpoint of input.endpoints) {
      const res = await this.request<{ webhook_id?: string; id?: string }>(ROUTES.webhooks, {
        method: "POST",
        body: JSON.stringify({
          request_url: endpoint.url,
          name: endpoint.name,
          source: endpoint.source,
          format: "json",
          headers: [{ key: "Unipile-Auth", value: input.secret }],
        }),
      });
      created++;
      const keep = res.webhook_id ?? res.id;
      for (const old of existing.items ?? []) {
        if (!old.id || old.id === keep || old.request_url !== endpoint.url) continue;
        await this.request(ROUTES.webhook(old.id), { method: "DELETE" });
        removed++;
      }
    }
    return { created, removed };
  }

  async listAccounts(): Promise<ConnectedAccount[]> {
    const res = await this.request<{ items?: RawUnipileAccount[] }>(ROUTES.accounts);
    return toConnectedAccounts(res.items ?? [], "pull");
  }
}

/**
 * One shape for a connected account, whether it arrived by push or by pull —
 * read differently for each, because the two payloads use `name` for
 * different things.
 *
 * Push (the hosted flow's notify webhook) echoes back the rep's user id we
 * handed the link, in `name`. Pull (`GET /api/v1/accounts`) has no field
 * holding that id at all — no `reference` — and its `name` is the LinkedIn
 * profile's display name. Reading `reference ?? name` on both made every
 * pulled account "reference: Tashfeen Ahmad", so `reference === userId` never
 * matched and recovery repaired nothing, while `account_name`, which the pull
 * payload does not carry, left every display name null.
 *
 * So a pulled account carries a reference only if the provider ever sends a
 * real one, and its `name` becomes the display name. Binding on the pull path
 * goes by the account id that came back on the rep's own signed return
 * (`pending_provider_account_id`), never by a display name (rule 8).
 */
function toConnectedAccounts(items: RawUnipileAccount[], via: "push" | "pull"): ConnectedAccount[] {
  return items
    .map((item) => ({
      providerAccountId: String(item.account_id ?? item.id ?? ""),
      reference: String((via === "push" ? (item.reference ?? item.name) : item.reference) ?? ""),
      displayName:
        typeof item.account_name === "string"
          ? item.account_name
          : via === "pull" && typeof item.name === "string" && item.name.trim()
            ? item.name
            : undefined,
      status: mapAccountStatus(String(item.status ?? "OK")),
    }))
    // An entry naming no account cannot be acted on. A delivery naming no rep
    // cannot either — guessing which row it meant is how the wrong account
    // gets bound to the wrong person — but a pulled account never names one,
    // and is kept so the id a rep's own return carried can be found in it.
    .filter((account) => account.providerAccountId && (via === "pull" || account.reference));
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
  /**
   * How the `message_received` webhook names the sender: an object rather than
   * the flat `sender_id` the messages list uses. `attendee_provider_id` is the
   * LinkedIn member id, the one `prospects.provider_id` holds.
   */
  sender?: { attendee_provider_id?: string; attendee_id?: string } | null;
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
    // The flat fields first, as they always were; the webhook's nested sender
    // after them. Without the nested form every webhook delivery carried an
    // empty sender, matched no prospect, and the reply was dropped — the poll
    // was then the only door that worked.
    fromProviderId:
      m.sender_id ||
      m.sender_attendee_id ||
      (typeof m.sender === "object" && m.sender
        ? m.sender.attendee_provider_id || m.sender.attendee_id || ""
        : ""),
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
  /** Found under LinkedIn's current name for a renamed industry. */
  renamed?: boolean;
  /** A place named without its region, and more than one place has that name. */
  ambiguous?: boolean;
}

/**
 * LinkedIn's 2022 industry taxonomy renamed most industries, and the Strategy
 * Agent still writes the old names. The typeahead does not know an old name;
 * asked "Computer Software" it answers with whatever contains those words.
 *
 * Only renames whose current name is certain are listed. A wrong entry here is
 * a confident wrong search, which is the bug this table exists to prevent, so
 * an old name missing from it is dropped and named instead.
 */
export const INDUSTRY_RENAMES: Readonly<Record<string, string>> = {
  "Computer Software": "Software Development",
  "Information Technology and Services": "IT Services and IT Consulting",
  "Hospital & Health Care": "Hospitals and Health Care",
  "Management Consulting": "Business Consulting and Services",
  "Health, Wellness & Fitness": "Wellness and Fitness Services",
  "Marketing and Advertising": "Advertising Services",
  "Education Management": "Education Administration Programs",
  Internet: "Technology, Information and Internet",
  "Human Resources": "Human Resources Services",
  "Medical Practice": "Medical Practices",
  "Nonprofit Organization Management": "Non-profit Organizations",
  "Medical Devices": "Medical Equipment Manufacturing",
  Pharmaceuticals: "Pharmaceutical Manufacturing",
  "Food & Beverages": "Food and Beverage Services",
  "E-Learning": "E-Learning Providers",
  "Primary/Secondary Education": "Primary and Secondary Education",
  "Logistics and Supply Chain": "Transportation, Logistics, Supply Chain and Storage",
  "Public Relations and Communications": "Public Relations and Communications Services",
  "Venture Capital & Private Equity": "Venture Capital and Private Equity Principals",
  "Computer Hardware": "Computer Hardware Manufacturing",
};

const INDUSTRY_RENAME_INDEX = new Map(
  Object.entries(INDUSTRY_RENAMES).map(([old, current]) => [normaliseParameter(old), current]),
);

export function currentIndustryName(name: string): string | undefined {
  return INDUSTRY_RENAME_INDEX.get(normaliseParameter(name));
}

/** Case, spacing, punctuation and "&" against "and" do not make a different term. */
export function normaliseParameter(text: string): string {
  return text
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * Region abbreviations people write after a city, to what LinkedIn writes.
 * A value is a list because "CA" is California and also Canada; the city has
 * already matched by then, so either reading is the place that was meant.
 */
const REGION_ALIASES: Record<string, string[]> = {
  al: ["alabama"], ak: ["alaska"], az: ["arizona"], ar: ["arkansas"], ca: ["california", "canada"],
  co: ["colorado"], ct: ["connecticut"], de: ["delaware", "germany"], fl: ["florida"], ga: ["georgia"],
  hi: ["hawaii"], id: ["idaho"], il: ["illinois"], in: ["indiana", "india"], ia: ["iowa"], ks: ["kansas"],
  ky: ["kentucky"], la: ["louisiana"], me: ["maine"], md: ["maryland"], ma: ["massachusetts"],
  mi: ["michigan"], mn: ["minnesota"], ms: ["mississippi"], mo: ["missouri"], mt: ["montana"],
  ne: ["nebraska"], nv: ["nevada"], nh: ["new hampshire"], nj: ["new jersey"], nm: ["new mexico"],
  ny: ["new york"], nc: ["north carolina"], nd: ["north dakota"], oh: ["ohio"], ok: ["oklahoma"],
  or: ["oregon"], pa: ["pennsylvania"], ri: ["rhode island"], sc: ["south carolina"],
  sd: ["south dakota"], tn: ["tennessee"], tx: ["texas"], ut: ["utah"], vt: ["vermont"],
  va: ["virginia"], wa: ["washington"], wv: ["west virginia"], wi: ["wisconsin"], wy: ["wyoming"],
  dc: ["district of columbia"], "d c": ["district of columbia"],
  us: ["united states"], usa: ["united states"], "u s": ["united states"], "u s a": ["united states"],
  uk: ["united kingdom"], "u k": ["united kingdom"], uae: ["united arab emirates"],
};

function regionMatches(region: string, segments: string[]): boolean {
  const wanted = [region, ...(REGION_ALIASES[region] ?? [])];
  return segments.some((segment) => wanted.includes(segment));
}

/**
 * Which typeahead candidate, if any, genuinely is the term.
 *
 * The typeahead answers with whatever contains the words, in its own order:
 * asked "New York, NY" it put Nyack first, asked "Residential Real Estate" it
 * offered "Leasing Non-residential Real Estate". Taking its first answer sent
 * a real message about "HUD matters around Nyack". So a candidate counts only
 * when its name is the term, or, for a place, when its city is the term's city
 * and it lies in every region the term names. An exact name wins over a city
 * match. Anything else is nothing, and the caller names it as dropped.
 */
export function matchParameter(
  type: SearchParameterType,
  term: string,
  candidates: string[],
): { index: number; ambiguous: boolean } | null {
  const wanted = normaliseParameter(term);
  if (!wanted) return null;

  const exact = candidates.findIndex((c) => normaliseParameter(c) === wanted);
  if (exact >= 0) return { index: exact, ambiguous: false };

  if (type === "LOCATION") {
    const [city, ...regions] = term.split(",").map(normaliseParameter).filter(Boolean);
    const places: number[] = [];
    candidates.forEach((candidate, index) => {
      const [candidateCity, ...candidateRegions] = candidate.split(",").map(normaliseParameter).filter(Boolean);
      if (candidateCity !== city) return;
      if (!regions.every((region) => regionMatches(region, candidateRegions))) return;
      places.push(index);
    });
    const first = places[0];
    if (first !== undefined) {
      const distinct = new Set(places.map((i) => normaliseParameter(candidates[i]!)));
      return { index: first, ambiguous: regions.length === 0 && distinct.size > 1 };
    }
  }

  // Nothing here is the term. Never the first item: that is how "New York, NY" became Nyack.
  return null;
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

/**
 * Said when Sales Navigator refused both searches and regular search built the
 * list. The filters regular search could not apply are named from what it
 * actually reported, because a fixed list names filters the profile never set
 * and misses the ones it did.
 */
export function salesNavigatorRefusedNote(dropped: string[] = []): string {
  return dropped.length
    ? `${SALES_NAVIGATOR_REFUSED_NOTE} ${capitalise(listInWords(dropped))} ${dropped.length === 1 ? "was" : "were"} not applied, so read the names carefully.`
    : `${SALES_NAVIGATOR_REFUSED_NOTE} Read the names carefully.`;
}

/** Every sentence a fully refused Sales Navigator search says begins with this. */
export const SALES_NAVIGATOR_REFUSED_NOTE =
  "Sales Navigator would not run this search, so regular LinkedIn search was used instead.";

/** Every sentence the narrower Sales Navigator search can say begins with this. */
export const SALES_NAVIGATOR_PARTIAL_NOTE =
  "Sales Navigator would not take the full set of filters, so it was searched again with fewer.";

/**
 * Whether a filter note says Sales Navigator refused the full search, in
 * either of its forms. The notes carry what was dropped, so they are matched
 * by how they begin rather than as fixed strings.
 */
export function isSalesNavigatorFallbackNote(note: string): boolean {
  return note.startsWith(SALES_NAVIGATOR_PARTIAL_NOTE) || note.startsWith(SALES_NAVIGATOR_REFUSED_NOTE);
}

function listInWords(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function quoted(words: string[]): string {
  return listInWords(words.map((w) => `"${w}"`));
}

function capitalise(text: string): string {
  return text ? text[0]!.toUpperCase() + text.slice(1) : text;
}

/*
 * Sales Navigator's own vocabulary.
 *
 * The provider's reference (developer.unipile.com) could not be reached when
 * this was written, so these are LinkedIn's current Sales Navigator levels and
 * company-size buckets as Sales Navigator itself shows them, in the shape the
 * provider's other enum filters take. Partner is no longer its own level: Sales
 * Navigator folded it into Owner. Anything that does not map is left out and
 * named in `droppedFilters`, never sent as the Strategy Agent's words, and a
 * shape the provider refuses still builds a list through the narrower search.
 * The weekly probe asks each shape alone, which is what settles it.
 */
const SALES_NAVIGATOR_SENIORITY: Array<[RegExp, string]> = [
  [/\b(owner|founder|co-?founder|proprietor|partner)\b/i, "owner/partner"],
  // Before CXO: "vice president" contains "president".
  [/\b(vp|svp|evp|vice president)\b/i, "vice_president"],
  [/\b(cxo|c-?level|c-?suite|chief|ceo|cfo|coo|cto|cmo|cro|president)\b/i, "cxo"],
  [/\b(director|head)\b/i, "director"],
  // Before the experienced level: "entry level manager" contains "manager".
  [/\b(entry[- ]level manager|entry manager|first[- ]line manager)\b/i, "entry_level_manager"],
  [/\b(senior manager|experienced manager|manager)\b/i, "experienced_manager"],
  [/\bstrategic\b/i, "strategic"],
  [/\bsenior\b/i, "senior"],
  [/\b(entry|junior|associate)\b/i, "entry_level"],
  [/\b(training|intern|trainee)\b/i, "in_training"],
];

/** Seniority words as Sales Navigator's own levels; an unknown word is left out. */
export function salesNavigatorSeniorities(words: string[] | undefined): string[] {
  return salesNavigatorSeniorityMapping(words).levels;
}

function salesNavigatorSeniorityMapping(words: string[] | undefined): { levels: string[]; unmapped: string[] } {
  const out = new Set<string>();
  const unmapped: string[] = [];
  for (const word of words ?? []) {
    const hit = SALES_NAVIGATOR_SENIORITY.find(([re]) => re.test(word));
    if (hit) out.add(hit[1]);
    else if (word.trim()) unmapped.push(word.trim());
  }
  return { levels: [...out], unmapped };
}

/**
 * Sales Navigator's company-size buckets. It filters on these and nothing in
 * between: a range of its own invention is not a size Sales Navigator has.
 */
const SALES_NAVIGATOR_HEADCOUNT_BUCKETS: Array<{ min: number; max?: number }> = [
  { min: 1, max: 10 },
  { min: 11, max: 50 },
  { min: 51, max: 200 },
  { min: 201, max: 500 },
  { min: 501, max: 1000 },
  { min: 1001, max: 5000 },
  { min: 5001, max: 10000 },
  { min: 10001 },
];

/**
 * "11-50", "1,001-5,000", "10,000+" snapped to the buckets they cover.
 *
 * A bucket is taken when the range covers more than its edge: "10-50" is the
 * 11-50 bucket, not 1-10 as well, and "10,000+" is 10,001+, not 5,001-10,000
 * for the sake of one number. Anything that is not a number range is left out.
 */
export function salesNavigatorHeadcounts(sizes: string[] | undefined): Array<{ min: number; max?: number }> {
  return salesNavigatorHeadcountMapping(sizes).buckets;
}

function salesNavigatorHeadcountMapping(sizes: string[] | undefined): {
  buckets: Array<{ min: number; max?: number }>;
  unmapped: string[];
} {
  const picked = new Set<number>();
  const unmapped: string[] = [];
  for (const size of sizes ?? []) {
    const digits = size.replace(/,/g, "").replace(/\s*(employees?|people|staff)\s*$/i, "");
    const range = /^\s*(\d+)\s*(?:-|–|to)\s*(\d+)\s*$/i.exec(digits);
    const open = /^\s*(\d+)\s*\+\s*$/.exec(digits);
    const lo = range ? Number(range[1]) : open ? Number(open[1]) : NaN;
    const hi = range ? Number(range[2]) : open ? Infinity : NaN;
    if (!Number.isFinite(lo) || !(hi >= lo)) {
      if (size.trim()) unmapped.push(size.trim());
      continue;
    }
    let hit = false;
    SALES_NAVIGATOR_HEADCOUNT_BUCKETS.forEach((bucket, i) => {
      const top = bucket.max ?? Infinity;
      const overlap = Math.min(hi, top) - Math.max(lo, bucket.min);
      // More than a single shared number, or a single number asked for.
      if (overlap > 0 || (lo === hi && lo >= bucket.min && lo <= top)) {
        picked.add(i);
        hit = true;
      }
    });
    if (!hit) unmapped.push(size.trim());
  }
  return {
    buckets: SALES_NAVIGATOR_HEADCOUNT_BUCKETS.filter((_, i) => picked.has(i)).map((b) => ({ ...b })),
    unmapped,
  };
}

/**
 * The narrower search, asked when the whole profile is refused: free-text
 * keywords and location, the part every search takes.
 *
 * What it dropped is read off what the profile actually set. A fixed list named
 * seniority on a profile that had none and said nothing about the industry and
 * keywords it really left out, which is the filter that silently stops being
 * applied (rule 12).
 */
const TITLE_AS_KEYWORDS = "job title (searched as keywords)";

function salesNavigatorFallback(
  query: SearchQuery,
  resolved: ResolvedFilters,
): { body: Record<string, unknown>; droppedFilters: string[]; note: string } {
  const titles = hasAny(query.titles);
  const keywords = anyOf(titles ? (query.titles ?? []) : (query.keywords ?? []));
  const located = resolved.locations.length > 0;

  const droppedFilters: string[] = [];
  if (titles) droppedFilters.push(TITLE_AS_KEYWORDS);
  if (titles && hasAny(query.keywords)) droppedFilters.push("keywords");
  if (hasAny(query.seniorities)) droppedFilters.push("seniority");
  if (resolved.industries.length) droppedFilters.push("industry");
  if (hasAny(query.companyHeadcount)) droppedFilters.push("company size");
  if (hasAny(query.excludeTitles)) droppedFilters.push("excluded titles");

  const searched = titles
    ? "The job titles were typed in as plain keywords, so a title can match anywhere in a profile"
    : keywords
      ? "It was searched by keyword"
      : "It was searched with no keywords";
  const where = located ? " and within the chosen locations." : ".";
  const rest = droppedFilters.filter((f) => f !== TITLE_AS_KEYWORDS);
  const notApplied = rest.length
    ? ` ${capitalise(listInWords(rest))} ${rest.length === 1 ? "was" : "were"} not applied.`
    : "";

  return {
    body: {
      api: "sales_navigator",
      category: "people",
      ...(keywords ? { keywords } : {}),
      ...(located ? { location: { include: resolved.locations } } : {}),
    },
    droppedFilters,
    note: `${SALES_NAVIGATOR_PARTIAL_NOTE} ${searched}${where}${notApplied}`,
  };
}

/**
 * Which Sales Navigator search a stored position came from.
 *
 * The classic composite carries its own `classic:` marker and is left alone.
 * An unmarked cursor was written before the narrower search existed, by the
 * full search, which is the only thing that could have produced it.
 */
const SALES_NAVIGATOR_CURSOR_PREFIX = { full: "sn-full:", partial: "sn-partial:" } as const;

export function readSalesNavigatorCursor(
  cursor: string | null | undefined,
): { attempt: "full" | "partial"; cursor: string } | null {
  if (!cursor || isClassicCursor(cursor)) return null;
  for (const attempt of ["full", "partial"] as const) {
    const prefix = SALES_NAVIGATOR_CURSOR_PREFIX[attempt];
    if (cursor.startsWith(prefix)) {
      const rest = cursor.slice(prefix.length);
      return rest ? { attempt, cursor: rest } : null;
    }
  }
  return { attempt: "full", cursor };
}

/** The provider rejected the request itself, as opposed to failing to answer it. */
function isRefusedSearch(err: unknown): boolean {
  return err instanceof UnipileError && (err.status === 400 || err.status === 422);
}

function toUnipileSearchBody(
  query: SearchQuery,
  tier: SearchTier,
  resolved: ResolvedFilters,
): { body: Record<string, unknown>; droppedFilters: string[] } {
  if (tier === "sales_navigator") {
    // The Strategy Agent writes seniority and company size the way a person
    // would ("Founder", "11-50"). Sales Navigator takes neither as words, and
    // sending them is what had every search refused. A word with no level and
    // a size with no bucket are left out and named, never sent.
    const seniority = salesNavigatorSeniorityMapping(query.seniorities);
    const headcount = salesNavigatorHeadcountMapping(query.companyHeadcount);
    const droppedFilters: string[] = [];
    if (seniority.unmapped.length) {
      droppedFilters.push(seniority.levels.length ? `seniority ${quoted(seniority.unmapped)}` : "seniority");
    }
    if (headcount.unmapped.length) {
      droppedFilters.push(headcount.buckets.length ? `company size ${quoted(headcount.unmapped)}` : "company size");
    }
    const titles = (query.titles ?? []).map((t) => t.trim()).filter(Boolean);
    const excluded = (query.excludeTitles ?? []).map((t) => t.trim()).filter(Boolean);
    return {
      body: {
        api: "sales_navigator",
        category: "people",
        keywords: anyOf(query.keywords ?? []),
        // Sales Navigator's current-job-title filter is `role`; `title` is not
        // one of its fields, and a field it does not have refuses the request.
        role:
          titles.length || excluded.length
            ? { ...(titles.length ? { include: titles } : {}), ...(excluded.length ? { exclude: excluded } : {}) }
            : undefined,
        seniority: seniority.levels.length ? { include: seniority.levels } : undefined,
        industry: resolved.industries.length ? { include: resolved.industries } : undefined,
        company_headcount: headcount.buckets.length ? headcount.buckets : undefined,
        location: resolved.locations.length ? { include: resolved.locations } : undefined,
      },
      droppedFilters,
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
      // This body is not what is sent. `searchProspects` asks classic one term
      // at a time (`classicTerms`: titles and keywords only), so seniority is
      // never sent to LinkedIn on this tier, not even as a text hint. It is
      // reported in `droppedFilters` above, which is the only true account of
      // it, so it is left out here too rather than described as surviving.
      keywords: anyOf(query.keywords ?? []),
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
 * Where the next run of a classic search should pick up, or nothing when there
 * is nowhere left to pick up from.
 *
 * A pass with terms left resumes itself. A pass that ran every term to the end
 * is finished — but the industry pass being finished is not the search being
 * finished, because dropping the industry filter is a different search over
 * people the first pass could never have returned. Only the unfiltered pass
 * running out means there is genuinely nobody else, and that is the one answer
 * that lets a screen stop offering to look again.
 */
function nextPosition(
  round: number,
  next: Record<string, string>,
  terms: string[],
  withIndustry: boolean,
): ClassicPosition | null {
  if (Object.keys(next).length > 0) return { round, terms: next };
  if (withIndustry) return { round: round + 1, terms: Object.fromEntries(terms.map((t) => [t, ""])) };
  return null;
}

/**
 * What to type into LinkedIn's one keyword box, in priority order.
 *
 * Titles first: they are what a customer profile is really about, and somebody
 * whose headline reads "Chapter President" is found by searching those words.
 * Free-text keywords follow. Capped, because each term is a request against a
 * seat somebody pays for, and the tail of a profile's keyword list is its
 * vaguest part.
 */
/**
 * Said whenever a classic search was asked for job titles and keywords both.
 * They are separate requests merged afterwards, so the list is "title OR
 * keyword", never "title AND keyword", and a reviewer reading it as the
 * profile they approved would be reading the narrower query.
 */
export const CLASSIC_TITLES_OR_KEYWORDS_NOTE =
  "Job titles and keywords were searched separately, so a person here matched at least one of them, not necessarily all.";

function hasAny(list: string[] | undefined): boolean {
  return (list ?? []).some((t) => t.trim().length > 0);
}

export function classicTerms(query: SearchQuery): string[] {
  const unique = [
    ...new Set(
      [...(query.titles ?? []), ...(query.keywords ?? [])].map((t) => t.trim()).filter(Boolean),
    ),
  ];
  // Nothing to search for is still a search: an empty keyword with a location
  // returns that location's people rather than nobody at all.
  return unique.length > 0 ? unique.slice(0, 6) : [""];
}

function toProspectCandidate(raw: UnipileRawProfile): ProspectCandidate {
  const identifier = raw.provider_id ?? raw.id ?? raw.public_identifier ?? "";
  const position = raw.current_position ?? raw.work_experience?.[0];
  const { firstName, lastName } = splitName(raw);
  return {
    providerId: identifier,
    linkedinUrl: profileUrl(raw, identifier),
    firstName,
    lastName,
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

/**
 * A prospect's name, from whichever field carries it.
 *
 * Search results return one `name`; only the profile endpoint splits it into
 * `first_name` and `last_name`. Reading only the split pair left every name on
 * every card blank, which is what made fourteen real people — a membership
 * director at a chamber of commerce, a chapter president — look like fake data
 * to the person reviewing them.
 *
 * The split is deliberately naive: everything before the first space is the
 * first name. It only has to be right enough to greet somebody, and a note
 * beginning "Hi Jean-Paul" is correct where "Hi Jean" would not be.
 */
function splitName(raw: UnipileRawProfile): { firstName: string; lastName: string } {
  if (raw.first_name || raw.last_name) {
    return { firstName: raw.first_name ?? "", lastName: raw.last_name ?? "" };
  }
  const whole = (raw.name ?? "").trim().replace(/\s+/g, " ");
  // "LinkedIn Member" is the placeholder LinkedIn shows instead of a name for
  // anyone outside the viewer's network. Stored as a name it becomes a
  // prospect called LinkedIn Member, greeted as "Hi LinkedIn" -- and a list
  // full of them is indistinguishable from fabricated data, which is exactly
  // how it was reported.
  if (!whole || /^linkedin member$/i.test(whole)) return { firstName: "", lastName: "" };
  const cut = whole.indexOf(" ");
  if (cut < 0) return { firstName: whole, lastName: "" };
  return { firstName: whole.slice(0, cut), lastName: whole.slice(cut + 1) };
}

/**
 * The prospect's profile address, or a stable key that is honest about not
 * being one.
 *
 * `https://www.linkedin.com/in/<provider id>` is not a profile URL. LinkedIn's
 * internal ids look nothing like vanity slugs and every one of those links is a
 * 404 — which a rep finds out by clicking a name during a review and
 * concluding the whole list is invented.
 *
 * Some profiles genuinely have no public address: LinkedIn hides the vanity URL
 * outside your network, and shows those people as "LinkedIn Member". They are
 * still real, still messageable through the provider by id, and still need a
 * unique key here, so the id is used as one — under a path that cannot be
 * mistaken for a profile and that `isPublicProfileUrl` can tell apart.
 */
function profileUrl(raw: UnipileRawProfile, identifier: string): string {
  const published = raw.public_profile_url ?? raw.profile_url;
  if (published && !isInternalId(published)) return published;
  // A hidden profile comes back with `public_identifier` set to LinkedIn's
  // internal id rather than a vanity slug, so "we have a public identifier" is
  // not the same as "we have an address". Building `/in/ACoAAA...` from it
  // produces a link that 404s and a list that looks invented.
  if (raw.public_identifier && !isInternalId(raw.public_identifier)) {
    return `https://www.linkedin.com/in/${raw.public_identifier}`;
  }
  return `https://www.linkedin.com/search/results/all/?keywords=${encodeURIComponent(identifier)}`;
}

/** LinkedIn's internal ids all begin this way and are never vanity slugs. */
function isInternalId(value: string): boolean {
  return /(^|\/)acoaa/i.test(value);
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

/**
 * A shared secret compared in constant time.
 *
 * Exact match only: trimmed of surrounding whitespace, because a value pasted
 * into a dashboard field often carries a trailing newline, and nothing else.
 * Prefix and case-insensitive matching would each make a guess cheaper.
 */
function secretEquals(presented: string, secret: string): boolean {
  const a = Buffer.from(presented.trim(), "utf8");
  const b = Buffer.from(secret.trim(), "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Constant-time, and length-safe: timingSafeEqual throws on a length mismatch. */
function hexEquals(expected: string, actual: string): boolean {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(actual.toLowerCase(), "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}


/**
 * The shape of a string, never the string.
 *
 * A reference is one workspace's label and must not land in another's browser,
 * but "is there a uuid anywhere in this payload" is the entire question when a
 * binding will not bind.
 */
function shapeOfValue(value: string): string {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) return "uuid";
  if (/\s/.test(value)) return "text with spaces";
  if (value === "") return "empty";
  return `${value.length} chars, no spaces`;
}
