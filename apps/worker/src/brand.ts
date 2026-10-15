import { loadBusinessProfile, type Db } from "@le/db";
import { BusinessProfileSchema, type BusinessProfile } from "@le/shared";

/**
 * Who a writer is writing for, when an agent speaks for its own brand.
 *
 * A workspace keeps one business profile (rule 37) and runs several agents,
 * and an agent is often a different product: its own openers, its own offer
 * lines, its own documents. Handing every agent the workspace's profile meant
 * a reply on brand B's campaign introduced brand A — under a real rep's name,
 * to somebody who had only ever heard of B. The knowledge was already scoped
 * per agent (`knowledgeFor`); this is the same scoping for the description of
 * who is speaking.
 */
export interface AgentBrand {
  name: string | null;
  description: string | null;
}

/**
 * The business profile with an agent's brand laid over it. Pure.
 *
 * No description, no brand: the workspace's business is returned untouched,
 * which is how every agent behaved before this existed. A name alone is
 * ignored — brand B's name on brand A's offering is worse than either.
 *
 * With a brand, the workspace's *facts* are left out rather than carried over:
 * its pricing, proof points, differentiators, competitors and objections
 * belong to the workspace's product, and a writer handed them argues them for
 * the brand as confidently as if they were its own — rule 11's wrong price,
 * arriving through the profile instead of a document. The brand's facts come
 * from its own knowledge documents. The tone stays: that is how the company
 * writes, and the agent's own voice is layered on top of it.
 *
 * With no workspace profile at all, the brand alone is a profile, so an agent
 * that says what it sells can be written for before the workspace has.
 */
export function withBrand(business: BusinessProfile | null, brand: AgentBrand | null): BusinessProfile | null {
  const description = brand?.description?.trim();
  if (!description) return business;
  return {
    companyName: brand?.name?.trim() || business?.companyName || "",
    oneLiner: description,
    offering: description,
    pricingModel: "unknown",
    proofPoints: [],
    toneOfVoice: business?.toneOfVoice ?? "",
    competitors: [],
    commonObjections: [],
    differentiators: [],
  };
}

/**
 * An agent's brand, read inside its workspace and nowhere else: the worker
 * holds the service role, so an agent id from another company would otherwise
 * put that company's brand into this one's messages.
 */
export async function brandOf(db: Db, workspaceId: string, agentId: string | null): Promise<AgentBrand | null> {
  if (!agentId) return null;
  const { data } = await db
    .from("agents")
    .select("brand_name, brand_description")
    .eq("id", agentId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!data) return null;
  return { name: data.brand_name ?? null, description: data.brand_description ?? null };
}

/**
 * The business a writer is handed for one agent's work: the workspace's
 * profile (or the strategy's, when the caller knows it) with the agent's brand
 * overlaid. Null when there is neither.
 *
 * Strategies never go through this. They hang off the workspace's one business
 * profile, and a strategy is about who would buy, not about which brand's
 * voice the message arrives in.
 */
export async function businessFor(
  db: Db,
  workspaceId: string,
  agentId: string | null,
  businessProfileId?: string | null,
): Promise<BusinessProfile | null> {
  const [row, brand] = await Promise.all([
    loadBusinessProfile(db, workspaceId, businessProfileId),
    brandOf(db, workspaceId, agentId),
  ]);
  const parsed = BusinessProfileSchema.safeParse(row?.spec);
  return withBrand(parsed.success ? parsed.data : null, brand);
}
