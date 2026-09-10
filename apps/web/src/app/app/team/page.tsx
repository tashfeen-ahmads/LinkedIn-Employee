import { requireSession } from "@/lib/workspace";
import { createClient } from "@/lib/supabase-server";
import { callWorker } from "@/lib/worker";
import { redirect } from "next/navigation";
import { LINKEDIN_LIMITS } from "@le/shared";
import { PLAN_SEATS } from "@le/billing";
import { revalidatePath } from "next/cache";
import { createInviteToken, inviteExpiry, INVITE_TTL_DAYS } from "@/lib/invitations";

/**
 * Starts a provider's hosted consent flow. Five of these existed, identical
 * but for the path, so a change to the call shape meant five edits in one file.
 */
function connectAction(path: string) {
  return async function connect() {
    "use server";
    const session = await requireSession();
    const result = await callWorker<{ url?: string }>(path, {
      workspaceId: session.workspaceId,
      userId: session.userId,
    });
    if (result?.url) redirect(result.url);
  };
}

const connectLinkedIn = connectAction("/auth/linkedin/link");
const connectCalendar = connectAction("/auth/google/link");
const connectMicrosoftCalendar = connectAction("/auth/microsoft/link");
const connectHubSpot = connectAction("/auth/hubspot/link");
const connectSalesforce = connectAction("/auth/salesforce/link");

/**
 * Team and connection management. Each rep connects their own LinkedIn account
 * through the provider's hosted flow, so no password ever reaches us and no
 * login is ever shared.
 */
/**
 * Invites a teammate. Seat limits are enforced here rather than at acceptance:
 * telling someone their invitation is invalid after they clicked it is a worse
 * experience than telling the admin they need another seat.
 */
async function inviteMember(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const role = String(formData.get("role") ?? "rep");
  if (!email || !["rep", "manager", "admin"].includes(role)) return;

  const session = await requireSession();
  if (!["owner", "admin", "manager"].includes(session.role)) return;

  const supabase = await createClient();

  const [{ count: members }, { data: workspace }] = await Promise.all([
    supabase
      .from("memberships")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", session.workspaceId),
    supabase.from("workspaces").select("plan, seats").eq("id", session.workspaceId).single(),
  ]);

  const seatLimit = Math.max(workspace?.seats ?? 1, PLAN_SEATS[(workspace?.plan ?? "trial") as never] ?? 1);
  if ((members ?? 0) >= seatLimit) {
    redirect("/app/team?error=" + encodeURIComponent("You have used every seat on your plan."));
  }

  // Re-inviting the same person replaces the previous invitation rather than
  // leaving two live tokens for one mailbox.
  await supabase
    .from("invitations")
    .update({ revoked_at: new Date().toISOString() })
    .eq("workspace_id", session.workspaceId)
    .eq("email", email)
    .is("accepted_at", null)
    .is("revoked_at", null);

  const { data: invitation } = await supabase
    .from("invitations")
    .insert({
      workspace_id: session.workspaceId,
      email,
      role: role as "rep" | "manager" | "admin",
      token: createInviteToken(),
      invited_by: session.userId,
      expires_at: inviteExpiry(),
    })
    .select("id")
    .single();

  // The worker sends it. If mail is not configured the invitation still exists
  // and the link is shown below, so this never blocks adding a teammate.
  if (invitation) {
    await callWorker("/jobs/send-invite", {
      workspaceId: session.workspaceId,
      userId: session.userId,
      invitationId: invitation.id,
    });
  }

  revalidatePath("/app/team");
}

async function revokeInvitation(formData: FormData) {
  "use server";
  const id = String(formData.get("invitationId"));
  const session = await requireSession();
  if (!["owner", "admin", "manager"].includes(session.role)) return;

  const supabase = await createClient();
  await supabase
    .from("invitations")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .eq("workspace_id", session.workspaceId);

  revalidatePath("/app/team");
}

/**
 * The rep's own details. Both are read by the worker and neither could be set:
 * the bio grounds the writer's voice, and the timezone decides what "working
 * hours" means — a rep left on the default UTC gets their invitations sent at
 * the wrong hour of their own day.
 */
async function saveMyDetails(formData: FormData) {
  "use server";
  const bio = String(formData.get("bio") ?? "").trim();
  const timezone = String(formData.get("timezone") ?? "").trim();

  const session = await requireSession();
  const supabase = await createClient();
  await supabase
    .from("profiles")
    .update({ bio: bio || null, ...(isKnownTimezone(timezone) ? { timezone } : {}) })
    .eq("id", session.userId);

  revalidatePath("/app/team");
}

/**
 * When this account is allowed to act. Read by the rate limiter before every
 * send and never settable until now, so every rep was on the same 8am-to-6pm
 * weekday default whatever their day actually looks like.
 */
async function saveWorkingHours(formData: FormData) {
  "use server";
  const start = Number(formData.get("start"));
  const end = Number(formData.get("end"));
  const days = [1, 2, 3, 4, 5, 6, 0].filter((day) => formData.get(`day-${day}`) === "on");

  // A window that is empty or inverted would either send nothing or send at
  // three in the morning; neither is a setting anyone means to choose.
  if (!Number.isInteger(start) || !Number.isInteger(end)) return;
  if (start < 0 || end > 24 || start >= end || days.length === 0) return;

  const session = await requireSession();
  const supabase = await createClient();
  await supabase
    .from("linkedin_accounts")
    .update({ working_hours: { start, end, days } as never })
    .eq("workspace_id", session.workspaceId)
    .eq("user_id", session.userId);

  revalidatePath("/app/team");
}

/** Validated against the runtime's own list rather than a hand-kept one. */
function isKnownTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export default async function TeamPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const session = await requireSession();
  const supabase = await createClient();

  // Six independent reads on a page people open often; sequential awaits cost
  // six round trips where one batch does.
  const [{ data: members }, { data: accounts }, { data: calendar }, { data: crm }, { data: invitations }, { data: me }] =
    await Promise.all([
      supabase
        .from("memberships")
        .select("id, role, user_id, profiles(full_name, email, timezone)")
        .eq("workspace_id", session.workspaceId),
      supabase
        .from("linkedin_accounts")
        .select("user_id, status, display_name, invites_today, invites_this_week, messages_today, has_sales_navigator, working_hours")
        .eq("workspace_id", session.workspaceId),
      supabase
        .from("integrations")
        .select("kind, status")
        .eq("workspace_id", session.workspaceId)
        .eq("user_id", session.userId)
        .in("kind", ["google_calendar", "microsoft_calendar"])
        .maybeSingle(),
      supabase
        .from("integrations")
        .select("kind, status")
        .eq("workspace_id", session.workspaceId)
        .in("kind", ["hubspot", "salesforce", "webhook"])
        .maybeSingle(),
      supabase
        .from("invitations")
        .select("id, email, role, token, expires_at, created_at")
        .eq("workspace_id", session.workspaceId)
        .is("accepted_at", null)
        .is("revoked_at", null)
        .order("created_at", { ascending: false }),
      supabase.from("profiles").select("bio, timezone").eq("id", session.userId).maybeSingle(),
    ]);

  const canManage = ["owner", "admin", "manager"].includes(session.role);
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const accountByUser = new Map((accounts ?? []).map((a) => [a.user_id, a]));
  const found = accountByUser.get(session.userId);
  // A row that is still `connecting` has no provider id, so nothing can send
  // from it. Treating it as connected showed usage bars for an account that
  // does not work yet, and took away the only button that could fix it.
  const mine = found?.status === "connecting" ? undefined : found;
  const awaitingProvider = found?.status === "connecting";
  const hours = readWorkingHours(mine?.working_hours);

  return (
    <>
      <h1 style={{ fontSize: "1.6rem" }}>Team</h1>

      {params.error ? (
        <div className="notice danger" style={{ marginBottom: "1.25rem" }}>
          {params.error}
        </div>
      ) : null}

      <section className="card" style={{ marginTop: "1.25rem" }}>
        <h3>You</h3>
        <p className="small muted" style={{ marginTop: 0 }}>
          The agent writes in your voice and sends inside your working day, so both of these change
          what a prospect receives.
        </p>
        <form action={saveMyDetails}>
          <label className="field">
            <span>How you would describe yourself to a prospect</span>
            <textarea
              name="bio"
              rows={3}
              defaultValue={me?.bio ?? ""}
              placeholder="Twelve years in logistics ops before this. I care about the boring parts."
            />
          </label>
          <label className="field" style={{ maxWidth: 320 }}>
            <span>Your timezone</span>
            <input name="timezone" defaultValue={me?.timezone ?? "UTC"} placeholder="Europe/London" />
          </label>
          <button className="btn secondary" type="submit">
            Save
          </button>
        </form>
      </section>

      <section className="card" style={{ marginTop: "1rem" }}>
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

            <form action={saveWorkingHours} style={{ marginTop: "1.5rem" }}>
              <p className="small muted" style={{ margin: "0 0 0.5rem" }}>
                Nothing is sent from this account outside these hours, read in your timezone above.
              </p>
              <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "flex-end" }}>
                <label className="field" style={{ width: 110, marginBottom: 0 }}>
                  <span>From</span>
                  <input type="number" name="start" min={0} max={23} defaultValue={hours.start} />
                </label>
                <label className="field" style={{ width: 110, marginBottom: 0 }}>
                  <span>To</span>
                  <input type="number" name="end" min={1} max={24} defaultValue={hours.end} />
                </label>
                <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", paddingBottom: "0.5rem" }}>
                  {DAYS.map((day) => (
                    <label key={day.value} className="small" style={{ display: "flex", gap: "0.25rem" }}>
                      <input
                        type="checkbox"
                        name={`day-${day.value}`}
                        defaultChecked={hours.days.includes(day.value)}
                      />
                      {day.label}
                    </label>
                  ))}
                </div>
                <button className="btn secondary small" type="submit">
                  Save hours
                </button>
              </div>
            </form>
          </>
        ) : (
          <>
            <p className="small muted">
              {awaitingProvider
                ? "Waiting for LinkedIn to confirm the connection. This usually takes a few seconds; if the page still says this in a minute, start again."
                : "Not connected yet. You will sign in to LinkedIn on their hosted page; we never see your password."}
            </p>
            <form action={connectLinkedIn}>
              <button className="btn" type="submit">
                {awaitingProvider ? "Start again" : "Connect LinkedIn"}
              </button>
            </form>
          </>
        )}
      </section>

      <section className="card" style={{ marginTop: "1rem" }}>
        <h3>Your calendar</h3>
        {calendar?.status === "active" ? (
          <p className="small muted" style={{ margin: 0 }}>
            {calendar.kind === "microsoft_calendar" ? "Microsoft 365" : "Google Calendar"} connected. The
            Reply Agent offers only times you are genuinely free and books the meeting itself.
          </p>
        ) : (
          <>
            <p className="small muted">
              {calendar?.status === "reauth_required"
                ? "Your calendar connection expired. Reconnect so the agent can keep booking meetings."
                : "Not connected. Until it is, the agent offers to send times instead of proposing any — it will never invent a slot."}
            </p>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <form action={connectCalendar}>
                <button className="btn" type="submit">
                  {calendar ? "Reconnect Google" : "Connect Google Calendar"}
                </button>
              </form>
              <form action={connectMicrosoftCalendar}>
                <button className="btn secondary" type="submit">
                  Connect Microsoft 365
                </button>
              </form>
            </div>
          </>
        )}
      </section>

      <section className="card" style={{ marginTop: "1rem" }}>
        <h3>Your CRM</h3>
        {crm?.status === "active" ? (
          <p className="small muted" style={{ margin: 0 }}>
            Connected to{" "}
            {crm.kind === "hubspot" ? "HubSpot" : crm.kind === "salesforce" ? "Salesforce" : "your webhook"}. Contacts,
            messages and
            booked meetings sync automatically, and every AI-written message is labelled as such.
          </p>
        ) : (
          <>
            <p className="small muted">
              Not connected. Everything still works; your CRM just will not know about it.
            </p>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <form action={connectHubSpot}>
                <button className="btn secondary" type="submit">
                  Connect HubSpot
                </button>
              </form>
              <form action={connectSalesforce}>
                <button className="btn secondary" type="submit">
                  Connect Salesforce
                </button>
              </form>
            </div>
          </>
        )}
      </section>

      {canManage ? (
        <section className="card" style={{ marginTop: "1rem" }}>
          <h3>Invite a teammate</h3>
          <p className="small muted">
            Each rep connects their own LinkedIn account. Nobody shares a login, and no two reps will
            ever message the same person. We email the invitation; the link is also below in case it
            does not arrive.
          </p>
          <form action={inviteMember} style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "flex-end" }}>
            <label className="field" style={{ flex: "1 1 240px", marginBottom: 0 }}>
              <span>Work email</span>
              <input type="email" name="email" required placeholder="teammate@company.com" />
            </label>
            <label className="field" style={{ width: 140, marginBottom: 0 }}>
              <span>Role</span>
              <select name="role" defaultValue="rep">
                <option value="rep">Rep</option>
                <option value="manager">Manager</option>
                <option value="admin">Admin</option>
              </select>
            </label>
            <button className="btn" type="submit">
              Send invite
            </button>
          </form>

          {invitations?.length ? (
            <div className="table-scroll" style={{ marginTop: "1.25rem" }}>
              <table>
                <thead>
                  <tr>
                    <th>Pending invitation</th>
                    <th>Role</th>
                    <th>Link to send them</th>
                    <th>Expires</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {invitations.map((invitation) => (
                    <tr key={invitation.id}>
                      <td>{invitation.email}</td>
                      <td>
                        <span className="pill">{invitation.role}</span>
                      </td>
                      <td>
                        <input
                          readOnly
                          onFocus={undefined}
                          value={`${appUrl}/invite/${invitation.token}`}
                          style={{
                            width: "100%",
                            minWidth: 220,
                            fontSize: "0.78rem",
                            fontFamily: "ui-monospace, monospace",
                            padding: "0.35rem 0.5rem",
                            border: "1px solid var(--border)",
                            borderRadius: 6,
                            background: "var(--surface)",
                            color: "var(--text-muted)",
                          }}
                        />
                      </td>
                      <td className="small muted">
                        {new Date(invitation.expires_at).toLocaleDateString()}
                      </td>
                      <td>
                        <form action={revokeInvitation}>
                          <input type="hidden" name="invitationId" value={invitation.id} />
                          <button className="btn secondary small" type="submit">
                            Revoke
                          </button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="small muted" style={{ marginTop: "1rem", marginBottom: 0 }}>
              No pending invitations. Links stay valid for {INVITE_TTL_DAYS} days.
            </p>
          )}
        </section>
      ) : null}

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

const DAYS = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 0, label: "Sun" },
] as const;

/** The same shape and fallback the worker's limiter applies to this column. */
function readWorkingHours(value: unknown): { start: number; end: number; days: number[] } {
  const fallback = { start: 8, end: 18, days: [1, 2, 3, 4, 5] };
  if (!value || typeof value !== "object") return fallback;
  const hours = value as Partial<{ start: number; end: number; days: number[] }>;
  if (typeof hours.start === "number" && typeof hours.end === "number" && Array.isArray(hours.days)) {
    return { start: hours.start, end: hours.end, days: hours.days };
  }
  return fallback;
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
