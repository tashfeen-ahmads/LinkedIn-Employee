import { describe, expect, it, vi } from "vitest";
import { SalesforceProvider, activitySubject, quote, refreshSalesforceToken } from "../src/salesforce.js";
import { CrmError } from "../src/provider.js";

const INSTANCE = "https://acme.my.salesforce.com";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("quote", () => {
  it("escapes the quote that would otherwise break the query", () => {
    expect(quote("O'Brien")).toBe("'O\\'Brien'");
  });

  it("escapes backslashes before quotes so the escape cannot be escaped away", () => {
    expect(quote("back\\slash")).toBe("'back\\\\slash'");
  });

  it("neutralises an injection attempt in a company name", () => {
    // SOQL is built as text, so a company literally named this must not end
    // the string and append a clause.
    const hostile = "Acme' OR Id != null OR Company = 'x";
    const quoted = quote(hostile);
    expect(quoted.startsWith("'")).toBe(true);
    expect(quoted.endsWith("'")).toBe(true);
    // Every inner quote is escaped, so nothing terminates the literal early.
    expect(quoted.slice(1, -1)).not.toMatch(/(?<!\\)'/);
  });
});

describe("SalesforceProvider.upsertContact", () => {
  it("creates a Lead, not a Contact, for someone who has never spoken to us", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      calls.push(href);
      if (href.includes("/query")) return jsonResponse({ records: [] });
      return jsonResponse({ id: "00Q000000000001" });
    }) as unknown as typeof fetch;

    const provider = new SalesforceProvider({ instanceUrl: INSTANCE, fetchImpl });
    const id = await provider.upsertContact({
      accessToken: "tok",
      contact: { linkedinUrl: "linkedin.com/in/jane", firstName: "Jane", lastName: "Doe", company: "Northwind", source: "LinkedIn Employee" },
    });

    expect(id).toBe("00Q000000000001");
    expect(calls.some((c) => c.includes("/sobjects/Lead"))).toBe(true);
    expect(calls.some((c) => c.includes("/sobjects/Contact"))).toBe(false);
  });

  it("reuses an existing record rather than duplicating it", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes("/query")) return jsonResponse({ records: [{ Id: "00Q_existing" }] });
      throw new Error("should not have created anything");
    }) as unknown as typeof fetch;

    const provider = new SalesforceProvider({ instanceUrl: INSTANCE, fetchImpl });
    const id = await provider.upsertContact({
      accessToken: "tok",
      contact: { linkedinUrl: "x", lastName: "Doe", company: "Northwind", email: "jane@northwind.test", source: "s" },
    });

    expect(id).toBe("00Q_existing");
  });

  it("skips the lookup when there is nothing to match on", async () => {
    let queried = false;
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes("/query")) queried = true;
      return jsonResponse({ id: "new" });
    }) as unknown as typeof fetch;

    const provider = new SalesforceProvider({ instanceUrl: INSTANCE, fetchImpl });
    await provider.upsertContact({ accessToken: "tok", contact: { linkedinUrl: "x", source: "s" } });

    expect(queried).toBe(false);
  });

  it("always supplies the required LastName and Company", async () => {
    let body: Record<string, unknown> = {};
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).includes("/query")) return jsonResponse({ records: [] });
      body = JSON.parse(String(init?.body));
      return jsonResponse({ id: "new" });
    }) as unknown as typeof fetch;

    const provider = new SalesforceProvider({ instanceUrl: INSTANCE, fetchImpl });
    await provider.upsertContact({ accessToken: "tok", contact: { linkedinUrl: "x", source: "s" } });

    expect(body.LastName).toBe("Unknown");
    expect(body.Company).toBe("Unknown");
  });

  it("marks a rate limit retryable and a bad request not", async () => {
    const make = (status: number) =>
      new SalesforceProvider({
        instanceUrl: INSTANCE,
        fetchImpl: vi.fn(async () => jsonResponse([{ message: "nope" }], status)) as unknown as typeof fetch,
      });

    await expect(
      make(429).upsertContact({ accessToken: "t", contact: { linkedinUrl: "x", source: "s" } }),
    ).rejects.toMatchObject({ retryable: true });
    await expect(
      make(400).upsertContact({ accessToken: "t", contact: { linkedinUrl: "x", source: "s" } }),
    ).rejects.toBeInstanceOf(CrmError);
  });
});

describe("activitySubject", () => {
  it("names the AI as the author where it wrote the message", () => {
    expect(
      activitySubject({ contactId: "1", occurredAt: "", direction: "outbound", authoredBy: "agent", body: "" }),
    ).toContain("AI agent");
  });

  it("does not claim a human message was automated", () => {
    expect(
      activitySubject({ contactId: "1", occurredAt: "", direction: "outbound", authoredBy: "human", body: "" }),
    ).not.toContain("AI");
  });
});

describe("refreshSalesforceToken", () => {
  it("keeps the existing refresh token, which the response omits", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ access_token: "new_access", instance_url: INSTANCE }),
    ) as unknown as typeof fetch;

    const tokens = await refreshSalesforceToken(
      { refreshToken: "keep_me", clientId: "id", clientSecret: "secret" },
      fetchImpl,
    );

    expect(tokens.accessToken).toBe("new_access");
    expect(tokens.refreshToken).toBe("keep_me");
    expect(tokens.expiresAt).toBeGreaterThan(Date.now());
  });
});
