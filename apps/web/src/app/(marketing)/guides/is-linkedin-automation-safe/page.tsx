import type { Metadata } from "next";
import Link from "next/link";
import { ArticleLayout, articleMeta, Callout, CompareTable } from "@/components/article";
import { PUBLIC_LIMITS } from "@/lib/site";
import { CopyButton } from "@/components/copy-button";
import { BURST_FIRST_MIN, BURST_LAST_MIN, DayTimeline, clock } from "@/components/seo/ga2-day-timeline";
import { PrintListButton } from "@/components/seo/ga2-print-button";
import { INVITE_NOTE_MAX_CHARS, LINKEDIN_LIMITS } from "@le/shared";
import { backOff, classifyProviderError, invitePaceMs } from "@le/linkedin";

const PATH = "/guides/is-linkedin-automation-safe";

export const metadata: Metadata = articleMeta(PATH);

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

/*
 * The cooldown after LinkedIn's "temporary limit" refusal, read from the same
 * classifier the sender uses, so the hours on this page are the hours the
 * product actually waits.
 */
const THROTTLE = classifyProviderError("errors/cannot_resend_yet");
const FIRST_COOLDOWN_MS = THROTTLE.kind === "retry_later" ? THROTTLE.cooldownMs : 0;
const FIRST_COOLDOWN_H = Math.round(FIRST_COOLDOWN_MS / HOUR_MS);
const SECOND_COOLDOWN_H = Math.round(backOff(FIRST_COOLDOWN_MS, 1) / HOUR_MS);
const LONGEST_COOLDOWN_H = Math.round(backOff(FIRST_COOLDOWN_MS, Number.MAX_SAFE_INTEGER) / HOUR_MS);
const MIN_GAP_MIN = Math.round(LINKEDIN_LIMITS.minGapMs / MINUTE_MS);
const MAX_GAP_MIN = Math.round(LINKEDIN_LIMITS.maxGapMs / MINUTE_MS);

/* What the day's spread works out to for a first-day account on an eight-hour day. */
const EIGHT_HOURS_MS = 8 * HOUR_MS;
const FIRST_DAY_PACE_MIN = Math.round((invitePaceMs({ remaining: PUBLIC_LIMITS.invitesPerDayStart, windowMs: EIGHT_HOURS_MS }) ?? 0) / MINUTE_MS);

const FAQ = [
  {
    q: "Can LinkedIn ban you for using automation?",
    a: "Yes. As of October 2026 LinkedIn's User Agreement prohibits bots and other unauthorized automated methods for adding contacts or sending messages, and its help center says automated activity can lead to a restriction. Most restrictions it describes are temporary: an automated-activity restriction ends at the time in the notice once the software is disabled. Repeated or ignored warnings are what turn temporary into something longer.",
  },
  {
    q: "How many connection requests per day is safe?",
    a: `LinkedIn publishes no number, so nobody can give you an official one. Nora starts every account at ${PUBLIC_LIMITS.invitesPerDayStart} a day, ramps to ${PUBLIC_LIMITS.invitesPerDayMax} over ${PUBLIC_LIMITS.warmupWeeks} weeks from the first send, and never exceeds ${PUBLIC_LIMITS.invitesPerWeek} a week across all campaigns. Those are deliberately conservative. Just as important is spreading the day's requests across working hours instead of sending them in one sitting.`,
  },
  {
    q: "Can LinkedIn detect automation tools?",
    a: "LinkedIn does not publish how it detects automation. It does publish what leads to an invitation restriction: many invitations in a short time, many ignored, left pending or marked as spam, and suspected use of automation tools. Whatever the detection method, those patterns are visible on LinkedIn's side whichever tool sends, so they are what to control.",
  },
  {
    q: "Is a LinkedIn CAPTCHA a warning sign?",
    a: "Often, yes, though not always. A CAPTCHA or a forced re-login can follow a new device, a new location or a VPN as easily as automation. If it arrives while a tool is sending, or keeps coming back, treat it as the first warning: lower volume, check the account's acceptance rate, and make sure only one tool is connected to the account.",
  },
  {
    q: "What happens when someone clicks 'I don't know this person'?",
    a: "The person declines your invitation and tells LinkedIn they do not know you. LinkedIn's help center asks members to use the option only when they truly do not know the sender, and names too many invitations to people you do not know as the most common reason for an invitation restriction. LinkedIn does not publish how many such answers it takes.",
  },
  {
    q: "What percentage of automation users get restricted?",
    a: "Nobody knows, and the figures you will see are not measurements of the whole market. The 23% figure traces to one vendor's in-house test of 50 accounts, the 83% figure to another vendor's post about its own users, and we could not trace a 40% figure to any study. LinkedIn does not publish a rate. Treat any single number as marketing.",
  },
];

const SOURCES = [
  { label: "LinkedIn User Agreement, section 8.2 (Don'ts), as of October 2026", url: "https://www.linkedin.com/legal/user-agreement" },
  { label: "LinkedIn Help: Automated activity on LinkedIn", url: "https://www.linkedin.com/help/linkedin/answer/90586" },
  { label: "LinkedIn Help: Invitation restrictions (reasons and durations)", url: "https://www.linkedin.com/help/linkedin/answer/4800" },
  { label: "LinkedIn Help: Connecting with other members, best practices ('I don't know' option)", url: "https://www.linkedin.com/help/linkedin/answer/62928" },
  { label: "Cleverly: why LinkedIn automation tools get accounts banned (source of the 23% in-house test)", url: "https://cleverly.co/blog/why-linkedin-automation-tools-get-your-account-banned-and-what-to-do-instead" },
  { label: "Bearconnect on DEV Community: automation data post (source of the 83% figure)", url: "https://dev.to/bearconnectio/linkedin-automation-doesnt-break-your-account-the-real-data-5b53" },
  { label: "Indie Hackers: 'detection rates went up 40%' (an anecdote, not a restriction rate)", url: "https://www.indiehackers.com/post/my-linkedin-account-got-banned-3-times-heres-what-i-learned-about-safe-automation-d2447ed6c0" },
];

const CHECKLIST_TITLE = "LinkedIn automation safety checklist";
const CHECKLIST_FOOTER = "From the guide at norasdr.com/guides/is-linkedin-automation-safe";
const CHECKLIST = [
  "Are the daily and weekly caps published, and set below the ceilings vendors report rather than at them?",
  "Does the warm-up ramp start at the account's first send, not the day it was connected?",
  "Is a day's allowance spread across working hours, with irregular gaps?",
  "What happens on the first \"try again later\": hours of silence, or another attempt in five minutes?",
  "Is acceptance rate watched, with a warning when it drops?",
  "Does a human approve the target list and the copy before anything sends?",
  "Can the same person be contacted by two campaigns?",
  `Is each note written for the person, ${INVITE_NOTE_MAX_CHARS} characters or fewer, with no link?`,
  "Are old pending invitations withdrawn on a schedule?",
  "Does the tool pause the account and tell you when LinkedIn reports a problem?",
] as const;
const CHECKLIST_TEXT = [CHECKLIST_TITLE, "", ...CHECKLIST.map((item, i) => `${i + 1}. ${item}`), "", CHECKLIST_FOOTER].join("\n");

const STATS = [
  {
    label: "\"23% restricted within 90 days\"",
    values: [
      "A vendor's own test of 50 accounts using automation tools.",
      "No published method, no comparison group, a sample of 50.",
    ],
  },
  {
    label: "\"83% see zero restrictions\" (17% restricted)",
    values: [
      "A vendor's post about 1,000+ accounts using automation.",
      "Users of one product, sampled by that product, with no method published.",
    ],
  },
  {
    label: "\"40% restricted\"",
    values: [
      "We could not trace it to any study. The nearest is a founder's post saying detection rates rose 40%.",
      "A different claim (a rise in detection, not a share of users), with no data behind it.",
    ],
  },
];

export default function Page() {
  return (
    <ArticleLayout
      path={PATH}
      h1="Is LinkedIn automation safe? What actually gets accounts restricted"
      lede="LinkedIn automation is not safe in the sense of risk-free: LinkedIn's User Agreement prohibits automated methods for adding contacts and sending messages, so every tool carries some risk of a restriction. Whether that risk becomes a restricted account depends on what LinkedIn can observe: how fast you send, how many people ignore or report you, and whether you stop when the platform pushes back."
      faq={FAQ}
      sources={SOURCES}
    >
      <h2 id="short-answer">Is LinkedIn automation safe? The short answer</h2>
      <ul>
        <li>
          <strong>It is against the rules.</strong> LinkedIn&apos;s User Agreement, as of October 2026, lists using bots or other
          unauthorized automated methods to add contacts or send messages among the things members agree not to do. Any tool that
          sends for you, Nora included, operates against that.
        </li>
        <li>
          <strong>Most consequences are temporary.</strong> LinkedIn&apos;s help center says most invitation restrictions lift within a
          week, and an automated-activity restriction ends at the time in the notice once the software is off.
        </li>
        <li>
          <strong>Behavior decides the risk, not the brand of tool.</strong> Speed, acceptance and what happens after a refusal are
          what LinkedIn can see.
        </li>
        <li>
          <strong>Nobody can promise zero risk.</strong> A tool that does is telling you something LinkedIn has not said.
        </li>
      </ul>
      <p>
        The specific numbers (how many invitations a day and a week) have their own page:{" "}
        <Link href="/linkedin-automation-limits">LinkedIn connection request limits in 2026</Link>. This one is about what gets
        accounts restricted and why.
      </p>

      <h2 id="what-linkedin-observes">What LinkedIn can observe</h2>
      <p>
        LinkedIn does not describe its detection. It does name, on its invitation-restrictions page, three reasons an account is
        restricted from inviting: many invitations in a short time, many invitations ignored, left pending or marked as spam, and
        suspected use of automation tools. Each pattern below is visible from LinkedIn&apos;s side however the tool is built.
      </p>

      <h3 id="regular-timing">Timing that is too regular</h3>
      <p>
        A person does not send an invitation every 120 seconds for an hour. Fixed delays, or &quot;random&quot; delays drawn from a
        narrow band, produce a rhythm no human makes. Nora keeps any two actions at least {MIN_GAP_MIN} minutes apart, with a
        random floor of {MIN_GAP_MIN} to {MAX_GAP_MIN} minutes, spreads the day across your working hours on top of that, and
        jitters retries too, so a backlog released at 9 a.m. does not drain like a metronome.
      </p>

      <h3 id="bursts">Bursts inside a daily cap</h3>
      <p>
        Most safety advice stops at &quot;stay under X a day&quot;. A cap says how many, not when. Ten invitations sent between 9 a.m. and
        9:30 a.m. are inside a ten-a-day cap and still look like a machine emptying a queue. The next section is what that cost us.
      </p>

      <h3 id="low-acceptance">Low acceptance rate</h3>
      <p>
        Ignored and pending invitations are on LinkedIn&apos;s own list. An account sending a modest number of invitations to people
        who do not want them gives the same signal as one that sends too many. Nora flags any account whose acceptance falls below{" "}
        {PUBLIC_LIMITS.healthyAcceptance}% so the targeting gets fixed while it is still a targeting problem.
      </p>

      <h3 id="dont-know">&quot;I don&apos;t know this person&quot; reports</h3>
      <p>
        LinkedIn&apos;s best-practices page asks members to use the &quot;I don&apos;t know&quot; option only when they truly do not know the
        sender, and says the most common reason for an invitation restriction is sending too many invitations to people you do not
        know. A generic note to a stranger is the invitation most likely to collect one.
      </p>

      <h3 id="same-person">Messaging the same person again</h3>
      <p>
        Two campaigns built from the same audience will happily invite the same person twice, a week apart, under two different
        pretexts. That is the second contact that makes the first look like a mail merge, and the one most likely to be reported.
        In Nora, once somebody has been contacted from a workspace, no campaign can send them another invitation; the check runs
        immediately before every send.
      </p>

      <h2 id="incident">A daily cap is not a pace: a real incident</h2>
      <p>
        This is the story of the first LinkedIn account Nora ever ran, told in full because it is the clearest lesson we have
        about what a cap does not do.
      </p>

      <h3 id="seven-in-27">Seven invitations in 27 minutes on day one</h3>
      <p>
        The account had never sent anything through Nora, so it sat at the starting cap of {PUBLIC_LIMITS.invitesPerDayStart}{" "}
        invitations a day. The cap decided how many. Nothing decided when: the sender placed each invitation a few minutes
        after the last, starting whenever the scheduler happened to run.
      </p>
      <p>
        That afternoon it sent seven connection requests between {clock(BURST_FIRST_MIN)} and {clock(BURST_LAST_MIN)}, the first seven
        actions the account had ever taken through Nora. Every one was inside the daily cap. Together they were a burst from
        an account with no history, which is exactly the pattern a cap is supposed to prevent.
      </p>
      <DayTimeline dailyCount={PUBLIC_LIMITS.invitesPerDayStart} />

      <h3 id="five-days">What the refusals looked like for five days</h3>
      <p>
        LinkedIn began refusing invitations from the account. Each refusal said, in substance, that the account had reached a
        temporary limit and should try again later.
      </p>
      <p>
        Our sender at that point read those as failed invitations and moved on to the next person. That meant more refused
        attempts against an account LinkedIn had already decided to slow down.
      </p>
      <p>
        Five days later LinkedIn was still refusing. The account had sent seven invitations all week and had five of them
        still pending.
      </p>

      <h3 id="what-changed">What we changed</h3>
      <ul>
        <li>
          <strong>The day is spread.</strong> A day&apos;s allowance is divided across the working time left in the day. Ten
          invitations on an eight-hour day now start about {FIRST_DAY_PACE_MIN} minutes apart and reach across most of the day,
          as in the lower row above, never closer than {MIN_GAP_MIN} minutes.
        </li>
        <li>
          <strong>A refusal stops the account.</strong> A &quot;try again later&quot; refusal now pauses all invitations from the
          account for {FIRST_COOLDOWN_H} hours, then {SECOND_COOLDOWN_H}, doubling up to {LONGEST_COOLDOWN_H}.
        </li>
        <li>
          <strong>Nobody is marked as failed.</strong> The people waiting stay on the campaign and are invited once the
          account is sending again.
        </li>
      </ul>
      <Callout tone="safety">
        <p>
          <strong>The lesson for any tool:</strong> ask not only &quot;what is the daily cap?&quot; but &quot;how is a day spread?&quot;
          and &quot;what happens on the first refusal?&quot;. A vendor who cannot answer the second and third has not thought about the
          part that matters.
        </p>
      </Callout>

      <h2 id="warning-signs">Warning signs, in the order they usually arrive</h2>
      <p>
        LinkedIn does not publish an escalation ladder, so this order is what users and tool vendors commonly report rather than a
        rule. Treat each step as a reason to slow down before the next one arrives.
      </p>

      <h3 id="captcha">CAPTCHA and re-login prompts</h3>
      <p>
        Being asked to solve a CAPTCHA or sign in again more often than usual. It can be innocent (a new laptop, travel, a VPN), so
        rule those out. If none apply and a tool is sending, check whether two tools are connected to the same account and lower
        the volume.
      </p>

      <h3 id="weekly-notice">The weekly invitation notice</h3>
      <p>
        &quot;You&apos;ve reached the weekly invitation limit&quot;. Not a restriction on the account, but LinkedIn telling you where its
        line is for you this week. Our guide to the{" "}
        <Link href="/guides/linkedin-weekly-invitation-limit">LinkedIn weekly invitation limit</Link> explains what to do next.
      </p>

      <h3 id="unusual-activity">Unusual-activity restriction</h3>
      <p>
        Invitations refused, or a notice that the account is temporarily restricted. LinkedIn says most invitation restrictions lift
        within a week and support will not remove them on request. Stop everything until it lifts.
      </p>

      <h3 id="id-check">ID verification</h3>
      <p>
        A request to verify your identity before you can sign in. It is the most disruptive of the four, because the whole account
        is unavailable until you complete it. Our{" "}
        <Link href="/guides/linkedin-account-restricted">plan for the first 48 hours after a LinkedIn restriction</Link> goes through
        each notice and what to do.
      </p>

      <h2 id="statistics">The restriction-rate numbers you will see, audited</h2>
      <p>
        Search for this topic and you will meet confident percentages. We traced each one we could find, as of October 2026.
      </p>

      <h3 id="where-from">Where &quot;23%&quot;, &quot;40%&quot; and &quot;83%&quot; come from</h3>
      <CompareTable
        caption="Restriction-rate figures quoted online and where they come from, traced in October 2026"
        columns={["Where it comes from", "Why it cannot be generalized"]}
        rows={STATS}
      />
      <p>
        Notice that two of the three come from companies selling automation, pointing in opposite directions depending on the
        argument. A vendor arguing tools are dangerous quotes a high number; a vendor arguing its tool is safe quotes a low one.
      </p>

      <h3 id="no-independent-figure">Why no independent figure exists</h3>
      <p>
        Only LinkedIn knows how many accounts it restricts and why, and it does not publish a rate by cause. Every outside number
        is drawn from one vendor&apos;s own customers, who share that vendor&apos;s defaults, targeting habits and caps. Restrictions are
        also under-reported: a quiet one-week invitation restriction often goes unnoticed. The honest answer is that the rate
        depends on behavior, and nobody has measured it across the market.
      </p>

      <h2 id="checklist">A safety checklist you can use with any tool</h2>
      <p>
        Hold any tool, including this one, to these questions before you connect an account. Copy the list into your own
        notes, or print it (the print dialog can also save it as a PDF).
      </p>
      <div className="ga2-checklist">
        <ol>
          {CHECKLIST.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ol>
        <div className="ga2-actions">
          <CopyButton value={CHECKLIST_TEXT} label="Copy checklist" />
          <PrintListButton title={CHECKLIST_TITLE} items={CHECKLIST} footer={CHECKLIST_FOOTER} />
        </div>
      </div>
      <p>
        Our guide to the <Link href="/guides/safest-linkedin-automation-tool">safest LinkedIn automation tool</Link> applies checks
        like these to the main tools, and{" "}
        <Link href="/guides/cloud-vs-browser-extension-linkedin-automation">cloud vs browser-extension automation</Link> covers
        whether the type of tool matters (less than vendors suggest). For timing within the day, see{" "}
        <Link href="/guides/best-time-to-send-linkedin-connection-requests">the best time to send LinkedIn connection requests</Link>.
        On the legal side, as distinct from LinkedIn&apos;s own rules, see{" "}
        <Link href="/guides/is-linkedin-automation-legal">is LinkedIn automation illegal?</Link>
      </p>

      <h2 id="how-nora-handles-it">How Nora handles each risk</h2>
      <p>Each number below is the one Nora actually enforces on every account.</p>
      <ul>
        <li>
          <strong>Caps.</strong> {PUBLIC_LIMITS.invitesPerDayStart} invitations a day at the start, rising to{" "}
          {PUBLIC_LIMITS.invitesPerDayMax} over {PUBLIC_LIMITS.warmupWeeks} weeks, and a hard ceiling of{" "}
          {PUBLIC_LIMITS.invitesPerWeek} a week per account across all campaigns. Messages are capped separately at{" "}
          {PUBLIC_LIMITS.messagesPerDay} a day. A campaign can set a lower limit; nothing can raise the caps.
        </li>
        <li>
          <strong>Ramp from the first send.</strong> An account that has sent nothing stays at {PUBLIC_LIMITS.invitesPerDayStart}{" "}
          however long ago it was connected.
        </li>
        <li>
          <strong>A pace, not only a cap.</strong> The day&apos;s invitations are spread across the working time left, never closer
          than {MIN_GAP_MIN} minutes apart (a random floor of {MIN_GAP_MIN} to {MAX_GAP_MIN} minutes), and nothing goes out
          outside your hours.
        </li>
        <li>
          <strong>Refusals.</strong> {FIRST_COOLDOWN_H} hours of silence on the first &quot;try again later&quot;, doubling up to{" "}
          {LONGEST_COOLDOWN_H}. A refusal Nora does not recognize is treated as final rather than retried.
        </li>
        <li>
          <strong>Account health</strong> is read on every send and every night. A warning or restriction pauses the account at
          once, and a restriction emails you rather than waiting for you to notice nothing is happening.
        </li>
        <li>
          <strong>Notes</strong> are written from each prospect&apos;s own details, kept to {INVITE_NOTE_MAX_CHARS} characters or fewer, and
          checked in code for links: a note carrying one is sent with no note at all.
        </li>
        <li>
          <strong>Approval and never twice.</strong> You approve the strategy, the copy and the launch, and nobody is invited twice
          from one workspace.
        </li>
        <li>
          <strong>Housekeeping.</strong> Invitations still pending after {LINKEDIN_LIMITS.withdrawAfterDays} days are withdrawn
          automatically, in small batches.
        </li>
      </ul>
      <p>
        To work out what your own account can send on any day, try the{" "}
        <Link href="/tools/linkedin-limit-calculator">LinkedIn limit calculator</Link>. Where your data lives is on the{" "}
        <Link href="/security">security page</Link>.
      </p>
    </ArticleLayout>
  );
}
