import { cleanWebsiteText, runStrategyAgent } from "@le/agents";
import type { WorkerContext } from "../context.js";
import { recordEvent } from "../context.js";
import type { StrategyJob } from "../queues.js";

const PAGES_TO_READ = ["", "/about", "/pricing", "/customers", "/case-studies", "/product"];

/**
 * Agent 1 as a job. Reads the company's own pages, produces the Business
 * Profile and Customer Profiles, and stores them unapproved: a human confirms
 * before the Targeting Agent may act on them.
 */
export async function runStrategyJob(ctx: WorkerContext, job: StrategyJob): Promise<string> {
  const websiteText = job.websiteUrl ? await fetchSite(job.websiteUrl) : undefined;

  const output = await runStrategyAgent(ctx.agentsFor(job.workspaceId), {
    websiteUrl: job.websiteUrl,
    linkedinCompanyUrl: job.linkedinCompanyUrl,
    description: job.description,
    websiteText,
    existingCustomers: job.existingCustomers,
  });

  const { data: businessProfile, error } = await ctx.db
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
  if (error || !businessProfile) throw new Error(`could not store business profile: ${error?.message}`);

  await ctx.db.from("customer_profiles").insert(
    output.customerProfiles.map((profile) => ({
      workspace_id: job.workspaceId,
      business_profile_id: businessProfile.id,
      name: profile.name,
      spec: profile as never,
      priority: profile.priority,
    })),
  );

  await recordEvent(ctx.db, {
    workspaceId: job.workspaceId,
    name: "strategy.profile.created",
    actorUserId: job.userId,
    subjectType: "business_profile",
    subjectId: businessProfile.id,
    payload: { profiles: output.customerProfiles.length },
  });

  return businessProfile.id;
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
