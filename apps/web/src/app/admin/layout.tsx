import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/admin";
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

  return (
    <div className="app">
      <aside className="app-aside">
        <div className="app-brand">
          <Link href="/admin">Operator</Link>
          <p className="tiny subtle">All workspaces</p>
        </div>

        <AppNav
          groups={[
            {
              label: "Platform",
              items: [
                { href: "/admin/issues", label: "Issues" },
                { href: "/admin", label: "Workspaces" },
                { href: "/admin/activity", label: "Activity" },
                { href: "/admin/support", label: "Needs attention" },
                { href: "/admin/announcements", label: "Announcements" },
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
        <main className="app-body">{children}</main>
      </div>
    </div>
  );
}
