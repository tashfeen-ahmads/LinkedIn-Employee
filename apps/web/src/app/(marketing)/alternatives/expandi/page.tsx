import type { Metadata } from "next";
import Link from "next/link";
import { INVITE_NOTE_MAX_CHARS, LINKEDIN_LIMITS } from "@le/shared";
import { dailyInviteCap } from "@le/linkedin";
import { ArticleLayout, articleMeta, CompareTable, Callout, type Faq, type Source } from "@/components/article";
import { PUBLIC_LIMITS, SITE } from "@/lib/site";

const PATH = "/alternatives/expandi";
export const metadata: Metadata = articleMeta(PATH);

const FIRST_MESSAGE_MIN = Math.round(LINKEDIN_LIMITS.acceptFollowUpMinMs / 60_000);
const FIRST_MESSAGE_MAX = Math.round(LINKEDIN_LIMITS.acceptFollowUpMaxMs / 60_000);

/**
 * The day the weekly ceiling starts to bind, read off the same ramp the sender
 * enforces: the first day on which five days at the daily cap would pass the
 * week's ceiling. Computed, never retyped, so it moves if the ramp does.
 */
const DAY = 86_400_000;
const SENDING_DAYS = 5;
const FIRST_SEND = new Date("2026-01-05T09:00:00Z");
const capOnDay = (d: number) => dailyInviteCap(FIRST_SEND, new Date(FIRST_SEND.getTime() + d * DAY));
const WEEKLY_BINDS_FROM = (() => {
  for (let d = 0; d <= LINKEDIN_LIMITS.warmupDays; d++) {
    if (capOnDay(d) * SENDING_DAYS > LINKEDIN_LIMITS.invitesPerWeek) return d + 1;
  }
  return null;
})();
const WEEKLY_AS_DAILY = Math.floor(LINKEDIN_LIMITS.invitesPerWeek / SENDING_DAYS);

const EXPANDI_LIMITS = "https://help.expandi.io/en/articles/9688856-recommended-limits";
const EXPANDI_WARMUP = "https://help.expandi.io/en/articles/5405001-account-warm-up";
const EXPANDI_BLACKLIST = "https://help.expandi.io/en/articles/5405272-blacklists";
const EXPANDI_DUPES = "https://help.expandi.io/en/articles/5405809-duplicating-leads-in-multiple-campaigns-removing-duplicates";
const EXPANDI_LIMIT_BLOG = "https://expandi.io/blog/linkedin-connections-limit/";
const DERRICK = "https://derrick-app.com/en/pricing-expandi-2/";
const CAPTERRA = "https://www.capterra.com/p/251762/Expandi/";
const LGM_REVIEW = "https://lagrowthmachine.com/expandi-review/";
const LINKEDHELPER = "https://www.linkedhelper.com/en/reviews/expandi-review";
const LI_AGREEMENT = "https://www.linkedin.com/legal/user-agreement";

const FAQ: readonly Faq[] = [
  {
    q: "Is Expandi safe?",
    a: "No LinkedIn automation tool is fully safe, because LinkedIn's User Agreement prohibits automated access. Expandi runs in the cloud, offers an optional warm-up, and its help center recommends staying under 100 connection requests a week. Those are sensible defaults, but they are settings: the account's risk depends on the volume you choose and how many people accept.",
  },
  {
    q: "Is Expandi worth $99 a month?",
    a: "For someone who designs branching LinkedIn and email sequences and already has lists and copy, a reliable cloud sender at $99 per account (less on annual billing) can be worth it. If you send from one profile and want the targeting, writing and replies handled for you, you are paying for a builder you would rather not operate, and an AI SDR fits better.",
  },
  {
    q: "What is cheaper than Expandi?",
    a: "As of October 2026, Nora is free while it grows, with no card. Among paid tools, Dripify starts at $59 a user and Waalaxy's listed prices start lower still, though sources disagree on Waalaxy's figures. Several reviews also note that Expandi's personalised image and video features rely on partner tools billed separately, which raises the real cost per seat.",
  },
  {
    q: "Does Expandi have a free trial?",
    a: "Several 2026 sources describe a 7-day free trial with no card required, and Capterra lists a free trial but no free version. Competitor-written pages describe the trial differently, so confirm the length and terms with Expandi before you start one. A week is enough to see the product, though not to finish an account warm-up.",
  },
  {
    q: "Expandi or Dripify: which is safer?",
    a: "We found no enforced weekly ceiling published by either. Expandi recommends staying under 100 connection requests a week and offers an optional warm-up; Dripify's help center describes daily limits up to 75 connection requests with a random range. Both run in the cloud. The safer setup is whichever you configure more conservatively, with a slow ramp and a healthy acceptance rate.",
  },
];

const SOURCES: readonly Source[] = [
  { label: "Expandi help center: recommended limits (checked October 2026)", url: EXPANDI_LIMITS },
  { label: "Expandi help center: account warm-up", url: EXPANDI_WARMUP },
  { label: "Expandi help center: blacklists", url: EXPANDI_BLACKLIST },
  { label: "Expandi help center: duplicated leads across campaigns", url: EXPANDI_DUPES },
  { label: "Expandi blog: LinkedIn weekly invitation limit for 2026", url: EXPANDI_LIMIT_BLOG },
  { label: "Derrick: Expandi pricing 2026 (a vendor in the same market)", url: DERRICK },
  { label: "Capterra: Expandi pricing and trial listing", url: CAPTERRA },
  { label: "La Growth Machine: Expandi review 2026 (a competitor)", url: LGM_REVIEW },
  { label: "Linked Helper: Expandi review 2026, including an IP test (a competitor)", url: LINKEDHELPER },
  { label: "Meetergo: Expandi alternatives (studied for this page)", url: "https://meetergo.com/en/magazine/expandi-alternatives" },
  { label: "Salesforge: Expandi alternatives (a competitor, studied for this page)", url: "https://www.salesforge.ai/blog/expandi-alternatives" },
  { label: "Emelia: Expandi alternatives (a competitor directory, studied for this page)", url: "https://emelia.io/software/expandi/alternatives" },
  { label: "LinkedIn User Agreement", url: LI_AGREEMENT },
];

function Ext({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} rel="noopener nofollow" target="_blank">
      {children}
    </a>
  );
}

export default function Page() {
  return (
    <ArticleLayout
      path={PATH}
      h1="Expandi alternatives: an AI SDR that writes each note and books the meeting"
      lede="The right Expandi alternatives depend on the job: another sequence builder if you want to design branching LinkedIn and email flows yourself, or an AI SDR if you want the prospects found, each note written and the replies answered for you. Nora is the second kind, with a person approving the strategy, the copy and the launch, a warm-up you cannot skip, and nothing to pay while it grows."
      faq={FAQ}
      sources={SOURCES}
    >
      <CompareTable
        caption="In short: Expandi and Nora, as of October 2026"
        columns={["Expandi", "Nora"]}
        rows={[
          { label: "What it is", values: ["A cloud sequence builder you operate", "An AI SDR you approve"] },
          { label: "Price", values: ["$99 per LinkedIn account a month", "Free while it grows, no card"] },
          { label: "Warm-up", values: ["Optional setting", "Always on, from the first send"] },
          { label: "Email steps", values: ["Yes", "No, LinkedIn only"] },
        ]}
      />

      <h2 id="why-alternative">Why people look for an Expandi alternative</h2>
      <p>
        Expandi is one of the longer-standing cloud LinkedIn tools and is popular with growth teams
        who enjoy building their own flows. The ranking pages for this search mostly argue on price.
        Price matters, but it is rarely the only reason:
      </p>
      <ul>
        <li>
          <strong>Paying per seat for one profile.</strong> At $99 an account, a founder testing
          LinkedIn pays the same as a team running it full time.
        </li>
        <li>
          <strong>Building is a job.</strong> A branching sequence is as good as the list, the copy
          and the conditions you design. Targeting, writing and replying stay with you.
        </li>
        <li>
          <strong>Limits you have to set yourself.</strong> Expandi&rsquo;s recommendations are good;
          they are still recommendations, and nothing stops a busy week from overriding them.
        </li>
      </ul>

      <h2 id="expandi-in-brief">Expandi in brief, fairly</h2>
      <p>
        Expandi is a cloud sequence builder. You choose who to target, design a campaign with if-then
        conditions on what each prospect did, accepted or not, replied or not, and Expandi runs it
        from its own servers, with email steps alongside LinkedIn steps. Reviews describe a dedicated
        IP address per account; one competitor&rsquo;s{" "}
        <Ext href={LINKEDHELPER}>July 2026 test</Ext> disputes that the address is residential, so ask
        if it matters to you.
      </p>

      <h3 id="who-it-suits">Who it suits</h3>
      <p>
        Growth teams and agencies who like designing sequences, want LinkedIn and email in one
        branching flow, and already have lists and copy. It suits people who want fine control over
        every condition and are happy to own the result.
      </p>

      <h3 id="pricing">Pricing as of October 2026 (sourced)</h3>
      <p>
        The sources agree on the headline: <Ext href={DERRICK}>$99 per LinkedIn account a month</Ext>{" "}
        on monthly billing, around $79 on annual billing, and a quoted agency price for ten accounts
        or more. Several reviews, including <Ext href={LGM_REVIEW}>one from a competitor</Ext>, note
        that personalised image and video features come through partner tools billed separately.
        Most sources describe a 7-day free trial; <Ext href={CAPTERRA}>Capterra</Ext> lists a trial
        but no free version.
      </p>

      <h3 id="limits">How it handles limits and warm-up</h3>
      <p>
        Expandi&rsquo;s <Ext href={EXPANDI_LIMITS}>help center</Ext> recommends staying under 100
        connection requests a week. Its <Ext href={EXPANDI_WARMUP}>warm-up setting</Ext> raises a new
        account&rsquo;s daily limit by 2 every 1 to 3 days and switches itself off at 21 a day, after
        which your own limits apply. Leads are not duplicated across a company&rsquo;s accounts{" "}
        <Ext href={EXPANDI_DUPES}>by default</Ext>, unless you allow it, and{" "}
        <Ext href={EXPANDI_BLACKLIST}>blacklists</Ext> stop people being contacted, though a lead added
        to a campaign before the blacklist existed is not caught by it.
      </p>

      <h2 id="side-by-side">Nora vs Expandi: side by side</h2>
      <CompareTable
        caption="Nora compared with Expandi, as of October 2026"
        columns={["Nora", "Expandi"]}
        rows={[
          { label: "Who builds the campaign", values: ["The agent drafts it; you approve and launch", "You design the sequence"] },
          { label: "Who finds prospects", values: ["The agent, from a customer profile you approved", "You, from a search or a list"] },
          {
            label: "Connection notes",
            values: [`Written per person, under ${INVITE_NOTE_MAX_CHARS} characters, never with a link`, "Templates with personalization fields"],
          },
          { label: "Branching", values: ["No; angles tested side by side instead", "Yes, if-then conditions"] },
          {
            label: "Warm-up",
            values: [
              `Always on: ${PUBLIC_LIMITS.invitesPerDayStart} to ${PUBLIC_LIMITS.invitesPerDayMax} a day over about ${PUBLIC_LIMITS.warmupWeeks} weeks`,
              "Optional: +2 a day every 1 to 3 days, off at 21",
            ],
          },
          { label: "Weekly ceiling", values: [`${PUBLIC_LIMITS.invitesPerWeek}, enforced across all campaigns`, "Under 100 a week recommended"] },
          { label: "Replies", values: ["Answered from your documents under your rules, or held", "You reply"] },
          { label: "Meeting booking", values: ["Booking page or your own scheduling link", "Not covered by the sources we checked"] },
          { label: "Email steps", values: ["No", "Yes, in the same sequence"] },
          { label: "Price", values: ["Free while it grows", "$99 per account a month"] },
        ]}
      />

      <h3 id="finding-prospects">Finding prospects</h3>
      <p>
        Nora reads your website and proposes three to five customer profiles, and nothing is searched
        for until a person approves one. It searches on the LinkedIn tier your account actually has,
        names on the campaign any filter that tier cannot apply, opens every profile before it
        reaches the list, and leaves out anyone your workspace has already contacted.
      </p>

      <h3 id="writing-notes">Writing notes</h3>
      <p>
        Instead of conditions, you can split a campaign across two or three angles: the pain a note
        names, or the reason for reaching out. People are assigned evenly, each angle keeps its own
        follow-ups, and no angle is called behind until another's whole confidence range sits above its own. Every note is
        written for one person and shows which of their details it used. Paste any note into the{" "}
        <Link href="/tools/connection-note-checker">connection note checker</Link> to see the same
        rules applied.
      </p>

      <h3 id="replies-booking">Replies and booking</h3>
      <p>
        Nora checks for acceptances through the day and sends the first message {FIRST_MESSAGE_MIN} to{" "}
        {FIRST_MESSAGE_MAX} minutes after it notices one, inside your working hours. Replies are
        classified and answered only from the documents you gave it. Pricing, legal and negative
        replies wait for you unless you choose otherwise; a prospect who asks for a person always
        waits; an opt-out stops everything. The agent never makes up a meeting time or a link: times
        come from its booking page, or it sends your own scheduling link.
      </p>

      <h3 id="safety">Safety guardrails</h3>
      <p>
        In Expandi, limits are settings. In Nora they are product rules an owner can lower and nobody
        can raise. The ramp starts at an account&rsquo;s first send, not the day it was connected, a
        day&rsquo;s allowance is spread across working hours, and once there are enough invitations to judge, acceptance
        below {PUBLIC_LIMITS.healthyAcceptance}% is flagged to you in the digest. The{" "}
        <Link href="/guides/linkedin-warm-up-schedule">week-by-week LinkedIn warm-up schedule</Link>{" "}
        shows the whole ramp.
      </p>

      <h3 id="price">Price</h3>
      <p>
        Nora is free for every workspace while it grows, with no card and no seats. Expandi is $99 per
        account, so a team of three senders is about $297 a month on monthly billing.
      </p>

      <h2 id="weekly-cap">A weekly cap is a feature, not a weakness</h2>
      <p>
        Comparison pages often treat a lower ceiling as a missing feature. On LinkedIn it is the
        opposite, and Expandi&rsquo;s own <Ext href={EXPANDI_LIMIT_BLOG}>guidance</Ext> agrees on the
        number: around 100 a week. The difference is whether the number is advice or a rule.
      </p>
      <p>
        Here is how Nora&rsquo;s two caps interact. The daily cap climbs from{" "}
        {PUBLIC_LIMITS.invitesPerDayStart} to {PUBLIC_LIMITS.invitesPerDayMax}, but{" "}
        {PUBLIC_LIMITS.invitesPerWeek} a week over {SENDING_DAYS} sending days is only{" "}
        {WEEKLY_AS_DAILY} a day.
        {WEEKLY_BINDS_FROM
          ? ` From about day ${WEEKLY_BINDS_FROM} of sending, ${SENDING_DAYS} days at the daily cap would pass the weekly ceiling, so from then on the weekly ceiling is the limit that actually binds.`
          : null}{" "}
        The higher daily figure buys flexibility, a busy Tuesday after a quiet Monday, without
        letting the week grow.
      </p>
      <p>Why that is worth having:</p>
      <ul>
        <li>
          <strong>It protects the account from your best week.</strong> A tool whose ceiling you can
          raise will be raised on the day a campaign is going well, which is exactly when acceptance
          starts to fall.
        </li>
        <li>
          <strong>It forces targeting.</strong> With {PUBLIC_LIMITS.invitesPerWeek} invitations a week,
          sending to the wrong people is expensive, so the approval of the customer profile matters.
        </li>
        <li>
          <strong>It is shared across campaigns.</strong> Two campaigns on one account cannot each
          spend a full week.
        </li>
      </ul>
      <p>
        Our guide to the{" "}
        <Link href="/guides/linkedin-weekly-invitation-limit">LinkedIn weekly invitation limit</Link>{" "}
        explains what LinkedIn itself enforces and how it resets.
      </p>
      <Callout tone="safety">
        <p>
          LinkedIn&rsquo;s <Ext href={LI_AGREEMENT}>User Agreement</Ext> prohibits automated access,
          so no tool can promise zero risk. Cloud tools, Expandi and Nora both, avoid depending on your
          browser, but the account doing the sending still carries the risk.
        </p>
      </Callout>

      <h2 id="other-alternatives">Other Expandi alternatives worth a look</h2>
      <ul>
        <li>
          <strong>Dripify</strong>, the common &ldquo;Expandi vs Dripify&rdquo; pairing: drip sequences
          with team dashboards, priced per user. See <Link href="/alternatives/dripify">Dripify compared</Link>.
        </li>
        <li>
          <strong>HeyReach</strong>, if you run many sender accounts for clients. See{" "}
          <Link href="/alternatives/heyreach">HeyReach compared</Link>.
        </li>
        <li>
          <strong>Waalaxy</strong>, for ready-made campaigns at a lower listed price. See{" "}
          <Link href="/alternatives/waalaxy">Waalaxy compared</Link>.
        </li>
      </ul>
      <p>
        Every tool by published caps, warm-up and dated price is on{" "}
        <Link href="/alternatives">the LinkedIn automation tools comparison</Link>, and the{" "}
        <Link href="/guides/best-ai-sdr-for-linkedin">guide to choosing an AI SDR for LinkedIn</Link>{" "}
        lists the questions to ask any vendor, including us.
      </p>

      <h2 id="stay-with-expandi">Who should stay with Expandi</h2>
      <ul>
        <li>You want email steps and LinkedIn steps in one branching flow.</li>
        <li>You enjoy designing sequences and want control over every condition.</li>
        <li>You already have lists and copy, and need a reliable cloud sender to run them.</li>
        <li>You use personalised images or video in LinkedIn messages.</li>
      </ul>
      <p>
        If you would rather approve the work than build it, read{" "}
        <Link href="/how-it-works">how Nora works</Link> or{" "}
        <a href={`${SITE.app}/signup`}>Sign up free</a>. If you move an account across, it starts at{" "}
        {PUBLIC_LIMITS.invitesPerDayStart} invitations a day, because the ramp counts from its first
        send through Nora.
      </p>
    </ArticleLayout>
  );
}
