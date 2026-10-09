import Link from "next/link";
import { dailyInviteCap } from "@le/linkedin";
import { LINKEDIN_LIMITS } from "@le/shared";
import { createClient } from "@/lib/supabase-server";
import { requirePlatformAdmin, ago, when } from "@/lib/admin";
import { PageHeader, Section, Empty } from "@/components/page";
import { PageNotice, type NoticeParams } from "@/components/page-notice";
import { ControlButton } from "@/components/admin-control";
import { adminAccountPill } from "@/lib/admin-account";

export const dynamic = "force-dynamic";

/**
 * Every connected LinkedIn account: its health, today's usage against its cap,
 * and whether LinkedIn is holding its invitations.
 *
 * The account is the thing this product exists to protect, so this is the one
 * place an operator sees all of them at once — a hold on three accounts in the
 * same hour is a platform event, not three customers' bad luck.
 */
export default async function AdminAccountsPage({ searchParams }: { searchParams: NoticeParams }) {
  const params = await searchParams;
  await requirePlatformAdmin();
  const supabase = await createClient();

  const [{ data: accounts }, { data: workspaces }, { data: users }] = await Promise.all([
    supabase
      .from("linkedin_accounts")
      .select(
        "id, workspace_id, user_id, display_name, status, status_detail, provider_account_id, created_at, has_sales_navigator, invites_today, invites_this_week, messages_today, connected_at, first_action_at, last_action_at, invites_paused_until, invites_paused_reason",
      )
      .order("connected_at", { ascending: false }),
    supabase.from("workspaces").select("id, name"),
    supabase.rpc("platform_users"),
  ]);

  const workspaceName = new Map((workspaces ?? []).map((w) => [w.id, w.name]));
  const person = new Map((users ?? []).map((u) => [u.user_id, u.full_name ?? u.email]));
  const back = "/admin/accounts";
  const now = Date.now();
  const bad = (accounts ?? []).filter((a) => a.status !== "active");
  const unfinished = bad.filter((a) => !a.provider_account_id && a.status === "connecting").length;

  return (
    <>
      <PageHeader
        eyebrow="Operator"
        title="LinkedIn accounts"
        lede={`${(accounts?.length ?? 0) - unfinished} connected · ${bad.length - unfinished} not active · ${unfinished} sign-in${unfinished === 1 ? "" : "s"} never finished.`}
        actions={
          <ControlButton
            op="accounts-recover"
            back={back}
            label="Re-check every account with the provider"
            pendingLabel="Checking…"
          />
        }
      />
      <PageNotice error={params.error} notice={params.notice} />

      <Section
        title="Accounts"
        description="Clearing a hold lets invitations go again at once. If LinkedIn is still refusing, the next refusal puts the hold straight back — that is the safety working, not a fault."
      >
        {!accounts?.length ? (
          <Empty title="No accounts yet.">They appear here as soon as somebody connects LinkedIn.</Empty>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Status</th>
                  <th className="num">Invites today</th>
                  <th className="num">This week</th>
                  <th className="num">Messages today</th>
                  <th>Cap</th>
                  <th>Last action</th>
                  <th>LinkedIn hold</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => {
                  const cap = a.first_action_at ? dailyInviteCap(new Date(a.first_action_at)) : LINKEDIN_LIMITS.invitesPerDayStart;
                  const heldUntil = a.invites_paused_until && Date.parse(a.invites_paused_until) > now ? a.invites_paused_until : null;
                  return (
                    <tr key={a.id}>
                      <td>
                        <span className="small">{a.display_name ?? person.get(a.user_id) ?? "—"}</span>
                        <p className="tiny subtle">
                          <Link href={`/admin/workspaces/${a.workspace_id}`}>{workspaceName.get(a.workspace_id) ?? "—"}</Link>
                          {a.has_sales_navigator ? " · Sales Navigator" : ""}
                        </p>
                      </td>
                      <td>
                        {(() => {
                          const pill = adminAccountPill(a);
                          return <span className={`pill tiny ${pill.tone}`}>{pill.text}</span>;
                        })()}
                        {a.status_detail ? <p className="tiny muted">{a.status_detail}</p> : null}
                      </td>
                      <td className="num mono">{a.invites_today}</td>
                      <td className="num mono">{a.invites_this_week}</td>
                      <td className="num mono">{a.messages_today}</td>
                      <td className="small subtle">
                        {cap}/day{a.first_action_at ? "" : ", not started"}
                      </td>
                      <td className="small subtle">{ago(a.last_action_at)}</td>
                      <td>
                        {heldUntil ? (
                          <div className="stack-1">
                            <span className="pill tiny warning">until {when(heldUntil)}</span>
                            {a.invites_paused_reason ? <p className="tiny muted">{a.invites_paused_reason}</p> : null}
                            <ControlButton op="account-clear-hold" fields={{ accountId: a.id }} back={back} label="Clear hold" tone="ghost" />
                          </div>
                        ) : (
                          <span className="tiny subtle">none</span>
                        )}
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
