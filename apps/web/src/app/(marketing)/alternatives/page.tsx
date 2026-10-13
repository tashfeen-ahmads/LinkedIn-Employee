import type { Metadata } from "next";
import Link from "next/link";
import { INVITE_NOTE_MAX_CHARS } from "@le/shared";
import { HubLayout, hubMeta, CompareTable, Callout, type Faq, type Source } from "@/components/article";
import { FaqSchema } from "@/components/schema";
import { PUBLIC_LIMITS } from "@/lib/site";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = hubMeta("alternative");

/** The day every vendor figure below was last checked. Change it only when they are re-checked. */
const CHECKED = "2026-10-12";

const LI_PROHIBITED = "https://www.linkedin.com/help/linkedin/answer/a1341387";
const LI_AGREEMENT = "https://www.linkedin.com/legal/user-agreement";
const HEYREACH_LIMITS = "https://help.heyreach.io/en/articles/15128619-how-do-connection-request-limits-work-in-heyreach";
const HEYREACH_EXCLUDE = "https://help.heyreach.io/en/articles/9877952-how-to-launch-your-first-campaign";
const HEYREACH_PRICE = "https://overloop.com/blog/heyreach-review";
const WAALAXY_LIMITS = "https://blog.waalaxy.com/en/what-is-the-linkedin-maximum-connections-per-day/";
const WAALAXY_CLOUD = "https://intercom.help/waalaxy/en/articles/15587366-waalaxy-is-now-fully-cloud-based";
const WAALAXY_BLACKLIST = "https://blog.waalaxy.com/en/how-to-create-a-blacklist-with-prospectin/";
const WAALAXY_PRICE = "https://www.supered.io/blog/waalaxy-pricing/";
const EXPANDI_LIMITS = "https://help.expandi.io/en/articles/9688856-recommended-limits";
const EXPANDI_WARMUP = "https://help.expandi.io/en/articles/5405001-account-warm-up";
const EXPANDI_BLACKLIST = "https://help.expandi.io/en/articles/5405272-blacklists";
const EXPANDI_PRICE = "https://derrick-app.com/en/pricing-expandi-2/";
const DRIPIFY_LIMITS = "https://help.dripify.com/en/articles/8201637-how-dripify-daily-limits-safeguard-your-linkedin-account";
const DRIPIFY_DUPES = "https://help.dripify.com/en/articles/6367147-how-to-avoid-adding-the-same-leads-within-a-team";
const DRIPIFY_PRICE = "https://leadhaste.com/blog/dripify-pricing-2026";
const PB_PRICING = "https://phantombuster.com/blog/ai-automation/phantombuster-pricing-explained";
const PB_LIMITS = "https://phantombuster.com/blog/linkedin-automation/linkedin-automation-safe-limits-2026/";
const ARTISAN_PRICE = "https://www.11x.ai/guides/artisan-pricing";

const FAQ: readonly Faq[] = [
  {
    q: "What is the best LinkedIn automation tool?",
    a: "There is no single best one, because the tools do different jobs. Agencies running many sender accounts want a multi-sender platform such as HeyReach. People who design their own LinkedIn and email sequences want Expandi or Dripify. Scrapers want PhantomBuster. A founder who wants the prospecting, the writing and the reply drafts done, with a person approving each stage, wants an AI SDR such as Nora.",
  },
  {
    q: "Which LinkedIn automation tool is safest?",
    a: "No independent body measures it, and every ranking you will find is written by a vendor, this one included. Compare what each tool enforces: a daily cap it will not let you exceed, a weekly ceiling across campaigns, a warm-up that starts at the first send, a rule against contacting anyone twice, and an approval step before launch. The table on this page shows who publishes what.",
  },
  {
    q: "What is the cheapest LinkedIn automation tool?",
    a: "As of October 2026, Nora is free while we grow, with no card. Among paid tools in the table, the lowest listed entry prices are Waalaxy's, though sources disagree on its exact figures and on whether its free plan still runs campaigns. Per-seat tools such as Dripify, Expandi and HeyReach run from $59 to $99 a month per user or sender on monthly billing.",
  },
  {
    q: "Is LinkedIn automation legal?",
    a: "Using an automation tool is generally a breach of LinkedIn's User Agreement, which prohibits bots and automated access, rather than a crime. The usual consequence is an account restriction, not a lawsuit against the user. Data protection law such as GDPR still applies to how you store and contact people. Our guide on whether LinkedIn automation is legal covers the detail; it is not legal advice.",
  },
];

const SOURCES: readonly Source[] = [
  { label: "LinkedIn Help: Prohibited software and extensions", url: LI_PROHIBITED },
  { label: "LinkedIn User Agreement", url: LI_AGREEMENT },
  { label: "HeyReach help center: how connection request limits work (checked October 2026)", url: HEYREACH_LIMITS },
  { label: "HeyReach help center: launching a campaign, with exclusion filters", url: HEYREACH_EXCLUDE },
  { label: "Overloop: HeyReach review 2026, pricing tiers (a competitor, which it discloses)", url: HEYREACH_PRICE },
  { label: "Waalaxy blog: LinkedIn maximum connections per day", url: WAALAXY_LIMITS },
  { label: "Waalaxy help center: Waalaxy is now fully cloud-based", url: WAALAXY_CLOUD },
  { label: "Waalaxy blog: how to create a blacklist", url: WAALAXY_BLACKLIST },
  { label: "Supered: Waalaxy pricing 2026, reviewed October 2, 2026", url: WAALAXY_PRICE },
  { label: "Expandi help center: recommended limits", url: EXPANDI_LIMITS },
  { label: "Expandi help center: account warm-up", url: EXPANDI_WARMUP },
  { label: "Expandi help center: blacklists", url: EXPANDI_BLACKLIST },
  { label: "Derrick: Expandi pricing 2026 (a vendor in the same market)", url: EXPANDI_PRICE },
  { label: "Dripify help center: how daily limits safeguard your account", url: DRIPIFY_LIMITS },
  { label: "Dripify help center: avoiding the same leads within a team", url: DRIPIFY_DUPES },
  { label: "LeadHaste: Dripify pricing 2026", url: DRIPIFY_PRICE },
  { label: "PhantomBuster: pricing explained (2026)", url: PB_PRICING },
  { label: "PhantomBuster: LinkedIn automation safe limits 2026", url: PB_LIMITS },
  { label: "11x: Artisan pricing guide (a competitor of Artisan)", url: ARTISAN_PRICE },
];

function Ext({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} rel="noopener nofollow" target="_blank">
      {children}
    </a>
  );
}

/** A source named inside a table cell: a small tag with a thumb-sized target, not a word of the sentence. */
function Src({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a className="alt-src" href={href} rel="noopener nofollow" target="_blank">
      {children}
    </a>
  );
}

export default function Page() {
  return (
    <>
      <FaqSchema items={FAQ} />
      <HubLayout kind="alternative">
        <div className="hub-body article-body">
          <p>
            LinkedIn automation tools all send invitations and messages for you; what separates them
            is what they refuse to do. Most comparisons rank features. This one compares the
            guardrails each vendor publishes, the daily and weekly caps, the warm-up, the
            do-not-contact rules, and the price on a stated date, because those decide whether the
            account doing the sending is still working in three months.
          </p>

          <h2 id="how-we-compared">How we compared (and what we could not verify)</h2>
          <p>
            Every figure for another vendor comes from that vendor&rsquo;s own help center or blog,
            or, for prices we could not read first-hand, from dated third-party reviews, each linked
            in the sources. We checked all of them on{" "}
            <time dateTime={CHECKED}>{formatDate(CHECKED)}</time>. We did not run test campaigns
            through competitors&rsquo; products, so this is a comparison of what each publishes, not
            of what each does under load. &ldquo;Not published&rdquo; means we could not find it, not
            that it does not exist.
          </p>
          <p>
            Two warnings before the table. Vendors&rsquo; own pages often disagree with each other,
            and where they do we say so rather than pick the flattering number. And we make one of
            the products in the table. Nora&rsquo;s figures are not typed into this page: they are
            read from the same rules the product enforces when it sends, so this page cannot quote a
            number the product does not keep.
          </p>
          <div className="alt-hub-note">
            <Callout tone="safety">
              <p>
                LinkedIn&rsquo;s <Ext href={LI_AGREEMENT}>User Agreement</Ext> prohibits automated
                access, and its <Ext href={LI_PROHIBITED}>help center</Ext> says accounts using
                third-party automation can be restricted. No tool in this table, Nora included, can
                promise an account will never be restricted.
              </p>
            </Callout>
          </div>

        </div>

        <div className="article-body">
          <h2 id="comparison-table">The comparison table</h2>
          <div className="alt-table">
            <CompareTable
              caption={`LinkedIn automation tools by published guardrails and price, checked ${formatDate(CHECKED)}`}
              columns={["Daily and weekly caps", "Warm-up and pacing", "Do-not-contact rules", "Price (monthly billing)"]}
              rows={[
                {
                  label: "Nora",
                  values: [
                    <span key="nora" className="alt-nora">
                      {`${PUBLIC_LIMITS.invitesPerDayStart} to ${PUBLIC_LIMITS.invitesPerDayMax} a day, ${PUBLIC_LIMITS.invitesPerWeek} a week; can only be lowered`}
                    </span>,
                    `Automatic, about ${PUBLIC_LIMITS.warmupWeeks} weeks from the first send; spread across working hours`,
                    "Never invites anyone already contacted; exclusion list checked before every send",
                    "Free while we grow, no card",
                  ],
                },
                {
                  label: "HeyReach",
                  values: [
                    <>
                      25 a day by default, up to 40; 200 a week <Src href={HEYREACH_LIMITS}>help center</Src>
                    </>,
                    "Advice to stay at the default; no automatic ramp found",
                    <>
                      Optional filter to skip leads in other campaigns <Src href={HEYREACH_EXCLUDE}>help center</Src>
                    </>,
                    <>
                      $79 per sender (Growth); agency bundles vary by source <Src href={HEYREACH_PRICE}>review</Src>
                    </>,
                  ],
                },
                {
                  label: "Waalaxy",
                  values: [
                    <>
                      80 to 100 a day on top plans; 200 a week <Src href={WAALAXY_LIMITS}>blog</Src>
                    </>,
                    "Overflow waits for the next week; no ramp found",
                    <>
                      One list per prospect; a do-not-contact list you keep <Src href={WAALAXY_BLACKLIST}>blog</Src>
                    </>,
                    <>
                      From about €19 (roughly $22) per user; sources disagree <Src href={WAALAXY_PRICE}>review</Src>
                    </>,
                  ],
                },
                {
                  label: "Expandi",
                  values: [
                    <>
                      Under 100 a week recommended <Src href={EXPANDI_LIMITS}>help center</Src>
                    </>,
                    <>
                      Optional ramp: 2 more a day every 1 to 3 days, up to 21 <Src href={EXPANDI_WARMUP}>help center</Src>
                    </>,
                    <>
                      Duplicates blocked across a company&rsquo;s accounts by default; blacklists <Src href={EXPANDI_BLACKLIST}>help center</Src>
                    </>,
                    <>
                      $99 per LinkedIn account <Src href={EXPANDI_PRICE}>review</Src>
                    </>,
                  ],
                },
                {
                  label: "Dripify",
                  values: [
                    <>
                      Up to 75 a day, in a random range you set <Src href={DRIPIFY_LIMITS}>help center</Src>
                    </>,
                    "Randomized daily volume; no ramp found",
                    <>
                      Skip leads in your or teammates&rsquo; campaigns; a blacklist <Src href={DRIPIFY_DUPES}>help center</Src>
                    </>,
                    <>
                      $59 to $99 per user; 7-day trial <Src href={DRIPIFY_PRICE}>review</Src>
                    </>,
                  ],
                },
                {
                  label: "PhantomBuster",
                  values: [
                    <>
                      15 to 25 a day suggested for accounts over 90 days old <Src href={PB_LIMITS}>blog</Src>
                    </>,
                    "Scheduling controls; volume is yours to set",
                    "Not published",
                    <>
                      $69, $159 or $439 a month; a small free plan <Src href={PB_PRICING}>pricing</Src>
                    </>,
                  ],
                },
                {
                  label: "Artisan",
                  values: [
                    "Not published for LinkedIn",
                    "Email warm-up only; LinkedIn pacing not published",
                    "Not published",
                    <>
                      Self-serve plans or a quote; sources disagree <Src href={ARTISAN_PRICE}>guide</Src>
                    </>,
                  ],
                },
              ]}
            />
          </div>
        </div>

        <div className="hub-body article-body">
          <h3 id="caps">Published daily and weekly caps</h3>
          <p>
            The spread is wider than most people expect. Published daily maximums run from{" "}
            {PUBLIC_LIMITS.invitesPerDayMax} to 100, and weekly ceilings from{" "}
            {PUBLIC_LIMITS.invitesPerWeek} to 200. The difference is mostly who decides: in most tools
            the cap is a setting with a recommended value, and the user can turn it up. In Nora the
            number is a product rule, and an owner can only lower it for an account or a campaign.
            LinkedIn itself publishes no number, which is why the ceiling a tool lets you reach
            matters more than the one it recommends.
          </p>

          <h3 id="warm-up">Warm-up and pacing</h3>
          <p>
            A warm-up raises a new or quiet account&rsquo;s volume gradually rather than on day one.
            Expandi publishes an optional ramp you switch on; we could not find an automatic one in
            the other vendors&rsquo; documentation. Nora&rsquo;s ramp is not optional and starts at an
            account&rsquo;s first send, not the day it was connected, so an account connected weeks
            ago that has never sent still begins at {PUBLIC_LIMITS.invitesPerDayStart} a day. Pacing
            within the day matters as much: a day&rsquo;s allowance sent in one burst is the pattern a
            platform watches for, so Nora spreads it across your working hours. The{" "}
            <Link href="/guides/safest-linkedin-automation-tool">eight checks for a safe LinkedIn automation tool</Link>{" "}
            go through each guardrail in more depth.
          </p>

          <h3 id="do-not-contact">Do-not-contact and exclusion rules</h3>
          <p>
            Contacting the same person twice, from two campaigns or two teammates, is what makes
            outreach read as a mail merge. Every sequence tool here offers a way to avoid it: HeyReach
            and Dripify as filters you choose when building a campaign, Expandi as a default you can
            override, Waalaxy by keeping each prospect in one list. The difference in Nora is when the
            check runs. Its rule that nobody already contacted gets a second invitation, and its
            shared exclusion list, are both checked immediately before each send, so a name added to
            the list at 10 a.m. stops a send queued for 10:05 a.m.
          </p>

          <h3 id="price">Price as of the date shown</h3>
          <p>
            Prices are monthly-billing list prices from the sources linked in the table, checked on{" "}
            {formatDate(CHECKED)}. Annual billing is cheaper with every paid vendor here. Three pricing
            models are in play: per user (Dripify, Waalaxy), per LinkedIn sender or account
            (HeyReach, Expandi), and per plan with usage credits (PhantomBuster, Artisan). Nora is free
            while we grow; <Link href="/pricing">the pricing page</Link> says what happens if that
            changes.
          </p>

          <h2 id="who-each-suits">Who each LinkedIn automation tool suits</h2>
          <ul>
            <li>
              <strong>Nora</strong> suits a founder or small team sending from their own profiles who
              wants the prospects found, a note of up to {INVITE_NOTE_MAX_CHARS} characters written for
              each person, and each reply drafted for them to approve, with autopilot available once
              they trust it. They approve the strategy, the copy and the launch.
              It works on LinkedIn only. See <Link href="/free-linkedin-automation-tool">what the free LinkedIn automation tool includes</Link>.
            </li>
            <li>
              <strong>HeyReach</strong> suits agencies running many sender accounts for clients, with
              sender rotation and one inbox across all of them.
            </li>
            <li>
              <strong>Waalaxy</strong> suits beginners who want ready-made campaigns, and anyone who
              wants an email finder and email steps in the same tool on its top plan.
            </li>
            <li>
              <strong>Expandi</strong> suits growth teams who design branching LinkedIn and email
              sequences themselves, with if-then conditions on what each prospect did.
            </li>
            <li>
              <strong>Dripify</strong> suits sales teams who want drip sequences with team dashboards,
              roles and A/B testing.
            </li>
            <li>
              <strong>PhantomBuster</strong> suits operations people extracting and enriching data
              across platforms more than people holding conversations.
            </li>
            <li>
              <strong>Artisan</strong> suits teams that sell mainly by email at volume and want a
              contact database bundled with the agent.
            </li>
          </ul>
          <p>
            If you are choosing an agent rather than a sequencer, the{" "}
            <Link href="/guides/best-ai-sdr-for-linkedin">guide to the best AI SDR tools for LinkedIn</Link>{" "}
            lists the questions worth putting to any vendor, including us.
          </p>

          <p>
            Each card at the top of this page compares one of these tools with Nora in detail: who it
            suits, its sourced pricing, how it handles limits, and how to switch without contacting
            anyone twice. Before you connect an account to any of them, read{" "}
            <Link href="/guides/is-linkedin-automation-legal">whether LinkedIn automation is legal</Link>.
          </p>
        </div>

        <div className="hub-body">
          <section className="article-faq" aria-labelledby="alt-hub-faq-heading">
            <h2 id="alt-hub-faq-heading">Questions about LinkedIn automation tools</h2>
            {FAQ.map((item) => (
              <details key={item.q}>
                <summary>{item.q}</summary>
                <p>{item.a}</p>
              </details>
            ))}
          </section>
        </div>

        <div className="hub-body">
          <section className="article-sources" aria-labelledby="alt-hub-sources-heading">
            <h2 id="alt-hub-sources-heading">Sources</h2>
            <ol>
              {SOURCES.map((source) => (
                <li key={source.url}>
                  <a href={source.url} rel="noopener nofollow" target="_blank">
                    {source.label}
                  </a>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </HubLayout>
    </>
  );
}
