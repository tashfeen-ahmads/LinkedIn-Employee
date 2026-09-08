import type { ReplyIntent } from "@le/shared";

export interface ClassificationCase {
  id: string;
  message: string;
  /** Prior turns, newest last. Most cases need none. */
  history?: Array<{ role: "rep" | "prospect"; text: string }>;
  expect: {
    intent: ReplyIntent;
    /**
     * The label that matters. A false negative here means an AI answered a
     * message a human should have handled, in front of a real prospect.
     */
    needsHuman: boolean;
    optOut?: boolean;
    sentiment?: "positive" | "neutral" | "negative";
  };
  /** Why this case exists, so a future failure is diagnosable. */
  note: string;
}

const KNOWLEDGE_TITLES = ["What we do", "Case study: Northwind", "Implementation timeline"];
export const EVAL_KNOWLEDGE_TITLES = KNOWLEDGE_TITLES;

/**
 * Labelled set for the Reply Agent classifier. Grouped by the decision each
 * case is meant to exercise. Messages are written the way people actually
 * write on LinkedIn: short, lowercase, unpunctuated, often ambiguous.
 */
export const CLASSIFICATION_CASES: ClassificationCase[] = [
  // ---------- safe to automate: clear interest ----------
  {
    id: "interested-plain",
    message: "Sure, happy to chat. What times work on your end?",
    expect: { intent: "interested", needsHuman: false, sentiment: "positive" },
    note: "The straightforward yes. If this needs a human the product has no value.",
  },
  {
    id: "interested-terse",
    message: "yeah go on then",
    expect: { intent: "interested", needsHuman: false },
    note: "Terse and unpunctuated, the way people reply on a phone, but unambiguous.",
  },
  {
    id: "interested-thanks-for-reaching-out",
    message: "Thanks for reaching out — this is timely actually. Would be good to talk.",
    expect: { intent: "interested", needsHuman: false, sentiment: "positive" },
    note: "Warm opener with no question attached, so there is nothing to escalate.",
  },
  {
    id: "interested-accept-slot",
    message: "Tuesday at 2 works for me.",
    history: [{ role: "rep", text: "Would Tuesday 2pm or Thursday 10am suit you?" }],
    expect: { intent: "interested", needsHuman: false, sentiment: "positive" },
    note: "Accepting an offered slot must stay automated or booking never happens.",
  },
  {
    id: "interested-send-info",
    message: "Send over some info and I'll take a look.",
    expect: { intent: "interested", needsHuman: false },
    note: "Asks for material we have on file, not for a fact the knowledge base lacks.",
  },

  // ---------- must reach a human: pricing ----------
  {
    id: "pricing-direct",
    message: "How much does it cost?",
    expect: { intent: "question", needsHuman: true },
    note: "The canonical pricing question. If the gate misses this one, nothing else matters.",
  },
  {
    id: "pricing-indirect",
    message: "What sort of budget would I need to set aside for something like this?",
    expect: { intent: "question", needsHuman: true },
    note: "Pricing without the word price, which keyword matching would miss entirely.",
  },
  {
    id: "pricing-buried",
    message:
      "Interesting. We're a team of about 40 — is there a per-seat thing or is it one flat fee?",
    expect: { intent: "question", needsHuman: true },
    note: "Positive sentiment and a pricing question in one message; the question wins.",
  },
  {
    id: "pricing-discount",
    message: "Do you do discounts for non-profits?",
    expect: { intent: "question", needsHuman: true },
    note: "Discount policy is a commercial decision the agent has no authority to make.",
  },

  // ---------- must reach a human: legal, security, compliance ----------
  {
    id: "legal-soc2",
    message: "Are you SOC 2 compliant? Our security team will ask.",
    expect: { intent: "question", needsHuman: true },
    note: "Security posture claims are exactly what a model must not improvise.",
  },
  {
    id: "legal-gdpr",
    message: "Where is our data stored, and are you GDPR compliant?",
    expect: { intent: "question", needsHuman: true },
    note: "Data residency and GDPR: a wrong answer here is a legal problem, not a lost deal.",
  },
  {
    id: "legal-contract",
    message: "What does your standard contract look like? Any minimum term?",
    expect: { intent: "question", needsHuman: true },
    note: "Contract terms and minimum commitments are the rep's to negotiate, never the agent's.",
  },

  // ---------- must reach a human: asking for a person ----------
  {
    id: "asks-human-direct",
    message: "Am I talking to a bot?",
    expect: { intent: "question", needsHuman: true },
    note: "Answering this one wrong is the reputational failure mode.",
  },
  {
    id: "asks-human-call",
    message: "Can someone just call me? +44 7700 900123",
    expect: { intent: "question", needsHuman: true },
    note: "Explicit request for a person, with a phone number the agent must not act on.",
  },
  {
    id: "asks-human-who",
    message: "Sorry, who are you again and how did you find me?",
    expect: { intent: "question", needsHuman: true },
    note: "Suspicion about the outreach itself; a scripted answer makes it worse.",
  },

  // ---------- must reach a human: negative ----------
  {
    id: "negative-annoyed",
    message: "This is the third message. Please stop.",
    expect: { intent: "not_interested", needsHuman: true, optOut: true, sentiment: "negative" },
    note: "Opt-out and annoyance together, after we already messaged them twice.",
  },
  {
    id: "negative-accusatory",
    message: "Automated spam. Do better.",
    expect: { intent: "not_interested", needsHuman: true, sentiment: "negative" },
    note: "Hostile without an explicit opt-out phrase; must never get an automated reply.",
  },
  {
    id: "negative-competitor",
    message: "We already use one of your competitors and we're happy. Not switching.",
    expect: { intent: "objection", needsHuman: true, sentiment: "negative" },
    note: "A real objection worth a human's judgement.",
  },

  // ---------- opt-outs ----------
  {
    id: "optout-remove",
    message: "Please remove me from your list.",
    expect: { intent: "not_interested", needsHuman: true, optOut: true },
    note: "Unambiguous opt-out; the sequence must stop immediately.",
  },
  {
    id: "optout-not-interested",
    message: "Not interested, thanks.",
    expect: { intent: "not_interested", needsHuman: true, optOut: true },
    note: "Polite but final. The phrasing is soft enough that a classifier can read it as a maybe.",
  },
  {
    id: "optout-unsubscribe",
    message: "unsubscribe",
    expect: { intent: "not_interested", needsHuman: true, optOut: true },
    note: "One word, no context, borrowed from email. Must still stop the sequence.",
  },

  // ---------- soft no, which is NOT an opt-out ----------
  {
    id: "not-now-quarter",
    message: "Not right now — circle back in Q2?",
    expect: { intent: "not_now", needsHuman: false, optOut: false },
    note: "The distinction that decides whether we ever speak to them again.",
  },
  {
    id: "not-now-budget-frozen",
    message: "Budget's frozen until the new financial year, sorry.",
    expect: { intent: "not_now", needsHuman: false, optOut: false },
    note: "A timing no with a concrete date attached, not a permanent rejection.",
  },
  {
    id: "not-now-busy",
    message: "Swamped this month. Try me later?",
    expect: { intent: "not_now", needsHuman: false, optOut: false },
    note: "Explicitly invites a later follow-up, so closing the thread would lose the lead.",
  },

  // ---------- routing ----------
  {
    id: "referral",
    message: "Not my area — you want Priya Raman, she runs RevOps here.",
    expect: { intent: "referral", needsHuman: false },
    note: "A referral is a good outcome to capture and route, not a reason to stop the agent.",
  },
  {
    id: "out-of-office",
    message: "I am currently out of the office until 14 October with limited access to email.",
    expect: { intent: "out_of_office", needsHuman: false },
    note: "An auto-reply must not be treated as a real answer.",
  },

  // ---------- questions the knowledge base cannot answer ----------
  {
    id: "unanswerable-integration",
    message: "Does this integrate with Pipedrive?",
    expect: { intent: "question", needsHuman: true },
    note: "A product fact absent from the knowledge base; inventing it is the failure.",
  },
  {
    id: "unanswerable-headcount",
    message: "How big is your team? Want to know if you'll still be around in two years.",
    expect: { intent: "question", needsHuman: true },
    note: "Company facts we never supplied, which the model would otherwise have to invent.",
  },
  {
    id: "answerable-what-you-do",
    message: "What is it you actually do?",
    expect: { intent: "question", needsHuman: false },
    note: "Covered by the knowledge base, so escalating it would waste the rep's attention.",
  },

  // ---------- ambiguity ----------
  {
    id: "ambiguous-hmm",
    message: "hmm",
    expect: { intent: "other", needsHuman: true },
    note: "Nothing to act on at all; low confidence has to route to a human by itself.",
  },
  {
    id: "ambiguous-maybe",
    message: "maybe",
    expect: { intent: "other", needsHuman: true },
    note: "Could be a yes or a brush-off, and guessing wrong is costly either way.",
  },
  {
    id: "ambiguous-sarcasm",
    message: "Wow, another one of these. Lucky me.",
    expect: { intent: "not_interested", needsHuman: true, sentiment: "negative" },
    note: "Sarcasm read as enthusiasm would produce a cheerful reply to an insult.",
  },
];
