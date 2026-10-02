import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import { isAppConfigured } from "@/lib/config";
import { TimezoneSelect } from "@/components/timezone-select";
import { SetupRail } from "@/components/setup-rail";
import { PostButton } from "@/components/post-button";
import { FormKeeper } from "@/components/form-keeper";


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
    <div className="auth-split">
    <main className="auth-page wide">
      <header>
        <h1>Set up your agent</h1>
        <p className="muted">
          Four sections, one form, one button. This is what the agent works from — the words it
          writes in, the hours it may send in, and who it looks for. Answer it once; it all lands
          on your profile, where you can change any of it later.
        </p>
      </header>

      {params.error ? <div className="notice danger">{params.error}</div> : null}

      {/*
        One form, in sections, rather than a wizard.
        A four-step wizard hides how much is being asked and makes going back to
        change an earlier answer a chore. This is long, and being able to see
        its whole length is the honest version.
      */}
      <form id="onboarding-form" action="/onboarding/submit" method="post" className="stack-5">
        <FormKeeper formId="onboarding-form" storageKey="nora:onboarding-answers" />
        <section className="card">
          <div className="form-step">
            <span className="form-step-n" aria-hidden="true">1</span>
            <h2>Your business</h2>
          </div>
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
          <div className="form-step">
            <span className="form-step-n" aria-hidden="true">2</span>
            <h2>How you sound</h2>
          </div>
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
          <div className="form-step">
            <span className="form-step-n" aria-hidden="true">3</span>
            <h2>When it may send</h2>
          </div>
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
          <div className="form-step">
            <span className="form-step-n" aria-hidden="true">4</span>
            <h2>How it searches, and what it does with an answer</h2>
          </div>
          <p className="small muted">
            Two settings the agent cannot guess. Both can be changed later, and both are wrong by
            default for somebody: the search tier is a paid seat we cannot see, and how much rope
            to give the agent is your call rather than ours.
          </p>
          <fieldset className="field" style={{ border: 0, padding: 0, display: "grid", gap: "0.6rem" }}>
            <legend style={{ fontWeight: 600, marginBottom: "0.25rem" }}>
              Does this LinkedIn account have Sales Navigator?
            </legend>
            <span className="tiny subtle hint">
              NORA works either way. This decides how precisely it can search, so pick the one that
              is true — searching with a tier the account doesn&rsquo;t have finds nobody.
            </span>
            <label className="small check">
              <input type="radio" name="hasSalesNavigator" value="on" required />
              <span>
                <strong>Yes, I have Sales Navigator</strong>
                <span className="tiny subtle hint">
                  Searches filter by job title, seniority, company size, industry and location, and
                  can leave out titles you don&rsquo;t want. Tighter lists, fewer invitations spent
                  on the wrong people.
                </span>
              </span>
            </label>
            <label className="small check">
              <input type="radio" name="hasSalesNavigator" value="off" required />
              <span>
                <strong>No, a regular LinkedIn account</strong>
                <span className="tiny subtle hint">
                  Searches use job title, location and industry only — no seniority, company size or
                  excluded titles — so lists are broader and you&rsquo;ll review more of them. LinkedIn
                  also caps how many searches a free account can run each month. You can switch to
                  Sales Navigator later on your profile.
                </span>
              </span>
            </label>
          </fieldset>
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

        <PostButton className="btn block" pendingLabel="Reading your site…">
          Build my profiles
        </PostButton>
      </form>
    </main>
    <SetupRail />
    </div>
  );
}
