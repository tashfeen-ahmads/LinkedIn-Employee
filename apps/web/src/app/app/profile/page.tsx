import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/workspace";
import { createClient } from "@/lib/supabase-server";
import { callWorker, errorQuery, noticeQuery } from "@/lib/worker";
import { checkCtaUrl, LINKEDIN_LIMITS } from "@le/shared";
import { cannotSend, describeRepair, type RefreshResult, type RepairNotice } from "../team/repair";
import { PageNotice } from "@/components/page-notice";
import { PageHeader, Section } from "@/components/page";

/**
 * You, and the account you send from.
 *
 * This was four unrelated things on one page called Team: your bio, your
 * LinkedIn connection, the invite form, and the member list. Two of those are
 * about a person and two are about a company, and a rep looking for "where do
 * I reconnect LinkedIn" had to read past an invite form to find it.
 *
 * So the split is by whose thing it is. This page is yours — how the agent
 * writes as you, when it is allowed to send, and the account it sends from.
 * Team is the workspace: who else is in it.
 */

/**
 * Starts LinkedIn's hosted consent flow.
 *
 * There were five of these — Google Calendar, Microsoft, HubSpot, Salesforce —
 * pointed at worker routes that do not exist and never did. The worker answered
 * 404, `callWorker` swallowed it and returned null, and the button did nothing
 * at all: no error, no navigation, no change on the page. The four have been
 * removed rather than left looking available.
 */
async function connectLinkedIn() {
  "use server";
  const session = await requireSession();
  const result = await callWorker<{ url?: string }>("/auth/linkedin/link", {
    workspaceId: session.workspaceId,
    userId: session.userId,
  });
  if (!result.ok) redirect(errorQuery("/app/profile", result.error));
  if (!result.data?.url) {
    redirect(errorQuery("/app/profile", "LinkedIn did not return a sign-in link. Please try again."));
  }
  redirect(result.data.url);
}

/**
 * Asks the provider whether this rep's account is connected, instead of waiting
 * to be told.
 *
 * The hosted flow reports success by calling a webhook once. If that delivery
 * is rejected — a signature mismatch, a restart, a webhook registered after the
 * account already connected — the account works perfectly at the provider and
 * sits here as "connecting" forever, with a Start again button that runs the
 * same flow to the same end. This is the way out of that, and it costs one
 * request.
 */
async function refreshLinkedIn() {
  "use server";
  const session = await requireSession();
  const result = await callWorker<{
    bound?: number;
    mine?: number;
    found?: number;
    referenceShape?: string[];
    changed?: boolean;
    lost?: boolean;
  }>("/jobs/linkedin-refresh", { workspaceId: session.workspaceId, userId: session.userId });
  if (!result.ok) redirect(errorQuery("/app/profile", result.error));

  // The account this row claimed to hold is gone from the provider. Said out
  // loud because the row looked healthy while every campaign silently failed
  // against it, and because pressing Connect is all it takes.
  if (result.data?.lost) {
    redirect(
      errorQuery(
        "/app/profile",
        "LinkedIn's provider no longer has the account this was connected to. Connect LinkedIn again to start sending.",
      ),
    );
  }

  if (result.data?.changed) {
    redirect(
      noticeQuery(
        "/app/profile",
        "Reconnected: LinkedIn's provider had a different account for you, and this is now pointed at it.",
      ),
    );
  }

  if (!result.data?.mine) {
    // "No account yet" and "an account that is not labelled with your id" look
    // identical from here and need completely different things done about them,
    // so they are said differently.
    const found = result.data?.found ?? 0;
    redirect(
      errorQuery(
        "/app/profile",
        found === 0
          ? "LinkedIn's provider has no account for you yet. If you just finished signing in, give it a few seconds and check again."
          : // "This needs an administrator" was the wrong sentence and the wrong
            // person. The rep reading it usually *is* the administrator, and no
            // amount of admin fixes this: an account labelled with a person's
            // name was connected inside the provider's own dashboard, and the
            // only thing that writes this rep's id onto one is this flow. The
            // panel on the same page already said so, so the screen gave two
            // instructions for one state and the wrong one was the actionable-
            // sounding one.
            `LinkedIn's provider has ${found} account${found === 1 ? "" : "s"}, but ${found === 1 ? "it is" : "none is"} labelled with a name rather than your account here (${result.data?.referenceShape?.join(", ") ?? "unknown"}) — which is what connecting inside the provider's own dashboard looks like from here. Delete that one in the provider, then press Connect LinkedIn below: signing in through this flow is what writes your id onto the account.`,
      ),
    );
  }
  revalidatePath("/app/profile");
}


async function saveMyDetails(formData: FormData) {
  "use server";
  const bio = String(formData.get("bio") ?? "").trim();
  const timezone = String(formData.get("timezone") ?? "").trim();

  // Your own scheduling link, if you use one.
  //
  // The product owns a booking page and it works, but a rep who has used
  // Calendly for three years keeps their availability, buffers and reminders
  // there — asking them to maintain a second calendar so a LinkedIn reply can
  // offer a time is asking them to maintain two. Google Calendar is the option
  // that cannot be built: its scopes need brand verification, a verified domain
  // and weeks of review. One pasted URL works the day somebody signs up.
  const raw = String(formData.get("bookingUrl") ?? "").trim();
  let bookingUrl: string | null = null;
  if (raw) {
    // Checked before it is stored, because the agent will send it to a stranger
    // under this person's own name. The reason is shown rather than a generic
    // refusal — somebody who pasted "cal.com/sam" needs telling it is missing
    // the https://, not that it is invalid.
    const checked = checkCtaUrl(raw);
    if (!checked.ok) redirect(errorQuery("/app/profile", checked.reason));
    bookingUrl = checked.url;
  }

  const session = await requireSession();
  const supabase = await createClient();
  await supabase
    .from("profiles")
    .update({
      bio: bio || null,
      booking_url: bookingUrl,
      ...(isKnownTimezone(timezone) ? { timezone } : {}),
    })
    .eq("id", session.userId);

  revalidatePath("/app/profile");
}

/**
 * When this account is allowed to act. Read by the rate limiter before every
 * send and never settable until now, so every rep was on the same 8am-to-6pm
 * weekday default whatever their day actually looks like.
 */

async function saveWorkingHours(formData: FormData) {
  "use server";
  const start = Number(formData.get("start"));
  const end = Number(formData.get("end"));
  const days = [1, 2, 3, 4, 5, 6, 0].filter((day) => formData.get(`day-${day}`) === "on");

  // A window that is empty or inverted would either send nothing or send at
  // three in the morning; neither is a setting anyone means to choose.
  if (!Number.isInteger(start) || !Number.isInteger(end)) return;
  if (start < 0 || end > 24 || start >= end || days.length === 0) return;

  const session = await requireSession();
  const supabase = await createClient();
  await supabase
    .from("linkedin_accounts")
    .update({ working_hours: { start, end, days } as never })
    .eq("workspace_id", session.workspaceId)
    .eq("user_id", session.userId);

  revalidatePath("/app/profile");
}

/**
 * Whether this rep has a Sales Navigator seat.
 *
 * It decides which search the Targeting Agent runs, and getting it wrong is
 * silent in both directions: claim a seat you do not have and the search
 * returns nothing, which reads as "your customer profile matched nobody";
 * leave it off when you do have one and every campaign is built from classic
 * search with half the profile ignored.
 */

async function saveSalesNavigator(formData: FormData) {
  "use server";
  const has = formData.get("hasSalesNavigator") === "on";

  const session = await requireSession();
  const supabase = await createClient();
  await supabase
    .from("linkedin_accounts")
    .update({ has_sales_navigator: has })
    .eq("workspace_id", session.workspaceId)
    .eq("user_id", session.userId);

  revalidatePath("/app/profile");
}

/** Validated against the runtime's own list rather than a hand-kept one. */
function isKnownTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}


export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string; connected?: string }>;
}) {
  const params = await searchParams;
  const session = await requireSession();
  const supabase = await createClient();

  // Coming back from the provider's hosted login, and also on any arrival while
  // this rep's account is not working.
  //
  // The connection is finished at the provider by the time the redirect fires,
  // but the row here is bound by a webhook — and a webhook that does not arrive
  // left the rep looking at "sending is paused" one second after being told
  // they had succeeded. The account_id in the URL is deliberately ignored:
  // binding whatever id a query string names would let anyone attach somebody
  // else's provider account to their own row. This asks the provider instead.
  //
  // Bounded on purpose: it only runs while the account is already broken, so a
  // working deployment makes no provider call here at all.
  const { data: current } = await supabase
    .from("linkedin_accounts")
    .select("status")
    .eq("workspace_id", session.workspaceId)
    .eq("user_id", session.userId)
    .maybeSingle();

  // What it learned is rendered, not discarded. The first version called the
  // worker and threw the answer away: it asked the provider, was told "there
  // are accounts here but none of them is yours", and showed an unchanged page.
  let repair: RepairNotice | null = null;
  if (params.connected === "1" || (current && current.status !== "active")) {
    const result = await callWorker<RefreshResult>("/jobs/linkedin-refresh", {
      workspaceId: session.workspaceId,
      userId: session.userId,
    });
    repair = describeRepair(result);
  }

  const [{ data: account }, { data: me }] = await Promise.all([
    supabase
      .from("linkedin_accounts")
      .select(
        "user_id, status, status_detail, display_name, invites_today, invites_this_week, messages_today, has_sales_navigator, working_hours",
      )
      .eq("workspace_id", session.workspaceId)
      .eq("user_id", session.userId)
      .maybeSingle(),
    supabase.from("profiles").select("bio, timezone, booking_url").eq("id", session.userId).maybeSingle(),
  ]);

  // A row still `connecting` has no provider id, so nothing can send from it.
  // Treating it as connected showed usage bars for an account that does not
  // work yet, and took away the only button that could fix it.
  const found = account ?? undefined;
  const mine = found?.status === "connecting" ? undefined : found;
  const awaitingProvider = found?.status === "connecting";
  const needsReconnect = cannotSend(found?.status);
  const hours = readWorkingHours(mine?.working_hours);

  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="Your profile"
        lede="How the agent writes as you, when it may send, and the LinkedIn account it sends from."
      />

      <PageNotice error={params.error} notice={params.notice} />
      {repair ? (
        <div className={`notice ${repair.tone}`} role="status">
          <p>
            <strong>{repair.title}</strong> {repair.body}
          </p>
          {repair.fix ? <p className="small">{repair.fix}</p> : null}
        </div>
      ) : null}

      <section className="card">
        <h3>How you sound</h3>
        <p className="small muted">
          The agent writes in your voice and sends inside your working day, so both of these change
          what a prospect receives.
        </p>
        <form action={saveMyDetails}>
          <label className="field">
            <span>How you would describe yourself to a prospect</span>
            <textarea
              name="bio"
              rows={3}
              defaultValue={me?.bio ?? ""}
              placeholder="Twelve years in logistics ops before this. I care about the boring parts."
            />
          </label>
          {/*
            The link the agent sends when a campaign is asking for a meeting.
            Optional: without one the product offers times from its own
            calendar, which it can see and protect from double-booking.
          */}
          <label className="field medium">
            <span>Your scheduling link · optional</span>
            <input
              type="url"
              name="bookingUrl"
              placeholder="https://cal.com/you/intro"
              defaultValue={me?.booking_url ?? ""}
            />
            <span className="tiny subtle">
              Calendly, Cal.com, SavvyCal — whatever you already use. The agent sends this instead of
              offering times from here. A booking made there is invisible to this product, so meetings
              booked through your own link will not appear in the funnel; everything up to the reply
              still does.
            </span>
          </label>
          <label className="field medium">
            <span>Your timezone</span>
            <input name="timezone" defaultValue={me?.timezone ?? "UTC"} placeholder="Europe/London" />
          </label>
          <button className="btn secondary" type="submit">
            Save
          </button>
        </form>
      </section>

      <section className="card">
        <h3>Your LinkedIn account</h3>
        {mine ? (
          <>
            <p className="small muted">
              {mine.display_name ?? "Connected"} · {mine.status}
              {mine.has_sales_navigator ? " · Sales Navigator" : ""}
            </p>

            {needsReconnect ? (
              <div className="notice danger">
                <p>
                  <strong>This account cannot send.</strong>{" "}
                  {mine.status_detail ?? "It needs to be connected again."}
                </p>
                <p className="small">
                  Sign in through this flow rather than in the provider&rsquo;s own dashboard — that
                  is what attaches the account to you here.
                </p>
                <form action={connectLinkedIn}>
                  <button className="btn" type="submit">
                    Connect LinkedIn again
                  </button>
                </form>
              </div>
            ) : (
              /* Hidden while the account cannot send. Three bars reading 0/35
                 next to "reauth required" describe an allowance that does not
                 exist, and read as a working account to anyone skimming. */
              <div className="meter-group">
                <Usage label="Invites today" used={mine.invites_today} cap={LINKEDIN_LIMITS.invitesPerDayMax} />
                <Usage label="Invites this week" used={mine.invites_this_week} cap={LINKEDIN_LIMITS.invitesPerWeek} />
                <Usage label="Messages today" used={mine.messages_today} cap={LINKEDIN_LIMITS.messagesPerDay} />
              </div>
            )}

            <form action={saveSalesNavigator}>
              <label className="small check">
                <input
                  type="checkbox"
                  name="hasSalesNavigator"
                  defaultChecked={mine.has_sales_navigator}
                 
                />
                <span>
                  This account has Sales Navigator
                  <span className="tiny subtle hint">
                    Without it, prospect search cannot filter on seniority or company size, and
                    campaigns say so before you launch them. With it, the full customer profile is
                    used.
                  </span>
                </span>
              </label>
              <button className="btn small" type="submit">
                Save
              </button>
            </form>

            <form action={saveWorkingHours}>
              <p className="small muted">
                Nothing is sent from this account outside these hours, read in your timezone above.
              </p>
              <div className="form-row">
                <label className="field compact">
                  <span>From</span>
                  <input type="number" name="start" min={0} max={23} defaultValue={hours.start} />
                </label>
                <label className="field compact">
                  <span>To</span>
                  <input type="number" name="end" min={1} max={24} defaultValue={hours.end} />
                </label>
                <div className="cluster-3">
                  {DAYS.map((day) => (
                    <label key={day.value} className="small check">
                      <input
                        type="checkbox"
                        name={`day-${day.value}`}
                        defaultChecked={hours.days.includes(day.value)}
                      />
                      {day.label}
                    </label>
                  ))}
                </div>
                <button className="btn secondary small" type="submit">
                  Save hours
                </button>
              </div>
            </form>

            {/* Connected is a claim this page makes, not one it has checked.
                The row keeps whatever provider id it was bound with, and when
                the provider drops that account nothing here notices until the
                nightly health poll — so every campaign fails against an
                account the screen calls healthy, and the only control that
                could correct it used to live in the branch below, where a
                connected account never sees it. */}
            <div className="cluster">
              <form action={refreshLinkedIn}>
                <button className="btn secondary small" type="submit">
                  Check connection
                </button>
              </form>
              <span className="tiny subtle">
                Asks LinkedIn&rsquo;s provider whether this account is still there. Worth doing if
                campaigns are not finding anyone.
              </span>
            </div>
          </>
        ) : (
          <>
            <p className="small muted">
              {awaitingProvider
                ? "Waiting for LinkedIn to confirm the connection. If you have already finished signing in, check again — the confirmation sometimes does not arrive, and checking asks directly."
                : "Not connected yet. You will sign in to LinkedIn on their hosted page; we never see your password."}
            </p>
            <div className="cluster">
              {/* While waiting, checking is the likelier fix and goes first:
                  the account is usually already connected at the provider and
                  only the notification went missing. */}
              {awaitingProvider ? (
                <form action={refreshLinkedIn}>
                  <button className="btn" type="submit">
                    Check again
                  </button>
                </form>
              ) : null}
              <form action={connectLinkedIn}>
                <button className={awaitingProvider ? "btn secondary" : "btn"} type="submit">
                  {awaitingProvider ? "Start again" : "Connect LinkedIn"}
                </button>
              </form>
            </div>
          </>
        )}
      </section>
    </>
  );
}

const DAYS = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 0, label: "Sun" },
] as const;

/** The same shape and fallback the worker's limiter applies to this column. */
function readWorkingHours(value: unknown): { start: number; end: number; days: number[] } {
  const fallback = { start: 8, end: 18, days: [1, 2, 3, 4, 5] };
  if (!value || typeof value !== "object") return fallback;
  const hours = value as Partial<{ start: number; end: number; days: number[] }>;
  if (typeof hours.start === "number" && typeof hours.end === "number" && Array.isArray(hours.days)) {
    return { start: hours.start, end: hours.end, days: hours.days };
  }
  return fallback;
}

function Usage({ label, used, cap }: { label: string; used: number; cap: number }) {
  const ratio = Math.min(1, cap === 0 ? 0 : used / cap);
  return (
    <div className="meter-item">
      <span className="stat-label">{label}</span>
      <span className="mono small">
        {used} / {cap}
      </span>
      {/* The width is the only genuinely dynamic value here; the colour it
          turns near the cap is a state, so it is a class. */}
      <div className={`meter${ratio > 0.85 ? " is-near" : ""}`}>
        <span style={{ width: `${ratio * 100}%` }} />
      </div>
    </div>
  );
}
