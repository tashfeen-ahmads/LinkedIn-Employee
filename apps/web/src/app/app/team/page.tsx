import { requireSession } from "@/lib/workspace";
import { createClient } from "@/lib/supabase-server";
import { LINKEDIN_LIMITS } from "@le/shared";

/**
 * Team and connection management. Each rep connects their own LinkedIn account
 * through the provider's hosted flow, so no password ever reaches us and no
 * login is ever shared.
 */
async function connectLinkedIn() {
  "use server";
  const session = await requireSession();
  const response = await fetch(`${process.env.WORKER_URL ?? "http://localhost:4000"}/auth/linkedin/link`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ workspaceId: session.workspaceId, userId: session.userId }),
  }).catch(() => null);

  if (!response?.ok) return;
  const { url } = (await response.json()) as { url?: string };
  if (url) {
    const { redirect } = await import("next/navigation");
    redirect(url);
  }
}

export default async function TeamPage() {
  const session = await requireSession();
  const supabase = await createClient();

  const { data: members } = await supabase
    .from("memberships")
    .select("id, role, user_id, profiles(full_name, email, timezone)")
    .eq("workspace_id", session.workspaceId);

  const { data: accounts } = await supabase
    .from("linkedin_accounts")
    .select("user_id, status, display_name, invites_today, invites_this_week, messages_today, has_sales_navigator")
    .eq("workspace_id", session.workspaceId);

  const accountByUser = new Map((accounts ?? []).map((a) => [a.user_id, a]));
  const mine = accountByUser.get(session.userId);

  return (
    <>
      <h1 style={{ fontSize: "1.6rem" }}>Team</h1>

      <section className="card" style={{ marginTop: "1.25rem" }}>
        <h3>Your LinkedIn account</h3>
        {mine ? (
          <>
            <p className="small muted" style={{ margin: "0 0 0.75rem" }}>
              {mine.display_name ?? "Connected"} · {mine.status}
              {mine.has_sales_navigator ? " · Sales Navigator" : ""}
            </p>
            <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap" }}>
              <Usage label="Invites today" used={mine.invites_today} cap={LINKEDIN_LIMITS.invitesPerDayMax} />
              <Usage label="Invites this week" used={mine.invites_this_week} cap={LINKEDIN_LIMITS.invitesPerWeek} />
              <Usage label="Messages today" used={mine.messages_today} cap={LINKEDIN_LIMITS.messagesPerDay} />
            </div>
          </>
        ) : (
          <>
            <p className="small muted">
              Not connected yet. You will sign in to LinkedIn on their hosted page; we never see your
              password.
            </p>
            <form action={connectLinkedIn}>
              <button className="btn" type="submit">
                Connect LinkedIn
              </button>
            </form>
          </>
        )}
      </section>

      <section style={{ marginTop: "2rem" }}>
        <h2 style={{ fontSize: "1.15rem" }}>Members</h2>
        <div className="table-scroll" style={{ marginTop: "1rem" }}>
          <table>
            <thead>
              <tr>
                <th>Member</th>
                <th>Role</th>
                <th>LinkedIn</th>
              </tr>
            </thead>
            <tbody>
              {(members ?? []).map((member) => {
                const profile = member.profiles as unknown as
                  | { full_name: string | null; email: string }
                  | null;
                const account = accountByUser.get(member.user_id);
                return (
                  <tr key={member.id}>
                    <td>
                      {profile?.full_name ?? profile?.email ?? "—"}
                      <p className="small muted" style={{ margin: 0 }}>
                        {profile?.email}
                      </p>
                    </td>
                    <td>
                      <span className="pill">{member.role}</span>
                    </td>
                    <td>
                      {account ? (
                        <span className={`pill ${account.status === "active" ? "positive" : "warning"}`}>
                          {account.status}
                        </span>
                      ) : (
                        <span className="pill">Not connected</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function Usage({ label, used, cap }: { label: string; used: number; cap: number }) {
  const ratio = Math.min(1, cap === 0 ? 0 : used / cap);
  return (
    <div style={{ minWidth: 140 }}>
      <p className="small muted" style={{ margin: 0 }}>
        {label}
      </p>
      <p className="mono" style={{ margin: "0.1rem 0 0.35rem", fontWeight: 600 }}>
        {used} / {cap}
      </p>
      <div style={{ height: 4, background: "var(--border)", borderRadius: 999 }}>
        <div
          style={{
            height: "100%",
            width: `${ratio * 100}%`,
            background: ratio > 0.85 ? "var(--warning)" : "var(--accent)",
            borderRadius: 999,
          }}
        />
      </div>
    </div>
  );
}
