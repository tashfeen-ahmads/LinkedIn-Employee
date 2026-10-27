import type { ReactNode } from "react";
import { Suspense } from "react";
import { requireSession } from "@/lib/workspace";
import { createClient } from "@/lib/supabase-server";
import { readWorkspaceEntitlement } from "@/lib/entitlement";
import { PageHeader } from "@/components/page";
import { SectionLayout, SectionNav, type SectionNavItem } from "@/components/section-nav";
import { ProfileLegacyAnchor } from "@/components/profile-legacy-anchor";
import { readOnboardingStash } from "@/lib/onboarding-stash";
import { label } from "@/lib/labels";
import { planOf, type LinkedInPlan } from "@le/linkedin";
import { linkedInState } from "./linkedin-state";
import { readAutonomy } from "./autonomy-state";
import { readWarmUp } from "./activity-state";
import { PROFILE_SECTIONS, hoursHint, readWorkingHours } from "./sections";

/**
 * The profile and the workspace's settings, one section at a time.
 *
 * This was one page a person scrolled from top to bottom: the business, the
 * rep's voice, a plan chooser, the LinkedIn account, the hours, the team table,
 * the invite form, the plan and the data export, each a block under the last.
 * Somebody who came to change their hours read past four of them first. Now
 * the menu says what is here and what state it is in, and the section they
 * pick is the only thing on screen.
 *
 * The menu carries each section's live state rather than a description of it
 * ("Connected · Free plan", "9–5 New York, Mon–Fri", "Nora answers on its
 * own"), so the answer to "how is this set up" is readable without opening
 * anything — which is what this screen is for most of the time.
 */
export default async function ProfileLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();
  const supabase = await createClient();

  const [{ data: ws }, { data: account }, { data: me }, { data: campaigns }, members, invited, entitlement] =
    await Promise.all([
      supabase.from("workspaces").select("name, onboarding, engage_posts").eq("id", session.workspaceId).maybeSingle(),
      supabase
        .from("linkedin_accounts")
        .select("status, status_detail, provider_account_id, working_hours, has_sales_navigator, has_premium")
        .eq("workspace_id", session.workspaceId)
        .eq("user_id", session.userId)
        .maybeSingle(),
      supabase.from("profiles").select("timezone, booking_url").eq("id", session.userId).maybeSingle(),
      supabase.from("campaigns").select("status, warm_up, rules").eq("workspace_id", session.workspaceId),
      supabase.from("memberships").select("id", { count: "exact", head: true }).eq("workspace_id", session.workspaceId),
      supabase
        .from("invitations")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", session.workspaceId)
        .is("accepted_at", null)
        .is("revoked_at", null),
      readWorkspaceEntitlement(supabase, session.workspaceId),
    ]);

  const stash = readOnboardingStash(ws?.onboarding);
  const linkedIn = linkedInState(account);
  const working = linkedIn.kind === "attached" && account?.status === "active";
  const plan = account
    ? planOf(account)
    : planOf({ has_sales_navigator: stash.hasSalesNavigator, has_premium: stash.hasPremium });
  const hours = account ? readWorkingHours(account.working_hours) : readWorkingHours(stash.workingHours);
  const autonomy = readAutonomy(ws?.onboarding, campaigns);
  const warm = readWarmUp(ws?.onboarding, campaigns);
  const engage = ws?.engage_posts !== false;
  const memberCount = members.count ?? 0;
  const invitedCount = invited.count ?? 0;

  const items: SectionNavItem[] = [
    { href: PROFILE_SECTIONS.you, title: "You", hint: `${session.fullName || "Add your name"} · ${label(session.role)}` },
    { href: PROFILE_SECTIONS.company, title: "Company", hint: ws?.name ?? session.workspaceName },
    {
      href: PROFILE_SECTIONS.linkedin,
      title: "LinkedIn account",
      hint: working
        ? `Connected · ${planWords(plan)}`
        : linkedIn.kind === "attached"
          ? "Needs reconnecting"
          : "Not connected",
      attention: !working,
    },
    { href: PROFILE_SECTIONS.hours, title: "Sending hours", hint: hoursHint(hours, me?.timezone) },
    {
      href: PROFILE_SECTIONS.replies,
      title: "Replies",
      hint: autonomy === "autonomous" ? "Nora answers on its own" : "Nora asks you when unsure",
    },
    {
      href: PROFILE_SECTIONS.meetings,
      title: "Meetings",
      hint: me?.booking_url ? `Your own link · ${hostOf(me.booking_url)}` : "Booked on Nora's calendar",
    },
    {
      href: PROFILE_SECTIONS.activity,
      title: "LinkedIn activity",
      hint: `Likes ${engage ? "on" : "off"} · Profile views ${warm.on ? "on" : "off"}`,
    },
    {
      href: PROFILE_SECTIONS.team,
      title: "Team",
      hint: `${memberCount} ${memberCount === 1 ? "member" : "members"}${invitedCount ? ` · ${invitedCount} invited` : ""}`,
    },
    {
      href: PROFILE_SECTIONS.billing,
      title: "Billing",
      hint: billingHint(entitlement),
      attention: entitlement ? !entitlement.canSend : false,
    },
  ];

  return (
    <>
      <PageHeader
        title="Profile & settings"
        lede="You, your company, your LinkedIn account and how Nora works for you, one section at a time."
      />
      {/* `SectionNav` reads the current path and query, and a client hook that
          reads the query has to sit inside a Suspense boundary. */}
      <Suspense fallback={null}>
        <ProfileLegacyAnchor />
      </Suspense>
      <SectionLayout
        nav={
          <Suspense fallback={null}>
            <SectionNav items={items} label="Profile sections" />
          </Suspense>
        }
      >
        {children}
      </SectionLayout>
    </>
  );
}

function planWords(plan: LinkedInPlan): string {
  return plan === "sales_navigator" ? "Sales Navigator" : plan === "premium" ? "Premium" : "Free plan";
}

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return "set";
  }
}

function billingHint(entitlement: Awaited<ReturnType<typeof readWorkspaceEntitlement>>): string {
  if (!entitlement) return "Plan and your data";
  switch (entitlement.reason) {
    case "free_plan":
      return "Free, for good";
    case "trial_active":
      return entitlement.trialDaysLeft === null
        ? "Free trial"
        : `Free trial · ${entitlement.trialDaysLeft} ${entitlement.trialDaysLeft === 1 ? "day" : "days"} left`;
    case "trial_unlimited":
      return "Free trial";
    case "active_subscription":
      return entitlement.tier === "autopilot" ? "Nora Autopilot" : "Nora Pro";
    case "payment_failed":
      return "Payment failed";
    default:
      return "Choose a plan";
  }
}
