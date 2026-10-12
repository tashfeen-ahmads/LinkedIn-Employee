# SEO signals checklist for norasdr.com (compiled 2026-10-12)

How this was compiled: WebSearch over primary docs (Google Search Central, Bing, IndexNow) plus trade-press coverage of 2025-2026 changes. Direct page fetches were blocked (developers.google.com did not resolve), so wording is taken from search-result summaries. Items marked [2nd] rest on secondary reporting and should be re-checked against the primary page before anyone relies on them.

Recent update context: core updates Mar, Jun, Dec 2025 (Dec 11-29) and Mar 27-Apr 8 2026 and May 21-~Jun 2 2026; spam updates Aug 26-Sep 22 2025 and Mar 24-25 2026. None came with new policies. Google's standing advice for any core update is the helpful-content self-assessment.
- https://status.search.google.com/incidents/7eTbAa2jWdToLkraZj5y
- https://searchengineland.com/google-december-2025-core-update-rollout-is-now-complete-466362
- https://www.searchenginejournal.com/google-confirms-march-2026-core-update-is-complete/
- https://ppc.land/august-2025-spam-update-completes-four-week-rollout
- https://prioritypixels.co.uk/insights/googles-march-2026-spam-update-has-finished-rolling-out/

## 1. Content quality
- [ ] Write people-first: content made for an existing audience, not built to rank. Google's ranking systems reward helpful, reliable content. https://developers.google.com/search/docs/fundamentals/creating-helpful-content
- [ ] Every article must pass the self-assessment: original information, reporting or analysis; substantial value beyond the other results; something a reader would bookmark or share. https://developers.google.com/search/docs/fundamentals/creating-helpful-content
- [ ] A page that summarises other sources must add substantial originality. Re-wording the top 3 results is the failure case. https://developers.google.com/search/docs/fundamentals/creating-helpful-content
- [ ] Helpfulness is judged site-wide as well as per page, so a block of unhelpful pages can drag down good ones. Prune or improve weak pages instead of adding more. https://developers.google.com/search/docs/fundamentals/creating-helpful-content
- [ ] Show E-E-A-T, with Trust weighted most: first-hand experience (real Nora screenshots, real caps and pacing numbers), a named author with credentials, and sources cited. https://developers.google.com/search/docs/fundamentals/creating-helpful-content
- [ ] Answer "Who, How, Why": a visible byline linked to an author page, disclosure of how the piece was made (including AI assistance where readers would expect it), and a purpose of helping people rather than ranking. https://developers.google.com/search/docs/fundamentals/creating-helpful-content
- [ ] AI-assisted content is allowed. Using automation mainly to manipulate rankings is spam. https://developers.google.com/search/blog/2023/02/google-search-and-ai-content
- [ ] Fact-check all AI-generated text by hand before publishing, including the title, meta description, structured data and alt text [2nd: reported as added 2026-10-01]. https://developers.google.com/search/docs/fundamentals/using-gen-ai-content
- [ ] Raters give the Lowest rating to pages whose main content is all or nearly all AI-generated with little added value, and to paraphrased content that holds only commonly known facts [2nd: QRG Jan/Sep 2025]. https://ppc.land/google-updates-quality-rater-guidelines-with-ai-content-evaluation-criteria/
- [ ] Prefer a few strong pieces over hundreds of thin long-tail variants. Covering every variant with its own page can count as scaled content abuse [2nd: Google 2026 AI search guide]. https://services.google.com/fh/files/misc/2026_seo_in_ai_search_guide_for_marketers.pdf
- [ ] Comparison and alternatives pages (Expandi, Waalaxy and others) must contain first-hand testing and honest trade-offs, never spun vendor copy. Reviews-system guidance favours evidence and original analysis. https://developers.google.com/search/docs/fundamentals/creating-helpful-content
- [ ] Dates: show a visible published/updated date that matches datePublished and dateModified in ISO 8601. Never refresh a date without a substantive change. https://developers.google.com/search/blog/2019/03/help-google-search-know-best-date-for

## 2. On-page
- [ ] Give each page a unique, descriptive, concise <title>. No boilerplate and no keyword repetition. Put the brand first on the homepage only. https://developers.google.com/search/docs/appearance/title-link
- [ ] The <title> text is used for ranking even when Google rewrites the displayed title link, so avoid half-empty or vague titles. https://developers.google.com/search/docs/appearance/title-link
- [ ] Write a unique meta description per page that summarises the page, not a keyword list. Google builds snippets mainly from page content and uses the description when it fits better. https://developers.google.com/search/docs/appearance/snippet
- [ ] Use one clear H1 that matches the topic, then a logical H2/H3 hierarchy (accordions and tabs are fine). https://developers.google.com/search/docs/fundamentals/seo-starter-guide
- [ ] Use short, readable, hyphenated word URLs with a shallow structure (e.g. /blog/linkedin-automation-safety). https://developers.google.com/search/docs/crawling-indexing/url-structure
- [ ] Images: write descriptive alt text (the most important image attribute) without stuffing, and place images near relevant text. https://developers.google.com/search/docs/appearance/google-images
- [ ] Use descriptive image filenames with hyphens, and serve responsive images (srcset/<picture>) in supported formats (WebP/AVIF with fallback). https://developers.google.com/search/docs/appearance/google-images
- [ ] Featured images: at least 1200px wide, plus <meta name="robots" content="max-image-preview:large"> for large previews in Discover and Search [2nd]. https://developers.google.com/search/docs/appearance/google-discover
- [ ] Set og:title, og:description, og:image (1200x630) and og:site_name. Google reads og:site_name as a site-name input. https://developers.google.com/search/docs/appearance/site-names
- [ ] Favicon: at least 48x48px, a multiple of 48, crawlable and declared in <link rel="icon">. https://developers.google.com/search/docs/appearance/favicon-in-search
- [ ] Author byline links to an author page marked up with ProfilePage (Person). https://developers.google.com/search/docs/appearance/structured-data/profile-page

## 3. Technical
- [ ] Indexable HTML: a 200 status, no stray noindex, and the main content, title, canonical and links present in the server HTML (SSR/SSG, not client-only rendering). https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics
- [ ] JS rendering: Google renders JavaScript, but rendering can be delayed. Confirm the rendered HTML with URL Inspection, and do not block JS/CSS in robots.txt. https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics
- [ ] Canonical: a self-referencing rel=canonical on every indexable page, on one host (https, www or non-www chosen once) with 301s from the variants. It is a strong signal, not a directive. https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls
- [ ] Never canonicalise with robots.txt or the removals tool. Keep the sitemap URLs identical to the canonicals. https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls
- [ ] robots.txt controls crawling, not indexing. Use meta robots or X-Robots-Tag noindex, and keep noindexed pages crawlable so the tag can be seen. Google ignores noindex inside robots.txt (since 2019). https://developers.google.com/search/docs/crawling-indexing/block-indexing
- [ ] robots.txt: allow Googlebot and Bingbot everywhere public, disallow /app, /admin and /api, and add a Sitemap: line. https://developers.google.com/search/docs/crawling-indexing/robots/intro
- [ ] XML sitemap: canonical, indexable 200 URLs only, at most 50,000 URLs or 50MB uncompressed per file, with an index file for splits. https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap
- [ ] lastmod must be accurate and only change on a real content or structured-data change. Google ignores changefreq and priority. https://developers.google.com/search/blog/2023/06/sitemaps-lastmod-ping
- [ ] Google's sitemap ping endpoint is gone (404 since end of 2023). Submit via Search Console and the robots.txt Sitemap: line instead. https://developers.google.com/search/blog/2023/06/sitemaps-lastmod-ping
- [ ] Image sitemap entries (or images in the page HTML) for featured images. https://developers.google.com/search/docs/crawling-indexing/sitemaps/image-sitemaps
- [ ] RSS/Atom feed for the blog (full or summary content, canonical URLs, updated timestamps). Google recommends using both a sitemap and a feed: the feed covers recent changes, the sitemap the full set. https://developers.google.com/search/blog/2014/10/best-practices-for-xml-sitemaps-rssatom
- [ ] Add <link rel="alternate" type="application/rss+xml"> in the head for feed discovery. https://developers.google.com/search/blog/2014/10/best-practices-for-xml-sitemaps-rssatom
- [ ] IndexNow: host a key file (8-128 chars, [a-zA-Z0-9-]) at the root and POST changed URLs (same host, up to 10,000 per request) to api.indexnow.org or bing.com/indexnow on publish or update. This reaches Bing, Yandex and others; Google does not use it. https://www.indexnow.org/documentation
- [ ] Bing: verify in Bing Webmaster Tools, submit the sitemap, and use full ISO 8601 lastmod with a time. Bing calls lastmod a key signal for AI-driven indexing [2nd]. https://www.searchenginejournal.com/bing-recommends-lastmod-tags-for-ai-search-indexing/552642/
- [ ] Bing Webmaster Guidelines: ranking draws on relevance, quality/credibility, engagement, freshness, location and page load time. Bing and Copilot share one crawl/index foundation. https://www.bing.com/webmasters/help/webmaster-guidelines-30fba23a
- [ ] Mobile-first indexing is complete (Oct 2023), so mobile must carry the same content, links, structured data and metadata as desktop. https://developers.google.com/search/blog/2023/10/mobile-first-is-here
- [ ] HTTPS everywhere and no intrusive interstitials; both are part of page experience. https://developers.google.com/search/docs/appearance/page-experience
- [ ] Serve proper 404/410 for removed content (no soft 404s) and 301 for moved content, with no redirect chains. https://developers.google.com/search/docs/crawling-indexing/http-network-errors
- [ ] Site name: WebSite structured data with name and alternateName on the homepage, consistent with og:site_name and the H1. Only one site name per domain is supported. https://developers.google.com/search/docs/appearance/site-names

## 4. Structured data (JSON-LD)
- [ ] Use JSON-LD. Markup must describe content that is visible on the page, and having markup does not guarantee a rich result. https://developers.google.com/search/docs/appearance/structured-data/sd-policies
- [ ] Organization on the homepage: name, url, logo (at least 112x112px, crawlable), sameAs (LinkedIn, X, GitHub and other profiles), contactPoint. No property is required, but add as many as apply. https://developers.google.com/search/docs/appearance/structured-data/logo
- [ ] WebSite on the homepage: name and alternateName (Nora / Nora SDR), url. https://developers.google.com/search/docs/appearance/site-names
- [ ] Article/BlogPosting on every post: headline, image (multiple aspect ratios, at least 1200px wide), datePublished, dateModified, and author as Person with name plus url to the author page. Put only the name in author.name. https://developers.google.com/search/docs/appearance/structured-data/article
- [ ] ProfilePage on author pages, with mainEntity as a Person (name, image, sameAs, jobTitle). https://developers.google.com/search/docs/appearance/structured-data/profile-page
- [ ] BreadcrumbList on blog and post pages. Mobile SERPs stopped showing breadcrumbs in Jan 2025, but desktop and Search Console support remain [2nd]. https://developers.google.com/search/docs/appearance/structured-data/breadcrumb
- [ ] SoftwareApplication on the homepage and product page: name, applicationCategory (BusinessApplication), operatingSystem (Web), and offers (price "0", priceCurrency USD while free). Add aggregateRating only with real, visible reviews. Rich-result eligibility needs offers plus aggregateRating or review. https://developers.google.com/search/docs/appearance/structured-data/software-app
- [ ] FAQPage: Google retired FAQ rich results for all sites on 2026-05-07, with Search Console/RRT support removed Jun 2026 and the API in Aug 2026 [2nd]. Keep visible FAQ sections for readers and AI answers. The markup is harmless but earns no rich result. https://developers.google.com/search/docs/appearance/structured-data/faqpage
- [ ] HowTo: rich results were deprecated in 2023 (mobile, then desktop). Do not build for them. https://www.searchenginejournal.com/google-downgrades-visibility-of-howto-and-faq-rich-results/
- [ ] June 2025 simplification removed seven low-use types (Book Actions, Course Info, ClaimReview, Estimated Salary, Learning Video, Special Announcement, Vehicle Listing). None matter for Nora, and the change does not affect ranking. https://developers.google.com/search/blog/2025/06/simplifying-search-results
- [ ] Validate with the Rich Results Test and the Schema Markup Validator, then monitor Search Console enhancement reports. https://developers.google.com/search/docs/appearance/structured-data/logo
- [ ] Never mark up fake reviews, ratings, or invisible content; doing so is a structured-data manual-action risk. https://developers.google.com/search/docs/appearance/structured-data/sd-policies

## 5. Internal linking
- [ ] Links must be <a href="..."> elements. Google cannot reliably follow onclick handlers or <a> tags without an href. https://developers.google.com/search/docs/crawling-indexing/links-crawlable
- [ ] Every page that matters is linked from at least one other page. No orphans; the sitemap alone is not enough. https://developers.google.com/search/docs/crawling-indexing/links-crawlable
- [ ] Anchor text should be descriptive, concise and relevant to both the source and the target. Avoid "click here" and keyword-stuffed anchors. https://developers.google.com/search/docs/crawling-indexing/links-crawlable
- [ ] Image links use the alt text as anchor text, so alt text is required on linked images. https://developers.google.com/search/docs/crawling-indexing/links-crawlable
- [ ] Hub-and-spoke: each cluster pillar links to every supporting article, and each article links back to the pillar and 2-4 siblings. The homepage links to the pillars. (Practice derived from the crawlable-links guidance.) https://developers.google.com/search/docs/crawling-indexing/links-crawlable
- [ ] External links to authoritative sources (e.g. LinkedIn's own limits documentation) add context and trust. Mark paid or affiliate links rel="sponsored" and user content rel="ugc". https://developers.google.com/search/docs/crawling-indexing/qualify-outbound-links
- [ ] Check that JS-inserted links and anchors appear in the rendered HTML (URL Inspection). https://developers.google.com/search/docs/crawling-indexing/links-crawlable

## 6. Performance (page experience / Core Web Vitals)
- [ ] LCP of 2.5s or less, INP of 200ms or less (INP replaced FID in Mar 2024), CLS of 0.1 or less, all at the 75th percentile of field data (CrUX). https://developers.google.com/search/docs/appearance/core-web-vitals
- [ ] CWV feed a page-experience signal that acts as a tie-breaker, not a substitute for relevance. Google's AI-features post still lists fast loading and a clean, device-friendly layout. https://developers.google.com/search/blog/2025/05/succeeding-in-ai-search
- [ ] Never lazy-load the hero/LCP image. Give it fetchpriority="high" and lazy-load images below the fold. https://web.dev/articles/optimize-lcp
- [ ] Set explicit width and height (or aspect-ratio) on every image, embed and ad slot to prevent CLS. https://web.dev/articles/optimize-cls
- [ ] Use static generation for marketing and blog pages, a minimal JS bundle, font-display: swap with preloaded fonts, compressed WebP/AVIF images, and CDN caching. https://web.dev/articles/vitals
- [ ] Keep main-thread tasks short (no heavy third-party scripts on article pages) to protect INP. https://web.dev/articles/optimize-inp

## 7. AI search (AI Overviews, AI Mode, Copilot, ChatGPT, Perplexity)
- [ ] There is no special optimisation for AI Overviews or AI Mode. The page must be indexed and snippet-eligible, and normal SEO applies. https://developers.google.com/search/docs/appearance/ai-features
- [ ] AI Mode and AI Overviews use "query fan-out", issuing many related sub-queries. Covering a topic's sub-questions on one strong page helps it get cited. https://developers.google.com/search/docs/appearance/ai-features
- [ ] Google's May 2025 guidance asks for unique, satisfying, non-commodity content, a good page experience, technical accessibility, preview controls set deliberately, structured data that matches visible text, and quality images and video. https://developers.google.com/search/blog/2025/05/succeeding-in-ai-search
- [ ] Google's 2026 guide says GEO/AEO is SEO. llms.txt, "chunking" and special AI schema are unnecessary [2nd]. https://services.google.com/fh/files/misc/2026_seo_in_ai_search_guide_for_marketers.pdf
- [ ] llms.txt: Google does not use it (Mueller 2025 and 2026; Illyes), and Ahrefs reported 97% of files got zero requests in May 2026. Publishing one is cheap and harmless, but it is not a ranking lever [2nd]. https://seroundtable.com/google-ai-llms-txt-39607.html
- [ ] Preview controls (nosnippet, data-nosnippet, max-snippet) govern use in AI Overviews and AI Mode. Do not set them on pages you want cited. https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag
- [ ] Google-Extended only affects Gemini training and grounding, not Search or AI Overviews inclusion. Blocking it does not remove you from AI Overviews. https://developers.google.com/search/docs/crawling-indexing/google-common-crawlers
- [ ] Allow OAI-SearchBot (ChatGPT search), PerplexityBot and Bingbot (which feeds Copilot) in robots.txt to stay citable. GPTBot, ClaudeBot and CCBot are training crawlers and are a policy choice. Also check the CDN/WAF is not blocking these bots [2nd]. https://platform.openai.com/docs/bots
- [ ] Bing Webmaster Tools AI Performance report (public preview Feb 2026) shows Copilot citations and grounding queries. Use it to measure AI visibility [2nd]. https://searchengineland.com/bing-webmaster-tools-testing-new-ai-performance-report-468039
- [ ] Write answer-first sections: a direct 1-2 sentence answer under each question-style H2, then depth. Put clear entity facts (what Nora is, caps, price: free) in the visible text, consistent with Organization and SoftwareApplication markup. https://developers.google.com/search/blog/2025/05/succeeding-in-ai-search

## 8. Things that get penalised (spam policies / manual actions)
- [ ] Scaled content abuse: many pages made mainly to rank and adding little value, whether by AI, humans or both. This is the biggest risk for an "article engine". Publish only what passes the quality bar. https://developers.google.com/search/docs/essentials/spam-policies
- [ ] Site reputation abuse: hosting third-party content to exploit the site's ranking signals. First-party oversight does not exempt it (Nov 2024 clarification). Do not rent out /blog. https://developers.google.com/search/docs/essentials/spam-policies
- [ ] Expired domain abuse: buying an old domain to host unrelated low-value content. https://developers.google.com/search/docs/essentials/spam-policies
- [ ] Doorway pages: near-duplicate pages per keyword or city that funnel to one destination. Never make "LinkedIn automation for {city}" or {industry} templates without unique value. https://developers.google.com/search/docs/essentials/spam-policies
- [ ] Keyword stuffing, including in alt text and anchors, and hidden text or links (white-on-white, zero font size, off-screen). https://developers.google.com/search/docs/essentials/spam-policies
- [ ] Cloaking or sneaky redirects: serving bots different content from users. https://developers.google.com/search/docs/essentials/spam-policies
- [ ] Link spam: buying or selling links, excessive link exchanges, and large-scale guest-post or PBN schemes. Qualify paid links with rel="sponsored". https://developers.google.com/search/docs/essentials/spam-policies
- [ ] Thin affiliate pages and scraped or spun content. Bing additionally treats copied content as possible copyright infringement. https://developers.google.com/search/docs/essentials/spam-policies
- [ ] Structured-data abuse: fake reviews or ratings, or markup of invisible content. https://developers.google.com/search/docs/appearance/structured-data/sd-policies
- [ ] Fake freshness: bumping dates or lastmod without real changes. It is discounted by Google and Bing and erodes trust in the sitemap. https://developers.google.com/search/blog/2023/06/sitemaps-lastmod-ping
- [ ] Unreviewed AI output, such as factual errors, invented stats or fabricated competitor claims. Raters rate it Lowest, and a false claim about a competitor is also a legal risk. https://developers.google.com/search/docs/fundamentals/using-gen-ai-content
