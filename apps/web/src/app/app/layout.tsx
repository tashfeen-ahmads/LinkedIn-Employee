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

  /*
   * Grouped by what a person is doing, not by what the tables are called.
   *
   * Twelve flat links meant every screen had the same weight: the inbox a rep
   * opens hourly sat beside the billing page they touch twice a year. The
   * groups are the map now — four headings to read instead of twelve links,
   * and everything but the daily loop folds away.
   *
   * Work is `alwaysOpen`: a remembered collapse that hides the Inbox is a rep
   * who stops opening the Inbox.
   */
  return [
    {
      label: "Work",
      alwaysOpen: true,
      items: [
        { href: "/app", label: "Overview" },
        { href: "/app/inbox", label: "Inbox", count: waiting },
        { href: "/app/meetings", label: "Meetings" },
      ],
    },
    {
      // The pipeline, in the order it happens: a strategy finds prospects, and
      // prospects go into a campaign. Three screens that were three lists.
      label: "Pipeline",
      items: [
        { href: "/app/strategy", label: "Strategies", ...next("/app/strategy", "Strategies") },
        { href: "/app/prospects", label: "Prospects" },
        { href: "/app/campaigns", label: "Campaigns", ...next("/app/campaigns", "Campaigns") },
        // The other half of the pipeline. A prospect who replies is answered
        // from this page and nothing else, so filed under Settings between
        // "Do not contact" and "Billing" it read as a preference nobody had to
        // set — and an empty knowledge base sends every product question to a
        // human, which is most of what a prospect asks.
        { href: "/app/knowledge", label: "Knowledge base", ...next("/app/knowledge", "Knowledge base") },
        // The offer itself. It sits after the knowledge base because it is
        // written from it, and before nothing, because the pitch is the last
        // piece of copy anybody writes and the first one a prospect judges.
        { href: "/app/pitch", label: "Opener & pitch" },
      ],
    },
    {
      // One analytics destination. Reporting and the dashboard's KPI block were
      // two readings of the same numbers, and two readings drift.
      label: "Analytics",
      items: [
        { href: "/app/analytics", label: "Results" },
        { href: "/app/usage", label: "Agent spend" },
      ],
    },
    {
      label: "Settings",
      items: [
        { href: "/app/profile", label: "Your profile", ...next("/app/profile", "Your profile") },
        {
          href: "/app/team",
          label: "Team",
          ...next("/app/team", "Team"),
        },
        { href: "/app/cta", label: "Calls to action" },
        { href: "/app/exclusions", label: "Do not contact" },
        { href: "/app/billing", label: "Billing" },
      ],
    },
    {
      label: "Help",
      items: [
        { href: "/app/tutorial", label: "How it works" },
        { href: "/app/system", label: "System check" },
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
                  {/*
                    Profile, not Team, and the difference is the whole bug.
                    `connectLinkedIn` lives on `/app/profile` and nowhere else;
                    `/app/team` is who can sign in to the workspace and has no
                    connect control on it at all — its own lede says "each rep
                    connects their own LinkedIn account on their own profile".
                    So the one banner telling somebody their account cannot send
                    sent them to a page with nothing to press, every time, and
                    the product looked like it had no way to reconnect.
                  */}
                  <Link href="/app/profile">Reconnect on your profile</Link>
                </p>
              </div>
            ) : null}
          </div>
        ) : null}

        <main className="app-body">{children}</main>
      </div>
    </div>
  );
}
