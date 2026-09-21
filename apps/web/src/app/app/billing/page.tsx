import { entitlementFor, entitlementMessage } from "@le/billing";
import { PageHeader } from "@/components/page";
import { requireSession } from "@/lib/workspace";
import { createClient } from "@/lib/supabase-server";
import { callWorker, errorQuery } from "@/lib/worker";
import { redirect } from "next/navigation";
import { PageNotice, type NoticeParams } from "@/components/page-notice";

const PLANS = [
  { id: "solo" as const, name: "Solo", price: "$149", blurb: "One seat, replies drafted for your approval." },
  { id: "pro" as const, name: "Pro", price: "$249", blurb: "Autopilot replies, intent signals, native CRM." },
  { id: "teams" as const, name: "Teams", price: "$199", blurb: "Three seats or more, shared exclusions, reporting." },
];

async function startCheckout(formData: FormData) {
  "use server";
  const plan = String(formData.get("plan"));
  if (!["solo", "pro", "teams"].includes(plan)) return;

  const session = await requireSession();
  const result = await callWorker<{ url?: string }>("/jobs/checkout", {
    workspaceId: session.workspaceId,
    userId: session.userId,
    plan,
    seats: Number(formData.get("seats") ?? 1),
    email: session.email || undefined,
  });
  if (!result.ok) redirect(errorQuery("/app/billing", result.error));
  if (!result.data?.url) {
    redirect(errorQuery("/app/billing", "Checkout is not available right now. Please try again."));
  }
  redirect(result.data.url);
}

export default async function BillingPage({ searchParams }: { searchParams: NoticeParams }) {
  const params = await searchParams;
  const session = await requireSession();
  const supabase = await createClient();

  const { data: workspace } = await supabase
    .from("workspaces")
    .select("plan, trial_ends_at, subscription_status, seats, current_period_end")
    .eq("id", session.workspaceId)
    .single();

  const entitlement = entitlementFor({
    plan: (workspace?.plan ?? "trial") as never,
    trialEndsAt: workspace?.trial_ends_at ?? null,
    subscriptionStatus: workspace?.subscription_status ?? null,
    seats: workspace?.seats ?? 1,
  });
  const message = entitlementMessage(entitlement);

  return (
    <>
      <PageNotice error={params.error} notice={params.notice} />
      <PageHeader
        eyebrow="Settings"
        title="Billing"
        lede="Your plan, your seats, and everything this workspace holds if you want it back."
      />

      {message ? (
        <div className={`notice ${entitlement.canSend ? "warning" : "danger"}`}>
          {message}
        </div>
      ) : entitlement.reason === "trial_active" ? (
        <div className="notice">
          {entitlement.trialDaysLeft === 0
            ? "Your trial ends today."
            : `${entitlement.trialDaysLeft} ${entitlement.trialDaysLeft === 1 ? "day" : "days"} left in your trial.`}{" "}
          Campaigns keep running while it lasts.
        </div>
      ) : null}

      <section className="card">
        <h3>Current plan</h3>
        <p className="small muted">
          {workspace?.plan ?? "trial"}
          {workspace?.subscription_status ? ` · ${workspace.subscription_status}` : ""}
          {workspace?.seats ? ` · ${workspace.seats} ${workspace.seats === 1 ? "seat" : "seats"}` : ""}
          {workspace?.current_period_end
            ? ` · renews ${new Date(workspace.current_period_end).toLocaleDateString()}`
            : ""}
        </p>
      </section>

      <section className="grid grid-2"
      >
        {PLANS.map((plan) => (
          <article key={plan.id} className="card">
            <h3>{plan.name}</h3>
            <p className="stat-value">
              {plan.price}
              <span className="muted small">
                {" "}
                / seat / mo
              </span>
            </p>
            <p className="small muted">{plan.blurb}</p>
            <form action={startCheckout}>
              <input type="hidden" name="plan" value={plan.id} />
              <input type="hidden" name="seats" value={Math.max(1, workspace?.seats ?? 1)} />
              <button className="btn secondary small" type="submit">
                Choose {plan.name}
              </button>
            </form>
          </article>
        ))}
      </section>

      <section className="card">
        <h2>Export everything</h2>
        <p className="small muted">
          Every prospect, conversation, message, meeting and campaign in this workspace, as one JSON
          file. This is what answers a subject-access request, and it is here rather than behind a
          support email because a promise only we can keep is not a promise you have.
        </p>
        {/*
          A link, not a form: the answer is a download, and a server action can
          only redirect or re-render. Owners and admins only — the file holds
          other people's personal data in bulk.
        */}
        {["owner", "admin"].includes(session.role) ? (
          <p>
            <a className="btn secondary small" href="/app/export" download>
              Download workspace export
            </a>
          </p>
        ) : (
          <p className="tiny subtle">An owner or an admin can download this.</p>
        )}
      </section>

      <p className="small muted">
        Cancelling stops outreach. Your prospects, conversations and booked meetings stay readable and
        exportable — we do not hold your record of what was said hostage.
      </p>
    </>
  );
}
