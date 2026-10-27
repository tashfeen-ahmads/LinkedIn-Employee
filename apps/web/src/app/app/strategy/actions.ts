"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { CTA_DEFINITIONS, CTA_KINDS, checkCtaUrl, type CtaKind } from "@le/shared";
import { requireSession } from "@/lib/workspace";
import { queueSearch } from "@/lib/search";
import { approveStrategy } from "@/lib/approve";
import { chosenCtaColumns, ensureCta } from "@/lib/cta-library";
import { createClient } from "@/lib/supabase-server";
import { ALREADY_RUNNING, callWorker, errorQuery, noticeQuery, startedNotice } from "@/lib/worker";
import { FILTER_FIELDS, applyProfileEdits } from "@/lib/profile-form";

/*
 * The strategy screens' actions, shared by the business profile, each
 * strategy's own page and Ask Sage for more.
 *
 * They lived inside the one long page; now that every strategy has its own
 * page, an action pressed there has to return there, so each one is defined
 * once here rather than copied onto three pages.
 */

const UUID = /^[0-9a-f-]{36}$/i;

/**
 * Where an action returns to: the strategy page it was pressed on, or the
 * business tab. Only ids this form carried, and only in this screen's own
 * paths, so a form cannot turn it into a redirect anywhere else.
 */
function backTo(formData: FormData): string {
  const strategy = String(formData.get("strategyPage") ?? "").trim();
  if (UUID.test(strategy)) return `/app/strategy/${strategy}`;
  if (formData.get("from") === "more") return "/app/strategy/more";
  // Prospects' Find new starts a search through this same action, so it has
  // one definition (rule 20), and lands back where it was pressed.
  if (formData.get("from") === "prospects-find") return "/app/prospects/find";
  const business = String(formData.get("business") ?? "").trim();
  return UUID.test(business) ? `/app/strategy?business=${business}` : "/app/strategy";
}

/** `noticeQuery`/`errorQuery` for an address that may already carry `?business=`. */
function said(href: string, key: "notice" | "error", message: string): string {
  const query = key === "notice" ? noticeQuery("", message) : errorQuery("", message);
  return href.includes("?") ? `${href}&${query.slice(1)}` : `${href}${query}`;
}

/**
 * Approving is the decision, so approving is what starts the work.
 *
 * It used to set a flag and stop. The person then had to find a second button
 * on the same card and press it to make anything happen — and until they did,
 * a workspace that had approved a strategy looked identical to one that had
 * not. "Yes, go after these people" and "now go" are not two decisions; the
 * second was a step the product asked for because of how it was built.
 *
 * The search is not started again for a strategy that already produced a
 * campaign. Re-approving something after a look at it is not a request for a
 * second list of the same people, and rule 24 means that second list finds
 * nobody anyway. Growing an existing campaign is `Find more`, which is a
 * deliberate act with its own button.
 */
export async function approveProfile(formData: FormData) {
  const id = String(formData.get("profileId"));
  const back = backTo(formData);
  const session = await requireSession();
  const supabase = await createClient();

  /*
   * The call to action chosen in setup, onto a strategy that points at none
   * (rule 65), exactly as onboarding's own approval step applies it. A
   * strategy with a `cta_id` already says what it asks for: chosen on this
   * page or in setup, and never overwritten. `approveStrategy` writes it only
   * while the strategy has no campaign, whose copy was written to the old ask.
   */
  const { data: current } = await supabase
    .from("customer_profiles")
    .select("cta_id")
    .eq("id", id)
    .eq("workspace_id", session.workspaceId)
    .maybeSingle();
  const extra = current && !current.cta_id ? await chosenCtaColumns(supabase, session.workspaceId, session.userId) : {};

  // Checked, because approving is the one decision this screen exists for
  // (rule 9). The shared definition checks the rows it changed, and asks
  // whether a campaign already came from this strategy.
  const approved = await approveStrategy(supabase, session.workspaceId, id, extra);
  if (!approved.ok) {
    redirect(said(back, "error", "That strategy could not be approved, so nothing was searched for. Reload the page and try again."));
  }

  revalidatePath("/app/strategy", "layout");
  revalidatePath("/app/campaigns");

  if (approved.hasCampaign) {
    redirect(said(back, "notice", "Approved. This strategy already has a campaign, so use Find more on it to grow its list."));
  }

  const started = await queueSearch(session.workspaceId, session.userId, supabase, id);
  redirect(
    said(
      back,
      "notice",
      started.ok
        ? started.alreadyRunning
          ? `Approved. ${ALREADY_RUNNING}`
          : "Approved. The agent is searching now and will build you a campaign to review. It takes about a minute."
        : `Approved, but the search has not started: ${started.reason}`,
    ),
  );
}

export async function dropProfile(formData: FormData) {
  const id = String(formData.get("profileId"));
  const back = backTo(formData);
  const session = await requireSession();
  const supabase = await createClient();

  // Kept, not deleted: "we decided not to pursue this market" is worth
  // remembering, and undoing it is one click.
  const { data: dropped, error } = await supabase
    .from("customer_profiles")
    .update({ do_not_pursue: true, approved_at: null })
    .eq("id", id)
    .eq("workspace_id", session.workspaceId)
    .select("id");
  if (error || !dropped?.length) {
    if (error) console.error(`[strategy] drop profile: ${error.message}`);
    redirect(said(back, "error", "That strategy could not be set aside. Try again."));
  }

  revalidatePath("/app/strategy", "layout");
  // Said, because the page only changes its label: without a sentence the
  // press looked like nothing had happened.
  redirect(said(back, "notice", "Set aside. Nothing will be searched for it, and Pursue after all brings it back."));
}

export async function saveProfile(formData: FormData) {
  const id = String(formData.get("profileId"));
  const back = backTo(formData);
  const session = await requireSession();
  const supabase = await createClient();

  const { data: row } = await supabase
    .from("customer_profiles")
    .select("spec")
    .eq("id", id)
    .eq("workspace_id", session.workspaceId)
    .maybeSingle();
  if (!row) redirect(said(back, "error", "That strategy could not be found. Reload the page and try again."));

  const filters = Object.fromEntries(
    FILTER_FIELDS.map((field) => [field.key, String(formData.get(field.key) ?? "")]),
  ) as Record<(typeof FILTER_FIELDS)[number]["key"], string>;

  const result = applyProfileEdits(row.spec, {
    priority: Number(formData.get("priority")) || 3,
    filters,
  });
  if (!result.ok) redirect(said(back, "error", result.error));

  // What campaigns from this strategy ask for. Set here rather than on the
  // campaign, because the copy is written toward the ask: a sequence built for
  // a call and then switched to a link is a sequence whose first two messages
  // were arguing for something else.
  const ctaKind = String(formData.get("ctaKind") ?? "meeting");
  const kind: CtaKind = CTA_KINDS.includes(ctaKind as CtaKind) ? (ctaKind as CtaKind) : "meeting";
  const ctaLabel = String(formData.get("ctaLabel") ?? "").trim() || null;

  let ctaUrl: string | null = null;
  if (CTA_DEFINITIONS[kind].needsUrl) {
    // Checked before it is stored, because it is typed by a person here and
    // then sent to a stranger under a real rep's name. The reason is shown
    // rather than a generic refusal: somebody who pasted "acme.test/signup"
    // needs to be told it is missing the https://, not that it is invalid.
    const checked = checkCtaUrl(String(formData.get("ctaUrl") ?? ""));
    if (!checked.ok) redirect(said(back, "error", checked.reason));
    ctaUrl = checked.url;
  }

  // The library entry for what was just typed, so the strategy's pointer
  // names the same ask as its columns. Left pointing at an older entry, the
  // campaign this strategy builds would send that entry's destination while
  // its copy argued for this one (rule 36) — and an approval would not know
  // the strategy already has an ask of its own.
  const ctaId = await ensureCta(supabase, session.workspaceId, session.userId, {
    kind,
    label: ctaLabel,
    url: ctaUrl,
  });

  const { error: saveError } = await supabase
    .from("customer_profiles")
    .update({
      spec: result.spec as never,
      priority: result.spec.priority,
      cta_kind: kind,
      cta_label: ctaLabel,
      // Cleared when the goal is no longer a link, or the database constraint
      // and the screen would disagree about what this strategy is doing.
      cta_url: ctaUrl,
      cta_id: ctaId,
    })
    .eq("id", id)
    .eq("workspace_id", session.workspaceId);
  if (saveError) {
    console.error(`[strategy] save profile: ${saveError.message}`);
    redirect(said(back, "error", "The search could not be saved. Nothing changed. Try again."));
  }

  revalidatePath("/app/strategy", "layout");
  redirect(said(back, "notice", "Search saved. The next search for this strategy uses it."));
}

/**
 * Asks the Strategy Agent for more strategies.
 *
 * The first run writes three to five, which is the right number to read and
 * approve on a first afternoon and the wrong number to run a business on — a
 * company works fifteen or twenty segments, and this product had no way to get
 * past the first handful. Pressing this adds four more, written against what
 * already exists so it does not hand back the same three with different nouns.
 */
export async function writeMoreStrategies(formData: FormData) {
  const session = await requireSession();
  const back = backTo(formData);
  // Which business they are adding to. Absent is the workspace's first, which
  // is every workspace that has only ever had one — and the reason the id
  // travels at all is that a workspace with two had its new segments filed
  // under whichever business happened to be oldest.
  const businessProfileId = String(formData.get("businessProfileId") ?? "").trim() || undefined;

  const queued = await callWorker("/jobs/strategy", {
    workspaceId: session.workspaceId,
    userId: session.userId,
    expand: true,
    businessProfileId,
  });
  if (!queued.ok) redirect(said(back, "error", queued.error));

  revalidatePath("/app/strategy", "layout");
  redirect(
    said(
      back,
      "notice",
      startedNotice(
        queued.data,
        "Writing four more. They arrive in this menu in a minute or two, unapproved like the others: nothing is searched for until you read one.",
      ),
    ),
  );
}

/**
 * "None of these fit?": who the owner actually sells to, in their words.
 *
 * The same request onboarding's approval step makes (`rewrite` in
 * `/onboarding/save`): Sage writes new strategies from the guidance, and the
 * worker sets aside the unapproved ones with no campaign only once the new
 * ones are stored — never an approved one, never one that has a campaign
 * (rule 65). Without it here, an owner past setup whose suggestions were all
 * wrong could only approve a segment they knew was wrong, or stop.
 */
export async function rewriteStrategies(formData: FormData) {
  const session = await requireSession();
  const back = backTo(formData);
  const guidance = String(formData.get("guidance") ?? "").trim();
  if (guidance.length < 3) {
    redirect(said(back, "error", "Say who you actually sell to, in a few words, and Sage writes new strategies from it."));
  }
  const businessProfileId = String(formData.get("businessProfileId") ?? "").trim() || undefined;

  const queued = await callWorker("/jobs/strategy", {
    workspaceId: session.workspaceId,
    userId: session.userId,
    expand: true,
    businessProfileId,
    guidance: guidance.slice(0, 600),
  });
  if (!queued.ok) redirect(said(back, "error", queued.error));

  revalidatePath("/app/strategy", "layout");
  redirect(
    said(
      back,
      "notice",
      startedNotice(
        queued.data,
        "Sage is writing new strategies from what you said. They arrive in this menu in a minute or two, and the unapproved ones without a campaign are set aside once they do.",
      ),
    ),
  );
}

/**
 * A second business, with its own profile and its own strategies.
 *
 * Deliberately not `expand`. Rule 37 is explicit that adding *strategies* must
 * extend the business profile already here rather than inserting a second one,
 * because the profile is what every strategy hangs off and a workspace with two
 * has its list split across both. This is the other thing — somebody who really
 * does run a cleaning company and an estate agency, and needs the split.
 *
 * So it is a separate button with a separate word on it, and it asks for the
 * website: a business profile written from nothing is a fluent invention
 * offered for approval as though it came from somewhere.
 */
export async function addBusiness(formData: FormData) {
  const session = await requireSession();
  const back = backTo(formData);
  if (!["owner", "admin"].includes(session.role)) {
    redirect(said(back, "error", "Only an owner or admin can add a business."));
  }

  const websiteUrl = String(formData.get("websiteUrl") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  if (!websiteUrl && !description) {
    redirect(said(back, "error", "Give the agent a website or a description. It will not invent a business."));
  }

  const queued = await callWorker("/jobs/strategy", {
    workspaceId: session.workspaceId,
    userId: session.userId,
    websiteUrl: websiteUrl || undefined,
    description: description || undefined,
  });
  if (!queued.ok) redirect(said(back, "error", queued.error));

  revalidatePath("/app/strategy", "layout");
  redirect(
    said(
      back,
      "notice",
      startedNotice(
        queued.data,
        "Reading that site now. The new business and its strategies appear here in a minute or two, unapproved, and they keep their own list, so nothing changes for the business you already run.",
      ),
    ),
  );
}

/**
 * Starts the Targeting Agent for one approved strategy, through the one
 * search path approving also takes (`queueSearch`). Kept as its own button
 * because a deliberate re-run is a real thing to want — approving starts the
 * search once, and this is how somebody asks for it again without
 * un-approving anything. Refuses without a connected LinkedIn account rather
 * than queueing a job that would fail silently in the worker.
 */
export async function findProspects(formData: FormData) {
  const profileId = String(formData.get("profileId"));
  const back = backTo(formData);
  const session = await requireSession();
  const supabase = await createClient();

  const started = await queueSearch(session.workspaceId, session.userId, supabase, profileId);
  if (!started.ok) {
    redirect(said(back, "error", `Could not start the search: ${started.reason}`));
  }

  revalidatePath("/app/strategy", "layout");
  revalidatePath("/app/prospects", "layout");
  revalidatePath("/app/campaigns");
  // Said out loud, because the work happens somewhere else. The button returns
  // the moment the job is accepted, the agent takes the better part of a
  // minute, and without a sentence here the page looks exactly as it did
  // before the click -- which is what had somebody pressing it repeatedly and
  // queueing three searches of the same profile.
  redirect(
    said(
      back,
      "notice",
      started.alreadyRunning
        ? ALREADY_RUNNING
        : "Searching LinkedIn now. It takes about a minute; the list appears under Prospects, and this page will say if it stops early.",
    ),
  );
}
