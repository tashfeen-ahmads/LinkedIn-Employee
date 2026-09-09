/**
 * A worked example of the product mid-flight.
 *
 * Every screen reads from the database, so an empty one shows nothing — which
 * makes the product impossible to demonstrate, review or design against. This
 * is one plausible workspace a week into a campaign: some invitations sent,
 * some accepted, one conversation waiting on a human, one meeting booked.
 *
 * The company is invented. The shape of the data is not: the fit scores, the
 * intent signals, the state transitions and the held-reply reasons are all
 * values the real agents produce.
 */

export interface DemoMessage {
  direction: "outbound" | "inbound";
  source: "agent" | "human";
  body: string;
  daysAgo: number;
  classification?: Record<string, unknown>;
}

export interface DemoConversation {
  prospect: string;
  messages: DemoMessage[];
  /** Present on the one thread the agent refused to answer by itself. */
  heldDraft?: { body: string; reason: string; unansweredQuestions: string[] };
}

export interface DemoProspect {
  key: string;
  firstName: string;
  lastName: string;
  title: string;
  company: string;
  companySize: string;
  industry: string;
  location: string;
  linkedinUrl: string;
  fitScore: number;
  fitReasons: string[];
  intentScore: number;
  signals: Array<{ type: string; detail: string; weight: number }>;
  status: string;
  doNotContact?: boolean;
  doNotContactReason?: string;
}

export const DEMO: {
  workspace: { name: string; slug: string; plan: string };
  rep: { email: string; fullName: string; timezone: string; bio: string };
  businessProfile: Record<string, unknown>;
  customerProfiles: Array<Record<string, unknown> & {
    name: string;
    priority: number;
    connectionNote: string;
    followUps: Array<{ delayDays: number; message: string }>;
  }>;
  prospects: DemoProspect[];
  conversations: DemoConversation[];
  meeting: { prospect: string; inDays: number; durationMinutes: number };
} = {
  workspace: {
    name: "Northwind Systems",
    slug: "northwind-demo",
    plan: "trial",
  },
  rep: {
    email: "demo@northwind.test",
    fullName: "Sam Patel",
    timezone: "Europe/London",
    bio: "Founder at Northwind. Ex-ops, sells to ops.",
  },
  businessProfile: {
    companyName: "Northwind Systems",
    oneLiner: "Northwind gives revenue teams one place to see pipeline hygiene.",
    offering:
      "A platform that watches CRM data for the gaps that cost deals — stale opportunities, missing next steps, contacts who have gone quiet — and puts them in front of the rep who owns them.",
    pricingModel: "Per seat, from £60 a month, annual contracts",
    proofPoints: [
      "Cut average deal-cycle length by 11 days at Fieldwork",
      "Used by 40 revenue teams across the UK and Ireland",
    ],
    toneOfVoice: "Plain, specific, unhurried. No hype, no exclamation marks.",
    competitors: ["Clari", "Gong Forecast", "spreadsheets"],
    commonObjections: [
      "We already get this from our CRM dashboards",
      "Our data is too messy for this to work",
      "Another tool for reps to ignore",
    ],
    differentiators: [
      "Works on the CRM you already have, no data migration",
      "Flags the specific record, not a team-level score",
    ],
  },
  customerProfiles: [
    {
      name: "Heads of RevOps, 50–200 people",
      priority: 1,
      summary:
        "The person who owns CRM hygiene at a company big enough for it to hurt and small enough to still be one person's job.",
      jobTitles: ["Head of Revenue Operations", "RevOps Manager", "Head of Sales Operations"],
      seniority: ["Director", "Manager"],
      industries: ["Software", "Financial Services", "Professional Services"],
      companySize: "51-200",
      geography: ["United Kingdom", "Ireland"],
      triggerEvents: [
        "Hired their first RevOps person in the last 90 days",
        "Posted about CRM cleanup or pipeline reviews",
        "Raised a Series A or B",
      ],
      pains: [
        "Forecast accuracy is argued about every week",
        "Reps update the CRM the night before the review",
        "Nobody agrees which opportunities are real",
      ],
      valueProposition:
        "Northwind tells you which specific deals are rotting, in time to do something about it.",
      hooks: [
        "They just hired into RevOps and inherited the mess",
        "They have posted about forecast accuracy",
        "Their team grew faster than their process",
      ],
      connectionNote:
        "Hi {{first_name}}, we work with RevOps leads at companies around your size on the pipeline-hygiene problem. Thought it might be worth a connection.",
      followUps: [
        {
          delayDays: 3,
          message:
            "Thanks for connecting, {{first_name}}. Most of the RevOps leads we speak to are spending Monday morning arguing about which deals are real. Is that familiar, or have you got that solved?",
        },
        {
          delayDays: 5,
          message:
            "No worries if the timing is off, {{first_name}}. If it is useful later, we put together a short piece on how three teams cut their forecast-review time in half. Happy to send it over.",
        },
      ],
      salesNavFilters: {
        titles: ["Head of Revenue Operations", "RevOps Manager", "Head of Sales Operations"],
        seniorities: ["Director", "Manager"],
        industries: ["Software", "Financial Services"],
        companyHeadcount: ["51-200"],
        geographies: ["United Kingdom", "Ireland"],
        keywords: ["revenue operations", "pipeline"],
        excludeTitles: ["Consultant", "Recruiter"],
      },
    },
    {
      name: "Founders still running sales",
      priority: 2,
      summary:
        "Technical founders past their first hires who are still the best salesperson in the company and know it is a problem.",
      jobTitles: ["Founder", "Co-founder", "CEO"],
      seniority: ["Owner", "CXO"],
      industries: ["Software"],
      companySize: "11-50",
      geography: ["United Kingdom"],
      triggerEvents: ["Hired their first AE", "Raised a seed round"],
      pains: ["No visibility once deals leave their inbox", "Cannot tell if a new rep is working"],
      valueProposition: "See what your first reps are actually doing, without reading every email.",
      hooks: ["They just hired their first AE", "They raised recently", "They post about going to market"],
      connectionNote:
        "Hi {{first_name}}, we work with founders who have just handed sales to their first hires. Would be good to connect.",
      followUps: [
        {
          delayDays: 3,
          message:
            "Thanks for connecting. The founders we speak to usually lose visibility the moment deals stop going through their own inbox. Has that started for you yet?",
        },
        {
          delayDays: 6,
          message:
            "Happy to leave it there, {{first_name}} — if it becomes a problem later, we are easy to find.",
        },
      ],
      salesNavFilters: {
        titles: ["Founder", "Co-founder", "CEO"],
        seniorities: ["Owner", "CXO"],
        industries: ["Software"],
        companyHeadcount: ["11-50"],
        geographies: ["United Kingdom"],
        keywords: ["founder"],
        excludeTitles: ["Investor"],
      },
    },
  ],

  /** Prospects at the range of states a rep would actually be looking at. */
  prospects: [
    {
      key: "priya",
      firstName: "Priya",
      lastName: "Raman",
      title: "Head of Revenue Operations",
      company: "Halberd Software",
      companySize: "51-200",
      industry: "Software",
      location: "London, United Kingdom",
      linkedinUrl: "linkedin.com/in/priya-raman-revops",
      fitScore: 94,
      fitReasons: ["Exact title match", "Company size in band", "UK-based"],
      intentScore: 55,
      signals: [
        { type: "new_role", detail: "Started at Halberd 6 weeks ago", weight: 0.9 },
        { type: "posted_recently", detail: "Posted about forecast reviews", weight: 0.6 },
      ],
      status: "replied",
    },
    {
      key: "dmitri",
      firstName: "Dmitri",
      lastName: "Volkov",
      title: "Head of Sales Operations",
      company: "Camber Financial",
      companySize: "51-200",
      industry: "Financial Services",
      location: "Manchester, United Kingdom",
      linkedinUrl: "linkedin.com/in/dmitri-volkov-salesops",
      fitScore: 88,
      fitReasons: ["Adjacent title", "Right industry and size"],
      intentScore: 30,
      signals: [{ type: "company_hiring", detail: "Hiring two AEs", weight: 0.7 }],
      status: "meeting_booked",
    },
    {
      key: "aoife",
      firstName: "Aoife",
      lastName: "Byrne",
      title: "RevOps Manager",
      company: "Trellis Group",
      companySize: "51-200",
      industry: "Professional Services",
      location: "Dublin, Ireland",
      linkedinUrl: "linkedin.com/in/aoife-byrne-ops",
      fitScore: 82,
      fitReasons: ["Title match", "Geography match"],
      intentScore: 25,
      signals: [{ type: "engaged_with_content", detail: "Commented on our post", weight: 0.8 }],
      status: "messaged_1",
    },
    {
      key: "tomas",
      firstName: "Tomás",
      lastName: "Herrera",
      title: "Director of Operations",
      company: "Nine Elms Capital",
      companySize: "51-200",
      industry: "Financial Services",
      location: "London, United Kingdom",
      linkedinUrl: "linkedin.com/in/tomas-herrera-ops",
      fitScore: 71,
      fitReasons: ["Broader ops title", "Right size"],
      intentScore: 10,
      signals: [],
      status: "accepted",
    },
    {
      key: "hannah",
      firstName: "Hannah",
      lastName: "Okonkwo",
      title: "Head of Revenue Operations",
      company: "Larkfield Health",
      companySize: "201-500",
      industry: "Software",
      location: "Bristol, United Kingdom",
      linkedinUrl: "linkedin.com/in/hannah-okonkwo",
      fitScore: 79,
      fitReasons: ["Title match", "Slightly above size band"],
      intentScore: 40,
      signals: [{ type: "recent_funding", detail: "Series B in July", weight: 0.7 }],
      status: "invited",
    },
    {
      key: "marcus",
      firstName: "Marcus",
      lastName: "Reed",
      title: "Sales Operations Lead",
      company: "Ashcombe Ltd",
      companySize: "51-200",
      industry: "Professional Services",
      location: "Leeds, United Kingdom",
      linkedinUrl: "linkedin.com/in/marcus-reed-ops",
      fitScore: 76,
      fitReasons: ["Adjacent title", "Right size"],
      intentScore: 0,
      signals: [],
      status: "queued",
    },
    {
      key: "elena",
      firstName: "Elena",
      lastName: "Costa",
      title: "Head of Operations",
      company: "Vantage Logistics",
      companySize: "51-200",
      industry: "Logistics",
      location: "London, United Kingdom",
      linkedinUrl: "linkedin.com/in/elena-costa-ops",
      fitScore: 64,
      fitReasons: ["Ops title but wrong industry"],
      intentScore: 5,
      signals: [],
      // Asked not to be contacted; kept so the exclusion is visible on screen.
      status: "opted_out",
      doNotContact: true,
      doNotContactReason: "opted out on LinkedIn",
    },
  ],

  /**
   * One conversation that has gone well and one that needs a human. The held
   * draft is the product's whole argument, so the demo has to show it.
   */
  conversations: [
    {
      prospect: "priya",
      messages: [
        {
          direction: "outbound",
          source: "agent",
          body: "Thanks for connecting, Priya. Most of the RevOps leads we speak to are spending Monday morning arguing about which deals are real. Is that familiar, or have you got that solved?",
          daysAgo: 2,
        },
        {
          direction: "inbound",
          source: "human",
          body: "Ha — familiar. We inherited a fairly grim CRM. What does this cost, roughly? Need to know if it is even in range before I take it further.",
          daysAgo: 1,
          classification: {
            intent: "question",
            sentiment: "positive",
            needsHuman: true,
            needsHumanReason: "pricing question",
            mentionsPricing: true,
            mentionsLegalOrCompliance: false,
            asksForHuman: false,
            optOut: false,
            confidence: 0.93,
          },
        },
      ],
      heldDraft: {
        body: "Glad it lands, Priya. Pricing depends on seats and I would rather quote you properly than guess — I will come back with a number today. On the grim CRM: that is usually where we start, so it is not a blocker.",
        reason: "pricing question",
        unansweredQuestions: ["What does Northwind cost for a team of this size?"],
      },
    },
    {
      prospect: "dmitri",
      messages: [
        {
          direction: "outbound",
          source: "agent",
          body: "Thanks for connecting, Dmitri. Saw you are hiring two AEs — that is usually the point where pipeline visibility starts to hurt. Worth a short conversation?",
          daysAgo: 5,
        },
        {
          direction: "inbound",
          source: "human",
          body: "Yes, good timing actually. Tuesday afternoon works if you have something then.",
          daysAgo: 4,
          classification: {
            intent: "interested",
            sentiment: "positive",
            needsHuman: false,
            needsHumanReason: null,
            mentionsPricing: false,
            mentionsLegalOrCompliance: false,
            asksForHuman: false,
            optOut: false,
            confidence: 0.96,
          },
        },
        {
          direction: "outbound",
          source: "agent",
          body: "Tuesday at 2pm is in the diary and an invitation is on its way. Looking forward to it.",
          daysAgo: 4,
        },
      ],
    },
  ],

  meeting: {
    prospect: "dmitri",
    inDays: 3,
    durationMinutes: 30,
  },
};
