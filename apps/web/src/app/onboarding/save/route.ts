import type { NextRequest } from "next/server";
import { checkCtaUrl, isValidTimezone } from "@le/shared";
import { createClient } from "@/lib/supabase-server";
import { seeOther } from "@/lib/see-other";
import { callWorker } from "@/lib/worker";
import { mergeStash, stampConfirmation, type StashedCta } from "@/lib/onboarding-stash";
import { readWizard } from "@/lib/wizard-state";
import { currentStep, stepIndex, type WizardStepKey } from "@/lib/wizard";
import { queueSearch } from "@/lib/search";
import { launch } from "@/lib/launch";
import { approveStrategy, planFlags } from "@/lib/approve";
import { AUTONOMY_ROLES, setReplyHandling } from "@/lib/autonomy";
import { carryVoiceToAgent } from "@/lib/agent-voice";
import { ensureCta } from "@/lib/cta-library";
import { AVAILABILITY_DEFAULTS, availabilityProblem, saveAvailability } from "@/lib/availability";

/*
 * Every onboarding step after the first posts here (rule 65).
 *
 * A URL rather than server actions, for the reason `/onboarding/submit` is one:
 * a server action is addressed by an id that changes with every deploy, and a
 * step left open across one would post to an action that no longer exists.
 *
 * Each step is checked against the order here as well as on the page. The page
 * only offers the steps somebody has reached, but a form can be posted by
 * anyone who can reach the route, and "launch" is the one that reaches
 * strangers.
 *
 * Who may write what follows the database, not the screen. A person's own
 * profile row is theirs, so the confirmation stamps live there; the workspace
 * row is an owner's or admin's, so what lives there (the stash) is written by
 * them and never made a condition of anybody else finishing a step.
 */

/** Which wizard step each posted action belongs to. */
const ACTION_STEP: Record<string, WizardStepKey> = {
  "linkedin-connect": "linkedin",
  hours: "hours",
  voice: "voice",
  cta: "cta",
  approve: "strategy",
  rewrite: "strategy",
  search: "prospects",
  launch: "launch",
};

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const action = String(form.get("action") ?? "");
  const step = ACTION_STEP[action];
  if (!step) return seeOther("/onboarding");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return seeOther("/login");

  const wizard = await readWizard(supabase, user.id);
  const workspaceId = wizard.workspaceId;
  if (!workspaceId) return seeOther("/onboarding");
  // Nothing is decided from facts that could not be read.
  if (wizard.unreadable) return seeOther(`/onboarding?step=${step}&error=unreadable`);
  const current = currentStep(wizard.facts);
  if (!current) return seeOther("/app");
  if (stepIndex(step) > stepIndex(current)) return seeOther("/onboarding");

  const again = (code: string) => seeOther(`/onboarding?step=${step}&error=${code}`);
  // The roles the database lets write the workspace row (`is_workspace_admin`).
  const isAdmin = (AUTONOMY_ROLES as readonly string[]).includes(wizard.role ?? "");

  /** Workspace stash keys, merged; only the workspace's admins may write that row. */
  const saveStash = async (patch: Record<string, unknown>): Promise<boolean> => {
    if (!isAdmin) return false;
    const { data: row } = await supabase.from("workspaces").select("onboarding").eq("id", workspaceId).maybeSingle();
    const { data: saved, error } = await supabase
      .from("workspaces")
      .update({ onboarding: mergeStash(row?.onboarding, patch) as never })
      .eq("id", workspaceId)
      .select("id");
    if (error) console.error(`[onboarding] save ${action}: ${error.message}`);
    return Boolean(saved?.length);
  };

  /**
   * This person's stamp for a step, on their own profile row, merged with what
   * is there now rather than with what was read at the start of the request.
   * Checked by the rows it changed: a stamp that did not land is a step shown
   * again for ever.
   */
  const confirm = async (key: "hours" | "voice" | "cta", extra: { ctaChoice?: StashedCta } = {}): Promise<boolean> => {
    const { data: me } = await supabase.from("profiles").select("setup_confirmed").eq("id", user.id).maybeSingle();
    const stamped = stampConfirmation(me?.setup_confirmed, workspaceId, key, new Date().toISOString(), extra);
    const { data: saved, error } = await supabase
      .from("profiles")
      .update({ setup_confirmed: stamped as never })
      .eq("id", user.id)
      .select("id");
    if (error) console.error(`[onboarding] confirm ${key}: ${error.message}`);
    return Boolean(saved?.length);
  };

  switch (action) {
    case "linkedin-connect": {
      const flags = planFlags(form.get("linkedinPlan"));
      if (!flags) return again("plan-missing");
      // On the workspace for the row the worker creates at Connect, and on the
      // row itself once it exists. The nightly plan check corrects either
      // from what LinkedIn reports (rule 62).
      await saveStash({ hasSalesNavigator: flags.has_sales_navigator, hasPremium: flags.has_premium });
      if (wizard.account) {
        await supabase.from("linkedin_accounts").update(flags).eq("id", wizard.account.id);
      }
      // Already connected: the plan was the only thing to save.
      if (wizard.facts.linkedInActive) return seeOther("/onboarding");

      const link = await callWorker<{ url?: string }>("/auth/linkedin/link", { workspaceId, userId: user.id });
      if (!link.ok || !link.data?.url) return again("linkedin-link");
      // The worker has just created this person's row from the workspace's
      // stored answer, which may be somebody else's, or none for a role that
      // cannot write it. Their own answer goes onto their own row.
      await supabase
        .from("linkedin_accounts")
        .update(flags)
        .eq("workspace_id", workspaceId)
        .eq("user_id", user.id);
      // The provider's own hosted page, so an absolute address: this is the
      // one redirect here that is meant to leave the product.
      return new Response(null, { status: 303, headers: { Location: link.data.url } });
    }

    case "hours": {
      const timezone = String(form.get("timezone") ?? "").trim();
      const start = Number(form.get("start"));
      const end = Number(form.get("end"));
      const days = [1, 2, 3, 4, 5, 6, 0].filter((day) => form.get(`day-${day}`) === "on");
      // Only a zone the runtime can evaluate: an unreadable one falls back to
      // UTC inside the limiter and says nothing.
      if (!timezone || !isValidTimezone(timezone)) return again("timezone");
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > 24 || start >= end) return again("hours");
      if (days.length === 0) return again("days");
      const workingHours = { start, end, days };

      const { data: tz } = await supabase.from("profiles").update({ timezone }).eq("id", user.id).select("id");
      if (!tz?.length) return again("save-failed");
      // The account row is what the limiter reads; LinkedIn is connected by
      // the time this step is reached, so it exists.
      if (wizard.account) {
        const { data: hours } = await supabase
          .from("linkedin_accounts")
          .update({ working_hours: workingHours as never })
          .eq("id", wizard.account.id)
          .select("id");
        if (!hours?.length) return again("save-failed");
      }
      await saveStash({ workingHours });

      // When prospects may book a call: the row the slot finder reads, so the
      // times offered are the ones given here (rule 6). Notice, buffer and the
      // daily limit keep what is saved, or the table's defaults.
      const { data: existing } = await supabase
        .from("availability")
        .select("min_notice_hours, buffer_minutes, max_per_day")
        .eq("workspace_id", workspaceId)
        .eq("user_id", user.id)
        .maybeSingle();
      const meetings = {
        timezone,
        start: Number(form.get("meetStart")),
        end: Number(form.get("meetEnd")),
        days: [1, 2, 3, 4, 5, 6, 0].filter((day) => form.get(`meetDay-${day}`) === "on"),
        meetingMinutes: Number(form.get("meetingMinutes")),
        minNoticeHours: existing?.min_notice_hours ?? AVAILABILITY_DEFAULTS.minNoticeHours,
        bufferMinutes: existing?.buffer_minutes ?? AVAILABILITY_DEFAULTS.bufferMinutes,
        maxPerDay: existing?.max_per_day ?? AVAILABILITY_DEFAULTS.maxPerDay,
        location: String(form.get("location") ?? "").trim().slice(0, 280) || null,
      };
      if (availabilityProblem(meetings)) return again(meetings.days.length === 0 ? "meet-days" : "meet-hours");
      if (!(await saveAvailability(supabase, workspaceId, user.id, meetings))) return again("save-failed");

      if (!(await confirm("hours"))) return again("save-failed");
      return seeOther("/onboarding");
    }

    case "voice": {
      const fullName = String(form.get("fullName") ?? "").trim();
      const bio = String(form.get("bio") ?? "").trim();
      // What a prospect sees the invitation come from.
      if (!fullName) return again("name");
      const { data: before } = await supabase.from("profiles").select("full_name, bio").eq("id", user.id).maybeSingle();
      const { data: saved } = await supabase
        .from("profiles")
        .update({ full_name: fullName.slice(0, 120), bio: bio || null })
        .eq("id", user.id)
        .select("id");
      if (!saved?.length) return again("save-failed");
      // And onto the agent, which is what a prospect's messages are written
      // from. Sage seeded it at the first step, before these were typed.
      const carried = await carryVoiceToAgent(
        supabase,
        workspaceId,
        { fullName: before?.full_name ?? null, bio: before?.bio ?? null },
        { fullName: fullName.slice(0, 120), bio: bio || null },
      );
      if (!carried) return again("save-failed");
      if (!(await confirm("voice"))) return again("save-failed");
      return seeOther("/onboarding");
    }

    case "cta": {
      const kind = String(form.get("ctaKind") ?? "");
      if (kind !== "meeting" && kind !== "link" && kind !== "reply") return again("cta-kind");
      const label = String(form.get("ctaLabel") ?? "").trim().slice(0, 80) || null;
      let url: string | null = null;
      if (kind === "link") {
        const checked = checkCtaUrl(withScheme(String(form.get("ctaUrl") ?? "")));
        if (!checked.ok) return again("cta-url");
        url = checked.url;
      }
      if (kind === "meeting") {
        // The rep's own scheduling link is optional (rule 31): without one,
        // the agent offers times from this product's own booking page.
        const raw = String(form.get("bookingUrl") ?? "").trim();
        if (raw) {
          const checked = checkCtaUrl(withScheme(raw));
          if (!checked.ok) return again("booking-url");
          await supabase.from("profiles").update({ booking_url: checked.url }).eq("id", user.id);
        }
      }

      /*
       * Onto every strategy that has no campaign yet, so the search writes its
       * copy toward this ask (rule 29). A strategy with a campaign keeps what it
       * had: that campaign's messages were written toward the old ask, and
       * pointing them at a new one would leave them arguing for something else.
       * The approval step applies it again, for strategies Sage writes later.
       */
      const [{ data: profiles }, { data: used }] = await Promise.all([
        supabase.from("customer_profiles").select("id").eq("workspace_id", workspaceId),
        supabase.from("campaigns").select("customer_profile_id").eq("workspace_id", workspaceId),
      ]);
      const taken = new Set((used ?? []).map((c) => c.customer_profile_id).filter(Boolean));
      const open = (profiles ?? []).map((p) => p.id).filter((id) => !taken.has(id));
      const choice: StashedCta = { kind, label, url };
      // An entry on Calls to action as well as the strategies' own columns, so
      // the page that manages them shows the one just chosen.
      const ctaId = await ensureCta(supabase, workspaceId, user.id, choice);
      if (!ctaId) return again("save-failed");
      if (open.length) {
        const { error } = await supabase
          .from("customer_profiles")
          .update({ cta_kind: kind, cta_label: label, cta_url: url, cta_id: ctaId })
          .eq("workspace_id", workspaceId)
          .in("id", open);
        if (error) return again("save-failed");
      }
      await saveStash({ cta: choice });
      if (!(await confirm("cta", { ctaChoice: choice }))) return again("save-failed");
      return seeOther("/onboarding");
    }

    case "approve": {
      const profileId = String(form.get("profileId") ?? "");
      // The ask this person confirmed on the CTA step, onto a strategy Sage may
      // have written after it — their own choice first, since the workspace's
      // copy is only written by its admins.
      const cta = wizard.confirmations.ctaChoice ?? wizard.stash.cta;
      const ctaId = cta ? await ensureCta(supabase, workspaceId, user.id, cta) : null;
      const extra = cta
        ? { cta_kind: cta.kind, cta_label: cta.label, cta_url: cta.url, ...(ctaId ? { cta_id: ctaId } : {}) }
        : {};

      const approved = await approveStrategy(supabase, workspaceId, profileId, extra);
      if (!approved.ok) return again("approve-failed");
      if (approved.hasCampaign) return seeOther("/onboarding");

      const started = await queueSearch(workspaceId, user.id, supabase, profileId);
      // Approving still counts when the search could not start; the next step
      // says so and offers to start it.
      return seeOther(started.ok ? "/onboarding" : "/onboarding?step=prospects&error=search-not-started");
    }

    case "rewrite": {
      // None of Sage's suggestions fit, so the owner says who they actually
      // sell to and Sage writes new ones from that. The rejected ones are set
      // aside by the worker once the new ones are stored, never before.
      const guidance = String(form.get("guidance") ?? "").trim();
      if (guidance.length < 3) return again("rewrite-empty");
      const queued = await callWorker("/jobs/strategy", {
        workspaceId,
        userId: user.id,
        expand: true,
        guidance: guidance.slice(0, 600),
      });
      return queued.ok ? seeOther("/onboarding?step=strategy") : again("rewrite-failed");
    }

    case "search": {
      const profileId = String(form.get("profileId") ?? "");
      const { data: profile } = await supabase
        .from("customer_profiles")
        .select("id")
        .eq("id", profileId)
        .eq("workspace_id", workspaceId)
        .not("approved_at", "is", null)
        .maybeSingle();
      if (!profile) return again("search-not-started");
      const started = await queueSearch(workspaceId, user.id, supabase, profileId);
      return started.ok ? seeOther("/onboarding") : again("search-not-started");
    }

    case "launch": {
      const campaignId = String(form.get("campaignId") ?? "");
      // Only a draft of this workspace: the first launch, never a paused or
      // archived campaign named in a hand-made form.
      const { data: draft } = await supabase
        .from("campaigns")
        .select("id")
        .eq("id", campaignId)
        .eq("workspace_id", workspaceId)
        .eq("status", "draft")
        .maybeSingle();
      if (!draft) return again("launch-missing");
      // Who answers replies is asked here, at the moment it starts to matter,
      // and set before the launch so the first reply is handled as chosen.
      const handling = form.get("handling");
      if (handling !== "check" && handling !== "nora") return again("handling");
      if (!(await setReplyHandling(supabase, workspaceId, campaignId, handling, isAdmin))) return again("save-failed");
      // The opener and offer shown on this screen, approved as shown: matched
      // on the words posted, so a line edited since the page loaded is never
      // approved unread (rule 40).
      const tables = form.getAll("lineTable").map(String);
      const ids = form.getAll("lineId").map(String);
      const bodies = form.getAll("lineBody").map(String);
      for (let i = 0; i < ids.length; i += 1) {
        const table = tables[i];
        if (table !== "hooks" && table !== "pitches") continue;
        const { data: approvedNow } = await supabase
          .from(table)
          .update({ approved_at: new Date().toISOString(), approved_by: user.id })
          .eq("id", ids[i]!)
          .eq("workspace_id", workspaceId)
          .eq("body", bodies[i] ?? "")
          .is("approved_at", null)
          .select("id");
        if (approvedNow?.length) continue;
        // Nothing matched: approved already is fine, changed since is not.
        const { data: line } = await supabase
          .from(table)
          .select("approved_at")
          .eq("id", ids[i]!)
          .eq("workspace_id", workspaceId)
          .maybeSingle();
        if (!line?.approved_at) return again("copy-changed");
      }
      const outcome = await launch(campaignId, { workspaceId, userId: user.id });
      switch (outcome.status) {
        case "launched":
          // Setup is finished: the app opens, on the tour of what is in it.
          return seeOther(outcome.kicked ? "/app?tour=1&launched=1" : "/app?tour=1&launched=late");
        case "blocked":
          return again("launch-blocked");
        case "missing":
          return again("launch-missing");
        case "failed":
          return again("launch-failed");
      }
    }
  }
  return seeOther("/onboarding");
}

/** "cal.com/sam" as most people type it, with the scheme the check requires. */
function withScheme(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed || /^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}
