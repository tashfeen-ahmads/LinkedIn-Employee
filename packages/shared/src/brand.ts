/**
 * The product's name and its two hosts, in one place.
 *
 * The name was a string literal in eight shipped files — the wordmark, the page
 * metadata, three email templates, the calendar invitation's PRODID, the lead
 * source written into a customer's CRM, and the line stamped on a booked
 * meeting. Renaming meant finding all eight, and a rename that finds seven
 * ships a product that calls itself two different things to the same person:
 * one name on the screen they signed up on, another on the calendar invitation
 * a prospect receives. `packages/shared/test/brand.test.ts` is what keeps the
 * eighth from coming back.
 *
 * `name` is what a person reads. `full` is for the places where the name sits
 * among strangers and has to identify itself — a lead source in somebody's
 * Salesforce, a PRODID in a calendar file — where "Nora" alone says nothing.
 *
 * Nothing here ever reaches a prospect inside a message. Outreach goes out
 * under the rep's own name and in their own voice; the brand appears only on
 * our own surfaces and on the artefacts we generate (a calendar invitation, a
 * CRM record), which is why the two are separate strings rather than one.
 */
export const BRAND = {
  name: "Nora",
  full: "Nora SDR",
  tagline: "Your AI SDR for LinkedIn",
  /**
   * The marketing site. Two hosts on purpose: a dashboard worked in daily and
   * a site read once want different things, and one page answering on both
   * URLs is a duplicate to a search engine and a coin toss to a reader.
   */
  site: "https://norasdr.com",
  /** Where the product itself lives, and the only host that holds a session. */
  app: "https://app.norasdr.com",

  /**
   * What a customer gets, in the words they would use. Not "AI-powered
   * outreach automation" — the outcome, and the cost of the alternative.
   */
  promise: "Meetings from LinkedIn, at a pace that keeps your account safe.",

  /**
   * The two brand colours, and the only place they exist outside the
   * stylesheet.
   *
   * They have to be literals here because the surfaces that need them cannot
   * read CSS: the favicon and the link-preview card are rendered by Satori,
   * which lays out a subset of CSS and has never heard of a custom property.
   * Two representations of one colour is exactly the drift rule 38 is about,
   * so `apps/web/test/brand-tokens.test.ts` reads `--accent` and `--accent-2`
   * out of the stylesheet and fails if they have moved apart. A favicon in
   * last season's blue is the kind of thing nobody ever reports.
   */
  color: {
    /** `--accent`. The plate, and the letter when it has no plate. */
    accent: "#3730E8",
    /** `--accent-2`. The line the mark stops short of, and nothing else. */
    limit: "#12A5A0",
  },
} as const;

/**
 * The marketing site's origin, given whatever `NEXT_PUBLIC_SITE_URL` holds, so
 * a preview deploy is canonical to itself rather than to production.
 *
 * The environment is passed in rather than read here: this package compiles
 * without node types on purpose, and it is imported by the browser bundle as
 * well as the worker. A trailing slash is stripped because these are joined
 * with a path, and `${url}/app` on a pasted-in value produced `//app`.
 */
export function siteOrigin(env: string | undefined): string {
  return (env ?? BRAND.site).replace(/\/$/, "");
}

/**
 * The dashboard's origin, given whatever `APP_URL` holds. It matters more than
 * the one above: it is the redirect target Supabase sends people back to after
 * a sign-in, so a preview pointing at production drops them on the wrong host
 * holding a session that host cannot see.
 *
 * The fallback is production rather than localhost. A deployment that forgot
 * the variable should send people to the real product; only a developer has
 * localhost, and `.env.example` gives them it.
 */
export function appOrigin(env: string | undefined): string {
  return (env ?? BRAND.app).replace(/\/$/, "");
}
