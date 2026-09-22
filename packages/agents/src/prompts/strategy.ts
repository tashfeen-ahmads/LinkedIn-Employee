export const STRATEGY_PROMPT_VERSION = "strategy/2026-09-19";

export const STRATEGY_SYSTEM = `You are the Strategy Agent for a B2B sales team. You read what a company publishes about itself and produce the targeting and messaging foundation the rest of the system runs on.

Your output is used directly: the Customer Profiles you write become LinkedIn Sales Navigator searches, and the connection notes you write are sent to real people. Write as if a careful sales leader will read every line, because one will.

Rules:
- Ground every claim in the source material. If the material does not say what a company charges, write "unknown" rather than inventing a price.
- Customer Profiles must be distinguishable from each other. Three profiles that differ only by job title are one profile; find real segments with different pains.
- Sales Navigator filters must use values the platform actually accepts: real job titles, real industries, headcount buckets like "11-50", "51-200", "201-500", "501-1000", "1001-5000", "5001-10000", "10001+".
- Connection notes are under 200 characters, mention no product, contain no link, and read like one professional writing to another. No "I came across your profile", no flattery, no questions the recipient cannot answer in one line.
- Follow-up messages earn the next reply. Lead with something useful, ask for a small commitment, never send a wall of text.
- Trigger events must be observable from outside the company: a funding round, a job posting, a new role, a published article. "Feeling frustrated with their CRM" is not observable.`;

export function strategyUserPrompt(input: {
  websiteUrl?: string;
  linkedinCompanyUrl?: string;
  description?: string;
  websiteText?: string;
  existingCustomers?: string[];
  /**
   * Strategies this workspace already has, when the run is asking for more.
   *
   * The first run writes three to five, which is the right number to read and
   * approve on a first afternoon and the wrong number to run a business on —
   * a company works fifteen or twenty segments. Asked for more without being
   * told what exists, a model rewrites the same three with different nouns, so
   * the names and the segments it already produced are handed back and ruled
   * out explicitly.
   */
  existingProfiles?: { name: string; summary?: string }[];
  /** How many more to write. Only read when `existingProfiles` is present. */
  want?: number;
}): string {
  const parts: string[] = [];
  const expanding = (input.existingProfiles?.length ?? 0) > 0;

  if (expanding) {
    parts.push(
      `This company already runs the Customer Profiles listed below. Write ${input.want ?? 4} MORE, each reaching people the existing ones do not.\n`,
      "Return the same Business Profile you would write from the material — it will be ignored — and spend your effort on the new Customer Profiles.\n",
      "A new profile that differs from an existing one only by job title is a duplicate and is worse than no profile at all: it puts the same people on two lists, and this system refuses to contact anybody twice, so the second list simply finds nobody.\n",
      `Already covered, do not repeat:\n${input
        .existingProfiles!.map((p) => `- ${p.name}${p.summary ? `: ${p.summary}` : ""}`)
        .join("\n")}\n`,
      "Go somewhere genuinely different: an adjacent industry, a different company size, a different buying trigger, a different job function that feels the same pain from another side.\n",
    );
  } else {
    parts.push("Build the Business Profile and 3 to 5 Customer Profiles for this company.\n");
  }
  if (input.websiteUrl) parts.push(`Website: ${input.websiteUrl}`);
  if (input.linkedinCompanyUrl) parts.push(`LinkedIn: ${input.linkedinCompanyUrl}`);
  if (input.description) parts.push(`\nWhat they told us about themselves:\n${input.description}`);
  if (input.existingCustomers?.length) {
    parts.push(
      `\nExisting customers (use these to find the pattern, and rank lookalike profiles highest):\n${input.existingCustomers
        .map((c) => `- ${c}`)
        .join("\n")}`,
    );
  }
  if (input.websiteText) {
    parts.push(`\nText scraped from their site:\n<website>\n${input.websiteText}\n</website>`);
  }
  parts.push(
    expanding
      ? "\nOrder the new Customer Profiles by priority among themselves, 1 being the one to pursue first. Justify that ordering through the priority field alone; do not add commentary outside the schema."
      : "\nOrder the Customer Profiles by priority, 1 being the segment to pursue first. Justify that ordering through the priority field alone; do not add commentary outside the schema.",
  );
  return parts.join("\n");
}
