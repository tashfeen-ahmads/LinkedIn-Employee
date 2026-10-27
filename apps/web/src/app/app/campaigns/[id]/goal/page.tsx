import Link from "next/link";
import { CLICKS_ARE_INVISIBLE, CTA_DEFINITIONS } from "@le/shared";
import { Section } from "@/components/page";
import { PageNotice, type NoticeParams } from "@/components/page-notice";
import { SubmitButton } from "@/components/submit-button";
import { CampaignGoalCards } from "@/components/campaign-goal-cards";
import { GOAL_LABELS } from "@/app/app/campaigns/[id]/goal-labels";
import { loadCampaign } from "../data";
import { setCampaignCta } from "../actions";

/**
 * What the campaign asks for and where its link sends people (rules 29, 31
 * and 36). The goal decides the copy, what the agent pursues in a reply and
 * what the funnel counts, so it is a section of its own rather than a card
 * between the funnel and the copy.
 */
export default async function CampaignGoalPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: NoticeParams;
}) {
  const notice = await searchParams;
  const { id } = await params;
  const { campaign, cta, ctaMissing, bookingUrl, ctaLibrary } = await loadCampaign(id);

  // What a win is, in a sentence somebody who has never heard of a funnel
  // can read. Same meaning as `CTA_DEFINITIONS[kind].conversion`, which the
  // results count by; that phrase reads "Judged on …" and makes no sentence.
  const win = {
    meeting: "It counts as a win when a meeting lands on your calendar.",
    link: "It counts as a win when the link is sent, and again if they reply warmly.",
    reply: "It counts as a win when they reply warmly.",
  }[cta.kind];

  return (
    <>
      <PageNotice error={notice.error} notice={notice.notice} />

      <Section framed id="asks" title="What this campaign asks for">
        <p>
          <strong>{cta.label || CTA_DEFINITIONS[cta.kind].label}</strong>
        </p>
        <p className="small muted">
          {cta.kind === "meeting"
            ? "Nora works towards a call with each person. "
            : cta.kind === "link"
              ? "Nora works towards sending each person a link. "
              : "Nora works towards a reply, nothing more. "}
          {win}
          {cta.kind === "link" ? ` ${CLICKS_ARE_INVISIBLE}` : ""}
        </p>
        {cta.url ? (
          <p className="small muted">
            The link goes to{" "}
            <a href={cta.url} target="_blank" rel="noreferrer noopener">
              {cta.url}
            </a>
            .
          </p>
        ) : cta.kind === "meeting" ? (
          // The same choice the worker makes when it fills in the link.
          <p className="small muted">
            {bookingUrl ? (
              <>
                People get your own scheduling link,{" "}
                <a href={bookingUrl} target="_blank" rel="noreferrer noopener">
                  {bookingUrl}
                </a>
                . You can change it on <Link href="/app/profile/meetings">your profile</Link>.
              </>
            ) : (
              <>
                People get a link to your booking page. To send your own scheduling link instead,
                add it on <Link href="/app/profile/meetings">your profile</Link>.
              </>
            )}
          </p>
        ) : ctaMissing ? (
          <div className="notice warning" role="note">
            <p className="small">
              Some of this campaign&rsquo;s messages are written to include a link, and it has no
              link yet, so those messages wait. Pick a goal with a link below.
            </p>
          </div>
        ) : null}
      </Section>

      {/*
        The picker. Without it the library was a page that did nothing:
        destinations could be named and no campaign could use one.
      */}
      <Section
        id="change"
        title="Change the goal"
        description="Every message fills in the link from here, so a new link reaches every message at once. Changing the goal itself does not rewrite the words, so read Follow-ups again after."
      >
        <form action={setCampaignCta} className="stack">
          <input type="hidden" name="campaignId" value={campaign.id} />
          <CampaignGoalCards
            goalLabels={GOAL_LABELS}
            library={ctaLibrary}
            selected={campaign.cta_id ?? ""}
            meetingSends={bookingUrl ? "Asks them to book a call through your scheduling link" : "Asks them to book a call on your booking page"}
            ownDestination={
              campaign.cta_id ? null : { kind: campaign.cta_kind, label: campaign.cta_label, url: campaign.cta_url }
            }
          >
            <div className="cluster">
              <SubmitButton className="btn" pendingLabel="Saving…">
                Use this goal
              </SubmitButton>
              <Link className="btn ghost" href="/app/cta">
                Edit saved links and asks
              </Link>
            </div>
          </CampaignGoalCards>
        </form>
      </Section>
    </>
  );
}
