import type { NextRequest } from "next/server";
import { requireSession } from "@/lib/workspace";
import { callWorker, errorQuery } from "@/lib/worker";
import { seeOther } from "@/lib/see-other";

/**
 * Opens Stripe's billing portal: change plan or interval, update the card,
 * see invoices, or cancel. Everything done there comes back as a webhook.
 */
export async function POST(request: NextRequest) {
  if (request.headers.get("sec-fetch-site") === "cross-site") {
    return seeOther(back("That was refused. Open billing from this page."));
  }
  const session = await requireSession();
  if (!["owner", "admin"].includes(session.role)) {
    return seeOther(back("Only an owner or admin can manage billing."));
  }
  const result = await callWorker<{ url?: string }>("/jobs/portal", {
    workspaceId: session.workspaceId,
    userId: session.userId,
  });
  if (!result.ok || !result.data?.url) {
    return seeOther(back("Billing could not be opened just now. Try again in a minute."));
  }
  return new Response(null, { status: 303, headers: { Location: result.data.url } });
}

/** Back to the billing section, carrying the reason. The fragment goes after the query. */
function back(message: string): string {
  return `${errorQuery("/app/profile", message)}#billing`;
}
