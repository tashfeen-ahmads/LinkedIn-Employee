import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import { isAppConfigured } from "@/lib/config";
import { callWorker } from "@/lib/worker";

/**
 * First run. Creates the workspace and kicks off the Strategy Agent, so the
 * first screen a new user sees is their own Business Profile rather than an
 * empty dashboard.
 */
async function createWorkspace(formData: FormData) {
  "use server";
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const companyName = String(formData.get("companyName") ?? "").trim();
  const websiteUrl = String(formData.get("websiteUrl") ?? "").trim();
  const linkedinCompanyUrl = String(formData.get("linkedinCompanyUrl") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const fullName = String(formData.get("fullName") ?? "").trim();

  if (!companyName) redirect("/onboarding?error=Company+name+is+required");
  if (!websiteUrl && !linkedinCompanyUrl && !description) {
    redirect("/onboarding?error=Give+us+a+website%2C+a+LinkedIn+page%2C+or+a+description+to+work+from");
  }

  const slug = `${slugify(companyName)}-${Math.random().toString(36).slice(2, 7)}`;
  const trialEnds = new Date(Date.now() + 7 * 86_400_000).toISOString();

  const { data: workspace, error } = await supabase
    .from("workspaces")
    .insert({ name: companyName, slug, plan: "trial", trial_ends_at: trialEnds })
    .select("id")
    .single();
  if (error || !workspace) redirect(`/onboarding?error=${encodeURIComponent(error?.message ?? "Could not create workspace")}`);

  await supabase.from("memberships").insert({
    workspace_id: workspace.id,
    user_id: user.id,
    role: "owner",
  });
  if (fullName) await supabase.from("profiles").update({ full_name: fullName }).eq("id", user.id);

  // The Strategy Agent runs in the worker; the web tier only enqueues it. A
  // worker outage must not lose the signup, so a failure here is logged and the
  // user can retry from the dashboard.
  await callWorker("/jobs/strategy", {
    workspaceId: workspace.id,
    userId: user.id,
    websiteUrl: websiteUrl || undefined,
    linkedinCompanyUrl: linkedinCompanyUrl || undefined,
    description: description || undefined,
  });

  redirect("/app");
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "workspace";
}

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (!isAppConfigured()) redirect("/login");

  const params = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: existing } = await supabase.from("memberships").select("workspace_id").eq("user_id", user.id).limit(1);
  if (existing?.length) redirect("/app");

  // Someone with a pending invitation is joining a team, not starting one.
  const { data: pendingInvite } = await supabase
    .from("invitations")
    .select("token")
    .eq("email", user.email ?? "")
    .is("accepted_at", null)
    .is("revoked_at", null)
    .limit(1)
    .maybeSingle();
  if (pendingInvite) redirect(`/invite/${pendingInvite.token}`);

  return (
    <main style={{ padding: "4rem 0" }}>
      <div className="narrow" style={{ maxWidth: 560 }}>
        <h1 style={{ fontSize: "1.9rem" }}>Tell us about your business</h1>
        <p className="muted">
          The Strategy Agent reads what you publish and drafts your Business Profile and customer
          profiles. You will be able to edit everything it writes.
        </p>

        {params.error ? (
          <div className="notice danger" style={{ marginBottom: "1.25rem" }}>
            {params.error}
          </div>
        ) : null}

        <form action={createWorkspace} className="card">
          <label className="field">
            <span>Your name</span>
            <input name="fullName" placeholder="Jane Doe" autoComplete="name" />
          </label>
          <label className="field">
            <span>Company name</span>
            <input name="companyName" required placeholder="Acme Inc" />
          </label>
          <label className="field">
            <span>Website</span>
            <input name="websiteUrl" type="url" placeholder="https://acme.com" />
          </label>
          <label className="field">
            <span>LinkedIn company page</span>
            <input name="linkedinCompanyUrl" type="url" placeholder="https://linkedin.com/company/acme" />
          </label>
          <label className="field">
            <span>Anything else worth knowing</span>
            <textarea
              name="description"
              rows={4}
              placeholder="Who you sell to, what you charge, what makes you different."
            />
          </label>
          <button className="btn" type="submit" style={{ width: "100%", justifyContent: "center" }}>
            Build my profiles
          </button>
        </form>
      </div>
    </main>
  );
}
