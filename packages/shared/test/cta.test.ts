import { describe, expect, it } from "vitest";
import {
  CTA_DEFINITIONS,
  CTA_PLACEHOLDER,
  checkCtaUrl,
  containsLink,
  finalStage,
  renderCta,
  effectiveCta,
} from "../src/cta.js";
import { stagesFor } from "../src/funnel.js";

/**
 * A CTA is the campaign's goal, and the goal decides what counts as success.
 *
 * The failure these guard against is a campaign that did exactly what it was
 * asked to do being reported as a failure — because the funnel counted
 * meetings and this one was never asking for one.
 */

describe("checkCtaUrl", () => {
  it("accepts an ordinary destination", () => {
    const result = checkCtaUrl("https://acme.test/signup?ref=li");
    expect(result.ok).toBe(true);
  });

  it("refuses a scheme that is not a web address", () => {
    // This string goes into a message sent to a stranger under a real rep's
    // name. `javascript:` is not somewhere a prospect can go.
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "file:///etc/passwd"]) {
      const result = checkCtaUrl(bad);
      expect(result.ok, bad).toBe(false);
    }
  });

  it("names the scheme rather than blaming the domain", () => {
    // The scheme check adds no safety the domain check does not already give —
    // nothing without an http(s):// prefix survives either. What it adds is a
    // reason somebody can act on: told "that address has no domain name in it"
    // about `javascript:alert(1)`, a person goes looking for a typo in a
    // hostname that was never the problem.
    const result = checkCtaUrl("javascript:alert(1)");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("javascript:");
      expect(result.reason).not.toMatch(/domain/);
    }
  });

  it("refuses an address with no domain in it", () => {
    // Both parse as valid URLs and reach nobody.
    expect(checkCtaUrl("https://localhost/signup").ok).toBe(false);
    expect(checkCtaUrl("https://signup").ok).toBe(false);
  });

  it("refuses a bare domain, because the message would not link", () => {
    // LinkedIn does not linkify "acme.test/signup" reliably, and a prospect
    // who has to retype it does not go.
    expect(checkCtaUrl("acme.test/signup").ok).toBe(false);
  });

  it("says what is wrong in words the person can act on", () => {
    const result = checkCtaUrl("acme.test/signup");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/https:\/\//);
  });

  it("refuses an empty destination for a campaign that needs one", () => {
    expect(checkCtaUrl("   ").ok).toBe(false);
  });
});

describe("containsLink", () => {
  it("catches a link however it got in", () => {
    // LinkedIn penalises links in connection requests and they measurably cut
    // acceptance. The prompt already says not to; this is what makes it true.
    expect(containsLink("Take a look: https://acme.test")).toBe(true);
    expect(containsLink("Take a look: www.acme.test/x")).toBe(true);
    expect(containsLink(`Take a look: ${CTA_PLACEHOLDER}`)).toBe(true);
  });

  it("does not see a link in ordinary prose", () => {
    // "e.g." and "i.e." and a sentence ending in a full stop are not links,
    // and a check that flagged them would block every note ever written.
    expect(containsLink("Hi Jane, we work with ops leaders. Worth a look?")).toBe(false);
    expect(containsLink("We do this for agencies, e.g. small creative shops.")).toBe(false);
  });
});

describe("renderCta", () => {
  it("puts the destination in", () => {
    expect(renderCta(`Try it: ${CTA_PLACEHOLDER}`, "https://acme.test")).toBe(
      "Try it: https://acme.test",
    );
  });

  it("replaces every mention, not only the first", () => {
    const twice = `${CTA_PLACEHOLDER} and again ${CTA_PLACEHOLDER}`;
    expect(renderCta(twice, "https://a.test")).toBe("https://a.test and again https://a.test");
  });

  it("leaves the placeholder alone when there is no destination", () => {
    // A sentence ending "take a look here:" with nothing after it reaches a
    // prospect looking like a broken product. A visible {{cta_link}} is caught
    // on the review screen instead.
    expect(renderCta(`Try it: ${CTA_PLACEHOLDER}`, null)).toBe(`Try it: ${CTA_PLACEHOLDER}`);
    expect(renderCta(`Try it: ${CTA_PLACEHOLDER}`, "   ")).toBe(`Try it: ${CTA_PLACEHOLDER}`);
  });
});

describe("finalStage", () => {
  it("judges a meeting campaign on meetings", () => {
    expect(finalStage("meeting")).toBe("meetings");
  });

  it("does not judge a link campaign on meetings it was never asking for", () => {
    // The whole point. A funnel ending in a permanent zero reports a working
    // campaign as a failed one.
    expect(finalStage("link")).toBe("positive");
    expect(finalStage("reply")).toBe("positive");
  });
});

describe("stagesFor", () => {
  it("keeps meetings for a campaign that asked for one", () => {
    expect(stagesFor("meeting").map((s) => s.key)).toContain("meetings");
  });

  it("drops the stage a link campaign can never reach", () => {
    // The whole point of the goal being a first-class thing. A funnel ending
    // in "Meetings: 0" reports a campaign that did exactly what it was asked
    // to do as a failure, every day, for ever.
    for (const kind of ["link", "reply"] as const) {
      expect(stagesFor(kind).map((s) => s.key), kind).not.toContain("meetings");
      // And still counts everything up to it: the earlier stages are how a
      // link campaign is judged at all.
      expect(stagesFor(kind).map((s) => s.key), kind).toContain("positive");
    }
  });
});

describe("the definitions", () => {
  it("only asks for a URL where one is needed", () => {
    expect(CTA_DEFINITIONS.link.needsUrl).toBe(true);
    expect(CTA_DEFINITIONS.meeting.needsUrl).toBe(false);
    expect(CTA_DEFINITIONS.reply.needsUrl).toBe(false);
  });

  it("never claims a click as a conversion", () => {
    // We cannot see clicks and will not rewrite somebody's link to count them.
    for (const definition of Object.values(CTA_DEFINITIONS)) {
      expect(definition.conversion).not.toMatch(/click/i);
    }
  });
});

describe("effectiveCta", () => {
  const own = { kind: "meeting" as const, label: "a quick call", url: null };
  const linked = { kind: "link" as const, label: "the teardown", url: "https://acme.test/t" };

  it("lets the library win, which is the whole reason it exists", () => {
    // Correcting a URL in one place has to change every campaign using it,
    // without rewriting a message or re-reviewing approved copy.
    const cta = effectiveCta(linked, own);
    expect(cta.kind).toBe("link");
    expect(cta.url).toBe("https://acme.test/t");
    expect(cta.fromLibrary).toBe(true);
  });

  it("falls back to the campaign's own columns when there is no link", () => {
    // What a campaign built before the library carries, and what one whose CTA
    // was deleted falls back to — `cta_id` is `set null` on delete, because
    // losing a destination must never take the campaign with it.
    const cta = effectiveCta(null, own);
    expect(cta.kind).toBe("meeting");
    expect(cta.label).toBe("a quick call");
    expect(cta.fromLibrary).toBe(false);
  });

  it("does not let an incomplete library row win by existing", () => {
    // A row with no kind is not a usable answer. Taking it anyway would leave
    // a campaign with no goal at all, which decides its funnel's last stage.
    const cta = effectiveCta({ kind: null, label: null, url: "https://x.test" }, own);
    expect(cta.kind).toBe("meeting");
    expect(cta.url).toBeNull();
  });

  it("defaults to asking for a meeting when there is nothing either side", () => {
    // Every campaign built before CTAs existed was asking for a meeting.
    // Reading those as link campaigns would drop the meetings stage off their
    // funnel overnight — rule 29 in reverse.
    expect(effectiveCta(null, null).kind).toBe("meeting");
  });
});
