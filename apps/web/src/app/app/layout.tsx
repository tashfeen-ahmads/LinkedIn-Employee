import Link from "next/link";
import { requireSession } from "@/lib/workspace";
import { createClient } from "@/lib/supabase-server";

const NAV = [
  { href: "/app", label: "Overview" },
  { href: "/app/prospects", label: "Prospects" },
  { href: "/app/campaigns", label: "Campaigns" },
  { href: "/app/inbox", label: "Inbox" },
  { href: "/app/meetings", label: "Meetings" },
  { href: "/app/team", label: "Team" },
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
