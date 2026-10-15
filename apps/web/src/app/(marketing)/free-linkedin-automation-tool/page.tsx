import type { Metadata } from "next";
import Link from "next/link";
import { INVITE_NOTE_MAX_CHARS, alwaysHoldsSentence } from "@le/shared";
import { ArticleLayout, Callout, CompareTable, articleMeta, type Faq, type Source } from "@/components/article";
import { SoftwareSchema } from "@/components/schema";
import { AudStats, AudSteps } from "@/components/seo/aud-blocks";
import { PUBLIC_LIMITS } from "@/lib/site";

const PATH = "/free-linkedin-automation-tool";

export const metadata: Metadata = articleMeta(PATH);

const WAALAXY_CLOUD = "https://intercom.help/waalaxy/en/articles/15587366-waalaxy-is-now-fully-cloud-based";
const WAALAXY_REVIEW = "https://www.supered.io/blog/waalaxy-pricing/";
const HEYREACH_TRIAL = "https://help.heyreach.io/en/articles/10462548-how-to-register-for-a-free-trial-account";
const DRIPIFY_PRICE = "https://leadhaste.com/blog/dripify-pricing-2026";
const EXPANDI_PRICE = "https://derrick-app.com/en/pricing-expandi-2/";
const PB_PRICING = "https://phantombuster.com/blog/ai-automation/phantombuster-pricing-explained";
const LI_AGREEMENT = "https://www.linkedin.com/legal/user-agreement";
const LI_PROHIBITED = "https://www.linkedin.com/help/linkedin/answer/a1341387";

const FAQ: readonly Faq[] = [
  {
    q: "Is there a free LinkedIn automation tool?",
    a: "Yes, but few run real campaigns for free. Most tools offer a trial of 7 to 14 days, or a free tier that lets you look around while sending is paid. As of October 2026 Nora is free while we grow, for every workspace, with no trial clock, no card and the whole product: prospect search, a note for each person, follow-ups, replies and booking.",
  },
  {
    q: "Are free LinkedIn automation tools safe?",
    a: "Price has nothing to do with it; behavior does. LinkedIn's User Agreement prohibits automated access, so no tool, free or paid, can promise zero risk. What lowers the risk is a slow ramp, a weekly ceiling, a day's sends spread across the day, personal notes and good targeting. Be most careful with old browser extensions that are no longer updated.",
  },
  {
    q: "Is Waalaxy free?",
    a: "Not for sending, as of October 2026. Waalaxy's help center says you can browse the app on any plan, but importing prospects and launching campaigns needs a paid subscription, and reviews disagree on whether a free tier still exists. Its paid plans include a 14-day trial. Our Waalaxy comparison page sets out what each source says.",
  },
  {
    q: "What is the cheapest safe LinkedIn automation?",
    a: `The cheapest is free, and Nora is free while we grow. What makes it safe is not the price but the guardrails: every workspace gets the same caps, starting at ${PUBLIC_LIMITS.invitesPerDayStart} invitations a day from the first send, a weekly ceiling of ${PUBLIC_LIMITS.invitesPerWeek} across all campaigns, and approval before launch. A paid tool with a higher ceiling is not safer for costing more.`,
  },
  {
    q: "Do I need a credit card?",
    a: "No. You sign up, connect your LinkedIn account and start, with no card and no plan to choose. If Nora ever stops being free, you will hear it from us well before it does, and an owner or admin can export the whole workspace at any time.",
  },
];

const SOURCES: readonly Source[] = [
  { label: "Waalaxy help center: Waalaxy is now fully cloud-based, paid plan needed to launch (checked October 2026)", url: WAALAXY_CLOUD },
  { label: "Supered: Waalaxy pricing 2026, reviewed October 2, 2026", url: WAALAXY_REVIEW },
  { label: "HeyReach help center: registering for a free trial", url: HEYREACH_TRIAL },
  { label: "LeadHaste: Dripify pricing 2026, 7-day trial", url: DRIPIFY_PRICE },
  { label: "Derrick: Expandi pricing 2026, 7-day trial (a vendor in the same market)", url: EXPANDI_PRICE },
  { label: "PhantomBuster: pricing explained, including the free plan (2026)", url: PB_PRICING },
  { label: "LinkedIn Help: Prohibited software and extensions", url: LI_PROHIBITED },
  { label: "LinkedIn User Agreement", url: LI_AGREEMENT },
];

function Ext({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a className="free-src" href={href} rel="noopener nofollow" target="_blank">
      {children}
    </a>
  );
}

export default function Page() {
  return (
    <ArticleLayout
      path={PATH}
      h1="A free LinkedIn automation tool that runs real campaigns"
      lede={`Nora is a free LinkedIn automation tool that runs whole campaigns: it finds your buyers, writes each one a personal note, follows up, drafts your replies and books meetings, with no card and no trial clock. Free while we grow. The sending limits are set for your account's safety and are the same for every workspace, so free never means a smaller quota.`}
      faq={FAQ}
      sources={SOURCES}
    >
      <SoftwareSchema />
      <AudSteps
        id="decisions"
        title="Three decisions stay yours"
        intro="Everything else runs without you, apart from the replies, which come to you as drafts until you switch on autopilot."
        notes={[
          "Who to go after and why they would care. Nora writes the strategies and approves none.",
          "The opener and the offer, one line at a time, before anyone reads them.",
          "The list and the notes are in front of you. Nothing is sent before you press Launch.",
        ]}
      />

      <h2 id="what-is-free">What you get for free</h2>
      <p>
        All of it, for every workspace. There is no free tier with the useful parts held back,
        because there is no paid tier to hold them for.
      </p>
      <ul className="free-grid">
        <li>
          <strong>Strategy</strong>
          <span>Nora reads your website and writes a business profile and three
          to five customer strategies, and more when you ask.</span>
        </li>
        <li>
          <strong>Prospecting</strong>
          <span>It searches LinkedIn on the tier your account has, checks every
          profile can be opened, and scores each person against the strategy that found them.</span>
        </li>
        <li>
          <strong>Personal notes</strong>
          <span>One connection note per person, written from their own
          headline, role and company, capped at {INVITE_NOTE_MAX_CHARS} characters and never carrying
          a link.</span>
        </li>
        <li>
          <strong>Follow-ups and replies</strong>
          <span>Follow-ups after an acceptance, and a reply drafted
          from your own documents for each answer, for you to approve. Switch on autopilot and clean
          replies go out on their own; pricing, legal and negative replies are still held for you by
          default. {alwaysHoldsSentence()}</span>
        </li>
        <li>
          <strong>Meetings</strong>
          <span>A booking page that offers only times you have not booked or
          blocked out, or your own scheduling link.</span>
        </li>
        <li>
          <strong>Testing and reporting</strong>
          <span>Angles tested against each other with even groups,
          and a funnel from invitation to meeting.</span>
        </li>
      </ul>
      <p>
        Nora works with any LinkedIn account. Sales Navigator, which LinkedIn sells separately, makes
        the search more precise; without it, each campaign tells you which filters could not be
        applied before you launch. The detail is on{" "}
        <Link href="/how-it-works">how an AI SDR for LinkedIn works</Link>.
      </p>

      <h2 id="trials">Why most &lsquo;free&rsquo; LinkedIn automation tools are trials</h2>
      <p>
        Search for a free LinkedIn automation tool and most of what comes back is one of three
        things. Listicles that count a 7-day trial as free. Freemium plans where the free part is
        the dashboard and the sending is paid. And browser extensions, which vary widely in how
        recently anyone has updated them, so check the last update date before you install one.
      </p>
      <p>
        A trial is a fair way to sell software. It is a poor way to judge LinkedIn outreach, for one
        reason: a careful account ramps up over weeks. A 7 or 14-day trial ends while the account is
        still sending a fraction of what it eventually will, so you are judging the tool on its
        slowest days, or tempted to skip the ramp to see results before the trial runs out. That
        second temptation is how accounts get restricted.
      </p>

      <h2 id="same-caps">Free and safe: the same caps for everyone</h2>
      <p>
        Every workspace gets the same limits, and they are not for sale. They are enforced in code
        immediately before each send, and an owner can lower them for an account or a campaign but
        nobody can raise them.
      </p>
      <AudStats
        label="Sending limits for every Nora workspace"
        items={[
          { value: PUBLIC_LIMITS.invitesPerDayStart, label: "Invitations a day at the first send" },
          { value: PUBLIC_LIMITS.invitesPerDayMax, label: "A day after the warm-up" },
          { value: `${PUBLIC_LIMITS.warmupWeeks} weeks`, label: "Warm-up, from the first send" },
          { value: PUBLIC_LIMITS.invitesPerWeek, label: "A week, all campaigns" },
          { value: PUBLIC_LIMITS.messagesPerDay, label: "Messages a day" },
          { value: `${PUBLIC_LIMITS.healthyAcceptance}%`, label: "Acceptance floor before a warning" },
        ]}
      />
      <p>
        LinkedIn does not publish its limits. What it clearly watches is sudden change and people
        ignoring you. So the ramp starts at an account&rsquo;s first send rather than the day you
        connected it, the week has a ceiling across every campaign, invitations are spread across your
        working hours, and you are told when acceptance drops, because low acceptance is usually a
        targeting problem that more volume makes worse. The{" "}
        <Link href="/linkedin-automation-limits">LinkedIn automation limits page</Link> explains each
        number, and the <Link href="/tools/linkedin-limit-calculator">LinkedIn limit calculator</Link>{" "}
        shows what your own account can send today.
      </p>
      <Callout tone="safety">
        <strong>Honest about risk.</strong> LinkedIn&rsquo;s <Ext href={LI_AGREEMENT}>User Agreement</Ext>{" "}
        prohibits automated access. These limits lower the risk; they do not remove it, and no tool can
        promise that they do.
      </Callout>

      <h2 id="free-tiers-elsewhere">How it compares with free tiers elsewhere</h2>
      <p>
        These are the free options other LinkedIn tools publish, as of October 2026, from their own
        help centers or dated reviews linked in the sources.
      </p>
      <CompareTable
        caption="Free plans and trials for LinkedIn automation tools, as of October 2026"
        columns={["What is free", "Can you send for free?"]}
        rows={[
          { label: "Nora", values: ["The whole product, no trial clock, no card", "Yes, under the same caps as everyone"] },
          {
            label: "Waalaxy",
            values: [
              <>
                Browsing on any plan; 14-day trial of paid plans (<Ext href={WAALAXY_CLOUD}>help center</Ext>)
              </>,
              "Importing and launching need a paid plan",
            ],
          },
          {
            label: "HeyReach",
            values: [
              <>
                14-day trial, no card (<Ext href={HEYREACH_TRIAL}>help center</Ext>)
              </>,
              "During the trial",
            ],
          },
          {
            label: "Dripify",
            values: [
              <>
                7-day trial, no permanent free plan (<Ext href={DRIPIFY_PRICE}>review</Ext>)
              </>,
              "During the trial",
            ],
          },
          {
            label: "Expandi",
            values: [
              <>
                7-day trial reported (<Ext href={EXPANDI_PRICE}>review</Ext>)
              </>,
              "During the trial",
            ],
          },
          {
            label: "PhantomBuster",
            values: [
              <>
                Free plan with 30 minutes of run time a month and one slot (<Ext href={PB_PRICING}>pricing explainer</Ext>)
              </>,
              "A little, within those minutes",
            ],
          },
        ]}
      />
      <p>
        When you compare any free option, five questions tell you what you are getting. Does it send
        at a useful pace? Are its limits about safety or about the upgrade? Who writes the notes, and
        is it more than a first name in a template? What happens after someone replies? And does the
        free period outlast a careful warm-up of about {PUBLIC_LIMITS.warmupWeeks} weeks? For
        tool-by-tool detail, see the{" "}
        <Link href="/alternatives/waalaxy">Waalaxy alternatives comparison</Link> and{" "}
        <Link href="/alternatives">every LinkedIn automation tool compared on safety and price</Link>.
      </p>

      <h2 id="who-it-suits">Who it suits: founders and small teams</h2>
      <p>
        Nora is built for people who sell for themselves and do not have time to run outreach: a
        founder doing early sales, a consultant whose next client is on LinkedIn, a small team where
        everyone sends from their own profile. For a small business choosing the best LinkedIn
        automation tool, the deciding question is whose account does the sending. When it is the
        owner&rsquo;s own, the caps protect it by default, and nothing goes out under the owner&rsquo;s
        name from a strategy or copy they have not approved.
      </p>
      <p>
        It is the wrong tool if you need LinkedIn and email in one sequence, many sender accounts
        rotating through one campaign, or volumes above the caps on this page. See{" "}
        <Link href="/for/small-business">LinkedIn lead generation for small business</Link>, and the{" "}
        <Link href="/guides/best-ai-sdr-for-linkedin">guide to choosing an AI SDR for LinkedIn</Link>{" "}
        for the questions to ask any vendor. <Link href="/pricing">The pricing page</Link> says what
        happens if free ever ends.
      </p>
    </ArticleLayout>
  );
}
