import type { Metadata } from "next";
import Link from "next/link";
import { LINKEDIN_LIMITS } from "@le/shared";
import { ArticleLayout, articleMeta, CompareTable, type Faq, type Source } from "@/components/article";
import { PUBLIC_LIMITS } from "@/lib/site";
import { Glance, NORA, Verdict, NOT_DOCUMENTED, withGlanceSources, type GlanceTool } from "../_glance";

const PATH = "/alternatives/phantombuster";
export const metadata: Metadata = articleMeta(PATH);

const GLANCE: readonly GlanceTool[] = ["nora", "phantombuster", "waalaxy", "expandi", "heyreach", "dripify"];

const MIN_GAP_MIN = Math.round(LINKEDIN_LIMITS.minGapMs / 60_000);

const PB_PRICING = "https://phantombuster.com/blog/ai-automation/phantombuster-pricing-explained";
const PB_LIMITS = "https://phantombuster.com/blog/linkedin-automation/linkedin-automation-safe-limits-2026/";
const PB_COOKIE = "https://phantombuster.com/blog/linkedin-automation/linkedin-session-cookie-disconnected/";
const PB_SAFE = "https://phantombuster.com/blog/linkedin-automation/is-phantombuster-safe-for-linkedin-automation-prospecting";
const ZOOMINFO_REVIEW = "https://pipeline.zoominfo.com/sales/phantombuster-review";
const CLEVERLY_REVIEW = "https://www.cleverly.co/blog/phantombuster-review";
const DUX_COMPARE = "https://derrick-app.com/vs/dux-soup-vs-phantombuster-vs-derrick-app";
const LI_PROHIBITED = "https://www.linkedin.com/help/linkedin/answer/a1341387";
const LI_AGREEMENT = "https://www.linkedin.com/legal/user-agreement";

const FAQ: readonly Faq[] = [
  {
    q: "Is PhantomBuster safe for LinkedIn?",
    a: "No LinkedIn automation is fully safe, because LinkedIn's User Agreement prohibits automated access. PhantomBuster connects with your LinkedIn session cookie and leaves the volume largely to you, with pacing controls and suggested limits. Kept to modest volumes the risk is lower; several Phantoms running at high volume on one account raise it quickly.",
  },
  {
    q: "What is the best PhantomBuster alternative for outreach?",
    a: "If you need to extract data, PhantomBuster's real alternatives are other data and enrichment tools. If what you actually want is conversations on LinkedIn, an outreach tool is the better swap: a sequencer if you want to build campaigns yourself, or an AI SDR such as Nora if you want the people found, each one written to individually and the replies drafted, with you approving what goes out.",
  },
  {
    q: "Why did PhantomBuster change its pricing?",
    a: "We could not find a published reason. What changed, according to PhantomBuster's own pricing explainer as of October 2026: paid plans named Start, Grow and Scale at $69, $159 and $439 a month, cheaper on annual billing, each with a monthly pool of AI and email credits, and a Free plan cut to 30 minutes of execution time a month from July 2026. Older reviews quoting other plan names are out of date.",
  },
  {
    q: "Does Nora scrape LinkedIn?",
    a: "Nora is not a scraping tool. It has no extractor for followers, groups or post likers, sells no data and is not built to export lists. It searches LinkedIn through your connected account for the people a campaign you approved is looking for, one page at a time, and opens each profile to write the note. That is still automated access, so the same caution applies.",
  },
];

const SOURCES: readonly Source[] = withGlanceSources(
  [
    { label: "PhantomBuster: pricing explained, plans and credits (checked October 2026)", url: PB_PRICING },
    { label: "PhantomBuster: LinkedIn automation safe limits 2026", url: PB_LIMITS },
    { label: "PhantomBuster: fixing a disconnected LinkedIn session cookie", url: PB_COOKIE },
    { label: "PhantomBuster: is PhantomBuster safe for LinkedIn automation", url: PB_SAFE },
    { label: "ZoomInfo Pipeline: PhantomBuster review 2026", url: ZOOMINFO_REVIEW },
    { label: "Cleverly: PhantomBuster review, April 2026 (an agency in the same market)", url: CLEVERLY_REVIEW },
    { label: "Derrick: Dux-Soup vs PhantomBuster (a vendor in the same market)", url: DUX_COMPARE },
    { label: "LinkedIn Help: Prohibited software and extensions", url: LI_PROHIBITED },
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
      h1="PhantomBuster alternatives: for outreach, not scraping"
      lede="The best PhantomBuster alternative depends on the job. For extracting and enriching data, look at other data tools. For LinkedIn outreach that ends in conversations, a tool built around limits, personal notes and replies fits better: Nora finds people from a customer profile you approve, writes each one a note and drafts the replies for you to approve."
      faq={FAQ}
      sources={SOURCES}
    >
      <h2 id="short-answer">Nora or PhantomBuster: the short answer</h2>
      <Verdict
        rival="PhantomBuster"
        nora={["You want conversations with buyers, not rows of data.", "You want each note written from the person’s own profile, inside fixed daily and weekly caps.", "You want replies drafted for you and meetings booked."]}
        them={["You need structured data out of LinkedIn and other sites, on a schedule, into other tools.", "You enjoy building workflows and want control over every step.", "Outreach is handled elsewhere, and PhantomBuster feeds it."]}
      />

      <h2 id="at-a-glance">PhantomBuster alternatives at a glance</h2>
      <p>
        Six tools, most of them built for outreach rather than data, by who each suits, what it costs
        to start and what each publishes about LinkedIn volume.
      </p>
      <Glance tools={GLANCE} />

      <h2 id="why-alternative">Why people look for PhantomBuster alternatives</h2>
      <p>
        PhantomBuster is a capable, long-established automation platform, and for data work it is
        hard to beat. People looking for an alternative tend to have one of three reasons, and the
        right alternative depends on which one it is:
      </p>
      <ul>
        <li>
          <strong>They wanted outreach, not data.</strong> A search export, an auto-connect Phantom and
          a message sender chained together can send invitations, but writing to each person, handling
          replies and booking meetings is left to you or to other tools.
        </li>
        <li>
          <strong>Account safety.</strong> Phantoms act through your LinkedIn session cookie, at the
          volume you set. Running several on one account is an easy way to send far more than an
          account should.
        </li>
        <li>
          <strong>Price and complexity.</strong> Execution hours, slots and several kinds of credit
          take some learning, and the plans changed during 2026.
        </li>
      </ul>

      <h2 id="phantombuster-in-brief">PhantomBuster in brief, fairly</h2>
      <p>
        PhantomBuster runs pre-built automations called Phantoms in the cloud. Each takes an input,
        such as a LinkedIn or Sales Navigator search URL or a list of profiles, and returns structured
        output, and Phantoms can be chained into workflows. It covers LinkedIn, Sales Navigator and
        several other sites, and its output usually feeds a CRM or an email sequencer, as{" "}
        <Ext href={ZOOMINFO_REVIEW}>ZoomInfo&rsquo;s 2026 review</Ext> describes.
      </p>

      <h3 id="pb-who-it-suits">Who it suits</h3>
      <p>
        Growth and operations people who build their own pipelines: exporting search results,
        enriching lists, watching for new results on a schedule and pushing them into other tools.
        If you are comfortable designing workflows and want data across several platforms, it does
        that well.
      </p>

      <h3 id="pb-pricing">Pricing as of October 2026 (sourced)</h3>
      <p>
        PhantomBuster&rsquo;s own <Ext href={PB_PRICING}>pricing explainer</Ext> lists Start at $69 a
        month, Grow at $159 and Scale at $439, with roughly 20% off on annual billing. Each plan
        includes execution hours, Phantom slots and monthly pools of AI and email credits that reset
        each cycle rather than rolling over. The Free plan was reduced in July 2026 to 30 minutes of
        execution time a month and one slot. Some third-party pages still show older plan names and
        prices.
      </p>

      <h3 id="pb-limits">How it handles limits and warm-up</h3>
      <p>
        Volume is yours to set. PhantomBuster offers pacing controls, random breaks and scheduling
        within business hours, and its{" "}
        <Ext href={PB_LIMITS}>2026 safe-limits guide</Ext> suggests 15 to 25 connection requests a day
        for accounts older than 90 days, fewer for new ones, and keeping acceptance above 30%. Another
        of its posts uses 40% as the threshold, so check which advice is current. We could not
        find a published ceiling covering several Phantoms on one account, so if you run more than
        one, add their volumes up yourself.
      </p>

      <h2 id="side-by-side">Nora vs PhantomBuster: side by side</h2>
      <CompareTable
        caption="Nora compared with PhantomBuster, as of October 2026"
        columns={["Nora", "PhantomBuster"]}
        rows={[
          { label: "Built for", values: ["Conversations on LinkedIn that end in meetings", "Data extraction and workflow automation"] },
          { label: "Sites covered", values: ["LinkedIn only", "LinkedIn, Sales Navigator and several others"] },
          { label: "Who finds prospects", values: [NORA.prospects, "You, from a search URL or a list"] },
          { label: "Connection notes", values: [NORA.notes, "Your own message template"] },
          { label: "Human approval", values: [NORA.approval, "You build and run each Phantom"] },
          { label: "Daily invitations", values: [NORA.daily, "Set by you; 15 to 25 suggested for aged accounts"] },
          { label: "Weekly ceiling", values: [NORA.weekly, "Not published across several Phantoms"] },
          { label: "Never contacting anyone twice", values: [NORA.twice, "Up to how you build your workflows"] },
          { label: "Replies", values: [NORA.replies, "Not a reply inbox; output usually goes to other tools"] },
          { label: "Meeting booking", values: [NORA.booking, NOT_DOCUMENTED] },
        ]}
      />

      <h2 id="where-nora-differs">Where Nora differs from PhantomBuster</h2>
      <p>
        Where PhantomBuster starts from a search URL you bring, Nora starts from your website: it
        drafts customer profiles, searches only after you approve one, and opens each profile to write
        that person a note. <Link href="/how-it-works">How Nora works</Link> covers the rest, from
        follow-ups to booking.
      </p>
      <p>
        The difference that matters most against PhantomBuster is that the volume is not a setting
        per automation. In PhantomBuster each Phantom has its own schedule, so two of them on one
        account can each stay inside the suggested range while the account as a whole does not. In
        Nora the daily and weekly limits belong to the account and cover every campaign on it
        together, a day&rsquo;s allowance is spread across your working hours, and no two actions go
        out closer than {MIN_GAP_MIN} minutes apart. Nothing you configure can add a second stream of
        activity the caps do not see.
      </p>

      <h2 id="two-jobs">Two different jobs: scraping data versus having conversations</h2>
      <p>
        Most confusion around PhantomBuster alternatives comes from treating two jobs as one. Scraping
        is about volume and structure: get a thousand rows out of a search, enrich them, move them
        somewhere. Outreach is about the opposite: a small number of people a day, each written to
        as a person, and what happens after they reply.
      </p>
      <p>
        A tool built for the first measures success in rows, so volume is whatever you set. A tool
        built for the second caps volume and writes each note separately, because identical
        invitations sent at volume are how acceptance drops and accounts get restricted. If you used
        PhantomBuster to build lists that you then wrote to by hand, you may want both kinds of tool.
        If you used it to send invitations, you wanted an outreach tool all along. The legal side of
        scraping is covered in <Link href="/guides/is-linkedin-automation-legal">is LinkedIn automation legal</Link>.
      </p>

      <h2 id="cookies">Cookie-based sessions and suspension risk</h2>
      <p>
        PhantomBuster connects to LinkedIn with your session cookie, the <code>li_at</code> value your
        browser stores when you sign in, and asks you to{" "}
        <Ext href={PB_COOKIE}>paste a fresh one</Ext> when the session expires. That is not unsafe in
        itself, but it means LinkedIn sees your account acting from a server, at whatever volume the
        Phantoms are set to. LinkedIn&rsquo;s help center says accounts using{" "}
        <Ext href={LI_PROHIBITED}>third-party automation software</Ext> may be restricted, and its{" "}
        <Ext href={LI_AGREEMENT}>User Agreement</Ext> prohibits automated access, so cookie or not, the
        risk is real.
      </p>
      <p>
        Nora connects differently: you sign in on a hosted page, your LinkedIn password never reaches
        us, and the token that comes back is encrypted before it is stored. The{" "}
        <Link href="/security">security page</Link> has the details. That changes how your session is
        held, not LinkedIn&rsquo;s view of automation. What lowers the risk in practice is behavior,
        which our{" "}
        <Link href="/guides/cloud-vs-browser-extension-linkedin-automation">
          comparison of cloud and browser-extension automation
        </Link>{" "}
        goes into.
      </p>

      <h2 id="other-alternatives">Other alternatives worth a look</h2>
      <ul>
        <li>
          <strong>For data:</strong> enrichment and contact-data tools are the closer swap if what you
          need is rows, not conversations.
        </li>
        <li>
          <strong>Dux-Soup</strong>, a LinkedIn-focused tool that runs mainly as a browser extension
          with a cloud option, and is quicker to set up for standard outreach than chained Phantoms,
          according to <Ext href={DUX_COMPARE}>a vendor comparison</Ext>.
        </li>
        <li>
          <strong>LinkedIn sequencers</strong> such as Waalaxy, Expandi or HeyReach, if you want to
          build the campaigns yourself. See{" "}
          <Link href="/alternatives/waalaxy">Waalaxy compared with Nora</Link>,{" "}
          <Link href="/alternatives/expandi">Expandi compared</Link> and{" "}
          <Link href="/alternatives/heyreach">HeyReach compared</Link>.
        </li>
      </ul>
      <p>
        Every comparison is on the <Link href="/alternatives">LinkedIn automation tools</Link> page,
        and the <Link href="/guides/best-ai-sdr-for-linkedin">guide to choosing an AI SDR for LinkedIn</Link>{" "}
        lists the questions to ask any of them.
      </p>

      <h2 id="switching">Switching without contacting anyone twice</h2>
      <p>
        You can keep PhantomBuster for data while Nora handles the conversations. Either way, the
        history of who you contacted usually lives in exported sheets rather than in a campaign, so
        it is easy to leave behind.
      </p>
      <ol>
        <li>
          <strong>Turn off the scheduled launches of every Phantom that invites or messages</strong>{" "}
          from the account, such as an auto-connect or a message sender. Data Phantoms on the same
          account still act through it, so keep those light.
        </li>
        <li>
          <strong>Remove the session cookie from Phantoms you no longer need,</strong> so nothing else
          is acting as you once Nora is sending.
        </li>
        <li>
          <strong>Turn your exports into an exclusion list.</strong> Nora only knows who Nora has
          contacted. The people and companies in your sent-invitation sheets who must not hear from
          you again go on Nora&rsquo;s exclusion list.
        </li>
        <li>
          <strong>Connect the account and approve one customer profile.</strong> It starts at{" "}
          {PUBLIC_LIMITS.invitesPerDayStart} invitations a day whatever the Phantoms sent, because
          the warm-up counts from its first send through Nora.
        </li>
        <li>
          <strong>Read the notes, then launch.</strong> Nothing is sent until you do.
        </li>
      </ol>
    </ArticleLayout>
  );
}
