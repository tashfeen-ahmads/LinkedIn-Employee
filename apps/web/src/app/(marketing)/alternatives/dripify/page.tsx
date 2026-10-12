import type { Metadata } from "next";
import Link from "next/link";
import { INVITE_NOTE_MAX_CHARS, LINKEDIN_LIMITS, containsLink } from "@le/shared";
import { ArticleLayout, articleMeta, CompareTable, Callout, type Faq, type Source } from "@/components/article";
import { PUBLIC_LIMITS, SITE } from "@/lib/site";

const PATH = "/alternatives/dripify";
export const metadata: Metadata = articleMeta(PATH);

const FIRST_MESSAGE_MIN = Math.round(LINKEDIN_LIMITS.acceptFollowUpMinMs / 60_000);
const FIRST_MESSAGE_MAX = Math.round(LINKEDIN_LIMITS.acceptFollowUpMaxMs / 60_000);

/** Illustrations, invented for this page: no real person or company. */
const TEMPLATE_NOTE =
  "Hi {first_name}, I came across your profile and would love to connect and share how we help companies like {company} grow faster.";
const PERSONAL_NOTE =
  "Saw you went from field sales to running operations at a 40-person freight broker. Curious how carrier onboarding has held up since the team doubled?";
const PERSONAL_FITS = PERSONAL_NOTE.length <= INVITE_NOTE_MAX_CHARS && !containsLink(PERSONAL_NOTE);

const DRIPIFY_PRICING = "https://dripify.com/pricing/";
const DRIPIFY_LIMITS = "https://help.dripify.com/en/articles/8201637-how-dripify-daily-limits-safeguard-your-linkedin-account";
const DRIPIFY_FAQ = "https://dripify.io/faq/";
const DRIPIFY_DUPES = "https://help.dripify.com/en/articles/6367147-how-to-avoid-adding-the-same-leads-within-a-team";
const DRIPIFY_BLACKLIST = "https://help.dripify.com/en/articles/5029130-how-to-blacklist-certain-linkedin-users-in-dripify";
const DRIPIFY_FILTERS = "https://help.dripify.io/en/articles/11199236-step-2-how-to-manage-lead-list-filters";
const LEADHASTE = "https://leadhaste.com/blog/dripify-pricing-2026";
const VALLEY = "https://www.joinvalley.co/blog/dripify-pricing-explained-2026";
const LI_AGREEMENT = "https://www.linkedin.com/legal/user-agreement";
const LI_PROHIBITED = "https://www.linkedin.com/help/linkedin/answer/a1341387";

const FAQ: readonly Faq[] = [
  {
    q: "Is Dripify safe?",
    a: "No LinkedIn automation tool is fully safe, because LinkedIn's User Agreement prohibits automated access. Dripify runs in the cloud and applies daily limits, up to 75 connection requests a day with a random range you choose, according to its help center. That ceiling is well above where a new account should start, so the safety of your setup depends on the numbers you pick.",
  },
  {
    q: "Is there a free Dripify alternative?",
    a: "Yes. As of October 2026 Nora is free for every workspace while it grows, with no card, and the free version is the whole product: prospect search, a note written for each person, follow-ups, replies and booking, under the same caps for everyone. Dripify itself offers a 7-day trial rather than a permanent free plan.",
  },
  {
    q: "Is Dripify legit?",
    a: "Yes, in the sense that it is an established paid product with published plans, a public help center and documented features. Being a real product is a different question from being allowed: LinkedIn's terms prohibit third-party automation, so using Dripify, or any tool on this page, carries some risk of an account restriction.",
  },
  {
    q: "Is Dripify better than Waalaxy?",
    a: "They suit different people. Dripify is priced per user from $59 a month and is built for drip sequences with team features on its top plan. Waalaxy is quicker to start with ready-made campaigns and lists lower prices, though sources disagree on its exact figures. If you want neither builder, an AI SDR such as Nora does the targeting and writing for you.",
  },
  {
    q: "Can Dripify get you banned?",
    a: "Any automation can lead to a restriction, because LinkedIn's terms prohibit it and LinkedIn does not publish its limits. LinkedIn's help center says it asks the member to disable the software, and re-enables the account at the time stated in the restriction notice. The risk rises with volume, sudden jumps and low acceptance, so keep a new account well under Dripify's maximum and ramp it slowly.",
  },
];

const SOURCES: readonly Source[] = [
  { label: "Dripify: pricing page", url: DRIPIFY_PRICING },
  { label: "LeadHaste: Dripify pricing 2026, plans from $39 to $99", url: LEADHASTE },
  { label: "Valley: Dripify pricing explained 2026 (a vendor in the same market)", url: VALLEY },
  { label: "Dripify help center: how daily limits safeguard your account (checked October 2026)", url: DRIPIFY_LIMITS },
  { label: "Dripify FAQ: connection request cap", url: DRIPIFY_FAQ },
  { label: "Dripify help center: avoiding the same leads within a team", url: DRIPIFY_DUPES },
  { label: "Dripify help center: lead list filters", url: DRIPIFY_FILTERS },
  { label: "Dripify help center: blacklisting LinkedIn users", url: DRIPIFY_BLACKLIST },
  { label: "LinkedIn Help: Prohibited software and extensions", url: LI_PROHIBITED },
  { label: "LinkedIn Help: Automated activity on LinkedIn", url: "https://www.linkedin.com/help/linkedin/answer/90586" },
  { label: "LinkedIn User Agreement", url: LI_AGREEMENT },
  { label: "Salesforge: Dripify alternatives (a competitor, studied for this page)", url: "https://www.salesforge.ai/fr/blog/dripify-alternatives" },
  { label: "Expandi: a guide to Dripify alternatives (a competitor, studied for this page)", url: "https://expandi.io/?p=7876" },
  { label: "La Growth Machine: best Dripify alternatives (a competitor, studied for this page)", url: "https://lagrowthmachine.com/de/beste-dripify-alternativen/" },
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
      h1="Dripify alternatives: personal notes, human approval, no per-seat bill"
      lede="The right Dripify alternatives depend on whether you want a better sequence builder or less building: for LinkedIn and email drips with team dashboards, another sequence tool is the closer swap, while an AI SDR such as Nora finds the prospects, writes each note and answers replies after a person approves the strategy, the copy and the launch. Nora is free while it grows, so there is no bill per seat."
      faq={FAQ}
      sources={SOURCES}
    >
      <CompareTable
        caption="In short: Dripify and Nora, as of October 2026"
        columns={["Dripify", "Nora"]}
        rows={[
          { label: "What it is", values: ["A cloud drip sequence builder", "An AI SDR you approve"] },
          { label: "Price", values: ["$59 to $99 per user a month; 7-day trial", "Free while it grows, no card"] },
          { label: "Messages", values: ["Templates with variables", "A note written for each person"] },
          { label: "Email steps", values: ["Yes, with an email finder", "No, LinkedIn only"] },
        ]}
      />

      <h2 id="why-alternative">Why people look for a Dripify alternative</h2>
      <p>
        Dripify suits people who like to design a sequence once and let it run. The pages ranking for
        this search are mostly written by competitors ranking themselves, and they rarely mention
        LinkedIn safety at all. The usual reasons to look elsewhere are simpler:
      </p>
      <ul>
        <li>
          <strong>The bill grows with the team.</strong> Every user is a seat, so testing LinkedIn
          with three people costs three times as much.
        </li>
        <li>
          <strong>Templates read like templates.</strong> Variables fill in a name and a company; the
          sentence around them is the same for everyone.
        </li>
        <li>
          <strong>The work around the sequence.</strong> Finding the right people, writing copy and
          answering replies still sit with you.
        </li>
      </ul>

      <h2 id="dripify-in-brief">Dripify in brief, fairly</h2>
      <p>
        Dripify is a cloud drip campaign tool for LinkedIn. You build a sequence of actions, profile
        views, invitations, messages, with conditions that send each lead down a different path, and
        add email steps with its built-in email finder. Campaigns run on its servers, so nothing
        depends on your browser being open.
      </p>

      <h3 id="who-it-suits">Who it suits</h3>
      <p>
        Sales teams who want to design their own LinkedIn and email drips and manage several reps with
        roles and shared templates. It fits a team that already knows who it is targeting and what it
        wants to say.
      </p>

      <h3 id="pricing">Pricing as of October 2026 (sourced)</h3>
      <p>
        Sources agree on the list prices: Basic, Pro and Advanced at{" "}
        <Ext href={LEADHASTE}>$59, $79 and $99 per user a month</Ext> on monthly billing, or $39, $59
        and $79 billed annually, with a custom Enterprise plan and a 7-day trial rather than a free
        plan. Basic is limited to one drip campaign, Pro removes that limit, and Advanced adds team
        management and lead tagging. Sources disagree on which tier includes A/B testing, and{" "}
        <Ext href={VALLEY}>one notes</Ext> the plan cards changed in September 2026, so check{" "}
        <Ext href={DRIPIFY_PRICING}>the live pricing page</Ext>.
      </p>

      <h3 id="limits">How it handles limits and warm-up</h3>
      <p>
        Dripify&rsquo;s <Ext href={DRIPIFY_LIMITS}>help center</Ext> describes daily limits that vary
        by account type, up to 75 connection requests a day for Sales Navigator accounts, with a
        range setting that randomises each day&rsquo;s number around the one you choose. Its{" "}
        <Ext href={DRIPIFY_FAQ}>FAQ</Ext> calls 75 a hard ceiling. We could not find a weekly ceiling
        or an automatic warm-up ramp. To avoid double contact, lead list filters can{" "}
        <Ext href={DRIPIFY_FILTERS}>skip leads already in other campaigns</Ext>, a team setting can{" "}
        <Ext href={DRIPIFY_DUPES}>skip teammates&rsquo; leads</Ext>, and you can{" "}
        <Ext href={DRIPIFY_BLACKLIST}>blacklist individual people</Ext>.
      </p>

      <h2 id="side-by-side">Nora vs Dripify: side by side</h2>
      <CompareTable
        caption="Nora compared with Dripify, as of October 2026"
        columns={["Nora", "Dripify"]}
        rows={[
          { label: "Who builds the campaign", values: ["The agent drafts it; you approve and launch", "You design the drip"] },
          { label: "Who finds prospects", values: ["The agent, from a customer profile you approved", "You, from searches or imported lists"] },
          {
            label: "Connection notes",
            values: [`Written per person, under ${INVITE_NOTE_MAX_CHARS} characters, never with a link`, "Templates with variables"],
          },
          {
            label: "Daily invitations",
            values: [
              `${PUBLIC_LIMITS.invitesPerDayStart} rising to ${PUBLIC_LIMITS.invitesPerDayMax} from the first send; can only be lowered`,
              "Up to 75, with a random range",
            ],
          },
          { label: "Weekly ceiling", values: [`${PUBLIC_LIMITS.invitesPerWeek}, across all campaigns`, "Not published"] },
          { label: "Not contacting anyone twice", values: ["Always on, checked before each send", "Filters and a blacklist you apply"] },
          { label: "Replies", values: ["Answered from your documents under your rules, or held", "Inbox; you reply"] },
          { label: "Meeting booking", values: ["Booking page or your own scheduling link", "Not covered by the sources we checked"] },
          { label: "Team roles", values: ["Owner, admin, manager and rep in one workspace", "Team management on Advanced"] },
          { label: "Price", values: ["Free while it grows, no seats", "$59 to $99 per user a month"] },
        ]}
      />

      <h3 id="finding-prospects">Finding prospects</h3>
      <p>
        Nora reads your website and proposes three to five customer profiles, and searches for nobody
        until a person approves one. It searches on the LinkedIn tier your account has, and any filter
        that tier cannot apply is named on the campaign before launch rather than silently dropped. It
        opens each profile before it reaches the list, and leaves out anyone your workspace has
        already contacted.
      </p>

      <h3 id="writing-notes">Writing notes</h3>
      <p>
        Every note is written for one person from their own headline, role and company, and the review
        screen shows which details it used. A note containing a link is sent with no note at all,
        because links in invitations cut acceptance. The section below shows the difference.
      </p>

      <h3 id="replies-booking">Replies and booking</h3>
      <p>
        Nora checks for acceptances through the day and sends the first message {FIRST_MESSAGE_MIN} to{" "}
        {FIRST_MESSAGE_MAX} minutes after it notices one, inside your working hours; later follow-ups
        keep the delays you set. Replies are answered only from the documents you gave it. Pricing,
        legal and negative replies wait for you unless you choose otherwise, and a prospect who asks
        for a person always waits. Meetings are offered from its booking page or through your own
        scheduling link.
      </p>

      <h3 id="safety">Safety guardrails</h3>
      <p>
        You approve three things before anything reaches a real person: the strategy, the copy and
        the launch. A campaign is a draft until you press the button, and nobody, including our own
        support, can launch it for you. The caps are product rules, an owner can lower them, and the
        ramp runs about {PUBLIC_LIMITS.warmupWeeks} weeks from an account&rsquo;s first send. An
        opt-out is matched by a fixed rule as well as by the model.
      </p>

      <h3 id="price">Price</h3>
      <p>
        Nora has no seats to buy. Each teammate connects their own LinkedIn account, each account
        keeps its own caps, and the workspace is free while Nora grows. Details are on{" "}
        <Link href="/pricing">the pricing page</Link>.
      </p>

      <h2 id="templates-vs-notes">Templates versus a note written for each person</h2>
      <p>
        A template with variables is efficient, and the person receiving it can tell. Here is a
        typical one, of the kind most sequence tools start you with:
      </p>
      <blockquote>
        <p>{TEMPLATE_NOTE}</p>
      </blockquote>
      <p>
        Every word outside the braces is identical for every recipient. Compare a note written from
        one person&rsquo;s profile, invented for this page:
      </p>
      <blockquote>
        <p>{PERSONAL_NOTE}</p>
      </blockquote>
      <p>
        It is {PERSONAL_NOTE.length} characters
        {PERSONAL_FITS ? `, inside the ${INVITE_NOTE_MAX_CHARS}-character limit Nora writes to, with no link` : null}
        . It names two things about the person, a career move and the size of the team, and asks one
        question about their work rather than pitching. That is what Nora writes for every prospect,
        and the review screen lists the details each note used, so you can check that it is
        personal rather than take it on trust. A note that used none is reported, not hidden.
      </p>
      <p>
        This also changes what testing means. Comparing two fixed phrasings tells you little when
        every note is different, so Nora tests angles instead: the pain a note names, or the reason
        for reaching out. People are split evenly, each angle keeps its own follow-ups, and no angle
        is called behind until another's whole confidence range sits above its own. Our guide to{" "}
        <Link href="/guides/ai-personalized-linkedin-messages">AI personalized LinkedIn messages</Link>{" "}
        covers how to check personalisation in any tool.
      </p>
      <Callout tone="safety">
        <p>
          LinkedIn&rsquo;s <Ext href={LI_AGREEMENT}>User Agreement</Ext> prohibits automated access. No
          tool can promise zero risk, and neither do we. Conservative caps and notes people actually
          accept are what reduce it.
        </p>
      </Callout>

      <h2 id="other-alternatives">Other Dripify alternatives worth a look</h2>
      <ul>
        <li>
          <strong>Waalaxy</strong>, the usual &ldquo;Waalaxy vs Dripify&rdquo; comparison: ready-made
          campaigns and lower listed prices. See <Link href="/alternatives/waalaxy">Waalaxy compared</Link>.
        </li>
        <li>
          <strong>Expandi</strong>, for branching LinkedIn and email sequences priced per account. See{" "}
          <Link href="/alternatives/expandi">Expandi compared</Link>.
        </li>
        <li>
          <strong>HeyReach</strong>, if you run many sender accounts for clients. See{" "}
          <Link href="/alternatives/heyreach">HeyReach compared</Link>.
        </li>
      </ul>
      <p>
        All of them by published caps and dated price are on{" "}
        <Link href="/alternatives">the LinkedIn automation tools comparison</Link>, and the{" "}
        <Link href="/guides/best-ai-sdr-for-linkedin">guide to choosing an AI SDR for LinkedIn</Link>{" "}
        lists the questions to ask any vendor, ours included.
      </p>

      <h2 id="stay-with-dripify">Who should stay with Dripify</h2>
      <ul>
        <li>You want LinkedIn and email steps in one drip, with an email finder.</li>
        <li>You manage several sales teams and need dashboards and permissions per team.</li>
        <li>You have your lists and copy, and want a cloud sender that runs your sequence as built.</li>
      </ul>
      <p>
        If instead you want the targeting, writing and replies done with your approval on each, read{" "}
        <Link href="/how-it-works">how Nora works</Link> or{" "}
        <a href={`${SITE.app}/signup`}>Sign up free</a>.
      </p>
    </ArticleLayout>
  );
}
