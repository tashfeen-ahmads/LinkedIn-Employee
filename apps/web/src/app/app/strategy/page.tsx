import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { BusinessProfileSchema, CustomerProfileSchema } from "@le/shared";
import { requireSession } from "@/lib/workspace";
import { createClient } from "@/lib/supabase-server";
import { callWorker } from "@/lib/worker";
import { FILTER_FIELDS, applyProfileEdits, formatList } from "@/lib/profile-form";

/**
 * The Strategy Agent's output, and the only place it can be approved.
 *
 * Onboarding promises "you will be able to edit everything it writes", and
 * until this page existed there was nowhere to read any of it. Nothing could
 * start the Targeting Agent either, so the four-agent loop stopped after the
 * first one.
 */

const HOW_MANY = 50;

async function approveProfile(formData: FormData) {
  "use server";
  const id = String(formData.get("profileId"));
  const session = await requireSession();
  const supabase = await createClient();

  await supabase
    .from("customer_profiles")
    .update({ approved_at: new Date().toISOString(), do_not_pursue: false })
    .eq("id", id)
    .eq("workspace_id", session.workspaceId);

  revalidatePath("/app/strategy");
}

async function dropProfile(formData: FormData) {
  "use server";
  const id = String(formData.get("profileId"));
  const session = await requireSession();
  const supabase = await createClient();

  // Kept, not deleted: "we decided not to pursue this market" is worth
  // remembering, and undoing it is one click.
  await supabase
    .from("customer_profiles")
    .update({ do_not_pursue: true, approved_at: null })
    .eq("id", id)
    .eq("workspace_id", session.workspaceId);

  revalidatePath("/app/strategy");
}

async function saveProfile(formData: FormData) {
  "use server";
  const id = String(formData.get("profileId"));
  const session = await requireSession();
  const supabase = await createClient();

  const { data: row } = await supabase
    .from("customer_profiles")
    .select("spec")
    .eq("id", id)
    .eq("workspace_id", session.workspaceId)
    .maybeSingle();
  if (!row) return;

  const filters = Object.fromEntries(
    FILTER_FIELDS.map((field) => [field.key, String(formData.get(field.key) ?? "")]),
  ) as Record<(typeof FILTER_FIELDS)[number]["key"], string>;

  const result = applyProfileEdits(row.spec, {
    priority: Number(formData.get("priority")) || 3,
    filters,
  });
  if (!result.ok) redirect(`/app/strategy?error=${encodeURIComponent(result.error)}`);

  await supabase
    .from("customer_profiles")
    .update({ spec: result.spec as never, priority: result.spec.priority })
    .eq("id", id)
    .eq("workspace_id", session.workspaceId);

  revalidatePath("/app/strategy");
}

/**
 * Starts the Targeting Agent for one profile. Refuses without a connected
 * LinkedIn account rather than queueing a job that would fail silently in the
 * worker — the person is standing right here and can fix it.
 */
async function findProspects(formData: FormData) {
  "use server";
  const profileId = String(formData.get("profileId"));
  const session = await requireSession();
  const supabase = await createClient();

  const { data: account } = await supabase
    .from("linkedin_accounts")
    .select("id, status")
    .eq("workspace_id", session.workspaceId)
    .eq("user_id", session.userId)
    .maybeSingle();

  if (account?.status !== "active") {
    redirect("/app/strategy?error=" + encodeURIComponent("Connect your LinkedIn account on the Team page first."));
  }

  await callWorker("/jobs/targeting", {
    workspaceId: session.workspaceId,
    userId: session.userId,
    customerProfileId: profileId,
    linkedinAccountId: account.id,
    limit: HOW_MANY,
  });

  revalidatePath("/app/strategy");
  revalidatePath("/app/campaigns");
}

export default async function StrategyPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const session = await requireSession();
  const supabase = await createClient();

  const [{ data: businessRow }, { data: profileRows }, { data: account }] = await Promise.all([
    supabase
      .from("business_profiles")
      .select("id, spec, created_at")
      .eq("workspace_id", session.workspaceId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("customer_profiles")
      .select("id, name, spec, priority, approved_at, do_not_pursue")
      .eq("workspace_id", session.workspaceId)
      .order("priority", { ascending: true }),
    supabase
      .from("linkedin_accounts")
      .select("status")
      .eq("workspace_id", session.workspaceId)
      .eq("user_id", session.userId)
      .maybeSingle(),
  ]);

  if (!businessRow) {
    return (
      <>
        <h1 style={{ fontSize: "1.6rem" }}>Strategy</h1>
        <p className="muted">
          The Strategy Agent has not finished yet, or it has not run. It reads what you publish and
          drafts your business profile and three to five customer profiles; refresh in a minute.
        </p>
      </>
    );
  }

  const business = BusinessProfileSchema.safeParse(businessRow.spec);
  const profiles = (profileRows ?? []).map((row) => ({
    row,
    spec: CustomerProfileSchema.safeParse(row.spec),
  }));
  const connected = account?.status === "active";

  return (
    <>
      <h1 style={{ fontSize: "1.6rem" }}>Strategy</h1>
      <p className="small muted" style={{ maxWidth: "62ch" }}>
        Written by the Strategy Agent from what you publish. Nothing is searched for until you approve
        a profile, and every message the writer sends is grounded in what is on this page — so it is
        worth reading properly once.
      </p>

      {params.error ? (
        <div className="notice danger" style={{ marginTop: "1rem" }}>
          {params.error}
        </div>
      ) : null}

      {!connected ? (
        <div className="notice" style={{ marginTop: "1rem" }}>
          Connect your LinkedIn account on the Team page before looking for prospects.
        </div>
      ) : null}

      {business.success ? (
        <section className="card" style={{ marginTop: "1.25rem" }}>
          <h3 style={{ marginTop: 0 }}>{business.data.companyName}</h3>
          <p style={{ margin: "0 0 0.75rem" }}>{business.data.oneLiner}</p>
          <p className="small muted">{business.data.offering}</p>
          <div
            style={{
              display: "grid",
              gap: "1rem",
              gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
              marginTop: "1rem",
            }}
          >
            <Facts label="Tone of voice" values={[business.data.toneOfVoice]} />
            <Facts label="Proof points" values={business.data.proofPoints} />
            <Facts label="Differentiators" values={business.data.differentiators} />
            <Facts label="Objections we hear" values={business.data.commonObjections} />
          </div>
        </section>
      ) : (
        <div className="notice danger" style={{ marginTop: "1rem" }}>
          The stored business profile does not match the current schema. Re-run the Strategy Agent.
        </div>
      )}

      <h2 style={{ fontSize: "1.15rem", marginTop: "2rem" }}>Customer profiles</h2>

      <div style={{ display: "grid", gap: "1rem", marginTop: "1rem" }}>
        {profiles.map(({ row, spec }) => {
          if (!spec.success) {
            return (
              <div key={row.id} className="notice danger">
                “{row.name}” does not match the current schema and cannot be edited or targeted.
              </div>
            );
          }
          const profile = spec.data;
          const approved = Boolean(row.approved_at);

          return (
            <article key={row.id} className="card" style={row.do_not_pursue ? { opacity: 0.6 } : undefined}>
              <header style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
                <div>
                  <h3 style={{ margin: 0 }}>{profile.name}</h3>
                  <p className="small muted" style={{ margin: "0.2rem 0 0" }}>
                    Priority {row.priority} ·{" "}
                    {row.do_not_pursue ? "not pursuing" : approved ? "approved" : "waiting for your approval"}
                  </p>
                </div>
                <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                  {row.do_not_pursue ? (
                    <form action={approveProfile}>
                      <input type="hidden" name="profileId" value={row.id} />
                      <button className="btn secondary small" type="submit">
                        Pursue after all
                      </button>
                    </form>
                  ) : approved ? (
                    <form action={findProspects}>
                      <input type="hidden" name="profileId" value={row.id} />
                      <button className="btn small" type="submit" disabled={!connected}>
                        Find {HOW_MANY} prospects
                      </button>
                    </form>
                  ) : (
                    <form action={approveProfile}>
                      <input type="hidden" name="profileId" value={row.id} />
                      <button className="btn small" type="submit">
                        Approve
                      </button>
                    </form>
                  )}
                  {row.do_not_pursue ? null : (
                    <form action={dropProfile}>
                      <input type="hidden" name="profileId" value={row.id} />
                      <button className="btn secondary small" type="submit">
                        Not this market
                      </button>
                    </form>
                  )}
                </div>
              </header>

              <p style={{ margin: "1rem 0 0" }}>{profile.summary}</p>
              <div
                style={{
                  display: "grid",
                  gap: "1rem",
                  gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                  marginTop: "1rem",
                }}
              >
                <Facts label="What hurts" values={profile.pains} />
                <Facts label="Buying signals" values={profile.triggerEvents} />
                <Facts label="What we say" values={[profile.valueProposition]} />
                <Facts label="Opening angles" values={profile.hooks} />
              </div>

              <details style={{ marginTop: "1.25rem" }}>
                <summary className="small" style={{ cursor: "pointer" }}>
                  Who we search for
                </summary>
                <form action={saveProfile} style={{ marginTop: "1rem" }}>
                  <input type="hidden" name="profileId" value={row.id} />
                  <p className="small muted" style={{ marginTop: 0 }}>
                    One per line. These go straight into the Sales Navigator search, so a title here is
                    a title LinkedIn has to recognise.
                  </p>
                  <div
                    style={{
                      display: "grid",
                      gap: "0.75rem",
                      gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                    }}
                  >
                    {FILTER_FIELDS.map((field) => (
                      <label className="field" key={field.key} style={{ marginBottom: 0 }}>
                        <span>{field.label}</span>
                        <textarea
                          name={field.key}
                          rows={3}
                          defaultValue={formatList(profile.salesNavFilters[field.key])}
                        />
                      </label>
                    ))}
                    <label className="field" style={{ marginBottom: 0 }}>
                      <span>Priority · 1 goes first</span>
                      <input type="number" name="priority" min={1} max={5} defaultValue={row.priority} />
                    </label>
                  </div>
                  <button className="btn secondary small" type="submit" style={{ marginTop: "1rem" }}>
                    Save search
                  </button>
                </form>
              </details>
            </article>
          );
        })}
      </div>
    </>
  );
}

function Facts({ label, values }: { label: string; values: readonly string[] }) {
  if (values.length === 0) return null;
  return (
    <div>
      <p className="small muted" style={{ margin: "0 0 0.3rem" }}>
        {label}
      </p>
      <ul className="small" style={{ margin: 0, paddingLeft: "1.05rem" }}>
        {values.map((value) => (
          <li key={value} style={{ marginBottom: "0.2rem" }}>
            {value}
          </li>
        ))}
      </ul>
    </div>
  );
}
