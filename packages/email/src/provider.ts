export interface EmailAttachment {
  filename: string;
  /** UTF-8 text. Everything this product attaches is a calendar invitation. */
  content: string;
  /**
   * The media type, which for a calendar invitation decides whether the mail
   * client offers to add it to a diary or treats it as a file to download.
   * `text/calendar; method=REQUEST` is the one that produces an invitation.
   */
  contentType?: string;
}

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Set so a reply reaches a person rather than a no-reply void. */
  replyTo?: string;
  attachments?: EmailAttachment[];
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
