import type { EmailMessage, EmailProvider } from "./provider.js";

/** Captures messages instead of sending them. Used in development and tests. */
export class MockEmailProvider implements EmailProvider {
  readonly name = "mock";
  readonly sent: EmailMessage[] = [];

  async send(message: EmailMessage): Promise<{ id: string | null }> {
    this.sent.push(message);
    return { id: `mock_${this.sent.length}` };
  }
}
