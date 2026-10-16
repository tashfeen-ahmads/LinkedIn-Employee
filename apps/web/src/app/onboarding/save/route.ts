import type { NextRequest } from "next/server";
import { checkCtaUrl, isValidTimezone } from "@le/shared";
import { createClient } from "@/lib/supabase-server";
import { seeOther } from "@/lib/see-other";
import { callWorker } from "@/lib/worker";
import { mergeStash, withConfirmation, type StepConfirmations } from "@/lib/onboarding-stash";
import { readWizard } from "@/lib/wizard-state";
import { currentStep, stepIndex, type WizardStepKey } from "@/lib/wizard";
import { queueSearch } from "@/lib/search";
import { launch } from "@/lib/launch";

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
 */

/** Which wizard step each posted action belongs to. */
const ACTION_STEP: Record<string, WizardStepKey> = {
  "linkedin-connect": "linkedin",
  hours: "hours",
  voice: "voice",
  cta: "cta",
  approve: "strategy",
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
  const current = currentStep(wizard.facts);
  if (!current) return seeOther("/app");
  if (stepIndex(step) > stepIndex(current)) return seeOther("/onboarding");

  const again = (code: string) => seeOther(`/onboarding?step=${step}&error=${code}`);

  /** Writes stash keys, keeping every other, and stamps this step confirmed when asked to. */
  const saveStash = async (patch: Record<string, unknown>, confirm?: keyof StepConfirmations): Promise<boolean> => {
    const { data: row } = await supabase.from("workspaces").select("onboarding").eq("id", workspaceId).maybeSingle();
    const next = confirm
      ? { ...patch, confirmed: withConfirmation(wizard.stash.confirmed, user.id, confirm, new Date().toISOString()) }
      : patch;
    const { error } = await supabase
      .from("workspaces")
      .update({ onboarding: mergeStash(row?.onboarding, next) as never })
      .eq("id", workspaceId);
    if (error) console.error(`[onboarding] save ${action}: ${error.message}`);
    return !error;
  };

  switch (action) {
    case "linkedin-connect": {
      const plan = String(form.get("linkedinPlan") ?? "");
      if (plan !== "basic" && plan !== "premium" && plan !== "sales_navigator") return again("plan-missing");
      const hasSalesNavigator = plan === "sales_navigator";
      const hasPremium = plan !== "basic";
      if (!(await saveStash({ hasSalesNavigator, hasPremium }))) return again("save-failed");
      if (wizard.account) {
        await supabase
          .from("linkedin_accounts")
          .update({ has_sales_navigator: hasSalesNavigator, has_premium: hasPremium })
          .eq("id", wizard.account.id);
      }
      // Already connected: the plan was the only thing to save.
      if (wizard.facts.linkedInActive) return seeOther("/onboarding");

      const link = await callWorker<{ url?: string }>("/auth/linkedin/link", { workspaceId, userId: user.id });
      if (!link.ok || !link.data?.url) return again("linkedin-link");
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

      await supabase.from("profiles").update({ timezone }).eq("id", user.id);
      if (wizard.account) {
        await supabase.from("linkedin_accounts").update({ working_hours: workingHours as never }).eq("id", wizard.account.id);
      }
      if (!(await saveStash({ workingHours }, "hours"))) return again("save-failed");
      return seeOther("/onboarding");
    }

    case "voice": {
      const fullName = String(form.get("fullName") ?? "").trim();
      const bio = String(form.get("bio") ?? "").trim();
      const autonomy = form.get("autonomy") === "autonomous" ? "autonomous" : "supervised";
      // What a prospect sees the invitation come from.
      if (!fullName) return again("name");
      await supabase
        .from("profiles")
        .update({ full_name: fullName.slice(0, 120), bio: bio || null })
        .eq("id", user.id);
      if (!(await saveStash({ autonomy }, "voice"))) return again("save-failed");
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
      if (open.length) {
        await supabase
          .from("customer_profiles")
          .update({ cta_kind: kind, cta_label: label, cta_url: url })
          .eq("workspace_id", workspaceId)
          .in("id", open);
      }
      if (!(await saveStash({ cta: { kind, label, url } }, "cta"))) return again("save-failed");
      return seeOther("/onboarding");
    }

    case "approve": {
      const profileId = String(form.get("profileId") ?? "");
      const { data: profile } = await supabase
        .from("customer_profiles")
        .select("id")
        .eq("id", profileId)
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      if (!profile) return again("approve-failed");

      const { data: hasCampaign } = await supabase
        .from("campaigns")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("customer_profile_id", profileId)
        .limit(1);
      // The ask chosen on the CTA step, onto a strategy Sage may have written
      // after it was chosen — unless this strategy already has a campaign.
      const cta = wizard.stash.cta;
      const ctaPatch = cta && !hasCampaign?.length ? { cta_kind: cta.kind, cta_label: cta.label, cta_url: cta.url } : {};

      // The approval is the decision (rule 9), and it is checked: a write that
      // matched nothing must not be followed by a search.
      const { data: approved, error } = await supabase
        .from("customer_profiles")
        .update({ approved_at: new Date().toISOString(), do_not_pursue: false, ...ctaPatch })
        .eq("id", profileId)
        .eq("workspace_id", workspaceId)
        .select("id");
      if (error || !approved?.length) return again("approve-failed");
      if (hasCampaign?.length) return seeOther("/onboarding");

      const started = await queueSearch(workspaceId, user.id, supabase, profileId);
      // Approving still counts when the search could not start; the next step
      // says so and offers to start it.
      return seeOther(started.ok ? "/onboarding" : "/onboarding?step=prospects&error=search-not-started");
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
