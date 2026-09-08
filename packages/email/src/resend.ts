import { EmailError, type EmailMessage, type EmailProvider } from "./provider.js";

/**
 * Resend. Chosen because it is a single HTTP call with no SDK, which keeps the
 * provider swappable — the interface is four lines, so a different sender is a
 * sibling file.
 */
export class ResendProvider implements EmailProvider {
  readonly name = "resend";
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly config: { apiKey: string; from: string; replyTo?: string },
    options: { fetchImpl?: typeof fetch } = {},
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async send(message: EmailMessage): Promise<{ id: string | null }> {
    const res = await this.fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.config.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: this.config.from,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
        reply_to: message.replyTo ?? this.config.replyTo,
      }),
    });

    const body = await res.text();
    if (!res.ok) throw new EmailError(`Resend send failed with ${res.status}`, res.status, body);

    const parsed = JSON.parse(body) as { id?: string };
    return { id: parsed.id ?? null };
  }
}
