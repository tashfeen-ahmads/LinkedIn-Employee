import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/workspace";
import { createClient } from "@/lib/supabase-server";
import { callWorker } from "@/lib/worker";

/**
 * Erasure on request. A prospect who asks to be forgotten is a request the
 * customer is legally obliged to honour, so it is one click rather than a
 * support ticket.
 */
async function eraseProspect(formData: FormData) {
  "use server";
  const prospectId = String(formData.get("prospectId"));
  if (!prospectId) return;

  const session = await requireSession();
  await callWorker("/jobs/erase-prospect", {
    workspaceId: session.workspaceId,
    userId: session.userId,
    prospectId,
    reason: "requested by the individual",
  });
  revalidatePath("/app/prospects");
}

interface Signal {
  type: string;
  detail: string;
  observedAt: string;
  weight: number;
}

const SIGNAL_LABELS: Record<string, string> = {
  new_role: "New role",
  company_hiring: "Hiring",
  recent_funding: "Funding",
  posted_recently: "Posted recently",
  engaged_with_content: "Engaged",
  viewed_profile: "Viewed you",
  follows_company: "Follows you",
  open_to_work: "Open to work",
  other: "Signal",
};

/** The lead list, with the evidence behind every score visible on the row. */
export default async function ProspectsPage() {
  const session = await requireSession();
  const supabase = await createClient();

  const { data: prospects } = await supabase
    .from("prospects")
    .select(
      "id, first_name, last_name, title, company, location, linkedin_url, fit_score, fit_reasons, intent_score, signals, do_not_contact, last_contacted_at",
    )
    .eq("workspace_id", session.workspaceId)
    .order("fit_score", { ascending: false, nullsFirst: false })
    .limit(200);

  if (!prospects?.length) {
    return (
      <>
        <h1 style={{ fontSize: "1.6rem" }}>Prospects</h1>
        <p className="muted">
          None yet. Approve a customer profile and run the Targeting Agent to build your first list.
        </p>
      </>
    );
  }

  return (
    <>
      <h1 style={{ fontSize: "1.6rem" }}>Prospects</h1>
      <p className="muted">
        {prospects.length} in this workspace, ranked by fit. Nobody here can be contacted twice by two
        different reps. Erasing someone removes everything we hold about them and keeps only a
        do-not-contact record, so a later campaign cannot re-import them.
      </p>

      <div className="table-scroll" style={{ marginTop: "1.5rem" }}>
        <table>
          <thead>
            <tr>
              <th>Person</th>
              <th>Fit</th>
              <th>Intent</th>
              <th>Why</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {prospects.map((prospect) => {
              const signals = Array.isArray(prospect.signals) ? (prospect.signals as unknown as Signal[]) : [];
              const reasons = Array.isArray(prospect.fit_reasons) ? (prospect.fit_reasons as string[]) : [];
              return (
                <tr key={prospect.id}>
                  <td>
                    <a
                      href={prospect.linkedin_url.startsWith("http") ? prospect.linkedin_url : `https://${prospect.linkedin_url}`}
                      target="_blank"
                      rel="noreferrer noopener"
                      style={{ fontWeight: 550 }}
                    >
                      {`${prospect.first_name ?? ""} ${prospect.last_name ?? ""}`.trim() || "Unknown"}
                    </a>
                    <p className="small muted" style={{ margin: 0 }}>
                      {[prospect.title, prospect.company].filter(Boolean).join(" · ")}
                    </p>
                  </td>
                  <td className="mono">{prospect.fit_score ?? "—"}</td>
                  <td className="mono">{prospect.intent_score ?? 0}</td>
                  <td style={{ maxWidth: 320 }}>
                    <div style={{ display: "flex", gap: "0.3rem", flexWrap: "wrap", marginBottom: "0.35rem" }}>
                      {signals.slice(0, 3).map((signal, index) => (
                        <span key={index} className="pill accent" title={signal.detail}>
                          {SIGNAL_LABELS[signal.type] ?? signal.type}
                        </span>
                      ))}
                    </div>
                    <span className="small muted">{reasons.join("; ")}</span>
                  </td>
                  <td>
                    {prospect.do_not_contact ? (
                      <span className="pill danger">Do not contact</span>
                    ) : prospect.last_contacted_at ? (
                      <span className="pill">Contacted</span>
                    ) : (
                      <span className="pill positive">New</span>
                    )}
                  </td>
                  <td>
                    {prospect.do_not_contact ? null : (
                      <form action={eraseProspect}>
                        <input type="hidden" name="prospectId" value={prospect.id} />
                        <button
                          className="btn secondary small"
                          type="submit"
                          title="Delete everything we hold about this person, keeping only a do-not-contact record"
                        >
                          Erase
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
