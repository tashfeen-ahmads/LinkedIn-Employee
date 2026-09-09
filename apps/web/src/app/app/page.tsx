import Link from "next/link";
import { FUNNEL_STAGES, countFunnel } from "@le/shared";
import { requireSession } from "@/lib/workspace";
import { createClient } from "@/lib/supabase-server";

export default async function OverviewPage() {
  const session = await requireSession();
  const supabase = await createClient();

  const [{ data: rows }, { data: profiles }] = await Promise.all([
    supabase.from("campaign_prospects").select("status, invited_at, accepted_at, replied_at").eq("workspace_id", session.workspaceId),
    supabase
      .from("customer_profiles")
      .select("id, name, priority, approved_at, do_not_pursue")
      .eq("workspace_id", session.workspaceId)
      .order("priority", { ascending: true }),
  ]);

  // One definition of the funnel, shared with the reporting page: two copies
  // would drift and quietly disagree about the same numbers.
  const tally = countFunnel(rows ?? []);
  const counts = FUNNEL_STAGES.map((stage) => ({ label: stage.label, value: tally[stage.key] }));

  const invited = tally.invited;
  const accepted = tally.accepted;
  const replied = tally.replied;

  return (
    <>
      <h1 style={{ fontSize: "1.6rem" }}>
        {session.fullName ? `Morning, ${session.fullName.split(" ")[0]}.` : "Overview"}
      </h1>

      <section
        style={{
          display: "grid",
          gap: "0.75rem",
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
          margin: "1.5rem 0 2.5rem",
        }}
      >
        {counts.map((stage) => (
          <div key={stage.label} className="card">
            <p className="small muted" style={{ margin: 0 }}>
              {stage.label}
            </p>
            <p className="mono" style={{ fontSize: "1.9rem", fontWeight: 640, margin: "0.2rem 0 0" }}>
              {stage.value}
            </p>
          </div>
        ))}
      </section>

      <section style={{ marginBottom: "2.5rem" }}>
        <h2 style={{ fontSize: "1.15rem" }}>Rates</h2>
        <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap" }}>
          <Rate label="Acceptance" numerator={accepted} denominator={invited} target={0.3} />
          <Rate label="Reply" numerator={replied} denominator={accepted} target={0.15} />
        </div>
      </section>

      <section>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ fontSize: "1.15rem", margin: 0 }}>Customer profiles</h2>
          <Link href="/app/strategy" className="btn secondary small">
            Review and approve
          </Link>
        </div>
        {profiles?.length ? (
          <div className="table-scroll" style={{ marginTop: "1rem" }}>
            <table>
              <thead>
                <tr>
                  <th>Profile</th>
                  <th>Priority</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {profiles.map((profile) => (
                  <tr key={profile.id}>
                    <td>{profile.name}</td>
                    <td className="mono">{profile.priority}</td>
                    <td>
                      {profile.do_not_pursue ? (
                        <span className="pill">Not pursuing</span>
                      ) : profile.approved_at ? (
                        <span className="pill positive">Approved</span>
                      ) : (
                        <span className="pill warning">Needs review</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted" style={{ marginTop: "1rem" }}>
            The Strategy Agent has not finished yet, or has not been run. Profiles appear here when it
            does.
          </p>
        )}
      </section>
    </>
  );
}

function Rate({
  label,
  numerator,
  denominator,
  target,
}: {
  label: string;
  numerator: number;
  denominator: number;
  target: number;
}) {
  if (denominator === 0) {
    return (
      <div>
        <p className="small muted" style={{ margin: 0 }}>
          {label}
        </p>
        <p className="muted" style={{ margin: 0 }}>
          Not enough data yet
        </p>
      </div>
    );
  }
  const rate = numerator / denominator;
  return (
    <div>
      <p className="small muted" style={{ margin: 0 }}>
        {label}
      </p>
      <p className="mono" style={{ fontSize: "1.35rem", fontWeight: 620, margin: "0.1rem 0" }}>
        {(rate * 100).toFixed(1)}%
      </p>
      <span className={`pill ${rate >= target ? "positive" : "warning"}`}>
        target {(target * 100).toFixed(0)}%
      </span>
    </div>
  );
}
