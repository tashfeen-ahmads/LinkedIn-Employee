import "server-only";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/workspace";
import { launch } from "@/lib/launch";
import { readWizard } from "@/lib/wizard-state";
import { createClient } from "@/lib/supabase-server";
import { errorQuery, noticeQuery } from "@/lib/worker";
import { sectionHref } from "./sections";

/**
 * Launches a campaign, or says exactly why it did not.
 *
 * The blockers are re-checked here and not only rendered as a disabled
 * button: a form can be submitted by anyone who can reach the route, and
 * launching is the action that reaches strangers. A refusal used to return
 * without a word, which from the other side of the glass is a Launch button
 * that does nothing.
 *
 * Not a server action itself: it takes a session, and a session is never
 * something a form may name. The campaign's own actions and the builder's
 * last step call it after reading the session themselves.
 */
export async function launchCampaign(
  campaignId: string,
  session: Awaited<ReturnType<typeof requireSession>>,
): Promise<never> {
  /*
   * The first launch belongs to the last step of setup (rule 65). The
   * campaign is open during setup so the person can read every name before
   * launching, and without this its own button was a way to finish setup with
   * the hours, voice and call to action never confirmed.
   */
  const supabase = await createClient();
  const wizard = await readWizard(supabase, session.userId);
  // A read that failed is not permission: onboarding says it could not load,
  // which is better than a first campaign going live past unconfirmed steps.
  if (wizard.unreadable) redirect("/onboarding");
  // The first launch, however this campaign was reached, is made on the
  // launch step, including by somebody who opened the app before launching.
  // That step asks who answers the replies and approves the opener and offer
  // the campaign sends; launching from here went live with neither, so a
  // follow-up built from {{pitch}} would wait on an approval nobody had been
  // asked for. A step still not done is where the launch step sends them
  // instead (`stepToShow`).
  if (!wizard.facts.hasLaunchedCampaign) {
    redirect(`/onboarding?step=launch&campaign=${encodeURIComponent(campaignId)}`);
  }

  const here = sectionHref(campaignId);
  const outcome = await launch(campaignId, session);
  revalidatePath(here, "layout");
  switch (outcome.status) {
    case "missing":
      redirect(errorQuery("/app/campaigns", "That campaign could not be found."));
    case "blocked":
      redirect(errorQuery(here, `Not launched yet. ${outcome.blockers.join(" ")}`));
    case "failed":
      redirect(errorQuery(here, "The campaign could not be launched. Nothing was sent. Try again."));
    case "launched":
      // Launched, and said so either way: the campaign really is running and
      // the loop picks it up when it is back. What must not happen is silence.
      redirect(
        outcome.kicked
          ? noticeQuery(
              here,
              "Launched. Invitations are paced a few minutes apart, so the first one takes a little while to appear on LinkedIn. This page says where it is up to.",
            )
          : errorQuery(
              here,
              "Launched, but sending has not started: the part of the product that sends did not answer. It picks this campaign up on its own when it is back. System check shows where it is up to.",
            ),
      );
  }
}
