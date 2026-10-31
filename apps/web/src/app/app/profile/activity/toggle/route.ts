import type { NextRequest } from "next/server";
import { requireSession } from "@/lib/workspace";
import { createClient } from "@/lib/supabase-server";
import { errorQuery, noticeQuery } from "@/lib/worker";
import { seeOther } from "@/lib/see-other";
import { mergeStash } from "@/lib/onboarding-stash";
import { WARM_UP_CAMPAIGN_STATUSES } from "../../activity-state";

const HERE = "/app/profile/activity";

/**
 * The switches on the LinkedIn activity section, for the whole workspace.
 *
 * A route rather than a server action, for rule 57's reason: an action's id
 * changes with every deploy, and a page left open across one would post to
 * nothing. Owners and admins only, the roles the database lets write the
 * workspace row, so the switch a member sees is a state, never a control.
 *
 * `engage_posts` is the column the hourly planner reads (rule 68); turning it
 * off skips anything already planned. `warm_up` is stored on the workspace
 * beside the reply setting and written onto every campaign that can still
 * send, which is the column the pacing loop reads; nothing in the worker
 * changes.
 */
export async function POST(request: NextRequest) {
  if (request.headers.get("sec-fetch-site") === "cross-site") {
    return seeOther(errorQuery(HERE, "That was refused. Change it from this page."));
  }
  const session = await requireSession();
  if (!["owner", "admin"].includes(session.role)) {
    return seeOther(errorQuery(HERE, "Only an owner or admin can change this."));
  }
  const form = await request.formData().catch(() => null);
  const on = String(form?.get("on") ?? "") === "true";
  const supabase = await createClient();

  // The old Likes and comments page posted no `setting`, and its one switch
  // meant both. A page left open across the deploy must still stop comments
  // when somebody asked it to stop everything.
  if (form && !form.has("setting")) {
    const { data } = await supabase
      .from("workspaces")
      .update({ engage_posts: on, engage_comments: on })
      .eq("id", session.workspaceId)
      .select("id");
    if (!data?.length) return seeOther(errorQuery(HERE, "That could not be saved just now. Try again."));
    return seeOther(
      noticeQuery(
        HERE,
        on
          ? "Nora will like and comment on your prospects' posts again."
          : "Nora has stopped liking and commenting. Anything already planned is skipped.",
      ),
    );
  }
  const setting = String(form?.get("setting") ?? "");

  if (setting === "engage_posts") {
    const { data } = await supabase
      .from("workspaces")
      .update({ engage_posts: on })
      .eq("id", session.workspaceId)
      .select("id");
    if (!data?.length) return seeOther(errorQuery(HERE, "That could not be saved just now. Try again."));
    return seeOther(
      noticeQuery(
        HERE,
        on
          ? "Nora will like your prospects' posts again."
          : "Nora has stopped liking posts. Anything already planned is skipped.",
      ),
    );
  }

  const SWITCHES = {
    engage_comments: [
      "Nora will comment on your prospects' posts again.",
      "Nora has stopped commenting. Anything already planned is skipped.",
    ],
    publish_posts: [
      "Approved posts will go out inside your sending hours.",
      "Nothing will be posted. Approved posts wait until you switch this back on.",
    ],
    withdraw_old_invites: [
      "Nora will withdraw unanswered invitations once they are three weeks old, a few at a time through your working day.",
      "Nora will withdraw only the invitations it sent itself.",
    ],
  } as const;
  if (setting === "engage_comments" || setting === "publish_posts" || setting === "withdraw_old_invites") {
    const { data } = await supabase
      .from("workspaces")
      .update({ [setting]: on } as { engage_comments?: boolean; publish_posts?: boolean; withdraw_old_invites?: boolean })
      .eq("id", session.workspaceId)
      .select("id");
    if (!data?.length) return seeOther(errorQuery(HERE, "That could not be saved just now. Try again."));
    return seeOther(noticeQuery(HERE, SWITCHES[setting][on ? 0 : 1]));
  }

  if (setting === "warm_up") {
    // `onboarding` holds every other setup answer, so a read that failed must
    // not become a write of `{ warmUp }` over all of them.
    const { data: ws, error: readError } = await supabase
      .from("workspaces")
      .select("onboarding")
      .eq("id", session.workspaceId)
      .maybeSingle();
    if (readError || !ws) return seeOther(errorQuery(HERE, "That could not be saved just now. Try again."));
    const { data: saved } = await supabase
      .from("workspaces")
      .update({ onboarding: mergeStash(ws.onboarding, { warmUp: on }) as never })
      .eq("id", session.workspaceId)
      .select("id");
    if (!saved?.length) return seeOther(errorQuery(HERE, "That could not be saved just now. Try again."));
    // Every campaign that can still send follows; a finished one is a record.
    const { data: campaigns, error } = await supabase
      .from("campaigns")
      .update({ warm_up: on })
      .eq("workspace_id", session.workspaceId)
      .in("status", [...WARM_UP_CAMPAIGN_STATUSES])
      .select("id");
    if (error) {
      return seeOther(errorQuery(HERE, "Saved for new campaigns, but your current campaigns could not be changed. Try again."));
    }
    const count = campaigns?.length ?? 0;
    const which = count === 1 ? " Your campaign follows this." : count ? ` All ${count} of your campaigns follow this.` : "";
    return seeOther(
      noticeQuery(
        HERE,
        on
          ? `Nora will view each person's profile a few hours before inviting them.${which}`
          : `Nora will invite people without viewing their profile first.${which}`,
      ),
    );
  }

  return seeOther(errorQuery(HERE, "That setting is not one this page changes."));
}
