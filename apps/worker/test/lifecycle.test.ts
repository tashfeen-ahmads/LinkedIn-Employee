import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BRAND } from "@le/shared";
import { MockEmailProvider, signUnsubscribeToken } from "@le/email";
import { FakeDb } from "./fake-db.js";
import {
  nextSequenceStep,
  runLifecycleEmails,
  runOnboardingSequence,
  sendAccountEmails,
  SEQUENCE_MIN_GAP_MS,
  type UserProgress,
} from "../src/jobs/lifecycle.js";
import { sendOnce } from "../src/email.js";
import {
  deliverAnnouncement,
  requestAnnouncementSend,
  resumeAnnouncements,
  saveAnnouncement,
} from "../src/jobs/announcements.js";
import { createServer } from "../src/server.js";
import type { WorkerContext } from "../src/context.js";
import type { Queues } from "../src/queues.js";

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const ADMIN_A = "33333333-3333-4333-8333-333333333333";
const ADMIN_B = "44444444-4444-4444-8444-444444444444";
const OTHER = "55555555-5555-4555-8555-555555555555";
const SECRET = "s".repeat(48);
// 09:00 UTC: inside everybody's daytime unless a test says otherwise.
const NOW = new Date("2026-09-10T09:00:00Z");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

function harness(
  overrides: {
    signedUpAgo?: number;
    trialEndsInDays?: number | null;
    workspace?: boolean;
    welcomed?: boolean;
    adminEmails?: string;
  } = {},
) {
  const db = new FakeDb();
  const email = new MockEmailProvider();
  const signedUpAgo = overrides.signedUpAgo ?? 5 * DAY;

  db.seed("profiles", [
    { id: USER, email: "sam@acme.test", full_name: "Sam Patel", timezone: "UTC", created_at: ago(signedUpAgo) },
  ]);
  if (overrides.workspace !== false) {
    db.seed("workspaces", [
      {
        id: WORKSPACE,
        name: "Acme",
        plan: "trial",
        // Old enough that the operators' milestone sweep has nothing to say,
        // so these tests count only the email they are about.
        created_at: ago(30 * DAY),
        trial_ends_at:
          overrides.trialEndsInDays === null
            ? null
            : new Date(NOW.getTime() + (overrides.trialEndsInDays ?? 30) * DAY).toISOString(),
        subscription_status: null,
      },
    ]);
    db.seed("memberships", [{ workspace_id: WORKSPACE, user_id: USER, role: "owner", created_at: ago(30 * DAY) }]);
  }
  if (overrides.welcomed !== false) {
    db.seed("email_sends", [
      { user_id: USER, step: "welcome", kind: "transactional", status: "sent", sent_at: ago(signedUpAgo), created_at: ago(signedUpAgo) },
    ]);
  }

  const ctx = {
    db: db.asDb(),
    email,
    env: {
      APP_URL: "https://app.test",
      INTERNAL_API_SECRET: SECRET,
      ADMIN_NOTIFY_EMAILS: overrides.adminEmails,
    } as WorkerContext["env"],
  } as unknown as WorkerContext;

  return { db, ctx, email };
}

/** Make the user old enough for a step without the signup sweep noticing them. */
function seedAdmins(db: FakeDb) {
  db.seed("profiles", [
    { id: ADMIN_A, email: "ana@nora.test", full_name: "Ana", timezone: "UTC", created_at: ago(90 * DAY) },
    { id: ADMIN_B, email: "ben@nora.test", full_name: "Ben", timezone: "UTC", created_at: ago(90 * DAY) },
  ]);
  db.seed("platform_admins", [{ user_id: ADMIN_A }, { user_id: ADMIN_B }]);
}

const progress = (overrides: Partial<UserProgress> = {}): UserProgress => ({
  hasWorkspace: true,
  isOwner: true,
  workspaceId: WORKSPACE,
  companyName: "Acme",
  linkedInConnected: false,
  strategies: 0,
  approvedStrategies: 0,
  campaigns: 0,
  launchedCampaigns: 0,
  ...overrides,
});

describe("the onboarding sequence, keyed to progress", () => {
  it("asks somebody with no workspace to finish setting up, an hour in", async () => {
    const { ctx, email } = harness({ signedUpAgo: 90 * 60_000, workspace: false });

    expect(await runOnboardingSequence(ctx, NOW)).toBe(1);
    expect(email.sent[0]?.subject).toBe("Three minutes and your team can start");
    expect(email.sent[0]?.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
  });

  it("does not ask somebody who finished setting up", async () => {
    const { ctx, email } = harness({ signedUpAgo: 90 * 60_000 });

    expect(await runOnboardingSequence(ctx, NOW)).toBe(0);
    expect(email.sent).toHaveLength(0);
  });

  it("skips connecting LinkedIn for somebody already connected, and asks for the next thing", async () => {
    const { db, ctx, email } = harness({ signedUpAgo: 2.5 * DAY });
    db.seed("linkedin_accounts", [{ workspace_id: WORKSPACE, user_id: USER, status: "active" }]);
    db.seed("customer_profiles", [
      { workspace_id: WORKSPACE, name: "Agencies", approved_at: null },
      { workspace_id: WORKSPACE, name: "Consultancies", approved_at: null },
    ]);

    await runOnboardingSequence(ctx, NOW);

    expect(email.sent.map((m) => m.subject)).toEqual(["Your strategies are ready to review"]);
    expect(email.sent[0]?.text).toContain("2 customer strategies for Acme");
  });

  it("asks for LinkedIn on day one when it is not connected", async () => {
    const { ctx, email } = harness({ signedUpAgo: 1.2 * DAY });

    await runOnboardingSequence(ctx, NOW);
    expect(email.sent[0]?.subject).toBe("Connect LinkedIn so Reese can start sending");
  });

  it("never sends the same step twice", async () => {
    const { ctx, email } = harness({ signedUpAgo: 1.2 * DAY });

    await runOnboardingSequence(ctx, NOW);
    // A day later the step is still inside its window and still undone.
    await runOnboardingSequence(ctx, new Date(NOW.getTime() + DAY));
    await runOnboardingSequence(ctx, new Date(NOW.getTime() + 1.5 * DAY));

    expect(email.sent.filter((m) => m.subject.startsWith("Connect LinkedIn"))).toHaveLength(1);
  });

  it("moves on past a step it has already sent", async () => {
    const { db, ctx, email } = harness({ signedUpAgo: 2.5 * DAY });
    db.seed("customer_profiles", [{ workspace_id: WORKSPACE, name: "Agencies", approved_at: null }]);
    db.seed("email_sends", [
      {
        user_id: USER,
        step: "onboarding.connect_linkedin",
        kind: "lifecycle",
        status: "sent",
        sent_at: ago(1.4 * DAY),
        created_at: ago(1.4 * DAY),
      },
    ]);

    await runOnboardingSequence(ctx, NOW);
    expect(email.sent.map((m) => m.subject)).toEqual(["Your strategy is ready to review"]);
  });

  it("leaves a stale step alone rather than sending it late", async () => {
    // Connect LinkedIn on day nine is not a reminder, it is a product that has
    // lost track of time — and it is what a deploy would send everybody.
    const { ctx, email } = harness({ signedUpAgo: 9 * DAY });

    await runOnboardingSequence(ctx, NOW);
    expect(email.sent.map((m) => m.subject)).toEqual(["One week in — how's it going?"]);
  });

  it("sends nothing to an account past the end of the sequence", async () => {
    const { ctx, email } = harness({ signedUpAgo: 30 * DAY });

    expect(await runOnboardingSequence(ctx, NOW)).toBe(0);
    expect(email.sent).toHaveLength(0);
  });

  it("waits for the person's own daytime", async () => {
    const { db, ctx, email } = harness({ signedUpAgo: 1.2 * DAY });
    // 09:00 UTC is 02:00 in Los Angeles.
    db.find("profiles", { id: USER })!.timezone = "America/Los_Angeles";

    expect(await runOnboardingSequence(ctx, NOW)).toBe(0);
    expect(email.sent).toHaveLength(0);
  });

  it("writes to nobody whose address was never proved and who never set up", async () => {
    // A signup form takes anybody's address. The welcome is sent once a
    // session proves it, so no welcome and no workspace means no sequence.
    const { ctx, email } = harness({ signedUpAgo: 2 * HOUR, workspace: false, welcomed: false });

    expect(await runOnboardingSequence(ctx, NOW)).toBe(0);
    expect(email.sent).toHaveLength(0);
  });

  it("sends no marketing email at all when it cannot sign an unsubscribe link", async () => {
    const { ctx, email } = harness({ signedUpAgo: 1.2 * DAY });
    (ctx.env as { INTERNAL_API_SECRET?: string }).INTERNAL_API_SECRET = undefined;

    expect(await runOnboardingSequence(ctx, NOW)).toBe(0);
    expect(email.sent).toHaveLength(0);
  });

  it("keeps a gap between two setup emails after an outage", () => {
    const step = nextSequenceStep({
      ageMs: 2.5 * DAY,
      progress: progress({ strategies: 1 }),
      alreadySent: new Set(["onboarding.connect_linkedin"]),
      lastLifecycleSentAt: NOW.getTime() - SEQUENCE_MIN_GAP_MS / 2,
      now: NOW.getTime(),
      localHour: 10,
    });
    expect(step).toBeNull();
  });

  it("asks an unbuilt campaign to be started and a built one to be launched", async () => {
    const { db, ctx, email } = harness({ signedUpAgo: 3.5 * DAY });
    db.seed("linkedin_accounts", [{ workspace_id: WORKSPACE, user_id: USER, status: "active" }]);
    db.seed("customer_profiles", [{ workspace_id: WORKSPACE, name: "Agencies", approved_at: ago(DAY) }]);
    db.seed("campaigns", [{ workspace_id: WORKSPACE, status: "draft", launched_at: null }]);

    await runOnboardingSequence(ctx, NOW);
    expect(email.sent[0]?.subject).toBe("Your first campaign is ready to read");
  });

  it("does not ask for a launch once a campaign is live", async () => {
    const { db, ctx, email } = harness({ signedUpAgo: 3.5 * DAY });
    db.seed("linkedin_accounts", [{ workspace_id: WORKSPACE, user_id: USER, status: "active" }]);
    db.seed("customer_profiles", [{ workspace_id: WORKSPACE, name: "Agencies", approved_at: ago(DAY) }]);
    db.seed("campaigns", [{ workspace_id: WORKSPACE, status: "running", launched_at: ago(HOUR) }]);

    expect(await runOnboardingSequence(ctx, NOW)).toBe(0);
    expect(email.sent).toHaveLength(0);
  });
});

describe("sendOnce", () => {
  const message = { to: "sam@acme.test", subject: "s", html: "<p>h</p>", text: "h" };

  it("refuses a step this person already has, whatever the caller believed", async () => {
    const { db, ctx, email } = harness();

    expect(await sendOnce(db.asDb(), ctx.email, { userId: USER, step: "x.step", kind: "lifecycle", message })).toBe("sent");
    expect(await sendOnce(db.asDb(), ctx.email, { userId: USER, step: "x.step", kind: "lifecycle", message })).toBe(
      "already_sent",
    );
    expect(email.sent).toHaveLength(1);
    expect(db.find("email_sends", { step: "x.step" })?.status).toBe("sent");
  });

  it("releases the claim when the provider refuses, so a later run can retry", async () => {
    const { db, ctx, email } = harness();
    email.send = async () => {
      throw new Error("provider down");
    };

    expect(await sendOnce(db.asDb(), ctx.email, { userId: USER, step: "y.step", kind: "lifecycle", message })).toBe("failed");
    expect(db.find("email_sends", { step: "y.step" })).toBeUndefined();
  });

  it("stops marketing to somebody who unsubscribed, and never stops transactional mail", async () => {
    const { db, ctx, email } = harness();
    db.find("profiles", { id: USER })!.marketing_opt_out_at = ago(HOUR);

    for (const kind of ["lifecycle", "announcement"] as const) {
      expect(await sendOnce(db.asDb(), ctx.email, { userId: USER, step: `m.${kind}`, kind, message })).toBe("opted_out");
    }
    for (const kind of ["transactional", "admin"] as const) {
      expect(await sendOnce(db.asDb(), ctx.email, { userId: USER, step: `t.${kind}`, kind, message })).toBe("sent");
    }
    expect(email.sent).toHaveLength(2);
  });
});

describe("unsubscribing", () => {
  function server(ctx: WorkerContext) {
    return createServer(ctx, {} as Queues);
  }

  it("is one POST with the signed token, and it stops the sequence but not the welcome", async () => {
    const { db, ctx, email } = harness({ signedUpAgo: 1.2 * DAY, welcomed: false });
    const token = signUnsubscribeToken(USER, SECRET)!;

    const res = await server(ctx).request("/email/unsubscribe", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${SECRET}` },
      body: JSON.stringify({ token }),
    });
    expect(res.status).toBe(200);
    expect(db.find("profiles", { id: USER })?.marketing_opt_out_at).toBeTruthy();

    expect(await runOnboardingSequence(ctx, NOW)).toBe(0);
    const account = await sendAccountEmails(ctx, USER, NOW);
    expect(account.welcome).toBe("sent");
    expect(email.sent.map((m) => m.subject)).toEqual([`Welcome to ${BRAND.name} — meet your team`]);
  });

  it("refuses a forged token and a missing secret", async () => {
    const { db, ctx } = harness();
    const forged = signUnsubscribeToken(USER, "x".repeat(48))!;

    const bad = await server(ctx).request("/email/unsubscribe", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${SECRET}` },
      body: JSON.stringify({ token: forged }),
    });
    expect(bad.status).toBe(400);

    const unauthenticated = await server(ctx).request("/email/unsubscribe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: signUnsubscribeToken(USER, SECRET) }),
    });
    expect(unauthenticated.status).toBe(401);
    expect(db.find("profiles", { id: USER })?.marketing_opt_out_at).toBeFalsy();
  });
});

describe("the welcome and the operators' notifications", () => {
  it("welcomes once however many times signup, confirmation and onboarding call", async () => {
    const { ctx, email } = harness({ welcomed: false });

    await sendAccountEmails(ctx, USER, NOW);
    await sendAccountEmails(ctx, USER, NOW);
    await sendAccountEmails(ctx, USER, NOW);

    expect(email.sent.filter((m) => m.subject.startsWith("Welcome"))).toHaveLength(1);
  });

  it("tells every platform admin and every extra address, each once", async () => {
    const { db, ctx, email } = harness({
      welcomed: false,
      signedUpAgo: HOUR,
      // One extra inbox, and one admin listed again in another case.
      adminEmails: "ops@nora.test, ANA@nora.test",
    });
    seedAdmins(db);

    await sendAccountEmails(ctx, USER, NOW);
    await sendAccountEmails(ctx, USER, NOW);

    const signups = email.sent.filter((m) => m.subject.startsWith("New signup"));
    expect(signups.map((m) => m.to).sort()).toEqual(["ana@nora.test", "ben@nora.test", "ops@nora.test"]);
    expect(signups[0]?.html).toContain("sam@acme.test");

    // One note per person, at signup — never a second "finished setup" one,
    // even for a user who already has a workspace. Two near-identical emails
    // per customer read to the operators as a fault.
    expect(email.sent.filter((m) => m.subject.startsWith("Onboarding finished"))).toHaveLength(0);
    expect(email.sent.filter((m) => m.to === "ben@nora.test")).toHaveLength(1);
  });

  it("notices a newly connected LinkedIn account on the hourly run", async () => {
    const { db, ctx, email } = harness({ signedUpAgo: 30 * DAY });
    seedAdmins(db);
    db.seed("linkedin_accounts", [
      { workspace_id: WORKSPACE, user_id: USER, status: "active", connected_at: ago(HOUR) },
    ]);

    await runLifecycleEmails(ctx, NOW);
    await runLifecycleEmails(ctx, NOW);

    const connected = email.sent.filter((m) => m.subject.startsWith("LinkedIn connected"));
    expect(connected.map((m) => m.to).sort()).toEqual(["ana@nora.test", "ben@nora.test"]);
  });

  it("does not announce last month's customers on the first run after a deploy", async () => {
    const { db, ctx, email } = harness({ signedUpAgo: 30 * DAY });
    seedAdmins(db);
    db.seed("linkedin_accounts", [
      { workspace_id: WORKSPACE, user_id: USER, status: "active", connected_at: ago(20 * DAY) },
    ]);

    await runLifecycleEmails(ctx, NOW);
    expect(email.sent).toHaveLength(0);
  });
});

describe("announcements", () => {
  function withAudience() {
    const h = harness({ signedUpAgo: 30 * DAY });
    seedAdmins(h.db);
    h.db.seed("profiles", [
      { id: OTHER, email: "opted@out.test", full_name: "Out", created_at: ago(40 * DAY), marketing_opt_out_at: ago(DAY) },
    ]);
    return h;
  }

  async function drafted(ctx: WorkerContext) {
    const saved = await saveAnnouncement(ctx, {
      userId: ADMIN_A,
      subject: "Replies now land in your inbox",
      body: "Short version: they do.\n\nLonger version: they really do.",
      ctaLabel: "Take a look",
      ctaUrl: "https://app.test/app/inbox",
    });
    if (!saved.ok) throw new Error(saved.error);
    return saved.id;
  }

  it("cannot be sent twice — not by a second press, and not by a second delivery", async () => {
    const { db, ctx, email } = withAudience();
    const id = await drafted(ctx);

    expect(await requestAnnouncementSend(ctx, { userId: ADMIN_A, id })).toEqual({ ok: true });
    const again = await requestAnnouncementSend(ctx, { userId: ADMIN_B, id });
    expect(again.ok).toBe(false);

    await deliverAnnouncement(ctx, id);
    await deliverAnnouncement(ctx, id);
    await resumeAnnouncements(ctx, new Date(Date.now() + DAY));

    const received = email.sent.map((m) => m.to).sort();
    // Everybody once; nobody who unsubscribed.
    expect(received).toEqual(["ana@nora.test", "ben@nora.test", "sam@acme.test"]);
    expect(db.find("announcements", { id })?.recipients).toBe(3);
  });

  it("delivers nothing for an announcement nobody pressed send on", async () => {
    const { ctx, email } = withAudience();
    const id = await drafted(ctx);

    expect(await deliverAnnouncement(ctx, id)).toBe(0);
    expect(email.sent).toHaveLength(0);
  });

  it("finishes a send that died half way, reaching only the people it missed", async () => {
    const { db, ctx, email } = withAudience();
    const id = await drafted(ctx);
    await requestAnnouncementSend(ctx, { userId: ADMIN_A, id });
    // As though the first run reached Sam and then died.
    db.seed("email_sends", [
      { user_id: USER, step: `announcement.${id}`, kind: "announcement", status: "sent", sent_at: ago(HOUR) },
    ]);
    db.find("announcements", { id })!.send_requested_at = ago(HOUR);

    await resumeAnnouncements(ctx, NOW);
    expect(email.sent.map((m) => m.to).sort()).toEqual(["ana@nora.test", "ben@nora.test"]);
  });

  it("refuses everybody who is not a platform admin", async () => {
    const { ctx } = withAudience();
    const id = await drafted(ctx);

    const saved = await saveAnnouncement(ctx, {
      userId: USER,
      subject: "x",
      body: "y",
      ctaLabel: null,
      ctaUrl: null,
    });
    expect(saved.ok).toBe(false);
    expect((await requestAnnouncementSend(ctx, { userId: USER, id })).ok).toBe(false);
  });

  it("is reachable only with the internal secret, and only for a platform admin", async () => {
    const { ctx } = withAudience();
    const app = createServer(ctx, {} as Queues);
    const body = (userId: string) =>
      JSON.stringify({ op: "save", userId, subject: "Hello", body: "World", ctaLabel: null, ctaUrl: null });

    const anonymous = await app.request("/admin/announcements", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body(ADMIN_A),
    });
    expect(anonymous.status).toBe(401);

    const customer = await app.request("/admin/announcements", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${SECRET}` },
      body: body(USER),
    });
    expect(customer.status).toBe(400);

    const admin = await app.request("/admin/announcements", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${SECRET}` },
      body: body(ADMIN_A),
    });
    expect(admin.status).toBe(200);
  });

  it("will not edit what has already gone out", async () => {
    const { ctx } = withAudience();
    const id = await drafted(ctx);
    await requestAnnouncementSend(ctx, { userId: ADMIN_A, id });

    const edited = await saveAnnouncement(ctx, {
      userId: ADMIN_A,
      id,
      subject: "Rewritten",
      body: "after the fact",
      ctaLabel: null,
      ctaUrl: null,
    });
    expect(edited.ok).toBe(false);
  });
});

describe("trial warnings", () => {
  /*
   * With the trial limit switched on.
   *
   * The limit is suspended by default until pricing is decided, and while it
   * is off the warning returns before any of these checks run. Left unpinned,
   * "does not warn a workspace that has already subscribed" would keep passing
   * for that reason alone — green, and no longer testing the subscription
   * check at all, which is how a mutation quietly stops biting.
   */
  describe("with the trial limit on", () => {
    let was: string | undefined;
    beforeEach(() => {
      was = process.env.TRIAL_LIMIT_ENFORCED;
      process.env.TRIAL_LIMIT_ENFORCED = "true";
    });
    afterEach(() => {
      if (was === undefined) delete process.env.TRIAL_LIMIT_ENFORCED;
      else process.env.TRIAL_LIMIT_ENFORCED = was;
    });

    it("warns three days before a trial ends", async () => {
      const { ctx, email } = harness({ trialEndsInDays: 3, signedUpAgo: 30 * DAY });

      await runLifecycleEmails(ctx, NOW);
      const trial = email.sent.find((m) => m.subject.includes("trial"));
      expect(trial?.subject).toBe("Your trial ends in 3 days");
    });

    it("does not warn a workspace that has already subscribed", async () => {
      const { db, ctx, email } = harness({ trialEndsInDays: 3, signedUpAgo: 30 * DAY });
      db.find("workspaces", { id: WORKSPACE })!.subscription_status = "active";

      await runLifecycleEmails(ctx, NOW);
      expect(email.sent.some((m) => m.subject.includes("trial"))).toBe(false);
    });

    it("says the numbers are early rather than claiming success on three invitations", async () => {
      const { ctx, email } = harness({ trialEndsInDays: 1, signedUpAgo: 30 * DAY });

      await runLifecycleEmails(ctx, NOW);
      const trial = email.sent.find((m) => m.subject.includes("trial"));
      expect(trial?.text).toContain("not yet a fair test");
    });
  });

  it("sends no trial-ending email while the trial limit is off", async () => {
    // "Your trial ends in 3 days" for a trial that does not end is a threat
    // the product does not carry out, and the real one later reads as another
    // false alarm.
    const was = process.env.TRIAL_LIMIT_ENFORCED;
    delete process.env.TRIAL_LIMIT_ENFORCED;
    try {
      const { ctx, email } = harness({ trialEndsInDays: 3 });
      await runLifecycleEmails(ctx, NOW);
      expect(email.sent.some((m) => m.subject.toLowerCase().includes("trial"))).toBe(false);
    } finally {
      if (was !== undefined) process.env.TRIAL_LIMIT_ENFORCED = was;
    }
  });

  it("does nothing at all when email is not configured", async () => {
    const { ctx } = harness();
    const withoutEmail = { ...ctx, email: null } as WorkerContext;

    expect(await runLifecycleEmails(withoutEmail, NOW)).toBe(0);
  });
});
