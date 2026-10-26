import Link from "next/link";
import { redirect } from "next/navigation";
import {
  BRAND,
  BusinessProfileSchema,
  LINKEDIN_CONNECT_ERRORS,
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
import { STALLED_MS, describeLastSearch } from "@/lib/last-search";
import { launchBlockers } from "@/lib/campaign";
import { launchState } from "@/lib/launch";
import { notesLeftThisMonth } from "@/lib/invite-notes";
import { angleSequence, mostHeldAngle } from "@/lib/wizard-launch";
import { readWizard, type WizardRead } from "@/lib/wizard-state";
import { AUTONOMY_ROLES } from "@/lib/autonomy";
import { parseWorkingHours } from "@le/linkedin";
import {
  WIZARD_STEPS,
  alreadyRunningNotice,
  canDefer,
  currentStep,
  stepDone,
  stepIndex,
  stepPosition,
  stepToShow,
  type WizardStepKey,
} from "@/lib/wizard";
import { describeRepair, type RefreshResult } from "@/app/app/team/repair";
import {
  BusinessForm,
  CtaForm,
  HoursForm,
  LaunchPanel,
  LinkedInForm,
  SearchButton,
  RewriteStrategies,
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
const SOURCE_MISSING =
  "Give us your website, or a few sentences on what you sell and who buys it. A LinkedIn page alone cannot be read, and Sage will not invent a business from nothing.";
const ERRORS: Record<string, string> = {
  // The sign-in codes the worker sends back, in the one definition the
  // profile page reads too.
  ...LINKEDIN_CONNECT_ERRORS,
  "company-name": "Enter your company name.",
  "source-missing": SOURCE_MISSING,
  // The two sentences the business step used to put in the address bar, for a
  // link somebody still has open.
  "Company name is required": "Enter your company name.",
  "Give us a website, a LinkedIn page, or a description to work from": SOURCE_MISSING,
  "plan-missing": "Choose the LinkedIn plan this account has.",
  "linkedin-link": "LinkedIn did not give us a sign-in link just now. Try again in a minute.",
  timezone: "Choose your timezone.",
  hours: "The sending window has to end after it starts.",
  days: "Pick at least one day it may send on.",
  "meet-hours": "Your meeting hours have to end after they start.",
  "meet-days": "Pick at least one day prospects can book a call, or nobody can.",
  name: "Your name is what a prospect sees the invitation come from, so it cannot be blank.",
  "cta-kind": "Choose what your campaigns ask for.",
  handling: "Choose who answers replies: you, or Nora on its own.",
  "copy-changed": "The opener or offer changed since this page loaded, so nothing was launched. Read it again, then launch.",
  "cta-url": "A link campaign needs a web address we can send, like yoursite.com/offer. Check it and try again.",
  "booking-url": "That scheduling link is not a web address we can send. Check it, or leave it blank.",
  "approve-failed": "That strategy could not be approved. Reload the page and try again.",
  "search-not-started": "The search could not be started just now. Press Search LinkedIn again in a minute.",
  "search-no-linkedin": "Your LinkedIn account is not connected, so nothing can be searched. Go back to the LinkedIn step and connect it.",
  "launch-blocked": "Not launched yet. Fix what is listed below first.",
  "launch-missing": "That campaign could not be found. Reload the page.",
  "launch-failed": "The campaign could not be launched. Nothing was sent. Try again.",
  "save-failed": "That could not be saved just now. Try again.",
  "rewrite-empty": "Tell Sage who you sell to in a few words, like \u201cowners of HVAC companies in Texas\u201d.",
  "rewrite-failed": "Sage could not start just now. Try again in a minute.",
  unreadable: "Your setup could not be loaded just now, so nothing was saved. Try again in a minute.",
  "sage-not-started": "Sage could not be started just now. Try again in a minute.",
  "sage-admin-only": "Only an owner or admin can change what Sage reads. Press Try again to run it on what you gave at the start.",
  "sage-needs-source":
    "Tell Sage what you sell first: your website, or a few sentences on what you sell and who buys it. A LinkedIn page alone cannot be read.",
};
const UNKNOWN_ERROR = "Something did not go through just now. Try again in a minute.";
const LINKEDIN_SIGN_IN_FAILED = "The LinkedIn sign-in did not go through, so nothing was connected. Press Connect LinkedIn to try again.";

/** What each step's screen says under its heading. */
const LEDES: Record<WizardStepKey, string> = {
  business:
    "Sage, the strategist, reads what you publish and writes your business profile and three to five strategies: who to go after, and why they would care. It works while you do the next steps.",
  linkedin:
    "Every invitation and message goes out from your own LinkedIn account, so nothing can be searched or sent until it is connected.",
  hours:
    "When your account may send, and when prospects can book a call with you. Both are in your own timezone.",
  voice: "Invitations and replies go out under your name, in your voice.",
  cta: "What a campaign asks for decides how its messages are written and what counts as a win.",
  strategy:
    "Sage wrote these from your business. Approve one and Nora searches LinkedIn for those people. Nothing is searched for until you do.",
  prospects:
    "Nora searches LinkedIn for each approved strategy, scores everyone it finds and writes a note for each person. A search usually takes a minute or two.",
  launch:
    "Your first campaign, ready to go. Read it, choose who answers the replies, then launch it. Nothing is sent until you press the button.",
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
  searchParams: Promise<{
    step?: string;
    error?: string;
    connected?: string;
    notice?: string;
    since?: string;
    campaign?: string;
  }>;
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
    // Only one that can still be accepted: the invite page refuses an expired
    // one, and sending somebody there from here made a loop with no way out of
    // it except an invitation nobody was going to resend.
    const { data: pendingInvite } = await supabase
      .from("invitations")
      .select("token")
      .eq("email", user.email ?? "")
      .is("accepted_at", null)
      .is("revoked_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("expires_at", { ascending: false })
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

  const body = await stepBody(step, wizard, user.id, {
    connected: params.connected === "1",
    repair,
    campaignId: params.campaign ?? null,
  });

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
        {step === "prospects" && alreadyRunningNotice(params.notice, params.since) ? (
          // Refreshed while it shows, so the page really does move on, and
          // only for as long as the search is given to finish (rule 65).
          <div className="notice" role="status">
            <p>That search is already running. This page updates by itself when the list is ready.</p>
            <AutoRefresh seconds={8} />
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
          {wizard.workspaceId && canDefer(current) ? (
            // A way into the app from every step that can fail for reasons
            // nobody on this screen can fix (rule 65).
            <form action="/onboarding/save" method="post">
              <input type="hidden" name="action" value="defer" />
              <SubmitButton className="btn ghost small" pendingLabel="Opening…">
                Launch later and open the app
              </SubmitButton>
            </form>
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
  extra: { connected: boolean; repair: ReturnType<typeof describeRepair>; campaignId?: string | null },
): Promise<React.ReactNode> {
  const supabase = await createClient();
  const workspaceId = wizard.workspaceId;

  if (step === "business") {
    if (!workspaceId) {
      const { data: auth } = await supabase.auth.getUser();
      return (
        <>
          <BusinessForm />
          {/* For somebody who signed in with a different address from the one
              their workspace was set up with. It sat above the form as a boxed
              notice, so every brand-new customer's first screen opened by asking
              whether they had used the product before. Under the form, as one
              quiet line, it is still there for the person it is for. */}
          <form action={signOutToFind} className="cluster small muted">
            <span>
              Signed in as {auth.user?.email}. Already set up {BRAND.name} with another email?
            </span>
            <SubmitButton className="btn ghost small" pendingLabel="Signing out…">
              Use that account
            </SubmitButton>
          </form>
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
      const { data: booking } = workspaceId
        ? await supabase
            .from("availability")
            .select("working_hours, meeting_minutes, location")
            .eq("workspace_id", workspaceId)
            .eq("user_id", userId)
            .maybeSingle()
        : { data: null };
      // What is saved, or the table's own defaults on the days it may send.
      const saved = booking?.working_hours ? parseWorkingHours(booking.working_hours) : null;
      const meetings = {
        start: saved?.start ?? 9,
        end: saved?.end ?? 17,
        days: saved?.days ?? hours?.days ?? [1, 2, 3, 4, 5],
        meetingMinutes: booking?.meeting_minutes ?? 30,
        location: booking?.location ?? null,
      };
      return <HoursForm timezone={me?.timezone ?? null} hours={hours} meetings={meetings} />;
    }
    if (step === "voice") {
      return (
        <VoiceForm fullName={me?.full_name ?? null} bio={me?.bio ?? null} />
      );
    }
    return <CtaForm cta={wizard.stash.cta} bookingUrl={me?.booking_url ?? null} />;
  }

  if (!workspaceId) return null;

  if (step === "strategy") {
    const businessId = await hasBusiness(workspaceId);
    const strategy = await readStrategyState(supabase, workspaceId, businessId);
    const cards = await strategyCards(workspaceId);
    const activity = await strategyActivity(workspaceId);
    if (cards.length === 0 && strategy.phase === "ready" && businessId) {
      // Written, and every one set aside: Sage can write new ones from what
      // the owner says, which used to be a ticket to us.
      return (
        <>
          {activity === "running" ? (
            <>
              <div className="notice" role="status">
                <p>Sage is writing new strategies from what you said. They appear here in a minute or two.</p>
              </div>
              <AutoRefresh seconds={10} />
            </>
          ) : (
            <div className="notice warning" role="status">
              <p>
                <strong>Every strategy has been set aside.</strong> Tell Sage who you sell to and it writes new ones.
              </p>
            </div>
          )}
          <RewriteStrategies />
        </>
      );
    }
    if (cards.length === 0) {
      // Waiting has an end. A run whose worker died left this page reloading
      // every ten seconds for ever with nothing to say.
      const waiting = (strategy.phase === "running" || strategy.phase === "ready") && activity !== "stalled";
      return (
        <>
          <StrategyStatus state={strategy} from="onboarding" />
          {strategy.phase === "failed" || strategy.phase === "absent" ? (
            <StrategyDetailsForm source={wizard.stash.source} from="onboarding" />
          ) : waiting ? (
            <p className="small muted">This page updates on its own when they are ready.</p>
          ) : (
            <div className="notice warning" role="status">
              <p>Sage has not finished after fifteen minutes. Start it again.</p>
              <StrategyRetryButton from="onboarding">Try again</StrategyRetryButton>
            </div>
          )}
          {waiting ? <AutoRefresh seconds={10} /> : null}
        </>
      );
    }
    return (
      <>
        {activity === "running" ? (
          <>
            <div className="notice" role="status">
              <p>Sage is writing new strategies from what you said. They appear here in a minute or two.</p>
            </div>
            <AutoRefresh seconds={10} />
          </>
        ) : activity === "stalled" || activity === "failed" ? (
          <div className="notice warning" role="status">
            <p>Sage could not write new strategies that time. Say who you sell to again and it will try once more.</p>
          </div>
        ) : null}
        <StrategyCards cards={cards} />
        {wizard.facts.hasApprovedStrategy ? <ContinueLink /> : null}
        {/* Always offered. Once one strategy was approved the form went away,
            and an owner whose approved strategies all failed to find anyone had
            no way to ask for different ones. */}
        <RewriteStrategies />
      </>
    );
  }

  if (step === "prospects") {
    // Every approved strategy that has no list yet, each with its own search
    // and its own last word. Only the newest approved one used to be offered,
    // so a customer with four approved strategies could only ever search one,
    // and the stop shown under it was whichever search stopped last anywhere.
    const [{ data: approvedRows }, { data: used }] = await Promise.all([
      supabase
        .from("customer_profiles")
        .select("id, name")
        .eq("workspace_id", workspaceId)
        .eq("do_not_pursue", false)
        .not("approved_at", "is", null)
        .order("priority"),
      supabase.from("campaigns").select("customer_profile_id").eq("workspace_id", workspaceId).neq("status", "archived"),
    ]);
    const approved = approvedRows ?? [];
    const taken = new Set((used ?? []).map((c) => c.customer_profile_id).filter(Boolean));
    const open = approved.filter((p) => !taken.has(p.id));
    const shown = open.length ? open : approved;
    const { data: events } = shown.length
      ? await supabase
          .from("events")
          .select("name, payload, created_at, subject_id")
          .eq("workspace_id", workspaceId)
          .in("name", ["targeting.queued", "targeting.stopped"])
          .in(
            "subject_id",
            shown.map((p) => p.id),
          )
          .order("created_at", { ascending: false })
          .limit(100)
      : { data: [] };
    const lastFor = new Map<string, NonNullable<typeof events>[number]>();
    for (const event of events ?? []) if (event.subject_id && !lastFor.has(event.subject_id)) lastFor.set(event.subject_id, event);

    const now = Date.now();
    const rows = shown.map((profile) => {
      const last = lastFor.get(profile.id) ?? null;
      const notice = describeLastSearch(last, now, { onboarding: true });
      const searching = last?.name === "targeting.queued" && now - new Date(last.created_at).getTime() < STALLED_MS;
      return { profile, notice, searching };
    });
    if (rows.length === 0) {
      return (
        <div className="notice warning" role="status">
          <p>No strategy is approved yet. Go back a step and approve one.</p>
        </div>
      );
    }
    return (
      <>
        {rows.map(({ profile, notice, searching }) => (
          <div key={profile.id} className="card stack-4">
            <p>
              <strong>{profile.name}</strong>
            </p>
            {notice ? (
              <div className={`notice ${notice.tone === "warning" ? "warning" : "accent"}`} role="status">
                <p>
                  <strong>{notice.title}</strong>
                </p>
                <p className="small">{searching ? "This page moves on by itself when the list is ready." : notice.body}</p>
              </div>
            ) : null}
            {searching ? null : (
              <SearchButton profileId={profile.id} label={notice ? "Search again" : "Search LinkedIn"} />
            )}
          </div>
        ))}
        {rows.some((r) => r.searching) ? <AutoRefresh seconds={8} /> : null}
        <p>
          <Link className="btn secondary" href="/onboarding?step=strategy">
            Approve another strategy
          </Link>
        </p>
      </>
    );
  }

  // launch
  // The campaign somebody pressed Launch on, when they came from its page;
  // otherwise the newest draft with people on it.
  const review = await launchReview(workspaceId, extra.campaignId ?? null);
  if (!review) {
    return (
      <div className="notice warning" role="status">
        <p>No campaign is waiting to launch. Go back a step and build your list.</p>
      </div>
    );
  }
  return (
    <LaunchPanel
      review={review}
      handling={wizard.stash.autonomy === "autonomous" ? "nora" : wizard.stash.autonomy === "supervised" ? "check" : null}
      canSetWorkspace={(AUTONOMY_ROLES as readonly string[]).includes(wizard.role ?? "")}
    />
  );
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

/** How long a Sage run may go unanswered before the page stops waiting for it. */
const STRATEGY_STALLED_MS = 15 * 60_000;

/**
 * What the newest strategy run is doing: still going, gone quiet, failed, or
 * nothing at all. A run is never waited on for ever.
 */
async function strategyActivity(workspaceId: string): Promise<"running" | "stalled" | "failed" | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("events")
    .select("name, created_at")
    .eq("workspace_id", workspaceId)
    .in("name", ["strategy.queued", "strategy.profile.created", "strategy.failed"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const age = Date.now() - new Date(data.created_at).getTime();
  if (data.name === "strategy.queued") return age < STRATEGY_STALLED_MS ? "running" : "stalled";
  if (data.name === "strategy.failed") return age < 24 * 60 * 60_000 ? "failed" : null;
  return null;
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
async function launchReview(workspaceId: string, preferredId: string | null = null): Promise<LaunchReview | null> {
  const supabase = await createClient();
  const { data: drafts } = await supabase
    .from("campaigns")
    .select("id, name, daily_invite_cap, cta_kind, linkedin_account_id, owner_user_id")
    .eq("workspace_id", workspaceId)
    .eq("status", "draft")
    .is("launched_at", null)
    .order("created_at", { ascending: false })
    .limit(10);
  // The newest draft with somebody on it: the step is only reached once one
  // exists, and an empty draft beside it is a search that is still building.
  const { data: peopled } = drafts?.length
    ? await supabase
        .from("campaign_prospects")
        .select("campaign_id")
        .eq("workspace_id", workspaceId)
        .eq("status", "queued")
        .in(
          "campaign_id",
          drafts.map((d) => d.id),
        )
        .limit(1000)
    : { data: [] };
  const withPeople = new Set((peopled ?? []).map((row) => row.campaign_id));
  const campaign =
    (drafts ?? []).find((d) => d.id === preferredId && withPeople.has(d.id)) ??
    (drafts ?? []).find((d) => withPeople.has(d.id)) ??
    null;
  if (!campaign) return null;

  const [state, { data: queued }, { data: steps }, { data: held }, { data: variants }, { data: account }, { data: owner }] = await Promise.all([
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
    // Which angle each queued person holds, so the sequence shown is the one
    // most of them receive (rule 28).
    supabase
      .from("campaign_prospects")
      .select("variant_id")
      .eq("campaign_id", campaign.id)
      .eq("status", "queued")
      .order("created_at")
      .limit(5000),
    supabase.from("campaign_variants").select("id, name").eq("campaign_id", campaign.id),
    supabase
      .from("linkedin_accounts")
      .select("id, has_premium, has_sales_navigator, notes_exhausted_month")
      .eq("id", campaign.linkedin_account_id)
      .maybeSingle(),
    supabase.from("profiles").select("timezone").eq("id", campaign.owner_user_id).maybeSingle(),
  ]);
  const ids = (queued ?? []).map((row) => row.prospect_id);
  const { data: people } = ids.length
    ? await supabase.from("prospects").select("id, first_name, last_name, title, company").in("id", ids)
    : { data: [] };
  const byId = new Map((people ?? []).map((p) => [p.id, p]));

  // The sequence of the angle most of the list holds, by the send path's own
  // rule. The campaign-wide steps used to be shown, and with every prospect on
  // an angle that owns its sequence (rule 28) they reach nobody.
  const angle = mostHeldAngle((held ?? []).map((row) => row.variant_id));
  const sequence = angleSequence(steps ?? [], angle.variantId).slice(0, 3);
  const angleName = angle.variantId ? ((variants ?? []).find((v) => v.id === angle.variantId)?.name ?? null) : null;
  // The same count the campaign page shows and the send path decides from
  // (rule 62). Null on a paid plan.
  const notesLeft = account ? await notesLeftThisMonth(supabase, account, owner?.timezone ?? "UTC") : null;

  const kind = (campaign.cta_kind ?? "meeting") as keyof typeof CTA_DEFINITIONS;
  return {
    lines: await linesAwaitingApproval(workspaceId),
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
    angle: angle.variantId ? { name: angleName, holders: angle.holders, angles: angle.angles } : null,
    notesLeft,
    blockers: state ? launchBlockers(state) : ["That campaign could not be read."],
  };
}

/**
 * The opener and the offer Sage seeded on the workspace's agent, if nobody has
 * approved them yet — the newest of each.
 *
 * They are what the invitation writer leans on and what a prospect hears when
 * they ask what this is, and they arrive unapproved because an approval is a
 * person reading those exact words (rule 40). Nothing in setup showed them, so
 * every workspace finished onboarding into "an offer and an opener are waiting
 * for you". Shown here, they are read on the screen that launches, and the
 * launch approves the words that were on it.
 */
async function linesAwaitingApproval(workspaceId: string): Promise<LaunchReview["lines"]> {
  const supabase = await createClient();
  const { data: agent } = await supabase
    .from("agents")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("is_default", true)
    .is("archived_at", null)
    .limit(1)
    .maybeSingle();
  if (!agent) return [];
  const [{ data: hook }, { data: pitch }] = await Promise.all([
    supabase
      .from("hooks")
      .select("id, body")
      .eq("workspace_id", workspaceId)
      .eq("agent_id", agent.id)
      .is("approved_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("pitches")
      .select("id, body")
      .eq("workspace_id", workspaceId)
      .eq("agent_id", agent.id)
      .is("approved_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const lines: LaunchReview["lines"] = [];
  if (hook?.body?.trim()) lines.push({ table: "hooks", id: hook.id, body: hook.body, title: "How the invitations open" });
  if (pitch?.body?.trim()) {
    lines.push({ table: "pitches", id: pitch.id, body: pitch.body, title: "What it says when somebody asks what this is" });
  }
  return lines;
}
