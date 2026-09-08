import { createHmac } from "node:crypto";
import { CrmError, isRetryableStatus, type CrmActivity, type CrmMeeting, type CrmContact, type CrmProvider } from "./provider.js";

/**
 * Outbound webhooks, the escape hatch for teams on neither HubSpot nor
 * Salesforce. Every event is signed so the receiver can verify it came from us
 * rather than from anyone who learned the URL.
 */
export class WebhookProvider implements CrmProvider {
  readonly name = "webhook";
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly config: { url: string; secret?: string },
    options: { fetchImpl?: typeof fetch } = {},
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async upsertContact(input: { contact: CrmContact }): Promise<string> {
    await this.post("contact.upserted", input.contact);
    // There is no remote id to return, so the LinkedIn URL is the key both
    // sides can agree on.
    return input.contact.linkedinUrl;
  }

  async logActivity(input: { activity: CrmActivity }): Promise<string | null> {
    await this.post("activity.logged", input.activity);
    return null;
  }

  async logMeeting(input: { meeting: CrmMeeting }): Promise<string | null> {
    await this.post("meeting.booked", input.meeting);
    return null;
  }

  private async post(event: string, payload: unknown): Promise<void> {
    const body = JSON.stringify({ event, sentAt: new Date().toISOString(), data: payload });
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.config.secret) headers["x-le-signature"] = signPayload(body, this.config.secret);

    const res = await this.fetchImpl(this.config.url, { method: "POST", headers, body });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new CrmError(`webhook ${event} failed with ${res.status}`, res.status, text, isRetryableStatus(res.status));
    }
  }
}

export function signPayload(body: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}
