import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/workspace";
import { createClient } from "@/lib/supabase-server";

async function setCampaignStatus(formData: FormData) {
  "use server";
  const campaignId = String(formData.get("campaignId"));
  const status = String(formData.get("status"));
  if (!["running", "paused"].includes(status)) return;

  const session = await requireSession();
  const supabase = await createClient();
  await supabase
    .from("campaigns")
    .update({
      status: status as "running" | "paused",
      ...(status === "running" ? { launched_at: new Date().toISOString() } : {}),
    })
    .eq("id", campaignId)
    .eq("workspace_id", session.workspaceId);

  revalidatePath("/app/campaigns");
}

export default async function CampaignsPage() {
  const session = await requireSession();
  const supabase = await createClient();

  const [{ data: campaigns }, { data: counts }] = await Promise.all([
    supabase
      .from("campaigns")
      .select("id, name, status, connection_note, daily_invite_cap, reply_mode, launched_at, created_at")
      .eq("workspace_id", session.workspaceId)
      .order("created_at", { ascending: false }),
    supabase.from("campaign_prospects").select("campaign_id, status").eq("workspace_id", session.workspaceId),
  ]);

  const byCampaign = new Map<string, { queued: number; total: number }>();
  for (const row of counts ?? []) {
    const entry = byCampaign.get(row.campaign_id) ?? { queued: 0, total: 0 };
    entry.total += 1;
    if (row.status === "queued") entry.queued += 1;
    byCampaign.set(row.campaign_id, entry);
  }

  if (!campaigns?.length) {
    return (
      <>
        <h1 style={{ fontSize: "1.6rem" }}>Campaigns</h1>
        <p className="muted">
          None yet. The Targeting Agent creates one as a draft; you review the list and the copy before
          anything is sent.
        </p>
      </>
    );
  }

  return (
    <>
      <h1 style={{ fontSize: "1.6rem" }}>Campaigns</h1>
      <div style={{ display: "grid", gap: "1rem", marginTop: "1.5rem" }}>
        {campaigns.map((campaign) => {
          const stats = byCampaign.get(campaign.id) ?? { queued: 0, total: 0 };
          return (
            <article key={campaign.id} className="card">
              <header style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
                <div>
                  <h3 style={{ margin: 0 }}>{campaign.name}</h3>
                  <p className="small muted" style={{ margin: "0.2rem 0 0" }}>
                    {stats.total} prospects, {stats.queued} still queued · {campaign.daily_invite_cap} invites
                    a day ·{" "}
                    {campaign.reply_mode === "autopilot" ? "replies on autopilot" : "replies need approval"}
                  </p>
                </div>
                <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start" }}>
                  <span className={`pill ${campaign.status === "running" ? "positive" : ""}`}>
                    {campaign.status}
                  </span>
                  <form action={setCampaignStatus}>
                    <input type="hidden" name="campaignId" value={campaign.id} />
                    <input
                      type="hidden"
                      name="status"
                      value={campaign.status === "running" ? "paused" : "running"}
                    />
                    <button className="btn secondary small" type="submit">
                      {campaign.status === "running" ? "Pause" : "Launch"}
                    </button>
                  </form>
                </div>
              </header>
              <p
                className="small"
                style={{
                  margin: "1rem 0 0",
                  padding: "0.7rem",
                  background: "var(--surface)",
                  borderRadius: 8,
                }}
              >
                {campaign.connection_note}
              </p>
            </article>
          );
        })}
      </div>
    </>
  );
}
