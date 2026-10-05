import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { forwardQuery } from "../src/lib/forward-query";

/**
 * Every team refusal was said to nobody.
 *
 * The invite actions redirected to `/app/team?error=…`, and `/app/team`
 * redirects to `/app/profile#team` — dropping the query on the way. So "this
 * workspace has reached its member limit" and "the email was not sent" were
 * rendered on no screen, and an invitation that was never emailed looked sent.
 * A worker answering `{ delivered: false }` was read only for `ok`, which made
 * the same mistake a second way.
 */
const SRC = join(__dirname, "..", "src");
const section = readFileSync(join(SRC, "app", "app", "profile", "team-section.tsx"), "utf8");
const teamPage = readFileSync(join(SRC, "app", "app", "team", "page.tsx"), "utf8");

describe("forwardQuery", () => {
  it("keeps every parameter, repeated ones included", () => {
    expect(forwardQuery({ error: "No seats left", notice: undefined })).toBe("?error=No+seats+left");
    expect(forwardQuery({ a: ["1", "2"] })).toBe("?a=1&a=2");
    expect(forwardQuery({})).toBe("");
  });
});

describe("team actions report back", () => {
  it("never send a message through the route that drops it", () => {
    expect(section).not.toMatch(/"\/app\/team\?/);
    expect(section).not.toMatch(/(errorQuery|noticeQuery)\("\/app\/team"/);
  });

  it("land on the profile's team section with the query before the anchor", () => {
    expect(section).toMatch(/return `\$\{build\("\/app\/profile", message\)\}#team`;/);
  });

  it("say so when the email was not delivered", () => {
    expect(section).toMatch(/callWorker<\{ delivered\?: boolean \}>\("\/jobs\/send-invite"/);
    expect(section).toMatch(/if \(sent\.data\?\.delivered === false\) \{[\s\S]{0,300}?the email was not sent/);
  });

  it("revoke reads the field its form posts", () => {
    expect(section).toMatch(/name="invitationId" value=\{invitation\.id\}/);
    expect(section).toMatch(/formData\.get\("invitationId"\)/);
  });

  it("the old route forwards its query string", () => {
    expect(teamPage).toMatch(/redirect\(`\/app\/profile\$\{forwardQuery\(await searchParams\)\}#team`\)/);
  });
});
