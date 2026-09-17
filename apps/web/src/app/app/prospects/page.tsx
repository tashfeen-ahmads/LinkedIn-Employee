import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/workspace";
import { createClient } from "@/lib/supabase-server";
import { callWorker, errorQuery } from "@/lib/worker";
import { isPublicProfileUrl } from "@le/shared";
import { redirect } from "next/navigation";
import { PageNotice } from "@/components/page-notice";

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
  // Erasure is a promise made to a person about their own data. A silent
  // failure here leaves them in the database while the screen says they are
  // gone, so this one is reported rather than retried in the background.
  const erased = await callWorker("/jobs/erase-prospect", {
    workspaceId: session.workspaceId,
    userId: session.userId,
    prospectId,
    reason: "requested by the individual",
  });
  if (!erased.ok) {
    redirect(errorQuery("/app/prospects", `This person was not erased: ${erased.error}`));
  }
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
export default async function ProspectsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string; show?: string }>;
}) {
  const params = await searchParams;
  const session = await requireSession();
  const supabase = await createClient();

  // Contacted people first, and by when. "There is no backup of the data — who
  // I have reached out to, who I know" was the report, and it was accurate: the
  // list was ranked by fit score, so somebody messaged last week sat wherever
  // their score put them, indistinguishable at a glance from somebody nobody
  // has ever written to.
  const showing = params.show === "contacted" ? "contacted" : params.show === "new" ? "new" : "all";

  let query = supabase
    .from("prospects")
    .select(
      "id, provider_id, first_name, last_name, headline, title, company, location, linkedin_url, fit_score, fit_reasons, intent_score, signals, do_not_contact, last_contacted_at",
    )
    .eq("workspace_id", session.workspaceId);

  if (showing === "contacted") query = query.not("last_contacted_at", "is", null);
  if (showing === "new") query = query.is("last_contacted_at", null);

  const { data: prospects } = await query
    // Most recently contacted first when that is what is being read; by fit
    // otherwise, which is the order you build a list in rather than review one.
    .order(showing === "contacted" ? "last_contacted_at" : "fit_score", {
      ascending: false,
      nullsFirst: false,
    })
    .limit(200);

  const [{ count: contactedCount }, { count: totalCount }] = await Promise.all([
    supabase
      .from("prospects")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", session.workspaceId)
      .not("last_contacted_at", "is", null),
    supabase
      .from("prospects")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", session.workspaceId),
  ]);

  if (!prospects?.length && showing === "all") {
    return (
      <>
        <div className="page-head">
          <h1>Prospects</h1>
          <p className="muted">
            None yet. Approve a customer profile and run the Targeting Agent to build your first list.
          </p>
        </div>
      </>
    );
  }

  return (
    <>
      <PageNotice error={params.error} notice={params.notice} />
      <div className="page-head">
        <h1>Prospects</h1>
        <p className="muted">
          {totalCount ?? 0} in this workspace, {contactedCount ?? 0} of whom have been contacted. Once
          somebody has been reached out to they are never added to another campaign — checked again in
          the moment before every send, not only when a list is built. Erasing someone removes
          everything we hold about them and keeps only a do-not-contact record, so a later campaign
          cannot re-import them.
        </p>
        {/*
          The history, as a place to stand rather than a column to squint at.
          Ranked by fit, somebody messaged last week sat wherever their score
          put them and looked exactly like somebody nobody had ever written to.
        */}
        <nav className="tabs" aria-label="Which prospects to show">
          {(
            [
              { key: "all", label: `Everyone (${totalCount ?? 0})` },
              { key: "contacted", label: `Contacted (${contactedCount ?? 0})` },
              { key: "new", label: `Not yet contacted (${Math.max(0, (totalCount ?? 0) - (contactedCount ?? 0))})` },
            ] as const
          ).map((tab) => (
            <a
              key={tab.key}
              className={`pill ${showing === tab.key ? "accent" : ""}`}
              href={tab.key === "all" ? "/app/prospects" : `/app/prospects?show=${tab.key}`}
              aria-current={showing === tab.key ? "page" : undefined}
            >
              {tab.label}
            </a>
          ))}
        </nav>
      </div>

      {prospects?.length === 0 ? (
        <p className="small muted">
          {showing === "contacted"
            ? "Nobody has been contacted yet."
            : "Everybody here has been contacted."}
        </p>
      ) : null}

      <div className="table-scroll">
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
            {(prospects ?? []).map((prospect) => {
              const signals = Array.isArray(prospect.signals) ? (prospect.signals as unknown as Signal[]) : [];
              const reasons = Array.isArray(prospect.fit_reasons) ? (prospect.fit_reasons as string[]) : [];
              return (
                <tr key={prospect.id}>
                  <td>
                    {/* A name is whatever we actually know. LinkedIn's search
                        returns one `name` field and the profile endpoint splits
                        it, so a card built only from the split pair showed a
                        blank for every real person on the list — and the
                        headline, which was there all along, was hidden under
                        it. Falling back to the headline is not a placeholder:
                        "Membership Director at Lawton Fort Sill Chamber of
                        Commerce" is the most useful line on the card. */}
                    {isPublicProfileUrl(prospect.linkedin_url, prospect.provider_id) ? (
                      <a
                        className="strongish"
                        href={prospect.linkedin_url.startsWith("http") ? prospect.linkedin_url : `https://${prospect.linkedin_url}`}
                        target="_blank"
                        rel="noreferrer noopener"
                      >
                        {displayName(prospect)}
                      </a>
                    ) : (
                      /* Not every profile has a public address: LinkedIn hides
                         the vanity URL outside your network and shows those
                         people as "LinkedIn Member". They are real and can
                         still be messaged through the provider — but a link
                         here would 404, and a rep who clicks one concludes the
                         whole list is invented. */
                      <span className="strongish" title="This profile has no public LinkedIn address. They can still be invited and messaged.">
                        {displayName(prospect)}
                      </span>
                    )}
                    <p className="small muted">
                      {[prospect.title, prospect.company].filter(Boolean).join(" · ") ||
                        (displayName(prospect) === prospect.headline ? "" : prospect.headline ?? "")}
                    </p>
                  </td>
                  <td className="mono">{prospect.fit_score ?? "—"}</td>
                  <td className="mono">{prospect.intent_score ?? 0}</td>
                  <td className="medium">
                    <div className="cluster">
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
                      // The date, not just the fact. "Contacted" alone cannot
                      // answer the question somebody opens this page with,
                      // which is when, and therefore whether it was this
                      // campaign or one from two months ago.
                      <span className="pill" title={prospect.last_contacted_at}>
                        Contacted {prospect.last_contacted_at.slice(0, 10)}
                      </span>
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

/**
 * What to call somebody on screen.
 *
 * A blank name is never shown: fourteen real prospects rendering as "Unknown"
 * is what made a working list look like fake data. The headline is the next
 * best thing and is usually the most informative line we have about them.
 */
function displayName(prospect: { first_name: string | null; last_name: string | null; headline: string | null }): string {
  const name = `${prospect.first_name ?? ""} ${prospect.last_name ?? ""}`.trim();
  if (name) return name;
  return prospect.headline?.trim() || "LinkedIn member";
}
