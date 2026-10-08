import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { parseWorkingHours } from "@le/linkedin";
import { POST_MAX_CHARS, describeWorkingHours, extractLinks, mayPublish } from "@le/shared";
import { requireSession } from "@/lib/workspace";
import { createClient } from "@/lib/supabase-server";
import { callWorker, errorQuery, noticeQuery } from "@/lib/worker";
import { PageNotice, type NoticeParams } from "@/components/page-notice";
import { PageHeader, Section, Empty } from "@/components/page";
import { SubmitButton } from "@/components/submit-button";
import { ConfirmButton } from "@/components/confirm-button";
import { wallTimeToUtc } from "@/lib/format";

/**
 * Posts on the rep's own profile: written by the agent, approved by a person.
 *
 * This is the one thing this product publishes that is not addressed to
 * anybody. It goes to everyone who follows the rep, it stays on their profile,
 * and it is what a prospect reads when a connection request arrives and they go
 * and look the sender up before deciding whether to accept. That is what makes
 * it worth doing, and it is also why the gate is stricter here than anywhere
 * else: the reply gate has an autonomy setting because an unanswered pricing
 * question on a Friday is a lead lost (rule 41), and a post waiting until
 * Monday for somebody to read it has lost nothing at all.
 *
 * `mayPublish` is the gate, and this screen calls the same function the sweep
 * does, with the same posting window in it. Two readings of one rule drift, and
 * the screen's is the one somebody believes (rule 21).
 */

function canManage(role: string): boolean {
  return ["owner", "admin", "manager"].includes(role);
}

async function requireManager(action: string) {
  const session = await requireSession();
  if (!canManage(session.role)) {
    redirect(errorQuery("/app/posts", `You do not have permission to ${action}.`));
  }
  return session;
}

/** Ask the agent for a set of drafts, or for a revision of the ones on screen. */
async function generate(formData: FormData) {
  "use server";
  const session = await requireManager("write posts");
  const instruction = String(formData.get("instruction") ?? "").trim();

  // Ninety seconds, not the ten a queue-and-return route needs: this one runs
  // the writer on the request thread so the person who clicked sees what it
  // produced. Cut off at ten, a working agent reads as a broken service.
  const result = await callWorker<{ ok: boolean; reason?: string; written?: number; droppedForLinks?: number }>(
    "/jobs/write-posts",
    { workspaceId: session.workspaceId, userId: session.userId, instruction: instruction || undefined },
    90_000,
  );

  if (!result.ok) redirect(errorQuery("/app/posts", result.error));
  if (result.data && result.data.ok === false) {
    redirect(errorQuery("/app/posts", result.data.reason ?? "The agent could not write anything."));
  }

  revalidatePath("/app/posts");
  const dropped = result.data?.droppedForLinks ?? 0;
  redirect(
    noticeQuery(
      "/app/posts",
      `Wrote ${result.data?.written ?? 0} drafts.${
        dropped ? ` ${dropped} were thrown away for carrying a link.` : ""
      } Read them before approving — they go on your public profile.`,
    ),
  );
}

/** Save an edit. The trigger on the table clears that row's approval for us. */
async function saveEdit(formData: FormData) {
  "use server";
  const session = await requireManager("edit posts");

  const id = String(formData.get("id") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  if (!id || !body) redirect(errorQuery("/app/posts", "A post cannot be empty."));

  // The same ceiling the agent is held to. Checked here because this box is
  // typed into by a person, and LinkedIn refuses the whole post rather than
  // truncating it.
  if (body.length > POST_MAX_CHARS) {
    redirect(
      errorQuery(
        "/app/posts",
        `That is ${body.length} characters, and LinkedIn's ceiling is ${POST_MAX_CHARS}.`,
      ),
    );
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("linkedin_posts")
    // `facts_used` is cleared on purpose: the grounding named what the *agent*
    // wrote, and it is no longer a description of these words. Left in place it
    // would be a set of citations for a paragraph nobody checked them against.
    .update({ body, facts_used: [] as never })
    .eq("id", id)
    .eq("workspace_id", session.workspaceId);

  if (error) redirect(errorQuery("/app/posts", `That did not save: ${error.message}`));

  revalidatePath("/app/posts");
  redirect(
    noticeQuery(
      "/app/posts",
      "Saved. Editing clears the approval, because an approval is a statement about particular words.",
    ),
  );
}

/**
 * Save the words in the box, then approve exactly those words.
 *
 * Approve used to be a separate form carrying the body as it was rendered, so
 * an edit typed into the box and never saved was dropped and the *old* text
 * approved — the one outcome an approval step exists to prevent. Now it is a
 * second button on the edit form: what is approved is what is on screen.
 *
 * This is still the one place a post becomes publishable, and the only place
 * `approved_at` is ever set — exactly as rule 9 holds for customer profiles and
 * rule 40 for pitches.
 */
async function approve(formData: FormData) {
  "use server";
  const session = await requireManager("approve posts");

  const id = String(formData.get("id") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  if (!id || !body) redirect(errorQuery("/app/posts", "There is nothing to approve."));
  if (body.length > POST_MAX_CHARS) {
    redirect(
      errorQuery(
        "/app/posts",
        `That is ${body.length} characters, and LinkedIn's ceiling is ${POST_MAX_CHARS}.`,
      ),
    );
  }

  const supabase = await createClient();
  const { data: me } = await supabase.from("profiles").select("timezone").eq("id", session.userId).maybeSingle();
  const timezone = me?.timezone || "UTC";

  const typed = String(formData.get("scheduled_for") ?? "").trim();
  let scheduledFor: string | null = null;
  if (typed) {
    const parsed = wallTimeToUtc(typed, timezone);
    if (!Number.isFinite(parsed)) {
      redirect(errorQuery("/app/posts", "That is not a time we can read."));
    }
    scheduledFor = new Date(parsed).toISOString();
  }

  // Only when the words changed, so an untouched draft keeps the grounding the
  // agent recorded for it. A changed one loses it, as on Save.
  const { error: saveError } = await supabase
    .from("linkedin_posts")
    .update({ body, facts_used: [] as never })
    .eq("id", id)
    .eq("workspace_id", session.workspaceId)
    .in("status", ["draft", "failed"])
    .neq("body", body);
  if (saveError) redirect(errorQuery("/app/posts", `That did not save: ${saveError.message}`));

  const { error, data } = await supabase
    .from("linkedin_posts")
    .update({
      status: "approved",
      approved_at: new Date().toISOString(),
      approved_by: session.userId,
      scheduled_for: scheduledFor,
      // A row that failed once and has been edited and re-approved starts clean.
      error: null,
    })
    .eq("id", id)
    .eq("workspace_id", session.workspaceId)
    // Never a published row. Its body is the record of what went out, and
    // re-approving it would queue a second copy of the same post.
    .in("status", ["draft", "failed"])
    .eq("body", body)
    .select("id");

  if (error) redirect(errorQuery("/app/posts", `That did not save: ${error.message}`));
  if (!data?.length) {
    redirect(
      errorQuery("/app/posts", "That post changed while you were reading it. Read it again, then approve."),
    );
  }

  /*
   * Ask the worker now rather than waiting for the sweep.
   *
   * Rule 21's point: the action that most needs the worker must not be the one
   * that only sets a row and trusts the schedule to notice. A post approved at
   * 10:02 and published at 10:15 is a product that looks broken for thirteen
   * minutes — and thirteen minutes of an unchanged page is exactly what a
   * button that did nothing looks like.
   *
   * A failure here is not an error on this screen: the row is approved, the
   * quarter-hourly sweep will publish it, and telling somebody their approval
   * failed when it did not is worse than telling them nothing.
   */
  const published = await callWorker<{ published: number; held: number; failed: number }>(
    "/jobs/publish-posts",
    { workspaceId: session.workspaceId, userId: session.userId },
    30_000,
  );

  revalidatePath("/app/posts");
  if (scheduledFor) {
    redirect(
      noticeQuery("/app/posts", `Approved, and scheduled. It goes out on ${when(scheduledFor, timezone)}.`),
    );
  }
  redirect(
    noticeQuery(
      "/app/posts",
      published.ok && published.data && published.data.published > 0
        ? "Approved and published. It is on your profile now."
        : "Approved. It goes out in your posting hours — within a quarter of an hour of them starting.",
    ),
  );
}

async function unapprove(formData: FormData) {
  "use server";
  const session = await requireManager("edit posts");
  const id = String(formData.get("id") ?? "");

  const supabase = await createClient();
  await supabase
    .from("linkedin_posts")
    .update({ status: "draft", approved_at: null, approved_by: null })
    .eq("id", id)
    .eq("workspace_id", session.workspaceId)
    // A published post cannot be un-approved: it is already on the profile, and
    // the only thing that removes it is deleting it on LinkedIn.
    .eq("status", "approved");

  revalidatePath("/app/posts");
  redirect(noticeQuery("/app/posts", "Held. It will not go out until you approve it again."));
}

async function discard(formData: FormData) {
  "use server";
  const session = await requireManager("delete posts");
  const id = String(formData.get("id") ?? "");

  const supabase = await createClient();
  await supabase
    .from("linkedin_posts")
    .delete()
    .eq("id", id)
    .eq("workspace_id", session.workspaceId)
    // Never a published row. That row is the record of what is on the profile,
    // and deleting it here would not delete the post — it would only stop this
    // product being able to say what went out.
    .in("status", ["draft", "failed"]);

  revalidatePath("/app/posts");
  redirect(noticeQuery("/app/posts", "Thrown away."));
}

type PostRow = {
  id: string;
  body: string;
  status: string;
  facts_used: unknown;
  approved_at: string | null;
  scheduled_for: string | null;
  published_at: string | null;
  provider_post_id: string | null;
  error: string | null;
  created_at: string;
};

/**
 * A timestamp a person can read, in the rep's own zone.
 *
 * These rendered as raw ISO strings — "2026-09-24T21:44:34.606Z" under a post,
 * which is a machine's answer to "when did this go out". The zone is the rep's
 * because every other time on this screen is: a post held for posting hours is
 * held against *their* clock, and two clocks on one card is how somebody
 * concludes the schedule is an hour out.
 */
function when(value: string | null, timezone: string): string {
  if (!value) return "";
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(at);
}

function PostCard({
  row,
  manage,
  verdict,
  timezone,
}: {
  row: PostRow;
  manage: boolean;
  /** What `mayPublish` says about this row right now, in the rep's own hours. */
  verdict: ReturnType<typeof mayPublish>;
  /** The rep's zone, so every time on the card is on one clock. */
  timezone: string;
}) {
  const facts = Array.isArray(row.facts_used) ? (row.facts_used as string[]) : [];
  const links = extractLinks(row.body);
  const published = row.status === "published";
  const editable = manage && !published;

  const details = (
    <>
      <p className="tiny subtle">
        {/*
          One sentence about where this row is, and one timestamp in it.
          `mayPublish`'s reason for a scheduled post carries the raw ISO,
          which is the right thing for the sweep's log and the wrong thing
          here — printed beside a formatted one it reads as two different
          times for the same post.
        */}
        {published
          ? `Published ${when(row.published_at, timezone)}`
          : !row.approved_at
            ? "Not approved"
            : row.scheduled_for
              ? `Approved — held until ${when(row.scheduled_for, timezone)}`
              : verdict.send
                ? "Approved — going out on the next sweep"
                : `Approved — ${verdict.reason}`}
      </p>

      {row.error ? (
        // The provider's own words, verbatim. "422: ..." is the single most
        // useful sentence in a failure and it used to go to a log on a host
        // the person reading this screen cannot reach (rule 25).
        <p className="small warning-text">LinkedIn refused this: {row.error}</p>
      ) : null}

      {links.length ? (
        /*
         * Reported, never stripped. LinkedIn suppresses the reach of a post
         * carrying an outbound URL, which makes a link the most expensive
         * sentence in the post — but a rep who deliberately puts one there
         * has made a decision about their own profile, and a product that
         * silently edited their words would be the worse failure. So this is
         * rule 49's posture: it says what it costs and does not refuse.
         */
        <p className="small muted">
          This carries {links.length === 1 ? "a link" : `${links.length} links`}. LinkedIn shows a
          post with an outbound link to far fewer people — the usual move is to earn the question
          and put the address in the reply.
        </p>
      ) : null}

      {facts.length ? (
        <ul className="tiny muted stack-2">
          {facts.map((fact) => (
            <li key={fact}>{fact}</li>
          ))}
        </ul>
      ) : (
        /*
         * Empty grounding is reported rather than hidden — rule 16's habit. A
         * post citing nothing looks exactly like one citing everything, and
         * the difference is whether this rep's whole network is about to be
         * told something nobody can check.
         */
        <p className="tiny muted">
          {row.status === "published"
            ? "Nothing was recorded about where this one's claims came from."
            : "The agent named no source for what this says, or you wrote it yourself. Read it before approving."}
        </p>
      )}
    </>
  );

  if (!editable) {
    return (
      <article className="card">
        <div className="stack-3">
          {/*
           * The post, and nothing above it.
           *
           * This carried an `<h3>` of the first line, which on a read-only card
           * printed that sentence twice running — the body starts with it. A
           * post has no title; its opening *is* its title, which is exactly why
           * LinkedIn shows two lines and hides the rest.
           */}
          <p className="prose post-body">{row.body}</p>
          {details}
        </div>
      </article>
    );
  }

  /*
   * One form for everything done to this row.
   *
   * Approve used to be its own form carrying the body as rendered, so an edit
   * typed into the box and not saved was dropped and the old words approved.
   * Every button here now submits what is in the box: Save keeps it, "Save &
   * approve" keeps it and approves exactly that, and Throw away discards the
   * row whatever the box says.
   */
  return (
    <article className="card">
      <form action={saveEdit} className="stack-3">
        <input type="hidden" name="id" value={row.id} />
        <label className="field">
          <span>The post</span>
          <textarea name="body" rows={10} defaultValue={row.body} maxLength={POST_MAX_CHARS} required />
          <span className="hint">
            Up to {POST_MAX_CHARS} characters. LinkedIn shows the first two lines and hides the rest
            behind “see more”, so the opening is the whole of what most people read. Editing
            un-approves it.
          </span>
        </label>

        {details}

        {row.approved_at ? (
          <div className="form-row">
            <SubmitButton className="btn secondary small" pendingLabel="Saving…">
              Save
            </SubmitButton>
            <SubmitButton className="btn secondary small" pendingLabel="Holding…" formAction={unapprove}>
              Hold
            </SubmitButton>
          </div>
        ) : (
          <>
            <label className="field compact-wide">
              <span>Schedule it (optional)</span>
              <input type="datetime-local" name="scheduled_for" />
              <span className="hint">
                Your time, {timezone}. Left empty it goes out in your posting hours, which is usually
                what you want.
              </span>
            </label>
            <div className="form-row">
              {/* Save first: Enter in a field submits the first button, and a
                  keystroke must never publish to somebody's profile. */}
              <SubmitButton className="btn secondary small" pendingLabel="Saving…">
                Save
              </SubmitButton>
              <SubmitButton className="btn small" pendingLabel="Approving…" formAction={approve}>
                Save &amp; approve
              </SubmitButton>
              <ConfirmButton
                confirmLabel="Throw it away for good"
                pendingLabel="Discarding…"
                formAction={discard}
              >
                Throw away
              </ConfirmButton>
            </div>
          </>
        )}
      </form>
    </article>
  );
}

export default async function PostsPage({ searchParams }: { searchParams: Promise<NoticeParams> }) {
  const params = await searchParams;
  const session = await requireSession();
  const supabase = await createClient();

  const [{ data: postRows }, { data: account }, { data: me }] = await Promise.all([
    supabase
      .from("linkedin_posts")
      .select(
        "id, body, status, facts_used, approved_at, scheduled_for, published_at, provider_post_id, error, created_at",
      )
      .eq("workspace_id", session.workspaceId)
      .eq("user_id", session.userId)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("linkedin_accounts")
      .select("status, working_hours")
      .eq("workspace_id", session.workspaceId)
      .eq("user_id", session.userId)
      .maybeSingle(),
    supabase.from("profiles").select("timezone").eq("id", session.userId).maybeSingle(),
  ]);

  const posts = (postRows ?? []) as PostRow[];
  const manage = canManage(session.role);
  const timezone = me?.timezone || "UTC";
  const hours = parseWorkingHours(account?.working_hours);
  // The same window the sweep uses, so this screen and the worker can never
  // disagree about whether a row is about to go out.
  const window = { hours, timezone };
  const now = new Date();

  const drafts = posts.filter((row) => row.status === "draft");
  const queued = posts.filter((row) => row.status === "approved" || row.status === "failed");
  const published = posts.filter((row) => row.status === "published");

  return (
    <>
      <PageHeader
        eyebrow="Pipeline"
        title="Profile posts"
        lede="What a prospect reads when your connection request arrives and they go and look you up. The agent writes them from your business profile and knowledge base; nothing reaches LinkedIn until you have read it."
      />

      <PageNotice error={params.error} notice={params.notice} />

      {account?.status !== "active" ? (
        <div className="notice warning">
          Your LinkedIn account is not connected, so nothing here can be published. Approving a post
          is still worth doing — it goes out on its own once the account is back.
        </div>
      ) : null}

      <Section
        title={drafts.length ? `Waiting for you — ${drafts.length}` : "Waiting for you"}
        description={`Nobody has read these. A post goes to everyone who follows you and stays on your profile, and the only way to take one back is to delete it after people have seen it — which is why there is no autopilot on this screen.`}
      >
        {drafts.length ? (
          <div className="stack-3">
            {drafts.map((row) => (
              <PostCard
                key={row.id}
                row={row}
                manage={manage}
                timezone={timezone}
                verdict={mayPublish(row, now, window)}
              />
            ))}
          </div>
        ) : (
          <Empty title="Nothing waiting">
            Your profile is the first thing a prospect checks after an invitation arrives. Ask the
            agent for a set of drafts and approve the ones that sound like you.
          </Empty>
        )}
        {manage ? (
          <div className="card">
            <form action={generate} className="stack-3">
              <label className="field">
                <span>{posts.length ? "What should be different?" : "Anything it should know"}</span>
                <textarea
                  name="instruction"
                  rows={2}
                  maxLength={2000}
                  placeholder={
                    posts.length
                      ? "Write about the referral that never got tracked, not the software."
                      : "Optional."
                  }
                />
              </label>
              <SubmitButton pendingLabel="Writing…">
                {posts.length ? "Write a new set" : "Write my first drafts"}
              </SubmitButton>
            </form>
          </div>
        ) : null}
      </Section>

      <Section
        title={queued.length ? `Approved — ${queued.length}` : "Approved"}
        description={`These go out in your own working hours — a post appearing on your profile at four in the morning reads as software posting for you. One you gave a time to goes at that time instead. Yours: ${describeWorkingHours(hours, timezone)}.`}
      >
        {queued.length ? (
          <div className="stack-3">
            {queued.map((row) => (
              <PostCard
                key={row.id}
                row={row}
                manage={manage}
                timezone={timezone}
                verdict={mayPublish(row, now, window)}
              />
            ))}
          </div>
        ) : (
          <Empty title="Nothing approved">
            Approve a draft above and it goes out within a quarter of an hour of your posting hours
            starting.
          </Empty>
        )}
      </Section>

      {published.length ? (
        <Section
          title={`Published — ${published.length}`}
          description="What actually went out, and when. These are the record of what is on your profile, so they cannot be edited or deleted here — only on LinkedIn."
        >
          <div className="stack-3">
            {published.map((row) => (
              <PostCard
                key={row.id}
                row={row}
                manage={manage}
                timezone={timezone}
                verdict={mayPublish(row, now, window)}
              />
            ))}
          </div>
        </Section>
      ) : null}
    </>
  );
}
