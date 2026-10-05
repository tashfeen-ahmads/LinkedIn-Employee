import { cleanWebsiteText, runStrategyAgent } from "@le/agents";
import { loadBusinessProfile } from "@le/db";
import type { WorkerContext } from "../context.js";
import { recordEvent } from "../context.js";
import { seedWorkspaceAgent } from "./seed-agent.js";
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
  });

  let businessProfileId: string;

  if (existing) {
    businessProfileId = existing.id;
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
  const taken = new Set((existing?.profiles ?? []).map((p) => p.name.trim().toLowerCase()));
  const fresh = output.customerProfiles.filter((p) => !taken.has(p.name.trim().toLowerCase()));

  if (fresh.length) {
    // Priorities continue from the end of the list rather than restarting at
    // 1, or four new strategies would each claim to be the one to pursue first.
    const after = existing?.highestPriority ?? 0;
    await ctx.db.from("customer_profiles").insert(
      fresh.map((profile, i) => ({
        workspace_id: job.workspaceId,
        business_profile_id: businessProfileId,
        name: profile.name,
        spec: profile as never,
        priority: existing ? after + i + 1 : profile.priority,
      })),
    );
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
  const { data: owner } = await ctx.db
    .from("profiles")
    .select("full_name, bio")
    .eq("id", job.userId)
    .maybeSingle();
  await seedWorkspaceAgent(ctx.db, {
    workspaceId: job.workspaceId,
    userId: job.userId,
    business: output.businessProfile,
    repName: owner?.full_name ?? null,
    repBio: owner?.bio ?? null,
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
  profiles: { name: string }[];
  highestPriority: number;
} | null> {
  const business = await loadBusinessProfile(ctx.db, workspaceId, businessProfileId);
  if (!business) return null;

  const { data: profiles } = await ctx.db
    .from("customer_profiles")
    .select("name, priority")
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
    profiles: (profiles ?? []).map((p) => ({ name: p.name })),
    highestPriority: Math.max(0, ...(profiles ?? []).map((p) => p.priority ?? 0)),
  };
}

/** Best-effort read of the pages that actually describe a business. */
async function fetchSite(baseUrl: string): Promise<string | undefined> {
  const origin = normalizeOrigin(baseUrl);
  if (!origin) return undefined;

  const pages = await Promise.all(
    PAGES_TO_READ.map(async (path) => {
      try {
        const res = await fetch(`${origin}${path}`, {
          redirect: "follow",
          signal: AbortSignal.timeout(10_000),
          headers: { "user-agent": "LinkedInEmployee/1.0 (+strategy-agent)" },
        });
        if (!res.ok) return "";
        const html = await res.text();
        return `\n\n--- ${path || "/"} ---\n${cleanWebsiteText(html, 6_000)}`;
      } catch {
        return "";
      }
    }),
  );

  const combined = pages.filter(Boolean).join("");
  return combined.length > 200 ? combined : undefined;
}

function normalizeOrigin(input: string): string | null {
  try {
    const url = new URL(input.startsWith("http") ? input : `https://${input}`);
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}
