import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  BusinessProfileSchema,
  competitorTargeting,
  describeCompetitorTargeting,
  parseCustomerProfile,
} from "@le/shared";
import { PageNotice } from "@/components/page-notice";
import { PageHeader, Section } from "@/components/page";
import { requireSession } from "@/lib/workspace";
import { createClient } from "@/lib/supabase-server";
import { callWorker, errorQuery, noticeQuery } from "@/lib/worker";
import { FILTER_FIELDS, applyProfileEdits, formatList } from "@/lib/profile-form";
import { CTA_DEFINITIONS, CTA_KINDS, checkCtaUrl, type CtaKind } from "@le/shared";
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

  // What campaigns from this strategy ask for. Set here rather than on the
  // campaign, because the copy is written toward the ask: a sequence built for
  // a call and then switched to a link is a sequence whose first two messages
  // were arguing for something else.
  const ctaKind = String(formData.get("ctaKind") ?? "meeting");
  const kind: CtaKind = CTA_KINDS.includes(ctaKind as CtaKind) ? (ctaKind as CtaKind) : "meeting";
  const ctaLabel = String(formData.get("ctaLabel") ?? "").trim() || null;

  let ctaUrl: string | null = null;
  if (CTA_DEFINITIONS[kind].needsUrl) {
    // Checked before it is stored, because it is typed by a person here and
    // then sent to a stranger under a real rep's name. The reason is shown
    // rather than a generic refusal: somebody who pasted "acme.test/signup"
    // needs to be told it is missing the https://, not that it is invalid.
    const checked = checkCtaUrl(String(formData.get("ctaUrl") ?? ""));
    if (!checked.ok) redirect(errorQuery("/app/strategy", checked.reason));
    ctaUrl = checked.url;
  }

  await supabase
    .from("customer_profiles")
    .update({
      spec: result.spec as never,
      priority: result.spec.priority,
      cta_kind: kind,
      cta_label: ctaLabel,
      // Cleared when the goal is no longer a link, or the database constraint
      // and the screen would disagree about what this strategy is doing.
      cta_url: ctaUrl,
    })
    .eq("id", id)
    .eq("workspace_id", session.workspaceId);

  revalidatePath("/app/strategy");
}

/**
 * Starts the Targeting Agent for one profile. Refuses without a connected
 * LinkedIn account rather than queueing a job that would fail silently in the
 * worker — the person is standing right here and can fix it.
 */
/**
 * Asks the Strategy Agent for more strategies.
 *
 * The first run writes three to five, which is the right number to read and
 * approve on a first afternoon and the wrong number to run a business on — a
 * company works fifteen or twenty segments, and this product had no way to get
 * past the first handful. Pressing this adds four more, written against what
 * already exists so it does not hand back the same three with different nouns.
 */
async function writeMoreStrategies(formData: FormData) {
  "use server";
  const session = await requireSession();
  // Which business they are adding to. Absent is the workspace's first, which
  // is every workspace that has only ever had one — and the reason the id
  // travels at all is that a workspace with two had its new segments filed
  // under whichever business happened to be oldest.
  const businessProfileId = String(formData.get("businessProfileId") ?? "").trim() || undefined;

  const queued = await callWorker("/jobs/strategy", {
    workspaceId: session.workspaceId,
    userId: session.userId,
    expand: true,
    businessProfileId,
  });
  if (!queued.ok) redirect(errorQuery("/app/strategy", queued.error));

  revalidatePath("/app/strategy");
  redirect(
    noticeQuery(
      businessProfileId ? `/app/strategy?business=${businessProfileId}` : "/app/strategy",
      "Writing four more. They arrive on this page in a minute or two, unapproved like the others — nothing is searched for until you read one.",
    ),
  );
}

/**
 * A second business, with its own profile and its own strategies.
 *
 * Deliberately not `expand`. Rule 37 is explicit that adding *strategies* must
 * extend the business profile already here rather than inserting a second one,
 * because the profile is what every strategy hangs off and a workspace with two
 * has its list split across both. This is the other thing — somebody who really
 * does run a cleaning company and an estate agency, and needs the split.
 *
 * So it is a separate button with a separate word on it, and it asks for the
 * website: a business profile written from nothing is a fluent invention
 * offered for approval as though it came from somewhere.
 */
async function addBusiness(formData: FormData) {
  "use server";
  const session = await requireSession();
  if (!["owner", "admin"].includes(session.role)) {
    redirect(errorQuery("/app/strategy", "Only an owner or admin can add a business."));
  }

  const websiteUrl = String(formData.get("websiteUrl") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  if (!websiteUrl && !description) {
    redirect(
      errorQuery("/app/strategy", "Give the agent a website or a description — it will not invent a business."),
    );
  }

  const queued = await callWorker("/jobs/strategy", {
    workspaceId: session.workspaceId,
    userId: session.userId,
    websiteUrl: websiteUrl || undefined,
    description: description || undefined,
  });
  if (!queued.ok) redirect(errorQuery("/app/strategy", queued.error));

  revalidatePath("/app/strategy");
  redirect(
    noticeQuery(
      "/app/strategy",
      "Reading that site now. The new business and its strategies appear here in a minute or two, unapproved — and they keep their own list, so nothing changes for the business you already run.",
    ),
  );
}

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
  searchParams: Promise<{ error?: string; notice?: string; business?: string }>;
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

  /*
   * Every business this workspace runs, oldest first — not the newest one.
   *
   * `business_profiles` has been one-to-many on `workspace_id` since migration
   * 0001 and this page read `order created_at desc limit 1`, so a workspace
   * with two showed the second business's profile above *both* businesses'
   * strategies, unlabelled. Oldest-first matches `loadBusinessProfile`, which
   * is what every writer resolves through: the first business is the one the
   * workspace was set up around, not the one somebody added last night.
   */
  const [{ data: businessRows }, { data: profileRows }, { data: account }] = await Promise.all([
    supabase
      .from("business_profiles")
      .select("id, spec, website_url, created_at")
      .eq("workspace_id", session.workspaceId)
      .order("created_at", { ascending: true }),
    supabase
      .from("customer_profiles")
      .select(
        "id, name, spec, priority, approved_at, do_not_pursue, cta_kind, cta_label, cta_url, business_profile_id",
      )
      .eq("workspace_id", session.workspaceId)
      .order("priority", { ascending: true }),
    supabase
      .from("linkedin_accounts")
      .select("status")
      .eq("workspace_id", session.workspaceId)
      .eq("user_id", session.userId)
      .maybeSingle(),
  ]);

  const businesses = businessRows ?? [];
  // `?business=` picks one, and an id that is not this workspace's falls back
  // to the first rather than to an empty page: a stale bookmark should show
  // something true, not "nothing here yet".
  const businessRow = businesses.find((row) => row.id === params.business) ?? businesses[0] ?? null;

  if (!businessRow) {
    // "Has not finished yet, or it has not run" was the whole of what this page
    // could say, and those are different situations with different things to do
    // about them — one of them being a failed run that will never finish on its
    // own. The agent records where it got to; this reads that.
    const strategy = await readStrategyState(supabase, session.workspaceId, false);
    return (
      <>
        <PageHeader eyebrow="Pipeline" title="Strategies" />
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
  const profiles = (profileRows ?? [])
    // This business's strategies, not the workspace's. Unfiltered, a workspace
    // running two showed one business's profile above both lists, so a rep
    // approving "Chamber leaders" could not tell which company it was for.
    .filter((row) => !businessRow.id || row.business_profile_id === businessRow.id)
    .map((row) => ({ row, spec: parseCustomerProfile(row.spec) }));
  const connected = account?.status === "active";

  /**
   * What to call a business in a tab.
   *
   * `spec.companyName` rather than a column: the name is already a field on the
   * profile the agent wrote, and a second place to store it is a second place
   * for it to be wrong. The host of the site it was read from is the fallback,
   * because that is the one thing a rep certainly recognises.
   */
  const labelOf = (row: { spec: unknown; website_url: string | null }): string => {
    const spec = row.spec as { companyName?: unknown } | null;
    if (typeof spec?.companyName === "string" && spec.companyName.trim()) return spec.companyName;
    if (row.website_url) return row.website_url.replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
    return "Untitled business";
  };
  const strategyCount = new Map<string, number>();
  for (const row of profileRows ?? []) {
    const id = row.business_profile_id;
    if (id) strategyCount.set(id, (strategyCount.get(id) ?? 0) + 1);
  }

  return (
    <>
      <PageHeader
        eyebrow="Pipeline"
        title="Strategies"
        lede="Written by the Strategy Agent from what you publish. Nothing is searched for until you approve one, and every message the writer sends is grounded in what is on this page — so it is worth reading properly once."
        actions={
          <form action={writeMoreStrategies}>
            <input type="hidden" name="businessProfileId" value={businessRow.id} />
            <SubmitButton pendingLabel="Writing…" className="btn secondary small">
              Write more strategies
            </SubmitButton>
          </form>
        }
      />

      <PageNotice error={params.error} notice={params.notice} />

      {/*
        Silent for a workspace with one business, which is almost all of them.
        A tab row that never has a second tab is a control that only ever says
        "you are where you already were".
      */}
      {businesses.length > 1 ? (
        <nav className="tabs" aria-label="Which business these strategies are for">
          {businesses.map((row) => (
            <a
              key={row.id}
              className={`pill ${row.id === businessRow.id ? "accent" : ""}`}
              href={`/app/strategy?business=${row.id}`}
              aria-current={row.id === businessRow.id ? "page" : undefined}
            >
              {labelOf(row)} ({strategyCount.get(row.id) ?? 0})
            </a>
          ))}
        </nav>
      ) : null}

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

      {/*
        The heading belongs to the list under it, so the frame owns both.
        Written as a bare `<h2>` it was a direct child of the page column: the
        page's own gap fell above it *and* below it, so the title sat exactly
        as far from its own list as from the card above — a heading attached to
        nothing. Every hand-rolled section on this product spaced itself
        slightly differently, which is the whole reason `Section` exists.
      */}
      <Section title="Customer profiles">
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
          /*
           * Is this segment made of the company's own competitors?
           *
           * Asked here because this is the only screen where approval happens
           * (rule 9), and because the agent contradicted itself on exactly this
           * point and nobody was told: it listed BNI as a competitor and made
           * BNI chapter presidents the priority-1 segment, which was then
           * approved. A question rather than a refusal — selling to the groups
           * you compete with is a real go-to-market, and the cost of asking is
           * one sentence read.
           */
          const rivals = business.success
            ? describeCompetitorTargeting(competitorTargeting(profile, business.data))
            : null;

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

              {rivals ? (
                <div className="notice warning">
                  <p>
                    <strong>Check this is who you meant.</strong> {rivals}
                  </p>
                </div>
              ) : null}

              {/*
                Why this segment would pay, stated rather than assumed.

                Everything else on this card reads the same whether the segment
                buys what you sell or sells it themselves — a title is a title.
                These two are the ones a competitor cannot answer, so they are
                the two worth reading before approving. Named as unsaid when the
                strategy predates them, never left blank: a missing fact
                presented as no fact reads as agreement.
              */}
              <div className="grid grid-2">
                <Facts
                  label="What they buy"
                  values={[profile.whatTheyBuy ?? "The agent did not say — written before this was asked for."]}
                />
                <Facts
                  label="What they do today instead"
                  values={[
                    profile.insteadOfToday ?? "The agent did not say — written before this was asked for.",
                  ]}
                />
              </div>

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
                    {/*
                      The ask, set here rather than on the campaign. Every
                      message in a sequence is written toward it, so choosing
                      it afterwards leaves copy that was arguing for something
                      else. Not everybody wants a meeting.
                    */}
                    <label className="field">
                      <span>What campaigns from this strategy ask for</span>
                      <select name="ctaKind" defaultValue={row.cta_kind}>
                        {CTA_KINDS.map((kind) => (
                          <option key={kind} value={kind}>
                            {CTA_DEFINITIONS[kind].label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      <span>Name the ask · optional</span>
                      <input
                        type="text"
                        name="ctaLabel"
                        maxLength={60}
                        placeholder="Try it free, See the comparison…"
                        defaultValue={row.cta_label ?? ""}
                      />
                    </label>
                    <label className="field">
                      <span>Where it sends them · only for a link</span>
                      <input
                        type="url"
                        name="ctaUrl"
                        placeholder="https://…"
                        defaultValue={row.cta_url ?? ""}
                      />
                      <span className="tiny subtle">
                        Never appears in the connection request — LinkedIn penalises links there and they
                        cut acceptance. It goes in the last message.
                      </span>
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
      </Section>

      {/*
        A second business, for somebody who really runs two.

        Below the strategies rather than beside "Write more strategies", because
        they are different things and the wrong one is expensive. Adding
        strategies extends the business already here — rule 37 is explicit that
        inserting a second profile splits a workspace's list across both, which
        is what a plain re-run used to do. This creates that split on purpose.
      */}
      {["owner", "admin"].includes(session.role) ? (
        <Section
          id="add-business"
          title="Another business"
          description="Each business keeps its own profile, its own strategies and its own copy. A workspace running a cleaning company and an estate agency should not post one's claims in the other's voice — and a segment named for one must not be dropped as a duplicate of the other's."
        >
          <div className="card">
            <form action={addBusiness} className="stack-3">
              <label className="field">
                <span>Its website</span>
                <input type="url" name="websiteUrl" placeholder="https://…" />
                <span className="hint">
                  The agent reads the site and writes that business its own profile and three to five
                  strategies, unapproved — exactly as it did the first time.
                </span>
              </label>
              <label className="field">
                <span>Or describe it</span>
                <textarea
                  name="description"
                  rows={3}
                  maxLength={2000}
                  placeholder="What it sells, and who buys it."
                />
                <span className="hint">
                  One or the other is required. The agent will not invent a business from nothing, and
                  a profile written from nothing is a fluent invention offered for approval as though
                  it came from somewhere.
                </span>
              </label>
              <SubmitButton className="btn secondary" pendingLabel="Reading the site…">
                Add this business
              </SubmitButton>
            </form>
          </div>
        </Section>
      ) : null}
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
