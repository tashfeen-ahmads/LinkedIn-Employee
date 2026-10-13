import type { Metadata } from "next";
import Link from "next/link";
import { LINKEDIN_LIMITS } from "@le/shared";
import { dailyInviteCap } from "@le/linkedin";
import { ArticleLayout, articleMeta, CompareTable, type Faq, type Source } from "@/components/article";
import { PUBLIC_LIMITS } from "@/lib/site";
import { Glance, NORA, Verdict, NOT_DOCUMENTED, withGlanceSources, type GlanceTool } from "../_glance";

const PATH = "/alternatives/expandi";
export const metadata: Metadata = articleMeta(PATH);

const GLANCE: readonly GlanceTool[] = ["nora", "expandi", "dripify", "waalaxy", "heyreach", "phantombuster"];

/**
 * How the two caps interact, read off the same ramp the sender enforces:
 * the daily cap at the start of each week of sending, and whether five days
 * at that cap would pass the weekly ceiling. Computed, never retyped, so it
 * moves if the ramp does.
 */
const DAY = 86_400_000;
const SENDING_DAYS = 5;
const FIRST_SEND = new Date("2026-01-05T09:00:00Z");
const capOnDay = (d: number) => dailyInviteCap(FIRST_SEND, new Date(FIRST_SEND.getTime() + d * DAY));
const WEEKS = Array.from({ length: Math.ceil(LINKEDIN_LIMITS.warmupDays / 7) + 1 }, (_, i) => {
  const cap = capOnDay(i * 7);
  return { week: i + 1, cap, five: cap * SENDING_DAYS };
});
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
    a: "As of October 2026, for someone who designs branching LinkedIn and email sequences and already has lists and copy, a reliable cloud sender at $99 per account (less on annual billing) can be worth it. If you send from one profile and want the targeting, writing and reply drafts handled for you, you are paying for a builder you would rather not operate, and an AI SDR fits better.",
  },
  {
    q: "What is cheaper than Expandi?",
    a: "As of October 2026, Nora is free while we grow, with no card. Among paid tools, Dripify starts at $59 a user and Waalaxy's listed prices start lower still, though sources disagree on Waalaxy's figures. Several reviews also note that Expandi's personalized image and video features rely on partner tools billed separately, which raises the real cost per seat.",
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

const SOURCES: readonly Source[] = withGlanceSources(
  [
    { label: "Expandi help center: recommended limits (checked October 2026)", url: EXPANDI_LIMITS },
    { label: "Expandi help center: account warm-up", url: EXPANDI_WARMUP },
    { label: "Expandi help center: blacklists", url: EXPANDI_BLACKLIST },
    { label: "Expandi help center: duplicated leads across campaigns", url: EXPANDI_DUPES },
    { label: "Expandi blog: LinkedIn weekly invitation limit for 2026", url: EXPANDI_LIMIT_BLOG },
    { label: "Derrick: Expandi pricing 2026 (a vendor in the same market)", url: DERRICK },
    { label: "Capterra: Expandi pricing and trial listing", url: CAPTERRA },
    { label: "La Growth Machine: Expandi review 2026 (a competitor)", url: LGM_REVIEW },
    { label: "Linked Helper: Expandi review 2026, including an IP test (a competitor)", url: LINKEDHELPER },
    { label: "LinkedIn User Agreement", url: LI_AGREEMENT },
  ],
  GLANCE,
);

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
      h1="Expandi alternatives: an AI SDR that writes and books"
      lede="The right Expandi alternative depends on the job. If you want to design branching LinkedIn and email flows yourself, another sequence builder is the closer swap; if you want the prospects found, each note written and the replies drafted for you, an AI SDR such as Nora fits better, with a warm-up you cannot skip and a person approving every stage."
      faq={FAQ}
      sources={SOURCES}
    >
      <h2 id="short-answer">Nora or Expandi: the short answer</h2>
      <Verdict
        rival="Expandi"
        nora={["You want the prospects found and each note written for you.", "You want a warm-up nobody can switch off and caps nobody can raise.", "You want replies drafted for you and meetings booked, without designing a flow."]}
        them={["You want email steps and LinkedIn steps in one branching flow.", "You enjoy designing sequences and want control over every condition.", "You use personalized images or video in LinkedIn messages."]}
      />

      <h2 id="at-a-glance">Expandi alternatives at a glance</h2>
      <p>
        Six tools people weigh against Expandi, by who each suits, what it costs to start and the
        LinkedIn volume each publishes.
      </p>
      <Glance tools={GLANCE} />

      <h2 id="why-alternative">Why people look for an Expandi alternative</h2>
      <p>
        Expandi is one of the longer-standing cloud LinkedIn tools and is popular with growth teams
        who enjoy building their own flows. Price matters, but it is rarely the only reason to look
        elsewhere:
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
        that personalized image and video features come through partner tools billed separately.
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
          { label: "Who finds prospects", values: [NORA.prospects, "You, from a search or a list"] },
          { label: "Connection notes", values: [NORA.notes, "Templates with personalization fields"] },
          { label: "Branching", values: ["No; angles tested side by side instead", "Yes, if-then conditions"] },
          { label: "Warm-up", values: [NORA.warmup, "Optional: +2 a day every 1 to 3 days, off at 21"] },
          { label: "Weekly ceiling", values: [NORA.weekly, "Under 100 a week recommended"] },
          { label: "Replies", values: [NORA.replies, "You reply"] },
          { label: "Meeting booking", values: [NORA.booking, NOT_DOCUMENTED] },
          { label: "Email steps", values: [NORA.email, "Yes, in the same sequence"] },
        ]}
      />

      <h2 id="where-nora-differs">Where Nora differs from Expandi</h2>
      <p>
        Nora replaces the sequence you would build with a campaign it drafts: customer profiles from
        your website, a note for each person, reply drafts from your documents. A person approves the
        strategy, the copy and the launch, and <Link href="/how-it-works">how Nora works</Link> shows
        each step.
      </p>
      <p>
        Expandi&rsquo;s strength is branching: if they accepted, do this; if they replied, do that.
        Nora has no branches. What it varies is the angle, meaning the pain a note names or the reason
        for reaching out. You can split a campaign across two or three, people are assigned evenly,
        each angle keeps its own follow-ups, and none is called behind until another&rsquo;s whole
        confidence range sits above its own. Branching tunes a path; angles test a message. To see
        how one note holds up, paste it into the{" "}
        <Link href="/tools/connection-note-checker">connection note checker</Link>.
      </p>
      <p>
        The other difference is that Expandi&rsquo;s limits are recommendations and its warm-up is a
        switch, while Nora&rsquo;s are rules an owner can lower and nobody can raise. Once there are
        enough invitations to judge, acceptance below {PUBLIC_LIMITS.healthyAcceptance}% is flagged
        to you in the digest. LinkedIn&rsquo;s <Ext href={LI_AGREEMENT}>User Agreement</Ext> prohibits
        automated access, so neither tool removes the risk.
      </p>

      <h2 id="weekly-cap">A weekly cap is a feature, not a weakness</h2>
      <p>
        Comparison pages often treat a lower ceiling as a missing feature. On LinkedIn it is the
        opposite, and Expandi&rsquo;s own <Ext href={EXPANDI_LIMIT_BLOG}>guidance</Ext> agrees on the
        number: around 100 a week. The difference is whether the number is advice or a rule.
      </p>
      <p>
        Nora has two caps. The daily cap climbs from {PUBLIC_LIMITS.invitesPerDayStart} to{" "}
        {PUBLIC_LIMITS.invitesPerDayMax}. The weekly ceiling stays at {PUBLIC_LIMITS.invitesPerWeek},
        which over {SENDING_DAYS} sending days is only {WEEKLY_AS_DAILY} a day.
      </p>
      <p>
        So early in the ramp the daily cap is what limits you, and later the weekly ceiling takes
        over. The higher daily figure then buys flexibility, a busy Tuesday after a quiet Monday,
        without letting the week grow.
      </p>
      <CompareTable
        caption={`Which cap binds, week by week, if you send on ${SENDING_DAYS} days a week`}
        columns={["Daily cap at the start of the week", `${SENDING_DAYS} days at that cap`, "Limit that binds"]}
        rows={WEEKS.map((w) => ({
          label: `Week ${w.week}`,
          values: [
            String(w.cap),
            String(w.five),
            w.five > PUBLIC_LIMITS.invitesPerWeek ? `Weekly ceiling (${PUBLIC_LIMITS.invitesPerWeek})` : "Daily cap",
          ],
        }))}
      />
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
        explains what LinkedIn itself enforces and how it resets, and the{" "}
        <Link href="/guides/linkedin-warm-up-schedule">week-by-week LinkedIn warm-up schedule</Link>{" "}
        shows the whole ramp.
      </p>

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

      <h2 id="switching">Switching without contacting anyone twice</h2>
      <p>
        Two cloud tools acting as the same LinkedIn profile is the situation to avoid, and Expandi
        keeps running when your browser is closed.
      </p>
      <ol>
        <li>
          <strong>Pause every Expandi campaign on the account.</strong> A branch waiting on an
          acceptance will still fire if someone accepts an old invitation next week.
        </li>
        <li>
          <strong>Disconnect the account from Expandi</strong> before you connect it to Nora, so only
          one tool is sending from that profile and its daily count means something.
        </li>
        <li>
          <strong>Move your blacklist across.</strong> Nora&rsquo;s rule against contacting anyone
          twice only knows who Nora has contacted, so add the companies and people from your Expandi
          blacklist, and anyone mid-sequence, to Nora&rsquo;s exclusion list.
        </li>
        <li>
          <strong>Expect the ramp to start again.</strong> An account warmed up in Expandi still
          starts at {PUBLIC_LIMITS.invitesPerDayStart} invitations a day in Nora, because the warm-up
          counts from its first send through Nora.
        </li>
        <li>
          <strong>Approve one customer profile and check every note before launching.</strong>
        </li>
      </ol>
    </ArticleLayout>
  );
}
