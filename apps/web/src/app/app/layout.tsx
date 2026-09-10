import Link from "next/link";
import { requireSession } from "@/lib/workspace";
import { createClient } from "@/lib/supabase-server";
import { entitlementFor, entitlementMessage } from "@le/billing";

const NAV = [
  { href: "/app", label: "Overview" },
  { href: "/app/strategy", label: "Strategy" },
  { href: "/app/prospects", label: "Prospects" },
  { href: "/app/campaigns", label: "Campaigns" },
  { href: "/app/inbox", label: "Inbox" },
  { href: "/app/meetings", label: "Meetings" },
  { href: "/app/reporting", label: "Reporting" },
  { href: "/app/knowledge", label: "Knowledge" },
  { href: "/app/exclusions", label: "Exclusions" },
  { href: "/app/team", label: "Team" },
  { href: "/app/usage", label: "Usage" },
  { href: "/app/billing", label: "Billing" },
];

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

  return (
    <div className="app">
      <aside className="app-aside">
        <div className="stack-2">
          <Link href="/app" style={{ fontWeight: 600 }}>
            LinkedIn&nbsp;Employee
          </Link>
          <p className="tiny subtle">{session.workspaceName}</p>
        </div>

        <nav className="nav">
          {NAV.map((item) => (
            <Link key={item.href} href={item.href}>
              {item.label}
              {item.href === "/app/inbox" && waiting ? (
                <span className="nav-count">{waiting}</span>
              ) : null}
            </Link>
          ))}
        </nav>
      </aside>

      <div className="app-main">
        {billingMessage || (account && account.status !== "active") ? (
          <div className="stack-3" style={{ padding: "var(--space-4) var(--space-5) 0" }}>
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
