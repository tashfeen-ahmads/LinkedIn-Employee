import { z } from "zod";

const EnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().min(1),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  UNIPILE_DSN: z.string().min(1),
  UNIPILE_ACCESS_TOKEN: z.string().min(1),
  UNIPILE_WEBHOOK_SECRET: z.string().optional(),
  APP_URL: z.string().default("http://localhost:3000"),
  /** Public base URL of this worker, used for OAuth redirect URIs. */
  WORKER_URL: z.string().default("http://localhost:4000"),
  WORKER_PORT: z.coerce.number().default(4000),
  /** Set to "mock" in development to run without touching LinkedIn at all. */
  LINKEDIN_PROVIDER: z.enum(["unipile", "mock"]).default("unipile"),
  CALENDAR_PROVIDER: z.enum(["google", "mock"]).default("google"),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  /** 32 bytes of hex. Encrypts OAuth tokens at rest; see src/crypto.ts. */
  CREDENTIALS_KEY: z.string().length(64).optional(),
  /** Minutes a booked intro call runs for. */
  MEETING_DURATION_MINUTES: z.coerce.number().int().min(15).max(120).default(30),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Worker environment is incomplete: ${missing}`);
  }
  return parsed.data;
}
