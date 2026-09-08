import type { CrmActivity, CrmContact, CrmMeeting, CrmProvider } from "./provider.js";

export class MockCrmProvider implements CrmProvider {
  readonly name = "mock";
  readonly contacts: CrmContact[] = [];
  readonly activities: CrmActivity[] = [];
  readonly meetings: CrmMeeting[] = [];

  async upsertContact(input: { contact: CrmContact }): Promise<string> {
    const index = this.contacts.findIndex((c) => c.linkedinUrl === input.contact.linkedinUrl);
    if (index >= 0) {
      this.contacts[index] = input.contact;
      return `contact_${index}`;
    }
    this.contacts.push(input.contact);
    return `contact_${this.contacts.length - 1}`;
  }

  async logActivity(input: { activity: CrmActivity }): Promise<string | null> {
    this.activities.push(input.activity);
    return `activity_${this.activities.length}`;
  }

  async logMeeting(input: { meeting: CrmMeeting }): Promise<string | null> {
    this.meetings.push(input.meeting);
    return `meeting_${this.meetings.length}`;
  }
}
