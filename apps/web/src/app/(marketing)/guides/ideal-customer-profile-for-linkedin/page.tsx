import type { Metadata } from "next";
import Link from "next/link";
import { ArticleLayout, articleMeta, Callout, CompareTable, type Faq, type Source } from "@/components/article";
import { CopyButton } from "@/components/copy-button";

const PATH = "/guides/ideal-customer-profile-for-linkedin";

export const metadata: Metadata = articleMeta(PATH);

const FAQ: readonly Faq[] = [
  {
    q: "What should an ICP include?",
    a: "Who they are (job titles, seniority, industries, company size, location), what they pay you for, what they do about the problem today, their pains, the events that make them ready to buy, and who to rule out. For LinkedIn outreach, write titles, industries and places the way LinkedIn names them, so the profile can become a search without guesswork.",
  },
  {
    q: "Is an ICP the same as a buyer persona?",
    a: "No. An ideal customer profile usually describes the kind of company worth selling to, and a buyer persona describes a person inside it: their goals, worries and how they talk. Outreach targets people, not companies, so for LinkedIn outreach you need both in one document: the company traits as filters and the person's role and pains as the reason to write.",
  },
  {
    q: "Why are my outreach prospects my competitors?",
    a: "Because the profile was written from your own website and vocabulary, and the people who share your vocabulary are your peers. On LinkedIn a competitor matches your titles, industry and size almost perfectly, so any fit score rates them highly. Add what the segment buys and what it does instead today; a competitor cannot answer either honestly.",
  },
  {
    q: "How do I turn an ICP into a LinkedIn search?",
    a: "Map each field to a filter: titles to the title or keyword field joined with OR, places and industries to LinkedIn's own suggested names, seniority and company size to Sales Navigator filters if you have the seat. Then run the search, open the first twenty profiles, and count how many you would genuinely want to write to before you send anything.",
  },
  {
    q: "How many ICPs should a business have?",
    a: "Start with three to five, the number you can read carefully and approve in one sitting, and pursue the strongest first. Add more as each one shows results. Keep them distinct: two profiles that overlap put the same people on two lists, and with a contact-once rule the second list simply finds nobody new.",
  },
];

const SOURCES: readonly Source[] = [
  { label: "Close: Ideal customer profile vs buyer persona", url: "https://www.close.com/blog/ideal-customer-profile-vs-buyer-persona" },
  { label: "Miro: Ideal customer profile vs buyer persona", url: "https://miro.com/persona/ideal-customer-profile-vs-buyer-persona" },
  { label: "LinkedIn Help: Use Boolean search on LinkedIn", url: "https://www.linkedin.com/help/linkedin/answer/75814" },
  { label: "LinkedIn Premium FAQ (commercial use limit and which plans avoid it)", url: "https://premium.linkedin.com/professional/faq" },
  { label: "LinkedIn Help: Choose the right Sales Navigator subscription (filters and plans)", url: "https://www.linkedin.com/help/linkedin/answer/a104003" },
  { label: "LinkedIn Help: Invitation restrictions (answer 4800)", url: "https://www.linkedin.com/help/linkedin/answer/4800" },
  { label: "Microsoft Learn: LinkedIn industry codes V2", url: "https://learn.microsoft.com/en-us/linkedin/shared/references/reference-tables/industry-codes-v2" },
];

const PROFILE_VS_PERSONA = [
  { label: "Describes", values: ["The kind of organization worth selling to", "A person inside it"] },
  { label: "Made of", values: ["Industry, size, location, buying triggers", "Role, goals, worries, how they talk"] },
  { label: "Used to", values: ["Decide who to pursue and who to turn away", "Decide what to say"] },
  { label: "On LinkedIn it becomes", values: ["Filters: industry, headcount, location", "Filters: titles, seniority; and the note itself"] },
  { label: "Fails when", values: ["It describes companies like yours", "It describes a person who cannot buy"] },
];

const SEARCH_MAP = [
  { label: "Job titles", values: ["Title or keyword field, joined with OR", "Title filter, include and exclude"] },
  { label: "Seniority", values: ["Not a filter; a keyword at best", "Seniority level filter"] },
  { label: "Company size", values: ["Not available", "Company headcount filter"] },
  { label: "Industry", values: ["Industry filter, LinkedIn's names only", "Industry filter, LinkedIn's names only"] },
  { label: "Location", values: ["Location filter, LinkedIn's names only", "Geography filter, LinkedIn's names only"] },
  { label: "Excluded titles", values: ["Not available; NOT in keywords is the nearest", "Title exclude filter"] },
  { label: "What they buy, instead today, pains", values: ["Not searchable; used to write and to judge", "Not searchable; used to write and to judge"] },
];

const TEMPLATE = [
  { label: "Name", values: ["Short and memorable, named after the buyer", "Operations leaders at mid-size US trucking and logistics firms"] },
  { label: "Job titles", values: ["The titles that own the problem, as written on LinkedIn", "VP of Operations OR Director of Operations OR COO"] },
  { label: "Seniority", values: ["Who can say yes, not who would use it", "Director and above"] },
  { label: "Industries", values: ["LinkedIn's own industry names, picked from its suggestions", "Whatever LinkedIn suggests when you type truck transportation or logistics"] },
  { label: "Company size", values: ["A headcount band", "51 to 200"] },
  { label: "Locations", values: ["Places as LinkedIn suggests them", "Texas and Illinois, picked from LinkedIn's suggestions"] },
  { label: "What they buy", values: ["What they pay you for, in their words", "Someone to run carrier onboarding so the ops team does not"] },
  { label: "Instead today", values: ["What your offer replaces", "A shared spreadsheet and one coordinator's afternoons"] },
  { label: "Pains", values: ["Specific, and fine to name tools or rivals", "New carriers take two weeks to onboard; the spreadsheet is always out of date"] },
  { label: "Trigger events", values: ["Observable moments of readiness", "A new VP of Operations; a new distribution center; a job post for carrier coordinators"] },
  { label: "Disqualifiers", values: ["Who looks right and is not", "Freight software vendors; logistics consultants; existing customers"] },
];

/* What the copy button hands over: every field with its hint, ready to fill in a document. */
const TEMPLATE_TEXT = [
  "Ideal customer profile for LinkedIn outreach",
  "",
  ...TEMPLATE.flatMap((row) => [`${row.label}: (${row.values[0]})`, ""]),
].join("\n");

export default function Page() {
  return (
    <ArticleLayout
      path={PATH}
      h1="An ideal customer profile for LinkedIn outreach that finds buyers, not peers"
      lede="An ideal customer profile for LinkedIn outreach describes the people who would pay you, in terms LinkedIn can search: who they are, what they buy, what they do instead today, their pains, and who to rule out. The two fields most templates skip, what they buy and what they do instead, are the ones that stop the profile describing your competitors."
      faq={FAQ}
      sources={SOURCES}
    >
      <Callout tone="info">
        <p className="ga2-summary-title">In short</p>
        <ul className="ga2-callout-list">
          <li>Write the profile about the buyer&rsquo;s problem, not about your company.</li>
          <li>Add &ldquo;what they buy&rdquo; and &ldquo;what they do instead today&rdquo;. A competitor cannot fill either honestly.</li>
          <li>Name competitors freely in the pains, never in who the segment is.</li>
          <li>Write titles, industries and places as LinkedIn names them, and check which filters your tier can actually apply.</li>
          <li>Before approving, open twenty profiles from the search and count the real buyers.</li>
        </ul>
      </Callout>

      <h2 id="trap">The trap: a profile built from your own website describes your competitors</h2>
      <p>
        Most ICP templates start from you: your best customers, your value proposition, your
        market. That is reasonable for a marketing plan. For LinkedIn outreach it hides a specific
        failure, because your website describes your world in your vocabulary, and the people who
        share that vocabulary most closely are the other companies doing what you do.
      </p>
      <p>
        We watched it happen inside one strategy document. A referral platform listed traditional
        networking groups among its competitors. The same document&rsquo;s top-priority segment, which a
        person then approved, was the leaders of those networking groups. Two fields of one answer
        contradicted each other, and nothing compared them.
      </p>
      <figure className="ga2-contrast">
        <div className="ga2-contrast-card is-peer">
          <p className="ga2-contrast-title">Written from the company&rsquo;s own website</p>
          <dl>
            <div>
              <dt>Segment</dt>
              <dd>Leaders of networking groups: chapters, chambers, masterminds</dd>
            </div>
            <div>
              <dt>What they buy</dt>
              <dd>Left blank. They run the thing the platform competes with.</dd>
            </div>
          </dl>
          <p className="ga2-contrast-result">The search returns competitors</p>
        </div>
        <div className="ga2-contrast-card is-buyer">
          <p className="ga2-contrast-title">Written from what buyers pay for</p>
          <dl>
            <div>
              <dt>Segment</dt>
              <dd>Owners of small service firms that win most new clients by referral</dd>
            </div>
            <div>
              <dt>What they buy</dt>
              <dd>A way to ask for, track and thank referrals without a spreadsheet</dd>
            </div>
          </dl>
          <p className="ga2-contrast-result">The search returns people with the problem</p>
        </div>
        <figcaption>
          The same referral platform, two profiles. The left one matches the real case; the right one is how the same
          business reads once &ldquo;what they buy&rdquo; has to be filled in honestly.
        </figcaption>
      </figure>
      <p>
        On LinkedIn, the mistake is invisible from the list. A competitor has the same titles, the
        same industry, the same company size, often the same headline. Any fit score, human or
        model, scores people <em>against the profile</em>, so a profile shaped like a competitor
        makes competitors the best-scoring people in the list. The filter cannot rescue a bad
        profile; the profile is the filter&rsquo;s definition of good. The fix has to happen before
        the search, in the profile itself.
      </p>

      <h2 id="fields">The fields an ICP needs</h2>
      <p>
        An ICP for outreach has five groups of fields. The first describes the person; the next three are why they would
        talk to you; the last keeps the wrong people out.
      </p>

      <h3 id="who">Who they are</h3>
      <p>
        Job titles, seniority, industries, company size, locations, and trigger events: observable
        moments when they become ready to buy, like a new role, a new office or a hiring post.
        Write titles the way people put them on their own profiles. &ldquo;Head of
        Operations&rdquo; is searchable; &ldquo;operational decision-maker&rdquo; is not.
      </p>

      <h3 id="what-they-buy">What they buy</h3>
      <p>
        One sentence: what this segment pays you for, in their own words. This is the question a
        peer fails. Somebody who sells what you sell does not buy it, and if you cannot write this
        line honestly for a segment, the segment is not a customer.
      </p>

      <h3 id="instead-today">What they do instead today</h3>
      <p>
        A tool they pay for, a spreadsheet, a freelancer, a person they hired, or nothing. This is
        what your offer replaces, so it is also your best opening line: people answer questions
        about the thing they already do far more readily than pitches for the thing they do not have.
      </p>

      <h3 id="pains">Pains (where naming competitors is fine)</h3>
      <p>
        Specific problems, ideally ones visible from outside. Here, naming a competitor or a
        current tool is not a mistake, it is the point: &ldquo;they track referrals in a
        spreadsheet&rdquo; is exactly why somebody would buy a referral tool. The rule is narrow:
        competitors may appear in what the segment <em>uses</em>, never in who the segment <em>is</em>.
        Targeting by need finds buyers; targeting by resemblance finds peers.
      </p>

      <h3 id="disqualifiers">Disqualifiers</h3>
      <p>
        Who looks right and is not: vendors of the same thing, consultancies that resell it,
        companies too small to pay, titles that use the product but cannot approve it, and your
        existing customers. Some of these become excluded titles in a search; the rest belong on an
        exclusion list that is checked before every send.
      </p>

      <h2 id="icp-vs-persona">ICP versus buyer persona, in one table</h2>
      <p>
        The usual distinction, which guides like Close&rsquo;s draw well, is that an ICP describes
        a company and a persona describes a person. LinkedIn changes the practical answer, because
        outreach on LinkedIn targets people. For outreach you need one document holding both: company traits
        as filters, the person&rsquo;s role and pains as the reason to write.
      </p>
      <CompareTable caption="Ideal customer profile versus buyer persona for LinkedIn outreach" columns={["Ideal customer profile", "Buyer persona"]} rows={PROFILE_VS_PERSONA} />

      <h2 id="to-search">Turning an ICP into a LinkedIn search</h2>
      <p>
        Most ICP guides stop here. The translation into a search is where a good profile quietly
        becomes the wrong list, so it is worth doing field by field.
      </p>
      <CompareTable caption="Where each ICP field goes in a LinkedIn search" columns={["Free LinkedIn search", "Sales Navigator"]} rows={SEARCH_MAP} />

      <h3 id="classic-limits">What classic search can and cannot express</h3>
      <p>
        As of October 2026, free LinkedIn search filters by keywords, location, industry, current
        and past company, school and connection degree. It has no seniority filter, no company headcount filter and
        no way to exclude titles. Its keyword box does support Boolean operators, per LinkedIn&rsquo;s
        help page: quotes, capitalized <code>OR</code>, <code>AND</code> and <code>NOT</code>, and
        parentheses. Use <code>OR</code> between titles. Typed with spaces, several titles become
        a requirement that a profile contain all of them, which matches almost nobody.
      </p>
      <p>
        Places and industries have to be LinkedIn&rsquo;s own names, picked from its suggestions.
        LinkedIn moved to a larger industry list a few years ago (Microsoft&rsquo;s developer
        reference describes the new codes as available from 2022), so an industry name from an old
        template may not exist any more, or may now be narrower.
      </p>

      <h3 id="silent-drops">Filters that silently drop</h3>
      <p>
        The dangerous case is not a filter you cannot set; it is one that looks set and is not. Type
        &ldquo;director&rdquo; into the keyword box and the results look senior, because many are,
        but it is a text hint matching anyone with the word anywhere in their profile. A list built
        that way still looks like what you asked for. Nora searches on the tier your account
        actually has and writes the dropped filters onto the campaign (seniority, company size,
        excluded titles), along with any location or industry LinkedIn did not recognize or searched
        under a different name, so you read them before you launch. Our guide to{" "}
        <Link href="/guides/linkedin-prospecting-without-sales-navigator">LinkedIn prospecting without Sales Navigator</Link>{" "}
        covers when the paid seat is worth it.
      </p>

      <h2 id="approve-check">A check before you approve a profile</h2>
      <p>
        Read it as the most skeptical person in your company would, then run these six checks.
      </p>
      <ol>
        <li>Can you write &ldquo;what they buy&rdquo; without describing your own product back to yourself?</li>
        <li>Is &ldquo;what they do instead today&rdquo; something real they spend time or money on?</li>
        <li>Do the name, titles, industries or keywords contain any competitor you have named? (Pains may.)</li>
        <li>Is at least one trigger event something you could actually see on a profile?</li>
        <li>Are titles joined with OR, and are places and industries LinkedIn&rsquo;s own names?</li>
        <li>Of the first twenty people the search returns, how many would you be glad to hear back from?</li>
      </ol>
      <Callout tone="safety">
        <p>
          <strong>Approving a strategy is one of the three decisions Nora leaves to you.</strong> Its
          approval screen compares each segment&rsquo;s name, titles, industries and keywords against
          the competitors your business profile lists, and says so when they match. It warns and
          never blocks: some companies really do sell to the people they compete with, and that is
          your call to make knowingly.
        </p>
      </Callout>
      <p>
        Targeting quality shows up later as acceptance rate: a profile aimed at the wrong people is
        ignored, and ignored invitations are one of the reasons LinkedIn gives for restricting an
        account. Our guide to{" "}
        <Link href="/guides/linkedin-acceptance-rate">LinkedIn connection acceptance rates</Link>{" "}
        explains how to read yours on small numbers.
      </p>

      <h2 id="template">Free ideal customer profile template for LinkedIn outreach</h2>
      <p>
        Eleven fields, each with what to write and a worked example. The example is an illustration,
        not a customer: a US company selling carrier onboarding as a service to trucking and
        logistics firms in Texas and Illinois. Copy the blank template into a document or a sheet
        and fill in one per segment.
      </p>
      <CompareTable caption="Ideal customer profile template for LinkedIn outreach, with an example" columns={["What to write", "Example"]} rows={TEMPLATE} />
      <div className="ga2-actions">
        <CopyButton value={TEMPLATE_TEXT} label="Copy blank template" />
      </div>
      <p>
        Nora writes three to five of these from your website, each asked to fill both buyer fields,
        and searches none of them until you approve one. Then it runs the rest of the process in
        our <Link href="/guides/linkedin-prospecting">step-by-step LinkedIn prospecting guide</Link>:
        search, profile checks, one note per person, paced sending.
      </p>
    </ArticleLayout>
  );
}
