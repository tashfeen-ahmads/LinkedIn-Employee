import Link from "next/link";
import { redirect } from "next/navigation";
import {
  BRAND,
  BusinessProfileSchema,
  CTA_DEFINITIONS,
  competitorTargeting,
  describeCompetitorTargeting,
  parseCustomerProfile,
} from "@le/shared";
import { createClient } from "@/lib/supabase-server";
import { isAppConfigured } from "@/lib/config";
import { callWorker } from "@/lib/worker";
import { SubmitButton } from "@/components/submit-button";
import { AutoRefresh } from "@/components/auto-refresh";
import { StrategyStatus } from "@/components/strategy-status";
import { StrategyDetailsForm, StrategyRetryButton } from "@/components/strategy-retry";
import { readStrategyState } from "@/lib/strategy-state";
import { hasStrategySource } from "@/lib/onboarding-stash";
import { SEARCH_EVENTS, describeLastSearch } from "@/lib/last-search";
import { launchBlockers } from "@/lib/campaign";
import { launchState } from "@/lib/launch";
import { readWizard, type WizardRead } from "@/lib/wizard-state";
import { AUTONOMY_ROLES } from "@/lib/autonomy";
import { parseWorkingHours } from "@le/linkedin";
import { WIZARD_STEPS, currentStep, stepDone, stepIndex, stepPosition, stepToShow, type WizardStepKey } from "@/lib/wizard";
import { describeRepair, type RefreshResult } from "@/app/app/team/repair";
import {
  BusinessForm,
  CtaForm,
  HoursForm,
  LaunchPanel,
  LinkedInForm,
  SearchButton,
  StrategyCards,
  VoiceForm,
  type LaunchReview,
  type StrategyCard,
} from "./steps";

/*
 * Onboarding, one step per screen, in an order that cannot be skipped
 * (rule 65). The app opens when the first campaign is live.
 *
 * `?error=` carries a code, never a sentence: whatever is in the address bar
 * is shown to the person, and a code can only ever map to words written here.
 */
const ERRORS: Record<string, string> = {
  "Company name is required": "Enter your company name.",
  "Give us a website, a LinkedIn page, or a description to work from":
    "Give us a website, a LinkedIn page or a description to work from. Sage will not invent a business from nothing.",
  "plan-missing": "Choose the LinkedIn plan this account has.",
  "linkedin-link": "LinkedIn did not give us a sign-in link just now. Try again in a minute.",
  timezone: "Choose your timezone.",
  hours: "The sending window has to end after it starts.",
  days: "Pick at least one day it may send on.",
  name: "Your name is what a prospect sees the invitation come from, so it cannot be blank.",
  "cta-kind": "Choose what your campaigns ask for.",
  "cta-url": "A link campaign needs a web address we can send, like yoursite.com/offer. Check it and try again.",
  "booking-url": "That scheduling link is not a web address we can send. Check it, or leave it blank.",
  "approve-failed": "That strategy could not be approved. Reload the page and try again.",
  "search-not-started": "The search has not started yet. Press Search LinkedIn to start it.",
  "launch-blocked": "Not launched yet. Fix what is listed below first.",
  "launch-missing": "That campaign could not be found. Reload the page.",
  "launch-failed": "The campaign could not be launched. Nothing was sent. Try again.",
  "save-failed": "That could not be saved just now. Try again.",
  unreadable: "Your setup could not be loaded just now, so nothing was saved. Try again in a minute.",
  "sage-not-started": "Sage could not be started just now. Try again in a minute.",
  "sage-admin-only": "Only an owner or admin can change what Sage reads. Press Try again to run it on what you gave at the start.",
  "sage-needs-source": "Tell Sage what you sell first: a website, a LinkedIn page or a sentence or two.",
};
const UNKNOWN_ERROR = "Something did not go through just now. Try again in a minute.";
const LINKEDIN_SIGN_IN_FAILED = "The LinkedIn sign-in did not go through, so nothing was connected. Press Connect LinkedIn to try again.";

/** What each step's screen says under its heading. */
const LEDES: Record<WizardStepKey, string> = {
  business:
    "Sage, the strategist, reads what you publish and writes your business profile and three to five strategies: who to go after, and why they would care. It works while you do the next steps.",
  linkedin:
    "Every invitation and message goes out from your own LinkedIn account, so nothing can be searched or sent until it is connected.",
  hours: "Nothing leaves your account outside these hours, in your own timezone.",
  voice: "Invitations and replies go out under your name, in your voice.",
  cta: "What a campaign asks for decides how its messages are written and what counts as a win.",
  strategy:
    "Sage wrote these from your business. Approve one and Nora searches LinkedIn for those people. Nothing is searched for until you do.",
  prospects:
    "Nora is searching LinkedIn, scoring everyone against your strategy and writing a note for each person. It usually takes a minute or two.",
  launch: "Your first campaign, ready to go. Read it, then launch it. Nothing is sent until you press the button.",
};

async function signOutToFind() {
  "use server";
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/forgot?kind=signin");
}

async function signOut() {
  "use server";
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ step?: string; error?: string; connected?: string }>;
}) {
  if (!isAppConfigured()) redirect("/login");
  const params = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  let wizard = await readWizard(supabase, user.id);

  if (!wizard.workspaceId) {
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
  }

  /*
   * Back from LinkedIn's sign-in, or arriving while the account is not
   * working: ask the provider rather than wait to be told (rule 8). The row is
   * bound by the worker's claim on the way back and by a webhook otherwise,
   * and a webhook that does not arrive left the rep reading "connect LinkedIn"
   * one second after doing it. Only while the account is not active, so a
   * working setup makes no provider call here.
   */
  if (wizard.unreadable) {
    return (
      <main className="auth-page" id="main" tabIndex={-1}>
        <header>
          <h1>Setting up {BRAND.name}</h1>
        </header>
        <div className="notice warning" role="alert">
          <p>
            Your setup could not be loaded just now. Nothing has changed: reload this page in a minute and you will
            be where you left off.
          </p>
        </div>
      </main>
    );
  }

  let repair: ReturnType<typeof describeRepair> = null;
  if (
    wizard.workspaceId &&
    !wizard.facts.linkedInActive &&
    stepToShow(params.step, wizard.facts) === "linkedin" &&
    (params.connected === "1" || wizard.account)
  ) {
    const result = await callWorker<RefreshResult>("/jobs/linkedin-refresh", {
      workspaceId: wizard.workspaceId,
      userId: user.id,
    });
    repair = describeRepair(result);
    wizard = await readWizard(supabase, user.id);
  }

  const step = stepToShow(params.step, wizard.facts);
  if (!step) redirect("/app");
  const current = currentStep(wizard.facts)!;
  const position = stepPosition(step);

  const error = params.error
    ? Object.prototype.hasOwnProperty.call(ERRORS, params.error)
      ? ERRORS[params.error]
      : step === "linkedin"
        ? LINKEDIN_SIGN_IN_FAILED
        : UNKNOWN_ERROR
    : null;

  const body = await stepBody(step, wizard, user.id, { connected: params.connected === "1", repair });

  return (
    <div className="auth-split">
      <main className="auth-page wide" id="main" tabIndex={-1}>
        <div className="wz-progress">
          <p className="tiny subtle">
            Step {position.n} of {position.of}
          </p>
          <div className="step-meter" aria-hidden="true">
            {WIZARD_STEPS.map((s, i) => (
              <span
                key={s.key}
                className={stepDone(s.key, wizard.facts) ? "is-done" : i === stepIndex(step) ? "is-next" : undefined}
              />
            ))}
          </div>
        </div>

        <header>
          <h1>{WIZARD_STEPS[stepIndex(step)]!.title}</h1>
          <p className="muted">{LEDES[step]}</p>
        </header>

        {error ? (
          <div className="notice danger" role="alert">
            {error}
          </div>
        ) : null}

        {body}

        <nav className="wz-foot cluster" aria-label="Onboarding">
          {stepIndex(step) > 0 && wizard.workspaceId ? (
            <Link className="small" href={`/onboarding?step=${WIZARD_STEPS[stepIndex(step) - 1]!.key}`}>
              Back
            </Link>
          ) : null}
          {step !== current ? (
            <Link className="small" href="/onboarding">
              Return to step {stepPosition(current).n}
            </Link>
          ) : null}
          {wizard.workspaceId ? (
            <Link className="small" href="/app/support">
              Stuck? Ask us
            </Link>
          ) : null}
          <form action={signOut}>
            <SubmitButton className="btn ghost small" pendingLabel="Signing out…">
              Sign out
            </SubmitButton>
          </form>
        </nav>
      </main>
      <WizardRail step={step} wizard={wizard} />
    </div>
  );
}

/**
 * The whole sequence beside the step, so somebody can see how far there is to
 * go and change an earlier answer. Steps ahead of the current one are not
 * links: their inputs do not exist yet.
 */
function WizardRail({ step, wizard }: { step: WizardStepKey; wizard: WizardRead }) {
  const current = currentStep(wizard.facts);
  const reached = current ? stepIndex(current) : WIZARD_STEPS.length;
  return (
    <aside className="auth-aside wz-rail" aria-label="Setup steps">
      <p className="eyebrow">Set up {BRAND.name}</p>
      <ol className="wz-steps">
        {WIZARD_STEPS.map((s, i) => {
          const done = stepDone(s.key, wizard.facts);
          const here = s.key === step;
          const open = i <= reached && wizard.workspaceId !== null;
          const state = here ? "is-here" : done ? "is-done" : i <= reached ? "is-open" : "is-ahead";
          return (
            <li key={s.key} className={state} aria-current={here ? "step" : undefined}>
              <span className="wz-mark" aria-hidden="true">
                {done && !here ? "✓" : i + 1}
              </span>
              <span>
                {open && !here ? <Link href={`/onboarding?step=${s.key}`}>{s.title}</Link> : <strong>{s.title}</strong>}
                <span className="tiny">{s.settles}</span>
              </span>
            </li>
          );
        })}
      </ol>
      <p className="small">
        When the last step is done your first campaign is live, and {BRAND.name} opens on a short tour of everything
        else.
      </p>
    </aside>
  );
}

/** The screen for one step, with what it reads. */
async function stepBody(
  step: WizardStepKey,
  wizard: WizardRead,
  userId: string,
  extra: { connected: boolean; repair: ReturnType<typeof describeRepair> },
): Promise<React.ReactNode> {
  const supabase = await createClient();
  const workspaceId = wizard.workspaceId;

  if (step === "business") {
    if (!workspaceId) {
      const { data: auth } = await supabase.auth.getUser();
      return (
        <>
          {/* The page somebody lands on when they sign in with a different
              address from the one their workspace was set up with. */}
          <div className="notice" role="note">
            <p className="small">
              <strong>Set up {BRAND.name} before?</strong> You are signed in as {auth.user?.email}, which has no
              workspace yet. If you used a different email, sign out and sign in with that one.
            </p>
            <form action={signOutToFind}>
              <SubmitButton className="btn secondary small" pendingLabel="Signing out…">
                Sign out and find my account
              </SubmitButton>
            </form>
          </div>
          <BusinessForm />
        </>
      );
    }
    const strategy = await readStrategyState(supabase, workspaceId, await hasBusiness(workspaceId));
    const known = hasStrategySource(wizard.stash.source);
    return (
      <>
        <p>
          <strong>{wizard.workspaceName}</strong>
          {wizard.stash.source.websiteUrl ? <span className="muted"> · {wizard.stash.source.websiteUrl}</span> : null}
        </p>
        <StrategyStatus state={strategy} from="onboarding" />
        {strategy.phase === "absent" && known ? (
          <div className="notice">
            <p>Sage has what it needs and has not been asked yet.</p>
            <StrategyRetryButton from="onboarding">Start Sage</StrategyRetryButton>
          </div>
        ) : null}
        {(strategy.phase === "absent" && !known) || strategy.phase === "failed" ? (
          <StrategyDetailsForm source={wizard.stash.source} from="onboarding" />
        ) : null}
        {strategy.phase === "running" ? <AutoRefresh seconds={15} /> : null}
        <ContinueLink />
      </>
    );
  }

  if (step === "linkedin") {
    const connected = wizard.facts.linkedInActive;
    return (
      <>
        {connected ? (
          <div className="notice accent" role="status">
            <p>
              <strong>Connected{wizard.account?.display_name ? ` as ${wizard.account.display_name}` : ""}.</strong>{" "}
              Check the plan below and continue.
            </p>
          </div>
        ) : extra.repair ? (
          <div className={`notice ${extra.repair.tone}`} role="status">
            <p>
              <strong>{extra.repair.title}</strong> {extra.repair.body}
            </p>
            {extra.repair.fix ? <p className="small">{extra.repair.fix}</p> : null}
          </div>
        ) : null}
        <LinkedInForm account={wizard.account} stash={wizard.stash} connected={connected} />
      </>
    );
  }

  if (step === "hours" || step === "voice" || step === "cta") {
    const { data: me } = await supabase
      .from("profiles")
      .select("full_name, bio, timezone, booking_url")
      .eq("id", userId)
      .maybeSingle();
    if (step === "hours") {
      // Parsed, never cast: a stored value missing its days would otherwise
      // reach the form and break the page.
      const hours = wizard.account?.working_hours
        ? parseWorkingHours(wizard.account.working_hours)
        : wizard.stash.workingHours;
      return <HoursForm timezone={me?.timezone ?? null} hours={hours} />;
    }
    if (step === "voice") {
      return (
        <VoiceForm
          fullName={me?.full_name ?? null}
          bio={me?.bio ?? null}
          autonomy={wizard.stash.autonomy}
          canSetAutonomy={(AUTONOMY_ROLES as readonly string[]).includes(wizard.role ?? "")}
        />
      );
    }
    return <CtaForm cta={wizard.stash.cta} bookingUrl={me?.booking_url ?? null} />;
  }

  if (!workspaceId) return null;

  if (step === "strategy") {
    const businessId = await hasBusiness(workspaceId);
    const strategy = await readStrategyState(supabase, workspaceId, businessId);
    const cards = await strategyCards(workspaceId);
    if (cards.length === 0 && strategy.phase === "ready" && businessId) {
      // Written, and every one set aside: there is nothing here to wait for.
      return (
        <div className="notice warning" role="status">
          <p>
            <strong>Every strategy has been set aside.</strong> Tell us from{" "}
            <Link href="/app/support">Support</Link> what you sell and who buys it, and we will get Sage to write
            new ones.
          </p>
        </div>
      );
    }
    if (cards.length === 0) {
      return (
        <>
          <StrategyStatus state={strategy} from="onboarding" />
          {strategy.phase === "failed" || strategy.phase === "absent" ? (
            <StrategyDetailsForm source={wizard.stash.source} from="onboarding" />
          ) : (
            <p className="small muted">This page updates on its own when they are ready.</p>
          )}
          {strategy.phase === "running" || strategy.phase === "ready" ? <AutoRefresh seconds={10} /> : null}
        </>
      );
    }
    return (
      <>
        <StrategyCards cards={cards} />
        {wizard.facts.hasApprovedStrategy ? <ContinueLink /> : null}
      </>
    );
  }

  if (step === "prospects") {
    const [{ data: approved }, { data: lastEvent }] = await Promise.all([
      supabase
        .from("customer_profiles")
        .select("id, name")
        .eq("workspace_id", workspaceId)
        .not("approved_at", "is", null)
        .order("approved_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("events")
        .select("name, payload, created_at")
        .eq("workspace_id", workspaceId)
        .in("name", SEARCH_EVENTS)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    const notice = describeLastSearch(lastEvent);
    const searching = lastEvent?.name === "targeting.queued" && notice?.tone === "muted";
    return (
      <>
        {approved ? (
          <p className="small">
            Strategy: <strong>{approved.name}</strong>
          </p>
        ) : null}
        {notice ? (
          <div className={`notice ${notice.tone === "warning" ? "warning" : "accent"}`} role="status">
            <p>
              <strong>{notice.title}</strong>
            </p>
            <p className="small">{searching ? "This page moves on by itself when the list is ready." : notice.body}</p>
          </div>
        ) : null}
        {searching ? <AutoRefresh seconds={8} /> : null}
        {!searching && approved ? (
          <div className="cluster">
            <SearchButton profileId={approved.id} label={notice ? "Search again" : "Search LinkedIn"} />
            <Link className="btn secondary" href="/onboarding?step=strategy">
              Choose another strategy
            </Link>
          </div>
        ) : null}
      </>
    );
  }

  // launch
  const review = await launchReview(workspaceId);
  if (!review) {
    return (
      <div className="notice warning" role="status">
        <p>No campaign is waiting to launch. Go back a step and build your list.</p>
      </div>
    );
  }
  return <LaunchPanel review={review} />;
}

function ContinueLink() {
  return (
    <p>
      <Link className="btn" href="/onboarding">
        Continue
      </Link>
    </p>
  );
}

async function hasBusiness(workspaceId: string): Promise<boolean> {
  const supabase = await createClient();
  const { count } = await supabase
    .from("business_profiles")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId);
  return (count ?? 0) > 0;
}

/** Sage's strategies, best first, with the competitor check on each (rule 49). */
async function strategyCards(workspaceId: string): Promise<StrategyCard[]> {
  const supabase = await createClient();
  const [{ data: businesses }, { data: rows }] = await Promise.all([
    supabase.from("business_profiles").select("id, spec").eq("workspace_id", workspaceId),
    supabase
      .from("customer_profiles")
      .select("id, name, spec, approved_at, do_not_pursue, business_profile_id")
      .eq("workspace_id", workspaceId)
      .order("priority"),
  ]);
  const businessById = new Map((businesses ?? []).map((b) => [b.id, BusinessProfileSchema.safeParse(b.spec)]));
  const cards: StrategyCard[] = [];
  for (const row of rows ?? []) {
    if (row.do_not_pursue) continue;
    const spec = parseCustomerProfile(row.spec);
    if (!spec.success) continue;
    const business = row.business_profile_id ? businessById.get(row.business_profile_id) : undefined;
    cards.push({
      id: row.id,
      name: spec.data.name ?? row.name,
      summary: spec.data.summary,
      whatTheyBuy: spec.data.whatTheyBuy ?? null,
      insteadOfToday: spec.data.insteadOfToday ?? null,
      pains: spec.data.pains ?? [],
      rivals: business?.success ? describeCompetitorTargeting(competitorTargeting(spec.data, business.data)) : null,
      approved: Boolean(row.approved_at),
    });
  }
  return cards;
}

/** The draft the search built, read for the last step. */
async function launchReview(workspaceId: string): Promise<LaunchReview | null> {
  const supabase = await createClient();
  const { data: campaign } = await supabase
    .from("campaigns")
    .select("id, name, daily_invite_cap, cta_kind")
    .eq("workspace_id", workspaceId)
    .eq("status", "draft")
    .is("launched_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!campaign) return null;

  const [state, { data: queued }, { data: steps }] = await Promise.all([
    launchState(campaign.id, workspaceId),
    supabase
      .from("campaign_prospects")
      .select("prospect_id, invite_note")
      .eq("campaign_id", campaign.id)
      .eq("status", "queued")
      .order("created_at")
      .limit(3),
    supabase
      .from("campaign_steps")
      .select("step_number, delay_days, message, variant_id")
      .eq("campaign_id", campaign.id)
      .order("step_number"),
  ]);
  const ids = (queued ?? []).map((row) => row.prospect_id);
  const { data: people } = ids.length
    ? await supabase.from("prospects").select("id, first_name, last_name, title, company").in("id", ids)
    : { data: [] };
  const byId = new Map((people ?? []).map((p) => [p.id, p]));

  // The campaign-wide sequence, or the first angle's when every step belongs
  // to an angle (rule 28): one sequence to read, not all of them.
  const all = steps ?? [];
  const firstVariant = all.find((s) => s.variant_id)?.variant_id ?? null;
  const shared = all.filter((s) => !s.variant_id);
  const sequence = (shared.length ? shared : all.filter((s) => s.variant_id === firstVariant)).slice(0, 3);

  const kind = (campaign.cta_kind ?? "meeting") as keyof typeof CTA_DEFINITIONS;
  return {
    campaignId: campaign.id,
    name: campaign.name,
    people: state?.prospectCount ?? 0,
    dailyCap: campaign.daily_invite_cap,
    asks: CTA_DEFINITIONS[kind]?.label ?? CTA_DEFINITIONS.meeting.label,
    samples: (queued ?? []).map((row) => {
      const p = byId.get(row.prospect_id);
      const name = [p?.first_name, p?.last_name].filter(Boolean).join(" ") || "a prospect";
      const role = [p?.title, p?.company].filter(Boolean).join(", ");
      return { who: role ? `${name} · ${role}` : name, note: row.invite_note?.trim() || null };
    }),
    steps: sequence.map((s) => ({ n: s.step_number, delayDays: s.delay_days, message: s.message })),
    blockers: state ? launchBlockers(state) : ["That campaign could not be read."],
  };
}
