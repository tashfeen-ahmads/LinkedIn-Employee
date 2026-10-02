import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/workspace";
import { createClient } from "@/lib/supabase-server";
import { callWorker, errorQuery, noticeQuery } from "@/lib/worker";
import { checkCtaUrl, LINKEDIN_LIMITS, describeWorkingHours } from "@le/shared";
import { TimezoneSelect } from "@/components/timezone-select";
import { cannotSend, describeRepair, type RefreshResult, type RepairNotice } from "../team/repair";
import { PageNotice } from "@/components/page-notice";
import { SubmitButton } from "@/components/submit-button";
import { TeamSection } from "./team-section";
import { BillingSection } from "./billing-section";
import { PageHeader, PageGroup, Panel, Section } from "@/components/page";
import { AllowanceMeter } from "@/components/charts";

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
  // `RefreshResult`, not a second copy of it written inline. The shape was
  // declared twice — here and in repair.ts — so the panel and the button read
  // the same response through two types that had already drifted, and a field
  // added to one was invisible to the other.
  const result = await callWorker<RefreshResult>("/jobs/linkedin-refresh", {
    workspaceId: session.workspaceId,
    userId: session.userId,
  });
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
            `LinkedIn's provider has ${found} account${found === 1 ? "" : "s"}, none matching your id here. Expected ${result.data?.expected ?? "uuid"}, found ${result.data?.referenceShape?.join(", ") ?? "unknown"}. Fields the provider sent: ${JSON.stringify(result.data?.fields?.[0] ?? {})}`,
      ),
    );
  }
  revalidatePath("/app/profile");
}


/**
 * Everything on this screen, saved once.
 *
 * It replaces four actions with four buttons — one for the bio and the
 * scheduling link, one for the Sales Navigator tick, one for the working
 * hours, one for autonomy. A settings page that is permanently in edit mode
 * and asks to be saved in four places is a page where somebody changes two
 * things, presses the Save they can see, and loses the other one. Nothing on
 * screen said which button owned which field.
 *
 * So the page has a state: it shows the profile, and editing is a thing you
 * start and finish. Every validation the four actions carried is still here —
 * they were not ceremony. A booking URL is checked before it is stored because
 * the agent sends it to a stranger under this person's name; an inverted or
 * empty working window would either send nothing or send at three in the
 * morning; a timezone this runtime cannot evaluate falls back to UTC in
 * silence, which is how this deployment came to invite New Yorkers at 4am
 * while its own screen read "8 to 18".
 *
 * A field the form did not send is left alone rather than cleared. The edit
 * form carries all of them, but a role that cannot change autonomy does not
 * render that control, and a missing input must not read as "set it to false".
 */
async function saveProfile(formData: FormData) {
  "use server";
  const session = await requireSession();
  const supabase = await createClient();

  /* ---- who you are, and how the agent sounds ---- */
  const bio = String(formData.get("bio") ?? "").trim();
  const timezone = String(formData.get("timezone") ?? "").trim();
  const address = String(formData.get("address") ?? "").trim();

  const raw = String(formData.get("bookingUrl") ?? "").trim();
  let bookingUrl: string | null = null;
  if (raw) {
    // The reason is shown rather than a generic refusal — somebody who pasted
    // "cal.com/sam" needs telling it is missing the https://, not that it is
    // invalid.
    const checked = checkCtaUrl(raw);
    if (!checked.ok) redirect(errorQuery("/app/profile?edit=1", checked.reason));
    bookingUrl = checked.url;
  }

  await supabase
    .from("profiles")
    .update({
      bio: bio || null,
      address: address || null,
      booking_url: bookingUrl,
      ...(isKnownTimezone(timezone) ? { timezone } : {}),
    })
    .eq("id", session.userId);

  /* ---- the account: when it may act, and what it can search ---- */
  const start = Number(formData.get("start"));
  const end = Number(formData.get("end"));
  const days = [1, 2, 3, 4, 5, 6, 0].filter((day) => formData.get(`day-${day}`) === "on");

  const accountPatch: Record<string, unknown> = {
    has_sales_navigator: formData.get("hasSalesNavigator") === "on",
  };
  // A window that is empty or inverted is not a setting anybody means to
  // choose, so it is refused rather than written — and said out loud, because
  // silently keeping the old hours after somebody edited them is the same
  // class of lie as saving them wrong.
  if (Number.isInteger(start) && Number.isInteger(end)) {
    if (start < 0 || end > 24 || start >= end || days.length === 0) {
      redirect(
        errorQuery(
          "/app/profile?edit=1",
          "Those sending hours cannot be used: the day has to start before it ends, and at least one day has to be ticked.",
        ),
      );
    }
    accountPatch.working_hours = { start, end, days };
  }

  await supabase
    .from("linkedin_accounts")
    .update(accountPatch as never)
    .eq("workspace_id", session.workspaceId)
    .eq("user_id", session.userId);

  /* ---- how much the agent finishes on its own ---- */
  const wanted = formData.get("autonomy");
  if (wanted && ["owner", "admin", "manager"].includes(session.role)) {
    const autonomy = wanted === "autonomous" ? "autonomous" : "supervised";

    /*
     * The workspace's answer, as well as every campaign already running on it.
     *
     * Only the campaigns were written, and the Targeting Agent builds a new
     * one from `workspaces.onboarding` — the answer given at signup. So a rep
     * who switched this to "autonomous" changed every campaign they had and
     * every campaign they were ever going to build reverted to the signup
     * answer, silently, while this screen went on reporting "autonomous"
     * because one of the old campaigns still said so. Two readings of one
     * setting, and the screen's is the one somebody believes.
     *
     * Merged rather than replaced, exactly as the campaign rules below are:
     * the same row holds the sending window and the search tier, and a
     * wholesale write would drop them.
     */
    const { data: ws } = await supabase
      .from("workspaces")
      .select("onboarding")
      .eq("id", session.workspaceId)
      .maybeSingle();
    const answers = (ws?.onboarding && typeof ws.onboarding === "object" ? ws.onboarding : {}) as Record<
      string,
      unknown
    >;
    await supabase
      .from("workspaces")
      .update({ onboarding: { ...answers, autonomy } as never })
      .eq("id", session.workspaceId);

    const { data: campaigns } = await supabase
      .from("campaigns")
      .select("id, rules")
      .eq("workspace_id", session.workspaceId);

    for (const campaign of campaigns ?? []) {
      const rules = (campaign.rules && typeof campaign.rules === "object" ? campaign.rules : {}) as Record<
        string,
        unknown
      >;
      await supabase
        .from("campaigns")
        // Merged, never replaced: `rules` also carries the search notes and the
        // filters a campaign was built with, and overwriting those would lose
        // the record of what the list actually is.
        .update({ rules: { ...rules, autonomy } as never })
        .eq("id", campaign.id)
        .eq("workspace_id", session.workspaceId);
    }
  }

  revalidatePath("/app/profile");
  // Back to the profile, not to the form. Finishing is the point of Save.
  redirect(noticeQuery("/app/profile", "Saved."));
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
  searchParams: Promise<{ error?: string; notice?: string; connected?: string; edit?: string }>;
}) {
  const params = await searchParams;
  const session = await requireSession();
  const supabase = await createClient();

  /*
   * The workspace's own answer first, and what its campaigns say only when it
   * has none.
   *
   * The campaigns used to be the only source, on the reasoning that they are
   * where the agent reads it — true of a campaign already running, and false
   * of the next one, which the Targeting Agent builds from the workspace's
   * answer. It also read "supervised" on a brand new workspace that had chosen
   * "autonomous" during onboarding, because there were no campaigns yet to
   * ask. Saving writes both, so the two cannot drift; a workspace from before
   * that still falls back to its campaigns rather than to a guess.
   */
  const [{ data: wsRow }, { data: ruleRows }] = await Promise.all([
    supabase.from("workspaces").select("onboarding").eq("id", session.workspaceId).maybeSingle(),
    supabase.from("campaigns").select("rules").eq("workspace_id", session.workspaceId),
  ]);
  const stated = (wsRow?.onboarding as { autonomy?: string } | null)?.autonomy;
  const autonomy =
    stated === "autonomous" || stated === "supervised"
      ? stated
      : (ruleRows ?? []).some((row) => (row.rules as { autonomy?: string } | null)?.autonomy === "autonomous")
        ? "autonomous"
        : "supervised";

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
    supabase
      .from("profiles")
      .select("bio, timezone, booking_url, username, address")
      .eq("id", session.userId)
      .maybeSingle(),
  ]);

  // A row still `connecting` has no provider id, so nothing can send from it.
  // Treating it as connected showed usage bars for an account that does not
  // work yet, and took away the only button that could fix it.
  const found = account ?? undefined;
  const mine = found?.status === "connecting" ? undefined : found;
  const awaitingProvider = found?.status === "connecting";
  const needsReconnect = cannotSend(found?.status);
  const hours = readWorkingHours(mine?.working_hours);
  const editing = params.edit === "1";
  const canManage = ["owner", "admin", "manager"].includes(session.role);

  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="Your profile"
        lede={
          editing
            ? "Change anything here, then save it all at once."
            : "How the agent writes as you, when it may send, and the LinkedIn account it sends from."
        }
        actions={
          editing ? null : (
            <Link className="btn" href="/app/profile?edit=1">
              Edit profile
            </Link>
          )
        }
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

      {/*
        The profile, then editing it — not a page permanently in edit mode.

        This screen was six forms with six Save buttons, each owning a subset of
        the fields and nothing on screen saying which. Somebody changing their
        bio and their sending hours pressed the Save they could see and lost the
        other. It also meant the answer to "what is my setup" — the thing a
        person actually comes here for — was never stated: you had to read it
        out of the form controls holding it.

        So there are two states. `?edit=1` is one form over every field with one
        Save; without it this is a profile you read. Each block keeps an Edit
        that lands you in the form at that block, because "I want to change my
        hours" should not mean scrolling a page of inputs to find them.
      */}
      {editing ? (
        <form action={saveProfile} className="stack-5">
          {/*
            One section and one Panel in edit mode too, matching the one it
            edits. Three headings above one Save read as three forms — somebody
            changes their bio and their hours, presses the Save under the first
            group, and has no reason to believe the second was kept. The groups
            are still there, as labelled blocks inside one card rather than as
            three cards.
          */}
          <Section
            id="sound"
            title="You, and how your agent works"
            description="Everything on this page is one form with one Save. The agent writes in your voice, sends inside your working day, and finishes as much as you let it."
          >
            <Panel>
              <div className="stack-4">
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
                  Asked at signup, and this is where it changes. Left off the
                  profile it was a field somebody typed into once and could
                  then never see again, let alone correct — which is the same
                  disease as research that is gathered, scored, stored and then
                  dropped at the moment it matters.
                */}
                <label className="field">
                  <span>Business address</span>
                  <textarea
                    name="address"
                    rows={2}
                    autoComplete="street-address"
                    defaultValue={me?.address ?? ""}
                  />
                  <span className="hint">For invoices, and for knowing which rules apply to you.</span>
                </label>
                {/*
                  The link the agent sends when a campaign is asking for a
                  meeting. Optional: without one the product offers times from
                  its own calendar, which it can see and protect from
                  double-booking.
                */}
                <label className="field medium">
                  <span>Your scheduling link · optional</span>
                  <input
                    type="url"
                    name="bookingUrl"
                    placeholder="https://cal.com/you/intro"
                    defaultValue={me?.booking_url ?? ""}
                  />
                  <span className="hint">
                    Calendly, Cal.com, SavvyCal — whatever you already use. The agent sends this
                    instead of offering times from here. A booking made there is invisible to this
                    product, so meetings booked through your own link will not appear in the funnel;
                    everything up to the reply still does.
                  </span>
                </label>
                <label className="field medium">
                  <span>Your timezone</span>
                  {/*
                    A picker, not a text box. Every sending window, meeting slot
                    and warm-up day is evaluated in this zone, and a typed "EST"
                    parses to nothing and falls back to UTC in silence — which is
                    how this deployment came to invite people in New York at four
                    in the morning while its screen read "8 to 18".
                  */}
                  <TimezoneSelect value={me?.timezone} />
                </label>
              </div>

                <hr className="divider" />
                <div className="stack-2" id="sending">
                  <h3>When it may send</h3>
                  <p className="small muted">
                    Nothing leaves this account outside these hours, in the timezone above.
                  </p>
                </div>
              <div className="stack-4">
                <p className="small">
                  <strong>{describeWorkingHours(hours, me?.timezone ?? "UTC")}</strong>
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
                </div>
                <label className="small check">
                  <input
                    type="checkbox"
                    name="hasSalesNavigator"
                    defaultChecked={mine?.has_sales_navigator ?? false}
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
              </div>

              {canManage ? (
                <>
                <hr className="divider" />
                <div className="stack-2" id="autonomy">
                  <h3>How much the agent finishes on its own</h3>
                  <p className="small muted">
                    A hold is not a pause, it is a full stop. A prospect who replies on a Friday and
                    is never answered is a warm lead lost, and nothing on any screen explains why.
                  </p>
                </div>
                <label className="field">
                  <span>When a reply arrives</span>
                  <select name="autonomy" defaultValue={autonomy}>
                    <option value="autonomous">The agent answers and books, on its own</option>
                    <option value="supervised">Hold anything uncertain for me to read first</option>
                  </select>
                  <span className="hint">
                    Either way the agent only ever states facts from your knowledge base, never sends
                    a link it was not given, and stops the moment somebody asks not to be contacted.
                    Two things always wait for you: a prospect who asks to speak to a person, and a
                    message the agent did not understand. You can still take over any conversation by
                    hand from the Inbox.
                  </span>
                </label>
                </>
              ) : null}
            </Panel>
          </Section>

          {/*
            One Save, at the end, for everything above it. Sticky, because the
            form is longer than a screen and a Save you have to scroll for is a
            Save people forget — which is the failure this whole change is
            about.
          */}
          <div className="edit-bar">
            <SubmitButton pendingLabel="Saving…">Save changes</SubmitButton>
            <Link className="btn secondary" href="/app/profile">
              Cancel
            </Link>
          </div>
        </form>
      ) : (
        <>
          {/*
            One section, not three.
            "How you sound", "When it may send" and "How much the agent
            finishes on its own" were three cards, three headings and three
            Edit buttons pointing at one form with one Save — three doors into
            the same room, and a page that reads as a pile of boxes rather than
            a profile. They are all one answer to one question: what the agent
            is, working as you. The anchors stay on the groups inside, so every
            existing link into #sending or #autonomy still lands in the right
            place.
          */}
          <Section
            id="sound"
            title="You, and how your agent works"
            description="Everything the agent writes as, sends inside, and decides on its own. One Edit, one Save."
            action={
              <Link className="btn secondary small" href="/app/profile?edit=1#sound">
                Edit
              </Link>
            }
          >
            <Panel>
              <dl className="facts">
                <Fact label="Name">{session.fullName || "—"}</Fact>
                <Fact label="Username">
                  {me?.username || <span className="subtle">Not set</span>}
                </Fact>
                <Fact label="Role">{session.role}</Fact>
                <Fact label="How you describe yourself" wide>
                  {me?.bio || <span className="subtle">Nothing yet — the agent falls back to your business profile.</span>}
                </Fact>
                {/* A URL has no spaces in it, so in a third of a row it breaks
                    wherever the column happens to end — "…/15mi" above a lone
                    "n". A whole row is the width the value actually needs. */}
                <Fact label="Your scheduling link" wide>
                  {me?.booking_url ? (
                    <a href={me.booking_url} target="_blank" rel="noreferrer">
                      {me.booking_url}
                    </a>
                  ) : (
                    <span className="subtle">None — the agent offers times from this product&rsquo;s own calendar.</span>
                  )}
                </Fact>
                <Fact label="Timezone">{me?.timezone || "UTC"}</Fact>
                <Fact label="Business address" wide>
                  {me?.address || <span className="subtle">Not set</span>}
                </Fact>

                <Fact label="Sending hours" id="sending" wide>
                  {describeWorkingHours(hours, me?.timezone ?? "UTC")}
                </Fact>
                <Fact label="Sales Navigator" wide>
                  {mine?.has_sales_navigator
                    ? "Yes — the full customer profile is used in search."
                    : "No — search cannot filter on seniority or company size."}
                </Fact>

                <Fact label="When a reply arrives" id="autonomy" wide>
                  {autonomy === "autonomous"
                    ? "The agent answers and books on its own."
                    : "Anything uncertain is held for you to read first."}
                </Fact>
                <Fact label="Always held for you" wide>
                  A prospect who asks to speak to a person, and a message the agent did not
                  understand. An opt-out stops everything, on either setting.
                </Fact>
              </dl>
            </Panel>
          </Section>
        </>
      )}

      {/*
        The account sits under the settings it belongs to rather than in a card
        of its own. It is the one block here that is operations rather than
        settings — connecting, and asking the provider whether the connection
        is still real — so it keeps its own heading and its own buttons, and
        stops being a fifth box on a page somebody already reads as a pile of
        boxes.
      */}
      <Section id="linkedin" title="Your LinkedIn account" description="The account every message goes out from.">
        <Panel>
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
              /*
                The same meter the overview draws, not a second one.

                This page had its own `Usage` component: a label, a "24 / 35"
                set in the monospace, and a four-pixel rule under it. Beside
                the overview's allowance meters they were two drawings of one
                idea that had already drifted, and the four-pixel one read as a
                rendering fault rather than as a measurement. One component,
                one definition — and rule 51's argument about drawing a meter
                against its cap now reaches this screen too.
              */
              <div className="allowance-row">
                <AllowanceMeter
                  label="Invites today"
                  used={mine.invites_today}
                  cap={LINKEDIN_LIMITS.invitesPerDayMax}
                />
                <AllowanceMeter
                  label="Invites this week"
                  used={mine.invites_this_week}
                  cap={LINKEDIN_LIMITS.invitesPerWeek}
                />
                <AllowanceMeter
                  label="Messages today"
                  used={mine.messages_today}
                  cap={LINKEDIN_LIMITS.messagesPerDay}
                />
              </div>
            )}

            {/* The Sales Navigator tick and the sending hours used to live here
                with two more Save buttons. They are settings, so they moved to
                the one form above; what stays on this card is the two things
                that are operations rather than settings — connecting the
                account, and asking the provider whether it is still there. */}
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
            {/*
              A started-but-unfinished connection is told to finish, not to wait.

              This used to read "Waiting for LinkedIn to confirm the
              connection", with Check again as the main button and the connect
              button demoted to a grey "Start again". That was right when the
              usual cause was a confirmation that never arrived. It stopped
              being right once the return trip from LinkedIn binds the account
              by itself (`/auth/linkedin/done`): somebody who finished signing
              in is connected on arrival, so a row still sitting here is almost
              always somebody who closed the LinkedIn window, or skipped the
              step during signup and meant to come back.

              Telling that person to wait is telling them the product is
              working on it when the product is waiting on them — the first
              customer to hit it reported it as "an issue with my LinkedIn",
              because nothing on the screen said it was a step she had not
              done. So the action leads and the rarer case — finished, but it
              did not take — keeps its button underneath.
            */}
            <p className="small muted">
              {awaitingProvider
                ? "You started connecting LinkedIn but the sign-in was not finished. Press Connect LinkedIn to pick up where you left off — it takes about a minute, and you sign in on LinkedIn’s own page, so we never see your password."
                : "Not connected yet. You will sign in to LinkedIn on their hosted page; we never see your password."}
            </p>
            <div className="cluster">
              <form action={connectLinkedIn}>
                <button className="btn" type="submit">
                  Connect LinkedIn
                </button>
              </form>
              {awaitingProvider ? (
                <form action={refreshLinkedIn}>
                  <button className="btn secondary" type="submit">
                    I already finished — check again
                  </button>
                </form>
              ) : null}
            </div>
          </>
        )}
        </Panel>
      </Section>
      {/*
        Team and billing live here rather than on tabs of their own.
        Somebody managing a workspace does all three in one sitting — who is on
        it, what it costs, and how the agent behaves — and three screens meant
        three places to find and three saves to remember. The anchors keep
        every existing link working.
      */}
      <PageGroup id="team">
        <TeamSection searchParams={searchParams} />
      </PageGroup>
      <PageGroup id="billing">
        <BillingSection searchParams={searchParams} />
      </PageGroup>
    </>
  );
}

/**
 * One fact on the profile: what it is called, and what it says.
 *
 * A definition list rather than a form control showing its own value, which is
 * what this page used to be. The distinction matters for a screen reader as
 * much as for a reader: a value inside a disabled input is announced as a text
 * box you cannot use, and a value in a `<dd>` is announced as an answer.
 */
function Fact({
  label,
  children,
  wide = false,
  id,
}: {
  label: string;
  children: React.ReactNode;
  /** A sentence rather than a word, so it takes the row to itself. */
  wide?: boolean;
  /**
   * An anchor, for a fact that used to be a section of its own.
   *
   * Merging three sections into one would otherwise break every link into
   * #sending and #autonomy — the sidebar's, the overview's, and the ones in
   * people's browser history. The heading they pointed at is gone; the fact it
   * was really about is still here, so the anchor moves onto that.
   */
  id?: string;
}) {
  return (
    <div className={wide ? "fact is-wide" : "fact"} id={id}>
      <dt className="tiny subtle">{label}</dt>
      <dd>{children}</dd>
    </div>
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
