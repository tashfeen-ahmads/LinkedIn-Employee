import type { ProspectCandidate } from "@le/shared";

export type AccountHealth = "ok" | "warning" | "restricted" | "reauth_required" | "unknown";

export interface HostedAuthLink {
  url: string;
  expiresAt: string;
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
}

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
  createHostedAuthLink(input: { userId: string; successUrl: string; failureUrl: string }): Promise<HostedAuthLink>;
  getAccountHealth(accountId: string): Promise<AccountHealth>;
  searchProspects(input: { accountId: string; query: SearchQuery; cursor?: string; limit?: number }): Promise<ProspectPage>;
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
