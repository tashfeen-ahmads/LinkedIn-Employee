import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { LINKEDIN_LIMITS, countFunnel, FUNNEL_STAGES } from "@le/shared";
import { requireSession } from "@/lib/workspace";
import { createClient } from "@/lib/supabase-server";
import { errorQuery } from "@/lib/worker";
import { PageNotice, type NoticeParams } from "@/components/page-notice";
import { CONNECTION_NOTE_MAX, daysToSendAll, launchBlockers } from "@/lib/campaign";

/**
 * The review screen. The product's central claim is that a person reads the
 * list and the copy before a single message reaches a stranger, and until this
 * page existed that claim was made by a Launch button on a card showing one of
 * the four messages a campaign sends.
 */

async function saveCampaign(formData: FormData) {
  "use server";
  const campaignId = String(formData.get("campaignId"));
  const session = await requireSession();
  const supabase = await createClient();

  const note = String(formData.get("connectionNote") ?? "").trim();
  const cap = Number(formData.get("dailyInviteCap"));
  const replyMode = String(formData.get("replyMode"));

  await supabase
    .from("campaigns")
    .update({
      connection_note: note,
      // Clamped rather than rejected: the caps are product rules, and a typo in
      // this box must not be able to raise them. Rule 2 in CLAUDE.md.
      daily_invite_cap: Math.max(1, Math.min(LINKEDIN_LIMITS.invitesPerDayMax, Math.round(cap) || 1)),
      ...(replyMode === "autopilot" || replyMode === "approval"
        ? { reply_mode: replyMode as "autopilot" | "approval" }
        : {}),
    })
    .eq("id", campaignId)
    .eq("workspace_id", session.workspaceId);

  // Step messages come back as step-<id> fields so one save covers the whole
  // sequence: editing four messages in four round trips invites a half-edited
  // campaign going live.
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("step-")) continue;
    await supabase
      .from("campaign_steps")
      .update({ message: String(value) })
      .eq("id", key.slice("step-".length))
      .eq("workspace_id", session.workspaceId);
  }

  revalidatePath(`/app/campaigns/${campaignId}`);
}

async function removeFromCampaign(formData: FormData) {
  "use server";
  const campaignProspectId = String(formData.get("campaignProspectId"));
  const campaignId = String(formData.get("campaignId"));
  const session = await requireSession();
  const supabase = await createClient();

  // Closed, not deleted. The row is how we know not to target this person
  // again, and the reason is what a rep reads later.
  await supabase
    .from("campaign_prospects")
    .update({
      status: "closed",
      status_reason: "removed during review",
      closed_at: new Date().toISOString(),
      next_action_at: null,
    })
    .eq("id", campaignProspectId)
    .eq("workspace_id", session.workspaceId)
    .eq("status", "queued");

  revalidatePath(`/app/campaigns/${campaignId}`);
}

/**
 * A rep rewriting the note the agent wrote for one person.
 *
 * `invite_note_edited` is what stops the agent overwriting it later. A rep who
 * rewrote a note and watched it revert would stop trusting the screen, and then
 * stop reading the notes at all — which is the failure this review step exists
 * to prevent.
 *
 * Only while queued. After the invitation is sent the note is a record of what
 * was said, not a draft.
 */
async function saveInviteNote(formData: FormData) {
  "use server";
  const campaignProspectId = String(formData.get("campaignProspectId"));
  const campaignId = String(formData.get("campaignId"));
  const note = String(formData.get("note") ?? "").trim();
  const session = await requireSession();
  const supabase = await createClient();

  // LinkedIn refuses a longer note outright rather than truncating it, so a
  // silent save here would produce an invitation that never sends.
  if (note.length > CONNECTION_NOTE_MAX) {
    redirect(
      errorQuery(
        `/app/campaigns/${campaignId}`,
        `That note is ${note.length} characters. LinkedIn refuses anything over ${CONNECTION_NOTE_MAX}.`,
      ),
    );
  }

  await supabase
    .from("campaign_prospects")
    .update({
      invite_note: note || null,
      invite_note_edited: true,
      // It is the rep's sentence now, so the agent's account of where it came
      // from no longer describes it.
      invite_note_grounding: [],
      invite_note_thin: false,
    })
    .eq("id", campaignProspectId)
    .eq("workspace_id", session.workspaceId)
    .eq("status", "queued");

  revalidatePath(`/app/campaigns/${campaignId}`);
}

async function setStatus(formData: FormData) {
  "use server";
  const campaignId = String(formData.get("campaignId"));
  const status = String(formData.get("status"));
  if (status !== "running" && status !== "paused") return;

  const session = await requireSession();
  const supabase = await createClient();

  // The blockers are re-checked here and not only rendered as a disabled
  // button: a form can be submitted by anyone who can reach the route, and
  // launching is the action that reaches strangers.
  if (status === "running") {
    const state = await launchState(campaignId, session.workspaceId);
    if (!state || launchBlockers(state).length > 0) return;
  }

  await supabase
    .from("campaigns")
    .update({
      status,
      ...(status === "running" ? { launched_at: new Date().toISOString() } : {}),
    })
    .eq("id", campaignId)
    .eq("workspace_id", session.workspaceId);

  revalidatePath(`/app/campaigns/${campaignId}`);
}

/** Reads exactly what launchBlockers needs, for the server-action re-check. */
async function launchState(campaignId: string, workspaceId: string) {
  const supabase = await createClient();
  const { data: campaign } = await supabase
    .from("campaigns")
    .select("connection_note, daily_invite_cap, linkedin_account_id")
    .eq("id", campaignId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!campaign) return null;

  const [{ data: steps }, { count }, { data: account }] = await Promise.all([
    supabase.from("campaign_steps").select("message, delay_days").eq("campaign_id", campaignId),
    supabase
      .from("campaign_prospects")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", campaignId)
      .eq("status", "queued"),
    supabase
      .from("linkedin_accounts")
      .select("status")
      .eq("id", campaign.linkedin_account_id)
      .maybeSingle(),
  ]);

  return {
    connectionNote: campaign.connection_note,
    steps: (steps ?? []).map((s) => ({ message: s.message, delayDays: s.delay_days })),
    dailyInviteCap: campaign.daily_invite_cap,
    prospectCount: count ?? 0,
    accountStatus: account?.status ?? null,
  };
}

/**
 * What the search could not filter on, as the targeting job recorded it.
 *
 * Read defensively: `rules` is jsonb written by the worker, and a campaign
 * created before this existed has none. A crash on the campaign page would be a
 * worse outcome than a missing notice.
 */
function droppedSearchFilters(rules: unknown): string[] {
  if (!rules || typeof rules !== "object") return [];
  const value = (rules as { droppedFilters?: unknown }).droppedFilters;
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function listInWords(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

export default async function CampaignPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: NoticeParams;
}) {
  const notice = await searchParams;
  const { id } = await params;
  const session = await requireSession();
  const supabase = await createClient();

  const { data: campaign } = await supabase
    .from("campaigns")
    .select("id, name, status, connection_note, daily_invite_cap, reply_mode, launched_at, linkedin_account_id, rules")
    .eq("id", id)
    .eq("workspace_id", session.workspaceId)
    .maybeSingle();
  if (!campaign) notFound();

  const [{ data: steps }, { data: members }, { data: account }] = await Promise.all([
    supabase
      .from("campaign_steps")
      .select("id, step_number, delay_days, message")
      .eq("campaign_id", id)
      .order("step_number"),
    supabase
      .from("campaign_prospects")
      .select("id, status, status_reason, invited_at, accepted_at, replied_at, invite_note, invite_note_grounding, invite_note_thin, invite_note_edited, prospects (id, first_name, last_name, headline, title, company, location, linkedin_url, fit_score, fit_reasons)")
      .eq("campaign_id", id)
      .order("created_at"),
    supabase.from("linkedin_accounts").select("status, display_name").eq("id", campaign.linkedin_account_id).maybeSingle(),
  ]);

  const rows = members ?? [];
  const queued = rows.filter((row) => row.status === "queued");
  const counts = countFunnel(rows);
  const blockers = launchBlockers({
    connectionNote: campaign.connection_note,
    steps: (steps ?? []).map((s) => ({ message: s.message, delayDays: s.delay_days })),
    dailyInviteCap: campaign.daily_invite_cap,
    prospectCount: queued.length,
    accountStatus: account?.status ?? null,
  });
  const days = daysToSendAll(queued.length, campaign.daily_invite_cap);
  const dropped = droppedSearchFilters(campaign.rules);
  const running = campaign.status === "running";
  const reached = FUNNEL_STAGES.filter((stage) => counts[stage.key] > 0);

  return (
    <>
      <PageNotice error={notice.error} notice={notice.notice} />
      <p className="small muted">
        <Link href="/app/campaigns">← Campaigns</Link>
      </p>
      <div
        style={{ display: "flex",
          justifyContent: "space-between",
          gap: "1rem",
          flexWrap: "wrap",
          alignItems: "flex-start" }}
      >
        <div>
          <h1 style={{ fontSize: "1.6rem", margin: 0 }}>{campaign.name}</h1>
          <p className="small muted" style={{ margin: "0.25rem 0 0" }}>
            <span className={`pill ${running ? "positive" : ""}`}>{campaign.status}</span>{" "}
            {queued.length} still to invite of {rows.length}
            {days ? ` · about ${days} working ${days === 1 ? "day" : "days"} at ${campaign.daily_invite_cap} a day` : ""}
            {account?.display_name ? ` · sending as ${account.display_name}` : ""}
          </p>
        </div>
        <form action={setStatus}>
          <input type="hidden" name="campaignId" value={campaign.id} />
          <input type="hidden" name="status" value={running ? "paused" : "running"} />
          <button className="btn" type="submit" disabled={!running && blockers.length > 0}>
            {running ? "Pause" : "Launch campaign"}
          </button>
        </form>
      </div>

      {dropped.length > 0 ? (
        <div className="notice">
          <strong>This list was built without Sales Navigator</strong>
          <p className="small" style={{ margin: "0.35rem 0 0" }}>
            Classic LinkedIn search cannot filter on {listInWords(dropped)}, so{" "}
            {dropped.length === 1 ? "that part" : "those parts"} of your customer profile
            {dropped.length === 1 ? " was" : " were"} not applied. Everyone below still matched on
            title, industry and location, and each was scored against the full profile — read the
            names before launching, and expect more of them to be wrong than usual.
          </p>
        </div>
      ) : null}

      {blockers.length > 0 && !running ? (
        <div className="notice danger">
          <strong>Not ready to launch</strong>
          <ul style={{ margin: "0.5rem 0 0", paddingLeft: "1.1rem" }}>
            {blockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {reached.length > 0 ? (
        <section className="card">
          <div style={{ display: "flex", gap: "2rem", flexWrap: "wrap" }}>
            {reached.map((stage) => (
              <div key={stage.key}>
                <p className="small muted">
                  {stage.label}
                </p>
                <p className="mono" style={{ margin: 0, fontWeight: 600, fontSize: "1.25rem" }}>
                  {counts[stage.key]}
                </p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <form action={saveCampaign}>
        <input type="hidden" name="campaignId" value={campaign.id} />

        <section className="card">
          <h3>What gets sent</h3>
          <p className="small muted">
            {"Read all of it. Only {{first_name}} is substituted; anything else stays literal."}
            {running ? " Edits apply to everyone who has not been reached yet." : ""}
          </p>

          <label className="field">
            <span>
              Connection request · at most {CONNECTION_NOTE_MAX} characters
            </span>
            <textarea
              name="connectionNote"
              rows={3}
              defaultValue={campaign.connection_note}
              maxLength={CONNECTION_NOTE_MAX}
            />
          </label>

          {(steps ?? []).map((step) => (
            <label className="field" key={step.id}>
              <span>
                Follow-up {step.step_number} · {step.delay_days}{" "}
                {step.delay_days === 1 ? "day" : "days"} after the previous message
              </span>
              <textarea name={`step-${step.id}`} rows={3} defaultValue={step.message} />
            </label>
          ))}

          <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", alignItems: "flex-end" }}>
            <label className="field" style={{ width: 170 }}>
              <span>Invites a day</span>
              <input
                type="number"
                name="dailyInviteCap"
                min={1}
                max={LINKEDIN_LIMITS.invitesPerDayMax}
                defaultValue={campaign.daily_invite_cap}
              />
            </label>
            <label className="field" style={{ width: 220 }}>
              <span>Replies</span>
              <select name="replyMode" defaultValue={campaign.reply_mode}>
                <option value="approval">Hold for my approval</option>
                <option value="autopilot">Send clean replies for me</option>
              </select>
            </label>
            <button className="btn secondary" type="submit">
              Save
            </button>
          </div>
          <p className="small muted" style={{ margin: "0.75rem 0 0" }}>
            Pricing, legal and anything negative always waits for a person, on either setting. The
            ceiling of {LINKEDIN_LIMITS.invitesPerDayMax} a day is a safety limit, not a preference.
          </p>
        </section>
      </form>

      <section className="stack-4">
        <div className="between">
          <h2>Who is on the list</h2>
          <p className="tiny subtle">
            {rows.length} {rows.length === 1 ? "person" : "people"}
          </p>
        </div>

        {rows.length === 0 ? (
          <p className="small muted">Nobody yet.</p>
        ) : (
          <ul className="prospect-list">
            {rows.map((row) => {
              const prospect = row.prospects as unknown as {
                id: string;
                first_name: string | null;
                last_name: string | null;
                headline: string | null;
                title: string | null;
                company: string | null;
                location: string | null;
                linkedin_url: string;
                fit_score: number | null;
                fit_reasons: string[] | null;
              } | null;
              if (!prospect) return null;

              const name = [prospect.first_name, prospect.last_name].filter(Boolean).join(" ") || "—";
              const grounding = (row.invite_note_grounding ?? []) as string[];
              const queued = row.status === "queued";

              return (
                <li key={row.id} className="card prospect-card">
                  <div className="between">
                    <div className="stack-1 grow">
                      <div className="cluster">
                        <a
                          href={`https://${prospect.linkedin_url.replace(/^https?:\/\//, "")}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <strong>{name}</strong>
                        </a>
                        {prospect.fit_score !== null ? (
                          <span className="pill plain tiny mono">fit {prospect.fit_score}</span>
                        ) : null}
                        <span className={`pill tiny ${row.status === "meeting_booked" ? "positive" : "plain"}`}>
                          {row.status.replaceAll("_", " ")}
                        </span>
                      </div>
                      <p className="small muted">
                        {prospect.title ?? prospect.headline ?? "—"}
                        {prospect.company ? ` · ${prospect.company}` : ""}
                        {prospect.location ? ` · ${prospect.location}` : ""}
                      </p>
                    </div>
                    {queued ? (
                      <form action={removeFromCampaign}>
                        <input type="hidden" name="campaignProspectId" value={row.id} />
                        <input type="hidden" name="campaignId" value={campaign.id} />
                        <button className="btn ghost small" type="submit">
                          Remove
                        </button>
                      </form>
                    ) : null}
                  </div>

                  {prospect.fit_reasons?.length ? (
                    <div className="stack-1">
                      <p className="tiny subtle">Why this person</p>
                      <ul className="bullets small muted">
                        {prospect.fit_reasons.map((reason) => (
                          <li key={reason}>{reason}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {/* What this person actually receives. Until notes existed
                      everyone in a campaign got identical words, and this is
                      the screen where that is now visible before it is sent. */}
                  <div className="stack-2">
                    <div className="cluster">
                      <p className="tiny subtle">Their connection note</p>
                      {row.invite_note_edited ? (
                        <span className="pill plain tiny">edited by you</span>
                      ) : row.invite_note_thin ? (
                        <span className="pill warning tiny">too little to go on</span>
                      ) : !row.invite_note ? (
                        <span className="pill warning tiny">campaign template</span>
                      ) : null}
                    </div>

                    {queued ? (
                      <form action={saveInviteNote} className="stack-2">
                        <input type="hidden" name="campaignProspectId" value={row.id} />
                        <input type="hidden" name="campaignId" value={campaign.id} />
                        <label className="field">
                          <span className="sr-only">Connection note for {name}</span>
                          <textarea
                            name="note"
                            rows={3}
                            maxLength={CONNECTION_NOTE_MAX}
                            defaultValue={row.invite_note ?? ""}
                            placeholder={campaign.connection_note}
                          />
                        </label>
                        <div className="between">
                          <p className="tiny subtle">
                            {row.invite_note
                              ? `${row.invite_note.length}/${CONNECTION_NOTE_MAX}`
                              : "Empty sends the campaign template."}
                          </p>
                          <button className="btn secondary small" type="submit">
                            Save note
                          </button>
                        </div>
                      </form>
                    ) : (
                      <blockquote className="quote small">{row.invite_note ?? campaign.connection_note}</blockquote>
                    )}

                    {grounding.length ? (
                      <p className="tiny subtle">
                        Grounded in: {grounding.join(" · ")}
                      </p>
                    ) : row.invite_note && !row.invite_note_edited ? (
                      <p className="tiny warning-text">
                        Nothing specific to this person — this note could have gone to anybody.
                      </p>
                    ) : null}
                  </div>

                  {row.status_reason ? <p className="tiny muted">{row.status_reason}</p> : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
