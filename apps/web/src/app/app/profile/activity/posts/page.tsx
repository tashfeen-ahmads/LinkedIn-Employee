import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { parseWorkingHours } from "@le/linkedin";
import {
  POST_MAX_CHARS,
  VISUAL_KINDS,
  VISUAL_KIND_LABEL,
  describeWorkingHours,
  extractLinks,
  isGraphicStyle,
  mayPublish,
  POST_SPACING_DAYS,
  projectPostTimes,
  readVisual,
  visualFromLines,
  visualProblems,
  visualSpec,
  visualToLines,
  type GraphicStyle,
  type VisualKind,
} from "@le/shared";
import { requireSession } from "@/lib/workspace";
import { createClient } from "@/lib/supabase-server";
import { callWorker, errorQuery, noticeQuery } from "@/lib/worker";
import { PageNotice, type NoticeParams } from "@/components/page-notice";
import Link from "next/link";
import { Section, Empty } from "@/components/page";
import { SubmitButton } from "@/components/submit-button";
import { ConfirmButton } from "@/components/confirm-button";
import { wallTimeToUtc } from "@/lib/format";
import { drawPostGraphic, loadGraphicContext } from "@/lib/post-graphic";

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

/** Posts are one of the LinkedIn activities, and live beside the others. */
const HERE = "/app/profile/activity/posts";

function canManage(role: string): boolean {
  return ["owner", "admin", "manager"].includes(role);
}

async function requireManager(action: string) {
  const session = await requireSession();
  if (!canManage(session.role)) {
    redirect(errorQuery(HERE, `You do not have permission to ${action}.`));
  }
  return session;
}

/** The styles a graphic can take, in the company's own colours. */
const STYLE_LABEL: Record<GraphicStyle, string> = {
  brand: "Your main colour",
  light: "Light, with your colour as the accent",
  dark: "Dark, with your colour as the accent",
};

/** What kind of post each one is, said on its card. */
const FORMAT_LABEL: Record<string, string> = {
  industry_update: "This week in your industry",
  how_to: "How to",
  myth_vs_fact: "Myth vs fact",
  checklist: "Checklist",
  insight: "Insight",
  story: "From the field",
};

/** What the lines box takes, for each kind of picture. */
const LINES_HINT: Record<VisualKind, string> = {
  steps: "One step per line, 3 to 5. Add a short detail after a colon: “Reply the same day: before they call someone else”.",
  checklist: "One item per line, 3 to 5. Add a short detail after a colon.",
  flow: "One link in the chain per line, 3 or 4, in order. The last one is the result.",
  compare: "First line the two headings, split by |, like “Myth | Fact”. Then one line per row: “point on the left | point on the right”.",
  stat: "One line: the number, then | and what it measures, like “41% | of calls come in after five”. The number must be in the post.",
  quote: "No lines needed. The title is the line that is framed.",
};

/**
 * The picture's settings as the form posted them, or null for a form that
 * does not carry them. Checked against the post here as well as by the
 * writer, because these boxes are typed into by a person: every number on the
 * picture has to be one the post states (`visualProblems`).
 */
function graphicFromForm(formData: FormData, body: string) {
  if (!formData.has("graphic_fields")) return null;
  const enabled = formData.get("graphic_enabled") === "on";
  const kindField = String(formData.get("graphic_kind") ?? "");
  const kind: VisualKind = (VISUAL_KINDS as readonly string[]).includes(kindField) ? (kindField as VisualKind) : "quote";
  const visual = visualFromLines(
    kind,
    String(formData.get("graphic_headline") ?? ""),
    String(formData.get("graphic_lines") ?? ""),
  );
  const styleField = formData.get("graphic_style");
  const style: GraphicStyle = isGraphicStyle(styleField) ? styleField : "brand";
  if (enabled) {
    if (!visual.title) redirect(errorQuery(HERE, "Give the picture a title, or untick “Post with a graphic”."));
    const problems = visualProblems(visual, body);
    if (problems.length) redirect(errorQuery(HERE, problems[0]!));
  }
  return {
    graphic_enabled: enabled,
    graphic_headline: visual.title || null,
    graphic_spec: visualSpec(visual) as never,
    graphic_style: style,
  };
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

  if (!result.ok) redirect(errorQuery(HERE, result.error));
  if (result.data && result.data.ok === false) {
    redirect(errorQuery(HERE, result.data.reason ?? "The agent could not write anything."));
  }

  revalidatePath(HERE);
  const dropped = result.data?.droppedForLinks ?? 0;
  redirect(
    noticeQuery(
      HERE,
      `Wrote ${result.data?.written ?? 0} drafts.${
        dropped ? ` ${dropped} were thrown away for carrying a link.` : ""
      } Read them before approving. They go on your public profile.`,
    ),
  );
}

/** Save an edit. The trigger on the table clears that row's approval for us. */
async function saveEdit(formData: FormData) {
  "use server";
  const session = await requireManager("edit posts");

  const id = String(formData.get("id") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  if (!id || !body) redirect(errorQuery(HERE, "A post cannot be empty."));

  // The same ceiling the agent is held to. Checked here because this box is
  // typed into by a person, and LinkedIn refuses the whole post rather than
  // truncating it.
  if (body.length > POST_MAX_CHARS) {
    redirect(
      errorQuery(
        HERE,
        `That is ${body.length} characters, and LinkedIn's ceiling is ${POST_MAX_CHARS}.`,
      ),
    );
  }

  const supabase = await createClient();
  const { error, data: saved } = await supabase
    .from("linkedin_posts")
    // `facts_used` is cleared on purpose: the grounding named what the *agent*
    // wrote, and it is no longer a description of these words. Left in place it
    // would be a set of citations for a paragraph nobody checked them against.
    .update({ body, facts_used: [] as never, ...(graphicFromForm(formData, body) ?? {}) })
    .eq("id", id)
    .eq("workspace_id", session.workspaceId)
    // Only the rep's own posts, which is all this screen lists: a post goes out
    // under one person's name, and nobody else's edit should be able to reach it.
    .eq("user_id", session.userId)
    // Never a published row. Its body is the record of what is on the
    // profile, and the approval trigger deliberately leaves those alone, so an
    // edit here would rewrite history rather than un-approve anything.
    .neq("status", "published")
    .select("id");

  if (error) redirect(errorQuery(HERE, "That did not save. Please try again."));
  if (!saved?.length) {
    redirect(errorQuery(HERE, "That post can no longer be edited here. It may already be on your profile."));
  }

  revalidatePath(HERE);
  redirect(
    noticeQuery(
      HERE,
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
  if (!id || !body) redirect(errorQuery(HERE, "There is nothing to approve."));
  if (body.length > POST_MAX_CHARS) {
    redirect(
      errorQuery(
        HERE,
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
      redirect(errorQuery(HERE, "That is not a time we can read."));
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
    .eq("user_id", session.userId)
    .in("status", ["draft", "failed"])
    .neq("body", body);
  if (saveError) redirect(errorQuery(HERE, "That did not save. Please try again."));

  /*
   * The picture: saved as the form has it, then drawn and stored exactly as
   * it will go out. An approval is a statement about what will appear, the
   * picture included, so what is stored here is what the sweep attaches, and
   * the approval below is conditional on the row being the one it was drawn
   * from.
   */
  const graphic = graphicFromForm(formData, body);
  if (graphic) {
    const { error: graphicError } = await supabase
      .from("linkedin_posts")
      .update(graphic)
      .eq("id", id)
      .eq("workspace_id", session.workspaceId)
      .eq("user_id", session.userId)
      .in("status", ["draft", "failed"]);
    if (graphicError) redirect(errorQuery(HERE, "That did not save. Please try again."));
  }
  const { data: current } = await supabase
    .from("linkedin_posts")
    .select("body, updated_at, format, graphic_enabled, graphic_headline, graphic_spec, graphic_style")
    .eq("id", id)
    .eq("workspace_id", session.workspaceId)
    .eq("user_id", session.userId)
    .maybeSingle();
  if (!current) redirect(errorQuery(HERE, "That post could not be read. Reload the page and try again."));
  if (current.graphic_enabled) {
    const visual = readVisual(current.graphic_headline, current.graphic_spec);
    if (!visual) {
      redirect(errorQuery(HERE, "Give the picture a title, or untick “Post with a graphic”."));
    }
    const problems = visualProblems(visual, current.body);
    if (problems.length) redirect(errorQuery(HERE, problems[0]!));
    const context = await loadGraphicContext(supabase, session);
    const png = await (
      await drawPostGraphic({
        visual,
        style: isGraphicStyle(current.graphic_style) ? current.graphic_style : "brand",
        format: current.format,
        ...context,
      })
    ).arrayBuffer();
    const { error: storeError } = await supabase
      .from("linkedin_post_graphics")
      .upsert({ post_id: id, workspace_id: session.workspaceId, png_base64: Buffer.from(png).toString("base64") });
    if (storeError) redirect(errorQuery(HERE, "The graphic could not be saved. Please try again."));
  }

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
    .eq("user_id", session.userId)
    // Never a published row. Its body is the record of what went out, and
    // re-approving it would queue a second copy of the same post.
    .in("status", ["draft", "failed"])
    .eq("body", body)
    // And the row exactly as the picture was drawn from it a moment ago: any
    // write since moves `updated_at` (the touch trigger), whatever it changed.
    .eq("updated_at", current.updated_at)
    .select("id");

  if (error) redirect(errorQuery(HERE, "That did not save. Please try again."));
  if (!data?.length) {
    redirect(
      errorQuery(HERE, "That post changed while you were reading it. Read it again, then approve."),
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

  revalidatePath(HERE);
  if (scheduledFor) {
    redirect(
      noticeQuery(HERE, `Approved, and scheduled. It goes out on ${when(scheduledFor, timezone)}.`),
    );
  }
  redirect(
    noticeQuery(
      HERE,
      published.ok && published.data && published.data.published > 0
        ? "Approved and published. It is on your profile now."
        : `Approved. It goes out in your posting hours, and never within ${POST_SPACING_DAYS} days of another post. Its date is on the card below.`,
    ),
  );
}

async function unapprove(formData: FormData) {
  "use server";
  const session = await requireManager("edit posts");
  const id = String(formData.get("id") ?? "");

  const supabase = await createClient();
  const { data: held } = await supabase
    .from("linkedin_posts")
    .update({ status: "draft", approved_at: null, approved_by: null })
    .eq("id", id)
    .eq("workspace_id", session.workspaceId)
    .eq("user_id", session.userId)
    // A published post cannot be un-approved: it is already on the profile, and
    // the only thing that removes it is deleting it on LinkedIn. A failed one
    // can: it keeps its approval when LinkedIn refuses it, and Hold matched
    // only `approved`, so it said "Held" over a row it had not touched.
    .in("status", ["approved", "failed"])
    .select("id");

  revalidatePath(HERE);
  if (!held?.length) {
    redirect(errorQuery(HERE, "That post was not held. It may already be on your profile."));
  }
  redirect(noticeQuery(HERE, "Held. It will not go out until you approve it again."));
}

async function discard(formData: FormData) {
  "use server";
  const session = await requireManager("delete posts");
  const id = String(formData.get("id") ?? "");

  const supabase = await createClient();
  const { data: gone } = await supabase
    .from("linkedin_posts")
    .delete()
    .eq("id", id)
    .eq("workspace_id", session.workspaceId)
    .eq("user_id", session.userId)
    // Never a published row. That row is the record of what is on the profile,
    // and deleting it here would not delete the post — it would only stop this
    // product being able to say what went out.
    .in("status", ["draft", "failed"])
    .select("id");

  revalidatePath(HERE);
  if (!gone?.length) redirect(errorQuery(HERE, "That post was not thrown away. It may already be approved or published."));
  redirect(noticeQuery(HERE, "Thrown away."));
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
  updated_at: string;
  graphic_enabled: boolean;
  graphic_headline: string | null;
  graphic_spec: unknown;
  graphic_style: string;
  format: string | null;
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
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(at);
}

/**
 * The graphic as it stands, sized for the card. A draft is drawn from its
 * settings; an approved or published post shows only the picture stored at
 * approval, so a post that went out as text before graphics existed shows
 * none rather than a picture it never had.
 */
function GraphicPreview({ row, stored }: { row: PostRow; stored: boolean }) {
  if (!row.graphic_enabled) return null;
  if (row.approved_at || row.status === "published") {
    if (!stored) return null;
  } else if (!readVisual(row.graphic_headline, row.graphic_spec)) {
    return <div className="post-graphic-empty small muted">No title yet, so no picture. Write one beside this.</div>;
  }
  return (
    // The route answers with the stored picture once approved, so this is
    // exactly what goes out.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="post-graphic-image"
      src={`${HERE}/${row.id}/graphic?v=${encodeURIComponent(row.updated_at)}`}
      alt={row.graphic_headline ? `Picture: ${row.graphic_headline}` : "The post's picture"}
      width={320}
      height={400}
      loading="lazy"
    />
  );
}

function PostCard({
  row,
  manage,
  colours,
  stored = false,
  verdict,
  timezone,
  goesOutAt = null,
}: {
  row: PostRow;
  manage: boolean;
  /** The company's colours as hex codes, or null when none are set. */
  colours?: string | null;
  /** A picture was stored for this post when it was approved. */
  stored?: boolean;
  /** What `mayPublish` says about this row right now, in the rep's own hours. */
  verdict: ReturnType<typeof mayPublish>;
  /** When this approved post is due to go out, on the two-day spacing. */
  goesOutAt?: Date | null;
  /** The rep's zone, so every time on the card is on one clock. */
  timezone: string;
}) {
  const facts = Array.isArray(row.facts_used) ? (row.facts_used as string[]) : [];
  const links = extractLinks(row.body);
  const visual = readVisual(row.graphic_headline, row.graphic_spec);
  const format = row.format ? FORMAT_LABEL[row.format] : null;
  const published = row.status === "published";
  const failed = row.status === "failed";
  const editable = manage && !published;
  // A post LinkedIn refused keeps its approval, so reading `approved_at` alone
  // offered only Save and Hold: no way to send it again short of changing a
  // word. It is offered the approval controls, which is what "try again" is.
  const awaitingApproval = !row.approved_at || failed;

  const details = (
    <>
      {format ? <p className="tiny muted">{format}</p> : null}
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
          : failed
            ? "Did not go out. Approve it again to retry."
            : !row.approved_at
              ? "Not approved"
              : goesOutAt && goesOutAt.getTime() > Date.now() + 60_000 &&
                  (!row.scheduled_for || goesOutAt.getTime() > Date.parse(row.scheduled_for) + 60_000)
                ? `Approved, goes out from ${when(goesOutAt.toISOString(), timezone)}. One post every ${POST_SPACING_DAYS} days on your profile.`
                : row.scheduled_for
                ? `Approved, held until ${when(row.scheduled_for, timezone)}`
                : verdict.send
                  ? "Approved, going out within a quarter of an hour"
                  : `Approved: ${verdict.reason}`}
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
          post with an outbound link to far fewer people. The usual move is to earn the question
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
          <GraphicPreview row={row} stored={stored} />
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

        <input type="hidden" name="graphic_fields" value="1" />
        <fieldset className="post-graphic-fields">
          <legend>Graphic</legend>
          <div className="post-graphic">
            <GraphicPreview row={row} stored={stored} />
            <div className="stack-3">
              <label className="inline-check">
                <input type="checkbox" name="graphic_enabled" defaultChecked={row.graphic_enabled} />
                <span>Post with a graphic</span>
              </label>
              <label className="field">
                <span>What it shows</span>
                <select name="graphic_kind" defaultValue={visual?.kind ?? "steps"}>
                  {VISUAL_KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {VISUAL_KIND_LABEL[kind]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Title</span>
                <input name="graphic_headline" defaultValue={row.graphic_headline ?? ""} maxLength={90} />
              </label>
              <label className="field">
                <span>Lines</span>
                <textarea name="graphic_lines" rows={5} defaultValue={visual ? visualToLines(visual) : ""} />
                <span className="hint">
                  {LINES_HINT[visual?.kind ?? "steps"]} Every line comes from the post. Press Save to
                  see it drawn.
                </span>
              </label>
              <label className="field">
                <span>Style</span>
                <select
                  name="graphic_style"
                  defaultValue={isGraphicStyle(row.graphic_style) ? row.graphic_style : "brand"}
                >
                  {(Object.keys(STYLE_LABEL) as GraphicStyle[]).map((style) => (
                    <option key={style} value={style}>
                      {STYLE_LABEL[style]}
                    </option>
                  ))}
                </select>
              </label>
              <p className="tiny muted">
                {colours ? `In your company colours, ${colours}. ` : "No company colours set yet, so it uses a plain navy. "}
                <Link href="/app/profile/company#colours">{colours ? "Change them" : "Set your colours"}</Link>
              </p>
            </div>
          </div>
        </fieldset>

        {details}

        {!awaitingApproval ? (
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
            <label className="field">
              <span>Schedule it (optional)</span>
              <input className="input-medium" type="datetime-local" name="scheduled_for" />
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
                {failed ? "Save and try again" : "Save and approve"}
              </SubmitButton>
              <ConfirmButton
                className="btn ghost small"
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

export default async function ProfilePostsPage({ searchParams }: { searchParams: Promise<NoticeParams> }) {
  const params = await searchParams;
  const session = await requireSession();
  const supabase = await createClient();

  const [{ data: postRows }, { data: account }, { data: me }] = await Promise.all([
    supabase
      .from("linkedin_posts")
      .select(
        "id, body, status, facts_used, approved_at, scheduled_for, published_at, provider_post_id, error, created_at, updated_at, graphic_enabled, graphic_headline, graphic_spec, graphic_style, format",
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
  const { data: brand } = await supabase
    .from("workspaces")
    .select("brand_primary, brand_accent")
    .eq("id", session.workspaceId)
    .maybeSingle();
  const colours = brand?.brand_primary ? [brand.brand_primary, brand.brand_accent].filter(Boolean).join(" and ") : null;

  const posts = (postRows ?? []) as PostRow[];
  // Which posts have a picture stored at approval. The ids only: a list of
  // posts never reads the pictures themselves.
  const { data: storedRows } = posts.length
    ? await supabase
        .from("linkedin_post_graphics")
        .select("post_id")
        .eq("workspace_id", session.workspaceId)
        .in(
          "post_id",
          posts.map((row) => row.id),
        )
    : { data: [] as Array<{ post_id: string }> };
  const stored = new Set((storedRows ?? []).map((row) => row.post_id));
  const manage = canManage(session.role);
  const timezone = me?.timezone || "UTC";
  const hours = parseWorkingHours(account?.working_hours);
  // The same window the sweep uses, so this screen and the worker can never
  // disagree about whether a row is about to go out.
  const now = new Date();

  const drafts = posts.filter((row) => row.status === "draft");
  const queued = posts.filter((row) => row.status === "approved" || row.status === "failed");
  const published = posts.filter((row) => row.status === "published");
  // One post every two days (rule 69): the gate reads the last one published,
  // and the approved queue is laid out on the same spacing so each card says
  // its own date rather than all of them "within a quarter of an hour".
  const lastPublishedAt =
    published.map((row) => row.published_at).filter((at): at is string => Boolean(at)).sort().at(-1) ?? null;
  const window = { hours, timezone, lastPublishedAt };
  const goesOut = projectPostTimes(
    queued.filter((row) => row.status === "approved"),
    lastPublishedAt,
    now,
    { hours, timezone },
  );

  return (
    <>
      <PageNotice error={params.error} notice={params.notice} />
      <div className="stack-2">
        <p className="small">
          <Link href="/app/profile/activity">← LinkedIn activity</Link>
        </p>
        <p className="muted prose">
          Useful posts for the people you reach: how-tos, myths corrected, checklists and this week&apos;s news in
          their industry, each with a picture of what it says. Never an advert. A new set is written each week, and
          nothing reaches LinkedIn until you have read it.
        </p>
      </div>

      {account?.status !== "active" ? (
        <div className="notice warning">
          Your LinkedIn account is not connected, so nothing here can be published. Approving a post
          is still worth doing: it goes out on its own once the account is back.
        </div>
      ) : null}

      <Section
        title={drafts.length ? `Waiting for you (${drafts.length})` : "Waiting for you"}
        description={`Nobody has read these. A post goes to everyone who follows you and stays on your profile, and the only way to take one back is to delete it after people have seen it. That is why there is no autopilot on this screen.`}
      >
        {drafts.length ? (
          <div className="stack-3">
            {drafts.map((row) => (
              <PostCard
                key={row.id}
                row={row}
                manage={manage}
                colours={colours}
                stored={stored.has(row.id)}
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
        title={queued.length ? `Approved (${queued.length})` : "Approved"}
        description={`These go out one at a time, at most one every ${POST_SPACING_DAYS} days, in your own working hours: several posts at once reads as software posting for you. One you gave a time to goes at that time, unless it is inside the ${POST_SPACING_DAYS} days. Yours: ${describeWorkingHours(hours, timezone)}.`}
      >
        {queued.length ? (
          <div className="stack-3">
            {queued.map((row) => (
              <PostCard
                key={row.id}
                row={row}
                manage={manage}
                colours={colours}
                stored={stored.has(row.id)}
                timezone={timezone}
                verdict={mayPublish(row, now, window)}
                goesOutAt={goesOut.get(row.id) ?? null}
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
          title={`Published (${published.length})`}
          description="What actually went out, and when. These are the record of what is on your profile, so they cannot be edited or deleted here, only on LinkedIn."
        >
          <div className="stack-3">
            {published.map((row) => (
              <PostCard
                key={row.id}
                row={row}
                manage={manage}
                colours={colours}
                stored={stored.has(row.id)}
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
