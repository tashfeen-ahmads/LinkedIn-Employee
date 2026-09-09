import Link from "next/link";
import { requireSession } from "@/lib/workspace";
import { createClient } from "@/lib/supabase-server";
import { entitlementFor, entitlementMessage } from "@le/billing";

const NAV = [
  { href: "/app", label: "Overview" },
  { href: "/app/prospects", label: "Prospects" },
  { href: "/app/campaigns", label: "Campaigns" },
  { href: "/app/inbox", label: "Inbox" },
  { href: "/app/meetings", label: "Meetings" },
  { href: "/app/reporting", label: "Reporting" },
  { href: "/app/exclusions", label: "Exclusions" },
  { href: "/app/team", label: "Team" },
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
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <aside
        style={{
          width: 220,
          borderRight: "1px solid var(--border)",
          padding: "1.25rem 1rem",
          background: "var(--surface)",
          flexShrink: 0,
        }}
      >
        <Link href="/app" style={{ fontWeight: 640, fontSize: "0.95rem" }}>
          LinkedIn&nbsp;Employee
        </Link>
        <p className="small muted" style={{ margin: "0.25rem 0 1.5rem" }}>
          {session.workspaceName}
        </p>
        <nav style={{ display: "grid", gap: "0.15rem" }}>
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "0.45rem 0.6rem",
                borderRadius: 8,
                fontSize: "0.92rem",
              }}
            >
              {item.label}
              {item.href === "/app/inbox" && waiting ? (
                <span className="pill accent">{waiting}</span>
              ) : null}
            </Link>
          ))}
        </nav>
      </aside>

      <div style={{ flex: 1, minWidth: 0 }}>
        {billingMessage ? (
          <div
            className={`notice ${entitlement.canSend ? "warning" : "danger"}`}
            style={{ margin: "1rem 1.5rem 0", borderRadius: "var(--radius)" }}
          >
            {billingMessage}{" "}
            <Link href="/app/billing" style={{ textDecoration: "underline" }}>
              Billing
            </Link>
          </div>
        ) : null}
        {account && account.status !== "active" ? (
          <div
            className={`notice ${account.status === "restricted" ? "danger" : "warning"}`}
            style={{ margin: "1rem 1.5rem 0", borderRadius: "var(--radius)" }}
          >
            <strong>LinkedIn account {account.status.replace("_", " ")}.</strong>{" "}
            {account.status_detail ?? "Sending is paused until this is resolved."}{" "}
            <Link href="/app/team" style={{ textDecoration: "underline" }}>
              Reconnect
            </Link>
          </div>
        ) : null}
        <main style={{ padding: "1.75rem 1.5rem 4rem", maxWidth: 1100 }}>{children}</main>
      </div>
    </div>
  );
}
