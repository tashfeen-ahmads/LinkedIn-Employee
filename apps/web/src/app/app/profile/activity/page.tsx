import Link from "next/link";
import type { ReactNode } from "react";
import { LINKEDIN_LIMITS } from "@le/shared";
import { dailyInviteCap, type AccountRecord } from "@le/linkedin";
import { requireSession } from "@/lib/workspace";
import { createClient } from "@/lib/supabase-server";
import { countersForToday } from "@/lib/account-day";
import { PageNotice, type NoticeParams } from "@/components/page-notice";
import { Section } from "@/components/page";
import { LinkedInActivitySwitch } from "@/components/linkedin-activity-switch";
import { AllowanceMeter } from "@/components/charts";
import { readWarmUp } from "../activity-state";

/**
 * Everything Nora does on LinkedIn in your name, in one place, with one switch
 * each.
 *
 * Likes and comments had a page of their own, profile posts another, and the
 * profile view before an invitation was a tick box on each campaign — three
 * places to find, and nowhere that answered "what is this thing doing on my
 * account". So each activity is one card here: what it is in one line, a
 * switch, and what it did today against its daily allowance (rule 51: against
 * the cap, never against the largest number on screen).
 *
 * The switches are the workspace's, so only an owner or an admin can press
 * them; everybody else sees the same cards with the state written where the
 * switch would be. Invitations and messages have no switch here on purpose:
 * they are what a campaign is, and they are started and paused on Campaigns.
 */
export default async function LinkedInActivityPage({ searchParams }: { searchParams: NoticeParams }) {
  const params = await searchParams;
  const session = await requireSession();
  const supabase = await createClient();

  const [{ data: ws }, { data: account }, { data: me }, { data: campaigns }, { data: posts }] = await Promise.all([
    supabase.from("workspaces").select("engage_posts, engage_comments, publish_posts, onboarding").eq("id", session.workspaceId).maybeSingle(),
    supabase
      .from("linkedin_accounts")
      .select(
        "user_id, status, invites_today, invites_this_week, invites_by_day, messages_today, profile_views_today, reactions_today, comments_today, counters_reset_on, first_action_at",
      )
      .eq("workspace_id", session.workspaceId)
      .eq("user_id", session.userId)
      .maybeSingle(),
    supabase.from("profiles").select("timezone").eq("id", session.userId).maybeSingle(),
    supabase.from("campaigns").select("status, warm_up").eq("workspace_id", session.workspaceId),
    supabase
      .from("linkedin_posts")
      .select("status")
      .eq("workspace_id", session.workspaceId)
      .eq("user_id", session.userId)
      .limit(200),
  ]);

  // Read apart from the rest, so a database without migration 0063 still
  // renders every other card; an unreadable switch shows as off.
  const [{ data: cleanupRow }, { data: backlogRow }] = await Promise.all([
    supabase.from("workspaces").select("withdraw_old_invites").eq("id", session.workspaceId).maybeSingle(),
    supabase
      .from("linkedin_accounts")
      .select("pending_invites")
      .eq("workspace_id", session.workspaceId)
      .eq("user_id", session.userId)
      .maybeSingle(),
  ]);
  const cleanup = cleanupRow?.withdraw_old_invites === true;
  const pending = typeof backlogRow?.pending_invites === "number" ? backlogRow.pending_invites : null;

  const canChange = ["owner", "admin"].includes(session.role);
  const likes = ws?.engage_posts !== false;
  // Before the comment switch existed, comments followed the likes switch.
  const comments = typeof ws?.engage_comments === "boolean" ? ws.engage_comments : likes;
  const publishing = ws?.publish_posts !== false;
  const warm = readWarmUp(ws?.onboarding, campaigns);
  const now = new Date();
  // Rolled over to the rep's today first, as the worker does before its first
  // send, or every morning opens on yesterday's numbers.
  const today = account ? countersForToday(account as unknown as AccountRecord, me?.timezone ?? "UTC", now) : null;
  const firstAction = account?.first_action_at ? Date.parse(account.first_action_at) : NaN;
  // The lower comment allowance for an account's first fortnight of sending
  // (rule 68), measured from its first action as the ramp is (rule 3).
  const newAccount = !Number.isFinite(firstAction) || now.getTime() - firstAction < LINKEDIN_LIMITS.commentsRampDays * 86_400_000;
  const commentCap = newAccount ? LINKEDIN_LIMITS.commentsPerDayNew : LINKEDIN_LIMITS.commentsPerDay;
  const inviteCap = dailyInviteCap(account?.first_action_at ? new Date(account.first_action_at) : null, now);
  const postCount = (status: string) => (posts ?? []).filter((row) => row.status === status).length;
  const waitingPosts = postCount("draft");
  const approvedPosts = postCount("approved") + postCount("failed");
  const publishedPosts = postCount("published");

  return (
    <>
      <PageNotice error={params.error} notice={params.notice} />
      <Section
        id="activity"
        title="LinkedIn activity"
        description="Everything Nora does on LinkedIn in your name. Each one stays inside your sending hours and its own daily limit."
      >
        <div className="activity-list">
          <ActivityCard
            title="Like prospects' posts"
            line="Nora likes a recent post from people you are talking to, so your name shows up before your next message."
            on={likes}
            setting="engage_posts"
            canChange={canChange}
            stats={[{ label: "Likes today", used: today?.reactions_today ?? 0, cap: LINKEDIN_LIMITS.reactionsPerDay }]}
            detail="Never the same person twice in a week, and nothing on posts about grief, illness, losing a job or politics."
            links={<Link href="/app/profile/activity/log">Activity log</Link>}
          />

          <ActivityCard
            title="Comment on prospects' posts"
            line="A short, friendly reaction to something they posted. Never a question, never a pitch, never a link."
            on={comments}
            setting="engage_comments"
            canChange={canChange}
            stats={[{ label: "Comments today", used: today?.comments_today ?? 0, cap: commentCap }]}
            detail={`${
              newAccount
                ? `${LINKEDIN_LIMITS.commentsPerDayNew} a day while your account is new. It rises to ${LINKEDIN_LIMITS.commentsPerDay} a day on its own after ${LINKEDIN_LIMITS.commentsRampDays} days of sending, because a new account that comments a lot looks automated.`
                : `${LINKEDIN_LIMITS.commentsPerDay} a day.`
            } Job posts and adverts are skipped, and you can read every comment in the activity log.`}
            links={<Link href="/app/profile/activity/log">Activity log</Link>}
          />

          <ActivityCard
            title="View profiles before inviting"
            line="Nora looks at a person's profile a few hours before the invitation, so your name is one they have already seen."
            on={warm.on}
            setting="warm_up"
            canChange={canChange}
            stats={[{ label: "Profile views today", used: today?.profile_views_today ?? 0, cap: LINKEDIN_LIMITS.profileViewsPerDay }]}
            detail={
              warm.total === 0
                ? "Every campaign you build follows this switch."
                : warm.following === warm.total
                  ? `${warm.total === 1 ? "Your campaign follows" : `All ${warm.total} of your campaigns follow`} this switch.`
                  : `${warm.following} of ${warm.total} campaigns view profiles first. Pressing the switch sets all of them.`
            }
          />

          <ActivityCard
            title="Posts on your profile"
            line="Nora drafts posts for your own profile. Nothing is posted until you read it and approve it."
            on={publishing}
            setting="publish_posts"
            canChange={canChange}
            detail={publishing ? "Approved posts go out inside your sending hours." : "Approved posts wait here until you switch this back on."}
            stats={[]}
            facts={[
              { label: "Waiting for you", value: waitingPosts },
              { label: "Approved", value: approvedPosts },
              { label: "Published", value: publishedPosts },
            ]}
            links={<Link href="/app/profile/activity/posts">Write and approve posts</Link>}
          />

          <ActivityCard
            id="cleanup"
            title="Clean up old invitations"
            line={`Nora withdraws invitations nobody answered once they are ${LINKEDIN_LIMITS.withdrawOutsideAfterDays} days old, including ones you sent yourself, a few each night.`}
            on={cleanup}
            setting="withdraw_old_invites"
            canChange={canChange}
            stats={[]}
            facts={pending === null ? [] : [{ label: "Waiting on LinkedIn now", value: pending }]}
            detail={`LinkedIn stops taking new invitations from an account with a large pile of unanswered ones, and it counts every invitation you ever sent. Nora always withdraws its own after ${LINKEDIN_LIMITS.withdrawAfterDays} days. This switch lets it clear the rest.`}
          />

          <ActivityCard
            title="Invitations and messages"
            line="Connection requests and follow-up messages. Your campaigns send these, and you start or pause them there."
            state="Run by your campaigns"
            stats={[
              { label: "Invitations today", used: today?.invites_today ?? 0, cap: inviteCap },
              { label: "Messages today", used: today?.messages_today ?? 0, cap: LINKEDIN_LIMITS.messagesPerDay },
            ]}
            links={<Link href="/app/campaigns">Campaigns</Link>}
          />
        </div>
        {canChange ? null : <p className="small muted">An owner or admin of this workspace can turn these on or off.</p>}
      </Section>
    </>
  );
}

interface Stat {
  label: string;
  used: number;
  cap: number;
}

/**
 * One activity: what it is, its switch (or its state), and today's numbers.
 *
 * A card with a header, a body and a foot, and nothing boxed inside it — the
 * numbers are a row of the card, not a card of their own.
 */
function ActivityCard({
  id,
  title,
  line,
  on,
  setting,
  canChange = false,
  state,
  stats,
  facts,
  detail,
  links,
}: {
  /** An anchor another screen links to. */
  id?: string;
  title: string;
  line: string;
  /** For an activity with a switch. */
  on?: boolean;
  setting?: "engage_posts" | "engage_comments" | "publish_posts" | "warm_up" | "withdraw_old_invites";
  canChange?: boolean;
  /** For an activity with no switch here: what decides it, in a few words. */
  state?: string;
  stats: Stat[];
  facts?: { label: string; value: number }[];
  detail?: string;
  links?: ReactNode;
}) {
  const hasSwitch = typeof on === "boolean" && setting;
  return (
    <article className="card activity-card" id={id}>
      <div className="activity-card-head">
        <div className="activity-card-text">
          <h3>{title}</h3>
          <p className="small muted">{line}</p>
        </div>
        {hasSwitch ? (
          canChange ? (
            <form action="/app/profile/activity/toggle" method="post" className="activity-card-control">
              <input type="hidden" name="setting" value={setting} />
              <input type="hidden" name="on" value={on ? "false" : "true"} />
              <LinkedInActivitySwitch on={on} label={title} />
            </form>
          ) : (
            <span className={`pill ${on ? "positive" : ""}`}>{on ? "On" : "Off"}</span>
          )
        ) : state ? (
          <span className="pill plain">{state}</span>
        ) : null}
      </div>

      {/* The overview's own meter, drawn against its cap (rule 51), not a
          second drawing of the same idea. */}
      {stats.length ? (
        <div className="allowance-row">
          {stats.map((stat) => (
            <AllowanceMeter key={stat.label} label={stat.label} used={stat.used} cap={stat.cap} />
          ))}
        </div>
      ) : null}
      {facts?.length ? (
        <dl className="activity-facts">
          {facts.map((fact) => (
            <div key={fact.label}>
              <dt>{fact.label}</dt>
              <dd className="nums">{fact.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {detail || links ? (
        <div className="activity-card-foot">
          {detail ? <p className="small muted">{detail}</p> : <span />}
          {links ? <span className="activity-card-links">{links}</span> : null}
        </div>
      ) : null}
    </article>
  );
}
