import type {
  AccountHealth,
  ActionResult,
  HostedAuthLink,
  InboundMessage,
  LinkedInProvider,
  ProspectPage,
  ConnectedAccount,
  ProviderProfile,
  ProviderRelation,
  SearchQuery,
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
  candidates: ProspectPage = { items: [], cursor: null };
  /** Every search performed, so a test can prove one did not happen. */
  readonly searches: Array<{ accountId: string; query: SearchQuery }> = [];
  /** Connections the account has, i.e. who accepted an invitation. */
  relations: ProviderRelation[] = [];

  /** What parseAccountWebhook returns; set by a test to simulate a delivery. */
  connectedAccounts: ConnectedAccount[] = [];

  parseAccountWebhook(): ConnectedAccount[] {
    return this.connectedAccounts;
  }

  async createHostedAuthLink(): Promise<HostedAuthLink> {
    return { url: "https://example.test/hosted-auth", expiresAt: new Date(Date.now() + 3_600_000).toISOString() };
  }

  async getAccountHealth(): Promise<AccountHealth> {
    return this.health;
  }

  async listRelations(input: { since?: string }): Promise<ProviderRelation[]> {
    if (!input.since) return this.relations;
    return this.relations.filter((r) => !r.connectedAt || r.connectedAt >= input.since!);
  }

  async searchProspects(input: { accountId: string; query: SearchQuery }): Promise<ProspectPage> {
    this.searches.push({ accountId: input.accountId, query: input.query });
    return this.candidates;
  }

  async getProfile(input: { accountId: string; providerId: string }): Promise<ProviderProfile> {
    return {
      providerId: input.providerId,
      linkedinUrl: `https://www.linkedin.com/in/${input.providerId}`,
      firstName: "Test",
      lastName: "Person",
    };
  }

  async sendInvitation(input: { accountId: string; providerId: string; note?: string }): Promise<ActionResult> {
    this.sentInvitations.push(input);
    return { ok: true, providerId: `inv_${this.sentInvitations.length}` };
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
