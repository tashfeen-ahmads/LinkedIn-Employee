import Link from "next/link";
import {
  CTA_DEFINITIONS,
  EXTERNAL_BOOKINGS_UNCOUNTED,
  FREE_NOTES_PER_MONTH,
  LINKEDIN_LIMITS,
  stagesFor,
} from "@le/shared";
import { Section } from "@/components/page";
import { FunnelChart } from "@/components/charts";
import { NavIcon } from "@/components/icons";
import { PageNotice, type NoticeParams } from "@/components/page-notice";
import { formatDate, isoAttr, formatWhen } from "@/lib/format";
import { label } from "@/lib/labels";
import { SKIPPED_AT_SEND_REASONS } from "@/lib/campaign";
import { loadCampaign, nameOf, personOf } from "./data";
import { sectionHref } from "./sections";

/**
 * A campaign's overview: is it sending, how is it doing, and what happens
 * next. The rest of the campaign is a section each, one click away in the
 * menu beside this.
 *
 * The review screen's central claim is that a person reads the list and the
 * copy before a single message reaches a stranger. The list is on People and
 * the copy on Opener & offer and Follow-ups; this page says whether anything
 * stands between the campaign and its launch, and where to go to fix it.
 */
export default async function CampaignOverviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: NoticeParams;
}) {
  const notice = await searchParams;
  const { id } = await params;
  const {
    campaign,
    rows,
    counts,
    blockers,
    actionable,
    skipped,
    estimate,
    running,
    sendingPlan,
    notesLeft,
    operator,
    pacing,
    cta,
    ownBookingLink,
    steps,
    viewerTimezone,
  } = await loadCampaign(id);

  /*
   * The ten people touched most recently, for the glance table. Last touch is
   * the latest thing that happened to them on this campaign; somebody still
   * waiting to be invited has none, and sorts after everyone who has.
   */
  const recent = rows
    .map((row) => {
      const prospect = personOf(row);
      const touched =
        [row.replied_at, row.accepted_at, row.invited_at]
          .filter((at): at is string => Boolean(at))
          .sort()
          .pop() ?? null;
      return { row, prospect, touched };
    })
    .filter(
      (
        entry,
      ): entry is typeof entry & {
        prospect: NonNullable<typeof entry.prospect>;
      } => Boolean(entry.prospect),
    )
    .sort((a, b) => (b.touched ?? "").localeCompare(a.touched ?? ""))
    .slice(0, 10);

  return (
    <>
      <PageNotice error={notice.error} notice={notice.notice} />

      {/*
        What the sending loop is doing, first on the page and above every other
        notice. A launched campaign that has sent nothing looks identical
        whether it is pacing itself, waiting for working hours, or running
        against a worker that is not there — and a rep watching a launch reads
        the top of this page, not the bottom.

        The pacing strip: the limits colour, because what it reports is the
        guardrails at work. A danger reading keeps the danger notice, since a
        loop that is not sending is not the guardrails, it is a fault.
      */}
      {pacing ? (
        pacing.tone === "danger" ? (
          <div className="notice danger" role="status">
            <strong>{pacing.title}</strong>
            <p className="small">{pacing.body}</p>
            {operator && pacing.operator ? (
              <p className="tiny prewrap operator-note">
                <strong>Operator:</strong> {pacing.operator}
              </p>
            ) : null}
          </div>
        ) : (
          <div className="pacing-strip" role="status">
            <NavIcon name="clock" className="pacing-strip-icon" />
            <p className="small">
              <strong>{pacing.title}</strong> {pacing.body}
            </p>
          </div>
        )
      ) : null}

      {blockers.length > 0 && !running ? (
        <div className="notice danger">
          <strong>Not ready to launch</strong>
          <ul className="bullets">
            {blockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {sendingPlan === "basic" && campaign.status !== "archived" ? (
        <div className="notice" role="note">
          <strong>Sending from a free LinkedIn account</strong>
          <p className="small">
            {notesLeft
              ? `Invitations carry their note for ${notesLeft} more this month. `
              : "This month's invitation notes are used, so invitations go out without a note until the month turns. "}
            LinkedIn lets a free account add a note to only{" "}
            {FREE_NOTES_PER_MONTH} invitations a month, and invitations without
            one are still sent. Regular LinkedIn search applies job title,
            location and industry only.{" "}
            <Link href="/app/profile#sales-navigator">
              Check the LinkedIn plan
            </Link>
          </p>
        </div>
      ) : null}

      {/*
        The campaign at a glance: what happens next beside where people have
        got to, then who was touched most recently. The detail for each is its
        own section in the menu, where it is edited.
      */}
      <div className="campaign-overview-pair">
        <Section framed id="next" title="What happens next">
          <ul className="campaign-facts">
            <li>
              <strong className="nums">
                {actionable} still to invite of {rows.length}
              </strong>
              {estimate ? (
                <span className="small muted">
                  {" "}
                  About {estimate.days} working{" "}
                  {estimate.days === 1 ? "day" : "days"} at {estimate.perDay} a
                  day
                  {estimate.weeklyLimited
                    ? `, held to ${LINKEDIN_LIMITS.invitesPerWeek} a week`
                    : ""}
                  {estimate.shared > 0
                    ? `, longer while ${estimate.shared} other running ${estimate.shared === 1 ? "campaign shares" : "campaigns share"} this account`
                    : ""}
                  .
                </span>
              ) : null}
              {skipped > 0 ? (
                <span className="block tiny muted">
                  {skipped} will be skipped at send: {SKIPPED_AT_SEND_REASONS}.
                </span>
              ) : null}
            </li>
            <li>
              <span className="small">
                Each invitation carries a note written for that person, then{" "}
                {steps.length}{" "}
                {steps.length === 1 ? "message follows" : "messages follow"}{" "}
                once they accept.
              </span>{" "}
              <Link href={sectionHref(campaign.id, "follow-ups")}>
                <span className="small">See the messages</span>
              </Link>
            </li>
            <li>
              <span className="small">
                It asks for: <strong>{cta.label || CTA_DEFINITIONS[cta.kind].label}</strong>.
              </span>{" "}
              <Link href={sectionHref(campaign.id, "goal")}>
                <span className="small">Change it</span>
              </Link>
            </li>
            {campaign.status === "draft" ? (
              <li>
                <span className="small">
                  Nothing is sent until you press Launch. Read every name and
                  note on People first.
                </span>{" "}
                <Link href={sectionHref(campaign.id, "people")}>
                  <span className="small">Review the list</span>
                </Link>
              </li>
            ) : null}
          </ul>
        </Section>

        <Section framed id="funnel" title="Campaign funnel">
          {counts.invited === 0 ? (
            <p className="small muted">
              Nothing has been sent yet. Each stage fills in once invitations go
              out, and only the stages this campaign can reach are shown.
            </p>
          ) : (
            <FunnelChart
              steps={stagesFor(cta.kind).map((stage) => ({
                label: stage.label,
                value: counts[stage.key],
                hint: stage.label,
              }))}
            />
          )}
          {ownBookingLink ? <p className="tiny subtle">{EXTERNAL_BOOKINGS_UNCOUNTED}</p> : null}
        </Section>
      </div>

      <Section
        framed
        id="recent"
        title="Latest activity"
        action={
          rows.length > 0 ? (
            <Link
              className="btn ghost small"
              href={sectionHref(campaign.id, "people")}
            >
              Review all {rows.length}
            </Link>
          ) : null
        }
      >
        {recent.length === 0 ? (
          <p className="small muted">
            Nobody is on this list yet. Nothing is sent until you launch.
          </p>
        ) : (
          <div className="table-scroll table-flush card-rows">
            <table>
              <thead>
                <tr>
                  <th>Prospect</th>
                  <th>Company</th>
                  <th>Stage</th>
                  <th>Last touch</th>
                </tr>
              </thead>
              <tbody>
                {recent.map(({ row, prospect, touched }) => {
                  const name = nameOf(prospect);
                  return (
                    <tr key={row.id}>
                      <td data-label="Prospect">
                        <span className="prospect-who">
                          <span
                            className="prospect-initials"
                            aria-hidden="true"
                          >
                            {initialsOf(name)}
                          </span>
                          <span className="strongish">{name}</span>
                        </span>
                      </td>
                      <td
                        data-label="Company"
                        className="muted prospect-company"
                      >
                        {prospect.company ?? ""}
                      </td>
                      <td data-label="Stage">
                        <span
                          className={`pill plain tiny ${stageTone(row.status)}`}
                        >
                          {label(row.status)}
                        </span>
                      </td>
                      <td data-label="Last touch" className="muted nums">
                        {touched ? (
                          <time dateTime={isoAttr(touched)} title={formatDate(touched, viewerTimezone)}>
                            {formatWhen(touched, viewerTimezone)}
                          </time>
                        ) : (
                          "Not yet"
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </>
  );
}

/** Two letters for a prospect's mark, never an empty circle. */
function initialsOf(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  return (
    parts
      .slice(0, 2)
      .map((part) => part[0]!)
      .join("") || "?"
  ).toUpperCase();
}

/**
 * The chip's tint for a stage. A state, never decoration, and always beside
 * the stage's own word, so it never rests on colour alone.
 */
function stageTone(status: string): string {
  if (
    status === "accepted" ||
    status === "positive" ||
    status === "meeting_booked"
  )
    return "positive";
  if (status === "replied" || status.startsWith("messaged")) return "accent";
  if (status === "failed" || status === "opted_out") return "danger";
  return "";
}
