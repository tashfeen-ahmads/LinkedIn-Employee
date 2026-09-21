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
                { href: "/admin", label: "Workspaces" },
                { href: "/admin/activity", label: "Activity" },
                { href: "/admin/support", label: "Needs attention" },
              ],
            },
          ]}
        />

        <div className="app-account">
          <div className="app-account-who">
            <p className="small">{admin.email}</p>
            <p className="tiny subtle">platform admin</p>
          </div>
          <Link href="/app" className="btn ghost small">
            Exit
          </Link>
        </div>
      </aside>

      <div className="app-main">
        <main className="app-body">{children}</main>
      </div>
    </div>
  );
}
