import type { ProspectCandidate } from "@le/shared";

export type AccountHealth = "ok" | "warning" | "restricted" | "reauth_required" | "unknown";

export interface HostedAuthLink {
  url: string;
  expiresAt: string;
}

/**
 * An account the provider has finished connecting.
 *
 * `reference` is the value we handed the hosted flow to identify the rep, so a
 * notification can be matched back to the row that started it. Without it a
 * connected account belongs to nobody.
 */
export interface ConnectedAccount {
  providerAccountId: string;
  reference: string;
  displayName?: string;
  status: AccountHealth;
}

export interface ProviderProfile {
  providerId: string;
  linkedinUrl: string;
  firstName: string;
  lastName: string;
  headline?: string;
  title?: string;
  company?: string;
  location?: string;
  about?: string;
  /** True when the profile shows a role started within the last 90 days. */
  startedRoleRecently?: boolean;
}

export interface SearchQuery {
  titles?: string[];
  seniorities?: string[];
  industries?: string[];
  companyHeadcount?: string[];
  geographies?: string[];
  keywords?: string[];
  excludeTitles?: string[];
}

export interface ProspectPage {
  items: ProspectCandidate[];
  /** Opaque cursor for the next page, or null when the result set is exhausted. */
  cursor: string | null;
  /**
   * Filters the search tier could not apply, named as the customer profile
   * named them.
   *
   * Classic LinkedIn search takes a fraction of the filters Sales Navigator
   * does. Dropping the rest silently would return a list that looks like the
   * profile asked for and is not — the reviewer sees plausible names, approves
   * them, and the campaign is aimed slightly wrong for a month. Reported
   * instead, so the screen and the campaign record can say so.
   */
  droppedFilters: string[];
}

/** Which LinkedIn search surface an account is entitled to. */
export type SearchTier = "sales_navigator" | "classic";

/** One connection the account has, as the provider reports it. */
export interface ProviderRelation {
  providerId: string;
  /** ISO datetime the connection was made, when the provider says. */
  connectedAt: string | null;
}

export interface InboundMessage {
  providerMessageId: string;
  providerChatId: string;
  providerAccountId: string;
  /** The prospect's provider id, i.e. the sender. */
  fromProviderId: string;
  text: string;
  receivedAt: string;
}

export interface ActionResult {
  ok: boolean;
  providerId?: string;
  error?: string;
  /** Set when the provider reports the account is rate limited or flagged. */
  health?: AccountHealth;
}

/**
 * Everything the product needs from LinkedIn. Implementations differ in how they
 * reach LinkedIn (a hosted API today, our own browser workers later); the agents
 * and the worker only ever see this interface.
 */
export interface LinkedInProvider {
  readonly name: string;
  /** Start the hosted login flow. The rep's password never reaches our servers. */
  createHostedAuthLink(input: {
    userId: string;
    successUrl: string;
    failureUrl: string;
    /** Where the provider posts once the rep finishes signing in. */
    notifyUrl?: string;
  }): Promise<HostedAuthLink>;
  /**
   * Verify and parse a provider notification that an account finished
   * connecting. Until one arrives the account has no provider id and every job
   * skips it, so this is the step that makes a connected account real.
   */
  parseAccountWebhook(input: { body: string; signature?: string }): ConnectedAccount[];
  getAccountHealth(accountId: string): Promise<AccountHealth>;
  searchProspects(input: {
    accountId: string;
    query: SearchQuery;
    cursor?: string;
    limit?: number;
    /**
     * Defaults to classic. Sales Navigator is a paid seat on top of LinkedIn
     * itself, so assuming it is the safe-by-default mistake: a search sent to
     * a tier the account does not have returns nothing, and "no prospects
     * found" reads like a bad customer profile rather than a missing
     * subscription.
     */
    tier?: SearchTier;
  }): Promise<ProspectPage>;
  getProfile(input: { accountId: string; providerId: string }): Promise<ProviderProfile>;
  sendInvitation(input: { accountId: string; providerId: string; note?: string }): Promise<ActionResult>;
  withdrawInvitation(input: { accountId: string; invitationId: string }): Promise<ActionResult>;
  sendMessage(input: { accountId: string; chatId?: string; providerId?: string; text: string }): Promise<ActionResult>;
  listNewMessages(input: { accountId: string; since: string }): Promise<InboundMessage[]>;
  /**
   * The account's connections, newest first. This is how an accepted
   * invitation is noticed: LinkedIn sends no acceptance event, and an
   * invitation leaving the pending list could equally mean it was declined.
   */
  listRelations(input: { accountId: string; since?: string; limit?: number }): Promise<ProviderRelation[]>;
  /** Verify a provider webhook signature. Returns the parsed messages it carries. */
  parseWebhook(input: { body: string; signature?: string }): InboundMessage[];
}
