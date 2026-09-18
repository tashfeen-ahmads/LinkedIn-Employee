import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { BusinessProfileSchema, CustomerProfileSchema } from "@le/shared";
import { PageNotice } from "@/components/page-notice";
import { requireSession } from "@/lib/workspace";
import { createClient } from "@/lib/supabase-server";
import { callWorker, errorQuery, noticeQuery } from "@/lib/worker";
import { FILTER_FIELDS, applyProfileEdits, formatList } from "@/lib/profile-form";
import { readStrategyState } from "@/lib/strategy-state";
import { StrategyStatus } from "@/components/strategy-status";
import { SubmitButton } from "@/components/submit-button";

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

  const queued = await callWorker("/jobs/targeting", {
    workspaceId: session.workspaceId,
    userId: session.userId,
    customerProfileId: profileId,
    linkedinAccountId: account.id,
    limit: HOW_MANY,
  });
  if (!queued.ok) {
    redirect(errorQuery("/app/strategy", `Could not start the search: ${queued.error}`));
  }

  revalidatePath("/app/strategy");
  revalidatePath("/app/campaigns");
  // Said out loud, because the work happens somewhere else. The button returns
  // the moment the job is accepted, the agent takes the better part of a
  // minute, and without a sentence here the page looks exactly as it did
  // before the click -- which is what had somebody pressing it repeatedly and
  // queueing three searches of the same profile.
  redirect(
    noticeQuery(
      "/app/strategy",
      "Searching LinkedIn now. It takes about a minute — the list appears under Prospects, and this page will say if it stops early.",
    ),
  );
}

export default async function StrategyPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const params = await searchParams;
  const session = await requireSession();
  const supabase = await createClient();

  // The last time the Targeting Agent gave up, and why.
  //
  // The agent runs in the worker, so the page that started it never learns how
  // it went. Pressing "find prospects" and coming back to the same empty list
  // was indistinguishable from pressing nothing at all — which is exactly how
  // this shipped, and exactly what got reported.
  const { data: lastStop } = await supabase
    .from("events")
    .select("name, payload, created_at")
    .eq("workspace_id", session.workspaceId)
    .in("name", ["targeting.stopped", "targeting.queued"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

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
    // "Has not finished yet, or it has not run" was the whole of what this page
    // could say, and those are different situations with different things to do
    // about them — one of them being a failed run that will never finish on its
    // own. The agent records where it got to; this reads that.
    const strategy = await readStrategyState(supabase, session.workspaceId, false);
    return (
      <>
        <div className="page-head">
          <h1>Strategy</h1>
        </div>
        <StrategyStatus state={strategy} />
        {strategy.phase === "absent" ? (
          <div className="notice">
            <p>
              <strong>Nothing here yet.</strong> The Strategy Agent reads what you publish and drafts
              your business profile and three to five customer profiles — it has not been asked to
              yet.
            </p>
            <p className="small">
              <Link href="/onboarding" className="btn small">
                Tell us what you sell
              </Link>
            </p>
          </div>
        ) : null}
      </>
    );
  }

  // What each strategy has actually produced.
  //
  // The page ranks strategies by a priority somebody typed and shows nothing
  // about how any of them performed. A business running fifteen of these needs
  // the opposite: the one that found four hundred people and booked nothing is
  // a different problem from the one that found nobody at all, and neither is
  // visible from a priority number. Read as two flat queries and reduced here —
  // a count per strategy would be one query per strategy.
  const [{ data: prospectRows }, { data: campaignRows }] = await Promise.all([
    supabase
      .from("prospects")
      .select("customer_profile_id, last_contacted_at")
      .eq("workspace_id", session.workspaceId),
    supabase
      .from("campaigns")
      .select("customer_profile_id, status")
      .eq("workspace_id", session.workspaceId),
  ]);

  const yieldByStrategy = new Map<string, { found: number; contacted: number; campaigns: number; running: number }>();
  const bucket = (id: string | null) => {
    if (!id) return null;
    const existing = yieldByStrategy.get(id) ?? { found: 0, contacted: 0, campaigns: 0, running: 0 };
    yieldByStrategy.set(id, existing);
    return existing;
  };
  for (const row of prospectRows ?? []) {
    const entry = bucket(row.customer_profile_id);
    if (!entry) continue;
    entry.found += 1;
    if (row.last_contacted_at) entry.contacted += 1;
  }
  for (const row of campaignRows ?? []) {
    const entry = bucket(row.customer_profile_id);
    if (!entry) continue;
    entry.campaigns += 1;
    if (row.status === "running") entry.running += 1;
  }

  const business = BusinessProfileSchema.safeParse(businessRow.spec);
  const profiles = (profileRows ?? []).map((row) => ({
    row,
    spec: CustomerProfileSchema.safeParse(row.spec),
  }));
  const connected = account?.status === "active";

  return (
    <>
      <div className="page-head">
        <h1>Strategy</h1>
        <p className="small muted prose">
          Written by the Strategy Agent from what you publish. Nothing is searched for until you approve
          a profile, and every message the writer sends is grounded in what is on this page — so it is
          worth reading properly once.
        </p>
      </div>

      <PageNotice error={params.error} notice={params.notice} />

      {/* Reported whether or not the run failed loudly: the interesting case is
          the one that succeeded at doing nothing. */}
      {lastStop ? (
        <div className="notice warning">
          <p>
            <strong>
              {lastStop.name === "targeting.queued"
                ? "The last prospect search has not reported back."
                : "The last prospect search stopped early."}
            </strong>{" "}
            {lastStop.name === "targeting.queued"
              ? "The Targeting Agent was asked to run and has not reported back. If this does not change in a minute, the background worker took the job and did not finish it."
              : String((lastStop.payload as Record<string, unknown>)?.reason ?? "No reason recorded.")}
          </p>
          <p className="tiny subtle">
            {new Date(lastStop.created_at).toLocaleString()} ·{" "}
            <span className="mono">{JSON.stringify(lastStop.payload)}</span>
          </p>
        </div>
      ) : null}

      {!connected ? (
        <div className="notice">
          Connect your LinkedIn account on the Team page before looking for prospects.
        </div>
      ) : null}

      {business.success ? (
        <section className="card">
          <h3>{business.data.companyName}</h3>
          <p>{business.data.oneLiner}</p>
          <p className="small muted">{business.data.offering}</p>
          <div className="grid grid-3"
          >
            <Facts label="Tone of voice" values={[business.data.toneOfVoice]} />
            <Facts label="Proof points" values={business.data.proofPoints} />
            <Facts label="Differentiators" values={business.data.differentiators} />
            <Facts label="Objections we hear" values={business.data.commonObjections} />
          </div>
        </section>
      ) : (
        <div className="notice danger">
          The stored business profile does not match the current schema. Re-run the Strategy Agent.
        </div>
      )}

      <h2>Customer profiles</h2>

      <div className="grid">
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
              <header className="between">
                <div>
                  <h3>{profile.name}</h3>
                  <p className="small muted">
                    Priority {row.priority} ·{" "}
                    {row.do_not_pursue ? "not pursuing" : approved ? "approved" : "waiting for your approval"}
                  </p>
                  {/*
                    What this strategy has produced, not just where it ranks. A
                    strategy that found four hundred people and contacted none
                    is a different problem from one that found nobody, and a
                    priority number tells you neither.
                  */}
                  {(() => {
                    const stats = yieldByStrategy.get(row.id);
                    if (!stats?.found && !stats?.campaigns) return null;
                    return (
                      <p className="tiny subtle">
                        <Link href={`/app/prospects?strategy=${row.id}`}>
                          {stats.found} {stats.found === 1 ? "prospect" : "prospects"}
                        </Link>
                        {" · "}
                        {stats.contacted} contacted
                        {" · "}
                        {stats.campaigns} {stats.campaigns === 1 ? "campaign" : "campaigns"}
                        {stats.running ? `, ${stats.running} running` : ""}
                      </p>
                    );
                  })()}
                </div>
                <div className="cluster">
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
                      <SubmitButton
                        className="btn small"
                        disabled={!connected}
                        pendingLabel="Searching LinkedIn…"
                        title={connected ? undefined : "Connect your LinkedIn account first"}
                      >
                        Find {HOW_MANY} prospects
                      </SubmitButton>
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

              <p>{profile.summary}</p>
              <div className="grid grid-3"
              >
                <Facts label="What hurts" values={profile.pains} />
                <Facts label="Buying signals" values={profile.triggerEvents} />
                <Facts label="What we say" values={[profile.valueProposition]} />
                <Facts label="Opening angles" values={profile.hooks} />
              </div>

              <details>
                <summary className="small">
                  Who we search for
                </summary>
                <form action={saveProfile}>
                  <input type="hidden" name="profileId" value={row.id} />
                  <p className="small muted">
                    One per line. These go straight into the Sales Navigator search, so a title here is
                    a title LinkedIn has to recognise.
                  </p>
                  <div className="grid tight grid-3"
                  >
                    {FILTER_FIELDS.map((field) => (
                      <label className="field" key={field.key}>
                        <span>{field.label}</span>
                        <textarea
                          name={field.key}
                          rows={3}
                          defaultValue={formatList(profile.salesNavFilters[field.key])}
                        />
                      </label>
                    ))}
                    <label className="field">
                      <span>Priority · 1 goes first</span>
                      <input type="number" name="priority" min={1} max={5} defaultValue={row.priority} />
                    </label>
                  </div>
                  <button className="btn secondary small" type="submit">
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
      <p className="small muted">
        {label}
      </p>
      <ul className="small bullets">
        {values.map((value) => (
          <li key={value}>
            {value}
          </li>
        ))}
      </ul>
    </div>
  );
}
