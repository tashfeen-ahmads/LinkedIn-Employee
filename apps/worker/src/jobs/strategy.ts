import { cleanWebsiteText, runStrategyAgent, writeHooks, writePitch } from "@le/agents";
import { loadBusinessProfile } from "@le/db";
import { MAX_STRATEGY_PRIORITY } from "@le/shared";
import type { WorkerContext } from "../context.js";
import { recordEvent } from "../context.js";
import { seedWorkspaceAgent } from "./seed-agent.js";
import { fetchVetted } from "../vetted-fetch.js";
import type { StrategyJob } from "../queues.js";

const PAGES_TO_READ = ["", "/about", "/pricing", "/customers", "/case-studies", "/product"];

/**
 * Agent 1 as a job. Reads the company's own pages, produces the Business
 * Profile and Customer Profiles, and stores them unapproved: a human confirms
 * before the Targeting Agent may act on them.
 */
export async function runStrategyJob(ctx: WorkerContext, job: StrategyJob): Promise<string> {
  try {
    return await strategy(ctx, job);
  } catch (err) {
    // The one agent whose failure is completely invisible. Its only output is
    // the business profile, and the dashboard reads the absence of that row as
    // "this person has not finished onboarding" -- so a failed run shows up as
    // a checklist asking them to do again the thing that just broke, forever,
    // with nothing anywhere naming a reason.
    const reason = (err as { message?: string })?.message ?? "unknown";
    console.error("strategy failed", { workspaceId: job.workspaceId, reason });
    await recordEvent(ctx.db, {
      workspaceId: job.workspaceId,
      name: "strategy.failed",
      actorUserId: job.userId,
      subjectType: "workspace",
      subjectId: job.workspaceId,
      payload: { reason },
    });
    throw err;
  }
}

async function strategy(ctx: WorkerContext, job: StrategyJob): Promise<string> {
  // The welcome used to be sent from here, once per workspace. It now goes
  // the moment somebody signs up — before any workspace exists — from
  // `sendAccountEmails` in lifecycle.ts, claimed once per person in
  // `email_sends`. One welcome path, so a re-run strategy can never be a
  // second welcome.

  /*
   * Adding to a workspace, rather than starting one.
   *
   * A first run writes three to five strategies: enough to read and approve in
   * one sitting, and nowhere near enough to run a business on — a company
   * works fifteen or twenty segments. So the same agent is asked for more,
   * handed the names it has already produced so it does not rewrite them with
   * different nouns, and writes into the business profile that already exists.
   *
   * Creating a second business profile instead is what this used to do, and it
   * is worse than it sounds: the profile is the thing every strategy hangs
   * off, so a workspace ended up with two of them and a strategy list split
   * across both.
   */
  const existing = job.expand
    ? await readExistingStrategies(ctx, job.workspaceId, job.businessProfileId)
    : null;
  if (job.expand && !existing) {
    throw new Error("nothing to add to: this workspace has no business profile yet");
  }

  const websiteText = job.websiteUrl ? await fetchSite(job.websiteUrl) : undefined;

  const output = await runStrategyAgent(ctx.agentsFor(job.workspaceId), {
    websiteUrl: job.websiteUrl,
    linkedinCompanyUrl: job.linkedinCompanyUrl,
    description:
      job.description ??
      // What this company is, for a run that was given nothing but "more
      // please".
      (existing ? JSON.stringify(existing.spec) : undefined),
    websiteText,
    existingCustomers: job.existingCustomers,
    existingProfiles: existing?.profiles.map((p) => ({ name: p.name })),
    want: 4,
    guidance: job.guidance,
  });

  // A run that came back empty is a failed run, not a business. Given nothing
  // it could read, the model answers with every field "" — and stored, that is
  // a business profile somebody's whole setup hangs off and a strategy with no
  // name that a person can approve. Thrown here, before anything is written,
  // so the screen shows the failure and the form asking for what is needed.
  const blank = blankStrategyOutput(output, { expanding: Boolean(existing) });
  if (blank) throw new Error(blank);

  let businessProfileId: string;

  if (existing) {
    businessProfileId = existing.id;
    // A business profile stored blank by an earlier run (before the check
    // above existed) is replaced by the first run that could describe the
    // company. Never a profile with anything in it: that is somebody's
    // reviewed description, and an expanding run is not asked to rewrite it.
    if (isBlankBusiness(existing.spec) && !isBlankBusiness(output.businessProfile)) {
      await ctx.db
        .from("business_profiles")
        .update({ spec: output.businessProfile as never })
        .eq("id", existing.id)
        .eq("workspace_id", job.workspaceId);
    }
  } else {
    const { data: created, error } = await ctx.db
      .from("business_profiles")
      .insert({
        workspace_id: job.workspaceId,
        website_url: job.websiteUrl ?? null,
        linkedin_company_url: job.linkedinCompanyUrl ?? null,
        spec: output.businessProfile as never,
        created_by: job.userId,
      })
      .select("id")
      .single();
    if (error || !created) throw new Error(`could not store business profile: ${error?.message}`);
    businessProfileId = created.id;
  }

  // Anything the agent produced that names a strategy already here is dropped
  // rather than stored. Two strategies covering the same people put one person
  // on two lists, and the never-twice rule then means the second list finds
  // nobody — a strategy that can only ever report zero.
  //
  // "Already here" includes earlier in this same response. A model asked for
  // four will sometimes write one of them twice with different capitals or a
  // trailing space, and two rows called "Chamber leaders" are the same two
  // lists over the same people as a repeat of an existing name.
  const taken = new Set((existing?.profiles ?? []).map((p) => p.name.trim().toLowerCase()));
  const fresh = output.customerProfiles.filter((p) => claimName(taken, p.name));

  if (fresh.length) {
    // Priorities continue from the end of the list rather than restarting at
    // 1, or four new strategies would each claim to be the one to pursue first.
    const after = existing?.highestPriority ?? 0;
    const rows = fresh.map((profile, i) => ({
      workspace_id: job.workspaceId,
      business_profile_id: businessProfileId,
      name: profile.name,
      priority: Math.min(MAX_STRATEGY_PRIORITY, existing ? after + i + 1 : profile.priority),
    }));
    const { error: insertError } = await ctx.db.from("customer_profiles").insert(
      rows.map((row, i) => ({
        ...row,
        // The spec carries the same number as the column. The edit form reads
        // the column and validates the spec, and two numbers for one strategy
        // is a strategy whose own edit form refuses to save it.
        spec: { ...fresh[i]!, priority: row.priority } as never,
      })),
    );
    if (insertError) {
      /*
       * Thrown, never recorded as success. A run that reported four strategies
       * stored while the database refused them leaves a workspace with a
       * business profile and nothing under it — and an onboarding checklist
       * that reads "strategies written" over an empty list.
       *
       * A business profile this run created is removed again first, because
       * the retry would otherwise create a second one beside it: the split
       * list rule 37 exists to prevent.
       */
      if (!existing) {
        await ctx.db
          .from("business_profiles")
          .delete()
          .eq("id", businessProfileId)
          .eq("workspace_id", job.workspaceId);
      }
      throw new Error(`could not store the strategies: ${insertError.message}`);
    }

    // The owner said the earlier suggestions were wrong, so they are set
    // aside now that something replaces them. Only unapproved ones with no
    // campaign: an approved strategy is somebody's decision, and one with a
    // campaign is the record of who was contacted (rule 26).
    if (job.guidance && existing) {
      const rejected = existing.profiles.map((p) => p.id);
      if (rejected.length) {
        const { data: used } = await ctx.db
          .from("campaigns")
          .select("customer_profile_id")
          .eq("workspace_id", job.workspaceId)
          .in("customer_profile_id", rejected);
        const keep = new Set((used ?? []).map((c) => c.customer_profile_id));
        const aside = rejected.filter((id) => !keep.has(id));
        if (aside.length) {
          await ctx.db
            .from("customer_profiles")
            .update({ do_not_pursue: true })
            .eq("workspace_id", job.workspaceId)
            .is("approved_at", null)
            .in("id", aside);
        }
      }
    }
  }

  /*
   * The workspace's one agent, from what this run just learned.
   *
   * Here rather than on a button, because this is the moment the product
   * knows what the company does, who it sells to and how it sounds — and a
   * rep who has just said all that should not be handed a blank form and
   * asked to say it again.
   *
   * Idempotent and never fatal: a workspace that already has one is left
   * alone, and a failure to seed loses a convenience rather than the run.
   */
  // The bio as well as the name, off the same row. Onboarding collects it and
  // promises it is the voice invitations are written in; selecting only the
  // name is how that promise was kept for replies and broken for invitations.
  //
  // Never from a blank business: an agent, offer and opener written about a
  // company with no name or offering are copy about nobody, and seeded once
  // they are what the launch step asks somebody to approve.
  const seedFrom = isBlankBusiness(output.businessProfile) ? null : output.businessProfile;
  const { data: owner } = seedFrom
    ? await ctx.db.from("profiles").select("full_name, bio").eq("id", job.userId).maybeSingle()
    : { data: null };
  if (seedFrom) await seedWorkspaceAgent(ctx.db, {
    workspaceId: job.workspaceId,
    userId: job.userId,
    business: output.businessProfile,
    repName: owner?.full_name ?? null,
    repBio: owner?.bio ?? null,
    writeOffer: async () => {
      const set = await writePitch(ctx.agentsFor(job.workspaceId), {
        business: output.businessProfile,
        knowledge: [],
        repName: owner?.full_name ?? undefined,
      });
      return set.variants[0]?.body ?? null;
    },
    writeOpener: async () => {
      const set = await writeHooks(ctx.agentsFor(job.workspaceId), {
        business: output.businessProfile,
        profiles: output.customerProfiles.slice(0, 3),
        repName: owner?.full_name ?? undefined,
      });
      return set.variants[0]?.body ?? null;
    },
  });

  await recordEvent(ctx.db, {
    workspaceId: job.workspaceId,
    name: "strategy.profile.created",
    actorUserId: job.userId,
    subjectType: "business_profile",
    subjectId: businessProfileId,
    // Both numbers, because "asked for four and stored one" is a different
    // thing to look into from "asked for four and stored four".
    payload: {
      profiles: fresh.length,
      duplicatesDropped: output.customerProfiles.length - fresh.length,
      expanded: Boolean(job.expand),
    },
  });

  return businessProfileId;
}

/**
 * The business profile to add to, and the strategies already hanging off **it**.
 *
 * Both halves are scoped to one business, and both used not to be. The profile
 * was always the workspace's oldest row and the strategies were every strategy
 * in the workspace, which for a workspace running two businesses meant three
 * wrong answers at once: new segments filed under the first business whatever
 * the rep picked, a name the *other* business already used dropped as a
 * duplicate — so a real segment could only ever report zero — and priorities
 * numbered across both lists, so "pursue this first" meant nothing in either.
 *
 * `loadBusinessProfile` is what resolves the id, because it scopes by
 * workspace as well: the id arrives on a request, and the worker holds the
 * service role.
 */
async function readExistingStrategies(
  ctx: WorkerContext,
  workspaceId: string,
  businessProfileId?: string,
): Promise<{
  id: string;
  spec: unknown;
  profiles: { id: string; name: string }[];
  highestPriority: number;
} | null> {
  const business = await loadBusinessProfile(ctx.db, workspaceId, businessProfileId);
  if (!business) return null;

  const { data: profiles } = await ctx.db
    .from("customer_profiles")
    .select("id, name, priority")
    .eq("workspace_id", workspaceId)
    // This business's own. Unscoped, a workspace's second business inherits the
    // first's duplicate list and its priority numbering.
    .eq("business_profile_id", business.id);

  return {
    id: business.id,
    // The company's own profile, handed back as the material for the new
    // strategies. Without it an expanding run has only a list of names to work
    // from and writes segments for a company it can no longer describe.
    spec: business.spec,
    profiles: (profiles ?? []).map((p) => ({ id: p.id as string, name: p.name })),
    highestPriority: Math.max(0, ...(profiles ?? []).map((p) => p.priority ?? 0)),
  };
}

/** What the screen says when Sage had nothing it could write from. */
export const STRATEGY_NOTHING_TO_READ =
  "Sage could not find enough about your business to write from. Add your website, or a few sentences on what you sell and who buys it, then run Sage again. A LinkedIn page alone cannot be read.";

function blankText(value: unknown): boolean {
  return typeof value !== "string" || value.trim() === "";
}

/** A business profile with no name or no offering describes nobody. */
export function isBlankBusiness(spec: unknown): boolean {
  if (!spec || typeof spec !== "object") return true;
  const business = spec as { companyName?: unknown; offering?: unknown };
  return blankText(business.companyName) || blankText(business.offering);
}

/**
 * Why a Strategy Agent answer cannot be stored, or null when it can.
 *
 * A first run must describe the business, because everything else hangs off
 * that row. An expanding run already has one, so only its strategies are
 * checked — and any one without a name fails the run rather than being
 * quietly dropped, because a model that wrote a nameless strategy wrote it
 * from nothing.
 */
export function blankStrategyOutput(
  output: { businessProfile: unknown; customerProfiles: Array<{ name?: unknown }> },
  options: { expanding: boolean },
): string | null {
  if (!options.expanding && isBlankBusiness(output.businessProfile)) return STRATEGY_NOTHING_TO_READ;
  // A first run with nothing under its business is a profile with no way
  // forward. An expanding run that found nothing new is an answer, and the
  // strategies already here stay as they were.
  if (!options.expanding && !output.customerProfiles.length) return STRATEGY_NOTHING_TO_READ;
  if (output.customerProfiles.some((p) => blankText(p.name))) return STRATEGY_NOTHING_TO_READ;
  return null;
}

/**
 * True the first time a name is seen, and false for every repeat of it.
 *
 * Compared trimmed and case-folded, because "Chamber leaders" and
 * "chamber leaders " are one segment written twice.
 */
function claimName(taken: Set<string>, name: string): boolean {
  const key = (name ?? "").trim().toLowerCase();
  // A strategy with no name is not a duplicate of another nameless one, it is
  // not a strategy: nothing on any screen can say what it is, and a person
  // could approve it. Never stored.
  if (!key) return false;
  if (taken.has(key)) return false;
  taken.add(key);
  return true;
}

/**
 * Best-effort read of the pages that actually describe a business.
 *
 * The address is typed by whoever signs up, and the worker fetches it — which
 * is server-side request forgery unless it is stopped (rule 19). The worker
 * holds the service-role key and answers its own internal API on localhost, so
 * "website: 127.0.0.1:4000" or a metadata address is not a broken website, it
 * is a request made with our credentials to something no browser could reach,
 * with the answer handed to a model and stored on a profile the customer
 * reads. So every page goes through `fetchVetted`, the same GET the calendar
 * feeds use: https only, DNS resolved and vetted, every redirect re-checked.
 */
async function fetchSite(baseUrl: string): Promise<string | undefined> {
  const urls = pagesToRead(baseUrl);
  if (!urls.length) return undefined;

  const pages = await Promise.all(
    urls.map(async (url, i) => {
      try {
        const fetched = await fetchVetted(url, {
          timeoutMs: 10_000,
          headers: { "user-agent": "LinkedInEmployee/1.0 (+strategy-agent)" },
        });
        if (!fetched.ok || !fetched.response.ok) return "";
        const html = await fetched.response.text();
        // The page the customer named gets the larger share: it is the one
        // they chose to describe themselves with.
        return `\n\n--- ${new URL(url).pathname} ---\n${cleanWebsiteText(html, i === 0 ? 10_000 : 6_000)}`;
      } catch {
        return "";
      }
    }),
  );

  const combined = pages.filter(Boolean).join("");
  return combined.length > 200 ? combined : undefined;
}

/**
 * Every address to read, the one the customer typed first.
 *
 * Only the origin used to be kept, so `example.com/our-clinic` was read as
 * `example.com` — a different business whenever the path was the business: a
 * page on a shared host, a brand under a group's domain, a product's own
 * landing page. The exact page comes first, then the origin's usual pages for
 * whatever it does not say. Each one still goes through `fetchVetted`.
 *
 * Always https: a plain `http://` address is upgraded rather than refused,
 * because nearly every company site answers on https and the vetted fetch will
 * not travel in the clear. The fragment is dropped, since it never reaches a
 * server.
 */
export function pagesToRead(input: string): string[] {
  let url: URL;
  try {
    const trimmed = input.trim();
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return [];
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return [];
  const origin = `https://${url.host}`;
  const exact = `${origin}${url.pathname}${url.search}`;

  const seen = new Set<string>();
  const out: string[] = [];
  for (const candidate of [exact, ...PAGES_TO_READ.map((path) => `${origin}${path || "/"}`)]) {
    // `/about` and `/about/` are one page.
    const key = candidate.replace(/\/+$/, "").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(candidate);
  }
  return out;
}
