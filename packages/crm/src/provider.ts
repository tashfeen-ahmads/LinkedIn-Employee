export interface CrmContact {
  firstName?: string;
  lastName?: string;
  company?: string;
  jobTitle?: string;
  linkedinUrl: string;
  email?: string;
  /** Free-form source label, e.g. "LinkedIn Employee". */
  source: string;
}

export interface CrmActivity {
  contactId: string;
  /** ISO timestamp of when it happened, not when we synced it. */
  occurredAt: string;
  direction: "outbound" | "inbound";
  body: string;
  /** Distinguishes an agent-authored message from one a human wrote. */
  authoredBy: "agent" | "human";
}

export interface CrmMeeting {
  contactId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  meetingUrl?: string;
  notes?: string;
}

export interface CrmProvider {
  readonly name: string;
  /** Creates or updates by LinkedIn URL, returning the CRM's own id. */
  upsertContact(input: { accessToken: string; contact: CrmContact }): Promise<string>;
  logActivity(input: { accessToken: string; activity: CrmActivity }): Promise<string | null>;
  logMeeting(input: { accessToken: string; meeting: CrmMeeting }): Promise<string | null>;
}

export class CrmError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
    /** True when retrying later could plausibly succeed. */
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "CrmError";
  }
}

export function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}
