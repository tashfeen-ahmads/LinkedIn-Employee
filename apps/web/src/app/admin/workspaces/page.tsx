import Link from "next/link";
import { createClient } from "@/lib/supabase-server";
import { PageHeader } from "@/components/page";
import { requirePlatformAdmin, statsByWorkspace, formatUsd, type WorkspaceStats } from "@/lib/admin";
import { MESSAGE_WEBHOOK_BEAT, WEBHOOKS_BEAT, standingWebhookRefusal } from "@le/shared";

export const dynamic = "force-dynamic";

/**
 * Every workspace on the platform, and whether it is actually working.
 *
 * Ordered newest first, because the question an operator has most often is
 * "what happened to the one that signed up this morning" — not "show me the
 * biggest". A workspace that has never sent anything is the interesting case,
 * and sorting by size buries it.
 */
export default async function AdminWorkspacesPage() {
  await requirePlatformAdmin();
  const supabase = await createClient();

  const [{ data: workspaces }, { data: members }, { data: accounts }, { data: campaigns }, { data: stats }, { data: spend }, { data: webhookBeat }] =
    await Promise.all([
      supabase.from("workspaces").select("id, name, slug, plan, seats, trial_ends_at, subscription_status, created_at").order("created_at", { ascending: false }),
      supabase.from("memberships").select("workspace_id, user_id"),
      supabase.from("linkedin_accounts").select("workspace_id, status, invites_today, first_action_at"),
      supabase.from("campaigns").select("workspace_id, status"),
      supabase.rpc("platform_workspace_stats"),
      // Summed in the database. Read row by row this stopped at PostgREST's
      // thousandth, and `llm_calls` gains a row per agent call — so the bill
      // an operator reads was the first number on the platform to go quietly
      // short.
      supabase.rpc("platform_workspace_spend"),
      /*
       * What the webhook endpoint itself recorded (rule 46), not whether a
       * secret is configured — a check that asks about configuration passes
       * while every delivery is being refused.
       *
       * It lives here rather than on the customer's overview. It was a row in
       * `needsYou`, written in their words with "tell us" as its action, and
       * that action was the give-away: the only thing the reader could do was
       * report a fault to the people who already have the telemetry. Deliveries
       * are our plumbing, so this is our screen.
       */
      supabase
        .from("worker_heartbeats")
        .select("name, detail, beat_at")
        .in("name", [MESSAGE_WEBHOOK_BEAT, WEBHOOKS_BEAT]),
    ]);

  const byWorkspace = statsByWorkspace((stats ?? null) as WorkspaceStats[] | null);
  const memberCount = tally(members, "workspace_id");
  const campaignCount = tally(campaigns?.filter((c) => c.status === "running") ?? null, "workspace_id");

  // A model missing from the price table costs null, never zero — so a null
  // here means "not priced", and adding it as zero would report a number that
  // is wrong in the flattering direction.
  const costs = new Map<string, number>();
  for (const row of spend ?? []) {
    // The function already excludes calls with no workspace to charge — one
    // made before a workspace exists has nowhere to go.
    costs.set(row.workspace_id, Number(row.spend_usd));
  }

  const accountsByWorkspace = new Map<string, { status: string; invites_today: number; first_action_at: string | null }[]>();
  for (const a of accounts ?? []) {
    const list = accountsByWorkspace.get(a.workspace_id) ?? [];
    list.push(a);
    accountsByWorkspace.set(a.workspace_id, list);
  }

  // The same reading the overview's facts use — one rule, one answer.
  const delivery = (webhookBeat ?? []).find((b) => b.name === MESSAGE_WEBHOOK_BEAT);
  const registration = (webhookBeat ?? []).find((b) => b.name === WEBHOOKS_BEAT);
  const webhook = standingWebhookRefusal(delivery, registration);
  const webhookAt = delivery?.beat_at ?? null;

  const totalSpend = [...costs.values()].reduce((sum, n) => sum + n, 0);
  const everSent = (workspaces ?? []).filter((w) =>
    (accountsByWorkspace.get(w.id) ?? []).some((a) => a.first_action_at),
  ).length;

  return (
    <>
      <PageHeader
        eyebrow="Operator"
        title="Workspaces"
        lede={`${workspaces?.length ?? 0} total · ${everSent} have ever sent · ${formatUsd(totalSpend)} of model spend`}
      />

      {/*
        Only a refusal counts. A delivery that verified and an endpoint nobody
        has called yet are both "nothing to do", and reporting the second as a
        fault puts a permanent red banner on this screen from the day it ships.

        The two refusals are told apart because they are different jobs: no
        header at all is the webhook configured without a secret, and a header
        that does not verify is the wrong secret on one side. Telling somebody
        to re-copy a secret that is already correct is its own wasted afternoon.
      */}
      {webhook ? (
        <div className="notice danger" role="status">
          <p>
            <strong>Inbound deliveries are being refused.</strong>{" "}
            {webhook === "no_signature"
              ? "Calls are arriving with no signature header at all, which means the webhook was configured without a signing secret on the provider's side."
              : "Calls are arriving with a signature that does not verify, which means the secret differs between the provider and this deployment."}
          </p>
          <p className="small">
            Prospect replies are reaching LinkedIn and not reaching any inbox in the product. Last
            recorded {webhookAt ? new Date(webhookAt).toLocaleString() : "—"}. Customers are not
            shown this; it is ours.
          </p>
        </div>
      ) : null}

      {!workspaces?.length ? (
        <div className="notice">
          <p>No workspaces yet. The first signup will appear here.</p>
        </div>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Workspace</th>
                <th className="num">People</th>
                <th>LinkedIn</th>
                <th className="num">Running</th>
                <th className="num">Prospects</th>
                <th className="num">Sent</th>
                <th className="num">Waiting</th>
                <th className="num">Spend</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {workspaces.map((w) => {
                const s = byWorkspace.get(w.id);
                const accs = accountsByWorkspace.get(w.id) ?? [];
                return (
                  <tr key={w.id}>
                    <td>
                      <Link href={`/admin/workspaces/${w.id}`}>{w.name}</Link>
                      <p className="tiny subtle mono">{w.slug}</p>
                    </td>
                    <td className="num">{memberCount.get(w.id) ?? 0}</td>
                    <td><AccountCell accounts={accs} /></td>
                    <td className="num">{campaignCount.get(w.id) ?? 0}</td>
                    <td className="num">{s?.prospects ?? 0}</td>
                    <td className="num">{s?.messages_sent ?? 0}</td>
                    <td className="num">{s?.pending_drafts ?? 0}</td>
                    <td className="num mono">{formatUsd(costs.get(w.id) ?? 0)}</td>
                    <td className="small subtle">{new Date(w.created_at).toLocaleDateString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="tiny subtle">
        Prospect names, conversations and message bodies are not readable here. Supporting a workspace
        does not require reading its customers&rsquo; mail, so those tables are counted rather than listed.
      </p>
    </>
  );
}

/** The health of a workspace's LinkedIn accounts, said in one cell. */
function AccountCell({ accounts }: { accounts: { status: string; first_action_at: string | null }[] }) {
  if (!accounts.length) return <span className="pill plain tiny">none</span>;
  const bad = accounts.filter((a) => a.status !== "active");
  if (bad.length) {
    return (
      <span className={`pill tiny ${bad.some((a) => a.status === "restricted") ? "danger" : "warning"}`}>
        {bad[0]?.status.replaceAll("_", " ")}
      </span>
    );
  }
  const idle = accounts.every((a) => !a.first_action_at);
  return <span className={`pill tiny ${idle ? "plain" : "positive"}`}>{idle ? "connected, idle" : "sending"}</span>;
}

function tally<T extends Record<string, unknown>>(rows: T[] | null, key: keyof T): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows ?? []) {
    const id = String(row[key]);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}
