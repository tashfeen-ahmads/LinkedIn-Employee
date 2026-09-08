export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Set so a reply reaches a person rather than a no-reply void. */
  replyTo?: string;
}

export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<{ id: string | null }>;
}

export class EmailError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = "EmailError";
  }
}
