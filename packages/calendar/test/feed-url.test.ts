import { describe, expect, it } from "vitest";
import { checkFeedUrl, isPrivateIp, normalizeFeedUrl } from "../src/feed-url.js";

/**
 * A URL a user types in and this server fetches, which is the definition of
 * server-side request forgery.
 *
 * The worker holds the database service-role key and answers its own internal
 * API on localhost, so a "calendar feed" pointed at 127.0.0.1 or at a cloud
 * metadata endpoint is not a broken calendar — it is a way to reach things no
 * browser could, using our credentials.
 */
describe("checkFeedUrl", () => {
  it("accepts a real published calendar", () => {
    expect(checkFeedUrl("https://calendar.google.com/calendar/ical/abc/basic.ics").ok).toBe(true);
  });

  it("accepts webcal, which is https underneath", () => {
    expect(checkFeedUrl("webcal://outlook.office365.com/owa/calendar/x/calendar.ics").ok).toBe(true);
    expect(normalizeFeedUrl("webcal://outlook.office365.com/a.ics")).toBe("https://outlook.office365.com/a.ics");
  });

  it("refuses plain http", () => {
    // The address is a bearer credential for the rep's whole calendar.
    expect(checkFeedUrl("http://calendar.google.com/a.ics").ok).toBe(false);
  });

  it("refuses this machine, by name and by address", () => {
    for (const url of [
      "https://localhost/a.ics",
      "https://127.0.0.1/a.ics",
      "https://[::1]/a.ics",
      "https://worker.internal/a.ics",
      "https://printer.local/a.ics",
    ]) {
      expect(checkFeedUrl(url), url).toMatchObject({ ok: false });
    }
  });

  it("refuses the address every cloud serves instance credentials on", () => {
    expect(checkFeedUrl("https://169.254.169.254/latest/meta-data/").ok).toBe(false);
  });

  it("refuses private ranges", () => {
    for (const url of ["https://10.0.0.5/a.ics", "https://192.168.1.1/a.ics", "https://172.16.4.4/a.ics"]) {
      expect(checkFeedUrl(url), url).toMatchObject({ ok: false });
    }
  });

  it("refuses credentials embedded in the address", () => {
    expect(checkFeedUrl("https://user:pass@calendar.google.com/a.ics").ok).toBe(false);
  });

  it("refuses something that is not a URL at all", () => {
    expect(checkFeedUrl("my calendar").ok).toBe(false);
    expect(checkFeedUrl("").ok).toBe(false);
  });
});

describe("isPrivateIp", () => {
  it("knows loopback wearing a v6 coat", () => {
    // ::ffff:127.0.0.1 reaches exactly the same socket as 127.0.0.1, and a
    // check that only reads dotted quads waves it through.
    expect(isPrivateIp("::ffff:127.0.0.1")).toBe(true);
  });

  it("knows unique-local and link-local v6", () => {
    expect(isPrivateIp("fd00::1")).toBe(true);
    expect(isPrivateIp("fe80::1")).toBe(true);
    expect(isPrivateIp("::")).toBe(true);
  });

  it("knows carrier-grade NAT, where container networks live", () => {
    expect(isPrivateIp("100.64.0.1")).toBe(true);
  });

  it("lets a public address through", () => {
    expect(isPrivateIp("142.250.187.238")).toBe(false);
    expect(isPrivateIp("2607:f8b0::1")).toBe(false);
  });

  it("treats a malformed quad as private rather than public", () => {
    // Erring the other way would make a parser bug into an open proxy.
    expect(isPrivateIp("999.1.1.1")).toBe(true);
  });
});
