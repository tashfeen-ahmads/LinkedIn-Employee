import Link from "next/link";
import { redirect } from "next/navigation";
import {
  alwaysHoldsSentence,
  CTA_DEFINITIONS,
  FIRST_STEP_TIMING_LABEL,
  LINKEDIN_LIMITS,
} from "@le/shared";
import { requireSession } from "@/lib/workspace";
import { createClient } from "@/lib/supabase-server";
import { PageNotice } from "@/components/page-notice";
import { PageHeader, Section, Empty } from "@/components/page";
import { SubmitButton } from "@/components/submit-button";
import { SelectAll } from "@/components/select-all";
import { AutoRefresh } from "@/components/auto-refresh";
import { SectionLayout, SectionNav, type SectionNavItem } from "@/components/section-nav";
import { CampaignGoalCards } from "@/components/campaign-goal-cards";
import { GOAL_LABELS } from "@/app/app/campaigns/[id]/goal-labels";
import { describeLastSearch, STALLED_MS } from "@/lib/last-search";
import { launchState } from "@/lib/launch";
import { launchBlockers } from "@/lib/campaign";
import { campaignBookingUrl } from "@/lib/booking-link";
import { campaignCtas } from "@/lib/campaign-cta";
import { label } from "@/lib/labels";
import {
  createCampaign,
  launchFromBuilder,
  renameCampaign,
  saveBuilderAgent,
  saveBuilderGoal,
  startFromStrategy,
} from "./actions";
import {
  BUILDER_STEPS,
  builderHref,
  currentBuilderStep,
  isBuilderStep,
  readStamps,
  stepOpen,
  type BuilderStep,
} from "./builder";

/**
 * A new campaign, one step at a time.
 *
 * It was one long form — name, account, goal, agent, warm-up, wait, two
 * hundred tick boxes — that a newcomer met all at once. It is now four steps
 * in a side menu, each saved before the next opens: who it is for, what it
 * asks for, who writes and answers for it, then a last read and Launch.
 *
 * The list comes one of two ways, and both are paths that already existed: a
 * fresh search for an approved strategy (`queueSearch`, the same one approval
 * starts), or people already in the workspace, never contacted (rule 24).
 * Either way the campaign is a draft from the first step, so steps 2 to 4 are
 * edits to a stored row, and closing the tab halfway loses nothing.
 */
type Params = {
  error?: string;
  notice?: string;
  campaign?: string;
  step?: string;
  source?: string;
  strategy?: string;
  since?: string;
  // What a refused submit sent back, so nothing has to be chosen twice.
  name?: string;
  agent?: string;
  cta?: string;
  account?: string;
  follow_up_days?: string;
  warm_up?: string;
};

export default async function NewCampaignPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const session = await requireSession();
  const supabase = await createClient();

  const { data: campaign } = params.campaign
    ? await supabase
        .from("campaigns")
        .select(
          "id, name, status, rules, agent_id, reply_mode, cta_id, cta_kind, cta_label, cta_url, customer_profile_id, linkedin_account_id, owner_user_id, connection_note, warm_up, daily_invite_cap",
        )
        .eq("id", params.campaign)
        .eq("workspace_id", session.workspaceId)
        .maybeSingle()
    : { data: null };
  if (params.campaign && !campaign) redirect("/app/campaigns/new?error=That+campaign+could+not+be+found.");
  // The builder only makes drafts. A launched campaign is changed in its own
  // sections, where every edit says what it does to people already reached.
  if (campaign && campaign.status !== "draft") redirect(`/app/campaigns/${campaign.id}`);

  const stamps = readStamps(campaign?.rules);
  const current = currentBuilderStep(Boolean(campaign), stamps);
  const asked: BuilderStep = isBuilderStep(params.step) ? params.step : campaign ? current : "details";
  // A step past the current one is not open, whatever the address says.
  if (campaign && !stepOpen(asked, current)) redirect(builderHref(campaign.id, current));
  if (!campaign && params.step && params.step !== "details") redirect("/app/campaigns/new");
  const step: BuilderStep = campaign ? asked : "details";

  const [{ data: ctas }, { data: agents }, { count: people }] = await Promise.all([
    supabase
      .from("ctas")
      .select("id, name, kind, label, url")
      .eq("workspace_id", session.workspaceId)
      .is("archived_at", null)
      .order("created_at", { ascending: true }),
    supabase
      .from("agents")
      .select("id, name, is_default")
      .eq("workspace_id", session.workspaceId)
      .is("archived_at", null)
      .order("is_default", { ascending: false }),
    campaign
      ? supabase
          .from("campaign_prospects")
          .select("id", { count: "exact", head: true })
          .eq("campaign_id", campaign.id)
          .eq("workspace_id", session.workspaceId)
      : Promise.resolve({ count: null }),
  ]);
  const library = ctas ?? [];
  const agentList = agents ?? [];
  const goal = campaign ? (await campaignCtas(supabase, session.workspaceId, [campaign])).get(campaign.id) ?? null : null;
  const agentName = agentList.find((a) => a.id === campaign?.agent_id)?.name ?? null;

  const items: SectionNavItem[] = BUILDER_STEPS.map((s) => {
    const href = campaign
      ? builderHref(campaign.id, s.key)
      : s.key === "details"
        ? "/app/campaigns/new"
        : `/app/campaigns/new?step=${s.key}`;
    const open = campaign ? stepOpen(s.key, current) : s.key === "details";
    const hints: Record<BuilderStep, string> = {
      details: campaign ? `${campaign.name} · ${people ?? 0} ${people === 1 ? "person" : "people"}` : "Name it and choose who is on it",
      goal: stamps.goal && goal ? CTA_DEFINITIONS[goal.kind].label : "What it asks for",
      agent: stamps.agent
        ? `${agentName ?? "No agent"} · ${campaign?.reply_mode === "autopilot" ? "replies sent for you" : "replies held for you"}`
        : "Who writes and answers",
      review: "Read it once more, then launch",
    };
    return {
      href,
      title: s.title,
      hint: hints[s.key],
      done: s.key === "details" ? Boolean(campaign) : s.key === "goal" ? stamps.goal : s.key === "agent" ? stamps.agent : false,
      locked: !open,
    };
  });

  return (
    <>
      <PageHeader
        crumbs={[{ href: "/app/campaigns", label: "Campaigns" }]}
        title={campaign ? `New campaign: ${campaign.name}` : "New campaign"}
        lede="Four steps, each saved as you go. Nothing sends until you have read it and pressed Launch."
      />
      <PageNotice error={params.error} notice={params.notice} />
      <SectionLayout
        nav={
          <SectionNav
            label="Campaign builder steps"
            variant="steps"
            items={items}
            match={{ by: "param", name: "step", fallback: "details" }}
          />
        }
      >
        {step === "details" ? (
          campaign ? (
            <DetailsSaved campaign={campaign} people={people ?? 0} />
          ) : params.strategy ? (
            <Searching workspaceId={session.workspaceId} strategyId={params.strategy} since={params.since} />
          ) : (
            <DetailsNew params={params} userId={session.userId} workspaceId={session.workspaceId} />
          )
        ) : null}

        {step === "goal" && campaign ? (
          <Section
            framed
            id="goal"
            title="What it asks for"
            description="What every message works towards. Nora writes towards it, and counts it as a win when it happens."
          >
            <form action={saveBuilderGoal} className="stack">
              <input type="hidden" name="campaignId" value={campaign.id} />
                <CampaignGoalCards
                goalLabels={GOAL_LABELS}
                library={library}
                // The campaign's own goal when a search wrote one onto it,
                // otherwise the workspace's first call to action — the one
                // chosen at onboarding — so a new campaign asks for what the
                // business said it wants.
                selected={
                  library.some((c) => c.id === campaign.cta_id) ? (campaign.cta_id as string) : (ctas?.[0]?.id ?? "")
                }
                meetingSends={
                  (await campaignBookingUrl(supabase, session.workspaceId, campaign))
                    ? "Asks them to book a call through your scheduling link"
                    : "Asks them to book a call on your booking page"
                }
                ownDestination={
                  !campaign.cta_id && (campaign.cta_url || campaign.cta_label)
                    ? { kind: campaign.cta_kind, label: campaign.cta_label, url: campaign.cta_url }
                    : null
                }
              >
                <StepButtons back={builderHref(campaign.id, "details")} next="Save and continue" />
              </CampaignGoalCards>
            </form>
          </Section>
        ) : null}

        {step === "agent" && campaign ? (
          <Section framed id="agent" title="Who writes it, and who answers">
            <form action={saveBuilderAgent} className="stack">
              <input type="hidden" name="campaignId" value={campaign.id} />
              {agentList.length === 0 ? (
                <p className="small muted">
                  No agents yet, so the workspace&rsquo;s own voice writes it. <Link href="/app/agents">Make one</Link>
                </p>
              ) : (
                <label className="field">
                  <span>Agent</span>
                  <select
                    name="agentId"
                    defaultValue={campaign.agent_id ?? agentList.find((a) => a.is_default)?.id ?? agentList[0]?.id ?? ""}
                  >
                    {agentList.map((agent) => (
                      <option key={agent.id} value={agent.id}>
                        {agent.name}
                        {agent.is_default ? " (default)" : ""}
                      </option>
                    ))}
                  </select>
                  <span className="hint">
                    The agent carries the voice, the opener, the offer and how replies are answered.
                  </span>
                </label>
              )}
              <fieldset className="campaign-goals">
                <legend className="small">When somebody replies</legend>
                <div className="campaign-goal-grid">
                  <div className="campaign-goal">
                    <label className="campaign-goal-pick">
                      <input type="radio" name="replyMode" value="approval" defaultChecked={campaign.reply_mode !== "autopilot"} />
                      <span className="campaign-goal-title">I&rsquo;ll check each one</span>
                      <span className="campaign-goal-hint">Every reply waits for you before it is sent.</span>
                    </label>
                  </div>
                  <div className="campaign-goal">
                    <label className="campaign-goal-pick">
                      <input type="radio" name="replyMode" value="autopilot" defaultChecked={campaign.reply_mode === "autopilot"} />
                      <span className="campaign-goal-title">Send clean replies for me</span>
                      <span className="campaign-goal-hint">Anything uncertain still waits for you.</span>
                    </label>
                  </div>
                </div>
                <p className="tiny subtle">{alwaysHoldsSentence()}</p>
              </fieldset>
              <StepButtons back={builderHref(campaign.id, "goal")} next="Save and continue" />
            </form>
          </Section>
        ) : null}

        {step === "review" && campaign ? (
          <Review
            campaign={campaign}
            workspaceId={session.workspaceId}
            people={people ?? 0}
            goalLabel={goal ? `${CTA_DEFINITIONS[goal.kind].label}${goal.label ? ` (“${goal.label}”)` : ""}` : "Not chosen"}
            agentName={agentName}
          />
        ) : null}
      </SectionLayout>
    </>
  );
}

/** Back and forward under a step, the way every step ends. */
function StepButtons({ back, next }: { back?: string; next: string }) {
  return (
    <div className="campaign-step-buttons">
      {back ? (
        <Link className="btn secondary" href={back}>
          Previous
        </Link>
      ) : (
        <span />
      )}
      <SubmitButton pendingLabel="Saving…">{next}</SubmitButton>
    </div>
  );
}

/** Step 1 for a draft that exists: its name, and what is on it. */
function DetailsSaved({
  campaign,
  people,
}: {
  campaign: { id: string; name: string };
  people: number;
}) {
  return (
    <Section framed id="details" title="Details and list">
      <form action={renameCampaign} className="stack">
        <input type="hidden" name="campaignId" value={campaign.id} />
        <label className="field">
          <span>Campaign name</span>
          <input name="name" maxLength={120} required autoComplete="off" defaultValue={campaign.name} />
        </label>
        <p className="small muted">
          {people} {people === 1 ? "person is" : "people are"} on the list, each with a note written for them.{" "}
          <Link href={`/app/campaigns/${campaign.id}/people`}>Read the list</Link>
        </p>
        <StepButtons next="Save and continue" />
      </form>
    </Section>
  );
}

/** Step 1 before anything is stored: where the list comes from. */
async function DetailsNew({ params, userId, workspaceId }: { params: Params; userId: string; workspaceId: string }) {
  const supabase = await createClient();
  const [{ data: strategies }, { data: accounts }, { data: prospects }, { data: mine }, { data: ws }] = await Promise.all([
    supabase
      .from("customer_profiles")
      .select("id, name")
      .eq("workspace_id", workspaceId)
      .eq("do_not_pursue", false)
      .not("approved_at", "is", null)
      .order("priority", { ascending: true }),
    supabase
      .from("linkedin_accounts")
      .select("id, display_name, status")
      .eq("workspace_id", workspaceId)
      .eq("status", "active"),
    // Never contacted, because nobody is approached twice (rule 24). Showing
    // them greyed out would be worse than leaving them off: a list that
    // offers a person it will refuse to send to is a list that lies.
    supabase
      .from("prospects")
      .select("id, first_name, last_name, company, title, fit_score")
      .eq("workspace_id", workspaceId)
      .is("last_contacted_at", null)
      .eq("do_not_contact", false)
      .order("fit_score", { ascending: false, nullsFirst: false })
      .limit(200),
    // The search runs on the person's own account (`queueSearch`).
    supabase.from("linkedin_accounts").select("status").eq("workspace_id", workspaceId).eq("user_id", userId).maybeSingle(),
    // The workspace's switch on the LinkedIn activity page is where a new
    // campaign's profile views start; the box below can still change it.
    supabase.from("workspaces").select("onboarding").eq("id", workspaceId).maybeSingle(),
  ]);
  const approved = strategies ?? [];
  const canSearch = mine?.status === "active";
  const source = params.source === "people" || params.source === "strategy" ? params.source : approved.length && canSearch ? "strategy" : "people";

  return (
    <>
      <nav className="campaign-filter" aria-label="Where the list comes from">
        <Link
          href="/app/campaigns/new?source=strategy"
          className={source === "strategy" ? "is-active" : undefined}
          aria-current={source === "strategy" ? "page" : undefined}
        >
          Find new people for a strategy
        </Link>
        <Link
          href="/app/campaigns/new?source=people"
          className={source === "people" ? "is-active" : undefined}
          aria-current={source === "people" ? "page" : undefined}
        >
          Use people you already have
        </Link>
      </nav>

      {source === "strategy" ? (
        !canSearch ? (
          <Empty title="Connect your LinkedIn account first" action="Connect it" href="/app/profile">
            The search runs on your own LinkedIn account, so it needs to be connected.
          </Empty>
        ) : approved.length === 0 ? (
          <Empty title="No approved strategy yet" action="Open strategies" href="/app/strategy">
            A strategy is searched only once you have approved it. Approve one, or use people you already have.
          </Empty>
        ) : (
          <Section
            framed
            id="strategy"
            title="Details and list"
            description="Nora searches LinkedIn for people who fit the strategy, writes a note for each one and saves the list as a draft. About a minute."
          >
            <form action={startFromStrategy} className="stack">
              <label className="field">
                <span>Strategy</span>
                <select name="strategy" defaultValue={approved.some((s) => s.id === params.strategy) ? params.strategy : approved[0]?.id}>
                  {approved.map((strategy) => (
                    <option key={strategy.id} value={strategy.id}>
                      {strategy.name}
                    </option>
                  ))}
                </select>
                <span className="hint">
                  The campaign is named after what it finds. You can rename it on the next screen.
                </span>
              </label>
              <StepButtons next="Find people" />
            </form>
          </Section>
        )
      ) : (accounts ?? []).length === 0 ? (
        <Empty title="No LinkedIn account connected" action="Connect one" href="/app/profile">
          A campaign sends from an account. Connect yours and this page will have somewhere to send from.
        </Empty>
      ) : (prospects ?? []).length === 0 ? (
        <Empty title="Nobody left to add" action="Find prospects" href="/app/strategy">
          Everyone in this workspace has already been contacted, or is on the do-not-contact list. Run a
          strategy to find more.
        </Empty>
      ) : (
        <form action={createCampaign} className="stack">
          <Section framed id="what" title="Details" description="A name for you, and who it sends from.">
            <label className="field">
              <span>Campaign name</span>
              <input name="name" maxLength={120} required autoComplete="off" defaultValue={params.name ?? ""} />
            </label>
            <label className="field">
              <span>Sends from</span>
              <select
                name="account"
                defaultValue={(accounts ?? []).some((a) => a.id === params.account) ? params.account : (accounts ?? [])[0]?.id}
              >
                {(accounts ?? []).map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.display_name ?? "Your LinkedIn account"}
                  </option>
                ))}
              </select>
            </label>
            <label className="inline-check">
              <input
                type="checkbox"
                name="warm_up"
                defaultChecked={
                  params.warm_up
                    ? params.warm_up !== "off"
                    : (ws?.onboarding as { warmUp?: unknown } | null)?.warmUp === true
                }
              />
              <span>Look at each profile a few hours before inviting</span>
            </label>
            <p className="tiny subtle">
              LinkedIn tells people who looked at their profile, so the request arrives to a name they have
              already seen once. Views have their own allowance of {LINKEDIN_LIMITS.profileViewsPerDay} a day and
              never come out of your invitations.
            </p>
            <label className="field">
              <span>Days between the first and second message</span>
              <input
                name="follow_up_days"
                type="number"
                inputMode="numeric"
                min={1}
                max={30}
                defaultValue={Number(params.follow_up_days) || 3}
              />
              <span className="hint">
                The first goes out {FIRST_STEP_TIMING_LABEL}, inside your sending hours. That one is not
                adjustable: a message three days after somebody accepted reaches a stranger who has forgotten
                accepting. It all stops on its own if they reply or opt out.
              </span>
            </label>
          </Section>

          <Section
            framed
            id="who"
            title="Who is on it"
            description={
              (prospects ?? []).length >= 200
                ? "Only people this workspace has never contacted. Ranked by fit; the 200 best fits are listed here."
                : "Only people this workspace has never contacted. Ranked by fit."
            }
            action={<SelectAll name="prospect" label={`Select all ${(prospects ?? []).length}`} />}
          >
            <div className="scroll-box">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">
                      <span className="sr-only">Include</span>
                    </th>
                    <th scope="col">Name</th>
                    <th scope="col">Company</th>
                    <th scope="col" className="num">
                      Fit
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {(prospects ?? []).map((prospect) => (
                    <tr key={prospect.id}>
                      <td>
                        <input
                          type="checkbox"
                          name="prospect"
                          value={prospect.id}
                          aria-label={`Include ${[prospect.first_name, prospect.last_name].filter(Boolean).join(" ") || "this person"}`}
                        />
                      </td>
                      <td>
                        {[prospect.first_name, prospect.last_name].filter(Boolean).join(" ")}
                        {prospect.title ? <div className="small muted">{prospect.title}</div> : null}
                      </td>
                      <td>{prospect.company ?? ""}</td>
                      <td className="num">{prospect.fit_score ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <StepButtons next="Save and continue" />
        </form>
      )}
    </>
  );
}

/**
 * Step 1 while a strategy's search runs: wait on the row, not on the press.
 *
 * The search writes a draft campaign when it is done. This finds that draft —
 * from this strategy, made since the press — and moves on to step 2 by itself;
 * a stop says the search's own reason and offers it again.
 */
async function Searching({ workspaceId, strategyId, since }: { workspaceId: string; strategyId: string; since?: string }) {
  const supabase = await createClient();
  const after = since && Number.isFinite(Date.parse(since)) ? since : new Date(Date.now() - 15 * 60_000).toISOString();
  const [{ data: profile }, { data: built }, { data: last }] = await Promise.all([
    supabase.from("customer_profiles").select("id, name").eq("id", strategyId).eq("workspace_id", workspaceId).maybeSingle(),
    supabase
      .from("campaigns")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("customer_profile_id", strategyId)
      .eq("status", "draft")
      .gte("created_at", after)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("events")
      .select("name, payload, created_at")
      .eq("workspace_id", workspaceId)
      .in("name", ["targeting.queued", "targeting.stopped"])
      .eq("subject_id", strategyId)
      .gte("created_at", after)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (!profile) redirect("/app/campaigns/new?source=strategy&error=That+strategy+could+not+be+found.");
  if (built) redirect(builderHref(built.id, "details"));

  const now = Date.now();
  const stopped = last?.name === "targeting.stopped";
  const stalled = !stopped && now - Date.parse(after) > STALLED_MS;
  const said = last ? describeLastSearch(last, now, { onboarding: true }) : null;

  return (
    <Section framed id="searching" title={`Finding people for “${profile.name}”`}>
      {stopped || stalled ? (
        <>
          <div className="notice warning" role="status">
            <p>
              <strong>{said?.title ?? "The search has not reported back."}</strong>
            </p>
            <p className="small">
              {said?.body ?? "It was started more than ten minutes ago and has not finished. Press Search again."}
            </p>
          </div>
          <form action={startFromStrategy}>
            <input type="hidden" name="strategy" value={profile.id} />
            <StepButtons back="/app/campaigns/new?source=strategy" next="Search again" />
          </form>
        </>
      ) : (
        <>
          <div className="notice accent" role="status">
            <p>
              <strong>Searching LinkedIn now.</strong>
            </p>
            <p className="small">
              Nora reads the search, scores each person against the strategy and writes them a note. This
              page moves on by itself when the list is ready, usually within a minute or two.
            </p>
          </div>
          <AutoRefresh seconds={8} />
        </>
      )}
    </Section>
  );
}

/** Step 4: the campaign once more, what stands in the way, and Launch. */
async function Review({
  campaign,
  workspaceId,
  people,
  goalLabel,
  agentName,
}: {
  campaign: { id: string; name: string; reply_mode: string; warm_up: boolean; daily_invite_cap: number; status: string };
  workspaceId: string;
  people: number;
  goalLabel: string;
  agentName: string | null;
}) {
  const state = await launchState(campaign.id, workspaceId);
  const blockers = state ? launchBlockers(state) : ["This campaign could not be read. Reload the page."];
  const facts: Array<{ term: string; value: string; href: string }> = [
    { term: "Name", value: campaign.name, href: builderHref(campaign.id, "details") },
    { term: "List", value: `${people} ${people === 1 ? "person" : "people"}, each with their own note`, href: `/app/campaigns/${campaign.id}/people` },
    { term: "Asks for", value: goalLabel, href: builderHref(campaign.id, "goal") },
    { term: "Written by", value: agentName ?? "The workspace's own voice", href: builderHref(campaign.id, "agent") },
    {
      term: "Replies",
      value: campaign.reply_mode === "autopilot" ? "Clean replies sent for you" : "Every reply waits for you",
      href: builderHref(campaign.id, "agent"),
    },
    {
      term: "Pace",
      value: `Up to ${campaign.daily_invite_cap} invitations a day${campaign.warm_up ? ", each after a profile view" : ""}`,
      href: `/app/campaigns/${campaign.id}/settings`,
    },
  ];

  return (
    <>
      {blockers.length > 0 ? (
        <div className="notice danger">
          <strong>Not ready to launch</strong>
          <ul className="bullets">
            {blockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <Section
        framed
        id="review"
        title="Review and launch"
        description="Read every name and every note before you launch. Nothing reaches anybody until you do."
      >
        <dl className="campaign-review">
          {facts.map((fact) => (
            <div key={fact.term}>
              <dt>{fact.term}</dt>
              <dd>
                {fact.value} <Link className="small" href={fact.href}>{fact.term === "List" ? "Read it" : "Change"}</Link>
              </dd>
            </div>
          ))}
        </dl>
        <p className="small muted">
          The messages it sends after somebody accepts are on its{" "}
          <Link href={`/app/campaigns/${campaign.id}/follow-ups`}>Follow-ups</Link>, and the opener and offer on{" "}
          <Link href={`/app/campaigns/${campaign.id}/opener`}>Opener &amp; offer</Link>. Status: {label(campaign.status)}.
        </p>
        <form action={launchFromBuilder}>
          <input type="hidden" name="campaignId" value={campaign.id} />
          <div className="campaign-step-buttons">
            <Link className="btn secondary" href={`/app/campaigns/${campaign.id}`}>
              Keep as a draft
            </Link>
            <SubmitButton
              pendingLabel="Launching…"
              disabled={blockers.length > 0}
              title={blockers.length > 0 ? "Fix what is listed under Not ready to launch first" : undefined}
            >
              Launch campaign
            </SubmitButton>
          </div>
        </form>
      </Section>
    </>
  );
}
