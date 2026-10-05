import { entitlementFor, entitlementMessage, trialLimitEnforced } from "@le/billing";
import { Panel, Section } from "@/components/page";
import { requireSession } from "@/lib/workspace";
import { createClient } from "@/lib/supabase-server";
import { PageNotice, type NoticeParams } from "@/components/page-notice";
import { NORA } from "@/lib/team";

/**
 * What this workspace costs, which right now is nothing.
 *
 * The product is free for everyone while it is being built in the open, so the
 * three price cards and the checkout buttons are gone from the screen. Only
 * what people see changed: the entitlement rules in `@le/billing` still run,
 * and a workspace whose sending is genuinely stopped — a cancelled or unpaid
 * subscription from before — still gets the notice saying so, because hiding a
 * real stop behind "it's free" is a screen that lies in the comforting
 * direction.
 */
export async function BillingSection({ searchParams }: { searchParams: NoticeParams }) {
  const params = await searchParams;
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
      <PageNotice error={params.error} notice={params.notice} />

      {message ? (
        <div className={`notice ${entitlement.canSend ? "warning" : "danger"}`}>{message}</div>
      ) : null}

      {/*
        One section: what it costs, and the file you can take with you. They
        were the plan, three price cards and the export; with no plan to choose
        the cards have nothing to say, and the export is still the promise that
        matters.
      */}
      <Section id="plan" title="Price" description="What this workspace costs, and what you can take with you.">
        <Panel>
          <p className="strongish">
            {NORA} is free for now — for everyone.
          </p>
          <p className="small muted prose">
            No plan to choose and no card on file. Every workspace gets {NORA} and the whole team.
            If that ever changes, you will hear it from us well before it does.
          </p>

          <hr className="divider" />
          <h3>Export everything</h3>
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
        </Panel>
      </Section>
    </>
  );
}
