import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import { isAppConfigured } from "@/lib/config";
import { callWorker, errorQuery } from "@/lib/worker";
import { isValidTimezone } from "@le/shared";
import { TimezoneSelect } from "@/components/timezone-select";
import { SubmitButton } from "@/components/submit-button";

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

  // One call, not three. A workspace is only visible to its members, so
  // inserting it here and asking for the new id back was refused by the SELECT
  // policy — the membership that would make it visible is written next. The
  // function does both writes together, under the caller's own identity.
  const { data: workspaceId, error } = await supabase.rpc("create_workspace", {
    p_name: companyName,
    p_slug: slug,
    p_full_name: fullName || null,
  });
  if (error || !workspaceId) redirect(`/onboarding?error=${encodeURIComponent(error?.message ?? "Could not create workspace")}`);

  /*
   * Everything else this product needs about a person, written now.
   *
   * Onboarding used to collect five things and the profile screen then asked
   * for six more — a bio, a timezone, sending hours, a Sales Navigator tick
   * and an autonomy setting — on a page somebody had to go and find. Each of
   * those six steers an agent, so until they were answered the product ran on
   * defaults nobody chose: the writer had no voice to use, the limiter read
   * 8-to-18 in UTC, and the Targeting Agent searched a tier the account may
   * not have.
   *
   * That last one is not cosmetic. A search sent to a tier an account does
   * not hold returns nobody at all (rule 12), which reads on screen as "your
   * customer profile matched nobody" rather than "you are not subscribed". A
   * default guessed here is a campaign that silently finds nothing.
   *
   * So the answers land before the Strategy Agent is even asked to run, and
   * the profile screen becomes somewhere to change them rather than the place
   * they are first demanded.
   */
  const bio = String(formData.get("bio") ?? "").trim();
  const address = String(formData.get("address") ?? "").trim();
  const timezone = String(formData.get("timezone") ?? "").trim();

  const profilePatch: { bio?: string; address?: string; timezone?: string } = {};
  if (bio) profilePatch.bio = bio;
  if (address) profilePatch.address = address;
  // Only a zone this runtime can actually evaluate. An unreadable one falls
  // back to UTC inside the limiter and says nothing, which is how this
  // deployment came to invite New Yorkers at four in the morning.
  if (timezone && isValidTimezone(timezone)) profilePatch.timezone = timezone;
  if (Object.keys(profilePatch).length > 0) {
    await supabase.from("profiles").update(profilePatch).eq("id", user.id);
  }

  // The Strategy Agent runs in the worker; the web tier only enqueues it. A
  // worker outage must not lose the signup, so this does not block — the
  // workspace exists and the user can retry from the dashboard.
  //
  // But it is not silent either. Without this the first screen after signing up
  // is an empty dashboard that looks like the product doing nothing, when in
  // fact nothing was ever started.
  /*
   * The sending window and the search tier belong to the LinkedIn account,
   * which does not exist yet — nobody has connected one. They are stashed on
   * the workspace so the row can take them the moment it is created, rather
   * than being asked for a second time after connecting.
   */
  const start = Number(formData.get("start"));
  const end = Number(formData.get("end"));
  const days = [1, 2, 3, 4, 5, 6, 0].filter((day) => formData.get(`day-${day}`) === "on");
  const hoursUsable =
    Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end <= 24 && start < end && days.length > 0;

  await supabase
    .from("workspaces")
    .update({
      onboarding: {
        workingHours: hoursUsable ? { start, end, days } : null,
        hasSalesNavigator: formData.get("hasSalesNavigator") === "on",
        autonomy: formData.get("autonomy") === "autonomous" ? "autonomous" : "supervised",
      } as never,
    })
    .eq("id", workspaceId);

  const queued = await callWorker("/jobs/strategy", {
    workspaceId,
    userId: user.id,
    websiteUrl: websiteUrl || undefined,
    linkedinCompanyUrl: linkedinCompanyUrl || undefined,
    description: description || undefined,
  });

  if (!queued.ok) {
    redirect(errorQuery("/app", `Your workspace is ready, but we could not start writing your profiles: ${queued.error}`));
  }
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

  // What signing up already stored, so this page can show it back rather than
  // ask for it again. The trigger writes `full_name` from the signup form.
  const { data: me } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", user.id)
    .maybeSingle();

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
    <main className="auth-page wide">
      <header>
        <h1>Set up your agent</h1>
        <p className="muted">
          Everything on this page is what the agent works from — the words it writes in, the hours
          it may send in, and who it looks for. Answer it once; it all lands on your profile, where
          you can change any of it later.
        </p>
      </header>

      {params.error ? <div className="notice danger">{params.error}</div> : null}

      {/*
        One form, in sections, rather than a wizard.
        A four-step wizard hides how much is being asked and makes going back to
        change an earlier answer a chore. This is long, and being able to see
        its whole length is the honest version.
      */}
      <form action={createWorkspace} className="stack-5">
        <section className="card">
          <h2>Your business</h2>
          <p className="small muted">
            The Strategy Agent reads what you publish and drafts your business profile and three to
            five customer profiles. You read and approve them before anything is searched for.
          </p>
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
            <span className="hint">
              A website or a description — one of them is required. The agent will not invent a
              business from nothing.
            </span>
          </label>
        </section>

        <section className="card">
          <h2>How you sound</h2>
          <p className="small muted">
            Invitations and replies go out under your name, so this is the voice they are written
            in. Left blank the agent falls back to your business profile, which sounds like a
            company rather than a person.
          </p>
          <label className="field">
            <span>Your name</span>
            {/* Filled in from the account, not asked again. Signing up stored
                this, and a blank box on the next screen is the product asking
                a second time for something it already has. */}
            <input
              name="fullName"
              placeholder="Jane Doe"
              autoComplete="name"
              defaultValue={me?.full_name ?? ""}
            />
            <span className="hint">What a prospect sees the invitation come from.</span>
          </label>
          <label className="field">
            <span>How you would describe yourself to a prospect</span>
            <textarea
              name="bio"
              rows={3}
              placeholder="Twelve years in logistics ops before this. I care about the boring parts."
            />
          </label>
          <label className="field">
            <span>Business address · optional</span>
            <textarea name="address" rows={2} autoComplete="street-address" />
            <span className="hint">For invoices, and for knowing which rules apply to you.</span>
          </label>
        </section>

        <section className="card">
          <h2>When it may send</h2>
          <p className="small muted">
            Nothing leaves your account outside these hours, in your own timezone. This is the
            single most common reason a new campaign looks like it is doing nothing: a window set in
            the wrong zone sends at four in the morning, or never.
          </p>
          <label className="field medium">
            <span>Your timezone</span>
            <TimezoneSelect value={undefined} />
          </label>
          <div className="form-row">
            <label className="field compact">
              <span>From</span>
              <input type="number" name="start" min={0} max={23} defaultValue={9} />
            </label>
            <label className="field compact">
              <span>To</span>
              <input type="number" name="end" min={1} max={24} defaultValue={17} />
            </label>
            <div className="cluster-3">
              {[
                { value: 1, label: "Mon" },
                { value: 2, label: "Tue" },
                { value: 3, label: "Wed" },
                { value: 4, label: "Thu" },
                { value: 5, label: "Fri" },
                { value: 6, label: "Sat" },
                { value: 0, label: "Sun" },
              ].map((day) => (
                <label key={day.value} className="small check">
                  <input type="checkbox" name={`day-${day.value}`} defaultChecked={day.value >= 1 && day.value <= 5} />
                  {day.label}
                </label>
              ))}
            </div>
          </div>
        </section>

        <section className="card">
          <h2>How it searches, and what it does with an answer</h2>
          <p className="small muted">
            Two settings the agent cannot guess. Both can be changed later, and both are wrong by
            default for somebody: the search tier is a paid seat we cannot see, and how much rope
            to give the agent is your call rather than ours.
          </p>
          <label className="small check">
            <input type="checkbox" name="hasSalesNavigator" />
            <span>
              This LinkedIn account has Sales Navigator
              <span className="tiny subtle hint">
                Worth getting right rather than guessing. A search sent to a tier the account does
                not hold returns nobody at all — which reads on screen as &ldquo;nobody matched your
                customer profile&rdquo; rather than &ldquo;you are not subscribed&rdquo;. Without it,
                searches cannot filter on seniority or company size, and every campaign says so
                before you launch it.
              </span>
            </span>
          </label>
          <label className="field">
            <span>When a reply arrives</span>
            <select name="autonomy" defaultValue="supervised">
              <option value="supervised">Hold anything uncertain for me to read first</option>
              <option value="autonomous">The agent answers and books, on its own</option>
            </select>
            <span className="hint">
              Either way it only states facts from your own material, never sends a link it was not
              given, and stops the moment somebody asks not to be contacted. Two things always wait
              for you: a prospect who asks to speak to a person, and a message it did not
              understand.
            </span>
          </label>
        </section>

        <SubmitButton className="btn block" pendingLabel="Reading your site…">
          Build my profiles
        </SubmitButton>
      </form>
    </main>
  );
}
