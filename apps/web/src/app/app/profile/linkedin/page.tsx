import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/workspace";
import { planFlags } from "@/lib/approve";
import { createClient } from "@/lib/supabase-server";
import { callWorker, errorQuery, noticeQuery } from "@/lib/worker";
import { FREE_NOTES_PER_MONTH, LINKEDIN_LIMITS, linkedInConnectError } from "@le/shared";
import { PageNotice } from "@/components/page-notice";
import { Section } from "@/components/page";
import { AllowanceMeter } from "@/components/charts";
import { countersForToday } from "@/lib/account-day";
import { notesLeftThisMonth } from "@/lib/invite-notes";
import { mergeStash, readOnboardingStash, stashedAccountAnswers } from "@/lib/onboarding-stash";
import { dailyInviteCap, planLabel, planOf, type AccountRecord, type LinkedInPlan } from "@le/linkedin";
import { cannotSend, describeRepair, type RefreshResult, type RepairNotice } from "../../team/repair";
import { linkedInState } from "../linkedin-state";
import { SalesNavigatorSection } from "../sales-navigator-section";
import { CheckLinkedInButton, ConnectLinkedInButton } from "../linkedin-connect";
import { PROFILE_SECTIONS } from "../sections";

const HERE = PROFILE_SECTIONS.linkedin;

/**
 * The LinkedIn plan, on its own: it decides whether a search finds anybody and
 * whether invitations carry a note, so it is one press rather than a field in
 * another form. The caller's own account row, or the stash before Connect.
 */
async function setLinkedInPlan(formData: FormData) {
  "use server";
  const session = await requireSession();
  const supabase = await createClient();
  const patch = planFlags(formData.get("linkedinPlan"));
  if (!patch) redirect(errorQuery(HERE, "Choose one of the three plans."));
  const { data: updated } = await supabase
    .from("linkedin_accounts")
    .update(patch as never)
    .eq("workspace_id", session.workspaceId)
    .eq("user_id", session.userId)
    .select("id");
  if (!updated?.length) {
    const { data: wsStash } = await supabase
      .from("workspaces")
      .select("onboarding")
      .eq("id", session.workspaceId)
      .maybeSingle();
    const { data: stashed } = await supabase
      .from("workspaces")
      .update({ onboarding: mergeStash(wsStash?.onboarding, stashedAccountAnswers(patch)) as never })
      .eq("id", session.workspaceId)
      .select("id");
    if (!stashed?.length) {
      redirect(errorQuery(HERE, "Connect your LinkedIn account first, then choose its plan."));
    }
  }
  revalidatePath("/app", "layout");
  redirect(noticeQuery(HERE, "Saved. New searches and invitations follow this plan."));
}

export default async function LinkedInSectionPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string; connected?: string }>;
}) {
  const params = await searchParams;
  const session = await requireSession();
  const supabase = await createClient();

  const { data: current } = await supabase
    .from("linkedin_accounts")
    .select("status")
    .eq("workspace_id", session.workspaceId)
    .eq("user_id", session.userId)
    .maybeSingle();

  /*
   * Coming back from the provider's hosted login, and on any arrival while this
   * rep's account is not working.
   *
   * The connection is finished at the provider by the time the redirect fires,
   * but the row here is bound by a webhook — and a webhook that does not arrive
   * left the rep looking at "sending is paused" one second after being told
   * they had succeeded. Any account id in the URL is deliberately ignored:
   * binding whatever id a query string names would let anyone attach somebody
   * else's provider account to their own row. This asks the provider instead.
   *
   * Bounded on purpose: it only runs while the account is already broken, so a
   * working deployment makes no provider call here at all. And what it learned
   * is rendered, not discarded.
   */
  let repair: RepairNotice | null = null;
  if (params.connected === "1" || (current && current.status !== "active")) {
    const result = await callWorker<RefreshResult>("/jobs/linkedin-refresh", {
      workspaceId: session.workspaceId,
      userId: session.userId,
    });
    repair = describeRepair(result);
  }

  const [{ data: account }, { data: me }, { data: ws }] = await Promise.all([
    supabase
      .from("linkedin_accounts")
      .select(
        "user_id, status, status_detail, provider_account_id, display_name, invites_today, invites_this_week, invites_by_day, messages_today, profile_views_today, counters_reset_on, first_action_at, has_sales_navigator, has_premium, plan_detected, plan_checked_at, notes_exhausted_month, id, working_hours",
      )
      .eq("workspace_id", session.workspaceId)
      .eq("user_id", session.userId)
      .maybeSingle(),
    supabase.from("profiles").select("timezone").eq("id", session.userId).maybeSingle(),
    supabase.from("workspaces").select("onboarding").eq("id", session.workspaceId).maybeSingle(),
  ]);

  // A row with no provider account behind it is not connected, whatever its
  // status says (`linkedInState`). Treating it as connected showed usage bars
  // for an account that does not exist, and took away the only button that
  // could fix it.
  const found = account ?? undefined;
  const linkedIn = linkedInState(found);
  const mine = linkedIn.kind === "attached" ? found : undefined;
  const timezone = me?.timezone ?? "UTC";
  /*
   * The allowance exactly as the overview draws it and the worker enforces it:
   * today's invitations against the ramp's day (rule 3), never against the end
   * of the ramp, with the counters rolled over to the rep's today first or each
   * morning opens on yesterday's sends.
   */
  const allowanceNow = new Date();
  const counters = mine ? countersForToday(mine as unknown as AccountRecord, timezone, allowanceNow) : null;
  const inviteCap = mine
    ? dailyInviteCap(mine.first_action_at ? new Date(mine.first_action_at) : null, allowanceNow)
    : LINKEDIN_LIMITS.invitesPerDayStart;
  const awaitingProvider = linkedIn.kind === "unfinished";
  const needsReconnect = linkedIn.kind === "attached" && (cannotSend(found?.status) || found?.status === "connecting");
  const stash = readOnboardingStash(ws?.onboarding);
  const plan = found
    ? planOf(found)
    : planOf({ has_sales_navigator: stash.hasSalesNavigator, has_premium: stash.hasPremium });

  /*
   * What LinkedIn itself reports, asked at most once a day on arrival so a plan
   * bought or cancelled shows up without anybody pressing anything. The answer
   * is read from the row the worker writes, never from the request.
   */
  let detected = (mine?.plan_detected ?? null) as LinkedInPlan | null;
  if (mine && mine.status === "active") {
    const checked = mine.plan_checked_at ? Date.parse(mine.plan_checked_at) : 0;
    if (!Number.isFinite(checked) || Date.now() - checked > 86_400_000) {
      const asked = await callWorker<{ plan: LinkedInPlan | null }>("/jobs/linkedin-plan", {
        workspaceId: session.workspaceId,
        userId: session.userId,
      });
      if (asked.ok && asked.data?.plan) detected = asked.data.plan;
    }
  }
  const notesLeft = mine
    ? await notesLeftThisMonth(supabase, mine, timezone)
    : plan === "basic"
      ? FREE_NOTES_PER_MONTH
      : null;

  return (
    <>
      {/* A LinkedIn sign-in comes back with a code, never a sentence; its words
          are the same ones the onboarding LinkedIn step shows. */}
      <PageNotice error={linkedInConnectError(params.error) ?? params.error} notice={params.notice} />
      {repair ? (
        <div className={`notice ${repair.tone}`} role="status">
          <p>
            <strong>{repair.title}</strong> {repair.body}
          </p>
          {repair.fix ? <p className="small">{repair.fix}</p> : null}
        </div>
      ) : null}

      <Section id="linkedin" title="LinkedIn account" description="The account every invitation and message goes out from.">
        <div className="card profile-card">
          {mine ? (
            <>
              <div className="profile-status-row">
                <span className={`pill ${needsReconnect ? "warning" : "positive"}`}>{linkedIn.label}</span>
                <p>
                  <strong>{mine.display_name ?? "Your LinkedIn account"}</strong>{" "}
                  <span className="muted">· {planLabel(plan)}</span>
                </p>
              </div>

              {needsReconnect ? (
                <div className="notice danger">
                  <p>
                    <strong>This account cannot send.</strong> {mine.status_detail ?? "It needs to be connected again."}
                  </p>
                  <p className="small">
                    Use the button below rather than signing in somewhere else: it is what attaches the account to
                    you here.
                  </p>
                </div>
              ) : (
                /* Hidden while the account cannot send. Bars reading 0 of 35
                   next to "needs reconnecting" describe an allowance that does
                   not exist, and read as a working account to anyone skimming.
                   The same meter the overview draws, against its cap (rule 51). */
                <div className="profile-meters">
                  <AllowanceMeter label="Invitations today" used={counters?.invites_today ?? 0} cap={inviteCap} />
                  <AllowanceMeter label="Messages today" used={counters?.messages_today ?? 0} cap={LINKEDIN_LIMITS.messagesPerDay} />
                  <AllowanceMeter
                    label="Profile views today"
                    used={counters?.profile_views_today ?? 0}
                    cap={LINKEDIN_LIMITS.profileViewsPerDay}
                  />
                  <AllowanceMeter
                    label="Invitations, last 7 days"
                    used={counters?.invites_this_week ?? 0}
                    cap={LINKEDIN_LIMITS.invitesPerWeek}
                  />
                </div>
              )}

              {/* Connected is a claim this page makes, not one it has checked:
                  the row keeps whatever provider id it was bound with. Check is
                  always offered, and so is Reconnect — a rep who changed their
                  LinkedIn password has no other way back to the sign-in page
                  while this one reads as working. */}
              <div className="profile-form-foot">
                <p className="small muted">Checking is worth doing if campaigns are not finding anyone.</p>
                <CheckLinkedInButton />
                <ConnectLinkedInButton secondary={!needsReconnect}>
                  {needsReconnect ? "Connect LinkedIn again" : "Reconnect LinkedIn"}
                </ConnectLinkedInButton>
              </div>
            </>
          ) : (
            <>
              {/* A started-but-unfinished connection is told to finish, not to
                  wait: somebody who finished signing in is connected on arrival,
                  so a row still sitting here is almost always somebody who
                  closed the LinkedIn window. The action leads, and the rarer
                  case keeps its button beside it. */}
              {linkedIn.kind === "failed" ? (
                <div className={linkedIn.released ? "notice warning" : "notice danger"}>
                  <p>
                    <strong>{linkedIn.released ? "Please reconnect your account." : "Not connected."}</strong>{" "}
                    {linkedIn.detail}
                  </p>
                </div>
              ) : (
                <p className="muted">
                  {awaitingProvider
                    ? "Not connected: the LinkedIn sign-in was not finished. Press Connect LinkedIn to try again. It takes about a minute, and you sign in on a secure hosted page, so we never see your password."
                    : "Not connected yet. You sign in to LinkedIn on a secure hosted page, so we never see your password."}
                </p>
              )}
              <div className="profile-form-foot">
                {awaitingProvider ? <CheckLinkedInButton>I already finished, check again</CheckLinkedInButton> : null}
                <ConnectLinkedInButton />
              </div>
            </>
          )}
        </div>
      </Section>

      <SalesNavigatorSection plan={plan} detected={detected} notesLeft={notesLeft} connected={Boolean(mine)} action={setLinkedInPlan} />
    </>
  );
}
