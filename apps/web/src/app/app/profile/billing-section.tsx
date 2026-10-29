import { entitlementFor, type Entitlement } from "@le/billing";
import { readTrialEnforced } from "@/lib/entitlement";
import { Panel, Section } from "@/components/page";
import { requireSession } from "@/lib/workspace";
import { createClient } from "@/lib/supabase-server";
import { PLANS, PLAN_FEATURES, chargesOnChoosing, yearlyPerMonth, yearlySaving } from "@/lib/plans";

/**
 * The workspace's plan, and its data.
 *
 * A workspace from before pricing is on the free plan for good, and this says
 * so and offers nothing to buy. A trial is fourteen days of Autopilot with no
 * card, and the plans can be chosen any time during it; the charge starts when
 * the trial ends. A paid plan is managed on Stripe's own page.
 */
export async function BillingSection({ checkout }: { checkout?: string } = {}) {
  const session = await requireSession();
  const supabase = await createClient();

  const { data: workspace } = await supabase
    .from("workspaces")
    .select("plan, trial_ends_at, subscription_status, seats, billing_interval, current_period_end, cancel_at_period_end, stripe_customer_id")
    .eq("id", session.workspaceId)
    .single();

  const entitlement = entitlementFor({
    plan: (workspace?.plan ?? "trial") as never,
    trialEndsAt: workspace?.trial_ends_at ?? null,
    subscriptionStatus: workspace?.subscription_status ?? null,
    seats: workspace?.seats ?? 1,
  }, new Date(), { enforceTrial: await readTrialEnforced(supabase) });

  const isAdmin = ["owner", "admin"].includes(session.role);
  // Back from checkout before Stripe's webhook has reached the worker: the
  // row still reads as a trial, and the chooser beneath this would ask them
  // to pay again. Said plainly, so a minute's wait is not read as a failure.
  const subscriptionLanded = ["active", "trialing", "past_due"].includes(workspace?.subscription_status ?? "");
  const awaitingWebhook = checkout === "success" && !subscriptionLanded;

  return (
    <>
      <Section
        id="plan"
        title="Plan"
        description="Both plans send the same amount on the same safe limits. What changes is how much Nora does on its own."
      >
        {awaitingWebhook ? (
          <div className="notice accent" role="status">
            <p>Payment details received. Your plan switches on within a minute.</p>
          </div>
        ) : null}
        {/* A stop or a failed card is said once, by the banner at the top of
            every page (PlanBanner); repeating it here put the same sentence
            on the screen twice. */}
        <PlanState
          entitlement={entitlement}
          plan={workspace?.plan ?? "trial"}
          interval={workspace?.billing_interval ?? null}
          periodEnd={workspace?.current_period_end ?? null}
          ending={Boolean(workspace?.cancel_at_period_end)}
          trialEndsAt={workspace?.trial_ends_at ?? null}
          trialing={workspace?.subscription_status === "trialing"}
        />
        {isAdmin && workspace?.stripe_customer_id ? (
          <form action="/app/billing/portal" method="post" className="profile-form-foot">
            <button className="btn secondary" type="submit">
              Manage billing, card and invoices
            </button>
          </form>
        ) : null}
        {!awaitingWebhook &&
        entitlement.reason !== "free_plan" &&
        entitlement.reason !== "active_subscription" &&
        entitlement.reason !== "payment_failed" &&
        // An unpaid subscription still exists in Stripe: paying it from the
        // portal is the fix, and a new checkout beside it would bill twice.
        !(workspace?.subscription_status === "unpaid" && workspace?.stripe_customer_id) ? (
          isAdmin ? (
            <PlanChooser />
          ) : (
            <p className="small muted">An owner or admin of this workspace can choose the plan.</p>
          )
        ) : null}
      </Section>

      {/*
        The export only. The price card said "free for everyone" and nothing a
        person could act on, so it went; the notice above still appears for a
        workspace whose sending is genuinely stopped.
      */}
      <Section id="data" title="Your data" description="Everything in this workspace, as one file you can take with you.">
        <Panel className="profile-card">
          {/*
            A link, not a form: the answer is a download, and a server action can
            only redirect or re-render. Owners and admins only, because the file
            holds other people's personal data in bulk. No `download` attribute:
            the response says attachment itself, and a failure comes back as a
            redirect to this page with the reason, which `download` would have
            saved to disk as if it were the export.
          */}
          {["owner", "admin"].includes(session.role) ? (
            <>
              <div className="profile-row">
                <div>
                  <p><strong>Download</strong></p>
                  <p className="small muted">
                    Every prospect, conversation, message, meeting and campaign, as one JSON file.
                  </p>
                </div>
                <a className="btn secondary" href="/app/export">
                  Download workspace export
                </a>
              </div>
              {/*
                A plain form post to a route, not a server action: an action's
                body is capped at a megabyte and its id changes every deploy.
                Configuration and the do-not-contact list only — never anybody's
                prospects or conversations — and everything a person approves
                arrives unapproved.
              */}
              <form action="/app/import" method="post" encType="multipart/form-data" className="profile-form profile-divided">
                <label className="field">
                  <span>Import an export file</span>
                  <input id="import-file" name="file" type="file" accept="application/json,.json" required />
                  <span className="hint">
                    Brings in agents, knowledge, calls to action, pitches, openers and strategies, plus everyone on
                    the exclusion list or already contacted. Prospects, campaigns, conversations and team members are
                    not imported, and strategies, pitches and openers arrive unapproved so you can check them first.
                    Up to 5 MB.
                  </span>
                </label>
                <div className="profile-form-foot">
                  <button className="btn secondary" type="submit">
                    Import
                  </button>
                </div>
              </form>
            </>
          ) : (
            <p className="small muted">
              Every prospect, conversation, message, meeting and campaign, as one JSON file. An owner or an admin can
              download it.
            </p>
          )}
        </Panel>
      </Section>
    </>
  );
}

/** Where the workspace stands, in one sentence. */
function PlanState({
  entitlement,
  plan,
  interval,
  periodEnd,
  ending,
  trialEndsAt,
  trialing,
}: {
  entitlement: Entitlement;
  plan: string;
  interval: string | null;
  periodEnd: string | null;
  ending: boolean;
  trialEndsAt: string | null;
  /** Chose a plan during the trial: the first charge is still to come. */
  trialing: boolean;
}) {
  const name = PLANS.find((p) => p.key === (plan === "autopilot" ? "autopilot" : "pro"))?.name ?? "Nora Pro";
  const date = periodEnd
    ? new Date(periodEnd).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
    : null;
  switch (entitlement.reason) {
    case "free_plan":
      return (
        <div className="notice accent" role="status">
          <p>
            <strong>Free, for good.</strong> This workspace joined while Nora was free, so it keeps every feature at
            no cost. There is nothing to choose.
          </p>
        </div>
      );
    case "trial_active":
    case "trial_unlimited":
      return (
        <div className="notice" role="status">
          <p>
            <strong>
              {entitlement.trialDaysLeft === null
                ? "You are on a free trial of Nora Autopilot."
                : `${entitlement.trialDaysLeft === 0 ? "Less than a day" : `${entitlement.trialDaysLeft} day${entitlement.trialDaysLeft === 1 ? "" : "s"}`} left in your free trial of Nora Autopilot.`}
            </strong>{" "}
            {chargesOnChoosing(trialEndsAt)
              ? "Choose a plan any time. This close to the end of the trial, billing starts the day you choose."
              : "Choose a plan any time. You are not charged until the trial ends."}
          </p>
        </div>
      );
    case "active_subscription":
    case "payment_failed":
      return (
        <p>
          You are on <strong>{name}</strong>
          {interval ? `, billed ${interval === "year" ? "yearly" : "monthly"}` : ""}.
          {date ? (ending ? ` It ends on ${date}.` : trialing ? ` Your first charge is on ${date}.` : ` It renews on ${date}.`) : ""}
        </p>
      );
    default:
      return null;
  }
}

/**
 * The two plans, monthly or yearly, as one form.
 *
 * One form with two buttons rather than four links, so the period is chosen
 * once and the plan by the button pressed. No script: it posts to the route
 * that opens Stripe's checkout.
 */
function PlanChooser() {
  return (
    <form action="/app/billing/checkout" method="post" className="stack-4">
      <fieldset className="plan-period">
        <legend className="small strongish">Pay</legend>
        <label>
          <input type="radio" name="interval" value="month" defaultChecked /> Monthly
        </label>
        <label>
          <input type="radio" name="interval" value="year" /> Yearly{" "}
          <span className="pill tiny positive">2 months free</span>
        </label>
      </fieldset>
      <div className="plan-cards">
        {PLANS.map((plan) => (
          <div key={plan.key} className={`card plan-card${plan.key === "autopilot" ? " is-featured" : ""}`}>
            <p className="plan-card-name">{plan.name}</p>
            <p className="plan-card-price">
              <span className="nums">${plan.monthly}</span>
              <span className="small muted"> a month</span>
            </p>
            <p className="tiny subtle">
              Or ${plan.yearly.toLocaleString("en-US")} a year (about ${yearlyPerMonth(plan)} a month, ${yearlySaving(plan)} saved)
            </p>
            <p className="small">{plan.bestFor}.</p>
            <ul className="plan-card-list small">
              {PLAN_FEATURES.filter((f) => f.pro !== f.autopilot).map((feature) => {
                const value = feature[plan.key];
                return (
                  <li key={feature.label} className={value === false ? "is-missing" : undefined}>
                    {feature.label}
                    {typeof value === "string" ? `: ${value.toLowerCase()}` : value === false ? " (Autopilot only)" : ""}
                  </li>
                );
              })}
            </ul>
            <button className={`btn${plan.key === "autopilot" ? "" : " secondary"}`} type="submit" name="plan" value={plan.key}>
              Choose {plan.name}
            </button>
          </div>
        ))}
      </div>
    </form>
  );
}

