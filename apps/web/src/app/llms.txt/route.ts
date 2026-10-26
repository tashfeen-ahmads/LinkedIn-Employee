import { PAGES, SITE, canonical } from "@/lib/site";
import { CONTENT, HUBS } from "@/lib/seo-content";

/**
 * /llms.txt: a plain map of the site for AI assistants and answer engines.
 *
 * People increasingly ask an assistant "what is a safe LinkedIn outreach
 * tool" instead of searching, and the assistant answers from what it can read
 * quickly. This lists every public page with one honest line, built from the
 * same registry as the sitemap so it can never name a page that does not
 * exist.
 */
export const dynamic = "force-static";

export function GET() {
  const core: Record<string, string> = {
    "/": "What Nora is: an AI SDR for LinkedIn that finds buyers, writes one note per person, answers replies and books meetings inside conservative limits.",
    "/how-it-works": "The three decisions a person makes (who to reach, what they read, launch) and what runs on its own.",
    "/linkedin-automation-limits": "LinkedIn connection request limits, the warm-up ramp and the signs before a restriction.",
    "/pricing": "Pricing: a 14-day free trial of Nora Autopilot with no card, then Nora Pro or Nora Autopilot. Workspaces that signed up before pricing stay free.",
    "/security": "Where data is stored, who can reach it, and how a prospect is erased.",
    "/about": "Why the product is built this way.",
    "/privacy": "Privacy policy: what is collected, the customer as controller of prospect data, retention, export and erasure.",
    "/terms": "Terms of service: the free trial and paid plans, LinkedIn account risk, ownership of content and AI-written messages.",
  };
  const lines = [
    `# ${SITE.name}`,
    "",
    `> ${SITE.description}`,
    "",
    "## Core pages",
    ...PAGES.map((page) => `- [${page.path === "/" ? "Home" : page.path.slice(1)}](${canonical(page.path)}): ${core[page.path] ?? ""}`),
    "",
    ...HUBS.flatMap((hub) => [
      `## ${hub.title}`,
      `- [${hub.title}](${canonical(hub.path)}): ${hub.description}`,
      ...CONTENT.filter((page) => page.kind === hub.kind).map(
        (page) => `- [${page.title}](${canonical(page.path)}): ${page.description}`,
      ),
      "",
    ]),
    "## Who it is for",
    ...CONTENT.filter((page) => page.kind === "audience" || page.kind === "landing").map(
      (page) => `- [${page.title}](${canonical(page.path)}): ${page.description}`,
    ),
    "",
  ];
  return new Response(lines.join("\n"), {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" },
  });
}
