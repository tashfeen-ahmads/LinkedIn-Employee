import {
  FUNNEL_STAGES,
  MIN_FOR_RATE,
  RATE_TARGETS,
  countFunnel,
  funnelRates,
  type FunnelRow,
} from "@le/shared";
import { requireSession } from "@/lib/workspace";
import { createClient } from "@/lib/supabase-server";

/**
 * The per-rep funnel the Teams plan is sold on.
 *
 * A table rather than a chart: for three to twenty reps the numbers are the
 * point, and a grouped bar chart across reps and five stages is unreadable at
 * exactly the size this page is used at. The inline bars are a scanning aid
 * that encodes the same numbers beside them — never a trapezoid funnel, whose
 * area misrepresents the drop-off it claims to show.
 */
export default async function ReportingPage() {
  const session = await requireSession();
  const supabase = await createClient();

  const [{ data: memberships }, { data: campaigns }] = await Promise.all([
    supabase
      .from("memberships")
      .select("user_id, role, profiles(full_name, email)")
      .eq("workspace_id", session.workspaceId),
    supabase
      .from("campaigns")
      .select("id, name, owner_user_id, status")
      .eq("workspace_id", session.workspaceId),
  ]);

  const campaignIds = (campaigns ?? []).map((c) => c.id);
  const { data: rows } = campaignIds.length
    ? await supabase
        .from("campaign_prospects")
        .select("campaign_id, status, invited_at, accepted_at, replied_at")
        .eq("workspace_id", session.workspaceId)
        .in("campaign_id", campaignIds)
    : { data: [] };

  const ownerByCampaign = new Map((campaigns ?? []).map((c) => [c.id, c.owner_user_id]));
  const byRep = new Map<string, FunnelRow[]>();
  const byCampaign = new Map<string, FunnelRow[]>();

  for (const row of rows ?? []) {
    const owner = ownerByCampaign.get(row.campaign_id);
    if (owner) byRep.set(owner, [...(byRep.get(owner) ?? []), row]);
    byCampaign.set(row.campaign_id, [...(byCampaign.get(row.campaign_id) ?? []), row]);
  }

  // A rep sees their own row; anyone who can manage the team sees everyone.
  const canSeeTeam = ["owner", "admin", "manager"].includes(session.role);
  const visible = (memberships ?? []).filter((m) => canSeeTeam || m.user_id === session.userId);

  const reps = visible
    .map((membership) => {
      const profile = membership.profiles as unknown as { full_name: string | null; email: string } | null;
      const counts = countFunnel(byRep.get(membership.user_id) ?? []);
      return {
        userId: membership.user_id,
        name: profile?.full_name ?? profile?.email ?? "Unknown",
        role: membership.role,
        counts,
        rates: funnelRates(counts),
      };
    })
    .sort((a, b) => b.counts.meetings - a.counts.meetings || b.counts.invited - a.counts.invited);

  const workspaceCounts = countFunnel(rows ?? []);
  const workspaceRates = funnelRates(workspaceCounts);
  const peak = Math.max(1, ...reps.map((r) => r.counts.invited));

  return (
    <>
      <h1 style={{ fontSize: "1.6rem" }}>Reporting</h1>
      <p className="muted">
        {canSeeTeam
          ? "Where outreach is working and where it stops, per rep and per campaign."
          : "Your own outreach. Team-wide figures are visible to managers."}
      </p>

      <section style={{ marginTop: "1.75rem" }}>
        <h2 style={{ fontSize: "1.1rem" }}>Workspace</h2>
        <div
          style={{
            display: "grid",
            gap: "0.75rem",
            gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
            marginTop: "0.9rem",
          }}
        >
          {FUNNEL_STAGES.map((stage) => (
            <div key={stage.key} className="card">
              <p className="small muted" style={{ margin: 0 }}>
                {stage.label}
              </p>
              <p className="mono" style={{ fontSize: "1.7rem", fontWeight: 640, margin: "0.15rem 0 0" }}>
                {workspaceCounts[stage.key]}
              </p>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: "2rem", flexWrap: "wrap", marginTop: "1.25rem" }}>
          <Rate label="Acceptance" value={workspaceRates.acceptance} target={RATE_TARGETS.acceptance} />
          <Rate label="Reply" value={workspaceRates.reply} target={RATE_TARGETS.reply} />
        </div>
      </section>

      <section style={{ marginTop: "2.5rem" }}>
        <h2 style={{ fontSize: "1.1rem" }}>{canSeeTeam ? "By rep" : "You"}</h2>
        {reps.every((rep) => rep.counts.invited === 0) ? (
          <p className="muted" style={{ marginTop: "0.75rem" }}>
            No outreach has gone out yet. Launch a campaign and this fills in.
          </p>
        ) : (
          <div className="table-scroll" style={{ marginTop: "0.9rem" }}>
            <table>
              <thead>
                <tr>
                  <th>Rep</th>
                  <th style={{ minWidth: 150 }}>Funnel</th>
                  {FUNNEL_STAGES.map((stage) => (
                    <th key={stage.key} style={{ textAlign: "right" }}>
                      {stage.label}
                    </th>
                  ))}
                  <th style={{ textAlign: "right" }}>Acceptance</th>
                  <th style={{ textAlign: "right" }}>Reply</th>
                </tr>
              </thead>
              <tbody>
                {reps.map((rep) => (
                  <tr key={rep.userId}>
                    <td>
                      {rep.name}
                      <p className="small muted" style={{ margin: 0 }}>
                        {rep.role}
                      </p>
                    </td>
                    <td>
                      <FunnelBar counts={rep.counts} peak={peak} name={rep.name} />
                    </td>
                    {FUNNEL_STAGES.map((stage) => (
                      <td key={stage.key} className="mono" style={{ textAlign: "right" }}>
                        {rep.counts[stage.key]}
                      </td>
                    ))}
                    <td style={{ textAlign: "right" }}>
                      <RateCell value={rep.rates.acceptance} target={RATE_TARGETS.acceptance} />
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <RateCell value={rep.rates.reply} target={RATE_TARGETS.reply} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="small muted" style={{ marginTop: "0.9rem" }}>
          A rate appears once there are {MIN_FOR_RATE} in its denominator. Below that a percentage
          says more about the sample than the rep.
        </p>
      </section>

      {campaigns?.length ? (
        <section style={{ marginTop: "2.5rem" }}>
          <h2 style={{ fontSize: "1.1rem" }}>By campaign</h2>
          <div className="table-scroll" style={{ marginTop: "0.9rem" }}>
            <table>
              <thead>
                <tr>
                  <th>Campaign</th>
                  <th>Status</th>
                  {FUNNEL_STAGES.map((stage) => (
                    <th key={stage.key} style={{ textAlign: "right" }}>
                      {stage.label}
                    </th>
                  ))}
                  <th style={{ textAlign: "right" }}>Acceptance</th>
                </tr>
              </thead>
              <tbody>
                {campaigns
                  .filter((campaign) => canSeeTeam || campaign.owner_user_id === session.userId)
                  .map((campaign) => {
                    const counts = countFunnel(byCampaign.get(campaign.id) ?? []);
                    const rates = funnelRates(counts);
                    return (
                      <tr key={campaign.id}>
                        <td>{campaign.name}</td>
                        <td>
                          <span className={`pill ${campaign.status === "running" ? "positive" : ""}`}>
                            {campaign.status}
                          </span>
                        </td>
                        {FUNNEL_STAGES.map((stage) => (
                          <td key={stage.key} className="mono" style={{ textAlign: "right" }}>
                            {counts[stage.key]}
                          </td>
                        ))}
                        <td style={{ textAlign: "right" }}>
                          <RateCell value={rates.acceptance} target={RATE_TARGETS.acceptance} />
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </>
  );
}

/**
 * Five stacked magnitude bars, widths on one shared scale so reps are
 * comparable across rows. One hue darkening down the funnel: the stages are
 * ordered, so the ramp is sequential rather than five arbitrary colours.
 * Numbers sit in their own columns, so nothing depends on reading the bar.
 */
function FunnelBar({ counts, peak, name }: { counts: ReturnType<typeof countFunnel>; peak: number; name: string }) {
  return (
    <div
      style={{ display: "grid", gap: 2, minWidth: 140 }}
      role="img"
      aria-label={FUNNEL_STAGES.map((s) => `${s.label} ${counts[s.key]}`).join(", ") + ` for ${name}`}
    >
      {FUNNEL_STAGES.map((stage, index) => (
        <div key={stage.key} style={{ height: 6, background: "var(--surface)", borderRadius: 3 }}>
          <div
            style={{
              height: "100%",
              width: `${Math.min(100, (counts[stage.key] / peak) * 100)}%`,
              background: "var(--accent)",
              // Sequential ramp over one hue: full strength at the top of the
              // funnel, lighter as the numbers fall away.
              opacity: 1 - index * 0.16,
              borderRadius: 3,
              minWidth: counts[stage.key] > 0 ? 3 : 0,
            }}
          />
        </div>
      ))}
    </div>
  );
}

function Rate({ label, value, target }: { label: string; value: number | null; target: number }) {
  return (
    <div>
      <p className="small muted" style={{ margin: 0 }}>
        {label}
      </p>
      {value === null ? (
        <p className="muted" style={{ margin: "0.1rem 0 0" }}>
          Not enough data yet
        </p>
      ) : (
        <>
          <p className="mono" style={{ fontSize: "1.4rem", fontWeight: 620, margin: "0.1rem 0 0.3rem" }}>
            {(value * 100).toFixed(1)}%
          </p>
          <span className={`pill ${value >= target ? "positive" : "warning"}`}>
            {value >= target ? "on target" : "below"} {(target * 100).toFixed(0)}%
          </span>
        </>
      )}
    </div>
  );
}

/** Status colour plus the word, so the state never rests on colour alone. */
function RateCell({ value, target }: { value: number | null; target: number }) {
  if (value === null) return <span className="small muted">—</span>;
  return (
    <span className={`pill ${value >= target ? "positive" : "warning"}`}>
      {(value * 100).toFixed(0)}%
    </span>
  );
}
