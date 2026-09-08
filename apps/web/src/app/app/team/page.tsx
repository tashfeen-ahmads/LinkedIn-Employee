import { requireSession } from "@/lib/workspace";
import { createClient } from "@/lib/supabase-server";
import { callWorker } from "@/lib/worker";
import { redirect } from "next/navigation";
import { LINKEDIN_LIMITS } from "@le/shared";

/**
 * Team and connection management. Each rep connects their own LinkedIn account
 * through the provider's hosted flow, so no password ever reaches us and no
 * login is ever shared.
 */
async function connectLinkedIn() {
  "use server";
  const session = await requireSession();
  const result = await callWorker<{ url?: string }>("/auth/linkedin/link", {
    workspaceId: session.workspaceId,
    userId: session.userId,
  });
  if (result?.url) redirect(result.url);
}

async function connectCalendar() {
  "use server";
  const session = await requireSession();
  const result = await callWorker<{ url?: string }>("/auth/google/link", {
    workspaceId: session.workspaceId,
    userId: session.userId,
  });
  if (result?.url) redirect(result.url);
}

async function connectHubSpot() {
  "use server";
  const session = await requireSession();
  const result = await callWorker<{ url?: string }>("/auth/hubspot/link", {
    workspaceId: session.workspaceId,
    userId: session.userId,
  });
  if (result?.url) redirect(result.url);
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

  const { data: calendar } = await supabase
    .from("integrations")
    .select("status")
    .eq("workspace_id", session.workspaceId)
    .eq("user_id", session.userId)
    .eq("kind", "google_calendar")
    .maybeSingle();

  const { data: crm } = await supabase
    .from("integrations")
    .select("kind, status")
    .eq("workspace_id", session.workspaceId)
    .in("kind", ["hubspot", "webhook"])
    .maybeSingle();

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

      <section className="card" style={{ marginTop: "1rem" }}>
        <h3>Your calendar</h3>
        {calendar?.status === "active" ? (
          <p className="small muted" style={{ margin: 0 }}>
            Google Calendar connected. The Reply Agent offers only times you are genuinely free and
            books the meeting itself.
          </p>
        ) : (
          <>
            <p className="small muted">
              {calendar?.status === "reauth_required"
                ? "Your calendar connection expired. Reconnect so the agent can keep booking meetings."
                : "Not connected. Until it is, the agent offers to send times instead of proposing any — it will never invent a slot."}
            </p>
            <form action={connectCalendar}>
              <button className="btn" type="submit">
                {calendar ? "Reconnect Google Calendar" : "Connect Google Calendar"}
              </button>
            </form>
          </>
        )}
      </section>

      <section className="card" style={{ marginTop: "1rem" }}>
        <h3>Your CRM</h3>
        {crm?.status === "active" ? (
          <p className="small muted" style={{ margin: 0 }}>
            Connected to {crm.kind === "hubspot" ? "HubSpot" : "your webhook"}. Contacts, messages and
            booked meetings sync automatically, and every AI-written message is labelled as such.
          </p>
        ) : (
          <>
            <p className="small muted">
              Not connected. Everything still works; your CRM just will not know about it.
            </p>
            <form action={connectHubSpot}>
              <button className="btn secondary" type="submit">
                Connect HubSpot
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
