import { cleanWebsiteText, runStrategyAgent } from "@le/agents";
import { welcomeEmail } from "@le/email";
import type { WorkerContext } from "../context.js";
import { recordEvent } from "../context.js";
import { seedWorkspaceAgent } from "./seed-agent.js";
import { trySend } from "../email.js";
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
  // Sent first, not last: it says the agent is reading their site right now,
  // and it is. Waiting until the profiles exist would make it a lie by a
  // minute — and if the agent fails, the one email explaining what is
  // happening is exactly the one that should already have arrived.
  if (!job.expand) await sendWelcome(ctx, job);

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
  const existing = job.expand ? await readExistingStrategies(ctx, job.workspaceId) : null;
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
  const { data: owner } = await ctx.db
    .from("profiles")
    .select("full_name")
    .eq("id", job.userId)
    .maybeSingle();
  await seedWorkspaceAgent(ctx.db, {
    workspaceId: job.workspaceId,
    userId: job.userId,
    business: output.businessProfile,
    repName: owner?.full_name ?? null,
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

/** The business profile to add to, and the strategies already hanging off it. */
async function readExistingStrategies(
  ctx: WorkerContext,
  workspaceId: string,
): Promise<{
  id: string;
  spec: unknown;
  profiles: { name: string }[];
  highestPriority: number;
} | null> {
  const { data: business } = await ctx.db
    .from("business_profiles")
    .select("id, spec")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!business) return null;

  const { data: profiles } = await ctx.db
    .from("customer_profiles")
    .select("name, priority")
    .eq("workspace_id", workspaceId);

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

/**
 * The welcome email, once per workspace ever.
 *
 * The strategy job can be re-run from the dashboard when the first attempt
 * produced profiles nobody liked, and a second "welcome" on day nine reads as a
 * product that has forgotten who you are. The event is the record.
 */
async function sendWelcome(ctx: WorkerContext, job: StrategyJob): Promise<void> {
  if (!ctx.email) return;

  const { data: already } = await ctx.db
    .from("events")
    .select("id")
    .eq("workspace_id", job.workspaceId)
    .eq("name", WELCOMED_EVENT)
    .limit(1)
    .maybeSingle();
  if (already) return;

  const [{ data: workspace }, { data: profile }] = await Promise.all([
    ctx.db.from("workspaces").select("name").eq("id", job.workspaceId).maybeSingle(),
    ctx.db.from("profiles").select("email, full_name").eq("id", job.userId).maybeSingle(),
  ]);
  if (!profile?.email) return;

  const ok = await trySend(
    ctx.email,
    welcomeEmail({
      to: profile.email,
      repName: profile.full_name,
      appUrl: ctx.env.APP_URL,
      companyName: workspace?.name ?? "your company",
    }),
  );
  if (!ok) return;

  await recordEvent(ctx.db, {
    workspaceId: job.workspaceId,
    name: WELCOMED_EVENT,
    actorUserId: job.userId,
    subjectType: "workspace",
    subjectId: job.workspaceId,
  });
}

const WELCOMED_EVENT = "onboarding.welcomed";

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
