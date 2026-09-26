import type {
  AccountHealth,
  ActionResult,
  PendingInvitation,
  HostedAuthLink,
  InboundMessage,
  LinkedInProvider,
  ProspectPage,
  ConnectedAccount,
  ProviderProfile,
  ProviderRelation,
  SearchQuery,
  SearchTier,
} from "./provider.js";

/**
 * In-memory provider for local development and tests. Records every action so
 * assertions can check what would have been sent to LinkedIn.
 */
export class MockLinkedInProvider implements LinkedInProvider {
  readonly name = "mock";
  readonly sentInvitations: Array<{ accountId: string; providerId: string; note?: string }> = [];
  readonly sentMessages: Array<{ accountId: string; text: string; chatId?: string; providerId?: string }> = [];
  health: AccountHealth = "ok";
  inbox: InboundMessage[] = [];
  candidates: ProspectPage = { items: [], cursor: null, droppedFilters: [] };
  /**
   * Set by a test to make the search fail the way a real provider does — a
   * refused subscription, a rejected key. The job has to report that rather
   * than let the queue retry it out of sight.
   */
  searchError: Error | null = null;
  /** Every search performed, so a test can prove one did not happen. */
  readonly searches: Array<{
    accountId: string;
    query: SearchQuery;
    tier: SearchTier;
    /** What position the caller asked to resume from, so a test can prove it did. */
    cursor: string | null;
  }> = [];
  /**
   * Answers keyed by the cursor asked for, so a test can walk a search the way
   * "find more" does. The first page is the one under no cursor; anything not
   * listed here falls back to `candidates`.
   */
  readonly pages = new Map<string, ProspectPage>();
  /** Connections the account has, i.e. who accepted an invitation. */
  relations: ProviderRelation[] = [];

  /** What parseAccountWebhook returns; set by a test to simulate a delivery. */
  connectedAccounts: ConnectedAccount[] = [];

  parseAccountWebhook(): ConnectedAccount[] {
    return this.connectedAccounts;
  }

  /** The same list the webhook would have carried, asked for rather than told. */
  async listAccounts(): Promise<ConnectedAccount[]> {
    return this.connectedAccounts;
  }

  async createHostedAuthLink(): Promise<HostedAuthLink> {
    return { url: "https://example.test/hosted-auth", expiresAt: new Date(Date.now() + 3_600_000).toISOString() };
  }

  /** Set by a test to make the health call fail the way a dropped account does. */
  healthError: Error | null = null;

  async getAccountHealth(): Promise<AccountHealth> {
    if (this.healthError) throw this.healthError;
    return this.health;
  }

  async listRelations(input: { since?: string }): Promise<ProviderRelation[]> {
    if (!input.since) return this.relations;
    return this.relations.filter((r) => !r.connectedAt || r.connectedAt >= input.since!);
  }

  async searchProspects(input: {
    accountId: string;
    query: SearchQuery;
    tier?: SearchTier;
    cursor?: string;
  }): Promise<ProspectPage> {
    this.searches.push({
      accountId: input.accountId,
      query: input.query,
      tier: input.tier ?? "classic",
      cursor: input.cursor ?? null,
    });
    if (this.searchError) throw this.searchError;
    return this.pages.get(input.cursor ?? "") ?? this.candidates;
  }

  /** Set by a test to control what the profile endpoint resolves to. */
  profiles = new Map<string, ProviderProfile>();
  profileError: Error | null = null;

  /** Every profile this account has looked at, newest last, for assertions. */
  viewedProfiles: string[] = [];
  /** Set to make a view fail, the way the provider would. */
  viewRefusal: string | null = null;

  async viewProfile(input: { accountId: string; providerId: string }): Promise<ActionResult> {
    if (this.viewRefusal) return { ok: false, error: this.viewRefusal };
    this.viewedProfiles.push(input.providerId);
    return { ok: true };
  }

  async getProfile(input: { accountId: string; providerId: string }): Promise<ProviderProfile> {
    if (this.profileError) throw this.profileError;
    const known = this.profiles.get(input.providerId);
    if (known) return known;
    return {
      providerId: input.providerId,
      linkedinUrl: `https://www.linkedin.com/in/${input.providerId}`,
      firstName: "Test",
      lastName: "Person",
    };
  }

  /**
   * Set by a test to make the provider refuse a send the way LinkedIn does —
   * a 422 naming the member, not a network failure. That sentence is the most
   * useful thing this product can show somebody, so it has to be reachable.
   */
  invitationError: Error | null = null;

  /**
   * A refusal *returned* rather than thrown, which is what the real adapter
   * does with a 422 — it catches and answers `{ ok: false, error }`.
   *
   * Both paths are real and they are handled differently, so the double has to
   * offer both. Every refusal this deployment has actually been handed arrived
   * this way, and a test that could only throw exercised the branch LinkedIn
   * does not use.
   */
  invitationRefusal: string | null = null;

  async sendInvitation(input: { accountId: string; providerId: string; note?: string }): Promise<ActionResult> {
    if (this.invitationError) throw this.invitationError;
    if (this.invitationRefusal) return { ok: false, error: this.invitationRefusal };
    this.sentInvitations.push(input);
    return { ok: true, providerId: `inv_${this.sentInvitations.length}` };
  }

  /** What the provider would say this account still has outstanding. */
  pendingInvitations: PendingInvitation[] = [];

  async listPendingInvitations(): Promise<{ invitations: PendingInvitation[]; raw: unknown }> {
    return { invitations: this.pendingInvitations, raw: { items: this.pendingInvitations } };
  }

  async withdrawInvitation(): Promise<ActionResult> {
    return { ok: true };
  }

  async sendMessage(input: { accountId: string; chatId?: string; providerId?: string; text: string }): Promise<ActionResult> {
    this.sentMessages.push(input);
    return { ok: true, providerId: `msg_${this.sentMessages.length}` };
  }

  async listNewMessages(): Promise<InboundMessage[]> {
    const out = this.inbox;
    this.inbox = [];
    return out;
  }

  parseWebhook(input: { body: string }): InboundMessage[] {
    const parsed: unknown = JSON.parse(input.body);
    return Array.isArray(parsed) ? (parsed as InboundMessage[]) : [parsed as InboundMessage];
  }
}
