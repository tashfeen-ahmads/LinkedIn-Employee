import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/workspace";
import { createClient } from "@/lib/supabase-server";
import { callWorker, errorQuery, noticeQuery, startedNotice } from "@/lib/worker";
import { PageNotice, type NoticeParams } from "@/components/page-notice";
import { SubmitButton } from "@/components/submit-button";
import { ConfirmButton } from "@/components/confirm-button";
import { Section } from "@/components/page";
import { hasStrategySource, mergeStash, readOnboardingStash } from "@/lib/onboarding-stash";
import { BUSINESS_DESCRIPTION_MAX, COMPANY_NAME_MAX, readBusinessForm } from "@/lib/profile-business";
import { PROFILE_SECTIONS } from "../sections";

const HERE = PROFILE_SECTIONS.company;

/**
 * The company: what onboarding asked first, and what Sage made of it.
 *
 * The business is the workspace's, so it is an owner's or admin's to change;
 * everybody else reads it. Sage reads the website, LinkedIn page and
 * description when it writes strategies, so those are the fields here — and
 * what Sage wrote back from them is shown underneath, because "what does Nora
 * think we sell" is the question somebody opening this section usually has.
 */
async function saveCompany(formData: FormData) {
  "use server";
  const session = await requireSession();
  if (!["owner", "admin"].includes(session.role)) {
    redirect(errorQuery(HERE, "Only an owner or admin can change the company details."));
  }
  const supabase = await createClient();

  /* ---- the business: what onboarding asked first, editable here ---- */
  const business = readBusinessForm(formData);
  if (!business.ok) redirect(errorQuery(HERE, business.reason));

  const { data: renamed } = await supabase
    .from("workspaces")
    .update({ name: business.companyName })
    .eq("id", session.workspaceId)
    .select("onboarding");
  if (!renamed?.length) redirect(errorQuery(HERE, "Your company details could not be saved."));

  // What Sage reads next time, kept where onboarding kept it. Replaced as a
  // whole rather than merged field by field: a website from the old answer
  // beside a description of the new one describes two businesses.
  await supabase
    .from("workspaces")
    .update({
      onboarding: mergeStash(renamed[0]?.onboarding, {
        source: {
          ...(business.websiteUrl ? { websiteUrl: business.websiteUrl } : {}),
          ...(business.linkedinCompanyUrl ? { linkedinCompanyUrl: business.linkedinCompanyUrl } : {}),
          ...(business.description ? { description: business.description } : {}),
        },
      }) as never,
    })
    .eq("id", session.workspaceId);

  // The name every agent writes under. A workspace with one business profile
  // is a workspace whose company is that profile, so a corrected spelling
  // reaches the agents too; with several, each keeps its own name and is
  // edited on the Strategy page.
  const { data: businesses } = await supabase
    .from("business_profiles")
    .select("id, spec")
    .eq("workspace_id", session.workspaceId);
  if (businesses?.length === 1) {
    const only = businesses[0]!;
    const spec = (only.spec && typeof only.spec === "object" ? only.spec : {}) as Record<string, unknown>;
    await supabase
      .from("business_profiles")
      .update({ spec: { ...spec, companyName: business.companyName } as never })
      .eq("id", only.id)
      .eq("workspace_id", session.workspaceId);
  }

  revalidatePath("/app/profile", "layout");
  redirect(noticeQuery(HERE, "Saved. Sage reads these details the next time it writes strategies."));
}

/**
 * Sage reads the business again, from the details saved here.
 *
 * For somebody who set up the wrong company — a website typed for a client, a
 * name from a previous job. Only while no campaign exists: a campaign was built
 * from these strategies and copy a person read, and replacing them under it
 * would leave a list nobody's strategy explains. With campaigns, the corrected
 * business is added beside it on the Strategy page instead.
 */
async function rebuildBusiness() {
  "use server";
  const session = await requireSession();
  if (!["owner", "admin"].includes(session.role)) {
    redirect(errorQuery(HERE, "Only an owner or admin can rebuild the business profile."));
  }
  const supabase = await createClient();
  const [{ count: campaigns }, { data: ws }] = await Promise.all([
    supabase.from("campaigns").select("id", { count: "exact", head: true }).eq("workspace_id", session.workspaceId),
    supabase.from("workspaces").select("onboarding").eq("id", session.workspaceId).maybeSingle(),
  ]);
  if (campaigns) {
    redirect(
      errorQuery(
        HERE,
        "Your campaigns were built from the current business profile, so it cannot be replaced here. Add the corrected business on the Strategy page instead.",
      ),
    );
  }
  const source = readOnboardingStash(ws?.onboarding).source;
  if (!hasStrategySource(source)) {
    redirect(
      errorQuery(
        HERE,
        "Add your website or a few sentences on what you sell first. A LinkedIn page alone cannot be read, and Sage will not invent a business from nothing.",
      ),
    );
  }

  // Strategies hang off the business profile and go with it.
  const { error } = await supabase.from("business_profiles").delete().eq("workspace_id", session.workspaceId);
  if (error) redirect(errorQuery(HERE, "Your old business profile could not be cleared. Please try again."));

  const queued = await callWorker("/jobs/strategy", {
    workspaceId: session.workspaceId,
    userId: session.userId,
    ...source,
  });
  if (!queued.ok) redirect(errorQuery("/app/strategy", `Sage could not be started: ${queued.error}`));
  revalidatePath("/app/profile", "layout");
  redirect(
    noticeQuery(
      "/app/strategy",
      startedNotice(
        queued.data,
        "Sage is reading your business again. New strategies appear on this page in a few minutes, unapproved. Nothing is searched for until you approve one.",
      ),
    ),
  );
}

interface BusinessSpec {
  companyName?: string;
  oneLiner?: string;
  offering?: string;
  pricingModel?: string;
  toneOfVoice?: string;
  competitors?: string[];
}

export default async function CompanyPage({ searchParams }: { searchParams: NoticeParams }) {
  const params = await searchParams;
  const session = await requireSession();
  const supabase = await createClient();

  const [{ data: ws }, { data: businesses }, { count: campaignCount }, { data: brands }] = await Promise.all([
    supabase.from("workspaces").select("name, onboarding").eq("id", session.workspaceId).maybeSingle(),
    supabase.from("business_profiles").select("id, spec").eq("workspace_id", session.workspaceId),
    supabase.from("campaigns").select("id", { count: "exact", head: true }).eq("workspace_id", session.workspaceId),
    supabase
      .from("agents")
      .select("id, name, brand_name")
      .eq("workspace_id", session.workspaceId)
      .is("archived_at", null)
      .not("brand_name", "is", null),
  ]);

  const canEdit = ["owner", "admin"].includes(session.role);
  const companyName = ws?.name ?? session.workspaceName;
  const source = readOnboardingStash(ws?.onboarding).source;
  // Rebuilding replaces the strategies, so it is offered only before any
  // campaign was built from them.
  const canRebuild = canEdit && !campaignCount && hasStrategySource(source);
  const spec = (businesses?.length ? businesses[0]!.spec : null) as BusinessSpec | null;
  const branded = (brands ?? []).filter((agent) => (agent.brand_name ?? "").trim());

  return (
    <>
      <PageNotice error={params.error} notice={params.notice} />

      <Section
        id="business"
        title="Company"
        description="What you told us during setup. Sage reads the website, LinkedIn page and description when it writes your strategies."
      >
        {canEdit ? (
          <form action={saveCompany} className="card profile-card profile-form">
            <div className="profile-fields">
              <label className="field">
                <span>Company name</span>
                <input name="companyName" required maxLength={COMPANY_NAME_MAX} autoComplete="organization" defaultValue={companyName} />
              </label>
              <div className="profile-field-pair">
                <label className="field">
                  <span>Website</span>
                  <input
                    name="websiteUrl"
                    type="url"
                    autoComplete="url"
                    spellCheck={false}
                    placeholder="https://acme.com"
                    defaultValue={source.websiteUrl ?? ""}
                  />
                </label>
                <label className="field">
                  <span>LinkedIn company page</span>
                  <input
                    name="linkedinCompanyUrl"
                    type="url"
                    autoComplete="url"
                    spellCheck={false}
                    placeholder="https://linkedin.com/company/acme"
                    defaultValue={source.linkedinCompanyUrl ?? ""}
                  />
                </label>
              </div>
              <label className="field">
                <span>About the business</span>
                <textarea
                  name="description"
                  rows={4}
                  maxLength={BUSINESS_DESCRIPTION_MAX}
                  defaultValue={source.description ?? ""}
                  placeholder="Who you sell to, what you charge, what makes you different…"
                />
              </label>
            </div>
            <div className="profile-form-foot">
              <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
            </div>
          </form>
        ) : (
          <div className="card profile-card">
            <dl className="profile-facts">
              <div>
                <dt>Company name</dt>
                <dd>{companyName}</dd>
              </div>
              <div>
                <dt>Website</dt>
                <dd>{source.websiteUrl || <span className="subtle">Not set</span>}</dd>
              </div>
              <div>
                <dt>LinkedIn company page</dt>
                <dd>{source.linkedinCompanyUrl || <span className="subtle">Not set</span>}</dd>
              </div>
              <div className="is-wide">
                <dt>About the business</dt>
                <dd>{source.description || <span className="subtle">Not set</span>}</dd>
              </div>
            </dl>
            <p className="small muted">An owner or admin of this workspace can change these.</p>
          </div>
        )}
      </Section>

      <Section
        id="business-profile"
        title="What Nora knows about you"
        description="What Sage wrote from the details above. Every agent writes from this."
        action={
          <Link className="btn secondary small" href="/app/strategy">
            Open strategies
          </Link>
        }
      >
        <div className="card profile-card">
          {spec ? (
            <dl className="profile-facts">
              {spec.oneLiner ? (
                <div className="is-wide">
                  <dt>In one line</dt>
                  <dd>{spec.oneLiner}</dd>
                </div>
              ) : null}
              {spec.offering ? (
                <div className="is-wide">
                  <dt>What you sell</dt>
                  <dd>{spec.offering}</dd>
                </div>
              ) : null}
              {spec.pricingModel ? (
                <div>
                  <dt>How you charge</dt>
                  <dd>{spec.pricingModel}</dd>
                </div>
              ) : null}
              {spec.toneOfVoice ? (
                <div>
                  <dt>Tone of voice</dt>
                  <dd>{spec.toneOfVoice}</dd>
                </div>
              ) : null}
              {spec.competitors?.length ? (
                <div className="is-wide">
                  <dt>Competitors</dt>
                  <dd>{spec.competitors.join(", ")}</dd>
                </div>
              ) : null}
            </dl>
          ) : (
            <p className="small muted">
              Nothing yet. Sage writes this a few minutes after setup, from your website or description.
            </p>
          )}
          {(businesses?.length ?? 0) > 1 ? (
            <p className="small muted">
              This workspace has {businesses!.length} business profiles. Each is edited on the Strategies page.
            </p>
          ) : null}
          {branded.length ? (
            <p className="small muted">
              Some agents write under a brand of their own:{" "}
              {branded.map((agent, index) => (
                <span key={agent.id}>
                  {index ? ", " : ""}
                  <Link href={`/app/agents/${agent.id}`}>{agent.brand_name}</Link>
                </span>
              ))}
              .
            </p>
          ) : (
            <p className="small muted">
              Selling more than one brand? An agent can write under a brand of its own, set on its{" "}
              <Link href="/app/agents">Agents</Link> page.
            </p>
          )}
          {canRebuild ? (
            <form action={rebuildBusiness} className="profile-form-foot">
              <p className="small muted">
                Changed the website or description? Sage can read your business again and write new strategies.
                Your current strategies are replaced. Nothing has been sent yet.
              </p>
              <ConfirmButton
                className="btn secondary"
                confirmLabel="Replace my business profile and strategies"
                pendingLabel="Starting…"
              >
                Rewrite my strategies
              </ConfirmButton>
            </form>
          ) : null}
        </div>
      </Section>
    </>
  );
}
