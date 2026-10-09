import Link from "next/link";
import { createClient } from "@/lib/supabase-server";
import { requirePlatformAdmin, ago, when } from "@/lib/admin";
import { isoAttr } from "@/lib/format";
import { label } from "@/lib/labels";
import { adminAccountPill } from "@/lib/admin-account";
import { PageHeader, Section, Empty } from "@/components/page";
import { PageNotice } from "@/components/page-notice";
import { ControlButton } from "@/components/admin-control";

export const dynamic = "force-dynamic";

/**
 * Every person on the platform: who they are, where they work, whether their
 * LinkedIn is connected and when they were last here.
 *
 * "Last signed in" is the column that answers most support questions before
 * they are asked — somebody who signed up a week ago and never came back is
 * not having a problem with a campaign.
 */
export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; error?: string; notice?: string }>;
}) {
  const { q, error, notice } = await searchParams;
  await requirePlatformAdmin();
  const supabase = await createClient();

  const [{ data: users }, { data: memberships }, { data: workspaces }, { data: accounts }] = await Promise.all([
    supabase.rpc("platform_users"),
    supabase.from("memberships").select("workspace_id, user_id, role"),
    supabase.from("workspaces").select("id, name"),
    supabase.from("linkedin_accounts").select("user_id, status, first_action_at, provider_account_id, created_at"),
  ]);

  const workspaceName = new Map((workspaces ?? []).map((w) => [w.id, w.name]));
  const membershipsOf = new Map<string, Array<{ workspace_id: string; role: string }>>();
  for (const m of memberships ?? []) {
    const list = membershipsOf.get(m.user_id) ?? [];
    list.push(m);
    membershipsOf.set(m.user_id, list);
  }
  const accountOf = new Map((accounts ?? []).map((a) => [a.user_id, a]));

  const needle = (q ?? "").trim().toLowerCase();
  const shown = (users ?? [])
    .filter((u) => !needle || `${u.email} ${u.full_name ?? ""}`.toLowerCase().includes(needle))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));

  return (
    <>
      <PageHeader
        eyebrow="Operator"
        title="Users"
        lede={`${users?.length ?? 0} people across ${workspaces?.length ?? 0} workspaces, newest first.`}
      />
      <PageNotice error={error} notice={notice} />

      <Section title="Find someone">
        <form method="get" className="form-row">
          <label className="field">
            <span className="sr-only">Email or name</span>
            <input
              type="search"
              name="q"
              defaultValue={q ?? ""}
              placeholder="Email or name…"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <button className="btn secondary" type="submit">
            Search
          </button>
        </form>
      </Section>

      <Section title={needle ? `${shown.length} matching` : "Everyone"}>
        {!shown.length ? (
          <Empty title="Nobody matches.">Try part of an email address.</Empty>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Workspace</th>
                  <th>LinkedIn</th>
                  <th>Signed up</th>
                  <th>Last signed in</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((u) => {
                  const account = accountOf.get(u.user_id);
                  const homes = membershipsOf.get(u.user_id) ?? [];
                  return (
                    <tr key={u.user_id}>
                      <td>
                        <span className="small">{u.full_name ?? "—"}</span>
                        {u.is_admin ? <span className="pill tiny plain"> operator</span> : null}
                        <p className="tiny subtle">{u.email}</p>
                        {u.marketing_opt_out_at ? <p className="tiny subtle">unsubscribed from updates</p> : null}
                      </td>
                      <td className="small">
                        {homes.length ? (
                          homes.map((m) => (
                            <p key={m.workspace_id}>
                              <Link href={`/admin/workspaces/${m.workspace_id}`}>{workspaceName.get(m.workspace_id) ?? "—"}</Link>{" "}
                              <span className="tiny subtle">{label(m.role)}</span>
                            </p>
                          ))
                        ) : (
                          <span className="subtle">none — never finished signing up</span>
                        )}
                      </td>
                      <td>
                        {!account ? (
                          <span className="pill tiny plain">not connected</span>
                        ) : (
                          (() => {
                            const pill = adminAccountPill(account);
                            return <span className={`pill tiny ${pill.tone}`}>{pill.text}</span>;
                          })()
                        )}
                      </td>
                      <td className="small subtle">
                        <time dateTime={isoAttr(u.created_at)}>{when(u.created_at)}</time>
                      </td>
                      <td className="small subtle">{ago(u.last_sign_in_at)}</td>
                      <td>
                        <ControlButton
                          op="user-password-reset"
                          fields={{ targetUserId: u.user_id }}
                          back="/admin/users"
                          label="Email reset link"
                          pendingLabel="Sending…"
                          tone="ghost"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </>
  );
}
