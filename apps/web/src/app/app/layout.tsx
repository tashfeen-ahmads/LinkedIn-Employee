import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/workspace";
import { createClient } from "@/lib/supabase-server";
import { AppNav, type NavGroup } from "@/components/app-nav";
import { readSetupState } from "@/lib/setup-state";
import { markFor, type NavMarks } from "@/lib/nav-marks";
import { entitlementFor, entitlementMessage } from "@le/billing";

/**
 * Twelve links in one flat list is a list you read rather than a nav you use.
 * Grouped by what the rep is doing: the daily loop first, then the things that
 * shape it, then the account.
 */
function navGroups(waiting: number, marks: NavMarks): NavGroup[] {
  // One mark, decided in one place (`markFor`) so the rule is testable rather
  // than a convention three call sites happen to keep.
  const next = (href: string, label: string) => markFor(href, label, marks);

  return [
    {
      label: "Daily",
      items: [
        { href: "/app", label: "Overview" },
        { href: "/app/inbox", label: "Inbox", count: waiting },
        { href: "/app/meetings", label: "Meetings" },
      ],
    },
    {
      label: "Outreach",
      items: [
        { href: "/app/strategy", label: "Strategy", ...next("/app/strategy", "Strategy") },
        { href: "/app/prospects", label: "Prospects" },
        { href: "/app/campaigns", label: "Campaigns", ...next("/app/campaigns", "Campaigns") },
        { href: "/app/knowledge", label: "Knowledge", ...next("/app/knowledge", "Knowledge") },
        { href: "/app/exclusions", label: "Exclusions" },
      ],
    },
    {
      label: "Account",
      items: [
        { href: "/app/reporting", label: "Reporting" },
        { href: "/app/usage", label: "Usage" },
        // Named rather than left to be discovered. Nothing this product does
        // reaches anybody until LinkedIn is connected, and "Team" is not a word
        // that tells a newcomer that is where it happens.
        { href: "/app/team", label: "Team", ...next("/app/team", "Team") },
        { href: "/app/system", label: "System check" },
        { href: "/app/billing", label: "Billing" },
        // Read before asking, and asked after reading. Both live at the end of
        // the sidebar, in the same place on every screen: somebody who cannot
        // make the product work is the one person who will not go hunting for
        // a link to say so.
        { href: "/app/tutorial", label: "How it works" },
        { href: "/app/support", label: "Support" },
      ],
    },
  ];
}

/**
 * There was no way to sign out of this application at all. On a shared or
 * borrowed machine that is not an inconvenience, it is the session staying open
 * for whoever sits down next — and this one can message a rep's real contacts.
 */
async function signOut() {
  "use server";
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const supabase = await createClient();

  // The inbox count is the number that decides whether a rep opens the app, so
  // it lives in the nav rather than behind a click.
  const { count: waiting } = await supabase
    .from("reply_drafts")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", session.workspaceId)
    .eq("status", "pending");

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
  });
  const billingMessage = entitlementMessage(entitlement);

  const { data: account } = await supabase
    .from("linkedin_accounts")
    .select("status, status_detail")
    .eq("workspace_id", session.workspaceId)
    .eq("user_id", session.userId)
    .maybeSingle();

  // Where this workspace has got to, read once here and handed to the nav. The
  // dashboard reads the same function, so the sidebar and the page can never
  // disagree about which step somebody is on.
  const { next } = await readSetupState(supabase, session.workspaceId);
  const linkedInNeedsYou = !account || account.status !== "active";

  return (
    <div className="app">
      <aside className="app-aside">
        <div className="app-brand">
          <Link href="/app">LinkedIn&nbsp;Employee</Link>
          <p className="tiny subtle">{session.workspaceName}</p>
        </div>

        <AppNav
          groups={navGroups(waiting ?? 0, {
            nextHref: next?.href ?? null,
            linkedInNeedsYou,
          })}
        />

        <div className="app-account">
          <div className="app-account-who">
            <p className="small">{session.fullName ?? session.email}</p>
            <p className="tiny subtle">
              {session.fullName ? session.email : session.role}
            </p>
          </div>
          <form action={signOut}>
            <button className="btn ghost small" type="submit">
              Sign out
            </button>
          </form>
        </div>
      </aside>

      <div className="app-main">
        {billingMessage || (account && account.status !== "active") ? (
          <div className="app-banners">
            {billingMessage ? (
              <div className={`notice ${entitlement.canSend ? "warning" : "danger"}`}>
                <p>
                  {billingMessage} <Link href="/app/billing">Billing</Link>
                </p>
              </div>
            ) : null}
            {account && account.status !== "active" ? (
              <div className={`notice ${account.status === "restricted" ? "danger" : "warning"}`}>
                <p>
                  <strong>LinkedIn account {account.status.replaceAll("_", " ")}.</strong>{" "}
                  {account.status_detail ?? "Sending is paused until this is resolved."}{" "}
                  <Link href="/app/team">Reconnect</Link>
                </p>
              </div>
            ) : null}
          </div>
        ) : null}

        <main className="app-body stack-6">{children}</main>
      </div>
    </div>
  );
}
