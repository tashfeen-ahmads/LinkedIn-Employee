import { z } from "zod";

/**
 * A scheme, a host, and nothing that only looks like a URL.
 *
 * `new URL("api58.unipile.com:18893")` does not throw — it parses as the
 * scheme `api58.unipile.com:` with the path `18893`, which is why a missing
 * `https://` gets all the way to `fetch` before failing.
 */
/** `https://example.com/` and `https://example.com` name the same origin. */
function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

const EnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  /**
   * The model provider. One key is enough: whichever of these is set decides,
   * and LLM_PROVIDER only matters when both are. A deployment with neither is
   * rejected below rather than at the first agent call, which would be an hour
   * after signup and look like a broken product rather than a missing setting.
   */
  OPENAI_API_KEY: z.string().min(1).optional(),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  LLM_PROVIDER: z.enum(["openai", "anthropic"]).optional(),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  /**
   * Required only when LINKEDIN_PROVIDER is "unipile", which is the default.
   * The mock provider exists so the whole flow can run without touching
   * anyone's real account, and demanding real credentials to use it made the
   * mock useless for the case it was built for — standing a deployment up
   * before the LinkedIn subscription exists.
   */
  /**
   * Unipile's per-account API origin, including its port — e.g.
   * `https://api58.unipile.com:18893`.
   *
   * Validated as a URL rather than as a non-empty string because the value
   * people actually have to hand is `api58.unipile.com:18893`, copied from a
   * dashboard that shows it without a scheme. `min(1)` accepted that, and
   * `fetch` then threw before any request left the process — no status, no
   * response, nothing for the error handler to describe beyond "could not
   * reach". Refused at boot instead, where the message can say what is wrong.
   */
  UNIPILE_DSN: z
    .string()
    .min(1)
    .refine(isAbsoluteHttpUrl, {
      message:
        "must be a full origin including the scheme and port, e.g. https://api58.unipile.com:18893",
    })
    .transform(stripTrailingSlash)
    .optional(),
  UNIPILE_ACCESS_TOKEN: z.string().min(1).optional(),
  /** Required in production: without it, anyone can forge an inbound reply. */
  UNIPILE_WEBHOOK_SECRET: z.string().optional(),
  /** Shared with the web app to authenticate internal job dispatch. */
  INTERNAL_API_SECRET: z.string().min(32).optional(),
  /**
   * The public base of the web app. Every OAuth redirect and every link in
   * every email is built from it.
   *
   * Trailing slash stripped rather than tolerated: these are all built as
   * `${APP_URL}/path`, so one pasted with a slash produced `//app/team`, which
   * a browser reads as protocol-relative and Next.js does not route — the rep
   * finished signing in to LinkedIn and landed on a client-side exception.
   */
  APP_URL: z
    .string()
    .default("http://localhost:3000")
    .refine(isAbsoluteHttpUrl, { message: "must be an absolute http(s) URL" })
    .transform(stripTrailingSlash),
  /** Public base URL of this worker, used for OAuth redirect URIs. */
  /** Same treatment: it is the base of every webhook and callback URL. */
  WORKER_URL: z
    .string()
    .default("http://localhost:4000")
    .refine(isAbsoluteHttpUrl, { message: "must be an absolute http(s) URL" })
    .transform(stripTrailingSlash),
  WORKER_PORT: z.coerce.number().default(4000),
  /** Set to "mock" in development to run without touching LinkedIn at all. */
  LINKEDIN_PROVIDER: z.enum(["unipile", "mock"]).default("unipile"),
  // "own" is the default: this product keeps its own availability and books
  // into its own table. Google is still supported for a deployment that has
  // been through brand verification, which needs a verified domain and a review
  // measured in weeks -- requiring it made the last stage of the product
  // impossible to demonstrate anywhere else.
  CALENDAR_PROVIDER: z.enum(["own", "google", "mock"]).default("own"),
  MICROSOFT_CLIENT_ID: z.string().optional(),
  MICROSOFT_CLIENT_SECRET: z.string().optional(),
  /** "common" for any work account, or a specific tenant id. */
  MICROSOFT_TENANT: z.string().optional(),
  CRM_PROVIDER: z.enum(["auto", "mock"]).default("auto"),
  HUBSPOT_CLIENT_ID: z.string().optional(),
  HUBSPOT_CLIENT_SECRET: z.string().optional(),
  SALESFORCE_CLIENT_ID: z.string().optional(),
  SALESFORCE_CLIENT_SECRET: z.string().optional(),
  /** Use https://test.salesforce.com for a sandbox org. */
  SALESFORCE_LOGIN_URL: z.string().optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRICE_SOLO: z.string().optional(),
  STRIPE_PRICE_PRO: z.string().optional(),
  STRIPE_PRICE_TEAMS: z.string().optional(),
  EMAIL_PROVIDER: z.enum(["resend", "mock", "off"]).default("off"),
  RESEND_API_KEY: z.string().optional(),
  /** e.g. "LinkedIn Employee <hello@yourdomain.com>" */
  EMAIL_FROM: z.string().optional(),
  EMAIL_REPLY_TO: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  /** 32 bytes of hex. Encrypts OAuth tokens at rest; see src/crypto.ts. */
  CREDENTIALS_KEY: z.string().length(64).optional(),
  /** Minutes a booked intro call runs for. */
  MEETING_DURATION_MINUTES: z.coerce.number().int().min(15).max(120).default(30),
}).superRefine((env, ctx) => {
  if (!env.OPENAI_API_KEY && !env.ANTHROPIC_API_KEY) {
    ctx.addIssue({
      code: "custom",
      path: ["OPENAI_API_KEY"],
      message: "set OPENAI_API_KEY or ANTHROPIC_API_KEY",
    });
  }

  // Checked here rather than at the first send: a worker that boots without
  // the credentials it needs looks healthy for hours, and the failure surfaces
  // as a campaign that quietly never started.
  if (env.LINKEDIN_PROVIDER === "unipile") {
    for (const key of ["UNIPILE_DSN", "UNIPILE_ACCESS_TOKEN"] as const) {
      if (!env[key]) {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: `required unless LINKEDIN_PROVIDER=mock`,
        });
      }
    }
  }
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    // Naming only the key was enough while every failure meant "absent". Once a
    // value can be present and wrong, the key alone sends someone to look at a
    // variable that is plainly filled in.
    const problems = parsed.error.issues
      .map((i) => `${i.path.join(".")} (${i.message})`)
      .join(", ");
    throw new Error(`Worker environment is incomplete: ${problems}`);
  }
  return parsed.data;
}
