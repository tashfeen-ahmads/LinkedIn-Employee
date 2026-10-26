import type { NextRequest } from "next/server";
import { requireSession } from "@/lib/workspace";
import { callWorker, errorQuery } from "@/lib/worker";
import { seeOther } from "@/lib/see-other";
import { priceKey, type Interval, type PlanKey } from "@/lib/plans";

/**
 * Starts Stripe's checkout for the plan and interval chosen on the profile.
 *
 * A route rather than a server action, for rule 57's reason: an action's id
 * changes with every deploy, and a plan card left open across one would post
 * to nothing. The answer is Stripe's own page; a refusal comes back to the
 * billing section in words.
 */
export async function POST(request: NextRequest) {
  if (request.headers.get("sec-fetch-site") === "cross-site") {
    return seeOther(back("That was refused. Choose the plan from this page."));
  }
  const session = await requireSession();
  if (!["owner", "admin"].includes(session.role)) {
    return seeOther(back("Only an owner or admin can choose the plan."));
  }
  const form = await request.formData().catch(() => null);
  const plan = String(form?.get("plan") ?? "") as PlanKey;
  const interval = String(form?.get("interval") ?? "month") as Interval;
  if (plan !== "pro" && plan !== "autopilot") return seeOther(back("Choose Pro or Autopilot."));
  if (interval !== "month" && interval !== "year") {
    return seeOther(back("Choose monthly or yearly."));
  }

  const result = await callWorker<{ url?: string }>("/jobs/checkout", {
    workspaceId: session.workspaceId,
    userId: session.userId,
    price: priceKey(plan, interval),
    ...(session.email ? { email: session.email } : {}),
  });
  if (!result.ok) {
    // The worker says why in the customer's words — payments not switched on
    // yet, a plan already in place — and none of them names a supplier
    // (rule 54). A shrug here told somebody on a deployment with payments off
    // to keep trying something that could never work.
    return seeOther(back(result.error || "Checkout could not be opened just now. Try again in a minute."));
  }
  if (!result.data?.url) {
    return seeOther(back("Checkout could not be opened just now. Try again in a minute."));
  }
  // Stripe's own page: the one redirect here meant to leave the product.
  return new Response(null, { status: 303, headers: { Location: result.data.url } });
}

/** Back to the billing section, carrying the reason. The fragment goes after the query. */
function back(message: string): string {
  return `${errorQuery("/app/profile", message)}#billing`;
}
