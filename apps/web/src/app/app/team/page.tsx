import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { requireSession } from "@/lib/workspace";
import { createClient } from "@/lib/supabase-server";
import { errorQuery, noticeQuery } from "@/lib/worker";
import { callWorker } from "@/lib/worker";
import { PLAN_SEATS } from "@le/billing";
import { createInviteToken, inviteExpiry, INVITE_TTL_DAYS } from "@/lib/invitations";
import { PageNotice } from "@/components/page-notice";
import { PageHeader, Section, Empty } from "@/components/page";
import { cannotSend } from "./repair";

/**
 * The workspace: who is in it, and who is waiting to be.
 *
 * It used to be four unrelated things on one page — your bio, your LinkedIn
 * connection, the invite form and the member list. Two of those are about a
 * person and two about a company, and a rep looking for "where do I reconnect
 * LinkedIn" had to scroll past an invite form to find it. Yours now lives on
 * Your profile; this is everyone else.
 */

/**
 * Invites a teammate. Seat limits are enforced here rather than at acceptance:
 * telling somebody their invitation is invalid after they clicked it is a
 * worse experience than telling the admin they need another seat.
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

export default async function TeamPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const params = await searchParams;
  const session = await requireSession();
  const supabase = await createClient();

  const [{ data: members }, { data: accounts }, { data: invitations }, { data: workspace }] =
    await Promise.all([
      supabase
        .from("memberships")
        .select("id, role, user_id")
        .eq("workspace_id", session.workspaceId),
      supabase
        .from("linkedin_accounts")
        .select("user_id, status, invites_today, invites_this_week")
        .eq("workspace_id", session.workspaceId),
      supabase
        .from("invitations")
        .select("id, email, role, token, expires_at, created_at")
        .eq("workspace_id", session.workspaceId)
        .is("accepted_at", null)
        .is("revoked_at", null)
        .order("created_at", { ascending: false }),
      supabase.from("workspaces").select("plan, seats").eq("id", session.workspaceId).maybeSingle(),
    ]);

  // Selected as a foreign key and fetched separately rather than as an embedded
  // join: PostgREST returns the related row and the worker's fake database
  // cannot, and a shape that differs between the two is how a test passes while
  // being wrong.
  const userIds = (members ?? []).map((m) => m.user_id);
  const { data: people } = userIds.length
    ? await supabase.from("profiles").select("id, full_name, email, timezone").in("id", userIds)
    : { data: [] };
  const personById = new Map((people ?? []).map((p) => [p.id, p]));
  const accountByUser = new Map((accounts ?? []).map((a) => [a.user_id, a]));

  const canManage = ["owner", "admin", "manager"].includes(session.role);
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const seats = workspace?.seats ?? 1;
  const used = (members ?? []).length + (invitations ?? []).length;

  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="Team"
        lede="Everyone who can sign in to this workspace. Each rep connects their own LinkedIn account on their own profile — no login is ever shared."
        actions={
          <span className="pill">
            {used} of {seats} seat{seats === 1 ? "" : "s"}
          </span>
        }
      />

      <PageNotice error={params.error} notice={params.notice} />

      <Section
        id="members"
        title="Members"
        description="A rep whose LinkedIn is not connected can be given campaigns, but nothing will leave their account."
      >
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Member</th>
                <th>Role</th>
                <th>LinkedIn</th>
                <th className="num">Invites today</th>
                <th className="num">This week</th>
              </tr>
            </thead>
            <tbody>
              {(members ?? []).map((member) => {
                const person = personById.get(member.user_id);
                const account = accountByUser.get(member.user_id);
                const broken = !account || cannotSend(account.status) || account.status !== "active";
                return (
                  <tr key={member.id}>
                    <td>
                      {person?.full_name ?? person?.email ?? "Unknown"}
                      {member.user_id === session.userId ? (
                        <span className="small subtle"> · you</span>
                      ) : null}
                      <p className="small muted">{person?.email}</p>
                    </td>
                    <td className="small">{member.role}</td>
                    <td>
                      {!account ? (
                        <span className="pill tiny">not connected</span>
                      ) : (
                        <span className={`pill tiny ${broken ? "warning" : "positive"}`}>
                          {account.status.replaceAll("_", " ")}
                        </span>
                      )}
                      {member.user_id === session.userId && broken ? (
                        <>
                          {" "}
                          <Link className="small" href="/app/profile">
                            Fix
                          </Link>
                        </>
                      ) : null}
                    </td>
                    <td className="num mono">{account?.invites_today ?? "—"}</td>
                    <td className="num mono">{account?.invites_this_week ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>

      {canManage ? (
        <Section
          id="invites"
          title="Invitations"
          description={`A link is valid for ${INVITE_TTL_DAYS} days. Anyone holding it can join this workspace, so send it the way you would send a password.`}
        >
          <div className="card">
            <form action={inviteMember} className="row">
              <label className="field grow">
                <span>Email address</span>
                <input type="email" name="email" placeholder="colleague@company.com" required />
              </label>
              <label className="field">
                <span>Role</span>
                <select name="role" defaultValue="rep">
                  <option value="rep">Rep</option>
                  <option value="manager">Manager</option>
                  <option value="admin">Admin</option>
                </select>
              </label>
              <button className="btn" type="submit">
                Send invitation
              </button>
            </form>
          </div>

          {invitations?.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Expires</th>
                    <th>Link</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {invitations.map((invitation) => (
                    <tr key={invitation.id}>
                      <td>{invitation.email}</td>
                      <td className="small">{invitation.role}</td>
                      <td className="small subtle">
                        {new Date(invitation.expires_at).toLocaleDateString()}
                      </td>
                      <td className="small mono breakable">
                        {appUrl}/invite/{invitation.token}
                      </td>
                      <td>
                        <form action={revokeInvitation}>
                          <input type="hidden" name="id" value={invitation.id} />
                          <button className="btn ghost small" type="submit">
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
            <Empty title="Nobody is waiting to join.">
              An invitation sent here appears in this list until it is accepted or revoked.
            </Empty>
          )}
        </Section>
      ) : null}
    </>
  );
}
