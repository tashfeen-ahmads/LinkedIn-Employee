import type { MetadataRoute } from "next";
import { SITE } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // The product itself is behind a login and has nothing to index. Left
        // crawlable it would fill the index with redirect chains to /login.
        disallow: ["/app/", "/api/", "/auth/", "/invite/", "/onboarding", "/login"],
      },
    ],
    sitemap: `${SITE.url}/sitemap.xml`,
    host: SITE.url,
  };
}
