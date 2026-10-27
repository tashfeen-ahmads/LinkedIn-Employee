import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadNeedsYou } from "../src/lib/needs-you-data";
import { campaignCtas } from "../src/lib/campaign-cta";
import { readFunnelData } from "../src/lib/funnel-data";

/**
 * What the overview's "Needs you" list is read from, run against a database
 * that answers by table.
 *
 * Every row below was wrong on a live workspace: meeting campaigns told they
 * were asking people to click a link that was not set (they send the rep's
 * scheduling link or a booking page), a campaign pointed at a link entry still
 * counted as a meeting campaign, and notes that were template fallbacks, or on
 * an account whose free notes were spent, were raised or missed the wrong way
 * round.
 */

type Row = Record<string, unknown>;
type Call = { table: string; columns: string; filters: Array<[string, string, unknown]> };

/** A query builder that ignores nothing: each query is answered by `respond`. */
function fake(respond: (call: Call) => { data?: unknown; count?: number; error?: unknown }) {
  const calls: Call[] = [];
  const from = (table: string) => {
    const call: Call = { table, columns: "", filters: [] };
    const run = () => {
      calls.push(call);
      const out = respond(call);
      return { data: out.data ?? null, count: out.count ?? null, error: out.error ?? null };
    };
    const builder: Record<string, unknown> = {};
    const chain = (name: string) => (col: string, value?: unknown) => {
      call.filters.push([name, col, value]);
      return builder;
    };
    Object.assign(builder, {
      select(columns?: string) {
        call.columns = columns ?? "";
        return builder;
      },
      eq: chain("eq"),
      neq: chain("neq"),
      in: chain("in"),
      is: chain("is"),
      not: chain("not"),
      or: chain("or"),
      gte: chain("gte"),
      range: () => builder,
      order: () => builder,
      limit: () => builder,
      maybeSingle: () => Promise.resolve(run()),
      then: (resolve: (v: unknown) => unknown, reject?: (r: unknown) => unknown) =>
        Promise.resolve(run()).then(resolve, reject),
    });
    return builder;
  };
  return { client: { from } as never, calls };
}

const eq = (call: Call, col: string) => call.filters.find(([n, c]) => n === "eq" && c === col)?.[2];

const NOW = new Date("2026-10-26T15:00:00Z");

interface World {
  drafts?: Row[];
  running?: Row[];
  ctas?: Row[];
  steps?: Row[];
  thin?: Row[];
  campaigns?: Row[];
  accounts?: Row[];
  availability?: Row[];
  profiles?: Row[];
  /** Invitations this month per account, and how many went without a note. */
  invited?: Record<string, { all: number; noNote: number }>;
}

function world(w: World) {
  return fake((call) => {
    switch (call.table) {
      case "worker_heartbeats":
        return { data: { beat_at: NOW.toISOString(), detail: null } };
      case "linkedin_accounts":
        if (call.columns.includes("notes_exhausted_month")) return { data: w.accounts ?? [] };
        return { count: eq(call, "status") === "active" ? 1 : 0 };
      case "conversations":
        return { data: [] };
      case "pitches":
      case "hooks":
        return { count: 0 };
      case "customer_profiles":
        return { count: 1 };
      case "campaigns":
        if (eq(call, "status") === "draft") return { data: w.drafts ?? [] };
        if (eq(call, "status") === "running") return { data: w.running ?? [] };
        if (eq(call, "linkedin_account_id")) {
          return { data: (w.campaigns ?? []).filter((c) => c.linkedin_account_id === eq(call, "linkedin_account_id")) };
        }
        if (call.columns.includes("linkedin_account_id")) return { data: w.campaigns ?? [] };
        return { count: 1 };
      case "ctas":
        return { data: w.ctas ?? [] };
      case "campaign_steps":
        return { data: w.steps ?? [] };
      case "campaign_prospects": {
        if (!call.filters.some(([n, c]) => n === "gte" && c === "invited_at")) return { data: w.thin ?? [] };
        const ids = (call.filters.find(([n, c]) => n === "in" && c === "campaign_id")?.[2] ?? []) as string[];
        const account = (w.campaigns ?? []).find((c) => ids.includes(c.id as string))?.linkedin_account_id as string;
        const sent = w.invited?.[account] ?? { all: 0, noNote: 0 };
        return { count: eq(call, "invite_note_sent") === false ? sent.noNote : sent.all };
      }
      case "availability":
        return { data: w.availability ?? [] };
      case "profiles":
        return { data: w.profiles ?? [] };
      default:
        return { data: [] };
    }
  });
}

const draft = (id: string, cta: Row) => ({ id, cta_id: null, cta_kind: "meeting", cta_label: null, cta_url: null, ...cta });

describe("the link that is not set", () => {
  it("is never a meeting campaign: it sends the rep's link or a booking page", async () => {
    const { client } = world({
      drafts: [draft("c1", { cta_kind: "meeting" })],
      steps: [{ campaign_id: "c1", message: "Grab a time here: {{cta_link}}" }],
    });
    const { facts } = await loadNeedsYou(client, "w1", NOW);
    expect(facts.campaignsMissingCta).toBe(0);
  });

  it("is a link campaign with no destination whose copy asks for one", async () => {
    const { client } = world({
      drafts: [draft("c1", { cta_kind: "link", cta_url: null }), draft("c2", { cta_kind: "link", cta_url: null })],
      steps: [{ campaign_id: "c1", message: "Here it is: {{cta_link}}" }],
    });
    const { facts } = await loadNeedsYou(client, "w1", NOW);
    // c2 never uses the placeholder, so there is nothing missing from it.
    expect(facts.campaignsMissingCta).toBe(1);
  });

  it("reads the library entry a campaign points at over its own columns", async () => {
    const { client } = world({
      drafts: [draft("c1", { cta_kind: "meeting", cta_id: "k1" })],
      ctas: [{ id: "k1", kind: "link", label: null, url: null }],
      steps: [{ campaign_id: "c1", message: "Here: {{cta_link}}" }],
    });
    const { facts } = await loadNeedsYou(client, "w1", NOW);
    expect(facts.campaignsMissingCta).toBe(1);
  });
});

describe("meeting hours nobody chose", () => {
  it("counts only campaigns that actually ask for a meeting", async () => {
    const { client } = world({
      // The column still says meeting; the entry it points at is a link.
      running: [{ id: "c1", owner_user_id: "u1", cta_id: "k1", cta_kind: "meeting", cta_label: null, cta_url: null }],
      ctas: [{ id: "k1", kind: "link", label: null, url: "https://acme.test/x" }],
    });
    const { facts } = await loadNeedsYou(client, "w1", NOW);
    expect(facts.meetingHoursUnset).toBe(false);
  });

  it("still raises a real meeting campaign with no hours and no link", async () => {
    const { client } = world({
      running: [{ id: "c1", owner_user_id: "u1", cta_id: null, cta_kind: "meeting", cta_label: null, cta_url: null }],
    });
    const { facts } = await loadNeedsYou(client, "w1", NOW);
    expect(facts.meetingHoursUnset).toBe(true);
  });
});

describe("notes that are not personalised", () => {
  it("asks for template fallbacks as well as thin notes, never a note a person cleared", async () => {
    const { client, calls } = world({});
    await loadNeedsYou(client, "w1", NOW);
    const query = calls.find((c) => c.table === "campaign_prospects");
    const or = query?.filters.find(([name]) => name === "or")?.[1];
    expect(or).toBe("invite_note_thin.eq.true,and(invite_note.is.null,invite_note_edited.eq.false)");
  });

  it("does not call a draft sending, and leaves out accounts whose free notes are spent", async () => {
    const { client } = world({
      thin: [{ campaign_id: "draft1" }, { campaign_id: "run1" }, { campaign_id: "spent1" }],
      campaigns: [
        { id: "draft1", status: "draft", linkedin_account_id: "a1" },
        { id: "run1", status: "running", linkedin_account_id: "a1" },
        { id: "spent1", status: "running", linkedin_account_id: "a2" },
      ],
      accounts: [
        { id: "a1", user_id: "u1", has_premium: false, has_sales_navigator: false, notes_exhausted_month: "2026-09" },
        { id: "a2", user_id: "u2", has_premium: false, has_sales_navigator: false, notes_exhausted_month: "2026-10" },
      ],
      profiles: [
        { id: "u1", timezone: "America/New_York" },
        { id: "u2", timezone: "America/New_York" },
      ],
    });
    const { facts, items } = await loadNeedsYou(client, "w1", NOW);
    expect(facts.campaignsWithThinNotes).toBe(2);
    expect(facts.campaignsWithThinNotesDraft).toBe(1);
    const row = items.find((i) => i.kind === "thin_notes");
    expect(row?.title).toBe("2 campaigns have notes that are not personalised, 1 of them already sending.");
  });

  it("leaves out a free account that has already sent this month's notes", async () => {
    const { client } = world({
      thin: [{ campaign_id: "run1" }],
      campaigns: [{ id: "run1", status: "running", linkedin_account_id: "a1" }],
      accounts: [{ id: "a1", user_id: "u1", has_premium: false, has_sales_navigator: false, notes_exhausted_month: null }],
      profiles: [{ id: "u1", timezone: "America/New_York" }],
      invited: { a1: { all: 5, noNote: 2 } },
    });
    const { facts } = await loadNeedsYou(client, "w1", NOW);
    expect(facts.campaignsWithThinNotes).toBe(0);
  });
});

describe("campaignCtas", () => {
  it("resolves the pointer, falls back to the columns, and is scoped to the workspace", async () => {
    const { client, calls } = fake((call) =>
      call.table === "ctas" ? { data: [{ id: "k1", kind: "link", label: "Sign up", url: "https://a.test/s" }] } : {},
    );
    const map = await campaignCtas(client, "w1", [
      { id: "c1", cta_id: "k1", cta_kind: "meeting", cta_label: null, cta_url: null },
      { id: "c2", cta_id: null, cta_kind: "reply", cta_label: null, cta_url: null },
      { id: "c3", cta_id: "gone", cta_kind: "meeting", cta_label: null, cta_url: null },
    ]);
    expect(map.get("c1")).toMatchObject({ kind: "link", url: "https://a.test/s", fromLibrary: true });
    expect(map.get("c2")).toMatchObject({ kind: "reply", fromLibrary: false });
    expect(map.get("c3")).toMatchObject({ kind: "meeting", fromLibrary: false });
    expect(eq(calls[0]!, "workspace_id")).toBe("w1");
  });
});

describe("the funnel's goals", () => {
  it("are what each campaign sends toward, through its library entry", async () => {
    const { client } = fake((call) => {
      if (call.table === "campaigns") {
        return {
          data: [
            { id: "c1", name: "A", status: "running", owner_user_id: "u1", customer_profile_id: null, launched_at: null, cta_id: "k1", cta_kind: "meeting", cta_label: null, cta_url: null },
          ],
        };
      }
      if (call.table === "ctas") return { data: [{ id: "k1", kind: "link", label: null, url: "https://a.test/s" }] };
      return { data: [] };
    });
    const funnel = await readFunnelData(client, "w1");
    // A link campaign has no meetings stage, whatever its stale column says.
    expect(funnel.goals).toEqual(["link"]);
    expect(funnel.campaigns[0]?.cta_kind).toBe("link");
  });
});

const src = (...parts: string[]) => readFileSync(join(__dirname, "..", "src", ...parts), "utf8");

describe("every screen reads the goal a campaign actually has", () => {
  it("picking a saved call to action writes its goal onto the campaign too", () => {
    const page = src("app", "app", "campaigns", "[id]", "actions.ts");
    const action = page.slice(page.indexOf("async function setCampaignCta"), page.indexOf("async function setStatus"));
    // What a picked card means is one helper, shared with the builder's goal
    // step, and the action writes the patch it returns.
    const choice = src("app", "app", "campaigns", "[id]", "cta-choice.ts");
    expect(action).toMatch(/await ctaPatchFor\(supabase, session, formData\)/);
    expect(action).toMatch(/\.update\(patch\)/);
    expect(choice).toMatch(/patch = \{ cta_id: picked\.id, cta_kind: picked\.kind, cta_label: picked\.label, cta_url: picked\.url \}/);
    expect(action + choice).not.toMatch(/update\(\{ cta_id: ctaId \|\| null \}\)/);
    expect(src("app", "app", "campaigns", "new", "actions.ts")).toMatch(/await ctaPatchFor\(supabase, session, formData\)/);
  });

  it("the funnel, the inbox's meeting tab and the campaign page resolve through campaignCtas", () => {
    expect(src("lib", "funnel-data.ts")).toMatch(/campaignCtas\(supabase, workspaceId, raw\)/);
    expect(src("app", "app", "inbox", "page.tsx")).toMatch(/campaignCtas\(supabase, session\.workspaceId, goals \?\? \[\]\)/);
    expect(src("app", "app", "inbox", "page.tsx")).not.toMatch(/\.eq\("cta_kind", "meeting"\)/);
    expect(src("lib", "needs-you-data.ts")).not.toMatch(/\.eq\("cta_kind", "meeting"\)/);
    expect(src("app", "app", "campaigns", "[id]", "data.ts")).toMatch(/campaignCtas\(supabase, session\.workspaceId, \[campaign\]\)/);
  });
});
