import { entitlementFor, entitlementMessage, trialLimitEnforced } from "@le/billing";
import { Panel, Section } from "@/components/page";
import { requireSession } from "@/lib/workspace";
import { createClient } from "@/lib/supabase-server";

/**
 * The workspace's data, and whether it can send.
 *
 * The product is free for everyone while it is being built in the open, so
 * there is no price on this screen at all. Only
 * what people see changed: the entitlement rules in `@le/billing` still run,
 * and a workspace whose sending is genuinely stopped — a cancelled or unpaid
 * subscription from before — still gets the notice saying so, because hiding a
 * real stop behind "it's free" is a screen that lies in the comforting
 * direction.
 */
export async function BillingSection() {
  const session = await requireSession();
  const supabase = await createClient();

  const { data: workspace } = await supabase
    .from("workspaces")
    .select("plan, trial_ends_at, subscription_status, seats")
    .eq("id", session.workspaceId)
    .single();

  const entitlement = entitlementFor({
    plan: (workspace?.plan ?? "trial") as never,
    trialEndsAt: workspace?.trial_ends_at ?? null,
    subscriptionStatus: workspace?.subscription_status ?? null,
    seats: workspace?.seats ?? 1,
  }, new Date(), { enforceTrial: trialLimitEnforced(process.env.TRIAL_LIMIT_ENFORCED) });
  const message = entitlementMessage(entitlement);

  return (
    <>
      {message ? (
        <div className={`notice ${entitlement.canSend ? "warning" : "danger"}`}>{message}</div>
      ) : null}

      {/*
        The export only. The price card said "free for everyone" and nothing a
        person could act on, so it went; the notice above still appears for a
        workspace whose sending is genuinely stopped.
      */}
      <Section id="plan" title="Your data" description="Everything in this workspace, as one file you can take with you.">
        <Panel>
          <p className="small muted">
            Every prospect, conversation, message, meeting and campaign, as one JSON file.
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
        </Panel>
      </Section>
    </>
  );
}
