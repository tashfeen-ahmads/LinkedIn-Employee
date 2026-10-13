import type { Metadata } from "next";
import Link from "next/link";
import { ArticleLayout, articleMeta, CompareTable, type Faq, type Source } from "@/components/article";
import { PUBLIC_LIMITS } from "@/lib/site";
import { SearchRecipe } from "@/components/seo/gb2-query";

const PATH = "/guides/linkedin-prospecting-without-sales-navigator";

export const metadata: Metadata = articleMeta(PATH);

const FAQ: readonly Faq[] = [
  {
    q: "Do I need Sales Navigator to prospect on LinkedIn?",
    a: "No. Free search filters people by keywords, location, industry, company, school and connection degree, and its keyword box supports OR, NOT and quotes. That is enough to build a good list for most small businesses. You need the paid seat when seniority or company size really defines your buyer, or when you search often enough to keep hitting the monthly commercial use limit.",
  },
  {
    q: "What filters does free LinkedIn search lack?",
    a: "As of October 2026, free LinkedIn search has no seniority filter, no company headcount filter and no way to exclude job titles, all of which Sales Navigator offers. It also lacks Sales Navigator’s lead lists and job-change alerts, though a free account can save a few searches. Typing a seniority word like director into the keyword box is a text match, not a filter, so treat the results as a hint.",
  },
  {
    q: "Does LinkedIn search support OR?",
    a: "Yes. LinkedIn’s help page says the keyword box accepts quotes for exact phrases, OR, AND and NOT in capital letters, and parentheses for grouping, processed in that order: quotes, parentheses, NOT, AND, then OR. Use OR between alternative job titles. Without it, several words separated by spaces must all appear on a profile, which matches very few people.",
  },
  {
    q: "Does Sales Navigator increase the connection limit?",
    a: `LinkedIn publishes no invitation limit for any plan, and third-party reports conflict: some say paid seats get a higher weekly ceiling, others say the plan makes no difference. Because nobody can verify it, Nora holds every account to the same ${PUBLIC_LIMITS.invitesPerWeek} invitations a week whether or not it has Sales Navigator. The seat buys better searches, not more invitations.`,
  },
  {
    q: "When does the commercial use limit reset?",
    a: "LinkedIn’s help center says the commercial use limit is counted on your search activity since the start of the calendar month and resets on the first of the month. LinkedIn does not publish the number. As of October 2026, its Premium FAQ says Premium Business, Sales Navigator and Recruiter Lite browse without the limit.",
  },
];

const SOURCES: readonly Source[] = [
  { label: "LinkedIn Help: Use Boolean search on LinkedIn", url: "https://www.linkedin.com/help/linkedin/answer/75814" },
  { label: "LinkedIn Help: Commercial use limit", url: "https://www.linkedin.com/help/linkedin/answer/52950" },
  { label: "LinkedIn Premium FAQ (commercial use limit and unlimited browsing plans)", url: "https://premium.linkedin.com/professional/faq" },
  { label: "LinkedIn Help: Choose the right Sales Navigator subscription", url: "https://www.linkedin.com/help/linkedin/answer/a104003" },
  { label: "LinkedIn Help: Invitation restrictions (answer 4800)", url: "https://www.linkedin.com/help/linkedin/answer/4800" },
  { label: "Microsoft Learn: LinkedIn industry codes V2", url: "https://learn.microsoft.com/en-us/linkedin/shared/references/reference-tables/industry-codes-v2" },
  { label: "LinkedIn: Sales Navigator compare plans and pricing (checked October 2026)", url: "https://business.linkedin.com/sell/sales-navigator/compare-plans" },
  { label: "LinkedIn Help: Smart Links in Sales Navigator FAQ (Advanced plans only)", url: "https://www.linkedin.com/help/sales-navigator/answer/a130019" },
  { label: "LinkedIn Help: Sales Navigator alerts (lead changed jobs)", url: "https://www.linkedin.com/help/sales-navigator/answer/a105133" },
  { label: "LinkedIn Help: Save lead and account searches in Sales Navigator", url: "https://www.linkedin.com/help/sales-navigator/answer/a102024/" },
  { label: "LinkedIn Help: InMail messages FAQ (monthly credits by plan)", url: "https://www.linkedin.com/help/linkedin/answer/a554514" },
  { label: "LinkedIn Help: Difference between free LinkedIn and Premium accounts (saved searches and alerts)", url: "https://www.linkedin.com/help/linkedin/answer/a545596" },
  { label: "LinkedIn Premium Business: plan page and pricing (checked October 2026)", url: "https://premium.linkedin.com/small-business/business" },
  { label: "Findymail: Sales Navigator search filters", url: "https://findymail.com/blog/sales-navigator-search-filters" },
];

const FILTERS = [
  { label: "Keywords, with Boolean", values: ["Yes", "Yes"] },
  { label: "Job title", values: ["Title keyword field, include only", "Include and exclude filter"] },
  { label: "Location", values: ["Yes, LinkedIn’s names", "Yes, LinkedIn’s names"] },
  { label: "Industry", values: ["Yes, LinkedIn’s names", "Yes, LinkedIn’s names"] },
  { label: "Current and past company, school", values: ["Yes", "Yes"] },
  { label: "Connection degree", values: ["Yes", "Yes"] },
  { label: "Seniority level", values: ["No", "Yes"] },
  { label: "Company headcount", values: ["No", "Yes"] },
  { label: "Exclude titles", values: ["No (NOT in keywords is the nearest)", "Yes"] },
  { label: "Monthly search limit", values: ["Commercial use limit applies", "Unlimited browsing, per LinkedIn"] },
];

export default function Page() {
  return (
    <ArticleLayout
      path={PATH}
      h1="LinkedIn prospecting without Sales Navigator: what works and what you lose"
      lede="LinkedIn prospecting without Sales Navigator works: free search can filter by keywords, location, industry, company and connection degree, and handles OR, NOT and quotes. What you lose is seniority, company size and excluded-title filters, plus unlimited searching, and none of that changes how many invitations you can safely send."
      faq={FAQ}
      sources={SOURCES}
    >
      <CompareTable caption="Free LinkedIn search versus Sales Navigator for prospecting, as of October 2026" columns={["Free LinkedIn search", "Sales Navigator"]} rows={FILTERS} />
      <p>
        Most articles on this question are either a strong opinion (you do not need it) or a sales
        page (you do). Both skip the part that costs people their campaigns: the filters that look
        applied and are not, and the search syntax that silently returns nobody. Nora runs on
        whichever tier an account has, so we have seen both sides of this from the inside.
      </p>

      <h2 id="what-classic-can">What classic search can express</h2>
      <p>
        Free LinkedIn people search, which we call classic search, gives you a keyword box and a
        row of filters. As of October 2026 the filters cover connection degree, locations, current
        company, past company, school, industry, profile language and a few others, and the keyword
        box accepts Boolean operators. That is enough to say &ldquo;operations leaders in
        logistics, in Texas, not already connected to me&rdquo;:
      </p>
      <ul>
        <li>Titles go into the keyword box, joined with <code>OR</code>.</li>
        <li>Location and industry go into their filters, chosen from LinkedIn&rsquo;s suggestions.</li>
        <li>Connection degree set to second and third, because first-degree connections cannot be invited.</li>
      </ul>
      <p>
        For a business with one clear buyer title in one region, that is most of what Sales
        Navigator would have done. The gaps appear when the buyer is defined by rank or by company
        size.
      </p>

      <h2 id="what-classic-cannot">What it cannot: seniority, company size, excluded titles</h2>
      <p>
        Three filters exist only in Sales Navigator, and each matters for a particular kind of
        profile:
      </p>
      <ul>
        <li>
          <strong>Seniority level.</strong> Sales Navigator ranks people by their position in the
          company rather than by title wording. Classic search can only look for words like
          &ldquo;director&rdquo; or &ldquo;head&rdquo;, which also match &ldquo;assistant to the
          director&rdquo; and miss founders who call themselves something else.
        </li>
        <li>
          <strong>Company headcount.</strong> Sales Navigator filters by size bands such as 11 to 50
          or 51 to 200 (third-party guides note that companies do not always keep their headcount
          current). Classic search has no equivalent at all.
        </li>
        <li>
          <strong>Excluded titles.</strong> Sales Navigator can drop interns, students or
          recruiters from a list. In classic search, <code>NOT</code> in the keyword box is the
          nearest thing, and it removes any profile containing the word anywhere.
        </li>
      </ul>

      <h3 id="dropped-worse">Why a dropped filter is worse than a missing one</h3>
      <p>
        A filter you know you cannot set changes how you read the list. A filter that looks set and
        is not leaves you trusting a list that is wider than it appears. Type
        &ldquo;director&rdquo; into the keywords and the first page looks senior, because plenty of
        it is; nothing on the screen says the rest is a text match.
      </p>
      <p>
        So when Nora searches a customer profile on an account without Sales Navigator, it still
        uses the seniority words as a keyword hint, and writes the dropped filters onto the
        campaign by name (seniority, company size, excluded titles) where you read them before
        launching. Excluded titles are then caught when each prospect is scored against the
        profile, which costs a little more model time but means the person never reaches your list.
      </p>

      <h2 id="taxonomy">Location and industry must match LinkedIn&rsquo;s own names</h2>
      <p>
        This is the trap most guides never mention. LinkedIn filters places and industries by its
        own list of entries, each with an internal id, not by the words you type. Choose
        &ldquo;Texas, United States&rdquo; from the suggestions and it filters. Send the same words
        anywhere a tool or an integration expects an id, and the search can return nobody at all,
        with no error. That is exactly how our own first live campaign found nobody, and why Nora
        now looks every location and industry up in LinkedIn&rsquo;s list before searching.
      </p>
      <p>
        Industries have a second problem. LinkedIn moved to a larger, more detailed industry list
        (Microsoft&rsquo;s developer reference describes the new codes as available from 2022;
        some third-party lists date the rollout to 2023), so an industry from an old playbook may
        have been split or renamed. When Nora finds a term under a different name, the campaign
        says &ldquo;searched as LinkedIn&rsquo;s X&rdquo;, and a term LinkedIn does not have is
        left out and named rather than guessed.
      </p>

      <h2 id="boolean">Boolean search that returns people</h2>
      <p>
        Boolean search is the most useful free tool LinkedIn gives you, and the easiest to get
        quietly wrong.
      </p>

      <h3 id="or-not-spaces">OR, not spaces</h3>
      <p>
        Several words separated by spaces ask for profiles that contain all of them. A list of
        alternative titles typed that way asks for someone whose profile says &ldquo;founder&rdquo;
        and &ldquo;owner&rdquo; and &ldquo;managing director&rdquo; and &ldquo;CEO&rdquo; at once,
        and returns almost nobody. Write alternatives as alternatives:
      </p>
      <p>
        <code className="gb2-code">{'"managing director" OR founder OR owner OR CEO'}</code>
      </p>
      <p>
        LinkedIn&rsquo;s help page says the operators must be capitalized and are processed in a
        fixed order: quotes, then parentheses, then NOT, then AND, then OR. When you mix AND and OR,
        wrap the alternatives in parentheses so the order is the one you meant.
      </p>

      <h3 id="quotes-not">Quotes and NOT</h3>
      <p>
        Quotes match an exact phrase, so <code>{'"head of operations"'}</code> will not return a
        &ldquo;head of sales&rdquo; who mentions operations. <code>NOT</code> removes any profile
        containing the word, which makes it a blunt instrument: <code>NOT recruiter</code> also
        drops a founder whose summary says they used to be one. Use it for words that only the
        wrong people use.
      </p>
      <SearchRecipe
        title="A free search for operations leaders in logistics, in Texas"
        keywords={'("operations director" OR "head of operations" OR COO) NOT recruiter'}
        filters={[
          { label: "Locations", value: "Texas, United States, picked from LinkedIn\u2019s suggestions" },
          { label: "Industry", value: "A logistics industry, picked from LinkedIn\u2019s suggestions" },
          { label: "Connections", value: "2nd and 3rd, because 1st-degree connections cannot be invited" },
        ]}
      />

      <h2 id="commercial-use-limit">The commercial use limit</h2>
      <p>
        The real ceiling on free prospecting is not a filter. LinkedIn&rsquo;s help center says
        free accounts that search for people heavily hit a commercial use limit, counted on search
        activity since the start of the calendar month and reset on the first of the month.
        LinkedIn does not publish the number.
      </p>
      <p>
        Its Premium FAQ says Premium Business, Sales Navigator and Recruiter Lite browse without
        this limit. If you prospect a few times a month, you may never meet it. If prospecting is a
        daily job, expect to.
      </p>

      <h3 id="saved-searches">Saved searches: the free substitute for alerts</h3>
      <p>
        Sales Navigator&rsquo;s alerts tell you when a saved lead changes jobs or a saved search finds
        someone new. A free account has a smaller version: LinkedIn&rsquo;s help center says a basic
        account can save up to three searches and get weekly alerts when new people match them. Some
        users report the option missing from their search page, so check for it on yours. If it is not
        there, bookmark the search address and run it again each week. Either way, save the one search
        you would otherwise rebuild every Monday, and new people who fit arrive without spending your
        monthly search allowance on finding the same ones again.
      </p>

      <h2 id="worth-it">Is Sales Navigator worth it for a small business?</h2>
      <p>
        It depends on whether your buyer is defined by the filters only it has, and on how often
        you search. LinkedIn sells it in three plans. Core is the one a small business needs; Advanced
        adds features for a sales team; Advanced Plus is priced on request for teams connecting it to
        a CRM. US prices, as listed on LinkedIn&rsquo;s plan page as of October 2026 (before tax, and
        different in other regions):
      </p>
      <CompareTable
        caption="Sales Navigator Core and Advanced, as listed by LinkedIn as of October 2026 (US prices, per seat)"
        columns={["Core", "Advanced"]}
        rows={[
          { label: "Built for", values: ["One person selling", "A sales team"] },
          { label: "Paid monthly", values: ["$119.99 a month", "$159.99 a month"] },
          {
            label: "Paid yearly",
            values: ["$1,079.88 a year (about $90 a month)", "$1,799.88 a year (about $150 a month)"],
          },
          { label: "Seniority, headcount and excluded-title filters", values: ["Yes", "Yes"] },
          { label: "Saved searches and lead alerts", values: ["Yes", "Yes"] },
          { label: "TeamLink (who on your team knows a lead)", values: ["No", "Yes"] },
          { label: "Smart Links (see who opened what you shared)", values: ["No", "Yes"] },
          { label: "Trial", values: ["Yes, for eligible members", "Yes, for eligible members"] },
        ]}
      />
      <p>
        LinkedIn offers a trial at no charge on Core and Advanced to members who have no paid LinkedIn
        plan and have not had a LinkedIn trial in the past 365 days. It asks for a card up front and
        charges when the trial ends unless you cancel, so put the end date in your calendar the day
        you start. A trial is a good way to run the comparison on this page with your own customer
        profile: the same search on both tiers, side by side.
      </p>

      <h3 id="premium-business">The middle option: Premium Business</h3>
      <p>
        If the commercial use limit is your only problem, Premium Business is the cheaper fix.
        LinkedIn&rsquo;s plan page lists it at $69.99 a month, or $539.88 a year, as of
        October 2026. Its Premium FAQ says it browses without the commercial use limit, and its
        InMail FAQ lists 15 InMail credits a month. What it does not bring, as far as we could find,
        is Sales Navigator&rsquo;s lead filters: no seniority, no company headcount, no excluded titles.
        So it fixes how much you can search, not what you can search for.
      </p>

      <h3 id="what-it-adds">What the seat adds</h3>
      <ul>
        <li>Seniority, company headcount and excluded-title filters, plus many more lead and account filters.</li>
        <li>Unlimited browsing instead of the monthly commercial use limit.</li>
        <li>Saved lead and account lists with alerts, including when a saved lead changes jobs, and 50 InMail credits a month on Core, per LinkedIn&rsquo;s InMail FAQ.</li>
      </ul>

      <h3 id="what-it-does-not-change">What it does not change (the invitation cap)</h3>
      <p>
        Sales Navigator finds people; it does not let you invite more of them. LinkedIn publishes
        no invitation limit for any plan, and third-party reports disagree about whether paid seats
        get more. Its help center says invitations are restricted when an account sends many in a
        short time or many are ignored, and that applies to every plan. Nora treats every account
        the same: {PUBLIC_LIMITS.invitesPerDayStart} invitations a day from the first send, rising
        to {PUBLIC_LIMITS.invitesPerDayMax} over about {PUBLIC_LIMITS.warmupWeeks} weeks, never more
        than {PUBLIC_LIMITS.invitesPerWeek} a week. Our guide to the{" "}
        <Link href="/guides/linkedin-weekly-invitation-limit">LinkedIn weekly invitation limit</Link>{" "}
        and the <Link href="/linkedin-automation-limits">full LinkedIn limits page</Link> explain why.
      </p>
      <p>
        The practical rule: if {PUBLIC_LIMITS.invitesPerWeek} well-chosen invitations a week can be found with titles,
        location and industry, a free account is enough and the money is better spent elsewhere.
        If your buyer is &ldquo;a director at a 50-person firm&rdquo; and that distinction is the
        whole sale, the seat pays for itself in wasted invitations avoided.
      </p>

      <h2 id="next">Starting LinkedIn prospecting without Sales Navigator</h2>
      <p>
        The search is one step of seven. Our{" "}
        <Link href="/guides/linkedin-prospecting">step-by-step LinkedIn prospecting guide</Link>{" "}
        covers the rest, and the guide to an{" "}
        <Link href="/guides/ideal-customer-profile-for-linkedin">ideal customer profile for LinkedIn outreach</Link>{" "}
        covers what to search for in the first place. Nora works on either tier and tells you which
        filters it could not apply: see <Link href="/how-it-works">how Nora runs a campaign on either tier</Link>,
        or browse all <Link href="/guides">LinkedIn outreach guides</Link>.
      </p>
    </ArticleLayout>
  );
}
