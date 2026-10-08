import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/admin";
import { createClient } from "@/lib/supabase-server";
import { AppNav } from "@/components/app-nav";

/**
 * The operator console.
 *
 * Deliberately a separate shell from /app rather than a section inside it. The
 * member app is scoped to one workspace and everything in it reads from that
 * session; this is scoped to all of them. Sharing a layout would mean every
 * page in both having to know which of those two worlds it was in.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requirePlatformAdmin();
  const supabase = await createClient();
  // The two things that are waiting on an operator, counted for the sidebar:
  // tickets the assistant held for a person, and whether outreach is paused.
  const [{ count: waiting }, { data: settings }] = await Promise.all([
    supabase
      .from("support_tickets")
      .select("id", { count: "exact", head: true })
      .eq("status", "open")
      .not("drafted_at", "is", null),
    supabase.from("platform_settings").select("outreach_paused_at").maybeSingle(),
  ]);

  return (
    <div className="app">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <aside className="app-aside">
        <div className="app-brand">
          <Link href="/admin">Operator</Link>
          <p className="tiny subtle">All workspaces</p>
        </div>

        <AppNav
          groups={[
            {
              label: "Run",
              alwaysOpen: true,
              items: [
                { href: "/admin", label: "Overview", icon: "overview" },
                { href: "/admin/issues", label: "Issues", icon: "system" },
                { href: "/admin/support", label: "Support", icon: "support", count: waiting ?? 0 },
                { href: "/admin/activity", label: "Activity", icon: "knowledge" },
              ],
            },
            {
              label: "Customers",
              items: [
                { href: "/admin/workspaces", label: "Workspaces", icon: "strategies" },
                { href: "/admin/users", label: "Users", icon: "profile" },
                { href: "/admin/campaigns", label: "Campaigns", icon: "campaigns" },
                { href: "/admin/accounts", label: "LinkedIn accounts", icon: "prospects" },
              ],
            },
            {
              label: "System",
              items: [
                { href: "/admin/jobs", label: "Jobs", icon: "agents" },
                { href: "/admin/spend", label: "AI spend", icon: "billing" },
                { href: "/admin/announcements", label: "Announcements", icon: "posts" },
                {
                  href: "/admin/settings",
                  label: "Settings",
                  icon: "shield",
                  ...(settings?.outreach_paused_at
                    ? { state: "attention" as const, stateLabel: "Outreach is paused" }
                    : {}),
                },
              ],
            },
          ]}
        />

        {/* The slot the app's own sign-out uses, so it sits at the foot of
            the column on a desktop and beside the brand on a phone. The
            classes this block used before had no styles left in the sheet. */}
        <div className="app-signout stack-1">
          <p className="tiny subtle">{admin.email}</p>
          <Link href="/app" className="btn ghost small">
            Back to the app
          </Link>
        </div>
      </aside>

      <div className="app-main">
        <main id="main" className="app-body">{children}</main>
      </div>
    </div>
  );
}
