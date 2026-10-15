import { afterEach, describe, expect, it, vi } from "vitest";
import { FREE_NOTES_PER_MONTH } from "@le/shared";
import { runLinkedInAction } from "../src/jobs/linkedin-action.js";
import { ACCOUNT, WORKSPACE, harness } from "./loop-harness.js";

/*
 * A free LinkedIn account may attach a note to only a few invitations a month.
 * LinkedIn refuses the next one in the words it uses for a throttle, and this
 * product read it as one: every account that sent in October was held for
 * days, right after its third note. These pin down that the invitation goes
 * without a note instead, and that a real throttle is still a throttle.
 */

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const THROTTLED = "422 errors/cannot_resend_yet: You have reached a temporary provider limit. Please try again later.";
const NOW = new Date("2026-10-15T10:00:00Z");

function spentNotes(prospect: (cp?: Record<string, unknown>) => string, count: number) {
  for (let i = 0; i < count; i += 1) {
    prospect({ status: "invited", invited_at: "2026-10-03T10:00:00Z", invite_note_sent: null });
  }
}

describe("a free account's monthly notes", () => {
  it("sends with a note while the month has notes left", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const { ctx, db, prospect, linkedin } = harness(NOW);
    spentNotes(prospect, FREE_NOTES_PER_MONTH - 1);
    const id = prospect();

    await runLinkedInAction(ctx, { kind: "invite", workspaceId: WORKSPACE, campaignProspectId: id });

    expect(linkedin.sentInvitations.at(-1)?.note).toBeTruthy();
    expect(db.find("campaign_prospects", { id })?.invite_note_sent).toBe(true);
  });

  it("sends without a note once the month's notes are spent", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const { ctx, db, prospect, linkedin } = harness(NOW);
    spentNotes(prospect, FREE_NOTES_PER_MONTH);
    const id = prospect();

    await runLinkedInAction(ctx, { kind: "invite", workspaceId: WORKSPACE, campaignProspectId: id });

    const row = db.find("campaign_prospects", { id })!;
    expect(row.status).toBe("invited");
    expect(row.invite_note_sent).toBe(false);
    expect(linkedin.sentInvitations.at(-1)?.note).toBeUndefined();
  });

  it("counts last month's notes as last month's", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const { ctx, prospect, linkedin } = harness(NOW);
    for (let i = 0; i < FREE_NOTES_PER_MONTH; i += 1) {
      prospect({ status: "invited", invited_at: "2026-09-28T10:00:00Z", invite_note_sent: true });
    }
    const id = prospect();

    await runLinkedInAction(ctx, { kind: "invite", workspaceId: WORKSPACE, campaignProspectId: id });

    expect(linkedin.sentInvitations.at(-1)?.note).toBeTruthy();
  });

  it("resends without the note when LinkedIn refuses it, and holds nothing", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const { ctx, db, prospect, linkedin } = harness(NOW);
    linkedin.noteRefusal = THROTTLED;
    const id = prospect();

    await runLinkedInAction(ctx, { kind: "invite", workspaceId: WORKSPACE, campaignProspectId: id });

    const row = db.find("campaign_prospects", { id })!;
    expect(row.status).toBe("invited");
    expect(row.invite_note_sent).toBe(false);
    const account = db.find("linkedin_accounts", { id: ACCOUNT })!;
    expect(account.invites_paused_until ?? null).toBeNull();
    expect(account.notes_exhausted_month).toBe("2026-10");
  });

  it("sends no note for the rest of a month in which LinkedIn refused one", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const { ctx, prospect, linkedin } = harness(NOW, { account: { notes_exhausted_month: "2026-10" } });
    const attempts = vi.spyOn(linkedin, "sendInvitation");
    const id = prospect();

    await runLinkedInAction(ctx, { kind: "invite", workspaceId: WORKSPACE, campaignProspectId: id });

    expect(attempts).toHaveBeenCalledTimes(1);
    expect(attempts.mock.calls[0]?.[0].note).toBeUndefined();
  });

  it("still holds the account when the invitation without a note is refused too", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const { ctx, db, prospect, linkedin } = harness(NOW);
    linkedin.invitationRefusal = THROTTLED;
    const attempts = vi.spyOn(linkedin, "sendInvitation");
    const id = prospect();

    await runLinkedInAction(ctx, { kind: "invite", workspaceId: WORKSPACE, campaignProspectId: id });

    expect(attempts).toHaveBeenCalledTimes(2);
    expect(db.find("campaign_prospects", { id })?.status).toBe("queued");
    expect(db.find("linkedin_accounts", { id: ACCOUNT })?.invites_paused_until).toBeTruthy();
  });
});

describe("a paid account", () => {
  it("keeps its notes, and a refusal is not retried without one", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const { ctx, db, prospect, linkedin } = harness(NOW, { account: { has_premium: true } });
    spentNotes(prospect, FREE_NOTES_PER_MONTH + 5);
    linkedin.noteRefusal = THROTTLED;
    const attempts = vi.spyOn(linkedin, "sendInvitation");
    const id = prospect();

    await runLinkedInAction(ctx, { kind: "invite", workspaceId: WORKSPACE, campaignProspectId: id });

    expect(attempts).toHaveBeenCalledTimes(1);
    expect(attempts.mock.calls[0]?.[0].note).toBeTruthy();
    expect(db.find("linkedin_accounts", { id: ACCOUNT })?.invites_paused_until).toBeTruthy();
  });
});
