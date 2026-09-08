import { describe, expect, it, vi } from "vitest";
import { HubSpotProvider, renderActivity } from "../src/hubspot.js";
import { MockCrmProvider } from "../src/mock.js";
import { WebhookProvider, signPayload } from "../src/webhook.js";
import { CrmError, isRetryableStatus } from "../src/provider.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("HubSpot contact upsert", () => {
  it("updates an existing contact rather than creating a duplicate", async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      calls.push({ url: href, method: init?.method ?? "GET" });
      if (href.includes("/search")) return jsonResponse({ results: [{ id: "501" }] });
      return jsonResponse({ id: "501" });
    }) as unknown as typeof fetch;

    const provider = new HubSpotProvider({ fetchImpl });
    const id = await provider.upsertContact({
      accessToken: "token",
      contact: { linkedinUrl: "linkedin.com/in/jane-doe", firstName: "Jane", source: "LinkedIn Employee" },
    });

    expect(id).toBe("501");
    expect(calls.some((c) => c.method === "PATCH")).toBe(true);
    expect(calls.some((c) => c.method === "POST" && c.url.endsWith("/contacts"))).toBe(false);
  });

  it("creates a contact when the LinkedIn URL is unknown", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes("/search")) return jsonResponse({ results: [] });
      return jsonResponse({ id: "900" });
    }) as unknown as typeof fetch;

    const provider = new HubSpotProvider({ fetchImpl });
    const id = await provider.upsertContact({
      accessToken: "token",
      contact: { linkedinUrl: "linkedin.com/in/new-person", source: "LinkedIn Employee" },
    });
    expect(id).toBe("900");
  });

  it("marks a rate-limited response retryable and a bad request not", async () => {
    const make = (status: number) =>
      new HubSpotProvider({
        fetchImpl: vi.fn(async () => jsonResponse({ message: "nope" }, status)) as unknown as typeof fetch,
      });

    await expect(
      make(429).upsertContact({ accessToken: "t", contact: { linkedinUrl: "x", source: "s" } }),
    ).rejects.toMatchObject({ retryable: true });

    await expect(
      make(400).upsertContact({ accessToken: "t", contact: { linkedinUrl: "x", source: "s" } }),
    ).rejects.toMatchObject({ retryable: false });
  });
});

describe("renderActivity", () => {
  it("says plainly when the agent wrote the message", () => {
    const body = renderActivity({
      contactId: "1",
      occurredAt: new Date().toISOString(),
      direction: "outbound",
      authoredBy: "agent",
      body: "Hi Jane, saw your post on pricing ops.",
    });
    expect(body).toContain("AI agent");
  });

  it("does not claim a human message was automated", () => {
    const body = renderActivity({
      contactId: "1",
      occurredAt: new Date().toISOString(),
      direction: "outbound",
      authoredBy: "human",
      body: "Following up personally.",
    });
    expect(body).not.toContain("AI agent");
  });

  it("escapes markup from the prospect so a CRM note cannot inject HTML", () => {
    const body = renderActivity({
      contactId: "1",
      occurredAt: new Date().toISOString(),
      direction: "inbound",
      authoredBy: "human",
      body: '<script>alert("x")</script>',
    });
    expect(body).not.toContain("<script>");
    expect(body).toContain("&lt;script&gt;");
  });
});

describe("WebhookProvider", () => {
  it("signs the exact bytes it sends", async () => {
    let sentBody = "";
    let signature = "";
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      sentBody = String(init?.body);
      signature = new Headers(init?.headers).get("x-le-signature") ?? "";
      return new Response("", { status: 200 });
    }) as unknown as typeof fetch;

    const provider = new WebhookProvider({ url: "https://example.test/hook", secret: "shh" }, { fetchImpl });
    await provider.logMeeting({
      accessToken: "",
      meeting: { contactId: "c1", title: "Intro", startsAt: "2026-09-10T10:00:00Z", endsAt: "2026-09-10T10:30:00Z" },
    });

    expect(signature).toBe(signPayload(sentBody, "shh"));
  });

  it("omits the signature when no secret is configured", async () => {
    let signature: string | null = "unset";
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      signature = new Headers(init?.headers).get("x-le-signature");
      return new Response("", { status: 200 });
    }) as unknown as typeof fetch;

    await new WebhookProvider({ url: "https://example.test/hook" }, { fetchImpl }).logActivity({
      accessToken: "",
      activity: { contactId: "c", occurredAt: "2026-09-10T10:00:00Z", direction: "inbound", authoredBy: "human", body: "hi" },
    });
    expect(signature).toBeNull();
  });

  it("surfaces a failing receiver as a retryable error", async () => {
    const fetchImpl = vi.fn(async () => new Response("boom", { status: 503 })) as unknown as typeof fetch;
    const provider = new WebhookProvider({ url: "https://example.test/hook" }, { fetchImpl });
    await expect(
      provider.upsertContact({ accessToken: "", contact: { linkedinUrl: "x", source: "s" } }),
    ).rejects.toBeInstanceOf(CrmError);
  });
});

describe("MockCrmProvider", () => {
  it("upserts on the LinkedIn URL", async () => {
    const crm = new MockCrmProvider();
    await crm.upsertContact({ accessToken: "", contact: { linkedinUrl: "a", firstName: "One", source: "s" } });
    await crm.upsertContact({ accessToken: "", contact: { linkedinUrl: "a", firstName: "Two", source: "s" } });
    expect(crm.contacts).toHaveLength(1);
    expect(crm.contacts[0]?.firstName).toBe("Two");
  });
});

describe("isRetryableStatus", () => {
  it("treats throttling and server faults as retryable, client errors as final", () => {
    expect(isRetryableStatus(429)).toBe(true);
    expect(isRetryableStatus(502)).toBe(true);
    expect(isRetryableStatus(401)).toBe(false);
    expect(isRetryableStatus(404)).toBe(false);
  });
});
