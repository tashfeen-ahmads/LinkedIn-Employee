import type { NextRequest } from "next/server";
import { retryStrategy } from "@/lib/strategy-retry";
import { seeOther } from "@/lib/see-other";

/*
 * Runs the Strategy Agent again, as a plain form post.
 *
 * A URL rather than a server action because the button lives in a shared
 * component on the overview, the strategy page and onboarding, and a server
 * action's id changes with every deploy — a page opened before one and pressed
 * after it asks for an action that no longer exists. A 303 is followed by
 * every browser without any of our JavaScript running (rule 57).
 */
export async function POST(request: NextRequest) {
  return seeOther(await retryStrategy(await request.formData()));
}
