import { entitlementFor, entitlementMessage } from "@le/billing";
import { requireSession } from "@/lib/workspace";
import { createClient } from "@/lib/supabase-server";
import { callWorker } from "@/lib/worker";
import { redirect } from "next/navigation";

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
  if (result?.url) redirect(result.url);
}

export default async function BillingPage() {
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
      <h1 style={{ fontSize: "1.6rem" }}>Billing</h1>

      {message ? (
        <div className={`notice ${entitlement.canSend ? "warning" : "danger"}`} style={{ marginBottom: "1.5rem" }}>
          {message}
        </div>
      ) : entitlement.reason === "trial_active" ? (
        <div className="notice" style={{ marginBottom: "1.5rem" }}>
          {entitlement.trialDaysLeft === 0
            ? "Your trial ends today."
            : `${entitlement.trialDaysLeft} ${entitlement.trialDaysLeft === 1 ? "day" : "days"} left in your trial.`}{" "}
          Campaigns keep running while it lasts.
        </div>
      ) : null}

      <section className="card" style={{ marginBottom: "2rem" }}>
        <h3>Current plan</h3>
        <p className="small muted" style={{ margin: 0 }}>
          {workspace?.plan ?? "trial"}
          {workspace?.subscription_status ? ` · ${workspace.subscription_status}` : ""}
          {workspace?.seats ? ` · ${workspace.seats} ${workspace.seats === 1 ? "seat" : "seats"}` : ""}
          {workspace?.current_period_end
            ? ` · renews ${new Date(workspace.current_period_end).toLocaleDateString()}`
            : ""}
        </p>
      </section>

      <section
        style={{ display: "grid", gap: "1rem", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}
      >
        {PLANS.map((plan) => (
          <article key={plan.id} className="card">
            <h3 style={{ margin: 0 }}>{plan.name}</h3>
            <p style={{ fontSize: "1.7rem", fontWeight: 640, margin: "0.4rem 0 0.2rem" }}>
              {plan.price}
              <span className="muted" style={{ fontSize: "0.9rem", fontWeight: 400 }}>
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

      <p className="small muted" style={{ marginTop: "1.5rem" }}>
        Cancelling stops outreach. Your prospects, conversations and booked meetings stay readable and
        exportable — we do not hold your record of what was said hostage.
      </p>
    </>
  );
}
