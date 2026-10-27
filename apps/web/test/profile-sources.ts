import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * The profile screen, read whole.
 *
 * Profile was one `page.tsx`. It is a set of sections now — You, Company,
 * LinkedIn account, Sending hours, Replies, Meetings, LinkedIn activity, Team,
 * Billing — each its own route under `app/app/profile/`, with the components
 * they share beside them. A test asking "can the profile change this" or
 * "does the profile write that" is asking about the screen, not about which
 * file a section happens to live in, so it reads every source under that
 * directory, in a stable order.
 */
const PROFILE_DIR = join(__dirname, "..", "src", "app", "app", "profile");

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return sources(path);
      return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
    });
}

export const PROFILE_FILES = sources(PROFILE_DIR);

export function profileSources(): string {
  return PROFILE_FILES.map((file) => readFileSync(file, "utf8")).join("\n");
}

/** One section's own source, for an assertion about where a thing is said. */
export function profileFile(...parts: string[]): string {
  return readFileSync(join(PROFILE_DIR, ...parts), "utf8");
}
