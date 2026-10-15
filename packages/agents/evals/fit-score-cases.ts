import type { CustomerProfile, ProspectCandidate } from "@le/shared";

/**
 * Labelled prospects for the fit scorer (`scoreProspects` in
 * `src/targeting.ts`).
 *
 * The scorer is the filter between a search result and a spent invitation:
 * anybody it scores at or above `MIN_FIT_TO_QUEUE` and does not disqualify is
 * added to a campaign, reviewed once, and then written to under a real rep's
 * name from a capped daily allowance. So the expensive error is a queued
 * person who would never buy, and the most expensive version of that is the
 * one rule 49 names: a competitor or a peer who matches the profile on title,
 * industry and size, and often on the words in their headline, because they
 * sell the same thing to the same people.
 *
 * The opposite trap is here too. A real buyer usually does not describe their
 * problem in the selling company's vocabulary, and a scorer that matches words
 * rather than need drops exactly those people.
 */

/** Whether the person should end up on a campaign. */
export type FitBand = "fit" | "no_fit";
export const FIT_BANDS: readonly FitBand[] = ["fit", "no_fit"];

/**
 * The resemblance traps.
 *
 * - `competitor`: sells what the company sells, or offers it as a service.
 * - `peer`: shares the company's world, audience and vocabulary, and would
 *   still never buy it (a coach, a networking group, a vendor to the same
 *   customers).
 * - `different_words`: a real buyer whose title and description do not use
 *   the company's vocabulary at all.
 */
export type FitTrap = "competitor" | "peer" | "different_words";
export const FIT_TRAPS: readonly FitTrap[] = ["competitor", "peer", "different_words"];

export interface FitEvalProfile {
  id: string;
  /** What `scoreProspects` is told about the company, exactly as production passes it. */
  business: { oneLiner: string; competitors: string[] };
  profile: CustomerProfile;
}

export interface FitScoreCase {
  id: string;
  profileId: string;
  prospect: {
    firstName: string;
    lastName: string;
    headline: string;
    title: string;
    company: string;
    about: string;
    companySize?: string;
    industry?: string;
    location?: string;
  };
  expect: FitBand;
  trap: FitTrap | null;
  /** Why this case exists, so a future failure is diagnosable. */
  note: string;
}

const US = ["United States"];

function filters(titles: string[], industries: string[], headcount: string[]): CustomerProfile["salesNavFilters"] {
  return {
    titles,
    seniorities: ["Owner", "Partner", "CXO", "Director"],
    industries,
    companyHeadcount: headcount,
    geographies: US,
    keywords: [],
    excludeTitles: ["Intern", "Student"],
  };
}

export const FIT_EVAL_PROFILES: FitEvalProfile[] = [
  {
    id: "referrals",
    business: {
      oneLiner:
        "Referral tracking software that shows small B2B service firms which clients and partners send them work, and reminds them to thank and ask again.",
      competitors: ["In-person business networking groups", "Referral marketplaces", "Spreadsheets and CRM notes"],
    },
    profile: {
      name: "Owners of small B2B service firms that run on referrals",
      summary:
        "Owners and partners of 2 to 50 person accounting, legal, IT and marketing firms in the United States whose new clients mostly arrive through introductions.",
      jobTitles: ["Owner", "Founder", "Managing Partner", "Principal"],
      seniority: ["Owner", "Partner"],
      industries: ["Accounting", "Law Practice", "IT Services and IT Consulting", "Marketing Services"],
      companySize: "2-50",
      geography: US,
      triggerEvents: ["Lost a large client", "Hired a first business development person"],
      pains: [
        "Nobody knows which clients send the most work",
        "Introducers go quiet because nobody thanked them",
        "They track it in a spreadsheet nobody updates",
      ],
      valueProposition: "See who sends you work and keep them sending more.",
      whatTheyBuy:
        "A simple way to see who introduces new clients and to keep those people sending more, paid per firm per month.",
      insteadOfToday: "Memory, a spreadsheet nobody updates, and a thank you card when somebody remembers.",
      salesNavFilters: filters(
        ["Owner", "Founder", "Managing Partner", "Principal"],
        ["Accounting", "Law Practice", "IT Services and IT Consulting", "Marketing Services"],
        ["2-10", "11-50"],
      ),
      hooks: ["Who sent you your last three clients?", "Introducers who never hear back", "Word of mouth you cannot see"],
      connectionNote: "Hi {{first_name}}, I work with small firms that grow by introduction. Would be glad to connect.",
      followUps: [
        { delayDays: 1, message: "Thanks for connecting. How do most of your new clients find you today?" },
        { delayDays: 5, message: "If it is useful, happy to show how firms like yours see who sends them work." },
      ],
      priority: 1,
    },
  },
  {
    id: "dental",
    business: {
      oneLiner:
        "Text message appointment reminders and a waitlist that fills cancellations, cutting no-shows for independent dental practices.",
      competitors: ["Reminder add-ons in practice management systems", "Patient communication platforms", "Front desk phone calls"],
    },
    profile: {
      name: "Independent dental practice owners and managers",
      summary:
        "Owner dentists and the managers who run the schedule at independent practices with one to three locations in the United States.",
      jobTitles: ["Owner", "Dentist", "Practice Manager", "Office Manager"],
      seniority: ["Owner", "Manager"],
      industries: ["Medical Practices"],
      companySize: "2-50",
      geography: US,
      triggerEvents: ["Opened a second location", "Front desk turnover"],
      pains: ["Empty chairs from no-shows", "Front desk spends mornings on confirmation calls", "Cancellations nobody backfills"],
      valueProposition: "Fewer empty chairs without more phone calls.",
      whatTheyBuy:
        "Fewer empty chairs: automatic reminders and a waitlist that fills cancellations, paid monthly per location.",
      insteadOfToday:
        "The front desk calls every patient the day before and works through a paper list when somebody cancels.",
      salesNavFilters: filters(
        ["Owner", "Dentist", "Practice Manager", "Office Manager"],
        ["Medical Practices"],
        ["2-10", "11-50"],
      ),
      hooks: ["Mornings spent on confirmation calls", "The cancellation nobody filled", "Chairs empty at 2pm"],
      connectionNote: "Hi {{first_name}}, I talk with a lot of independent practices about keeping the schedule full.",
      followUps: [
        { delayDays: 1, message: "Thanks for connecting. How does your front desk handle same day cancellations?" },
        { delayDays: 6, message: "Happy to share what other independent practices changed to cut no-shows." },
      ],
      priority: 1,
    },
  },
  {
    id: "coldchain",
    business: {
      oneLiner:
        "Wireless temperature sensors and automatic food safety logs for multi-location restaurant groups.",
      competitors: ["Paper temperature logs", "Food safety sensor vendors", "Commercial refrigeration service contracts"],
    },
    profile: {
      name: "Operations leaders at multi-unit restaurant groups",
      summary:
        "The people responsible for every kitchen across a restaurant group with 5 to 200 locations in the United States.",
      jobTitles: ["Director of Operations", "VP Operations", "COO", "Area Manager"],
      seniority: ["Director", "VP", "CXO"],
      industries: ["Restaurants", "Food and Beverage Services"],
      companySize: "51-1000",
      geography: US,
      triggerEvents: ["A failed health inspection", "Opening new units"],
      pains: ["A cooler fails overnight and nobody knows until morning", "Clipboard logs are incomplete on inspection day"],
      valueProposition: "Know before the food is lost, and never rebuild a temperature log by hand.",
      whatTheyBuy:
        "Sensors in every walk-in, an alert before food is lost, and inspection ready logs, priced per location.",
      insteadOfToday:
        "Line cooks write temperatures on a clipboard twice a day, and a cooler that fails overnight is found in the morning.",
      salesNavFilters: filters(
        ["Director of Operations", "VP Operations", "COO", "Area Manager"],
        ["Restaurants", "Food and Beverage Services"],
        ["51-200", "201-500", "501-1000"],
      ),
      hooks: ["The walk-in that quit on a Saturday", "Inspection day binders", "Clipboards nobody fills in"],
      connectionNote: "Hi {{first_name}}, I work with multi-unit operators on food safety. Would be glad to connect.",
      followUps: [
        { delayDays: 1, message: "Thanks for connecting. How do your kitchens log cooler temperatures today?" },
        { delayDays: 5, message: "Happy to show how other groups catch a failing cooler before the food is lost." },
      ],
      priority: 1,
    },
  },
  {
    id: "outbound",
    business: {
      oneLiner:
        "An AI sales assistant that finds, invites and follows up with prospects on LinkedIn for founders who do their own selling.",
      competitors: ["LinkedIn automation tools", "Outsourced SDR agencies", "Hiring a junior SDR"],
    },
    profile: {
      name: "Founders of small B2B companies who sell themselves",
      summary:
        "Founders and owners of 2 to 50 person B2B companies in the United States with no sales team, where the founder is the whole pipeline.",
      jobTitles: ["Founder", "Co-founder", "CEO", "Owner"],
      seniority: ["Owner", "CXO"],
      industries: ["Software Development", "Business Consulting and Services", "Manufacturing"],
      companySize: "2-50",
      geography: US,
      triggerEvents: ["Raised a first round", "Lost their only sales hire"],
      pains: ["Selling stops whenever delivery gets busy", "No time to prospect", "Pipeline is lumpy"],
      valueProposition: "A steady pipeline without hiring a sales team.",
      whatTheyBuy: "Prospecting done for them on LinkedIn, so new conversations start every week, paid monthly.",
      insteadOfToday: "The founder prospects in the evenings when there is time, which is rarely, or not at all.",
      salesNavFilters: filters(
        ["Founder", "Co-founder", "CEO", "Owner"],
        ["Software Development", "Business Consulting and Services", "Manufacturing"],
        ["2-10", "11-50"],
      ),
      hooks: ["Selling stops when delivery gets busy", "Pipeline that comes in waves", "Prospecting at 10pm"],
      connectionNote: "Hi {{first_name}}, I talk with founders who still run their own sales. Glad to connect.",
      followUps: [
        { delayDays: 1, message: "Thanks for connecting. Who finds new customers for the company today?" },
        { delayDays: 6, message: "Happy to show how founders like you keep conversations starting every week." },
      ],
      priority: 1,
    },
  },
];

/**
 * The labelled set. Grouped by profile; within each, the plain fits first, then
 * the traps, then the plainly wrong. Every label is about whether the person
 * would buy, never about whether they resemble the profile.
 */
export const FIT_SCORE_CASES: FitScoreCase[] = [
  // ---------------------------------------------------------- referrals
  {
    id: "ref-bookkeeping-owner",
    profileId: "referrals",
    prospect: {
      firstName: "Dana",
      lastName: "Ruiz",
      headline: "Owner at Ruiz Bookkeeping | Monthly books for contractors and clinics",
      title: "Owner",
      company: "Ruiz Bookkeeping",
      companySize: "2-10",
      industry: "Accounting",
      location: "Tucson, Arizona, United States",
      about:
        "Nine of us. Almost every client we have came from another client or from the two attorneys we have worked beside for a decade.",
    },
    expect: "fit",
    trap: null,
    note: "The plain yes: owner, right size and industry, and says outright that work arrives by introduction.",
  },
  {
    id: "ref-cpa-word-of-mouth",
    profileId: "referrals",
    prospect: {
      firstName: "Martin",
      lastName: "Hale",
      headline: "Tax and advisory for family businesses",
      title: "Managing Partner",
      company: "Harlow & Pike CPAs",
      companySize: "11-50",
      industry: "Accounting",
      location: "Columbus, Ohio, United States",
      about:
        "We have never advertised and never will. New work comes from word of mouth, our bankers, and a couple of estate lawyers who trust us with their clients.",
    },
    expect: "fit",
    trap: "different_words",
    note: "A real buyer who never says referral, tracking or partner program. Word of mouth from bankers and lawyers is exactly the problem.",
  },
  {
    id: "ref-msp-founder",
    profileId: "referrals",
    prospect: {
      firstName: "Priya",
      lastName: "Natarajan",
      headline: "Founder, Northgate IT | Managed IT for law firms and medical offices",
      title: "Founder",
      company: "Northgate IT",
      companySize: "11-50",
      industry: "IT Services and IT Consulting",
      location: "Raleigh, North Carolina, United States",
      about: "Fourteen engineers. Our best clients came to us through their accountants and their landlords' facilities teams.",
    },
    expect: "fit",
    trap: null,
    note: "Different industry from the accountants, same need: introductions from partners nobody tracks.",
  },
  {
    id: "ref-agency-principal",
    profileId: "referrals",
    prospect: {
      firstName: "Owen",
      lastName: "Brady",
      headline: "Principal at Fernway Studio, brand and web for professional services",
      title: "Principal",
      company: "Fernway Studio",
      companySize: "2-10",
      industry: "Marketing Services",
      location: "Denver, Colorado, United States",
      about: "Every client we have landed came through somebody we had already worked with. I would like to know who to thank.",
    },
    expect: "fit",
    trap: null,
    note: "Small agency principal who describes the pain in plain language.",
  },
  {
    id: "ref-networking-chapter-director",
    profileId: "referrals",
    prospect: {
      firstName: "Lisa",
      lastName: "Moreno",
      headline: "Executive Director | Weekly referral networking for business owners across North Texas",
      title: "Executive Director",
      company: "Lone Star Referral Network",
      companySize: "2-10",
      industry: "Business Consulting and Services",
      location: "Dallas, Texas, United States",
      about:
        "I run twelve chapters of business owners who meet every week to pass each other referrals. We help members track the business they give and receive.",
    },
    expect: "no_fit",
    trap: "peer",
    note: "The rule 49 case itself: a networking group leader matches on owner title and referral vocabulary, and is the business this product replaces.",
  },
  {
    id: "ref-software-founder",
    profileId: "referrals",
    prospect: {
      firstName: "Ethan",
      lastName: "Cole",
      headline: "Co-founder & CEO at Referrly | Referral automation for professional services firms",
      title: "Co-founder & CEO",
      company: "Referrly",
      companySize: "11-50",
      industry: "Software Development",
      location: "Boston, Massachusetts, United States",
      about: "We help accounting and law firms turn happy clients into a referral engine with automated tracking and reminders.",
    },
    expect: "no_fit",
    trap: "competitor",
    note: "Founder title, right size, the company's own words in the headline. Sells the same product and will never buy it.",
  },
  {
    id: "ref-referral-consultant",
    profileId: "referrals",
    prospect: {
      firstName: "Grace",
      lastName: "Whitfield",
      headline: "Referral marketing consultant | I help accountants build referral systems that run themselves",
      title: "Owner",
      company: "Whitfield Growth",
      companySize: "2-10",
      industry: "Marketing Services",
      location: "Nashville, Tennessee, United States",
      about: "Twelve years helping CPA firms set up partner programs, introducer tracking and thank you cadences.",
    },
    expect: "no_fit",
    trap: "competitor",
    note: "Owner of a two-person marketing firm, which matches every field; offers the product as a service, which the prompt disqualifies.",
  },
  {
    id: "ref-uk-accountant",
    profileId: "referrals",
    prospect: {
      firstName: "Tom",
      lastName: "Ashworth",
      headline: "Owner, Ashworth & Co Chartered Accountants",
      title: "Owner",
      company: "Ashworth & Co",
      companySize: "11-50",
      industry: "Accounting",
      location: "Manchester, England, United Kingdom",
      about: "Most of our clients come to us through solicitors and existing clients.",
    },
    expect: "no_fit",
    trap: null,
    note: "A perfect fit in every respect except geography, which the prompt says to disqualify on.",
  },
  {
    id: "ref-bank-engineer",
    profileId: "referrals",
    prospect: {
      firstName: "Kevin",
      lastName: "Osei",
      headline: "Senior Software Engineer, payments platform",
      title: "Senior Software Engineer",
      company: "First Continental Bank",
      companySize: "10001+",
      industry: "Banking",
      location: "Charlotte, North Carolina, United States",
      about: "Java, Kafka and a lot of reconciliation jobs.",
    },
    expect: "no_fit",
    trap: null,
    note: "Plainly the wrong person. A scorer that queues this is not reading the profile at all.",
  },
  {
    id: "ref-accounting-student",
    profileId: "referrals",
    prospect: {
      firstName: "Maya",
      lastName: "Chen",
      headline: "Accounting student at Ohio State | Seeking audit internships for summer",
      title: "Student",
      company: "The Ohio State University",
      companySize: "10001+",
      industry: "Higher Education",
      location: "Columbus, Ohio, United States",
      about: "Junior studying accounting. Interested in small firm practice.",
    },
    expect: "no_fit",
    trap: null,
    note: "Right industry words, but a student, which the prompt disqualifies outright.",
  },

  // ---------------------------------------------------------- dental
  {
    id: "dental-owner-dentist",
    profileId: "dental",
    prospect: {
      firstName: "Rachel",
      lastName: "Kim",
      headline: "Dentist and owner, Maple Grove Family Dental",
      title: "Owner",
      company: "Maple Grove Family Dental",
      companySize: "11-50",
      industry: "Medical Practices",
      location: "Maple Grove, Minnesota, United States",
      about: "Two locations, eleven chairs, and a team that treats patients like neighbors.",
    },
    expect: "fit",
    trap: null,
    note: "The plain yes: owner dentist of an independent two-location practice.",
  },
  {
    id: "dental-practice-administrator",
    profileId: "dental",
    prospect: {
      firstName: "Angela",
      lastName: "Price",
      headline: "Practice Administrator at Brightside Smiles",
      title: "Practice Administrator",
      company: "Brightside Smiles",
      companySize: "11-50",
      industry: "Medical Practices",
      location: "Plano, Texas, United States",
      about:
        "My job is keeping the schedule full. Most mornings start with the front desk ringing people who did not confirm, and the afternoon gaps are the ones I lose sleep over.",
    },
    expect: "fit",
    trap: "different_words",
    note: "Never says no-show, reminder or waitlist, and the title is not on the list, but this is the person who owns the empty chair problem.",
  },
  {
    id: "dental-office-manager",
    profileId: "dental",
    prospect: {
      firstName: "Luis",
      lastName: "Ortega",
      headline: "Office Manager, Little Teeth Pediatric Dentistry",
      title: "Office Manager",
      company: "Little Teeth Pediatric Dentistry",
      companySize: "11-50",
      industry: "Medical Practices",
      location: "San Antonio, Texas, United States",
      about: "Running the front office for a busy pediatric practice since 2017.",
    },
    expect: "fit",
    trap: null,
    note: "Listed title at the right kind of practice, no stated pain. Should still clear the bar on role alone.",
  },
  {
    id: "dental-reminder-vendor-ae",
    profileId: "dental",
    prospect: {
      firstName: "Brandon",
      lastName: "Fisk",
      headline: "Account Executive at RecallRight | Helping dental practices reduce no-shows with automated reminders",
      title: "Account Executive",
      company: "RecallRight",
      companySize: "51-200",
      industry: "Software Development",
      location: "Salt Lake City, Utah, United States",
      about: "I talk to practice managers all day about empty chairs, confirmations and waitlists.",
    },
    expect: "no_fit",
    trap: "competitor",
    note: "The company's whole vocabulary in one headline. Sells a reminder platform to the same buyers.",
  },
  {
    id: "dental-growth-coach",
    profileId: "dental",
    prospect: {
      firstName: "Sheila",
      lastName: "Grant",
      headline: "Dental practice growth coach | I help dentists fill their schedules and keep them full",
      title: "Owner",
      company: "Full Chair Coaching",
      companySize: "2-10",
      industry: "Business Consulting and Services",
      location: "Scottsdale, Arizona, United States",
      about: "Former office manager. I train front desks on confirmation scripts and cancellation lists.",
    },
    expect: "no_fit",
    trap: "peer",
    note: "Owner title, dental world, the exact pain. Sells schedule fixes to dentists and has no chairs to fill.",
  },
  {
    id: "dental-equipment-rep",
    profileId: "dental",
    prospect: {
      firstName: "Derek",
      lastName: "Lyons",
      headline: "Territory Manager, dental equipment and imaging | Serving independent practices across Georgia",
      title: "Territory Manager",
      company: "Summit Dental Supply",
      companySize: "501-1000",
      industry: "Medical Equipment Manufacturing",
      location: "Atlanta, Georgia, United States",
      about: "I help independent dentists choose chairs, sensors and CBCT units.",
    },
    expect: "no_fit",
    trap: "peer",
    note: "Speaks to the same independent practices in the same language, and sells to them rather than buying for one.",
  },
  {
    id: "dental-lab-owner",
    profileId: "dental",
    prospect: {
      firstName: "Hiro",
      lastName: "Tanaka",
      headline: "Owner, Precision Crown Lab",
      title: "Owner",
      company: "Precision Crown Lab",
      companySize: "11-50",
      industry: "Medical Equipment Manufacturing",
      location: "Portland, Oregon, United States",
      about: "Crowns, bridges and implant restorations for dentists across the Northwest.",
    },
    expect: "no_fit",
    trap: null,
    note: "Owner, right size, dental, and has no patients to remind. Adjacent at best.",
  },
  {
    id: "dental-hospital-it",
    profileId: "dental",
    prospect: {
      firstName: "Nora",
      lastName: "Feld",
      headline: "IT Project Manager, EHR integrations",
      title: "IT Project Manager",
      company: "Lakeshore Health System",
      companySize: "10001+",
      industry: "Hospitals and Health Care",
      location: "Chicago, Illinois, United States",
      about: "Epic go-lives and interface work for a twelve hospital system.",
    },
    expect: "no_fit",
    trap: null,
    note: "Healthcare words, wrong person, wrong organization.",
  },

  // ---------------------------------------------------------- coldchain
  {
    id: "cold-director-ops",
    profileId: "coldchain",
    prospect: {
      firstName: "Marcus",
      lastName: "Webb",
      headline: "Director of Operations at Greenleaf Kitchen | 22 fast casual locations",
      title: "Director of Operations",
      company: "Greenleaf Kitchen",
      companySize: "501-1000",
      industry: "Restaurants",
      location: "Atlanta, Georgia, United States",
      about: "Responsible for every kitchen, every opening and every inspection across three states.",
    },
    expect: "fit",
    trap: null,
    note: "The plain yes: the listed title at a multi-unit group, and owns inspections.",
  },
  {
    id: "cold-vp-culinary",
    profileId: "coldchain",
    prospect: {
      firstName: "Elena",
      lastName: "Vasquez",
      headline: "VP Culinary & Kitchen Systems, Fieldstone Hospitality",
      title: "VP Culinary & Kitchen Systems",
      company: "Fieldstone Hospitality",
      companySize: "201-500",
      industry: "Restaurants",
      location: "Austin, Texas, United States",
      about:
        "Last summer we threw out two walk-ins of product after a compressor quit on a Saturday night. I want fewer surprises and a cleaner binder for the health inspector.",
    },
    expect: "fit",
    trap: "different_words",
    note: "Says culinary, not operations, and never says sensor or monitoring. Describes the exact loss the product prevents.",
  },
  {
    id: "cold-pizza-coo",
    profileId: "coldchain",
    prospect: {
      firstName: "Sam",
      lastName: "DeLuca",
      headline: "COO, Slice Brothers Pizza (12 units and growing)",
      title: "COO",
      company: "Slice Brothers Pizza",
      companySize: "201-500",
      industry: "Restaurants",
      location: "Pittsburgh, Pennsylvania, United States",
      about: "Opening four more stores this year.",
    },
    expect: "fit",
    trap: null,
    note: "Listed title, multi-unit, a trigger event (opening units) in the about.",
  },
  {
    id: "cold-sensor-sales",
    profileId: "coldchain",
    prospect: {
      firstName: "Jordan",
      lastName: "Pike",
      headline: "Regional Sales Manager, FreshSense | Wireless temperature monitoring for restaurant groups",
      title: "Regional Sales Manager",
      company: "FreshSense",
      companySize: "51-200",
      industry: "Restaurants",
      location: "Phoenix, Arizona, United States",
      about: "I help multi-unit operators replace clipboard temperature logs with sensors and alerts.",
    },
    expect: "no_fit",
    trap: "competitor",
    note: "Lists Restaurants as the industry and uses the company's own pitch. A direct competitor.",
  },
  {
    id: "cold-haccp-founder",
    profileId: "coldchain",
    prospect: {
      firstName: "Aisha",
      lastName: "Bello",
      headline: "Founder, ColdChain Labs | Building the HACCP sensor platform for food service",
      title: "Founder",
      company: "ColdChain Labs",
      companySize: "11-50",
      industry: "Software Development",
      location: "San Francisco, California, United States",
      about: "Former restaurant operator building what I wished I had: automatic food safety logs.",
    },
    expect: "no_fit",
    trap: "competitor",
    note: "Former operator, restaurant words, and now builds the same product. The background makes the resemblance stronger.",
  },
  {
    id: "cold-food-safety-consultant",
    profileId: "coldchain",
    prospect: {
      firstName: "Gary",
      lastName: "Lund",
      headline: "Food safety consultant and HACCP trainer | Helping restaurant groups pass every inspection",
      title: "Principal Consultant",
      company: "Lund Food Safety",
      companySize: "2-10",
      industry: "Restaurants",
      location: "Denver, Colorado, United States",
      about: "Audits, temperature log reviews and inspection prep for multi-unit operators.",
    },
    expect: "no_fit",
    trap: "peer",
    note: "Same audience, same inspection vocabulary, and sells food safety as a service rather than running a kitchen.",
  },
  {
    id: "cold-refrigeration-contractor",
    profileId: "coldchain",
    prospect: {
      firstName: "Ray",
      lastName: "Castillo",
      headline: "Owner, Castillo Commercial Refrigeration | Walk-in and reach-in service for restaurants",
      title: "Owner",
      company: "Castillo Commercial Refrigeration",
      companySize: "11-50",
      industry: "Construction",
      location: "Houston, Texas, United States",
      about: "24 hour service contracts for restaurant groups across Houston.",
    },
    expect: "no_fit",
    trap: "competitor",
    note: "Sells refrigeration service contracts, which the business names as a competitor. Talks about walk-ins all day.",
  },
  {
    id: "cold-warehouse-ops",
    profileId: "coldchain",
    prospect: {
      firstName: "Tina",
      lastName: "Holloway",
      headline: "Director of Operations | E-commerce fulfillment",
      title: "Director of Operations",
      company: "Parcel Point Logistics",
      companySize: "201-500",
      industry: "Transportation, Logistics, Supply Chain and Storage",
      location: "Memphis, Tennessee, United States",
      about: "Three dry goods warehouses, peak season planning, labor scheduling.",
    },
    expect: "no_fit",
    trap: null,
    note: "Exact title match and nothing else. A scorer weighting titles queues this.",
  },

  // ---------------------------------------------------------- outbound
  {
    id: "out-saas-founder",
    profileId: "outbound",
    prospect: {
      firstName: "Leah",
      lastName: "Park",
      headline: "Founder & CEO, Shiftboard | Scheduling software for home care agencies",
      title: "Founder & CEO",
      company: "Shiftboard",
      companySize: "11-50",
      industry: "Software Development",
      location: "Minneapolis, Minnesota, United States",
      about: "Fifteen of us. I still run every sales call myself, usually after the product meeting.",
    },
    expect: "fit",
    trap: null,
    note: "The plain yes: founder of a small B2B company who says they are the sales team.",
  },
  {
    id: "out-coatings-owner",
    profileId: "outbound",
    prospect: {
      firstName: "Walt",
      lastName: "Brennan",
      headline: "Owner, Keel Industrial Coatings",
      title: "Owner",
      company: "Keel Industrial Coatings",
      companySize: "11-50",
      industry: "Manufacturing",
      location: "Toledo, Ohio, United States",
      about:
        "We sell to plant managers. Business development is me, a phone and a trade show twice a year, and it shows in the months after the shows.",
    },
    expect: "fit",
    trap: "different_words",
    note: "Never says pipeline, outbound or prospecting. A manufacturer whose founder is the only seller is exactly the buyer.",
  },
  {
    id: "out-consultancy-cofounder",
    profileId: "outbound",
    prospect: {
      firstName: "Arjun",
      lastName: "Mehta",
      headline: "Co-founder, Tidewater Data | Data engineering for mid-market retailers",
      title: "Co-founder",
      company: "Tidewater Data",
      companySize: "2-10",
      industry: "Business Consulting and Services",
      location: "Seattle, Washington, United States",
      about: "Six engineers. We only sell when a project ends, so the next one never starts on time.",
    },
    expect: "fit",
    trap: null,
    note: "Small consultancy whose about is the profile's pain about lumpy pipeline.",
  },
  {
    id: "out-sdr-agency",
    profileId: "outbound",
    prospect: {
      firstName: "Chris",
      lastName: "Vaughn",
      headline: "Founder, Bookline Outbound | We book qualified meetings for B2B SaaS founders on LinkedIn",
      title: "Founder",
      company: "Bookline Outbound",
      companySize: "11-50",
      industry: "Business Consulting and Services",
      location: "Miami, Florida, United States",
      about: "Done for you LinkedIn prospecting. Our SDRs run your account and fill your calendar.",
    },
    expect: "no_fit",
    trap: "competitor",
    note: "A founder of a 20-person B2B services firm, which matches every field. An outsourced SDR agency is a named competitor.",
  },
  {
    id: "out-social-selling-coach",
    profileId: "outbound",
    prospect: {
      firstName: "Brooke",
      lastName: "Allen",
      headline: "Social selling coach | I teach founders to turn LinkedIn into a pipeline",
      title: "Founder",
      company: "Brooke Allen Coaching",
      companySize: "2-10",
      industry: "Business Consulting and Services",
      location: "Charlotte, North Carolina, United States",
      about: "Workshops and one to one coaching on LinkedIn outreach for founders who hate selling.",
    },
    expect: "no_fit",
    trap: "peer",
    note: "Founder, small, same audience and the same pitch about founders and LinkedIn. Sells the skill; would not buy the tool.",
  },
  {
    id: "out-automation-tool-growth",
    profileId: "outbound",
    prospect: {
      firstName: "Nate",
      lastName: "Sorensen",
      headline: "Head of Growth at Linkflow | LinkedIn automation for sales teams",
      title: "Head of Growth",
      company: "Linkflow",
      companySize: "11-50",
      industry: "Software Development",
      location: "Austin, Texas, United States",
      about: "Growing the safest LinkedIn automation tool on the market.",
    },
    expect: "no_fit",
    trap: "competitor",
    note: "Builds a LinkedIn automation tool, which the business names as a competitor.",
  },
  {
    id: "out-open-to-work",
    profileId: "outbound",
    prospect: {
      firstName: "Ivy",
      lastName: "Thompson",
      headline: "Open to work | Former Account Executive | B2B SaaS sales",
      title: "Seeking new opportunities",
      company: "",
      location: "Chicago, Illinois, United States",
      about: "Six years closing mid-market SaaS deals. Looking for my next AE role.",
    },
    expect: "no_fit",
    trap: null,
    note: "Open to work with no company, which the prompt disqualifies. Sales words throughout.",
  },
  {
    id: "out-hospital-hr",
    profileId: "outbound",
    prospect: {
      firstName: "Paul",
      lastName: "Nguyen",
      headline: "HR Business Partner, nursing and allied health",
      title: "HR Business Partner",
      company: "Riverbend Medical Center",
      companySize: "5001-10000",
      industry: "Hospitals and Health Care",
      location: "Sacramento, California, United States",
      about: "Workforce planning and employee relations.",
    },
    expect: "no_fit",
    trap: null,
    note: "Plainly the wrong person, as a floor for the set.",
  },
];

/** What production hands the scorer, built from one case. */
export function toCandidate(testCase: FitScoreCase): ProspectCandidate {
  const { prospect } = testCase;
  return {
    providerId: testCase.id,
    linkedinUrl: `https://www.linkedin.com/in/fit-eval-${testCase.id}`,
    firstName: prospect.firstName,
    lastName: prospect.lastName,
    headline: prospect.headline,
    title: prospect.title,
    company: prospect.company || undefined,
    companySize: prospect.companySize,
    industry: prospect.industry,
    location: prospect.location,
    about: prospect.about,
    signals: [],
  };
}
