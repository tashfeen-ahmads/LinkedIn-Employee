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
            only redirect or re-render. Owners and admins only, because the file
            holds other people's personal data in bulk. No `download` attribute:
            the response says attachment itself, and a failure comes back as a
            redirect to this page with the reason, which `download` would have
            saved to disk as if it were the export.
          */}
          {["owner", "admin"].includes(session.role) ? (
            <>
              <p>
                <a className="btn secondary small" href="/app/export">
                  Download workspace export
                </a>
              </p>
              {/*
                A plain form post to a route, not a server action: an action's
                body is capped at a megabyte and its id changes every deploy.
                Configuration and the do-not-contact list only — never anybody's
                prospects or conversations — and everything a person approves
                arrives unapproved.
              */}
              <form action="/app/import" method="post" encType="multipart/form-data">
                <p className="small muted">
                  Import an export file into this workspace: agents, knowledge, calls to action, pitches,
                  openers and strategies, plus everyone on its exclusion list or already contacted. Prospects,
                  campaigns, conversations and team members are not imported, and strategies, pitches and
                  openers arrive unapproved so you can check them first. Up to 5 MB.
                </p>
                <div className="row">
                  <label className="sr-only" htmlFor="import-file">
                    Export file
                  </label>
                  <input id="import-file" name="file" type="file" accept="application/json,.json" required />
                  <button className="btn secondary small" type="submit">
                    Import
                  </button>
                </div>
              </form>
            </>
          ) : (
            <p className="tiny subtle">An owner or an admin can download this.</p>
          )}
        </Panel>
      </Section>
    </>
  );
}
