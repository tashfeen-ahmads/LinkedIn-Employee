import { requireSession } from "@/lib/workspace";
import { createClient } from "@/lib/supabase-server";
import { callWorker, errorQuery } from "@/lib/worker";
import { redirect } from "next/navigation";
import { LINKEDIN_LIMITS } from "@le/shared";
import { PLAN_SEATS } from "@le/billing";
import { revalidatePath } from "next/cache";
import { createInviteToken, inviteExpiry, INVITE_TTL_DAYS } from "@/lib/invitations";

/**
 * Starts LinkedIn's hosted consent flow.
 *
 * There were five of these — Google Calendar, Microsoft, HubSpot, Salesforce —
 * pointed at worker routes that do not exist and never did. The worker answered
 * 404, `callWorker` swallowed it and returned null, and the button did nothing
 * at all: no error, no navigation, no change on the page. The four have been
 * removed rather than left looking available.
 */
async function connectLinkedIn() {
  "use server";
  const session = await requireSession();
  const result = await callWorker<{ url?: string }>("/auth/linkedin/link", {
    workspaceId: session.workspaceId,
    userId: session.userId,
  });
  if (!result.ok) redirect(errorQuery("/app/team", result.error));
  if (!result.data?.url) {
    redirect(errorQuery("/app/team", "LinkedIn did not return a sign-in link. Please try again."));
  }
  redirect(result.data.url);
}

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
/**
 * Asks the provider whether this rep's account is connected, instead of waiting
 * to be told.
 *
 * The hosted flow reports success by calling a webhook once. If that delivery
 * is rejected — a signature mismatch, a restart, a webhook registered after the
 * account already connected — the account works perfectly at the provider and
 * sits here as "connecting" forever, with a Start again button that runs the
 * same flow to the same end. This is the way out of that, and it costs one
 * request.
 */
async function refreshLinkedIn() {
  "use server";
  const session = await requireSession();
  const result = await callWorker<{ bound?: number; mine?: number }>("/jobs/linkedin-refresh", {
    workspaceId: session.workspaceId,
    userId: session.userId,
  });
  if (!result.ok) redirect(errorQuery("/app/team", result.error));

  if (!result.data?.mine) {
    redirect(
      errorQuery(
        "/app/team",
        "LinkedIn's provider has no account for you yet. If you just finished signing in, give it a few seconds and check again.",
      ),
    );
  }
  revalidatePath("/app/team");
}

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
  // and the link is shown below, so this never blocks adding a teammate — but
  // whoever invited them needs to know the email did not go, or they will wait
  // for a reply to a message nobody received.
  if (invitation) {
    const sent = await callWorker("/jobs/send-invite", {
      workspaceId: session.workspaceId,
      userId: session.userId,
      invitationId: invitation.id,
    });
    if (!sent.ok) {
      redirect(errorQuery("/app/team", `Invitation created, but the email was not sent: ${sent.error} Share the link below instead.`));
    }
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

/**
 * Whether this rep has a Sales Navigator seat.
 *
 * It decides which search the Targeting Agent runs, and getting it wrong is
 * silent in both directions: claim a seat you do not have and the search
 * returns nothing, which reads as "your customer profile matched nobody";
 * leave it off when you do have one and every campaign is built from classic
 * search with half the profile ignored.
 */
async function saveSalesNavigator(formData: FormData) {
  "use server";
  const has = formData.get("hasSalesNavigator") === "on";

  const session = await requireSession();
  const supabase = await createClient();
  await supabase
    .from("linkedin_accounts")
    .update({ has_sales_navigator: has })
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
  searchParams: Promise<{ error?: string; connected?: string }>;
}) {
  const params = await searchParams;
  const session = await requireSession();
  const supabase = await createClient();

  // Coming back from the provider's hosted login.
  //
  // The connection is finished at the provider by the time this redirect fires
  // — it even hands back an account_id in the query — but the row here is bound
  // by a webhook, and a webhook that does not arrive left the rep looking at
  // "sending is paused" one second after being told they had succeeded.
  //
  // So the return itself confirms it. The account_id in the URL is deliberately
  // ignored: binding whatever id a query string names would let anyone attach
  // someone else's provider account to their own row. This asks the provider
  // instead, which answers with the rep's own user id attached, and binds only
  // a row already waiting.
  if (params.connected === "1") {
    await callWorker("/jobs/linkedin-refresh", {
      workspaceId: session.workspaceId,
      userId: session.userId,
    });
  }

  // Four independent reads on a page people open often; sequential awaits cost
  // four round trips where one batch does.
  const [{ data: members }, { data: accounts }, { data: invitations }, { data: me }] =
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
      <h1>Team</h1>

      {params.error ? (
        <div className="notice danger">
          {params.error}
        </div>
      ) : null}

      <section className="card">
        <h3>You</h3>
        <p className="small muted">
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
          <label className="field medium">
            <span>Your timezone</span>
            <input name="timezone" defaultValue={me?.timezone ?? "UTC"} placeholder="Europe/London" />
          </label>
          <button className="btn secondary" type="submit">
            Save
          </button>
        </form>
      </section>

      <section className="card">
        <h3>Your LinkedIn account</h3>
        {mine ? (
          <>
            <p className="small muted">
              {mine.display_name ?? "Connected"} · {mine.status}
              {mine.has_sales_navigator ? " · Sales Navigator" : ""}
            </p>
            <div className="meter-group">
              <Usage label="Invites today" used={mine.invites_today} cap={LINKEDIN_LIMITS.invitesPerDayMax} />
              <Usage label="Invites this week" used={mine.invites_this_week} cap={LINKEDIN_LIMITS.invitesPerWeek} />
              <Usage label="Messages today" used={mine.messages_today} cap={LINKEDIN_LIMITS.messagesPerDay} />
            </div>

            <form action={saveSalesNavigator}>
              <label className="small check">
                <input
                  type="checkbox"
                  name="hasSalesNavigator"
                  defaultChecked={mine.has_sales_navigator}
                 
                />
                <span>
                  This account has Sales Navigator
                  <span className="tiny subtle hint">
                    Without it, prospect search cannot filter on seniority or company size, and
                    campaigns say so before you launch them. With it, the full customer profile is
                    used.
                  </span>
                </span>
              </label>
              <button className="btn small" type="submit">
                Save
              </button>
            </form>

            <form action={saveWorkingHours}>
              <p className="small muted">
                Nothing is sent from this account outside these hours, read in your timezone above.
              </p>
              <div className="form-row">
                <label className="field compact">
                  <span>From</span>
                  <input type="number" name="start" min={0} max={23} defaultValue={hours.start} />
                </label>
                <label className="field compact">
                  <span>To</span>
                  <input type="number" name="end" min={1} max={24} defaultValue={hours.end} />
                </label>
                <div className="cluster-3">
                  {DAYS.map((day) => (
                    <label key={day.value} className="small check">
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
                ? "Waiting for LinkedIn to confirm the connection. If you have already finished signing in, check again — the confirmation sometimes does not arrive, and checking asks directly."
                : "Not connected yet. You will sign in to LinkedIn on their hosted page; we never see your password."}
            </p>
            <div className="cluster">
              {/* While waiting, checking is the likelier fix and goes first:
                  the account is usually already connected at the provider and
                  only the notification went missing. */}
              {awaitingProvider ? (
                <form action={refreshLinkedIn}>
                  <button className="btn" type="submit">
                    Check again
                  </button>
                </form>
              ) : null}
              <form action={connectLinkedIn}>
                <button className={awaitingProvider ? "btn secondary" : "btn"} type="submit">
                  {awaitingProvider ? "Start again" : "Connect LinkedIn"}
                </button>
              </form>
            </div>
          </>
        )}
      </section>

      {canManage ? (
        <section className="card">
          <h3>Invite a teammate</h3>
          <p className="small muted">
            Each rep connects their own LinkedIn account. Nobody shares a login, and no two reps will
            ever message the same person. We email the invitation; the link is also below in case it
            does not arrive.
          </p>
          <form action={inviteMember} className="form-row">
            <label className="field">
              <span>Work email</span>
              <input type="email" name="email" required placeholder="teammate@company.com" />
            </label>
            <label className="field compact">
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
            <div className="table-scroll">
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
                          className="link-field"
                          aria-label={`Invitation link for ${invitation.email}`}
                          value={`${appUrl}/invite/${invitation.token}`}
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
            <p className="small muted">
              No pending invitations. Links stay valid for {INVITE_TTL_DAYS} days.
            </p>
          )}
        </section>
      ) : null}

      <section>
        <h2>Members</h2>
        <div className="table-scroll">
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
                      <p className="small muted">
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
    <div className="meter-item">
      <span className="stat-label">{label}</span>
      <span className="mono small">
        {used} / {cap}
      </span>
      {/* The width is the only genuinely dynamic value here; the colour it
          turns near the cap is a state, so it is a class. */}
      <div className={`meter${ratio > 0.85 ? " is-near" : ""}`}>
        <span style={{ width: `${ratio * 100}%` }} />
      </div>
    </div>
  );
}
