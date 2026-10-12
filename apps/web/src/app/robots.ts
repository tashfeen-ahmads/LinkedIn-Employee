import type { MetadataRoute } from "next";
import { SITE } from "@/lib/site";

// The product itself is behind a login and has nothing to index. Left
// crawlable it would fill the index with redirect chains to /login. Booking
// links and unsubscribe links carry a personal token in the path.
const PRIVATE = ["/app/", "/admin/", "/api/", "/auth/", "/invite/", "/book/", "/unsubscribe", "/onboarding", "/login", "/signup", "/forgot", "/reset-password"];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: PRIVATE },
      /*
       * Named so a future blanket rule cannot shut them out by accident: these
       * are the crawlers behind Bing, ChatGPT search and Perplexity answers,
       * which is where "what is a safe LinkedIn outreach tool" gets asked now.
       */
      { userAgent: ["Bingbot", "OAI-SearchBot", "PerplexityBot"], allow: "/", disallow: PRIVATE },
    ],
    sitemap: `${SITE.url}/sitemap.xml`,
    host: SITE.url,
  };
}
