import { ADMIN_ROLES, ADMIN_ROLE_LABELS, adminCan, type AdminRole } from "@le/shared";
import { requirePlatformAdmin, ago } from "@/lib/admin";
import { callWorker } from "@/lib/worker";
import { LoadFailed, PageHeader, Section } from "@/components/page";
import { PageNotice, type NoticeParams } from "@/components/page-notice";
import { SubmitButton } from "@/components/submit-button";
import { ConfirmButton } from "@/components/confirm-button";
import { adminTeam } from "../actions";

export const dynamic = "force-dynamic";

interface Member {
  userId: string;
  email: string | null;
  fullName: string | null;
  role: AdminRole;
  addedAt: string;
  addedBy: string | null;
}
interface Invite {
  email: string;
  role: AdminRole;
  invitedAt: string;
  invitedBy: string | null;
}

/**
 * Who runs the platform, and what each of them may press.
 *
 * Read by any admin; changed only by an owner, which the worker checks again
 * on every request. Somebody without an account yet is invited by address and
 * becomes an admin the first time they open the console signed in with it.
 */
export default async function AdminTeamPage({ searchParams }: { searchParams: NoticeParams }) {
  const params = await searchParams;
  const admin = await requirePlatformAdmin();
  const canManage = adminCan(admin.role, "manage-admins");
  const result = await callWorker<{ admins?: Member[]; invites?: Invite[] }>("/admin/admins", {
    userId: admin.userId,
    op: { op: "list" },
  });
  const admins = result.ok ? (result.data?.admins ?? []) : null;
  const invites = result.ok ? (result.data?.invites ?? []) : [];
  const owners = (admins ?? []).filter((a) => a.role === "owner").length;

  return (
    <>
      <PageHeader
        title="Admins"
        lede={
          canManage
            ? "Add the people who run Nora with you, and choose what each of them can do."
            : "The people who run Nora. Only an owner can change this list."
        }
      />
      <PageNotice error={params.error} notice={params.notice} />

      {canManage ? (
        <Section title="Add an admin" description="Use the email they sign in with. Somebody without an account is invited, and joins the first time they open the console.">
          <form action={adminTeam} className="card console-add-admin">
            <input type="hidden" name="op" value="add" />
            <label className="field">
              <span>Email</span>
              <input type="email" name="email" required autoComplete="off" placeholder="name@company.com" />
            </label>
            <fieldset className="console-roles">
              <legend className="console-roles-legend">Role</legend>
              {ADMIN_ROLES.map((role) => (
                <label key={role} className="console-role-option">
                  <input type="radio" name="role" value={role} defaultChecked={role === "admin"} />
                  <span className="console-role-name">{ADMIN_ROLE_LABELS[role].name}</span>
                  <span className="console-role-does">{ADMIN_ROLE_LABELS[role].does}</span>
                </label>
              ))}
            </fieldset>
            <div>
              <SubmitButton className="btn" pendingLabel="Adding…">
                Add admin
              </SubmitButton>
            </div>
          </form>
        </Section>
      ) : null}

      <Section title="People with access" description={admins ? `${admins.length} admin${admins.length === 1 ? "" : "s"} · ${owners} owner${owners === 1 ? "" : "s"}` : undefined}>
        {admins === null ? (
          <LoadFailed what="the admin list" />
        ) : (
          <div className="table-scroll card-rows">
            <table>
              <thead>
                <tr>
                  <th scope="col">Person</th>
                  <th scope="col">Role</th>
                  <th scope="col">Added</th>
                  {canManage ? <th scope="col"><span className="sr-only">Actions</span></th> : null}
                </tr>
              </thead>
              <tbody>
                {admins.map((a) => {
                  const lastOwner = a.role === "owner" && owners <= 1;
                  return (
                    <tr key={a.userId}>
                      <td>
                        <span className="console-person">
                          <span className="console-avatar" aria-hidden="true">
                            {(a.fullName ?? a.email ?? "?").trim().charAt(0).toUpperCase()}
                          </span>
                          <span className="console-person-text">
                            <span className="small">
                              {a.fullName ?? a.email ?? "Unknown"}
                              {a.userId === admin.userId ? <span className="tiny subtle"> (you)</span> : null}
                            </span>
                            {a.fullName && a.email ? <span className="tiny subtle">{a.email}</span> : null}
                          </span>
                        </span>
                      </td>
                      <td data-label="Role">
                        {canManage && !lastOwner ? (
                          <form action={adminTeam} className="console-inline-form">
                            <input type="hidden" name="op" value="set-role" />
                            <input type="hidden" name="targetUserId" value={a.userId} />
                            <label className="sr-only" htmlFor={`role-${a.userId}`}>
                              Role for {a.email ?? a.fullName ?? "this admin"}
                            </label>
                            <select id={`role-${a.userId}`} name="role" defaultValue={a.role}>
                              {ADMIN_ROLES.map((role) => (
                                <option key={role} value={role}>
                                  {ADMIN_ROLE_LABELS[role].name}
                                </option>
                              ))}
                            </select>
                            <SubmitButton className="btn small secondary" pendingLabel="Saving…">
                              Save
                            </SubmitButton>
                          </form>
                        ) : (
                          <span className={`pill tiny ${a.role === "owner" ? "accent" : "plain"}`}>
                            {ADMIN_ROLE_LABELS[a.role].name}
                          </span>
                        )}
                        {lastOwner && canManage ? (
                          <p className="tiny subtle">The only owner. Add another before changing this.</p>
                        ) : null}
                      </td>
                      <td data-label="Added" className="small subtle">
                        <span>{a.addedBy ? `${ago(a.addedAt)} by ${a.addedBy}` : ago(a.addedAt)}</span>
                      </td>
                      {canManage ? (
                        <td data-label="Actions">
                          {lastOwner ? null : (
                            <form action={adminTeam}>
                              <input type="hidden" name="op" value="remove" />
                              <input type="hidden" name="targetUserId" value={a.userId} />
                              <ConfirmButton
                                className="btn small ghost"
                                confirmLabel={a.userId === admin.userId ? "Remove my own access" : "Remove their access"}
                                pendingLabel="Removing…"
                              >
                                Remove
                              </ConfirmButton>
                            </form>
                          )}
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {invites.length ? (
        <Section title="Invited, not joined yet" description="They become admins the first time they sign in with this email and open the console.">
          <div className="table-scroll card-rows">
            <table>
              <thead>
                <tr>
                  <th scope="col">Email</th>
                  <th scope="col">Role</th>
                  <th scope="col">Invited</th>
                  {canManage ? <th scope="col"><span className="sr-only">Actions</span></th> : null}
                </tr>
              </thead>
              <tbody>
                {invites.map((i) => (
                  <tr key={i.email}>
                    <td className="small">{i.email}</td>
                    <td data-label="Role">
                      <span className="pill tiny plain">{ADMIN_ROLE_LABELS[i.role].name}</span>
                    </td>
                    <td data-label="Invited" className="small subtle">
                      <span>{i.invitedBy ? `${ago(i.invitedAt)} by ${i.invitedBy}` : ago(i.invitedAt)}</span>
                    </td>
                    {canManage ? (
                      <td data-label="Actions">
                        <form action={adminTeam}>
                          <input type="hidden" name="op" value="revoke-invite" />
                          <input type="hidden" name="email" value={i.email} />
                          <SubmitButton className="btn small ghost" pendingLabel="Withdrawing…">
                            Withdraw
                          </SubmitButton>
                        </form>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      ) : null}

      <Section title="What each role can do">
        <ul className="console-role-list">
          {ADMIN_ROLES.map((role) => (
            <li key={role}>
              <span className={`pill tiny ${role === "owner" ? "accent" : "plain"}`}>{ADMIN_ROLE_LABELS[role].name}</span>
              <span className="small">{ADMIN_ROLE_LABELS[role].does}</span>
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}
