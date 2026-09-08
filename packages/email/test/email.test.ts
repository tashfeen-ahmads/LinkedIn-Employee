import { describe, expect, it, vi } from "vitest";
import { MockEmailProvider } from "../src/mock.js";
import { ResendProvider } from "../src/resend.js";
import { EmailError } from "../src/provider.js";
import { accountPausedEmail, digestEmail, inviteEmail } from "../src/templates.js";
import { escapeHtml } from "../src/render.js";

describe("inviteEmail", () => {
  const base = {
    to: "teammate@company.com",
    workspaceName: "Acme",
    inviterName: "Jane Doe",
    role: "rep",
    acceptUrl: "https://app.test/invite/tok123",
    expiresInDays: 7,
  };

  it("carries the accept link in both parts", () => {
    const message = inviteEmail(base);
    expect(message.html).toContain(base.acceptUrl);
    // A missing text part is what lands transactional mail in spam.
    expect(message.text).toContain(base.acceptUrl);
  });

  it("says who invited them and to what", () => {
    const message = inviteEmail(base);
    expect(message.subject).toContain("Jane Doe");
    expect(message.subject).toContain("Acme");
  });

  it("falls back gracefully when the inviter has no name", () => {
    const message = inviteEmail({ ...base, inviterName: null });
    expect(message.subject).toContain("A colleague");
  });

  it("states the expiry and that the link is address-bound", () => {
    const message = inviteEmail(base);
    expect(message.html).toContain("7 days");
    expect(message.html).toContain("teammate@company.com");
  });

  it("escapes a hostile workspace name rather than rendering it", () => {
    const message = inviteEmail({ ...base, workspaceName: '<script>alert("x")</script>' });
    expect(message.html).not.toContain("<script>");
    expect(message.html).toContain("&lt;script&gt;");
  });
});

describe("digestEmail", () => {
  const base = {
    to: "rep@company.com",
    repName: "Sam Patel",
    appUrl: "https://app.test",
    invitesSent: 12,
    accepted: 4,
    replies: 2,
    meetingsBooked: 1,
    awaitingApproval: 0,
    upcoming: [],
    warnings: [],
  };

  it("leads the subject with the number that needs the rep", () => {
    const message = digestEmail({ ...base, awaitingApproval: 3 });
    expect(message.subject).toBe("3 replies need you");
  });

  it("uses the singular when there is one", () => {
    expect(digestEmail({ ...base, awaitingApproval: 1 }).subject).toBe("1 reply needs you");
  });

  it("falls back to meetings when nothing needs approval", () => {
    expect(digestEmail(base).subject).toContain("1 meeting booked");
  });

  it("still sends something sensible on a quiet day", () => {
    const quiet = digestEmail({ ...base, invitesSent: 0, accepted: 0, replies: 0, meetingsBooked: 0 });
    expect(quiet.subject).toBe("Your LinkedIn Employee digest");
    expect(quiet.text).toContain("0 accepted");
  });

  it("greets by first name only", () => {
    expect(digestEmail(base).text.startsWith("Morning, Sam.")).toBe(true);
  });

  it("copes with no name at all", () => {
    expect(digestEmail({ ...base, repName: null }).text.startsWith("Morning.")).toBe(true);
  });

  it("includes warnings when there are any, and omits the section otherwise", () => {
    const withWarning = digestEmail({ ...base, warnings: ["LinkedIn account paused"] });
    expect(withWarning.html).toContain("Needs attention");
    expect(digestEmail(base).html).not.toContain("Needs attention");
  });

  it("links to the inbox, which is where the work is", () => {
    expect(digestEmail(base).html).toContain("https://app.test/app/inbox");
  });
});

describe("accountPausedEmail", () => {
  it("says what stopped and reassures nothing was lost", () => {
    const message = accountPausedEmail({
      to: "rep@company.com",
      appUrl: "https://app.test",
      status: "reauth_required",
      detail: "LinkedIn asked for a verification code.",
    });
    expect(message.text).toContain("reauth required");
    expect(message.text).toContain("Nothing has been lost");
    expect(message.html).toContain("https://app.test/app/team");
  });

  it("works when the provider gave no detail", () => {
    const message = accountPausedEmail({ to: "r@c.com", appUrl: "https://app.test", status: "warning", detail: null });
    expect(message.text).not.toContain("null");
  });
});

describe("ResendProvider", () => {
  it("sends both parts and returns the id", async () => {
    let sentBody: Record<string, unknown> = {};
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      sentBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ id: "re_123" }), { status: 200 });
    }) as unknown as typeof fetch;

    const provider = new ResendProvider({ apiKey: "key", from: "hello@app.test" }, { fetchImpl });
    const result = await provider.send({ to: "a@b.com", subject: "s", html: "<p>h</p>", text: "h" });

    expect(result.id).toBe("re_123");
    expect(sentBody.html).toBe("<p>h</p>");
    expect(sentBody.text).toBe("h");
    expect(sentBody.from).toBe("hello@app.test");
  });

  it("surfaces a rejection rather than pretending it sent", async () => {
    const fetchImpl = vi.fn(async () => new Response("bad domain", { status: 422 })) as unknown as typeof fetch;
    const provider = new ResendProvider({ apiKey: "key", from: "hello@app.test" }, { fetchImpl });

    await expect(provider.send({ to: "a@b.com", subject: "s", html: "", text: "" })).rejects.toBeInstanceOf(
      EmailError,
    );
  });
});

describe("MockEmailProvider", () => {
  it("captures instead of sending", async () => {
    const provider = new MockEmailProvider();
    await provider.send({ to: "a@b.com", subject: "s", html: "", text: "" });
    expect(provider.sent).toHaveLength(1);
  });
});

describe("escapeHtml", () => {
  it("neutralises the characters that break out of an attribute or tag", () => {
    expect(escapeHtml(`<a href="x" onclick='y'>&`)).toBe("&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;");
  });
});
