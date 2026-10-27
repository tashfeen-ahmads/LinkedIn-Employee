"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { DEFAULT_OPENER_TEMPLATE, FIRST_STEP_DELAY_DAYS, fieldsUsed, LINKEDIN_LIMITS } from "@le/shared";
import { requireSession } from "@/lib/workspace";
import { createClient } from "@/lib/supabase-server";
import { callWorker, errorQuery, noticeQuery, ALREADY_RUNNING } from "@/lib/worker";
import { queueSearch } from "@/lib/search";
import { ctaPatchFor } from "../[id]/cta-choice";
import { launchCampaign } from "../[id]/launch-campaign";
import { builderHref, readStamps, say, type BuilderStep } from "./builder";

/**
 * The campaign builder's actions, one per step.
 *
 * Each step writes rows and nothing else, and the builder reads the rows to
 * decide which step somebody is on (`readStamps`): a later step opens because
 * an earlier one is stored, never because a button was pressed in this tab.
 * Each action re-checks that its step may be saved, because a form can be
 * posted by anyone who can reach the route and the last one launches.
 *
 * Nothing here is a second way to create or launch a campaign. A list from a
 * strategy is the same search approving starts (`queueSearch`, the targeting
 * job); a list from people already here is the same insert this page always
 * made; launching is `launchCampaign`, which is `launch()` with every blocker
 * re-checked.
 */

type Db = Awaited<ReturnType<typeof createClient>>;

/**
 * Back to step 1 with the answers it was given, and the reason it refused.
 *
 * A refusal used to redirect to the bare page, so a missed tick on the list
 * cost somebody the name and the wait they had already chosen. The choices
 * travel back in the query string and become the form's defaults; the
 * prospect ticks do not, because two hundred ids is not a URL.
 */
function refuse(formData: FormData, message: string): never {
  const keep = new URLSearchParams();
  keep.set("source", "people");
  for (const key of ["name", "agent", "cta", "account", "follow_up_days"]) {
    const value = String(formData.get(key) ?? "").trim();
    if (value) keep.set(key, value.slice(0, 200));
  }
  keep.set("warm_up", formData.get("warm_up") === "on" ? "on" : "off");
  keep.set("error", message);
  redirect(`/app/campaigns/new?${keep.toString()}`);
}

/**
 * What a database refusal says to the person who caused it.
 *
 * Postgres error text ("violates foreign key constraint …") was handed to the
 * banner verbatim. It names our tables to a customer and tells them nothing
 * they can do, so it goes to the log and a sentence goes to the screen.
 */
function failed(stage: string, error: { message?: string } | null): string {
  if (error?.message) console.error(`[campaigns/new] ${stage}: ${error.message}`);
  return "The campaign could not be saved. Nothing was sent. Try again, and tell us through Support if it keeps happening.";
}

/**
 * The campaign's template note: the line every prospect falls back to when
 * the writer has not answered for them individually.
 *
 * The agent's own opener, the default one rather than whichever row came back
 * first: an opener is chosen as the default precisely so that "which of these
 * does this workspace lead with" has one answer on every day. Without one the
 * fallback is empty and the invitation goes out with no note at all, which is
 * ordinary on LinkedIn but is not what anybody picking an agent expected.
 *
 * Greeted, unless the opener greets them itself. An opener is written to be
 * one line inside a note — most of them are a bare question — and a
 * connection request opening on a bare question, from a name the reader does
 * not know, reads as a mailshot.
 */
async function templateFor(supabase: Db, agentId: string | null): Promise<string> {
  let template = DEFAULT_OPENER_TEMPLATE;
  if (agentId) {
    const { data: opener } = await supabase
      .from("hooks")
      .select("body, is_default")
      .eq("agent_id", agentId)
      .not("approved_at", "is", null)
      .order("is_default", { ascending: false })
      .limit(1);
    const line = opener?.[0]?.body?.trim();
    if (line) {
      template = fieldsUsed(line).includes("first_name") ? line : `${DEFAULT_OPENER_TEMPLATE} ${line}`;
    }
  }
  return template;
}

/**
 * Step 1, from people already in the workspace: name it, choose who is on it.
 *
 * Who is offered is the load-bearing part. Anybody this workspace has already
 * contacted is not on the list, because nobody is approached twice under a
 * different pretext (rule 24) — and the send path checks again immediately
 * before the invitation anyway, because two campaigns built from the same list
 * can legitimately queue the same person.
 */
export async function createCampaign(formData: FormData) {
  const session = await requireSession();
  const supabase = await createClient();

  const name = String(formData.get("name") ?? "").trim();
  const agentId = String(formData.get("agent") ?? "").trim();
  const ctaId = String(formData.get("cta") ?? "").trim();
  const accountId = String(formData.get("account") ?? "").trim();
  const followUpDays = Number(formData.get("follow_up_days") ?? 3);
  const warmUp = formData.get("warm_up") === "on";
  const chosen = formData.getAll("prospect").map(String).filter(Boolean);

  if (!name) refuse(formData, "Give the campaign a name you will recognize.");
  if (!accountId) refuse(formData, "Connect a LinkedIn account before building a campaign.");
  if (chosen.length === 0) refuse(formData, "Pick at least one person for this campaign.");
  if (!Number.isInteger(followUpDays) || followUpDays < 1 || followUpDays > 30) {
    refuse(formData, "The follow-up wait has to be a whole number of days, between 1 and 30.");
  }

  /*
   * The form's ids are claims, so each one is checked against this workspace.
   *
   * The account is the one every message in this campaign is sent from: an id
   * this workspace does not own, or one that has since disconnected, would
   * build a campaign that sends from somebody else's LinkedIn or from nothing.
   * And the people are re-read under the same rule the list was drawn with,
   * because the page may be an hour old: somebody contacted or marked
   * do-not-contact since it loaded is not added to a new campaign (rule 24).
   */
  const { data: sender } = await supabase
    .from("linkedin_accounts")
    .select("id")
    .eq("id", accountId)
    .eq("workspace_id", session.workspaceId)
    .eq("status", "active")
    .maybeSingle();
  if (!sender) refuse(formData, "That LinkedIn account is not connected to this workspace any more. Choose another, or reconnect it on your profile.");

  const { data: eligible } = await supabase
    .from("prospects")
    .select("id")
    .eq("workspace_id", session.workspaceId)
    .in("id", chosen)
    .is("last_contacted_at", null)
    .eq("do_not_contact", false);
  const allowed = new Set((eligible ?? []).map((row) => row.id));
  const people = chosen.filter((id) => allowed.has(id));
  if (people.length === 0) {
    refuse(formData, "Everybody you picked has been contacted or marked do not contact since this page loaded. Pick again.");
  }

  // The workspace's default agent writes for it until step 3 says otherwise,
  // so the fallback note is in that agent's voice from the first moment.
  let writer = agentId || null;
  if (!writer) {
    const { data: fallback } = await supabase
      .from("agents")
      .select("id")
      .eq("workspace_id", session.workspaceId)
      .is("archived_at", null)
      .order("is_default", { ascending: false })
      .limit(1);
    writer = fallback?.[0]?.id ?? null;
  }
  const template = await templateFor(supabase, writer);

  const { data: cta } = ctaId
    ? await supabase
        .from("ctas")
        .select("kind, label, url")
        .eq("id", ctaId)
        .eq("workspace_id", session.workspaceId)
        .maybeSingle()
    : { data: null };

  const { data: campaign, error } = await supabase
    .from("campaigns")
    .insert({
      workspace_id: session.workspaceId,
      linkedin_account_id: accountId,
      owner_user_id: session.userId,
      agent_id: writer,
      name,
      // Draft, always. A campaign that launched itself the moment it was
      // created would skip the review this product is built on, and the review
      // is the only thing standing between a list and a real person's inbox.
      status: "draft",
      connection_note: template,
      cta_id: ctaId || null,
      cta_kind: (cta?.kind as "meeting" | "link" | "reply") ?? "reply",
      cta_label: cta?.label ?? null,
      cta_url: cta?.url ?? null,
      warm_up: warmUp,
      daily_invite_cap: LINKEDIN_LIMITS.invitesPerDayStart,
      stop_conditions: ["prospect replies", "prospect opts out"] as never,
      rules: { builtFrom: "prospect list" } as never,
    })
    .select("id")
    .single();

  if (error || !campaign) refuse(formData, failed("insert campaign", error));

  // Both steps in one statement. A campaign holding step 1 and not step 2
  // sends a follow-up and then silently stops, and a partial sequence is not a
  // state anybody can see from a screen.
  const { error: stepsError } = await supabase.from("campaign_steps").insert([
    {
      workspace_id: session.workspaceId,
      campaign_id: campaign.id,
      variant_id: null,
      step_number: 1,
      // Not configurable, and not stored as anything else (rule 43): what
      // precedes step 1 is the acceptance, not a message.
      delay_days: FIRST_STEP_DELAY_DAYS,
      message: `Hi {{first_name}}, thanks for connecting.`,
    },
    {
      workspace_id: session.workspaceId,
      campaign_id: campaign.id,
      variant_id: null,
      step_number: 2,
      delay_days: followUpDays,
      // A pointer rather than a copy of the words, so improving the agent's
      // offer improves every campaign using it without re-reviewing copy
      // somebody already approved. With one easy question after it: the
      // offer alone arrives as a line of advertising, and a step that is only
      // `{{pitch}}` fails the voice check (rule 66).
      message: `{{pitch}} Would that be useful for you?`,
    },
  ]);
  if (stepsError) {
    // The draft exists without its messages; send them to it rather than back
    // here, where pressing Create again would make a second one.
    failed("insert steps", stepsError);
    redirect(
      errorQuery(
        `/app/campaigns/${campaign.id}/follow-ups`,
        "The campaign was created as a draft, but its messages could not be saved. Nothing was sent. Write them here before launching.",
      ),
    );
  }

  const { error: linkError } = await supabase.from("campaign_prospects").insert(
    people.map((prospectId) => ({
      workspace_id: session.workspaceId,
      campaign_id: campaign.id,
      prospect_id: prospectId,
      status: "queued" as const,
      // The template note, named as such. The personalised one is written by
      // the agent on the campaign screen before launch; leaving this null would
      // mean an invitation with no note at all if that never happens.
      invite_note: null,
    })),
  );
  if (linkError) {
    failed("insert prospects", linkError);
    redirect(
      errorQuery(
        `/app/campaigns/${campaign.id}`,
        "The campaign was created as a draft, but the people you chose could not be added to it. Nothing was sent.",
      ),
    );
  }

  // A note for each person, written now from their own details (rule 16).
  // Without this everybody on a list built here received the template, which
  // is the agent's one opener pasted for every audience. A writer that does
  // not answer leaves the template in place and says so on People, rather
  // than stopping the campaign (rule 27).
  const notes = await callWorker<{ ok: boolean; rewritten?: number; unanswered?: number }>(
    "/jobs/rewrite-notes",
    { workspaceId: session.workspaceId, userId: session.userId, campaignId: campaign.id },
    90_000,
  );
  const notesWritten = notes.ok && notes.data?.ok !== false ? (notes.data?.rewritten ?? 0) : 0;

  // Said when the list shrank, because a name that quietly goes missing from
  // a list somebody chose is its own bug report (rule 24).
  const skipped = chosen.length - people.length;
  revalidatePath("/app/campaigns");
  redirect(
    say(
      builderHref(campaign.id, "goal"),
      `${people.length} ${people.length === 1 ? "person" : "people"} queued as a draft.` +
        (skipped > 0 ? ` ${skipped} left off: contacted or marked do not contact since the list loaded.` : "") +
        (notesWritten > 0
          ? ` A note was written for ${notesWritten === people.length ? "each of them" : `${notesWritten} of them`}.`
          : " Their notes could not be written just now; rewrite them under Opener & offer before launching.") +
        " Now choose what it asks for.",
      "notice",
    ),
  );
}

/**
 * Step 1, from a strategy: the same search approving a strategy starts.
 *
 * The Targeting Agent finds the people, writes a note for each and stores the
 * campaign as a draft; the builder waits on that row (`?strategy=`) and moves
 * on by itself when it exists. Only approved strategies (rule 9) — the worker
 * refuses anything else anyway, and the form's id is a claim.
 */
export async function startFromStrategy(formData: FormData) {
  const session = await requireSession();
  const supabase = await createClient();
  const profileId = String(formData.get("strategy") ?? "").trim();
  const back = "/app/campaigns/new?source=strategy";

  const { data: profile } = profileId
    ? await supabase
        .from("customer_profiles")
        .select("id")
        .eq("id", profileId)
        .eq("workspace_id", session.workspaceId)
        .eq("do_not_pursue", false)
        .not("approved_at", "is", null)
        .maybeSingle()
    : { data: null };
  if (!profile) redirect(say(back, "Pick an approved strategy. A strategy is searched only once a person has approved it.", "error"));

  // Stamped before the press, so the row the search writes is recognised as
  // this press's and not an older draft from the same strategy.
  const since = new Date(Date.now() - 5_000).toISOString();
  const started = await queueSearch(session.workspaceId, session.userId, supabase, profile.id);
  if (!started.ok) redirect(say(back, `The search has not started. ${started.reason}`, "error"));

  const waiting = `/app/campaigns/new?strategy=${encodeURIComponent(profile.id)}&since=${encodeURIComponent(since)}`;
  redirect(
    say(
      waiting,
      started.alreadyRunning
        ? ALREADY_RUNNING
        : "Searching LinkedIn for people who fit. It takes about a minute, and this page moves on by itself.",
      "notice",
    ),
  );
}

/** Step 1 again, once the draft exists: its name is the one thing to change here. */
export async function renameCampaign(formData: FormData) {
  const session = await requireSession();
  const supabase = await createClient();
  const campaignId = String(formData.get("campaignId"));
  const name = String(formData.get("name") ?? "").trim().slice(0, 120);
  const here = builderHref(campaignId, "details");
  if (!name) redirect(say(here, "Give the campaign a name you will recognize.", "error"));

  const { data: saved, error } = await supabase
    .from("campaigns")
    .update({ name })
    .eq("id", campaignId)
    .eq("workspace_id", session.workspaceId)
    .eq("status", "draft")
    .select("id, rules");
  if (error || !saved?.length) {
    if (error) console.error(`[campaigns/new] rename: ${error.message}`);
    redirect(say(here, "The name could not be saved. Nothing changed. Try again.", "error"));
  }
  revalidatePath("/app/campaigns");
  const next: BuilderStep = readStamps(saved[0]!.rules).goal ? "agent" : "goal";
  redirect(builderHref(campaignId, next));
}

/**
 * Reads a draft for a builder step, or refuses.
 *
 * The builder only edits drafts: a campaign that is running is changed in its
 * own sections, where every edit says what it does to people already reached.
 */
async function draftFor(supabase: Db, workspaceId: string, campaignId: string) {
  const { data } = await supabase
    .from("campaigns")
    .select("id, status, rules, agent_id, connection_note")
    .eq("id", campaignId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!data) redirect(errorQuery("/app/campaigns/new", "That campaign could not be found."));
  if (data.status !== "draft") redirect(noticeQuery(`/app/campaigns/${data.id}`, "This campaign is no longer a draft, so it is changed here rather than in the builder."));
  return data;
}

/** The step stamps, merged into the campaign's rules, never replacing them. */
function stamped(rules: unknown, step: "goal" | "agent"): Record<string, unknown> {
  const base = (rules && typeof rules === "object" ? rules : {}) as Record<string, unknown>;
  const builder = (base.builder && typeof base.builder === "object" ? base.builder : {}) as Record<string, unknown>;
  return { ...base, builder: { ...builder, [step]: new Date().toISOString() } };
}

/** Step 2: what the campaign asks for. The same cards, and the same write, as its Goal & link section. */
export async function saveBuilderGoal(formData: FormData) {
  const session = await requireSession();
  const supabase = await createClient();
  const campaignId = String(formData.get("campaignId"));
  const here = builderHref(campaignId, "goal");
  const draft = await draftFor(supabase, session.workspaceId, campaignId);

  const chosen = await ctaPatchFor(supabase, session, formData);
  if (!chosen.ok) redirect(say(here, chosen.reason, "error"));

  const { data: saved, error } = await supabase
    .from("campaigns")
    .update({ ...chosen.patch, rules: stamped(draft.rules, "goal") as never })
    .eq("id", campaignId)
    .eq("workspace_id", session.workspaceId)
    .eq("status", "draft")
    .select("id");
  if (error || !saved?.length) {
    if (error) console.error(`[campaigns/new] goal: ${error.message}`);
    redirect(say(here, "The goal could not be saved. Nothing changed. Try again.", "error"));
  }
  revalidatePath(`/app/campaigns/${campaignId}`, "layout");
  redirect(builderHref(campaignId, "agent"));
}

/**
 * Step 3: which agent writes for it, and whether replies wait for a person.
 *
 * The same two columns the campaign's Replies section writes. When the agent
 * changes and the fallback note is still the one the old agent's opener made,
 * it is remade from the new agent's, so the voice the person just chose is the
 * voice a stranger without a note of their own receives. A note somebody
 * edited is left exactly as they wrote it.
 */
export async function saveBuilderAgent(formData: FormData) {
  const session = await requireSession();
  const supabase = await createClient();
  const campaignId = String(formData.get("campaignId"));
  const here = builderHref(campaignId, "agent");
  const draft = await draftFor(supabase, session.workspaceId, campaignId);
  if (!readStamps(draft.rules).goal) redirect(builderHref(campaignId, "goal"));

  const agentField = formData.get("agentId");
  const replyMode = String(formData.get("replyMode") ?? "");
  if (replyMode !== "approval" && replyMode !== "autopilot") {
    redirect(say(here, "Choose who answers the replies.", "error"));
  }

  const patch: Record<string, unknown> = { reply_mode: replyMode, rules: stamped(draft.rules, "agent") };
  if (agentField !== null) {
    const agentId = String(agentField) || null;
    if (agentId) {
      const { data: agent } = await supabase
        .from("agents")
        .select("id")
        .eq("id", agentId)
        .eq("workspace_id", session.workspaceId)
        .is("archived_at", null)
        .maybeSingle();
      if (!agent) redirect(say(here, "That agent is not available any more. Pick another.", "error"));
    }
    patch.agent_id = agentId;
    if (agentId !== draft.agent_id && draft.connection_note === (await templateFor(supabase, draft.agent_id))) {
      patch.connection_note = await templateFor(supabase, agentId);
    }
  }

  const { data: saved, error } = await supabase
    .from("campaigns")
    .update(patch as never)
    .eq("id", campaignId)
    .eq("workspace_id", session.workspaceId)
    .eq("status", "draft")
    .select("id");
  if (error || !saved?.length) {
    if (error) console.error(`[campaigns/new] agent: ${error.message}`);
    redirect(say(here, "That could not be saved. Nothing changed. Try again.", "error"));
  }
  revalidatePath(`/app/campaigns/${campaignId}`, "layout");
  redirect(builderHref(campaignId, "review"));
}

/**
 * Step 4: launch, through the one launch there is.
 *
 * Refused until steps 2 and 3 are stored, on the server as well as on the
 * screen; `launchCampaign` then re-checks every blocker and sends a first
 * launch to setup's own launch step, exactly as the campaign's Launch does.
 */
export async function launchFromBuilder(formData: FormData) {
  const session = await requireSession();
  const supabase = await createClient();
  const campaignId = String(formData.get("campaignId"));
  const draft = await draftFor(supabase, session.workspaceId, campaignId);
  const stamps = readStamps(draft.rules);
  if (!stamps.goal) redirect(builderHref(campaignId, "goal"));
  if (!stamps.agent) redirect(builderHref(campaignId, "agent"));
  await launchCampaign(campaignId, session);
}
