import { describe, expect, it, vi } from "vitest";
import { BRAND, LINKEDIN_LIMITS } from "@le/shared";
import {
  adminNotifyEmail,
  announcementEmail,
  approveStrategiesEmail,
  checkInEmail,
  connectLinkedInEmail,
  finishSetupEmail,
  launchCampaignEmail,
  tipsEmail,
} from "../src/lifecycle.js";
import { layout } from "../src/render.js";
import { ResendProvider } from "../src/resend.js";
import {
  signUnsubscribeToken,
  unsubscribeHeaders,
  unsubscribeUrl,
  verifyUnsubscribeToken,
} from "../src/unsubscribe.js";

const USER = "22222222-2222-4222-8222-222222222222";
const base = {
  to: "sam@acme.test",
  repName: "Sam Patel",
  appUrl: "https://app.test",
  unsubscribeUrl: "https://app.test/unsubscribe/confirm?token=abc",
};

const sequence = [
  finishSetupEmail(base),
  connectLinkedInEmail(base),
  approveStrategiesEmail({ ...base, companyName: "Acme", strategies: 4 }),
  launchCampaignEmail({ ...base, hasCampaign: true }),
  launchCampaignEmail({ ...base, hasCampaign: false }),
  tipsEmail(base),
  checkInEmail({ ...base, done: ["your business profile"] }),
];

describe("the onboarding sequence", () => {
  it("carries a one-click unsubscribe on every step, as a link and as RFC 8058 headers", () => {
    for (const message of sequence) {
      expect(message.headers?.["List-Unsubscribe"]).toBe(`<${base.unsubscribeUrl}>`);
      expect(message.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
      expect(message.html).toContain("Unsubscribe from product emails");
      expect(message.html).toContain("https://app.test/unsubscribe/confirm?token=abc");
      expect(message.text).toContain(base.unsubscribeUrl);
    }
  });

  it("never mentions a price or a trial", () => {
    for (const message of sequence) {
      for (const part of [message.text, message.subject]) {
        expect(part, message.subject).not.toMatch(/trial|\$|pricing|price|credit card/i);
      }
    }
  });

  it("explains the hosted sign-in and the Google or Apple password trap", () => {
    const message = connectLinkedInEmail(base);
    expect(message.text).toContain("never see it");
    expect(message.text).toMatch(/Google or Apple/);
    expect(message.html).toContain("https://app.test/app/profile");
  });

  it("states the pacing numbers from the product rules rather than retyping them", () => {
    const message = tipsEmail(base);
    expect(message.text).toContain(`${LINKEDIN_LIMITS.invitesPerDayStart} invitations a day`);
    expect(message.text).toContain(`${LINKEDIN_LIMITS.invitesPerWeek} invitations a week`);
    expect(message.text).toContain("Sales Navigator");
  });

  it("points a built campaign at review and an unbuilt one at the strategy", () => {
    expect(launchCampaignEmail({ ...base, hasCampaign: true }).html).toContain("https://app.test/app/campaigns");
    expect(launchCampaignEmail({ ...base, hasCampaign: false }).html).toContain("https://app.test/app/strategy");
  });

  it("credits what is done in the check-in, and asks for a reply", () => {
    const message = checkInEmail({ ...base, done: ["your business profile", "your LinkedIn account"] });
    expect(message.text).toContain("your business profile and your LinkedIn account");
    expect(message.text).toMatch(/reply to this email/i);
  });
});

describe("adminNotifyEmail", () => {
  it("names the person, the company and links to their workspace in the console", () => {
    const message = adminNotifyEmail({
      to: "ops@nora.test",
      appUrl: "https://app.test",
      event: "onboarded",
      name: "Sam Patel",
      email: "sam@acme.test",
      company: "Acme",
      at: new Date("2026-10-05T15:42:00Z"),
      workspaceId: "11111111-1111-4111-8111-111111111111",
    });
    expect(message.subject).toContain("Sam Patel");
    expect(message.subject).toContain("Acme");
    expect(message.text).toContain("sam@acme.test");
    expect(message.text).toContain("5 Oct 2026, 15:42 UTC");
    expect(message.html).toContain("https://app.test/admin/workspaces/11111111-1111-4111-8111-111111111111");
    // Transactional: no way to turn off the operator's own alerts by accident.
    expect(message.headers).toBeUndefined();
  });

  it("says a signup has no company yet rather than printing null", () => {
    const message = adminNotifyEmail({
      to: "ops@nora.test",
      appUrl: "https://app.test",
      event: "signup",
      name: null,
      email: "sam@acme.test",
      company: null,
      at: new Date(),
      workspaceId: null,
    });
    expect(message.text).not.toContain("null");
    expect(message.html).toContain("https://app.test/admin");
  });
});

describe("announcementEmail", () => {
  it("escapes what an operator typed and keeps their paragraphs", () => {
    const message = announcementEmail({
      ...base,
      subject: "New: replies in your inbox",
      body: "First <b>paragraph</b>.\n\nSecond one.",
      cta: { label: "Take a look", url: "https://app.test/app/inbox" },
    });
    expect(message.html).toContain("First &lt;b&gt;paragraph&lt;/b&gt;.");
    expect(message.html).not.toContain("<b>paragraph</b>");
    expect(message.text).toContain("Second one.");
    expect(message.html).toContain("Take a look");
    expect(message.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
  });
});

describe("unsubscribe tokens", () => {
  const secret = "s".repeat(40);

  it("round-trips a user id", () => {
    const token = signUnsubscribeToken(USER, secret)!;
    expect(verifyUnsubscribeToken(token, secret)).toBe(USER);
  });

  it("refuses a token signed by another deployment, or tampered with", () => {
    const token = signUnsubscribeToken(USER, secret)!;
    expect(verifyUnsubscribeToken(token, "x".repeat(40))).toBeNull();
    const other = Buffer.from("33333333-3333-4333-8333-333333333333").toString("base64url");
    expect(verifyUnsubscribeToken(`${other}.${token.split(".")[1]}`, secret)).toBeNull();
    expect(verifyUnsubscribeToken("garbage", secret)).toBeNull();
    expect(verifyUnsubscribeToken(undefined, secret)).toBeNull();
  });

  it("fails closed without a secret", () => {
    expect(signUnsubscribeToken(USER, undefined)).toBeNull();
    const token = signUnsubscribeToken(USER, secret)!;
    expect(verifyUnsubscribeToken(token, undefined)).toBeNull();
  });

  it("points at the app host", () => {
    expect(unsubscribeUrl("https://app.test/", "a.b")).toBe("https://app.test/unsubscribe/confirm?token=a.b");
    expect(unsubscribeHeaders("https://x.test/u")["List-Unsubscribe"]).toBe("<https://x.test/u>");
  });
});

describe("layout", () => {
  const html = layout({
    title: "Hello",
    body: "<p>x</p>",
    preheader: "The preview line",
    cta: { label: "Go", url: "https://app.test/go" },
    appUrl: "https://app.test",
  });

  it("is built for email clients: dark mode, a preheader, a bulletproof button and a PNG logo", () => {
    expect(html).toContain('<meta name="color-scheme" content="light dark">');
    expect(html).toContain("prefers-color-scheme: dark");
    expect(html).toContain("The preview line");
    expect(html).toContain("v:roundrect");
    expect(html).toContain("https://app.test/email/logo.png");
    expect(html).toContain(`alt="${BRAND.full}"`);
    expect(html).toContain("max-width: 620px");
    expect(html).not.toMatch(/<svg/i);
  });

  it("offers no unsubscribe on transactional mail", () => {
    expect(html).not.toContain("Unsubscribe");
  });

  it("falls back to the marketing host for the logo", () => {
    expect(layout({ title: "x", body: "" })).toContain(`${BRAND.site}/email/logo.png`);
  });
});

describe("ResendProvider headers", () => {
  it("passes List-Unsubscribe through to the API", async () => {
    let sent: Record<string, unknown> = {};
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ id: "re_1" }), { status: 200 });
    }) as unknown as typeof fetch;
    const provider = new ResendProvider({ apiKey: "k", from: "a@b.test" }, { fetchImpl });
    await provider.send({ ...finishSetupEmail(base) });
    expect((sent.headers as Record<string, string>)["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
  });
});
